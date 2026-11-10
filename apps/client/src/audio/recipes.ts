import type { Element } from "@doodlemagic/sim";
import type { SoundId } from "../feel/effects";
import { AIR_SOUND_IDS } from "../feel/airIds";
import { WATER_SOUND_IDS } from "../feel/waterIds";
import { AIR_RECIPES } from "./airRecipes";
import { SHOT_CLICK, SIG, noise, tone, REVERB_SEND, type Recipe } from "./layers";
import { WATER_RECIPES } from "./waterRecipes";

export { REVERB_SEND } from "./layers";
export type { Layer, Recipe } from "./layers";

/**
 * Огонь — ярко и рвано: треск highpass 3–6 кГц со щелчками, «вуумп» lowpass, открывающийся 200 → 2000 Гц.
 * Земля — низко и тяжело: саб-синус 90 → 40 Гц (камень) или 70 → 30 Гц (столб, землетрясение) с перегрузом,
 * хруст lowpass 400 Гц, скрежет bandpass 300 Гц, гул телеграфа 40 Гц.
 * Общие — тональные и короткие, чтобы не тонуть в стихиях и не спорить с ними полосой.
 */
export const RECIPES: Record<SoundId, Recipe> = {
  // ── Огонь ──
  // кулак (L1): треск-подпись, щелчок, «пух» пламени — шум lowpass 300 → 1200 Гц (шум, а не синус: синус 30–200 Гц —
  // подпись Земли) и хвост треска
  fireFist: {
    vary: 0.06,
    reverb: REVERB_SEND.lmb,
    layers: [
      noise("highpass", 4000, 3000, 0.07, 0.6, { q: 0, ceiling: 8000, clicks: 3, ...SIG }),
      SHOT_CLICK,
      noise("lowpass", 300, 1200, 0.08, 0.6, { q: 2, attack: 0.002 }),
      noise("highpass", 2500, 2000, 0.2, 0.15, { q: 0, ceiling: 6000, attack: 0.01, clicks: 4 }),
    ],
  },
  fireballCharge: {
    layers: [
      noise("bandpass", 500, 2600, 0.28, 0.4, { q: 1.2, attack: 0.22 }),
      noise("highpass", 2500, 4500, 0.28, 0.35, { q: 0, ceiling: 7500, attack: 0.2, clicks: 6, ...SIG }),
      tone("triangle", 220, 330, 0.28, 0.1, { attack: 0.2 }),
    ],
  },
  // выпуск шара (A1): «вуумп» 150 → 1500 Гц и треск, 0,25 с — самый сильный момент каста больше не беззвучен
  fireballLaunch: {
    vary: 0.03,
    reverb: REVERB_SEND.medium,
    layers: [
      noise("lowpass", 150, 1500, 0.25, 0.85, { q: 3, attack: 0.012, sweep: 0.5, drive: 2 }),
      noise("highpass", 3000, 5000, 0.22, 0.5, { q: 0, ceiling: 8000, delay: 0.01, clicks: 6, ...SIG }),
    ],
  },
  // у взрыва есть «тело» 110 → 55 Гц (A4, наушники): подпись Огня — по-прежнему треск в первые 20–50 мс
  fireballBoom: {
    vary: 0.03,
    reverb: REVERB_SEND.medium,
    layers: [
      noise("lowpass", 200, 2000, 0.4, 0.8, { q: 2, attack: 0.025, sweep: 0.6, drive: 2 }),
      tone("sine", 110, 55, 0.15, 0.7, { sweep: 0.6, drive: 1.5 }),
      noise("highpass", 3000, 6000, 0.45, 0.6, { q: 0, ceiling: 8000, delay: 0.02, clicks: 10, ...SIG }),
      noise("bandpass", 900, 400, 0.12, 0.35, { q: 0.8 }),
    ],
  },
  // попадание кулаком (H3): треск и сухой хлопок 1–2 кГц — не тот же звук, что у каста
  fistHit: {
    vary: 0.06,
    reverb: REVERB_SEND.lmb,
    layers: [
      noise("highpass", 3500, 3000, 0.06, 0.55, { q: 0, ceiling: 8000, clicks: 3, ...SIG }),
      noise("bandpass", 2000, 1000, 0.04, 0.7, { q: 1.2, attack: 0.001 }),
    ],
  },
  dash: {
    vary: 0.04,
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 6000, 2500, 0.24, 0.55, { q: 1.6, attack: 0.012, ...SIG }),
      noise("lowpass", 1800, 300, 0.26, 0.5, { attack: 0.01, drive: 1.5 }),
      noise("highpass", 3500, 5000, 0.2, 0.25, { q: 0, ceiling: 8000, delay: 0.03, clicks: 4 }),
    ],
  },
  fireWallTelegraph: {
    layers: [
      noise("highpass", 3000, 5500, 0.42, 0.5, { q: 0, ceiling: 8000, attack: 0.36, clicks: 9, ...SIG }),
      noise("bandpass", 1500, 3000, 0.42, 0.15, { q: 0.8, attack: 0.38 }),
    ],
  },
  fireWallIgnite: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("lowpass", 200, 2000, 0.4, 0.8, { q: 3, attack: 0.04, sweep: 0.7, drive: 2.5 }),
      noise("highpass", 3000, 6000, 0.55, 0.55, { q: 0, ceiling: 8000, delay: 0.03, clicks: 12, ...SIG }),
      noise("bandpass", 700, 450, 0.65, 0.3, { q: 0.7, attack: 0.08, drive: 3 }),
    ],
  },
  overheat: {
    layers: [
      noise("highpass", 5000, 7000, 0.6, 0.32, { q: 0, ceiling: 9000, attack: 0.05, ...SIG }),
      noise("highpass", 3500, 3500, 0.5, 0.25, { q: 0, ceiling: 8000, delay: 0.05, clicks: 8 }),
    ],
  },
  // Дыхание дракона, вдох 0,6 с: воздух втягивается — шум lowpass 600 → 3000 Гц нарастает, сверху разгорается треск
  breathInhale: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("lowpass", 600, 3000, 0.6, 0.7, { q: 4, attack: 0.5 }),
      noise("highpass", 2500, 5000, 0.6, 0.35, { q: 0, ceiling: 8000, attack: 0.48, clicks: 8, ...SIG }),
      tone("sine", 150, 220, 0.6, 0.25, { attack: 0.5 }),
    ],
  },
  // зерно потока 0,4 с раз в 0,3 с (Р15 фазы 4): рёв 2–6 кГц с телом 150 Гц, зёрна перекрываются на 0,1 с
  breathRoar: {
    vary: 0.05,
    layers: [
      noise("bandpass", 3500, 3000, 0.4, 0.55, { q: 0.6, attack: 0.1, ...SIG }),
      noise("highpass", 2000, 2400, 0.4, 0.3, { q: 0, ceiling: 6000, attack: 0.08, clicks: 6 }),
      tone("triangle", 150, 140, 0.4, 0.35, { attack: 0.1, drive: 1.5 }),
      noise("lowpass", 500, 350, 0.4, 0.35, { q: 0, attack: 0.1 }),
    ],
  },

  // ── Земля ──
  // нажатие: камень вырывается из пола — 100 мс, весь замах 0,12 с (фаза 9, Р2): бросок звучит своим рецептом
  stoneCast: {
    vary: 0.05,
    layers: [
      tone("sine", 90, 40, 0.1, 0.85, { sweep: 0.5, drive: 2, ...SIG }),
      noise("lowpass", 400, 220, 0.08, 0.6, { q: 0, clicks: 3 }),
    ],
  },
  // бросок камня (A1, L1): каменный щелчок 1,2 кГц на 15 мс, свист lowpass 800 → 300 Гц, короткий глухой толчок —
  // подпись Земли — и хвост осыпи
  stoneThrow: {
    vary: 0.05,
    reverb: REVERB_SEND.lmb,
    layers: [
      noise("bandpass", 1200, 1200, 0.015, 0.4, { q: 4, attack: 0.001 }),
      noise("lowpass", 800, 300, 0.14, 0.55, { q: 4, attack: 0.01 }),
      tone("sine", 120, 50, 0.1, 0.7, { sweep: 0.5, drive: 1.5, ...SIG }),
      noise("lowpass", 500, 150, 0.2, 0.15, { q: 0, attack: 0.01, clicks: 3 }),
    ],
  },
  // попадание камня: саб, глухой хруст lowpass и (L11, доделка A4) хруст 1,8 → 1,0 кГц на 0,6 — слышно на ноутбуке
  stoneImpact: {
    vary: 0.05,
    reverb: REVERB_SEND.lmb,
    layers: [
      tone("sine", 90, 40, 0.26, 1, { sweep: 0.4, drive: 2.5, ...SIG }),
      noise("lowpass", 400, 200, 0.2, 0.7, { q: 2, clicks: 5 }),
      noise("bandpass", 1800, 1000, 0.03, 0.6, { q: 1.5, attack: 0.001 }),
    ],
  },
  pillarTelegraph: {
    layers: [
      tone("sine", 40, 40, 0.62, 0.7, { attack: 0.5, drive: 3, ...SIG }),
      noise("bandpass", 650, 400, 0.6, 0.55, { q: 2, attack: 0.4, clicks: 7 }),
    ],
  },
  pillarStrike: {
    reverb: REVERB_SEND.medium,
    layers: [
      tone("sine", 70, 30, 0.5, 1, { sweep: 0.4, drive: 3, ...SIG }),
      noise("lowpass", 400, 150, 0.35, 0.75, { q: 2, clicks: 6 }),
      noise("bandpass", 900, 500, 0.05, 0.35, { q: 1.2 }),
    ],
  },
  wallRise: {
    reverb: REVERB_SEND.medium,
    layers: [
      noise("bandpass", 260, 340, 0.25, 0.75, { q: 3, attack: 0.03, drive: 2 }),
      tone("sine", 60, 35, 0.3, 0.7, { attack: 0.02, drive: 2, ...SIG }),
      noise("lowpass", 400, 300, 0.25, 0.45, { q: 0, clicks: 8 }),
    ],
  },
  quakeWindup: {
    layers: [
      tone("sine", 40, 40, 0.42, 0.75, { attack: 0.36, drive: 3, ...SIG }),
      noise("lowpass", 150, 450, 0.42, 0.5, { q: 3, attack: 0.36 }),
    ],
  },
  quakeStrike: {
    reverb: REVERB_SEND.medium,
    layers: [
      tone("sine", 70, 30, 0.75, 1, { sweep: 0.5, drive: 3.5, ...SIG }),
      noise("lowpass", 400, 120, 0.55, 0.8, { q: 2, clicks: 9 }),
      noise("lowpass", 180, 80, 0.8, 0.5, { q: 0, attack: 0.05 }),
      noise("bandpass", 800, 450, 0.06, 0.35, { q: 1 }),
    ],
  },
  terrainHit: {
    vary: 0.08,
    layers: [
      tone("triangle", 200, 120, 0.07, 0.5, { sweep: 0.5, ...SIG }),
      noise("bandpass", 1500, 800, 0.09, 0.3, { q: 1.5, clicks: 3 }),
    ],
  },
  terrainBreak: {
    vary: 0.04,
    reverb: REVERB_SEND.medium,
    layers: [
      tone("sine", 80, 40, 0.4, 0.85, { sweep: 0.4, drive: 2.5, ...SIG }),
      noise("lowpass", 600, 200, 0.45, 0.7, { q: 2, clicks: 12 }),
      noise("bandpass", 1400, 900, 0.5, 0.25, { q: 2, delay: 0.06, clicks: 8 }),
    ],
  },
  // Тектонический разлом, телеграф 0,8 с: трещина бежит — гул 40 → 55 Гц нарастает к удару, хруст и скрежет по ходу
  riftRumble: {
    reverb: REVERB_SEND.medium,
    layers: [
      tone("sine", 40, 55, 0.8, 0.8, { attack: 0.62, drive: 3, ...SIG }),
      noise("lowpass", 120, 420, 0.8, 0.55, { q: 2, attack: 0.6, clicks: 10 }),
      noise("bandpass", 320, 600, 0.75, 0.25, { q: 1.5, attack: 0.5, clicks: 8 }),
    ],
  },
  // удар шипов по всей линии: низкий удар 80 → 30 Гц и каменный хруст; крупная ступень — реверб 0,35
  riftStrike: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", 80, 30, 0.7, 1, { sweep: 0.4, drive: 3.5, ...SIG }),
      noise("lowpass", 500, 150, 0.6, 0.85, { q: 2, clicks: 12 }),
      noise("bandpass", 1400, 800, 0.45, 0.4, { q: 2, delay: 0.03, clicks: 10 }),
      noise("lowpass", 180, 70, 0.8, 0.45, { q: 0, attack: 0.04 }),
    ],
  },

  // ── Общие ──
  // подтверждение по ступеням (H3). Малая — «тик» 65 мс (фаза 9, L2): щелчок bandpass 4,5 кГц на 8 мс, треугольник
  // 1,6 → 1,5 кГц и блеск 3,2 кГц на 20 мс; сухой, высоту поднимает HP цели (pitch у звукового эффекта)
  hitLight: {
    layers: [
      noise("bandpass", 4500, 4500, 0.008, 0.4, { q: 2, attack: 0.001 }),
      tone("triangle", 1600, 1500, 0.065, 0.45, { attack: 0.002 }),
      tone("sine", 3200, 3200, 0.02, 0.2, { attack: 0.001 }),
    ],
  },
  // средняя — то же, плюс «тело» 160 → 80 Гц на 90 мс и бумажный надрыв bandpass 1,5 кГц на 60 мс
  hitHeavy: {
    reverb: REVERB_SEND.medium,
    layers: [
      tone("sine", 1800, 1800, 0.03, 0.5, { attack: 0.002 }),
      tone("sine", 3600, 3600, 0.012, 0.3, { attack: 0.001 }),
      tone("sine", 160, 80, 0.09, 0.7, { attack: 0.002, drive: 1.5 }),
      noise("bandpass", 1500, 1500, 0.06, 0.4, { q: 2, attack: 0.002, clicks: 3 }),
    ],
  },
  // крупная — звон убийства и низкий удар
  kill: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", 880, 880, 0.14, 0.45, { attack: 0.004 }),
      tone("sine", 1320, 1320, 0.3, 0.45, { delay: 0.09, attack: 0.004 }),
      tone("sine", 110, 45, 0.25, 0.75, { sweep: 0.6, drive: 1.5 }),
    ],
  },
  fall: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", 1200, 300, 0.7, 0.32, { attack: 0.04 }),
      noise("bandpass", 1600, 500, 0.7, 0.14, { q: 2, attack: 0.1 }),
    ],
  },
  fizzle: {
    layers: [
      tone("sine", 600, 200, 0.12, 0.4, { attack: 0.004 }),
      noise("lowpass", 1400, 400, 0.2, 0.3, { q: 0, attack: 0.02 }),
    ],
  },
  courage: {
    layers: [523.25, 659.25, 783.99, 1046.5].map((f, i) =>
      tone("triangle", f, f * 1.01, i === 3 ? 0.4 : 0.35, 0.22, { delay: i * 0.05, attack: 0.006 }),
    ),
  },
  // ульта (фаза 5). Чужая ульта на всю карту, у всех четырёх стихий один звук без подписи: низкий гул 120 → 60 Гц
  // нарастает 0,45 с и обрывается, сверху — шорох; 0,6 с
  ultWarn: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", 120, 60, 0.6, 0.8, { attack: 0.45, drive: 1.5 }),
      tone("triangle", 240, 120, 0.6, 0.22, { attack: 0.45 }),
      noise("highpass", 3000, 1800, 0.6, 0.18, { q: 0, ceiling: 9000, attack: 0.42 }),
    ],
  },
  // свой заряд полон: звон-«щелчок» 0,2 с — щелчок 1,5 кГц и короткий звон квинтой выше
  ultReady: {
    layers: [
      tone("sine", 1500, 1500, 0.05, 0.5, { attack: 0.001 }),
      tone("sine", 2250, 2250, 0.2, 0.3, { attack: 0.002 }),
      tone("triangle", 3000, 3000, 0.15, 0.12, { delay: 0.04, attack: 0.002 }),
    ],
  },

  // ── Объекты на карте (фаза 6): «нейтральный язык» GDD 6 — золото с печатью. Только колокола и гонги: тоны держат
  // высоту (свист Воздуха и удар Земли скользят), шума нет, кроме треска печати. Металл — призвуки ×2,76, ×5,44, ×8,2 над
  // основным тоном; близких тонов с биениями нет: биения 4–35 Гц на низах слышатся бульканьем Воды. Руна — ре мажор:
  // объявление на соль, появление — на ре (разрешение), взятие — аккорд ре. Выше 3 кГц — только тихий отблеск: под
  // наушники без резкостей ──
  // сфера жизни взята: светлый двузвучный звон вверх до6 → соль6, 0,35 с; мимо звона лечения (600 → 900 и 1200 → 1350 Гц)
  orbTake: {
    layers: [
      tone("sine", 1046.5, 1046.5, 0.2, 0.32, { attack: 0.003 }),
      tone("sine", 2888, 2888, 0.07, 0.06, { attack: 0.002 }),
      tone("sine", 1568, 1568, 0.26, 0.3, { delay: 0.09, attack: 0.003 }),
      tone("sine", 4327, 4327, 0.06, 0.04, { delay: 0.09, attack: 0.002 }),
    ],
  },
  // руна через 10 с, на всю карту: низкий гонг соль3 (чуть раскрывается вверх) с металлом 541 и 1067 Гц; сверху
  // разгорается мерцание 1,6 кГц; 0,8 с. Не гул ульты врага (120 → 60 Гц нарастает): тут удар сразу и высота стоит
  runeWarn: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", 196, 197, 0.8, 0.5, { attack: 0.006 }),
      tone("sine", 541, 541, 0.5, 0.3, { attack: 0.004 }), // громче: на динамиках ноутбука низ гонга срезан
      tone("sine", 1067, 1067, 0.3, 0.08, { attack: 0.003 }),
      tone("sine", 1607, 1612, 0.74, 0.07, { delay: 0.06, attack: 0.2 }),
    ],
  },
  // руна появилась, на всю карту: гонг ре4 с металлом 705 Гц и восходящее мерцание ля5 → ре6; 0,8 с
  runeSpawn: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", 293.7, 295.5, 0.8, 0.5, { attack: 0.006 }),
      tone("sine", 705, 705, 0.4, 0.16, { attack: 0.004 }),
      tone("sine", 880, 880, 0.5, 0.16, { delay: 0.14, attack: 0.003 }),
      tone("sine", 1174.7, 1174.7, 0.52, 0.14, { delay: 0.28, attack: 0.003 }),
    ],
  },
  // руна взята: глубокий удар-аккорд ре мажор 0,6 с — ре3, ля3, фа-диез4 синусами (треугольник на низах звенит
  // «ошибкой» восьмибитки) и золотой отблеск ре6. Высота стоит — не удар Земли (синус 90 → 40 Гц)
  runeTake: {
    reverb: REVERB_SEND.large,
    layers: [
      tone("sine", 146.8, 146.8, 0.6, 0.45, { attack: 0.006 }),
      tone("sine", 220, 220, 0.55, 0.3, { attack: 0.005 }),
      tone("sine", 370, 370, 0.5, 0.3, { attack: 0.004 }), // громче: на динамиках ноутбука ре3 и ля3 срезаны
      tone("sine", 1174.7, 1174.7, 0.25, 0.08, { attack: 0.002 }),
    ],
  },
  // своя ярость кончилась: мягкий звон вниз соль5 → ре5 с тёплым ре4 под ним, 0,4 с
  furyEnd: {
    reverb: REVERB_SEND.medium,
    layers: [
      tone("sine", 784, 784, 0.2, 0.26, { attack: 0.008 }),
      tone("sine", 587.3, 587.3, 0.3, 0.26, { delay: 0.1, attack: 0.008 }),
      tone("sine", 293.7, 293.7, 0.3, 0.1, { delay: 0.1, attack: 0.02 }),
    ],
  },
  // носитель сбит мной: резкий звон до-диез6 с блеском 3 кГц, до-диез5 под ним и треск печати — короткий надрыв
  // bandpass 1,8 → 0,9 кГц со щелчками (язык подтверждения hitHeavy, не треск Огня); 0,5 с. С «kill» (ля5, ми6) — ля мажор
  furySlain: {
    reverb: REVERB_SEND.medium,
    layers: [
      tone("sine", 1108.7, 1108.7, 0.45, 0.34, { attack: 0.002 }),
      tone("sine", 3060, 3060, 0.1, 0.07, { attack: 0.001 }),
      tone("sine", 554.4, 554.4, 0.5, 0.24, { attack: 0.003 }),
      noise("bandpass", 1800, 900, 0.08, 0.28, { q: 2, delay: 0.012, attack: 0.002, clicks: 3 }),
    ],
  },

  // ── Движение (M2): тихо, коротко, без подписи стихии ──
  // шаг — шум bandpass 700 → 250 Гц, 45 мс
  step: { vary: 0.1, layers: [noise("bandpass", 700, 250, 0.045, 0.8, { q: 1.2, attack: 0.002 })] },
  // прыжок — «ткань» 0,12 с
  jump: { vary: 0.08, layers: [noise("bandpass", 1200, 2400, 0.12, 0.45, { q: 0.8, attack: 0.03 })] },
  // приземление — глухой удар; громкость задаёт событие (∝ скорости касания)
  land: {
    vary: 0.06,
    layers: [tone("sine", 120, 50, 0.12, 0.8, { sweep: 0.5, drive: 1.5 }), noise("lowpass", 600, 200, 0.08, 0.5, { q: 0 })],
  },
  // «вжух» отбрасывания (K3): bandpass 1,2 → 0,4 кГц, 0,3 с
  knockWhoosh: { layers: [noise("bandpass", 1200, 400, 0.3, 0.6, { q: 2, attack: 0.05 })] },
  // ── Свист мимо уха (фаза 9, L12): чужой снаряд прошёл рядом. Звук ставится, когда снаряд уже миновал ухо, поэтому
  // атака короткая (12–15 мс) и дальше только спад вниз (допплер); подпись — в полосе стихии стрелка ──
  // кулак и шар: треск 3 → 2 кГц и спад полосы 3 → 1,2 кГц, 180 мс
  whizzFire: {
    vary: 0.06,
    layers: [
      noise("highpass", 3000, 2000, 0.18, 0.5, { q: 0, ceiling: 7000, attack: 0.012, clicks: 5, ...SIG }),
      noise("bandpass", 3000, 1200, 0.18, 0.45, { q: 2, attack: 0.012 }),
    ],
  },
  // камень: «вумм» — lowpass 500 → 180 Гц и низ 110 → 60 Гц под ним, 200 мс
  whizzStone: {
    vary: 0.05,
    layers: [
      noise("lowpass", 500, 180, 0.2, 0.6, { q: 3, attack: 0.015 }),
      tone("sine", 110, 60, 0.2, 0.5, { attack: 0.015, drive: 1.5, ...SIG }),
    ],
  },
  // серп: свист 3,5 → 1,5 кГц, 150 мс
  whizzSickle: {
    vary: 0.06,
    layers: [noise("bandpass", 3500, 1500, 0.15, 0.6, { q: 5, attack: 0.012, ...SIG })],
  },
  // снаряды Воды (Хват, Ответ): плеск 1,2 → 0,5 кГц, 160 мс
  whizzWater: {
    vary: 0.06,
    layers: [noise("bandpass", 1200, 500, 0.16, 0.6, { q: 1.5, attack: 0.012, clicks: 3, ...SIG })],
  },
  // ── Воздух и Вода — своими таблицами (airRecipes.ts, waterRecipes.ts) ──
  ...AIR_RECIPES,
  ...WATER_RECIPES,
};

/** Всем id списка — одна стихия. */
const signedBy = <K extends string>(ids: readonly K[], el: Element): Record<K, Element> =>
  Object.fromEntries(ids.map((id) => [id, el])) as Record<K, Element>;

/** Чья это подпись: стихия или общий звук (null). Рельеф — камень Земли, чем бы по нему ни попали. */
export const SOUND_ELEMENT: Record<SoundId, Element | null> = {
  ...signedBy(AIR_SOUND_IDS, "air"),
  ...signedBy(WATER_SOUND_IDS, "water"),
  fireFist: "fire",
  fireballCharge: "fire",
  fireballBoom: "fire",
  fireballLaunch: "fire",
  fistHit: "fire",
  dash: "fire",
  fireWallTelegraph: "fire",
  fireWallIgnite: "fire",
  overheat: "fire",
  breathInhale: "fire",
  breathRoar: "fire",
  stoneCast: "earth",
  stoneImpact: "earth",
  stoneThrow: "earth",
  pillarTelegraph: "earth",
  pillarStrike: "earth",
  wallRise: "earth",
  quakeWindup: "earth",
  quakeStrike: "earth",
  terrainHit: "earth",
  terrainBreak: "earth",
  riftRumble: "earth",
  riftStrike: "earth",
  hitLight: null,
  hitHeavy: null,
  kill: null,
  fall: null,
  fizzle: null,
  courage: null,
  ultWarn: null,
  ultReady: null,
  orbTake: null,
  runeWarn: null,
  runeSpawn: null,
  runeTake: null,
  furyEnd: null,
  furySlain: null,
  step: null,
  jump: null,
  land: null,
  knockWhoosh: null,
  whizzFire: "fire",
  whizzStone: "earth",
  whizzSickle: "air",
  whizzWater: "water",
};

/** Полоса слоя-подписи [низ, верх] в Гц; без подписи — самого громкого слоя. */
export function bandOf(r: Recipe): [number, number] {
  const sig = r.layers.find((l) => l.signature) ?? r.layers.reduce((a, b) => (b.gain > a.gain ? b : a));
  return [Math.min(sig.freq, sig.freqEnd), Math.max(sig.freq, sig.freqEnd)];
}

/** Конец последнего слоя, с. */
export function recipeLength(r: Recipe): number {
  return Math.max(...r.layers.map((l) => l.delay + l.dur));
}
