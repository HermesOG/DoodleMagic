import type { MatchState, Vec3 } from "@doodlemagic/sim";

/** Скачок дальше этого между тиками — телепорт (возрождение, сброс): не тянем, а ставим сразу. */
export const SNAP_M = 3;
/** За столько секунд свежий снаряд переходит из ладони на свою линию полёта. */
export const MUZZLE_BLEND_S = 0.15;

/**
 * Положения между двумя состояниями: объекты `cur` по порядку; есть в `prev` — линейно по `alpha`,
 * нет в `prev` (новый) или прыгнул дальше SNAP_M — как в `cur`. Исходные массивы не меняет.
 */
export function lerpById<T extends { id: number; pos: Vec3 }>(prev: readonly T[], cur: readonly T[], alpha: number): T[] {
  const before = new Map<number, T>();
  for (const p of prev) before.set(p.id, p);
  return cur.map((c) => {
    const p = before.get(c.id);
    if (!p) return c;
    const dx = c.pos.x - p.pos.x;
    const dy = c.pos.y - p.pos.y;
    const dz = c.pos.z - p.pos.z;
    if (dx * dx + dy * dy + dz * dz > SNAP_M * SNAP_M) return c;
    return { ...c, pos: { x: p.pos.x + dx * alpha, y: p.pos.y + dy * alpha, z: p.pos.z + dz * alpha } };
  });
}

/** Доля смещения «из ладони» у снаряда возраста ageS: 1 при выпуске, плавно до 0 к MUZZLE_BLEND_S. */
export function muzzleBlend(ageS: number): number {
  const t = Math.min(1, Math.max(0, ageS / MUZZLE_BLEND_S));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Точка в пространстве камеры рук (FOV handsFovDeg) → точка в пространстве камеры мира (FOV worldFovDeg),
 * которая ложится в тот же пиксель на той же глубине: x и y растягиваются отношением тангенсов полуугла.
 * Ладонь в мире — `camera.localToWorld(handToWorldView(palm, HANDS_FOV, WORLD_FOV))`.
 */
export function handToWorldView(p: Vec3, handsFovDeg: number, worldFovDeg: number): Vec3 {
  const th = Math.tan((handsFovDeg * Math.PI) / 360);
  const tw = Math.tan((worldFovDeg * Math.PI) / 360);
  return { x: (p.x * tw) / th, y: (p.y * tw) / th, z: p.z };
}

/** Дробный тик кадра между двумя состояниями: на нём рисуются рост рельефа, телеграфы, возраст снарядов. */
export function renderTick(prev: Readonly<MatchState>, cur: Readonly<MatchState>, alpha: number): number {
  return prev.tick + (cur.tick - prev.tick) * alpha;
}
