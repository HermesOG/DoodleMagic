import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { bodyBox } from "../body";
import { DEFAULT_MOVE, NO_INPUT, stepPlayer } from "../player";
import { TICK_DT } from "../types";
import { isFree, withDynamic } from "../world";
import { buildTickWorld } from "./dynamic";
import { testContext } from "./fixtures";
import { createDummyUnit, createMageUnit, createMatchState } from "./state";
import { damageTerrain, pushOut, spawnTerrain, stepTerrain, type TerrainSpec } from "./terrain";
import type { MatchEvent, MatchState, TickCtx } from "./types";

const ctx = testContext();
function tick(s: MatchState, now: number, ev: MatchEvent[] = []): TickCtx {
  const tw = buildTickWorld(ctx.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: ctx.killBelowY, now, ev };
}
const solidWorld = (s: MatchState) => buildTickWorld(ctx.world, s).world;
const WALL = aabb(-2, 0, -5.3, 2, 2.5, -4.7);
const PILLAR = aabb(-0.6, 0, -0.6, 0.6, 2.5, 0.6);
const WALL_SPEC: TerrainSpec = { growTicks: 18, solidTicks: 12, lifeTicks: 360, hp: 250 };
const PILLAR_SPEC: TerrainSpec = { growTicks: 6, solidTicks: 12, lifeTicks: 240, hp: 200 };
const mage = () => createMageUnit(1, "earth", { pos: { x: 10, y: 0, z: 10 }, yaw: 0 });
const dummy = (id: number, x: number, y: number, z: number) => createDummyUnit(id, { pos: { x, y, z }, yaw: 0 });
const phases = (ev: MatchEvent[]) => ev.flatMap((e) => (e.type === "terrain" ? [e.phase] : []));
const runTerrain = (s: MatchState, from: number, to: number, ev: MatchEvent[] = []) => {
  for (let now = from; now <= to; now++) stepTerrain(s, tick(s, now, ev));
};

describe("terrain", () => {
  it("is solid from solidTick, not before, and expires at endTick", () => {
    const s = createMatchState([mage()]);
    const ev: MatchEvent[] = [];
    spawnTerrain(s, tick(s, 0, ev), 1, "wall", WALL, WALL_SPEC);
    const probe = aabb(-0.2, 0.5, -5.1, 0.2, 1, -4.9);
    runTerrain(s, 0, 11, ev);
    expect(isFree(solidWorld(s), probe)).toBe(true);
    runTerrain(s, 12, 12, ev);
    expect(isFree(solidWorld(s), probe)).toBe(false);
    runTerrain(s, 13, 360, ev);
    expect([s.terrain.length, phases(ev)]).toEqual([0, ["rise", "solid", "expire"]]);
  });

  it("takes damage, reports it and breaks at zero", () => {
    const s = createMatchState([mage()]);
    const ev: MatchEvent[] = [];
    const id = spawnTerrain(s, tick(s, 0, ev), 1, "pillar", PILLAR, PILLAR_SPEC);
    damageTerrain(s, tick(s, 20, ev), id, 150, { x: 0, y: 1, z: 0.6 });
    expect(s.terrain[0]!.hp).toBe(50);
    damageTerrain(s, tick(s, 21, ev), id, 60, { x: 0, y: 1, z: 0.6 });
    expect([s.terrain.length, phases(ev)]).toEqual([0, ["rise", "hit", "hit", "break"]]);
  });

  it("keeps at most three pieces per mage, dropping the oldest", () => {
    const s = createMatchState([mage()]);
    const ev: MatchEvent[] = [];
    const ids = [0, 1, 2, 3].map((k) => spawnTerrain(s, tick(s, k, ev), 1, "pillar", aabb(k * 3, 0, 0, k * 3 + 1.2, 2.5, 1.2), PILLAR_SPEC));
    expect(s.terrain.map((t) => t.id)).toEqual(ids.slice(1));
    expect(ev).toContainEqual(expect.objectContaining({ type: "terrain", terrain: ids[0], phase: "expire" }));
  });

  it("pushes a body out of a wall that solidifies around it, the shortest free way", () => {
    const s = createMatchState([mage(), dummy(2, 0.5, 0, -5)]);
    spawnTerrain(s, tick(s, 0), 1, "wall", WALL, WALL_SPEC);
    runTerrain(s, 0, 12);
    const p = s.units[1]!.move.body.pos;
    expect(isFree(solidWorld(s), bodyBox(s.units[1]!.move.body))).toBe(true);
    expect([p.x, Math.abs(p.z + 5)].map((v) => Number(v.toFixed(6)))).toEqual([0.5, 0.7]);
  });

  it("lifts a body onto the top when that is shortest, without raising its flight", () => {
    const s = createMatchState([mage(), dummy(2, 0, 1.9, 0), dummy(3, 5, 1.5, 0)]);
    s.units[2]!.move.body.vel.y = 8;
    spawnTerrain(s, tick(s, 0), 1, "pillar", PILLAR, PILLAR_SPEC);
    spawnTerrain(s, tick(s, 0), 1, "pillar", aabb(4.4, 0, -0.6, 5.6, 2.5, 0.6), PILLAR_SPEC);
    runTerrain(s, 0, 12);
    expect([s.units[1]!.move.body.pos.y, s.units[1]!.move.onGround]).toEqual([2.5, true]);
    const flyer = s.units[2]!.move.body;
    expect(flyer.pos.y).toBe(2.5);
    expect(2.5 + (flyer.vel.y * flyer.vel.y) / 40).toBeCloseTo(1.5 + (8 * 8) / 40, 9); // вершина та же
  });
});

describe("push-out of a body that is already rising (Earth Q «под себя»)", () => {
  /**
   * Как в stepMatch: кит дал магу подъём vy = √(2g·2,8) и вырастил под ним столб со смещением offX; дальше тики
   * stepPlayer → stepTerrain. Столб твердеет через 12 тиков, когда ступни на ≈ 1,717 м и ещё летят вверх.
   */
  function selfLift(offX: number) {
    const s = createMatchState([createMageUnit(1, "earth", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 })]);
    const u = s.units[0]!;
    for (let k = 0; k < 5; k++) u.move = stepPlayer(u.move, NO_INPUT, TICK_DT, ctx.world);
    const T = 10;
    Object.assign(u.move, { onGround: false, coyote: 0 });
    u.move.body.vel.y = Math.sqrt(2 * DEFAULT_MOVE.gravity * 2.8);
    spawnTerrain(s, tick(s, T), 1, "pillar", aabb(offX - 0.6, 0, -0.6, offX + 0.6, 2.5, 0.6), PILLAR_SPEC);
    let feetAtSolid = NaN;
    for (let now = T + 1; now < T + 120; now++) {
      const t = tick(s, now);
      u.move = stepPlayer(u.move, NO_INPUT, TICK_DT, t.world);
      if (now === T + PILLAR_SPEC.solidTicks) feetAtSolid = u.move.body.pos.y;
      stepTerrain(s, t);
    }
    return { feetAtSolid, move: u.move };
  }

  it("lands an off-centre caster on top of its own pillar instead of shoving it aside", () => {
    for (const off of [0, 0.4, 0.8]) {
      const { feetAtSolid, move } = selfLift(off);
      expect(feetAtSolid).toBeCloseTo(1.717, 3);
      expect([Number(move.body.pos.x.toFixed(9)), move.body.pos.y, move.body.pos.z, move.onGround]).toEqual([0, 2.5, 0, true]);
    }
  });

  it("still takes the shortest way out for a standing, a falling or a slowly rising body", () => {
    const world = withDynamic(ctx.world, [{ box: PILLAR }]);
    const cases = [
      { y: 0, vy: 0, off: 0.4, want: [1, 0] }, // стоит: вбок 0,6 короче, чем вверх 2,5
      { y: 1.717, vy: -3, off: 0.4, want: [1, 1.717] }, // падает: вбок 0,6 короче, чем вверх 0,783
      { y: 1.717, vy: -3, off: 0, want: [0, 2.5] }, // падает по центру: вверх 0,783 короче, чем вбок 1
      { y: 1.717, vy: 2, off: 0.4, want: [1, 1.717] }, // взлетает всего на 0,1 м: вверх остаётся 0,683, вбок 0,6
    ];
    for (const c of cases) {
      const u = dummy(2, c.off, c.y, 0);
      u.move.body.vel.y = c.vy;
      expect(pushOut(world, u, PILLAR)).toBe(true);
      const p = u.move.body.pos;
      expect([Number(p.x.toFixed(9)), Number(p.y.toFixed(9)), p.z]).toEqual([...c.want, 0]);
      expect(isFree(world, bodyBox(u.move.body))).toBe(true);
    }
  });
});
