import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("reads valid settings", () => {
    expect(parseSettings('{"sensitivity":1.5,"quality":"low","rawMouse":true}')).toEqual({ ...DEFAULT_SETTINGS, sensitivity: 1.5, quality: "low", rawMouse: true });
    expect(parseSettings('{"sfxVolume":0.3,"musicOn":false,"musicVolume":0.8}')).toEqual({ ...DEFAULT_SETTINGS, sfxVolume: 0.3, musicOn: false, musicVolume: 0.8 });
  });

  // Р8: громкость звука 0,7, музыка включена, громкость музыки 0,5; доли прижаты к [0; 1]
  it("defaults sound and music volume, clamps them to 0…1 and keeps music on unless switched off", () => {
    expect([DEFAULT_SETTINGS.sfxVolume, DEFAULT_SETTINGS.musicOn, DEFAULT_SETTINGS.musicVolume]).toEqual([0.7, true, 0.5]);
    const s = parseSettings('{"sfxVolume":3,"musicVolume":-1,"musicOn":"no"}');
    expect([s.sfxVolume, s.musicVolume, s.musicOn]).toEqual([1, 0, true]);
    const junk = parseSettings('{"sfxVolume":"x","musicVolume":null}');
    expect([junk.sfxVolume, junk.musicVolume]).toEqual([0.7, 0.5]);
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
