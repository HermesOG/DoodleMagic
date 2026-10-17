import { describe, expect, it } from "vitest";
import { aabb } from "./aabb";
import { groundBelow, lineOfSight, raycast, type RayStats } from "./raycast";
import { AXES, normalize, vec3 } from "./vec";
import type { Axis, Collider, Vec3 } from "./types";
import { createWorld, type World } from "./world";

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

interface Expected {
  dist: number;
  collider: number;
  normal: Vec3;
}

/**
 * Эталон: перебор всех боксов. Соглашения те же, что у raycast: касание грани — попадание; нормаль — грань входа,
 * против направления луча; (0, 0, 0) — луч начался внутри; при равном расстоянии побеждает меньший номер.
 */
function bruteForce(colliders: readonly Collider[], o: Vec3, d: Vec3, maxDist: number): Expected | null {
  let best: Expected | null = null;
  colliders.forEach((c, idx) => {
    let tNear = 0;
    let tFar = maxDist;
    let entry: Axis | null = null;
    let hit = true;
    for (const a of AXES) {
      if (d[a] === 0) {
        if (o[a] < c.box.min[a] || o[a] > c.box.max[a]) hit = false;
        continue;
      }
      const t0 = (c.box.min[a] - o[a]) / d[a];
      const t1 = (c.box.max[a] - o[a]) / d[a];
      const near = Math.min(t0, t1);
      if (near > tNear) {
        tNear = near;
        entry = a;
      }
      tFar = Math.min(tFar, Math.max(t0, t1));
    }
    if (!hit || tNear > tFar || (best !== null && tNear >= best.dist)) return;
    const normal = vec3();
    if (entry) normal[entry] = d[entry] > 0 ? -1 : 1;
    best = { dist: tNear, collider: idx, normal };
  });
  return best;
}

/** Мир, который бросает исключение после limit обращений к клеткам: зависший луч роняет тест, а не весь прогон. */
function guarded(w: World, limit = 100_000): World {
  let visits = 0;
  const cells = new Proxy(w.cells, {
    get(target, key, receiver) {
      if (++visits > limit) throw new Error(`raycast visited more than ${limit} cells`);
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { ...w, cells };
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

  it("agrees with brute force on random scenes: distance, collider and normal", () => {
    const rand = rng(7);
    const colliders: Collider[] = [];
    for (let k = 0; k < 150; k++) {
      const x = rand() * 60 - 30;
      const z = rand() * 60 - 30;
      const y = rand() * 4;
      colliders.push(col(x, y, z, x + 0.2 + rand() * 6, y + 0.2 + rand() * 3, z + 0.2 + rand() * 6));
    }
    const rw = guarded(createWorld(colliders), 1_000_000);
    // Лучи вдоль осей (в том числе отрицательных и вертикальные, одна запись с −0) и в плоскостях осей.
    const axisDirs: Vec3[] = [
      vec3(1, 0, 0),
      vec3(-1, 0, 0),
      vec3(0, 1, 0),
      vec3(0, -1, 0),
      vec3(0, 0, 1),
      vec3(0, 0, -1),
      vec3(-0, -1, -0),
    ];
    const dirOf = (r: number): Vec3 => {
      if (r % 4 === 0) return axisDirs[Math.floor(rand() * axisDirs.length)]!;
      if (r % 4 === 1) return normalize(vec3(rand() * 2 - 1, 0, rand() * 2 - 1));
      if (r % 4 === 2) {
        return normalize(rand() < 0.5 ? vec3(rand() * 2 - 1, rand() * 2 - 1, 0) : vec3(0, rand() * 2 - 1, rand() * 2 - 1));
      }
      return normalize(vec3(rand() * 2 - 1, (rand() * 2 - 1) * 0.3, rand() * 2 - 1));
    };
    // Начала лучей: случайные и ровно на границах клеток, в том числе на краях сетки и за ними.
    const onBoundary = (v0: number, count: number): number => v0 + (Math.floor(rand() * (count + 3)) - 1) * rw.cell;
    const originOf = (r: number): Vec3 => {
      const y = rand() * 6 - 1;
      if (r % 3 === 0) return vec3(onBoundary(rw.x0, rw.cols), y, onBoundary(rw.z0, rw.rows));
      if (r % 3 === 1) return vec3(onBoundary(rw.x0, rw.cols), y, rand() * 80 - 40);
      return vec3(rand() * 80 - 40, y, rand() * 80 - 40);
    };
    let hits = 0;
    for (let r = 0; r < 1500; r++) {
      const o = originOf(r);
      const d = dirOf(r);
      const maxDist = r % 5 === 0 ? Infinity : 120;
      const expected = bruteForce(colliders, o, d, maxDist);
      const got = raycast(rw, o, d, maxDist);
      if (expected === null) {
        expect(got, `ray ${r}`).toBeNull();
        continue;
      }
      hits++;
      expect(got, `ray ${r}`).not.toBeNull();
      expect({ dist: got!.dist, collider: got!.collider, normal: got!.normal }, `ray ${r}`).toEqual(expected);
    }
    expect(hits).toBeGreaterThan(300);
  });

  it("gives the normal of the entry face, against the ray, on every axis and for zero-thickness boxes", () => {
    const nw = createWorld([col(4, 0, -1, 5, 3, 1), col(-1, 2, -1, 1, 3, 1), col(8, 0, -1, 8, 3, 1), col(-1, 6, -1, 1, 6, 1)]);
    const cast = (o: Vec3, d: Vec3): Expected | null => {
      const h = raycast(nw, o, d, 100);
      return h && { dist: h.dist, collider: h.collider, normal: h.normal };
    };
    expect(cast(vec3(0, 1, 0), vec3(1, 0, 0))).toEqual({ dist: 4, collider: 0, normal: { x: -1, y: 0, z: 0 } });
    expect(cast(vec3(7, 1, 0), vec3(-1, 0, 0))).toEqual({ dist: 2, collider: 0, normal: { x: 1, y: 0, z: 0 } });
    expect(cast(vec3(0, 0.5, 0), vec3(0, 1, 0))).toEqual({ dist: 1.5, collider: 1, normal: { x: 0, y: -1, z: 0 } });
    expect(cast(vec3(0, 4, 0), vec3(0, -1, 0))).toEqual({ dist: 1, collider: 1, normal: { x: 0, y: 1, z: 0 } });
    // плоские боксы: стенка x = 8 и плита y = 6
    expect(cast(vec3(6, 1, 0), vec3(1, 0, 0))).toEqual({ dist: 2, collider: 2, normal: { x: -1, y: 0, z: 0 } });
    expect(cast(vec3(10, 1, 0), vec3(-1, 0, 0))).toEqual({ dist: 2, collider: 2, normal: { x: 1, y: 0, z: 0 } });
    expect(cast(vec3(0, 4, 0), vec3(0, 1, 0))).toEqual({ dist: 2, collider: 3, normal: { x: 0, y: -1, z: 0 } });
    expect(cast(vec3(0, 9, 0), vec3(0, -1, 0))).toEqual({ dist: 3, collider: 3, normal: { x: 0, y: 1, z: 0 } });
  });
});

describe("raycast with maxDist = Infinity", () => {
  // пол с дырой x ∈ [8, 12] и крыша над x, z ∈ [−2, 2]
  const w = createWorld([col(-20, -1, -20, 8, 0, 20), col(12, -1, -20, 20, 0, 20), col(-2, 4, -2, 2, 5, 2)]);

  it("terminates for a vertical ray that hits nothing, up and down", { timeout: 2000 }, () => {
    expect(raycast(guarded(w), vec3(10, 1, 0), vec3(0, -1, 0), Infinity)).toBeNull();
    expect(raycast(guarded(w), vec3(10, 1, 0), vec3(0, 1, 0), Infinity)).toBeNull();
    expect(raycast(guarded(w), vec3(5, 1, 0), vec3(0, 1, 0), Infinity)).toBeNull();
    expect(raycast(guarded(w), vec3(5, -3, 0), vec3(0, -1, 0), Infinity)).toBeNull();
  });

  it("finds vertical hits, up and down", { timeout: 2000 }, () => {
    expect(raycast(guarded(w), vec3(0, 1, 0), vec3(0, 1, 0), Infinity)).toEqual({
      dist: 3,
      point: { x: 0, y: 4, z: 0 },
      normal: { x: 0, y: -1, z: 0 },
      collider: 2,
    });
    expect(raycast(guarded(w), vec3(5, 3, 0), vec3(0, -1, 0), Infinity)).toEqual({
      dist: 3,
      point: { x: 5, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      collider: 0,
    });
  });

  it("terminates for slanted rays", { timeout: 2000 }, () => {
    expect(raycast(guarded(w), vec3(0, 1, 0), normalize(vec3(1, 1, 1)), Infinity)).toBeNull();
    expect(raycast(guarded(w), vec3(0, 1, 0), normalize(vec3(1, -1, 0)), Infinity)?.collider).toBe(0);
  });

  it("works in groundBelow", { timeout: 2000 }, () => {
    expect(groundBelow(guarded(w), vec3(5, 30, 0), Infinity)).toBe(0);
    expect(groundBelow(guarded(w), vec3(10, 30, 0), Infinity)).toBeNull();
  });

  it("returns null when the entry into the grid overflows to Infinity", { timeout: 2000 }, () => {
    // вход в сетку по x: (−20 − (−21,65)) / 5e-324 = Infinity
    expect(raycast(guarded(w), vec3(-21.65, 1.8, 7), vec3(5e-324, -0.5, 0), Infinity)).toBeNull();
    // вход в сетку по z: (20 − 1e300) / −1e-10 = Infinity
    expect(raycast(guarded(w), vec3(0, 1, 1e300), vec3(0, -1, -1e-10), Infinity)).toBeNull();
  });
});

describe("raycast early exit", () => {
  it("keeps walking on a tie at the cell exit, so the lower index still wins", () => {
    // Бокс 1 стоит в клетке (0, 1), бокс 0 — только в (1, 1); луч входит в оба при t = 4, ровно на выходе из (0, 1).
    const w = createWorld([col(4, 0, 4, 6, 1, 6), col(3, 0, 4.5, 5, 1, 6), col(0, 0, 0, 0.1, 1, 0.1)]);
    const h = raycast(w, vec3(0, 0.5, 0.5), vec3(1, 0, 1), 100);
    expect(h && { dist: h.dist, collider: h.collider, normal: h.normal }).toEqual({
      dist: 4,
      collider: 0,
      normal: { x: -1, y: 0, z: 0 },
    });
  });
});

describe("raycast input checks", () => {
  const w = guarded(createWorld([col(-5, -1, -5, 5, 0, 5)]));

  it("returns null for a NaN or negative maxDist and for a non-finite origin or direction", { timeout: 2000 }, () => {
    expect(raycast(w, vec3(0, 1, 0), vec3(0, -1, 0), NaN)).toBeNull();
    expect(raycast(w, vec3(0, 1, 0), vec3(0, -1, 0), -1)).toBeNull();
    expect(raycast(w, vec3(0, NaN, 0), vec3(0, -1, 0), 10)).toBeNull();
    expect(raycast(w, vec3(0, 1, 0), vec3(NaN, -1, 0), 10)).toBeNull();
    expect(raycast(w, vec3(Infinity, 1, 0), vec3(0, -1, 0), 10)).toBeNull();
  });
});

describe("groundBelow", () => {
  const w = createWorld([col(-5, -1, -5, 5, 0.3, 5), col(6, 0, -1, 7, 1, 1)]);

  it("returns the exact top of the support", () => {
    expect(groundBelow(w, vec3(0, 5.1, 0))).toBe(0.3);
    expect(groundBelow(w, vec3(1.7, 123.456, -2.9), Infinity)).toBe(0.3);
    expect(groundBelow(w, vec3(-4.9, 0.30000000000000004, 4.9))).toBe(0.3);
    expect(groundBelow(w, vec3(6.5, 3.3, 0))).toBe(1);
  });

  it("returns the point's own height when the point is inside a box", () => {
    expect(groundBelow(w, vec3(6.5, 0.5, 0))).toBe(0.5);
  });

  it("respects maxDrop", () => {
    expect(groundBelow(w, vec3(0, 5.1, 0), 4.7)).toBeNull();
  });
});

describe("lineOfSight", () => {
  it("is blocked by a wall and free around it", () => {
    const w = createWorld([col(-1, 0, -1, 1, 3, 1)]);
    expect(lineOfSight(w, vec3(-5, 1.6, 0), vec3(5, 1.6, 0))).toBe(false);
    expect(lineOfSight(w, vec3(-5, 1.6, 3), vec3(5, 1.6, 3))).toBe(true);
    expect(lineOfSight(w, vec3(-5, 4, 0), vec3(5, 4, 0))).toBe(true);
  });

  it("is closed, not open, for non-finite endpoints or a distance that overflows", () => {
    const w = createWorld([col(-1, 0, -1, 1, 3, 1)]);
    expect(lineOfSight(w, vec3(NaN, 1.6, 3), vec3(5, 1.6, 3))).toBe(false);
    expect(lineOfSight(w, vec3(-5, 1.6, 3), vec3(Infinity, 1.6, 3))).toBe(false);
    expect(lineOfSight(w, vec3(-5, -Infinity, 3), vec3(5, 1.6, 3))).toBe(false);
    expect(lineOfSight(w, vec3(-1e308, 4, 3), vec3(1e308, 4, 3))).toBe(false);
    expect(lineOfSight(w, vec3(-5, 1.6, 3), vec3(5, 1.6, 3))).toBe(true);
  });
});
