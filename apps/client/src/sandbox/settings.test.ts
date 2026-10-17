import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("reads valid settings", () => {
    expect(parseSettings('{"sensitivity":1.5,"quality":"low"}')).toEqual({ sensitivity: 1.5, quality: "low" });
  });

  it("falls back on garbage", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"sensitivity":"x","quality":"ultra"}')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"sensitivity":99}').sensitivity).toBe(3);
  });
});
