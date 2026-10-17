import type { Material } from "@doodlemagic/sim";

export type RGB = readonly [number, number, number];

/**
 * Номера чернил в G-буфере (канал G хранит id / 255). 0 — пиксель без геометрии (небо).
 * Три слоя яркости (GDD 6), все по одной яркости `luminance`: мир — средние тона без насыщенности,
 * заливки врагов — темнее любой заливки мира, магия — единственное насыщенное и ярче любой другой заливки.
 * Бумага и небо — фон, в правило не входят. Контуры (`line`) — линии туши, а не заливки: чёрная линия
 * мира темнее врага по замыслу, правило «враги — самое тёмное» на них не распространяется.
 * Ореол врага (`halo`) и вспышка попадания (`flash`) — тоже не заливки слоя: ореол — кромка в пару пикселей
 * вокруг силуэта, как контур, вспышка — инверсия на 60 мс. Они светлее бумаги по замыслу, но без насыщенности.
 * Рельеф Земли (`terrain`) — заливка мира: средний тон.
 */
export const INK = {
  sky: 0,
  stone: 1,
  floor: 2,
  roof: 3,
  grass: 4,
  edge: 5,
  gold: 6,
  hands: 7,
  enemy: 8,
  magic: 9,
  halo: 10,
  flash: 11,
  terrain: 12,
} as const;
export type InkName = keyof typeof INK;
export const INK_COUNT = 13;

export function inkOf(m: Material): number {
  return INK[m];
}

/** Цвет бумаги: тёплая сепия «Горного монастыря». Все цвета — в пространстве экрана (sRGB). */
export const PAPER: RGB = [0.95, 0.93, 0.88];

export interface InkStyle {
  /** Цвет туши при полной плотности. */
  wash: RGB;
  /** Плотность размывки в трёх тонах: свет, полутон, тень. */
  bands: RGB;
  /** Цвет контура — линия туши, вне правила трёх слоёв. */
  line: RGB;
}

const LINE: RGB = [0.1, 0.09, 0.08];

export const INK_STYLE: Record<InkName, InkStyle> = {
  sky: { wash: PAPER, bands: [0, 0, 0], line: LINE },
  stone: { wash: [0.3, 0.29, 0.27], bands: [0.25, 0.5, 0.75], line: LINE },
  floor: { wash: [0.42, 0.4, 0.37], bands: [0.32, 0.5, 0.66], line: LINE },
  roof: { wash: [0.22, 0.21, 0.22], bands: [0.25, 0.5, 0.72], line: LINE },
  grass: { wash: [0.36, 0.4, 0.3], bands: [0.35, 0.5, 0.65], line: [0.2, 0.22, 0.16] },
  edge: { wash: [0.15, 0.14, 0.13], bands: [0.75, 0.78, 0.8], line: [0.05, 0.05, 0.05] },
  gold: { wash: [0.74, 0.6, 0.34], bands: [0.45, 0.6, 0.75], line: [0.35, 0.24, 0.08] },
  hands: { wash: [0.55, 0.52, 0.48], bands: [0.24, 0.34, 0.48], line: [0.12, 0.11, 0.1] },
  enemy: { wash: [0.06, 0.06, 0.07], bands: [0.88, 0.92, 0.95], line: [0.02, 0.02, 0.02] },
  // светящееся тёпло-жёлтое ядро: ярче всех заливок и единственное насыщенное
  magic: { wash: [1, 0.92, 0.34], bands: [1, 1, 1], line: [0.6, 0.3, 0.05] },
  // белый ореол врага (GDD 6) — ярче бумаги, кромка мягкая
  halo: { wash: [1, 1, 1], bands: [1, 1, 1], line: [0.72, 0.71, 0.68] },
  // инверсия попадания на 60 мс: тёмная тушь врага становится бумагой
  flash: { wash: [1, 0.99, 0.96], bands: [1, 1, 1], line: [0.3, 0.3, 0.3] },
  // камень Земли: средний тон, чуть светлее и теплее камня арены
  terrain: { wash: [0.36, 0.35, 0.32], bands: [0.3, 0.52, 0.72], line: [0.1, 0.09, 0.08] },
};

/** Чернила по номеру — в том порядке, в каком их ждёт шейдер. */
export const INK_BY_ID: readonly InkName[] = (Object.keys(INK) as InkName[]).sort((a, b) => INK[a] - INK[b]);

/** Итоговый цвет тона: бумага, на которую положена размывка с плотностью полосы. */
export function washColor(ink: InkName, band: 0 | 1 | 2): RGB {
  const s = INK_STYLE[ink];
  const d = s.bands[band];
  return [PAPER[0] + (s.wash[0] - PAPER[0]) * d, PAPER[1] + (s.wash[1] - PAPER[1]) * d, PAPER[2] + (s.wash[2] - PAPER[2]) * d];
}

/** Яркость по Rec. 709 в пространстве экрана — для правила трёх слоёв. */
export const luminance = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Насыщенность HSV. */
export function saturation(c: RGB): number {
  const max = Math.max(c[0], c[1], c[2]);
  const min = Math.min(c[0], c[1], c[2]);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Направление солнца в мире: сверху-сзади-справа. Тон грани в G-буфере — полуламберт `halfLambert`,
 * 0,5 + 0,5·(n·L): верх граней в свету, стороны +x и +z в полутоне, −x и −z в тени (проверяет тест палитры).
 */
export const SUN_DIR: readonly [number, number, number] = (() => {
  const v = [0.45, 0.85, 0.3];
  const l = Math.sqrt(v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2);
  return [v[0]! / l, v[1]! / l, v[2]! / l] as const;
})();

/** Освещённость полуламберта, как в шейдере G-буфера: 0,5 + 0,5·(n·L) для единичных n и L. */
export function halfLambert(n: readonly [number, number, number], l: readonly [number, number, number]): number {
  return 0.5 + 0.5 * (n[0] * l[0] + n[1] * l[1] + n[2] * l[2]);
}

/**
 * Пороги трёх тонов размывки по освещённости t (стилевой проход берёт их отсюда):
 * t < mid — тень, mid…light — полутон, t > light — свет. soft — полуширина плавного перехода,
 * jitter — наибольший сдвиг порога шумом, чтобы граница тона была мазком, а не линейкой.
 */
export const TONE = { mid: 0.5, light: 0.82, soft: 0.03, jitter: 0.04 } as const;

/** Тон размывки по освещённости без шума: 0 — свет, 1 — полутон, 2 — тень (индекс в `bands`). */
export function toneBand(t: number): 0 | 1 | 2 {
  return t > TONE.light ? 0 : t > TONE.mid ? 1 : 2;
}
