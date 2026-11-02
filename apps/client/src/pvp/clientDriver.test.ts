import { clonePlain, unitById, type MatchEvent } from "@doodlemagic/sim";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostCore, type HostCore } from "../net/hostCore";
import type { JoinHandlers } from "../net/link";
import { NET_VERSION, hostText, parseClientMsg } from "../net/protocol";
import type { SnapshotMsg } from "../net/snapshot";
import { input, testPvpContext } from "../net/testArena";
import { connectClient, type ClientOptions, type PvpDriver } from "./clientDriver";

// Без PeerJS: канал — двойник, «двоичный» снапшот — сам объект (decodeBinary его и отдаёт). Хост — настоящее ядро.
const c = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), sent: [] as string[] }));
vi.mock("../net/link", () => ({ openJoinLink: c.open }));
vi.mock("../net/codec", () => ({ decodeBinary: async (x: unknown) => x }));

const ctx = testPvpContext();
const TICK_S = 1 / 60;
let now = 0;
let link: JoinHandlers;

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  c.sent.length = 0;
  c.close.mockReset();
  c.open.mockReset();
  c.open.mockImplementation(async (_code: string, hs: JoinHandlers) => {
    link = hs;
    return { send: (d: string) => void c.sent.push(d), close: c.close };
  });
});
afterEach(() => vi.restoreAllMocks());

const flush = () => new Promise((r) => setTimeout(r, 0));

function connect(over: Partial<ClientOptions> = {}) {
  const o = { code: "ABCD", ctx, lag: null, onStatus: vi.fn(), onError: vi.fn(), onReady: vi.fn(), onClosed: vi.fn(), ...over };
  return { o, session: connectClient(o) };
}

/** Снапшоты ядра хоста за n тиков. */
function snapshots(host: HostCore, n: number): SnapshotMsg[] {
  const out: SnapshotMsg[] = [];
  for (let k = 0; k < n; k++) {
    const r = host.tick(null, now);
    if (r.snapshot) out.push(r.snapshot);
  }
  return out;
}
const deliver = (s: SnapshotMsg) => link.onData(clonePlain(s) as unknown as ArrayBuffer);

/** Игрок вошёл: канал открыт, welcome пришёл, первый снапшот со своим магом — драйвер готов и вид смонтирован. */
async function joined(): Promise<{ host: HostCore; d: PvpDriver; o: ClientOptions; id: number }> {
  const { o, session } = connect();
  await flush();
  link.onOpen();
  session.join("Гость", "fire");
  const host = createHostCore(ctx);
  const r = host.join("p", "Гость", "fire", 0);
  if (!r.ok) throw new Error("full");
  link.onData(hostText({ t: "welcome", v: NET_VERSION, id: r.id, room: "ABCD" }));
  for (const s of snapshots(host, 3)) deliver(s);
  await flush();
  const d = vi.mocked(o.onReady).mock.calls[0]![0];
  d.advance(0, () => input());
  return { host, d, o, id: r.id };
}

describe("connectClient: joining", () => {
  it("connects at once, sends join on «Войти» when the channel is open", async () => {
    const { o, session } = connect();
    expect(o.onStatus).toHaveBeenLastCalledWith("connecting");
    await flush();
    session.join("Гость", "earth");
    expect(c.sent).toEqual([]);
    link.onOpen();
    expect(parseClientMsg(c.sent[0])).toEqual({ t: "join", v: NET_VERSION, name: "Гость", element: "earth" });
    expect(vi.mocked(o.onStatus).mock.calls.map(([s]) => s)).toEqual(["connecting", "open", "joining"]);
    session.join("Гость", "earth");
    expect(c.sent).toHaveLength(1);
  });

  it("reports every failure once", async () => {
    c.open.mockRejectedValueOnce(new Error("no server"));
    const a = connect();
    await flush();
    expect(a.o.onError).toHaveBeenCalledWith("signalling");

    const b = connect();
    await flush();
    link.onFail("noHost");
    expect(b.o.onError).toHaveBeenCalledWith("noHost");

    for (const reason of ["full", "version"] as const) {
      const x = connect();
      await flush();
      link.onOpen();
      link.onData(hostText({ t: "deny", reason }));
      link.onData(hostText({ t: "deny", reason }));
      expect(x.o.onError).toHaveBeenCalledTimes(1);
      expect(x.o.onError).toHaveBeenCalledWith(reason);
      expect(c.close).toHaveBeenCalled();
    }

    const y = connect();
    await flush();
    link.onOpen();
    link.onData(hostText({ t: "welcome", v: NET_VERSION + 1, id: 1, room: "ABCD" }));
    expect(y.o.onError).toHaveBeenCalledWith("version");
  });

  it("is ready on the first snapshot with its own mage", async () => {
    const { d, o, id } = await joined();
    expect(o.onReady).toHaveBeenCalledTimes(1);
    expect(d.localId).toBe(id);
    expect(d.isHost).toBe(false);
    expect(d.roomCode).toBe("ABCD");
    expect(d.names().get(id)).toBe("Гость");
    expect(unitById(d.game().match, id)).toBeDefined();
  });
});

describe("connectClient: frames", () => {
  it("steps the prediction on each tick and sends the input packet", async () => {
    const { d } = await joined();
    c.sent.length = 0;
    const f = d.advance(2 * TICK_S + 1e-6, () => input({ moveX: 1 }));
    expect(f.ticks).toHaveLength(2);
    expect(c.sent.map((t) => parseClientMsg(t)?.t)).toEqual(["in", "in"]);
  });

  it("applies the snapshots of the frame once, in the frame", async () => {
    const { host, d } = await joined();
    const before = d.confirmedGame().match.tick;
    for (const s of snapshots(host, 6)) deliver(s);
    await flush();
    expect(d.confirmedGame().match.tick).toBe(before);
    const f = d.advance(0, () => input());
    expect(d.confirmedGame().match.tick).toBe(before + 6);
    expect(f.ticks).toEqual([]);
  });

  it("turns the look to the spawn when the host put its mage elsewhere after an element change", async () => {
    const { host, d, id } = await joined();
    expect(d.chooseElement("earth")).toBeNull();
    expect(parseClientMsg(c.sent.at(-1))).toEqual({ t: "el", element: "earth" });
    const [s] = snapshots(host, 3);
    const moved = clonePlain(s!);
    const me = moved.game.match.units.find((u) => u.id === id)!;
    me.move.body.pos = { x: 0, y: 0, z: 0 };
    me.mage!.spawn = { pos: { x: 0, y: 0, z: 0 }, yaw: 2 };
    deliver(moved);
    await flush();
    const f = d.advance(0, () => input());
    expect(f.late).toEqual([{ type: "respawn", target: id, pos: { x: 0, y: 0, z: 0 }, yaw: 2 } satisfies MatchEvent]);
    expect(f.prev).toBe(f.cur);
  });

  it("after a late own respawn from the host the ticks of the frame face the spawn", async () => {
    const { host, d, id } = await joined();
    const [s] = snapshots(host, 3);
    const moved = clonePlain(s!);
    const at = { x: 0, y: 0, z: 0 };
    moved.game.match.units.find((u) => u.id === id)!.move.body.pos = { ...at };
    moved.events.push([moved.tick - 1, { type: "respawn", target: id, pos: { ...at }, yaw: 2 }]);
    deliver(moved);
    await flush();
    const f = d.advance(2 * TICK_S + 1e-6, () => input({ yaw: 0.5 }));
    expect(f.late).toEqual([{ type: "respawn", target: id, pos: at, yaw: 2 }]);
    expect(f.ticks.map((t) => unitById(t.state, id)!.move.yaw)).toEqual([2, 2]);
    expect(f.prev).toBe(f.cur);
    expect(unitById(d.advance(TICK_S + 1e-6, () => input({ yaw: 0.5 })).cur, id)!.move.yaw).toBe(0.5);
  });

  it("does not invent a respawn for a jump nobody expected", async () => {
    const { host, d, id } = await joined();
    const [s] = snapshots(host, 3);
    const moved = clonePlain(s!);
    moved.game.match.units.find((u) => u.id === id)!.move.body.pos = { x: 0, y: 0, z: 0 };
    deliver(moved);
    await flush();
    expect(d.advance(0, () => input()).late).toEqual([]);
  });

  it("is stale after 3 s without snapshots and closed when the host leaves", async () => {
    const { host, d, o } = await joined();
    expect(d.link()).toBe("ok");
    now += 3001;
    expect(d.link()).toBe("stale");
    for (const s of snapshots(host, 3)) deliver(s);
    await flush();
    expect(d.link()).toBe("ok");
    link.onClose();
    expect(d.link()).toBe("closed");
    expect(o.onClosed).toHaveBeenCalledTimes(1);
  });

  it("pings every second with the smoothed round trip from pong", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { d } = await joined();
      expect(d.ownPing()).toBe(-1);
      now = 1000;
      link.onData(hostText({ t: "pong", ct: 900 }));
      expect(d.ownPing()).toBe(100);
      now = 1100;
      link.onData(hostText({ t: "pong", ct: 1050 }));
      expect(d.ownPing()).toBe(90);
      c.sent.length = 0;
      vi.advanceTimersByTime(1000);
      expect(c.sent.map((t) => parseClientMsg(t))).toEqual([{ t: "ping", ct: 1100, rtt: 90 }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
