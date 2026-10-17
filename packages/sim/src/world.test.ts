import { describe, expect, it } from "vitest";
import { aabb, containsBox, intersect, overlaps } from "./aabb";
import { add, length, lerpVec, normalize, vec3 } from "./vec";
import type { Collider } from "./types";
import { blocks, createWorld, isFree, overlapping, volumeAt } from "./world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<Collider> = {}): Collider => ({
  box: aabb(x0, y0, z0, x1, y1, z1),
  ...extra,
});

describe("vec", () => {
  it("adds, normalizes and interpolates", () => {
    expect(add(vec3(1, 2, 3), vec3(1, 1, 1))).toEqual({ x: 2, y: 3, z: 4 });
    expect(length(normalize(vec3(3, 0, 4)))).toBeCloseTo(1, 12);
    expect(normalize(vec3())).toEqual({ x: 0, y: 0, z: 0 });
    expect(lerpVec(vec3(0, 0, 0), vec3(10, 20, 30), 0.5)).toEqual({ x: 5, y: 10, z: 15 });
  });
});

describe("aabb", () => {
  it("orders corners", () => {
    expect(aabb(2, 2, 2, 0, 0, 0)).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } });
  });

  it("treats touching faces as not overlapping", () => {
    expect(overlaps(aabb(0, 0, 0, 1, 1, 1), aabb(1, 0, 0, 2, 1, 1))).toBe(false);
    expect(overlaps(aabb(0, 0, 0, 1, 1, 1), aabb(0.9, 0, 0, 2, 1, 1))).toBe(true);
  });

  it("intersects and checks containment", () => {
    expect(intersect(aabb(0, 0, 0, 2, 2, 2), aabb(1, 1, 1, 3, 3, 3))).toEqual(aabb(1, 1, 1, 2, 2, 2));
    expect(intersect(aabb(0, 0, 0, 1, 1, 1), aabb(1, 0, 0, 2, 1, 1))).toBeNull();
    expect(containsBox(aabb(0, 0, 0, 10, 10, 10), aabb(1, 1, 1, 2, 2, 2))).toBe(true);
    expect(containsBox(aabb(0, 0, 0, 10, 10, 10), aabb(9, 9, 9, 11, 10, 10))).toBe(false);
  });
});

describe("createWorld", () => {
  it("covers all colliders with a grid of 4 m cells", () => {
    const w = createWorld([col(-10, 0, -6, -9, 1, -5), col(9, 0, 5, 10, 1, 6)]);
    expect(w.x0).toBe(-10);
    expect(w.z0).toBe(-6);
    expect(w.cols).toBe(5);
    expect(w.rows).toBe(3);
    expect(w.cells).toHaveLength(15);
  });

  it("puts a large box into every cell it spans", () => {
    const w = createWorld([col(0, 0, 0, 12, 1, 1)]);
    expect(w.cells.filter((c) => c.includes(0))).toHaveLength(3);
  });
});

describe("overlapping", () => {
  const w = createWorld([
    col(0, 0, 0, 2, 2, 2),
    col(5, 0, 0, 6, 2, 2),
    col(0, 0, 3, 2, 2, 4, { noSight: true }),
    col(0, 0, -3, 2, 2, -2, { noShoot: true }),
  ]);

  it("finds boxes that really overlap and ignores touching ones", () => {
    expect(overlapping(w, aabb(1, 1, 1, 3, 3, 3))).toEqual([0]);
    expect(overlapping(w, aabb(2, 0, 0, 5, 2, 2))).toEqual([]);
  });

  it("returns each collider once even if it spans several cells", () => {
    const big = createWorld([col(0, 0, 0, 20, 1, 20)]);
    expect(overlapping(big, aabb(1, 0, 1, 19, 1, 19))).toEqual([0]);
  });

  it("lets movement pass through sight-only boxes but not through railings", () => {
    expect(isFree(w, aabb(0.5, 0.5, 3.2, 1.5, 1.5, 3.8))).toBe(true);
    expect(isFree(w, aabb(0.5, 0.5, -2.8, 1.5, 1.5, -2.2))).toBe(false);
  });
});

describe("blocks", () => {
  it("matches the flag table", () => {
    expect([blocks({}, "move"), blocks({}, "shot"), blocks({}, "sight")]).toEqual([true, true, true]);
    expect([blocks({ noShoot: true }, "move"), blocks({ noShoot: true }, "shot"), blocks({ noShoot: true }, "sight")]).toEqual([
      true,
      false,
      false,
    ]);
    expect([blocks({ noSight: true }, "move"), blocks({ noSight: true }, "shot"), blocks({ noSight: true }, "sight")]).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe("volumeAt", () => {
  it("finds a volume of the asked kind", () => {
    const w = createWorld([], [
      { kind: "grass", box: aabb(0, 0, 0, 4, 1, 4) },
      { kind: "kill", box: aabb(0, -10, 0, 4, -2, 4) },
    ]);
    expect(volumeAt(w, aabb(1, -5, 1, 2, -3, 2), "kill")?.kind).toBe("kill");
    expect(volumeAt(w, aabb(1, -5, 1, 2, -3, 2), "grass")).toBeNull();
  });
});
