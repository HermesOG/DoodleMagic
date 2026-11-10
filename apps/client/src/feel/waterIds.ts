/**
 * Звуки и всплески Воды (фаза 4). Список правит только задача 6 (клиент Воды); общие таблицы
 * (effects.ts, recipes.ts, presets.ts) берут его одной строкой.
 *
 * - wardAbsorb → wardAbsorbMid → wardAbsorbHigh: впитал больше — тон выше (стрелок слышит, что Ответ растёт).
 * - whipArc: брызги на конце дуги хлыста; саму дугу от ладони рисует waterVfx (по этому всплеску, см. waterFx.ts).
 * - Ульта «Цунами» (фаза 5): tsunamiRise — рост волны 0,8 с, tsunamiRoll — зерно рокота хода, tsunamiHit — удар волны;
 *   tsunamiSurge — вода встаёт за спиной Воды, tsunamiSplash — всплеск на задетом. Сам гребень рисует waterVfx.
 */
export const WATER_SOUND_IDS = [
  "whipSwish", "whipCrack", "whipHit", "grabWindup", "grabThrow", "grabHit", "towPull", "wardUp", "wardAbsorb", "wardAbsorbMid", "wardAbsorbHigh",
  "wardDown", "answerThrow", "answerHit", "springSpread", "springBubble", "steamHiss", "heal", "tsunamiRise", "tsunamiRoll", "tsunamiHit",
] as const;
export const WATER_BURST_PRESETS = [
  "whipArc", "whipSplash", "grabSplash", "wardAbsorb", "wardBurst", "answerSplash", "springRing", "springBubbles", "steamPuff", "healMotes",
  "wetDrips", "deathWater", "bogMuck", "tsunamiSurge", "tsunamiSplash",
] as const;
