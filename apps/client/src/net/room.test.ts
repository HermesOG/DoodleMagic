import { describe, expect, it } from "vitest";
import { NAME_POOL, ROOM_ALPHABET, ROOM_LEN, cleanRoomCode, defaultName, gamePeerId, newRoomCode, parseRoomPath, roomLink } from "./room";

/** Детерминированный rand: по кругу выдаёт заданные значения. */
const cycle = (vals: number[]): (() => number) => {
  let i = 0;
  return () => vals[i++ % vals.length]!;
};
/** Простой линейный конгруэнтный генератор: ровно распределённые числа [0, 1) для массовой проверки. */
const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

describe("ROOM_ALPHABET", () => {
  it("has no look-alike characters I, L, O, 0, 1 and no repeats", () => {
    for (const ch of "ILO01") expect(ROOM_ALPHABET).not.toContain(ch);
    expect(new Set(ROOM_ALPHABET).size).toBe(ROOM_ALPHABET.length);
    expect(ROOM_ALPHABET).toMatch(/^[A-Z2-9]+$/);
  });
});

describe("newRoomCode", () => {
  it("makes ROOM_LEN characters from the alphabet, deterministically for a given rand", () => {
    expect(ROOM_LEN).toBe(4);
    expect(newRoomCode(() => 0)).toBe("AAAA");
    expect(newRoomCode(() => 0.999999)).toBe("9999");
    // середины ячеек 0, 1, 2, 3: «ABCD»; порядок вызовов rand — слева направо
    expect(newRoomCode(cycle([0.5, 1.5, 2.5, 3.5].map((k) => k / ROOM_ALPHABET.length)))).toBe("ABCD");
    expect(newRoomCode(cycle([0.3, 0.6]))).toBe(newRoomCode(cycle([0.3, 0.6])));
  });

  it("never produces a code that cleanRoomCode rejects, even for rand() at the edges", () => {
    const rand = lcg(7);
    for (let k = 0; k < 2000; k++) {
      const c = newRoomCode(rand);
      expect(c).toHaveLength(ROOM_LEN);
      expect(cleanRoomCode(c)).toBe(c);
    }
    expect(newRoomCode(() => 1)).toHaveLength(ROOM_LEN);
    expect(cleanRoomCode(newRoomCode(() => 1))).not.toBeNull();
  });

  it("uses Math.random by default", () => {
    expect(cleanRoomCode(newRoomCode())).not.toBeNull();
  });
});

describe("cleanRoomCode", () => {
  it("uppercases and drops spaces and hyphens", () => {
    expect(cleanRoomCode("ab-cd")).toBe("ABCD");
    expect(cleanRoomCode("  a b c d ")).toBe("ABCD");
    expect(cleanRoomCode("abcd")).toBe("ABCD");
    expect(cleanRoomCode("2k9z")).toBe("2K9Z");
  });

  it("rejects look-alike characters", () => {
    for (const bad of ["ABCI", "ABCL", "ABCO", "ABC0", "ABC1"]) expect(cleanRoomCode(bad)).toBeNull();
  });

  it("rejects a wrong length", () => {
    for (const bad of ["", "ABC", "ABCDE", "---", "A-B-C"]) expect(cleanRoomCode(bad)).toBeNull();
  });

  it("rejects foreign characters", () => {
    for (const bad of ["ABC_", "AB/D", "АБВГ", "AB😀", "ABC\n"]) expect(cleanRoomCode(bad)).toBeNull();
  });
});

describe("parseRoomPath", () => {
  it("reads a code from /r/CODE with any case and an optional trailing slash", () => {
    expect(parseRoomPath("/r/abcd")).toBe("ABCD");
    expect(parseRoomPath("/r/ABCD/")).toBe("ABCD");
    expect(parseRoomPath("/r/aB-cD")).toBe("ABCD");
    expect(parseRoomPath("/r/ab%2Dcd")).toBe("ABCD");
  });

  it("gives null for a malformed escape instead of throwing", () => {
    expect(parseRoomPath("/r/%zz")).toBeNull();
    expect(parseRoomPath("/r/%E0%A4%A")).toBeNull();
  });

  it("gives null for other paths and bad codes", () => {
    for (const p of ["/play", "/", "", "/r/", "/r", "/r//", "/r/ABC", "/r/ABCDE", "/r/ABCI", "/r/ABCD/extra", "/x/r/ABCD", "/R/ABCD", "/r/AB%2FCD"]) {
      expect(parseRoomPath(p), p).toBeNull();
    }
  });
});

describe("gamePeerId and roomLink", () => {
  it("builds the host's peer id in lower case, different from the connection test's", () => {
    expect(gamePeerId("ABCD")).toBe("doodlemagic-g5-abcd-host");
    expect(gamePeerId("2K9Z")).toBe("doodlemagic-g5-2k9z-host");
    expect(gamePeerId("ABCD")).not.toContain("doodlemagic-nt-");
  });

  it("builds the invitation link", () => {
    expect(roomLink("https://doodle-magic-eight.vercel.app", "ABCD")).toBe("https://doodle-magic-eight.vercel.app/r/ABCD");
    expect(parseRoomPath(new URL(roomLink("http://localhost:5173", "K7M2")).pathname)).toBe("K7M2");
  });
});

describe("defaultName", () => {
  it("is a word from NAME_POOL and a number 10…99", () => {
    expect(NAME_POOL).toHaveLength(10);
    expect(defaultName(() => 0)).toBe("Искра 10");
    expect(defaultName(() => 0.999999)).toBe("Скала 99");
    const rand = lcg(11);
    for (let k = 0; k < 500; k++) {
      const [word, num] = defaultName(rand).split(" ");
      expect(NAME_POOL as readonly string[]).toContain(word);
      expect(Number(num)).toBeGreaterThanOrEqual(10);
      expect(Number(num)).toBeLessThanOrEqual(99);
    }
  });

  it("survives rand() = 1 and fits into a 16-character nick", () => {
    const n = defaultName(() => 1);
    expect(n).toMatch(/^\S+ \d\d$/);
    for (const w of NAME_POOL) expect(Array.from(`${w} 99`).length).toBeLessThanOrEqual(16);
  });

  it("is deterministic for a given rand", () => {
    expect(defaultName(cycle([0.35, 0.5]))).toBe(defaultName(cycle([0.35, 0.5])));
    expect(defaultName(cycle([0.35, 0.5]))).toBe("Факел 55");
  });

  it("uses Math.random by default", () => {
    expect(defaultName()).toMatch(/^\S+ \d\d$/);
  });
});
