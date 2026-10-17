import { describe, expect, it } from "vitest";
import { BASE_SENSITIVITY, KEYS, MAX_MOUSE_STEP_PX, applyLook, buildInput, clampSensitivity, moveAxes } from "./controls";

describe("moveAxes", () => {
  it("maps WASD by physical key codes", () => {
    expect(moveAxes(new Set(["KeyW", "KeyD"]))).toEqual({ moveX: 1, moveZ: 1 });
    expect(moveAxes(new Set(["KeyS", "KeyA"]))).toEqual({ moveX: -1, moveZ: -1 });
    expect(moveAxes(new Set(["KeyW", "KeyS"]))).toEqual({ moveX: 0, moveZ: 0 });
  });

  it("ignores Ctrl and layout-dependent keys", () => {
    expect(moveAxes(new Set(["ControlLeft", "ц"]))).toEqual({ moveX: 0, moveZ: 0 });
    expect(Object.values(KEYS).some((k) => k.startsWith("Control"))).toBe(false);
  });
});

describe("applyLook", () => {
  it("turns right on positive dx and looks up on negative dy", () => {
    const l = applyLook({ yaw: 0, pitch: 0 }, 100, -50, 1);
    expect(l.yaw).toBeCloseTo(-100 * BASE_SENSITIVITY, 9);
    expect(l.pitch).toBeCloseTo(50 * BASE_SENSITIVITY, 9);
  });

  it("clamps pitch and wraps yaw", () => {
    expect(applyLook({ yaw: 0, pitch: 0 }, 0, -290, 3).pitch).toBeLessThan(Math.PI / 2);
    expect(applyLook({ yaw: 0, pitch: 1.5 }, 0, -290, 3).pitch).toBeCloseTo(Math.PI / 2 - 0.01, 9);
    expect(applyLook({ yaw: 3.1, pitch: 0 }, -200, 0, 1).yaw).toBeLessThan(-2.7);
  });

  it("drops pointer-lock spikes", () => {
    const l = { yaw: 0.3, pitch: 0.1 };
    expect(applyLook(l, MAX_MOUSE_STEP_PX + 1, 0, 1)).toBe(l);
  });
});

describe("buildInput", () => {
  it("is plain data with the jump key and the look", () => {
    expect(buildInput(new Set(["Space", "KeyW"]), { yaw: 1, pitch: -0.2 })).toEqual({ moveX: 0, moveZ: 1, jump: true, yaw: 1, pitch: -0.2 });
  });
});

describe("clampSensitivity", () => {
  it("keeps the multiplier in range", () => {
    expect(clampSensitivity(10)).toBe(3);
    expect(clampSensitivity(0)).toBe(0.2);
    expect(clampSensitivity(Number.NaN)).toBe(1);
  });
});
