import { NEVER, NO_MATCH_INPUT, aabb, createMatch, createWorld, stepMatch, type MatchContext, type MatchState } from "@doodlemagic/sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DECODED_BYTES, QUANT, decodeBinary, encodeBinary, quantize } from "./codec";

afterEach(() => vi.unstubAllGlobals());

/** Матч из двух магов и 120 тиков: бег, кнопки, снаряды — настоящее состояние, как в снапшоте. */
function realState(): MatchState {
  const ctx: MatchContext = { world: createWorld([{ box: aabb(-40, -1, -40, 40, 0, 40), tag: "floor" }]), killBelowY: -30 };
  let s = createMatch({
    mages: [
      { element: "fire", spawn: { pos: { x: -4, y: 0, z: 0 }, yaw: -Math.PI / 2 } },
      { element: "earth", spawn: { pos: { x: 4, y: 0, z: 0 }, yaw: Math.PI / 2 } },
    ],
    dummies: [{ pos: { x: 0, y: 0, z: -10 }, yaw: 0 }],
  });
  for (let k = 0; k < 120; k++) {
    s = stepMatch(s, {
      1: { ...NO_MATCH_INPUT, moveZ: 1, moveX: Math.sin(k / 17) * 0.7, yaw: -Math.PI / 2 + Math.sin(k / 23) * 0.4, pitch: -0.11, primary: k % 40 < 20, q: k === 50 },
      2: { ...NO_MATCH_INPUT, moveZ: k % 60 < 30 ? 1 : -1, yaw: Math.PI / 2 + Math.cos(k / 19) * 0.3, pitch: 0.07, jump: k === 30, primary: k % 55 === 5, e: k === 80 },
    }, ctx).state;
  }
  return s;
}
const jsonBytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

describe("quantize", () => {
  it("rounds non-integers to 1e-5", () => {
    expect(QUANT).toBe(1e5);
    expect(quantize(1.234567891)).toBe(1.23457);
    expect(quantize(-0.000004)).toBe(0);
    expect(quantize(0.1 + 0.2)).toBe(0.3);
    expect(quantize(Math.PI)).toBe(3.14159);
    expect(quantize(-2.718281828)).toBe(-2.71828);
  });

  it("keeps integers as they are, including NEVER", () => {
    for (const n of [0, 1, -1, 12345678, NEVER, 2 ** 40]) expect(quantize(n)).toBe(n);
  });

  it("turns -0 into 0, NaN and ±Infinity into 0", () => {
    expect(Object.is(quantize(-0), 0)).toBe(true);
    expect(Object.is(quantize(-1e-9), 0)).toBe(true);
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(Object.is(quantize(n), 0)).toBe(true);
  });

  it("copies nested arrays and objects deeply, leaving the original alone", () => {
    const src = { a: [1.123456, { b: -0, c: [0.999999999] }], d: { e: Number.NaN, f: 2.5 } };
    const out = quantize(src) as typeof src;
    expect(out).toEqual({ a: [1.12346, { b: 0, c: [1] }], d: { e: 0, f: 2.5 } });
    expect(out).not.toBe(src);
    expect(out.a).not.toBe(src.a);
    expect(src.a[0]).toBe(1.123456);
  });

  it("keeps strings, booleans and null as they are", () => {
    expect(quantize("мир")).toBe("мир");
    expect(quantize(true)).toBe(true);
    expect(quantize(false)).toBe(false);
    expect(quantize(null)).toBeNull();
    expect(quantize({ s: "x", t: true, n: null })).toEqual({ s: "x", t: true, n: null });
  });
});

describe("encodeBinary / decodeBinary", () => {
  it("round-trips a real match state to exactly quantize(state)", async () => {
    const state = realState();
    const bytes = await encodeBinary(state);
    expect(await decodeBinary(bytes)).toEqual(quantize(state));
  });

  it("starts with the format byte 1 (deflate-raw) and compresses to less than half of the JSON", async () => {
    const state = realState();
    const bytes = await encodeBinary(state);
    expect(bytes[0]).toBe(1);
    expect(bytes.length).toBeLessThan(jsonBytes(quantize(state)) / 2);
  });

  it("decodes from an ArrayBuffer and from a view into a bigger buffer", async () => {
    const value = { a: [1.5, 2, "x"], b: null };
    const bytes = await encodeBinary(value);
    const copy = bytes.slice().buffer;
    expect(await decodeBinary(copy)).toEqual(value);
    const padded = new Uint8Array(bytes.length + 10);
    padded.set(bytes, 5);
    expect(await decodeBinary(padded.subarray(5, 5 + bytes.length))).toEqual(value);
  });

  it("round-trips scalars and an empty object", async () => {
    for (const v of [{}, [], 0, "s", null, true]) expect(await decodeBinary(await encodeBinary(v))).toEqual(v);
  });

  it("returns undefined for broken bytes, an empty array and an unknown format", async () => {
    expect(await decodeBinary(new Uint8Array(0))).toBeUndefined();
    expect(await decodeBinary(new ArrayBuffer(0))).toBeUndefined();
    expect(await decodeBinary(new Uint8Array([1]))).toBeUndefined();
    expect(await decodeBinary(new Uint8Array([1, 9, 9, 9, 9, 9, 9, 9]))).toBeUndefined();
    expect(await decodeBinary(new Uint8Array([2, 123, 125]))).toBeUndefined();
    expect(await decodeBinary(new Uint8Array([255, 123, 125]))).toBeUndefined();
    expect(await decodeBinary(new Uint8Array([0, 0x7b]))).toBeUndefined(); // «{» без конца: не JSON
    expect(await decodeBinary(new Uint8Array([0, 0xff, 0xfe]))).toBeUndefined(); // не UTF-8
  });

  it("returns undefined for a truncated deflate stream", async () => {
    const bytes = await encodeBinary(realState());
    expect(await decodeBinary(bytes.subarray(0, Math.floor(bytes.length / 2)))).toBeUndefined();
  });

  it("returns undefined when the unpacked data is over MAX_DECODED_BYTES", async () => {
    expect(MAX_DECODED_BYTES).toBe(4 * 1024 * 1024);
    // 5 МБ нулей сжимаются в несколько КБ: бомба распаковки.
    const bomb = await encodeBinary("a".repeat(5 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(await decodeBinary(bomb)).toBeUndefined();
    const huge = new Uint8Array(MAX_DECODED_BYTES + 2);
    huge.fill(0x20);
    huge[0] = 0;
    expect(await decodeBinary(huge)).toBeUndefined();
  });

  it("without CompressionStream writes format 0 (plain JSON) and still reads it back", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const state = realState();
    const bytes = await encodeBinary(state);
    expect(bytes[0]).toBe(0);
    expect(new TextDecoder().decode(bytes.subarray(1))).toBe(JSON.stringify(quantize(state)));
    expect(await decodeBinary(bytes)).toEqual(quantize(state));
  });

  it("reads format 0 even without DecompressionStream, and format 1 then fails cleanly", async () => {
    const packed = await encodeBinary({ k: 1.5 });
    vi.stubGlobal("DecompressionStream", undefined);
    const plain = new Uint8Array([0, ...new TextEncoder().encode('{"k":1.5}')]);
    expect(await decodeBinary(plain)).toEqual({ k: 1.5 });
    expect(await decodeBinary(packed)).toBeUndefined();
  });
});
