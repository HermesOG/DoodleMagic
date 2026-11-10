import { describe, expect, it } from "vitest";
import { ELEMENTS, MATERIALS } from "@doodlemagic/sim";
import {
  BAND_TINT,
  EYE_INK,
  INK,
  INK_BY_ID,
  INK_COUNT,
  INK_STYLE,
  PAPER,
  SKY,
  SLEEVE_WASH,
  SUN_DIR,
  TONE,
  halfLambert,
  hex,
  inkOf,
  luminance,
  saturation,
  toneBand,
  washColor,
  type InkName,
  type RGB,
} from "./palette";

/**
 * Заливки мира: декор арены и знак цели (`gold` — руна и корона). Бумага и небо — фон, а не заливка, в правило
 * трёх слоёв не входят.
 */
const DECOR: InkName[] = ["stone", "floor", "roof", "grass", "edge", "terrain", "clothA", "clothB", "lantern"];
const WORLD: InkName[] = [...DECOR, "gold"];
/** Свои руки: варежка и рукав (рукав — по каждой стихии отдельно, см. `tones`). */
const OWN: InkName[] = ["hands", "sleeve"];
/** Метки — не заливки слоя: кромка ореола, вспышка попадания, глаза в маске. */
const EYES: InkName[] = ["eyeFire", "eyeEarth", "eyeAir", "eyeWater"];
const MARKS: InkName[] = ["halo", "flash", "haloBurn", ...EYES];
/** Выше глаз (кровля, венцы — выше 3 м) и кромка тушью у самого пола: их тень может быть темнее 0,35. */
const OFF_EYE_LEVEL: InkName[] = ["roof", "edge"];

/** Три тона чернил; у рукава — по тону каждой стихии. */
function tones(ink: InkName): RGB[] {
  const washes = ink === "sleeve" ? ELEMENTS.map((el) => SLEEVE_WASH[el]) : [INK_STYLE[ink].wash];
  return washes.flatMap((w) => [washColor(ink, 0, w), washColor(ink, 1, w), washColor(ink, 2, w)]);
}
const lums = (inks: InkName[]): number[] => inks.flatMap((ink) => tones(ink).map(luminance));

/** Оттенок HSV в градусах; у серого (насыщенность < 0,12) оттенка нет. */
function hue(c: RGB): number | null {
  const max = Math.max(...c);
  const min = Math.min(...c);
  if (max === 0 || (max - min) / max < 0.12) return null;
  const d = max - min;
  const h = max === c[0] ? ((c[1] - c[2]) / d) % 6 : max === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Не красный: оттенок вне 340…15° (серое без оттенка — не красное). */
const notRed = (h: number | null): boolean => h === null || (h > 15 && h < 340);

describe("ink table", () => {
  it("gives every arena material its own ink and fits the shader array", () => {
    const ids = MATERIALS.map(inkOf);
    expect(new Set(ids).size).toBe(MATERIALS.length);
    expect(Math.max(...Object.values(INK))).toBe(INK_COUNT - 1);
    expect(INK_BY_ID).toHaveLength(INK_COUNT);
    INK_BY_ID.forEach((name, id) => expect(INK[name]).toBe(id));
  });

  it("numbers the phase 7 inks 13–21 and maps eyes and sleeves by element", () => {
    expect([INK.halo, INK.flash, INK.terrain]).toEqual([10, 11, 12]);
    expect([INK.clothA, INK.clothB, INK.lantern, INK.sleeve, INK.eyeFire, INK.eyeEarth, INK.eyeAir, INK.eyeWater, INK.haloBurn]).toEqual([
      13, 14, 15, 16, 17, 18, 19, 20, 21,
    ]);
    expect(INK_COUNT).toBe(22);
    expect(ELEMENTS.map((el) => EYE_INK[el])).toEqual([INK.eyeFire, INK.eyeEarth, INK.eyeAir, INK.eyeWater]);
    expect(Object.keys(SLEEVE_WASH).sort()).toEqual([...ELEMENTS].sort());
  });

  it("reads design hex codes", () => {
    expect(hex(0xebe0c9)).toEqual([235 / 255, 224 / 255, 201 / 255]);
    expect(luminance(PAPER)).toBeCloseTo(0.88, 2);
  });

  it("darkens with each band, for every element's sleeve too", () => {
    for (const ink of [...WORLD, ...OWN]) {
      const t = tones(ink).map(luminance);
      for (let i = 0; i < t.length; i += 3) {
        expect(t[i]!, ink).toBeGreaterThanOrEqual(t[i + 1]!);
        expect(t[i + 1]!, ink).toBeGreaterThanOrEqual(t[i + 2]!);
      }
    }
  });

  it("warms the stone light and cools its shadow; the floor stays a neutral canvas", () => {
    const [light, mid, dark] = tones("stone");
    expect(light![0]).toBeGreaterThan(light![2]);
    expect(dark![2]).toBeGreaterThan(dark![0]);
    expect(Math.abs(luminance(mid!) - 0.49)).toBeLessThan(0.02);
    for (const c of tones("floor")) expect(saturation(c), "floor").toBeLessThanOrEqual(0.1);
    expect(BAND_TINT[1]).toEqual([1, 1, 1]);
  });
});

/**
 * GDD 6 и правила честности: мир — средние тона в приглушённых красках; враги — самое тёмное в кадре; ядро магии —
 * самое яркое, магия — самое насыщенное. Все слои меряются одной яркостью — Rec. 709. Контуры — линии туши,
 * а не заливки: чёрная линия мира темнее врага по замыслу, поэтому в правило не входит.
 */
describe("three brightness layers (GDD 6)", () => {
  it("keeps the world in muted colour: saturation ≤ 0.35 in light, ≤ 0.45 in half tone and shadow", () => {
    for (const ink of [...WORLD, ...OWN]) {
      tones(ink).forEach((c, i) => {
        expect(saturation(c), `${ink} band ${i % 3}`).toBeLessThanOrEqual(i % 3 === 0 ? 0.35 : 0.45);
      });
    }
  });

  it("caps world light at 0.66 for stone and floor and 0.72 for the rest of the combat band", () => {
    for (const ink of ["stone", "floor"] as const) expect(luminance(washColor(ink, 0)), ink).toBeLessThanOrEqual(0.66);
    // руна и корона (gold) — знак цели «беги сюда», варежка — светлая по замыслу: им предел 0,72 не ставим,
    // но и они темнее ядра магии (правило ниже)
    for (const ink of DECOR) {
      for (const l of tones(ink).map(luminance)) expect(l, ink).toBeLessThanOrEqual(0.66);
    }
    for (const l of tones("sleeve").map(luminance)) expect(l, "sleeve").toBeLessThanOrEqual(0.72);
  });

  it("keeps eye-level shadow at 0.35 or lighter, so the enemy stands out of it", () => {
    for (const ink of [...WORLD, ...OWN].filter((i) => !OFF_EYE_LEVEL.includes(i))) {
      for (const l of tones(ink).map(luminance)) expect(l, ink).toBeGreaterThanOrEqual(0.35);
    }
  });

  it("keeps enemy fills at 0.16 or darker and darker than every world and own fill by at least 0.1", () => {
    const enemy = lums(["enemy"]);
    expect(Math.max(...enemy)).toBeLessThanOrEqual(0.16);
    expect(Math.min(...lums([...WORLD, ...OWN])) - Math.max(...enemy)).toBeGreaterThanOrEqual(0.1);
  });

  it("makes the magic core brighter than every other fill by at least 0.05", () => {
    const brightestOther = Math.max(...lums([...WORLD, ...OWN, "enemy"]));
    for (const l of lums(["magic"])) expect(l - brightestOther).toBeGreaterThanOrEqual(0.05);
  });

  it("makes magic the most saturated layer, at 0.65 or more", () => {
    const otherMaxSat = Math.max(...[...WORLD, ...OWN, "enemy" as const].flatMap((ink) => tones(ink).map(saturation)));
    for (const c of tones("magic")) {
      expect(saturation(c)).toBeGreaterThanOrEqual(0.65);
      expect(saturation(c)).toBeGreaterThan(otherMaxSat);
    }
    expect(INK_STYLE.magic.bands).toEqual([1, 1, 1]);
  });
});

/**
 * Правило декора: цвет в мире не похож на магию и на опасность — нет красного (HP и урон), оранжевого ярче 0,55
 * (огонь), нефрита (Земля), лазури (Вода) и светлой сирени (Воздух). Оттенок меряется только у цветных тонов:
 * серый (насыщенность < 0,12) оттенка не имеет. Руна (gold) — нейтральный язык, а рукав — своя стихия, поэтому
 * оттенки им не ограничены; рукав Огня всё равно не уходит к красному HP.
 */
describe("decor colour rule", () => {
  it("has no red, bright orange, jade, azure or light lilac in decor", () => {
    for (const ink of DECOR) {
      for (const c of tones(ink)) {
        const h = hue(c);
        const s = saturation(c);
        const tag = `${ink} ${c.map((x) => x.toFixed(2)).join(",")}`;
        expect(notRed(h), tag).toBe(true);
        if (h === null) continue;
        // рабочее определение (GDD 6): «оранжевый» — оттенок 15–40° при насыщенности ≥ 0,4; приглушённые охра
        // знамени и окно фонаря (насыщенность < 0,4) разрешены продюсером (design/round4/04-producer.md)
        if (h > 15 && h < 40 && s >= 0.4) expect(luminance(c), `${tag}: orange`).toBeLessThanOrEqual(0.55);
        expect(h > 120 && h < 170, `${tag}: jade`).toBe(false);
        expect(h > 188 && h < 218 && s >= 0.25, `${tag}: azure`).toBe(false);
        expect(h > 235 && h < 290 && luminance(c) >= 0.6, `${tag}: light lilac`).toBe(false);
      }
    }
  });

  it("keeps every sleeve off red", () => {
    for (const c of tones("sleeve")) expect(notRed(hue(c))).toBe(true);
    expect(hue(washColor("sleeve", 2, SLEEVE_WASH.fire))!).toBeGreaterThanOrEqual(20);
  });
});

/**
 * Метки — исключения из правила слоёв: ореол и вспышка светлее бумаги, но без цвета; ореол горения — тёплая
 * светлая кромка; глаза — чистый цвет стихии. Ни одна метка не красная, и цветные метки темнее ядра магии.
 */
describe("marks", () => {
  it("keeps the enemy halo and the hit flash lighter than paper and colourless", () => {
    for (const ink of ["halo", "flash"] as const) {
      for (const c of tones(ink)) {
        expect(luminance(c)).toBeGreaterThanOrEqual(luminance(PAPER));
        expect(saturation(c)).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it("paints the eyes and the burning halo in flat pure colour, off red and below the magic core", () => {
    const core = luminance(washColor("magic", 0));
    for (const ink of MARKS) expect(INK_STYLE[ink].bands, ink).toEqual([1, 1, 1]);
    for (const ink of [...EYES, "haloBurn" as const]) {
      const c = washColor(ink, 0);
      expect(saturation(c), ink).toBeGreaterThanOrEqual(0.45);
      expect(hue(c)!, ink).toBeGreaterThanOrEqual(20);
      expect(notRed(hue(c)), ink).toBe(true);
      expect(luminance(c), ink).toBeLessThan(core);
    }
    expect(luminance(washColor("haloBurn", 0))).toBeGreaterThanOrEqual(0.75);
    expect(new Set(EYES.map((ink) => Math.round(hue(washColor(ink, 0))! / 30))).size).toBe(4);
  });
});

/**
 * Небо, дымка и ущелье — фон. Ясный день: голубой зенит, тёплый горизонт, светлые облака. Облака ущелья темнее
 * бумаги и ядра магии — шар над руной не выгорает в крем, — но враг на них всё равно самое тёмное.
 */
describe("sky and gorge", () => {
  it("runs from a warm horizon to a blue zenith with lighter clouds", () => {
    expect(hue(SKY.zenith)!).toBeGreaterThan(200);
    expect(saturation(SKY.zenith)).toBeGreaterThanOrEqual(0.3);
    expect(SKY.horizon[0]).toBeGreaterThan(SKY.horizon[2]);
    expect(luminance(SKY.cloud)).toBeGreaterThan(luminance(SKY.horizon));
    expect(luminance(SKY.ridgeFar)).toBeGreaterThan(luminance(SKY.ridgeNear));
  });

  it("sinks the gorge into clouds in shadow: darker downwards, below paper and the magic core", () => {
    const core = luminance(washColor("magic", 0));
    expect(luminance(SKY.gorgeDeep)).toBeLessThan(luminance(SKY.gorgeTop));
    expect(luminance(SKY.gorgeTop)).toBeLessThan(luminance(PAPER));
    expect(core - luminance(SKY.gorgeTop)).toBeGreaterThanOrEqual(0.1);
    expect(luminance(SKY.gorgeDeep) - Math.max(...lums(["enemy"]))).toBeGreaterThanOrEqual(0.3);
  });
});

describe("sun and wash bands", () => {
  // солнце с запада в плоскости z = 0 (Р15 фазы 7): на стенах три тона — к солнцу свет, вдоль солнца полутон, от солнца тень
  const FACES: { name: string; n: [number, number, number]; band: 0 | 1 | 2 }[] = [
    { name: "top", n: [0, 1, 0], band: 0 },
    { name: "-x side", n: [-1, 0, 0], band: 0 },
    { name: "+z side", n: [0, 0, 1], band: 1 },
    { name: "-z side", n: [0, 0, -1], band: 1 },
    { name: "+x side", n: [1, 0, 0], band: 2 },
    { name: "bottom", n: [0, -1, 0], band: 2 },
  ];

  it("lights the box top and the sunward side, puts the ±z sides in half tone and the far side in shadow", () => {
    for (const f of FACES) expect(toneBand(halfLambert(f.n, SUN_DIR)), f.name).toBe(f.band);
  });

  it("keeps the sun in the plane z = 0, so the mirrored halves A and B are lit alike", () => {
    expect(SUN_DIR[2]).toBe(0);
    expect(Math.hypot(...SUN_DIR)).toBeCloseTo(1, 12);
    expect(SUN_DIR[0]).toBeLessThan(0);
    expect(halfLambert([0, 0, 1], SUN_DIR)).toBe(halfLambert([0, 0, -1], SUN_DIR));
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
