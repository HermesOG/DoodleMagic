import { describe, expect, it } from "vitest";
import { deepFreeze, testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { NO_MATCH_INPUT } from "./state";
import { ELEMENTS, type Element, type MatchEvent, type MatchInput, type MatchState } from "./types";

const ctx = testContext();
/** Ввод по номеру тика: бег, стрейф, прыжки, поворот, все кнопки. */
const script = (n: number): MatchInput => ({
  ...NO_MATCH_INPUT, moveZ: n % 200 < 100 ? 1 : -1, moveX: n % 120 < 60 ? 1 : -1, jump: n % 90 === 0, yaw: Math.sin(n / 50) * 0.8, pitch: -0.15,
  primary: n % 70 < 40, q: n % 150 === 10, e: n % 170 === 20, c: n % 230 === 30,
});
const dummies = [{ pos: { x: 0, y: 0, z: -10 }, yaw: 0, patrolHalfM: 2 }, { pos: { x: 4, y: 0, z: -6 }, yaw: 0 }, { pos: { x: 15, y: 0, z: -4 }, yaw: 0 }];
function runScript(el: Element, n: number, from?: MatchState): { s: MatchState; events: MatchEvent[] } {
  let s = from ?? createMatch({ mages: [{ element: el, spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 } }], dummies });
  const events: MatchEvent[] = [];
  for (let k = 0; k < n; k++) {
    const r = stepMatch(deepFreeze(s), { 1: script(s.tick) }, ctx); // замороженный вход: любая запись в него бросит TypeError
    s = r.state;
    events.push(...r.events);
  }
  return { s, events };
}

describe.each(ELEMENTS)("stepMatch determinism (%s)", (el) => {
  it("gives byte-identical states and events for the same inputs, without mutating them", () => {
    const [a, b] = [runScript(el, 900), runScript(el, 900)];
    expect([JSON.stringify(a.s) === JSON.stringify(b.s), JSON.stringify(a.events) === JSON.stringify(b.events)]).toEqual([true, true]);
    expect([a.events.filter((e) => e.type === "cast").length > 10, a.events.some((e) => e.type === "hit")]).toEqual([true, true]);
  });

  it("continues identically from a JSON copy of the state", () => {
    const half = runScript(el, 300).s;
    const copy = JSON.parse(JSON.stringify(half)) as MatchState;
    expect(JSON.stringify(runScript(el, 300, half).s)).toBe(JSON.stringify(runScript(el, 300, copy).s));
  });
});
