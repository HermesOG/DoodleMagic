/**
 * Вектор как простые данные: состояние без потерь уходит в JSON и по сети.
 *
 * Детерминизм симуляции — в пределах одного JS-движка: stepPlayer — чистая функция (state, input, world),
 * и одинаковые аргументы дают одинаковый до бита результат. Между движками (хост и браузер клиента) возможна
 * разница в несколько ulp: Math.sin и Math.cos не обязаны быть округлены одинаково. Её гасит согласование —
 * хост авторитетен, клиент сверяет предсказание со снапшотом с допуском.
 * Здесь всё равно только операции с точным округлением (+, −, ×, /, sqrt), чтобы не добавлять расхождений сверх
 * этих: Math.hypot не используем — его точность в разных движках разная.
 */
import type { Axis, Vec3 } from "./types";

export const AXES: readonly Axis[] = ["x", "y", "z"];

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const cloneVec = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const lengthXZ = (a: Vec3): number => Math.sqrt(a.x * a.x + a.z * a.z);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : vec3();
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
