import { describe, expect, it } from "vitest";
import { deepFreeze, testContext } from "./fixtures";
import { createMatch, respawnMage, stepMatch } from "./match";
import { NO_MATCH_INPUT } from "./state";
import type { MatchEvent, MatchState } from "./types";

const ctx = testContext();
const setup = {
  mages: [{ element: "fire" as const, spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 } }],
  dummies: [{ pos: { x: 0, y: 0, z: -10 }, yaw: 0, patrolHalfM: 2 }, { pos: { x: 5, y: 0, z: -5 }, yaw: 0 }],
};

describe("match", () => {
  it("creates mages first, then dummies, with full HP", () => {
    expect(createMatch(setup).units.map((u) => [u.id, u.kind, u.hp])).toEqual([[1, "mage", 150], [2, "dummy", 170], [3, "dummy", 170]]);
  });

  it("advances one tick and never mutates its input", () => {
    const s0 = deepFreeze(createMatch(setup));
    const r = stepMatch(s0, { 1: { ...NO_MATCH_INPUT, moveZ: 1, primary: true, q: true } }, ctx);
    expect([r.state.tick, s0.tick, r.state === s0]).toEqual([1, 0, false]);
  });

  it("keeps plain data: a JSON copy steps exactly like the original", () => {
    let a: MatchState = createMatch(setup);
    for (let k = 0; k < 120; k++) a = stepMatch(a, { 1: { ...NO_MATCH_INPUT, moveX: 1, yaw: k / 40 } }, ctx).state;
    const b = JSON.parse(JSON.stringify(a)) as MatchState;
    const inp = { 1: { ...NO_MATCH_INPUT, moveZ: 1 } };
    expect(JSON.stringify(stepMatch(a, inp, ctx))).toBe(JSON.stringify(stepMatch(b, inp, ctx)));
  });

  it("a mage without input this tick keeps its look, stops and releases the buttons", () => {
    let s: MatchState = createMatch(setup);
    for (let k = 0; k < 30; k++) s = stepMatch(s, { 1: { ...NO_MATCH_INPUT, moveZ: 1, yaw: 1.2, pitch: -0.4, primary: true } }, ctx).state;
    const events: MatchEvent[] = [];
    for (let k = 0; k < 60; k++) {
      const r = stepMatch(s, {}, ctx);
      s = r.state;
      events.push(...r.events.filter((e) => e.type === "cast"));
    }
    const u = s.units[0]!;
    expect([u.move.yaw, u.move.pitch, u.mage!.held, Math.hypot(u.move.body.vel.x, u.move.body.vel.z) < 1e-6, events]).toEqual([
      1.2, -0.4, { primary: false, q: false, e: false, c: false }, true, [],
    ]);
  });

  it("respawnMage switches the element and keeps the counters", () => {
    const s = createMatch(setup);
    s.units[0]!.mage!.stats.kills = 3;
    const r = respawnMage(s, 1, "earth");
    expect([r.units[0]!.mage!.element, r.units[0]!.hp, r.units[0]!.mage!.stats.kills, s.units[0]!.mage!.element]).toEqual(["earth", 170, 3, "fire"]);
  });
});
