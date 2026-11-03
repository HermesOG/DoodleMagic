import type { MoveParams, PlayerInput } from "../types";
import type { Kit } from "./kit";
import type { SweepHit } from "./projectiles";
import type { Element, MatchState, Projectile, ProjectileKind, TickCtx, Unit, Zone, ZoneKind } from "./types";

/**
 * Хуки стихий (фаза 4): стихия в sim — кит плюс хуки движения, шаги своих зон и попадания своих снарядов.
 * stepMatch сводит их один раз (SIM_HOOKS в elements.ts) и передаёт в moveUnits, stepProjectiles и stepZones.
 * Хуки меняют состояние на месте, как киты, и пишут события в t.ev.
 */

/** Движение мага стихии. Порядок в moveUnits: before → params → stepPlayer → after → канал толчка. */
export interface MoveHooks {
  /** До stepPlayer; inp уже без шагов и прыжка под обездвиживанием и «В воздухе». Может менять u.move (второй прыжок). */
  before?(u: Unit, t: TickCtx, inp: PlayerInput): void;
  /** Параметры движения на тик: на входе — бег стихии с замедлением и K1. */
  params?(u: Unit, t: TickCtx, inp: PlayerInput, p: MoveParams): MoveParams;
  /** После stepPlayer: сброс на полу, флаги, события. */
  after?(u: Unit, t: TickCtx, inp: PlayerInput): void;
}
/** Шаг своей зоны после взвода (общий шаг уже снял ушедшие и послал zone/arm). */
export type ZoneStep = (s: MatchState, t: TickCtx, z: Zone) => void;
/** Попадание своего снаряда в юнит, рельеф или мир; событие impact уже записано. */
export type ProjectileHit = (s: MatchState, t: TickCtx, p: Projectile, hit: SweepHit) => void;
export interface ElementSim {
  readonly kit: Kit;
  readonly move?: MoveHooks;
  readonly zones?: Readonly<Partial<Record<ZoneKind, ZoneStep>>>;
  readonly projectileHit?: Readonly<Partial<Record<ProjectileKind, ProjectileHit>>>;
}
export interface SimHooks {
  readonly move: Readonly<Partial<Record<Element, MoveHooks>>>;
  readonly zones: Readonly<Partial<Record<ZoneKind, ZoneStep>>>;
  readonly projectileHit: Readonly<Partial<Record<ProjectileKind, ProjectileHit>>>;
}
export const NO_HOOKS: SimHooks = Object.freeze({ move: Object.freeze({}), zones: Object.freeze({}), projectileHit: Object.freeze({}) });

/** Сводит хуки стихий; вид зоны или снаряда у двух стихий — ошибка. Результат заморожен. */
export function mergeHooks(sims: Readonly<Record<Element, ElementSim>>): SimHooks {
  const move: Partial<Record<Element, MoveHooks>> = {};
  const zones: Partial<Record<ZoneKind, ZoneStep>> = {};
  const projectileHit: Partial<Record<ProjectileKind, ProjectileHit>> = {};
  for (const el of Object.keys(sims) as Element[]) {
    const sim = sims[el];
    if (sim.move) move[el] = sim.move;
    for (const [kind, step] of Object.entries(sim.zones ?? {}) as [ZoneKind, ZoneStep][]) {
      if (zones[kind]) throw new Error(`mergeHooks: зона «${kind}» уже есть у другой стихии`);
      zones[kind] = step;
    }
    for (const [kind, hit] of Object.entries(sim.projectileHit ?? {}) as [ProjectileKind, ProjectileHit][]) {
      if (projectileHit[kind]) throw new Error(`mergeHooks: снаряд «${kind}» уже есть у другой стихии`);
      projectileHit[kind] = hit;
    }
  }
  return Object.freeze({ move: Object.freeze(move), zones: Object.freeze(zones), projectileHit: Object.freeze(projectileHit) });
}
