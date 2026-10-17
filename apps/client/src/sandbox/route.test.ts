import { describe, expect, it } from "vitest";
import type { Effect, EffectKind } from "../feel/effects";
import { createGuard, sinkOf } from "./route";

const ALL_KINDS: EffectKind[] = [
  "burst", "palm", "gesture", "sound", "trauma", "kick", "fov", "hitstop", "hitmarker", "number", "flash", "flinch", "indicator", "toast", "deny",
];

describe("sinkOf", () => {
  it("sends every effect kind to exactly the stage that executes it", () => {
    const by = (sink: string) => ALL_KINDS.filter((k) => sinkOf(k) === sink).sort();
    expect(by("hands")).toEqual(["gesture"]);
    expect(by("vfx")).toEqual(["burst", "flash", "flinch", "palm"]);
    expect(by("audio")).toEqual(["sound"]);
    expect(by("camera")).toEqual(["fov", "kick", "trauma"]);
    expect(by("hitstop")).toEqual(["hitstop"]);
    // ровно то, что исполняет combatHud.apply
    expect(by("hud")).toEqual(["deny", "hitmarker", "indicator", "number", "toast"]);
  });

  it("routes a fist cast in order: the gesture before the palm flash", () => {
    const cast: Effect[] = [
      { kind: "gesture", ability: "fireFists" },
      { kind: "palm", hand: "auto", element: "fire", preset: "flash" },
      { kind: "sound", id: "fireFist", pos: null, gain: 1 },
    ];
    expect(cast.map((e) => sinkOf(e.kind))).toEqual(["hands", "vfx", "audio"]);
  });
});

describe("createGuard", () => {
  it("returns the stage result, or the fallback when the stage throws, and keeps calling the stage", () => {
    const logged: string[] = [];
    const g = createGuard((stage) => logged.push(stage));
    expect(g.run("hud", () => 7, 0)).toBe(7);
    let calls = 0;
    const boom = (): number => {
      calls++;
      throw new Error("boom");
    };
    expect(g.run("audio", boom, -1)).toBe(-1);
    expect(g.run("audio", boom, -1)).toBe(-1);
    expect(calls).toBe(2);
    expect(g.run("audio", () => 3, -1)).toBe(3);
    expect(g.failures("audio")).toBe(2);
    expect(g.failures("hud")).toBe(0);
    expect(logged).toEqual(["audio"]);
  });

  it("logs the first failure of each stage once, whatever the error", () => {
    const logged: [string, unknown][] = [];
    const g = createGuard((stage, err) => logged.push([stage, err]));
    g.run("vfx", () => { throw "string error"; }, undefined);
    g.run("hud", () => { throw new TypeError("x"); }, undefined);
    g.run("vfx", () => { throw new Error("later"); }, undefined);
    expect(logged.map(([s]) => s)).toEqual(["vfx", "hud"]);
    expect(logged[0]![1]).toBe("string error");
  });

  it("survives a logger that throws", () => {
    const g = createGuard(() => {
      throw new Error("console gone");
    });
    expect(g.run("hands", () => { throw new Error("x"); }, 5)).toBe(5);
  });
});
