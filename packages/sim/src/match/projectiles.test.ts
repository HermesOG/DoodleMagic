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
import { EARTH, FIRE, LIMITS } from "./defs";
import { spawnProjectile, stepProjectiles, sweepSegment } from "./projectiles";
import { spawnTerrain } from "./terrain";

function fly(s: MatchState, c: MatchContext, n: number): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (let k = 0; k < n; k++) {
    const t = tickOf(s, c, ev);
    moveUnits(s, t, {});
    stepProjectiles(s, t);
    stepStatuses(s, t);
    s.tick += 1;
  }
  return ev;
}
const shoot = (s: MatchState, c: MatchContext, a: "fireFists" | "fireball" | "stoneShot") => spawnProjectile(s, tickOf(s, c, []), 1, a, EYE, AHEAD);
const FAR = { x: 0, y: 1.6, z: -20 };

describe("projectiles", () => {
  it("sweep: hit the first body, inflated by the radius, skip the owner, stop at a wall in front", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10), dummy(3, 0, -14)]);
    const h = sweepSegment(s, tickOf(s, ctx, []), 1, EYE, FAR, 0.2);
    expect([h?.unit, h?.normal]).toEqual([2, { x: 0, y: 0, z: 1 }]);
    expect(h?.dist).toBeCloseTo(10 - 0.4 - 0.2, 9);
    const walled = testContext([{ box: aabb(-3, 0, -6, 3, 3, -5.5) }]);
    const w = sweepSegment(s, tickOf(s, walled, []), 1, EYE, FAR, 0.2);
    expect([w?.unit, w?.terrain]).toEqual([NOBODY, null]);
    expect(w?.dist).toBeCloseTo(5.5, 9);
  });

  it("fire fist: 12 damage and a small tempo-scaled push; gone after 24 m (36 ticks)", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10)]);
    shoot(s, ctx, "fireFists");
    const ev = fly(s, ctx, 30);
    const hit = ev.find((e) => e.type === "hit");
    expect(hit).toMatchObject({ source: 1, target: 2, ability: "fireFists", amount: 12 });
    expect(hit?.type === "hit" && Number(hit.knock.distM.toFixed(9))).toBe(0.12);
    expect(ev).toContainEqual(expect.objectContaining({ type: "impact", ability: "fireFists", target: 2 }));
    const free = createMatchState([mage()]);
    shoot(free, ctx, "fireFists");
    fly(free, ctx, 35);
    expect(free.projectiles).toHaveLength(1);
    fly(free, ctx, 1);
    expect([s.projectiles.length, free.projectiles.length]).toEqual([0, 0]);
  });

  it("stone drops on a light ballistic arc and chips the terrain it hits", () => {
    const s = createMatchState([mage()]);
    shoot(s, ctx, "stoneShot");
    fly(s, ctx, 30);
    expect(s.projectiles[0]!.pos.z).toBeCloseTo(-20, 6);
    expect(s.projectiles[0]!.pos.y).toBeCloseTo(1.6 - 0.5 * EARTH.stoneShot.projectile.gravity * 0.25, 6);
    const w = createMatchState([mage()]);
    const id = spawnTerrain(w, tickOf(w, ctx, []), 1, "wall", aabb(-2, 0, -6.3, 2, 2.5, -5.7), { growTicks: 18, solidTicks: 0, lifeTicks: 360, hp: 250 });
    w.terrain[0]!.solid = true;
    shoot(w, ctx, "stoneShot");
    expect(fly(w, ctx, 20)).toContainEqual(expect.objectContaining({ type: "impact", ability: "stoneShot", terrain: id }));
    expect(w.terrain[0]!.hp).toBe(250 - EARTH.stoneShot.damage);
  });

  it("fireball: 50 on a direct hit, falling to 20 at 3 m, burning, push scaled the same", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10), dummy(3, 3.2, -9.15), dummy(4, 4, -9.15)]);
    shoot(s, ctx, "fireball");
    const ev = fly(s, ctx, 40);
    const hits = new Map(ev.flatMap((e) => (e.type === "hit" && !e.dot ? [[e.target, e] as const] : [])));
    expect(hits.get(2)?.amount).toBeCloseTo(FIRE.fireball.damageCenter, 9);
    expect(hits.get(2)?.knock.distM).toBeCloseTo(FIRE.fireball.knockback.distM, 9);
    expect(hits.get(3)?.amount).toBeCloseTo(22, 6);
    expect(hits.get(3)?.knock.distM).toBeCloseTo(3 * 0.44, 6);
    expect([hits.has(4), byId(s, 2).status.burnPulses > 0]).toEqual([false, true]);
    expect(ev).toContainEqual(expect.objectContaining({ type: "explosion", ability: "fireball", radius: FIRE.fireball.radiusM }));
  });

  it("pushes a direct fireball hit along the travel direction, even 0.6 m off-centre; the splash stays radial", () => {
    const s = createMatchState([mage(), dummy(2, 0.6, -10), dummy(3, 3.2, -9.15)]);
    shoot(s, ctx, "fireball");
    const ev = fly(s, ctx, 40);
    const hit = (id: number) => ev.find((e) => e.type === "hit" && e.target === id && !e.dot);
    const deg = (d: { x: number; z: number }) => (Math.acos(-d.z / Math.hypot(d.x, d.z)) * 180) / Math.PI; // от −Z (полёт шара)
    const direct = hit(2);
    const moved = { x: byId(s, 2).move.body.pos.x - 0.6, z: byId(s, 2).move.body.pos.z + 10 };
    expect([direct?.type === "hit" && deg(direct.dir) < 5, deg(moved) < 5, Math.hypot(moved.x, moved.z) > 1]).toEqual([true, true, true]);
    const splash = hit(3);
    expect(splash?.type === "hit" && deg(splash.dir) > 45).toBe(true);
  });

  it("does not splash through a wall", () => {
    const walled = testContext([{ box: aabb(1.6, 0, -12, 2.2, 3, -6) }]);
    const s = createMatchState([mage(), dummy(2, 0, -10), dummy(3, 3.2, -9.15)]);
    shoot(s, walled, "fireball");
    const ev = fly(s, walled, 40);
    expect([2, 3].map((id) => ev.some((e) => e.type === "hit" && e.target === id))).toEqual([true, false]);
  });

  it("keeps at most 8 projectiles per mage, dropping the oldest", () => {
    const s = createMatchState([mage()]);
    const ids = Array.from({ length: LIMITS.projectilesPerMage + 1 }, () => shoot(s, ctx, "fireFists"));
    expect(s.projectiles.map((p) => p.id)).toEqual(ids.slice(1));
  });
});
