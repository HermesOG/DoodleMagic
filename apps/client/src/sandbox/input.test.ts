import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInput, type InputDevice } from "./input";

/** Тесты идут в node: окно и документ — простые EventTarget, события — Event с нужными полями. */
class FakeDocument extends EventTarget {
  pointerLockElement: unknown = null;
}

type LockFn = (options?: { unadjustedMovement?: boolean }) => Promise<void> | undefined;

let doc: FakeDocument;
let win: EventTarget;
let canvas: EventTarget & { requestPointerLock: ReturnType<typeof vi.fn<LockFn>> };
let input: InputDevice;

const key = (type: "keydown" | "keyup", code: string, repeat = false): Event =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat, ctrlKey: false, metaKey: false, altKey: false });
const button = (type: "mousedown" | "mouseup", which = 0): Event =>
  Object.assign(new Event(type, { cancelable: true }), { button: which, ctrlKey: false, metaKey: false, altKey: false });

/** Кадр страницы: тики читают down, после тиков — ticked() (если тиков не было, его нет). Сколько тиков видели code. */
function frame(ticks: number, code: string): number {
  let seen = 0;
  for (let k = 0; k < ticks; k++) if (input.down.has(code)) seen++;
  if (ticks > 0) input.ticked();
  return seen;
}

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
  canvas = Object.assign(new EventTarget(), { requestPointerLock: vi.fn<LockFn>(() => Promise.resolve()) });
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
    // клавиша зажата: тик успел её увидеть, отпускание гасит её сразу
    expect(frame(1, "KeyD")).toBe(1);
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

// тап по тачпаду Windows шлёт mousedown и mouseup за ~1 мс, в одном кадре: тик должен увидеть нажатие
describe("presses shorter than a tick", () => {
  beforeEach(() => setLocked(true));

  it("gives a same-frame LMB down and up to exactly one tick", () => {
    doc.dispatchEvent(button("mousedown"));
    doc.dispatchEvent(button("mouseup"));
    // кадр без тиков (монитор 144 Гц) нажатие не съедает
    expect(frame(0, "Mouse0")).toBe(0);
    expect(input.down.has("Mouse0")).toBe(true);
    expect(frame(1, "Mouse0")).toBe(1);
    expect(frame(1, "Mouse0")).toBe(0);
    expect(input.down.has("Mouse0")).toBe(false);
  });

  it("latches a key tapped inside one frame the same way", () => {
    win.dispatchEvent(key("keydown", "KeyQ"));
    win.dispatchEvent(key("keyup", "KeyQ"));
    expect(frame(1, "KeyQ")).toBe(1);
    expect(frame(1, "KeyQ")).toBe(0);
  });

  it("leaves a long hold unchanged: held while down, released at once after a tick saw it", () => {
    doc.dispatchEvent(button("mousedown"));
    expect([frame(1, "Mouse0"), frame(2, "Mouse0"), frame(0, "Mouse0"), frame(1, "Mouse0")]).toEqual([1, 2, 0, 1]);
    doc.dispatchEvent(button("mouseup"));
    expect(input.down.has("Mouse0")).toBe(false);
    expect(frame(1, "Mouse0")).toBe(0);
  });

  it("keeps a key held when it is tapped and pressed again before a tick", () => {
    win.dispatchEvent(key("keydown", "KeyW"));
    win.dispatchEvent(key("keyup", "KeyW"));
    win.dispatchEvent(key("keydown", "KeyW"));
    expect([frame(1, "KeyW"), frame(1, "KeyW")]).toEqual([1, 1]);
  });

  it("forgets latched presses on lock loss and on blur", () => {
    doc.dispatchEvent(button("mousedown"));
    doc.dispatchEvent(button("mouseup"));
    setLocked(false);
    expect(input.down.size).toBe(0);
    setLocked(true);
    expect(frame(1, "Mouse0")).toBe(0);
    win.dispatchEvent(key("keydown", "KeyE"));
    win.dispatchEvent(key("keyup", "KeyE"));
    win.dispatchEvent(new Event("blur"));
    expect(input.down.size).toBe(0);
    expect(frame(1, "KeyE")).toBe(0);
    // после сброса долгое нажатие снова работает как обычно
    doc.dispatchEvent(button("mousedown"));
    expect(frame(1, "Mouse0")).toBe(1);
    doc.dispatchEvent(button("mouseup"));
    expect(input.down.has("Mouse0")).toBe(false);
  });
});

// правый клик и тап двумя пальцами открыли бы меню браузера, а оно снимает захват мыши
describe("context menu", () => {
  it("is blocked on the canvas until dispose", () => {
    const e = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    input.dispose();
    const after = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
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
