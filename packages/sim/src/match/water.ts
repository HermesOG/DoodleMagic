import { sanitizeInput } from "../player";
import { groundBelow } from "../raycast";
import type { MoveParams, Vec3 } from "../types";
import { add, clamp, scale } from "../vec";
import { aimGround } from "./aim";
import { applyHit, applyStatus, healUnit, pullMul, type HitSpec } from "./combat";
import { WATER, slotCooldownTicks, ticks } from "./defs";
import type { ElementSim, ProjectileHit, ZoneStep } from "./hooks";
import { castAim, castSlots, emitCast, horizontalDir, type Kit, type TryCast } from "./kit";
import { spawnProjectile, sweepSegment } from "./projectiles";
import { unitById } from "./state";
import { damageTerrain } from "./terrain";
import { NEVER, NOBODY, type Buttons, type MageState, type MatchInput, type MatchState, type RejectReason, type Slot, type TickCtx, type Unit } from "./types";
import { endZone, spawnZone, zoneTouches } from "./zones";

/**
 * Вода «Перехватчик» (round3/03-water.md, концепция A; Р4, Р5, Р7, Р8, Р14, Р21, Р22 фазы 4): ЛКМ «Водяной хлыст» —
 * луч с замахом, Q «Хват» — жгут и буксир к Воде, E «Отражение» — диск на 1 с, который впитывает снаряды спереди
 * и отвечает своим снарядом, C «Родник» — лужа, которая лечит Воду и мочит и вяжет врагов.
 * «Круговорот», «Мокрый», пар, впитывание и якорь живут в combat.ts и projectiles.ts (задача 1).
 * Перезарядки ставятся на принятом нажатии (Р14); отклонённое замахом нажатие ждёт в буфере castSlots до 0,3 с.
 */

const WW = WATER.waterWhip;
const WG = WATER.waterGrab;
const WD = WATER.waterWard;
const SP = WATER.spring;

const WHIP_CD = slotCooldownTicks("water", "primary"); // 24
const WHIP_WINDUP_TICKS = ticks(WW.windupS); // 7
/** «Сок» хлыста к Воде: 0,3 м × min(1, интервал 0,4 с / tempoRefS 0,5 с) = 0,24 м. */
const WHIP_JUICE_M = WW.knockback.distM * Math.min(1, 1 / WW.ratePerS / WW.tempoRefS);
const GRAB_CD = slotCooldownTicks("water", "q"); // 480
const GRAB_WINDUP_TICKS = ticks(WG.windupS); // 15
const WARD_CD = slotCooldownTicks("water", "e"); // 540
const WARD_TICKS = ticks(WD.durationS); // 60
const SPRING_CD = slotCooldownTicks("water", "c"); // 840
const SPRING_TELEGRAPH_TICKS = ticks(SP.telegraphS); // 24
const SPRING_LIFE_TICKS = ticks(SP.lifeS); // 360
const SPRING_PULSE_TICKS = ticks(SP.healPulseS); // 15
const SPRING_PULSE_HEAL = SP.healPerS * SP.healPulseS; // 3
/** Буксир за тик, м: 20 м/с → 1/3 м. */
const TOW_STEP_M = WG.towSpeed / ticks(1);
/** Буксир короче этого — без буксира (Р5). */
const TOW_MIN_M = 0.05;
/** Опору под точкой буксира ищем от подошвы цели чуть выше неё. */
const TOW_PROBE_UP_M = 0.1;

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

/** Диск Отражения стоит на этом тике. */
const wardUp = (m: MageState, now: number): boolean => m.ward !== null && now < m.ward.endTick;

/** Замах или диск — «занят»: так у хлыста и Хвата. */
function busyOrWard(t: TickCtx, u: Unit): RejectReason | null {
  const m = u.mage!;
  return m.windup || wardUp(m, t.now) ? "busy" : null;
}

/** ЛКМ: пока удержана (или нажатие ждёт в буфере) и готова — замах хлыста 0,12 с; бьёт tick (whipStrike). */
function whip(_s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  if (t.now < m.ready.primary) return "cooldown";
  const no = busyOrWard(t, u);
  if (no) return no;
  m.ready.primary = t.now + WHIP_CD;
  m.windup = { ability: "waterWhip", slot: "primary", releaseTick: t.now + WHIP_WINDUP_TICKS };
  emitCast(t, u, "waterWhip", "primary", castAim(u, inp));
  return null;
}

/** Q: замах 0,25 с, жгут вылетает в tick на releaseTick по прицелу того тика. */
function grab(_s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  if (t.now < m.ready.q) return "cooldown";
  const no = busyOrWard(t, u);
  if (no) return no;
  m.ready.q = t.now + GRAB_CD;
  m.windup = { ability: "waterGrab", slot: "q", releaseTick: t.now + GRAB_WINDUP_TICKS };
  emitCast(t, u, "waterGrab", "q", castAim(u, inp));
  return null;
}

/** E: диск на 1 с перед Водой и якорь на то же время (Р7, Р8). В своём замахе — «занят»: нажатие ждёт выпуска в буфере. */
function ward(_s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < m.ready.e) return "cooldown";
  if (m.windup) return "busy";
  m.ready.e = now + WARD_CD;
  m.ward = { endTick: now + WARD_TICKS, absorbed: 0 };
  u.status.anchoredUntil = Math.max(u.status.anchoredUntil, now + WARD_TICKS);
  emitCast(t, u, "waterWard", "e", castAim(u, inp));
  t.ev.push({ type: "ward", unit: u.id, phase: "up", absorbed: 0 });
  return null;
}

/** C: Родник под прицелом до 15 м; над пустотой — отказ. Свой прежний Родник уходит. Разлив 0,4 с, живёт 6 с. */
function spring(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < m.ready.c) return "cooldown";
  if (m.windup) return "busy";
  const look = sanitizeInput(inp, u.move);
  const at = aimGround(s, t, u.id, look.yaw, look.pitch, SP.rangeM);
  if (!at) return "noTarget";
  for (const z of s.zones.filter((q) => q.owner === u.id && q.kind === "spring")) endZone(s, t, z);
  const armTick = now + SPRING_TELEGRAPH_TICKS;
  spawnZone(s, t, {
    owner: u.id, kind: "spring", ability: "spring", shape: { type: "disc", center: copy(at), radius: SP.radiusM },
    bornTick: now, armTick, endTick: armTick + SPRING_LIFE_TICKS,
  });
  m.ready.c = now + SPRING_CD;
  emitCast(t, u, "spring", "c", castAim(u, inp));
  return null;
}

/**
 * Удар хлыста: луч из глаз по прицелу на 15 м шириной 0,5 м (sweepSegment, мир — лучом "shot": укрытие и рельеф
 * режут, Стена огня и пар — нет; диск Отражения луч не ловит). Маг или манекен — 20 урона и «сок» 0,24 м к Воде;
 * рельеф — 20 урона (Р21). События release (без снаряда) и beam до точки попадания или конца луча.
 */
function whipStrike(s: MatchState, t: TickCtx, u: Unit, aim: { eye: Vec3; dir: Vec3 }): void {
  const end = add(aim.eye, scale(aim.dir, WW.rangeM));
  const hit = sweepSegment(s, t, u.id, aim.eye, end, WW.radiusM);
  const to = hit ? hit.point : end;
  const target = hit ? hit.unit : NOBODY;
  t.ev.push({ type: "release", unit: u.id, ability: "waterWhip", projectile: -1, pos: copy(aim.eye), dir: copy(aim.dir) });
  t.ev.push({ type: "beam", unit: u.id, ability: "waterWhip", from: copy(aim.eye), to: copy(to), target });
  if (!hit) return;
  if (hit.unit !== NOBODY) {
    const h = horizontalDir({ x: aim.dir.x, z: aim.dir.z });
    applyHit(s, t, {
      source: u.id, target: hit.unit, ability: "waterWhip", damage: WW.damage, pos: copy(hit.point),
      dir: { x: -h.x + 0, z: -h.z + 0 }, knock: { distM: WHIP_JUICE_M, upM: 0 },
    });
  } else if (hit.terrain !== null) damageTerrain(s, t, hit.terrain, WW.damage, hit.point);
}

/**
 * Конец диска (по времени или по ЛКМ): впитал хоть что-то — Ответ по прицелу этого тика с уроном впитанного
 * в пределах 20–60 (засчитывается «Отражению»), событие release; затем ward/down, диск и якорь сняты.
 */
function dropWard(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
  const m = u.mage!;
  const w = m.ward!;
  if (w.absorbed > 0) {
    const aim = castAim(u, inp);
    const power = clamp(w.absorbed, WD.answer.minDamage, WD.answer.maxDamage);
    const id = spawnProjectile(s, t, u.id, "waterAnswer", aim.eye, aim.dir, power);
    t.ev.push({ type: "release", unit: u.id, ability: "waterWard", projectile: id, pos: copy(aim.eye), dir: copy(aim.dir) });
  }
  t.ev.push({ type: "ward", unit: u.id, phase: "down", absorbed: w.absorbed });
  m.ward = null;
  u.status.anchoredUntil = Math.min(u.status.anchoredUntil, t.now);
}

/** Слоты Воды для castSlots: он же держит буфер нажатий и пишет отказы. */
const WATER_CASTS: Readonly<Record<Slot, TryCast>> = Object.freeze({ primary: whip, q: grab, e: ward, c: spring });
/**
 * Q, E и C — раньше удержанной ЛКМ, как у Земли: замах хлыста, начатый первым, отложил бы Хват и Отражение («в беде
 * жми E»), нажатые ровно на тике, когда хлыст снова готов.
 */
const WATER_ORDER: readonly Slot[] = Object.freeze(["q", "e", "c", "primary"]);

export const WATER_KIT: Kit = Object.freeze({
  /**
   * Нажатие ЛКМ под диском гасит его досрочно (Ответ — сразу) и поглощается: ни хлыста на этом тике, ни нажатия
   * в буфере. Ответ считается ударом хлыста: клик держится несколько тиков, и без перезарядки удержание сразу
   * начало бы лишний замах. Дальше удержание бьёт хлыстом, как у любой ЛКМ.
   */
  input(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, pressed: Buttons): void {
    const m = u.mage!;
    if (pressed.primary && wardUp(m, t.now)) {
      dropWard(s, t, u, inp);
      m.pending.primary = NEVER;
      m.ready.primary = Math.max(m.ready.primary, t.now + WHIP_CD);
      castSlots(s, t, u, { ...inp, primary: false }, { ...pressed, primary: false }, WATER_CASTS, WATER_ORDER);
      return;
    }
    castSlots(s, t, u, inp, pressed, WATER_CASTS, WATER_ORDER);
  },
  /** Конец замаха (хлыст бьёт, жгут вылетает) по прицелу этого тика; конец диска по времени. */
  tick(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
    const m = u.mage!;
    const w = m.windup;
    if (w && t.now >= w.releaseTick) {
      m.windup = null;
      const aim = castAim(u, inp);
      if (w.ability === "waterWhip") whipStrike(s, t, u, aim);
      else {
        const id = spawnProjectile(s, t, u.id, "waterGrab", aim.eye, aim.dir);
        t.ev.push({ type: "release", unit: u.id, ability: "waterGrab", projectile: id, pos: copy(aim.eye), dir: copy(aim.dir) });
      }
    }
    if (m.ward && t.now >= m.ward.endTick) dropWard(s, t, u, inp);
  },
});

/**
 * Точка буксира Хвата (Р5): к Воде по линии на цель в момент попадания, до 1,5 м перед Водой, не дальше 7 м × pullMul
 * (Земля и иммунитет ×0,5, якорь — 0). Полный буксир встаёт где кончился, даже над пустотой (Вода сама у кромки).
 * Укороченный пределом — на первой точке с опорой не глубже 3 м, шагами 0,25 м от конца назад к цели; опоры нет —
 * буксира нет. Буксир короче 0,05 м — нет. Тики — на один больше шагов: Хват бьёт после движения тика, и stepTow
 * делает ticks − 1 шагов; дойдя до точки, буксир кончается сам.
 */
function grabTow(t: TickCtx, water: Unit, target: Unit): HitSpec["tow"] | null {
  const w = water.move.body.pos;
  const p = target.move.body.pos;
  const dx = p.x - w.x;
  const dz = p.z - w.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (!(d > 1e-9)) return null;
  const ux = dx / d;
  const uz = dz / d;
  const full = Math.max(0, d - WG.towStopM);
  let len = Math.min(full, WG.towMaxM * pullMul(target, t.now));
  if (len < TOW_MIN_M) return null;
  if (len < full) {
    let back = 0;
    for (let k = 0; back <= len + 1e-9; k++, back = k * WG.safeStepM) {
      const q = { x: p.x - ux * (len - back), y: p.y + TOW_PROBE_UP_M, z: p.z - uz * (len - back) };
      if (groundBelow(t.world, q, WG.safeDropM) !== null) break;
    }
    if (back > len + 1e-9) return null;
    len -= back;
    if (len < TOW_MIN_M) return null;
  }
  return { x: p.x - ux * len + 0, z: p.z - uz * len + 0, speed: WG.towSpeed, ticks: Math.ceil(len / TOW_STEP_M - 1e-9) + 1 };
}

/**
 * Попадание жгута: в мага или манекена — 25 урона, «Мокрый» и буксир к хозяину (нет хозяина или он мёртв — только
 * урон); направление удара — к хозяину (без него — навстречу жгуту). Рельеф и мир жгут не трогает.
 */
const grabHit: ProjectileHit = (s, t, p, hit) => {
  if (hit.unit === NOBODY) return;
  const target = unitById(s, hit.unit);
  if (!target) return;
  const water = unitById(s, p.owner);
  const fly = horizontalDir(p.vel);
  let dir = { x: -fly.x + 0, z: -fly.z + 0 };
  let tow: HitSpec["tow"] | null = null;
  if (water?.alive) {
    const pull = horizontalDir({ x: water.move.body.pos.x - target.move.body.pos.x, z: water.move.body.pos.z - target.move.body.pos.z });
    if (pull.x !== 0 || pull.z !== 0) dir = pull;
    tow = grabTow(t, water, target);
  }
  const spec: HitSpec = { source: p.owner, target: hit.unit, ability: "waterGrab", damage: p.power, pos: copy(hit.point), dir };
  if (tow) spec.tow = tow;
  applyHit(s, t, spec);
};

/**
 * Шаг Родника (Р14): внутри — по XZ до 4 м и по высоте до 1,5 м. Хозяин Мокрый каждый тик (Горение снято) и лечится
 * импульсами по 3 HP раз в 0,25 с (rehit) до полного; враги каждый тик Мокрые и замедлены до 0,7 ещё на 0,5 с.
 */
const stepSpring: ZoneStep = (s, t, z) => {
  const now = t.now;
  for (const u of s.units) {
    if (!u.alive || !zoneTouches(z.shape, u)) continue;
    if (u.id !== z.owner) {
      applyStatus(s, t, u.id, { source: z.owner, wetS: WATER.passive.wetS, slow: { mul: SP.slowMul, s: SP.slowAfterS } });
      continue;
    }
    applyStatus(s, t, u.id, { source: z.owner, wetS: WATER.passive.wetS });
    const rec = z.rehit.find((r) => r.unit === u.id);
    if (rec && rec.tick > now) continue;
    healUnit(s, t, u.id, SPRING_PULSE_HEAL, z.owner);
    if (rec) rec.tick = now + SPRING_PULSE_TICKS;
    else z.rehit.push({ unit: u.id, tick: now + SPRING_PULSE_TICKS });
  }
};

/** Бег под диском ×0,7 (Р8). */
function params(u: Unit, t: TickCtx, _inp: unknown, p: MoveParams): MoveParams {
  return wardUp(u.mage!, t.now) ? { ...p, runSpeed: p.runSpeed * WD.runMul } : p;
}

/** Вода «Перехватчик» (round3/03-water.md, концепция A). */
export const WATER_SIM: ElementSim = Object.freeze({
  kit: WATER_KIT,
  move: Object.freeze({ params }),
  zones: Object.freeze({ spring: stepSpring }),
  projectileHit: Object.freeze({ waterGrab: grabHit }),
});
