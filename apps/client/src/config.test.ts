import { describe, expect, it } from "vitest";
import { cleanRoom, deviceKind, hostPeerId, netKind } from "./config";

// Скопировано из PeerJS 1.5.5: apps/client/node_modules/peerjs/dist/bundler.mjs, функция validateId.
// Peer с ID, который не проходит эту проверку, PeerJS не открывает (ошибка invalid-id).
const PEERJS_ID = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;

describe("cleanRoom", () => {
  it("uppercases and strips unsafe characters", () => {
    expect(cleanRoom("friends-1!<b>")).toBe("FRIENDS-1B");
  });

  it("limits the code to 32 characters", () => {
    expect(cleanRoom("a".repeat(40))).toBe("A".repeat(32));
  });

  it("falls back to FRIENDS", () => {
    expect(cleanRoom(null)).toBe("FRIENDS");
    expect(cleanRoom("!!!")).toBe("FRIENDS");
  });

  it.each([
    ["-X", "X"],
    ["X-", "X"],
    ["A--B", "A-B"],
    ["A_-B", "A_B"],
    ["__", "FRIENDS"],
    ["_-a-_", "A"],
  ])("turns %s into a code PeerJS accepts: %s", (raw, room) => {
    expect(cleanRoom(raw)).toBe(room);
  });

  it("does not leave a separator at the end after cutting to 32 characters", () => {
    expect(cleanRoom(`${"A".repeat(31)}-B`)).toBe("A".repeat(31));
  });

  it("always gives a host ID that PeerJS accepts", () => {
    const inputs = [null, "", "friends", "-X", "X-", "A--B", "A_-B", "__", "-", "a b c", "Комната 1", `${"A".repeat(31)}_B`];
    for (const raw of inputs) expect(hostPeerId(cleanRoom(raw)), String(raw)).toMatch(PEERJS_ID);
  });
});

describe("hostPeerId", () => {
  it("follows the plan's naming", () => {
    expect(hostPeerId("FRIENDS-1")).toBe("doodlemagic-nt-friends-1-host");
  });
});

describe("deviceKind", () => {
  it.each([
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "телефон"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "телефон"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15", "телефон"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "ПК"],
    ["", "ПК"],
  ])("classifies %s", (ua, kind) => {
    expect(deviceKind(ua)).toBe(kind);
  });
});

describe("netKind", () => {
  it("uses only the connection type: the effective type is a speed class and stays in conn", () => {
    expect(netKind({ type: "wifi", effectiveType: "4g" })).toBe("wifi");
    expect(netKind({ type: "cellular" })).toBe("cellular");
    expect(netKind({ effectiveType: "3g" })).toBe("?");
  });

  it("is ? without the Network Information API", () => {
    expect(netKind(undefined)).toBe("?");
    expect(netKind({})).toBe("?");
  });
});
