import { describe, expect, it } from "vitest";
import { nextRandom, seedRandom } from "./rng";

const seq = (state: number, n: number): number[] => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const r = nextRandom(state);
    out.push(r.value);
    state = r.state;
  }
  return out;
};

describe("bot PRNG", () => {
  it("the same state gives the same sequence; the argument is a plain number", () => {
    expect(seq(12345, 50)).toEqual(seq(12345, 50));
    expect(seq(12345, 50)).not.toEqual(seq(12346, 50));
    const r = nextRandom(7);
    expect(Number.isInteger(r.state)).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("values lie in [0, 1); 10 000 of them average 0.5 ± 0.02", () => {
    const v = seq(seedRandom(42), 10_000);
    for (const x of v) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
  });

  it("seedRandom mixes seed and salt: neighbouring seeds and ids start apart", () => {
    const starts = new Set<number>();
    for (let seed = 0; seed < 10; seed++) for (let id = 1; id <= 6; id++) starts.add(seedRandom(seed, id));
    expect(starts.size).toBe(60);
    expect(seedRandom(5, 2)).toBe(seedRandom(5, 2));
  });
});
