import "./style.css";
import { deviceKind } from "./config";
import { mountNettest } from "./nettest/page";

/** Страница по пути: /play — хост комнаты, /r/КОД — игрок (плохой код — noRoom), прочее — как раньше. */
export type Route =
  | { page: "nettest" }
  | { page: "renderTest" }
  | { page: "fxTest" }
  | { page: "host" }
  | { page: "join"; code: string }
  | { page: "noRoom" }
  | { page: "sandbox" };

/** Путь комнаты игрока: /r и всё под /r/. */
export const isRoomPath = (pathname: string): boolean => pathname === "/r" || pathname.startsWith("/r/");

/**
 * Разбор маршрута. parseRoom — net/room.parseRoomPath: он тянет за собой симуляцию (протокол знает стихии), поэтому
 * main.ts грузит его отдельным чанком и только на путях комнаты — /nettest остаётся лёгким.
 */
export function routeOf(pathname: string, parseRoom: (pathname: string) => string | null): Route {
  if (pathname.startsWith("/nettest")) return { page: "nettest" };
  if (pathname.startsWith("/render-test")) return { page: "renderTest" };
  if (pathname.startsWith("/fx-test")) return { page: "fxTest" };
  if (pathname === "/play" || pathname === "/play/") return { page: "host" };
  if (isRoomPath(pathname)) {
    const code = parseRoom(pathname);
    return code ? { page: "join", code } : { page: "noRoom" };
  }
  return { page: "sandbox" };
}

export const NO_ROOM_TITLE = "Нет такой комнаты";
export const NEED_PC_TITLE = "Нужен компьютер с клавиатурой и мышью";

/** Простой экран-сообщение без игры: заголовок, пояснение и ссылка на полигон. */
function showNotice(app: HTMLElement, title: string, text: string): void {
  const card = document.createElement("section");
  card.className = "card";
  const h = document.createElement("h1");
  h.textContent = title;
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = text;
  const a = document.createElement("a");
  a.className = "btn secondary";
  a.href = "/?mode=training";
  a.textContent = "На полигон";
  card.append(h, p, a);
  app.replaceChildren(card);
}

function open(app: HTMLElement, route: Route): void {
  // three.js, арена и симуляция грузятся отдельными чанками: /nettest остаётся лёгким
  const failed = (what: string) => (err: unknown) => {
    app.textContent = `Не удалось загрузить ${what}: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  };
  switch (route.page) {
    case "nettest":
      mountNettest(app);
      break;
    case "renderTest":
      import("./render/testPage").then((m) => m.mountRenderTest(app)).catch(failed("рендер"));
      break;
    case "fxTest":
      import("./fx/fxTestPage").then((m) => m.mountFxTest(app)).catch(failed("эффекты"));
      break;
    case "noRoom":
      showNotice(app, NO_ROOM_TITLE, "В ссылке нет кода комнаты или он с ошибкой. Попроси у хоста ссылку ещё раз.");
      break;
    case "host":
    case "join": {
      if (deviceKind(navigator.userAgent) === "телефон") {
        showNotice(app, NEED_PC_TITLE, "Бой с друзьями пока только на компьютере: открой эту ссылку там.");
        break;
      }
      const code = route.page === "join" ? route.code : null;
      import("./pvp/page").then((m) => m.mountPvp(app, code)).catch(failed("игру"));
      break;
    }
    case "sandbox":
      import("./sandbox/page").then((m) => m.mountSandbox(app)).catch(failed("игру"));
      break;
  }
}

// в тестах (node) документа нет: модуль только отдаёт routeOf
if (typeof document !== "undefined") {
  const app = document.getElementById("app");
  if (!app) throw new Error("#app missing");
  const path = location.pathname;
  if (isRoomPath(path)) {
    import("./net/room").then((m) => open(app, routeOf(path, m.parseRoomPath))).catch((err: unknown) => {
      app.textContent = `Не удалось загрузить игру: ${err instanceof Error ? err.message : String(err)}`;
      console.error(err);
    });
  } else open(app, routeOf(path, () => null));
}
