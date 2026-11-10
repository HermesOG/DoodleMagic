import { describe, expect, it } from "vitest";
import { TRAINING, buildSedlovina } from "@doodlemagic/arena";
import { NO_MATCH_INPUT, TICK_DT, clonePlain, createMatch, matchContext, unitById, type MatchInput, type MatchState } from "@doodlemagic/sim";
import type { Frame } from "../game/driver";
import { createSoloDriver } from "./soloDriver";

const LOCAL = 1;
const ctx = matchContext(buildSedlovina("full"));
const training = (): MatchState => createMatch({ mages: [{ element: "fire", spawn: TRAINING.spawn }], dummies: [...TRAINING.dummies] });
const idle = (): MatchInput => ({ ...NO_MATCH_INPUT, yaw: TRAINING.spawn.yaw });
/** Полигон, но маг над зоной смерти ущелья, выше её верха (−3 м): падает сам. */
function overGorge(): MatchState {
  const s = clonePlain(training());
  unitById(s, LOCAL)!.move.body.pos = { x: -4, y: -2, z: 3 };
  return s;
}
/** В тиках кадра есть событие type своего мага. */
const has = (f: Frame, type: "fall" | "respawn"): boolean => f.ticks.some((t) => t.events.some((e) => e.type === type && e.target === LOCAL));

describe("solo driver", () => {
  it("steps whole ticks of the frame and keeps the remainder as alpha", () => {
    const d = createSoloDriver(ctx, training(), LOCAL);
    const f = d.advance(TICK_DT * 3, idle);
    expect(f.ticks).toHaveLength(3);
    expect(f.alpha).toBeCloseTo(0, 6);
    expect([f.late, f.cur.tick, f.prev.tick, f.ticks.map((t) => t.state.tick)]).toEqual([[], 3, 2, [1, 2, 3]]);
    expect(f.cur).toBe(f.ticks[2]!.state);
    expect(f.prev).toBe(f.ticks[1]!.state);

    const g = createSoloDriver(ctx, training(), LOCAL).advance(TICK_DT * 0.5, idle);
    expect(g.ticks).toHaveLength(0);
    expect(g.alpha).toBeCloseTo(0.5, 6);
    expect(g.cur.tick).toBe(0);
  });

  it("samples the input exactly once per tick", () => {
    const d = createSoloDriver(ctx, training(), LOCAL);
    let calls = 0;
    const sample = (): MatchInput => {
      calls += 1;
      return idle();
    };
    d.advance(TICK_DT * 0.5, sample);
    expect(calls).toBe(0);
    d.advance(TICK_DT * 2, sample); // 0,5 + 2 → 2 тика, остаток 0,5
    expect(calls).toBe(2);
    const f = d.advance(TICK_DT * 4.5, sample); // 0,5 + 4,5 → 5 тиков
    expect([f.ticks.length, calls]).toEqual([5, 7]);
  });

  it("drives the local mage with the sampled input", () => {
    const d = createSoloDriver(ctx, training(), LOCAL);
    const f = d.advance(TICK_DT * 3, () => ({ ...idle(), yaw: 0.5 }));
    expect(unitById(f.cur, LOCAL)!.move.yaw).toBeCloseTo(0.5, 9);
  });

  it("confirms every event of its ticks and has no late ones", () => {
    const d = createSoloDriver(ctx, training(), LOCAL);
    // ЛКМ зажата с первого тика: огненный кулак даёт события cast и release
    const f = d.advance(TICK_DT * 5, () => ({ ...idle(), primary: true }));
    expect(f.confirmed.length).toBeGreaterThan(0);
    expect(f.confirmed).toEqual(f.ticks.flatMap((t) => t.events));
    expect(f.late).toEqual([]);
  });

  it("falls into the gorge, respawns at the training spot and snaps prev to cur", () => {
    const d = createSoloDriver(ctx, overGorge(), LOCAL);
    const frames: Frame[] = [];
    for (let k = 0; k < 180 && !frames.some((f) => has(f, "respawn")); k++) frames.push(d.advance(TICK_DT, idle));
    const fell = frames.findIndex((f) => has(f, "fall"));
    const back = frames.findIndex((f) => has(f, "respawn"));
    expect(fell).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(fell);
    const f = frames[back]!;
    expect(f.ticks).toHaveLength(1);
    expect(f.prev).toBe(f.cur);
    const me = unitById(f.cur, LOCAL)!;
    expect([me.alive, me.move.body.pos]).toEqual([true, TRAINING.spawn.pos]);
    // кадр до возрождения — обычный: prev на тик раньше cur
    expect(frames[back - 1]!.prev).not.toBe(frames[back - 1]!.cur);
  });

  it("keeps prev at the previous tick when the respawn is not the last tick of the frame", () => {
    const start = overGorge();
    // проба: на каком тике маг возрождается
    const probe = createSoloDriver(ctx, start, LOCAL);
    let f = probe.advance(TICK_DT, idle);
    for (let k = 0; k < 180 && !has(f, "respawn"); k++) f = probe.advance(TICK_DT, idle);
    const at = f.cur.tick;
    // заново, и кадр в 2 тика начинается тиком возрождения; взгляд игрока всё ещё тот, что был при падении
    const d = createSoloDriver(ctx, start, LOCAL);
    const stale = (): MatchInput => ({ ...idle(), yaw: 0.5, pitch: -0.7 });
    while (d.advance(0, stale).cur.tick < at - 1) d.advance(TICK_DT, stale);
    f = d.advance(TICK_DT * 2, stale);
    expect([f.ticks.length, f.ticks[0]!.events.some((e) => e.type === "respawn" && e.target === LOCAL)]).toEqual([2, true]);
    expect(f.prev).toBe(f.ticks[0]!.state);
    expect(f.cur).toBe(f.ticks[1]!.state);
    // тик после возрождения в том же кадре смотрит, куда точка появления, а не куда смотрел падающий
    const me = unitById(f.cur, LOCAL)!.move;
    expect([me.yaw, me.pitch]).toEqual([TRAINING.spawn.yaw, 0]);
    // со следующего кадра — снова ввод игрока (вид к тому времени поставит взгляд на точку)
    expect(unitById(d.advance(TICK_DT, stale).cur, LOCAL)!.move.yaw).toBeCloseTo(0.5, 9);
  });

  it("chooseElement respawns the local mage at the training spot as Earth, with prev = cur", () => {
    const d = createSoloDriver(ctx, training(), LOCAL);
    d.advance(TICK_DT * 30, () => ({ ...idle(), moveZ: 1 })); // отошёл от точки
    const spawn = d.chooseElement("earth");
    expect(spawn).toEqual(TRAINING.spawn);
    const f = d.advance(0, idle);
    expect(f.ticks).toHaveLength(0);
    expect(f.prev).toBe(f.cur);
    const me = unitById(f.cur, LOCAL)!;
    expect([me.mage!.element, me.move.body.pos, me.move.yaw]).toEqual(["earth", TRAINING.spawn.pos, TRAINING.spawn.yaw]);
    // точка — копия: правка не трогает состояние
    spawn!.pos.x = 999;
    expect(unitById(d.advance(0, idle).cur, LOCAL)!.mage!.spawn.pos.x).toBe(TRAINING.spawn.pos.x);
  });

  it("does not change the initial state it was given", () => {
    const start = training();
    const copy = JSON.stringify(start);
    const d = createSoloDriver(ctx, start, LOCAL);
    d.advance(TICK_DT * 5, () => ({ ...idle(), moveZ: 1, primary: true }));
    d.chooseElement("earth");
    expect(JSON.stringify(start)).toBe(copy);
  });
});
