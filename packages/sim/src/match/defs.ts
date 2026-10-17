import { TICK_HZ } from "../types";
import type { AbilityId, Element, Slot } from "./types";

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
    knockback: { distM: 3, upM: 1.2 }, // Р3, в центре; к краю × damageEdge / damageCenter
  },
  jetDash: { slot: "e", name: "Реактивный рывок", cooldownS: 8, distM: 8, durationS: 0.2, trailS: 2, trailDps: 6, trailHalfWidthM: 0.75 },
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
    knockback: { distM: 1, upM: 3.5 }, // вбок — Р3
    sizeM: 1.2, heightM: 2.5, hp: 200, lifeS: 4, growS: 0.1, solidS: 0.2, hitPadM: 0.4, selfRadiusM: 0.9, selfLiftM: 2.5, // площадь и «под себя» — Р9
  },
  stoneWall: { slot: "e", name: "Каменная стена", cooldownS: 12, aheadM: 2, lengthM: 4, heightM: 2.5, thickM: 0.6, growS: 0.3, solidS: 0.2, hp: 250, lifeS: 6 },
  earthquake: {
    slot: "c", name: "Землетрясение", cooldownS: 14, telegraphS: 0.4, radiusM: 7, heightM: 1.5, damage: 40,
    slowMul: 0.6, slowS: 2, rootRadiusM: 3, rootS: 0.5, knockback: { distM: 0.5, upM: 0 }, // высота и «сок» — Р8, Р3
  },
  passive: { name: "Корни", knockbackMul: 0.5 },
} as const;

export const STATUS = { burning: { dps: 6, durationS: 3, pulseS: 0.5 }, airborne: { noControlS: 0.3, damageMul: 1.15 }, hardCcImmunityS: 2, immuneKnockbackMul: 0.5 } as const;
/** Пределы контроля и телеграфа (GDD 2.2). */
export const CC_LIMITS = { stunMaxS: 0.75, rootMaxS: 1, slowMaxFrac: 0.4, slowMaxS: 2 } as const;
export const TELEGRAPH_MIN_S = 0.4;
/** Канал отбрасывания: затухание e^(−λt) на полу и в воздухе (round1/03); пределы (GDD 2.2). */
export const KNOCKBACK = { groundDecayPerS: 6, airDecayPerS: 1.5, maxSideM: 12, maxUpM: 6, juicePrimaryMaxM: 0.3, juiceAbilityMaxM: 1, stopSpeed: 0.05 } as const;
export const MAGE_REGEN = { delayS: 4, perS: 20, capFrac: 2 / 3 } as const;
/** Манекен полигона (Р12). */
export const DUMMY = { hp: 170, runSpeed: 2, regenDelayS: 3, regenPerS: 85, respawnS: 3 } as const;
export const MATCH = { fallCreditS: 5, mageRespawnS: 1 } as const;
/** GDD 7.3–7.4. */
export const LIMITS = { projectilesPerMage: 8, projectilesTotal: 48, zonesPerMage: 3, zonesTotal: 16, terrainPerMage: 3, terrainTotal: 24 } as const;

export const ABILITY_OF: Readonly<Record<Element, Readonly<Record<Slot, AbilityId>>>> = {
  fire: { primary: "fireFists", q: "fireball", e: "jetDash", c: "fireWall" },
  earth: { primary: "stoneShot", q: "stonePillar", e: "stoneWall", c: "earthquake" },
};
export const ABILITY_NAME: Readonly<Record<AbilityId, string>> = {
  fireFists: FIRE.fireFists.name, fireball: FIRE.fireball.name, jetDash: FIRE.jetDash.name, fireWall: FIRE.fireWall.name,
  stoneShot: EARTH.stoneShot.name, stonePillar: EARTH.stonePillar.name, stoneWall: EARTH.stoneWall.name, earthquake: EARTH.earthquake.name,
};
/** Экран выбора (GDD 4.1). */
export const ELEMENT_INFO: Readonly<Record<Element, { name: string; title: string; motto: string; stars: string; hp: number; runSpeed: number; ult: string }>> = {
  fire: { name: "Огонь", title: "Напор", motto: "Жги в упор, только не перегрейся", stars: "★ Новичку", hp: FIRE.hp, runSpeed: FIRE.runSpeed, ult: "Дыхание дракона" },
  earth: { name: "Земля", title: "Стойкость", motto: "Строй стены, бей тяжело, стой насмерть", stars: "★★", hp: EARTH.hp, runSpeed: EARTH.runSpeed, ult: "Тектонический разлом" },
};

/** Полная перезарядка слота в тиках; у ЛКМ — интервал между выстрелами без перегрева. */
export function slotCooldownTicks(element: Element, slot: Slot): number {
  if (slot === "primary") return ticks(1 / (element === "fire" ? FIRE.fireFists.ratePerS : EARTH.stoneShot.ratePerS));
  const kit = element === "fire" ? { q: FIRE.fireball, e: FIRE.jetDash, c: FIRE.fireWall } : { q: EARTH.stonePillar, e: EARTH.stoneWall, c: EARTH.earthquake };
  return ticks(kit[slot].cooldownS);
}
