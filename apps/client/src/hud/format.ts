import { FIRE, MAGE_REGEN, slotCooldownTicks, type MageState, type Slot, type Unit, type UnitId, type Vec3 } from "@doodlemagic/sim";

/** Цифра урона: целое, не меньше 1; воздушное попадание (+15 %, GDD 4.6) — со стрелкой вверх. */
export function formatDamage(n: number, air: boolean): string {
  return `${Math.max(1, Math.round(Number.isFinite(n) ? n : 0))}${air ? "↑" : ""}`;
}

/** Всплывающая цифра урона: born — появилась, updated — последний раз к ней прибавили урон по времени, с. */
export interface FloatingNumber {
  target: UnitId;
  amount: number;
  dot: boolean;
  air: boolean;
  pos: Vec3;
  born: number;
  updated: number;
}

/** Окно слияния урона по времени: импульсы ближе 0,4 с к прошлому — одна растущая цифра (round2/03, п. 7). */
export const DOT_MERGE_S = 0.4;

/** Новая цифра; урон по времени прибавляется к последней цифре урона по времени той же цели, если она свежая. */
export function mergeNumbers(
  list: FloatingNumber[],
  e: { target: UnitId; amount: number; dot: boolean; air: boolean; pos: Vec3 },
  nowS: number,
): FloatingNumber[] {
  if (e.dot) {
    for (let k = list.length - 1; k >= 0; k--) {
      const n = list[k]!;
      if (!n.dot || n.target !== e.target) continue;
      if (nowS - n.updated > DOT_MERGE_S) break;
      const merged: FloatingNumber = { ...n, amount: n.amount + e.amount, air: n.air || e.air, updated: nowS };
      return [...list.slice(0, k), merged, ...list.slice(k + 1)];
    }
  }
  return [...list, { target: e.target, amount: e.amount, dot: e.dot, air: e.air, pos: { ...e.pos }, born: nowS, updated: nowS }];
}

/** Сколько живёт цифра, с: к этому возрасту она погасла. */
export const NUMBER_LIFE_S = 0.9;

/** Анимация цифры по возрасту: подскок 1,4 → 1 за 0,12 с, подъём 0,6 м за 0,8 с, видна до 0,5 с, гаснет к 0,9 с. */
export function numberAnim(ageS: number): { dy: number; scale: number; alpha: number } {
  const a = Number.isFinite(ageS) ? Math.max(0, ageS) : 0;
  const pop = 1 - Math.min(1, a / 0.12);
  return {
    dy: 0.6 * Math.min(1, a / 0.8),
    scale: 1 + 0.4 * pop * pop,
    alpha: a <= 0.5 ? 1 : Math.max(0, 1 - (a - 0.5) / (NUMBER_LIFE_S - 0.5)),
  };
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Сколько перезарядки слота осталось, 0…1 (now — тик): 1 — только что, 0 — готов. */
export function cooldownFraction(m: MageState, slot: Slot, now: number): number {
  return clamp01((m.ready[slot] - now) / slotCooldownTicks(m.element, slot));
}

/** Жар Огня 0…1. */
export function heatFraction(m: MageState): number {
  return clamp01(m.heat / FIRE.heat.max);
}

/** Полоса HP: доля, засечка, до которой маг лечится сам (⅔, GDD 3), и «hp / max». */
export function hpBar(u: Unit): { frac: number; notch: number; text: string } {
  // HP бывает дробным (лечение 20/с по тикам, +15 % в воздухе): живому не показываем 0
  const hp = Math.max(0, Math.ceil(u.hp - 1e-9));
  return { frac: clamp01(u.hp / u.maxHp), notch: u.kind === "mage" ? MAGE_REGEN.capFrac : 1, text: `${hp} / ${u.maxHp}` };
}
