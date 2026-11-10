import { PVP, TICK_DT, type MatchInput } from "@doodlemagic/sim";
import { describe, expect, it } from "vitest";
import { BOT_PING } from "../net/protocol";
import { input, testPvpContext } from "../net/testArena";
import { createLocalHost } from "./localHost";

const ctx = testPvpContext();
const idle = (): MatchInput => input();

describe("local host (bot fight)", () => {
  it("enter + 3 bots → 4 mages; bots show as bots in the roster", () => {
    const h = createLocalHost(ctx, { seed: 7 });
    h.enter("Ты", "fire");
    expect(h.localId).toBe(1);
    for (const e of ["earth", "air", "water"] as const) expect(h.addBot(e, "novice")).toBe(true);
    expect(h.game().match.units.filter((u) => u.mage)).toHaveLength(4);
    expect(h.names().get(2)).toBe("Глыба · бот");
    expect(h.pings().get(2)).toBe(BOT_PING);
    expect(h.pings().get(1)).toBe(0);
    expect(h.isHost).toBe(true);
    expect(h.roomCode).toBe("");
    expect(h.link()).toBe("ok");
    expect(h.ownPing()).toBe(0);
  });

  it("start() → countdown; advance gives the ticks and their events; paused — the tick stays", () => {
    const h = createLocalHost(ctx, { seed: 7 });
    h.enter("Ты", "fire");
    h.addBot("earth", "mage");
    expect(h.game().phase).toBe("warmup");
    h.start();
    expect(h.game().phase).toBe("countdown");
    const t0 = h.game().match.tick;
    const f = h.advance(TICK_DT * 3 + 1e-6, idle);
    expect(f.ticks).toHaveLength(3);
    expect(h.game().match.tick).toBe(t0 + 3);
    expect(f.cur).toBe(h.game().match);
    h.setPaused(true);
    const p = h.advance(1, idle);
    expect(p.ticks).toHaveLength(0);
    expect(h.game().match.tick).toBe(t0 + 3);
    h.setPaused(false);
    // отсчёт кончается — событие боя приходит в кадре подтверждённым
    let live = false;
    for (let k = 0; k < PVP.countdownS * 60 && !live; k++) {
      h.advance(TICK_DT + 1e-9, idle);
      live = h.game().phase === "live";
    }
    expect(live).toBe(true);
    const many = h.advance(1, idle);
    expect(many.ticks.length).toBeLessThanOrEqual(5); // после зависания не догоняет
    expect(many.confirmed).toEqual(many.ticks.flatMap((t) => t.events));
  });
});
