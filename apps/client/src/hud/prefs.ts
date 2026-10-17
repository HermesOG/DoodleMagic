import type { Element } from "@doodlemagic/sim";

/** Боевые настройки игрока: выбранная стихия и множитель «Движение камеры» 0…1 (GDD 5: доступность). */
export interface CombatPrefs {
  element: Element;
  cameraMotion: number;
}

const KEY = "doodlemagic_combat";
export const DEFAULT_PREFS: Readonly<CombatPrefs> = Object.freeze({ element: "fire", cameraMotion: 1 });

/** Настройки из localStorage: стихия — только fire или earth, движение камеры прижато к [0; 1], остальное — по умолчанию. */
export function parsePrefs(raw: string | null): CombatPrefs {
  let x: unknown = null;
  try {
    x = raw ? JSON.parse(raw) : null;
  } catch {
    x = null;
  }
  const o = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
  const element: Element = o.element === "fire" || o.element === "earth" ? o.element : DEFAULT_PREFS.element;
  const m = o.cameraMotion;
  const cameraMotion = typeof m === "number" && Number.isFinite(m) ? Math.min(1, Math.max(0, m)) : DEFAULT_PREFS.cameraMotion;
  return { element, cameraMotion };
}

export function loadPrefs(): CombatPrefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: CombatPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ element: p.element, cameraMotion: p.cameraMotion }));
  } catch {
    // приватный режим: настройки просто не запомнятся
  }
}
