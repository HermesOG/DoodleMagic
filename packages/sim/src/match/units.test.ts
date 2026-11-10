import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { createWorld, withDynamic } from "../world";
import { applyHit, stepStatuses, type HitSpec } from "./combat";
import { FIRE } from "./defs";
import { TEST_FLOOR, TEST_KILL, deepFreeze, testContext } from "./fixtures";
import { NO_MATCH_INPUT, clonePlain, createDummyUnit, createMageUnit, createMatchState, rightXZ } from "./state";
import type { Spawn } from "../types";
import type { MatchContext, MatchEvent, MatchInput, MatchState, TickCtx, Unit, UnitId } from "./types";
import { SPAWN_SEEN_PENALTY_M, moveUnits, pickSpawn, stepLife } from "./units";

const ctx = testContext();
const tickOf = (s: MatchState): TickCtx => ({ world: ctx.world, terrainIds: [], killBelowY: ctx.killBelowY, now: s.tick, ev: [], spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0, ultChargeMul: 1 });
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

/** Тики в порядке stepMatch в мире c; события всех тиков. */
function stepIn(c: MatchContext, s: MatchState, n: number, each?: (s: MatchState) => void): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (let k = 0; k < n; k++) {
    const t: TickCtx = { world: c.world, terrainIds: [], killBelowY: c.killBelowY, now: s.tick, ev, spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0, ultChargeMul: 1 };
    moveUnits(s, t, {});
    stepStatuses(s, t);
    stepLife(s, t);
    s.tick += 1;
    each?.(s);
  }
  return ev;
}
const FAR_MAGE = { pos: { x: -30, y: 0, z: -30 }, yaw: 0 };
const byMage = (s: MatchState, over: Partial<HitSpec>) =>
  applyHit(s, tickOf(s), { source: 1, target: 2, ability: "fireball", damage: 0, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 0 }, ...over });
/** Смещение манекена вдоль его оси патруля от точки. */
const offOf = (u: Unit) => {
  const r = rightXZ(u.dummy!.spot.yaw);
  return (u.move.body.pos.x - u.dummy!.spot.pos.x) * r.x + (u.move.body.pos.z - u.dummy!.spot.pos.z) * r.z;
};

describe("dummy patrol is safe and alive", () => {
  it("turns around at a wall or a piece of terrain instead of pressing into it", () => {
    const wall = { box: aabb(-8, 0, -2, -7.5, 3, 2) };
    for (const c of [testContext([wall]), { world: withDynamic(ctx.world, [wall]), killBelowY: ctx.killBelowY }]) {
      const s = createMatchState([createDummyUnit(2, { pos: { x: -10, y: 0, z: 0 }, yaw: 0, patrolHalfM: 3 })]);
      stepIn(c, s, 300);
      let [lo, hi] = [Infinity, -Infinity];
      stepIn(c, s, 600, (st) => ([lo, hi] = [Math.min(lo, st.units[0]!.move.body.pos.x), Math.max(hi, st.units[0]!.move.body.pos.x)]));
      expect(hi).toBeCloseTo(-8.4, 6); // доходит до стены…
      expect(lo).toBeLessThan(-12.8); // …и уходит к другому краю патруля
    }
  });

  it("never walks off the gorge edge by itself after a shove across its patrol line (20 s)", () => {
    // Патруль по диагонали: «вправо» при yaw = π/4 — (+x, −z)/√2. Пропасть — восточнее x = 20 (fixtures).
    const s = createMatchState([createMageUnit(1, "fire", FAR_MAGE), createDummyUnit(2, { pos: { x: 17, y: 0, z: 0 }, yaw: Math.PI / 4, patrolHalfM: 2 })]);
    stepIn(ctx, s, 5);
    byMage(s, { dir: { x: Math.SQRT1_2, z: Math.SQRT1_2 }, knock: { distM: 3, upM: 0 } }); // поперёк патруля, к краю
    let [maxX, lo, hi] = [-Infinity, Infinity, -Infinity];
    const ev = stepIn(ctx, s, 1200, (st) => {
      const d = st.units[1]!;
      [maxX, lo, hi] = [Math.max(maxX, d.move.body.pos.x), Math.min(lo, offOf(d)), Math.max(hi, offOf(d))];
    });
    expect([ev.filter((e) => e.type === "fall"), s.units[1]!.alive]).toEqual([[], true]);
    expect(maxX).toBeGreaterThan(19); // его правда прижало к краю
    expect(maxX).toBeLessThan(19.6); // но ступни целиком на полу
    expect(hi - lo).toBeGreaterThan(2); // и он продолжает ходить
  });

  it("stays on a bridge narrower than its patrol", () => {
    const c: MatchContext = { world: createWorld([{ box: aabb(-40, -1, -40, 0, 0, 40) }, { box: aabb(0, -1, -1.5, 20, 0, 1.5), tag: "bridge" }]), killBelowY: -30 };
    // yaw = π/2: патруль поперёк моста, ±2 м при ширине 3 м
    const s = createMatchState([createDummyUnit(2, { pos: { x: 10, y: 0, z: 0 }, yaw: Math.PI / 2, patrolHalfM: 2 })]);
    let [lo, hi] = [Infinity, -Infinity];
    const ev = stepIn(c, s, 1200, (st) => ([lo, hi] = [Math.min(lo, st.units[0]!.move.body.pos.z), Math.max(hi, st.units[0]!.move.body.pos.z)]));
    expect([ev.filter((e) => e.type === "fall"), s.units[0]!.alive]).toEqual([[], true]);
    expect([lo > -1.1, hi < 1.1, hi - lo > 0.5]).toEqual([true, true, true]);
  });

  it("still goes over the edge when a fireball hits it there", () => {
    const s = createMatchState([createMageUnit(1, "fire", FAR_MAGE), createDummyUnit(2, { pos: { x: 18, y: 0, z: 0 }, yaw: 0, patrolHalfM: 1 })]);
    stepIn(ctx, s, 30);
    expect(s.units[1]!.move.body.pos.x).toBeGreaterThan(18.4);
    byMage(s, { dir: { x: 1, z: 0 }, damage: FIRE.fireball.damageCenter, knock: FIRE.fireball.knockback });
    expect(stepIn(ctx, s, 240)).toContainEqual(expect.objectContaining({ type: "fall", target: 2, credit: 1 }));
  });

  it("goes straight up from a pillar under it, without drifting on its own walking speed", () => {
    const s = createMatchState([createMageUnit(1, "earth", FAR_MAGE), createDummyUnit(2, { pos: { x: -10, y: 0, z: 0 }, yaw: 0, patrolHalfM: 4 })]);
    stepIn(ctx, s, 40);
    const d = s.units[1]!;
    expect(speed(d)).toBeCloseTo(2, 6);
    const p0 = { ...d.move.body.pos };
    byMage(s, { ability: "stonePillar", damage: 35, knock: { distM: 1, upM: 3.5 }, launch: true }); // dir 0: столб прямо под ним
    let n = 0;
    do {
      stepIn(ctx, s, 1);
      n += 1;
    } while (!d.move.onGround && n < 300);
    expect(n).toBeGreaterThan(60); // правда летал
    expect(Math.hypot(d.move.body.pos.x - p0.x, d.move.body.pos.z - p0.z)).toBeLessThan(0.3);
  });
});

describe("mage input", () => {
  it("keeps the view when a tick's input is missing, and stops the steps", () => {
    const s = withMage();
    step(s, 30, { 1: { ...fwd, yaw: 1.2, pitch: 0.3 } });
    expect(speed(s.units[0]!)).toBeGreaterThan(6);
    step(s, 30);
    const m = s.units[0]!.move;
    expect([m.yaw, m.pitch, speed(s.units[0]!), m.body.pos.y]).toEqual([1.2, 0.3, 0, 0]);
  });
});

describe("pickSpawn: penalty for a point a living enemy sees (R14)", () => {
  // враг в начале координат; стена 10 × 3 м в 9…10 м к −z закрывает от него всё, что за ней
  const wall = { box: aabb(-5, 0, -10, 5, 3, -9) };
  const world = createWorld([TEST_FLOOR, wall], [TEST_KILL]);
  const at = (x: number, z: number): Spawn => ({ pos: { x, y: 0, z }, yaw: 0 });
  const enemy = () => createMatchState([createMageUnit(2, "fire", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 })]);

  it("prefers a hidden point unless the seen one is more than the penalty further away", () => {
    expect(SPAWN_SEEN_PENALTY_M).toBe(20);
    const hidden = at(0, -25);
    // на виду 30 м (−20 → 10) против спрятанной 25 м — спрятанная; без мира — как раньше, просто дальняя
    expect(pickSpawn(enemy(), 1, [at(0, 30), hidden], world)).toBe(hidden);
    expect(pickSpawn(enemy(), 1, [at(0, 30), hidden])).toEqual(at(0, 30));
    // на виду 39 м (19) против спрятанной 18 м — на виду: это штраф, а не запрет
    expect(pickSpawn(enemy(), 1, [at(0, 39), at(0, -18)], world)).toEqual(at(0, 39));
    // спрятанная в 10,5 м: 10,5 > 30 − 20; в 10 м — ровно 10 = 10: ничья, меньший номер
    expect(pickSpawn(enemy(), 1, [at(0, 30), at(0, -10.5)], world)).toEqual(at(0, -10.5));
    expect(pickSpawn(enemy(), 1, [at(0, 30), at(0, -10)], world)).toEqual(at(0, 30));
  });

  it("scores each point by its worst enemy: hidden from one but seen by another counts as seen by that one", () => {
    const s = createMatchState([createMageUnit(2, "fire", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }), createMageUnit(3, "earth", { pos: { x: 0, y: 0, z: -35 }, yaw: 0 })]);
    // (0; −25): от мага 2 закрыта стеной (25), маг 3 видит её с 10 м (10 − 20 = −10); (0; 30): 30 − 20 = 10 — она
    expect(pickSpawn(s, 1, [at(0, -25), at(0, 30)], world)).toEqual(at(0, 30));
  });

  it("ignores the mage itself, the dead and dummies, and leaves its arguments untouched", () => {
    const dead = createMageUnit(3, "earth", { pos: { x: 0, y: 0, z: 30 }, yaw: 0 });
    dead.alive = false;
    const s = deepFreeze(createMatchState([createMageUnit(1, "fire", { pos: { x: 0, y: 0, z: 30 }, yaw: 0 }), dead, createDummyUnit(4, { pos: { x: 0, y: 0, z: 30 }, yaw: 0 })]));
    const spawns = deepFreeze([at(0, 30), at(0, -25)]);
    // живых врагов нет: первая точка, хоть её и «видят» сам маг, мёртвый и манекен
    expect(pickSpawn(s, 1, spawns, world)).toBe(spawns[0]);
  });

  it("is the same choice for the same state and world (host and client agree)", () => {
    const spawns = [at(-30, -30), at(10, 30), at(-30, 30), at(10, -30), at(0, -25)];
    const s = createMatchState([createMageUnit(2, "fire", { pos: { x: 3, y: 0, z: 4 }, yaw: 0 }), createMageUnit(3, "air", { pos: { x: -12, y: 0, z: 7 }, yaw: 0 })]);
    const first = spawns.indexOf(pickSpawn(s, 1, spawns, world));
    for (let k = 0; k < 5; k++) expect(spawns.indexOf(pickSpawn(clonePlain(s), 1, spawns, createWorld([TEST_FLOOR, wall], [TEST_KILL])))).toBe(first);
  });

  it("is used by the respawn in stepLife with the tick's world", () => {
    const s = createMatchState([createMageUnit(1, "fire", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }), createMageUnit(2, "fire", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 })]);
    const me = s.units[0]!;
    me.alive = false;
    me.respawnTick = 0;
    const spawns = [at(0, 30), at(0, -25)];
    const t: TickCtx = { world, terrainIds: [], killBelowY: -30, now: 0, ev: [], spawns, mageRespawnTicks: 180, spawnShieldTicks: 0, ultChargeMul: 1 };
    stepLife(s, t);
    expect(s.units[0]!.mage!.spawn).toEqual(spawns[1]);
    expect(t.ev).toContainEqual({ type: "respawn", target: 1, pos: { x: 0, y: 0, z: -25 }, yaw: 0 });
  });
});
