import { describe, expect, it } from "vitest";
import { ABILITY_OF, CC_LIMITS, DUMMY, EARTH, ELEMENT_INFO, FIRE, KNOCKBACK, MAGE_REGEN, STATUS, TELEGRAPH_MIN_S, slotCooldownTicks, ticks } from "./defs";
import { aimDir, clonePlain, createDummyUnit, createMageUnit, createMatchState, rightXZ, statusFlags, unitById } from "./state";
import { ABILITY_IDS, ELEMENTS, NEVER, SLOTS } from "./types";

describe("ability tables follow GDD 4.3–4.4", () => {
  it("pins the Fire card", () => {
    expect([FIRE.hp, FIRE.runSpeed, FIRE.fireFists.damage, FIRE.fireFists.ratePerS, FIRE.fireFists.projectile.speed]).toEqual([150, 6.5, 12, 5, 40]);
    expect(FIRE.heat).toEqual({ perShot: 8, max: 100, coolPerS: 35, coolDelayS: 0.3, overheatS: 1.5, overheatRateMul: 0.5 });
    expect(FIRE.fireball).toMatchObject({ cooldownS: 8, windupS: 0.25, damageCenter: 50, damageEdge: 20, radiusM: 3, projectile: { speed: 22 } });
    expect(FIRE.jetDash).toMatchObject({ cooldownS: 8, distM: 8, durationS: 0.2, trailS: 2, trailDps: 6 });
    expect(FIRE.fireWall).toMatchObject({ cooldownS: 12, rangeM: 15, lengthM: 10, heightM: 2.5, lifeS: 5, telegraphS: 0.4, contactDamage: 30 });
  });

  it("pins the Earth card", () => {
    expect([EARTH.hp, EARTH.runSpeed, EARTH.passive.knockbackMul]).toEqual([170, 6, 0.5]);
    expect(EARTH.stoneShot).toMatchObject({ damage: 30, ratePerS: 1.9, windupS: 0.2, projectile: { speed: 40, radiusM: 0.25 } });
    expect(EARTH.stonePillar).toMatchObject({ cooldownS: 10, rangeM: 20, telegraphS: 0.6, damage: 35, sizeM: 1.2, heightM: 2.5, hp: 200, lifeS: 4, selfLiftM: 2.5, knockback: { upM: 3.5 } });
    expect(EARTH.stoneWall).toMatchObject({ cooldownS: 12, aheadM: 2, lengthM: 4, heightM: 2.5, thickM: 0.6, growS: 0.3, solidS: 0.2, hp: 250, lifeS: 6 });
    expect(EARTH.earthquake).toMatchObject({ cooldownS: 14, telegraphS: 0.4, radiusM: 7, damage: 40, slowMul: 0.6, slowS: 2, rootRadiusM: 3, rootS: 0.5 });
  });

  it("pins statuses, regen and dummies", () => {
    expect([STATUS.burning, STATUS.airborne, STATUS.hardCcImmunityS]).toEqual([{ dps: 6, durationS: 3, pulseS: 0.5 }, { noControlS: 0.3, damageMul: 1.15 }, 2]);
    expect([MAGE_REGEN, DUMMY.hp]).toEqual([{ delayS: 4, perS: 20, capFrac: 2 / 3 }, 170]);
  });

  it("keeps every telegraph ≥ 0.4 s, control within the GDD limits and knockback within the caps", () => {
    for (const s of [FIRE.fireWall.telegraphS, EARTH.stonePillar.telegraphS, EARTH.earthquake.telegraphS]) expect(s).toBeGreaterThanOrEqual(TELEGRAPH_MIN_S);
    expect([EARTH.earthquake.rootS <= CC_LIMITS.rootMaxS, 1 - EARTH.earthquake.slowMul <= CC_LIMITS.slowMaxFrac + 1e-12, EARTH.earthquake.slowS <= CC_LIMITS.slowMaxS]).toEqual([true, true, true]);
    for (const k of [FIRE.fireFists.knockback, FIRE.fireball.knockback, EARTH.stoneShot.knockback, EARTH.stonePillar.knockback, EARTH.earthquake.knockback]) {
      expect([k.distM <= KNOCKBACK.maxSideM, k.upM <= KNOCKBACK.maxUpM]).toEqual([true, true]);
    }
    expect(Math.max(FIRE.fireFists.knockback.distM, EARTH.stoneShot.knockback.distM)).toBeLessThanOrEqual(KNOCKBACK.juicePrimaryMaxM);
    expect(Math.max(EARTH.earthquake.knockback.distM, EARTH.stonePillar.knockback.distM)).toBeLessThanOrEqual(KNOCKBACK.juiceAbilityMaxM);
  });

  it("maps every slot of both elements to its own ability", () => {
    const ids = ELEMENTS.flatMap((e) => SLOTS.map((s) => ABILITY_OF[e][s]));
    expect([...ids].sort()).toEqual([...ABILITY_IDS].sort());
    expect([ELEMENT_INFO.fire.name, ELEMENT_INFO.earth.motto]).toEqual(["Огонь", "Строй стены, бей тяжело, стой насмерть"]);
  });

  it("converts seconds to whole ticks", () => {
    expect([ticks(0.25), ticks(0.2), ticks(0.4), ticks(1.5)]).toEqual([15, 12, 24, 90]);
    expect([slotCooldownTicks("fire", "primary"), slotCooldownTicks("earth", "primary"), slotCooldownTicks("fire", "q"), slotCooldownTicks("earth", "c")]).toEqual([12, 32, 480, 840]);
  });
});

describe("match state", () => {
  const mage = createMageUnit(1, "earth", { pos: { x: 1, y: 0, z: 2 }, yaw: 0.5 });
  const dummy = createDummyUnit(2, { pos: { x: -3, y: 0, z: 0 }, yaw: 0, patrolHalfM: 2 });

  it("creates plain-data units with full HP that survive JSON", () => {
    expect([mage.hp, mage.maxHp, dummy.hp, mage.mage?.ready]).toEqual([170, 170, 170, { primary: 0, q: 0, e: 0, c: 0 }]);
    expect(mage.mage?.pending).toEqual({ primary: NEVER, q: NEVER, e: NEVER, c: NEVER });
    const s = createMatchState([mage, dummy]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect([unitById(s, 2), unitById(s, 9)]).toEqual([s.units[1], undefined]);
  });

  it("clones deeply", () => {
    const s = createMatchState([mage, dummy]);
    clonePlain(s).units[0]!.move.body.pos.x = 99;
    expect(s.units[0]!.move.body.pos.x).toBe(1);
  });

  it("aims along −Z at yaw 0, up with positive pitch; right is +X; a fresh unit has no status", () => {
    const d = aimDir(0, 0);
    expect([Math.abs(d.x) < 1e-12, d.y, d.z]).toEqual([true, 0, -1]);
    const up = aimDir(0, 0.5);
    expect([up.y, Math.hypot(up.x, up.y, up.z)].map((v) => Number(v.toFixed(12)))).toEqual([Number(Math.sin(0.5).toFixed(12)), 1]);
    expect(rightXZ(0)).toEqual({ x: 1, z: 0 });
    expect(statusFlags(dummy, 0)).toEqual({ burning: false, slowed: false, rooted: false, airborne: false });
  });
});
