import { ELEMENTS, ELEMENT_INFO, type Element } from "@doodlemagic/sim";
import "./combatHud.css";

/** Скорость с запятой и одним знаком: 6,5 м/с, 6,0 м/с. */
const speed = (v: number): string => v.toFixed(1).replace(".", ",");
/** Цифры 1 и 2 — по event.code: и в верхнем ряду, и на цифровом блоке, на любой раскладке. */
const KEY_OF: Readonly<Record<string, Element>> = { Digit1: "fire", Numpad1: "fire", Digit2: "earth", Numpad2: "earth" };

/**
 * Экран «Выбери стихию» (GDD 4.1, 9): две карточки из ELEMENT_INFO, initial подсвечена и в фокусе (Enter или
 * пробел выбирают её). 1 / 2 или клик — выбор; через autoS секунд подтверждается подсвеченная (byClick: false).
 * byClick: true — выбрал сам игрок кликом или клавишей: это жест пользователя, и в его обработчике странице
 * можно сразу захватить мышь и включить звук (keydown в Chrome — такой же жест, как клик). Выбор по таймеру —
 * не жест: после него нужен клик «Играть».
 */
export function showElementSelect(root: HTMLElement, initial: Element, autoS = 10): Promise<{ element: Element; byClick: boolean }> {
  const auto = Number.isFinite(autoS) && autoS > 0 ? autoS : 0;
  const card = (e: Element, n: number): string => {
    const i = ELEMENT_INFO[e];
    return `<button class="es-card${e === initial ? " is-on" : ""}" type="button" data-element="${e}" aria-pressed="${e === initial}">
      <span class="es-num" aria-hidden="true">${n}</span>
      <span class="es-name">${i.name} — ${i.title}</span>
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
  const hint = auto ? `1 / 2 или клик · через ${Number(auto.toFixed(1))} с — выбранная` : "1 / 2 или клик";
  screen.innerHTML = `<section class="es-panel">
    <h1 class="es-title">Выбери стихию</h1>
    <div class="es-cards">${ELEMENTS.map((e, k) => card(e, k + 1)).join("")}</div>
    <p class="es-hint">${hint}</p>
  </section>`;
  root.append(screen);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (element: Element, byClick: boolean): void => {
      if (timer !== undefined) clearTimeout(timer);
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
      b.addEventListener("click", () => done(b.dataset.element === "earth" ? "earth" : "fire", true));
    }
    screen.querySelector<HTMLButtonElement>(".es-card.is-on")?.focus({ preventScroll: true });
    window.addEventListener("keydown", onKey);
    if (auto) timer = setTimeout(() => done(initial, false), auto * 1000);
  });
}
