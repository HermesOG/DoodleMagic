import { describe, expect, it } from "vitest";
import { SOUND_IDS } from "../feel/effects";
import { RECIPES } from "./recipes";
import { BEHIND_LOWPASS_HZ, MAX_VOICES, createAudio, unlockOnGesture } from "./synth";

// Подделка Web Audio: только то, чем пользуется синтезатор, плюс правила, на которых падают настоящие браузеры.
type Call = [op: string, value: number, time: number];

class FakeParam {
  calls: Call[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) {
    this.calls.push(["set", v, t]);
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(["lin", v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (!(v > 0)) throw new RangeError(`exponential ramp to ${v}`);
    const prev = this.calls.at(-1);
    if (prev && !(prev[1] > 0)) throw new RangeError(`exponential ramp from ${prev[1]}`);
    this.calls.push(["exp", v, t]);
    return this;
  }
  setTargetAtTime(v: number, t: number, c: number) {
    if (!(c > 0)) throw new RangeError("time constant");
    this.calls.push(["target", v, t]);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(["cancel", 0, t]);
    return this;
  }
}

class FakeNode {
  outs: FakeNode[] = [];
  disconnected = false;
  constructor(public kind: string) {}
  connect(n: FakeNode) {
    this.outs.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
    this.outs = [];
  }
}

class FakeSource extends FakeNode {
  started: number[] = [];
  stopped: number[] = [];
  onended: (() => void) | null = null;
  start(t = 0) {
    if (this.started.length) throw new Error("InvalidStateError: started twice");
    this.started.push(t);
  }
  stop(t = 0) {
    this.stopped.push(t);
  }
}

class FakeOsc extends FakeSource {
  type = "sine";
  frequency = new FakeParam(440);
  constructor() {
    super("osc");
  }
}

class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
  loop = false;
  constructor() {
    super("buffer");
  }
}

class FakeCtx {
  static made: FakeCtx[] = [];
  currentTime = 0;
  state: "running" | "suspended" | "closed" = "running";
  sampleRate = 48000;
  resumed = 0;
  nodes: FakeNode[] = [];
  buffers: { length: number }[] = [];
  destination = new FakeNode("destination");
  constructor(public options?: unknown) {
    FakeCtx.made.push(this);
  }
  resume() {
    this.resumed++;
    this.state = "running";
    return Promise.resolve();
  }
  private add<T extends FakeNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  createGain() {
    return this.add(Object.assign(new FakeNode("gain"), { gain: new FakeParam(1) }));
  }
  createBiquadFilter() {
    return this.add(Object.assign(new FakeNode("filter"), { type: "lowpass", frequency: new FakeParam(350), Q: new FakeParam(1) }));
  }
  createWaveShaper() {
    return this.add(Object.assign(new FakeNode("shaper"), { curve: null as Float32Array | null, oversample: "none" }));
  }
  createStereoPanner() {
    return this.add(Object.assign(new FakeNode("panner"), { pan: new FakeParam(0) }));
  }
  createDynamicsCompressor() {
    return this.add(
      Object.assign(new FakeNode("compressor"), {
        threshold: new FakeParam(-24),
        ratio: new FakeParam(12),
        knee: new FakeParam(30),
        attack: new FakeParam(0.003),
        release: new FakeParam(0.25),
      }),
    );
  }
  createOscillator() {
    return this.add(new FakeOsc());
  }
  createBufferSource() {
    return this.add(new FakeBufferSource());
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    const b = { length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
    this.buffers.push(b);
    return b;
  }
  of<K extends string>(kind: K) {
    return this.nodes.filter((n) => n.kind === kind) as (FakeNode & Record<string, unknown>)[];
  }
  sources() {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }
}

function setup() {
  FakeCtx.made = [];
  const audio = createAudio({ contextClass: FakeCtx as unknown as typeof AudioContext, rand: () => 0.5 });
  const ctx = () => {
    const c = FakeCtx.made[0];
    if (!c) throw new Error("no context yet");
    return c;
  };
  return { audio, ctx };
}

/** Узлы, через которые звук идёт от ноды до выхода. */
function pathFrom(n: FakeNode): FakeNode[] {
  const out: FakeNode[] = [];
  let cur: FakeNode | undefined = n;
  while (cur) {
    out.push(cur);
    cur = cur.outs[0];
  }
  return out;
}

describe("synth", () => {
  it("creates no AudioContext before the first gesture, then exactly one, interactive", () => {
    const { audio } = setup();
    audio.play("fireFist", null, 1);
    audio.setVolume(0.5);
    expect(FakeCtx.made.length).toBe(0);
    expect(audio.stats().unlocked).toBe(false);
    audio.unlock();
    audio.unlock();
    expect(FakeCtx.made.length).toBe(1);
    expect(FakeCtx.made[0]!.options).toEqual({ latencyHint: "interactive" });
    expect(audio.stats().unlocked).toBe(true);
  });

  it("master bus: gain → compressor −12 dB 4:1 → destination; one second of noise for everything", () => {
    const { audio, ctx } = setup();
    audio.unlock();
    const [comp] = ctx().of("compressor");
    expect(comp && [(comp.threshold as FakeParam).value, (comp.ratio as FakeParam).value]).toEqual([-12, 4]);
    expect(comp!.outs).toEqual([ctx().destination]);
    const master = ctx().of("gain").find((g) => g.outs[0] === comp);
    expect(master).toBeDefined();
    expect(ctx().buffers.map((b) => b.length)).toEqual([48000]);
    audio.play("fireballBoom", null, 1);
    audio.play("quakeStrike", null, 1);
    expect(ctx().buffers.length).toBe(1);
  });

  it("plays every recipe within Web Audio rules: each layer one source, started and stopped after its end", () => {
    const { audio, ctx } = setup();
    audio.unlock();
    for (const id of SOUND_IDS) {
      ctx().currentTime += 2;
      const before = ctx().sources().length;
      expect(() => audio.play(id, { x: 3, y: 0, z: -4 }, 1), id).not.toThrow();
      const fresh = ctx().sources().slice(before);
      expect(fresh.length, id).toBe(RECIPES[id].layers.length);
      for (const s of fresh) {
        expect(s.started.length, id).toBe(1);
        expect(s.stopped[0]!, id).toBeGreaterThan(s.started[0]!);
        expect(pathFrom(s).at(-1), id).toBe(ctx().destination);
      }
    }
  });

  it("a crackle layer is noise → highpass → lowpass ceiling → envelope → clicks, and the clicks spike above a quiet bed", () => {
    const { audio, ctx } = setup();
    audio.unlock();
    audio.play("fireFist", null, 1);
    const crackle = pathFrom(ctx().sources()[0]!);
    const [hp, top, env, clicks] = crackle.slice(1, 5) as (FakeNode & Record<string, FakeParam | string>)[];
    expect([crackle[0]!.kind, hp!.type, top!.type, (top!.frequency as FakeParam).value]).toEqual(["buffer", "highpass", "lowpass", 8000]);
    expect([env!.kind, clicks!.kind]).toEqual(["gain", "gain"]);
    const levels = (clicks!.gain as FakeParam).calls.map((c) => c[1]);
    expect(Math.min(...levels)).toBeLessThan(0.5);
    expect(levels.filter((v) => v === 1).length).toBe(RECIPES.fireFist.layers[0]!.clicks);
  });

  it("hitTick is one 1.8 kHz sine, at most 4 a second", () => {
    const { audio, ctx } = setup();
    audio.unlock();
    for (const t of [0, 0.1, 0.2, 0.25, 0.3, 0.5]) {
      ctx().currentTime = t;
      audio.play("hitTick", null, 1);
    }
    const ticks = ctx().sources();
    expect(ticks.map((s) => s.started[0])).toEqual([0, 0.25, 0.5]);
    expect(ticks.every((s) => s instanceof FakeOsc && s.type === "sine" && s.frequency.calls[0]![1] === 1800)).toBe(true);
  });

  it(`caps concurrent voices at ${MAX_VOICES}: extra sounds do not start, and slots free up when voices end`, () => {
    const { audio, ctx } = setup();
    audio.unlock();
    for (let i = 0; i < MAX_VOICES + 6; i++) audio.play("stoneImpact", null, 1);
    expect(audio.stats().voices).toBe(MAX_VOICES);
    expect(ctx().sources().length).toBe(MAX_VOICES * RECIPES.stoneImpact.layers.length);
    ctx().currentTime = 1;
    audio.play("stoneImpact", null, 1);
    expect(audio.stats().voices).toBe(1);
  });

  it("muted: nothing starts and the master fades to 0; volume is clamped and survives until unlock", () => {
    const { audio, ctx } = setup();
    audio.setVolume(3);
    audio.unlock();
    const master = ctx().of("gain")[0]!;
    expect((master.gain as FakeParam).value).toBe(1);
    audio.setMuted(true);
    audio.play("fireballBoom", null, 1);
    expect(ctx().sources().length).toBe(0);
    expect((master.gain as FakeParam).calls.at(-1)?.slice(0, 2)).toEqual(["target", 0]);
    expect(audio.stats()).toMatchObject({ muted: true, volume: 1 });
    audio.setMuted(false);
    audio.setVolume(0.25);
    expect((master.gain as FakeParam).calls.at(-1)?.slice(0, 2)).toEqual(["target", 0.25]);
    audio.setVolume(Number.NaN);
    expect(audio.stats().volume).toBe(0.25);
    audio.play("fireballBoom", null, 1);
    expect(ctx().sources().length).toBe(RECIPES.fireballBoom.layers.length);
  });

  it("places the voice: pan by side, gain by distance and by the event, lowpass 3 kHz from behind", () => {
    const { audio, ctx } = setup();
    audio.unlock();
    audio.setListener({ x: 0, y: 1.6, z: 0 }, 0);
    const voiceOf = (pos: { x: number; y: number; z: number }, gain: number) => {
      const before = ctx().sources().length;
      ctx().currentTime += 2;
      audio.play("fireFist", pos, gain);
      return pathFrom(ctx().sources()[before]!);
    };
    const right = voiceOf({ x: 5, y: 1.6, z: 0 }, 0.5);
    const pan = right.find((n) => n.kind === "panner") as FakeNode & { pan: FakeParam };
    expect(pan.pan.value).toBeGreaterThan(0.9);
    const bus = right[right.indexOf(pan) - 1] as FakeNode & { gain: FakeParam };
    expect(bus.kind).toBe("gain");
    expect(bus.gain.value).toBeCloseTo(0.5 / (1 + 0.15 * 5));
    expect(right.some((n) => n.kind === "filter" && (n as FakeNode & { frequency: FakeParam }).frequency.value === BEHIND_LOWPASS_HZ)).toBe(false);
    const behind = voiceOf({ x: 0, y: 1.6, z: 6 }, 1);
    const lp = behind.filter((n) => n.kind === "filter").at(-1) as FakeNode & { type: string; frequency: FakeParam };
    expect([lp.type, lp.frequency.value]).toEqual(["lowpass", BEHIND_LOWPASS_HZ]);
    expect(behind.indexOf(lp)).toBeLessThan(behind.findIndex((n) => n.kind === "panner"));
  });

  it("ignores silent or broken calls and disconnects a voice once its last layer ends", () => {
    const { audio, ctx } = setup();
    audio.unlock();
    for (const g of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) audio.play("kill", null, g);
    audio.play("kill", { x: 1e9, y: 0, z: 0 }, 1);
    expect(ctx().sources().length).toBe(0);
    audio.play("kill", null, 1);
    const srcs = ctx().sources();
    const master = ctx().of("gain")[0]!;
    const voiceNodes = srcs.flatMap((s) => {
      const p = pathFrom(s);
      return p.slice(0, p.indexOf(master));
    });
    expect(voiceNodes.length).toBeGreaterThan(srcs.length);
    const last = srcs.reduce((a, b) => (b.stopped[0]! > a.stopped[0]! ? b : a));
    expect(last.onended).toBeTypeOf("function");
    last.onended!();
    expect(voiceNodes.every((n) => n.disconnected)).toBe(true);
    expect(master.disconnected).toBe(false);
  });

  it("a suspended context drops sounds instead of queueing them; unlock resumes it", () => {
    const { audio, ctx } = setup();
    audio.unlock();
    ctx().state = "suspended";
    audio.play("dash", null, 1);
    expect(ctx().sources().length).toBe(0);
    audio.unlock();
    expect(ctx().resumed).toBe(1);
  });

  it("stays silent without Web Audio or when the context cannot be created", () => {
    const missing = createAudio({ contextClass: null });
    expect(() => {
      missing.unlock();
      missing.play("courage", null, 1);
      missing.setListener({ x: 0, y: 0, z: 0 }, 0);
    }).not.toThrow();
    expect(missing.stats().unlocked).toBe(false);
    class Broken {
      constructor() {
        throw new Error("NotAllowedError");
      }
    }
    const broken = createAudio({ contextClass: Broken as unknown as typeof AudioContext });
    expect(() => {
      broken.unlock();
      broken.play("courage", null, 1);
    }).not.toThrow();
  });

  it("unlockOnGesture unlocks on pointer and key presses (and so resumes a context the browser suspended) until disposed", () => {
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    let unlocks = 0;
    const dispose = unlockOnGesture({ unlock: () => unlocks++ }, target as unknown as EventTarget);
    expect([...listeners.keys()].sort()).toEqual(["keydown", "pointerdown"]);
    listeners.get("pointerdown")!();
    listeners.get("keydown")!();
    expect(unlocks).toBe(2);
    dispose();
    expect(listeners.size).toBe(0);
  });
});
