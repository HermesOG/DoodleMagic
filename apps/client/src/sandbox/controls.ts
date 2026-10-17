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
/**
 * Pointer Lock иногда присылает скачок в сотни пикселей (Chrome на Windows при обычном захвате, первое событие
 * после захвата) — такой кадр пропускаем. Но Chrome сливает mousemove в одно событие на кадр, поэтому судим
 * сдвиг за кадр, и предел растёт со временем кадра: за 33 мс (30 FPS) или за заминку 100 мс рука честно
 * проходит больше пикселей, чем за 7 мс. Выбрасывается только сдвиг, который не может дать рука:
 * больше MAX_MOUSE_STEP_PX за кадр и одновременно быстрее MAX_MOUSE_SPEED_PX_PER_MS.
 */
export const MAX_MOUSE_STEP_PX = 300;
/**
 * 40 px/мс. Тачпад с ускорением ОС на самом быстром свайпе даёт около 20–25 px/мс, мышь 1000 DPI на 1 м/с —
 * 39 px/мс без ускорения ОС. При множителе 1 это 4400°/с — ни один флик столько не крутит (быстрый разворот
 * на 180° — около 1500–2000°/с на пике). Предел за кадр: 60 FPS — 667 px, 30 FPS — 1333 px, заминка
 * 100 мс — 4000 px; от 133 FPS и выше действует пол MAX_MOUSE_STEP_PX.
 */
export const MAX_MOUSE_SPEED_PX_PER_MS = 40;
const MAX_PITCH = Math.PI / 2 - 0.01;

export interface Look {
  yaw: number;
  pitch: number;
}

export function moveAxes(down: ReadonlySet<string>): { moveX: number; moveZ: number } {
  const axis = (pos: string, neg: string) => (down.has(pos) ? 1 : 0) - (down.has(neg) ? 1 : 0);
  return { moveX: axis(KEYS.right, KEYS.left), moveZ: axis(KEYS.forward, KEYS.back) };
}

/** Сколько пикселей за кадр длиной frameMs ещё считается движением руки. Нечисловое или отрицательное время — 0. */
export function mouseStepLimit(frameMs: number): number {
  const ms = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : 0;
  return Math.max(MAX_MOUSE_STEP_PX, MAX_MOUSE_SPEED_PX_PER_MS * ms);
}

/**
 * Поворот взгляда от сдвига мыши за кадр длиной frameMs: вправо — yaw уменьшается (как в three.js), вверх —
 * pitch растёт. Сдвиг, которого рука за это время дать не может (mouseStepLimit), пропускается весь.
 */
export function applyLook(look: Look, dx: number, dy: number, sensitivity: number, frameMs = 0): Look {
  const limit = mouseStepLimit(frameMs);
  if (Math.abs(dx) > limit || Math.abs(dy) > limit) return look;
  const k = BASE_SENSITIVITY * sensitivity;
  const pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, look.pitch - dy * k));
  let yaw = look.yaw - dx * k;
  if (yaw > Math.PI) yaw -= 2 * Math.PI;
  if (yaw < -Math.PI) yaw += 2 * Math.PI;
  return { yaw, pitch };
}

/**
 * Скорость поворота, которую взгляд получил за кадр (рад/с): yaw > 0 — влево, pitch > 0 — вверх. Это изменение
 * после applyLook, то есть уже с множителем и без выброшенных скачков; через шов ±π yaw идёт коротким путём.
 * Пустой или нечисловой кадр — ноль.
 */
export function lookRate(before: Look, after: Look, dtS: number): Look {
  if (!(Number.isFinite(dtS) && dtS > 0)) return { yaw: 0, pitch: 0 };
  let dYaw = after.yaw - before.yaw;
  if (dYaw > Math.PI) dYaw -= 2 * Math.PI;
  if (dYaw < -Math.PI) dYaw += 2 * Math.PI;
  return { yaw: dYaw / dtS, pitch: (after.pitch - before.pitch) / dtS };
}

export function buildInput(down: ReadonlySet<string>, look: Look): PlayerInput {
  return { ...moveAxes(down), jump: down.has(KEYS.jump), yaw: look.yaw, pitch: look.pitch };
}

export function clampSensitivity(x: number): number {
  return Number.isFinite(x) ? Math.min(SENS_MAX, Math.max(SENS_MIN, x)) : 1;
}
