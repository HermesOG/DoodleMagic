import { stepSpring, type Spring } from "../hands/spring";
import type { Effect } from "./effects";

/**
 * Тряска и толчки камеры мира (round1/03, round2/03, round3/01, GDD 5). Тряска — модель trauma: сила = trauma² × предел,
 * в основном сдвигом; поворот не больше 0,8° (round3/01, H1: 0,5° давали ≈ 1 px), сдвиг до 12 см. Прицел тряска
 * не трогает: взгляд игрока остаётся прежним, сдвигается только камера.
 * Два профиля шума (round3/01, 2.1): Огонь — 20–25 Гц, коротко, без смещения; Земля — 7–9 Гц, дольше и уводит
 * камеру вниз. У каждого своя trauma: удары разных стихий не смешивают частоты.
 * Толчок (отдача, удар по мне) — критически задемпфированная пружина с точным шагом, отдельно от тряски.
 * FOV-удар — импульс (M3): подъём с жёсткостью 30, пик через ≈ 33 мс, возврат с жёсткостью 12.
 * Проседание — пружина высоты глаз (приземление, удар ладонями в землю), ω 12: пик через ≈ 83 мс.
 */
export const SHAKE = {
  maxRotDeg: 0.8,
  maxShiftM: 0.12,
  decayPerS: 1.5,
  earthDecayPerS: 0.8,
  kickOmega: 25,
  fovUpOmega: 30,
  fovBackOmega: 12,
  dipOmega: 12,
} as const;
/** Приземление (M1): проседание 0,006 м на 1 м/с скорости касания, не глубже 8 см; слабее 1 м/с не замечаем. */
export const LANDING = { mPerMs: 0.006, maxM: 0.08, minSpeed: 1 } as const;
/** FOV-удары складываются, но не дальше ±12°. */
const FOV_MAX_DEG = 12;

export type ShakeProfile = "fire" | "earth";

export interface CameraFeel {
  /** trauma профиля Огня (и всего, что без стихии). */
  trauma: number;
  /** trauma профиля Земли. */
  traumaEarth: number;
  /** Время с создания, с: по нему идёт шум тряски. */
  t: number;
  /** Толчок, рад. */
  pitch: Spring;
  yaw: Spring;
  roll: Spring;
  /** FOV-удар, градусы. */
  fov: Spring;
  /** Проседание глаз по вертикали мира, м (≤ 0 — вниз). */
  dip: Spring;
}

/** Добавка к камере за кадр: сдвиг по осям камеры (м), поворот (рад), прибавка к FOV (градусы), высота глаз в мире (м). */
export interface CameraOffset {
  x: number;
  y: number;
  pitch: number;
  yaw: number;
  roll: number;
  fovDeg: number;
  lift: number;
}

const DEG = Math.PI / 180;
const REST: Spring = { x: 0, v: 0 };
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);
const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

export function createCameraFeel(): CameraFeel {
  return { trauma: 0, traumaEarth: 0, t: 0, pitch: REST, yaw: REST, roll: REST, fov: REST, dip: REST };
}

/** Импульс скорости v += amount·ω·e: у критически задемпфированной пружины из покоя пик ровно amount через 1/ω. */
const push = (s: Spring, amount: number, omega: number): Spring => ({ x: s.x, v: s.v + finite(amount) * omega * Math.E });

/**
 * trauma — складывается до 1 в своём профиле, а с floor — поднимает trauma профиля до amount (тряска, которую держат
 * весь поток, не замораживает чужие удары: они гаснут как обычно, но не ниже пола); kick — импульс толчка, а dropM —
 * камера вниз на столько метров; fov — импульс FOV-удара на deg. Остальные эффекты камеру не трогают.
 */
export function addFeel(f: CameraFeel, e: Effect): CameraFeel {
  if (e.kind === "trauma") {
    const a = Math.max(0, finite(e.amount));
    const add = (t: number): number => clamp01(e.floor ? Math.max(t, a) : t + a);
    return e.profile === "earth" ? { ...f, traumaEarth: add(f.traumaEarth) } : { ...f, trauma: add(f.trauma) };
  }
  if (e.kind === "kick") {
    const k = SHAKE.kickOmega * DEG;
    return {
      ...f,
      pitch: push(f.pitch, e.pitchDeg, k),
      yaw: push(f.yaw, e.yawDeg, k),
      roll: push(f.roll, e.rollDeg, k),
      dip: e.dropM ? push(f.dip, -Math.abs(e.dropM), SHAKE.dipOmega) : f.dip,
    };
  }
  if (e.kind === "fov") return { ...f, fov: push(f.fov, e.deg, SHAKE.fovUpOmega) };
  return f;
}

/** Приземление своего мага (M1): landVel < 0 — скорость касания, м/с. Глаза проседают и пружиной возвращаются. */
export function addLanding(f: CameraFeel, landVel: number): CameraFeel {
  const v = Math.abs(finite(landVel));
  if (v < LANDING.minSpeed) return f;
  return { ...f, dip: push(f.dip, -Math.min(LANDING.maxM, LANDING.mPerMs * v), SHAKE.dipOmega) };
}

/**
 * Шаг FOV-удара: пока уходит от нуля — жёсткость подъёма, с момента пика (скорость 0) — жёсткость возврата. Пик
 * внутри кадра делит шаг в свой момент: одинаково при 30, 60 и 144 Гц.
 */
function stepFov(s: Spring, h: number): Spring {
  if (h <= 0) return s;
  const up = SHAKE.fovUpOmega;
  const away = s.x * s.v > 0 || (s.x === 0 && s.v !== 0);
  if (!away) return stepSpring(s, 0, SHAKE.fovBackOmega, h);
  // x(t) = (x₀ + (v₀ + ω·x₀)·t)·e^(−ωt): скорость обнуляется при t = v₀ / (ω·(v₀ + ω·x₀))
  const tPeak = s.v / (up * (s.v + up * s.x));
  if (tPeak >= h) return stepSpring(s, 0, up, h);
  const peak = stepSpring(s, 0, up, tPeak);
  return stepSpring({ x: peak.x, v: 0 }, 0, SHAKE.fovBackOmega, h - tPeak);
}

/**
 * Шаг на dt секунд кадра. motion — ползунок «Движение камеры» 0…1 (0 — камера неподвижна); roll — крен
 * (по умолчанию выключен, GDD 5). Всё считается от dt: одно и то же движение одинаково при 30, 60 и 144 Гц.
 */
export function stepCameraFeel(f: CameraFeel, dt: number, motion: number, roll = false): { feel: CameraFeel; offset: CameraOffset } {
  // отрицательный или нечисловой шаг — пустой кадр: пружины от него разошлись бы
  const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const t = f.t + h;
  const trauma = Math.max(0, f.trauma - SHAKE.decayPerS * h);
  const traumaEarth = Math.max(0, f.traumaEarth - SHAKE.earthDecayPerS * h);
  const fov = stepFov(f.fov, h);
  const fovDeg = fov.x > FOV_MAX_DEG ? FOV_MAX_DEG : fov.x < -FOV_MAX_DEG ? -FOV_MAX_DEG : fov.x;
  const feel: CameraFeel = {
    trauma,
    traumaEarth,
    t,
    pitch: stepSpring(f.pitch, 0, SHAKE.kickOmega, h),
    yaw: stepSpring(f.yaw, 0, SHAKE.kickOmega, h),
    roll: stepSpring(f.roll, 0, SHAKE.kickOmega, h),
    fov,
    dip: stepSpring(f.dip, 0, SHAKE.dipOmega, h),
  };
  const m = clamp01(motion);
  const kf = trauma * trauma * m;
  const ke = traumaEarth * traumaEarth * m;
  // гладкий шум без Math.random: сумма синусов с несоизмеримыми частотами (рад/с), |n| ≤ 1
  const n = (a: number, b: number) => 0.6 * Math.sin(t * a) + 0.4 * Math.sin(t * b + 1.7);
  const rot = SHAKE.maxRotDeg * DEG;
  const shift = SHAKE.maxShiftM;
  // Огонь — 20–25 Гц (126…157 рад/с), Земля — 7–9 Гц (44…57 рад/с); по Земле y ∈ [−1, 0]: камера проседает
  const sx = clamp1(kf * n(131, 151) + ke * n(47, 53));
  const sy = clamp1(kf * n(139, 127) + ke * (0.5 * n(44, 57) - 0.5));
  const sp = clamp1(kf * n(127, 149) + ke * n(51, 45));
  const sw = clamp1(kf * n(143, 129) + ke * n(55, 49));
  // `+ 0` убирает −0: неподвижная камера — ровно нули
  const offset: CameraOffset = {
    x: sx * shift + 0,
    y: sy * shift + 0,
    pitch: sp * rot + feel.pitch.x * m + 0,
    yaw: sw * rot + feel.yaw.x * m + 0,
    roll: roll ? feel.roll.x * m + 0 : 0,
    fovDeg: fovDeg * m + 0,
    lift: feel.dip.x * m + 0,
  };
  return { feel, offset };
}
