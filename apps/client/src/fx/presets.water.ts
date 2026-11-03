import type { ProjectileKind } from "@doodlemagic/sim";
import type { WATER_BURST_PRESETS } from "../feel/waterIds";
import { FX_COLOR, L, UP, spawn, type Layer, type PalmLayers, type ProjectileLook, type TrailFn } from "./particleKit";

/*
 * Частицы Воды: плотные лазурные капли (падают), светлая пена (оседает), пар — серо-белая дымка (всплывает).
 * Всплески — общим пулом по пресету; непрерывные струи (пузыри Родника, пар, капли Мокрого, дуга хлыста) порождает
 * waterVfx из слоёв WATER_STREAM.
 */

export const WATER_BURSTS: Readonly<Record<(typeof WATER_BURST_PRESETS)[number], readonly Layer[]>> = {
  // конец дуги хлыста: несколько капель (сама дуга — waterVfx)
  whipArc: [L("water", 4, "hemi", [1, 2.5], [0.25, 0.4], [0.05, 0.08], [0.03, 0.05], { up: 0.5 })],
  // попадание хлыста: брызги к Воде, пена
  whipSplash: [
    L("water", 12, "hemi", [2, 4], [0.3, 0.5], [0.06, 0.1], [0.04, 0.06], { up: 1 }),
    L("foam", 5, "hemi", [0.6, 1.4], [0.35, 0.6], [0.15, 0.25], [0.35, 0.5]),
  ],
  // «чпок» жгута
  grabSplash: [
    L("water", 16, "hemi", [2, 4.5], [0.35, 0.55], [0.07, 0.11], [0.04, 0.07], { up: 1.2 }),
    L("foam", 6, "sphere", [0.5, 1.2], [0.4, 0.7], [0.2, 0.3], [0.4, 0.6]),
  ],
  // впитал снаряд: брызги по диску во все стороны
  wardAbsorb: [
    L("water", 12, "sphere", [1.5, 3], [0.3, 0.5], [0.06, 0.1], [0.04, 0.06]),
    L("foam", 6, "sphere", [0.4, 1], [0.35, 0.55], [0.2, 0.3], [0.35, 0.5]),
  ],
  // диск уходит: обвал воды
  wardBurst: [
    L("water", 30, "sphere", [2, 5], [0.4, 0.7], [0.08, 0.12], [0.05, 0.08], { up: 1, r0: 0.6 }),
    L("foam", 12, "sphere", [0.6, 1.6], [0.5, 0.8], [0.25, 0.35], [0.5, 0.7], { r0: 0.5 }),
    L("mist", 6, "up", [0.3, 0.8], [0.7, 1], [0.4, 0.5], [0.9, 1.2], { r0: 0.6 }),
  ],
  // попадание Ответа: тяжёлый плеск
  answerSplash: [
    L("water", 22, "hemi", [2, 5], [0.4, 0.6], [0.08, 0.12], [0.05, 0.08], { up: 1.2 }),
    L("foam", 9, "hemi", [0.6, 1.5], [0.45, 0.7], [0.25, 0.35], [0.45, 0.65]),
  ],
  // разлив Родника: кольцо воды разбегается до ~4 м за 0,4 с, пена следом
  springRing: [
    L("water", 34, "ring", [8, 10.5], [0.35, 0.45], [0.08, 0.12], [0.05, 0.07], { r0: 0.2, r1: 0.6, up: 1.2 }),
    L("foam", 18, "ring", [6, 9], [0.4, 0.5], [0.15, 0.22], [0.3, 0.45], { r0: 0.2, r1: 0.5, gravity: 0 }),
  ],
  // пузыри лужи (≤ 20/с — частоту держит waterVfx)
  springBubbles: [L("foam", 6, "up", [0.3, 0.8], [0.4, 0.7], [0.04, 0.07], [0.08, 0.12], { r0: 3.5, cone: 0.3 })],
  // облако пара
  steamPuff: [
    L("mist", 18, "up", [0.5, 1.5], [0.9, 1.4], [0.4, 0.6], [1.2, 1.8], { r0: 0.7 }),
    L("foam", 4, "up", [0.6, 1.4], [0.4, 0.6], [0.05, 0.08], [0.02, 0.04], { r0: 0.4, gravity: -1 }),
  ],
  // лечение: лазурные искры всплывают
  healMotes: [
    L("water", 8, "up", [0.4, 1], [0.5, 0.8], [0.03, 0.05], [0.01, 0.02], { r0: 0.4, gravity: -1.5 }),
    L("foam", 4, "up", [0.3, 0.8], [0.5, 0.8], [0.03, 0.05], [0.01, 0.02], { r0: 0.3, gravity: -1 }),
  ],
  // капли Мокрого
  wetDrips: [L("water", 3, "sphere", [0.05, 0.2], [0.3, 0.45], [0.025, 0.04], [0.015, 0.025], { r0: 0.25 })],
  // смерть от Воды: маг рассыпается брызгами
  deathWater: [
    L("water", 50, "sphere", [2, 6], [0.5, 0.9], [0.08, 0.14], [0.05, 0.08], { up: 2, r0: 0.5 }),
    L("foam", 22, "sphere", [0.6, 2], [0.6, 1], [0.25, 0.4], [0.5, 0.8], { r0: 0.5 }),
    L("mist", 10, "up", [0.3, 0.9], [0.9, 1.3], [0.4, 0.6], [1, 1.4], { r0: 0.6 }),
  ],
};

/** Ладонь: вспышка каста — капли вперёд; заряд — лазурные искры сходятся (лечение); «пшик» — пена. */
export const WATER_PALM: PalmLayers = {
  flash: [L("water", 8, "cone", [0.3, 0.8], [0.15, 0.25], [0.012, 0.02], [0.008, 0.012], { cone: 0.7 })],
  charge: [L("water", 10, "converge", [0, 0], [0.3, 0.45], [0.008, 0.014], [0.012, 0.018], { r0: 0.14, gravity: -0.3 })],
  fizzle: [L("foam", 5, "up", [0.08, 0.2], [0.3, 0.45], [0.02, 0.03], [0.04, 0.06], { r0: 0.02 })],
};

/** Слои непрерывных струй Воды: waterVfx порождает их по одной частице (spawn) с заданной частотой. */
export const WATER_STREAM = {
  // пузырь лужи: всплывает и лопается пеной
  bubble: L("foam", 1, "up", [0.3, 0.7], [0.35, 0.6], [0.04, 0.07], [0.09, 0.13], { cone: 0.25, gravity: -0.5 }),
  // пар: облако всплывает и расходится
  mist: L("mist", 1, "up", [0.3, 0.8], [1, 1.5], [0.5, 0.7], [1.2, 1.6], { cone: 0.6 }),
  // капля Мокрого: падает
  drip: L("water", 1, "sphere", [0.02, 0.12], [0.35, 0.5], [0.025, 0.035], [0.015, 0.02]),
  // капли с дуги хлыста и натянутого каната
  spray: L("water", 1, "sphere", [0.3, 1.2], [0.25, 0.4], [0.03, 0.05], [0.02, 0.03]),
} as const;

const DROP = L("water", 1, "sphere", [0.2, 0.8], [0.25, 0.4], [0.06, 0.09], [0.03, 0.05]);
const drops: TrailFn = (a, b, n, rng) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i + rng()) / n;
    out.push(spawn(DROP, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, UP, rng));
  }
  return out;
};

export const WATER_TRAILS: Readonly<Partial<Record<ProjectileKind, TrailFn>>> = { waterGrab: drops, waterAnswer: drops };

export const WATER_PROJECTILE_LOOK: Readonly<Partial<Record<ProjectileKind, ProjectileLook>>> = {
  waterGrab: { mesh: "sphere", core: 0.2, halo: 0.6, color: FX_COLOR.water, light: 1.6, intensity: 0.9, whiteCore: 0.4, trailEveryM: 0.2 },
  waterAnswer: { mesh: "sphere", core: 0.28, halo: 0.9, color: FX_COLOR.water, light: 2.4, intensity: 1.05, whiteCore: 0.5, trailEveryM: 0.16 },
};
