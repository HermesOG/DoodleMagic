import { ELEMENTS, NOBODY, PVP, addMage, createGame, type UnitId } from "@doodlemagic/sim";
import { describe, expect, it } from "vitest";
import { LOCAL_PEER, createHostCore, rarestElement, type HostCore } from "./hostCore";
import { BOT_PING } from "./protocol";
import type { SnapshotMsg } from "./snapshot";
import { testPvpContext } from "./testArena";

/** Боты в ядре хоста (фаза 8): тот же stepGame, ввод — от stepBot. Арена — испытания сети (пол и пропасть). */
const ctx = testPvpContext();
const MS_PER_TICK = 1000 / 60;

function run(h: HostCore, n: number): SnapshotMsg[] {
  const snaps: SnapshotMsg[] = [];
  for (let k = 0; k < n; k++) {
    const r = h.tick(null, k * MS_PER_TICK);
    if (r.snapshot) snaps.push(r.snapshot);
  }
  return snaps;
}
const posOf = (h: HostCore, id: UnitId) => h.game.match.units.find((u) => u.id === id)!.move.body.pos;

describe("hostCore: bots", () => {
  it("addBot: a fire mage named «Фитиль · бот», ping BOT_PING in the roster", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Искра", "earth", 0);
    const r = h.addBot("fire", "mage");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(h.names().get(r.id)).toBe("Фитиль · бот");
    expect(h.pings().get(r.id)).toBe(BOT_PING);
    expect(h.game.match.units.find((u) => u.id === r.id)?.mage?.element).toBe("fire");
    expect(h.bots()).toEqual([{ id: r.id, level: "mage", element: "fire", claim: NOBODY }]);
    // вторая — следующее имя той же стихии
    const r2 = h.addBot("fire", "mage");
    expect(r2.ok && h.names().get(r2.id)).toBe("Зола · бот");
    const snap = run(h, 6).at(-1)!;
    expect(snap.roster).toContainEqual([r.id, "Фитиль · бот", BOT_PING]);
  });

  it("the bot's input goes into stepGame (it moves) and into the snapshot looks", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Искра", "earth", 0);
    const r = h.addBot("air", "archmage");
    if (!r.ok) throw new Error("full");
    h.start();
    const from = { ...posOf(h, r.id) };
    // отсчёт 3 с, потом бой: бот ищет цель и бежит
    const snaps = run(h, PVP.countdownS * 60 + 120);
    const to = posOf(h, r.id);
    expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThan(0.5);
    const moving = snaps.some((s) => s.looks.some((l) => l[0] === r.id && (l[1] !== 0 || l[2] !== 0)));
    expect(moving).toBe(true);
  });

  it("the seventh member is told the room is full; removeBot() takes the last added", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Искра", "earth", 0);
    const ids: UnitId[] = [];
    for (let k = 0; k < PVP.maxPlayers - 1; k++) {
      const r = h.addBot(ELEMENTS[k % ELEMENTS.length]!, "novice");
      if (r.ok) ids.push(r.id);
    }
    expect(ids).toHaveLength(PVP.maxPlayers - 1);
    expect(h.addBot("fire", "novice")).toEqual({ ok: false, reason: "full" });
    expect(h.removeBot()).toBe(true);
    expect(h.bots().map((b) => b.id)).toEqual(ids.slice(0, -1));
    expect(h.removeBot(ids[0])).toBe(true);
    expect(h.bots().map((b) => b.id)).toEqual(ids.slice(1, -1));
    expect(h.removeBot(1)).toBe(false); // хост — не бот
  });

  it("a human joining a full room with a bot takes the last bot's place", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Искра", "earth", 0);
    for (let k = 0; k < PVP.maxPlayers - 1; k++) h.addBot("water", "mage");
    const last = h.bots().at(-1)!.id;
    const r = h.join("p1", "Валун", "earth", 0);
    expect(r.ok).toBe(true);
    expect(h.names().size).toBe(PVP.maxPlayers);
    expect(h.bots().map((b) => b.id)).not.toContain(last);
    expect(h.game.match.units.some((u) => u.id === last)).toBe(false);
  });

  it("the same seed gives the same game after 300 ticks", () => {
    const make = (): HostCore => {
      const h = createHostCore(ctx, { seed: 42 });
      h.join(LOCAL_PEER, "Искра", "earth", 0);
      h.addBot("fire", "mage");
      h.addBot("water", "archmage");
      h.start();
      run(h, 300);
      return h;
    };
    expect(JSON.stringify(make().game)).toBe(JSON.stringify(make().game));
  });

  it("bots step in turn: never more than one Ученик on the human (quota of Р8) on any tick", () => {
    const h = createHostCore(ctx, { seed: 3 });
    const me = h.join(LOCAL_PEER, "Искра", "earth", 0);
    if (!me.ok) throw new Error("full");
    for (const e of ["fire", "air", "water"] as const) h.addBot(e, "novice");
    h.start();
    let most = 0;
    let seen = 0;
    for (let k = 0; k < PVP.countdownS * 60 + 30 * 60; k++) {
      h.tick(null, k * MS_PER_TICK);
      const n = h.bots().filter((b) => b.claim === me.id).length;
      most = Math.max(most, n);
      if (n > 0) seen++;
    }
    expect(seen).toBeGreaterThan(0); // кто-то за 30 с боя всё же пошёл на человека
    expect(most).toBe(1);
  });

  it("setBotLevel changes every bot's level", () => {
    const h = createHostCore(ctx);
    h.addBot("fire", "novice");
    h.addBot("earth", "novice");
    h.setBotLevel("archmage");
    expect(h.bots().map((b) => b.level)).toEqual(["archmage", "archmage"]);
  });

  it("rarestElement: the least common element among the mages, ties in ELEMENTS order", () => {
    let g = createGame();
    expect(rarestElement(g, ELEMENTS)).toBe(ELEMENTS[0]);
    g = addMage(g, "fire", ctx).game;
    g = addMage(g, "earth", ctx).game;
    expect(rarestElement(g, ELEMENTS)).toBe("air");
    g = addMage(g, "air", ctx).game;
    expect(rarestElement(g, ELEMENTS)).toBe("water");
  });
});
