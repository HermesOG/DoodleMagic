/**
 * PRNG ботов (mulberry32): состояние — одно 32-битное целое, его держит память бота как простое число. Только целочисленные
 * операции (Math.imul, сдвиги): одинаковое состояние даёт одинаковую последовательность в любом JS-движке.
 */

/** Следующее значение value ∈ [0, 1) и новое состояние. Аргумент не меняется. */
export function nextRandom(state: number): { value: number; state: number } {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: s };
}

/** Начальное состояние из сида и номера (хост даёт сид комнаты и id бота): перемешано, чтобы соседние сиды не шли рядом. */
export function seedRandom(seed: number, salt = 0): number {
  let h = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((salt | 0) + 0x632be5ab, 0xc2b2ae35)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) | 0;
}
