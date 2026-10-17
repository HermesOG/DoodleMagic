import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { moveDirXZ, snappedWallBox } from "./kit";
import { NO_MATCH_INPUT } from "./state";

describe("kit helpers", () => {
  it("snaps a wall across the view to the nearest world axis", () => {
    const c = { x: 0, y: 0, z: -10 };
    expect(snappedWallBox(c, 0, 10, 0.5, 2.5)).toEqual(aabb(-5, 0, -10.25, 5, 2.5, -9.75));
    expect(snappedWallBox(c, Math.PI / 2, 10, 0.5, 2.5)).toEqual(aabb(-0.25, 0, -15, 0.25, 2.5, -5));
    expect(snappedWallBox(c, 0.7, 4, 0.5, 2.5)).toEqual(aabb(-2, 0, -10.25, 2, 2.5, -9.75));
  });

  it("moves along the input relative to the view, or forward without input", () => {
    expect([moveDirXZ({ ...NO_MATCH_INPUT, moveX: 1 }), moveDirXZ({ ...NO_MATCH_INPUT })]).toEqual([{ x: 1, z: 0 }, { x: 0, z: -1 }]);
    const d = moveDirXZ({ ...NO_MATCH_INPUT, moveX: 1, moveZ: 1 });
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 12);
  });
});
