import { bodyBox } from "../body";
import type { Pickup, Vec3 } from "../types";
import { healUnit } from "./combat";
import { PICKUPS, ticks } from "./defs";
import { unitById } from "./state";
import { NEVER, NOBODY, type MatchState, type PickupState, type TickCtx, type Unit, type UnitId } from "./types";
import { gainUlt } from "./ult";

/**
 * Объекты на карте (GDD 3; Р1–Р5 фазы 6): сферы жизни и руна ярости. Состояние — в MatchState.pickups, поэтому хост
 * считает, а игрок предсказывает их тем же шагом. Функции меняют состояние на месте и пишут события в t.ev.
 */

const ORB_RESPAWN_TICKS = ticks(PICKUPS.orb.respawnS); // 900
const RUNE_FIRST_TICKS = ticks(PICKUPS.rune.firstS); // 2700
const RUNE_EVERY_TICKS = ticks(PICKUPS.rune.everyS); // 3600
const RUNE_WARN_TICKS = ticks(PICKUPS.rune.warnS); // 600
const FURY_TICKS = ticks(PICKUPS.rune.furyS); // 720
const ORB_REACH2 = PICKUPS.orb.reachM * PICKUPS.orb.reachM;
const RUNE_REACH2 = PICKUPS.rune.reachM * PICKUPS.rune.reachM;

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

/** Состояние объектов арены на тике now: сферы лежат сразу (readyAt NEVER — без события spawn), руна — на now + 45 с. */
export function initPickups(list: readonly Pickup[], now: number): PickupState[] {
  return list.map((p) => ({ kind: p.kind, pos: copy(p.pos), readyAt: p.kind === "rune" ? now + RUNE_FIRST_TICKS : NEVER }));
}

/** Объект лежит на тике now. */
export const pickupPresent = (p: Readonly<PickupState>, now: number): boolean => now >= p.readyAt;

/** Носитель ярости: живой, now < furyUntil. */
export function hasFury(u: Readonly<Unit>, now: number): boolean {
  return u.alive && now < u.status.furyUntil;
}

/** Квадрат расстояния от точки до бокса тела (0 — внутри). Без корня: сравнение точно и одинаково у хоста и игрока. */
function dist2ToBody(u: Unit, p: Vec3): number {
  const b = bodyBox(u.move.body);
  const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
  const dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y);
  const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Кто берёт объект (Р3): живой маг в досягаемости; сферу — только раненый (HP < максимума): полный пробегает насквозь.
 * Касаются двое — ближний, при равенстве — меньший id. Никого — undefined.
 */
function taker(s: MatchState, p: PickupState): Unit | undefined {
  const reach2 = p.kind === "orb" ? ORB_REACH2 : RUNE_REACH2;
  let best: Unit | undefined;
  let bestD2 = Infinity;
  for (const u of s.units) {
    if (!u.alive || !u.mage || (p.kind === "orb" && !(u.hp < u.maxHp))) continue;
    const d2 = dist2ToBody(u, p.pos);
    if (d2 > reach2) continue;
    if (d2 < bestD2 || (d2 === bestD2 && best !== undefined && u.id < best.id)) {
      best = u;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * Следующая отметка руны (Р2), взятой на тике now: отметки идут от mark (на ней руна появилась) каждые 60 с; берётся
 * первая M с M − 10 с > now — объявление всегда получает свои 10 с.
 */
function nextRuneMark(mark: number, now: number): number {
  return mark + (Math.floor((now + RUNE_WARN_TICKS - mark) / RUNE_EVERY_TICKS) + 1) * RUNE_EVERY_TICKS;
}

/**
 * Шаг объектов (stepMatch, после stepTerrain, до stepStatuses): по индексу — руна на readyAt − 600 → pickup/warn;
 * на readyAt → pickup/spawn; лежит — касание (Р3) → подбор и pickup/take. Сфера: healUnit(+35, источник NOBODY), readyAt = now + 900.
 * Руна: furyUntil = now + 720, событие status fury (ticks 720, source — сам маг), readyAt — следующая отметка (Р2).
 */
export function stepPickups(s: MatchState, t: TickCtx): void {
  const now = t.now;
  s.pickups.forEach((p, index) => {
    if (p.kind === "rune" && now === p.readyAt - RUNE_WARN_TICKS) t.ev.push({ type: "pickup", kind: p.kind, index, phase: "warn", unit: NOBODY, pos: copy(p.pos) });
    if (now === p.readyAt) t.ev.push({ type: "pickup", kind: p.kind, index, phase: "spawn", unit: NOBODY, pos: copy(p.pos) });
    if (!pickupPresent(p, now)) return;
    const u = taker(s, p);
    if (!u) return;
    t.ev.push({ type: "pickup", kind: p.kind, index, phase: "take", unit: u.id, pos: copy(p.pos) });
    if (p.kind === "orb") {
      // лечит карта, а не маг: источника нет, и Вода не принимает это за свой «Круговорот»
      healUnit(s, t, u.id, PICKUPS.orb.heal, NOBODY);
      p.readyAt = now + ORB_RESPAWN_TICKS;
    } else {
      // новая руна в ярости обновляет её до полных 12 с (Р4)
      u.status.furyUntil = now + FURY_TICKS;
      t.ev.push({ type: "status", target: u.id, status: "fury", ticks: FURY_TICKS, source: u.id });
      p.readyAt = nextRuneMark(p.readyAt, now);
    }
  });
}

/**
 * Конец ярости (stepMatch, в самом начале тика — до ввода и урона): живым магам с furyUntil === now — fury/end. На этом
 * тике ярости уже нет, поэтому смерть позже в том же тике не теряет событие (furyOnDeath молчит: now < furyUntil ложно).
 * furyUntil 0 — ярости не было (свежий маг на тике 0).
 */
export function stepFuryEnd(s: MatchState, t: TickCtx): void {
  const now = t.now;
  for (const u of s.units) {
    if (!u.alive || !u.mage || u.status.furyUntil !== now || now === 0) continue;
    t.ev.push({ type: "fury", unit: u.id, phase: "end", by: NOBODY, pos: copy(u.move.body.pos) });
  }
}

/**
 * Смерть юнита: был носителем (now < furyUntil) — furyUntil = now, событие fury/slain; by не NOBODY и не сам — +10 к
 * ульте (gainUlt, × ultChargeMul). Зовут applyHit (ветка смерти, после ultOnKill, by = source) и stepLife (сброс, by = credit).
 */
export function furyOnDeath(s: MatchState, t: TickCtx, victim: Unit, by: UnitId): void {
  const st = victim.status;
  if (!(t.now < st.furyUntil)) return;
  st.furyUntil = t.now;
  const killer = by === victim.id ? NOBODY : by;
  t.ev.push({ type: "fury", unit: victim.id, phase: "slain", by: killer, pos: copy(victim.move.body.pos) });
  const k = killer === NOBODY ? undefined : unitById(s, killer);
  if (k) gainUlt(t, k, PICKUPS.rune.killUlt);
}
