import { describe, expect, it } from "vitest";
import { buildGallery } from "@doodlemagic/arena";
import { NO_INPUT, TICK_DT, createPlayer, createWorld, stepPlayer } from "@doodlemagic/sim";
import { nextSpawnIndex, respawnPlayer, shouldRespawn, spawnPlayer } from "./respawn";

const arena = buildGallery("full");
const world = createWorld(arena.colliders, arena.volumes);

describe("respawn", () => {
  it("triggers in the gorge kill volume and below the arena, not on the bridge", () => {
    expect(shouldRespawn(world, createPlayer({ x: -4, y: -5, z: 3 }), arena)).toBe(true);
    expect(shouldRespawn(world, createPlayer({ x: 0, y: -40, z: 30 }), arena)).toBe(true);
    expect(shouldRespawn(world, createPlayer({ x: 0, y: 0, z: -3.5 }), arena)).toBe(false);
  });

  it("cycles through all spawns", () => {
    const seen = new Set<number>();
    let i = 0;
    for (let k = 0; k < 10; k++) {
      seen.add(i);
      i = nextSpawnIndex(i, 10);
    }
    expect(seen.size).toBe(10);
  });

  it("places the player at the spawn, facing its direction", () => {
    const s = spawnPlayer(arena, 12);
    expect(s.body.pos).toEqual(arena.spawns[2]!.pos);
    expect(s.yaw).toBe(arena.spawns[2]!.yaw);
  });

  // пробел зажат с прыжка до падения в ущелье и дальше: после появления маг не должен сам подпрыгнуть
  it("does not hop after a respawn while Space is still held", () => {
    const falling = { ...createPlayer({ x: 0, y: -40, z: 30 }), jumpHeld: true };
    let s = respawnPlayer(arena, 0, falling);
    expect(s.body.pos).toEqual(arena.spawns[0]!.pos);
    const y0 = s.body.pos.y;
    let maxY = y0;
    for (let k = 0; k < 90; k++) {
      s = stepPlayer(s, { ...NO_INPUT, jump: true, yaw: s.yaw }, TICK_DT, world);
      maxY = Math.max(maxY, s.body.pos.y);
    }
    expect(maxY - y0).toBeLessThan(0.01);
    // а отпущенный и снова нажатый пробел прыгает как обычно
    s = stepPlayer(s, { ...NO_INPUT, yaw: s.yaw }, TICK_DT, world);
    for (let k = 0; k < 20; k++) {
      s = stepPlayer(s, { ...NO_INPUT, jump: true, yaw: s.yaw }, TICK_DT, world);
      maxY = Math.max(maxY, s.body.pos.y);
    }
    expect(maxY - y0).toBeGreaterThan(0.5);
  });

  it("respawns without a held jump when Space was not held", () => {
    expect(respawnPlayer(arena, 3, createPlayer({ x: 0, y: -40, z: 30 })).jumpHeld).toBe(false);
  });
});
