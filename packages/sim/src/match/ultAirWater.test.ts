import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import type { Spawn } from "../types";
import { createWorld } from "../world";
import { buildTickWorld } from "./dynamic";
import { testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { spawnProjectile } from "./projectiles";
import { NO_MATCH_INPUT, idleInput, unitById } from "./state";
import { spawnTerrain } from "./terrain";
import type { DummySpot, Element, MatchContext, MatchEvent, MatchInput, MatchState, TickCtx, UnitId } from "./types";
import { spawnZone } from "./zones";

/** Фаза 5, задача 3: «Ураган» Воздуха (Р8) и «Цунами» Воды (Р9) на X. */
const ctx = testContext();
const spot = (x: number, z: number, y = 0, yaw = 0): Spawn => ({ pos: { x, y, z }, yaw });
const at = (x: number, z: number, y = 0): DummySpot => ({ pos: { x, y, z }, yaw: 0 });
const mage = (element: Element, x: number, z: number, y = 0, yaw = 0) => ({ element, spawn: spot(x, z, y, yaw) });

function tickOf(s: MatchState, ev: MatchEvent[] = [], c: MatchContext = ctx): TickCtx {
  const tw = buildTickWorld(c.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: c.killBelowY, now: s.tick, ev, spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0, ultChargeMul: 1 };
}

type Log = { t: number; e: MatchEvent }[];
type Inputs = Partial<Record<UnitId, Partial<MatchInput>>>;
interface Setup {
  mages: { element: Element; spawn: Spawn }[];
  dummies?: DummySpot[];
  c?: MatchContext;
  /** Правка состояния после 5 тиков покоя, до первого шага. */
  prep?: (s: MatchState, t: TickCtx) => void;
  /** Перед шагом k: состояние можно менять (это свежая копия от stepMatch). */
  before?: (k: number, s: MatchState, t: TickCtx) => void;
}
/**
 * Маги (id 1…M) и манекены; 5 тиков покоя, у мага 1 — полный заряд ульты; затем n шагов. По умолчанию маг 1 жмёт X
 * на k = 0. Ввод без yaw и pitch — прежний взгляд. log и trace — по относительному тику k.
 */
function play(o: Setup, n: number, input: (k: number, s: MatchState) => Inputs = (k) => ({ 1: { x: k === 0 } })) {
  const c = o.c ?? ctx;
  let s = createMatch({ mages: o.mages, dummies: o.dummies ?? [] });
  for (let k = 0; k < 5; k++) s = stepMatch(s, {}, c).state;
  unitById(s, 1)!.mage!.ult.charge = 100;
  o.prep?.(s, tickOf(s, [], c));
  const start = s.tick;
  const log: Log = [];
  const trace: MatchState[] = [];
  for (let k = 0; k < n; k++) {
    o.before?.(k, s, tickOf(s, [], c));
    const inputs: Partial<Record<UnitId, MatchInput>> = {};
    for (const [id, i] of Object.entries(input(k, s))) inputs[Number(id)] = { ...idleInput(unitById(s, Number(id))!), ...i };
    const r = stepMatch(s, inputs, c);
    s = r.state;
    trace.push(s);
    for (const e of r.events) log.push({ t: k, e });
  }
  return { s, log, start, trace };
}
const evs = <K extends MatchEvent["type"]>(log: Log, type: K) => log.flatMap(({ t, e }) => (e.type === type ? [{ t, e: e as Extract<MatchEvent, { type: K }> }] : []));
const hitsBy = (log: Log, ability: string) => evs(log, "hit").filter(({ e }) => e.ability === ability);
const u = (s: MatchState, id: UnitId) => unitById(s, id)!;
const pos = (s: MatchState, id: UnitId) => u(s, id).move.body.pos;
const horiz = (s: MatchState, id: UnitId) => Math.sqrt(u(s, id).move.body.vel.x ** 2 + u(s, id).move.body.vel.z ** 2);
/** Сдвиг юнита по XZ от точки (x, z). */
const moved = (s: MatchState, id: UnitId, x: number, z: number) => ({ x: pos(s, id).x - x, z: pos(s, id).z - z });
const SHOT_WALL = { growTicks: 18, solidTicks: 30, lifeTicks: 600, hp: 250 };

describe("Air «Ураган» (X, Р8)", () => {
  it("winds up 48 ticks: Air runs ×0.5 and can't jump; then one strike on the release tick", () => {
    const r = play({ mages: [mage("air", 0, 0)], dummies: [at(0, -3)] }, 60, (k) => ({ 1: { x: k === 0, moveX: 1, jump: k === 20 || k === 30 } }));
    expect(evs(r.log, "cast").map(({ t, e }) => [t, e.ability, e.slot])).toEqual([[0, "hurricane", "x"]]);
    expect(evs(r.log, "ult").filter(({ e }) => e.phase !== "ready").map(({ t, e }) => [t, e.phase])).toEqual([[48, "release"], [49, "end"]]);
    expect(hitsBy(r.log, "hurricane").map(({ t, e }) => [t, e.target, e.amount])).toEqual([[48, 2, 60]]);
    expect(horiz(r.trace[40]!, 1)).toBeCloseTo(3.5, 9);
    expect(Math.max(...r.trace.slice(0, 48).map((s) => pos(s, 1).y))).toBeLessThan(0.01);
  });

  it("2 m: 60, «В воздухе», 14.4 m along the radius (the ult cap 18 doesn't cut it); 9 m: 8.8 m; 11 m and 5 m up: a miss", () => {
    const c = testContext([{ box: aabb(1, 4, -1, 3, 5, 1) }]);
    const r = play({ mages: [mage("air", 0, 0)], dummies: [at(0, -2), at(-9, 0), at(0, 11), at(2, 0, 5)], c }, 260);
    const hits = hitsBy(r.log, "hurricane");
    expect(hits.map(({ t, e }) => [t, e.target, e.amount, e.dir])).toEqual([[48, 2, 60, { x: 0, y: 0, z: -1 }], [48, 3, 60, { x: -1, y: 0, z: 0 }]]);
    expect(hits[0]!.e.knock.distM).toBeCloseTo(16 * 0.9, 9);
    expect(hits[0]!.e.knock.upM).toBe(2);
    expect(hits[1]!.e.knock.distM).toBeCloseTo(8.8, 9);
    expect(evs(r.log, "status").filter(({ e }) => e.status === "airborne").map(({ t, e }) => [t, e.target, e.source])).toEqual([[48, 2, 1], [48, 3, 1]]);
    const m2 = moved(r.s, 2, 0, -2);
    expect(Math.abs(m2.z + 14.4)).toBeLessThan(0.5);
    expect(Math.abs(m2.x)).toBeLessThan(0.05);
    expect(Math.abs(moved(r.s, 3, -9, 0).x + 8.8)).toBeLessThan(0.5);
    expect([u(r.s, 4).hp, u(r.s, 5).hp]).toEqual([170, 170]);
  });

  it("Earth flies half; an immune dummy the full 14.4 m but 1 m up and not «В воздухе»; Water under her ward takes 60 and stays", () => {
    const r = play(
      { mages: [mage("air", 0, 0), mage("earth", 0, -2), mage("water", 2, 0)], dummies: [at(-2, 0)], prep: (s) => void (u(s, 4).status.immuneUntil = s.tick + 1000) },
      240,
      (k) => ({ 1: { x: k === 0 }, 3: { e: k === 20 } }),
    );
    const hits = hitsBy(r.log, "hurricane");
    expect(hits.map(({ t, e }) => [t, e.target, e.amount])).toEqual([[48, 2, 60], [48, 3, 60], [48, 4, 60]]);
    const [earth, water, dummy] = hits.map(({ e }) => e.knock);
    expect([earth!.distM, earth!.upM]).toEqual([expect.closeTo(7.2, 9), 1]);
    expect(water).toEqual({ distM: 0, upM: 0 });
    expect([dummy!.distM, dummy!.upM]).toEqual([expect.closeTo(14.4, 9), 1]);
    expect(evs(r.log, "status").filter(({ e }) => e.status === "airborne").map(({ e }) => e.target)).toEqual([2]);
    expect(Math.abs(moved(r.s, 2, 0, -2).z + 7.2)).toBeLessThan(0.35);
    expect(Math.abs(moved(r.s, 4, -2, 0).x + 14.4)).toBeLessThan(0.5);
    const w = moved(r.trace[60]!, 3, 2, 0);
    expect(Math.abs(w.x) + Math.abs(w.z)).toBeLessThan(1e-9);
  });

  it("blows out an enemy fireball and ends an enemy tornado; its own tornado and sickle stay; an enemy stone wall 6 m away breaks", () => {
    const ids: Record<string, number> = {};
    const r = play(
      {
        mages: [mage("air", 0, 0), mage("fire", -30, 30), mage("earth", -30, -30)],
        prep: (s, t) => {
          const disc = (x: number) => ({ type: "disc" as const, center: { x, y: 0, z: 0 }, radius: 5 });
          ids.own = spawnZone(s, t, { owner: 1, kind: "tornado", ability: "tornado", shape: disc(-8), bornTick: s.tick, armTick: s.tick, endTick: s.tick + 600 });
          ids.enemy = spawnZone(s, t, { owner: 2, kind: "tornado", ability: "tornado", shape: disc(8), bornTick: s.tick, armTick: s.tick, endTick: s.tick + 600 });
          ids.wall = spawnTerrain(s, t, 3, "wall", aabb(-2, 0, 5.7, 2, 2.5, 6.3), SHOT_WALL);
        },
        before: (k, s, t) => {
          if (k !== 48) return;
          ids.fireball = spawnProjectile(s, t, 2, "fireball", { x: 0, y: 1.5, z: -5 }, { x: 0, y: 0, z: -1 });
          ids.sickle = spawnProjectile(s, t, 1, "airSickle", { x: 1, y: 1.5, z: -4 }, { x: 0, y: 0, z: -1 });
        },
      },
      60,
    );
    expect(evs(r.log, "blown").map(({ t, e }) => [t, e.unit, e.projectile, e.kind, e.owner])).toEqual([[48, 1, ids.fireball, "fireball", 2]]);
    expect(evs(r.log, "explosion")).toEqual([]);
    expect(r.trace[48]!.projectiles.map((p) => p.id)).toEqual([ids.sickle]);
    expect(evs(r.log, "zone").filter(({ e }) => e.phase === "end").map(({ t, e }) => [t, e.zone])).toEqual([[48, ids.enemy]]);
    expect(r.s.zones.map((z) => z.id)).toEqual([ids.own]);
    expect(evs(r.log, "terrain").filter(({ e }) => e.terrain === ids.wall && e.phase !== "solid").map(({ t, e }) => [t, e.phase, e.amount])).toEqual([
      [48, "hit", 1000], [48, "break", 0],
    ]);
    expect(r.s.terrain).toEqual([]);
  });

  it("lifts Air ≈ 3 m and gives fresh 3 s of glide with jump held", () => {
    const c = testContext([{ box: aabb(-1, 0, -1, 1, 20, 1) }]);
    const r = play({ mages: [mage("air", 0, 0, 20)], c }, 320, (k) => ({ 1: { x: k === 0, jump: true, moveX: k >= 48 ? 1 : 0 } }));
    expect(r.trace[48]!.units[0]!.mage!.flight).toEqual({ doubleJumped: true, glideTicks: 0, gliding: false });
    const top = Math.max(...r.trace.map((s) => pos(s, 1).y));
    expect(top).toBeGreaterThan(22.8);
    expect(top).toBeLessThanOrEqual(23 + 1e-9);
    const glide = evs(r.log, "glide").filter(({ e }) => e.unit === 1);
    expect(glide.map(({ e }) => e.on)).toEqual([true, false]);
    expect(glide[0]!.t).toBeGreaterThan(48);
    expect(glide[1]!.t - glide[0]!.t).toBe(180);
  });

  it("a fall off a bridge is credited to Air: +6 to its charge", () => {
    const bridge: MatchContext = {
      world: createWorld([{ box: aabb(-40, -1, -2, 40, 0, 2), tag: "floor" }], [{ kind: "kill", box: aabb(-40, -30, -40, 40, -3, 40) }]),
      killBelowY: -30,
    };
    const r = play({ mages: [mage("air", 0, -1)], dummies: [at(0, 1)], c: bridge }, 160);
    expect(evs(r.log, "fall").map(({ e }) => [e.target, e.credit])).toEqual([[2, 1]]);
    expect(u(r.s, 1).mage!.ult.charge).toBeCloseTo(6, 9);
    expect(u(r.s, 1).mage!.stats.falls).toBe(1);
  });
});

describe("Water «Цунами» (X, Р9)", () => {
  it("raises the wave 2 m behind Water for 48 ticks, then rolls it 30 m along the look in 120 ticks", () => {
    const r = play({ mages: [mage("water", 0, 0)] }, 175);
    const zones = evs(r.log, "zone").filter(({ e }) => e.kind === "tsunami");
    const id = zones[0]!.e.zone;
    expect(zones.map(({ t, e }) => [t, e.zone, e.phase, e.owner])).toEqual([[0, id, "telegraph", 1], [48, id, "arm", 1], [168, id, "end", 1]]);
    expect(r.trace[0]!.units[0]!.mage!.ult.cast!.zone).toBe(id);
    const z0 = r.trace[0]!.zones[0]!;
    expect([z0.kind, z0.ability, z0.armTick - r.start, z0.endTick - r.start]).toEqual(["tsunami", "tsunami", 48, 168]);
    expect(z0.shape).toEqual({ type: "segment", a: { x: -7, y: 0, z: 2 }, b: { x: 7, y: 0, z: 2 }, halfW: 1 });
    const zAt = (k: number) => {
      const sh = r.trace[k]!.zones[0]!.shape;
      return sh.type === "segment" ? [sh.a.x, sh.a.z, sh.b.x, sh.b.z] : null;
    };
    expect(zAt(47)).toEqual([-7, 2, 7, 2]);
    expect(zAt(48)).toEqual([-7, 1.75, 7, 1.75]);
    expect(zAt(167)).toEqual([-7, -28, 7, -28]);
    expect(r.trace[168]!.zones).toEqual([]);
    expect(hitsBy(r.log, "tsunami")).toEqual([]); // Воду-хозяйку волна проходит насквозь

    // взгляд на +X: волна поперёк X (n = (0, 1)) и катится на восток от x = −12 до 18
    const e = play({ mages: [mage("water", -10, 0, 0, -Math.PI / 2)] }, 168);
    const sh = e.trace[167]!.zones[0]!.shape;
    if (sh.type !== "segment") throw new Error("segment");
    expect([sh.a.x, sh.a.z, sh.b.x, sh.b.z].map((v) => Number(v.toFixed(9)))).toEqual([18, -7, 18, 7]);
  });

  it("a dummy 10 m ahead: 80, wet, carried ≈ 10 m along the wave, hit once", () => {
    const r = play({ mages: [mage("water", 0, 0)], dummies: [at(0, -10)] }, 175);
    const hits = hitsBy(r.log, "tsunami");
    expect(hits.map(({ t, e }) => [t, e.source, e.target, e.amount, e.dir])).toEqual([[90, 1, 2, 80, { x: 0, y: 0, z: -1 }]]);
    expect(hits[0]!.e.knock).toEqual({ distM: 10, upM: 1 });
    expect(evs(r.log, "status").filter(({ e }) => e.status === "wet").map(({ t, e }) => [t, e.target])).toEqual([[90, 2]]);
    expect(Math.abs(moved(r.s, 2, 0, -10).z + 10)).toBeLessThan(0.5);
    expect(u(r.s, 2).hp).toBe(170 - 80);
  });

  it("misses a dummy behind a box from the start line and one 3 m up; hits one beside the box and one 2.25 m up", () => {
    const c = testContext([{ box: aabb(-1, 0, -5, 1, 3, -4) }, { box: aabb(-6, 0, -9, -2, 3, -7) }, { box: aabb(5, 0, -9, 7, 2.25, -7) }]);
    const r = play({ mages: [mage("water", 0, 0)], dummies: [at(0, -8), at(-4, -8, 3), at(3, -8), at(6, -8, 2.25)], c }, 170);
    expect(hitsBy(r.log, "tsunami").map(({ e }) => e.target)).toEqual([4, 5]);
  });

  it("a burning dummy: the burn goes out and steam rises, Water's", () => {
    const r = play(
      {
        mages: [mage("water", 0, 0), mage("fire", -30, 30)],
        dummies: [at(0, -4)],
        before: (k, s) => void (k === 50 && Object.assign(u(s, 3).status, { burnPulses: 6, burnNext: s.tick + 30, burnBy: 2 })),
      },
      80,
    );
    const hit = hitsBy(r.log, "tsunami");
    expect(hit.map(({ t, e }) => [t, e.target])).toEqual([[66, 3]]);
    expect(u(r.trace[66]!, 3).status.burnPulses).toBe(0);
    expect(evs(r.log, "reaction").map(({ t, e }) => [t, e.kind, e.owner])).toEqual([[66, "steam", 1]]);
  });

  it("puts out an enemy fire wall and dash trail on its way: zone end and steam, Water's", () => {
    const ids: Record<string, number> = {};
    const r = play(
      {
        mages: [mage("water", 0, 0), mage("fire", -30, 30)],
        prep: (s, t) => {
          ids.wall = spawnZone(s, t, { owner: 2, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: aabb(-5, 0, -6.3, 5, 2.5, -5.7) }, bornTick: s.tick, armTick: s.tick, endTick: s.tick + 600 });
          ids.trail = spawnZone(s, t, { owner: 2, kind: "fireTrail", ability: "jetDash", shape: { type: "segment", a: { x: 3, y: 0, z: -10 }, b: { x: 5, y: 0, z: -10 }, halfW: 0.75 }, bornTick: s.tick, armTick: s.tick, endTick: s.tick + 600 });
        },
      },
      120,
    );
    const ends = evs(r.log, "zone").filter(({ e }) => e.phase === "end" && (e.zone === ids.wall || e.zone === ids.trail));
    expect(ends.map(({ t, e }) => [t, e.zone])).toEqual([[75, ids.wall], [91, ids.trail]]);
    expect(evs(r.log, "reaction").map(({ t, e }) => [t, e.kind, e.owner, e.pos])).toEqual([
      [75, "steam", 1, { x: 0, y: 0, z: -6 }], [91, "steam", 1, { x: 4, y: 0, z: -10 }],
    ]);
  });

  it("Earth is carried 5 m", () => {
    const r = play({ mages: [mage("water", 0, 0), mage("earth", 0, -10)] }, 175);
    const hits = hitsBy(r.log, "tsunami");
    expect(hits.map(({ e }) => [e.target, e.amount, e.knock])).toEqual([[2, 80, { distM: 5, upM: 0.5 }]]);
    expect(Math.abs(moved(r.s, 2, 0, -10).z + 5)).toBeLessThan(0.35);
  });
});

describe("phase 5 Air and Water ults: determinism", () => {
  it("600 ticks of Air and Water casting their ults at Fire give byte-identical runs", () => {
    const run = () => {
      let s = createMatch({ mages: [mage("air", -4, 0), mage("water", 4, 0), mage("fire", 0, -6)], dummies: [at(0, 6)] });
      const c: MatchContext = { ...ctx, ultChargeMul: 10 };
      const out: MatchEvent[][] = [];
      for (let t = 0; t < 600; t++) {
        if (t % 150 === 0) for (const x of s.units) if (x.mage) x.mage.ult.charge = 100; // s — своя копия от stepMatch
        const ins: Partial<Record<UnitId, MatchInput>> = {};
        for (let id = 1; id <= 3; id++) {
          ins[id] = { ...NO_MATCH_INPUT, x: t % 150 === 10 * id, moveZ: (t >> 5) % 2 === 0 ? 1 : -1, yaw: id + t * 0.01, jump: t % 90 > 60, primary: t % 40 < 3 };
        }
        const r = stepMatch(s, ins, c);
        s = r.state;
        out.push(r.events);
      }
      const casts = out.flat().filter((e) => e.type === "cast" && e.slot === "x").length;
      return { json: JSON.stringify({ s, out }), casts, hits: out.flat().filter((e) => e.type === "hit" && (e.ability === "hurricane" || e.ability === "tsunami")).length };
    };
    const a = run();
    expect(a.json).toBe(run().json);
    expect(a.casts).toBeGreaterThanOrEqual(4);
    expect(a.hits).toBeGreaterThan(0);
  });
});
