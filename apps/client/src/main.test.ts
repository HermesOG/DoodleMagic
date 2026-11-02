import { describe, expect, it, vi } from "vitest";
import { parseRoomPath } from "./net/room";

// страница теста связи тянет PeerJS: для разбора маршрутов она не нужна
vi.mock("./nettest/page", () => ({ mountNettest: vi.fn() }));
const { isRoomPath, routeOf } = await import("./main");

const route = (pathname: string) => routeOf(pathname, parseRoomPath);

describe("routeOf", () => {
  it("keeps the old pages", () => {
    expect(route("/")).toEqual({ page: "sandbox" });
    expect(route("/whatever")).toEqual({ page: "sandbox" });
    expect(route("/nettest")).toEqual({ page: "nettest" });
    expect(route("/nettest/x")).toEqual({ page: "nettest" });
    expect(route("/render-test")).toEqual({ page: "renderTest" });
    expect(route("/fx-test")).toEqual({ page: "fxTest" });
  });

  it("opens a room for the host on /play", () => {
    expect(route("/play")).toEqual({ page: "host" });
    expect(route("/play/")).toEqual({ page: "host" });
    expect(route("/playground")).toEqual({ page: "sandbox" });
  });

  it("joins the room from /r/CODE, any case, with a trailing slash", () => {
    expect(route("/r/ABCD")).toEqual({ page: "join", code: "ABCD" });
    expect(route("/r/abcd/")).toEqual({ page: "join", code: "ABCD" });
    expect(route("/r/x7k2")).toEqual({ page: "join", code: "X7K2" });
  });

  it("sends a bad or missing code to «Нет такой комнаты»", () => {
    for (const p of ["/r", "/r/", "/r/AB1D", "/r/ABC", "/r/ABCDE", "/r/ABCD/x", "/r/%E0%A4%A", "/r/AB-O0"]) {
      expect(route(p), p).toEqual({ page: "noRoom" });
    }
  });

  it("asks the room parser only on room paths", () => {
    const parse = vi.fn(() => "ABCD");
    routeOf("/play", parse);
    routeOf("/", parse);
    routeOf("/rooms", parse);
    expect(parse).not.toHaveBeenCalled();
    expect(routeOf("/r/zzzz", parse)).toEqual({ page: "join", code: "ABCD" });
    expect(parse).toHaveBeenCalledWith("/r/zzzz");
  });
});

describe("isRoomPath", () => {
  it("is /r and everything under /r/", () => {
    expect(isRoomPath("/r")).toBe(true);
    expect(isRoomPath("/r/")).toBe(true);
    expect(isRoomPath("/r/ABCD")).toBe(true);
    expect(isRoomPath("/rooms")).toBe(false);
    expect(isRoomPath("/")).toBe(false);
  });
});
