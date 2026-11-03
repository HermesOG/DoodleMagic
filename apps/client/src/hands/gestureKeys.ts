/*
 * Лист-модуль жестов: ключевые позы и помощники. Его берут и общая таблица (gestures.ts), и жесты стихий
 * (airGestures.ts, waterGestures.ts) — без цикла импортов между ними.
 */

/** [x, y, z, pitch] — смещение и наклон руки в ключевой позе. */
export type Off = readonly [number, number, number, number];
/** Ключевая поза: время с начала жеста, правая рука, левая. У одноручных жестов левая — в покое. */
export interface Key {
  t: number;
  r: Off;
  l: Off;
}
export interface GestureDef {
  durS: number;
  /** Кто ведёт жест: обе руки, правая или та, чья очередь бить кулаком. */
  hand: "both" | "right" | "fist";
  keys: readonly Key[];
}

export const O: Off = [0, 0, 0, 0];
export const both = (t: number, o: Off): Key => ({ t, r: o, l: o });
export const right = (t: number, o: Off): Key => ({ t, r: o, l: O });
