import { describe, expect, it } from "vitest";
import { HITMARKER_S, hitmarkerAnim } from "./combatHud";

describe("hitmarker by tier (round3/01, H3)", () => {
  it("lasts 0.12 / 0.22 / 0.35 s; medium and large pop from ×1.4 to ×1, a kill is bigger", () => {
    expect([HITMARKER_S.small, HITMARKER_S.medium, HITMARKER_S.large]).toEqual([0.12, 0.22, 0.35]);
    expect(hitmarkerAnim(0.13, "small", false)).toBeNull();
    expect(hitmarkerAnim(0.13, "medium", false)).not.toBeNull();
    expect(hitmarkerAnim(0.3, "large", true)).not.toBeNull();
    expect(hitmarkerAnim(-0.01, "small", false)).toBeNull();
    expect(hitmarkerAnim(0, "medium", false)?.scale).toBeCloseTo(1.4);
    expect(hitmarkerAnim(0.1, "medium", false)?.scale).toBeCloseTo(1);
    expect(hitmarkerAnim(0, "small", false)?.scale).toBeCloseTo(1.18);
    expect(hitmarkerAnim(0, "large", true)?.scale).toBeCloseTo(1.45 * 1.4);
    expect(hitmarkerAnim(0.3, "large", false)!.alpha).toBeLessThan(0.5);
  });
});
