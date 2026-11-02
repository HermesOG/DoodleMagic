import {
  ABILITY_NAME, ELEMENTS, ELEMENT_INFO, NOBODY, PVP, TICK_HZ, scoreLimitFor, standings, unitById,
  type DamageSource, type Element, type GameState, type MatchEvent, type Standing, type UnitId,
} from "@doodlemagic/sim";

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
export function topLine(g: GameState, localId: UnitId, names: ReadonlyMap<UnitId, string>, isHost: boolean, now = g.match.tick): string {
  const n = magesIn(g);
  switch (g.phase) {
    case "warmup":
      return `Разминка · магов: ${n} · ${isHost ? "Esc → «Начать матч»" : "хост начнёт матч"}`;
    case "countdown":
      // лимит боя считает старт по числу магов (startLive): в отсчёте он ещё может быть прежним
      return `Матч начинается · магов: ${n} · до ${scoreLimitFor(n)}`;
    case "live": {
      const clock = formatClock(g.phaseEnd - now);
      const parts = [g.suddenDeath ? `Внезапная смерть ${clock}` : clock];
      const st = standings(g);
      const me = st.find((s) => s.id === localId);
      if (me) parts.push(`Ты ${me.score}`);
      const lead = leaderText(st, localId, names);
      if (lead) parts.push(lead);
      parts.push(`до ${g.scoreLimit}`);
      return parts.join(" · ");
    }
    case "results":
      return `Итоги · магов: ${n}`;
  }
}

/** Крупная цифра отсчёта: 3, 2, 1 (до начала боя — вверх до целой секунды, не меньше 1). */
export function countdownDigit(phaseEnd: number, now: number): string {
  return String(Math.min(PVP.countdownS, Math.max(1, Math.ceil((phaseEnd - now) / TICK_HZ))));
}

/** До возрождения — целые секунды вверх, не меньше 1. */
export function respawnLine(respawnTick: number, now: number): string {
  return `Возрождение через ${Math.max(1, Math.ceil((respawnTick - now) / TICK_HZ))}`;
}

/** Строка килфида по подтверждённому событию death/fall; прочие → null. mine — я убийца или жертва. */
export function feedLine(ev: MatchEvent, names: ReadonlyMap<UnitId, string>, localId: UnitId): { text: string; mine: boolean } | null {
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

/** Текст экрана смерти по последнему death/fall со мной в роли цели. HP убийцы — по g (живому). Нет события — "". */
export function deathLine(ev: MatchEvent | null, g: GameState, names: ReadonlyMap<UnitId, string>): string {
  if (ev?.type === "death") {
    const cause = causeOf(ev.ability);
    const killer = names.get(ev.killer);
    if (killer === undefined) return `Тебя победили · ${cause}`;
    const k = unitById(g.match, ev.killer);
    return `Тебя победил ${killer} · ${cause}${k?.alive ? ` · у него ${hpText(k.hp)} HP` : ""}`;
  }
  if (ev?.type === "fall") {
    if (ev.credit === NOBODY) return "Сорвался в ущелье";
    const by = names.get(ev.credit);
    return by === undefined ? "Тебя сбросили" : `Тебя сбросил ${by}`;
  }
  return "";
}

/** Строка таблицы. element — стихия мага сейчас (вышел — null); ping — «34» или «—», пока неизвестен. */
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
      ping: ping < 0 ? "—" : String(Math.round(ping)),
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

/** Шапка таблицы по Tab: комната и свой пинг (у хоста 0, неизвестен — «—»). */
export function boardTitle(code: string, ping: number): string {
  return `Комната ${code} · пинг ${ping < 0 ? "—" : `${Math.round(ping)} мс`}`;
}

/** Выбор стихии на экране смерти: клавиша (event.code), стихия и подпись «1 — Огонь». */
export const ELEMENT_KEYS: readonly { code: string; element: Element; label: string }[] = ELEMENTS.map((element, k) => ({
  code: `Digit${k + 1}`,
  element,
  label: `${k + 1} — ${ELEMENT_INFO[element].name}`,
}));
