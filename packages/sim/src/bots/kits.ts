import { ULT_CHARGE } from "../match/defs";
import { AIR, EARTH, FIRE, WATER } from "../match/defs";
import type { Element, Unit } from "../match/types";
import type { Vec3 } from "../types";
import type { BotParams } from "./params";
import type { BotView, CastPlan, Perceived } from "./sense";

/**
 * Характер стихии для мозга бота (Р6). Задача 1 — заглушка: рабочая полоса, ЛКМ по карточке и X «враг в дальности»
 * (Р5, как у Ученика). Задача 2 вставляет сюда условия Q/E/C/X, постановку под сброс и спасение над пустотой.
 */

/** ЛКМ для прицела: скорость и гравитация снаряда, дальность; мгновенный удар (хлыст) бьёт через windupS по взгляду. */
export interface BotPrimary {
  readonly speed: number;
  readonly gravity: number;
  readonly rangeM: number;
  readonly windupS: number;
  readonly instant: boolean;
}

export interface BotKit {
  /** Рабочая полоса до цели, м (Р6). */
  readonly bandM: readonly [number, number];
  readonly primary: BotPrimary;
  /** Ульта «в дальности», м. */
  readonly ultRangeM: number;
  /** Прибавка к оценке цели у кромки (Р7: Воздуху, Воде, Огню +2, Земле +1). */
  readonly edgeBonus: number;
  /** Держать ЛКМ сверх общего правила (видна, в дальности, взгляд у точки): у Огня — пока жар ниже предела уровня. */
  holdPrimary(self: Readonly<Unit>, params: Readonly<BotParams>, target: Perceived | null, now: number): boolean;
  /** Решение на мысли: план Q/E/C/X или null. Зовётся, пока нет своего плана. */
  decide(v: BotView, rand: () => number): CastPlan | null;
  /** задача 2: куда встать в бою вместо середины полосы (заход для Порыва, постановка под сброс); null — по полосе. */
  stance?(v: BotView): Vec3 | null;
  /** задача 2: над пустотой в полёте (мозг зовёт каждый тик) — спасение (рывок к полу, Взмах, второй прыжок); null — править полёт. */
  rescue?(v: BotView, rand: () => number): CastPlan | null;
}

const always = (): boolean => true;
/** Грудь цели над подошвой — точка прицела ульты. */
const CHEST_M = 1.2;

/** X «враг в дальности»: заряд полный, цель видна и ближе rangeM. Взгляд — на грудь цели (за ней ведётся). */
function ultInRange(rangeM: number): (v: BotView) => CastPlan | null {
  return (v) => {
    const m = v.self.mage;
    const t = v.target;
    if (!m || m.ult.charge < ULT_CHARGE.max || m.ult.cast || !t || !t.visible || t.dist > rangeM) return null;
    return { slot: "x", aim: { x: t.pos.x, y: t.pos.y + CHEST_M, z: t.pos.z }, track: { id: t.id, dy: CHEST_M }, urgent: true };
  };
}

const FF = FIRE.fireFists.projectile;
const SS = EARTH.stoneShot.projectile;
const SK = AIR.airSickle.projectile;

export const BOT_KITS: Readonly<Record<Element, BotKit>> = Object.freeze({
  fire: Object.freeze<BotKit>({
    bandM: Object.freeze([6, 15] as const),
    primary: Object.freeze({ speed: FF.speed, gravity: FF.gravity, rangeM: FF.rangeM, windupS: 0, instant: false }),
    ultRangeM: FIRE.dragonBreath.rangeM - 1,
    edgeBonus: 2,
    // Ученик жмёт без оглядки на жар; остальные отпускают у предела (Р4)
    holdPrimary: (self, params) => params.heatCap === null || (self.mage?.heat ?? 0) < params.heatCap,
    decide: ultInRange(FIRE.dragonBreath.rangeM - 1), // задача 2: Q, E, C Огня (ГД 4)
  }),
  earth: Object.freeze<BotKit>({
    bandM: Object.freeze([12, 25] as const),
    primary: Object.freeze({ speed: SS.speed, gravity: SS.gravity, rangeM: SS.rangeM, windupS: EARTH.stoneShot.windupS, instant: false }),
    ultRangeM: EARTH.tectonicRift.lengthM - 1,
    edgeBonus: 1,
    holdPrimary: always,
    decide: ultInRange(EARTH.tectonicRift.lengthM - 1), // задача 2: Q, E, C Земли
  }),
  air: Object.freeze<BotKit>({
    bandM: Object.freeze([15, 30] as const),
    primary: Object.freeze({ speed: SK.speed, gravity: SK.gravity, rangeM: SK.rangeM, windupS: 0, instant: false }),
    ultRangeM: AIR.hurricane.radiusM - 1,
    edgeBonus: 2,
    holdPrimary: always,
    decide: ultInRange(AIR.hurricane.radiusM - 1), // задача 2: Q, E, C Воздуха
  }),
  water: Object.freeze<BotKit>({
    bandM: Object.freeze([8, 15] as const),
    primary: Object.freeze({ speed: Infinity, gravity: 0, rangeM: WATER.waterWhip.rangeM, windupS: WATER.waterWhip.windupS, instant: true }),
    ultRangeM: 20,
    edgeBonus: 2,
    holdPrimary: always,
    decide: ultInRange(20), // задача 2: Q, E, C Воды
  }),
});
