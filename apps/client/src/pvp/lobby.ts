import { ELEMENTS, ELEMENT_INFO, PVP, type Element } from "@doodlemagic/sim";
import { NAME_MAX, cleanName } from "../net/protocol";
import type { JoinError, JoinStatus } from "./clientDriver";
import "./pvp.css";

/** Имя игрока в localStorage. */
export const NAME_KEY = "dm.name";
const FALLBACK_NAME = "Маг";

// ---------------------------------------------------------------- имя: чистые функции
// Занятое в комнате имя делает свободным ядро хоста (hostCore: «Искра», «Искра 2»…) — и для хоста, и для игроков.

/** Имя в поле при заходе: сохранённое (очищенное); его нет или оно пустое — fallback() (defaultName). */
export function initialName(stored: string | null, fallback: () => string): string {
  return cleanName(stored) || cleanName(fallback()) || FALLBACK_NAME;
}

/** Имя при входе: очищенное из поля; поле пустое — то, что стояло в нём по умолчанию. */
export function enteredName(raw: string, fallback: string): string {
  return cleanName(raw) || cleanName(fallback) || FALLBACK_NAME;
}

/** Хранилище имени: localStorage или двойник в тестах. */
export interface NameStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage, если он доступен (приватный режим, запрет cookie — нет). */
function browserStore(): NameStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadName(store: NameStore | null = browserStore()): string | null {
  try {
    return store?.getItem(NAME_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Сохраняет очищенное имя; пустое не сохраняется. */
export function saveName(name: string, store: NameStore | null = browserStore()): void {
  const clean = cleanName(name);
  if (!clean) return;
  try {
    store?.setItem(NAME_KEY, clean);
  } catch {
    // приватный режим: имя просто не запомнится
  }
}

/** «В комнате: Искра 42, Валун 17»; пусто — «В комнате пока никого». */
export function rosterText(names: readonly string[]): string {
  return names.length === 0 ? "В комнате пока никого" : `В комнате: ${names.join(", ")}`;
}

// ---------------------------------------------------------------- тексты связи

export const SIGNALLING_TEXT = "Сервер подключения PeerJS не отвечает, попробуй ещё раз";
export const HOST_LEFT_TEXT = "Хост вышел";

/** Почему игрок не вошёл в комнату code. */
export function joinErrorText(e: JoinError, code: string): string {
  switch (e) {
    case "noHost":
      return `Комната ${code} не найдена: хост закрыл вкладку или код неверный`;
    case "noChannel":
      return "Не удалось соединиться с хостом напрямую. Возможно, нужен TURN-сервер — скажи разработчику";
    case "signalling":
      return SIGNALLING_TEXT;
    case "full":
      return `Комната полна (${PVP.maxPlayers} из ${PVP.maxPlayers})`;
    case "version":
      return "У вас разные версии игры — обновите страницу оба";
  }
}

/** Строка под «Войти» у игрока. */
export function joinStatusText(s: JoinStatus): string {
  switch (s) {
    case "connecting":
      return "Подключаюсь…";
    case "open":
      return "Хост на связи";
    case "joining":
      return "Вхожу…";
  }
}

// ---------------------------------------------------------------- экран

export interface LobbyOptions {
  root: HTMLElement;
  /** Хост: сверху комната, ссылка и состав; игрок: код комнаты в заголовке. */
  host: boolean;
  /** Игрок — код из ссылки; хост — null, пока комната не открыта (setRoom). */
  code: string | null;
  name: string;
  element: Element;
  onEnter(name: string, element: Element): void;
}

export interface Lobby {
  /** Хост: комната открыта — код и ссылка, «Войти» доступна. */
  setRoom(code: string, link: string): void;
  /** Хост: кто уже в комнате. */
  setRoster(names: readonly string[]): void;
  /** Строка под «Войти»: «Подключаюсь…», «Вхожу…»; "" — пусто. */
  setStatus(text: string): void;
  /** «Войти» доступна или нет (хост — пока комната открывается, игрок — после нажатия). */
  setEnterEnabled(on: boolean): void;
  /** Ошибка: «Войти» выключена, под ней — «Попробовать ещё раз» (перезагрузка) и ссылка на полигон. */
  showError(text: string): void;
}

function el<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

/**
 * Лобби комнаты: имя, две карточки стихий и «Войти». У хоста сверху «Комната ABCD», ссылка и «Скопировать ссылку»
 * (буфер обмена; отказал — ссылка выделяется для Ctrl+C), ниже — кто уже в комнате. Текст из данных — только через
 * textContent и value.
 */
export function createLobby(o: LobbyOptions): Lobby {
  const card = (e: Element): string => `<button class="pvp-el" type="button" data-element="${e}" aria-pressed="false">
      <span class="pvp-el-name"></span><span class="pvp-el-motto"></span></button>`;
  o.root.innerHTML = `
    <section class="card pvp-lobby">
      <h1 class="pvp-title"></h1>
      <div class="pvp-room" hidden>
        <div class="pvp-link-row">
          <input class="pvp-link" type="text" readonly aria-label="Ссылка на комнату" />
          <button class="btn secondary pvp-copy" type="button">Скопировать ссылку</button>
        </div>
        <p class="muted small pvp-roster"></p>
      </div>
      <form class="pvp-form">
        <label>Имя <input class="pvp-name" type="text" maxlength="${NAME_MAX}" autocomplete="nickname" spellcheck="false" /></label>
        <span class="pvp-label">Стихия</span>
        <div class="pvp-els">${ELEMENTS.map(card).join("")}</div>
        <button class="btn pvp-enter" type="submit">Войти</button>
        <p class="pvp-status muted" role="status"></p>
        <p class="pvp-error bad" role="alert" hidden></p>
        <div class="actions pvp-retry" hidden>
          <button class="btn secondary pvp-again" type="button">Попробовать ещё раз</button>
          <a class="btn secondary" href="/">На полигон</a>
        </div>
      </form>
    </section>`;

  const title = el(o.root, ".pvp-title");
  const room = el(o.root, ".pvp-room");
  const link = el<HTMLInputElement>(o.root, ".pvp-link");
  const copy = el<HTMLButtonElement>(o.root, ".pvp-copy");
  const roster = el(o.root, ".pvp-roster");
  const form = el<HTMLFormElement>(o.root, ".pvp-form");
  const name = el<HTMLInputElement>(o.root, ".pvp-name");
  const enter = el<HTMLButtonElement>(o.root, ".pvp-enter");
  const status = el(o.root, ".pvp-status");
  const error = el(o.root, ".pvp-error");
  const retry = el(o.root, ".pvp-retry");

  title.textContent = o.host ? "Бой с друзьями" : `Комната ${o.code ?? ""}`;
  name.value = o.name;
  roster.textContent = rosterText([]);

  let element = o.element;
  const cards = Array.from(o.root.querySelectorAll<HTMLButtonElement>(".pvp-el"));
  const syncCards = (): void => {
    for (const b of cards) {
      const on = b.dataset.element === element;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    }
  };
  for (const b of cards) {
    const e: Element = b.dataset.element === "earth" ? "earth" : "fire";
    const info = ELEMENT_INFO[e];
    el(b, ".pvp-el-name").textContent = `${info.name} — ${info.title}`;
    el(b, ".pvp-el-motto").textContent = info.motto;
    b.addEventListener("click", () => {
      element = e;
      syncCards();
    });
  }
  syncCards();

  let failed = false;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (enter.disabled || failed) return;
    const chosen = enteredName(name.value, o.name);
    name.value = chosen;
    o.onEnter(chosen, element);
  });

  copy.addEventListener("click", () => {
    const done = (ok: boolean): void => {
      if (ok) copy.textContent = "Ссылка скопирована";
      else {
        // буфер обмена недоступен: ссылка выделена, Ctrl+C скопирует её
        link.focus();
        link.select();
      }
    };
    if (!navigator.clipboard) {
      done(false);
      return;
    }
    navigator.clipboard.writeText(link.value).then(
      () => done(true),
      () => done(false),
    );
  });
  link.addEventListener("focus", () => link.select());
  el(o.root, ".pvp-again").addEventListener("click", () => location.reload());

  return {
    setRoom(code, url) {
      title.textContent = `Комната ${code}`;
      link.value = url;
      room.hidden = false;
    },
    setRoster(names) {
      roster.textContent = rosterText(names);
    },
    setStatus(text) {
      status.textContent = text;
    },
    setEnterEnabled(on) {
      enter.disabled = !on || failed;
    },
    showError(text) {
      failed = true;
      enter.disabled = true;
      status.textContent = "";
      error.textContent = text;
      error.hidden = false;
      retry.hidden = false;
    },
  };
}
