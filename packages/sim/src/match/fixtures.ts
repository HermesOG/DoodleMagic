import { aabb } from "../aabb";
import type { Collider, Volume } from "../types";
import { createWorld } from "../world";
import type { MatchContext } from "./types";

/** Пол испытаний: x −40…20, z −40…40, верх y = 0. Восточнее x = 20 — пропасть, зона смерти ниже −3 м. */
export const TEST_FLOOR: Collider = { box: aabb(-40, -1, -40, 20, 0, 40), tag: "floor" };
export const TEST_KILL: Volume = { kind: "kill", box: aabb(20, -30, -40, 40, -3, 40) };
export const testContext = (extra: readonly Collider[] = []): MatchContext => ({ world: createWorld([TEST_FLOOR, ...extra], [TEST_KILL]), killBelowY: -30 });

/** Глубокая заморозка: в строгом режиме любая запись в замороженное бросает TypeError. */
export function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  Object.freeze(v);
  return v;
}
