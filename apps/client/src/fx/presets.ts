import type { Element, ProjectileKind, Vec3 } from "@doodlemagic/sim";
import type { BurstPreset } from "../feel/effects";
import { AIR_BURSTS, AIR_PALM, AIR_TRAILS } from "./presets.air";
import { WATER_BURSTS, WATER_PALM, WATER_TRAILS } from "./presets.water";
import { FX_COLOR, L, UP, clamp01, emit, hex, mixRGB, randomUnit, spawn, lerp, type Layer, type PalmLayers, type ParticleSpec, type TrailFn } from "./particleKit";
import { luminance } from "../render/palette";
import type { PresetId } from "../render/quality";

export { FX_COLOR, SMOKE_ALPHA, type ParticleSpec } from "./particleKit";

/**
 * Золото объектов карты (фаза 6; GDD 6: руна, корона и сферы — «золото с печатью»): желтее и светлее огня, чтобы
 * руна не читалась Огнём. deep — искры и угли, light — тело света и свечения, pale — ядро и блик.
 */
export const GOLD = { deep: hex(0xe0a526), light: hex(0xffd04d), pale: hex(0xfff2c6) } as const;

/**
 * Свет частиц (альфа 0) — в золото на месте: по яркости исходного цвета слоя — от deep (угли) через light (свечение)
 * к pale (ядро). Плотные частицы не трогает. Возвращает тот же массив.
 */
export function toGold<T extends ParticleSpec[]>(specs: T): T {
  for (const s of specs) {
    if (s.alpha > 0) continue;
    const k = clamp01((luminance(s.color) - 0.3) / 0.6);
    s.color = k < 0.5 ? mixRGB(GOLD.deep, GOLD.light, k * 2) : mixRGB(GOLD.light, GOLD.pale, k * 2 - 1);
  }
  return specs;
}

/** Частиц на кадр по пресету качества (план, Global Constraints): мировой пул — 4/5, пул ладоней — 1/5. */
export const PARTICLE_BUDGET: Readonly<Record<PresetId, number>> = { low: 600, medium: 1500, high: 3000 };
/** Источников магического света на поверхности мира (GDD 6, в проходе света, без PointLight). */
export const MAGIC_LIGHTS: Readonly<Record<PresetId, number>> = { low: 2, medium: 4, high: 8 };
/** Живых частиц на один всплеск — не больше (round1/05, согласование с гейм-эффектником). */
export const MAX_BURST = 150;

export function poolCaps(p: PresetId): { world: number; palm: number } {
  const total = PARTICLE_BUDGET[p];
  const world = Math.round((total * 4) / 5);
  return { world, palm: total - world };
}

/**
 * Всплески по пресетам (числа — на scale = 1). Огонь — вверх, рвано, 0,3–0,6 с, свет; Земля — осколки вниз
 * с g ≥ 9 и пыль цвета бумаги (GDD 6, round1/05). dir — нормаль удара или направление броска.
 */
const BURSTS: Readonly<Record<BurstPreset, readonly Layer[]>> = {
  fistFlash: [L("core", 3, "sphere", [0.2, 0.6], [0.06, 0.1], [0.3, 0.45], [0.55, 0.8]), L("ember", 6, "cone", [3, 6], [0.1, 0.2], [0.05, 0.08], [0.02, 0.03], { cone: 0.6 })],
  fistImpact: [
    L("core", 3, "sphere", [0, 0.5], [0.08, 0.14], [0.5, 0.7], [0.9, 1.2]),
    L("ember", 12, "hemi", [3, 8], [0.15, 0.3], [0.05, 0.09], [0.02, 0.03], { gravity: 8 }),
    L("flame", 5, "hemi", [1, 2.5], [0.3, 0.4], [0.18, 0.28], [0.35, 0.5]),
    L("smoke", 2, "hemi", [0.3, 0.8], [0.5, 0.8], [0.25, 0.35], [0.6, 0.9]),
  ],
  fireballCharge: [
    L("glow", 10, "converge", [0, 0], [0.2, 0.25], [0.12, 0.2], [0.3, 0.45], { r0: 0.7 }),
    L("ember", 8, "converge", [0, 0], [0.18, 0.25], [0.05, 0.07], [0.03, 0.04], { r0: 0.9, gravity: 0 }),
  ],
  fireballBoom: [
    L("core", 10, "sphere", [0, 2], [0.12, 0.25], [1.0, 1.6], [2.4, 3.4]),
    L("flame", 34, "sphere", [2.5, 6], [0.32, 0.62], [0.6, 0.9], [1.3, 1.9], { up: 1.5, r0: 0.6, gravity: -3.4 }),
    L("ember", 24, "sphere", [6, 13], [0.3, 0.6], [0.06, 0.1], [0.03, 0.04], { gravity: 9, up: 2 }),
    L("smoke", 12, "sphere", [1.5, 3.5], [0.8, 1.3], [0.6, 0.9], [1.9, 2.7], { up: 1, r0: 0.6 }),
  ],
  dashBlast: [
    L("core", 4, "sphere", [0, 1], [0.1, 0.18], [0.7, 1.0], [1.4, 1.8]),
    L("flame", 18, "cone", [3, 7], [0.3, 0.5], [0.4, 0.6], [0.9, 1.3], { cone: 0.7, r0: 0.3 }),
    L("ember", 12, "cone", [5, 10], [0.3, 0.5], [0.05, 0.08], [0.02, 0.03], { cone: 0.9 }),
  ],
  fireWallSparks: [
    L("ember", 18, "up", [2, 5], [0.25, 0.5], [0.05, 0.08], [0.02, 0.03], { r0: 0.6, gravity: 6 }),
    L("glow", 4, "up", [0.3, 0.8], [0.3, 0.4], [0.25, 0.35], [0.4, 0.5], { r0: 0.4 }),
  ],
  fireWallIgnite: [
    L("flame", 28, "up", [2, 5], [0.35, 0.6], [0.5, 0.8], [1.0, 1.5], { r0: 2.5 }),
    L("core", 6, "up", [0.5, 1.5], [0.15, 0.3], [0.9, 1.3], [1.8, 2.4], { r0: 2 }),
    L("ember", 16, "up", [4, 8], [0.3, 0.6], [0.05, 0.08], [0.02, 0.03], { r0: 2.5, gravity: 6 }),
  ],
  burnLick: [
    L("flame", 5, "up", [0.6, 1.4], [0.3, 0.5], [0.16, 0.24], [0.04, 0.08], { r0: 0.25 }),
    L("glow", 2, "up", [0.4, 0.8], [0.3, 0.45], [0.3, 0.4], [0.15, 0.2], { r0: 0.2 }),
  ],
  stoneCrumble: [
    L("chip", 8, "sphere", [1, 3], [0.5, 0.8], [0.06, 0.1], [0.04, 0.06], { up: 1 }),
    L("dust", 8, "sphere", [0.4, 1.2], [0.6, 0.9], [0.25, 0.35], [0.6, 0.8]),
  ],
  stoneImpact: [
    L("chip", 14, "hemi", [2.5, 6], [0.5, 0.9], [0.07, 0.13], [0.04, 0.07], { up: 1.5 }),
    L("dust", 12, "hemi", [0.8, 2.4], [0.7, 1.1], [0.3, 0.45], [0.8, 1.2]),
    L("jade", 4, "hemi", [1.5, 3], [0.2, 0.35], [0.06, 0.09], [0.02, 0.03]),
  ],
  pillarCracks: [
    L("dust", 10, "ring", [0.3, 0.8], [0.6, 0.9], [0.25, 0.35], [0.6, 0.8], { r0: 0.2, r1: 0.8, up: 0.4 }),
    L("jade", 6, "up", [0.5, 1.2], [0.3, 0.5], [0.06, 0.09], [0.02, 0.03], { r0: 0.6, gravity: 1 }),
  ],
  pillarBurst: [
    L("chip", 26, "up", [5, 9], [0.6, 1.0], [0.08, 0.15], [0.05, 0.08], { r0: 0.5, gravity: 14 }),
    L("dust", 22, "ring", [1.5, 3], [0.8, 1.2], [0.35, 0.5], [1.0, 1.4], { r0: 0.5, r1: 0.9, up: 0.6 }),
    L("jade", 6, "up", [2, 4], [0.3, 0.5], [0.06, 0.09], [0.02, 0.03], { r0: 0.4 }),
  ],
  wallDust: [L("dust", 40, "ring", [0.8, 2.5], [0.8, 1.3], [0.35, 0.5], [1.0, 1.5], { r0: 0.3, r1: 2, up: 0.5 })],
  // землетрясение (round3/01, A3): 120 частиц, основная масса во внешнем поясе 5–7 м — край удара читается; осколки
  // вверх 6 м/с
  quakeRing: [
    L("dust", 22, "ring", [1, 3], [0.8, 1.3], [0.4, 0.6], [1.1, 1.6], { r0: 1, r1: 5, up: 1 }),
    L("dust", 56, "ring", [1.5, 3.5], [0.9, 1.4], [0.45, 0.65], [1.2, 1.8], { r0: 5, r1: 7, up: 1.2 }),
    L("chip", 32, "ring", [1, 2.5], [0.5, 0.8], [0.07, 0.12], [0.04, 0.06], { r0: 4.5, r1: 7, up: 6 }),
    L("jade", 10, "ring", [0.5, 1.5], [0.3, 0.5], [0.07, 0.1], [0.02, 0.03], { r0: 2, r1: 7, up: 1.5 }),
  ],
  terrainChips: [
    L("chip", 10, "hemi", [2, 5], [0.5, 0.8], [0.07, 0.12], [0.04, 0.06], { up: 1 }),
    L("dust", 6, "hemi", [0.5, 1.5], [0.6, 0.9], [0.25, 0.35], [0.6, 0.8]),
  ],
  terrainBreak: [
    L("chip", 34, "sphere", [3, 7], [0.6, 1.0], [0.1, 0.18], [0.06, 0.1], { up: 3, r0: 0.6 }),
    L("dust", 28, "sphere", [1, 3], [0.9, 1.4], [0.4, 0.6], [1.2, 1.8], { r0: 0.8 }),
    L("jade", 6, "sphere", [1.5, 3.5], [0.3, 0.5], [0.07, 0.1], [0.02, 0.03], { r0: 0.4 }),
  ],
  deathFire: [
    L("core", 4, "sphere", [0, 1], [0.15, 0.25], [0.8, 1.2], [1.6, 2.2]),
    L("flame", 40, "up", [1.5, 4], [0.35, 0.6], [0.35, 0.55], [0.7, 1.1], { r0: 0.5 }),
    L("ember", 20, "up", [3, 7], [0.4, 0.6], [0.05, 0.08], [0.02, 0.03], { r0: 0.4, gravity: 5 }),
    L("smoke", 10, "up", [0.6, 1.5], [0.9, 1.4], [0.5, 0.7], [1.4, 2.0], { r0: 0.4 }),
  ],
  deathEarth: [
    L("chip", 30, "sphere", [2, 6], [0.6, 1.0], [0.08, 0.15], [0.05, 0.08], { up: 2.5, r0: 0.4 }),
    L("dust", 28, "sphere", [0.8, 2.5], [0.9, 1.4], [0.4, 0.6], [1.1, 1.6], { r0: 0.5 }),
  ],
  respawnPuff: [L("dust", 26, "ring", [0.8, 2], [0.7, 1.1], [0.3, 0.45], [0.8, 1.2], { r0: 0.2, r1: 0.6, up: 1.5 })],
  fizzle: [
    L("smoke", 8, "up", [0.3, 0.9], [0.5, 0.8], [0.15, 0.25], [0.4, 0.6], { r0: 0.1 }),
    L("ember", 4, "up", [0.5, 1.5], [0.15, 0.3], [0.04, 0.06], [0.02, 0.02], { r0: 0.1, gravity: 4 }),
  ],
  // попадание камнем (round3/01, H3): Земля не светится — вместо света белая бумажная вспышка, 0,08 с, 0,6 → 1,4 м
  paperFlash: [L("dust", 1, "sphere", [0, 0], [0.08, 0.08], [0.6, 0.6], [1.4, 1.4], { gravity: 0 })],
  // тяжёлое приземление чужого мага (M2): пыль из-под ног
  landDust: [L("dust", 10, "ring", [0.6, 1.4], [0.5, 0.8], [0.2, 0.3], [0.5, 0.8], { r0: 0.2, r1: 0.5, up: 0.4 })],
  // Дыхание дракона (фаза 5): выдох — пламя узким конусом по взгляду; вспышка потока на цели — малая, ≤ 3 раз/с
  breathFlare: [
    L("core", 4, "cone", [1, 3], [0.1, 0.18], [0.4, 0.6], [0.9, 1.2], { cone: 0.3 }),
    L("flame", 20, "cone", [4, 8], [0.3, 0.5], [0.3, 0.5], [0.8, 1.2], { cone: 0.3 }),
    L("ember", 14, "cone", [6, 11], [0.3, 0.5], [0.05, 0.08], [0.02, 0.03], { cone: 0.35 }),
  ],
  breathHit: [
    L("core", 2, "sphere", [0, 0.4], [0.06, 0.1], [0.3, 0.45], [0.6, 0.8]),
    L("flame", 6, "hemi", [0.8, 2], [0.25, 0.4], [0.2, 0.3], [0.4, 0.6], { gravity: -3 }),
    L("ember", 6, "hemi", [2, 5], [0.15, 0.3], [0.04, 0.07], [0.02, 0.03], { gravity: 6 }),
  ],
  // Тектонический разлом: пол лопается у ног мага; удар — осколки вверх и пыль, всплеск на каждые 5 м линии (5 × 30)
  riftCrack: [
    L("dust", 16, "hemi", [0.6, 1.8], [0.6, 1], [0.25, 0.4], [0.7, 1.1], { up: 0.6 }),
    L("chip", 8, "hemi", [1.5, 3.5], [0.4, 0.7], [0.06, 0.1], [0.04, 0.06], { up: 2 }),
    L("jade", 4, "hemi", [0.8, 1.6], [0.25, 0.4], [0.05, 0.08], [0.02, 0.03]),
  ],
  riftBurst: [
    L("chip", 12, "up", [5, 9], [0.6, 1], [0.08, 0.15], [0.05, 0.08], { r0: 1.6, gravity: 14, cone: 0.35 }),
    L("dust", 14, "up", [1, 2.5], [0.8, 1.3], [0.4, 0.6], [1.1, 1.6], { r0: 2.2 }),
    L("jade", 4, "up", [2, 4], [0.3, 0.5], [0.06, 0.09], [0.02, 0.03], { r0: 1.2 }),
  ],
  // объекты на карте (фаза 6): свет этих слоёв перекрашивается в золото (toGold). Сфера вернулась — кольцо искр
  // поднимается из печати (≤ 30); взята — золотые искры вверх (≤ 40)
  orbSpawn: [
    L("core", 2, "sphere", [0, 0.3], [0.12, 0.18], [0.25, 0.35], [0.45, 0.6]),
    L("glow", 10, "ring", [0.3, 0.8], [0.3, 0.45], [0.08, 0.12], [0.03, 0.05], { r0: 0.15, r1: 0.45, up: 1.2, gravity: -0.5 }),
    L("ember", 14, "up", [1.2, 2.6], [0.3, 0.5], [0.03, 0.05], [0.015, 0.02], { r0: 0.35, gravity: 2, cone: 0.35 }),
  ],
  orbTake: [
    L("core", 3, "sphere", [0, 0.4], [0.1, 0.16], [0.3, 0.4], [0.55, 0.75]),
    L("ember", 24, "up", [2, 4.5], [0.35, 0.6], [0.04, 0.06], [0.015, 0.025], { cone: 0.5, gravity: 3 }),
    L("glow", 10, "sphere", [0.4, 1.2], [0.4, 0.6], [0.08, 0.12], [0.02, 0.04], { up: 1.5, gravity: -0.8 }),
  ],
  // руна появилась — столб искр из печати и кольцо по её кругу (≤ 120); взята — искры во все стороны (≤ 120)
  runeSpawn: [
    L("core", 6, "up", [0.5, 2], [0.2, 0.35], [0.5, 0.8], [1.0, 1.4], { r0: 0.3, cone: 0.15 }),
    L("ember", 60, "up", [4, 9], [0.5, 0.9], [0.05, 0.08], [0.02, 0.03], { r0: 0.45, cone: 0.12, gravity: 1.5 }),
    L("glow", 30, "up", [1.5, 4], [0.6, 1.0], [0.12, 0.2], [0.04, 0.07], { r0: 0.6, cone: 0.2, gravity: -0.5 }),
    L("glow", 18, "ring", [1.5, 3], [0.4, 0.6], [0.1, 0.15], [0.04, 0.06], { r0: 0.6, r1: 1.5, up: 0.6, gravity: 0 }),
  ],
  runeTake: [
    L("core", 6, "sphere", [0, 1], [0.15, 0.25], [0.5, 0.7], [1.1, 1.5]),
    L("ember", 56, "sphere", [4, 9], [0.4, 0.7], [0.05, 0.08], [0.02, 0.03], { up: 2, gravity: 4 }),
    L("glow", 36, "sphere", [1.5, 3.5], [0.5, 0.8], [0.12, 0.18], [0.03, 0.06], { r0: 0.4, gravity: -0.6 }),
  ],
  // своё взятие — низко, у ног: кольцо света бежит по полу, искры короткие и падают; путь ниже глаз (не в лицо камеры)
  orbTakeOwn: [
    L("glow", 12, "ring", [1, 2], [0.3, 0.45], [0.06, 0.1], [0.02, 0.04], { r0: 0.2, r1: 0.5, up: 0.4, gravity: 0.5 }),
    L("ember", 14, "ring", [1.5, 3], [0.25, 0.4], [0.03, 0.05], [0.015, 0.02], { r0: 0.2, r1: 0.4, up: 1.2, gravity: 6 }),
  ],
  runeTakeOwn: [
    L("core", 3, "ring", [0.2, 0.6], [0.12, 0.2], [0.3, 0.45], [0.6, 0.9], { r0: 0, r1: 0.3, gravity: 0 }),
    L("glow", 30, "ring", [2, 4], [0.4, 0.6], [0.1, 0.15], [0.03, 0.06], { r0: 0.3, r1: 0.8, up: 0.4, gravity: 0.5 }),
    L("ember", 30, "ring", [3, 6], [0.3, 0.5], [0.04, 0.06], [0.015, 0.025], { r0: 0.3, r1: 0.7, up: 1.5, gravity: 8 }),
  ],
  // искра за носителем ярости: одна, всплывает и отстаёт — за бегущим тянется золотой след
  furyMote: [L("ember", 1, "up", [0.3, 0.9], [0.5, 0.8], [0.05, 0.07], [0.015, 0.025], { gravity: -0.8, cone: 0.6 })],
  // Воздух и Вода — своими таблицами (presets.air.ts, presets.water.ts)
  ...AIR_BURSTS,
  ...WATER_BURSTS,
};

/** Эффекты у ладони — в пространстве камеры рук (метры, взгляд вдоль −z): мелкие и короткие. */
const PALM: Readonly<Record<Element, PalmLayers>> = {
  fire: {
    // вспышка «дула» (фаза 9, L6): ядро 9–12 см до 130 мс — выстрел видно боковым зрением; свет — MUZZLE_LIGHT (vfx)
    flash: [
      L("core", 3, "sphere", [0, 0.2], [0.09, 0.13], [0.09, 0.11], [0.11, 0.12]),
      L("ember", 10, "cone", [0.6, 1.5], [0.08, 0.16], [0.012, 0.02], [0.006, 0.01], { cone: 0.7, gravity: 0 }),
      L("flame", 4, "cone", [0.2, 0.5], [0.12, 0.2], [0.04, 0.06], [0.07, 0.1], { cone: 0.6, gravity: -1 }),
    ],
    charge: [
      L("ember", 16, "converge", [0, 0], [0.18, 0.25], [0.012, 0.02], [0.02, 0.03], { r0: 0.12, gravity: 0 }),
      L("glow", 4, "sphere", [0, 0.05], [0.2, 0.25], [0.03, 0.04], [0.09, 0.12], { gravity: 0 }),
    ],
    fizzle: [
      L("smoke", 6, "up", [0.1, 0.25], [0.35, 0.5], [0.03, 0.04], [0.07, 0.09], { r0: 0.02, gravity: -0.2 }),
      L("ember", 2, "up", [0.2, 0.4], [0.1, 0.16], [0.01, 0.015], [0.005, 0.008], { gravity: 0.5 }),
    ],
  },
  earth: {
    flash: [
      L("dust", 8, "cone", [0.3, 0.8], [0.25, 0.4], [0.03, 0.04], [0.07, 0.09], { cone: 0.8 }),
      L("chip", 5, "cone", [0.5, 1.2], [0.2, 0.3], [0.015, 0.025], [0.01, 0.015], { cone: 0.7 }),
      L("jade", 4, "cone", [0.4, 0.9], [0.1, 0.18], [0.012, 0.018], [0.006, 0.01], { cone: 0.6, gravity: 0 }),
    ],
    charge: [
      L("dust", 10, "converge", [0, 0], [0.18, 0.22], [0.03, 0.04], [0.015, 0.02], { r0: 0.12 }),
      L("jade", 6, "converge", [0, 0], [0.15, 0.2], [0.012, 0.018], [0.01, 0.014], { r0: 0.1, gravity: 0 }),
    ],
    fizzle: [
      L("dust", 6, "up", [0.08, 0.2], [0.35, 0.5], [0.03, 0.04], [0.06, 0.08], { r0: 0.02 }),
      L("chip", 2, "sphere", [0.2, 0.4], [0.2, 0.3], [0.012, 0.018], [0.008, 0.01]),
    ],
  },
  air: AIR_PALM,
  water: WATER_PALM,
};
/** Следы снарядов стихий фазы 4 (у Огня и Земли — свои ветки trailParticles). */
const ELEMENT_TRAILS: Readonly<Partial<Record<ProjectileKind, TrailFn>>> = { ...AIR_TRAILS, ...WATER_TRAILS };

/** Всплески объектов на карте: их свет — золото (toGold), а не огонь. */
const GOLD_BURSTS: ReadonlySet<BurstPreset> = new Set<BurstPreset>(["orbSpawn", "orbTake", "orbTakeOwn", "runeSpawn", "runeTake", "runeTakeOwn", "furyMote"]);

/**
 * Частицы всплеска `p` в точке pos. Число — round(n × clamp(scale, 0,5, 3)), не больше MAX_BURST.
 * rng снаружи: в игре Math.random (клиент — не симуляция), в тестах — с семенем.
 */
export function burstParticles(p: BurstPreset, pos: Vec3, dir: Vec3, scale: number, rng: () => number): ParticleSpec[] {
  const layers = BURSTS[p];
  const s = Math.min(3, Math.max(0.5, Number.isFinite(scale) ? scale : 1));
  const base = layers.reduce((a, l) => a + l.n, 0);
  const out = emit(layers, Math.min(MAX_BURST, Math.round(base * s)), pos, dir, rng);
  return GOLD_BURSTS.has(p) ? toGold(out) : out;
}

/** Вспышка, заряд или «пшик» у ладони: pos и направления — в пространстве камеры рук (вперёд — −z). */
export function palmParticles(element: Element, kind: "flash" | "charge" | "fizzle", pos: Vec3, rng: () => number): ParticleSpec[] {
  const layers = PALM[element][kind];
  return emit(layers, layers.reduce((a, l) => a + l.n, 0), pos, { x: 0, y: 0.15, z: -1 }, rng);
}

/** Слои следов и линий пламени — постоянные: следы порождаются каждый кадр, без мусора на каждую частицу. */
const TRAIL = {
  ballFlame: L("flame", 1, "up", [0.4, 1.2], [0.3, 0.45], [0.45, 0.65], [0.15, 0.3]),
  ballGlow: L("glow", 1, "sphere", [0.1, 0.5], [0.2, 0.3], [0.6, 0.8], [0.3, 0.4]),
  ballEmber: L("ember", 1, "sphere", [0.8, 2], [0.3, 0.5], [0.04, 0.06], [0.02, 0.03], { gravity: 2 }),
  ballSmoke: L("smoke", 1, "up", [0.2, 0.6], [0.6, 0.9], [0.35, 0.5], [0.8, 1.1]),
  fistGlow: L("glow", 1, "sphere", [0, 0.3], [0.1, 0.16], [0.18, 0.26], [0.06, 0.1]),
  fistEmber: L("ember", 1, "sphere", [0.5, 1.5], [0.15, 0.3], [0.03, 0.05], [0.015, 0.02], { gravity: 3 }),
  stoneDust: L("dust", 1, "sphere", [0.05, 0.25], [0.3, 0.5], [0.08, 0.12], [0.26, 0.36]),
  lineFlame: L("flame", 1, "up", [1.5, 3.5], [0.35, 0.55], [0.5, 0.8], [0.9, 1.3], { cone: 0.3 }),
  lineEmber: L("ember", 1, "up", [1.5, 4], [0.4, 0.8], [0.04, 0.07], [0.02, 0.03], { gravity: 2, cone: 0.4 }),
} as const;

/**
 * Частицы следа снаряда на отрезке a → b (их число задаёт вызывающий по пройденному пути).
 * Огонь роняет языки пламени, угли и дым; камень — пыль цвета бумаги; прочие виды — след своей стихии (TrailFn).
 */
export function trailParticles(kind: ProjectileKind, a: Vec3, b: Vec3, n: number, rng: () => number): ParticleSpec[] {
  if (kind !== "fireFists" && kind !== "fireball" && kind !== "stoneShot") return ELEMENT_TRAILS[kind]?.(a, b, n, rng) ?? [];
  const out: ParticleSpec[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + rng()) / n;
    const p = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
    const r = rng();
    if (kind === "fireball") {
      const j = randomUnit(rng);
      const q = { x: p.x + j.x * 0.18, y: p.y + j.y * 0.18, z: p.z + j.z * 0.18 };
      if (r < 0.62) out.push(spawn(TRAIL.ballFlame, q, UP, rng));
      else if (r < 0.75) {
        const g = spawn(TRAIL.ballGlow, q, UP, rng);
        g.color = FX_COLOR.fire;
        out.push(g);
      } else if (r < 0.9) out.push(spawn(TRAIL.ballEmber, q, UP, rng));
      else out.push(spawn(TRAIL.ballSmoke, q, UP, rng));
    } else if (kind === "fireFists") {
      out.push(spawn(r < 0.7 ? TRAIL.fistGlow : TRAIL.fistEmber, p, UP, rng));
    } else {
      // камень оставляет мягкий пыльный след, а не цепочку клубов
      const d = spawn(TRAIL.stoneDust, p, UP, rng);
      d.alpha *= 0.45;
      out.push(d);
    }
  }
  return out;
}

/** Языки пламени и угли по линии стены огня (от a до b, у основания y). */
export function lineFlames(a: Vec3, b: Vec3, n: number, tall: boolean, rng: () => number): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  for (let i = 0; i < n; i++) {
    const t = rng();
    const p = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) + 0.1, z: lerp(a.z, b.z, t) };
    out.push(spawn(tall && rng() < 0.6 ? TRAIL.lineFlame : TRAIL.lineEmber, p, UP, rng));
  }
  return out;
}

/** Доля частиц мирового пула по пресету: на слабых пресетах всплески и следы реже. */
export const BURST_SHARE: Readonly<Record<PresetId, number>> = { low: 0.5, medium: 0.75, high: 1 };

/**
 * Равномерная выборка round(n·share) частиц из всплеска — шагом по массиву, поэтому сохраняется смесь слоёв
 * (ядро, пламя, угли, дым идут в массиве подряд). share ≥ 1 — без изменений.
 */
export function thinParticles(specs: readonly ParticleSpec[], share: number): ParticleSpec[] {
  if (!(share < 1)) return specs.slice();
  const k = Math.round(specs.length * Math.max(0, share));
  const out: ParticleSpec[] = [];
  for (let i = 0; i < k; i++) out.push(specs[Math.floor(((i + 0.5) * specs.length) / k)]!);
  return out;
}

/**
 * Стихия у ладоней в покое (round3/01, A5), в пространстве камеры рук: Огонь — угли, Земля — пыль и камешки
 * на орбите, Воздух — завитки, Вода — капли. Частиц в секунду на руку — IDLE_PALM_RATE (в замахе вдвое).
 */
const IDLE_PALM: Readonly<Record<Element, Layer>> = {
  fire: L("ember", 1, "up", [0.04, 0.12], [0.45, 0.7], [0.009, 0.013], [0.004, 0.006], { r0: 0.025, gravity: -0.25 }),
  earth: L("dust", 1, "up", [0.01, 0.04], [0.5, 0.7], [0.012, 0.018], [0.03, 0.04], { r0: 0.03, gravity: 0 }),
  air: L("wind", 1, "up", [0.03, 0.08], [0.4, 0.6], [0.01, 0.015], [0.025, 0.035], { r0: 0.03, gravity: 0 }),
  water: L("water", 1, "sphere", [0.01, 0.03], [0.35, 0.5], [0.007, 0.01], [0.004, 0.006], { r0: 0.03, gravity: 0.6 }),
};
export const IDLE_PALM_RATE: Readonly<Record<Element, number>> = { fire: 6, earth: 2, air: 4, water: 4 };
/** Камешек Земли на орбите: живёт чуть дольше шага порождения — по точкам рисуется кружащий камень. */
const PEBBLE = L("chip", 1, "sphere", [0, 0], [0.1, 0.12], [0.009, 0.011], [0.009, 0.011], { gravity: 0 });
export const PEBBLE_RATE = 15;
const PEBBLE_R = 0.05;

/** Одна частица стихии у ладони pos (пространство камеры рук). */
export function idlePalmParticle(element: Element, pos: Vec3, rng: () => number): ParticleSpec {
  return spawn(IDLE_PALM[element], pos, UP, rng);
}

/** Камешек на орбите вокруг ладони: phase — угол по орбите, рад. */
export function pebbleParticle(pos: Vec3, phase: number, rng: () => number): ParticleSpec {
  const at = { x: pos.x + Math.cos(phase) * PEBBLE_R, y: pos.y + 0.02 + Math.sin(phase * 2) * 0.008, z: pos.z + Math.sin(phase) * PEBBLE_R };
  return spawn(PEBBLE, at, UP, rng);
}

/** Пыль из-под ног отброшенного по полу (K3): одна частица у подошвы. */
const KNOCK_DUST = L("dust", 1, "hemi", [0.4, 1.1], [0.45, 0.7], [0.15, 0.22], [0.4, 0.6], { r0: 0.25, up: 0.3 });
export const KNOCK_DUST_RATE = 15;
export function knockDust(feet: Vec3, rng: () => number): ParticleSpec {
  return spawn(KNOCK_DUST, { x: feet.x, y: feet.y + 0.05, z: feet.z }, UP, rng);
}
