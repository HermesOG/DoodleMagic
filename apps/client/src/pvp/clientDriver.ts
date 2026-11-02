import {
  TICK_DT, unitById,
  type Element, type MatchContext, type MatchEvent, type Unit, type UnitId, type Vec3,
} from "@doodlemagic/sim";
import type { Frame, TickOut } from "../game/driver";
import { decodeBinary } from "../net/codec";
import { openJoinLink, type JoinFailure, type JoinLink, type LagOptions } from "../net/link";
import { SNAP_DIST_M, createPredictor, withOffsets, type Predictor } from "../net/predict";
import { NET_VERSION, elementText, inputText, joinText, parseHostText, pingText } from "../net/protocol";
import { isSnapshot, type SnapshotMsg } from "../net/snapshot";
import { advanceClock } from "../sandbox/fixedStep";
import type { LinkState, PvpDriver } from "./hostDriver";

export type { LinkState, PvpDriver } from "./hostDriver";

/** Почему не вошли: хоста нет, канал не открылся, сигналинг молчит, комната полна, разные версии. */
export type JoinError = JoinFailure | "signalling" | "full" | "version";
/** Подключаюсь к хосту → канал открыт → вхожу (join ушёл). */
export type JoinStatus = "connecting" | "open" | "joining";

export interface ClientOptions {
  code: string;
  ctx: MatchContext;
  lag: LagOptions | null;
  onStatus(s: JoinStatus): void;
  onError(e: JoinError): void;
  /** Пришёл первый снапшот со своим магом: драйвер готов, можно монтировать вид. */
  onReady(d: PvpDriver): void;
  /** Канал был открыт и закрылся: хост ушёл или связь оборвалась. */
  onClosed(): void;
}

export interface ClientSession {
  /** «Войти»: join уходит сейчас или как только откроется канал. Повторно — ничего. */
  join(name: string, element: Element): void;
  dispose(): void;
}

const PING_EVERY_MS = 1000;
/** Сглаживание пинга по pong: доля нового замера. */
const RTT_BLEND = 0.2;
/** Снапшотов нет дольше — связь «stale». */
const STALE_MS = 3000;
/** Снапшотов в очереди кадра не больше (вкладка в фоне — кадров нет): старые выбрасываются. */
const MAX_PENDING_SNAPSHOTS = 60;
/** Точки появления различаются на метры: ближе этого, м, — та же точка (округление снапшота — микроны). */
const SAME_SPOT_M = 0.1;

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
type RespawnEvent = Extract<MatchEvent, { type: "respawn" }>;
type Mage = NonNullable<Unit["mage"]>;
/** Маг встал заново: другая точка появления (место или взгляд) или другая стихия. */
const replaced = (a: Mage, b: Mage): boolean =>
  a.element !== b.element || dist(a.spawn.pos, b.spawn.pos) > SAME_SPOT_M || Math.abs(a.spawn.yaw - b.spawn.yaw) > 1e-3;

/**
 * Игрок комнаты: канал к хосту (openJoinLink) открывается сразу, join — по «Войти». welcome → предсказатель; до вида
 * снапшоты применяются сразу, первый со своим магом — onReady. Дальше снапшоты копятся и применяются раз за кадр.
 */
export function connectClient(o: ClientOptions): ClientSession {
  let link: JoinLink | null = null;
  let open = false;
  let over = false;
  let joinMsg: string | null = null;
  let joinSent = false;
  let predictor: Predictor | null = null;
  let driver: (PvpDriver & { take(s: SnapshotMsg): void }) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let rtt = -1;
  let lastSnapAt = 0;

  const send = (text: string): void => link?.send(text);
  const flushJoin = (): void => {
    if (!open || !link || joinSent || joinMsg === null) return;
    joinSent = true;
    send(joinMsg);
    o.onStatus("joining");
  };
  const stop = (): void => {
    over = true;
    clearInterval(pingTimer);
    link?.close();
  };
  const fail = (e: JoinError): void => {
    if (over) return;
    stop();
    o.onError(e);
  };

  const onText = (raw: string): void => {
    const m = parseHostText(raw);
    if (!m) return;
    if (m.t === "deny") fail(m.reason);
    else if (m.t === "welcome") {
      if (m.v !== NET_VERSION) fail("version");
      else if (!predictor) {
        predictor = createPredictor(o.ctx, m.id);
        driver = createClientDriver(predictor);
        lastSnapAt = performance.now();
        pingTimer = setInterval(() => send(pingText(performance.now(), Math.round(rtt))), PING_EVERY_MS);
      }
    } else {
      const sample = performance.now() - m.ct;
      if (sample >= 0) rtt = rtt < 0 ? sample : rtt + (sample - rtt) * RTT_BLEND;
    }
  };
  const onBinary = (data: ArrayBuffer): void => {
    void decodeBinary(data).then((x) => {
      // снапшот до welcome (канал без порядка) не нужен: следующий придёт через 50 мс
      if (over || !driver || !isSnapshot(x)) return;
      lastSnapAt = performance.now();
      driver.take(x);
    });
  };

  openJoinLink(
    o.code,
    {
      onOpen() {
        open = true;
        o.onStatus("open");
        flushJoin();
      },
      onData: (data) => (typeof data === "string" ? onText(data) : onBinary(data)),
      onClose() {
        if (over) return;
        stop();
        o.onClosed();
      },
      onFail: fail,
    },
    o.lag,
  ).then(
    (l) => {
      if (over) l.close();
      else {
        link = l;
        flushJoin();
      }
    },
    () => fail("signalling"),
  );
  o.onStatus("connecting");

  /**
   * Драйвер вида поверх предсказателя. Кадр: сначала все снапшоты, пришедшие с прошлого кадра, одной пачкой (late и
   * confirmed — в кадр), затем тики по advanceClock — на тик predictor.step(ввод) и пакет ввода хосту; prev/cur — со
   * сглаживающими сдвигами.
   */
  function createClientDriver(p: Predictor): PvpDriver & { take(s: SnapshotMsg): void } {
    const id = p.localId;
    let mounted = false;
    let announced = false;
    let snaps: SnapshotMsg[] = [];
    let acc = 0;
    let rosterSeen: unknown = null;
    let names = new Map<UnitId, string>();
    let pings = new Map<UnitId, number>();
    const isOwnRespawn = (ev: MatchEvent): ev is RespawnEvent => ev.type === "respawn" && ev.target === id;
    const syncRoster = (): void => {
      if (p.roster === rosterSeen) return;
      rosterSeen = p.roster;
      names = new Map(p.roster.map(([uid, name]) => [uid, name]));
      pings = new Map(p.roster.map(([uid, , ping]) => [uid, ping]));
    };

    /**
     * Снапшоты одной пачкой; respawn — свой respawn среди поздних событий (последний: вид ставит взгляд на точку).
     * Запасной путь, когда хост поставил своего мага не туда, куда предсказание, а его respawn в эффекты не попал
     * (слишком старый при большом пинге; смена стихии в разминке идёт без события): своего мага сорвало больше чем на
     * SNAP_DIST_M (сглаживания нет) и это настоящая новая точка — у подтверждённого мага сменились точка появления или
     * стихия, либо в пачке есть свой respawn не на предсказанной точке. Тогда — свой respawn с этой точкой. Просто
     * большая поправка (отброс, рывок) взгляд не трогает.
     */
    function applySnaps(): { late: MatchEvent[]; confirmed: MatchEvent[]; respawn: RespawnEvent | null } {
      const list = snaps;
      snaps = [];
      if (list.length === 0) return { late: [], confirmed: [], respawn: null };
      const was = unitById(p.cur.match, id);
      const before = p.confirmed ? unitById(p.confirmed.match, id)?.mage : undefined;
      const r = p.applySnapshots(list);
      const respawn = r.late.filter(isOwnRespawn).at(-1) ?? null;
      if (respawn) return { ...r, respawn };
      const none = { ...r, respawn: null };
      const me = unitById(p.cur.match, id);
      if (!was || !me?.alive || !me.mage || dist(was.move.body.pos, me.move.body.pos) <= SNAP_DIST_M) return none;
      const after = p.confirmed ? unitById(p.confirmed.match, id)?.mage : undefined;
      const predicted = was.mage?.spawn.pos;
      const missed = r.confirmed.filter(isOwnRespawn).filter((ev) => !predicted || dist(ev.pos, predicted) > SAME_SPOT_M).at(-1);
      if (!missed && !(before && after && replaced(before, after))) return none;
      const own: RespawnEvent = missed
        ? { ...missed, pos: { ...missed.pos } }
        : { type: "respawn", target: id, pos: { ...me.mage.spawn.pos }, yaw: me.mage.spawn.yaw };
      return { late: [...r.late, own], confirmed: r.confirmed, respawn: own };
    }

    const d: PvpDriver & { take(s: SnapshotMsg): void } = {
      isHost: false,
      roomCode: o.code,
      localId: id,
      take(s) {
        if (mounted) {
          snaps.push(s);
          if (snaps.length > MAX_PENDING_SNAPSHOTS) snaps.splice(0, snaps.length - MAX_PENDING_SNAPSHOTS);
          return;
        }
        // вида ещё нет: события не нужны, ждём снапшот со своим магом
        p.applySnapshots([s]);
        if (p.ready && !announced) {
          announced = true;
          o.onReady(d);
        }
      },
      advance(dtS, sample): Frame {
        // кадр при запуске вида — только ради состояния: накопленное отдаст первый настоящий кадр
        if (!mounted) {
          mounted = true;
          return { ticks: [], late: [], confirmed: [], prev: p.prev.match, cur: p.cur.match, alpha: 0 };
        }
        // снапшоты — до тиков: тики кадра идут от самого нового подтверждённого
        const snap = applySnaps();
        /** Свой маг возродился (поздно от хоста или на тике кадра): тики смотрят, куда смотрит точка (pitch 0). */
        let face: number | null = snap.respawn?.yaw ?? null;
        const clock = advanceClock(acc, dtS, TICK_DT);
        acc = clock.acc;
        const ticks: TickOut[] = [];
        for (let k = 0; k < clock.ticks; k++) {
          const input = sample();
          const r = p.step(face === null ? input : { ...input, yaw: face, pitch: 0 });
          if (r.packet.length > 0) send(inputText(r.packet));
          ticks.push({ state: p.cur.match, events: r.events });
          for (const ev of r.events) if (isOwnRespawn(ev)) face = ev.yaw;
        }
        const offsets = p.offsets(dtS);
        const cur = withOffsets(p.cur.match, offsets);
        // возрождение своего — сразу на точке, без проводки камеры от места падения
        const prev = face !== null ? cur : withOffsets(p.prev.match, offsets);
        return { ticks, late: snap.late, confirmed: snap.confirmed, prev, cur, alpha: clock.alpha };
      },
      /** Запрос хосту; маг сменит стихию, когда хост её применит (снапшот). */
      chooseElement(e) {
        send(elementText(e));
        return null;
      },
      dispose: stop,
      game: () => p.cur,
      confirmedGame: () => p.confirmed ?? p.cur,
      names() {
        syncRoster();
        return names;
      },
      pings() {
        syncRoster();
        return pings;
      },
      ownPing: () => (rtt < 0 ? -1 : Math.round(rtt)),
      link(): LinkState {
        if (over) return "closed";
        return performance.now() - lastSnapAt > STALE_MS ? "stale" : "ok";
      },
      start() {
        // начинает матч только хост
      },
    };
    return d;
  }

  return {
    join(name, element) {
      if (joinMsg !== null || over) return;
      joinMsg = joinText(name, element);
      flushJoin();
    },
    dispose: stop,
  };
}
