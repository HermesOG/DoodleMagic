import { describe, expect, it } from "vitest";
import { createDummyUnit, createMageUnit, createMatchState, type MatchEvent } from "@doodlemagic/sim";
import { createGestures, startGesture, stepGestures } from "../hands/gestures";
import { RECOIL, SHAKE, addFeel, addLanding, createCameraFeel, recoilKick, stepCameraFeel } from "./camera";
import type { Effect } from "./effects";
import { effectsFor } from "./eventMap";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const me = { localId: 1, state: createMatchState([createMageUnit(1, "fire", { pos: V(), yaw: 0 }), createDummyUnit(2, { pos: V(0, 0, -10), yaw: 0 })]) };
const fx = (ev: MatchEvent) => effectsFor(ev, me);
const kinds = (ev: MatchEvent) => fx(ev).map((e) => e.kind);
const hitOn = (target: number, over: Partial<Extract<MatchEvent, { type: "hit" }>> = {}): MatchEvent => ({
  type: "hit", source: target === 1 ? 2 : 1, target, ability: "fireFists", amount: 12, pos: V(0, 1, -9.6), dir: V(0, 0, -1),
  knock: { distM: 0.12, upM: 0 }, airborne: false, dot: false, killed: false, ...over,
});
const cast = (unit: number): MatchEvent => ({ type: "cast", unit, ability: "fireFists", slot: "primary", pos: V(0, 1.6, 0), dir: V(0, 0, -1) });

describe("effectsFor", () => {
  it("gives my cast a gesture, a palm flash, a sound and recoil on the same frame, no shake; not for others", () => {
    expect(kinds(cast(1))).toEqual(expect.arrayContaining(["gesture", "palm", "sound", "kick"]));
    expect(kinds(cast(1))).not.toContain("trauma");
    expect(kinds(cast(1)).indexOf("gesture")).toBeLessThan(kinds(cast(1)).indexOf("palm"));
    expect(kinds(cast(2))).not.toContain("gesture");
  });

  it("splits a hit: the impact shows in the world, the hit confirms it", () => {
    const impact = kinds({ type: "impact", ability: "fireFists", owner: 1, pos: V(0, 1, -9.6), normal: V(0, 0, 1), target: 2, terrain: -1 });
    expect([impact.includes("burst"), impact.includes("sound"), impact.includes("hitmarker")]).toEqual([true, true, false]);
    expect(kinds(hitOn(2))).toEqual(expect.arrayContaining(["hitmarker", "number", "flash", "flinch", "sound"]));
    // кулак 5 раз/с — без паузы; камень — 30 мс (round3/01, 2.1)
    expect(kinds(hitOn(2))).not.toContain("hitstop");
    expect(fx(hitOn(2, { ability: "stoneShot", amount: 30 }))).toContainEqual({ kind: "hitstop", ms: 30 });
    expect(kinds(hitOn(2))).not.toContain("trauma");
  });

  it("shakes me and pushes my camera ≤ 1.25° away from the source when I am hit, never for damage over time", () => {
    const got = fx(hitOn(1, { ability: "fireball", amount: 50, dir: V(0, 0, 1), knock: { distM: 3, upM: 1.2 } }));
    expect(got).toContainEqual(expect.objectContaining({ kind: "trauma", amount: 0.35, profile: "fire" })); // ещё 0,15 даёт взрыв рядом
    const kick = got.find((e) => e.kind === "kick");
    expect(kick?.kind === "kick" && Math.abs(kick.pitchDeg) + Math.abs(kick.yawDeg) <= 1.25 + 1e-12).toBe(true);
    expect([got.some((e) => e.kind === "indicator"), got.some((e) => e.kind === "hitmarker")]).toEqual([true, false]);
    expect(kinds(hitOn(1, { ability: "burning", amount: 3, dot: true })).filter((k) => k === "trauma" || k === "kick")).toEqual([]);
  });

  it("punches the FOV on a dash, marks kills, ring-outs and «Кураж», fizzles bad casts, wiggles on cooldown", () => {
    expect(fx({ type: "dash", unit: 1, ability: "jetDash", phase: "start", pos: V(), dir: V(1, 0, 0) })).toContainEqual(expect.objectContaining({ kind: "fov", deg: 8 }));
    expect(fx(hitOn(2, { killed: true }))).toContainEqual(expect.objectContaining({ kind: "hitmarker", kill: true }));
    expect(fx({ type: "fall", target: 2, credit: 1, pos: V(2, -4, -3) })).toContainEqual(expect.objectContaining({ kind: "toast", text: "Сброс!" }));
    expect(fx({ type: "courage", unit: 1 })).toContainEqual(expect.objectContaining({ kind: "toast", text: "Кураж!" }));
    expect(kinds({ type: "reject", unit: 1, slot: "q", reason: "notGrounded" })).toEqual(expect.arrayContaining(["palm", "sound", "toast"]));
    expect(kinds({ type: "reject", unit: 1, slot: "q", reason: "cooldown" })).toEqual(["deny"]);
  });

  // выпуск камня ≈ 1,9 раза в секунду: крошка у рук, а не в глазах; добивание горением — тоже убийство
  it("drops the stone crumble by the hands, not in my eyes, and marks a kill by burning", () => {
    const eye = V(0, 1.6, 0);
    const rel = fx({ type: "release", unit: 1, ability: "stoneShot", projectile: 1000, pos: eye, dir: V(0, 0, -1) });
    const crumble = rel.find((e) => e.kind === "burst");
    expect(crumble?.kind === "burst" && [crumble.preset, crumble.pos.z < eye.z - 0.5, crumble.pos.y < eye.y - 0.2]).toEqual(["stoneCrumble", true, true]);
    const burnKill = fx(hitOn(2, { ability: "burning", amount: 3, dot: true, killed: true }));
    expect(burnKill).toContainEqual(expect.objectContaining({ kind: "hitmarker", kill: true }));
    expect(burnKill.map((e) => e.kind)).not.toContain("hitstop");
    expect(kinds(hitOn(2, { ability: "burning", amount: 3, dot: true }))).toEqual(["number"]);
  });
});

describe("camera feel", () => {
  const deg = Math.PI / 180;

  it("caps trauma at 1, decays it at 1.5/s, shakes ≤ 0.8° and ≤ 12 cm per axis (round3/01, H1)", () => {
    let f = addFeel(addFeel(createCameraFeel(), { kind: "trauma", amount: 0.7 }), { kind: "trauma", amount: 0.7 });
    expect([f.trauma, Number(stepCameraFeel(f, 0.5, 1).feel.trauma.toFixed(9))]).toEqual([1, 0.25]);
    let rot = 0;
    let shift = 0;
    for (let k = 0; k < 240; k++) {
      const r = stepCameraFeel(f, 1 / 120, 1);
      f = { ...r.feel, trauma: 1, traumaEarth: 1 };
      rot = Math.max(rot, Math.abs(r.offset.pitch), Math.abs(r.offset.yaw));
      shift = Math.max(shift, Math.abs(r.offset.x), Math.abs(r.offset.y));
    }
    expect([rot > 0.4 * deg, rot <= 0.8 * deg + 1e-12, shift > 0.06, shift <= 0.12 + 1e-12]).toEqual([true, true, true, true]);
  });

  it("a fireball on the victim moves the camera ≈ 3 cm; Earth shakes slower, longer and pulls the camera down", () => {
    const peak = (profile: "fire" | "earth", amount: number) => {
      let f = addFeel(createCameraFeel(), { kind: "trauma", amount, profile });
      let shift = 0;
      let y = 0;
      let crossings = 0;
      let prev = 0;
      for (let k = 0; k < 60; k++) {
        const r = stepCameraFeel(f, 1 / 240, 1);
        f = r.feel;
        shift = Math.max(shift, Math.abs(r.offset.x));
        y += r.offset.y;
        if (prev !== 0 && Math.sign(r.offset.x) !== Math.sign(prev)) crossings++;
        prev = r.offset.x;
      }
      return { shift, y, crossings, left: profile === "fire" ? f.trauma : f.traumaEarth };
    };
    const fire = peak("fire", 0.5);
    const earth = peak("earth", 0.65);
    expect([fire.shift > 0.01, fire.shift <= 0.03 + 1e-12]).toEqual([true, true]);
    expect([earth.shift > 0.03, earth.y < 0, earth.crossings < fire.crossings, earth.left > fire.left]).toEqual([true, true, true, true]);
  });

  it("a ground slam drops the camera, a landing sinks it by 0.006 m per m/s (≤ 8 cm), both settle; no lift at motion 0", () => {
    const deepest = (f: ReturnType<typeof createCameraFeel>) => {
      let lo = 0;
      let at = 0;
      for (let k = 1; k <= 120; k++) {
        const r = stepCameraFeel(f, 1 / 240, 1);
        f = r.feel;
        if (r.offset.lift < lo) [lo, at] = [r.offset.lift, k / 240];
      }
      return { lo, at, end: stepCameraFeel(f, 0.5, 1).offset.lift };
    };
    const slam = deepest(addFeel(createCameraFeel(), { kind: "kick", pitchDeg: -1.2, yawDeg: 0, rollDeg: 0, dropM: 0.04 }));
    expect([slam.lo, slam.at]).toEqual([expect.closeTo(-0.04, 4), expect.closeTo(1 / 12, 1)]);
    expect(deepest(addLanding(createCameraFeel(), -7)).lo).toBeCloseTo(-0.042, 4);
    expect(deepest(addLanding(createCameraFeel(), -14)).lo).toBeCloseTo(-0.08, 4);
    expect(addLanding(createCameraFeel(), -0.17)).toEqual(createCameraFeel());
    expect(Math.abs(slam.end)).toBeLessThan(0.002);
    expect(stepCameraFeel(addLanding(createCameraFeel(), -14), 1 / 60, 0).offset.lift).toBe(0);
  });

  it("peaks a kick at its amount and settles it within 0.25 s", () => {
    let f = addFeel(createCameraFeel(), { kind: "kick", pitchDeg: 1.5, yawDeg: 0, rollDeg: 0 });
    const path: number[] = [];
    for (let k = 0; k < 30; k++) {
      const r = stepCameraFeel(f, 1 / 120, 1);
      f = r.feel;
      path.push(r.offset.pitch / (1.5 * deg));
    }
    expect([Math.max(...path) > 0.9, Math.max(...path) < 1.05, Math.abs(path.at(-1)!) < 0.1]).toEqual([true, true, true]);
  });

  it("recoils an LMB shot on its own fast spring: peak at 25 ms, sideways by the punching hand, off at camera motion 0 (phase 9, Р6)", () => {
    const trace = (e: Effect, hand: "left" | "right", motion = 1) => {
      let f = addFeel(createCameraFeel(), e, hand);
      let top = 0;
      let at = 0;
      let yawTop = 0;
      for (let k = 1; k <= 200; k++) {
        const r = stepCameraFeel(f, 1 / 1000, motion);
        f = r.feel;
        if (r.offset.pitch > top) [top, at] = [r.offset.pitch, k / 1000];
        if (Math.abs(r.offset.yaw) > Math.abs(yawTop)) yawTop = r.offset.yaw;
      }
      return { top: top / deg, at, yaw: yawTop / deg, end: stepCameraFeel(f, 0, motion).offset.pitch / deg };
    };
    const fist = recoilKick(RECOIL.fist, true);
    const right = trace(fist, "right");
    expect([right.top, right.at, right.yaw]).toEqual([expect.closeTo(0.6, 3), expect.closeTo(1 / SHAKE.recoilOmega, 3), expect.closeTo(0.15, 3)]);
    // к 200 мс камера на месте: к следующему кулаку (через 250 мс) прицел стоит
    expect(Math.abs(right.end)).toBeLessThan(0.01);
    expect(trace(fist, "left").yaw).toBeCloseTo(-0.15, 3);
    // хлыст бьёт только правой: вбок всегда в одну сторону
    expect(trace(recoilKick(RECOIL.whipStrike), "left").yaw).toBeCloseTo(0.25, 3);
    expect(SHAKE.recoilOmega).toBe(40);
    // прочие толчки — на прежней пружине ω 25
    expect(trace({ kind: "kick", pitchDeg: 1, yawDeg: 0, rollDeg: 0 }, "right").at).toBeCloseTo(1 / SHAKE.kickOmega, 3);
    // ползунок «Движение камеры» гасит отдачу целиком
    const still = trace(fist, "right", 0);
    expect([still.top, still.yaw]).toEqual([0, 0]);
    expect([RECOIL.fist, RECOIL.stoneCast.pitchDeg, RECOIL.stoneThrow.pitchDeg, RECOIL.sickle, RECOIL.whipCast.pitchDeg, RECOIL.whipStrike]).toEqual([
      { pitchDeg: 0.6, yawDeg: 0.15 }, 0, 0.9, { pitchDeg: 0.4, yawDeg: 0.2 }, 0.1, { pitchDeg: 0.6, yawDeg: 0.25 },
    ]);
  });

  it("punches the FOV as an impulse: the dash's +8° peaks within ≈ 35 ms and eases back; still at camera motion 0 (M3)", () => {
    let f = addFeel(createCameraFeel(), { kind: "fov", deg: 8 });
    let top = 0;
    let at = 0;
    for (let k = 1; k <= 240; k++) {
      const r = stepCameraFeel(f, 1 / 1000, 1);
      f = r.feel;
      if (r.offset.fovDeg > top) [top, at] = [r.offset.fovDeg, k / 1000];
    }
    expect([top, at]).toEqual([expect.closeTo(8, 3), expect.closeTo(1 / 30, 2)]);
    let r = stepCameraFeel(f, 0.3, 1);
    expect(r.offset.fovDeg).toBeLessThan(1);
    r = stepCameraFeel(r.feel, 0.5, 1);
    expect(r.offset.fovDeg).toBeLessThan(0.05);
    const busy = addFeel(addFeel(createCameraFeel(), { kind: "trauma", amount: 1 }), { kind: "kick", pitchDeg: 1, yawDeg: 1, rollDeg: 3, dropM: 0.04 });
    expect(stepCameraFeel(addFeel(busy, { kind: "fov", deg: 8 }), 1 / 60, 0, true).offset).toEqual({ x: 0, y: 0, pitch: 0, yaw: 0, roll: 0, fovDeg: 0, lift: 0 });
  });

  // одно и то же движение при 30, 60 и 144 Гц: сравниваем в общие моменты, кратные 1/6 с
  it("plays the same shake, kick, FOV punch and hand gestures at 30, 60 and 144 Hz", () => {
    const start: Effect[] = [
      { kind: "trauma", amount: 0.8 },
      { kind: "trauma", amount: 0.6, profile: "earth" },
      { kind: "kick", pitchDeg: 1.5, yawDeg: -0.7, rollDeg: 3, dropM: 0.04 },
      { kind: "fov", deg: 6 },
    ];
    const play = (hz: number): number[][] => {
      let f = start.reduce((acc, e) => addFeel(acc, e), createCameraFeel());
      let g = startGesture(startGesture(createGestures(), "fireball"), "fireFists");
      const out: number[][] = [];
      for (let sample = 0; sample < 6; sample++) {
        let row: number[] = [];
        for (let k = 0; k < hz / 6; k++) {
          const r = stepCameraFeel(f, 1 / hz, 1, true);
          const h = stepGestures(g, 1 / hz);
          [f, g] = [r.feel, h.state];
          row = [...Object.values(r.offset), ...Object.values(h.pose.right), ...Object.values(h.pose.left)];
        }
        out.push(row);
      }
      return out;
    };
    const ref = play(60);
    for (const hz of [30, 144]) {
      const got = play(hz);
      const diff = Math.max(...got.flatMap((row, i) => row.map((v, j) => Math.abs(v - ref[i]![j]!))));
      expect(diff).toBeLessThan(1e-9);
    }
    // движение действительно есть: сравнение не пустое
    expect(ref[0]!.some((v) => Math.abs(v) > 1e-3)).toBe(true);
  });
});
