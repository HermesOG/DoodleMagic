import { describe, expect, it } from "vitest";
import { createFpsMeter } from "./fpsMeter";

describe("createFpsMeter", () => {
  it("reports 0 until the first window is full, then the average", () => {
    const m = createFpsMeter(500);
    for (let k = 0; k < 10; k++) m.push(16);
    expect(m.fps).toBe(0);
    for (let k = 0; k < 30; k++) m.push(16);
    expect(m.fps).toBeCloseTo(62.5, 6);
    expect(m.frameMs).toBeCloseTo(16, 6);
  });

  it("averages each tumbling window on its own, even with uneven frames", () => {
    const m = createFpsMeter(500);
    // окно 1: 100 + 100 + 100 + 250 = 550 мс за 4 кадра; лишние 50 мс в следующее окно не переходят
    for (const dt of [100, 100, 100]) m.push(dt);
    expect(m.fps).toBe(0);
    m.push(250);
    expect(m.fps).toBeCloseTo(4000 / 550, 6);
    expect(m.frameMs).toBeCloseTo(137.5, 6);
    // окно 2: 10 мс и 40 мс вперемешку, 20 кадров = 500 мс — прошлое окно на него не влияет
    for (let k = 0; k < 19; k++) {
      m.push(k % 2 ? 40 : 10);
      expect(m.fps).toBeCloseTo(4000 / 550, 6);
    }
    m.push(40);
    expect(m.fps).toBeCloseTo(40, 6);
    expect(m.frameMs).toBeCloseTo(25, 6);
  });
});
