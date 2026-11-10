import { describe, expect, it } from "vitest";
import { NOBODY, createDummyUnit, createMageUnit, createMatchState, type MatchEvent, type MatchState, type UltId, type Unit, type Zone } from "@doodlemagic/sim";
import { RECIPES, SOUND_ELEMENT, bandOf, recipeLength } from "../audio/recipes";
import { MAX_BURST, burstParticles } from "../fx/presets";
import { SHAKE } from "./camera";
import type { Effect } from "./effects";
import { BREATH_TRAUMA, RIFT_BURSTS, RIFT_NEAR_TRAUMA, ROAR_GRAIN_S, createUltFrame, effectsFor, hitTier } from "./eventMap";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 3;
const DUMMY = 5;

/** Я — Огонь у начала координат, OTHER — Земля в 8 м, манекен впереди. */
function world(meEl: "fire" | "earth" = "fire", otherEl: "fire" | "earth" = "earth"): MatchState {
  return createMatchState([
    createMageUnit(ME, meEl, { pos: V(), yaw: 0 }),
    createMageUnit(OTHER, otherEl, { pos: V(6, 0, -8), yaw: 0.4 }),
    createDummyUnit(DUMMY, { pos: V(0, 0, -6), yaw: 0 }),
  ]);
}
const at = (s: MatchState, tick: number): MatchState => ({ ...s, tick });
const fx = (ev: MatchEvent, s: MatchState = world()): Effect[] => effectsFor(ev, { localId: ME, state: s });
const kinds = (out: Effect[]) => out.map((e) => e.kind);
const sounds = (out: Effect[]) => out.filter((e): e is Extract<Effect, { kind: "sound" }> => e.kind === "sound");
const castX = (unit: number, ability: UltId): MatchEvent => ({ type: "cast", unit, ability, slot: "x", pos: V(6, 1.6, -8), dir: V(0, 0, -1) });
const ult = (unit: number, ability: UltId, phase: "release" | "end"): MatchEvent => ({ type: "ult", unit, ability, phase, pos: V(0, 1.6, 0), dir: V(0, 0, -1) });
const hit = (o: Partial<Extract<MatchEvent, { type: "hit" }>>): Extract<MatchEvent, { type: "hit" }> => ({
  type: "hit", source: ME, target: DUMMY, ability: "dragonBreath", amount: 7.5, pos: V(0, 1, -6), dir: V(0, 0, -1), knock: { distM: 0, upM: 0 },
  airborne: false, dot: true, killed: false, ...o,
});
const riftZone = (owner: number): Zone => ({
  id: 11, owner, kind: "rift", ability: "tectonicRift", shape: { type: "segment", a: V(6, 0, -9.5), b: V(6, 0, -34.5), halfW: 1.5 },
  bornTick: 100, armTick: 148, endTick: 508, rehit: [],
});
const zoneEv = (owner: number, phase: "telegraph" | "arm" | "end"): MatchEvent => ({ type: "zone", zone: 11, kind: "rift", owner, phase });
const withZone = (s: MatchState, z: Zone): MatchState => ({ ...s, zones: [z] });

describe("Fire and Earth ults: casts", () => {
  it("my Breath: gesture first, palms charge, the inhale at my ear, a small kick; no map-wide warning", () => {
    const out = fx(castX(ME, "dragonBreath"));
    expect(out[0]).toEqual({ kind: "gesture", ability: "dragonBreath" });
    expect(out[1]).toEqual({ kind: "palm", hand: "both", element: "fire", preset: "charge" });
    expect(sounds(out)).toEqual([{ kind: "sound", id: "breathInhale", pos: null, gain: 1 }]);
    expect(kinds(out)).toContain("kick");
  });

  it("someone else's Breath or Rift: the shared warning across the map, then only the sound where he casts", () => {
    for (const [a, id] of [["dragonBreath", "breathInhale"], ["tectonicRift", "riftRumble"]] as const) {
      const out = fx(castX(OTHER, a));
      expect(out).toEqual([
        { kind: "sound", id: "ultWarn", pos: null, gain: 1 },
        { kind: "sound", id, pos: V(6, 1.6, -8), gain: 1 },
      ]);
    }
  });

  it("my Rift: palms slam the floor — the rumble at my ear, the camera down, an Earth shake", () => {
    const out = fx(castX(ME, "tectonicRift"), world("earth", "fire"));
    expect(out[0]).toEqual({ kind: "gesture", ability: "tectonicRift" });
    expect(sounds(out).map((e) => [e.id, e.pos])).toEqual([["riftRumble", null]]);
    expect(out).toContainEqual({ kind: "kick", pitchDeg: -1.2, yawDeg: 0, rollDeg: 0, dropM: 0.04 });
    expect(out).toContainEqual({ kind: "trauma", amount: 0.2, profile: "earth" });
  });
});

describe("Fire and Earth ults: dragon breath", () => {
  it("my exhale: flame off the hands, a kick, FOV +4° and a 0.3 shake; his exhale — only the flame in the world; the end is silent", () => {
    const mine = fx(ult(ME, "dragonBreath", "release"));
    expect(mine[0]).toMatchObject({ kind: "burst", preset: "breathFlare" });
    expect(mine).toContainEqual({ kind: "fov", deg: 4 });
    expect(mine).toContainEqual({ kind: "trauma", amount: BREATH_TRAUMA });
    const theirs = fx(ult(OTHER, "dragonBreath", "release"));
    expect(kinds(theirs)).toEqual(["burst"]);
    expect([fx(ult(ME, "dragonBreath", "end")), fx(ult(OTHER, "dragonBreath", "end")), fx(ult(ME, "tectonicRift", "release"))]).toEqual([[], [], []]);
  });

  it("stream pulses stay a sustained effect: no large hitmarker or hitstop, a fire flash on the target at most 3 times a second", () => {
    // 18 импульсов потока раз в 10 тиков с выдоха (releaseTick 136): состояние события — тик после шага импульса
    const s = world();
    let flashes = 0;
    let markers = 0;
    for (let k = 0; k < 18; k++) {
      const out = fx(hit({}), at(s, 136 + 10 * k + 1));
      expect(kinds(out)).toContain("number");
      expect(out.some((e) => e.kind === "hitstop" || (e.kind === "hitmarker" && e.tier === "large"))).toBe(false);
      flashes += out.filter((e) => e.kind === "burst" && e.preset === "breathHit").length;
      markers += out.filter((e) => e.kind === "hitmarker").length;
    }
    expect(flashes).toBe(9);
    expect(markers).toBe(9);
    expect(hitTier(hit({}))).toBe("none");
  });

  it("someone else's stream on me: where it burns from and a light shake on the flash, nothing on the other pulses", () => {
    const onMe = (tick: number) => fx(hit({ source: OTHER, target: ME }), at(world(), tick));
    const beat = [onMe(137), onMe(147)];
    const on = beat.find((o) => o.some((e) => e.kind === "indicator"))!;
    const off = beat.find((o) => o !== on)!;
    expect(kinds(on)).toEqual(["burst", "indicator", "trauma"]);
    expect(off).toEqual([]);
  });

  it("a kill with an ult toasts its name to the killer; a burning kill or someone else's kill does not", () => {
    const death = (killer: number, ability: "dragonBreath" | "tectonicRift" | "burning"): MatchEvent => ({ type: "death", target: DUMMY, killer, ability, pos: V(0, 1, -6) });
    expect(fx(death(ME, "dragonBreath"))).toContainEqual({ kind: "toast", text: "Дыхание дракона!" });
    expect(fx(death(ME, "tectonicRift"), world("earth"))).toContainEqual({ kind: "toast", text: "Разлом!" });
    expect(kinds(fx(death(ME, "burning")))).toEqual(["burst", "sound"]);
    expect(kinds(fx(death(OTHER, "tectonicRift")))).toEqual(["burst"]);
  });
});

describe("Fire and Earth ults: tectonic rift", () => {
  it("the strike is the large tier: hitstop 90 ms, a hard flinch and a heavy confirm; the spikes later are medium", () => {
    const strike = hit({ ability: "tectonicRift", amount: 100, dot: false, knock: { distM: 1, upM: 5 } });
    const spike = hit({ ability: "tectonicRift", amount: 20, dot: false, knock: { distM: 3, upM: 0 } });
    expect([hitTier(strike), hitTier(spike), hitTier({ ...spike, amount: 23 })]).toEqual(["large", "medium", "medium"]);
    const out = fx(strike, world("earth"));
    expect(out).toContainEqual({ kind: "hitmarker", kill: false, air: false, tier: "large" });
    expect(out).toContainEqual({ kind: "hitstop", ms: 90 });
    expect(out.find((e) => e.kind === "flinch")).toMatchObject({ amount: 0.8 });
    expect(sounds(out).map((e) => e.id)).toEqual(["hitHeavy"]);
    const later = fx(spike, world("earth"));
    expect(later).toContainEqual({ kind: "hitstop", ms: 60 });
    expect(later).toContainEqual({ kind: "hitmarker", kill: false, air: false, tier: "medium" });
  });

  it("struck by someone's Rift: the rest of the large shake on the Earth profile, FOV +10° and a whoosh", () => {
    const out = fx(hit({ source: OTHER, target: ME, ability: "tectonicRift", amount: 100, dot: false, knock: { distM: 1, upM: 5 } }));
    const trauma = out.find((e) => e.kind === "trauma");
    expect(trauma).toMatchObject({ profile: "earth" });
    expect((trauma as { amount: number }).amount + RIFT_NEAR_TRAUMA).toBeCloseTo(0.8);
    expect(out).toContainEqual({ kind: "fov", deg: 10 });
    expect(sounds(out).map((e) => e.id)).toContain("knockWhoosh");
  });

  it("the crack telegraph cracks the floor at the caster's feet; the strike bursts along the whole line within 150 particles", () => {
    const s = withZone(world("earth", "fire"), riftZone(ME));
    expect(fx(zoneEv(ME, "telegraph"), s)).toEqual([{ kind: "burst", preset: "riftCrack", pos: V(6, 0, -9.5), dir: V(0, 1, 0), scale: 1 }]);
    const out = fx(zoneEv(ME, "arm"), s);
    const bursts = out.filter((e): e is Extract<Effect, { kind: "burst" }> => e.kind === "burst");
    expect(bursts.length).toBe(RIFT_BURSTS);
    expect(bursts.every((b) => b.preset === "riftBurst")).toBe(true);
    expect(Math.min(...bursts.map((b) => b.pos.z))).toBeLessThan(-30);
    expect(Math.max(...bursts.map((b) => b.pos.z))).toBeGreaterThan(-13);
    const n = bursts.reduce((a, b) => a + burstParticles(b.preset, b.pos, b.dir, b.scale, Math.random).length, 0);
    expect(n).toBeGreaterThanOrEqual(100);
    expect(n).toBeLessThanOrEqual(MAX_BURST);
    // свой удар — у уха, крупная ступень по профилю Земли: камера вниз и FOV
    expect(sounds(out)).toEqual([{ kind: "sound", id: "riftStrike", pos: null, gain: 1 }]);
    expect(out).toContainEqual({ kind: "trauma", amount: 0.8, profile: "earth" });
    expect(out).toContainEqual({ kind: "fov", deg: 10 });
    expect(out.find((e) => e.kind === "kick")).toMatchObject({ pitchDeg: -2 });
    expect(fx(zoneEv(ME, "end"), s)).toEqual([]);
  });

  it("someone else's strike sounds from the nearest point of the line and shakes me only within 4 m of it", () => {
    const near = withZone(world(), { ...riftZone(OTHER), shape: { type: "segment", a: V(2, 0, -1.5), b: V(2, 0, -26.5), halfW: 0.75 } });
    const out = fx(zoneEv(OTHER, "arm"), near);
    expect(sounds(out)).toEqual([{ kind: "sound", id: "riftStrike", pos: V(2, 0, -1.5), gain: 1 }]);
    expect(out).toContainEqual({ kind: "trauma", amount: RIFT_NEAR_TRAUMA, profile: "earth" });
    const far = fx(zoneEv(OTHER, "arm"), withZone(world(), riftZone(OTHER)));
    expect(far.some((e) => e.kind === "trauma" || e.kind === "fov" || e.kind === "kick")).toBe(false);
  });
});

describe("Fire and Earth ults: frame", () => {
  /** Огонь who дышит в состоянии на тике tick (выдох 136, конец 316). */
  const breathState = (who: number, tick: number): MatchState => {
    const s = at(world("fire", "fire"), tick);
    const u = s.units.find((q) => q.id === who) as Unit;
    u.mage!.ult.cast = { ability: "dragonBreath", startTick: 100, releaseTick: 136, endTick: 316, zone: NOBODY };
    return s;
  };
  const run = (frame: ReturnType<typeof createUltFrame>, states: (i: number) => MatchState, frames: number, t0 = 0) => {
    const out: Effect[] = [];
    for (let i = 0; i < frames; i++) {
      const s = states(i);
      out.push(...frame({ prev: s, cur: s, alpha: 1, localId: ME, nowS: t0 + i / 60, dtS: 1 / 60 }));
    }
    return out;
  };

  it("roars in grains of 0.4 s no more often than every 0.3 s while my stream lasts, and holds my 0.3 shake by topping up its decay", () => {
    const frame = createUltFrame();
    const out = run(frame, (i) => breathState(ME, 136 + i), 180);
    const roars = sounds(out).filter((e) => e.id === "breathRoar");
    expect(roars.length).toBeLessThanOrEqual(Math.floor(3 / ROAR_GRAIN_S) + 1);
    expect(roars.length).toBeGreaterThanOrEqual(Math.floor(3 / ROAR_GRAIN_S));
    expect(roars.every((e) => e.pos === null)).toBe(true);
    expect(recipeLength(RECIPES.breathRoar)).toBeCloseTo(0.4);
    const top = out.filter((e): e is Extract<Effect, { kind: "trauma" }> => e.kind === "trauma").reduce((a, e) => a + e.amount, 0);
    expect(top).toBeCloseTo(SHAKE.decayPerS * 3);
  });

  it("stops the moment ult.cast is gone, even without an end event; an inhale only warms my palms", () => {
    const frame = createUltFrame();
    const inhale = run(frame, (i) => breathState(ME, 100 + i), 36);
    expect(sounds(inhale)).toEqual([]);
    expect(inhale.filter((e) => e.kind === "palm").length).toBe(2);
    run(frame, (i) => breathState(ME, 136 + i), 30, 1);
    expect(run(frame, (i) => at(world("fire", "fire"), 166 + i), 60, 2)).toEqual([]);
  });

  it("someone else's stream roars from the point of its axis nearest to me", () => {
    const frame = createUltFrame();
    // OTHER в (6, 0, −8) смотрит с yaw 0,4; ближняя ко мне точка его потока — где-то перед ним
    const out = run(frame, (i) => breathState(OTHER, 140 + i), 1);
    const roar = sounds(out)[0]!;
    expect(roar.id).toBe("breathRoar");
    expect(roar.pos).not.toBeNull();
    expect(out.some((e) => e.kind === "trauma" || e.kind === "palm")).toBe(false);
  });
});

describe("Fire and Earth ults: sounds and bursts", () => {
  it("every new sound is ≤ 0.8 s and signs in its element's band; the warning and the ready click are shared", () => {
    const BAND = { fire: [2000, 8000], earth: [30, 200] } as const;
    for (const [id, el] of [["breathInhale", "fire"], ["breathRoar", "fire"], ["riftRumble", "earth"], ["riftStrike", "earth"]] as const) {
      expect(SOUND_ELEMENT[id]).toBe(el);
      expect(recipeLength(RECIPES[id]), id).toBeLessThanOrEqual(0.8);
      const [lo, hi] = bandOf(RECIPES[id]);
      expect([lo >= BAND[el][0], hi <= BAND[el][1]], id).toEqual([true, true]);
    }
    expect(recipeLength(RECIPES.riftRumble)).toBeCloseTo(0.8);
    expect(recipeLength(RECIPES.breathInhale)).toBeCloseTo(0.6);
    // «ульта!» — гул 120 → 60 Гц с шорохом сверху, 0,6 с, без подписи стихии; «готово» — 0,2 с
    expect([SOUND_ELEMENT.ultWarn, SOUND_ELEMENT.ultReady]).toEqual([null, null]);
    expect(RECIPES.ultWarn.layers.some((l) => l.signature)).toBe(false);
    expect(RECIPES.ultWarn.layers[0]).toMatchObject({ kind: "tone", freq: 120, freqEnd: 60 });
    expect(RECIPES.ultWarn.layers.some((l) => l.kind === "noise" && l.filter === "highpass")).toBe(true);
    expect([recipeLength(RECIPES.ultWarn), recipeLength(RECIPES.ultReady)].map((x) => Math.round(x * 100) / 100)).toEqual([0.6, 0.2]);
  });

  it("every new burst stays within 150 particles", () => {
    for (const p of ["breathFlare", "breathHit", "riftCrack", "riftBurst"] as const) {
      const n = burstParticles(p, V(), V(0, 1, 0), 1, Math.random).length;
      expect(n, p).toBeGreaterThan(0);
      expect(n, p).toBeLessThanOrEqual(MAX_BURST);
    }
    expect(burstParticles("breathHit", V(), V(0, 1, 0), 1, Math.random).length).toBeLessThanOrEqual(20);
  });
});
