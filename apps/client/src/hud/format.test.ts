import { describe, expect, it } from "vitest";
import { createMageUnit } from "@doodlemagic/sim";
import { cooldownFraction, formatDamage, heatFraction, hpBar, mergeNumbers, numberAnim, type FloatingNumber } from "./format";
import { DEFAULT_PREFS, parsePrefs } from "./prefs";

const pos = { x: 0, y: 1, z: 0 };
const dot = (amount: number) => ({ target: 2, amount, dot: true, air: false, pos });

describe("HUD formatting", () => {
  // горение бьёт раз в 0,5 с (Р10): его импульсы складываются в одну растущую цифру, прямой удар — отдельно
  it("rounds damage, marks the air bonus, stacks burn pulses 0.5 s apart into one number, pops and fades", () => {
    expect([formatDamage(13.8, false), formatDamage(13.8, true), formatDamage(0.4, false)]).toEqual(["14", "14↑", "1"]);
    let list: FloatingNumber[] = [];
    for (const [amount, t] of [[3, 1.0], [3, 1.3], [3, 1.8]] as const) list = mergeNumbers(list, dot(amount), t);
    list = mergeNumbers(list, { ...dot(12), dot: false }, 1.85);
    expect(list.map((n) => n.amount)).toEqual([9, 12]);
    const a = [numberAnim(0).scale, numberAnim(0.12).scale, numberAnim(0.8).dy, numberAnim(0.2).alpha, numberAnim(0.9).alpha];
    expect(a.map((v) => Number(v.toFixed(9)))).toEqual([1.4, 1, 0.6, 1, 0]);
  });

  // цель подбросило или она ушла патрулём между импульсами: цифра едет к новому импульсу, а не висит на старом месте
  it("starts a new number after a gap above 0.6 s and moves a merged number with its target", () => {
    const at = (y: number, target = 2) => ({ target, amount: 3, dot: true, air: false, pos: { x: 1, y, z: -4 } });
    const first = at(1);
    let list = mergeNumbers([], first, 1.0);
    list = mergeNumbers(list, at(3.5), 1.5);
    expect([list.length, list[0]!.amount, list[0]!.pos, list[0]!.born, list[0]!.updated]).toEqual([1, 6, { x: 1, y: 3.5, z: -4 }, 1.0, 1.5]);
    expect(first.pos).toEqual({ x: 1, y: 1, z: -4 });
    list = mergeNumbers(list, at(1), 2.15);
    expect(list.map((n) => n.amount)).toEqual([6, 3]);
    list = mergeNumbers(list, at(1, 3), 2.2);
    expect(list.map((n) => [n.target, n.amount])).toEqual([[2, 6], [2, 3], [3, 3]]);
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
