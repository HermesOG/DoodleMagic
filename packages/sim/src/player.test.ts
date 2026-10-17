import { describe, expect, it } from "vitest";
import { aabb } from "./aabb";
import { GROUND_PROBE_M } from "./body";
import { DEFAULT_MOVE, NO_INPUT, createPlayer, eyePosition, stepPlayer } from "./player";
import {
  PLAYER_HALF_W,
  PLAYER_HEIGHT,
  TICK_DT,
  type Collider,
  type MoveParams,
  type PlayerInput,
  type PlayerState,
  type Volume,
} from "./types";
import { lengthXZ, vec3 } from "./vec";
import { createWorld, type World } from "./world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({
  box: aabb(x0, y0, z0, x1, y1, z1),
});
const flat = createWorld([col(-100, -1, -100, 100, 0, 100)]);
const MAX_PITCH = Math.PI / 2 - 0.01;

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { ...NO_INPUT, ...over };
}

function settle(world: World = flat, x = 0, z = 0): PlayerState {
  let s = createPlayer(vec3(x, 0, z));
  for (let t = 0; t < 5; t++) s = stepPlayer(s, NO_INPUT, TICK_DT, world);
  return s;
}

function runTicks(s: PlayerState, inp: PlayerInput, ticks: number, world: World = flat, p: MoveParams = DEFAULT_MOVE): PlayerState {
  for (let t = 0; t < ticks; t++) s = stepPlayer(s, inp, TICK_DT, world, p);
  return s;
}

/** Все числа в объекте конечны. */
function allFinite(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (v !== null && typeof v === "object") return Object.values(v).every(allFinite);
  return true;
}

/** Детерминированный ГПСЧ для тестов (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Где кончится тик в воздухе без опоры: та же трапеция, что в stepPlayer. */
function freeFallEnd(s: PlayerState, p: MoveParams = DEFAULT_MOVE): number {
  const vy1 = Math.max(-p.maxFallSpeed, s.body.vel.y - p.gravity * TICK_DT);
  return s.body.pos.y + ((s.body.vel.y + vy1) / 2) * TICK_DT;
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

describe("stepPlayer on flat ground", () => {
  it("stands still and stays on the ground", () => {
    const s = runTicks(settle(), NO_INPUT, 120);
    expect(s.onGround).toBe(true);
    expect(s.body.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("does not change the state it was given", () => {
    const s = settle();
    const before = JSON.stringify(s);
    stepPlayer(s, input({ moveZ: 1, jump: true }), TICK_DT, flat);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("runs forward along -Z at 6.5 m/s and reaches full speed within 0.15 s", () => {
    const s = runTicks(settle(), input({ moveZ: 1 }), 9);
    expect(lengthXZ(s.body.vel)).toBeCloseTo(DEFAULT_MOVE.runSpeed, 6);
    expect(s.body.vel.z).toBeCloseTo(-6.5, 6);
    const later = runTicks(s, input({ moveZ: 1 }), 60);
    expect(later.body.pos.z).toBeLessThan(-6);
  });

  it("turns with yaw: yaw = +90° runs along -X, strafe right runs along +X at yaw 0", () => {
    expect(runTicks(settle(), input({ moveZ: 1, yaw: Math.PI / 2 }), 30).body.vel.x).toBeCloseTo(-6.5, 6);
    expect(runTicks(settle(), input({ moveX: 1 }), 30).body.vel.x).toBeCloseTo(6.5, 6);
  });

  it("normalizes diagonal input", () => {
    const s = runTicks(settle(), input({ moveX: 1, moveZ: 1 }), 30);
    expect(lengthXZ(s.body.vel)).toBeCloseTo(6.5, 6);
  });

  it("stops when the keys are released", () => {
    const running = runTicks(settle(), input({ moveZ: 1 }), 30);
    const stopped = runTicks(running, NO_INPUT, 12);
    expect(lengthXZ(stopped.body.vel)).toBe(0);
  });

  it("honours custom MoveParams", () => {
    const p: MoveParams = { ...DEFAULT_MOVE, runSpeed: 10, jumpHeight: 2 };
    expect(runTicks(settle(), input({ moveZ: 1 }), 30, flat, p).body.vel.z).toBeCloseTo(-10, 9);
    let s = stepPlayer(settle(), input({ jump: true }), TICK_DT, flat, p);
    let apex = 0;
    for (let t = 0; t < 90; t++) {
      s = stepPlayer(s, input({ jump: true }), TICK_DT, flat, p);
      apex = Math.max(apex, s.body.pos.y);
    }
    expect(apex).toBeGreaterThan(1.99);
    expect(apex).toBeLessThanOrEqual(2 + 1e-9);
  });
});

describe("falling and landing", () => {
  it("clamps the fall speed at maxFallSpeed", () => {
    let s = runTicks(createPlayer(vec3(0, 1000, 0)), NO_INPUT, 180);
    expect(s.body.vel.y).toBe(-DEFAULT_MOVE.maxFallSpeed);
    const y = s.body.pos.y;
    s = stepPlayer(s, NO_INPUT, TICK_DT, flat);
    expect(s.body.vel.y).toBe(-DEFAULT_MOVE.maxFallSpeed);
    expect(s.body.pos.y).toBeCloseTo(y - DEFAULT_MOVE.maxFallSpeed * TICK_DT, 9);
    const slow = runTicks(createPlayer(vec3(0, 1000, 0)), NO_INPUT, 60, flat, { ...DEFAULT_MOVE, maxFallSpeed: 10 });
    expect(slow.body.vel.y).toBe(-10);
  });

  it("reports landVel in the landing tick only, within g·dt/2 of the ballistic speed", () => {
    let s = createPlayer(vec3(0, 3, 0));
    while (!s.onGround) {
      expect(s.landVel).toBe(0);
      s = stepPlayer(s, NO_INPUT, TICK_DT, flat);
    }
    const ballistic = -Math.sqrt(2 * DEFAULT_MOVE.gravity * 3);
    expect(s.landVel).toBeLessThan(0);
    expect(Math.abs(s.landVel - ballistic)).toBeLessThanOrEqual((DEFAULT_MOVE.gravity * TICK_DT) / 2 + 1e-9);
    expect(stepPlayer(s, NO_INPUT, TICK_DT, flat).landVel).toBe(0);
  });

  it("reports a landing that ends inside the ground probe and puts the feet exactly on the floor", () => {
    // с 2,505 м 30-й тик падения кончается примерно в 5 мм над полом, не касаясь его
    const s = runTicks(createPlayer(vec3(0, 2.505, 0)), NO_INPUT, 29);
    expect(s.onGround).toBe(false);
    expect(freeFallEnd(s)).toBeGreaterThan(0);
    expect(freeFallEnd(s)).toBeLessThan(GROUND_PROBE_M);
    const landing = stepPlayer(s, NO_INPUT, TICK_DT, flat);
    expect(landing.onGround).toBe(true);
    expect(landing.landVel).toBeLessThan(-9);
    expect(landing.body.pos.y).toBe(0);
    expect(landing.body.vel.y).toBe(0);
    // и дальше не проседает
    expect(runTicks(landing, NO_INPUT, 10).body.pos.y).toBe(0);
  });

  it("reports every landing with landVel < 0 and the feet exactly on the support, for many heights and speeds", () => {
    const rand = rng(11);
    let landings = 0;
    let insideProbe = 0;
    for (const top of [0, 0.3, 1.2345678]) {
      const w = createWorld([col(-100, top - 1, -100, 100, top, 100)]);
      for (let k = 0; k < 150; k++) {
        const start = createPlayer(vec3(rand() * 10 - 5, top + 0.01 + rand() * 6, rand() * 10 - 5));
        let s: PlayerState = { ...start, body: { ...start.body, vel: vec3(rand() * 16 - 8, rand() * 14 - 10, rand() * 16 - 8) } };
        for (let t = 0; t < 240; t++) {
          const next = stepPlayer(s, NO_INPUT, TICK_DT, w);
          if (!s.onGround && next.onGround) {
            landings++;
            if (freeFallEnd(s) > top) insideProbe++;
            expect(next.landVel, `top ${top}, drop ${k}`).toBeLessThan(0);
            expect(next.body.pos.y, `top ${top}, drop ${k}`).toBe(top);
          }
          s = next;
        }
      }
    }
    expect(landings).toBe(450);
    // часть приземлений — именно случай «кончили тик в пределах щупа, не коснувшись»
    expect(insideProbe).toBeGreaterThan(10);
  });

  it("reports a small landVel of −g·dt/2 on the first tick after createPlayer on a floor", () => {
    const s = stepPlayer(createPlayer(vec3(0, 0, 0)), NO_INPUT, TICK_DT, flat);
    expect(s.onGround).toBe(true);
    expect(s.landVel).toBeCloseTo(-(DEFAULT_MOVE.gravity * TICK_DT) / 2, 12);
  });

  it("stops a jump at a low ceiling, zeroes the upward speed and falls back", () => {
    const w = createWorld([col(-100, -1, -100, 100, 0, 100), col(-5, 2.5, -5, 5, 3, 5)]);
    let s = stepPlayer(settle(w), input({ jump: true }), TICK_DT, w);
    expect(s.body.vel.y).toBeGreaterThan(0);
    let bumped = false;
    for (let t = 0; t < 30 && !bumped; t++) {
      s = stepPlayer(s, input({ jump: true }), TICK_DT, w);
      bumped = !s.onGround && s.body.vel.y === 0;
    }
    expect(bumped).toBe(true);
    expect(s.body.pos.y + PLAYER_HEIGHT).toBeCloseTo(2.5, 9);
    const next = stepPlayer(s, input({ jump: true }), TICK_DT, w);
    expect(next.body.vel.y).toBeLessThan(0);
    expect(next.body.pos.y).toBeLessThan(s.body.pos.y);
  });
});

describe("jumping", () => {
  it("peaks at 1.25 m", () => {
    let s = stepPlayer(settle(), input({ jump: true }), TICK_DT, flat);
    let apex = 0;
    for (let t = 0; t < 60; t++) {
      s = stepPlayer(s, input({ jump: true }), TICK_DT, flat);
      apex = Math.max(apex, s.body.pos.y);
    }
    expect(apex).toBeGreaterThan(1.24);
    expect(apex).toBeLessThanOrEqual(1.25 + 1e-9);
    expect(s.onGround).toBe(true);
  });

  it("jumps once per press: holding the key does not bounce", () => {
    let s = settle();
    let takeoffs = 0;
    for (let t = 0; t < 180; t++) {
      const before = s.onGround;
      s = stepPlayer(s, input({ jump: true }), TICK_DT, flat);
      if (before && s.body.vel.y > 0) takeoffs++;
    }
    expect(takeoffs).toBe(1);
  });

  it("has no double jump", () => {
    let s = stepPlayer(settle(), input({ jump: true }), TICK_DT, flat);
    s = runTicks(s, NO_INPUT, 10);
    const vyBefore = s.body.vel.y;
    s = stepPlayer(s, input({ jump: true }), TICK_DT, flat);
    expect(s.body.vel.y).toBeLessThan(vyBefore);
  });
});

describe("coyote time and jump buffer, in whole ticks", () => {
  const ledge = createWorld([col(-100, -11, -100, 100, -10, 100), col(-10, -1, -10, 0, 0, 10)]);

  /** Прыжок нажат на k-м тике, который начинается в воздухе после схода с края (k = 1 — первый такой тик). */
  const coyoteJump = (k: number, p: MoveParams = DEFAULT_MOVE): boolean => {
    let s = settle(ledge, -1, 0);
    while (s.onGround) s = stepPlayer(s, input({ moveX: 1 }), TICK_DT, ledge, p);
    s = runTicks(s, input({ moveX: 1 }), k - 1, ledge, p);
    expect(s.onGround).toBe(false);
    s = stepPlayer(s, input({ moveX: 1, jump: true }), TICK_DT, ledge, p);
    return s.body.vel.y > 0;
  };

  /** Прыжок нажат в воздухе за n тиков до первого тика, который начинается на земле. */
  const bufferedJump = (n: number, p: MoveParams = DEFAULT_MOVE): boolean => {
    const from = vec3(0, 10, 0);
    let probe = createPlayer(from);
    let firstGroundTick = 0;
    while (!probe.onGround) {
      probe = stepPlayer(probe, NO_INPUT, TICK_DT, flat, p);
      firstGroundTick++;
    }
    let s = createPlayer(from);
    for (let t = 0; t <= firstGroundTick; t++) s = stepPlayer(s, input({ jump: t === firstGroundTick - n }), TICK_DT, flat, p);
    return s.body.vel.y > 0;
  };

  it("keeps the windows in seconds in PlayerState", () => {
    expect(settle().coyote).toBeCloseTo(DEFAULT_MOVE.coyoteTime, 12);
    const pressed = stepPlayer(createPlayer(vec3(0, 5, 0)), input({ jump: true }), TICK_DT, flat);
    expect(pressed.jumpBuffer).toBeCloseTo(7 * TICK_DT, 12);
  });

  it("accepts a coyote jump on the 6th airborne tick after walking off, not on the 7th", () => {
    expect(coyoteJump(1)).toBe(true);
    expect(coyoteJump(6)).toBe(true);
    expect(coyoteJump(7)).toBe(false);
  });

  it("buffers a press made 7 ticks before landing, not 8", () => {
    expect(bufferedJump(1)).toBe(true);
    expect(bufferedJump(7)).toBe(true);
    expect(bufferedJump(8)).toBe(false);
  });

  it("sizes both windows as ⌊time·60⌋ ticks, also for times whose tick residue is negative in binary", () => {
    const cases: [number, number][] = [
      [1 / 60, 1],
      [1 / 30, 2],
      [0.05, 3],
      [0.6, 36],
      [0.65, 39],
      [0.13, 7],
    ];
    for (const [time, ticks] of cases) {
      const p: MoveParams = { ...DEFAULT_MOVE, coyoteTime: time, jumpBufferTime: time };
      expect([coyoteJump(ticks, p), coyoteJump(ticks + 1, p)], `coyote ${time}`).toEqual([true, false]);
      expect([bufferedJump(ticks, p), bufferedJump(ticks + 1, p)], `buffer ${time}`).toEqual([true, false]);
    }
  });
});

describe("air control", () => {
  it("accelerates at 60 % of the ground rate in the air", () => {
    const ground = stepPlayer(settle(), input({ moveZ: 1 }), TICK_DT, flat);
    const air = stepPlayer(createPlayer(vec3(0, 5, 0)), input({ moveZ: 1 }), TICK_DT, flat);
    expect(lengthXZ(air.body.vel) / lengthXZ(ground.body.vel)).toBeCloseTo(0.6, 9);
  });

  it("keeps momentum in the air without input", () => {
    let s = runTicks(settle(), input({ moveZ: 1 }), 30);
    s = stepPlayer(s, input({ moveZ: 1, jump: true }), TICK_DT, flat);
    s = runTicks(s, NO_INPUT, 10);
    expect(s.onGround).toBe(false);
    expect(lengthXZ(s.body.vel)).toBeCloseTo(6.5, 6);
  });
});

describe("updraft", () => {
  const up: Volume = { kind: "updraft", box: aabb(-1, 0, -1, 1, 1, 1), liftM: 6 };
  const w = createWorld([col(-100, -1, -100, 100, 0, 100)], [up]);

  it("lifts the player to the height of the stream", () => {
    let s = settle(w);
    let apex = 0;
    for (let t = 0; t < 120; t++) {
      s = stepPlayer(s, NO_INPUT, TICK_DT, w);
      apex = Math.max(apex, s.body.pos.y);
    }
    expect(apex).toBeGreaterThan(5.9);
    expect(apex).toBeLessThan(6.2);
  });

  it("does not lift a player who only touches the side of the stream", () => {
    // подошва заходит в поток на 0,5 мкм — меньше OVERLAP_EPS
    expect(runTicks(settle(w, 1 + PLAYER_HALF_W - 5e-7, 0), NO_INPUT, 10, w).body.pos.y).toBe(0);
    expect(runTicks(settle(w, 1 + PLAYER_HALF_W - 1e-3, 0), NO_INPUT, 10, w).body.pos.y).toBeGreaterThan(0.5);
  });
});

describe("untrusted input", () => {
  const poisoned: [string, Partial<PlayerInput>][] = [
    ["yaw: Infinity", { moveZ: 1, yaw: Infinity }],
    ["yaw: NaN", { moveZ: 1, yaw: NaN }],
    ["moveX: NaN", { moveX: NaN, moveZ: 1 }],
    ["moveZ: -Infinity", { moveZ: -Infinity }],
    ["pitch: NaN", { moveZ: 1, pitch: NaN }],
  ];
  for (const [name, bad] of poisoned) {
    it(`recovers from one tick with ${name}, on the ground and in the air`, () => {
      let g = stepPlayer(settle(), input(bad), TICK_DT, flat);
      expect(allFinite(g)).toBe(true);
      g = runTicks(g, input({ moveZ: 1 }), 30);
      expect(allFinite(g)).toBe(true);
      expect(g.onGround).toBe(true);
      expect(g.body.vel.z).toBeCloseTo(-6.5, 6);

      let a = stepPlayer(createPlayer(vec3(0, 20, 0)), input(bad), TICK_DT, flat);
      expect(allFinite(a)).toBe(true);
      const y1 = a.body.pos.y;
      a = runTicks(a, input({ moveZ: 1 }), 20);
      expect(allFinite(a)).toBe(true);
      expect(a.body.pos.y).toBeLessThan(y1 - 1);
      expect(a.body.vel.y).toBeLessThan(0);
      expect(a.body.pos.z).toBeLessThan(0);
    });
  }

  it("keeps the previous yaw and pitch for non-finite values and clamps the rest", () => {
    const s = stepPlayer(settle(), input({ yaw: 1.5, pitch: 0.3 }), TICK_DT, flat);
    const bad = stepPlayer(s, input({ yaw: Infinity, pitch: NaN }), TICK_DT, flat);
    expect([bad.yaw, bad.pitch]).toEqual([1.5, 0.3]);
    expect(stepPlayer(s, input({ pitch: 10 }), TICK_DT, flat).pitch).toBe(MAX_PITCH);
    expect(stepPlayer(s, input({ pitch: -Infinity }), TICK_DT, flat).pitch).toBe(0.3);
    expect(runTicks(settle(), input({ moveX: 5 }), 30).body.vel.x).toBeCloseTo(6.5, 6);
    const still = runTicks(settle(), input({ moveZ: -Infinity }), 30);
    expect(lengthXZ(still.body.vel)).toBe(0);
    expect(still.body.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("treats a jump flag that is not exactly true as released", () => {
    const s = stepPlayer(settle(), { ...NO_INPUT, jump: 1 as unknown as boolean }, TICK_DT, flat);
    expect(s.jumpHeld).toBe(false);
    expect(s.body.vel.y).toBe(0);
  });
});

describe("shared defaults", () => {
  it("are frozen", () => {
    expect(Object.isFrozen(DEFAULT_MOVE)).toBe(true);
    expect(Object.isFrozen(NO_INPUT)).toBe(true);
    expect(() => {
      (DEFAULT_MOVE as MoveParams).runSpeed = 100;
    }).toThrow(TypeError);
    expect(() => {
      (NO_INPUT as PlayerInput).jump = true;
    }).toThrow(TypeError);
    expect(DEFAULT_MOVE.runSpeed).toBe(6.5);
    expect(NO_INPUT.jump).toBe(false);
  });
});

/** Лестница вверх и вниз вдоль −Z, справа вдоль всего пути — стена x ∈ [1,5; 2]. */
function stairsWorld(volumes: Volume[] = []): World {
  const cs: Collider[] = [col(-100, -1, -100, 100, 0, 100), col(1.5, 0, -40, 2, 3, 10)];
  for (let i = 0; i < 4; i++) cs.push(col(-4, 0, -6 - i, 1.5, 0.3 * (i + 1), -5 - i));
  cs.push(col(-4, 0, -14, 1.5, 1.2, -9));
  for (let i = 0; i < 3; i++) cs.push(col(-4, 0, -15 - i, 1.5, 0.9 - 0.3 * i, -14 - i));
  return createWorld(cs, volumes);
}

/** Сценарий по земле: туда по лестнице вдоль стены, обратно, потом круг; три прыжка. */
const groundScript = (t: number): PlayerInput => {
  if (t < 240) return { moveX: 0.6, moveZ: 1, jump: t >= 225 && t < 228, yaw: 0, pitch: 0 };
  if (t < 480) return { moveX: -0.6, moveZ: 1, jump: t >= 460 && t < 463, yaw: Math.PI, pitch: 0.1 };
  if (t < 500) return { ...NO_INPUT, yaw: Math.PI };
  return { moveX: 0, moveZ: 1, jump: t >= 700 && t < 703, yaw: Math.PI + (t - 500) * 0.015, pitch: -0.2 };
};

describe("immutability", () => {
  it("never writes to its state, input, params or world, all deeply frozen", () => {
    const up: Volume = { kind: "updraft", box: aabb(-3, 0, 2, -1, 1, 4), liftM: 3 };
    const fw = deepFreeze(stairsWorld([up]));
    const p = deepFreeze({ ...DEFAULT_MOVE });
    const w = stairsWorld([up]);
    let frozen = deepFreeze(settle(fw));
    let plain = settle(w);
    for (let t = 0; t < 600; t++) {
      frozen = deepFreeze(stepPlayer(frozen, deepFreeze(groundScript(t)), TICK_DT, fw, p));
      plain = stepPlayer(plain, groundScript(t), TICK_DT, w);
    }
    expect(JSON.stringify(frozen)).toBe(JSON.stringify(plain));
  });
});

describe("determinism", () => {
  // JSON печатает кратчайшую запись числа, которая читается обратно в тот же double,
  // поэтому равенство строк — это равенство всех чисел до бита (кроме знака нуля).
  // Проверяем повторяемость в одном движке: между движками Math.sin/Math.cos могут дать разницу в несколько ulp.
  const replay = (world: World, script: (t: number) => PlayerInput, ticks: number) => {
    let a = createPlayer(vec3(0, 0, 0));
    let b = createPlayer(vec3(0, 0, 0));
    let groundTicks = 0;
    let takeoffs = 0;
    let stepsUp = 0;
    let stepsDown = 0;
    let maxGroundY = 0;
    let maxX = -Infinity;
    for (let t = 0; t < ticks; t++) {
      const prev = a;
      a = stepPlayer(a, script(t), TICK_DT, world);
      b = stepPlayer(JSON.parse(JSON.stringify(b)) as PlayerState, script(t), TICK_DT, world);
      if (a.onGround) groundTicks++;
      if (prev.onGround && a.body.vel.y > 0) takeoffs++;
      if (prev.onGround && a.onGround && a.body.pos.y > prev.body.pos.y + 0.1) stepsUp++;
      if (prev.onGround && a.onGround && a.body.pos.y < prev.body.pos.y - 0.1) stepsDown++;
      if (a.onGround) maxGroundY = Math.max(maxGroundY, a.body.pos.y);
      maxX = Math.max(maxX, a.body.pos.x);
    }
    return { a, b, groundShare: groundTicks / ticks, takeoffs, stepsUp, stepsDown, maxGroundY, maxX };
  };

  it("repeats bit for bit within one engine, also after a JSON round trip (airborne-heavy script)", () => {
    const script = (t: number): PlayerInput => ({
      moveX: Math.round(Math.sin(t * 0.05)),
      moveZ: t % 200 < 150 ? 1 : -1,
      jump: t % 47 < 3,
      yaw: t * 0.013,
      pitch: Math.sin(t * 0.02) * 0.4,
    });
    const world = createWorld([
      col(-100, -1, -100, 100, 0, 100),
      col(3, 0, -20, 4, 1, 20),
      col(-6, 0, -6, -4, 0.4, 6),
      col(-15, 0, 5, 15, 3, 6),
    ]);
    const { a, b } = replay(world, script, 1200);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(eyePosition(a).y).toBeCloseTo(a.body.pos.y + 1.6, 12);
  });

  it("repeats bit for bit on a grounded run: walking, stairs up and down, wall sliding, a few jumps", () => {
    const r = replay(stairsWorld(), groundScript, 900);
    expect(JSON.stringify(r.b)).toBe(JSON.stringify(r.a));
    expect(r.groundShare).toBeGreaterThan(0.8);
    expect(r.takeoffs).toBe(3);
    expect(r.stepsUp).toBeGreaterThanOrEqual(8);
    expect(r.stepsDown).toBeGreaterThanOrEqual(8);
    expect(r.maxGroundY).toBeCloseTo(1.2, 9);
    // скользили вдоль стены: упирались в неё, но не заходили внутрь
    expect(r.maxX).toBeCloseTo(1.5 - PLAYER_HALF_W, 9);
  });
});
