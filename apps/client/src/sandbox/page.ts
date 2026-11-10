import { TRAINING, buildGallery } from "@doodlemagic/arena";
import { createMatch, matchContext } from "@doodlemagic/sim";
import { mountGameView } from "../game/view";
import { loadPrefs } from "../hud/prefs";
import { createSoloDriver } from "./soloDriver";

/** Маг игрока в матче полигона: createMatch даёт магам id с 1, манекены идут следом. */
const LOCAL = 1;

/**
 * Полигон на «/»: «Галерея над ущельем», маг игрока (Огонь или Земля) и шесть манекенов (TRAINING). Матч крутит
 * драйвер одиночной игры (stepMatch с тиком 60 Гц), всё остальное — общий игровой вид; после загрузки — экран
 * «Выбери стихию». В меню — «Играть с друзьями»: комната PvP на /play.
 */
export function mountSandbox(root: HTMLElement): void {
  const element = loadPrefs().element;
  const variant = new URLSearchParams(location.search).get("arena") === "compact" ? "compact" : "full";
  const arena = buildGallery(variant);
  // заряд ульты на полигоне копится ×10 (Р12 фазы 5): иначе ульту не проверить за минуту; маг там не ранится —
  // сферу берёт и полный (фаза 6), иначе её подбор не увидеть
  const ctx = { ...matchContext(arena), ultChargeMul: 10, orbsAtFullHp: true };
  const match = createMatch({ mages: [{ element, spawn: TRAINING.spawn }], dummies: [...TRAINING.dummies] });
  const driver = createSoloDriver(ctx, match, LOCAL);
  const view = mountGameView({ root, arena, ctx, driver, element, selectOnStart: true });
  // сбой рендера при запуске: сообщение уже в HUD
  if (!view) {
    driver.dispose();
    return;
  }
  view.hud.addMenuButton("Играть с друзьями", () => location.assign("/play"));
}
