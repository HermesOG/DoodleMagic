import { describe, expect, it } from "vitest";
import type { MatchEvent } from "@doodlemagic/sim";
import { LOCAL_PEER, createHostCore } from "./hostCore";
import { createPredictor, eventKey } from "./predict";
import { NET_VERSION } from "./protocol";
import { gamePeerId } from "./room";
import { isSnapshot, type SnapshotMsg } from "./snapshot";
import { input, testPvpContext } from "./testArena";

/** Сеть v2 фазы 4 (Р16): четыре стихии, прыжок в looks, ключи новых событий. */
const ctx = testPvpContext();
const HOST_ID = 1;
const ME = 2;
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });

/** Хост (маг 1, держит прыжок с тика jumpFrom) и гость (маг 2): снапшоты n тиков. */
function snapshots(n: number, jumpFrom = Infinity): SnapshotMsg[] {
  const h = createHostCore(ctx);
  h.join(LOCAL_PEER, "Хост", "air", 0);
  h.join("p", "Гость", "water", 0);
  const out: SnapshotMsg[] = [];
  for (let k = 0; k < n; k++) {
    const r = h.tick(input({ jump: k >= jumpFrom }), k * (1000 / 60));
    if (r.snapshot) out.push(r.snapshot);
  }
  return out;
}

describe("net v2", () => {
  it("is version 2 with its own peer ids", () => {
    expect(NET_VERSION).toBe(3);
    expect(gamePeerId("ABCD")).toBe("doodlemagic-g3-abcd-host");
  });

  it("the host writes the held jump as the 6th look column; a snapshot needs all 6", () => {
    const held = snapshots(3, 0)[0]!;
    const free = snapshots(3)[0]!;
    expect(held.looks.find(([id]) => id === HOST_ID)).toEqual([HOST_ID, 0, 0, 0, 0, 1]);
    expect(free.looks.find(([id]) => id === HOST_ID)?.[5]).toBe(0);
    expect(isSnapshot(held)).toBe(true);
    const five = structuredClone(held) as unknown as { looks: number[][] };
    five.looks = five.looks.map((r) => r.slice(0, 5));
    expect(isSnapshot(five)).toBe(false);
  });

  it("a foreign mage with jump01 = 1 keeps the jump held in the replay; with 0 — not", () => {
    const hold = (j: number): boolean => {
      const s = structuredClone(snapshots(3)[0]!);
      s.looks = s.looks.map((r) => (r[0] === HOST_ID ? [r[0], r[1], r[2], r[3], r[4], j] : r));
      const p = createPredictor(ctx, ME);
      p.applySnapshot(s);
      p.step(input(), false);
      return p.cur.match.units.find((u) => u.id === HOST_ID)!.move.jumpHeld;
    };
    expect([hold(1), hold(0)]).toEqual([true, false]);
  });

  it("keys the phase-4 events, and the dash key knows its ability", () => {
    const evs: [MatchEvent, string][] = [
      [{ type: "beam", unit: 1, ability: "gust", from: V(), to: V(), target: 2 }, "beam:1:gust"],
      [{ type: "blown", unit: 1, projectile: 9, kind: "fireball", owner: 2, pos: V() }, "blown:1:fireball"],
      [{ type: "slam", target: 2, source: 1, pos: V() }, "slam:1:2"],
      [{ type: "airJump", unit: 1, pos: V() }, "airJump:1"],
      [{ type: "glide", unit: 1, on: true, pos: V() }, "glide:1:true"],
      [{ type: "charge", unit: 1, slot: "e", charges: 2 }, "charge:1:e:2"],
      [{ type: "absorb", unit: 2, projectile: 9, kind: "airSickle", owner: 1, amount: 12, total: 30, pos: V() }, "absorb:2:airSickle"],
      [{ type: "ward", unit: 2, phase: "down", absorbed: 30 }, "ward:2:down"],
      [{ type: "tow", target: 1, source: 2, phase: "start", pos: V(), to: V() }, "tow:2:1:start"],
      [{ type: "heal", target: 2, source: 2, amount: 3, pos: V() }, "heal:2:2"],
      [{ type: "reaction", kind: "fireTornado", owner: 1, zone: 7, pos: V() }, "reaction:1:fireTornado"],
      [{ type: "dash", unit: 1, ability: "swoop", phase: "start", pos: V(), dir: V(1, 0, 0) }, "dash:1:swoop:start"],
      [{ type: "dash", unit: 1, ability: "jetDash", phase: "end", pos: V(), dir: V(1, 0, 0) }, "dash:1:jetDash:end"],
    ];
    for (const [ev, key] of evs) expect(eventKey(ev)).toBe(key);
  });
});
