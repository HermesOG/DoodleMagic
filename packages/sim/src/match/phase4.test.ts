import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { lineOfSight, raycast } from "../raycast";
import { applyHit, applyStatus, flightTime, healUnit, knockbackSpeed, knockbackSpeedFor, launchUnit, pullMul, stepStatuses, type HitSpec } from "./combat";
import { dashSpeedAt, startDash, stepDash, type DashSpec } from "./dash";
import { ABILITY_OF, AIR, ELEMENT_INFO, ELEMENT_OF, KNOCKBACK, PROJECTILE_SOURCE, SLOT_CHARGES, STEAM, TELEGRAPH_MIN_S, WATER, slotCooldownTicks } from "./defs";
import { buildTickWorld } from "./dynamic";
import { FIRE_DASH } from "./fire";
import { testContext } from "./fixtures";
import { mergeHooks, NO_HOOKS, type ElementSim, type SimHooks } from "./hooks";
import { NO_KIT, refillCharges, spendCharge } from "./kit";
import { createMatch, stepMatch } from "./match";
import { PROJECTILE_DAMAGE, PROJECTILE_JUICE_M, spawnProjectile, stepProjectiles } from "./projectiles";
import { NO_MATCH_INPUT, createDummyUnit, createMageUnit, createMatchState, freshStatuses, statusFlags, unitById } from "./state";
import { ABILITY_IDS, ELEMENTS, NEVER, NOBODY, SLOTS, type Element, type MatchContext, type MatchEvent, type MatchInput, type MatchState, type TickCtx, type Unit, type UnitId } from "./types";
import { moveUnits, stepLife } from "./units";
import { spawnZone, stepZones } from "./zones";

const ctx = testContext();
/** Мир тика — как у stepMatch: статика плюс рельеф, стены огня и пар на начало тика. */
function tickOf(s: MatchState, ev: MatchEvent[], c: MatchContext = ctx): TickCtx {
  const tw = buildTickWorld(c.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: c.killBelowY, now: s.tick, ev, spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0 };
}
/** Тики в порядке stepMatch без китов: движение, снаряды, зоны, статусы, жизнь. */
function run(s: MatchState, n: number, o: { inputs?: Partial<Record<UnitId, MatchInput>>; c?: MatchContext; hooks?: SimHooks; each?: (s: MatchState) => void } = {}): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (let k = 0; k < n; k++) {
    const t = tickOf(s, ev, o.c);
    moveUnits(s, t, o.inputs ?? {}, o.hooks);
    stepProjectiles(s, t, o.hooks);
    stepZones(s, t, o.hooks);
    stepStatuses(s, t);
    stepLife(s, t);
    s.tick += 1;
    o.each?.(s);
  }
  return ev;
}
const FAR = { pos: { x: -30, y: 0, z: -30 }, yaw: 0 };
const mage = (el: Element = "fire", id = 1, spawn = FAR) => createMageUnit(id, el, spawn);
const dummy = (x: number, z = 0, id = 2, y = 0) => createDummyUnit(id, { pos: { x, y, z }, yaw: 0 });
const settled = (units: Unit[], c: MatchContext = ctx): MatchState => {
  const s = createMatchState(units);
  run(s, 5, { c });
  return s;
};
const u = (s: MatchState, id: UnitId) => unitById(s, id)!;
const hit = (s: MatchState, ev: MatchEvent[], over: Partial<HitSpec>, c: MatchContext = ctx): number =>
  applyHit(s, tickOf(s, ev, c), { source: 1, target: 2, ability: "fireball", damage: 0, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 1 }, ...over });
const ofType = <K extends MatchEvent["type"]>(ev: MatchEvent[], type: K) => ev.filter((e): e is Extract<MatchEvent, { type: K }> => e.type === type);

describe("phase 4 contracts", () => {
  it("has four elements in key order and 16 abilities, each in exactly one slot", () => {
    expect(ELEMENTS).toEqual(["fire", "earth", "air", "water"]);
    const ids = ELEMENTS.flatMap((e) => SLOTS.map((sl) => ABILITY_OF[e][sl]));
    expect([ids.length, new Set(ids).size, [...ids].sort()]).toEqual([16, 16, [...ABILITY_IDS].sort()]);
    for (const e of ELEMENTS) for (const sl of SLOTS) expect(ELEMENT_OF[ABILITY_OF[e][sl]]).toBe(e);
    expect([PROJECTILE_SOURCE.waterAnswer, PROJECTILE_SOURCE.airSickle, PROJECTILE_DAMAGE.airSickle, PROJECTILE_DAMAGE.waterGrab]).toEqual(["waterWard", "airSickle", 16, 25]);
    expect([PROJECTILE_JUICE_M.airSickle, PROJECTILE_JUICE_M.waterGrab, PROJECTILE_JUICE_M.waterAnswer].map((v) => Number(v.toFixed(12)))).toEqual([0.2, 0, 0]);
  });

  it("pins the Air and Water cards and the select screen (Р18)", () => {
    expect(ELEMENT_INFO.air).toEqual({ name: "Воздух", title: "Свобода", motto: "Летай и сдувай врагов с карты", stars: "★★", hp: 130, runSpeed: 7, ult: "Ураган" });
    expect(ELEMENT_INFO.water).toEqual({ name: "Вода", title: "Текучесть", motto: "Тяни к себе, возвращай удары", stars: "★★★", hp: 150, runSpeed: 6.5, ult: "Цунами" });
    expect(AIR).toEqual({
      hp: 130, runSpeed: 7,
      airSickle: { slot: "primary", name: "Воздушный серп", damage: 16, ratePerS: 3, projectile: { speed: 60, radiusM: 0.3, gravity: 0, rangeM: 40 }, knockback: { distM: 0.3, upM: 0 }, tempoRefS: 0.5 },
      gust: { slot: "q", name: "Порыв", cooldownS: 8, windupS: 0.4, rangeM: 7, halfAngleDeg: 30, halfHeightM: 2.5, damage: 10, knockback: { distM: 7, upM: 1 }, slamDamage: 20 },
      swoop: { slot: "e", name: "Взмах", distM: 8, durationS: 0.2, profile: 0.6, exitSpeed: 7, charges: 2, chargeS: 6 },
      tornado: {
        slot: "c", name: "Смерч", cooldownS: 18, rangeM: 20, growS: 0.5, lifeS: 4, radiusM: 5, belowM: 0.5, aboveM: 4, pullSpeed: 2.5,
        pulseS: 0.5, pulseDamage: 4, firePulseDamage: 8, coreRadiusM: 1.5, coreLiftM: 3, ownerLiftM: 2, ownerLiftEveryS: 1, fireReachM: 3,
      },
      passive: { name: "Лёгкость", doubleJumpM: 1.25, glideFallSpeed: 2.5, glideAirControl: 1, glideS: 3 },
    });
    expect(WATER).toEqual({
      hp: 150, runSpeed: 6.5,
      waterWhip: { slot: "primary", name: "Водяной хлыст", damage: 20, ratePerS: 2.5, windupS: 0.12, rangeM: 15, radiusM: 0.25, knockback: { distM: 0.3, upM: 0 }, tempoRefS: 0.5 },
      waterGrab: { slot: "q", name: "Хват", cooldownS: 8, windupS: 0.25, damage: 25, projectile: { speed: 28, radiusM: 0.4, gravity: 0, rangeM: 15 }, towSpeed: 20, towMaxM: 7, towStopM: 1.5, safeStepM: 0.25, safeDropM: 3 },
      waterWard: { slot: "e", name: "Отражение", cooldownS: 9, durationS: 1, runMul: 0.7, padM: 0.5, answer: { name: "Ответ", minDamage: 20, maxDamage: 60, projectile: { speed: 45, radiusM: 0.35, gravity: 0, rangeM: 30 } } },
      spring: { slot: "c", name: "Родник", cooldownS: 14, rangeM: 15, telegraphS: 0.4, radiusM: 4, heightM: 1.5, lifeS: 6, healPerS: 12, healPulseS: 0.25, slowMul: 0.7, slowAfterS: 0.5 },
      passive: { name: "Круговорот", wetS: 3, drainFrac: 0.2 },
    });
    expect(STEAM).toEqual({ radiusM: 2.5, heightM: 3, lifeS: 3, perArena: 4, everyS: 3 });
  });

  it("slot cooldowns: air 20/480/360/1080, water 24/480/540/840; telegraphs ≥ 0.4 s", () => {
    expect(SLOTS.map((sl) => slotCooldownTicks("air", sl))).toEqual([20, 480, 360, 1080]);
    expect(SLOTS.map((sl) => slotCooldownTicks("water", sl))).toEqual([24, 480, 540, 840]);
    for (const s of [AIR.gust.windupS, AIR.tornado.growS, WATER.spring.telegraphS]) expect(s).toBeGreaterThanOrEqual(TELEGRAPH_MIN_S);
  });

  it("an Air mage starts with two swoop charges, others with none; fresh units carry the new fields", () => {
    for (const e of ELEMENTS) {
      const m = mage(e).mage!;
      expect([m.charges, m.chargeAt, m.flight, m.ward, m.dash]).toEqual([
        { primary: 0, q: 0, e: e === "air" ? 2 : 0, c: 0 }, { primary: NEVER, q: NEVER, e: NEVER, c: NEVER }, { doubleJumped: false, glideTicks: 0, gliding: false }, null, null,
      ]);
      expect(m.charges).toEqual(SLOT_CHARGES[e]);
    }
    expect(freshStatuses()).toMatchObject({ wetUntil: 0, steamReadyAt: 0, staggerUntil: 0, anchoredUntil: 0 });
    const d = dummy(0);
    expect([d.tow, d.slam, statusFlags(d, 0).wet]).toEqual([null, null, false]);
    d.status.wetUntil = 10;
    expect([statusFlags(d, 9).wet, statusFlags(d, 10).wet]).toEqual([true, false]);
  });
});

describe("knockback v2 (K1, K2, honest flight)", () => {
  it("the old model is a special case: flight from the floor 2·√(2·up/g)", () => {
    expect(knockbackSpeed(3, 1.2)).toBe(knockbackSpeedFor(3, 2 * Math.sqrt((2 * 1.2) / 20)));
    expect(knockbackSpeedFor(3, 0)).toBeCloseTo(18, 9);
    expect([knockbackSpeedFor(0, 1), flightTime(0, 0), flightTime(-1, 0)]).toEqual([0, 0, 0]);
    expect(knockbackSpeedFor(3, Infinity)).toBeCloseTo(4.5, 12);
    expect(flightTime(0, 2)).toBeCloseTo(Math.sqrt(0.2), 12);
    expect(flightTime(5, 0)).toBeCloseTo(0.5, 12);
  });

  it("K1: a mage running at the source stops, gets 0.2 s of weak control and is still carried back ≥ 0.4 m", () => {
    const s = createMatchState([mage("fire", 1, { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }), mage("earth", 2, FAR)]);
    const fwd = { 1: { ...NO_MATCH_INPUT, moveZ: 1 } };
    run(s, 60, { inputs: fwd });
    const m = u(s, 1);
    expect(m.move.body.vel.z).toBeCloseTo(-6.5, 6);
    const t0 = s.tick;
    const z0 = m.move.body.pos.z;
    applyHit(s, tickOf(s, []), { source: 2, target: 1, ability: "fireball", damage: 0, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 1 }, knock: { distM: 4, upM: 1.5 } });
    expect([m.move.body.vel.z, m.status.staggerUntil, m.status.immuneUntil]).toEqual([0, t0 + 12, 0]);
    let back = 0;
    run(s, 90, { inputs: fwd, each: (st) => (back = Math.max(back, u(st, 1).move.body.pos.z - z0)) });
    expect(back).toBeGreaterThanOrEqual(0.4);
  });

  it("K1: a standing dummy slides 4 ± 0.35 m; a 0.3 m nudge does not stagger", () => {
    const s = settled([mage(), dummy(-10)]);
    hit(s, [], { knock: { distM: 4, upM: 1.5 } });
    run(s, 200);
    expect(Math.abs(u(s, 2).move.body.pos.z - 4)).toBeLessThan(0.35);
    const n = settled([mage(), dummy(-10)]);
    hit(n, [], { knock: { distM: 0.3, upM: 0 } });
    expect(u(n, 2).status.staggerUntil).toBe(0);
  });

  it("honest flight: from 2 m up a {3, 0} push lands 3 ± 0.35 m away; over the void the channel is 4.5 m/s; gliding — 18 m/s, ground decay", () => {
    const s = createMatchState([mage(), dummy(-10, 0, 2, 2)]);
    hit(s, [], { knock: { distM: 3, upM: 0 } });
    run(s, 200);
    expect(Math.abs(u(s, 2).move.body.pos.z - 3)).toBeLessThan(0.35);
    const v = createMatchState([mage(), dummy(25)]);
    hit(v, [], { knock: { distM: 3, upM: 0 } });
    expect(u(v, 2).kb.z).toBeCloseTo(4.5, 12);
    const g = createMatchState([mage(), mage("air", 2, { pos: { x: -10, y: 3, z: 0 }, yaw: 0 })]);
    u(g, 2).mage!.flight.gliding = true;
    hit(g, [], { knock: { distM: 3, upM: 0 } });
    expect(u(g, 2).kb.z).toBeCloseTo(18, 9);
    run(g, 1);
    expect(u(g, 2).kb.z).toBeCloseTo(18 * Math.exp(-KNOCKBACK.groundDecayPerS / 60), 9);
  });

  it("K2: in immunity a {2, 3.5} push gives {2, 1.75}; the anchor stops push, launch and tow, but damage and slow land", () => {
    const s = settled([mage(), dummy(-10)]);
    u(s, 2).status.immuneUntil = s.tick + 100;
    const ev: MatchEvent[] = [];
    hit(s, ev, { knock: { distM: 2, upM: 3.5 } });
    expect(ofType(ev, "hit")[0]!.knock).toEqual({ distM: 2, upM: 1.75 });
    const a = settled([mage(), dummy(-10)]);
    const d = u(a, 2);
    d.status.anchoredUntil = a.tick + 60;
    const ae: MatchEvent[] = [];
    hit(a, ae, { damage: 10, knock: { distM: 4, upM: 1.5 }, launch: true, slow: { mul: 0.7, s: 1 }, tow: { x: -10, z: -5, speed: 20, ticks: 30 } });
    expect([d.kb, d.move.body.vel.y, d.status.airborne, d.tow, d.hp, d.status.slowUntil > a.tick]).toEqual([{ x: 0, z: 0 }, 0, false, null, 160, true]);
    expect(ofType(ae, "hit")[0]!.knock).toEqual({ distM: 0, upM: 0 });
    expect(pullMul(d, a.tick)).toBe(0);
    expect([pullMul(mage("earth"), 0), pullMul(Object.assign(mage("earth"), { status: { ...freshStatuses(), immuneUntil: 5 } }), 0)]).toEqual([0.5, 0.25]);
  });

  it("wall slam: a {7, 1} push with slam 20 into a wall 3 m away adds one slam and +20; a wall at 8 m — none", () => {
    const near = testContext([{ box: aabb(-15, 0, 3.4, -5, 3, 4), tag: "wall" }]);
    const s = settled([mage(), dummy(-10)], near);
    const ev: MatchEvent[] = [];
    hit(s, ev, { ability: "gust", damage: 10, knock: { distM: 7, upM: 1 }, slam: 20 }, near);
    ev.push(...run(s, 120, { c: near }));
    expect(ofType(ev, "slam")).toEqual([expect.objectContaining({ target: 2, source: 1 })]);
    expect(ofType(ev, "hit").map((e) => e.amount)).toEqual([10, 20]);
    expect(u(s, 2).slam).toBeNull();
    const far = testContext([{ box: aabb(-15, 0, 8.4, -5, 3, 9), tag: "wall" }]);
    const f = settled([mage(), dummy(-10)], far);
    const fe: MatchEvent[] = [];
    hit(f, fe, { ability: "gust", damage: 10, knock: { distM: 7, upM: 1 }, slam: 20 }, far);
    fe.push(...run(f, 120, { c: far }));
    expect([ofType(fe, "slam"), ofType(fe, "hit").length, u(f, 2).slam]).toEqual([[], 1, null]);
  });
});

describe("knockback v2: review fixes", () => {
  const near = testContext([{ box: aabb(-15, 0, 3.4, -5, 3, 4), tag: "wall" }]);

  it("a later nudge under 1 m (the sickle's juice) keeps a pending wall slam; a new push ≥ 1 m without slam replaces it", () => {
    const s = settled([mage("air"), dummy(-10)], near);
    const ev: MatchEvent[] = [];
    hit(s, ev, { ability: "gust", damage: 10, knock: { distM: 7, upM: 1 }, slam: 20 }, near);
    hit(s, ev, { ability: "airSickle", damage: 16, knock: { distM: 0.2, upM: 0 } }, near);
    expect(u(s, 2).slam).toEqual({ by: 1, ability: "gust", damage: 20 });
    ev.push(...run(s, 120, { c: near }));
    expect([ofType(ev, "slam").length, ofType(ev, "hit").map((e) => e.amount)]).toEqual([1, [10, 16, 20]]);
    const r = settled([mage("air"), dummy(-10)], near);
    hit(r, [], { ability: "gust", damage: 10, knock: { distM: 7, upM: 1 }, slam: 20 }, near);
    hit(r, [], { ability: "fireball", knock: { distM: 4, upM: 1.5 } }, near);
    expect(u(r, 2).slam).toBeNull();
  });

  it("brushing a wall at full channel speed is not a slam: only the speed along the blocked axis counts", () => {
    const side = testContext([{ box: aabb(-9.55, 0, -20, -9, 3, 20), tag: "wall" }]); // грань x = −9,55: 0,05 м от бока
    const s = settled([mage("air"), dummy(-10)], side);
    const ev: MatchEvent[] = [];
    const l = Math.hypot(0.2, 1);
    hit(s, ev, { ability: "gust", damage: 10, dir: { x: 0.2 / l, z: 1 / l }, knock: { distM: 7, upM: 1 }, slam: 20 }, side);
    expect(Math.hypot(u(s, 2).kb.x, u(s, 2).kb.z)).toBeGreaterThan(KNOCKBACK.slamMinSpeed);
    expect(Math.abs(u(s, 2).kb.x)).toBeLessThan(KNOCKBACK.slamMinSpeed);
    ev.push(...run(s, 120, { c: side }));
    expect([ofType(ev, "slam"), ofType(ev, "hit").map((e) => e.amount), u(s, 2).move.body.pos.z > 5, u(s, 2).slam]).toEqual([[], [10], true, null]);
  });

  it("a gliding target launched upward flies honestly; one standing on a ledge edge flies from height 0", () => {
    const g = createMatchState([mage(), mage("air", 2, { pos: { x: -10, y: 3, z: 0 }, yaw: 0 })]);
    u(g, 2).mage!.flight.gliding = true;
    hit(g, [], { knock: { distM: 3, upM: 1 } });
    expect(u(g, 2).kb.z).toBeCloseTo(knockbackSpeedFor(3, flightTime(Math.sqrt(2 * 20 * 1), 3)), 9);
    expect(u(g, 2).kb.z).toBeLessThan(KNOCKBACK.slamMinSpeed);
    // центр манекена над пропастью (пол кончается на x = 20), стоит на кромке
    const e = settled([mage(), dummy(20.3)]);
    expect(u(e, 2).move.onGround).toBe(true);
    hit(e, [], { dir: { x: -1, z: 0 }, knock: { distM: 3, upM: 1.2 } });
    expect(u(e, 2).kb.x).toBeCloseTo(-knockbackSpeed(3, 1.2), 9);
  });
});

describe("wet and steam (Р9)", () => {
  const five = () => settled([mage(), ...[0, 1, 2, 3, 4].map((k) => dummy(-10 + 3 * k, 0, 2 + k))]);
  const steams = (s: MatchState) => s.zones.filter((z) => z.kind === "steam");

  it("a Water hit wets once; on a burning target it puts the fire out and makes steam", () => {
    const s = five();
    const ev: MatchEvent[] = [];
    hit(s, ev, { ability: "waterWhip", damage: 5 });
    hit(s, ev, { ability: "waterWhip", damage: 5 });
    expect([ofType(ev, "status").filter((e) => e.status === "wet").length, u(s, 2).status.wetUntil]).toEqual([1, s.tick + 180]);
    hit(s, ev, { target: 3, burn: true });
    expect(u(s, 3).status.burnPulses).toBe(6);
    hit(s, ev, { target: 3, ability: "waterWhip", damage: 5 });
    expect([u(s, 3).status.burnPulses, u(s, 3).status.burnBy, statusFlags(u(s, 3), s.tick).wet, steams(s).length]).toEqual([0, NOBODY, true, 1]);
    expect(ofType(ev, "reaction")).toEqual([{ type: "reaction", kind: "steam", owner: 1, zone: steams(s)[0]!.id, pos: expect.objectContaining({ x: -7 }) }]);
  });

  it("fire on a wet target dries it: no burning, steam from a fireball, none from fists; one steam per target per 3 s", () => {
    const s = five();
    const ev: MatchEvent[] = [];
    hit(s, ev, { ability: "waterWhip" });
    hit(s, ev, { ability: "fireball", burn: true });
    expect([statusFlags(u(s, 2), s.tick).wet, u(s, 2).status.burnPulses, steams(s).length, u(s, 2).status.steamReadyAt]).toEqual([false, 0, 1, s.tick + 180]);
    hit(s, ev, { target: 3, ability: "waterWhip" });
    hit(s, ev, { target: 3, ability: "fireFists" });
    expect([statusFlags(u(s, 3), s.tick).wet, steams(s).length]).toEqual([false, 1]);
    run(s, 10);
    hit(s, ev, { ability: "waterWhip" });
    hit(s, ev, { ability: "fireball", burn: true });
    expect([statusFlags(u(s, 2), s.tick).wet, u(s, 2).status.burnPulses, steams(s).length]).toEqual([false, 0, 1]);
  });

  it("the fifth steam pushes out the first; steam is outside the zone limits; it blocks sight but not shots", () => {
    const s = five();
    const t = tickOf(s, []);
    for (const k of [0, 1, 2]) spawnZone(s, t, { owner: 1, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: aabb(-35, 0, 10 * k, -25, 2.5, 10 * k + 0.6) }, bornTick: 0, armTick: 0, endTick: 1e6 });
    const ev: MatchEvent[] = [];
    for (const id of [2, 3, 4, 5, 6]) {
      hit(s, ev, { target: id, ability: "waterWhip" });
      hit(s, ev, { target: id, ability: "fireball", burn: true });
    }
    const first = ofType(ev, "reaction")[0]!.zone;
    expect([steams(s).length, s.zones.filter((z) => z.kind === "fireWall").length, steams(s).some((z) => z.id === first)]).toEqual([4, 3, false]);
    expect(ofType(ev, "zone").filter((e) => e.phase === "end").map((e) => e.zone)).toEqual([first]);
    const w = buildTickWorld(ctx.world, s).world;
    const c = steams(s)[3]!.shape;
    if (c.type !== "disc") throw new Error("disc expected");
    const a = { x: c.center.x, y: 1, z: -6 };
    const b = { x: c.center.x, y: 1, z: 6 };
    expect([lineOfSight(ctx.world, a, b), lineOfSight(w, a, b), raycast(w, a, { x: 0, y: 0, z: 1 }, 12, "shot")]).toEqual([true, false, null]);
  });
});

describe("heal, statuses, launch", () => {
  it("«Круговорот»: the first Water hit only wets, the next heals the source by 20 % of damage, above ⅔", () => {
    const s = settled([mage("water"), dummy(-10)]);
    u(s, 1).hp = 100;
    const ev: MatchEvent[] = [];
    hit(s, ev, { ability: "waterWhip", damage: 20 });
    expect([u(s, 1).hp, ofType(ev, "heal")]).toEqual([100, []]);
    hit(s, ev, { ability: "waterWhip", damage: 20 });
    expect([u(s, 1).hp, ofType(ev, "heal")]).toEqual([104, [{ type: "heal", target: 1, source: 1, amount: 4, pos: expect.any(Object) }]]);
  });

  it("healUnit stops at max HP and reports the actual amount", () => {
    const s = settled([mage("water")]);
    u(s, 1).hp = 148;
    const ev: MatchEvent[] = [];
    expect([healUnit(s, tickOf(s, ev), 1, 10, 1), u(s, 1).hp, healUnit(s, tickOf(s, ev), 1, 10, 1)]).toEqual([2, 150, 0]);
    expect(ofType(ev, "heal").map((e) => e.amount)).toEqual([2]);
  });

  it("applyStatus: slow and wet without a hit; status events only when newly applied; the spawn shield keeps them out", () => {
    const s = settled([mage("water"), dummy(-10)]);
    const ev: MatchEvent[] = [];
    applyStatus(s, tickOf(s, ev), 2, { source: 1, wetS: 0.5, slow: { mul: 0.7, s: 0.5 } });
    applyStatus(s, tickOf(s, ev), 2, { source: 1, wetS: 0.5, slow: { mul: 0.7, s: 0.5 } });
    expect([ofType(ev, "hit"), ofType(ev, "status").map((e) => e.status)]).toEqual([[], ["wet", "slow"]]);
    expect([u(s, 2).status.slowMul, u(s, 2).status.wetUntil, u(s, 2).hp]).toEqual([0.7, s.tick + 30, 170]);
    const sh = settled([mage("water"), dummy(-10)]);
    u(sh, 2).status.shieldUntil = sh.tick + 10;
    applyStatus(sh, tickOf(sh, []), 2, { source: 1, wetS: 1 });
    expect(u(sh, 2).status.wetUntil).toBe(0);
  });

  it("launchUnit: out of immunity it launches and sets immunity; Earth gets half; immune or anchored — false", () => {
    const s = settled([mage("air"), dummy(-10)]);
    const ev: MatchEvent[] = [];
    expect(launchUnit(s, tickOf(s, ev), 2, 3, 1)).toBe(true);
    const d = u(s, 2);
    expect([d.status.airborne, d.status.immuneUntil, d.lastHitBy, d.lastHitTick, ofType(ev, "status")[0]!.status]).toEqual([true, s.tick + 18 + 120, 1, s.tick, "airborne"]);
    expect(d.move.body.vel.y).toBeCloseTo(Math.sqrt(2 * 20 * 3), 9);
    expect(launchUnit(s, tickOf(s, ev), 2, 3, 1)).toBe(false);
    const e = settled([mage("air"), mage("earth", 2, { pos: { x: -10, y: 0, z: 0 }, yaw: 0 })]);
    expect(launchUnit(e, tickOf(e, []), 2, 3, 1)).toBe(true);
    expect(u(e, 2).move.body.vel.y).toBeCloseTo(Math.sqrt(2 * 20 * 1.5), 9);
    const a = settled([mage("air"), dummy(-10)]);
    u(a, 2).status.anchoredUntil = a.tick + 5;
    expect(launchUnit(a, tickOf(a, []), 2, 3, 1)).toBe(false);
  });
});

describe("tow (Р5, Р22)", () => {
  const grab = (s: MatchState, ev: MatchEvent[], target: UnitId, to: { x: number; z: number }, n: number) =>
    applyHit(s, tickOf(s, ev), { source: 1, target, ability: "waterGrab", damage: 25, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 0 }, tow: { ...to, speed: 20, ticks: n } });

  it("drags at 20 m/s at a constant height over the void; steps and jump are ignored, the view follows the input; immune until end + 120", () => {
    const s = createMatchState([mage("water"), mage("fire", 2, { pos: { x: 22, y: 0, z: 0 }, yaw: 0 })]);
    const ev: MatchEvent[] = [];
    grab(s, ev, 2, { x: 30, z: 0 }, 60);
    const v = u(s, 2);
    expect([v.tow?.endTick, v.status.immuneUntil, ofType(ev, "tow")[0]!.phase]).toEqual([s.tick + 60, s.tick + 60 + 120, "start"]);
    const xs: number[] = [];
    ev.push(...run(s, 6, { inputs: { 2: { ...NO_MATCH_INPUT, moveZ: 1, moveX: 1, jump: true, yaw: 1 } }, each: (st) => xs.push(u(st, 2).move.body.pos.x) }));
    expect(xs.map((x) => Number(x.toFixed(9)))).toEqual([1, 2, 3, 4, 5, 6].map((k) => Number((22 + k / 3).toFixed(9))));
    expect([v.move.body.pos.y, v.move.body.pos.z, v.move.yaw, v.move.jumpHeld]).toEqual([0, 0, 1, true]);
    ev.push(...run(s, 30, { inputs: { 2: NO_MATCH_INPUT } }));
    expect([v.tow, Number(v.move.body.pos.x.toFixed(6)), ofType(ev, "tow").map((e) => e.phase)]).toEqual([null, 30, ["start", "end"]]);
  });

  it("a wall stops it, endTick ends it", () => {
    const walled = testContext([{ box: aabb(-12, 0, 2.4, -8, 3, 3), tag: "wall" }]);
    const s = settled([mage("water"), dummy(-10)], walled);
    const ev: MatchEvent[] = [];
    applyHit(s, tickOf(s, ev, walled), { source: 1, target: 2, ability: "waterGrab", damage: 0, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 0 }, tow: { x: -10, z: 7, speed: 20, ticks: 60 } });
    ev.push(...run(s, 30, { c: walled }));
    expect([u(s, 2).tow, Number(u(s, 2).move.body.pos.z.toFixed(6)), ofType(ev, "tow").map((e) => e.phase)]).toEqual([null, 2, ["start", "end"]]);
    // буксир на 4 тика, наложен до движения тика: шаги на тиках 0…3, на последнем — tow/end
    const e = settled([mage("water"), dummy(-10)]);
    const ee: MatchEvent[] = [];
    grab(e, ee, 2, { x: -10, z: 30 }, 4);
    const zs: number[] = [];
    ee.push(...run(e, 10, { each: (st) => zs.push(u(st, 2).move.body.pos.z) }));
    expect([u(e, 2).tow, ofType(ee, "tow").map((x) => x.phase)]).toEqual([null, ["start", "end"]]);
    expect(zs.slice(0, 5).map((z) => Number(z.toFixed(6)))).toEqual([1, 2, 3, 4, 4].map((k) => Number((k / 3).toFixed(6))));
  });

  it("lasts at most 1 s (the root limit); death by damage or by a fall ends it with tow/end and drops a pending slam", () => {
    const s = settled([mage("water"), dummy(-10), dummy(-5, 0, 3)]);
    const ev: MatchEvent[] = [];
    grab(s, ev, 2, { x: -10, z: 30 }, 600);
    expect(u(s, 2).tow!.endTick).toBe(s.tick + 60);
    u(s, 2).slam = { by: 1, ability: "gust", damage: 20 };
    hit(s, ev, { damage: 1000 });
    expect([u(s, 2).alive, u(s, 2).tow, u(s, 2).slam, ev.filter((e) => e.type === "tow" || e.type === "death").map((e) => (e.type === "tow" ? `tow ${e.phase}` : e.type))]).toEqual([
      false, null, null, ["tow start", "tow end", "death"],
    ]);
    const fe: MatchEvent[] = [];
    grab(s, fe, 3, { x: -5, z: 30 }, 30);
    u(s, 3).slam = { by: 1, ability: "gust", damage: 20 };
    u(s, 3).move.body.pos = { x: 25, y: -5, z: 0 };
    stepLife(s, tickOf(s, fe));
    const trail = fe.filter((e) => e.type === "tow" || e.type === "fall").map((e) => (e.type === "tow" ? `tow ${e.phase}` : e.type));
    expect([u(s, 3).alive, u(s, 3).tow, u(s, 3).slam, trail]).toEqual([false, null, null, ["tow start", "tow end", "fall"]]);
  });

  it("the target's jet dash breaks the tow", () => {
    let s = createMatch({ mages: [{ element: "water", spawn: FAR }, { element: "fire", spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 } }], dummies: [] });
    for (let k = 0; k < 5; k++) s = stepMatch(s, {}, ctx).state;
    grab(s, [], 2, { x: 0, z: 7 }, 60);
    const r = stepMatch(s, { 2: { ...NO_MATCH_INPUT, e: true, moveX: 1 } }, ctx);
    const v = u(r.state, 2);
    expect([v.tow, v.mage!.dash?.ability, r.events.filter((e) => e.type === "tow" || e.type === "dash").map((e) => e.type)]).toEqual([null, "jetDash", ["tow", "dash"]]);
  });
});

describe("ward absorption (Р8)", () => {
  /** Маг Воды (id 1) в начале координат смотрит на −Z, у него диск; стрелок — id 2. */
  function warded(endIn: number) {
    const s = createMatchState([mage("water", 1, { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }), mage("fire", 2, FAR)]);
    run(s, 5);
    u(s, 1).mage!.ward = { endTick: s.tick + endIn, absorbed: 0 };
    return s;
  }
  const shoot = (s: MatchState, kind: "fireball" | "fireFists", z: number) => spawnProjectile(s, tickOf(s, []), 2, kind, { x: 0, y: 1, z }, { x: 0, y: 0, z: z < 0 ? 1 : -1 });

  it("eats a projectile from the front: no impact, no explosion, absorbed += power", () => {
    const s = warded(60);
    const id = shoot(s, "fireball", -6);
    const ev = run(s, 30);
    expect([ofType(ev, "absorb"), ofType(ev, "impact"), ofType(ev, "explosion"), ofType(ev, "hit")]).toEqual([
      [{ type: "absorb", unit: 1, projectile: id, kind: "fireball", owner: 2, amount: 50, total: 50, pos: expect.any(Object) }], [], [], [],
    ]);
    expect([u(s, 1).mage!.ward!.absorbed, s.projectiles]).toEqual([50, []]);
    const p = ofType(ev, "absorb")[0]!.pos;
    expect(p.z).toBeCloseTo(-0.4 - 0.45 - 0.5, 6); // тело раздуто на радиус шара и ещё на 0,5 м
  });

  it("a shot from behind or after the ward is gone hits as usual", () => {
    const back = warded(60);
    shoot(back, "fireFists", 6);
    const be = run(back, 30);
    expect([ofType(be, "absorb").length, ofType(be, "hit").map((e) => [e.target, e.ability])]).toEqual([0, [[1, "fireFists"]]]);
    const late = warded(1);
    shoot(late, "fireFists", -6);
    const le = run(late, 30);
    expect([ofType(le, "absorb").length, ofType(le, "hit").length]).toEqual([0, 1]);
  });
});

describe("slot charges", () => {
  it("two in a row, the third fails; they come back one by one after 360 and 720 ticks; ready follows", () => {
    const s = createMatchState([mage("air")]);
    const a = u(s, 1);
    const at = (now: number, ev: MatchEvent[] = []): TickCtx => ({ ...tickOf(s, ev), now });
    expect([spendCharge(at(0), a, "e", 360), spendCharge(at(1), a, "e", 360), spendCharge(at(2), a, "e", 360)]).toEqual([true, true, false]);
    expect([a.mage!.charges.e, a.mage!.chargeAt.e, a.mage!.ready.e]).toEqual([0, 360, 360]);
    const ev: MatchEvent[] = [];
    const back: number[] = [];
    for (let now = 2; now < 800; now++) {
      const before = ev.length;
      refillCharges(at(now, ev), a, "e", 2, 360);
      if (ev.length > before) back.push(now);
      if (now === 359) expect(a.mage!.ready.e).toBe(360);
      if (now === 360) expect(a.mage!.ready.e).toBe(360);
    }
    expect([back, ofType(ev, "charge").map((e) => e.charges), a.mage!.chargeAt.e, a.mage!.charges.e]).toEqual([[360, 720], [1, 2], NEVER, 2]);
  });
});

describe("dash v2 (A6)", () => {
  it("profile: ≈ 62 m/s on the first tick, ≈ 18 m/s on the last, 8 m in total", () => {
    expect([dashSpeedAt(FIRE_DASH, 0, 12), dashSpeedAt(FIRE_DASH, 11, 12)].map((v) => Number(v.toFixed(9)))).toEqual([62, 18]);
    let sum = 0;
    for (let k = 0; k < 12; k++) sum += dashSpeedAt(FIRE_DASH, k, 12) / 60;
    expect(sum).toBeCloseTo(8, 9);
  });

  it("jet dash: 8 ± 0.1 m in 12 ticks, slowing down, then 9 m/s out", () => {
    let s = createMatch({ mages: [{ element: "fire", spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 } }], dummies: [] });
    for (let k = 0; k < 5; k++) s = stepMatch(s, {}, ctx).state;
    const xs: number[] = [0];
    let end: Extract<MatchEvent, { type: "dash" }> | undefined;
    for (let k = 0; k < 12; k++) {
      const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, e: k === 0, moveX: k === 0 ? 1 : 0 } }, ctx);
      s = r.state;
      end = ofType(r.events, "dash").find((e) => e.phase === "end");
      xs.push(end ? end.pos.x : s.units[0]!.move.body.pos.x); // на последнем тике рывка тот же тик шагает и stepPlayer
    }
    const steps = xs.slice(1).map((x, k) => (x - xs[k]!) * 60);
    expect([steps[0]!, steps[11]!].map((v) => Number(v.toFixed(6)))).toEqual([62, 18]);
    expect(steps.every((v, k) => k === 0 || v < steps[k - 1]!)).toBe(true);
    expect(Math.abs(xs[12]! - 8)).toBeLessThan(0.1);
    // выход 9 м/с; тем же тиком обычное торможение без ввода (50 м/с²) уже сняло один тик
    expect([end?.ability, s.units[0]!.move.body.vel.x]).toEqual(["jetDash", 9 - 50 / 60]);
  });

  it("without a trail there is no zone and trailZone is NOBODY", () => {
    const spec: DashSpec = { ability: "swoop", distM: 8, durationS: 0.2, profile: 0.6, exitSpeed: 7, trail: null };
    const s = createMatchState([mage("air", 1, { pos: { x: 0, y: 0, z: 0 }, yaw: 0 })]);
    run(s, 5);
    const a = u(s, 1);
    const ev: MatchEvent[] = [];
    const inp = { ...NO_MATCH_INPUT, moveZ: 1 };
    startDash(s, tickOf(s, ev), a, inp, spec);
    expect([a.mage!.dash?.trailZone, s.zones]).toEqual([NOBODY, []]);
    for (let k = 0; k < 12 && a.mage!.dash; k++) {
      stepDash(s, tickOf(s, ev), a, inp, spec);
      s.tick += 1;
    }
    expect([a.mage!.dash, Number(a.move.body.pos.z.toFixed(6)), a.move.body.vel.z, ofType(ev, "dash").map((e) => [e.phase, e.ability])]).toEqual([null, -8, -7, [["end", "swoop"]]]);
  });
});

describe("element hooks", () => {
  it("mergeHooks wires move, zone and projectile hooks in their order; a kind claimed twice throws", () => {
    const calls: string[] = [];
    const fake: ElementSim = {
      kit: NO_KIT,
      move: {
        before: (x) => calls.push(`before ${x.move.body.pos.z.toFixed(3)}`),
        params: (_x, _t, _i, p) => {
          calls.push(`params ${p.runSpeed}`);
          return { ...p, runSpeed: 1 };
        },
        after: (x) => calls.push(`after ${x.move.body.pos.z.toFixed(3)}`),
      },
      zones: { tornado: (_s, _t, z) => void calls.push(`zone ${z.kind}`) },
      projectileHit: { airSickle: (_s, _t, p, h) => void calls.push(`hit ${p.ability} ${h.unit}`) },
    };
    const base = { fire: { kit: NO_KIT }, earth: { kit: NO_KIT }, water: { kit: NO_KIT } };
    const hooks = mergeHooks({ ...base, air: fake });
    const s = createMatchState([mage("air", 1, { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }), dummy(0, -5)]);
    run(s, 2, { hooks, inputs: { 1: { ...NO_MATCH_INPUT, moveZ: 1 } } });
    // before видит тело до шага, after — после stepPlayer с runSpeed из params
    expect(calls.map((c) => c.split(" ")[0])).toEqual(["before", "params", "after", "before", "params", "after"]);
    expect([calls[0], calls[1], calls[2] === calls[0]!.replace("before", "after"), calls[4]]).toEqual(["before 0.000", "params 7", false, "params 7"]);
    calls.length = 0;
    const t = tickOf(s, []);
    spawnZone(s, t, { owner: 1, kind: "tornado", ability: "tornado", shape: { type: "disc", center: { x: 10, y: 0, z: 10 }, radius: 5 }, bornTick: s.tick, armTick: s.tick, endTick: s.tick + 10 });
    spawnProjectile(s, t, 1, "airSickle", { x: 0, y: 1, z: -2 }, { x: 0, y: 0, z: -1 });
    const ev = run(s, 4, { hooks });
    expect([calls.filter((c) => !c.startsWith("before") && !c.startsWith("params") && !c.startsWith("after")), ofType(ev, "impact").map((e) => e.ability), ofType(ev, "hit")]).toEqual([
      ["zone tornado", "zone tornado", "hit airSickle 2", "zone tornado", "zone tornado"], ["airSickle"], [],
    ]);
    expect(() => mergeHooks({ ...base, earth: { kit: NO_KIT, zones: { tornado: () => undefined } }, air: fake })).toThrow();
    expect(() => mergeHooks({ ...base, water: { kit: NO_KIT, projectileHit: { airSickle: () => undefined } }, air: fake })).toThrow();
    expect(NO_HOOKS).toEqual({ move: {}, zones: {}, projectileHit: {} });
  });
});
