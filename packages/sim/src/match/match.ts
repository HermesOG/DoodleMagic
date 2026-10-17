import { sanitizeInput } from "../player";
import type { ArenaData, Spawn } from "../types";
import { createWorld } from "../world";
import { stepStatuses } from "./combat";
import { buildTickWorld } from "./dynamic";
import { EARTH_KIT } from "./earth";
import { FIRE_KIT } from "./fire";
import type { Kit } from "./kit";
import { stepProjectiles } from "./projectiles";
import { clonePlain, createDummyUnit, createMageUnit, createMatchState, idleInput } from "./state";
import { stepTerrain } from "./terrain";
import type { Buttons, DummySpot, Element, MatchContext, MatchEvent, MatchInput, MatchState, MatchStep, TickCtx, UnitId } from "./types";
import { moveUnits, stepLife } from "./units";
import { stepZones } from "./zones";

/**
 * Шаг матча 60 Гц — чистая функция (состояние, ввод, контекст) → (состояние, события). Её же крутит хост сети.
 * Аргументы не меняются; одинаковые аргументы дают одинаковые до байта JSON состояния и событий.
 */

const KITS: Readonly<Record<Element, Kit>> = Object.freeze({ fire: FIRE_KIT, earth: EARTH_KIT });

/** Статика матча по арене: её мир и высота сброса (низ арены). */
export function matchContext(arena: ArenaData): MatchContext {
  return { world: createWorld(arena.colliders, arena.volumes), killBelowY: arena.bounds.min.y };
}

export interface MatchSetup {
  mages: { element: Element; spawn: Spawn }[];
  dummies: DummySpot[];
}

/** Новый матч: маги с id 1…M в порядке setup.mages, затем манекены. */
export function createMatch(setup: MatchSetup): MatchState {
  const mages = setup.mages.map((m, k) => createMageUnit(k + 1, m.element, m.spawn));
  const dummies = setup.dummies.map((d, k) => createDummyUnit(mages.length + k + 1, d));
  return createMatchState([...mages, ...dummies]);
}

/**
 * Один тик. Порядок фиксирован, на нём держится детерминизм: ввод китов (все маги по id) → тики китов → движение
 * юнитов → снаряды → зоны → рельеф → статусы → жизнь. Мир тика — статика с рельефом и стенами огня на начало тика.
 * Ввод очищается (sanitizeInput, кнопки — только ровно true); нажатие — переход false → true к прошлому тику.
 * Нет ввода от мага на этом тике — idleInput: стоит, кнопки отпущены, взгляд прежний (как в moveUnits).
 */
export function stepMatch(state: Readonly<MatchState>, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>, ctx: MatchContext): MatchStep {
  const s = clonePlain(state as MatchState);
  const ev: MatchEvent[] = [];
  const tw = buildTickWorld(ctx.world, s);
  const t: TickCtx = { world: tw.world, terrainIds: tw.terrainIds, killBelowY: ctx.killBelowY, now: s.tick, ev };
  const clean: Partial<Record<UnitId, MatchInput>> = {};
  for (const u of s.units) {
    const m = u.mage;
    if (!m) continue;
    const raw = inputs[u.id] ?? idleInput(u);
    const inp: MatchInput = { ...sanitizeInput(raw, u.move), primary: raw.primary === true, q: raw.q === true, e: raw.e === true, c: raw.c === true };
    const pressed: Buttons = { primary: inp.primary && !m.held.primary, q: inp.q && !m.held.q, e: inp.e && !m.held.e, c: inp.c && !m.held.c };
    clean[u.id] = inp;
    m.held = { primary: inp.primary, q: inp.q, e: inp.e, c: inp.c };
    if (u.alive) KITS[m.element].input(s, t, u, inp, pressed);
  }
  for (const u of s.units) if (u.mage && u.alive) KITS[u.mage.element].tick(s, t, u, clean[u.id]!);
  moveUnits(s, t, clean);
  stepProjectiles(s, t);
  stepZones(s, t);
  stepTerrain(s, t);
  stepStatuses(s, t);
  stepLife(s, t);
  s.tick += 1;
  return { state: s, events: ev };
}

/**
 * Возрождение мага другой стихией (экран выбора): копия состояния, маг — свежий на своей точке появления с прежним
 * счётом; его снаряды, зоны и рельеф убраны. Событий нет. Нет такого мага — копия без изменений.
 */
export function respawnMage(state: Readonly<MatchState>, id: UnitId, element: Element): MatchState {
  const s = clonePlain(state as MatchState);
  const k = s.units.findIndex((u) => u.id === id);
  const old = s.units[k];
  if (!old?.mage) return s;
  const fresh = createMageUnit(id, element, old.mage.spawn);
  fresh.mage!.stats = { ...old.mage.stats };
  s.units[k] = fresh;
  s.projectiles = s.projectiles.filter((p) => p.owner !== id);
  s.zones = s.zones.filter((z) => z.owner !== id);
  s.terrain = s.terrain.filter((tr) => tr.owner !== id);
  return s;
}
