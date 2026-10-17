import { stepSpring, type Spring } from "./spring";

/** Что происходит с магом в этом кадре — из симуляции и мыши. */
export interface HandMotionInput {
  /** Время кадра, с. Отрицательное и не число считаются нулём, больше MAX_DT обрезается. */
  dt: number;
  /** Горизонтальная скорость, м/с. */
  speed: number;
  onGround: boolean;
  /** Скорость приземления (< 0), если в этом кадре приземлились, иначе 0. Слабее LAND_MIN_SPEED руки не замечают. */
  landVel: number;
  /** Сдвиг мыши за кадр, пиксели. */
  lookDx: number;
  lookDy: number;
}

/** Смещение и наклон обеих рук в пространстве камеры, м и рад; swing — разнос левой и правой при ходьбе. */
export interface HandPose {
  x: number;
  y: number;
  roll: number;
  swing: number;
}

export interface HandRig {
  t: number;
  phase: number;
  walk: Spring;
  x: Spring;
  y: Spring;
  roll: Spring;
}

/** Длина шага: руки качаются в такт шагам, при беге 6,5 м/с — 3 шага в секунду. */
export const STRIDE_M = 2.2;
/**
 * Приземление слабее этой скорости (м/с) руки не замечают. Сим сообщает приземление и на первом тике после
 * createPlayer (≈ −0,17 м/с при 60 Гц): при появлении и респауне руки приседать не должны.
 */
export const LAND_MIN_SPEED = 1;
/** Самый длинный шаг по времени: после зависания вкладки пружины шагают не дальше этого. */
export const MAX_DT = 0.1;
const BREATH_HZ = 0.22;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createHandRig(): HandRig {
  const rest: Spring = { x: 0, v: 0 };
  return { t: 0, phase: 0, walk: rest, x: rest, y: rest, roll: rest };
}

/**
 * Дыхание в покое, покачивание при ходьбе, отставание за взглядом и приседание при приземлении —
 * всё на пружинах, поэтому руки двигаются мягко при любой частоте кадров.
 */
export function updateHandRig(rig: HandRig, m: HandMotionInput, runSpeed: number): { rig: HandRig; pose: HandPose } {
  // отрицательный или нечисловой шаг взорвал бы пружины насовсем: считаем такой кадр пустым
  const dt = Number.isFinite(m.dt) ? clamp(m.dt, 0, MAX_DT) : 0;
  const t = rig.t + dt;
  const walk = stepSpring(rig.walk, m.onGround ? clamp(m.speed / runSpeed, 0, 1) : 0, 6, dt);
  const w = clamp(walk.x, 0, 1);
  const phase = (rig.phase + (m.speed * dt * Math.PI) / STRIDE_M) % (2 * Math.PI);
  const breath = Math.sin(t * 2 * Math.PI * BREATH_HZ) * 0.006 * (1 - w);

  // медленное — на пружинах (взгляд, дыхание, приземление), качание шага — напрямую: пружина его бы сгладила
  const targetX = -clamp(m.lookDx * 0.00025, -0.03, 0.03);
  const targetY = breath + clamp(m.lookDy * 0.00025, -0.03, 0.03);
  const targetRoll = -clamp(m.lookDx * 0.0004, -0.08, 0.08);
  const bobX = Math.sin(phase) * 0.015 * w;
  const bobY = -Math.abs(Math.sin(phase)) * 0.022 * w;

  let y = rig.y;
  if (m.landVel < -LAND_MIN_SPEED) y = { x: y.x, v: y.v + Math.max(-0.75, m.landVel * 0.07) };
  const next: HandRig = {
    t,
    phase,
    walk,
    x: stepSpring(rig.x, targetX, 12, dt),
    y: stepSpring(y, targetY, 9, dt),
    roll: stepSpring(rig.roll, targetRoll, 7, dt),
  };
  return {
    rig: next,
    pose: { x: next.x.x + bobX, y: next.y.x + bobY, roll: next.roll.x + Math.sin(phase) * 0.03 * w, swing: Math.sin(phase) * w },
  };
}
