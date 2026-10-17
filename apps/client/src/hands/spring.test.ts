import { describe, expect, it } from "vitest";
import { stepSpring, type Spring } from "./spring";

function settle(s: Spring, target: number, omega: number, dt: number, steps: number): Spring[] {
  const out: Spring[] = [];
  for (let k = 0; k < steps; k++) {
    s = stepSpring(s, target, omega, dt);
    out.push(s);
  }
  return out;
}

describe("stepSpring", () => {
  it("reaches the target without overshooting from rest", () => {
    const path = settle({ x: 0, v: 0 }, 1, 12, 1 / 60, 120);
    expect(path.at(-1)!.x).toBeCloseTo(1, 4);
    expect(Math.max(...path.map((s) => s.x))).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("gives the same result for one big step and many small ones", () => {
    const big = stepSpring({ x: 0, v: 2 }, 1, 8, 0.5);
    const small = settle({ x: 0, v: 2 }, 1, 8, 0.5 / 50, 50).at(-1)!;
    expect(big.x).toBeCloseTo(small.x, 9);
    expect(big.v).toBeCloseTo(small.v, 9);
  });

  it("stays stable with a huge time step", () => {
    const s = stepSpring({ x: 5, v: -100 }, 0, 20, 10);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
    expect(Number.isFinite(s.v)).toBe(true);
  });
});
