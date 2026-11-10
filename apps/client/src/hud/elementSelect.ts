import { ELEMENTS, ELEMENT_INFO, type Element } from "@doodlemagic/sim";
import "./combatHud.css";
import "./elementSelect.css";
import { glyphSvg } from "./glyphs";

/** Скорость с запятой и одним знаком: 6,5 м/с, 6,0 м/с. */
const speed = (v: number): string => v.toFixed(1).replace(".", ",");
/** Цифры 1–4 по порядку ELEMENTS — по event.code: и в верхнем ряду, и на цифровом блоке, на любой раскладке. */
const KEY_OF: Readonly<Record<string, Element>> = Object.fromEntries(
  ELEMENTS.flatMap((e, k) => [[`Digit${k + 1}`, e], [`Numpad${k + 1}`, e]] as const),
);

/**
 * Экран «Выбери стихию» (GDD 4.1, 9): четыре карточки из ELEMENT_INFO с печатью стихии (знак и цвет), initial
 * подсвечена и в фокусе (Enter или пробел выбирают её). 1–4 или клик — выбор; через autoS секунд подтверждается
 * подсвеченная (byClick: false). byClick: true — выбрал сам игрок кликом или клавишей: это жест пользователя, и в его
 * обработчике странице можно сразу захватить мышь и включить звук (keydown в Chrome — такой же жест, как клик). Выбор
 * по таймеру — не жест: после него нужен клик «Играть».
 * top — узел над заголовком (панель режима на «/», фаза 8): клик или фокус в нём останавливает таймер выбора.
 */
export function showElementSelect(
  root: HTMLElement, initial: Element, autoS = 10, top: HTMLElement | null = null,
): Promise<{ element: Element; byClick: boolean }> {
  const auto = Number.isFinite(autoS) && autoS > 0 ? autoS : 0;
  const card = (e: Element, n: number): string => {
    const i = ELEMENT_INFO[e];
    return `<button class="es-card${e === initial ? " is-on" : ""}" type="button" data-element="${e}" aria-pressed="${e === initial}">
      <span class="es-num" aria-hidden="true">${n}</span>
      <span class="es-head"><span class="ch-seal es-seal" data-element="${e}" aria-hidden="true">${glyphSvg(e)}</span><span class="es-name">${i.name} — ${i.title}</span></span>
      <span class="es-motto">${i.motto}</span>
      <span class="es-meta">${i.stars} · ${i.hp} HP · ${speed(i.runSpeed)} м/с</span>
      <span class="es-timer" aria-hidden="true"></span>
    </button>`;
  };
  const screen = document.createElement("div");
  screen.className = "es";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-label", "Выбери стихию");
  if (auto) screen.style.setProperty("--es-auto", `${auto}s`);
  const hint = auto ? `1–4 или клик · через ${Number(auto.toFixed(1))} с — выбранная` : "1–4 или клик";
  screen.innerHTML = `<section class="es-panel">
    <h1 class="es-title">Выбери стихию</h1>
    <div class="es-cards">${ELEMENTS.map((e, k) => card(e, k + 1)).join("")}</div>
    <p class="es-hint">${hint}</p>
  </section>`;
  if (top) screen.querySelector(".es-panel")!.prepend(top);
  root.append(screen);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // игрок настраивает режим: подсвеченная карточка сама не выбирается
    const hold = (): void => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      screen.classList.add("es-held");
      screen.querySelector(".es-hint")!.textContent = "1–4 или клик";
    };
    top?.addEventListener("pointerdown", hold);
    top?.addEventListener("focusin", hold);
    const done = (element: Element, byClick: boolean): void => {
      if (timer !== undefined) clearTimeout(timer);
      top?.removeEventListener("pointerdown", hold);
      top?.removeEventListener("focusin", hold);
      window.removeEventListener("keydown", onKey);
      screen.remove();
      resolve({ element, byClick });
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const element = KEY_OF[e.code];
      if (!element) return;
      e.preventDefault();
      done(element, true);
    };
    // Enter и пробел на кнопке в фокусе приходят сюда же как click
    for (const b of screen.querySelectorAll<HTMLButtonElement>(".es-card")) {
      b.addEventListener("click", () => done(ELEMENTS.find((e) => e === b.dataset.element) ?? initial, true));
    }
    screen.querySelector<HTMLButtonElement>(".es-card.is-on")?.focus({ preventScroll: true });
    window.addEventListener("keydown", onKey);
    if (auto) timer = setTimeout(() => done(initial, false), auto * 1000);
  });
}
