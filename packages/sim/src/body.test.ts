import { describe, expect, it } from "vitest";
import { aabb } from "./aabb";
import { bodyBox, moveBody } from "./body";
import type { Body, Collider } from "./types";
import { vec3 } from "./vec";
import { createWorld, isFree } from "./world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({
  box: aabb(x0, y0, z0, x1, y1, z1),
});
const FLOOR = col(-50, -1, -50, 50, 0, 50);
const DT = 1 / 60;

function body(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): Body {
  return { pos: vec3(x, y, z), vel: vec3(vx, vy, vz), halfW: 0.4, height: 1.8, stepHeight: 0.55 };
}

/** Гоняет тело n тиков с постоянной горизонтальной скоростью и гравитацией 20 м/с². */
function run(b: Body, w: ReturnType<typeof createWorld>, ticks: number, vx: number, vz: number): boolean {
  let ground = false;
  for (let t = 0; t < ticks; t++) {
    b.vel.x = vx;
    b.vel.z = vz;
    b.vel.y -= 20 * DT;
    ground = moveBody(w, b, DT, ground).onGround;
  }
  return ground;
}

describe("moveBody", () => {
  it("falls and lands on the floor", () => {
    const w = createWorld([FLOOR]);
    const b = body(0, 2, 0, 0, -6, 0);
    let res = moveBody(w, b, DT, false);
    for (let t = 0; t < 60 && !res.onGround; t++) {
      b.vel.y -= 20 * DT;
      res = moveBody(w, b, DT, false);
    }
    expect(res.onGround).toBe(true);
    expect(res.landVel).toBeLessThan(-6);
    expect(b.pos.y).toBe(0);
    expect(b.vel.y).toBe(0);
  });

  it("stops at a wall and keeps sliding along it", () => {
    const w = createWorld([FLOOR, col(2, 0, -10, 3, 3, 10)]);
    const b = body(0, 0, 0);
    run(b, w, 60, 5, 3);
    expect(b.pos.x).toBeCloseTo(2 - 0.4, 6);
    expect(b.pos.z).toBeCloseTo(3, 1);
    expect(isFree(w, bodyBox(b))).toBe(true);
  });

  it("does not tunnel through a thin wall at high speed", () => {
    const w = createWorld([FLOOR, col(3, 0, -5, 3.1, 3, 5)]);
    const b = body(0, 0, 0);
    run(b, w, 10, 60, 0);
    expect(b.pos.x).toBeLessThanOrEqual(3 - 0.4 + 1e-9);
  });

  it("steps up a 0.4 m step but not a 0.6 m one", () => {
    const low = createWorld([FLOOR, col(1, 0, -5, 10, 0.4, 5)]);
    const a = body(0, 0, 0);
    expect(run(a, low, 60, 4, 0)).toBe(true);
    expect(a.pos.y).toBeCloseTo(0.4, 6);
    expect(a.pos.x).toBeGreaterThan(3);

    const high = createWorld([FLOOR, col(1, 0, -5, 10, 0.6, 5)]);
    const b = body(0, 0, 0);
    run(b, high, 60, 4, 0);
    expect(b.pos.y).toBe(0);
    expect(b.pos.x).toBeCloseTo(1 - 0.4, 6);
  });

  it("steps up a riser of exactly stepHeight (0.55 m) but not one of 0.56 m", () => {
    const exact = createWorld([FLOOR, col(1, 0, -5, 10, 0.55, 5)]);
    const a = body(0, 0, 0);
    expect(run(a, exact, 60, 4, 0)).toBe(true);
    expect(a.pos.y).toBe(0.55);
    expect(a.pos.x).toBeGreaterThan(3);

    const tall = createWorld([FLOOR, col(1, 0, -5, 10, 0.56, 5)]);
    const b = body(0, 0, 0);
    expect(run(b, tall, 60, 4, 0)).toBe(true);
    expect(b.pos.y).toBe(0);
    expect(b.pos.x).toBeCloseTo(1 - 0.4, 6);
  });

  it("does not step up while airborne", () => {
    const w = createWorld([FLOOR, col(1, 0, -5, 10, 0.4, 5)]);
    const b = body(0, 0.1, 0, 4, 0, 0);
    const res = moveBody(w, b, 0.2, false);
    expect(res.stepped).toBe(false);
    expect(b.pos.x).toBeCloseTo(1 - 0.4, 6);
  });

  it("stays on the ground walking down stairs and falls off a high ledge", () => {
    const steps: Collider[] = [FLOOR];
    for (let i = 0; i < 5; i++) steps.push(col(i, 0, -5, i + 1, 2 - 0.4 * i, 5));
    const w = createWorld(steps);
    const b = body(0.5, 2, 0);
    let ground = true;
    let airborneTicks = 0;
    for (let t = 0; t < 90; t++) {
      b.vel.x = 4;
      b.vel.y -= 20 * DT;
      ground = moveBody(w, b, DT, ground).onGround;
      if (!ground) airborneTicks++;
    }
    expect(b.pos.x).toBeGreaterThan(5);
    expect(b.pos.y).toBe(0);
    expect(airborneTicks).toBe(0);

    const ledge = createWorld([FLOOR, col(-5, 0, -5, 1, 2, 5)]);
    const c = body(0, 2, 0);
    let g = true;
    let wasAirborne = false;
    for (let t = 0; t < 60; t++) {
      c.vel.x = 4;
      c.vel.y -= 20 * DT;
      g = moveBody(ledge, c, DT, g).onGround;
      if (!g) wasAirborne = true;
    }
    expect(wasAirborne).toBe(true);
    expect(c.pos.y).toBe(0);
  });

  it("stops upward motion at a ceiling", () => {
    const w = createWorld([FLOOR, col(-5, 2.5, -5, 5, 3, 5)]);
    const b = body(0, 0, 0, 0, 8, 0);
    const res = moveBody(w, b, 0.2, false);
    expect(res.hitCeiling).toBe(true);
    expect(b.pos.y).toBeCloseTo(2.5 - 1.8, 9);
    expect(b.vel.y).toBe(0);
  });

  it("stops in a corner on both axes", () => {
    const w = createWorld([FLOOR, col(2, 0, -10, 3, 3, 10), col(-10, 0, 2, 10, 3, 3)]);
    const b = body(0, 0, 0);
    run(b, w, 60, 4, 4);
    expect(b.pos.x).toBeCloseTo(1.6, 6);
    expect(b.pos.z).toBeCloseTo(1.6, 6);
  });

  it("can walk out of a box it is stuck in", () => {
    const w = createWorld([FLOOR, col(-1, 0, -1, 1, 3, 1)]);
    const b = body(0.5, 0, 0);
    run(b, w, 60, 4, 0);
    expect(b.pos.x).toBeGreaterThan(1.4);
    expect(isFree(w, bodyBox(b))).toBe(true);
  });
});
