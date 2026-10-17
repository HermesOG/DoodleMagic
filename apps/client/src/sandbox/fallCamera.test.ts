import { describe, expect, it } from "vitest";
import { createFallCamera, stepFallCamera, type FallCamera, type FallCameraFrame } from "./fallCamera";

const v = (x: number, y: number, z: number) => ({ x, y, z });
const look = { yaw: 0, pitch: 0 };
const walk = (s: FallCamera, eye: { x: number; y: number; z: number }): FallCamera =>
  stepFallCamera(s, { eye, target: eye, falling: false, look, dt: 1 / 60 });

describe("fall camera", () => {
  it("holds at the last eye above the floor while the mage falls, and lets go at once on respawn", () => {
    let s = walk(createFallCamera(), v(0, 1.6, -4));
    s = walk(s, v(0, 1.4, -5.2));
    const frame: FallCameraFrame = { eye: v(0, -1, -6), target: v(0, -2.6, -6), falling: true, look, dt: 1 / 60 };
    s = stepFallCamera(s, frame);
    expect(s.hold?.pos).toEqual(v(0, 1.4, -5.2));
    s = stepFallCamera(s, { ...frame, eye: v(0, -3, -8), target: v(0, -4.6, -8) });
    expect(s.hold?.pos).toEqual(v(0, 1.4, -5.2));
    // возрождение: маг на точке, камера сразу в глазах
    s = walk(s, v(3, 1.6, -16));
    expect(s.hold).toBeNull();
    expect(s.safe).toEqual(v(3, 1.6, -16));
  });

  it("turns toward the mage below, the same way at 30 and at 144 FPS", () => {
    const start = walk(createFallCamera(), v(0, 1.6, 0));
    const turn = (fps: number, seconds: number) => {
      let s = start;
      for (let i = 0; i < Math.round(fps * seconds); i++) s = stepFallCamera(s, { eye: v(0, -2, -4), target: v(0, -2.4, -4), falling: true, look, dt: 1 / fps });
      return s.hold!;
    };
    // 1/3 с — ровно 10 и 48 кадров
    const slow = turn(30, 1 / 3);
    const fast = turn(144, 1 / 3);
    expect(fast.pitch).toBeCloseTo(slow.pitch, 9);
    expect(fast.pitch).toBeLessThan(-0.3);
    // через секунду смотрит точно на мага: вниз на 4 м при 4 м вперёд
    expect(turn(60, 1).pitch).toBeCloseTo(Math.atan2(-4, 4), 3);
    expect(turn(60, 1).yaw).toBeCloseTo(0, 6);
  });

  it("keeps the heading while the mage is right under the camera", () => {
    const start = walk(createFallCamera(), v(0, 1.6, 0));
    const s = stepFallCamera(start, { eye: v(0.1, -1, 0), target: v(0.1, -2.6, 0), falling: true, look: { yaw: 1, pitch: 0 }, dt: 0.5 });
    expect(s.hold!.yaw).toBe(1);
    expect(s.hold!.pitch).toBeLessThan(-1);
  });
});
