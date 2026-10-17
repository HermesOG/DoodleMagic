import { stepSpring, type Spring } from "./spring";

/** Что происходит с магом в этом кадре — из симуляции и взгляда. */
export interface HandMotionInput {
  /** Время кадра, с. Отрицательное и не число считаются нулём, больше MAX_DT обрезается. */
  dt: number;
  /** Горизонтальная скорость, м/с. */
  speed: number;
  onGround: boolean;
  /** Скорость приземления (< 0), если в этом кадре приземлились, иначе 0. Слабее LAND_MIN_SPEED руки не замечают. */
  landVel: number;
  /**
   * Сколько секунд назад, считая от конца кадра, было приземление (0…dt; по умолчанию 0 — в конце кадра).
   * Толчок прикладывается в свой момент, а не в начале кадра: при 30 и при 144 Гц приседание одинаковое.
   */
  landAge?: number;
  /**
   * Скорость поворота взгляда за кадр, рад/с (lookRate: изменение после applyLook / dt): yaw > 0 — влево,
   * pitch > 0 — вверх. Скорость, а не пиксели за кадр: отставание не зависит от частоты кадров и уже учитывает
   * множитель чувствительности и выброшенные скачки мыши. Не число — ноль.
   */
  yawRate: number;
  pitchRate: number;
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
/** Толчок рук вниз на 1 м/с скорости приземления, м/с: прыжок (≈ 7 м/с) даёт приседание около 3 см. */
export const LAND_KICK_PER_MS = 0.11;
/** Самый сильный толчок, м/с: долгое падение опускает руки не больше чем на ≈ 4,5 см. */
export const LAND_KICK_MAX = 1.1;
/**
 * Отставание рук за взглядом, м на рад/с поворота: быстрый поворот 165°/с (2,9 рад/с) — 15 мм вбок,
 * прицеливание 45°/с — 4 мм. По вертикали — 0,8 от этого: руки и так ниже центра кадра.
 */
export const LOOK_LAG_M_PER_RAD_S = 0.0052;
export const LOOK_LIFT_M_PER_RAD_S = 0.8 * LOOK_LAG_M_PER_RAD_S;
/** Крен рук на поворот, рад на рад/с: 165°/с — около 21 мрад через 0,6 с поворота. */
export const LOOK_ROLL_PER_RAD_S = 0.0078;
/** Пределы отставания (по x и по y) и крена. */
export const LOOK_LAG_MAX_M = 0.045;
export const LOOK_ROLL_MAX = 0.12;
/** Самый длинный шаг по времени: после зависания вкладки пружины шагают не дальше этого. */
export const MAX_DT = 0.1;
/** Жёсткость пружин, рад/с: походка, отставание вбок, по вертикали (с приседанием), крен. */
const OMEGA = { walk: 6, x: 10, y: 9, roll: 7 } as const;
const BREATH_HZ = 0.22;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) ? v : 0);

export function createHandRig(): HandRig {
  const rest: Spring = { x: 0, v: 0 };
  return { t: 0, phase: 0, walk: rest, x: rest, y: rest, roll: rest };
}

/**
 * Дыхание в покое, покачивание при ходьбе, отставание за взглядом и приседание при приземлении —
 * всё на пружинах с точным шагом, а цели — скорости, а не приросты за кадр: одно и то же движение даёт
 * одни и те же позы при 30, 60 и 144 Гц.
 */
export function updateHandRig(rig: HandRig, m: HandMotionInput, runSpeed: number): { rig: HandRig; pose: HandPose } {
  // отрицательный или нечисловой шаг взорвал бы пружины насовсем: считаем такой кадр пустым
  const dt = Number.isFinite(m.dt) ? clamp(m.dt, 0, MAX_DT) : 0;
  const t = rig.t + dt;
  const walk = stepSpring(rig.walk, m.onGround ? clamp(m.speed / runSpeed, 0, 1) : 0, OMEGA.walk, dt);
  const w = clamp(walk.x, 0, 1);
  const phase = (rig.phase + (m.speed * dt * Math.PI) / STRIDE_M) % (2 * Math.PI);
  const breath = Math.sin(t * 2 * Math.PI * BREATH_HZ) * 0.006 * (1 - w);

  // медленное — на пружинах (взгляд, дыхание, приземление), качание шага — напрямую: пружина его бы сгладила.
  // Поворот вправо (yaw убывает) — руки отстают влево и кренятся по часовой; взгляд вверх — руки отстают вниз.
  const yawRate = finite(m.yawRate);
  const pitchRate = finite(m.pitchRate);
  const targetX = clamp(yawRate * LOOK_LAG_M_PER_RAD_S, -LOOK_LAG_MAX_M, LOOK_LAG_MAX_M);
  const targetY = breath - clamp(pitchRate * LOOK_LIFT_M_PER_RAD_S, -LOOK_LAG_MAX_M, LOOK_LAG_MAX_M);
  const targetRoll = clamp(yawRate * LOOK_ROLL_PER_RAD_S, -LOOK_ROLL_MAX, LOOK_ROLL_MAX);
  const bobX = Math.sin(phase) * 0.015 * w;
  const bobY = -Math.abs(Math.sin(phase)) * 0.022 * w;

  let y: Spring;
  if (m.landVel < -LAND_MIN_SPEED) {
    // толчок — в момент приземления внутри кадра: до него пружина идёт без толчка, после — с ним
    const age = clamp(finite(m.landAge), 0, dt);
    const before = stepSpring(rig.y, targetY, OMEGA.y, dt - age);
    y = stepSpring({ x: before.x, v: before.v + Math.max(-LAND_KICK_MAX, m.landVel * LAND_KICK_PER_MS) }, targetY, OMEGA.y, age);
  } else {
    y = stepSpring(rig.y, targetY, OMEGA.y, dt);
  }
  const next: HandRig = {
    t,
    phase,
    walk,
    x: stepSpring(rig.x, targetX, OMEGA.x, dt),
    y,
    roll: stepSpring(rig.roll, targetRoll, OMEGA.roll, dt),
  };
  return {
    rig: next,
    pose: { x: next.x.x + bobX, y: next.y.x + bobY, roll: next.roll.x + Math.sin(phase) * 0.03 * w, swing: Math.sin(phase) * w },
  };
}
