import { aabb } from "../aabb";
import { forwardXZ, sanitizeInput } from "../player";
import type { AABB, Vec3 } from "../types";
import { PRESS_BUFFER_S, ticks } from "./defs";
import { aimDir, eyeOf } from "./state";
import { NEVER, SLOTS, type AbilityId, type Buttons, type MatchInput, type MatchState, type RejectReason, type Slot, type TickCtx, type Unit } from "./types";

/**
 * Кит стихии: как маг кастует. stepMatch зовёт input раз в тик для каждого живого мага (pressed — фронты кнопок,
 * inp — уже очищенный ввод с удержанием), затем tick для каждого живого мага — до движения юнитов.
 * Киты меняют состояние на месте (stepMatch отдаёт им свою копию) и пишут события в t.ev.
 * Нажатия слотов киты разбирают через castSlots: он держит буфер нажатий и решает, когда слать reject.
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

/**
 * Попытка каста слота: null — каст принят (кит уже записал cast и поставил перезарядку), иначе причина отказа.
 * Событие reject пишет не она, а castSlots.
 */
export type TryCast = (s: MatchState, t: TickCtx, u: Unit, inp: MatchInput) => RejectReason | null;

/** Сколько тиков после нажатия оно ждёт в буфере: 0,3 с → 18. */
export const PRESS_BUFFER_TICKS = ticks(PRESS_BUFFER_S);
/** Эти отказы снимет само время: нажатие с ними ждёт в буфере. Остальные (нет опоры, цели, обездвижен) — сразу. */
const waits = (r: RejectReason): boolean => r === "cooldown" || r === "busy";

/**
 * Нажатия тика по слотам в порядке SLOTS (ЛКМ, Q, E, C). Слот пробует каст, если его кнопку нажали на этом тике,
 * если прежнее нажатие ещё ждёт в буфере, а ЛКМ — и пока она удержана (темп карточки, как раньше).
 * - Отказ «перезарядка» или «замах» держит нажатие в буфере до PRESS_BUFFER_TICKS тиков после него: каст выходит
 *   на первом тике, когда он возможен, а reject — один, на последнем тике окна, если каст так и не вышел.
 * - Прочие отказы — reject сразу, нажатие из буфера уходит.
 * - ЛКМ на перезарядке не отказывает никогда: просто стреляет, когда готова. Удержание ЛКМ без нажатия молчит.
 * - Новое нажатие того же слота начинает окно заново; за тик слот пробует каст не больше одного раза.
 * Окно как у буфера прыжка: нажатие за 18 тиков до готовности ещё срабатывает, за 19 — уже нет.
 */
export function castSlots(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, pressed: Buttons, casts: Readonly<Record<Slot, TryCast>>): void {
  const m = u.mage!;
  const now = t.now;
  for (const slot of SLOTS) {
    if (pressed[slot]) m.pending[slot] = now;
    const age = now - m.pending[slot];
    const waiting = age <= PRESS_BUFFER_TICKS;
    if (!waiting && !(slot === "primary" && inp.primary)) continue;
    const r = casts[slot](s, t, u, inp);
    if (r === null) m.pending[slot] = NEVER;
    if (r === null || !waiting || (waits(r) && age < PRESS_BUFFER_TICKS)) continue;
    m.pending[slot] = NEVER;
    if (slot !== "primary" || r !== "cooldown") rejectCast(t, u, slot, r);
  }
}
