import type { AIR_SOUND_IDS } from "../feel/airIds";
import { REVERB_SEND, SHOT_CLICK, SIG, noise, tone, type Recipe } from "./layers";

/**
 * Звуки Воздуха (02-air, «Читается»; GDD 5). Подпись — узкий шум bandpass в полосе 800–4000 Гц: свист и шорох
 * ветра. Под наушники (Р20): у удара о стену и Порыва есть низ («тело»), но подпись — по-прежнему ветер.
 * Непрерывное (парение, гул Смерча) — зёрнами ≤ 0,8 с из airFrame (Р15).
 */
export type AirSoundId = (typeof AIR_SOUND_IDS)[number];

export const AIR_RECIPES: Readonly<Record<AirSoundId, Recipe>> = {
  // серп (фаза 9, L1): щелчок, узкий свист-подпись 2,2 → 3 кГц, «вшух» bandpass 1200 → 400 Гц и хвост ветра —
  // «вжик», а не «фью»; 3 раза в секунду, поэтому разброс высоты
  sickleThrow: {
    vary: 0.06,
    reverb: REVERB_SEND.lmb,
    layers: [
      SHOT_CLICK,
      noise("bandpass", 2200, 3000, 0.16, 0.5, { q: 6, attack: 0.01, ...SIG }),
      noise("bandpass", 1200, 400, 0.09, 0.45, { q: 1.5, attack: 0.002 }),
      noise("bandpass", 1800, 1000, 0.2, 0.15, { q: 2, attack: 0.02 }),
    ],
  },
  // попадание серпа: сухой «фьюп» 1,8 → 1,1 кГц и мягкий щелчок снизу
  sickleHit: {
    vary: 0.05,
    reverb: REVERB_SEND.lmb,
    layers: [
      noise("bandpass", 1800, 1100, 0.09, 0.6, { q: 2, attack: 0.001, ...SIG }),
      noise("lowpass", 600, 200, 0.06, 0.35, { q: 0, attack: 0.001 }),
    ],
  },
  // замах Порыва: свист нарастает 800 → 3000 Гц все 0,4 с и обрывается к выпуску
  gustWindup: {
    layers: [
      noise("bandpass", 800, 3000, 0.42, 0.5, { q: 3, attack: 0.36, ...SIG }),
      tone("triangle", 400, 1500, 0.42, 0.06, { attack: 0.36 }),
    ],
  },
  // выпуск Порыва: удар ветра 2,5 → 0,9 кГц и низкий «вуф» — средняя ступень
  gustBlast: {
    vary: 0.03,
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 2500, 900, 0.36, 0.8, { q: 1.2, attack: 0.008, sweep: 0.7, ...SIG }),
      noise("lowpass", 320, 120, 0.22, 0.5, { q: 2, attack: 0.006, drive: 1.5 }),
    ],
  },
  // снаряд сдуло: короткий шорох вверх 1,5 → 3,5 кГц
  airBlown: {
    vary: 0.05,
    layers: [noise("bandpass", 1500, 3500, 0.18, 0.55, { q: 1.5, attack: 0.005, ...SIG })],
  },
  // удар о стену: хлопок ветра и глухой удар 90 → 45 Гц (наушники)
  airSlam: {
    vary: 0.03,
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 1400, 900, 0.2, 0.6, { q: 1.5, attack: 0.002, ...SIG }),
      tone("sine", 90, 45, 0.18, 0.8, { attack: 0.002, sweep: 0.6, drive: 1.5 }),
      noise("lowpass", 400, 150, 0.12, 0.5, { q: 1, attack: 0.002 }),
    ],
  },
  // Взмах: «вжух» с доплером — bandpass 3000 → 900 Гц за 0,25 с
  swoop: {
    vary: 0.04,
    layers: [
      noise("bandpass", 3000, 900, 0.25, 0.7, { q: 2.5, attack: 0.04, ...SIG }),
      noise("lowpass", 500, 250, 0.2, 0.2, { q: 0, attack: 0.05 }),
    ],
  },
  // заряд Взмаха вернулся: тихий колокольчик ветра
  airCharge: {
    layers: [
      tone("sine", 1760, 1760, 0.3, 0.22, { attack: 0.01, ...SIG }),
      tone("sine", 2640, 2640, 0.25, 0.1, { attack: 0.01, delay: 0.05 }),
      noise("bandpass", 3000, 2000, 0.1, 0.08, { q: 2, attack: 0.01 }),
    ],
  },
  // каст Смерча у мага: ладони закручивают ветер — короткий завиток 1,2 → 2 → 1,4 кГц
  tornadoCast: {
    vary: 0.04,
    layers: [
      noise("bandpass", 1200, 2000, 0.22, 0.5, { q: 3, attack: 0.08, ...SIG }),
      noise("bandpass", 2000, 1400, 0.16, 0.25, { q: 3, attack: 0.03, delay: 0.12 }),
    ],
  },
  // Смерч растёт 0,5 с: шорох 800 → 1500 Гц и гул снизу
  tornadoRise: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 800, 1500, 0.55, 0.55, { q: 2, attack: 0.35, ...SIG }),
      noise("lowpass", 200, 400, 0.55, 0.4, { q: 1, attack: 0.3 }),
    ],
  },
  // зерно гула Смерча 0,6 с раз в 0,5 с: свист 1000 → 1300 Гц и рокот — зёрна перекрываются, пульсирует
  tornadoHum: {
    vary: 0.05,
    layers: [
      noise("bandpass", 1000, 1300, 0.6, 0.35, { q: 4, attack: 0.2, ...SIG }),
      noise("lowpass", 250, 200, 0.6, 0.3, { q: 1, attack: 0.2 }),
    ],
  },
  // огненный смерч: тот же вихрь ниже и с треском огня поверх (вспышка реакции и зёрна гула)
  fireTornado: {
    vary: 0.05,
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 900, 1500, 0.6, 0.45, { q: 2, attack: 0.15, ...SIG }),
      noise("highpass", 3000, 4500, 0.5, 0.3, { q: 0, ceiling: 7500, attack: 0.05, clicks: 6 }),
      noise("lowpass", 300, 150, 0.6, 0.35, { q: 1, attack: 0.1 }),
    ],
  },
  // второй прыжок: хлопок-кольцо воздуха
  airJump: {
    vary: 0.05,
    layers: [
      noise("bandpass", 1200, 2400, 0.12, 0.6, { q: 1.2, attack: 0.002, ...SIG }),
      noise("lowpass", 400, 150, 0.08, 0.3, { q: 0, attack: 0.002 }),
    ],
  },
  // зерно парения 0,4 с раз в 0,35 с: ровный свист 1,6–1,7 кГц
  glideWhistle: {
    vary: 0.02,
    layers: [
      noise("bandpass", 1600, 1700, 0.4, 0.25, { q: 8, attack: 0.12, ...SIG }),
      tone("sine", 1650, 1650, 0.4, 0.04, { attack: 0.12 }),
    ],
  },
  // замах Урагана 0,8 с: свист нарастает 800 → 4000 Гц до самого выпуска, под ним — свист тоном и гул-подъём снизу
  // (наушники); подпись — ветер
  hurricaneWindup: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 800, 4000, 0.8, 0.55, { q: 4, attack: 0.72, ...SIG }),
      tone("sine", 500, 2000, 0.8, 0.05, { attack: 0.7 }),
      noise("lowpass", 140, 320, 0.8, 0.3, { q: 1, attack: 0.65 }),
    ],
  },
  // выпуск Урагана: хлопок ветра 2,5 → 0,8 кГц, низкое «тело» 70 → 32 Гц без подписи (крупная ступень, реверб 0,35)
  // и хвост ветра, уходящий кольцом
  hurricaneBoom: {
    vary: 0.03,
    reverb: REVERB_SEND.large,
    layers: [
      noise("bandpass", 2500, 800, 0.6, 0.9, { q: 1, attack: 0.004, sweep: 0.6, ...SIG }),
      tone("sine", 70, 32, 0.45, 0.85, { attack: 0.003, sweep: 0.5, drive: 1.6 }),
      noise("lowpass", 500, 120, 0.35, 0.5, { q: 1, attack: 0.003 }),
      noise("bandpass", 1600, 1000, 0.72, 0.3, { q: 2, attack: 0.15, delay: 0.08 }),
    ],
  },
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
  tornadoCast: "Смерч: каст",
  tornadoRise: "Смерч: рост",
  tornadoHum: "Смерч: гул",
  fireTornado: "Огненный смерч",
  airJump: "Второй прыжок",
  glideWhistle: "Парение: свист",
  hurricaneWindup: "Ураган: замах",
  hurricaneBoom: "Ураган: выпуск",
};
