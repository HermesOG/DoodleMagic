import {
  PVP, TICK_DT, TICK_HZ, scoreOf, unitById,
  type GamePhase, type GameState, type MatchEvent, type MatchState, type UnitId,
} from "@doodlemagic/sim";

/**
 * Директор боевой музыки (фаза 9, Р7): решает, что звучит, по своим событиям и подтверждённому состоянию игры.
 * Без Web Audio: вход — время кадра, ситуация и события, выход — уровень 0–3, темп, лад, приглушение и стинги.
 * Синтез и сетка долей — в music.ts. Правила — round5/01 раздел 4 с поправками 03 и плана фазы 9.
 */

/** Фаза для музыки: фазы PvP плюс полигон (там GameState нет). */
export type MusicPhase = "training" | GamePhase;
export type MusicLevel = 0 | 1 | 2 | 3;
/** Лад: светлый — ре-минорная пентатоника, тёмный — внезапная смерть. */
export type MusicMode = "light" | "dark";
/** Стинг: удар барабана на цифру отсчёта, гонг на «Бой!», победа, поражение. */
export type MusicSting = "count" | "fight" | "win" | "lose";

/** Своё событие кадра, уже разобранное для музыки (musicCue, streakCue). */
export type MusicCue =
  /** Урон между мной и магом: я нанёс или получил; amount — сколько; dot — горение и прочий урон по тикам (без дакинга). */
  | { kind: "damage"; amount: number; dot: boolean }
  /** Своё попадание или удар по мне, не горение: короткий дакинг. */
  | { kind: "tap" }
  /** Моё убийство или засчитанный сброс. */
  | { kind: "kill" }
  /** Каст ульты: свой (mine) — пик; чужой — предупреждение. */
  | { kind: "ult"; mine: boolean }
  /** Своя серия (событие streak из sim, подтверждённое). */
  | { kind: "streak"; multi: number; streak: number }
  /** Руна ярости: объявлена (warn) или взята (take). */
  | { kind: "rune"; phase: "warn" | "take" };

/** Ситуация кадра (readSituation): фаза, время, счёт, враги рядом, ярость, смерть, чужая ульта. */
export interface MusicSituation {
  phase: MusicPhase;
  /** Секунд до конца фазы (отсчёт, бой); вне их — Infinity. */
  phaseLeftS: number;
  suddenDeath: boolean;
  myScore: number;
  /** Лучший чужой счёт; чужих нет — 0. */
  bestOther: number;
  /** Лимит очков; на полигоне — Infinity. */
  scoreLimit: number;
  /** Живых чужих магов ближе NEAR_M. */
  near: number;
  /** Я ношу ярость руны. */
  fury: boolean;
  dead: boolean;
  /** Секунд до своего возрождения; жив — 0. */
  respawnInS: number;
  /** Чужая ульта в телеграфе (замах). */
  enemyUltTelegraph: boolean;
  /** Итоги: я на первом месте. */
  won: boolean;
}
export interface DirectorInput extends MusicSituation {
  nowS: number;
  cues: readonly MusicCue[];
}
export interface MusicOut {
  /** Пэд звучит: на отсчёте — тишина, только удары на цифрах. */
  bed: boolean;
  level: MusicLevel;
  bpm: number;
  mode: MusicMode;
  /** Руна объявлена: слой «пульс» поверх уровня, пока её не взяли. */
  pulse: boolean;
  /** Матч-пойнт: лишний слой; mine — светлый (у меня), other — тёмный (у другого). */
  matchPoint: "mine" | "other" | null;
  /** Последняя минута или внезапная смерть: пэд светлее. */
  final: boolean;
  /** Дакинг по событиям, дБ (≤ 0, не глубже DUCK.floorDb). */
  duckDb: number;
  /** Своя смерть: приглушение, дБ, и lowpass; жив — 0 и null. */
  muteDb: number;
  lowpassHz: number | null;
  /** Стинги к запуску в этом кадре. */
  stings: MusicSting[];
}

export const MUSIC_BPM = 112;
/** Последняя минута и внезапная смерть. */
export const FINAL_BPM = 120;
export const NEAR_M = 15;
/** D в формуле I — урон за столько секунд, делится на DAMAGE_NORM, слагаемое не больше 0,5 (поправка 03). */
export const DAMAGE_WINDOW_S = 6;
export const DAMAGE_NORM = 90;
/** Урон от мага или по магу за столько секунд — уровень 2 сразу. */
export const FIGHT_S = 4;
export const LAST_MINUTE_S = 60;
/** Вниз — только через столько секунд ниже порога; уровень меняется не чаще CHANGE_GAP_S, всплески — BURST_GAP_S. */
export const DOWN_AFTER_S = 8;
export const CHANGE_GAP_S = 2;
export const BURST_GAP_S = 1.5;
/** Своя ульта, мульти, серия от 3 — уровень 3 на столько секунд. */
export const BOOST_S = 8;
/** Своя смерть: −8 дБ и lowpass 500 Гц до возрождения, подъём за 0,5 с до него. */
export const DEATH = { db: -8, lowpassHz: 500, riseBeforeS: 0.5 } as const;
/**
 * Дакинг: своё попадание и удар по мне −4 дБ (короткий, отпускание — в music.ts); убийство, ульта, предупреждения
 * ульты и руны, серия −8 дБ на 0,8 с; чужая ульта в телеграфе −6 дБ; вместе не глубже −10 дБ.
 */
export const DUCK = { tapDb: -4, tapHoldS: 0.03, heavyDb: -8, heavyS: 0.8, telegraphDb: -6, floorDb: -10 } as const;
/** Руна объявлена, но взятия не видели (пропал снапшот): пульс снимается сам через столько секунд. */
const RUNE_PULSE_MAX_S = 60;
/** Зерно мелодии на полигоне — постоянное. */
export const TRAINING_SEED = 0x5eed;

const MATCH_TICKS = PVP.matchS * TICK_HZ;
const SUDDEN_DEATH_TICKS = PVP.suddenDeathS * TICK_HZ;

/** Уровень по интенсивности I: < 0,15 → 0, < 0,4 → 1, < 0,7 → 2, иначе 3. */
export function levelOf(i: number): MusicLevel {
  return i < 0.15 ? 0 : i < 0.4 ? 1 : i < 0.7 ? 2 : 3;
}

/** I = min(0,5; 0,5·D/90) + 0,25·min(1; N/2) + 0,25·F, не больше 1. */
export function intensity(damage: number, near: number, final: boolean): number {
  const i = Math.min(0.5, (0.5 * damage) / DAMAGE_NORM) + 0.25 * Math.min(1, near / 2) + (final ? 0.25 : 0);
  return Math.min(1, i);
}

const isMage = (s: MatchState, id: UnitId): boolean => unitById(s, id)?.mage != null;

/**
 * Событие sim → своё событие музыки; чужое и неважное — null. state — состояние, в котором событие родилось.
 * Серии (streak) здесь не разбираются: их берут из подтверждённых событий (streakCue).
 */
export function musicCue(ev: MatchEvent, localId: UnitId, state: MatchState): MusicCue | null {
  switch (ev.type) {
    case "hit": {
      const mine = ev.source === localId && ev.target !== localId;
      const onMe = ev.target === localId && ev.source !== localId;
      if (!mine && !onMe) return null;
      // урон с магом — в бой; по манекену — только короткий дакинг
      if (ev.amount > 0 && isMage(state, mine ? ev.target : ev.source)) return { kind: "damage", amount: ev.amount, dot: ev.dot };
      return ev.dot ? null : { kind: "tap" };
    }
    case "death":
      return ev.killer === localId && ev.target !== localId ? { kind: "kill" } : null;
    case "fall":
      return ev.credit === localId && ev.target !== localId ? { kind: "kill" } : null;
    case "cast":
      return ev.slot === "x" ? { kind: "ult", mine: ev.unit === localId } : null;
    case "pickup":
      if (ev.kind !== "rune" || ev.phase === "spawn") return null;
      return { kind: "rune", phase: ev.phase };
    default:
      return null;
  }
}

/** Своя серия из подтверждённого события streak; прочее — null. */
export function streakCue(ev: MatchEvent, localId: UnitId): MusicCue | null {
  if (ev.type !== "streak" || ev.unit !== localId) return null;
  return { kind: "streak", multi: ev.multi, streak: ev.streak };
}

/** Пустая ситуация: полигон, никого рядом. Заготовка для readSituation. */
export function emptySituation(): MusicSituation {
  return {
    phase: "training", phaseLeftS: Infinity, suddenDeath: false, myScore: 0, bestOther: 0, scoreLimit: Infinity,
    near: 0, fury: false, dead: false, respawnInS: 0, enemyUltTelegraph: false, won: false,
  };
}

/**
 * Ситуация из состояния: game — подтверждённое (PvP), null — полигон; cur — «сейчас» вида (враги рядом, ярость,
 * смерть, чужая ульта). Пишет в out (вид переиспользует один объект на все кадры) и возвращает его.
 */
export function readSituation<T extends MusicSituation>(game: GameState | null, cur: MatchState, localId: UnitId, out: T): T {
  const me = unitById(cur, localId);
  let near = 0;
  let enemyUltTelegraph = false;
  const units = cur.units;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.id === localId || !u.mage || !u.alive) continue;
    const cast = u.mage.ult.cast;
    if (cast && cur.tick < cast.releaseTick) enemyUltTelegraph = true;
    if (me?.alive) {
      const a = u.move.body.pos;
      const b = me.move.body.pos;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < NEAR_M) near++;
    }
  }
  const dead = me ? !me.alive : false;
  out.near = near;
  out.enemyUltTelegraph = enemyUltTelegraph;
  out.fury = me ? me.alive && cur.tick < me.status.furyUntil : false;
  out.dead = dead;
  out.respawnInS = dead && me ? Math.max(0, (me.respawnTick - cur.tick) * TICK_DT) : 0;
  if (!game) {
    out.phase = "training";
    out.phaseLeftS = Infinity;
    out.suddenDeath = false;
    out.myScore = 0;
    out.bestOther = 0;
    out.scoreLimit = Infinity;
    out.won = false;
    return out;
  }
  let myScore = 0;
  let bestOther = 0;
  const mages = game.match.units;
  for (let i = 0; i < mages.length; i++) {
    const u = mages[i]!;
    if (!u.mage) continue;
    if (u.id === localId) myScore = scoreOf(u);
    else bestOther = Math.max(bestOther, scoreOf(u));
  }
  const timed = game.phase === "countdown" || game.phase === "live";
  out.phase = game.phase;
  out.phaseLeftS = timed ? Math.max(0, (game.phaseEnd - game.match.tick) * TICK_DT) : Infinity;
  out.suddenDeath = game.suddenDeath;
  out.myScore = myScore;
  out.bestOther = bestOther;
  out.scoreLimit = game.scoreLimit;
  out.won = game.phase === "results" && game.results[0]?.id === localId;
  return out;
}

/** Тик начала боя: один на всех в комнате, свой у каждого матча. Вне отсчёта и боя — −1. */
export function fightStartTick(game: GameState): number {
  if (game.phase === "countdown") return game.phaseEnd;
  if (game.phase !== "live") return -1;
  return game.phaseEnd - MATCH_TICKS - (game.suddenDeath ? SUDDEN_DEATH_TICKS : 0);
}

/**
 * Зерно мелодии: код комнаты и матч (тик начала боя) — у друзей одна и та же музыка; полигон — постоянное.
 * FNV-1a по строке.
 */
export function musicSeed(roomCode: string | null, game: GameState | null): number {
  if (!game || roomCode === null) return TRAINING_SEED;
  let h = 0x811c9dc5;
  const key = `${roomCode}:${fightStartTick(game)}`;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Зерно для кадра: musicSeed пересчитывается, только когда сменились код комнаты или тик начала боя (строка ключа
 * не собирается каждый кадр).
 */
export function createSeedKeeper(): (roomCode: string | null, game: GameState | null) => number {
  let room: string | null | undefined;
  let start = Number.NaN;
  let seed = TRAINING_SEED;
  return (roomCode, game) => {
    const s = game && roomCode !== null ? fightStartTick(game) : -1;
    if (roomCode !== room || s !== start) {
      room = roomCode;
      start = s;
      seed = musicSeed(roomCode, game);
    }
    return seed;
  };
}

export interface MusicDirector {
  /** Выход — один и тот же объект на все кадры (и его stings): читать до следующего step. */
  step(input: DirectorInput): MusicOut;
  readonly level: MusicLevel;
}

/**
 * Автомат директора. Уровень = max(минимум ситуации, уровень по I) в пределах фазы. Вверх — сразу (music.ts ставит
 * на ближайшую долю), вниз — через DOWN_AFTER_S ниже порога; не чаще CHANGE_GAP_S, всплески (мульти, серия, своя
 * ульта) — мимо этого правила, но не чаще BURST_GAP_S. Смена фазы и своё возрождение ставят уровень сразу.
 */
export function createMusicDirector(): MusicDirector {
  let level: MusicLevel = 0;
  let lastChangeS = -Infinity;
  let lastBurstS = -Infinity;
  let belowSinceS: number | null = null;
  /** Урон с магами за DAMAGE_WINDOW_S: время и сколько, по порядку. */
  const damageT: number[] = [];
  const damageA: number[] = [];
  let lastFightS = -Infinity;
  let boostUntilS = -Infinity;
  let runeSinceS: number | null = null;
  let tapUntilS = -Infinity;
  let heavyUntilS = -Infinity;
  let phase: MusicPhase | null = null;
  let suddenDeath = false;
  let countDigit = 0;
  let wasDead = false;

  /** Выход — один объект на все кадры, stings чистятся в начале step. */
  const out: MusicOut = {
    bed: false, level: 0, bpm: MUSIC_BPM, mode: "light", pulse: false, matchPoint: null, final: false,
    duckDb: 0, muteDb: 0, lowpassHz: null, stings: [],
  };
  const stings = out.stings;

  const forget = (): void => {
    damageT.length = 0;
    damageA.length = 0;
    lastFightS = -Infinity;
    boostUntilS = -Infinity;
  };

  return {
    get level() {
      return level;
    },
    step(inp) {
      const now = inp.nowS;
      stings.length = 0;
      let forced = false;
      let burst = false;

      // фаза: смена ставит уровень сразу; отсчёт — удар на цифру, начало боя — гонг, итоги — победа или поражение
      if (inp.phase !== phase) {
        if (inp.phase === "live" && phase === "countdown") stings.push("fight");
        if (inp.phase === "results" && phase !== null) stings.push(inp.won ? "win" : "lose");
        forget();
        phase = inp.phase;
        countDigit = 0;
        forced = true;
      }
      if (inp.phase === "countdown") {
        const digit = Math.ceil(inp.phaseLeftS - 1e-9);
        if (digit >= 1 && digit !== countDigit) stings.push("count");
        countDigit = digit;
      }
      if (inp.suddenDeath !== suddenDeath) {
        suddenDeath = inp.suddenDeath;
        forced = true;
      }

      // своя смерть забывает бой: встаю на 1, а не на 2
      if (inp.dead && !wasDead) forget();
      if (!inp.dead && wasDead) forced = true;
      wasDead = inp.dead;

      const cues = inp.cues;
      for (let i = 0; i < cues.length; i++) {
        const c = cues[i]!;
        switch (c.kind) {
          case "damage":
            damageT.push(now);
            damageA.push(c.amount);
            lastFightS = now;
            // урон по тикам (горение, Дыхание, смерч) не дёргает дакинг каждый тик
            if (!c.dot) tapUntilS = now + DUCK.tapHoldS;
            break;
          case "tap":
            tapUntilS = now + DUCK.tapHoldS;
            break;
          case "kill":
            heavyUntilS = now + DUCK.heavyS;
            break;
          case "ult":
            heavyUntilS = now + DUCK.heavyS;
            if (c.mine) {
              boostUntilS = now + BOOST_S;
              burst = true;
            }
            break;
          case "streak":
            if (c.multi >= 2 || c.streak >= 3) {
              boostUntilS = now + BOOST_S;
              heavyUntilS = now + DUCK.heavyS;
              burst = true;
            }
            break;
          case "rune":
            if (c.phase === "warn") {
              runeSinceS = now;
              heavyUntilS = now + DUCK.heavyS;
            } else runeSinceS = null;
            break;
        }
      }
      while (damageT.length > 0 && now - damageT[0]! > DAMAGE_WINDOW_S) {
        damageT.shift();
        damageA.shift();
      }
      if (runeSinceS !== null && now - runeSinceS > RUNE_PULSE_MAX_S) runeSinceS = null;

      const p = inp.phase;
      const live = p === "live";
      const lastMinute = live && !inp.suddenDeath && inp.phaseLeftS <= LAST_MINUTE_S;
      const top = Math.max(inp.myScore, inp.bestOther);
      const final = live && (lastMinute || inp.suddenDeath || top >= inp.scoreLimit - 2);
      let d = 0;
      for (let i = 0; i < damageA.length; i++) d += damageA[i]!;

      let raw = levelOf(intensity(d, inp.near, final));
      if (live || p === "warmup" || p === "training") raw = Math.max(raw, 1) as MusicLevel;
      if (now - lastFightS <= FIGHT_S) raw = Math.max(raw, 2) as MusicLevel;
      if (lastMinute) raw = Math.max(raw, 2) as MusicLevel;
      if (inp.fury || now < boostUntilS) raw = 3;
      if (live && inp.suddenDeath) raw = 3;
      if (p === "warmup" || p === "training") raw = Math.min(raw, 2) as MusicLevel;
      if (p === "countdown" || p === "results") raw = 0;

      if (forced) {
        if (raw !== level) lastChangeS = now;
        level = raw;
        belowSinceS = null;
      } else if (raw > level) {
        belowSinceS = null;
        const gapOk = now - lastChangeS >= CHANGE_GAP_S;
        const burstOk = burst && now - lastBurstS >= BURST_GAP_S;
        if (gapOk || burstOk) {
          if (burst) lastBurstS = now;
          level = raw;
          lastChangeS = now;
        }
      } else if (raw < level) {
        belowSinceS ??= now;
        if (now - belowSinceS >= DOWN_AFTER_S && now - lastChangeS >= CHANGE_GAP_S) {
          level = raw;
          lastChangeS = now;
          belowSinceS = null;
        }
      } else belowSinceS = null;

      let duckDb = 0;
      if (now < tapUntilS) duckDb += DUCK.tapDb;
      if (now < heavyUntilS) duckDb += DUCK.heavyDb;
      if (inp.enemyUltTelegraph) duckDb += DUCK.telegraphDb;
      duckDb = Math.max(DUCK.floorDb, duckDb);

      const muffled = inp.dead && inp.respawnInS > DEATH.riseBeforeS;
      const matchPoint =
        live && Number.isFinite(inp.scoreLimit)
          ? inp.myScore >= inp.scoreLimit - 1
            ? "mine"
            : inp.bestOther >= inp.scoreLimit - 1
              ? "other"
              : null
          : null;

      out.bed = p !== "countdown";
      out.level = level;
      out.bpm = lastMinute || (live && inp.suddenDeath) ? FINAL_BPM : MUSIC_BPM;
      out.mode = live && inp.suddenDeath ? "dark" : "light";
      out.pulse = runeSinceS !== null && p !== "countdown" && p !== "results";
      out.matchPoint = matchPoint;
      out.final = lastMinute || (live && inp.suddenDeath);
      out.duckDb = duckDb;
      out.muteDb = muffled ? DEATH.db : 0;
      out.lowpassHz = muffled ? DEATH.lowpassHz : null;
      return out;
    },
  };
}
