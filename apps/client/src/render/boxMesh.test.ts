import { describe, expect, it } from "vitest";
import type { AABB, RenderBox } from "@doodlemagic/sim";
import { buildBoxArrays, groupByInk } from "./boxMesh";
import { INK } from "./palette";

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB => ({
  min: { x: x0, y: y0, z: z0 },
  max: { x: x1, y: y1, z: z1 },
});

const vec = (a: Float32Array, k: number): [number, number, number] => [a[k * 3]!, a[k * 3 + 1]!, a[k * 3 + 2]!];

describe("buildBoxArrays", () => {
  const boxes = [box(0, 0, 0, 1, 2, 3), box(-5, -1, -5, 5, 0, 5)];
  const g = buildBoxArrays(boxes);

  it("emits 24 vertices and 12 triangles per box", () => {
    expect(g.positions).toHaveLength(2 * 24 * 3);
    expect(g.normals).toHaveLength(2 * 24 * 3);
    expect(g.indices).toHaveLength(2 * 36);
    expect(Math.max(...g.indices)).toBe(47);
  });

  it("keeps every vertex on the box corners", () => {
    for (let k = 0; k < 24; k++) {
      const [x, y, z] = vec(g.positions, k);
      expect([0, 1]).toContain(x);
      expect([0, 2]).toContain(y);
      expect([0, 3]).toContain(z);
    }
  });

  it("winds every triangle counter-clockwise seen from outside, matching the flat normal", () => {
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
      const pa = vec(g.positions, a);
      const pb = vec(g.positions, b);
      const pc = vec(g.positions, c);
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const cross = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const n = vec(g.normals, a);
      expect(cross[0]! * n[0] + cross[1]! * n[1] + cross[2]! * n[2]).toBeGreaterThan(0);
      expect(vec(g.normals, b)).toEqual(n);
      expect(vec(g.normals, c)).toEqual(n);
    }
  });

  it("points every normal outward and keeps each face on the box side it faces", () => {
    boxes.forEach((bx, i) => {
      const centre = [(bx.min.x + bx.max.x) / 2, (bx.min.y + bx.max.y) / 2, (bx.min.z + bx.max.z) / 2];
      const lo = [bx.min.x, bx.min.y, bx.min.z];
      const hi = [bx.max.x, bx.max.y, bx.max.z];
      for (let f = 0; f < 6; f++) {
        const first = i * 24 + f * 4;
        const n = vec(g.normals, first);
        const axis = n.findIndex((c) => c !== 0);
        expect(n.filter((c) => c !== 0)).toHaveLength(1);
        for (let k = first; k < first + 4; k++) {
          const v = vec(g.positions, k);
          expect(vec(g.normals, k)).toEqual(n);
          expect(n[0] * (v[0] - centre[0]!) + n[1] * (v[1] - centre[1]!) + n[2] * (v[2] - centre[2]!)).toBeGreaterThan(0);
          // плоскость грани: координата по оси нормали — на той стороне бокса, куда смотрит нормаль
          expect(v[axis]).toBe(n[axis]! > 0 ? hi[axis] : lo[axis]);
        }
      }
    });
  });
});

describe("groupByInk", () => {
  it("puts boxes of one material into one bucket", () => {
    const render: RenderBox[] = [
      { box: box(0, 0, 0, 1, 1, 1), material: "stone" },
      { box: box(1, 0, 0, 2, 1, 1), material: "gold" },
      { box: box(2, 0, 0, 3, 1, 1), material: "stone" },
    ];
    const groups = groupByInk(render);
    expect([...groups.keys()]).toEqual([INK.stone, INK.gold]);
    expect(groups.get(INK.stone)).toHaveLength(2);
  });

  it("returns buckets in ascending ink order, compared as numbers", () => {
    const render: RenderBox[] = (["gold", "stone", "edge", "floor", "grass", "roof"] as const).map((material, k) => ({
      box: box(k, 0, 0, k + 1, 1, 1),
      material,
    }));
    const keys = [...groupByInk(render).keys()];
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(keys).toEqual([INK.stone, INK.floor, INK.roof, INK.grass, INK.edge, INK.gold]);
  });
});
