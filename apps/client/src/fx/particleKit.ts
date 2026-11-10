import { NOBODY, type UnitId, type Vec3 } from "@doodlemagic/sim";
import { PAPER, type RGB } from "../render/palette";

/*
 * Лист-модуль частиц: цвета, виды и слои всплесков, порождение частицы. Его берут и общая таблица (presets.ts),
 * и пресеты стихий (presets.air.ts, presets.water.ts) — без цикла импортов между ними.
 */

export const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/**
 * Цвета магии под бумагу «Тушь с подцветкой» (раунд 4, V6). Огонь — светлое тело ярче пола, тень и угли оранжевее,
 * чтобы не уходить к красному HP; ядро почти белое. Земля не светится: пыль на 0,26 темнее бумаги, осколки тушью
 * умбры, нефрит глубже. Вода — лазурь, пена белая с линией. Воздух — не заливка, а штрих кисти; бледная сирень
 * осталась светом (ореолы рук, серпа, вихря).
 */
export const FX_COLOR = {
  fire: hex(0xffb24d),
  fireShade: hex(0xe8701c),
  core: hex(0xffe2a0),
  ember: hex(0xd9550f),
  smoke: [0.22, 0.21, 0.2] as RGB,
  jade: hex(0x2a9e62),
  dust: hex(0xb5aa92),
  /** Осколки камня: тушь умбры, как камень Земли. */
  stone: hex(0x5c4d3d),
  water: hex(0x1e8bd0),
  foam: [0.86, 0.95, 1] as RGB,
  /** Линия пены и своя кайма Воды. */
  foamLine: hex(0x0f4e78),
  air: hex(0xc8c0f2),
  /** Штрих Воздуха: тёмная сирень кистью, α 0,6, с белым бликом. */
  airStroke: hex(0x4b4870),
  steam: [0.88, 0.9, 0.92] as RGB,
  /** Удар тушью (V7): тёплая чёрная тушь штрихов попадания. */
  ink: hex(0x1e1a16),
} as const;
export const SMOKE_ALPHA = 0.35;
/**
 * Кайма магии (V3, GDD 2.2): у плотного пламени и воды, листа стены огня и конуса Дыхания. Чужая — тёмная, зубчатая,
 * α 0,9 — видна по краю с 30 м; своя — гладкая, средним тоном той же стихии, α 0,5. Своя кромка Дыхания — оранжевее,
 * дальше от красного HP (рецензия 02). Пена Воды — белая с линией.
 */
export const RIM = {
  foe: { fire: hex(0x2a140a), water: [0.08, 0.1, 0.13] as RGB, alpha: 0.9 },
  own: { fire: hex(0x8a5a3a), water: FX_COLOR.foamLine, breath: hex(0xb8500f), alpha: 0.5 },
  foamLine: { color: FX_COLOR.foamLine, alpha: 0.6 },
} as const;

/** Плотность штриха Воздуха и штриха туши удара. */
export const AIR_STROKE_ALPHA = 0.6;
export const INK_STROKE_ALPHA = 0.9;

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
  /** Штрих кисти: вытянут по скорости, size — длина (ветер, удар тушью). Нет — форма по alpha и gravity. */
  stroke?: boolean;
  /** Магия чужого мага: у пламени и воды тёмная зубчатая кайма (V3). */
  foe?: boolean;
  /** Своя магия: кайма гладкая, средним тоном (V3). Ни own, ни foe — хозяин неизвестен, каймы нет. */
  own?: boolean;
  /** Своё у прицела: центр кадра (6°) остаётся чистым (своё Дыхание, V4). */
  clear?: boolean;
}

export type Kind = "core" | "glow" | "flame" | "smoke" | "ember" | "dust" | "paper" | "chip" | "jade" | "water" | "foam" | "mist" | "wind" | "ink";
export type Spread = "sphere" | "hemi" | "cone" | "up" | "ring" | "converge";
export type Range = readonly [number, number];

export interface Layer {
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

export const L = (kind: Kind, n: number, spread: Spread, speed: Range, life: Range, size0: Range, size1: Range, o: Partial<Layer> = {}): Layer => ({
  kind,
  n,
  spread,
  speed,
  life,
  size0,
  size1,
  ...o,
});

export type Rng = () => number;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const pick = (r: Range, rng: Rng): number => lerp(r[0], r[1], rng());
export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const jitter = (c: RGB, amount: number, rng: Rng): RGB => {
  const k = (rng() - 0.5) * 2 * amount;
  return [clamp01(c[0] + k), clamp01(c[1] + k), clamp01(c[2] + k)];
};
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Цвет, плотность и тяжесть по виду частицы; stroke — штрих кисти (форма в шейдере). */
export const KIND: Record<Kind, { color: (rng: Rng) => RGB; alpha: (rng: Rng) => number; gravity: number; stroke?: true }> = {
  core: { color: () => FX_COLOR.core, alpha: () => 0, gravity: -1 },
  glow: { color: (rng) => mixRGB(FX_COLOR.fire, FX_COLOR.core, rng() * 0.6), alpha: () => 0, gravity: -1.5 },
  // тело пламени плотное: на светлой бумаге чистое сложение выцвело бы в белое, а оранжевый должен читаться;
  // светлое тело переходит в оранжевую тень
  flame: { color: (rng) => mixRGB(FX_COLOR.fire, FX_COLOR.fireShade, rng() * 0.7), alpha: (rng) => lerp(0.55, 0.7, rng()), gravity: -3 },
  smoke: { color: (rng) => jitter(FX_COLOR.smoke, 0.03, rng), alpha: () => SMOKE_ALPHA, gravity: -0.8 },
  ember: { color: (rng) => mixRGB(FX_COLOR.ember, FX_COLOR.fire, rng()), alpha: () => 0, gravity: 7 },
  dust: { color: (rng) => jitter(FX_COLOR.dust, 0.025, rng), alpha: (rng) => lerp(0.4, 0.6, rng()), gravity: -0.4 },
  // бумажная вспышка попадания камнем: Земля не светится, вместо света — клок бумаги
  paper: { color: (rng) => jitter(PAPER, 0.02, rng), alpha: (rng) => lerp(0.4, 0.6, rng()), gravity: -0.4 },
  chip: { color: (rng) => jitter(FX_COLOR.stone, 0.05, rng), alpha: () => 1, gravity: 12 },
  jade: { color: (rng) => mixRGB(FX_COLOR.jade, [0.75, 1, 0.85], rng() * 0.3), alpha: () => 0, gravity: 3 },
  // Вода — плотные капли, падают (g < 9: не осколок, а облачко); пена — светлая, оседает медленно
  water: { color: (rng) => mixRGB(FX_COLOR.water, FX_COLOR.foam, rng() * 0.25), alpha: (rng) => lerp(0.5, 0.65, rng()), gravity: 8 },
  foam: { color: (rng) => jitter(FX_COLOR.foam, 0.03, rng), alpha: (rng) => lerp(0.4, 0.55, rng()), gravity: 1.5 },
  // пар и дымка — прозрачное облако, всплывает; ветер — штрихи кисти без тяжести
  mist: { color: (rng) => jitter(FX_COLOR.steam, 0.02, rng), alpha: () => 0.3, gravity: -0.6 },
  wind: { color: (rng) => jitter(FX_COLOR.airStroke, 0.04, rng), alpha: () => AIR_STROKE_ALPHA, gravity: 0, stroke: true },
  // удар тушью (V7): тёмные штрихи от точки попадания
  ink: { color: (rng) => jitter(FX_COLOR.ink, 0.02, rng), alpha: () => INK_STROKE_ALPHA, gravity: 0, stroke: true },
};

/** Частица вида kind с готовыми положением, скоростью, жизнью и размером (эффектники стихий и ульт). */
export function particle(kind: Kind, pos: Vec3, vel: Vec3, life: number, size0: number, size1: number, rng: Rng, gravity?: number): ParticleSpec {
  const k = KIND[kind];
  const s: ParticleSpec = { pos, vel, gravity: gravity ?? k.gravity, life, size0, size1, color: k.color(rng), alpha: k.alpha(rng) };
  if (k.stroke) s.stroke = true;
  return s;
}

export const UP: Vec3 = { x: 0, y: 1, z: 0 };

export function normalizeOr(v: Vec3, fallback: Vec3): Vec3 {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return l > 1e-6 ? { x: v.x / l, y: v.y / l, z: v.z / l } : fallback;
}

export function randomUnit(rng: Rng): Vec3 {
  const z = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: s * Math.cos(phi), y: z, z: s * Math.sin(phi) };
}

/** Направление в конусе вокруг d с полууглом a (равномерно по телесному углу). */
export function randomCone(d: Vec3, a: number, rng: Rng): Vec3 {
  const t = normalizeOr(Math.abs(d.y) < 0.9 ? { x: d.z, y: 0, z: -d.x } : { x: 0, y: -d.z, z: d.y }, { x: 1, y: 0, z: 0 });
  const b = { x: d.y * t.z - d.z * t.y, y: d.z * t.x - d.x * t.z, z: d.x * t.y - d.y * t.x };
  const cosT = 1 - rng() * (1 - Math.cos(a));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = 2 * Math.PI * rng();
  const c = Math.cos(phi) * sinT;
  const s = Math.sin(phi) * sinT;
  return { x: t.x * c + b.x * s + d.x * cosT, y: t.y * c + b.y * s + d.y * cosT, z: t.z * c + b.z * s + d.z * cosT };
}

export function spawn(layer: Layer, pos: Vec3, dir: Vec3, rng: Rng): ParticleSpec {
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
  const s: ParticleSpec = {
    pos: p,
    vel: { x: v.x, y: v.y + up, z: v.z },
    gravity: layer.gravity ?? k.gravity,
    life,
    size0: pick(layer.size0, rng),
    size1: pick(layer.size1, rng),
    color: k.color(rng),
    alpha: k.alpha(rng),
  };
  if (k.stroke) s.stroke = true;
  return s;
}

/** Чья магия для каймы: своя, чужая или неизвестно (без каймы); свой маг неизвестен — тоже без каймы. */
export function sideOf(owner: UnitId, localId: UnitId): "own" | "foe" | null {
  if (localId === NOBODY || owner === NOBODY) return null;
  return owner === localId ? "own" : "foe";
}

/** Пометить частицы своими или чужими (кайма V3). Возвращает тот же массив. */
export function markSide<T extends ParticleSpec[]>(specs: T, side: "own" | "foe" | null): T {
  if (side === "own") for (const p of specs) p.own = true;
  else if (side === "foe") for (const p of specs) p.foe = true;
  return specs;
}

export function emit(layers: readonly Layer[], total: number, pos: Vec3, dir: Vec3, rng: Rng): ParticleSpec[] {
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

/** Слои ладони: вспышка каста, заряд и «пшик» — в пространстве камеры рук. */
export type PalmLayers = Readonly<Record<"flash" | "charge" | "fizzle", readonly Layer[]>>;
/** След снаряда на отрезке a → b: n частиц (число задаёт вызывающий по пройденному пути). */
export type TrailFn = (a: Vec3, b: Vec3, n: number, rng: Rng) => ParticleSpec[];
/**
 * Вид снаряда: ядро в G-буфер (mesh: сфера чернилами magic, камень — икосаэдр terrain, none — без ядра), ореол и
 * свет — в проходе света. trailEveryM — шаг частиц следа по пути, м.
 */
export interface ProjectileLook {
  mesh: "sphere" | "stone" | "none";
  core: number;
  halo: number;
  color: readonly [number, number, number];
  light: number;
  intensity: number;
  whiteCore: number;
  trailEveryM: number;
}
