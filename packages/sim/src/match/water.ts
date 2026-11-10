import { forwardXZ, sanitizeInput } from "../player";
import { groundBelow, raycast } from "../raycast";
import type { MoveParams, Vec3 } from "../types";
import { add, clamp, scale } from "../vec";
import { aimGround } from "./aim";
import { applyHit, applyStatus, healUnit, pullMul, type HitSpec } from "./combat";
import { WATER, slotCooldownTicks, ticks } from "./defs";
import type { ElementSim, ProjectileHit, ZoneStep } from "./hooks";
import { castAim, castSlots, emitCast, horizontalDir, type Kit, type TryCast } from "./kit";
import { spawnProjectile, sweepSegment } from "./projectiles";
import { unitById } from "./state";
import { spawnSteam } from "./steam";
import { damageTerrain } from "./terrain";
import { NEVER, NOBODY, type Buttons, type MageState, type MatchInput, type MatchState, type RejectReason, type Slot, type TickCtx, type Unit, type Zone } from "./types";
import { startUlt } from "./ult";
import { endZone, spawnZone, zoneTouches } from "./zones";

/**
 * Вода «Перехватчик» (round3/03-water.md, концепция A; Р4, Р5, Р7, Р8, Р14, Р21, Р22 фазы 4): ЛКМ «Водяной хлыст» —
 * луч с замахом, Q «Хват» — жгут и буксир к Воде, E «Отражение» — диск на 1 с, который впитывает снаряды спереди
 * и отвечает своим снарядом, C «Родник» — лужа, которая лечит Воду и мочит и вяжет врагов, X «Цунами» — ульта,
 * волна-зона (Р9 фазы 5).
 * «Круговорот», «Мокрый», пар, впитывание и якорь живут в combat.ts и projectiles.ts (задача 1).
 * Перезарядки ставятся на принятом нажатии (Р14); отклонённое замахом нажатие ждёт в буфере castSlots до 0,3 с.
 */

const WW = WATER.waterWhip;
const WG = WATER.waterGrab;
const WD = WATER.waterWard;
const SP = WATER.spring;
const TS = WATER.tsunami;

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
/** Ход волны за тик, м: 15 м/с → 0,25 м. */
const WAVE_STEP_M = TS.speed / ticks(1);
/** Волна катится 30 м: 120 тиков после взвода. */
const WAVE_ROLL_TICKS = ticks(TS.travelM / TS.speed);
/** Полуширина волны поперёк хода, м. */
const WAVE_HALF_M = TS.widthM / 2;
/** Волна встаёт на опору под ступнями Воды: ищем от чуть выше подошвы и не глубже 3 м (каст в прыжке — не над полом). */
const WAVE_GROUND_PROBE_UP_M = 0.1;
const WAVE_GROUND_DROP_M = 3;
/** Огненные зоны, которые волна гасит паром. */
const quenched = (q: Zone): boolean => q.kind === "fireWall" || q.kind === "fireTrail" || q.kind === "fireTornado";

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const bodyCenter = (u: Unit): Vec3 => ({ x: u.move.body.pos.x, y: u.move.body.pos.y + u.move.body.height / 2, z: u.move.body.pos.z });

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

/**
 * X «Цунами» (Р9 фазы 5): ход d — взгляд по XZ, поперёк n = (−d.z, d.x), старт O — на 2 м позади Воды, на высоте
 * опоры под её ступнями (не глубже 3 м; опоры нет — высота ступней): каст в прыжке не поднимает волну над полом.
 * Каст принят (startUlt) — зона tsunami: отрезок 14 м поперёк хода через O, полутолщина 1 м; поднимается до взвода
 * на releaseTick каста (0,8 с), затем катится 120 тиков (stepTsunami). ult.cast.zone — её id.
 */
function tsunami(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const f = forwardXZ(sanitizeInput(inp, u.move).yaw);
  const d = { x: f.x + 0, z: f.z + 0 };
  const n = { x: -d.z + 0, z: d.x + 0 };
  const p = u.move.body.pos;
  const y = groundBelow(t.world, { x: p.x, y: p.y + WAVE_GROUND_PROBE_UP_M, z: p.z }, WAVE_GROUND_DROP_M) ?? p.y;
  const o = { x: p.x - d.x * TS.backM, y, z: p.z - d.z * TS.backM };
  const r = startUlt(t, u, inp, "tsunami");
  if (r !== null) return r;
  const cast = u.mage!.ult.cast!;
  cast.zone = spawnZone(s, t, {
    owner: u.id, kind: "tsunami", ability: "tsunami",
    shape: {
      type: "segment",
      a: { x: o.x - n.x * WAVE_HALF_M, y: o.y, z: o.z - n.z * WAVE_HALF_M },
      b: { x: o.x + n.x * WAVE_HALF_M, y: o.y, z: o.z + n.z * WAVE_HALF_M },
      halfW: TS.depthM / 2,
    },
    bornTick: t.now, armTick: cast.releaseTick, endTick: cast.releaseTick + WAVE_ROLL_TICKS,
  });
  return null;
}

/** Слоты Воды для castSlots: он же держит буфер нажатий и пишет отказы. */
const WATER_CASTS: Readonly<Record<Slot, TryCast>> = Object.freeze({ primary: whip, q: grab, e: ward, c: spring, x: tsunami });
/**
 * Q, E и C — раньше удержанной ЛКМ, как у Земли: замах хлыста, начатый первым, отложил бы Хват и Отражение («в беде
 * жми E»), нажатые ровно на тике, когда хлыст снова готов. X — последней, как в SLOTS.
 */
const WATER_ORDER: readonly Slot[] = Object.freeze(["q", "e", "c", "primary", "x"]);

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

/** Расстояние по XZ от точки до отрезка ab. */
function distXZToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
  const dx = p.x - (a.x + abx * k);
  const dz = p.z - (a.z + abz * k);
  return Math.sqrt(dx * dx + dz * dz);
}

/** Свободен ли луч "shot" от a до b: камень и рельеф закрывают, Стена огня и пар — нет. */
function clearShot(t: TickCtx, a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return len < 1e-9 || raycast(t.world, a, { x: dx / len, y: dy / len, z: dz / len }, len, "shot") === null;
}

/** Точка огненной зоны у земли: центр диска, середина отрезка, середина низа бокса. */
function groundPoint(z: Zone): Vec3 {
  const sh = z.shape;
  if (sh.type === "disc") return copy(sh.center);
  if (sh.type === "segment") return { x: (sh.a.x + sh.b.x) / 2, y: (sh.a.y + sh.b.y) / 2, z: (sh.a.z + sh.b.z) / 2 };
  return { x: (sh.box.min.x + sh.box.max.x) / 2, y: sh.box.min.y, z: (sh.box.min.z + sh.box.max.z) / 2 };
}

/**
 * Шаг волны «Цунами» после взвода (Р9 фазы 5). Ход отдельно не хранится — всё из зоны: n = (b − a) по XZ, ход
 * d = (n.z, −n.x), точка старта O — середина ab на начало тика минус d · 0,25 · (now − armTick), O.y = a.y.
 * - Отрезок сдвигается на 0,25 м по ходу (15 м/с; 30 м за 120 тиков).
 * - Юнит — живой не-хозяин, ещё не битый этой волной (rehit до endTick): подошва от O.y − 1 до O.y + 2,5 м, по XZ
 *   до отрезка не дальше полутолщины волны и полутела, свободный луч "shot" от линии Воды (O + d·2 + n·s, s — боковая
 *   координата юнита в пределах ±7 м, на высоте O.y + 1,25) до центра тела — закрывает укрытие между Водой и целью;
 *   стена у неё за спиной (там, где волна поднялась) — нет: луч из бокса упёрся бы в него сразу.
 *   Удар: 80 урона, толчок {10, 1} по ходу. «Мокрый», гашение Горения паром и «Круговорот» — в applyHit по стихии.
 * - Стена огня, след рывка и огненный смерч, чья точка у земли попала в полосу волны (по XZ до отрезка не дальше
 *   полутолщины, по высоте — как подошва), уходят (zone/end); на их месте — облако пара хозяйки волны.
 */
const stepTsunami: ZoneStep = (s, t, z) => {
  if (z.shape.type !== "segment") return;
  const sh = z.shape;
  const n = horizontalDir({ x: sh.b.x - sh.a.x, z: sh.b.z - sh.a.z });
  const d = { x: n.z, z: -n.x + 0 };
  const back = WAVE_STEP_M * (t.now - z.armTick);
  const o = { x: (sh.a.x + sh.b.x) / 2 - d.x * back, y: sh.a.y, z: (sh.a.z + sh.b.z) / 2 - d.z * back };
  sh.a = { x: sh.a.x + d.x * WAVE_STEP_M, y: sh.a.y, z: sh.a.z + d.z * WAVE_STEP_M };
  sh.b = { x: sh.b.x + d.x * WAVE_STEP_M, y: sh.b.y, z: sh.b.z + d.z * WAVE_STEP_M };
  const lo = o.y - TS.belowM;
  const hi = o.y + TS.heightM;
  for (const v of s.units) {
    if (!v.alive || v.id === z.owner || z.rehit.some((r) => r.unit === v.id)) continue;
    const vb = v.move.body;
    if (vb.pos.y < lo || vb.pos.y > hi || distXZToSegment(vb.pos, sh.a, sh.b) > sh.halfW + vb.halfW) continue;
    const c = bodyCenter(v);
    const side = clamp((vb.pos.x - o.x) * n.x + (vb.pos.z - o.z) * n.z, -WAVE_HALF_M, WAVE_HALF_M);
    const from = { x: o.x + d.x * TS.backM + n.x * side, y: o.y + TS.heightM / 2, z: o.z + d.z * TS.backM + n.z * side };
    if (!clearShot(t, from, c)) continue;
    z.rehit.push({ unit: v.id, tick: z.endTick });
    applyHit(s, t, {
      source: z.owner, target: v.id, ability: "tsunami", damage: TS.damage, pos: c, dir: { x: d.x, z: d.z },
      knock: { distM: TS.knockback.distM, upM: TS.knockback.upM },
    });
  }
  for (const q of [...s.zones]) {
    if (!quenched(q) || !s.zones.includes(q)) continue;
    const p = groundPoint(q);
    if (p.y < lo || p.y > hi || distXZToSegment(p, sh.a, sh.b) > sh.halfW) continue;
    endZone(s, t, q);
    spawnSteam(s, t, p, z.owner, "tsunami");
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
  zones: Object.freeze({ spring: stepSpring, tsunami: stepTsunami }),
  projectileHit: Object.freeze({ waterGrab: grabHit }),
});
