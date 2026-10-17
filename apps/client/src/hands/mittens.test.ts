import { Matrix4, Mesh, Vector3, type BufferGeometry, type Material } from "three";
import { describe, expect, it } from "vitest";
import { HANDS_FOV } from "../render/styleRenderer";
import { createMittens } from "./mittens";

const REST_POSE = { x: 0, y: 0, roll: 0, swing: 0 };

function meshes(scene: { traverse(cb: (o: unknown) => void): void }): Mesh[] {
  const out: Mesh[] = [];
  scene.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

function atRest() {
  const m = createMittens();
  m.update(REST_POSE, new Matrix4());
  m.scene.updateMatrixWorld(true);
  const part = (name: string) => {
    const mesh = m.scene.getObjectByName(name);
    if (!(mesh instanceof Mesh)) throw new Error(`no ${name}`);
    return mesh;
  };
  return { m, part };
}

describe("createMittens", () => {
  // шейдер G-буфера переводит нормаль в мир; масштаб формы запечён в геометрию, у мешей — только поворот и сдвиг
  it("bakes every shape into its geometry: no mesh carries a scale", () => {
    const { m } = atRest();
    for (const mesh of meshes(m.scene)) {
      const e = mesh.matrixWorld.elements;
      for (let c = 0; c < 3; c++) expect(Math.hypot(e[4 * c]!, e[4 * c + 1]!, e[4 * c + 2]!)).toBeCloseTo(1, 9);
    }
  });

  it("shares one material between all eight parts", () => {
    const { m } = atRest();
    const all = meshes(m.scene);
    expect(all).toHaveLength(8);
    expect(new Set(all.map((x) => x.material)).size).toBe(1);
  });

  it("frees its geometries and material on dispose", () => {
    const { m } = atRest();
    const all = meshes(m.scene);
    const geometries = new Set<BufferGeometry>(all.map((x) => x.geometry));
    const materials = new Set<Material>(all.map((x) => x.material as Material));
    let freed = 0;
    for (const r of [...geometries, ...materials]) r.addEventListener("dispose", () => freed++);
    m.dispose();
    expect(freed).toBe(geometries.size + materials.size);
  });

  // поза покоя: две варежки перед собой чуть внутрь, широкой стороной к камере (без ракурса), манжеты и рукава —
  // к нижним углам кадра и ближе к камере, чем кисть
  for (const side of ["right", "left"] as const) {
    it(`holds the ${side} mitten facing the camera with its sleeve toward the bottom corner`, () => {
      const { part } = atRest();
      const mitten = part(`mitten-${side}`);
      const sleeve = part(`sleeve-${side}`);
      const centre = new Vector3().setFromMatrixPosition(mitten.matrixWorld);
      const face = new Vector3(0, 0, 1).transformDirection(mitten.matrixWorld);
      const toCamera = centre.clone().negate().normalize();
      const angle = (Math.acos(Math.min(1, Math.abs(face.dot(toCamera)))) * 180) / Math.PI;
      expect(angle).toBeLessThan(20);

      const sleeveEnd = new Vector3(0, -0.16, 0).applyMatrix4(sleeve.matrixWorld);
      // рукав снизу и ближе к камере, чем кисть
      expect(sleeveEnd.y).toBeLessThan(centre.y - 0.15);
      expect(sleeveEnd.z).toBeGreaterThan(centre.z + 0.03);
      // кисть целиком в кадре 16:9, конец рукава — за нижним краем
      const tanHalf = Math.tan(((HANDS_FOV / 2) * Math.PI) / 180);
      const ndc = (p: Vector3) => ({ x: p.x / (-p.z * tanHalf * (16 / 9)), y: p.y / (-p.z * tanHalf) });
      expect(Math.abs(ndc(centre).x)).toBeLessThan(0.8);
      expect(ndc(centre).y).toBeGreaterThan(-0.85);
      expect(ndc(sleeveEnd).y).toBeLessThan(-1);
      // рукав уходит к своему углу: снаружи от кисти
      expect(Math.abs(ndc(sleeveEnd).x)).toBeGreaterThan(Math.abs(ndc(centre).x));
    });
  }
});
