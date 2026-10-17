import { isPresetId, type PresetId } from "../render/quality";
import { clampSensitivity } from "./controls";

export type QualityChoice = "auto" | PresetId;

export interface Settings {
  sensitivity: number;
  quality: QualityChoice;
  /**
   * Сырой ввод мыши (Pointer Lock с unadjustedMovement): без ускорения ОС. По умолчанию выключен — на тачпаде
   * ноутбука взгляд без ускорения очень медленный, а часть платформ такой захват не даёт вовсе.
   */
  rawMouse: boolean;
}

const KEY = "doodlemagic_settings";
export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, quality: "auto", rawMouse: false };

/** Настройки из localStorage: всё непонятное заменяется значением по умолчанию. */
export function parseSettings(raw: string | null): Settings {
  let x: unknown = null;
  try {
    x = raw ? JSON.parse(raw) : null;
  } catch {
    x = null;
  }
  const o = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
  const quality = o.quality === "auto" || isPresetId(o.quality) ? o.quality : DEFAULT_SETTINGS.quality;
  const sensitivity = typeof o.sensitivity === "number" ? clampSensitivity(o.sensitivity) : DEFAULT_SETTINGS.sensitivity;
  const rawMouse = o.rawMouse === true;
  return { sensitivity, quality, rawMouse };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // приватный режим: настройки просто не запомнятся
  }
}
