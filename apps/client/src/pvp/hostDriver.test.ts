import { PVP, unitById, type MatchEvent, type MatchInput } from "@doodlemagic/sim";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conn, HostLinkHandlers } from "../net/link";
import { NET_VERSION, inputText, joinText, packInput, pingText } from "../net/protocol";
import { input, testPvpContext } from "../net/testArena";
import { startHost, type HostDriver } from "./hostDriver";

// Без PeerJS и Worker: связь, пульс и кодек — двойники. Часы — свои.
const h = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  stop: vi.fn(),
  pulse: null as null | (() => void),
}));
vi.mock("../net/link", () => ({ openHostLink: h.open }));
vi.mock("../net/ticker", () => ({
  startTicker: (fn: () => void) => {
    h.pulse = fn;
    return h.stop;
  },
}));
vi.mock("../net/codec", () => ({ encodeBinary: async (v: unknown) => ({ encoded: v }) }));

const TICK_MS = 1000 / 60;
let now = 0;
let handlers: HostLinkHandlers;

/** Пульс таймера через ms после прошлого. */
function pulse(ms: number): void {
  now += ms;
  h.pulse!();
}
/** n тиков пульсами по 10 (больше за пульс хост не делает). */
function ticks(n: number): void {
  for (let left = n; left > 0; left -= 10) pulse(Math.min(10, left) * TICK_MS);
}
const flush = () => new Promise((r) => setTimeout(r, 0));

interface FakeConn extends Conn {
  sent: (string | Uint8Array)[];
}
function conn(id: string): FakeConn {
  const sent: (string | Uint8Array)[] = [];
  return { id, open: true, sent, send: (d) => void sent.push(d), close: vi.fn() };
}
const texts = (c: FakeConn) => c.sent.filter((d): d is string => typeof d === "string").map((d) => JSON.parse(d) as Record<string, unknown>);

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  h.open.mockReset();
  h.open.mockImplementation(async (_code: string, hs: HostLinkHandlers) => {
    handlers = hs;
    return { close: h.close };
  });
  h.close.mockReset();
  h.stop.mockReset();
  h.pulse = null;
});
afterEach(() => vi.restoreAllMocks());

const start = (onRoster = vi.fn()) => startHost({ ctx: testPvpContext(), lag: null, onRoster });

/** Хост вошёл и вид смонтирован (нулевой кадр). sample — ввод хоста. */
function mounted(d: HostDriver, sample: () => MatchInput = () => input()): void {
  d.enter("Хост", "fire");
  d.advance(0, sample);
}

describe("startHost: room code", () => {
  it("takes a new code when the PeerJS ID is taken", async () => {
    h.open.mockRejectedValueOnce(Object.assign(new Error("taken"), { type: "unavailable-id" }));
    const d = await start();
    expect(h.open).toHaveBeenCalledTimes(2);
    expect(d.roomCode).toBe(h.open.mock.calls[1]![0]);
    expect(d.isHost).toBe(true);
  });

  it("gives up after five taken codes, and at once on any other error", async () => {
    h.open.mockRejectedValue(Object.assign(new Error("taken"), { type: "unavailable-id" }));
    await expect(start()).rejects.toThrow("taken");
    expect(h.open).toHaveBeenCalledTimes(5);
    h.open.mockReset();
    h.open.mockRejectedValue(Object.assign(new Error("down"), { type: "server-error" }));
    await expect(start()).rejects.toThrow("down");
    expect(h.open).toHaveBeenCalledTimes(1);
  });
});

describe("startHost: players", () => {
  it("welcomes a player with his id and the room code", async () => {
    const onRoster = vi.fn();
    const d = await start(onRoster);
    const c = conn("c1");
    handlers.onData(c, joinText("Гость", "earth"));
    const [welcome] = texts(c);
    expect(welcome).toEqual({ t: "welcome", v: NET_VERSION, id: expect.any(Number), room: d.roomCode });
    expect(d.names().get(welcome!.id as number)).toBe("Гость");
    expect(onRoster).toHaveBeenCalledTimes(1);
  });

  it("denies another version and a full room, keeping a place for the host until he enters", async () => {
    const d = await start();
    const old = conn("old");
    handlers.onData(old, JSON.stringify({ t: "join", v: NET_VERSION + 1, name: "Старый", element: "fire" }));
    expect(texts(old)).toEqual([{ t: "deny", reason: "version" }]);
    for (let k = 0; k < PVP.maxPlayers - 1; k++) handlers.onData(conn(`p${k}`), joinText(`Гость ${k}`, "fire"));
    const late = conn("late");
    handlers.onData(late, joinText("Опоздал", "fire"));
    expect(texts(late)).toEqual([{ t: "deny", reason: "full" }]);
    d.enter("Хост", "fire");
    expect(d.names().size).toBe(PVP.maxPlayers);
  });

  it("answers ping with pong and keeps the player's ping; ignores everything from those who did not join", async () => {
    const d = await start();
    const stranger = conn("x");
    handlers.onData(stranger, pingText(5, 40));
    handlers.onData(stranger, inputText([packInput(1, input({ moveX: 1 }))]));
    handlers.onData(stranger, new ArrayBuffer(8));
    expect(stranger.sent).toEqual([]);
    const c = conn("c1");
    handlers.onData(c, joinText("Гость", "fire"));
    const id = texts(c)[0]!.id as number;
    handlers.onData(c, pingText(123, 44.6));
    expect(texts(c)[1]).toEqual({ t: "pong", ct: 123 });
    expect(d.pings().get(id)).toBe(45);
  });

  it("removes the mage of a closed channel", async () => {
    const onRoster = vi.fn();
    const d = await start(onRoster);
    const c = conn("c1");
    handlers.onData(c, joinText("Гость", "fire"));
    const id = texts(c)[0]!.id as number;
    handlers.onClose(c);
    expect(d.names().has(id)).toBe(false);
    expect(unitById(d.game().match, id)).toBeUndefined();
    expect(onRoster).toHaveBeenCalledTimes(2);
  });

  it("sends each snapshot, encoded once, to the joined players only", async () => {
    await start();
    const joined = conn("in");
    const lurker = conn("out");
    handlers.onConn(lurker);
    handlers.onData(joined, joinText("Гость", "fire"));
    ticks(3);
    await flush();
    const bins = joined.sent.filter((d) => typeof d !== "string");
    expect(bins).toHaveLength(1);
    expect((bins[0] as unknown as { encoded: { tick: number } }).encoded.tick).toBe(3);
    expect(lurker.sent).toEqual([]);
  });
});

describe("startHost: ticks and frames", () => {
  it("ticks by the clock from the timer, not more than 10 per pulse, and only after «Войти» uses the host's input", async () => {
    const d = await start();
    const sample = vi.fn(() => input());
    pulse(3 * TICK_MS);
    expect(d.game().match.tick).toBe(3);
    pulse(1000);
    expect(d.game().match.tick).toBe(13);
    mounted(d, sample);
    expect(sample).not.toHaveBeenCalled();
    pulse(2 * TICK_MS);
    expect(sample).toHaveBeenCalledTimes(2);
  });

  it("keeps ticks of the mount frame for the first real frame; prev and cur are the last two states", async () => {
    const d = await start();
    d.enter("Хост", "fire");
    ticks(2);
    const mount = d.advance(0, () => input());
    expect(mount.ticks).toEqual([]);
    ticks(3);
    const f = d.advance(0.05, () => input());
    expect(f.ticks.map((t) => t.state.tick)).toEqual([1, 2, 3, 4, 5]);
    expect(f.cur).toBe(d.game().match);
    expect(f.prev.tick).toBe(4);
    expect(d.advance(0.016, () => input()).ticks).toEqual([]);
  });

  it("alpha is the time since the last tick boundary, in ticks", async () => {
    const d = await start();
    mounted(d);
    pulse(2.5 * TICK_MS);
    now += 0.25 * TICK_MS;
    expect(d.advance(0.016, () => input()).alpha).toBeCloseTo(0.75, 6);
  });

  it("after the host's own respawn the ticks face the spawn until a frame shows the respawn", async () => {
    const d = await start();
    const look = 1.234;
    const sample = () => input({ yaw: look });
    mounted(d, sample);
    d.start();
    // бой начнётся на тике 180 — посреди пульса 176…185
    ticks(5);
    d.advance(0.08, sample);
    const frames: { yaw: number; respawn: MatchEvent | undefined }[][] = [];
    for (let k = 0; k < 20; k++) {
      ticks(10);
      frames.push(
        d.advance(0.16, sample).ticks.map((t) => ({
          yaw: unitById(t.state, d.localId)!.move.yaw,
          respawn: t.events.find((e) => e.type === "respawn" && e.target === d.localId),
        })),
      );
    }
    const k = frames.findIndex((f) => f.some((t) => t.respawn));
    const frame = frames[k]!;
    const at = frame.findIndex((t) => t.respawn);
    const ev = frame[at]!.respawn as Extract<MatchEvent, { type: "respawn" }>;
    expect(ev.yaw).not.toBeCloseTo(look, 3);
    // тики после возрождения в том же пульсе — со взглядом точки, после кадра — снова с взглядом вида
    const after = frame.slice(at + 1);
    expect(after.length).toBeGreaterThan(0);
    for (const t of after) expect(t.yaw).toBeCloseTo(ev.yaw, 9);
    for (const t of frames[k + 1]!) expect(t.yaw).toBeCloseTo(look, 9);
  });

  it("without frames keeps only the last 30 ticks, and the host's dropped respawn comes as late", async () => {
    const d = await start();
    mounted(d);
    d.start();
    ticks(PVP.countdownS * 60 + 60);
    const f = d.advance(0.016, () => input());
    expect(f.ticks).toHaveLength(30);
    expect(f.late).toEqual([expect.objectContaining({ type: "respawn", target: d.localId })]);
    expect(f.confirmed.some((e) => e.type === "respawn" && e.target === d.localId)).toBe(true);
    expect(f.prev).not.toBe(f.cur);
  });

  it("the frame right after the host's respawn tick has prev = cur", async () => {
    const d = await start();
    mounted(d);
    d.start();
    ticks(PVP.countdownS * 60);
    const f = d.advance(0.016, () => input());
    expect(f.ticks.at(-1)!.events.some((e) => e.type === "respawn" && e.target === d.localId)).toBe(true);
    expect(f.prev).toBe(f.cur);
  });

  it("changing the element in warmup puts the host's mage on a spawn and returns it; in battle — null", async () => {
    const d = await start();
    mounted(d);
    const spawn = d.chooseElement("earth");
    const me = unitById(d.game().match, d.localId)!;
    expect(me.mage!.element).toBe("earth");
    expect(spawn).toEqual({ pos: me.mage!.spawn.pos, yaw: me.mage!.spawn.yaw });
    const f = d.advance(0.016, () => input());
    expect(f.prev).toBe(f.cur);
    expect(d.chooseElement("earth")).toBeNull();
    d.start();
    ticks(PVP.countdownS * 60 + 1);
    expect(d.game().phase).toBe("live");
    expect(d.chooseElement("fire")).toBeNull();
    expect(unitById(d.game().match, d.localId)!.mage!.element).toBe("earth");
  });

  it("dispose stops the timer and closes the room", async () => {
    const d = await start();
    d.dispose();
    expect(h.stop).toHaveBeenCalled();
    expect(h.close).toHaveBeenCalled();
    expect(d.link()).toBe("closed");
  });
});
