import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT,
  NO_INPUT,
  NO_MATCH_INPUT,
  PLAYER_HALF_W,
  PLAYER_HEIGHT,
  PLAYER_STEP,
  TICK_DT,
  bodyBox,
  createMatch,
  createPlayer,
  createWorld,
  groundBelow,
  isFree,
  lineOfSight,
  matchContext,
  stepMatch,
  stepPlayer,
  volumeAt,
  type ArenaData,
  type MatchEvent,
  type PlayerInput,
  type PlayerState,
  type Vec3,
  type Volume,
  type World,
} from "@doodlemagic/sim";
import { SEDLOVINA, buildSedlovina } from "./sedlovina";

/** «Седловина» глазами настоящей физики и луча по сетке: спауны, пешие пути, лестницы, мосты, потоки, сбросы. */
const arenas: [string, ArenaData][] = [
  ["full", buildSedlovina("full")],
  ["compact", buildSedlovina("compact")],
];
const TIER = SEDLOVINA.tierY;

function run(world: World, s: PlayerState, inp: PlayerInput, ticks: number, each?: (s: PlayerState) => void): PlayerState {
  for (let t = 0; t < ticks; t++) {
    s = stepPlayer(s, inp, TICK_DT, world);
    each?.(s);
  }
  return s;
}

/** yaw, при котором «вперёд» смотрит из a в b. */
const yawTowards = (a: Vec3, b: Vec3): number => Math.atan2(-(b.x - a.x), -(b.z - a.z));
const eye = (p: Vec3) => ({ x: p.x, y: p.y + EYE_HEIGHT, z: p.z });
const body = (p: Vec3) => ({
  min: { x: p.x - PLAYER_HALF_W, y: p.y, z: p.z - PLAYER_HALF_W },
  max: { x: p.x + PLAYER_HALF_W, y: p.y + PLAYER_HEIGHT, z: p.z + PLAYER_HALF_W },
});
/** Точка — свободный пол: тело ни во что не входит и стоит ровно на опоре. */
const freeFloor = (w: World, p: Vec3) => isFree(w, body(p)) && groundBelow(w, { ...p, y: p.y + 0.5 }, 2) === p.y && volumeAt(w, body(p), "kill") === null;

/**
 * Пол под подошвой в (x, z) не выше top: как у физики, тело встаёт на самую высокую опору под всей подошвой, если она
 * не выше ступеньки над опорой под центром; иначе — null (упёрлись). Ступени лестниц уже подошвы, поэтому одной точки
 * под центром мало.
 */
function floorUnder(world: World, x: number, z: number, top: number): number | null {
  const first = groundBelow(world, { x, y: top, z }, 30);
  if (first === null) return null;
  let f: number = first;
  for (let k = 0; k < 3; k++) {
    let raise: number = f;
    for (const c of world.colliders) {
      if (c.noSight || !(c.box.min.x < x + PLAYER_HALF_W - 1e-6 && c.box.max.x > x - PLAYER_HALF_W + 1e-6 && c.box.min.z < z + PLAYER_HALF_W - 1e-6 && c.box.max.z > z - PLAYER_HALF_W + 1e-6)) continue;
      if (c.box.max.y > f + 1e-6 && c.box.min.y < f + PLAYER_HEIGHT) {
        if (c.box.max.y > f + PLAYER_STEP + 1e-6) return null;
        raise = Math.max(raise, c.box.max.y);
      }
    }
    if (raise === f) return f;
    f = raise;
  }
  return f;
}

/** Обход по сетке 0,5 м: куда можно дойти пешком (ступень ≤ 0,55 м, спрыгнуть можно откуда угодно, в зону смерти — нет). */
function reachable(world: World, start: Vec3): Vec3[] {
  const step = 0.5;
  const key = (p: Vec3) => `${Math.round(p.x / step)},${Math.round(p.z / step)},${Math.round(p.y * 100)}`;
  const first = { x: Math.round(start.x / step) * step, y: start.y, z: Math.round(start.z / step) * step };
  const seen = new Map<string, Vec3>([[key(first), first]]);
  const queue = [first];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
      const floor = floorUnder(world, p.x + dx, p.z + dz, p.y + PLAYER_STEP + 0.01);
      if (floor === null || floor > p.y + PLAYER_STEP) continue;
      const q = { x: p.x + dx, y: floor, z: p.z + dz };
      if (seen.has(key(q)) || !isFree(world, body(q)) || volumeAt(world, body(q), "kill")) continue;
      seen.set(key(q), q);
      queue.push(q);
    }
  }
  return [...seen.values()];
}

describe.each(arenas)("sedlovina with the real physics (%s)", (_name, arena) => {
  const world = createWorld(arena.colliders, arena.volumes);

  it("lets every spawn stand still on its floor", () => {
    for (const sp of arena.spawns) {
      const s = run(world, createPlayer(sp.pos, sp.yaw), NO_INPUT, 30);
      expect(s.onGround).toBe(true);
      expect(s.body.pos.x).toBeCloseTo(sp.pos.x, 9);
      expect(s.body.pos.y).toBeCloseTo(sp.pos.y, 9);
      expect(s.body.pos.z).toBeCloseTo(sp.pos.z, 9);
    }
  });

  it("hides spawns from each other for the grid raycast too, which still sees along an open courtyard", () => {
    for (const a of arena.spawns) for (const b of arena.spawns) if (a !== b) expect(lineOfSight(world, eye(a.pos), eye(b.pos))).toBe(false);
    // положительный контроль: вдоль полосы перед залом 16 м без преград — видно; сквозь зал — нет
    expect(lineOfSight(world, { x: -7, y: EYE_HEIGHT, z: -10 }, { x: 7, y: EYE_HEIGHT, z: -10 })).toBe(true);
    expect(lineOfSight(world, { x: -7, y: EYE_HEIGHT, z: -14 }, { x: 7, y: EYE_HEIGHT, z: -14 })).toBe(false);
  });

  it("connects every spawn on foot with the rune island, the four bridges of the cross and both courtyards", () => {
    const all = reachable(world, arena.spawns[0]!.pos);
    const at = (x: number, y: number, z: number, r = 0.6) => all.some((p) => Math.abs(p.y - y) < 1e-6 && Math.abs(p.x - x) <= r && Math.abs(p.z - z) <= r);
    const places: [string, boolean][] = [
      ["rune island", at(0, 0, 1.5)],
      ["bridge A", at(0, 0, -5)],
      ["bridge B", at(0, 0, 5)],
      ["west bridge", at(-5, 0, 0)],
      ["east bridge", at(5, 0, 0)],
      ["courtyard B", at(0, 0, 9.5)],
    ];
    if (arena.variant === "full") {
      places.push(
        ["plateau A", at(-27, TIER, -9)],
        ["plateau B", at(-27, TIER, 9)],
        ["hanging bridge", at(-27, TIER, 0)],
        ["pomost A", at(29, TIER, -13)],
        ["pomost B", at(29, TIER, 13)],
        ["garden bridge", at(30, 0, 0)],
      );
    }
    expect(places.filter(([, ok]) => !ok).map(([name]) => name)).toStrictEqual([]);
    const keys = new Set(all.map((p) => `${p.x},${p.z}`));
    for (const sp of arena.spawns) expect(keys.has(`${Math.round(sp.pos.x * 2) / 2},${Math.round(sp.pos.z * 2) / 2}`), JSON.stringify(sp.pos)).toBe(true);
  });

  const P = (x: number, z: number): Vec3 => ({ x, y: 0, z });
  it.each([
    ["courtyard A → bridge A → island", [P(0, -11), P(0, -6), P(0, 1)]],
    ["courtyard B → bridge B → island", [P(0, 11), P(0, 6), P(0, -1)]],
    ["west isthmus → round the lantern → west bridge → island", [P(-16, 2.5), P(-10.5, 1.4), P(-7, 0), P(-1, 0)]],
    ["east isthmus → round the lantern → east bridge → island", [P(16, -2.5), P(10.5, -1.4), P(7, 0), P(1, 0)]],
  ] as const)("walks %s without falling", (_route, path) => {
    const from = path[0]!;
    const to = path.at(-1)!;
    expect(freeFloor(world, from)).toBe(true);
    let s = createPlayer(from);
    for (const goal of path.slice(1)) {
      for (let t = 0; t < 300 && Math.hypot(goal.x - s.body.pos.x, goal.z - s.body.pos.z) > 0.3; t++) {
        s = stepPlayer(s, { ...NO_INPUT, moveZ: 1, yaw: yawTowards(s.body.pos, goal) }, TICK_DT, world);
        expect(volumeAt(world, bodyBox(s.body), "kill")).toBeNull();
      }
    }
    expect(Math.hypot(to.x - s.body.pos.x, to.z - s.body.pos.z)).toBeLessThan(0.5);
    expect(s.body.pos.y).toBeCloseTo(0, 6);
  });
});

describe("sedlovina traversal (full)", () => {
  const arena = buildSedlovina("full");
  const world = createWorld(arena.colliders, arena.volumes);
  const stairGroups = (() => {
    const steps = arena.colliders.filter((c) => c.tag === "stairs");
    const groups = new Map<string, typeof steps>();
    for (const c of steps) {
      // лестница — шесть ступеней с общей стороной: группа по знаку z и по половине карты по x
      const k = `${Math.sign(c.box.min.x + c.box.max.x)},${Math.sign(c.box.min.z + c.box.max.z)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(c);
    }
    return [...groups.values()];
  })();

  it("has four stairs of six steps and four updrafts", () => {
    expect(stairGroups.map((g) => g.length)).toStrictEqual([6, 6, 6, 6]);
    expect(arena.volumes.filter((v) => v.kind === "updraft")).toHaveLength(4);
  });

  // старт — из данных: игрок встаёт на пол в 1,5 м перед нижней ступенью посередине её ширины и идёт к верхней
  for (let g = 0; g < 4; g++) {
    it(`climbs stairs ${g + 1} onto the +2.8 tier`, () => {
      const byTop = [...stairGroups[g]!].sort((a, b) => a.box.max.y - b.box.max.y);
      const centre = (c: (typeof byTop)[number]): Vec3 => ({ x: (c.box.min.x + c.box.max.x) / 2, y: 0, z: (c.box.min.z + c.box.max.z) / 2 });
      const low = centre(byTop[0]!);
      const high = centre(byTop.at(-1)!);
      const alongX = Math.abs(high.x - low.x) > Math.abs(high.z - low.z);
      const dir = Math.sign(alongX ? high.x - low.x : high.z - low.z);
      const edge = alongX ? (dir > 0 ? byTop[0]!.box.min.x : byTop[0]!.box.max.x) : dir > 0 ? byTop[0]!.box.min.z : byTop[0]!.box.max.z;
      const from = alongX ? { x: edge - dir * 1.5, y: 0, z: low.z } : { x: low.x, y: 0, z: edge - dir * 1.5 };
      expect(freeFloor(world, from)).toBe(true);
      const beyond = alongX ? { x: high.x + dir * 3, y: 0, z: high.z } : { x: high.x, y: 0, z: high.z + dir * 3 };
      let maxY = 0;
      let end = createPlayer(from);
      for (let t = 0; t < 240; t++) {
        const p = end.body.pos;
        const go = Math.hypot(beyond.x - p.x, beyond.z - p.z) > 0.5;
        end = stepPlayer(end, go ? { ...NO_INPUT, moveZ: 1, yaw: yawTowards(p, beyond) } : NO_INPUT, TICK_DT, world);
        if (end.onGround) maxY = Math.max(maxY, end.body.pos.y);
      }
      expect(maxY).toBeCloseTo(TIER, 6);
      expect(end.onGround).toBe(true);
      expect(end.body.pos.y).toBeCloseTo(TIER, 6);
    });
  }

  /** Куда поток поднимает: центр ближайшего яруса (плато или помост) со стороны потока. */
  function tierTarget(lift: Volume): Vec3 {
    const cx = (lift.box.min.x + lift.box.max.x) / 2;
    const cz = (lift.box.min.z + lift.box.max.z) / 2;
    // у плато (запад) — на 4 м к западу, у помоста (восток) — на 4 м к его середине по z
    return cx < 0 ? { x: cx - 4, y: TIER, z: cz - Math.sign(cz) * 1.5 } : { x: cx + 1.5, y: TIER, z: cz + Math.sign(cz) * 4 };
  }

  /**
   * Игрок встаёт на пол в 1,5–2,5 м от потока со стороны двора, заходит в поток, а наверху рулит к ярусу и там гасит
   * скорость обратным ходом (управление в воздухе 60 %).
   */
  function rideUpdraft(w: World, lift: Volume): { end: PlayerState; maxY: number; inLift: boolean; start: PlayerState } {
    const cx = (lift.box.min.x + lift.box.max.x) / 2;
    const cz = (lift.box.min.z + lift.box.max.z) / 2;
    const startPos = cx < 0 ? { x: lift.box.max.x + 1, y: 0, z: cz } : { x: lift.box.min.x - 2.5, y: 0, z: cz };
    const target = tierTarget(lift);
    const start = run(w, createPlayer(startPos), NO_INPUT, 30);
    let s = start;
    let maxY = s.body.pos.y;
    let inLift = false;
    for (let t = 0; t < 300; t++) {
      const p = s.body.pos;
      const goal = inLift ? target : { x: cx, y: 0, z: cz };
      const far = Math.hypot(goal.x - p.x, goal.z - p.z) > 1;
      const moving = Math.hypot(s.body.vel.x, s.body.vel.z) > 0.5;
      const inp: PlayerInput = far
        ? { ...NO_INPUT, moveZ: 1, yaw: yawTowards(p, goal) }
        : moving
          ? { ...NO_INPUT, moveZ: -1, yaw: yawTowards({ x: 0, y: 0, z: 0 }, s.body.vel) }
          : NO_INPUT;
      s = stepPlayer(s, inp, TICK_DT, w);
      if (volumeAt(w, bodyBox(s.body), "updraft")) inLift = true;
      maxY = Math.max(maxY, s.body.pos.y);
    }
    return { end: s, maxY, inLift, start };
  }

  for (const [k, lift] of arena.volumes.filter((v) => v.kind === "updraft").entries()) {
    it(`lifts the player from updraft ${k + 1} onto its tier, and not without it`, () => {
      const r = rideUpdraft(world, lift);
      expect(isFree(world, bodyBox(r.start.body))).toBe(true);
      expect(r.start.onGround).toBe(true);
      expect(r.start.body.pos.y).toBeCloseTo(0, 6);
      expect(r.inLift).toBe(true);
      expect(r.maxY).toBeGreaterThan(TIER + 1);
      expect(r.end.onGround).toBe(true);
      expect(r.end.body.pos.y).toBeCloseTo(TIER, 6);
      const off = rideUpdraft(createWorld(arena.colliders, []), lift);
      expect(off.maxY).toBeLessThan(TIER - 1);
    });
  }

  it.each([
    ["the hanging bridge from plateau A to plateau B", { x: -27, y: TIER, z: -9 }, { x: -27, y: TIER, z: 9 }],
    ["the garden bridge from garden A to garden B", { x: 30, y: 0, z: -8 }, { x: 30, y: 0, z: 8 }],
  ] as const)("crosses %s on foot", (_route, from, to) => {
    expect(freeFloor(world, from)).toBe(true);
    let killed = false;
    let end = createPlayer(from);
    for (let t = 0; t < 240; t++) {
      const p = end.body.pos;
      end = stepPlayer(end, Math.hypot(to.x - p.x, to.z - p.z) > 0.5 ? { ...NO_INPUT, moveZ: 1, yaw: yawTowards(p, to) } : NO_INPUT, TICK_DT, world);
      if (volumeAt(world, bodyBox(end.body), "kill") || end.body.pos.y < from.y - 0.01) killed = true;
    }
    expect(killed).toBe(false);
    expect(end.onGround).toBe(true);
    expect(end.body.pos.z).toBeGreaterThan(to.z - 1);
    expect(end.body.pos.y).toBeCloseTo(from.y, 6);
  });

  it("drops a player who steps off the hanging bridge into the rift", () => {
    let killed = false;
    run(world, createPlayer({ x: -27, y: TIER, z: 0 }), { ...NO_INPUT, moveX: 1 }, 150, (s) => {
      if (volumeAt(world, bodyBox(s.body), "kill")) killed = true;
    });
    expect(killed).toBe(true);
  });
});

describe("knock-off (full)", () => {
  const arena = buildSedlovina("full");
  const ctx = matchContext(arena);
  const world = ctx.world;

  /** Маг стихии element в 3,6 / 2 м позади цели лицом по dir бьёт слотом q; события 200 тиков. */
  function strike(element: "fire" | "air", target: Vec3, dir: { x: number; z: number }, back: number): MatchEvent[] {
    const yaw = Math.atan2(-dir.x, -dir.z);
    const from = { x: target.x - dir.x * back, y: target.y, z: target.z - dir.z * back };
    let s = createMatch({ mages: [{ element, spawn: { pos: from, yaw } }], dummies: [{ pos: target, yaw: 0 }] });
    const ev: MatchEvent[] = [];
    // шар летит по дуге: целимся в грудь цели
    const pitch = element === "fire" ? Math.atan2(1 - EYE_HEIGHT, back) : 0;
    for (let k = 0; k < 200; k++) {
      const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, yaw, pitch, q: k === 10 } }, ctx);
      s = r.state;
      ev.push(...r.events);
    }
    return ev;
  }

  it("lets a fireball knock a dummy at the open edge of the isthmus into the well", () => {
    const target = { x: 8.1, y: 0, z: -3 };
    expect(freeFloor(world, target)).toBe(true);
    const ev = strike("fire", target, { x: -1, z: 0 }, 3.6);
    expect(ev).toContainEqual(expect.objectContaining({ type: "hit", target: 2, ability: "fireball" }));
    expect(ev).toContainEqual(expect.objectContaining({ type: "fall", target: 2, credit: 1 }));
  });

  it("does not let a Gust (the strongest ordinary knock, 7 m) throw anyone off the courtyards from more than 6 m from a void", () => {
    const voids = arena.volumes.filter((v) => v.kind === "kill").map((v) => v.box);
    const nearest = (p: Vec3) => {
      let best = { d: Infinity, x: 0, z: 0 };
      for (const v of voids) {
        const x = Math.min(Math.max(p.x, v.min.x), v.max.x);
        const z = Math.min(Math.max(p.z, v.min.z), v.max.z);
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < best.d) best = { d, x, z };
      }
      return best;
    };
    const fell: string[] = [];
    let hits = 0;
    // двор половины A: полоса 6…8,5 м от ближайшей пустоты — дальше Порыв не долетит и подавно; сетка 1 м
    for (let x = -21.5; x <= 21.5; x += 1) {
      for (let z = -21.5; z <= -6.5; z += 1) {
        const p = { x, y: 0, z };
        const n = nearest(p);
        if (n.d <= 6 || n.d > 8.5 || !freeFloor(world, p)) continue;
        const base = Math.atan2(n.z - p.z, n.x - p.x);
        for (const da of [-Math.PI / 4, 0, Math.PI / 4]) {
          const dir = { x: Math.cos(base + da), z: Math.sin(base + da) };
          const mage = { x: p.x - dir.x * 2, y: 0, z: p.z - dir.z * 2 };
          if (!freeFloor(world, mage)) continue;
          const ev = strike("air", p, dir, 2);
          if (ev.some((e) => e.type === "hit" && e.target === 2 && e.ability === "gust")) hits++;
          if (ev.some((e) => e.type === "fall" && e.target === 2)) fell.push(`(${x}, ${z}) towards ${((base + da) * 180) / Math.PI}°`);
        }
      }
    }
    // положительный контроль: Порыв правда бил (иначе тест прошёл бы и без толчка)
    expect(hits).toBeGreaterThan(40);
    expect(fell).toStrictEqual([]);
  }, 60_000);
});
