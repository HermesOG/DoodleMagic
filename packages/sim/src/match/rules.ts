import type { ArenaData, Spawn } from "../types";
import { ticks } from "./defs";
import { matchContext, stepMatch } from "./match";
import { clonePlain, createMageUnit, createMatchState } from "./state";
import { NEVER, type Element, type MatchContext, type MatchEvent, type MatchInput, type MatchState, type Unit, type UnitId } from "./types";
import { pickSpawn } from "./units";

/**
 * Правила «Свалки» поверх stepMatch: фазы, счёт, лимит очков, вход и выход магов. Чистые функции: аргументы не
 * меняются, одинаковые аргументы дают одинаковые до байта JSON состояния и события. Их крутят хост и предсказание.
 */

/** Точка появления: живёт в units.ts (её же зовёт возрождение в stepLife), здесь — реэкспорт для хоста и клиента. */
export { pickSpawn } from "./units";

/** «Свалка» (GDD 3; решения Н6–Н8 плана фазы 3-lite). */
export const PVP = { maxPlayers: 6, countdownS: 3, matchS: 420, suddenDeathS: 60, respawnS: 3, shieldS: 2 } as const;

export type GamePhase = "warmup" | "countdown" | "live" | "results";
export interface Standing { id: UnitId; score: number; kills: number; falls: number; deaths: number }
export interface GameState {
  phase: GamePhase;
  /** countdown — тик начала боя; live — тик конца времени (во внезапной смерти — её конца); warmup и results — NEVER. */
  phaseEnd: number;
  suddenDeath: boolean;
  /** Лимит очков: в разминке — по числу магов, в бою — не меньше, чем был на старте (вошедшие поднимают). */
  scoreLimit: number;
  /** Итог боя по местам; вне results — []. */
  results: Standing[];
  /** id следующего мага. id не переиспользуются; маги — 1…999, снаряды и зоны — с 1000. */
  nextMageId: number;
  match: MatchState;
}
export interface GameStep { game: GameState; events: MatchEvent[] }

const COUNTDOWN_TICKS = ticks(PVP.countdownS); // 180
const MATCH_TICKS = ticks(PVP.matchS); // 25200
const SUDDEN_DEATH_TICKS = ticks(PVP.suddenDeathS); // 3600

/** Очки: убийства и засчитанные сбросы. Не маг — 0. */
export const scoreOf = (u: Unit): number => (u.mage ? u.mage.stats.kills + u.mage.stats.falls : 0);
const mageCount = (s: Readonly<MatchState>): number => s.units.filter((u) => u.mage !== null).length;

/** Места магов: очки по убыванию, затем смерти по возрастанию, затем id по возрастанию. */
export function standings(g: Readonly<GameState>): Standing[] {
  const list: Standing[] = [];
  for (const u of g.match.units) {
    const st = u.mage?.stats;
    if (st) list.push({ id: u.id, score: scoreOf(u), kills: st.kills, falls: st.falls, deaths: st.deaths });
  }
  return list.sort((a, b) => b.score - a.score || a.deaths - b.deaths || a.id - b.id);
}

/** Лимит очков по числу магов (GDD 3): до двух — 10, три-четыре — 12, от пяти — 15. */
export const scoreLimitFor = (mages: number): number => (mages <= 2 ? 10 : mages <= 4 ? 12 : 15);

/** Статика PvP по арене: matchContext, копия её точек появления, возрождение через 3 с, защита 2 с. Без точек — ошибка. */
export function pvpContext(arena: ArenaData): MatchContext {
  if (arena.spawns.length === 0) throw new Error(`pvpContext: у арены «${arena.name}» нет точек появления`);
  return { ...matchContext(arena), spawns: clonePlain(arena.spawns), mageRespawnS: PVP.respawnS, spawnShieldS: PVP.shieldS };
}

/** Пустая разминка: магов нет, лимит 10. */
export function createGame(): GameState {
  return { phase: "warmup", phaseEnd: NEVER, suddenDeath: false, scoreLimit: scoreLimitFor(0), results: [], nextMageId: 1, match: createMatchState([]) };
}

/** Копия игры для правок. match — уже готовая копия матча (у stepGame — состояние после stepMatch), иначе clonePlain. */
const copyGame = (g: Readonly<GameState>, match: MatchState = clonePlain(g.match)): GameState => ({ ...g, results: clonePlain(g.results), match });

/** Убирает снаряды, зоны и рельеф мага id. */
function clearOwned(s: MatchState, id: UnitId): void {
  s.projectiles = s.projectiles.filter((p) => p.owner !== id);
  s.zones = s.zones.filter((z) => z.owner !== id);
  s.terrain = s.terrain.filter((tr) => tr.owner !== id);
}

/** Свежий маг на точке at с защитой до shieldUntil. */
function freshMage(id: UnitId, element: Element, at: Spawn, shieldUntil: number): Unit {
  const u = createMageUnit(id, element, at);
  u.status.shieldUntil = shieldUntil;
  return u;
}

/**
 * Новый маг: id — nextMageId, встаёт на pickSpawn с защитой, юнит — в конец units (id растут). Лимит: в разминке — по
 * числу магов, на отсчёте и в бою — не ниже прежнего, на итогах не меняется (новый бой пересчитает его на старте).
 * Нужны точки появления в ctx (pvpContext), иначе — ошибка.
 */
export function addMage(g: Readonly<GameState>, element: Element, ctx: MatchContext): { game: GameState; id: UnitId } {
  if (!ctx.spawns) throw new Error("addMage: в контексте нет точек появления (pvpContext)");
  const game = copyGame(g);
  const s = game.match;
  const id = game.nextMageId++;
  s.units.push(freshMage(id, element, pickSpawn(s, id, ctx.spawns), s.tick + ticks(ctx.spawnShieldS ?? 0)));
  const limit = scoreLimitFor(mageCount(s));
  if (game.phase === "warmup") game.scoreLimit = limit;
  else if (game.phase !== "results") game.scoreLimit = Math.max(game.scoreLimit, limit);
  return { game, id };
}

/** Маг вышел: копия без юнита, его снарядов, зон и рельефа. Лимит не меняется. */
export function removeMage(g: Readonly<GameState>, id: UnitId): GameState {
  const game = copyGame(g);
  game.match.units = game.match.units.filter((u) => u.id !== id);
  clearOwned(game.match, id);
  return game;
}

/**
 * Смена стихии (Н12). Нет такого мага или стихия та же — копия без изменений. Мёртвый — меняется стихия, перезарядки
 * прежней сбрасываются: возродится новой с готовым набором; заряд ульты сгорает в 0 (Р2 фазы 5: не «ульта под
 * контрпик»). Свежий маг и так без заряда.
 * Живой в разминке, на отсчёте и на итогах — сразу свежий маг этой стихии на pickSpawn (без точек в ctx — на своей
 * точке) с прежним счётом и защитой; его снаряды, зоны и рельеф убраны. Живой в бою — без изменений.
 */
export function setElement(g: Readonly<GameState>, id: UnitId, element: Element, ctx: MatchContext): GameState {
  const game = copyGame(g);
  const s = game.match;
  const k = s.units.findIndex((u) => u.id === id);
  const old = s.units[k];
  if (!old?.mage || old.mage.element === element) return game;
  if (!old.alive) {
    // перезарядки прежней стихии к новой не относятся: новый набор возрождается готовым
    old.mage.element = element;
    old.mage.ready = { primary: 0, q: 0, e: 0, c: 0, x: 0 };
    old.mage.ult = { charge: 0, cast: null };
    return game;
  }
  if (game.phase === "live") return game;
  const at = ctx.spawns ? pickSpawn(s, id, ctx.spawns) : old.mage.spawn;
  const fresh = freshMage(id, element, at, s.tick + ticks(ctx.spawnShieldS ?? 0));
  fresh.mage!.stats = { ...old.mage.stats };
  s.units[k] = fresh;
  clearOwned(s, id);
  return game;
}

/** «Начать матч» и «Ещё раз» (Н8): из разминки или итогов — отсчёт 3 с. В других фазах — копия без изменений. */
export function startCountdown(g: Readonly<GameState>): GameState {
  const game = copyGame(g);
  if (game.phase !== "warmup" && game.phase !== "results") return game;
  return { ...game, phase: "countdown", phaseEnd: game.match.tick + COUNTDOWN_TICKS, results: [], suddenDeath: false };
}

/**
 * Старт боя: маги по возрастанию id заново — свежий маг той же стихии на pickSpawn среди уже расставленных в этом
 * старте (без точек в ctx — на своей точке), с защитой и нулевым счётом. Снаряды, зоны и рельеф убраны. На каждого
 * мага — событие respawn: вид поставит камеру и взгляд.
 */
function startLive(game: GameState, ctx: MatchContext, ev: MatchEvent[]): void {
  const s = game.match;
  const now = s.tick;
  const shieldUntil = now + ticks(ctx.spawnShieldS ?? 0);
  const placed: Unit[] = [];
  s.units = s.units.map((u) => {
    if (!u.mage) return u;
    const at = ctx.spawns ? pickSpawn({ ...s, units: placed }, u.id, ctx.spawns) : u.mage.spawn;
    const fresh = freshMage(u.id, u.mage.element, at, shieldUntil);
    placed.push(fresh);
    ev.push({ type: "respawn", target: u.id, pos: { x: at.pos.x, y: at.pos.y, z: at.pos.z }, yaw: at.yaw });
    return fresh;
  });
  s.projectiles = [];
  s.zones = [];
  s.terrain = [];
  game.phase = "live";
  game.phaseEnd = now + MATCH_TICKS;
  game.scoreLimit = scoreLimitFor(placed.length);
}

/** Конец боя: итоги по местам. */
function finish(game: GameState): void {
  game.phase = "results";
  game.results = standings(game);
  game.phaseEnd = NEVER;
  game.suddenDeath = false;
}

/**
 * Шаг игры 60 Гц: stepMatch, затем правила фазы по тику после шага. События фазы (respawn на старте боя) — после
 * событий матча этого тика.
 * - warmup: лимит по числу магов, счёт не важен.
 * - countdown: на phaseEnd — старт боя (startLive).
 * - live: лимит не ниже прежнего. Лидер набрал лимит — конец. Иначе на phaseEnd: ничья лидеров (магов ≥ 2, очки первых
 *   двух равны) — внезапная смерть на 60 с, иначе конец. Во внезапной смерти ничья разбита или время вышло — конец.
 * - results: ничего не меняется, бой идёт без счёта.
 */
export function stepGame(g: Readonly<GameState>, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>, ctx: MatchContext): GameStep {
  const r = stepMatch(g.match, inputs, ctx);
  const game = copyGame(g, r.state);
  const ev = r.events;
  const now = game.match.tick;
  const n = mageCount(game.match);
  if (game.phase === "warmup") game.scoreLimit = scoreLimitFor(n);
  else if (game.phase === "countdown") {
    if (now >= game.phaseEnd) startLive(game, ctx, ev);
  } else if (game.phase === "live") {
    game.scoreLimit = Math.max(game.scoreLimit, scoreLimitFor(n));
    const st = standings(game);
    const tied = st.length >= 2 && st[0]!.score === st[1]!.score;
    const lead = st.length > 0 && st[0]!.score >= game.scoreLimit;
    if (lead || (game.suddenDeath && !tied)) finish(game);
    else if (now >= game.phaseEnd) {
      if (tied && !game.suddenDeath) {
        game.suddenDeath = true;
        game.phaseEnd = now + SUDDEN_DEATH_TICKS;
      } else finish(game);
    }
  }
  return { game, events: ev };
}
