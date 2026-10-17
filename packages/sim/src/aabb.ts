import type { AABB, Vec3 } from "./types";

/** Бокс по двум углам в любом порядке. */
export function aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB {
  return {
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
  };
}

/** Пересекаются ли боксы. Касание гранями — не пересечение; eps — допуск на погрешность. */
export function overlaps(a: AABB, b: AABB, eps = 0): boolean {
  return (
    a.min.x < b.max.x - eps &&
    a.max.x > b.min.x + eps &&
    a.min.y < b.max.y - eps &&
    a.max.y > b.min.y + eps &&
    a.min.z < b.max.z - eps &&
    a.max.z > b.min.z + eps
  );
}

/** Лежит ли точка в боксе, границы включительно. */
export function containsPoint(b: AABB, p: Vec3): boolean {
  return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
}

/** Лежит ли бокс a целиком в боксе b. */
export function containsBox(b: AABB, a: AABB): boolean {
  return containsPoint(b, a.min) && containsPoint(b, a.max);
}

/** Пересечение боксов или null, если объём нулевой. */
export function intersect(a: AABB, b: AABB): AABB | null {
  const r = aabb(
    Math.max(a.min.x, b.min.x),
    Math.max(a.min.y, b.min.y),
    Math.max(a.min.z, b.min.z),
    Math.min(a.max.x, b.max.x),
    Math.min(a.max.y, b.max.y),
    Math.min(a.max.z, b.max.z),
  );
  const empty =
    Math.max(a.min.x, b.min.x) >= Math.min(a.max.x, b.max.x) ||
    Math.max(a.min.y, b.min.y) >= Math.min(a.max.y, b.max.y) ||
    Math.max(a.min.z, b.min.z) >= Math.min(a.max.z, b.max.z);
  return empty ? null : r;
}

export const sizeOf = (b: AABB): Vec3 => ({ x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z });
export const centerOf = (b: AABB): Vec3 => ({
  x: (b.min.x + b.max.x) / 2,
  y: (b.min.y + b.max.y) / 2,
  z: (b.min.z + b.max.z) / 2,
});
