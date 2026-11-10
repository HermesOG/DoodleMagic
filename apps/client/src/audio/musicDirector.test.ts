import { describe, expect, it } from "vitest";
import { NOBODY, createDummyUnit, createGame, createMageUnit, createMatchState, type GameState, type MatchEvent } from "@doodlemagic/sim";
import {
  DEATH, DUCK, FINAL_BPM, MUSIC_BPM, TRAINING_SEED,
  createMusicDirector, createSeedKeeper, emptySituation, intensity, levelOf, musicCue, musicSeed, readSituation, streakCue,
  type DirectorInput, type MusicCue, type MusicDirector, type MusicOut,
} from "./musicDirector";

const ME = 1;
const FOE = 2;
const DUMMY = 50;

const base = (patch: Partial<DirectorInput> = {}): DirectorInput => ({
  nowS: 0, cues: [], phase: "live", phaseLeftS: 300, suddenDeath: false, myScore: 0, bestOther: 0, scoreLimit: 10,
  near: 0, fury: false, dead: false, respawnInS: 0, enemyUltTelegraph: false, won: false, ...patch,
});

/** Кадры по 50 мс от from до to (включительно); cues — в первом кадре. Возвращает последний выход. */
function run(d: MusicDirector, from: number, to: number, patch: Partial<DirectorInput> = {}, cues: MusicCue[] = []): MusicOut {
  let out = d.step(base({ ...patch, nowS: from, cues }));
  for (let t = from + 0.05; t <= to + 1e-9; t += 0.05) out = d.step(base({ ...patch, nowS: t }));
  return out;
}

const hit = (amount: number, dot = false): MusicCue => ({ kind: "damage", amount, dot });

describe("intensity and levels", () => {
  it("adds damage over 90 (capped at 0,5), nearby foes and the final, then cuts at 0,15 / 0,4 / 0,7", () => {
    expect(intensity(60, 1, false)).toBeCloseTo(0.5 * 60 / 90 + 0.125);
    expect(intensity(500, 0, false)).toBe(0.5);
    expect(intensity(500, 5, true)).toBe(1);
    expect([0.1, 0.2, 0.5, 0.8].map(levelOf)).toEqual([0, 1, 2, 3]);
  });
});

describe("music director", () => {
  it("fights: a hit with a mage is level 2 at once, back to 1 only after 8 s below", () => {
    const d = createMusicDirector();
    expect(run(d, 0, 3).level).toBe(1); // в бою не ниже 1
    expect(d.step(base({ nowS: 3.1, cues: [hit(15)] })).level).toBe(2);
    // урон за 4 с держит 2 до 7,1; ниже порога — с 7,1, вниз — через 8 с
    expect(run(d, 3.15, 15).level).toBe(2);
    expect(run(d, 15.05, 15.3).level).toBe(1);
  });

  it("changes level not more often than every 2 s; a multi or a streak skips that rule, but not twice within 1,5 s", () => {
    const d = createMusicDirector();
    run(d, 0, 3);
    d.step(base({ nowS: 3, cues: [hit(15)] }));
    // ярость — не всплеск: ждёт 2 с от прошлой смены
    expect(run(d, 3.5, 4.5, { fury: true }).level).toBe(2);
    expect(run(d, 4.55, 5.1, { fury: true }).level).toBe(3);

    const e = createMusicDirector();
    run(e, 0, 3);
    e.step(base({ nowS: 3, cues: [hit(15)] }));
    expect(e.step(base({ nowS: 3.5, cues: [{ kind: "streak", multi: 2, streak: 2 }] })).level).toBe(3);
    // смерть и возрождение: встаю на 1; новая серия через 1 с после прошлого всплеска ждёт правила 2 с
    run(e, 3.55, 4, { dead: true, respawnInS: 1 });
    expect(e.step(base({ nowS: 4.2 })).level).toBe(1);
    expect(e.step(base({ nowS: 4.5, cues: [{ kind: "streak", multi: 1, streak: 3 }] })).level).toBe(1);
    expect(run(e, 4.55, 6.3).level).toBe(3);
  });

  it("caps training and warm-up at 2, lifts them to 1; results and lobby-like phases are 0", () => {
    const d = createMusicDirector();
    expect(run(d, 0, 1, { phase: "training" }).level).toBe(1);
    expect(run(d, 1, 4, { phase: "training", fury: true }).level).toBe(2);
    const w = createMusicDirector();
    expect(run(w, 0, 3, { phase: "warmup", fury: true }).level).toBe(2);
    const r = createMusicDirector();
    const out = run(r, 0, 1, { phase: "results", fury: true });
    expect([out.level, out.bed]).toEqual([0, true]);
  });

  it("last minute: not below 2, 120 BPM, brighter pad; sudden death: 3 all the time, dark", () => {
    const d = createMusicDirector();
    const last = run(d, 0, 1, { phaseLeftS: 50 });
    expect([last.level >= 2, last.bpm, last.final, last.mode]).toEqual([true, FINAL_BPM, true, "light"]);
    const sd = run(d, 1.05, 2, { suddenDeath: true, phaseLeftS: 40 });
    expect([sd.level, sd.bpm, sd.mode]).toEqual([3, FINAL_BPM, "dark"]);
    expect(run(createMusicDirector(), 0, 1).bpm).toBe(MUSIC_BPM);
  });

  it("rune announced: the pulse layer until someone takes it", () => {
    const d = createMusicDirector();
    expect(d.step(base({ nowS: 1, cues: [{ kind: "rune", phase: "warn" }] })).pulse).toBe(true);
    expect(run(d, 1.05, 10).pulse).toBe(true);
    expect(d.step(base({ nowS: 11, cues: [{ kind: "rune", phase: "take" }] })).pulse).toBe(false);
  });

  it("match point: light layer when it is mine, dark when it is someone else's", () => {
    expect(run(createMusicDirector(), 0, 0.1, { myScore: 9 }).matchPoint).toBe("mine");
    expect(run(createMusicDirector(), 0, 0.1, { bestOther: 9 }).matchPoint).toBe("other");
    expect(run(createMusicDirector(), 0, 0.1, { bestOther: 7 }).matchPoint).toBe(null);
    expect(run(createMusicDirector(), 0, 0.1, { phase: "training", myScore: 99 }).matchPoint).toBe(null);
  });

  it("own death: −8 dB and lowpass 500 Hz until 0,5 s before respawn; respawn is level 1 even after a fight", () => {
    const d = createMusicDirector();
    run(d, 0, 2);
    d.step(base({ nowS: 2, cues: [hit(40)] }));
    const dead = run(d, 2.05, 3, { dead: true, respawnInS: 2 });
    expect([dead.muteDb, dead.lowpassHz]).toEqual([DEATH.db, DEATH.lowpassHz]);
    const rising = d.step(base({ nowS: 3.5, dead: true, respawnInS: 0.4 }));
    expect([rising.muteDb, rising.lowpassHz]).toEqual([0, null]);
    expect(d.step(base({ nowS: 4 })).level).toBe(1);
  });

  it("ducks: own hit −4, kill/ult/streak/rune warning −8 for 0,8 s, a foe's ult telegraph −6, together not below −10", () => {
    const d = createMusicDirector();
    run(d, 0, 1);
    expect(d.step(base({ nowS: 1, cues: [{ kind: "tap" }] })).duckDb).toBe(DUCK.tapDb);
    expect(d.step(base({ nowS: 1.2 })).duckDb).toBe(0);
    // горение и прочий урон по тикам — бой, но без дакинга на каждом тике
    const burn = d.step(base({ nowS: 1.5, cues: [hit(4, true)] }));
    expect(burn.duckDb).toBe(0);
    expect(d.step(base({ nowS: 1.6 }))).toBe(burn);
    expect(d.step(base({ nowS: 2, cues: [{ kind: "kill" }] })).duckDb).toBe(DUCK.heavyDb);
    expect(d.step(base({ nowS: 2.7 })).duckDb).toBe(DUCK.heavyDb);
    expect(d.step(base({ nowS: 2.85 })).duckDb).toBe(0);
    expect(d.step(base({ nowS: 3, enemyUltTelegraph: true })).duckDb).toBe(DUCK.telegraphDb);
    expect(d.step(base({ nowS: 3.1, enemyUltTelegraph: true, cues: [{ kind: "ult", mine: false }, { kind: "tap" }] })).duckDb).toBe(DUCK.floorDb);
  });

  it("stings: a drum on each countdown digit, the gong on «Бой!», victory or defeat on results", () => {
    const d = createMusicDirector();
    const stings: string[] = [];
    for (let t = 0; t <= 3; t += 0.05) {
      const out = d.step(base({ nowS: t, phase: "countdown", phaseLeftS: Math.max(0, 3 - t) }));
      expect(out.bed).toBe(false);
      stings.push(...out.stings);
    }
    stings.push(...d.step(base({ nowS: 3.05 })).stings);
    expect(stings).toEqual(["count", "count", "count", "fight"]);
    expect(d.step(base({ nowS: 10, phase: "results", won: true })).stings).toEqual(["win"]);
    const l = createMusicDirector();
    l.step(base({ nowS: 0 }));
    expect(l.step(base({ nowS: 1, phase: "results" })).stings).toEqual(["lose"]);
  });
});

describe("music cues", () => {
  const state = createMatchState([
    createMageUnit(ME, "fire", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }),
    createMageUnit(FOE, "earth", { pos: { x: 10, y: 0, z: 0 }, yaw: 0 }),
    createDummyUnit(DUMMY, { pos: { x: 30, y: 0, z: 0 }, yaw: 0 }),
  ]);
  const hitEv = (source: number, target: number, dot = false): MatchEvent => ({
    type: "hit", source, target, ability: "fireFists", amount: 15, pos: { x: 0, y: 0, z: 0 }, dir: { x: 1, y: 0, z: 0 },
    knock: { distM: 0, upM: 0 }, airborne: false, dot, killed: false,
  });

  it("a hit with a mage is fight damage, with a dummy only a short duck; someone else's hit is nothing", () => {
    expect(musicCue(hitEv(ME, FOE), ME, state)).toEqual({ kind: "damage", amount: 15, dot: false });
    expect(musicCue(hitEv(FOE, ME), ME, state)).toEqual({ kind: "damage", amount: 15, dot: false });
    expect(musicCue(hitEv(FOE, ME, true), ME, state)).toEqual({ kind: "damage", amount: 15, dot: true });
    expect(musicCue(hitEv(ME, DUMMY), ME, state)).toEqual({ kind: "tap" });
    expect(musicCue(hitEv(ME, DUMMY, true), ME, state)).toBe(null);
    expect(musicCue(hitEv(FOE, DUMMY), ME, state)).toBe(null);
  });

  it("kills, ult casts and the rune; streaks only from confirmed events and only mine", () => {
    const death: MatchEvent = { type: "death", target: FOE, killer: ME, ability: "fireFists", pos: { x: 0, y: 0, z: 0 } };
    expect(musicCue(death, ME, state)).toEqual({ kind: "kill" });
    const cast: MatchEvent = { type: "cast", unit: FOE, ability: "fireFists", slot: "x", pos: { x: 0, y: 0, z: 0 }, dir: { x: 1, y: 0, z: 0 } };
    expect(musicCue(cast, ME, state)).toEqual({ kind: "ult", mine: false });
    const warn: MatchEvent = { type: "pickup", kind: "rune", index: 0, phase: "warn", unit: NOBODY, pos: { x: 0, y: 0, z: 0 } };
    expect(musicCue(warn, ME, state)).toEqual({ kind: "rune", phase: "warn" });
    const orb: MatchEvent = { ...warn, kind: "orb", phase: "take" };
    expect(musicCue(orb, ME, state)).toBe(null);
    const streak: MatchEvent = { type: "streak", unit: ME, multi: 2, streak: 3, broke: NOBODY, brokeStreak: 0 };
    expect(musicCue(streak, ME, state)).toBe(null);
    expect(streakCue(streak, ME)).toEqual({ kind: "streak", multi: 2, streak: 3 });
    const foreign: MatchEvent = { type: "streak", unit: FOE, multi: 2, streak: 3, broke: NOBODY, brokeStreak: 0 };
    expect(streakCue(foreign, ME)).toBe(null);
  });

  it("reads the situation: nearby foes, fury, death, the phase and scores from the confirmed game", () => {
    const cur = structuredClone(state);
    cur.tick = 100;
    cur.units[0]!.status.furyUntil = 200;
    // пишет в один и тот же объект
    const into = emptySituation();
    expect(readSituation(null, cur, ME, into)).toBe(into);
    expect(into).toMatchObject({ phase: "training", near: 1, fury: true, dead: false, scoreLimit: Infinity });
    cur.units[0]!.alive = false;
    cur.units[0]!.respawnTick = 160;
    expect(readSituation(null, cur, ME, into)).toMatchObject({ near: 0, fury: false, dead: true, respawnInS: 1 });
    const match = structuredClone(state);
    match.tick = 1000;
    match.units[1]!.mage!.stats.kills = 4;
    const game: GameState = { ...createGame(), phase: "live", phaseEnd: 1000 + 30 * 60, scoreLimit: 10, match };
    expect(readSituation(game, cur, ME, into)).toMatchObject({ phase: "live", phaseLeftS: 30, bestOther: 4, myScore: 0, scoreLimit: 10 });
    expect(readSituation(null, cur, ME, into)).toMatchObject({ phase: "training", scoreLimit: Infinity, bestOther: 0 });
  });

  it("seeds the melody from the room and the match; the training ground is constant", () => {
    const g = (phaseEnd: number): GameState => ({ ...createGame(), phase: "countdown", phaseEnd });
    expect(musicSeed("ABCD", g(500))).toBe(musicSeed("ABCD", g(500)));
    expect(musicSeed("ABCD", g(500))).not.toBe(musicSeed("ABCD", g(900)));
    expect(musicSeed("ABCD", g(500))).not.toBe(musicSeed("WXYZ", g(500)));
    // тот же матч, уже в бою — то же зерно, что на отсчёте
    expect(musicSeed("ABCD", { ...g(500), phase: "live", phaseEnd: 500 + 420 * 60 })).toBe(musicSeed("ABCD", g(500)));
    expect(musicSeed(null, null)).toBe(TRAINING_SEED);
    const keep = createSeedKeeper();
    expect(keep(null, null)).toBe(TRAINING_SEED);
    expect(keep("ABCD", g(500))).toBe(musicSeed("ABCD", g(500)));
    expect(keep("ABCD", { ...g(500), phase: "live", phaseEnd: 500 + 420 * 60 })).toBe(musicSeed("ABCD", g(500)));
    expect(keep("ABCD", g(900))).toBe(musicSeed("ABCD", g(900)));
  });
});
