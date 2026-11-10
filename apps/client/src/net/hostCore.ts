import {
  BOT_NAMES, BOT_TAG, PVP, addMage, botClaim, buildNav, claimsFor, clonePlain, createBot, createGame, removeMage, setElement as setMageElement,
  startCountdown, stepBot, stepGame,
  type BotLevel, type BotState, type BotWorld, type Element, type GameState, type GameStep, type MatchContext, type MatchEvent,
  type MatchInput, type NavGrid, type UnitId,
} from "@doodlemagic/sim";
import { createInputQueue, pushInputs, takeInput, type InputQueue } from "./inputQueue";
import { BOT_PING, NAME_MAX, cleanName, type SeqInput } from "./protocol";
import { SNAPSHOT_EVERY_TICKS, type SnapshotMsg } from "./snapshot";

/**
 * Ядро хоста: власть над игрой без сети. Игроки по peer (PeerJS-ID), у каждого удалённого — своя очередь ввода;
 * тик 60 Гц крутит stepGame, каждый SNAPSHOT_EVERY_TICKS-й тик собирает снапшот. Состояние только заменяется новым,
 * старое не меняется. Боты (фаза 8) — такие же игроки без очереди: их ввод даёт stepBot в тике, до stepGame.
 */

/** peer игрока за браузером хоста: его ввод приходит в tick, а не по сети. */
export const LOCAL_PEER = "local";
const FALLBACK_NAME = "Маг";
/** peer бота: в PeerJS таких id нет, с игроком не спутать. */
const BOT_PEER = "bot:";

/** Бот в составе: id мага, уровень, стихия сейчас и цель (botClaim: id мага, RUNE_CLAIM или NOBODY). */
export interface BotInfo { id: UnitId; level: BotLevel; element: Element; claim: number }

export interface HostCoreOptions {
  /** Сид PRNG ботов (у каждого — сид и его id). Нет — 1. */
  seed?: number;
}

export interface HostCore {
  readonly game: GameState;
  readonly prevGame: GameState;
  join(peer: string, name: string, element: Element, nowMs: number): { ok: true; id: UnitId } | { ok: false; reason: "full" };
  leave(peer: string): void;
  inputs(peer: string, items: readonly SeqInput[], nowMs: number): void;
  setElement(peer: string, element: Element): void;
  setPing(peer: string, ms: number): void;
  /** Разминка или итоги → отсчёт; иначе false. */
  start(): boolean;
  /** Тик хоста: local — ввод игрока за этим браузером (LOCAL_PEER). Каждый SNAPSHOT_EVERY_TICKS-й тик — снапшот. */
  tick(local: MatchInput | null, nowMs: number): { step: GameStep; snapshot: SnapshotMsg | null };
  idOf(peer: string): UnitId | null;
  names(): ReadonlyMap<UnitId, string>;
  pings(): ReadonlyMap<UnitId, number>;
  /** Бот в комнату: имя «Фитиль · бот» — следующее свободное той же стихии. Комната полна — full. */
  addBot(element: Element, level: BotLevel): { ok: true; id: UnitId } | { ok: false; reason: "full" };
  /** Без id — последний добавленный. false — ботов нет (или id не бот). */
  removeBot(id?: UnitId): boolean;
  bots(): readonly BotInfo[];
  /** Сложность всех ботов комнаты (Р16): мозг бота начинает заново, маг и счёт остаются. */
  setBotLevel(level: BotLevel): void;
}

/** queue — только у удалённых игроков; ping −1 — ещё неизвестен, у хоста 0, у бота BOT_PING; bot — мозг бота. */
interface Player { id: UnitId; name: string; ping: number; queue: InputQueue | null; bot: BotState | null }

/**
 * Имя, свободное среди taken (там имена в нижнем регистре): «Искра», занято — «Искра 2», «Искра 3»… Основа
 * обрезается по кодовым точкам, чтобы с номером влезть в NAME_MAX.
 */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = Array.from(base).slice(0, NAME_MAX - suffix.length).join("").trimEnd() + suffix;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export function createHostCore(ctx: MatchContext, opts: HostCoreOptions = {}): HostCore {
  const seed = opts.seed ?? 1;
  let game = createGame();
  let prevGame = game;
  /** Порядок вставки — порядок входа, то есть по возрастанию id (id не переиспользуются). */
  const players = new Map<string, Player>();
  /** События с прошлого снапшота: [match.tick до шага, событие]. */
  let pending: [number, MatchEvent][] = [];
  /** Сетка навигации ботов: строится при первом боте, один раз. */
  let nav: NavGrid | null = null;
  let botSerial = 0;

  const takenNames = (): Set<string> => new Set(Array.from(players.values(), (p) => p.name.toLowerCase()));

  function removeBot(id?: UnitId): boolean {
    let found: [string, Player] | null = null;
    for (const entry of players) if (entry[1].bot && (id === undefined || entry[1].id === id)) found = entry;
    if (!found) return false;
    game = removeMage(game, found[1].id);
    players.delete(found[0]);
    return true;
  }

  function join(peer: string, name: string, element: Element, _nowMs: number): { ok: true; id: UnitId } | { ok: false; reason: "full" } {
    const known = players.get(peer);
    if (known) return { ok: true, id: known.id }; // повторный join того же peer — тот же маг
    // человеку бот уступает место всегда (Р16): уходит последний добавленный
    if (players.size >= PVP.maxPlayers) removeBot();
    if (players.size >= PVP.maxPlayers) return { ok: false, reason: "full" };
    const taken = takenNames();
    const r = addMage(game, element, ctx);
    game = r.game;
    const queue = peer === LOCAL_PEER ? null : createInputQueue();
    players.set(peer, { id: r.id, name: uniqueName(cleanName(name) || FALLBACK_NAME, taken), ping: queue ? -1 : 0, queue, bot: null });
    return { ok: true, id: r.id };
  }

  function addBot(element: Element, level: BotLevel): { ok: true; id: UnitId } | { ok: false; reason: "full" } {
    if (players.size >= PVP.maxPlayers) return { ok: false, reason: "full" };
    nav ??= buildNav(ctx.world, ctx.killBelowY);
    const taken = takenNames();
    // следующее свободное имя той же стихии; все заняты — первое с номером
    const pool = BOT_NAMES[element].map((n) => n + BOT_TAG);
    const name = pool.find((n) => !taken.has(n.toLowerCase())) ?? uniqueName(pool[0]!, taken);
    const r = addMage(game, element, ctx);
    game = r.game;
    players.set(`${BOT_PEER}${++botSerial}`, { id: r.id, name, ping: BOT_PING, queue: null, bot: createBot(r.id, level, seed) });
    return { ok: true, id: r.id };
  }

  function leave(peer: string): void {
    const p = players.get(peer);
    if (!p) return;
    game = removeMage(game, p.id);
    players.delete(peer);
  }

  /**
   * Ввод ботов на тик (до stepGame): боты шагают по очереди, по возрастанию id; claims каждого — по уже шагнувшим
   * в этом тике и по остальным до шага (иначе двое, задумавшиеся на одном тике, пробьют квоту на человека, Р8).
   * humans — id не-ботов.
   */
  function stepBots(inputs: Partial<Record<UnitId, MatchInput>>): void {
    if (!nav) return;
    const all: BotState[] = [];
    const humans: UnitId[] = [];
    for (const p of players.values()) {
      if (p.bot) all.push(p.bot);
      else humans.push(p.id);
    }
    if (all.length === 0) return;
    const base: Omit<BotWorld, "claims"> = { nav, ctx, humans };
    // players — по возрастанию id, all — в том же порядке
    let k = 0;
    for (const p of players.values()) {
      if (!p.bot) continue;
      const r = stepBot(p.bot, game.match, { ...base, claims: claimsFor(all, p.id) });
      p.bot = r.bot;
      all[k++] = r.bot;
      inputs[p.id] = r.input;
    }
  }

  /** Снапшот после шага: глубокая копия, живого состояния хоста в нём нет. */
  function snapshot(inputs: Readonly<Partial<Record<UnitId, MatchInput>>>): SnapshotMsg {
    const looks: SnapshotMsg["looks"] = [];
    for (const u of game.match.units) {
      if (!u.mage) continue;
      const inp = inputs[u.id];
      // прыжок зажат — чужое парение в переигровке игрока не обрывается (Р16)
      looks.push(inp ? [u.id, inp.moveX, inp.moveZ, inp.yaw, inp.pitch, inp.jump ? 1 : 0] : [u.id, 0, 0, u.move.yaw, u.move.pitch, 0]);
    }
    const acks: SnapshotMsg["acks"] = [];
    const roster: SnapshotMsg["roster"] = [];
    for (const p of players.values()) {
      if (p.queue) acks.push([p.id, p.queue.ack]);
      roster.push([p.id, p.name, p.ping]);
    }
    return clonePlain({ tick: game.match.tick, game, acks, looks, roster, events: pending });
  }

  function tick(local: MatchInput | null, nowMs: number): { step: GameStep; snapshot: SnapshotMsg | null } {
    // takeInput отдаёт общий объект q.last на повторах: вводы только читаются
    const inputs: Partial<Record<UnitId, MatchInput>> = {};
    for (const p of players.values()) {
      if (p.bot) continue;
      const inp = p.queue ? takeInput(p.queue, nowMs) : local;
      if (inp) inputs[p.id] = inp;
    }
    stepBots(inputs);
    const before = game;
    const step = stepGame(before, inputs, ctx);
    prevGame = before;
    game = step.game;
    for (const e of step.events) pending.push([before.match.tick, e]);
    if (game.match.tick % SNAPSHOT_EVERY_TICKS !== 0) return { step, snapshot: null };
    const snap = snapshot(inputs);
    pending = [];
    return { step, snapshot: snap };
  }

  const byId = <T>(value: (p: Player) => T): ReadonlyMap<UnitId, T> => new Map(Array.from(players.values(), (p) => [p.id, value(p)]));

  return {
    get game() {
      return game;
    },
    get prevGame() {
      return prevGame;
    },
    join,
    leave,
    inputs(peer, items, nowMs) {
      const q = players.get(peer)?.queue;
      if (q) pushInputs(q, items, nowMs);
    },
    setElement(peer, element) {
      const p = players.get(peer);
      if (p) game = setMageElement(game, p.id, element, ctx);
    },
    setPing(peer, ms) {
      const p = players.get(peer);
      if (p?.queue) p.ping = ms; // у хоста всегда 0, у бота BOT_PING
    },
    start() {
      if (game.phase !== "warmup" && game.phase !== "results") return false;
      game = startCountdown(game);
      return true;
    },
    tick,
    idOf: (peer) => players.get(peer)?.id ?? null,
    names: () => byId((p) => p.name),
    pings: () => byId((p) => p.ping),
    addBot,
    removeBot,
    bots() {
      const out: BotInfo[] = [];
      for (const p of players.values()) {
        if (!p.bot) continue;
        const element = game.match.units.find((u) => u.id === p.id)?.mage?.element;
        if (element) out.push({ id: p.id, level: p.bot.level, element, claim: botClaim(p.bot) });
      }
      return out;
    },
    setBotLevel(level) {
      for (const p of players.values()) if (p.bot && p.bot.level !== level) p.bot = createBot(p.id, level, seed);
    },
  };
}

/** Стихия нового бота у хоста PvP (Р16): самая редкая среди магов комнаты, при равенстве — первая по ELEMENTS. */
export function rarestElement(g: Readonly<GameState>, elements: readonly Element[]): Element {
  const count = new Map<Element, number>(elements.map((e) => [e, 0]));
  for (const u of g.match.units) if (u.mage) count.set(u.mage.element, (count.get(u.mage.element) ?? 0) + 1);
  let best = elements[0]!;
  for (const e of elements) if (count.get(e)! < count.get(best)!) best = e;
  return best;
}
