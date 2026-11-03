import type { ElementVfx, ElementVfxFactory } from "./elementVfx";

/**
 * Эффекты Воздуха: диск Смерча, шлейф парения, кольца второго прыжка. Заглушка до задачи 5: своих мешей нет,
 * ничего не рисует. Задача 5 правит только этот файл.
 */
export const createAirVfx: ElementVfxFactory = (): ElementVfx => ({
  world: null,
  light: null,
  sync() {},
  dispose() {},
});
