import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { forwardXZ } from "../player";
import type { Vec3 } from "../types";
import { EARTH, FIRE } from "./defs";
import { testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { NO_MATCH_INPUT, rightXZ, unitById } from "./state";
import type { DummySpot, Element, MatchContext, MatchEvent, MatchInput, MatchState, Unit, UnitId } from "./types";

/**
 * Фаза 5, задача 2: «Дыхание дракона» Огня (Р6) и «Тектонический разлом» Земли (Р7) на X.
 * Тики — относительные: k = 0 — тик нажатия X.
 */
const ctx = testContext();
type Log = { t: number; e: MatchEvent }[];
type Inputs = Partial<Record<UnitId, Partial<MatchInput>>>;

/** n тиков stepMatch: ввод по относительному тику k (поверх NO_MATCH_INPUT), события — с относительным тиком. */
function run(s: MatchState, n: number, input: (k: number, s: MatchState) => Inputs = () => ({}), c: MatchContext = ctx): { s: MatchState; log: Log } {
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const ins: Partial<Record<UnitId, MatchInput>> = {};
    for (const [id, i] of Object.entries(input(k, s))) ins[Number(id)] = { ...NO_MATCH_INPUT, ...i };
    const r = stepMatch(s, ins, c);
    s = r.state;
    for (const e of r.events) log.push({ t: k, e });
  }
  return { s, log };
}
type MageSpot = { element: Element; pos: Vec3; yaw: number };
/** Маги (id 1…M) и манекены (дальше); 5 тиков постоять; у манекенов 1000 HP; заряд: у мага 1 — 100, у прочих 0. */
function setup(mages: MageSpot[], dummies: DummySpot[], c: MatchContext = ctx): MatchState {
  const s0 = createMatch({ mages: mages.map((m) => ({ element: m.element, spawn: { pos: m.pos, yaw: m.yaw } })), dummies });
  const { s } = run(s0, 5, () => ({}), c);
  for (const x of s.units) {
    if (x.mage) x.mage.ult.charge = x.id === 1 ? 100 : 0;
    if (x.dummy) Object.assign(x, { hp: 1000, maxHp: 1000 });
  }
  return s;
}
const u = (s: MatchState, id: UnitId): Unit => unitById(s, id)!;
const hits = (log: Log, ability: string, target?: UnitId) =>
  log.flatMap(({ t, e }) => (e.type === "hit" && e.ability === ability && (target === undefined || e.target === target) ? [{ t, e }] : []));
const hitTicks = (log: Log, ability: string, target: UnitId) => hits(log, ability, target).map(({ t }) => t);
const statuses = (log: Log, status: string, target: UnitId) => log.filter(({ e }) => e.type === "status" && e.status === status && e.target === target).map(({ t }) => t);
/** Импульсы Дыхания: с конца вдоха (36) раз в 10 тиков до конца потока (216, не включая). */
const PULSES = Array.from({ length: 18 }, (_, k) => 36 + 10 * k);

// ---------------------------------------------------------------- Огонь

/** Огонь в начале координат смотрит вдоль −Z (yaw 0). */
const FIRE_MAGE: MageSpot = { element: "fire", pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
/** Наклон взгляда из глаз (1,6 м) на центр тела (0,9 м) в d метрах впереди. */
const pitchTo = (d: number, y = 0.9) => Math.atan2(y - 1.6, d);
/** Точка в d метрах от начала координат по forwardXZ(deg°): 0 — вдоль −Z, положительный угол — влево. */
const ahead = (d: number, deg = 0): Vec3 => {
  const f = forwardXZ((deg * Math.PI) / 180);
  return { x: d * f.x, y: 0, z: d * f.z };
};
const spot = (p: Vec3): DummySpot => ({ pos: p, yaw: 0 });
/** Огонь жмёт X на k = 0 и держит взгляд на манекен в 8 м по оси. */
const breathe = (over: (k: number) => Partial<MatchInput> = () => ({})) => (k: number): Inputs => ({ 1: { x: k === 0, pitch: pitchTo(8), ...over(k) } });

describe("«Дыхание дракона» (Fire X, Р6)", () => {
  it("0.6 s inhale with no damage, then 18 pulses of 7.5 with Burning in a 12 m, 15° cone; 20° off or 13 m away — missed", () => {
    // 2 — по оси в 8 м, 3 — 20° в 8 м, 4 — 12° в 8 м, 5 — по оси в 13 м, 6 — по оси в 11,5 м
    const s = setup([FIRE_MAGE], [spot(ahead(8)), spot(ahead(8, 20)), spot(ahead(8, 12)), spot(ahead(13)), spot(ahead(11.5))]);
    const { log } = run(s, 260, breathe());
    expect(log.filter(({ e }) => e.type === "cast")).toMatchObject([{ t: 0, e: { unit: 1, ability: "dragonBreath", slot: "x" } }]);
    expect(hits(log, "dragonBreath").every(({ t }) => t >= 36)).toBe(true);
    expect([2, 3, 4, 5, 6].map((id) => hitTicks(log, "dragonBreath", id))).toEqual([PULSES, [], PULSES, [], PULSES]);
    expect(hits(log, "dragonBreath").every(({ e }) => e.amount === FIRE.dragonBreath.pulseDamage && e.dot && e.source === 1)).toBe(true);
    expect(hits(log, "dragonBreath", 2).reduce((a, { e }) => a + e.amount, 0)).toBe(135);
    expect(statuses(log, "burning", 2)[0]).toBe(36);
    // поток толкать не должен
    expect(hits(log, "dragonBreath").every(({ e }) => e.knock.distM === 0 && e.knock.upM === 0)).toBe(true);
  });

  it("a crate in the way blocks the stream; a Fire wall does not", () => {
    const crate = testContext([{ box: aabb(-2, 0, -4.3, 2, 3, -3.7), tag: "crate" }]);
    const behindCrate = run(setup([FIRE_MAGE], [spot(ahead(8))], crate), 230, breathe(), crate);
    expect(hits(behindCrate.log, "dragonBreath")).toEqual([]);

    const s = setup([FIRE_MAGE], [spot(ahead(8))]);
    s.zones.push({
      id: s.nextId++, owner: 1, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: aabb(-5, 0, -4.3, 5, 2.5, -3.7) },
      bornTick: 0, armTick: 0, endTick: 10_000, rehit: [],
    });
    expect(hitTicks(run(s, 230, breathe()).log, "dragonBreath", 2)).toEqual(PULSES);
  });

  it("the cone follows the look: turning 90° right at k = 100 moves the stream to the other dummy", () => {
    const s = setup([FIRE_MAGE], [spot(ahead(8)), spot(ahead(8, -90))]);
    const { log } = run(s, 230, breathe((k) => ({ yaw: k < 100 ? 0 : -Math.PI / 2 })));
    expect([hitTicks(log, "dragonBreath", 2), hitTicks(log, "dragonBreath", 3)]).toEqual([PULSES.filter((k) => k < 100), PULSES.filter((k) => k >= 100)]);
  });

  it("a Water ward facing Fire lets nothing through and absorbs nothing; turned away — the stream burns", () => {
    const ward = (yaw: number) => {
      const s = setup([FIRE_MAGE, { element: "water", pos: ahead(8), yaw }], []);
      u(s, 2).mage!.ward = { endTick: 10_000, absorbed: 0 };
      const r = run(s, 230, breathe());
      return { n: hitTicks(r.log, "dragonBreath", 2).length, absorbed: u(r.s, 2).mage!.ward!.absorbed, absorbs: r.log.filter(({ e }) => e.type === "absorb").length };
    };
    expect(ward(Math.PI)).toEqual({ n: 0, absorbed: 0, absorbs: 0 }); // смотрит на Огонь (+Z)
    expect(ward(0)).toEqual({ n: 18, absorbed: 0, absorbs: 0 }); // спиной к Огню
  });

  it("a wet target dries on the first pulse with one steam cloud, then burns", () => {
    const s = setup([FIRE_MAGE], [spot(ahead(8))]);
    u(s, 2).status.wetUntil = s.tick + 10_000;
    const { s: end, log } = run(s, 230, breathe());
    const steam = log.filter(({ e }) => e.type === "reaction" && e.kind === "steam");
    expect(steam.map(({ t, e }) => [t, e.type === "reaction" ? e.owner : null])).toEqual([[36, 1]]);
    expect(statuses(log, "burning", 2)[0]).toBe(46);
    expect(end.units[1]!.status.wetUntil).toBeLessThanOrEqual(end.tick);
  });

  it("re-wetting the target every tick still gives one cloud per 3 s, and never Burning", () => {
    const s = setup([FIRE_MAGE], [spot(ahead(8))]);
    const { log } = run(s, 230, (k, cur) => {
      u(cur, 2).status.wetUntil = cur.tick + 100; // «Родник» под целью: снова мокрая к каждому тику
      return breathe()(k);
    });
    expect(log.filter(({ e }) => e.type === "reaction" && e.kind === "steam").length).toBe(1);
    expect(statuses(log, "burning", 2)).toEqual([]);
  });

  it("Fire walks ×0.6 and can't jump until the end; heat doesn't grow under a held LMB", () => {
    const s = setup([FIRE_MAGE], []);
    let maxY = 0;
    let speed = 0;
    let heat = -1;
    const { log } = run(s, 260, (k, cur) => {
      const me = u(cur, 1);
      if (k <= 216) maxY = Math.max(maxY, me.move.body.pos.y);
      if (k === 150) speed = Math.sqrt(me.move.body.vel.x ** 2 + me.move.body.vel.z ** 2);
      if (k === 200) heat = me.mage!.heat;
      return { 1: { x: k === 0, moveZ: 1, jump: k === 120 || k === 121, primary: k >= 1 } };
    });
    expect([Number(speed.toFixed(3)), maxY < 0.01, heat]).toEqual([3.9, true, 0]);
    expect(log.filter(({ e }) => e.type === "cast" && e.ability === "fireFists").map(({ t }) => t)[0]).toBe(217);
  });

  it("the caster's death mid-stream stops the pulses; the cast ends on the next tick", () => {
    const s = setup([FIRE_MAGE], [spot(ahead(8))]);
    const first = run(s, 100, breathe());
    expect(hitTicks(first.log, "dragonBreath", 2)).toEqual(PULSES.filter((k) => k < 100));
    u(first.s, 1).move.body.pos.y = -40;
    const after = run(first.s, 150, (k) => breathe()(k + 100));
    expect(hits(after.log, "dragonBreath")).toEqual([]);
    expect(after.log.filter(({ e }) => e.type === "fall" || e.type === "ult").map(({ t, e }) => [t, e.type])).toEqual([[0, "fall"], [1, "ult"]]);
  });

  it("the stream's own damage doesn't charge Fire (its Burning does, as any burn); a kill still refreshes E (Кураж)", () => {
    const s = setup([FIRE_MAGE], [spot(ahead(8))]);
    const { s: end, log } = run(s, 230, breathe());
    const burn = hits(log, "burning").reduce((a, { e }) => a + e.amount, 0);
    expect(end.units[0]!.mage!.ult.charge).toBeCloseTo(burn / 15, 9);

    const k = setup([FIRE_MAGE], [spot(ahead(8))]);
    Object.assign(u(k, 2), { hp: 10, maxHp: 10 }); // реген манекена — не выше maxHp
    u(k, 1).mage!.ready.e = 10_000;
    const r = run(k, 60, breathe());
    expect(r.log.filter(({ e }) => e.type === "death" || e.type === "courage").map(({ t, e }) => [t, e.type])).toEqual([[46, "death"], [46, "courage"]]);
    expect(u(r.s, 1).mage!.ready.e).toBeLessThanOrEqual(r.s.tick);
  });
});

// ---------------------------------------------------------------- Земля

/** Земля в (−20, 0, −10) смотрит под 30° к оси X: forwardXZ(−2π/3) = (cos 30°, sin 30°). */
const YAW = (-2 * Math.PI) / 3;
const P: Vec3 = { x: -20, y: 0, z: -10 };
const D = forwardXZ(YAW);
const R = rightXZ(YAW);
/** Точка в k метрах вдоль взгляда Земли и side метрах вправо от него. */
const along = (k: number, side = 0): Vec3 => ({ x: P.x + D.x * k + R.x * side, y: 0, z: P.z + D.z * k + R.z * side });
const EARTH_MAGE: MageSpot = { element: "earth", pos: P, yaw: YAW };
/** Земля жмёт X на k = 0 и стоит, глядя по YAW. */
const rift = (others: (k: number) => Inputs = () => ({})) => (k: number): Inputs => ({ 1: { x: k === 0, yaw: YAW }, ...others(k) });
const riftZone = (s: MatchState) => s.zones.find((z) => z.kind === "rift");
/** Расстояние вправо от линии разлома. */
const lateral = (x: Unit): number => (x.move.body.pos.x - P.x) * R.x + (x.move.body.pos.z - P.z) * R.z;

describe("«Тектонический разлом» (Earth X, Р7)", () => {
  it("in the air — reject notGrounded at once, the 100 charge stays", () => {
    const s = setup([EARTH_MAGE], []);
    const { s: end, log } = run(s, 20, (k) => ({ 1: { yaw: YAW, jump: k === 0, x: k === 5 } }));
    expect(log.filter(({ e }) => e.type === "reject" || e.type === "cast")).toEqual([{ t: 5, e: { type: "reject", unit: 1, slot: "x", reason: "notGrounded" } }]);
    expect([u(end, 1).mage!.ult, riftZone(end)]).toEqual([{ charge: 100, cast: null }, undefined]);
  });

  it("on the floor: a 25 m line along the look at 30° to the X axis, 1.5 m ahead; 0.8 s telegraph; 6 s of spikes, then gone", () => {
    const s = setup([EARTH_MAGE], []);
    const T = s.tick;
    const first = run(s, 1, rift());
    const z = riftZone(first.s)!;
    expect(z.shape.type).toBe("segment");
    if (z.shape.type !== "segment") return;
    const { a, b, halfW } = z.shape;
    const a0 = along(EARTH.tectonicRift.startM);
    const b0 = along(EARTH.tectonicRift.startM + EARTH.tectonicRift.lengthM);
    for (const [got, want] of [[a, a0], [b, b0]] as const) for (const c of ["x", "y", "z"] as const) expect(got[c]).toBeCloseTo(want[c], 9);
    expect(Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2)).toBeCloseTo(25, 9);
    expect((Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI).toBeCloseTo(30, 9);
    expect([halfW, z.owner, z.ability, z.bornTick - T, z.armTick - T, z.endTick - T]).toEqual([1.5, 1, "tectonicRift", 0, 48, 408]);
    expect(u(first.s, 1).mage!.ult.cast).toMatchObject({ ability: "tectonicRift", zone: z.id });
    const rest = run(first.s, 420, (k) => rift()(k + 1));
    const phases = [...first.log, ...rest.log.map(({ t, e }) => ({ t: t + 1, e }))].flatMap(({ t, e }) => (e.type === "zone" && e.kind === "rift" ? [[t, e.phase]] : []));
    expect(phases).toEqual([[0, "telegraph"], [48, "arm"], [408, "end"]]);
    const spikes = riftZone(run(first.s, 60, (k) => rift()(k + 1)).s)!;
    expect(spikes.shape.type === "segment" ? spikes.shape.halfW : null).toBe(EARTH.tectonicRift.spikesHalfWidthM);
  });

  it("strikes the line at the end of the crack: 100, Airborne, ≈ 5 m up, pushed off the line; 2 m to the side — untouched", () => {
    // 2 — на линии в 20 м, 3 — в 2 м вправо от линии в 10 м, 4 — в 1 м влево в 15 м
    const s = setup([EARTH_MAGE], [spot(along(20)), spot(along(10, 2)), spot(along(15, -1))]);
    let top = 0;
    const { log } = run(s, 420, (k, cur) => {
      top = Math.max(top, u(cur, 2).move.body.pos.y);
      return rift()(k);
    });
    expect(hits(log, "tectonicRift").every(({ t }) => t >= 48)).toBe(true);
    const strike = hits(log, "tectonicRift").filter(({ t }) => t === 48);
    expect(strike.map(({ e }) => [e.target, e.amount])).toEqual([[2, 100], [4, 100]]);
    const dirOf = (id: UnitId) => strike.find(({ e }) => e.target === id)!.e.dir;
    // на линии — вправо от взгляда; сбоку — от линии в свою сторону
    for (const [id, sign] of [[2, 1], [4, -1]] as const) {
      expect(dirOf(id).x).toBeCloseTo(sign * R.x, 9);
      expect(dirOf(id).z).toBeCloseTo(sign * R.z, 9);
    }
    expect(strike[0]!.e.knock).toEqual({ distM: 1, upM: 5 });
    expect(statuses(log, "airborne", 2)).toEqual([48]);
    expect(top).toBeCloseTo(5, 1);
    expect(hits(log, "tectonicRift", 3)).toEqual([]);
  });

  it("misses a target mid-jump over the line (spikes may still prick it); an Earth target flies only 2.5 m", () => {
    const s = setup([EARTH_MAGE, { element: "fire", pos: along(12), yaw: 0 }, { element: "earth", pos: along(20), yaw: 0 }], []);
    let top = 0;
    const { log } = run(s, 150, (k, cur) => {
      top = Math.max(top, u(cur, 3).move.body.pos.y);
      return rift((j) => ({ 2: { jump: j === 40 } }))(k);
    });
    expect(hits(log, "tectonicRift", 2).filter(({ e }) => e.amount === 100)).toEqual([]);
    expect(hits(log, "tectonicRift", 2).every(({ t, e }) => t > 48 && e.amount === 20)).toBe(true);
    expect(statuses(log, "airborne", 2)).toEqual([]);
    expect(hits(log, "tectonicRift", 3).map(({ t, e }) => [t, e.amount])[0]).toEqual([48, 100]);
    expect(top).toBeCloseTo(2.5, 1);
  });

  it("spikes: touching the strip after the strike — 20 and ≥ 2.5 m away from the line, again no sooner than 60 ticks", () => {
    // Огонь в 3 м вправо от линии смотрит на неё (forwardXZ(−π/6) = −R) и с k = 50 всё время идёт к ней
    // (перешёл линию — разворот: forwardXZ(5π/6) = R)
    const walker: MageSpot = { element: "fire", pos: along(10, 3), yaw: -Math.PI / 6 };
    const toLine = (w: Unit) => (lateral(w) > 0 ? -Math.PI / 6 : (5 * Math.PI) / 6);
    const keep = run(setup([EARTH_MAGE, walker], []), 420, (k, cur) => rift(() => ({ 2: { yaw: toLine(u(cur, 2)), moveZ: k >= 50 ? 1 : 0 } }))(k));
    const pricks = hits(keep.log, "tectonicRift", 2);
    expect(pricks.length).toBeGreaterThanOrEqual(4);
    expect(pricks.every(({ t, e }) => t > 48 && t < 408 && e.amount === EARTH.tectonicRift.spikesDamage && e.knock.distM === 3 && e.knock.upM === 0)).toBe(true);
    for (let k = 1; k < pricks.length; k++) expect(pricks[k]!.t - pricks[k - 1]!.t).toBeGreaterThanOrEqual(60);

    // тот же, но встаёт после первого укола: его уносит от линии
    const side: number[] = [];
    const stop = run(setup([EARTH_MAGE, walker], []), 200, (k, cur) => {
      const w = u(cur, 2);
      side.push(lateral(w));
      return rift(() => ({ 2: { yaw: -Math.PI / 6, moveZ: k >= 50 && w.hp === w.maxHp ? 1 : 0 } }))(k);
    });
    const t1 = hits(stop.log, "tectonicRift", 2)[0]!.t;
    const touch = side[t1 + 1]!; // после шага тика укола, до толчка: толчок едет со следующего тика
    expect(touch).toBeLessThanOrEqual(EARTH.tectonicRift.spikesHalfWidthM + 0.4 + 1e-9);
    expect(Math.max(...side.slice(t1 + 1)) - touch).toBeGreaterThanOrEqual(2.5);
  });
});

describe("Fire and Earth ults: determinism", () => {
  it("600 ticks of Fire and Earth casting their ults at dummies give byte-identical runs", () => {
    const go = () => {
      const s = setup(
        [{ element: "fire", pos: { x: -6, y: 0, z: 0 }, yaw: 0 }, { element: "earth", pos: { x: 6, y: 0, z: 0 }, yaw: 0 }],
        [spot({ x: -6, y: 0, z: -8 }), spot({ x: 6, y: 0, z: -15 }), { pos: { x: 0, y: 0, z: -10 }, yaw: 0, patrolHalfM: 4 }],
      );
      for (const x of s.units) if (x.mage) x.mage.ult.charge = 100;
      const r = run(
        s, 600,
        (t) => {
          const ins: Inputs = {};
          for (const id of [1, 2]) {
            const moving = t > 80;
            ins[id] = { x: t === 10 || t % 200 === 7 * id, yaw: moving ? 0.3 * Math.sin(t * 0.02 + id) : 0, pitch: pitchTo(8), moveZ: moving && (t >> 5) % 2 === 0 ? 1 : 0, primary: t % 90 < 4 };
          }
          return ins;
        },
        { ...ctx, ultChargeMul: 10 },
      );
      return { json: JSON.stringify(r), breath: hits(r.log, "dragonBreath").length, rift: hits(r.log, "tectonicRift").length };
    };
    const a = go();
    expect(a.json).toBe(go().json);
    expect(a.breath).toBeGreaterThanOrEqual(4);
    expect(a.rift).toBeGreaterThanOrEqual(1);
  });
});
