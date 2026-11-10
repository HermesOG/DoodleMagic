import { describe, expect, it } from "vitest";
import {
  BOT_LEVELS, BOT_PARAMS, ELEMENTS, EYE_HEIGHT, NOBODY, TICK_DT, addMage, botClaim, buildNav, buildTickWorld, canSee, claimsFor, createBot, createGame,
  pvpContext, stepBot, stepGame, unitById,
  type BotLevel, type BotState, type Element, type GameState, type MatchEvent, type MatchInput, type UnitId, type Vec3,
} from "@doodlemagic/sim";
import { buildGallery } from "./gallery";

/**
 * Фаза 8, задача 1: мозг бота на «Галерее над ущельем» — pvpContext, маги через addMage, ввод ботов — stepBot на каждом
 * тике, stepGame в разминке. Тесты с ареной — здесь: sim не зависит от arena.
 */
const arena = buildGallery("full");
const ctx = pvpContext(arena);
const nav = buildNav(ctx.world, ctx.killBelowY);
const DEG = Math.PI / 180;
/** Долгие бои: в одиночку — секунда-две, под общей нагрузкой прогона — до нескольких раз дольше. */
const LONG = 30_000;
/** Часы и вывод замеров: в lib ES2022 их типов нет, в Node они есть. */
const host = globalThis as unknown as { performance: { now(): number }; console: { log(...a: unknown[]): void } };
const clock = (): number => host.performance.now();
const report = (...a: unknown[]): void => host.console.log(...a);

interface Sim { g: GameState; bots: BotState[]; humans: UnitId[]; botMs: number; botTicks: number }
type Log = { t: number; e: MatchEvent }[];

/** Разминка с магами: стихии по порядку; at — поставить мага на точку (и повернуть). */
function game(mages: { element: Element; at?: Vec3; yaw?: number }[]): { g: GameState; ids: UnitId[] } {
  let g = createGame();
  const ids: UnitId[] = [];
  for (const m of mages) {
    const r = addMage(g, m.element, ctx);
    g = r.game;
    ids.push(r.id);
    const u = unitById(g.match, r.id)!;
    if (m.at) u.move.body.pos = { ...m.at };
    if (m.yaw !== undefined) u.move.yaw = m.yaw;
  }
  return { g, ids };
}

/**
 * Тик: боты думают по очереди по состоянию до шага (claims — по уже обновлённым состояниям ботов этого тика, как у
 * хоста), затем stepGame.
 */
function tick(sim: Sim, log?: Log, each?: (inputs: Partial<Record<UnitId, MatchInput>>, before: GameState) => void): MatchEvent[] {
  const inputs: Partial<Record<UnitId, MatchInput>> = {};
  const before = sim.g;
  const t0 = clock();
  const bots = [...sim.bots];
  for (let k = 0; k < bots.length; k++) {
    const b = bots[k]!;
    const r = stepBot(b, before.match, { nav, ctx, humans: sim.humans, claims: claimsFor(bots, b.id) });
    inputs[b.id] = r.input;
    bots[k] = r.bot;
  }
  sim.bots = bots;
  sim.botMs += clock() - t0;
  sim.botTicks += sim.bots.length;
  each?.(inputs, before);
  const st = stepGame(before, inputs, ctx);
  sim.g = st.game;
  if (log) for (const e of st.events) log.push({ t: before.match.tick, e });
  return st.events;
}

const sim = (g: GameState, bots: BotState[], humans: UnitId[] = []): Sim => ({ g, bots, humans, botMs: 0, botTicks: 0 });
const eyeOfUnit = (g: GameState, id: UnitId): Vec3 => {
  const p = unitById(g.match, id)!.move.body.pos;
  return { x: p.x, y: p.y + EYE_HEIGHT, z: p.z };
};
const sees = (g: GameState, a: UnitId, b: UnitId): boolean => canSee(buildTickWorld(ctx.world, g.match).world, eyeOfUnit(g, a), unitById(g.match, b)!);

describe("bot brain on the gallery", () => {
  it.each(ELEMENTS)("a Mage %s bot finds a standing mage 25 m away behind cover and kills it within 40 s", (element) => {
    const { g, ids } = game([{ element, at: { x: -10, y: 0, z: -8 }, yaw: Math.PI / 2 }, { element: "water", at: { x: 10, y: 0, z: 8 } }]);
    const [me, dummy] = ids as [UnitId, UnitId];
    expect(sees(g, me, dummy)).toBe(false);
    const s = sim(g, [createBot(me, "mage", 11)]);
    let killedAt = -1;
    for (let t = 0; t < 2400 && killedAt < 0; t++) {
      for (const e of tick(s)) if (e.type === "death" && e.target === dummy && e.killer === me) killedAt = s.g.match.tick;
    }
    report(`${element}: killed at ${(killedAt / 60).toFixed(1)} s`);
    expect(killedAt).toBeGreaterThan(0);
  }, LONG);

  it("never holds LMB without a line: the target ducks behind a wall", () => {
    // цель видна, бот её бьёт; затем цель переносится за стену кельи — в запаздывающем снимке она ещё «видна»
    const { g, ids } = game([{ element: "air", at: { x: 0, y: 0, z: -8 }, yaw: 0 }, { element: "water", at: { x: 0, y: 0, z: -13.5 } }]);
    const [me, target] = ids as [UnitId, UnitId];
    const s = sim(g, [createBot(me, "archmage", 3)]);
    let fired = 0;
    let closed = 0;
    for (let t = 0; t < 900; t++) {
      if (t === 600) {
        // в соседнюю келью: глухие стены 3 м и стелы между ней и ботом
        const u = unitById(s.g.match, target)!;
        u.move.body.pos = { x: -6.1, y: 0, z: -16.7 };
      }
      tick(s, undefined, (inputs, before) => {
        const open = sees(before, me, target);
        if (!open) closed++;
        if (inputs[me]!.primary) {
          fired++;
          expect(open, `tick ${before.match.tick}`).toBe(true);
        }
      });
    }
    expect(fired).toBeGreaterThan(10);
    expect(closed).toBeGreaterThan(200);
  }, LONG);

  it("turns no faster than its level allows: |Δyaw| per tick ≤ limit", () => {
    const { g, ids } = game(ELEMENTS.map((element) => ({ element })));
    const levels: BotLevel[] = ["novice", "mage", "archmage", "archmage"];
    const s = sim(g, ids.map((id, k) => createBot(id, levels[k]!, 40 + k)));
    let maxSeen = [0, 0, 0, 0];
    for (let t = 0; t < 1800; t++) {
      tick(s, undefined, (inputs, before) => {
        ids.forEach((id, k) => {
          const d = Math.abs(inputs[id]!.yaw - unitById(before.match, id)!.move.yaw);
          maxSeen[k] = Math.max(maxSeen[k]!, d);
          expect(d).toBeLessThanOrEqual(BOT_PARAMS[levels[k]!].turnDegS * DEG * TICK_DT + 1e-9);
        });
      });
    }
    report("max °/tick", maxSeen.map((d) => (d / DEG).toFixed(2)));
    // поворачивают по-настоящему: хоть раз близко к пределу
    ids.forEach((_, k) => expect(maxSeen[k]!).toBeGreaterThan(BOT_PARAMS[levels[k]!].turnDegS * DEG * TICK_DT * 0.8));
  }, LONG);

  it("does not hold LMB on a target under spawn protection", () => {
    const run = (shield: boolean): number => {
      const { g, ids } = game([{ element: "fire", at: { x: -6, y: 0, z: -10 }, yaw: -Math.PI / 2 }, { element: "earth", at: { x: 2, y: 0, z: -10 } }]);
      const [me, target] = ids as [UnitId, UnitId];
      const s = sim(g, [createBot(me, "archmage", 5)]);
      let fired = 0;
      for (let t = 0; t < 600; t++) {
        const u = unitById(s.g.match, target)!;
        u.status.shieldUntil = shield ? s.g.match.tick + 120 : 0;
        tick(s, undefined, (inputs) => {
          if (inputs[me]!.primary) fired++;
        });
      }
      return fired;
    };
    expect(run(true)).toBe(0);
    expect(run(false)).toBeGreaterThan(20);
  }, LONG);

  it("dodges Earth pillars cast under it: Archmage from ≥ 50 %, Novice from ≤ 40 %", () => {
    const escapes = (level: BotLevel): number => {
      let ok = 0;
      for (let seed = 0; seed < 20; seed++) {
        // бот стоит (пауза бродилки) посреди двора; хозяин столба далеко, в келье за стенами
        const { g, ids } = game([{ element: "fire", at: { x: -10, y: 0, z: -8 }, yaw: 0 }, { element: "earth", at: { x: 11.1, y: 0, z: 16.7 } }]);
        const [me, earth] = ids as [UnitId, UnitId];
        const b = createBot(me, level, 100 + seed);
        Object.assign(b, { goal: { x: -10, y: 0, z: -8 }, pauseUntil: 1e6, lookYaw: 0 });
        unitById(g.match, me)!.status.shieldUntil = 0;
        const s = sim(g, [b]);
        for (let t = 0; t < 30 + seed; t++) tick(s);
        // столб Земли под ботом: телеграф 0,6 с, удар по следу, раздутому на 0,4 м
        const m = s.g.match;
        const p = unitById(m, me)!.move.body.pos;
        m.zones.push({
          id: m.nextId++, owner: earth, kind: "pillar", ability: "stonePillar",
          shape: { type: "box", box: { min: { x: p.x - 0.6, y: p.y, z: p.z - 0.6 }, max: { x: p.x + 0.6, y: p.y + 2.5, z: p.z + 0.6 } } },
          bornTick: m.tick, armTick: m.tick + 36, endTick: m.tick + 37, rehit: [],
        });
        let hit = false;
        for (let t = 0; t < 45; t++) for (const e of tick(s)) if (e.type === "hit" && e.target === me && e.ability === "stonePillar") hit = true;
        if (!hit) ok++;
      }
      return ok;
    };
    const arch = escapes("archmage");
    const novice = escapes("novice");
    report(`pillar dodges: archmage ${arch}/20, novice ${novice}/20`);
    expect(arch).toBeGreaterThanOrEqual(10);
    expect(novice).toBeLessThanOrEqual(8);
  }, LONG);

  it("edge: 4 bots (one per element, levels in turn) fight 3 minutes — no uncredited falls, every bot lands hits", () => {
    const { g, ids } = game(ELEMENTS.map((element) => ({ element })));
    const s = sim(g, ids.map((id, k) => createBot(id, BOT_LEVELS[k % 3]!, 1234 + k)));
    const log: Log = [];
    for (let t = 0; t < 3 * 60 * 60; t++) tick(s, log);
    const falls = log.filter(({ e }) => e.type === "fall");
    const uncredited = falls.filter(({ e }) => e.type === "fall" && e.credit === NOBODY);
    const hits = ids.map((id) => log.filter(({ e }) => e.type === "hit" && e.source === id && !e.dot).length);
    const deaths = log.filter(({ e }) => e.type === "death").length;
    report(`3 min: hits ${hits.join("/")}, deaths ${deaths}, falls ${falls.length}, uncredited ${uncredited.length}, ${(s.botMs / s.botTicks).toFixed(4)} ms per bot-tick`);
    expect(uncredited).toEqual([]);
    for (const h of hits) expect(h).toBeGreaterThan(0);
  }, LONG);

  it("edge: 4 Mage bots start on the bridges and the rune platform and fight 60 s — no uncredited falls", () => {
    // кромка со всех сторон: мосты 3 м и площадка руны 4 × 4 м над ущельем
    const spots: Vec3[] = [{ x: 0, y: 0, z: -3.5 }, { x: 0, y: 0, z: 3.5 }, { x: 1, y: 0, z: 1 }, { x: -1, y: 0, z: -1 }];
    const { g, ids } = game(ELEMENTS.map((element, k) => ({ element, at: spots[k]!, yaw: k * 1.7 })));
    const s = sim(g, ids.map((id, k) => createBot(id, "mage", 4321 + k)));
    const log: Log = [];
    for (let t = 0; t < 60 * 60; t++) tick(s, log);
    const falls = log.filter(({ e }) => e.type === "fall");
    const uncredited = falls.filter(({ e }) => e.type === "fall" && e.credit === NOBODY);
    report(`bridges 60 s: falls ${falls.length}, uncredited ${uncredited.length}`);
    expect(uncredited).toEqual([]);
  }, LONG);

  it.each([["novice", 1], ["mage", 2]] as const)("quota: three %s bots and a human mid-yard — at most %i on the human, and a lonely human gets a bot", (level, quota) => {
    const { g, ids } = game([
      { element: "water", at: { x: -10, y: 0, z: -8 } },
      { element: "fire" }, { element: "earth" }, { element: "air" },
    ]);
    const [human, ...botIds] = ids as [UnitId, ...UnitId[]];
    const s = sim(g, botIds.map((id, k) => createBot(id, level, 77 + k)), [human]);
    let firstClaim = -1;
    let maxOn = 0;
    for (let t = 0; t < 40 * 60; t++) {
      tick(s);
      const on = s.bots.filter((b) => botClaim(b) === human).length;
      maxOn = Math.max(maxOn, on);
      expect(on, `tick ${t}`).toBeLessThanOrEqual(quota);
      if (on > 0 && firstClaim < 0) firstClaim = t;
    }
    report(`${level}: human first claimed at ${(firstClaim / 60).toFixed(1)} s, max ${maxOn}`);
    expect(firstClaim).toBeGreaterThanOrEqual(0);
    expect(firstClaim).toBeLessThan(20 * 60);
  }, LONG);

  it("thinks fast: 5 bots × 3600 ticks", () => {
    const { g, ids } = game([...ELEMENTS, "fire" as Element].map((element) => ({ element })));
    const s = sim(g, ids.map((id, k) => createBot(id, BOT_LEVELS[k % 3]!, 900 + k)));
    for (let t = 0; t < 3600; t++) tick(s);
    const ms = s.botMs / s.botTicks;
    report(`5 bots × 3600 ticks: ${ms.toFixed(4)} ms per bot-tick (budget 0.3)`);
    expect(ms).toBeLessThan(1);
  }, LONG);
});
