import { describe, expect, it } from "vitest";
import { SOUND_IDS } from "../feel/effects";
import { createRateLimiter, spatial } from "./pan";
import { RECIPES, SOUND_ELEMENT, bandOf, recipeLength } from "./recipes";
import { clickTimes, driveCurve } from "./synth";
import { createVoiceLimiter } from "./voices";

describe("audio", () => {
  it("has a short recipe for every sound; Fire signs in 2–8 kHz, Earth in 30–200 Hz (GDD 5)", () => {
    for (const id of SOUND_IDS) expect(Math.max(...RECIPES[id].layers.map((l) => l.delay + l.dur))).toBeLessThanOrEqual(0.8);
    for (const id of ["fireFist", "fireballBoom", "fireWallIgnite", "dash"] as const) expect(bandOf(RECIPES[id]).map((f) => f >= 2000 && f <= 8000)).toEqual([true, true]);
    for (const id of ["stoneCast", "stoneImpact", "pillarStrike", "quakeStrike"] as const) expect(bandOf(RECIPES[id]).map((f) => f >= 30 && f <= 200)).toEqual([true, true]);
  });

  it("pans by side, fades with distance, knows what is behind, and limits the hit tick to 4 a second", () => {
    const l = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 };
    const at = (x: number, z: number) => spatial(l, { x, y: 1.6, z });
    expect([at(5, 0).pan > 0.9, at(-5, 0).pan < -0.9, at(0, -30).gain < at(0, -3).gain, at(0, 5).behind]).toEqual([true, true, true, true]);
    expect(spatial(l, null)).toEqual({ pan: 0, gain: 1, behind: false });
    const ok = createRateLimiter(4);
    expect([0, 0.1, 0.2, 0.25, 0.3, 0.5, 0.55].map((t) => ok(t))).toEqual([true, false, false, true, false, true, false]);
  });
});

describe("recipes table", () => {
  it("every Fire sound signs in 2–8 kHz and every Earth sound in 30–200 Hz, so the pair passes a blind test", () => {
    for (const id of SOUND_IDS) {
      const el = SOUND_ELEMENT[id];
      const sig = RECIPES[id].layers.filter((l) => l.signature);
      if (el === null) continue;
      expect(sig.length, id).toBe(1);
      const [lo, hi] = bandOf(RECIPES[id]);
      if (el === "fire") expect([lo >= 2000, hi <= 8000], id).toEqual([true, true]);
      else expect([lo >= 30, hi <= 200], id).toEqual([true, true]);
    }
  });

  it("only playable parameters: audible frequencies, attack inside the layer, gain at most 1, no custom wave", () => {
    for (const id of SOUND_IDS) {
      const r = RECIPES[id];
      expect(r.layers.length, id).toBeGreaterThan(0);
      expect(r.layers.length, id).toBeLessThanOrEqual(4);
      expect(r.layers.filter((l) => l.signature).length, id).toBeLessThanOrEqual(1);
      for (const l of r.layers) {
        for (const f of [l.freq, l.freqEnd]) expect(f >= 20 && f <= 16000, `${id} ${f} Hz`).toBe(true);
        expect(l.delay >= 0 && l.attack > 0 && l.attack < l.dur, `${id} envelope`).toBe(true);
        expect(l.gain > 0 && l.gain <= 1, `${id} gain`).toBe(true);
        expect(l.wave, id).not.toBe("custom");
        if (l.clicks !== undefined) expect(Number.isInteger(l.clicks) && l.clicks > 0, id).toBe(true);
        if (l.sweep !== undefined) expect(l.sweep > 0 && l.sweep <= 1, id).toBe(true);
        if (l.drive !== undefined) expect(l.drive > 0, id).toBe(true);
        if (l.ceiling !== undefined) expect(l.ceiling > Math.max(l.freq, l.freqEnd) && l.ceiling <= 16000, id).toBe(true);
      }
      expect(r.vary === undefined || (r.vary >= 0 && r.vary <= 0.1), id).toBe(true);
    }
  });

  it("follows the feel notes: crackle is highpass noise with clicks, Earth thumps are sines falling to 40 or 30 Hz", () => {
    const crackle = (id: (typeof SOUND_IDS)[number]) => RECIPES[id].layers.find((l) => l.signature);
    for (const id of ["fireFist", "fireballBoom", "fireWallIgnite", "fireWallTelegraph"] as const) {
      expect(crackle(id), id).toMatchObject({ kind: "noise", filter: "highpass" });
      expect(crackle(id)?.clicks, id).toBeGreaterThan(0);
      expect(crackle(id)?.ceiling, id).toBeLessThanOrEqual(8000); // иначе энергия треска уходит в шипение выше полосы
    }
    expect(crackle("stoneImpact")).toMatchObject({ kind: "tone", wave: "sine", freq: 90, freqEnd: 40 });
    expect(crackle("pillarStrike")).toMatchObject({ kind: "tone", wave: "sine", freq: 70, freqEnd: 30 });
    expect(crackle("quakeStrike")).toMatchObject({ kind: "tone", wave: "sine", freq: 70, freqEnd: 30 });
    expect(crackle("pillarTelegraph")).toMatchObject({ freq: 40, freqEnd: 40 });
    expect(RECIPES.hitTick.layers).toEqual([expect.objectContaining({ kind: "tone", freq: 1800, freqEnd: 1800, dur: 0.04 })]);
    expect(RECIPES.kill.layers.map((l) => l.freq)).toEqual([880, 1320]);
    expect(RECIPES.fizzle.layers[0]).toMatchObject({ kind: "tone", freq: 600, freqEnd: 200, dur: 0.12 });
    expect(RECIPES.fall.layers[0]).toMatchObject({ freq: 1200, freqEnd: 300 });
    const ignite = RECIPES.fireWallIgnite.layers.find((l) => l.filter === "lowpass");
    expect(ignite).toMatchObject({ kind: "noise", freq: 200, freqEnd: 2000 });
  });

  it("bandOf reads the signature layer, else the loudest one; recipeLength is the last layer's end", () => {
    expect(bandOf({ layers: [{ kind: "tone", freq: 300, freqEnd: 100, delay: 0, attack: 0.01, dur: 0.1, gain: 0.2 }, { kind: "tone", freq: 50, freqEnd: 80, delay: 0, attack: 0.01, dur: 0.1, gain: 0.1, signature: true }] })).toEqual([50, 80]);
    expect(bandOf({ layers: [{ kind: "tone", freq: 300, freqEnd: 100, delay: 0, attack: 0.01, dur: 0.1, gain: 0.2 }, { kind: "tone", freq: 50, freqEnd: 80, delay: 0, attack: 0.01, dur: 0.1, gain: 0.5 }] })).toEqual([50, 80]);
    expect(recipeLength(RECIPES.kill)).toBeCloseTo(0.09 + 0.3);
  });
});

describe("spatial", () => {
  it("turns with the listener: what is ahead after a quarter turn left was on the left", () => {
    const l = { pos: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2 }; // смотрим вдоль −X
    expect(spatial(l, { x: -5, y: 0, z: 0 }).pan).toBeCloseTo(0);
    expect(spatial(l, { x: -5, y: 0, z: 0 }).behind).toBe(false);
    expect(spatial(l, { x: 0, y: 0, z: -5 }).pan).toBeCloseTo(1); // справа теперь −Z
    expect(spatial(l, { x: 5, y: 0, z: 0 }).behind).toBe(true);
  });

  it("gain is 1 / (1 + 0.15·d); a source on the listener sits in the middle", () => {
    const l = { pos: { x: 1, y: 2, z: 3 }, yaw: 0.3 };
    expect(spatial(l, { x: 1, y: 2, z: 13 }).gain).toBeCloseTo(1 / 2.5);
    const above = spatial(l, { x: 1, y: 5, z: 3 });
    expect([above.pan, above.behind]).toEqual([0, false]);
    expect(above.gain).toBeCloseTo(1 / 1.45);
    expect(spatial(l, { x: 1, y: 2, z: 3 })).toEqual({ pan: 0, gain: 1, behind: false });
  });

  it("the rate limiter is per instance and lets the first call through at any time", () => {
    const a = createRateLimiter(4);
    const b = createRateLimiter(4);
    expect([a(10), b(10.1), a(10.1), a(10.26)]).toEqual([true, true, false, true]);
  });
});

describe("voice limiter", () => {
  it("starts at most max voices at once and frees a slot when a voice ends", () => {
    const v = createVoiceLimiter(3);
    expect([v.tryStart(0, 0.5), v.tryStart(0, 0.2), v.tryStart(0.1, 0.4), v.tryStart(0.15, 0.3)]).toEqual([true, true, true, false]);
    expect(v.active(0.15)).toBe(3);
    expect(v.active(0.2)).toBe(2);
    expect(v.tryStart(0.25, 0.9)).toBe(true);
    expect(v.active(0.6)).toBe(1);
  });
});

describe("synth helpers", () => {
  it("clickTimes: n sorted clicks inside the layer, none overlapping the next", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [n, dur] of [[3, 0.07], [12, 0.55], [1, 0.1]] as const) {
      const c = clickTimes(n, dur, rand);
      expect(c.length).toBe(n);
      for (let i = 0; i < c.length; i++) {
        const [t, len] = c[i]!;
        expect(t >= 0 && len > 0 && t + len <= dur).toBe(true);
        if (i > 0) expect(t).toBeGreaterThanOrEqual(c[i - 1]![0] + c[i - 1]![1]);
      }
    }
  });

  it("driveCurve: odd, monotonic, ±1 stays ±1, more drive bends harder", () => {
    const c = driveCurve(3, 257);
    expect([c[0], c[128], c[256]]).toEqual([-1, 0, 1]);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThan(c[i - 1]!);
    expect(c[64]!).toBeCloseTo(-c[192]!);
    expect(driveCurve(3, 257)[192]!).toBeGreaterThan(driveCurve(1, 257)[192]!);
  });
});
