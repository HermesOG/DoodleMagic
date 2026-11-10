import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { addMage, createGame, stepGame, type GameState } from "../match/rules";
import { unitById } from "../match/state";
import type { Element, MatchContext, MatchEvent, MatchInput, UnitId } from "../match/types";
import type { Collider } from "../types";
import { createWorld } from "../world";
import { claimsFor, createBot, stepBot, type BotState } from "./brain";
import { buildNav } from "./nav";
import type { BotLevel } from "./params";

/**
 * Точность ЛКМ по уровням (Р4): бот против мага, который стрейфит поперёк линии (смена стороны через 0,4–1,2 с) и держит
 * 17,5 м. Ровное поле 120 × 120 м в стенах — без укрытий. Сцены стихий на «Галерее» — в packages/arena/src/bots.kits.sim.test.ts.
 */
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({ box: aabb(x0, y0, z0, x1, y1, z1) });
const H = 60;
const world = createWorld([
  box(-H, -1, -H, H, 0, H),
  box(-H - 1, 0, -H - 1, -H, 4, H + 1), box(H, 0, -H - 1, H + 1, 4, H + 1), box(-H, 0, -H - 1, H, 4, -H), box(-H, 0, H, H, 4, H + 1),
]);
const ctx: MatchContext = {
  world, killBelowY: -10, mageRespawnS: 3, spawnShieldS: 0,
  spawns: [{ pos: { x: 0, y: 0, z: 0 }, yaw: 0 }, { pos: { x: 0, y: 0, z: -17.5 }, yaw: Math.PI }],
};
const nav = buildNav(world, ctx.killBelowY);
const PRIMARY: Readonly<Record<Element, string>> = { fire: "fireFists", earth: "stoneShot", air: "airSickle", water: "waterWhip" };
/** Под общей нагрузкой прогона — с запасом. */
const LONG = 30_000;
const host = globalThis as unknown as { console: { log(...a: unknown[]): void } };

/** Попадания / выстрелы ЛКМ бота уровня level стихии element по стрейфящему магу на 17,5 м за seconds с. */
function accuracy(element: Element, level: BotLevel, seed: number, seconds: number): { shots: number; hits: number } {
  let g: GameState = createGame();
  const a = addMage(g, element, ctx);
  g = a.game;
  const b = addMage(g, "earth", ctx);
  g = b.game;
  const me = a.id;
  const runner = b.id;
  unitById(g.match, me)!.move.body.pos = { x: 0, y: 0, z: 0 };
  unitById(g.match, runner)!.move.body.pos = { x: 0, y: 0, z: -17.5 };
  let bots: BotState[] = [createBot(me, level, seed)];
  let r = (seed * 2654435761) >>> 0;
  const next = (): number => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296;
  let side = 1;
  let switchAt = 0;
  let shots = 0;
  let hits = 0;
  for (let t = 0; t < seconds * 60; t++) {
    const s = g.match;
    const u = unitById(s, runner)!;
    u.hp = u.maxHp;
    const p = u.move.body.pos;
    const q = unitById(s, me)!.move.body.pos;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (t >= switchAt) {
      side = next() < 0.5 ? -1 : 1;
      switchAt = t + Math.round(60 * (0.4 + 0.8 * next()));
    }
    const run: MatchInput = {
      moveX: side, moveZ: Math.max(-1, Math.min(1, (d - 17.5) * 0.6)), jump: false, yaw: Math.atan2(-dx, -dz), pitch: 0,
      primary: false, q: false, e: false, c: false, x: false,
    };
    const inputs: Partial<Record<UnitId, MatchInput>> = { [runner]: run };
    for (let k = 0; k < bots.length; k++) {
      const st = stepBot(bots[k]!, s, { nav, ctx, humans: [], claims: claimsFor(bots, bots[k]!.id) });
      inputs[bots[k]!.id] = st.input;
      bots = [st.bot];
    }
    const out = stepGame(g, inputs, ctx);
    g = out.game;
    // считаем только на 15–20 м
    if (d < 15 || d > 20) continue;
    for (const e of out.events as MatchEvent[]) {
      if (e.type === "cast" && e.unit === me && e.slot === "primary") shots++;
      if (e.type === "hit" && e.source === me && e.target === runner && e.ability === PRIMARY[element] && !e.dot) hits++;
    }
  }
  return { shots, hits };
}

describe("bot aim by level", () => {
  it.each(["air", "earth"] as const)("%s: LMB hit rate on a strafing mage at 15–20 m — Novice < Mage < Archmage, Archmage ≤ 50 %", (element) => {
    const rate: Record<BotLevel, number> = { novice: 0, mage: 0, archmage: 0 };
    for (const level of ["novice", "mage", "archmage"] as const) {
      let shots = 0;
      let hits = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const r = accuracy(element, level, seed, 12);
        shots += r.shots;
        hits += r.hits;
      }
      expect(shots).toBeGreaterThan(30);
      rate[level] = hits / shots;
    }
    host.console.log(`${element} accuracy: novice ${(rate.novice * 100).toFixed(0)} %, mage ${(rate.mage * 100).toFixed(0)} %, archmage ${(rate.archmage * 100).toFixed(0)} %`);
    expect(rate.novice).toBeLessThan(rate.mage);
    expect(rate.mage).toBeLessThan(rate.archmage);
    expect(rate.archmage).toBeLessThanOrEqual(0.5);
  }, LONG);
});
