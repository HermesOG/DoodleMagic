import { createPlayer, forwardXZ } from "../player";
import { EYE_HEIGHT, type Spawn, type Vec3 } from "../types";
import { DUMMY, ELEMENT_INFO, SLOT_CHARGES } from "./defs";
import { NEVER, NOBODY, type DummySpot, type Element, type MatchInput, type MatchState, type Statuses, type Unit, type UnitId } from "./types";

export const NO_MATCH_INPUT: Readonly<MatchInput> = Object.freeze({ moveX: 0, moveZ: 0, jump: false, yaw: 0, pitch: 0, primary: false, q: false, e: false, c: false, x: false });
/** Ввод мага, от которого на этом тике ничего не пришло: стоит, кнопки отпущены, смотрит, куда смотрел. */
export const idleInput = (u: Readonly<Unit>): MatchInput => ({ ...NO_MATCH_INPUT, yaw: u.move.yaw, pitch: u.move.pitch });
export const freshStatuses = (): Statuses => ({
  burnPulses: 0, burnNext: 0, burnBy: NOBODY, slowUntil: 0, slowMul: 1, rootUntil: 0, airborne: false, noControlUntil: 0, immuneUntil: 0, shieldUntil: 0,
  wetUntil: 0, steamReadyAt: 0, staggerUntil: 0, anchoredUntil: 0, furyUntil: 0,
});

function baseUnit(id: UnitId, kind: Unit["kind"], pos: Vec3, yaw: number, hp: number): Unit {
  return {
    id, kind, move: createPlayer(pos, yaw), hp, maxHp: hp, kb: { x: 0, z: 0 }, status: freshStatuses(), lastHitTick: NEVER, lastHitBy: NOBODY, alive: true, respawnTick: 0,
    mage: null, dummy: null, tow: null, slam: null, hitters: [],
  };
}
export function createMageUnit(id: UnitId, element: Element, spawn: Spawn): Unit {
  const u = baseUnit(id, "mage", spawn.pos, spawn.yaw, ELEMENT_INFO[element].hp);
  u.mage = {
    element, ready: { primary: 0, q: 0, e: 0, c: 0, x: 0 }, held: { primary: false, q: false, e: false, c: false, x: false },
    pending: { primary: NEVER, q: NEVER, e: NEVER, c: NEVER, x: NEVER }, windup: null,
    heat: 0, overheatUntil: 0, lastShotTick: NEVER, dash: null, spawn: { pos: { ...spawn.pos }, yaw: spawn.yaw }, stats: { damage: 0, kills: 0, falls: 0, deaths: 0, streak: 0, multi: 0, lastScoreTick: -1 },
    charges: { ...SLOT_CHARGES[element] }, chargeAt: { primary: NEVER, q: NEVER, e: NEVER, c: NEVER, x: NEVER },
    flight: { doubleJumped: false, glideTicks: 0, gliding: false }, ward: null, ult: { charge: 0, cast: null },
  };
  return u;
}
export function createDummyUnit(id: UnitId, spot: DummySpot): Unit {
  const u = baseUnit(id, "dummy", spot.pos, spot.yaw, DUMMY.hp);
  u.dummy = { spot: clonePlain(spot), dir: 0 };
  return u;
}
/** id снарядов, зон и рельефа — с 1000: не путаются с id юнитов в логах. Объектов на карте нет: их заводит stepMatch. */
export const createMatchState = (units: Unit[]): MatchState => ({ tick: 0, units, projectiles: [], zones: [], terrain: [], nextId: 1000, pickups: [] });
export const unitById = (s: Readonly<MatchState>, id: UnitId): Unit | undefined => s.units.find((u) => u.id === id);

/** Глубокая копия простых данных. В отличие от JSON сохраняет −0 и Infinity. */
export function clonePlain<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clonePlain) as T;
  if (v === null || typeof v !== "object") return v;
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(v)) o[k] = clonePlain((v as Record<string, unknown>)[k]);
  return o as T;
}

/** Единичное направление взгляда: yaw как у forwardXZ, pitch вверх положительный. */
export function aimDir(yaw: number, pitch: number): Vec3 {
  const f = forwardXZ(yaw);
  const c = Math.cos(pitch);
  return { x: f.x * c, y: Math.sin(pitch), z: f.z * c };
}
/** «Вправо» по XZ — ось стрейфа stepPlayer; `+ 0` убирает −0. */
export function rightXZ(yaw: number): { x: number; z: number } {
  const f = forwardXZ(yaw);
  return { x: -f.z + 0, z: f.x + 0 };
}
export const eyeOf = (u: Unit): Vec3 => ({ x: u.move.body.pos.x, y: u.move.body.pos.y + EYE_HEIGHT, z: u.move.body.pos.z });
export function statusFlags(u: Unit, now: number): { burning: boolean; slowed: boolean; rooted: boolean; airborne: boolean; shielded: boolean; wet: boolean } {
  const s = u.status;
  return { burning: s.burnPulses > 0, slowed: now < s.slowUntil, rooted: now < s.rootUntil, airborne: s.airborne, shielded: now < s.shieldUntil, wet: now < s.wetUntil };
}
