import { describe, expect, it } from "vitest";
import { createDummyUnit, createMageUnit, createMatchState, type MatchEvent } from "@doodlemagic/sim";
import { createGestures, startGesture, stepGestures } from "../hands/gestures";
import { addFeel, createCameraFeel, stepCameraFeel } from "./camera";
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
    expect(kinds(hitOn(2))).toEqual(expect.arrayContaining(["hitmarker", "number", "flash", "flinch", "sound", "hitstop"]));
    expect(kinds(hitOn(2))).not.toContain("trauma");
  });

  it("shakes me and pushes my camera ≤ 1° away from the source when I am hit, never for damage over time", () => {
    const got = fx(hitOn(1, { ability: "fireball", amount: 50, dir: V(0, 0, 1), knock: { distM: 3, upM: 1.2 } }));
    expect(got).toContainEqual(expect.objectContaining({ kind: "trauma", amount: 0.35 }));
    const kick = got.find((e) => e.kind === "kick");
    expect(kick?.kind === "kick" && Math.abs(kick.pitchDeg) + Math.abs(kick.yawDeg) <= 1).toBe(true);
    expect([got.some((e) => e.kind === "indicator"), got.some((e) => e.kind === "hitmarker")]).toEqual([true, false]);
    expect(kinds(hitOn(1, { ability: "burning", amount: 3, dot: true })).filter((k) => k === "trauma" || k === "kick")).toEqual([]);
  });

  it("punches the FOV on a dash, marks kills, ring-outs and «Кураж», fizzles bad casts, wiggles on cooldown", () => {
    expect(fx({ type: "dash", unit: 1, phase: "start", pos: V(), dir: V(1, 0, 0) })).toContainEqual(expect.objectContaining({ kind: "fov", deg: 6 }));
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

  it("caps trauma at 1, decays it at 1.5/s, shakes ≤ 0.5° and ≤ 5 cm per axis", () => {
    let f = addFeel(addFeel(createCameraFeel(), { kind: "trauma", amount: 0.7 }), { kind: "trauma", amount: 0.7 });
    expect([f.trauma, Number(stepCameraFeel(f, 0.5, 1).feel.trauma.toFixed(9))]).toEqual([1, 0.25]);
    let rot = 0;
    let shift = 0;
    for (let k = 0; k < 240; k++) {
      const r = stepCameraFeel(f, 1 / 120, 1);
      f = { ...r.feel, trauma: 1 };
      rot = Math.max(rot, Math.abs(r.offset.pitch), Math.abs(r.offset.yaw));
      shift = Math.max(shift, Math.abs(r.offset.x), Math.abs(r.offset.y));
    }
    expect([rot > 0, rot <= 0.5 * deg + 1e-12, shift <= 0.05 + 1e-12]).toEqual([true, true, true]);
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

  it("holds a FOV punch, eases it back, and keeps the camera still at camera motion 0", () => {
    let r = stepCameraFeel(addFeel(createCameraFeel(), { kind: "fov", deg: 6, holdS: 0.2 }), 0.1, 1);
    expect(r.offset.fovDeg).toBeGreaterThan(3);
    for (let k = 0; k < 60; k++) r = stepCameraFeel(r.feel, 1 / 60, 1);
    expect(r.offset.fovDeg).toBeLessThan(0.2);
    const busy = addFeel(addFeel(createCameraFeel(), { kind: "trauma", amount: 1 }), { kind: "kick", pitchDeg: 1, yawDeg: 1, rollDeg: 3 });
    expect(stepCameraFeel(busy, 1 / 60, 0, true).offset).toEqual({ x: 0, y: 0, pitch: 0, yaw: 0, roll: 0, fovDeg: 0 });
  });

  // одно и то же движение при 30, 60 и 144 Гц: сравниваем в общие моменты, кратные 1/6 с
  it("plays the same shake, kick, FOV punch and hand gestures at 30, 60 and 144 Hz", () => {
    const start: Effect[] = [
      { kind: "trauma", amount: 0.8 },
      { kind: "kick", pitchDeg: 1.5, yawDeg: -0.7, rollDeg: 3 },
      { kind: "fov", deg: 6, holdS: 0.15 },
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
