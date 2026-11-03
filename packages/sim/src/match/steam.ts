import type { Vec3 } from "../types";
import { STEAM, ticks } from "./defs";
import { endZone, spawnZone } from "./zones";
import type { AbilityId, MatchState, TickCtx, UnitId } from "./types";

/**
 * Реакция «Пар» (GDD 4.6, Р9 фазы 4): облако на 3 с закрывает обзор (коллайдер noSight в buildTickWorld), снаряды и
 * лучи пропускает. Своё ограничение — 4 облака на арену, вне лимитов зон; лишнее вытесняет самое старое.
 */

const STEAM_LIFE_TICKS = ticks(STEAM.lifeS); // 180

/**
 * Облако пара с подошвой в pos: зона steam (диск 2,5 м), взведена сразу, живёт 3 с. Паров уже 4 — самый старый уходит
 * (zone/end). События zone/telegraph и reaction {kind: "steam"}. Возвращает id зоны.
 */
export function spawnSteam(s: MatchState, t: TickCtx, pos: Vec3, owner: UnitId, ability: AbilityId): number {
  const now = t.now;
  const clouds = s.zones.filter((z) => z.kind === "steam");
  for (let k = 0; k <= clouds.length - STEAM.perArena; k++) endZone(s, t, clouds[k]!);
  const center = { x: pos.x, y: pos.y, z: pos.z };
  const zone = spawnZone(s, t, {
    owner, kind: "steam", ability, shape: { type: "disc", center, radius: STEAM.radiusM },
    bornTick: now, armTick: now, endTick: now + STEAM_LIFE_TICKS,
  });
  t.ev.push({ type: "reaction", kind: "steam", owner, zone, pos: { x: pos.x, y: pos.y, z: pos.z } });
  return zone;
}
