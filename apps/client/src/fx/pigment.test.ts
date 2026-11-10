import { DepthTexture, PerspectiveCamera, Texture, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { NOBODY, createMageUnit, createMatchState, type MatchState, type Vec3, type Zone } from "@doodlemagic/sim";
import { INK, INK_STYLE, PAPER, luminance, saturation, type RGB } from "../render/palette";
import { styleShared } from "../render/stylePass";
import { createFireWallMeshes, fireWallSheet } from "./fireWalls";
import { FX_COMMON, GLAZE, GLAZE_TINT, glazeAlpha, glazeOver } from "./fxShader";
import { BURN_ALPHA, createGlowMeshes, cullGlows } from "./glows";
import type { ElementVfxFrame } from "./elementVfx";
import { AIR_STROKE_ALPHA, FX_COLOR, INK_STROKE_ALPHA, KIND, RIM, markSide, particle, sideOf, type ParticleSpec } from "./particleKit";
import { CLEAR_DEG, FLAG, createParticlePool, packGravity, unpackGravity } from "./particles";
import { BREATH_PALM_RATE, BURN_SMOKE_S, BURST_SHARE, INK_STRIKE, breathPalmTongue, burnSmoke, burstParticles, inkStrike } from "./presets";
import { DAY_DIM, OWN_BREATH, createUltVfx, dayDimState, stepDayDim, ultDimsDay } from "./ultVfx";
import { burnEdge, createVfx } from "./vfx";

/*
 * Магия-пигмент (фаза 7, задача 3; раунд 4, V1–V10): глазурь света, цвета под бумагу, кайма свой / чужой, горение
 * по контуру, своё Дыхание изнутри, удар тушью, «магия гасит день», следы.
 */

const O = { x: 0, y: 1, z: 0 };
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
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

  it("a stroke is a flag packed into the gravity attribute, no new attribute", () => {
    const pool = createParticlePool({ name: "t", maxCap: 4, cap: 4, gbuffer, time });
    pool.emit([particle("wind", O, O, 0.4, 0.06, 0.25, rng()), particle("flame", O, O, 0.4, 0.06, 0.25, rng())], 0);
    const g = pool.mesh.geometry.getAttribute("aGrav");
    expect([unpackGravity(g.getX(0)), unpackGravity(g.getX(1))]).toEqual([{ gravity: 0, flags: FLAG.stroke }, { gravity: -3, flags: 0 }]);
    expect(Object.keys(pool.mesh.geometry.attributes).sort()).toEqual(["aColor", "aGrav", "aP0", "aTime", "aV0", "normal", "position", "uv"]);
    expect(pool.mesh.material.vertexShader).toContain("(flags & FLAG_STROKE) != 0 ? 3.0");
  });
});

/** Эффектник целиком в node: G-буфер — пустые текстуры, камера в (0; 1,6; 0) смотрит вдоль −Z. */
const ME = 1;
const OTHER = 2;
const palms = { right: new Vector3(0.26, -0.25, -0.62), left: new Vector3(-0.26, -0.25, -0.62) };
function harness() {
  const vfx = createVfx(gbuffer as never, "high");
  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 200);
  camera.position.set(0, 1.6, 0);
  const mesh = (name: string) => vfx.fx.world.getObjectByName(name) as unknown as { count: number; geometry: { getAttribute(n: string): { getX(i: number): number; getY(i: number): number; getZ(i: number): number; getW(i: number): number } } };
  const sync = (s: MatchState, nowS: number, prev = s) => vfx.sync({ prev, cur: s, alpha: 1, nowS, camera, localId: ME, palms });
  return { vfx, camera, mesh, sync };
}
const flagsOf = (pool: ReturnType<ReturnType<typeof harness>["mesh"]>, i: number) => unpackGravity(pool.geometry.getAttribute("aGrav").getX(i)).flags;

describe("V3: own and enemy rim", () => {
  it("packs own, enemy, stroke and crosshair-clear flags into gravity and back", () => {
    const base = particle("flame", O, O, 0.4, 0.2, 0.4, rng());
    for (const g of [-3.4, 0, 6, 14]) {
      for (const f of [{}, { foe: true }, { own: true }, { stroke: true, clear: true }]) {
        const u = unpackGravity(packGravity({ ...base, gravity: g, ...f }));
        expect(u.gravity).toBeCloseTo(g, 9);
        expect(u.flags).toBe(("foe" in f ? FLAG.foe : 0) | ("own" in f ? FLAG.own : 0) | ("stroke" in f ? FLAG.stroke | FLAG.clear : 0));
      }
    }
    // чужое сильнее своего: оба флага сразу не пишутся
    expect(unpackGravity(packGravity({ ...base, own: true, foe: true })).flags).toBe(FLAG.foe);
  });

  it("knows whose magic it is: own, enemy, or unknown (no rim) when there is no local mage", () => {
    expect([sideOf(ME, ME), sideOf(OTHER, ME), sideOf(OTHER, NOBODY), sideOf(NOBODY, ME)]).toEqual(["own", "foe", null, null]);
    const ps = markSide([particle("flame", O, O, 0.4, 0.2, 0.4, rng())], "foe");
    expect([ps[0]!.foe, ps[0]!.own]).toEqual([true, undefined]);
    const wall = { id: 3, owner: OTHER, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: { min: { x: -5, y: 0, z: -11 }, max: { x: 5, y: 2.5, z: -10.4 } } }, bornTick: 0, armTick: 24, endTick: 324, rehit: [] } as Zone;
    expect([fireWallSheet(wall, 60, ME)?.side, fireWallSheet({ ...wall, owner: ME }, 60, ME)?.side, fireWallSheet(wall, 60)?.side]).toEqual(["foe", "own", null]);
  });

  it("enemy rim is dark (#2A140A, α 0.9) and jagged, own is smooth mid-tone at 0.5; the breath's own edge is #B8500F", () => {
    expect([RIM.foe.fire, RIM.foe.alpha, RIM.own.fire, RIM.own.alpha, RIM.own.breath]).toEqual([
      [0x2a / 255, 0x14 / 255, 0x0a / 255], 0.9, [0x8a / 255, 0x5a / 255, 0x3a / 255], 0.5, [0xb8 / 255, 0x50 / 255, 0x0f / 255],
    ]);
    // своя кайма — средний тон огня (между тенью мира и телом), чужая — почти тушь, темнее любой заливки мира
    expect(luminance(RIM.foe.fire)).toBeLessThan(0.16);
    expect(luminance(RIM.own.fire)).toBeGreaterThan(0.3);
    expect(hue(RIM.own.breath)).toBeGreaterThanOrEqual(20);
    const pool = createParticlePool({ name: "t", maxCap: 4, cap: 4, gbuffer, time }).mesh.material;
    const walls = createFireWallMeshes(gbuffer, time).mesh.material;
    expect([pool.defines.RIM_FOE_A, pool.defines.RIM_OWN_A, walls.defines.RIM_FOE_A]).toEqual(["0.9", "0.5", "0.9"]);
    expect(pool.fragmentShader).toContain("float jag = foe ?");
    expect(walls.fragmentShader).toContain("float jag = side > 1.5 ?");
  });

  it("marks trail flames of an enemy fireball as foe and of mine as own, in the shared pool", () => {
    const { vfx, mesh, sync } = harness();
    const fireball = (id: number, owner: number, x: number) => ({ id, owner, ability: "fireball", pos: { x, y: 1.5, z: -8 }, vel: { x: 20, y: 0, z: 0 }, bornTick: 0, endTick: 600, power: 0 });
    const at = (k: number) => {
      const s = createMatchState([createMageUnit(ME, "fire", { pos: V(0, 0, 0), yaw: 0 }), createMageUnit(OTHER, "fire", { pos: V(0, 0, -20), yaw: Math.PI })]);
      s.tick = k;
      s.projectiles = [fireball(10, OTHER, -6 + k * 0.4) as never];
      return s;
    };
    for (let k = 0; k < 20; k++) sync(at(k), k / 60);
    const pool = mesh("fx-particles");
    const flags = Array.from({ length: 200 }, (_, i) => flagsOf(pool, i)).filter((f) => f !== 0);
    expect(flags.length).toBeGreaterThan(5);
    expect(flags.every((f) => (f & FLAG.foe) !== 0)).toBe(true);
    vfx.dispose();
  });
});

describe("V5: burning along the contour, warm halo", () => {
  it("licks are born on the silhouette edge across the view (0.35–0.45 m, 1.2–1.9 m) or at the crown, toward the camera", () => {
    const r = rng(9);
    const feet = V(0, 0, -8);
    const eye = V(0, 1.6, 0);
    let top = 0;
    for (let i = 0; i < 300; i++) {
      const p = burnEdge(feet, eye, r);
      expect(p.z).toBeCloseTo(-7.9, 6);
      if (Math.abs(p.x) <= 0.15 + 1e-9) {
        top++;
        expect(p.y >= 1.85 && p.y <= 1.95).toBe(true);
      } else {
        expect(Math.abs(p.x) >= 0.35 && Math.abs(p.x) <= 0.45 && p.y >= 1.2 && p.y <= 1.9).toBe(true);
      }
    }
    expect(top / 300).toBeGreaterThan(0.15);
    expect(top / 300).toBeLessThan(0.35);
    // языки 0,25 → 0,45 м вверх; дымок раз в 0,3 с
    const lick = burstParticles("burnLick", O, O, 1, rng()).filter((p) => p.alpha > 0);
    expect(lick.every((p) => p.size0 >= 0.2 && p.size1 >= 0.35 && p.size1 <= 0.45 && p.gravity < 0)).toBe(true);
    expect(BURN_SMOKE_S).toBe(0.3);
    expect(burnSmoke(O, rng()).alpha).toBeGreaterThan(0);
  });

  it("a burning enemy gets a warm halo glow (haloBurn) without a light slot, culled by its radius", () => {
    const { vfx, mesh, sync } = harness();
    const s = createMatchState([createMageUnit(ME, "fire", { pos: V(0, 0, 0), yaw: 0 }), createMageUnit(OTHER, "earth", { pos: V(0, 0, -8), yaw: Math.PI })]);
    s.units[1]!.status.burnPulses = 3;
    sync(s, 1);
    sync(s, 1.2);
    const glows = mesh("fx-glows");
    const g1 = glows.geometry.getAttribute("aG1");
    const rims = Array.from({ length: glows.count }, (_, i) => g1.getW(i)).filter((w) => w > 0);
    expect(rims.length).toBe(1);
    expect(rims[0]).toBeGreaterThan(1.5);
    expect(BURN_ALPHA).toBeGreaterThan(0.8);
    const m = createGlowMeshes(gbuffer).mesh.material;
    expect(m.uniforms.uBurn!.value.toArray()).toEqual([...INK_STYLE.haloBurn.wash]);
    expect(m.fragmentShader).toContain("ink == INK_HALO || ink == INK_HALO_BURN");
    const cam = new PerspectiveCamera(70, 16 / 9, 0.05, 160);
    cam.updateMatrixWorld();
    expect(cullGlows([{ pos: V(0, 0, -6), color: FX_COLOR.fire, halo: 0, light: 0, intensity: 1, core: 0, rim: 1.6 }], cam).length).toBe(1);
    vfx.dispose();
  });
});

describe("V4: my own dragon breath from inside", () => {
  const ultFrame = (s: MatchState, tick: number, nowS: number, sink: ParticleSpec[]): ElementVfxFrame => {
    const units = s.units.map((u) => ({ id: u.id, pos: u.move.body.pos, u }));
    const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 200);
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld();
    return {
      prev: s, cur: s, alpha: 1, tick, nowS, dt: 1 / 60, camera, eye: V(0, 1.6, 0), localId: ME, units, mages: [],
      palmWorld: () => V(0, 1.35, -0.6), emit: (specs) => sink.push(...specs), glow: () => {}, decal: () => {},
    };
  };
  const breathingMe = (): MatchState => {
    const u = createMageUnit(ME, "fire", { pos: V(), yaw: 0 });
    u.mage!.ult.cast = { ability: "dragonBreath", startTick: 100, releaseTick: 136, endTick: 316, zone: NOBODY };
    return createMatchState([u]);
  };

  it("streams 120/s in a ring 6–15° off the look, crosshair-clear, bigger (1.4–2 m), unthinned by the preset share", () => {
    for (const preset of ["high", "low"] as const) {
      const vfx = createUltVfx({ gbuffer: gbuffer as never, time: { value: 0 } });
      vfx.setPreset?.(preset);
      const s = breathingMe();
      const sink: ParticleSpec[] = [];
      for (let i = 0; i < 60; i++) vfx.sync(ultFrame(s, 160 + i, 3 + i / 60, sink));
      // эффектник кладёт в общий пул столько, чтобы после доли пресета осталось 120/с
      expect(Math.round(sink.length * BURST_SHARE[preset])).toBeGreaterThan(OWN_BREATH.rate - 4);
      expect(Math.round(sink.length * BURST_SHARE[preset])).toBeLessThanOrEqual(OWN_BREATH.rate + 1);
      const k = preset === "low" ? OWN_BREATH.lowSize : 1;
      for (const p of sink) {
        const v = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
        const deg = (Math.acos(Math.min(1, -p.vel.z / v)) * 180) / Math.PI;
        expect(deg >= 6 - 1e-6 && deg <= 15 + 1e-6, `${deg}`).toBe(true);
        expect([p.own, p.clear, p.foe]).toEqual([true, true, undefined]);
      }
      const flames = sink.filter((p) => p.alpha > 0);
      expect(flames.every((p) => p.size1 >= 1.4 * k - 1e-9 && p.size1 <= 2 * k + 1e-9)).toBe(true);
      vfx.dispose();
    }
  });

  it("my sheet is denser (0.55), starts 0.3 m from the palms and keeps the 6° centre clear", () => {
    const vfx = createUltVfx({ gbuffer: gbuffer as never, time: { value: 0 } });
    const m = (vfx.light as unknown as { material: { defines: Record<string, string>; fragmentShader: string } }).material;
    expect([m.defines.OWN_ALPHA, m.defines.OWN_FROM]).toEqual(["0.55", "0.3"]);
    expect(Number(m.defines.CLEAR_TAN0)).toBeCloseTo(Math.tan((CLEAR_DEG[0] * Math.PI) / 180), 9);
    expect(CLEAR_DEG[0]).toBeLessThanOrEqual(6);
    expect(m.fragmentShader).toContain("smoothstep(CLEAR_TAN0, CLEAR_TAN1, length(vView.xy) / max(-vView.z, 1e-3))");
    const pool = createParticlePool({ name: "t", maxCap: 4, cap: 4, gbuffer, time }).mesh.material;
    expect(pool.fragmentShader).toContain("(flags & FLAG_CLEAR) != 0");
    vfx.dispose();
  });

  it("tongues leave both palms for the lower corners of the frame, 0.08 → 0.3 m, 40/s, × 0.7 on low", () => {
    expect(BREATH_PALM_RATE).toBe(40);
    const r = rng(3);
    for (const side of [1, -1] as const) {
      for (let i = 0; i < 40; i++) {
        const p = breathPalmTongue(V(0.26 * side, -0.25, -0.62), side, 1, r);
        expect(Math.sign(p.vel.x)).toBe(side);
        expect(p.vel.y).toBeLessThan(0);
        expect(p.size0 >= 0.07 && p.size0 <= 0.09 && p.size1 >= 0.26 && p.size1 <= 0.32 && p.alpha > 0 && p.own).toBe(true);
      }
    }
    expect(breathPalmTongue(V(), 1, OWN_BREATH.lowSize, () => 0.5).size1).toBeCloseTo(0.29 * 0.7, 9);
  });
});

describe("V7: ink strike on a hit", () => {
  it("medium — 4 strokes 0.6 m for 0.1 s, large — 6 strokes 1.1 m for 0.14 s, a flash of the element in the centre; ≤ 12", () => {
    const at = V(0, 1.2, -8);
    const eye = V(0, 1.6, 0);
    for (const tier of ["medium", "large"] as const) {
      const out = inkStrike(at, eye, tier, "water", rng());
      const s = INK_STRIKE[tier];
      expect(out.length).toBeLessThanOrEqual(12);
      const strokes = out.filter((p) => p.stroke);
      expect(strokes.length).toBe(s.strokes);
      for (const p of strokes) {
        expect([p.color, p.alpha, p.life]).toEqual([expect.anything(), INK_STROKE_ALPHA, s.lifeS]);
        expect(luminance(p.color)).toBeLessThan(0.15);
        expect(p.size1).toBeGreaterThanOrEqual(s.lenM * 0.8 - 1e-9);
        expect(p.size1).toBeLessThanOrEqual(s.lenM * 1.2 + 1e-9);
        // по экрану: поперёк взгляда, перед телом
        const v = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
        expect(Math.abs(p.vel.z) / v).toBeLessThan(0.1);
        expect(p.pos.z).toBeGreaterThan(at.z);
      }
      const flash = out.filter((p) => !p.stroke);
      expect(flash.length).toBe(s.flashes);
      expect(flash.every((p) => p.alpha === 0 && p.color === FX_COLOR.water)).toBe(true);
    }
    expect(inkStrike(at, eye, "medium", "earth", rng()).find((p) => !p.stroke)!.color).toBe(FX_COLOR.jade);
  });

  it("vfx puts the strokes into the pool for my medium and large hits, not for a small one", () => {
    const strokes = (amount: number) => {
      const { vfx, mesh, sync } = harness();
      const s = createMatchState([createMageUnit(ME, "fire", { pos: V(), yaw: 0 }), createMageUnit(OTHER, "earth", { pos: V(0, 0, -8), yaw: Math.PI })]);
      sync(s, 1);
      vfx.apply({ kind: "number", target: OTHER, amount: 20, pos: V(0, 1.2, -7.7), dot: false, air: false }, 1.01, "right");
      vfx.apply({ kind: "flash", target: OTHER }, 1.01, "right");
      vfx.apply({ kind: "flinch", target: OTHER, dir: V(0, 0, -1), amount }, 1.01, "right");
      const pool = mesh("fx-particles");
      const n = Array.from({ length: 64 }, (_, i) => flagsOf(pool, i)).filter((f) => (f & FLAG.stroke) !== 0).length;
      vfx.dispose();
      return n;
    };
    expect([strokes(0.1), strokes(0.2), strokes(0.8)]).toEqual([0, INK_STRIKE.medium.strokes, INK_STRIKE.large.strokes]);
  });
});

describe("R7: magic dims the day", () => {
  const cast = (id: number, element: "fire" | "air" | "earth" | "water", ability: "dragonBreath" | "hurricane" | "tectonicRift" | "tsunami", pos: Vec3, zone = NOBODY) => {
    const u = createMageUnit(id, element, { pos, yaw: 0 });
    u.mage!.ult.cast = { ability, startTick: 100, releaseTick: 136, endTick: 316, zone };
    return u;
  };
  const meAt = (pos: Vec3) => createMageUnit(ME, "earth", { pos, yaw: 0 });

  it("dims for my own ult and for an enemy ult only when I am within its reach + 5 m", () => {
    expect(DAY_DIM).toEqual({ inS: 0.4, outS: 0.8, everyS: 8, nearM: 5 });
    const mine = createMatchState([cast(ME, "fire", "dragonBreath", V())]);
    expect(ultDimsDay(mine, ME, 120, V())).toBe(true);
    expect(ultDimsDay(mine, ME, 316, V())).toBe(false);
    // чужое Дыхание: 12 + 5 м; Ураган: 10 + 5 м
    const breath = (z: number) => createMatchState([meAt(V(0, 0, z)), cast(OTHER, "fire", "dragonBreath", V())]);
    expect([ultDimsDay(breath(-16.5), ME, 140, V(0, 0, -16.5)), ultDimsDay(breath(-17.5), ME, 140, V(0, 0, -17.5))]).toEqual([true, false]);
    const storm = createMatchState([meAt(V(14, 0, 0)), cast(OTHER, "air", "hurricane", V())]);
    expect([ultDimsDay(storm, ME, 120, V(14, 0, 0)), ultDimsDay(storm, ME, 120, V(16, 0, 0))]).toEqual([true, false]);
    // без своего мага — только чужие ульты не гасят ничего
    expect(ultDimsDay(storm, ME, 120, null)).toBe(false);
  });

  it("the rift dims along its line until 0.5 s after the strike; the tsunami along the path of the wave", () => {
    const rift = { id: 9, owner: OTHER, kind: "rift", ability: "tectonicRift", shape: { type: "segment", a: V(0, 0, -1.5), b: V(0, 0, -26.5), halfW: 1.5 }, bornTick: 100, armTick: 148, endTick: 508, rehit: [] } as Zone;
    const s = createMatchState([meAt(V(6, 0, -10)), createMageUnit(OTHER, "earth", { pos: V(), yaw: 0 })]);
    s.zones = [rift];
    expect([ultDimsDay(s, ME, 120, V(6, 0, -10)), ultDimsDay(s, ME, 120, V(7, 0, -10)), ultDimsDay(s, ME, 148 + 29, V(6, 0, -10)), ultDimsDay(s, ME, 148 + 31, V(6, 0, -10))]).toEqual([true, false, true, false]);
    // волна идёт от a → b по (n.z, −n.x): от отрезка вдоль x — к −z
    const wave = { ...rift, id: 10, kind: "tsunami", ability: "tsunami", shape: { type: "segment", a: V(-7, 0, 0), b: V(7, 0, 0), halfW: 1 }, armTick: 148, endTick: 268 } as Zone;
    s.zones = [wave];
    expect([ultDimsDay(s, ME, 200, V(0, 0, -25)), ultDimsDay(s, ME, 200, V(0, 0, -36)), ultDimsDay(s, ME, 200, V(0, 0, 6)), ultDimsDay(s, ME, 200, V(0, 0, 4))]).toEqual([true, false, false, true]);
    s.zones = [{ ...wave, owner: ME }];
    expect(ultDimsDay(s, ME, 200, V(0, 0, 100))).toBe(true);
  });

  it("goes dark over 0.4 s, back over 0.8 s, smoothly, and not again within 8 s", () => {
    const d = dayDimState();
    const run = (want: boolean, from: number, s: number) => {
      let k = 0;
      for (let t = 0; t < s - 1e-9; t += 0.02) k = stepDayDim(d, want, from + t, 0.02);
      return k;
    };
    expect(run(true, 0, 0.2)).toBeGreaterThan(0.3);
    expect(run(true, 0.2, 0.2)).toBeCloseTo(1, 9);
    expect(run(false, 2, 0.4)).toBeGreaterThan(0.3);
    expect(run(false, 2.4, 0.4)).toBeCloseTo(0, 9);
    // следующая ульта через 5 с — день не гаснет; через 8 с после прошлого — гаснет
    expect(run(true, 5, 1)).toBe(0);
    expect(run(false, 6, 0.1)).toBe(0);
    expect(run(true, 8.05, 0.5)).toBeCloseTo(1, 9);
  });

  it("writes the shared day-dim uniform from the ult effects and clears it on dispose", () => {
    const vfx = createUltVfx({ gbuffer: gbuffer as never, time: { value: 0 } });
    const s = createMatchState([cast(ME, "fire", "dragonBreath", V())]);
    const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 200);
    const units = s.units.map((u) => ({ id: u.id, pos: u.move.body.pos, u }));
    for (let i = 0; i < 40; i++)
      vfx.sync({ prev: s, cur: s, alpha: 1, tick: 110 + i, nowS: 20 + i / 60, dt: 1 / 60, camera, eye: V(0, 1.6, 0), localId: ME, units, mages: [], palmWorld: () => V(0, 1.35, -0.6), emit: () => {}, glow: () => {}, decal: () => {} });
    expect(styleShared.dayDim.value).toBeCloseTo(1, 9);
    vfx.dispose();
    expect(styleShared.dayDim.value).toBe(0);
  });
});
