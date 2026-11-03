import type { MatchState, UnitId } from "@doodlemagic/sim";
import type { Effect } from "./effects";

/**
 * Камера с «телом» и звуки движения (round3/01, M1 и M2). Только картинка и звук у себя: симуляция не меняется.
 */

/**
 * Ступенька (M1): на полу и в прошлом, и в этом тике высота глаз изменилась не больше чем на 0,55 м — это ступень
 * лестницы или край плиты. Камера не прыгает на 0,4 м за тик, а догоняет: смещение −Δy гаснет с τ 0,07 с.
 */
export const EYE_STEP = { maxM: 0.55, tauS: 0.07 } as const;

export interface EyeSmooth {
  /** Высота глаз по симуляции в прошлом кадре; NaN — ещё не было кадра. */
  lastY: number;
  /** Смещение камеры по вертикали мира, м. */
  off: number;
}

export function createEyeSmooth(): EyeSmooth {
  return { lastY: Number.NaN, off: 0 };
}

/**
 * Шаг сглаживания ступеней: rawY — высота глаз по симуляции в этом кадре, grounded — маг на полу в обоих тиках
 * кадра. Возвращает сглаженную высоту. Прыжок, падение и возрождение (в воздухе или скачок больше 0,55 м)
 * камера показывает как есть.
 */
export function stepEyeSmooth(s: EyeSmooth, rawY: number, grounded: boolean, dt: number): { state: EyeSmooth; y: number } {
  if (!Number.isFinite(rawY)) return { state: s, y: rawY };
  const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const d = Number.isFinite(s.lastY) ? rawY - s.lastY : 0;
  let off = s.off;
  if (grounded && d !== 0 && Math.abs(d) <= EYE_STEP.maxM) off -= d;
  else if (Math.abs(d) > EYE_STEP.maxM) off = 0;
  off *= Math.exp(-h / EYE_STEP.tauS);
  if (off > EYE_STEP.maxM) off = EYE_STEP.maxM;
  else if (off < -EYE_STEP.maxM) off = -EYE_STEP.maxM;
  // `+ 0` убирает −0
  off = Math.abs(off) < 1e-6 ? 0 : off + 0;
  return { state: { lastY: rawY, off }, y: rawY + off };
}

/**
 * Звуки движения (M2): шаг каждые 1,1 м пути по полу при скорости больше 2 м/с; прыжок — «ткань»; приземление —
 * удар, громкость ∝ |скорость касания| / 12. Свои — у уха и тихо (шаг 0,2), чужие — в своей точке (0,5): врага
 * слышно за спиной. У чужих тяжёлых приземлений пыль из-под ног.
 */
export const MOVE_SOUND = {
  stepM: 1.1,
  minSpeed: 2,
  ownStep: 0.2,
  otherStep: 0.5,
  ownJump: 0.35,
  otherJump: 0.5,
  /** Скорость касания, при которой удар приземления в полную громкость, м/с. */
  fullLandSpeed: 12,
  /** Слабее — не приземление (появление на полу даёт ≈ −0,17 м/с). */
  minLandSpeed: 2,
  /** Чужое приземление тяжелее этого — пыль из-под ног. */
  dustLandSpeed: 9,
  /** Скорость вверх при отрыве, с которой это прыжок, а не сход с края. */
  jumpVy: 1,
  /** Скачок дальше этого за тик — телепорт (возрождение, снапшот сети): путь не считаем. */
  teleportM: 2,
} as const;

interface Walker {
  x: number;
  y: number;
  z: number;
  vy: number;
  ground: boolean;
  dist: number;
  seen: number;
}

export interface MoveTracker {
  walkers: Map<UnitId, Walker>;
  gen: number;
}

export function createMoveTracker(): MoveTracker {
  return { walkers: new Map(), gen: 0 };
}

/**
 * Тик состояния → звуки движения всех живых магов. emit получает эффекты (sound, burst); объекты эффектов
 * рождаются только на шагах, прыжках и приземлениях. Ушедшие из состояния маги забываются.
 */
export function trackMovement(t: MoveTracker, state: MatchState, localId: UnitId, emit: (e: Effect) => void): void {
  const gen = ++t.gen;
  for (const u of state.units) {
    if (!u.mage || !u.alive) continue;
    const b = u.move.body;
    const ground = u.move.onGround;
    let w = t.walkers.get(u.id);
    if (!w) {
      t.walkers.set(u.id, { x: b.pos.x, y: b.pos.y, z: b.pos.z, vy: b.vel.y, ground, dist: 0, seen: gen });
      continue;
    }
    const own = u.id === localId;
    const d = Math.hypot(b.pos.x - w.x, b.pos.z - w.z);
    const jumpTo = Math.abs(b.pos.y - w.y);
    if (d > MOVE_SOUND.teleportM || jumpTo > MOVE_SOUND.teleportM) {
      // возрождение или скачок снапшота: ни шага, ни приземления
      w.dist = 0;
    } else {
      const speed = Math.hypot(b.vel.x, b.vel.z);
      if (ground && w.ground && speed > MOVE_SOUND.minSpeed) {
        w.dist += d;
        if (w.dist >= MOVE_SOUND.stepM) {
          w.dist %= MOVE_SOUND.stepM;
          emit({ kind: "sound", id: "step", pos: own ? null : { ...b.pos }, gain: own ? MOVE_SOUND.ownStep : MOVE_SOUND.otherStep });
        }
      } else if (!ground) w.dist = MOVE_SOUND.stepM / 2; // первый шаг после приземления — через полшага
      if (w.ground && !ground && b.vel.y > MOVE_SOUND.jumpVy)
        emit({ kind: "sound", id: "jump", pos: own ? null : { ...b.pos }, gain: own ? MOVE_SOUND.ownJump : MOVE_SOUND.otherJump });
      if (!w.ground && ground) {
        // скорость касания: из симуляции, а у чужих в сети её может не быть — тогда последняя скорость в воздухе
        const v = Math.abs(Math.min(u.move.landVel, w.vy));
        if (v >= MOVE_SOUND.minLandSpeed) {
          emit({ kind: "sound", id: "land", pos: own ? null : { ...b.pos }, gain: Math.min(1, v / MOVE_SOUND.fullLandSpeed) });
          if (!own && v >= MOVE_SOUND.dustLandSpeed) emit({ kind: "burst", preset: "landDust", pos: { ...b.pos }, dir: { x: 0, y: 1, z: 0 }, scale: 1 });
        }
      }
    }
    w.x = b.pos.x;
    w.y = b.pos.y;
    w.z = b.pos.z;
    w.vy = b.vel.y;
    w.ground = ground;
    w.seen = gen;
  }
  for (const [id, w] of t.walkers) if (w.seen !== gen) t.walkers.delete(id);
}
