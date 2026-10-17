import { describe, expect, it } from "vitest";
import { MATERIALS } from "@doodlemagic/sim";
import {
  INK,
  INK_BY_ID,
  INK_COUNT,
  INK_STYLE,
  SUN_DIR,
  TONE,
  halfLambert,
  inkOf,
  luminance,
  saturation,
  toneBand,
  washColor,
  type InkName,
  type RGB,
} from "./palette";

/** Заливки мира: средние тона. Бумага и небо — фон, а не заливка, в правило трёх слоёв не входят. */
const WORLD: InkName[] = ["stone", "floor", "roof", "grass", "edge", "gold", "hands"];
const NON_MAGIC: InkName[] = [...WORLD, "enemy"];
const bands = (ink: InkName): RGB[] => [washColor(ink, 0), washColor(ink, 1), washColor(ink, 2)];
const lums = (inks: InkName[]): number[] => inks.flatMap((ink) => bands(ink).map(luminance));

describe("ink table", () => {
  it("gives every arena material its own ink and fits the shader array", () => {
    const ids = MATERIALS.map(inkOf);
    expect(new Set(ids).size).toBe(MATERIALS.length);
    expect(Math.max(...Object.values(INK))).toBe(INK_COUNT - 1);
    expect(INK_BY_ID).toHaveLength(INK_COUNT);
    INK_BY_ID.forEach((name, id) => expect(INK[name]).toBe(id));
  });

  it("darkens with each band", () => {
    for (const ink of WORLD) {
      const [light, mid, dark] = bands(ink).map(luminance);
      expect(light).toBeGreaterThanOrEqual(mid!);
      expect(mid).toBeGreaterThanOrEqual(dark!);
    }
  });
});

/**
 * GDD 6: «Мир — средние тона без насыщенности. Враги — самое тёмное в кадре. Магия — единственное насыщенное и
 * самое яркое». Все три слоя меряются одной функцией — яркостью Rec. 709. Контуры — линии туши, а не заливки:
 * чёрная линия мира темнее врага по замыслу, поэтому в правило не входит.
 */
describe("three brightness layers (GDD 6)", () => {
  it("keeps the world in mid tones, 25–90 %", () => {
    for (const ink of WORLD) {
      for (const c of bands(ink)) {
        expect(luminance(c), ink).toBeGreaterThanOrEqual(0.25);
        expect(luminance(c), ink).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it("makes enemy fills darker than every world fill", () => {
    const darkestWorld = Math.min(...lums(WORLD));
    for (const l of lums(["enemy"])) expect(l).toBeLessThan(darkestWorld);
  });

  it("makes every magic colour brighter than every other fill by at least 0.05", () => {
    const brightestOther = Math.max(...lums(NON_MAGIC));
    for (const l of lums(["magic"])) expect(l - brightestOther).toBeGreaterThanOrEqual(0.05);
  });

  it("makes magic the only saturated layer", () => {
    const otherMaxSat = Math.max(...NON_MAGIC.flatMap((ink) => bands(ink).map(saturation)));
    expect(otherMaxSat).toBeLessThanOrEqual(0.45);
    for (const c of bands("magic")) expect(saturation(c)).toBeGreaterThanOrEqual(0.6);
    expect(INK_STYLE.magic.bands).toEqual([1, 1, 1]);
  });
});

describe("sun and wash bands", () => {
  const FACES: { name: string; n: [number, number, number]; band: 0 | 1 | 2 }[] = [
    { name: "top", n: [0, 1, 0], band: 0 },
    { name: "+x side", n: [1, 0, 0], band: 1 },
    { name: "+z side", n: [0, 0, 1], band: 1 },
    { name: "-x side", n: [-1, 0, 0], band: 2 },
    { name: "-z side", n: [0, 0, -1], band: 2 },
    { name: "bottom", n: [0, -1, 0], band: 2 },
  ];

  it("lights the box top, puts two sides in half tone and two in shadow", () => {
    for (const f of FACES) expect(toneBand(halfLambert(f.n, SUN_DIR)), f.name).toBe(f.band);
  });

  it("keeps every face tone clear of the band thresholds, including their softness and noise", () => {
    const margin = TONE.soft + TONE.jitter;
    for (const f of FACES) {
      const t = halfLambert(f.n, SUN_DIR);
      expect(Math.abs(t - TONE.mid), f.name).toBeGreaterThanOrEqual(margin);
      expect(Math.abs(t - TONE.light), f.name).toBeGreaterThanOrEqual(margin);
    }
  });

  it("uses half-Lambert 0.5 + 0.5·(n·L)", () => {
    expect(halfLambert(SUN_DIR, SUN_DIR)).toBeCloseTo(1, 9);
    expect(halfLambert([-SUN_DIR[0], -SUN_DIR[1], -SUN_DIR[2]], SUN_DIR)).toBeCloseTo(0, 9);
    expect(toneBand(TONE.mid - 0.01)).toBe(2);
    expect(toneBand(TONE.mid + 0.01)).toBe(1);
    expect(toneBand(TONE.light + 0.01)).toBe(0);
  });
});
