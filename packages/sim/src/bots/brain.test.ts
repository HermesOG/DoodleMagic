import { afterEach, describe, expect, it, vi } from "vitest";
import { aabb } from "../aabb";
import { ULT_CHARGE } from "../match/defs";
import { addMage, createGame, stepGame, type GameState } from "../match/rules";
import { clonePlain, idleInput, unitById } from "../match/state";
import { NOBODY, type MatchContext, type MatchInput, type UnitId } from "../match/types";
import type { Collider } from "../types";
import { createWorld } from "../world";
import { RUNE_CLAIM, botClaim, claimsFor, createBot, stepBot, type BotState, type BotWorld } from "./brain";
import { buildNav } from "./nav";
import { BOT_TRAITS } from "./params";

/**
 * Мозг бота на синтетической арене: пол 40 × 40 м в стенах, перегородка посередине. Бои на «Галерее» — в
 * packages/arena/src/bots.brain.sim.test.ts.
 */
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({ box: aabb(x0, y0, z0, x1, y1, z1) });
const world = createWorld([
  box(-20, -1, -20, 20, 0, 20),
  box(-21, 0, -21, -20, 4, 21), box(20, 0, -21, 21, 4, 21), box(-20, 0, -21, 20, 4, -20), box(-20, 0, 20, 20, 4, 21),
  box(-6, 0, -0.25, 6, 3, 0.25),
]);
const ctx: MatchContext = {
  world, killBelowY: -10, mageRespawnS: 3, spawnShieldS: 2,
  spawns: [{ pos: { x: -15, y: 0, z: -15 }, yaw: 0 }, { pos: { x: 15, y: 0, z: 15 }, yaw: Math.PI }, { pos: { x: 15, y: 0, z: -15 }, yaw: 0 }, { pos: { x: -15, y: 0, z: 15 }, yaw: Math.PI }],
};
const nav = buildNav(world, ctx.killBelowY);

/** Глубокая заморозка простых данных (типизированные массивы сетки заморозить нельзя — их не трогаем). */
function freeze<T>(v: T): T {
  if (v === null || typeof v !== "object" || ArrayBuffer.isView(v)) return v;
  for (const k of Object.keys(v)) freeze((v as Record<string, unknown>)[k]);
  return Object.freeze(v);
}

function duel(a: "fire" | "air" | "earth" | "water", b: "fire" | "air" | "earth" | "water"): { g: GameState; ids: [UnitId, UnitId] } {
  let g = createGame();
  const r1 = addMage(g, a, ctx);
  g = r1.game;
  const r2 = addMage(g, b, ctx);
  g = r2.game;
  return { g, ids: [r1.id, r2.id] };
}

function run(g: GameState, bots: BotState[], n: number, each?: (inputs: Partial<Record<UnitId, MatchInput>>, g: GameState, bots: BotState[]) => void): { g: GameState; bots: BotState[] } {
  for (let t = 0; t < n; t++) {
    const inputs: Partial<Record<UnitId, MatchInput>> = {};
    // по очереди: claims — по уже обновлённым состояниям ботов этого тика (как у хоста)
    bots = [...bots];
    for (let k = 0; k < bots.length; k++) {
      const r = stepBot(bots[k]!, g.match, { nav, ctx, humans: [], claims: claimsFor(bots, bots[k]!.id) });
      inputs[bots[k]!.id] = r.input;
      bots[k] = r.bot;
    }
    each?.(inputs, g, bots);
    g = stepGame(g, inputs, ctx).game;
  }
  return { g, bots };
}

afterEach(() => vi.restoreAllMocks());

describe("bot brain (synthetic arena)", () => {
  it("is pure: frozen arguments, byte-identical results twice, never reads Math.random", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("stepBot must not use Math.random");
    });
    const { g, ids } = duel("fire", "air");
    let state = g;
    let bots = [createBot(ids[0], "archmage", 1), createBot(ids[1], "novice", 2)];
    const w: BotWorld = freeze({ nav, ctx, humans: [ids[1]], claims: {} });
    for (let t = 0; t < 900; t++) {
      const inputs: Partial<Record<UnitId, MatchInput>> = {};
      const frozenState = freeze(clonePlain(state.match));
      bots = bots.map((b) => {
        const fb = freeze(clonePlain(b));
        const r1 = stepBot(fb, frozenState, { ...w, claims: freeze(claimsFor(bots, b.id)) });
        if (t % 9 === 0) expect(JSON.stringify(stepBot(fb, frozenState, { ...w, claims: claimsFor(bots, b.id) }))).toBe(JSON.stringify(r1));
        inputs[b.id] = r1.input;
        return r1.bot;
      });
      state = stepGame(state, inputs, ctx).game;
    }
    // бой шёл: кто-то стрелял
    expect(state.match.units.some((u) => (u.mage?.stats.damage ?? 0) > 0)).toBe(true);
  }, 30_000);

  it("replays byte-identically from the same seeds", () => {
    const go = () => {
      const { g, ids } = duel("water", "earth");
      return run(g, [createBot(ids[0], "mage", 9), createBot(ids[1], "mage", 10)], 600);
    };
    const a = go();
    const b = go();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 30_000);

  it("creates bots with a trait from the seed and plain-data memory", () => {
    const traits = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const b = createBot(3, "mage", seed);
      expect(BOT_TRAITS).toContain(b.trait);
      expect(createBot(3, "mage", seed)).toEqual(b);
      expect(JSON.parse(JSON.stringify(b))).toEqual(b);
      traits.add(b.trait);
    }
    expect(traits.size).toBe(3);
  });

  it("a dead bot sends idleInput and forgets its target and path", () => {
    const { g, ids } = duel("fire", "earth");
    let { g: g2, bots } = run(g, [createBot(ids[0], "archmage", 4)], 400);
    expect(bots[0]!.target).toBe(ids[1]);
    const u = unitById(g2.match, ids[0])!;
    u.alive = false;
    u.respawnTick = g2.match.tick + 100;
    const r = stepBot(bots[0]!, g2.match, { nav, ctx, humans: [], claims: {} });
    expect(r.input).toEqual(idleInput(u));
    expect([r.bot.target, r.bot.path, r.bot.memory, botClaim(r.bot)]).toEqual([NOBODY, [], [], NOBODY]);
    bots = [r.bot];
  });

  it("presses X for exactly one tick when the charge is full and the target is in range", () => {
    let { g, ids } = duel("fire", "water");
    const me = unitById(g.match, ids[0])!;
    me.move.body.pos = { x: -4, y: 0, z: -8 };
    me.move.yaw = -Math.PI / 2;
    const target = unitById(g.match, ids[1])!;
    target.move.body.pos = { x: 4, y: 0, z: -8 };
    target.status.shieldUntil = 0; // давно на арене: без поблажки после появления
    // цель стоит и не умирает: бот видит её всё время
    const tough = (_: unknown, gg: GameState): void => {
      unitById(gg.match, ids[1])!.hp = 150;
    };
    let bots = [createBot(ids[0], "novice", 6)];
    ({ g, bots } = run(g, bots, 120, tough));
    expect(bots[0]!.target).toBe(ids[1]);
    unitById(g.match, ids[0])!.mage!.ult.charge = ULT_CHARGE.max;
    const xs: boolean[] = [];
    run(g, bots, 200, (inputs, gg) => {
      xs.push(inputs[ids[0]]!.x);
      tough(inputs, gg);
    });
    expect(xs.filter(Boolean).length).toBe(1);
    const k = xs.indexOf(true);
    expect([xs[k - 1], xs[k + 1]]).toEqual([false, false]);
  });

  it("claims: target id, the rune, or nobody; claimsFor counts the other bots only", () => {
    const a = createBot(1, "mage", 1);
    const b = { ...createBot(2, "mage", 2), target: 7 };
    const c = { ...createBot(3, "mage", 3), mode: "rune" as const };
    expect([botClaim(a), botClaim(b), botClaim(c)]).toEqual([NOBODY, 7, RUNE_CLAIM]);
    expect(claimsFor([a, b, c], 1)).toEqual({ 7: 1, [RUNE_CLAIM]: 1 });
    expect(claimsFor([a, b, c], 2)).toEqual({ [RUNE_CLAIM]: 1 });
  });
});
