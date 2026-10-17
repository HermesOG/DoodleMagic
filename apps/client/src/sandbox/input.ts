import { GAME_KEYS } from "./controls";

/** Клавиатура и мышь песочницы. Движение принимается только при захваченной мыши. */
export interface InputDevice {
  readonly down: ReadonlySet<string>;
  readonly locked: boolean;
  /** Сдвиг мыши с прошлого вызова, пиксели. */
  takeMouse(): { dx: number; dy: number };
  requestLock(): void;
  onLockChange(cb: (locked: boolean) => void): void;
  /** Нажатие клавиши-переключателя (работает и без захвата мыши). */
  onPress(code: string, cb: () => void): void;
  dispose(): void;
}

export function createInput(canvas: HTMLCanvasElement): InputDevice {
  const down = new Set<string>();
  let dx = 0;
  let dy = 0;
  let locked = false;
  const lockListeners: ((locked: boolean) => void)[] = [];
  const pressListeners = new Map<string, () => void>();

  const onKeyDown = (e: KeyboardEvent): void => {
    // Ctrl, Alt и Cmd оставляем браузеру и системе: ни одна игровая клавиша с ними не работает
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (locked && GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (locked) down.add(e.code);
    pressListeners.get(e.code)?.();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!locked) return;
    dx += e.movementX;
    dy += e.movementY;
  };
  const onLockChange = (): void => {
    locked = document.pointerLockElement === canvas;
    if (!locked) down.clear();
    for (const cb of lockListeners) cb(locked);
  };
  const onBlur = (): void => down.clear();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLockChange);

  return {
    down,
    get locked() {
      return locked;
    },
    takeMouse() {
      const m = { dx, dy };
      dx = 0;
      dy = 0;
      return m;
    },
    requestLock() {
      // unadjustedMovement — сырая мышь без ускорения ОС; где его нет, просим обычный захват.
      // Firefox возвращает undefined, Chrome — промис, который отклоняется при слишком частом повторе.
      const p = canvas.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
      p?.catch(() => {
        const again = canvas.requestPointerLock() as Promise<void> | undefined;
        again?.catch(() => undefined);
      });
    },
    onLockChange(cb) {
      lockListeners.push(cb);
    },
    onPress(code, cb) {
      pressListeners.set(code, cb);
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
    },
  };
}
