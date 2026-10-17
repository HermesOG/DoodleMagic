import type { EffectKind } from "../feel/effects";

/** Кто в кадре полигона исполняет эффект ощущения. */
export type EffectSink = "hands" | "vfx" | "audio" | "camera" | "hitstop" | "hud";

/** Полная таблица: новый вид эффекта без своего исполнителя не соберётся (Record по EffectKind). */
const SINK: Readonly<Record<EffectKind, EffectSink>> = {
  gesture: "hands",
  burst: "vfx",
  palm: "vfx",
  flash: "vfx",
  flinch: "vfx",
  sound: "audio",
  trauma: "camera",
  kick: "camera",
  fov: "camera",
  hitstop: "hitstop",
  hitmarker: "hud",
  number: "hud",
  indicator: "hud",
  toast: "hud",
  deny: "hud",
};

/** Исполнитель эффекта: жесты рук, эффекты магии, звук, камера, визуальный hitstop или боевой HUD. */
export const sinkOf = (kind: EffectKind): EffectSink => SINK[kind];

/**
 * Страховка этапов кадра: исключение в эффектах, звуке, HUD или руках не останавливает цикл кадра —
 * симуляция и рендер идут дальше, этап вызывается и на следующем кадре. Первая ошибка этапа уходит в log,
 * повторные только считаются (иначе консоль тонет в 60 сообщениях в секунду).
 */
export interface Guard {
  /** fn(), а если она бросила — fallback. */
  run<T>(stage: string, fn: () => T, fallback: T): T;
  /** Сколько раз этап бросал. */
  failures(stage: string): number;
}

export function createGuard(log: (stage: string, err: unknown) => void = (stage, err) => console.error(`[полигон] сбой этапа «${stage}»:`, err)): Guard {
  const count = new Map<string, number>();
  return {
    run(stage, fn, fallback) {
      try {
        return fn();
      } catch (err) {
        const n = (count.get(stage) ?? 0) + 1;
        count.set(stage, n);
        if (n === 1) {
          try {
            log(stage, err);
          } catch {
            // без консоли — тоже живём
          }
        }
        return fallback;
      }
    },
    failures(stage) {
      return count.get(stage) ?? 0;
    },
  };
}
