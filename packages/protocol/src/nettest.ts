/** Сообщения теста связи. Клиент и сервер используют один и тот же код. */
export const NETTEST_VERSION = 1;
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_PAD_BYTES = 800;
export const MAX_NAME_LEN = 24;
const MAX_MSG_BYTES = 1024;

export type PingMsg = { t: "ping"; seq: number; ct: number };
export type HelloMsg = { t: "hello"; v: number; name: string };
export type ClientMsg = PingMsg | HelloMsg;

export type ServerMsg =
  | { t: "welcome"; v: number; room: string; edge: string; roomColo: string; peers: number }
  | { t: "pong"; seq: number; ct: number; st: number }
  | { t: "snap"; n: number; st: number; pad: string }
  | { t: "error"; reason: string };

export interface RoomInfo {
  room: string;
  edge: string;
  roomColo: string;
  peers: number;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function parseClientMsg(raw: string | null): ClientMsg | null {
  if (raw === null || raw.length > MAX_MSG_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const m = parsed as Record<string, unknown>;
  if (m.t === "ping") {
    if (!Number.isSafeInteger(m.seq) || (m.seq as number) < 0 || !isFiniteNumber(m.ct)) return null;
    return { t: "ping", seq: m.seq as number, ct: m.ct };
  }
  if (m.t === "hello") {
    if (!isFiniteNumber(m.v) || typeof m.name !== "string") return null;
    return { t: "hello", v: m.v, name: m.name.trim().slice(0, MAX_NAME_LEN) };
  }
  return null;
}

export function pong(msg: PingMsg, now: number): ServerMsg {
  return { t: "pong", seq: msg.seq, ct: msg.ct, st: now };
}

export function welcome(msg: HelloMsg, info: RoomInfo): ServerMsg {
  if (msg.v !== NETTEST_VERSION) return { t: "error", reason: "обновите страницу" };
  return { t: "welcome", v: NETTEST_VERSION, ...info };
}

const PAD = "x".repeat(SNAPSHOT_PAD_BYTES);

/** Поток снапшотов примерно того же размера, что будут слать игровые комнаты. */
export function makeSnapshot(n: number, now: number): ServerMsg {
  return { t: "snap", n, st: now, pad: PAD };
}

/** Достаёт код дата-центра из ответа https://cloudflare.com/cdn-cgi/trace. */
export function parseTraceColo(trace: string): string {
  return /^colo=([A-Z0-9]+)$/m.exec(trace)?.[1] ?? "?";
}
