import { describe, expect, it } from "vitest";
import { MAX_TICKS_PER_FRAME, advanceClock } from "./fixedStep";

const TICK = 1 / 60;

function run(frameS: number, frames: number): number[] {
  let acc = 0;
  const ticks: number[] = [];
  for (let k = 0; k < frames; k++) {
    const s = advanceClock(acc, frameS, TICK);
    acc = s.acc;
    ticks.push(s.ticks);
    expect(s.alpha).toBeGreaterThanOrEqual(0);
    expect(s.alpha).toBeLessThan(1);
  }
  return ticks;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("advanceClock", () => {
  it("runs one tick per frame at 60 FPS", () => {
    expect(run(1 / 60, 120).every((t) => t === 1)).toBe(true);
  });

  it("keeps 60 ticks per second at 144 and 30 FPS", () => {
    expect(sum(run(1 / 144, 144))).toBeGreaterThanOrEqual(59);
    expect(sum(run(1 / 144, 144))).toBeLessThanOrEqual(60);
    expect(run(1 / 30, 30).every((t) => t === 2)).toBe(true);
  });

  it("does not try to catch up after a long freeze", () => {
    const s = advanceClock(0, 2, TICK);
    expect(s.ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(s.acc).toBe(0);
  });

  it("ignores negative frame times", () => {
    expect(advanceClock(0.005, -1, TICK)).toEqual({ ticks: 0, acc: 0.005, alpha: 0.005 / TICK });
  });

  it("treats a NaN frame time as an empty frame instead of poisoning the accumulator", () => {
    expect(advanceClock(0.005, Number.NaN, TICK)).toEqual({ ticks: 0, acc: 0.005, alpha: 0.005 / TICK });
  });
});
