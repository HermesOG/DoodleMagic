import { groundBelow } from "../raycast";
import type { Vec3 } from "../types";
import { add, scale } from "../vec";
import { horizontalDir } from "./kit";
import { sweepSegment } from "./projectiles";
import { aimDir, eyeOf, unitById } from "./state";
import { NOBODY, type MatchState, type TickCtx, type UnitId } from "./types";

/** Опору ищем от точки чуть выше неё и не глубже этого, м. */
const GROUND_PROBE_UP_M = 0.1;
const GROUND_DROP_M = 30;
/** От вертикальной грани точка отходит назад на столько по горизонтали (Р9). */
const WALL_BACKOFF_M = 0.3;

/**
 * Точка на земле под прицелом (Р9): луч из глаз на rangeM до мира или до тела юнита. Тело — его ступни (на опоре
 * под ним); верхняя грань — сама точка на высоте опоры; нижняя грань (навес, перемычка арки) — вниз до опоры от точки
 * чуть ниже грани, а не изнутри плиты; вертикальная грань — 0,3 м назад по горизонтали и вниз до опоры; ничего — от
 * конца дальности вниз до опоры. Опоры нет (пропасть) — null.
 */
export function aimGround(s: MatchState, t: TickCtx, caster: UnitId, yaw: number, pitch: number, rangeM: number): Vec3 | null {
  const u = unitById(s, caster);
  if (!u) return null;
  const eye = eyeOf(u);
  const dir = aimDir(yaw, pitch);
  const ground = (p: Vec3) => groundBelow(t.world, { x: p.x, y: p.y + GROUND_PROBE_UP_M, z: p.z }, GROUND_DROP_M);
  const hit = sweepSegment(s, t, caster, eye, add(eye, scale(dir, rangeM)), 0);
  if (hit && hit.unit !== NOBODY) {
    const p = unitById(s, hit.unit)!.move.body.pos; // прицел на теле — его ступни
    return { x: p.x, y: ground(p) ?? p.y, z: p.z };
  }
  // верхняя грань: высота — ровно верх опоры, без погрешности луча
  if (hit && hit.normal.y > 0.5) return { x: hit.point.x, y: ground(hit.point) ?? hit.point.y, z: hit.point.z };
  // нижняя грань: проба опоры начинается ниже грани (ground поднимает её на GROUND_PROBE_UP_M — в плиту не попадёт)
  if (hit && hit.normal.y < -0.5) {
    const y = ground({ x: hit.point.x, y: hit.point.y - 2 * GROUND_PROBE_UP_M, z: hit.point.z });
    return y === null ? null : { x: hit.point.x, y, z: hit.point.z };
  }
  const h = horizontalDir({ x: dir.x, z: dir.z });
  // вертикальная грань — шаг назад по горизонтали; дальше — вниз до опоры
  const p = hit ? { x: hit.point.x - h.x * WALL_BACKOFF_M, y: hit.point.y, z: hit.point.z - h.z * WALL_BACKOFF_M } : add(eye, scale(dir, rangeM));
  const y = ground(p);
  return y === null ? null : { x: p.x, y, z: p.z };
}
