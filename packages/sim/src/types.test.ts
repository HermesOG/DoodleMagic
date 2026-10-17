import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT,
  MATERIALS,
  PLAYER_HEIGHT,
  PLAYER_STEP,
  TICK_DT,
  TICK_HZ,
  type ArenaData,
  type PlayerInput,
  type PlayerState,
} from "./types";

describe("contracts", () => {
  it("lists the arena materials", () => {
    expect(MATERIALS).toEqual(["stone", "floor", "roof", "grass", "edge", "gold"]);
  });

  it("keeps the movement constants consistent", () => {
    expect(TICK_DT * TICK_HZ).toBe(1);
    expect(EYE_HEIGHT).toBeLessThan(PLAYER_HEIGHT);
    // низкое укрытие 1 м нельзя перешагнуть
    expect(PLAYER_STEP).toBeLessThan(1);
  });

  it("describes plain data that survives JSON", () => {
    const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const arena: ArenaData = {
      name: "t",
      variant: "full",
      bounds: box,
      colliders: [{ box, noSight: true, tag: "x" }],
      volumes: [{ kind: "updraft", box, liftM: 6 }],
      render: [{ box, material: "gold" }],
      spawns: [{ pos: { x: 0, y: 0, z: 0 }, yaw: 1 }],
      pickups: [{ kind: "rune", pos: { x: 0, y: 0.5, z: 0 } }],
    };
    const input: PlayerInput = { moveX: 0, moveZ: 1, jump: false, yaw: 0, pitch: 0 };
    const state: PlayerState = {
      body: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, halfW: 0.4, height: 1.8, stepHeight: 0.55 },
      onGround: true,
      coyote: 0,
      jumpBuffer: 0,
      jumpHeld: false,
      yaw: 0,
      pitch: 0,
      landVel: 0,
    };
    for (const value of [arena, input, state]) expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
});
