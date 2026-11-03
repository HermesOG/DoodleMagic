import { TICK_HZ } from "../types";
import type { AbilityId, Element, ProjectileKind, Slot } from "./types";

/** Секунды → целые тики (60 Гц). */
export const ticks = (s: number): number => Math.round(s * TICK_HZ);
/** gravity — ускорение вниз, м/с². */
export interface ProjectileDef { speed: number; radiusM: number; gravity: number; rangeM: number }

/** Огонь «Напор» (GDD 4.3). Цифры не из GDD помечены «Р» — решения плана. */
export const FIRE = {
  hp: 150, runSpeed: 6.5,
  fireFists: {
    slot: "primary", name: "Огненные кулаки", damage: 12, ratePerS: 5,
    projectile: { speed: 40, radiusM: 0.2, gravity: 0, rangeM: 24 }, // дальность — Р7
    knockback: { distM: 0.3, upM: 0 }, // «сок» ЛКМ ≤ 0,3 м, × min(1, интервал / tempoRefS) (round2/03, п. 7)
    tempoRefS: 0.5,
  },
  heat: { perShot: 8, max: 100, coolPerS: 35, coolDelayS: 0.3, overheatS: 1.5, overheatRateMul: 0.5 },
  fireball: {
    slot: "q", name: "Огненный шар", cooldownS: 8, windupS: 0.25, damageCenter: 50, damageEdge: 20, radiusM: 3,
    projectile: { speed: 22, radiusM: 0.45, gravity: 0, rangeM: 44 }, // дальность — Р7
    knockback: { distM: 4, upM: 1.5 }, // K2 фазы 4 (было 3 / 1,2), в центре; к краю × damageEdge / damageCenter
  },
  // A6 фазы 4: скорость линейно (1 ± profile)·40 м/с, на выходе 9 м/с (было ровно 40 и 6,5)
  jetDash: { slot: "e", name: "Реактивный рывок", cooldownS: 8, distM: 8, durationS: 0.2, profile: 0.6, exitSpeed: 9, trailS: 2, trailDps: 6, trailHalfWidthM: 0.75 },
  fireWall: { slot: "c", name: "Стена огня", cooldownS: 12, rangeM: 15, lengthM: 10, heightM: 2.5, thickM: 0.6, lifeS: 5, telegraphS: 0.4, contactDamage: 30, rehitS: 1 }, // толщина и повтор — Р6
  passive: { name: "Кураж" },
} as const;

/** Земля «Стойкость» (GDD 4.4). */
export const EARTH = {
  hp: 170, runSpeed: 6,
  stoneShot: {
    slot: "primary", name: "Каменный снаряд", damage: 30, ratePerS: 1.9, windupS: 0.2,
    projectile: { speed: 40, radiusM: 0.25, gravity: 6, rangeM: 50 }, // гравитация и дальность — Р7
    knockback: { distM: 0.3, upM: 0 },
  },
  stonePillar: {
    slot: "q", name: "Каменный столб", cooldownS: 10, rangeM: 20, telegraphS: 0.6, damage: 35,
    knockback: { distM: 2, upM: 3.5 }, // вбок — K2 фазы 4 (было 1 м)
    // Площадь и «под себя» — Р9. Р9 теперь 1,0 м, а не 0,9 (решение контролёра): половина столба 0,6 + полтела 0,4.
    // Ближе — столб под магом и подъём на вершину; дальше столб уже не задевает мага, и тот не взлетает сбоку от него.
    sizeM: 1.2, heightM: 2.5, hp: 200, lifeS: 4, growS: 0.1, solidS: 0.2, hitPadM: 0.4, selfRadiusM: 1, selfLiftM: 2.5,
  },
  stoneWall: { slot: "e", name: "Каменная стена", cooldownS: 12, aheadM: 2, lengthM: 4, heightM: 2.5, thickM: 0.6, growS: 0.3, solidS: 0.2, hp: 250, lifeS: 6 },
  earthquake: {
    slot: "c", name: "Землетрясение", cooldownS: 14, telegraphS: 0.4, radiusM: 7, heightM: 1.5, damage: 40,
    slowMul: 0.6, slowS: 2, rootRadiusM: 3, rootS: 0.5, knockback: { distM: 1, upM: 0 }, // высота — Р8; толчок — K2 фазы 4 (было 0,5)
  },
  passive: { name: "Корни", knockbackMul: 0.5 },
} as const;

/** Воздух «Свобода» (round3/02-air.md; Р12, Р13 фазы 4). */
export const AIR = {
  hp: 130, runSpeed: 7,
  airSickle: { slot: "primary", name: "Воздушный серп", damage: 16, ratePerS: 3, projectile: { speed: 60, radiusM: 0.3, gravity: 0, rangeM: 40 }, knockback: { distM: 0.3, upM: 0 }, tempoRefS: 0.5 },
  gust: { slot: "q", name: "Порыв", cooldownS: 8, windupS: 0.4, rangeM: 7, halfAngleDeg: 30, halfHeightM: 2.5, damage: 10, knockback: { distM: 7, upM: 1 }, slamDamage: 20 },
  swoop: { slot: "e", name: "Взмах", distM: 8, durationS: 0.2, profile: 0.6, exitSpeed: 7, charges: 2, chargeS: 6 },
  tornado: {
    slot: "c", name: "Смерч", cooldownS: 18, rangeM: 20, growS: 0.5, lifeS: 4, radiusM: 5, belowM: 0.5, aboveM: 4, pullSpeed: 2.5,
    pulseS: 0.5, pulseDamage: 4, firePulseDamage: 8, coreRadiusM: 1.5, coreLiftM: 3, ownerLiftM: 2, ownerLiftEveryS: 1, fireReachM: 3,
  },
  passive: { name: "Лёгкость", doubleJumpM: 1.25, glideFallSpeed: 2.5, glideAirControl: 1, glideS: 3 },
} as const;

/** Вода «Перехватчик» (round3/03-water.md, концепция A; Р4, Р5, Р8 фазы 4). */
export const WATER = {
  hp: 150, runSpeed: 6.5,
  waterWhip: { slot: "primary", name: "Водяной хлыст", damage: 20, ratePerS: 2.5, windupS: 0.12, rangeM: 15, radiusM: 0.25, knockback: { distM: 0.3, upM: 0 }, tempoRefS: 0.5 },
  waterGrab: { slot: "q", name: "Хват", cooldownS: 8, windupS: 0.25, damage: 25, projectile: { speed: 28, radiusM: 0.4, gravity: 0, rangeM: 15 }, towSpeed: 20, towMaxM: 7, towStopM: 1.5, safeStepM: 0.25, safeDropM: 3 },
  waterWard: { slot: "e", name: "Отражение", cooldownS: 9, durationS: 1, runMul: 0.7, padM: 0.5, answer: { name: "Ответ", minDamage: 20, maxDamage: 60, projectile: { speed: 45, radiusM: 0.35, gravity: 0, rangeM: 30 } } },
  spring: { slot: "c", name: "Родник", cooldownS: 14, rangeM: 15, telegraphS: 0.4, radiusM: 4, heightM: 1.5, lifeS: 6, healPerS: 12, healPulseS: 0.25, slowMul: 0.7, slowAfterS: 0.5 },
  passive: { name: "Круговорот", wetS: 3, drainFrac: 0.2 },
} as const;

/**
 * Статусы. Иммунитет (K2 фазы 4): толчок вбок в полную силу, подброс ×0,5; притягивание ×0,5 (Р6).
 * «Мокрый» — 3 с (GDD 4.1).
 */
export const STATUS = {
  burning: { dps: 6, durationS: 3, pulseS: 0.5 }, airborne: { noControlS: 0.3, damageMul: 1.15 }, hardCcImmunityS: 2,
  immuneKnockSideMul: 1, immuneKnockUpMul: 0.5, immunePullMul: 0.5, wet: { durationS: 3 },
} as const;
/** Пределы контроля и телеграфа (GDD 2.2). */
export const CC_LIMITS = { stunMaxS: 0.75, rootMaxS: 1, slowMaxFrac: 0.4, slowMaxS: 2 } as const;
export const TELEGRAPH_MIN_S = 0.4;
/** Канал отбрасывания: затухание e^(−λt) на полу и в воздухе (round1/03); пределы (GDD 2.2). */
/**
 * K1 фазы 4: толчок ≥ staggerMinM гасит у жертвы своё движение к источнику и на staggerS режет своё ускорение
 * до staggerAccelMul. Удар о стену — пока скорость канала ≥ slamMinSpeed. Опору под целью для честного полёта
 * ищем не глубже flightProbeM.
 */
export const KNOCKBACK = {
  groundDecayPerS: 6, airDecayPerS: 1.5, maxSideM: 12, maxUpM: 6, juicePrimaryMaxM: 0.3, juiceAbilityMaxM: 1, stopSpeed: 0.05,
  staggerMinM: 1, staggerS: 0.2, staggerAccelMul: 0.3, slamMinSpeed: 6, flightProbeM: 30,
} as const;
/** Облако пара (Р9 фазы 4): диск 2,5 м высотой 3 м на 3 с, не больше 4 на арену, с одной цели — раз в 3 с. */
export const STEAM = { radiusM: 2.5, heightM: 3, lifeS: 3, perArena: 4, everyS: 3 } as const;
/**
 * «Выкипание» (GDD 4.6, round3/03-water.md): огненный шар или Стена огня по взведённому Роднику — Родник уходит, на его
 * месте облако пара radiusM на STEAM.lifeS хозяина огня. Лимит пара на арену — общий (STEAM.perArena); стена горит дальше.
 */
export const BOIL_OFF = { radiusM: 4 } as const;
/**
 * «Топь» (GDD 4.6, round3/03-water.md): Землетрясение по взведённому Роднику. Лужа той же площади доживает срок
 * Родника, но не меньше minLifeS; врагов хозяина внутри замедляет до slowMul (−40 %, предел CC) и мочит; замедление
 * держится slowS после выхода (как slowAfterS у Родника). Срабатывает, только если центр Родника в радиусе землетрясения.
 */
export const BOG = { slowMul: 0.6, slowS: 0.5, minLifeS: 2 } as const;
/**
 * «Огненный вал» (GDD 4.6, round3/02-air.md): Порыв по взведённой Стене огня — стена едет distM по взгляду за durationS.
 * Встаёт у камня и там, где под серединой нет опоры глубже probeDownM; liftM — сколько низа бокса не проверяем на пол.
 */
export const RAMPART = { distM: 8, durationS: 1, probeDownM: 1, liftM: 0.25 } as const;
export const MAGE_REGEN = { delayS: 4, perS: 20, capFrac: 2 / 3 } as const;
/** Манекен полигона (Р12). */
export const DUMMY = { hp: 170, runSpeed: 2, regenDelayS: 3, regenPerS: 85, respawnS: 3 } as const;
export const MATCH = { fallCreditS: 5, mageRespawnS: 1 } as const;
/**
 * Буфер нажатий (решение контролёра): нажатие Q, E, C или свежее нажатие ЛКМ, отклонённое перезарядкой или замахом,
 * которые снимутся за это время, ждёт и срабатывает на первом тике, когда каст станет возможен. Не успеют — отказ сразу.
 */
export const PRESS_BUFFER_S = 0.3;
/** GDD 7.3–7.4. */
export const LIMITS = { projectilesPerMage: 8, projectilesTotal: 48, zonesPerMage: 3, zonesTotal: 16, terrainPerMage: 3, terrainTotal: 24 } as const;

export const ABILITY_OF: Readonly<Record<Element, Readonly<Record<Slot, AbilityId>>>> = {
  fire: { primary: "fireFists", q: "fireball", e: "jetDash", c: "fireWall" },
  earth: { primary: "stoneShot", q: "stonePillar", e: "stoneWall", c: "earthquake" },
  air: { primary: "airSickle", q: "gust", e: "swoop", c: "tornado" },
  water: { primary: "waterWhip", q: "waterGrab", e: "waterWard", c: "spring" },
};
export const ABILITY_NAME: Readonly<Record<AbilityId, string>> = {
  fireFists: FIRE.fireFists.name, fireball: FIRE.fireball.name, jetDash: FIRE.jetDash.name, fireWall: FIRE.fireWall.name,
  stoneShot: EARTH.stoneShot.name, stonePillar: EARTH.stonePillar.name, stoneWall: EARTH.stoneWall.name, earthquake: EARTH.earthquake.name,
  airSickle: AIR.airSickle.name, gust: AIR.gust.name, swoop: AIR.swoop.name, tornado: AIR.tornado.name,
  waterWhip: WATER.waterWhip.name, waterGrab: WATER.waterGrab.name, waterWard: WATER.waterWard.name, spring: WATER.spring.name,
};
/** Стихия способности (по ABILITY_OF). */
export const ELEMENT_OF: Readonly<Record<AbilityId, Element>> = Object.freeze(
  Object.fromEntries((Object.keys(ABILITY_OF) as Element[]).flatMap((e) => Object.values(ABILITY_OF[e]).map((a) => [a, e]))) as Record<AbilityId, Element>,
);
/** Вид снаряда → способность, которой засчитан урон; Ответ — Отражению. */
export const PROJECTILE_SOURCE: Readonly<Record<ProjectileKind, AbilityId>> = Object.freeze({
  fireFists: "fireFists", fireball: "fireball", stoneShot: "stoneShot", airSickle: "airSickle", waterGrab: "waterGrab", waterAnswer: "waterWard",
});
/** Заряды слотов на старте мага: у всех 0, у Воздуха e — AIR.swoop.charges. */
export const SLOT_CHARGES: Readonly<Record<Element, Readonly<Record<Slot, number>>>> = Object.freeze({
  fire: Object.freeze({ primary: 0, q: 0, e: 0, c: 0 }),
  earth: Object.freeze({ primary: 0, q: 0, e: 0, c: 0 }),
  air: Object.freeze({ primary: 0, q: 0, e: AIR.swoop.charges, c: 0 }),
  water: Object.freeze({ primary: 0, q: 0, e: 0, c: 0 }),
});
/** Экран выбора (GDD 4.1). */
export const ELEMENT_INFO: Readonly<Record<Element, { name: string; title: string; motto: string; stars: string; hp: number; runSpeed: number; ult: string }>> = {
  fire: { name: "Огонь", title: "Напор", motto: "Жги в упор, только не перегрейся", stars: "★ Новичку", hp: FIRE.hp, runSpeed: FIRE.runSpeed, ult: "Дыхание дракона" },
  earth: { name: "Земля", title: "Стойкость", motto: "Строй стены, бей тяжело, стой насмерть", stars: "★★", hp: EARTH.hp, runSpeed: EARTH.runSpeed, ult: "Тектонический разлом" },
  air: { name: "Воздух", title: "Свобода", motto: "Летай и сдувай врагов с карты", stars: "★★", hp: AIR.hp, runSpeed: AIR.runSpeed, ult: "Ураган" },
  water: { name: "Вода", title: "Текучесть", motto: "Тяни к себе, возвращай удары", stars: "★★★", hp: WATER.hp, runSpeed: WATER.runSpeed, ult: "Цунами" },
};

/** Карточки слотов по стихиям: у ЛКМ темп, у прочих — перезарядка (у Взмаха — время заряда). */
const CARDS = {
  fire: { primary: FIRE.fireFists, q: FIRE.fireball, e: FIRE.jetDash, c: FIRE.fireWall },
  earth: { primary: EARTH.stoneShot, q: EARTH.stonePillar, e: EARTH.stoneWall, c: EARTH.earthquake },
  air: { primary: AIR.airSickle, q: AIR.gust, e: AIR.swoop, c: AIR.tornado },
  water: { primary: WATER.waterWhip, q: WATER.waterGrab, e: WATER.waterWard, c: WATER.spring },
} as const;

/**
 * Полная перезарядка слота в тиках; у ЛКМ — интервал между выстрелами без перегрева; у слота с зарядами (Взмах) —
 * время одного заряда. air: 20, 480, 360, 1080; water: 24, 480, 540, 840.
 */
export function slotCooldownTicks(element: Element, slot: Slot): number {
  const c = CARDS[element];
  if (slot === "primary") return ticks(1 / c.primary.ratePerS);
  const card: { cooldownS: number } | { chargeS: number } = c[slot];
  return ticks("chargeS" in card ? card.chargeS : card.cooldownS);
}
