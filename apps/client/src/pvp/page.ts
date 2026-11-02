import { buildGallery } from "@doodlemagic/arena";
import { pvpContext, unitById, type ArenaData, type Element, type MatchContext } from "@doodlemagic/sim";
import { mountGameView, type GameView } from "../game/view";
import { loadPrefs, savePrefs } from "../hud/prefs";
import { lagFromQuery, type LagOptions } from "../net/link";
import { defaultName, roomLink } from "../net/room";
import type { MenuButton } from "../sandbox/hud";
import { connectClient } from "./clientDriver";
import { startHost, type HostDriver, type LinkState, type PvpDriver } from "./hostDriver";
import {
  HOST_LEFT_TEXT, SIGNALLING_TEXT, createLobby, initialName, joinErrorText, joinStatusText, loadName, saveName, uniqueName,
} from "./lobby";
import "./pvp.css";

const COPY_LABEL = "Скопировать ссылку";
const COPIED_MS = 2000;

/**
 * Бой с друзьями: /play — хост (комната открывается сразу, вход — по «Войти» в лобби), /r/КОД — игрок (канал к хосту
 * сразу, вход — по «Войти»). Арена — «Галерея над ущельем» с точками появления (pvpContext). После входа — общий
 * игровой вид с драйвером хоста или игрока; интерфейс матча — задача 8.
 */
export function mountPvp(root: HTMLElement, code: string | null): void {
  const arena = buildGallery("full");
  const ctx = pvpContext(arena);
  const lag = lagFromQuery(location.search);
  // из bfcache страница вернулась с мёртвой связью: заново
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) location.reload();
  });
  if (code === null) mountHost(root, arena, ctx, lag);
  else mountClient(root, arena, ctx, code, lag);
}

/** Стихия выбрана в лобби: запоминаем, как выбор на экране стихий. */
function rememberElement(element: Element): void {
  savePrefs({ ...loadPrefs(), element });
}

function mountHost(root: HTMLElement, arena: ArenaData, ctx: MatchContext, lag: LagOptions | null): void {
  const fallback = initialName(loadName(), defaultName);
  let driver: HostDriver | null = null;
  let entered = false;
  const lobby = createLobby({
    root,
    host: true,
    code: null,
    name: fallback,
    element: loadPrefs().element,
    onEnter(name, element) {
      if (!driver || entered) return;
      entered = true;
      saveName(name);
      rememberElement(element);
      // хост именует так же: в лобби видно, кто уже в комнате, — входим под свободным именем
      driver.enter(uniqueName(name, driver.names().values()), element);
      startGame(root, arena, ctx, driver, element);
    },
  });
  lobby.setEnterEnabled(false);
  lobby.setStatus("Открываю комнату…");
  startHost({
    ctx,
    lag,
    onRoster() {
      if (driver && !entered) lobby.setRoster(Array.from(driver.names().values()));
    },
  }).then(
    (d) => {
      driver = d;
      window.addEventListener("pagehide", () => d.dispose());
      lobby.setRoom(d.roomCode, roomLink(location.origin, d.roomCode));
      lobby.setStatus("");
      lobby.setEnterEnabled(true);
    },
    (err: unknown) => {
      console.error(err);
      lobby.showError(SIGNALLING_TEXT);
    },
  );
}

function mountClient(root: HTMLElement, arena: ArenaData, ctx: MatchContext, code: string, lag: LagOptions | null): void {
  let element = loadPrefs().element;
  let inGame = false;
  const lobby = createLobby({
    root,
    host: false,
    code,
    name: initialName(loadName(), defaultName),
    element,
    onEnter(name, chosen) {
      element = chosen;
      saveName(name);
      rememberElement(chosen);
      lobby.setEnterEnabled(false);
      session.join(name, chosen);
    },
  });
  const session = connectClient({
    code,
    ctx,
    lag,
    onStatus(s) {
      if (!inGame) lobby.setStatus(joinStatusText(s));
    },
    onError: (e) => lobby.showError(joinErrorText(e, code)),
    onReady(d) {
      inGame = true;
      startGame(root, arena, ctx, d, element);
    },
    onClosed() {
      // в игре обрыв показывает кадр (link() = "closed")
      if (!inGame) lobby.showError(HOST_LEFT_TEXT);
    },
  });
  window.addEventListener("pagehide", () => session.dispose());
}

/** Ссылка в буфер обмена; кнопка на 2 с говорит, вышло ли. Не вышло — ссылка есть в тексте меню, её можно выделить. */
function copyLink(url: string, button: MenuButton): void {
  const show = (label: string): void => {
    button.setLabel(label);
    setTimeout(() => button.setLabel(COPY_LABEL), COPIED_MS);
  };
  if (!navigator.clipboard) {
    show("Не вышло — выдели ссылку выше");
    return;
  }
  navigator.clipboard.writeText(url).then(
    () => show("Ссылка скопирована"),
    () => show("Не вышло — выдели ссылку выше"),
  );
}

/** Строка сверху (заготовка до интерфейса матча), плашка «нет связи» и экран «Хост вышел». */
function createOverlay(root: HTMLElement): { top: HTMLElement; stale: HTMLElement; over: HTMLElement } {
  const top = document.createElement("div");
  top.className = "pvp-top";
  const stale = document.createElement("div");
  stale.className = "pvp-stale";
  stale.setAttribute("role", "status");
  stale.textContent = "Нет связи с хостом…";
  stale.hidden = true;
  const over = document.createElement("div");
  over.className = "pvp-over";
  over.hidden = true;
  over.innerHTML = `<section class="pvp-over-card">
      <h1></h1>
      <p></p>
      <a class="btn" href="/">На полигон</a>
    </section>`;
  over.querySelector("h1")!.textContent = HOST_LEFT_TEXT;
  over.querySelector("p")!.textContent = "Матч окончен. Новая комната — у того, кто нажмёт «Играть с друзьями».";
  root.append(top, stale, over);
  return { top, stale, over };
}

/**
 * Игровой вид поверх драйвера сети: без экрана стихий (её выбрали в лобби), имена над магами. Меню: «Начать матч»
 * у хоста (в разминке, «Ещё раз» на итогах) и «Скопировать ссылку» у всех.
 */
function startGame(root: HTMLElement, arena: ArenaData, ctx: MatchContext, driver: PvpDriver, element: Element): void {
  const code = driver.roomCode;
  const url = roomLink(location.origin, code);
  let view: GameView | null = null;
  let ui: ReturnType<typeof createOverlay> | null = null;
  let startButton: MenuButton | null = null;
  let shownPhase = "";
  let shownTop = "";
  let shownLink: LinkState = "ok";
  let shownElement = element;
  let wasLocked = false;

  const onFrame = (): void => {
    if (!view || !ui) return;
    const g = driver.game();
    if (g.phase !== shownPhase) {
      shownPhase = g.phase;
      startButton?.setVisible(g.phase === "warmup" || g.phase === "results");
      startButton?.setLabel(g.phase === "results" ? "Ещё раз" : "Начать матч");
    }
    const top = `Комната ${code} · магов ${g.match.units.filter((u) => u.mage !== null).length}`;
    if (top !== shownTop) ui.top.textContent = shownTop = top;
    // стихия в меню — как у мага в игре: хост мог отказать (в бою живым нельзя), а смена у игрока идёт через хоста
    const mine = unitById(g.match, driver.localId)?.mage?.element;
    const unlocked = wasLocked && !view.input.locked;
    wasLocked = view.input.locked;
    if (mine && (mine !== shownElement || unlocked)) {
      shownElement = mine;
      view.hud.setElement(mine);
    }
    const state = driver.link();
    if (state === shownLink) return;
    shownLink = state;
    ui.stale.hidden = state !== "stale";
    if (state === "closed") {
      // хост ушёл (Н10): матч окончен, кадры встают, мышь отпускается
      ui.over.hidden = false;
      view.stop();
      driver.dispose();
    }
  };

  view = mountGameView({ root, arena, ctx, driver, element, selectOnStart: false, names: () => driver.names(), onFrame });
  // сбой рендера при запуске: сообщение уже в HUD
  if (!view) {
    driver.dispose();
    return;
  }
  ui = createOverlay(root);
  const lead = driver.isHost
    ? `Ты хост: комната живёт, пока открыта эта вкладка. Ссылка для друзей: ${url}`
    : `Матч начинает хост. Ссылка для друзей: ${url}`;
  view.hud.setMenuText(`Комната ${code}`, lead);
  if (driver.isHost) startButton = view.hud.addMenuButton("Начать матч", () => driver.start());
  const copy = view.hud.addMenuButton(COPY_LABEL, () => copyLink(url, copy));
}
