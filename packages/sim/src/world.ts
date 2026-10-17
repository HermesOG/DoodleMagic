import { overlaps } from "./aabb";
import type { AABB, Collider, ColliderFlags, RayKind, Volume, VolumeKind } from "./types";

/** Держит ли коллайдер данный вид запроса. */
export function blocks(c: ColliderFlags, kind: RayKind): boolean {
  if (kind === "move") return c.noSight !== true;
  if (kind === "shot") return c.noShoot !== true && c.noSight !== true;
  return c.noShoot !== true;
}

export const DEFAULT_CELL_M = 4;
/** Допуск пересечения: касание с погрешностью до микрона не считается столкновением. */
export const OVERLAP_EPS = 1e-6;

/**
 * Статический мир: коллайдеры в равномерной сетке по XZ и объёмы.
 * Мир неизменяем: запросы ничего в нём не пишут, поэтому один мир можно делить между хостом и клиентом.
 */
export interface World {
  readonly colliders: readonly Collider[];
  readonly volumes: readonly Volume[];
  readonly cell: number;
  /** Левый нижний угол сетки по X и Z. */
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  /** Номера коллайдеров в клетке (i, j) лежат в cells[j * cols + i]. */
  readonly cells: readonly (readonly number[])[];
}

export function createWorld(colliders: readonly Collider[], volumes: readonly Volume[] = [], cell = DEFAULT_CELL_M): World {
  let minX = 0;
  let minZ = 0;
  let maxX = cell;
  let maxZ = cell;
  if (colliders.length > 0) {
    minX = Infinity;
    minZ = Infinity;
    maxX = -Infinity;
    maxZ = -Infinity;
    for (const c of colliders) {
      minX = Math.min(minX, c.box.min.x);
      minZ = Math.min(minZ, c.box.min.z);
      maxX = Math.max(maxX, c.box.max.x);
      maxZ = Math.max(maxZ, c.box.max.z);
    }
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  const world: World = { colliders, volumes, cell, x0: minX, z0: minZ, cols, rows, cells };
  colliders.forEach((c, idx) => {
    const [i0, i1] = cellSpan(world, c.box.min.x, c.box.max.x, "x");
    const [j0, j1] = cellSpan(world, c.box.min.z, c.box.max.z, "z");
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * cols + i]!.push(idx);
  });
  return world;
}

/** Номер клетки по координате, прижатый к краям сетки. */
export function cellIndex(w: World, v: number, axis: "x" | "z"): number {
  const origin = axis === "x" ? w.x0 : w.z0;
  const count = axis === "x" ? w.cols : w.rows;
  const i = Math.floor((v - origin) / w.cell);
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}

function cellSpan(w: World, lo: number, hi: number, axis: "x" | "z"): [number, number] {
  return [cellIndex(w, lo, axis), cellIndex(w, hi, axis)];
}

/** Номера коллайдеров вида `kind`, которые пересекают бокс (касание не считается). Без повторов. */
export function overlapping(w: World, box: AABB, out: number[] = [], kind: RayKind = "move"): number[] {
  out.length = 0;
  const [i0, i1] = cellSpan(w, box.min.x, box.max.x, "x");
  const [j0, j1] = cellSpan(w, box.min.z, box.max.z, "z");
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (const idx of w.cells[j * w.cols + i]!) {
        const c = w.colliders[idx]!;
        if (!blocks(c, kind) || out.includes(idx)) continue;
        if (overlaps(box, c.box, OVERLAP_EPS)) out.push(idx);
      }
    }
  }
  return out;
}

/** Свободен ли бокс от коллайдеров, которые держат движение. */
export function isFree(w: World, box: AABB): boolean {
  return overlapping(w, box).length === 0;
}

/** Первый объём вида `kind`, который пересекает бокс, или null. */
export function volumeAt(w: World, box: AABB, kind: VolumeKind): Volume | null {
  for (const v of w.volumes) if (v.kind === kind && overlaps(box, v.box)) return v;
  return null;
}
