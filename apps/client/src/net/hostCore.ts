import {
  PVP, addMage, clonePlain, createGame, removeMage, setElement as setMageElement, startCountdown, stepGame,
  type Element, type GameState, type GameStep, type MatchContext, type MatchEvent, type MatchInput, type UnitId,
} from "@doodlemagic/sim";
import { createInputQueue, pushInputs, takeInput, type InputQueue } from "./inputQueue";
import { NAME_MAX, cleanName, type SeqInput } from "./protocol";
import { SNAPSHOT_EVERY_TICKS, type SnapshotMsg } from "./snapshot";

/**
 * Ядро хоста: власть над игрой без сети. Игроки по peer (PeerJS-ID), у каждого удалённого — своя очередь ввода;
 * тик 60 Гц крутит stepGame, каждый SNAPSHOT_EVERY_TICKS-й тик собирает снапшот. Состояние только заменяется новым,
 * старое не меняется.
 */

/** peer игрока за браузером хоста: его ввод приходит в tick, а не по сети. */
export const LOCAL_PEER = "local";
const FALLBACK_NAME = "Маг";

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
}

/** queue — только у удалённых игроков; ping −1 — ещё неизвестен, у хоста 0. */
interface Player { id: UnitId; name: string; ping: number; queue: InputQueue | null }

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

export function createHostCore(ctx: MatchContext): HostCore {
  let game = createGame();
  let prevGame = game;
  /** Порядок вставки — порядок входа, то есть по возрастанию id (id не переиспользуются). */
  const players = new Map<string, Player>();
  /** События с прошлого снапшота: [match.tick до шага, событие]. */
  let pending: [number, MatchEvent][] = [];

  function join(peer: string, name: string, element: Element, _nowMs: number): { ok: true; id: UnitId } | { ok: false; reason: "full" } {
    const known = players.get(peer);
    if (known) return { ok: true, id: known.id }; // повторный join того же peer — тот же маг
    if (players.size >= PVP.maxPlayers) return { ok: false, reason: "full" };
    const taken = new Set(Array.from(players.values(), (p) => p.name.toLowerCase()));
    const r = addMage(game, element, ctx);
    game = r.game;
    const queue = peer === LOCAL_PEER ? null : createInputQueue();
    players.set(peer, { id: r.id, name: uniqueName(cleanName(name) || FALLBACK_NAME, taken), ping: queue ? -1 : 0, queue });
    return { ok: true, id: r.id };
  }

  function leave(peer: string): void {
    const p = players.get(peer);
    if (!p) return;
    game = removeMage(game, p.id);
    players.delete(peer);
  }

  /** Снапшот после шага: глубокая копия, живого состояния хоста в нём нет. */
  function snapshot(inputs: Readonly<Partial<Record<UnitId, MatchInput>>>): SnapshotMsg {
    const looks: SnapshotMsg["looks"] = [];
    for (const u of game.match.units) {
      if (!u.mage) continue;
      const inp = inputs[u.id];
      looks.push(inp ? [u.id, inp.moveX, inp.moveZ, inp.yaw, inp.pitch] : [u.id, 0, 0, u.move.yaw, u.move.pitch]);
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
      const inp = p.queue ? takeInput(p.queue, nowMs) : local;
      if (inp) inputs[p.id] = inp;
    }
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
      if (p?.queue) p.ping = ms; // у хоста всегда 0
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
  };
}
