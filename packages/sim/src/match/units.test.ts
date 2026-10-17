import { describe, expect, it } from "vitest";
import { applyHit, stepStatuses, type HitSpec } from "./combat";
import { testContext } from "./fixtures";
import { NO_MATCH_INPUT, createDummyUnit, createMageUnit, createMatchState } from "./state";
import type { MatchInput, MatchState, TickCtx, Unit, UnitId } from "./types";
import { moveUnits, stepLife } from "./units";

const ctx = testContext();
const tickOf = (s: MatchState): TickCtx => ({ world: ctx.world, terrainIds: [], killBelowY: ctx.killBelowY, now: s.tick, ev: [] });
function step(s: MatchState, n: number, inputs: Partial<Record<UnitId, MatchInput>> = {}, each?: (s: MatchState) => void): void {
  for (let k = 0; k < n; k++) {
    const t = tickOf(s);
    moveUnits(s, t, inputs);
    stepStatuses(s, t);
    stepLife(s, t);
    s.tick += 1;
    each?.(s);
  }
}
const speed = (u: Unit) => Math.hypot(u.move.body.vel.x, u.move.body.vel.z);
const fwd: MatchInput = { ...NO_MATCH_INPUT, moveZ: 1 };
const withMage = () => createMatchState([createMageUnit(1, "fire", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }), createDummyUnit(2, { pos: { x: -10, y: 0, z: 10 }, yaw: 0 })]);
const onMage = (s: MatchState, over: Partial<HitSpec>) =>
  applyHit(s, tickOf(s), { source: 2, target: 1, ability: "earthquake", damage: 0, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 0 }, ...over });

describe("control", () => {
  it("slows a running mage by 40 % for 2 s", () => {
    const s = withMage();
    step(s, 60, { 1: fwd });
    expect(speed(s.units[0]!)).toBeCloseTo(6.5, 6);
    onMage(s, { slow: { mul: 0.6, s: 2 } });
    step(s, 30, { 1: fwd });
    expect(speed(s.units[0]!)).toBeCloseTo(6.5 * 0.6, 6);
    step(s, 120, { 1: fwd });
    expect(speed(s.units[0]!)).toBeCloseTo(6.5, 6);
  });

  it("roots for 0.5 s: no steps and no jump, then moves again", () => {
    const s = withMage();
    step(s, 5);
    onMage(s, { rootS: 0.5 });
    const z0 = s.units[0]!.move.body.pos.z;
    step(s, 30, { 1: { ...fwd, jump: true } });
    expect([Number((s.units[0]!.move.body.pos.z - z0).toFixed(9)), s.units[0]!.move.body.pos.y]).toEqual([0, 0]);
    step(s, 30, { 1: fwd });
    expect(s.units[0]!.move.body.pos.z).toBeLessThan(z0 - 1);
  });
});

describe("dummies", () => {
  it("strafe ±patrolHalfM along their right axis at 2 m/s, or stand still without a patrol", () => {
    const s = createMatchState([createDummyUnit(2, { pos: { x: -10, y: 0, z: 0 }, yaw: 0, patrolHalfM: 2 }), createDummyUnit(3, { pos: { x: -10, y: 0, z: 10 }, yaw: 0 })]);
    let lo = Infinity;
    let hi = -Infinity;
    let top = 0;
    step(s, 600, {}, (st) => {
      const b = st.units[0]!.move.body;
      [lo, hi, top] = [Math.min(lo, b.pos.x), Math.max(hi, b.pos.x), Math.max(top, Math.hypot(b.vel.x, b.vel.z))];
      expect(b.pos.z).toBeCloseTo(0, 9);
    });
    expect([lo < -11.8, lo > -12.15, hi > -8.2, hi < -7.85, top <= 2 + 1e-9]).toEqual([true, true, true, true, true]);
    expect(s.units[1]!.move.body.pos).toEqual({ x: -10, y: 0, z: 10 });
  });
});
