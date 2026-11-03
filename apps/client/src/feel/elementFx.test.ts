import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ABILITY_IDS, PROJECTILE_KINDS, createMageUnit, createMatchState, type MatchEvent, type Zone, type ZoneKind,
} from "@doodlemagic/sim";
import { SOUND_LABELS } from "../audio/audition";
import { RECIPES, SOUND_ELEMENT, recipeLength } from "../audio/recipes";
import { zoneDecal } from "../fx/decals";
import { MAX_BURST, burstParticles, trailParticles } from "../fx/presets";
import { PROJECTILE_LOOK } from "../fx/projectileMeshes";
import { createGestures, isFistGesture, startGesture, stepGestures } from "../hands/gestures";
import { KIT_WIDGETS } from "../hud/kitWidgets";
import * as airFx from "./airFx";
import { AIR_BURST_PRESETS, AIR_SOUND_IDS } from "./airIds";
import { BURST_PRESETS, SOUND_IDS, type Effect } from "./effects";
import { elementEffects, elementFrameEffects } from "./elementFx";
import { effectsFor } from "./eventMap";
import * as waterFx from "./waterFx";
import { WATER_BURST_PRESETS, WATER_SOUND_IDS } from "./waterIds";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const view = { localId: ME, state: createMatchState([createMageUnit(ME, "air", { pos: V(), yaw: 0 }), createMageUnit(2, "water", { pos: V(6, 0, -8), yaw: 0 })]) };
const cast: MatchEvent = { type: "cast", unit: ME, ability: "gust", slot: "q", pos: V(0, 1.6, 0), dir: V(0, 0, -1) };
/** Каст не Воздуха и не Воды: файлы стихий его не берут. */
const fireCast: MatchEvent = { type: "cast", unit: ME, ability: "fireball", slot: "q", pos: V(0, 1.6, 0), dir: V(0, 0, -1) };
let seed = 1;
const rng = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

afterEach(() => vi.restoreAllMocks());

describe("element registries: every id of the four elements has its entry", () => {
  it("lists Air and Water sounds and bursts in the shared lists", () => {
    for (const id of [...AIR_SOUND_IDS, ...WATER_SOUND_IDS]) expect(SOUND_IDS, id).toContain(id);
    for (const p of [...AIR_BURST_PRESETS, ...WATER_BURST_PRESETS]) expect(BURST_PRESETS, p).toContain(p);
    expect(new Set(SOUND_IDS).size).toBe(SOUND_IDS.length);
    expect(new Set(BURST_PRESETS).size).toBe(BURST_PRESETS.length);
  });

  it("every sound has a recipe of at most 0.8 s and a label; Air and Water sounds sign as their element", () => {
    for (const id of SOUND_IDS) {
      expect(RECIPES[id], id).toBeDefined();
      expect(recipeLength(RECIPES[id]), id).toBeLessThanOrEqual(0.8);
      expect(SOUND_LABELS[id], id).toMatch(/\S/);
    }
    for (const id of AIR_SOUND_IDS) expect(SOUND_ELEMENT[id], id).toBe("air");
    for (const id of WATER_SOUND_IDS) expect(SOUND_ELEMENT[id], id).toBe("water");
  });

  it("every burst has layers and spawns 1…MAX_BURST particles", () => {
    for (const p of BURST_PRESETS) {
      for (const scale of [1, 3]) {
        const n = burstParticles(p, V(), V(0, 1, 0), scale, rng).length;
        expect(n > 0 && n <= MAX_BURST, `${p} × ${scale}: ${n}`).toBe(true);
      }
    }
  });

  it("every ability has a gesture that returns to rest; only Fire's fists punch by turns", () => {
    for (const a of ABILITY_IDS) {
      const done = stepGestures(startGesture(createGestures(), a), 1.5);
      expect([...Object.values(done.pose.right), ...Object.values(done.pose.left)].every((v) => Math.abs(v) < 1e-6), a).toBe(true);
    }
    // по очереди руками бьют кулаки Огня и серп Воздуха (задача 5)
    expect(ABILITY_IDS.filter(isFistGesture)).toEqual(["fireFists", "airSickle"]);
  });

  it("every projectile kind has a look and a trail", () => {
    for (const k of PROJECTILE_KINDS) {
      expect(PROJECTILE_LOOK[k], k).toBeDefined();
      expect(["sphere", "stone", "none"], k).toContain(PROJECTILE_LOOK[k].mesh);
      expect(PROJECTILE_LOOK[k].trailEveryM, k).toBeGreaterThan(0);
      expect(trailParticles(k, V(), V(0, 0, -1), 3, rng).length, k).toBe(3);
    }
  });

  it("every zone kind has a decal style entry: steam draws none (a cloud), the rest a ring", () => {
    const kinds: ZoneKind[] = ["fireWall", "fireTrail", "pillar", "quake", "tornado", "fireTornado", "spring", "steam", "bog"];
    const zone = (kind: ZoneKind, owner = 2): Zone => ({
      id: 1, owner, kind, ability: "tornado", shape: { type: "disc", center: V(), radius: 3 }, bornTick: 0, armTick: 30, endTick: 300, rehit: [],
    });
    const none = new Set<ZoneKind>(["steam"]);
    for (const k of kinds) {
      const d = zoneDecal(zone(k), 10);
      if (none.has(k)) expect(d, k).toBeNull();
      else expect(d?.shape, k).toBe("ring");
    }
    // enemy: известен свой маг и хозяин — не он
    expect([zoneDecal(zone("quake", 2), 10, ME)?.enemy, zoneDecal(zone("quake", ME), 10, ME)?.enemy, zoneDecal(zone("quake", 2), 10)?.enemy]).toEqual([true, false, false]);
  });

  it("Air and Water have kit widgets; Fire and Earth keep their own kit", () => {
    expect([typeof KIT_WIDGETS.air, typeof KIT_WIDGETS.water, KIT_WIDGETS.fire, KIT_WIDGETS.earth]).toEqual(["function", "function", undefined, undefined]);
  });
});

describe("elementEffects", () => {
  it("a neutral event goes to the shared map, Air's own to the Air file; the frame hook is silent on a quiet state", () => {
    expect(elementEffects(fireCast, view, view.state.units[0])).toBeNull();
    expect(effectsFor(cast, view)[0]).toEqual({ kind: "gesture", ability: "gust" });
    expect(elementEffects(cast, view, view.state.units[0])).not.toBeNull();
    expect(elementFrameEffects({ prev: view.state, cur: view.state, alpha: 0.5, localId: ME, nowS: 1, dtS: 1 / 60 })).toEqual([]);
  });

  it("an element file's answer wins over the shared map: Air first, then Water", () => {
    const air: Effect[] = [{ kind: "toast", text: "Воздух" }];
    const water: Effect[] = [{ kind: "toast", text: "Вода" }];
    const w = vi.spyOn(waterFx, "waterEffects").mockReturnValue(water);
    expect(effectsFor(fireCast, view)).toBe(water);
    const a = vi.spyOn(airFx, "airEffects").mockReturnValue(air);
    expect(effectsFor(fireCast, view)).toBe(air);
    expect(a).toHaveBeenCalledWith(fireCast, view, view.state.units[0]);
    expect(w).toHaveBeenCalledTimes(1);
  });

  it("frame effects of both elements go together", () => {
    const a: Effect = { kind: "toast", text: "a" };
    const b: Effect = { kind: "toast", text: "b" };
    vi.spyOn(airFx, "airFrame").mockReturnValue([a]);
    vi.spyOn(waterFx, "waterFrame").mockReturnValue([b]);
    expect(elementFrameEffects({ prev: view.state, cur: view.state, alpha: 0, localId: ME, nowS: 0, dtS: 0 })).toEqual([a, b]);
  });

  it("the shared map: Swoop's dash is Air's, phase-4 events have no shared response, death bursts by the killer's element", () => {
    // Взмах, второй прыжок, парение и заряд — события Воздуха: отвечает его файл (задача 5)
    expect(effectsFor({ type: "dash", unit: ME, ability: "swoop", phase: "start", pos: V(), dir: V(1, 0, 0) }, view)[0]).toEqual({ kind: "fov", deg: 8 });
    for (const ev of [
      { type: "airJump", unit: ME, pos: V() },
      { type: "glide", unit: ME, on: true, pos: V() },
      { type: "charge", unit: ME, slot: "e", charges: 2 },
    ] as MatchEvent[])
      expect(elementEffects(ev, view, view.state.units[0]), ev.type).not.toBeNull();
    // события Воды отвечает её файл (задача 6): здесь проверяется только общая карта
    vi.spyOn(waterFx, "waterEffects").mockReturnValue(null);
    const quiet: MatchEvent[] = [
      { type: "beam", unit: ME, ability: "gust", from: V(), to: V(0, 0, -7), target: 2 },
      { type: "ward", unit: 2, phase: "up", absorbed: 0 },
      { type: "heal", target: 2, source: 2, amount: 3, pos: V() },
      { type: "reaction", kind: "steam", owner: 2, zone: 5, pos: V() },
    ];
    for (const ev of quiet) expect(effectsFor(ev, view), ev.type).toEqual([]);
    expect(effectsFor({ type: "death", target: 2, killer: ME, ability: "airSickle", pos: V() }, view)[0]).toMatchObject({ kind: "burst", preset: "deathAir" });
    expect(effectsFor({ type: "death", target: ME, killer: 2, ability: "waterWhip", pos: V() }, view)[0]).toMatchObject({ kind: "burst", preset: "deathWater" });
  });
});
