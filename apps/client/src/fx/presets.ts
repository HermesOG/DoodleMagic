import type { Element, Vec3 } from "@doodlemagic/sim";
import type { BurstPreset } from "../feel/effects";
import { PAPER, type RGB } from "../render/palette";
import type { PresetId } from "../render/quality";

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

const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/**
 * Цвета магии (round1/05), в пространстве экрана. Огонь — оранжевый с почти белым ядром, светится.
 * Земля не светится: тёмный камень, нефрит только в трещинах и искрах, пыль цвета бумаги.
 */
export const FX_COLOR = {
  fire: hex(0xff7a1a),
  core: hex(0xffe2a0),
  ember: [0.85, 0.25, 0.05] as RGB,
  smoke: [0.22, 0.21, 0.2] as RGB,
  jade: hex(0x3dbe7a),
  dust: PAPER,
  /** Осколки камня: средний тон, как освещённая грань рельефа. */
  stone: [0.5, 0.48, 0.44] as RGB,
} as const;
export const SMOKE_ALPHA = 0.35;

/**
 * Частица пула. `color` — прямой (не предумноженный) цвет; `alpha` — плотность: 0 — чистое сложение (свет),
 * > 0 — плотная частица поверх кадра. Форма в шейдере выводится из этих чисел: свет (alpha 0) — мягкое пятно
 * с белым центром и шлейфом по скорости; плотная с gravity ≥ 9 — угловатый осколок; остальные плотные —
 * рваное облако с сопротивлением воздуха (пыль, дым, тело пламени).
 */
export interface ParticleSpec {
  pos: Vec3;
  vel: Vec3;
  /** Ускорение вниз, м/с²; отрицательное — всплывает (огонь, дым). */
  gravity: number;
  life: number;
  size0: number;
  size1: number;
  color: readonly [number, number, number];
  alpha: number;
}

type Kind = "core" | "glow" | "flame" | "smoke" | "ember" | "dust" | "chip" | "jade";
type Spread = "sphere" | "hemi" | "cone" | "up" | "ring" | "converge";
type Range = readonly [number, number];

interface Layer {
  kind: Kind;
  n: number;
  spread: Spread;
  speed: Range;
  life: Range;
  size0: Range;
  size1: Range;
  /** Радиус точки рождения вокруг центра (у ring — внутренний радиус кольца, у converge — откуда сходятся). */
  r0?: number;
  /** Внешний радиус кольца. */
  r1?: number;
  /** Прибавка к скорости вверх, м/с. */
  up?: number;
  gravity?: number;
  /** Полуугол конуса, рад. */
  cone?: number;
}

const L = (kind: Kind, n: number, spread: Spread, speed: Range, life: Range, size0: Range, size1: Range, o: Partial<Layer> = {}): Layer => ({
  kind,
  n,
  spread,
  speed,
  life,
  size0,
  size1,
  ...o,
});

type Rng = () => number;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const pick = (r: Range, rng: Rng): number => lerp(r[0], r[1], rng());
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const jitter = (c: RGB, amount: number, rng: Rng): RGB => {
  const k = (rng() - 0.5) * 2 * amount;
  return [clamp01(c[0] + k), clamp01(c[1] + k), clamp01(c[2] + k)];
};
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Цвет, плотность и тяжесть по виду частицы. */
const KIND: Record<Kind, { color: (rng: Rng) => RGB; alpha: (rng: Rng) => number; gravity: number }> = {
  core: { color: () => FX_COLOR.core, alpha: () => 0, gravity: -1 },
  glow: { color: (rng) => mixRGB(FX_COLOR.fire, FX_COLOR.core, rng() * 0.6), alpha: () => 0, gravity: -1.5 },
  // тело пламени плотное: на светлой бумаге чистое сложение выцвело бы в белое, а оранжевый должен читаться
  flame: { color: (rng) => mixRGB(FX_COLOR.fire, FX_COLOR.ember, rng() * 0.35), alpha: (rng) => lerp(0.55, 0.7, rng()), gravity: -3 },
  smoke: { color: (rng) => jitter(FX_COLOR.smoke, 0.03, rng), alpha: () => SMOKE_ALPHA, gravity: -0.8 },
  ember: { color: (rng) => mixRGB(FX_COLOR.ember, FX_COLOR.fire, rng()), alpha: () => 0, gravity: 7 },
  dust: { color: (rng) => jitter(FX_COLOR.dust, 0.025, rng), alpha: (rng) => lerp(0.4, 0.6, rng()), gravity: -0.4 },
  chip: { color: (rng) => jitter(FX_COLOR.stone, 0.07, rng), alpha: () => 1, gravity: 12 },
  jade: { color: (rng) => mixRGB(FX_COLOR.jade, [0.75, 1, 0.85], rng() * 0.3), alpha: () => 0, gravity: 3 },
};

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
  quakeRing: [
    L("dust", 50, "ring", [1, 3], [0.8, 1.3], [0.4, 0.6], [1.1, 1.6], { r0: 1, r1: 7, up: 1 }),
    L("chip", 16, "ring", [1, 2], [0.5, 0.8], [0.07, 0.12], [0.04, 0.06], { r0: 1.5, r1: 7, up: 4 }),
    L("jade", 8, "ring", [0.5, 1.5], [0.3, 0.5], [0.07, 0.1], [0.02, 0.03], { r0: 2, r1: 7, up: 1.5 }),
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
};

/** Эффекты у ладони — в пространстве камеры рук (метры, взгляд вдоль −z): мелкие и короткие. */
const PALM: Readonly<Record<Element, Readonly<Record<"flash" | "charge" | "fizzle", readonly Layer[]>>>> = {
  fire: {
    flash: [
      L("core", 3, "sphere", [0, 0.2], [0.07, 0.11], [0.06, 0.08], [0.1, 0.12]),
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
};

const UP: Vec3 = { x: 0, y: 1, z: 0 };

function normalizeOr(v: Vec3, fallback: Vec3): Vec3 {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return l > 1e-6 ? { x: v.x / l, y: v.y / l, z: v.z / l } : fallback;
}

function randomUnit(rng: Rng): Vec3 {
  const z = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: s * Math.cos(phi), y: z, z: s * Math.sin(phi) };
}

/** Направление в конусе вокруг d с полууглом a (равномерно по телесному углу). */
function randomCone(d: Vec3, a: number, rng: Rng): Vec3 {
  const t = normalizeOr(Math.abs(d.y) < 0.9 ? { x: d.z, y: 0, z: -d.x } : { x: 0, y: -d.z, z: d.y }, { x: 1, y: 0, z: 0 });
  const b = { x: d.y * t.z - d.z * t.y, y: d.z * t.x - d.x * t.z, z: d.x * t.y - d.y * t.x };
  const cosT = 1 - rng() * (1 - Math.cos(a));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = 2 * Math.PI * rng();
  const c = Math.cos(phi) * sinT;
  const s = Math.sin(phi) * sinT;
  return { x: t.x * c + b.x * s + d.x * cosT, y: t.y * c + b.y * s + d.y * cosT, z: t.z * c + b.z * s + d.z * cosT };
}

function spawn(layer: Layer, pos: Vec3, dir: Vec3, rng: Rng): ParticleSpec {
  const k = KIND[layer.kind];
  const life = pick(layer.life, rng);
  const speed = pick(layer.speed, rng);
  let p: Vec3 = pos;
  let v: Vec3;
  switch (layer.spread) {
    case "sphere":
    case "hemi": {
      let u = randomUnit(rng);
      if (layer.spread === "hemi" && u.x * dir.x + u.y * dir.y + u.z * dir.z < 0) u = { x: -u.x, y: -u.y, z: -u.z };
      v = { x: u.x * speed, y: u.y * speed, z: u.z * speed };
      break;
    }
    case "cone":
    case "up": {
      const u = randomCone(layer.spread === "up" ? UP : dir, layer.cone ?? 0.5, rng);
      v = { x: u.x * speed, y: u.y * speed, z: u.z * speed };
      break;
    }
    case "ring": {
      const phi = 2 * Math.PI * rng();
      const r = lerp(layer.r0 ?? 0, layer.r1 ?? layer.r0 ?? 1, Math.sqrt(rng()));
      const cx = Math.cos(phi);
      const cz = Math.sin(phi);
      p = { x: pos.x + cx * r, y: pos.y + 0.05, z: pos.z + cz * r };
      v = { x: cx * speed, y: 0, z: cz * speed };
      break;
    }
    case "converge": {
      const u = randomUnit(rng);
      const r = (layer.r0 ?? 0.5) * lerp(0.7, 1, rng());
      p = { x: pos.x + u.x * r, y: pos.y + u.y * r, z: pos.z + u.z * r };
      v = { x: (-u.x * r) / life, y: (-u.y * r) / life, z: (-u.z * r) / life };
      break;
    }
  }
  if (layer.r0 && layer.spread === "up") {
    // «вверх» рождается на круге у земли: пламя по площадке, пыль у основания
    const phi = 2 * Math.PI * rng();
    const r = layer.r0 * Math.sqrt(rng());
    p = { x: pos.x + Math.cos(phi) * r, y: pos.y, z: pos.z + Math.sin(phi) * r };
  } else if (layer.r0 && layer.spread !== "ring" && layer.spread !== "converge") {
    const u = randomUnit(rng);
    const r = layer.r0 * Math.cbrt(rng());
    p = { x: pos.x + u.x * r, y: pos.y + u.y * r, z: pos.z + u.z * r };
  }
  const up = layer.up ? layer.up * lerp(0.5, 1, rng()) : 0;
  return {
    pos: p,
    vel: { x: v.x, y: v.y + up, z: v.z },
    gravity: layer.gravity ?? k.gravity,
    life,
    size0: pick(layer.size0, rng),
    size1: pick(layer.size1, rng),
    color: k.color(rng),
    alpha: k.alpha(rng),
  };
}

function emit(layers: readonly Layer[], total: number, pos: Vec3, dir: Vec3, rng: Rng): ParticleSpec[] {
  const base = layers.reduce((a, l) => a + l.n, 0);
  if (base <= 0 || total <= 0) return [];
  const counts = layers.map((l) => Math.floor((l.n * total) / base));
  let rest = total - counts.reduce((a, c) => a + c, 0);
  for (let i = 0; rest > 0; i = (i + 1) % counts.length, rest--) counts[i]!++;
  const d = normalizeOr(dir, UP);
  const out: ParticleSpec[] = [];
  layers.forEach((l, i) => {
    for (let j = 0; j < counts[i]!; j++) out.push(spawn(l, pos, d, rng));
  });
  return out;
}

/**
 * Частицы всплеска `p` в точке pos. Число — round(n × clamp(scale, 0,5, 3)), не больше MAX_BURST.
 * rng снаружи: в игре Math.random (клиент — не симуляция), в тестах — с семенем.
 */
export function burstParticles(p: BurstPreset, pos: Vec3, dir: Vec3, scale: number, rng: () => number): ParticleSpec[] {
  const layers = BURSTS[p];
  const s = Math.min(3, Math.max(0.5, Number.isFinite(scale) ? scale : 1));
  const base = layers.reduce((a, l) => a + l.n, 0);
  return emit(layers, Math.min(MAX_BURST, Math.round(base * s)), pos, dir, rng);
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
 * Огонь роняет языки пламени, угли и дым; камень — пыль цвета бумаги.
 */
export function trailParticles(kind: "fireFists" | "fireball" | "stoneShot", a: Vec3, b: Vec3, n: number, rng: () => number): ParticleSpec[] {
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
