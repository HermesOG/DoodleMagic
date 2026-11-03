import { aabb } from "../aabb";
import type { Collider } from "../types";
import { withDynamic, type World } from "../world";
import { STEAM } from "./defs";
import type { MatchState, TickCtx } from "./types";

/** Облако пара начинается чуть ниже подошвы цели: его не обойти, присев на ступеньку. */
const STEAM_BELOW_M = 0.5;

/** Мир одного тика и чей рельеф в нём: динамический коллайдер k — рельеф terrainIds[k], если k < terrainIds.length. */
export interface TickWorld {
  world: World;
  terrainIds: number[];
}

/**
 * Мир на начало тика s.tick: статика, твёрдый рельеф в порядке s.terrain, затем действующие стены огня
 * (noSight: закрывают обзор, движение и снаряды пропускают; GDD 4.3), затем облака пара. Боксы стен только читаются.
 */
export function buildTickWorld(staticWorld: World, s: Readonly<MatchState>): TickWorld {
  const dynamic: Collider[] = [];
  const terrainIds: number[] = [];
  for (const t of s.terrain) {
    if (!t.solid) continue;
    dynamic.push({ box: t.box, tag: `terrain-${t.id}` });
    terrainIds.push(t.id);
  }
  for (const z of s.zones) {
    if (z.kind === "fireWall" && z.shape.type === "box" && s.tick >= z.armTick && s.tick < z.endTick) {
      dynamic.push({ box: z.shape.box, noSight: true, tag: `fire-wall-${z.id}` });
    }
  }
  // Облака пара (Р9 фазы 4): тоже noSight — режут обзор, движение, снаряды и лучи "shot" пропускают.
  for (const z of s.zones) {
    if (z.kind === "steam" && z.shape.type === "disc" && s.tick >= z.armTick && s.tick < z.endTick) {
      const c = z.shape.center;
      const r = STEAM.radiusM;
      dynamic.push({ box: aabb(c.x - r, c.y - STEAM_BELOW_M, c.z - r, c.x + r, c.y + STEAM.heightM, c.z + r), noSight: true, tag: `steam-${z.id}` });
    }
  }
  return { world: dynamic.length > 0 ? withDynamic(staticWorld, dynamic) : staticWorld, terrainIds };
}

/** id рельефа по номеру коллайдера из overlapping или raycast; статика, стены огня и пар — null. */
export function terrainAt(t: Pick<TickCtx, "world" | "terrainIds">, collider: number): number | null {
  const k = collider - t.world.colliders.length;
  return k >= 0 && k < t.terrainIds.length ? t.terrainIds[k]! : null;
}
