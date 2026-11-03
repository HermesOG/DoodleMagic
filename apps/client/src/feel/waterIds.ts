/**
 * Звуки и всплески Воды (фаза 4). Список правит только задача 6 (клиент Воды); общие таблицы
 * (effects.ts, recipes.ts, presets.ts) берут его одной строкой.
 */
export const WATER_SOUND_IDS = ["whipCrack", "whipHit", "grabWindup", "grabThrow", "grabHit", "towPull", "wardUp", "wardAbsorb", "wardDown", "answerThrow", "answerHit", "springSpread", "springBubble", "steamHiss", "heal"] as const;
export const WATER_BURST_PRESETS = ["whipSplash", "grabSplash", "wardAbsorb", "wardBurst", "answerSplash", "springRing", "springBubbles", "steamPuff", "healMotes", "wetDrips", "deathWater"] as const;
