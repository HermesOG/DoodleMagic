import type { Element, GameState, MatchEvent, MatchInput, MatchState, UnitId, Vec3 } from "@doodlemagic/sim";
import { describe, expect, it } from "vitest";
import { quantize } from "./codec";
import { LOCAL_PEER, createHostCore, type HostCore } from "./hostCore";
import { createPredictor, eventKey, type Predictor } from "./predict";
import { inputText, parseClientMsg } from "./protocol";
import { isSnapshot, type SnapshotMsg } from "./snapshot";
import { input, testPvpContext } from "./testArena";

/**
 * Петля: хост и предсказатели в одном процессе, без PeerJS. Сообщения идут через очереди с задержкой в тиках в каждую
 * сторону. Ввод — текстом протокола (inputText → parseClientMsg), снапшот — как по сети: quantize и JSON туда-обратно.
 */

const ctx = testPvpContext();
const MS_PER_TICK = 1000 / 60;

interface ClientSpec {
  element?: Element;
  /** Ввод игрока на тике петли t. */
  script: (t: number) => MatchInput;
  /** Правка снапшота, пришедшего этому игроку (после сети). */
  tamper?: (s: SnapshotMsg, id: UnitId) => void;
  /** Пока true, пакеты игрока копятся; первый пакет после — уходит вместе со всеми накопленными (пачка у хоста). */
  hold?: (t: number) => boolean;
}

interface Client {
  peer: string;
  id: UnitId;
  pred: Predictor;
  spec: ClientSpec;
  up: { at: number; text: string }[];
  held: string[];
  down: { at: number; snap: SnapshotMsg }[];
  /** События из step: тик петли и тик матча, который считал шаг. */
  shown: { t: number; tick: number; e: MatchEvent }[];
  late: MatchEvent[];
  /** late с тиками хоста. */
  lateTicked: [number, MatchEvent][];
  confirmed: MatchEvent[];
  /** События снапшотов, которые предсказатель засчитал (confirmed не пуст), с тиками. */
  confirmedTicked: [number, MatchEvent][];
  /** Тик «сейчас» после каждого снапшота и каждого шага. */
  curTicks: number[];
  /** На каждый снапшот новее прежнего: тик петли, поправка своего мага (м), сдвиг «сейчас» в тиках, сдвиг рендера своего. */
  rebases: { t: number; correction: number; tickShift: number; offset: number }[];
  /** «Сейчас» своего мага сразу после перебазирования: тик матча и позиция. */
  predicted: { tick: number; pos: Vec3 }[];
}

interface LoopOptions {
  /** Задержка в тиках в каждую сторону. */
  delay: number;
  /** Ввод мага хоста; нет — у хоста мага нет. */
  host?: (t: number) => MatchInput | null;
  clients: ClientSpec[];
  /** Копии k-го снапшота (k от 0) — добавки к задержке каждой: снапшоты обгоняют друг друга и приходят дважды. */
  copies?: (k: number) => number[];
}

const posOf = (s: MatchState, id: UnitId): Vec3 | undefined => s.units.find((u) => u.id === id)?.move.body.pos;
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (v: Vec3 | undefined): number => (v ? Math.hypot(v.x, v.y, v.z) : 0);

function createLoop(opts: LoopOptions) {
  const host: HostCore = createHostCore(ctx);
  if (opts.host) host.join(LOCAL_PEER, "Хост", "fire", 0);
  const clients: Client[] = opts.clients.map((spec, k) => {
    const peer = `peer-${k}`;
    const r = host.join(peer, `Гость ${k}`, spec.element ?? "fire", 0);
    if (!r.ok) throw new Error("комната полна");
    return {
      peer, id: r.id, pred: createPredictor(ctx, r.id), spec, up: [], held: [], down: [], shown: [], late: [], lateTicked: [], confirmed: [], confirmedTicked: [],
      curTicks: [], rebases: [], predicted: [],
    };
  });
  /** Состояние хоста по тику матча и все его события с тиком. */
  const history = new Map<number, GameState>([[host.game.match.tick, host.game]]);
  const hostLog: [number, MatchEvent][] = [];
  let t = 0;
  let snapCount = 0;

  function deliverUp(c: Client, nowMs: number): void {
    while (c.up.length > 0 && c.up[0]!.at <= t) {
      const m = parseClientMsg(c.up.shift()!.text);
      if (m?.t === "in") host.inputs(c.peer, m.items, nowMs);
    }
  }

  function deliverDown(c: Client): void {
    const due = c.down.filter((d) => d.at <= t);
    c.down = c.down.filter((d) => d.at > t);
    for (const { snap } of due) {
      const before = c.pred.cur;
      const confirmedBefore = c.pred.confirmed;
      const r = c.pred.applySnapshot(snap);
      c.late.push(...r.late);
      for (const e of r.late) c.lateTicked.push([snap.events.find(([, x]) => x === e)![0], e]);
      c.confirmed.push(...r.confirmed);
      c.curTicks.push(c.pred.cur.match.tick);
      // снапшот засчитан целиком или никак
      expect(r.confirmed).toEqual(r.confirmed.length === 0 ? [] : snap.events.map(([, e]) => e));
      if (r.confirmed.length > 0) c.confirmedTicked.push(...snap.events);
      if (c.pred.confirmed === confirmedBefore || !c.pred.ready) continue; // старый снапшот или своего мага нет
      const was = posOf(before.match, c.id);
      const now = posOf(c.pred.cur.match, c.id)!;
      if (was) c.rebases.push({ t, correction: dist(was, now), tickShift: c.pred.cur.match.tick - before.match.tick, offset: len(c.pred.offsets(0).get(c.id)) });
      c.predicted.push({ tick: c.pred.cur.match.tick, pos: { ...now } });
    }
  }

  function tick(): void {
    const nowMs = t * MS_PER_TICK;
    for (const c of clients) deliverUp(c, nowMs);
    const before = host.game.match.tick;
    const r = host.tick(opts.host?.(t) ?? null, nowMs);
    for (const e of r.step.events) hostLog.push([before, e]);
    history.set(host.game.match.tick, host.game);
    if (r.snapshot) {
      const extras = opts.copies?.(snapCount++) ?? [0];
      for (const c of clients) {
        for (const extra of extras) {
          const wire: unknown = JSON.parse(JSON.stringify(quantize(r.snapshot)));
          if (!isSnapshot(wire)) throw new Error("снапшот не прошёл isSnapshot");
          c.spec.tamper?.(wire, c.id);
          c.down.push({ at: t + opts.delay + extra, snap: wire });
        }
      }
    }
    for (const c of clients) {
      deliverDown(c);
      c.pred.offsets(1 / 60);
      const tick = c.pred.cur.match.tick;
      const s = c.pred.step(c.spec.script(t));
      c.curTicks.push(c.pred.cur.match.tick);
      for (const e of s.events) c.shown.push({ t, tick, e });
      if (s.packet.length === 0) continue;
      c.held.push(inputText(s.packet));
      if (c.spec.hold?.(t)) continue;
      for (const text of c.held) c.up.push({ at: t + opts.delay, text });
      c.held = [];
    }
    t += 1;
  }

  return {
    host, clients, history, hostLog,
    run(n: number): void {
      for (let k = 0; k < n; k++) tick();
    },
  };
}

const isCast = (unit: UnitId) => (e: MatchEvent): boolean => e.type === "cast" && e.unit === unit;
const count = (list: readonly MatchEvent[], ok: (e: MatchEvent) => boolean): number => list.filter(ok).length;

/** Бег туда-обратно со стрейфом, поворотами и прыжками: со старта (10, 30) маг не уходит с пола. */
const runAndJump = (t: number): MatchInput =>
  input({
    moveZ: Math.sin(t / 25) > 0 ? 1 : -1,
    moveX: 0.6 * Math.cos(t / 37),
    yaw: 0.3 * Math.sin(t / 50),
    pitch: 0.2 * Math.sin(t / 30),
    jump: t % 45 < 3,
  });

describe("loopback: prediction against the host", () => {
  it("delay 0, steady input: after every snapshot the own mage matches the host at the same tick, no smoothing", () => {
    const loop = createLoop({ delay: 0, host: () => null, clients: [{ script: () => input({ moveZ: 1, moveX: 0.3, yaw: 0.4, pitch: 0.1 }) }] });
    loop.run(200);
    const c = loop.clients[0]!;
    const checked = c.predicted.filter((p) => loop.history.has(p.tick));
    expect(checked.length).toBeGreaterThan(55);
    for (const p of checked) expect(dist(p.pos, posOf(loop.history.get(p.tick)!.match, c.id)!)).toBeLessThan(1e-4);
    expect(c.rebases.length).toBeGreaterThan(55);
    for (const r of c.rebases) expect([r.tickShift, r.correction < 1e-4, r.offset < 1e-3]).toEqual([0, true, true]);
    // маг правда бежал
    expect(dist(c.predicted[0]!.pos, c.predicted.at(-1)!.pos)).toBeGreaterThan(15);
  });

  it("delay 6 ticks each way, running and jumping: in the steady state the own correction is under 1 cm", () => {
    const loop = createLoop({ delay: 6, host: (t) => input({ moveZ: Math.sin(t / 20) > 0 ? 1 : -1, yaw: 0.5 }), clients: [{ script: runAndJump }] });
    loop.run(300);
    const c = loop.clients[0]!;
    const steady = c.rebases.filter((r) => r.t >= 60);
    expect(steady.length).toBeGreaterThan(70);
    for (const r of steady) {
      expect(r.correction).toBeLessThan(0.01);
      expect(r.tickShift).toBe(0);
    }
    // предсказание правда впереди хоста на круг сети, а маг правда прыгал
    expect(c.pred.cur.match.tick - c.pred.confirmed!.match.tick).toBeGreaterThanOrEqual(12);
    const ys = c.predicted.map((p) => p.pos.y);
    expect(Math.max(...ys)).toBeGreaterThan(0.5);
    // и всё время совпадал с хостом своего тика
    for (const p of c.predicted.filter((q) => loop.history.has(q.tick) && q.tick > 80)) {
      expect(dist(p.pos, posOf(loop.history.get(p.tick)!.match, c.id)!)).toBeLessThan(1e-3);
    }
  });
});

describe("loopback: events", () => {
  it("own cast comes once from step and its host copy is not late; another player's cast is late once", () => {
    const press = (from: number) => (t: number) => input({ primary: t >= from && t < from + 5, yaw: Math.PI });
    const loop = createLoop({ delay: 6, host: () => null, clients: [{ script: press(60) }, { script: press(100) }] });
    loop.run(200);
    const [a, b] = loop.clients as [Client, Client];
    expect(count(loop.hostLog.map(([, e]) => e), isCast(a.id))).toBe(1);
    expect(count(loop.hostLog.map(([, e]) => e), isCast(b.id))).toBe(1);
    for (const [me, other] of [[a, b], [b, a]] as const) {
      expect(count(me.shown.map((s) => s.e), isCast(me.id))).toBe(1);
      expect(count(me.late, isCast(me.id))).toBe(0);
      expect(count(me.confirmed, isCast(me.id))).toBe(1);
      expect(me.late.filter((e) => (e.type === "cast" || e.type === "release") && e.unit === me.id)).toEqual([]);
      expect(count(me.shown.map((s) => s.e), isCast(other.id))).toBe(0);
      expect(count(me.late, isCast(other.id))).toBe(1);
      expect(count(me.confirmed, isCast(other.id))).toBe(1);
    }
  });

  it("snapshots overtaking each other and coming twice: state never goes back, each host event is confirmed once", () => {
    // каждый четвёртый снапшот задерживается на 5 тиков и приходит после следующего; каждый пятый приходит ещё раз
    const loop = createLoop({
      delay: 4,
      host: () => input({ primary: true, moveX: 1, yaw: 0.1 }),
      clients: [{ script: runAndJump }],
      copies: (k) => (k % 4 === 1 ? [5] : k % 5 === 2 ? [0, 7] : [0]),
    });
    loop.run(150);
    const c = loop.clients[0]!;
    // снапшоты с событиями до тика 138 отправлены не позже тика 137 и уже пришли все
    const cut = (list: [number, MatchEvent][]) => list.filter(([tick]) => tick < 138).map((x) => JSON.stringify(quantize(x))).sort();
    const sent = cut(loop.hostLog);
    expect(sent.length).toBeGreaterThan(15);
    expect(cut(c.confirmedTicked)).toEqual(sent);
    for (let k = 1; k < c.curTicks.length; k++) expect(c.curTicks[k]!).toBeGreaterThanOrEqual(c.curTicks[k - 1]!);
  });

  it("a burst of held inputs makes the host trim its queue: the prediction falls back, yet no event is shown twice", () => {
    const loop = createLoop({
      delay: 3,
      // маг хоста стоит и бьёт ЛКМ в пол перед собой: попадания идут по времени, их предсказывает и игрок
      host: () => input({ primary: true, yaw: Math.PI, pitch: -0.1 }),
      // 12 тиков пакеты игрока копятся (≈ 200 мс — хост повторяет последний ввод), потом пачкой из 13 приходят разом
      clients: [{ script: runAndJump, hold: (t) => t >= 100 && t < 112 }],
    });
    loop.run(220);
    const c = loop.clients[0]!;
    const back = c.curTicks.findIndex((x, k) => k > 0 && x < c.curTicks[k - 1]!);
    expect(back).toBeGreaterThan(0);
    expect(c.curTicks[back - 1]! - c.curTicks[back]!).toBeGreaterThanOrEqual(5); // откат на обрезку хвоста
    const emitted: [number, MatchEvent][] = [...c.shown.map((s): [number, MatchEvent] => [s.tick, s.e]), ...c.lateTicked];
    const ids = emitted.map(([tick, e]) => `${tick}|${eventKey(e)}`);
    expect(new Set(ids).size).toBe(ids.length);
    // попадания хоста в пол — каждое ровно один раз и на своём тике
    const impacts = (list: [number, MatchEvent][]) =>
      list.filter(([tick, e]) => e.type === "impact" && e.owner === 1 && tick >= 60 && tick < 180).map(([tick]) => tick).sort((a, b) => a - b);
    expect(impacts(loop.hostLog).length).toBeGreaterThan(5);
    expect(impacts(emitted)).toEqual(impacts(loop.hostLog));
  });

  it("own mage respawned at another point than predicted (enemy moved in the snapshot): late has the host's respawn", () => {
    const ENEMY = 1;
    const loop = createLoop({
      delay: 3,
      host: () => null, // маг хоста стоит на (−30, −30)
      clients: [{
        script: (t) => input({ moveZ: t < 150 ? 1 : 0, yaw: -Math.PI / 2 }), // на восток, в пропасть
        tamper: (s, id) => {
          const me = s.game.match.units.find((u) => u.id === id)!;
          const enemy = s.game.match.units.find((u) => u.id === ENEMY)!;
          if (!me.alive) enemy.move.body.pos = { x: 10, y: 0, z: 30 };
        },
      }],
    });
    loop.run(360);
    const c = loop.clients[0]!;
    const respawnOf = (e: MatchEvent) => e.type === "respawn" && e.target === c.id;
    const falls = c.shown.filter((s) => s.e.type === "fall" && s.e.target === c.id);
    expect(falls).toHaveLength(1);
    expect(c.late.filter((e) => e.type === "fall")).toEqual([]); // падение предсказано верно — не повторяется
    const predicted = c.shown.filter((s) => respawnOf(s.e)).map((s) => s.e);
    expect(predicted).toEqual([{ type: "respawn", target: c.id, pos: { x: -30, y: 0, z: -30 }, yaw: 0 }]);
    expect(c.late.filter(respawnOf)).toEqual([{ type: "respawn", target: c.id, pos: { x: 10, y: 0, z: 30 }, yaw: quantize(Math.PI) }]);
    // «сейчас» — у точки хоста, рывок через карту не сглаживается
    expect(dist(posOf(c.pred.cur.match, c.id)!, { x: 10, y: 0, z: 30 })).toBeLessThan(0.01);
    expect(c.pred.offsets(0).has(c.id)).toBe(false);
  });
});
