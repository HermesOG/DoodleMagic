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
  /** Громкость звука (эффекты) 0…1 — мастер синтеза. */
  sfxVolume: number;
  /** «Музыка в бою» (фаза 9). */
  musicOn: boolean;
  /** Громкость музыки 0…1. */
  musicVolume: number;
}

const KEY = "doodlemagic_settings";
export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, quality: "auto", rawMouse: false, sfxVolume: 0.7, musicOn: true, musicVolume: 0.5 };

/** Доля 0…1: число прижимается к краям, не число — по умолчанию. */
const unit = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

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
  const sfxVolume = unit(o.sfxVolume, DEFAULT_SETTINGS.sfxVolume);
  const musicOn = o.musicOn !== false;
  const musicVolume = unit(o.musicVolume, DEFAULT_SETTINGS.musicVolume);
  return { sensitivity, quality, rawMouse, sfxVolume, musicOn, musicVolume };
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
