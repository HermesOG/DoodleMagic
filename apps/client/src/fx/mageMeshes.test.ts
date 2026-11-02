import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PLAYER_HEIGHT } from "@doodlemagic/sim";
import { INK } from "../render/palette";
import { MAGE_PART_COUNT, MAGE_TOP_M, createMageMeshes, mageHands, mageLineScale, mageParts, type MagePart, type MagePose } from "./mageMeshes";

const at = { x: 2, y: 0.5, z: -3 };
const pose: MagePose = { pos: at, yaw: 0, pitch: 0, stride: 0, speed01: 0, airborne: false, flinch: 0, flash: false };
const part = (ps: MagePart[], name: MagePart["part"]): MagePart => ps.find((p) => p.part === name)!;

/** Нижняя и верхняя точки бокса части в мире — по её повороту, как его ставит InstancedMesh. */
function extentY(p: MagePart): { lo: number; hi: number } {
  const m = new Matrix4().compose(
    new Vector3(...p.pos),
    new Quaternion().setFromEuler(new Euler(p.tiltX, p.yaw, p.tiltZ, "XZY")),
    new Vector3(...p.scale),
  );
  let lo = Infinity;
  let hi = -Infinity;
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    const y = new Vector3(sx, sy, sz).applyMatrix4(m).y;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return { lo, hi };
}

describe("mageParts", () => {
  it("builds the whole figure: legs on the sole, the body to 1.8 m, the hat above the hitbox", () => {
    const ps = mageParts(pose);
    expect(ps.length).toBe(MAGE_PART_COUNT);
    for (const leg of ["legL", "legR"] as const) expect(extentY(part(ps, leg)).lo).toBeCloseTo(at.y, 9);
    expect(Math.min(...ps.map((p) => extentY(p).lo))).toBeGreaterThan(at.y - 1e-9);
    // голова до верха хитбокса, поля и тулья — над ним
    expect(extentY(part(ps, "head")).hi).toBeCloseTo(at.y + PLAYER_HEIGHT, 9);
    expect(extentY(part(ps, "brim")).lo).toBeGreaterThan(at.y + PLAYER_HEIGHT - 1e-9);
    expect(extentY(part(ps, "crown")).lo).toBeGreaterThan(at.y + PLAYER_HEIGHT);
    expect(Math.max(...ps.map((p) => extentY(p).hi))).toBeLessThanOrEqual(at.y + MAGE_TOP_M + 1e-9);
  });

  it("puts the white mask on the side the mage looks at, for yaw 0 and π/2", () => {
    const front = mageParts(pose);
    expect([part(front, "mask").ink, part(front, "mask").pos[2] < part(front, "head").pos[2] - 0.15]).toEqual([INK.halo, true]);
    // yaw π/2 — взгляд вдоль −X
    const left = mageParts({ ...pose, yaw: Math.PI / 2 });
    expect(part(left, "mask").pos[0]).toBeLessThan(part(left, "head").pos[0] - 0.15);
    expect(Math.abs(part(left, "mask").pos[2] - part(left, "head").pos[2])).toBeLessThan(1e-9);
    // руки — перед грудью, на стороне взгляда
    const hands = mageHands({ ...pose, yaw: Math.PI / 2 });
    expect([hands.left.x < at.x - 0.2, hands.right.x < at.x - 0.2, hands.left.z > hands.right.z]).toEqual([true, true, true]);
  });

  it("spreads the legs at stride π/2 and full speed, keeps them together at speed 0", () => {
    const run = mageParts({ ...pose, stride: Math.PI / 2, speed01: 1 });
    const dl = part(run, "legL").pos[2] - at.z;
    const dr = part(run, "legR").pos[2] - at.z;
    // левая нога вперёд (−Z), правая назад
    expect([dl < -0.15, dr > 0.15]).toEqual([true, true]);
    const still = mageParts({ ...pose, stride: Math.PI / 2, speed01: 0 });
    expect(part(still, "legL").pos[2]).toBeCloseTo(part(still, "legR").pos[2], 9);
    expect(part(still, "legL").pos[2]).toBeCloseTo(at.z, 9);
    // скорость сверх бега не раскидывает ноги шире
    const fast = mageParts({ ...pose, stride: Math.PI / 2, speed01: 3 });
    expect(part(fast, "legL").pos[2]).toBeCloseTo(part(run, "legL").pos[2], 9);
  });

  it("tucks the feet up in the air", () => {
    const air = mageParts({ ...pose, airborne: true });
    for (const leg of ["legL", "legR"] as const) expect(extentY(part(air, leg)).lo).toBeGreaterThan(at.y + 0.1);
  });

  it("inverts the ink on a hit like a dummy: body becomes paper, the mask becomes ink", () => {
    const calm = mageParts(pose);
    expect(calm.filter((p) => p.part !== "mask").every((p) => p.ink === INK.enemy)).toBe(true);
    const lit = mageParts({ ...pose, flash: true });
    expect([lit.filter((p) => p.part !== "mask").every((p) => p.ink === INK.flash), part(lit, "mask").ink]).toEqual([true, INK.enemy]);
  });

  it("nods the head with the gaze, flinches back from the face, leans about the sole", () => {
    const up = mageParts({ ...pose, pitch: 0.8 });
    expect(part(up, "mask").pos[1]).toBeGreaterThan(part(mageParts(pose), "mask").pos[1]);
    expect(part(up, "head").tiltX).toBeCloseTo(0.4 * 0.8, 9);
    // вздрагивание лицом к −Z: верх уходит назад (+Z), голова сильнее корпуса
    const hit = mageParts({ ...pose, flinch: 0.2 });
    expect([part(hit, "chest").tiltX, part(hit, "head").tiltX]).toEqual([expect.closeTo(0.2, 9), expect.closeTo(0.28, 9)]);
    expect(part(hit, "head").pos[2]).toBeGreaterThan(at.z + 0.3);
    const leaning = mageParts({ ...pose, leanZ: 0.3 });
    // +Z уводит верх к −X, подошва остаётся на месте: край стопы уходит в пол лишь на полширины ноги × sin 0,3
    expect(part(leaning, "head").pos[0]).toBeLessThan(at.x - 0.3);
    expect(extentY(part(leaning, "legL")).lo).toBeGreaterThan(at.y - 0.07);
    expect(Math.abs((part(leaning, "legL").pos[1] + part(leaning, "legR").pos[1]) / 2 - (at.y + 0.43 * Math.cos(0.3)))).toBeLessThan(1e-9);
  });
});

describe("mage meshes", () => {
  it("draws every mage in two instanced meshes, the halo shell grows with distance, capped at max mages", () => {
    const m = createMageMeshes(2);
    const [parts, shells] = m.group.children as unknown as [{ count: number; visible: boolean }, { count: number; visible: boolean }];
    expect(m.group.children.length).toBe(2);
    m.update([pose, { ...pose, pos: { x: 0, y: 0, z: 0 } }, pose], mageLineScale(1080, 70), { x: 0, y: 1.6, z: 10 });
    expect([parts.count, shells.count, parts.visible]).toEqual([2 * MAGE_PART_COUNT, 2 * (MAGE_PART_COUNT - 1), true]);
    m.update([], 1, undefined);
    expect([parts.count, parts.visible, shells.visible]).toEqual([0, false, false]);
    // на 1080p, FOV 70: ореол — HALO_PX пикселей плюс радиус контура, как у манекена
    expect(mageLineScale(1080, 70) * 15).toBeCloseTo(((2 * 15 * Math.tan((35 * Math.PI) / 180)) / 540) * 2, 9);
    m.dispose();
  });
});
