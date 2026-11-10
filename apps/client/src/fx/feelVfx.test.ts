import { describe, expect, it } from "vitest";
import type { Element, Unit, Zone } from "@doodlemagic/sim";
import type { Effect } from "../feel/effects";
import { QUAKE_AFTER_S, SCORCH_S, markDecal, zoneDecal } from "./decals";
import { IDLE_PALM_RATE, KNOCK_DUST_RATE, idlePalmParticle, knockDust, palmParticles, pebbleParticle } from "./presets";
import { FLASH_S, LOOT_SPARKS, MUZZLE_LIGHT, MUZZLE_PRIO, hitFreeze, lootSparkSpecs, muzzleOf, scorchFloor } from "./vfx";

const O = { x: 0, y: 0, z: 0 };
const unit = (x: number, y: number, onGround: boolean): Unit =>
  ({ id: 5, alive: true, move: { body: { pos: { x, y, z: 0 } }, onGround } }) as unknown as Unit;

describe("feel pass, part 2 (vfx)", () => {
  it("freezes the target by tier: fist 40 ms, stone, sickle and whip 50 ms, ability 60 ms; flash 90 / 100 / 130 ms (H2, L5)", () => {
    expect(hitFreeze(0.1, "fire")).toEqual({ tier: "small", freezeS: 0.04, flashS: 0.09 });
    for (const el of ["earth", "air", "water"] as const) expect(hitFreeze(0.1, el)).toEqual({ tier: "small", freezeS: 0.05, flashS: 0.09 });
    expect(hitFreeze(0.2, "fire")).toEqual({ tier: "medium", freezeS: 0.06, flashS: 0.1 });
    expect(hitFreeze(1, null).freezeS).toBeCloseTo(0.09);
    expect([FLASH_S.small, FLASH_S.medium, FLASH_S.large]).toEqual([0.09, 0.1, 0.13]);
    // 90 мс — не меньше трёх кадров на 40 FPS
    expect(FLASH_S.small * 40).toBeGreaterThanOrEqual(3);
  });

  it("lights the muzzle at the palm: fire 2.5 m for 70 ms on the palm flash, water 1.2 m for 60 ms on my whip strike, lowest priority (L6)", () => {
    expect([MUZZLE_LIGHT.fire.light, MUZZLE_LIGHT.fire.life, MUZZLE_LIGHT.water.light, MUZZLE_LIGHT.water.life]).toEqual([2.5, 0.07, 1.2, 0.06]);
    // только свет на мир: ореол в мире перед глазами лёг бы пятном на руку
    expect([MUZZLE_LIGHT.fire.halo, MUZZLE_LIGHT.water.halo]).toEqual([0, 0]);
    // ниже сфер (0,3) и рук магов (0,6): на низком пресете светит, только если источник свободен
    expect(MUZZLE_PRIO).toBeLessThan(0.3);
    const palm = (element: Element, preset: "flash" | "charge", hand: "auto" | "both" = "auto"): Effect => ({ kind: "palm", hand, element, preset });
    expect(muzzleOf(palm("fire", "flash"), 1, "left")).toEqual({ element: "fire", hand: "left" });
    expect(muzzleOf(palm("fire", "flash", "both"), 1, "right")).toBeNull(); // рывок, стена, Дыхание — не выстрел
    expect([muzzleOf(palm("fire", "charge"), 1, "right"), muzzleOf(palm("earth", "flash"), 1, "right"), muzzleOf(palm("air", "flash"), 1, "right")]).toEqual([null, null, null]);
    const arc = (owner: number): Effect => ({ kind: "burst", preset: "whipArc", pos: O, dir: O, scale: 1, owner });
    expect(muzzleOf(arc(1), 1, "left")).toEqual({ element: "water", hand: "right" });
    expect(muzzleOf(arc(2), 1, "left")).toBeNull();
  });

  it("enlarges the palm flash: fire core 9–12 cm up to 130 ms, water drops 3–5 cm, air strokes ×1.5 (L6)", () => {
    for (const r of [() => 0, () => 0.999]) {
      const cores = palmParticles("fire", "flash", O, r).slice(0, 3);
      expect(cores.every((p) => p.size0 >= 0.09 && Math.max(p.size0, p.size1) <= 0.12 && p.life >= 0.09 && p.life <= 0.13)).toBe(true);
      expect(palmParticles("water", "flash", O, r).every((p) => p.size0 >= 0.03 && p.size0 <= 0.05)).toBe(true);
      expect(palmParticles("air", "flash", O, r).every((p) => p.size0 >= 0.03 && p.size1 >= 0.075)).toBe(true);
    }
  });

  it("leaves a scorch for 12 s and quake cracks for 6 s on the floor (A3, round 4 V10)", () => {
    expect([SCORCH_S, QUAKE_AFTER_S]).toEqual([12, 6]);
    expect(markDecal("scorch", O, 1.2, 6)).toMatchObject({ stage: "active", progress: 0.5, style: "scorch", sizeX: 2.4, shape: "ring" });
    expect(markDecal("quake", O, 7, 3)).toMatchObject({ progress: 0.5, style: "quake", sizeX: 14 });
    expect([markDecal("scorch", O, 1, 12), markDecal("quake", O, 7, 6.1)]).toEqual([null, null]);
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

describe("loot sparks (phase 9, L14)", () => {
  it("flies 7 sparks of the killer's element from the victim to the killer at 40 m/s and ends them there", () => {
    const from = { x: 0, y: 1, z: -12 };
    const to = { x: 0, y: 1, z: 0 };
    let r = 0;
    const sparks = lootSparkSpecs(from, to, "earth", () => ((r = (r + 0.37) % 1), r));
    expect(sparks.length).toBe(LOOT_SPARKS.n);
    expect(sparks.length).toBeLessThanOrEqual(40);
    for (const p of sparks) {
      expect(Math.hypot(p.vel.x, p.vel.y, p.vel.z)).toBeCloseTo(40, 6);
      // долетает до убийцы и гаснет там
      const end = { x: p.pos.x + p.vel.x * p.life, y: p.pos.y + p.vel.y * p.life, z: p.pos.z + p.vel.z * p.life };
      expect(Math.hypot(end.x - to.x, end.y - to.y, end.z - to.z)).toBeLessThan(1e-6);
      expect([p.alpha, p.gravity]).toEqual([0, 0]);
    }
    // из ущелья — не дальше 24 м (+ струйка), рядом с убийцей — ничего
    const far = lootSparkSpecs({ x: 0, y: -60, z: 0 }, to, "fire", () => 0.5);
    expect(Math.max(...far.map((p) => p.life))).toBeLessThanOrEqual((LOOT_SPARKS.maxM + LOOT_SPARKS.gapM * LOOT_SPARKS.n) / 40);
    expect(lootSparkSpecs(to, to, "fire", () => 0.5)).toEqual([]);
  });
});
