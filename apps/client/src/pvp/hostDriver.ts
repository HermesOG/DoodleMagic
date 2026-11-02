import {
  NOBODY, PVP, TICK_DT, unitById,
  type Element, type GameState, type MatchContext, type MatchEvent, type MatchInput, type UnitId,
} from "@doodlemagic/sim";
import type { Driver, Frame, TickOut } from "../game/driver";
import { encodeBinary } from "../net/codec";
import { LOCAL_PEER, createHostCore } from "../net/hostCore";
import { openHostLink, type Conn, type HostLink, type LagOptions } from "../net/link";
import { NET_VERSION, hostText, parseClientMsg } from "../net/protocol";
import { newRoomCode } from "../net/room";
import type { SnapshotMsg } from "../net/snapshot";
import { startTicker } from "../net/ticker";
import { advanceClock } from "../sandbox/fixedStep";

/** Связь с хостом: есть; снапшотов нет дольше 3 с; канал закрыт (хост вышел). */
export type LinkState = "ok" | "stale" | "closed";

/** Драйвер сетевой игры: хост (hostDriver) и игрок (clientDriver). Интерфейс матча (задача 8) опирается на него. */
export interface PvpDriver extends Driver {
  readonly isHost: boolean;
  readonly roomCode: string;
  /** Состояние игры сейчас: у хоста — настоящее, у игрока — предсказанное. */
  game(): GameState;
  /** Последнее подтверждённое хостом (у хоста — то же, что game()). */
  confirmedGame(): GameState;
  names(): ReadonlyMap<UnitId, string>;
  pings(): ReadonlyMap<UnitId, number>;
  /** Свой пинг до хоста, мс; у хоста 0, неизвестен — −1. */
  ownPing(): number;
  link(): LinkState;
  /** Только хост: «Начать матч» / «Ещё раз». */
  start(): void;
}

export interface HostDriver extends PvpDriver {
  /** «Войти»: маг хоста встаёт в комнату, его ввод идёт в тики с этого момента. Повторно — ничего. */
  enter(name: string, element: Element): void;
}

export interface HostOptions {
  ctx: MatchContext;
  lag: LagOptions | null;
  /** Состав комнаты изменился: вошёл или вышел маг. */
  onRoster(): void;
}

/** ID комнаты занят — новый код, всего попыток столько. */
const CODE_ATTEMPTS = 5;
/** Тиков за пульс не больше: главный поток стоял дольше — не догоняем. */
const MAX_TICKS_PER_PULSE = 10;
/** Тиков в буфере кадра не больше (вкладка в фоне — кадров нет): старые выбрасываются. */
const MAX_PENDING_TICKS = 30;
/** Подтверждённых событий в буфере кадра не больше: старые выбрасываются. */
const MAX_PENDING_EVENTS = 256;
const TICK_MS = TICK_DT * 1000;

const isIdTaken = (err: unknown): boolean => (err as { type?: unknown } | null)?.type === "unavailable-id";

/**
 * Открывает комнату на новом коде (занят — другой, до CODE_ATTEMPTS попыток) и запускает хост: ядро
 * (createHostCore) крутят пульсы startTicker из Web Worker — в фоновой вкладке матч идёт. Время копится по часам:
 * advanceClock(acc, прошедшее, TICK_DT, 10). Кадр вида только читает то, что натикали пульсы. Снапшот кодируется
 * один раз и уходит всем вошедшим. Сигналинг недоступен — reject.
 */
export async function startHost(o: HostOptions): Promise<HostDriver> {
  const core = createHostCore(o.ctx);
  /** Вошедшие игроки по id канала (он же peer в ядре). */
  const joined = new Map<string, Conn>();
  let code = "";
  let localId: UnitId = NOBODY;
  let closed = false;
  let names: ReadonlyMap<UnitId, string> | null = null;
  const rosterChanged = (): void => {
    names = null;
    o.onRoster();
  };

  const onData = (c: Conn, data: string | ArrayBuffer): void => {
    // игрок шлёт только текст; всё, что не проходит строгий разбор, отбрасывается
    if (typeof data !== "string") return;
    const m = parseClientMsg(data);
    if (!m) return;
    const nowMs = performance.now();
    if (m.t === "join") {
      if (m.v !== NET_VERSION) {
        c.send(hostText({ t: "deny", reason: "version" }));
        return;
      }
      // место хоста держим, пока он не вошёл: иначе шестеро друзей заняли бы всю комнату
      const full = localId === NOBODY && !joined.has(c.id) && joined.size >= PVP.maxPlayers - 1;
      const r = full ? null : core.join(c.id, m.name, m.element, nowMs);
      if (!r?.ok) {
        c.send(hostText({ t: "deny", reason: "full" }));
        return;
      }
      c.send(hostText({ t: "welcome", v: NET_VERSION, id: r.id, room: code }));
      if (!joined.has(c.id)) {
        joined.set(c.id, c);
        rosterChanged();
      }
      return;
    }
    if (!joined.has(c.id)) return; // ввод, стихия и пинг — только от вошедших
    if (m.t === "in") core.inputs(c.id, m.items, nowMs);
    else if (m.t === "el") core.setElement(c.id, m.element);
    else {
      c.send(hostText({ t: "pong", ct: m.ct }));
      core.setPing(c.id, Math.round(m.rtt));
    }
  };
  const onClose = (c: Conn): void => {
    if (!joined.delete(c.id)) return;
    core.leave(c.id);
    rosterChanged();
  };

  let link: HostLink | null = null;
  for (let attempt = 1; !link; attempt++) {
    code = newRoomCode();
    try {
      link = await openHostLink(code, { onConn: () => undefined, onData, onClose }, o.lag);
    } catch (err) {
      if (!isIdTaken(err) || attempt >= CODE_ATTEMPTS) throw err;
    }
  }
  const hostLink = link;

  const broadcast = (snap: SnapshotMsg): void => {
    if (joined.size === 0) return;
    encodeBinary(snap).then(
      (bytes) => {
        // один буфер всем: encodeBinary даёт новый на каждый снапшот, и его никто не меняет
        if (!closed) for (const c of joined.values()) c.send(bytes);
      },
      (err: unknown) => console.error(err),
    );
  };

  // ---------------------------------------------------------------- тики (пульсы таймера)

  /** ввод игрока за этим браузером: вид отдаёт его в advance; до первого кадра вида — null. */
  let sample: (() => MatchInput) | null = null;
  /** Тики и события, которых вид ещё не видел (их отдаёт следующий настоящий кадр). */
  let pending: TickOut[] = [];
  let confirmed: MatchEvent[] = [];
  /** respawn своего мага из выброшенных тиков: вид должен его увидеть (взгляд на точку). */
  let carried: MatchEvent[] = [];
  /** Свой маг возродился, а вид ещё не видел события: тики смотрят, куда смотрит точка (pitch 0). */
  let face: number | null = null;
  /** prev = cur в кадре: свой маг только что встал на точку, камера не тянется через карту. */
  let holdPrev = false;
  let mounted = false;
  let failure: unknown = null;
  let acc = 0;
  let lastPulse = performance.now();
  /** Время (performance.now) границы последнего тика: от него alpha кадра. */
  let boundary = lastPulse;

  const isOwnRespawn = (ev: MatchEvent): boolean => ev.type === "respawn" && ev.target === localId;

  const runTick = (nowMs: number): void => {
    let local: MatchInput | null = null;
    if (localId !== NOBODY && sample) {
      const s = sample();
      local = face === null ? s : { ...s, yaw: face, pitch: 0 };
    }
    const r = core.tick(local, nowMs);
    const events = r.step.events;
    holdPrev = false;
    for (const ev of events) {
      if (ev.type !== "respawn" || ev.target !== localId) continue;
      face = ev.yaw;
      holdPrev = true;
    }
    pending.push({ state: core.game.match, events });
    if (pending.length > MAX_PENDING_TICKS) {
      const own = pending.shift()!.events.filter(isOwnRespawn);
      if (own.length > 0) carried = own.slice(-1);
    }
    confirmed.push(...events);
    if (confirmed.length > MAX_PENDING_EVENTS) confirmed.splice(0, confirmed.length - MAX_PENDING_EVENTS);
    if (r.snapshot) broadcast(r.snapshot);
  };

  const pulse = (): void => {
    if (closed || failure !== null) return;
    const now = performance.now();
    const clock = advanceClock(acc, (now - lastPulse) / 1000, TICK_DT, MAX_TICKS_PER_PULSE);
    lastPulse = now;
    acc = clock.acc;
    try {
      for (let k = 0; k < clock.ticks; k++) runTick(now);
    } catch (err) {
      // сбой симуляции: пульсы встают, ближайший кадр вида бросит ошибку (сообщение поверх игры)
      failure = err;
      stopTicker();
      console.error(err);
    }
    boundary = now - acc * 1000;
  };
  const stopTicker = startTicker(pulse);

  const dispose = (): void => {
    if (closed) return;
    closed = true;
    stopTicker();
    hostLink.close();
  };

  return {
    isHost: true,
    get roomCode() {
      return code;
    },
    get localId() {
      return localId;
    },
    enter(name, element) {
      if (localId !== NOBODY || closed) return;
      const r = core.join(LOCAL_PEER, name, element, performance.now());
      if (!r.ok) return; // не бывает: место хоста держится до его входа
      localId = r.id;
      // до входа вид не видел ничего: события чужих магов из лобби ему не нужны
      pending = [];
      confirmed = [];
      carried = [];
      rosterChanged();
    },
    advance(_dtS, s): Frame {
      if (failure !== null) throw failure;
      sample = s;
      const cur = core.game.match;
      const prev = holdPrev ? cur : core.prevGame.match;
      const alpha = Math.min(1, Math.max(0, (performance.now() - boundary) / TICK_MS));
      // кадр при запуске вида — только ради состояния: накопленное отдаст первый настоящий кадр
      if (!mounted) {
        mounted = true;
        return { ticks: [], late: [], confirmed: [], prev, cur, alpha };
      }
      const frame: Frame = { ticks: pending, late: carried, confirmed, prev, cur, alpha };
      pending = [];
      confirmed = [];
      carried = [];
      face = null; // вид увидел respawn в этом кадре и сам ставит взгляд
      return frame;
    },
    /**
     * Смена стихии — сразу в ядре. Живой маг вне боя встаёт заново на точку новой стихией (rules.setElement): точка
     * уходит виду (взгляд, руки, пыль). Мёртвый (применится при возрождении) или живой в бою (нельзя) — null.
     */
    chooseElement(e) {
      const was = unitById(core.game.match, localId);
      core.setElement(LOCAL_PEER, e);
      const now = unitById(core.game.match, localId);
      if (!was?.alive || !was.mage || was.mage.element === e || !now?.alive || now.mage?.element !== e) return null;
      holdPrev = true;
      return { pos: { ...now.mage.spawn.pos }, yaw: now.mage.spawn.yaw };
    },
    dispose,
    game: () => core.game,
    confirmedGame: () => core.game,
    names() {
      names ??= core.names();
      return names;
    },
    pings: () => core.pings(),
    ownPing: () => 0,
    link: () => (closed ? "closed" : "ok"),
    start() {
      core.start();
    },
  };
}
