import { describe, expect, it } from "vitest";
import { NOBODY, createMageUnit, createMatchState, type Element, type MatchEvent, type PickupKind, type UnitId, type Vec3 } from "@doodlemagic/sim";
import { SOUND_LABELS } from "../audio/audition";
import { RECIPES, SOUND_ELEMENT, recipeLength } from "../audio/recipes";
import type { Effect, SoundId } from "./effects";
import { effectsFor } from "./eventMap";

/** Отклик на объекты карты и ярость (фаза 6, задача 3): звук, FOV, тосты; всплесков нет — вид по состоянию (задача 2). */
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 3;
const AT = V(12, 0.5, -20);
const viewOf = (el: Element) => ({
  localId: ME,
  state: createMatchState([createMageUnit(ME, el, { pos: V(), yaw: 0 }), createMageUnit(OTHER, "earth", { pos: V(6, 0, -8), yaw: 0.4 })]),
});
const pickup = (kind: PickupKind, phase: "warn" | "spawn" | "take", unit: UnitId = NOBODY): MatchEvent => ({ type: "pickup", kind, index: kind === "rune" ? 6 : 2, phase, unit, pos: AT });
const fury = (unit: UnitId, phase: "end" | "slain", by: UnitId = NOBODY): MatchEvent => ({ type: "fury", unit, phase, by, pos: V(1, 0, 1) });
const snd = (id: SoundId, pos: Vec3 | null = null, gain = 1): Effect => ({ kind: "sound", id, pos, gain });

describe("pickup and fury feel: the same for every element of mine", () => {
  // Воздух и Вода сначала спрашивают свои файлы (elementEffects): события фазы 6 им не принадлежат
  for (const el of ["fire", "earth", "air", "water"] as const) {
    const fx = (ev: MatchEvent): Effect[] => effectsFor(ev, viewOf(el));

    it(`${el}: the rune warning and spawn ring over the whole map; an orb comes back quietly`, () => {
      expect(fx(pickup("rune", "warn"))).toEqual([snd("runeWarn")]);
      expect(fx(pickup("rune", "spawn"))).toEqual([snd("runeSpawn")]);
      expect(fx(pickup("orb", "spawn"))).toEqual([]);
    });

    it(`${el}: my orb chimes at the ear; another mage's — where it lay, quietly`, () => {
      expect(fx(pickup("orb", "take", ME))).toEqual([snd("orbTake")]);
      const theirs = fx(pickup("orb", "take", OTHER));
      expect(theirs).toEqual([snd("orbTake", AT, theirs[0]?.kind === "sound" ? theirs[0].gain : 1)]);
      expect(theirs[0]?.kind === "sound" && theirs[0].gain < 1).toBe(true);
    });

    it(`${el}: my rune is weight — a chord at the ear, FOV +4° and a toast; another mage's is heard from afar`, () => {
      expect(fx(pickup("rune", "take", ME))).toEqual([snd("runeTake"), { kind: "fov", deg: 4 }, { kind: "toast", text: "Руна ярости! +30 % урона" }]);
      const theirs = fx(pickup("rune", "take", OTHER));
      expect(theirs).toHaveLength(1);
      expect(theirs[0]).toMatchObject({ kind: "sound", id: "runeTake", pos: AT, gain: 1 });
      expect(theirs[0]?.kind === "sound" ? theirs[0].floor : 0).toBeGreaterThanOrEqual(0.4);
    });

    it(`${el}: the fury status itself says nothing; my fury ends with a soft falling chime`, () => {
      expect(fx({ type: "status", target: ME, status: "fury", ticks: 720, source: ME })).toEqual([]);
      expect(fx(fury(ME, "end"))).toEqual([snd("furyEnd")]);
      expect(fx(fury(OTHER, "end"))).toEqual([]);
    });

    it(`${el}: I slay the holder — a cracking-seal chime and «+10 к ульте»; others' slays and my own loss are silent here`, () => {
      expect(fx(fury(OTHER, "slain", ME))).toEqual([snd("furySlain"), { kind: "toast", text: "Руна сбита! +10 к ульте" }]);
      expect(fx(fury(ME, "slain", OTHER))).toEqual([]);
      expect(fx(fury(OTHER, "slain", 4))).toEqual([]);
      expect(fx(fury(OTHER, "slain", NOBODY))).toEqual([]);
    });
  }

  it("draws no bursts: the orbs, the rune and the holder's glow come from the state", () => {
    const view = viewOf("fire");
    const all: MatchEvent[] = [
      ...(["orb", "rune"] as const).flatMap((k) => (["warn", "spawn"] as const).map((p) => pickup(k, p))),
      ...(["orb", "rune"] as const).flatMap((k) => [ME, OTHER].map((u) => pickup(k, "take", u))),
      fury(ME, "end"), fury(OTHER, "end"), fury(OTHER, "slain", ME), fury(ME, "slain", OTHER),
    ];
    for (const ev of all) expect(effectsFor(ev, view).some((e) => e.kind === "burst")).toBe(false);
  });
});

describe("pickup sounds: tonal bells in the neutral language", () => {
  /** Длины по плану (Task 3): сфера 0,35 с, объявление и появление руны 0,8 с, взятие 0,6 с, конец ярости 0,4 с, сбитый носитель 0,5 с. */
  const LEN = { orbTake: 0.35, runeWarn: 0.8, runeSpawn: 0.8, runeTake: 0.6, furyEnd: 0.4, furySlain: 0.5 } as const;

  it("has a recipe of its planned length (≤ 0.8 s), no element signature and an audition label", () => {
    for (const [id, len] of Object.entries(LEN) as [keyof typeof LEN, number][]) {
      expect(recipeLength(RECIPES[id]), id).toBeCloseTo(len, 2);
      expect(recipeLength(RECIPES[id]), id).toBeLessThanOrEqual(0.8);
      expect(SOUND_ELEMENT[id], id).toBeNull();
      expect(RECIPES[id].layers.some((l) => l.signature), id).toBe(false);
      expect(SOUND_LABELS[id].length, id).toBeGreaterThan(0);
    }
  });

  it("is a bell, not an element: the loudest layer is a steady tone, no pitch glides like whistles or Earth thumps", () => {
    for (const id of Object.keys(LEN) as (keyof typeof LEN)[]) {
      const layers = RECIPES[id].layers;
      const loud = layers.reduce((a, b) => (b.gain > a.gain ? b : a));
      expect(loud.kind, id).toBe("tone");
      for (const l of layers.filter((q) => q.kind === "tone")) {
        // колокол держит высоту: дрейф не больше полутона (свист Воздуха и удар Земли скользят)
        expect(Math.abs(Math.log2(l.freqEnd / l.freq)) * 12, `${id} ${l.freq} → ${l.freqEnd}`).toBeLessThanOrEqual(1);
        expect(l.drive, id).toBeUndefined();
      }
      // наушники без резкостей: тоны выше 3 кГц — только тихий отблеск
      for (const l of layers.filter((q) => q.kind === "tone" && Math.max(q.freq, q.freqEnd) > 3000)) expect(l.gain, id).toBeLessThanOrEqual(0.1);
    }
  });
});
