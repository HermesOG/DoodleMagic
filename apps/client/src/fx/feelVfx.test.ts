import { describe, expect, it } from "vitest";
import { FLASH_S, hitFreeze } from "./vfx";

describe("feel pass, part 2 (vfx)", () => {
  it("freezes the target by tier: fist 0, stone 30 ms, ability 60 ms; flash 60 / 100 / 130 ms (H2)", () => {
    expect(hitFreeze(0.1, "fire")).toEqual({ tier: "small", freezeS: 0, flashS: 0.06 });
    expect(hitFreeze(0.1, "earth")).toEqual({ tier: "small", freezeS: 0.03, flashS: 0.06 });
    expect(hitFreeze(0.2, "fire")).toEqual({ tier: "medium", freezeS: 0.06, flashS: 0.1 });
    expect(hitFreeze(1, null).freezeS).toBeCloseTo(0.09);
    expect([FLASH_S.small, FLASH_S.medium, FLASH_S.large]).toEqual([0.06, 0.1, 0.13]);
  });
});
