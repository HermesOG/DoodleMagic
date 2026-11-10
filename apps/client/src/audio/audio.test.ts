import { describe, expect, it } from "vitest";
import { SOUND_IDS } from "../feel/effects";
import { createRateLimiter, spatial } from "./pan";
import { RECIPES, REVERB_SEND, SOUND_ELEMENT, bandOf, recipeLength } from "./recipes";
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
  it("every element sound signs in its own band: Fire 2–8 kHz, Earth 30–200 Hz, Water 300–1500 Hz, Air 800–4000 Hz (GDD 5)", () => {
    const BAND = { fire: [2000, 8000], earth: [30, 200], water: [300, 1500], air: [800, 4000] } as const;
    for (const id of SOUND_IDS) {
      const el = SOUND_ELEMENT[id];
      const sig = RECIPES[id].layers.filter((l) => l.signature);
      if (el === null) continue;
      expect(sig.length, id).toBe(1);
      const [lo, hi] = bandOf(RECIPES[id]);
      expect([lo >= BAND[el][0], hi <= BAND[el][1]], id).toEqual([true, true]);
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
    // подтверждение по ступеням (round3/01, H3): малая — «тик» 65 мс (фаза 9, L2): щелчок 4,5 кГц на 8 мс, треугольник
    // 1,6 → 1,5 кГц и блеск 3,2 кГц на 20 мс; средняя — прежние 1,8 и 3,6 кГц плюс «тело» и надрыв
    expect(RECIPES.hitLight.layers).toEqual([
      expect.objectContaining({ kind: "noise", filter: "bandpass", freq: 4500, dur: 0.008, gain: 0.4 }),
      expect.objectContaining({ kind: "tone", wave: "triangle", freq: 1600, freqEnd: 1500, dur: 0.065, gain: 0.45 }),
      expect.objectContaining({ kind: "tone", freq: 3200, freqEnd: 3200, dur: 0.02, gain: 0.2 }),
    ]);
    expect(RECIPES.hitLight.reverb).toBeUndefined();
    expect(RECIPES.hitHeavy.layers.slice(2)).toEqual([
      expect.objectContaining({ kind: "tone", freq: 160, freqEnd: 80, dur: 0.09 }),
      expect.objectContaining({ kind: "noise", filter: "bandpass", freq: 1500, dur: 0.06 }),
    ]);
    expect(RECIPES.kill.layers.map((l) => l.freq)).toEqual([880, 1320, 110]);
    expect(RECIPES.fizzle.layers[0]).toMatchObject({ kind: "tone", freq: 600, freqEnd: 200, dur: 0.12 });
    expect(RECIPES.fall.layers[0]).toMatchObject({ freq: 1200, freqEnd: 300 });
    const ignite = RECIPES.fireWallIgnite.layers.find((l) => l.filter === "lowpass");
    expect(ignite).toMatchObject({ kind: "noise", freq: 200, freqEnd: 2000 });
  });

  it("LMB shots have a click, a body and a quiet tail, a small reverb send, and stay short (phase 9, L1)", () => {
    // щелчок шума 5–7 кГц на 4 мс у Огня, Воздуха и Воды; у Земли — каменный 1,2 кГц на 15 мс в броске
    for (const id of ["fireFist", "sickleThrow", "whipSwish"] as const) {
      expect(RECIPES[id].layers, id).toContainEqual(expect.objectContaining({ kind: "noise", filter: "bandpass", freq: 6000, dur: 0.004, gain: 0.5 }));
      const tail = RECIPES[id].layers.find((l) => l.gain === 0.15);
      expect(tail?.kind === "noise" && tail.dur >= 0.15 && tail.dur <= 0.25, id).toBe(true);
    }
    expect(RECIPES.stoneThrow.layers[0]).toMatchObject({ kind: "noise", freq: 1200, dur: 0.015, gain: 0.4 });
    expect(RECIPES.stoneThrow.layers.some((l) => l.gain === 0.15 && l.dur >= 0.15 && l.dur <= 0.25)).toBe(true);
    // тело Огня — «пух» шумом lowpass 300 → 1200 Гц, тело Воздуха — bandpass 1200 → 400 Гц
    expect(RECIPES.fireFist.layers).toContainEqual(expect.objectContaining({ kind: "noise", filter: "lowpass", freq: 300, freqEnd: 1200, dur: 0.08, gain: 0.6 }));
    expect(RECIPES.sickleThrow.layers).toContainEqual(expect.objectContaining({ kind: "noise", filter: "bandpass", freq: 1200, freqEnd: 400, dur: 0.09, gain: 0.45 }));
    expect(RECIPES.whipSwish.layers.find((l) => l.signature)).toMatchObject({ gain: 0.5, attack: 0.015 });
    // камень: нажатие — 100 мс под замах 0,12 с; попадание — хруст 1,8 → 1,0 кГц на 0,6 (L11)
    expect(recipeLength(RECIPES.stoneCast)).toBeLessThanOrEqual(0.1);
    expect(RECIPES.stoneImpact.layers).toContainEqual(expect.objectContaining({ kind: "noise", filter: "bandpass", freq: 1800, freqEnd: 1000, dur: 0.03, gain: 0.6 }));
    for (const id of ["fireFist", "fistHit", "stoneThrow", "stoneImpact", "sickleThrow", "sickleHit", "whipSwish", "whipCrack", "whipHit"] as const) {
      expect(RECIPES[id].reverb, id).toBe(REVERB_SEND.lmb);
      expect(recipeLength(RECIPES[id]), id).toBeLessThanOrEqual(0.8);
    }
    expect(REVERB_SEND.lmb).toBe(0.06);
  });

  it("whizz-by sounds sign in the shooter's band and are short (phase 9, L12)", () => {
    expect([SOUND_ELEMENT.whizzFire, SOUND_ELEMENT.whizzStone, SOUND_ELEMENT.whizzSickle, SOUND_ELEMENT.whizzWater]).toEqual(["fire", "earth", "air", "water"]);
    expect(RECIPES.whizzFire.layers).toContainEqual(expect.objectContaining({ freq: 3000, freqEnd: 1200, dur: 0.18 }));
    expect(RECIPES.whizzStone.layers).toContainEqual(expect.objectContaining({ filter: "lowpass", freq: 500, freqEnd: 180, dur: 0.2 }));
    expect(RECIPES.whizzSickle.layers[0]).toMatchObject({ freq: 3500, freqEnd: 1500, dur: 0.15 });
    expect(RECIPES.whizzWater.layers[0]).toMatchObject({ freq: 1200, freqEnd: 500 });
    for (const id of ["whizzFire", "whizzStone", "whizzSickle", "whizzWater"] as const) expect(recipeLength(RECIPES[id]), id).toBeLessThanOrEqual(0.8);
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
