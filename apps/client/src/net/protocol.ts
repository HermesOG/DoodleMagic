import { ELEMENTS, type Element, type MatchInput, type UnitId } from "@doodlemagic/sim";

/**
 * Версия сетевого протокола игры: хост и игрок разных версий вместе не играют. 2 — фаза 4: четыре стихии, прыжок
 * в looks; 3 — фаза 5: ульта на X (бит 32), заряд и каст ульты в снапшоте; 4 — фаза 6: объекты на карте и ярость
 * в снапшоте.
 */
export const NET_VERSION = 4;
export const NAME_MAX = 16;
/** Пинг бота в составе комнаты: игроки видят «бот» (Р13 фазы 8). Протокол не меняется. */
export const BOT_PING = -2;
/** Предел текстового сообщения игрока, знаков. */
export const MAX_TEXT_CHARS = 4096;
/** Сколько последних вводов несёт пакет игрока: пропавший пакет покрывают следующие. */
export const INPUTS_PER_PACKET = 3;
export const MAX_INPUTS_PER_PACKET = 8;
export const BIT = { jump: 1, primary: 2, q: 4, e: 8, c: 16, x: 32 } as const;
const BUTTONS_MAX = 63;
const RTT_MAX_MS = 10_000;
const ROOM_MAX_CHARS = 8;
const FALLBACK_NAME = "Маг";

/** Ввод тика в пакете: [seq, moveX, moveZ, yaw, pitch, кнопки по BIT]. */
export type PackedInput = [number, number, number, number, number, number];
export interface SeqInput { seq: number; input: MatchInput }
export type DenyReason = "full" | "version";

export type ClientMsg =
  | { t: "join"; v: number; name: string; element: Element }
  | { t: "in"; items: SeqInput[] }
  | { t: "el"; element: Element }
  | { t: "ping"; ct: number; rtt: number };
/** Текстовые сообщения хоста; снапшот идёт отдельно, двоичным (codec.ts). */
export type HostText =
  | { t: "welcome"; v: number; id: UnitId; room: string }
  | { t: "deny"; reason: DenyReason }
  | { t: "pong"; ct: number };

export function packInput(seq: number, inp: MatchInput): PackedInput {
  const buttons =
    (inp.jump ? BIT.jump : 0) | (inp.primary ? BIT.primary : 0) | (inp.q ? BIT.q : 0) | (inp.e ? BIT.e : 0) | (inp.c ? BIT.c : 0) | (inp.x ? BIT.x : 0);
  return [seq, inp.moveX, inp.moveZ, inp.yaw, inp.pitch, buttons];
}

export function unpackInput(p: PackedInput): MatchInput {
  const b = p[5];
  return {
    moveX: p[1], moveZ: p[2], yaw: p[3], pitch: p[4],
    jump: (b & BIT.jump) !== 0, primary: (b & BIT.primary) !== 0, q: (b & BIT.q) !== 0, e: (b & BIT.e) !== 0, c: (b & BIT.c) !== 0, x: (b & BIT.x) !== 0,
  };
}

/** Сообщение игрока для отправки: join, el, ping как JSON; ввод — {t:"in", i: PackedInput[]}. */
export function joinText(name: string, element: Element): string {
  return JSON.stringify({ t: "join", v: NET_VERSION, name, element });
}
export function inputText(packets: readonly PackedInput[]): string {
  return JSON.stringify({ t: "in", i: packets });
}
export function elementText(element: Element): string {
  return JSON.stringify({ t: "el", element });
}
export function pingText(ct: number, rtt: number): string {
  return JSON.stringify({ t: "ping", ct, rtt });
}
export function hostText(m: HostText): string {
  return JSON.stringify(m);
}

/** Ник: без управляющих и невидимых знаков, серии пробелов — один, не больше NAME_MAX кодовых точек. Не строка — "". */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const visible = raw.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  return Array.from(visible).slice(0, NAME_MAX).join("").trim();
}

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isElement = (x: unknown): x is Element => typeof x === "string" && (ELEMENTS as readonly string[]).includes(x);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Строка не длиннее MAX_TEXT_CHARS с JSON-объектом (не массивом) внутри; иначе null. */
function parseObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.length > MAX_TEXT_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** Один ввод пакета: ровно 6 конечных чисел, seq — целое ≥ 0, кнопки — целое 0…63; движение зажимается в [−1, 1]. */
function parsePacked(raw: unknown): SeqInput | null {
  if (!Array.isArray(raw) || raw.length !== 6 || !raw.every(isFiniteNumber)) return null;
  const [seq, moveX, moveZ, yaw, pitch, buttons] = raw as PackedInput;
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  if (!Number.isInteger(buttons) || buttons < 0 || buttons > BUTTONS_MAX) return null;
  return { seq, input: unpackInput([seq, clamp(moveX, -1, 1), clamp(moveZ, -1, 1), yaw, pitch, buttons]) };
}

/** Строгий разбор сообщения игрока: всё, что не подходит, — null. Хост не доверяет ничему. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  const m = parseObject(raw);
  if (m === null) return null;
  switch (m.t) {
    case "join": {
      if (!isFiniteNumber(m.v) || !isElement(m.element)) return null;
      return { t: "join", v: m.v, name: cleanName(m.name) || FALLBACK_NAME, element: m.element };
    }
    case "in": {
      const list = m.i;
      if (!Array.isArray(list) || list.length < 1 || list.length > MAX_INPUTS_PER_PACKET) return null;
      const items: SeqInput[] = [];
      for (const p of list) {
        const it = parsePacked(p);
        if (it === null) return null;
        items.push(it);
      }
      return { t: "in", items };
    }
    case "el":
      return isElement(m.element) ? { t: "el", element: m.element } : null;
    case "ping":
      if (!isFiniteNumber(m.ct) || !isFiniteNumber(m.rtt)) return null;
      return { t: "ping", ct: m.ct, rtt: clamp(m.rtt, -1, RTT_MAX_MS) };
    default:
      return null;
  }
}

/** Разбор текстового сообщения хоста (игроком): welcome, deny, pong; иначе null. */
export function parseHostText(raw: unknown): HostText | null {
  const m = parseObject(raw);
  if (m === null) return null;
  switch (m.t) {
    case "welcome":
      if (!isFiniteNumber(m.v) || !Number.isSafeInteger(m.id) || (m.id as number) < 1) return null;
      if (typeof m.room !== "string" || m.room.length > ROOM_MAX_CHARS) return null;
      return { t: "welcome", v: m.v, id: m.id as number, room: m.room };
    case "deny":
      return m.reason === "full" || m.reason === "version" ? { t: "deny", reason: m.reason } : null;
    case "pong":
      return isFiniteNumber(m.ct) ? { t: "pong", ct: m.ct } : null;
    default:
      return null;
  }
}
