import { describe, expect, it } from "vitest";
import { applyHit, stepStatuses, type HitSpec } from "./combat";
import {
  ABILITY_NAME, ABILITY_OF, AIR, EARTH, ELEMENT_INFO, ELEMENT_OF, FIRE, KNOCKBACK, SLOT_CHARGES, ULT_CHARGE, ULT_MOVE, ULT_TIMING, WATER, isUlt,
  slotCooldownTicks,
} from "./defs";
import { buildTickWorld } from "./dynamic";
import { testContext } from "./fixtures";
import { createMatch, respawnMage, stepMatch } from "./match";
import { addMage, createGame, setElement } from "./rules";
import { NO_MATCH_INPUT, createDummyUnit, createMageUnit, createMatchState, unitById } from "./state";
import {
  ABILITY_IDS, ELEMENTS, NEVER, NOBODY, SLOTS, ULT_IDS,
  type Element, type MatchContext, type MatchEvent, type MatchInput, type MatchState, type TickCtx, type Unit, type UnitId,
} from "./types";
import { gainUlt } from "./ult";
import { stepLife } from "./units";

/** Фаза 5, задача 1: слот X, заряд ульты по GDD 3 (Р1, Р2, Р12), жизнь каста (Р3), порог толчка ульт (Р4). */
const ctx = testContext();
function tickOf(s: MatchState, ev: MatchEvent[], mul = 1, c: MatchContext = ctx): TickCtx {
  const tw = buildTickWorld(c.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: c.killBelowY, now: s.tick, ev, spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0, ultChargeMul: mul };
}
const mage = (id: UnitId, el: Element = "fire", x = -10 + 4 * id): Unit => createMageUnit(id, el, { pos: { x, y: 0, z: 0 }, yaw: 0 });
const dummy = (id: UnitId, x = 0, z = 10): Unit => createDummyUnit(id, { pos: { x, y: 0, z }, yaw: 0 });
const u = (s: MatchState, id: UnitId): Unit => unitById(s, id)!;
const charge = (s: MatchState, id: UnitId): number => u(s, id).mage!.ult.charge;
const hit = (s: MatchState, ev: MatchEvent[], over: Partial<HitSpec>, mul = 1): number =>
  applyHit(s, tickOf(s, ev, mul), { source: 1, target: 2, ability: "fireball", damage: 0, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 1 }, ...over });
const ults = (ev: MatchEvent[]) => ev.filter((e): e is Extract<MatchEvent, { type: "ult" }> => e.type === "ult");
const near = (v: number, want: number) => expect(v).toBeCloseTo(want, 9);

type Log = { t: number; e: MatchEvent }[];
/** n тиков stepMatch; ввод по номеру тика; события с номером тика. */
function steps(s: MatchState, n: number, input: (tick: number, s: MatchState) => Partial<Record<UnitId, MatchInput>> = () => ({}), c: MatchContext = ctx): { s: MatchState; log: Log } {
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const t = s.tick;
    const r = stepMatch(s, input(t, s), c);
    s = r.state;
    for (const e of r.events) log.push({ t, e });
  }
  return { s, log };
}
const inp = (over: Partial<MatchInput> = {}): MatchInput => ({ ...NO_MATCH_INPUT, ...over });
/** Маги стоят на полу; тик 1 — не кратный 360 (пассивный заряд не мешает). */
function standing(els: Element[]): MatchState {
  const s = createMatch({ mages: els.map((element, k) => ({ element, spawn: { pos: { x: -16 + 8 * k, y: 0, z: 0 }, yaw: 0 } })), dummies: [] });
  return steps(s, 2).s;
}
const horiz = (x: Unit): number => Math.sqrt(x.move.body.vel.x ** 2 + x.move.body.vel.z ** 2);

describe("phase 5 contracts", () => {
  it("has five slots, 20 abilities and an ult on X of every element", () => {
    expect(SLOTS).toEqual(["primary", "q", "e", "c", "x"]);
    expect([ABILITY_IDS.length, new Set(ABILITY_IDS).size]).toEqual([20, 20]);
    expect(ULT_IDS).toEqual(["dragonBreath", "tectonicRift", "hurricane", "tsunami"]);
    ELEMENTS.forEach((el, i) => {
      const ult = ULT_IDS[i]!;
      expect([ABILITY_OF[el].x, ABILITY_NAME[ult], ELEMENT_OF[ult], SLOT_CHARGES[el].x, slotCooldownTicks(el, "x")]).toEqual([ult, ELEMENT_INFO[el].ult, el, 0, 0]);
    });
    const ids = ELEMENTS.flatMap((e) => SLOTS.map((sl) => ABILITY_OF[e][sl]));
    expect([...ids].sort()).toEqual([...ABILITY_IDS].sort());
  });

  it("pins the four ult cards, the charge rule and the ult knockback cap", () => {
    expect(FIRE.dragonBreath).toEqual({ slot: "x", name: "Дыхание дракона", windupS: 0.6, channelS: 3, rangeM: 12, halfAngleDeg: 15, pulseTicks: 10, pulseDamage: 7.5, runMul: 0.6 });
    expect(EARTH.tectonicRift).toEqual({
      slot: "x", name: "Тектонический разлом", telegraphS: 0.8, startM: 1.5, lengthM: 25, halfWidthM: 1.5, belowM: 1.5, aboveM: 2,
      damage: 100, knockback: { distM: 1, upM: 5 }, spikesS: 6, spikesHalfWidthM: 0.75, spikesDamage: 20, spikesKnock: { distM: 3, upM: 0 }, spikesRehitS: 1,
    });
    expect(AIR.hurricane).toEqual({ slot: "x", name: "Ураган", windupS: 0.8, runMul: 0.5, radiusM: 10, halfHeightM: 4, damage: 60, knockback: { distM: 16, upM: 2 }, edgeKnockMul: 0.5, selfLiftM: 3, terrainDamage: 1000 });
    expect(WATER.tsunami).toEqual({ slot: "x", name: "Цунами", growS: 0.8, backM: 2, widthM: 14, depthM: 2, belowM: 1, heightM: 2.5, speed: 15, travelM: 30, damage: 80, knockback: { distM: 10, upM: 1 } });
    expect(ULT_CHARGE).toEqual({ max: 100, dealtPer: 15, takenPer: 30, kill: 6, assist: 3, passiveEveryS: 6, assistS: 5 });
    expect(KNOCKBACK.ultCapMul).toBe(1.5);
    // 45 урона/с: 7,5 за импульс раз в 10 тиков
    expect((FIRE.dragonBreath.pulseDamage * 60) / FIRE.dragonBreath.pulseTicks).toBe(45);
  });

  it("isUlt, telegraphs (Breath ≥ 0.6 s, others ≥ 0.8 s), timing and movement", () => {
    for (const a of ABILITY_IDS) expect(isUlt(a)).toBe((ULT_IDS as readonly string[]).includes(a));
    expect(isUlt("burning")).toBe(false);
    expect(FIRE.dragonBreath.windupS).toBeGreaterThanOrEqual(0.6);
    for (const s of [EARTH.tectonicRift.telegraphS, AIR.hurricane.windupS, WATER.tsunami.growS]) expect(s).toBeGreaterThanOrEqual(0.8);
    expect(ULT_TIMING).toEqual({
      dragonBreath: { windupTicks: 36, activeTicks: 180 }, tectonicRift: { windupTicks: 48, activeTicks: 1 },
      hurricane: { windupTicks: 48, activeTicks: 1 }, tsunami: { windupTicks: 48, activeTicks: 1 },
    });
    expect(ULT_MOVE).toEqual({
      dragonBreath: { runMul: 0.6, noJump: true, until: "end" }, tectonicRift: { runMul: 1, noJump: false, until: "release" },
      hurricane: { runMul: 0.5, noJump: true, until: "release" }, tsunami: { runMul: 1, noJump: false, until: "release" },
    });
  });

  it("a fresh mage has no charge and no cast; every unit starts with no hitters; all of it survives JSON", () => {
    for (const el of ELEMENTS) {
      const m = mage(1, el);
      expect([m.mage!.ult, m.hitters, m.mage!.ready.x, m.mage!.pending.x, m.mage!.held.x, m.mage!.charges.x, m.mage!.chargeAt.x]).toEqual([
        { charge: 0, cast: null }, [], 0, NEVER, false, 0, NEVER,
      ]);
    }
    expect(dummy(2).hitters).toEqual([]);
    expect(NO_MATCH_INPUT.x).toBe(false);
    const s = createMatchState([mage(1), dummy(2)]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe("ult charge (GDD 3, Р1)", () => {
  it("30 damage dealt to a dummy gives the source +2; 30 taken by a mage gives the target +1", () => {
    const s = createMatchState([mage(1), dummy(2), mage(3, "earth")]);
    const ev: MatchEvent[] = [];
    expect(hit(s, ev, { damage: 30 })).toBe(30);
    near(charge(s, 1), 2);
    expect(hit(s, ev, { target: 3, damage: 30 })).toBe(30);
    near(charge(s, 1), 4);
    near(charge(s, 3), 1);
    expect(u(s, 3).hitters).toEqual([{ unit: 1, tick: 0 }]);
  });

  it("burning charges the owner of the burn", () => {
    const s = createMatchState([mage(1), dummy(2)]);
    Object.assign(u(s, 2).status, { burnPulses: 1, burnNext: 0, burnBy: 1 });
    const ev: MatchEvent[] = [];
    stepStatuses(s, tickOf(s, ev));
    expect(ev.filter((e) => e.type === "hit").map((e) => (e.type === "hit" ? [e.source, e.ability, e.amount] : null))).toEqual([[1, "burning", 3]]);
    near(charge(s, 1), 3 / 15);
  });

  it("an ult's own damage charges the target but not the source", () => {
    const s = createMatchState([mage(1), mage(2, "earth")]);
    const ev: MatchEvent[] = [];
    for (const a of ULT_IDS) hit(s, ev, { ability: a, damage: 30 });
    expect(charge(s, 1)).toBe(0);
    near(charge(s, 2), 4);
  });

  it("a kill gives +6; an assist within 5 s gives +3, an older one 0; the killer gets no assist", () => {
    const s = createMatchState([mage(1), mage(2, "earth"), mage(3, "air"), dummy(4)]);
    const ev: MatchEvent[] = [];
    hit(s, ev, { source: 3, target: 4, damage: 15 }); // тик 0
    s.tick = 12;
    hit(s, ev, { source: 2, target: 4, damage: 15 });
    hit(s, ev, { source: 1, target: 4, damage: 15 });
    expect(u(s, 4).hitters.map((h) => h.unit).sort()).toEqual([1, 2, 3]);
    s.tick = 12 + 294; // 4,9 с после удара мага 2 и 5,1 с после удара мага 3
    u(s, 4).hp = 1;
    hit(s, ev, { source: 1, target: 4, damage: 15 });
    expect(u(s, 4).alive).toBe(false);
    near(charge(s, 1), 1 + 1 + 6);
    near(charge(s, 2), 1 + 3);
    near(charge(s, 3), 1);
    expect(u(s, 4).hitters).toEqual([]);
  });

  it("a credited fall gives +6 to the credited and +3 to the assist", () => {
    const s = createMatchState([mage(1), mage(2, "earth"), dummy(3)]);
    s.tick = 100;
    const d = u(s, 3);
    Object.assign(d, { lastHitBy: 1, lastHitTick: 90, hitters: [{ unit: 2, tick: 80 }, { unit: 1, tick: 90 }] });
    d.move.body.pos.y = -40;
    const ev: MatchEvent[] = [];
    stepLife(s, tickOf(s, ev));
    expect(ev.filter((e) => e.type === "fall")).toMatchObject([{ target: 3, credit: 1 }]);
    near(charge(s, 1), 6);
    near(charge(s, 2), 3);
    expect(u(s, 3).hitters).toEqual([]);
  });

  it("passive +1 on every tick 360·k to a living mage, none to a dead one; ×10 with ultChargeMul 10", () => {
    const run = (c: MatchContext, dead: boolean) => {
      let s = standing(["fire", "earth"]); // тик 0 тоже кратен 360: заряд с него обнуляем
      for (const x of s.units) x.mage!.ult.charge = 0;
      s = { ...s, tick: 358 };
      if (dead) Object.assign(s.units[1]!, { alive: false, hp: 0, respawnTick: 10_000 });
      s = steps(s, 2, () => ({}), c).s; // тики 358, 359
      const before = [charge(s, 1), charge(s, 2)];
      s = steps(s, 1, () => ({}), c).s; // тик 360
      return [before, [charge(s, 1), charge(s, 2)]];
    };
    expect(run(ctx, false)).toEqual([[0, 0], [1, 1]]);
    expect(run(ctx, true)).toEqual([[0, 0], [1, 0]]);
    expect(run({ ...ctx, ultChargeMul: 10 }, false)).toEqual([[0, 0], [10, 10]]);
  });

  it("caps at 100 and sends ult/ready once on crossing; ultChargeMul multiplies every gain", () => {
    const s = createMatchState([mage(1, "water"), dummy(2)]);
    u(s, 1).mage!.ult.charge = 99.5;
    const ev: MatchEvent[] = [];
    hit(s, ev, { damage: 75 }); // +5
    hit(s, ev, { damage: 75 });
    gainUlt(tickOf(s, ev), u(s, 1), 1);
    expect(charge(s, 1)).toBe(100);
    expect(ults(ev)).toMatchObject([{ unit: 1, ability: "tsunami", phase: "ready" }]);
    const t = createMatchState([mage(1), dummy(2)]);
    hit(t, [], { damage: 15 }, 10);
    near(charge(t, 1), 10);
  });
});

describe("ult charge across death and element switch (Р2)", () => {
  it("70 survives a death and the respawn", () => {
    let s = standing(["fire"]);
    u(s, 1).mage!.ult.charge = 70;
    u(s, 1).move.body.pos.y = -40;
    const r = steps(s, 70);
    s = r.s;
    expect(r.log.map((l) => l.e.type).filter((x) => x === "fall" || x === "respawn")).toEqual(["fall", "respawn"]);
    expect([u(s, 1).alive, u(s, 1).mage!.ult, u(s, 1).hitters]).toEqual([true, { charge: 70, cast: null }, []]);
  });

  it("setElement of a dead mage burns the charge; respawnMage keeps it only for the same element", () => {
    const pvp: MatchContext = { ...ctx, spawns: [{ pos: { x: -30, y: 0, z: -30 }, yaw: 0 }, { pos: { x: 10, y: 0, z: 30 }, yaw: 0 }], mageRespawnS: 3, spawnShieldS: 2 };
    const g = addMage(createGame(), "fire", pvp).game;
    const m = g.match.units[0]!;
    Object.assign(m, { alive: false, hp: 0, respawnTick: 100 });
    m.mage!.ult.charge = 70;
    m.mage!.ready = { primary: 5, q: 5, e: 5, c: 5, x: 5 };
    const sw = setElement(g, 1, "earth", pvp).match.units[0]!.mage!;
    expect([sw.element, sw.ready, sw.ult]).toEqual(["earth", { primary: 0, q: 0, e: 0, c: 0, x: 0 }, { charge: 0, cast: null }]);
    expect(setElement(g, 1, "fire", pvp).match.units[0]!.mage!.ult.charge).toBe(70);

    const s = createMatchState([mage(1)]);
    u(s, 1).mage!.ult.charge = 70;
    expect(u(respawnMage(s, 1, "fire"), 1).mage!.ult).toEqual({ charge: 70, cast: null });
    expect(u(respawnMage(s, 1, "air"), 1).mage!.ult).toEqual({ charge: 0, cast: null });
  });
});

describe("X: the ult cast (Р3)", () => {
  it("99 — reject uncharged on the press tick, nothing buffered", () => {
    let s = standing(["fire"]);
    u(s, 1).mage!.ult.charge = 99;
    const T = s.tick;
    const r = steps(s, 20, (t) => ({ 1: inp({ x: t === T }) }));
    s = r.s;
    expect(r.log.filter((l) => l.e.type === "reject" || l.e.type === "cast")).toEqual([{ t: T, e: { type: "reject", unit: 1, slot: "x", reason: "uncharged" } }]);
    expect([u(s, 1).mage!.pending.x, u(s, 1).mage!.ult]).toEqual([NEVER, { charge: 99, cast: null }]);
  });

  it.each(ELEMENTS.map((el, i) => [el, ULT_IDS[i]!] as const))("%s: 100 — cast on X, charge 0, release and end on time", (el, ult) => {
    let s = standing([el]);
    u(s, 1).mage!.ult.charge = 100;
    const T = s.tick;
    const tm = ULT_TIMING[ult];
    const end = T + tm.windupTicks + tm.activeTicks;
    const r1 = steps(s, 1, () => ({ 1: inp({ x: true }) }));
    s = r1.s;
    expect(r1.log.filter((l) => l.e.type === "cast")).toMatchObject([{ t: T, e: { type: "cast", unit: 1, ability: ult, slot: "x" } }]);
    // zone — зона ульты (Разлом, Цунами), если она есть; у прочих NOBODY
    const zone = s.zones.find((z) => z.owner === 1)?.id ?? NOBODY;
    expect(u(s, 1).mage!.ult).toEqual({ charge: 0, cast: { ability: ult, startTick: T, releaseTick: T + tm.windupTicks, endTick: end, zone } });
    const r = steps(s, end - T + 2, () => ({ 1: inp({ x: true }) }));
    expect(ults(r.log.map((l) => l.e)).filter((e) => e.unit === 1).map((e) => e.phase)).toEqual(["release", "end"]);
    expect(r.log.filter((l) => l.e.type === "ult" && l.e.unit === 1).map((l) => l.t)).toEqual([T + tm.windupTicks, end]);
    expect(u(r.s, 1).mage!.ult.cast).toBeNull();
  });

  it("during the cast LMB, Q, E and C are busy; a press near the end waits in the buffer", () => {
    let s = standing(["fire"]);
    u(s, 1).mage!.ult.charge = 100;
    const T = s.tick;
    const end = T + 216;
    const presses: Partial<Record<number, Partial<MatchInput>>> = { [T]: { x: true }, [T + 10]: { primary: true }, [T + 20]: { q: true }, [T + 30]: { e: true }, [T + 40]: { c: true }, [end - 10]: { q: true } };
    const r = steps(s, end - T + 5, (t) => ({ 1: inp(presses[t] ?? {}) }));
    const rej = r.log.filter((l) => l.e.type === "reject").map((l) => [l.t, l.e.type === "reject" ? [l.e.slot, l.e.reason] : null]);
    expect(rej).toEqual([[T + 10, ["primary", "busy"]], [T + 20, ["q", "busy"]], [T + 30, ["e", "busy"]], [T + 40, ["c", "busy"]]]);
    expect(r.log.filter((l) => l.e.type === "cast").map((l) => [l.t, l.e.type === "cast" ? l.e.ability : null])).toEqual([[T, "dragonBreath"], [end + 1, "fireball"]]);
  });

  it("a death mid-cast ends it on the next tick", () => {
    let s = standing(["air"]);
    u(s, 1).mage!.ult.charge = 100;
    const T = s.tick;
    s = steps(s, 5, (t) => ({ 1: inp({ x: t === T }) })).s;
    u(s, 1).move.body.pos.y = -40;
    const r = steps(s, 3);
    expect(r.log.filter((l) => l.e.type === "fall" || l.e.type === "ult").map((l) => [l.t, l.e.type])).toEqual([[T + 5, "fall"], [T + 6, "ult"]]);
    expect(ults(r.log.map((l) => l.e))).toMatchObject([{ unit: 1, ability: "hurricane", phase: "end" }]);
    expect(u(r.s, 1).mage!.ult.cast).toBeNull();
  });

  it("Fire runs ×0.6 and can't jump to the end; Air ×0.5 until release; Earth and Water as usual", () => {
    const speeds = (el: Element, at: number[], jumpAt = -1) => {
      let s = standing([el]);
      s = steps(s, 30, () => ({ 1: inp({ moveZ: 1 }) })).s; // разбег
      u(s, 1).mage!.ult.charge = 100;
      const T = s.tick;
      const out: number[] = [];
      let maxY = 0;
      for (let k = 0; k <= Math.max(...at); k++) {
        s = steps(s, 1, () => ({ 1: inp({ moveZ: 1, x: k === 0, jump: k === jumpAt || k === jumpAt + 1 }) })).s;
        maxY = Math.max(maxY, u(s, 1).move.body.pos.y);
        if (at.includes(k)) out.push(Number(horiz(u(s, 1)).toFixed(3)));
      }
      return { out, maxY, T };
    };
    const fire = speeds("fire", [30, 200], 100);
    expect(fire.out).toEqual([3.9, 3.9]);
    expect(fire.maxY).toBeLessThan(0.01);
    const air = speeds("air", [40]);
    expect(air.out).toEqual([3.5]);
    expect(speeds("earth", [30]).out).toEqual([6]);
    expect(speeds("water", [30]).out).toEqual([6.5]);
    // после конца Дыхания Огонь снова бежит 6,5 и прыгает
    const after = speeds("fire", [250], 230);
    expect(after.out).toEqual([6.5]);
    expect(after.maxY).toBeGreaterThan(0.5);
  });
});

describe("ult knockback cap (Р4)", () => {
  it("an ult's {20, 10} knocks a dummy {18, 9}; a non-ult — {12, 6}", () => {
    const knock = (ability: HitSpec["ability"]) => {
      const s = createMatchState([mage(1), dummy(2)]);
      const ev: MatchEvent[] = [];
      hit(s, ev, { ability, damage: 1, knock: { distM: 20, upM: 10 } });
      return ev.find((e) => e.type === "hit")!;
    };
    expect(knock("tectonicRift")).toMatchObject({ knock: { distM: 18, upM: 9 } });
    expect(knock("hurricane")).toMatchObject({ knock: { distM: 18, upM: 9 } });
    expect(knock("fireball")).toMatchObject({ knock: { distM: 12, upM: 6 } });
  });

  it("the knockback channel lets an ult carry 18 m along the floor; a non-ult stops at 12 m", () => {
    const slide = (ability: HitSpec["ability"]) => {
      let s = createMatchState([mage(1), dummy(2, -20, 10)]);
      s = steps(s, 3).s;
      const x0 = u(s, 2).move.body.pos.x;
      hit(s, [], { ability, damage: 1, knock: { distM: 20, upM: 0 }, dir: { x: 1, z: 0 } });
      s = steps(s, 180).s;
      return u(s, 2).move.body.pos.x - x0;
    };
    expect(slide("hurricane")).toBeCloseTo(18, 1);
    expect(slide("gust")).toBeCloseTo(12, 1);
  });
});

describe("phase 5 determinism", () => {
  it("600 ticks of four full-charge mages pressing X give byte-identical runs", () => {
    const run = () => {
      const s = standing(["fire", "earth", "air", "water"]);
      for (const x of s.units) x.mage!.ult.charge = 100;
      const r = steps(s, 600, (t) => {
        const ins: Partial<Record<UnitId, MatchInput>> = {};
        for (let id = 1; id <= 4; id++) ins[id] = inp({ x: t % 120 === 3 * id, moveZ: (t >> 5) % 2 === 0 ? 1 : -1, yaw: id + t * 0.01, primary: t % 50 < 3 });
        return ins;
      }, { ...ctx, ultChargeMul: 10 });
      return { json: JSON.stringify(r), ultCasts: r.log.filter((l) => l.e.type === "cast" && l.e.slot === "x").length };
    };
    const a = run();
    expect(a.json).toBe(run().json);
    expect(a.ultCasts).toBeGreaterThanOrEqual(4);
  });
});
