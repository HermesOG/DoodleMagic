import { describe, expect, it } from "vitest";
import { PLAYER_STEP, type AABB } from "@doodlemagic/sim";
import { clipArena, createArenaBuilder, wallPieces, wrapAngle, type Opening, type WallPiece } from "./dsl";
import { box } from "./geom";

const BOUNDS = box(-50, -20, -50, 50, 20, 50);

describe("box and slab", () => {
  it("adds a collider and a render box with material and flags", () => {
    const b = createArenaBuilder();
    b.box(0, 0, 0, 2, 1, 3, { material: "gold", tag: "rune", noShoot: true });
    b.slab(-5, -5, 5, 5, 0, { material: "floor", depth: 1 });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders).toStrictEqual([
      { box: box(0, 0, 0, 2, 1, 3), noShoot: true, tag: "rune" },
      { box: box(-5, -1, -5, 5, 0, 5) },
    ]);
    expect(a.render.map((r) => r.material)).toStrictEqual(["gold", "floor"]);
  });

  it("can make render-only and collision-only boxes", () => {
    const b = createArenaBuilder();
    b.box(0, 0, 0, 1, 1, 1, { collide: false });
    b.box(0, 0, 0, 1, 1, 1, { render: false });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders).toHaveLength(1);
    expect(a.render).toHaveLength(1);
  });
});

/**
 * Проверка разбиения стены: куски лежат в стене и не пересекаются, а куски вместе с проёмами
 * покрывают каждую клетку стены ровно один раз. Все рёбра в тестах кратны STEP, поэтому середины
 * клеток никогда не попадают на ребро, и проверка по клеткам точна.
 */
const STEP = 0.1;
function expectTiling(a: number, b: number, height: number, openings: readonly Opening[], pieces: readonly WallPiece[]): void {
  const inside = (p: WallPiece, u: number, v: number) => p.u0 < u && u < p.u1 && p.v0 < v && v < p.v1;
  const holes = openings.map((op) => ({
    u0: Math.min(op.from, op.to),
    u1: Math.max(op.from, op.to),
    v0: Math.min(Math.max(op.sill ?? 0, 0), height),
    v1: Math.min(Math.max(op.top ?? height, 0), height),
  }));
  for (const p of pieces) {
    expect(p.u0).toBeGreaterThanOrEqual(a);
    expect(p.u1).toBeLessThanOrEqual(b);
    expect(p.v0).toBeGreaterThanOrEqual(0);
    expect(p.v1).toBeLessThanOrEqual(height);
    expect(p.u1).toBeGreaterThan(p.u0);
    expect(p.v1).toBeGreaterThan(p.v0);
  }
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const p = pieces[i]!;
      const q = pieces[j]!;
      const du = Math.min(p.u1, q.u1) - Math.max(p.u0, q.u0);
      const dv = Math.min(p.v1, q.v1) - Math.max(p.v0, q.v0);
      expect(du > 1e-9 && dv > 1e-9, `pieces ${i} and ${j} overlap`).toBe(false);
    }
  }
  let pieceArea = 0;
  for (const p of pieces) pieceArea += (p.u1 - p.u0) * (p.v1 - p.v0);
  let holeCells = 0;
  const nu = Math.round((b - a) / STEP);
  const nv = Math.round(height / STEP);
  for (let i = 0; i < nu; i++) {
    for (let k = 0; k < nv; k++) {
      const u = a + (i + 0.5) * STEP;
      const v = (k + 0.5) * STEP;
      const solid = pieces.filter((p) => inside(p, u, v)).length;
      const open = holes.some((h) => inside(h, u, v)) ? 1 : 0;
      holeCells += open;
      expect(solid + open, `cell (${u.toFixed(2)}, ${v.toFixed(2)})`).toBe(1);
    }
  }
  expect(pieceArea + holeCells * STEP * STEP).toBeCloseTo((b - a) * height, 9);
}

/** После слияния не остаётся двух кусков, которые можно склеить в один прямоугольник. */
function expectNoRedundantSeams(pieces: readonly WallPiece[]): void {
  for (const p of pieces) {
    for (const q of pieces) {
      if (p === q) continue;
      const sameV = p.v0 === q.v0 && p.v1 === q.v1;
      const sameU = p.u0 === q.u0 && p.u1 === q.u1;
      expect(sameV && p.u1 === q.u0, "side-by-side pieces with equal heights").toBe(false);
      expect(sameU && p.v1 === q.v0, "stacked pieces with equal spans").toBe(false);
    }
  }
}

function piecesChecked(a: number, b: number, height: number, openings: readonly Opening[]): WallPiece[] {
  const pieces = wallPieces(a, b, height, openings);
  expectTiling(a, b, height, openings, pieces);
  expectNoRedundantSeams(pieces);
  // порядок: по u0, затем по v0
  const sorted = [...pieces].sort((p, q) => p.u0 - q.u0 || p.v0 - q.v0);
  expect(pieces).toStrictEqual(sorted);
  return pieces;
}

describe("wallPieces", () => {
  it("leaves a full wall without openings", () => {
    expect(piecesChecked(0, 10, 3, [])).toStrictEqual([{ u0: 0, u1: 10, v0: 0, v1: 3 }]);
  });

  it("cuts a door with a lintel and a window with a sill", () => {
    const pieces = piecesChecked(0, 10, 3, [
      { from: 2, to: 4, top: 2.2 },
      { from: 6, to: 8, sill: 1, top: 2 },
    ]);
    expect(pieces).toStrictEqual([
      { u0: 0, u1: 2, v0: 0, v1: 3 },
      { u0: 2, u1: 4, v0: 2.2, v1: 3 },
      { u0: 4, u1: 6, v0: 0, v1: 3 },
      { u0: 6, u1: 8, v0: 0, v1: 1 },
      { u0: 6, u1: 8, v0: 2, v1: 3 },
      { u0: 8, u1: 10, v0: 0, v1: 3 },
    ]);
  });

  it("drops a fully open span and clamps openings to the wall", () => {
    expect(piecesChecked(0, 4, 3, [{ from: -1, to: 2 }])).toStrictEqual([{ u0: 2, u1: 4, v0: 0, v1: 3 }]);
  });

  it("subtracts overlapping openings as their union", () => {
    const openings = [
      { from: 2, to: 5, top: 2 },
      { from: 4, to: 7, sill: 1 },
    ];
    expect(piecesChecked(0, 10, 3, openings)).toStrictEqual([
      { u0: 0, u1: 2, v0: 0, v1: 3 },
      { u0: 2, u1: 4, v0: 2, v1: 3 },
      { u0: 5, u1: 7, v0: 0, v1: 1 },
      { u0: 7, u1: 10, v0: 0, v1: 3 },
    ]);
  });

  it("merges touching windows into one opening without seams", () => {
    const twin = piecesChecked(0, 10, 3, [
      { from: 2, to: 4, sill: 1, top: 2 },
      { from: 4, to: 6, sill: 1, top: 2 },
    ]);
    expect(twin).toStrictEqual([
      { u0: 0, u1: 2, v0: 0, v1: 3 },
      { u0: 2, u1: 6, v0: 0, v1: 1 },
      { u0: 2, u1: 6, v0: 2, v1: 3 },
      { u0: 6, u1: 10, v0: 0, v1: 3 },
    ]);
    expect(twin).toStrictEqual(wallPieces(0, 10, 3, [{ from: 2, to: 6, sill: 1, top: 2 }]));
  });

  it("merges vertically touching openings on the same span", () => {
    expect(
      piecesChecked(0, 10, 3, [
        { from: 2, to: 4, top: 1 },
        { from: 2, to: 4, sill: 1, top: 2 },
      ]),
    ).toStrictEqual([
      { u0: 0, u1: 2, v0: 0, v1: 3 },
      { u0: 2, u1: 4, v0: 2, v1: 3 },
      { u0: 4, u1: 10, v0: 0, v1: 3 },
    ]);
  });

  it("keeps the band between a door and a window stacked on the same span", () => {
    expect(
      piecesChecked(0, 10, 3, [
        { from: 2, to: 4, top: 1 },
        { from: 2, to: 4, sill: 2, top: 2.5 },
      ]),
    ).toStrictEqual([
      { u0: 0, u1: 2, v0: 0, v1: 3 },
      { u0: 2, u1: 4, v0: 1, v1: 2 },
      { u0: 2, u1: 4, v0: 2.5, v1: 3 },
      { u0: 4, u1: 10, v0: 0, v1: 3 },
    ]);
  });

  it("clips an opening that sticks out past either end of the wall", () => {
    expect(piecesChecked(0, 10, 3, [{ from: 8, to: 12, sill: 1 }])).toStrictEqual([
      { u0: 0, u1: 8, v0: 0, v1: 3 },
      { u0: 8, u1: 10, v0: 0, v1: 1 },
    ]);
    expect(piecesChecked(0, 10, 3, [{ from: -3, to: 1, top: 2 }])).toStrictEqual([
      { u0: 0, u1: 1, v0: 2, v1: 3 },
      { u0: 1, u1: 10, v0: 0, v1: 3 },
    ]);
  });

  it("clamps sill and top into the wall height", () => {
    expect(piecesChecked(0, 10, 3, [{ from: 2, to: 4, sill: 1, top: 5 }])).toStrictEqual([
      { u0: 0, u1: 2, v0: 0, v1: 3 },
      { u0: 2, u1: 4, v0: 0, v1: 1 },
      { u0: 4, u1: 10, v0: 0, v1: 3 },
    ]);
    expect(piecesChecked(0, 10, 3, [{ from: 2, to: 4, sill: -1, top: 1 }])).toStrictEqual([
      { u0: 0, u1: 2, v0: 0, v1: 3 },
      { u0: 2, u1: 4, v0: 1, v1: 3 },
      { u0: 4, u1: 10, v0: 0, v1: 3 },
    ]);
  });

  it("skips empty openings: top ≤ sill, zero span, or entirely outside the wall", () => {
    const full = [{ u0: 0, u1: 10, v0: 0, v1: 3 }];
    expect(wallPieces(0, 10, 3, [{ from: 2, to: 4, sill: 2, top: 1 }])).toStrictEqual(full);
    expect(wallPieces(0, 10, 3, [{ from: 2, to: 4, top: 0 }])).toStrictEqual(full);
    expect(wallPieces(0, 10, 3, [{ from: 2, to: 4, sill: 3 }])).toStrictEqual(full);
    expect(wallPieces(0, 10, 3, [{ from: 5, to: 5 }])).toStrictEqual(full);
    expect(wallPieces(0, 10, 3, [{ from: 11, to: 12 }])).toStrictEqual(full);
  });

  it("tolerates reversed from and to", () => {
    expect(piecesChecked(0, 10, 3, [{ from: 4, to: 2, top: 2 }])).toStrictEqual(wallPieces(0, 10, 3, [{ from: 2, to: 4, top: 2 }]));
  });

  it("takes openings in absolute wall coordinates when the wall does not start at 0", () => {
    expect(piecesChecked(10, 20, 3, [{ from: 12, to: 14, top: 2 }])).toStrictEqual([
      { u0: 10, u1: 12, v0: 0, v1: 3 },
      { u0: 12, u1: 14, v0: 2, v1: 3 },
      { u0: 14, u1: 20, v0: 0, v1: 3 },
    ]);
    expect(piecesChecked(-8, -2, 2, [{ from: -6, to: -5, sill: 0.5, top: 1.5 }])).toHaveLength(4);
  });

  it("tiles the wall for a busy mix of openings", () => {
    piecesChecked(-3, 7, 4, [
      { from: -4, to: -2, top: 2 },
      { from: -1, to: 1, sill: 1, top: 3 },
      { from: 0.5, to: 2, sill: 0.5, top: 1.5 },
      { from: 2, to: 3.5, sill: 1, top: 3 },
      { from: 5, to: 4, sill: 3.5, top: 9 },
      { from: 6, to: 6.5, sill: 2.5, top: 2 },
    ]);
  });
});

describe("walls", () => {
  it("builds wallX around its z axis and wallZ around its x axis", () => {
    const b = createArenaBuilder();
    b.wallX(5, 0, 4, { height: 3, thick: 0.4, openings: [{ from: 1, to: 3, top: 2 }] });
    b.wallZ(-2, 0, 6, { height: 2, thick: 1, y0: 4 });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders.map((c) => c.box)).toStrictEqual([
      box(0, 0, 4.8, 1, 3, 5.2),
      box(1, 2, 4.8, 3, 3, 5.2),
      box(3, 0, 4.8, 4, 3, 5.2),
      box(-2.5, 4, 0, -1.5, 6, 6),
    ]);
  });
});

describe("stairs", () => {
  it("builds solid steps rising in the given direction", () => {
    const b = createArenaBuilder();
    b.stairs({ x0: 0, z0: 0, x1: 2, z1: 2, y0: 0, y1: 1, dir: "-z", steps: 4 });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders.map((c) => c.box)).toStrictEqual([
      box(0, 0, 1.5, 2, 0.25, 2),
      box(0, 0, 1, 2, 0.5, 1.5),
      box(0, 0, 0.5, 2, 0.75, 1),
      box(0, 0, 0, 2, 1, 0.5),
    ]);
    expect(a.colliders.every((c) => c.tag === "stairs")).toBe(true);
  });

  it("supports +x stairs", () => {
    const b = createArenaBuilder();
    b.stairs({ x0: 0, z0: 0, x1: 1, z1: 3, y0: 1, y1: 2, dir: "+x", steps: 2 });
    expect(b.finish("t", "full", BOUNDS).colliders.map((c) => c.box)).toStrictEqual([box(0, 1, 0, 0.5, 1.5, 3), box(0.5, 1, 0, 1, 2, 3)]);
  });

  it("supports -x stairs: the first step is at the high-x end", () => {
    const b = createArenaBuilder();
    b.stairs({ x0: 2, z0: 0, x1: 0, z1: 3, y0: 0, y1: 1, dir: "-x", steps: 2 });
    expect(b.finish("t", "full", BOUNDS).colliders.map((c) => c.box)).toStrictEqual([box(1, 0, 0, 2, 0.5, 3), box(0, 0, 0, 1, 1, 3)]);
  });

  const stairs = { x0: 0, z0: 0, x1: 2, z1: 2, y0: 0, y1: 1, dir: "+z" } as const;
  it.each([
    ["zero steps", { ...stairs, steps: 0 }, /steps/],
    ["fractional steps", { ...stairs, steps: 2.5 }, /steps/],
    ["NaN steps", { ...stairs, steps: Number.NaN }, /steps/],
    ["a flat flight", { ...stairs, steps: 2, y1: 0 }, /y1/],
    ["a downward flight", { ...stairs, steps: 2, y1: -1 }, /y1/],
    ["risers taller than the step-up", { ...stairs, steps: 1 }, /rise/],
  ])("rejects %s", (_name, o, message) => {
    const b = createArenaBuilder();
    expect(() => b.stairs(o)).toThrow(message);
    expect(b.finish("t", "full", BOUNDS).colliders).toStrictEqual([]);
  });

  it("accepts risers exactly at the step-up height", () => {
    const b = createArenaBuilder();
    b.stairs({ ...stairs, y1: PLAYER_STEP * 2, steps: 2 });
    expect(b.finish("t", "full", BOUNDS).colliders).toHaveLength(2);
  });
});

describe("mirror", () => {
  it("repeats the half with z negated, including spawns, pickups and volumes", () => {
    const b = createArenaBuilder();
    b.mirror(() => {
      b.box(1, 0, -6, 2, 1, -4);
      b.stairs({ x0: 0, z0: -3, x1: 1, z1: -1, y0: 0, y1: 1, dir: "+z", steps: 2 });
      b.volume("updraft", 0, 0, -3, 1, 1, -2, 6);
      b.spawn(3, 0, -10, -Math.PI / 2);
      b.spawn(0, 0, -10, 0);
      b.pickup("orb", 1, 0.5, -7);
    });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders.map((c) => c.box)).toStrictEqual([
      box(1, 0, -6, 2, 1, -4),
      box(0, 0, -3, 1, 0.5, -2),
      box(0, 0, -2, 1, 1, -1),
      box(1, 0, 4, 2, 1, 6),
      box(0, 0, 2, 1, 0.5, 3),
      box(0, 0, 1, 1, 1, 2),
    ]);
    expect(a.volumes[1]).toStrictEqual({ kind: "updraft", box: box(0, 0, 2, 1, 1, 3), liftM: 6 });
    expect(a.spawns[2]!.pos).toStrictEqual({ x: 3, y: 0, z: 10 });
    expect(a.spawns[2]!.yaw).toBeCloseTo(-Math.PI / 2, 12);
    // смотрел на −Z (yaw 0) — в зеркале смотрит на +Z (yaw π)
    expect(a.spawns[3]!.yaw).toBeCloseTo(Math.PI, 12);
    expect(a.pickups[1]!.pos).toStrictEqual({ x: 1, y: 0.5, z: 7 });
  });

  it("refuses nested mirrors", () => {
    const b = createArenaBuilder();
    expect(() => b.mirror(() => b.mirror(() => undefined))).toThrow();
  });

  it("recovers after the half throws, in either pass", () => {
    const b = createArenaBuilder();
    expect(() =>
      b.mirror(() => {
        throw new Error("first pass");
      }),
    ).toThrow("first pass");
    let pass = 0;
    expect(() =>
      b.mirror(() => {
        if (pass++ === 1) throw new Error("second pass");
      }),
    ).toThrow("second pass");
    // не зеркалит и не считает себя внутри mirror()
    b.box(0, 0, -2, 1, 1, -1);
    b.mirror(() => b.spawn(0, 0, -3, 0));
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders.map((c) => c.box)).toStrictEqual([box(0, 0, -2, 1, 1, -1)]);
    expect(a.spawns.map((s) => s.pos.z)).toStrictEqual([-3, 3]);
  });

  it("never emits negative zero, so a mirrored arena survives JSON", () => {
    const b = createArenaBuilder();
    b.mirror(() => {
      b.box(0, 0, -1, 1, 1, 0, { tag: "edge" });
      b.volume("kill", 0, -2, -1, 1, -1, 0);
      b.spawn(2, 0, 0, 0);
      b.pickup("orb", 3, 0.5, 0);
    });
    const a = b.finish("t", "full", BOUNDS);
    const zs = [
      ...a.colliders.flatMap((c) => [c.box.min.z, c.box.max.z]),
      ...a.render.flatMap((r) => [r.box.min.z, r.box.max.z]),
      ...a.volumes.flatMap((v) => [v.box.min.z, v.box.max.z]),
      ...a.spawns.map((s) => s.pos.z),
      ...a.pickups.map((p) => p.pos.z),
    ];
    expect(zs.filter((z) => Object.is(z, -0))).toStrictEqual([]);
    expect(a.colliders[1]!.box).toStrictEqual(box(0, 0, 0, 1, 1, 1));
    expect(a.spawns[1]!.pos).toStrictEqual({ x: 2, y: 0, z: 0 });
    expect(a.pickups[1]!.pos).toStrictEqual({ x: 3, y: 0.5, z: 0 });
    expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
  });

  it("keeps material, flags and tags on mirrored boxes", () => {
    const b = createArenaBuilder();
    b.mirror(() => {
      b.box(0, 0, -2, 1, 1, -1, { material: "gold", noShoot: true, tag: "rail" });
      b.box(0, 0, -4, 1, 1, -3, { material: "grass", noSight: true });
    });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders).toStrictEqual([
      { box: box(0, 0, -2, 1, 1, -1), noShoot: true, tag: "rail" },
      { box: box(0, 0, -4, 1, 1, -3), noSight: true },
      { box: box(0, 0, 1, 1, 1, 2), noShoot: true, tag: "rail" },
      { box: box(0, 0, 3, 1, 1, 4), noSight: true },
    ]);
    expect(a.render).toStrictEqual([
      { box: box(0, 0, -2, 1, 1, -1), material: "gold" },
      { box: box(0, 0, -4, 1, 1, -3), material: "grass" },
      { box: box(0, 0, 1, 1, 1, 2), material: "gold" },
      { box: box(0, 0, 3, 1, 1, 4), material: "grass" },
    ]);
  });

  it("mirrors slabs and both kinds of walls", () => {
    const b = createArenaBuilder();
    b.mirror(() => {
      b.slab(0, -6, 2, -4, 1, { depth: 0.5, material: "floor" });
      b.wallX(-3, 0, 4, { height: 2, thick: 0.4, openings: [{ from: 1, to: 2, top: 1 }] });
      b.wallZ(5, -8, -6, { height: 2, thick: 1, tag: "screen" });
    });
    const a = b.finish("t", "full", BOUNDS);
    const half = [
      box(0, 0.5, -6, 2, 1, -4),
      box(0, 0, -3.2, 1, 2, -2.8),
      box(1, 1, -3.2, 2, 2, -2.8),
      box(2, 0, -3.2, 4, 2, -2.8),
      box(4.5, 0, -8, 5.5, 2, -6),
    ];
    const flip = (bb: AABB) => box(bb.min.x, bb.min.y, -bb.max.z, bb.max.x, bb.max.y, -bb.min.z);
    expect(a.colliders.map((c) => c.box)).toStrictEqual([...half, ...half.map(flip)]);
    const halfMaterials = ["floor", "stone", "stone", "stone", "stone"];
    expect(a.render.map((r) => r.material)).toStrictEqual([...halfMaterials, ...halfMaterials]);
    expect(a.colliders.filter((c) => c.tag === "screen").map((c) => c.box)).toStrictEqual([box(4.5, 0, -8, 5.5, 2, -6), box(4.5, 0, 6, 5.5, 2, 8)]);
  });
});

describe("builder output", () => {
  it("gives every collider and render box its own box object", () => {
    const b = createArenaBuilder();
    b.box(0, 0, 0, 1, 1, 1);
    b.mirror(() => b.box(0, 0, -2, 1, 1, -1));
    const a = b.finish("t", "full", BOUNDS);
    for (let i = 0; i < a.colliders.length; i++) expect(a.colliders[i]!.box).not.toBe(a.render[i]!.box);
    a.colliders[0]!.box.max.y = 9;
    expect(a.render[0]!.box.max.y).toBe(1);
  });

  it("returns copies, so building on after finish() does not change an earlier result", () => {
    const b = createArenaBuilder();
    b.box(0, 0, 0, 1, 1, 1);
    b.volume("grass", 0, 0, 0, 1, 1, 1);
    b.spawn(0, 0, 0, 0);
    b.pickup("orb", 0, 0, 0);
    const first = b.finish("t", "full", BOUNDS);
    b.box(2, 0, 0, 3, 1, 1);
    b.volume("grass", 2, 0, 0, 3, 1, 1);
    b.spawn(2, 0, 0, 0);
    b.pickup("orb", 2, 0, 0);
    const second = b.finish("t", "full", BOUNDS);
    expect([first.colliders, first.render, first.volumes, first.spawns, first.pickups].map((l) => l.length)).toStrictEqual([1, 1, 1, 1, 1]);
    expect([second.colliders, second.render, second.volumes, second.spawns, second.pickups].map((l) => l.length)).toStrictEqual([2, 2, 2, 2, 2]);
    expect(first.bounds).toStrictEqual(BOUNDS);
    expect(first.bounds).not.toBe(BOUNDS);
    expect(first.bounds.min).not.toBe(BOUNDS.min);
  });

  it("returns deep copies, so editing one snapshot changes neither the builder nor the next snapshot", () => {
    const b = createArenaBuilder();
    b.box(0, 0, 0, 1, 1, 1, { tag: "x", material: "gold" });
    b.volume("updraft", 0, 0, 0, 1, 1, 1, 3);
    b.spawn(0, 0, 0, 0.5);
    b.pickup("orb", 0, 0.5, 0);
    const first = b.finish("t", "full", BOUNDS);
    first.colliders[0]!.box.max.y = 9;
    first.colliders[0]!.tag = "changed";
    first.render[0]!.box.min.x = -9;
    first.render[0]!.material = "stone";
    first.volumes[0]!.box.max.z = 9;
    first.volumes[0]!.liftM = 1;
    first.spawns[0]!.pos.x = 9;
    first.spawns[0]!.yaw = 2;
    first.pickups[0]!.pos.y = 9;
    const second = b.finish("t", "full", BOUNDS);
    expect(second.colliders).toStrictEqual([{ box: box(0, 0, 0, 1, 1, 1), tag: "x" }]);
    expect(second.render).toStrictEqual([{ box: box(0, 0, 0, 1, 1, 1), material: "gold" }]);
    expect(second.volumes).toStrictEqual([{ kind: "updraft", box: box(0, 0, 0, 1, 1, 1), liftM: 3 }]);
    expect(second.spawns).toStrictEqual([{ pos: { x: 0, y: 0, z: 0 }, yaw: 0.5 }]);
    expect(second.pickups).toStrictEqual([{ kind: "orb", pos: { x: 0, y: 0.5, z: 0 } }]);
  });
});

describe("wrapAngle", () => {
  it("keeps angles in (−π, π]", () => {
    expect(wrapAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it("never returns negative zero", () => {
    expect(Object.is(wrapAngle(-0), 0)).toBe(true);
    expect(Object.is(wrapAngle(-2 * Math.PI), 0)).toBe(true);
  });
});

describe("clipArena", () => {
  it("cuts boxes and volumes and drops points outside", () => {
    const b = createArenaBuilder();
    b.box(-20, 0, -1, 20, 1, 1);
    b.box(17, 0, -1, 19, 1, 1);
    b.volume("grass", 10, 0, -2, 18, 1, 2);
    b.spawn(0, 0, 0, 0);
    b.spawn(16, 0, 0, 0);
    const a = clipArena(b.finish("t", "full", BOUNDS), box(-15, -20, -18, 15, 20, 18), "compact");
    expect(a.variant).toBe("compact");
    expect(a.colliders.map((c) => c.box)).toStrictEqual([box(-15, 0, -1, 15, 1, 1)]);
    expect(a.volumes[0]!.box).toStrictEqual(box(10, 0, -2, 15, 1, 2));
    expect(a.spawns).toHaveLength(1);
  });

  it("clips render boxes and drops pickups outside the new bounds", () => {
    const b = createArenaBuilder();
    b.box(-20, 0, -1, 20, 1, 1, { material: "gold" });
    b.box(16, 0, -1, 19, 1, 1, { collide: false });
    b.box(-3, 0, -1, -2, 1, 1, { collide: false, material: "edge" });
    b.pickup("orb", 0, 0.5, 0);
    b.pickup("orb", 16, 0.5, 0);
    b.pickup("rune", -14, 0.5, 19);
    const a = clipArena(b.finish("t", "full", BOUNDS), box(-15, -20, -18, 15, 20, 18), "compact");
    expect(a.render).toStrictEqual([
      { box: box(-15, 0, -1, 15, 1, 1), material: "gold" },
      { box: box(-3, 0, -1, -2, 1, 1), material: "edge" },
    ]);
    expect(a.pickups).toStrictEqual([{ kind: "orb", pos: { x: 0, y: 0.5, z: 0 } }]);
  });

  it("copies spawns, pickups and bounds instead of aliasing them", () => {
    const b = createArenaBuilder();
    b.box(-2, 0, -2, 2, 1, 2);
    b.spawn(1, 0, 1, 0.5);
    b.pickup("orb", 1, 0.5, 1);
    const src = b.finish("t", "full", BOUNDS);
    const cut = box(-15, -20, -18, 15, 20, 18);
    const a = clipArena(src, cut, "compact");
    expect(a.spawns).toStrictEqual(src.spawns);
    expect(a.pickups).toStrictEqual(src.pickups);
    expect(a.spawns[0]).not.toBe(src.spawns[0]);
    expect(a.spawns[0]!.pos).not.toBe(src.spawns[0]!.pos);
    expect(a.pickups[0]).not.toBe(src.pickups[0]);
    expect(a.pickups[0]!.pos).not.toBe(src.pickups[0]!.pos);
    expect(a.colliders[0]!.box).not.toBe(a.render[0]!.box);
    expect(a.bounds).toStrictEqual(cut);
    expect(a.bounds).not.toBe(cut);
  });

  it("produces plain data that survives JSON", () => {
    const b = createArenaBuilder();
    b.box(0, 0, 0, 1, 1, 1, { tag: "x" });
    b.spawn(0, 0, 0, 1);
    const a = b.finish("t", "full", BOUNDS);
    expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
  });
});
