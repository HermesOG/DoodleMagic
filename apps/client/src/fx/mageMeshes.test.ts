import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ELEMENTS, PLAYER_HEIGHT } from "@doodlemagic/sim";
import { EYE_INK, INK } from "../render/palette";
import { DUMMY_PART_COUNT, DUMMY_TOP_M, createDummyMeshes, dummyElement, dummyParts, type DummyPart, type DummyPose } from "./dummyMeshes";
import { MAGE_PART_COUNT, MAGE_TOP_M, createMageMeshes, mageHands, mageLineScale, mageParts, type MagePart, type MagePose } from "./mageMeshes";

const at = { x: 2, y: 0.5, z: -3 };
const pose: MagePose = { pos: at, yaw: 0, pitch: 0, stride: 0, speed01: 0, airborne: false, flinch: 0, flash: false };
const part = <P extends MagePart | DummyPart>(ps: P[], name: P["part"]): P => ps.find((p) => p.part === name)!;
const FACE = ["mask", "eyeL", "eyeR"];
const HAT = ["brim", "crown", "cone", "tip"] as const;

/** Углы бокса части в мире — по её повороту, как его ставит InstancedMesh. */
function corners(p: MagePart | DummyPart): Vector3[] {
  const m = new Matrix4().compose(
    new Vector3(...p.pos),
    new Quaternion().setFromEuler(new Euler(p.tiltX, p.yaw, p.tiltZ, "XZY")),
    new Vector3(...p.scale),
  );
  const out: Vector3[] = [];
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) out.push(new Vector3(sx, sy, sz).applyMatrix4(m));
  return out;
}
/** Нижняя и верхняя точки бокса части в мире. */
function extentY(p: MagePart | DummyPart): { lo: number; hi: number } {
  const ys = corners(p).map((v) => v.y);
  return { lo: Math.min(...ys), hi: Math.max(...ys) };
}
function extentZ(p: MagePart | DummyPart): { lo: number; hi: number } {
  const zs = corners(p).map((v) => v.z);
  return { lo: Math.min(...zs), hi: Math.max(...zs) };
}
const top = (ps: (MagePart | DummyPart)[]): number => Math.max(...ps.map((p) => extentY(p).hi));

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
    expect(top(ps)).toBeLessThanOrEqual(at.y + MAGE_TOP_M + 1e-9);
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

  it("inverts the ink on a hit like a dummy: body becomes paper, the mask becomes ink, the eyes keep the element", () => {
    const calm = mageParts({ ...pose, element: "water" });
    expect(calm.filter((p) => !FACE.includes(p.part)).every((p) => p.ink === INK.enemy)).toBe(true);
    const lit = mageParts({ ...pose, element: "water", flash: true });
    expect([lit.filter((p) => !FACE.includes(p.part)).every((p) => p.ink === INK.flash), part(lit, "mask").ink]).toEqual([true, INK.enemy]);
    expect([part(lit, "eyeL").ink, part(lit, "eyeR").ink]).toEqual([INK.eyeWater, INK.eyeWater]);
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

describe("mage element: eyes and hat", () => {
  it("puts two eyes in the element's ink on the mask face, a few mm proud of it: seen only from the front", () => {
    for (const element of ELEMENTS) {
      const ps = mageParts({ ...pose, element });
      const mask = part(ps, "mask");
      const maskFront = mask.pos[2] - mask.scale[2] / 2;
      for (const name of ["eyeL", "eyeR"] as const) {
        const eye = part(ps, name);
        expect(eye.ink).toBe(EYE_INK[element]);
        // внутри маски по ширине и высоте
        expect(Math.abs(eye.pos[0] - mask.pos[0]) + eye.scale[0] / 2).toBeLessThan(mask.scale[0] / 2);
        expect(Math.abs(eye.pos[1] - mask.pos[1]) + eye.scale[1] / 2).toBeLessThan(mask.scale[1] / 2);
        // лицевая грань — перед маской не больше чем на 1 см, задняя — в маске: сбоку их не видно
        const front = eye.pos[2] - eye.scale[2] / 2;
        expect(maskFront - front).toBeGreaterThan(0);
        expect(maskFront - front).toBeLessThanOrEqual(0.01);
        expect(eye.pos[2] + eye.scale[2] / 2).toBeGreaterThan(maskFront);
      }
      expect(part(ps, "eyeL").pos[0]).toBeLessThan(part(ps, "eyeR").pos[0]);
    }
    // без стихии — глаза под цвет маски (их не видно), во вспышке тоже
    expect([part(mageParts(pose), "eyeL").ink, part(mageParts({ ...pose, flash: true }), "eyeR").ink]).toEqual([INK.halo, INK.enemy]);
    // глаза поворачиваются с головой: при yaw π/2 — на стороне −X
    const side = mageParts({ ...pose, yaw: Math.PI / 2, element: "fire" });
    expect(part(side, "eyeL").pos[0]).toBeLessThan(part(side, "mask").pos[0]);
  });

  it("adds at most two instances per mage for the eyes: the hat reuses the same four parts", () => {
    expect(MAGE_PART_COUNT).toBe(14);
    for (const element of ELEMENTS) {
      const ps = mageParts({ ...pose, element });
      expect(ps.map((p) => p.part)).toEqual(mageParts(pose).map((p) => p.part));
    }
  });

  it("shapes the hat by element: fire tall with the tip forward, earth low and wide, air long tip back, water tip hanging", () => {
    const hats = Object.fromEntries(ELEMENTS.map((el) => [el, mageParts({ ...pose, element: el })])) as Record<(typeof ELEMENTS)[number], MagePart[]>;
    const tops = ELEMENTS.map((el) => top(hats[el]));
    for (const el of ELEMENTS) {
      const ps = hats[el];
      // шляпа над хитбоксом и под полосой HP
      for (const name of HAT) expect(extentY(part(ps, name)).lo).toBeGreaterThan(at.y + PLAYER_HEIGHT - 1e-9);
      expect(top(ps)).toBeLessThanOrEqual(at.y + MAGE_TOP_M + 1e-9);
    }
    // полоса HP — над самой высокой шляпой, без лишнего зазора
    expect(Math.max(...tops)).toBeGreaterThan(at.y + MAGE_TOP_M - 0.02);
    // Огонь — выше всех, кончик впереди тульи (лицо — к −Z)
    expect(top(hats.fire)).toBe(Math.max(...tops));
    expect(part(hats.fire, "tip").pos[2]).toBeLessThan(part(hats.fire, "crown").pos[2] - 0.05);
    // Земля — ниже всех, поля шире всех
    expect(top(hats.earth)).toBe(Math.min(...tops));
    for (const el of ["fire", "air", "water"] as const) expect(part(hats.earth, "brim").scale[0]).toBeGreaterThan(part(hats[el], "brim").scale[0] + 0.1);
    // Воздух — кончик дальше всех назад, на 30 см за тульей
    const back = (el: (typeof ELEMENTS)[number]) => extentZ(part(hats[el], "tip")).hi;
    expect(back("air")).toBe(Math.max(...ELEMENTS.map(back)));
    expect(back("air") - part(hats.air, "crown").pos[2]).toBeGreaterThan(0.3);
    // Вода — кончик свисает за спиной: ниже верха колпака, но над полями
    const tip = part(hats.water, "tip");
    expect(tip.pos[1]).toBeLessThan(extentY(part(hats.water, "cone")).hi - 0.05);
    expect(tip.pos[2]).toBeGreaterThan(part(hats.water, "crown").pos[2] + 0.1);
    expect(extentY(tip).lo).toBeGreaterThan(extentY(part(hats.water, "brim")).hi);
  });
});

describe("mage meshes", () => {
  it("draws every mage in two instanced meshes, the halo shell grows with distance, capped at max mages", () => {
    const m = createMageMeshes(2);
    const [parts, shells] = m.group.children as unknown as [{ count: number; visible: boolean }, { count: number; visible: boolean }];
    expect(m.group.children.length).toBe(2);
    m.update([pose, { ...pose, pos: { x: 0, y: 0, z: 0 } }, pose], mageLineScale(1080, 70), { x: 0, y: 1.6, z: 10 });
    // маска и глаза — без оболочки: их обводит ореол головы
    expect([parts.count, shells.count, parts.visible]).toEqual([2 * MAGE_PART_COUNT, 2 * (MAGE_PART_COUNT - 3), true]);
    m.update([], 1, undefined);
    expect([parts.count, parts.visible, shells.visible]).toEqual([0, false, false]);
    // на 1080p, FOV 70: ореол — HALO_PX пикселей плюс радиус контура, как у манекена
    expect(mageLineScale(1080, 70) * 15).toBeCloseTo(((2 * 15 * Math.tan((35 * Math.PI) / 180)) / 540) * 2, 9);
    m.dispose();
  });

  it("writes the element's eye ink into the instance ink attribute", () => {
    const m = createMageMeshes(1);
    m.update([{ ...pose, element: "air" }], mageLineScale(1080, 70));
    const [parts] = m.group.children as unknown as [{ geometry: { getAttribute(n: string): { array: Float32Array } } }];
    const inks = Array.from(parts.geometry.getAttribute("aInk").array.slice(0, MAGE_PART_COUNT));
    expect(inks.filter((i) => i === INK.eyeAir)).toHaveLength(2);
    expect(inks.filter((i) => i === INK.enemy)).toHaveLength(MAGE_PART_COUNT - 3);
    m.dispose();
  });
});

describe("dummy — a mage on a stand", () => {
  const dpose: DummyPose = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, leanX: 0, leanZ: 0, flinch: 0, squash: 1, flash: false, bob: 0 };

  it("gives every dummy a mage head: mask, eyes and hat of its element, a robe instead of the box, the base on the floor", () => {
    for (const element of ELEMENTS) {
      const ds = dummyParts({ ...dpose, element });
      expect(ds.length).toBe(DUMMY_PART_COUNT);
      // голова, маска и глаза — те же, что у мага
      const ms = mageParts({ ...pose, pos: { x: 0, y: 0, z: 0 }, element });
      for (const name of ["head", "mask", "eyeL", "eyeR"] as const) {
        const [d, m] = [part(ds, name), part(ms, name)];
        expect([d.ink, d.scale]).toEqual([m.ink, m.scale]);
        for (let i = 0; i < 3; i++) expect(d.pos[i]).toBeCloseTo(m.pos[i]!, 9);
      }
      expect(part(ds, "eyeL").ink).toBe(EYE_INK[element]);
      // тело — до верха хитбокса 1,8 м, шляпа — над ним и ниже полосы HP манекена (2,2 м)
      expect(extentY(part(ds, "head")).hi).toBeCloseTo(PLAYER_HEIGHT, 9);
      for (const name of HAT) expect(extentY(part(ds, name)).lo).toBeGreaterThan(PLAYER_HEIGHT - 1e-9);
      expect(top(ds)).toBeLessThanOrEqual(DUMMY_TOP_M + 1e-9);
      expect(DUMMY_TOP_M).toBeLessThan(2.2);
      expect(Math.min(...ds.map((p) => extentY(p).lo))).toBeCloseTo(0, 9);
      // вместо коробки — мантия шире груди, как у мага
      expect(part(ds, "robe").scale[0]).toBeGreaterThan(part(ds, "chest").scale[0]);
    }
  });

  it("keeps the hat's element silhouette lower than the mage's: same widths and bends", () => {
    const mt = (el: (typeof ELEMENTS)[number]) => top(dummyParts({ ...dpose, element: el }));
    expect(mt("fire")).toBe(Math.max(...ELEMENTS.map(mt)));
    expect(mt("earth")).toBe(Math.min(...ELEMENTS.map(mt)));
    const fire = dummyParts({ ...dpose, element: "fire" });
    expect(part(fire, "tip").pos[2]).toBeLessThan(part(fire, "crown").pos[2]);
    const air = dummyParts({ ...dpose, element: "air" });
    expect(extentZ(part(air, "tip")).hi).toBeGreaterThan(extentZ(part(fire, "tip")).hi + 0.1);
    for (const el of ELEMENTS) {
      const [d, m] = [part(dummyParts({ ...dpose, element: el }), "brim"), part(mageParts({ ...pose, element: el }), "brim")];
      expect(d.scale[0]).toBe(m.scale[0]);
    }
  });

  it("keeps the eyes on a hit and tilts the bent hat parts with the dummy", () => {
    const lit = dummyParts({ ...dpose, element: "earth", flash: true });
    expect([part(lit, "eyeL").ink, part(lit, "eyeR").ink, part(lit, "mask").ink, part(lit, "robe").ink]).toEqual([INK.eyeEarth, INK.eyeEarth, INK.enemy, INK.flash]);
    // наклон назад (+X): шляпа уходит к +Z вместе с головой, загиб колпака сохраняется
    const calm = dummyParts({ ...dpose, element: "air" });
    const lean = dummyParts({ ...dpose, element: "air", leanX: 0.3 });
    expect(part(lean, "tip").pos[2]).toBeGreaterThan(part(calm, "tip").pos[2] + 0.3);
    const tipDir = (ps: DummyPart[]) => {
      const t = part(ps, "tip");
      return new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(t.tiltX, t.yaw, t.tiltZ, "XZY")));
    };
    // ось наконечника повернулась ровно на наклон корпуса
    expect(tipDir(lean).angleTo(tipDir(calm))).toBeCloseTo(0.3, 6);
  });

  it("picks the element by the dummy's number: neighbours differ, all four on six dummies", () => {
    const six = [2, 3, 4, 5, 6, 7].map(dummyElement);
    expect(new Set(six).size).toBe(4);
    for (let i = 1; i < six.length; i++) expect(six[i]).not.toBe(six[i - 1]);
    expect(dummyElement(-1)).toBe(ELEMENTS[3]);
  });

  it("draws dummies in two instanced meshes without shells on the mask and eyes", () => {
    const m = createDummyMeshes(2);
    m.update([{ pose: { ...dpose, element: "fire" }, distM: 5 }, { pose: dpose, distM: 12 }], 1080, 70);
    expect([m.parts.count, m.shells.count]).toEqual([2 * DUMMY_PART_COUNT, 2 * (DUMMY_PART_COUNT - 3)]);
    m.dispose();
  });
});
