import type { MusicMode, MusicOut, MusicSting } from "./musicDirector";

/**
 * Боевая музыка «Тушь и тайко» (фаза 9, Р7): синтез и планировщик. Ре-минорная пентатоника, 112 BPM (финал 120),
 * слои: 0 пэд, 1 пульс и бас, 2 ручной барабан, деревяшка и шейкер, 3 «кото»; плюс слой матч-пойнта и стинги.
 * Своя шина: слои → highpass (саба нет: 30–100 Гц — полоса Земли) → lowpass смерти → дакинг → приглушение смерти →
 * громкость → лимитер (мимо компрессора эффектов, GameAudio.musicBus). Свои MUSIC_VOICES голосов, отдельно от
 * эффектов. Ноты ставит таймер раз в PUMP_MS на LOOKAHEAD_S вперёд по часам AudioContext, не по кадрам; вкладка
 * скрыта или музыка выключена — пауза. Ни одного звукового файла; ничего не бросает наружу.
 */

export interface MusicBus {
  ctx: BaseAudioContext;
  /** Вход лимитера (мимо компрессора). */
  out: AudioNode;
}

export interface MusicOptions {
  /** Шина музыки; null — звука ещё нет (до первого жеста) или нет вовсе. */
  bus: () => MusicBus | null;
  /** Вкладка скрыта — пауза. По умолчанию — document.visibilityState. */
  hidden?: () => boolean;
  /** Таймер планировщика: зовёт cb раз в ms, возвращает остановку. По умолчанию — setInterval. */
  every?: (cb: () => void, ms: number) => () => void;
  rand?: () => number;
}

export interface MusicStats {
  /** Звучит: шина есть, музыка включена, вкладка видна. */
  playing: boolean;
  voices: number;
  level: number;
}

export interface Music {
  /** Решение директора на кадр; стинги запускаются сразу. */
  set(out: MusicOut): void;
  /** Зерно мелодии и порядка последовательностей. */
  setSeed(seed: number): void;
  setEnabled(on: boolean): void;
  /** Громкость музыки 0…1 (1 — пики MUSIC_PEAK_DB). */
  setVolume(v: number): void;
  /** Один проход планировщика (его зовёт таймер). */
  pump(): void;
  stats(): MusicStats;
  dispose(): void;
}

export const MUSIC_VOICES = 8;
export const PUMP_MS = 25;
export const LOOKAHEAD_S = 0.15;
/**
 * Пики музыки при громкости 1: сумма пиков всех слоёв (ниже, LAYER_PEAK) — не больше 1, шина × 10^(−18/20).
 * Так музыка всегда тише ударов, которые доходят до лимитера на −3 дБ.
 */
export const MUSIC_PEAK_DB = -18;
/** Ниже этого — саба нет: 30–100 Гц — полоса Земли. */
export const MUSIC_HIGHPASS_HZ = 100;
/** Пики слоёв до шины: в сумме ≤ 1. */
export const LAYER_PEAK = { pad: 0.2, bass: 0.24, drum: 0.22, wood: 0.05, shaker: 0.02, koto: 0.18, point: 0.07 } as const;

const MUSIC_PEAK = 10 ** (MUSIC_PEAK_DB / 20);
/** Нота ставится чуть впереди currentTime: не попадает в уже идущий блок. */
const LEAD_S = 0.01;
const SILENT = 1e-4;
const TAIL_S = 0.03;
const OPEN_HZ = 20000;
const D3 = 146.83;
const D4 = 293.66;
/** Ступени лада в полутонах от ре: светлый — ре, фа, соль, ля, до; тёмный — ре, ми♭, соль, ля, си♭. */
const SCALES: Record<MusicMode, readonly number[]> = { light: [0, 3, 5, 7, 10], dark: [0, 1, 5, 7, 8] };
/** Победа — мажорная пентатоника вверх. */
const MAJOR = [0, 2, 4, 7, 9, 12];
/** Последовательности аккордов (ступени): аккорд на 2 такта, 4 аккорда — 8 тактов, ×4 — 32 такта (≈ 68 с). */
const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 2, 4, 3],
  [0, 1, 2, 3],
  [3, 2, 0, 4],
  [0, 4, 2, 1],
];
/** Ударные такта по восьмым: сила удара; 4-й такт — сбивка. */
const DRUM = [1, 0, 0, 0.55, 0.85, 0, 0.5, 0] as const;
const DRUM_FILL = [1, 0, 0, 0.55, 0.85, 0.6, 0.7, 0.8] as const;
const WOOD = [0, 0, 1, 0, 0, 0, 1, 0] as const;
const SHAKER = [0.6, 1, 0.6, 1, 0.6, 1, 0.6, 1] as const;
/** Матч-пойнт «мой»: высокие щипки 3-3-2 по восьмым, ступени от ре4 (ре5, ля5, соль5). */
const POINT_SLOTS: Readonly<Record<number, number>> = { 0: 5, 3: 8, 6: 7 };
/** Мотивов на зерно; фраза — 2 такта (16 восьмых), потом 2 такта тишины: мелодия не больше чем в половине тактов. */
const MOTIFS = 4;
const PHRASE_SLOTS = 16;
/** Слоёв: 0 пэд, 1 пульс и бас, 2 ударные, 3 мелодия, 4 матч-пойнт. */
const LAYERS = 5;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const dbToGain = (db: number) => 10 ** (db / 20);

/** Частота ступени deg лада от base (5 ступеней в октаве). */
export function degreeHz(base: number, scale: readonly number[], deg: number): number {
  const n = scale.length;
  const oct = Math.floor(deg / n);
  const idx = deg - oct * n;
  return base * 2 ** ((scale[idx]! + 12 * oct) / 12);
}

/** Детерминированный генератор (mulberry32): одно зерно — одна музыка у всех в комнате. */
export function seededRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Мотив: 16 восьмых фразы, в каждой ступень от ре4 (0…5 — ре4…ре5) или null. */
export type Motif = (number | null)[];

/**
 * Мотивы «кото» по зерну: 4–6 нот ре4–ре5, первая — на сильную долю, шаги по ладу на 1–2 ступени, последняя —
 * на тонику или квинту.
 */
export function makeMotifs(seed: number): Motif[] {
  const r = seededRand(seed ^ 0x9e3779b9);
  const out: Motif[] = [];
  for (let m = 0; m < MOTIFS; m++) {
    const n = 4 + Math.floor(r() * 3);
    // места нот: первая на 0, остальные — по случайным восьмым, чаще на долях
    const slots = new Set<number>([0]);
    while (slots.size < n) {
      const s = 1 + Math.floor(r() * (PHRASE_SLOTS - 3));
      slots.add(r() < 0.6 ? s & ~1 || 2 : s);
    }
    const order = [...slots].sort((a, b) => a - b);
    const motif: Motif = new Array<number | null>(PHRASE_SLOTS).fill(null);
    let deg = Math.floor(r() * 4);
    order.forEach((s, i) => {
      if (i === order.length - 1) deg = deg >= 2 ? 3 : 0;
      else if (i > 0) {
        const step = (r() < 0.5 ? 1 : 2) * (r() < 0.5 ? -1 : 1);
        deg = Math.min(5, Math.max(0, deg + step));
      }
      motif[s] = deg;
    });
    out.push(motif);
  }
  return out;
}

/** Голоса музыки: занят от начала ноты до конца; новый не ставится, если с ним пересекается уже MUSIC_VOICES. */
function createVoiceCount(max: number) {
  const spans: [start: number, end: number][] = [];
  return {
    tryStart(now: number, start: number, end: number): boolean {
      for (let i = spans.length - 1; i >= 0; i--) if (spans[i]![1] <= now) spans.splice(i, 1);
      let overlap = 0;
      for (const [s, e] of spans) if (e > start && s < end) overlap++;
      if (overlap >= max) return false;
      spans.push([start, end]);
      return true;
    },
    active(now: number): number {
      let n = 0;
      for (const [s, e] of spans) if (s <= now && e > now) n++;
      return n;
    },
  };
}

/** Узлы одной ноты: отключаются, когда замолк её последний источник. */
class Voice {
  readonly nodes: AudioNode[] = [];
  last: AudioScheduledSourceNode | null = null;
  lastEnd = 0;
  constructor(readonly ctx: BaseAudioContext) {}
  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  osc(type: OscillatorType, hz: number, t: number, end: number): OscillatorNode {
    const o = this.add(this.ctx.createOscillator());
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    o.start(t);
    o.stop(end + TAIL_S);
    this.track(o, end);
    return o;
  }
  noise(buf: AudioBuffer, t: number, end: number, offset: number): AudioBufferSourceNode {
    const b = this.add(this.ctx.createBufferSource());
    b.buffer = buf;
    b.loop = true;
    b.start(t, offset);
    b.stop(end + TAIL_S);
    this.track(b, end);
    return b;
  }
  filter(type: BiquadFilterType, hz: number, q?: number): BiquadFilterNode {
    const f = this.add(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = hz;
    if (q !== undefined) f.Q.value = q;
    return f;
  }
  gain(v: number): GainNode {
    const g = this.add(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }
  /** Щипок: атака, экспонента до тишины к end. */
  pluck(t: number, attack: number, peak: number, end: number): GainNode {
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(SILENT, end);
    g.gain.setValueAtTime(0, end);
    return g;
  }
  /** Тянущийся звук: атака, ровно, затухание release к end. */
  swell(t: number, attack: number, peak: number, release: number, end: number): GainNode {
    const g = this.gain(0);
    const a = Math.min(attack, (end - t) * 0.5);
    const r = Math.min(release, (end - t) * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, end - r);
    g.gain.linearRampToValueAtTime(0, end);
    return g;
  }
  private track(src: AudioScheduledSourceNode, end: number): void {
    if (!this.last || end >= this.lastEnd) [this.last, this.lastEnd] = [src, end];
  }
  done(): void {
    const nodes = this.nodes;
    if (this.last)
      this.last.onended = () => {
        for (const n of nodes) n.disconnect();
      };
  }
}

/** Пустой выход директора: тишина, пока решения не было. */
const QUIET: MusicOut = {
  bed: false, level: 0, bpm: 112, mode: "light", pulse: false, matchPoint: null, final: false,
  duckDb: 0, muteDb: 0, lowpassHz: null, stings: [],
};

interface Graph {
  ctx: BaseAudioContext;
  layers: GainNode[];
  /** Вход стингов: мимо слоёв, но через дакинг и приглушение. */
  sum: GainNode;
  lowpass: BiquadFilterNode;
  duck: GainNode;
  muffle: GainNode;
  vol: GainNode;
  noise: AudioBuffer;
}

export function createMusic(opts: MusicOptions): Music {
  const rand = opts.rand ?? Math.random;
  const hidden = opts.hidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const every =
    opts.every ??
    ((cb: () => void, ms: number) => {
      const id = setInterval(cb, ms);
      return () => clearInterval(id);
    });
  let g: Graph | null = null;
  let broken = false;
  let enabled = true;
  let volume = 0.5;
  let paused = true;
  let target: MusicOut = QUIET;
  /** Стинги к запуску: одна очередь на всё время, звука нет — не копятся. */
  const stings: MusicSting[] = [];
  let seed = 0;
  let motifs = makeMotifs(0);
  let seqStart = 0;
  const voices = createVoiceCount(MUSIC_VOICES);

  // сетка: номер доли с начала, время следующей, длина доли; лад и финал меняются с такта
  let beat = 0;
  let nextBeat = 0;
  let beatS = 60 / QUIET.bpm;
  let mode: MusicMode = "light";
  let final = false;
  let applied = 0;
  const layerOn: boolean[] = new Array<boolean>(LAYERS).fill(false);
  /** Слой выключен, но доигрывает ноты до этого времени (выход за такт). */
  const layerTail: number[] = new Array<number>(LAYERS).fill(-Infinity);
  let padUntil = -Infinity;
  let droneUntil = -Infinity;
  let duckDb = 0;
  let muteDb = 0;
  let lowpassHz: number | null = null;

  const build = (): Graph | null => {
    if (g || broken) return g;
    const b = opts.bus();
    if (!b) return null;
    const ctx = b.ctx;
    try {
      const vol = ctx.createGain();
      vol.gain.value = 0;
      vol.connect(b.out);
      const muffle = ctx.createGain();
      muffle.connect(vol);
      const duck = ctx.createGain();
      duck.connect(muffle);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = OPEN_HZ;
      lowpass.connect(duck);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = MUSIC_HIGHPASS_HZ;
      hp.Q.value = 0.7;
      hp.connect(lowpass);
      const sum = ctx.createGain();
      sum.connect(hp);
      const layers: GainNode[] = [];
      for (let i = 0; i < LAYERS; i++) {
        const l = ctx.createGain();
        l.gain.value = 0;
        l.connect(sum);
        layers.push(l);
      }
      const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
      g = { ctx, layers, sum, lowpass, duck, muffle, vol, noise };
    } catch {
      broken = true; // узлы не собрались: живём без музыки
      g = null;
    }
    return g;
  };

  const shown = (): number => (paused ? 0 : MUSIC_PEAK * volume);

  // ——— инструменты ———

  /** Пэд: аккорд из двух ступеней, каждая — два треугольника ±6 центов; шум-дыхание 800 Гц; lowpass 900 Гц. */
  const pad = (gr: Graph, t: number, end: number, deg: number): void => {
    const cut = final ? 2000 : 900;
    [deg, deg + 3].forEach((d, i) => {
      if (!voices.tryStart(gr.ctx.currentTime, t, end)) return;
      const v = new Voice(gr.ctx);
      const hz = degreeHz(D3, SCALES[mode], d);
      const env = v.swell(t, 0.8, LAYER_PEAK.pad / 2, 0.6, end);
      const lp = v.filter("lowpass", cut, 0.5);
      lp.connect(env);
      env.connect(gr.layers[0]!);
      for (const cents of [-6, 6]) {
        const o = v.osc("triangle", hz * 2 ** (cents / 1200), t, end);
        const half = v.gain(0.5);
        o.connect(half);
        half.connect(lp);
      }
      if (i === 0) {
        const n = v.noise(gr.noise, t, end, rand() * 0.9);
        const bp = v.filter("bandpass", 800, 1.2);
        const quiet = v.gain(0.08);
        n.connect(bp);
        bp.connect(quiet);
        quiet.connect(lp);
      }
      v.done();
    });
  };

  /** Бас: ступень аккорда в октаве ре3 (до — вниз, до3 131 Гц), с гармоникой ×2; саба нет. */
  const bass = (gr: Graph, t: number, deg: number, accent: number): void => {
    const end = t + 0.42;
    if (!voices.tryStart(gr.ctx.currentTime, t, end)) return;
    const v = new Voice(gr.ctx);
    let hz = degreeHz(D3, SCALES[mode], deg % 5);
    if (hz > 250) hz /= 2;
    const env = v.pluck(t, 0.005, LAYER_PEAK.bass * accent, end);
    env.connect(gr.layers[1]!);
    v.osc("sine", hz, t, end).connect(v.gain(0.75)).connect(env);
    v.osc("sine", hz * 2, t, end).connect(v.gain(0.25)).connect(env);
    v.done();
  };

  /** Ручной барабан: синус 180 → 120 Гц, атака 6 мс. */
  const drum = (gr: Graph, t: number, accent: number, dest: AudioNode, len = 0.32, peak: number = LAYER_PEAK.drum): void => {
    const end = t + len;
    if (!voices.tryStart(gr.ctx.currentTime, t, end)) return;
    const v = new Voice(gr.ctx);
    const env = v.pluck(t, 0.006, peak * accent, end);
    env.connect(dest);
    const o = v.osc("sine", 180, t, end);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    o.connect(env);
    v.done();
  };

  /** Шумовой щелчок: деревяшка (bandpass 1,6 кГц, 20 мс) или шейкер (выше 6 кГц, тихо). */
  const tick = (gr: Graph, t: number, kind: "wood" | "shaker", accent: number): void => {
    const len = kind === "wood" ? 0.02 : 0.03;
    const end = t + len;
    if (!voices.tryStart(gr.ctx.currentTime, t, end)) return;
    const v = new Voice(gr.ctx);
    const env = v.pluck(t, 0.001, (kind === "wood" ? LAYER_PEAK.wood * 4 : LAYER_PEAK.shaker) * accent, end);
    env.connect(gr.layers[2]!);
    const f = kind === "wood" ? v.filter("bandpass", 1600, 6) : v.filter("highpass", 6500, 0.7);
    v.noise(gr.noise, t, end, rand() * 0.9).connect(f);
    f.connect(env);
    v.done();
  };

  /** «Кото»: треугольник + синус ×2, фильтр 3 кГц → 800 Гц за 0,2 с, спад 0,6 с. */
  const koto = (gr: Graph, t: number, hz: number, dest: AudioNode, peak: number = LAYER_PEAK.koto, decay = 0.6): void => {
    const end = t + decay;
    if (!voices.tryStart(gr.ctx.currentTime, t, end)) return;
    const v = new Voice(gr.ctx);
    const env = v.pluck(t, 0.003, peak, end);
    env.connect(dest);
    const lp = v.filter("lowpass", 3000, 0.7);
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(800, t + 0.2);
    lp.connect(env);
    v.osc("triangle", hz, t, end).connect(v.gain(0.67)).connect(lp);
    v.osc("sine", hz * 2, t, end).connect(v.gain(0.33)).connect(lp);
    v.done();
  };

  /** Гонг 220 Гц: партиалы 1 / 2 / 2,76 / 5,4, верхние гаснут быстрее. */
  const gong = (gr: Graph, t: number, len: number, peak: number): void => {
    const end = t + len;
    if (!voices.tryStart(gr.ctx.currentTime, t, end)) return;
    const v = new Voice(gr.ctx);
    const parts: [mul: number, share: number, decay: number][] = [
      [1, 0.45, 1],
      [2, 0.25, 0.72],
      [2.76, 0.2, 0.56],
      [5.4, 0.1, 0.32],
    ];
    for (const [mul, share, decay] of parts) {
      const e = t + len * decay;
      const env = v.pluck(t, 0.005, peak * share, e);
      env.connect(gr.sum);
      v.osc("sine", 220 * mul, t, e).connect(env);
    }
    v.done();
  };

  /** Бурдон матч-пойнта «чужой»: ре3 + ля3 треугольником, глухо. */
  const drone = (gr: Graph, t: number, end: number): void => {
    if (!voices.tryStart(gr.ctx.currentTime, t, end)) return;
    const v = new Voice(gr.ctx);
    const env = v.swell(t, 0.5, LAYER_PEAK.point, 0.5, end);
    const lp = v.filter("lowpass", 500, 0.5);
    lp.connect(env);
    env.connect(gr.layers[4]!);
    for (const d of [0, 3]) v.osc("triangle", degreeHz(D3, SCALES.dark, d), t, end).connect(v.gain(0.5)).connect(lp);
    v.done();
  };

  const playSting = (gr: Graph, s: MusicSting, t: number): void => {
    if (s === "count") drum(gr, t, 1, gr.sum, 0.45, 0.3);
    else if (s === "fight") {
      // гонг и акцент; сетка начинается заново: пэд и пульс вступают с сильной доли
      gong(gr, t, 2.5, 0.26);
      drum(gr, t, 1, gr.sum, 0.45, 0.24);
      beat = 0;
      nextBeat = t;
      padUntil = -Infinity;
      droneUntil = -Infinity;
    } else if (s === "win") {
      MAJOR.forEach((semi, i) => koto(gr, t + i * 0.11, D4 * 2 ** (semi / 12), gr.sum, 0.14, 0.35));
      gong(gr, t + 0.6, 2.4, 0.22);
    } else {
      [7, 3, 0].forEach((semi, i) => koto(gr, t + i * 0.45, D4 * 2 ** (semi / 12), gr.sum, 0.16, i === 2 ? 1.5 : 0.9));
    }
  };

  // ——— сетка ———

  const chordAt = (bar: number): number => {
    const seq = PROGRESSIONS[(seqStart + Math.floor(bar / 32)) % PROGRESSIONS.length]!;
    return seq[Math.floor((bar % 8) / 2)]!;
  };

  const setLayer = (gr: Graph, i: number, on: boolean, t: number): void => {
    if (layerOn[i] === on) return;
    layerOn[i] = on;
    const p = gr.layers[i]!.gain;
    const now = gr.ctx.currentTime;
    if (on) {
      // вход: к доле уже почти полный — удар не ждёт музыку
      const from = Math.max(now, t - beatS / 2);
      p.cancelScheduledValues(from);
      p.setTargetAtTime(1, from, beatS / 6);
      layerTail[i] = -Infinity;
    } else {
      // выход — за такт; ноты доигрывают этот такт
      p.cancelScheduledValues(t);
      p.setTargetAtTime(0, t, beatS);
      layerTail[i] = t + 4 * beatS;
    }
  };
  const playing = (i: number, t: number): boolean => layerOn[i]! || t < layerTail[i]!;

  const scheduleBeat = (gr: Graph, b: number, t: number): void => {
    const bar = Math.floor(b / 4);
    const q = b % 4;
    if (q === 0) {
      beatS = 60 / (target.bpm >= 60 && target.bpm <= 240 ? target.bpm : QUIET.bpm);
      mode = target.mode;
      final = target.final;
    }
    // уровень: вверх — с этой доли, вниз — с такта
    if (target.level > applied || (q === 0 && target.level < applied)) applied = target.level;
    const bed = target.bed;
    setLayer(gr, 0, bed, t);
    setLayer(gr, 1, bed && (applied >= 1 || target.pulse), t);
    setLayer(gr, 2, bed && applied >= 2, t);
    setLayer(gr, 3, bed && applied >= 3, t);
    setLayer(gr, 4, bed && applied >= 1 && target.matchPoint !== null, t);

    const half = beatS / 2;
    const chord = chordAt(bar);
    // пэд: аккорд раз в 2 такта; вступил посреди — до ближайшей смены
    if (playing(0, t) && ((q === 0 && bar % 2 === 0) || padUntil <= t)) {
      padUntil = t + (8 - (b % 8)) * beatS;
      pad(gr, t, padUntil, chord);
    }
    if (playing(1, t)) {
      if (q === 0) bass(gr, t, chord, 1);
      if (q === 2) bass(gr, t + half, chord, 0.75);
      // руна объявлена: пульс на каждую долю
      if (target.pulse && (q === 1 || q === 3)) bass(gr, t, chord, 0.45);
    }
    if (playing(2, t)) {
      const pattern = bar % 4 === 3 ? DRUM_FILL : DRUM;
      for (const k of [0, 1]) {
        const s = q * 2 + k;
        const ts = t + k * half;
        const hit = pattern[s] ?? 0;
        const wood = WOOD[s] ?? 0;
        if (hit > 0) drum(gr, ts, hit, gr.layers[2]!);
        if (wood > 0) tick(gr, ts, "wood", wood);
        tick(gr, ts, "shaker", SHAKER[s] ?? 0.6);
      }
    }
    if (playing(3, t) && bar % 4 < 2) {
      const motif = motifs[Math.floor(bar / 4) % motifs.length]!;
      for (const k of [0, 1]) {
        const deg = motif[(bar % 4) * 8 + q * 2 + k];
        if (deg !== null && deg !== undefined) koto(gr, t + k * half, degreeHz(D4, SCALES[mode], deg), gr.layers[3]!);
      }
    }
    const point = playing(4, t) ? target.matchPoint : null;
    if (point === "mine") {
      for (const k of [0, 1]) {
        const deg = POINT_SLOTS[q * 2 + k];
        if (deg !== undefined) koto(gr, t + k * half, degreeHz(D4, SCALES.light, deg), gr.layers[4]!, LAYER_PEAK.point, 0.35);
      }
    } else if (point === "other" && ((q === 0 && bar % 2 === 0) || droneUntil <= t)) {
      droneUntil = t + (8 - (b % 8)) * beatS;
      drone(gr, t, droneUntil);
    }
  };

  const applyMix = (gr: Graph): void => {
    const now = gr.ctx.currentTime;
    gr.vol.gain.setTargetAtTime(shown(), now, 0.05);
  };

  const pump = (): void => {
    const gr = build();
    if (!gr) {
      // до первого жеста звука нет: стинги не копятся и не играют потом пачкой
      stings.length = 0;
      return;
    }
    try {
      const now = gr.ctx.currentTime;
      const stop = !enabled || hidden() || gr.ctx.state !== "running";
      if (stop !== paused) {
        paused = stop;
        applyMix(gr);
        // после паузы сетка идёт от «сейчас»: ноты в прошлое не ставятся
        if (!paused) nextBeat = now + LEAD_S;
      }
      if (paused) {
        stings.length = 0;
        return;
      }
      for (let i = 0; i < stings.length; i++) playSting(gr, stings[i]!, now + LEAD_S);
      stings.length = 0;
      if (nextBeat < now + LEAD_S) nextBeat = now + LEAD_S;
      while (nextBeat < now + LOOKAHEAD_S) {
        scheduleBeat(gr, beat, nextBeat);
        beat++;
        nextBeat += beatS;
      }
    } catch {
      // эта доля пропала, игра идёт дальше
    }
  };

  const stopTimer = every(pump, PUMP_MS);

  return {
    set(out) {
      target = out;
      for (let i = 0; i < out.stings.length; i++) stings.push(out.stings[i]!);
      const gr = g;
      if (gr) {
        try {
          const now = gr.ctx.currentTime;
          if (out.duckDb !== duckDb) {
            // вниз — атака 10 мс, назад — отпускание 250 мс
            gr.duck.gain.setTargetAtTime(dbToGain(out.duckDb), now, out.duckDb < duckDb ? 0.004 : 0.08);
            duckDb = out.duckDb;
          }
          if (out.muteDb !== muteDb || out.lowpassHz !== lowpassHz) {
            // смерть: глохнет за 0,3 с, подъём — за 0,5 с
            const tc = out.muteDb < muteDb ? 0.1 : 0.17;
            gr.muffle.gain.setTargetAtTime(dbToGain(out.muteDb), now, tc);
            gr.lowpass.frequency.setTargetAtTime(out.lowpassHz ?? OPEN_HZ, now, tc);
            muteDb = out.muteDb;
            lowpassHz = out.lowpassHz;
          }
        } catch {
          // приглушение не встало — музыка звучит как есть
        }
      }
      if (stings.length > 0) pump();
    },
    setSeed(s) {
      if (s === seed) return;
      seed = s;
      motifs = makeMotifs(s);
      seqStart = Math.floor(seededRand(s)() * PROGRESSIONS.length);
    },
    setEnabled(on) {
      enabled = on;
      pump();
    },
    setVolume(v) {
      if (!Number.isFinite(v)) return;
      volume = clamp01(v);
      if (g) {
        try {
          applyMix(g);
        } catch {
          // громкость встанет при следующей
        }
      }
    },
    pump,
    stats() {
      return { playing: g !== null && !paused, voices: g ? voices.active(g.ctx.currentTime) : 0, level: applied };
    },
    dispose() {
      stopTimer();
      try {
        g?.vol.disconnect();
      } catch {
        // уже отключено
      }
      g = null;
      broken = true;
    },
  };
}
