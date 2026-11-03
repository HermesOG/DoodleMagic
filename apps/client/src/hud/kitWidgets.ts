import type { Element, Unit } from "@doodlemagic/sim";
import { createAirWidget } from "./airHud";
import { createWaterWidget } from "./waterHud";

/** Свой виджет стихии в ките HUD (заряды Взмаха, запас парения, впитанное Отражением…). */
export interface KitWidget {
  update(me: Unit, now: number, nowS: number): void;
  dispose(): void;
}
/** Создаёт виджет внутри .ch-kit. */
export type KitWidgetFactory = (kitRoot: HTMLElement) => KitWidget;

/** Виджеты стихий фазы 4; у Огня (жар) и Земли своё — в combatHud.ts. */
export const KIT_WIDGETS: Readonly<Partial<Record<Element, KitWidgetFactory>>> = { air: createAirWidget, water: createWaterWidget };
