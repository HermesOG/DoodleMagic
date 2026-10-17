import { Peer, type DataConnection } from "peerjs";
import { NETTEST_VERSION, SNAPSHOT_HZ, makeSnapshot, parseClientMsg, pong, welcome, type HostMsg } from "@doodlemagic/protocol";
import { routeFromStats, type StatsEntry } from "./route";
import { isNettestResult, type LinkTestData, type NettestResult } from "./stats";

/** Как будущая игра: 30 пакетов ввода в секунду к хосту, снапшоты 20 раз в секунду от хоста. */
export const PING_HZ = 30;
export const RECONNECT_DELAY_MS = 1000;
/** Пинги последних 2 с без ответа не считаем потерянными: ответ мог не успеть прийти. */
export const LOSS_GRACE_MS = 2000;
const TICK_MS = 250;
const OPEN_TIMEOUT_MS = 12_000;
const ROUTE_CHECK_DELAY_MS = 1500;

/** Как в Doodle District: STUN от Google и Cloudflare и бесплатный публичный TURN на случай строгого NAT. */
export const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      {
        urls: [
          "turn:openrelay.metered.ca:80",
          "turn:openrelay.metered.ca:443",
          "turn:openrelay.metered.ca:443?transport=tcp",
        ],
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
  },
};
const CONN_OPTIONS = { serialization: "raw", reliable: false };

type PeerError = Error & { type?: string };

export function hostPeerId(room: string): string {
  return `doodlemagic-nt-${room.toLowerCase()}-host`;
}

function openPeer(id: string | null): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, PEER_OPTIONS) : new Peer(PEER_OPTIONS);
    const timer = setTimeout(() => {
      peer.destroy();
      reject(Object.assign(new Error("signalling timeout"), { type: "timeout" }));
    }, OPEN_TIMEOUT_MS);
    peer.once("open", () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.once("error", (e: PeerError) => {
      clearTimeout(timer);
      peer.destroy();
      reject(e);
    });
  });
}

/** Сигналинг PeerJS иногда рвёт связь: открытые P2P-каналы живут, а для новых нужно переподключиться. */
function keepSignalling(peer: Peer): void {
  peer.on("disconnected", () => {
    if (!peer.destroyed) peer.reconnect();
  });
}

// ---------------------------------------------------------------- хост

export interface HostState {
  peers: string[];
  reports: NettestResult[];
}

export interface HostSession {
  close(): void;
}

export async function hostRoom(room: string, hostName: string, onUpdate: (s: HostState) => void): Promise<HostSession> {
  const peer = await openPeer(hostPeerId(room));
  keepSignalling(peer);
  const names = new Map<DataConnection, string>();
  /** Один результат на участника: при повторном прохождении остаётся последний. */
  const reports = new Map<string, NettestResult>();
  const emit = () => onUpdate({ peers: [...names.values()], reports: [...reports.values()] });

  peer.on("connection", (conn: DataConnection) => {
    let snapTimer: ReturnType<typeof setInterval> | undefined;
    const send = (msg: HostMsg) => {
      if (conn.open) void conn.send(JSON.stringify(msg));
    };
    conn.on("open", () => {
      let n = 0;
      snapTimer = setInterval(() => send(makeSnapshot(n++, Date.now())), 1000 / SNAPSHOT_HZ);
    });
    conn.on("data", (raw) => {
      const msg = parseClientMsg(typeof raw === "string" ? raw : null);
      if (!msg) return;
      if (msg.t === "ping") {
        send(pong(msg, Date.now()));
      } else if (msg.t === "hello") {
        names.set(conn, msg.name || "без имени");
        send(welcome(msg, { room, host: hostName, peers: names.size }));
        emit();
      } else if (isNettestResult(msg.data)) {
        reports.set(msg.data.name || conn.peer, msg.data);
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
  return { close: () => peer.destroy() };
}

// ---------------------------------------------------------------- участник

export interface PeerRunOptions {
  room: string;
  name: string;
  durationS: number;
  onTick?: (data: Readonly<LinkTestData>, connected: boolean, hostName: string) => void;
}

export interface PeerOutcome {
  hostFound: boolean;
  hostName: string;
  data: LinkTestData;
  sendReport(r: NettestResult): boolean;
  close(): void;
}

export async function runPeerTest(o: PeerRunOptions): Promise<PeerOutcome> {
  const me = await openPeer(null);
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
    };
    const start = performance.now();
    const endAt = start + o.durationS * 1000;
    const sentAt = new Map<number, number>();
    let seq = 0;
    let conn: DataConnection | null = null;
    let connected = false;
    let everOpened = false;
    let hostName = "";
    let finished = false;
    let hiddenSince: number | null = document.hidden ? start : null;

    const onVisibility = () => {
      const now = performance.now();
      if (document.hidden) hiddenSince = now;
      else if (hiddenSince !== null) {
        data.hiddenMs += now - hiddenSince;
        hiddenSince = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    me.on("error", (e: PeerError) => {
      if (e.type === "peer-unavailable" && !everOpened) finish(false);
    });

    const connect = () => {
      if (finished) return;
      // PeerJS 1.5.5 возвращает undefined, пока peer отключён от сигналинга
      const c = me.connect(hostPeerId(o.room), CONN_OPTIONS) as DataConnection | undefined;
      if (!c) {
        setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      conn = c;
      let opened = false;
      c.on("open", () => {
        opened = true;
        everOpened = true;
        connected = true;
        void c.send(JSON.stringify({ t: "hello", v: NETTEST_VERSION, name: o.name }));
        setTimeout(() => {
          c.peerConnection
            ?.getStats()
            .then((report) => {
              data.route = routeFromStats(report.values() as Iterable<StatsEntry>);
            })
            .catch(() => undefined);
        }, ROUTE_CHECK_DELAY_MS);
      });
      c.on("data", (raw) => {
        const now = performance.now();
        data.arrivals.push(now);
        let msg: HostMsg;
        try {
          msg = JSON.parse(String(raw)) as HostMsg;
        } catch {
          return;
        }
        if (msg.t === "welcome") {
          hostName = msg.host;
        } else if (msg.t === "pong") {
          const t0 = sentAt.get(msg.seq);
          if (t0 !== undefined) {
            sentAt.delete(msg.seq);
            data.rtts.push(now - t0);
          }
        }
      });
      c.on("close", () => {
        if (finished || conn !== c) return;
        connected = false;
        // обрыв — это потеря уже открытого соединения; неудачные попытки переподключения не считаем
        if (opened) data.disconnects++;
        if (performance.now() < endAt) setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };

    const openTimer = setTimeout(() => {
      if (!everOpened) finish(false);
    }, OPEN_TIMEOUT_MS);

    const pingTimer = setInterval(() => {
      if (!connected || !conn?.open) return;
      const s = seq++;
      const t = performance.now();
      sentAt.set(s, t);
      void conn.send(JSON.stringify({ t: "ping", seq: s, ct: t }));
    }, 1000 / PING_HZ);

    const tickTimer = setInterval(() => {
      o.onTick?.(data, connected, hostName);
      if (performance.now() >= endAt) finish(true);
    }, TICK_MS);

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
      resolve({
        hostFound,
        hostName,
        data,
        sendReport: (r) => {
          if (!conn?.open) return false;
          void conn.send(JSON.stringify({ t: "report", data: r }));
          return true;
        },
        close: () => me.destroy(),
      });
    }

    connect();
  });
}
