import { describe, expect, it } from "vitest";
import {
  MAX_MSG_CHARS,
  MAX_NAME_LEN,
  NETTEST_VERSION,
  SNAPSHOT_PAD_BYTES,
  makeSnapshot,
  parseClientMsg,
  pong,
  welcome,
} from "./nettest";

const info = { room: "FRIENDS", host: "Хост", peers: 2 };

/** Валидный ping, раздутый лишним полем до нужной длины. */
function pingOfLength(length: number): string {
  const base = JSON.stringify({ t: "ping", seq: 1, ct: 1, pad: "" });
  return JSON.stringify({ t: "ping", seq: 1, ct: 1, pad: "x".repeat(length - base.length) });
}

describe("parseClientMsg", () => {
  it("accepts a valid ping", () => {
    expect(parseClientMsg('{"t":"ping","seq":7,"ct":123.5}')).toEqual({ t: "ping", seq: 7, ct: 123.5 });
  });

  it("trims and truncates the hello name", () => {
    const raw = JSON.stringify({ t: "hello", v: 2, name: `  ${"a".repeat(40)}  ` });
    expect(parseClientMsg(raw)).toEqual({ t: "hello", v: 2, name: "a".repeat(MAX_NAME_LEN) });
  });

  it("accepts a report with an object payload", () => {
    expect(parseClientMsg('{"t":"report","data":{"v":2,"name":"Аня"}}')).toEqual({
      t: "report",
      data: { v: 2, name: "Аня" },
    });
  });

  it.each([
    ["broken json", "{"],
    ["null literal", "null"],
    ["unknown type", '{"t":"boom"}'],
    ["negative seq", '{"t":"ping","seq":-1,"ct":1}'],
    ["fractional seq", '{"t":"ping","seq":1.5,"ct":1}'],
    ["unsafe seq", `{"t":"ping","seq":${2 ** 60},"ct":1}`],
    ["string ct", '{"t":"ping","seq":1,"ct":"1"}'],
    ["ping without ct", '{"t":"ping","seq":1}'],
    ["hello without name", '{"t":"hello","v":2}'],
    ["hello with string version", '{"t":"hello","v":"2","name":"x"}'],
    ["report with array data", '{"t":"report","data":[1,2]}'],
    ["report with null data", '{"t":"report","data":null}'],
  ])("rejects %s", (_label, raw) => {
    expect(parseClientMsg(raw)).toBeNull();
  });

  it("rejects null input", () => {
    expect(parseClientMsg(null)).toBeNull();
  });

  it("enforces the length limit on otherwise valid messages", () => {
    expect(parseClientMsg(pingOfLength(MAX_MSG_CHARS))).toMatchObject({ t: "ping", seq: 1 });
    expect(parseClientMsg(pingOfLength(MAX_MSG_CHARS + 1))).toBeNull();
  });
});

describe("pong", () => {
  it("echoes seq and client time and adds host time", () => {
    expect(pong({ t: "ping", seq: 3, ct: 99 }, 5000)).toEqual({ t: "pong", seq: 3, ct: 99, st: 5000 });
  });
});

describe("welcome", () => {
  it("returns room info for the current version", () => {
    expect(welcome({ t: "hello", v: NETTEST_VERSION, name: "Аня" }, info)).toEqual({
      t: "welcome",
      v: NETTEST_VERSION,
      ...info,
    });
  });

  it("asks an outdated participant to reload", () => {
    expect(welcome({ t: "hello", v: 1, name: "x" }, info)).toEqual({ t: "error", reason: "обновите страницу" });
  });
});

describe("makeSnapshot", () => {
  it("pads the snapshot to emulate game traffic", () => {
    const snap = makeSnapshot(4, 1000);
    expect(snap).toMatchObject({ t: "snap", n: 4, st: 1000 });
    expect(snap.pad).toHaveLength(SNAPSHOT_PAD_BYTES);
  });
});
