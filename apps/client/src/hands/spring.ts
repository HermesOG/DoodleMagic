/**
 * Критически задемпфированная пружина, точное решение за шаг dt: не раскачивается и устойчива при любом dt.
 * omega — «жёсткость», рад/с: чем больше, тем быстрее догоняет цель.
 */
export interface Spring {
  x: number;
  v: number;
}

export function stepSpring(s: Spring, target: number, omega: number, dt: number): Spring {
  const d = s.x - target;
  const e = Math.exp(-omega * dt);
  const k = (s.v + omega * d) * dt;
  return { x: target + (d + k) * e, v: (s.v - omega * k) * e };
}
