import { ELEMENT_INFO, PVP, TICK_HZ, statusFlags, unitById, type Element, type GameState, type UnitId } from "@doodlemagic/sim";
import type { Frame } from "../game/driver";
import type { GameView } from "../game/view";
import type { SoundId } from "../feel/effects";
import {
  ELEMENT_KEYS, boardTitle, countdownDigit, deathLine, feedLine, matchPointText, resultsHint, resultsTitle, respawnLine, scoreRows, stepArc,
  streakFeedLines, topParts, withKnownNames, createArc,
  type ScoreRow,
} from "./format";
import type { PvpDriver } from "./hostDriver";
import "./pvp.css";

export interface MatchHud {
  update(f: Frame, nowS: number): void;
  dispose(): void;
}

/** Килфид: строк не больше, живёт строка столько секунд, последние FEED_FADE_S гаснет. */
const FEED_LINES = 5;
const FEED_S = 6;
const FEED_FADE_S = 0.5;
/** Таблица (Tab, итоги) пересобирается не чаще: пинги меняются раз в секунду, счёт — по снапшотам. */
const BOARD_EVERY_S = 0.25;
const COLUMNS = ["№", "Маг", "Стихия", "Очки", "Убийства", "Сбросы", "Смерти", "Пинг"] as const;
const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** Пишет в DOM, только когда значение изменилось: интерфейс обновляется каждый кадр, а меняется редко. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}
function div(className: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

interface Table {
  el: HTMLTableElement;
  rows: { tr: HTMLTableRowElement; cells: HTMLTableCellElement[] }[];
}
/** Таблица магов: шапка и PVP.maxPlayers строк, лишние скрыты. */
function createTable(): Table {
  const el = document.createElement("table");
  el.className = "mh-table";
  const head = el.createTHead().insertRow();
  for (const c of COLUMNS) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = c;
    head.append(th);
  }
  const body = el.createTBody();
  const rows = Array.from({ length: PVP.maxPlayers }, () => {
    const tr = body.insertRow();
    tr.hidden = true;
    return { tr, cells: COLUMNS.map(() => tr.insertCell()) };
  });
  return { el, rows };
}
/** Строки — в ячейки; текст только через textContent: имена набирают игроки. */
function fillTable(t: Table, rows: readonly ScoreRow[]): void {
  for (let k = 0; k < t.rows.length; k++) {
    const { tr, cells } = t.rows[k]!;
    const r = rows[k];
    setHidden(tr, !r);
    if (!r) continue;
    tr.classList.toggle("is-mine", r.mine);
    const el = cells[2]!;
    const element = r.element ?? "";
    if (el.dataset.element !== element) el.dataset.element = element;
    const values = [String(r.place), r.name, r.element ? ELEMENT_INFO[r.element].name : "—", String(r.score), String(r.kills), String(r.falls), String(r.deaths), r.ping];
    for (let i = 0; i < values.length; i++) setText(cells[i]!, values[i]!);
  }
}

interface FeedItem {
  text: string;
  mine: boolean;
  /** Печать «×N» у строки мульти; "" — без печати. */
  stamp: string;
  at: number;
}

/**
 * Интерфейс матча поверх игрового вида (pointer-events: none): строка сверху, отсчёт, килфид, экран смерти с выбором
 * стихии, таблица по Tab, итоги, «Защита» у прицела. Источники (Н5): счёт, фаза, итоги, килфид и смерть — только из
 * подтверждённого хостом (confirmedGame, Frame.confirmed); часы, отсчёт и защита — от «сейчас» драйвера (game), чтобы
 * у игрока тикали плавно между снапшотами. Строка сверху и отсчёт видны всегда, остальное — пока мышь захвачена (как
 * боевой HUD); меню — поверх. Клавиши — по event.code, с Ctrl, Alt и Cmd ни на что не назначены.
 */
export function createMatchHud(root: HTMLElement, driver: PvpDriver, view: GameView): MatchHud {
  const hud = div("mh");
  const top = div("pvp-top");
  // строка сверху: часы (краснеют в последнюю минуту), остальное и печать матч-пойнта (T7)
  const topClock = document.createElement("span");
  topClock.className = "pvp-clock";
  const topRest = document.createElement("span");
  const topMatchPoint = document.createElement("span");
  topMatchPoint.className = "pvp-mp";
  topMatchPoint.hidden = true;
  top.append(topClock, topRest, topMatchPoint);
  const count = div("mh-count");
  count.hidden = true;
  // всё, что видно только в игре (мышь захвачена)
  const play = div("mh-play");
  play.hidden = true;
  const shield = div("mh-shield");
  shield.textContent = "Защита";
  shield.hidden = true;
  const feedBox = div("mh-feed");
  const feedEls = Array.from({ length: FEED_LINES }, () => {
    const d = div("mh-feed-line");
    d.hidden = true;
    feedBox.append(d);
    return d;
  });
  // строка килфида — текст и печать «×N» (серии, Р5): текст по-прежнему только через textContent
  const feedParts = feedEls.map((d) => {
    const text = document.createElement("span");
    const seal = document.createElement("span");
    seal.className = "mh-feed-stamp";
    seal.hidden = true;
    d.append(text, seal);
    return { text, seal };
  });
  /** Последняя записанная прозрачность строки килфида ("" — без угасания). */
  const feedOpacity = feedEls.map(() => "");
  const death = div("mh-death");
  death.hidden = true;
  const cause = div("mh-death-cause");
  const respawn = div("mh-death-respawn");
  const choice = div("mh-death-els");
  const chips = ELEMENT_KEYS.map((k, i) => {
    if (i > 0) {
      const dot = document.createElement("span");
      dot.className = "mh-sep";
      dot.textContent = "·";
      choice.append(dot);
    }
    const s = document.createElement("span");
    s.className = "mh-chip";
    s.dataset.element = k.element;
    s.textContent = k.label;
    choice.append(s);
    return { el: s, element: k.element };
  });
  death.append(cause, respawn, choice);
  const board = div("mh-board");
  board.hidden = true;
  const boardCard = div("mh-card");
  const boardHead = div("mh-board-title");
  const boardTable = createTable();
  boardCard.append(boardHead, boardTable.el);
  board.append(boardCard);
  const results = div("mh-results");
  results.hidden = true;
  const resultsCard = div("mh-card");
  const resultsHead = document.createElement("h2");
  resultsHead.className = "mh-results-title";
  const resultsTable = createTable();
  const hint = document.createElement("p");
  hint.className = "mh-results-hint";
  hint.textContent = resultsHint(driver.isHost);
  resultsCard.append(resultsHead, resultsTable.el, hint);
  results.append(resultsCard);
  play.append(shield, feedBox, death, board, results);
  hud.append(top, count, play);
  root.append(hud);

  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  /** Короткий удар-печать (Web Animations): без анимаций по настройке ОС — ничего. */
  const stamp = (el: HTMLElement, frames: Keyframe[], ms: number): void => {
    if (calm?.matches || typeof el.animate !== "function") return;
    el.animate(frames, { duration: ms, easing: EASE_OUT });
  };

  let feed: FeedItem[] = [];
  /** Причина последней смерти своего мага: считается один раз, по событию (HP убийцы — на тот момент). */
  let deathText = "";
  /** Стихия, выбранная на экране смерти: подсвечена сразу, хост применит её при возрождении. */
  let picked: Element | null = null;
  let deadShown = false;
  let locked = false;
  let boardHeld = false;
  let phase: GameState["phase"] | "" = "";
  let topFor: GameState | null = null;
  let topSec = Number.NaN;
  let topNames: ReadonlyMap<UnitId, string> | null = null;
  /** Дуга матча (T7): что уже прозвучало (меняется на месте); по какой игре, составу и секунде она считана. */
  const arc = createArc();
  let arcFor: GameState | null = null;
  let arcSec = Number.NaN;
  let arcNames: ReadonlyMap<UnitId, string> | null = null;
  let matchPointShown = "";
  /** Имена всех магов за сессию (для таблицы и итогов: вышедший победитель — по имени); пересчёт — со сменой состава. */
  let known: ReadonlyMap<UnitId, string> = new Map();
  let knownFrom: ReadonlyMap<UnitId, string> | null = null;
  /** Когда таблица (Tab или итоги) пересобиралась; −∞ — пересобрать в ближайшем кадре. */
  let tableAt = -Infinity;
  let tableKind: "board" | "results" | null = null;

  const renderChoice = (current: Element | null): void => {
    for (const c of chips) c.el.classList.toggle("is-on", c.element === current);
  };

  /**
   * Цифра на экране смерти: стихия при возрождении (хост — сразу в ядре, игрок — запросом). Через вид, как выбор в меню:
   * его настройки и меню знают новую стихию.
   */
  const pick = (e: Element): void => {
    picked = e;
    renderChoice(e);
    view.chooseElement(e);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Tab") {
      // в меню (мышь свободна) Tab ходит по кнопкам; в игре держит таблицу
      if (!view.input.locked) return;
      e.preventDefault();
      boardHeld = true;
      return;
    }
    if (e.repeat) return;
    // цифры — только в игре: экран смерти под открытым меню спрятан
    if (deadShown && view.input.locked) {
      const k = ELEMENT_KEYS.find((x) => x.code === e.code);
      if (k) pick(k.element);
      return;
    }
    if (e.code === "KeyR" && driver.isHost && phase === "results") driver.start();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Tab") boardHeld = false;
  };
  const onBlur = (): void => {
    boardHeld = false;
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  const renderFeed = (nowS: number): void => {
    // новые — сверху: просроченные в хвосте
    while (feed.length > 0 && nowS - feed[feed.length - 1]!.at >= FEED_S) feed.pop();
    for (let k = 0; k < FEED_LINES; k++) {
      const el = feedEls[k]!;
      const item = feed[k];
      setHidden(el, !item);
      if (!item) continue;
      const parts = feedParts[k]!;
      setText(parts.text, item.text);
      setText(parts.seal, item.stamp);
      setHidden(parts.seal, item.stamp === "");
      el.classList.toggle("is-mine", item.mine);
      const left = FEED_S - (nowS - item.at);
      const opacity = left < FEED_FADE_S ? (Math.max(0, left) / FEED_FADE_S).toFixed(2) : "";
      // сравниваем с записанным, а не с el.style: браузер нормализует «0.50» в «0.5», и запись шла бы каждый кадр
      if (feedOpacity[k] !== opacity) {
        feedOpacity[k] = opacity;
        el.style.opacity = opacity;
      }
    }
  };

  const renderTop = (c: GameState, now: number, names: ReadonlyMap<UnitId, string>): void => {
    // строка меняется со снапшотом, составом или секундой часов — между ними не пересобираем
    const sec = Math.ceil((c.phaseEnd - now) / TICK_HZ);
    if (c === topFor && sec === topSec && names === topNames) return;
    topFor = c;
    topSec = sec;
    topNames = names;
    const p = topParts(c, driver.localId, names, driver.isHost, now);
    setText(topClock, p.clock);
    setText(topRest, p.clock !== "" && p.rest !== "" ? ` · ${p.rest}` : p.rest);
  };

  const sound = (id: SoundId): void => view.route({ kind: "sound", id, pos: null, gain: 1 });
  /**
   * Дуга матча (T7) по подтверждённой игре и часам «сейчас»: часы краснеют печатью, один раз «Последняя минута!» (в
   * строке серий, если она свободна) и гонг — и без музыки; щелчки последних 10 с; печать матч-пойнта и барабан.
   */
  const renderArc = (c: GameState, now: number, names: ReadonlyMap<UnitId, string>, nowS: number): void => {
    // дуга меняется со снапшотом, составом или секундой часов — между ними не считаем (как строка сверху)
    const sec = Math.ceil((c.phaseEnd - now) / TICK_HZ);
    if (c === arcFor && sec === arcSec && names === arcNames) return;
    const fresh = c !== arcFor || names !== arcNames;
    arcFor = c;
    arcSec = sec;
    arcNames = names;
    const a = stepArc(arc, c, now);
    topClock.classList.toggle("is-final", a.final);
    if (a.lastMinute) {
      stamp(topClock, [{ transform: "scale(1.4)" }, { transform: "scale(1)" }], 180);
      view.streak.lastMinute(nowS);
      sound("lastMinute");
    }
    if (a.click) sound(a.click === "last" ? "clockTickLast" : "clockTick");
    // текст печати — только с новой игрой или составом
    const mp = fresh ? (matchPointText(a.ids, driver.localId, names) ?? "") : matchPointShown;
    if (mp !== matchPointShown) {
      matchPointShown = mp;
      setText(topMatchPoint, mp);
      setHidden(topMatchPoint, mp === "");
    }
    if (a.matchPoint) {
      stamp(topMatchPoint, [{ transform: "scale(1.4)" }, { transform: "scale(1)" }], 180);
      sound("streakDrums");
    }
  };

  return {
    update(f, nowS) {
      const g = driver.game();
      const c = driver.confirmedGame();
      const names = driver.names();
      const id = driver.localId;
      const now = g.match.tick;
      phase = c.phase;
      if (names !== knownFrom) {
        knownFrom = names;
        known = withKnownNames(known, names);
      }

      if (view.input.locked !== locked) {
        locked = view.input.locked;
        setHidden(play, !locked);
        if (!locked) boardHeld = false;
      }

      // килфид и причина смерти — только по событиям хоста
      let fresh = false;
      for (const ev of f.confirmed) {
        // серии — строками другим, не в разминке и отсчёте (Р5); решающее очко переводит игру в итоги — его строка остаётся
        if (ev.type === "streak") {
          if (c.phase === "warmup" || c.phase === "countdown") continue;
          const lines = streakFeedLines(ev, names, id);
          for (const l of lines) feed.unshift({ text: l.text, mine: l.mine, stamp: l.stamp, at: nowS });
          if (lines.length > 0) fresh = true;
          continue;
        }
        const line = feedLine(ev, names, id);
        if (!line) continue;
        feed.unshift({ text: line.text, mine: line.mine, stamp: "", at: nowS });
        fresh = true;
        if ((ev.type === "death" || ev.type === "fall") && ev.target === id) deathText = deathLine(ev, c, names);
      }
      if (feed.length > FEED_LINES) feed.length = FEED_LINES;
      renderFeed(nowS);
      if (fresh && locked) stamp(feedEls[0]!, [{ opacity: 0, transform: "translateX(14px)" }, { opacity: 1, transform: "none" }], 180);

      renderTop(c, now, names);
      renderArc(c, now, names, nowS);

      const counting = c.phase === "countdown";
      setHidden(count, !counting);
      if (counting) {
        const digit = countdownDigit(c.phaseEnd, now);
        if (count.textContent !== digit) {
          count.textContent = digit;
          stamp(count, [{ opacity: 0.35, transform: "scale(1.45)" }, { opacity: 1, transform: "scale(1)" }], 260);
        }
      }

      // защита — от «сейчас»: свой каст снимает её сразу, без ожидания снапшота
      const meNow = unitById(g.match, id);
      setHidden(shield, !(meNow?.alive && statusFlags(meNow, now).shielded));

      // смерть — по подтверждённому; предсказание уже вернуло мага (тик возрождения прошёл) — экран прячется
      const over = c.phase === "results";
      const me = unitById(c.match, id);
      const dead = !over && me !== undefined && !me.alive && !(meNow?.alive ?? false);
      if (dead !== deadShown) {
        deadShown = dead;
        setHidden(death, !dead);
        picked = null;
        if (dead) stamp(death, [{ opacity: 0, transform: "translate(-50%, 8px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], 220);
      }
      if (dead && me) {
        setText(cause, deathText);
        setHidden(cause, deathText === "");
        setText(respawn, respawnLine(me.respawnTick, now));
        renderChoice(picked ?? me.mage?.element ?? null);
      } else deathText = "";

      // таблица по Tab или итоги: пересборка не чаще BOARD_EVERY_S; имена — всех за сессию (вышедший — не «Маг»)
      const kind = over ? "results" : boardHeld ? "board" : null;
      setHidden(board, kind !== "board");
      setHidden(results, kind !== "results");
      if (kind !== tableKind) {
        tableKind = kind;
        tableAt = -Infinity;
      }
      if (kind && nowS - tableAt >= BOARD_EVERY_S) {
        tableAt = nowS;
        const rows = scoreRows(c, known, driver.pings(), id);
        if (kind === "board") {
          setText(boardHead, boardTitle(driver.roomCode, driver.ownPing()));
          fillTable(boardTable, rows);
        } else {
          setText(resultsHead, resultsTitle(c.results, known));
          fillTable(resultsTable, rows);
        }
      }
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      hud.remove();
      feed = [];
    },
  };
}
