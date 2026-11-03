import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import type { ArenaData, Spawn } from "../types";
import { applyHit } from "./combat";
import { ticks } from "./defs";
import { TEST_FLOOR, TEST_KILL, deepFreeze, testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import {
  PVP, addMage, createGame, pickSpawn, pvpContext, removeMage, scoreLimitFor, scoreOf, setElement, standings, startCountdown, stepGame, type GameState,
} from "./rules";
import { NO_MATCH_INPUT, clonePlain, createDummyUnit, createMageUnit, createMatchState, freshStatuses, statusFlags } from "./state";
import { NEVER, NOBODY, type Element, type MatchContext, type MatchEvent, type MatchInput, type MatchState, type TickCtx, type Unit, type UnitId } from "./types";

const SPAWNS: Spawn[] = [
  { pos: { x: -30, y: 0, z: -30 }, yaw: 0 },
  { pos: { x: 10, y: 0, z: 30 }, yaw: Math.PI },
  { pos: { x: -30, y: 0, z: 30 }, yaw: Math.PI },
  { pos: { x: 10, y: 0, z: -30 }, yaw: 0 },
];
const ctx: MatchContext = { ...testContext(), spawns: SPAWNS, mageRespawnS: PVP.respawnS, spawnShieldS: PVP.shieldS };
/** Тик PvP для прямых вызовов боя (как его соберёт stepMatch из ctx). */
const tickOf = (s: MatchState, ev: MatchEvent[]): TickCtx => ({
  world: ctx.world, terrainIds: [], killBelowY: ctx.killBelowY, now: s.tick, ev, spawns: SPAWNS, mageRespawnTicks: ticks(PVP.respawnS), spawnShieldTicks: ticks(PVP.shieldS),
});
const mageAt = (id: UnitId, el: Element, x: number, z: number, yaw = 0): Unit => createMageUnit(id, el, { pos: { x, y: 0, z }, yaw });
const byId = (s: MatchState, id: UnitId): Unit => s.units.find((u) => u.id === id)!;
type Log = { t: number; e: MatchEvent }[];
/** n тиков stepMatch; ввод по номеру тика; события подряд и они же с номером тика. */
function steps(s: MatchState, n: number, c: MatchContext, input: (tick: number) => Partial<Record<UnitId, MatchInput>> = () => ({})): { s: MatchState; events: MatchEvent[]; log: Log } {
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const r = stepMatch(s, input(s.tick), c);
    for (const e of r.events) log.push({ t: s.tick, e });
    s = r.state;
  }
  return { s, events: log.map(({ e }) => e), log };
}

describe("spawn shield and deaths in the match contracts", () => {
  it("a fresh unit has no shield and no deaths", () => {
    const u = mageAt(1, "fire", 0, 0);
    expect([freshStatuses().shieldUntil, u.status.shieldUntil, u.mage!.stats, statusFlags(u, 0).shielded]).toEqual([0, 0, { damage: 0, kills: 0, falls: 0, deaths: 0 }, false]);
  });

  it("a shielded mage takes no damage, no push, no status and no hit event until the shield ends", () => {
    const s = createMatchState([mageAt(1, "fire", 0, 0), mageAt(2, "earth", 0, -5)]);
    s.tick = 10;
    const target = byId(s, 2);
    target.status.shieldUntil = 20;
    const ev: MatchEvent[] = [];
    const hit = () => applyHit(s, tickOf(s, ev), { source: 1, target: 2, ability: "fireball", damage: 50, pos: { x: 0, y: 1, z: -5 }, dir: { x: 0, z: -1 }, knock: { distM: 3, upM: 1.2 }, burn: true });
    expect(hit()).toBe(0);
    expect([target.hp, target.kb, target.move.body.vel.y, target.status.burnPulses, target.lastHitBy, ev]).toEqual([170, { x: 0, z: 0 }, 0, 0, -1, []]);
    expect([statusFlags(target, 19).shielded, statusFlags(target, 20).shielded]).toEqual([true, false]);
    s.tick = 20;
    expect(hit()).toBe(50);
    expect(ev).toContainEqual(expect.objectContaining({ type: "hit", target: 2, amount: 50 }));
  });

  it("an accepted cast drops the caster's shield, a rejected one keeps it", () => {
    const s = steps(createMatchState([mageAt(1, "fire", 0, 0), mageAt(2, "earth", -10, 0)]), 5, ctx).s; // встали на пол
    for (const u of s.units) u.status.shieldUntil = 600;
    byId(s, 2).mage!.ready.q = 10_000;
    const press = { ...NO_MATCH_INPUT, q: true };
    const r = steps(s, 3, ctx, () => ({ 1: press, 2: press }));
    expect(r.events).toContainEqual(expect.objectContaining({ type: "cast", unit: 1, ability: "fireball" }));
    expect(r.events).toContainEqual(expect.objectContaining({ type: "reject", unit: 2, slot: "q", reason: "cooldown" }));
    expect([byId(r.s, 1).status.shieldUntil, byId(r.s, 2).status.shieldUntil]).toEqual([5, 600]);
  });

  it("without the PvP fields the context works as before: back in 1 s on its own spawn, unshielded", () => {
    const s = createMatch({ mages: [{ element: "fire", spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 } }], dummies: [] });
    byId(s, 1).move.body.pos.x = 30; // над пропастью
    const r = steps(s, 150, testContext());
    const fall = r.log.find(({ e }) => e.type === "fall");
    const back = r.log.find(({ e }) => e.type === "respawn");
    expect([fall !== undefined, back]).toEqual([true, { t: fall!.t + 60, e: { type: "respawn", target: 1, pos: { x: 0, y: 0, z: 0 }, yaw: 0 } }]);
    const u = byId(r.s, 1);
    expect([u.alive, u.status.shieldUntil, u.mage!.spawn.pos, u.mage!.stats.deaths]).toEqual([true, 0, { x: 0, y: 0, z: 0 }, 1]);
  });
});

/** Разминка с магами этих стихий: id 1, 2, … на точках pickSpawn. */
function gameWith(...els: Element[]): GameState {
  let g = createGame();
  for (const el of els) g = addMage(g, el, ctx).game;
  return g;
}
/** n шагов stepGame; ввод по номеру тика; события с номером тика. */
function play(g: GameState, n: number, input: (tick: number) => Partial<Record<UnitId, MatchInput>> = () => ({})): { g: GameState; log: Log } {
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const r = stepGame(g, input(g.match.tick), ctx);
    for (const e of r.events) log.push({ t: g.match.tick, e });
    g = r.game;
  }
  return { g, log };
}
const mageOf = (g: GameState, id: UnitId): Unit => byId(g.match, id);
const posOf = (g: GameState, id: UnitId) => mageOf(g, id).move.body.pos;
const unshield = (g: GameState): GameState => {
  for (const u of g.match.units) u.status.shieldUntil = 0;
  return g;
};
/** Бой идёт: отсчёт пройден. */
const live = (...els: Element[]): GameState => play(startCountdown(gameWith(...els)), ticks(PVP.countdownS)).g;
/** Снаряд, зона и рельеф мага owner. */
function litter(g: GameState, owner: UnitId): void {
  const s = g.match;
  const id = () => s.nextId++;
  s.projectiles.push({ id: id(), owner, ability: "fireball", pos: { x: 0, y: 1, z: owner }, vel: { x: 0, y: 0, z: 0 }, bornTick: 0, endTick: 1e6, power: 50 });
  s.zones.push({ id: id(), owner, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: aabb(-5, 0, owner, 5, 2.5, owner + 0.6) }, bornTick: 0, armTick: 0, endTick: 1e6, rehit: [] });
  s.terrain.push({ id: id(), owner, kind: "wall", box: aabb(-35, 0, 10 * owner, -31, 2.5, 10 * owner + 0.6), bornTick: 0, solidTick: 0, endTick: 1e6, growTicks: 18, solid: true, hp: 250, maxHp: 250 });
}
const owners = (g: GameState) => [g.match.projectiles, g.match.zones, g.match.terrain].map((list) => list.map((x) => x.owner));
const xz = (sp: { pos: { x: number; z: number } }) => ({ x: sp.pos.x, z: sp.pos.z });

describe("free-for-all basics", () => {
  it("score limit: 10 up to two mages, 12 for three or four, 15 from five", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(scoreLimitFor)).toEqual([10, 10, 10, 12, 12, 15, 15, 15]);
  });

  it("pvpContext copies the arena spawns and sets the 3 s respawn and 2 s shield; an arena without spawns throws", () => {
    const arena: ArenaData = {
      name: "t", variant: "full", bounds: aabb(-40, -30, -40, 40, 10, 40), colliders: [TEST_FLOOR], volumes: [TEST_KILL], render: [], spawns: SPAWNS, pickups: [],
    };
    const c = pvpContext(arena);
    expect([c.spawns, c.spawns === SPAWNS, c.spawns![0]!.pos === SPAWNS[0]!.pos, c.mageRespawnS, c.spawnShieldS, c.killBelowY]).toEqual([SPAWNS, false, false, 3, 2, -30]);
    expect(() => pvpContext({ ...arena, spawns: [] })).toThrow();
  });

  it("standings: score down, then deaths up, then id up; a score is kills + falls", () => {
    const g = gameWith("fire", "earth", "fire", "earth");
    const set = (id: UnitId, kills: number, falls: number, deaths: number) => Object.assign(mageOf(g, id).mage!.stats, { kills, falls, deaths });
    set(1, 2, 1, 3);
    set(2, 3, 0, 1);
    set(3, 1, 2, 1);
    set(4, 4, 1, 9);
    expect(standings(g)).toEqual([
      { id: 4, score: 5, kills: 4, falls: 1, deaths: 9 },
      { id: 2, score: 3, kills: 3, falls: 0, deaths: 1 },
      { id: 3, score: 3, kills: 1, falls: 2, deaths: 1 },
      { id: 1, score: 3, kills: 2, falls: 1, deaths: 3 },
    ]);
    expect([scoreOf(mageOf(g, 3)), scoreOf(createDummyUnit(9, { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }))]).toEqual([3, 0]);
  });
});

describe("pickSpawn", () => {
  const at = (s: MatchState, id: UnitId) => SPAWNS.indexOf(pickSpawn(s, id, SPAWNS));

  it("takes the first point when nobody is around and the farthest from the nearest living enemy otherwise", () => {
    expect(pickSpawn(createMatchState([]), 1, SPAWNS)).toBe(SPAWNS[0]);
    expect(at(createMatchState([mageAt(2, "fire", -29, -29)]), 1)).toBe(1);
  });

  it("breaks a tie by the smaller index", () => {
    expect(at(createMatchState([mageAt(2, "fire", -30, -30), mageAt(3, "earth", 10, -30)]), 1)).toBe(1); // точки 1 и 2 — обе в 60 м
  });

  it("ignores the mage itself, dead mages and dummies", () => {
    const dead = mageAt(3, "earth", -30, -30);
    dead.alive = false;
    const s = createMatchState([mageAt(1, "fire", -30, -30), dead, createDummyUnit(4, { pos: { x: -30, y: 0, z: -30 }, yaw: 0 })]);
    expect(at(s, 1)).toBe(0);
  });

  it("throws on an empty list", () => {
    expect(() => pickSpawn(createMatchState([]), 1, [])).toThrow();
  });
});

describe("joining and leaving", () => {
  it("addMage: ids 1, 2, 3 on the farthest points with a 2 s shield, the argument untouched", () => {
    const g0 = play(createGame(), 10).g;
    const a = addMage(deepFreeze(g0), "fire", ctx);
    const b = addMage(deepFreeze(a.game), "earth", ctx);
    const c = addMage(deepFreeze(b.game), "fire", ctx);
    const g = c.game;
    expect([a.id, b.id, c.id, g.nextMageId, g0.match.units.length, g.match.units.map((u) => u.id)]).toEqual([1, 2, 3, 4, 0, [1, 2, 3]]);
    expect([1, 2, 3].map((id) => xz({ pos: posOf(g, id) }))).toEqual([xz(SPAWNS[0]!), xz(SPAWNS[1]!), xz(SPAWNS[2]!)]);
    expect([mageOf(g, 2).mage!.spawn, mageOf(g, 2).move.yaw, mageOf(g, 2).hp]).toEqual([SPAWNS[1], Math.PI, 170]);
    expect(g.match.units.map((u) => u.status.shieldUntil)).toEqual([130, 130, 130]);
    expect([statusFlags(mageOf(g, 1), 129).shielded, statusFlags(mageOf(g, 1), 130).shielded]).toEqual([true, false]);
    expect([a.game.scoreLimit, b.game.scoreLimit, g.scoreLimit]).toEqual([10, 10, 12]);
  });

  it("addMage needs spawn points; joining a running match only raises the limit", () => {
    expect(() => addMage(createGame(), "fire", testContext())).toThrow();
    const g = live("fire", "earth");
    expect([g.phase, g.scoreLimit, addMage(g, "fire", ctx).game.scoreLimit]).toEqual(["live", 10, 12]);
    expect(addMage({ ...g, scoreLimit: 15 }, "fire", ctx).game.scoreLimit).toBe(15);
  });

  it("removeMage drops the unit with its projectiles, zones and terrain and keeps the limit; the argument is untouched", () => {
    const g = gameWith("fire", "earth", "fire");
    litter(g, 1);
    litter(g, 2);
    const r = removeMage(deepFreeze(g), 1);
    expect([r.match.units.map((u) => u.id), owners(r), r.scoreLimit, g.match.units.length]).toEqual([[2, 3], [[2], [2], [2]], 12, 3]);
    expect(play(r, 1).g.scoreLimit).toBe(10); // разминка пересчитывает лимит по числу магов
  });
});

describe("deaths and scoring", () => {
  /** Маг id сгорит на этом тике от последнего импульса горения мага by. */
  function burnOut(g: GameState, id: UnitId, by: UnitId): void {
    const u = mageOf(g, id);
    u.hp = 1;
    u.status = { ...freshStatuses(), burnPulses: 1, burnNext: g.match.tick, burnBy: by };
  }
  /** Маг id над пропастью; толкнул его by (NOBODY — упал сам). */
  function overPit(g: GameState, id: UnitId, by: UnitId): void {
    const u = mageOf(g, id);
    Object.assign(u, { lastHitBy: by, lastHitTick: by === NOBODY ? NEVER : g.match.tick });
    u.move.body.pos.x = 30;
  }
  const stats = (g: GameState) => g.match.units.map((u) => [u.mage!.stats.kills, u.mage!.stats.falls, u.mage!.stats.deaths]);

  it("a kill: the victim +1 death, the killer +1 kill", () => {
    const g = unshield(gameWith("fire", "earth"));
    burnOut(g, 2, 1);
    const r = play(g, 1);
    expect(r.log.map(({ e }) => e)).toContainEqual(expect.objectContaining({ type: "death", target: 2, killer: 1 }));
    expect([stats(r.g), scoreOf(mageOf(r.g, 1))]).toEqual([[[1, 0, 0], [0, 0, 1]], 1]);
  });

  it("a credited fall: the victim +1 death, the pusher +1 fall; falling alone is only a death", () => {
    const g = unshield(gameWith("fire", "earth", "fire"));
    overPit(g, 2, 1);
    overPit(g, 3, NOBODY);
    const r = play(g, 90);
    expect(r.log.filter(({ e }) => e.type === "fall").map(({ e }) => e)).toEqual([
      expect.objectContaining({ target: 2, credit: 1 }),
      expect.objectContaining({ target: 3, credit: NOBODY }),
    ]);
    expect(stats(r.g)).toEqual([[0, 1, 0], [0, 0, 1], [0, 0, 1]]);
  });

  it("respawn: 3 s later on the point farthest from the living enemies, with that point as its spawn and a shield", () => {
    const g = unshield(gameWith("fire", "earth"));
    burnOut(g, 1, 2);
    const k = g.match.tick;
    const dead = play(g, 1).g;
    expect([mageOf(dead, 1).alive, mageOf(dead, 1).respawnTick]).toEqual([false, k + 180]);
    Object.assign(posOf(dead, 2), { x: -28, z: -28 }); // враг встал у точки 0, где маг погиб
    const r = play(dead, 180);
    const back = r.log.filter(({ e }) => e.type === "respawn");
    expect(back).toEqual([{ t: k + 180, e: { type: "respawn", target: 1, pos: SPAWNS[1]!.pos, yaw: Math.PI } }]);
    const u = mageOf(r.g, 1);
    // встал в конце тика k + 180: защита на полные 120 тиков после него
    expect([u.alive, u.mage!.spawn, u.status.shieldUntil, statusFlags(u, r.g.match.tick).shielded, u.mage!.stats.deaths]).toEqual([true, SPAWNS[1], k + 301, true, 1]);
  });
});

describe("phases", () => {
  it("startCountdown leaves warmup or results for a 3 s countdown and ignores the other phases", () => {
    const g = play(gameWith("fire", "earth"), 7).g;
    const c = startCountdown(deepFreeze(g));
    expect([c.phase, c.phaseEnd, c.suddenDeath, c.results, g.phase]).toEqual(["countdown", 187, false, [], "warmup"]);
    expect(startCountdown(c)).toEqual(c);
    const l = live("fire", "earth");
    expect(startCountdown(l)).toEqual(l);
    const done: GameState = { ...l, phase: "results", phaseEnd: NEVER, results: standings(l) };
    expect(startCountdown(done)).toMatchObject({ phase: "countdown", phaseEnd: done.match.tick + 180, results: [], suddenDeath: false });
  });

  it("the countdown ends in 180 ticks: scores reset, mages on different points, the arena cleared, a respawn each", () => {
    const g = gameWith("fire", "earth", "fire");
    for (const u of g.match.units) Object.assign(u.mage!.stats, { damage: 40, kills: 2, falls: 1, deaths: 1 });
    Object.assign(posOf(g, 1), { x: 10, z: -30 });
    Object.assign(mageOf(g, 2), { alive: false, respawnTick: 1e6 });
    litter(g, 1);
    litter(g, 3);
    const before = play(startCountdown(g), 179);
    expect(before.g.phase).toBe("countdown");
    const r = play(before.g, 1);
    const n = r.g.match.tick;
    expect([r.g.phase, r.g.phaseEnd, r.g.scoreLimit, r.g.suddenDeath, owners(r.g)]).toEqual(["live", n + 25200, 12, false, [[], [], []]]);
    expect(r.g.match.units.map((u) => [u.alive, u.mage!.stats, u.status.shieldUntil])).toEqual(
      [1, 2, 3].map(() => [true, { damage: 0, kills: 0, falls: 0, deaths: 0 }, n + 120]),
    );
    expect([1, 2, 3].map((id) => mageOf(r.g, id).mage!.spawn)).toEqual([SPAWNS[0], SPAWNS[1], SPAWNS[2]]);
    expect(r.log.filter(({ e }) => e.type === "respawn").map(({ e }) => e)).toEqual(
      [1, 2, 3].map((id) => ({ type: "respawn", target: id, pos: SPAWNS[id - 1]!.pos, yaw: SPAWNS[id - 1]!.yaw })),
    );
  });

  it("the leader reaching the limit ends the match with the standings", () => {
    const g = live("fire", "earth");
    mageOf(g, 2).mage!.stats.kills = g.scoreLimit;
    const r = play(g, 1).g;
    expect([r.phase, r.phaseEnd, r.suddenDeath, r.results.map((x) => [x.id, x.score])]).toEqual(["results", NEVER, false, [[2, 10], [1, 0]]]);
  });

  it("the clock: no tie ends the match; a tie goes to 60 s of sudden death, which ends on the first point or in a draw", () => {
    const g = live("fire", "earth", "fire");
    g.phaseEnd = g.match.tick + 1;
    const ahead = clonePlain(g);
    mageOf(ahead, 3).mage!.stats.falls = 1;
    expect(play(ahead, 1).g.phase).toBe("results");

    const sd = play(g, 1).g;
    expect([sd.phase, sd.suddenDeath, sd.phaseEnd]).toEqual(["live", true, sd.match.tick + 3600]);
    expect(play(sd, 1).g.phase).toBe("live");
    const broken = clonePlain(sd);
    mageOf(broken, 2).mage!.stats.kills = 1;
    const won = play(broken, 1).g;
    expect([won.phase, won.suddenDeath, won.results[0]!.id]).toEqual(["results", false, 2]);

    const draw = play({ ...sd, phaseEnd: sd.match.tick + 1 }, 1).g;
    expect([draw.phase, draw.suddenDeath, draw.results.map((x) => x.score)]).toEqual(["results", false, [0, 0, 0]]);
  });

  it("results: nothing changes while the fight goes on unscored", () => {
    const g = live("fire", "earth");
    mageOf(g, 1).mage!.stats.kills = 10;
    const done = play(g, 1).g;
    mageOf(done, 2).mage!.stats.kills = 50;
    const r = play(done, 30).g;
    expect([r.phase, r.results, r.phaseEnd, r.scoreLimit, r.match.tick]).toEqual(["results", done.results, NEVER, 10, done.match.tick + 30]);
  });
});

describe("setElement", () => {
  it("a dead mage only changes its element and comes back with that element's HP", () => {
    const g = gameWith("fire", "earth");
    Object.assign(mageOf(g, 1), { alive: false, hp: 0, respawnTick: g.match.tick + 5 });
    const r = setElement(deepFreeze(g), 1, "earth", ctx);
    expect([mageOf(r, 1).mage!.element, mageOf(r, 1).alive, mageOf(g, 1).mage!.element]).toEqual(["earth", false, "fire"]);
    const back = mageOf(play(r, 6).g, 1);
    expect([back.alive, back.hp, back.mage!.element]).toEqual([true, 170, "earth"]);
  });

  it("a living mage in warmup is reborn at once on the farthest point, keeping its score, shielded, its arena things gone", () => {
    const g = play(gameWith("fire", "earth"), 4).g;
    mageOf(g, 1).mage!.stats.kills = 2;
    Object.assign(posOf(g, 2), { x: -28, z: -28 });
    litter(g, 1);
    litter(g, 2);
    const r = setElement(deepFreeze(g), 1, "earth", ctx);
    const u = mageOf(r, 1);
    expect([u.mage!.element, u.hp, u.mage!.stats.kills, u.mage!.spawn, xz({ pos: u.move.body.pos }), u.status.shieldUntil, owners(r)]).toEqual([
      "earth", 170, 2, SPAWNS[1], xz(SPAWNS[1]!), g.match.tick + 120, [[2], [2], [2]],
    ]);
  });

  it("a living mage in a running match and an unknown id change nothing", () => {
    const g = live("fire", "earth");
    expect(setElement(g, 1, "earth", ctx)).toEqual(g);
    expect(setElement(gameWith("fire"), 7, "earth", ctx)).toEqual(gameWith("fire"));
  });

  it("a dead mage switching element drops the old element's cooldowns; the same element changes nothing", () => {
    const g = gameWith("fire", "earth");
    Object.assign(mageOf(g, 1), { alive: false, hp: 0, respawnTick: g.match.tick + 5 });
    mageOf(g, 1).mage!.ready = { primary: 50, q: 400, e: 400, c: 600 };
    expect(mageOf(setElement(g, 1, "earth", ctx), 1).mage!.ready).toEqual({ primary: 0, q: 0, e: 0, c: 0 });
    expect(setElement(g, 1, "fire", ctx)).toEqual(g);
    const alive = gameWith("fire", "earth");
    expect(setElement(alive, 1, "fire", ctx)).toEqual(alive);
  });
});

describe("stepGame determinism", () => {
  const DUEL: Spawn[] = [{ pos: { x: 0, y: 0, z: 6 }, yaw: 0 }, { pos: { x: 0, y: 0, z: -6 }, yaw: Math.PI }];
  const duel: MatchContext = { ...testContext(), spawns: DUEL, mageRespawnS: PVP.respawnS, spawnShieldS: PVP.shieldS };
  /** Маг 1 (Огонь) смотрит на −Z, маг 2 (Земля) — на +Z: друг на друга. ЛКМ, Q и стрейф по номеру тика. */
  const script = (n: number): Partial<Record<UnitId, MatchInput>> => ({
    1: { ...NO_MATCH_INPUT, moveX: n % 120 < 60 ? 0.5 : -0.5, yaw: 0, pitch: -0.05, primary: n % 40 < 25, q: n % 150 === 10 },
    2: { ...NO_MATCH_INPUT, moveX: n % 100 < 50 ? -0.5 : 0.5, yaw: Math.PI, pitch: -0.05, primary: n % 50 < 30, q: n % 170 === 20 },
  });
  function run(): string[] {
    let g = createGame();
    for (const el of ["fire", "earth"] as const) g = addMage(g, el, duel).game;
    const out: string[] = [];
    for (let k = 0; k < 600; k++) {
      if (k === 100) g = startCountdown(g);
      const r = stepGame(deepFreeze(g), deepFreeze(script(g.match.tick)), duel); // замороженный вход: запись в него бросит TypeError
      g = r.game;
      out.push(JSON.stringify(r.game), JSON.stringify(r.events));
    }
    return out;
  }

  it("gives byte-identical games and events for the same inputs, without mutating them", () => {
    const [a, b] = [run(), run()];
    expect(a).toEqual(b);
    const all = a.join("\n");
    expect([all.includes('"type":"hit"'), all.includes('"phase":"live"'), all.includes('"type":"respawn"')]).toEqual([true, true, true]);
  });
});
