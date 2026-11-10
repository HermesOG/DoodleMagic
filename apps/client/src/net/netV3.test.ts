import { NO_MATCH_INPUT } from "@doodlemagic/sim";
import { describe, expect, it } from "vitest";
import { buildMatchInput } from "../sandbox/controls";
import { BIT, NET_VERSION, inputText, packInput, parseClientMsg, unpackInput, type PackedInput } from "./protocol";
import { gamePeerId } from "./room";

/** Сеть v3 фазы 5 (Р10): ульта на X — бит 32, кнопки 0…63, свои id комнат. */
const packed = (buttons: number): PackedInput => [7, 0.5, -0.5, 1, -0.2, buttons];

describe("net v3", () => {
  it("is version 3 with its own peer ids", () => {
    expect(NET_VERSION).toBe(3);
    expect(gamePeerId("ABCD")).toBe("doodlemagic-g3-abcd-host");
  });

  it("packs X as bit 32 and back", () => {
    expect(BIT.x).toBe(32);
    const inp = { ...NO_MATCH_INPUT, yaw: 1.25, x: true };
    const p = packInput(4, inp);
    expect(p[5]).toBe(32);
    expect(unpackInput(p)).toEqual(inp);
    expect(unpackInput(packInput(5, { ...inp, x: false, q: true }))).toEqual({ ...inp, x: false, q: true });
  });

  it("the host accepts buttons 0…63 and nothing outside", () => {
    expect(parseClientMsg(inputText([packed(63)]))).toEqual({ t: "in", items: [{ seq: 7, input: unpackInput(packed(63)) }] });
    expect(unpackInput(packed(63))).toMatchObject({ jump: true, primary: true, q: true, e: true, c: true, x: true });
    expect(parseClientMsg(inputText([packed(64)]))).toBeNull();
    expect(parseClientMsg(inputText([packed(-1)]))).toBeNull();
  });

  it("KeyX presses the ult button", () => {
    expect(buildMatchInput(new Set(["KeyX"]), { yaw: 0, pitch: 0 })).toMatchObject({ x: true, q: false, c: false });
    expect(buildMatchInput(new Set(["KeyC"]), { yaw: 0, pitch: 0 })).toMatchObject({ x: false, c: true });
  });
});
