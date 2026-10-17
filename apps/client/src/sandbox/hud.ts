import { ABILITY_NAME, ABILITY_OF, ELEMENT_INFO, type Element } from "@doodlemagic/sim";
import { PRESET_ORDER, PRESETS } from "../render/quality";
import { SENS_MAX, SENS_MIN } from "./controls";
import type { QualityChoice, Settings } from "./settings";

export const MENU_TITLE = "DoodleMagic · полигон";
export const MENU_LEAD = "Галерея над ущельем. Шесть манекенов ждут — попробуй каждую способность.";
export const HINT = "ЛКМ — атака · Q E C — приёмы · пробел — прыжок · Esc — меню";
/** Chrome не даёт захватить мышь около секунды после выхода по Esc. */
export const LOCK_REFUSED_HINT = "Подождите секунду и кликните ещё раз";
export const CONTEXT_LOST_MESSAGE = "Видеокарта сбросила контекст — перезагрузите страницу";

/** Строка подсказки управления в меню: клавиша и что она делает; soon — ещё не сделано (ульта). */
export interface ControlRow {
  key: string;
  action: string;
  soon: boolean;
}

/** Управление для стихии: четыре способности по клавишам, ульта «скоро», ходьба, прыжок, меню. */
export function controlRows(element: Element): ControlRow[] {
  const a = ABILITY_OF[element];
  const row = (key: string, action: string, soon = false): ControlRow => ({ key, action, soon });
  return [
    row("ЛКМ", ABILITY_NAME[a.primary]),
    row("Q", ABILITY_NAME[a.q]),
    row("E", ABILITY_NAME[a.e]),
    row("C", ABILITY_NAME[a.c]),
    row("X", ELEMENT_INFO[element].ult, true),
    row("WASD", "ходить"),
    row("Пробел", "прыжок"),
    row("Esc", "меню"),
  ];
}

export interface Hud {
  readonly canvas: HTMLCanvasElement;
  setLocked(locked: boolean): void;
  /** Открыт экран «Выбери стихию»: меню паузы под ним прячется, чтобы не просвечивало. */
  setSelecting(on: boolean): void;
  /** Подсказка под «Играть»: браузер отказал в захвате мыши. Скрывается сама при захвате. */
  showLockRefused(): void;
  /** Экран «Загрузка…»; с message остаётся на экране и показывает его (сбой запуска или игры). */
  setLoading(loading: boolean, message?: string): void;
  /** Текущая стихия: название в меню и подсказка управления. */
  setElement(e: Element): void;
  readonly debugVisible: boolean;
  toggleDebug(): void;
  setDebugText(text: string): void;
  onPlay(cb: () => void): void;
  /** «Сменить стихию» — открыть экран выбора. */
  onChangeElement(cb: () => void): void;
  onQuality(cb: (q: QualityChoice) => void): void;
  onSensitivity(cb: (x: number) => void): void;
  onRawMouse(cb: (raw: boolean) => void): void;
  /** Ползунок «Движение камеры» 0…1 (GDD 5: доступность). */
  onCameraMotion(cb: (x: number) => void): void;
}

function el<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

const percent = (x: number): string => `${Math.round(x * 100)} %`;

export function createHud(root: HTMLElement, settings: Settings, start: { element: Element; cameraMotion: number }): Hud {
  const options = [`<option value="auto">Авто</option>`, ...PRESET_ORDER.map((id) => `<option value="${id}">${PRESETS[id].label}</option>`)];
  root.innerHTML = `
    <canvas class="game-canvas"></canvas>
    <div class="sb-hint"></div>
    <div class="game-corner" hidden></div>
    <div class="sb-menu" hidden>
      <section class="sb-card">
        <h1></h1>
        <p class="sb-muted sb-lead"></p>
        <div class="sb-element">
          <span class="sb-element-label">Стихия</span>
          <span class="sb-element-name"></span>
          <button class="btn secondary sb-change" type="button">Сменить стихию</button>
        </div>
        <button class="btn sb-play" type="button">Играть</button>
        <p class="sb-lock-hint" role="status" hidden></p>
        <p class="sb-muted sb-small sb-how">Клик по «Играть» захватывает мышь — и можно колдовать. Esc — снова меню.</p>
        <ul class="sb-controls" aria-label="Управление"></ul>
        <label>Качество <select class="sb-quality">${options.join("")}</select></label>
        <label>Чувствительность мыши <span class="sb-sens-out"></span>
          <input class="sb-sens" type="range" min="${SENS_MIN}" max="${SENS_MAX}" step="0.1" />
        </label>
        <label>Движение камеры <span class="sb-motion-out"></span>
          <input class="sb-motion" type="range" min="0" max="1" step="0.1" />
        </label>
        <label class="sb-check"><input class="sb-raw" type="checkbox" /> Сырой ввод мыши (без ускорения ОС)</label>
        <p class="sb-muted sb-small">Ё (~) — отладка: FPS и пресет. <a href="/nettest">Тест связи</a>
          <a class="sb-host-link" href="/nettest?host=1">Тест связи — создать комнату</a></p>
      </section>
    </div>
    <div class="game-loading">Загрузка…</div>`;

  const canvas = el<HTMLCanvasElement>(root, ".game-canvas");
  const corner = el(root, ".game-corner");
  const menu = el(root, ".sb-menu");
  const loadingEl = el(root, ".game-loading");
  const quality = el<HTMLSelectElement>(root, ".sb-quality");
  const sens = el<HTMLInputElement>(root, ".sb-sens");
  const sensOut = el(root, ".sb-sens-out");
  const motion = el<HTMLInputElement>(root, ".sb-motion");
  const motionOut = el(root, ".sb-motion-out");
  const raw = el<HTMLInputElement>(root, ".sb-raw");
  const lockHint = el(root, ".sb-lock-hint");
  const elementName = el(root, ".sb-element-name");
  const controls = el(root, ".sb-controls");
  el(root, ".sb-card h1").textContent = MENU_TITLE;
  el(root, ".sb-lead").textContent = MENU_LEAD;
  lockHint.textContent = LOCK_REFUSED_HINT;
  raw.checked = settings.rawMouse;
  el(root, ".sb-hint").textContent = HINT;
  quality.value = settings.quality;
  sens.value = String(settings.sensitivity);
  sensOut.textContent = `×${settings.sensitivity.toFixed(1)}`;
  motion.value = String(start.cameraMotion);
  motionOut.textContent = percent(start.cameraMotion);

  let locked = false;
  let selecting = false;
  const syncMenu = (): void => {
    menu.hidden = locked || selecting;
  };

  const setElement = (e: Element): void => {
    const info = ELEMENT_INFO[e];
    elementName.textContent = `${info.name} — ${info.title}`;
    elementName.dataset.element = e;
    // текст — только через textContent: названия из таблиц, но разметку из данных не собираем
    controls.replaceChildren(
      ...controlRows(e).map((r) => {
        const li = document.createElement("li");
        const kbd = document.createElement("kbd");
        kbd.textContent = r.key;
        const action = document.createElement("span");
        action.textContent = r.action;
        li.append(kbd, action);
        if (r.soon) {
          li.classList.add("is-soon");
          const soon = document.createElement("em");
          soon.textContent = "скоро";
          li.append(soon);
        }
        return li;
      }),
    );
  };
  setElement(start.element);

  const playListeners: (() => void)[] = [];
  const play = () => playListeners.forEach((cb) => cb());
  el(root, ".sb-play").addEventListener("click", play);
  // клик мимо карточки меню тоже захватывает мышь
  menu.addEventListener("click", (e) => {
    if (e.target === menu) play();
  });

  return {
    canvas,
    setLocked(on) {
      locked = on;
      syncMenu();
      if (on) lockHint.hidden = true;
      root.classList.toggle("sb-locked", on);
    },
    setSelecting(on) {
      selecting = on;
      syncMenu();
    },
    showLockRefused() {
      lockHint.hidden = false;
    },
    setLoading(loading, message) {
      loadingEl.hidden = !loading;
      if (message !== undefined) loadingEl.textContent = message;
    },
    setElement,
    get debugVisible() {
      return !corner.hidden;
    },
    toggleDebug() {
      corner.hidden = !corner.hidden;
    },
    setDebugText(text) {
      corner.textContent = text;
    },
    onPlay(cb) {
      playListeners.push(cb);
    },
    onChangeElement(cb) {
      el(root, ".sb-change").addEventListener("click", () => cb());
    },
    onQuality(cb) {
      quality.addEventListener("change", () => cb(quality.value as QualityChoice));
    },
    onSensitivity(cb) {
      sens.addEventListener("input", () => {
        const x = Number(sens.value);
        sensOut.textContent = `×${x.toFixed(1)}`;
        cb(x);
      });
    },
    onRawMouse(cb) {
      raw.addEventListener("change", () => cb(raw.checked));
    },
    onCameraMotion(cb) {
      motion.addEventListener("input", () => {
        const x = Math.min(1, Math.max(0, Number(motion.value)));
        motionOut.textContent = percent(x);
        cb(x);
      });
    },
  };
}
