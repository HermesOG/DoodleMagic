import {
  FIRE, MAGE_REGEN, PICKUPS, TICK_HZ, ULT_CHARGE, hasFury, slotCooldownTicks, unitById,
  type MageState, type MatchState, type Slot, type Unit, type UnitId, type Vec3,
} from "@doodlemagic/sim";

/** Цифра урона: целое, не меньше 1; воздушное попадание (+15 %, GDD 4.6) — со стрелкой вверх. */
export function formatDamage(n: number, air: boolean): string {
  return `${Math.max(1, Math.round(Number.isFinite(n) ? n : 0))}${air ? "↑" : ""}`;
}

/**
 * Всплывающая цифра урона: born — появилась, updated — последний раз к ней прибавили урон, с. lmb — попадания ЛКМ
 * (копятся в одну цифру, L7).
 */
export interface FloatingNumber {
  target: UnitId;
  amount: number;
  dot: boolean;
  air: boolean;
  lmb: boolean;
  pos: Vec3;
  born: number;
  updated: number;
}

/**
 * Окно слияния урона по времени: импульс не позже 0,6 с после прошлого — одна растущая цифра (round2/03, п. 7).
 * Горение и след рывка бьют раз в 0,5 с (Р10): их импульсы складываются.
 */
export const DOT_MERGE_S = 0.6;
/**
 * Окно накопления ЛКМ (фаза 9, L7): попадание по той же цели не позже 0,6 с после прошлого прибавляется к его цифре
 * с подскоком — кулаки 4/с читаются потоком «15 → 30 → 45», а не роем одинаковых цифр.
 */
export const LMB_MERGE_S = 0.6;

/**
 * Новая цифра. Урон по времени прибавляется к последней цифре урона по времени той же цели, попадание ЛКМ — к
 * последней цифре ЛКМ той же цели, если она свежая (DOT_MERGE_S, LMB_MERGE_S); прочие удары — всегда своя цифра.
 * Слитая цифра переезжает к точке нового импульса: она идёт за целью (подброшенной, патрулирующей), а не висит
 * там, где был первый; скачок прячет подскок цифры при прибавке.
 */
export function mergeNumbers(
  list: FloatingNumber[],
  e: { target: UnitId; amount: number; dot: boolean; air: boolean; pos: Vec3; lmb?: boolean },
  nowS: number,
): FloatingNumber[] {
  const lmb = !e.dot && e.lmb === true;
  if (e.dot || lmb) {
    const windowS = e.dot ? DOT_MERGE_S : LMB_MERGE_S;
    for (let k = list.length - 1; k >= 0; k--) {
      const n = list[k]!;
      if (n.dot !== e.dot || n.lmb !== lmb || n.target !== e.target) continue;
      if (nowS - n.updated > windowS) break;
      const merged: FloatingNumber = { ...n, amount: n.amount + e.amount, air: n.air || e.air, pos: { ...e.pos }, updated: nowS };
      return [...list.slice(0, k), merged, ...list.slice(k + 1)];
    }
  }
  return [...list, { target: e.target, amount: e.amount, dot: e.dot, air: e.air, lmb, pos: { ...e.pos }, born: nowS, updated: nowS }];
}

/** Базовый кегль цифры урона, px (как .ch-num в combatHud.css). */
export const NUMBER_PX = 23;
/** Кегль цифры прямого удара (фаза 9, L7): 23 + min(11, урон / 6) px — накопленная цифра растёт до 34 px. */
export function numberPx(amount: number): number {
  return NUMBER_PX + Math.min(11, Math.max(0, Number.isFinite(amount) ? amount : 0) / 6);
}

/** Сколько живёт цифра, с: к этому возрасту она погасла. */
export const NUMBER_LIFE_S = 0.9;

/** Анимация цифры по возрасту: подскок 1,4 → 1 за 0,12 с, подъём 0,6 м за 0,8 с, видна до 0,5 с, гаснет к 0,9 с. */
export function numberAnim(ageS: number): { dy: number; scale: number; alpha: number } {
  const a = Number.isFinite(ageS) ? Math.max(0, ageS) : 0;
  const pop = 1 - Math.min(1, a / 0.12);
  return {
    dy: 0.6 * Math.min(1, a / 0.8),
    scale: 1 + 0.4 * pop * pop,
    alpha: a <= 0.5 ? 1 : Math.max(0, 1 - (a - 0.5) / (NUMBER_LIFE_S - 0.5)),
  };
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Сколько перезарядки слота осталось, 0…1 (now — тик): 1 — только что, 0 — готов. */
export function cooldownFraction(m: MageState, slot: Slot, now: number): number {
  return clamp01((m.ready[slot] - now) / slotCooldownTicks(m.element, slot));
}

/** Доля заряда ульты 0…1 для кольца X. */
export function ultFraction(m: MageState): number {
  return clamp01(m.ult.charge / ULT_CHARGE.max);
}

/** Заряд ульты целым числом процентов 0…100, вниз: «100%» — только полная (73,4 → 73). */
export function ultPercent(m: MageState): number {
  const c = m.ult.charge;
  return Number.isFinite(c) ? Math.floor(Math.min(ULT_CHARGE.max, Math.max(0, c))) : 0;
}

/** Жар Огня 0…1. */
export function heatFraction(m: MageState): number {
  return clamp01(m.heat / FIRE.heat.max);
}

/** Полоса HP: доля, засечка, до которой маг лечится сам (⅔, GDD 3), и «hp / max». */
export function hpBar(u: Unit): { frac: number; notch: number; text: string } {
  // HP бывает дробным (лечение 20/с по тикам, +15 % в воздухе): живому не показываем 0
  const hp = Math.max(0, Math.ceil(u.hp - 1e-9));
  return { frac: clamp01(u.hp / u.maxHp), notch: u.kind === "mage" ? MAGE_REGEN.capFrac : 1, text: `${hp} / ${u.maxHp}` };
}

/**
 * «Откушенный кусок» полосы HP цели (фаза 9, L4): след урона цвета бумаги держится 0,3 с и сходит за 0,25 с;
 * полоса вздрагивает на ±2 px за 80 мс. Подтверждение там, куда смотрит глаз, — на цели.
 */
export const BITE = { holdS: 0.3, fadeS: 0.25, shakeS: 0.08, shakePx: 2 } as const;
/** След полосы: frac — доля HP сейчас, from — откуда сходит след, at — когда откусили (−∞ — не было). */
export interface HpBite {
  frac: number;
  from: number;
  at: number;
}
export const freshBite = (frac: number): HpBite => ({ frac, from: frac, at: -Infinity });

/** Где край следа в момент nowS: держится на from, потом сходит к frac. */
export function biteTrail(b: HpBite, nowS: number): number {
  const age = nowS - b.at;
  if (!(age >= 0) || age >= BITE.holdS + BITE.fadeS) return b.frac;
  if (age < BITE.holdS) return b.from;
  return b.from + (b.frac - b.from) * ((age - BITE.holdS) / BITE.fadeS);
}

/**
 * Новая доля HP. Урон — след от того места, где он виден сейчас (несколько попаданий подряд — один длинный кусок,
 * держится от последнего), и вздрагивание заново. Лечение и возрождение — без нового следа: прежний не ниже заливки.
 */
export function stepBite(b: HpBite, frac: number, nowS: number): HpBite {
  if (frac < b.frac - 1e-6) return { frac, from: Math.max(biteTrail(b, nowS), b.frac), at: nowS };
  if (frac === b.frac) return b;
  return { frac, from: Math.max(b.from, frac), at: b.at };
}

/** Сдвиг полосы по x, px, через ageS после укуса: ±2 px, затухает к 80 мс (два качания); вне окна — 0. */
export function biteShake(ageS: number): number {
  if (!(ageS >= 0 && ageS < BITE.shakeS)) return 0;
  const u = ageS / BITE.shakeS;
  return BITE.shakePx * Math.cos(u * 4 * Math.PI) * (1 - u);
}

/** Руна ярости (фаза 6): объявление — последние 10 с до появления; «в центре» — первые 3 с, пока лежит. */
const RUNE_WARN_TICKS = PICKUPS.rune.warnS * TICK_HZ;
const RUNE_HERE_TICKS = 3 * TICK_HZ;
/** Имя носителя, которого нет в составе (или имён нет — полигон): род. падеж, без родовых окончаний. */
const NAMELESS_HOLDER = "мага";
/** Тики → целые секунды вверх. */
const secondsUp = (ticks: number): number => Math.ceil(ticks / TICK_HZ);

/**
 * Что объявляет строка руны: soon — руны нет, до появления s секунд (вверх); here — появилась и лежит; held — ярость
 * у чужого мага id, осталось s секунд.
 */
export type RuneCue = { kind: "soon"; s: number } | { kind: "here" } | { kind: "held"; id: UnitId; s: number };

/**
 * Строка руны по состоянию на тике now. Сначала сама руна — она для всей арены: до появления ≤ 10 с — soon, появилась
 * ≤ 3 с назад и лежит — here (взятая ушла на следующую отметку, Р2). Иначе — чужой носитель (самая свежая ярость,
 * при равенстве — меньший id); своя ярость — не здесь, а у полосы HP. Нечего сказать — null.
 */
export function runeCue(s: Readonly<MatchState>, localId: UnitId, now: number): RuneCue | null {
  for (const p of s.pickups) {
    if (p.kind !== "rune") continue;
    const left = p.readyAt - now;
    if (left > 0 && left <= RUNE_WARN_TICKS) return { kind: "soon", s: secondsUp(left) };
    if (left <= 0 && -left <= RUNE_HERE_TICKS) return { kind: "here" };
  }
  let holder: Unit | undefined;
  for (const u of s.units) {
    if (u.id === localId || !u.mage || !hasFury(u, now)) continue;
    if (!holder || u.status.furyUntil > holder.status.furyUntil) holder = u;
  }
  return holder ? { kind: "held", id: holder.id, s: secondsUp(holder.status.furyUntil - now) } : null;
}

/** Текст строки руны; имя носителя — из names, нет — «мага». */
export function runeText(c: RuneCue, names?: ReadonlyMap<UnitId, string>): string {
  if (c.kind === "soon") return `Руна ярости через ${c.s}`;
  if (c.kind === "here") return "Руна ярости в центре";
  return `Руна у ${names?.get(c.id) ?? NAMELESS_HOLDER} · ${c.s}`;
}

/**
 * Строка объявления руны по состоянию: руны нет и до появления ≤ 10 с — «Руна ярости через N» (N — секунды вверх);
 * появилась ≤ 3 с назад и лежит — «Руна ярости в центре»; лежит дольше — null; у чужого носителя — «Руна у {имя} · N»;
 * у меня — null (своё — у полосы HP). names нет или имени нет — «мага».
 */
export function runeNotice(s: Readonly<MatchState>, localId: UnitId, now: number, names?: ReadonlyMap<UnitId, string>): string | null {
  const c = runeCue(s, localId, now);
  return c ? runeText(c, names) : null;
}

/** Своя ярость: секунды вверх, 0 — нет. */
export function furyLeftS(s: Readonly<MatchState>, localId: UnitId, now: number): number {
  const me = unitById(s, localId);
  return me && hasFury(me, now) ? secondsUp(me.status.furyUntil - now) : 0;
}
