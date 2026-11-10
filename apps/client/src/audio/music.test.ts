import { describe, expect, it } from "vitest";
import { MUSIC_HIGHPASS_HZ, MUSIC_PEAK_DB, MUSIC_VOICES, LAYER_PEAK, LOOKAHEAD_S, createMusic, makeMotifs, type MusicBus } from "./music";
import type { MusicOut } from "./musicDirector";
import { createAudio } from "./synth";

// Подделка Web Audio: узлы, параметры с временами и источники с началом; currentTime двигает тест.
class Param {
  calls: [op: string, v: number, t: number][] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) {
    this.calls.push(["set", v, t]);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(["lin", v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (!(v > 0)) throw new RangeError("exponential ramp to 0");
    this.calls.push(["exp", v, t]);
    return this;
  }
  setTargetAtTime(v: number, t: number, c: number) {
    if (!(c > 0) || !Number.isFinite(v) || !Number.isFinite(t)) throw new RangeError("bad target");
    this.calls.push(["target", v, t]);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(["cancel", 0, t]);
    return this;
  }
}
class Node {
  outs: Node[] = [];
  constructor(public kind: string) {}
  connect<T extends Node>(n: T): T {
    this.outs.push(n);
    return n;
  }
  disconnect() {
    this.outs = [];
  }
}
class Source extends Node {
  startTime = Number.NaN;
  stopAt = Number.NaN;
  /** currentTime, когда источник поставили. */
  madeAt: number;
  onended: (() => void) | null = null;
  type = "";
  frequency = new Param(440);
  buffer: unknown = null;
  loop = false;
  constructor(kind: string, now: number) {
    super(kind);
    this.madeAt = now;
  }
  start(t = 0) {
    if (Number.isFinite(this.startTime)) throw new Error("InvalidStateError: started twice");
    this.startTime = t;
  }
  stop(t = 0) {
    this.stopAt = t;
  }
}

class Ctx {
  currentTime = 0;
  state = "running";
  sampleRate = 8000;
  destination = new Node("destination");
  nodes: Node[] = [];
  sources: Source[] = [];
  private add<T extends Node>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  createGain() {
    return this.add(Object.assign(new Node("gain"), { gain: new Param(1) }));
  }
  createBiquadFilter() {
    return this.add(Object.assign(new Node("filter"), { type: "lowpass", frequency: new Param(350), Q: new Param(1), gain: new Param(0) }));
  }
  createDynamicsCompressor() {
    const p = () => new Param(0);
    return this.add(Object.assign(new Node("compressor"), { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() }));
  }
  private source(kind: string) {
    const s = new Source(kind, this.currentTime);
    this.sources.push(s);
    return this.add(s);
  }
  createOscillator() {
    return this.source("osc");
  }
  createBufferSource() {
    return this.source("buffer");
  }
  createBuffer(_ch: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { length, sampleRate, getChannelData: () => data };
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

const out = (patch: Partial<MusicOut> = {}): MusicOut => ({
  bed: true, level: 0, bpm: 112, mode: "light", pulse: false, matchPoint: null, final: false,
  duckDb: 0, muteDb: 0, lowpassHz: null, stings: [], ...patch,
});

function setup(hidden = { value: false }) {
  const ctx = new Ctx();
  const limiter = new Node("limiter");
  const bus: MusicBus = { ctx: ctx as unknown as BaseAudioContext, out: limiter as unknown as AudioNode };
  const music = createMusic({ bus: () => bus, hidden: () => hidden.value, every: () => () => undefined, rand: () => 0.5 });
  const startOf = (s: Source) => s.startTime;
  /** Гоняет планировщик раз в 25 мс до until (с паузами таймера, если jitter). */
  const advance = (until: number, step = 0.025) => {
    while (ctx.currentTime < until - 1e-9) {
      ctx.currentTime = Math.min(until, ctx.currentTime + step);
      music.pump();
    }
  };
  return { ctx, limiter, music, startOf, advance, hidden };
}

const oscs = (ctx: Ctx, from = 0) => ctx.sources.slice(from).filter((s) => s.kind === "osc");

describe("music scheduler", () => {
  it("plays on the AudioContext clock up to 0,15 s ahead and never in the past, even after a stalled timer", () => {
    const { ctx, music, startOf, advance } = setup();
    music.set(out({ level: 3, pulse: true, matchPoint: "mine" }));
    advance(4);
    ctx.currentTime += 0.9; // таймер стоял (вкладку тормозили)
    music.pump();
    advance(12);
    expect(ctx.sources.length).toBeGreaterThan(50);
    for (const s of ctx.sources) {
      expect(startOf(s)).toBeGreaterThanOrEqual(s.madeAt);
      expect(startOf(s)).toBeLessThanOrEqual(s.madeAt + LOOKAHEAD_S + 0.6);
    }
  });

  it("keeps its own voices at 8 or fewer, separate from the effects", () => {
    const { ctx, music } = setup();
    music.set(out({ level: 3, pulse: true, matchPoint: "other", final: true }));
    let most = 0;
    for (let t = 0.01; t < 20; t += 0.01) {
      ctx.currentTime = t;
      if (Math.round(t * 100) % 3 === 0) music.pump();
      most = Math.max(most, music.stats().voices);
    }
    expect(most).toBeGreaterThan(2);
    expect(most).toBeLessThanOrEqual(MUSIC_VOICES);
  });

  it("pauses while the tab is hidden or the music is off, and picks up from «now»", () => {
    const { ctx, music, advance, hidden, startOf } = setup({ value: false });
    music.set(out({ level: 2 }));
    advance(2);
    hidden.value = true;
    music.pump();
    const n = ctx.sources.length;
    advance(6);
    expect(ctx.sources.length).toBe(n);
    expect(music.stats().playing).toBe(false);
    hidden.value = false;
    advance(7);
    expect(ctx.sources.length).toBeGreaterThan(n);
    for (const s of ctx.sources.slice(n)) expect(startOf(s)).toBeGreaterThanOrEqual(6);
    music.setEnabled(false);
    const m = ctx.sources.length;
    advance(9);
    expect(ctx.sources.length).toBe(m);
  });

  it("goes into the limiter through a 100 Hz highpass and stays out of the sub band", () => {
    const { ctx, limiter, music, advance } = setup();
    music.set(out({ level: 3, pulse: true, matchPoint: "other" }));
    advance(10);
    const vol = ctx.nodes.find((n) => n.outs.includes(limiter));
    expect(vol?.kind).toBe("gain");
    const hp = ctx.nodes.find((n) => (n as Node & { type?: string }).type === "highpass" && n.outs.length > 0);
    expect((hp as unknown as { frequency: Param }).frequency.value).toBe(MUSIC_HIGHPASS_HZ);
    for (const o of oscs(ctx)) for (const [, v] of o.frequency.calls) expect(v).toBeGreaterThanOrEqual(100);
    // пики: сумма слоёв ≤ 1, громкость 0,5 → не выше −18 дБFS и при громкости 1
    const sum = Object.values(LAYER_PEAK).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(1);
    music.setVolume(1);
    const top = (vol as unknown as { gain: Param }).gain.calls.at(-1)![1];
    expect(20 * Math.log10(top * sum)).toBeLessThanOrEqual(MUSIC_PEAK_DB + 1e-9);
  });

  it("level 0 is the pad alone; level 2 adds the hand drum 180 → 120 Hz", () => {
    const { ctx, music, advance } = setup();
    music.set(out({ level: 0 }));
    advance(5);
    expect(oscs(ctx).every((o) => o.type === "triangle")).toBe(true);
    const n = ctx.sources.length;
    music.set(out({ level: 2 }));
    advance(10);
    const drums = oscs(ctx, n).filter((o) => o.frequency.calls[0]?.[1] === 180);
    expect(drums.length).toBeGreaterThan(4);
    expect(drums.every((o) => o.frequency.calls.some(([op, v]) => op === "exp" && v === 120))).toBe(true);
  });

  it("«Бой!» rings the 220 Hz gong with bell partials and restarts the grid on the downbeat", () => {
    const { ctx, music, advance, startOf } = setup();
    music.set(out({ bed: false }));
    advance(1);
    const n = ctx.sources.length;
    music.set(out({ level: 1, stings: ["fight"] }));
    const at = ctx.currentTime;
    const gong = oscs(ctx, n).filter((o) => startOf(o) - at < 0.02).map((o) => Math.round(o.frequency.calls[0]![1]));
    expect(gong).toEqual(expect.arrayContaining([220, 440, 607, 1188]));
    // пэд вступает на сильную долю вместе с гонгом
    const pad = oscs(ctx, n).filter((o) => o.type === "triangle");
    expect(pad.length).toBeGreaterThan(0);
    expect(Math.min(...pad.map(startOf)) - at).toBeLessThan(0.02);
  });
});

describe("music motifs", () => {
  it("4–6 notes between D4 and D5, the first on the downbeat, the same for the same seed", () => {
    const a = makeMotifs(1234);
    expect(makeMotifs(1234)).toEqual(a);
    expect(makeMotifs(99)).not.toEqual(a);
    for (const m of a) {
      const notes = m.filter((d) => d !== null);
      expect(notes.length).toBeGreaterThanOrEqual(4);
      expect(notes.length).toBeLessThanOrEqual(6);
      expect(m[0]).not.toBe(null);
      for (const d of notes) expect(d).toBeGreaterThanOrEqual(0);
      for (const d of notes) expect(d).toBeLessThanOrEqual(5);
    }
  });
});

describe("GameAudio.musicBus", () => {
  it("is null before unlock, then a gain straight into the limiter past the compressor, muted with the sound", () => {
    const made: Ctx[] = [];
    const Klass = class extends Ctx {
      constructor() {
        super();
        made.push(this);
      }
    };
    const audio = createAudio({ contextClass: Klass as unknown as typeof AudioContext, rand: () => 0.5 });
    expect(audio.musicBus()).toBe(null);
    audio.unlock();
    const c = made[0]!;
    const bus = audio.musicBus() as unknown as { ctx: Ctx; out: Node & { gain: Param } };
    expect(bus.ctx).toBe(c);
    const [comp, limiter] = c.nodes.filter((n) => n.kind === "compressor");
    expect(limiter!.outs).toContain(c.destination);
    expect(bus.out.outs).toEqual([limiter]);
    expect(comp!.outs).toEqual([limiter]);
    audio.setMuted(true);
    expect(bus.out.gain.calls.at(-1)?.[1]).toBe(0);
  });
});
