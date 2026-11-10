import { describe, expect, it } from "vitest";
import {
  ELEMENTS, NOBODY, addMage, buildNav, claimsFor, createBot, createGame, pvpContext, startCountdown, stepBot, stepGame,
  type BotState, type GameState, type MatchInput, type Slot, type UnitId,
} from "@doodlemagic/sim";
import { buildGallery } from "./gallery";

/**
 * Фаза 8: короткий бой ботов на «Галерее» — четыре стихии, уровень Маг, ульта ×1, отсчёт и 2,5 минуты stepGame.
 * Каждый бот пускает в ход хотя бы два из Q/E/C, кто-то кого-то убивает, сбросов без сбросившего (сам упал) нет.
 */
const arena = buildGallery("full");
const ctx = { ...pvpContext(arena), ultChargeMul: 1 };
const nav = buildNav(ctx.world, ctx.killBelowY);
const host = globalThis as unknown as { console: { log(...a: unknown[]): void } };

describe("a short bot fight on the gallery", () => {
  it("four Mage bots of different elements: two of Q/E/C each, a kill, no uncredited falls in 2.5 minutes", () => {
    let g: GameState = createGame();
    const bots: BotState[] = [];
    for (const element of ELEMENTS) {
      const r = addMage(g, element, ctx);
      g = r.game;
      bots.push(createBot(r.id, "mage", 7));
    }
    g = startCountdown(g);
    const used = new Map<UnitId, Set<Slot>>(bots.map((b) => [b.id, new Set<Slot>()]));
    let kills = 0;
    let selfFalls = 0;
    let liveTicks = 0;
    for (let t = 0; liveTicks < 150 * 60 && t < 160 * 60; t++) {
      const inputs: Partial<Record<UnitId, MatchInput>> = {};
      for (let k = 0; k < bots.length; k++) {
        const r = stepBot(bots[k]!, g.match, { nav, ctx, humans: [], claims: claimsFor(bots, bots[k]!.id) });
        inputs[bots[k]!.id] = r.input;
        bots[k] = r.bot;
      }
      if (g.phase === "live") liveTicks++;
      const out = stepGame(g, inputs, ctx);
      g = out.game;
      for (const e of out.events) {
        if (e.type === "cast" && (e.slot === "q" || e.slot === "e" || e.slot === "c")) used.get(e.unit)?.add(e.slot);
        else if (e.type === "death" && e.killer !== NOBODY && e.killer !== e.target) kills++;
        else if (e.type === "fall") {
          if (e.credit === NOBODY) selfFalls++;
          else kills++;
        }
      }
    }
    host.console.log(`arena fight: kills ${kills}, self-falls ${selfFalls}, slots ${[...used].map(([id, s]) => `${id}:${[...s].join("")}`).join(" ")}`);
    for (const [, slots] of used) expect(slots.size).toBeGreaterThanOrEqual(2);
    expect(kills).toBeGreaterThan(0);
    expect(selfFalls).toBe(0);
  }, 30_000);
});
