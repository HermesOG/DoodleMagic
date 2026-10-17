import { describe, expect, it } from "vitest";
import { DepthTexture, PerspectiveCamera, Texture, Vector2, Vector3 } from "three";
import { INK, INK_COUNT, TONE } from "./palette";
import { OVERLAY_DEPTH_RANGE, STYLE_FRAG, createStyleMaterial, glslFloat, inverseDepth } from "./stylePass";

describe("inverse depth decode", () => {
  it("turns a stored depth into 1 / view distance as a − b·d, for the world and the overlay band", () => {
    const cam = new PerspectiveCamera(70, 16 / 9, 0.05, 160);
    cam.updateProjectionMatrix();
    for (const band of [1, OVERLAY_DEPTH_RANGE]) {
      const k = inverseDepth(cam.near, cam.far, band, new Vector2());
      for (const dist of [0.06, 0.3, 0.6, 2, 18, 75, 159]) {
        const ndc = new Vector3(0.3, -0.2, -dist).applyMatrix4(cam.projectionMatrix);
        const stored = ((ndc.z + 1) / 2) * band;
        expect((k.x - k.y * stored) * dist).toBeCloseTo(1, 6);
      }
    }
  });
});

describe("style material", () => {
  const m = createStyleMaterial(new Texture(), new DepthTexture(1, 1));

  it("gets the wash thresholds and the overlay band from the shared constants, as GLSL floats", () => {
    expect(m.defines).toMatchObject({
      TONE_MID: glslFloat(TONE.mid),
      TONE_LIGHT: glslFloat(TONE.light),
      TONE_SOFT: glslFloat(TONE.soft),
      TONE_JITTER: glslFloat(TONE.jitter),
      OVERLAY_BAND: glslFloat(OVERLAY_DEPTH_RANGE),
      INK_COUNT,
      INK_HANDS: INK.hands,
      INK_GRASS: INK.grass,
    });
    for (const name of ["TONE_MID", "TONE_LIGHT", "TONE_SOFT", "TONE_JITTER", "OVERLAY_BAND"]) expect(STYLE_FRAG).toContain(name);
  });

  it("reads the G-buffer with whole-texel fetches only", () => {
    expect(STYLE_FRAG).toContain("texelFetch");
    expect(STYLE_FRAG).not.toMatch(/\btexture\s*\(/);
  });

  it("writes floats with a decimal point", () => {
    expect(glslFloat(1)).toBe("1.0");
    expect(glslFloat(0.5)).toBe("0.5");
    expect(glslFloat(0.02)).toBe("0.02");
  });
});
