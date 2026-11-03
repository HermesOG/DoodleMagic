import { sanitizeInput } from "../player";
import { TICK_DT, type Vec3 } from "../types";
import { aimGround } from "./aim";
import { dashStarted, endDash, startDash, stepDash, type DashSpec } from "./dash";
import { FIRE, slotCooldownTicks, ticks } from "./defs";
import { castAim, castSlots, emitCast, snappedWallBox, type Kit, type TryCast } from "./kit";
import { spawnProjectile } from "./projectiles";
import type { Buttons, MatchInput, MatchState, RejectReason, Slot, TickCtx, Unit } from "./types";
import { spawnZone } from "./zones";

/**
 * Кит Огня «Напор» (GDD 4.3; решения Р5, Р14, Р15): ЛКМ «Огненные кулаки» с жаром и мягким перегревом,
 * Q «Огненный шар» с замахом, E «Реактивный рывок» со следом (и в воздухе), C «Стена огня». «Кураж» — в combat.ts.
 * Каждый принятый каст — событие cast на тике, когда он принят: на нажатии или позже, когда нажатие выходит из буфера
 * (castSlots, до 0,3 с); перезарядка ставится там же (Р14).
 */

const FF = FIRE.fireFists;
const H = FIRE.heat;
const JD = FIRE.jetDash;
const FW = FIRE.fireWall;

const FIST_TICKS = slotCooldownTicks("fire", "primary"); // 12
const FIST_HOT_TICKS = ticks(1 / (FF.ratePerS * H.overheatRateMul)); // 24
const OVERHEAT_TICKS = ticks(H.overheatS); // 90
const COOL_DELAY_TICKS = ticks(H.coolDelayS); // 18
const FIREBALL_WINDUP_TICKS = ticks(FIRE.fireball.windupS); // 15
const FIREBALL_CD = slotCooldownTicks("fire", "q"); // 480
const DASH_CD = slotCooldownTicks("fire", "e"); // 480
const TRAIL_TICKS = ticks(JD.trailS); // 120
const WALL_CD = slotCooldownTicks("fire", "c"); // 720
const WALL_TELEGRAPH_TICKS = ticks(FW.telegraphS); // 24
const WALL_LIFE_TICKS = ticks(FW.lifeS); // 300
/** Реактивный рывок (A6 фазы 4): 8 м за 0,2 с, ≈ 62 → 18 м/с по тикам, на выходе 9 м/с, след 2 с. */
export const FIRE_DASH: Readonly<DashSpec> = Object.freeze({
  ability: "jetDash", distM: JD.distM, durationS: JD.durationS, profile: JD.profile, exitSpeed: JD.exitSpeed,
  trail: Object.freeze({ halfWidthM: JD.trailHalfWidthM, lifeS: JD.trailS }),
});

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

function release(t: TickCtx, u: Unit, ability: "fireFists" | "fireball", projectile: number, aim: { eye: Vec3; dir: Vec3 }): void {
  t.ev.push({ type: "release", unit: u.id, ability, projectile, pos: copy(aim.eye), dir: copy(aim.dir) });
}

/**
 * ЛКМ: стреляет, пока зажата (или нажатие ждёт в буфере) и готова. Жар +8 за выстрел; на 100 — перегрев на 1,5 с:
 * темп ×0,5, выстрелы не греют (Р5). Отказы разбирает castSlots: удержание молчит, нажатие ждёт в буфере.
 */
function fists(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < m.ready.primary) return "cooldown";
  if (m.windup) return "busy";
  m.lastShotTick = now;
  let overheat = false;
  if (now >= m.overheatUntil) {
    m.heat = Math.min(H.max, m.heat + H.perShot);
    if (m.heat >= H.max) {
      m.overheatUntil = now + OVERHEAT_TICKS;
      overheat = true;
    }
  }
  // выстрел, включивший перегрев, уже ставит половинный темп
  m.ready.primary = now + (now < m.overheatUntil ? FIST_HOT_TICKS : FIST_TICKS);
  const aim = castAim(u, inp);
  const id = spawnProjectile(s, t, u.id, "fireFists", aim.eye, aim.dir);
  emitCast(t, u, "fireFists", "primary", aim);
  release(t, u, "fireFists", id, aim);
  if (overheat) t.ev.push({ type: "overheat", unit: u.id, on: true });
  return null;
}

/** Q: замах 0,25 с, шар вылетает в tick на releaseTick по прицелу того тика. */
function fireball(_s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < m.ready.q) return "cooldown";
  if (m.windup) return "busy";
  m.ready.q = now + FIREBALL_CD;
  m.windup = { ability: "fireball", slot: "q", releaseTick: now + FIREBALL_WINDUP_TICKS };
  emitCast(t, u, "fireball", "q", castAim(u, inp));
  return null;
}

/**
 * E: 8 м за 0,2 с по вводу движения (без ввода — вперёд), и в воздухе (dash.ts, профиль A6). Замах не мешает (Р14),
 * обездвиживание и «В воздухе» — мешают. Гасит своё отбрасывание (Р15) и обрывает буксир (Р22 фазы 4).
 * След — отрезок от старта, его конец тянется за магом.
 */
function jetDash(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < u.status.rootUntil || now < u.status.noControlUntil) return "rooted";
  if (now < m.ready.e) return "cooldown";
  // «Кураж» перезарядил E посреди рывка: прежний рывок кончается здесь, его след догорает 2 с
  if (m.dash) endDash(s, t, u, FIRE_DASH, now + TRAIL_TICKS);
  m.ready.e = now + DASH_CD;
  startDash(s, t, u, inp, FIRE_DASH);
  emitCast(t, u, "jetDash", "e", castAim(u, inp));
  dashStarted(t, u);
  return null;
}

/** C: стена 10 × 2,5 м поперёк взгляда под прицелом до 15 м (Р6, Р9); искры 0,4 с, горит 5 с. Над пустотой — отказ. */
function fireWall(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (now < m.ready.c) return "cooldown";
  if (m.windup) return "busy";
  const look = sanitizeInput(inp, u.move);
  const at = aimGround(s, t, u.id, look.yaw, look.pitch, FW.rangeM);
  if (!at) return "noTarget";
  const box = snappedWallBox(at, look.yaw, FW.lengthM, FW.thickM, FW.heightM);
  spawnZone(s, t, {
    owner: u.id, kind: "fireWall", ability: "fireWall", shape: { type: "box", box },
    bornTick: now, armTick: now + WALL_TELEGRAPH_TICKS, endTick: now + WALL_TELEGRAPH_TICKS + WALL_LIFE_TICKS,
  });
  m.ready.c = now + WALL_CD;
  emitCast(t, u, "fireWall", "c", castAim(u, inp));
  return null;
}

/** Слоты Огня для castSlots: он же держит буфер нажатий и пишет отказы. */
const FIRE_CASTS: Readonly<Record<Slot, TryCast>> = Object.freeze({ primary: fists, q: fireball, e: jetDash, c: fireWall });

export const FIRE_KIT: Kit = Object.freeze({
  input(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, pressed: Buttons): void {
    const m = u.mage!;
    // Конец перегрева — до выстрела: выстрел этого тика уже снова греет.
    if (m.overheatUntil > 0 && t.now >= m.overheatUntil) {
      m.heat = 0;
      m.overheatUntil = 0;
      t.ev.push({ type: "overheat", unit: u.id, on: false });
    }
    castSlots(s, t, u, inp, pressed, FIRE_CASTS);
  },

  tick(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
    const m = u.mage!;
    const now = t.now;
    if (m.windup && now >= m.windup.releaseTick) {
      const aim = castAim(u, inp);
      release(t, u, "fireball", spawnProjectile(s, t, u.id, "fireball", aim.eye, aim.dir), aim);
      m.windup = null;
    }
    // Жар (Р5): в перегреве — линейно от 100 до 0 по оставшемуся времени; иначе остывает 35/с через 0,3 с без выстрела.
    if (now < m.overheatUntil) m.heat = (H.max * (m.overheatUntil - now)) / OVERHEAT_TICKS;
    else if (now - m.lastShotTick > COOL_DELAY_TICKS) m.heat = Math.max(0, m.heat - H.coolPerS * TICK_DT);
    if (m.dash) stepDash(s, t, u, inp, FIRE_DASH);
  },
});
