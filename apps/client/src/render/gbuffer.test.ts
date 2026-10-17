import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { GBUFFER_VERT, cofactorNormal } from "./gbuffer";

const deg = (a: Vector3, b: Vector3) => (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;
const model = (scale: Vector3, rot = new Euler(0.45, -0.2, 0.12)) =>
  new Matrix4().compose(new Vector3(0.26, -0.25, -0.62), new Quaternion().setFromEuler(rot), scale);

/** Нормали по сфере: для каждой — верная (обратная транспонированная) и та, что даёт шейдер. */
function sphereNormals(): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 48; j++) {
      const th = Math.acos(1 - (2 * (i + 0.5)) / 24);
      const ph = (2 * Math.PI * (j + 0.5)) / 48;
      out.push(new Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)));
    }
  }
  return out;
}

describe("G-buffer tone normal", () => {
  // варежка — сфера, сплюснутая неравномерно: mat3(modelMatrix) * normal ошибается на ~49°, тон уходит в чужую полосу
  it("matches the inverse-transpose under a non-uniform scale (the old formula did not)", () => {
    const m = model(new Vector3(0.05, 0.085, 0.032));
    const truth = new Matrix3().getNormalMatrix(m);
    const m3 = new Matrix3().setFromMatrix4(m);
    let worstNew = 0;
    let worstOld = 0;
    for (const n of sphereNormals()) {
      const good = n.clone().applyMatrix3(truth).normalize();
      worstNew = Math.max(worstNew, deg(cofactorNormal(m, n), good));
      worstOld = Math.max(worstOld, deg(n.clone().applyMatrix3(m3).normalize(), good));
    }
    expect(worstNew).toBeLessThan(1e-4);
    expect(worstOld).toBeGreaterThan(40);
  });

  it("keeps the outward side under a mirror and stays defined when an axis is squashed to zero", () => {
    const mirror = model(new Vector3(-1, 1, 1));
    const truth = new Matrix3().getNormalMatrix(mirror);
    for (const n of sphereNormals()) expect(deg(cofactorNormal(mirror, n), n.clone().applyMatrix3(truth).normalize())).toBeLessThan(1e-4);

    // эффект сплющил шар в блин (масштаб y = 0): нормаль — по оси блина, а не NaN, как у обратной матрицы
    const flat = new Matrix4().makeScale(1, 0, 1);
    const up = cofactorNormal(flat, new Vector3(0.3, 0.9, 0.3).normalize());
    expect(up.toArray().every(Number.isFinite)).toBe(true);
    expect(deg(up, new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });

  it("is what the vertex shader does, for both the tone and the outline normal", () => {
    expect(GBUFFER_VERT).not.toMatch(/mat3\(modelMatrix\)\s*\*\s*normal/);
    expect(GBUFFER_VERT).toContain("worldNormal(mat3(modelMatrix), normal)");
    expect(GBUFFER_VERT).toContain("worldNormal(mat3(modelViewMatrix), normal)");
  });
});
