import { describe, expect, it } from "vitest";
import type { Unit, Zone } from "@doodlemagic/sim";
import { QUAKE_AFTER_S, SCORCH_S, markDecal, zoneDecal } from "./decals";
import { IDLE_PALM_RATE, KNOCK_DUST_RATE, idlePalmParticle, knockDust, pebbleParticle } from "./presets";
import { FLASH_S, hitFreeze, scorchFloor } from "./vfx";

const O = { x: 0, y: 0, z: 0 };
const unit = (x: number, y: number, onGround: boolean): Unit =>
  ({ id: 5, alive: true, move: { body: { pos: { x, y, z: 0 } }, onGround } }) as unknown as Unit;

describe("feel pass, part 2 (vfx)", () => {
  it("freezes the target by tier: fist 0, stone 30 ms, ability 60 ms; flash 60 / 100 / 130 ms (H2)", () => {
    expect(hitFreeze(0.1, "fire")).toEqual({ tier: "small", freezeS: 0, flashS: 0.06 });
    expect(hitFreeze(0.1, "earth")).toEqual({ tier: "small", freezeS: 0.03, flashS: 0.06 });
    expect(hitFreeze(0.2, "fire")).toEqual({ tier: "medium", freezeS: 0.06, flashS: 0.1 });
    expect(hitFreeze(1, null).freezeS).toBeCloseTo(0.09);
    expect([FLASH_S.small, FLASH_S.medium, FLASH_S.large]).toEqual([0.06, 0.1, 0.13]);
  });

  it("leaves a scorch for 8 s and quake cracks for 2.5 s on the floor (A3)", () => {
    expect([SCORCH_S, QUAKE_AFTER_S]).toEqual([8, 2.5]);
    expect(markDecal("scorch", O, 1.2, 4)).toMatchObject({ stage: "active", progress: 0.5, style: "scorch", sizeX: 2.4, shape: "ring" });
    expect(markDecal("quake", O, 7, 1.25)).toMatchObject({ progress: 0.5, style: "quake", sizeX: 14 });
    expect([markDecal("scorch", O, 1, 8), markDecal("quake", O, 7, 2.6)]).toEqual([null, null]);
  });

  it("puts the scorch on the floor under a standing target, none under a flying one", () => {
    expect(scorchFloor({ x: 0.3, y: 1.1, z: 0 }, [unit(0, 0.5, true)])).toBe(0.5);
    expect(scorchFloor({ x: 0.3, y: 3.1, z: 0 }, [unit(0, 2.5, false)])).toBeNull();
    expect(scorchFloor({ x: 9, y: 0.2, z: 0 }, [unit(0, 0, true)])).toBe(0.2);
  });

  it("keeps the element at the palms: fire 6 embers/s a hand, earth pebbles orbit the palm; knock dust ≤ 15/s (A5, K3)", () => {
    const r = () => 0.5;
    expect(IDLE_PALM_RATE.fire).toBe(6);
    expect(idlePalmParticle("fire", O, r).alpha).toBe(0);
    const a = pebbleParticle(O, 0, r).pos;
    const b = pebbleParticle(O, Math.PI, r).pos;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(0.1, 6);
    expect(KNOCK_DUST_RATE).toBeLessThanOrEqual(15);
    expect(knockDust(O, r).alpha).toBeGreaterThan(0);
  });

  it("gives the tornado and the spring their own floor marks, enemy ones flagged; steam has none", () => {
    const z = (kind: Zone["kind"], owner: number): Zone =>
      ({ id: 7, owner, kind, ability: "tornado", shape: { type: "disc", center: O, radius: 5 }, bornTick: 0, armTick: 30, endTick: 270, rehit: [] }) as Zone;
    expect(zoneDecal(z("tornado", 2), 60, 1)).toMatchObject({ style: "tornado", stage: "active", enemy: true, sizeX: 10 });
    expect(zoneDecal(z("fireTornado", 1), 60, 1)).toMatchObject({ style: "fireTornado", enemy: false });
    expect(zoneDecal(z("spring", 2), 10, 1)).toMatchObject({ style: "spring", stage: "telegraph", enemy: true });
    expect(zoneDecal(z("steam", 2), 60, 1)).toBeNull();
  });
});
