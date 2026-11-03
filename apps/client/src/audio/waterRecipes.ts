import type { WATER_SOUND_IDS } from "../feel/waterIds";
import { SIG, noise, type Recipe } from "./layers";

/** Звуки Воды. Подпись — в полосе Воды 300–1500 Гц (GDD 5). */
export type WaterSoundId = (typeof WATER_SOUND_IDS)[number];

/** Заглушка до задачи 6: всплеск — шум bandpass 700 → 900 Гц, 0,12 с, с подписью. */
const stub = (): Recipe => ({ layers: [noise("bandpass", 700, 900, 0.12, 0.5, { q: 1.2, ...SIG })] });

export const WATER_RECIPES: Readonly<Record<WaterSoundId, Recipe>> = {
  whipCrack: stub(),
  whipHit: stub(),
  grabWindup: stub(),
  grabThrow: stub(),
  grabHit: stub(),
  towPull: stub(),
  wardUp: stub(),
  wardAbsorb: stub(),
  wardDown: stub(),
  answerThrow: stub(),
  answerHit: stub(),
  springSpread: stub(),
  springBubble: stub(),
  steamHiss: stub(),
  heal: stub(),
};

/** Подписи кнопок прослушки (audition.ts). */
export const WATER_SOUND_LABELS: Readonly<Record<WaterSoundId, string>> = {
  whipCrack: "Хлыст: удар",
  whipHit: "Хлыст: попадание",
  grabWindup: "Хват: замах",
  grabThrow: "Хват: бросок",
  grabHit: "Хват: попадание",
  towPull: "Буксир",
  wardUp: "Отражение: диск",
  wardAbsorb: "Отражение: впитал",
  wardDown: "Отражение: снят",
  answerThrow: "Ответ: бросок",
  answerHit: "Ответ: попадание",
  springSpread: "Родник: разлив",
  springBubble: "Родник: журчание",
  steamHiss: "Пар",
  heal: "Лечение",
};
