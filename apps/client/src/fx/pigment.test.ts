import { DepthTexture, Texture, Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { INK, PAPER, luminance, saturation, type RGB } from "../render/palette";
import { FX_COMMON, GLAZE, GLAZE_TINT, glazeAlpha, glazeOver } from "./fxShader";
import { createGlowMeshes } from "./glows";
import { AIR_STROKE_ALPHA, FX_COLOR, KIND, particle } from "./particleKit";
import { createParticlePool } from "./particles";
import { burstParticles } from "./presets";

/*
 * Магия-пигмент (фаза 7, задача 3; раунд 4, V1–V10): глазурь света, цвета под бумагу, кайма свой / чужой, горение
 * по контуру, своё Дыхание изнутри, удар тушью, «магия гасит день», следы.
 */

const O = { x: 0, y: 1, z: 0 };
const rng = (seed = 5) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const gray = (v: number): RGB => [v, v, v];
const hue = (c: RGB): number => {
  const max = Math.max(...c);
  const min = Math.min(...c);
  if (max === min) return 0;
  if (max === c[0]) return (60 * ((c[1] - c[2]) / (max - min)) + 360) % 360;
  if (max === c[1]) return 60 * ((c[2] - c[0]) / (max - min)) + 120;
  return 60 * ((c[0] - c[1]) / (max - min)) + 240;
};
const gbuffer = { surface: new Texture(), depth: new DepthTexture(1, 1), invDepth: new Vector2(1, 0) };
const time = { value: 0 };

describe("V1: light as glaze, white ceiling 0.97", () => {
  it("fire light on a 0.6 grey reads orange (saturation ≥ 0.4), not cream, and never darkens the grey", () => {
    for (const tint of [GLAZE_TINT.glows, GLAZE_TINT.particles]) {
      for (const k of [0.5, 0.6, 0.8]) {
        const out = glazeOver(scale(FX_COLOR.fire, k), tint, gray(0.6));
        expect(saturation(out), `tint ${tint}, k ${k}`).toBeGreaterThanOrEqual(0.4);
        expect(luminance(out)).toBeGreaterThanOrEqual(0.6);
      }
    }
    // старое сложение (α = яркость × насыщенность × 0,6) на том же сером уходило в крем
    const k = 0.5;
    const l = scale(FX_COLOR.fire, k);
    const oldA = Math.min(0.75, Math.max(...l) * saturation(l) * 0.6);
    expect(saturation([l[0] + 0.6 * (1 - oldA), l[1] + 0.6 * (1 - oldA), l[2] + 0.6 * (1 - oldA)])).toBeLessThan(0.4);
  });

  it("the white core never lifts paper past 0.97, and dim light never darkens a world tone", () => {
    for (const k of [0.3, 0.7, 1, 2]) for (const c of glazeOver(gray(k), 0.85, PAPER)) expect(c).toBeLessThanOrEqual(GLAZE.white + 1e-9);
    for (const c of glazeOver(scale(FX_COLOR.fire, 1.6), 0.85, [0.97, 0.97, 0.97])) expect(c).toBeLessThanOrEqual(GLAZE.white + 1e-9);
    for (const base of [0.35, 0.5, 0.66]) {
      for (const k of [0.05, 0.2, 0.4]) {
        expect(luminance(glazeOver(gray(k), 0.85, gray(base)))).toBeGreaterThanOrEqual(base - 1e-9);
        expect(luminance(glazeOver(scale(FX_COLOR.fire, k), 0.85, gray(base)))).toBeGreaterThanOrEqual(base - 1e-9);
      }
    }
    expect(glazeAlpha([0, 0, 0], 0.85)).toBe(0);
    expect(glazeAlpha(scale(FX_COLOR.jade, 4), 1)).toBe(1);
  });

  it("the shader runs the same formula and multipliers: glows 0.85, light particles 0.7", () => {
    expect(GLAZE).toEqual({ white: 0.97, lum: 0.7, max: 0.9 });
    expect(GLAZE_TINT).toEqual({ glows: 0.85, particles: 0.7 });
    expect(FX_COMMON).toContain("float glaze = min(min(sat * tint, lum / FX_GLAZE_LUM), FX_GLAZE_MAX);");
    expect(FX_COMMON).toContain("max(glaze, hi / FX_WHITE)");
    const glows = createGlowMeshes(gbuffer).mesh.material;
    const pool = createParticlePool({ name: "t", maxCap: 4, cap: 4, gbuffer, time }).mesh.material;
    expect([glows.defines.GLOW_TINT, pool.defines.PARTICLE_TINT, pool.defines.FX_WHITE]).toEqual(["0.85", "0.7", "0.97"]);
    expect(glows.fragmentShader).toContain("fxLight(tinted + col, GLOW_TINT)");
  });

  it("keeps magic light off the enemy's eyes and burning halo too (inks eyeFire…haloBurn in a row)", () => {
    expect([INK.eyeEarth, INK.eyeAir, INK.eyeWater, INK.haloBurn].map((v) => v - INK.eyeFire)).toEqual([1, 2, 3, 4]);
    const pool = createParticlePool({ name: "t", maxCap: 4, cap: 4, gbuffer, time }).mesh.material;
    expect([pool.defines.INK_EYE_FIRE, pool.defines.INK_HALO_BURN]).toEqual([INK.eyeFire, INK.haloBurn]);
    expect(FX_COMMON).toContain("(ink >= INK_EYE_FIRE && ink <= INK_HALO_BURN)");
    // fxVisibility и прочие проверки идут через одну функцию
    expect(FX_COMMON.match(/ink == INK_ENEMY/g)?.length).toBe(1);
  });
});

describe("V6: element colours for the paper", () => {
  it("fire body brighter than the fight band (≤ 0.72) and the most saturated; embers and shade stay off HP red", () => {
    expect(FX_COLOR.fire).toEqual([1, 0xb2 / 255, 0x4d / 255]);
    expect(luminance(FX_COLOR.fire)).toBeGreaterThan(0.72);
    for (const c of [FX_COLOR.fire, FX_COLOR.fireShade, FX_COLOR.jade, FX_COLOR.water]) expect(saturation(c)).toBeGreaterThanOrEqual(0.65);
    for (const c of [FX_COLOR.ember, FX_COLOR.fireShade]) expect(hue(c)).toBeGreaterThanOrEqual(20);
    expect(luminance(FX_COLOR.core)).toBeGreaterThan(luminance(FX_COLOR.fire));
  });

  it("earth: dust 0.2 below paper, chips in umber ink, deeper jade; paper flash stays paper", () => {
    expect(luminance(PAPER) - luminance(FX_COLOR.dust)).toBeGreaterThanOrEqual(0.2);
    expect(luminance(FX_COLOR.stone)).toBeLessThan(0.35);
    expect(FX_COLOR.jade).toEqual([0x2a / 255, 0x9e / 255, 0x62 / 255]);
    const flash = burstParticles("paperFlash", O, O, 1, rng());
    expect(flash.every((p) => p.alpha > 0 && Math.abs(luminance(p.color) - luminance(PAPER)) < 0.04)).toBe(true);
    expect(burstParticles("stoneImpact", O, O, 1, rng()).filter((p) => p.gravity >= 9).every((p) => luminance(p.color) < 0.4)).toBe(true);
  });

  it("air is a brush stroke #4B4870 at 0.6, water body #1E8BD0", () => {
    expect(FX_COLOR.water).toEqual([0x1e / 255, 0x8b / 255, 0xd0 / 255]);
    expect(KIND.wind.stroke).toBe(true);
    const gust = burstParticles("gustBlast", O, { x: 0, y: 0, z: -1 }, 1, rng()).filter((p) => p.stroke);
    expect(gust.length).toBeGreaterThan(30);
    expect(gust.every((p) => p.alpha === AIR_STROKE_ALPHA && Math.abs(p.color[2] - FX_COLOR.airStroke[2]) < 0.05)).toBe(true);
    expect(particle("wind", O, O, 0.4, 0.06, 0.25, rng()).stroke).toBe(true);
    expect(particle("flame", O, O, 0.4, 0.06, 0.25, rng()).stroke).toBeUndefined();
  });

  it("a stroke is marked by the sign of size0 in the pool, no new attribute", () => {
    const pool = createParticlePool({ name: "t", maxCap: 4, cap: 4, gbuffer, time });
    pool.emit([particle("wind", O, O, 0.4, 0.06, 0.25, rng()), particle("flame", O, O, 0.4, 0.06, 0.25, rng())], 0);
    const a = pool.mesh.geometry.getAttribute("aTime");
    expect([a.getZ(0), a.getZ(1)]).toEqual([expect.closeTo(-0.06, 6), expect.closeTo(0.06, 6)]);
    expect(Object.keys(pool.mesh.geometry.attributes).sort()).toEqual(["aColor", "aGrav", "aP0", "aTime", "aV0", "normal", "position", "uv"]);
    expect(pool.mesh.material.vertexShader).toContain("aTime.z < 0.0 ? 3.0");
  });
});
