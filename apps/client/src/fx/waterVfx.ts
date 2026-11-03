import type { ElementVfx, ElementVfxFactory } from "./elementVfx";

/**
 * Эффекты Воды: диск Отражения, струя буксира, Родник, облака пара. Заглушка до задачи 6: своих мешей нет,
 * ничего не рисует. Задача 6 правит только этот файл.
 */
export const createWaterVfx: ElementVfxFactory = (): ElementVfx => ({
  world: null,
  light: null,
  sync() {},
  dispose() {},
});
