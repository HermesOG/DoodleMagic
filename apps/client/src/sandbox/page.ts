import { TRAINING, buildSedlovina } from "@doodlemagic/arena";
import { createMatch, matchContext } from "@doodlemagic/sim";
import { mountBots } from "../bots/page";
import { createModeSelect, loadBotSetup, modeFromUrl, saveBotSetup } from "../bots/setup";
import { mountGameView } from "../game/view";
import { loadPrefs } from "../hud/prefs";
import { createSoloDriver } from "./soloDriver";

/** Маг игрока в матче полигона: createMatch даёт магам id с 1, манекены идут следом. */
const LOCAL = 1;

/**
 * «/»: режим из настроек (фаза 8, Р15) — «Бой с ботами» (bots/page) или полигон; ссылка ?mode=… или путь /bots
 * выбирает его так же. Полигон: «Седловина» (?arena=compact — компакт), маг игрока и шесть манекенов (TRAINING). Матч крутит драйвер
 * одиночной игры (stepMatch с тиком 60 Гц), всё остальное — общий игровой вид; после загрузки — экран «Выбери
 * стихию» с панелью режима. В меню — «Бой с ботами» и «Играть с друзьями» (комната PvP на /play).
 */
export function mountSandbox(root: HTMLElement): void {
  let setup = loadBotSetup();
  const linked = modeFromUrl(location.pathname, location.search);
  if (linked && linked !== setup.mode) {
    setup = { ...setup, mode: linked };
    saveBotSetup(setup);
  }
  if (setup.mode === "bots") {
    mountBots(root, setup);
    return;
  }
  const element = loadPrefs().element;
  const variant = new URLSearchParams(location.search).get("arena") === "compact" ? "compact" : "full";
  const arena = buildSedlovina(variant);
  // заряд ульты на полигоне копится ×10 (Р12 фазы 5): иначе ульту не проверить за минуту; маг там не ранится —
  // сферу берёт и полный (фаза 6), иначе её подбор не увидеть
  const ctx = { ...matchContext(arena), ultChargeMul: 10, orbsAtFullHp: true };
  const match = createMatch({ mages: [{ element, spawn: TRAINING.spawn }], dummies: [...TRAINING.dummies] });
  const driver = createSoloDriver(ctx, match, LOCAL);
  const select = createModeSelect(setup);
  select.guard(driver);
  const view = mountGameView({ root, arena, ctx, driver, element, selectOnStart: true, selectTop: () => select.panel });
  // сбой рендера при запуске: сообщение уже в HUD
  if (!view) {
    driver.dispose();
    return;
  }
  const training = setup;
  view.hud.addMenuButton("Бой с ботами", () => {
    saveBotSetup({ ...training, mode: "bots" });
    location.assign("/");
  });
  view.hud.addMenuButton("Играть с друзьями", () => location.assign("/play"));
}
