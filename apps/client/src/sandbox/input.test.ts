import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInput, type InputDevice } from "./input";

/** Тесты идут в node: окно и документ — простые EventTarget, события — Event с нужными полями. */
class FakeDocument extends EventTarget {
  pointerLockElement: unknown = null;
}

type LockFn = (options?: { unadjustedMovement?: boolean }) => Promise<void> | undefined;

let doc: FakeDocument;
let win: EventTarget;
let canvas: { requestPointerLock: ReturnType<typeof vi.fn<LockFn>> };
let input: InputDevice;

const key = (type: "keydown" | "keyup", code: string, repeat = false): Event =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat, ctrlKey: false, metaKey: false, altKey: false });

function setLocked(locked: boolean): void {
  doc.pointerLockElement = locked ? canvas : null;
  doc.dispatchEvent(new Event("pointerlockchange"));
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  doc = new FakeDocument();
  win = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  canvas = { requestPointerLock: vi.fn<LockFn>(() => Promise.resolve()) };
  input = createInput(canvas as unknown as HTMLCanvasElement);
});

afterEach(() => {
  input.dispose();
  vi.unstubAllGlobals();
});

describe("keys", () => {
  // W нажата до клика «Играть»: после захвата приходят только повторы, и они должны вести мага
  it("picks up a key that was already held when the lock arrived", () => {
    win.dispatchEvent(key("keydown", "KeyW"));
    expect(input.down.has("KeyW")).toBe(false);
    setLocked(true);
    win.dispatchEvent(key("keydown", "KeyW", true));
    expect(input.down.has("KeyW")).toBe(true);
  });

  it("picks up a held key again after the window lost and regained focus", () => {
    setLocked(true);
    win.dispatchEvent(key("keydown", "KeyD"));
    win.dispatchEvent(new Event("blur"));
    expect(input.down.size).toBe(0);
    win.dispatchEvent(key("keydown", "KeyD", true));
    expect(input.down.has("KeyD")).toBe(true);
    win.dispatchEvent(key("keyup", "KeyD"));
    expect(input.down.has("KeyD")).toBe(false);
  });

  it("fires a toggle once per press, not on auto-repeat", () => {
    const cb = vi.fn();
    input.onPress("Backquote", cb);
    win.dispatchEvent(key("keydown", "Backquote"));
    win.dispatchEvent(key("keydown", "Backquote", true));
    win.dispatchEvent(key("keydown", "Backquote", true));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("mouse", () => {
  const move = (movementX: number, movementY: number) => doc.dispatchEvent(Object.assign(new Event("mousemove"), { movementX, movementY }));

  it("sums movement only while locked and forgets it when the lock changes", () => {
    move(40, 0);
    setLocked(true);
    move(3, -2);
    move(4, 1);
    expect(input.takeMouse()).toEqual({ dx: 7, dy: -1 });
    move(25, 25);
    setLocked(false);
    expect(input.takeMouse()).toEqual({ dx: 0, dy: 0 });
  });
});

describe("pointer lock", () => {
  // unadjustedMovement выключает ускорение ОС: на тачпаде взгляд с ним очень медленный
  it("asks for a plain lock by default", () => {
    input.requestLock(false);
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(canvas.requestPointerLock.mock.calls[0]).toEqual([]);
  });

  it("asks for raw input when it is switched on", async () => {
    input.requestLock(true);
    await flush();
    expect(canvas.requestPointerLock.mock.calls).toEqual([[{ unadjustedMovement: true }]]);
  });

  it("falls back to a plain lock when the browser rejects raw input", async () => {
    canvas.requestPointerLock.mockImplementationOnce(() => Promise.reject(new DOMException("no", "NotSupportedError")));
    input.requestLock(true);
    await flush();
    expect(canvas.requestPointerLock.mock.calls).toEqual([[{ unadjustedMovement: true }], []]);
  });

  it("falls back to a plain lock when the browser throws on the options", () => {
    canvas.requestPointerLock.mockImplementationOnce(() => {
      throw new TypeError("options not supported");
    });
    input.requestLock(true);
    expect(canvas.requestPointerLock.mock.calls).toEqual([[{ unadjustedMovement: true }], []]);
  });

  it("does not throw or leave an unhandled rejection when the plain lock is refused", async () => {
    canvas.requestPointerLock.mockImplementation(() => Promise.reject(new DOMException("too soon", "SecurityError")));
    expect(() => input.requestLock(false)).not.toThrow();
    expect(() => input.requestLock(true)).not.toThrow();
    await flush();
  });

  // Chrome отказывает в захвате около секунды после Esc: меню должно сказать об этом, а не молчать
  it("reports a refused lock", () => {
    const cb = vi.fn();
    input.onLockError(cb);
    doc.dispatchEvent(new Event("pointerlockerror"));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
