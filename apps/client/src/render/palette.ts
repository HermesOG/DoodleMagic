import type { Element, Material } from "@doodlemagic/sim";

export type RGB = readonly [number, number, number];

/** Цвет из шестнадцатеричной записи дизайн-документов (`0xEBE0C9`) — в пространстве экрана (sRGB), 0…1. */
export const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/**
 * Номера чернил в G-буфере (канал G хранит id / 255). 0 — пиксель без геометрии (небо).
 * Три слоя яркости (GDD 6), все по одной яркости `luminance`: мир — средние тона в приглушённых красках,
 * заливки врагов — темнее любой заливки мира, магия — самое насыщенное и ярче любой другой заливки.
 * Бумага и небо — фон, в правило не входят. Контуры (`line`) — линии туши, а не заливки: чёрная линия
 * мира темнее врага по замыслу, правило «враги — самое тёмное» на них не распространяется.
 * Метки — не заливки слоя: ореол врага (`halo`) — кромка в пару пикселей вокруг силуэта, как контур,
 * вспышка попадания (`flash`) — инверсия на 60 мс, ореол горения (`haloBurn`) — та же кромка, тёплая,
 * глаза (`eye*`) — две точки в маске цветом стихии. Рельеф Земли (`terrain`) — заливка мира: средний тон.
 * Знамёна (`clothA`, `clothB`), окно фонаря (`lantern`) — декор мира; рукав (`sleeve`) — свои руки,
 * цвет по стихии меняется на ходу (`SLEEVE_WASH`), но по правилам мира.
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
  clothA: 13,
  clothB: 14,
  lantern: 15,
  sleeve: 16,
  eyeFire: 17,
  eyeEarth: 18,
  eyeAir: 19,
  eyeWater: 20,
  haloBurn: 21,
} as const;
export type InkName = keyof typeof INK;
export const INK_COUNT = 22;

export function inkOf(m: Material): number {
  return INK[m];
}

/** Чернила глаз в маске мага по стихии (метки, как ореол). */
export const EYE_INK: Record<Element, number> = {
  fire: INK.eyeFire,
  earth: INK.eyeEarth,
  air: INK.eyeAir,
  water: INK.eyeWater,
};

/**
 * Тушь рукава своих рук по стихии: приглушённые, по правилам мира. Чистый цвет манжеты вышел бы за предел
 * насыщенности, а у Огня ушёл бы к красному HP. Шейдер читает её из `styleShared.sleeveWash` (stylePass).
 */
export const SLEEVE_WASH: Record<Element, RGB> = {
  fire: hex(0x804d33),
  earth: hex(0x5e5738),
  air: hex(0x8c87a6),
  water: hex(0x2e4a6e),
};

/** Цвет бумаги: тёплая чайная «Горного монастыря» (яркость 0,88). Все цвета — в пространстве экрана (sRGB). */
export const PAPER: RGB = hex(0xebe0c9);

export interface InkStyle {
  /** Цвет туши при полной плотности. */
  wash: RGB;
  /** Плотность размывки в трёх тонах: свет, полутон, тень. */
  bands: RGB;
  /** Цвет контура — линия туши, вне правила трёх слоёв. */
  line: RGB;
  /** Доля тёплого света и холодной тени `BAND_TINT`: 1 — стены, нет (0) — ровный тон, как у пола-холста. */
  tint?: number;
}

/** Линия туши мира: с синевой, в тон холодной тени. */
const LINE: RGB = hex(0x1a1c26);
/** Линия рук и рукава — тёплая, как была. */
const HAND_LINE: RGB = [0.12, 0.11, 0.1];
/** Линия глаза — тот же оттенок темнее: точка читается цветом, а не чёрным кружком. */
const eyeLine = (c: RGB): RGB => [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];

export const INK_STYLE: Record<InkName, InkStyle> = {
  sky: { wash: PAPER, bands: [0, 0, 0], line: LINE },
  // холодная синеватая тушь на тёплой бумаге: тёплый свет 0,60, полутон 0,49, холодная тень 0,38
  stone: { wash: hex(0x384254), bands: [0.45, 0.62, 0.8], line: LINE, tint: 1 },
  // пол нейтральный — холст для телеграфов, подпалин и света огня (насыщенность ≤ 0,1)
  floor: { wash: hex(0x5c667a), bands: [0.5, 0.6, 0.7], line: LINE },
  // кровля и венцы — индиго, тёмный силуэт монастыря на небе (выше 3 м)
  roof: { wash: hex(0x2b3652), bands: [0.6, 0.72, 0.82], line: LINE },
  // сухая трава-солома: цвет говорит «горит»
  // плотность света 0,54, а не 0,55 плана: при 0,55 насыщенность в свету 0,352 > предела 0,35
  grass: { wash: hex(0x8c7533), bands: [0.54, 0.62, 0.7], line: [0.25, 0.2, 0.1] },
  // кромка ущелья и цоколи — рисунок тушью у самого пола
  edge: { wash: [0.15, 0.14, 0.13], bands: [0.75, 0.78, 0.8], line: [0.05, 0.05, 0.05] },
  gold: { wash: [0.74, 0.6, 0.34], bands: [0.45, 0.6, 0.75], line: [0.35, 0.24, 0.08] },
  hands: { wash: [0.55, 0.52, 0.48], bands: [0.24, 0.34, 0.48], line: HAND_LINE },
  enemy: { wash: [0.06, 0.06, 0.07], bands: [0.88, 0.92, 0.95], line: [0.02, 0.02, 0.02] },
  // светящееся тёпло-жёлтое ядро: ярче всех заливок и насыщеннее любой из них
  magic: { wash: [1, 0.92, 0.34], bands: [1, 1, 1], line: [0.6, 0.3, 0.05] },
  // белый ореол врага (GDD 6) — ярче бумаги, кромка мягкая
  halo: { wash: [1, 1, 1], bands: [1, 1, 1], line: [0.72, 0.71, 0.68] },
  // инверсия попадания на 60 мс: тёмная тушь врага становится бумагой
  flash: { wash: [1, 0.99, 0.96], bands: [1, 1, 1], line: [0.3, 0.3, 0.3] },
  // камень Земли: тёплая тяжёлая умбра, не сливается с холодными стенами арены
  terrain: { wash: hex(0x5c4d3d), bands: [0.62, 0.74, 0.86], line: [0.1, 0.09, 0.08] },
  // знамёна: индиго зеркальной половины A и приглушённая охра половины B (выше 1,8 м)
  clothA: { wash: hex(0x293d6b), bands: [0.6, 0.72, 0.82], line: LINE },
  clothB: { wash: hex(0x8f7042), bands: [0.6, 0.72, 0.82], line: LINE },
  // окно фонаря — ровная тёплая бумага тоном ≤ 0,66 в рамке тушью; не светит
  lantern: { wash: hex(0xbba57c), bands: [1, 1, 1], line: LINE },
  // рукав: тушь по стихии (по умолчанию — Огонь), в шейдере её меняет setSleeveElement
  // тень 0,78, а не 0,8 плана: при 0,8 тень рукава Огня даёт насыщенность 0,458 > предела 0,45
  sleeve: { wash: SLEEVE_WASH.fire, bands: [0.5, 0.65, 0.78], line: HAND_LINE },
  // глаза в маске — чистый цвет стихии, без тона
  eyeFire: { wash: hex(0xff7a1a), bands: [1, 1, 1], line: eyeLine(hex(0xff7a1a)) },
  eyeEarth: { wash: hex(0x2a9e62), bands: [1, 1, 1], line: eyeLine(hex(0x2a9e62)) },
  eyeAir: { wash: hex(0x6a55c8), bands: [1, 1, 1], line: eyeLine(hex(0x6a55c8)) },
  eyeWater: { wash: hex(0x1e8bd0), bands: [1, 1, 1], line: eyeLine(hex(0x1e8bd0)) },
  // ореол горящего врага: тёплая кромка вместо белой
  haloBurn: { wash: hex(0xffc48a), bands: [1, 1, 1], line: [0.8, 0.6, 0.42] },
};

/** Чернила по номеру — в том порядке, в каком их ждёт шейдер. */
export const INK_BY_ID: readonly InkName[] = (Object.keys(INK) as InkName[]).sort((a, b) => INK[a] - INK[b]);

/**
 * Температура тона: множители цвета размывки в свету, полутоне и тени. Тёплый свет и холодная тень дают объём
 * по температуре, а не только по плотности. Достаются чернилам по их доле `tint` (стенам — целиком).
 */
export const BAND_TINT: readonly [RGB, RGB, RGB] = [
  [1.04, 1, 0.92],
  [1, 1, 1],
  [0.97, 1, 1.04],
];

/**
 * Итоговый цвет тона, как в стилевом проходе: бумага, на которую положена размывка с плотностью полосы,
 * и температура тона. `wash` — другая тушь тех же чернил (рукав по стихии).
 */
export function washColor(ink: InkName, band: 0 | 1 | 2, wash: RGB = INK_STYLE[ink].wash): RGB {
  const s = INK_STYLE[ink];
  const d = s.bands[band];
  const k = s.tint ?? 0;
  const t = BAND_TINT[band];
  const at = (i: 0 | 1 | 2): number => (PAPER[i] + (wash[i] - PAPER[i]) * d) * (1 + (t[i] - 1) * k);
  return [at(0), at(1), at(2)];
}

/**
 * Небо ясного дня, дымка и ущелье (стилевой проход). Небо — градиент от тёплого горизонта к голубому зениту,
 * светлые облака плывут, два хребта уходят подножиями в дымку; у горизонта со стороны солнца — тёплое пятно
 * `sunGlow` (прибавка к цвету), без диска. Ущелье и всё ниже горизонта — облака в тени, от светлого верха
 * `gorgeTop` к тёмной глубине `gorgeDeep`: темнее бумаги, чтобы магия над ущельем не выгорала.
 */
export const SKY = {
  zenith: hex(0x8fb0d6),
  horizon: hex(0xf0d9ba),
  // красный ≤ 0,055: горизонт + пятно + зерно бумаги не упираются в 1
  sunGlow: [0.055, 0.04, 0.01] as RGB,
  cloud: hex(0xf4eee2),
  ridgeFar: hex(0xa9b4c8),
  ridgeNear: hex(0x7d889f),
  haze: hex(0xc9d1d6),
  gorgeTop: hex(0xb5c2cc),
  gorgeDeep: hex(0x8c99a8),
} as const;

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
