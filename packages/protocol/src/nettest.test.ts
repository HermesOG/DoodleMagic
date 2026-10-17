import { describe, expect, it } from "vitest";
import {
  MAX_NAME_LEN,
  NETTEST_VERSION,
  SNAPSHOT_PAD_BYTES,
  makeSnapshot,
  parseClientMsg,
  parseTraceColo,
  pong,
  welcome,
} from "./nettest";

const info = { room: "FRIENDS", edge: "TAS", roomColo: "FRA", peers: 2 };

describe("parseClientMsg", () => {
  it("accepts a valid ping", () => {
    expect(parseClientMsg('{"t":"ping","seq":7,"ct":123.5}')).toEqual({ t: "ping", seq: 7, ct: 123.5 });
  });

  it("trims and truncates the hello name", () => {
    const raw = JSON.stringify({ t: "hello", v: 1, name: `  ${"a".repeat(40)}  ` });
    expect(parseClientMsg(raw)).toEqual({ t: "hello", v: 1, name: "a".repeat(MAX_NAME_LEN) });
  });

  it.each([
    ["broken json", "{"],
    ["null literal", "null"],
    ["unknown type", '{"t":"boom"}'],
    ["negative seq", '{"t":"ping","seq":-1,"ct":1}'],
    ["fractional seq", '{"t":"ping","seq":1.5,"ct":1}'],
    ["string ct", '{"t":"ping","seq":1,"ct":"1"}'],
    ["hello without name", '{"t":"hello","v":1}'],
  ])("rejects %s", (_label, raw) => {
    expect(parseClientMsg(raw)).toBeNull();
  });

  it("rejects null and oversized input", () => {
    expect(parseClientMsg(null)).toBeNull();
    expect(parseClientMsg("x".repeat(2000))).toBeNull();
  });
});

describe("pong", () => {
  it("echoes seq and client time and adds server time", () => {
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

  it("asks an outdated client to reload", () => {
    expect(welcome({ t: "hello", v: 999, name: "x" }, info)).toEqual({ t: "error", reason: "обновите страницу" });
  });
});

describe("makeSnapshot", () => {
  it("pads the snapshot to emulate game traffic", () => {
    const snap = makeSnapshot(4, 1000);
    expect(snap).toMatchObject({ t: "snap", n: 4, st: 1000 });
    expect(snap.t === "snap" && snap.pad.length).toBe(SNAPSHOT_PAD_BYTES);
  });
});

describe("parseTraceColo", () => {
  it("reads the colo line", () => {
    expect(parseTraceColo("fl=1\nh=x\ncolo=FRA\nhttp=http/2\n")).toBe("FRA");
  });

  it("returns ? when the line is missing", () => {
    expect(parseTraceColo("fl=1\n")).toBe("?");
  });
});
