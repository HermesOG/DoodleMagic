import { describe, expect, it } from "vitest";
import { createMageUnit, createMatchState, eyeOf, type MatchState, type Projectile, type ProjectileKind, type Vec3 } from "@doodlemagic/sim";
import type { Effect } from "./effects";
import { WHIZZ, WHIZZ_SOUND, createWhizzFrame, whizzGain } from "./whizz";

const V = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const ME = 1;
const base = createMatchState([
  createMageUnit(ME, "fire", { pos: V(), yaw: 0 }),
  createMageUnit(2, "earth", { pos: V(0, 0, -20), yaw: 0 }),
  createMageUnit(3, "air", { pos: V(5, 0, -20), yaw: 0 }),
  createMageUnit(4, "water", { pos: V(-5, 0, -20), yaw: 0 }),
]);
const EYE = eyeOf(base.units[0]!);
/** Снаряд в точке: x — вбок от глаз, z — вдоль (минус — впереди). */
const shot = (id: number, owner: number, x: number, z: number, ability: ProjectileKind = "fireFists"): Projectile => ({
  id, owner, ability, pos: V(x, EYE.y, z), vel: V(0, 0, 50), bornTick: 0, endTick: 100, power: 15,
});
const state = (projectiles: Projectile[], over: Partial<MatchState> = {}): MatchState => ({ ...base, projectiles, ...over });
const sounds = (es: Effect[]) => es.filter((e): e is Extract<Effect, { kind: "sound" }> => e.kind === "sound");

describe("whizz-by (phase 9, L12)", () => {
  it("whistles once for a foreign shot that went past my ear, louder the closer, from the nearest point", () => {
    const w = createWhizzFrame();
    const at = (projectiles: Projectile[], nowS: number) => w({ prev: state(projectiles), cur: state(projectiles), alpha: 0, localId: ME, nowS, dtS: 1 / 60 });
    expect(at([shot(10, 2, 1, -5)], 0)).toEqual([]);
    const out = sounds(at([shot(10, 2, 1, 5)], 0.02));
    expect(out).toEqual([{ kind: "sound", id: "whizzFire", pos: { x: 1, y: EYE.y, z: expect.closeTo(0, 9) }, gain: expect.closeTo(0.3 + 0.7 * (1 - 1 / 1.5), 9), floor: 1 }]);
    // второго свиста у того же снаряда нет
    expect(at([shot(10, 2, 1, 9)], 0.04)).toEqual([]);
    expect([whizzGain(0), whizzGain(0.75), whizzGain(1.5)]).toEqual([1, expect.closeTo(0.65, 9), expect.closeTo(0.3, 9)]);
    expect(WHIZZ).toMatchObject({ radiusM: 1.5, maxPerS: 2, shooterGapS: 0.5 });
  });

  it("waits while the shot still flies at me: one that hits me vanishes before it passes and never whistles", () => {
    const w = createWhizzFrame();
    const at = (projectiles: Projectile[], nowS: number) => w({ prev: state(projectiles), cur: state(projectiles), alpha: 0, localId: ME, nowS, dtS: 1 / 60 });
    at([shot(10, 2, 0.3, -6)], 0);
    // ближняя точка — в конце отрезка (снаряд ещё летит в лицо): рано
    expect(at([shot(10, 2, 0.3, -1)], 0.02)).toEqual([]);
    // попал: снаряд исчез
    expect(at([], 0.04)).toEqual([]);
    // а этот прошёл мимо на следующем кадре
    at([shot(11, 2, 1.2, -4)], 1);
    expect(at([shot(11, 2, 1.2, -0.5)], 1.02)).toEqual([]);
    expect(sounds(at([shot(11, 2, 1.2, 3)], 1.04)).map((e) => e.id)).toEqual(["whizzFire"]);
  });

  it("reads the segment between frames: a fast shot that crossed my ear between two frames still whistles; a still one never does", () => {
    const w = createWhizzFrame();
    const at = (projectiles: Projectile[], nowS: number) => w({ prev: state(projectiles), cur: state(projectiles), alpha: 0, localId: ME, nowS, dtS: 1 / 30 });
    at([shot(10, 2, 0.5, -10, "stoneShot")], 0);
    expect(sounds(at([shot(10, 2, 0.5, 10, "stoneShot")], 0.033)).map((e) => e.id)).toEqual(["whizzStone"]);
    // кадр без нового тика: отрезка нет, свиста нет, даже у самого уха
    const v = createWhizzFrame();
    const still = (nowS: number) => v({ prev: state([shot(12, 2, 0.2, 0.1)]), cur: state([shot(12, 2, 0.2, 0.1)]), alpha: 0, localId: ME, nowS, dtS: 1 / 144 });
    expect([still(0), still(0.007), still(0.014)]).toEqual([[], [], []]);
  });

  it("is silent for my own shots, shots farther than 1.5 m, and when I am dead", () => {
    const w = createWhizzFrame();
    const at = (projectiles: Projectile[], nowS: number, s = state(projectiles)) => w({ prev: s, cur: s, alpha: 0, localId: ME, nowS, dtS: 1 / 60 });
    at([shot(10, ME, 0.5, -5), shot(11, 2, 1.6, -5)], 0);
    expect(at([shot(10, ME, 0.5, 5), shot(11, 2, 1.6, 5)], 0.02)).toEqual([]);
    const dead = { ...base, units: base.units.map((u) => (u.id === ME ? { ...u, alive: false } : u)) };
    at([shot(12, 2, 0.5, -5)], 1, { ...dead, projectiles: [shot(12, 2, 0.5, -5)] });
    expect(at([shot(12, 2, 0.5, 5)], 1.02, { ...dead, projectiles: [shot(12, 2, 0.5, 5)] })).toEqual([]);
  });

  it("whistles at most twice in any second and once per 0.5 s per shooter; a shot cut by the limit stays quiet", () => {
    const w = createWhizzFrame();
    const at = (projectiles: Projectile[], nowS: number) => w({ prev: state(projectiles), cur: state(projectiles), alpha: 0, localId: ME, nowS, dtS: 1 / 60 });
    // три стрелка разом — два свиста
    at([shot(10, 2, 0.5, -5), shot(11, 3, -0.5, -5, "airSickle"), shot(12, 4, 0.8, -5, "waterGrab")], 0);
    expect(sounds(at([shot(10, 2, 0.5, 5), shot(11, 3, -0.5, 5, "airSickle"), shot(12, 4, 0.8, 5, "waterGrab")], 0.02)).map((e) => e.id)).toEqual(["whizzFire", "whizzSickle"]);
    // срезанный лимитом снаряд Воды позже не свистит
    expect(at([shot(12, 4, 0.8, 6, "waterGrab")], 1.5)).toEqual([]);
    // один стрелок: через 0,3 с — тихо, через 0,5 с — снова свист
    const v = createWhizzFrame();
    const by = (id: number, z: number, nowS: number) => v({ prev: state([shot(id, 2, 0.5, z)]), cur: state([shot(id, 2, 0.5, z)]), alpha: 0, localId: ME, nowS, dtS: 1 / 60 });
    by(20, -5, 0);
    expect(sounds(by(20, 5, 0.02))).toHaveLength(1);
    by(21, -5, 0.3);
    expect(by(21, 5, 0.32)).toEqual([]);
    by(22, -5, 0.5);
    expect(sounds(by(22, 5, 0.52))).toHaveLength(1);
  });

  it("maps every projectile to the shooter's whizz: fist and fireball crackle, stone whooms, sickle whistles, Water splashes", () => {
    expect(WHIZZ_SOUND).toEqual({
      fireFists: "whizzFire", fireball: "whizzFire", stoneShot: "whizzStone", airSickle: "whizzSickle", waterGrab: "whizzWater", waterAnswer: "whizzWater",
    });
  });
});
