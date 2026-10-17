import { describe, expect, it } from "vitest";
import type { Collider } from "@doodlemagic/sim";
import { box, boxInBox, boxesOverlap, canSee, clipBox, copyBox, floorBelow, pointInBox, rayBox, sightDistance } from "./geom";

const X = { x: 1, y: 0, z: 0 };
const NEG_X = { x: -1, y: 0, z: 0 };
const DOWN = { x: 0, y: -1, z: 0 };

describe("rayBox", () => {
  const b = box(4, 0, -1, 6, 2, 1);

  it("returns the entry distance of a hit", () => {
    expect(rayBox({ x: 0, y: 1, z: 0 }, X, b, 100)).toBe(4);
    const d = { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 };
    expect(rayBox({ x: 0, y: 1, z: -4.5 }, d, b, 100)).toBeCloseTo(4 * Math.SQRT2, 12);
  });

  it("misses a box beside the ray or out of reach", () => {
    expect(rayBox({ x: 0, y: 1, z: 3 }, X, b, 100)).toBeNull();
    expect(rayBox({ x: 0, y: 3, z: 0 }, X, b, 100)).toBeNull();
    expect(rayBox({ x: 0, y: 1, z: 0 }, X, b, 3.9)).toBeNull();
    expect(rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, b, 100)).toBeNull();
  });

  it("returns 0 when the origin is inside the box", () => {
    expect(rayBox({ x: 5, y: 1, z: 0 }, X, b, 100)).toBe(0);
    expect(rayBox({ x: 5, y: 1, z: 0 }, NEG_X, b, 100)).toBe(0);
  });

  it("ignores a box behind the origin", () => {
    expect(rayBox({ x: 10, y: 1, z: 0 }, X, b, 100)).toBeNull();
    expect(rayBox({ x: 0, y: 1, z: 0 }, NEG_X, b, 100)).toBeNull();
  });

  it("counts a ray grazing a face or an edge as a hit", () => {
    expect(rayBox({ x: 0, y: 2, z: 0 }, X, b, 100)).toBe(4);
    expect(rayBox({ x: 0, y: 2, z: 1 }, X, b, 100)).toBe(4);
    expect(rayBox({ x: 0, y: 2.0001, z: 0 }, X, b, 100)).toBeNull();
  });
});

describe("canSee and sightDistance", () => {
  const wall: Collider = { box: box(4, 0, -5, 5, 3, 5) };
  const eyeA = { x: 0, y: 1.6, z: 0 };
  const eyeB = { x: 10, y: 1.6, z: 0 };

  it("sees across open space", () => {
    expect(canSee([], eyeA, eyeB)).toBe(true);
    expect(canSee([wall], eyeA, { x: 3, y: 1.6, z: 0 })).toBe(true);
    // над стеной: на x = 4 луч уже на высоте 4,16 м
    expect(canSee([wall], eyeA, { x: 10, y: 8, z: 0 })).toBe(true);
    expect(sightDistance([wall], eyeA, { x: 0, y: 0, z: 1 }, 50)).toBeNull();
  });

  it("does not see through a wall", () => {
    expect(canSee([wall], eyeA, eyeB)).toBe(false);
    expect(canSee([wall], eyeB, eyeA)).toBe(false);
    expect(sightDistance([wall], eyeA, X, 50)).toBe(4);
  });

  it("looks through noShoot rails and grates", () => {
    const rail: Collider = { box: wall.box, noShoot: true };
    expect(canSee([rail], eyeA, eyeB)).toBe(true);
    expect(sightDistance([rail], eyeA, X, 50)).toBeNull();
  });

  it("is blocked by noSight grass and smoke", () => {
    const grass: Collider = { box: wall.box, noSight: true };
    expect(canSee([grass], eyeA, eyeB)).toBe(false);
    expect(sightDistance([grass], eyeA, X, 50)).toBe(4);
  });

  it("takes the nearest of several blockers", () => {
    const near: Collider = { box: box(2, 0, -1, 3, 3, 1) };
    expect(sightDistance([wall, near], eyeA, X, 50)).toBe(2);
    expect(sightDistance([near, wall], eyeA, X, 50)).toBe(2);
  });
});

describe("floorBelow", () => {
  const floor: Collider = { box: box(-5, -1, -5, 5, 0, 5) };
  const ledge: Collider = { box: box(-1, 0, -1, 1, 1, 1) };

  it("finds the top of the first support under the point", () => {
    expect(floorBelow([floor], { x: 3, y: 2, z: 0 })).toBe(0);
    expect(floorBelow([floor, ledge], { x: 0, y: 2, z: 0 })).toBe(1);
    expect(floorBelow([floor], { x: 8, y: 2, z: 0 })).toBeNull();
    expect(floorBelow([floor], { x: 3, y: 2, z: 0 }, 1.5)).toBeNull();
  });

  it("ignores noSight colliders, which do not hold movement", () => {
    const grass: Collider = { box: box(-1, 0, -1, 1, 1, 1), noSight: true };
    expect(floorBelow([floor, grass], { x: 0, y: 2, z: 0 })).toBe(0);
  });

  it("stands on noShoot rails, which do hold movement", () => {
    const rail: Collider = { box: box(-1, 0, -1, 1, 1, 1), noShoot: true };
    expect(floorBelow([floor, rail], { x: 0, y: 2, z: 0 })).toBe(1);
  });

  it("returns p.y when the point is inside a box", () => {
    expect(floorBelow([floor, ledge], { x: 0, y: 0.5, z: 0 })).toBe(0.5);
  });
});

describe("box helpers", () => {
  it("does not count touching faces as overlap", () => {
    const a = box(0, 0, 0, 1, 1, 1);
    expect(boxesOverlap(a, box(1, 0, 0, 2, 1, 1))).toBe(false);
    expect(boxesOverlap(a, box(0, 1, 0, 1, 2, 1))).toBe(false);
    expect(boxesOverlap(a, box(1, 1, 1, 2, 2, 2))).toBe(false);
    expect(boxesOverlap(a, box(0.99, 0, 0, 2, 1, 1))).toBe(true);
    expect(boxesOverlap(a, box(0.2, 0.2, 0.2, 0.8, 0.8, 0.8))).toBe(true);
    expect(boxesOverlap(a, box(3, 0, 0, 4, 1, 1))).toBe(false);
  });

  it("tells whether one box lies inside another, faces included", () => {
    const outer = box(-2, -2, -2, 2, 2, 2);
    expect(boxInBox(outer, box(-1, -1, -1, 1, 1, 1))).toBe(true);
    expect(boxInBox(outer, outer)).toBe(true);
    expect(boxInBox(outer, box(-1, -1, -1, 2.1, 1, 1))).toBe(false);
    expect(boxInBox(box(-1, -1, -1, 1, 1, 1), outer)).toBe(false);
    expect(pointInBox(outer, { x: 2, y: 0, z: 0 })).toBe(true);
    expect(pointInBox(outer, { x: 2.01, y: 0, z: 0 })).toBe(false);
  });

  it("normalises corners, clips to the common part and copies boxes", () => {
    expect(box(1, 2, 3, 0, 0, 0)).toStrictEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 2, z: 3 } });
    expect(clipBox(box(0, 0, 0, 2, 2, 2), box(1, 1, 1, 3, 3, 3))).toStrictEqual(box(1, 1, 1, 2, 2, 2));
    expect(clipBox(box(0, 0, 0, 1, 1, 1), box(1, 0, 0, 2, 1, 1))).toBeNull();
    const a = box(0, 0, 0, 1, 1, 1);
    const c = copyBox(a);
    expect(c).toStrictEqual(a);
    expect(c).not.toBe(a);
    expect(c.min).not.toBe(a.min);
    expect(c.max).not.toBe(a.max);
  });
});
