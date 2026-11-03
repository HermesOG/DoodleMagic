import { DEFAULT_MOVE } from "../player";
import { groundBelow } from "../raycast";
import { TICK_HZ, type Vec3 } from "../types";
import { CC_LIMITS, DUMMY, EARTH, ELEMENT_OF, KNOCKBACK, MAGE_REGEN, STATUS, STEAM, WATER, ticks } from "./defs";
import { unitById } from "./state";
import { spawnSteam } from "./steam";
import { NOBODY, type AbilityId, type DamageSource, type Knockback, type MatchState, type StatusKind, type TickCtx, type Unit, type UnitId } from "./types";

/**
 * Бой: урон, отбрасывание, статусы, лечение, реген, «Кураж» (GDD 2.2, 4.3–4.4; решения Р3, Р4, Р10–Р13 фазы 2-lite;
 * толчок v2, «Мокрый», пар, буксир, якорь — Р1, Р4–Р9 фазы 4).
 * Функции меняют переданное состояние на месте (stepMatch отдаёт им свою копию) и пишут события в t.ev.
 */

/** Удар по юниту. dir — единичный по XZ или нулевой: куда толкать. */
export interface HitSpec {
  source: UnitId; target: UnitId; ability: DamageSource; damage: number; pos: Vec3; dir: { x: number; z: number };
  knock?: Knockback; launch?: boolean; burn?: boolean; slow?: { mul: number; s: number }; rootS?: number; dot?: boolean;
  /** Удар о стену (Порыв): урон, если канал этого толчка упрётся в стену при скорости ≥ KNOCKBACK.slamMinSpeed. */
  slam?: number;
  /** Буксир (Хват): точка по XZ, скорость и сколько тиков; якорь отменяет. */
  tow?: { x: number; z: number; speed: number; ticks: number };
}

const G = DEFAULT_MOVE.gravity;
const LG = KNOCKBACK.groundDecayPerS;
const LA = KNOCKBACK.airDecayPerS;

/** Время полёта до опоры, с: скорость вверх vy, высота над опорой h (нет опоры — Infinity). h ≤ 0 и vy ≤ 0 — 0. */
export function flightTime(vy: number, h: number, gravity = G): number {
  if (h <= 0 && vy <= 0) return 0;
  return (vy + Math.sqrt(vy * vy + 2 * gravity * Math.max(0, h))) / gravity;
}

/**
 * v₀ канала: цель первые flightS секунд летит (λ 1,5), потом скользит (λ 6) и проходит ровно distM.
 * Канал гаснет как e^(−λt), поэтому v₀ = distM / ((1 − e)/λₐ + e/λ_g), e = e^(−λₐ·flightS). Без полёта v₀ = λ_g · distM,
 * опоры нет (полёт ∞) — v₀ = λₐ · distM.
 */
export function knockbackSpeedFor(distM: number, flightS: number): number {
  if (!(distM > 0)) return 0;
  const e = Math.exp(-LA * (flightS > 0 ? flightS : 0));
  return distM / ((1 - e) / LA + e / LG);
}

/**
 * Начальная скорость канала, с которой цель на ровном полу проходит ровно distM (Р3): частный случай knockbackSpeedFor,
 * подброшенная на upM цель летит T = 2·√(2·upM/g) с.
 */
export function knockbackSpeed(distM: number, upM: number, gravity = G): number {
  return knockbackSpeedFor(distM, upM > 0 ? 2 * Math.sqrt((2 * upM) / gravity) : 0);
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
const STAGGER_TICKS = ticks(KNOCKBACK.staggerS); // 12
const WET_TICKS = ticks(STATUS.wet.durationS); // 180
const STEAM_EVERY_TICKS = ticks(STEAM.everyS); // 180
/** Опору для честного полёта ищем чуть выше подошвы: стоящий на грани её не проскочит. */
const FLIGHT_PROBE_UP_M = 0.05;

/** Самое сильное замедление: множитель скорости не ниже 0,6 (GDD 2.2). */
const SLOW_MIN_MUL = 1 - CC_LIMITS.slowMaxFrac;
/** Длительность контроля в секундах в пределах [0, max]; NaN и отрицательное — 0. */
const ccSeconds = (s: number, max: number): number => (s > 0 ? Math.min(s, max) : 0);
const rootsMul = (u: Unit): number => (u.mage?.element === "earth" ? EARTH.passive.knockbackMul : 1);
const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const bodyCenter = (u: Unit): Vec3 => ({ x: u.move.body.pos.x, y: u.move.body.pos.y + u.move.body.height / 2, z: u.move.body.pos.z });

/** Тик возрождения после смерти или сброса: манекен через 3 с (Р12), маг — через t.mageRespawnTicks (полигон 1 с, Р17). */
export const respawnAt = (u: Unit, t: TickCtx): number => t.now + (u.mage ? t.mageRespawnTicks : ticks(DUMMY.respawnS));

/** «Якорь» диска Отражения (Р7): толчок, подброс, буксир и тяга не действуют. */
export const isAnchored = (u: Unit, now: number): boolean => now < u.status.anchoredUntil;

/** Множитель притягивания (Р6): якорь — 0; Земля ×0,5; иммунитет ×0,5 (перемножаются). */
export function pullMul(u: Unit, now: number): number {
  if (isAnchored(u, now)) return 0;
  return rootsMul(u) * (now < u.status.immuneUntil ? STATUS.immunePullMul : 1);
}

/**
 * Сколько цель пролетит до опоры, с (честный полёт, Р1 фазы 4), уже после подброса толчка k. Без подброса на полу
 * и в парении — 0. Стоявшая на полу (grounded — до подброса) летит с высоты 0: так и стоящая на краю уступа, у которой
 * под центром пусто. Иначе — по скорости вверх и высоте над опорой под ней; опоры нет — Infinity. Подброшенный из
 * парения летит честно: парение его не держит.
 */
function flightOf(t: TickCtx, u: Unit, k: Knockback, grounded: boolean): number {
  if (k.upM <= 0 && (grounded || u.mage?.flight.gliding === true)) return 0;
  const b = u.move.body;
  if (grounded) return flightTime(b.vel.y, 0);
  const ground = groundBelow(t.world, { x: b.pos.x, y: b.pos.y + FLIGHT_PROBE_UP_M, z: b.pos.z }, KNOCKBACK.flightProbeM);
  return ground === null ? Infinity : flightTime(b.vel.y, b.pos.y - ground);
}

/**
 * Толчок v2 (Р1 фазы 4). Подброс — как прыжок, точной высоты upM; подброшенный манекен теряет свою скорость шага
 * (в воздухе его несёт только канал kb, а не 2 м/с патруля). K1: толчок ≥ 1 м гасит у жертвы её скорость к источнику
 * и на 0,2 с режет её ускорение (staggerUntil; не контроль, иммунитета нет). Канал: v₀ по фактическому времени полёта
 * цели до опоры, потолок 12 м.
 */
function push(u: Unit, t: TickCtx, dir: { x: number; z: number }, k: Knockback): void {
  const vel = u.move.body.vel;
  const grounded = u.move.onGround;
  if (k.upM > 0) {
    vel.y = Math.max(vel.y, Math.sqrt(2 * G * k.upM));
    if (u.dummy) Object.assign(vel, { x: 0, z: 0 });
    Object.assign(u.move, { onGround: false, coyote: 0 });
  }
  if (k.distM >= KNOCKBACK.staggerMinM) {
    const along = vel.x * dir.x + vel.z * dir.z;
    if (along < 0) {
      vel.x -= along * dir.x;
      vel.z -= along * dir.z;
    }
    u.status.staggerUntil = Math.max(u.status.staggerUntil, t.now + STAGGER_TICKS);
  }
  const v0 = knockbackSpeedFor(k.distM, flightOf(t, u, k, grounded));
  u.kb.x += dir.x * v0;
  u.kb.z += dir.z * v0;
  const sp = Math.sqrt(u.kb.x * u.kb.x + u.kb.z * u.kb.z);
  if (sp > KB_CAP) Object.assign(u.kb, { x: (u.kb.x * KB_CAP) / sp, z: (u.kb.z * KB_CAP) / sp });
}

/** Пар с цели u (Р9): не чаще раза в 3 с на цель; облако в точке её подошвы, хозяин — owner. */
function steam(s: MatchState, t: TickCtx, u: Unit, owner: UnitId, ability: AbilityId): void {
  if (t.now < u.status.steamReadyAt) return;
  u.status.steamReadyAt = t.now + STEAM_EVERY_TICKS;
  spawnSteam(s, t, copy(u.move.body.pos), owner, ability);
}

/**
 * Наносит удар. Возвращает нанесённый урон: 0, если цель — сам источник, мертва, её нет или она под защитой после
 * появления (тогда ни урона, ни толчка, ни статусов, ни события hit).
 * Порядок: урон (+15 % по цели «В воздухе» от прежнего подброса) → отбрасывание (не под якорем; ×0,5 у мага Земли,
 * в иммунитете вбок ×1, вверх ×0,5; потолок 12 / 6 м) и удар о стену в канале → HP и засчитывание → событие hit →
 * подброс, обездвиживание, замедление → «Мокрый», Горение и пар (Р9) → буксир → «Круговорот» → смерть (цели +1 deaths).
 */
export function applyHit(s: MatchState, t: TickCtx, h: HitSpec): number {
  if (h.source === h.target) return 0;
  const u = unitById(s, h.target);
  if (!u || !u.alive) return 0;
  if (t.now < u.status.shieldUntil) return 0;
  const now = t.now;
  const st = u.status;
  const wasWet = now < st.wetUntil;
  const wasBurning = st.burnPulses > 0;
  const el = h.ability === "burning" ? null : ELEMENT_OF[h.ability];
  const anchored = isAnchored(u, now);
  const air = st.airborne;
  const amount = air ? h.damage * STATUS.airborne.damageMul : h.damage;

  const knock: Knockback = { distM: 0, upM: 0 };
  if (h.knock && !anchored) {
    const immune = now < st.immuneUntil;
    const sideMul = rootsMul(u) * (immune ? STATUS.immuneKnockSideMul : 1);
    const upMul = rootsMul(u) * (immune ? STATUS.immuneKnockUpMul : 1);
    knock.distM = Math.min(KNOCKBACK.maxSideM, h.knock.distM * sideMul);
    knock.upM = Math.min(KNOCKBACK.maxUpM, h.knock.upM * upMul);
    push(u, t, h.dir, knock);
    // Удар о стену ждёт свой толчок: «сок» ЛКМ (< 1 м) его не стирает, новый толчок ≥ 1 м или свой slam — заменяет.
    if (knock.distM > 0 && (h.slam !== undefined || knock.distM >= KNOCKBACK.staggerMinM)) {
      u.slam = h.slam !== undefined && h.slam > 0 && h.ability !== "burning" ? { by: h.source, ability: h.ability, damage: h.slam } : null;
    }
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

  const status = (kind: StatusKind, n: number) => t.ev.push({ type: "status", target: u.id, status: kind, ticks: n, source: h.source });
  if (h.launch && !anchored && now >= st.immuneUntil) {
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

  // Пар (Р9): огонь по Мокрому сушит, Горение не ложится, пар — кроме кулаков; Вода по горящему гасит его и даёт пар.
  if ((el === "fire" || h.burn === true) && wasWet) {
    st.wetUntil = now;
    if (h.ability !== "fireFists" && h.ability !== "burning") steam(s, t, u, h.source, h.ability);
  } else if (h.burn) {
    // Повтор продлевает до полных 6 импульсов, не складываясь (Р10); ритм импульсов не сбивается.
    if (st.burnPulses === 0) st.burnNext = now + BURN_PULSE_TICKS;
    st.burnPulses = BURN_PULSES;
    st.burnBy = h.source;
    status("burning", st.burnNext - now + (BURN_PULSES - 1) * BURN_PULSE_TICKS);
  }
  if (el === "water" && h.ability !== "burning") {
    if (wasBurning) {
      st.burnPulses = 0;
      st.burnBy = NOBODY;
      steam(s, t, u, h.source, h.ability);
    }
    st.wetUntil = Math.max(st.wetUntil, now + WET_TICKS);
    if (!wasWet) status("wet", WET_TICKS);
  }

  // Буксир (Р5): цель в рывке его обрывает сразу (Р22), поэтому её не тащит. Длительность — в пределе
  // обездвиживания GDD 2.2 (≤ 1 с), как у корней: страховка от данных.
  const towTicks = h.tow ? ticks(ccSeconds(h.tow.ticks / TICK_HZ, CC_LIMITS.rootMaxS)) : 0;
  if (h.tow && towTicks > 0 && !anchored && !killed && !(u.mage?.dash ?? null)) {
    const p = u.move.body.pos;
    u.tow = { x: h.tow.x, z: h.tow.z, speed: h.tow.speed, endTick: now + towTicks, by: h.source };
    Object.assign(u.kb, { x: 0, z: 0 });
    u.slam = null;
    Object.assign(u.move.body.vel, { x: 0, y: 0, z: 0 });
    st.immuneUntil = Math.max(st.immuneUntil, u.tow.endTick + IMMUNE_TICKS);
    t.ev.push({ type: "tow", target: u.id, source: h.source, phase: "start", pos: copy(p), to: { x: h.tow.x, y: p.y, z: h.tow.z } });
  }

  // «Круговорот» (Р4): урон Воды по уже Мокрой цели лечит Воду на 20 % урона, и выше ⅔.
  if (el === "water" && wasWet && src?.alive) healUnit(s, t, src.id, amount * WATER.passive.drainFrac, src.id);

  if (killed) {
    u.hp = 0;
    u.alive = false;
    Object.assign(u.kb, { x: 0, z: 0 });
    endTow(t, u);
    u.slam = null;
    u.respawnTick = respawnAt(u, t);
    if (u.mage) u.mage.stats.deaths += 1;
    const p = u.move.body.pos;
    t.ev.push({ type: "death", target: u.id, killer: h.source, ability: h.ability, pos: { x: p.x, y: p.y, z: p.z } });
    if (src?.mage) {
      src.mage.stats.kills += 1;
      courage(t, src);
    }
  }
  return amount;
}

/** Статусы без урона и без события hit (Родник). */
export interface StatusSpec { source: UnitId; wetS?: number; slow?: { mul: number; s: number } }

/**
 * Статусы без урона и без события hit (Родник): защита после появления не пускает; событие status — только при
 * наложении заново (статус не действовал). «Мокрый» гасит Горение (без пара: это не удар). Замедление — в пределах GDD 2.2.
 */
export function applyStatus(s: MatchState, t: TickCtx, target: UnitId, spec: StatusSpec): void {
  const u = unitById(s, target);
  if (!u || !u.alive) return;
  const now = t.now;
  const st = u.status;
  if (now < st.shieldUntil) return;
  const status = (kind: StatusKind, n: number) => t.ev.push({ type: "status", target: u.id, status: kind, ticks: n, source: spec.source });
  if (spec.wetS !== undefined && spec.wetS > 0) {
    const n = ticks(spec.wetS);
    const was = now < st.wetUntil;
    st.wetUntil = Math.max(st.wetUntil, now + n);
    st.burnPulses = 0;
    st.burnBy = NOBODY;
    if (!was) status("wet", n);
  }
  if (spec.slow) {
    const n = ticks(ccSeconds(spec.slow.s, CC_LIMITS.slowMaxS));
    const mul = spec.slow.mul >= SLOW_MIN_MUL ? Math.min(1, spec.slow.mul) : SLOW_MIN_MUL;
    const was = now < st.slowUntil;
    st.slowMul = was ? Math.min(st.slowMul, mul) : mul;
    st.slowUntil = Math.max(st.slowUntil, now + n);
    if (!was) status("slow", n);
  }
}

/** Лечение до максимума (мимо засечки ⅔); событие heal с фактическим количеством (ничего не прибавилось — события нет); возвращает его. */
export function healUnit(s: MatchState, t: TickCtx, target: UnitId, amount: number, source: UnitId): number {
  const u = unitById(s, target);
  if (!u || !u.alive || !(amount > 0)) return 0;
  const add = Math.min(amount, u.maxHp - u.hp);
  if (!(add > 0)) return 0;
  u.hp += add;
  t.ev.push({ type: "heal", target: u.id, source, amount: add, pos: bodyCenter(u) });
  return add;
}

/**
 * Подброс без урона (ядро Смерча, Р11): Земля ×0,5; в иммунитете, под якорем и защитой — нет (false). Ставит
 * «В воздухе» и иммунитет, засчитывает сброс source (lastHitBy, lastHitTick).
 */
export function launchUnit(s: MatchState, t: TickCtx, target: UnitId, upM: number, source: UnitId): boolean {
  const u = unitById(s, target);
  if (!u || !u.alive) return false;
  const now = t.now;
  const st = u.status;
  if (now < st.shieldUntil || isAnchored(u, now) || now < st.immuneUntil) return false;
  const up = Math.min(KNOCKBACK.maxUpM, upM * rootsMul(u));
  if (!(up > 0)) return false;
  const vel = u.move.body.vel;
  vel.y = Math.max(vel.y, Math.sqrt(2 * G * up));
  if (u.dummy) Object.assign(vel, { x: 0, z: 0 });
  Object.assign(u.move, { onGround: false, coyote: 0 });
  st.airborne = true;
  st.noControlUntil = now + NO_CONTROL_TICKS;
  st.immuneUntil = st.noControlUntil + IMMUNE_TICKS;
  u.lastHitBy = source;
  u.lastHitTick = now;
  t.ev.push({ type: "status", target: u.id, status: "airborne", ticks: NO_CONTROL_TICKS, source });
  return true;
}

/** Конец буксира: скорость 0, событие tow/end. Буксира нет — ничего. */
export function endTow(t: TickCtx, u: Unit): void {
  const tow = u.tow;
  if (!tow) return;
  u.tow = null;
  Object.assign(u.move.body.vel, { x: 0, y: 0, z: 0 });
  const p = u.move.body.pos;
  t.ev.push({ type: "tow", target: u.id, source: tow.by, phase: "end", pos: copy(p), to: { x: tow.x, y: p.y, z: tow.z } });
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
