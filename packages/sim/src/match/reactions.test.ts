import { describe, expect, it } from "vitest";
import type { Spawn } from "../types";
import { buildTickWorld } from "./dynamic";
import { BOG, CC_LIMITS, EARTH, ticks } from "./defs";
import { testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { idleInput, unitById } from "./state";
import type { Element, MatchContext, MatchEvent, MatchInput, MatchState, TickCtx, UnitId } from "./types";
import { spawnZone } from "./zones";

/**
 * Отложенные реакции фазы 4 (GDD 4.6): «Топь» — Землетрясение по Роднику, «Огненный вал» — Порыв по Стене огня.
 * Результат — тому, чей эффект пришёл вторым, и он заменяет исходную зону, а не добавляется к ней.
 */

const ctx = testContext();
const spot = (x: number, z: number, yaw = 0): Spawn => ({ pos: { x, y: 0, z }, yaw });

function tickOf(s: MatchState, ev: MatchEvent[], c: MatchContext = ctx): TickCtx {
  const tw = buildTickWorld(c.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: c.killBelowY, now: s.tick, ev, spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0 };
}

type Log = { t: number; e: MatchEvent }[];
type Inputs = Partial<Record<UnitId, Partial<MatchInput>>>;
interface Setup {
  mages: { element: Element; spawn: Spawn }[];
  c?: MatchContext;
  /** Правка состояния после 5 тиков покоя, до первого тика сценария. */
  prep?: (s: MatchState, t: TickCtx) => void;
}
/** Маги (id 1…M); ввод по относительному тику k. log — с относительным тиком. */
function play(o: Setup, n: number, input: (k: number, s: MatchState) => Inputs = () => ({}), each?: (k: number, s: MatchState) => void) {
  const c = o.c ?? ctx;
  let s = createMatch({ mages: o.mages, dummies: [] });
  for (let k = 0; k < 5; k++) s = stepMatch(s, {}, c).state;
  o.prep?.(s, tickOf(s, [], c));
  const start = s.tick;
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const inputs: Partial<Record<UnitId, MatchInput>> = {};
    for (const [id, i] of Object.entries(input(k, s))) inputs[Number(id)] = { ...idleInput(unitById(s, Number(id))!), ...i };
    const r = stepMatch(s, inputs, c);
    s = r.state;
    for (const e of r.events) log.push({ t: k, e });
    each?.(k, s);
  }
  return { s, log, start };
}
const evs = <K extends MatchEvent["type"]>(log: Log, type: K) => log.flatMap(({ t, e }) => (e.type === type ? [{ t, e: e as Extract<MatchEvent, { type: K }> }] : []));
const u = (s: MatchState, id: UnitId) => unitById(s, id)!;

// ---------------------------------------------------------------- «Топь»

const WATER_ID = 1;
const EARTH_ID = 2;
const QUAKE_TICKS = ticks(EARTH.earthquake.telegraphS); // 24
const SPRING_LEFT = 360;

/** Родник Воды (id 1) в (0, 0, 0), уже взведён; сколько ему жить — springLeft тиков от начала сценария. */
function springAt(armIn = 0, springLeft = SPRING_LEFT, x = 0) {
  return (s: MatchState, t: TickCtx) => {
    spawnZone(s, t, {
      owner: WATER_ID, kind: "spring", ability: "spring", shape: { type: "disc", center: { x, y: 0, z: 0 }, radius: 4 },
      bornTick: s.tick - 24 + armIn, armTick: s.tick + armIn, endTick: s.tick + springLeft,
    });
  };
}
/** Вода в центре Родника, Земля в 3 м; Земля жмёт C на тике 0 — удар на тике 24. */
function quakeOnSpring(prep = springAt(), earthX = 0, n = QUAKE_TICKS + 1, each?: (k: number, s: MatchState) => void) {
  return play(
    { mages: [{ element: "water", spawn: spot(0, 0) }, { element: "earth", spawn: spot(earthX, -3) }], prep },
    n,
    (k) => (k === 0 ? { [EARTH_ID]: { c: true } } : {}),
    each,
  );
}

describe("reaction «Топь» (quake on spring)", () => {
  it("the quake strike on an armed spring replaces it with a bog owned by the Earth mage (second effect)", () => {
    const { s, log, start } = quakeOnSpring();
    const r = evs(log, "reaction");
    expect(r).toHaveLength(1);
    expect(r[0]!.t).toBe(QUAKE_TICKS);
    expect(r[0]!.e).toMatchObject({ kind: "bog", owner: EARTH_ID, pos: { x: 0, y: 0, z: 0 } });
    expect(s.zones.some((z) => z.kind === "spring")).toBe(false);
    const bog = s.zones.find((z) => z.kind === "bog")!;
    expect(bog).toBeDefined();
    expect(bog.id).toBe(r[0]!.e.zone);
    expect(bog.owner).toBe(EARTH_ID);
    expect(bog.shape).toEqual({ type: "disc", center: { x: 0, y: 0, z: 0 }, radius: 4 });
    // остаток Родника: тот же endTick
    expect(bog.endTick).toBe(start + SPRING_LEFT);
    // Родник снят событием zone/end на том же тике
    const springEnd = evs(log, "zone").find(({ e }) => e.kind === "spring" && e.phase === "end");
    expect(springEnd?.t).toBe(QUAKE_TICKS);
  });

  it("replaces rather than adds: the zone count does not grow", () => {
    let before = -1;
    let after = -1;
    quakeOnSpring(springAt(), 0, QUAKE_TICKS + 2, (k, s) => {
      if (k === QUAKE_TICKS - 1) before = s.zones.filter((z) => z.kind !== "quake").length;
      if (k === QUAKE_TICKS + 1) after = s.zones.length;
    });
    expect(before).toBe(1);
    expect(after).toBe(1); // землетрясение ушло, Родник стал Топью
  });

  it("a short-lived spring leaves a bog for at least 2 s", () => {
    const { s, start } = quakeOnSpring(springAt(0, QUAKE_TICKS + 10));
    const bog = s.zones.find((z) => z.kind === "bog")!;
    expect(bog.endTick).toBe(start + QUAKE_TICKS + ticks(BOG.minLifeS));
  });

  it("no bog from a spring still spreading (telegraph) or out of reach", () => {
    expect(evs(quakeOnSpring(springAt(QUAKE_TICKS + 5)).log, "reaction")).toHaveLength(0);
    // диски 7 + 4 м не пересекаются: Родник в 15 м
    expect(evs(quakeOnSpring(springAt(0, SPRING_LEFT, 15)).log, "reaction")).toHaveLength(0);
  });

  it("slows (40 %, CC limits) and wets the owner's enemies inside, again and again; no healing", () => {
    const at = QUAKE_TICKS + ticks(3.5); // замедление и Мокрый самого землетрясения и Родника уже сошли бы
    const { s, log } = quakeOnSpring(springAt(), 0, at + 1);
    const w = u(s, WATER_ID);
    const now = s.tick - 1;
    expect(w.status.slowMul).toBeCloseTo(BOG.slowMul, 9);
    expect(w.status.slowMul).toBeGreaterThanOrEqual(1 - CC_LIMITS.slowMaxFrac - 1e-9);
    expect(w.status.slowUntil - now).toBeGreaterThan(0);
    expect(w.status.slowUntil - now).toBeLessThanOrEqual(ticks(CC_LIMITS.slowMaxS) + 1);
    expect(w.status.wetUntil).toBeGreaterThan(now);
    expect(evs(log, "heal").filter(({ t }) => t > QUAKE_TICKS)).toHaveLength(0);
  });

  it("does not touch its owner (the Earth mage) standing inside", () => {
    const at = QUAKE_TICKS + ticks(3.5);
    const { s } = quakeOnSpring(springAt(), 0, at + 1);
    const e = u(s, EARTH_ID);
    const now = s.tick - 1;
    expect(e.status.slowUntil).toBeLessThanOrEqual(now);
    expect(e.status.wetUntil).toBeLessThanOrEqual(now);
  });

  it("the bog ends at its end tick", () => {
    const { s, log } = quakeOnSpring(springAt(0, QUAKE_TICKS + 10), 0, QUAKE_TICKS + ticks(BOG.minLifeS) + 2);
    expect(s.zones.some((z) => z.kind === "bog")).toBe(false);
    expect(evs(log, "zone").some(({ e }) => e.kind === "bog" && e.phase === "end")).toBe(true);
  });

  it("is deterministic", () => {
    const a = quakeOnSpring(springAt(), 0, QUAKE_TICKS + 60);
    const b = quakeOnSpring(springAt(), 0, QUAKE_TICKS + 60);
    expect(JSON.stringify(b.s)).toBe(JSON.stringify(a.s));
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
  });
});
