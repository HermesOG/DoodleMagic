import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT, NO_MATCH_INPUT, bodyBox, createMatch, createPlayer, createWorld, groundBelow, isFree, lineOfSight, matchContext, rightXZ, stepMatch, volumeAt,
  type MatchEvent, type Vec3,
} from "@doodlemagic/sim";
import { SEDLOVINA, buildSedlovina } from "./sedlovina";
import { TRAINING } from "./training";

describe.each(["full", "compact"] as const)("training ground (%s)", (variant) => {
  const arena = buildSedlovina(variant);
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

  it("puts two dummies at the open edge of the well, one on a bridge of the cross, one far beyond the well, and shows all six from the spawn", () => {
    const w = SEDLOVINA.voids.well;
    const edge = TRAINING.dummies.filter((d) => Math.abs(d.pos.z) < w.z1 && Math.abs(d.pos.x) > w.x1 && Math.abs(d.pos.x) < w.x1 + 1.3);
    expect(edge).toHaveLength(2);
    expect(TRAINING.dummies.filter((d) => d.pos.z > w.z0 && d.pos.z < -SEDLOVINA.islandHalf && Math.abs(d.pos.x) < 2)).toHaveLength(1);
    const dist = (p: Vec3) => Math.hypot(p.x - TRAINING.spawn.pos.x, p.z - TRAINING.spawn.pos.z);
    const far = TRAINING.dummies.at(-1)!;
    expect(far.pos.z).toBeGreaterThan(w.z1);
    expect(dist(far.pos)).toBeGreaterThanOrEqual(20);
    expect(dist(far.pos)).toBeLessThanOrEqual(25);
    // голова манекена (1,5 м над подошвой) видна от глаз мага; дальний — поверх парапета половины B
    const eye = { ...TRAINING.spawn.pos, y: TRAINING.spawn.pos.y + EYE_HEIGHT };
    expect(TRAINING.dummies.filter((d) => !lineOfSight(world, eye, { ...d.pos, y: d.pos.y + 1.5 })).map((d) => d.pos)).toStrictEqual([]);
  });
});

describe("knock-off (full)", () => {
  it("lets a fireball from the isthmus knock an edge dummy into the well", () => {
    const ctx = matchContext(buildSedlovina("full"));
    const target = TRAINING.dummies.find((d) => d.pos.x > SEDLOVINA.voids.well.x1 && Math.abs(d.pos.z) < SEDLOVINA.voids.well.z1)!;
    // маг в 3,6 м к востоку, лицом на запад, к колодцу (forwardXZ(π/2) = −x)
    let s = createMatch({ mages: [{ element: "fire", spawn: { pos: { x: target.pos.x + 3.6, y: 0, z: target.pos.z }, yaw: Math.PI / 2 } }], dummies: [target] });
    const ev: MatchEvent[] = [];
    for (let k = 0; k < 200; k++) {
      const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, yaw: Math.PI / 2, pitch: Math.atan2(1 - 1.6, 3.6), q: k === 10 } }, ctx);
      s = r.state;
      ev.push(...r.events);
    }
    expect(ev).toContainEqual(expect.objectContaining({ type: "hit", target: 2, ability: "fireball" }));
    expect(ev).toContainEqual(expect.objectContaining({ type: "fall", target: 2, credit: 1 }));
  });
});
