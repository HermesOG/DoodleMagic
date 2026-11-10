import { describe, expect, it } from "vitest";
import { applyHit } from "./combat";
import { FIRE, MATCH, STREAK, ticks } from "./defs";
import { testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { NO_MATCH_INPUT, createDummyUnit, createMageUnit, createMatchState } from "./state";
import { NOBODY, type AbilityId, type Element, type MatchEvent, type MatchState, type TickCtx, type Unit, type UnitId } from "./types";
import { stepLife } from "./units";

/** Добыча и серии (Р1, Р4 фазы 9): очко — убийство или засчитанный сброс. */
const ctx = testContext();
const tickOf = (now: number, ev: MatchEvent[]): TickCtx => ({ world: ctx.world, terrainIds: [], killBelowY: ctx.killBelowY, now, ev, spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0, ultChargeMul: 1 });
const mage = (id: UnitId, el: Element = "fire", x = -30): Unit => createMageUnit(id, el, { pos: { x, y: 0, z: -30 }, yaw: 0 });
const dummy = (id: UnitId, x: number): Unit => createDummyUnit(id, { pos: { x, y: 0, z: 0 }, yaw: 0 });
const byId = (s: MatchState, id: UnitId): Unit => s.units.find((u) => u.id === id)!;
const stats = (s: MatchState, id: UnitId) => byId(s, id).mage!.stats;
/** Удар с запасом: target погибает на тике now. */
function kill(s: MatchState, ev: MatchEvent[], source: UnitId, target: UnitId, now = s.tick, ability: AbilityId = "fireball"): void {
  applyHit(s, tickOf(now, ev), { source, target, ability, damage: 999, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 1 } });
}
const loots = (ev: MatchEvent[]) => ev.flatMap((e) => (e.type === "loot" ? [[e.unit, e.victim, e.amount]] : []));
const streaks = (ev: MatchEvent[]) => ev.flatMap((e) => (e.type === "streak" ? [e] : []));
const scoreEvents = (ev: MatchEvent[]) => ev.filter((e) => ["death", "fall", "courage", "loot", "streak"].includes(e.type)).map((e) => e.type);

describe("loot (Р1 фазы 9)", () => {
  it("a kill heals the living killer by 30 up to the max: loot with the real amount, none at full HP", () => {
    const s = createMatchState([mage(1), dummy(2, -10), dummy(3, -5), dummy(4, 0)]);
    const m = byId(s, 1);
    m.hp = 100;
    const ev: MatchEvent[] = [];
    kill(s, ev, 1, 2);
    expect(m.hp).toBe(100 + MATCH.lootHp);
    m.hp = 140;
    kill(s, ev, 1, 3);
    expect(m.hp).toBe(FIRE.hp);
    kill(s, ev, 1, 4);
    expect([m.hp, loots(ev)]).toEqual([FIRE.hp, [[1, 2, 30], [1, 3, 10]]]);
    const p = m.move.body.pos;
    expect(ev.find((e) => e.type === "loot")).toEqual({ type: "loot", unit: 1, victim: 2, amount: 30, pos: { x: p.x, y: p.y + m.move.body.height / 2, z: p.z } });
  });

  it("events of a kill go death → courage → loot → streak", () => {
    const s = createMatchState([mage(1), dummy(2, -10)]);
    byId(s, 1).hp = 50;
    const ev: MatchEvent[] = [];
    kill(s, ev, 1, 2);
    expect(scoreEvents(ev)).toEqual(["death", "courage", "loot", "streak"]);
  });

  it("an ultimate killing three in one tick: +30 for each up to the max, multi 1, 2, 3", () => {
    const s = createMatchState([mage(1), dummy(2, -10), dummy(3, -5), dummy(4, 0)]);
    byId(s, 1).hp = 60;
    const ev: MatchEvent[] = [];
    for (const target of [2, 3, 4]) kill(s, ev, 1, target, 100, "dragonBreath");
    expect([byId(s, 1).hp, loots(ev).map(([, , a]) => a)]).toEqual([FIRE.hp, [30, 30, 30]]);
    expect(streaks(ev).map((e) => [e.multi, e.streak])).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it("a killer who died earlier in the tick gets no loot but still scores", () => {
    const s = createMatchState([mage(1), mage(2, "earth", -20), dummy(3, -10)]);
    const ev: MatchEvent[] = [];
    kill(s, ev, 2, 1, 100); // маг 2 с полным HP: добычи нет
    kill(s, ev, 1, 3, 100); // снаряд мёртвого мага 1 ещё летел
    expect([loots(ev), byId(s, 1).alive, stats(s, 1).kills]).toEqual([[], false, 1]);
    expect(streaks(ev)).toEqual([
      { type: "streak", unit: 2, multi: 1, streak: 1, broke: NOBODY, brokeStreak: 0 },
      { type: "streak", unit: 1, multi: 1, streak: 1, broke: NOBODY, brokeStreak: 0 },
    ]);
  });
});

describe("streaks (Р4 фазы 9)", () => {
  it("fresh stats: no streak, no multi, no score yet", () => {
    expect(stats(createMatchState([mage(1)]), 1)).toEqual({ damage: 0, kills: 0, falls: 0, deaths: 0, streak: 0, multi: 0, lastScoreTick: -1 });
  });

  it("multi: ×2 within the 4 s window, ×1 after 4.1 s", () => {
    for (const [gap, multi] of [[ticks(STREAK.multiWindowS), 2], [ticks(4.1), 1]] as const) {
      const s = createMatchState([mage(1), dummy(2, -10), dummy(3, -5)]);
      const ev: MatchEvent[] = [];
      kill(s, ev, 1, 2, 100);
      kill(s, ev, 1, 3, 100 + gap);
      expect(streaks(ev).map((e) => [e.multi, e.streak])).toEqual([[1, 1], [multi, 2]]);
      expect(stats(s, 1)).toMatchObject({ streak: 2, multi, lastScoreTick: 100 + gap });
    }
  });

  it("a streak of 3 ends with the mage's death; the next score starts over at 1 and 1", () => {
    const s = createMatchState([mage(1), mage(2, "earth", -20), dummy(3, -10), dummy(4, -5), dummy(5, 0), dummy(6, 5)]);
    const ev: MatchEvent[] = [];
    for (const d of [3, 4, 5]) kill(s, ev, 1, d, 100);
    expect(stats(s, 1)).toMatchObject({ streak: 3, multi: 3, lastScoreTick: 100 });
    kill(s, ev, 2, 1, 110);
    expect(stats(s, 1)).toMatchObject({ streak: 0, multi: 0, lastScoreTick: -1, deaths: 1 });
    expect(streaks(ev).at(-1)).toEqual({ type: "streak", unit: 2, multi: 1, streak: 1, broke: 1, brokeStreak: 3 });
    kill(s, ev, 1, 6, 120); // в окне 4 с от прошлого очка, но после смерти — снова ×1
    expect(streaks(ev).at(-1)).toMatchObject({ unit: 1, multi: 1, streak: 1 });
  });

  it("broke: the victim with a streak of 3 or more, NOBODY at 2", () => {
    for (const [before, broke] of [[3, 2], [2, NOBODY]] as const) {
      const s = createMatchState([mage(1), mage(2, "earth", -20)]);
      Object.assign(stats(s, 2), { streak: before, multi: 1, lastScoreTick: 50 });
      const ev: MatchEvent[] = [];
      kill(s, ev, 1, 2, 100);
      expect(streaks(ev)).toEqual([{ type: "streak", unit: 1, multi: 1, streak: 1, broke, brokeStreak: broke === NOBODY ? 0 : before }]);
      expect(stats(s, 2)).toMatchObject({ streak: 0, multi: 0, lastScoreTick: -1, deaths: 1 });
    }
  });

  it("a credited fall gives loot and a streak; falling on your own gives neither and ends your streak", () => {
    const s = createMatchState([mage(1), dummy(2, -10), mage(3, "earth", -20)]);
    byId(s, 1).hp = 100;
    const d = byId(s, 2);
    Object.assign(d, { lastHitBy: 1, lastHitTick: 95 });
    d.move.body.pos = { x: 25, y: -5, z: 0 };
    const m3 = byId(s, 3);
    Object.assign(stats(s, 3), { streak: 4, multi: 2, lastScoreTick: 90 });
    Object.assign(m3, { lastHitBy: 3, lastHitTick: 95 }); // самосброс
    m3.move.body.pos = { x: 25, y: -5, z: 5 };
    const ev: MatchEvent[] = [];
    stepLife(s, tickOf(100, ev));
    expect(scoreEvents(ev)).toEqual(["fall", "courage", "loot", "streak", "fall"]);
    expect([byId(s, 1).hp, loots(ev), streaks(ev)]).toEqual([130, [[1, 2, 30]], [{ type: "streak", unit: 1, multi: 1, streak: 1, broke: NOBODY, brokeStreak: 0 }]]);
    expect([stats(s, 1).falls, stats(s, 3)]).toEqual([1, { damage: 0, kills: 0, falls: 0, deaths: 1, streak: 0, multi: 0, lastScoreTick: -1 }]);
  });

  it("is deterministic: two runs of fists into dummies give byte-identical states and events", () => {
    const run = () => {
      let s = createMatch({ mages: [{ element: "fire", spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 } }], dummies: [{ pos: { x: 0, y: 0, z: -8 }, yaw: 0 }, { pos: { x: 0.5, y: 0, z: -12 }, yaw: 0 }] });
      s.units[0]!.hp = 60;
      const events: MatchEvent[] = [];
      for (let k = 0; k < 1200; k++) {
        const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, primary: true } }, ctx);
        s = r.state;
        events.push(...r.events);
      }
      return { s, events };
    };
    const [a, b] = [run(), run()];
    expect([JSON.stringify(a.s) === JSON.stringify(b.s), JSON.stringify(a.events) === JSON.stringify(b.events)]).toEqual([true, true]);
    expect([a.events.some((e) => e.type === "loot"), a.events.some((e) => e.type === "streak")]).toEqual([true, true]);
  });
});
