import { describe, expect, it } from "vitest";
import { testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { NO_MATCH_INPUT, statusFlags } from "./state";
import type { DummySpot, Element, MatchEvent, MatchInput, MatchState } from "./types";
import type { Spawn } from "../types";

const ELEMENT: Element = "earth";
const ctx = testContext();
const HOME: Spawn = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
/** Наклон взгляда из глаз (1,6 м) на точку высотой y в d метрах впереди. */
const pitchTo = (d: number, y = 1) => Math.atan2(y - 1.6, d);
const at = (z: number, x = 0): DummySpot => ({ pos: { x, y: 0, z }, yaw: 0 });
type Log = { t: number; e: MatchEvent }[];
/** Маг в spawn и манекены; ввод по относительному тику k. log — события с относительным тиком. */
function play(dummies: DummySpot[], n: number, input: (k: number, s: MatchState) => Partial<MatchInput>, spawn: Spawn = HOME) {
  let s = createMatch({ mages: [{ element: ELEMENT, spawn }], dummies });
  for (let k = 0; k < 5; k++) s = stepMatch(s, {}, ctx).state;
  const start = s.tick;
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, ...input(k, s) } }, ctx);
    s = r.state;
    for (const e of r.events) log.push({ t: k, e });
  }
  return { s, log, start };
}
const ticksOf = (log: Log, type: MatchEvent["type"], ability: string) => log.filter(({ e }) => e.type === type && "ability" in e && e.ability === ability).map(({ t }) => t);
const hitsOf = (log: Log, ability: string) => log.flatMap(({ t, e }) => (e.type === "hit" && e.ability === ability ? [{ t, e }] : []));
const reject = (t: number, slot: string, reason: string) => ({ t, e: expect.objectContaining({ type: "reject", slot, reason }) });

describe("Earth kit", () => {
  it("stone shot: 0.2 s windup, 30 damage, every 32 ticks while held", () => {
    const { log } = play([at(-12)], 120, () => ({ primary: true, pitch: pitchTo(12, 1.3) }));
    expect([ticksOf(log, "cast", "stoneShot"), ticksOf(log, "release", "stoneShot")]).toEqual([[0, 32, 64, 96], [12, 44, 76, 108]]);
    const hits = hitsOf(log, "stoneShot");
    expect([hits.length >= 3, hits.every(({ e }) => e.amount === 30)]).toEqual([true, true]);
  });

  it("pillar: at the target after 0.6 s of cracks, 35 and a launch, cover 1.2 × 1.2 × 2.5 for 4 s", () => {
    const { log, s } = play([at(-12)], 100, (k) => ({ q: k === 0, pitch: pitchTo(12, 0.5) }));
    expect(log).toContainEqual({ t: 0, e: expect.objectContaining({ type: "zone", kind: "pillar", phase: "telegraph" }) });
    expect(hitsOf(log, "stonePillar")[0]).toEqual({ t: 36, e: expect.objectContaining({ amount: 35, target: 2 }) });
    expect(log.some(({ e }) => e.type === "status" && e.status === "airborne" && e.target === 2)).toBe(true);
    const p = s.terrain.find((q) => q.kind === "pillar")!;
    const size = [p.box.max.y - p.box.min.y, p.box.max.x - p.box.min.x, (p.box.min.z + p.box.max.z) / 2].map((v) => Number(v.toFixed(6)));
    expect([size, p.endTick - p.bornTick]).toEqual([[2.5, 1.2, -12], 240]);
  });

  it("pillar needs ground underfoot, has a 10 s cooldown, and lifts its caster when cast underfoot", () => {
    const { log } = play([at(-12)], 700, (k) => ({ jump: k === 0, q: k === 5 || k === 100 || k === 640, pitch: pitchTo(12, 0.5) }));
    expect(log).toContainEqual(reject(5, "q", "notGrounded"));
    expect(ticksOf(log, "cast", "stonePillar")).toEqual([100]);
    expect(log).toContainEqual(reject(658, "q", "cooldown")); // нажатие на 640 ждёт в буфере 0,3 с, отказ — по его концу
    const self = play([], 120, (k) => ({ q: k === 0, pitch: -1.5 }));
    expect(self.log.some(({ e }) => e.type === "hit")).toBe(false);
    expect([self.s.units[0]!.move.onGround, Number(self.s.units[0]!.move.body.pos.y.toFixed(6))]).toEqual([true, 2.5]);
  });

  it("pillar «под себя» within 1 m: an aim 0.95 m away lifts the caster onto the top, 1.2 m away strikes there", () => {
    const centre = (s: MatchState) => {
      const b = s.terrain.find((q) => q.kind === "pillar")!.box;
      return [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2].map((v) => Number(v.toFixed(6)));
    };
    const feet = (s: MatchState) => [s.units[0]!.move.onGround, Number(s.units[0]!.move.body.pos.y.toFixed(6))];
    const near = play([], 120, (k) => ({ q: k === 0, pitch: -Math.atan2(1.6, 0.95) }));
    expect([centre(near.s), feet(near.s)]).toEqual([[0, 0], [true, 2.5]]);
    const far = play([], 120, (k) => ({ q: k === 0, pitch: -Math.atan2(1.6, 1.2) }));
    expect([centre(far.s), feet(far.s)]).toEqual([[0, -1.2], [true, 0]]);
  });

  it("buffers a Q pressed during the stone windup while LMB is held and casts it when the windup ends", () => {
    const { log } = play([], 40, (k) => ({ primary: true, q: k === 4, pitch: pitchTo(12, 0.5) }));
    expect([ticksOf(log, "release", "stoneShot"), ticksOf(log, "cast", "stonePillar"), log.filter(({ e }) => e.type === "reject")]).toEqual([[12], [13], []]);
  });

  it("stone wall: 2 m ahead, 4 × 2.5 × 0.6, solid after 0.2 s, holds stones until 250 HP are gone", () => {
    const b = play([], 1, () => ({ e: true })).s.terrain[0]!.box;
    expect([b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z].map((v) => Number(v.toFixed(6)))).toEqual([-2, 2, 0, 2.5, -2.3, -1.7]);
    const { log } = play([at(-6)], 380, (k) => ({ e: k === 0, primary: k >= 14 && k < 290, pitch: pitchTo(2, 1.2) }));
    const phase = (p: string) => log.find(({ e }) => e.type === "terrain" && e.phase === p)?.t;
    expect([phase("rise"), phase("solid"), phase("break") !== undefined]).toEqual([0, 12, true]);
    expect(log.some(({ e }) => e.type === "hit" && e.target === 2)).toBe(false);
  });

  it("earthquake: 0.4 s windup, 40 and a slow in 7 m, a root within 3 m, needs ground", () => {
    const { log, s } = play([at(-2), at(-5), at(-8)], 30, (k) => ({ c: k === 0 }));
    expect(hitsOf(log, "earthquake").map(({ t, e }) => [t, e.target, e.amount])).toEqual([[24, 2, 40], [24, 3, 40]]);
    expect([statusFlags(s.units[1]!, s.tick), statusFlags(s.units[2]!, s.tick)]).toEqual([
      expect.objectContaining({ slowed: true, rooted: true }),
      expect.objectContaining({ slowed: true, rooted: false }),
    ]);
    expect(play([], 10, (k) => ({ jump: k === 0, c: k === 3 })).log).toContainEqual(reject(3, "c", "notGrounded"));
  });

  it("card timings: wall grows 0.3 s and lives 6 s, E 12 s even in the air, C 14 s; the stone windup blocks Q and C; no target keeps Q", () => {
    const w = play([], 1, () => ({ e: true })).s.terrain[0]!;
    expect([w.kind, w.growTicks, w.solidTick - w.bornTick, w.endTick - w.bornTick, w.hp, w.maxHp]).toEqual(["wall", 18, 12, 360, 250, 250]);
    const air = play([], 730, (k) => ({ jump: k === 0, e: k === 5 || k === 723 || k === 725 }));
    // нажатие на 723 ждёт в буфере и выходит на 725, когда E готова: отказа нет
    expect([ticksOf(air.log, "cast", "stoneWall"), air.log.filter(({ e }) => e.type === "reject")]).toEqual([[5, 725], []]);
    const busy = play([], 870, (k) => ({ primary: k === 0, q: k === 6, c: k === 6 || k === 20 || k === 858 || k === 860 }));
    // Q и C в замахе камня (выпуск на 12) ждут в буфере и выходят на 13; C на 20 ждёт 0,3 с и отказывает на 38
    expect([ticksOf(busy.log, "cast", "stonePillar"), ticksOf(busy.log, "cast", "earthquake"), busy.log.filter(({ e }) => e.type === "reject")]).toEqual([
      [13],
      [13, 858],
      [reject(38, "c", "cooldown")],
    ]);
    const edge = play([], 2, () => ({ q: true, yaw: -Math.PI / 2 }), { pos: { x: 18, y: 0, z: 0 }, yaw: -Math.PI / 2 });
    expect(edge.log).toContainEqual(reject(0, "q", "noTarget"));
    expect(edge.s.units[0]!.mage!.ready.q).toBeLessThanOrEqual(edge.s.tick);
  });
});
