import type { AABB, Vec3 } from "../types";
import { BOIL_OFF, STEAM, WATER, ticks } from "./defs";
import { endZone, spawnZone } from "./zones";
import type { AbilityId, MatchState, ReactionKind, TickCtx, UnitId, Zone } from "./types";

/**
 * Реакция «Пар» (GDD 4.6, Р9 фазы 4): облако на 3 с закрывает обзор (коллайдер noSight в buildTickWorld), снаряды и
 * лучи пропускает. Своё ограничение — 4 облака на арену, вне лимитов зон; лишнее вытесняет самое старое.
 * «Выкипание» — то же облако (4 м) на месте Родника, по которому прошёлся огонь.
 */

const STEAM_LIFE_TICKS = ticks(STEAM.lifeS); // 180
const SP = WATER.spring;

/**
 * Облако пара с подошвой в pos: зона steam (диск radius, по умолчанию 2,5 м), взведена сразу, живёт 3 с. Паров уже 4 —
 * самый старый уходит (zone/end). События zone/telegraph и reaction {kind} («Пар» или «Выкипание»). Возвращает id зоны.
 */
export function spawnSteam(
  s: MatchState, t: TickCtx, pos: Vec3, owner: UnitId, ability: AbilityId,
  radius: number = STEAM.radiusM, kind: ReactionKind = "steam",
): number {
  const now = t.now;
  const clouds = s.zones.filter((z) => z.kind === "steam");
  for (let k = 0; k <= clouds.length - STEAM.perArena; k++) endZone(s, t, clouds[k]!);
  const center = { x: pos.x, y: pos.y, z: pos.z };
  const zone = spawnZone(s, t, {
    owner, kind: "steam", ability, shape: { type: "disc", center, radius },
    bornTick: now, armTick: now, endTick: now + STEAM_LIFE_TICKS,
  });
  t.ev.push({ type: "reaction", kind, owner, zone, pos: { x: pos.x, y: pos.y, z: pos.z } });
  return zone;
}

/** Взведённые и ещё живые Родники (диски) этого тика. */
const armedSprings = (s: MatchState, now: number): Zone[] =>
  s.zones.filter((q) => q.kind === "spring" && q.shape.type === "disc" && now >= q.armTick && now < q.endTick);

/**
 * «Выкипание» (GDD 4.6, round3/03-water.md): Родник уходит (zone/end), на его месте — облако пара 4 м на 3 с хозяина
 * огня (его эффект пришёл вторым). Лимит пара на арену — как у «Пара» (spawnSteam). «Раз в 3 с на цель» здесь даёт
 * сама замена: Родник снят, второго облака с него не будет. Событие reaction {kind: "boilOff"} — в центре Родника.
 */
function boilOff(s: MatchState, t: TickCtx, spring: Zone, owner: UnitId, ability: AbilityId): void {
  if (spring.shape.type !== "disc" || !s.zones.includes(spring)) return;
  const c = spring.shape.center;
  endZone(s, t, spring);
  spawnSteam(s, t, c, owner, ability, BOIL_OFF.radiusM, "boilOff");
}

/**
 * Взрыв огненного шара в pos радиусом r выпаривает каждый взведённый Родник, который задел: от pos до диска (плоского,
 * на высоте его центра) не дальше r.
 */
export function boilOffByBlast(s: MatchState, t: TickCtx, owner: UnitId, ability: AbilityId, pos: Vec3, r: number): void {
  for (const z of armedSprings(s, t.now)) {
    if (z.shape.type !== "disc") continue;
    const c = z.shape.center;
    const dh = Math.max(0, Math.hypot(pos.x - c.x, pos.z - c.z) - z.shape.radius);
    const dy = pos.y - c.y;
    if (dh * dh + dy * dy <= r * r) boilOff(s, t, z, owner, ability);
  }
}

/**
 * Взведённая Стена огня выпаривает взведённый Родник, с которым пересеклась: по XZ ближайшая к центру Родника точка
 * бокса не дальше радиуса, по высоте центр Родника в боксе (снизу — с запасом в высоту Родника, 1,5 м). Стена горит
 * дальше; пар — её хозяина.
 */
export function boilOffByWall(s: MatchState, t: TickCtx, wall: Zone): void {
  if (wall.shape.type !== "box") return;
  const b: AABB = wall.shape.box;
  for (const z of armedSprings(s, t.now)) {
    if (z.shape.type !== "disc") continue;
    const c = z.shape.center;
    if (c.y < b.min.y - SP.heightM || c.y > b.max.y) continue;
    const nx = Math.max(b.min.x, Math.min(b.max.x, c.x));
    const nz = Math.max(b.min.z, Math.min(b.max.z, c.z));
    if (Math.hypot(nx - c.x, nz - c.z) <= z.shape.radius) boilOff(s, t, z, wall.owner, wall.ability);
  }
}
