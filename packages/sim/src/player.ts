import { bodyBox, moveBody } from "./body";
import {
  EYE_HEIGHT,
  PLAYER_HALF_W,
  PLAYER_HEIGHT,
  PLAYER_STEP,
  type Body,
  type MoveParams,
  type PlayerInput,
  type PlayerState,
  type Vec3,
} from "./types";
import { clamp, cloneVec } from "./vec";
import { inVolume, type World } from "./world";

/** Параметры по умолчанию. Заморожены: это общий объект и параметр по умолчанию у stepPlayer. */
export const DEFAULT_MOVE: Readonly<MoveParams> = Object.freeze({
  runSpeed: 6.5,
  groundAccel: 60,
  groundDecel: 50,
  airControl: 0.6,
  gravity: 20,
  jumpHeight: 1.25,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  maxFallSpeed: 40,
});

const MAX_PITCH = Math.PI / 2 - 0.01;

/** Пустой ввод. Заморожен: это общий объект. */
export const NO_INPUT: Readonly<PlayerInput> = Object.freeze({ moveX: 0, moveZ: 0, jump: false, yaw: 0, pitch: 0 });

/**
 * Новый игрок: стоит подошвой в pos, ещё не на земле. Первый тик на полу поэтому сообщает маленькое
 * приземление, landVel = −g·dt/2 (около −0,17 м/с при 60 Гц): порог эффектов приземления должен быть больше.
 * Точку появления нужно заранее проверить на свободу (isFree(world, bodyBox(...))): тело, утопленное в коллайдер
 * глубже допуска, этот коллайдер не видит и может провалиться сквозь него (см. moveBody).
 */
export function createPlayer(pos: Vec3, yaw = 0): PlayerState {
  return {
    body: {
      pos: cloneVec(pos),
      vel: { x: 0, y: 0, z: 0 },
      halfW: PLAYER_HALF_W,
      height: PLAYER_HEIGHT,
      stepHeight: PLAYER_STEP,
    },
    onGround: false,
    coyote: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    yaw,
    pitch: 0,
    landVel: 0,
  };
}

/** Взгляд вдоль −Z при yaw = 0; положительный yaw поворачивает влево. */
export function forwardXZ(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

const finiteOr = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/**
 * Ввод приходит от клиента, ему нельзя верить: NaN или ±Infinity навсегда отравили бы состояние
 * (NaN в скорости даёт NaN подшагов, цикл не выполняется ни разу, и тело замирает навсегда).
 * Нечисловое или бесконечное движение — 0, затем [−1, 1]; нечисловой или бесконечный взгляд — прежний
 * (или 0, если и прежний не число), наклон — в допустимых пределах; прыжок — только если это ровно true.
 * Возвращает новый объект, исходный не меняет.
 */
export function sanitizeInput(input: Readonly<PlayerInput>, prev: Readonly<PlayerState>): PlayerInput {
  return {
    moveX: clamp(finiteOr(input.moveX, 0), -1, 1),
    moveZ: clamp(finiteOr(input.moveZ, 0), -1, 1),
    jump: input.jump === true,
    yaw: finiteOr(input.yaw, finiteOr(prev.yaw, 0)),
    pitch: clamp(finiteOr(input.pitch, finiteOr(prev.pitch, 0)), -MAX_PITCH, MAX_PITCH),
  };
}

/*
 * Окна «койота» и буфера прыжка считаются в целых тиках. В секундах с вычитанием dt граница зависела бы от
 * остатка округления: 0,1 − 6·(1/60) в double — не ноль, и его знак решал бы, сработает ли прыжок на 6-м тике.
 * В PlayerState окна по-прежнему лежат в секундах (так в контракте types.ts), но всегда как целое число тиков × dt;
 * на входе они округляются обратно в тики.
 * - Окно в тиках — ⌊время / dt⌋ с допуском 1e-6 тика на погрешность деления: 0,1 с → 6 тиков, 0,12 с → 7 при 60 Гц.
 * - Койот: прыжок принимается на первых N тиках, которые начинаются в воздухе после схода с края
 *   (0,1 с: на 1-м…6-м, на 7-м уже нет).
 * - Буфер: нажатие в воздухе срабатывает, если один из следующих M тиков начнётся на земле
 *   (0,12 с: нажатие за 7 тиков до первого тика на земле срабатывает, за 8 — нет).
 */
const windowTicks = (seconds: number, dt: number): number => Math.max(0, Math.floor(seconds / dt + 1e-6));
const storedTicks = (seconds: number, dt: number): number => {
  const n = Math.round(seconds / dt);
  return n > 0 ? n : 0;
};

/** Горизонтальная скорость к цели не быстрее maxDelta за шаг. */
function approachXZ(v: Vec3, tx: number, tz: number, maxDelta: number): void {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= maxDelta || d === 0) {
    v.x = tx;
    v.z = tz;
  } else {
    v.x += (dx / d) * maxDelta;
    v.z += (dz / d) * maxDelta;
  }
}

/**
 * Один тик движения игрока. Чистая функция (state, input, world): нет Math.random, часов и общего состояния,
 * аргументы не меняются, возвращается новое состояние. В одном JS-движке одинаковые аргументы дают результат,
 * одинаковый до бита. Между движками (хост и браузер клиента) возможна разница в несколько ulp: Math.sin и
 * Math.cos в forwardXZ не обязаны быть округлены одинаково. Её гасит согласование: хост авторитетен, клиент
 * сверяет своё предсказание со снапшотом хоста с допуском.
 *
 * Ввод сначала проходит sanitizeInput, поэтому мусор от клиента состояние не портит.
 * landVel в результате — средняя за тик вертикальная скорость тика приземления (гравитация по трапеции), поэтому
 * она отличается от баллистической скорости касания не больше чем на g·dt/2.
 */
export function stepPlayer(
  state: Readonly<PlayerState>,
  rawInput: Readonly<PlayerInput>,
  dt: number,
  world: World,
  p: Readonly<MoveParams> = DEFAULT_MOVE,
): PlayerState {
  const input = sanitizeInput(rawInput, state);
  const body: Body = { ...state.body, pos: cloneVec(state.body.pos), vel: cloneVec(state.body.vel) };

  // Сколько тиков окна осталось, считая этот: 0 — окно закрыто.
  const pressed = input.jump && !state.jumpHeld;
  const bufferIn = pressed ? windowTicks(p.jumpBufferTime, dt) + 1 : storedTicks(state.jumpBuffer, dt);
  const coyoteIn = state.onGround ? windowTicks(p.coyoteTime, dt) + 1 : storedTicks(state.coyote, dt);
  let bufferOut = Math.max(0, bufferIn - 1);
  let coyoteOut = Math.max(0, coyoteIn - 1);

  // Желаемая скорость из ввода и поворота.
  let ix = input.moveX;
  let iz = input.moveZ;
  const il = Math.sqrt(ix * ix + iz * iz);
  if (il > 1) {
    ix /= il;
    iz /= il;
  }
  const f = forwardXZ(input.yaw);
  // вправо = вперёд, повёрнутый на −90°: (−f.z, f.x)
  const wx = (f.x * iz - f.z * ix) * p.runSpeed;
  const wz = (f.z * iz + f.x * ix) * p.runSpeed;
  const hasInput = il > 1e-6;
  if (state.onGround) approachXZ(body.vel, wx, wz, (hasInput ? p.groundAccel : p.groundDecel) * dt);
  else if (hasInput) approachXZ(body.vel, wx, wz, p.groundAccel * p.airControl * dt);

  let onGround = state.onGround;
  if (bufferIn > 0 && (onGround || coyoteIn > 0)) {
    body.vel.y = Math.sqrt(2 * p.gravity * p.jumpHeight);
    bufferOut = 0;
    coyoteOut = 0;
    onGround = false;
  }

  // Поток задаёт скорость, с которой баллистика донесёт ровно до его высоты.
  const box = bodyBox(body);
  for (const v of world.volumes) {
    if (v.kind !== "updraft" || !inVolume(box, v)) continue;
    const rise = v.box.min.y + (v.liftM ?? 0) - body.pos.y;
    if (rise > 0) body.vel.y = Math.max(body.vel.y, Math.sqrt(2 * p.gravity * rise));
  }

  // Гравитация по трапеции: средняя скорость за тик даёт ровно ту высоту прыжка, что в параметрах, при любом тике.
  const vy0 = body.vel.y;
  const vy1 = Math.max(-p.maxFallSpeed, vy0 - p.gravity * dt);
  body.vel.y = (vy0 + vy1) / 2;

  const r = moveBody(world, body, dt, onGround);
  body.vel.y = r.onGround || r.hitCeiling ? 0 : vy1;

  return {
    body,
    onGround: r.onGround,
    coyote: coyoteOut * dt,
    jumpBuffer: bufferOut * dt,
    jumpHeld: input.jump,
    yaw: input.yaw,
    pitch: input.pitch,
    landVel: r.landVel,
  };
}

/** Позиция глаз для камеры. */
export function eyePosition(s: PlayerState): Vec3 {
  return { x: s.body.pos.x, y: s.body.pos.y + EYE_HEIGHT, z: s.body.pos.z };
}
