import { describe, expect, it } from "vitest";
import { createMageUnit } from "@doodlemagic/sim";
import {
  BITE, LMB_MERGE_S, NUMBER_PX, biteShake, biteTrail, cooldownFraction, formatDamage, freshBite, heatFraction, hpBar, mergeNumbers, numberAnim, numberPx, stepBite,
  type FloatingNumber,
} from "./format";
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

  // кулаки 4/с: 0,25 с между попаданиями — одна растущая цифра; прочие удары и чужая цель — своя цифра (L7)
  it("stacks LMB hits on the same target within 0.6 s into one popping number and grows the font 23 + min(11, dmg / 6) px", () => {
    const lmb = (amount: number, target = 2) => ({ target, amount, dot: false, air: false, pos, lmb: true });
    let list: FloatingNumber[] = [];
    for (const t of [1.0, 1.25, 1.5, 2.05]) list = mergeNumbers(list, lmb(15), t);
    expect(list.map((n) => [n.amount, n.born, n.updated])).toEqual([[60, 1.0, 2.05]]);
    // пауза больше 0,6 с — новая цифра; другая цель, удар способностью и горение рядом — не прибавляются к ЛКМ
    list = mergeNumbers(list, lmb(15), 2.75);
    list = mergeNumbers(list, lmb(15, 3), 2.8);
    list = mergeNumbers(list, { ...lmb(50), lmb: false }, 2.85);
    list = mergeNumbers(list, dot(3), 2.9);
    list = mergeNumbers(list, lmb(15), 2.95);
    expect(list.map((n) => [n.target, n.amount, n.lmb])).toEqual([[2, 60, true], [2, 30, true], [3, 15, true], [2, 50, false], [2, 3, false]]);
    expect(LMB_MERGE_S).toBe(0.6);
    expect([numberPx(12), numberPx(30), numberPx(66), numberPx(200), NUMBER_PX]).toEqual([25, 28, 34, 34, 23]);
  });

  it("bites the target HP bar: paper trail holds 0.3 s and drains in 0.25 s, the bar shakes ±2 px for 80 ms (L4)", () => {
    expect(BITE).toEqual({ holdS: 0.3, fadeS: 0.25, shakeS: 0.08, shakePx: 2 });
    let b = freshBite(1);
    expect(biteTrail(b, 5)).toBe(1);
    b = stepBite(b, 0.8, 10);
    expect([biteTrail(b, 10), biteTrail(b, 10.29), biteTrail(b, 10.425), biteTrail(b, 10.55)].map((v) => Number(v.toFixed(6)))).toEqual([1, 1, 0.9, 0.8]);
    // второй укус на сходе — след от того места, где он виден, и держится заново
    b = stepBite(b, 0.6, 10.425);
    expect([b.from, b.at, biteTrail(b, 10.7)].map((v) => Number(v.toFixed(6)))).toEqual([0.9, 10.425, 0.9]);
    // лечение и возрождение — без нового следа, след не ниже заливки
    const healed = stepBite(b, 0.95, 10.5);
    expect([healed.at, biteTrail(healed, 10.5), biteTrail(healed, 11)]).toEqual([10.425, 0.95, 0.95]);
    expect(stepBite(b, 0.6, 10.6)).toBe(b);
    expect([biteShake(0), biteShake(0.04), biteShake(0.08), biteShake(-0.01)].map((v) => Number(v.toFixed(6)))).toEqual([2, 1, 0, 0]);
    for (let t = 0; t < 0.08; t += 0.005) expect(Math.abs(biteShake(t))).toBeLessThanOrEqual(2);
  });

  it("reads cooldowns, heat and HP with the ⅔ regen notch; prefs fall back on garbage", () => {
    const u = createMageUnit(1, "fire", { pos, yaw: 0 });
    u.mage!.ready.q = 340;
    u.mage!.heat = 40;
    u.hp = 75;
    expect([cooldownFraction(u.mage!, "q", 100), cooldownFraction(u.mage!, "q", 400), heatFraction(u.mage!)]).toEqual([0.5, 0, 0.4]);
    expect(hpBar(u)).toEqual({ frac: 0.5, notch: 2 / 3, text: "75 / 150" });
    expect(parsePrefs('{"element":"earth","cameraMotion":0.5}')).toEqual({ element: "earth", cameraMotion: 0.5 });
    expect([parsePrefs(null), parsePrefs('{"element":"lava","cameraMotion":7}')]).toEqual([DEFAULT_PREFS, { element: "fire", cameraMotion: 1 }]);
  });
});
