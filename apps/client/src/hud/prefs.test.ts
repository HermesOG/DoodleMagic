import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, parsePrefs } from "./prefs";

describe("combat prefs", () => {
  it("keep any of the four elements and fall back to Fire on garbage", () => {
    expect(parsePrefs('{"element":"air","cameraMotion":0.25}')).toEqual({ element: "air", cameraMotion: 0.25 });
    expect(parsePrefs('{"element":"water"}')).toEqual({ element: "water", cameraMotion: 1 });
    expect(parsePrefs('{"element":"earth"}').element).toBe("earth");
    for (const raw of ['{"element":"lava"}', '{"element":7}', '{"element":"Water"}', "{", "[]", null]) expect(parsePrefs(raw).element, String(raw)).toBe(DEFAULT_PREFS.element);
    expect(DEFAULT_PREFS.element).toBe("fire");
  });
});
