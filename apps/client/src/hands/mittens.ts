import { CapsuleGeometry, CylinderGeometry, Group, Mesh, Scene, SphereGeometry, Vector3, type BufferGeometry, type Material, type Matrix4, type Object3D } from "three";
import { createInkMaterial, type SunUniform } from "../render/gbuffer";
import { INK, SUN_DIR } from "../render/palette";
import type { HandGesture } from "./gestures";
import type { HandPose } from "./motion";

/** Руки-«варежки» из примитивов. Живут в своей сцене в пространстве камеры и рисуются вторым слоем G-буфера. */
export interface Mittens {
  readonly scene: Scene;
  /**
   * Поза из updateHandRig, обратная матрица мировой камеры (чтобы солнце на руках совпадало с миром) и жест каста
   * из stepGestures: его смещение и наклон прибавляются к позе покоя каждой руки. Без жеста — руки в покое.
   */
  update(pose: HandPose, cameraWorldInverse: Matrix4, gesture?: HandGesture): void;
  /** Центры варежек в пространстве камеры рук после последнего update. Каждый раз те же два вектора. */
  palms(): { right: Vector3; left: Vector3 };
  /** Освобождает геометрию и материал (они общие у обеих рук). */
  dispose(): void;
}

const REST = { x: 0.26, y: -0.25, z: -0.62 } as const;
/**
 * Наклон кисти, рад (Эйлер XYZ): x — к камере широкой стороной, y — ладонью чуть внутрь, z — верхом к центру кадра.
 * Руки ниже центра кадра (взгляд на них — ≈ 22° вниз), поэтому кисть откинута верхом от камеры: широкая сторона
 * смотрит на камеру, а рукав идёт к камере и к нижнему углу кадра.
 */
const TILT = { x: -0.35, y: 0.2, z: 0.22 } as const;

interface Parts {
  mitten: BufferGeometry;
  thumb: BufferGeometry;
  cuff: BufferGeometry;
  sleeve: BufferGeometry;
}

function makeHand(side: 1 | -1, parts: Parts, mat: Material): Group {
  const name = side > 0 ? "right" : "left";
  const hand = new Group();
  hand.name = `hand-${name}`;
  const part = (geometry: BufferGeometry, part: string): Mesh => {
    const mesh = new Mesh(geometry, mat);
    mesh.name = `${part}-${name}`;
    return mesh;
  };
  // варежка: сплюснутая капля, большой палец сбоку, манжета и рукав, уходящий за край кадра
  const mitten = part(parts.mitten, "mitten");
  mitten.position.set(0, 0.03, 0);
  const thumb = part(parts.thumb, "thumb");
  thumb.position.set(-side * 0.046, 0.0, 0.006);
  thumb.rotation.z = side * 0.75;
  const cuff = part(parts.cuff, "cuff");
  cuff.position.set(0, -0.055, 0);
  const sleeve = part(parts.sleeve, "sleeve");
  sleeve.position.set(0, -0.23, 0.02);
  hand.add(mitten, thumb, cuff, sleeve);
  hand.position.set(side * REST.x, REST.y, REST.z);
  hand.rotation.set(TILT.x, -side * TILT.y, side * TILT.z);
  return hand;
}

export function createMittens(): Mittens {
  const scene = new Scene();
  const sun: SunUniform = { value: new Vector3() };
  // одна форма и один материал на обе руки; масштаб капли запечён в геометрию — у мешей нет масштаба
  const parts: Parts = {
    mitten: new SphereGeometry(1, 18, 12).scale(0.05, 0.085, 0.032),
    thumb: new CapsuleGeometry(0.016, 0.04, 4, 10),
    cuff: new CylinderGeometry(0.047, 0.052, 0.05, 14),
    sleeve: new CylinderGeometry(0.056, 0.075, 0.32, 14),
  };
  const mat = createInkMaterial(INK.hands, sun);
  const right = makeHand(1, parts, mat);
  const left = makeHand(-1, parts, mat);
  const rig = new Group();
  rig.add(right, left);
  scene.add(rig);
  const sunWorld = new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
  const mittenOf = (hand: Group, name: string): Object3D => {
    const m = hand.getObjectByName(`mitten-${name}`);
    if (!m) throw new Error(`mitten-${name} missing`);
    return m;
  };
  const centres = { right: new Vector3(), left: new Vector3() };
  const mitten = { right: mittenOf(right, "right"), left: mittenOf(left, "left") };
  return {
    scene,
    update(pose, cameraWorldInverse, gesture) {
      sun.value.copy(sunWorld).transformDirection(cameraWorldInverse);
      rig.position.set(pose.x, pose.y, 0);
      rig.rotation.z = pose.roll;
      const r = gesture?.right;
      const l = gesture?.left;
      right.position.set(REST.x + (r?.x ?? 0), REST.y + pose.swing * 0.008 + (r?.y ?? 0), REST.z + (r?.z ?? 0));
      left.position.set(-REST.x + (l?.x ?? 0), REST.y - pose.swing * 0.008 + (l?.y ?? 0), REST.z + (l?.z ?? 0));
      right.rotation.x = TILT.x + (r?.pitch ?? 0);
      left.rotation.x = TILT.x + (l?.pitch ?? 0);
    },
    palms() {
      // getWorldPosition сам обновляет матрицы от корня сцены: сцена рук и есть пространство камеры рук
      mitten.right.getWorldPosition(centres.right);
      mitten.left.getWorldPosition(centres.left);
      return centres;
    },
    dispose() {
      for (const g of Object.values(parts)) g.dispose();
      mat.dispose();
    },
  };
}
