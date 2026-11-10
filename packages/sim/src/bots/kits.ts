import { ULT_CHARGE } from "../match/defs";
import { AIR, EARTH, FIRE, WATER } from "../match/defs";
import type { Element, Slot, Unit } from "../match/types";
import { forwardXZ } from "../player";
import { lineOfSight } from "../raycast";
import type { Vec3 } from "../types";
import { dashLandingOk, navNode, nearestSafe, nodePos, voidDir, voidDistM } from "./nav";
import type { BotParams } from "./params";
import type { BotView, CastPlan, Perceived, Threat } from "./sense";

/**
 * Характер стихии для мозга бота (Р6, ГД 4): рабочая полоса, ЛКМ, условия Q/E/C/X, постановка под сброс и спасение
 * над пустотой. Уровни (Р4, Р5): Ученик жмёт Q/E/C «готово и цель в дальности», Маг — по условиям стихии, Архимаг —
 * ещё и связки. Задержку уровня до нажатия ставит мозг (кроме urgent): кит только решает, что и куда.
 * Решения — простые: одно-два главных условия на слот. Случайность — только rand (PRNG бота).
 */

/** ЛКМ для прицела: скорость и гравитация снаряда, дальность; мгновенный удар (хлыст) бьёт через windupS по взгляду. */
export interface BotPrimary {
  readonly speed: number;
  readonly gravity: number;
  readonly rangeM: number;
  readonly windupS: number;
  readonly instant: boolean;
}

export interface BotKit {
  /** Рабочая полоса до цели, м (Р6). */
  readonly bandM: readonly [number, number];
  readonly primary: BotPrimary;
  /** Ульта «в дальности», м. */
  readonly ultRangeM: number;
  /** Прибавка к оценке цели у кромки (Р7: Воздуху, Воде, Огню +2, Земле +1). */
  readonly edgeBonus: number;
  /** Держать ЛКМ сверх общего правила (видна, в дальности, взгляд у точки): у Огня — пока жар ниже предела уровня. */
  holdPrimary(self: Readonly<Unit>, params: Readonly<BotParams>, target: Perceived | null, now: number): boolean;
  /** Решение на мысли: план Q/E/C/X или null. Зовётся, пока нет своего плана. */
  decide(v: BotView, rand: () => number): CastPlan | null;
  /** Куда встать в бою вместо середины полосы (заход для Порыва, постановка под сброс); null — по полосе. */
  stance?(v: BotView): Vec3 | null;
  /** Над пустотой в полёте — спасение (рывок к полу, Взмах, второй прыжок); null — править полёт. */
  rescue?(v: BotView, rand: () => number): CastPlan | null;
}

// ---------------------------------------------------------------- общее

/** Грудь и пояс цели над подошвой. */
const CHEST_M = 1.2;
const WAIST_M = 0.6;
/**
 * Точка под прицелом на земле (столб, Смерч, Родник, Стена огня по цели): взгляд в тело на этой высоте — луч ловит тело,
 * и точка — его ступни (aimGround); в ступни при пологом луче ошибка по высоте уводит точку на метры.
 */
const BODY_DY = 0.5;
/** Цель «стоит»: по XZ медленнее этого, м/с. */
const STILL_MS = 1.5;
/** Под сброс (Р9, ГД 4): цель между ботом и кромкой не дальше этого до неё, м. */
const RING_M = 3;
/** «Над пустотой» для спасения: эпизод, на который бросается шанс уровня, с. */
const RESCUE_EPISODE_S = 0.5;
/** «В беде»: эпизод для шанса уровня, с. */
const TROUBLE_EPISODE_S = 1;
/** Взмах и рывок: длина, м. */
const DASH_M = FIRE.jetDash.distM;
const SWOOP_M = AIR.swoop.distM;
/** У ущелья ближе этого Воздух бережёт заряд Взмаха (ГД 4). */
const SWOOP_KEEP_M = 8;

const ready = (v: BotView, slot: Slot): boolean => v.now >= v.self.mage!.ready[slot];
const ultReady = (v: BotView): boolean => v.self.mage!.ult.charge >= ULT_CHARGE.max && !v.self.mage!.ult.cast;
const busy = (v: BotView): boolean => {
  const m = v.self.mage!;
  return m.windup !== null || m.ult.cast !== null || m.dash !== null;
};
const speedXZ = (t: Perceived): number => Math.sqrt(t.vel.x * t.vel.x + t.vel.z * t.vel.z);
/** В воздухе по снимку: подброшена, парит или летит по вертикали. */
const inAir = (t: Perceived): boolean => t.airborne || t.gliding || Math.abs(t.vel.y) > 1;
/** Под контролем (Р8): подброшена или обездвижена — Ученик и Маг цепочкой не добавляют. */
const chained = (v: BotView, t: Perceived): boolean => v.params.noChainCc && (t.airborne || t.rooted);
const unit2 = (x: number, z: number): { x: number; z: number } | null => {
  const l = Math.sqrt(x * x + z * z);
  return l < 1e-9 ? null : { x: x / l + 0, z: z / l + 0 };
};
/** Видимая цель в [lo, hi] м или null. */
function visibleTarget(v: BotView, lo: number, hi: number): Perceived | null {
  const t = v.target;
  return t && t.visible && !t.heard && t.dist >= lo && t.dist <= hi ? t : null;
}
const isNovice = (v: BotView): boolean => v.level === "novice";

/**
 * Шанс уровня на эпизод (Р4): решение бросается на каждой мысли (hz раз в секунду; спасение — каждый тик), поэтому
 * вероятность за бросок — такая, чтобы за эпизод episodeS вышло p.
 */
function roll(v: BotView, rand: () => number, p: number, episodeS: number, hz = v.params.thinkHz): boolean {
  if (p >= 1) return true;
  const n = Math.max(1, hz * episodeS);
  return rand() < 1 - Math.pow(1 - p, 1 / n);
}

/** Сколько до пустоты за целью по линии «бот → цель», м (Infinity — нет ближе maxM). */
function voidBehind(v: BotView, t: Perceived, maxM: number): number {
  const p = v.self.move.body.pos;
  const u = unit2(t.pos.x - p.x, t.pos.z - p.z);
  if (!u) return Infinity;
  for (let k = 0.5; k <= maxM + 1e-9; k += 0.5) {
    if (voidDistM(v.nav, { x: t.pos.x + u.x * k, y: t.pos.y, z: t.pos.z + u.z * k }) <= 0) return k;
  }
  return Infinity;
}

/** Стена за целью по линии «бот → цель» ближе maxM (удар о стену после толчка). */
function wallBehind(v: BotView, t: Perceived, maxM: number): boolean {
  const p = v.self.move.body.pos;
  const u = unit2(t.pos.x - p.x, t.pos.z - p.z);
  if (!u) return false;
  const a = { x: t.pos.x, y: t.pos.y + 1, z: t.pos.z };
  return !lineOfSight(v.world, a, { x: a.x + u.x * maxM, y: a.y, z: a.z + u.z * maxM });
}

/** Свой маг у кромки: путь толчка по линии «бот → цель» ведёт цель к пустоте (цель между ботом и кромкой). */
function ringOut(v: BotView, t: Perceived, maxBehindM: number): boolean {
  return t.voidM <= maxBehindM + 0.5 && voidBehind(v, t, maxBehindM) < Infinity;
}

/** Видимые враги в дальности rM, у которых боковой отход от линии «бот → цель» не больше halfM (линия, конус, полоса). */
function onLine(v: BotView, t: Perceived, rM: number, halfM: number): Perceived[] {
  const p = v.self.move.body.pos;
  const u = unit2(t.pos.x - p.x, t.pos.z - p.z);
  if (!u) return [];
  return v.enemies.filter((e) => {
    if (!e.visible || e.heard || e.dist > rM) return false;
    const dx = e.pos.x - p.x;
    const dz = e.pos.z - p.z;
    const fwd = dx * u.x + dz * u.z;
    return fwd >= -0.5 && Math.abs(dx * u.z - dz * u.x) <= halfM;
  });
}

/** Видимые враги в конусе ±halfDeg на rM от линии «бот → цель». */
function inCone(v: BotView, t: Perceived, rM: number, halfDeg: number): Perceived[] {
  const p = v.self.move.body.pos;
  const u = unit2(t.pos.x - p.x, t.pos.z - p.z);
  if (!u) return [];
  const cs = Math.cos((halfDeg * Math.PI) / 180);
  return v.enemies.filter((e) => {
    if (!e.visible || e.heard || e.dist > rM) return false;
    if (e.dist < 1) return true;
    return ((e.pos.x - p.x) * u.x + (e.pos.z - p.z) * u.z) / e.dist >= cs;
  });
}

/**
 * Ульта по уровню (Р5): Ученик — кто-то в дальности; Маг — 2+ в дальности, цель < 50 % HP или условие стихии;
 * Архимаг — 2+ или условие стихии («верный сброс»), а подержав заряд ultWaitS — как Маг.
 */
function ultGo(v: BotView, inRange: readonly Perceived[], special: boolean): boolean {
  if (inRange.length === 0) return false;
  const hurt = inRange.some((e) => e.hp < e.maxHp * 0.5);
  switch (v.params.ult) {
    case "inRange":
      return true;
    case "twoOrHurt":
      return special || inRange.length >= 2 || hurt;
    case "patient":
      return special || inRange.length >= 2 || (v.ultHeldS >= v.params.ultWaitS && hurt);
  }
}

/** План ульты: взгляд за целью (на высоте dy), без задержки. */
const ultPlan = (t: Perceived, dy: number, tolDeg = 5): CastPlan => ({
  slot: "x", aim: { x: t.pos.x, y: t.pos.y + dy, z: t.pos.z }, track: { id: t.id, dy }, urgent: true, tolDeg,
});

/** План по цели: взгляд за ней с упреждением уровня по снаряду или телеграфу. */
function at(slot: "q" | "e" | "c", t: Perceived, dy: number, shot: { speed?: number; gravity?: number; windupS?: number } = {}, extra: Partial<CastPlan> = {}): CastPlan {
  return { slot, aim: { x: t.pos.x, y: t.pos.y + dy, z: t.pos.z }, track: { id: t.id, dy, ...shot }, ...extra };
}

/** Самая близкая к удару угроза, в которой бот, по виду. */
function threatInside(v: BotView, pick: (t: Threat) => boolean): Threat | null {
  let best: Threat | null = null;
  for (const t of v.threats) if (t.inside && pick(t) && (!best || t.etaS < best.etaS)) best = t;
  return best;
}

/**
 * Куда рвануть на distM (Р9: приземление с запасом 1,5 м): сначала prefer, затем поперёк линии на цель (сторона стрейфа
 * случайная), назад от цели, вперёд. null — некуда.
 */
function dashDir(v: BotView, rand: () => number, prefer: { x: number; z: number } | null, distM: number): { x: number; z: number } | null {
  const p = v.self.move.body.pos;
  const t = v.target;
  const f = forwardXZ(v.self.move.yaw);
  const u = t ? unit2(t.pos.x - p.x, t.pos.z - p.z) ?? { x: f.x, z: f.z } : { x: f.x, z: f.z };
  const s = rand() < 0.5 ? 1 : -1;
  const opts = [prefer, { x: -u.z * s, z: u.x * s }, { x: u.z * s, z: -u.x * s }, { x: -u.x, z: -u.z }];
  for (const d of opts) if (d && dashLandingOk(v.nav, p, d, distM)) return { x: d.x, z: d.z };
  return null;
}

/**
 * Спасение над пустотой (Р9): направление рывка на distM, в конце которого пол с запасом не меньше 1 м и не выше ступней.
 * Сначала — к ближнему безопасному узлу, затем 16 направлений, ближние к нему первыми. null — не выйти.
 */
function rescueDir(v: BotView, distM: number): { x: number; z: number } | null {
  const p = v.self.move.body.pos;
  const nav = v.nav;
  const near = nearestSafe(nav, p, distM + 2, 1);
  let base: { x: number; z: number } | null = null;
  if (near >= 0) {
    const q = nodePos(nav, near);
    base = unit2(q.x - p.x, q.z - p.z);
  }
  base ??= voidDir(nav, p);
  const b = base ?? { x: 1, z: 0 };
  const ends = (d: { x: number; z: number }): boolean => {
    for (const k of [distM, distM - 1.5]) {
      const n = navNode(nav, { x: p.x + d.x * k, y: p.y, z: p.z + d.z * k });
      if (n >= 0 && nav.voidM[n]! >= 1) return true;
    }
    return false;
  };
  for (let k = 0; k <= 8; k++) {
    for (const sgn of k === 0 || k === 8 ? [1] : [1, -1]) {
      const a = (sgn * k * Math.PI) / 8;
      const d = { x: b.x * Math.cos(a) - b.z * Math.sin(a), z: b.x * Math.sin(a) + b.z * Math.cos(a) };
      if (ends(d)) return d;
    }
  }
  return null;
}

/** Взгляд при подъёме Родника или стены: точка на полу перед собой. */
function aheadOfSelf(v: BotView, m: number): Vec3 {
  const p = v.self.move.body.pos;
  const f = forwardXZ(v.self.move.yaw);
  return { x: p.x + f.x * m, y: p.y, z: p.z + f.z * m };
}

/**
 * Постановка под сброс (Р9, ГД 4): цель у кромки (≤ ringM) — встать за ней со стороны пола на standM, чтобы толчок
 * шёл к пустоте. Сама точка — с запасом до кромки (dangerM). Ученик под сброс не ставит.
 */
function ringStance(v: BotView, ringM: number, standM: number, slotReadyIn: number): Vec3 | null {
  const t = v.target;
  if (isNovice(v) || !t || !t.visible || t.voidM > ringM || slotReadyIn > 1) return null;
  const d = voidDir(v.nav, t.pos);
  if (!d) return null;
  const q = { x: t.pos.x - d.x * standM, y: t.pos.y, z: t.pos.z - d.z * standM };
  return voidDistM(v.nav, q) >= 3 ? q : null;
}
const readyIn = (v: BotView, slot: Slot): number => Math.max(0, v.self.mage!.ready[slot] - v.now) / 60;

/** «В беде» с шансом уровня (Р4). */
const trouble = (v: BotView, rand: () => number): boolean => v.inTrouble && roll(v, rand, v.params.rescueChance, TROUBLE_EPISODE_S);

// ---------------------------------------------------------------- Огонь

const FF = FIRE.fireFists.projectile;
const FB = FIRE.fireball;

/** Огонь — дуэлянт 6–15 м. Q шар под ноги, E рывок из беды и к полу, C стена между, X Дыхание в упор. */
function fireDecide(v: BotView, rand: () => number): CastPlan | null {
  if (busy(v)) return null;
  const t = v.target;
  // X: цель ближе 8 м (Архимаг ждёт мост) или 2+ в конусе ±15°
  if (ultReady(v) && t && t.visible) {
    const cone = inCone(v, t, FIRE.dragonBreath.rangeM - 1, FIRE.dragonBreath.halfAngleDeg + 5);
    const special = cone.length >= 2 || (t.dist <= 8 && (v.level !== "archmage" || t.voidM < 2));
    if (ultGo(v, cone.filter((e) => e.dist <= FIRE.dragonBreath.rangeM - 1), special)) return ultPlan(t, CHEST_M, 6);
  }
  // E: в беде, под телеграфом ульты или Порыва — рывок прочь (приземление с запасом)
  if (ready(v, "e")) {
    const tel = threatInside(v, (h) => h.kind === "ult" || h.ability === "gust");
    if (tel || trouble(v, rand)) {
      const d = dashDir(v, rand, tel?.escape ?? null, DASH_M);
      if (d) return { slot: "e", aim: null, move: d, moveM: DASH_M, urgent: true };
    }
    // Архимаг догоняет добитую: цель < 30 %, у себя > 60 %
    const tt = visibleTarget(v, 9, 16);
    if (tt && v.level === "archmage" && tt.hp < tt.maxHp * 0.3 && v.self.hp > v.self.maxHp * 0.6) {
      const u = unit2(tt.pos.x - v.self.move.body.pos.x, tt.pos.z - v.self.move.body.pos.z);
      if (u && dashLandingOk(v.nav, v.self.move.body.pos, u, DASH_M)) return { slot: "e", aim: null, move: u, moveM: DASH_M };
    }
    const tn = isNovice(v) ? visibleTarget(v, 0, 15) : null;
    if (tn) {
      const d = dashDir(v, rand, null, DASH_M);
      if (d) return { slot: "e", aim: null, move: d, moveM: DASH_M };
    }
  }
  // Q: цель в 8–20 м стоит, кастует, в воздухе или у кромки — шар под ноги; в поднятый диск Воды не бьёт
  const tq = visibleTarget(v, isNovice(v) ? 0 : 8, 20);
  if (tq && ready(v, "q") && !(tq.element === "water" && tq.ward)) {
    const shot = { speed: FB.projectile.speed, windupS: FB.windupS };
    if (isNovice(v)) return at("q", tq, WAIST_M, shot);
    // сброс: цель между ботом и кромкой — прямое попадание толкает по ходу шара
    if (ringOut(v, tq, RING_M)) return at("q", tq, WAIST_M, shot, { tolDeg: 3 });
    if (speedXZ(tq) < STILL_MS || tq.windup !== null || tq.ult !== null || inAir(tq) || tq.voidM < RING_M) return at("q", tq, 0.2, shot);
  }
  // C: поперёк моста по цели на нём или между собой и врагом при отходе
  const tc = visibleTarget(v, 3, FIRE.fireWall.rangeM);
  if (tc && ready(v, "c")) {
    if (isNovice(v) || tc.voidM < 1.6) return at("c", tc, BODY_DY, {});
    if (v.self.hp < v.self.maxHp * 0.45 && tc.dist <= 12) {
      const p = v.self.move.body.pos;
      const k = Math.min(6, tc.dist * 0.5) / tc.dist;
      return { slot: "c", aim: { x: p.x + (tc.pos.x - p.x) * k, y: Math.min(p.y, tc.pos.y), z: p.z + (tc.pos.z - p.z) * k } };
    }
  }
  return null;
}

/** Огонь над пустотой: рывок к полу (Р9). Под «В воздухе» рывок не идёт — ждёт. */
function fireRescue(v: BotView, rand: () => number): CastPlan | null {
  if (v.now < v.self.status.noControlUntil || !ready(v, "e") || v.self.mage!.dash) return null;
  // Ученик правит полёт поздно (Р9): спасение — с шансом уровня; остальные выбираются всегда
  if (v.params.lateAirFix && !roll(v, rand, v.params.rescueChance, RESCUE_EPISODE_S, 60)) return null;
  const d = rescueDir(v, DASH_M);
  return d ? { slot: "e", aim: null, move: d, urgent: true, ttlS: 0.3 } : null;
}

// ---------------------------------------------------------------- Земля

const SS = EARTH.stoneShot.projectile;
const PILLAR_TICKS = Math.round(EARTH.stonePillar.cooldownS * 60);
/** Без связок: после своего столба ЛКМ молчит столько тиков (Р6: «Жонглёр» — только Архимаг). */
const NO_JUGGLE_TICKS = 36;

/** Земля — якорь 12–25 м. Q столб по стоящей, E стена от снаряда, C землетрясение в упор, X разлом вдоль моста. */
function earthDecide(v: BotView, rand: () => number): CastPlan | null {
  if (busy(v)) return null;
  const t = v.target;
  const ground = v.self.move.onGround;
  // X: вдоль моста по цели на нём или по двум на линии
  if (ultReady(v) && ground && t && t.visible) {
    const line = onLine(v, t, EARTH.tectonicRift.lengthM - 1, EARTH.tectonicRift.halfWidthM + 0.3);
    const special = line.length >= 2 || (t.voidM < 1.6 && t.dist <= EARTH.tectonicRift.lengthM - 1);
    if (ultGo(v, line, special)) return ultPlan(t, 0, 3);
  }
  // E: в беде или шар (Ответ) спереди долетит не раньше 0,3 с — стена к нему; Ученик — к цели в дальности
  if (ready(v, "e")) {
    const shot = threatInside(v, (h) => h.kind === "projectile" && h.etaS >= EARTH.stoneWall.growS && (h.ability === "fireball" || h.ability === "waterWard"));
    if (shot && !isNovice(v)) return { slot: "e", aim: { x: shot.from.x, y: shot.from.y, z: shot.from.z }, tolDeg: 25, urgent: true };
    const dashing = v.enemies.find((e) => e.visible && e.element === "fire" && e.dash && e.dist < 10);
    if (dashing && !isNovice(v)) return { slot: "e", aim: { x: dashing.pos.x, y: dashing.pos.y + CHEST_M, z: dashing.pos.z }, track: { id: dashing.id, dy: CHEST_M }, tolDeg: 25, urgent: true };
    if (trouble(v, rand) && t) return { ...at("e", t, CHEST_M), tolDeg: 25, urgent: true };
    const tn = isNovice(v) ? visibleTarget(v, 0, 25) : null;
    if (tn) return { ...at("e", tn, CHEST_M), tolDeg: 25 };
  }
  // C: наземный враг ближе 5 м (Ученик — в круге 7 м); по летящему — никогда
  if (ground && ready(v, "c")) {
    const r = isNovice(v) ? EARTH.earthquake.radiusM - 0.5 : 5;
    const close = v.enemies.find((e) => e.visible && !e.heard && e.dist <= r && !inAir(e) && !(e.element === "air" && (e.gliding || Math.abs(e.vel.y) > 0.3)) && !chained(v, e));
    if (close) return { slot: "c", aim: null };
  }
  // Q: столб по стоящей, в диске, в канале ульты, на приземлении (Маг и выше — с упреждением места)
  const tq = visibleTarget(v, 0, EARTH.stonePillar.rangeM - 0.5);
  if (ground && tq && ready(v, "q") && !chained(v, tq)) {
    const tele = { windupS: EARTH.stonePillar.telegraphS };
    if (isNovice(v)) return at("q", tq, BODY_DY, {});
    const landing = !tq.airborne && tq.vel.y < -2;
    if (speedXZ(tq) < STILL_MS || tq.ward || tq.ult !== null || tq.windup !== null || landing || tq.rooted) return at("q", tq, BODY_DY, tele, { tolDeg: 3 });
    // Архимаг: «Жонглёр» — столб, затем камень в подброшенного (камень — ЛКМ с дугой)
    if (v.params.combos && tq.dist <= 14) return at("q", tq, BODY_DY, tele, { tolDeg: 3 });
  }
  return null;
}

function earthHold(self: Readonly<Unit>, params: Readonly<BotParams>, _t: Perceived | null, now: number): boolean {
  // без связок: сразу после своего столба камень не летит («Жонглёр» — только Архимаг)
  return params.combos || now >= self.mage!.ready.q - PILLAR_TICKS + NO_JUGGLE_TICKS;
}

// ---------------------------------------------------------------- Воздух

const SK = AIR.airSickle.projectile;
const GU = AIR.gust;

/** Воздух — хулиган 15–30 м с заходом на 5–6 м. Q Порыв к кромке, E Взмах, C Смерч у кромки, X Ураган. */
function airDecide(v: BotView, rand: () => number): CastPlan | null {
  const m = v.self.mage!;
  const t = v.target;
  const charges = m.charges.e;
  const nearGorge = v.voidM < SWOOP_KEEP_M || (t !== null && t.voidM < SWOOP_KEEP_M);
  // заход «Взмах в замахе Порыва» (Маг и выше): замах идёт — Взмах к цели, чтобы ударить с 2–6 м
  if (m.windup && m.windup.ability === "gust" && !isNovice(v) && charges > 0 && !m.dash && t && t.visible && t.dist >= SWOOP_M + 1.5) {
    const p = v.self.move.body.pos;
    const u = unit2(t.pos.x - p.x, t.pos.z - p.z);
    if (u && dashLandingOk(v.nav, p, u, SWOOP_M) && (!nearGorge || charges >= 2)) return { slot: "e", aim: null, move: u, moveM: SWOOP_M, urgent: true };
    return null;
  }
  if (busy(v)) return null;
  // X: 2+ врага в 8 м или один в 6 м и кромка за ним ≤ 8 м
  if (ultReady(v) && t && t.visible) {
    const near = v.enemies.filter((e) => e.visible && !e.heard && e.dist <= AIR.hurricane.radiusM - 1);
    const special = near.filter((e) => e.dist <= 8).length >= 2 || (t.dist <= 6 && ringOut(v, t, 8));
    if (ultGo(v, near, special)) return ultPlan(t, CHEST_M, 20);
  }
  // E: в беде — Взмах вбок (у ущелья бережёт один заряд); Ученик — когда цель в дальности
  if (charges > 0 && !m.dash && (!nearGorge || charges >= 2)) {
    const tel = threatInside(v, (h) => h.cls === "telegraph");
    if (trouble(v, rand) || (tel && !isNovice(v) && tel.etaS < 0.5)) {
      const d = dashDir(v, rand, tel?.escape ?? null, SWOOP_M);
      if (d) return { slot: "e", aim: null, move: d, moveM: SWOOP_M, urgent: true };
    }
    if (isNovice(v) && visibleTarget(v, 0, 30)) {
      const d = dashDir(v, rand, null, SWOOP_M);
      if (d) return { slot: "e", aim: null, move: d, moveM: SWOOP_M };
    }
  }
  // Q: сдуть шар, летящий в конус
  if (ready(v, "q") && !isNovice(v)) {
    const ball = threatInside(v, (h) => h.kind === "projectile" && h.ability === "fireball" && h.etaS < 0.55 && h.etaS > GU.windupS * 0.6);
    if (ball) return { slot: "q", aim: { x: ball.from.x, y: ball.from.y, z: ball.from.z }, tolDeg: 20, urgent: true };
  }
  const tq = visibleTarget(v, 0, isNovice(v) ? GU.rangeM : 14);
  if (tq && ready(v, "q") && !chained(v, tq) && !(tq.element === "water" && tq.ward)) {
    if (isNovice(v)) return at("q", tq, CHEST_M, {}, { tolDeg: 12 });
    const behind = tq.element === "earth" ? 2.5 : 5;
    const ring = ringOut(v, tq, behind);
    // в упор: кромка за целью ≤ 5 м (Земля — 2,5) или стена ≤ 4 м; рядом (≤ 4 м) — отбросить
    if (tq.dist <= 6 && (ring || wallBehind(v, tq, 4) || tq.dist <= 4)) return at("q", tq, CHEST_M, {}, { tolDeg: 10 });
    // заход: замах с 10–14 м, Взмах к цели в замахе (заряд останется)
    if (tq.dist >= 10 && ring && charges >= 2 && !m.dash) return at("q", tq, CHEST_M, {}, { tolDeg: 10 });
    // Архимаг: Смерч, потом Порыв — цель в своём Смерче
    if (v.params.combos && tq.dist <= 6.5 && ownZoneNear(v, "tornado", tq.pos, AIR.tornado.radiusM)) return at("q", tq, CHEST_M, {}, { tolDeg: 10 });
  }
  // C: Смерч на цель у кромки, на мосту или площадке руны — тянет к пустоте
  const tc = visibleTarget(v, 0, AIR.tornado.rangeM - 1);
  if (tc && ready(v, "c") && !chained(v, tc)) {
    const tele = { windupS: AIR.tornado.growS };
    if (isNovice(v)) return at("c", tc, BODY_DY, {});
    if (tc.voidM <= RING_M || speedXZ(tc) < STILL_MS || tc.ult !== null) return at("c", tc, BODY_DY, tele, { tolDeg: 4 });
  }
  return null;
}

/** Своя зона kind с центром ближе rM к точке. */
function ownZoneNear(v: BotView, kind: "tornado" | "spring", p: Vec3, rM: number): boolean {
  return v.state.zones.some((z) => z.owner === v.self.id && z.kind === kind && z.shape.type === "disc" && (z.shape.center.x - p.x) ** 2 + (z.shape.center.z - p.z) ** 2 <= rM * rM);
}

/** Воздух над пустотой: Взмах к полу, затем второй прыжок (Р9). */
function airRescue(v: BotView, rand: () => number): CastPlan | null {
  const m = v.self.mage!;
  if (v.now < v.self.status.noControlUntil || m.dash) return null;
  // Ученик правит полёт поздно (Р9): спасение — с шансом уровня; остальные выбираются всегда
  if (v.params.lateAirFix && !roll(v, rand, v.params.rescueChance, RESCUE_EPISODE_S, 60)) return null;
  if (m.charges.e > 0) {
    const d = rescueDir(v, SWOOP_M);
    if (d) return { slot: "e", aim: null, move: d, urgent: true, ttlS: 0.3 };
  }
  if (!m.flight.doubleJumped) {
    const d = rescueDir(v, 3) ?? rescueDir(v, 5);
    return { slot: null, aim: null, move: d, jump: true, holdJumpS: AIR.passive.glideS, urgent: true, ttlS: 0.2 };
  }
  return null;
}

// ---------------------------------------------------------------- Вода

const WG = WATER.waterGrab;

/** Вода — перехватчик 8–15 м. Q Хват, E Отражение от снаряда и кулаков, C Родник под себя, X Цунами к кромке. */
function waterDecide(v: BotView, rand: () => number): CastPlan | null {
  if (busy(v)) return null;
  const t = v.target;
  const self = v.self;
  // X: 2+ врага в полосе 14 м ближе 25 м или враг у ущелья, кромка за ним ≤ 8 м
  if (ultReady(v) && t && t.visible) {
    const band = onLine(v, t, 25, WATER.tsunami.widthM / 2);
    const special = band.length >= 2 || (t.dist <= 20 && ringOut(v, t, 8));
    if (ultGo(v, band, special)) return ultPlan(t, CHEST_M, 8);
  }
  // E: снаряд спереди долетит быстрее 0,6 с, льются кулаки, замах Порыва или Урагана рядом; против хлыста, столба — нет
  if (ready(v, "e")) {
    if (isNovice(v)) {
      const tn = visibleTarget(v, 0, 15);
      if (tn) return { ...at("e", tn, CHEST_M), tolDeg: 30 };
    } else {
      // диск держится 1 с: поднять можно и раньше, чем за 0,6 с до удара (мысль — раз в 1/thinkHz)
      const shot = threatInside(v, (h) => h.kind === "projectile" && h.etaS < 0.6 + 1 / v.params.thinkHz);
      if (shot) return { slot: "e", aim: { x: shot.from.x, y: shot.from.y, z: shot.from.z }, tolDeg: 35, urgent: true };
      const blow = threatInside(v, (h) => (h.ability === "gust" || h.ability === "hurricane") && h.etaS < 0.5);
      if (blow) return { slot: "e", aim: { x: blow.from.x, y: blow.from.y + CHEST_M, z: blow.from.z }, tolDeg: 60, urgent: true };
      const by = v.enemies.find((e) => e.id === self.lastHitBy);
      if (by && by.element === "fire" && by.visible && v.now - self.lastHitTick <= 20 && by.dist <= FF.rangeM && (self.hp < self.maxHp * 0.7 || roll(v, rand, 0.5, 1))) {
        return { slot: "e", aim: { x: by.pos.x, y: by.pos.y + CHEST_M, z: by.pos.z }, track: { id: by.id, dy: CHEST_M }, tolDeg: 30, urgent: true };
      }
    }
  }
  // C: Родник под себя при HP < 60 % или Горении (Осторожный — раньше); Маг и выше — под врага у моста
  if (ready(v, "c")) {
    const heal = 0.6 + (v.trait === "careful" ? 0.1 : 0);
    if (isNovice(v) ? visibleTarget(v, 0, 15) !== null : self.hp < self.maxHp * heal || self.status.burnPulses > 0) {
      return { slot: "c", aim: aheadOfSelf(v, 1.5), tolDeg: 8 };
    }
    const tb = visibleTarget(v, 3, WATER.spring.rangeM - 1);
    if (tb && tb.voidM < 2) return at("c", tb, BODY_DY, { windupS: WATER.spring.telegraphS }, { tolDeg: 4 });
  }
  // Q: Хват — цель в 6–14 м (стащить летуна, втянуть в Родник)
  const tq = visibleTarget(v, isNovice(v) ? 0 : 6, WG.projectile.rangeM - 1);
  if (tq && ready(v, "q") && !tq.ward && !chained(v, tq)) {
    return at("q", tq, 1, { speed: WG.projectile.speed, windupS: WG.windupS }, { tolDeg: 4 });
  }
  return null;
}

// ---------------------------------------------------------------- стойки

/** Огонь под сброс: за целью у кромки на 9 м — шар толкнёт к пустоте. */
const fireStance = (v: BotView): Vec3 | null => ringStance(v, RING_M, 9, readyIn(v, "q"));
/** Воздух: заход на 5 м за цель у кромки (Порыв 7 м), пока Порыв почти готов. */
const airStance = (v: BotView): Vec3 | null => ringStance(v, v.target?.element === "earth" ? 2.5 : 5, 5, readyIn(v, "q"));

// ---------------------------------------------------------------- киты

const always = (): boolean => true;

export const BOT_KITS: Readonly<Record<Element, BotKit>> = Object.freeze({
  fire: Object.freeze<BotKit>({
    bandM: Object.freeze([6, 15] as const),
    primary: Object.freeze({ speed: FF.speed, gravity: FF.gravity, rangeM: FF.rangeM, windupS: 0, instant: false }),
    ultRangeM: FIRE.dragonBreath.rangeM - 1,
    edgeBonus: 2,
    // Ученик жмёт без оглядки на жар (перегревается); остальные отпускают у предела (Р4)
    holdPrimary: (self, params) => params.heatCap === null || (self.mage?.heat ?? 0) < params.heatCap,
    decide: fireDecide,
    stance: fireStance,
    rescue: fireRescue,
  }),
  earth: Object.freeze<BotKit>({
    bandM: Object.freeze([12, 25] as const),
    primary: Object.freeze({ speed: SS.speed, gravity: SS.gravity, rangeM: SS.rangeM, windupS: EARTH.stoneShot.windupS, instant: false }),
    ultRangeM: EARTH.tectonicRift.lengthM - 1,
    edgeBonus: 1,
    holdPrimary: earthHold,
    decide: earthDecide,
  }),
  air: Object.freeze<BotKit>({
    bandM: Object.freeze([15, 30] as const),
    primary: Object.freeze({ speed: SK.speed, gravity: SK.gravity, rangeM: SK.rangeM, windupS: 0, instant: false }),
    ultRangeM: AIR.hurricane.radiusM - 1,
    edgeBonus: 2,
    holdPrimary: always,
    decide: airDecide,
    stance: airStance,
    rescue: airRescue,
  }),
  water: Object.freeze<BotKit>({
    bandM: Object.freeze([8, 15] as const),
    primary: Object.freeze({ speed: Infinity, gravity: 0, rangeM: WATER.waterWhip.rangeM, windupS: WATER.waterWhip.windupS, instant: true }),
    ultRangeM: 20,
    edgeBonus: 2,
    holdPrimary: always,
    decide: waterDecide,
  }),
});
