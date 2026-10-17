import type { Vec3 } from "@doodlemagic/sim";
import type { SoundId } from "../feel/effects";
import { createRateLimiter, spatial } from "./pan";
import { RECIPES, recipeLength, type Layer, type Recipe } from "./recipes";
import { createVoiceLimiter } from "./voices";

/** Голосов одновременно (голос — сыгранный звук со всеми слоями); лишние не запускаются. */
export const MAX_VOICES = 24;
/** «Тик» попадания не чаще 4 раз в секунду: кулаки бьют 5 раз в секунду, а тик не должен трещать. */
export const HIT_TICK_PER_S = 4;
/**
 * За спиной у звука приглушается верх: StereoPanner перед и зад не различает. Полка −6 дБ выше 3 кГц,
 * а не lowpass: треск Огня (2–8 кГц) и сзади остаётся треском.
 */
export const BEHIND_SHELF_HZ = 3000;
export const BEHIND_SHELF_DB = -6;
/**
 * Мастер-компрессор — свой выбор: порог −12 дБ и 4:1 прижимают только пачку ударов, одиночный звук проходит
 * почти как есть; атака 3 мс ловит транзиент, отпускание 150 мс не «качает» хвосты.
 */
export const COMPRESSOR = { threshold: -12, ratio: 4, knee: 6, attack: 0.003, release: 0.15 } as const;
/**
 * Потолок после компрессора: его автоматическая компенсация (около +5 дБ) и 3–4 тяжёлых удара Земли разом
 * иначе уходят за 0 дБFS и хрипят.
 */
export const LIMITER = { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 } as const;
export const DEFAULT_VOLUME = 0.7;
/** Голос ставится чуть впереди currentTime: начало тона не попадает в уже идущий блок и не щёлкает. */
export const START_LEAD_S = 0.005;

const NOISE_S = 1;
/** Цель экспоненты: в Web Audio экспонента до нуля не доходит. */
const SILENT = 1e-4;
/** Источник останавливается чуть позже конца огибающей. */
const TAIL_S = 0.03;
/** Громкость шума между щелчками треска, доля от огибающей. */
const CLICK_BED = 0.25;
const CLICK_LEN_S = 0.012;
const CLICK_RISE_S = 0.001;
/** Тише этого голос не стоит места. */
const MIN_LEVEL = 0.003;
const MAX_EVENT_GAIN = 1;
const VOLUME_TC_S = 0.015;

export interface AudioStats {
  unlocked: boolean;
  voices: number;
  volume: number;
  muted: boolean;
}

export interface GameAudio {
  /** Создаёт AudioContext при первом вызове — звать из обработчика жеста (клик «Играть»); дальше будит усыплённый. */
  unlock(): void;
  setListener(pos: Vec3, yaw: number): void;
  /** pos null — у слушателя. До unlock(), без звука или при паузе контекста ничего не делает. */
  play(id: SoundId, pos: Vec3 | null, gain: number): void;
  /** Мастер-громкость 0…1. */
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  stats(): AudioStats;
}

export interface AudioOptions {
  /** Конструктор контекста; null — Web Audio нет. По умолчанию — браузерный AudioContext. */
  contextClass?: (new (options?: AudioContextOptions) => AudioContext) | null;
  rand?: () => number;
}

/** Общее для всех голосов одного контекста: буфер шума, случайность и кривые перегруза. */
export interface VoiceKit {
  noise: AudioBuffer;
  rand: () => number;
  curve(drive: number): Float32Array<ArrayBuffer>;
}

export interface ScheduledRecipe {
  /** Все созданные узлы, источники тоже: их отключают, когда голос отзвучал. */
  nodes: AudioNode[];
  /** Источник, который замолкает последним. */
  last: AudioScheduledSourceNode;
  end: number;
}

/** Перегруз tanh(k·x), нормированный так, что ±1 остаётся ±1. */
export function driveCurve(drive: number, n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(drive * ((i / (n - 1)) * 2 - 1)) / norm;
  return c;
}

/** n щелчков [начало, длина] внутри слоя длиной dur: по одному в своём отрезке, случайно внутри него. */
export function clickTimes(n: number, dur: number, rand: () => number): [t: number, len: number][] {
  const slot = dur / n;
  const len = Math.min(CLICK_LEN_S, slot * 0.4);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([i * slot + Math.min(rand(), 0.999) * (slot - len), len]);
  return out;
}

export function createVoiceKit(ctx: BaseAudioContext, rand: () => number): VoiceKit {
  const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * NOISE_S), ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  const curves = new Map<number, Float32Array<ArrayBuffer>>();
  return {
    noise,
    rand,
    curve(drive) {
      let c = curves.get(drive);
      if (!c) curves.set(drive, (c = driveCurve(drive)));
      return c;
    },
  };
}

/** Ставит все слои рецепта с момента t0 в узел out. Годится и для OfflineAudioContext (прослушка, предрендер). */
export function scheduleRecipe(ctx: BaseAudioContext, recipe: Recipe, out: AudioNode, t0: number, kit: VoiceKit): ScheduledRecipe {
  const pitch = 1 + (kit.rand() * 2 - 1) * (recipe.vary ?? 0);
  const nodes: AudioNode[] = [];
  let last: AudioScheduledSourceNode | null = null;
  let end = t0;
  for (const l of recipe.layers) {
    const v = scheduleLayer(ctx, l, out, t0, pitch, kit, nodes);
    if (!last || v.end > end) [last, end] = [v.src, v.end];
  }
  if (!last) throw new Error("recipe without layers");
  return { nodes, last, end };
}

function scheduleLayer(ctx: BaseAudioContext, l: Layer, out: AudioNode, t0: number, pitch: number, kit: VoiceKit, nodes: AudioNode[]) {
  const s = t0 + l.delay;
  const e = s + l.dur;
  const f0 = l.freq * pitch;
  const f1 = l.freqEnd * pitch;
  const sweepEnd = s + l.dur * (l.sweep ?? 1);

  let src: AudioScheduledSourceNode;
  let begin: () => void;
  if (l.kind === "tone") {
    const osc = ctx.createOscillator();
    osc.type = l.wave ?? "sine";
    glide(osc.frequency, f0, f1, s, sweepEnd);
    src = osc;
    begin = () => osc.start(s);
  } else {
    const b = ctx.createBufferSource();
    b.buffer = kit.noise;
    b.loop = true;
    src = b;
    const offset = kit.rand() * NOISE_S; // каждый запуск — другой кусок шума
    begin = () => b.start(s, offset);
  }
  nodes.push(src);
  let head: AudioNode = src;
  const chain = (n: AudioNode) => {
    head.connect(n);
    head = n;
    nodes.push(n);
  };

  if (l.filter) {
    const f = ctx.createBiquadFilter();
    f.type = l.filter;
    if (l.q !== undefined) f.Q.value = l.q;
    glide(f.frequency, f0, f1, s, sweepEnd);
    chain(f);
  }
  if (l.ceiling) {
    const top = ctx.createBiquadFilter();
    top.type = "lowpass";
    top.frequency.value = l.ceiling;
    chain(top);
  }
  if (l.drive) {
    const ws = ctx.createWaveShaper();
    ws.curve = kit.curve(l.drive);
    ws.oversample = "2x";
    chain(ws);
  }

  const env = ctx.createGain();
  const a = Math.min(Math.max(l.attack, 0.001), l.dur * 0.9);
  env.gain.value = 0;
  env.gain.setValueAtTime(0, s);
  env.gain.linearRampToValueAtTime(l.gain, s + a);
  env.gain.exponentialRampToValueAtTime(SILENT, e);
  env.gain.setValueAtTime(0, e);
  chain(env);

  if (l.clicks) {
    const m = ctx.createGain();
    m.gain.value = CLICK_BED;
    for (const [tc, len] of clickTimes(l.clicks, l.dur, kit.rand)) {
      m.gain.setValueAtTime(CLICK_BED, s + tc);
      m.gain.linearRampToValueAtTime(1, s + tc + CLICK_RISE_S);
      m.gain.linearRampToValueAtTime(CLICK_BED, s + tc + len);
    }
    chain(m);
  }

  head.connect(out);
  begin();
  src.stop(e + TAIL_S);
  return { src, end: e + TAIL_S };
}

function glide(p: AudioParam, from: number, to: number, s: number, until: number): void {
  p.setValueAtTime(from, s);
  if (to !== from) p.exponentialRampToValueAtTime(to, until);
}

function browserContextClass(): AudioOptions["contextClass"] {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Синтезатор: шум и тон → фильтр → перегруз → огибающая → голос (громкость события ≤ 1 × расстояние)
 * → [полка −6 дБ, если за спиной] → StereoPanner → мастер → компрессор → лимитер → выход. Ни одного звукового файла.
 * Ни unlock, ни play не бросают: звук — не повод уронить кадр.
 */
export function createAudio(opts: AudioOptions = {}): GameAudio {
  const rand = opts.rand ?? Math.random;
  let contextClass = opts.contextClass;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let kit: VoiceKit | null = null;
  let volume = DEFAULT_VOLUME;
  let muted = false;
  const listener = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
  const voices = createVoiceLimiter(MAX_VOICES);
  const tickOk = createRateLimiter(HIT_TICK_PER_S);

  const applyMaster = () => {
    if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, VOLUME_TC_S);
  };
  const wake = (c: AudioContext) => {
    const state: string = c.state; // "interrupted" — iOS: звонок, Siri; в типах DOM его может не быть
    if (state !== "suspended" && state !== "interrupted") return;
    try {
      c.resume().catch(() => {});
    } catch {
      // разбудим при следующем жесте
    }
  };
  const compressor = (c: AudioContext, k: typeof COMPRESSOR | typeof LIMITER) => {
    const n = c.createDynamicsCompressor();
    n.threshold.value = k.threshold;
    n.knee.value = k.knee;
    n.ratio.value = k.ratio;
    n.attack.value = k.attack;
    n.release.value = k.release;
    return n;
  };

  return {
    unlock() {
      if (ctx) return wake(ctx);
      if (contextClass === undefined) contextClass = browserContextClass();
      if (!contextClass) return;
      let c: AudioContext;
      try {
        c = new contextClass({ latencyHint: "interactive" });
      } catch {
        contextClass = null; // браузер не дал: живём без звука
        return;
      }
      try {
        const comp = compressor(c, COMPRESSOR);
        const limiter = compressor(c, LIMITER);
        comp.connect(limiter);
        limiter.connect(c.destination);
        const m = c.createGain();
        m.gain.value = muted ? 0 : volume;
        m.connect(comp);
        kit = createVoiceKit(c, rand);
        master = m;
      } catch {
        kit = null;
        contextClass = null; // узлы не собрались: живём без звука
        try {
          c.close().catch(() => {});
        } catch {
          // уже закрыт
        }
        return;
      }
      ctx = c;
      wake(c);
    },

    setListener(pos, yaw) {
      listener.pos.x = pos.x;
      listener.pos.y = pos.y;
      listener.pos.z = pos.z;
      listener.yaw = yaw;
    },

    play(id, pos, gain) {
      if (!ctx || !master || !kit || muted || ctx.state !== "running") return;
      if (!(gain > 0) || !Number.isFinite(gain)) return;
      let bus: GainNode | null = null;
      try {
        const now = ctx.currentTime;
        if (id === "hitTick" && !tickOk(now)) return;
        const sp = spatial(listener, pos);
        const level = Math.min(gain, MAX_EVENT_GAIN) * sp.gain;
        // NaN во взгляде или позиции: AudioParam бросил бы TypeError
        if (!(level >= MIN_LEVEL) || !Number.isFinite(level) || !Number.isFinite(sp.pan)) return;
        const recipe = RECIPES[id];
        const t0 = now + START_LEAD_S;
        if (!voices.tryStart(now, t0 + recipeLength(recipe) + TAIL_S)) return;

        bus = ctx.createGain();
        bus.gain.value = level;
        const voiceNodes: AudioNode[] = [bus];
        let head: AudioNode = bus;
        if (sp.behind) {
          const shelf = ctx.createBiquadFilter();
          shelf.type = "highshelf";
          shelf.frequency.value = BEHIND_SHELF_HZ;
          shelf.gain.value = BEHIND_SHELF_DB;
          head.connect(shelf);
          head = shelf;
          voiceNodes.push(shelf);
        }
        if (typeof ctx.createStereoPanner === "function") {
          const p = ctx.createStereoPanner();
          p.pan.value = sp.pan;
          head.connect(p);
          head = p;
          voiceNodes.push(p);
        }
        head.connect(master);

        const v = scheduleRecipe(ctx, recipe, bus, t0, kit);
        voiceNodes.push(...v.nodes);
        v.last.onended = () => {
          for (const n of voiceNodes) n.disconnect();
        };
      } catch {
        // этот звук пропал, игра идёт дальше; недособранный голос отрезаем от мастера
        try {
          bus?.disconnect();
        } catch {
          // нечего отключать
        }
      }
    },

    setVolume(v) {
      if (!Number.isFinite(v)) return;
      volume = clamp01(v);
      applyMaster();
    },

    setMuted(m) {
      muted = m;
      applyMaster();
    },

    stats() {
      return { unlocked: ctx !== null, voices: ctx ? voices.active(ctx.currentTime) : 0, volume, muted };
    },
  };
}

/**
 * Будит звук по жесту: первый клик, касание или клавиша создаёт контекст, следующие будят его, если браузер усыпил
 * (вкладка в фоне, звонок на телефоне). pointerup и click — для iOS: там звук разрешает конец касания,
 * а не pointerdown. Возвращает отписку.
 */
export function unlockOnGesture(audio: Pick<GameAudio, "unlock">, target: EventTarget = window): () => void {
  const types = ["pointerdown", "pointerup", "click", "keydown"] as const;
  const onGesture = () => audio.unlock();
  for (const t of types) target.addEventListener(t, onGesture, true);
  return () => {
    for (const t of types) target.removeEventListener(t, onGesture, true);
  };
}
