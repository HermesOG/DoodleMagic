import { describe, expect, it } from "vitest";
import { createMageUnit } from "@doodlemagic/sim";
import { cooldownFraction, formatDamage, heatFraction, hpBar, mergeNumbers, numberAnim, type FloatingNumber } from "./format";
import { DEFAULT_PREFS, parsePrefs } from "./prefs";

const pos = { x: 0, y: 1, z: 0 };
const dot = (amount: number) => ({ target: 2, amount, dot: true, air: false, pos });

describe("HUD formatting", () => {
  it("rounds damage, marks the air bonus, merges damage over time within 0.4 s, pops and fades", () => {
    expect([formatDamage(13.8, false), formatDamage(13.8, true), formatDamage(0.4, false)]).toEqual(["14", "14↑", "1"]);
    let list: FloatingNumber[] = [];
    for (const [amount, t] of [[3, 1.0], [3, 1.3], [3, 1.8]] as const) list = mergeNumbers(list, dot(amount), t);
    list = mergeNumbers(list, { ...dot(12), dot: false }, 1.85);
    expect(list.map((n) => n.amount)).toEqual([6, 3, 12]);
    const a = [numberAnim(0).scale, numberAnim(0.12).scale, numberAnim(0.8).dy, numberAnim(0.2).alpha, numberAnim(0.9).alpha];
    expect(a.map((v) => Number(v.toFixed(9)))).toEqual([1.4, 1, 0.6, 1, 0]);
  });

  it("reads cooldowns, heat and HP with the ⅔ regen notch; prefs fall back on garbage", () => {
    const u = createMageUnit(1, "fire", { pos, yaw: 0 });
    u.mage!.ready.q = 340;
    u.mage!.heat = 40;
    u.hp = 75;
    expect([cooldownFraction(u.mage!, "q", 100), cooldownFraction(u.mage!, "q", 400), heatFraction(u.mage!)]).toEqual([0.5, 0, 0.4]);
    expect(hpBar(u)).toEqual({ frac: 0.5, notch: 2 / 3, text: "75 / 150" });
    expect(parsePrefs('{"element":"earth","cameraMotion":0.5}')).toEqual({ element: "earth", cameraMotion: 0.5 });
    expect([parsePrefs(null), parsePrefs('{"element":"water","cameraMotion":7}')]).toEqual([DEFAULT_PREFS, { element: "fire", cameraMotion: 1 }]);
  });
});
