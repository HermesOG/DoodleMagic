import { NOBODY, TICK_DT, unitById, type BotLevel, type Element, type MatchContext, type MatchEvent, type MatchState, type UnitId } from "@doodlemagic/sim";
import type { Frame, TickOut } from "../game/driver";
import { LOCAL_PEER, createHostCore, type BotInfo } from "../net/hostCore";
import type { PvpDriver } from "../pvp/hostDriver";
import { advanceClock } from "../sandbox/fixedStep";

/** Локальный хост «Боя с ботами»: драйвер PvP без сети. */
export interface LocalHost extends PvpDriver {
  /** Свой маг в бой; повторно — ничего. */
  enter(name: string, element: Element): void;
  addBot(element: Element, level: BotLevel): boolean;
  bots(): readonly BotInfo[];
  /** Пауза (Р14): тики не идут, бой стоит. */
  setPaused(on: boolean): void;
  readonly paused: boolean;
}

/**
 * «Бой с ботами» (Р14 фазы 8): ядро хоста (createHostCore) без сети, тики — в кадре по фиксированному шагу, как у
 * полигона (advanceClock, не больше 5 тиков за кадр). Все события сразу подтверждены. Возрождение своего мага — как у
 * хоста PvP: prev = cur и взгляд точки появления на оставшиеся тики кадра.
 */
export function createLocalHost(ctx: MatchContext, opts: { seed?: number } = {}): LocalHost {
  const core = createHostCore(ctx, opts);
  let localId: UnitId = NOBODY;
  let paused = false;
  let acc = 0;
  let alpha = 0;
  let prev: MatchState = core.game.match;
  let cur: MatchState = core.game.match;
  let names: ReadonlyMap<UnitId, string> | null = null;

  return {
    isHost: true,
    roomCode: "",
    get localId() {
      return localId;
    },
    get paused() {
      return paused;
    },
    enter(name, element) {
      if (localId !== NOBODY) return;
      const r = core.join(LOCAL_PEER, name, element, 0);
      if (!r.ok) return;
      localId = r.id;
      names = null;
      prev = cur = core.game.match;
    },
    addBot(element, level) {
      const r = core.addBot(element, level);
      names = null;
      prev = cur = core.game.match;
      return r.ok;
    },
    bots: () => core.bots(),
    setPaused(on) {
      paused = on;
    },
    advance(dtS, sample): Frame {
      const ticks: TickOut[] = [];
      const confirmed: MatchEvent[] = [];
      if (paused) return { ticks, late: [], confirmed, prev, cur, alpha };
      const clock = advanceClock(acc, dtS, TICK_DT);
      acc = clock.acc;
      alpha = clock.alpha;
      /** Свой маг возродился на тике этого кадра: остальные его тики смотрят, куда смотрит точка (pitch 0). */
      let face: number | null = null;
      for (let k = 0; k < clock.ticks; k++) {
        const s = localId === NOBODY ? null : sample();
        const r = core.tick(s && face !== null ? { ...s, yaw: face, pitch: 0 } : s, k);
        prev = cur;
        cur = core.game.match;
        for (const ev of r.step.events) {
          if (ev.type !== "respawn" || ev.target !== localId) continue;
          prev = cur;
          face = ev.yaw;
        }
        ticks.push({ state: cur, events: r.step.events });
        confirmed.push(...r.step.events);
      }
      return { ticks, late: [], confirmed, prev, cur, alpha };
    },
    /** Как у хоста PvP: живой маг вне боя встаёт заново на точку новой стихией; мёртвый — применится при возрождении. */
    chooseElement(e) {
      const was = unitById(core.game.match, localId);
      core.setElement(LOCAL_PEER, e);
      cur = core.game.match;
      const now = unitById(cur, localId);
      if (!was?.alive || !was.mage || was.mage.element === e || !now?.alive || now.mage?.element !== e) return null;
      prev = cur;
      return { pos: { ...now.mage.spawn.pos }, yaw: now.mage.spawn.yaw };
    },
    dispose() {
      // нечего освобождать: ни таймеров, ни связи
    },
    game: () => core.game,
    confirmedGame: () => core.game,
    names() {
      names ??= core.names();
      return names;
    },
    pings: () => core.pings(),
    ownPing: () => 0,
    link: () => "ok",
    start() {
      core.start();
    },
  };
}
