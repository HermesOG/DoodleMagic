import { describe, expect, it } from "vitest";
import { createMageUnit, createMatchState, type MatchEvent, type MatchState, type Zone } from "@doodlemagic/sim";
import { AIR_RECIPES, AIR_SOUND_LABELS } from "../audio/airRecipes";
import { RECIPES, bandOf, recipeLength } from "../audio/recipes";
import { MAX_BURST, burstParticles } from "../fx/presets";
import { createGestures, startGesture, stepGestures } from "../hands/gestures";
import { FAN_TICKS, airEffects, createAirFrame } from "./airFx";
import { AIR_BURST_PRESETS, AIR_SOUND_IDS } from "./airIds";
import type { Effect, EffectKind } from "./effects";
import type { FrameView } from "./elementFx";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 2;
const EARTH = 3;
const base = (): MatchState =>
  createMatchState([
    createMageUnit(ME, "air", { pos: V(), yaw: 0 }),
    createMageUnit(OTHER, "air", { pos: V(6, 0, -8), yaw: 0 }),
    createMageUnit(EARTH, "earth", { pos: V(-6, 0, -8), yaw: 0 }),
  ]);
const vortex = (id: number, owner: number, kind: "tornado" | "fireTornado" = "tornado", armTick = 30): Zone => ({
  id, owner, kind, ability: "tornado", shape: { type: "disc", center: V(4, 0, -10), radius: 5 }, bornTick: 0, armTick, endTick: armTick + 240, rehit: [],
});
const withZone = (z: Zone): MatchState => {
  const s = base();
  s.zones.push(z);
  return s;
};
const view = (state: MatchState = base()) => ({ localId: ME, state });
const fx = (ev: MatchEvent, state?: MatchState): Effect[] | null => {
  const v = view(state);
  return airEffects(ev, v, v.state.units.find((u) => u.id === ME));
};
const kinds = (e: Effect[] | null | undefined): EffectKind[] => (e ?? []).map((x) => x.kind);
const sounds = (e: Effect[] | null | undefined): string[] => (e ?? []).flatMap((x) => (x.kind === "sound" ? [x.id] : []));
const bursts = (e: Effect[] | null | undefined): string[] => (e ?? []).flatMap((x) => (x.kind === "burst" ? [x.preset] : []));

/** События Воздуха от мага `unit` (в slam — жертва `unit`, удар — от другого). */
function airEvents(unit: number): MatchEvent[] {
  const by = unit === ME ? OTHER : ME;
  return [
    { type: "cast", unit, ability: "airSickle", slot: "primary", pos: V(0, 1.6, 0), dir: V(0, 0, -1) },
    { type: "cast", unit, ability: "gust", slot: "q", pos: V(0, 1.6, 0), dir: V(0, 0, -1) },
    { type: "cast", unit, ability: "swoop", slot: "e", pos: V(0, 1.6, 0), dir: V(0, 0, -1) },
    { type: "cast", unit, ability: "tornado", slot: "c", pos: V(0, 1.6, 0), dir: V(0, 0, -1) },
    { type: "release", unit, ability: "airSickle", projectile: 4, pos: V(0, 1.6, 0), dir: V(0, 0, -1) },
    { type: "release", unit, ability: "gust", projectile: -1, pos: V(0, 1.6, 0), dir: V(0, 0, -1) },
    { type: "impact", ability: "airSickle", owner: unit, pos: V(0, 1, -10), normal: V(0, 0, 1), target: EARTH, terrain: -1 },
    { type: "blown", unit, projectile: 9, kind: "fireball", owner: EARTH, pos: V(0, 1.5, -4) },
    { type: "slam", target: unit, source: by, pos: V(0, 1, -5) },
    { type: "airJump", unit, pos: V(0, 2, 0) },
    { type: "glide", unit, on: true, pos: V(0, 3, 0) },
    { type: "charge", unit, slot: "e", charges: 1 },
    { type: "dash", unit, ability: "swoop", phase: "start", pos: V(0, 0.9, 0), dir: V(1, 0, 0) },
    { type: "zone", zone: 7, kind: "tornado", owner: unit, phase: "telegraph" },
    { type: "reaction", kind: "fireTornado", owner: unit, zone: 7, pos: V(4, 0, -10) },
  ];
}

describe("airEffects: own events", () => {
  it("casts: gesture first, then palm, a sound at the ear; the sickle strikes by turns with a small kick", () => {
    const [sickle, gust, swoop, tornado] = airEvents(ME).slice(0, 4).map((e) => fx(e));
    expect(sickle).toEqual([
      { kind: "gesture", ability: "airSickle" },
      { kind: "palm", hand: "auto", element: "air", preset: "flash" },
      { kind: "sound", id: "sickleThrow", pos: null, gain: 1 },
      { kind: "kick", pitchDeg: 0.2, yawDeg: 0, rollDeg: 0 },
    ]);
    // замах Порыва: кольцо ветра сходится у ладоней, свист нарастает; камера — на выпуске
    expect(gust).toEqual([{ kind: "gesture", ability: "gust" }, { kind: "palm", hand: "both", element: "air", preset: "charge" }, { kind: "sound", id: "gustWindup", pos: null, gain: 1 }]);
    expect(kinds(swoop)).toEqual(["gesture", "palm", "sound"]);
    expect(sounds(swoop)).toEqual(["swoop"]);
    expect(kinds(tornado)).toEqual(["gesture", "palm", "sound", "kick"]);
  });

  it("gust release: a cone blast, a palm flash, the blast at the ear, a medium-tier kick and an FOV pulse; the sickle's release is silent", () => {
    const out = fx(airEvents(ME)[5]!);
    expect(kinds(out)).toEqual(["burst", "palm", "sound", "kick", "fov"]);
    expect(bursts(out)).toEqual(["gustBlast"]);
    expect(out?.find((e) => e.kind === "kick")).toMatchObject({ pitchDeg: 1.25 });
    expect(fx(airEvents(ME)[4]!)).toEqual([]);
  });

  it("sickle impact puffs and sounds with the own-hit floor; terrain also chips", () => {
    expect(fx(airEvents(ME)[6]!)).toEqual([
      { kind: "burst", preset: "sicklePuff", pos: V(0, 1, -10), dir: V(0, 0, 1), scale: 1 },
      { kind: "sound", id: "sickleHit", pos: V(0, 1, -10), gain: 1, floor: 0.6 },
    ]);
    const wall = fx({ type: "impact", ability: "airSickle", owner: OTHER, pos: V(), normal: V(0, 1, 0), target: -1, terrain: 3 });
    expect(bursts(wall)).toEqual(["sicklePuff", "terrainChips"]);
    expect(wall?.at(-1)).toEqual({ kind: "sound", id: "sickleHit", pos: V(), gain: 1 });
  });

  it("blown, slam on me (sound at the ear; the medium shake comes from the slam's hit), double jump ring, glide pulse, charge chime, swoop FOV like a dash", () => {
    const [, , , , , , , blown, slam, jump, glide, charge, dash] = airEvents(ME).map((e) => fx(e));
    expect(bursts(blown)).toEqual(["airBlown"]);
    expect(sounds(blown)).toEqual(["airBlown"]);
    expect(slam).toEqual([
      { kind: "burst", preset: "airSlam", pos: V(0, 1, -5), dir: V(0, 1, 0), scale: 1 },
      { kind: "sound", id: "airSlam", pos: null, gain: 1 },
    ]);
    expect(jump).toEqual([{ kind: "burst", preset: "airJumpRing", pos: V(0, 2, 0), dir: V(0, 1, 0), scale: 1 }, { kind: "sound", id: "airJump", pos: null, gain: 1 }]);
    expect(glide).toEqual([{ kind: "fov", deg: 1.5 }]);
    expect(fx({ type: "glide", unit: ME, on: false, pos: V() })).toEqual([]);
    expect(charge).toEqual([{ kind: "sound", id: "airCharge", pos: null, gain: 0.8 }]);
    expect(dash?.[0]).toEqual({ kind: "fov", deg: 8 });
    expect(bursts(dash)).toEqual(["swoopWake"]);
    expect(fx({ type: "dash", unit: ME, ability: "swoop", phase: "end", pos: V(), dir: V(1, 0, 0) })).toEqual([]);
  });

  it("tornado: dust ring and rise at the disc centre; fire tornado flares with a toast for its owner", () => {
    const tel = fx(airEvents(ME)[13]!, withZone(vortex(7, ME)));
    expect(tel).toEqual([
      { kind: "burst", preset: "tornadoDust", pos: V(4, 0, -10), dir: V(0, 1, 0), scale: 1 },
      { kind: "sound", id: "tornadoRise", pos: V(4, 0, -10), gain: 1, floor: 0.6 },
    ]);
    expect(fx({ type: "zone", zone: 7, kind: "tornado", owner: ME, phase: "arm" }, withZone(vortex(7, ME)))).toEqual([]);
    const fire = fx(airEvents(ME)[14]!);
    expect(bursts(fire)).toEqual(["fireTornadoFlare"]);
    expect(sounds(fire)).toEqual(["fireTornado"]);
    expect(fire).toContainEqual({ kind: "toast", text: "Огненный смерч!" });
  });

  it("leaves other events to the shared map: hits, deaths, Fire's dash, other zones, steam, a non-Air charge, beams", () => {
    const other: MatchEvent[] = [
      { type: "hit", source: OTHER, target: ME, ability: "gust", amount: 10, pos: V(), dir: V(0, 0, 1), knock: { distM: 7, upM: 1 }, airborne: false, dot: false, killed: false } as MatchEvent,
      { type: "death", target: ME, killer: OTHER, ability: "airSickle", pos: V() },
      { type: "dash", unit: ME, ability: "jetDash", phase: "start", pos: V(), dir: V(1, 0, 0) },
      { type: "zone", zone: 3, kind: "fireWall", owner: ME, phase: "arm" },
      { type: "reaction", kind: "steam", owner: ME, zone: 4, pos: V() },
      { type: "charge", unit: EARTH, slot: "e", charges: 1 },
      { type: "beam", unit: ME, ability: "gust", from: V(), to: V(0, 0, -7), target: 2 },
      { type: "cast", unit: ME, ability: "fireball", slot: "q", pos: V(), dir: V(0, 0, -1) },
    ];
    for (const ev of other) expect(fx(ev), ev.type).toBeNull();
  });
});

describe("airEffects: other mages", () => {
  it("another Air mage: only the world and sounds at a point — no gestures, palms, camera or toasts", () => {
    const camera: EffectKind[] = ["gesture", "palm", "kick", "fov", "trauma", "hitstop", "toast", "deny"];
    const state = withZone(vortex(7, OTHER));
    for (const ev of airEvents(OTHER)) {
      // в slam жертва — чужой маг (бью я): камера моя не трясётся
      const out = fx(ev, state);
      expect(out, ev.type).not.toBeNull();
      expect(kinds(out).filter((k) => camera.includes(k)), `${ev.type}`).toEqual([]);
      for (const e of out ?? []) if (e.kind === "sound") expect(e.pos, `${ev.type} ${e.id}`).not.toBeNull();
    }
  });

  it("another mage's cast is one positional sound where it is cast", () => {
    const at = V(6, 1.6, -8);
    for (const [ability, id] of [["airSickle", "sickleThrow"], ["gust", "gustWindup"], ["swoop", "swoop"], ["tornado", "tornadoCast"]] as const)
      expect(fx({ type: "cast", unit: OTHER, ability, slot: "q", pos: at, dir: V(0, 0, -1) })).toEqual([{ kind: "sound", id, pos: at, gain: 1 }]);
  });
});

describe("airFrame", () => {
  const frame = (cur: MatchState, nowS: number): FrameView => ({ prev: cur, cur, alpha: 0.5, localId: ME, nowS, dtS: 1 / 60 });
  const gliding = (who: number, alive = true): MatchState => {
    const s = base();
    const u = s.units.find((q) => q.id === who)!;
    u.mage!.flight.gliding = true;
    u.alive = alive;
    return s;
  };

  it("a glide whistle grain at most once per 0.35 s per mage, positional for others and quieter at my ear", () => {
    const step = createAirFrame();
    const times = [0, 0.1, 0.2, 0.34, 0.36, 0.5, 0.7, 0.72];
    const got = times.map((t) => step(frame(gliding(OTHER), t)));
    expect(got.map((e) => e.length)).toEqual([1, 0, 0, 0, 1, 0, 0, 1]);
    expect(got[0]![0]).toMatchObject({ kind: "sound", id: "glideWhistle", gain: 1 });
    expect((got[0]![0] as Extract<Effect, { kind: "sound" }>).pos).not.toBeNull();
    const mine = createAirFrame()(frame(gliding(ME), 0));
    expect(mine).toEqual([{ kind: "sound", id: "glideWhistle", pos: null, gain: 0.5 }]);
  });

  it("the grain spacing holds through a one-tick glide flicker; a dead mage that still reads gliding is silent", () => {
    const step = createAirFrame();
    expect(step(frame(gliding(OTHER), 0)).length).toBe(1);
    expect(step(frame(base(), 0.1))).toEqual([]);
    expect(step(frame(gliding(OTHER), 0.12))).toEqual([]);
    expect(createAirFrame()(frame(gliding(OTHER, false), 0))).toEqual([]);
  });

  it("tornado hum grains once per 0.5 s per armed vortex, at the column; none while it grows; fire tornado grains fire", () => {
    const step = createAirFrame();
    const growing = { ...withZone(vortex(7, OTHER)), tick: 10 };
    expect(step(frame(growing, 0))).toEqual([]);
    const armed = { ...withZone(vortex(7, OTHER)), tick: 40 };
    const got = [0, 0.2, 0.49, 0.5, 0.9, 1.0].map((t) => step(frame(armed, t)));
    expect(got.map((e) => e.length)).toEqual([1, 0, 0, 1, 0, 1]);
    expect(got[0]![0]).toEqual({ kind: "sound", id: "tornadoHum", pos: V(4, 1.5, -10), gain: 1 });
    const fire = { ...withZone(vortex(8, OTHER, "fireTornado")), tick: 40 };
    expect(createAirFrame()(frame(fire, 0))).toMatchObject([{ kind: "sound", id: "fireTornado" }]);
  });

  it("the gust floor fan appears once per windup, within 12 ticks of the release", () => {
    const step = createAirFrame();
    const windup = (tick: number, release: number): MatchState => {
      const s = { ...base(), tick };
      s.units.find((q) => q.id === OTHER)!.mage!.windup = { ability: "gust", slot: "q", releaseTick: release };
      return s;
    };
    expect(step(frame(windup(100, 100 + FAN_TICKS + 1), 0))).toEqual([]);
    const fan = step(frame(windup(100, 100 + FAN_TICKS), 0.02));
    expect(bursts(fan)).toEqual(["gustFan"]);
    expect(step(frame(windup(101, 100 + FAN_TICKS), 0.04))).toEqual([]);
    expect(bursts(step(frame(windup(200, 210), 0.1)))).toEqual(["gustFan"]);
  });
});

describe("Air registries", () => {
  it("every Air sound has a recipe ≤ 0.8 s, one signature layer in 800–4000 Hz and a label", () => {
    for (const id of AIR_SOUND_IDS) {
      const r = AIR_RECIPES[id];
      expect(RECIPES[id], id).toBe(r);
      expect(recipeLength(r), id).toBeLessThanOrEqual(0.8);
      expect(r.layers.filter((l) => l.signature).length, id).toBe(1);
      const [lo, hi] = bandOf(r);
      expect([lo >= 800, hi <= 4000], id).toEqual([true, true]);
      expect(AIR_SOUND_LABELS[id], id).toMatch(/\S/);
    }
    // гул и свист парения — зёрна, перекрывают свой шаг (Р15)
    expect(recipeLength(AIR_RECIPES.tornadoHum)).toBeGreaterThanOrEqual(0.5);
    expect(recipeLength(AIR_RECIPES.glideWhistle)).toBeGreaterThanOrEqual(0.35);
  });

  it("every Air burst spawns 1…MAX_BURST particles", () => {
    for (const p of AIR_BURST_PRESETS) {
      const n = burstParticles(p, V(), V(0, 1, 0), 1, Math.random).length;
      expect(n > 0 && n <= MAX_BURST, p).toBe(true);
    }
  });

  it("Air gestures end at rest", () => {
    for (const a of ["airSickle", "gust", "swoop", "tornado"] as const) {
      const done = stepGestures(startGesture(createGestures(), a), 1);
      expect([...Object.values(done.pose.right), ...Object.values(done.pose.left)].every((v) => Math.abs(v) < 1e-6), a).toBe(true);
    }
  });
});
