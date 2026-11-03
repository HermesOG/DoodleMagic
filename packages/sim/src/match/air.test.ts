import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import type { Spawn } from "../types";
import { SWOOP } from "./air";
import { applyHit, launchUnit } from "./combat";
import { AIR } from "./defs";
import { buildTickWorld } from "./dynamic";
import { deepFreeze, testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { spawnProjectile } from "./projectiles";
import { NO_MATCH_INPUT, aimDir, unitById } from "./state";
import type { DummySpot, Element, MatchContext, MatchEvent, MatchInput, MatchState, TickCtx, UnitId } from "./types";
import { spawnZone } from "./zones";

const ctx = testContext();
const HOME: Spawn = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
/** Наклон взгляда из глаз (1,6 м) на точку высотой y в d метрах впереди. */
const pitchTo = (d: number, y = 0.9) => Math.atan2(y - 1.6, d);
const at = (x: number, z: number, y = 0): DummySpot => ({ pos: { x, y, z }, yaw: 0 });
const mageAt = (element: Element, x: number, z: number, yaw = 0, y = 0) => ({ element, spawn: { pos: { x, y, z }, yaw } });
type Log = { t: number; e: MatchEvent }[];
interface Opts {
  spawn?: Spawn;
  others?: { element: Element; spawn: Spawn }[];
  dummies?: DummySpot[];
  c?: MatchContext;
  /** Перед шагом k: состояние можно менять (это свежая копия от stepMatch). */
  each?: (k: number, s: MatchState) => void;
  /** Ввод прочих магов на шаге k; кого нет — стоит (idleInput). */
  inputs?: (k: number, s: MatchState) => Partial<Record<UnitId, Partial<MatchInput>>>;
}
/** Маг Воздуха (id 1), прочие маги (2…), манекены; 5 тиков на приземление, затем n шагов. trace[k] — состояние после шага k. */
function play(n: number, input: (k: number, s: MatchState) => Partial<MatchInput>, o: Opts = {}) {
  const c = o.c ?? ctx;
  let s = createMatch({ mages: [{ element: "air", spawn: o.spawn ?? HOME }, ...(o.others ?? [])], dummies: o.dummies ?? [] });
  for (let k = 0; k < 5; k++) s = stepMatch(s, {}, c).state;
  const start = s.tick;
  const log: Log = [];
  const trace: MatchState[] = [];
  for (let k = 0; k < n; k++) {
    o.each?.(k, s);
    const inputs: Partial<Record<UnitId, MatchInput>> = { 1: { ...NO_MATCH_INPUT, ...input(k, s) } };
    for (const [id, inp] of Object.entries(o.inputs?.(k, s) ?? {})) inputs[Number(id)] = { ...NO_MATCH_INPUT, ...inp };
    const r = stepMatch(s, inputs, c);
    s = r.state;
    trace.push(s);
    for (const e of r.events) log.push({ t: k, e });
  }
  return { s, log, start, trace };
}
/** Мир тика, как у stepMatch: для ударов и зон между шагами. */
function tickOf(s: MatchState, ev: MatchEvent[] = [], c: MatchContext = ctx): TickCtx {
  const tw = buildTickWorld(c.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: c.killBelowY, now: s.tick, ev, spawns: null, mageRespawnTicks: 60, spawnShieldTicks: 0 };
}
const of = <K extends MatchEvent["type"]>(log: Log, type: K) =>
  log.flatMap(({ t, e }) => (e.type === type ? [{ t, e: e as Extract<MatchEvent, { type: K }> }] : []));
const hitsBy = (log: Log, ability: string) => of(log, "hit").filter(({ e }) => e.ability === ability);
const pos = (s: MatchState, id: UnitId) => unitById(s, id)!.move.body.pos;
const vel = (s: MatchState, id: UnitId) => unitById(s, id)!.move.body.vel;

describe("Air «Лёгкость»: double jump", () => {
  it("in the air a press sets vel.y to √(2·20·1.25) once until landing; again after landing; airJump", () => {
    const press = new Set([0, 10, 20, 70, 80]);
    const { log, trace } = play(140, (k) => ({ jump: press.has(k) }));
    expect(of(log, "airJump").map(({ t }) => t)).toEqual([10, 80]);
    // стоит заново, а не прибавляется; тем же тиком stepPlayer уже снял один тик гравитации
    expect(vel(trace[10]!, 1).y).toBeCloseTo(Math.sqrt(2 * 20 * AIR.passive.doubleJumpM) - 20 / 60, 9);
    expect([trace[10]!.units[0]!.mage!.flight.doubleJumped, trace[69]!.units[0]!.mage!.flight.doubleJumped, trace[69]!.units[0]!.move.onGround]).toEqual([true, false, true]);
  });

  it("no second jump in the first 18 ticks «В воздухе»; after them it works", () => {
    const { log } = play(40, (k) => ({ jump: k === 5 || k === 20 }), { each: (k, s) => void (k === 0 && launchUnit(s, tickOf(s), 1, 3, 99)) });
    expect(of(log, "airJump").map(({ t }) => t)).toEqual([20]);
  });

  it("a coyote jump off a ledge does not spend the second jump", () => {
    let off = -1;
    const { log, trace } = play(
      80,
      (k, s) => {
        if (off < 0 && k > 0 && !s.units[0]!.move.onGround) off = k;
        return { moveZ: 1, jump: off >= 0 && (k === off + 2 || k === off + 25) };
      },
      { spawn: { pos: { x: 0, y: 2, z: 0 }, yaw: 0 }, c: testContext([{ box: aabb(-3, 0, -3, 3, 2, 3) }]) },
    );
    expect(off).toBeGreaterThan(0);
    expect(vel(trace[off + 2]!, 1).y).toBeCloseTo(Math.sqrt(50) - 20 / 60, 9); // обычный прыжок «койота»
    expect(of(log, "airJump").map(({ t }) => t)).toEqual([off + 25]);
  });

  it("two jumps from the floor reach ≈ 2.5 m", () => {
    let apex = -1;
    let top = 0;
    play(90, (k, s) => {
      const b = s.units[0]!.move.body;
      top = Math.max(top, b.pos.y);
      if (apex < 0 && k > 0 && b.vel.y <= 0) apex = k;
      return { jump: k === 0 || k === apex };
    });
    expect(top).toBeCloseTo(2.5, 1);
  });
});

describe("Air «Лёгкость»: glide", () => {
  const HIGH: Spawn = { pos: { x: 0, y: 30, z: 0 }, yaw: 0 };

  it("only after the second jump, jump held, falling: vel.y ≥ −2.5 for 180 ticks, then a normal fall; glide events", () => {
    const { log, trace } = play(320, () => ({ jump: true }), { spawn: HIGH });
    expect(of(log, "airJump").map(({ t }) => t)).toEqual([0]);
    const g = of(log, "glide");
    expect(g.map(({ e }) => [e.unit, e.on])).toEqual([[1, true], [1, false]]);
    const [on, offT] = [g[0]!.t, g[1]!.t];
    expect(offT - on).toBe(AIR.passive.glideS * 60);
    expect(vel(trace[on - 1]!, 1).y).toBeLessThan(0.34); // парение начинается после верхней точки
    for (let k = on; k < offT; k++) {
      expect(vel(trace[k]!, 1).y).toBeGreaterThanOrEqual(-2.5);
      expect(trace[k]!.units[0]!.mage!.flight.gliding).toBe(true);
    }
    expect(Math.min(...trace.slice(offT, offT + 30).map((s) => vel(s, 1).y))).toBeLessThan(-5);
    expect(trace[319]!.units[0]!.move.onGround).toBe(true);
    expect(trace[319]!.units[0]!.mage!.flight).toEqual({ doubleJumped: false, glideTicks: 0, gliding: false });
  });

  it("air control is 100 % while gliding (60 m/s²) and 60 % otherwise", () => {
    const { trace } = play(60, (k) => ({ jump: true, moveX: k === 5 || k === 50 ? 1 : 0 }), { spawn: HIGH });
    expect(trace[5]!.units[0]!.mage!.flight.gliding).toBe(false);
    expect(vel(trace[5]!, 1).x).toBeCloseTo(0.6, 9);
    expect(trace[50]!.units[0]!.mage!.flight.gliding).toBe(true);
    expect(vel(trace[50]!, 1).x).toBeCloseTo(1.6, 9);
  });

  it("a swoop or a tow ends the glide at once (the hooks do not run then)", () => {
    const sw = play(70, (k) => ({ jump: true, e: k === 60 }), { spawn: HIGH });
    expect(of(sw.log, "glide").map(({ t, e }) => [t, e.on]).slice(-1)).toEqual([[60, false]]);
    for (let k = 60; k < 71 && k < sw.trace.length; k++) expect(sw.trace[k]!.units[0]!.mage!.flight.gliding).toBe(false);
    const tow = play(62, () => ({ jump: true }), {
      spawn: HIGH,
      each: (k, s) =>
        void (k === 60 && applyHit(s, tickOf(s), { source: 99, target: 1, ability: "waterGrab", damage: 0, pos: pos(s, 1), dir: { x: 0, z: 0 }, tow: { x: 5, z: 0, speed: 20, ticks: 10 } })),
    });
    expect([of(tow.log, "glide").map(({ t, e }) => [t, e.on]).slice(-1), tow.trace[60]!.units[0]!.mage!.flight.gliding]).toEqual([[[60, false]], false]);
  });

  it("an ordinary jump with jump held falls as before", () => {
    const { log, trace } = play(50, () => ({ jump: true }));
    expect([of(log, "glide"), of(log, "airJump")]).toEqual([[], []]);
    expect(Math.min(...trace.map((s) => vel(s, 1).y))).toBeLessThan(-6);
  });

  it("a {3, 0} push on a gliding mage carries 3 ± 0.35 m (the channel decays as on the floor)", () => {
    let x0 = 0;
    const { trace } = play(160, () => ({ jump: true }), {
      spawn: HIGH,
      each: (k, s) => {
        if (k !== 60) return;
        expect(s.units[0]!.mage!.flight.gliding).toBe(true);
        x0 = pos(s, 1).x;
        applyHit(s, tickOf(s), { source: 99, target: 1, ability: "fireball", damage: 0, pos: pos(s, 1), dir: { x: 1, z: 0 }, knock: { distM: 3, upM: 0 } });
      },
    });
    expect(trace[159]!.units[0]!.mage!.flight.gliding).toBe(true);
    expect(Math.abs(pos(trace[159]!, 1).x - x0 - 3)).toBeLessThan(0.35);
  });
});

describe("Air: sickle (LMB)", () => {
  it("16 damage, a shot every 20 ticks, 60 m/s, lives 40 ticks", () => {
    const { log, trace } = play(70, (k) => ({ primary: k < 41, pitch: pitchTo(10) }), { dummies: [at(0, -10)] });
    expect(of(log, "cast").filter(({ e }) => e.ability === "airSickle").map(({ t }) => t)).toEqual([0, 20, 40]);
    expect(of(log, "release").filter(({ e }) => e.ability === "airSickle").map(({ t }) => t)).toEqual([0, 20, 40]);
    const p = trace[0]!.projectiles[0]!;
    expect([p.ability, p.endTick - p.bornTick, p.power, Math.hypot(p.vel.x, p.vel.y, p.vel.z)]).toEqual(["airSickle", 40, 16, 60]);
    const hits = hitsBy(log, "airSickle");
    expect([hits.length, hits.every(({ e }) => e.amount === 16 && e.target === 2)]).toEqual([3, true]);
  });

  it("juice: a hit pushes the target 0.2 m", () => {
    const { s } = play(70, (k) => ({ primary: k === 0, pitch: pitchTo(10) }), { dummies: [at(0, -10)] });
    expect(Math.abs(pos(s, 2).z + 10.2)).toBeLessThan(0.01); // хвост канала ниже stopSpeed не доезжает ≈ 0,008 м
  });

  it("during the gust windup an LMB press waits in the buffer and fires right after the release", () => {
    const { log } = play(40, (k) => ({ q: k === 0, primary: k === 10 }));
    expect([of(log, "cast").map(({ t, e }) => [t, e.ability]), of(log, "reject")]).toEqual([[[0, "gust"], [25, "airSickle"]], []]);
  });
});

describe("Air: gust (Q)", () => {
  const deg = (a: number) => (a * Math.PI) / 180;
  const gust = (n: number, o: Opts = {}, input: (k: number) => Partial<MatchInput> = (k) => ({ q: k === 0 })) => play(n, input, o);
  const moved = (r: ReturnType<typeof play>, id: UnitId, from: { x: number; z: number }) => ({ x: pos(r.s, id).x - from.x, z: pos(r.s, id).z - from.z });

  it("cast on the press tick, release 24 ticks later by the aim of the release tick", () => {
    const { log } = gust(30, {}, (k) => ({ q: k === 0, yaw: k < 24 ? 0 : 0.3 }));
    const cast = of(log, "cast");
    const rel = of(log, "release");
    expect([cast.map(({ t, e }) => [t, e.ability, e.slot]), rel.map(({ t, e }) => [t, e.ability, e.projectile])]).toEqual([[[0, "gust", "q"]], [[24, "gust", -1]]]);
    const d = aimDir(0.3, 0);
    expect([rel[0]!.e.dir.x, rel[0]!.e.dir.z]).toEqual([d.x, d.z]);
  });

  it("a target 5 m out at 20° takes 10 and flies 7 ± 0.5 m along the look, not radially", () => {
    const p = { x: 5 * Math.sin(deg(20)), z: -5 * Math.cos(deg(20)) };
    const r = gust(200, { dummies: [at(p.x, p.z)] });
    const hits = hitsBy(r.log, "gust");
    expect(hits.map(({ t, e }) => [t, e.target, e.amount, e.airborne])).toEqual([[24, 2, 10, false]]);
    const m = moved(r, 2, p);
    expect(Math.abs(m.z + 7)).toBeLessThan(0.5);
    expect(Math.abs(m.x)).toBeLessThan(0.05);
  });

  it("misses past 30°, past 7.4 m; hits at 7.27 m", () => {
    const r = gust(40, { dummies: [at(5 * Math.sin(deg(40)), -5 * Math.cos(deg(40))), at(0, -7.5), at(1, -7.2)] });
    expect(hitsBy(r.log, "gust").map(({ e }) => e.target)).toEqual([4]);
  });

  it("misses a target 3 m up and one behind a stone box", () => {
    const c = testContext([{ box: aabb(0.5, 0, -5, 2.5, 3, -3) }, { box: aabb(-1.6, 0, -2.6, -0.6, 3, -2) }]);
    const r = gust(40, { c, dummies: [at(1.5, -4, 3), at(-5 * Math.sin(deg(25)), -5 * Math.cos(deg(25))), at(0, -6)] });
    expect(hitsBy(r.log, "gust").map(({ e }) => e.target)).toEqual([4]);
  });

  it("goes through a fire wall", () => {
    const each = (k: number, s: MatchState) => {
      if (k !== 0) return;
      spawnZone(s, tickOf(s), { owner: 99, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: aabb(-5, 0, -2.8, 5, 2.5, -2.2) }, bornTick: s.tick, armTick: s.tick, endTick: s.tick + 600 });
    };
    const r = gust(40, { dummies: [at(0, -5)], each });
    expect(hitsBy(r.log, "gust").map(({ e }) => e.target)).toEqual([2]);
  });

  it("Earth flies 3.5 m; an immune target still 7 m (K2); an anchored one does not move but takes the damage", () => {
    const e = gust(200, { others: [mageAt("earth", 0, -5)] });
    expect(Math.abs(moved(e, 2, { x: 0, z: -5 }).z + 3.5)).toBeLessThan(0.35);
    const im = gust(200, { dummies: [at(0, -5)], each: (k, s) => void (k === 0 && (unitById(s, 2)!.status.immuneUntil = s.tick + 1000)) });
    expect(Math.abs(moved(im, 2, { x: 0, z: -5 }).z + 7)).toBeLessThan(0.5);
    const an = gust(200, { dummies: [at(0, -5)], each: (k, s) => void (k === 0 && (unitById(s, 2)!.status.anchoredUntil = s.tick + 1000)) });
    expect([moved(an, 2, { x: 0, z: -5 }), hitsBy(an.log, "gust").map(({ e }) => e.amount)]).toEqual([{ x: 0, z: 0 }, [10]]);
  });

  it("a wall 3 m behind the target: one slam and +20", () => {
    const r = gust(200, { c: testContext([{ box: aabb(-5, 0, -7.9, 5, 3, -7.4) }]), dummies: [at(0, -4)] });
    expect(of(r.log, "slam").map(({ e }) => [e.target, e.source])).toEqual([[2, 1]]);
    expect(hitsBy(r.log, "gust").map(({ e }) => e.amount)).toEqual([10, 20]);
  });

  it("blows out an enemy fireball in the cone without an explosion; its own sickle flies on", () => {
    const ids: number[] = [];
    const each = (k: number, s: MatchState) => {
      if (k !== 24) return;
      const t = tickOf(s);
      ids.push(spawnProjectile(s, t, 2, "fireball", { x: 0, y: 1.5, z: -5 }, { x: 0, y: 0, z: -1 }));
      ids.push(spawnProjectile(s, t, 1, "airSickle", { x: 1, y: 1.5, z: -4 }, { x: 0, y: 0, z: -1 }));
    };
    const r = gust(80, { others: [mageAt("fire", -30, 30)], each });
    expect(of(r.log, "blown").map(({ t, e }) => [t, e.unit, e.projectile, e.kind, e.owner])).toEqual([[24, 1, ids[0], "fireball", 2]]);
    expect(of(r.log, "explosion")).toEqual([]);
    expect(r.trace[24]!.projectiles.map((p) => p.id)).toEqual([ids[1]]);
  });

  it("works in the air and during a swoop", () => {
    const air = gust(40, { dummies: [at(0, -5)] }, (k) => ({ jump: k === 0, q: k === 3 }));
    expect([of(air.log, "cast").map(({ t }) => t), hitsBy(air.log, "gust").map(({ t, e }) => [t, e.target])]).toEqual([[3], [[27, 2]]]);
    expect(air.trace[3]!.units[0]!.move.onGround).toBe(false);
    const sw = gust(40, { dummies: [at(0, -13)] }, (k) => ({ q: k === 0, e: k === 4, moveZ: k === 4 ? 1 : 0 }));
    expect([of(sw.log, "dash").filter(({ e }) => e.phase === "start").map(({ t }) => t), hitsBy(sw.log, "gust").map(({ t, e }) => [t, e.target])]).toEqual([[4], [[24, 2]]]);
  });

  it("cooldown 480 ticks", () => {
    const r = gust(485, {}, (k) => ({ q: k === 0 || k === 100 || k === 480 }));
    expect(r.trace[0]!.units[0]!.mage!.ready.q).toBe(r.start + 480);
    expect([of(r.log, "cast").map(({ t }) => t), of(r.log, "reject").map(({ t, e }) => [t, e.slot, e.reason])]).toEqual([[0, 480], [[100, "q", "cooldown"]]]);
  });
});

describe("Air: swoop (E)", () => {
  it("8 m in 12 ticks along the input, 7 m/s out; in the air at a constant height", () => {
    const r = play(14, (k) => ({ e: k === 0, moveX: k === 0 ? 1 : 0 }));
    const d = of(r.log, "dash");
    expect(d.map(({ t, e }) => [t, e.phase, e.ability])).toEqual([[0, "start", "swoop"], [11, "end", "swoop"]]);
    expect(Math.abs(d[1]!.e.pos.x - 8)).toBeLessThan(0.1);
    let y0 = 0;
    const a = play(14, (k, s) => {
      if (k === 0) y0 = pos(s, 1).y;
      return { e: k === 0, moveX: k === 0 ? 1 : 0 };
    }, { spawn: { pos: { x: 0, y: 10, z: 0 }, yaw: 0 } });
    for (let k = 0; k < 11; k++) expect(pos(a.trace[k]!, 1).y).toBe(y0);
    const end = of(a.log, "dash")[1]!;
    expect([end.t, end.e.pos.y, vel(a.trace[11]!, 1).x]).toEqual([11, y0, SWOOP.exitSpeed]);
  });

  it("two in a row, the third is rejected on cooldown; the charges come back at 360 and 720", () => {
    const r = play(725, (k) => ({ e: k === 0 || k === 20 || k === 40 }));
    expect(of(r.log, "dash").filter(({ e }) => e.phase === "start").map(({ t }) => t)).toEqual([0, 20]);
    expect(of(r.log, "reject").map(({ t, e }) => [t, e.slot, e.reason])).toEqual([[40, "e", "cooldown"]]);
    expect(of(r.log, "charge").map(({ t, e }) => [t, e.slot, e.charges])).toEqual([[360, "e", 1], [720, "e", 2]]);
    expect([r.trace[20]!.units[0]!.mage!.ready.e, r.trace[400]!.units[0]!.mage!.ready.e]).toEqual([r.start + 360, r.start + 400]);
  });

  it("a press during the swoop waits and starts the second one right after the first", () => {
    const r = play(30, (k) => ({ e: k === 0 || k === 5 }));
    expect([of(r.log, "dash").filter(({ e }) => e.phase === "start").map(({ t }) => t), of(r.log, "reject")]).toEqual([[0, 12], []]);
  });

  it("cancels its own knockback and breaks its own tow; rooted — rejected", () => {
    const kb = play(14, (k) => ({ e: k === 0, moveZ: k === 0 ? 1 : 0 }), {
      each: (k, s) => void (k === 0 && applyHit(s, tickOf(s), { source: 99, target: 1, ability: "fireball", damage: 0, pos: pos(s, 1), dir: { x: 1, z: 0 }, knock: { distM: 7, upM: 0 } })),
    });
    expect([kb.trace[0]!.units[0]!.kb, Math.abs(pos(kb.trace[11]!, 1).x) < 1e-9]).toEqual([{ x: 0, z: 0 }, true]);
    const tow = play(3, (k) => ({ e: k === 0 }), {
      each: (k, s) =>
        void (k === 0 && applyHit(s, tickOf(s), { source: 99, target: 1, ability: "waterGrab", damage: 0, pos: pos(s, 1), dir: { x: 0, z: 0 }, tow: { x: 0, z: 10, speed: 20, ticks: 30 } })),
    });
    expect([of(tow.log, "tow").map(({ t, e }) => [t, e.phase]), tow.trace[0]!.units[0]!.tow]).toEqual([[[0, "end"]], null]);
    const root = play(3, (k) => ({ e: k === 0 }), { each: (k, s) => void (k === 0 && (unitById(s, 1)!.status.rootUntil = s.tick + 30)) });
    expect([of(root.log, "reject").map(({ e }) => e.reason), of(root.log, "dash")]).toEqual([["rooted"], []]);
  });
});

describe("Air: tornado (C)", () => {
  const CENTER_PITCH = pitchTo(10, 0); // точка на полу в 10 м: (0, 0, −10)
  const cast = (k: number) => ({ c: k === 0, pitch: CENTER_PITCH });

  it("over the void — noTarget", () => {
    const r = play(3, (k) => ({ c: k === 0, yaw: -Math.PI / 2 }), { spawn: { pos: { x: 15, y: 0, z: 0 }, yaw: -Math.PI / 2 } });
    expect([of(r.log, "reject").map(({ e }) => [e.slot, e.reason]), r.s.zones]).toEqual([[["c", "noTarget"]], []]);
  });

  it("grows 30 ticks, lives 240; cooldown 1080", () => {
    const r = play(280, cast);
    expect(of(r.log, "zone").map(({ t, e }) => [t, e.kind, e.phase])).toEqual([[0, "tornado", "telegraph"], [30, "tornado", "arm"], [270, "tornado", "end"]]);
    const z = r.trace[0]!.zones[0]!;
    expect(z.shape.type === "disc" && [Math.abs(z.shape.center.x) < 1e-9, z.shape.center.y, Number(z.shape.center.z.toFixed(6)), z.shape.radius]).toEqual([true, 0, -10, 5]);
    expect(r.trace[0]!.units[0]!.mage!.ready.c).toBe(r.start + 1080);
  });

  it("pulls 2.5 m/s to the centre (Earth 1.25); a runner at 7 m/s gets away; an anchored dummy stays", () => {
    const r = play(91, cast, {
      others: [mageAt("earth", -4, -10), mageAt("air", 0, -14)],
      dummies: [at(4, -10), at(4 * Math.SQRT1_2, -10 + 4 * Math.SQRT1_2)],
      each: (k, s) => void (k === 0 && (unitById(s, 5)!.status.anchoredUntil = s.tick + 1000)),
      inputs: (k) => (k >= 30 ? { 3: { moveZ: 1 } } : {}),
    });
    const s = r.trace[89]!;
    expect([pos(s, 4).x, pos(s, 2).x].map((v) => Number(v.toFixed(3)))).toEqual([1.5, -2.75]);
    expect(pos(r.trace[29]!, 4).x).toBe(4); // до взвода не тянет
    expect(pos(s, 3).z).toBeLessThan(-15);
    expect([pos(s, 5).x, pos(s, 5).z]).toEqual([4 * Math.SQRT1_2, -10 + 4 * Math.SQRT1_2]);
    // импульсы: 4 урона раз в 30 тиков, урон по времени
    const pulses = hitsBy(r.log, "tornado").filter(({ e }) => e.target === 5);
    expect(pulses.map(({ t, e }) => [t, e.amount, e.dot, e.source])).toEqual([[30, 4, true, 1], [60, 4, true, 1], [90, 4, true, 1]]);
  });

  it("does not reach 0.5 m below or 4 m above its base", () => {
    const c = testContext([{ box: aabb(-3, 0, -13, 3, 1, -7) }, { box: aabb(-4.5, 0, -10.5, -3.5, 5.1, -9.5) }, { box: aabb(-0.5, 0, -14.5, 0.5, 4.9, -13.5) }]);
    const r = play(70, () => ({ c: true, pitch: pitchTo(10, 1) }), { c, dummies: [at(4, -10), at(-4, -10, 5.1), at(0, -14, 4.9)] });
    const z = r.trace[0]!.zones[0]!;
    expect(z.shape.type === "disc" && z.shape.center.y).toBe(1);
    expect([...new Set(hitsBy(r.log, "tornado").map(({ e }) => e.target))]).toEqual([4]);
    expect([pos(r.s, 2), pos(r.s, 3)]).toEqual([{ x: 4, y: 0, z: -10 }, { x: -4, y: 5.1, z: -10 }]);
  });

  it("the core launches 3 m with «В воздухе», no more often than immunity allows: 2 in its life", () => {
    let top = 0;
    const r = play(280, (k, s) => {
      top = Math.max(top, pos(s, 2).y);
      return { c: k === 0, pitch: pitchTo(10) };
    }, { dummies: [at(0, -10)] });
    const launches = of(r.log, "status").filter(({ e }) => e.status === "airborne");
    expect(launches.map(({ t, e }) => [t, e.target, e.source])).toEqual([[30, 2, 1], [168, 2, 1]]);
    expect(top).toBeCloseTo(3, 1);
  });

  it("lifts its owner 2 m from the floor, no damage or status, once a second; does not pull the owner", () => {
    let top = 0;
    const r = play(240, (k, s) => {
      top = Math.max(top, pos(s, 1).y);
      return { c: k === 0, pitch: -1.5 };
    });
    expect(r.trace.flatMap((s, k) => (vel(s, 1).y > 8.9 ? [k] : []))).toEqual([30, 90, 150, 210]);
    expect(top).toBeCloseTo(2, 1);
    expect([of(r.log, "hit"), of(r.log, "status")]).toEqual([[], []]);
    const off = play(120, (k) => ({ c: k === 0, pitch: pitchTo(3, 0) }));
    expect([pos(off.s, 1), of(off.log, "hit")]).toEqual([{ x: 0, y: 0, z: 0 }, []]);
  });
});

describe("Air: «Огненный смерч» (Р10)", () => {
  const FIRE_FAR = mageAt("fire", -30, 30);

  it("a fireball exploding by an armed tornado sets it on fire for the bomber: 8 a pulse and burning, the Air mage is a target now", () => {
    let zone = -1;
    const r = play(60, (k) => ({ c: k === 0, pitch: pitchTo(4, 0) }), {
      others: [FIRE_FAR],
      each: (k, s) => {
        if (k === 0) return;
        zone = s.zones[0]!.id;
        if (k !== 40) return;
        const id = spawnProjectile(s, tickOf(s), 2, "fireball", { x: 6, y: 1, z: -4 }, { x: 0, y: 0, z: 1 });
        s.projectiles.find((p) => p.id === id)!.endTick = s.tick + 1;
      },
    });
    expect(of(r.log, "reaction").map(({ t, e }) => [t, e.kind, e.owner, e.zone])).toEqual([[40, "fireTornado", 2, zone]]);
    expect([r.trace[40]!.zones[0]!.kind, r.trace[40]!.zones[0]!.owner]).toEqual(["fireTornado", 2]);
    const onAir = hitsBy(r.log, "tornado").filter(({ e }) => e.target === 1);
    expect(onAir[0]).toEqual({ t: 40, e: expect.objectContaining({ source: 2, amount: AIR.tornado.firePulseDamage, dot: true }) });
    expect(onAir.every(({ t }) => t >= 40)).toBe(true);
    expect(of(r.log, "status").some(({ t, e }) => t === 40 && e.target === 1 && e.status === "burning" && e.source === 2)).toBe(true);
  });

  it("a fire wall born after the tornado is absorbed and gives the tornado to the wall's owner; an older one — to Air", () => {
    const wall = (born: number, s: MatchState) =>
      spawnZone(s, tickOf(s), { owner: 2, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: aabb(-5, 0, -10.3, 5, 2.5, -9.7) }, bornTick: born, armTick: s.tick, endTick: s.tick + 300 });
    let late = -1;
    const r = play(45, cast10, { others: [FIRE_FAR], each: (k, s) => void (k === 40 && (late = wall(s.tick, s))) });
    expect(of(r.log, "reaction").map(({ t, e }) => [t, e.owner])).toEqual([[40, 2]]);
    expect(of(r.log, "zone").filter(({ e }) => e.zone === late).map(({ t, e }) => [t, e.phase])).toEqual([[40, "end"]]); // telegraph — вне шага
    expect(r.trace[40]!.zones.map((z) => [z.kind, z.owner])).toEqual([["fireTornado", 2]]);
    const old = play(35, cast10, { others: [FIRE_FAR], each: (k, s) => void (k === 0 && wall(s.tick - 1, s)) });
    expect(of(old.log, "reaction").map(({ t, e }) => [t, e.owner])).toEqual([[30, 1]]);
    expect(old.trace[30]!.zones.map((z) => [z.kind, z.owner])).toEqual([["fireTornado", 1]]);
  });

  it("a dash trail crossing the tornado does the same", () => {
    const r = play(45, cast10, {
      others: [FIRE_FAR],
      each: (k, s) =>
        void (k === 40 &&
          spawnZone(s, tickOf(s), {
            owner: 2, kind: "fireTrail", ability: "jetDash", shape: { type: "segment", a: { x: -6, y: 0, z: -10 }, b: { x: 6, y: 0, z: -10 }, halfW: 0.75 },
            bornTick: s.tick, armTick: s.tick, endTick: s.tick + 120,
          })),
    });
    expect(of(r.log, "reaction").map(({ t, e }) => [t, e.kind, e.owner])).toEqual([[40, "fireTornado", 2]]);
    expect(r.trace[40]!.zones.map((z) => z.kind)).toEqual(["fireTornado"]);
  });
});

/** Смерч в точку на полу в 10 м. */
function cast10(k: number): Partial<MatchInput> {
  return { c: k === 0, pitch: pitchTo(10, 0) };
}

describe("Air: determinism", () => {
  const air = (n: number): MatchInput => ({
    ...NO_MATCH_INPUT, moveZ: n % 200 < 120 ? 1 : -1, moveX: n % 80 < 40 ? 1 : -1, jump: n % 70 < 45 && n % 70 !== 1, yaw: Math.sin(n / 40) * 0.6, pitch: -0.12,
    primary: n % 60 < 25, q: n % 130 === 5, e: n % 90 === 7, c: n % 300 === 11,
  });
  const fire = (n: number): MatchInput => ({ ...NO_MATCH_INPUT, moveZ: n % 150 < 75 ? 1 : 0, yaw: Math.PI, pitch: -0.05, primary: n % 50 < 20, q: n % 200 === 50, e: n % 240 === 90, c: n % 260 === 120 });
  function run() {
    let s = createMatch({ mages: [{ element: "air", spawn: HOME }, { element: "fire", spawn: { pos: { x: 0, y: 0, z: -14 }, yaw: Math.PI } }], dummies: [] });
    const events: MatchEvent[] = [];
    for (let k = 0; k < 600; k++) {
      const r = stepMatch(deepFreeze(s), { 1: air(s.tick), 2: fire(s.tick) }, ctx);
      s = r.state;
      events.push(...r.events);
    }
    return { s, events };
  }

  it("600 ticks of Air vs Fire twice give byte-identical states and events", () => {
    const [a, b] = [run(), run()];
    expect([JSON.stringify(a.s) === JSON.stringify(b.s), JSON.stringify(a.events) === JSON.stringify(b.events)]).toEqual([true, true]);
    const kinds = new Set(a.events.filter((e) => e.type === "cast" && e.unit === 1).map((e) => (e.type === "cast" ? e.ability : "")));
    expect([...kinds].sort()).toEqual(["airSickle", "gust", "swoop", "tornado"]);
    expect(a.events.some((e) => e.type === "airJump")).toBe(true);
  });
});
