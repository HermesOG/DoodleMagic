import type { ProjectileKind } from "@doodlemagic/sim";
import type { AIR_BURST_PRESETS } from "../feel/airIds";
import { FX_COLOR, L, UP, spawn, type Layer, type PalmLayers, type ProjectileLook, type TrailFn } from "./particleKit";

/*
 * Частицы Воздуха. Заглушка до задачи 5: всплески — облачко ветра, ладонь — штрихи ветра, след серпа — ветер.
 * Задача 5 правит только этот файл.
 */

const puff = (n: number): readonly Layer[] => [L("wind", n, "sphere", [1, 3], [0.3, 0.5], [0.15, 0.25], [0.4, 0.6])];

export const AIR_BURSTS: Readonly<Record<(typeof AIR_BURST_PRESETS)[number], readonly Layer[]>> = {
  sicklePuff: puff(10),
  gustBlast: puff(16),
  airBlown: puff(10),
  airSlam: puff(16),
  swoopWake: puff(12),
  airJumpRing: puff(10),
  tornadoDust: puff(16),
  fireTornadoFlare: puff(16),
  deathAir: puff(30),
};

export const AIR_PALM: PalmLayers = {
  flash: [L("wind", 8, "cone", [0.3, 0.8], [0.15, 0.25], [0.02, 0.03], [0.05, 0.07], { cone: 0.7 })],
  charge: [L("wind", 10, "converge", [0, 0], [0.18, 0.24], [0.02, 0.03], [0.012, 0.018], { r0: 0.12 })],
  fizzle: [L("wind", 5, "up", [0.08, 0.2], [0.3, 0.45], [0.02, 0.03], [0.05, 0.07], { r0: 0.02 })],
};

const SICKLE_WIND = L("wind", 1, "sphere", [0.05, 0.3], [0.2, 0.35], [0.08, 0.12], [0.2, 0.3]);

export const AIR_TRAILS: Readonly<Partial<Record<ProjectileKind, TrailFn>>> = {
  airSickle: (a, b, n, rng) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (i + rng()) / n;
      out.push(spawn(SICKLE_WIND, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, UP, rng));
    }
    return out;
  },
};

export const AIR_PROJECTILE_LOOK: Readonly<Partial<Record<ProjectileKind, ProjectileLook>>> = {
  airSickle: { mesh: "sphere", core: 0.14, halo: 0.5, color: FX_COLOR.air, light: 0, intensity: 0.8, whiteCore: 0.3, trailEveryM: 0.3 },
};
