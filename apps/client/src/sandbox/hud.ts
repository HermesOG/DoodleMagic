import { PRESET_ORDER, PRESETS } from "../render/quality";
import { SENS_MAX, SENS_MIN } from "./controls";
import type { QualityChoice, Settings } from "./settings";

export const HINT = "Клик — захват мыши, WASD — ходить, пробел — прыжок, Esc — меню";

export interface Hud {
  readonly canvas: HTMLCanvasElement;
  setLocked(locked: boolean): void;
  /** Экран «Загрузка…»; с message остаётся на экране и показывает его (сбой запуска). */
  setLoading(loading: boolean, message?: string): void;
  readonly debugVisible: boolean;
  toggleDebug(): void;
  setDebugText(text: string): void;
  onPlay(cb: () => void): void;
  onQuality(cb: (q: QualityChoice) => void): void;
  onSensitivity(cb: (x: number) => void): void;
}

function el<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

export function createHud(root: HTMLElement, settings: Settings): Hud {
  const options = [`<option value="auto">Авто</option>`, ...PRESET_ORDER.map((id) => `<option value="${id}">${PRESETS[id].label}</option>`)];
  root.innerHTML = `
    <canvas class="game-canvas"></canvas>
    <div class="sb-hint"></div>
    <div class="game-corner" hidden></div>
    <div class="sb-menu">
      <section class="sb-card">
        <h1>DoodleMagic · песочница</h1>
        <p class="sb-muted">Галерея над ущельем. Пока здесь можно только ходить и прыгать.</p>
        <button class="btn sb-play" type="button">Играть</button>
        <label>Качество <select class="sb-quality">${options.join("")}</select></label>
        <label>Чувствительность мыши <span class="sb-sens-out"></span>
          <input class="sb-sens" type="range" min="${SENS_MIN}" max="${SENS_MAX}" step="0.1" />
        </label>
        <p class="sb-muted sb-small">Ё (~) — отладка: FPS и пресет. <a href="/nettest">Тест связи</a></p>
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
  el(root, ".sb-hint").textContent = HINT;
  quality.value = settings.quality;
  sens.value = String(settings.sensitivity);
  sensOut.textContent = `×${settings.sensitivity.toFixed(1)}`;

  const playListeners: (() => void)[] = [];
  const play = () => playListeners.forEach((cb) => cb());
  el(root, ".sb-play").addEventListener("click", play);
  // клик мимо карточки меню тоже захватывает мышь
  menu.addEventListener("click", (e) => {
    if (e.target === menu) play();
  });

  return {
    canvas,
    setLocked(locked) {
      menu.hidden = locked;
      root.classList.toggle("sb-locked", locked);
    },
    setLoading(loading, message) {
      loadingEl.hidden = !loading;
      if (message !== undefined) loadingEl.textContent = message;
    },
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
  };
}
