import { describe, expect, it } from "vitest";
import { bandShares, installAudioConsole } from "./audition";
import type { GameAudio } from "./synth";

const sine = (hz: number, rate = 48000, s = 0.5) => Float32Array.from({ length: Math.round(rate * s) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));

describe("audition tools", () => {
  it("bandShares puts a 90 Hz sine in the Earth band and a 4 kHz sine in the Fire band", () => {
    const low = bandShares(sine(90), 48000);
    const high = bandShares(sine(4000), 48000);
    expect(low.earth).toBeGreaterThan(0.95);
    expect(low.fire).toBeLessThan(0.01);
    expect(high.fire).toBeGreaterThan(0.95);
    expect(high.centroidHz).toBeCloseTo(4000, -2);
    expect(bandShares(new Float32Array(100), 48000)).toEqual({ earth: 0, fire: 0, centroidHz: 0 });
  });

  it("installAudioConsole puts dmAudio on the target and plays at the ear or beside the listener", () => {
    const calls: unknown[][] = [];
    const audio = {
      unlock: () => calls.push(["unlock"]),
      play: (...a: unknown[]) => calls.push(["play", ...a]),
      setListener: () => {},
      setVolume: (v: number) => calls.push(["volume", v]),
      setMuted: (m: boolean) => calls.push(["mute", m]),
      stats: () => ({ unlocked: true, voices: 0, volume: 1, muted: false }),
    } satisfies GameAudio;
    const target: { dmAudio?: unknown } = {};
    const api = installAudioConsole(audio, target);
    expect(target.dmAudio).toBe(api);
    api.play("kill");
    api.play("stoneImpact", 5, -2);
    api.mute();
    expect(calls).toEqual([["unlock"], ["play", "kill", null, 1], ["unlock"], ["play", "stoneImpact", { x: 5, y: 1.6, z: -2 }, 1], ["mute", true]]);
  });
});
