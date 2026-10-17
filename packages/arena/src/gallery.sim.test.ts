import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT,
  NO_INPUT,
  PLAYER_HALF_W,
  PLAYER_HEIGHT,
  PLAYER_STEP,
  TICK_DT,
  bodyBox,
  createPlayer,
  createWorld,
  groundBelow,
  isFree,
  lineOfSight,
  stepPlayer,
  volumeAt,
  type ArenaData,
  type PlayerInput,
  type PlayerState,
  type Vec3,
  type World,
} from "@doodlemagic/sim";
import { GALLERY, buildGallery } from "./gallery";

/** Стык потоков A и B: та же арена глазами настоящей физики и луча по сетке. */
const arenas: [string, ArenaData][] = [
  ["full", buildGallery("full")],
  ["compact", buildGallery("compact")],
];

function run(world: World, s: PlayerState, inp: PlayerInput, ticks: number, each?: (s: PlayerState) => void): PlayerState {
  for (let t = 0; t < ticks; t++) {
    s = stepPlayer(s, inp, TICK_DT, world);
    each?.(s);
  }
  return s;
}

/** yaw, при котором «вперёд» смотрит из a в b. */
const yawTowards = (a: Vec3, b: Vec3): number => Math.atan2(-(b.x - a.x), -(b.z - a.z));

/** Обход по сетке 0,5 м: куда можно дойти пешком (ступень ≤ 0,55 м, спрыгнуть можно откуда угодно, зона смерти — нет). */
function reachable(world: World, start: Vec3): Vec3[] {
  const step = 0.5;
  const key = (p: Vec3) => `${Math.round(p.x / step)},${Math.round(p.z / step)},${Math.round(p.y * 100)}`;
  const body = (p: Vec3) => ({
    min: { x: p.x - PLAYER_HALF_W, y: p.y, z: p.z - PLAYER_HALF_W },
    max: { x: p.x + PLAYER_HALF_W, y: p.y + PLAYER_HEIGHT, z: p.z + PLAYER_HALF_W },
  });
  const first = { x: Math.round(start.x / step) * step, y: start.y, z: Math.round(start.z / step) * step };
  const seen = new Map<string, Vec3>([[key(first), first]]);
  const queue = [first];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
      const floor = groundBelow(world, { x: p.x + dx, y: p.y + PLAYER_STEP + 0.01, z: p.z + dz }, 30);
      if (floor === null || floor > p.y + PLAYER_STEP) continue;
      const q = { x: p.x + dx, y: floor, z: p.z + dz };
      if (seen.has(key(q)) || !isFree(world, body(q)) || volumeAt(world, body(q), "kill")) continue;
      seen.set(key(q), q);
      queue.push(q);
    }
  }
  return [...seen.values()];
}

describe.each(arenas)("gallery with the real physics (%s)", (_name, arena) => {
  const world = createWorld(arena.colliders, arena.volumes);

  it("lets every spawn stand still on the floor", () => {
    for (const sp of arena.spawns) {
      const s = run(world, createPlayer(sp.pos, sp.yaw), NO_INPUT, 30);
      expect(s.onGround).toBe(true);
      expect(s.body.pos.x).toBeCloseTo(sp.pos.x, 9);
      expect(s.body.pos.y).toBeCloseTo(sp.pos.y, 9);
      expect(s.body.pos.z).toBeCloseTo(sp.pos.z, 9);
    }
  });

  it("hides spawns from each other for the grid raycast too", () => {
    const eye = (p: Vec3) => ({ x: p.x, y: p.y + EYE_HEIGHT, z: p.z });
    for (const a of arena.spawns) for (const b of arena.spawns) if (a !== b) expect(lineOfSight(world, eye(a.pos), eye(b.pos))).toBe(false);
  });

  it("connects every spawn on foot with the rune platform and the gallery deck", () => {
    const deck = (p: Vec3) => Math.abs(p.y - GALLERY.deckY) < 1e-6 && Math.abs(p.z) < 1.5;
    const rune = (p: Vec3) => Math.abs(p.y) < 1e-6 && Math.abs(p.x) <= 1.5 && Math.abs(p.z) <= 1.5;
    const all = reachable(world, arena.spawns[0]!.pos);
    expect(all.some(deck)).toBe(true);
    expect(all.some(rune)).toBe(true);
    const keys = new Set(all.map((p) => `${p.x},${p.z}`));
    for (const sp of arena.spawns) expect(keys.has(`${Math.round(sp.pos.x * 2) / 2},${Math.round(sp.pos.z * 2) / 2}`)).toBe(true);
  });

  it("climbs the stairs to the gallery", () => {
    const from = { x: -13, y: 0, z: -8 };
    let maxY = 0;
    run(world, createPlayer(from), { ...NO_INPUT, moveZ: 1, yaw: Math.PI }, 120, (s) => {
      if (s.onGround) maxY = Math.max(maxY, s.body.pos.y);
    });
    expect(maxY).toBeCloseTo(GALLERY.deckY, 6);
  });
});

describe("gallery traversal (full)", () => {
  const arena = buildGallery("full");
  const world = createWorld(arena.colliders, arena.volumes);

  const updrafts = arena.volumes.filter((v) => v.kind === "updraft");
  const towers = arena.colliders.filter((c) => c.tag === "tower");
  /** Центр башни: середина объединения её боксов. */
  const target = {
    x: (Math.min(...towers.map((c) => c.box.min.x)) + Math.max(...towers.map((c) => c.box.max.x))) / 2,
    y: 0,
    z: (Math.min(...towers.map((c) => c.box.min.z)) + Math.max(...towers.map((c) => c.box.max.z))) / 2,
  };

  /**
   * Игрок встаёт на пол двора в 1,5 м от выемки с потоком, заходит в неё, а над башней рулит к её центру и там
   * гасит скорость обратным ходом (управление в воздухе 60 %). Возвращает последнее состояние и был ли он в потоке.
   */
  function rideUpdraft(w: World, lift: (typeof updrafts)[number]): { end: PlayerState; maxY: number; inLift: boolean; start: PlayerState } {
    const side = lift.box.max.z < 0 ? -1 : 1;
    const startPos = { x: (lift.box.min.x + lift.box.max.x) / 2, y: 0, z: side < 0 ? lift.box.min.z - 1.5 : lift.box.max.z + 1.5 };
    const start = run(w, createPlayer(startPos), NO_INPUT, 30);
    let s = start;
    let maxY = s.body.pos.y;
    let inLift = false;
    for (let t = 0; t < 240; t++) {
      const p = s.body.pos;
      // заходим в выемку, пока не взлетели; потом летим к центру башни
      const goal = inLift ? target : { x: startPos.x, y: 0, z: (lift.box.min.z + lift.box.max.z) / 2 };
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

  it("has an updraft notch on each side of the tower", () => {
    expect(updrafts).toHaveLength(2);
    expect(towers.length).toBeGreaterThan(0);
  });

  for (const lift of updrafts) {
    const side = lift.box.max.z < 0 ? "z<0" : "z>0";

    it(`lifts the player from the ${side} updraft onto the tower`, () => {
      const r = rideUpdraft(world, lift);
      // старт честный: стоит на полу двора вне геометрии, а не внутри стены
      expect(isFree(world, bodyBox(r.start.body))).toBe(true);
      expect(r.start.onGround).toBe(true);
      expect(r.start.body.pos.y).toBeCloseTo(0, 6);
      // поток сработал: игрок поднялся выше башни и сел на неё
      expect(r.inLift).toBe(true);
      expect(r.maxY).toBeGreaterThan(GALLERY.deckY + 1);
      expect(r.end.onGround).toBe(true);
      expect(r.end.body.pos.y).toBeCloseTo(GALLERY.deckY, 6);
      expect(Math.abs(r.end.body.pos.x - target.x)).toBeLessThan(2);
      expect(Math.abs(r.end.body.pos.z - target.z)).toBeLessThan(2.5);
    });

    it(`does not reach the tower from the ${side} notch without the updraft`, () => {
      const r = rideUpdraft(createWorld(arena.colliders, []), lift);
      expect(r.maxY).toBeLessThan(GALLERY.deckY - 1);
    });
  }

  it("drops a player who steps off the bridge into the kill volume", () => {
    const bridge = arena.colliders.find((c) => c.tag === "bridge")!;
    const mid = { x: (bridge.box.min.x + bridge.box.max.x) / 2, y: bridge.box.max.y, z: (bridge.box.min.z + bridge.box.max.z) / 2 };
    // на мосту стоять безопасно
    const onBridge = run(world, createPlayer(mid), NO_INPUT, 60, (s) => expect(volumeAt(world, bodyBox(s.body), "kill")).toBeNull());
    expect(onBridge.onGround).toBe(true);
    let killed = false;
    run(world, createPlayer(mid), { ...NO_INPUT, moveX: 1 }, 120, (s) => {
      if (volumeAt(world, bodyBox(s.body), "kill")) killed = true;
    });
    expect(killed).toBe(true);
  });
});
