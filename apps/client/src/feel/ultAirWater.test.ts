import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector2, type InstancedBufferAttribute, type InstancedMesh } from "three";
import {
  AIR,
  NO_MATCH_INPUT,
  WATER,
  aabb,
  createMageUnit,
  createMatch,
  createMatchState,
  createWorld,
  stepMatch,
  unitById,
  type MatchContext,
  type MatchEvent,
  type MatchState,
  type UltId,
  type Unit,
  type UnitId,
  type Zone,
} from "@doodlemagic/sim";
import { AIR_RECIPES, AIR_SOUND_LABELS } from "../audio/airRecipes";
import { REVERB_SEND } from "../audio/layers";
import { RECIPES, SOUND_ELEMENT, bandOf, recipeLength } from "../audio/recipes";
import { WATER_RECIPES, WATER_SOUND_LABELS } from "../audio/waterRecipes";
import { BLAST_RING_S, GATHER_RATE, createAirVfx, hurricaneGather, hurricaneWindup } from "../fx/airVfx";
import type { ElementVfxFrame } from "../fx/elementVfx";
import type { FxGBuffer } from "../fx/fxShader";
import type { Glow } from "../fx/glows";
import type { ParticleSpec } from "../fx/particleKit";
import { MAX_BURST, burstParticles } from "../fx/presets";
import { RATE, createWaterVfx, tsunamiCrest } from "../fx/waterVfx";
import { createGestures, startGesture, stepGestures } from "../hands/gestures";
import { ULT_CASTER, airEffects } from "./airFx";
import type { Effect, EffectKind } from "./effects";
import type { FrameView } from "./elementFx";
import { effectsFor } from "./eventMap";
import { ROLL_GRAIN_S, createWaterFrame, crestMid, waterEffects } from "./waterFx";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const FOE = 2;
const state = (element: "air" | "water"): MatchState =>
  createMatchState([createMageUnit(ME, element, { pos: V(), yaw: 0 }), createMageUnit(FOE, element, { pos: V(4, 0, -6), yaw: Math.PI })]);
const viewOf = (s: MatchState, localId: UnitId = ME) => ({ localId, state: s });
const unit = (s: MatchState, id: UnitId): Unit => s.units.find((u) => u.id === id)!;
const air = (ev: MatchEvent, s = state("air"), localId: UnitId = ME) => airEffects(ev, viewOf(s, localId), unit(s, localId));
const water = (ev: MatchEvent, s = state("water"), localId: UnitId = ME) => waterEffects(ev, viewOf(s, localId), unit(s, localId));
const kinds = (e: Effect[] | null | undefined): EffectKind[] => (e ?? []).map((x) => x.kind);
const sounds = (e: Effect[] | null | undefined) => (e ?? []).filter((x): x is Extract<Effect, { kind: "sound" }> => x.kind === "sound");
const bursts = (e: Effect[] | null | undefined) => (e ?? []).filter((x): x is Extract<Effect, { kind: "burst" }> => x.kind === "burst");
/** Только моё: жест, ладони и камера. Чужое их не даёт. */
const OWN_ONLY: readonly EffectKind[] = ["gesture", "palm", "kick", "fov", "trauma", "hitstop"];

const castX = (unit: UnitId, ability: UltId, pos = unit === ME ? V(0, 1.6, 0) : V(4, 1.6, -6)): MatchEvent => ({ type: "cast", unit, ability, slot: "x", pos, dir: V(0, 0, -1) });
const ult = (unit: UnitId, ability: UltId, phase: "ready" | "release" | "end"): MatchEvent => ({
  type: "ult", unit, ability, phase, pos: unit === ME ? V(0, 1.6, 0) : V(4, 1.6, -6), dir: V(0, 0, -1),
});
const hit = (source: UnitId, target: UnitId, ability: UltId, killed = false): MatchEvent => ({
  type: "hit", source, target, ability, amount: 60, pos: V(4, 0.9, -6), dir: V(0.55, 0, -0.83), knock: { distM: 12, upM: 2 }, airborne: false, dot: false, killed,
});
const death = (killer: UnitId, ability: UltId): MatchEvent => ({ type: "death", target: killer === ME ? FOE : ME, killer, ability, pos: V(4, 0.9, -6) });

/** Волна Цунами хозяйки owner: отрезок 14 м поперёк хода −z через (0, 0, z), как её ставит симуляция (n = +x, ход −z). */
const wave = (owner: UnitId, at: { bornTick?: number; z?: number; rehit?: UnitId[] } = {}): Zone => {
  const born = at.bornTick ?? 100;
  const z = at.z ?? 2;
  return {
    id: 40, owner, kind: "tsunami", ability: "tsunami", shape: { type: "segment", a: V(-7, 0, z), b: V(7, 0, z), halfW: 1 },
    bornTick: born, armTick: born + 48, endTick: born + 48 + 120, rehit: (at.rehit ?? []).map((unit) => ({ unit, tick: born + 168 })),
  };
};
const withZones = (s: MatchState, tick: number, ...zones: Zone[]): MatchState => ({ ...s, tick, zones });

describe("Hurricane: events → effects", () => {
  it("my cast: the gesture first, then the palms gather wind, the windup whistle at my ear — no camera until the release", () => {
    expect(air(castX(ME, "hurricane"))).toEqual([
      { kind: "gesture", ability: "hurricane" },
      { kind: "palm", hand: "both", element: "air", preset: "charge" },
      { kind: "sound", id: "hurricaneWindup", pos: null, gain: 1 },
    ]);
  });

  it("another mage's cast: the whistle where he stands; the shared map adds the map-wide ultWarn once, no gesture or camera", () => {
    expect(air(castX(FOE, "hurricane"))).toEqual([{ kind: "sound", id: "hurricaneWindup", pos: V(4, 1.6, -6), gain: 1 }]);
    const all = effectsFor(castX(FOE, "hurricane"), viewOf(state("air")));
    expect(sounds(all).map((s) => s.id)).toEqual(["ultWarn", "hurricaneWindup"]);
    expect(kinds(all).some((k) => OWN_ONLY.includes(k))).toBe(false);
  });

  it("my release: the ring at my chest and the dust at my feet, the boom at my ear, the large tier and FOV +10°", () => {
    const s = state("air");
    const out = air(ult(ME, "hurricane", "release"), s);
    expect(kinds(out)).toEqual(["burst", "burst", "palm", "sound", "trauma", "kick", "fov"]);
    const me = unit(s, ME).move.body;
    expect(bursts(out).map((b) => [b.preset, b.pos])).toEqual([
      ["hurricaneBlast", V(0, me.height / 2, 0)],
      ["hurricaneDust", V(0, 0, 0)],
    ]);
    expect(sounds(out)).toEqual([{ kind: "sound", id: "hurricaneBoom", pos: null, gain: 1 }]);
    expect(out).toContainEqual({ kind: "trauma", amount: 0.8 });
    expect(out).toContainEqual({ kind: "kick", pitchDeg: 2, yawDeg: 0, rollDeg: 0 });
    expect(out).toContainEqual({ kind: "fov", deg: 10 });
    expect(ULT_CASTER).toEqual({ trauma: 0.8, kickDeg: 2, fovDeg: 10 });
  });

  it("another mage's release: the world and the boom where he stands, nothing on my camera", () => {
    const s = state("air");
    const out = air(ult(FOE, "hurricane", "release"), s);
    expect(kinds(out)).toEqual(["burst", "burst", "sound"]);
    const c = V(4, unit(s, FOE).move.body.height / 2, -6);
    expect(bursts(out)[0]).toMatchObject({ preset: "hurricaneBlast", pos: c });
    expect(sounds(out)[0]).toEqual({ kind: "sound", id: "hurricaneBoom", pos: c, gain: 1 });
  });

  it("the cast end is silent; «ready» goes on to the shared click; other elements' ults are not Air's", () => {
    expect(air(ult(ME, "hurricane", "end"))).toEqual([]);
    expect(air(ult(FOE, "hurricane", "end"))).toEqual([]);
    expect(air(ult(ME, "hurricane", "ready"))).toBeNull();
    expect(effectsFor(ult(ME, "hurricane", "ready"), viewOf(state("air")))).toEqual([{ kind: "sound", id: "ultReady", pos: null, gain: 1 }]);
    expect(air(ult(ME, "tsunami", "release"))).toBeNull();
    expect(air(castX(ME, "tsunami"))).toBeNull();
  });

  it("an ult hit stays with the shared map: the large hitmarker and hitstop for me, the medium kick and the knock whoosh for the target", () => {
    expect(air(hit(ME, FOE, "hurricane"))).toBeNull();
    const shooter = effectsFor(hit(ME, FOE, "hurricane"), viewOf(state("air")));
    expect(shooter).toContainEqual({ kind: "hitmarker", kill: false, air: false, tier: "large" });
    expect(shooter).toContainEqual({ kind: "hitstop", ms: 90 });
    const victim = effectsFor(hit(FOE, ME, "hurricane"), viewOf(state("air")));
    expect(sounds(victim).map((s) => s.id)).toContain("knockWhoosh");
    expect(victim).toContainEqual({ kind: "trauma", amount: 0.5, profile: "fire" });
  });

  it("a kill by the Hurricane: the wind burst for everyone, the kill sound and the «Ураган!» toast for the killer", () => {
    expect(air(death(ME, "hurricane"))).toEqual([
      { kind: "burst", preset: "deathAir", pos: V(4, 0.9, -6), dir: V(0, 1, 0), scale: 1 },
      { kind: "sound", id: "kill", pos: null, gain: 1 },
      { kind: "toast", text: "Ураган!" },
    ]);
    expect(kinds(air(death(FOE, "hurricane")))).toEqual(["burst"]);
    expect(air(death(ME, "tsunami"))).toBeNull();
  });
});

describe("Tsunami: events → effects", () => {
  it("my cast: the gesture, the palms, the rising roar at my ear and the hands down to the water; another's — the roar where he stands", () => {
    const mine = water(castX(ME, "tsunami"));
    expect(kinds(mine)).toEqual(["gesture", "palm", "sound", "kick"]);
    expect(mine![0]).toEqual({ kind: "gesture", ability: "tsunami" });
    expect(sounds(mine)).toEqual([{ kind: "sound", id: "tsunamiRise", pos: null, gain: 1 }]);
    expect(water(castX(FOE, "tsunami"))).toEqual([{ kind: "sound", id: "tsunamiRise", pos: V(4, 1.6, -6), gain: 1 }]);
    const all = effectsFor(castX(FOE, "tsunami"), viewOf(state("water")));
    expect(sounds(all).map((s) => s.id)).toEqual(["ultWarn", "tsunamiRise"]);
    expect(kinds(all).some((k) => OWN_ONLY.includes(k))).toBe(false);
  });

  it("my release: the push with both hands and the large tier; another's release and both ends add nothing (the wave lives in its zone)", () => {
    expect(water(ult(ME, "tsunami", "release"))).toEqual([
      { kind: "palm", hand: "both", element: "water", preset: "flash" },
      { kind: "trauma", amount: 0.8 },
      { kind: "kick", pitchDeg: 2, yawDeg: 0, rollDeg: 0 },
      { kind: "fov", deg: 10 },
    ]);
    expect(water(ult(FOE, "tsunami", "release"))).toEqual([]);
    expect(water(ult(ME, "tsunami", "end"))).toEqual([]);
    expect(water(ult(ME, "tsunami", "ready"))).toBeNull();
  });

  it("zone tsunami: on telegraph the water surges from the floor in the middle of the line — mine and another's alike; arm and end are silent", () => {
    for (const owner of [ME, FOE]) {
      const s = withZones(state("water"), 101, wave(owner));
      const ev = (phase: "telegraph" | "arm" | "end"): MatchEvent => ({ type: "zone", zone: 40, kind: "tsunami", owner, phase });
      expect(water(ev("telegraph"), s)).toEqual([{ kind: "burst", preset: "tsunamiSurge", pos: V(0, 0, 2), dir: V(0, 1, 0), scale: 1 }]);
      expect(water(ev("arm"), s)).toEqual([]);
      expect(water(ev("end"), s)).toEqual([]);
    }
  });

  it("an ult hit stays with the shared map (large tier); a kill gets the «Цунами!» toast", () => {
    expect(water(hit(ME, FOE, "tsunami"))).toBeNull();
    const shooter = effectsFor(hit(ME, FOE, "tsunami"), viewOf(state("water")));
    expect(shooter).toContainEqual({ kind: "hitmarker", kill: false, air: false, tier: "large" });
    expect(shooter).toContainEqual({ kind: "hitstop", ms: 90 });
    expect(water(death(ME, "tsunami"))).toEqual([
      { kind: "burst", preset: "deathWater", pos: V(4, 0.9, -6), dir: V(0, 1, 0), scale: 1 },
      { kind: "sound", id: "kill", pos: null, gain: 1 },
      { kind: "toast", text: "Цунами!" },
    ]);
    expect(kinds(water(death(FOE, "tsunami")))).toEqual(["burst"]);
  });
});

describe("waterFrame: the rolling wave", () => {
  const frame = (cur: MatchState, nowS: number, localId: UnitId = ME, prev = cur, alpha = 0.5): FrameView => ({ prev, cur, alpha, localId, nowS, dtS: 1 / 60 });
  const rolls = (e: Effect[]) => sounds(e).filter((s) => s.id === "tsunamiRoll");

  it("roll grains at most once per 0.4 s, in the middle of the crest, from the arm to the end of the wave; none while it rises", () => {
    const step = createWaterFrame();
    const rising = withZones(state("water"), 120, wave(FOE));
    expect(Array.from({ length: 60 }, (_, i) => rolls(step(frame(rising, 5 + i / 60)))).flat()).toEqual([]);
    const at: number[] = [];
    const s = withZones(state("water"), 160, wave(FOE, { z: -4 }));
    for (let i = 1; i <= 120; i++) {
      const got = rolls(step(frame(s, 10 + i / 60)));
      expect(got.length).toBeLessThanOrEqual(1);
      if (got.length > 0) {
        at.push(10 + i / 60);
        expect(got[0]!.pos).toEqual(V(0, WATER.tsunami.heightM / 2, -4));
      }
    }
    expect(at.length).toBe(5);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(ROLL_GRAIN_S - 1e-9);
    const ended = withZones(state("water"), 268, wave(FOE, { z: -4 }));
    expect(Array.from({ length: 60 }, (_, i) => rolls(step(frame(ended, 20 + i / 60)))).flat()).toEqual([]);
  });

  it("the grain sits where the crest is drawn: the middle of the line, between the ticks", () => {
    const prev = withZones(state("water"), 160, wave(FOE, { z: -4 }));
    const cur = withZones(state("water"), 161, wave(FOE, { z: -4.25 }));
    expect(crestMid(prev, cur.zones[0]!, 0.5)).toEqual(V(0, WATER.tsunami.heightM / 2, -4.125));
    expect(crestMid(createMatchState([]), cur.zones[0]!, 0.5)).toEqual(V(0, WATER.tsunami.heightM / 2, -4.25));
  });

  it("a new rehit entry splashes and crashes once on the unit hit: my wave — with the floor, me hit — at my ear, others — in the world", () => {
    const step = createWaterFrame();
    const before = withZones(state("water"), 150, wave(ME));
    expect(bursts(step(frame(before, 1)))).toEqual([]);
    const after = withZones(state("water"), 151, wave(ME, { rehit: [FOE] }));
    const got = step(frame(after, 1 + 1 / 60));
    const foe = unit(after, FOE).move.body;
    const at = V(4, foe.height / 2, -6);
    expect(bursts(got).map((b) => [b.preset, b.pos])).toEqual([["tsunamiSplash", at]]);
    // всплеск — по ходу волны (−z) и вверх
    expect(bursts(got)[0]!.dir.z).toBeLessThan(0);
    expect(bursts(got)[0]!.dir.y).toBeGreaterThan(0);
    expect(sounds(got).filter((s) => s.id === "tsunamiHit")).toEqual([{ kind: "sound", id: "tsunamiHit", pos: at, gain: 1, floor: 0.6 }]);
    expect(bursts(step(frame(after, 1 + 2 / 60)))).toEqual([]);

    const victim = createWaterFrame();
    victim(frame(withZones(state("water"), 150, wave(FOE)), 1, ME));
    const hitMe = victim(frame(withZones(state("water"), 151, wave(FOE, { rehit: [ME] })), 1 + 1 / 60, ME));
    expect(sounds(hitMe).filter((s) => s.id === "tsunamiHit")).toEqual([{ kind: "sound", id: "tsunamiHit", pos: null, gain: 1 }]);

    const watcher = createWaterFrame();
    watcher(frame(withZones(state("water"), 150, wave(FOE)), 1, 7));
    const seen = watcher(frame(withZones(state("water"), 151, wave(FOE, { rehit: [ME] })), 1 + 1 / 60, 7));
    expect(sounds(seen).filter((s) => s.id === "tsunamiHit")).toEqual([{ kind: "sound", id: "tsunamiHit", pos: V(0, unit(state("water"), ME).move.body.height / 2, 0), gain: 1 }]);
  });

  it("entries already there when the wave is first seen (joined mid-wave) stay silent", () => {
    const step = createWaterFrame();
    expect(bursts(step(frame(withZones(state("water"), 151, wave(ME, { rehit: [FOE] })), 1)))).toEqual([]);
  });
});

describe("waterVfx: the crest", () => {
  it("rides the zone: a and b between the ticks, the travel direction across the line; rises to 2.5 m by the arm and falls at the end", () => {
    const prev = wave(FOE, { z: -4 });
    const cur = wave(FOE, { z: -4.25 });
    const mid = tsunamiCrest(prev, cur, 0.5, 160.5)!;
    expect([mid.a, mid.b]).toEqual([V(-7, 0, -4.125), V(7, 0, -4.125)]);
    expect(tsunamiCrest(prev, cur, 0, 160)!.a).toEqual(V(-7, 0, -4));
    expect(tsunamiCrest(prev, cur, 1, 161)!.b).toEqual(V(7, 0, -4.25));
    expect(tsunamiCrest(undefined, cur, 0.5, 160.5)!.a).toEqual(V(-7, 0, -4.25));
    expect(mid.dir.x).toBeCloseTo(0, 9);
    expect(mid.dir.z).toBeCloseTo(-1, 9);
    expect([mid.height, mid.intensity, mid.rise]).toEqual([WATER.tsunami.heightM, 1, 1]);
    const h = (tick: number) => tsunamiCrest(prev, cur, 0, tick)?.height ?? null;
    expect([h(99.5), h(100), h(268)]).toEqual([null, 0, null]);
    expect(h(112)! > 0 && h(112)! < h(124)! && h(124)! < h(148)!).toBe(true);
    expect(h(266)!).toBeLessThan(WATER.tsunami.heightM);
    expect(tsunamiCrest(prev, cur, 0, 266)!.intensity).toBeLessThan(1);
    expect(tsunamiCrest(prev, { ...cur, kind: "spring" }, 0, 160)).toBeNull();
  });

  describe("createWaterVfx draws it on the one water mesh and sprays ≤ 60 particles/s", () => {
    const gbuffer = { depth: null, surface: null, invDepth: new Vector2() } as unknown as FxGBuffer;
    const camera = new PerspectiveCamera(75, 16 / 9, 0.05, 200);
    const frame = (s: MatchState, nowS: number, emitted: ParticleSpec[]): ElementVfxFrame => ({
      prev: s, cur: s, alpha: 0, tick: s.tick, nowS, dt: 1 / 60, camera, eye: V(0, 1.6, 0), localId: ME,
      units: s.units.map((u) => ({ id: u.id, pos: u.move.body.pos, u })), mages: [], palmWorld: () => V(0.3, 1.3, -0.4),
      emit: (specs) => emitted.push(...specs), glow: () => {}, decal: () => {},
    });

    it("two crest sheets (type 3) from a to b of the zone, 2.5 m tall once armed; no new mesh", () => {
      const vfx = createWaterVfx({ gbuffer, time: { value: 0 } });
      expect(vfx.world).toBeNull();
      const mesh = vfx.light as InstancedMesh;
      const s = withZones(state("water"), 160, wave(FOE, { z: -4 }));
      vfx.sync(frame(s, 1, []));
      expect(mesh.count).toBe(2);
      const aA = mesh.geometry.getAttribute("aA") as InstancedBufferAttribute;
      const aB = mesh.geometry.getAttribute("aB") as InstancedBufferAttribute;
      expect([aA.getX(0), aA.getY(0), aA.getZ(0), aA.getW(0)]).toEqual([-7, 0, -4, 3]);
      expect([aB.getX(0), aB.getY(0), aB.getZ(0), aB.getW(0)]).toEqual([7, 0, -4, WATER.tsunami.heightM]);
      // передний лист — пена ниже, на 0,6 м по ходу
      expect(aA.getZ(1)).toBeCloseTo(-4.6, 5);
      expect(aB.getW(1)).toBeCloseTo(WATER.tsunami.heightM * 0.55, 5);
      vfx.dispose();
    });

    it("rising and rolling, the crest sprays no more than 60 particles a second; gone with the zone", () => {
      const vfx = createWaterVfx({ gbuffer, time: { value: 0 } });
      for (const tick of [120, 200]) {
        const emitted: ParticleSpec[] = [];
        const s = withZones(state("water"), tick, wave(FOE, { z: -4 }));
        for (let i = 1; i <= 60; i++) vfx.sync(frame(s, tick + i / 60, emitted));
        expect(emitted.length).toBeLessThanOrEqual(60 + 2);
        expect(emitted.length).toBeGreaterThan(30);
      }
      expect(RATE.crestSpray + RATE.crestFoam).toBeLessThanOrEqual(60);
      expect(RATE.riseSpray + RATE.riseFoam).toBeLessThanOrEqual(60);
      const gone: ParticleSpec[] = [];
      vfx.sync(frame(withZones(state("water"), 300), 9, gone));
      expect([(vfx.light as InstancedMesh).count, gone.length]).toEqual([0, 0]);
      vfx.dispose();
    });
  });
});

describe("airVfx: the Hurricane windup and blast", () => {
  const caster = (tick: number, alive = true): MatchState => {
    const s = { ...state("air"), tick };
    const u = unit(s, FOE);
    u.alive = alive;
    u.mage!.ult.cast = { ability: "hurricane", startTick: 100, releaseTick: 148, endTick: 149, zone: -1 };
    return s;
  };
  const frame = (s: MatchState, nowS: number, tick: number, sink: { glows: Glow[]; specs: ParticleSpec[] }): ElementVfxFrame =>
    ({
      prev: s, cur: s, alpha: 0.5, tick, nowS, dt: 1 / 60, eye: V(), localId: ME,
      units: s.units.filter((u) => u.alive).map((u) => ({ id: u.id, pos: u.move.body.pos, u })), mages: [], palmWorld: () => V(),
      emit: (x: readonly ParticleSpec[]) => sink.specs.push(...x), glow: (g: Glow) => sink.glows.push(g), decal: () => {},
    }) as unknown as ElementVfxFrame;

  it("the windup runs from the cast to the release tick only, for a live Hurricane caster", () => {
    const u = unit(caster(120), FOE);
    expect([hurricaneWindup(u, 100), hurricaneWindup(u, 124), hurricaneWindup(u, 147.5)]).toEqual([0, 0.5, 47.5 / 48]);
    expect([hurricaneWindup(u, 148), hurricaneWindup(u, 148.5)]).toEqual([null, null]);
    expect(hurricaneWindup(unit(caster(120, false), FOE), 120)).toBeNull();
    expect(hurricaneWindup(unit(state("air"), FOE), 120)).toBeNull();
    const t = unit(caster(120), FOE);
    t.mage!.ult.cast = { ability: "tsunami", startTick: 100, releaseTick: 148, endTick: 149, zone: -1 };
    expect(hurricaneWindup(t, 120)).toBeNull();
  });

  it("the gather spirals in: from the 10 m circle at the cast to ~1.5 m at the release, moving round and inward", () => {
    const c = V(4, 0, -6);
    for (const [k, lo, hi] of [[0, 8.4, 11.6], [1, 1.2, 1.8]] as const) {
      const specs = hurricaneGather(c, k, { wind: 40, dust: 20 }, Math.random);
      expect(specs.length).toBe(60);
      for (const p of specs) {
        const dx = p.pos.x - c.x;
        const dz = p.pos.z - c.z;
        const r = Math.hypot(dx, dz);
        expect(r >= lo && r <= hi, `${k}: ${r}`).toBe(true);
        // к центру и по кругу против часовой
        expect(p.vel.x * dx + p.vel.z * dz).toBeLessThan(0);
        expect(dx * p.vel.z - dz * p.vel.x).toBeGreaterThan(0);
      }
    }
    expect(AIR.hurricane.radiusM).toBe(10);
  });

  it("emits gather particles only before releaseTick, at most 80 a second, and adds no mesh", () => {
    const vfx = createAirVfx({} as never);
    expect(vfx.light).toBeNull();
    const sink = { glows: [] as Glow[], specs: [] as ParticleSpec[] };
    for (let i = 0; i < 48; i++) vfx.sync(frame(caster(100 + i), 2 + i / 60, 100 + i, sink));
    expect(sink.specs.length).toBeGreaterThan(40);
    expect(sink.specs.length).toBeLessThanOrEqual(Math.ceil((GATHER_RATE.wind + GATHER_RATE.dust) * 0.8) + 2);
    expect(GATHER_RATE.wind + GATHER_RATE.dust).toBeLessThanOrEqual(80);
    // чужой копит вихрь: свечение растёт
    expect(sink.glows.length).toBe(48);
    expect(sink.glows[47]!.halo).toBeGreaterThan(sink.glows[0]!.halo);
    const after = { glows: [] as Glow[], specs: [] as ParticleSpec[] };
    for (let i = 0; i < 30; i++) vfx.sync(frame(caster(148 + i), 3 + i / 60, 148 + i, after));
    expect(after).toEqual({ glows: [], specs: [] });
    vfx.dispose();
  });

  it("the blast ring of glows runs from 1 m to 10 m in 0.25 s and fades out by 0.3 s", () => {
    const vfx = createAirVfx({} as never);
    vfx.apply?.({ kind: "burst", preset: "hurricaneBlast", pos: V(4, 0.9, -6), dir: V(0, 1, 0), scale: 1 }, 5);
    const ring = (nowS: number): number[] => {
      const sink = { glows: [] as Glow[], specs: [] as ParticleSpec[] };
      vfx.sync(frame(state("air"), nowS, 300, sink));
      return sink.glows.map((g) => Math.hypot(g.pos.x - 4, g.pos.z + 6));
    };
    const start = ring(5);
    expect(start.length).toBe(6);
    for (const r of start) expect(r).toBeCloseTo(1, 6);
    for (const r of ring(5 + BLAST_RING_S)) expect(r).toBeCloseTo(10, 6);
    expect(ring(5.31)).toEqual([]);
    vfx.dispose();
  });
});

describe("ult registries: Air and Water", () => {
  const NEW_AIR = ["hurricaneWindup", "hurricaneBoom"] as const;
  const NEW_WATER = ["tsunamiRise", "tsunamiRoll", "tsunamiHit"] as const;

  it("every new sound: a recipe ≤ 0.8 s, one signature layer in its element's band, a label; the hits are large-tier (reverb 0.35)", () => {
    for (const [ids, el, lo, hi, recipes, labels] of [
      [NEW_AIR, "air", 800, 4000, AIR_RECIPES, AIR_SOUND_LABELS],
      [NEW_WATER, "water", 300, 1500, WATER_RECIPES, WATER_SOUND_LABELS],
    ] as const) {
      for (const id of ids) {
        const r = (recipes as Record<string, (typeof RECIPES)[keyof typeof RECIPES]>)[id]!;
        expect(RECIPES[id], id).toBe(r);
        expect(SOUND_ELEMENT[id], id).toBe(el);
        expect(recipeLength(r), id).toBeLessThanOrEqual(0.8);
        expect(r.layers.filter((l) => l.signature).length, id).toBe(1);
        const [a, b] = bandOf(r);
        expect([a >= lo, b <= hi], id).toEqual([true, true]);
        expect((labels as Record<string, string>)[id], id).toMatch(/\S/);
      }
    }
    // свист замаха — весь замах 0,8 с, вверх 800 → 4000 Гц; зерно рокота перекрывает свой шаг (Р15)
    expect(recipeLength(AIR_RECIPES.hurricaneWindup)).toBeCloseTo(0.8, 9);
    expect(bandOf(AIR_RECIPES.hurricaneWindup)).toEqual([800, 4000]);
    expect(recipeLength(WATER_RECIPES.tsunamiRoll)).toBeGreaterThanOrEqual(ROLL_GRAIN_S);
    expect([AIR_RECIPES.hurricaneBoom.reverb, WATER_RECIPES.tsunamiHit.reverb]).toEqual([REVERB_SEND.large, REVERB_SEND.large]);
  });

  it("the bursts stay under MAX_BURST; the tsunami splash ≤ 120; the blast ring of strokes reaches 9–11 m at 0.25 s", () => {
    for (const p of ["hurricaneBlast", "hurricaneDust", "tsunamiSurge", "tsunamiSplash"] as const) {
      const n = burstParticles(p, V(), V(0, 1, 0), 1, Math.random).length;
      expect(n > 0 && n <= MAX_BURST, p).toBe(true);
    }
    expect(burstParticles("tsunamiSplash", V(), V(0, 1, 0), 1, Math.random).length).toBeLessThanOrEqual(120);
    // штрихи — облака с сопротивлением 2,6/с: путь v₀·(1 − e^(−2,6t))/2,6
    const ring = burstParticles("hurricaneBlast", V(), V(0, 1, 0), 1, Math.random).filter((p) => Math.hypot(p.vel.x, p.vel.z) > 40);
    expect(ring.length).toBeGreaterThan(80);
    const k = (1 - Math.exp(-2.6 * BLAST_RING_S)) / 2.6;
    for (const p of ring) {
      const r = Math.hypot(p.pos.x, p.pos.z) + Math.hypot(p.vel.x, p.vel.z) * k;
      expect(r >= 9 && r <= 11, `${r}`).toBe(true);
      expect(Math.hypot(p.pos.x, p.pos.z)).toBeLessThanOrEqual(1.2 + 1e-9);
    }
  });

  it("gestures: the Hurricane holds the hands together over the head, then flings them apart; the Tsunami scoops low, lifts and pushes forward; both end at rest", () => {
    const at = (a: "hurricane" | "tsunami", t: number) => stepGestures(startGesture(createGestures(), a), t).pose;
    const hold = at("hurricane", 0.6);
    expect(hold.right.y > 0.25 && hold.left.y > 0.25 && hold.right.x < 0 && hold.left.x > 0).toBe(true);
    const fling = at("hurricane", 0.92);
    expect(fling.right.x > 0.2 && fling.left.x < -0.2).toBe(true);
    expect([at("tsunami", 0.2).right.y < -0.1, at("tsunami", 0.78).right.y > 0.1, at("tsunami", 0.92).right.z < -0.15]).toEqual([true, true, true]);
    for (const a of ["hurricane", "tsunami"] as const) {
      const done = at(a, 1.3);
      expect([...Object.values(done.right), ...Object.values(done.left)].every((v) => Math.abs(v) < 1e-6), a).toBe(true);
    }
  });
});

describe("against the real sim: the look follows the state", () => {
  const ctx: MatchContext = { world: createWorld([{ box: aabb(-40, -1, -40, 40, 0, 40), tag: "floor" }]), killBelowY: -30 };
  /** Маг 1 стихии element в начале координат смотрит на −z, манекен впереди; полный заряд, X на первом шаге. */
  function run(element: "air" | "water", n: number, dummyZ: number): { states: MatchState[]; events: MatchEvent[][] } {
    let s = createMatch({ mages: [{ element, spawn: { pos: V(), yaw: 0 } }], dummies: [{ pos: V(0, 0, dummyZ), yaw: 0 }] });
    for (let k = 0; k < 3; k++) s = stepMatch(s, {}, ctx).state;
    unitById(s, 1)!.mage!.ult.charge = 100;
    const states = [s];
    const events: MatchEvent[][] = [];
    for (let k = 0; k < n; k++) {
      const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, yaw: 0, x: k === 0 } }, ctx);
      s = r.state;
      states.push(s);
      events.push(r.events);
    }
    return { states, events };
  }

  it("Tsunami: the crest sits on the zone and leans the way it rolls; the dummy it hits splashes once; the hit itself is large-tier", () => {
    const { states, events } = run("water", 100, -6);
    const frame = createWaterFrame();
    let splashes = 0;
    let checked = 0;
    for (let k = 1; k < states.length; k++) {
      const prev = states[k - 1]!;
      const cur = states[k]!;
      for (const ev of events[k - 1]!) {
        if (ev.type === "zone" && ev.kind === "tsunami" && ev.phase === "telegraph") expect(bursts(water(ev, cur))[0]?.preset).toBe("tsunamiSurge");
        if (ev.type === "hit") {
          expect(water(ev, cur)).toBeNull();
          expect(effectsFor(ev, viewOf(cur))).toContainEqual({ kind: "hitmarker", kill: false, air: false, tier: "large" });
        }
      }
      splashes += bursts(frame({ prev, cur, alpha: 1, localId: 1, nowS: k / 60, dtS: 1 / 60 })).filter((b) => b.preset === "tsunamiSplash").length;
      const z = cur.zones.find((q) => q.kind === "tsunami");
      if (!z || z.shape.type !== "segment") continue;
      const pz = prev.zones.find((q) => q.id === z.id);
      const c = tsunamiCrest(pz, z, 1, cur.tick)!;
      expect([c.a, c.b]).toEqual([z.shape.a, z.shape.b]);
      if (pz && pz.shape.type === "segment" && cur.tick > z.armTick) {
        // гребень наклонён туда, куда зона едет
        const mx = (z.shape.a.x + z.shape.b.x - pz.shape.a.x - pz.shape.b.x) / 2;
        const mz = (z.shape.a.z + z.shape.b.z - pz.shape.a.z - pz.shape.b.z) / 2;
        expect(mx * c.dir.x + mz * c.dir.z).toBeGreaterThan(0.2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(splashes).toBe(1);
    expect(events.flat().filter((e) => e.type === "hit" && e.ability === "tsunami").length).toBe(1);
  });

  it("Hurricane: the gather runs up to the release tick and stops there; the release event blows the ring from the caster", () => {
    const { states, events } = run("air", 60, -5);
    const release = events.findIndex((evs) => evs.some((e) => e.type === "ult" && e.phase === "release"));
    expect(release).toBeGreaterThan(40);
    for (let k = 1; k < states.length; k++) {
      const w = hurricaneWindup(unitById(states[k]!, 1)!, states[k]!.tick - 0.5);
      // замах виден, пока дробный тик не дошёл до тика выпуска
      expect(w !== null, `k=${k}`).toBe(k <= release);
    }
    const ev = events[release]!.find((e) => e.type === "ult")!;
    const out = air(ev, states[release + 1]!);
    expect(bursts(out).map((b) => b.preset)).toEqual(["hurricaneBlast", "hurricaneDust"]);
    expect(out).toContainEqual({ kind: "fov", deg: 10 });
    expect(events.flat().some((e) => e.type === "hit" && e.ability === "hurricane")).toBe(true);
  });
});
