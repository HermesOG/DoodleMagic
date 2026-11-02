import { NO_MATCH_INPUT, aabb, pvpContext, type ArenaData, type MatchContext, type MatchInput, type Spawn } from "@doodlemagic/sim";

/**
 * Только для тестов сети. Арена испытаний sim (TEST_FLOOR, TEST_KILL): пол x −40…20, z −40…40, верх y = 0; восточнее
 * x = 20 — пропасть, зона смерти ниже −3 м. Четыре точки появления — как в тестах правил «Свалки» (задача 1).
 */
export const TEST_SPAWNS: Spawn[] = [
  { pos: { x: -30, y: 0, z: -30 }, yaw: 0 },
  { pos: { x: 10, y: 0, z: 30 }, yaw: Math.PI },
  { pos: { x: -30, y: 0, z: 30 }, yaw: Math.PI },
  { pos: { x: 10, y: 0, z: -30 }, yaw: 0 },
];

export const TEST_ARENA: ArenaData = {
  name: "Испытания сети",
  variant: "compact",
  bounds: aabb(-40, -30, -40, 40, 10, 40),
  colliders: [{ box: aabb(-40, -1, -40, 20, 0, 40), tag: "floor" }],
  volumes: [{ kind: "kill", box: aabb(20, -30, -40, 40, -3, 40) }],
  render: [],
  spawns: TEST_SPAWNS,
  pickups: [],
};

export const testPvpContext = (): MatchContext => pvpContext(TEST_ARENA);

/** Ввод тика: пустой с правками. */
export const input = (over: Partial<MatchInput> = {}): MatchInput => ({ ...NO_MATCH_INPUT, ...over });
