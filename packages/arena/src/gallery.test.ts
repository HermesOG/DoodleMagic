import { describe, expect, it } from "vitest";
import { EYE_HEIGHT, PLAYER_HALF_W, PLAYER_HEIGHT, PLAYER_STEP, type AABB, type ArenaData, type Collider, type Vec3 } from "@doodlemagic/sim";
import { createArenaBuilder } from "./dsl";
import { GALLERY, buildGallery } from "./gallery";
import { box, boxInBox, boxesOverlap, canSee, floorBelow, pointInBox, sightDistance } from "./geom";

const full = buildGallery("full");
const compact = buildGallery("compact");
const variants: [string, ArenaData][] = [
  ["full", full],
  ["compact", compact],
];

/** Высшая точка прыжка (GDD 3): всё, что выше, не перепрыгнуть и не запрыгнуть. */
const JUMP_APEX = 1.25;
/** Полное укрытие — от 2,2 м; низкое — ровно 1 м. */
const FULL_COVER_MIN = 2.2;
const LOW_COVER = 1;
/** Щель между полными укрытиями — либо 0 (вплотную), либо от 1,2 м: уже — маг застревает. */
const MIN_SLIT = 1.2;
/** Наземные линии обзора не длиннее 32 м (с верха галереи — можно, так задумано). */
const MAX_GROUND_SIGHT = 32;

const movers = (a: ArenaData): Collider[] => a.colliders.filter((c) => !c.noSight);
const eye = (p: Vec3): Vec3 => ({ x: p.x, y: p.y + EYE_HEIGHT, z: p.z });
const bodyAt = (p: Vec3) => box(p.x - PLAYER_HALF_W, p.y, p.z - PLAYER_HALF_W, p.x + PLAYER_HALF_W, p.y + PLAYER_HEIGHT, p.z + PLAYER_HALF_W);
const footprintsOverlap = (p: AABB, q: AABB) => p.min.x < q.max.x - 1e-9 && p.max.x > q.min.x + 1e-9 && p.min.z < q.max.z - 1e-9 && p.max.z > q.min.z + 1e-9;
const inFootprint = (b: AABB, x: number, z: number) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z;

/** Верх опоры под коллайдером: самый высокий верх других коллайдеров под его подошвой, или null. */
function supportTop(a: ArenaData, c: Collider): number | null {
  let best: number | null = null;
  for (const o of movers(a)) {
    if (o === c || !footprintsOverlap(o.box, c.box) || o.box.max.y > c.box.min.y + 1e-6) continue;
    if (best === null || o.box.max.y > best) best = o.box.max.y;
  }
  return best;
}

/** Метки того, что не считается укрытием: по ним ходят или это кромка. */
const NOT_COVER = new Set(["stairs", "bridge", "rune", "kerb", "low", "parapet"]);

/** Нижний уровень, по которому ходят (дно рва). Ниже — фундамент и обрывы. */
const LOWEST_WALK = -1;

/**
 * Высота укрытия над тем, по чему ходят и на чём оно стоит. null — если оно висит (перемычка арки),
 * или стоит не на ходовом уровне (плиты пола на фундаменте).
 */
function coverHeight(a: ArenaData, c: Collider): number | null {
  const s = supportTop(a, c);
  if (s === null || s < LOWEST_WALK - 1e-6 || Math.abs(c.box.min.y - s) > 1e-6) return null;
  return c.box.max.y - s;
}

/** Полные укрытия и стены, которые стоят на земле: о них может застрять маг. */
function fullBlockers(a: ArenaData): Collider[] {
  return movers(a).filter((c) => {
    if (c.tag && NOT_COVER.has(c.tag)) return false;
    const h = coverHeight(a, c);
    if (h !== null) return h >= FULL_COVER_MIN;
    // стены из фундамента (наружные, глухие стены компактного варианта)
    return supportTop(a, c) === null && c.box.min.y <= -1 && c.box.max.y >= FULL_COVER_MIN;
  });
}

/** Свободные отрезки вдоль X на высоте y и глубине z (шаг 5 см). */
function freeSpans(a: ArenaData, y: number, z: number): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let start: number | null = null;
  for (let x = a.bounds.min.x; x <= a.bounds.max.x + 1e-9; x += 0.05) {
    const blocked = movers(a).some((c) => pointInBox(c.box, { x, y, z }));
    if (!blocked && start === null) start = x;
    if (blocked && start !== null) {
      spans.push({ from: start, to: x });
      start = null;
    }
  }
  return spans;
}

/** По чему ходят: полы, ров, бортики, первая ступень. Низкая стенка (1 м) — уже препятствие. */
const WALK_TOP = 0.6;

/**
 * Проходимая ширина ряда z: x свободен, если под ним есть пол (не пропасть), над полом на высоте
 * тела ничего нет и это не восходящий поток. Перепад «ров — пол» (1 м) ряд не рвёт: это та же дорожка.
 */
function walkSpans(a: ArenaData, z: number): { from: number; to: number }[] {
  const ms = movers(a);
  const lifts = a.volumes.filter((v) => v.kind === "updraft");
  const free = (x: number): boolean => {
    let floor: number | null = null;
    for (const c of ms) {
      const top = c.box.max.y;
      if (inFootprint(c.box, x, z) && top <= WALK_TOP && top >= -1.5 && (floor === null || top > floor)) floor = top;
    }
    if (floor === null) return false;
    if (lifts.some((v) => inFootprint(v.box, x, z))) return false;
    const f = floor;
    return ![PLAYER_STEP + 0.05, 1, 1.7].some((dy) => ms.some((c) => pointInBox(c.box, { x, y: f + dy, z })));
  };
  const spans: { from: number; to: number }[] = [];
  let start: number | null = null;
  const n = Math.round((a.bounds.max.x - a.bounds.min.x) / 0.05);
  for (let i = 0; i <= n; i++) {
    const x = a.bounds.min.x + i * 0.05;
    const ok = free(x);
    // отрезок начинается от последней занятой точки: так ширина точна для рёбер на сетке 5 см
    if (ok && start === null) start = i === 0 ? x : x - 0.05;
    if (!ok && start !== null) {
      spans.push({ from: start, to: x });
      start = null;
    }
  }
  if (start !== null) spans.push({ from: start, to: a.bounds.max.x });
  return spans;
}

const spanAt = (spans: { from: number; to: number }[], x: number) => spans.find((s) => s.from <= x && x <= s.to);
const width = (s: { from: number; to: number } | undefined) => (s ? Math.round((s.to - s.from) * 100) / 100 : 0);

// ---------------------------------------------------------------- проходимость в 2D

/**
 * Где может стоять маг. Сетка центров подошвы с шагом step; в каждой клетке — высоты пола, на
 * которых тело (2·halfW × height) опирается на коллайдер (подошва перекрывает его по площади) и ни
 * во что не входит: ни в коллайдеры (кроме noSight), ни в восходящий поток, ни в зону смерти.
 * Соседние по сетке состояния связаны, если перепад пола не больше ступени (PLAYER_STEP): так
 * моделируются лестницы, бортики и ступень рва. Прыжки и спрыгивания не считаются — это осторожная
 * оценка: что связано здесь, то связано и пешком в обе стороны.
 */
interface Stand {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
  /** Состояния клетки c — от first[c] до first[c + 1] − 1. */
  first: Int32Array;
  level: Float64Array;
  cell: Int32Array;
  parent: Int32Array;
  /** Упирается ли тело на высоте f в точке (x, z) в стену: коллайдер выше ступени или объём. */
  wallAt: (x: number, z: number, f: number) => boolean;
}

const EPS = 1e-6;

function ufFind(p: Int32Array, s: number): number {
  while (p[s] !== s) {
    p[s] = p[p[s]!]!;
    s = p[s]!;
  }
  return s;
}

function ufUnion(p: Int32Array, a: number, b: number): void {
  const ra = ufFind(p, a);
  const rb = ufFind(p, b);
  if (ra !== rb) p[ra] = rb;
}

function buildStand(a: ArenaData, step = 0.1): Stand {
  const H = PLAYER_HALF_W;
  const solids = movers(a).map((c) => c.box);
  const vols = a.volumes.filter((v) => v.kind === "updraft" || v.kind === "kill").map((v) => v.box);
  const x0 = a.bounds.min.x;
  const z0 = a.bounds.min.z;
  const nx = Math.round((a.bounds.max.x - x0) / step) + 1;
  const nz = Math.round((a.bounds.max.z - z0) / step) + 1;
  // корзины 2 × 2 м, чтобы не перебирать все коллайдеры в каждой клетке
  const T = 2;
  const tx = Math.ceil((a.bounds.max.x - x0) / T) + 1;
  const tz = Math.ceil((a.bounds.max.z - z0) / T) + 1;
  const buckets: number[][] = Array.from({ length: tx * tz }, () => []);
  solids.forEach((b, idx) => {
    const i0 = Math.max(0, Math.floor((b.min.x - H - x0) / T));
    const i1 = Math.min(tx - 1, Math.floor((b.max.x + H - x0) / T));
    const k0 = Math.max(0, Math.floor((b.min.z - H - z0) / T));
    const k1 = Math.min(tz - 1, Math.floor((b.max.z + H - z0) / T));
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) buckets[i * tz + k]!.push(idx);
  });
  const under = (b: AABB, cx: number, cz: number) => b.min.x < cx + H - EPS && b.max.x > cx - H + EPS && b.min.z < cz + H - EPS && b.max.z > cz - H + EPS;
  const bucketAt = (cx: number, cz: number) => buckets[Math.floor((cx - x0) / T) * tz + Math.floor((cz - z0) / T)] ?? [];
  const first = new Int32Array(nx * nz + 1);
  const levels: number[] = [];
  const cells: number[] = [];
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const c = i * nz + k;
      first[c] = levels.length;
      const cx = x0 + i * step;
      const cz = z0 + k * step;
      const cand = bucketAt(cx, cz)
        .map((idx) => solids[idx]!)
        .filter((b) => under(b, cx, cz));
      for (const f of [...new Set(cand.map((b) => b.max.y))].sort((p, q) => p - q)) {
        const hit = (b: AABB) => b.min.y < f + PLAYER_HEIGHT - EPS && b.max.y > f + EPS;
        if (cand.some(hit) || vols.some((v) => under(v, cx, cz) && hit(v))) continue;
        levels.push(f);
        cells.push(c);
      }
    }
  }
  first[nx * nz] = levels.length;
  const parent = new Int32Array(levels.length);
  for (let s = 0; s < parent.length; s++) parent[s] = s;
  const wallAt = (cx: number, cz: number, f: number): boolean => {
    if (cx < x0 || cz < z0 || cx > a.bounds.max.x || cz > a.bounds.max.z) return true;
    const rises = (b: AABB) => under(b, cx, cz) && b.min.y < f + PLAYER_HEIGHT - EPS;
    return bucketAt(cx, cz).some((idx) => rises(solids[idx]!) && solids[idx]!.max.y > f + PLAYER_STEP + EPS) || vols.some((v) => rises(v) && v.max.y > f + EPS);
  };
  const st: Stand = { x0, z0, step, nx, nz, first, level: Float64Array.from(levels), cell: Int32Array.from(cells), parent, wallAt };
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const c = i * nz + k;
      for (const d of [i + 1 < nx ? c + nz : -1, k + 1 < nz ? c + 1 : -1]) {
        if (d < 0) continue;
        for (let s = first[c]!; s < first[c + 1]!; s++) {
          for (let t = first[d]!; t < first[d + 1]!; t++) {
            if (Math.abs(st.level[s]! - st.level[t]!) <= PLAYER_STEP + EPS) ufUnion(parent, s, t);
          }
        }
      }
    }
  }
  return st;
}

/** Состояние в ближайшей клетке сетки на высоте около p.y (±0,3 м) или −1. */
function stateAt(st: Stand, p: Vec3): number {
  const i = Math.round((p.x - st.x0) / st.step);
  const k = Math.round((p.z - st.z0) / st.step);
  if (i < 0 || k < 0 || i >= st.nx || k >= st.nz) return -1;
  const c = i * st.nz + k;
  let best = -1;
  for (let s = st.first[c]!; s < st.first[c + 1]!; s++) {
    const d = Math.abs(st.level[s]! - p.y);
    if (d <= 0.3 && (best < 0 || d < Math.abs(st.level[best]! - p.y))) best = s;
  }
  return best;
}

/** Номер пешей области точки или −1, если там не встать. */
function regionOf(st: Stand, p: Vec3): number {
  const s = stateAt(st, p);
  return s < 0 ? -1 : ufFind(st.parent, s);
}

const cellXZ = (st: Stand, c: number) => [st.x0 + Math.floor(c / st.nz) * st.step, st.z0 + (c % st.nz) * st.step] as const;

/** Сосед по сетке с совместимой высотой пола (перепад ≤ ступени) или −1. */
function neighbor(st: Stand, s: number, di: number, dk: number): number {
  const c = st.cell[s]!;
  const i = Math.floor(c / st.nz) + di;
  const k = (c % st.nz) + dk;
  if (i < 0 || k < 0 || i >= st.nx || k >= st.nz) return -1;
  const d = i * st.nz + k;
  let best = -1;
  for (let t = st.first[d]!; t < st.first[d + 1]!; t++) {
    const dl = Math.abs(st.level[t]! - st.level[s]!);
    if (dl <= PLAYER_STEP + EPS && (best < 0 || dl < Math.abs(st.level[best]! - st.level[s]!))) best = t;
  }
  return best;
}

const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DIRS8 = [...DIRS4, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/**
 * Тупики уже minWidth в пешей области region. Состояние «узкое», если непрерывный ряд доступных
 * центров через него вдоль X (или вдоль Z) короче minWidth − 2·halfW, то есть физический просвет
 * меньше minWidth, и ряд с обоих концов упирается в стену. Конец у обрыва или края пропасти карманом
 * не считается: там не зажмут, там сбросят. Узкие состояния собираются в связные куски; выходы куска —
 * соседние широкие состояния, сгруппированные по 8-связности. Кусок с одной группой выходов — тупик.
 */
function deadEnds(st: Stand, region: number, minWidth = 2): string[] {
  const n = st.level.length;
  const inRegion = (s: number) => s >= 0 && ufFind(st.parent, s) === region;
  const runOf = (di: number, dk: number) => {
    const len = new Int32Array(n).fill(-1);
    const wall = new Uint8Array(n);
    for (let s0 = 0; s0 < n; s0++) {
      if (!inRegion(s0) || len[s0] !== -1) continue;
      const chain: number[] = [];
      let t = s0;
      let last = s0;
      while (t >= 0 && inRegion(t) && len[t] === -1) {
        chain.push(t);
        last = t;
        t = neighbor(st, t, di, dk);
      }
      let l = 0;
      let w = 0;
      if (t >= 0 && inRegion(t)) {
        l = len[t]!;
        w = wall[t]!;
      } else {
        const [x, z] = cellXZ(st, st.cell[last]!);
        w = st.wallAt(x + di * st.step, z + dk * st.step, st.level[last]!) ? 1 : 0;
      }
      for (let j = chain.length - 1; j >= 0; j--) {
        len[chain[j]!] = ++l;
        wall[chain[j]!] = w;
      }
    }
    return { len, wall };
  };
  const xp = runOf(1, 0);
  const xm = runOf(-1, 0);
  const zp = runOf(0, 1);
  const zm = runOf(0, -1);
  const lim = minWidth - 2 * PLAYER_HALF_W - st.step / 2;
  const narrow = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (!inRegion(s)) continue;
    const ex = (xp.len[s]! + xm.len[s]! - 2) * st.step;
    const ez = (zp.len[s]! + zm.len[s]! - 2) * st.step;
    if ((ex < lim && xp.wall[s] && xm.wall[s]) || (ez < lim && zp.wall[s] && zm.wall[s])) narrow[s] = 1;
  }
  const piece = new Int32Array(n);
  for (let s = 0; s < n; s++) piece[s] = s;
  for (let s = 0; s < n; s++) {
    if (!narrow[s]) continue;
    for (const [di, dk] of DIRS4) {
      const t = neighbor(st, s, di, dk);
      if (t >= 0 && narrow[t]) ufUnion(piece, s, t);
    }
  }
  const members = new Map<number, number[]>();
  const exits = new Map<number, Set<number>>();
  for (let s = 0; s < n; s++) {
    if (!narrow[s]) continue;
    const r = ufFind(piece, s);
    if (!members.has(r)) members.set(r, []);
    members.get(r)!.push(s);
    for (const [di, dk] of DIRS4) {
      const t = neighbor(st, s, di, dk);
      if (t >= 0 && inRegion(t) && !narrow[t]) {
        if (!exits.has(r)) exits.set(r, new Set());
        exits.get(r)!.add(t);
      }
    }
  }
  const found: string[] = [];
  for (const [r, mem] of members) {
    const ex = [...(exits.get(r) ?? [])];
    const group = new Map<number, number>(ex.map((s) => [s, s]));
    const root = (s: number): number => {
      while (group.get(s) !== s) s = group.get(s)!;
      return s;
    };
    for (const s of ex) {
      for (const [di, dk] of DIRS8) {
        const t = neighbor(st, s, di, dk);
        if (t >= 0 && group.has(t) && root(s) !== root(t)) group.set(root(s), root(t));
      }
    }
    if (new Set(ex.map(root)).size > 1) continue;
    const xs = mem.map((m) => cellXZ(st, st.cell[m]!));
    const span = (j: 0 | 1) => `${Math.min(...xs.map((p) => p[j])).toFixed(1)}…${Math.max(...xs.map((p) => p[j])).toFixed(1)}`;
    found.push(`x ${span(0)}, z ${span(1)}, y ${st.level[mem[0]!]}`);
  }
  return found;
}

/**
 * Ширина самого широкого пешего пути от from до to на уровне пола y по доступным центрам области
 * region внутри прямоугольника roi. Просвет точки — расстояние до ближайшей «стены» пути:
 * - коллайдера, который мешает телу выше ступени, или восходящего потока (точно, по боксу);
 * - края, за которым на этом уровне не встать: обрыв рва, край ущелья (по сетке: расстояние до
 *   ближайшей клетки без опоры на уровне y ± ступень, минус halfW, на которые подошва свисает).
 * Ответ — 2 × наименьший просвет на лучшем пути. Это оценка снизу: сетка не всегда попадает точно
 * в середину горловины.
 */
function widestRoute(a: ArenaData, st: Stand, region: number, y: number, from: Vec3, to: Vec3, roi: AABB): number {
  const M = 3;
  const near = box(roi.min.x - M, -100, roi.min.z - M, roi.max.x + M, 100, roi.max.z + M);
  const obst = [
    ...movers(a)
      .filter((c) => c.box.min.y < y + PLAYER_HEIGHT - EPS && c.box.max.y > y + PLAYER_STEP + EPS)
      .map((c) => c.box),
    ...a.volumes.filter((v) => v.kind === "updraft").map((v) => v.box),
  ].filter((b) => boxesOverlap(b, near, 0));
  // окно сетки вокруг roi: клетки-обрывы и поле расстояний до них (волна от всех обрывов сразу)
  const wi0 = Math.max(0, Math.floor((near.min.x - st.x0) / st.step));
  const wi1 = Math.min(st.nx - 1, Math.ceil((near.max.x - st.x0) / st.step));
  const wk0 = Math.max(0, Math.floor((near.min.z - st.z0) / st.step));
  const wk1 = Math.min(st.nz - 1, Math.ceil((near.max.z - st.z0) / st.step));
  const wn = wk1 - wk0 + 1;
  const W = (wi1 - wi0 + 1) * wn;
  const seedX = new Float64Array(W).fill(NaN);
  const seedZ = new Float64Array(W).fill(NaN);
  const dist = new Float64Array(W).fill(Infinity);
  let wave: number[] = [];
  for (let i = wi0; i <= wi1; i++) {
    for (let k = wk0; k <= wk1; k++) {
      const c = i * st.nz + k;
      let ok = false;
      for (let s = st.first[c]!; s < st.first[c + 1]!; s++) if (Math.abs(st.level[s]! - y) <= PLAYER_STEP + EPS) ok = true;
      if (ok) continue;
      const [x, z] = cellXZ(st, c);
      if (st.wallAt(x, z, y)) continue;
      const w = (i - wi0) * wn + (k - wk0);
      seedX[w] = x;
      seedZ[w] = z;
      dist[w] = 0;
      wave.push(w);
    }
  }
  while (wave.length > 0) {
    const next: number[] = [];
    for (const w of wave) {
      const i = Math.floor(w / wn);
      const k = w % wn;
      for (const [di, dk] of DIRS8) {
        const ii = i + di;
        const kk = k + dk;
        if (ii < 0 || kk < 0 || ii > wi1 - wi0 || kk >= wn) continue;
        const o = ii * wn + kk;
        const x = st.x0 + (ii + wi0) * st.step;
        const z = st.z0 + (kk + wk0) * st.step;
        const d = Math.hypot(x - seedX[w]!, z - seedZ[w]!);
        if (d < dist[o]! - 1e-9) {
          dist[o] = d;
          seedX[o] = seedX[w]!;
          seedZ[o] = seedZ[w]!;
          next.push(o);
        }
      }
    }
    wave = next;
  }
  const pts: number[] = [];
  const clear: number[] = [];
  const index = new Map<number, number>();
  for (let s = 0; s < st.level.length; s++) {
    if (Math.abs(st.level[s]! - y) > 0.3 || ufFind(st.parent, s) !== region) continue;
    const c = st.cell[s]!;
    const [x, z] = cellXZ(st, c);
    if (x < roi.min.x || x > roi.max.x || z < roi.min.z || z > roi.max.z) continue;
    let d = Infinity;
    for (const b of obst) d = Math.min(d, Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z)));
    const i = Math.floor(c / st.nz);
    const k = c % st.nz;
    if (i >= wi0 && i <= wi1 && k >= wk0 && k <= wk1) d = Math.min(d, dist[(i - wi0) * wn + (k - wk0)]! - PLAYER_HALF_W);
    index.set(c, pts.length);
    pts.push(c);
    clear.push(d);
  }
  const cellOf = (p: Vec3) => Math.round((p.x - st.x0) / st.step) * st.nz + Math.round((p.z - st.z0) / st.step);
  const src = index.get(cellOf(from));
  const dst = index.get(cellOf(to));
  if (src === undefined || dst === undefined) return 0;
  const added = new Int32Array(pts.length).fill(-1);
  for (const j of pts.map((_, j) => j).sort((p, q) => clear[q]! - clear[p]!)) {
    added[j] = j;
    const c = pts[j]!;
    const i = Math.floor(c / st.nz);
    const k = c % st.nz;
    for (const [di, dk] of DIRS8) {
      if (i + di < 0 || k + dk < 0 || i + di >= st.nx || k + dk >= st.nz) continue;
      const o = index.get((i + di) * st.nz + k + dk);
      if (o !== undefined && added[o]! >= 0) ufUnion(added, j, o);
    }
    if (added[src]! >= 0 && added[dst]! >= 0 && ufFind(added, src) === ufFind(added, dst)) return 2 * clear[j]!;
  }
  return 0;
}

const MOAT_LEVEL = -1;
const BACK_Z = -17.5;
const CELL_ROW_Z = -14;
const DECK_HALF = 1.5;

const standCache = new Map<ArenaData, Stand>();
/** Пешая сетка арены (считается один раз на вариант). */
function standOf(a: ArenaData): Stand {
  let st = standCache.get(a);
  if (!st) standCache.set(a, (st = buildStand(a)));
  return st;
}

/** Места, которые обязаны быть в одной пешей области со спаунами. */
function landmarks(a: ArenaData): [string, Vec3][] {
  const out: [string, Vec3][] = a.spawns.map((s, i) => [`spawn ${i}`, s.pos]);
  for (const side of [-1, 1]) {
    const h = side < 0 ? "A" : "B";
    out.push(
      [`west courtyard ${h}`, { x: -12.5, y: 0, z: 10.5 * side }],
      [`central courtyard ${h}`, { x: 0, y: 0, z: 7 * side }],
      [`east courtyard ${h}`, { x: 8.5, y: 0, z: 7.5 * side }],
      [`bridge ${h}, courtyard end`, { x: 0, y: 0, z: 4.6 * side }],
      [`bridge ${h}, rune end`, { x: 0, y: 0, z: 2.4 * side }],
      [`west-arch forecourt ${h}`, { x: -9.5, y: 0, z: 3.5 * side }],
      [`east-arch forecourt ${h}`, { x: 9.5, y: 0, z: 3.5 * side }],
    );
    if (a.variant === "full") out.push([`moat ${h}`, { x: -18.5, y: MOAT_LEVEL, z: 11.5 * side }], [`grass corner ${h}`, { x: 19.5, y: 0, z: 13 * side }]);
  }
  out.push(["rune platform", { x: 0, y: 0, z: 0 }], ["gallery deck", { x: -5, y: GALLERY.deckY, z: 0 }]);
  if (a.variant === "full") out.push(["moat under its arch", { x: -18.5, y: MOAT_LEVEL, z: 0 }], ["east lane behind the tower", { x: 18.5, y: 0, z: 0 }]);
  return out;
}

describe.each(variants)("gallery (%s)", (_name, a) => {
  it("fits its stated bounds", () => {
    for (const c of a.colliders) expect(boxInBox(a.bounds, c.box)).toBe(true);
    for (const r of a.render) expect(boxInBox(a.bounds, r.box)).toBe(true);
    for (const v of a.volumes) expect(boxInBox(a.bounds, v.box)).toBe(true);
    for (const p of [...a.spawns.map((s) => s.pos), ...a.pickups.map((p) => p.pos)]) expect(pointInBox(a.bounds, p)).toBe(true);
  });

  it("owns its bounds instead of sharing the GALLERY constant", () => {
    expect(a.bounds).toStrictEqual(a.variant === "full" ? GALLERY.full : GALLERY.compact);
    expect(a.bounds).not.toBe(GALLERY.full);
    expect(a.bounds).not.toBe(GALLERY.compact);
  });

  it("has 10 FFA spawns standing on the floor and clear of every collider", () => {
    expect(a.spawns).toHaveLength(10);
    for (const s of a.spawns) {
      // тело не застряло ни в одном коллайдере: физика игнорирует то, во что тело вросло
      expect(a.colliders.filter((c) => boxesOverlap(bodyAt(s.pos), c.box))).toStrictEqual([]);
      // опора ровно под подошвой: не висит и не провалилось
      const floor = floorBelow(a.colliders, s.pos);
      expect(floor).not.toBeNull();
      expect(Math.abs(floor! - s.pos.y)).toBeLessThan(1e-6);
      expect(Math.abs(floorBelow(a.colliders, { ...s.pos, y: s.pos.y + 0.5 })! - s.pos.y)).toBeLessThan(1e-6);
    }
  });

  it("has no direct line of sight between any two spawns", () => {
    for (let i = 0; i < a.spawns.length; i++) {
      for (let j = i + 1; j < a.spawns.length; j++) {
        expect(canSee(a.colliders, eye(a.spawns[i]!.pos), eye(a.spawns[j]!.pos)), `spawn ${i} sees spawn ${j}`).toBe(false);
      }
    }
  });

  it("puts every hole in the walking floor inside a kill volume", () => {
    const kill = a.volumes.filter((v) => v.kind === "kill");
    for (const v of kill) expect(v.box.max.y).toBeLessThanOrEqual(-2);
    const ms = movers(a);
    let holes = 0;
    let overhead = 0;
    const missed: string[] = [];
    const step = 0.25;
    const nx = Math.round((a.bounds.max.x - a.bounds.min.x) / step);
    const nz = Math.round((a.bounds.max.z - a.bounds.min.z) / step);
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const x = a.bounds.min.x + (i + 0.5) * step;
        const z = a.bounds.min.z + (k + 0.5) * step;
        // под ногами твёрдо, если есть пол на уровне ходьбы (верх от −1,5 до 0,6 м) или глыба, что
        // стоит от дна рва и ниже; перемычки арок и дорожка галереи над пустотой полом не считаются
        const solid = ms.some((c) => inFootprint(c.box, x, z) && c.box.max.y >= -1.5 && (c.box.max.y <= WALK_TOP || c.box.min.y <= LOWEST_WALK));
        if (solid) continue;
        holes++;
        if (ms.some((c) => inFootprint(c.box, x, z) && c.box.min.y > WALK_TOP)) overhead++;
        if (!kill.some((v) => inFootprint(v.box, x, z))) missed.push(`(${x}, ${z})`);
      }
    }
    // положительный контроль: ущелье есть, и дыры под перемычкой арки руны тоже видны
    expect(holes).toBeGreaterThan(100);
    expect(overhead).toBeGreaterThan(0);
    expect(missed.slice(0, 10)).toStrictEqual([]);
  });

  it("has two stone bridges at least 3 m wide from the floor to a 4 × 4 m rune platform", () => {
    const rune = a.colliders.filter((c) => c.tag === "rune");
    expect(rune).toHaveLength(1);
    const r = rune[0]!.box;
    expect([r.max.x - r.min.x, r.max.z - r.min.z]).toStrictEqual([4, 4]);
    expect(a.pickups.filter((p) => p.kind === "rune")).toHaveLength(1);
    const bridges = a.colliders.filter((c) => c.tag === "bridge");
    expect(bridges).toHaveLength(2);
    const ms = movers(a);
    for (const { box: b } of bridges) {
      // мост идёт вдоль Z: ширина — по X
      expect(b.max.x - b.min.x).toBeGreaterThanOrEqual(3);
      const near = b.max.z <= r.min.z ? b.max.z : b.min.z;
      const far = near === b.max.z ? b.min.z : b.max.z;
      const out = Math.sign(far - near);
      const midX = (b.min.x + b.max.x) / 2;
      // ближний конец упирается в площадку руны, дальний — в пол двора, по бокам — пустота
      expect(near === r.min.z || near === r.max.z).toBe(true);
      expect(floorBelow(ms, { x: midX, y: 1, z: near - out * 0.25 })).toBe(r.max.y);
      expect(floorBelow(ms, { x: midX, y: 1, z: far + out * 0.25 })).toBe(b.max.y);
      expect(floorBelow(ms, { x: b.max.x + 0.25, y: 1, z: (near + far) / 2 }, 1.5)).toBeNull();
      expect(floorBelow(ms, { x: b.min.x - 0.25, y: 1, z: (near + far) / 2 }, 1.5)).toBeNull();
    }
  });

  it("uses jumpable 1 m low cover and full cover from 2.2 m above whatever it stands on", () => {
    const low = a.colliders.filter((c) => c.tag === "low");
    expect(low.length).toBeGreaterThan(0);
    for (const c of low) expect(coverHeight(a, c)).toBe(LOW_COVER);
    const bad: string[] = [];
    let measured = 0;
    let sunken = 0;
    for (const c of movers(a)) {
      if (c.tag && NOT_COVER.has(c.tag)) continue;
      const h = coverHeight(a, c);
      if (h === null) continue;
      measured++;
      if (c.box.min.y < 0) sunken++;
      if (h > PLAYER_STEP && h < FULL_COVER_MIN) bad.push(`${JSON.stringify(c.box)}: ${h.toFixed(2)} m`);
    }
    // положительный контроль: проверка видит и укрытия во рву (они стоят на −1 м; в компактном рва нет)
    expect(measured).toBeGreaterThan(20);
    if (a.variant === "full") expect(sunken).toBeGreaterThan(0);
    expect(bad).toStrictEqual([]);
  });

  it("leaves no slit narrower than 1.2 m between full-cover blockers (or low cover beside them)", () => {
    const blockers = [...fullBlockers(a), ...a.colliders.filter((c) => c.tag === "low")];
    expect(blockers.length).toBeGreaterThan(20);
    const slits: string[] = [];
    for (let i = 0; i < blockers.length; i++) {
      for (let j = i + 1; j < blockers.length; j++) {
        const p = blockers[i]!.box;
        const q = blockers[j]!.box;
        // по высоте должны перекрываться на рост мага, иначе это разные ярусы
        if (Math.min(p.max.y, q.max.y) - Math.max(p.min.y, q.min.y) < 1) continue;
        const dx = Math.max(0, p.min.x - q.max.x, q.min.x - p.max.x);
        const dz = Math.max(0, p.min.z - q.max.z, q.min.z - p.max.z);
        const gap = Math.hypot(dx, dz);
        if (gap <= 1e-6 || gap >= MIN_SLIT - 1e-6) continue;
        // середина щели: если её закрывает третий блок (например, передняя стена кельи), щели нет
        const mid = (lo0: number, hi0: number, lo1: number, hi1: number) =>
          hi0 <= lo1 ? (hi0 + lo1) / 2 : hi1 <= lo0 ? (hi1 + lo0) / 2 : (Math.max(lo0, lo1) + Math.min(hi0, hi1)) / 2;
        const m = { x: mid(p.min.x, p.max.x, q.min.x, q.max.x), y: Math.max(p.min.y, q.min.y) + 1, z: mid(p.min.z, p.max.z, q.min.z, q.max.z) };
        if (movers(a).some((c) => c.box !== p && c.box !== q && pointInBox(c.box, m))) continue;
        slits.push(`${JSON.stringify(p)} ↔ ${JSON.stringify(q)}: ${gap.toFixed(2)} m`);
      }
    }
    expect(slits).toStrictEqual([]);
  });

  it("stays within the collider budget of 300 boxes", () => {
    expect(a.colliders.length).toBeLessThanOrEqual(300);
  });

  it("is plain data", () => {
    expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
  });

  it(`keeps ground-level sight lines within ${MAX_GROUND_SIGHT} m`, () => {
    const ms = movers(a);
    const worst: string[] = [];
    const DIRS = 180;
    const dirs = Array.from({ length: DIRS }, (_, k) => {
      const ang = (k / DIRS) * Math.PI * 2;
      return { x: Math.cos(ang), y: 0, z: Math.sin(ang) };
    });
    for (let x = a.bounds.min.x + 0.75; x < a.bounds.max.x; x += 1.5) {
      for (let z = a.bounds.min.z + 0.75; z < a.bounds.max.z; z += 1.5) {
        // только земля: пол не выше 1,2 м; верх галереи (+4 м) сюда не попадает
        const floor = floorBelow(ms, { x, y: 2.5, z }, 4);
        if (floor === null || floor > 1.2) continue;
        const feet = { x, y: floor, z };
        if (ms.some((c) => boxesOverlap(bodyAt(feet), c.box))) continue;
        const e = eye(feet);
        // лучи горизонтальны: закрыть их может только то, что на высоте глаз
        const solid = a.colliders.filter((c) => c.box.min.y <= e.y && c.box.max.y >= e.y);
        dirs.forEach((dir, k) => {
          const d = sightDistance(solid, e, dir, 60) ?? 60;
          if (d > MAX_GROUND_SIGHT) worst.push(`(${x.toFixed(2)}, ${z.toFixed(2)}) dir ${k * 2}°: ${d.toFixed(1)} m`);
        });
      }
    }
    expect(worst.slice(0, 20)).toStrictEqual([]);
  });

  it("keeps the rune readable: seen from both bridge approaches and from a fair share of the ground", () => {
    const rune = a.pickups.find((p) => p.kind === "rune")!.pos;
    for (const side of [-1, 1]) {
      for (const d of [8, 12]) expect(canSee(a.colliders, eye({ x: 0, y: 0, z: side * d }), rune), `from z = ${side * d}`).toBe(true);
    }
    const ms = movers(a);
    let ground = 0;
    let sees = 0;
    for (let x = a.bounds.min.x + 0.75; x < a.bounds.max.x; x += 1.5) {
      for (let z = a.bounds.min.z + 0.75; z < a.bounds.max.z; z += 1.5) {
        const floor = floorBelow(ms, { x, y: 2.5, z }, 4);
        if (floor === null || floor > 1.2) continue;
        const feet = { x, y: floor, z };
        if (ms.some((c) => boxesOverlap(bodyAt(feet), c.box))) continue;
        ground++;
        if (canSee(a.colliders, eye(feet), rune)) sees++;
      }
    }
    // блокаут до правок линий обзора: 20 % (полный) и 31 % (компактный)
    expect(sees / ground).toBeGreaterThanOrEqual(0.15);
  });

  it("joins spawns, courtyards, moat, east lane, bridges and rune into one walkable region", () => {
    const st = standOf(a);
    const main = regionOf(st, a.spawns[0]!.pos);
    expect(main).toBeGreaterThanOrEqual(0);
    const apart = landmarks(a)
      .filter(([, p]) => regionOf(st, p) !== main)
      .map(([name]) => name);
    expect(apart).toStrictEqual([]);
  });

  it("has no walled pocket narrower than 2 m with a single way out", () => {
    const st = standOf(a);
    const main = regionOf(st, a.spawns[0]!.pos);
    expect(main).toBeGreaterThanOrEqual(0);
    // анализ не пустой: в главной области десятки тысяч состояний
    let states = 0;
    for (let s = 0; s < st.level.length; s++) if (ufFind(st.parent, s) === main) states++;
    expect(states).toBeGreaterThan(50000);
    expect(deadEnds(st, main)).toStrictEqual([]);
  });

  it.each([-1, 1])("links every courtyard zone with a walking route at least 4 m wide (side %s)", (side) => {
    const st = standOf(a);
    const main = regionOf(st, a.spawns[0]!.pos);
    const P = (x: number, z: number): Vec3 => ({ x, y: 0, z: z * side });
    const half = (x0: number, x1: number) => (side < 0 ? box(x0, 0, CELL_ROW_Z, x1, 0, -DECK_HALF) : box(x0, 0, DECK_HALF, x1, 0, -CELL_ROW_Z));
    const inner = a.variant === "full" ? 15.5 : 14.5;
    const zones = { west: P(-12.5, 11.5), westArch: P(-9.5, 3.5), central: P(0, 8.5), east: P(8.5, 7.5), eastArch: P(9.5, 3.5) };
    const links: [string, Vec3, Vec3, AABB][] = [
      ["west-arch forecourt ↔ west courtyard", zones.westArch, zones.west, half(-inner, -6)],
      ["west ↔ central", zones.west, zones.central, half(-inner, 6)],
      ["central ↔ east", zones.central, zones.east, half(-6, inner)],
      ["east courtyard ↔ east-arch forecourt", zones.east, zones.eastArch, half(6, inner)],
    ];
    const narrow = links
      .map(([name, from, to, roi]) => [name, widestRoute(a, st, main, 0, from, to, roi)] as const)
      .filter(([, w]) => w < 4 - 1e-9)
      .map(([name, w]) => `${name}: ${w.toFixed(2)} m`);
    expect(narrow).toStrictEqual([]);
  });

  it("keeps the parapet over the gorge too high to hop onto, but low enough to see over", () => {
    const parapet = a.colliders.filter((c) => c.tag === "parapet");
    expect(parapet.length).toBeGreaterThan(0);
    const g = GALLERY.gorge;
    for (const side of [-1, 1]) {
      const tall = parapet
        .filter((c) => Math.sign(c.box.min.z + c.box.max.z) === side && coverHeight(a, c)! > JUMP_APEX)
        .map((c) => [c.box.min.x, c.box.max.x] as const)
        .sort((p, q) => p[0] - q[0]);
      // высокий парапет без разрывов закрывает весь пролёт над ущельем
      let reach: number = g.x0;
      for (const [x0, x1] of tall) if (x0 <= reach + 1e-9) reach = Math.max(reach, x1);
      expect(reach).toBeGreaterThanOrEqual(g.x1);
    }
    for (const c of parapet) {
      const h = coverHeight(a, c);
      expect(h).not.toBeNull();
      expect(h!).toBeLessThan(EYE_HEIGHT);
    }
  });
});

describe("gallery layout", () => {
  it("is 44 × 36 m, the compact variant 30 × 36 m", () => {
    const size = (a: ArenaData) => [a.bounds.max.x - a.bounds.min.x, a.bounds.max.z - a.bounds.min.z];
    expect(size(full)).toStrictEqual([44, 36]);
    expect(size(compact)).toStrictEqual([30, 36]);
  });

  it.each([1, 1.7])("connects the halves through ≥ 4 m arches and ≥ 6 m main lanes (y = %s m)", (y) => {
    const spans = freeSpans(full, y, 0).map((s) => Math.round((s.to - s.from) * 10) / 10);
    // ров, западная арка, арка руны, восточная арка, восточный проход
    expect(spans).toStrictEqual([6, 4, 5, 4, 6]);
  });

  it.each([1, 1.7])("closes the flanks in the compact variant (y = %s m)", (y) => {
    const spans = freeSpans(compact, y, 0).map((s) => Math.round((s.to - s.from) * 10) / 10);
    expect(spans).toStrictEqual([4, 5, 4]);
  });

  it.each([-4.5, -4, -3, -2, 2, 3, 4, 4.5])("keeps the moat arch approach 6 m wide at z = %s", (z) => {
    expect(width(spanAt(walkSpans(full, z), -18.5))).toBeGreaterThanOrEqual(6);
  });

  it.each([-1, 1])("keeps the widest route from the east courtyard into the east lane at least 4 m wide (side %s)", (side) => {
    const st = standOf(full);
    const main = regionOf(st, full.spawns[0]!.pos);
    const roi = side < 0 ? box(4, 0, BACK_Z, 21.5, 0, 2.5) : box(4, 0, -2.5, 21.5, 0, -BACK_Z);
    const w = widestRoute(full, st, main, 0, { x: 8.5, y: 0, z: 7.5 * side }, { x: 18.5, y: 0, z: 0 }, roi);
    expect(w).toBeGreaterThanOrEqual(4 - 1e-9);
  });

  it.each([-1, 1])("keeps the moat lane at least 4 m wide from its closed end to the arch (side %s)", (side) => {
    const st = standOf(full);
    const main = regionOf(st, full.spawns[0]!.pos);
    const roi = side < 0 ? box(-21.5, 0, -14, -15.5, 0, 1) : box(-21.5, 0, -1, -15.5, 0, 14);
    const w = widestRoute(full, st, main, MOAT_LEVEL, { x: -18.5, y: MOAT_LEVEL, z: 11.5 * side }, { x: -18.5, y: MOAT_LEVEL, z: 0 }, roi);
    expect(w).toBeGreaterThanOrEqual(4 - 1e-9);
  });

  it.each([-2, -1, 0, 1, 2])("keeps the east lane behind the tower 6 m wide at z = %s", (z) => {
    expect(width(spanAt(walkSpans(full, z), 18.5))).toBeGreaterThanOrEqual(6);
  });

  it("keeps the moat a lane: every row between the rockfalls leaves at least 4 m to walk through", () => {
    const narrow: string[] = [];
    // концы рва у келий (|z| > 14) завалены
    for (let z = -13.75; z <= 13.75; z += 0.5) {
      const w = Math.max(...walkSpans(full, z).filter((s) => s.from < -15.5).map(width));
      if (w < 4) narrow.push(`z = ${z}: ${w} m`);
    }
    expect(narrow).toStrictEqual([]);
  });

  it("has 6 orbs, 4 grass patches and 2 updrafts", () => {
    expect(full.pickups.filter((p) => p.kind === "orb")).toHaveLength(6);
    expect(full.volumes.filter((v) => v.kind === "grass")).toHaveLength(4);
    expect(full.volumes.filter((v) => v.kind === "updraft")).toHaveLength(2);
  });

  it("has no updrafts in the compact variant", () => {
    expect(compact.volumes.filter((v) => v.kind === "updraft")).toStrictEqual([]);
  });

  it("puts each updraft against the tower so it lifts onto the tower top", () => {
    const tower = full.colliders.filter((c) => c.tag === "tower").map((c) => c.box);
    expect(tower.length).toBeGreaterThan(0);
    const top = Math.max(...tower.map((t) => t.max.y));
    for (const v of full.volumes.filter((u) => u.kind === "updraft")) {
      const gap = Math.min(
        ...tower.map((t) => Math.hypot(Math.max(0, t.min.x - v.box.max.x, v.box.min.x - t.max.x), Math.max(0, t.min.z - v.box.max.z, v.box.min.z - t.max.z))),
      );
      expect(gap).toBeLessThan(0.5);
      // поток поднимает выше верха башни на рост мага и не стоит внутри неё
      expect(v.box.min.y + v.liftM!).toBeGreaterThan(top + PLAYER_HEIGHT);
      expect(tower.some((t) => boxesOverlap(t, v.box))).toBe(false);
    }
  });
});

describe("walkability analysis (controls on small arenas)", () => {
  const BOUNDS = box(-10, -3, -10, 10, 5, 10);
  /** Пол 20 × 20 м на y = 0 (если floor) и то, что добавит build. */
  function arena(build: (b: ReturnType<typeof createArenaBuilder>) => void, floor = true): ArenaData {
    const b = createArenaBuilder();
    if (floor) b.box(-10, -1, -10, 10, 0, 10);
    build(b);
    return b.finish("t", "full", BOUNDS);
  }
  const P = (x: number, z: number, y = 0): Vec3 => ({ x, y, z });

  it("splits regions at a wall and joins them through a gap the body fits", () => {
    const wall = (gap: number) =>
      arena((b) => {
        b.box(-0.25, 0, -10, 0.25, 3, -gap / 2);
        b.box(-0.25, 0, gap / 2, 0.25, 3, 10);
      });
    for (const [gap, joined] of [
      [0, false],
      [0.7, false],
      [1, true],
    ] as const) {
      const st = buildStand(wall(gap));
      expect(regionOf(st, P(-5, 0)) === regionOf(st, P(5, 0)), `gap ${gap} m`).toBe(joined);
    }
  });

  it("walks up a step of PLAYER_STEP but not up a 1 m ledge", () => {
    for (const [h, joined] of [
      [PLAYER_STEP, true],
      [1, false],
    ] as const) {
      const st = buildStand(arena((b) => b.box(2, 0, -10, 10, h, 10)));
      expect(regionOf(st, P(-5, 0)) === regionOf(st, P(5, 0, h)), `ledge ${h} m`).toBe(joined);
    }
  });

  it("flags a blind 1.5 m corridor, but not a through corridor, a 2.5 m alcove or a ledge over a void", () => {
    const corridor = (w: number, closed: boolean) =>
      arena((b) => {
        b.box(-w / 2 - 0.5, 0, 0, -w / 2, 3, 6);
        b.box(w / 2, 0, 0, w / 2 + 0.5, 3, 6);
        if (closed) b.box(-w / 2 - 0.5, 0, 6, w / 2 + 0.5, 3, 6.5);
      });
    const ends = (a: ArenaData) => {
      const st = buildStand(a);
      return deadEnds(st, regionOf(st, P(0, -5)));
    };
    expect(ends(corridor(1.5, true))).toHaveLength(1);
    expect(ends(corridor(1.5, false))).toStrictEqual([]);
    expect(ends(corridor(2.5, true))).toStrictEqual([]);
    // карниз 1,5 м между стеной и пропастью, глухой с одного конца, — не карман
    const ledge = arena((b) => {
      b.box(-10, -1, -10, 10, 0, 0);
      b.box(-10, -1, 0, 0, 0, 10);
      b.box(-1.5, 0, 0, -1, 3, 6);
      b.box(-1.5, 0, 6, 1, 3, 6.5);
    }, false);
    expect(ends(ledge)).toStrictEqual([]);
  });

  it("counts the edge of a drop as a wall when measuring route width", () => {
    // дорожка 3 м вдоль пропасти: со стеной с одной стороны и обрывом с другой — всё равно 3 м
    const a = arena((b) => {
      b.box(-10, -1, -10, 1.5, 0, 10);
      b.box(-2, 0, -8, -1.5, 3, 8);
    }, false);
    const st = buildStand(a);
    const w = widestRoute(a, st, regionOf(st, P(0, 0)), 0, P(0, -6), P(0, 6), box(-1.5, 0, -6, 1.5, 0, 6));
    expect(w).toBeGreaterThan(2.9);
    expect(w).toBeLessThanOrEqual(3 + 1e-9);
  });

  it("measures the widest route through a 3 m corridor as about 3 m", () => {
    const a = arena((b) => {
      b.box(-2, 0, -8, -1.5, 3, 8);
      b.box(1.5, 0, -8, 2, 3, 8);
    });
    const st = buildStand(a);
    const w = widestRoute(a, st, regionOf(st, P(0, 0)), 0, P(0, -6), P(0, 6), box(-1.5, 0, -6, 1.5, 0, 6));
    expect(w).toBeGreaterThan(2.9);
    expect(w).toBeLessThanOrEqual(3 + 1e-9);
  });
});
