import type { AIR_SOUND_IDS } from "../feel/airIds";
import { SIG, noise, type Recipe } from "./layers";

/** Звуки Воздуха. Подпись — в полосе Воздуха 800–4000 Гц (GDD 5). */
export type AirSoundId = (typeof AIR_SOUND_IDS)[number];

/** Заглушка до задачи 5: шорох ветра — шум bandpass 2000 → 2400 Гц, 0,12 с, с подписью. */
const stub = (): Recipe => ({ layers: [noise("bandpass", 2000, 2400, 0.12, 0.5, { q: 1.2, ...SIG })] });

export const AIR_RECIPES: Readonly<Record<AirSoundId, Recipe>> = {
  sickleThrow: stub(),
  sickleHit: stub(),
  gustWindup: stub(),
  gustBlast: stub(),
  airBlown: stub(),
  airSlam: stub(),
  swoop: stub(),
  airCharge: stub(),
  tornadoRise: stub(),
  tornadoHum: stub(),
  fireTornado: stub(),
  airJump: stub(),
  glideWhistle: stub(),
};

/** Подписи кнопок прослушки (audition.ts). */
export const AIR_SOUND_LABELS: Readonly<Record<AirSoundId, string>> = {
  sickleThrow: "Серп: бросок",
  sickleHit: "Серп: попадание",
  gustWindup: "Порыв: замах",
  gustBlast: "Порыв: удар",
  airBlown: "Сдуло",
  airSlam: "Удар о стену",
  swoop: "Взмах",
  airCharge: "Взмах: заряд вернулся",
  tornadoRise: "Смерч: рост",
  tornadoHum: "Смерч: гул",
  fireTornado: "Огненный смерч",
  airJump: "Второй прыжок",
  glideWhistle: "Парение: свист",
};
