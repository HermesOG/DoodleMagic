import type { MatchEvent, MatchState, Unit, UnitId } from "@doodlemagic/sim";
import { airEffects, airFrame } from "./airFx";
import type { Effect } from "./effects";
import { ultFrame, type EventView } from "./eventMap";
import { waterEffects, waterFrame } from "./waterFx";

/** Кадр для непрерывных эффектов стихии: два последних тика, доля между ними, свой маг, часы кадра. */
export interface FrameView {
  prev: MatchState;
  cur: MatchState;
  alpha: number;
  localId: UnitId;
  nowS: number;
  dtS: number;
}
/** Событие своей стихии → эффекты; null — не моё (дальше общая карта). */
export type ElementEventFx = (ev: MatchEvent, view: EventView, me: Unit | undefined) => Effect[] | null;
/** Раз в кадр: непрерывные звуки и частицы стихии (зёрна парения, гул Смерча, журчание). */
export type ElementFrameFx = (f: FrameView) => Effect[];

/** Событие → эффекты стихий фазы 4: сначала Воздух, потом Вода; null — ни одна не взяла. */
export function elementEffects(ev: MatchEvent, view: EventView, me: Unit | undefined): Effect[] | null {
  return airEffects(ev, view, me) ?? waterEffects(ev, view, me);
}

/** Непрерывные эффекты стихий за кадр; ульты Огня и Земли (поток Дыхания) — из общей карты (ultFrame). */
export function elementFrameEffects(f: FrameView): Effect[] {
  const air = airFrame(f);
  const water = waterFrame(f);
  const ult = ultFrame(f);
  const both = air.length === 0 ? water : water.length === 0 ? air : [...air, ...water];
  return ult.length === 0 ? both : both.length === 0 ? ult : [...both, ...ult];
}
