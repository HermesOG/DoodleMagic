import type { Element } from "../match/types";

/**
 * Числа ботов (фаза 8). Уровень меняет только восприятие, точность и решения (Р1): урон, HP и перезарядки — как у людей.
 * Секунды и градусы — как в таблице плана; в тики переводит мозг. Задача 2 правит здесь только числа.
 */

export type BotLevel = "novice" | "mage" | "archmage";
export const BOT_LEVELS: readonly BotLevel[] = Object.freeze(["novice", "mage", "archmage"]);
export const BOT_LEVEL_NAME: Readonly<Record<BotLevel, string>> = Object.freeze({ novice: "Ученик", mage: "Маг", archmage: "Архимаг" });
export const BOT_LEVEL_HINT: Readonly<Record<BotLevel, string>> = Object.freeze({
  novice: "Часто мажет, учится с тобой",
  mage: "Бьётся всерьёз, но ошибается",
  archmage: "Как сильный игрок, без поблажек",
});

/** Характер (Р11): «Задира», «Осторожный», «Охотник за руной». Бросается из PRNG при создании. */
export type BotTrait = "bully" | "careful" | "runeHunter";
export const BOT_TRAITS: readonly BotTrait[] = Object.freeze(["bully", "careful", "runeHunter"]);

/** Когда бот идёт к руне (Р12): ближе runeNearM, когда лежит, с объявления. */
export type BotRuneRule = "near" | "present" | "warn";
/** Когда жмёт ульту (Р5): враг в дальности; 2+ цели или цель < 50 % HP; как Маг, но ждёт верного до ultWaitS. */
export type BotUltRule = "inRange" | "twoOrHurt" | "patient";

/** Числа уровня (Р4, Р5, Р8, Р12). */
export interface BotParams {
  /** Реакция (Р3): среднее и разброс (равномерно ±), мс; не меньше reactionMinMs. */
  reactionMs: number; reactionJitterMs: number; reactionMinMs: number;
  /** Мыслей в секунду (Р3). */
  thinkHz: number;
  /** Поворот взгляда: предел °/с и разгон °/с² (180° у Архимага не быстрее 0,35 с). */
  turnDegS: number; turnAccelDegS2: number;
  /** Ошибка прицела σ, градусы: медленный дрейф (новая цель дрейфа раз в aimDriftS), ×aimMoveMul на бегу, ×aimNewTargetMul первые aimNewTargetS на новой цели. */
  aimSigmaDeg: number; aimDriftS: number; aimMoveMul: number; aimNewTargetMul: number; aimNewTargetS: number;
  /**
   * Прицел по снимку «реакцию назад» (Р3, Р4): aimTrack — какую долю возраста снимка глаз «ведёт» цель по её скорости
   * (между сменами стороны прицел точен, смену бот видит только через реакцию); lead — упреждение: доля скорости цели
   * на время полёта снаряда.
   */
  aimTrack: number;
  lead: number;
  /** Шанс уйти (бросается раз на угрозу): от телеграфа (зоны, замахи, ульты) и от снаряда Q (шар, Хват, Ответ). */
  dodgeTelegraph: number; dodgeProjectile: number;
  /** Q/E/C через [от, до] с после условия. */
  castDelayS: readonly [number, number];
  /** E «в беде» (HP < 35 % под огнём или телеграф по боту) — шанс. */
  rescueChance: number;
  /** Лечиться (сфера, Родник) от этой доли HP. */
  healFrac: number;
  /** Память о пропавшем враге, с. */
  memoryS: number;
  /** Квота (Р8): ботов на одну цель и на одного человека. */
  maxPerTarget: number; maxPerHuman: number;
  /** Поблажка: человека после старта боя и возрождения не трогает столько секунд. */
  humanGraceS: number;
  /** «Антизадира»: убил одного человека 2 раза подряд — столько секунд ищет других (0 — нет). */
  antiBullyS: number;
  /** Руна (Р12). */
  rune: BotRuneRule; runeNearM: number;
  /** Шаг от края, если рядом враг с толчком (Р9). Ученик — нет. */
  edgeStepAway: boolean;
  /** Правит полёт после толчка только через реакцию (Ученик, Р9); остальные — сразу. */
  lateAirFix: boolean;
  /** Ульта (Р5). */
  ult: BotUltRule; ultWaitS: number;
  /** Не цепляет контроль цепочкой по подброшенному или обездвиженному (Р8). */
  noChainCc: boolean;
  /** Связки стихий (Р6): только Архимаг. */
  combos: boolean;
  /** Прыжок в бою: шанс на мысль. */
  combatJumpChance: number;
  /** Огонь: держит ЛКМ, пока жар ниже (null — без оглядки на жар). */
  heatCap: number | null;
}

export const BOT_PARAMS: Readonly<Record<BotLevel, Readonly<BotParams>>> = Object.freeze({
  novice: Object.freeze<BotParams>({
    reactionMs: 600, reactionJitterMs: 120, reactionMinMs: 200, thinkHz: 4, turnDegS: 150, turnAccelDegS2: 900,
    aimSigmaDeg: 4.5, aimDriftS: 0.4, aimMoveMul: 1.3, aimNewTargetMul: 2, aimNewTargetS: 0.6, aimTrack: 0.6, lead: 0,
    dodgeTelegraph: 0.25, dodgeProjectile: 0.15, castDelayS: Object.freeze([1, 3] as const), rescueChance: 0.3, healFrac: 0.25, memoryS: 2,
    maxPerTarget: 2, maxPerHuman: 1, humanGraceS: 8, antiBullyS: 20, rune: "near", runeNearM: 10, edgeStepAway: false, lateAirFix: true,
    ult: "inRange", ultWaitS: 0, noChainCc: true, combos: false, combatJumpChance: 0.03, heatCap: null,
  }),
  mage: Object.freeze<BotParams>({
    reactionMs: 400, reactionJitterMs: 70, reactionMinMs: 200, thinkHz: 6, turnDegS: 300, turnAccelDegS2: 2400,
    aimSigmaDeg: 2.5, aimDriftS: 0.4, aimMoveMul: 1.3, aimNewTargetMul: 2, aimNewTargetS: 0.6, aimTrack: 0.85, lead: 0.6,
    dodgeTelegraph: 0.5, dodgeProjectile: 0.35, castDelayS: Object.freeze([0.5, 1.5] as const), rescueChance: 0.7, healFrac: 0.4, memoryS: 4,
    maxPerTarget: 2, maxPerHuman: 2, humanGraceS: 3, antiBullyS: 20, rune: "present", runeNearM: 10, edgeStepAway: true, lateAirFix: false,
    ult: "twoOrHurt", ultWaitS: 0, noChainCc: true, combos: false, combatJumpChance: 0.06, heatCap: 85,
  }),
  archmage: Object.freeze<BotParams>({
    reactionMs: 250, reactionJitterMs: 40, reactionMinMs: 200, thinkHz: 10, turnDegS: 500, turnAccelDegS2: 5000,
    aimSigmaDeg: 1.5, aimDriftS: 0.4, aimMoveMul: 1.3, aimNewTargetMul: 2, aimNewTargetS: 0.6, aimTrack: 0.92, lead: 0.85,
    dodgeTelegraph: 0.7, dodgeProjectile: 0.55, castDelayS: Object.freeze([0.2, 0.6] as const), rescueChance: 0.95, healFrac: 0.45, memoryS: 6,
    maxPerTarget: 2, maxPerHuman: 2, humanGraceS: 0, antiBullyS: 0, rune: "warn", runeNearM: 10, edgeStepAway: true, lateAirFix: false,
    ult: "patient", ultWaitS: 20, noChainCc: false, combos: true, combatJumpChance: 0.1, heatCap: 85,
  }),
});

/** Общие числа мозга, не зависящие от уровня (Р2, Р7–Р12). */
export const BOT_RULES = Object.freeze({
  /** Зрение (Р2): конус 110° по взгляду или ближе nearSenseM; лучи — только до кандидатов ближе senseMaxM. */
  viewHalfDeg: 55, nearSenseM: 3.5, senseMaxM: 40,
  /** Слух (Р2): выстрел, замах, рывок — до hearM, точка ±hearNoiseM; ульта — на всей карте. */
  hearM: 25, hearNoiseM: 2,
  /** Попадание по боту дальше слуха: ошибка точки стрелка — такая доля дальности (Р2: только направление). */
  hitNoisePerM: 0.15,
  /** Сколько снимков мыслей держит память. */
  glimpses: 8,
  /** Цель (Р7): липкость, смена «в 1,3 раза лучше», «бил меня» за attackerS, «бьёт другой» за hitNowS. */
  stickS: 2.5, switchMul: 1.3, attackerS: 3, hitNowS: 1,
  /** Оценка цели (Р7). */
  scoreHitMe: 3, scoreLowHp: 2, lowHpFrac: 0.35, scoreFury: 2, scoreLeader: 1, leaderGap: 3, scoreEdgeM: 3, scorePerClaim: 1.5, scorePer10M: 1,
  /** Убивший — столько секунд ищет другую цель; возродившегося столько не трогают, если он сам не напал (Р8). */
  killAvoidS: 5, respawnGraceS: 4,
  /** «Сводник» (Р8): к человеку столько секунд никто не шёл — идёт ближайший свободный (дальние — на rankS позже каждый). */
  lonelyS: 8, lonelyRankS: 1,
  /** Характер (Р11): полоса «Задиры» и «Осторожного», лечение «Осторожного» раньше. */
  bullyBandMul: 0.8, carefulBandMul: 1.15, carefulHealFrac: 0.1,
  /** Путь (Р3): не чаще раз в pathTicks, заново — если цель ушла от конца пути дальше pathMoveM. */
  pathTicks: 30, pathMoveM: 2,
  /** Бой: смена стороны стрейфа через [от, до] с. */
  strafeS: Object.freeze([0.6, 2] as const),
  /** Застревание (Р10): stuckS без сдвига на stuckM — прыжок, шаг вбок на unstickS, новый путь. */
  stuckS: 1.5, stuckM: 0.6, unstickS: 0.4,
  /** Своя позиция скакнула за тик дальше этого (перестановка на старте боя) — память сброшена. */
  teleportM: 3,
  /** Край (Р9): проба хода на 0,6 и 1,2 м, безопасно от safeM до кромки; прыжок — приземление не ближе landingM. */
  probeNearM: 0.6, probeFarM: 1.2, safeM: 0.5, landingM: 1.5,
  /**
   * Ближе dangerM к кромке в бою и враг с толчком ближе pushNearM или видимый ближе своей дальности pushM — шаг от края
   * на edgeS.
   */
  dangerM: 3, edgeS: 0.6, pushNearM: 8, pushM: Object.freeze({ fire: 20, earth: 0, air: 9, water: 15 } as Readonly<Record<Element, number>>),
  /** Каст: допуск взгляда, градусы, и сколько живёт план после задержки, с. */
  castTolDeg: 6, planTtlS: 2,
  /** ЛКМ: держится, пока взгляд ближе fireTolDeg + σ к точке прицела. */
  fireTolDeg: 3,
  /** Руна: не больше runeBots ботов; сфера — если нет врага ближе orbSafeM. */
  runeBots: 2, orbSafeM: 6,
  /** Бродилка: точки не ближе roamMinM и не ближе spawnAvoidM к точкам появления, пауза на точке [от, до] с. */
  roamMinM: 8, spawnAvoidM: 4, roamPauseS: Object.freeze([0.5, 1.5] as const),
});

/** Имена по стихии (Р13), без метки. */
export const BOT_NAMES: Readonly<Record<Element, readonly string[]>> = Object.freeze({
  fire: Object.freeze(["Фитиль", "Зола", "Огниво"]),
  earth: Object.freeze(["Глыба", "Утёс", "Мох"]),
  air: Object.freeze(["Сквозняк", "Флюгер", "Перо"]),
  water: Object.freeze(["Капель", "Омут", "Ручей"]),
});
/** Метка в имени бота: «Валун · бот» (Р13). */
export const BOT_TAG = " · бот";
