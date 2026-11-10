import { describe, expect, it } from "vitest";
import {
  NOBODY, createGame, createMageUnit, createMatchState, standings,
  type DamageSource, type Element, type GameState, type MatchEvent, type UnitId,
} from "@doodlemagic/sim";
import {
  ARC, BOT_TIPS, ELEMENT_KEYS, boardTitle, countdownDigit, deathLine, deathTip, feedLine, formatClock, matchPointText, resultsHint, resultsTitle,
  respawnLine, createArc, matchPointIds, scoreRows, stepArc, streakFeedLines, topLine, topParts, withKnownNames,
} from "./format";

const NAMES: ReadonlyMap<UnitId, string> = new Map([
  [1, "Искра 42"],
  [2, "Валун 17"],
  [3, "Огонёк"],
]);
const pos = { x: 0, y: 0, z: 0 };

/** Маг со счётом: kills + falls — очки. */
interface Spec { id: UnitId; el?: Element; kills?: number; falls?: number; deaths?: number; hp?: number; alive?: boolean }

/** Игра в фазе phase с магами по spec; тик 1000. */
function game(phase: GameState["phase"], specs: Spec[], patch: Partial<GameState> = {}): GameState {
  const units = specs.map((s) => {
    const u = createMageUnit(s.id, s.el ?? "fire", { pos, yaw: 0 });
    u.mage!.stats = { ...u.mage!.stats, kills: s.kills ?? 0, falls: s.falls ?? 0, deaths: s.deaths ?? 0 };
    if (s.hp !== undefined) u.hp = s.hp;
    if (s.alive === false) u.alive = false;
    return u;
  });
  const match = createMatchState(units);
  match.tick = 1000;
  return { ...createGame(), phase, match, scoreLimit: 12, ...patch };
}

describe("formatClock", () => {
  it("rounds ticks up to whole seconds as m:ss", () => {
    expect([formatClock(25200), formatClock(1), formatClock(0), formatClock(60), formatClock(61), formatClock(2460)]).toEqual([
      "7:00", "0:01", "0:00", "0:01", "0:02", "0:41",
    ]);
  });

  it("shows 0:00 for negative and broken values", () => {
    expect([formatClock(-5), formatClock(Number.NaN), formatClock(-Infinity), formatClock(Infinity)]).toEqual(["0:00", "0:00", "0:00", "0:00"]);
  });
});

describe("topLine", () => {
  const three = [{ id: 1, kills: 4, falls: 1 }, { id: 2, kills: 3 }, { id: 3 }];

  it("warmup: mage count and who starts the match", () => {
    const g = game("warmup", three);
    expect(topLine(g, 2, NAMES, false)).toBe("Разминка · магов: 3 · хост начнёт матч");
    expect(topLine(g, 1, NAMES, true)).toBe("Разминка · магов: 3 · Esc → «Начать матч»");
  });

  it("countdown: the limit the fight will start with", () => {
    expect(topLine(game("countdown", three, { phaseEnd: 1100 }), 2, NAMES, false)).toBe("Матч начинается · магов: 3 · до 12");
    expect(topLine(game("countdown", three.slice(0, 2), { phaseEnd: 1100 }), 2, NAMES, false)).toBe("Матч начинается · магов: 2 · до 10");
  });

  it("live: clock, own score, leader and limit", () => {
    const g = game("live", three, { phaseEnd: 1000 + 402 * 60 });
    expect(topLine(g, 2, NAMES, false)).toBe("6:42 · Ты 3 · Лидер: Искра 42 — 5 · до 12");
    expect(topLine(g, 1, NAMES, true)).toBe("6:42 · Ты 5 · Лидер — ты · до 12");
  });

  it("live: the clock counts from the given tick (prediction), not the state's", () => {
    const g = game("live", three, { phaseEnd: 1000 + 402 * 60 });
    expect(topLine(g, 2, NAMES, false, 1000 + 60)).toBe("6:41 · Ты 3 · Лидер: Искра 42 — 5 · до 12");
    expect(topLine(g, 2, NAMES, false, 1000 + 403 * 60)).toBe("0:00 · Ты 3 · Лидер: Искра 42 — 5 · до 12");
  });

  it("live: nobody leads at 0, tied leaders are listed with «ты» first", () => {
    expect(topLine(game("live", [{ id: 1 }, { id: 2 }], { phaseEnd: 1000 + 420 * 60, scoreLimit: 10 }), 2, NAMES, false)).toBe("7:00 · Ты 0 · до 10");
    const tied = game("live", [{ id: 1, kills: 2 }, { id: 2, kills: 2 }, { id: 3, kills: 2, deaths: 1 }], { phaseEnd: 1000 + 30 * 60 });
    expect(topLine(tied, 1, NAMES, false)).toBe("0:30 · Ты 2 · Лидеры: ты, Валун 17, Огонёк — 2 · до 12");
    expect(topLine(tied, 3, NAMES, false)).toBe("0:30 · Ты 2 · Лидеры: ты, Искра 42, Валун 17 — 2 · до 12");
  });

  it("live: sudden death", () => {
    const g = game("live", [{ id: 1, kills: 5 }, { id: 2, kills: 5, deaths: 2 }, { id: 3, kills: 3 }], { phaseEnd: 1000 + 41 * 60, suddenDeath: true });
    expect(topLine(g, 3, NAMES, false)).toBe("Внезапная смерть 0:41 · Ты 3 · Лидеры: Искра 42, Валун 17 — 5 · до 12");
  });

  it("results", () => {
    expect(topLine(game("results", three), 1, NAMES, true)).toBe("Итоги · магов: 3");
  });
});

describe("countdownDigit and respawnLine", () => {
  it("counts 3, 2, 1 and never shows 0", () => {
    expect([180, 121, 120, 61, 60, 1, 0, -10].map((left) => countdownDigit(1000 + left, 1000))).toEqual(["3", "3", "2", "2", "1", "1", "1", "1"]);
  });

  it("counts whole seconds to the respawn, at least 1", () => {
    expect([respawnLine(1180, 1000), respawnLine(1180, 1060), respawnLine(1180, 1179), respawnLine(1180, 1180)]).toEqual([
      "Возрождение через 3", "Возрождение через 2", "Возрождение через 1", "Возрождение через 1",
    ]);
  });
});

describe("feedLine", () => {
  const death = (killer: UnitId, target: UnitId, ability: DamageSource): MatchEvent => ({ type: "death", target, killer, ability, pos });
  const fall = (credit: UnitId, target: UnitId): MatchEvent => ({ type: "fall", target, credit, pos });

  it("death: killer → victim · ability, burning as «Горение»", () => {
    expect(feedLine(death(1, 2, "fireball"), NAMES, 3)).toEqual({ text: "Искра 42 → Валун 17 · Огненный шар", mine: false });
    expect(feedLine(death(1, 2, "burning"), NAMES, 3)).toEqual({ text: "Искра 42 → Валун 17 · Горение", mine: false });
    expect(feedLine(death(2, 1, "stoneShot"), NAMES, 3)).toEqual({ text: "Валун 17 → Искра 42 · Каменный снаряд", mine: false });
  });

  it("death: a killer who left the room is dropped", () => {
    expect(feedLine(death(9, 2, "burning"), NAMES, 3)).toEqual({ text: "Валун 17 · Горение", mine: false });
    expect(feedLine(death(NOBODY, 2, "burning"), NAMES, 3)).toEqual({ text: "Валун 17 · Горение", mine: false });
  });

  it("fall: credited push, missing pusher, own slip", () => {
    expect(feedLine(fall(1, 2), NAMES, 3)).toEqual({ text: "Искра 42 ⇣ Валун 17 · сброс", mine: false });
    expect(feedLine(fall(9, 2), NAMES, 3)).toEqual({ text: "Валун 17 · сброс", mine: false });
    expect(feedLine(fall(NOBODY, 2), NAMES, 3)).toEqual({ text: "Валун 17 · в ущелье", mine: false });
  });

  it("marks lines where I am the killer or the victim", () => {
    expect([death(1, 2, "fireball"), fall(1, 2), death(2, 1, "earthquake"), fall(NOBODY, 1)].map((e) => feedLine(e, NAMES, 1)?.mine)).toEqual([true, true, true, true]);
  });

  it("ignores every other event", () => {
    const others: MatchEvent[] = [
      { type: "respawn", target: 1, pos, yaw: 0 },
      { type: "hit", source: 1, target: 2, ability: "fireball", amount: 50, pos, dir: pos, knock: { distM: 0, upM: 0 }, airborne: false, dot: false, killed: true },
      { type: "courage", unit: 1 },
    ];
    expect(others.map((e) => feedLine(e, NAMES, 1))).toEqual([null, null, null]);
  });

  it("an unknown victim still gets a line", () => {
    expect(feedLine(fall(NOBODY, 9), NAMES, 1)).toEqual({ text: "Маг · в ущелье", mine: false });
  });
});

describe("deathLine", () => {
  const g = game("live", [{ id: 1, hp: 63.4 }, { id: 2, alive: false, hp: 0 }, { id: 3, alive: false, hp: 0 }]);

  it("who won, with what and how much HP they kept", () => {
    expect(deathLine({ type: "death", target: 2, killer: 1, ability: "fireball", pos }, g, NAMES)).toBe("Тебя победил Искра 42 · Огненный шар · у него 64 HP");
    expect(deathLine({ type: "death", target: 2, killer: 1, ability: "burning", pos }, g, NAMES)).toBe("Тебя победил Искра 42 · Горение · у него 64 HP");
  });

  it("no HP when the killer is dead too, no name when they left", () => {
    expect(deathLine({ type: "death", target: 2, killer: 3, ability: "stoneShot", pos }, g, NAMES)).toBe("Тебя победил Огонёк · Каменный снаряд");
    expect(deathLine({ type: "death", target: 2, killer: 9, ability: "burning", pos }, g, NAMES)).toBe("Тебя победили · Горение");
  });

  it("falls: pushed, pushed by someone who left, slipped", () => {
    expect(deathLine({ type: "fall", target: 2, credit: 1, pos }, g, NAMES)).toBe("Тебя сбросил Искра 42");
    expect(deathLine({ type: "fall", target: 2, credit: 9, pos }, g, NAMES)).toBe("Тебя сбросили");
    expect(deathLine({ type: "fall", target: 2, credit: NOBODY, pos }, g, NAMES)).toBe("Сорвался в ущелье");
  });

  it("nothing known — empty", () => {
    expect(deathLine(null, g, NAMES)).toBe("");
    expect(deathLine({ type: "respawn", target: 2, pos, yaw: 0 }, g, NAMES)).toBe("");
  });
});

describe("scoreRows", () => {
  const pings: ReadonlyMap<UnitId, number> = new Map([[1, 0], [2, 34], [3, -1]]);

  it("rows in standings order with place, element, stats, ping and own mark", () => {
    const g = game("live", [{ id: 1, kills: 1, deaths: 3 }, { id: 2, el: "earth", kills: 2, falls: 1, deaths: 1 }, { id: 3, kills: 1, deaths: 1 }]);
    const rows = scoreRows(g, NAMES, pings, 3);
    expect(rows.map((r) => r.id)).toEqual(standings(g).map((s) => s.id));
    expect(rows).toEqual([
      { place: 1, id: 2, name: "Валун 17", element: "earth", score: 3, kills: 2, falls: 1, deaths: 1, ping: "34", mine: false },
      { place: 2, id: 3, name: "Огонёк", element: "fire", score: 1, kills: 1, falls: 0, deaths: 1, ping: "—", mine: true },
      { place: 2, id: 1, name: "Искра 42", element: "fire", score: 1, kills: 1, falls: 0, deaths: 3, ping: "0", mine: false },
    ]);
  });

  it("equal scores share a place, the next place skips (1, 1, 3, 3, 5)", () => {
    const g = game("live", [{ id: 1, kills: 4 }, { id: 2, kills: 4, deaths: 1 }, { id: 3, kills: 2 }, { id: 4, kills: 2, deaths: 2 }, { id: 5 }]);
    expect(scoreRows(g, NAMES, pings, 1).map((r) => [r.id, r.place])).toEqual([[1, 1], [2, 1], [3, 3], [4, 3], [5, 5]]);
  });

  it("on results the table is the final standings, not the stats that keep counting", () => {
    const g = game("results", [{ id: 1, kills: 9 }, { id: 2, kills: 2 }], {
      results: [{ id: 2, score: 12, kills: 10, falls: 2, deaths: 0 }, { id: 1, score: 3, kills: 3, falls: 0, deaths: 4 }, { id: 3, score: 1, kills: 1, falls: 0, deaths: 2 }],
    });
    const rows = scoreRows(g, new Map([[1, "Искра 42"], [2, "Валун 17"]]), pings, 1);
    expect(rows.map((r) => [r.place, r.name, r.element, r.score, r.kills, r.mine])).toEqual([
      [1, "Валун 17", "fire", 12, 10, false],
      [2, "Искра 42", "fire", 3, 3, true],
      [3, "Маг", null, 1, 1, false],
    ]);
  });

  it("a tie on results: both winners share 1st place", () => {
    const g = game("results", [{ id: 1 }, { id: 2 }, { id: 3 }], {
      results: [{ id: 1, score: 9, kills: 9, falls: 0, deaths: 1 }, { id: 2, score: 9, kills: 8, falls: 1, deaths: 2 }, { id: 3, score: 4, kills: 4, falls: 0, deaths: 3 }],
    });
    expect(scoreRows(g, NAMES, pings, 3).map((r) => r.place)).toEqual([1, 1, 3]);
    expect(resultsTitle(g.results, NAMES)).toBe("Ничья: Искра 42, Валун 17");
  });
});

describe("withKnownNames", () => {
  it("keeps the names of mages who left, the current roster wins, the inputs stay as they were", () => {
    const before = new Map<UnitId, string>([[1, "Искра 42"], [2, "Валун"]]);
    const roster = new Map<UnitId, string>([[2, "Валун 17"], [3, "Огонёк"]]);
    const known = withKnownNames(before, roster);
    expect([...known]).toEqual([[1, "Искра 42"], [2, "Валун 17"], [3, "Огонёк"]]);
    expect([...before]).toEqual([[1, "Искра 42"], [2, "Валун"]]);
  });

  it("the winner who closed the tab is named on results; the roster alone would say «Маг»", () => {
    const left = { id: 1, score: 12, kills: 12, falls: 0, deaths: 0 };
    const roster = new Map<UnitId, string>([[2, "Валун 17"]]);
    const known = withKnownNames(new Map([[1, "Искра 42"], [2, "Валун 17"]]), roster);
    const g = game("results", [{ id: 2 }], { results: [left, { id: 2, score: 5, kills: 5, falls: 0, deaths: 2 }] });
    expect([resultsTitle(g.results, roster), resultsTitle(g.results, known)]).toEqual(["Победа: Маг", "Победа: Искра 42"]);
    expect(scoreRows(g, known, new Map(), 2).map((r) => r.name)).toEqual(["Искра 42", "Валун 17"]);
  });
});

describe("results and board texts", () => {
  const st = (id: UnitId, score: number) => ({ id, score, kills: score, falls: 0, deaths: 0 });

  it("names the winner or everyone tied at the top", () => {
    expect(resultsTitle([st(1, 12), st(2, 7)], NAMES)).toBe("Победа: Искра 42");
    expect(resultsTitle([st(1, 9), st(2, 9), st(3, 4)], NAMES)).toBe("Ничья: Искра 42, Валун 17");
    expect(resultsTitle([], NAMES)).toBe("Итоги");
  });

  it("tells the host how to go again and the others to wait", () => {
    expect([resultsHint(true), resultsHint(false)]).toEqual(["R или Esc → «Ещё раз»", "Ждём, когда хост начнёт снова"]);
  });

  it("board title: room and own ping", () => {
    expect([boardTitle("ABCD", 34), boardTitle("ABCD", 0), boardTitle("ABCD", -1)]).toEqual([
      "Комната ABCD · пинг 34 мс", "Комната ABCD · пинг 0 мс", "Комната ABCD · пинг —",
    ]);
  });

  it("1–4 pick Fire, Earth, Air and Water", () => {
    expect(ELEMENT_KEYS).toEqual([
      { code: "Digit1", element: "fire", label: "1 — Огонь" },
      { code: "Digit2", element: "earth", label: "2 — Земля" },
      { code: "Digit3", element: "air", label: "3 — Воздух" },
      { code: "Digit4", element: "water", label: "4 — Вода" },
    ]);
  });
});

describe("bots in the match texts (phase 8)", () => {
  const BOT = -2;

  it("a bot's ping reads «бот» in the table", () => {
    const g = game("live", [{ id: 1, kills: 2 }, { id: 2, el: "air" }]);
    const rows = scoreRows(g, new Map([[1, "Искра 42"], [2, "Перо · бот"]]), new Map([[1, 0], [2, BOT]]), 1);
    expect(rows.map((r) => [r.name, r.ping])).toEqual([["Искра 42", "0"], ["Перо · бот", "бот"]]);
  });

  it("the board title without a room is the bot fight", () => {
    expect(boardTitle("", 0)).toBe("Бой с ботами");
  });

  it("warmup line of the bot fight: «Играть» starts it", () => {
    expect(topLine(game("warmup", [{ id: 1 }, { id: 2 }]), 1, NAMES, true, 1000, true)).toBe("Разминка · магов: 2 · «Играть» — в бой");
  });

  it("death screen: a tip against the bot's element; none for a human or a slip", () => {
    const g = game("live", [{ id: 1, el: "water" }, { id: 2, alive: false, hp: 0 }, { id: 3, el: "earth" }]);
    const pings = new Map([[1, BOT], [2, 0], [3, 40]]);
    expect(deathTip({ type: "death", target: 2, killer: 1, ability: "fireball", pos }, g, pings)).toBe(BOT_TIPS.water);
    expect(deathTip({ type: "fall", target: 2, credit: 1, pos }, g, pings)).toBe(BOT_TIPS.water);
    expect(deathTip({ type: "death", target: 2, killer: 3, ability: "stoneShot", pos }, g, pings)).toBe("");
    expect(deathTip({ type: "fall", target: 2, credit: NOBODY, pos }, g, pings)).toBe("");
    expect(deathTip(null, g, pings)).toBe("");
    for (const t of Object.values(BOT_TIPS)) expect(t.length).toBeLessThan(80);
  });
});

describe("streaks in the kill feed and on the death screen (phase 9, Р5)", () => {
  const streak = (unit: UnitId, multi: number, n: number, broke: UnitId = NOBODY, brokeStreak = 0): MatchEvent => ({ type: "streak", unit, multi, streak: n, broke, brokeStreak });

  it("tells others «Имя · двойное» with a ×N stamp, «Имя — Неудержимый» from 5 and who broke whose streak", () => {
    expect(streakFeedLines(streak(1, 2, 2), NAMES, 2)).toEqual([{ text: "Искра 42 · двойное", mine: false, stamp: "×2" }]);
    expect(streakFeedLines(streak(1, 4, 5), NAMES, 2)).toEqual([
      { text: "Искра 42 · разгром", mine: false, stamp: "×4" },
      { text: "Искра 42 — Неудержимый", mine: false, stamp: "" },
    ]);
    // серия 3 — без строки (её видно печатью над именем); 7 и 10 — строкой
    expect(streakFeedLines(streak(1, 1, 3), NAMES, 2)).toEqual([]);
    expect(streakFeedLines(streak(1, 1, 7), NAMES, 2).map((l) => l.text)).toEqual(["Искра 42 — Стихийное бедствие"]);
    // прервал серию: без родовых окончаний; прервали мою — моя строка
    expect(streakFeedLines(streak(3, 1, 1, 1, 5), NAMES, 2)).toEqual([{ text: "Огонёк прерывает серию: Искра 42 · 5", mine: false, stamp: "" }]);
    expect(streakFeedLines(streak(3, 1, 1, 2, 4), NAMES, 2)[0]?.mine).toBe(true);
  });

  it("gives no feed line for my own streak, for a mage who left or for other events", () => {
    expect(streakFeedLines(streak(2, 3, 5), NAMES, 2)).toEqual([]);
    expect(streakFeedLines(streak(9, 3, 5), NAMES, 2)).toEqual([]);
    expect(streakFeedLines({ type: "loot", unit: 1, victim: 2, amount: 30, pos }, NAMES, 2)).toEqual([]);
  });

  it("adds the killer's streak from 3 to the death screen: «его серия: N»", () => {
    const g = game("live", [{ id: 1, hp: 64 }, { id: 2, alive: false }]);
    g.match.units[0]!.mage!.stats.streak = 5;
    expect(deathLine({ type: "death", target: 2, killer: 1, ability: "fireball", pos }, g, NAMES)).toBe("Тебя победил Искра 42 · Огненный шар · у него 64 HP · его серия: 5");
    expect(deathLine({ type: "fall", target: 2, credit: 1, pos }, g, NAMES)).toBe("Тебя сбросил Искра 42 · его серия: 5");
    // только в бою: решающее очко уже в итогах — без приписки
    expect(deathLine({ type: "fall", target: 2, credit: 1, pos }, { ...g, phase: "results" }, NAMES)).toBe("Тебя сбросил Искра 42");
    g.match.units[0]!.mage!.stats.streak = 2;
    expect(deathLine({ type: "fall", target: 2, credit: 1, pos }, g, NAMES)).toBe("Тебя сбросил Искра 42");
  });
});

describe("match arc (phase 9, T7)", () => {
  /** Бой до тика END; scores — очки по id. */
  const END = 30000;
  const fight = (scores: Partial<Record<UnitId, number>> = {}, patch: Partial<GameState> = {}): GameState =>
    game("live", [1, 2, 3].map((id) => ({ id, kills: scores[id] ?? 0 })), { phaseEnd: END, scoreLimit: 10, ...patch });
  /** Часы «сейчас» за left секунд до конца. */
  const nowAt = (left: number): number => END - Math.round(left * 60);
  /** Шаги дуги по секундам до конца одного боя (ответ шага — один объект на всё время: копируем). */
  const m = createArc();
  const run = (lefts: number[]) => {
    const g = fight();
    return lefts.map((l) => ({ ...stepArc(m, g, nowAt(l)) }));
  };

  it("announces «Последняя минута!» once per fight at 6:00 and reddens the clock till the end and in sudden death", () => {
    const steps = run([61, 60.5, 60, 59, 30, 12]);
    // память и ответ меняются на месте — без мусора в кадре
    expect(stepArc(m, fight(), nowAt(11))).toBe(m.step);
    expect(steps.map((s) => s.lastMinute)).toEqual([false, false, true, false, false, false]);
    expect(steps.map((s) => s.final)).toEqual([false, false, true, true, true, true]);
    expect(ARC.finalS).toBe(60);
    // внезапная смерть: часы красные, второй раз не объявляем; новый бой — снова
    const sd = stepArc(m, fight({}, { suddenDeath: true, phaseEnd: END + 3600 }), nowAt(50) + 3600);
    expect([sd.final, sd.lastMinute]).toEqual([true, false]);
    expect(stepArc(m, fight({}, { phaseEnd: END + 30000 }), nowAt(59) + 30000).lastMinute).toBe(true);
    // разминка и итоги — ничего
    for (const phase of ["warmup", "results"] as const) {
      const st = stepArc(createArc(), game(phase, [{ id: 1 }], { phaseEnd: 1000 + 30 * 60 }), 1000);
      expect([st.final, st.lastMinute, st.click, st.matchPoint]).toEqual([false, false, null, false]);
    }
  });

  it("clicks once a second in the last 10 s, higher in the last 3 s, never twice in one second", () => {
    m.sec = Number.NaN;
    const steps = run([11, 10.5, 10, 9.9, 9.5, 4, 3, 2.9, 2, 1, 0.5, 0]);
    // часы «0:11» молчат, «0:10» — первый щелчок; «0:03» и дальше — высокий; на 0:00 — тишина
    expect(steps.map((s) => s.click)).toEqual([null, null, "tick", null, null, "tick", "last", null, "last", "last", null, null]);
  });

  it("shows the match point while it is true and drums when a new mage reaches it", () => {
    const arc = createArc();
    const at = (g: GameState) => {
      const st = stepArc(arc, g, nowAt(200));
      return [[...st.ids], st.matchPoint];
    };
    expect(at(fight({ 1: 8 }))).toEqual([[], false]);
    const one = fight({ 1: 9 });
    expect(at(one)).toEqual([[1], true]);
    // та же игра (снапшот) — не пересчитываем; новая с тем же матч-пойнтом — без барабана
    expect(at(one)).toEqual([[1], false]);
    expect(at(fight({ 1: 9 }))).toEqual([[1], false]);
    expect(at(fight({ 3: 9, 1: 9 }))).toEqual([[1, 3], true]);
    // на месте: тот же массив
    const out: number[] = [7];
    expect(matchPointIds(fight({ 2: 9 }), out)).toBe(out);
    expect(out).toEqual([2]);
    expect(matchPointText([1, 3], 3, NAMES)).toBe("Одно очко до победы · Матч-пойнт: Искра 42");
    expect(matchPointText([1], 3, NAMES)).toBe("Матч-пойнт: Искра 42");
    expect(matchPointText([], 3, NAMES)).toBeNull();
  });

  it("splits the top line into the clock and the rest without changing the joined line", () => {
    const g = fight({ 2: 3 });
    g.match.tick = nowAt(125);
    expect(topParts(g, 2, NAMES, false)).toEqual({ clock: "2:05", rest: "Ты 3 · Лидер — ты · до 10" });
    expect(topLine(g, 2, NAMES, false)).toBe("2:05 · Ты 3 · Лидер — ты · до 10");
    expect(topParts(game("warmup", [{ id: 1 }]), 1, NAMES, true).clock).toBe("");
  });
});
