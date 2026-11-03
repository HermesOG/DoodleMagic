import { describe, expect, it } from "vitest";
import { createMageUnit, createMatchState, type MatchState, type Unit, type Zone } from "@doodlemagic/sim";
import { INK } from "../render/palette";
import { RIBBON_SEG, VORTEX_RATE, createAirVfx, ribbonChain, ribbonReady, vortexParticles } from "./airVfx";
import type { ElementVfxFrame } from "./elementVfx";
import type { Glow } from "./glows";
import type { MagePose } from "./mageMeshes";
import type { ParticleSpec } from "./particleKit";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const pose = (pos = V()): MagePose => ({ pos, yaw: 0, pitch: 0, stride: 0, speed01: 0, airborne: false, flinch: 0, flash: false });
const mage = (id: number, charges: number, element: "air" | "fire" = "air"): Unit => {
  const u = createMageUnit(id, element, { pos: V(id * 3, 0, -5), yaw: 0 });
  u.mage!.charges.e = charges;
  return u;
};
const vortex = (kind: "tornado" | "fireTornado" = "tornado"): Zone => ({
  id: 7, owner: 2, kind, ability: "tornado", shape: { type: "disc", center: V(0, 0, -10), radius: 5 }, bornTick: 0, armTick: 30, endTick: 270, rehit: [],
});

function frame(state: MatchState, mages: Unit[], nowS: number, tick: number, sink: { glows: Glow[]; specs: ParticleSpec[] }): ElementVfxFrame {
  return {
    prev: state,
    cur: state,
    alpha: 0.5,
    tick,
    nowS,
    dt: 1 / 60,
    eye: V(),
    localId: 1,
    units: state.units.filter((u) => u.alive).map((u) => ({ id: u.id, pos: u.move.body.pos, u })),
    mages: mages.map((u) => ({ id: u.id, pose: pose(u.move.body.pos), u })),
    palmWorld: () => V(),
    emit: (s: readonly ParticleSpec[]) => sink.specs.push(...s),
    glow: (g: Glow) => sink.glows.push(g),
    decal: () => {},
  } as unknown as ElementVfxFrame;
}

describe("Air ribbons", () => {
  it("one ribbon per Swoop charge is ready", () => {
    expect([0, 1, 2].map((c) => [ribbonReady(mage(2, c), 0), ribbonReady(mage(2, c), 1)])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
  });

  it("a spent ribbon hangs down, a ready one streams back, a gliding one spreads to the side", () => {
    const hang = ribbonChain(V(), 0, 1, "spent", 0);
    const ready = ribbonChain(V(), 0, 1, "ready", 0);
    const glide = ribbonChain(V(), 0, 1, "glide", 0);
    expect(hang.length).toBe(RIBBON_SEG + 1);
    const tip = (c: typeof hang) => c[c.length - 1]!;
    // yaw 0: взгляд в −Z, спина — +Z, правая рука — +X
    expect(tip(hang).y).toBeLessThan(hang[0]!.y - 0.6);
    expect(tip(ready).z - ready[0]!.z).toBeGreaterThan(tip(hang).z - hang[0]!.z);
    expect(tip(glide).x - glide[0]!.x).toBeGreaterThan(0.3);
  });

  it("draws ribbons by the charges of each other Air mage: ready ones in halo ink with a glow and no light; +1 draw call", () => {
    const vfx = createAirVfx({} as never);
    const a = mage(2, 2);
    const b = mage(3, 1);
    const fire = mage(4, 0, "fire");
    const state = createMatchState([mage(1, 2), a, b, fire]);
    const sink = { glows: [] as Glow[], specs: [] as ParticleSpec[] };
    vfx.sync(frame(state, [a, b, fire], 1, 60, sink));
    const mesh = vfx.world as unknown as { count: number; visible: boolean; geometry: { getAttribute(n: string): { getX(i: number): number } } };
    expect(mesh.count).toBe(4 * RIBBON_SEG);
    expect(mesh.visible).toBe(true);
    const ink = mesh.geometry.getAttribute("aInk");
    const inks = Array.from({ length: mesh.count }, (_, i) => ink.getX(i));
    expect(inks.filter((k) => k === INK.halo).length).toBe(3 * RIBBON_SEG);
    expect(inks.filter((k) => k === INK.enemy).length).toBe(RIBBON_SEG);
    expect(sink.glows.length).toBe(3);
    expect(sink.glows.every((g) => g.light === 0)).toBe(true);
    expect(vfx.light).toBeNull();
    vfx.dispose();
  });

  it("a dead Air mage that still reads gliding has no ribbons and no glide streaks", () => {
    const vfx = createAirVfx({} as never);
    const a = mage(2, 2);
    a.mage!.flight.gliding = true;
    a.alive = false;
    const sink = { glows: [] as Glow[], specs: [] as ParticleSpec[] };
    vfx.sync(frame(createMatchState([a]), [a], 1, 60, sink));
    expect((vfx.world as unknown as { count: number }).count).toBe(0);
    expect(sink.specs).toEqual([]);
    vfx.dispose();
  });
});

describe("Air tornado", () => {
  it("grows as a spinning ring inside the disc, then a column of at most 60 wind particles a second with a rim of dust", () => {
    const grow = vortexParticles(vortex(), 15, 0, { grow: 20, column: 0, rim: 0, flame: 0 }, Math.random);
    expect(grow.length).toBe(20);
    for (const p of grow) expect(Math.hypot(p.pos.x, p.pos.z + 10)).toBeLessThanOrEqual(5.001);

    const vfx = createAirVfx({} as never);
    const state = { ...createMatchState([]), tick: 60 };
    state.zones.push(vortex());
    const sink = { glows: [] as Glow[], specs: [] as ParticleSpec[] };
    for (let i = 0; i < 60; i++) vfx.sync(frame(state, [], i / 60, 60, sink));
    expect(sink.specs.length).toBeLessThanOrEqual(VORTEX_RATE.column + VORTEX_RATE.rim);
    expect(sink.specs.length).toBeGreaterThan(VORTEX_RATE.column - 2);
    // столб светится без света на мир
    expect(sink.glows.length).toBeGreaterThan(0);
    expect(sink.glows.every((g) => g.light === 0)).toBe(true);
    vfx.dispose();
  });

  it("a fire tornado burns in the column and lights the world", () => {
    const vfx = createAirVfx({} as never);
    const state = { ...createMatchState([]), tick: 60 };
    state.zones.push(vortex("fireTornado"));
    const sink = { glows: [] as Glow[], specs: [] as ParticleSpec[] };
    for (let i = 0; i < 30; i++) vfx.sync(frame(state, [], i / 60, 60, sink));
    expect(sink.glows.some((g) => g.light > 0)).toBe(true);
    expect(sink.specs.some((p) => p.alpha > 0.5)).toBe(true); // плотное пламя
    vfx.dispose();
  });
});
