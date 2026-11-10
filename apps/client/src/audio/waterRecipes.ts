import type { WATER_SOUND_IDS } from "../feel/waterIds";
import { REVERB_SEND, SHOT_CLICK, SIG, noise, tone, type Recipe } from "./layers";

/** Звуки Воды. Подпись — в полосе Воды 300–1500 Гц (GDD 5). */
export type WaterSoundId = (typeof WATER_SOUND_IDS)[number];

/** Звон «водяного колокола» впитывания: основной тон f, призвук ×2,4 и плеск. Чем больше впитал, тем выше f. */
const absorb = (f: number): Recipe => ({
  vary: 0.02,
  layers: [
    tone("sine", f, f * 1.06, 0.32, 0.5, { attack: 0.003, ...SIG }),
    tone("sine", f * 2.4, f * 2.45, 0.16, 0.16, { attack: 0.002 }),
    noise("bandpass", 1000, 500, 0.1, 0.35, { q: 1.2 }),
  ],
});

/*
 * Вода звучит плеском, хлопком и звоном в средней полосе; под наушники (Р20) низ не урезан — у тяжёлых ударов
 * короткое «тело» 60–200 Гц. Все звуки ≤ 0,8 с; журчание Родника — зерно 0,5 с, его повторяет waterFrame.
 */
export const WATER_RECIPES: Readonly<Record<WaterSoundId, Recipe>> = {
  // замах хлыста 0,12 с (фаза 9, L1): щелчок, «вжик» вверх — громче и с быстрой атакой, нажатие слышно сразу — и тихий
  // хвост плеска; щелчок хлыста придёт с дугой
  whipSwish: {
    vary: 0.08,
    reverb: REVERB_SEND.lmb,
    layers: [
      SHOT_CLICK,
      noise("bandpass", 600, 1300, 0.11, 0.5, { q: 1.4, attack: 0.015, ...SIG }),
      noise("bandpass", 900, 450, 0.2, 0.15, { q: 1.2, attack: 0.01 }),
    ],
  },
  // щелчок хлыста: плеск bandpass 1,4 → 0,5 кГц, «пик» 900 → 300 Гц и короткий хлёст сверху
  whipCrack: {
    vary: 0.06,
    reverb: REVERB_SEND.lmb,
    layers: [
      noise("bandpass", 1400, 500, 0.09, 0.85, { q: 1.5, attack: 0.001, sweep: 0.5, ...SIG }),
      tone("sine", 900, 300, 0.06, 0.45, { attack: 0.001, sweep: 0.4 }),
      noise("highpass", 2500, 3500, 0.025, 0.3, { q: 0, attack: 0.001, ceiling: 7000 }),
    ],
  },
  // попадание хлыста: мокрый шлепок и глухое тело
  whipHit: {
    vary: 0.05,
    reverb: REVERB_SEND.lmb,
    layers: [
      noise("lowpass", 1200, 400, 0.14, 0.8, { q: 2, attack: 0.002, sweep: 0.6, ...SIG }),
      tone("sine", 220, 110, 0.1, 0.5, { attack: 0.002, sweep: 0.5 }),
      noise("bandpass", 800, 600, 0.12, 0.25, { q: 1, clicks: 4 }),
    ],
  },
  // нарастающий «вшух» замаха Хвата 0,25 с: полоса уходит вверх, громкость растёт до броска
  grabWindup: {
    layers: [
      noise("bandpass", 400, 1400, 0.3, 0.6, { q: 2, attack: 0.22, ...SIG }),
      tone("sine", 300, 600, 0.3, 0.18, { attack: 0.2 }),
    ],
  },
  // бросок жгута: «вшух» вниз и короткий толчок
  grabThrow: {
    vary: 0.04,
    layers: [
      noise("bandpass", 1300, 500, 0.22, 0.7, { q: 1.5, attack: 0.008, sweep: 0.7, ...SIG }),
      tone("sine", 180, 120, 0.12, 0.3, { attack: 0.004 }),
    ],
  },
  // «чпок» на цели: тон быстро падает 1,2 кГц → 350 Гц, плеск и тело
  grabHit: {
    reverb: REVERB_SEND.medium,
    layers: [
      tone("sine", 1200, 350, 0.08, 0.8, { attack: 0.002, sweep: 0.35, ...SIG }),
      noise("lowpass", 900, 300, 0.14, 0.5, { q: 3, attack: 0.002 }),
      tone("sine", 140, 80, 0.12, 0.5, { attack: 0.002, sweep: 0.5 }),
    ],
  },
  // буксир: натянутая струя 0,35 с — гудит и ползёт вверх
  towPull: {
    layers: [
      noise("bandpass", 500, 900, 0.4, 0.55, { q: 3, attack: 0.04, ...SIG }),
      tone("triangle", 160, 200, 0.36, 0.2, { attack: 0.04 }),
      noise("lowpass", 600, 400, 0.35, 0.25, { q: 1, attack: 0.03 }),
    ],
  },
  // «водяной колокол»: 660 Гц с долгим хвостом, призвук ×2,5 и плеск на ударе
  wardUp: {
    reverb: REVERB_SEND.medium,
    layers: [
      tone("sine", 660, 650, 0.7, 0.55, { attack: 0.004, ...SIG }),
      tone("sine", 1650, 1640, 0.35, 0.2, { attack: 0.003 }),
      noise("bandpass", 900, 500, 0.2, 0.35, { q: 1 }),
    ],
  },
  wardAbsorb: absorb(700),
  wardAbsorbMid: absorb(880),
  wardAbsorbHigh: absorb(1100),
  // диск уходит: плеск вниз, тело и капли
  wardDown: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("lowpass", 1400, 300, 0.35, 0.75, { q: 1, attack: 0.003, sweep: 0.7, ...SIG }),
      tone("sine", 180, 70, 0.2, 0.5, { attack: 0.003, sweep: 0.6, drive: 1.5 }),
      noise("bandpass", 800, 400, 0.25, 0.3, { q: 1, clicks: 6 }),
    ],
  },
  // Ответ: тяжёлый «вшух» с телом
  answerThrow: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 1200, 400, 0.25, 0.8, { q: 1.2, attack: 0.005, sweep: 0.7, ...SIG }),
      tone("sine", 200, 90, 0.15, 0.5, { attack: 0.003, sweep: 0.6 }),
    ],
  },
  // попадание Ответа: большой плеск, тело и капли
  answerHit: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("lowpass", 1500, 300, 0.4, 0.9, { q: 1, attack: 0.002, sweep: 0.6, ...SIG }),
      tone("sine", 160, 60, 0.2, 0.6, { attack: 0.002, sweep: 0.6, drive: 1.5 }),
      noise("bandpass", 900, 600, 0.3, 0.3, { q: 1, clicks: 8 }),
    ],
  },
  // разлив Родника 0,4 с: поток раскрывается вверх по полосе
  springSpread: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 400, 1100, 0.45, 0.6, { q: 1.2, attack: 0.05, ...SIG }),
      tone("sine", 120, 90, 0.3, 0.3, { attack: 0.02 }),
      noise("bandpass", 700, 500, 0.4, 0.2, { q: 1, clicks: 5 }),
    ],
  },
  // зерно журчания 0,5 с: три пузыря (тон быстро вверх) на тихой подложке воды
  springBubble: {
    vary: 0.1,
    layers: [
      tone("sine", 520, 820, 0.06, 0.32, { attack: 0.005, ...SIG }),
      tone("sine", 700, 1100, 0.05, 0.22, { attack: 0.004, delay: 0.15 }),
      tone("sine", 600, 950, 0.06, 0.22, { attack: 0.005, delay: 0.32 }),
      noise("lowpass", 900, 600, 0.5, 0.1, { q: 0, attack: 0.1 }),
    ],
  },
  // пар: шипение сверху и влажная середина-подпись
  steamHiss: {
    layers: [
      noise("bandpass", 1400, 900, 0.6, 0.35, { q: 0.7, attack: 0.03, ...SIG }),
      noise("highpass", 4000, 3000, 0.7, 0.45, { q: 0, attack: 0.02, ceiling: 9000 }),
    ],
  },
  // лечение: мягкий звон вверх
  heal: {
    layers: [
      tone("sine", 600, 900, 0.35, 0.32, { attack: 0.03, ...SIG }),
      tone("sine", 1200, 1350, 0.3, 0.14, { attack: 0.03, delay: 0.06 }),
    ],
  },
  // рост Цунами 0,8 с: шум воды поднимается 300 → 1200 Гц до самого выпуска, под ним — нарастающее тело 55 → 95 Гц
  // (наушники), омывающий шорох и бульканье
  tsunamiRise: {
    reverb: REVERB_SEND.large,
    layers: [
      noise("bandpass", 300, 1200, 0.8, 0.6, { q: 1.2, attack: 0.65, ...SIG }),
      tone("sine", 55, 95, 0.8, 0.35, { attack: 0.6 }),
      noise("lowpass", 400, 900, 0.8, 0.3, { q: 0, attack: 0.55 }),
      noise("bandpass", 800, 600, 0.6, 0.15, { q: 1, delay: 0.2, clicks: 6 }),
    ],
  },
  // зерно рокота хода 0,5 с раз в 0,4 с (Р15): гул воды 450–700 Гц и низ — зёрна перекрываются, волна рокочет
  tsunamiRoll: {
    vary: 0.05,
    layers: [
      noise("bandpass", 450, 700, 0.5, 0.45, { q: 1.5, attack: 0.15, ...SIG }),
      noise("lowpass", 250, 180, 0.5, 0.4, { q: 1, attack: 0.15 }),
      tone("sine", 70, 60, 0.5, 0.2, { attack: 0.15 }),
    ],
  },
  // удар волны: обвал воды 1,5 → 0,35 кГц, тяжёлое тело 130 → 50 Гц и брызги (крупная ступень, реверб 0,35)
  tsunamiHit: {
    vary: 0.04,
    reverb: REVERB_SEND.large,
    layers: [
      noise("lowpass", 1500, 350, 0.55, 0.95, { q: 1, attack: 0.003, sweep: 0.6, ...SIG }),
      tone("sine", 130, 50, 0.3, 0.7, { attack: 0.002, sweep: 0.5, drive: 1.5 }),
      noise("bandpass", 900, 500, 0.5, 0.35, { q: 1, clicks: 10 }),
    ],
  },
};

/** Подписи кнопок прослушки (audition.ts). */
export const WATER_SOUND_LABELS: Readonly<Record<WaterSoundId, string>> = {
  whipSwish: "Хлыст: замах",
  whipCrack: "Хлыст: удар",
  whipHit: "Хлыст: попадание",
  grabWindup: "Хват: замах",
  grabThrow: "Хват: бросок",
  grabHit: "Хват: попадание",
  towPull: "Буксир",
  wardUp: "Отражение: диск",
  wardAbsorb: "Отражение: впитал",
  wardAbsorbMid: "Отражение: впитал (больше)",
  wardAbsorbHigh: "Отражение: впитал (много)",
  wardDown: "Отражение: снят",
  answerThrow: "Ответ: бросок",
  answerHit: "Ответ: попадание",
  springSpread: "Родник: разлив",
  springBubble: "Родник: журчание",
  steamHiss: "Пар",
  heal: "Лечение",
  tsunamiRise: "Цунами: рост",
  tsunamiRoll: "Цунами: рокот",
  tsunamiHit: "Цунами: удар",
};
