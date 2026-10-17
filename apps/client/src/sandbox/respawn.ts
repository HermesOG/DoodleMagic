import { bodyBox, createPlayer, volumeAt, type ArenaData, type PlayerState, type World } from "@doodlemagic/sim";

/** Упал в ущелье (зона смерти) или вывалился за низ арены. */
export function shouldRespawn(world: World, s: PlayerState, arena: ArenaData): boolean {
  return volumeAt(world, bodyBox(s.body), "kill") !== null || s.body.pos.y < arena.bounds.min.y;
}

/** Следующая точка появления: шаг 3 по кругу из 10 разводит соседние появления подальше. */
export function nextSpawnIndex(index: number, count: number, stride = 3): number {
  return count > 0 ? (index + stride) % count : 0;
}

export function spawnPlayer(arena: ArenaData, index: number): PlayerState {
  const s = arena.spawns[index % arena.spawns.length];
  if (!s) throw new Error("arena has no spawns");
  return createPlayer(s.pos, s.yaw);
}
