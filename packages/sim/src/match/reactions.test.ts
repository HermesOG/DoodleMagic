import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import type { Spawn } from "../types";
import { buildTickWorld } from "./dynamic";
import { AIR, BOG, BOIL_OFF, CC_LIMITS, EARTH, FIRE, LIMITS, RAMPART, STEAM, ticks } from "./defs";
import { testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { explodeFireball } from "./projectiles";
import { idleInput, unitById } from "./state";
import { spawnSteam } from "./steam";
import { NOBODY, type Element, type MatchContext, type MatchEvent, type MatchInput, type MatchState, type TickCtx, type UnitId } from "./types";
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

// ---------------------------------------------------------------- «Огненный вал»

const FIRE_ID = 1;
const AIR_ID = 2;
const GUST_TICKS = ticks(AIR.gust.windupS); // 24
const RAMPART_TICKS = ticks(RAMPART.durationS); // 60
const EAST = -Math.PI / 2;

/** Стена огня Огня (id 1) поперёк взгляда Воздуха: по X от −5 до 5, центр z = −4; взведена (или через armIn). */
function wallAt(armIn = 0, life = 600, box = aabb(-5, 0, -4.3, 5, FIRE.fireWall.heightM, -3.7)) {
  return (s: MatchState, t: TickCtx) => {
    spawnZone(s, t, {
      owner: FIRE_ID, kind: "fireWall", ability: "fireWall", shape: { type: "box", box },
      bornTick: s.tick - 24 + armIn, armTick: s.tick + armIn, endTick: s.tick + life,
    });
  };
}
interface GustSetup { prep?: (s: MatchState, t: TickCtx) => void; fire?: Spawn; air?: Spawn; c?: MatchContext; n?: number; each?: (k: number, s: MatchState) => void }
/** Огонь (id 1) и Воздух (id 2, смотрит на −Z); Воздух жмёт Q на тике 0 — выпуск на тике 24. */
function gustOnWall(o: GustSetup = {}) {
  return play(
    { mages: [{ element: "fire", spawn: o.fire ?? spot(0, -16) }, { element: "air", spawn: o.air ?? spot(0, 0) }], prep: o.prep ?? wallAt(), c: o.c },
    o.n ?? GUST_TICKS + RAMPART_TICKS + 10,
    (k) => (k === 0 ? { [AIR_ID]: { q: true } } : {}),
    o.each,
  );
}
const wallOf = (s: MatchState) => s.zones.find((z) => z.kind === "fireWall")!;
const boxOf = (s: MatchState) => {
  const z = wallOf(s);
  if (z.shape.type !== "box") throw new Error("not a box");
  return z.shape.box;
};

describe("reaction «Огненный вал» (gust on a fire wall)", () => {
  it("the gust release turns an armed fire wall into a rampart owned by Air (second effect), no new zone", () => {
    let zones = -1;
    const { s, log } = gustOnWall({ n: GUST_TICKS + 1, each: (k, st) => { if (k === GUST_TICKS - 1) zones = st.zones.length; } });
    const r = evs(log, "reaction");
    expect(r).toHaveLength(1);
    expect(r[0]!.t).toBe(GUST_TICKS);
    const w = wallOf(s);
    expect(r[0]!.e).toMatchObject({ kind: "fireRampart", owner: AIR_ID, zone: w.id });
    expect(w.owner).toBe(AIR_ID);
    expect(w.kind).toBe("fireWall");
    expect(s.zones.length).toBe(zones);
  });

  it("travels 8 m along the gust over 1 s, then stands until its normal end tick", () => {
    const life = GUST_TICKS + RAMPART_TICKS + 30;
    let mid = 0;
    const { s, start } = gustOnWall({ prep: wallAt(0, life), n: GUST_TICKS + RAMPART_TICKS + 5, each: (k, st) => { if (k === GUST_TICKS + 29) mid = (boxOf(st).min.z + boxOf(st).max.z) / 2; } });
    const b = boxOf(s);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(-4 - RAMPART.distM, 6);
    expect([b.min.x, b.max.x]).toEqual([-5, 5]);
    expect(mid).toBeCloseTo(-4 - RAMPART.distM / 2, 6);
    expect(wallOf(s).drift).toBeUndefined();
    expect(wallOf(s).endTick).toBe(start + life);
    const end = gustOnWall({ prep: wallAt(0, life), n: life + 1 });
    expect(end.s.zones.some((z) => z.kind === "fireWall")).toBe(false);
    expect(evs(end.log, "zone").find(({ e }) => e.kind === "fireWall" && e.phase === "end")?.t).toBe(life);
  });

  it("burns its former owner on the way (contact damage and Burning, credited to Air); never its new owner", () => {
    const { log } = gustOnWall({ fire: spot(0, -10) });
    const hits = evs(log, "hit").filter(({ e }) => e.ability === "fireWall");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.e).toMatchObject({ source: AIR_ID, target: FIRE_ID, amount: FIRE.fireWall.contactDamage });
    expect(evs(log, "status").some(({ e }) => e.target === FIRE_ID && e.status === "burning" && e.source === AIR_ID)).toBe(true);
    expect(evs(log, "hit").some(({ e }) => e.target === AIR_ID)).toBe(false);
  });

  it("stops at static geometry", () => {
    const c = testContext([{ box: aabb(-6, 0, -9.5, 6, 3, -9), tag: "block" }]);
    const { s } = gustOnWall({ c });
    const b = boxOf(s);
    expect(b.min.z).toBeGreaterThanOrEqual(-9 - 1e-6);
    expect(b.min.z).toBeLessThan(-9 + RAMPART.distM / RAMPART_TICKS + 1e-6);
    expect(wallOf(s).drift).toBeUndefined();
  });

  it("stops where there is no support under its middle (the floor ends at x = 20)", () => {
    const box = aabb(13.7, 0, -5, 14.3, FIRE.fireWall.heightM, 5);
    const { s } = gustOnWall({ prep: wallAt(0, 600, box), air: spot(10, 0, EAST), fire: spot(-10, 0) });
    const b = boxOf(s);
    const cx = (b.min.x + b.max.x) / 2;
    expect(cx).toBeGreaterThan(14 + 4);
    expect(cx).toBeLessThanOrEqual(20 + 1e-6);
  });

  it("no rampart from a wall still in telegraph or out of the cone", () => {
    expect(evs(gustOnWall({ prep: wallAt(GUST_TICKS + 5) }).log, "reaction")).toHaveLength(0);
    // стена за спиной Воздуха
    expect(evs(gustOnWall({ prep: wallAt(0, 600, aabb(-5, 0, 3.7, 5, FIRE.fireWall.heightM, 4.3)) }).log, "reaction")).toHaveLength(0);
  });

  it("needs a clear shot line from the eyes to the closest point of the wall: no rampart behind stone", () => {
    // камень выше глаз между Воздухом и стеной
    const tall = testContext([{ box: aabb(-6, 0, -2.5, 6, 3, -2), tag: "block" }]);
    const hidden = gustOnWall({ c: tall, n: GUST_TICKS + 5 });
    expect(evs(hidden.log, "reaction")).toHaveLength(0);
    expect(wallOf(hidden.s).owner).toBe(FIRE_ID);
    expect(wallOf(hidden.s).drift).toBeUndefined();
    // низкий камень луч не закрывает
    const low = testContext([{ box: aabb(-6, 0, -2.5, 6, 0.5, -2), tag: "block" }]);
    const seen = gustOnWall({ c: low, n: GUST_TICKS + 1 });
    expect(evs(seen.log, "reaction")).toHaveLength(1);
    expect(wallOf(seen.s).owner).toBe(AIR_ID);
  });

  it("does not re-push its own wall still travelling (no second reaction); a stopped own wall reacts again", () => {
    const drift = { x: 0, z: -RAMPART.distM / RAMPART_TICKS, untilTick: 0 };
    const ownWall = (travelling: boolean) => (s: MatchState, t: TickCtx) => {
      spawnZone(s, t, {
        owner: AIR_ID, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: aabb(-5, 0, -4.3, 5, FIRE.fireWall.heightM, -3.7) },
        bornTick: s.tick - 24, armTick: s.tick, endTick: s.tick + 600,
      });
      if (travelling) s.zones[s.zones.length - 1]!.drift = { ...drift, untilTick: s.tick + 600 };
    };
    let before: unknown = null;
    const moving = gustOnWall({ prep: ownWall(true), n: GUST_TICKS + 1, each: (k, st) => { if (k === GUST_TICKS - 1) before = { ...wallOf(st).drift }; } });
    expect(evs(moving.log, "reaction")).toHaveLength(0);
    expect(wallOf(moving.s).drift).toEqual(before);
    const stopped = gustOnWall({ prep: ownWall(false), n: GUST_TICKS + 1 });
    expect(evs(stopped.log, "reaction")).toHaveLength(1);
    expect(wallOf(stopped.s).drift).toBeDefined();
  });

  it("respects the per-mage zone limit: Air's oldest other zone gives way", () => {
    const prep = (s: MatchState, t: TickCtx) => {
      for (let k = 0; k < LIMITS.zonesPerMage; k++) {
        spawnZone(s, t, {
          owner: AIR_ID, kind: "tornado", ability: "tornado", shape: { type: "disc", center: { x: -30, y: 0, z: 10 * k - 20 }, radius: 5 },
          bornTick: s.tick, armTick: s.tick + 600, endTick: s.tick + 900,
        });
      }
      wallAt()(s, t);
    };
    const { s } = gustOnWall({ prep, n: GUST_TICKS + 1 });
    expect(s.zones.filter((z) => z.owner === AIR_ID)).toHaveLength(LIMITS.zonesPerMage);
    expect(wallOf(s).owner).toBe(AIR_ID);
  });

  it("is deterministic", () => {
    const a = gustOnWall({ fire: spot(0, -10) });
    const b = gustOnWall({ fire: spot(0, -10) });
    expect(JSON.stringify(b.s)).toBe(JSON.stringify(a.s));
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
  });
});

// ---------------------------------------------------------------- «Выкипание»

const BOIL_WATER = 1;
const BOIL_FIRE = 2;
const boilMages = (): Setup["mages"] => [{ element: "water", spawn: spot(-12, 12) }, { element: "fire", spawn: spot(12, 12) }];

/** Вода (id 1) и Огонь (id 2) в стороне; Родник Воды в (0, 0, 0) взведён, prep ставит что ещё нужно. */
function boilPlay(prep: (s: MatchState, t: TickCtx) => void, n = 2) {
  return play({ mages: boilMages(), prep: (s, t) => { springAt()(s, t); prep(s, t); } }, n);
}
/** Состояние с Родником (взведён через armIn) — для прямого взрыва шара. */
const springState = (armIn = 0) => play({ mages: boilMages(), prep: springAt(armIn) }, 0).s;
function blast(s: MatchState, pos: { x: number; y: number; z: number }) {
  const ev: MatchEvent[] = [];
  explodeFireball(s, tickOf(s, ev), BOIL_FIRE, pos, NOBODY, { x: 0, z: 0 });
  return ev;
}
const fireWallOver = (box = aabb(-5, 0, 1.7, 5, FIRE.fireWall.heightM, 2.3)) => (s: MatchState, t: TickCtx) => {
  spawnZone(s, t, { owner: BOIL_FIRE, kind: "fireWall", ability: "fireWall", shape: { type: "box", box }, bornTick: s.tick - 24, armTick: s.tick, endTick: s.tick + 300 });
};

describe("reaction «Выкипание» (fire on a spring)", () => {
  it("a fireball explosion boils an armed spring off: replaced by a 4 m steam cloud owned by Fire (second effect)", () => {
    const s = springState();
    const before = s.zones.length;
    const ev = blast(s, { x: 5, y: 0.3, z: 0 });
    const r = ev.flatMap((e) => (e.type === "reaction" ? [e] : []));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "boilOff", owner: BOIL_FIRE, pos: { x: 0, y: 0, z: 0 } });
    expect(s.zones.some((z) => z.kind === "spring")).toBe(false);
    const cloud = s.zones.find((z) => z.kind === "steam")!;
    expect(cloud.owner).toBe(BOIL_FIRE);
    expect(cloud.ability).toBe("fireball");
    expect(cloud.shape).toEqual({ type: "disc", center: { x: 0, y: 0, z: 0 }, radius: BOIL_OFF.radiusM });
    expect(cloud.endTick - s.tick).toBe(ticks(STEAM.lifeS));
    expect(r[0]!.zone).toBe(cloud.id);
    expect(ev.some((e) => e.type === "zone" && e.kind === "spring" && e.phase === "end")).toBe(true);
    expect(s.zones.length).toBe(before); // замена, а не добавка
  });

  it("no boil-off from a spring still spreading or out of the blast", () => {
    expect(blast(springState(5), { x: 0, y: 0.3, z: 0 }).some((e) => e.type === "reaction")).toBe(false);
    // 4 м Родника + 3 м взрыва < 7,5 м
    const far = springState();
    expect(blast(far, { x: 7.5, y: 0.3, z: 0 }).some((e) => e.type === "reaction")).toBe(false);
    expect(far.zones.some((z) => z.kind === "spring")).toBe(true);
  });

  it("a fire wall over an armed spring boils it off; the wall burns on, the steam is the wall owner's", () => {
    const { s, log } = boilPlay(fireWallOver());
    const r = evs(log, "reaction");
    expect(r).toHaveLength(1);
    expect(r[0]!.e).toMatchObject({ kind: "boilOff", owner: BOIL_FIRE });
    expect(s.zones.some((z) => z.kind === "spring")).toBe(false);
    expect(s.zones.some((z) => z.kind === "fireWall" && z.owner === BOIL_FIRE)).toBe(true);
    const cloud = s.zones.find((z) => z.kind === "steam")!;
    expect(cloud).toMatchObject({ owner: BOIL_FIRE, ability: "fireWall", id: r[0]!.e.zone });
    // стена в стороне Родник не трогает
    const away = boilPlay(fireWallOver(aabb(-5, 0, 5.7, 5, FIRE.fireWall.heightM, 6.3)));
    expect(evs(away.log, "reaction")).toHaveLength(0);
    expect(away.s.zones.some((z) => z.kind === "spring")).toBe(true);
  });

  it("respects the steam caps: at most 4 clouds on the arena (the oldest gives way) and one cloud per spring", () => {
    const s = springState();
    const t0 = tickOf(s, []);
    const first = spawnSteam(s, t0, { x: 20, y: 0, z: 20 }, BOIL_WATER, "waterWhip");
    for (let k = 1; k < STEAM.perArena; k++) spawnSteam(s, t0, { x: 20, y: 0, z: 20 - 6 * k }, BOIL_WATER, "waterWhip");
    const ev = blast(s, { x: 0, y: 0.3, z: 0 });
    expect(s.zones.filter((z) => z.kind === "steam")).toHaveLength(STEAM.perArena);
    expect(s.zones.some((z) => z.id === first)).toBe(false);
    expect(ev.some((e) => e.type === "zone" && e.zone === first && e.phase === "end")).toBe(true);
    // второй взрыв тут же: Родника уже нет — второго облака нет
    expect(blast(s, { x: 0, y: 0.3, z: 0 }).some((e) => e.type === "reaction")).toBe(false);
  });

  it("is deterministic", () => {
    const a = boilPlay(fireWallOver(), 60);
    const b = boilPlay(fireWallOver(), 60);
    expect(JSON.stringify(b.s)).toBe(JSON.stringify(a.s));
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
    const x = springState();
    const y = springState();
    expect(JSON.stringify(blast(y, { x: 2, y: 0.5, z: 1 }))).toBe(JSON.stringify(blast(x, { x: 2, y: 0.5, z: 1 })));
    expect(JSON.stringify(y)).toBe(JSON.stringify(x));
  });
});
