import {
  BOT_LEVELS, BOT_LEVEL_HINT, BOT_LEVEL_NAME, ELEMENTS, ELEMENT_INFO, PVP, scoreLimitFor, type BotLevel, type Element,
} from "@doodlemagic/sim";
import type { Driver } from "../game/driver";
import { loadPrefs, savePrefs } from "../hud/prefs";
import "./bots.css";

/**
 * Выбор режима на «/» (Р14, Р15 фазы 8): «Бой с ботами» или «Полигон», число ботов, сложность и стихии ботов.
 * Настройки — в localStorage (dm.bots); чистые функции — под тесты, панель — DOM над карточками экрана стихий.
 */

export type PlayMode = "bots" | "training";
export interface BotSetup {
  mode: PlayMode;
  /** Ботов в бою, 1–5. */
  count: number;
  level: BotLevel;
  /** «Вперемешку» — разные, пока ботов не больше четырёх; иначе — все одной стихией. */
  elements: "mix" | Element;
}

export const BOT_SETUP_KEY = "dm.bots";
export const BOT_COUNT_MIN = 1;
export const BOT_COUNT_MAX = PVP.maxPlayers - 1;
export const DEFAULT_BOT_SETUP: Readonly<BotSetup> = Object.freeze({ mode: "bots", count: 3, level: "novice", elements: "mix" });

const isLevel = (x: unknown): x is BotLevel => typeof x === "string" && (BOT_LEVELS as readonly string[]).includes(x);
const isElement = (x: unknown): x is Element => typeof x === "string" && (ELEMENTS as readonly string[]).includes(x);
const clampCount = (n: number): number => Math.min(BOT_COUNT_MAX, Math.max(BOT_COUNT_MIN, Math.round(n)));

/** Разбор dm.bots: мусор — по умолчанию, поле с ошибкой — его значение по умолчанию, число — в пределы 1–5. */
export function parseBotSetup(raw: string | null): BotSetup {
  let v: unknown = null;
  try {
    v = raw === null ? null : JSON.parse(raw);
  } catch {
    v = null;
  }
  const d = DEFAULT_BOT_SETUP;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { ...d };
  const o = v as Record<string, unknown>;
  return {
    mode: o.mode === "training" || o.mode === "bots" ? o.mode : d.mode,
    count: typeof o.count === "number" && Number.isFinite(o.count) ? clampCount(o.count) : d.count,
    level: isLevel(o.level) ? o.level : d.level,
    elements: o.elements === "mix" || isElement(o.elements) ? o.elements : d.elements,
  };
}

/** Хранилище: localStorage или двойник в тестах. */
export interface SetupStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function browserStore(): SetupStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadBotSetup(store: SetupStore | null = browserStore()): BotSetup {
  try {
    return parseBotSetup(store?.getItem(BOT_SETUP_KEY) ?? null);
  } catch {
    return { ...DEFAULT_BOT_SETUP };
  }
}

export function saveBotSetup(s: BotSetup, store: SetupStore | null = browserStore()): void {
  try {
    store?.setItem(BOT_SETUP_KEY, JSON.stringify(s));
  } catch {
    // приватный режим: выбор просто не запомнится
  }
}

export const sameSetup = (a: Readonly<BotSetup>, b: Readonly<BotSetup>): boolean =>
  a.mode === b.mode && a.count === b.count && a.level === b.level && a.elements === b.elements;

/** Режим ссылкой: /?mode=training, /?mode=bots и путь /bots. Нет — сохранённый. */
export function modeFromUrl(pathname: string, search: string): PlayMode | null {
  const q = new URLSearchParams(search).get("mode");
  if (q === "training" || q === "bots") return q;
  return pathname === "/bots" || pathname.startsWith("/bots/") ? "bots" : null;
}

/** Стихии ботов: одна выбранная — у всех; вперемешку — разные, пока ботов ≤ 4, пятый — любой. rand — [0, 1). */
export function botElements(s: Readonly<BotSetup>, rand: () => number): Element[] {
  if (s.elements !== "mix") return Array.from({ length: s.count }, () => s.elements as Element);
  const pool = [...ELEMENTS];
  // тасование Фишера — Йетса
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return Array.from({ length: s.count }, (_, k) => (k < pool.length ? pool[k]! : pool[Math.floor(rand() * pool.length)]!));
}

/** Правила боя мелко: «Каждый за себя · 7 минут или до 12 очков» — лимит по числу магов (с игроком). */
export function rulesLine(count: number): string {
  return `Каждый за себя · ${Math.round(PVP.matchS / 60)} минут или до ${scoreLimitFor(count + 1)} очков`;
}

/** Вводная строка меню боя: «Ты и 3 бота · Ученик». */
export function botsLead(s: Readonly<BotSetup>): string {
  const n = s.count;
  const word = n === 1 ? "бот" : n < 5 ? "бота" : "ботов";
  return `Ты и ${n} ${word} · ${BOT_LEVEL_NAME[s.level]} · ${rulesLine(n)}`;
}

// ---------------------------------------------------------------- панель

/**
 * Панель режима над карточками «Выбери стихию»: вкладки «Бой с ботами» · «Полигон» и ссылка «С друзьями →»; у ботов —
 * «Ботов: − 3 +», «Ученик · Маг · Архимаг» с фразой под выбранной, стихии ботов и правила мелко. Каждое изменение —
 * onChange (страница сохраняет и решает, перезагружаться ли при выборе стихии).
 */
export function createModePanel(initial: Readonly<BotSetup>, onChange: (s: BotSetup) => void): HTMLElement {
  let s: BotSetup = { ...initial };
  const panel = document.createElement("div");
  panel.className = "bm";
  const levelBtns = BOT_LEVELS.map((l) => `<button class="bm-chip" type="button" data-level="${l}">${BOT_LEVEL_NAME[l]}</button>`).join("");
  const elementBtns = [`<button class="bm-chip" type="button" data-el="mix">вперемешку</button>`]
    .concat(ELEMENTS.map((e) => `<button class="bm-chip" type="button" data-el="${e}">${ELEMENT_INFO[e].name}</button>`))
    .join("");
  panel.innerHTML = `
    <div class="bm-tabs" role="tablist">
      <button class="bm-tab" type="button" role="tab" data-mode="bots">Бой с ботами</button>
      <button class="bm-tab" type="button" role="tab" data-mode="training">Полигон</button>
      <a class="bm-friends" href="/play">С друзьями →</a>
    </div>
    <div class="bm-bots">
      <div class="bm-row">
        <span class="bm-label">Ботов:</span>
        <button class="bm-step" type="button" data-step="-1" aria-label="Меньше ботов">−</button>
        <span class="bm-count" aria-live="polite"></span>
        <button class="bm-step" type="button" data-step="1" aria-label="Больше ботов">+</button>
        <span class="bm-gap"></span>
        ${levelBtns}
      </div>
      <p class="bm-hint"></p>
      <div class="bm-row bm-els"><span class="bm-label">Стихии ботов:</span>${elementBtns}</div>
      <p class="bm-rules"></p>
    </div>`;
  const q = <T extends HTMLElement>(sel: string): T => panel.querySelector<T>(sel)!;
  const render = (): void => {
    for (const b of panel.querySelectorAll<HTMLButtonElement>(".bm-tab")) {
      const on = b.dataset.mode === s.mode;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    }
    q(".bm-bots").hidden = s.mode !== "bots";
    q(".bm-count").textContent = String(s.count);
    for (const b of panel.querySelectorAll<HTMLButtonElement>(".bm-step")) {
      b.disabled = Number(b.dataset.step) < 0 ? s.count <= BOT_COUNT_MIN : s.count >= BOT_COUNT_MAX;
    }
    for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-level]")) b.classList.toggle("is-on", b.dataset.level === s.level);
    for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-el]")) b.classList.toggle("is-on", b.dataset.el === s.elements);
    q(".bm-hint").textContent = BOT_LEVEL_HINT[s.level];
    q(".bm-rules").textContent = rulesLine(s.count);
  };
  const change = (next: BotSetup): void => {
    s = next;
    render();
    onChange({ ...s });
  };
  panel.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    const d = b.dataset;
    if (d.mode === "bots" || d.mode === "training") change({ ...s, mode: d.mode });
    else if (d.step) change({ ...s, count: clampCount(s.count + Number(d.step)) });
    else if (isLevel(d.level)) change({ ...s, level: d.level });
    else if (d.el === "mix" || isElement(d.el)) change({ ...s, elements: d.el });
  });
  render();
  return panel;
}

/**
 * Панель режима для экрана стихий и сторож выбора (Р15): на панели другой режим или другие настройки — выбор стихии
 * сохраняет их вместе со стихией и открывает «/» заново (там — нужный режим и снова экран стихий). Иначе выбор идёт
 * драйверу как обычно.
 */
export function createModeSelect(current: Readonly<BotSetup>): { panel: HTMLElement; guard(d: Driver): void } {
  let shown: BotSetup = { ...current };
  const panel = createModePanel(current, (s) => {
    shown = s;
  });
  return {
    panel,
    guard(d) {
      const inner = d.chooseElement.bind(d);
      d.chooseElement = (e) => {
        if (sameSetup(shown, current)) return inner(e);
        saveBotSetup(shown);
        savePrefs({ ...loadPrefs(), element: e });
        location.assign("/");
        return null;
      };
    },
  };
}
