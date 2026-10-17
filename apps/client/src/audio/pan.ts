import { forwardXZ, type Vec3 } from "@doodlemagic/sim";

/** Затухание с расстоянием: gain = 1 / (1 + k·d). На 10 м звук вдвое тише, чем у уха. */
export const DISTANCE_ROLLOFF = 0.15;

export interface Spatial {
  /** −1 слева … 1 справа: синус угла от взгляда до источника. */
  pan: number;
  gain: number;
  /** Источник за спиной: StereoPanner перед и зад не различает, синтезатор режет ему верх. */
  behind: boolean;
}

/** Где источник относительно слушателя. pos null — звук у самого слушателя (свой каст, интерфейс). */
export function spatial(listener: { pos: Vec3; yaw: number }, pos: Vec3 | null): Spatial {
  if (!pos) return { pan: 0, gain: 1, behind: false };
  const dx = pos.x - listener.pos.x;
  const dy = pos.y - listener.pos.y;
  const dz = pos.z - listener.pos.z;
  const d = Math.hypot(dx, dy, dz);
  const flat = Math.hypot(dx, dz);
  const f = forwardXZ(listener.yaw);
  // правая рука — взгляд × вверх: (−f.z, f.x)
  const pan = flat > 1e-6 ? clamp((dx * -f.z + dz * f.x) / flat, -1, 1) : 0;
  const behind = dx * f.x + dz * f.z < 0;
  return { pan, gain: 1 / (1 + DISTANCE_ROLLOFF * d), behind };
}

/**
 * Не чаще perS раз в секунду: true — можно играть. Окно отсчитывается от последнего пропущенного вызова,
 * поэтому шквал вызовов даёт ровный ритм, а не пачку в начале каждой секунды.
 */
export function createRateLimiter(perS: number): (tS: number) => boolean {
  const gap = 1 / perS;
  let last = Number.NEGATIVE_INFINITY;
  return (tS) => {
    if (tS - last < gap - 1e-9) return false;
    last = tS;
    return true;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
