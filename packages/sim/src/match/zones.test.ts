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
import { spawnZone, stepZones, type NewZone } from "./zones";

function step(s: MatchState, n: number, each?: (s: MatchState) => void): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (let k = 0; k < n; k++) {
    const t = tickOf(s, ctx, ev);
    moveUnits(s, t, {});
    stepZones(s, t);
    stepTerrain(s, t);
    stepStatuses(s, t);
    s.tick += 1;
    each?.(s);
  }
  return ev;
}
const zone = (s: MatchState, z: NewZone, ev: MatchEvent[] = []) => spawnZone(s, tickOf(s, ctx, ev), z);
const hitsOn = (ev: MatchEvent[], id: number) => ev.flatMap((e) => (e.type === "hit" && e.target === id && !e.dot ? [e] : []));
const wallZone = (box: ReturnType<typeof aabb>): NewZone => ({ owner: 1, kind: "fireWall", ability: "fireWall", shape: { type: "box", box }, bornTick: 0, armTick: 24, endTick: 324 });
const pillarZone = (box: ReturnType<typeof aabb>, born: number): NewZone => ({ owner: 1, kind: "pillar", ability: "stonePillar", shape: { type: "box", box }, bornTick: born, armTick: born + 36, endTick: born + 37 });

describe("zones", () => {
  it("fire wall: arms after 0.4 s, 30 + burning on contact, again after 1 s inside", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10)]);
    const id = zone(s, wallZone(aabb(-5, 0, -10.3, 5, 2.5, -9.7)));
    expect(hitsOn(step(s, 24), 2)).toHaveLength(0);
    const ev = step(s, 61);
    expect([hitsOn(ev, 2).map((e) => e.amount), byId(s, 2).status.burnPulses > 0]).toEqual([[30, 30], true]);
    expect(ev).toContainEqual(expect.objectContaining({ type: "zone", zone: id, phase: "arm" }));
  });

  it("fire trail: 3 damage every 0.5 s to bodies along the segment", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10), dummy(3, 0, -12)]);
    zone(s, { owner: 1, kind: "fireTrail", ability: "jetDash", shape: { type: "segment", a: { x: -3, y: 0, z: -10 }, b: { x: 3, y: 0, z: -10 }, halfW: 0.75 }, bornTick: 0, armTick: 0, endTick: 120 });
    const ev = step(s, 130);
    expect([hitsOn(ev, 2).reduce((a, e) => a + e.amount, 0), hitsOn(ev, 3).length]).toEqual([12, 0]);
  });

  it("pillar: strikes after 0.6 s for 35, launches to 3.5 m, leaves a solid pillar for 4 s", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10)]);
    zone(s, pillarZone(aabb(-0.6, 0, -10.6, 0.6, 2.5, -9.4), 0));
    let top = 0;
    const ev = step(s, 120, (st) => (top = Math.max(top, byId(st, 2).move.body.pos.y)));
    expect(hitsOn(ev, 2)).toEqual([expect.objectContaining({ ability: "stonePillar", amount: 35 })]);
    expect(ev).toContainEqual(expect.objectContaining({ type: "status", target: 2, status: "airborne" }));
    expect(top).toBeCloseTo(3.5, 1);
    expect(s.terrain).toEqual([expect.objectContaining({ kind: "pillar", solid: true, solidTick: 48, endTick: 36 + 240, hp: 200 })]);
    step(s, 200);
    expect(s.terrain).toHaveLength(0);
  });

  it("pillar underfoot lifts its caster onto it without hurting", () => {
    const s = createMatchState([mage()]);
    step(s, 5);
    zone(s, pillarZone(aabb(-0.6, 0, -0.6, 0.6, 2.5, 0.6), s.tick));
    expect(step(s, 120).some((e) => e.type === "hit")).toBe(false);
    expect([s.units[0]!.move.onGround, Number(s.units[0]!.move.body.pos.y.toFixed(6))]).toEqual([true, 2.5]);
  });

  it("quake: 40 and a slow within 7 m, a root within 3 m, nothing for those in the air", () => {
    const s = createMatchState([mage(), dummy(2, 0, -2), dummy(3, 0, -5), dummy(4, 0, -8), dummy(5, 4, 0)]);
    step(s, 5);
    const air = byId(s, 5);
    Object.assign(air.move.body.pos, { y: 1 });
    air.move.body.vel.y = 4;
    air.move.onGround = false;
    zone(s, { owner: 1, kind: "quake", ability: "earthquake", shape: { type: "disc", center: { x: 0, y: 0, z: 0 }, radius: 7 }, bornTick: s.tick, armTick: s.tick, endTick: s.tick + 1 });
    const ev = step(s, 2);
    expect([2, 3, 4, 5].map((id) => hitsOn(ev, id).map((e) => e.amount))).toEqual([[40], [40], [], []]);
    expect(statusFlags(byId(s, 2), s.tick)).toMatchObject({ slowed: true, rooted: true });
    expect(statusFlags(byId(s, 3), s.tick)).toMatchObject({ slowed: true, rooted: false });
  });

  it("keeps at most three zones per mage", () => {
    const s = createMatchState([mage()]);
    const ev: MatchEvent[] = [];
    const ids = [0, 1, 2, 3].map((k) => zone(s, wallZone(aabb(k * 12, 0, -10, k * 12 + 10, 2.5, -9.4)), ev));
    expect(s.zones.map((z) => z.id)).toEqual(ids.slice(1));
    expect(ev).toContainEqual(expect.objectContaining({ type: "zone", zone: ids[0], phase: "end" }));
  });
});
