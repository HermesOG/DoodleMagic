import { aabb } from "../aabb";
import { forwardXZ, sanitizeInput } from "../player";
import type { AABB, Vec3 } from "../types";
import { aimDir, eyeOf } from "./state";
import type { AbilityId, Buttons, MatchInput, MatchState, RejectReason, Slot, TickCtx, Unit } from "./types";

/**
 * Кит стихии: как маг кастует. stepMatch зовёт input раз в тик для каждого живого мага (pressed — фронты кнопок,
 * inp — уже очищенный ввод с удержанием), затем tick для каждого живого мага — до движения юнитов.
 * Киты меняют состояние на месте (stepMatch отдаёт им свою копию) и пишут события в t.ev.
 */
export interface Kit {
  input(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, pressed: Buttons): void;
  tick(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void;
}

/** Кит, который ничего не делает: заглушка до задачи 5. */
export const NO_KIT: Kit = Object.freeze({ input: () => undefined, tick: () => undefined });

/** Прицел: глаза мага и единичное направление взгляда из очищенного ввода. */
export function castAim(u: Unit, inp: MatchInput): { eye: Vec3; dir: Vec3 } {
  const c = sanitizeInput(inp, u.move);
  return { eye: eyeOf(u), dir: aimDir(c.yaw, c.pitch) };
}

const finiteOr0 = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * Единичное направление по XZ, куда ведёт ввод движения относительно взгляда (формула stepPlayer);
 * без ввода — вперёд по взгляду. `+ 0` убирает −0.
 */
export function moveDirXZ(inp: MatchInput): { x: number; z: number } {
  const ix = Math.max(-1, Math.min(1, finiteOr0(inp.moveX)));
  const iz = Math.max(-1, Math.min(1, finiteOr0(inp.moveZ)));
  const f = forwardXZ(finiteOr0(inp.yaw));
  const wx = f.x * iz - f.z * ix;
  const wz = f.z * iz + f.x * ix;
  const l = Math.sqrt(wx * wx + wz * wz);
  if (l < 1e-6) return { x: f.x + 0, z: f.z + 0 };
  return { x: wx / l + 0, z: wz / l + 0 };
}

/** Нормированный вектор по XZ или (0, 0), если он короче 1e-9. */
export function horizontalDir(v: { x: number; z: number }): { x: number; z: number } {
  const l = Math.sqrt(v.x * v.x + v.z * v.z);
  return l < 1e-9 ? { x: 0, z: 0 } : { x: v.x / l + 0, z: v.z / l + 0 };
}

/**
 * Стена поперёк взгляда, повёрнутая к ближайшей оси мира (Р6): смотрим скорее вдоль Z — стена тянется вдоль X,
 * иначе вдоль Z. c — середина основания; бокс от c.y до c.y + heightM.
 */
export function snappedWallBox(c: Vec3, yaw: number, lengthM: number, thickM: number, heightM: number): AABB {
  const f = forwardXZ(yaw);
  const alongX = Math.abs(f.z) >= Math.abs(f.x);
  const hx = alongX ? lengthM / 2 : thickM / 2;
  const hz = alongX ? thickM / 2 : lengthM / 2;
  return aabb(c.x - hx, c.y, c.z - hz, c.x + hx, c.y + heightM, c.z + hz);
}

/** Событие cast: каст принят (замах или мгновенный). */
export function emitCast(t: TickCtx, u: Unit, ability: AbilityId, slot: Slot, aim: { eye: Vec3; dir: Vec3 }): void {
  t.ev.push({ type: "cast", unit: u.id, ability, slot, pos: { x: aim.eye.x, y: aim.eye.y, z: aim.eye.z }, dir: { x: aim.dir.x, y: aim.dir.y, z: aim.dir.z } });
}

/** Событие reject: нажатие отклонено. */
export function rejectCast(t: TickCtx, u: Unit, slot: Slot, reason: RejectReason): void {
  t.ev.push({ type: "reject", unit: u.id, slot, reason });
}
