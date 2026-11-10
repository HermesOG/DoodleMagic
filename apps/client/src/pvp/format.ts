import {
  ABILITY_NAME, ELEMENTS, ELEMENT_INFO, NOBODY, PICKUPS, PVP, TICK_HZ, scoreLimitFor, scoreOf, standings, unitById,
  type DamageSource, type Element, type GameState, type MatchEvent, type Standing, type UnitId,
} from "@doodlemagic/sim";
import { BOT_PING } from "../net/protocol";
import { STREAK_LOUD_FROM, STREAK_MARK_FROM, multiText, streakStep } from "../hud/streakHud";

/**
 * Тексты интерфейса матча (задача 8): чистые функции под тесты. Без родовых окончаний — пол игрока неизвестен
 * (исключение — «Сорвался в ущелье»: одна форма для всех, как тост вида «Сорвался!»).
 */

/** Имя мага не из состава (вышел) — в килфиде и таблице. */
const UNKNOWN_NAME = "Маг";
const nameOf = (names: ReadonlyMap<UnitId, string>, id: UnitId): string => names.get(id) ?? UNKNOWN_NAME;
/** Чем убит: способность или горение. */
const causeOf = (a: DamageSource): string => (a === "burning" ? "Горение" : ABILITY_NAME[a]);
/** HP как на полосе (hud/format hpBar): дробное — вверх, живому не показываем 0. */
const hpText = (hp: number): number => Math.max(0, Math.ceil(hp - 1e-9));
const magesIn = (g: Readonly<GameState>): number => {
  let n = 0;
  for (const u of g.match.units) if (u.mage) n++;
  return n;
};

/** Тики → «м:сс», вверх до целой секунды; отрицательное → «0:00». */
export function formatClock(ticks: number): string {
  if (!Number.isFinite(ticks) || ticks <= 0) return "0:00";
  const s = Math.ceil(ticks / TICK_HZ);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Лидер боя: никого при 0 очков у первого; «Лидер — ты»; ничья наверху — все первые, «ты» впереди. */
function leaderText(st: readonly Standing[], localId: UnitId, names: ReadonlyMap<UnitId, string>): string | null {
  const top = st[0];
  if (!top || top.score <= 0) return null;
  const tied = st.filter((s) => s.score === top.score);
  if (tied.length === 1) return top.id === localId ? "Лидер — ты" : `Лидер: ${nameOf(names, top.id)} — ${top.score}`;
  const mine = tied.some((s) => s.id === localId);
  const others = tied.filter((s) => s.id !== localId).map((s) => nameOf(names, s.id));
  return `Лидеры: ${(mine ? ["ты", ...others] : others).join(", ")} — ${top.score}`;
}

/**
 * Строка сверху по фазе. now — тик, от которого идут часы боя: у игрока — предсказанный (часы тикают плавно между
 * снапшотами), а счёт и фаза — из подтверждённого g. Без now — тик g.
 */
export function topLine(
  g: GameState, localId: UnitId, names: ReadonlyMap<UnitId, string>, isHost: boolean, now = g.match.tick, offline = false,
): string {
  const p = topParts(g, localId, names, isHost, now, offline);
  return p.clock === "" ? p.rest : `${p.clock} · ${p.rest}`;
}

/**
 * Строка сверху по частям: часы боя (в бою — отдельно: они краснеют в последнюю минуту, T7) и остальное. offline — бой с
 * ботами: отсчёт начинает первое «Играть».
 */
export function topParts(
  g: GameState,
  localId: UnitId,
  names: ReadonlyMap<UnitId, string>,
  isHost: boolean,
  now = g.match.tick,
  offline = false,
): { clock: string; rest: string } {
  const n = magesIn(g);
  switch (g.phase) {
    case "warmup":
      if (offline) return { clock: "", rest: `Разминка · магов: ${n} · «Играть» — в бой` };
      return { clock: "", rest: `Разминка · магов: ${n} · ${isHost ? "Esc → «Начать матч»" : "хост начнёт матч"}` };
    case "countdown":
      // лимит боя считает старт по числу магов (startLive): в отсчёте он ещё может быть прежним
      return { clock: "", rest: `Матч начинается · магов: ${n} · до ${scoreLimitFor(n)}` };
    case "live": {
      const clock = formatClock(g.phaseEnd - now);
      const parts: string[] = [];
      const st = standings(g);
      const me = st.find((s) => s.id === localId);
      if (me) parts.push(`Ты ${me.score}`);
      const lead = leaderText(st, localId, names);
      if (lead) parts.push(lead);
      parts.push(`до ${g.scoreLimit}`);
      return { clock: g.suddenDeath ? `Внезапная смерть ${clock}` : clock, rest: parts.join(" · ") };
    }
    case "results":
      return { clock: "", rest: `Итоги · магов: ${n}` };
  }
}

/**
 * Дуга матча (T7). Последняя минута — с 6:00 боя (до конца 60 с): часы краснеют (и всю внезапную смерть), один раз за
 * бой крупно «Последняя минута!» и гонг. Последние 10 с — щелчок на каждую секунду, последние 3 с — выше. Матч-пойнт —
 * у кого лимит − 1 очко, пока это правда; новый маг на матч-пойнте — двойной удар барабана.
 */
export const ARC = { finalS: PVP.finalS, clicksS: 10, highS: 3 } as const;
export interface ArcStep {
  /** Часы красные: последняя минута боя или внезапная смерть. */
  final: boolean;
  /** Сейчас объявить «Последняя минута!» (один раз за бой). */
  lastMinute: boolean;
  /** Щелчок часов в эту секунду: обычный, высокий (последние 3 с) или нет. */
  click: "tick" | "last" | null;
  /** На матч-пойнт вышел новый маг (барабан). */
  matchPoint: boolean;
  /** Маги на матч-пойнте, по id (массив памяти: меняется на месте). */
  ids: readonly UnitId[];
}
/**
 * Что дуга уже сказала: за какой бой (phaseEnd) прозвучала последняя минута, секунда часов; по какой игре считан
 * матч-пойнт, кто на нём и ключ «id,id». Меняется на месте, ответ шага (step) — один объект на всё время: без мусора в кадре.
 */
export interface ArcMemory {
  finalFor: number;
  sec: number;
  game: GameState | null;
  ids: UnitId[];
  matchPoint: string;
  step: ArcStep;
}
export function createArc(): ArcMemory {
  const ids: UnitId[] = [];
  return { finalFor: Number.NaN, sec: Number.NaN, game: null, ids, matchPoint: "", step: { final: false, lastMinute: false, click: null, matchPoint: false, ids } };
}
const byId = (a: UnitId, b: UnitId): number => a - b;
/** Маги с лимит − 1 очком (в бою), по id — в out (на месте). */
export function matchPointIds(g: GameState, out: UnitId[] = []): UnitId[] {
  out.length = 0;
  if (g.phase !== "live" || g.scoreLimit < 2) return out;
  for (const u of g.match.units) if (u.mage && scoreOf(u) === g.scoreLimit - 1) out.push(u.id);
  return out.sort(byId);
}
/**
 * Шаг дуги по подтверждённой игре g на тике часов now (у игрока — предсказанный, как часы в строке). Матч-пойнт
 * пересчитывается только с новой игрой (снапшотом). Память m и ответ m.step меняются на месте.
 */
export function stepArc(m: ArcMemory, g: GameState, now: number): ArcStep {
  const live = g.phase === "live";
  const left = g.phaseEnd - now;
  const inFinal = left > 0 && left <= ARC.finalS * TICK_HZ;
  const s = m.step;
  s.lastMinute = live && !g.suddenDeath && inFinal && m.finalFor !== g.phaseEnd;
  if (s.lastMinute) m.finalFor = g.phaseEnd;
  const sec = live && left > 0 ? Math.ceil(left / TICK_HZ) : Number.NaN;
  s.click = sec !== m.sec && sec >= 1 && sec <= ARC.clicksS ? (sec <= ARC.highS ? "last" : "tick") : null;
  m.sec = sec;
  s.final = live && (g.suddenDeath || inFinal);
  s.matchPoint = false;
  if (g !== m.game) {
    m.game = g;
    matchPointIds(g, m.ids);
    const key = m.ids.length === 0 ? "" : m.ids.join(",");
    s.matchPoint = key !== "" && key !== m.matchPoint;
    m.matchPoint = key;
  }
  return s;
}
/** Печать матч-пойнта в строке сверху: своему — «Одно очко до победы», о чужих — «Матч-пойнт: Имя»; никого — null. */
export function matchPointText(ids: readonly UnitId[], localId: UnitId, names: ReadonlyMap<UnitId, string>): string | null {
  if (ids.length === 0) return null;
  const parts: string[] = [];
  if (ids.includes(localId)) parts.push("Одно очко до победы");
  const others = ids.filter((id) => id !== localId).map((id) => nameOf(names, id));
  if (others.length > 0) parts.push(`Матч-пойнт: ${others.join(", ")}`);
  return parts.join(" · ");
}

/** Крупная цифра отсчёта: 3, 2, 1 (до начала боя — вверх до целой секунды, не меньше 1). */
export function countdownDigit(phaseEnd: number, now: number): string {
  return String(Math.min(PVP.countdownS, Math.max(1, Math.ceil((phaseEnd - now) / TICK_HZ))));
}

/** До возрождения — целые секунды вверх, не меньше 1. */
export function respawnLine(respawnTick: number, now: number): string {
  return `Возрождение через ${Math.max(1, Math.ceil((respawnTick - now) / TICK_HZ))}`;
}

/**
 * Строка килфида по подтверждённому событию; прочие → null. death/fall — mine: я убийца или жертва. Руна (фаза 6):
 * взятие руны — mine: я взял; носитель сбит кем-то — mine: я сбил или я носитель. Объявление, появление, сферы,
 * конец ярости и сорвавшийся сам носитель — без строки.
 */
export function feedLine(ev: MatchEvent, names: ReadonlyMap<UnitId, string>, localId: UnitId): { text: string; mine: boolean } | null {
  if (ev.type === "pickup") {
    if (ev.kind !== "rune" || ev.phase !== "take") return null;
    return { text: `${nameOf(names, ev.unit)} · руна ярости`, mine: ev.unit === localId };
  }
  if (ev.type === "fury") {
    // сбивший вышел — заряд никому не начислен: строки нет (как имя убийцы в строке смерти)
    if (ev.phase !== "slain" || ev.by === NOBODY || !names.has(ev.by)) return null;
    return { text: `${nameOf(names, ev.by)} · +${PICKUPS.rune.killUlt} к ульте за носителя руны`, mine: ev.by === localId || ev.unit === localId };
  }
  if (ev.type === "death") {
    const victim = nameOf(names, ev.target);
    const killer = names.get(ev.killer);
    const cause = causeOf(ev.ability);
    // убийцы нет в составе (вышел, а его горение добило): только жертва и причина
    const text = killer === undefined ? `${victim} · ${cause}` : `${killer} → ${victim} · ${cause}`;
    return { text, mine: ev.target === localId || ev.killer === localId };
  }
  if (ev.type === "fall") {
    const victim = nameOf(names, ev.target);
    if (ev.credit === NOBODY) return { text: `${victim} · в ущелье`, mine: ev.target === localId };
    const by = names.get(ev.credit);
    return { text: by === undefined ? `${victim} · сброс` : `${by} ⇣ ${victim} · сброс`, mine: ev.target === localId || ev.credit === localId };
  }
  return null;
}

/** Приписка экрана смерти о серии убийцы (Р5): в бою, с 3 очков — «· его серия: N» (уже с этим очком, по g). */
function streakTail(g: GameState, id: UnitId): string {
  if (g.phase !== "live") return "";
  const n = unitById(g.match, id)?.mage?.stats.streak ?? 0;
  return n >= STREAK_MARK_FROM ? ` · его серия: ${n}` : "";
}

/**
 * Текст экрана смерти по последнему death/fall со мной в роли цели. HP и серия убийцы — по g (HP — живому). Нет
 * события — "".
 */
export function deathLine(ev: MatchEvent | null, g: GameState, names: ReadonlyMap<UnitId, string>): string {
  if (ev?.type === "death") {
    const cause = causeOf(ev.ability);
    const killer = names.get(ev.killer);
    if (killer === undefined) return `Тебя победили · ${cause}`;
    const k = unitById(g.match, ev.killer);
    return `Тебя победил ${killer} · ${cause}${k?.alive ? ` · у него ${hpText(k.hp)} HP` : ""}${streakTail(g, ev.killer)}`;
  }
  if (ev?.type === "fall") {
    if (ev.credit === NOBODY) return "Сорвался в ущелье";
    const by = names.get(ev.credit);
    return by === undefined ? "Тебя сбросили" : `Тебя сбросил ${by}${streakTail(g, ev.credit)}`;
  }
  return "";
}

/** Совет против стихии бота на экране смерти (Р17 фазы 8): одна короткая фраза. */
export const BOT_TIPS: Readonly<Record<Element, string>> = Object.freeze({
  fire: "Против Огня: держись дальше 20 м, от шара — шаг вбок",
  earth: "Против Земли: отходи и стреляй, от камня — шаг вбок",
  air: "Против Воздуха: не стой между ним и краем, дави — у него 130 HP",
  water: "Против Воды: держись дальше 15 м, в Отражение секунду не стреляй",
});

/**
 * Вторая строка экрана смерти: убил или сбросил бот (пинг BOT_PING — настоящий признак, метка в имени — только для
 * глаз) — совет против его стихии сейчас. Иначе "".
 */
export function deathTip(ev: MatchEvent | null, g: GameState, pings: ReadonlyMap<UnitId, number>): string {
  const by = ev?.type === "death" ? ev.killer : ev?.type === "fall" ? ev.credit : NOBODY;
  if (by === NOBODY || pings.get(by) !== BOT_PING) return "";
  const element = unitById(g.match, by)?.mage?.element;
  return element ? BOT_TIPS[element] : "";
}

/** Строка килфида о серии: stamp — печать «×N» у мульти, "" — без печати. */
export interface StreakFeedLine {
  text: string;
  mine: boolean;
  stamp: string;
}
/** «Двойное!» → «двойное», «Неудержимый!» → «Неудержимый»: в килфиде без восклицания. */
const quiet = (t: string): string => t.replace(/!$/, "");
/**
 * Строки килфида по подтверждённому очку (Р5) — для других: своё скажут крупная надпись и тост. Мульти от ×2 — «Имя ·
 * двойное» с печатью «×N»; ступень серии от 5 — «Имя — Неудержимый»; прервал серию от 3 — «Петя прерывает серию: Вася ·
 * 5» (без родовых окончаний и падежей имён); mine — прервали мою. Набравший очко вышел — строк нет.
 */
export function streakFeedLines(ev: MatchEvent, names: ReadonlyMap<UnitId, string>, localId: UnitId): StreakFeedLine[] {
  if (ev.type !== "streak" || ev.unit === localId) return [];
  const who = names.get(ev.unit);
  if (who === undefined) return [];
  const out: StreakFeedLine[] = [];
  const m = multiText(ev.multi);
  if (m) out.push({ text: `${who} · ${quiet(m).toLowerCase()}`, mine: false, stamp: `×${ev.multi}` });
  const s = ev.streak >= STREAK_LOUD_FROM ? streakStep(ev.streak) : null;
  if (s) out.push({ text: `${who} — ${quiet(s)}`, mine: false, stamp: "" });
  if (ev.broke !== NOBODY) out.push({ text: `${who} прерывает серию: ${nameOf(names, ev.broke)} · ${ev.brokeStreak}`, mine: ev.broke === localId, stamp: "" });
  return out;
}

/** Строка таблицы. element — стихия мага сейчас (вышел — null); ping — «34», «бот» или «—», пока неизвестен. */
export interface ScoreRow {
  place: number;
  id: UnitId;
  name: string;
  element: Element | null;
  score: number;
  kills: number;
  falls: number;
  deaths: number;
  ping: string;
  mine: boolean;
}

/**
 * Строки таблицы: место, имя, стихия, очки, убийства, сбросы, смерти, пинг; свои помечены. Порядок — standings, на
 * итогах — results (бой после конца идёт без счёта, статистика магов меняется, а итог — нет). Место — по очкам:
 * равные очки делят место (1, 1, 3), как «Ничья: …» в заголовке итогов.
 */
export function scoreRows(g: GameState, names: ReadonlyMap<UnitId, string>, pings: ReadonlyMap<UnitId, number>, localId: UnitId): ScoreRow[] {
  const list = g.phase === "results" ? g.results : standings(g);
  let place = 0;
  return list.map((s, k) => {
    const ping = pings.get(s.id) ?? -1;
    if (k === 0 || list[k - 1]!.score !== s.score) place = k + 1;
    return {
      place,
      id: s.id,
      name: nameOf(names, s.id),
      element: unitById(g.match, s.id)?.mage?.element ?? null,
      score: s.score,
      kills: s.kills,
      falls: s.falls,
      deaths: s.deaths,
      ping: ping === BOT_PING ? "бот" : ping < 0 ? "—" : String(Math.round(ping)),
      mine: s.id === localId,
    };
  });
}

/**
 * Имена всех магов, виденных за сессию: прежние плюс нынешний состав (он главнее). Для итогов и таблицы — победитель,
 * закрывший вкладку, остаётся по имени, а не «Маг»; id не переиспользуются. Килфид берёт только нынешний состав.
 */
export function withKnownNames(known: ReadonlyMap<UnitId, string>, roster: ReadonlyMap<UnitId, string>): Map<UnitId, string> {
  const all = new Map(known);
  for (const [id, name] of roster) all.set(id, name);
  return all;
}

/** Заголовок итогов: победитель или все первые при ничьей (внезапная смерть кончилась, двое дошли до лимита разом). */
export function resultsTitle(results: readonly Standing[], names: ReadonlyMap<UnitId, string>): string {
  const top = results[0];
  if (!top) return "Итоги";
  const first = results.filter((s) => s.score === top.score).map((s) => nameOf(names, s.id));
  return first.length === 1 ? `Победа: ${first[0]}` : `Ничья: ${first.join(", ")}`;
}

/** Подсказка под итогами: хосту — как начать снова, остальным — ждать. */
export function resultsHint(isHost: boolean): string {
  return isHost ? "R или Esc → «Ещё раз»" : "Ждём, когда хост начнёт снова";
}

/** Шапка таблицы по Tab: комната и свой пинг (у хоста 0, неизвестен — «—»); без комнаты — бой с ботами. */
export function boardTitle(code: string, ping: number): string {
  if (code === "") return "Бой с ботами";
  return `Комната ${code} · пинг ${ping < 0 ? "—" : `${Math.round(ping)} мс`}`;
}

/** Выбор стихии на экране смерти: клавиша (event.code), стихия и подпись «1 — Огонь». */
export const ELEMENT_KEYS: readonly { code: string; element: Element; label: string }[] = ELEMENTS.map((element, k) => ({
  code: `Digit${k + 1}`,
  element,
  label: `${k + 1} — ${ELEMENT_INFO[element].name}`,
}));
