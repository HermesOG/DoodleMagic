import { overlaps } from "./aabb";
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
import type { World } from "./world";

export const DEFAULT_MOVE: MoveParams = {
  runSpeed: 6.5,
  groundAccel: 60,
  groundDecel: 50,
  airControl: 0.6,
  gravity: 20,
  jumpHeight: 1.25,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  maxFallSpeed: 40,
};

const MAX_PITCH = Math.PI / 2 - 0.01;

export const NO_INPUT: PlayerInput = { moveX: 0, moveZ: 0, jump: false, yaw: 0, pitch: 0 };

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
 * Один тик движения игрока. Детерминирован: результат зависит только от аргументов
 * (нет Math.random, часов и общего состояния), поэтому хост и клиент считают одно и то же.
 * Возвращает новое состояние, исходное не меняет.
 */
export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  dt: number,
  world: World,
  p: MoveParams = DEFAULT_MOVE,
): PlayerState {
  const body: Body = { ...state.body, pos: cloneVec(state.body.pos), vel: cloneVec(state.body.vel) };

  const pressed = input.jump && !state.jumpHeld;
  let jumpBuffer = pressed ? p.jumpBufferTime : Math.max(0, state.jumpBuffer - dt);
  let coyote = state.onGround ? p.coyoteTime : Math.max(0, state.coyote - dt);

  // Желаемая скорость из ввода и поворота.
  let ix = clamp(input.moveX, -1, 1);
  let iz = clamp(input.moveZ, -1, 1);
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
  if (jumpBuffer > 0 && (onGround || coyote > 0)) {
    body.vel.y = Math.sqrt(2 * p.gravity * p.jumpHeight);
    jumpBuffer = 0;
    coyote = 0;
    onGround = false;
  }

  // Поток задаёт скорость, с которой баллистика донесёт ровно до его высоты.
  const box = bodyBox(body);
  for (const v of world.volumes) {
    if (v.kind !== "updraft" || !overlaps(box, v.box)) continue;
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
    coyote,
    jumpBuffer,
    jumpHeld: input.jump,
    yaw: input.yaw,
    pitch: clamp(input.pitch, -MAX_PITCH, MAX_PITCH),
    landVel: r.landVel,
  };
}

/** Позиция глаз для камеры. */
export function eyePosition(s: PlayerState): Vec3 {
  return { x: s.body.pos.x, y: s.body.pos.y + EYE_HEIGHT, z: s.body.pos.z };
}
