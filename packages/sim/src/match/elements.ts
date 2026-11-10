import { AIR_SIM } from "./air";
import { EARTH_SIM } from "./earth";
import { FIRE_SIM } from "./fire";
import { mergeHooks, type ElementSim, type SimHooks } from "./hooks";
import type { Element } from "./types";
import { WATER_SIM } from "./water";

/**
 * Реестр стихий sim. Его импортирует только match.ts: стихии не импортируют match.ts, циклов нет.
 * Зоны и снаряды Огня и Земли фаз 2–4 шагает общий код; свои шаги (зоны ульт) они добавят в FIRE_SIM и EARTH_SIM.
 */
export const ELEMENT_SIM: Readonly<Record<Element, ElementSim>> = Object.freeze({
  fire: FIRE_SIM,
  earth: EARTH_SIM,
  air: AIR_SIM,
  water: WATER_SIM,
});
export const SIM_HOOKS: SimHooks = mergeHooks(ELEMENT_SIM);
