import type { AABB, Axis, RayKind, Vec3 } from "./types";
import { AXES, length, sub, vec3 } from "./vec";
import { blocks, type World } from "./world";

export interface RayHit {
  /** Расстояние от начала луча, м. 0 — луч начался внутри бокса. */
  dist: number;
  point: Vec3;
  /**
   * Нормаль грани, в которую вошёл луч: по оси входа она всегда против направления луча, в том числе
   * у плоских боксов (min = max). (0, 0, 0), если луч начался внутри бокса или на его грани.
   */
  normal: Vec3;
  /** Номер коллайдера в world.colliders. */
  collider: number;
}

/** Счётчик для тестов: сколько боксов проверил луч. */
export interface RayStats {
  tested: number;
}

/** Вход луча в бокс. Одна запись на луч: slab пишет в неё, а не создаёт новую на каждый бокс. */
interface SlabHit {
  t: number;
  /** Ось грани входа; null — луч начался внутри бокса. */
  axis: Axis | null;
  /** Знак нормали по этой оси: всегда против направления луча. */
  sign: number;
}

/**
 * Вход луча в бокс на отрезке [0, maxT]: пишет его в out и возвращает true, или возвращает false.
 * Память не выделяет: вызывается для каждого бокса в клетках на пути луча.
 */
function slab(o: Vec3, d: Vec3, b: AABB, maxT: number, out: SlabHit): boolean {
  let tNear = 0;
  let tFar = maxT;
  let axis: Axis | null = null;
  let sign = 0;
  for (let k = 0; k < 3; k++) {
    const a = AXES[k]!;
    const ok = o[a];
    const dk = d[a];
    if (dk === 0) {
      if (ok < b.min[a] || ok > b.max[a]) return false;
      continue;
    }
    // Ближняя грань выбирается по направлению, а не сравнением t: у плоского бокса t0 = t1.
    const t0 = ((dk > 0 ? b.min[a] : b.max[a]) - ok) / dk;
    const t1 = ((dk > 0 ? b.max[a] : b.min[a]) - ok) / dk;
    if (t0 > tNear) {
      tNear = t0;
      axis = a;
      sign = dk > 0 ? -1 : 1;
    }
    if (t1 < tFar) tFar = t1;
    if (tNear > tFar) return false;
  }
  out.t = tNear;
  out.axis = axis;
  out.sign = sign;
  return true;
}

const finite3 = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * Луч по сетке мира (DDA по клеткам XZ, алгоритм Amanatides–Woo): проверяются только боксы в клетках,
 * через которые луч проходит. `dir` — единичный вектор. Возвращает ближайшее попадание не дальше maxDist;
 * при равном расстоянии — коллайдер с меньшим номером.
 *
 * Завершается при любом конечном начале и направлении и любом maxDist, в том числе Infinity: вертикальный луч
 * проверяет только свою клетку. NaN или отрицательный maxDist и нечисловые начало или направление — промах (null).
 * Память выделяется только под одну служебную запись и результат.
 */
export function raycast(
  w: World,
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  kind: RayKind = "shot",
  stats?: RayStats,
): RayHit | null {
  if (!(maxDist >= 0) || !finite3(origin) || !finite3(dir)) return null;

  // Обрезаем луч прямоугольником сетки по XZ.
  const gx1 = w.x0 + w.cols * w.cell;
  const gz1 = w.z0 + w.rows * w.cell;
  let tStart = 0;
  let tEnd = maxDist;
  if (dir.x === 0) {
    if (origin.x < w.x0 || origin.x > gx1) return null;
  } else {
    const ta = (w.x0 - origin.x) / dir.x;
    const tb = (gx1 - origin.x) / dir.x;
    tStart = Math.max(tStart, Math.min(ta, tb));
    tEnd = Math.min(tEnd, Math.max(ta, tb));
  }
  if (dir.z === 0) {
    if (origin.z < w.z0 || origin.z > gz1) return null;
  } else {
    const ta = (w.z0 - origin.z) / dir.z;
    const tb = (gz1 - origin.z) / dir.z;
    tStart = Math.max(tStart, Math.min(ta, tb));
    tEnd = Math.min(tEnd, Math.max(ta, tb));
  }
  if (tStart > tEnd) return null;

  const px = origin.x + dir.x * tStart;
  const pz = origin.z + dir.z * tStart;
  let i = Math.min(w.cols - 1, Math.max(0, Math.floor((px - w.x0) / w.cell)));
  let j = Math.min(w.rows - 1, Math.max(0, Math.floor((pz - w.z0) / w.cell)));
  const stepI = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepJ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;
  let tMaxX = stepI === 0 ? Infinity : (w.x0 + (stepI > 0 ? i + 1 : i) * w.cell - origin.x) / dir.x;
  let tMaxZ = stepJ === 0 ? Infinity : (w.z0 + (stepJ > 0 ? j + 1 : j) * w.cell - origin.z) / dir.z;
  const tDeltaX = stepI === 0 ? Infinity : w.cell / Math.abs(dir.x);
  const tDeltaZ = stepJ === 0 ? Infinity : w.cell / Math.abs(dir.z);

  const h: SlabHit = { t: 0, axis: null, sign: 0 };
  let bestIdx = -1;
  let bestT = maxDist;
  let bestAxis: Axis | null = null;
  let bestSign = 0;
  for (;;) {
    const cell = w.cells[j * w.cols + i]!;
    for (let n = 0; n < cell.length; n++) {
      const idx = cell[n]!;
      const c = w.colliders[idx]!;
      if (!blocks(c, kind)) continue;
      if (stats) stats.tested++;
      // slab ищет вход не дальше bestT, поэтому h.t ≤ bestT; при равенстве оставляем меньший номер.
      if (!slab(origin, dir, c.box, bestT, h) || (bestIdx >= 0 && h.t === bestT && idx > bestIdx)) continue;
      bestIdx = idx;
      bestT = h.t;
      bestAxis = h.axis;
      bestSign = h.sign;
    }
    const cellExit = Math.min(tMaxX, tMaxZ);
    // Всё, что лежит дальше по лучу, начинается не ближе выхода из клетки: найденное попадание уже ближайшее
    // (при равенстве идём дальше — там может быть коллайдер с меньшим номером). Луч кончился в этой клетке —
    // тоже стоп. Выхода нет совсем (вертикальный луч) — клетка была единственной: без этой проверки при
    // maxDist = Infinity цикл шагал бы на Infinity вечно.
    if ((bestIdx >= 0 && bestT < cellExit) || cellExit > tEnd || !(cellExit < Infinity)) break;
    if (tMaxX < tMaxZ) {
      i += stepI;
      tMaxX += tDeltaX;
    } else {
      j += stepJ;
      tMaxZ += tDeltaZ;
    }
    if (i < 0 || j < 0 || i >= w.cols || j >= w.rows) break;
  }
  if (bestIdx < 0) return null;
  const normal = vec3();
  if (bestAxis) normal[bestAxis] = bestSign;
  return {
    dist: bestT,
    point: { x: origin.x + dir.x * bestT, y: origin.y + dir.y * bestT, z: origin.z + dir.z * bestT },
    normal,
    collider: bestIdx,
  };
}

/** Видно ли точку b из точки a (луч вида "sight"). */
export function lineOfSight(w: World, a: Vec3, b: Vec3): boolean {
  const d = sub(b, a);
  const len = length(d);
  if (len < 1e-9) return true;
  const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
  return raycast(w, a, dir, len, "sight") === null;
}

/**
 * Высота первой опоры под точкой не глубже maxDrop (можно Infinity) или null. Если опора найдена через её
 * верхнюю грань, возвращается точно box.max.y, без погрешности p.y − t. Если точка уже внутри бокса
 * (или ровно на его верхней грани), опора — сама точка: возвращается p.y, расстояние 0.
 */
export function groundBelow(w: World, p: Vec3, maxDrop = 50): number | null {
  const hit = raycast(w, p, { x: 0, y: -1, z: 0 }, maxDrop, "move");
  if (!hit) return null;
  return hit.normal.y === 1 ? w.colliders[hit.collider]!.box.max.y : hit.point.y;
}
