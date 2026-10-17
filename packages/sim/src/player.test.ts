import { describe, expect, it } from "vitest";
import { aabb } from "./aabb";
import { DEFAULT_MOVE, NO_INPUT, createPlayer, eyePosition, stepPlayer } from "./player";
import { TICK_DT, type Collider, type PlayerInput, type PlayerState, type Volume } from "./types";
import { lengthXZ, vec3 } from "./vec";
import { createWorld, type World } from "./world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({
  box: aabb(x0, y0, z0, x1, y1, z1),
});
const flat = createWorld([col(-100, -1, -100, 100, 0, 100)]);

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { ...NO_INPUT, ...over };
}

function settle(world: World = flat, x = 0, z = 0): PlayerState {
  let s = createPlayer(vec3(x, 0, z));
  for (let t = 0; t < 5; t++) s = stepPlayer(s, NO_INPUT, TICK_DT, world);
  return s;
}

function runTicks(s: PlayerState, inp: PlayerInput, ticks: number, world: World = flat): PlayerState {
  for (let t = 0; t < ticks; t++) s = stepPlayer(s, inp, TICK_DT, world);
  return s;
}

describe("stepPlayer on flat ground", () => {
  it("stands still and stays on the ground", () => {
    const s = runTicks(settle(), NO_INPUT, 120);
    expect(s.onGround).toBe(true);
    expect(s.body.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("does not change the state it was given", () => {
    const s = settle();
    const before = JSON.stringify(s);
    stepPlayer(s, input({ moveZ: 1, jump: true }), TICK_DT, flat);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("runs forward along -Z at 6.5 m/s and reaches full speed within 0.15 s", () => {
    const s = runTicks(settle(), input({ moveZ: 1 }), 9);
    expect(lengthXZ(s.body.vel)).toBeCloseTo(DEFAULT_MOVE.runSpeed, 6);
    expect(s.body.vel.z).toBeCloseTo(-6.5, 6);
    const later = runTicks(s, input({ moveZ: 1 }), 60);
    expect(later.body.pos.z).toBeLessThan(-6);
  });

  it("turns with yaw: yaw = +90° runs along -X, strafe right runs along +X at yaw 0", () => {
    expect(runTicks(settle(), input({ moveZ: 1, yaw: Math.PI / 2 }), 30).body.vel.x).toBeCloseTo(-6.5, 6);
    expect(runTicks(settle(), input({ moveX: 1 }), 30).body.vel.x).toBeCloseTo(6.5, 6);
  });

  it("normalizes diagonal input", () => {
    const s = runTicks(settle(), input({ moveX: 1, moveZ: 1 }), 30);
    expect(lengthXZ(s.body.vel)).toBeCloseTo(6.5, 6);
  });

  it("stops when the keys are released", () => {
    const running = runTicks(settle(), input({ moveZ: 1 }), 30);
    const stopped = runTicks(running, NO_INPUT, 12);
    expect(lengthXZ(stopped.body.vel)).toBe(0);
  });
});

describe("jumping", () => {
  it("peaks at 1.25 m", () => {
    let s = stepPlayer(settle(), input({ jump: true }), TICK_DT, flat);
    let apex = 0;
    for (let t = 0; t < 60; t++) {
      s = stepPlayer(s, input({ jump: true }), TICK_DT, flat);
      apex = Math.max(apex, s.body.pos.y);
    }
    expect(apex).toBeGreaterThan(1.24);
    expect(apex).toBeLessThanOrEqual(1.25 + 1e-9);
    expect(s.onGround).toBe(true);
  });

  it("jumps once per press: holding the key does not bounce", () => {
    let s = settle();
    let takeoffs = 0;
    for (let t = 0; t < 180; t++) {
      const before = s.onGround;
      s = stepPlayer(s, input({ jump: true }), TICK_DT, flat);
      if (before && s.body.vel.y > 0) takeoffs++;
    }
    expect(takeoffs).toBe(1);
  });

  it("has no double jump", () => {
    let s = stepPlayer(settle(), input({ jump: true }), TICK_DT, flat);
    s = runTicks(s, NO_INPUT, 10);
    const vyBefore = s.body.vel.y;
    s = stepPlayer(s, input({ jump: true }), TICK_DT, flat);
    expect(s.body.vel.y).toBeLessThan(vyBefore);
  });

  it("allows a jump shortly after walking off a ledge (coyote time) but not later", () => {
    const ledge = createWorld([col(-100, -11, -100, 100, -10, 100), col(-10, -1, -10, 0, 0, 10)]);
    const walkOff = (lateTicks: number): number => {
      let s = settle(ledge, -1, 0);
      while (s.onGround) s = stepPlayer(s, input({ moveX: 1 }), TICK_DT, ledge);
      s = runTicks(s, input({ moveX: 1 }), lateTicks, ledge);
      s = stepPlayer(s, input({ moveX: 1, jump: true }), TICK_DT, ledge);
      return s.body.vel.y;
    };
    expect(walkOff(3)).toBeGreaterThan(5);
    expect(walkOff(12)).toBeLessThan(0);
  });

  it("buffers a jump pressed just before landing", () => {
    const fallThenPress = (pressTicksBeforeLanding: number): boolean => {
      // падаем с 3 м и считаем, за сколько тиков долетим
      let probe = createPlayer(vec3(0, 3, 0));
      let ticks = 0;
      while (!probe.onGround) {
        probe = stepPlayer(probe, NO_INPUT, TICK_DT, flat);
        ticks++;
      }
      let s = createPlayer(vec3(0, 3, 0));
      for (let t = 0; t < ticks + 2; t++) {
        const press = t === ticks - pressTicksBeforeLanding;
        s = stepPlayer(s, input({ jump: press }), TICK_DT, flat);
      }
      return s.body.vel.y > 0;
    };
    expect(fallThenPress(4)).toBe(true);
    expect(fallThenPress(15)).toBe(false);
  });
});

describe("air control", () => {
  it("accelerates at 60 % of the ground rate in the air", () => {
    const ground = stepPlayer(settle(), input({ moveZ: 1 }), TICK_DT, flat);
    const air = stepPlayer(createPlayer(vec3(0, 5, 0)), input({ moveZ: 1 }), TICK_DT, flat);
    expect(lengthXZ(air.body.vel) / lengthXZ(ground.body.vel)).toBeCloseTo(0.6, 9);
  });

  it("keeps momentum in the air without input", () => {
    let s = runTicks(settle(), input({ moveZ: 1 }), 30);
    s = stepPlayer(s, input({ moveZ: 1, jump: true }), TICK_DT, flat);
    s = runTicks(s, NO_INPUT, 10);
    expect(s.onGround).toBe(false);
    expect(lengthXZ(s.body.vel)).toBeCloseTo(6.5, 6);
  });
});

describe("updraft", () => {
  it("lifts the player to the height of the stream", () => {
    const up: Volume = { kind: "updraft", box: aabb(-1, 0, -1, 1, 1, 1), liftM: 6 };
    const w = createWorld([col(-100, -1, -100, 100, 0, 100)], [up]);
    let s = settle(w);
    let apex = 0;
    for (let t = 0; t < 120; t++) {
      s = stepPlayer(s, NO_INPUT, TICK_DT, w);
      apex = Math.max(apex, s.body.pos.y);
    }
    expect(apex).toBeGreaterThan(5.9);
    expect(apex).toBeLessThan(6.2);
  });
});

describe("determinism", () => {
  const script = (t: number): PlayerInput => ({
    moveX: Math.round(Math.sin(t * 0.05)),
    moveZ: t % 200 < 150 ? 1 : -1,
    jump: t % 47 < 3,
    yaw: t * 0.013,
    pitch: Math.sin(t * 0.02) * 0.4,
  });
  const world = createWorld([
    col(-100, -1, -100, 100, 0, 100),
    col(3, 0, -20, 4, 1, 20),
    col(-6, 0, -6, -4, 0.4, 6),
    col(-15, 0, 5, 15, 3, 6),
  ]);

  // JSON печатает кратчайшую запись числа, которая читается обратно в тот же double,
  // поэтому равенство строк — это равенство всех чисел до бита (кроме знака нуля).
  it("gives bit-identical results for the same inputs, also after a JSON round trip", () => {
    let a = createPlayer(vec3(0, 0, 0));
    let b = createPlayer(vec3(0, 0, 0));
    for (let t = 0; t < 1200; t++) {
      a = stepPlayer(a, script(t), TICK_DT, world);
      b = stepPlayer(JSON.parse(JSON.stringify(b)) as PlayerState, script(t), TICK_DT, world);
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(eyePosition(a).y).toBeCloseTo(a.body.pos.y + 1.6, 12);
  });
});
