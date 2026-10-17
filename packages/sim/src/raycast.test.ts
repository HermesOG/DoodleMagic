import { describe, expect, it } from "vitest";
import { aabb } from "./aabb";
import { groundBelow, lineOfSight, raycast, type RayStats } from "./raycast";
import { normalize, vec3 } from "./vec";
import type { Collider } from "./types";
import { createWorld } from "./world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<Collider> = {}): Collider => ({
  box: aabb(x0, y0, z0, x1, y1, z1),
  ...extra,
});

/** Детерминированный ГПСЧ для тестов (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Эталон: перебор всех боксов. */
function bruteForce(colliders: readonly Collider[], o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, maxDist: number): number | null {
  let best: number | null = null;
  for (const c of colliders) {
    let tNear = 0;
    let tFar = maxDist;
    let hit = true;
    for (const a of ["x", "y", "z"] as const) {
      if (d[a] === 0) {
        if (o[a] < c.box.min[a] || o[a] > c.box.max[a]) hit = false;
        continue;
      }
      const t0 = (c.box.min[a] - o[a]) / d[a];
      const t1 = (c.box.max[a] - o[a]) / d[a];
      tNear = Math.max(tNear, Math.min(t0, t1));
      tFar = Math.min(tFar, Math.max(t0, t1));
    }
    if (hit && tNear <= tFar && (best === null || tNear < best)) best = tNear;
  }
  return best;
}

describe("raycast", () => {
  const w = createWorld([col(4, 0, -1, 5, 3, 1), col(10, 0, -1, 11, 3, 1), col(-20, -1, -20, 20, 0, 20)]);

  it("returns the nearest hit with distance, point and normal", () => {
    const hit = raycast(w, vec3(0, 1, 0), vec3(1, 0, 0), 100);
    expect(hit).not.toBeNull();
    expect(hit!.collider).toBe(0);
    expect(hit!.dist).toBeCloseTo(4, 9);
    expect(hit!.point).toEqual({ x: 4, y: 1, z: 0 });
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it("respects maxDist and ignores boxes behind the origin", () => {
    expect(raycast(w, vec3(0, 1, 0), vec3(1, 0, 0), 3.9)).toBeNull();
    expect(raycast(w, vec3(7, 1, 0), vec3(1, 0, 0), 100)!.collider).toBe(1);
  });

  it("enters the grid from outside", () => {
    const hit = raycast(w, vec3(-40, 1, 0), vec3(1, 0, 0), 100);
    expect(hit!.collider).toBe(0);
    expect(hit!.dist).toBeCloseTo(44, 9);
    expect(raycast(w, vec3(-40, 1, 30), vec3(1, 0, 0), 100)).toBeNull();
  });

  it("casts straight down onto the floor", () => {
    expect(groundBelow(w, vec3(2, 5, 2))).toBe(0);
    expect(groundBelow(w, vec3(4.5, 5, 0))).toBe(3);
    expect(groundBelow(w, vec3(50, 5, 50))).toBeNull();
  });

  it("filters by ray kind", () => {
    const fw = createWorld([col(2, 0, -1, 3, 3, 1, { noShoot: true }), col(6, 0, -1, 7, 3, 1, { noSight: true })]);
    expect(raycast(fw, vec3(0, 1, 0), vec3(1, 0, 0), 100, "shot")).toBeNull();
    expect(raycast(fw, vec3(0, 1, 0), vec3(1, 0, 0), 100, "sight")!.collider).toBe(1);
    expect(raycast(fw, vec3(0, 1, 0), vec3(1, 0, 0), 100, "move")!.collider).toBe(0);
  });

  it("walks the grid instead of testing every box", () => {
    const many: Collider[] = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) many.push(col(i * 5, 0, j * 5, i * 5 + 1, 1, j * 5 + 1));
    const big = createWorld(many);
    const stats: RayStats = { tested: 0 };
    const hit = raycast(big, vec3(2.5, 0.5, 0.5), vec3(1, 0, 0), 200, "shot", stats);
    expect(hit!.dist).toBeCloseTo(2.5, 9);
    expect(stats.tested).toBeLessThan(10);
    const miss: RayStats = { tested: 0 };
    expect(raycast(big, vec3(2.5, 0.5, 2.5), vec3(1, 0, 0), 200, "shot", miss)).toBeNull();
    expect(miss.tested).toBeLessThan(60);
  });

  it("agrees with brute force on random scenes", () => {
    const rand = rng(7);
    const colliders: Collider[] = [];
    for (let k = 0; k < 150; k++) {
      const x = rand() * 60 - 30;
      const z = rand() * 60 - 30;
      const y = rand() * 4;
      colliders.push(col(x, y, z, x + 0.2 + rand() * 6, y + 0.2 + rand() * 3, z + 0.2 + rand() * 6));
    }
    const rw = createWorld(colliders);
    for (let r = 0; r < 500; r++) {
      const o = vec3(rand() * 80 - 40, rand() * 6 - 1, rand() * 80 - 40);
      const d = normalize(vec3(rand() * 2 - 1, (rand() * 2 - 1) * 0.3, rand() * 2 - 1));
      const expected = bruteForce(colliders, o, d, 120);
      const got = raycast(rw, o, d, 120);
      if (expected === null) expect(got).toBeNull();
      else expect(got?.dist).toBeCloseTo(expected, 9);
    }
  });
});

describe("lineOfSight", () => {
  it("is blocked by a wall and free around it", () => {
    const w = createWorld([col(-1, 0, -1, 1, 3, 1)]);
    expect(lineOfSight(w, vec3(-5, 1.6, 0), vec3(5, 1.6, 0))).toBe(false);
    expect(lineOfSight(w, vec3(-5, 1.6, 3), vec3(5, 1.6, 3))).toBe(true);
    expect(lineOfSight(w, vec3(-5, 4, 0), vec3(5, 4, 0))).toBe(true);
  });
});
