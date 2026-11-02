import type { DataConnection } from "peerjs";
import { CONN_OPTIONS, keepSignalling, openPeer } from "../nettest/p2p";
import { gamePeerId } from "./room";

// ---------------------------------------------------------------- имитация сети

/** Имитация плохой сети на отправке (`?lag=МС&loss=%`, решение Н13). */
export interface LagOptions {
  /** Круговая задержка: каждая сторона задерживает свою отправку на половину. */
  lagMs: number;
  lossPct: number;
}

const MAX_LAG_MS = 1000;
const MAX_LOSS_PCT = 50;

/** Число из параметра запроса; нет параметра, пусто или не число — null. */
function queryNumber(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** ?lag=120&loss=2 → { lagMs: 120, lossPct: 2 }; lag зажат в 0…1000, loss в 0…50; нет обоих — null. */
export function lagFromQuery(search: string): LagOptions | null {
  const params = new URLSearchParams(search);
  const lag = queryNumber(params, "lag");
  const loss = queryNumber(params, "loss");
  if (lag === null && loss === null) return null;
  return {
    lagMs: Math.min(MAX_LAG_MS, Math.max(0, lag ?? 0)),
    lossPct: Math.min(MAX_LOSS_PCT, Math.max(0, loss ?? 0)),
  };
}

/**
 * Одна отправка: потеря с вероятностью loss %, задержка lag/2 × (0,9 + 0,2·rand) — в одну сторону.
 * rand зовётся ровно дважды и всегда в одном порядке: первый раз — на потерю, второй — на разброс задержки.
 */
export function lagDecision(o: LagOptions, rand: () => number): { drop: boolean; delayMs: number } {
  const lossRoll = rand();
  const jitterRoll = rand();
  return { drop: lossRoll * 100 < o.lossPct, delayMs: (o.lagMs / 2) * (0.9 + 0.2 * jitterRoll) };
}

// ---------------------------------------------------------------- общее

/**
 * Данные PeerJS → строка или ArrayBuffer. Строка и ArrayBuffer — как есть; вид на буфер (Uint8Array и т. п.) —
 * копия его байтов в новый ArrayBuffer; Blob — после чтения (доставка асинхронная); прочее отбрасывается.
 */
export function normalizeData(raw: unknown, deliver: (data: string | ArrayBuffer) => void): void {
  if (typeof raw === "string" || raw instanceof ArrayBuffer) {
    deliver(raw);
  } else if (ArrayBuffer.isView(raw)) {
    deliver(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice().buffer);
  } else if (typeof Blob !== "undefined" && raw instanceof Blob) {
    // ошибка чтения — данные потеряны, как при потере пакета; ошибку обработчика не глотаем
    raw.arrayBuffer().then(deliver, () => undefined);
  }
}

/**
 * Отправка по открытому каналу с имитацией лага. Закрытый канал — молча.
 * Задержанную отправку не отдаём чужому буферу: копия на случай, если вызывающий переиспользует Uint8Array.
 */
function sendOver(dc: DataConnection, data: string | Uint8Array, lag: LagOptions | null | undefined): void {
  const push = (payload: string | Uint8Array) => {
    if (!dc.open) return;
    try {
      void dc.send(payload);
    } catch {
      // канал закрылся между проверкой и отправкой
    }
  };
  if (!lag) {
    push(data);
    return;
  }
  const { drop, delayMs } = lagDecision(lag, Math.random);
  // Настоящий канал (ordered: false без maxRetransmits) ничего не теряет, только путает порядок: теряем лишь
  // снапшоты, у которых есть замена, а текстовые сообщения (вход, ввод, стихия) только задерживаем.
  if (drop && typeof data !== "string") return;
  if (delayMs <= 0) {
    push(data);
    return;
  }
  const copy = typeof data === "string" ? data : data.slice();
  setTimeout(() => push(copy), delayMs);
}

type PeerError = Error & { type?: string };

// ---------------------------------------------------------------- хост

/** Канал до одного игрока у хоста. */
export interface Conn {
  /** Уникален для соединения (connectionId PeerJS). */
  readonly id: string;
  readonly open: boolean;
  /** Без лага Uint8Array уходит в канал без копии: не переиспользовать буфер после отправки. */
  send(data: string | Uint8Array): void;
  /** onClose этого канала зовётся синхронно, изнутри close(): не закрывать каналы на ходу по своей карте игроков. */
  close(): void;
}

export interface HostLinkHandlers {
  /** Канал игрока открылся. */
  onConn(c: Conn): void;
  onData(c: Conn, data: string | ArrayBuffer): void;
  /** Один раз на каждое объявленное через onConn соединение: закрылось (`close`) или сломалось (`error`). */
  onClose(c: Conn): void;
}

export interface HostLink {
  /** Закрывает комнату и все каналы. После вызова обработчики молчат. */
  close(): void;
}

/** Открывает комнату: PeerJS-ID gamePeerId(code). Занят — reject с ошибкой type "unavailable-id". */
export async function openHostLink(code: string, h: HostLinkHandlers, lag?: LagOptions | null): Promise<HostLink> {
  const peer = await openPeer(gamePeerId(code));
  keepSignalling(peer);
  let closed = false;

  peer.on("connection", (dc: DataConnection) => {
    if (closed) {
      dc.close();
      return;
    }
    let opened = false;
    let gone = false;
    const conn: Conn = {
      id: dc.connectionId,
      get open() {
        return opened && !gone && dc.open;
      },
      send: (data) => {
        if (conn.open) sendOver(dc, data, lag);
      },
      close: () => dc.close(),
    };
    dc.on("open", () => {
      if (opened || gone || closed) return;
      opened = true;
      h.onConn(conn);
    });
    dc.on("data", (raw) => {
      if (!opened || gone) return;
      normalizeData(raw, (data) => {
        if (!gone && !closed) h.onData(conn, data);
      });
    });
    // close и error — оба конец: после ошибки PeerJS канал не оживает, поэтому закрываем его сами
    const finish = () => {
      if (gone) return;
      gone = true;
      dc.close();
      if (opened && !closed) h.onClose(conn);
    };
    dc.on("close", finish);
    dc.on("error", finish);
  });

  return {
    close: () => {
      if (closed) return;
      closed = true;
      peer.destroy();
    },
  };
}

// ---------------------------------------------------------------- игрок

export type JoinFailure = "noHost" | "noChannel";

export interface JoinHandlers {
  onOpen(): void;
  onData(data: string | ArrayBuffer): void;
  /** Канал был открыт и закрылся (хост ушёл, обрыв). */
  onClose(): void;
  /** Канал так и не открылся: хоста нет (peer-unavailable) или P2P не поднялся за 15 с. */
  onFail(reason: JoinFailure): void;
}

export interface JoinLink {
  send(data: string | Uint8Array): void;
  /** Закрывает канал. После вызова обработчики молчат. */
  close(): void;
}

/** Срок открытия канала, считая от готовности к сигналингу. */
const JOIN_TIMEOUT_MS = 15_000;
/** PeerJS 1.5.5 возвращает undefined из connect, пока peer отключён от сигналинга: повторяем раз в секунду. */
const CONNECT_RETRY_MS = 1000;

/**
 * Подключается к комнате хоста. Сигналинг недоступен — reject. Дальше исход — через обработчики:
 * onOpen, потом при обрыве onClose; либо сразу onFail. Автопереподключения нет (Н10).
 */
export async function openJoinLink(code: string, h: JoinHandlers, lag?: LagOptions | null): Promise<JoinLink> {
  const me = await openPeer(null);
  keepSignalling(me);
  const hostId = gamePeerId(code);
  let dc: DataConnection | null = null;
  let opened = false;
  /** Исход известен (открыт и закрыт, провал или close()): обработчики больше не зовём. */
  let over = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  const end = () => {
    over = true;
    clearTimeout(retryTimer);
    clearTimeout(deadlineTimer);
    me.destroy();
  };
  const fail = (reason: JoinFailure) => {
    if (over) return;
    end();
    h.onFail(reason);
  };

  // хоста нет: сигналинг ответил peer-unavailable, пока канал не открывался
  me.on("error", (e: PeerError) => {
    if (e.type === "peer-unavailable" && !opened) fail("noHost");
  });
  // PeerJS не сообщает о канале, который так и не открылся (ICE не прошёл), — срок ждём сами
  deadlineTimer = setTimeout(() => {
    if (!opened) fail("noChannel");
  }, JOIN_TIMEOUT_MS);

  const connect = () => {
    retryTimer = undefined;
    if (over) return;
    const c = me.connect(hostId, CONN_OPTIONS) as DataConnection | undefined;
    if (!c) {
      retryTimer = setTimeout(connect, CONNECT_RETRY_MS);
      return;
    }
    dc = c;
    c.on("open", () => {
      if (over || opened) return;
      opened = true;
      clearTimeout(deadlineTimer);
      h.onOpen();
    });
    c.on("data", (raw) => {
      if (!opened || over) return;
      normalizeData(raw, (data) => {
        if (!over) h.onData(data);
      });
    });
    // до открытия ошибка канала (ICE не прошёл) — это провал, ждать срок незачем; после открытия — обрыв
    const lost = () => {
      if (over) return;
      if (!opened) {
        fail("noChannel");
        return;
      }
      end();
      h.onClose();
    };
    c.on("close", lost);
    c.on("error", lost);
  };
  connect();

  return {
    send: (data) => {
      if (!over && opened && dc) sendOver(dc, data, lag);
    },
    close: () => {
      if (!over) end();
    },
  };
}
