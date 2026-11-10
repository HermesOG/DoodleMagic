import type { STREAK_SOUND_IDS } from "../feel/effects";
import { REVERB_SEND, noise, tone, type Layer, type Recipe } from "./layers";

/**
 * Серии, добыча и дуга матча (фаза 9, задача 5; 02-feel-lmb, раздел 3; 04, L14 и T7). «Нейтральный язык»: колокола,
 * гонги и барабан без подписи стихии. Громкость пиков ≈ 0,5, реверб крупной ступени (0,35). Рецепт ≤ 0,8 с: длинный
 * гонг (×4+ — 1,8 с по разбору) — хвостом реверба, а не слоем. Колокол — неровный ряд партиалов 1 / 2 / 2,76 / 5,4:
 * так звучит храмовый колокол, а не синус-«бип». Ноты — ля мажор над ля5 (ля5, до-диез6, ми6, ля6); гонги — ре3 (тоника
 * музыки «Тушь и тайко»), 110 Гц (×4+) и 220 Гц («Последняя минута!»).
 */
export type StreakSoundId = (typeof STREAK_SOUND_IDS)[number];

/** Партиалы храмового колокола. */
const BELL = [1, 2, 2.76, 5.4] as const;
const A5 = 880;
const CS6 = 1108.7;
const E6 = 1318.5;
const A6 = 1760;
/** Гонг серии — ре3, тоника боевой музыки. */
const D3 = 146.8;

/** Удар тайко: синус вниз с перегрузом (слышно на ноутбуке) — не удар Земли: высота выше и короче. */
const drum = (delay: number, gain: number): Layer => tone("sine", 92, 50, 0.22, gain, { delay, attack: 0.003, sweep: 0.5, drive: 1.6 });
/** Шлепок по коже барабана: короткий шум bandpass 700 → 300 Гц. */
const skin = (delay: number, gain: number): Layer => noise("bandpass", 700, 300, 0.05, gain, { q: 1, delay, attack: 0.002 });
/** Гонг: основной тон, инхармоничный партиал 2,76 и металл 5,4 — удар сразу, высота стоит. */
const gong = (f: number, gain: number, o: { delay?: number; attack?: number } = {}): Layer[] => [
  tone("sine", f, f * 0.995, 0.8 - (o.delay ?? 0), gain, { attack: o.attack ?? 0.004, delay: o.delay ?? 0 }),
  tone("sine", f * BELL[2], f * BELL[2], 0.55, gain * 0.32, { attack: o.attack ?? 0.003, delay: o.delay ?? 0 }),
];
/** Деревянный щелчок часов: тон на 20 мс и сухой шум той же высоты — не «тик» попадания (треугольник 1,6 кГц). */
const woodClick = (f: number): Recipe => ({
  layers: [tone("sine", f, f, 0.02, 0.35, { attack: 0.001 }), noise("bandpass", f, f, 0.015, 0.15, { q: 6, attack: 0.0005 })],
});

export const STREAK_RECIPES: Readonly<Record<StreakSoundId, Recipe>> = {
  // колокол объявления: ля5 с партиалами 2 и 2,76, ми6 — через 90 мс (ноты «kill», но колоколом)
  streakBell: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", A5, A5, 0.75, 0.28, { attack: 0.002 }),
      tone("sine", A5 * BELL[1], A5 * BELL[1], 0.5, 0.12, { attack: 0.002 }),
      tone("sine", A5 * BELL[2], A5 * BELL[2], 0.35, 0.08, { attack: 0.002 }),
      tone("sine", E6, E6, 0.65, 0.22, { delay: 0.09, attack: 0.002 }),
    ],
  },
  // ×2: колокол ля5 и через 90 мс до-диез6 с ми6 — мажорный «шаг вверх»
  streakDouble: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", A5, A5, 0.7, 0.26, { attack: 0.002 }),
      tone("sine", A5 * BELL[2], A5 * BELL[2], 0.3, 0.08, { attack: 0.002 }),
      tone("sine", CS6, CS6, 0.62, 0.22, { delay: 0.09, attack: 0.002 }),
      tone("sine", E6, E6, 0.62, 0.18, { delay: 0.09, attack: 0.002 }),
    ],
  },
  // ×3: то же и ля6 ещё через 90 мс — ступень выше
  streakTriple: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", A5, A5, 0.7, 0.24, { attack: 0.002 }),
      tone("sine", CS6, CS6, 0.6, 0.2, { delay: 0.09, attack: 0.002 }),
      tone("sine", E6, E6, 0.6, 0.16, { delay: 0.09, attack: 0.002 }),
      tone("sine", A6, A6, 0.55, 0.18, { delay: 0.18, attack: 0.002 }),
    ],
  },
  // ×4+ (поверх ×3): низкий гонг 110 Гц и удар барабана с кожей; хвост — реверб
  streakRampage: {
    reverb: REVERB_SEND.large,
    layers: [...gong(110, 0.42), drum(0, 0.55), skin(0, 0.25)],
  },
  // серия 3 и матч-пойнт: двойной удар тайко «дон-дон» через 130 мс
  streakDrums: {
    reverb: REVERB_SEND.medium,
    layers: [drum(0, 0.5), skin(0, 0.22), drum(0.13, 0.58), skin(0.13, 0.24)],
  },
  // серия 5: гонг ре3 с металлом 5,4 и ударом по краю
  streakGong: {
    reverb: REVERB_SEND.large,
    layers: [
      ...gong(D3, 0.42),
      tone("sine", D3 * BELL[3], D3 * BELL[3], 0.35, 0.06, { attack: 0.003 }),
      noise("bandpass", 1200, 500, 0.06, 0.14, { q: 1.5, attack: 0.002 }),
    ],
  },
  // серия 7 и 10: гонг ре3, удар барабана и восходящий шелест 400 → 3000 Гц — «стихия поднимается»
  streakStorm: {
    reverb: REVERB_SEND.large,
    layers: [...gong(D3, 0.38), drum(0, 0.45), noise("bandpass", 400, 3000, 0.7, 0.24, { q: 1.2, delay: 0.1, attack: 0.5 })],
  },
  // чужая серия от 5 — на всю карту, без позиции (как гул ульты): далёкий низкий гонг соль2, мягкий удар, глухо
  streakFar: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", 98, 97.5, 0.8, 0.36, { attack: 0.05 }),
      tone("sine", 98 * BELL[2], 98 * BELL[2], 0.6, 0.08, { attack: 0.05 }),
      noise("lowpass", 300, 120, 0.4, 0.08, { q: 0, attack: 0.1 }),
    ],
  },
  // прервал чужую серию: звон — трещина 3,2 → 2,2 кГц и стеклянный си6 с фа-диез7 над си5
  streakBroke: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 3200, 2200, 0.05, 0.25, { q: 2, attack: 0.001, clicks: 3 }),
      tone("sine", 1975.5, 1975.5, 0.4, 0.22, { attack: 0.002 }),
      tone("sine", 2960, 2960, 0.25, 0.1, { attack: 0.002 }),
      tone("sine", 987.8, 987.8, 0.45, 0.14, { attack: 0.003 }),
    ],
  },
  // добыча (L14): тёплый подъём — треугольник 440 → 660 Гц за 0,2 с на 0,35, октава ниже и мягкий хвост ми5; без золота
  lootRise: {
    layers: [
      tone("triangle", 440, 660, 0.2, 0.35, { attack: 0.03, sweep: 1 }),
      tone("sine", 220, 330, 0.22, 0.12, { attack: 0.03, sweep: 1 }),
      tone("sine", 660, 660, 0.2, 0.1, { delay: 0.18, attack: 0.02 }),
    ],
  },
  // «Последняя минута!» (T7): гонг 220 Гц — звучит и без музыки
  lastMinute: {
    reverb: REVERB_SEND.large,
    layers: [
      ...gong(220, 0.42),
      tone("sine", 220 * BELL[3], 220 * BELL[3], 0.3, 0.06, { attack: 0.003 }),
      noise("lowpass", 900, 300, 0.07, 0.18, { q: 0, attack: 0.002 }),
    ],
  },
  // последние 10 с: щелчок 800 Гц, последние 3 с — 1,2 кГц
  clockTick: woodClick(800),
  clockTickLast: woodClick(1200),
};

export const STREAK_SOUND_LABELS: Readonly<Record<StreakSoundId, string>> = {
  streakBell: "Серия: колокол объявления",
  streakDouble: "Серия: двойное",
  streakTriple: "Серия: тройное",
  streakRampage: "Серия: разгром (гонг и барабан)",
  streakDrums: "Серия 3 и матч-пойнт: барабан",
  streakGong: "Серия 5: гонг",
  streakStorm: "Серия 7: гонг и шелест",
  streakFar: "Чужая серия: далёкий гонг",
  streakBroke: "Серия прервана: звон",
  lootRise: "Добыча: тёплый подъём",
  lastMinute: "Последняя минута: гонг",
  clockTick: "Часы: щелчок",
  clockTickLast: "Часы: последние 3 с",
};
