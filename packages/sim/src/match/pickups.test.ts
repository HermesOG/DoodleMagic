import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import type { ArenaData, Pickup, Spawn, Vec3 } from "../types";
import { applyHit, stepStatuses, type HitSpec } from "./combat";
import { PICKUPS, STATUS, ULT_CHARGE } from "./defs";
import { buildTickWorld } from "./dynamic";
import { TEST_FLOOR, TEST_KILL, deepFreeze, testContext } from "./fixtures";
import { createMatch, matchContext, stepMatch } from "./match";
import { furyOnDeath, hasFury, initPickups, pickupPresent, stepPickups } from "./pickups";
import { addMage, createGame, pvpContext, setElement, startCountdown, stepGame, type GameState } from "./rules";
import { NO_MATCH_INPUT, clonePlain, createDummyUnit, createMageUnit, createMatchState, freshStatuses, unitById } from "./state";
import { NEVER, NOBODY, type Element, type MatchContext, type MatchEvent, type MatchInput, type MatchState, type PickupState, type TickCtx, type Unit, type UnitId } from "./types";
import { stepLife } from "./units";

/** Фаза 6, задача 1: сферы жизни, руна ярости, ярость (Р1–Р5). */

/** Арена испытаний (пол x −40…20, z −40…40, верх y = 0) с шестью сферами и руной, как на галерее; точки — 0,5 м над полом. */
const PICKS: Pickup[] = [
  { kind: "orb", pos: { x: -20, y: 0.5, z: -20 } },
  { kind: "orb", pos: { x: -20, y: 0.5, z: 20 } },
  { kind: "orb", pos: { x: 10, y: 0.5, z: -20 } },
  { kind: "orb", pos: { x: 10, y: 0.5, z: 20 } },
  { kind: "rune", pos: { x: 0, y: 0.5, z: 0 } },
  { kind: "orb", pos: { x: -30, y: 0.5, z: 0 } },
  { kind: "orb", pos: { x: 15, y: 0.5, z: 0 } },
];
const RUNE = 4;
const ORB = 6; // точка (15; 0,5; 0) ровно на z = 0: касания с двух сторон по z равны до бита
const SPAWNS: Spawn[] = [
  { pos: { x: -35, y: 0, z: -35 }, yaw: 0 },
  { pos: { x: -35, y: 0, z: 35 }, yaw: Math.PI },
];
const ARENA: ArenaData = {
  name: "Испытания объектов", variant: "compact", bounds: aabb(-40, -30, -40, 40, 10, 40),
  colliders: [TEST_FLOOR], volumes: [TEST_KILL], render: [], spawns: SPAWNS, pickups: PICKS,
};
const ctx = matchContext(ARENA);

const at = (p: Pickup, dx = 0, dz = 0): Spawn => ({ pos: { x: p.pos.x + dx, y: 0, z: p.pos.z + dz }, yaw: 0 });
const pick = (k: number): Pickup => PICKS[k]!;
/** Далеко от всех объектов. */
const AWAY: Spawn = { pos: { x: -35, y: 0, z: -35 }, yaw: 0 };
const mage = (id: UnitId, spawn: Spawn = AWAY, el: Element = "fire"): Unit => createMageUnit(id, el, spawn);
const u = (s: MatchState, id: UnitId): Unit => unitById(s, id)!;
const place = (s: MatchState, id: UnitId, p: Spawn): void => {
  Object.assign(u(s, id).move.body.pos, p.pos);
};

type Log = { t: number; e: MatchEvent }[];
/** n тиков stepMatch с замороженным входом; события с номером тика. */
function steps(s: MatchState, n: number, c: MatchContext = ctx, input: (tick: number, s: MatchState) => Partial<Record<UnitId, MatchInput>> = () => ({})): { s: MatchState; log: Log } {
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const t = s.tick;
    const r = stepMatch(deepFreeze(s), input(t, s), c);
    s = r.state;
    for (const e of r.events) log.push({ t, e });
  }
  return { s, log };
}
/** Копия состояния, перенесённая на тик tick (часы руны идут по номеру тика). */
const jump = (s: MatchState, tick: number): MatchState => ({ ...clonePlain(s), tick });
const ofType = <T extends MatchEvent["type"]>(log: Log, type: T) =>
  log.filter((x): x is { t: number; e: Extract<MatchEvent, { type: T }> } => x.e.type === type);
const pickupLog = (log: Log) => ofType(log, "pickup").map(({ t, e }) => [t, e.kind, e.index, e.phase, e.unit]);
const furyLog = (log: Log) => ofType(log, "fury").map(({ t, e }) => [t, e.unit, e.phase, e.by]);

/** Тик для прямых вызовов боя и жизни (как его соберёт stepMatch). */
function tickOf(s: MatchState, ev: MatchEvent[], mul = 1): TickCtx {
  const tw = buildTickWorld(ctx.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: ctx.killBelowY, now: s.tick, ev, spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0, ultChargeMul: mul };
}
const hitSpec = (over: Partial<HitSpec> = {}): HitSpec => ({ source: 1, target: 2, ability: "fireball", damage: 20, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 1 }, ...over });
const near = (v: number, want: number) => expect(v).toBeCloseTo(want, 9);
/** Свежий матч одного мага на тике 0 (объекты заведёт первый шаг); hp — его HP. */
const first = (spawn: Spawn = AWAY, hp?: number): MatchState => {
  const s = createMatch({ mages: [{ element: "fire", spawn }], dummies: [] });
  if (hp !== undefined) u(s, 1).hp = hp;
  return s;
};

describe("pickups contracts", () => {
  it("pins the numbers of GDD 3: orb +35 back in 15 s, rune at 0:45 then every 60 s, warned 10 s ahead, fury ×1.3 for 12 s, +10 for the kill", () => {
    expect(PICKUPS).toEqual({
      orb: { heal: 35, respawnS: 15, reachM: 0.6 },
      rune: { firstS: 45, everyS: 60, warnS: 10, furyS: 12, damageMul: 1.3, killUlt: 10, reachM: 0.8 },
    });
  });

  it("a fresh state has no pickups and a fresh unit no fury; both survive JSON", () => {
    const s = createMatchState([mage(1)]);
    expect([s.pickups, freshStatuses().furyUntil, hasFury(u(s, 1), 0)]).toEqual([[], 0, false]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("initPickups: orbs lie at once (readyAt NEVER), the rune comes 2700 ticks later; positions are copies", () => {
    const list = initPickups(PICKS, 100);
    expect(list).toEqual(PICKS.map((p): PickupState => ({ kind: p.kind, pos: p.pos, readyAt: p.kind === "rune" ? 2800 : NEVER })));
    expect(list[0]!.pos).not.toBe(PICKS[0]!.pos);
    expect(list.map((p) => pickupPresent(p, 100))).toEqual([true, true, true, true, false, true, true]);
    expect([pickupPresent(list[RUNE]!, 2799), pickupPresent(list[RUNE]!, 2800)]).toEqual([false, true]);
  });

  it("matchContext copies the arena points; the first step lays them without events; no ctx.pickups — none, as before", () => {
    expect(ctx.pickups).toEqual(PICKS);
    expect(ctx.pickups).not.toBe(PICKS);
    expect([ctx.pickups!.filter((p) => p.kind === "orb").length, ctx.pickups!.filter((p) => p.kind === "rune").length]).toEqual([6, 1]);
    const r = steps(first(), 1);
    expect(r.s.pickups).toEqual(initPickups(PICKS, 0));
    expect(r.s.pickups[RUNE]!.readyAt).toBe(2700);
    expect(pickupLog(r.log)).toEqual([]);
    expect(steps(first(), 3, testContext()).s.pickups).toEqual([]);
  });
});

describe("health orbs (Р1, Р3)", () => {
  it("a mage at 50 HP walks in: heal +35 and take, the orb is gone; 900 ticks later it spawns and lies again", () => {
    let r = steps(first(at(pick(ORB)), 50), 1);
    expect(pickupLog(r.log)).toEqual([[0, "orb", ORB, "take", 1]]);
    expect(ofType(r.log, "heal").map(({ e }) => [e.target, e.source, e.amount])).toEqual([[1, 1, 35]]);
    expect(ofType(r.log, "pickup")[0]!.e.pos).toEqual(pick(ORB).pos);
    expect([u(r.s, 1).hp >= 85, r.s.pickups[ORB]!.readyAt, pickupPresent(r.s.pickups[ORB]!, 1)]).toEqual([true, 900, false]);
    place(r.s, 1, AWAY);
    r = steps(jump(r.s, 895), 10);
    expect(pickupLog(r.log)).toEqual([[900, "orb", ORB, "spawn", NOBODY]]);
    expect(pickupPresent(r.s.pickups[ORB]!, r.s.tick)).toBe(true);
  });

  it("a mage at full HP runs through: the orb stays, no heal", () => {
    const r = steps(first(at(pick(ORB))), 30);
    expect([pickupLog(r.log), ofType(r.log, "heal"), r.s.pickups[ORB]!.readyAt]).toEqual([[], [], NEVER]);
  });

  it("90 HP of 100 heals to 100, and the event carries the real +10", () => {
    const s = first(at(pick(ORB)));
    Object.assign(u(s, 1), { hp: 90, maxHp: 100 });
    const r = steps(s, 1);
    expect([ofType(r.log, "heal").map(({ e }) => e.amount), u(r.s, 1).hp, pickupLog(r.log)]).toEqual([[10], 100, [[0, "orb", ORB, "take", 1]]]);
  });

  it("a dummy never takes it", () => {
    const s = createMatch({ mages: [{ element: "fire", spawn: AWAY }], dummies: [{ pos: at(pick(ORB)).pos, yaw: 0 }] });
    u(s, 2).hp = 50;
    const r = steps(s, 5);
    expect([pickupLog(r.log), r.s.pickups[ORB]!.readyAt]).toEqual([[], NEVER]);
  });

  it("two touch it: the nearer takes; on a tie — the lower id", () => {
    const two = (z1: number, z2: number): UnitId => {
      const s = createMatch({ mages: [{ element: "fire", spawn: at(pick(ORB), 0, z1) }, { element: "earth", spawn: at(pick(ORB), 0, z2) }], dummies: [] });
      for (const x of s.units) x.hp = 50;
      return ofType(steps(s, 1).log, "pickup")[0]!.e.unit;
    };
    expect(two(0.7, -0.6)).toBe(2); // 0,3 и 0,2 м от бокса
    expect(two(-0.6, 0.7)).toBe(1);
    expect(two(0.6, -0.6)).toBe(1); // поровну
    expect(two(-0.6, 0.6)).toBe(1);
  });

  it("reach 0.6 m from the body box: 0.7 m away it stays, 0.5 m away it is taken", () => {
    const take = (dz: number) => pickupLog(steps(first(at(pick(ORB), 0, 0.4 + dz), 50), 1).log).length;
    expect([take(0.7), take(0.5)]).toEqual([0, 1]);
  });

  it("the rune reaches 0.8 m from the body box: 0.9 m away it stays, 0.7 m away it is taken", () => {
    const take = (dz: number) => {
      const r = steps(first(at(pick(RUNE), 0, 0.4 + dz)), 1);
      return pickupLog(steps(jump(r.s, 2700), 1).log).filter((x) => x[3] === "take").length;
    };
    expect([take(0.9), take(0.7)]).toEqual([0, 1]);
  });

  it("a wounded farther mage takes it past a full nearer one", () => {
    const s = createMatch({ mages: [{ element: "fire", spawn: at(pick(ORB)) }, { element: "earth", spawn: at(pick(ORB), 0, 0.7) }], dummies: [] });
    u(s, 2).hp = 50;
    expect(pickupLog(steps(s, 1).log)).toEqual([[0, "orb", ORB, "take", 2]]);
  });
});

describe("the fury rune clock (Р2)", () => {
  it("warns exactly on tick 2100, spawns on 2700 and cannot be taken before", () => {
    let r = steps(first(at(pick(RUNE))), 1);
    r = steps(jump(r.s, 2095), 10);
    expect(pickupLog(r.log)).toEqual([[2100, "rune", RUNE, "warn", NOBODY]]);
    expect(ofType(r.log, "pickup")[0]!.e.pos).toEqual(pick(RUNE).pos);
    r = steps(jump(r.s, 2690), 10); // маг стоит на руне до её появления
    expect([pickupLog(r.log), hasFury(u(r.s, 1), r.s.tick)]).toEqual([[], false]);
    r = steps(r.s, 1);
    expect(pickupLog(r.log)).toEqual([[2700, "rune", RUNE, "spawn", NOBODY], [2700, "rune", RUNE, "take", 1]]);
  });

  it("taken on 2750: fury until 3470 with a status event; the next is warned on 5700 and spawns on 6300", () => {
    let r = steps(first(), 1);
    r = steps(jump(r.s, 2750), 0);
    place(r.s, 1, at(pick(RUNE)));
    r = steps(r.s, 1);
    expect(pickupLog(r.log)).toEqual([[2750, "rune", RUNE, "take", 1]]);
    expect(ofType(r.log, "status").map(({ e }) => [e.target, e.status, e.ticks, e.source])).toEqual([[1, "fury", 720, 1]]);
    expect([u(r.s, 1).status.furyUntil, hasFury(u(r.s, 1), 3469), hasFury(u(r.s, 1), 3470), r.s.pickups[RUNE]!.readyAt]).toEqual([3470, true, false, 6300]);
    place(r.s, 1, AWAY);
    const a = steps(jump(r.s, 5695), 10);
    const b = steps(jump(a.s, 6295), 10);
    expect([...pickupLog(a.log), ...pickupLog(b.log)]).toEqual([[5700, "rune", RUNE, "warn", NOBODY], [6300, "rune", RUNE, "spawn", NOBODY]]);
  });

  it("a rune lying since 6300 and taken 55 s later skips the mark 10 s away: next on 6300 + 7200", () => {
    const s = first();
    s.pickups = initPickups(PICKS, 0);
    s.pickups[RUNE]!.readyAt = 6300;
    const lying = jump(s, 6300 + 3300);
    place(lying, 1, at(pick(RUNE)));
    const r = steps(lying, 1);
    expect([pickupLog(r.log), r.s.pickups[RUNE]!.readyAt]).toEqual([[[9600, "rune", RUNE, "take", 1]], 6300 + 7200]);
    // взята за 10 с 1 тик до отметки — на эту отметку ещё успевает объявление
    const early = jump(s, 6300 + 3600 - 601);
    place(early, 1, at(pick(RUNE)));
    expect(steps(early, 1).s.pickups[RUNE]!.readyAt).toBe(6300 + 3600);
  });

  it("a lying rune gives no events on its later marks", () => {
    let r = steps(first(), 1);
    r = steps(jump(r.s, 2695), 10);
    expect(pickupLog(r.log)).toEqual([[2700, "rune", RUNE, "spawn", NOBODY]]);
    const later = [5695, 6295, 9895].map((t0) => pickupLog(steps(jump(r.s, t0), 10).log));
    expect(later).toEqual([[], [], []]);
    expect(pickupPresent(r.s.pickups[RUNE]!, 9999)).toBe(true);
  });

  it("only a living mage takes the rune: a dummy and a dead mage walk past", () => {
    const s = createMatch({ mages: [{ element: "fire", spawn: at(pick(RUNE)) }], dummies: [{ pos: at(pick(RUNE), 0.3).pos, yaw: 0 }] });
    Object.assign(u(s, 1), { alive: false, hp: 0, respawnTick: 100_000 });
    s.pickups = initPickups(PICKS, 0);
    s.pickups[RUNE]!.readyAt = -1; // уже лежит
    const r = steps(s, 5);
    expect([pickupLog(r.log), u(r.s, 2).status.furyUntil, pickupPresent(r.s.pickups[RUNE]!, 5)]).toEqual([[], 0, true]);
  });
});

describe("fury (Р4)", () => {
  /** Маг 1 — носитель до тика 500, цель 2 — манекен рядом; тик 10. */
  const fight = (fury = true): MatchState => {
    const s = createMatchState([mage(1, at(pick(ORB), -3)), createDummyUnit(2, { pos: at(pick(ORB), 3).pos, yaw: 0 })]);
    s.tick = 10;
    if (fury) u(s, 1).status.furyUntil = 500;
    return s;
  };

  it("a hit of 20 from the holder deals 26; without fury 20", () => {
    for (const [fury, want] of [[true, 26], [false, 20]] as const) {
      const s = fight(fury);
      const ev: MatchEvent[] = [];
      near(applyHit(s, tickOf(s, ev), hitSpec()), want);
      near(ofType(ev.map((e) => ({ t: 10, e })), "hit")[0]!.e.amount, want);
      near(u(s, 2).hp, 170 - want);
    }
  });

  it("the holder's burning pulses ×1.3", () => {
    const s = fight();
    Object.assign(u(s, 2).status, { burnPulses: 1, burnNext: 10, burnBy: 1 });
    const ev: MatchEvent[] = [];
    stepStatuses(s, tickOf(s, ev));
    const hits = ev.filter((e) => e.type === "hit");
    expect(hits).toHaveLength(1);
    near((hits[0] as Extract<MatchEvent, { type: "hit" }>).amount, STATUS.burning.dps * STATUS.burning.pulseS * PICKUPS.rune.damageMul);
  });

  it("on an airborne target ×1.3 × 1.15", () => {
    const s = fight();
    u(s, 2).status.airborne = true;
    near(applyHit(s, tickOf(s, []), hitSpec()), 20 * PICKUPS.rune.damageMul * STATUS.airborne.damageMul);
  });

  it("the knockback is the same as without fury", () => {
    const knock = (fury: boolean) => {
      const s = fight(fury);
      const ev: MatchEvent[] = [];
      applyHit(s, tickOf(s, ev), hitSpec({ knock: { distM: 4, upM: 1.5 } }));
      return [u(s, 2).kb, u(s, 2).move.body.vel, (ev[0] as Extract<MatchEvent, { type: "hit" }>).knock];
    };
    expect(knock(true)).toEqual(knock(false));
  });

  it("on the tick of furyUntil: fury end, and damage is ×1 again", () => {
    let s = createMatch({ mages: [{ element: "fire", spawn: AWAY }, { element: "earth", spawn: { pos: { x: -35, y: 0, z: -30 }, yaw: 0 } }], dummies: [] });
    s = steps(s, 1).s;
    s = jump(s, 1000);
    u(s, 1).status.furyUntil = 1002;
    const r = steps(s, 3);
    expect(furyLog(r.log)).toEqual([[1002, 1, "end", NOBODY]]);
    expect(ofType(r.log, "fury")[0]!.e.pos).toEqual(u(r.s, 1).move.body.pos);
    const ev: MatchEvent[] = [];
    near(applyHit(r.s, tickOf({ ...r.s, tick: 1002 }, ev), hitSpec({ target: 2 })), 20);
  });

  it("a holder killed by a projectile on the very tick of furyUntil still gets exactly one fury end, no slain", () => {
    let s = createMatch({ mages: [{ element: "fire", spawn: AWAY }, { element: "earth", spawn: { pos: { x: -35, y: 0, z: -30 }, yaw: 0 } }], dummies: [] });
    s = jump(steps(s, 1).s, 1000);
    const me = u(s, 1);
    me.status.furyUntil = 1000;
    me.hp = 1;
    const p = me.move.body.pos;
    // камень хозяина 2 в полуметре перед грудью летит в мага: смерть в stepProjectiles, раньше объектов на карте
    s.projectiles.push({ id: 5000, owner: 2, ability: "stoneShot", pos: { x: p.x, y: p.y + 1, z: p.z - 0.5 }, vel: { x: 0, y: 0, z: 30 }, bornTick: 999, endTick: 1100, power: 50 });
    const r = steps(s, 1);
    expect(ofType(r.log, "death").map(({ e }) => e.target)).toEqual([1]);
    expect(furyLog(r.log)).toEqual([[1000, 1, "end", NOBODY]]);
  });

  it("a second rune taken in fury restarts it from the new take; no end at the old furyUntil", () => {
    const s = jump(first(at(pick(RUNE))), 3000);
    s.pickups = initPickups(PICKS, 0);
    s.pickups[RUNE]!.readyAt = 2700;
    u(s, 1).status.furyUntil = 3100;
    const r = steps(s, 800);
    expect(u(r.s, 1).status.furyUntil).toBe(3000 + 720);
    expect(furyLog(r.log)).toEqual([[3720, 1, "end", NOBODY]]);
  });

  it("a fresh mage at tick 0 gets no end event", () => {
    expect(furyLog(steps(first(), 3).log)).toEqual([]);
  });
});

describe("the holder's death (Р5)", () => {
  /** Носитель — маг 2 (1 HP), маг 1 бьёт; тик 100. */
  const victim = (): MatchState => {
    const s = createMatchState([mage(1, at(pick(ORB), -3)), mage(2, at(pick(ORB), 3), "earth"), mage(3, at(pick(ORB), 6), "air")]);
    s.tick = 100;
    Object.assign(u(s, 2), { hp: 1 });
    u(s, 2).status.furyUntil = 500;
    return s;
  };

  it("killed by a mage: fury slain by the killer, killer +6 +10, furyUntil = the tick of death", () => {
    const s = victim();
    const ev: MatchEvent[] = [];
    applyHit(s, tickOf(s, ev), hitSpec({ damage: 30 }));
    expect(ev.filter((e) => e.type === "death" || e.type === "fury").map((e) => e.type)).toEqual(["death", "fury"]);
    expect(ev.find((e) => e.type === "fury")).toEqual({ type: "fury", unit: 2, phase: "slain", by: 1, pos: u(s, 2).move.body.pos });
    near(u(s, 1).mage!.ult.charge, 30 / ULT_CHARGE.dealtPer + ULT_CHARGE.kill + PICKUPS.rune.killUlt);
    expect([u(s, 2).status.furyUntil, hasFury(u(s, 2), 100), u(s, 3).mage!.ult.charge]).toEqual([100, false, 0]);
  });

  it("on the training ground ×10: up to 100", () => {
    const s = victim();
    applyHit(s, tickOf(s, [], 10), hitSpec({ damage: 30 }));
    expect(u(s, 1).mage!.ult.charge).toBe(100);
  });

  it("a non-holder's death sends no fury event and gives no +10", () => {
    const s = victim();
    u(s, 2).status.furyUntil = 100; // кончилась на этом тике
    const ev: MatchEvent[] = [];
    applyHit(s, tickOf(s, ev), hitSpec({ damage: 30 }));
    expect(ev.filter((e) => e.type === "fury")).toEqual([]);
    near(u(s, 1).mage!.ult.charge, 30 / ULT_CHARGE.dealtPer + ULT_CHARGE.kill);
  });

  it("knocked off with credit: slain by the credited, +6 +10 to them", () => {
    const s = victim();
    Object.assign(u(s, 2), { lastHitBy: 3, lastHitTick: 90 });
    u(s, 2).move.body.pos.y = -40;
    const ev: MatchEvent[] = [];
    stepLife(s, tickOf(s, ev));
    expect(ev.filter((e) => e.type === "fall" || e.type === "fury").map((e) => e.type)).toEqual(["fall", "fury"]);
    expect(ev.find((e) => e.type === "fury")).toMatchObject({ unit: 2, phase: "slain", by: 3 });
    near(u(s, 3).mage!.ult.charge, ULT_CHARGE.kill + PICKUPS.rune.killUlt);
    expect(u(s, 2).status.furyUntil).toBe(100);
  });

  it("fell on its own: slain by NOBODY, no charge to anyone", () => {
    const s = victim();
    u(s, 2).move.body.pos.y = -40;
    const ev: MatchEvent[] = [];
    stepLife(s, tickOf(s, ev));
    expect(ev.find((e) => e.type === "fury")).toMatchObject({ unit: 2, phase: "slain", by: NOBODY });
    expect(s.units.map((x) => x.mage!.ult.charge)).toEqual([0, 0, 0]);
  });

  it("furyOnDeath with by = the victim itself gives nothing and names nobody", () => {
    const s = victim();
    u(s, 2).alive = false;
    const ev: MatchEvent[] = [];
    furyOnDeath(s, tickOf(s, ev), u(s, 2), 2);
    expect([ev.map((e) => (e.type === "fury" ? e.by : null)), u(s, 2).mage!.ult.charge]).toEqual([[NOBODY], 0]);
  });

  it("the respawned mage has no fury", () => {
    let s = createMatch({ mages: [{ element: "fire", spawn: AWAY }], dummies: [] });
    s = steps(s, 1).s;
    u(s, 1).status.furyUntil = 5000;
    u(s, 1).move.body.pos.x = 30; // над пропастью
    const r = steps(s, 150);
    expect(furyLog(r.log)).toEqual([[expect.any(Number), 1, "slain", NOBODY]]);
    expect([u(r.s, 1).alive, u(r.s, 1).status.furyUntil]).toEqual([true, 0]);
  });
});

describe("pickups in PvP", () => {
  const pvp = pvpContext(ARENA);
  const play = (g: GameState, n: number, input: (tick: number) => Partial<Record<UnitId, MatchInput>> = () => ({})): { g: GameState; ev: MatchEvent[] } => {
    const ev: MatchEvent[] = [];
    for (let k = 0; k < n; k++) {
      const r = stepGame(deepFreeze(g), input(g.match.tick), pvp);
      g = r.game;
      ev.push(...r.events);
    }
    return { g, ev };
  };
  const join = (g: GameState, el: Element): GameState => addMage(g, el, pvp).game;

  it("pvpContext carries the arena points", () => {
    expect(pvp.pickups).toEqual(PICKS);
  });

  it("in warmup the rune comes 45 s after the first step", () => {
    expect(play(join(createGame(), "fire"), 1).g.match.pickups).toEqual(initPickups(PICKS, 0));
    const late = join(createGame(), "fire");
    late.match.tick = 500;
    expect(play(late, 1).g.match.pickups[RUNE]!.readyAt).toBe(3200);
  });

  it("the fight start lays the orbs again and the rune at start + 2700", () => {
    let g = play(join(join(createGame(), "fire"), "earth"), 1).g;
    g.match.pickups[ORB]!.readyAt = 5000; // взята в разминке
    g = startCountdown(g);
    const start = g.phaseEnd;
    g = play(g, start - g.match.tick).g;
    expect([g.phase, g.match.tick]).toEqual(["live", start]);
    expect(g.match.pickups).toEqual(initPickups(PICKS, start));
    expect(g.match.pickups[RUNE]!.readyAt).toBe(start + 2700);
  });

  it("setElement of a living mage in warmup — a fresh mage without fury", () => {
    const g = play(join(createGame(), "fire"), 1).g;
    g.match.units[0]!.status.furyUntil = 900;
    const next = setElement(g, 1, "water", pvp);
    expect(next.match.units[0]!.status.furyUntil).toBe(0);
  });

  it("stepPickups called alone does nothing on an empty list", () => {
    const s = createMatchState([mage(1)]);
    const ev: MatchEvent[] = [];
    stepPickups(s, tickOf(s, ev));
    expect([s.pickups, ev]).toEqual([[], []]);
  });
});

describe("pickups determinism", () => {
  /** Два мага бегут к сфере и к руне, стреляют друг в друга. */
  const drive = (tick: number, s: MatchState): Partial<Record<UnitId, MatchInput>> => {
    const out: Partial<Record<UnitId, MatchInput>> = {};
    for (const x of s.units) {
      const foe = s.units.find((o) => o.id !== x.id)!;
      const p = x.move.body.pos;
      const rune = s.pickups[RUNE];
      const goal: Vec3 = tick % 400 < 200 ? foe.move.body.pos : rune && pickupPresent(rune, tick) ? rune.pos : pick(x.id === 1 ? ORB : 0).pos;
      const yaw = Math.atan2(-(goal.x - p.x), -(goal.z - p.z));
      out[x.id] = { ...NO_MATCH_INPUT, moveZ: 1, yaw, primary: tick % 400 < 200 && tick % 20 < 10, q: tick % 300 === 50 };
    }
    return out;
  };
  const run = () => {
    const s = createMatch({ mages: [{ element: "fire", spawn: at(pick(RUNE), -6, -6) }, { element: "water", spawn: at(pick(RUNE), 6, 6) }], dummies: [] });
    return steps(s, 4000, ctx, drive);
  };

  it("4000 ticks give byte-identical states and events", () => {
    const [a, b] = [run(), run()];
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(ofType(a.log, "pickup").some(({ e }) => e.phase === "take")).toBe(true);
  });
});
