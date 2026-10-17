import type { Element } from "@doodlemagic/sim";
import type { SoundId } from "../feel/effects";

/**
 * Слой звука: шум или тон с короткой огибающей. Огибающая: тишина до delay, линейный подъём до gain за attack,
 * экспонента вниз до тишины к delay + dur. Всё в секундах и герцах.
 *
 * - tone: freq → freqEnd — высота осциллятора. Фильтр, если задан, идёт за той же кривой.
 * - noise: белый шум, freq → freqEnd — частота фильтра. Без фильтра шум полосы не имеет.
 * - q — как у BiquadFilterNode: для lowpass и highpass резонанс в дБ (0 — почти без горба), для bandpass — добротность.
 * - signature — слой-подпись стихии: в нём полоса, по которой стихию узнают вслепую (GDD 5).
 *
 * Необязательные поля сверх плана (интерфейс плана они не меняют):
 * - sweep — за какую долю dur частота доходит до freqEnd (1 — за весь слой). У ударов падение высоты быстрее спада громкости;
 * - drive — перегруз waveshaper'ом (tanh), до огибающей: у саба Земли появляются гармоники, слышные на динамиках ноутбука;
 * - clicks — столько случайных щелчков поверх тихой подложки того же шума: треск огня, хруст и скрежет камня;
 * - ceiling — потолок: lowpass на этой частоте после фильтра слоя. Белый шум после highpass 3 кГц иначе почти весь
 *   выше 8 кГц и звучит шипением, а не треском; потолок держит энергию треска в полосе Огня 2–8 кГц.
 */
export interface Layer {
  kind: "noise" | "tone";
  wave?: OscillatorType;
  freq: number;
  freqEnd: number;
  filter?: BiquadFilterType;
  q?: number;
  delay: number;
  attack: number;
  dur: number;
  gain: number;
  signature?: true;
  sweep?: number;
  drive?: number;
  clicks?: number;
  ceiling?: number;
}

/** vary — разброс высоты ± за каждый запуск, чтобы частый звук (кулаки 5 раз в секунду) не звучал пулемётом. */
export interface Recipe {
  layers: Layer[];
  vary?: number;
}

type Opt = Partial<Pick<Layer, "q" | "delay" | "attack" | "signature" | "sweep" | "drive" | "clicks" | "ceiling">>;

const ATTACK = 0.003;

const noise = (filter: BiquadFilterType | null, freq: number, freqEnd: number, dur: number, gain: number, o: Opt = {}): Layer => ({
  kind: "noise",
  ...(filter ? { filter } : {}),
  freq,
  freqEnd,
  delay: 0,
  attack: ATTACK,
  dur,
  gain,
  ...o,
});

const tone = (wave: OscillatorType, freq: number, freqEnd: number, dur: number, gain: number, o: Opt = {}): Layer => ({
  kind: "tone",
  wave,
  freq,
  freqEnd,
  delay: 0,
  attack: ATTACK,
  dur,
  gain,
  ...o,
});

const SIG = { signature: true } as const;

/**
 * Огонь — ярко и рвано: треск highpass 3–6 кГц со щелчками, «вуумп» lowpass, открывающийся 200 → 2000 Гц.
 * Земля — низко и тяжело: саб-синус 90 → 40 Гц (камень) или 70 → 30 Гц (столб, землетрясение) с перегрузом,
 * хруст lowpass 400 Гц, скрежет bandpass 300 Гц, гул телеграфа 40 Гц.
 * Общие — тональные и короткие, чтобы не тонуть в стихиях и не спорить с ними полосой.
 */
export const RECIPES: Record<SoundId, Recipe> = {
  // ── Огонь ──
  fireFist: {
    vary: 0.06,
    layers: [
      noise("highpass", 4000, 3000, 0.07, 0.6, { q: 0, ceiling: 8000, clicks: 3, ...SIG }),
      noise("bandpass", 2400, 1100, 0.06, 0.3, { q: 1.4 }),
    ],
  },
  fireballCharge: {
    layers: [
      noise("bandpass", 500, 2600, 0.28, 0.4, { q: 1.2, attack: 0.22 }),
      noise("highpass", 2500, 4500, 0.28, 0.35, { q: 0, ceiling: 7500, attack: 0.2, clicks: 6, ...SIG }),
      tone("triangle", 220, 330, 0.28, 0.1, { attack: 0.2 }),
    ],
  },
  fireballBoom: {
    vary: 0.03,
    layers: [
      noise("lowpass", 200, 2000, 0.4, 0.8, { q: 2, attack: 0.025, sweep: 0.6, drive: 2 }),
      noise("highpass", 3000, 6000, 0.45, 0.6, { q: 0, ceiling: 8000, delay: 0.02, clicks: 10, ...SIG }),
      noise("bandpass", 900, 400, 0.12, 0.35, { q: 0.8 }),
    ],
  },
  dash: {
    vary: 0.04,
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

  // ── Земля ──
  stoneCast: {
    vary: 0.05,
    layers: [
      tone("sine", 90, 40, 0.16, 0.85, { sweep: 0.5, drive: 2, ...SIG }),
      noise("lowpass", 400, 220, 0.12, 0.6, { q: 0, clicks: 3 }),
    ],
  },
  stoneImpact: {
    vary: 0.05,
    layers: [
      tone("sine", 90, 40, 0.26, 1, { sweep: 0.4, drive: 2.5, ...SIG }),
      noise("lowpass", 400, 200, 0.2, 0.7, { q: 2, clicks: 5 }),
      noise("bandpass", 1100, 700, 0.04, 0.3, { q: 1.5 }),
    ],
  },
  pillarTelegraph: {
    layers: [
      tone("sine", 40, 40, 0.62, 0.7, { attack: 0.5, drive: 3, ...SIG }),
      noise("bandpass", 650, 400, 0.6, 0.55, { q: 2, attack: 0.4, clicks: 7 }),
    ],
  },
  pillarStrike: {
    layers: [
      tone("sine", 70, 30, 0.5, 1, { sweep: 0.4, drive: 3, ...SIG }),
      noise("lowpass", 400, 150, 0.35, 0.75, { q: 2, clicks: 6 }),
      noise("bandpass", 900, 500, 0.05, 0.35, { q: 1.2 }),
    ],
  },
  wallRise: {
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
    layers: [
      tone("sine", 80, 40, 0.4, 0.85, { sweep: 0.4, drive: 2.5, ...SIG }),
      noise("lowpass", 600, 200, 0.45, 0.7, { q: 2, clicks: 12 }),
      noise("bandpass", 1400, 900, 0.5, 0.25, { q: 2, delay: 0.06, clicks: 8 }),
    ],
  },

  // ── Общие ──
  hitTick: { layers: [tone("sine", 1800, 1800, 0.04, 0.5, { attack: 0.002 })] },
  kill: {
    layers: [
      tone("sine", 880, 880, 0.14, 0.45, { attack: 0.004 }),
      tone("sine", 1320, 1320, 0.3, 0.45, { delay: 0.09, attack: 0.004 }),
    ],
  },
  fall: {
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
};

/** Чья это подпись: Огонь, Земля или общий звук (null). Рельеф — камень Земли, чем бы по нему ни попали. */
export const SOUND_ELEMENT: Record<SoundId, Element | null> = {
  fireFist: "fire",
  fireballCharge: "fire",
  fireballBoom: "fire",
  dash: "fire",
  fireWallTelegraph: "fire",
  fireWallIgnite: "fire",
  overheat: "fire",
  stoneCast: "earth",
  stoneImpact: "earth",
  pillarTelegraph: "earth",
  pillarStrike: "earth",
  wallRise: "earth",
  quakeWindup: "earth",
  quakeStrike: "earth",
  terrainHit: "earth",
  terrainBreak: "earth",
  hitTick: null,
  kill: null,
  fall: null,
  fizzle: null,
  courage: null,
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
