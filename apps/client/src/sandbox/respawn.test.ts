import { describe, expect, it } from "vitest";
import { buildGallery } from "@doodlemagic/arena";
import { createPlayer, createWorld } from "@doodlemagic/sim";
import { nextSpawnIndex, shouldRespawn, spawnPlayer } from "./respawn";

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
});
