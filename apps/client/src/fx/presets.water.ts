import type { ProjectileKind } from "@doodlemagic/sim";
import type { WATER_BURST_PRESETS } from "../feel/waterIds";
import { FX_COLOR, L, UP, spawn, type Layer, type PalmLayers, type ProjectileLook, type TrailFn } from "./particleKit";

/*
 * Частицы Воды. Заглушка до задачи 6: всплески — брызги и пена, ладонь — капли, след Хвата и Ответа — капли.
 * Задача 6 правит только этот файл.
 */

const splash = (n: number): readonly Layer[] => [
  L("water", n, "hemi", [1.5, 3.5], [0.35, 0.6], [0.08, 0.12], [0.05, 0.08], { up: 1 }),
  L("foam", Math.max(1, Math.round(n / 2)), "hemi", [0.4, 1.2], [0.4, 0.7], [0.2, 0.3], [0.4, 0.6]),
];

export const WATER_BURSTS: Readonly<Record<(typeof WATER_BURST_PRESETS)[number], readonly Layer[]>> = {
  whipSplash: splash(10),
  grabSplash: splash(12),
  wardAbsorb: splash(10),
  wardBurst: splash(16),
  answerSplash: splash(12),
  springRing: splash(14),
  springBubbles: splash(8),
  steamPuff: [L("mist", 14, "up", [0.4, 1.2], [0.8, 1.3], [0.4, 0.6], [1.2, 1.8], { r0: 0.8 })],
  healMotes: splash(8),
  wetDrips: splash(4),
  deathWater: splash(30),
};

export const WATER_PALM: PalmLayers = {
  flash: [L("water", 8, "cone", [0.3, 0.8], [0.15, 0.25], [0.012, 0.02], [0.008, 0.012], { cone: 0.7 })],
  charge: [L("water", 10, "converge", [0, 0], [0.18, 0.24], [0.012, 0.02], [0.01, 0.014], { r0: 0.12, gravity: 0 })],
  fizzle: [L("foam", 5, "up", [0.08, 0.2], [0.3, 0.45], [0.02, 0.03], [0.04, 0.06], { r0: 0.02 })],
};

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
  waterAnswer: { mesh: "sphere", core: 0.25, halo: 0.8, color: FX_COLOR.water, light: 2, intensity: 1, whiteCore: 0.5, trailEveryM: 0.18 },
};
