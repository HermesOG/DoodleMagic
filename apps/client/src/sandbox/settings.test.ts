import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("reads valid settings", () => {
    expect(parseSettings('{"sensitivity":1.5,"quality":"low","rawMouse":true}')).toEqual({ sensitivity: 1.5, quality: "low", rawMouse: true });
  });

  it("falls back on garbage", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"sensitivity":"x","quality":"ultra"}')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"sensitivity":99}').sensitivity).toBe(3);
  });

  // сырой ввод выключает ускорение ОС: на тачпаде взгляд с ним очень медленный, поэтому по умолчанию он выключен
  it("keeps raw mouse input off unless it was switched on", () => {
    expect(DEFAULT_SETTINGS.rawMouse).toBe(false);
    expect(parseSettings('{"sensitivity":1.5,"quality":"low"}').rawMouse).toBe(false);
    expect(parseSettings('{"rawMouse":"yes"}').rawMouse).toBe(false);
    expect(parseSettings('{"rawMouse":false}').rawMouse).toBe(false);
  });
});
