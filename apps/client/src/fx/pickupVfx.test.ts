import { PerspectiveCamera, Vector2, type Group, type InstancedMesh } from "three";
import { describe, expect, it } from "vitest";
import { buildGallery } from "@doodlemagic/arena";
import {
  NEVER, createMageUnit, createMatchState, initPickups, matchContext, stepMatch, type MatchState, type PickupState, type Unit, type UnitId, type Vec3,
} from "@doodlemagic/sim";
import type { ElementVfxFrame } from "./elementVfx";
import type { FxGBuffer } from "./fxShader";
import type { Glow } from "./glows";
import type { MagePose } from "./mageMeshes";
import type { ParticleSpec } from "./particleKit";
import {
  FURY_LIGHT_M, FURY_MOTE_RATE, FURY_PRIO, ORB_GROW_S, ORB_LIGHT_M, ORB_PRIO, ORB_R_M, RUNE_FLASH, RUNE_LIGHT_M, RUNE_PRIO, SEAL_FADE_S, createPickupVfx,
  furyGlow, growIn, sealLook,
} from "./pickupVfx";
import { GOLD, MAX_BURST, burstParticles } from "./presets";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 2;
/** Свет рук магов и горения в vfx.ts: свет объектов карты встаёт между ними и под ними. */
const HAND_PRIO = 0.6;
const BURN_PRIO = 1;
const gbuffer = { depth: null, surface: null, invDepth: new Vector2() } as unknown as FxGBuffer;
/** Свой маг по умолчанию — на полу за ущельем, глаза на 1,6 м, взгляд к руне (−Z). */
const HOME = V(0, 0, 8);
const EYE = V(0, 1.6, 8);
const camera = new PerspectiveCamera(75, 16 / 9, 0.05, 200);
camera.position.set(EYE.x, EYE.y, EYE.z);
camera.updateMatrixWorld();
const PALM = V(0.1, 1.3, 7.4);

/** Шесть сфер и руна в центре, как на галерее: точки — 0,5 м над полом (ров — пол −1 м, балкон — +4 м). */
const ORBS = [V(-11.9, 0.5, -11.25), V(18.5, 0.5, -13), V(11.9, 0.5, 11.25), V(-18.5, 0.5, 13), V(-18.5, -0.5, 0), V(13.5, 4.5, 0)];
const RUNE = V(0, 0.5, 0);
const RUNE_AT = 2700;
const RUNE_INDEX = ORBS.length;
const mage = (id: UnitId, pos = HOME): Unit => createMageUnit(id, "fire", { pos, yaw: 0 });
/** Состояние после тика now (tick = now + 1): объект смотрится на последнем посчитанном тике, как его события. */
function after(now: number, units: Unit[] = [mage(ME)]): MatchState {
  const s = createMatchState(units);
  s.tick = now + 1;
  s.pickups = [...ORBS.map((pos): PickupState => ({ kind: "orb", pos, readyAt: NEVER })), { kind: "rune", pos: RUNE, readyAt: RUNE_AT }];
  return s;
}
/** Следующее состояние: тот же мир на тик позже, правки — в edit (n.tick − 1 — тик, посчитанный этим шагом). */
function next(s: MatchState, edit: (n: MatchState) => void = () => {}): MatchState {
  const n = structuredClone(s);
  n.tick = s.tick + 1;
  edit(n);
  return n;
}
const unit = (s: MatchState, id: UnitId): Unit => s.units.find((u) => u.id === id)!;
const pose = (u: Unit): MagePose => ({ pos: u.move.body.pos, yaw: u.move.yaw, pitch: u.move.pitch, stride: 0, speed01: 0, airborne: false, flinch: 0, flash: false });

interface Sink {
  specs: ParticleSpec[];
  glows: (Glow & { prio: number })[];
}
const fresh = (): Sink => ({ specs: [], glows: [] });
function frame(prev: MatchState, cur: MatchState, sink: Sink, o: { tick?: number; nowS?: number; dt?: number; eye?: Vec3 } = {}): ElementVfxFrame {
  const units = cur.units.filter((u) => u.alive).map((u) => ({ id: u.id, pos: u.move.body.pos, u }));
  return {
    prev,
    cur,
    alpha: 1,
    tick: o.tick ?? cur.tick,
    nowS: o.nowS ?? cur.tick / 60,
    dt: o.dt ?? 1 / 60,
    camera,
    eye: o.eye ?? EYE,
    localId: ME,
    units,
    mages: units.filter((it) => it.id !== ME).map((it) => ({ id: it.id, pose: pose(it.u), u: it.u })),
    palmWorld: () => PALM,
    emit: (specs) => sink.specs.push(...specs),
    glow: (g, prio) => sink.glows.push({ ...g, prio }),
    decal: () => {},
  };
}
type Attr = { getX(i: number): number; getY(i: number): number; getZ(i: number): number; getW(i: number): number };
type Mesh = InstancedMesh & { geometry: { getAttribute(n: string): Attr } };
function meshes(vfx: ReturnType<typeof createPickupVfx>): { bodies: Mesh; seals: Mesh } {
  const all = (vfx.light as Group).children as Mesh[];
  return { bodies: all.find((m) => m.name === "fx-pickup-bodies")!, seals: all.find((m) => m.name === "fx-pickup-seals")! };
}
/** Печать руны в кадре (вид 1 в aS1.x): доля круга и тушь; нет — null. */
function runeSeal(seals: Mesh): { progress: number; ink: number } | null {
  const a = seals.geometry.getAttribute("aS1");
  for (let i = 0; i < seals.count; i++) if (a.getX(i) === 1) return { progress: a.getY(i), ink: a.getZ(i) };
  return null;
}
const hasRuneBody = (bodies: Mesh): boolean => [...Array(bodies.count).keys()].some((i) => bodies.geometry.getAttribute("aB0").getW(i) === 1);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Высшая точка частицы за жизнь с её размером: свет летит без сопротивления — y0 + vy·t − g·t²/2. */
function peakY(p: ParticleSpec): number {
  let y = p.pos.y;
  for (let k = 1; k <= 24; k++) {
    const t = (p.life * k) / 24;
    y = Math.max(y, p.pos.y + p.vel.y * t - 0.5 * p.gravity * t * t);
  }
  return y + Math.max(p.size0, p.size1) / 2;
}

describe("pickupVfx: bodies follow the state", () => {
  it("draws one body per lying object: six orbs from the start, the rune from its tick, a taken orb is gone", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const { bodies } = meshes(vfx);
    const s = after(100);
    vfx.sync(frame(s, s, fresh()));
    expect([bodies.count, bodies.visible]).toEqual([6, true]);
    // на тике появления руна уже лежит; тиком раньше — нет
    const almost = after(RUNE_AT - 1);
    vfx.sync(frame(almost, almost, fresh()));
    expect(bodies.count).toBe(6);
    const r = next(almost);
    vfx.sync(frame(almost, r, fresh()));
    expect(bodies.count).toBe(7);
    const taken = next(r, (n) => (n.pickups[2]!.readyAt = n.tick - 1 + 900));
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
    const s = after(1000, []);
    s.pickups[0]!.readyAt = 1000;
    // дробный тик кадра tick − 1 — последний посчитанный: 1001 — тик появления
    const size = (tick: number) => {
      vfx.sync(frame(s, s, fresh(), { tick, nowS: tick / 60 }));
      return bodies.geometry.getAttribute("aB1").getX(0);
    };
    expect(size(1001)).toBeCloseTo(0);
    expect(size(1001 + ORB_GROW_S * 60)).toBeCloseTo(ORB_R_M);
    // покачивается ±0,08 м над точкой
    const ys = Array.from({ length: 120 }, (_, i) => (vfx.sync(frame(s, s, fresh(), { tick: 1101 + i, nowS: i / 60 })), bodies.geometry.getAttribute("aB0").getY(0)));
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.5 + 0.08 + 1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0.5 - 0.08 - 1e-6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.12);
    const r = after(RUNE_AT + 100, []);
    vfx.sync(frame(r, r, fresh()));
    const rune = [...Array(bodies.count).keys()].find((i) => bodies.geometry.getAttribute("aB0").getW(i) === 1)!;
    expect(bodies.geometry.getAttribute("aB0").getY(rune)).toBeCloseTo(1.2, 0);
    vfx.dispose();
  });
});

describe("pickupVfx: takes and appearances from the state", () => {
  it("another mage's take bursts gold sparks at the orb — once, even if the frame repeats the pair", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const prev = after(500, [mage(ME), mage(OTHER, V(-11.9, 0, -11))]);
    const cur = next(prev, (n) => (n.pickups[0]!.readyAt = 501 + 900));
    const sink = fresh();
    vfx.sync(frame(prev, cur, sink));
    expect(sink.specs.length).toBeGreaterThan(10);
    expect(sink.specs.length).toBeLessThanOrEqual(40);
    expect(sink.specs.every((p) => dist(p.pos, ORBS[0]!) < 0.6)).toBe(true);
    // кадров больше, чем тиков: та же пара prev / cur всплеск не повторяет
    const again = fresh();
    vfx.sync(frame(prev, cur, again, { nowS: 501 / 60 + 0.007 }));
    expect(again.specs.length).toBe(0);
    vfx.dispose();
  });

  it("another mage's take that reached me only by a snapshot (in the past of my window) still bursts, once", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const lying = after(520, [mage(ME), mage(OTHER, V(-11.9, 0, -11))]);
    vfx.sync(frame(lying, lying, fresh()));
    // снапшот: взята на 510, а мой кадр уже видел 520
    const cur = next(lying, (n) => {
      n.tick = 531;
      n.pickups[0]!.readyAt = 510 + 900;
    });
    const sink = fresh();
    vfx.sync(frame(lying, cur, sink));
    expect(sink.specs.length).toBeGreaterThan(10);
    expect(sink.specs.every((p) => dist(p.pos, ORBS[0]!) < 0.6)).toBe(true);
    const again = fresh();
    vfx.sync(frame(cur, next(cur), again));
    expect(again.specs.length).toBe(0);
    vfx.dispose();
  });

  it("after a background tab the old spawns and takes do not play: the frame window is at most 60 ticks", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const s = after(100, [mage(ME), mage(OTHER, V(-11.9, 0, -11))]);
    s.pickups[RUNE_INDEX]!.readyAt = 100_000;
    vfx.sync(frame(s, s, fresh()));
    const late = next(s, (n) => {
      n.tick = 5001;
      n.pickups[0]!.readyAt = 1000 + 900; // взята давно и уже вернулась
      n.pickups[1]!.readyAt = 4000; // взята давно, вернулась давно
    });
    const sink = fresh();
    vfx.sync(frame(s, late, sink));
    expect(sink.specs.length).toBe(0);
    vfx.dispose();
  });

  it("an orb taken while I stand on it at full HP and a wounded mage is near: the burst is theirs, not my low ring", () => {
    const feet = V(-11.9, 0, -11.25);
    const run = (otherHp: number) => {
      const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
      const prev = after(500, [mage(ME, feet), mage(OTHER, V(-11.9, 0, -10.3))]);
      unit(prev, OTHER).hp = otherHp;
      const cur = next(prev, (n) => (n.pickups[0]!.readyAt = 501 + 900));
      const sink = fresh();
      vfx.sync(frame(prev, cur, sink, { eye: V(feet.x, 1.6, feet.z) }));
      vfx.dispose();
      return sink.specs;
    };
    const theirs = run(60);
    const mine = run(unit(after(0, [mage(OTHER)]), OTHER).maxHp);
    // свой — низкое кольцо у ног; чужой — искры у самой сферы
    expect(theirs.every((p) => dist(p.pos, ORBS[0]!) < 0.6)).toBe(true);
    expect(mine.every((p) => dist(p.pos, ORBS[0]!) < 0.6)).toBe(false);
  });

  it("my own take is low: a ring of sparks along the floor whose paths stay well below my eyes", () => {
    // сфера: стою на ней
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const feet = V(-11.9, 0, -11);
    const prev = after(500, [mage(ME, feet)]);
    const cur = next(prev, (n) => (n.pickups[0]!.readyAt = 501 + 900));
    const sink = fresh();
    vfx.sync(frame(prev, cur, sink, { eye: V(feet.x, 1.6, feet.z) }));
    expect(sink.specs.length).toBeGreaterThan(10);
    expect(sink.specs.length).toBeLessThanOrEqual(40);
    expect(Math.max(...sink.specs.map(peakY))).toBeLessThan(1.6 - 0.4);
    vfx.dispose();

    // руна: взял её я, в шаге от точки
    const fx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const at = V(0.4, 0, 0.6);
    const lying = after(RUNE_AT + 50, [mage(ME, at)]);
    fx.sync(frame(lying, lying, fresh(), { eye: V(at.x, 1.6, at.z) }));
    const took = next(lying, (n) => {
      n.pickups[RUNE_INDEX]!.readyAt = RUNE_AT + 3600;
      unit(n, ME).status.furyUntil = n.tick - 1 + 720;
    });
    const s = fresh();
    fx.sync(frame(lying, took, s, { eye: V(at.x, 1.6, at.z) }));
    expect(s.specs.length).toBeGreaterThan(40);
    expect(s.specs.length).toBeLessThanOrEqual(120);
    expect(Math.max(...s.specs.map(peakY))).toBeLessThan(1.6 - 0.4);
    fx.dispose();
  });

  it("an orb that comes back bursts ≤ 30 sparks from its seal on the floor", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const away = after(1399, []);
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

  it("an object restored by a prediction rollback stands up quietly: no appearance burst, no flash", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const { bodies } = meshes(vfx);
    const at = V(0.4, 0, 0.6);
    const lying = after(RUNE_AT + 50, [mage(ME, at), mage(OTHER, V(-11.9, 0, -11))]);
    vfx.sync(frame(lying, lying, fresh()));
    // предсказано: руну взял я, сферу — другой маг
    const predicted = next(lying, (n) => {
      n.pickups[RUNE_INDEX]!.readyAt = RUNE_AT + 3600;
      unit(n, ME).status.furyUntil = n.tick - 1 + 720;
      n.pickups[0]!.readyAt = n.tick - 1 + 900;
    });
    const taken = fresh();
    vfx.sync(frame(lying, predicted, taken));
    expect(taken.specs.length).toBeGreaterThan(40);
    expect(bodies.count).toBe(5);
    // снапшот хоста: никто ничего не брал
    const restored = next(predicted, (n) => {
      n.pickups[RUNE_INDEX]!.readyAt = RUNE_AT;
      unit(n, ME).status.furyUntil = 0;
      n.pickups[0]!.readyAt = NEVER;
    });
    const back = fresh();
    vfx.sync(frame(predicted, restored, back));
    expect(back.specs.length).toBe(0);
    expect(back.glows.some((g) => g.light === RUNE_FLASH.light)).toBe(false);
    expect([bodies.count, hasRuneBody(bodies)]).toEqual([7, true]);
    vfx.dispose();
  });

  it("no burst when an object goes away untaken (rune moved by the countdown), even with a mage 1.4 m off; the seal fades", () => {
    for (const before of [RUNE_AT + 600, RUNE_AT - 300]) {
      const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
      const { seals } = meshes(vfx);
      const s = after(before, [mage(ME), mage(OTHER, V(1.4, 0, 0))]);
      vfx.sync(frame(s, s, fresh(), { nowS: 10 }));
      const was = runeSeal(seals)!;
      const moved = next(s, (n) => (n.pickups[RUNE_INDEX]!.readyAt = n.tick + 180 + 2700));
      const fades: ({ progress: number; ink: number } | null)[] = [];
      for (let i = 0; i < 45; i++) {
        const sink = fresh();
        vfx.sync(frame(i === 0 ? s : moved, moved, sink, { nowS: 10 + (i + 1) / 60 }));
        expect(sink.specs.length, `${before} / ${i}`).toBe(0);
        fades.push(runeSeal(seals));
      }
      // печать тает с той, что была видна (объявленная — с её доли круга), за 0,6 с
      expect(fades[0]!.progress).toBeCloseTo(was.progress);
      expect(fades[0]!.ink).toBeLessThanOrEqual(was.ink);
      expect(fades[20]!.ink).toBeLessThan(fades[0]!.ink * 0.7);
      expect(fades[Math.ceil(SEAL_FADE_S * 60) + 1]).toBeNull();
      vfx.dispose();
    }
  });

  it("the rune appears with a column of ≤ 120 sparks and a flash; the announcement sparks stop once it lies", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const before = after(RUNE_AT - 1, []);
    vfx.sync(frame(before, before, fresh()));
    const spawned = next(before);
    const sink = fresh();
    vfx.sync(frame(before, spawned, sink));
    expect(sink.specs.length).toBeGreaterThan(60);
    expect(sink.specs.length).toBeLessThanOrEqual(120);
    expect(sink.specs.every((p) => Math.hypot(p.pos.x, p.pos.z) < 1.7)).toBe(true);
    expect(sink.glows.some((g) => g.light === RUNE_FLASH.light && g.prio >= 5)).toBe(true);
    const lying = fresh();
    for (let i = 0; i < 30; i++) vfx.sync(frame(spawned, spawned, lying, { nowS: spawned.tick / 60 + i / 60 }));
    expect(lying.specs.length).toBe(0);
    vfx.dispose();
  });

  it("another mage's rune take bursts at the rune, 1.2 m up", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const lying = after(RUNE_AT + 50, [mage(ME), mage(OTHER, V(0.4, 0, 0.6))]);
    vfx.sync(frame(lying, lying, fresh()));
    const took = next(lying, (n) => {
      n.pickups[RUNE_INDEX]!.readyAt = RUNE_AT + 3600;
      unit(n, OTHER).status.furyUntil = n.tick - 1 + 720;
    });
    const s = fresh();
    vfx.sync(frame(lying, took, s));
    const burst = s.specs.filter((p) => Math.hypot(p.pos.x, p.pos.z) < 1.6);
    expect(burst.length).toBeGreaterThan(40);
    expect(burst.length).toBeLessThanOrEqual(120);
    expect(burst.reduce((a, p) => a + p.pos.y, 0) / burst.length).toBeGreaterThan(1);
    vfx.dispose();
  });
});

describe("pickupVfx: spawn and take on the same tick (the simulation, a mage waiting on the platform)", () => {
  const ctx = matchContext(buildGallery());
  const runeIndex = ctx.pickups!.findIndex((p) => p.kind === "rune");
  /** Шаги симуляции галереи: руна появится на тике 20, waiter ждёт в центре площадки; кадр на каждый тик. */
  function run(waiter: UnitId, eye: Vec3) {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const { bodies, seals } = meshes(vfx);
    let s = createMatchState([mage(ME, waiter === ME ? V() : HOME), mage(OTHER, waiter === OTHER ? V() : V(10, 0, 9))]);
    s.pickups = initPickups(ctx.pickups!, 0);
    s.pickups[runeIndex]!.readyAt = 20;
    const frames: { sink: Sink; runeBody: boolean; seal: { progress: number; ink: number } | null; fury: boolean }[] = [];
    for (let k = 0; k < 70; k++) {
      const n = stepMatch(s, {}, ctx).state;
      const sink = fresh();
      vfx.sync(frame(s, n, sink, { nowS: k / 60, eye }));
      frames.push({ sink, runeBody: hasRuneBody(bodies), seal: runeSeal(seals), fury: unit(n, waiter).status.furyUntil > 0 });
      s = n;
    }
    vfx.dispose();
    const takeAt = frames.findIndex((f) => f.fury);
    return { frames, takeAt };
  }

  it("another mage takes it at once: the column, the flash and the take burst still play, and the seal fades", () => {
    const { frames, takeAt } = run(OTHER, EYE);
    expect(takeAt).toBeGreaterThan(0);
    expect(frames.every((f) => !f.runeBody)).toBe(true);
    const hit = frames[takeAt]!.sink;
    // столб — из печати вверх, всплеск взятия — у руны на 1,2 м
    expect(hit.specs.filter((p) => Math.hypot(p.pos.x, p.pos.z) < 0.7 && p.pos.y < 0.3 && p.vel.y > 3).length).toBeGreaterThan(20);
    expect(hit.specs.filter((p) => p.pos.y > 0.8 && p.pos.y < 1.6 && Math.hypot(p.pos.x, p.pos.z) < 1.6).length).toBeGreaterThan(40);
    expect(hit.glows.some((g) => g.light === RUNE_FLASH.light)).toBe(true);
    // печать: полная тает за 0,6 с, без рывка
    expect(frames[takeAt]!.seal!.progress).toBe(1);
    expect(frames[takeAt + 12]!.seal!.ink).toBeLessThan(frames[takeAt]!.seal!.ink);
    expect(frames[takeAt + Math.ceil(SEAL_FADE_S * 60) + 1]!.seal).toBeNull();
    // объявление после взятия молчит: искр к центру нет
    expect(frames.slice(takeAt + 1).every((f) => f.sink.specs.every((p) => p.pos.y > 0.4 || Math.hypot(p.pos.x, p.pos.z) < 1.2))).toBe(true);
  });

  it("I take it at once standing in the centre: no column through my camera, the take is low, the flash has no halo at my eyes", () => {
    const { frames, takeAt } = run(ME, V(0, 1.6, 0));
    expect(takeAt).toBeGreaterThan(0);
    const hit = frames[takeAt]!.sink;
    expect(hit.specs.length).toBeGreaterThan(40);
    expect(Math.max(...hit.specs.map(peakY))).toBeLessThan(1.6 - 0.4);
    const flash = hit.glows.find((g) => g.light === RUNE_FLASH.light)!;
    expect(flash.halo).toBeLessThan(0.2);
    expect(flash.core).toBeLessThan(0.1);
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
    const early = after(RUNE_AT - 700, []);
    vfx.sync(frame(early, early, fresh()));
    expect(seals.count).toBe(6);
    const warn = after(RUNE_AT - 300, []);
    const sink = fresh();
    for (let i = 0; i < 60; i++) vfx.sync(frame(warn, warn, sink, { tick: RUNE_AT - 299 + i * 0.5 }));
    expect(seals.count).toBe(7);
    expect(runeSeal(seals)!.progress).toBeGreaterThan(0.5);
    // к центру тянутся золотые искры: рождаются на круге печати и летят внутрь
    expect(sink.specs.length).toBeGreaterThan(5);
    for (const p of sink.specs) {
      const r0 = Math.hypot(p.pos.x, p.pos.z);
      expect(r0).toBeGreaterThan(1);
      expect(Math.hypot(p.pos.x + p.vel.x * p.life, p.pos.z + p.vel.z * p.life)).toBeLessThan(r0);
    }
    vfx.dispose();
  });

  it("the announcement glow lights the platform only past 0.3 of the circle and has no halo at the eyes of a mage in the centre", () => {
    const warnGlow = (now: number, eye: Vec3) => {
      const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
      const s = after(now, []);
      const sink = fresh();
      vfx.sync(frame(s, s, sink, { eye }));
      vfx.dispose();
      return sink.glows.find((g) => g.prio === RUNE_PRIO && Math.hypot(g.pos.x, g.pos.z) < 0.01)!;
    };
    expect(warnGlow(RUNE_AT - 480, EYE).light).toBe(0);
    const far = warnGlow(RUNE_AT - 120, EYE);
    expect(far.light).toBeGreaterThan(0);
    expect(far.halo).toBeGreaterThan(0.25);
    expect(warnGlow(RUNE_AT - 120, V(0, 1.6, 0)).halo).toBeLessThan(0.05);
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

  it("only a live mage with furyUntil > now glows gold at the chest; mine sparks beside the palms, with no glow at the camera", () => {
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const other = mage(OTHER, V(4, 0, -12));
    const me = mage(ME);
    other.status.furyUntil = 1000;
    me.status.furyUntil = 1000;
    const s = after(500, [me, other]);
    const chest = V(4, 1.3, -12);
    const sink = fresh();
    for (let i = 0; i < 60; i++) vfx.sync(frame(s, s, sink, { tick: 501 + i * 0.2, nowS: 10 + i / 60 }));
    const atChest = sink.glows.filter((g) => dist(g.pos, chest) < 0.2);
    expect(atChest.length).toBe(60);
    expect(atChest.every((g) => g.light === FURY_LIGHT_M && g.color === GOLD.light && g.prio === FURY_PRIO)).toBe(true);
    // на 20 м ореол не меньше 0,4 м: носителя видно издалека
    expect(Math.min(...atChest.map((g) => g.halo))).toBeGreaterThan(0.4);
    expect(sink.glows.some((g) => dist(g.pos, V(0, 1.3, 8)) < 1.5)).toBe(false);
    // искры за чужим носителем ≤ 20 в секунду
    const motes = sink.specs.filter((p) => dist(p.pos, chest) < 1.3);
    expect(motes.length).toBeGreaterThan(FURY_MOTE_RATE / 2);
    expect(motes.length).toBeLessThanOrEqual(20);
    // свои — в 8–12 см от ладони наружу и вниз: варежка их не прячет, прицел чист
    const palms = sink.specs.filter((p) => dist(p.pos, PALM) < 0.2);
    expect(palms.length).toBeGreaterThan(3);
    for (const p of palms) {
      expect(dist(p.pos, PALM)).toBeGreaterThan(0.075);
      expect(dist(p.pos, PALM)).toBeLessThan(0.125);
      expect(p.pos.y).toBeLessThan(PALM.y - 0.04);
      expect(Math.abs(p.pos.x - PALM.x)).toBeGreaterThan(0.05);
    }
    expect(palms.some((p) => p.pos.x < PALM.x) && palms.some((p) => p.pos.x > PALM.x)).toBe(true);
    expect(sink.specs.every((p) => dist(p.pos, chest) < 1.3 || dist(p.pos, PALM) < 0.2)).toBe(true);

    // гаснет: последние 0,6 с свет на мир уже не держит источник, ореол ещё есть
    const fading = after(985, [mage(ME), other]);
    const dim = fresh();
    vfx.sync(frame(fading, fading, dim));
    const g = dim.glows.find((q) => dist(q.pos, chest) < 0.2)!;
    expect([g.light, g.halo > 0]).toEqual([0, true]);
    // время вышло — нет свечения; мёртвый носитель — тоже
    const over = after(999, [mage(ME), other]);
    const late = fresh();
    vfx.sync(frame(over, over, late));
    expect(late.glows.some((q) => dist(q.pos, chest) < 0.2)).toBe(false);
    other.alive = false;
    const dead = after(600, [mage(ME), other]);
    const gone = fresh();
    vfx.sync(frame(dead, dead, gone));
    expect(gone.glows.some((q) => dist(q.pos, chest) < 0.2)).toBe(false);
    vfx.dispose();
  });
});

describe("pickupVfx: gold, light and budget", () => {
  it("light priorities: orbs and the holder under mages' hands, the rune between hands and burning", () => {
    expect(ORB_PRIO).toBeLessThan(FURY_PRIO);
    expect(FURY_PRIO).toBeLessThan(HAND_PRIO);
    expect(RUNE_PRIO).toBeGreaterThan(HAND_PRIO);
    expect(RUNE_PRIO).toBeLessThan(BURN_PRIO);
    const vfx = createPickupVfx({ gbuffer, time: { value: 0 } });
    const s = after(RUNE_AT + 200, []);
    const sink = fresh();
    vfx.sync(frame(s, s, sink));
    const orbs = sink.glows.filter((g) => g.light === ORB_LIGHT_M);
    expect(orbs.length).toBe(6);
    expect(orbs.every((g) => g.prio === ORB_PRIO && g.color === GOLD.light)).toBe(true);
    const rune = sink.glows.filter((g) => g.light === RUNE_LIGHT_M);
    expect(rune.map((g) => g.prio)).toEqual([RUNE_PRIO]);
    vfx.dispose();
  });

  it("the pickup bursts are gold, not fire, and within their caps", () => {
    const caps = { orbSpawn: 30, orbTake: 40, orbTakeOwn: 40, runeSpawn: 120, runeTake: 120, runeTakeOwn: 120, furyMote: 2 } as const;
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
