import { BackSide, DepthTexture, FrontSide, PerspectiveCamera, Texture, Vector2 } from "three";
import { describe, expect, it } from "vitest";
import type { Terrain, Zone } from "@doodlemagic/sim";
import { BURST_PRESETS } from "../feel/effects";
import { GBUFFER_FRAG, GBUFFER_VERT, createInkMaterial } from "../render/gbuffer";
import { INK, PAPER, luminance, saturation } from "../render/palette";
import { zoneDecal } from "./decals";
import { dummyParts, haloMargin, type DummyPose } from "./dummyMeshes";
import { handToWorldView, lerpById, muzzleBlend } from "./interp";
import { allocateRing } from "./particles";
import { createDecalMeshes } from "./decals";
import { createFireWallMeshes } from "./fireWalls";
import { ENEMY_DENSE, ENEMY_LIGHT } from "./fxShader";
import { cullGlows, createGlowMeshes } from "./glows";
import { createParticlePool } from "./particles";
import { BURST_SHARE, FX_COLOR, MAGIC_LIGHTS, PARTICLE_BUDGET, burstParticles, palmParticles, poolCaps, thinParticles } from "./presets";
import { terrainVisualBox } from "./terrainMeshes";

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
const rng = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pose: DummyPose = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, leanX: 0, leanZ: 0, flinch: 0, squash: 1, flash: false, bob: 0 };
const O = { x: 0, y: 1, z: 0 };

describe("fx pure parts", () => {
  it("wraps the particle ring; every burst ≤ 150; fire is additive light, earth dust is paper-coloured", () => {
    expect(allocateRing(4, 10, 8)).toEqual({ head: 2, ranges: [{ start: 4, count: 6 }, { start: 0, count: 2 }] });
    expect(allocateRing(3, 10, 25).ranges.reduce((a, r) => a + r.count, 0)).toBe(10);
    for (const id of BURST_PRESETS) expect(burstParticles(id, O, O, 1, rng()).length).toBeLessThanOrEqual(150);
    expect(burstParticles("fireballBoom", O, O, 1, rng()).some((p) => p.alpha === 0)).toBe(true);
    expect(burstParticles("wallDust", O, O, 1, rng()).every((p) => p.alpha > 0 && Math.abs(p.color[0] - FX_COLOR.dust[0]) < 0.08)).toBe(true);
  });

  it("lerps by id, snaps jumps over 3 m, and blends a fresh projectile from the palm in 0.15 s", () => {
    const prev = [{ id: 1, pos: { x: 0, y: 0, z: 0 } }, { id: 3, pos: { x: 0, y: 0, z: 0 } }];
    const cur = [{ id: 1, pos: { x: 2, y: 0, z: 0 } }, { id: 2, pos: { x: 5, y: 1, z: 0 } }, { id: 3, pos: { x: 10, y: 0, z: 0 } }];
    expect(lerpById(prev, cur, 0.25).map((p) => p.pos.x)).toEqual([0.5, 5, 10]);
    expect([muzzleBlend(0), muzzleBlend(0.15), muzzleBlend(0.3), muzzleBlend(0.05) > muzzleBlend(0.1)]).toEqual([1, 0, 0, true]);
    const p = { x: 0.26, y: -0.25, z: -0.62 };
    const q = handToWorldView(p, 60, 70);
    const ndc = (v: typeof p, fov: number) => v.x / (-v.z * Math.tan((fov * Math.PI) / 360));
    expect([Number((ndc(q, 70) - ndc(p, 60)).toFixed(9)), q.z]).toEqual([0, p.z]);
  });

  it("builds a dark dummy with a white mask toward −Z, inverts it on a hit, keeps the halo ~2 px", () => {
    const parts = dummyParts(pose);
    expect(parts.every((p) => p.pos[1] - p.scale[1] / 2 >= -1e-9 && p.pos[1] + p.scale[1] / 2 <= 1.8 + 1e-9)).toBe(true);
    const mask = parts.find((p) => p.part === "mask")!;
    expect([mask.ink, mask.pos[2] < parts.find((p) => p.part === "head")!.pos[2]]).toEqual([INK.halo, true]);
    const lit = dummyParts({ ...pose, flash: true });
    expect([lit.filter((p) => p.part !== "mask").every((p) => p.ink === INK.flash), lit.find((p) => p.part === "mask")!.ink]).toEqual([true, INK.enemy]);
    expect(dummyParts({ ...pose, yaw: Math.PI / 2 }).find((p) => p.part === "mask")!.pos[0]).toBeLessThan(-0.1);
    expect(haloMargin(15, 1080, 70)).toBeCloseTo((2 * 15 * Math.tan((35 * Math.PI) / 180)) / 540, 9);
    expect(haloMargin(1, 1080, 70)).toBe(0.02);
  });

  it("raises terrain out of the ground and runs telegraphs from cast to arm", () => {
    const t = { id: 1001, owner: 1, kind: "wall", box: box(-2, 0, -2.3, 2, 2.5, -1.7), bornTick: 100, solidTick: 112, endTick: 460, growTicks: 18, solid: false, hp: 250, maxHp: 250 } as Terrain;
    expect([terrainVisualBox(t, 100).max.y, terrainVisualBox(t, 109).max.y > 1, terrainVisualBox(t, 118).max.y, terrainVisualBox(t, 459).max.y < 0.5]).toEqual([0, true, 2.5, true]);
    const wall = { id: 1, owner: 1, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: box(-5, 0, -10.3, 5, 2.5, -9.7) }, bornTick: 100, armTick: 124, endTick: 424, rehit: [] } as Zone;
    expect(zoneDecal(wall, 100)).toMatchObject({ stage: "telegraph", progress: 0, shape: "rect", style: "sparks" });
    expect([zoneDecal(wall, 112)!.progress, zoneDecal(wall, 124)!.stage]).toEqual([0.5, "active"]);
    const quake = { ...wall, kind: "quake", ability: "earthquake", shape: { type: "disc", center: { x: 0, y: 0, z: 0 }, radius: 7 }, endTick: 125 } as Zone;
    expect([zoneDecal(quake, 110), zoneDecal(quake, 124)]).toEqual([expect.objectContaining({ shape: "ring", sizeX: 14, style: "quake" }), null]);
  });
});

describe("fx budgets and mapping", () => {
  it("splits the particle budget 4/5 world, 1/5 palms, per quality preset", () => {
    expect(PARTICLE_BUDGET).toEqual({ low: 600, medium: 1500, high: 3000 });
    for (const id of ["low", "medium", "high"] as const) {
      const caps = poolCaps(id);
      expect([caps.world + caps.palm, caps.world]).toEqual([PARTICLE_BUDGET[id], (PARTICLE_BUDGET[id] * 4) / 5]);
    }
    expect([MAGIC_LIGHTS.low, MAGIC_LIGHTS.medium, MAGIC_LIGHTS.high]).toEqual([2, 4, 8]);
  });

  it("keeps the ring exact at the edges and clamps the burst scale to 0.5…3", () => {
    expect(allocateRing(5, 10, 0)).toEqual({ head: 5, ranges: [] });
    expect(allocateRing(6, 10, 4)).toEqual({ head: 0, ranges: [{ start: 6, count: 4 }] });
    const n1 = burstParticles("stoneImpact", O, O, 1, rng()).length;
    expect(burstParticles("stoneImpact", O, O, 0.1, rng()).length).toBe(burstParticles("stoneImpact", O, O, 0.5, rng()).length);
    expect(burstParticles("stoneImpact", O, O, 0.5, rng()).length).toBeLessThan(n1);
    expect(burstParticles("fireballBoom", O, O, 10, rng()).length).toBe(150);
  });

  it("colours magic saturated and earth dust as paper; fire rises, stone chips fall hard", () => {
    expect(FX_COLOR.dust).toEqual(PAPER);
    for (const c of [FX_COLOR.fire, FX_COLOR.jade, FX_COLOR.ember]) expect(saturation(c)).toBeGreaterThanOrEqual(0.6);
    expect(luminance(FX_COLOR.core)).toBeGreaterThan(0.85);
    expect(burstParticles("burnLick", O, O, 1, rng()).every((p) => p.gravity <= 0 && p.life >= 0.3 && p.life <= 0.6)).toBe(true);
    const chips = burstParticles("stoneImpact", O, O, 1, rng()).filter((p) => p.alpha > 0 && p.gravity > 0);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((p) => p.gravity >= 9)).toBe(true);
  });

  it("emits small palm particles in hands-camera space for every element and kind", () => {
    const palm = { x: 0.26, y: -0.25, z: -0.62 };
    for (const element of ["fire", "earth"] as const) {
      for (const kind of ["flash", "charge", "fizzle"] as const) {
        const ps = palmParticles(element, kind, palm, rng());
        expect(ps.length).toBeGreaterThan(0);
        expect(ps.length).toBeLessThanOrEqual(40);
        expect(ps.every((p) => Math.max(p.size0, p.size1) <= 0.12 && Math.abs(p.pos.z - palm.z) < 0.3)).toBe(true);
      }
    }
  });

  it("orients a segment decal along the trail and rings nothing after a one-shot zone arms", () => {
    const trail = { id: 2, owner: 1, kind: "fireTrail", ability: "jetDash", shape: { type: "segment", a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: -8 }, halfW: 0.75 }, bornTick: 10, armTick: 10, endTick: 130, rehit: [] } as Zone;
    const d = zoneDecal(trail, 70)!;
    expect([d.stage, d.shape, d.style, d.sizeX, d.sizeZ, d.progress, d.center.z]).toEqual(["active", "segment", "embers", 8, 1.5, 0.5, -4]);
    // локальная +X декали после поворота angle вокруг Y: (cos a, −sin a) — вдоль следа
    expect([Math.cos(d.angle), -Math.sin(d.angle)].map((v) => Number(v.toFixed(9)) + 0)).toEqual([0, -1]);
    expect(zoneDecal(trail, 130)).toBeNull();
    const pillar = { ...trail, kind: "pillar", ability: "stonePillar", shape: { type: "box", box: box(-1, 0, -1, 1, 2.5, 1) }, armTick: 46 } as Zone;
    expect(zoneDecal(pillar, 28)).toMatchObject({ stage: "telegraph", progress: 0.5, shape: "rect", style: "cracks", sizeX: 2, sizeZ: 2 });
    expect(zoneDecal(pillar, 46)).toBeNull();
  });

  it("gives the G-buffer an instanced path with per-instance ink, and an inside-out shell for the halo", () => {
    const shell = createInkMaterial(INK.halo, undefined, { side: BackSide });
    const parts = createInkMaterial(INK.enemy, undefined, { instanceInk: true });
    expect(["INSTANCE_INK" in parts.defines, "INSTANCE_INK" in shell.defines, shell.side, createInkMaterial(INK.stone).side]).toEqual([true, false, BackSide, FrontSide]);
    expect(GBUFFER_VERT).toMatch(/#ifdef USE_INSTANCING[\s\S]*modelMatrix \* instanceMatrix[\s\S]*#else[\s\S]*worldNormal\(mat3\(modelMatrix\), normal\)[\s\S]*#endif/);
    expect(GBUFFER_FRAG).toContain("vInk / 255.0");
  });

  it("tilts the dummy about its base: the base stays level, the head follows the lean", () => {
    const leaning = dummyParts({ ...pose, leanX: 0.3 });
    const base = leaning.find((p) => p.part === "base")!;
    const head = leaning.find((p) => p.part === "head")!;
    expect([base.tiltX, base.tiltZ, base.pos[1]]).toEqual([0, 0, 0.06]);
    // поворот вокруг +X на +0,3 рад уводит верх к +Z
    expect(head.pos[2]).toBeGreaterThan(0.3);
    expect(head.tiltX).toBeCloseTo(0.3, 9);
    const squashed = dummyParts({ ...pose, squash: 0.8 });
    expect(Math.max(...squashed.map((p) => p.pos[1] + p.scale[1] / 2))).toBeLessThan(1.8 * 0.8 + 0.12);
  });
});

describe("fx performance guards", () => {
  const gbuffer = { surface: new Texture(), depth: new DepthTexture(1, 1), invDepth: new Vector2(1, 0) };
  const time = { value: 0 };
  const glow = (x: number, y: number, z: number, halo: number, light: number) => ({ pos: { x, y, z }, color: FX_COLOR.fire, halo, light, intensity: 1, core: 0 });

  it("drops glows whose sphere is outside the view frustum, keeps those in view or around the camera", () => {
    const cam = new PerspectiveCamera(70, 16 / 9, 0.05, 160);
    cam.updateMatrixWorld();
    const kept = cullGlows([glow(0, 0, -6, 1.4, 5), glow(0, 0, 6, 1, 1.8), glow(0, 0, 0.5, 0, 5), glow(40, 0, -2, 0.5, 2), glow(0, 0, -3, 0, 0)], cam);
    expect(kept.map((g) => g.pos.z)).toEqual([-6, 0.5]);
    cam.rotation.y = Math.PI;
    cam.updateMatrixWorld();
    expect(cullGlows([glow(0, 0, -6, 1.4, 5), glow(0, 0, 6, 1, 1.8)], cam).map((g) => g.pos.z)).toEqual([6]);
  });

  it("thins bursts by preset and keeps the layer mix", () => {
    expect(BURST_SHARE).toEqual({ low: 0.5, medium: 0.75, high: 1 });
    const full = burstParticles("fireballBoom", O, O, 1, rng());
    const half = thinParticles(full, BURST_SHARE.low);
    expect([half.length, thinParticles(full, BURST_SHARE.medium).length, thinParticles(full, 1).length]).toEqual([40, 60, 80]);
    const lightShare = (ps: readonly { alpha: number }[]) => ps.filter((p) => p.alpha === 0).length / ps.length;
    expect(Math.abs(lightShare(half) - lightShare(full))).toBeLessThan(0.05);
  });

  it("keeps light-pass shaders free of pow(), culls glows behind the camera and discards quad corners first", () => {
    const glows = createGlowMeshes(gbuffer).mesh.material;
    const decals = createDecalMeshes(gbuffer, time).mesh.material;
    const pool = createParticlePool({ name: "t", maxCap: 4, cap: 4, gbuffer, time }).mesh.material;
    for (const m of [glows, decals, pool]) expect(m.vertexShader + m.fragmentShader.replace(/\/\/.*$/gm, "")).not.toMatch(/\bpow\s*\(/);
    expect(glows.vertexShader).toContain("if (c.z > R)");
    // луч — в фрагментном шейдере из точки квадрата, а не делением в вершинах
    expect([glows.vertexShader.includes("q / -q.z"), glows.fragmentShader.includes("vQ / -vQ.z")]).toEqual([false, true]);
    const body = pool.fragmentShader.slice(pool.fragmentShader.indexOf("void main()", pool.fragmentShader.indexOf("fxCompose")));
    expect(body.indexOf("if (r2 >= 1.0) discard;")).toBeGreaterThan(-1);
    expect(body.indexOf("if (r2 >= 1.0) discard;")).toBeLessThan(body.indexOf("fxVisibility("));
  });

  it("keeps dense fx over enemy ink to a tenth and light to a quarter, so a blast cannot flood the silhouette", () => {
    expect([ENEMY_LIGHT, ENEMY_DENSE]).toEqual([0.25, 0.1]);
    const pool = createParticlePool({ name: "t", maxCap: 4, cap: 4, gbuffer, time }).mesh.material;
    const walls = createFireWallMeshes(gbuffer, time).mesh.material;
    expect(pool.defines).toMatchObject({ FX_ENEMY_LIGHT: "0.25", FX_ENEMY_DENSE: "0.1" });
    for (const m of [pool, walls]) expect(m.fragmentShader).toContain("fxDense(vis)");
    // восемь перекрывающихся языков (альфа 0,7) над врагом: раньше ≈ 79 % заливки, теперь меньше половины
    expect([1 - (1 - 0.7 * ENEMY_LIGHT) ** 8 > 0.7, 1 - (1 - 0.7 * ENEMY_DENSE) ** 8 < 0.5]).toEqual([true, true]);
  });

  it("draws the fire wall as one sheet and switches its cheap noise with the preset", () => {
    const walls = createFireWallMeshes(gbuffer, time);
    expect(walls.mesh.geometry.getAttribute("position").count).toBe(4);
    walls.setCheap(true);
    expect("FX_CHEAP" in walls.mesh.material.defines).toBe(true);
    walls.setCheap(false);
    expect("FX_CHEAP" in walls.mesh.material.defines).toBe(false);
  });
});
