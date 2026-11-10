import { describe, expect, it } from "vitest";
import { ABILITY_IDS, NOBODY, createMageUnit, createMatchState, type AbilityId, type MatchEvent } from "@doodlemagic/sim";
import type { Effect } from "./effects";
import { AREA_TRAUMA, LMB_VICTIM_KICK_DEG, effectsFor, hitTickPitch, hitTier } from "./eventMap";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 3;
const view = { localId: ME, state: createMatchState([createMageUnit(ME, "fire", { pos: V(), yaw: 0 }), createMageUnit(OTHER, "earth", { pos: V(6, 0, -8), yaw: 0.4 })]) };
const fx = (ev: MatchEvent): Effect[] => effectsFor(ev, view);
const cast = (unit: number, ability: AbilityId, pos = V(6, 1.6, -8)): MatchEvent => ({ type: "cast", unit, ability, slot: "q", pos, dir: V(0, 0, -1) });
const dash = (unit: number, phase: "start" | "end"): MatchEvent => ({ type: "dash", unit, ability: "jetDash", phase, pos: V(6, 0.9, -8), dir: V(0.6, 0, -0.8) });

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
    expect(fx({ type: "dash", unit: ME, ability: "jetDash", phase: "start", pos: V(), dir: V(1, 0, 0) })).toEqual([
      { kind: "fov", deg: 8 },
      { kind: "kick", pitchDeg: 0, yawDeg: 0, rollDeg: -3 },
      { kind: "burst", preset: "dashBlast", pos: V(), dir: V(-1, 0, 0), scale: 1 },
    ]);
    expect(fx({ type: "dash", unit: ME, ability: "jetDash", phase: "end", pos: V(), dir: V(1, 0, 0) })).toEqual([]);
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

  // цифра знает, что она от ЛКМ: добивающий кулак (крупная ступень) копится в стопку, шар и горение — нет (L7)
  it("marks LMB damage numbers explicitly: a finishing fist is lmb, a fireball and a burn tick are not", () => {
    const lmbOf = (es: Effect[]) => pick(es, "number").map((e) => e.lmb);
    expect(lmbOf(fx(hit({ ability: "fireFists", amount: 15, killed: true })))).toEqual([true]);
    expect(lmbOf(fx(hit({ ability: "stoneShot", amount: 30 })))).toEqual([true]);
    expect(lmbOf(fx(hit({ ability: "fireball", amount: 50 })))).toEqual([false]);
    expect(lmbOf(fx(hit({ ability: "burning", amount: 3, dot: true })))).toEqual([false]);
  });

  it("shakes the victim by tier and element: a fist 0.1 Fire, a stone 0.2 Earth, a fireball 0.5 Fire in all with FOV and a whoosh", () => {
    const onMe = (over: Partial<Hit>) => fx(hit({ source: OTHER, target: ME, ...over }));
    expect(pick(onMe({}), "trauma")).toEqual([{ kind: "trauma", amount: 0.1, profile: "fire" }]);
    expect(pick(onMe({ ability: "stoneShot", amount: 30 }), "trauma")).toEqual([{ kind: "trauma", amount: 0.2, profile: "earth" }]);
    const ball = onMe({ ability: "fireball", amount: 50, knock: { distM: 3, upM: 1.2 } });
    // 0,15 шару дал взрыв рядом — попадание добавляет остаток до 0,5
    expect(pick(ball, "trauma")).toEqual([{ kind: "trauma", amount: 0.5 - AREA_TRAUMA.fireball, profile: "fire" }]);
    expect(pick(ball, "fov")).toEqual([{ kind: "fov", deg: 3 }]);
    expect(pick(ball, "sound").map((e) => e.id)).toEqual(["fireballBoom", "knockWhoosh"]);
    expect(pick(onMe({}), "sound").map((e) => e.id)).toEqual(["fistHit"]);
  });

  it("releases with a beat: the stone's 0.9° recoil and a throw sound on the release, a launch sound for the fireball (A1, phase 9 Р6)", () => {
    const eye = V(0, 1.6, 0);
    // нажатие камня камеру не толкает — толчок на броске
    expect(pick(fx(cast(ME, "stoneShot", eye)), "kick")).toEqual([]);
    const stone = fx({ type: "release", unit: ME, ability: "stoneShot", projectile: 9, pos: eye, dir: V(0, 0, -1) });
    expect([pick(stone, "kick")[0], pick(stone, "sound")[0]?.id]).toEqual([{ kind: "kick", pitchDeg: 0.9, yawDeg: 0, rollDeg: 0, recoil: true }, "stoneThrow"]);
    // кулак: 0,6° вверх и 0,15° вбок от руки удара (у левой — зеркально, это решает камера по руке)
    expect(pick(fx(cast(ME, "fireFists", eye)), "kick")).toEqual([{ kind: "kick", pitchDeg: 0.6, yawDeg: 0.15, rollDeg: 0, recoil: true, hand: "auto" }]);
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
    // свой промах (цели нет) — пол 0,35: слышно, куда лёг выстрел (фаза 9, L8); чужой промах — по расстоянию
    const miss = fx({ type: "impact", ability: "stoneShot", owner: ME, pos: V(0, 1, -20), normal: V(0, 0, 1), target: NOBODY, terrain: -1 });
    expect(pick(miss, "sound")).toEqual([{ kind: "sound", id: "stoneImpact", pos: V(0, 1, -20), gain: 1, floor: 0.35 }]);
    const wall = fx({ type: "impact", ability: "fireFists", owner: ME, pos: V(0, 1, -20), normal: V(0, 0, 1), target: NOBODY, terrain: 4 });
    expect(pick(wall, "sound")[0]?.floor).toBe(0.35);
    const theirMiss = fx({ type: "impact", ability: "fireFists", owner: OTHER, pos: V(0, 1, -20), normal: V(0, 0, 1), target: NOBODY, terrain: 4 });
    expect(pick(theirMiss, "sound")[0]?.floor).toBeUndefined();
    // пол промаха — только у ЛКМ: свой шар в стену звучит по расстоянию (взрыв слышно своим полом)
    const ballWall = fx({ type: "impact", ability: "fireball", owner: ME, pos: V(0, 1, -20), normal: V(0, 0, 1), target: NOBODY, terrain: 4 });
    expect(pick(ballWall, "sound")[0]?.floor).toBeUndefined();
  });

  it("does not count the victim's shake twice: area + hit trauma add up to fireball 0.5, pillar 0.5, quake 0.65", () => {
    const onMe = (ability: "fireball" | "stonePillar" | "earthquake", amount: number) =>
      pick(fx({ type: "hit", source: OTHER, target: ME, ability, amount, pos: V(0, 1, -1), dir: V(0, 0, 1), knock: { distM: 0.5, upM: 0 }, airborne: false, dot: false, killed: false }), "trauma")
        .reduce((a, e) => a + e.amount, 0);
    const near = pick(fx({ type: "explosion", ability: "fireball", owner: OTHER, pos: V(0, 1, -1), radius: 3 }), "trauma").reduce((a, e) => a + e.amount, 0);
    expect(near).toBe(AREA_TRAUMA.fireball);
    expect(near + onMe("fireball", 50)).toBeCloseTo(0.5);
    expect(AREA_TRAUMA.stonePillar + onMe("stonePillar", 30)).toBeCloseTo(0.5);
    expect(AREA_TRAUMA.earthquake + onMe("earthquake", 40)).toBeCloseTo(0.65);
    expect(onMe("earthquake", 40)).toBe(0);
  });

  it("raises the hit tick toward the target's death: ×2^((1 − hp/max)·4/12), up to a major third (phase 9, L2)", () => {
    expect([hitTickPitch(100, 100), hitTickPitch(50, 100), hitTickPitch(0, 100), hitTickPitch(-5, 100), hitTickPitch(10, 0)]).toEqual([
      1,
      expect.closeTo(2 ** (2 / 12), 9),
      expect.closeTo(2 ** (4 / 12), 9),
      expect.closeTo(2 ** (4 / 12), 9),
      1,
    ]);
    // HP цели — из состояния события (после удара): у раненой цели тик выше
    const other = view.state.units.find((u) => u.id === OTHER)!;
    const hurt = { localId: ME, state: { ...view.state, units: view.state.units.map((u) => (u.id === OTHER ? { ...u, hp: other.maxHp / 4 } : u)) } };
    const tick = effectsFor(hit({ ability: "stoneShot", amount: 30 }), hurt).find((e) => e.kind === "sound");
    expect(tick).toEqual({ kind: "sound", id: "hitLight", pos: null, gain: 1, pitch: expect.closeTo(2 ** (0.75 * 4 / 12), 9) });
    expect(pick(fx(hit({ ability: "fireFists", amount: 15 })), "sound")[0]).toMatchObject({ id: "hitLight", pitch: 1 });
  });

  it("kicks a victim of LMB at least 0.3° even for a fist, and no more than the tier allows (phase 9, L10)", () => {
    const kickOf = (over: Partial<Hit>) => pick(fx(hit({ source: OTHER, target: ME, ...over })), "kick")[0]!;
    const size = (k: Extract<Effect, { kind: "kick" }>) => Math.abs(k.pitchDeg) + Math.abs(k.yawDeg);
    expect(LMB_VICTIM_KICK_DEG).toBe(0.3);
    expect(size(kickOf({ ability: "fireFists", amount: 15 }))).toBeCloseTo(0.3, 9);
    expect(size(kickOf({ ability: "fireFists", amount: 15, dir: V(0.6, 0, -0.8) }))).toBeCloseTo(0.3, 9);
    expect(size(kickOf({ ability: "fireFists", amount: 15, dir: V(0, -1, 0) }))).toBeCloseTo(0.3, 9);
    expect(size(kickOf({ ability: "stoneShot", amount: 30 }))).toBeCloseTo(0.75 * 30 / 40, 9);
    // не ЛКМ — по-прежнему по урону, без пола
    expect(size(kickOf({ ability: "fireball", amount: 4 }))).toBeCloseTo(1.25 * 4 / 40, 9);
  });
});
