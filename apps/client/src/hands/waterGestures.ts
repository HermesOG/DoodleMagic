import { O, both, type GestureDef } from "./gestureKeys";

/** Заглушка до задачи 6: обе руки вперёд за 0,1 с и назад в покой к 0,3 с. */
const stub: GestureDef = { durS: 0.3, hand: "both", keys: [both(0, O), both(0.1, [0, 0, -0.1, -0.15]), both(0.3, O)] };

/** Жесты Воды. Задача 6 правит только этот файл. */
export const WATER_GESTURES: Readonly<Record<"waterWhip" | "waterGrab" | "waterWard" | "spring", GestureDef>> = {
  waterWhip: stub,
  waterGrab: stub,
  waterWard: stub,
  spring: stub,
};
