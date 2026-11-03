import type { MatchEvent, Unit } from "@doodlemagic/sim";
import type { Effect } from "./effects";
import type { FrameView } from "./elementFx";
import type { EventView } from "./eventMap";

/*
 * Ощущение Воды: события Воды → эффекты и покадровые зёрна (журчание Родника). Заглушка до задачи 6: ничего не
 * берёт — всё идёт по общей карте. Задача 6 правит только этот файл.
 */

/** Событие Воды → эффекты; null — не Воды (дальше общая карта). */
export function waterEffects(_ev: MatchEvent, _view: EventView, _me: Unit | undefined): Effect[] | null {
  return null;
}

/** Раз в кадр: непрерывные звуки и частицы Воды. */
export function waterFrame(_f: FrameView): Effect[] {
  return [];
}
