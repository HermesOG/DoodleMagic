import { describe, expect, it } from "vitest";
import { createHandRig, updateHandRig, type HandMotionInput, type HandPose } from "./motion";

const still: HandMotionInput = { dt: 1 / 60, speed: 0, onGround: true, landVel: 0, lookDx: 0, lookDy: 0 };

function play(frames: number, m: (k: number) => HandMotionInput): HandPose[] {
  let rig = createHandRig();
  const poses: HandPose[] = [];
  for (let k = 0; k < frames; k++) {
    const r = updateHandRig(rig, m(k), 6.5);
    rig = r.rig;
    poses.push(r.pose);
  }
  return poses;
}

const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

describe("updateHandRig", () => {
  it("only breathes a few millimetres when standing", () => {
    const ys = play(600, () => still).map((p) => p.y);
    expect(range(ys)).toBeGreaterThan(0.004);
    expect(range(ys)).toBeLessThan(0.014);
  });

  it("bobs while running and calms down after stopping", () => {
    const run = play(300, () => ({ ...still, speed: 6.5 }));
    expect(range(run.slice(120).map((p) => p.y))).toBeGreaterThan(0.015);
    expect(Math.max(...run.map((p) => Math.abs(p.swing)))).toBeGreaterThan(0.5);
    const stop = play(600, (k) => ({ ...still, speed: k < 300 ? 6.5 : 0 }));
    expect(range(stop.slice(500).map((p) => p.y))).toBeLessThan(0.014);
  });

  it("does not bob in the air", () => {
    const air = play(300, () => ({ ...still, speed: 6.5, onGround: false }));
    expect(range(air.slice(120).map((p) => p.y))).toBeLessThan(0.014);
  });

  it("dips on landing and lags behind a mouse turn", () => {
    const land = play(30, (k) => ({ ...still, landVel: k === 1 ? -9 : 0 }));
    expect(Math.min(...land.map((p) => p.y))).toBeLessThan(-0.02);
    const turn = play(30, () => ({ ...still, lookDx: 40 }));
    expect(turn.at(-1)!.x).toBeLessThan(-0.005);
    expect(turn.at(-1)!.roll).toBeLessThan(0);
  });

  // сим сообщает приземление и на первом тике после createPlayer (≈ −0,17 м/с): руки при появлении не приседают
  it("ignores the tiny landing the sim reports on the first tick after a spawn", () => {
    const spawn = play(60, (k) => ({ ...still, landVel: k === 0 ? -0.17 : 0 }));
    expect(spawn).toEqual(play(60, () => still));
  });

  it("dips on a small hop and caps the dip of a very long fall", () => {
    const hop = play(30, (k) => ({ ...still, landVel: k === 1 ? -3 : 0 }));
    expect(Math.min(...hop.map((p) => p.y))).toBeLessThan(-0.005);
    const fall = play(60, (k) => ({ ...still, landVel: k === 1 ? -40 : 0 }));
    const capped = play(60, (k) => ({ ...still, landVel: k === 1 ? -12 : 0 }));
    expect(Math.min(...fall.map((p) => p.y))).toBeCloseTo(Math.min(...capped.map((p) => p.y)), 9);
    expect(Math.min(...fall.map((p) => p.y))).toBeGreaterThan(-0.05);
  });

  it("stays finite when the frame time is negative, NaN or very long", () => {
    for (const dt of [-1, Number.NaN, 60]) {
      const poses = play(30, () => ({ ...still, dt, speed: 6.5, lookDx: 40, landVel: -9 }));
      for (const p of poses) {
        for (const v of [p.x, p.y, p.roll, p.swing]) expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(p.y)).toBeLessThan(0.1);
        expect(Math.abs(p.x)).toBeLessThan(0.1);
      }
    }
  });
});
