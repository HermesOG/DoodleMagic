import type { Vec3 } from "@doodlemagic/sim";

/** Тело мага ниже этого (м) и падает без пола под собой — камера ждёт у кромки, а не летит в ущелье. */
export const FALL_HOLD_Y = -0.5;
/** Пол двора: глаз выше него — точка, где камера может ждать. */
export const FLOOR_Y = 0;
/** Доворот на мага, 1/с: за 0,25 с — 92 % пути, одинаково при любой частоте кадров. */
export const FALL_TURN_RATE = 10;
/** Ближе этого по горизонтали маг почти под камерой: курс по нему скачет, его не трогаем. */
const STEADY_YAW_M = 0.5;
const MAX_PITCH = 1.4;

export interface FallCamera {
  /** Последний глаз над полом, пока маг не падал. */
  safe: Vec3 | null;
  /** Камера ждёт: где стоит и куда смотрит (yaw и pitch, как у взгляда). */
  hold: { pos: Vec3; yaw: number; pitch: number } | null;
}

export const createFallCamera = (): FallCamera => ({ safe: null, hold: null });

export interface FallCameraFrame {
  /** Глаз мага в этом кадре. */
  eye: Vec3;
  /** Куда смотреть, пока камера ждёт (тело мага). */
  target: Vec3;
  /** Маг ниже пола (FALL_HOLD_Y) и падает. */
  falling: boolean;
  /** Взгляд игрока: с него камера начинает доворот. */
  look: { yaw: number; pitch: number };
  dt: number;
}

const wrapAngle = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * Камера при падении в ущелье: пока маг падает ниже пола, она стоит на последнем глазе над полом и плавно
 * доворачивает на мага. Не падает — hold пуст, камера снова в глазах (после возрождения — сразу, без проводки).
 */
export function stepFallCamera(s: FallCamera, f: FallCameraFrame): FallCamera {
  if (!f.falling) return { safe: f.eye.y > FLOOR_Y ? { ...f.eye } : s.safe, hold: null };
  const from = s.hold ?? { pos: s.safe ?? { ...f.eye }, yaw: f.look.yaw, pitch: f.look.pitch };
  const dx = f.target.x - from.pos.x;
  const dy = f.target.y - from.pos.y;
  const dz = f.target.z - from.pos.z;
  const flat = Math.hypot(dx, dz);
  const k = 1 - Math.exp(-FALL_TURN_RATE * Math.max(0, f.dt));
  const yaw = flat > STEADY_YAW_M ? from.yaw + wrapAngle(Math.atan2(-dx, -dz) - from.yaw) * k : from.yaw;
  const aimPitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, Math.atan2(dy, flat)));
  return { safe: s.safe, hold: { pos: from.pos, yaw: wrapAngle(yaw), pitch: from.pitch + (aimPitch - from.pitch) * k } };
}
