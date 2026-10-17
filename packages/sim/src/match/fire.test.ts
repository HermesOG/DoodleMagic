import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { NO_MATCH_INPUT } from "./state";
import type { DummySpot, Element, MatchContext, MatchEvent, MatchInput, MatchState } from "./types";
import type { Spawn } from "../types";

const ELEMENT: Element = "fire";
const ctx = testContext();
const HOME: Spawn = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
/** Наклон взгляда из глаз (1,6 м) на точку высотой y в d метрах впереди. */
const pitchTo = (d: number, y = 1) => Math.atan2(y - 1.6, d);
const at = (z: number, x = 0): DummySpot => ({ pos: { x, y: 0, z }, yaw: 0 });
type Log = { t: number; e: MatchEvent }[];
/** Маг в spawn и манекены; ввод по относительному тику k. log — события с относительным тиком. */
function play(dummies: DummySpot[], n: number, input: (k: number, s: MatchState) => Partial<MatchInput>, spawn: Spawn = HOME, c: MatchContext = ctx) {
  let s = createMatch({ mages: [{ element: ELEMENT, spawn }], dummies });
  for (let k = 0; k < 5; k++) s = stepMatch(s, {}, c).state;
  const start = s.tick;
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, ...input(k, s) } }, c);
    s = r.state;
    for (const e of r.events) log.push({ t: k, e });
  }
  return { s, log, start };
}
const ticksOf = (log: Log, type: MatchEvent["type"], ability: string) => log.filter(({ e }) => e.type === type && "ability" in e && e.ability === ability).map(({ t }) => t);
const hitsOf = (log: Log, ability: string) => log.flatMap(({ t, e }) => (e.type === "hit" && e.ability === ability ? [{ t, e }] : []));
const reject = (t: number, slot: string, reason: string) => ({ t, e: expect.objectContaining({ type: "reject", slot, reason }) });

describe("Fire kit", () => {
  it("fists: 5 shots a second while LMB is held, 12 damage each", () => {
    const { log } = play([at(-10)], 80, () => ({ primary: true, pitch: pitchTo(10) }));
    expect(ticksOf(log, "cast", "fireFists").slice(0, 5)).toEqual([0, 12, 24, 36, 48]);
    expect(ticksOf(log, "release", "fireFists").slice(0, 5)).toEqual([0, 12, 24, 36, 48]);
    const hits = hitsOf(log, "fireFists");
    expect([hits.length >= 5, hits.every(({ e }) => e.amount === 12)]).toEqual([true, true]);
  });

  it("heat: +8 a shot; at 100 the rate halves for 1.5 s while heat drains; cools 35/s after 0.3 s idle", () => {
    const { log } = play([], 300, () => ({ primary: true }));
    const shots = ticksOf(log, "cast", "fireFists");
    expect(shots.slice(0, 13)).toEqual(Array.from({ length: 13 }, (_, k) => 12 * k));
    const on = log.find(({ e }) => e.type === "overheat" && e.on)!.t;
    const off = log.find(({ e }) => e.type === "overheat" && !e.on)!.t;
    expect([on, off, shots.filter((t) => t > on && t < off)]).toEqual([144, 234, [168, 192, 216]]);
    const idle = play([], 109, (k) => ({ primary: k < 49 })).s;
    expect(idle.units[0]!.mage!.heat).toBeCloseTo(40 - (42 * 35) / 60, 9);
  });

  it("fireball: 0.25 s windup, 50 with burning on a hit, 8 s cooldown", () => {
    const { log } = play([at(-10)], 500, (k) => ({ q: k === 0 || k === 100 || k === 480, pitch: pitchTo(10) }));
    expect([ticksOf(log, "cast", "fireball"), ticksOf(log, "release", "fireball")[0], hitsOf(log, "burning").length]).toEqual([[0, 480], 15, 6]);
    expect(hitsOf(log, "fireball")[0]!.e).toMatchObject({ amount: 50, target: 2 });
    expect(log).toContainEqual(reject(100, "q", "cooldown"));
  });

  it("jet dash: 8 m in 0.2 s along the strafe, leaving a 2 s burning trail", () => {
    const { log, s } = play([at(0, 4)], 200, (k) => ({ e: k === 0, moveX: k === 0 ? 1 : 0 }));
    expect(log).toContainEqual({ t: 0, e: expect.objectContaining({ type: "dash", phase: "start" }) });
    expect(log.find(({ e }) => e.type === "dash" && e.phase === "end")!.t).toBe(11);
    const x = s.units[0]!.move.body.pos.x;
    const dmg = hitsOf(log, "jetDash").reduce((a, { e }) => a + e.amount, 0);
    expect([x > 7.9, x < 8.6, dmg >= 12, dmg <= 15]).toEqual([true, true, true, true]);
    // след — урон по времени: камеру не трясёт (правка контролёра)
    expect(hitsOf(log, "jetDash").every(({ e }) => e.dot)).toBe(true);
  });

  it("fire wall: under the crosshair, across the view, arms after 0.4 s, 30 + burning; refused over the void", () => {
    const { log, s } = play([at(-10, 3)], 40, (k) => ({ c: k === 0, pitch: -Math.atan2(1.6, 10) }));
    const z = s.zones.find((q) => q.kind === "fireWall")!;
    if (z.shape.type !== "box") throw new Error("box expected");
    const b = z.shape.box;
    expect([b.min.x, b.max.x, (b.min.z + b.max.z) / 2, b.min.y, b.max.y].map((v) => Number(v.toFixed(6)))).toEqual([-5, 5, -10, 0, 2.5]);
    expect(hitsOf(log, "fireWall")[0]).toEqual({ t: 24, e: expect.objectContaining({ amount: 30, target: 2, dot: false }) });
    const edge = play([], 2, () => ({ c: true, yaw: -Math.PI / 2 }), { pos: { x: 18, y: 0, z: 0 }, yaw: -Math.PI / 2 });
    expect(edge.log).toContainEqual(reject(0, "c", "noTarget"));
    expect(edge.s.units[0]!.mage!.ready.c).toBeLessThanOrEqual(edge.s.tick);
  });

  it("«Кураж»: a kill clears heat and refreshes the dash", () => {
    const { log, s, start } = play([at(-10)], 150, (k, st) => {
      if (k === 0) Object.assign(st.units[1]!, { hp: 20, lastHitTick: st.tick });
      const p = st.units[0]!.move.body.pos;
      return { e: k === 0, moveX: k === 0 ? -1 : 0, primary: k >= 30, yaw: Math.atan2(p.x, 10 + p.z), pitch: pitchTo(Math.hypot(p.x, 10 + p.z)) };
    });
    const kill = log.find(({ e }) => e.type === "courage")!;
    expect(s.units[0]!.mage!.ready.e).toBeLessThanOrEqual(start + kill.t);
  });

  it("jet dash works in the air at a constant height, cancels the caster's knockback and stops at a wall", () => {
    const ys: number[] = [];
    const air = play([], 17, (k, st) => {
      if (k >= 4 && k <= 15) ys.push(st.units[0]!.move.body.pos.y); // с начала рывка (тик 4) до его последнего тика (15)
      if (k === 4) Object.assign(st.units[0]!.kb, { x: 0, z: 9 });
      return { jump: k === 0, e: k === 4, moveX: k === 4 ? 1 : 0 };
    });
    const startY = ys[0]!;
    expect([startY > 0.2, ys.every((y) => y === startY), air.s.units[0]!.kb]).toEqual([true, true, { x: 0, z: 0 }]);
    expect(air.log.find(({ e }) => e.type === "dash" && e.phase === "end")!.t).toBe(15);
    expect(Math.abs(air.s.units[0]!.move.body.pos.z)).toBeLessThan(1e-9);
    const wall = play([], 30, (k) => ({ e: k === 0, moveX: k === 0 ? 1 : 0 }), HOME, testContext([{ box: aabb(3, 0, -5, 4, 3, 5), tag: "wall" }]));
    const end = wall.log.find(({ e }) => e.type === "dash" && e.phase === "end")!;
    expect([end.t < 11, Number(wall.s.units[0]!.move.body.pos.x.toFixed(6))]).toEqual([true, 2.6]);
  });

  it("the fireball windup blocks the fists and the wall but not the dash; a rooted mage cannot dash", () => {
    const { log } = play([], 30, (k) => ({ q: k === 0, primary: k >= 3, c: k === 4, e: k === 5 }));
    expect(log).toContainEqual(reject(3, "primary", "busy"));
    expect(log).toContainEqual(reject(4, "c", "busy"));
    expect([ticksOf(log, "cast", "jetDash"), ticksOf(log, "release", "fireball"), ticksOf(log, "cast", "fireFists")[0]]).toEqual([[5], [15], 16]);
    const tap = play([], 20, (k) => ({ primary: k < 2 || k === 6 }));
    expect([ticksOf(tap.log, "cast", "fireFists"), tap.log.filter(({ e }) => e.type === "reject").map(({ t }) => t)]).toEqual([[0], [6]]);
    const rooted = play([], 1, (k, st) => {
      if (k === 0) st.units[0]!.status.rootUntil = st.tick + 30;
      return { e: true };
    });
    expect([rooted.log.map(({ e }) => e.type), rooted.s.units[0]!.mage!.ready.e]).toEqual([["reject"], 0]);
    expect(rooted.log).toContainEqual(reject(0, "e", "rooted"));
  });
});
