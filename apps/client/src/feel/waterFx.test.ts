import { describe, expect, it, vi } from "vitest";
import { NOBODY, createMageUnit, createMatchState, type MatchEvent, type MatchState, type Unit, type Zone } from "@doodlemagic/sim";
import { SOUND_LABELS } from "../audio/audition";
import { RECIPES, SOUND_ELEMENT, recipeLength } from "../audio/recipes";
import { WATER_RECIPES, WATER_SOUND_LABELS } from "../audio/waterRecipes";
import { WATER_BURSTS } from "../fx/presets.water";
import { createGestures, startGesture, stepGestures } from "../hands/gestures";
import { answerLabel, createWaterWidget, wardWidget } from "../hud/waterHud";
import type { Effect } from "./effects";
import { ABSORB_TONE_AT, HEAL_CHIME_TICKS, SPRING_GRAIN_S, absorbSound, createWaterEffects, waterEffects, waterFrame } from "./waterFx";
import { WATER_BURST_PRESETS, WATER_SOUND_IDS } from "./waterIds";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const FOE = 2;
const state = (): MatchState => createMatchState([createMageUnit(ME, "water", { pos: V(), yaw: 0 }), createMageUnit(FOE, "water", { pos: V(0, 0, -10), yaw: Math.PI })]);
const view = { localId: ME, state: state() };
const fx = (ev: MatchEvent): Effect[] | null => waterEffects(ev, view, view.state.units[0]);
const kinds = (e: Effect[] | null) => (e ?? []).map((x) => (x.kind === "sound" ? `sound:${x.id}` : x.kind === "burst" ? `burst:${x.preset}` : x.kind));
const soundOf = (e: Effect[] | null, id: string) => (e ?? []).find((x): x is Extract<Effect, { kind: "sound" }> => x.kind === "sound" && x.id === id);
const burstOf = (e: Effect[] | null, p: string) => (e ?? []).find((x): x is Extract<Effect, { kind: "burst" }> => x.kind === "burst" && x.preset === p);

describe("Water ids: every sound and burst has its entry", () => {
  it("every sound has a recipe ≤ 0.8 s signed in 300–1500 Hz and a label; every burst has layers", () => {
    for (const id of WATER_SOUND_IDS) {
      expect(WATER_RECIPES[id], id).toBe(RECIPES[id]);
      expect(recipeLength(RECIPES[id]), id).toBeLessThanOrEqual(0.8);
      expect(WATER_SOUND_LABELS[id], id).toBe(SOUND_LABELS[id]);
      expect(SOUND_ELEMENT[id], id).toBe("water");
      const sig = RECIPES[id].layers.filter((l) => l.signature);
      expect(sig.length, id).toBe(1);
      expect(Math.min(sig[0]!.freq, sig[0]!.freqEnd) >= 300 && Math.max(sig[0]!.freq, sig[0]!.freqEnd) <= 1500, id).toBe(true);
    }
    for (const p of WATER_BURST_PRESETS) expect(WATER_BURSTS[p].length, p).toBeGreaterThan(0);
  });

  it("the absorb chime rises with what the disc holds", () => {
    expect([absorbSound(12), absorbSound(ABSORB_TONE_AT.mid), absorbSound(ABSORB_TONE_AT.high), absorbSound(90)]).toEqual([
      "wardAbsorb", "wardAbsorbMid", "wardAbsorbHigh", "wardAbsorbHigh",
    ]);
    const sig = (id: "wardAbsorb" | "wardAbsorbMid" | "wardAbsorbHigh") => RECIPES[id].layers.find((l) => l.signature)!.freq;
    expect(sig("wardAbsorb") < sig("wardAbsorbMid") && sig("wardAbsorbMid") < sig("wardAbsorbHigh")).toBe(true);
  });

  it("gestures are smooth and come back to rest", () => {
    for (const a of ["waterWhip", "waterGrab", "waterWard", "spring"] as const) {
      const done = stepGestures(startGesture(createGestures(), a), 1.5);
      expect([...Object.values(done.pose.right), ...Object.values(done.pose.left)].every((v) => Math.abs(v) < 1e-6), a).toBe(true);
    }
    // замах хлыста — к себе (кисть > 0) на 0,12 с, Хвата — назад (z > 0) на 0,25 с
    const whip = stepGestures(startGesture(createGestures(), "waterWhip"), 0.12);
    expect(whip.pose.right.pitch).toBeGreaterThan(0.2);
    const grab = stepGestures(startGesture(createGestures(), "waterGrab"), 0.25);
    expect(grab.pose.right.z).toBeGreaterThan(0.1);
  });
});

describe("waterEffects: casts and releases of Water's own abilities", () => {
  it("my cast: gesture, palm, its sound at my ear and a small kick", () => {
    const c = (ability: "waterWhip" | "waterGrab" | "waterWard" | "spring") => fx({ type: "cast", unit: ME, ability, slot: "q", pos: V(0, 1.6, 0), dir: V(0, 0, -1) });
    expect(c("waterWhip")).toEqual([
      { kind: "gesture", ability: "waterWhip" },
      { kind: "palm", hand: "right", element: "water", preset: "flash" },
      { kind: "sound", id: "whipSwish", pos: null, gain: 1 },
      { kind: "kick", pitchDeg: 0.2, yawDeg: 0, rollDeg: 0 },
    ]);
    expect(kinds(c("waterGrab"))).toEqual(["gesture", "palm", "sound:grabWindup", "kick"]);
    expect(kinds(c("waterWard"))).toEqual(["gesture", "palm", "sound:wardUp", "kick"]);
    expect(c("spring")![3]).toMatchObject({ kind: "kick", pitchDeg: -0.8 });
    expect(soundOf(c("spring"), "springSpread")?.pos).toBeNull();
  });

  it("a foreign cast: one sound where he casts — the grab's rising windup telegraphs the rope", () => {
    const at = V(0, 1.6, -10);
    expect(fx({ type: "cast", unit: FOE, ability: "waterWhip", slot: "primary", pos: at, dir: V(0, 0, 1) })).toEqual([{ kind: "sound", id: "whipSwish", pos: at, gain: 1 }]);
    expect(fx({ type: "cast", unit: FOE, ability: "waterGrab", slot: "q", pos: at, dir: V(0, 0, 1) })).toEqual([{ kind: "sound", id: "grabWindup", pos: at, gain: 1 }]);
  });

  it("releases: the grab's throw and the Answer at my ear or at his hands; the whip waits for its beam", () => {
    const rel = (unit: number, ability: "waterGrab" | "waterWard" | "waterWhip"): MatchEvent => ({ type: "release", unit, ability, projectile: 7, pos: V(0, 1.6, -10), dir: V(0, 0, 1) });
    expect(soundOf(fx(rel(ME, "waterGrab")), "grabThrow")?.pos).toBeNull();
    expect(soundOf(fx(rel(FOE, "waterGrab")), "grabThrow")?.pos).toEqual(V(0, 1.6, -10));
    expect(kinds(fx(rel(ME, "waterWard")))).toEqual(["sound:answerThrow", "kick", "fov"]);
    expect(soundOf(fx(rel(FOE, "waterWard")), "answerThrow")?.pos).toEqual(V(0, 1.6, -10));
    expect(fx(rel(ME, "waterWhip"))).toEqual([]);
  });

  it("other elements' casts and every hit stay with the shared map", () => {
    expect(fx({ type: "cast", unit: ME, ability: "fireball", slot: "q", pos: V(), dir: V(0, 0, -1) })).toBeNull();
    expect(fx({ type: "release", unit: ME, ability: "stoneShot", projectile: 1, pos: V(), dir: V(0, 0, -1) })).toBeNull();
    const hit: MatchEvent = {
      type: "hit", source: ME, target: FOE, ability: "waterWhip", amount: 20, pos: V(), dir: V(0, 0, 1), knock: { distM: 0.3, upM: 0 }, airborne: false, dot: false, killed: false,
    };
    expect(fx(hit)).toBeNull();
    expect(fx({ type: "beam", unit: ME, ability: "gust", from: V(), to: V(0, 0, -7), target: FOE })).toBeNull();
    expect(fx({ type: "impact", ability: "fireball", owner: ME, pos: V(), normal: V(0, 1, 0), target: NOBODY, terrain: -1 })).toBeNull();
    expect(fx({ type: "zone", zone: 3, kind: "fireWall", owner: ME, phase: "arm" })).toBeNull();
    expect(fx({ type: "reaction", kind: "fireTornado", owner: ME, zone: 3, pos: V() })).toBeNull();
    expect(fx({ type: "reaction", kind: "fireRampart", owner: ME, zone: 3, pos: V() })).toBeNull();
  });

  it("«Топь»: quake ring and dark muck with a thud for everyone; the toast only for its owner", () => {
    const mineBog = fx({ type: "reaction", kind: "bog", owner: ME, zone: 3, pos: V() })!;
    expect(mineBog.filter((e) => e.kind === "burst").map((e) => (e as { preset: string }).preset)).toEqual(["quakeRing", "bogMuck"]);
    expect(mineBog.filter((e) => e.kind === "sound").map((e) => (e as { id: string }).id)).toEqual(["quakeStrike", "springBubble"]);
    expect(mineBog).toContainEqual({ kind: "toast", text: "Топь!" });
    const foeBog = fx({ type: "reaction", kind: "bog", owner: FOE, zone: 3, pos: V() })!;
    expect(foeBog.some((e) => e.kind === "toast")).toBe(false);
    expect(foeBog.some((e) => e.kind === "burst")).toBe(true);
  });
});

describe("waterEffects: the whip's beam, the grab and the Answer landing", () => {
  it("my whip hits: the arc carries the way back to my eyes, crack at my ear, splash and a hit sound with a floor", () => {
    const from = V(0, 1.6, 0);
    const to = V(0, 1, -12);
    const e = fx({ type: "beam", unit: ME, ability: "waterWhip", from, to, target: FOE });
    expect(kinds(e)).toEqual(["burst:whipArc", "sound:whipCrack", "burst:whipSplash", "sound:whipHit"]);
    expect(burstOf(e, "whipArc")).toMatchObject({ pos: to, dir: { x: 0, y: expect.closeTo(0.6, 6), z: 12 }, owner: ME });
    expect(soundOf(e, "whipCrack")?.pos).toBeNull();
    expect(soundOf(e, "whipHit")).toMatchObject({ pos: to, floor: 0.6 });
    expect(Math.hypot(burstOf(e, "whipSplash")!.dir.x, burstOf(e, "whipSplash")!.dir.y, burstOf(e, "whipSplash")!.dir.z)).toBeCloseTo(1);
  });

  it("a foreign whip that misses: arc and crack where he stands, no splash", () => {
    const e = fx({ type: "beam", unit: FOE, ability: "waterWhip", from: V(0, 1.6, -10), to: V(0, 1.6, 5), target: NOBODY });
    expect(kinds(e)).toEqual(["burst:whipArc", "sound:whipCrack"]);
    expect(burstOf(e, "whipArc")?.owner).toBe(FOE);
    expect(soundOf(e, "whipCrack")?.pos).toEqual(V(0, 1.6, -10));
  });

  it("the grab's «pop» and the Answer's splash: own hit has a floor, a miss is smaller and plain", () => {
    const imp = (ability: "waterGrab" | "waterWard", owner: number, target: number): MatchEvent => ({ type: "impact", ability, owner, pos: V(0, 1, -5), normal: V(0, 0, 1), target, terrain: -1 });
    const g = fx(imp("waterGrab", ME, FOE));
    expect(kinds(g)).toEqual(["burst:grabSplash", "sound:grabHit"]);
    expect(soundOf(g, "grabHit")?.floor).toBe(0.6);
    const miss = fx(imp("waterGrab", ME, NOBODY));
    expect([burstOf(miss, "grabSplash")?.scale, soundOf(miss, "grabHit")?.floor]).toEqual([0.6, undefined]);
    const a = fx(imp("waterWard", FOE, ME));
    expect(kinds(a)).toEqual(["burst:answerSplash", "sound:answerHit"]);
    expect(soundOf(a, "answerHit")?.floor).toBeUndefined();
  });
});

describe("waterEffects: the ward, the tow, healing, the spring and steam", () => {
  it("absorb: splash and a chime that rises with the total; fire hisses out in steam (look only)", () => {
    const ab = (unit: number, kind: "stoneShot" | "fireball", total: number): MatchEvent => ({ type: "absorb", unit, projectile: 4, kind, owner: 9, amount: 20, total, pos: V(0, 1.2, -1) });
    expect(kinds(fx(ab(ME, "stoneShot", 18)))).toEqual(["burst:wardAbsorb", "sound:wardAbsorb"]);
    expect(soundOf(fx(ab(ME, "stoneShot", 18)), "wardAbsorb")?.pos).toBeNull();
    const fire = fx(ab(FOE, "fireball", 50));
    expect(kinds(fire)).toEqual(["burst:wardAbsorb", "sound:wardAbsorbHigh", "burst:steamPuff", "sound:steamHiss"]);
    expect(soundOf(fire, "wardAbsorbHigh")?.pos).toEqual(V(0, 1.2, -1));
  });

  it("ward up is silent (its bell rang with the cast); ward down bursts in front of Water, bigger the more it held", () => {
    expect(fx({ type: "ward", unit: FOE, phase: "up", absorbed: 0 })).toEqual([]);
    expect(soundOf(fx({ type: "ward", unit: ME, phase: "down", absorbed: 20 }), "wardDown")?.pos).toBeNull();
    const small = burstOf(fx({ type: "ward", unit: FOE, phase: "down", absorbed: 0 }), "wardBurst")!;
    const big = burstOf(fx({ type: "ward", unit: FOE, phase: "down", absorbed: 60 }), "wardBurst")!;
    expect(big.scale).toBeGreaterThan(small.scale);
    // FOE смотрит на +Z (yaw π): диск в 0,9 м перед ним
    expect(small.pos.z).toBeCloseTo(-9.1);
    expect(fx({ type: "ward", unit: 99, phase: "down", absorbed: 0 })).toEqual([]);
  });

  it("tow: the pull is heard at the ear of whoever is in it, a small splash where it ends", () => {
    const tow = (target: number, source: number, phase: "start" | "end"): MatchEvent => ({ type: "tow", target, source, phase, pos: V(0, 0, -6), to: V(0, 0, -1.5) });
    expect(soundOf(fx(tow(ME, FOE, "start")), "towPull")?.pos).toBeNull();
    expect(soundOf(fx(tow(FOE, ME, "start")), "towPull")).toMatchObject({ pos: null, gain: 0.8 });
    expect(soundOf(fx(tow(FOE, 3, "start")), "towPull")?.pos).toEqual(V(0, 0, -6));
    expect(kinds(fx(tow(FOE, ME, "end")))).toEqual(["burst:grabSplash"]);
  });

  it("heal: mine gathers motes at the palms with a soft chime; another's shows motes on the body", () => {
    expect(fx({ type: "heal", target: ME, source: ME, amount: 3, pos: V(0, 0.9, 0) })).toEqual([
      { kind: "palm", hand: "both", element: "water", preset: "charge" },
      { kind: "sound", id: "heal", pos: null, gain: 0.45 },
    ]);
    expect(kinds(fx({ type: "heal", target: FOE, source: FOE, amount: 3, pos: V(0, 0.9, -10) }))).toEqual(["burst:healMotes"]);
  });

  it("heal in my spring: palms every pulse, the chime on the first pulse and then at most once a second", () => {
    const fresh = createWaterEffects();
    const healAt = (tick: number) => {
      const st = { ...state(), tick };
      return kinds(fresh({ type: "heal", target: ME, source: ME, amount: 3, pos: V(0, 0.9, 0) }, { localId: ME, state: st }, st.units[0]));
    };
    // 4 импульса в секунду: звон на первом и через секунду; после перерыва (вышла из лужи) — снова сразу
    const ticks = [100, 115, 130, 145, 160, 175, 190, 205, 220, 300, 315];
    const chimed = ticks.filter((t) => healAt(t).includes("sound:heal"));
    expect(chimed).toEqual([100, 100 + HEAL_CHIME_TICKS, 220, 300]);
    expect(healAt(330)).toEqual(["palm"]);
  });

  it("the spring spreads a ring on its telegraph and first babbles at the pool; arm and end and steam zones are quiet", () => {
    const s = state();
    const spring: Zone = { id: 5, owner: ME, kind: "spring", ability: "spring", shape: { type: "disc", center: V(3, 0, -4), radius: 4 }, bornTick: 0, armTick: 24, endTick: 384, rehit: [] };
    s.zones.push(spring);
    const v = { localId: ME, state: s };
    const e = waterEffects({ type: "zone", zone: 5, kind: "spring", owner: ME, phase: "telegraph" }, v, s.units[0]);
    expect(kinds(e)).toEqual(["burst:springRing", "sound:springBubble"]);
    expect(burstOf(e, "springRing")?.pos).toEqual(V(3, 0, -4));
    expect(soundOf(e, "springBubble")?.pos).toEqual(V(3, 0, -4));
    expect(waterEffects({ type: "zone", zone: 5, kind: "spring", owner: ME, phase: "arm" }, v, s.units[0])).toEqual([]);
    expect(waterEffects({ type: "zone", zone: 6, kind: "steam", owner: ME, phase: "telegraph" }, v, s.units[0])).toEqual([]);
  });

  it("steam: a cloud and a hiss for everyone, «Пар!» for its owner only", () => {
    const mine = fx({ type: "reaction", kind: "steam", owner: ME, zone: 6, pos: V(0, 0, -5) });
    expect(kinds(mine)).toEqual(["burst:steamPuff", "sound:steamHiss", "toast"]);
    expect(mine![2]).toEqual({ kind: "toast", text: "Пар!" });
    expect(kinds(fx({ type: "reaction", kind: "steam", owner: FOE, zone: 6, pos: V(0, 0, -5) }))).toEqual(["burst:steamPuff", "sound:steamHiss"]);
  });
});

describe("waterFrame: the spring babbles in grains", () => {
  const withSpring = (owner: number, tick: number): MatchState => {
    const s = state();
    s.tick = tick;
    s.zones.push({ id: 5, owner, kind: "spring", ability: "spring", shape: { type: "disc", center: V(3, 0, -4), radius: 4 }, bornTick: 0, armTick: 24, endTick: 384, rehit: [] });
    return s;
  };
  const grains = (s: MatchState, seconds: number, fps: number): Effect[] => {
    const out: Effect[] = [];
    for (let i = 1; i <= seconds * fps; i++) out.push(...waterFrame({ prev: s, cur: s, alpha: 0, localId: ME, nowS: 10 + i / fps, dtS: 1 / fps }));
    return out;
  };

  it("one 0.5 s grain every 0.6 s at the spring's centre, at 60 and at 144 FPS", () => {
    for (const fps of [60, 144]) {
      const g = grains(withSpring(FOE, 100), 6, fps);
      expect(g.length, `${fps}`).toBe(6 / SPRING_GRAIN_S);
      expect(g[0]).toEqual({ kind: "sound", id: "springBubble", pos: V(3, 0, -4), gain: 0.6 });
    }
    expect(recipeLength(RECIPES.springBubble)).toBeLessThanOrEqual(SPRING_GRAIN_S);
    expect((grains(withSpring(ME, 100), 1.2, 60)[0] as Extract<Effect, { kind: "sound" }>).gain).toBe(0.5);
  });

  it("is silent before the spring arms, after it ends and without a spring", () => {
    expect(grains(withSpring(FOE, 10), 2, 60)).toEqual([]);
    expect(grains(withSpring(FOE, 384), 2, 60)).toEqual([]);
    expect(grains(state(), 2, 60)).toEqual([]);
  });
});

describe("Water's HUD widget: «Ответ N» while the disc stands", () => {
  it("shows the Answer's damage within 20–60, or that there will be none", () => {
    expect([answerLabel(0), answerLabel(5), answerLabel(20), answerLabel(37.4), answerLabel(60), answerLabel(140)]).toEqual([
      "Ответа нет", "Ответ 20", "Ответ 20", "Ответ 37", "Ответ 60", "Ответ 60",
    ]);
  });

  it("hides when the ward is down, has run out, or Water is dead under it", () => {
    const me: Unit = structuredClone(view.state.units[0]!);
    expect(wardWidget(me, 10)).toBeNull();
    me.mage!.ward = { endTick: 70, absorbed: 30 };
    expect(wardWidget(me, 10)).toEqual({ text: "Ответ 30", left01: 1, full: false });
    expect(wardWidget(me, 40)?.left01).toBeCloseTo(0.5);
    expect(wardWidget(me, 70)).toBeNull();
    me.alive = false;
    expect(wardWidget(me, 20)).toBeNull();
  });

  it("touches the DOM only when something changes", () => {
    // DOM в тестах нет: элементы-заглушки пишут в журнал каждую запись в style, hidden и textContent
    const writes: string[] = [];
    const el = () => {
      const style = new Proxy({} as Record<string, string>, { set: (t, k, v) => ((t[k as string] = v), k === "cssText" || writes.push(String(k)), true) });
      const node = { style, append() {}, prepend() {}, remove() {}, className: "" };
      let hidden = false;
      let text = "";
      Object.defineProperty(node, "hidden", { get: () => hidden, set: (v: boolean) => ((hidden = v), writes.push("hidden")) });
      Object.defineProperty(node, "textContent", { get: () => text, set: (v: string) => ((text = v), writes.push("text")) });
      return node;
    };
    vi.stubGlobal("document", { createElement: el });
    try {
      const w = createWaterWidget(el() as unknown as HTMLElement);
      writes.length = 0;
      const me: Unit = structuredClone(view.state.units[0]!);
      me.mage!.ward = { endTick: 70, absorbed: 0 };
      w.update(me, 10, 0);
      expect(writes.sort()).toEqual(["hidden", "opacity", "text", "transform"]);
      writes.length = 0;
      w.update(me, 10, 0.01);
      expect(writes).toEqual([]);
      w.update(me, 11, 0.02);
      expect(writes).toEqual(["transform"]);
      writes.length = 0;
      me.mage!.ward.absorbed = 25;
      w.update(me, 11, 0.03);
      expect(writes.sort()).toEqual(["opacity", "text"]);
      w.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
