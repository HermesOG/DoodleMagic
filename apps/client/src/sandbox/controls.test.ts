import { describe, expect, it } from "vitest";
import {
  BASE_SENSITIVITY,
  KEYS,
  MAX_MOUSE_SPEED_PX_PER_MS,
  MAX_MOUSE_STEP_PX,
  applyLook,
  buildInput,
  clampSensitivity,
  lookRate,
  moveAxes,
} from "./controls";
import { vi } from "vitest";
import { buildMatchInput } from "./controls";
import { createInput } from "./input";

describe("moveAxes", () => {
  it("maps WASD by physical key codes", () => {
    expect(moveAxes(new Set(["KeyW", "KeyD"]))).toEqual({ moveX: 1, moveZ: 1 });
    expect(moveAxes(new Set(["KeyS", "KeyA"]))).toEqual({ moveX: -1, moveZ: -1 });
    expect(moveAxes(new Set(["KeyW", "KeyS"]))).toEqual({ moveX: 0, moveZ: 0 });
  });

  it("ignores Ctrl and layout-dependent keys", () => {
    expect(moveAxes(new Set(["ControlLeft", "ц"]))).toEqual({ moveX: 0, moveZ: 0 });
    expect(Object.values(KEYS).some((k) => k.startsWith("Control"))).toBe(false);
  });
});

describe("applyLook", () => {
  it("turns right on positive dx and looks up on negative dy", () => {
    const l = applyLook({ yaw: 0, pitch: 0 }, 100, -50, 1);
    expect(l.yaw).toBeCloseTo(-100 * BASE_SENSITIVITY, 9);
    expect(l.pitch).toBeCloseTo(50 * BASE_SENSITIVITY, 9);
  });

  it("clamps pitch and wraps yaw", () => {
    expect(applyLook({ yaw: 0, pitch: 0 }, 0, -290, 3).pitch).toBeLessThan(Math.PI / 2);
    expect(applyLook({ yaw: 0, pitch: 1.5 }, 0, -290, 3).pitch).toBeCloseTo(Math.PI / 2 - 0.01, 9);
    expect(applyLook({ yaw: 3.1, pitch: 0 }, -200, 0, 1).yaw).toBeLessThan(-2.7);
  });

  it("drops pointer-lock spikes", () => {
    const l = { yaw: 0.3, pitch: 0.1 };
    expect(applyLook(l, MAX_MOUSE_STEP_PX + 1, 0, 1)).toBe(l);
  });

  // предел зависит от времени кадра: за долгий кадр рука честно проходит больше пикселей
  it("keeps a fast real turn at a long frame and at 60 FPS", () => {
    const l = { yaw: 0, pitch: 0 };
    // 30 FPS, 18 px/мс: прежний предел в 300 px на кадр выбрасывал такой поворот целиком
    expect(applyLook(l, 600, 0, 0.2, 1000 / 30).yaw).toBeCloseTo(-600 * BASE_SENSITIVITY * 0.2, 9);
    // заминка 100 мс: быстрый поворот 15 px/мс не теряется
    expect(applyLook(l, 1500, -400, 0.2, 100).yaw).toBeCloseTo(-1500 * BASE_SENSITIVITY * 0.2, 9);
    // 60 FPS, 30 px/мс (тачпад с ускорением ОС, мышь 1000 DPI на 0,8 м/с)
    expect(applyLook(l, 500, 0, 1, 1000 / 60).yaw).toBeCloseTo(-500 * BASE_SENSITIVITY, 9);
  });

  it("drops a jump faster than any hand at any frame time", () => {
    const l = { yaw: 0.3, pitch: 0.1 };
    const frames = [1000 / 144, 1000 / 60, 1000 / 30, 100];
    for (const ms of frames) {
      const px = Math.max(MAX_MOUSE_STEP_PX, MAX_MOUSE_SPEED_PX_PER_MS * ms) * 1.5;
      expect(applyLook(l, px, 0, 1, ms)).toBe(l);
      expect(applyLook(l, 0, -px, 1, ms)).toBe(l);
    }
    // чуть ниже предела — уже настоящее движение
    expect(applyLook(l, MAX_MOUSE_SPEED_PX_PER_MS * 100 - 1, 0, 1, 100)).not.toBe(l);
  });

  it("falls back to the per-frame limit when the frame time is not a number", () => {
    const l = { yaw: 0.3, pitch: 0.1 };
    for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, -50]) expect(applyLook(l, MAX_MOUSE_STEP_PX + 1, 0, 1, ms)).toBe(l);
  });
});

describe("lookRate", () => {
  it("is the applied look change per second, yaw across ±π included", () => {
    const r = lookRate({ yaw: 0.1, pitch: 0 }, { yaw: 0.05, pitch: 0.02 }, 0.01);
    expect(r.yaw).toBeCloseTo(-5, 9);
    expect(r.pitch).toBeCloseTo(2, 9);
    // через шов ±π: короткий путь, а не почти полный оборот
    const wrap = lookRate({ yaw: Math.PI - 0.01, pitch: 0 }, { yaw: -Math.PI + 0.01, pitch: 0 }, 0.02);
    expect(wrap.yaw).toBeCloseTo(1, 9);
  });

  it("is zero for an empty or broken frame time", () => {
    for (const dt of [0, -1, Number.NaN]) expect(lookRate({ yaw: 0, pitch: 0 }, { yaw: 1, pitch: 1 }, dt)).toEqual({ yaw: 0, pitch: 0 });
  });
});

describe("buildInput", () => {
  it("is plain data with the jump key and the look", () => {
    expect(buildInput(new Set(["Space", "KeyW"]), { yaw: 1, pitch: -0.2 })).toEqual({ moveX: 0, moveZ: 1, jump: true, yaw: 1, pitch: -0.2 });
  });
});

describe("clampSensitivity", () => {
  it("keeps the multiplier in range", () => {
    expect(clampSensitivity(10)).toBe(3);
    expect(clampSensitivity(0)).toBe(0.2);
    expect(clampSensitivity(Number.NaN)).toBe(1);
  });
});

describe("buildMatchInput", () => {
  it("adds LMB and Q / E / C by physical code", () => {
    expect(buildMatchInput(new Set(["Mouse0", "KeyQ", "KeyW"]), { yaw: 0, pitch: 0 })).toEqual({
      moveX: 0, moveZ: 1, jump: false, yaw: 0, pitch: 0, primary: true, q: true, e: false, c: false,
    });
    expect(Object.values(KEYS)).toEqual(expect.arrayContaining(["Mouse0", "KeyQ", "KeyE", "KeyC", "KeyX"]));
  });

  // первый клик только захватывает мышь: выстрел — лишь при захваченной мыши, и кнопка гаснет вместе с клавишами
  it("holds LMB only while the mouse is locked and forgets it with the keys", () => {
    const doc = Object.assign(new EventTarget(), { pointerLockElement: null as unknown });
    const win = new EventTarget();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", win);
    const canvas = { requestPointerLock: () => Promise.resolve() };
    const input = createInput(canvas as unknown as HTMLCanvasElement);
    const mouse = (type: "mousedown" | "mouseup", button: number, ctrlKey = false) =>
      doc.dispatchEvent(Object.assign(new Event(type), { button, ctrlKey, metaKey: false, altKey: false }));
    const lock = (on: boolean) => {
      doc.pointerLockElement = on ? canvas : null;
      doc.dispatchEvent(new Event("pointerlockchange"));
    };
    const primary = () => buildMatchInput(input.down, { yaw: 0, pitch: 0 }).primary;
    try {
      // клик «Играть» до захвата не стреляет, его mouseup после захвата ничего не ломает
      mouse("mousedown", 0);
      lock(true);
      expect(primary()).toBe(false);
      mouse("mouseup", 0);
      // правая кнопка и Ctrl + клик ни на что не назначены
      mouse("mousedown", 2);
      mouse("mousedown", 0, true);
      expect(primary()).toBe(false);
      mouse("mousedown", 0);
      expect(primary()).toBe(true);
      mouse("mouseup", 0);
      expect(primary()).toBe(false);
      mouse("mousedown", 0);
      win.dispatchEvent(new Event("blur"));
      expect(primary()).toBe(false);
      mouse("mousedown", 0);
      lock(false);
      expect(primary()).toBe(false);
    } finally {
      input.dispose();
      vi.unstubAllGlobals();
    }
  });
});
