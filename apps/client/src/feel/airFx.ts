import type { MatchEvent, Unit } from "@doodlemagic/sim";
import type { Effect } from "./effects";
import type { FrameView } from "./elementFx";
import type { EventView } from "./eventMap";

/*
 * Ощущение Воздуха: события Воздуха → эффекты и покадровые зёрна (парение, гул Смерча). Заглушка до задачи 5:
 * ничего не берёт — всё идёт по общей карте. Задача 5 правит только этот файл.
 */

/** Событие Воздуха → эффекты; null — не Воздуха (дальше общая карта). */
export function airEffects(_ev: MatchEvent, _view: EventView, _me: Unit | undefined): Effect[] | null {
  return null;
}

/** Раз в кадр: непрерывные звуки и частицы Воздуха. */
export function airFrame(_f: FrameView): Effect[] {
  return [];
}
