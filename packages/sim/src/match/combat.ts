import { DEFAULT_MOVE } from "../player";
import { TICK_HZ, type Vec3 } from "../types";
import { CC_LIMITS, DUMMY, EARTH, KNOCKBACK, MAGE_REGEN, MATCH, STATUS, ticks } from "./defs";
import { unitById } from "./state";
import type { DamageSource, Knockback, MatchState, TickCtx, Unit, UnitId } from "./types";

/**
 * Бой: урон, отбрасывание, статусы, реген, «Кураж» (GDD 2.2, 4.3–4.4; решения Р3, Р4, Р10–Р13).
 * Функции меняют переданное состояние на месте (stepMatch отдаёт им свою копию) и пишут события в t.ev.
 */

/** Удар по юниту. dir — единичный по XZ или нулевой: куда толкать. */
export interface HitSpec {
  source: UnitId; target: UnitId; ability: DamageSource; damage: number; pos: Vec3; dir: { x: number; z: number };
  knock?: Knockback; launch?: boolean; burn?: boolean; slow?: { mul: number; s: number }; rootS?: number; dot?: boolean;
}

const G = DEFAULT_MOVE.gravity;
const LG = KNOCKBACK.groundDecayPerS;
const LA = KNOCKBACK.airDecayPerS;

/**
 * Начальная скорость канала kb, с которой цель на ровном полу проходит ровно distM (Р3).
 * Канал гаснет как e^(−λt): λ = 6/с на полу, 1,5/с в воздухе. Подброшенная на upM цель первые T = 2·√(2·upM/g) с
 * летит с λ воздуха, поэтому v₀ = distM / ((1 − e^(−λₐT))/λₐ + e^(−λₐT)/λ_g). Без подброса v₀ = λ_g · distM.
 */
export function knockbackSpeed(distM: number, upM: number, gravity = G): number {
  if (!(distM > 0)) return 0;
  const e = Math.exp(-LA * (upM > 0 ? 2 * Math.sqrt((2 * upM) / gravity) : 0));
  return distM / ((1 - e) / LA + e / LG);
}

/** Потолок канала: скорость, которая на полу уносит на maxSideM (12 м). */
const KB_CAP = knockbackSpeed(KNOCKBACK.maxSideM, 0);
const NO_CONTROL_TICKS = ticks(STATUS.airborne.noControlS); // 18
const IMMUNE_TICKS = ticks(STATUS.hardCcImmunityS); // 120
const BURN_PULSE_TICKS = ticks(STATUS.burning.pulseS); // 30
const BURN_PULSES = Math.round(STATUS.burning.durationS / STATUS.burning.pulseS); // 6
const BURN_PULSE_DAMAGE = STATUS.burning.dps * STATUS.burning.pulseS; // 3
const MAGE_REGEN_DELAY = ticks(MAGE_REGEN.delayS); // 240
const DUMMY_REGEN_DELAY = ticks(DUMMY.regenDelayS); // 180

/** Самое сильное замедление: множитель скорости не ниже 0,6 (GDD 2.2). */
const SLOW_MIN_MUL = 1 - CC_LIMITS.slowMaxFrac;
/** Длительность контроля в секундах в пределах [0, max]; NaN и отрицательное — 0. */
const ccSeconds = (s: number, max: number): number => (s > 0 ? Math.min(s, max) : 0);

/** Тик возрождения после смерти или сброса: манекен через 3 с (Р12), маг через 1 с (Р17). */
export const respawnAt = (u: Unit, now: number): number => now + ticks(u.mage ? MATCH.mageRespawnS : DUMMY.respawnS);

/**
 * Толчок: канал вбок с потолком 12 м, подброс — как прыжок, точной высоты upM. Подброшенный манекен теряет свою
 * скорость шага: в воздухе его несёт только канал kb, а не 2 м/с патруля (у мага своя скорость — его управление).
 */
function push(u: Unit, dir: { x: number; z: number }, k: Knockback): void {
  const v0 = knockbackSpeed(k.distM, k.upM);
  u.kb.x += dir.x * v0;
  u.kb.z += dir.z * v0;
  const sp = Math.sqrt(u.kb.x * u.kb.x + u.kb.z * u.kb.z);
  if (sp > KB_CAP) Object.assign(u.kb, { x: (u.kb.x * KB_CAP) / sp, z: (u.kb.z * KB_CAP) / sp });
  if (k.upM > 0) {
    const vel = u.move.body.vel;
    vel.y = Math.max(vel.y, Math.sqrt(2 * G * k.upM));
    if (u.dummy) Object.assign(vel, { x: 0, z: 0 });
    Object.assign(u.move, { onGround: false, coyote: 0 });
  }
}

/**
 * Наносит удар. Возвращает нанесённый урон: 0, если цель — сам источник, мертва или её нет.
 * Порядок: урон (+15 % по цели «В воздухе» от прежнего подброса) → отбрасывание (×0,5 у мага Земли, ×0,5 в иммунитете,
 * потолок 12 / 6 м) → HP и засчитывание → событие hit → статусы → смерть.
 */
export function applyHit(s: MatchState, t: TickCtx, h: HitSpec): number {
  if (h.source === h.target) return 0;
  const u = unitById(s, h.target);
  if (!u || !u.alive) return 0;
  const now = t.now;
  const st = u.status;
  const air = st.airborne;
  const amount = air ? h.damage * STATUS.airborne.damageMul : h.damage;

  const knock: Knockback = { distM: 0, upM: 0 };
  if (h.knock) {
    const mul = (u.mage?.element === "earth" ? EARTH.passive.knockbackMul : 1) * (now < st.immuneUntil ? STATUS.immuneKnockbackMul : 1);
    knock.distM = Math.min(KNOCKBACK.maxSideM, h.knock.distM * mul);
    knock.upM = Math.min(KNOCKBACK.maxUpM, h.knock.upM * mul);
    push(u, h.dir, knock);
  }

  u.hp -= amount;
  u.lastHitTick = now;
  u.lastHitBy = h.source;
  const src = unitById(s, h.source);
  if (src?.mage) src.mage.stats.damage += amount;
  const killed = u.hp <= 0;
  t.ev.push({
    type: "hit", source: h.source, target: u.id, ability: h.ability, amount, pos: { x: h.pos.x, y: h.pos.y, z: h.pos.z },
    dir: { x: h.dir.x, y: 0, z: h.dir.z }, knock, airborne: air, dot: h.dot === true, killed,
  });

  const status = (kind: "burning" | "slow" | "root" | "airborne", n: number) => t.ev.push({ type: "status", target: u.id, status: kind, ticks: n, source: h.source });
  if (h.launch && now >= st.immuneUntil) {
    st.airborne = true;
    st.noControlUntil = now + NO_CONTROL_TICKS;
    st.immuneUntil = st.noControlUntil + IMMUNE_TICKS;
    status("airborne", NO_CONTROL_TICKS);
  }
  // Пределы контроля GDD 2.2 (CC_LIMITS) — страховка от данных: обездвиживание ≤ 1 с, замедление ≤ 40 % и ≤ 2 с.
  if (h.rootS !== undefined && h.rootS > 0 && now >= st.immuneUntil) {
    const n = ticks(ccSeconds(h.rootS, CC_LIMITS.rootMaxS));
    st.rootUntil = now + n;
    st.immuneUntil = st.rootUntil + IMMUNE_TICKS;
    Object.assign(u.move.body.vel, { x: 0, z: 0 });
    status("root", n);
  }
  if (h.slow) {
    const n = ticks(ccSeconds(h.slow.s, CC_LIMITS.slowMaxS));
    const mul = h.slow.mul >= SLOW_MIN_MUL ? Math.min(1, h.slow.mul) : SLOW_MIN_MUL;
    // Истёкшее замедление stepStatuses сбрасывает в 1, но удар может прийти раньше него в том же тике.
    st.slowMul = now < st.slowUntil ? Math.min(st.slowMul, mul) : mul;
    st.slowUntil = Math.max(st.slowUntil, now + n);
    status("slow", n);
  }
  if (h.burn) {
    // Повтор продлевает до полных 6 импульсов, не складываясь (Р10); ритм импульсов не сбивается.
    if (st.burnPulses === 0) st.burnNext = now + BURN_PULSE_TICKS;
    st.burnPulses = BURN_PULSES;
    st.burnBy = h.source;
    status("burning", st.burnNext - now + (BURN_PULSES - 1) * BURN_PULSE_TICKS);
  }

  if (killed) {
    u.hp = 0;
    u.alive = false;
    Object.assign(u.kb, { x: 0, z: 0 });
    u.respawnTick = respawnAt(u, now);
    const p = u.move.body.pos;
    t.ev.push({ type: "death", target: u.id, killer: h.source, ability: h.ability, pos: { x: p.x, y: p.y, z: p.z } });
    if (src?.mage) {
      src.mage.stats.kills += 1;
      courage(t, src);
    }
  }
  return amount;
}

/**
 * «Кураж» (пассивка Огня): убийство или засчитанный сброс снимает жар и перезаряжает E. Идущий перегрев он
 * обрывает сам и сам же сообщает об этом (overheat off): кит после обнуления overheatUntil конца перегрева не увидит.
 */
export function courage(t: TickCtx, killer: Unit): void {
  const m = killer.mage;
  if (!m || m.element !== "fire") return;
  m.heat = 0;
  if (t.now < m.overheatUntil) t.ev.push({ type: "overheat", unit: killer.id, on: false });
  m.overheatUntil = 0;
  m.ready.e = Math.min(m.ready.e, t.now);
  t.ev.push({ type: "courage", unit: killer.id });
}

/** Для живых: импульсы горения, конец «В воздухе» и замедления, реген (маг — до ⅔, манекен — до полного). */
export function stepStatuses(s: MatchState, t: TickCtx): void {
  const now = t.now;
  for (const u of s.units) {
    if (!u.alive) continue;
    const st = u.status;
    if (st.burnPulses > 0 && now >= st.burnNext) {
      const b = u.move.body;
      applyHit(s, t, {
        source: st.burnBy, target: u.id, ability: "burning", damage: BURN_PULSE_DAMAGE,
        pos: { x: b.pos.x, y: b.pos.y + b.height / 2, z: b.pos.z }, dir: { x: 0, z: 0 }, dot: true,
      });
      st.burnPulses -= 1;
      st.burnNext += BURN_PULSE_TICKS;
      if (!u.alive) continue;
    }
    if (st.airborne && u.move.onGround && now >= st.noControlUntil) st.airborne = false;
    if (now >= st.slowUntil) st.slowMul = 1;

    const delay = u.mage ? MAGE_REGEN_DELAY : DUMMY_REGEN_DELAY;
    const cap = u.mage ? MAGE_REGEN.capFrac * u.maxHp : u.maxHp;
    if (now - u.lastHitTick >= delay && u.hp < cap) u.hp = Math.min(cap, u.hp + (u.mage ? MAGE_REGEN.perS : DUMMY.regenPerS) / TICK_HZ);
  }
}
