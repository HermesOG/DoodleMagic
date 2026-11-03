import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector2 } from "three";
import { NOBODY, createMageUnit, createMatchState, type MatchState, type Projectile, type Unit, type Vec3, type Zone } from "@doodlemagic/sim";
import type { ElementVfxFrame } from "./elementVfx";
import type { FxGBuffer } from "./fxShader";
import type { ParticleSpec } from "./particleKit";
import { ARC_SEGMENTS, RATE, ROPE_SEGMENTS, arcPoints, createWaterVfx, ropePoints, springPool, wardBrightness, wardShown, waterRopes } from "./waterVfx";

const V = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const ME = 1;
const FOE = 2;
const close = (a: Vec3, b: Vec3) => expect([a.x, a.y, a.z].map((v, i) => Math.abs(v - [b.x, b.y, b.z][i]!) < 1e-9)).toEqual([true, true, true]);

describe("rope and arc geometry", () => {
  it("a rope starts at the hand and ends at the projectile; the wave stays inside its amplitude", () => {
    const from = V(0.3, 1.3, -0.4);
    const to = V(2, 1.5, -9);
    const pts = ropePoints(from, to, ROPE_SEGMENTS, 0.14, 1.3, 0.2);
    expect(pts.length).toBe(ROPE_SEGMENTS + 1);
    close(pts[0]!, from);
    close(pts[ROPE_SEGMENTS]!, to);
    for (let i = 0; i <= ROPE_SEGMENTS; i++) {
      const t = i / ROPE_SEGMENTS;
      const line = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
      expect(Math.hypot(pts[i]!.x - line.x, pts[i]!.y - line.y, pts[i]!.z - line.z)).toBeLessThanOrEqual(Math.hypot(0.14, 0.2) + 1e-9);
    }
    // натянутый — прямой
    for (const p of ropePoints(from, to, 4, 0, 0)) expect(Math.abs((p.x - from.x) * (to.z - from.z) - (p.z - from.z) * (to.x - from.x))).toBeLessThan(1e-9);
  });

  it("the whip's arc runs from the palm to the point and bows upward", () => {
    const pts = arcPoints(V(0.3, 1.3, 0), V(0, 1.3, -12), ARC_SEGMENTS);
    close(pts[0]!, V(0.3, 1.3, 0));
    close(pts[ARC_SEGMENTS]!, V(0, 1.3, -12));
    expect(pts[ARC_SEGMENTS / 2]!.y).toBeGreaterThan(1.3 + 0.5);
  });

  it("ropes: the grab in flight from its owner's hand to the projectile, the tow from Water's hand to the target's middle", () => {
    const water = createMageUnit(FOE, "water", { pos: V(0, 0, -10), yaw: Math.PI });
    const target = createMageUnit(ME, "fire", { pos: V(0, 0, -4), yaw: 0 });
    target.tow = { x: 0, z: -8.5, speed: 20, endTick: 40, by: FOE };
    const grab: Projectile = { id: 9, owner: FOE, ability: "waterGrab", pos: V(0, 1.5, -6), vel: V(0, 0, 28), bornTick: 10, endTick: 42, power: 25 };
    const fire: Projectile = { ...grab, id: 10, ability: "fireball" };
    const hands = new Map([[FOE, V(0.4, 1.2, -9.6)]]);
    const ropes = waterRopes(
      [{ pr: grab, pos: grab.pos }, { pr: fire, pos: fire.pos }],
      [{ id: FOE, pos: water.move.body.pos, u: water }, { id: ME, pos: target.move.body.pos, u: target }],
      22,
      (id) => hands.get(id) ?? null,
    );
    expect(ropes.length).toBe(2);
    expect(ropes[0]).toMatchObject({ key: 9, from: V(0.4, 1.2, -9.6), to: V(0, 1.5, -6), taut: false });
    expect(ropes[0]!.ageS).toBeCloseTo(0.2);
    expect(ropes[1]).toMatchObject({ from: V(0.4, 1.2, -9.6), taut: true });
    close(ropes[1]!.to, V(0, target.move.body.height / 2, -4));
    // руки не видно — каната нет
    expect(waterRopes([{ pr: grab, pos: grab.pos }], [], 22, () => null)).toEqual([]);
  });
});

describe("ward disc and spring pool", () => {
  it("the disc gets brighter with what it absorbed, up to the Answer's cap", () => {
    const b = [0, 10, 30, 60, 120].map(wardBrightness);
    expect(b[0]).toBe(0);
    for (let i = 1; i < 4; i++) expect(b[i]!).toBeGreaterThan(b[i - 1]!);
    expect([b[3], b[4]]).toEqual([1, 1]);
  });

  it("the disc shows only while the ward stands and Water lives", () => {
    const u: Unit = createMageUnit(ME, "water", { pos: V(), yaw: 0 });
    expect(wardShown(u, 5)).toBe(false);
    u.mage!.ward = { endTick: 60, absorbed: 0 };
    expect([wardShown(u, 5), wardShown(u, 60)]).toEqual([true, false]);
    u.alive = false;
    expect(wardShown(u, 5)).toBe(false);
  });

  it("the pool spreads from 0 to its full radius over the telegraph, fades at the end, and is dark-rimmed for the enemy", () => {
    const z: Zone = { id: 3, owner: FOE, kind: "spring", ability: "spring", shape: { type: "disc", center: V(1, 0, 2), radius: 4 }, bornTick: 100, armTick: 124, endTick: 484, rehit: [] };
    expect(springPool(z, 99, ME)).toBeNull();
    const s = [100, 106, 112, 124, 300].map((t) => springPool(z, t, ME)!.spread);
    for (let i = 1; i < 4; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
    expect([s[3], s[4]]).toEqual([1, 1]);
    expect(springPool(z, 300, ME)).toMatchObject({ type: 2, radius: 4, intensity: 1, enemy: true });
    expect(springPool(z, 475, ME)!.intensity).toBeLessThan(1);
    expect(springPool(z, 484, ME)).toBeNull();
    expect([springPool(z, 300, FOE)!.enemy, springPool(z, 300, NOBODY)!.enemy]).toEqual([false, false]);
  });
});

describe("createWaterVfx: one light-pass mesh, particles through the shared pool", () => {
  const gbuffer = { depth: null, surface: null, invDepth: new Vector2() } as unknown as FxGBuffer;
  const camera = new PerspectiveCamera(75, 16 / 9, 0.05, 200);
  camera.position.set(0, 1.6, 0);
  const frame = (s: MatchState, nowS: number, emitted: ParticleSpec[]): ElementVfxFrame => ({
    prev: s,
    cur: s,
    alpha: 0,
    tick: s.tick,
    nowS,
    dt: 1 / 60,
    camera,
    eye: V(0, 1.6, 0),
    localId: ME,
    units: s.units.map((u) => ({ id: u.id, pos: u.move.body.pos, u })),
    mages: [],
    palmWorld: (h) => (h === "left" ? V(-0.3, 1.3, -0.4) : V(0.3, 1.3, -0.4)),
    emit: (specs) => emitted.push(...specs),
    glow: () => {},
    decal: () => {},
  });

  it("draws the ward ring, a foreign disc, the pool and the rope in one instanced mesh; bubbles ≤ 20/s, drips ≤ 6/s", () => {
    const vfx = createWaterVfx({ gbuffer, time: { value: 0 } });
    expect(vfx.world).toBeNull();
    expect(vfx.light).not.toBeNull();
    const s = createMatchState([createMageUnit(ME, "water", { pos: V(), yaw: 0 }), createMageUnit(FOE, "water", { pos: V(0, 0, -10), yaw: Math.PI })]);
    s.tick = 200;
    s.units[0]!.mage!.ward = { endTick: 230, absorbed: 20 };
    s.units[1]!.mage!.ward = { endTick: 230, absorbed: 0 };
    s.units[1]!.status.wetUntil = 400;
    s.zones.push({ id: 5, owner: ME, kind: "spring", ability: "spring", shape: { type: "disc", center: V(0, 0, -5), radius: 4 }, bornTick: 100, armTick: 124, endTick: 484, rehit: [] });
    s.projectiles.push({ id: 9, owner: ME, ability: "waterGrab", pos: V(0, 1.5, -6), vel: V(0, 0, -28), bornTick: 190, endTick: 222, power: 25 });
    const emitted: ParticleSpec[] = [];
    for (let i = 0; i < 60; i++) vfx.sync(frame(s, 5 + i / 60, emitted));
    const mesh = vfx.light as unknown as { count: number; visible: boolean; isInstancedMesh: boolean };
    expect(mesh.isInstancedMesh).toBe(true);
    // 2 диска + лужа + канат из ROPE_SEGMENTS отрезков
    expect(mesh.count).toBe(3 + ROPE_SEGMENTS);
    expect(mesh.visible).toBe(true);
    const foam = emitted.filter((p) => p.gravity < 0).length;
    const drops = emitted.filter((p) => p.gravity > 0).length;
    expect(foam).toBeLessThanOrEqual(20);
    expect(foam).toBeGreaterThanOrEqual(RATE.bubbles - 2);
    expect(drops).toBeLessThanOrEqual(6);
    vfx.dispose();
  });

  it("hides the disc of a Water that died under it and draws nothing when nothing is up", () => {
    const vfx = createWaterVfx({ gbuffer, time: { value: 0 } });
    const s = createMatchState([createMageUnit(ME, "water", { pos: V(), yaw: 0 })]);
    s.tick = 200;
    s.units[0]!.mage!.ward = { endTick: 230, absorbed: 20 };
    s.units[0]!.alive = false;
    vfx.sync(frame(s, 1, []));
    expect((vfx.light as unknown as { count: number }).count).toBe(0);
    vfx.dispose();
  });

  it("a whip arc from my palm fades within its time and sprays once", () => {
    const vfx = createWaterVfx({ gbuffer, time: { value: 0 } });
    const s = createMatchState([createMageUnit(ME, "water", { pos: V(), yaw: 0 })]);
    const emitted: ParticleSpec[] = [];
    // конец дуги в 12 м, dir — назад к моим глазам
    vfx.apply?.({ kind: "burst", preset: "whipArc", pos: V(0, 1.6, -12), dir: V(0, 0, 12), scale: 1 }, 2);
    vfx.sync(frame(s, 2.01, emitted));
    expect((vfx.light as unknown as { count: number }).count).toBe(ARC_SEGMENTS);
    vfx.sync(frame(s, 2.05, emitted));
    expect(emitted.length).toBe(14);
    vfx.sync(frame(s, 2.3, emitted));
    expect((vfx.light as unknown as { count: number }).count).toBe(0);
    vfx.dispose();
  });
});
