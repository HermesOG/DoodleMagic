import type { AABB, Axis, RayKind, Vec3 } from "./types";
import { AXES, length, sub, vec3 } from "./vec";
import { blocks, colliderAt, type World } from "./world";

export interface RayHit {
  /** Расстояние от начала луча, м. 0 — луч начался внутри бокса. */
  dist: number;
  point: Vec3;
  /**
   * Нормаль грани, в которую вошёл луч: по оси входа она всегда против направления луча, в том числе
   * у плоских боксов (min = max). (0, 0, 0), если луч начался внутри бокса или на его грани.
   */
  normal: Vec3;
  /** Номер коллайдера: статический — в world.colliders, динамический — colliders.length + индекс в world.dynamic (см. colliderAt). */
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
  // При maxT = Infinity и ненормированном направлении (dir ≈ 5e-324) вход переполняется в Infinity: такого
  // попадания нет, а точка на нём была бы NaN. Проверка здесь закрывает и сетку статики, и перебор динамики.
  if (!(tNear < Infinity)) return false;
  out.t = tNear;
  out.axis = axis;
  out.sign = sign;
  return true;
}

const finite3 = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** Лучшее попадание луча на сейчас: номер коллайдера (−1 — нет), расстояние и грань входа. */
interface BestHit {
  idx: number;
  t: number;
  axis: Axis | null;
  sign: number;
}

/**
 * Луч по сетке статики (DDA по клеткам XZ, алгоритм Amanatides–Woo): проверяются только боксы в клетках,
 * через которые луч проходит. Ближайшее попадание не дальше best.t пишет в best; при равном расстоянии —
 * коллайдер с меньшим номером. h — служебная запись для slab.
 */
function gridRay(w: World, origin: Vec3, dir: Vec3, maxDist: number, kind: RayKind, stats: RayStats | undefined, h: SlabHit, best: BestHit): void {
  // Обрезаем луч прямоугольником сетки по XZ.
  const gx1 = w.x0 + w.cols * w.cell;
  const gz1 = w.z0 + w.rows * w.cell;
  let tStart = 0;
  let tEnd = maxDist;
  if (dir.x === 0) {
    if (origin.x < w.x0 || origin.x > gx1) return;
  } else {
    const ta = (w.x0 - origin.x) / dir.x;
    const tb = (gx1 - origin.x) / dir.x;
    tStart = Math.max(tStart, Math.min(ta, tb));
    tEnd = Math.min(tEnd, Math.max(ta, tb));
  }
  if (dir.z === 0) {
    if (origin.z < w.z0 || origin.z > gz1) return;
  } else {
    const ta = (w.z0 - origin.z) / dir.z;
    const tb = (gz1 - origin.z) / dir.z;
    tStart = Math.max(tStart, Math.min(ta, tb));
    tEnd = Math.min(tEnd, Math.max(ta, tb));
  }
  // При крайних, но конечных данных (dir ≈ 5e-324, начало в 1e300) вход в сетку переполняется в Infinity:
  // такой луч в сетку не попадает, а дальше дал бы NaN в номере клетки.
  if (!(tStart <= tEnd && tStart < Infinity)) return;

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

  for (;;) {
    const cell = w.cells[j * w.cols + i]!;
    for (let n = 0; n < cell.length; n++) {
      const idx = cell[n]!;
      const c = w.colliders[idx]!;
      if (!blocks(c, kind)) continue;
      if (stats) stats.tested++;
      // slab ищет вход не дальше best.t, поэтому h.t ≤ best.t; при равенстве оставляем меньший номер.
      if (!slab(origin, dir, c.box, best.t, h) || (best.idx >= 0 && h.t === best.t && idx > best.idx)) continue;
      best.idx = idx;
      best.t = h.t;
      best.axis = h.axis;
      best.sign = h.sign;
    }
    const cellExit = Math.min(tMaxX, tMaxZ);
    // Всё, что лежит дальше по лучу, начинается не ближе выхода из клетки: найденное попадание уже ближайшее
    // (при равенстве идём дальше — там может быть коллайдер с меньшим номером). Луч кончился в этой клетке —
    // тоже стоп. Выхода нет совсем (вертикальный луч) — клетка была единственной: без этой проверки при
    // maxDist = Infinity цикл шагал бы на Infinity вечно.
    if ((best.idx >= 0 && best.t < cellExit) || cellExit > tEnd || !(cellExit < Infinity)) break;
    if (tMaxX < tMaxZ) {
      i += stepI;
      tMaxX += tDeltaX;
    } else {
      j += stepJ;
      tMaxZ += tDeltaZ;
    }
    if (i < 0 || j < 0 || i >= w.cols || j >= w.rows) break;
  }
}

/**
 * Луч по миру: сначала по сетке статики (см. gridRay), затем перебором по динамике (world.dynamic) — даже если
 * луч сетку не задел. `dir` — единичный вектор. Возвращает ближайшее попадание не дальше maxDist; при равном
 * расстоянии — коллайдер с меньшим номером (статика раньше динамики).
 *
 * Завершается при любом конечном начале и направлении и любом maxDist, в том числе Infinity: вертикальный луч
 * проверяет только свою клетку. NaN или отрицательный maxDist и нечисловые начало или направление — промах (null).
 * Попадание всегда на конечном расстоянии: вход в бокс, переполненный в Infinity, — промах.
 * Память выделяется только под две служебные записи и результат.
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
  const h: SlabHit = { t: 0, axis: null, sign: 0 };
  const best: BestHit = { idx: -1, t: maxDist, axis: null, sign: 0 };
  gridRay(w, origin, dir, maxDist, kind, stats, h, best);
  const dyn = w.dynamic;
  if (dyn) {
    for (let k = 0; k < dyn.length; k++) {
      if (!blocks(dyn[k]!, kind)) continue;
      if (stats) stats.tested++;
      // При равном расстоянии остаётся найденный раньше: статика или динамика с меньшим номером.
      if (!slab(origin, dir, dyn[k]!.box, best.t, h) || (best.idx >= 0 && h.t === best.t)) continue;
      best.idx = w.colliders.length + k;
      best.t = h.t;
      best.axis = h.axis;
      best.sign = h.sign;
    }
  }
  if (best.idx < 0) return null;
  const normal = vec3();
  if (best.axis) normal[best.axis] = best.sign;
  return {
    dist: best.t,
    point: { x: origin.x + dir.x * best.t, y: origin.y + dir.y * best.t, z: origin.z + dir.z * best.t },
    normal,
    collider: best.idx,
  };
}

/**
 * Видно ли точку b из точки a (луч вида "sight"). При нечисловых или бесконечных концах, а также если расстояние
 * между ними переполняет double, — не видно: в сомнении закрыто, а не открыто.
 */
export function lineOfSight(w: World, a: Vec3, b: Vec3): boolean {
  if (!finite3(a) || !finite3(b)) return false;
  const d = sub(b, a);
  const len = length(d);
  if (!(len < Infinity)) return false;
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
  return hit.normal.y === 1 ? colliderAt(w, hit.collider).box.max.y : hit.point.y;
}
