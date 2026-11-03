import type { KitWidget, KitWidgetFactory } from "./kitWidgets";

/**
 * Виджет Воздуха в ките: заряды Взмаха и запас парения. Заглушка до задачи 5: ничего не рисует.
 * Задача 5 правит только этот файл.
 */
export const createAirWidget: KitWidgetFactory = (): KitWidget => ({
  update() {},
  dispose() {},
});
