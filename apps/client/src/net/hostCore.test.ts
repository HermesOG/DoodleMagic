import { PVP, type MatchEvent, type MatchInput, type Unit, type UnitId } from "@doodlemagic/sim";
import { describe, expect, it } from "vitest";
import { quantize } from "./codec";
import { LOCAL_PEER, createHostCore, type HostCore } from "./hostCore";
import { NAME_MAX, type SeqInput } from "./protocol";
import { SNAPSHOT_EVERY_TICKS, isSnapshot, type SnapshotMsg } from "./snapshot";
import { TEST_SPAWNS, input, testPvpContext } from "./testArena";

const ctx = testPvpContext();
const MS_PER_TICK = 1000 / 60;
const unit = (h: HostCore, id: UnitId): Unit => h.game.match.units.find((u) => u.id === id)!;
const seqs = (from: number, to: number, over: (seq: number) => Partial<MatchInput>): SeqInput[] =>
  Array.from({ length: to - from + 1 }, (_, k) => ({ seq: from + k, input: input(over(from + k)) }));

/** n тиков хоста подряд: ввод хоста по номеру тика, время — 60 Гц от startMs. */
function run(h: HostCore, n: number, local: (k: number) => MatchInput | null = () => null, startMs = 0) {
  const snaps: SnapshotMsg[] = [];
  const log: [number, MatchEvent][] = [];
  for (let k = 0; k < n; k++) {
    const before = h.game.match.tick;
    const r = h.tick(local(k), startMs + k * MS_PER_TICK);
    for (const e of r.step.events) log.push([before, e]);
    if (r.snapshot) snaps.push(r.snapshot);
  }
  return { snaps, log };
}

describe("hostCore: players", () => {
  it("takes up to PVP.maxPlayers mages, the next one is told the room is full", () => {
    const h = createHostCore(ctx);
    const ids: UnitId[] = [];
    for (let k = 0; k < PVP.maxPlayers; k++) {
      const r = h.join(k === 0 ? LOCAL_PEER : `p${k}`, `Маг${k}`, "fire", 0);
      if (r.ok) ids.push(r.id);
    }
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
    expect(h.join("p7", "Лишний", "earth", 0)).toEqual({ ok: false, reason: "full" });
    expect(h.game.match.units).toHaveLength(6);
    expect(h.idOf("p7")).toBeNull();
  });

  it("a repeated join of the same peer keeps its one mage", () => {
    const h = createHostCore(ctx);
    expect(h.join("p", "Искра", "fire", 0)).toEqual({ ok: true, id: 1 });
    expect(h.join("p", "Искра", "earth", 0)).toEqual({ ok: true, id: 1 });
    expect(h.game.match.units.map((u) => [u.id, u.mage!.element])).toEqual([[1, "fire"]]);
  });

  it("names are unique regardless of case; the stem is cut to fit NAME_MAX with the number", () => {
    const h = createHostCore(ctx);
    const join = (peer: string, name: string) => {
      const r = h.join(peer, name, "fire", 0);
      return r.ok ? h.names().get(r.id) : undefined;
    };
    expect(join(LOCAL_PEER, "Искра")).toBe("Искра");
    expect(join("a", "Искра")).toBe("Искра 2");
    expect(join("b", "искра")).toBe("искра 3");
    const long = "Огненный Повелит"; // ровно NAME_MAX
    expect(Array.from(long)).toHaveLength(NAME_MAX);
    expect(join("c", long)).toBe(long);
    expect(join("d", long.toUpperCase())).toBe("ОГНЕННЫЙ ПОВЕЛ 2");
    expect(join("e", " ​ ")).toBe("Маг"); // пустое после очистки
  });

  it("leave removes the mage and forgets the player; a repeated leave does nothing", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Хост", "fire", 0);
    h.join("p", "Гость", "earth", 0);
    h.leave("p");
    expect(h.game.match.units.map((u) => u.id)).toEqual([1]);
    expect([h.idOf("p"), h.names().has(2), h.pings().has(2)]).toEqual([null, false, false]);
    const g = h.game;
    h.leave("p");
    h.leave("never");
    expect(h.game).toBe(g);
    // вернулся — новый маг с новым id
    expect(h.join("p", "Гость", "earth", 0)).toEqual({ ok: true, id: 3 });
  });

  it("setElement goes through the rules: in warmup the mage changes at once", () => {
    const h = createHostCore(ctx);
    h.join("p", "Гость", "fire", 0);
    h.setElement("p", "earth");
    h.setElement("nobody", "earth");
    expect(unit(h, 1).mage!.element).toBe("earth");
  });

  it("pings: the host is 0, a guest is unknown (−1) until setPing", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Хост", "fire", 0);
    h.join("p", "Гость", "earth", 0);
    expect([...h.pings()]).toEqual([[1, 0], [2, -1]]);
    h.setPing("p", 42);
    h.setPing(LOCAL_PEER, 99);
    expect([...h.pings()]).toEqual([[1, 0], [2, 42]]);
    const s = run(h, 3).snaps[0]!;
    expect(s.roster).toEqual([[1, "Хост", 0], [2, "Гость", 42]]);
  });

  it("start: warmup → countdown; during the fight — false", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Хост", "fire", 0);
    expect(h.start()).toBe(true);
    expect(h.game.phase).toBe("countdown");
    expect(h.start()).toBe(false);
    run(h, PVP.countdownS * 60);
    expect(h.game.phase).toBe("live");
    expect(h.start()).toBe(false);
  });
});

describe("hostCore: ticks and inputs", () => {
  it("a guest's queued input moves its mage; ack follows the applied seq", () => {
    const h = createHostCore(ctx);
    const id = (h.join("p", "Гость", "fire", 0) as { id: UnitId }).id;
    const start = { ...unit(h, id).move.body.pos };
    const acks: number[] = [];
    for (let k = 0; k < 12; k++) {
      h.inputs("p", seqs(k, k, () => ({ moveZ: 1, yaw: TEST_SPAWNS[0]!.yaw })), k * MS_PER_TICK);
      const r = h.tick(null, k * MS_PER_TICK);
      if (r.snapshot) acks.push(r.snapshot.acks.find(([who]) => who === id)![1]);
    }
    expect(unit(h, id).move.body.pos.z).toBeLessThan(start.z - 0.5); // yaw 0 — вперёд по −Z
    expect(acks).toEqual([2, 5, 8, 11]);
  });

  it("inputs from an unknown peer or for the host's own mage are ignored", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Хост", "fire", 0);
    const before = { ...unit(h, 1).move.body.pos };
    h.inputs(LOCAL_PEER, seqs(0, 5, () => ({ moveZ: 1 })), 0);
    h.inputs("ghost", seqs(0, 5, () => ({ moveZ: 1 })), 0);
    run(h, 6);
    expect(unit(h, 1).move.body.pos.z).toBeCloseTo(before.z, 6);
  });

  it("with no input for more than 250 ms the mage stands", () => {
    const h = createHostCore(ctx);
    const id = (h.join("p", "Гость", "fire", 0) as { id: UnitId }).id;
    h.inputs("p", [{ seq: 0, input: input({ moveZ: 1, yaw: 0.3, pitch: -0.2 }) }], 0);
    const zAt: number[] = [];
    let last: SnapshotMsg | null = null;
    for (let k = 0; k < 60; k++) {
      const r = h.tick(null, k * MS_PER_TICK);
      if (r.snapshot) last = r.snapshot;
      zAt.push(unit(h, id).move.body.pos.z);
    }
    // до 250 мс (тик 15) ввод повторяется — маг бежит; потом тормозит и стоит
    expect(zAt[15]!).toBeLessThan(zAt[0]! - 1);
    expect(zAt[59]).toBe(zAt[40]);
    const u = unit(h, id);
    expect(last!.looks).toEqual([[id, 0, 0, u.move.yaw, u.move.pitch]]);
    expect([u.move.yaw, u.move.pitch]).toEqual([0.3, -0.2]);
  });

  it("a snapshot comes on every 3rd tick with all events since the last one, each with its tick", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Хост", "fire", 0);
    h.join("p", "Гость", "fire", 0);
    const { snaps, log } = run(h, 45, (k) => {
      h.inputs("p", seqs(k, k, (s) => ({ primary: s >= 5 && s < 30, q: s === 20, yaw: Math.PI })), k * MS_PER_TICK);
      return input({ primary: k > 2, yaw: 0.1 });
    });
    expect(snaps.map((s) => s.tick)).toEqual(Array.from({ length: 15 }, (_, k) => (k + 1) * SNAPSHOT_EVERY_TICKS));
    expect(log.length).toBeGreaterThan(10);
    expect(log.some(([, e]) => e.type === "cast" && e.unit === 1)).toBe(true);
    expect(log.some(([, e]) => e.type === "cast" && e.unit === 2 && e.slot === "q")).toBe(true);
    expect(snaps.flatMap((s) => s.events)).toEqual(log);
    for (const s of snaps) for (const [t] of s.events) expect(t >= s.tick - SNAPSHOT_EVERY_TICKS && t < s.tick).toBe(true);
  });

  it("acks and looks carry each mage's last applied input; a mage with no input looks where it looks", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Хост", "fire", 0);
    h.join("a", "Первый", "fire", 0);
    h.join("b", "Второй", "earth", 0);
    h.inputs("a", seqs(10, 14, (s) => ({ moveX: 0.5, moveZ: -1, yaw: s / 10, pitch: 0.25 })), 0);
    const s = run(h, 3, () => input({ moveX: -1, moveZ: 0.75, yaw: 2, pitch: -0.5 })).snaps[0]!;
    const b = unit(h, 3);
    expect(s.acks).toEqual([[2, 12], [3, -1]]);
    expect(s.looks).toEqual([
      [1, -1, 0.75, 2, -0.5],
      [2, 0.5, -1, 1.2, 0.25],
      [3, 0, 0, b.move.yaw, b.move.pitch],
    ]);
    expect(b.move.yaw).toBe(TEST_SPAWNS.find((p) => p.pos.x === b.mage!.spawn.pos.x && p.pos.z === b.mage!.spawn.pos.z)!.yaw);
  });

  it("prevGame is the state before the last step", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Хост", "fire", 0);
    const g = h.game;
    h.tick(input({ moveZ: 1 }), 0);
    expect(h.prevGame).toBe(g);
    expect(h.game.match.tick).toBe(g.match.tick + 1);
  });

  it("a snapshot holds no references to the live state and does not change with later ticks", () => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Хост", "fire", 0);
    h.join("p", "Гость", "earth", 0);
    h.inputs("p", seqs(0, 40, (s) => ({ moveZ: 1, primary: s % 7 < 3 })), 0);
    let r = h.tick(input({ primary: true }), 0);
    r = h.tick(input({ primary: true }), MS_PER_TICK);
    r = h.tick(input({ primary: true, moveX: 1 }), 2 * MS_PER_TICK);
    const s = r.snapshot!;
    expect(s).not.toBeNull();
    expect(s.game).toEqual(h.game);
    expect(s.game).not.toBe(h.game);
    expect(s.game.match.units[0]).not.toBe(h.game.match.units[0]);
    expect(s.game.match.units[0]!.move.body.pos).not.toBe(h.game.match.units[0]!.move.body.pos);
    expect(s.events.length).toBeGreaterThan(0);
    const json = JSON.stringify(s);
    run(h, 30, (k) => input({ primary: k % 2 === 0, moveZ: 1, q: k === 4 }), 3 * MS_PER_TICK);
    expect(JSON.stringify(s)).toBe(json);
  });
});

describe("isSnapshot", () => {
  const real = (): SnapshotMsg => {
    const h = createHostCore(ctx);
    h.join(LOCAL_PEER, "Хост", "fire", 0);
    h.join("p", "Гость", "earth", 0);
    return run(h, 3, () => input({ primary: true })).snaps[0]!;
  };

  it("accepts a real snapshot and its quantized copy", () => {
    expect(isSnapshot(real())).toBe(true);
    expect(isSnapshot(JSON.parse(JSON.stringify(quantize(real()))))).toBe(true);
  });

  it("rejects broken shapes", () => {
    const broken: ((s: Record<string, any>) => void)[] = [
      (s) => delete s.tick,
      (s) => (s.tick = 1.5),
      (s) => (s.game.phase = "lobby"),
      (s) => (s.game.match.units = {}),
      (s) => (s.game.match.tick = s.tick + 1),
      (s) => (s.game.match.units[0] = null),
      (s) => (s.acks = [[1]]),
      (s) => (s.looks = [[1, 0, 0, 0, "x"]]),
      (s) => (s.roster = [[1, 2, 3]]),
      (s) => (s.events = [[1, { kind: "cast" }]]),
      (s) => (s.events = null),
    ];
    for (const breakIt of broken) {
      const s = real() as unknown as Record<string, any>;
      breakIt(s);
      expect(isSnapshot(s)).toBe(false);
    }
    for (const x of [null, 1, "s", [], {}]) expect(isSnapshot(x)).toBe(false);
  });
});
