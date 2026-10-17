import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { stepStatuses } from "./combat";
import { buildTickWorld } from "./dynamic";
import { testContext } from "./fixtures";
import { createDummyUnit, createMageUnit, createMatchState, statusFlags } from "./state";
import { stepTerrain } from "./terrain";
import { NOBODY, type MatchContext, type MatchEvent, type MatchState, type TickCtx } from "./types";
import { moveUnits } from "./units";

const ctx = testContext();
function tickOf(s: MatchState, c: MatchContext, ev: MatchEvent[]): TickCtx {
  const tw = buildTickWorld(c.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: c.killBelowY, now: s.tick, ev };
}
const mage = () => createMageUnit(1, "fire", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
const dummy = (id: number, x: number, z: number) => createDummyUnit(id, { pos: { x, y: 0, z }, yaw: 0 });
const byId = (s: MatchState, id: number) => s.units.find((u) => u.id === id)!;
const EYE = { x: 0, y: 1.6, z: 0 };
const AHEAD = { x: 0, y: 0, z: -1 };
import { aimGround } from "./aim";

describe("aimGround", () => {
  const down8 = -Math.atan2(1.6, 8);
  const at = (s: MatchState, c: MatchContext, yaw: number, pitch: number, range: number) => aimGround(s, tickOf(s, c, []), 1, yaw, pitch, range);
  const round = (p: { x: number; y: number; z: number } | null) => p && [p.x, p.y, p.z].map((v) => Number(v.toFixed(6)));

  it("finds the floor under the crosshair, or the feet of a body on the way", () => {
    expect(round(at(createMatchState([mage()]), ctx, 0, down8, 20))).toEqual([0, 0, -8]);
    expect(at(createMatchState([mage(), dummy(2, 0, -6)]), ctx, 0, down8, 20)).toEqual({ x: 0, y: 0, z: -6 });
  });

  it("drops from the end of the range, or from a wall face, down to the ground", () => {
    expect(round(at(createMatchState([mage()]), ctx, 0, 0, 15))).toEqual([0, 0, -15]);
    const walled = testContext([{ box: aabb(-5, 0, -10.5, 5, 4, -10) }]);
    expect(round(at(createMatchState([mage()]), walled, 0, 0, 15))).toEqual([0, 0, -9.7]);
  });

  it("drops from below an overhang hit from underneath, not from inside it", () => {
    const slab = testContext([{ box: aabb(-10, 3, -30, 10, 3.5, -5) }]);
    expect(round(at(createMatchState([mage()]), slab, 0, Math.atan2(1.4, 8), 20))).toEqual([0, 0, -8]);
  });

  it("returns null over the void", () => {
    const s = createMatchState([createMageUnit(1, "fire", { pos: { x: 18, y: 0, z: 0 }, yaw: -Math.PI / 2 })]);
    expect(at(s, ctx, -Math.PI / 2, 0, 15)).toBeNull();
  });
});
