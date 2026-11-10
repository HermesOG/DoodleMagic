import type { Vec3 } from "../types";
import { ULT_CHARGE, ULT_TIMING, isUlt, ticks } from "./defs";
import { castAim, emitCast } from "./kit";
import { aimDir, eyeOf, idleInput, unitById } from "./state";
import { NOBODY, type DamageSource, type Element, type MatchInput, type MatchState, type RejectReason, type TickCtx, type UltId, type Unit, type UnitId } from "./types";

/**
 * Ульта на X (GDD 3; Р1–Р3 фазы 5): заряд, начало и конец каста, события ult. Что ульта делает — в файле своей стихии:
 * её кит видит m.ult.cast (телеграф до releaseTick, действие до endTick) и шагает в своём tick.
 * Функции меняют состояние на месте, как киты, и пишут события в t.ev.
 */

/** Ульта стихии (слот X). */
const ULT_OF: Readonly<Record<Element, UltId>> = Object.freeze({ fire: "dragonBreath", earth: "tectonicRift", air: "hurricane", water: "tsunami" });
const PASSIVE_TICKS = ticks(ULT_CHARGE.passiveEveryS); // 360
const ASSIST_TICKS = ticks(ULT_CHARGE.assistS); // 300
/** Дробный заряд: ближе этого к 100 — уже 100 (сумма дробей 1/15 не должна застрять на 99,999…). */
const FULL_EPS = 1e-9;

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

function emitUlt(t: TickCtx, u: Unit, ability: UltId, phase: "ready" | "release" | "end", aim: { eye: Vec3; dir: Vec3 }): void {
  t.ev.push({ type: "ult", unit: u.id, ability, phase, pos: copy(aim.eye), dir: copy(aim.dir) });
}

/** Прибавить заряд: points × t.ultChargeMul, не выше 100; переход через 100 — событие ult/ready. Мёртвым тоже (Р2). */
export function gainUlt(t: TickCtx, u: Unit, points: number): void {
  const m = u.mage;
  if (!m || !(points > 0) || m.ult.charge >= ULT_CHARGE.max) return;
  const next = m.ult.charge + points * t.ultChargeMul;
  m.ult.charge = next >= ULT_CHARGE.max - FULL_EPS ? ULT_CHARGE.max : next;
  if (m.ult.charge < ULT_CHARGE.max) return;
  emitUlt(t, u, ULT_OF[m.element], "ready", { eye: eyeOf(u), dir: aimDir(u.move.yaw, u.move.pitch) });
}

/**
 * Зовёт applyHit после HP: источнику-магу amount/15 (не за урон ульт: ульта не перезаряжает сама себя), цели-магу
 * amount/30; запись hitters цели — для помощи (записи старше 5 с уходят).
 */
export function ultOnDamage(t: TickCtx, src: Unit | undefined, target: Unit, ability: DamageSource, amount: number): void {
  if (!(amount > 0)) return;
  if (src && src.id !== target.id && !isUlt(ability)) gainUlt(t, src, amount / ULT_CHARGE.dealtPer);
  gainUlt(t, target, amount / ULT_CHARGE.takenPer);
  if (!src || src.id === target.id) return;
  const now = t.now;
  const rest = target.hitters.filter((h) => h.unit !== src.id && now - h.tick <= ASSIST_TICKS);
  rest.push({ unit: src.id, tick: now });
  target.hitters = rest;
}

/**
 * Убийство (applyHit) или засчитанный сброс (units.ts): убийце +6; каждому из hitters цели за ≤ 300 тиков, кроме убийцы
 * и цели, +3; hitters = [].
 */
export function ultOnKill(s: MatchState, t: TickCtx, victim: Unit, killer: UnitId): void {
  const k = killer !== NOBODY && killer !== victim.id ? unitById(s, killer) : undefined;
  if (k) gainUlt(t, k, ULT_CHARGE.kill);
  for (const h of victim.hitters) {
    if (h.unit === killer || h.unit === victim.id || t.now - h.tick > ASSIST_TICKS) continue;
    const a = unitById(s, h.unit);
    if (a) gainUlt(t, a, ULT_CHARGE.assist);
  }
  victim.hitters = [];
}

/**
 * TryCast слота X стихии: заряд < 100 → "uncharged" (castSlots отказывает сразу, без буфера); замах, рывок, диск или
 * идёт ульта → "busy"; иначе весь заряд тратится, cast по ULT_TIMING, событие cast (слот "x"), null.
 */
export function startUlt(t: TickCtx, u: Unit, inp: MatchInput, ability: UltId): RejectReason | null {
  const m = u.mage!;
  const now = t.now;
  if (m.ult.charge < ULT_CHARGE.max) return "uncharged";
  if (m.windup || m.dash || (m.ward && now < m.ward.endTick) || m.ult.cast) return "busy";
  const tm = ULT_TIMING[ability];
  m.ult.charge = 0;
  m.ult.cast = { ability, startTick: now, releaseTick: now + tm.windupTicks, endTick: now + tm.windupTicks + tm.activeTicks, zone: NOBODY };
  emitCast(t, u, ability, "x", castAim(u, inp));
  return null;
}

/**
 * stepMatch, после input китов и до их tick: живым магам +1 на тиках, кратных 360 (6 с); идущий каст при мёртвом маге
 * или на now ≥ endTick — ult/end и cast = null; на now === releaseTick — ult/release (глаза и прицел из ввода).
 */
export function stepUlts(s: MatchState, t: TickCtx, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>): void {
  const now = t.now;
  for (const u of s.units) {
    const m = u.mage;
    if (!m) continue;
    if (u.alive && now % PASSIVE_TICKS === 0) gainUlt(t, u, 1);
    const c = m.ult.cast;
    if (!c) continue;
    if (!u.alive || now >= c.endTick) {
      emitUlt(t, u, c.ability, "end", castAim(u, inputs[u.id] ?? idleInput(u)));
      m.ult.cast = null;
    } else if (now === c.releaseTick) emitUlt(t, u, c.ability, "release", castAim(u, inputs[u.id] ?? idleInput(u)));
  }
}
