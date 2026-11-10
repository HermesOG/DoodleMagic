import { buildGallery } from "@doodlemagic/arena";
import { pvpContext } from "@doodlemagic/sim";
import { mountGameView } from "../game/view";
import { loadPrefs } from "../hud/prefs";
import { cleanName } from "../net/protocol";
import { loadName } from "../pvp/lobby";
import { createMatchHud, type MatchHud } from "../pvp/matchHud";
import type { MenuButton } from "../sandbox/hud";
import { createLocalHost } from "./localHost";
import { botElements, botsLead, createModeSelect, saveBotSetup, type BotSetup } from "./setup";

const OWN_NAME = "Ты";

/**
 * «Бой с ботами» на «/» (Р14, Р15 фазы 8): «Галерея» с точками появления (pvpContext), правила «Свалки», свой маг и
 * setup.count ботов. Ядро хоста без сети (createLocalHost), общий игровой вид и интерфейс матча PvP. Бой стоит, пока
 * мышь свободна (меню, экран стихий); первое «Играть» в разминке начинает отсчёт 3-2-1.
 */
export function mountBots(root: HTMLElement, setup: BotSetup): void {
  const arena = buildGallery("full");
  const ctx = pvpContext(arena);
  const element = loadPrefs().element;
  const host = createLocalHost(ctx, { seed: Math.floor(Math.random() * 2 ** 31) });
  host.enter(cleanName(loadName()) || OWN_NAME, element);
  for (const e of botElements(setup, Math.random)) host.addBot(e, setup.level);
  host.setPaused(true);
  const select = createModeSelect(setup);
  select.guard(host);

  let match: MatchHud | null = null;
  let shownPhase = "";
  let again: MenuButton | null = null;
  const view = mountGameView({
    root,
    arena,
    ctx,
    driver: host,
    element,
    selectOnStart: true,
    names: () => host.names(),
    selectTop: () => select.panel,
    onFrame(f, nowS) {
      const phase = host.game().phase;
      if (phase !== shownPhase) {
        shownPhase = phase;
        again?.setVisible(phase === "results");
      }
      match?.update(f, nowS);
    },
  });
  // сбой рендера при запуске: сообщение уже в HUD
  if (!view) return;
  // счётчик полигона прячется: счёт — в строке сверху и в таблице, как в PvP
  root.classList.add("pvp-game");
  match = createMatchHud(root, host, view);
  view.input.onLockChange((locked) => {
    host.setPaused(!locked);
    if (locked && host.game().phase === "warmup") host.start();
  });
  view.hud.setMenuText("DoodleMagic · бой с ботами", botsLead(setup));
  again = view.hud.addMenuButton("Ещё раз", () => host.start());
  again.setVisible(false);
  view.hud.addMenuButton("Начать заново", () => location.reload());
  view.hud.addMenuButton("На полигон", () => {
    saveBotSetup({ ...setup, mode: "training" });
    location.assign("/");
  });
  view.hud.addMenuButton("С друзьями", () => location.assign("/play"));
}
