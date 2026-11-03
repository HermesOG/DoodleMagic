import type { KitWidget, KitWidgetFactory } from "./kitWidgets";

/**
 * Виджет Воды в ките: диск Отражения и впитанное. Заглушка до задачи 6: ничего не рисует.
 * Задача 6 правит только этот файл.
 */
export const createWaterWidget: KitWidgetFactory = (): KitWidget => ({
  update() {},
  dispose() {},
});
