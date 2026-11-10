import { describe, expect, it } from "vitest";
import { ELEMENTS } from "@doodlemagic/sim";
import { glyphSvg } from "./glyphs";

/** Значения атрибута name во всей разметке. */
const attrs = (svg: string, name: string): string[] => Array.from(svg.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g")), (m) => m[1]!);

describe("element glyphs", () => {
  it("one inline SVG per element: 24 × 24 grid, 1em by default, decorative", () => {
    for (const e of ELEMENTS) {
      const svg = glyphSvg(e);
      expect(svg.startsWith(`<svg class="gl gl-${e}" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">`)).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg.match(/<svg/g)).toHaveLength(1);
      expect(svg).toMatch(/<path /);
    }
  });

  it("paints only with currentColor: no colours of its own, no styles, scripts or links", () => {
    for (const e of ELEMENTS) {
      const svg = glyphSvg(e);
      expect(svg).toContain("currentColor");
      for (const v of [...attrs(svg, "fill"), ...attrs(svg, "stroke")]) expect(["currentColor", "none"]).toContain(v);
      expect(svg).not.toMatch(/#|rgb|hsl|style=|<script|\son\w+=|href/i);
    }
  });

  it("path data stays inside the 24 × 24 grid", () => {
    for (const e of ELEMENTS) {
      for (const d of attrs(glyphSvg(e), "d")) {
        expect(d).toMatch(/^[MLHVCAZ0-9. ]+$/);
        for (const n of d.match(/\d+(\.\d+)?/g) ?? []) expect(Number(n)).toBeLessThanOrEqual(24);
      }
    }
  });

  it("four different shapes; strokes are thick enough for 14 px (≥ 1.4 px)", () => {
    const shapes = ELEMENTS.map((e) => attrs(glyphSvg(e), "d").join(" "));
    expect(new Set(shapes).size).toBe(ELEMENTS.length);
    for (const e of ELEMENTS) for (const w of attrs(glyphSvg(e), "stroke-width")) expect((Number(w) / 24) * 14).toBeGreaterThanOrEqual(1.4);
  });
});
