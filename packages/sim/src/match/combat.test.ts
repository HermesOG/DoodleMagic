import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { applyHit, knockbackSpeed, stepStatuses, type HitSpec } from "./combat";
import { DUMMY } from "./defs";
import { testContext } from "./fixtures";
import { createDummyUnit, createMageUnit, createMatchState } from "./state";
import { NOBODY, type MatchContext, type MatchEvent, type MatchState, type TickCtx, type Unit } from "./types";
import { moveUnits, stepLife } from "./units";

const ctx = testContext();
const tickOf = (c: MatchContext, now: number, ev: MatchEvent[]): TickCtx => ({ world: c.world, terrainIds: [], killBelowY: c.killBelowY, now, ev });
/** Тики без ввода в порядке stepMatch: движение, статусы, жизнь. */
function run(s: MatchState, c: MatchContext, ticks: number, each?: (s: MatchState) => void): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const t = tickOf(c, s.tick, ev);
    moveUnits(s, t, {});
    stepStatuses(s, t);
    stepLife(s, t);
    s.tick += 1;
    each?.(s);
  }
  return ev;
}
function settled(units: Unit[], c: MatchContext = ctx): MatchState {
  const s = createMatchState(units);
  run(s, c, 5);
  return s;
}
const mage = (el: "fire" | "earth" = "fire") => createMageUnit(1, el, { pos: { x: -30, y: 0, z: -30 }, yaw: 0 });
const dummy = (x: number, z = 0) => createDummyUnit(2, { pos: { x, y: 0, z }, yaw: 0 });
const u2 = (s: MatchState) => s.units.find((u) => u.id === 2)!;
const hit = (s: MatchState, ev: MatchEvent[], over: Partial<HitSpec>, c: MatchContext = ctx): number =>
  applyHit(s, tickOf(c, s.tick, ev), { source: 1, target: 2, ability: "fireball", damage: 0, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 1 }, ...over });
const topOf = (s: MatchState, n: number) => {
  let top = 0;
  run(s, ctx, n, (st) => (top = Math.max(top, u2(st).move.body.pos.y)));
  return top;
};

describe("knockback", () => {
  it("solves v0 = 6·distM on the floor and less when the target flies first", () => {
    expect(knockbackSpeed(3, 0)).toBeCloseTo(18, 9);
    expect(knockbackSpeed(3, 1.2)).toBeGreaterThan(4.5);
    expect(knockbackSpeed(3, 1.2)).toBeLessThan(8);
    expect(knockbackSpeed(0, 2)).toBe(0);
  });

  it("slides a target exactly distM, or launches it to upM and lands it about distM away", () => {
    const s = settled([mage(), dummy(-10)]);
    hit(s, [], { knock: { distM: 3, upM: 0 } });
    run(s, ctx, 150);
    expect(u2(s).move.body.pos.z).toBeCloseTo(3, 1);
    expect(u2(s).kb).toEqual({ x: 0, z: 0 });
    const f = settled([mage(), dummy(-10)]);
    hit(f, [], { knock: { distM: 3, upM: 1.2 } });
    expect(topOf(f, 150)).toBeCloseTo(1.2, 1);
    expect(Math.abs(u2(f).move.body.pos.z - 3)).toBeLessThan(0.35);
  });

  it("halves knockback on an Earth mage («Корни») and stops at a wall", () => {
    const s = settled([mage("fire"), createMageUnit(2, "earth", { pos: { x: -10, y: 0, z: 0 }, yaw: 0 })]);
    hit(s, [], { knock: { distM: 3, upM: 0 } });
    run(s, ctx, 150);
    expect(u2(s).move.body.pos.z).toBeCloseTo(1.5, 1);
    const walled = testContext([{ box: aabb(-12, 0, 1.5, -8, 3, 2) }]);
    const w = settled([mage(), dummy(-10)], walled);
    hit(w, [], { knock: { distM: 3, upM: 0 } }, walled);
    run(w, walled, 60);
    expect([Number(u2(w).move.body.pos.z.toFixed(6)), u2(w).kb.z]).toEqual([1.1, 0]);
  });
});

describe("falls and respawns", () => {
  it("drops a pushed target into the pit, credits the last hitter and brings it back in 3 s", () => {
    const s = settled([mage(), dummy(19)]);
    hit(s, [], { dir: { x: 1, z: 0 }, knock: { distM: 3, upM: 0 } });
    expect(run(s, ctx, 120)).toContainEqual(expect.objectContaining({ type: "fall", target: 2, credit: 1 }));
    expect([s.units[0]!.mage!.stats.falls, u2(s).alive]).toEqual([1, false]);
    expect(run(s, ctx, 181)).toContainEqual(expect.objectContaining({ type: "respawn", target: 2 }));
    expect([u2(s).alive, u2(s).hp, Number(u2(s).move.body.pos.x.toFixed(6))]).toEqual([true, DUMMY.hp, 19]);
  });

  it("credits the last hitter for 5 s and nobody after that", () => {
    for (const [ago, credit] of [[300, 1], [301, NOBODY]] as const) {
      const s = settled([mage(), dummy(-10)]);
      Object.assign(u2(s), { lastHitBy: 1, lastHitTick: s.tick - ago });
      u2(s).move.body.pos = { x: 25, y: -5, z: 0 };
      const ev: MatchEvent[] = [];
      stepLife(s, tickOf(ctx, s.tick, ev));
      expect(ev).toContainEqual(expect.objectContaining({ type: "fall", target: 2, credit }));
    }
  });
});

describe("statuses", () => {
  it("airborne: no control for 0.3 s, +15 % damage until landing, then 2 s of immunity", () => {
    const s = settled([mage(), dummy(-10)]);
    const ev: MatchEvent[] = [];
    const t0 = s.tick;
    hit(s, ev, { knock: { distM: 1, upM: 3.5 }, launch: true });
    expect(u2(s).status).toMatchObject({ airborne: true, noControlUntil: t0 + 18, immuneUntil: t0 + 18 + 120 });
    expect(ev).toContainEqual(expect.objectContaining({ type: "status", target: 2, status: "airborne", ticks: 18 }));
    run(s, ctx, 10);
    expect(hit(s, ev, { damage: 12 })).toBeCloseTo(13.8, 9);
    run(s, ctx, 90);
    expect([u2(s).status.airborne, hit(s, ev, { damage: 12 })]).toEqual([false, 12]);
    hit(s, ev, { knock: { distM: 0, upM: 3.5 }, launch: true }); // ещё в иммунитете: подброс вполсилы, без статуса
    expect(u2(s).status.airborne).toBe(false);
    expect(topOf(s, 60)).toBeCloseTo(1.75, 1);
  });

  it("burning: 6/s for 3 s in pulses of 3; a refresh extends it without stacking", () => {
    const once = settled([mage(), dummy(-10)]);
    hit(once, [], { burn: true });
    const pulses = run(once, ctx, 200).filter((e) => e.type === "hit" && e.dot);
    expect(u2(once).hp).toBeCloseTo(DUMMY.hp - 18, 9);
    expect(pulses).toHaveLength(6);
    expect(pulses.every((e) => e.type === "hit" && e.amount === 3 && e.ability === "burning" && e.source === 1)).toBe(true);
    const twice = settled([mage(), dummy(-10)]);
    hit(twice, [], { burn: true });
    run(twice, ctx, 60);
    hit(twice, [], { burn: true });
    run(twice, ctx, 200);
    expect(u2(twice).hp).toBeCloseTo(DUMMY.hp - 21, 9);
  });

  it("regen: a mage 20/s after 4 s up to ⅔, a dummy 85/s after 3 s to full", () => {
    const s = settled([mage(), dummy(-10)]);
    const m = s.units[0]!;
    const d = u2(s);
    Object.assign(m, { hp: 50, lastHitTick: s.tick });
    Object.assign(d, { hp: 10, lastHitTick: s.tick });
    run(s, ctx, 180);
    expect([m.hp, d.hp]).toEqual([50, 10]);
    run(s, ctx, 60);
    expect(m.hp).toBe(50);
    run(s, ctx, 60);
    expect([Number(m.hp.toFixed(6)), d.hp]).toEqual([70, DUMMY.hp]);
    m.hp = 95;
    run(s, ctx, 60);
    expect(m.hp).toBeCloseTo(100, 9);
  });
});

describe("kills", () => {
  it("credits the killer; «Кураж» clears heat and refreshes E", () => {
    const s = settled([mage("fire"), dummy(-10)]);
    const m = s.units[0]!.mage!;
    Object.assign(m, { heat: 60, overheatUntil: s.tick + 50 });
    m.ready.e = s.tick + 400;
    u2(s).hp = 10;
    const ev: MatchEvent[] = [];
    expect(hit(s, ev, { ability: "fireFists", damage: 12 })).toBe(12);
    for (const e of [{ type: "hit", target: 2, killed: true }, { type: "death", target: 2, killer: 1, ability: "fireFists" }, { type: "courage", unit: 1 }]) {
      expect(ev).toContainEqual(expect.objectContaining(e));
    }
    expect([m.stats.kills, m.stats.damage, m.heat, m.overheatUntil, m.ready.e <= s.tick, u2(s).alive]).toEqual([1, 12, 0, 0, true, false]);
  });

  it("ignores hits on yourself and on the dead", () => {
    const s = settled([mage(), dummy(-10)]);
    expect(hit(s, [], { target: 1, damage: 50 })).toBe(0);
    u2(s).alive = false;
    expect(hit(s, [], { damage: 50 })).toBe(0);
  });
});
