import { Peer, type DataConnection } from "peerjs";
import {
  NETTEST_VERSION,
  SNAPSHOT_HZ,
  ack,
  makeSnapshot,
  parseClientMsg,
  parsePeerTag,
  peerKey,
  pong,
  welcome,
  type HostMsg,
  type PeerTag,
} from "@doodlemagic/protocol";
import { hostPeerId } from "../config";
import { routeFromStats, type StatsEntry } from "./route";
import { isNettestResult, type LinkTestData, type NettestResult } from "./stats";

/** Как будущая игра: 30 пакетов ввода в секунду к хосту, снапшоты 20 раз в секунду от хоста. */
export const PING_HZ = 30;
export const RECONNECT_DELAY_MS = 1000;
/**
 * Пинги последних 2 с без ответа не считаем: ответ мог не успеть прийти.
 * Канал с reliable: false в PeerJS лишь неупорядоченный — SCTP досылает потерянное, поэтому «без ответа»
 * остаются только пинги, застрявшие в оборвавшемся соединении.
 */
export const LOSS_GRACE_MS = 2000;
const TICK_MS = 250;
const OPEN_TIMEOUT_MS = 12_000;
/** Хост ждёт открытия канала дольше участника: тот успевает сдаться и показать свой итог раньше. */
const HOST_OPEN_TIMEOUT_MS = 15_000;
/** Сколько участник ждёт от хоста подтверждения, что отчёт получен. */
const ACK_TIMEOUT_MS = 10_000;
/** Одна попытка соединения: PeerJS 1.5.5 не сообщает о сорвавшемся ICE или потерянном offer, поэтому ждём сами. */
const ATTEMPT_TIMEOUT_MS = 8000;
const ROUTE_CHECK_DELAY_MS = 1500;
/** Повторное подключение к сигналингу: задержка удваивается от минимума до максимума. */
const SIGNALLING_RETRY_MIN_MS = 1000;
const SIGNALLING_RETRY_MAX_MS = 15_000;

/**
 * TURN-ретрансляторы для строгих NAT. Публичный openrelay.metered.ca, как в Doodle District, закрыли в 2026 году
 * (его DNS отдаёт 192.0.2.1), поэтому список пока пуст. Сюда можно добавить бесплатный TURN, например
 * Cloudflare Realtime: временные логин и пароль для него будет выдавать функция на Vercel.
 */
export const TURN_SERVERS: RTCIceServer[] = [];

/** STUN от Google и Cloudflare; TURN — из TURN_SERVERS, когда он настроен. */
export const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      ...TURN_SERVERS,
    ],
  },
};
const CONN_OPTIONS = { serialization: "raw", reliable: false };

type PeerError = Error & { type?: string };

/** relayOnly: браузер берёт только TURN-кандидатов — так проверяем запасной путь для строгих NAT. */
function openPeer(id: string | null, relayOnly = false): Promise<Peer> {
  const options = relayOnly
    ? { ...PEER_OPTIONS, config: { ...PEER_OPTIONS.config, iceTransportPolicy: "relay" as RTCIceTransportPolicy } }
    : PEER_OPTIONS;
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, options) : new Peer(options);
    // Слушатели нужны только до открытия: позже ошибка Peer (обрыв сигналинга, сбой одного соединения) не должна его уничтожать.
    const onOpen = () => {
      clearTimeout(timer);
      peer.off("error", onError);
      resolve(peer);
    };
    const onError = (e: PeerError) => {
      clearTimeout(timer);
      peer.off("open", onOpen);
      peer.destroy();
      reject(e);
    };
    const timer = setTimeout(() => {
      peer.off("open", onOpen);
      peer.off("error", onError);
      peer.destroy();
      reject(Object.assign(new Error("signalling timeout"), { type: "timeout" }));
    }, OPEN_TIMEOUT_MS);
    peer.on("open", onOpen);
    peer.on("error", onError);
  });
}

/**
 * Сигналинг PeerJS иногда рвёт связь: открытые P2P-каналы живут, а для новых нужно переподключиться.
 * Повторы идут с нарастающей задержкой, не чаще одного ожидающего таймера; успешное открытие сбрасывает задержку.
 */
function keepSignalling(peer: Peer): void {
  let delay = SIGNALLING_RETRY_MIN_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  peer.on("open", () => {
    delay = SIGNALLING_RETRY_MIN_MS;
  });
  peer.on("disconnected", () => {
    if (timer !== undefined || peer.destroyed) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!peer.destroyed && peer.disconnected) peer.reconnect();
    }, delay);
    delay = Math.min(delay * 2, SIGNALLING_RETRY_MAX_MS);
  });
}

// ---------------------------------------------------------------- хост

export interface HostState {
  peers: string[];
  reports: NettestResult[];
  /** Участники, у которых P2P-канал не открылся за HOST_OPEN_TIMEOUT_MS. */
  failedOpens: PeerTag[];
}

/** Результаты, восстановленные после перезагрузки страницы хоста. */
export interface HostInitial {
  reports?: readonly NettestResult[];
  failedOpens?: readonly PeerTag[];
}

export interface HostSession {
  /** Забыть все результаты и несостоявшиеся подключения. */
  clear(): void;
  close(): void;
}

export async function hostRoom(
  room: string,
  hostName: string,
  onUpdate: (s: HostState) => void,
  initial: HostInitial = {},
): Promise<HostSession> {
  const peer = await openPeer(hostPeerId(room));
  keepSignalling(peer);
  const names = new Map<DataConnection, string>();
  /** Один результат на участника и устройство: при повторном прохождении остаётся последний. */
  const reports = new Map<string, NettestResult>();
  /** Несостоявшиеся подключения по тому же ключу: удаляются, как только участник подключился или прислал отчёт. */
  const failedOpens = new Map<string, PeerTag>();
  /** Когда по ключу последний раз открылся канал: поздний таймер старой неудачной попытки не должен записать провал. */
  const lastOpenAt = new Map<string, number>();
  for (const r of initial.reports ?? []) reports.set(peerKey(parsePeerTag(r)), r);
  for (const f of initial.failedOpens ?? []) failedOpens.set(peerKey(f), f);
  let closed = false;
  const emit = () => {
    if (!closed) {
      onUpdate({ peers: [...names.values()], reports: [...reports.values()], failedOpens: [...failedOpens.values()] });
    }
  };

  peer.on("connection", (conn: DataConnection) => {
    // метаданные пишет чужой браузер: только строки, обрезка, запасные значения
    const tag = parsePeerTag(conn.metadata);
    const key = peerKey(tag);
    const createdAt = performance.now();
    let snapTimer: ReturnType<typeof setInterval> | undefined;
    const send = (msg: HostMsg) => {
      if (conn.open) void conn.send(JSON.stringify(msg));
    };
    // PeerJS не сообщает о канале, который так и не открылся (ICE не прошёл даже через TURN), — ждём сами.
    // На close/error таймер не снимаем: участник повторяет попытки, и провал любой из них должен дойти до сводки.
    const openTimer = setTimeout(() => {
      if (closed || (lastOpenAt.get(key) ?? -Infinity) >= createdAt) return;
      failedOpens.set(key, tag);
      emit();
    }, HOST_OPEN_TIMEOUT_MS);
    conn.on("open", () => {
      clearTimeout(openTimer);
      lastOpenAt.set(key, performance.now());
      if (failedOpens.delete(key)) emit();
      let n = 0;
      snapTimer = setInterval(() => send(makeSnapshot(n++, Date.now())), 1000 / SNAPSHOT_HZ);
    });
    conn.on("data", (raw) => {
      const msg = parseClientMsg(typeof raw === "string" ? raw : null);
      if (!msg) return;
      if (msg.t === "ping") {
        send(pong(msg, Date.now()));
      } else if (msg.t === "hello") {
        names.set(conn, `${tag.name} · ${tag.device}${tag.relayOnly ? " · проверка TURN" : ""}`);
        send(welcome(msg, { room, host: hostName, peers: names.size }));
        emit();
      } else if (isNettestResult(msg.data)) {
        // ключ и подписи берём из отчёта через тот же разбор, что и для метаданных: так они совпадают
        const reportTag = parsePeerTag(msg.data);
        const reportKey = peerKey(reportTag);
        reports.set(reportKey, { ...msg.data, name: reportTag.name, device: reportTag.device });
        failedOpens.delete(reportKey);
        send(ack());
        emit();
      }
    });
    const drop = () => {
      clearInterval(snapTimer);
      if (names.delete(conn)) emit();
    };
    conn.on("close", drop);
    conn.on("error", drop);
  });

  emit();
  return {
    clear: () => {
      reports.clear();
      failedOpens.clear();
      emit();
    },
    close: () => {
      closed = true;
      peer.destroy();
    },
  };
}

// ---------------------------------------------------------------- участник

export interface PeerRunOptions {
  room: string;
  name: string;
  /** «телефон» или «ПК»: уходит хосту в метаданных соединения ещё до открытия канала. */
  device: string;
  /** Только через TURN (`/nettest?relay=1`). */
  relayOnly?: boolean;
  durationS: number;
  onTick?: (data: Readonly<LinkTestData>, connected: boolean, hostName: string) => void;
}

export interface PeerOutcome {
  hostFound: boolean;
  hostName: string;
  data: LinkTestData;
  /** true — хост подтвердил получение за ACK_TIMEOUT_MS; false — не подтвердил или канал уже закрыт. */
  sendReport(r: NettestResult): Promise<boolean>;
  close(): void;
}

export async function runPeerTest(o: PeerRunOptions): Promise<PeerOutcome> {
  const relayOnly = o.relayOnly === true;
  const me = await openPeer(null, relayOnly);
  keepSignalling(me);

  return new Promise((resolve) => {
    const data: LinkTestData = {
      route: "?",
      rtts: [],
      arrivals: [],
      sent: 0,
      received: 0,
      disconnects: 0,
      hiddenMs: 0,
      durationS: 0,
      endedAt: 0,
      openedAt: null,
      snaps: 0,
    };
    const start = performance.now();
    const endAt = start + o.durationS * 1000;
    const sentAt = new Map<number, number>();
    let seq = 0;
    let conn: DataConnection | null = null;
    let connected = false;
    let hostName = "";
    let finished = false;
    let hiddenSince: number | null = document.hidden ? start : null;
    /** Ждёт подтверждения доставки отчёта; ack приходит уже после конца теста. */
    let onAck: (() => void) | null = null;

    const onVisibility = () => {
      const now = performance.now();
      if (document.hidden) hiddenSince = now;
      else if (hiddenSince !== null) {
        data.hiddenMs += now - hiddenSince;
        hiddenSince = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // «Хоста нет» (hostFound: false) — только когда сигналинг сам сказал peer-unavailable и ни одно соединение не открывалось.
    me.on("error", (e: PeerError) => {
      if (e.type === "peer-unavailable" && data.openedAt === null) finish(false);
    });

    /** Единая цепочка повторов: не больше одного ожидающего таймера, не после финиша и не после конца теста. */
    let retryPending = false;
    const scheduleReconnect = () => {
      if (finished || retryPending || performance.now() >= endAt) return;
      retryPending = true;
      setTimeout(() => {
        retryPending = false;
        connect();
      }, RECONNECT_DELAY_MS);
    };

    const connect = () => {
      if (finished) return;
      // PeerJS 1.5.5 возвращает undefined, пока peer отключён от сигналинга
      const c = me.connect(hostPeerId(o.room), {
        ...CONN_OPTIONS,
        // хост видит, кто подключается, даже если канал так и не откроется
        metadata: { name: o.name, device: o.device, relayOnly },
      }) as DataConnection | undefined;
      if (!c) {
        scheduleReconnect();
        return;
      }
      conn = c;
      let opened = false;
      // PeerJS 1.5.5 не шлёт close для соединения, которое так и не открылось (ICE, потерянный offer): обрываем попытку сами.
      const attemptTimer = setTimeout(() => {
        if (finished || opened || conn !== c) return;
        // до первого открытия медленный ICE (TURN) не обрываем: срок задаёт OPEN_TIMEOUT_MS, а ошибки ловит c.on("error")
        if (data.openedAt === null) return;
        c.close();
        scheduleReconnect();
      }, ATTEMPT_TIMEOUT_MS);
      c.on("open", () => {
        clearTimeout(attemptTimer);
        opened = true;
        data.openedAt ??= performance.now();
        connected = true;
        void c.send(JSON.stringify({ t: "hello", v: NETTEST_VERSION, name: o.name }));
        setTimeout(() => {
          c.peerConnection
            ?.getStats()
            .then((report) => {
              if (finished) return;
              data.route = routeFromStats(report.values() as Iterable<StatsEntry>);
            })
            .catch(() => undefined);
        }, ROUTE_CHECK_DELAY_MS);
      });
      c.on("error", () => {
        if (finished || opened || conn !== c) return;
        clearTimeout(attemptTimer);
        c.close();
        scheduleReconnect();
      });
      c.on("data", (raw) => {
        const now = performance.now();
        let msg: HostMsg | null = null;
        try {
          msg = JSON.parse(String(raw)) as HostMsg | null;
        } catch {
          // битое сообщение всё равно говорит, что хост жив
        }
        if (msg?.t === "ack") {
          onAck?.();
          return;
        }
        if (finished) return;
        data.arrivals.push(now);
        if (msg?.t === "welcome") {
          hostName = msg.host;
        } else if (msg?.t === "pong") {
          const t0 = sentAt.get(msg.seq);
          if (t0 !== undefined) {
            sentAt.delete(msg.seq);
            data.rtts.push(now - t0);
          }
        } else if (msg?.t === "snap") {
          data.snaps++;
        }
      });
      c.on("close", () => {
        if (finished || conn !== c) return;
        connected = false;
        // обрыв — это потеря уже открытого соединения; неудачные попытки переподключения не считаем
        if (opened) data.disconnects++;
        scheduleReconnect();
      });
    };

    // Ни одно соединение не открылось, а peer-unavailable не было: хост в комнате есть, но P2P-канал (даже через TURN) не поднялся.
    // Это именно тот сбой, который тест должен показать, поэтому hostFound остаётся true.
    const openTimer = setTimeout(() => {
      if (data.openedAt === null) finish(true);
    }, OPEN_TIMEOUT_MS);

    const pingTimer = setInterval(() => {
      if (!connected || !conn?.open) return;
      const s = seq++;
      const t = performance.now();
      sentAt.set(s, t);
      void conn.send(JSON.stringify({ t: "ping", seq: s, ct: t }));
    }, 1000 / PING_HZ);

    const tickTimer = setInterval(() => {
      if (performance.now() >= endAt) {
        finish(true);
        return;
      }
      // ошибка в onTick не должна останавливать тест
      try {
        o.onTick?.(data, connected, hostName);
      } catch (e) {
        console.error(e);
      }
    }, TICK_MS);

    const sendReport = (r: NettestResult): Promise<boolean> =>
      new Promise((done) => {
        const c = conn;
        if (!c?.open) {
          done(false);
          return;
        }
        const settle = (delivered: boolean) => {
          clearTimeout(timer);
          c.off("close", onClose);
          onAck = null;
          done(delivered);
        };
        const onClose = () => settle(false);
        const timer = setTimeout(() => settle(false), ACK_TIMEOUT_MS);
        onAck = () => settle(true);
        c.on("close", onClose);
        void c.send(JSON.stringify({ t: "report", data: r }));
      });

    function finish(hostFound: boolean): void {
      if (finished) return;
      finished = true;
      clearTimeout(openTimer);
      clearInterval(pingTimer);
      clearInterval(tickTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      const now = performance.now();
      if (hiddenSince !== null) data.hiddenMs += now - hiddenSince;
      const cutoff = now - LOSS_GRACE_MS;
      let recent = 0;
      let lost = 0;
      for (const t of sentAt.values()) {
        if (t >= cutoff) recent++;
        else lost++;
      }
      data.sent = seq - recent;
      data.received = data.sent - lost;
      data.durationS = (now - start) / 1000;
      data.endedAt = now;
      resolve({ hostFound, hostName, data, sendReport, close: () => me.destroy() });
    }

    connect();
  });
}
