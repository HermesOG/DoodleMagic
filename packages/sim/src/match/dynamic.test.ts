import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { moveBody } from "../body";
import { groundBelow, lineOfSight, raycast } from "../raycast";
import type { Body, Collider } from "../types";
import { vec3 } from "../vec";
import { colliderAt, createWorld, isFree, overlapping, withDynamic, type World } from "../world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({ box: aabb(x0, y0, z0, x1, y1, z1) });
const FLOOR = col(-20, -1, -20, 20, 0, 20);
const base = createWorld([FLOOR]);
const body = (x: number, y: number, z: number, vy = 0): Body => ({ pos: vec3(x, y, z), vel: vec3(0, vy, 0), halfW: 0.4, height: 1.8, stepHeight: 0.55 });
/** Как в body.test: постоянная скорость по X и гравитация 20 м/с². */
function run(b: Body, w: World, ticks: number, vx: number, ground: boolean): boolean {
  for (let t = 0; t < ticks; t++) {
    b.vel.x = vx;
    b.vel.y -= 20 / 60;
    ground = moveBody(w, b, 1 / 60, ground).onGround;
  }
  return ground;
}

describe("dynamic colliders", () => {
  it("are numbered after the static ones and leave the static world alone", () => {
    const w = withDynamic(base, [col(2, 0, -1, 3, 2, 1)]);
    const probe = aabb(2.5, 0.5, 0, 2.6, 0.6, 0.1);
    expect([w.colliders === base.colliders, colliderAt(w, 1).box.min.x, overlapping(w, probe), isFree(base, probe)]).toEqual([true, 2, [1], true]);
  });

  it("stop a moving body, carry a landing one and let it step onto a low one", () => {
    const b = body(0, 0, 0);
    run(b, withDynamic(base, [col(2, 0, -5, 3, 3, 5)]), 60, 5, true);
    expect(b.pos.x).toBeCloseTo(2 - 0.4, 6);
    const w = withDynamic(base, [col(-1, 0, -1, 1, 2.5, 1), col(3, 0, -2, 6, 0.4, 2)]);
    const a = body(0, 3, 0, -5);
    expect([run(a, w, 60, 0, false), a.pos.y]).toEqual([true, 2.5]);
    const s = body(2, 0, 0);
    expect(run(s, w, 40, 4, true)).toBe(true);
    expect(s.pos.y).toBeCloseTo(0.4, 6);
  });

  it("give the nearest raycast hit across static and dynamic boxes; on a tie the static one wins", () => {
    const wall = col(5, 0, -1, 6, 3, 1);
    const hit = raycast(withDynamic(createWorld([FLOOR, wall]), [col(3, 0, -1, 4, 3, 1)]), vec3(0, 1, 0), vec3(1, 0, 0), 50);
    expect([hit?.collider, hit?.normal]).toEqual([2, { x: -1, y: 0, z: 0 }]);
    expect(hit?.dist).toBeCloseTo(3, 9);
    expect(raycast(withDynamic(createWorld([FLOOR, wall]), [wall]), vec3(0, 1, 0), vec3(1, 0, 0), 50)?.collider).toBe(1);
  });

  it("let a noSight box (a fire wall) block sight but not movement or shots", () => {
    const w = withDynamic(base, [{ box: aabb(3, 0, -5, 3.6, 2.5, 5), noSight: true }]);
    expect([lineOfSight(w, vec3(0, 1.6, 0), vec3(6, 1.6, 0)), raycast(w, vec3(0, 1, 0), vec3(1, 0, 0), 10, "shot"), isFree(w, aabb(3.1, 0.1, -0.2, 3.5, 1.9, 0.2))]).toEqual([false, null, true]);
  });

  it("carry ground and are hit outside the static grid too", () => {
    const w = withDynamic(base, [col(-1, 0, -1, 1, 2.5, 1)]);
    expect([groundBelow(w, vec3(0, 5, 0)), groundBelow(w, vec3(3, 5, 0))]).toEqual([2.5, 0]);
    const far = withDynamic(createWorld([col(-2, -1, -2, 2, 0, 2)]), [col(30, 0, -1, 31, 2, 1)]);
    expect(raycast(far, vec3(25, 1, 0), vec3(1, 0, 0), 10)?.dist).toBeCloseTo(5, 9);
    expect(raycast(far, vec3(0, 1, 0), vec3(1, 0, 0), 40)?.dist).toBeCloseTo(30, 9);
  });

  it("do not hold a body that is already inside a new one", () => {
    const b = body(0, 0, 0);
    run(b, withDynamic(base, [col(-1, 0, -1, 1, 2.5, 1)]), 30, 4, true);
    expect(b.pos.x).toBeGreaterThan(1.4);
  });
});
