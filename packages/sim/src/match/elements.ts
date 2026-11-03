import { AIR_SIM } from "./air";
import { EARTH_KIT } from "./earth";
import { FIRE_KIT } from "./fire";
import { mergeHooks, type ElementSim, type SimHooks } from "./hooks";
import type { Element } from "./types";
import { WATER_SIM } from "./water";

/**
 * Реестр стихий sim. Его импортирует только match.ts: air.ts и water.ts не импортируют match.ts, циклов нет.
 * У Огня и Земли только кит: их зоны и снаряды шагает общий код.
 */
export const ELEMENT_SIM: Readonly<Record<Element, ElementSim>> = Object.freeze({
  fire: Object.freeze({ kit: FIRE_KIT }),
  earth: Object.freeze({ kit: EARTH_KIT }),
  air: AIR_SIM,
  water: WATER_SIM,
});
export const SIM_HOOKS: SimHooks = mergeHooks(ELEMENT_SIM);
