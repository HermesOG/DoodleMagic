import { describe, expect, it } from "vitest";
import { DepthTexture, PerspectiveCamera, Texture, Vector2, Vector3, type Vector4 } from "three";
import { ELEMENTS } from "@doodlemagic/sim";
import { BAND_TINT, INK, INK_BY_ID, INK_COUNT, INK_STYLE, SKY, SLEEVE_WASH, TONE } from "./palette";
import {
  DAY_DIM,
  FOG,
  GORGE,
  OVERLAY_DEPTH_RANGE,
  STYLE_FRAG,
  createStyleMaterial,
  glslFloat,
  inverseDepth,
  setSleeveElement,
  styleShared,
} from "./stylePass";

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
  const u = m.uniforms;

  it("gets the wash thresholds, the overlay band, the haze and the gorge from the shared constants, as GLSL floats", () => {
    expect(m.defines).toMatchObject({
      TONE_MID: glslFloat(TONE.mid),
      TONE_LIGHT: glslFloat(TONE.light),
      TONE_SOFT: glslFloat(TONE.soft),
      TONE_JITTER: glslFloat(TONE.jitter),
      OVERLAY_BAND: glslFloat(OVERLAY_DEPTH_RANGE),
      FOG_MAX: glslFloat(FOG.max),
      DAY_DIM: glslFloat(DAY_DIM),
      GORGE_EDGE: glslFloat(GORGE.edge),
      GORGE_SWAY: glslFloat(GORGE.sway),
      GORGE_FLOOR: glslFloat(GORGE.floor),
      INK_COUNT,
      INK_HANDS: INK.hands,
      INK_SLEEVE: INK.sleeve,
      INK_GRASS: INK.grass,
    });
    for (const name of Object.keys(m.defines!)) expect(STYLE_FRAG, name).toContain(name);
    expect([FOG.near, FOG.far, FOG.max, DAY_DIM, GORGE.sway]).toEqual([22, 90, 0.7, 0.12, 1.5]);
    expect(u.uFog!.value.toArray()).toEqual([22, 90]);
  });

  it("reads the G-buffer with whole-texel fetches only, 10 per pixel (budget 13)", () => {
    expect(STYLE_FRAG).not.toMatch(/\btexture\s*\(/);
    const fetches = (src: string): number => src.match(/texelFetch\s*\(/g)?.length ?? 0;
    // центр — две текстуры, крест — те же две в цикле по четырём соседям; других выборок нет
    const cross = /for \(int i = 0; i < 4; i\+\+\) \{\n {4}ivec2 want[\s\S]*?\n {2}\}\n/.exec(STYLE_FRAG)?.[0] ?? "";
    expect(fetches(cross)).toBe(2);
    expect(fetches(STYLE_FRAG) - fetches(cross)).toBe(2);
    expect(2 + 4 * fetches(cross)).toBe(10);
  });

  it("feeds the sky, haze and gorge colours and the tone temperature from the palette", () => {
    const rgb = (v: Vector3): number[] => v.toArray();
    expect(rgb(u.uSkyZenith!.value)).toEqual([...SKY.zenith]);
    expect(rgb(u.uSkyHorizon!.value)).toEqual([...SKY.horizon]);
    expect(rgb(u.uHaze!.value)).toEqual([...SKY.haze]);
    expect(rgb(u.uGorgeTop!.value)).toEqual([...SKY.gorgeTop]);
    expect(rgb(u.uGorgeDeep!.value)).toEqual([...SKY.gorgeDeep]);
    expect((u.uBandTint!.value as Vector3[]).map(rgb)).toEqual(BAND_TINT.map((t) => [...t]));
    const bands = u.uInkBands!.value as Vector4[];
    expect(bands).toHaveLength(INK_COUNT);
    expect(bands[INK.stone]!.toArray()).toEqual([...INK_STYLE.stone.bands, 1]);
    expect(bands[INK.floor]!.w).toBe(0);
    const sun = u.uSunAzimuth!.value as Vector2;
    expect(sun.length()).toBeCloseTo(1, 9);
  });

  it("shares time, day dimming and the sleeve wash between every style material", () => {
    const other = createStyleMaterial(new Texture(), new DepthTexture(1, 1));
    expect(u.uTime).toBe(styleShared.time);
    expect(u.uDayDim).toBe(styleShared.dayDim);
    expect(other.uniforms.uTime).toBe(styleShared.time);
    const washes = u.uInkWash!.value as Vector3[];
    expect(washes).toHaveLength(INK_COUNT);
    expect(washes[INK.sleeve]).toBe(styleShared.sleeveWash.value);
    expect((other.uniforms.uInkWash!.value as Vector3[])[INK.sleeve]).toBe(styleShared.sleeveWash.value);
    // остальные чернила — свои копии: правка одной не трогает другие материалы
    expect(washes[INK.stone]).not.toBe((other.uniforms.uInkWash!.value as Vector3[])[INK.stone]);
    expect(INK_BY_ID[INK.sleeve]).toBe("sleeve");
  });

  it("switches the sleeve wash by element in place", () => {
    const v = styleShared.sleeveWash.value;
    for (const el of ELEMENTS) {
      setSleeveElement(el);
      expect(styleShared.sleeveWash.value).toBe(v);
      expect(v.toArray()).toEqual([...SLEEVE_WASH[el]]);
    }
    setSleeveElement("fire");
  });

  it("writes floats with a decimal point", () => {
    expect(glslFloat(1)).toBe("1.0");
    expect(glslFloat(0.5)).toBe("0.5");
    expect(glslFloat(0.02)).toBe("0.02");
    expect(glslFloat(-14)).toBe("-14.0");
  });
});
