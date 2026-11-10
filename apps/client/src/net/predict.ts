import {
  createGame, stepGame,
  type GameState, type MatchContext, type MatchEvent, type MatchInput, type MatchState, type UnitId, type Vec3,
} from "@doodlemagic/sim";
import { INPUTS_PER_PACKET, packInput, type PackedInput, type SeqInput } from "./protocol";
import type { SnapshotMsg } from "./snapshot";

/**
 * Предсказание игрока (решения Н1, Н4, Н5). «Сейчас» — последний снапшот хоста плюс свой неподтверждённый ввод,
 * переигранный поверх. Чужие маги и в шаге, и в переигровке идут по своему последнему движению и взгляду из снапшота,
 * без прыжка и кнопок; снапшоты встали (step с othersStill) — стоят. Поправка после переигровки не дёргает картинку:
 * рендер сдвигается на гаснущий сдвиг.
 */

export const MAX_REPLAY = 90;          // тиков переигровки, старше — выбрасываются
export const DEDUP_WINDOW = 8;         // тиков: событие хоста совпало с предсказанным
export const LATE_FX_MAX_AGE = 60;     // тиков от предсказанного «сейчас» (без своего мага — от снапшота): старше — в эффекты не идёт (только в килфид)
export const SMOOTH_TAU_S = 0.1;
export const SMOOTH_SELF_TAU_S = 0.06;
export const SNAP_DIST_M = 3;
/** «Показанные» события старше тика снапшота на столько тиков забываются. */
const SHOWN_KEEP_TICKS = 120;
/** Потолок «показанных», если снапшоты перестали приходить: старые долой. */
const SHOWN_MAX = 1024;
/** Номера пришедших снапшотов помнятся столько тиков от последнего; снапшот старше — считается уже пришедшим. */
const SEEN_KEEP_TICKS = 600;
/** Сдвиг рендера короче — удаляется, м. */
const OFFSET_MIN_M = 0.001;
/**
 * Снапшотов нет дольше, мс по часам игрока, — хост, видимо, встал: чужие маги в предсказании стоят (взгляд прежний),
 * а не уходят по последнему движению. Как у хоста: тишина ввода больше 250 мс — маг стоит (Н2).
 */
export const OTHERS_STALL_MS = 250;

export interface Predictor {
  readonly localId: UnitId;
  /** Пришёл снапшот, в котором есть свой маг. До этого step ничего не делает. */
  readonly ready: boolean;
  readonly cur: GameState;
  readonly prev: GameState;
  readonly confirmed: GameState | null;
  readonly roster: readonly [UnitId, string, number][];
  /**
   * Новый тик: ввод → seq, шаг предсказания. События нового тика и пакет отправки (последние INPUTS_PER_PACKET вводов).
   * Тик, который уже шагали («сейчас» откатилось после обрезки хвоста у хоста), не повторяет показанные на нём события.
   * othersStill — снапшотов давно нет (решает вызывающий по своим часам, OTHERS_STALL_MS): чужие маги на этом тике
   * стоят, взгляд — из снапшота. Переигровка на новом снапшоте ведёт их как обычно.
   */
  step(input: MatchInput, othersStill?: boolean): { events: MatchEvent[]; packet: PackedInput[] };
  /** Снапшот хоста: новее прежнего — перебазировать и переиграть; события — один раз на снапшот. То же, что applySnapshots([s]). */
  applySnapshot(s: SnapshotMsg): { late: MatchEvent[]; confirmed: MatchEvent[] };
  /**
   * Пачка снапшотов (пришли за один кадр): события каждого нового — один раз, по возрастанию тика; перебазирование и
   * переигровка — один раз, на самый новый, если он новее прежнего.
   */
  applySnapshots(list: readonly SnapshotMsg[]): { late: MatchEvent[]; confirmed: MatchEvent[] };
  /** Сглаживающие сдвиги рендера: гаснут на dtS и возвращаются по id юнита. */
  offsets(dtS: number): ReadonlyMap<UnitId, Vec3>;
}

/** Точка до 0,1 м: точки появления различаются на метры, а округление снапшота — на микроны. */
const dm = (v: number): number => Math.round(v * 10);

/** Ключ события для сверки с хостом: вид и участники без координат и id снарядов. Возрождение — с точкой до 0,1 м. */
export function eventKey(ev: MatchEvent): string {
  switch (ev.type) {
    case "cast":
      return `cast:${ev.unit}:${ev.ability}:${ev.slot}`;
    case "release":
      return `release:${ev.unit}:${ev.ability}`;
    case "reject":
      return `reject:${ev.unit}:${ev.slot}:${ev.reason}`;
    case "impact":
      // во что: юнит, рельеф (его id, как и id снаряда, у хоста и предсказания могут разойтись) или статичный мир
      return `impact:${ev.owner}:${ev.ability}:${ev.target}:${ev.terrain >= 0 ? "terrain" : "world"}`;
    case "explosion":
      return `explosion:${ev.owner}:${ev.ability}`;
    case "hit":
      return `hit:${ev.source}:${ev.target}:${ev.ability}`;
    case "status":
      return `status:${ev.source}:${ev.target}:${ev.status}`;
    case "zone":
      return `zone:${ev.owner}:${ev.kind}:${ev.phase}`;
    case "terrain":
      return `terrain:${ev.owner}:${ev.kind}:${ev.phase}`;
    case "dash":
      return `dash:${ev.unit}:${ev.ability}:${ev.phase}`;
    case "overheat":
      return `overheat:${ev.unit}:${ev.on}`;
    case "courage":
      return `courage:${ev.unit}`;
    case "death":
      return `death:${ev.killer}:${ev.target}:${ev.ability}`;
    case "fall":
      return `fall:${ev.credit}:${ev.target}`;
    case "respawn":
      return `respawn:${ev.target}:${dm(ev.pos.x)}:${dm(ev.pos.y)}:${dm(ev.pos.z)}`;
    case "beam":
      return `beam:${ev.unit}:${ev.ability}`;
    case "blown":
      return `blown:${ev.unit}:${ev.kind}`;
    case "slam":
      return `slam:${ev.source}:${ev.target}`;
    case "airJump":
      return `airJump:${ev.unit}`;
    case "glide":
      return `glide:${ev.unit}:${ev.on}`;
    case "charge":
      return `charge:${ev.unit}:${ev.slot}:${ev.charges}`;
    case "absorb":
      return `absorb:${ev.unit}:${ev.kind}`;
    case "ward":
      return `ward:${ev.unit}:${ev.phase}`;
    case "tow":
      return `tow:${ev.source}:${ev.target}:${ev.phase}`;
    case "heal":
      return `heal:${ev.source}:${ev.target}`;
    case "reaction":
      return `reaction:${ev.owner}:${ev.kind}`;
    case "ult":
      return `ult:${ev.unit}:${ev.ability}:${ev.phase}`;
    case "pickup":
      return `pickup:${ev.kind}:${ev.index}:${ev.phase}:${ev.unit}`;
    case "fury":
      return `fury:${ev.unit}:${ev.phase}:${ev.by}`;
    case "loot":
      return `loot:${ev.unit}:${ev.victim}`;
    case "streak":
      return `streak:${ev.unit}:${ev.multi}:${ev.streak}`;
    default:
      return String((ev as { type: unknown }).type); // чужая версия хоста: вид без подробностей
  }
}

/** Копия состояния, где body.pos юнитов сдвинут на offsets (рендер; исходник не меняется). */
export function withOffsets(s: MatchState, offsets: ReadonlyMap<UnitId, Vec3>): MatchState {
  const units = s.units.map((u) => {
    const o = offsets.get(u.id);
    if (!o) return u;
    const p = u.move.body.pos;
    return { ...u, move: { ...u.move, body: { ...u.move.body, pos: { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z } } } };
  });
  return { ...s, units };
}

const length = (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

/**
 * Ввод чужого мага по looks снапшота: движение, взгляд и зажатый прыжок (парение Воздуха, Р16), без кнопок;
 * still — без движения.
 */
function lookInputs(s: SnapshotMsg, localId: UnitId, still = false): Partial<Record<UnitId, MatchInput>> {
  const out: Partial<Record<UnitId, MatchInput>> = {};
  for (const [id, moveX, moveZ, yaw, pitch, j] of s.looks) {
    if (id === localId) continue;
    out[id] = { moveX: still ? 0 : moveX, moveZ: still ? 0 : moveZ, yaw, pitch, jump: j === 1, primary: false, q: false, e: false, c: false, x: false };
  }
  return out;
}

/** Показанное предсказанием событие: тик (match.tick до шага) и ключ. */
interface Shown { tick: number; key: string }

export function createPredictor(ctx: MatchContext, localId: UnitId): Predictor {
  let ready = false;
  let cur: GameState = createGame();
  let prev = cur;
  let confirmed: GameState | null = null;
  let roster: readonly [UnitId, string, number][] = [];
  let seq = 0;
  /** Свой ввод, которого хост ещё не применил, по возрастанию seq. */
  let unacked: SeqInput[] = [];
  /** Ввод чужих магов из последнего снапшота; still — он же без движения (снапшоты встали). */
  let others: Partial<Record<UnitId, MatchInput>> = {};
  let still: Partial<Record<UnitId, MatchInput>> = {};
  /** Тик самого нового снапшота и номера всех пришедших (за SEEN_KEEP_TICKS). */
  let newest = -Infinity;
  const seen = new Set<number>();
  let shown: Shown[] = [];
  /** Самый поздний тик, который уже считал step. */
  let stepped = -Infinity;
  const offs = new Map<UnitId, Vec3>();

  function step(input: MatchInput, othersStill = false): { events: MatchEvent[]; packet: PackedInput[] } {
    if (!ready) return { events: [], packet: [] };
    seq += 1;
    unacked.push({ seq, input: { ...input } });
    if (unacked.length > MAX_REPLAY) unacked.splice(0, unacked.length - MAX_REPLAY);
    const tick = cur.match.tick;
    const r = stepGame(cur, { ...(othersStill ? still : others), [localId]: input }, ctx);
    prev = cur;
    cur = r.game;
    // Хост обрезал хвост ввода — «сейчас» откатилось, и тик считается второй раз. Его события, показанные в первый
    // раз (тот же ключ на том же тике, одно за одно), не повторяются: попадание, взрыв, фаза зоны, возрождение по таймеру.
    const again = tick <= stepped ? shown.filter((e) => e.tick === tick) : [];
    stepped = Math.max(stepped, tick);
    const events: MatchEvent[] = [];
    for (const e of r.events) {
      const key = eventKey(e);
      const k = again.findIndex((x) => x.key === key);
      if (k >= 0) {
        again.splice(k, 1);
        continue;
      }
      events.push(e);
      shown.push({ tick, key });
    }
    if (shown.length > SHOWN_MAX) shown.splice(0, shown.length - SHOWN_MAX);
    return { events, packet: unacked.slice(-INPUTS_PER_PACKET).map((it) => packInput(it.seq, it.input)) };
  }

  /**
   * События снапшота: все — в confirmed. В эффекты (late) — только не старше LATE_FX_MAX_AGE от now и не показанные
   * предсказанием: показанное с тем же ключом в ±DEDUP_WINDOW тиков (ближайшее) забирается из «показанных».
   */
  function sortEvents(s: SnapshotMsg, now: number, late: MatchEvent[], all: MatchEvent[]): void {
    for (const [tick, ev] of s.events) {
      all.push(ev);
      if (now - tick > LATE_FX_MAX_AGE) continue;
      const key = eventKey(ev);
      let best = -1;
      for (let k = 0; k < shown.length; k++) {
        const d = Math.abs(shown[k]!.tick - tick);
        if (shown[k]!.key === key && d <= DEDUP_WINDOW && (best < 0 || d < Math.abs(shown[best]!.tick - tick))) best = k;
      }
      if (best >= 0) shown.splice(best, 1);
      else late.push(ev);
    }
  }

  /** Перебазирование на снапшот новее прежнего: подтверждённое + переигровка своего неподтверждённого ввода. */
  function rebase(s: SnapshotMsg): void {
    confirmed = s.game;
    roster = s.roster;
    others = lookInputs(s, localId);
    still = lookInputs(s, localId, true);
    const ack = s.acks.find(([id]) => id === localId)?.[1];
    if (ack !== undefined) unacked = unacked.filter((it) => it.seq > ack);
    if (unacked.length > MAX_REPLAY) unacked = unacked.slice(-MAX_REPLAY);
    if (!s.game.match.units.some((u) => u.id === localId)) {
      ready = false;
      cur = prev = s.game;
      return;
    }
    ready = true;
    let g = s.game;
    let pg = s.game;
    for (const it of unacked) {
      pg = g;
      g = stepGame(g, { ...others, [localId]: it.input }, ctx).game; // события переигровки уже показаны или придут от хоста
    }
    prev = pg;
    cur = g;
  }

  /**
   * Сглаживание: юнитам, которые есть в старом и новом «сейчас», сдвиг += старая позиция − новая; длиннее SNAP_DIST_M
   * (возрождение, телепорт) — без сглаживания. Сдвиги юнитов, которых нет в обоих, забываются.
   */
  function smooth(before: MatchState, after: MatchState): void {
    const was = new Map<UnitId, Vec3>();
    for (const u of before.units) was.set(u.id, u.move.body.pos);
    const next: [UnitId, Vec3][] = [];
    for (const u of after.units) {
      const w = was.get(u.id);
      if (!w) continue;
      const o = offs.get(u.id) ?? { x: 0, y: 0, z: 0 };
      const p = u.move.body.pos;
      const d = { x: o.x + w.x - p.x, y: o.y + w.y - p.y, z: o.z + w.z - p.z };
      if (length(d) <= SNAP_DIST_M) next.push([u.id, d]);
    }
    offs.clear();
    for (const [id, d] of next) offs.set(id, d);
  }

  function applySnapshots(list: readonly SnapshotMsg[]): { late: MatchEvent[]; confirmed: MatchEvent[] } {
    // новые — ещё не приходили (и не старше окна памяти), каждый тик один раз, по возрастанию
    const fresh: SnapshotMsg[] = [];
    for (const s of [...list].sort((a, b) => a.tick - b.tick)) {
      if (seen.has(s.tick) || s.tick <= newest - SEEN_KEEP_TICKS) continue;
      seen.add(s.tick);
      fresh.push(s);
    }
    const top = fresh.at(-1);
    if (!top) return { late: [], confirmed: [] };
    if (top.tick > newest) {
      newest = top.tick;
      for (const t of seen) if (t <= newest - SEEN_KEEP_TICKS) seen.delete(t);
      const before = cur.match;
      rebase(top);
      smooth(before, cur.match);
    }
    // возраст события — от предсказанного «сейчас»: пачка снапшотов после заминки не играет секунды старых эффектов
    const now = ready ? Math.max(cur.match.tick, newest) : newest;
    const late: MatchEvent[] = [];
    const all: MatchEvent[] = [];
    for (const s of fresh) sortEvents(s, now, late, all);
    shown = shown.filter((e) => e.tick >= newest - SHOWN_KEEP_TICKS);
    return { late, confirmed: all };
  }

  function offsets(dtS: number): ReadonlyMap<UnitId, Vec3> {
    const dt = Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
    for (const [id, o] of offs) {
      const k = Math.exp(-dt / (id === localId ? SMOOTH_SELF_TAU_S : SMOOTH_TAU_S));
      const d = { x: o.x * k, y: o.y * k, z: o.z * k };
      if (length(d) < OFFSET_MIN_M) offs.delete(id);
      else offs.set(id, d);
    }
    return offs;
  }

  return {
    localId,
    get ready() {
      return ready;
    },
    get cur() {
      return cur;
    },
    get prev() {
      return prev;
    },
    get confirmed() {
      return confirmed;
    },
    get roster() {
      return roster;
    },
    step,
    applySnapshot: (s) => applySnapshots([s]),
    applySnapshots,
    offsets,
  };
}
