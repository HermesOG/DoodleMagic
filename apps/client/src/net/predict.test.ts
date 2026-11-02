import type { MatchEvent, MatchState, UnitId, Vec3 } from "@doodlemagic/sim";
import { describe, expect, it } from "vitest";
import { LOCAL_PEER, createHostCore } from "./hostCore";
import {
  DEDUP_WINDOW, LATE_FX_MAX_AGE, MAX_REPLAY, SMOOTH_SELF_TAU_S, SMOOTH_TAU_S, SNAP_DIST_M, createPredictor, eventKey, withOffsets,
  type Predictor,
} from "./predict";
import type { SnapshotMsg } from "./snapshot";
import { input, testPvpContext } from "./testArena";

const ctx = testPvpContext();
const HOST_ID = 1;
const ME = 2;

/** Хост (маг 1) и гость (маг 2 — предсказатель): n тиков, с тика 4 хост держит ЛКМ; снапшоты по порядку. */
function hostSnapshots(n: number): SnapshotMsg[] {
  const h = createHostCore(ctx);
  h.join(LOCAL_PEER, "Хост", "fire", 0);
  h.join("p", "Гость", "fire", 0);
  const out: SnapshotMsg[] = [];
  for (let k = 0; k < n; k++) {
    const r = h.tick(input({ primary: k >= 4, yaw: 0.2 }), k * (1000 / 60));
    if (r.snapshot) out.push(r.snapshot);
  }
  return out;
}

/** Копия снапшота на dt тиков позже, с правкой (сдвинуть юнит, заменить события). */
function later(s: SnapshotMsg, dt: number, edit: (c: SnapshotMsg) => void = () => {}): SnapshotMsg {
  const c = structuredClone(s);
  c.tick += dt;
  c.game.match.tick += dt;
  c.events = [];
  edit(c);
  return c;
}
const posOf = (s: MatchState, id: UnitId): Vec3 => s.units.find((u) => u.id === id)!.move.body.pos;
const moveUnit = (c: SnapshotMsg, id: UnitId, dx: number, dz = 0): void => {
  const p = posOf(c.game.match, id);
  p.x += dx;
  p.z += dz;
};
const len = (v: Vec3 | undefined): number => (v ? Math.hypot(v.x, v.y, v.z) : 0);

describe("eventKey", () => {
  const hit = (over: Partial<Extract<MatchEvent, { type: "hit" }>> = {}): MatchEvent => ({
    type: "hit", source: 1, target: 2, ability: "fireball", amount: 50, pos: { x: 1, y: 2, z: 3 }, dir: { x: 0, y: 0, z: -1 },
    knock: { distM: 3, upM: 1.2 }, airborne: false, dot: false, killed: false, ...over,
  });
  const respawn = (x: number, z: number): MatchEvent => ({ type: "respawn", target: 2, pos: { x, y: 0, z }, yaw: 0 });

  it("the same hit at other coordinates and with another amount has the same key", () => {
    expect(eventKey(hit({ pos: { x: 5, y: 0, z: -7 }, dir: { x: 1, y: 0, z: 0 }, amount: 31 }))).toBe(eventKey(hit()));
  });

  it("other target, source or ability — another key", () => {
    const keys = [hit(), hit({ target: 3 }), hit({ source: 4 }), hit({ ability: "fireFists" })].map(eventKey);
    expect(new Set(keys).size).toBe(4);
  });

  it("respawn at other points — other keys; the same point after rounding of the snapshot — the same key", () => {
    expect(eventKey(respawn(10, 30))).not.toBe(eventKey(respawn(-30, -30)));
    expect(eventKey(respawn(10, 30))).not.toBe(eventKey(respawn(10.3, 30)));
    expect(eventKey(respawn(10.000004, 29.99999))).toBe(eventKey(respawn(10, 30)));
  });

  it("projectile, zone and terrain ids do not count", () => {
    const rel = (projectile: number): MatchEvent => ({ type: "release", unit: 1, ability: "fireball", projectile, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 } });
    const zone = (id: number): MatchEvent => ({ type: "zone", zone: id, kind: "fireWall", owner: 1, phase: "arm" });
    const imp = (terrain: number): MatchEvent => ({ type: "impact", ability: "stoneShot", owner: 1, pos: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, target: -1, terrain });
    expect(eventKey(rel(1001))).toBe(eventKey(rel(1007)));
    expect(eventKey(zone(1001))).toBe(eventKey(zone(1002)));
    expect(eventKey(imp(1003))).toBe(eventKey(imp(1009)));
    expect(eventKey(imp(1003))).not.toBe(eventKey(imp(-1)));
  });
});

describe("withOffsets", () => {
  it("moves only the units with an offset and leaves the source as it was", () => {
    const s = hostSnapshots(3)[0]!.game.match;
    const json = JSON.stringify(s);
    const out = withOffsets(s, new Map([[ME, { x: 0.5, y: -0.25, z: 1 }]]));
    const a = posOf(s, ME);
    expect(posOf(out, ME)).toEqual({ x: a.x + 0.5, y: a.y - 0.25, z: a.z + 1 });
    expect(out.units[0]).toBe(s.units[0]);
    expect(JSON.stringify(s)).toBe(json);
  });
});

describe("predictor: readiness and replay", () => {
  it("does nothing before a snapshot with its own mage", () => {
    const p = createPredictor(ctx, ME);
    expect(p.step(input({ moveZ: 1 }))).toEqual({ events: [], packet: [] });
    const lonely = hostSnapshots(3)[0]!;
    const without = later(lonely, 0, (c) => (c.game.match.units = c.game.match.units.filter((u) => u.id !== ME)));
    p.applySnapshot(without);
    expect([p.ready, p.cur]).toEqual([false, without.game]);
    expect(p.step(input({ moveZ: 1 }))).toEqual({ events: [], packet: [] });
    p.applySnapshot(later(lonely, 3));
    expect(p.ready).toBe(true);
    expect(p.step(input({ moveZ: 1 })).packet.map((x) => x[0])).toEqual([1]);
    expect(p.step(input({ moveZ: 1 })).packet.map((x) => x[0])).toEqual([1, 2]);
    expect(p.step(input({ moveZ: 1 })).packet.map((x) => x[0])).toEqual([1, 2, 3]);
    expect(p.step(input({ moveZ: 1 })).packet.map((x) => x[0])).toEqual([2, 3, 4]);
  });

  it("losing its own mage in a snapshot makes it not ready again", () => {
    const [s1, s2] = hostSnapshots(6);
    const p = createPredictor(ctx, ME);
    p.applySnapshot(s1!);
    p.step(input());
    p.applySnapshot(later(s2!, 0, (c) => (c.game.match.units = c.game.match.units.filter((u) => u.id !== ME))));
    expect([p.ready, p.cur === p.prev]).toEqual([false, true]);
    expect(p.step(input())).toEqual({ events: [], packet: [] });
  });

  it("each step moves the prediction one tick; prev is the state before it", () => {
    const p = createPredictor(ctx, ME);
    const s = hostSnapshots(3)[0]!;
    p.applySnapshot(s);
    expect([p.cur, p.prev, p.confirmed]).toEqual([s.game, s.game, s.game]);
    const before = p.cur;
    p.step(input({ moveZ: 1 }));
    expect(p.prev).toBe(before);
    expect(p.cur.match.tick).toBe(s.tick + 1);
  });

  it("replays unacknowledged inputs on top of the snapshot, acknowledged ones are dropped", () => {
    const s = hostSnapshots(3)[0]!;
    const p = createPredictor(ctx, ME);
    p.applySnapshot(s);
    for (let k = 0; k < 10; k++) p.step(input({ moveZ: 1, yaw: Math.PI }));
    const ahead = p.cur;
    // хост применил вводы 1…4: снапшот на 4 тика позже, остальные 6 переигрываются
    const s2 = later(s, 4, (c) => (c.acks = [[ME, 4]]));
    p.applySnapshot(s2);
    expect(p.cur.match.tick).toBe(s2.tick + 6);
    expect(p.confirmed).toBe(s2.game);
    expect(p.cur.match.tick).toBe(ahead.match.tick);
  });

  it("MAX_REPLAY caps the replay; the oldest inputs go", () => {
    const s = hostSnapshots(3)[0]!;
    const p = createPredictor(ctx, ME);
    p.applySnapshot(s);
    for (let k = 0; k < 200; k++) p.step(input({ moveX: 1 }));
    p.applySnapshot(later(s, 3));
    expect(p.cur.match.tick).toBe(s.tick + 3 + MAX_REPLAY);
    expect(p.step(input()).packet.map((x) => x[0])).toEqual([199, 200, 201]);
  });
});

describe("predictor: snapshots out of order", () => {
  it("an older snapshot after a newer one does not roll the state back; its events count once", () => {
    const [s1, s2, s3] = hostSnapshots(9);
    expect(s2!.events.length).toBeGreaterThan(0);
    const p = createPredictor(ctx, ME);
    p.applySnapshot(s1!);
    p.applySnapshot(s3!);
    const cur = p.cur;
    const r = p.applySnapshot(s2!);
    expect(p.cur).toBe(cur);
    expect(p.confirmed).toBe(s3!.game);
    expect(r.confirmed).toEqual(s2!.events.map(([, e]) => e));
    expect(r.late).toEqual(r.confirmed); // каст хоста предсказание не показывало
    for (const again of [s1!, s2!, s3!]) expect(p.applySnapshot(again)).toEqual({ late: [], confirmed: [] });
  });
});

describe("predictor: host events against the shown ones", () => {
  /** Предсказатель, который в шаге сам показал свой каст ЛКМ; тик этого каста. */
  function shownCast(): { p: Predictor; s: SnapshotMsg; tick: number; cast: MatchEvent } {
    const s = hostSnapshots(3)[0]!;
    const p = createPredictor(ctx, ME);
    p.applySnapshot(s);
    const tick = p.cur.match.tick;
    const cast = p.step(input({ primary: true, yaw: Math.PI })).events.find((e) => e.type === "cast")!;
    expect(cast).toMatchObject({ type: "cast", unit: ME, ability: "fireFists" });
    return { p, s, tick, cast };
  }
  const moved = (e: MatchEvent): MatchEvent => (e.type === "cast" ? { ...e, pos: { ...e.pos, x: e.pos.x + 0.3 } } : e);

  it(`a host copy within ±${DEDUP_WINDOW} ticks is not repeated, but goes to confirmed; a second copy is late`, () => {
    const { p, s, tick, cast } = shownCast();
    const host = moved(cast);
    expect(p.applySnapshot(later(s, 3, (c) => (c.events = [[tick + DEDUP_WINDOW, host]])))).toEqual({ late: [], confirmed: [host] });
    expect(p.applySnapshot(later(s, 6, (c) => (c.events = [[tick + DEDUP_WINDOW, host]])))).toEqual({ late: [host], confirmed: [host] });
  });

  it("a host copy further than the window is late", () => {
    const { p, s, tick, cast } = shownCast();
    expect(p.applySnapshot(later(s, 12, (c) => (c.events = [[tick + DEDUP_WINDOW + 1, cast]]))).late).toEqual([cast]);
  });

  it(`an event older than ${LATE_FX_MAX_AGE} ticks goes only to confirmed`, () => {
    const { p, s, tick } = shownCast();
    const other: MatchEvent = { type: "cast", unit: HOST_ID, ability: "fireFists", slot: "primary", pos: { x: 0, y: 1.6, z: 0 }, dir: { x: 0, y: 0, z: -1 } };
    const r = p.applySnapshot(later(s, LATE_FX_MAX_AGE + 10, (c) => (c.events = [[tick, other], [tick + 20, other]])));
    expect(r).toEqual({ late: [other], confirmed: [other, other] });
  });
});

describe("predictor: smoothing", () => {
  it("a correction becomes a render offset that fades like e^(−t/τ), the own mage faster", () => {
    const s = hostSnapshots(3)[0]!;
    const p = createPredictor(ctx, ME);
    p.applySnapshot(s);
    expect(p.offsets(0).size).toBe(0);
    p.applySnapshot(later(s, 3, (c) => {
      moveUnit(c, HOST_ID, 0.5);
      moveUnit(c, ME, 0, -0.2);
    }));
    const o = p.offsets(0);
    expect(o.get(HOST_ID)!.x).toBeCloseTo(-0.5, 9);
    expect(o.get(ME)!.z).toBeCloseTo(0.2, 9);
    p.offsets(SMOOTH_SELF_TAU_S);
    expect(o.get(ME)!.z).toBeCloseTo(0.2 * Math.exp(-1), 9);
    expect(o.get(HOST_ID)!.x).toBeCloseTo(-0.5 * Math.exp(-SMOOTH_SELF_TAU_S / SMOOTH_TAU_S), 9);
    let left = p.offsets(SMOOTH_TAU_S);
    for (let k = 0; k < 120; k++) left = p.offsets(1 / 60);
    expect(left.size).toBe(0);
  });

  it("corrections add up; a jump over SNAP_DIST_M is not smoothed and drops the old offset", () => {
    const s = hostSnapshots(3)[0]!;
    const p = createPredictor(ctx, ME);
    p.applySnapshot(s);
    p.applySnapshot(later(s, 3, (c) => moveUnit(c, HOST_ID, 1)));
    p.applySnapshot(later(s, 6, (c) => moveUnit(c, HOST_ID, 2)));
    expect(len(p.offsets(0).get(HOST_ID))).toBeCloseTo(2, 9);
    p.applySnapshot(later(s, 9, (c) => moveUnit(c, HOST_ID, 2 + SNAP_DIST_M + 0.5)));
    expect(p.offsets(0).has(HOST_ID)).toBe(false);
    p.applySnapshot(later(s, 12, (c) => moveUnit(c, HOST_ID, 2 + 2 * SNAP_DIST_M + 1)));
    expect(p.offsets(0).has(HOST_ID)).toBe(false);
  });

  it("a unit that left takes its offset with it", () => {
    const s = hostSnapshots(3)[0]!;
    const p = createPredictor(ctx, ME);
    p.applySnapshot(s);
    p.applySnapshot(later(s, 3, (c) => moveUnit(c, HOST_ID, 1)));
    p.applySnapshot(later(s, 6, (c) => (c.game.match.units = c.game.match.units.filter((u) => u.id !== HOST_ID))));
    expect(p.offsets(0).has(HOST_ID)).toBe(false);
  });
});
