import { PerspectiveCamera, Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { NOBODY, aimDir, createMageUnit, createMatchState, type MatchState, type Unit, type Zone } from "@doodlemagic/sim";
import type { ElementVfxFrame } from "./elementVfx";
import type { FxGBuffer } from "./fxShader";
import type { Glow } from "./glows";
import type { MagePose } from "./mageMeshes";
import type { ParticleSpec } from "./particleKit";
import {
  BREATH_LIGHT_M, BREATH_RATE, RIFT_DUST_RATE, SPIKES_PER_RIFT, SPIKE_GROW_TICKS, breathParticle, createUltVfx, riftDust, spikeHash, spikeRise,
} from "./ultVfx";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 2;
const gbuffer = { depth: null, surface: null, invDepth: new Vector2() } as unknown as FxGBuffer;
const camera = new PerspectiveCamera(75, 16 / 9, 0.05, 200);
camera.position.set(0, 1.6, 0);

/** Огонь OTHER дышит: вдох с 100, выдох с 136, конец на 316. */
const breathing = (id = OTHER, pos = V(4, 0, -6), yaw = 0.3): Unit => {
  const u = createMageUnit(id, "fire", { pos, yaw });
  u.mage!.ult.cast = { ability: "dragonBreath", startTick: 100, releaseTick: 136, endTick: 316, zone: NOBODY };
  return u;
};
const rift = (): Zone => ({
  id: 9, owner: OTHER, kind: "rift", ability: "tectonicRift", shape: { type: "segment", a: V(0, 0, -1.5), b: V(0, 0, -26.5), halfW: 0.75 },
  bornTick: 100, armTick: 148, endTick: 508, rehit: [],
});
const pose = (u: Unit): MagePose => ({ pos: u.move.body.pos, yaw: u.move.yaw, pitch: u.move.pitch, stride: 0, speed01: 0, airborne: false, flinch: 0, flash: false });

interface Sink {
  specs: ParticleSpec[];
  glows: Glow[];
}
function frame(s: MatchState, tick: number, nowS: number, sink: Sink, dt = 1 / 60): ElementVfxFrame {
  const units = s.units.filter((u) => u.alive).map((u) => ({ id: u.id, pos: u.move.body.pos, u }));
  return {
    prev: s,
    cur: s,
    alpha: 1,
    tick,
    nowS,
    dt,
    camera,
    eye: V(0, 1.6, 0),
    localId: ME,
    units,
    mages: units.filter((it) => it.id !== ME).map((it) => ({ id: it.id, pose: pose(it.u), u: it.u })),
    palmWorld: () => V(0.1, 1.3, -0.6),
    emit: (specs) => sink.specs.push(...specs),
    glow: (g) => sink.glows.push(g),
    decal: () => {},
  };
}
const fresh = (): Sink => ({ specs: [], glows: [] });
type Mesh = { count: number; visible: boolean; isInstancedMesh?: boolean };

describe("ultVfx: dragon breath", () => {
  it("draws the cone exactly while ult.cast streams — from releaseTick to endTick — and not after the cast is gone", () => {
    const vfx = createUltVfx({ gbuffer, time: { value: 0 } });
    const s = createMatchState([createMageUnit(ME, "earth", { pos: V(), yaw: 0 }), breathing()]);
    const cones = vfx.light as unknown as Mesh;
    const at = (tick: number) => {
      vfx.sync(frame(s, tick, tick / 60, fresh()));
      return cones.count;
    };
    expect([at(120), at(135.9), at(136), at(200), at(315.9), at(316)]).toEqual([0, 0, 1, 1, 1, 0]);
    // каст снят без события ult/end (смена стихии, возрождение) — потока больше нет
    at(200);
    s.units[1]!.mage!.ult.cast = null;
    expect(at(201)).toBe(0);
    expect(cones.visible).toBe(false);
    vfx.dispose();
  });

  it("streams at most 90 fire particles a second along the look, inside the 15° cone, with a 7.5 m fire light", () => {
    const vfx = createUltVfx({ gbuffer, time: { value: 0 } });
    const u = breathing();
    const s = createMatchState([createMageUnit(ME, "earth", { pos: V(), yaw: 0 }), u]);
    const sink = fresh();
    for (let i = 0; i < 60; i++) vfx.sync(frame(s, 160 + i, 3 + i / 60, sink));
    expect(sink.specs.length).toBeLessThanOrEqual(BREATH_RATE);
    expect(sink.specs.length).toBeGreaterThan(BREATH_RATE - 3);
    const d = aimDir(u.move.yaw, u.move.pitch);
    for (const p of sink.specs) {
      const v = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      expect((p.vel.x * d.x + p.vel.y * d.y + p.vel.z * d.z) / v).toBeGreaterThan(Math.cos((15 * Math.PI) / 180));
    }
    expect(sink.glows.some((g) => g.light === BREATH_LIGHT_M)).toBe(true);
    vfx.dispose();
  });

  it("another mage's cone starts at his mouth and follows his look; mine starts at my palms", () => {
    const vfx = createUltVfx({ gbuffer, time: { value: 0 } });
    const other = breathing(OTHER, V(4, 0, -6), 0.3);
    const s = createMatchState([breathing(ME, V(), 0), other]);
    vfx.sync(frame(s, 160, 3, fresh()));
    const cones = vfx.light as unknown as { count: number; geometry: { getAttribute(n: string): { getX(i: number): number; getY(i: number): number; getZ(i: number): number } } };
    expect(cones.count).toBe(2);
    const apex = cones.geometry.getAttribute("aB0");
    const axis = cones.geometry.getAttribute("aB1");
    const at = (i: number) => V(apex.getX(i), apex.getY(i), apex.getZ(i));
    const mine = [0, 1].find((i) => Math.abs(at(i).x - 0.1) < 1e-6)!;
    const theirs = 1 - mine;
    expect(Math.hypot(at(mine).x - 0.1, at(mine).y - 1.3, at(mine).z + 0.6)).toBeLessThan(1e-6);
    expect(Math.hypot(at(theirs).x - 4, at(theirs).z + 6)).toBeLessThan(0.5);
    expect(at(theirs).y).toBeGreaterThan(1.3);
    const d = aimDir(other.move.yaw, other.move.pitch);
    expect([axis.getX(theirs), axis.getY(theirs), axis.getZ(theirs)].map((v, i) => v - [d.x, d.y, d.z][i]!).every((e) => Math.abs(e) < 1e-6)).toBe(true);
    vfx.dispose();
  });

  it("an inhaling mage glows at the chest and draws embers in, before any cone", () => {
    const vfx = createUltVfx({ gbuffer, time: { value: 0 } });
    const s = createMatchState([createMageUnit(ME, "earth", { pos: V(), yaw: 0 }), breathing()]);
    const sink = fresh();
    for (let i = 0; i < 30; i++) vfx.sync(frame(s, 105 + i, 2 + i / 60, sink));
    expect((vfx.light as unknown as Mesh).count).toBe(0);
    expect(sink.glows.length).toBe(30);
    expect(sink.specs.length).toBeGreaterThan(10);
    vfx.dispose();
  });

  it("a stream particle lives no longer than it takes to cross the cone", () => {
    const rng = (() => {
      let k = 7;
      return () => (k = (k * 16807) % 2147483647) / 2147483647;
    })();
    for (let i = 0; i < 200; i++) {
      const p = breathParticle(V(), V(0, 0, -1), 12, rng);
      const v = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      expect(Math.hypot(p.pos.x, p.pos.y, p.pos.z) + v * p.life).toBeLessThanOrEqual(12 * 1.1 + 1.2);
    }
  });
});

describe("ultVfx: tectonic rift", () => {
  it("raises spikes along the whole line from armTick to endTick, growing in 0.1 s and melting in the last 0.5 s", () => {
    const z = rift();
    expect([spikeRise(z, 147.9), spikeRise(z, 148)]).toEqual([0, 0]);
    expect(spikeRise(z, 148 + SPIKE_GROW_TICKS)).toBeCloseTo(1);
    expect(spikeRise(z, 148 + SPIKE_GROW_TICKS * 0.6)).toBeGreaterThan(1);
    expect(spikeRise(z, 300)).toBe(1);
    expect(spikeRise(z, 490)).toBeLessThan(1);
    expect(spikeRise(z, 507.5)).toBeLessThan(0.01);
    expect(spikeRise(z, 508)).toBe(0);

    const vfx = createUltVfx({ gbuffer, time: { value: 0 } });
    const s = createMatchState([createMageUnit(ME, "fire", { pos: V(), yaw: 0 })]);
    s.zones.push(z);
    const spikes = vfx.world as unknown as Mesh;
    const at = (tick: number) => {
      vfx.sync(frame(s, tick, tick / 60, fresh()));
      return spikes.count;
    };
    expect([at(140), at(150), at(400), at(505), at(508)]).toEqual([0, SPIKES_PER_RIFT, SPIKES_PER_RIFT, SPIKES_PER_RIFT, 0]);
    vfx.dispose();
  });

  it("lays the spikes out the same every frame, on both sides of the crack and inside the 0.75 m strip", () => {
    expect(spikeHash(9, 3, 1)).toBe(spikeHash(9, 3, 1));
    expect(spikeHash(9, 3, 1)).not.toBe(spikeHash(10, 3, 1));
    const vfx = createUltVfx({ gbuffer, time: { value: 0 } });
    const s = createMatchState([]);
    s.zones.push(rift());
    vfx.sync(frame(s, 300, 5, fresh()));
    const spikes = vfx.world as unknown as { count: number; instanceMatrix: { array: Float32Array } };
    const xs = Array.from({ length: spikes.count }, (_, i) => spikes.instanceMatrix.array[i * 16 + 12]!);
    const zs = Array.from({ length: spikes.count }, (_, i) => spikes.instanceMatrix.array[i * 16 + 14]!);
    expect(xs.some((x) => x > 0.1) && xs.some((x) => x < -0.1)).toBe(true);
    expect(xs.every((x) => Math.abs(x) <= 0.75)).toBe(true);
    expect(Math.min(...zs)).toBeLessThan(-24);
    expect(Math.max(...zs)).toBeGreaterThan(-3);
    const again = Array.from(spikes.instanceMatrix.array.slice(0, spikes.count * 16));
    vfx.sync(frame(s, 300, 5.5, fresh()));
    expect(Array.from(spikes.instanceMatrix.array.slice(0, spikes.count * 16))).toEqual(again);
    vfx.dispose();
  });

  it("kicks dust up at the running front during the 0.8 s telegraph, ≤ 70 a second", () => {
    const vfx = createUltVfx({ gbuffer, time: { value: 0 } });
    const s = createMatchState([]);
    s.zones.push(rift());
    const sink = fresh();
    for (let i = 0; i < 48; i++) vfx.sync(frame(s, 100 + i, i / 60, sink));
    expect(sink.specs.length).toBeLessThanOrEqual(Math.ceil(RIFT_DUST_RATE * 0.8));
    expect(sink.specs.length).toBeGreaterThan(RIFT_DUST_RATE * 0.8 - 3);
    // фронт к середине телеграфа — около середины линии
    const mid = riftDust(V(0, 0, -1.5), V(0, 0, -26.5), 0.5, () => 0.5);
    expect(mid.pos.z).toBeCloseTo(-1.5 - 25 * 0.48, 1);
    expect((vfx.world as unknown as Mesh).count).toBe(0);
    vfx.dispose();
  });

  it("costs one instanced mesh per element: the breath cone in the light pass, the spikes in the G-buffer", () => {
    const vfx = createUltVfx({ gbuffer, time: { value: 0 } });
    expect((vfx.light as unknown as Mesh).isInstancedMesh).toBe(true);
    expect((vfx.world as unknown as Mesh).isInstancedMesh).toBe(true);
    expect([(vfx.light as unknown as Mesh).visible, (vfx.world as unknown as Mesh).visible]).toEqual([false, false]);
    vfx.setPreset?.("low");
    vfx.setPreset?.("high");
    vfx.dispose();
  });
});
