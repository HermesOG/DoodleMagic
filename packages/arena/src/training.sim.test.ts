import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT, NO_MATCH_INPUT, bodyBox, createMatch, createPlayer, createWorld, groundBelow, isFree, lineOfSight, matchContext, rightXZ, stepMatch, volumeAt,
  type MatchEvent, type Vec3,
} from "@doodlemagic/sim";
import { GALLERY, buildGallery } from "./gallery";
import { TRAINING } from "./training";

describe.each(["full", "compact"] as const)("training ground (%s)", (variant) => {
  const arena = buildGallery(variant);
  const world = createWorld(arena.colliders, arena.volumes);
  const free = (p: Vec3) => {
    const box = bodyBox(createPlayer(p).body);
    return isFree(world, box) && groundBelow(world, { ...p, y: p.y + 0.5 }) === p.y && volumeAt(world, box, "kill") === null;
  };

  it("puts the mage and six dummies (two strafing) on free floor with clear patrol paths", () => {
    expect([TRAINING.dummies.length, TRAINING.dummies.filter((d) => (d.patrolHalfM ?? 0) > 0).length]).toEqual([6, 2]);
    for (const p of [TRAINING.spawn.pos, ...TRAINING.dummies.map((d) => d.pos)]) expect(free(p), JSON.stringify(p)).toBe(true);
    for (const d of TRAINING.dummies) {
      const r = rightXZ(d.yaw);
      const half = (d.patrolHalfM ?? 0) * 1.05;
      for (const s of [-1, -0.5, 0.5, 1]) expect(free({ x: d.pos.x + r.x * half * s, y: d.pos.y, z: d.pos.z + r.z * half * s })).toBe(true);
    }
  });

  it("puts two dummies at the open gorge edge and one on the bridge, and shows at least three from the spawn", () => {
    const g = GALLERY.gorge;
    expect(TRAINING.dummies.filter((d) => d.pos.z < g.z0 && d.pos.z > g.z0 - 1.3 && d.pos.x > g.x0 && d.pos.x < g.x1)).toHaveLength(2);
    expect(TRAINING.dummies.filter((d) => d.pos.z > g.z0 && d.pos.z < g.z1 && Math.abs(d.pos.x) < 1.5)).toHaveLength(1);
    const eye = { ...TRAINING.spawn.pos, y: TRAINING.spawn.pos.y + EYE_HEIGHT };
    expect(TRAINING.dummies.filter((d) => lineOfSight(world, eye, { ...d.pos, y: d.pos.y + 1 })).length).toBeGreaterThanOrEqual(3);
  });
});

describe("knock-off (full)", () => {
  it("lets a fireball from the courtyard knock an edge dummy into the gorge", () => {
    const ctx = matchContext(buildGallery("full"));
    const target = TRAINING.dummies.find((d) => d.pos.x > 2 && d.pos.z < GALLERY.gorge.z0)!;
    let s = createMatch({ mages: [{ element: "fire", spawn: { pos: { x: target.pos.x, y: 0, z: target.pos.z - 3.6 }, yaw: Math.PI } }], dummies: [target] });
    const ev: MatchEvent[] = [];
    for (let k = 0; k < 200; k++) {
      const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, yaw: Math.PI, pitch: Math.atan2(1 - 1.6, 3.6), q: k === 10 } }, ctx);
      s = r.state;
      ev.push(...r.events);
    }
    expect(ev).toContainEqual(expect.objectContaining({ type: "hit", target: 2, ability: "fireball" }));
    expect(ev).toContainEqual(expect.objectContaining({ type: "fall", target: 2, credit: 1 }));
  });
});
