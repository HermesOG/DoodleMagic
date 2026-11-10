import { PerspectiveCamera, Vector2, type Group, type InstancedMesh } from "three";
import { describe, expect, it } from "vitest";
import { NEVER, createMageUnit, createMatchState, type MatchState, type PickupState, type Unit, type UnitId } from "@doodlemagic/sim";
import type { ElementVfxFrame } from "./elementVfx";
import type { FxGBuffer } from "./fxShader";
import type { Glow } from "./glows";
import type { MagePose } from "./mageMeshes";
import type { ParticleSpec } from "./particleKit";
import {
  FURY_LIGHT_M, FURY_MOTE_RATE, ORB_GROW_S, ORB_LIGHT_M, ORB_R_M, RUNE_FLASH, RUNE_LIGHT_M, createPickupVfx, furyGlow, growIn, sealLook,
} from "./pickupVfx";
import { GOLD, MAX_BURST, burstParticles } from "./presets";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 2;
const gbuffer = { depth: null, surface: null, invDepth: new Vector2() } as unknown as FxGBuffer;
const camera = new PerspectiveCamera(75, 16 / 9, 0.05, 200);
camera.position.set(0, 1.6, 0);
const PALM = V(0.1, 1.3, -0.6);

/** Шесть сфер и руна в центре, как на галерее: точки — 0,5 м над полом (ров — пол −1 м, балкон — +3 м). */
const ORBS = [V(-11.9, 0.5, -11.25), V(18.5, 0.5, -13), V(11.9, 0.5, 11.25), V(-18.5, 0.5, 13), V(-18.5, -0.5, 0), V(13.5, 3.5, 0)];
const RUNE = V(0, 0.5, 0);
const RUNE_AT = 2700;
const RUNE_INDEX = ORBS.length;
const mage = (id: UnitId, pos = V(0, 0, 8)): Unit => createMageUnit(id, "fire", { pos, yaw: 0 });
function state(tick: number, units: Unit[] = [mage(ME)]): MatchState {
  const s = createMatchState(units);
  s.tick = tick;
  s.pickups = [...ORBS.map((pos): PickupState => ({ kind: "orb", pos, readyAt: NEVER })), { kind: "rune", pos: RUNE, readyAt: RUNE_AT }];
  return s;
}
/** Следующее состояние: тот же мир на тик позже, правки — в edit. */
function next(s: MatchState, edit: (n: MatchState) => void = () => {}, ticks = 1): MatchState {
  const n = structuredClone(s);
  n.tick = s.tick + ticks;
  edit(n);
  return n;
}
const pose = (u: Unit): MagePose => ({ pos: u.move.body.pos, yaw: u.move.yaw, pitch: u.move.pitch, stride: 0, speed01: 0, airborne: false, flinch: 0, flash: false });

interface Sink {
  specs: ParticleSpec[];
  glows: (Glow & { prio: number })[];
}
const fresh = (): Sink => ({ specs: [], glows: [] });
function frame(prev: MatchState, cur: MatchState, sink: Sink, o: { tick?: number; nowS?: number; dt?: number } = {}): ElementVfxFrame {
  const units = cur.units.filter((u) => u.alive).map((u) => ({ id: u.id, pos: u.move.body.pos, u }));
  return {
    prev,
    cur,
    alpha: 1,
    tick: o.tick ?? cur.tick,
    nowS: o.nowS ?? cur.tick / 60,
    dt: o.dt ?? 1 / 60,
    camera,
    eye: V(0, 1.6, 0),
    localId: ME,
    units,
    mages: units.filter((it) => it.id !== ME).map((it) => ({ id: it.id, pose: pose(it.u), u: it.u })),
    palmWorld: () => PALM,
    emit: (specs) => sink.specs.push(...specs),
    glow: (g, prio) => sink.glows.push({ ...g, prio }),
    decal: () => {},
  };
}
type Mesh = InstancedMesh & { geometry: { getAttribute(n: string): { getX(i: number): number; getY(i: number): number; getZ(i: number): number; getW(i: number): number } } };
function meshes(vfx: ReturnType<typeof createPickupVfx>): { bodies: Mesh; seals: Mesh } {
  const all = (vfx.light as Group).children as Mesh[];
  return { bodies: all.find((m) => m.name === "fx-pickup-bodies")!, seals: all.find((m) => m.name === "fx-pickup-seals")! };
}
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("pickupVfx: bodies follow the state", () => {
  it("draws one body per lying object: six orbs from the start, the rune from its readyAt, a taken orb is gone", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const { bodies } = meshes(vfx);
    const s = state(100);
    vfx.sync(frame(s, s, fresh()));
    expect([bodies.count, bodies.visible]).toEqual([6, true]);
    const r = state(RUNE_AT);
    vfx.sync(frame(r, r, fresh()));
    expect(bodies.count).toBe(7);
    const taken = next(r, (n) => (n.pickups[2]!.readyAt = n.tick + 900));
    vfx.sync(frame(r, taken, fresh()));
    expect(bodies.count).toBe(6);
    // без объектов на карте (тестовая арена) — ничего не рисуется
    const none = createMatchState([mage(ME)]);
    vfx.sync(frame(none, none, fresh()));
    expect([bodies.count, bodies.visible]).toEqual([0, false]);
    vfx.dispose();
  });

  it("an orb grows out of its seal in 0.25 s with a small overshoot; the rune hovers 1.2 m over its platform", () => {
    expect(growIn(0, ORB_GROW_S)).toBe(0);
    expect(growIn(-1, ORB_GROW_S)).toBe(0);
    expect(growIn(ORB_GROW_S * 0.6, ORB_GROW_S)).toBeGreaterThan(1);
    expect(growIn(ORB_GROW_S, ORB_GROW_S)).toBe(1);
    expect(growIn(9, ORB_GROW_S)).toBe(1);

    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const { bodies } = meshes(vfx);
    const s = state(1000, []);
    s.pickups[0]!.readyAt = 1000;
    const size = (tick: number) => {
      vfx.sync(frame(s, s, fresh(), { tick, nowS: tick / 60 }));
      return bodies.geometry.getAttribute("aB1").getX(0);
    };
    expect(size(1000)).toBeCloseTo(0);
    expect(size(1000 + ORB_GROW_S * 60)).toBeCloseTo(ORB_R_M);
    // покачивается ±0,08 м над точкой
    const ys = Array.from({ length: 120 }, (_, i) => (vfx.sync(frame(s, s, fresh(), { tick: 1100 + i, nowS: i / 60 })), bodies.geometry.getAttribute("aB0").getY(0)));
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.5 + 0.08 + 1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0.5 - 0.08 - 1e-6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.12);
    const r = state(RUNE_AT + 100, []);
    vfx.sync(frame(r, r, fresh()));
    const rune = [...Array(bodies.count).keys()].find((i) => bodies.geometry.getAttribute("aB0").getW(i) === 1)!;
    expect(bodies.geometry.getAttribute("aB0").getY(rune)).toBeCloseTo(1.2, 0);
    vfx.dispose();
  });
});

describe("pickupVfx: takes and appearances from the state", () => {
  it("a take between prev and cur bursts gold sparks at the orb — once, even if the frame repeats the pair", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const prev = state(500, [mage(ME, V(-11.9, 0, -11))]);
    const cur = next(prev, (n) => (n.pickups[0]!.readyAt = 500 + 900));
    const sink = fresh();
    vfx.sync(frame(prev, cur, sink));
    expect(sink.specs.length).toBeGreaterThan(10);
    expect(sink.specs.length).toBeLessThanOrEqual(40);
    expect(sink.specs.every((p) => dist(p.pos, ORBS[0]!) < 0.6)).toBe(true);
    // кадров больше, чем тиков: та же пара prev / cur всплеск не повторяет
    const again = fresh();
    vfx.sync(frame(prev, cur, again, { nowS: 500 / 60 + 0.007 }));
    expect(again.specs.length).toBe(0);
    vfx.dispose();
  });

  it("an orb that comes back bursts ≤ 30 sparks from its seal on the floor", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const away = state(1399, []);
    away.pickups[4]!.readyAt = 1400;
    vfx.sync(frame(away, away, fresh()));
    const back = next(away);
    const sink = fresh();
    vfx.sync(frame(away, back, sink));
    expect(sink.specs.length).toBeGreaterThan(5);
    expect(sink.specs.length).toBeLessThanOrEqual(30);
    // сфера во рву: пол на −1 м
    const floor = V(ORBS[4]!.x, -1, ORBS[4]!.z);
    expect(sink.specs.every((p) => dist(p.pos, floor) < 0.7)).toBe(true);
    vfx.dispose();
  });

  it("no burst when an object goes away with nobody near: the reset at the start of a fight is not a take", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const lying = state(RUNE_AT + 600);
    vfx.sync(frame(lying, lying, fresh()));
    const reset = next(lying, (n) => (n.pickups[RUNE_INDEX]!.readyAt = n.tick + 2700));
    const sink = fresh();
    vfx.sync(frame(lying, reset, sink));
    expect(sink.specs.length).toBe(0);
    vfx.dispose();
  });

  it("the rune appears with a column of ≤ 120 sparks and a flash of light; another mage's take bursts at the rune, mine at my feet", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const before = state(RUNE_AT - 1, []);
    vfx.sync(frame(before, before, fresh()));
    const spawned = next(before);
    const sink = fresh();
    vfx.sync(frame(before, spawned, sink));
    expect(sink.specs.length).toBeGreaterThan(60);
    expect(sink.specs.length).toBeLessThanOrEqual(120);
    expect(sink.specs.every((p) => Math.hypot(p.pos.x, p.pos.z) < 1.7)).toBe(true);
    expect(sink.glows.some((g) => g.light === RUNE_FLASH.light && g.prio >= 5)).toBe(true);

    for (const [who, high] of [[OTHER, true], [ME, false]] as const) {
      const fx = createPickupVfx({ gbuffer, time: { value: 0 } });
      const lying = state(RUNE_AT + 50, [mage(ME, V(0, 0, 8)), mage(OTHER, V(0, 0, 8))]);
      lying.units.find((u) => u.id === who)!.move.body.pos = V(0.4, 0, 0.6);
      fx.sync(frame(lying, lying, fresh()));
      const took = next(lying, (n) => {
        n.pickups[RUNE_INDEX]!.readyAt = RUNE_AT + 3600;
        n.units.find((u) => u.id === who)!.status.furyUntil = n.tick + 720;
      });
      const s = fresh();
      fx.sync(frame(lying, took, s));
      const burst = s.specs.filter((p) => Math.hypot(p.pos.x, p.pos.z) < 1.6);
      expect(burst.length).toBeGreaterThan(40);
      expect(burst.length).toBeLessThanOrEqual(120);
      const meanY = burst.reduce((a, p) => a + p.pos.y, 0) / burst.length;
      if (high) expect(meanY).toBeGreaterThan(1);
      else expect(meanY).toBeLessThan(0.6);
      fx.dispose();
    }
    vfx.dispose();
  });
});

describe("pickupVfx: seals on the floor", () => {
  it("the rune seal shows only in the last 10 s before readyAt and draws itself as they pass", () => {
    const rune: PickupState = { kind: "rune", pos: RUNE, readyAt: RUNE_AT };
    expect(sealLook(rune, RUNE_AT - 601)).toBeNull();
    const at = (t: number) => sealLook(rune, t)!;
    expect(at(RUNE_AT - 600).progress).toBeCloseTo(0);
    expect(at(RUNE_AT - 300).progress).toBeCloseTo(0.5);
    expect(at(RUNE_AT - 30).progress).toBeGreaterThan(at(RUNE_AT - 300).progress);
    expect(at(RUNE_AT - 30).gold).toBeGreaterThan(at(RUNE_AT - 600).gold);
    expect(at(RUNE_AT).progress).toBe(1);

    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const { seals } = meshes(vfx);
    const early = state(RUNE_AT - 700, []);
    vfx.sync(frame(early, early, fresh()));
    expect(seals.count).toBe(6);
    const warn = state(RUNE_AT - 300, []);
    const sink = fresh();
    for (let i = 0; i < 60; i++) vfx.sync(frame(warn, warn, sink, { tick: RUNE_AT - 300 + i * 0.5 }));
    expect(seals.count).toBe(7);
    expect(seals.geometry.getAttribute("aS1").getY(6)).toBeGreaterThan(0.5);
    // к центру тянутся золотые искры: рождаются на круге печати и летят внутрь
    expect(sink.specs.length).toBeGreaterThan(5);
    for (const p of sink.specs) {
      const r0 = Math.hypot(p.pos.x, p.pos.z);
      expect(r0).toBeGreaterThan(1);
      expect(Math.hypot(p.pos.x + p.vel.x * p.life, p.pos.z + p.vel.z * p.life)).toBeLessThan(r0);
    }
    vfx.dispose();
  });

  it("the orb seal is always there: dim under a lying orb, paler while it is away, warming in the last 2 s", () => {
    const lying = sealLook({ kind: "orb", pos: ORBS[0]!, readyAt: NEVER }, 1000)!;
    const orb: PickupState = { kind: "orb", pos: ORBS[0]!, readyAt: 2000 };
    const away = sealLook(orb, 1000)!;
    expect(away.ink).toBeLessThan(lying.ink);
    expect(away.gold).toBe(0);
    expect(sealLook(orb, 2000 - 121)!.gold).toBe(0);
    expect(sealLook(orb, 2000 - 60)!.gold).toBeGreaterThan(0);
    expect(sealLook(orb, 2000 - 6)!.gold).toBeGreaterThan(sealLook(orb, 2000 - 60)!.gold);
    expect([lying.progress, away.progress]).toEqual([1, 1]);
  });
});

describe("pickupVfx: the fury holder", () => {
  it("pulses at 1.5 Hz, in the last 2 s faster and fading out", () => {
    const u = mage(OTHER);
    u.status.furyUntil = 100 + 720;
    const at = (tick: number) => furyGlow(u, Math.floor(tick), tick)!;
    expect(at(100).pulse).toBeCloseTo(1);
    // 1,5 Гц: полпериода — 20 тиков
    expect(at(120).pulse).toBeCloseTo(0);
    expect(at(140).pulse).toBeCloseTo(1);
    expect(at(500).fade).toBe(1);
    // последние 2 с — 4 Гц (полпериода 7,5 тика) и гаснет к нулю
    expect(at(760).pulse).toBeCloseTo(1);
    expect(at(767.5).pulse).toBeCloseTo(0);
    expect(at(760).fade).toBeCloseTo(0.5);
    expect(at(790).fade).toBeCloseTo(0.25);
    expect(furyGlow(u, 820, 820)).toBeNull();
    u.alive = false;
    expect(furyGlow(u, 500, 500)).toBeNull();
  });

  it("only a live mage with furyUntil > now glows gold at the chest; mine sparks at the palms, with no glow at the camera", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const other = mage(OTHER, V(4, 0, -12));
    const me = mage(ME, V());
    other.status.furyUntil = 1000;
    me.status.furyUntil = 1000;
    const s = state(500, [me, other]);
    const chest = V(4, 1.3, -12);
    const sink = fresh();
    for (let i = 0; i < 60; i++) vfx.sync(frame(s, s, sink, { tick: 500 + i * 0.2, nowS: 10 + i / 60 }));
    const atChest = sink.glows.filter((g) => dist(g.pos, chest) < 0.2);
    expect(atChest.length).toBe(60);
    expect(atChest.every((g) => g.light === FURY_LIGHT_M && g.color === GOLD.light)).toBe(true);
    // на 12 м ореол не меньше 0,36 м: носителя видно издалека
    expect(Math.min(...atChest.map((g) => g.halo))).toBeGreaterThan(0.3);
    expect(sink.glows.some((g) => dist(g.pos, V(0, 1.3, 0)) < 1.5)).toBe(false);
    // искры за чужим носителем ≤ 20 в секунду; свои — у ладоней
    const motes = sink.specs.filter((p) => dist(p.pos, chest) < 1.3);
    expect(motes.length).toBeGreaterThan(FURY_MOTE_RATE / 2);
    expect(motes.length).toBeLessThanOrEqual(20);
    const palms = sink.specs.filter((p) => dist(p.pos, PALM) < 0.15);
    expect(palms.length).toBeGreaterThan(3);
    expect(sink.specs.every((p) => dist(p.pos, chest) < 1.3 || dist(p.pos, PALM) < 0.15)).toBe(true);

    // время вышло — нет свечения; мёртвый носитель — тоже
    const over = state(1000, [mage(ME, V()), (() => ((other.status.furyUntil = 1000), other))()]);
    const late = fresh();
    vfx.sync(frame(over, over, late));
    expect(late.glows.some((g) => dist(g.pos, chest) < 0.2)).toBe(false);
    const dead = state(600, [mage(ME, V()), (() => ((other.alive = false), other))()]);
    const gone = fresh();
    vfx.sync(frame(dead, dead, gone));
    expect(gone.glows.some((g) => dist(g.pos, chest) < 0.2)).toBe(false);
    vfx.dispose();
  });
});

describe("pickupVfx: gold, light and budget", () => {
  it("orbs and the rune glow gold: the orb's light is small and last in the preset's queue, the rune's is 5 m", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const s = state(RUNE_AT + 200, []);
    const sink = fresh();
    vfx.sync(frame(s, s, sink));
    const orbs = sink.glows.filter((g) => g.light === ORB_LIGHT_M);
    expect(orbs.length).toBe(6);
    expect(orbs.every((g) => g.prio < 0.6 && g.color === GOLD.light)).toBe(true);
    expect(sink.glows.filter((g) => g.light === RUNE_LIGHT_M).length).toBe(1);
    vfx.dispose();
  });

  it("the pickup bursts are gold, not fire, and within their caps", () => {
    const caps = { orbSpawn: 30, orbTake: 40, runeSpawn: 120, runeTake: 120, furyMote: 2 } as const;
    for (const [p, cap] of Object.entries(caps) as [keyof typeof caps, number][]) {
      const out = burstParticles(p, V(), V(0, 1, 0), 1, Math.random);
      expect(out.length, p).toBeGreaterThan(0);
      expect(out.length, p).toBeLessThanOrEqual(Math.min(cap, MAX_BURST));
      // огонь — оранжевый (g / r ≈ 0,5), золото желтее
      for (const q of out) if (q.alpha === 0) expect(q.color[1] / q.color[0], p).toBeGreaterThan(0.6);
    }
  });

  it("costs two instanced meshes in the light pass and none in the G-buffer; dispose frees them", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    expect(vfx.world).toBeNull();
    const all = (vfx.light as Group).children as Mesh[];
    expect(all.length).toBe(2);
    expect(all.every((m) => m.isInstancedMesh && !m.visible)).toBe(true);
    const freed: string[] = [];
    for (const m of all) {
      m.geometry.addEventListener("dispose", () => freed.push(`${m.name}:geometry`));
      (m.material as unknown as { addEventListener(t: string, f: () => void): void }).addEventListener("dispose", () => freed.push(`${m.name}:material`));
    }
    vfx.dispose();
    expect(freed.sort()).toEqual(["fx-pickup-bodies:geometry", "fx-pickup-bodies:material", "fx-pickup-seals:geometry", "fx-pickup-seals:material"]);
  });
});
