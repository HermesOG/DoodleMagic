import { GAME_KEYS, KEYS } from "./controls";

/**
 * Клавиатура и мышь песочницы. Движение принимается только при захваченной мыши. Левая кнопка при захвате —
 * KEYS.primary ("Mouse0") в down: первый клик (захват) не стреляет, отпускание и потеря захвата или фокуса её гасят.
 * down читается по уровню на каждом тике, поэтому нажатие держится в down, пока его не увидел тик: тап тачпада
 * (mousedown и mouseup за ~1 мс, в одном кадре) или клавиша короче тика иначе пропали бы.
 */
export interface InputDevice {
  readonly down: ReadonlySet<string>;
  readonly locked: boolean;
  /** Тики кадра прочли down: нажатия, отпущенные раньше, чем их увидел тик, теперь гаснут. Звать, если тиков > 0. */
  ticked(): void;
  /** Сдвиг мыши с прошлого вызова, пиксели. */
  takeMouse(): { dx: number; dy: number };
  /**
   * Захват мыши. По умолчанию обычный (с ускорением ОС, как у курсора: на тачпаде иначе взгляд очень медленный);
   * raw — сырой ввод (unadjustedMovement), а где браузер его не даёт — снова обычный захват.
   */
  requestLock(raw: boolean): void;
  onLockChange(cb: (locked: boolean) => void): void;
  /** Браузер отказал в захвате (Chrome — около секунды после выхода по Esc). */
  onLockError(cb: () => void): void;
  /** Нажатие клавиши-переключателя (работает и без захвата мыши), без автоповтора. */
  onPress(code: string, cb: () => void): void;
  dispose(): void;
}

export function createInput(canvas: HTMLCanvasElement): InputDevice {
  const down = new Set<string>();
  /** Нажаты после последнего тика: ни один тик их ещё не видел. */
  const unseen = new Set<string>();
  /** Отпущены до того, как тик увидел нажатие: гаснут в ticked(). */
  const releaseLater = new Set<string>();
  const press = (c: string): void => {
    if (!down.has(c)) unseen.add(c);
    down.add(c);
    releaseLater.delete(c);
  };
  const release = (c: string): void => {
    if (unseen.has(c)) releaseLater.add(c);
    else down.delete(c);
  };
  const clearAll = (): void => {
    down.clear();
    unseen.clear();
    releaseLater.clear();
  };
  let dx = 0;
  let dy = 0;
  let locked = false;
  const lockListeners: ((locked: boolean) => void)[] = [];
  const errorListeners: (() => void)[] = [];
  const pressListeners = new Map<string, () => void>();

  const onKeyDown = (e: KeyboardEvent): void => {
    // Ctrl, Alt и Cmd оставляем браузеру и системе: ни одна игровая клавиша с ними не работает
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (locked && GAME_KEYS.has(e.code)) e.preventDefault();
    // автоповтор тоже кладёт клавишу: зажатая до захвата мыши или до возврата фокуса W иначе не вела бы мага,
    // пока её не нажмут заново
    if (locked) press(e.code);
    if (!e.repeat) pressListeners.get(e.code)?.();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    release(e.code);
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!locked) return;
    dx += e.movementX;
    dy += e.movementY;
  };
  // ЛКМ стреляет только при захваченной мыши: клик, который захват просит, магу не достаётся. Как и у клавиш,
  // с Ctrl, Alt и Cmd кнопка ни на что не назначена (на macOS Ctrl + клик — это правая кнопка)
  const onMouseDown = (e: MouseEvent): void => {
    if (!locked || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    press(KEYS.primary);
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) release(KEYS.primary);
  };
  // правый клик и тап двумя пальцами по тачпаду открыли бы меню браузера, а оно снимает захват мыши
  const onContextMenu = (e: Event): void => e.preventDefault();
  const onLockChange = (): void => {
    locked = document.pointerLockElement === canvas;
    if (!locked) clearAll();
    // сдвиг, накопленный вокруг смены захвата (возврат курсора в центр), взгляду не нужен
    dx = 0;
    dy = 0;
    for (const cb of lockListeners) cb(locked);
  };
  const onLockError = (): void => {
    for (const cb of errorListeners) cb();
  };
  const onBlur = (): void => clearAll();

  /** Обычный захват; отказ приходит событием pointerlockerror, промис гасим, чтобы не было необработанной ошибки. */
  const plainLock = (): void => {
    try {
      // Firefox и старые браузеры возвращают undefined, Chrome — промис
      (canvas.requestPointerLock() as Promise<void> | undefined)?.catch(() => undefined);
    } catch {
      // старые браузеры бросают сразу; об отказе всё равно скажет pointerlockerror
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("pointerlockchange", onLockChange);
  document.addEventListener("pointerlockerror", onLockError);
  canvas.addEventListener("contextmenu", onContextMenu);

  return {
    down,
    get locked() {
      return locked;
    },
    ticked() {
      unseen.clear();
      for (const c of releaseLater) down.delete(c);
      releaseLater.clear();
    },
    takeMouse() {
      const m = { dx, dy };
      dx = 0;
      dy = 0;
      return m;
    },
    requestLock(raw) {
      if (!raw) {
        plainLock();
        return;
      }
      let p: Promise<void> | undefined;
      try {
        p = canvas.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
      } catch {
        plainLock();
        return;
      }
      // отказ в сыром вводе (NotSupportedError и т. п.) — просим обычный захват; если уже захвачено, ничего не делаем
      p?.catch(() => {
        if (document.pointerLockElement !== canvas) plainLock();
      });
    },
    onLockChange(cb) {
      lockListeners.push(cb);
    },
    onLockError(cb) {
      errorListeners.push(cb);
    },
    onPress(code, cb) {
      pressListeners.set(code, cb);
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onLockError);
      canvas.removeEventListener("contextmenu", onContextMenu);
    },
  };
}
