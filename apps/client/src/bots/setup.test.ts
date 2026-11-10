import { describe, expect, it } from "vitest";
import {
  BOT_SETUP_KEY, DEFAULT_BOT_SETUP, botElements, botsLead, loadBotSetup, modeFromUrl, parseBotSetup, rulesLine, saveBotSetup, type SetupStore,
} from "./setup";

/** Детерминированный «случай» для тасования: линейный конгруэнтный. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
function memory(): SetupStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("bot setup", () => {
  it("defaults: bot fight, 3 bots, Ученик, mixed elements", () => {
    expect(parseBotSetup(null)).toEqual({ mode: "bots", count: 3, level: "novice", elements: "mix" });
    expect(DEFAULT_BOT_SETUP).toEqual(parseBotSetup(null));
  });

  it("garbage falls back to defaults, field by field; the count is clamped to 1–5", () => {
    expect(parseBotSetup("{нет")).toEqual(DEFAULT_BOT_SETUP);
    expect(parseBotSetup("[1,2]")).toEqual(DEFAULT_BOT_SETUP);
    expect(parseBotSetup('"bots"')).toEqual(DEFAULT_BOT_SETUP);
    expect(parseBotSetup(JSON.stringify({ mode: "x", count: "3", level: "god", elements: "plasma" }))).toEqual(DEFAULT_BOT_SETUP);
    expect(parseBotSetup(JSON.stringify({ count: 9 })).count).toBe(5);
    expect(parseBotSetup(JSON.stringify({ count: 0 })).count).toBe(1);
    expect(parseBotSetup(JSON.stringify({ count: -3.7 })).count).toBe(1);
    expect(parseBotSetup(JSON.stringify({ mode: "training", count: 2, level: "archmage", elements: "water" }))).toEqual({
      mode: "training", count: 2, level: "archmage", elements: "water",
    });
  });

  it("save and load round-trip through dm.bots", () => {
    const store = memory();
    expect(loadBotSetup(store)).toEqual(DEFAULT_BOT_SETUP);
    saveBotSetup({ mode: "training", count: 5, level: "mage", elements: "air" }, store);
    expect(store.data.has(BOT_SETUP_KEY)).toBe(true);
    expect(loadBotSetup(store)).toEqual({ mode: "training", count: 5, level: "mage", elements: "air" });
    expect(loadBotSetup(null)).toEqual(DEFAULT_BOT_SETUP);
  });

  it("botElements: mixed — all different up to four bots; one chosen — everyone", () => {
    for (let seed = 1; seed < 30; seed++) {
      for (let n = 1; n <= 4; n++) {
        const els = botElements({ ...DEFAULT_BOT_SETUP, count: n }, lcg(seed));
        expect(els).toHaveLength(n);
        expect(new Set(els).size).toBe(n);
      }
      const five = botElements({ ...DEFAULT_BOT_SETUP, count: 5 }, lcg(seed));
      expect(new Set(five).size).toBe(4);
    }
    expect(botElements({ ...DEFAULT_BOT_SETUP, count: 3, elements: "earth" }, lcg(1))).toEqual(["earth", "earth", "earth"]);
  });

  it("mode by link: ?mode=training, ?mode=bots, /bots; otherwise none", () => {
    expect(modeFromUrl("/", "?mode=training")).toBe("training");
    expect(modeFromUrl("/", "?mode=bots")).toBe("bots");
    expect(modeFromUrl("/bots", "")).toBe("bots");
    expect(modeFromUrl("/", "?arena=compact")).toBeNull();
  });

  it("rules and menu lead: limit by mages including the player", () => {
    expect(rulesLine(3)).toMatch(/^Каждый за себя · 7 минут или до \d+ очков$/);
    expect(botsLead({ ...DEFAULT_BOT_SETUP, count: 1 })).toMatch(/^Ты и 1 бот · Ученик · /);
    expect(botsLead({ ...DEFAULT_BOT_SETUP, count: 3, level: "archmage" })).toMatch(/^Ты и 3 бота · Архимаг · /);
    expect(botsLead({ ...DEFAULT_BOT_SETUP, count: 5 })).toMatch(/^Ты и 5 ботов · /);
  });
});
