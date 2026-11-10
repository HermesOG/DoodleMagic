import { NO_MATCH_INPUT, type MatchInput } from "@doodlemagic/sim";
import { describe, expect, it } from "vitest";
import {
  BIT,
  INPUTS_PER_PACKET,
  MAX_INPUTS_PER_PACKET,
  MAX_TEXT_CHARS,
  NAME_MAX,
  NET_VERSION,
  cleanName,
  elementText,
  hostText,
  inputText,
  joinText,
  packInput,
  parseClientMsg,
  parseHostText,
  pingText,
  unpackInput,
  type PackedInput,
} from "./protocol";

/** Ввод из маски кнопок: бит i маски — кнопка из BIT. */
function inputOf(mask: number): MatchInput {
  return {
    ...NO_MATCH_INPUT,
    moveX: 0.5, moveZ: -1, yaw: 1.25, pitch: -0.3,
    jump: (mask & BIT.jump) !== 0, primary: (mask & BIT.primary) !== 0, q: (mask & BIT.q) !== 0, e: (mask & BIT.e) !== 0, c: (mask & BIT.c) !== 0,
  };
}
const packed = (over: Partial<Record<number, number>> = {}): PackedInput => {
  const p: PackedInput = [7, 0.5, -0.5, 1, -0.2, 3];
  for (const [k, v] of Object.entries(over)) p[Number(k)] = v as number;
  return p;
};
const inMsg = (i: unknown): string => JSON.stringify({ t: "in", i });

describe("packInput / unpackInput", () => {
  it("round-trips every combination of the five buttons", () => {
    for (let mask = 0; mask < 32; mask++) {
      const p = packInput(mask, inputOf(mask));
      expect(p[0]).toBe(mask);
      expect(p[5]).toBe(mask);
      expect(unpackInput(p)).toEqual(inputOf(mask));
    }
  });

  it("keeps the movement and the look exactly", () => {
    expect(packInput(12, inputOf(0))).toEqual([12, 0.5, -1, 1.25, -0.3, 0]);
  });
});

describe("message texts", () => {
  it("builds join, el, ping and in as JSON that parseClientMsg accepts", () => {
    expect(parseClientMsg(joinText("Искра 42", "fire"))).toEqual({ t: "join", v: NET_VERSION, name: "Искра 42", element: "fire" });
    expect(parseClientMsg(elementText("earth"))).toEqual({ t: "el", element: "earth" });
    expect(parseClientMsg(pingText(1234.5, 48))).toEqual({ t: "ping", ct: 1234.5, rtt: 48 });
    const ps = [packInput(5, inputOf(1)), packInput(6, inputOf(2)), packInput(7, inputOf(3))];
    const text = inputText(ps);
    expect(JSON.parse(text)).toEqual({ t: "in", i: ps });
    expect(parseClientMsg(text)).toEqual({ t: "in", items: ps.map((p) => ({ seq: p[0], input: unpackInput(p) })) });
  });

  it("builds host texts that parseHostText accepts", () => {
    expect(parseHostText(hostText({ t: "welcome", v: 1, id: 3, room: "ABCD" }))).toEqual({ t: "welcome", v: 1, id: 3, room: "ABCD" });
    expect(parseHostText(hostText({ t: "deny", reason: "full" }))).toEqual({ t: "deny", reason: "full" });
    expect(parseHostText(hostText({ t: "pong", ct: 99.5 }))).toEqual({ t: "pong", ct: 99.5 });
  });

  it("a packet carries 3 inputs by default and never more than the parser accepts", () => {
    expect(INPUTS_PER_PACKET).toBe(3);
    expect(INPUTS_PER_PACKET).toBeLessThanOrEqual(MAX_INPUTS_PER_PACKET);
  });
});

describe("cleanName", () => {
  it("returns an empty string for anything but a string", () => {
    for (const v of [undefined, null, 5, {}, ["a"], true]) expect(cleanName(v)).toBe("");
  });

  it("drops control and invisible characters", () => {
    expect(cleanName("A\u0000B\u0007C")).toBe("ABC");
    expect(cleanName("Ма\u200Bг\u202E\uFEFF")).toBe("Маг");
    expect(cleanName("a\nb\tc")).toBe("abc");
  });

  it("collapses runs of spaces and trims the edges", () => {
    expect(cleanName("   Искра    42   ")).toBe("Искра 42");
    expect(cleanName("a   \u3000 b")).toBe("a b");
    expect(cleanName("    ")).toBe("");
  });

  it("cuts to 16 code points without tearing emoji", () => {
    expect(NAME_MAX).toBe(16);
    expect(cleanName("x".repeat(40))).toBe("x".repeat(16));
    const fires = "🔥".repeat(20);
    expect(cleanName(fires)).toBe("🔥".repeat(16));
    expect(Array.from(cleanName(fires + "z")).length).toBe(16);
  });

  it("does not leave a trailing space after the cut", () => {
    expect(cleanName(`${"x".repeat(15)} yyy`)).toBe("x".repeat(15));
  });
});

describe("parseClientMsg: accepted", () => {
  it("accepts a join with a name and an element", () => {
    expect(parseClientMsg(JSON.stringify({ t: "join", v: 1, name: "  Жар  ", element: "earth" }))).toEqual({ t: "join", v: 1, name: "Жар", element: "earth" });
  });

  it("falls back to «Маг» for an empty or missing name", () => {
    expect(parseClientMsg(JSON.stringify({ t: "join", v: 1, name: "", element: "fire" }))).toMatchObject({ name: "Маг" });
    expect(parseClientMsg(JSON.stringify({ t: "join", v: 1, name: "\u200B \u0000", element: "fire" }))).toMatchObject({ name: "Маг" });
    expect(parseClientMsg(JSON.stringify({ t: "join", v: 1, element: "fire" }))).toMatchObject({ name: "Маг" });
    expect(parseClientMsg(JSON.stringify({ t: "join", v: 1, name: 42, element: "fire" }))).toMatchObject({ name: "Маг" });
  });

  it("accepts a join of another version: the host denies it, not the parser", () => {
    expect(parseClientMsg(JSON.stringify({ t: "join", v: 99, name: "a", element: "fire" }))).toMatchObject({ t: "join", v: 99 });
  });

  it("accepts 1 and 8 inputs, keeping the packet order", () => {
    const one = parseClientMsg(inMsg([packed()]));
    expect(one).toEqual({ t: "in", items: [{ seq: 7, input: unpackInput(packed()) }] });
    const eight = Array.from({ length: 8 }, (_, k) => packed({ 0: 100 - k }));
    const r = parseClientMsg(inMsg(eight));
    expect(r?.t === "in" ? r.items.map((x) => x.seq) : null).toEqual([100, 99, 98, 97, 96, 95, 94, 93]);
  });

  it("accepts every button mask 0…31 and seq 0", () => {
    for (let b = 0; b <= 31; b++) expect(parseClientMsg(inMsg([packed({ 0: 0, 5: b })]))).not.toBeNull();
  });

  it("clamps moveX and moveZ into [−1, 1]", () => {
    const r = parseClientMsg(inMsg([packed({ 1: 5, 2: -7 })]));
    expect(r?.t === "in" ? [r.items[0]?.input.moveX, r.items[0]?.input.moveZ] : null).toEqual([1, -1]);
  });

  it("accepts an element change and a ping, clamping rtt into [−1, 10000]", () => {
    expect(parseClientMsg(JSON.stringify({ t: "el", element: "fire" }))).toEqual({ t: "el", element: "fire" });
    expect(parseClientMsg(JSON.stringify({ t: "ping", ct: 5, rtt: 99999 }))).toEqual({ t: "ping", ct: 5, rtt: 10000 });
    expect(parseClientMsg(JSON.stringify({ t: "ping", ct: 5, rtt: -50 }))).toEqual({ t: "ping", ct: 5, rtt: -1 });
  });
});

describe("parseClientMsg: rejected", () => {
  it("rejects anything but a string", () => {
    for (const v of [undefined, null, 5, {}, [], new Uint8Array(3), true]) expect(parseClientMsg(v)).toBeNull();
  });

  it("rejects a text longer than 4096 characters", () => {
    expect(MAX_TEXT_CHARS).toBe(4096);
    const ok = JSON.stringify({ t: "el", element: "fire" });
    expect(parseClientMsg(ok + " ".repeat(MAX_TEXT_CHARS - ok.length))).not.toBeNull();
    expect(parseClientMsg(ok + " ".repeat(MAX_TEXT_CHARS - ok.length + 1))).toBeNull();
  });

  it("rejects broken JSON, arrays, scalars and unknown types", () => {
    for (const s of ["", "{", "nope", "[]", "[1,2]", "5", "null", '"in"', "{}", '{"t":"hello"}', '{"t":5}', '{"t":"IN","i":[]}']) expect(parseClientMsg(s)).toBeNull();
  });

  it("rejects an input packet with 0 or 9 inputs, or a non-array body", () => {
    expect(parseClientMsg(inMsg([]))).toBeNull();
    expect(parseClientMsg(inMsg(Array.from({ length: 9 }, () => packed())))).toBeNull();
    expect(parseClientMsg(inMsg("x"))).toBeNull();
    expect(parseClientMsg(inMsg({ 0: packed() }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "in" }))).toBeNull();
  });

  it("rejects an input with 5 or 7 numbers, or a non-array input", () => {
    expect(parseClientMsg(inMsg([[7, 0, 0, 0, 0]]))).toBeNull();
    expect(parseClientMsg(inMsg([[7, 0, 0, 0, 0, 0, 0]]))).toBeNull();
    expect(parseClientMsg(inMsg([{ seq: 7 }]))).toBeNull();
    expect(parseClientMsg(inMsg([7]))).toBeNull();
  });

  it("rejects NaN, Infinity and strings among the numbers", () => {
    // JSON не знает NaN: он приходит как null; строки и null — не числа.
    for (let k = 0; k < 6; k++) {
      expect(parseClientMsg(inMsg([packed({ [k]: Number.NaN })]))).toBeNull();
      expect(parseClientMsg(inMsg([packed({ [k]: Number.POSITIVE_INFINITY })]))).toBeNull();
      const withString = packed();
      (withString as unknown[])[k] = "1";
      expect(parseClientMsg(inMsg([withString]))).toBeNull();
    }
    expect(parseClientMsg('{"t":"in","i":[[1e999,0,0,0,0,0]]}')).toBeNull();
  });

  it("rejects a fractional or negative seq", () => {
    expect(parseClientMsg(inMsg([packed({ 0: 1.5 })]))).toBeNull();
    expect(parseClientMsg(inMsg([packed({ 0: -1 })]))).toBeNull();
    expect(parseClientMsg(inMsg([packed({ 0: 2 ** 60 })]))).toBeNull();
  });

  it("rejects buttons outside 0…63 or fractional", () => {
    expect(parseClientMsg(inMsg([packed({ 5: 64 })]))).toBeNull();
    expect(parseClientMsg(inMsg([packed({ 5: -1 })]))).toBeNull();
    expect(parseClientMsg(inMsg([packed({ 5: 1.5 })]))).toBeNull();
  });

  it("rejects a bad packet even if the other inputs are fine", () => {
    expect(parseClientMsg(inMsg([packed(), packed({ 5: 64 }), packed()]))).toBeNull();
  });

  it("rejects a join with an unknown element, a non-finite version or no element", () => {
    expect(parseClientMsg(JSON.stringify({ t: "join", v: 1, name: "a", element: "lava" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "join", v: 1, name: "a" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "join", v: "1", name: "a", element: "fire" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "join", name: "a", element: "fire" }))).toBeNull();
  });

  it("rejects an el with an unknown element, and a ping with a bad ct or rtt", () => {
    expect(parseClientMsg(JSON.stringify({ t: "el", element: "lava" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "el" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "ping", ct: "5", rtt: 1 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "ping", ct: 5 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "ping", ct: 5, rtt: null }))).toBeNull();
    expect(parseClientMsg('{"t":"ping","ct":1e999,"rtt":1}')).toBeNull();
  });
});

describe("parseHostText", () => {
  it("accepts welcome, deny and pong", () => {
    expect(parseHostText('{"t":"welcome","v":1,"id":2,"room":"ABCD"}')).toEqual({ t: "welcome", v: 1, id: 2, room: "ABCD" });
    expect(parseHostText('{"t":"deny","reason":"version"}')).toEqual({ t: "deny", reason: "version" });
    expect(parseHostText('{"t":"deny","reason":"full"}')).toEqual({ t: "deny", reason: "full" });
    expect(parseHostText('{"t":"pong","ct":12.5}')).toEqual({ t: "pong", ct: 12.5 });
  });

  it("rejects garbage", () => {
    for (const v of [undefined, null, 5, {}, [], "", "{", "[]", "null", "5", '{"t":"snap"}', '{"t":5}']) expect(parseHostText(v)).toBeNull();
    expect(parseHostText('{"t":"welcome","v":"1","id":2,"room":"ABCD"}')).toBeNull();
    expect(parseHostText('{"t":"welcome","v":1,"id":0,"room":"ABCD"}')).toBeNull();
    expect(parseHostText('{"t":"welcome","v":1,"id":1.5,"room":"ABCD"}')).toBeNull();
    expect(parseHostText('{"t":"welcome","v":1,"id":2,"room":"ABCDEFGHI"}')).toBeNull();
    expect(parseHostText('{"t":"welcome","v":1,"id":2,"room":5}')).toBeNull();
    expect(parseHostText('{"t":"deny","reason":"banned"}')).toBeNull();
    expect(parseHostText('{"t":"deny"}')).toBeNull();
    expect(parseHostText('{"t":"pong"}')).toBeNull();
    expect(parseHostText('{"t":"pong","ct":"1"}')).toBeNull();
  });

  it("accepts a room of exactly 8 characters", () => {
    expect(parseHostText('{"t":"welcome","v":1,"id":2,"room":"ABCDEFGH"}')).not.toBeNull();
  });
});
