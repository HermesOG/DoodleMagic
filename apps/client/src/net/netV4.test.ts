import { buildGallery } from "@doodlemagic/arena";
import { NEVER, NOBODY, pvpContext, type MatchEvent } from "@doodlemagic/sim";
import { describe, expect, it } from "vitest";
import { decodeBinary, encodeBinary } from "./codec";
import { LOCAL_PEER, createHostCore } from "./hostCore";
import { createPredictor, eventKey } from "./predict";
import { NET_VERSION } from "./protocol";
import { gamePeerId } from "./room";
import { isSnapshot, type SnapshotMsg } from "./snapshot";
import { input } from "./testArena";

/** Сеть v4 фазы 6 (Р6): объекты на карте и ярость в снапшоте, свои id комнат, ключи новых событий. */
const ctx = pvpContext(buildGallery("full"));
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });

/** Хост (маг 1) и гость (маг 2) на галерее: первый снапшот. */
function snapshot(): SnapshotMsg {
  const h = createHostCore(ctx);
  h.join(LOCAL_PEER, "Хост", "fire", 0);
  h.join("p", "Гость", "water", 0);
  for (let k = 0; k < 10; k++) {
    const r = h.tick(input(), k * (1000 / 60));
    if (r.snapshot) return r.snapshot;
  }
  throw new Error("снапшота нет");
}

describe("net v4", () => {

  it("a snapshot carries the pickups and the fury; without pickups it is not a snapshot", async () => {
    const s = snapshot();
    expect(s.game.match.pickups.map((p) => [p.kind, p.readyAt])).toEqual(ctx.pickups!.map((p) => [p.kind, p.kind === "rune" ? 2700 : NEVER]));
    expect(s.game.match.units.map((u) => u.status.furyUntil)).toEqual([0, 0]);
    const back = await decodeBinary(await encodeBinary(s));
    expect(isSnapshot(back)).toBe(true);
    expect((back as SnapshotMsg).game.match.pickups).toEqual(s.game.match.pickups);
    const bare = structuredClone(s) as unknown as { game: { match: Record<string, unknown> } };
    delete bare.game.match.pickups;
    expect(isSnapshot(bare)).toBe(false);
    bare.game.match.pickups = {};
    expect(isSnapshot(bare)).toBe(false);
  });

  it("the guest predicts its own pickup from the snapshot", () => {
    const s = structuredClone(snapshot());
    const orb = s.game.match.pickups.findIndex((p) => p.kind === "orb");
    const me = s.game.match.units.find((u) => u.id === 2)!;
    Object.assign(me.move.body.pos, { x: s.game.match.pickups[orb]!.pos.x, y: s.game.match.pickups[orb]!.pos.y - 0.5, z: s.game.match.pickups[orb]!.pos.z });
    me.hp = 50;
    const p = createPredictor(ctx, 2);
    p.applySnapshot(s);
    const { events } = p.step(input());
    expect(events.filter((e) => e.type === "pickup")).toMatchObject([{ kind: "orb", index: orb, phase: "take", unit: 2 }]);
    expect(p.cur.match.pickups[orb]!.readyAt).toBe(s.tick + 900);
  });

  it("keys the pickup and fury events", () => {
    const evs: [MatchEvent, string][] = [
      [{ type: "pickup", kind: "rune", index: 4, phase: "warn", unit: NOBODY, pos: V(0, 0.5, 0) }, "pickup:rune:4:warn:-1"],
      [{ type: "pickup", kind: "orb", index: 2, phase: "spawn", unit: NOBODY, pos: V() }, "pickup:orb:2:spawn:-1"],
      [{ type: "pickup", kind: "orb", index: 2, phase: "take", unit: 3, pos: V() }, "pickup:orb:2:take:3"],
      [{ type: "fury", unit: 3, phase: "end", by: NOBODY, pos: V() }, "fury:3:end:-1"],
      [{ type: "fury", unit: 3, phase: "slain", by: 1, pos: V() }, "fury:3:slain:1"],
      [{ type: "status", target: 3, status: "fury", ticks: 720, source: 3 }, "status:3:3:fury"],
    ];
    for (const [ev, key] of evs) expect(eventKey(ev)).toBe(key);
  });
});

/** Сеть v5 фазы 9 (Р9): добыча и серии меняют предсказание; серии едут в stats снапшота. */
describe("net v5", () => {
  it("is version 5 with its own peer ids", () => {
    expect(NET_VERSION).toBe(5);
    expect(gamePeerId("ABCD")).toBe("doodlemagic-g5-abcd-host");
  });

  it("the streak fields of stats survive the binary snapshot, −1 included", async () => {
    const s = snapshot();
    Object.assign(s.game.match.units[0]!.mage!.stats, { streak: 7, multi: 3, lastScoreTick: 123456 });
    Object.assign(s.game.match.units[1]!.mage!.stats, { streak: 0, multi: 0, lastScoreTick: -1 });
    const back = (await decodeBinary(await encodeBinary(s))) as SnapshotMsg;
    expect(back.game.match.units.map((u) => u.mage!.stats)).toEqual(s.game.match.units.map((u) => u.mage!.stats));
    expect(back.game.match.units.map((u) => [u.mage!.stats.streak, u.mage!.stats.multi, u.mage!.stats.lastScoreTick])).toEqual([[7, 3, 123456], [0, 0, -1]]);
  });

  it("keys the loot and streak events", () => {
    const evs: [MatchEvent, string][] = [
      [{ type: "loot", unit: 1, victim: 2, amount: 30, pos: V() }, "loot:1:2"],
      [{ type: "streak", unit: 1, multi: 2, streak: 5, broke: NOBODY, brokeStreak: 0 }, "streak:1:2:5"],
    ];
    for (const [ev, key] of evs) expect(eventKey(ev)).toBe(key);
  });
});
