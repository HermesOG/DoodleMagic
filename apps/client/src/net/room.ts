import { NET_VERSION } from "./protocol";

/** Без I, L, O, 0, 1: код читают голосом и переписывают с экрана. */
export const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_LEN = 4;
export const NAME_POOL = ["Искра", "Уголёк", "Пепел", "Факел", "Жар", "Валун", "Кремень", "Гранит", "Щебень", "Скала"] as const;

/** Целое 0…n−1 из rand ∈ [0, 1); rand() = 1 не выводит за край. */
const pick = (rand: () => number, n: number): number => Math.min(n - 1, Math.floor(rand() * n));

/** ROOM_LEN знаков из алфавита. */
export function newRoomCode(rand: () => number = Math.random): string {
  let code = "";
  for (let k = 0; k < ROOM_LEN; k++) code += ROOM_ALPHABET.charAt(pick(rand, ROOM_ALPHABET.length));
  return code;
}

/** Верхний регистр, без пробелов и «-»; ровно ROOM_LEN знаков алфавита — код, иначе null. */
export function cleanRoomCode(raw: string): string | null {
  const code = raw.replace(/[\s-]+/g, "").toUpperCase();
  if (code.length !== ROOM_LEN) return null;
  for (const ch of code) if (!ROOM_ALPHABET.includes(ch)) return null;
  return code;
}

/** "/r/abcd", "/r/ABCD/" → "ABCD"; другой путь или плохой код → null. decodeURIComponent с защитой от исключения. */
export function parseRoomPath(pathname: string): string | null {
  const m = /^\/r\/([^/]+)\/?$/.exec(pathname);
  if (m === null) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  return cleanRoomCode(decoded);
}

/** PeerJS-ID хоста; отличается от теста связи (`doodlemagic-nt-…`). */
export function gamePeerId(code: string): string {
  return `doodlemagic-g${NET_VERSION}-${code.toLowerCase()}-host`;
}

export function roomLink(origin: string, code: string): string {
  return `${origin}/r/${code}`;
}

/** «Искра 42»: слово из NAME_POOL и число 10…99. */
export function defaultName(rand: () => number = Math.random): string {
  const word = NAME_POOL[pick(rand, NAME_POOL.length)] ?? NAME_POOL[0];
  return `${word} ${10 + pick(rand, 90)}`;
}
