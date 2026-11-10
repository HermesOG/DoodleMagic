import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lagDecision,
  lagFromQuery,
  normalizeData,
  openHostLink,
  openJoinLink,
  type Conn,
  type HostLinkHandlers,
  type JoinFailure,
  type JoinHandlers,
} from "./link";

// Настоящий PeerJS здесь не нужен: подменяем модуль теста связи, а сетевые объекты заменяем простыми двойниками.
const p2p = vi.hoisted(() => ({
  openPeer: vi.fn(),
  keepSignalling: vi.fn(),
  CONN_OPTIONS: { serialization: "raw", reliable: false },
}));
vi.mock("../nettest/p2p", () => p2p);

/** Подряд идущие значения rand: последнее повторяется. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

describe("lagFromQuery", () => {
  it("reads lag and loss, with or without the leading question mark", () => {
    expect(lagFromQuery("?lag=120&loss=2")).toEqual({ lagMs: 120, lossPct: 2 });
    expect(lagFromQuery("lag=120&loss=2")).toEqual({ lagMs: 120, lossPct: 2 });
  });

  it("takes zero for the missing one", () => {
    expect(lagFromQuery("?lag=80")).toEqual({ lagMs: 80, lossPct: 0 });
    expect(lagFromQuery("?loss=5")).toEqual({ lagMs: 0, lossPct: 5 });
  });

  it("returns null when neither is given", () => {
    expect(lagFromQuery("")).toBeNull();
    expect(lagFromQuery("?")).toBeNull();
    expect(lagFromQuery("?room=ABCD")).toBeNull();
  });

  it("ignores garbage and empty values", () => {
    expect(lagFromQuery("?lag=abc&loss=xyz")).toBeNull();
    expect(lagFromQuery("?lag=&loss=")).toBeNull();
    expect(lagFromQuery("?lag=abc&loss=5")).toEqual({ lagMs: 0, lossPct: 5 });
    expect(lagFromQuery("?lag=100&loss=NaN")).toEqual({ lagMs: 100, lossPct: 0 });
  });

  it("clamps lag to 0…1000 and loss to 0…50", () => {
    expect(lagFromQuery("?lag=5000&loss=99")).toEqual({ lagMs: 1000, lossPct: 50 });
    expect(lagFromQuery("?lag=-20&loss=-1")).toEqual({ lagMs: 0, lossPct: 0 });
    expect(lagFromQuery("?lag=1000&loss=50")).toEqual({ lagMs: 1000, lossPct: 50 });
  });

  it("keeps fractions", () => {
    expect(lagFromQuery("?lag=33.5&loss=0.5")).toEqual({ lagMs: 33.5, lossPct: 0.5 });
  });
});

describe("lagDecision", () => {
  it("calls rand twice: loss first, jitter second", () => {
    const rand = vi.fn(seq(0.1, 0.9));
    lagDecision({ lagMs: 100, lossPct: 0 }, rand);
    expect(rand).toHaveBeenCalledTimes(2);
  });

  it("never drops without loss", () => {
    expect(lagDecision({ lagMs: 100, lossPct: 0 }, seq(0, 0)).drop).toBe(false);
    expect(lagDecision({ lagMs: 100, lossPct: 0 }, seq(0.999999, 0)).drop).toBe(false);
  });

  it("drops strictly below the loss threshold", () => {
    const o = { lagMs: 100, lossPct: 50 };
    expect(lagDecision(o, seq(0, 0.5)).drop).toBe(true);
    expect(lagDecision(o, seq(0.4999, 0.5)).drop).toBe(true);
    expect(lagDecision(o, seq(0.5, 0.5)).drop).toBe(false);
    expect(lagDecision(o, seq(0.9, 0.5)).drop).toBe(false);
  });

  it("delays by half the lag times 0.9…1.1", () => {
    const o = { lagMs: 100, lossPct: 0 };
    expect(lagDecision(o, seq(0.5, 0)).delayMs).toBeCloseTo(45, 9);
    expect(lagDecision(o, seq(0.5, 0.5)).delayMs).toBeCloseTo(50, 9);
    expect(lagDecision(o, seq(0.5, 1)).delayMs).toBeCloseTo(55, 9);
  });

  it("keeps the delay within ±10% of lag/2 for any rand", () => {
    const o = { lagMs: 240, lossPct: 10 };
    let x = 12345;
    const rand = () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
    for (let i = 0; i < 500; i++) {
      const { delayMs } = lagDecision(o, rand);
      expect(delayMs).toBeGreaterThanOrEqual(108);
      expect(delayMs).toBeLessThan(132);
    }
  });

  it("has no delay without lag", () => {
    expect(lagDecision({ lagMs: 0, lossPct: 3 }, seq(0.9, 0.9)).delayMs).toBe(0);
  });
});

describe("normalizeData", () => {
  const collect = (raw: unknown): Array<string | ArrayBuffer> => {
    const out: Array<string | ArrayBuffer> = [];
    normalizeData(raw, (d) => out.push(d));
    return out;
  };

  it("passes strings and ArrayBuffers as they are", () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    expect(collect("hello")).toEqual(["hello"]);
    const [got] = collect(buf);
    expect(got).toBe(buf);
  });

  it("copies the bytes of a typed array view into a new ArrayBuffer", () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9]);
    const [got] = collect(backing.subarray(1, 4));
    expect(got).toBeInstanceOf(ArrayBuffer);
    expect(got).not.toBe(backing.buffer);
    expect([...new Uint8Array(got as ArrayBuffer)]).toEqual([1, 2, 3]);
    backing[1] = 77;
    expect([...new Uint8Array(got as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it("copies a DataView too", () => {
    const view = new DataView(new Uint8Array([5, 6, 7, 8]).buffer, 1, 2);
    const [got] = collect(view);
    expect([...new Uint8Array(got as ArrayBuffer)]).toEqual([6, 7]);
  });

  it("reads a Blob and delivers afterwards", async () => {
    const out: Array<string | ArrayBuffer> = [];
    const done = new Promise<void>((resolve) =>
      normalizeData(new Blob([new Uint8Array([4, 5])]), (d) => {
        out.push(d);
        resolve();
      }),
    );
    expect(out).toHaveLength(0);
    await done;
    expect([...new Uint8Array(out[0] as ArrayBuffer)]).toEqual([4, 5]);
  });

  it("drops everything else", () => {
    expect(collect(42)).toEqual([]);
    expect(collect({ a: 1 })).toEqual([]);
    expect(collect(null)).toEqual([]);
    expect(collect(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------- двойники PeerJS

type Fn = (...args: unknown[]) => void;

class Emitter {
  private readonly handlers = new Map<string, Fn[]>();
  on(event: string, fn: Fn): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
}

/** Как DataConnection PeerJS: close() шлёт "close" только открытому каналу. */
class FakeDc extends Emitter {
  open = false;
  readonly sent: unknown[] = [];
  closeCalls = 0;
  constructor(readonly connectionId: string) {
    super();
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.closeCalls++;
    if (this.open) {
      this.open = false;
      this.emit("close");
    }
  }
  /** Канал открылся. */
  opens(): void {
    this.open = true;
    this.emit("open");
  }
}

/** Как Peer: destroy() закрывает все каналы; connect() отдаёт заранее заготовленные результаты. */
class FakePeer extends Emitter {
  destroyed = false;
  readonly dcs: FakeDc[] = [];
  readonly connects: Array<{ id: string; options: unknown }> = [];
  connectResults: Array<FakeDc | undefined> = [];
  destroy(): void {
    this.destroyed = true;
    for (const dc of this.dcs) dc.close();
  }
  connect(id: string, options: unknown): FakeDc | undefined {
    this.connects.push({ id, options });
    const dc = this.connectResults.shift();
    if (dc) this.dcs.push(dc);
    return dc;
  }
  /** К хосту пришёл игрок. */
  incoming(dc: FakeDc): void {
    this.dcs.push(dc);
    this.emit("connection", dc);
  }
}

const peerError = (type: string): Error & { type: string } => Object.assign(new Error(type), { type });

describe("openHostLink", () => {
  let peer: FakePeer;
  let events: string[];
  let conns: Conn[];
  let received: Array<string | ArrayBuffer>;
  let handlers: HostLinkHandlers;

  beforeEach(() => {
    peer = new FakePeer();
    p2p.openPeer.mockReset();
    p2p.openPeer.mockResolvedValue(peer);
    p2p.keepSignalling.mockReset();
    events = [];
    conns = [];
    received = [];
    handlers = {
      onConn: (c) => {
        conns.push(c);
        events.push(`conn:${c.id}`);
      },
      onData: (c, d) => {
        received.push(d);
        events.push(`data:${c.id}`);
      },
      onClose: (c) => events.push(`close:${c.id}`),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens the room under the game peer id and keeps the signalling alive", async () => {
    await openHostLink("ABCD", handlers);
    expect(p2p.openPeer).toHaveBeenCalledWith("doodlemagic-g4-abcd-host");
    expect(p2p.keepSignalling).toHaveBeenCalledWith(peer);
  });

  it("rejects with the PeerJS error when the id is taken", async () => {
    p2p.openPeer.mockRejectedValue(peerError("unavailable-id"));
    await expect(openHostLink("ABCD", handlers)).rejects.toMatchObject({ type: "unavailable-id" });
  });

  it("announces a connection only when its channel opens", async () => {
    await openHostLink("ABCD", handlers);
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    expect(events).toEqual([]);
    dc.opens();
    dc.opens();
    expect(events).toEqual(["conn:dc_1"]);
    expect(conns[0]?.id).toBe("dc_1");
    expect(conns[0]?.open).toBe(true);
  });

  it("delivers data from announced connections only, normalized", async () => {
    await openHostLink("ABCD", handlers);
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.emit("data", "too early");
    dc.opens();
    dc.emit("data", '{"t":"input"}');
    dc.emit("data", new Uint8Array([1, 2]));
    dc.emit("data", 123);
    expect(received).toHaveLength(2);
    expect(received[0]).toBe('{"t":"input"}');
    expect([...new Uint8Array(received[1] as ArrayBuffer)]).toEqual([1, 2]);
  });

  it("reports a close exactly once, whether it comes from close or error", async () => {
    await openHostLink("ABCD", handlers);
    const a = new FakeDc("dc_a");
    const b = new FakeDc("dc_b");
    peer.incoming(a);
    peer.incoming(b);
    a.opens();
    b.opens();
    a.emit("close");
    a.emit("error", peerError("negotiation-failed"));
    a.emit("close");
    b.emit("error", peerError("negotiation-failed"));
    b.emit("close");
    expect(events.filter((e) => e.startsWith("close:"))).toEqual(["close:dc_a", "close:dc_b"]);
    expect(conns[0]?.open).toBe(false);
  });

  it("closes the channel itself after an error and stops delivering data", async () => {
    await openHostLink("ABCD", handlers);
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.opens();
    dc.emit("error", peerError("negotiation-failed"));
    expect(dc.closeCalls).toBeGreaterThan(0);
    dc.emit("data", "late");
    expect(received).toEqual([]);
  });

  it("stays silent about a channel that never opened", async () => {
    await openHostLink("ABCD", handlers);
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.emit("error", peerError("negotiation-failed"));
    dc.emit("close");
    expect(events).toEqual([]);
  });

  it("sends over an open channel and stays silent on a closed one", async () => {
    await openHostLink("ABCD", handlers);
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.opens();
    const c = conns[0]!;
    c.send("hi");
    c.send(new Uint8Array([7]));
    expect(dc.sent).toEqual(["hi", new Uint8Array([7])]);
    dc.close();
    expect(() => c.send("after close")).not.toThrow();
    expect(dc.sent).toHaveLength(2);
  });

  it("Conn.close closes the channel and reports the close", async () => {
    await openHostLink("ABCD", handlers);
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.opens();
    conns[0]!.close();
    expect(events).toEqual(["conn:dc_1", "close:dc_1"]);
  });

  it("delays every send under lag, and re-checks the channel when the timer fires", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await openHostLink("ABCD", handlers, { lagMs: 100, lossPct: 0 });
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.opens();
    const c = conns[0]!;
    c.send("one");
    c.send("two");
    expect(dc.sent).toEqual([]);
    vi.advanceTimersByTime(49);
    expect(dc.sent).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(dc.sent).toEqual(["one", "two"]);
    c.send("three");
    dc.close();
    vi.advanceTimersByTime(100);
    expect(dc.sent).toEqual(["one", "two"]);
  });

  it("copies a delayed binary payload so a reused buffer cannot change it", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await openHostLink("ABCD", handlers, { lagMs: 100, lossPct: 0 });
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.opens();
    const scratch = new Uint8Array([1, 2, 3]);
    conns[0]!.send(scratch);
    scratch.fill(0);
    vi.advanceTimersByTime(100);
    expect(dc.sent).toEqual([new Uint8Array([1, 2, 3])]);
  });

  it("drops a binary send when the loss roll hits, but never a text one", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    await openHostLink("ABCD", handlers, { lagMs: 0, lossPct: 50 });
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.opens();
    conns[0]!.send(new Uint8Array([1, 2, 3]));
    conns[0]!.send("kept");
    vi.advanceTimersByTime(1000);
    expect(dc.sent).toEqual(["kept"]);
  });

  it("sends at once under zero lag without loss", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    await openHostLink("ABCD", handlers, { lagMs: 0, lossPct: 5 });
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.opens();
    conns[0]!.send("now");
    expect(dc.sent).toEqual(["now"]);
  });

  it("close() destroys the peer and silences the handlers", async () => {
    const link = await openHostLink("ABCD", handlers);
    const dc = new FakeDc("dc_1");
    peer.incoming(dc);
    dc.opens();
    link.close();
    link.close();
    expect(peer.destroyed).toBe(true);
    expect(events).toEqual(["conn:dc_1"]);
    // игрок, пришедший в гонке с закрытием, отвергается
    const late = new FakeDc("dc_2");
    peer.incoming(late);
    late.opens();
    expect(events).toEqual(["conn:dc_1"]);
  });
});

describe("openJoinLink", () => {
  let peer: FakePeer;
  let events: string[];
  let received: Array<string | ArrayBuffer>;
  let handlers: JoinHandlers;

  beforeEach(() => {
    vi.useFakeTimers();
    peer = new FakePeer();
    p2p.openPeer.mockReset();
    p2p.openPeer.mockResolvedValue(peer);
    p2p.keepSignalling.mockReset();
    events = [];
    received = [];
    handlers = {
      onOpen: () => events.push("open"),
      onData: (d) => received.push(d),
      onClose: () => events.push("close"),
      onFail: (reason: JoinFailure) => events.push(`fail:${reason}`),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Игрок подключился, канал создан и ещё не открыт. */
  async function join(lag?: { lagMs: number; lossPct: number }) {
    const dc = new FakeDc("dc_1");
    peer.connectResults = [dc];
    const link = await openJoinLink("ABCD", handlers, lag);
    return { dc, link };
  }

  it("connects to the host id with the shared connection options", async () => {
    await join();
    expect(p2p.openPeer).toHaveBeenCalledWith(null);
    expect(p2p.keepSignalling).toHaveBeenCalledWith(peer);
    expect(peer.connects).toEqual([{ id: "doodlemagic-g4-abcd-host", options: p2p.CONN_OPTIONS }]);
  });

  it("rejects when the signalling is unavailable", async () => {
    p2p.openPeer.mockRejectedValue(peerError("timeout"));
    await expect(openJoinLink("ABCD", handlers)).rejects.toMatchObject({ type: "timeout" });
  });

  it("reports onOpen once and then delivers data", async () => {
    const { dc } = await join();
    dc.emit("data", "before open");
    dc.opens();
    dc.opens();
    dc.emit("data", '{"t":"snap"}');
    dc.emit("data", new Uint8Array([9]));
    expect(events).toEqual(["open"]);
    expect(received).toHaveLength(2);
    expect(received[0]).toBe('{"t":"snap"}');
    expect([...new Uint8Array(received[1] as ArrayBuffer)]).toEqual([9]);
  });

  it("does not fail after opening, even when the 15 s deadline passes", async () => {
    const { dc } = await join();
    dc.opens();
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(["open"]);
    expect(peer.destroyed).toBe(false);
  });

  it("reports a close of an open channel once and destroys the peer", async () => {
    const { dc } = await join();
    dc.opens();
    dc.emit("close");
    dc.emit("error", peerError("connection-closed"));
    dc.emit("close");
    expect(events).toEqual(["open", "close"]);
    expect(peer.destroyed).toBe(true);
  });

  it("treats an error of an open channel as a close", async () => {
    const { dc } = await join();
    dc.opens();
    dc.emit("error", peerError("negotiation-failed"));
    expect(events).toEqual(["open", "close"]);
    expect(peer.destroyed).toBe(true);
  });

  it("fails with noHost on peer-unavailable before opening, once", async () => {
    await join();
    peer.emit("error", peerError("peer-unavailable"));
    peer.emit("error", peerError("peer-unavailable"));
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(["fail:noHost"]);
    expect(peer.destroyed).toBe(true);
  });

  it("ignores other peer errors and a peer-unavailable after opening", async () => {
    const { dc } = await join();
    peer.emit("error", peerError("disconnected"));
    peer.emit("error", peerError("network"));
    expect(events).toEqual([]);
    dc.opens();
    peer.emit("error", peerError("peer-unavailable"));
    expect(events).toEqual(["open"]);
    expect(peer.destroyed).toBe(false);
  });

  it("fails with noChannel when the channel does not open within 15 s", async () => {
    await join();
    vi.advanceTimersByTime(14_999);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(events).toEqual(["fail:noChannel"]);
    expect(peer.destroyed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(["fail:noChannel"]);
  });

  it("fails with noChannel at once when the channel errors before opening", async () => {
    const { dc } = await join();
    dc.emit("error", peerError("negotiation-failed"));
    dc.emit("close");
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(["fail:noChannel"]);
    expect(peer.destroyed).toBe(true);
  });

  it("retries every second while connect returns undefined, within the deadline", async () => {
    const dc = new FakeDc("dc_1");
    peer.connectResults = [undefined, undefined, dc];
    await openJoinLink("ABCD", handlers);
    expect(peer.connects).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(peer.connects).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(peer.connects).toHaveLength(3);
    dc.opens();
    expect(events).toEqual(["open"]);
    vi.advanceTimersByTime(60_000);
    expect(peer.connects).toHaveLength(3);
  });

  it("stops retrying at the deadline and reports noChannel", async () => {
    peer.connectResults = [];
    await openJoinLink("ABCD", handlers);
    vi.advanceTimersByTime(15_001);
    expect(events).toEqual(["fail:noChannel"]);
    const connects = peer.connects.length;
    vi.advanceTimersByTime(10_000);
    expect(peer.connects).toHaveLength(connects);
  });

  it("sends only over an open channel", async () => {
    const { dc, link } = await join();
    link.send("too early");
    dc.opens();
    link.send("hello");
    link.send(new Uint8Array([1]));
    dc.close();
    link.send("after close");
    expect(dc.sent).toEqual(["hello", new Uint8Array([1])]);
  });

  it("delays and drops sends under lag", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { dc, link } = await join({ lagMs: 200, lossPct: 50 });
    dc.opens();
    // 0.5 · 100 = 50 — не ниже порога потери 50 %, значит отправка идёт, с задержкой 100 мс
    link.send("kept");
    expect(dc.sent).toEqual([]);
    vi.advanceTimersByTime(101);
    expect(dc.sent).toEqual(["kept"]);
    random.mockReturnValue(0.2);
    link.send(new Uint8Array([7]));
    vi.advanceTimersByTime(1000);
    expect(dc.sent).toEqual(["kept"]);
    // текст под тем же броском не теряется, только задерживается
    link.send("late");
    vi.advanceTimersByTime(1000);
    expect(dc.sent).toEqual(["kept", "late"]);
  });

  it("close() destroys the peer and silences the handlers", async () => {
    const { dc, link } = await join();
    dc.opens();
    link.close();
    link.close();
    expect(peer.destroyed).toBe(true);
    dc.emit("data", "late");
    expect(events).toEqual(["open"]);
    expect(received).toEqual([]);
    link.send("nothing");
    expect(dc.sent).toEqual([]);
  });

  it("close() before opening cancels the deadline", async () => {
    const { link } = await join();
    link.close();
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual([]);
    expect(peer.destroyed).toBe(true);
  });
});
