import { describe, expect, it } from "vitest";
import { EYE_HEIGHT, PLAYER_HALF_W, PLAYER_HEIGHT, PLAYER_STEP, type AABB, type ArenaData, type Collider, type Vec3 } from "@doodlemagic/sim";
import { SEDLOVINA, buildSedlovina } from "./sedlovina";
import { box, boxInBox, boxesOverlap, canSee, floorBelow, pointInBox } from "./geom";

/**
 * Правила «Седловины» (Р13 плана фазы 7, design/round5-arena/06-producer.md): проходы ≥ 4 м; между полными
 * укрытиями 0 или ≥ 1,2 м; зазор у пустоты ≤ 3 или ≥ 5,5 м; между укрытием и кромкой 0 или ≥ 1,2 м; укрытие не
 * дальше 6 м; у каждой зоны ≥ 2 выходов; обзор по земле ≤ 40 м; спауны не видят друг друга, не видны с острова и
 * мостов, не ближе 8 м к кромке; коллайдеров ≤ 300. Помощники пешей сетки — как в gallery.test.ts.
 */

const full = buildSedlovina("full");
const compact = buildSedlovina("compact");
const variants: [string, ArenaData][] = [
  ["full", full],
  ["compact", compact],
];

const TIER = SEDLOVINA.tierY;
/** Уровни, по которым ходят: пол и ярус. */
const LEVELS = [0, TIER] as const;
/** Высшая точка прыжка (GDD 3): выше не запрыгнуть. */
const JUMP_APEX = 1.25;
/** Полное укрытие — от 2,2 м над тем, на чём стоит. */
const FULL_COVER_MIN = 2.2;
/** Щель между полными укрытиями и между укрытием и кромкой — либо 0, либо от 1,2 м. */
const MIN_SLIT = 1.2;
/** Зазор через пустоту: допрыгнуть (≤ 3 м) или явно нет (≥ 5,5 м). */
const GAP_JUMP = 3;
const GAP_NO = 5.5;
const MAX_GROUND_SIGHT = 40;
/** Линии через пустоту — вид, а не линия огня: дальше 50 м не летит ни один снаряд. */
const VOID_SIGHT_NOTE = 50;
const MAX_VOID_SIGHT = 60;
const COVER_REACH = 6;
const SPAWN_EDGE = 8;

/** Метки того, что не считается укрытием: по этому ходят, или это кромка. */
const NOT_COVER = new Set(["stairs", "bridge", "rune", "parapet", "tier"]);

const movers = (a: ArenaData): Collider[] => a.colliders.filter((c) => !c.noSight);
const eye = (p: Vec3): Vec3 => ({ x: p.x, y: p.y + EYE_HEIGHT, z: p.z });
const bodyAt = (p: Vec3) => box(p.x - PLAYER_HALF_W, p.y, p.z - PLAYER_HALF_W, p.x + PLAYER_HALF_W, p.y + PLAYER_HEIGHT, p.z + PLAYER_HALF_W);
const footprintsOverlap = (p: AABB, q: AABB) => p.min.x < q.max.x - 1e-9 && p.max.x > q.min.x + 1e-9 && p.min.z < q.max.z - 1e-9 && p.max.z > q.min.z + 1e-9;
const inFootprint = (b: AABB, x: number, z: number) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z;
const isLevel = (y: number) => LEVELS.some((l) => Math.abs(y - l) < 1e-6);
/** Расстояние по XZ от точки до следа бокса (0 — внутри). */
const xzDist = (b: AABB, x: number, z: number) => Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z));

/** Верх опоры под коллайдером: самый высокий верх других коллайдеров под его подошвой, или null. */
function supportTop(a: ArenaData, c: Collider): number | null {
  let best: number | null = null;
  for (const o of movers(a)) {
    if (o === c || !footprintsOverlap(o.box, c.box) || o.box.max.y > c.box.min.y + 1e-6) continue;
    if (best === null || o.box.max.y > best) best = o.box.max.y;
  }
  return best;
}

/** Полные укрытия уровня l: от подошвы мага (не выше ступени над l) до 2,2 м над l и выше. */
function blockersAt(a: ArenaData, l: number): Collider[] {
  return movers(a).filter((c) => !(c.tag && NOT_COVER.has(c.tag)) && c.box.min.y <= l + PLAYER_STEP && c.box.max.y >= l + FULL_COVER_MIN);
}

// ---------------------------------------------------------------- точки, где можно стоять

type Zone = "ground" | "island" | "cross" | "hang" | "gardenBridge" | "plateau" | "pomost";

/** Зона точки: остров, мосты креста, висячий и садовый мосты, плато (x < 0) и помосты (x > 0) на ярусе, остальное — земля. */
function zoneOf(p: Vec3): Zone {
  const w = SEDLOVINA.voids.well;
  const h = SEDLOVINA.islandHalf;
  if (Math.abs(p.x) <= h && Math.abs(p.z) <= h && p.y < 1) return "island";
  if (p.x > w.x0 && p.x < w.x1 && p.z > w.z0 && p.z < w.z1 && p.y < 1) return "cross";
  if (p.y > 1) {
    if (p.x > -29 - PLAYER_HALF_W && p.x < -25 + PLAYER_HALF_W && Math.abs(p.z) < 6) return "hang";
    return p.x < 0 ? "plateau" : "pomost";
  }
  if (p.x > 28 - PLAYER_HALF_W && Math.abs(p.z) < 6) return "gardenBridge";
  return "ground";
}

/**
 * Где можно стоять: центры подошвы на сетке step, на уровнях 0 и +2,8; подошва опирается на коллайдер с верхом
 * ровно на этом уровне, тело ни во что не входит, не в восходящем потоке.
 */
function standPoints(a: ArenaData, step: number): { p: Vec3; zone: Zone }[] {
  const ms = movers(a);
  const lifts = a.volumes.filter((v) => v.kind === "updraft").map((v) => v.box);
  const out: { p: Vec3; zone: Zone }[] = [];
  for (let x = a.bounds.min.x + step / 2; x < a.bounds.max.x; x += step) {
    for (let z = a.bounds.min.z + step / 2; z < a.bounds.max.z; z += step) {
      for (const y of LEVELS) {
        const p = { x, y, z };
        const body = bodyAt(p);
        if (!ms.some((c) => Math.abs(c.box.max.y - y) < 1e-6 && footprintsOverlap(c.box, body))) continue;
        if (ms.some((c) => boxesOverlap(body, c.box)) || lifts.some((v) => boxesOverlap(body, v))) continue;
        out.push({ p, zone: zoneOf(p) });
      }
    }
  }
  return out;
}

/** Пустоты по оси (зоны смерти): прямоугольники по XZ. */
const voidRects = (a: ArenaData) => a.volumes.filter((v) => v.kind === "kill").map((v) => v.box);

/** Проходит ли отрезок a–b по XZ над пустотой (мосты над ней не в счёт: это та же пустота с переходом). */
function overVoid(a: ArenaData, p: Vec3, q: Vec3): boolean {
  const rects = voidRects(a);
  const n = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.2);
  for (let i = 0; i <= n; i++) {
    const x = p.x + ((q.x - p.x) * i) / n;
    const z = p.z + ((q.z - p.z) * i) / n;
    if (rects.some((r) => x > r.min.x && x < r.max.x && z > r.min.z && z < r.max.z)) return true;
  }
  return false;
}

interface SightLine {
  d: number;
  from: Vec3;
  to: Vec3;
  zones: [Zone, Zone];
  overVoid: boolean;
}

const sightCache = new Map<ArenaData, SightLine[]>();
/** Все открытые линии длиннее 40 м между точками, где можно стоять (сетка 1,5 м, от глаз до глаз). */
function longSightLines(a: ArenaData): SightLine[] {
  let lines = sightCache.get(a);
  if (lines) return lines;
  const pts = standPoints(a, 1.5);
  // линии идут на высоте глаз 1,6…4,4 м: закрыть их может только то, что выше 1,6 м
  const solid = a.colliders.filter((c) => c.box.max.y >= EYE_HEIGHT);
  lines = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const p = pts[i]!;
      const q = pts[j]!;
      const d = Math.hypot(p.p.x - q.p.x, p.p.z - q.p.z);
      if (d <= MAX_GROUND_SIGHT || !canSee(solid, eye(p.p), eye(q.p))) continue;
      lines.push({ d, from: p.p, to: q.p, zones: [p.zone, q.zone], overVoid: overVoid(a, p.p, q.p) });
    }
  }
  sightCache.set(a, lines);
  return lines;
}

const fmt = (p: Vec3) => `(${p.x}, ${p.y}, ${p.z})`;
const lineText = (l: SightLine) => `${fmt(l.from)} → ${fmt(l.to)}: ${l.d.toFixed(1)} m`;

// ---------------------------------------------------------------- пешая сетка (как в gallery.test.ts)

/**
 * Где может стоять маг: сетка центров подошвы с шагом step; в каждой клетке — высоты пола, на которых тело
 * опирается на коллайдер и ни во что не входит (ни в коллайдеры, ни в поток, ни в зону смерти). Соседние состояния
 * связаны, если перепад пола не больше ступени: так моделируются лестницы. Прыжки и спрыгивания не считаются.
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

/** Сосед по сетке с перепадом пола не больше ступени (ближайший по высоте) или −1. */
function neighbor(st: Stand, s: number, di: number, dk: number, maxRise = PLAYER_STEP): number {
  const c = st.cell[s]!;
  const i = Math.floor(c / st.nz) + di;
  const k = (c % st.nz) + dk;
  if (i < 0 || k < 0 || i >= st.nx || k >= st.nz) return -1;
  const d = i * st.nz + k;
  let best = -1;
  for (let t = st.first[d]!; t < st.first[d + 1]!; t++) {
    const dl = st.level[t]! - st.level[s]!;
    if (Math.abs(dl) > PLAYER_STEP + EPS && !(dl < 0 && -dl <= maxRise + EPS)) continue;
    if (best < 0 || Math.abs(dl) < Math.abs(st.level[best]! - st.level[s]!)) best = t;
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
 * Тупики уже minWidth в пешей области region (как в gallery.test.ts): «узкое» состояние — ряд доступных центров через
 * него вдоль X или Z короче minWidth − 2·halfW и с обоих концов упирается в стену (обрыв карманом не считается).
 * Узкие куски с одной группой выходов — тупики.
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
 * Ширина самого широкого пешего пути от from до to на уровне y внутри прямоугольника roi (как в gallery.test.ts):
 * просвет точки — расстояние до ближайшей стены (коллайдер выше ступени, восходящий поток) или края, за которым не
 * встать (обрыв, пустота). Ответ — 2 × наименьший просвет на лучшем пути, оценка снизу.
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
    for (const b of obst) d = Math.min(d, xzDist(b, x, z));
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

/** Длина стены Земли (GDD 4.4): проём уже неё запечатывается целиком. */
const EARTH_WALL = 4;

/**
 * Выходы зоны: состояния главной области внутри прямоугольника rect на уровне y (±0,3 м), у которых есть сосед вне
 * rect — шагом (перепад ≤ ступени) или спрыгиванием до 3 м (не в пустоту). Выходы, смежные по 8 соседям вдоль
 * границы, — один проём. Проём шире стены Земли с телом (центры дальше 4 м друг от друга) одной стеной не закрыть —
 * он считается за два выхода. Возвращает число выходов и число состояний зоны (контроль, что зона не пустая).
 */
function zoneExits(st: Stand, region: number, rect: AABB, y: number): { exits: number; states: number } {
  const inRect = (s: number) => {
    const [x, z] = cellXZ(st, st.cell[s]!);
    return x >= rect.min.x && x <= rect.max.x && z >= rect.min.z && z <= rect.max.z && Math.abs(st.level[s]! - y) <= 0.3;
  };
  const exit = new Set<number>();
  let states = 0;
  for (let s = 0; s < st.level.length; s++) {
    if (ufFind(st.parent, s) !== region || !inRect(s)) continue;
    states++;
    for (const [di, dk] of DIRS4) {
      const t = neighbor(st, s, di, dk, 3);
      if (t >= 0 && !inRect(t)) exit.add(s);
    }
  }
  const p = new Int32Array(st.level.length);
  for (const s of exit) p[s] = s;
  for (const s of exit) {
    for (const [di, dk] of DIRS8) {
      const t = neighbor(st, s, di, dk);
      if (t >= 0 && exit.has(t)) ufUnion(p, s, t);
    }
  }
  const groups = new Map<number, (readonly [number, number])[]>();
  for (const s of exit) {
    const r = ufFind(p, s);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(cellXZ(st, st.cell[s]!));
  }
  let exits = 0;
  for (const pts of groups.values()) {
    const span = Math.hypot(Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1])));
    exits += span > EARTH_WALL ? 2 : 1;
  }
  return { exits, states };
}

const standCache = new Map<ArenaData, Stand>();
function standOf(a: ArenaData): Stand {
  let st = standCache.get(a);
  if (!st) standCache.set(a, (st = buildStand(a)));
  return st;
}

/** Места, которые обязаны быть в одной пешей области со спаунами (на своих двоих, лестницы — шагами). */
function landmarks(a: ArenaData): [string, Vec3][] {
  const out: [string, Vec3][] = a.spawns.map((s, i) => [`spawn ${i}`, s.pos]);
  for (const side of [-1, 1]) {
    const h = side < 0 ? "A" : "B";
    const P = (x: number, z: number, y = 0): Vec3 => ({ x, y, z: z * side });
    out.push(
      [`west courtyard ${h}`, P(-16, -14)],
      [`central courtyard ${h}`, P(0, -9.5)],
      [`east courtyard ${h}`, P(20, -15.5)],
      [`behind the hall ${h}`, P(0, -18.5)],
      [`bridge ${h}`, P(0, -5)],
    );
    if (a.variant === "full") {
      out.push([`plateau ${h}`, P(-27, -9, TIER)], [`pomost ${h}`, P(29, -13, TIER)], [`garden ${h}`, P(24, -8)]);
    }
  }
  out.push(["rune island", { x: 0, y: 0, z: 1 }], ["west isthmus", { x: -16, y: 0, z: 0 }], ["east isthmus", { x: 16, y: 0, z: 0 }]);
  out.push(["west bridge", { x: -5, y: 0, z: 0 }], ["east bridge", { x: 5, y: 0, z: 0 }]);
  if (a.variant === "full") out.push(["hanging bridge", { x: -27, y: TIER, z: 0 }], ["garden bridge", { x: 30, y: 0, z: 0 }]);
  return out;
}

// ---------------------------------------------------------------- тесты

describe.each(variants)("sedlovina (%s)", (_name, a) => {
  it("fits its stated bounds; only the two landmarks beyond the rifts are drawn outside", () => {
    for (const c of a.colliders) expect(boxInBox(a.bounds, c.box), JSON.stringify(c.box)).toBe(true);
    for (const v of a.volumes) expect(boxInBox(a.bounds, v.box)).toBe(true);
    for (const p of [...a.spawns.map((s) => s.pos), ...a.pickups.map((p) => p.pos)]) expect(pointInBox(a.bounds, p)).toBe(true);
    const outside = a.render.filter((r) => !boxInBox(a.bounds, r.box));
    // ступа и башня — за краем мира, за разломами, по 4 бокса; коллизии у них нет
    expect(outside).toHaveLength(8);
    for (const r of outside) {
      expect(Math.abs(r.box.min.x + r.box.max.x) / 2).toBeGreaterThan(SEDLOVINA.full.max.x);
      expect(Math.abs(r.box.min.z + r.box.max.z) / 2).toBeLessThan(6);
      expect(a.colliders.some((c) => boxesOverlap(c.box, r.box))).toBe(false);
    }
  });

  it("owns its bounds instead of sharing the SEDLOVINA constant", () => {
    expect(a.bounds).toStrictEqual(a.variant === "full" ? SEDLOVINA.full : SEDLOVINA.compact);
    expect(a.bounds).not.toBe(SEDLOVINA.full);
    expect(a.bounds).not.toBe(SEDLOVINA.compact);
  });

  it(`has ${a.variant === "full" ? 12 : 8} spawns standing on a floor or a tier and clear of every collider`, () => {
    expect(a.spawns).toHaveLength(a.variant === "full" ? 12 : 8);
    for (const s of a.spawns) {
      expect(a.colliders.filter((c) => boxesOverlap(bodyAt(s.pos), c.box))).toStrictEqual([]);
      const floor = floorBelow(a.colliders, { ...s.pos, y: s.pos.y + 0.5 });
      expect(floor).not.toBeNull();
      expect(Math.abs(floor! - s.pos.y)).toBeLessThan(1e-6);
      expect(isLevel(s.pos.y)).toBe(true);
    }
  });

  it("is mirror-symmetric about z = 0", () => {
    const key = (b: AABB) => [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => v.toFixed(6)).join(",");
    const mirror = (b: AABB) => box(b.min.x, b.min.y, -b.max.z, b.max.x, b.max.y, -b.min.z);
    const set = new Set(a.colliders.map((c) => key(c.box)));
    expect(a.colliders.filter((c) => !set.has(key(mirror(c.box)))).map((c) => JSON.stringify(c.box))).toStrictEqual([]);
    const sp = new Set(a.spawns.map((s) => `${s.pos.x},${s.pos.y},${s.pos.z}`));
    for (const s of a.spawns) expect(sp.has(`${s.pos.x},${s.pos.y},${0 - s.pos.z}`)).toBe(true);
  });

  it("has no direct line of sight between any two spawns", () => {
    for (let i = 0; i < a.spawns.length; i++) {
      for (let j = i + 1; j < a.spawns.length; j++) {
        expect(canSee(a.colliders, eye(a.spawns[i]!.pos), eye(a.spawns[j]!.pos)), `spawn ${i} sees spawn ${j}`).toBe(false);
      }
    }
  });

  it("hides every spawn from the rune island and the four bridges of the cross", () => {
    const centre = standPoints(a, 0.5).filter((p) => p.zone === "island" || p.zone === "cross");
    expect(centre.length).toBeGreaterThan(200);
    const seen: string[] = [];
    for (const [k, s] of a.spawns.entries()) {
      const from = centre.find((p) => canSee(a.colliders, eye(p.p), eye(s.pos)));
      if (from) seen.push(`spawn ${k} ${fmt(s.pos)} from ${fmt(from.p)}`);
    }
    expect(seen).toStrictEqual([]);
  });

  it(`keeps every spawn at least ${SPAWN_EDGE} m from a void edge and from an unfenced edge of the world`, () => {
    const near: string[] = [];
    for (const s of a.spawns) {
      for (const v of voidRects(a)) {
        const d = xzDist(v, s.pos.x, s.pos.z);
        if (d < SPAWN_EDGE) near.push(`${fmt(s.pos)}: void ${d.toFixed(2)} m`);
      }
      // край мира у плато и сада — за парапетом 1,4 м: луч на метр над подошвой в край упирается в него
      for (const ex of [a.bounds.min.x, a.bounds.max.x]) {
        for (let z = a.bounds.min.z; z <= a.bounds.max.z; z += 0.25) {
          const edge = { x: ex, y: s.pos.y + 1, z };
          if (Math.hypot(edge.x - s.pos.x, edge.z - s.pos.z) >= SPAWN_EDGE) continue;
          if (canSee(a.colliders, { ...s.pos, y: s.pos.y + 1 }, edge)) near.push(`${fmt(s.pos)}: open world edge at ${fmt(edge)}`);
        }
      }
    }
    expect(near).toStrictEqual([]);
  });

  it("keeps the rune at least 21 m (about 3.3 s of running) from every spawn", () => {
    const rune = a.pickups.find((p) => p.kind === "rune")!.pos;
    for (const s of a.spawns) expect(Math.hypot(s.pos.x - rune.x, s.pos.z - rune.z), fmt(s.pos)).toBeGreaterThanOrEqual(21);
  });

  it("puts every hole in the floor inside a kill volume below −3 m", () => {
    const kill = voidRects(a);
    for (const v of a.volumes.filter((u) => u.kind === "kill")) expect(v.box.max.y).toBeLessThanOrEqual(-3);
    const ms = movers(a);
    let holes = 0;
    const missed: string[] = [];
    const step = 0.25;
    for (let x = a.bounds.min.x + step / 2; x < a.bounds.max.x; x += step) {
      for (let z = a.bounds.min.z + step / 2; z < a.bounds.max.z; z += step) {
        if (ms.some((c) => inFootprint(c.box, x, z) && c.box.max.y >= -1.5)) continue;
        holes++;
        if (!kill.some((v) => inFootprint(v, x, z))) missed.push(`(${x}, ${z})`);
      }
    }
    expect(holes).toBeGreaterThan(1000);
    expect(missed.slice(0, 10)).toStrictEqual([]);
  });

  it("has a 6 × 6 rune island with bridges at least 4 m wide, open to the void on both sides", () => {
    const rune = a.colliders.filter((c) => c.tag === "rune");
    expect(rune).toHaveLength(1);
    const r = rune[0]!.box;
    expect([r.max.x - r.min.x, r.max.z - r.min.z, r.max.y]).toStrictEqual([6, 6, 0]);
    expect(a.pickups.filter((p) => p.kind === "rune").map((p) => p.pos)).toStrictEqual([{ x: 0, y: 0.5, z: 0 }]);
    const bridges = a.colliders.filter((c) => c.tag === "bridge");
    expect(bridges).toHaveLength(a.variant === "full" ? 6 : 4);
    const ms = movers(a);
    for (const { box: b } of bridges) {
      const alongZ = b.max.z - b.min.z > b.max.x - b.min.x || (b.min.x === -2 && b.max.x === 2);
      const width = alongZ ? b.max.x - b.min.x : b.max.z - b.min.z;
      expect(width, JSON.stringify(b)).toBeGreaterThanOrEqual(4);
      const mid = { x: (b.min.x + b.max.x) / 2, y: b.max.y + 1, z: (b.min.z + b.max.z) / 2 };
      // по бокам моста — пустота (или край мира у садового моста)
      const sides = alongZ
        ? [{ ...mid, x: b.min.x - 0.25 }, { ...mid, x: b.max.x + 0.25 }]
        : [{ ...mid, z: b.min.z - 0.25 }, { ...mid, z: b.max.z + 0.25 }];
      for (const p of sides) expect(floorBelow(ms, p, 10), `${JSON.stringify(b)} beside ${fmt(p)}`).toBeNull();
      // оба конца упираются в то, по чему ходят, на том же уровне
      const ends = alongZ ? [{ ...mid, z: b.min.z - 0.25 }, { ...mid, z: b.max.z + 0.25 }] : [{ ...mid, x: b.min.x - 0.25 }, { ...mid, x: b.max.x + 0.25 }];
      for (const p of ends) expect(floorBelow(ms, p, 1.5), `${JSON.stringify(b)} end ${fmt(p)}`).toBe(b.max.y);
    }
  });

  it("uses full cover from 2.2 m, parapets of 1.4 m (seen over, not hopped onto) and nothing in between", () => {
    const bad: string[] = [];
    let measured = 0;
    for (const c of movers(a)) {
      if (c.tag === "stairs") continue;
      const s = supportTop(a, c);
      if (s === null || !isLevel(s) || Math.abs(c.box.min.y - s) > 1e-6) continue;
      measured++;
      const h = c.box.max.y - s;
      if (c.tag === "parapet") {
        if (!(h > JUMP_APEX && h < EYE_HEIGHT)) bad.push(`parapet ${JSON.stringify(c.box)}: ${h.toFixed(2)} m`);
      } else if (h > PLAYER_STEP && h < FULL_COVER_MIN) bad.push(`${JSON.stringify(c.box)}: ${h.toFixed(2)} m`);
    }
    expect(measured).toBeGreaterThan(30);
    expect(a.colliders.filter((c) => c.tag === "parapet").length).toBeGreaterThanOrEqual(4);
    expect(bad).toStrictEqual([]);
  });

  it("leaves no slit narrower than 1.2 m between full-cover blockers", () => {
    const slits: string[] = [];
    for (const l of LEVELS) {
      const blockers = blockersAt(a, l);
      for (let i = 0; i < blockers.length; i++) {
        for (let j = i + 1; j < blockers.length; j++) {
          const p = blockers[i]!.box;
          const q = blockers[j]!.box;
          if (Math.min(p.max.y, q.max.y) - Math.max(p.min.y, q.min.y, l) < 1) continue;
          const dx = Math.max(0, p.min.x - q.max.x, q.min.x - p.max.x);
          const dz = Math.max(0, p.min.z - q.max.z, q.min.z - p.max.z);
          const gap = Math.hypot(dx, dz);
          if (gap <= 1e-6 || gap >= MIN_SLIT - 1e-6) continue;
          const mid = (lo0: number, hi0: number, lo1: number, hi1: number) =>
            hi0 <= lo1 ? (hi0 + lo1) / 2 : hi1 <= lo0 ? (hi1 + lo0) / 2 : (Math.max(lo0, lo1) + Math.min(hi0, hi1)) / 2;
          const m = { x: mid(p.min.x, p.max.x, q.min.x, q.max.x), y: l + 1, z: mid(p.min.z, p.max.z, q.min.z, q.max.z) };
          if (movers(a).some((c) => c.box !== p && c.box !== q && pointInBox(c.box, m))) continue;
          slits.push(`y ${l}: ${JSON.stringify(p)} ↔ ${JSON.stringify(q)}: ${gap.toFixed(2)} m`);
        }
      }
    }
    expect(blockersAt(a, 0).length).toBeGreaterThan(25);
    expect(slits).toStrictEqual([]);
  });

  it("keeps every full-cover blocker flush with a void edge or at least 1.2 m from it", () => {
    const ms = movers(a);
    const bad: string[] = [];
    let probes = 0;
    for (const l of LEVELS) {
      // перед гранью укрытия: что-то, на чём стоят или во что упираются (верх выше l − 3 м); иначе — пустота
      const covered = (x: number, z: number) => ms.some((c) => c.box.max.y > l - 3 && c.box.min.y < l + PLAYER_HEIGHT && x > c.box.min.x - 1e-9 && x < c.box.max.x + 1e-9 && z > c.box.min.z - 1e-9 && z < c.box.max.z + 1e-9);
      for (const c of blockersAt(a, l)) {
        const b = c.box;
        const faces: { u0: number; u1: number; at: (u: number, d: number) => [number, number] }[] = [
          { u0: b.min.z, u1: b.max.z, at: (u, d) => [b.min.x - d, u] },
          { u0: b.min.z, u1: b.max.z, at: (u, d) => [b.max.x + d, u] },
          { u0: b.min.x, u1: b.max.x, at: (u, d) => [u, b.min.z - d] },
          { u0: b.min.x, u1: b.max.x, at: (u, d) => [u, b.max.z + d] },
        ];
        for (const f of faces) {
          for (let u = f.u0 + 0.05; u < f.u1 - 0.04; u += 0.25) {
            // первая пустота перед гранью: шаг 1 см до 1,2 м
            for (let k = 1; k <= 120; k++) {
              const [x, z] = f.at(u, k * 0.01);
              if (covered(x, z)) continue;
              probes++;
              if (k > 1 && k < 119) bad.push(`y ${l}: ${JSON.stringify(b)} at (${x.toFixed(2)}, ${z.toFixed(2)}): ${(k * 0.01).toFixed(2)} m`);
              break;
            }
          }
        }
      }
    }
    expect(probes).toBeGreaterThan(20);
    expect(bad.slice(0, 10)).toStrictEqual([]);
  });

  it("leaves every gap across the void either jumpable (≤ 3 m) or clearly not (≥ 5.5 m)", () => {
    const ms = movers(a);
    /** Верх самого высокого коллайдера над точкой или null. */
    const topAt = (x: number, z: number): Collider | null => {
      let best: Collider | null = null;
      for (const c of ms) if (x > c.box.min.x && x < c.box.max.x && z > c.box.min.z && z < c.box.max.z && c.box.max.y > -3 && (!best || c.box.max.y > best.box.max.y)) best = c;
      return best;
    };
    const walk = (c: Collider | null) => c !== null && isLevel(c.box.max.y);
    const gaps = new Map<string, number>();
    const bad: string[] = [];
    const step = 0.05;
    for (const axis of ["x", "z"] as const) {
      const other = axis === "x" ? "z" : "x";
      const lo = a.bounds.min[axis];
      const hi = a.bounds.max[axis];
      for (let v = a.bounds.min[other] + 0.125; v < a.bounds.max[other]; v += 0.25) {
        const at = (u: number) => (axis === "x" ? topAt(u, v) : topAt(v, u));
        let prev: Collider | null = at(lo + step / 2);
        let start: number | null = null;
        let left: Collider | null = null;
        for (let u = lo + step / 2; u < hi; u += step) {
          const c = at(u);
          if (c === null && prev !== null) {
            start = u;
            left = prev;
          }
          if (c !== null && prev === null && start !== null && left !== null) {
            if (walk(left) && walk(c)) {
              const g = Math.round((c.box.min[axis] - left.box.max[axis]) * 100) / 100;
              gaps.set(g.toFixed(2), (gaps.get(g.toFixed(2)) ?? 0) + 1);
              if (g > GAP_JUMP + 1e-6 && g < GAP_NO - 1e-6) bad.push(`${axis} at ${other} = ${v}: ${g} m`);
            }
            start = null;
          }
          prev = c;
        }
      }
    }
    // положительный контроль: зазоры у пустот найдены — колодец 5,5 м, а в полном варианте ещё висячий мост 3 м,
    // садовый мост 6 м и разломы 12 м
    expect(gaps.has("5.50")).toBe(true);
    if (a.variant === "full") expect(["3.00", "6.00", "12.00"].every((g) => gaps.has(g))).toBe(true);
    expect(bad.slice(0, 10)).toStrictEqual([]);
  });

  it("stays within the collider budget of 300 boxes", () => {
    expect(a.colliders.length).toBeLessThanOrEqual(300);
  });

  it("is plain data", () => {
    expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
  });

  it(`keeps ground-level sight lines within ${MAX_GROUND_SIGHT} m; across the voids within ${MAX_VOID_SIGHT} m`, () => {
    const lines = longSightLines(a);
    const ground = lines.filter((l) => l.zones.every((z) => z !== "plateau" && z !== "pomost" && z !== "hang"));
    // по земле (оба конца на уровне 0, линия не над пустотой) — не длиннее 40 м
    expect(ground.filter((l) => !l.overVoid).map(lineText).slice(0, 10)).toStrictEqual([]);
    // через пустоту — вид, а не линия огня; дальше 50 м — только в сад и на садовый мост (05, «Проверка»)
    const across = ground.filter((l) => l.overVoid);
    expect(across.filter((l) => l.d > MAX_VOID_SIGHT).map(lineText).slice(0, 10)).toStrictEqual([]);
    const beyond = across.filter((l) => l.d > VOID_SIGHT_NOTE);
    expect(beyond.filter((l) => Math.max(l.from.x, l.to.x) < 22).map(lineText).slice(0, 10)).toStrictEqual([]);
    if (a.variant === "compact") expect(beyond).toStrictEqual([]);
  });

  it(`keeps full cover within ${COVER_REACH} m of every point of the courtyards, isthmuses, garden and plateaus`, () => {
    const far: string[] = [];
    let n = 0;
    for (const { p, zone } of standPoints(a, 0.5)) {
      if (zone !== "ground" && zone !== "plateau") continue;
      n++;
      const d = Math.min(...blockersAt(a, p.y).map((c) => xzDist(c.box, p.x, p.z)));
      if (d > COVER_REACH) far.push(`${fmt(p)}: ${d.toFixed(2)} m`);
    }
    expect(n).toBeGreaterThan(3000);
    expect(far.slice(0, 10)).toStrictEqual([]);
  });

  it("joins spawns, courtyards, isthmuses, bridges, island and tiers into one walkable region", () => {
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
    let states = 0;
    for (let s = 0; s < st.level.length; s++) if (ufFind(st.parent, s) === main) states++;
    expect(states).toBeGreaterThan(100000);
    expect(deadEnds(st, main)).toStrictEqual([]);
  });

  it.each([-1, 1])("gives every zone of half %s at least two ways out", (side) => {
    const st = standOf(a);
    const main = regionOf(st, a.spawns[0]!.pos);
    const R = (x0: number, z0: number, x1: number, z1: number) => box(x0, 0, side * z0, x1, 0, side * z1);
    const zones: [string, AABB, number][] = [
      ["corner with spawn 2 (west)", R(-19, -22, -12, -16), 0],
      ["strip behind the hall", R(-10, -22, 10, -17.5), 0],
      ["corner with spawn 5 (east)", R(12, -22, 22, -16), 0],
      ["west courtyard", R(-22, -16, -8, -6.8), 0],
      ["central courtyard", R(-8, -11.5, 8, -7.8), 0],
      ["east courtyard", R(8, -16, 22, -6.8), 0],
    ];
    if (side < 0) zones.push(["west isthmus", R(-22, -5.8, -7.5, 5.8), 0], ["east isthmus", R(7.5, -5.8, 22, 5.8), 0], ["rune island and its cross", R(-7.5, -7.5, 7.5, 7.5), 0]);
    if (a.variant === "full") {
      zones.push(
        ["plateau", R(-32, -22, -22, -6), TIER],
        ["pomost", R(25, -16, 32, -10), TIER],
        ["garden by the rift", R(22, -10, 32, -6), 0],
        ["garden corner with spawn 6", R(24, -22, 27.7, -16), 0],
      );
    }
    const few = zones
      .map(([name, rect, y]) => [name, zoneExits(st, main, rect, y)] as const)
      .filter(([, r]) => r.states < 100 || r.exits < 2)
      .map(([name, r]) => `${name}: ${r.exits} exits, ${r.states} states`);
    expect(few).toStrictEqual([]);
  });

  it.each([-1, 1])("links the zones of half %s with walking routes at least 4 m wide", (side) => {
    const st = standOf(a);
    const main = regionOf(st, a.spawns[0]!.pos);
    const P = (x: number, z: number): Vec3 => ({ x, y: 0, z: z * side });
    const roi = (x0: number, z0: number, x1: number, z1: number) => box(x0, 0, Math.min(z0 * side, z1 * side), x1, 0, Math.max(z0 * side, z1 * side));
    const links: [string, Vec3, Vec3, AABB][] = [
      ["west courtyard ↔ central courtyard", P(-16, -14), P(0, -9.5), roi(-22, -22, 8, -6.8)],
      ["central courtyard ↔ east courtyard", P(0, -9.5), P(20, -15.5), roi(-8, -22, 22, -6.8)],
      ["west courtyard ↔ west isthmus", P(-11, -10), P(-16, 0), roi(-22, -16, -7.5, 1)],
      ["east courtyard ↔ east isthmus", P(20, -15.5), P(16, 0), roi(7.5, -16, 22, 1)],
      ["central courtyard ↔ bridge to the island", P(0, -9.5), P(0, -1), roi(-8, -12, 8, 0)],
      ["west isthmus ↔ island", P(-16, 0), P(0, 0), roi(-22, -5.8, 0, 5.8)],
      ["east isthmus ↔ island", P(16, 0), P(0, 0), roi(0, -5.8, 22, 5.8)],
      ["behind the hall ↔ central courtyard", P(-7, -19.75), P(0, -9.5), roi(-10, -22, 10, -7.8)],
    ];
    if (a.variant === "full") links.push(["east courtyard ↔ garden", P(20, -15.5), P(24, -8), roi(8, -22, 32, -6)]);
    const narrow = links
      .map(([name, from, to, r]) => [name, widestRoute(a, st, main, 0, from, to, r)] as const)
      .filter(([, w]) => w < 4 - 1e-9)
      .map(([name, w]) => `${name}: ${w.toFixed(2)} m`);
    expect(narrow).toStrictEqual([]);
  });
});

describe("sedlovina layout", () => {
  it("is 64 × 48 m, the compact variant 51 × 48 m with walls at x = ±22 off the axis", () => {
    const size = (a: ArenaData) => [a.bounds.max.x - a.bounds.min.x, a.bounds.max.z - a.bounds.min.z];
    expect(size(full)).toStrictEqual([64, 48]);
    expect(size(compact)).toStrictEqual([51, 48]);
    // компакт: со двора на запад и восток при |z| ≥ 6 — стена на x = ±22, на оси — пустота до стены x = ±25
    for (const z of [-15, -6.5, 6.5, 15]) {
      for (const sx of [-1, 1]) {
        expect(canSee(compact.colliders, { x: 18 * sx, y: 1.6, z }, { x: 23 * sx, y: 1.6, z }), `z ${z}`).toBe(false);
      }
    }
    for (const sx of [-1, 1]) {
      expect(floorBelow(compact.colliders, { x: 23.5 * sx, y: 1, z: 0 }, 20)).toBeNull();
      expect(canSee(compact.colliders, { x: 21 * sx, y: 1.6, z: 3 }, { x: 24.9 * sx, y: 1.6, z: 3 })).toBe(true);
      expect(canSee(compact.colliders, { x: 21 * sx, y: 1.6, z: 3 }, { x: 25.2 * sx, y: 1.6, z: 3 })).toBe(false);
    }
  });

  it("has 3 voids in both variants: the well and the two rifts (in the compact — 3 m slits by the isthmuses)", () => {
    for (const a of [full, compact]) expect(a.volumes.filter((v) => v.kind === "kill")).toHaveLength(3);
    const slits = compact.volumes.filter((v) => v.kind === "kill" && Math.abs(v.box.min.x + v.box.max.x) > 1);
    expect(slits.map((v) => Math.round(v.box.max.x - v.box.min.x - 0.5))).toStrictEqual([3, 3]);
  });

  it("has 6 orbs, 4 grass patches and 4 updrafts; the compact keeps 4 orbs, 2 grass patches and no updrafts", () => {
    const count = (a: ArenaData) => [
      a.pickups.filter((p) => p.kind === "orb").length,
      a.volumes.filter((v) => v.kind === "grass").length,
      a.volumes.filter((v) => v.kind === "updraft").length,
    ];
    expect(count(full)).toStrictEqual([6, 4, 4]);
    expect(count(compact)).toStrictEqual([4, 2, 0]);
  });

  it("puts each updraft against a +2.8 tier so it lifts onto it", () => {
    const tiers = full.colliders.filter((c) => c.tag === "tier").map((c) => c.box);
    expect(tiers).toHaveLength(4);
    for (const v of full.volumes.filter((u) => u.kind === "updraft")) {
      expect(Math.min(...tiers.map((t) => xzDist(t, (v.box.min.x + v.box.max.x) / 2, (v.box.min.z + v.box.max.z) / 2))) - 1).toBeLessThan(0.5);
      expect(v.box.min.y + v.liftM!).toBeGreaterThan(TIER + PLAYER_HEIGHT);
      expect(tiers.some((t) => boxesOverlap(t, v.box))).toBe(false);
    }
  });

  it("raises the plateaus, pomosts and the hanging bridge to +2.8 m: Water's grab pulls from there, Tsunami (2.5 m) does not reach", () => {
    for (const c of full.colliders.filter((c) => c.tag === "tier" || (c.tag === "bridge" && c.box.max.y > 1))) expect(c.box.max.y).toBe(TIER);
    expect(full.colliders.filter((c) => c.tag === "bridge" && c.box.max.y === TIER)).toHaveLength(1);
  });

  it("builds stairs onto the tiers 4 m wide with a free head above every step", () => {
    const steps = full.colliders.filter((c) => c.tag === "stairs");
    expect(steps).toHaveLength(4 * 6);
    for (const s of steps) {
      expect(Math.min(s.box.max.x - s.box.min.x, s.box.max.z - s.box.min.z) + 1e-9).toBeGreaterThanOrEqual(0.66);
      expect(Math.max(s.box.max.x - s.box.min.x, s.box.max.z - s.box.min.z)).toBeGreaterThanOrEqual(4);
      const head = box(s.box.min.x, s.box.max.y, s.box.min.z, s.box.max.x, s.box.max.y + PLAYER_HEIGHT, s.box.max.z);
      expect(full.colliders.filter((c) => c !== s && boxesOverlap(head, c.box)).map((c) => JSON.stringify(c.box))).toStrictEqual([]);
    }
  });

  it("stands the belfry on the island: four 1 × 1 posts at its corners, roof at +7 above the corpus and a spire to +12 without collision", () => {
    for (const a of [full, compact]) {
      const posts = a.colliders.filter((c) => c.tag === "belfry" && c.box.min.y === 0);
      expect(posts).toHaveLength(4);
      for (const p of posts) {
        expect([p.box.max.x - p.box.min.x, p.box.max.z - p.box.min.z, p.box.max.y]).toStrictEqual([1, 1, SEDLOVINA.belfryRoofY]);
        expect([Math.abs(p.box.min.x + p.box.max.x) / 2, Math.abs(p.box.min.z + p.box.max.z) / 2]).toStrictEqual([2.5, 2.5]);
      }
      const roof = a.colliders.filter((c) => c.tag === "belfry" && c.box.min.y === SEDLOVINA.belfryRoofY);
      expect(roof).toHaveLength(1);
      // кровля и колокол выше 4,8 м: Ураган поднимает мага на 3 м (тело до 4,8)
      expect(a.colliders.filter((c) => c.tag === "bell").every((c) => c.box.min.y >= 4.8)).toBe(true);
      const top = Math.max(...a.render.filter((r) => Math.abs(r.box.min.x + r.box.max.x) < 1e-9).map((r) => r.box.max.y));
      expect(top).toBe(SEDLOVINA.spireY);
      expect(a.colliders.some((c) => c.box.max.y > SEDLOVINA.belfryRoofY + 0.6 + 1e-9)).toBe(false);
      // ориентир выше корпуса: самый высокий корпус — 7 м
      expect(Math.max(...a.colliders.filter((c) => c.tag === "shell").map((c) => c.box.max.y))).toBeLessThan(SEDLOVINA.spireY);
    }
  });

  it("guards the courtyard edge of the well with a 1.4 m parapet with a 4 m opening for each bridge", () => {
    for (const side of [-1, 1]) {
      const z = side * (SEDLOVINA.voids.well.z1 + 0.15);
      const spans = [];
      for (let x = -7.5 + 0.05; x < 7.5; x += 0.1) {
        const blocked = full.colliders.some((c) => c.tag === "parapet" && pointInBox(c.box, { x, y: 1, z }));
        spans.push(blocked ? 1 : 0);
      }
      const open = spans.filter((v) => v === 0).length * 0.1;
      expect(open).toBeCloseTo(4, 6);
    }
  });

  it("measures the views from the +2.8 tiers: over the 2.6–4 m cover they reach further than 40 m, as 05 intends (height in the corners)", () => {
    const lines = longSightLines(full).filter((l) => l.zones.some((z) => z === "plateau" || z === "pomost" || z === "hang"));
    const solid = lines.filter((l) => !l.overVoid);
    const across = lines.filter((l) => l.overVoid);
    const max = (ls: SightLine[]) => Math.max(...ls.map((l) => l.d));
    // замер блокаута (сетка 1,5 м): над двором — до 62,4 м (плато — помост своей половины), через пустоту — до 71,3 м
    expect(solid.length).toBeGreaterThan(0);
    expect(max(solid)).toBeLessThan(63);
    expect(max(across)).toBeLessThan(72);
  });

  it("lets the tiers and the side bridges of the other half see no spawn from closer than 20 m", () => {
    const high = standPoints(full, 0.5).filter((p) => ["plateau", "pomost", "hang", "gardenBridge"].includes(p.zone));
    expect(high.length).toBeGreaterThan(500);
    const close: string[] = [];
    for (const s of full.spawns) {
      for (const { p } of high) {
        if (Math.sign(p.z) === Math.sign(s.pos.z)) continue;
        const d = Math.hypot(p.x - s.pos.x, p.z - s.pos.z);
        if (d < 20 && canSee(full.colliders, eye(p), eye(s.pos))) close.push(`${fmt(s.pos)} from ${fmt(p)}: ${d.toFixed(1)} m`);
      }
    }
    expect(close).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------- декор (Р5)

/** Чернила декора: знамёна, окна фонарей, венцы (кровля) и цоколи с линиями (тушь). */
const DECOR = new Set(["clothA", "clothB", "lantern", "roof", "edge"]);
/** Ниже этой высоты над ярусом декор — на уровне тела: только вплотную к своей постройке. */
const HEAD_CLEAR = 2.2;

describe.each(variants)("sedlovina decor (%s)", (_name, a) => {
  it("adds no colliders: banners, lantern windows, crowns and plinths are drawing only", () => {
    expect(a.colliders).toHaveLength(a.variant === "full" ? 133 : 75);
  });

  it("hangs 4 banners per half on the 7 m corpus: 0.9 × 2.8 m, ≤ 5 cm off the wall, hem ≥ 1.8 m; A indigo, B ochre", () => {
    for (const [material, side] of [
      ["clothA", -1],
      ["clothB", 1],
    ] as const) {
      const cloth = a.render.filter((r) => r.material === material).map((r) => r.box);
      expect(cloth).toHaveLength(4);
      for (const c of cloth) {
        expect(c.max.x - c.min.x).toBeCloseTo(0.9, 6);
        expect(c.max.y - c.min.y).toBeCloseTo(2.8, 6);
        expect(c.min.y).toBeGreaterThanOrEqual(1.8);
        expect(Math.sign(c.min.z + c.max.z)).toBe(side);
        const gap = side < 0 ? c.min.z + 22 : 22 - c.max.z;
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(0.05);
        const wall = a.colliders.filter(
          (k) => k.tag === "shell" && k.box.max.y >= 7 - 1e-9 && k.box.min.x <= c.min.x && k.box.max.x >= c.max.x && Math.abs(Math.abs(side < 0 ? k.box.max.z : k.box.min.z) - 22) < 1e-9,
        );
        expect(wall).toHaveLength(1);
        expect(c.max.y).toBeLessThanOrEqual(wall[0]!.box.max.y);
        expect(a.colliders.some((k) => boxesOverlap(k.box, c))).toBe(false);
      }
    }
  });

  it("draws every lantern as a post with one window of lantern ink inside its 2.6 m collider, above head height", () => {
    const posts = a.colliders.filter((c) => c.tag === "lantern").map((c) => c.box);
    expect(posts).toHaveLength(a.variant === "full" ? 14 : 8);
    const windows = a.render.filter((r) => r.material === "lantern").map((r) => r.box);
    expect(windows).toHaveLength(posts.length);
    for (const p of posts) {
      const w = windows.filter((q) => boxInBox(p, q));
      expect(w).toHaveLength(1);
      expect(w[0]!.min.y - p.min.y).toBeGreaterThanOrEqual(1.6);
    }
  });

  it("keeps decor against its building: ≤ 0.3 m out of a collider, ≤ 5 cm at body height — never across a passage", () => {
    const stray: string[] = [];
    for (const r of a.render) {
      if (!DECOR.has(r.material) || !boxInBox(a.bounds, r.box)) continue;
      // над плато, помостом или висячим мостом — от яруса, иначе от пола двора
      const onTier = a.colliders.some((c) => Math.abs(c.box.max.y - TIER) < 1e-9 && r.box.min.y >= TIER - 1e-9 && footprintsOverlap(c.box, r.box));
      const level = onTier ? TIER : 0;
      const reach = r.box.min.y < level + HEAD_CLEAR ? 0.05 : 0.3;
      const hugs = a.colliders.some(
        (c) =>
          r.box.min.x >= c.box.min.x - reach - 1e-9 &&
          r.box.max.x <= c.box.max.x + reach + 1e-9 &&
          r.box.min.z >= c.box.min.z - reach - 1e-9 &&
          r.box.max.z <= c.box.max.z + reach + 1e-9,
      );
      if (!hugs) stray.push(`${r.material} ${JSON.stringify(r.box)}`);
    }
    expect(stray).toStrictEqual([]);
  });

  it("keeps every spawn zone clear of decor", () => {
    const pad = PLAYER_HALF_W + 0.3;
    for (const s of a.spawns) {
      const zone = box(s.pos.x - pad, s.pos.y, s.pos.z - pad, s.pos.x + pad, s.pos.y + 2.6, s.pos.z + pad);
      expect(a.render.filter((r) => DECOR.has(r.material) && boxesOverlap(zone, r.box)).map((r) => r.material)).toStrictEqual([]);
    }
  });

  it("crowns buildings above 3 m with a 0.3 m roof band overhanging 0.25 m and gives them a 0.3 m plinth", () => {
    const same = (p: AABB, q: AABB) => JSON.stringify(p) === JSON.stringify(q);
    const lanterns = a.colliders.filter((c) => c.tag === "lantern");
    const crowns = a.render.filter(
      (r) =>
        r.material === "roof" &&
        Math.abs(r.box.max.y - r.box.min.y - 0.3) < 1e-9 &&
        r.box.max.y >= 4 - 1e-9 &&
        !a.colliders.some((c) => same(c.box, r.box)) &&
        !lanterns.some((c) => footprintsOverlap(c.box, r.box)),
    );
    const plinths = a.render.filter((r) => r.material === "edge" && r.box.min.y === 0 && Math.abs(r.box.max.y - 0.3) < 1e-9);
    // корпус (3 или 5 отрезков), зал, кладовая, 2 контрфорса и пилон — на каждой половине; в полном ещё контрфорс сада
    const perHalf = a.variant === "full" ? 4 + 5 + 1 : 3 + 5;
    expect(crowns).toHaveLength(2 * perHalf);
    expect(plinths).toHaveLength(2 * perHalf);
    // вынос: венец шире своей постройки ровно на 0,25 м хотя бы с одной стороны
    for (const c of crowns) {
      const under = a.colliders.find((k) => Math.abs(k.box.max.y - c.box.max.y) < 1e-9 && boxInBox(box(c.box.min.x - 1e-9, -99, c.box.min.z - 1e-9, c.box.max.x + 1e-9, 99, c.box.max.z + 1e-9), k.box));
      expect(under, JSON.stringify(c.box)).toBeDefined();
      const out = Math.max(under!.box.min.x - c.box.min.x, c.box.max.x - under!.box.max.x, under!.box.min.z - c.box.min.z, c.box.max.z - under!.box.max.z);
      expect(out).toBeCloseTo(0.25, 6);
    }
  });
});
