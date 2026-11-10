import { buildGallery } from "@doodlemagic/arena";
import {
  BOT_LEVELS, BOT_LEVEL_NAME, pvpContext, unitById, type ArenaData, type BotLevel, type Element, type MatchContext,
} from "@doodlemagic/sim";
import type { Frame } from "../game/driver";
import { mountGameView, type GameView } from "../game/view";
import { loadPrefs, savePrefs } from "../hud/prefs";
import { lagFromQuery, type LagOptions } from "../net/link";
import { defaultName, roomLink } from "../net/room";
import type { MenuButton } from "../sandbox/hud";
import { connectClient } from "./clientDriver";
import { startHost, type HostDriver, type LinkState, type PvpDriver } from "./hostDriver";
import {
  HOST_LEFT_TEXT, SIGNALLING_TEXT, createLobby, initialName, joinErrorText, joinStatusText, loadName, saveName,
} from "./lobby";
import { createMatchHud, type MatchHud } from "./matchHud";
import "./pvp.css";

const COPY_LABEL = "Скопировать ссылку";
const COPIED_MS = 2000;
/** Хост ушёл посреди игры (в лобби — короткое HOST_LEFT_TEXT). */
const HOST_LEFT_GAME_TEXT = "Хост вышел из игры";

/**
 * Бой с друзьями: /play — хост (комната открывается сразу, вход — по «Войти» в лобби), /r/КОД — игрок (канал к хосту
 * сразу, вход — по «Войти»). Арена — «Галерея над ущельем» с точками появления (pvpContext). После входа — общий
 * игровой вид с драйвером хоста или игрока и интерфейс матча (matchHud).
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

/** Сложность ботов комнаты (Р16 фазы 8): одна на комнату, щелчок — следующая. */
interface BotControl {
  level: BotLevel;
}
const nextLevel = (l: BotLevel): BotLevel => BOT_LEVELS[(BOT_LEVELS.indexOf(l) + 1) % BOT_LEVELS.length]!;

/** Стихия выбрана в лобби: запоминаем, как выбор на экране стихий. */
function rememberElement(element: Element): void {
  savePrefs({ ...loadPrefs(), element });
}

function mountHost(root: HTMLElement, arena: ArenaData, ctx: MatchContext, lag: LagOptions | null): void {
  const fallback = initialName(loadName(), defaultName);
  let driver: HostDriver | null = null;
  let entered = false;
  const bots: BotControl = { level: "mage" };
  const syncBots = (): void => {
    if (driver && !entered) lobby.setBots(driver.botCount(), BOT_LEVEL_NAME[bots.level], driver.canAddBot());
  };
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
      // занятое имя ядро хоста само сделает свободным («Искра 2»), как у игроков
      driver.enter(name, element);
      startGame(root, arena, ctx, driver, element, bots);
    },
    bots: {
      onAdd: () => driver?.addBot(bots.level),
      onRemove: () => driver?.removeBot(),
      onLevel() {
        bots.level = nextLevel(bots.level);
        driver?.setBotLevel(bots.level);
        syncBots();
      },
    },
  });
  lobby.setEnterEnabled(false);
  lobby.setStatus("Открываю комнату…");
  startHost({
    ctx,
    lag,
    onRoster() {
      if (driver && !entered) lobby.setRoster(Array.from(driver.names().values()));
      syncBots();
    },
  }).then(
    (d) => {
      driver = d;
      window.addEventListener("pagehide", () => d.dispose());
      lobby.setRoom(d.roomCode, roomLink(location.origin, d.roomCode));
      lobby.setStatus("");
      lobby.setEnterEnabled(true);
      syncBots();
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

/**
 * Плашка «нет связи» и окно «Хост вышел из игры» (строка сверху — в интерфейсе матча). rejoin — ссылка комнаты
 * для игрока: канал мог оборваться у него самого, а хост ещё в комнате, — «Зайти снова».
 */
function createOverlay(root: HTMLElement, rejoin: string | null): { stale: HTMLElement; over: HTMLElement } {
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
      <div class="actions">
        <a class="btn pvp-rejoin" hidden>Зайти снова</a>
        <a class="btn secondary" href="/">На полигон</a>
      </div>
    </section>`;
  if (rejoin !== null) {
    const again = over.querySelector<HTMLAnchorElement>(".pvp-rejoin")!;
    again.href = rejoin;
    again.hidden = false;
  }
  over.querySelector("h1")!.textContent = HOST_LEFT_GAME_TEXT;
  over.querySelector("p")!.textContent = "Матч окончен. Новая комната — у того, кто нажмёт «Играть с друзьями».";
  root.append(stale, over);
  return { stale, over };
}

/**
 * Игровой вид поверх драйвера сети: без экрана стихий (её выбрали в лобби), имена над магами, интерфейс матча
 * (matchHud) по onFrame. Меню: «Начать матч» у хоста (в разминке, «Ещё раз» на итогах) и «Скопировать ссылку» у всех.
 */
function startGame(
  root: HTMLElement, arena: ArenaData, ctx: MatchContext, driver: PvpDriver, element: Element, hostBots: BotControl | null = null,
): void {
  const code = driver.roomCode;
  const url = roomLink(location.origin, code);
  let view: GameView | null = null;
  let ui: ReturnType<typeof createOverlay> | null = null;
  let match: MatchHud | null = null;
  let startButton: MenuButton | null = null;
  let shownPhase = "";
  let shownLink: LinkState = "ok";
  let shownElement = element;
  let wasLocked = false;
  /** Кнопки ботов хоста (Р16 фазы 8): видны только в разминке и на итогах. */
  let botButtons: { add: MenuButton; remove: MenuButton; level: MenuButton } | null = null;
  let shownBots = "";
  const host = driver.isHost ? (driver as HostDriver) : null;

  const onFrame = (f: Frame, nowS: number): void => {
    if (!view || !ui) return;
    const g = driver.game();
    if (g.phase !== shownPhase) {
      shownPhase = g.phase;
      startButton?.setVisible(g.phase === "warmup" || g.phase === "results");
      startButton?.setLabel(g.phase === "results" ? "Ещё раз" : "Начать матч");
    }
    if (botButtons && host && hostBots) {
      const open = g.phase === "warmup" || g.phase === "results";
      const canAdd = open && host.canAddBot();
      const canRemove = open && host.botCount() > 0;
      const key = `${open}${canAdd}${canRemove}${hostBots.level}`;
      if (key !== shownBots) {
        shownBots = key;
        botButtons.add.setVisible(canAdd);
        botButtons.remove.setVisible(canRemove);
        botButtons.level.setVisible(open);
        botButtons.level.setLabel(`Боты: ${BOT_LEVEL_NAME[hostBots.level]}`);
      }
    }
    // стихия в меню — как у мага в игре: хост мог отказать (в бою живым нельзя), а смена у игрока идёт через хоста
    const mine = unitById(g.match, driver.localId)?.mage?.element;
    const unlocked = wasLocked && !view.input.locked;
    wasLocked = view.input.locked;
    if (mine && (mine !== shownElement || unlocked)) {
      shownElement = mine;
      view.hud.setElement(mine);
    }
    const state = driver.link();
    if (state !== shownLink) {
      shownLink = state;
      ui.stale.hidden = state !== "stale";
      if (state === "closed") {
        // хост ушёл (Н10): матч окончен, кадры встают, мышь отпускается; интерфейс матча — под окном, без клавиш
        ui.over.hidden = false;
        match?.dispose();
        match = null;
        view.stop();
        driver.dispose();
        return;
      }
    }
    match?.update(f, nowS);
  };

  view = mountGameView({ root, arena, ctx, driver, element, selectOnStart: false, names: () => driver.names(), onFrame });
  // сбой рендера при запуске: сообщение уже в HUD
  if (!view) {
    driver.dispose();
    return;
  }
  // счётчик полигона «Урон · Убийства · Сбросы» (боевой HUD, по предсказанию) в PvP прячется: счёт — в строке сверху и в таблице
  root.classList.add("pvp-game");
  match = createMatchHud(root, driver, view);
  // зайти снова — та же ссылка с тем же запросом (?lag=…): страница заново подключится к хосту
  ui = createOverlay(root, driver.isHost ? null : `/r/${code}${location.search}`);
  const lead = driver.isHost
    ? `Ты хост: комната живёт, пока открыта эта вкладка. Ссылка для друзей: ${url}`
    : `Матч начинает хост. Ссылка для друзей: ${url}`;
  view.hud.setMenuText(`Комната ${code}`, lead);
  if (driver.isHost) startButton = view.hud.addMenuButton("Начать матч", () => driver.start());
  if (host && hostBots) {
    botButtons = {
      add: view.hud.addMenuButton("Добавить бота", () => host.addBot(hostBots.level)),
      remove: view.hud.addMenuButton("Убрать бота", () => host.removeBot()),
      level: view.hud.addMenuButton(`Боты: ${BOT_LEVEL_NAME[hostBots.level]}`, () => {
        hostBots.level = nextLevel(hostBots.level);
        host.setBotLevel(hostBots.level);
      }),
    };
  }
  const copy = view.hud.addMenuButton(COPY_LABEL, () => copyLink(url, copy));
}
