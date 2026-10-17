import type { AABB, Collider, Vec3 } from "@doodlemagic/sim";

/**
 * Мини-геометрия арены. Поток B не зависит от физики потока A: здесь только то, что нужно DSL и
 * тестам инвариантов. Лучи — перебором всех боксов: для проверки одной арены этого достаточно.
 */

export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB {
  return {
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
  };
}

/** Независимая копия бокса: ни min, ни max не общие с исходным. */
export function copyBox(b: AABB): AABB {
  return { min: { ...b.min }, max: { ...b.max } };
}

/** Пересечение боксов или null, если объём нулевой. */
export function clipBox(a: AABB, b: AABB): AABB | null {
  const x0 = Math.max(a.min.x, b.min.x);
  const y0 = Math.max(a.min.y, b.min.y);
  const z0 = Math.max(a.min.z, b.min.z);
  const x1 = Math.min(a.max.x, b.max.x);
  const y1 = Math.min(a.max.y, b.max.y);
  const z1 = Math.min(a.max.z, b.max.z);
  return x0 < x1 && y0 < y1 && z0 < z1 ? box(x0, y0, z0, x1, y1, z1) : null;
}

/** Пересекаются ли боксы; касание гранями не считается. */
export function boxesOverlap(a: AABB, b: AABB, eps = 1e-6): boolean {
  return (
    a.min.x < b.max.x - eps &&
    a.max.x > b.min.x + eps &&
    a.min.y < b.max.y - eps &&
    a.max.y > b.min.y + eps &&
    a.min.z < b.max.z - eps &&
    a.max.z > b.min.z + eps
  );
}

export function pointInBox(b: AABB, p: Vec3): boolean {
  return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
}

export function boxInBox(outer: AABB, inner: AABB): boolean {
  return pointInBox(outer, inner.min) && pointInBox(outer, inner.max);
}

/**
 * Расстояние до входа луча в бокс или null. dir — единичный вектор.
 * - Начало луча внутри бокса (или на его грани) — 0.
 * - Бокс позади начала или дальше maxDist — null.
 * - Луч, скользящий по грани или ребру (касание без входа внутрь), считается попаданием: границы
 *   бокса замкнуты. Для проверок обзора это осторожная сторона — касание закрывает линию.
 */
export function rayBox(o: Vec3, dir: Vec3, b: AABB, maxDist: number): number | null {
  let tNear = 0;
  let tFar = maxDist;
  for (const a of ["x", "y", "z"] as const) {
    if (dir[a] === 0) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return null;
      continue;
    }
    const t0 = (b.min[a] - o[a]) / dir[a];
    const t1 = (b.max[a] - o[a]) / dir[a];
    tNear = Math.max(tNear, Math.min(t0, t1));
    tFar = Math.min(tFar, Math.max(t0, t1));
    if (tNear > tFar) return null;
  }
  return tNear;
}

/**
 * Ближайшее попадание луча по коллайдерам, которые закрывают обзор (всё, кроме noShoot), перебором.
 * noSight-коллайдеры (трава, дым) обзор закрывают. Касание грани — попадание (см. rayBox).
 */
export function sightDistance(colliders: readonly Collider[], o: Vec3, dir: Vec3, maxDist: number): number | null {
  let best: number | null = null;
  for (const c of colliders) {
    if (c.noShoot) continue;
    const t = rayBox(o, dir, c.box, best ?? maxDist);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Видно ли точку b из точки a. Отрезок, задевающий грань укрытия, считается закрытым. */
export function canSee(colliders: readonly Collider[], a: Vec3, b: Vec3): boolean {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
  if (len < 1e-9) return true;
  return sightDistance(colliders, a, { x: d.x / len, y: d.y / len, z: d.z / len }, len) === null;
}

/**
 * Верх первой опоры под точкой (по коллайдерам, которые держат движение, т. е. без noSight) или null,
 * если до maxDrop опоры нет. Если точка внутри бокса (или на его грани), возвращается сам p.y:
 * луч вниз «входит» в бокс сразу. Чтобы найти пол под стоящим, начинайте выше подошвы.
 */
export function floorBelow(colliders: readonly Collider[], p: Vec3, maxDrop = 50): number | null {
  let best: number | null = null;
  for (const c of colliders) {
    if (c.noSight) continue;
    const t = rayBox(p, { x: 0, y: -1, z: 0 }, c.box, maxDrop);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best === null ? null : p.y - best;
}
