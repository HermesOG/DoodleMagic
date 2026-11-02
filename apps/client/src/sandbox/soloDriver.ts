import { TICK_DT, respawnMage, stepMatch, unitById, type MatchContext, type MatchEvent, type MatchState, type UnitId } from "@doodlemagic/sim";
import type { Driver, TickOut } from "../game/driver";
import { advanceClock } from "./fixedStep";

/**
 * Драйвер одиночной игры (полигон): stepMatch с тиком 60 Гц прямо в кадре, по фиксированному шагу. Все события
 * тиков сразу подтверждены, «поздних» нет. Возрождение своего мага — prev = cur: камера не тянется через карту.
 */
export function createSoloDriver(ctx: MatchContext, initial: MatchState, localId: UnitId): Driver {
  let cur = initial;
  let prev = initial;
  let acc = 0;
  return {
    localId,
    advance(dtS, sample) {
      // после зависания advanceClock не догоняет: больше 5 тиков за кадр не делает
      const clock = advanceClock(acc, dtS, TICK_DT);
      acc = clock.acc;
      const ticks: TickOut[] = [];
      const confirmed: MatchEvent[] = [];
      /**
       * Свой маг возродился на тике этого кадра: остальные его тики смотрят, куда смотрит точка появления (pitch 0) —
       * вид поставит взгляд так же, но только после кадра.
       */
      let face: number | null = null;
      for (let k = 0; k < clock.ticks; k++) {
        const input = sample();
        // исключение симуляции не ловим здесь: кадр вида падает в fatal
        const r = stepMatch(cur, { [localId]: face === null ? input : { ...input, yaw: face, pitch: 0 } }, ctx);
        prev = cur;
        cur = r.state;
        for (const ev of r.events) {
          if (ev.type !== "respawn" || ev.target !== localId) continue;
          // следующий кадр — сразу на точке, без проводки от места падения
          prev = cur;
          face = ev.yaw;
        }
        ticks.push({ state: cur, events: r.events });
        confirmed.push(...r.events);
      }
      return { ticks, late: [], confirmed, prev, cur, alpha: clock.alpha };
    },
    /** Маг заново на своей точке выбранной стихией; счёт сохраняется, его снаряды, зоны и рельеф убраны. */
    chooseElement(e) {
      cur = respawnMage(cur, localId, e);
      prev = cur;
      const spawn = unitById(cur, localId)?.mage?.spawn;
      return spawn ? { pos: { ...spawn.pos }, yaw: spawn.yaw } : null;
    },
    dispose() {
      // нечего освобождать: ни таймеров, ни связи
    },
  };
}
