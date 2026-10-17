import { describe, expect, it } from "vitest";
import { cleanRoom } from "./config";

describe("cleanRoom", () => {
  it("uppercases and strips unsafe characters", () => {
    expect(cleanRoom("friends-1!<b>")).toBe("FRIENDS-1B");
  });

  it("limits the code to 32 characters", () => {
    expect(cleanRoom("a".repeat(40))).toBe("A".repeat(32));
  });

  it("falls back to FRIENDS", () => {
    expect(cleanRoom(null)).toBe("FRIENDS");
    expect(cleanRoom("!!!")).toBe("FRIENDS");
  });
});
