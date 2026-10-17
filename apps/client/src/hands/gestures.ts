import type { AbilityId } from "@doodlemagic/sim";

/** Добавка к позе покоя одной руки в пространстве камеры рук: сдвиг, м, и наклон кисти (rotation.x), рад. */
export interface HandOffset {
  x: number;
  y: number;
  z: number;
  pitch: number;
}
export interface HandGesture {
  right: HandOffset;
  left: HandOffset;
}
/** Идущие жесты (t — сколько секунд идёт) и рука следующего удара кулаком. */
export interface GestureState {
  active: { ability: AbilityId; hand: "left" | "right" | "both"; t: number }[];
  nextFist: "left" | "right";
}

/** [x, y, z, pitch] — смещение и наклон руки в ключевой позе. */
type Off = readonly [number, number, number, number];
/** Ключевая поза: время с начала жеста, правая рука, левая. У одноручных жестов левая — в покое. */
interface Key {
  t: number;
  r: Off;
  l: Off;
}
interface GestureDef {
  durS: number;
  /** Кто ведёт жест: обе руки, правая или та, чья очередь бить кулаком. */
  hand: "both" | "right" | "fist";
  keys: readonly Key[];
}

const O: Off = [0, 0, 0, 0];
const both = (t: number, o: Off): Key => ({ t, r: o, l: o });
const right = (t: number, o: Off): Key => ({ t, r: o, l: O });

/**
 * Жесты способностей (round1/03 п. 5, round2/03 п. 4.2, GDD 4.3–4.4): ключевые позы из таблицы задачи, между ними
 * smoothstep. Наклон кисти — решение потока H (в таблице не задан): удар и толчок ведут верхом вперёд (< 0),
 * замах и подъём откидывают кисть к себе (> 0). Последняя поза каждого жеста — покой.
 */
const GESTURES: Readonly<Record<AbilityId, GestureDef>> = {
  // огонь: короткие резкие удары с костяшек, руки по очереди
  fireFists: { durS: 0.22, hand: "fist", keys: [right(0, O), right(0.05, [0, 0, -0.12, -0.2]), right(0.2, O)] },
  // ладони сводятся 0,25 с, шар растёт между ними, толчок обеими
  fireball: {
    durS: 0.6,
    hand: "both",
    keys: [
      both(0, O),
      { t: 0.25, r: [-0.2, 0.05, 0, 0.15], l: [0.2, 0.05, 0, 0.15] },
      { t: 0.32, r: [-0.2, 0.05, -0.15, -0.25], l: [0.2, 0.05, -0.15, -0.25] },
      both(0.6, O),
    ],
  },
  // руки уходят назад и вниз: пламя бьёт из-за спины
  jetDash: { durS: 0.4, hand: "both", keys: [both(0, O), both(0.1, [0, -0.08, 0.1, 0.25]), both(0.4, O)] },
  // правая — взмах поперёк: стена встаёт по линии взмаха
  fireWall: { durS: 0.55, hand: "right", keys: [right(0, O), right(0.08, [0.1, 0, 0, 0]), right(0.3, [-0.25, 0, 0, -0.2]), right(0.55, O)] },
  // земля: правая зачерпывает камень снизу, поднимает и бросает
  stoneShot: {
    durS: 0.5,
    hand: "right",
    keys: [right(0, O), right(0.1, [0, -0.12, 0, 0.2]), right(0.2, [0, 0.05, 0, 0.1]), right(0.26, [0, 0.05, -0.1, -0.25]), right(0.5, O)],
  },
  // удар ладонями вниз и держат, пока столб не вырвется
  stonePillar: { durS: 0.6, hand: "both", keys: [both(0, O), both(0.12, [0, -0.15, 0, -0.4]), both(0.3, [0, -0.15, 0, -0.4]), both(0.6, O)] },
  // обе вниз, затем вверх: стена растёт следом за ладонями
  stoneWall: { durS: 0.6, hand: "both", keys: [both(0, O), both(0.1, [0, -0.1, 0, -0.3]), both(0.28, [0, 0.12, 0, 0.25]), both(0.6, O)] },
  // долгий замах вверх 0,4 с и тяжёлый удар вниз
  earthquake: { durS: 0.8, hand: "both", keys: [both(0, O), both(0.4, [0, 0.08, 0, 0.2]), both(0.46, [0, -0.18, 0, -0.35]), both(0.8, O)] },
};

/** Больше жестов разом не бывает: кулаки 5 раз/с × 0,22 с — два; остальное ждёт перезарядки. */
const MAX_ACTIVE = 8;

export function createGestures(): GestureState {
  return { active: [], nextFist: "right" };
}

/** Начать жест способности; кулак бьёт рукой nextFist, и очередь переходит к другой руке. */
export function startGesture(g: GestureState, a: AbilityId): GestureState {
  const def = GESTURES[a];
  const hand = def.hand === "fist" ? g.nextFist : def.hand;
  const nextFist = def.hand === "fist" ? (g.nextFist === "right" ? "left" : "right") : g.nextFist;
  return { active: [...g.active, { ability: a, hand, t: 0 }].slice(-MAX_ACTIVE), nextFist };
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/** Поза жеста в момент t: между соседними ключами — smoothstep. */
function sample(keys: readonly Key[], t: number, side: "r" | "l"): Off {
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last[side];
  for (let k = 1; k < keys.length; k++) {
    const b = keys[k]!;
    if (t > b.t) continue;
    const a = keys[k - 1]!;
    const s = smooth(b.t > a.t ? Math.max(0, (t - a.t) / (b.t - a.t)) : 1);
    const pa = a[side];
    const pb = b[side];
    return [pa[0] + (pb[0] - pa[0]) * s, pa[1] + (pb[1] - pa[1]) * s, pa[2] + (pb[2] - pa[2]) * s, pa[3] + (pb[3] - pa[3]) * s];
  }
  return last[side];
}

const zero = (): HandOffset => ({ x: 0, y: 0, z: 0, pitch: 0 });
function addTo(h: HandOffset, o: Off, mirror: boolean): void {
  h.x += mirror ? -o[0] : o[0];
  h.y += o[1];
  h.z += o[2];
  h.pitch += o[3];
}

/**
 * Шаг на dt секунд: жесты стареют, отыгравшие durS снимаются, поза — сумма идущих. Поза — функция времени жеста,
 * а не накопленных шагов: при 30, 60 и 144 Гц одинакова. hand — рука последнего удара кулаком (для palm: "auto").
 */
export function stepGestures(g: GestureState, dt: number): { state: GestureState; pose: HandGesture; hand: "left" | "right" } {
  const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const active = g.active.map((a) => ({ ...a, t: a.t + h })).filter((a) => a.t < GESTURES[a.ability].durS);
  const pose: HandGesture = { right: zero(), left: zero() };
  for (const a of active) {
    const keys = GESTURES[a.ability].keys;
    // одноручный жест левой рукой — зеркало правого по x
    if (a.hand === "left") addTo(pose.left, sample(keys, a.t, "r"), true);
    else {
      addTo(pose.right, sample(keys, a.t, "r"), false);
      if (a.hand === "both") addTo(pose.left, sample(keys, a.t, "l"), false);
    }
  }
  return { state: { active, nextFist: g.nextFist }, pose, hand: g.nextFist === "right" ? "left" : "right" };
}
