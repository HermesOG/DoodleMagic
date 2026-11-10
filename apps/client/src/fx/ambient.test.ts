import { InstancedMesh, Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { buildSedlovina } from "@doodlemagic/arena";
import { hex } from "../render/palette";
import { PRESET_ORDER } from "../render/quality";
import { styleShared } from "../render/stylePass";
import { AMBIENT, AMBIENT_COUNT, KIND, ambientKind, ambientSpots, createAmbient, dustSpeedMax, type AmbientSpots } from "./ambient";
import type { FxGBuffer } from "./fxShader";

const gbuffer = { depth: null, surface: null, invDepth: new Vector2() } as unknown as FxGBuffer;
const spots = ambientSpots(buildSedlovina("full"));
const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

describe("ambient particles (Р8)", () => {
  it("finds the rune and the four updrafts of the Sedlovina", () => {
    expect(spots.rune).toStrictEqual({ x: 0, y: 0.5, z: 0 });
    expect(spots.updrafts).toHaveLength(4);
    for (const u of spots.updrafts) expect(u.lift).toBeGreaterThan(5);
  });

  it("is one InstancedMesh sized by the preset (48 / 96 / 160): the preset changes only the count", () => {
    const a = createAmbient(gbuffer, spots, "low");
    expect(a.mesh).toBeInstanceOf(InstancedMesh);
    expect(a.mesh.frustumCulled).toBe(false);
    expect(a.mesh.count).toBe(48);
    const before = a.mesh.geometry.getAttribute("aA");
    for (const p of PRESET_ORDER) {
      a.setPreset(p);
      expect(a.mesh.count).toBe(AMBIENT_COUNT[p]);
    }
    expect(AMBIENT_COUNT).toStrictEqual({ low: 48, medium: 96, high: 160 });
    expect(a.mesh.geometry.getAttribute("aA")).toBe(before);
  });

  it("moves on the shared style time in the vertex shader; above the enemy it is dense × 0.1", () => {
    const m = createAmbient(gbuffer, spots, "high").mesh.material as import("three").ShaderMaterial;
    expect(m.uniforms.uTime).toBe(styleShared.time);
    expect(m.vertexShader).toContain("uTime");
    expect(m.fragmentShader).toContain("fxDense(vis)");
  });

  it("keeps sparks and strokes in every preset's share, and turns them into dust without a rune or updrafts", () => {
    for (const p of PRESET_ORDER) {
      const kinds = Array.from({ length: AMBIENT_COUNT[p] }, (_, i) => ambientKind(i, spots));
      const n = (k: number) => kinds.filter((x) => x === k).length;
      expect(n(KIND.spark)).toBeGreaterThanOrEqual(4);
      expect(n(KIND.stroke)).toBeGreaterThanOrEqual(spots.updrafts.length);
      expect(n(KIND.dust)).toBeGreaterThan(kinds.length / 2);
    }
    const bare: AmbientSpots = { rune: null, updrafts: [] };
    expect(Array.from({ length: 160 }, (_, i) => ambientKind(i, bare)).every((k) => k === KIND.dust)).toBe(true);
  });

  it("draws light dust ≤ 4 cm slower than 0.5 m/s, never closer than 3 m; gold sparks #E8C66A; white strokes; nothing dark", () => {
    expect(AMBIENT.dust.size).toBeLessThanOrEqual(0.04);
    expect(dustSpeedMax()).toBeLessThan(0.5);
    expect(AMBIENT.dust.near).toBeGreaterThanOrEqual(3);
    expect(AMBIENT.spark.color).toStrictEqual(hex(0xe8c66a));
    // без тёмного пепла: все цвета светлые
    for (const c of [AMBIENT.dust.color, AMBIENT.spark.color, AMBIENT.stroke.color]) expect(lum(c)).toBeGreaterThan(0.7);
  });
});
