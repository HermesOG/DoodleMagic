/*
 * Лист-модуль слоёв звука: типы и помощники рецептов. Его берут и общая таблица (recipes.ts), и рецепты стихий
 * (airRecipes.ts, waterRecipes.ts) — без цикла импортов между ними.
 */

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

/**
 * vary — разброс высоты ± за каждый запуск, чтобы частый звук (кулаки 5 раз в секунду) не звучал пулемётом.
 * reverb — посыл в общий реверб по ступени отклика (round3/01, A4): малая 0, средняя 0,2, крупная 0,35.
 */
export interface Recipe {
  layers: Layer[];
  vary?: number;
  reverb?: number;
}

/**
 * Посыл в реверб по ступени отклика (round3/01, 2.1). lmb — выстрелы и попадания ЛКМ (фаза 9, L1): чуть-чуть, чтобы
 * хвост выстрела звучал в пространстве, а не «в вату»; подтверждение попадания (hitLight) остаётся сухим.
 */
export const REVERB_SEND = { small: 0, lmb: 0.06, medium: 0.2, large: 0.35 } as const;

export type Opt = Partial<Pick<Layer, "q" | "delay" | "attack" | "signature" | "sweep" | "drive" | "clicks" | "ceiling">>;

export const ATTACK = 0.003;

export const noise = (filter: BiquadFilterType | null, freq: number, freqEnd: number, dur: number, gain: number, o: Opt = {}): Layer => ({
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

export const tone = (wave: OscillatorType, freq: number, freqEnd: number, dur: number, gain: number, o: Opt = {}): Layer => ({
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

export const SIG = { signature: true } as const;

/**
 * Выстрел ЛКМ в три слоя (фаза 9, L1): щелчок — шум 5–7 кГц на 4 мс, тело стихии, хвост — тихий шум 150–250 мс,
 * который уходит в реверб (REVERB_SEND.lmb). Щелчок и хвост — не подписи: подпись стихии остаётся в своей полосе.
 * У Земли щелчок свой — каменный, 1,2 кГц на 15 мс (stoneThrow).
 */
export const SHOT_CLICK: Layer = noise("bandpass", 6000, 6000, 0.004, 0.5, { q: 3, attack: 0.0005 });
