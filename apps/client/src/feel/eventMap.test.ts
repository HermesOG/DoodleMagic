import { describe, expect, it } from "vitest";
import { ABILITY_IDS, createMageUnit, createMatchState, type AbilityId, type MatchEvent } from "@doodlemagic/sim";
import type { Effect } from "./effects";
import { effectsFor, hitTier } from "./eventMap";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 3;
const view = { localId: ME, state: createMatchState([createMageUnit(ME, "fire", { pos: V(), yaw: 0 }), createMageUnit(OTHER, "earth", { pos: V(6, 0, -8), yaw: 0.4 })]) };
const fx = (ev: MatchEvent): Effect[] => effectsFor(ev, view);
const cast = (unit: number, ability: AbilityId, pos = V(6, 1.6, -8)): MatchEvent => ({ type: "cast", unit, ability, slot: "q", pos, dir: V(0, 0, -1) });
const dash = (unit: number, phase: "start" | "end"): MatchEvent => ({ type: "dash", unit, phase, pos: V(6, 0.9, -8), dir: V(0.6, 0, -0.8) });

describe("effectsFor: other mages", () => {
  it("plays another mage's cast as one positional sound where it is cast — the same sound as my own cast", () => {
    for (const ability of ABILITY_IDS) {
      const at = V(6, 1.6, -8);
      const mineSound = fx(cast(ME, ability, V(0, 1.6, 0))).find((e) => e.kind === "sound");
      expect(mineSound).toMatchObject({ kind: "sound", pos: null });
      const id = mineSound?.kind === "sound" ? mineSound.id : null;
      expect(fx(cast(OTHER, ability, at))).toEqual([{ kind: "sound", id, pos: at, gain: 1 }]);
    }
  });

  it("blasts flame behind another mage's dash start, without touching my camera; nothing on its end", () => {
    expect(fx(dash(OTHER, "start"))).toEqual([{ kind: "burst", preset: "dashBlast", pos: V(6, 0.9, -8), dir: V(-0.6, 0, 0.8), scale: 1 }]);
    expect(fx(dash(OTHER, "end"))).toEqual([]);
  });

  it("keeps my own cast and dash as before", () => {
    expect(fx(cast(ME, "fireball", V(0, 1.6, 0)))).toEqual([
      { kind: "gesture", ability: "fireball" },
      { kind: "palm", hand: "both", element: "fire", preset: "charge" },
      { kind: "sound", id: "fireballCharge", pos: null, gain: 1 },
      { kind: "kick", pitchDeg: 1, yawDeg: 0, rollDeg: 0 },
    ]);
    expect(fx({ type: "dash", unit: ME, phase: "start", pos: V(), dir: V(1, 0, 0) })).toEqual([
      { kind: "fov", deg: 8 },
      { kind: "kick", pitchDeg: 0, yawDeg: 0, rollDeg: -3 },
      { kind: "burst", preset: "dashBlast", pos: V(), dir: V(-1, 0, 0), scale: 1 },
    ]);
    expect(fx({ type: "dash", unit: ME, phase: "end", pos: V(), dir: V(1, 0, 0) })).toEqual([]);
  });
});

describe("effectsFor: feedback tiers (round3/01, 2.1)", () => {
  type Hit = Extract<MatchEvent, { type: "hit" }>;
  const hit = (over: Partial<Hit>): MatchEvent => ({
    type: "hit", source: ME, target: OTHER, ability: "fireFists", amount: 12, pos: V(6, 1, -8), dir: V(0, 0, -1),
    knock: { distM: 0.12, upM: 0 }, airborne: false, dot: false, killed: false, ...over,
  });
  const pick = <K extends Effect["kind"]>(es: Effect[], kind: K) => es.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);

  it("maps hits to tiers: damage over time none, primary small, abilities medium, a kill large", () => {
    expect(hitTier({ ability: "burning", dot: true, killed: false })).toBe("none");
    expect(hitTier({ ability: "jetDash", dot: false, killed: false })).toBe("none");
    expect(hitTier({ ability: "stoneShot", dot: false, killed: false })).toBe("small");
    expect(hitTier({ ability: "fireball", dot: false, killed: false })).toBe("medium");
    expect(hitTier({ ability: "fireFists", dot: false, killed: true })).toBe("large");
  });

  it("confirms my hit by tier: light tick, heavy thud with a 60 ms pause, kill marker 90 ms; never shakes the shooter", () => {
    const small = fx(hit({ ability: "stoneShot", amount: 30 }));
    const medium = fx(hit({ ability: "fireball", amount: 50 }));
    const kill = fx(hit({ ability: "fireball", amount: 50, killed: true }));
    expect([pick(small, "sound")[0]?.id, pick(small, "hitmarker")[0]?.tier, pick(small, "hitstop")[0]?.ms]).toEqual(["hitLight", "small", 30]);
    expect([pick(medium, "sound")[0]?.id, pick(medium, "hitmarker")[0]?.tier, pick(medium, "hitstop")[0]?.ms]).toEqual(["hitHeavy", "medium", 60]);
    expect([pick(kill, "sound").length, pick(kill, "hitmarker")[0]?.tier, pick(kill, "hitstop")[0]?.ms]).toEqual([0, "large", 90]);
    for (const es of [small, medium, kill]) expect(pick(es, "trauma")).toEqual([]);
  });

  it("shakes the victim by tier and element: a fist 0.1 Fire, a stone 0.2 Earth, a fireball 0.5 Fire with FOV and a whoosh", () => {
    const onMe = (over: Partial<Hit>) => fx(hit({ source: OTHER, target: ME, ...over }));
    expect(pick(onMe({}), "trauma")).toEqual([{ kind: "trauma", amount: 0.1, profile: "fire" }]);
    expect(pick(onMe({ ability: "stoneShot", amount: 30 }), "trauma")).toEqual([{ kind: "trauma", amount: 0.2, profile: "earth" }]);
    const ball = onMe({ ability: "fireball", amount: 50, knock: { distM: 3, upM: 1.2 } });
    expect(pick(ball, "trauma")).toEqual([{ kind: "trauma", amount: 0.5, profile: "fire" }]);
    expect(pick(ball, "fov")).toEqual([{ kind: "fov", deg: 3 }]);
    expect(pick(ball, "sound").map((e) => e.id)).toEqual(["fireballBoom", "knockWhoosh"]);
    expect(pick(onMe({}), "sound").map((e) => e.id)).toEqual(["fistHit"]);
  });

  it("releases with a beat: the stone's 0.6° recoil and a throw sound on the release, a launch sound for the fireball (A1)", () => {
    const eye = V(0, 1.6, 0);
    expect(pick(fx(cast(ME, "stoneShot", eye)), "kick")).toEqual([{ kind: "kick", pitchDeg: 0.2, yawDeg: 0, rollDeg: 0 }]);
    const stone = fx({ type: "release", unit: ME, ability: "stoneShot", projectile: 9, pos: eye, dir: V(0, 0, -1) });
    expect([pick(stone, "kick")[0]?.pitchDeg, pick(stone, "sound")[0]?.id]).toEqual([0.6, "stoneThrow"]);
    const ball = fx({ type: "release", unit: ME, ability: "fireball", projectile: 9, pos: eye, dir: V(0, 0, -1) });
    expect(pick(ball, "sound").map((e) => e.id)).toEqual(["fireballLaunch"]);
    expect(fx({ type: "release", unit: OTHER, ability: "fireball", projectile: 9, pos: V(6, 1.6, -8), dir: V(0, 0, -1) })).toEqual([
      { kind: "sound", id: "fireballLaunch", pos: V(6, 1.6, -8), gain: 1 },
    ]);
  });

  it("slams palms down: pillar and wall push the camera down 1.2° and 4 cm, not up (A2)", () => {
    for (const a of ["stonePillar", "stoneWall"] as const)
      expect(pick(fx(cast(ME, a, V(0, 1.6, 0))), "kick")).toEqual([{ kind: "kick", pitchDeg: -1.2, yawDeg: 0, rollDeg: 0, dropM: 0.04 }]);
  });

  it("keeps my own hits audible from afar: impacts and explosions get a 0.6 floor; a stone hit flashes white paper (H3)", () => {
    const imp = fx({ type: "impact", ability: "stoneShot", owner: ME, pos: V(0, 1, -20), normal: V(0, 0, 1), target: OTHER, terrain: -1 });
    expect(pick(imp, "sound")).toEqual([{ kind: "sound", id: "stoneImpact", pos: V(0, 1, -20), gain: 1, floor: 0.6 }]);
    expect(pick(imp, "burst").map((e) => e.preset)).toEqual(["stoneImpact", "paperFlash"]);
    const theirs = fx({ type: "impact", ability: "fireFists", owner: OTHER, pos: V(0, 1, -2), normal: V(0, 0, 1), target: ME, terrain: -1 });
    expect(pick(theirs, "sound")).toEqual([{ kind: "sound", id: "fistHit", pos: V(0, 1, -2), gain: 1 }]);
    const boom = fx({ type: "explosion", ability: "fireball", owner: ME, pos: V(0, 1, -20), radius: 3 });
    expect(pick(boom, "sound")[0]?.floor).toBe(0.6);
  });
});
