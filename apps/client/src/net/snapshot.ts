import type { GameState, MatchEvent, UnitId } from "@doodlemagic/sim";

/** Снапшоты — каждый третий тик хоста (20 Гц). */
export const SNAPSHOT_EVERY_TICKS = 3;

/** Снапшот хоста (Н3): всё состояние игры без дельт. Уходит двоичным: encodeBinary округляет числа и сжимает. */
export interface SnapshotMsg {
  tick: number;                                        // game.match.tick
  game: GameState;
  acks: [UnitId, number][];                            // последний применённый seq игроков (хоста здесь нет)
  looks: [UnitId, number, number, number, number][];   // id, moveX, moveZ, yaw, pitch — ввод каждого мага на последнем тике
  roster: [UnitId, string, number][];                  // id, имя, пинг мс (−1 — неизвестен)
  events: [number, MatchEvent][];                      // тик (match.tick до шага), событие — всё с прошлого снапшота
}

const PHASES: readonly string[] = ["warmup", "countdown", "live", "results"];

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** Массив строк-кортежей длины n, каждая проходит ok. */
const isRows = (x: unknown, n: number, ok: (row: unknown[]) => boolean): boolean =>
  Array.isArray(x) && x.every((row) => Array.isArray(row) && row.length === n && ok(row));

/** Грубая проверка формы после decodeBinary: поля есть и нужных типов (game.match.units — массив). */
export function isSnapshot(x: unknown): x is SnapshotMsg {
  if (!isObject(x) || !Number.isSafeInteger(x.tick)) return false;
  const g = x.game;
  if (!isObject(g) || typeof g.phase !== "string" || !PHASES.includes(g.phase)) return false;
  if (!isNumber(g.phaseEnd) || typeof g.suddenDeath !== "boolean" || !isNumber(g.scoreLimit) || !isNumber(g.nextMageId) || !Array.isArray(g.results)) return false;
  const m = g.match;
  if (!isObject(m) || m.tick !== x.tick || !isNumber(m.nextId)) return false;
  if (!Array.isArray(m.units) || !Array.isArray(m.projectiles) || !Array.isArray(m.zones) || !Array.isArray(m.terrain)) return false;
  if (!m.units.every((u) => isObject(u) && isNumber(u.id))) return false;
  return (
    isRows(x.acks, 2, (r) => r.every(isNumber)) &&
    isRows(x.looks, 5, (r) => r.every(isNumber)) &&
    isRows(x.roster, 3, (r) => isNumber(r[0]) && typeof r[1] === "string" && isNumber(r[2])) &&
    isRows(x.events, 2, (r) => isNumber(r[0]) && isObject(r[1]) && typeof r[1].type === "string")
  );
}
