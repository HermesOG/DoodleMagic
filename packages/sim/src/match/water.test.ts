import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import type { Spawn } from "../types";
import { applyHit, pullMul } from "./combat";
import { buildTickWorld } from "./dynamic";
import { deepFreeze, testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { wardFaces } from "./projectiles";
import { idleInput, NO_MATCH_INPUT, statusFlags, unitById } from "./state";
import { spawnTerrain } from "./terrain";
import { NOBODY, type DummySpot, type Element, type MatchContext, type MatchEvent, type MatchInput, type MatchState, type TickCtx, type UnitId } from "./types";
import { spawnZone } from "./zones";

const ctx = testContext();
/** Вода смотрит на −Z (yaw 0); EAST — взгляд на +X. */
const HOME: Spawn = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
const EAST = -Math.PI / 2;
const spot = (x: number, z: number, yaw = 0): Spawn => ({ pos: { x, y: 0, z }, yaw });
const at = (z: number, x = 0): DummySpot => ({ pos: { x, y: 0, z }, yaw: 0 });
/** yaw взгляда из (fx, fz) на (tx, tz): forwardXZ(yaw) = (−sin yaw, −cos yaw). */
const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(-(tx - fx), -(tz - fz));
/** За пропастью (x > 20) — второй берег с x = 23,9. */
const GAP = testContext([{ box: aabb(23.9, -1, -40, 40, 0, 40), tag: "floor" }]);

function tickOf(s: MatchState, ev: MatchEvent[], c: MatchContext = ctx): TickCtx {
  const tw = buildTickWorld(c.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: c.killBelowY, now: s.tick, ev, spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0, ultChargeMul: 1 };
}

type Log = { t: number; e: MatchEvent }[];
type Inputs = Partial<Record<UnitId, Partial<MatchInput>>>;
interface Setup {
  mages: { element: Element; spawn: Spawn }[];
  dummies?: DummySpot[];
  c?: MatchContext;
  /** Правка состояния после 5 тиков покоя, до первого тика сценария. */
  prep?: (s: MatchState, t: TickCtx) => void;
}
/** Маги (id 1…M) и манекены; ввод по относительному тику k (без yaw и pitch — прежний взгляд). log — с относительным тиком. */
function play(o: Setup, n: number, input: (k: number, s: MatchState) => Inputs = () => ({}), each?: (k: number, s: MatchState) => void) {
  const c = o.c ?? ctx;
  let s = createMatch({ mages: o.mages, dummies: o.dummies ?? [] });
  for (let k = 0; k < 5; k++) s = stepMatch(s, {}, c).state;
  o.prep?.(s, tickOf(s, [], c));
  const start = s.tick;
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const inputs: Partial<Record<UnitId, MatchInput>> = {};
    for (const [id, i] of Object.entries(input(k, s))) inputs[Number(id)] = { ...idleInput(unitById(s, Number(id))!), ...i };
    const r = stepMatch(s, inputs, c);
    s = r.state;
    for (const e of r.events) log.push({ t: k, e });
    each?.(k, s);
  }
  return { s, log, start };
}
const evs = <K extends MatchEvent["type"]>(log: Log, type: K) => log.flatMap(({ t, e }) => (e.type === type ? [{ t, e: e as Extract<MatchEvent, { type: K }> }] : []));
const ticksOf = (log: Log, type: MatchEvent["type"], ability: string) => log.filter(({ e }) => e.type === type && "ability" in e && e.ability === ability).map(({ t }) => t);
const hitsOn = (log: Log, target: UnitId) => evs(log, "hit").filter(({ e }) => e.target === target);
const u = (s: MatchState, id: UnitId) => unitById(s, id)!;
const water = (spawn: Spawn = HOME) => ({ element: "water" as const, spawn });
const solo = (dummies: DummySpot[], c?: MatchContext): Setup => ({ mages: [water()], dummies, c });

describe("Water whip (LMB)", () => {
  it("strikes 7 ticks after the press with a beam: 20 at 14 m, wets, pulls ≈ 0.24 m to Water; at 16 m — a miss", () => {
    const { s, log } = play(solo([at(-14)]), 70, (k) => ({ 1: { primary: k === 0 } }));
    expect([ticksOf(log, "cast", "waterWhip"), evs(log, "release").map(({ t, e }) => [t, e.ability, e.projectile])]).toEqual([[0], [[7, "waterWhip", -1]]]);
    const beam = evs(log, "beam");
    expect(beam.map(({ t, e }) => [t, e.ability, e.unit, e.target, e.from])).toEqual([[7, "waterWhip", 1, 2, { x: 0, y: 1.6, z: 0 }]]);
    expect(beam[0]!.e.to.z).toBeCloseTo(-14 + 0.4 + 0.25, 6);
    const hits = hitsOn(log, 2);
    expect(hits.map(({ t, e }) => [t, e.ability, e.amount, e.dir])).toEqual([[7, "waterWhip", 20, { x: 0, y: 0, z: 1 }]]);
    expect(hits[0]!.e.knock.distM).toBeCloseTo(0.24, 12);
    const d = u(s, 2);
    const pulled = d.move.body.pos.z + 14;
    expect([statusFlags(d, s.tick).wet, pulled > 0.2, pulled <= 0.24 + 1e-9]).toEqual([true, true, true]);

    const far = play(solo([at(-16)]), 20, (k) => ({ 1: { primary: k === 0 } }));
    expect([hitsOn(far.log, 2).length, evs(far.log, "beam").map(({ e }) => [e.target, e.to])]).toEqual([0, [[NOBODY, { x: 0, y: 1.6, z: -15 }]]]);
  });

  it("a box stops it, a fire wall does not, an Earth wall takes 20", () => {
    const boxed = testContext([{ box: aabb(-1, 0, -6, 1, 3, -5), tag: "wall" }]);
    const b = play(solo([at(-10)], boxed), 20, (k) => ({ 1: { primary: k === 0 } }));
    expect([hitsOn(b.log, 2).length, evs(b.log, "beam")[0]!.e.target]).toEqual([0, NOBODY]);
    expect(evs(b.log, "beam")[0]!.e.to.z).toBeCloseTo(-5, 6);

    const fw = play(
      { ...solo([at(-10)]), prep: (s, t) => void spawnZone(s, t, { owner: 1, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: aabb(-5, 0, -6, 5, 2.5, -5.4) }, bornTick: s.tick, armTick: s.tick, endTick: s.tick + 300 }) },
      20, (k) => ({ 1: { primary: k === 0 } }),
    );
    expect(hitsOn(fw.log, 2).map(({ e }) => [e.ability, e.amount])).toEqual([["waterWhip", 20]]);

    const ew = play(
      { ...solo([at(-10)]), prep: (s, t) => void spawnTerrain(s, t, 3, "wall", aabb(-2, 0, -6, 2, 2.5, -5.4), { growTicks: 0, solidTicks: 0, lifeTicks: 600, hp: 250 }) },
      20, (k) => ({ 1: { primary: k === 0 } }),
    );
    expect([hitsOn(ew.log, 2).length, evs(ew.log, "terrain").filter(({ e }) => e.phase === "hit").map(({ t, e }) => [t, e.amount]), ew.s.terrain[0]!.hp]).toEqual([0, [[7, 20]], 230]);
  });

  it("holding LMB whips every 24 ticks", () => {
    const { log } = play(solo([]), 60, () => ({ 1: { primary: true } }));
    expect([ticksOf(log, "cast", "waterWhip"), ticksOf(log, "beam", "waterWhip")]).toEqual([[0, 24, 48], [7, 31, 55]]);
  });

  it("«Круговорот»: the second whip on the now-wet target heals Water by 4, above 100 of 150", () => {
    const { s, log } = play({ ...solo([at(-10)]), prep: (st) => void (u(st, 1).hp = 140) }, 40, () => ({ 1: { primary: true } }));
    expect([evs(log, "heal").map(({ t, e }) => [t, e.target, e.source, e.amount]), u(s, 1).hp]).toEqual([[[31, 1, 1, 4]], 144]);
  });
});

describe("Water grab (Q)", () => {
  /** Вода в HOME тянет цель id 2; ввод Воды — Q на k = 0. */
  const grabbed = (o: Setup, n = 90, more: (k: number) => Inputs = () => ({})) => play(o, n, (k) => ({ 1: { q: k === 0 }, ...more(k) }));
  const towOf = (log: Log) => evs(log, "tow").map(({ t, e }) => [t, e.phase]);

  it("a 28 m/s rope after a 0.25 s windup, up to 15 m; cooldown 8 s", () => {
    const { s, log } = play(solo([]), 16, (k) => ({ 1: { q: k === 0 } }));
    const rel = evs(log, "release");
    expect([ticksOf(log, "cast", "waterGrab"), rel.map(({ t, e }) => [t, e.ability]), u(s, 1).mage!.ready.q - s.tick]).toEqual([[0], [[15, "waterGrab"]], 480 - 16]);
    const p = s.projectiles[0]!;
    expect([p.ability, p.id, p.power, p.endTick - p.bornTick, Math.hypot(p.vel.x, p.vel.y, p.vel.z)]).toEqual(["waterGrab", rel[0]!.e.projectile, 25, 32, 28]);
    const miss = grabbed(solo([at(-16)]));
    expect(hitsOn(miss.log, 2).length).toBe(0);
  });

  it("a target 6 m away: 25 damage, wet, dragged 14 ticks to 1.5 m in front of Water; immune 2 s after the tow", () => {
    const { s, log, start } = grabbed(solo([at(-6)]));
    const hit = hitsOn(log, 2);
    expect(hit.map(({ e }) => [e.ability, e.amount])).toEqual([["waterGrab", 25]]);
    const h = hit[0]!.t;
    expect(towOf(log)).toEqual([[h, "start"], [h + 14, "end"]]);
    const d = u(s, 2);
    expect(d.move.body.pos.z).toBeCloseTo(-1.5, 6);
    expect([statusFlags(d, start + h + 20).wet, d.status.immuneUntil]).toEqual([true, start + h + 15 + 120]);
  });

  it("pulls at most 7 m; Earth and immunity halve it, together a quarter; an anchored target is hit but not pulled", () => {
    const pulled = (o: Setup, id: UnitId = 2) => u(grabbed(o).s, id).move.body.pos.z;
    expect(pulled(solo([at(-12)]))).toBeCloseTo(-5, 6);
    const earth = { mages: [water(), { element: "earth" as const, spawn: spot(0, -12) }] };
    expect(pulled(earth)).toBeCloseTo(-8.5, 6);
    expect(pulled({ ...solo([at(-12)]), prep: (s) => void (u(s, 2).status.immuneUntil = s.tick + 600) })).toBeCloseTo(-8.5, 6);
    expect(pulled({ ...earth, prep: (s) => void (u(s, 2).status.immuneUntil = s.tick + 600) })).toBeCloseTo(-10.25, 6);
    // другая Вода спиной к нам ставит диск: жгут сзади не впитан, урон проходит, якорь не даёт тащить
    const anchored = grabbed({ mages: [water(), water(spot(0, -12))] }, 60, (k) => ({ 2: { e: k === 10 } }));
    expect([hitsOn(anchored.log, 2).map(({ e }) => e.amount), evs(anchored.log, "absorb").length, evs(anchored.log, "tow").length]).toEqual([[25], 0, 0]);
    expect(u(anchored.s, 2).move.body.pos.z).toBeCloseTo(-12, 6);
  });

  it("a wall stops the tow; the target's jet dash breaks it", () => {
    const low = testContext([{ box: aabb(-1, 0, -6, 1, 1, -5.8), tag: "wall" }]);
    const w = grabbed(solo([at(-10)], low));
    expect([hitsOn(w.log, 2).length, towOf(w.log).map(([, p]) => p)]).toEqual([1, ["start", "end"]]);
    expect(u(w.s, 2).move.body.pos.z).toBeCloseTo(-6.4, 6);

    const towStart = evs(grabbed({ mages: [water(), { element: "fire", spawn: spot(0, -10) }] }).log, "tow")[0]!.t;
    const broke = grabbed({ mages: [water(), { element: "fire", spawn: spot(0, -10) }] }, 90, (k) => ({ 2: { e: k === towStart + 3, moveX: k === towStart + 3 ? 1 : 0 } }));
    const kinds = broke.log.filter(({ e }) => e.type === "tow" || (e.type === "dash" && e.phase === "start")).map(({ t, e }) => [t, e.type]);
    expect(kinds).toEqual([[towStart, "tow"], [towStart + 3, "tow"], [towStart + 3, "dash"]]);
    expect(u(broke.s, 2).move.body.pos.z).toBeLessThan(-6);
  });

  it("Water 1 m from the gap pulls a target across it: the target drops, the fall is Water's", () => {
    const { log } = grabbed({ mages: [water(spot(19, 0, EAST))], dummies: [{ pos: { x: 25, y: 0, z: 0 }, yaw: 0 }], c: GAP }, 120);
    const end = evs(log, "tow").find(({ e }) => e.phase === "end")!;
    expect(end.e.pos.x).toBeCloseTo(20.5, 6);
    expect(evs(log, "fall").map(({ e }) => [e.target, e.credit])).toEqual([[2, 1]]);
  });

  it("Water 6 m from the gap, the target 14 m away across it: the 7 m tow ends at the last point with ground, no fall", () => {
    const { s, log } = grabbed({ mages: [water(spot(14, 0, EAST))], dummies: [{ pos: { x: 28, y: 0, z: 0 }, yaw: 0 }], c: GAP }, 120);
    const d = u(s, 2);
    expect([hitsOn(log, 2).length, evs(log, "fall").length, d.alive, d.move.onGround]).toEqual([1, 0, true, true]);
    expect([d.move.body.pos.x, d.move.body.pos.y]).toEqual([expect.closeTo(24, 6), 0]);
  });
});

describe("Water ward (E)", () => {
  /** Вода в HOME ставит диск на k = 0; стрелки перед ней смотрят на неё. */
  const shooter = (element: Element, x: number, z: number) => ({ element, spawn: spot(x, z, yawTo(x, z, 0, 0)) });

  it("eats fists, a stone and a fireball from the front: no damage, no explosion; from behind — damage", () => {
    const { s, log } = play(
      { mages: [water(), shooter("fire", -2, -10), shooter("earth", 2, -10)] }, 59,
      (k) => ({ 1: { e: k === 0 }, 2: { q: k === 0, primary: k > 0 && k < 30 }, 3: { primary: k === 0 } }),
    );
    const kinds = new Set(evs(log, "absorb").map(({ e }) => e.kind));
    expect([[...kinds].sort(), hitsOn(log, 1).length, evs(log, "explosion").length]).toEqual([["fireFists", "fireball", "stoneShot"], 0, 0]);
    const total = evs(log, "absorb").reduce((a, { e }) => a + e.amount, 0);
    expect([u(s, 1).mage!.ward!.absorbed, evs(log, "absorb").at(-1)!.e.total]).toEqual([total, total]);

    const back = play({ mages: [water(), shooter("fire", 0, 10)] }, 40, (k) => ({ 1: { e: k === 0 }, 2: { primary: k === 0 } }));
    expect([evs(back.log, "absorb").length, hitsOn(back.log, 1).map(({ e }) => [e.ability, e.amount])]).toEqual([0, [["fireFists", 15]]]);
  });

  it("a shot travelling exactly sideways (velocity · forward = 0) is not met by the ward: it hits", () => {
    const { s } = play(solo([]), 1, (k) => ({ 1: { e: k === 0 } }));
    const w = u(s, 1);
    // взгляд (0, −1): поперёк — ровно 0, не «против взгляда»; встречный (0, +1) — диск
    expect([wardFaces(w, { x: 1, z: 0 }, s.tick), wardFaces(w, { x: -1, z: 0 }, s.tick), wardFaces(w, { x: 0, z: 1 }, s.tick)]).toEqual([false, false, true]);
    const side = play({ mages: [water(), shooter("fire", -10, 0)] }, 40, (k) => ({ 1: { e: k === 0 }, 2: { primary: k === 0 } }));
    expect([evs(side.log, "absorb").length, hitsOn(side.log, 1).map(({ e }) => [e.ability, e.amount])]).toEqual([0, [["fireFists", 15]]]);
  });

  it("anchors Water for the ward: no push, launch, tow or pull; damage, slow and the earthquake root still land", () => {
    const { s, log, start } = play({ mages: [water(), { element: "earth", spawn: spot(0, -2.5, Math.PI) }] }, 40, (k) => ({ 1: { e: k === 0 }, 2: { c: k === 0 } }));
    const w = u(s, 1);
    expect([w.status.anchoredUntil, pullMul(w, s.tick)]).toEqual([start + 60, 0]);
    expect(hitsOn(log, 1).map(({ t, e }) => [t, e.ability, e.amount, e.knock])).toEqual([[24, "earthquake", 40, { distM: 0, upM: 0 }]]);
    expect(evs(log, "status").filter(({ e }) => e.target === 1).map(({ e }) => e.status)).toEqual(expect.arrayContaining(["root", "slow"]));
    const ev: MatchEvent[] = [];
    applyHit(s, tickOf(s, ev), { source: 2, target: 1, ability: "fireball", damage: 10, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 1 }, knock: { distM: 4, upM: 1.5 }, launch: true, tow: { x: 0, z: 5, speed: 20, ticks: 20 } });
    const r = stepMatch(s, {}, ctx);
    const after = u(r.state, 1);
    expect([after.tow, after.status.airborne, after.kb, after.move.body.pos.x, after.move.body.pos.z]).toEqual([null, false, { x: 0, z: 0 }, 0, 0]);
  });

  it("runs at ×0.7 under the ward, then back to 6.5", () => {
    const speeds: number[] = [];
    play(solo([]), 120, (k) => ({ 1: { e: k === 0, moveZ: 1 } }), (_k, s) => speeds.push(-u(s, 1).move.body.vel.z));
    expect([speeds[50], speeds[119]]).toEqual([expect.closeTo(6.5 * 0.7, 6), expect.closeTo(6.5, 6)]);
  });

  it("LMB drops it early: the Answer carries the absorbed 15 raised to 20, wets the target, counts as the ward; no extra whip", () => {
    const { s, log, start } = play(
      { mages: [water(), shooter("fire", 0, -10)] }, 80,
      // клик держится 6 тиков, как настоящий: удержание после Ответа не начинает лишний хлыст
      (k) => ({ 1: { e: k === 0, primary: k >= 30 && k < 36 }, 2: { primary: k === 0 } }),
    );
    expect(evs(log, "absorb").map(({ e }) => [e.kind, e.amount])).toEqual([["fireFists", 15]]);
    expect(evs(log, "release").filter(({ e }) => e.unit === 1).map(({ t, e }) => [t, e.ability])).toEqual([[30, "waterWard"]]);
    expect(evs(log, "ward").map(({ t, e }) => [t, e.phase, e.absorbed])).toEqual([[0, "up", 0], [30, "down", 15]]);
    expect([ticksOf(log, "cast", "waterWhip"), u(s, 1).status.anchoredUntil]).toEqual([[], start + 30]);
    expect(hitsOn(log, 2).map(({ e }) => [e.ability, e.amount, e.source])).toEqual([["waterWard", 20, 1]]);
    expect(statusFlags(u(s, 2), s.tick).wet).toBe(true);
  });

  it("a second without anything absorbed — no Answer; three fireballs — 60 by the cap", () => {
    const idle = play(solo([]), 70, (k) => ({ 1: { e: k === 0 } }));
    expect([evs(idle.log, "ward").map(({ t, e }) => [t, e.phase]), evs(idle.log, "release").length, idle.s.projectiles]).toEqual([[[0, "up"], [60, "down"]], 0, []]);

    const big = play(
      { mages: [water(), shooter("fire", -3, -10), shooter("fire", 0, -10), shooter("fire", 3, -10)] }, 90,
      (k) => ({ 1: { e: k === 0 }, 2: { q: k === 0 }, 3: { q: k === 0 }, 4: { q: k === 0 } }),
    );
    expect([evs(big.log, "absorb").length, evs(big.log, "ward").at(-1)!.e.absorbed]).toEqual([3, 150]);
    expect(hitsOn(big.log, 3).map(({ e }) => [e.ability, e.amount])).toEqual([["waterWard", 60]]);
  });

  it("another Water's ward eats the Answer and answers back (ping-pong)", () => {
    const { log } = play(
      { mages: [water(), water(spot(0, -10, Math.PI))] }, 150,
      (k) => ({ 1: { e: k === 0, primary: k === 40 }, 2: { q: k === 0, e: k === 35 } }),
    );
    expect(evs(log, "absorb").map(({ e }) => [e.unit, e.kind, e.owner, e.amount])).toEqual([[1, "waterGrab", 2, 25], [2, "waterAnswer", 1, 25]]);
    expect(hitsOn(log, 1).map(({ t, e }) => [t > 95, e.ability, e.amount, e.source])).toEqual([[true, "waterWard", 25, 2]]);
  });

  it("E pressed in the grab windup waits in the buffer and casts right after the release", () => {
    const { log } = play(solo([]), 30, (k) => ({ 1: { q: k === 0, e: k === 5 } }));
    expect([ticksOf(log, "release", "waterGrab"), ticksOf(log, "cast", "waterWard"), evs(log, "reject").length]).toEqual([[15], [16], 0]);
  });

  it("under the ward a held LMB is silent and Q is busy; whipping resumes when it drops", () => {
    const { log } = play(solo([]), 70, (k) => ({ 1: { e: k === 0, primary: true, q: k === 5 } }));
    expect([ticksOf(log, "cast", "waterWhip"), ticksOf(log, "cast", "waterGrab")]).toEqual([[60], []]);
    // диск не снимется за 0,3 с: отказ сразу, на тике нажатия, а не через 18 тиков ожидания
    expect(evs(log, "reject").map(({ t, e }) => [t, e.slot, e.reason])).toEqual([[0, "primary", "busy"], [5, "q", "busy"]]);
  });

  it("a Q pressed in the ward's last 0.3 s waits and casts as it drops; 19 ticks before — rejects at once", () => {
    const late = play(solo([]), 70, (k) => ({ 1: { e: k === 0, q: k === 42 } }));
    expect([ticksOf(late.log, "cast", "waterGrab"), evs(late.log, "reject").length]).toEqual([[60], 0]);
    const early = play(solo([]), 70, (k) => ({ 1: { e: k === 0, q: k === 41 } }));
    expect([ticksOf(early.log, "cast", "waterGrab"), evs(early.log, "reject").map(({ t, e }) => [t, e.slot, e.reason])]).toEqual([[], [[41, "q", "busy"]]]);
  });
});

describe("Water spring (C)", () => {
  /** Взгляд почти под ноги: Родник встаёт вокруг самой Воды. */
  const DOWN = -1.4;

  it("refuses over the void; otherwise telegraphs 0.4 s and lives 6 s; cooldown 14 s", () => {
    const v = play({ mages: [water(spot(15, 0, EAST))] }, 1, () => ({ 1: { c: true } }));
    expect(evs(v.log, "reject").map(({ e }) => [e.slot, e.reason])).toEqual([["c", "noTarget"]]);
    const { s, log, start } = play(solo([]), 400, (k) => ({ 1: { c: k === 0 || k === 100, pitch: DOWN } }));
    expect(evs(log, "zone").filter(({ e }) => e.kind === "spring").map(({ t, e }) => [t, e.phase])).toEqual([[0, "telegraph"], [24, "arm"], [384, "end"]]);
    expect([u(s, 1).mage!.ready.c, evs(log, "reject").map(({ t, e }) => [t, e.reason])]).toEqual([start + 840, [[100, "cooldown"]]]);
  });

  it("heals Water 12 HP/s in pulses of 3 up to full, keeps her wet and puts out her burning", () => {
    const { s, log } = play(
      {
        ...solo([]),
        prep: (st) => {
          u(st, 1).hp = 120;
          Object.assign(u(st, 1).status, { burnPulses: 6, burnNext: st.tick + 30, burnBy: NOBODY });
        },
      },
      200, (k) => ({ 1: { c: k === 0, pitch: DOWN } }),
    );
    const heals = evs(log, "heal");
    expect(heals.map(({ t, e }) => [t, e.amount])).toEqual(Array.from({ length: 10 }, (_, k) => [24 + 15 * k, 3]));
    const w = u(s, 1);
    expect([w.hp, w.status.burnPulses, statusFlags(w, s.tick).wet, hitsOn(log, 1).length]).toEqual([150, 0, true, 0]);
    expect(evs(log, "status").filter(({ e }) => e.status === "wet").map(({ t }) => t)).toEqual([24]);
  });

  it("an enemy inside is wet and runs at 0.7; the slow ends 0.5 s after it leaves", () => {
    let last = -1;
    const speeds: number[] = [];
    const { s, start } = play(
      { mages: [water(), { element: "fire", spawn: spot(0, -8) }] }, 140,
      (k) => ({ 1: { c: k === 0, pitch: Math.atan2(0.5 - 1.6, 8) }, 2: { moveZ: k >= 30 ? 1 : 0 } }),
      (k, st) => {
        const p = u(st, 2).move.body.pos;
        if (Math.hypot(p.x, p.z + 8) <= 4) last = st.tick - 1;
        if (k === 40) speeds.push(-u(st, 2).move.body.vel.z);
      },
    );
    const f = u(s, 2);
    expect([speeds[0], f.status.slowUntil, f.status.slowMul, f.status.wetUntil]).toEqual([expect.closeTo(6.5 * 0.7, 6), last + 30, 1, last + 180]);
    expect([last > start + 30, s.tick > last + 30]).toEqual([true, true]);
  });

  it("a new spring replaces the old one", () => {
    const { s, log } = play(solo([]), 60, (k, st) => {
      if (k === 40) u(st, 1).mage!.ready.c = st.tick;
      return { 1: { c: k === 0 || k === 40, pitch: DOWN } };
    });
    const z = evs(log, "zone").filter(({ e }) => e.kind === "spring");
    expect(z.map(({ t, e }) => [t, e.phase])).toEqual([[0, "telegraph"], [24, "arm"], [40, "end"], [40, "telegraph"]]);
    expect(s.zones.filter((q) => q.kind === "spring").length).toBe(1);
  });
});

describe("Water and fire: steam", () => {
  it("a whip on a burning target puts it out and makes steam", () => {
    const { s, log } = play({ ...solo([at(-10)]), prep: (st) => void Object.assign(u(st, 2).status, { burnPulses: 6, burnNext: st.tick + 30, burnBy: NOBODY }) }, 20, (k) => ({ 1: { primary: k === 0 } }));
    expect([evs(log, "reaction").map(({ t, e }) => [t, e.kind, e.owner]), u(s, 2).status.burnPulses]).toEqual([[[7, "steam", 1]], 0]);
  });

  it("a fireball at a target standing in a spring: steam, no burning; the spring boils off", () => {
    const { s, log } = play(
      { mages: [water(), { element: "fire", spawn: spot(8, -8, Math.PI / 2) }], dummies: [at(-8)] }, 90,
      (k) => ({ 1: { c: k === 0, pitch: Math.atan2(0.5 - 1.6, 8) }, 2: { q: k === 30, pitch: Math.atan2(0.9 - 1.6, 8) } }),
    );
    const fb = hitsOn(log, 3).filter(({ e }) => e.ability === "fireball");
    expect([fb.length, evs(log, "reaction").map(({ e }) => [e.kind, e.owner]), u(s, 3).status.burnPulses, hitsOn(log, 3).filter(({ e }) => e.ability === "burning").length]).toEqual([1, [["steam", 2], ["boilOff", 2]], 0, 0]);
  });
});

describe("Water determinism", () => {
  /** Вода против Огня по сценарию: бег, стрейф, прыжки, все кнопки. */
  const script = (n: number, id: number): MatchInput => ({
    ...NO_MATCH_INPUT, moveZ: (n + id * 37) % 200 < 100 ? 1 : -1, moveX: n % 120 < 60 ? 1 : -1, jump: n % 90 === id, yaw: Math.sin(n / 50 + id) * 0.8 + (id === 2 ? Math.PI : 0), pitch: -0.1,
    primary: (n + id * 11) % 70 < 40, q: n % 150 === 10 * id, e: n % 170 === 20 * id, c: n % 230 === 30 * id,
  });
  function run(n: number): { s: MatchState; events: MatchEvent[] } {
    let s = createMatch({ mages: [water(), { element: "fire", spawn: spot(0, -12, Math.PI) }], dummies: [at(-6, 4)] });
    const events: MatchEvent[] = [];
    for (let k = 0; k < n; k++) {
      const r = stepMatch(deepFreeze(s), { 1: script(s.tick, 1), 2: script(s.tick, 2) }, ctx);
      s = r.state;
      events.push(...r.events);
    }
    return { s, events };
  }

  it("600 ticks of Water against Fire twice give byte-identical states and events", () => {
    const [a, b] = [run(600), run(600)];
    expect([JSON.stringify(a.s) === JSON.stringify(b.s), JSON.stringify(a.events) === JSON.stringify(b.events)]).toEqual([true, true]);
    const abilities = new Set(a.events.flatMap((e) => (e.type === "cast" && e.unit === 1 ? [e.ability] : [])));
    expect([...abilities].sort()).toEqual(["spring", "waterGrab", "waterWard", "waterWhip"]);
  });
});
