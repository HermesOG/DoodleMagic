import { moveBody } from "../body";
import { DEFAULT_MOVE, forwardXZ, sanitizeInput } from "../player";
import { raycast } from "../raycast";
import { TICK_DT, type AABB, type MoveParams, type PlayerInput, type Vec3 } from "../types";
import { aimGround } from "./aim";
import { applyHit, launchUnit, pullMul } from "./combat";
import { dashStarted, startDash, stepDash, type DashSpec } from "./dash";
import { AIR, RAMPART, SAND_TORNADO, slotCooldownTicks, ticks } from "./defs";
import type { ElementSim, MoveHooks, ZoneStep } from "./hooks";
import { castAim, castSlots, emitCast, refillCharges, spendCharge, type Kit, type TryCast } from "./kit";
import { spawnProjectile } from "./projectiles";
import { damageTerrain } from "./terrain";
import type { Buttons, MatchInput, MatchState, RejectReason, Slot, TickCtx, Unit, Zone } from "./types";
import { startUlt } from "./ult";
import { adoptZone, endZone, spawnZone } from "./zones";

/**
 * Воздух «Свобода» (round3/02-air.md; Р2, Р10–Р13 фазы 4). «Лёгкость» — хуки движения: второй прыжок и парение.
 * Кит: ЛКМ «Воздушный серп», Q «Порыв» с замахом (конус по взгляду, удар о стену, сдув чужих снарядов), E «Взмах»
 * на двух зарядах (dash.ts, без следа), C «Смерч» — зона с тягой, импульсами и ядром, X «Ураган» — ульта (Р8 фазы 5).
 * Реакция «Огненный смерч» — в шаге вихря. Функции меняют переданное состояние на месте (stepMatch отдаёт им свою
 * копию) и пишут события в t.ev.
 */

const SK = AIR.airSickle;
const GU = AIR.gust;
const SW = AIR.swoop;
const TO = AIR.tornado;
const HU = AIR.hurricane;
const LI = AIR.passive;
const G = DEFAULT_MOVE.gravity;

const SICKLE_TICKS = slotCooldownTicks("air", "primary"); // 20
const GUST_CD = slotCooldownTicks("air", "q"); // 480
const GUST_WINDUP_TICKS = ticks(GU.windupS); // 24
const SWOOP_CHARGE_TICKS = slotCooldownTicks("air", "e"); // 360
const TORNADO_CD = slotCooldownTicks("air", "c"); // 1080
const TORNADO_GROW_TICKS = ticks(TO.growS); // 30
const TORNADO_LIFE_TICKS = ticks(TO.lifeS); // 240
const PULSE_TICKS = ticks(TO.pulseS); // 30
const OWNER_LIFT_TICKS = ticks(TO.ownerLiftEveryS); // 60
const GLIDE_TICKS = ticks(LI.glideS); // 180
/** Второй прыжок ставит скорость вверх заново: √(2·20·1,25) ≈ 7,07 м/с. */
const DOUBLE_JUMP_SPEED = Math.sqrt(2 * G * LI.doubleJumpM);
/** Ядро поднимает хозяина на 2 м: √(2·20·2) ≈ 8,94 м/с. */
const OWNER_LIFT_SPEED = Math.sqrt(2 * G * TO.ownerLiftM);
/** «Ураган» поднимает Воздух на 3 м: √(2·20·3) ≈ 10,95 м/с. */
const HURRICANE_LIFT_SPEED = Math.sqrt(2 * G * HU.selfLiftM);
const GUST_COS = Math.cos((GU.halfAngleDeg * Math.PI) / 180);
/** Взрыв шара поджигает вихрь по высоте — во весь его рост: от 0,5 м ниже основания до 4 м выше (Р10). */
const FIRE_REACH_DY_M = TO.belowM + TO.aboveM;
const RAMPART_TICKS = ticks(RAMPART.durationS); // 60
/** Шаг «Огненного вала» за тик, м: 8 м за 1 с. */
const RAMPART_STEP_M = RAMPART.distM / RAMPART_TICKS;
/** Шаг проб по средней линии стены для конуса Порыва, м. */
const WALL_SAMPLE_M = 0.25;
/** Порыв без снаряда: в событии release projectile −1. */
const NO_PROJECTILE = -1;

/** Взмах (Р3, Р13 фазы 4): 8 м за 0,2 с горизонтально, профиль A6, на выходе 7 м/с (бег Воздуха), без следа. */
export const SWOOP: Readonly<DashSpec> = Object.freeze({
  ability: "swoop", distM: SW.distM, durationS: SW.durationS, profile: SW.profile, exitSpeed: SW.exitSpeed, trail: null,
});

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const bodyCenter = (u: Unit): Vec3 => ({ x: u.move.body.pos.x, y: u.move.body.pos.y + u.move.body.height / 2, z: u.move.body.pos.z });

// ---------------------------------------------------------------- «Лёгкость»

/** Парение вкл/выкл: событие glide только при смене. */
function setGlide(t: TickCtx, u: Unit, on: boolean): void {
  const f = u.mage!.flight;
  if (f.gliding === on) return;
  f.gliding = on;
  t.ev.push({ type: "glide", unit: u.id, on, pos: copy(u.move.body.pos) });
}

/**
 * «Лёгкость» (Р13): в воздухе (не на полу и окно «койота» закрыто) нажатие прыжка — второй прыжок, раз до приземления;
 * после него зажатый прыжок при падении — парение: падение не быстрее 2,5 м/с, управление в воздухе 100 %, запас
 * 3 с до приземления. Обычный прыжок с зажатым пробелом не парит. Под обездвиживанием и «В воздухе» ввод уже без прыжка.
 */
const LIGHTNESS: MoveHooks = Object.freeze({
  before(u: Unit, t: TickCtx, inp: PlayerInput): void {
    const mv = u.move;
    const f = u.mage!.flight;
    const inAir = !mv.onGround && !(mv.coyote > 0);
    if (inAir && inp.jump && !mv.jumpHeld && !f.doubleJumped) {
      mv.body.vel.y = DOUBLE_JUMP_SPEED;
      f.doubleJumped = true;
      mv.jumpHeld = true; // нажатие потрачено: иначе stepPlayer запомнит его в буфер прыжка
      t.ev.push({ type: "airJump", unit: u.id, pos: copy(mv.body.pos) });
    }
    setGlide(t, u, f.doubleJumped && inp.jump && !mv.onGround && mv.body.vel.y < 0 && f.glideTicks < GLIDE_TICKS);
  },
  params(u: Unit, _t: TickCtx, _inp: PlayerInput, p: MoveParams): MoveParams {
    return u.mage!.flight.gliding ? { ...p, airControl: LI.glideAirControl, maxFallSpeed: LI.glideFallSpeed } : p;
  },
  after(u: Unit, t: TickCtx): void {
    const f = u.mage!.flight;
    if (f.gliding) f.glideTicks += 1;
    if (!u.move.onGround) return;
    f.doubleJumped = false;
    f.glideTicks = 0;
    setGlide(t, u, false);
  },
});

// ---------------------------------------------------------------- кит

function release(t: TickCtx, u: Unit, ability: "airSickle" | "gust", projectile: number, aim: { eye: Vec3; dir: Vec3 }): void {
  t.ev.push({ type: "release", unit: u.id, ability, projectile, pos: copy(aim.eye), dir: copy(aim.dir) });
}

/** ЛКМ: серп, пока зажата (или нажатие ждёт в буфере) и готова; в замахе Порыва — «замах» (ждёт в буфере). */
function sickle(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < m.ready.primary) return "cooldown";
  if (m.windup) return "busy";
  m.ready.primary = now + SICKLE_TICKS;
  const aim = castAim(u, inp);
  const id = spawnProjectile(s, t, u.id, "airSickle", aim.eye, aim.dir);
  emitCast(t, u, "airSickle", "primary", aim);
  release(t, u, "airSickle", id, aim);
  return null;
}

/** Q: замах 0,4 с (и в воздухе, и во время Взмаха); удар — в tick на releaseTick по взгляду того тика. */
function gust(_s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < m.ready.q) return "cooldown";
  if (m.windup) return "busy";
  m.ready.q = now + GUST_CD;
  m.windup = { ability: "gust", slot: "q", releaseTick: now + GUST_WINDUP_TICKS };
  emitCast(t, u, "gust", "q", castAim(u, inp));
  return null;
}

/** Точка (x, z) в конусе Порыва из (ox, oz) по взгляду f: не дальше reach и не дальше 30° от взгляда. */
function inCone(ox: number, oz: number, f: { x: number; z: number }, x: number, z: number, reach: number): boolean {
  const dx = x - ox;
  const dz = z - oz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > reach) return false;
  return d < 1e-9 || dx * f.x + dz * f.z >= GUST_COS * d;
}

/** Свободен ли луч "shot" от a до b: камень и рельеф закрывают, Стена огня и пар — нет. */
function clearShot(t: TickCtx, a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return len < 1e-9 || raycast(t.world, a, { x: dx / len, y: dy / len, z: dz / len }, len, "shot") === null;
}

/**
 * Выпуск Порыва (Р12): конус по взгляду этого тика. Цель — живой не-хозяин, центр тела по XZ не дальше 7 м + полтела,
 * не дальше 30° от взгляда, подошвы по высоте не дальше 2,5 м, свободный луч "shot" от глаз до центра тела:
 * 10 урона, толчок {7, 1} по взгляду, удар о стену +20. Чужие снаряды в конусе (по XZ до 7 м, 30°, по высоте 2,5 м от
 * середины тела мага) сдуваются без взрыва — событие blown. Взведённая Стена огня в конусе — «Огненный вал» (rampart).
 */
function releaseGust(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
  const look = sanitizeInput(inp, u.move);
  const aim = castAim(u, inp);
  const fw = forwardXZ(look.yaw);
  const f = { x: fw.x + 0, z: fw.z + 0 };
  const b = u.move.body;
  release(t, u, "gust", NO_PROJECTILE, aim);
  for (const v of s.units) {
    if (!v.alive || v.id === u.id) continue;
    const vb = v.move.body;
    if (Math.abs(vb.pos.y - b.pos.y) > GU.halfHeightM || !inCone(b.pos.x, b.pos.z, f, vb.pos.x, vb.pos.z, GU.rangeM + vb.halfW)) continue;
    const c = bodyCenter(v);
    if (!clearShot(t, aim.eye, c)) continue;
    applyHit(s, t, {
      source: u.id, target: v.id, ability: "gust", damage: GU.damage, pos: c, dir: f,
      knock: { distM: GU.knockback.distM, upM: GU.knockback.upM }, slam: GU.slamDamage,
    });
  }
  rampart(s, t, u, f, aim.eye);
  const midY = b.pos.y + b.height / 2;
  s.projectiles = s.projectiles.filter((p) => {
    if (p.owner === u.id || Math.abs(p.pos.y - midY) > GU.halfHeightM || !inCone(b.pos.x, b.pos.z, f, p.pos.x, p.pos.z, GU.rangeM)) return true;
    t.ev.push({ type: "blown", unit: u.id, projectile: p.id, kind: p.ability, owner: p.owner, pos: copy(p.pos) });
    return false;
  });
}

/**
 * Задевает ли конус Порыва из подошвы b бокс Стены огня: по высоте бокс пересекает ±2,5 м от подошвы, а по XZ
 * в конусе (7 м, 30°) хоть одна проба средней линии стены (через 0,25 м по длинной стороне) или ближайшая к магу точка.
 */
function gustTouchesBox(b: Vec3, f: { x: number; z: number }, box: AABB): boolean {
  if (box.max.y < b.y - GU.halfHeightM || box.min.y > b.y + GU.halfHeightM) return false;
  const nx = Math.max(box.min.x, Math.min(box.max.x, b.x));
  const nz = Math.max(box.min.z, Math.min(box.max.z, b.z));
  if (inCone(b.x, b.z, f, nx, nz, GU.rangeM)) return true;
  const alongX = box.max.x - box.min.x >= box.max.z - box.min.z;
  const len = alongX ? box.max.x - box.min.x : box.max.z - box.min.z;
  const n = Math.ceil(len / WALL_SAMPLE_M);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (let k = 0; k <= n; k++) {
    const a = Math.min(len, k * WALL_SAMPLE_M);
    const x = alongX ? box.min.x + a : cx;
    const z = alongX ? cz : box.min.z + a;
    if (inCone(b.x, b.z, f, x, z, GU.rangeM)) return true;
  }
  return false;
}

/** Ближайшая к точке p точка бокса. */
function closestOnBox(p: Vec3, box: AABB): Vec3 {
  return {
    x: Math.max(box.min.x, Math.min(box.max.x, p.x)),
    y: Math.max(box.min.y, Math.min(box.max.y, p.y)),
    z: Math.max(box.min.z, Math.min(box.max.z, p.z)),
  };
}

/**
 * «Огненный вал» (GDD 4.6, round3/02-air.md): Порыв задел взведённую Стену огня — стена переходит к Воздуху (его эффект
 * пришёл вторым; adoptZone) и за 1 с едет на 8 м по взгляду (drift, ход — driveWall в zones.ts), доживая свой срок.
 * Как и тела в конусе, стену нужно видеть: свободный луч "shot" от глаз до ближайшей точки её бокса (за камнем — нет).
 * Своя стена этого мага, ещё едущая (drift), не толкается заново и второй реакции не даёт.
 * Касание и Горение — прежние, уже за Воздуха. Новой зоны нет. Событие reaction {kind: "fireRampart"} — у середины низа стены.
 */
function rampart(s: MatchState, t: TickCtx, u: Unit, f: { x: number; z: number }, eye: Vec3): void {
  for (const q of [...s.zones]) {
    if (q.kind !== "fireWall" || q.shape.type !== "box" || t.now < q.armTick || !s.zones.includes(q)) continue;
    if (q.owner === u.id && q.drift && t.now < q.drift.untilTick) continue;
    const box = q.shape.box;
    if (!gustTouchesBox(u.move.body.pos, f, box) || !clearShot(t, eye, closestOnBox(eye, box))) continue;
    adoptZone(s, t, q, u.id);
    q.drift = { x: f.x * RAMPART_STEP_M + 0, z: f.z * RAMPART_STEP_M + 0, untilTick: t.now + RAMPART_TICKS };
    const pos = { x: (box.min.x + box.max.x) / 2, y: box.min.y, z: (box.min.z + box.max.z) / 2 };
    t.ev.push({ type: "reaction", kind: "fireRampart", owner: u.id, zone: q.id, pos });
  }
}

/**
 * E: 8 м за 0,2 с по вводу движения (без ввода — вперёд), с пола и в воздухе, на двух зарядах по 6 с (Р13).
 * Замах Порыва не мешает; обездвиживание и «В воздухе» — мешают. Гасит свой толчок и обрывает буксир (startDash).
 * Нажатие во время своего рывка ждёт его конца в буфере (рывок 12 тиков короче окна 18): два Взмаха идут подряд.
 */
function swoop(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < u.status.rootUntil || now < u.status.noControlUntil) return "rooted";
  if (m.dash) return "cooldown"; // ready.e — now, пока заряд есть: нажатие ждёт, а не отказывает
  if (!spendCharge(t, u, "e", SWOOP_CHARGE_TICKS)) return "cooldown";
  startDash(s, t, u, inp, SWOOP);
  emitCast(t, u, "swoop", "e", castAim(u, inp));
  dashStarted(t, u);
  return null;
}

/** C: вихрь в точке под прицелом до 20 м; растёт 0,5 с (телеграф), живёт 4 с. Над пустотой — «нет цели». */
function tornado(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < m.ready.c) return "cooldown";
  if (m.windup) return "busy";
  const look = sanitizeInput(inp, u.move);
  const at = aimGround(s, t, u.id, look.yaw, look.pitch, TO.rangeM);
  if (!at) return "noTarget";
  const arm = now + TORNADO_GROW_TICKS;
  spawnZone(s, t, {
    owner: u.id, kind: "tornado", ability: "tornado", shape: { type: "disc", center: at, radius: TO.radiusM },
    bornTick: now, armTick: arm, endTick: arm + TORNADO_LIFE_TICKS,
  });
  m.ready.c = now + TORNADO_CD;
  emitCast(t, u, "tornado", "c", castAim(u, inp));
  return null;
}

/** Точка зоны для «Урагана»: центр диска, середина отрезка, центр бокса. */
function zonePoint(z: Zone): Vec3 {
  const sh = z.shape;
  if (sh.type === "disc") return copy(sh.center);
  if (sh.type === "segment") return { x: (sh.a.x + sh.b.x) / 2, y: (sh.a.y + sh.b.y) / 2, z: (sh.a.z + sh.b.z) / 2 };
  const b = sh.box;
  return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
}

/**
 * Выпуск «Урагана» (Р8 фазы 5) на releaseTick каста; центр C — центр тела Воздуха на этом тике. Без луча: ветер
 * огибает укрытия.
 * 1. Цели — живые не-хозяева, центр тела по XZ не дальше 10 м от C и по высоте не дальше 4 м: 60 урона, толчок от C
 *    по XZ (ровно в центре — по взгляду) 16 м у центра → ×0,5 на краю, 2 м вверх и «В воздухе» (launch; ульта — порог
 *    ×1,5, Р4). Земля, иммунитет и якорь — по общим правилам applyHit.
 * 2. Чужие снаряды в сфере 10 м от C сдуваются без взрыва — событие blown, как у Порыва.
 * 3. Чужие зоны, у которых точка (центр диска, середина отрезка, центр бокса) по XZ не дальше 10 м от C и по высоте
 *    не дальше 4 м, уходят (zone/end).
 * 4. Чужой рельеф, бокс которого по XZ ближе 10 м к C, ломается (урон 1000).
 * 5. Воздух взлетает на 3 м и получает свежие 3 с парения: второй прыжок считается потраченным, и зажатый прыжок
 *    при падении сразу парит. Окно «койота» закрыто: прыжок на этом тике не заменит взлёт обычным прыжком.
 */
function releaseHurricane(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
  const c = bodyCenter(u);
  const fw = forwardXZ(sanitizeInput(inp, u.move).yaw);
  for (const v of s.units) {
    if (!v.alive || v.id === u.id) continue;
    const vc = bodyCenter(v);
    const dx = vc.x - c.x;
    const dz = vc.z - c.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > HU.radiusM || Math.abs(vc.y - c.y) > HU.halfHeightM) continue;
    const dir = d < 1e-9 ? { x: fw.x + 0, z: fw.z + 0 } : { x: dx / d + 0, z: dz / d + 0 };
    const distM = HU.knockback.distM * (1 - ((1 - HU.edgeKnockMul) * d) / HU.radiusM);
    applyHit(s, t, {
      source: u.id, target: v.id, ability: "hurricane", damage: HU.damage, pos: vc, dir,
      knock: { distM, upM: HU.knockback.upM }, launch: true,
    });
  }
  s.projectiles = s.projectiles.filter((p) => {
    const dx = p.pos.x - c.x;
    const dy = p.pos.y - c.y;
    const dz = p.pos.z - c.z;
    if (p.owner === u.id || dx * dx + dy * dy + dz * dz > HU.radiusM * HU.radiusM) return true;
    t.ev.push({ type: "blown", unit: u.id, projectile: p.id, kind: p.ability, owner: p.owner, pos: copy(p.pos) });
    return false;
  });
  for (const q of [...s.zones]) {
    if (q.owner === u.id) continue;
    const p = zonePoint(q);
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    if (Math.sqrt(dx * dx + dz * dz) > HU.radiusM || Math.abs(p.y - c.y) > HU.halfHeightM) continue;
    endZone(s, t, q);
  }
  for (const tr of [...s.terrain]) {
    if (tr.owner === u.id) continue;
    const p = closestOnBox(c, tr.box);
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    if (Math.sqrt(dx * dx + dz * dz) >= HU.radiusM) continue;
    damageTerrain(s, t, tr.id, HU.terrainDamage, p);
  }
  const mv = u.move;
  setGlide(t, u, false);
  mv.body.vel.y = Math.max(mv.body.vel.y, HURRICANE_LIFT_SPEED);
  mv.onGround = false;
  mv.coyote = 0;
  u.mage!.flight = { doubleJumped: true, glideTicks: 0, gliding: false };
}

/** Слоты Воздуха для castSlots: он же держит буфер нажатий и пишет отказы. X — замах «Урагана» (ult.ts), удар — в tick. */
const AIR_CASTS: Readonly<Record<Slot, TryCast>> = Object.freeze({
  primary: sickle, q: gust, e: swoop, c: tornado,
  x: (_s: MatchState, t: TickCtx, u: Unit, inp: MatchInput) => startUlt(t, u, inp, "hurricane"),
});

export const AIR_KIT: Kit = Object.freeze({
  input(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, pressed: Buttons): void {
    // Заряды Взмаха — до каста: вернувшийся на этом тике заряд можно потратить сразу.
    refillCharges(t, u, "e", SW.charges, SWOOP_CHARGE_TICKS);
    castSlots(s, t, u, inp, pressed, AIR_CASTS);
  },

  tick(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
    const m = u.mage!;
    // В рывке и на буксире хуки движения не идут: парение снимаем здесь, чтобы толчок не считал мага парящим.
    if (m.dash || u.tow) setGlide(t, u, false);
    if (m.windup && t.now >= m.windup.releaseTick) {
      m.windup = null;
      releaseGust(s, t, u, inp);
    }
    if (m.dash) stepDash(s, t, u, inp, SWOOP);
    const uc = m.ult.cast;
    if (uc && uc.ability === "hurricane" && t.now === uc.releaseTick) releaseHurricane(s, t, u, inp);
  },
});

// ---------------------------------------------------------------- Смерч

/** Расстояние по XZ от подошвы юнита до центра вихря, если подошва в его цилиндре (5 м, от −0,5 до +4 м); иначе −1. */
function inVortex(c: Vec3, radius: number, v: Unit): number {
  const p = v.move.body.pos;
  if (p.y < c.y - TO.belowM || p.y > c.y + TO.aboveM) return -1;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  return d <= radius ? d : -1;
}

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

/** Пересекает ли Стена огня (бокс) или след рывка (полоса) диск вихря: по XZ ближе радиуса, по высоте — в его росте. */
function crossesDisc(q: Zone, c: Vec3, radius: number): boolean {
  const lo = c.y - TO.belowM;
  const hi = c.y + TO.aboveM;
  if (q.shape.type === "box") {
    const bx = q.shape.box;
    if (bx.max.y < lo || bx.min.y > hi) return false;
    const dx = Math.max(bx.min.x, Math.min(bx.max.x, c.x)) - c.x;
    const dz = Math.max(bx.min.z, Math.min(bx.max.z, c.z)) - c.z;
    return dx * dx + dz * dz < radius * radius;
  }
  if (q.shape.type === "segment") {
    const { a, b, halfW } = q.shape;
    if (Math.max(a.y, b.y) < lo || Math.min(a.y, b.y) > hi) return false;
    return distXZToSegment(c, a, b) < radius + halfW;
  }
  return false;
}

/**
 * «Огненный смерч» (Р10): взведённый вихрь загорается, если в этот тик взорвался огненный шар не дальше 3 м от края
 * диска (по событию explosion тика), или его пересекает взведённая Стена огня или след рывка. Хозяин — тот, чей эффект
 * пришёл вторым: у взрыва — хозяин шара; у стены и следа — их хозяин, если они родились позже вихря, иначе прежний.
 * Стена и след поглощаются (zone/end). Событие reaction.
 */
function ignite(s: MatchState, t: TickCtx, z: Zone): void {
  if (z.shape.type !== "disc") return;
  const c = z.shape.center;
  const r = z.shape.radius;
  let owner: number | null = null;
  for (const e of t.ev) {
    if (e.type !== "explosion" || e.ability !== "fireball") continue;
    const dx = e.pos.x - c.x;
    const dz = e.pos.z - c.z;
    if (Math.sqrt(dx * dx + dz * dz) > r + TO.fireReachM || Math.abs(e.pos.y - c.y) > FIRE_REACH_DY_M) continue;
    owner = e.owner;
    break;
  }
  if (owner === null) {
    for (const q of s.zones) {
      if ((q.kind !== "fireWall" && q.kind !== "fireTrail") || t.now < q.armTick || !crossesDisc(q, c, r)) continue;
      owner = q.bornTick > z.bornTick ? q.owner : z.owner;
      endZone(s, t, q);
      break;
    }
  }
  if (owner === null) return;
  // отметки повторов старого и нового хозяина меняют смысл (подъём ↔ импульс огня) — сбрасываем их
  const was = z.owner;
  z.rehit = z.rehit.filter((q) => q.unit !== was && q.unit !== owner);
  z.kind = "fireTornado";
  z.owner = owner;
  t.ev.push({ type: "reaction", kind: "fireTornado", owner, zone: z.id, pos: copy(c) });
}

/** Диск зоны (землетрясение) задевает цилиндр вихря: по XZ ближе суммы радиусов, центр по высоте в цилиндре. */
function discMeetsVortex(q: Zone, c: Vec3, radius: number): boolean {
  if (q.shape.type !== "disc") return false;
  const p = q.shape.center;
  if (p.y < c.y - TO.belowM || p.y > c.y + TO.aboveM) return false;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  return Math.sqrt(dx * dx + dz * dz) < radius + q.shape.radius;
}

/** Точка в цилиндре вихря: по XZ до радиуса, по высоте от belowM под центром до aboveM над ним. */
function pointInVortex(p: Vec3, c: Vec3, radius: number): boolean {
  if (p.y < c.y - TO.belowM || p.y > c.y + TO.aboveM) return false;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  return Math.sqrt(dx * dx + dz * dz) <= radius;
}

/**
 * «Песчаный смерч» (GDD 4.6, round3/02-air.md): взведённый вихрь набирает песок, если в его цилиндре летит камень Земли
 * (или камень в этот тик ударился в цилиндре — по событию impact), или его задевает взведённый столб, землетрясение
 * либо каменная стена/столб-препятствие. Хозяин — тот, чей эффект пришёл вторым: у камня — его хозяин; у столба,
 * землетрясения и стены — их хозяин, если они родились позже вихря, иначе прежний. Камень и камень-препятствия
 * не поглощаются. Вихрь шире на SAND_TORNADO.radiusBonusM. Событие reaction {kind: "sandTornado"}.
 */
function sandUp(s: MatchState, t: TickCtx, z: Zone): void {
  if (z.shape.type !== "disc") return;
  const c = z.shape.center;
  const r = z.shape.radius;
  let owner: number | null = null;
  for (const p of s.projectiles) {
    if (p.ability !== "stoneShot" || !pointInVortex(p.pos, c, r)) continue;
    owner = p.owner;
    break;
  }
  if (owner === null) {
    for (const e of t.ev) {
      if (e.type !== "impact" || e.ability !== "stoneShot" || !pointInVortex(e.pos, c, r)) continue;
      owner = e.owner;
      break;
    }
  }
  if (owner === null) {
    for (const q of s.zones) {
      if ((q.kind !== "pillar" && q.kind !== "quake") || t.now < q.armTick) continue;
      if (!(q.kind === "quake" ? discMeetsVortex(q, c, r) : crossesDisc(q, c, r))) continue;
      owner = q.bornTick > z.bornTick ? q.owner : z.owner;
      break;
    }
  }
  if (owner === null) {
    for (const tr of s.terrain) {
      if (!tr.solid) continue;
      const bx = tr.box;
      if (bx.max.y < c.y - TO.belowM || bx.min.y > c.y + TO.aboveM) continue;
      const dx = Math.max(bx.min.x, Math.min(bx.max.x, c.x)) - c.x;
      const dz = Math.max(bx.min.z, Math.min(bx.max.z, c.z)) - c.z;
      if (dx * dx + dz * dz >= r * r) continue;
      owner = tr.bornTick > z.bornTick ? tr.owner : z.owner;
      break;
    }
  }
  if (owner === null) return;
  const was = z.owner;
  z.rehit = z.rehit.filter((q) => q.unit !== was && q.unit !== owner);
  z.kind = "sandTornado";
  z.owner = owner;
  z.shape = { type: "disc", center: copy(c), radius: r + SAND_TORNADO.radiusBonusM };
  t.ev.push({ type: "reaction", kind: "sandTornado", owner, zone: z.id, pos: copy(c) });
}

/** Тяга на шаг к центру отдельным moveBody, как канал толчка: своя скорость тела не меняется. */
function pullStep(t: TickCtx, v: Unit, c: Vec3, d: number, step: number): void {
  const b = v.move.body;
  const own = b.vel;
  b.vel = { x: ((c.x - b.pos.x) / d) * (step / TICK_DT), y: 0, z: ((c.z - b.pos.z) / d) * (step / TICK_DT) };
  const r = moveBody(t.world, b, TICK_DT, v.move.onGround);
  b.vel = own;
  if (!r.onGround) v.move.onGround = false; // стянуло с края — следующий stepPlayer уже в воздухе
}

/**
 * Шаг вихря после взвода (Смерч, «Огненный» и «Песчаный смерч»): реакции (только у обычного) → тяга → импульсы → ядро.
 * - Тяга: живые не-хозяева без рывка, буксира и защиты после появления в цилиндре (парящие тоже) — к центру
 *   2,5 × pullMul м/с, не дальше центра.
 * - Импульсы: каждому в цилиндре раз в 0,5 с (rehit) — 4 урона по времени; у огненного — 8 и Горение; у песчаного —
 *   ещё замедление SAND_TORNADO.
 * - Ядро 1,5 м: не-хозяина подбрасывает на 3 м (launchUnit: не чаще иммунитета, сброс — хозяину вихря); хозяина на
 *   полу поднимает на 2 м без урона и статуса, раз в 1 с (запись rehit хозяина) — уйти парением.
 */
const stepVortex: ZoneStep = (s, t, z) => {
  if (z.shape.type !== "disc") return;
  if (z.kind === "tornado") ignite(s, t, z);
  if (z.kind === "tornado") sandUp(s, t, z);
  if (z.shape.type !== "disc") return;
  const now = t.now;
  const c = z.shape.center;
  const r = z.shape.radius;
  const fire = z.kind === "fireTornado";
  const sand = z.kind === "sandTornado";
  for (const v of s.units) {
    // защищённого после появления не тянет, как не бьёт applyHit и не подбрасывает launchUnit
    if (!v.alive || v.id === z.owner || v.tow || (v.mage?.dash ?? null) || now < v.status.shieldUntil) continue;
    const d = inVortex(c, r, v);
    const k = pullMul(v, now);
    if (d < 1e-9 || !(k > 0)) continue;
    pullStep(t, v, c, d, Math.min(d, TO.pullSpeed * k * TICK_DT));
  }
  for (const v of s.units) {
    if (!v.alive || v.id === z.owner || inVortex(c, r, v) < 0) continue;
    const rec = z.rehit.find((q) => q.unit === v.id);
    if (rec && rec.tick > now) continue;
    applyHit(s, t, {
      source: z.owner, target: v.id, ability: z.ability, damage: fire ? TO.firePulseDamage : TO.pulseDamage, pos: bodyCenter(v), dir: { x: 0, z: 0 },
      burn: fire, dot: true, slow: sand ? { mul: SAND_TORNADO.slowMul, s: SAND_TORNADO.slowS } : undefined,
    });
    if (rec) rec.tick = now + PULSE_TICKS;
    else z.rehit.push({ unit: v.id, tick: now + PULSE_TICKS });
  }
  for (const v of s.units) {
    if (!v.alive) continue;
    const d = inVortex(c, r, v);
    if (d < 0 || d > TO.coreRadiusM) continue;
    // в рывке и на буксире вертикаль ведёт не ядро: подброс пропал бы, а иммунитет или слот подъёма потратился бы
    if (v.tow || (v.mage?.dash ?? null)) continue;
    if (v.id !== z.owner) {
      launchUnit(s, t, v.id, TO.coreLiftM, z.owner);
      continue;
    }
    const rec = z.rehit.find((q) => q.unit === v.id);
    if (!v.move.onGround || (rec && rec.tick > now)) continue;
    v.move.body.vel.y = Math.max(v.move.body.vel.y, OWNER_LIFT_SPEED);
    v.move.onGround = false;
    v.move.coyote = 0; // поднятый ядром уже в воздухе: следующее нажатие — второй прыжок, а не «койот»
    if (rec) rec.tick = now + OWNER_LIFT_TICKS;
    else z.rehit.push({ unit: v.id, tick: now + OWNER_LIFT_TICKS });
  }
};

/** Воздух «Свобода» (round3/02-air.md): кит, «Лёгкость» и шаги вихрей. */
export const AIR_SIM: ElementSim = Object.freeze({
  kit: AIR_KIT,
  move: LIGHTNESS,
  zones: Object.freeze({ tornado: stepVortex, fireTornado: stepVortex, sandTornado: stepVortex }),
});
