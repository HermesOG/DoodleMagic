import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTicker } from "./ticker";

describe("startTicker without Worker (setInterval fallback)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pulses on the given interval", () => {
    expect(typeof Worker).toBe("undefined");
    const pulse = vi.fn();
    const stop = startTicker(pulse, 10);
    expect(pulse).not.toHaveBeenCalled();
    vi.advanceTimersByTime(35);
    expect(pulse).toHaveBeenCalledTimes(3);
    stop();
  });

  it("defaults to 4 ms", () => {
    const pulse = vi.fn();
    const stop = startTicker(pulse);
    vi.advanceTimersByTime(40);
    expect(pulse).toHaveBeenCalledTimes(10);
    stop();
  });

  it("falls back to the default for a nonsense interval", () => {
    const pulse = vi.fn();
    const stop = startTicker(pulse, Number.NaN);
    vi.advanceTimersByTime(8);
    expect(pulse).toHaveBeenCalledTimes(2);
    stop();
    const zero = vi.fn();
    const stopZero = startTicker(zero, 0);
    vi.advanceTimersByTime(8);
    expect(zero).toHaveBeenCalledTimes(2);
    stopZero();
  });

  it("stops pulsing after stop(), and stop() twice is harmless", () => {
    const pulse = vi.fn();
    const stop = startTicker(pulse, 10);
    vi.advanceTimersByTime(20);
    expect(pulse).toHaveBeenCalledTimes(2);
    stop();
    stop();
    vi.advanceTimersByTime(1000);
    expect(pulse).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** Worker-двойник: помнит сообщения и позволяет «прислать» пульс или ошибку. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static failConstruct = false;
  onmessage: (() => void) | null = null;
  onerror: ((e: { preventDefault(): void }) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;
  constructor(readonly url: string) {
    if (FakeWorker.failConstruct) throw new Error("worker blocked");
    FakeWorker.instances.push(this);
  }
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe("startTicker with a Worker", () => {
  let created: Blob[];
  let revoked: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    FakeWorker.failConstruct = false;
    created = [];
    revoked = [];
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return `blob:fake-${created.length}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.push(url);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts the worker from a Blob and hands it the interval", async () => {
    const stop = startTicker(vi.fn(), 7);
    const worker = FakeWorker.instances[0]!;
    expect(worker.url).toBe("blob:fake-1");
    expect(worker.posted).toEqual([7]);
    const source = await created[0]!.text();
    expect(source).toContain("setInterval");
    expect(source).toContain("postMessage");
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("pulses on worker messages, not on its own timers", () => {
    const pulse = vi.fn();
    const stop = startTicker(pulse, 4);
    const worker = FakeWorker.instances[0]!;
    vi.advanceTimersByTime(1000);
    expect(pulse).not.toHaveBeenCalled();
    worker.onmessage?.();
    worker.onmessage?.();
    expect(pulse).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stop() terminates the worker, revokes the URL and ignores late messages", () => {
    const pulse = vi.fn();
    const stop = startTicker(pulse, 4);
    const worker = FakeWorker.instances[0]!;
    stop();
    stop();
    expect(worker.terminated).toBe(true);
    expect(revoked).toEqual(["blob:fake-1"]);
    worker.onmessage?.();
    expect(pulse).not.toHaveBeenCalled();
  });

  it("falls back to setInterval when the Worker constructor throws, and revokes the URL", () => {
    FakeWorker.failConstruct = true;
    const pulse = vi.fn();
    const stop = startTicker(pulse, 10);
    expect(revoked).toEqual(["blob:fake-1"]);
    vi.advanceTimersByTime(30);
    expect(pulse).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(100);
    expect(pulse).toHaveBeenCalledTimes(3);
  });

  it("falls back to setInterval when the worker reports an error (blocked by CSP)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pulse = vi.fn();
    const stop = startTicker(pulse, 10);
    const worker = FakeWorker.instances[0]!;
    const preventDefault = vi.fn();
    worker.onerror?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
    expect(revoked).toEqual(["blob:fake-1"]);
    vi.advanceTimersByTime(30);
    expect(pulse).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(100);
    expect(pulse).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start the fallback timer when the error comes after stop()", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stop = startTicker(vi.fn(), 10);
    const worker = FakeWorker.instances[0]!;
    stop();
    worker.onerror?.({ preventDefault: () => undefined });
    expect(vi.getTimerCount()).toBe(0);
  });
});
