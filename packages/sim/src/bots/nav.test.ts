import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import type { Collider, Volume } from "../types";
import { createWorld } from "../world";
import {
  NAV_DROP, NAV_JUMP, NAV_WALK, buildNav, dashLandingOk, edgeKindOf, findPath, navNode, nearestSafe, nodePos, safeNodeNear, voidDir, voidDistM,
} from "./nav";

/**
 * Синтетическая арена: две плиты пола (z < −2 и z > 2) над пропастью с мостом 3 м посередине; уступ 1 м (на него —
 * прыжком), блок 1,4 м (не запрыгнуть, только спрыгнуть); стена с проходом 1 м. Сетка «Галереи» — в
 * packages/arena/src/bots.nav.sim.test.ts.
 */
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({ box: aabb(x0, y0, z0, x1, y1, z1) });
const colliders: Collider[] = [
  box(-10, -1, -10, 10, 0, -2),
  box(-10, -1, 2, 10, 0, 10),
  box(-1.5, -1, -2, 1.5, 0, 2), // мост
  box(5, 0, -8, 8, 1, -5), // уступ 1 м
  box(-8, 0, -8, -5, 1.4, -5), // блок 1,4 м
  box(-10, 0, 6, -0.5, 3, 6.5), // стена с проходом x −0,5…0,5
  box(0.5, 0, 6, 10, 3, 6.5),
];
const volumes: Volume[] = [{ kind: "kill", box: aabb(-10, -20, -2, 10, -5, 2) }];
const world = createWorld(colliders, volumes);
const nav = buildNav(world, -20);
const at = (x: number, y: number, z: number) => ({ x, y, z });

describe("bot nav grid (synthetic arena)", () => {
  it("puts nodes on the floor and the bridge, none over the gap", () => {
    expect(navNode(nav, at(0, 0, -6))).toBeGreaterThanOrEqual(0);
    expect(navNode(nav, at(0, 0, 0))).toBeGreaterThanOrEqual(0); // мост
    expect(navNode(nav, at(-5, 0, 0))).toBe(-1);
    expect(voidDistM(nav, at(-5, 0, 0))).toBe(0);
    // середины колонок — на кратных 0,5 м
    const p = nodePos(nav, navNode(nav, at(0.1, 0, -6.1)));
    expect([p.x, p.y, p.z]).toEqual([0, 0, -6]);
    // ближайший в 1 м: точка у стены, где тело не встаёт
    expect(navNode(nav, at(-3, 0, 5.9))).toBeGreaterThanOrEqual(0);
    expect(navNode(nav, at(30, 0, 0))).toBe(-1);
  });

  it("measures the distance to the edge along the graph", () => {
    expect(voidDistM(nav, at(-5, 0, -2))).toBeLessThan(0.1);
    expect(voidDistM(nav, at(-5, 0, -3))).toBeCloseTo(1, 1);
    expect(voidDistM(nav, at(0, 0, -6))).toBeCloseTo(4, 1);
    expect(voidDistM(nav, at(0, 0, 0))).toBeCloseTo(1.5, 1); // середина моста
    expect(voidDistM(nav, at(1, 0, 0))).toBeCloseTo(0.5, 1);
    const d = voidDir(nav, at(-5, 0, -3))!;
    expect(d.z).toBeGreaterThan(0.9);
    // над пропастью — к ближнему полу
    const back = voidDir(nav, at(-5, 0, -1.6))!;
    expect(back.z).toBeLessThan(-0.9);
  });

  it("links a 1 m ledge by a jump, a 1.4 m block only by a one-way drop", () => {
    const floor = navNode(nav, at(4.5, 0, -6.5));
    const ledge = navNode(nav, at(5, 1, -6.5));
    expect(nodePos(nav, ledge).y).toBeCloseTo(1, 5);
    expect(edgeKindOf(nav, floor, ledge)).toBe(NAV_JUMP);
    expect(edgeKindOf(nav, ledge, floor)).toBe(NAV_DROP);
    const ground = navNode(nav, at(-4.5, 0, -6.5));
    const block = navNode(nav, at(-5, 1.4, -6.5));
    expect(edgeKindOf(nav, ground, block)).toBe(-1);
    expect(edgeKindOf(nav, block, ground)).toBe(NAV_DROP);
    expect(nav.nodeMain[block]).toBe(0);
    expect(nav.nodeMain[ground]).toBe(1);
    expect(edgeKindOf(nav, ground, navNode(nav, at(-4, 0, -6.5)))).toBe(NAV_WALK);
  });

  it("finds a path over the bridge away from its edges and through the 1 m gap", () => {
    const p = findPath(nav, navNode(nav, at(-3, 0, -6)), navNode(nav, at(3, 0, 8)))!;
    expect(p).not.toBeNull();
    for (const n of p) {
      const q = nodePos(nav, n);
      expect(nav.voidM[n]).toBeGreaterThanOrEqual(0.5);
      if (Math.abs(q.z) < 2) expect(Math.abs(q.x)).toBeLessThanOrEqual(1);
      if (q.z >= 6 && q.z <= 6.5) expect(Math.abs(q.x)).toBeLessThan(0.5);
    }
    // ступени пути — соседние колонки
    for (let k = 1; k < p.length; k++) expect(edgeKindOf(nav, p[k - 1]!, p[k]!)).toBeGreaterThanOrEqual(0);
  });

  it("refuses goals at the very edge or out of reach, and obeys the node cost", () => {
    const from = navNode(nav, at(0, 0, -6));
    expect(findPath(nav, from, navNode(nav, at(-5, 0, -2)))).toBeNull(); // узел у кромки
    expect(findPath(nav, from, navNode(nav, at(-5, 1.4, -6.5)))).toBeNull(); // на блок не зайти
    const bridge = (n: number): number => (Math.abs(nodePos(nav, n).z) < 2 ? Infinity : 0);
    expect(findPath(nav, from, navNode(nav, at(0, 0, 4)), bridge)).toBeNull();
    expect(findPath(nav, from, from)).toEqual([from]);
    const safe = safeNodeNear(nav, at(-5, 0, -2), 2, 0.5);
    expect(nav.voidM[safe]).toBeGreaterThanOrEqual(0.5);
    const rescue = nearestSafe(nav, at(-5, 1, -1.5), 6, 1);
    expect(nav.voidM[rescue]).toBeGreaterThanOrEqual(1);
    expect(nodePos(nav, rescue).z).toBeLessThan(-2);
  });

  it("checks a dash landing: 1.5 m from the edge at the end, never over the void on the way", () => {
    expect(dashLandingOk(nav, at(-5, 0, -9), { x: 0, z: 1 }, 4)).toBe(true); // до z −5: 3 м до кромки
    expect(dashLandingOk(nav, at(-5, 0, -9), { x: 0, z: 1 }, 6.5)).toBe(false); // у самой кромки
    expect(dashLandingOk(nav, at(-5, 0, -5), { x: 0, z: 1 }, 8)).toBe(false); // через пропасть
    expect(dashLandingOk(nav, at(0, 0, -5), { x: 0, z: 1 }, 8)).toBe(true); // по мосту
  });
});
