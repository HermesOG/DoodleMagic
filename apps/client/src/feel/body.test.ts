import { describe, expect, it } from "vitest";
import { createMageUnit, createMatchState, type MatchState } from "@doodlemagic/sim";
import { EYE_STEP, MOVE_SOUND, createEyeSmooth, createMoveTracker, stepEyeSmooth, trackMovement } from "./body";
import type { Effect } from "./effects";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });

describe("eye smoothing on stairs (round3/01, M1)", () => {
  it("absorbs a 0.4 m step on the floor and lets it fade with τ 0.07 s; jumps and respawns pass as they are", () => {
    // состояние меняется на месте: копии — чтобы проверить ветки от одного и того же «после ступени»
    const s = createEyeSmooth();
    stepEyeSmooth(s, 1.6, true, 1 / 60);
    expect(stepEyeSmooth(s, 2.0, true, 0)).toBeCloseTo(1.6);
    const after = { ...s };
    expect(stepEyeSmooth(s, 2.0, true, EYE_STEP.tauS)).toBeCloseTo(2.0 - 0.4 / Math.E);
    expect(stepEyeSmooth(s, 2.0, true, 1)).toBeCloseTo(2.0, 3);
    // в воздухе (прыжок) новое смещение не копится; скачок больше 0,55 м (возрождение) — как есть и без хвоста
    expect(stepEyeSmooth({ ...after }, 2.5, false, 0)).toBeCloseTo(2.5 - 0.4);
    expect(stepEyeSmooth({ ...after }, 12, true, 0)).toBe(12);
  });
});

describe("movement sounds (round3/01, M2)", () => {
  const run = (frames: (u: ReturnType<typeof createMageUnit>, k: number) => void, n: number, localId = 1, rewindEvery = 0): Effect[] => {
    const t = createMoveTracker();
    const out: Effect[] = [];
    const me = createMageUnit(1, "fire", { pos: V(), yaw: 0 });
    const other = createMageUnit(2, "earth", { pos: V(10, 0, 0), yaw: 0 });
    for (let k = 0; k < n; k++) {
      frames(me, k);
      frames(other, k);
      const state: MatchState = { ...createMatchState([me, other]), tick: k };
      trackMovement(t, state, localId, (e) => out.push(e));
      // перемотка сети: тот же тик (и более ранний) приходит ещё раз
      if (rewindEvery && k % rewindEvery === 0) {
        trackMovement(t, state, localId, (e) => out.push(e));
        trackMovement(t, { ...state, tick: k - 1 }, localId, (e) => out.push(e));
      }
    }
    return out;
  };
  const steps = (es: Effect[]) => es.filter((e) => e.kind === "sound" && e.id === "step");

  it("steps every 1.1 m on the floor above 2 m/s: own quietly at the ear, another mage where he runs", () => {
    // 1 с бега 6,5 м/с при 60 Гц: 6,5 м пути — 5 шагов на каждого
    const es = run((u, k) => {
      u.move.body.pos.z = -(6.5 / 60) * (k + 1);
      u.move.body.vel.z = -6.5;
      u.move.onGround = true;
    }, 60);
    const s = steps(es);
    expect(s.length).toBe(2 * Math.floor(6.5 / MOVE_SOUND.stepM));
    expect(s.filter((e) => e.kind === "sound" && e.pos === null && e.gain === 0.2).length).toBe(5);
    expect(s.filter((e) => e.kind === "sound" && e.pos !== null && e.gain === 0.5).length).toBe(5);
  });

  it("a replayed or older tick (a network rewind) does not step or land twice", () => {
    const frames = (u: ReturnType<typeof createMageUnit>, k: number) => {
      u.move.body.pos.z = -(6.5 / 60) * (k + 1);
      u.move.body.vel.z = -6.5;
      u.move.onGround = true;
    };
    expect(steps(run(frames, 60, 1, 3)).length).toBe(steps(run(frames, 60)).length);
  });

  it("walking slower than 2 m/s or flying is silent; a jump rustles, a landing thumps by its speed", () => {
    expect(
      steps(run((u, k) => {
        u.move.body.pos.z = -(1.5 / 60) * k;
        u.move.body.vel.z = -1.5;
        u.move.onGround = true;
      }, 120)),
    ).toEqual([]);
    const es = run((u, k) => {
      u.move.onGround = k < 2 || k >= 40;
      u.move.body.vel.y = k === 2 ? 7 : k < 40 ? -6 : 0;
      u.move.body.pos.y = k >= 2 && k < 40 ? 0.5 : 0;
    }, 42);
    const by = (id: string) => es.filter((e) => e.kind === "sound" && e.id === id);
    expect(by("jump").length).toBe(2);
    expect(by("land")).toContainEqual({ kind: "sound", id: "land", pos: null, gain: 0.5 });
  });
});
