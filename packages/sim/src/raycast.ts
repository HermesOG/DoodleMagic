import type { AABB, Axis, RayKind, Vec3 } from "./types";
import { AXES, length, sub, vec3 } from "./vec";
import { blocks, type World } from "./world";

export interface RayHit {
  /** Расстояние от начала луча, м. 0 — луч начался внутри бокса. */
  dist: number;
  point: Vec3;
  /** Нормаль грани, в которую вошёл луч; (0, 0, 0), если луч начался внутри. */
  normal: Vec3;
  /** Номер коллайдера в world.colliders. */
  collider: number;
}

/** Счётчик для тестов: сколько боксов проверил луч. */
export interface RayStats {
  tested: number;
}

interface SlabHit {
  t: number;
  /** Ось грани входа; null — луч начался внутри бокса. */
  axis: Axis | null;
  sign: number;
}

/** Вход луча в бокс на отрезке [0, maxT] или null. Без выделения памяти: вызывается сотни раз за тик. */
function slab(o: Vec3, d: Vec3, b: AABB, maxT: number): SlabHit | null {
  let tNear = 0;
  let tFar = maxT;
  let axis: Axis | null = null;
  let sign = 0;
  for (let k = 0; k < 3; k++) {
    const a = AXES[k]!;
    const ok = o[a];
    const dk = d[a];
    if (dk === 0) {
      if (ok < b.min[a] || ok > b.max[a]) return null;
      continue;
    }
    let t0 = (b.min[a] - ok) / dk;
    let t1 = (b.max[a] - ok) / dk;
    let s = -1;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
      s = 1;
    }
    if (t0 > tNear) {
      tNear = t0;
      axis = a;
      sign = s;
    }
    if (t1 < tFar) tFar = t1;
    if (tNear > tFar) return null;
  }
  return { t: tNear, axis, sign };
}

/**
 * Луч по сетке мира (DDA по клеткам XZ, алгоритм Amanatides–Woo): проверяются только боксы в клетках,
 * через которые луч проходит. `dir` — единичный вектор. Возвращает ближайшее попадание не дальше maxDist.
 */
export function raycast(
  w: World,
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  kind: RayKind = "shot",
  stats?: RayStats,
): RayHit | null {
  // Обрезаем луч прямоугольником сетки по XZ.
  const gx1 = w.x0 + w.cols * w.cell;
  const gz1 = w.z0 + w.rows * w.cell;
  let tStart = 0;
  let tEnd = maxDist;
  for (const [o, d, lo, hi] of [
    [origin.x, dir.x, w.x0, gx1],
    [origin.z, dir.z, w.z0, gz1],
  ] as const) {
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tStart = Math.max(tStart, t0);
    tEnd = Math.min(tEnd, t1);
  }
  if (tStart > tEnd) return null;

  const px = origin.x + dir.x * tStart;
  const pz = origin.z + dir.z * tStart;
  let i = Math.min(w.cols - 1, Math.max(0, Math.floor((px - w.x0) / w.cell)));
  let j = Math.min(w.rows - 1, Math.max(0, Math.floor((pz - w.z0) / w.cell)));
  const stepI = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepJ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;
  const nextX = (cell: number) => w.x0 + (stepI > 0 ? cell + 1 : cell) * w.cell;
  const nextZ = (cell: number) => w.z0 + (stepJ > 0 ? cell + 1 : cell) * w.cell;
  let tMaxX = stepI === 0 ? Infinity : (nextX(i) - origin.x) / dir.x;
  let tMaxZ = stepJ === 0 ? Infinity : (nextZ(j) - origin.z) / dir.z;
  const tDeltaX = stepI === 0 ? Infinity : w.cell / Math.abs(dir.x);
  const tDeltaZ = stepJ === 0 ? Infinity : w.cell / Math.abs(dir.z);

  let best: RayHit | null = null;
  let bestT = maxDist;
  for (;;) {
    for (const idx of w.cells[j * w.cols + i]!) {
      const c = w.colliders[idx]!;
      if (!blocks(c, kind)) continue;
      if (stats) stats.tested++;
      const h = slab(origin, dir, c.box, bestT);
      if (!h || h.t > bestT || (best && h.t === bestT && idx > best.collider)) continue;
      bestT = h.t;
      const normal = vec3();
      if (h.axis) normal[h.axis] = h.sign;
      best = {
        dist: h.t,
        point: { x: origin.x + dir.x * h.t, y: origin.y + dir.y * h.t, z: origin.z + dir.z * h.t },
        normal,
        collider: idx,
      };
    }
    const cellExit = Math.min(tMaxX, tMaxZ);
    // Всё, что лежит дальше по лучу, начинается не ближе выхода из клетки: найденное попадание уже ближайшее.
    if ((best && bestT <= cellExit) || cellExit > tEnd) break;
    if (tMaxX < tMaxZ) {
      i += stepI;
      tMaxX += tDeltaX;
    } else {
      j += stepJ;
      tMaxZ += tDeltaZ;
    }
    if (i < 0 || j < 0 || i >= w.cols || j >= w.rows) break;
  }
  return best;
}

/** Видно ли точку b из точки a (луч вида "sight"). */
export function lineOfSight(w: World, a: Vec3, b: Vec3): boolean {
  const d = sub(b, a);
  const len = length(d);
  if (len < 1e-9) return true;
  const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
  return raycast(w, a, dir, len, "sight") === null;
}

/** Высота первой опоры под точкой не глубже maxDrop или null. */
export function groundBelow(w: World, p: Vec3, maxDrop = 50): number | null {
  const hit = raycast(w, p, { x: 0, y: -1, z: 0 }, maxDrop, "move");
  return hit ? hit.point.y : null;
}
