import type { PlayerInput } from "@doodlemagic/sim";

/** Клавиши по event.code: на русской раскладке W остаётся KeyW. Ctrl ни на что не назначен (Ctrl+W закрывает вкладку). */
export const KEYS = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  jump: "Space",
  debug: "Backquote",
} as const;

/** Клавиши, у которых гасим действие браузера (прокрутка пробелом). */
export const GAME_KEYS: ReadonlySet<string> = new Set(Object.values(KEYS));

/** Поворот на пиксель мыши при множителе 1: 0,11°, в радианах. */
export const BASE_SENSITIVITY = (0.11 * Math.PI) / 180;
export const SENS_MIN = 0.2;
export const SENS_MAX = 3;
/** Pointer Lock иногда присылает скачок в сотни пикселей — такие события пропускаем. */
export const MAX_MOUSE_STEP_PX = 300;
const MAX_PITCH = Math.PI / 2 - 0.01;

export interface Look {
  yaw: number;
  pitch: number;
}

export function moveAxes(down: ReadonlySet<string>): { moveX: number; moveZ: number } {
  const axis = (pos: string, neg: string) => (down.has(pos) ? 1 : 0) - (down.has(neg) ? 1 : 0);
  return { moveX: axis(KEYS.right, KEYS.left), moveZ: axis(KEYS.forward, KEYS.back) };
}

/** Поворот взгляда от сдвига мыши: вправо — yaw уменьшается (как в three.js), вверх — pitch растёт. */
export function applyLook(look: Look, dx: number, dy: number, sensitivity: number): Look {
  if (Math.abs(dx) > MAX_MOUSE_STEP_PX || Math.abs(dy) > MAX_MOUSE_STEP_PX) return look;
  const k = BASE_SENSITIVITY * sensitivity;
  const pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, look.pitch - dy * k));
  let yaw = look.yaw - dx * k;
  if (yaw > Math.PI) yaw -= 2 * Math.PI;
  if (yaw < -Math.PI) yaw += 2 * Math.PI;
  return { yaw, pitch };
}

export function buildInput(down: ReadonlySet<string>, look: Look): PlayerInput {
  return { ...moveAxes(down), jump: down.has(KEYS.jump), yaw: look.yaw, pitch: look.pitch };
}

export function clampSensitivity(x: number): number {
  return Number.isFinite(x) ? Math.min(SENS_MAX, Math.max(SENS_MIN, x)) : 1;
}
