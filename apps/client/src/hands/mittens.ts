import { CapsuleGeometry, CylinderGeometry, Group, Mesh, Scene, SphereGeometry, Vector3, type Matrix4 } from "three";
import { createInkMaterial, type SunUniform } from "../render/gbuffer";
import { INK, SUN_DIR } from "../render/palette";
import type { HandPose } from "./motion";

/** Руки-«варежки» из примитивов. Живут в своей сцене в пространстве камеры и рисуются вторым слоем G-буфера. */
export interface Mittens {
  readonly scene: Scene;
  /** Поза из updateHandRig и обратная матрица мировой камеры (чтобы солнце на руках совпадало с миром). */
  update(pose: HandPose, cameraWorldInverse: Matrix4): void;
}

const REST = { x: 0.26, y: -0.25, z: -0.62 } as const;

function makeHand(side: 1 | -1, sun: SunUniform): Group {
  const mat = createInkMaterial(INK.hands, sun);
  const hand = new Group();
  // варежка: сплюснутая капля, большой палец сбоку, манжета и рукав, уходящий за край кадра
  const mitten = new Mesh(new SphereGeometry(1, 18, 12), mat);
  mitten.scale.set(0.05, 0.085, 0.032);
  mitten.position.set(0, 0.03, 0);
  const thumb = new Mesh(new CapsuleGeometry(0.016, 0.04, 4, 10), mat);
  thumb.position.set(-side * 0.046, 0.0, 0.006);
  thumb.rotation.z = side * 0.75;
  const cuff = new Mesh(new CylinderGeometry(0.047, 0.052, 0.05, 14), mat);
  cuff.position.set(0, -0.055, 0);
  const sleeve = new Mesh(new CylinderGeometry(0.056, 0.075, 0.32, 14), mat);
  sleeve.position.set(0, -0.23, 0.02);
  hand.add(mitten, thumb, cuff, sleeve);
  hand.position.set(side * REST.x, REST.y, REST.z);
  hand.rotation.set(0.45, -side * 0.2, side * 0.12);
  return hand;
}

export function createMittens(): Mittens {
  const scene = new Scene();
  const sun: SunUniform = { value: new Vector3() };
  const right = makeHand(1, sun);
  const left = makeHand(-1, sun);
  const rig = new Group();
  rig.add(right, left);
  scene.add(rig);
  const sunWorld = new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
  return {
    scene,
    update(pose, cameraWorldInverse) {
      sun.value.copy(sunWorld).transformDirection(cameraWorldInverse);
      rig.position.set(pose.x, pose.y, 0);
      rig.rotation.z = pose.roll;
      right.position.y = REST.y + pose.swing * 0.008;
      left.position.y = REST.y - pose.swing * 0.008;
    },
  };
}
