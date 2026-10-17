/** Сообщения P2P-теста связи. Хост (браузер организатора) и участники используют один и тот же код. */
export const NETTEST_VERSION = 2;
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_PAD_BYTES = 800;
export const MAX_NAME_LEN = 24;
/** Лимит длины строки сообщения в символах: отчёт участника весит около 1–2 тыс. символов. */
export const MAX_MSG_CHARS = 8192;

export type PingMsg = { t: "ping"; seq: number; ct: number };
export type HelloMsg = { t: "hello"; v: number; name: string };
export type ReportMsg = { t: "report"; data: Record<string, unknown> };
export type ClientMsg = PingMsg | HelloMsg | ReportMsg;

export type WelcomeMsg = { t: "welcome"; v: number; room: string; host: string; peers: number };
export type PongMsg = { t: "pong"; seq: number; ct: number; st: number };
export type SnapMsg = { t: "snap"; n: number; st: number; pad: string };
export type ErrorMsg = { t: "error"; reason: string };
export type HostMsg = WelcomeMsg | PongMsg | SnapMsg | ErrorMsg;

export interface RoomInfo {
  room: string;
  host: string;
  peers: number;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function parseClientMsg(raw: string | null): ClientMsg | null {
  if (raw === null || raw.length > MAX_MSG_CHARS) return null;
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
  if (m.t === "report") {
    if (typeof m.data !== "object" || m.data === null || Array.isArray(m.data)) return null;
    return { t: "report", data: m.data as Record<string, unknown> };
  }
  return null;
}

export function pong(msg: PingMsg, now: number): PongMsg {
  return { t: "pong", seq: msg.seq, ct: msg.ct, st: now };
}

export function welcome(msg: HelloMsg, info: RoomInfo): WelcomeMsg | ErrorMsg {
  if (msg.v !== NETTEST_VERSION) return { t: "error", reason: "обновите страницу" };
  return { t: "welcome", v: NETTEST_VERSION, ...info };
}

const PAD = "x".repeat(SNAPSHOT_PAD_BYTES);

/** Поток снапшотов примерно того же размера, что будет слать хост в игре. */
export function makeSnapshot(n: number, now: number): SnapMsg {
  return { t: "snap", n, st: now, pad: PAD };
}
