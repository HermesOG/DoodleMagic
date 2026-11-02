import { describe, expect, it } from "vitest";
import { ABILITY_IDS, createMageUnit, createMatchState, type AbilityId, type MatchEvent } from "@doodlemagic/sim";
import type { Effect } from "./effects";
import { effectsFor } from "./eventMap";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 3;
const view = { localId: ME, state: createMatchState([createMageUnit(ME, "fire", { pos: V(), yaw: 0 }), createMageUnit(OTHER, "earth", { pos: V(6, 0, -8), yaw: 0.4 })]) };
const fx = (ev: MatchEvent): Effect[] => effectsFor(ev, view);
const cast = (unit: number, ability: AbilityId, pos = V(6, 1.6, -8)): MatchEvent => ({ type: "cast", unit, ability, slot: "q", pos, dir: V(0, 0, -1) });
const dash = (unit: number, phase: "start" | "end"): MatchEvent => ({ type: "dash", unit, phase, pos: V(6, 0.9, -8), dir: V(0.6, 0, -0.8) });

describe("effectsFor: other mages", () => {
  it("plays another mage's cast as one positional sound where it is cast — the same sound as my own cast", () => {
    for (const ability of ABILITY_IDS) {
      const at = V(6, 1.6, -8);
      const mineSound = fx(cast(ME, ability, V(0, 1.6, 0))).find((e) => e.kind === "sound");
      expect(mineSound).toMatchObject({ kind: "sound", pos: null });
      const id = mineSound?.kind === "sound" ? mineSound.id : null;
      expect(fx(cast(OTHER, ability, at))).toEqual([{ kind: "sound", id, pos: at, gain: 1 }]);
    }
  });

  it("blasts flame behind another mage's dash start, without touching my camera; nothing on its end", () => {
    expect(fx(dash(OTHER, "start"))).toEqual([{ kind: "burst", preset: "dashBlast", pos: V(6, 0.9, -8), dir: V(-0.6, 0, 0.8), scale: 1 }]);
    expect(fx(dash(OTHER, "end"))).toEqual([]);
  });

  it("keeps my own cast and dash as before", () => {
    expect(fx(cast(ME, "fireball", V(0, 1.6, 0)))).toEqual([
      { kind: "gesture", ability: "fireball" },
      { kind: "palm", hand: "both", element: "fire", preset: "charge" },
      { kind: "sound", id: "fireballCharge", pos: null, gain: 1 },
      { kind: "kick", pitchDeg: 1, yawDeg: 0, rollDeg: 0 },
    ]);
    expect(fx({ type: "dash", unit: ME, phase: "start", pos: V(), dir: V(1, 0, 0) })).toEqual([
      { kind: "fov", deg: 6, holdS: 0.2 },
      { kind: "kick", pitchDeg: 0, yawDeg: 0, rollDeg: -3 },
      { kind: "burst", preset: "dashBlast", pos: V(), dir: V(-1, 0, 0), scale: 1 },
    ]);
    expect(fx({ type: "dash", unit: ME, phase: "end", pos: V(), dir: V(1, 0, 0) })).toEqual([]);
  });
});
