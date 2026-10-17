/**
 * Фиксированный шаг симуляции при любой частоте кадров: копим время кадра, отдаём целые тики,
 * остаток — доля alpha для интерполяции между двумя последними состояниями.
 */
export interface ClockStep {
  ticks: number;
  acc: number;
  alpha: number;
}

/** Больше стольких тиков за кадр не делаем: после зависания не догоняем, иначе «спираль смерти». */
export const MAX_TICKS_PER_FRAME = 5;

export function advanceClock(acc: number, frameS: number, tickS: number, maxTicks = MAX_TICKS_PER_FRAME): ClockStep {
  // NaN от сбойного таймера навсегда отравил бы накопитель: такой кадр считаем нулевым
  let a = acc + (Number.isNaN(frameS) ? 0 : Math.max(0, frameS));
  let ticks = Math.floor(a / tickS + 1e-9);
  a -= ticks * tickS;
  if (ticks > maxTicks) {
    ticks = maxTicks;
    a = 0;
  }
  if (a < 0) a = 0;
  return { ticks, acc: a, alpha: a / tickS };
}
