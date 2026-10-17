import { stepSpring, type Spring } from "../hands/spring";
import type { Effect } from "./effects";

/**
 * Тряска и толчки камеры мира (round1/03, round2/03, GDD 5). Тряска — модель trauma: сила = trauma² × предел,
 * в основном сдвигом, поворот не больше 0,5°, чтобы не сбивать прицел; trauma ≤ 1 и гаснет 1,5/с.
 * Толчок (отдача, удар по мне) и FOV-kick — критически задемпфированные пружины с точным шагом, отдельно от тряски:
 * у толчка свой предел (≤ 1° у жертвы, до 1,5° отдачи шара). kickOmega и fovOmega — жёсткость, рад/с.
 */
export const SHAKE = { maxRotDeg: 0.5, maxShiftM: 0.05, decayPerS: 1.5, kickOmega: 25, fovOmega: 20 } as const;

export interface CameraFeel {
  trauma: number;
  /** Время с создания, с: по нему идёт шум тряски. */
  t: number;
  /** Толчок, рад. */
  pitch: Spring;
  yaw: Spring;
  roll: Spring;
  /** FOV-kick, градусы. */
  fov: Spring;
  fovTarget: number;
  /** Сколько ещё секунд FOV держится у fovTarget. */
  fovHold: number;
}

/** Добавка к камере за кадр: сдвиг по осям камеры (м), поворот (рад) и прибавка к FOV (градусы). */
export interface CameraOffset {
  x: number;
  y: number;
  pitch: number;
  yaw: number;
  roll: number;
  fovDeg: number;
}

const DEG = Math.PI / 180;
const REST: Spring = { x: 0, v: 0 };
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

export function createCameraFeel(): CameraFeel {
  return { trauma: 0, t: 0, pitch: REST, yaw: REST, roll: REST, fov: REST, fovTarget: 0, fovHold: 0 };
}

/**
 * trauma — складывается до 1; kick — импульс скорости v += amount·ω·e: у критически задемпфированной пружины из
 * покоя пик ровно amount через 1/ω; fov — держать deg ещё holdS секунд. Остальные эффекты камеру не трогают.
 */
export function addFeel(f: CameraFeel, e: Effect): CameraFeel {
  if (e.kind === "trauma") return { ...f, trauma: clamp01(f.trauma + Math.max(0, finite(e.amount))) };
  if (e.kind === "kick") {
    const k = SHAKE.kickOmega * Math.E * DEG;
    const push = (s: Spring, deg: number): Spring => ({ x: s.x, v: s.v + finite(deg) * k });
    return { ...f, pitch: push(f.pitch, e.pitchDeg), yaw: push(f.yaw, e.yawDeg), roll: push(f.roll, e.rollDeg) };
  }
  if (e.kind === "fov") return { ...f, fovTarget: finite(e.deg), fovHold: Math.max(0, finite(e.holdS)) };
  return f;
}

/**
 * Шаг на dt секунд кадра. motion — ползунок «Движение камеры» 0…1 (0 — камера неподвижна); roll — крен
 * (по умолчанию выключен, GDD 5). Всё считается от dt: одно и то же движение одинаково при 30, 60 и 144 Гц —
 * и конец удержания FOV, попавший внутрь кадра, делит шаг пружины в свой момент.
 */
export function stepCameraFeel(f: CameraFeel, dt: number, motion: number, roll = false): { feel: CameraFeel; offset: CameraOffset } {
  // отрицательный или нечисловой шаг — пустой кадр: пружины от него разошлись бы
  const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const t = f.t + h;
  const trauma = Math.max(0, f.trauma - SHAKE.decayPerS * h);
  const fovHold = Math.max(0, f.fovHold - h);
  // удержание кончилось внутри кадра: до его конца FOV тянется к цели, после — к нулю
  const held = Math.min(h, f.fovHold);
  const fovHeld = held > 0 ? stepSpring(f.fov, f.fovTarget, SHAKE.fovOmega, held) : f.fov;
  const feel: CameraFeel = {
    trauma,
    t,
    fovHold,
    fovTarget: f.fovTarget,
    pitch: stepSpring(f.pitch, 0, SHAKE.kickOmega, h),
    yaw: stepSpring(f.yaw, 0, SHAKE.kickOmega, h),
    roll: stepSpring(f.roll, 0, SHAKE.kickOmega, h),
    fov: fovHold > 0 ? fovHeld : stepSpring(fovHeld, 0, SHAKE.fovOmega, h - held),
  };
  const m = clamp01(motion);
  const k = trauma * trauma * m;
  // гладкий шум без Math.random: сумма синусов с несоизмеримыми частотами, |n| ≤ 1
  const n = (a: number, b: number) => 0.6 * Math.sin(t * a) + 0.4 * Math.sin(t * b + 1.7);
  const rot = SHAKE.maxRotDeg * DEG;
  // `+ 0` убирает −0: неподвижная камера — ровно нули
  const offset: CameraOffset = {
    x: k * SHAKE.maxShiftM * n(47, 83) + 0,
    y: k * SHAKE.maxShiftM * n(59, 101) + 0,
    pitch: k * rot * n(37, 71) + feel.pitch.x * m + 0,
    yaw: k * rot * n(43, 67) + feel.yaw.x * m + 0,
    roll: roll ? feel.roll.x * m + 0 : 0,
    fovDeg: feel.fov.x * m + 0,
  };
  return { feel, offset };
}
