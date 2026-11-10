import { describe, expect, it } from "vitest";
import {
  NAV_DROP, NAV_JUMP, buildNav, findPath, isFree, matchContext, navColumn, navNode, nodePos, voidDistM, type ArenaData, type NavGrid,
} from "@doodlemagic/sim";
import { buildGallery } from "./gallery";

/**
 * Фаза 8, задача 1: сетка навигации ботов на «Галерее над ущельем» (обоих вариантов). Тесты с ареной живут здесь, а не в
 * packages/sim: sim не зависит от arena.
 */
const variants: [string, ArenaData][] = [
  ["full", buildGallery("full")],
  ["compact", buildGallery("compact")],
];

const at = (x: number, y: number, z: number) => ({ x, y, z });
/** Часы и вывод замеров: в lib ES2022 их типов нет, в Node они есть. */
const host = globalThis as unknown as { performance: { now(): number }; console: { log(...a: unknown[]): void } };
const clock = (): number => host.performance.now();
const report = (...a: unknown[]): void => host.console.log(...a);

describe.each(variants)("bot nav on the gallery (%s)", (name, arena) => {
  const ctx = matchContext(arena);
  const t0 = clock();
  const nav: NavGrid = buildNav(ctx.world, ctx.killBelowY);
  const buildMs = clock() - t0;

  it("builds in under a second (budget 150 ms) and is read-only data", () => {
    report(`buildNav ${name}: ${buildMs.toFixed(1)} ms, ${nav.nodeY.length} nodes, ${nav.edgeTo.length} edges`);
    expect(buildMs).toBeLessThan(1000);
    expect(nav.nodeY.length).toBeGreaterThan(1000);
    expect(nav.colStart[nav.cols * nav.rows]).toBe(nav.nodeY.length);
    expect(nav.edgeStart[nav.nodeY.length]).toBe(nav.edgeTo.length);
  });

  it("every spawn point is a node in its own column at floor height", () => {
    for (const s of arena.spawns) {
      const n = navNode(nav, s.pos);
      expect(n, JSON.stringify(s.pos)).toBeGreaterThanOrEqual(0);
      expect(nav.nodeCol[n]).toBe(navColumn(nav, s.pos.x, s.pos.z));
      expect(nodePos(nav, n).y).toBeCloseTo(s.pos.y, 5);
    }
  });

  it("no node in the middle of the gorge; at its kerb voidM < 0.6, mid-yard > 4, by the outer wall > 3", () => {
    for (const p of [at(-4, 0, -3), at(4, 0, 3), at(-3.5, -2, 3.5)]) {
      expect(navNode(nav, p)).toBe(-1);
      expect(voidDistM(nav, p)).toBe(0);
    }
    for (const p of [at(-2, 0.2, -5), at(2.5, 0.2, 5), at(1.5, 0, -3.5)]) {
      expect(navNode(nav, p)).toBeGreaterThanOrEqual(0);
      expect(voidDistM(nav, p)).toBeLessThan(0.6);
    }
    for (const p of [at(-10, 0, -8), at(10, 0, -8), at(-10, 0, 8)]) expect(voidDistM(nav, p)).toBeGreaterThan(4);
    const wallX = arena.bounds.max.x - 1.5;
    // восточная стена; западная — у компактной стена фланга, у полной — ров вдоль стены
    const west = arena.bounds.max.x > 20 ? at(-20, -1, -8) : at(-wallX, 0, -8);
    for (const p of [at(wallX, 0, -8), at(wallX, 0, 8), west]) expect(voidDistM(nav, p)).toBeGreaterThan(3);
  });

  it("a path exists from every spawn to every other one", () => {
    for (const a of arena.spawns) {
      for (const b of arena.spawns) {
        if (a === b) continue;
        const p = findPath(nav, navNode(nav, a.pos), navNode(nav, b.pos));
        expect(p, `${JSON.stringify(a.pos)} → ${JSON.stringify(b.pos)}`).not.toBeNull();
        expect(p![0]).toBe(navNode(nav, a.pos));
        expect(p![p!.length - 1]).toBe(navNode(nav, b.pos));
      }
    }
  });

  it("the gallery deck (y ≈ 4) is reached by the stairs", () => {
    const deck = navNode(nav, at(-9, 4, 0));
    expect(nodePos(nav, deck).y).toBeCloseTo(4, 5);
    const p = findPath(nav, navNode(nav, arena.spawns[0]!.pos), deck)!;
    expect(p).not.toBeNull();
    const ys = p.map((n) => nodePos(nav, n).y);
    // подъём идёт ступенями лестницы: перепады не больше шага, есть промежуточные высоты
    for (let k = 1; k < p.length; k++) expect(Math.abs(ys[k]! - ys[k - 1]!)).toBeLessThanOrEqual(0.55 + 1e-6);
    expect(ys.some((y) => y > 1 && y < 3)).toBe(true);
  });

  it("no node's 0.6 × 1.8 m body box overlaps a collider", () => {
    for (let n = 0; n < nav.nodeY.length; n++) {
      const q = nodePos(nav, n);
      const box = { min: { x: q.x - 0.3, y: q.y + 0.01, z: q.z - 0.3 }, max: { x: q.x + 0.3, y: q.y + 1.81, z: q.z + 0.3 } };
      if (!isFree(ctx.world, box)) throw new Error(`node ${n} at ${JSON.stringify(q)} overlaps a collider`);
    }
  });

  it("has moat nodes (full) and jump edges; no edge leads into a void column", () => {
    if (arena.bounds.max.x > 20) {
      const moat = navNode(nav, at(-18, -1, -3));
      expect(nodePos(nav, moat).y).toBeCloseTo(-1, 5);
      // из рва — наружу: ступенью у лестницы или прыжком
      expect(findPath(nav, moat, navNode(nav, at(10, 0, -8)))).not.toBeNull();
    }
    let jumps = 0;
    let drops = 0;
    for (let e = 0; e < nav.edgeTo.length; e++) {
      if (nav.edgeKind[e] === NAV_JUMP) jumps++;
      if (nav.edgeKind[e] === NAV_DROP) drops++;
      expect(nav.colVoid[nav.nodeCol[nav.edgeTo[e]!]!]).toBe(0);
    }
    expect(jumps).toBeGreaterThan(0);
    expect(drops).toBeGreaterThan(0);
  });

  it("the path over a bridge to the rune never comes closer than 0.5 m to the edge", () => {
    for (const z of [-9, 9]) {
      const p = findPath(nav, navNode(nav, at(0, 0, z)), navNode(nav, at(0, 0, 0)))!;
      expect(p).not.toBeNull();
      for (const n of p) {
        const q = nodePos(nav, n);
        expect(nav.voidM[n]).toBeGreaterThanOrEqual(0.5);
        // на мосту (|x| ≤ 1,5 над ущельем) середина узла не ближе 0,5 м к краю моста
        if (Math.abs(q.z) > 2 && Math.abs(q.z) < 5) expect(Math.abs(q.x)).toBeLessThanOrEqual(1.0);
      }
    }
  });
});
