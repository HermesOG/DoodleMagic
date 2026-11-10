import { BackSide, BoxGeometry, DynamicDrawUsage, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3, type ShaderMaterial } from "three";
import { ELEMENTS, type Element, type Vec3 } from "@doodlemagic/sim";
import { createInkMaterial, worldSun } from "../render/gbuffer";
import { INK } from "../render/palette";
import { lineRadiusFor } from "../render/quality";
import { HALO_PX, figureInk, headParts, onFace, type HeadPartName } from "./mageMeshes";

/** Поза манекена на кадр: из состояния юнита и пружин отклика (наклон, вздрагивание, приземление). */
export interface DummyPose {
  /** Середина подошвы. */
  pos: Vec3;
  /** Куда смотрит, рад (как PlayerInput.yaw: 0 — вдоль −Z). */
  yaw: number;
  /** Наклон всего корпуса вокруг мировых осей X и Z над основанием, рад (+X уводит верх к +Z, +Z — к −X). */
  leanX: number;
  leanZ: number;
  /** Вздрагивание, рад: корпус откидывается назад от лица, голова — сильнее, руки разлетаются. */
  flinch: number;
  /** Сжатие по высоте на приземлении (1 — нет). */
  squash: number;
  /** Вспышка попадания: тушь становится бумагой, маска — тушью; глаза остаются цветом стихии. */
  flash: boolean;
  /** Покачивание парящих рук, м. */
  bob: number;
  /** Стихия манекена — только вид: глаза и шляпа (по номеру, dummyElement). Без неё глаза под цвет маски, шляпа обычная. */
  element?: Element;
}

export interface DummyPart {
  part: "base" | "post" | "robe" | "chest" | HeadPartName | "handL" | "handR";
  ink: number;
  /** Середина бокса, мир. */
  pos: [number, number, number];
  /** Размер бокса по осям (до поворота). */
  scale: [number, number, number];
  /** Поворот: сначала yaw вокруг Y, потом tiltZ, потом tiltX (Euler "XZY"). */
  yaw: number;
  tiltX: number;
  tiltZ: number;
}

/** Стихия манекена по номеру (визуально, на бой не влияет): соседние номера — разные стихии. */
export function dummyElement(n: number): Element {
  const k = ELEMENTS.length;
  return ELEMENTS[((Math.trunc(n) % k) + k) % k]!;
}

/** Корпус наклоняется вокруг верха основания: основание стоит на полу ровно. */
const PIVOT_Y = 0.12;
/**
 * Полоса HP манекена — над 2,2 м (боевой HUD: голова 1,75 + 0,45): шляпа манекена ниже её, до DUMMY_TOP_M. Высоты
 * частей шляпы — DUMMY_HAT_K от шляпы мага, ширины и загибы те же: стихия по силуэту читается.
 */
const DUMMY_HAT_K = 0.55;
export const DUMMY_TOP_M = 2.17;

interface PartDef {
  part: DummyPart["part"];
  size: readonly [number, number, number];
  /** Середина при yaw = 0, лицом к −Z. */
  at: readonly [number, number, number];
  /** Постоянный загиб вокруг локальной X, рад (колпак и наконечник шляпы). */
  bend: number;
  upper: boolean;
  /** Голова и всё, что на ней: вздрагивает сильнее. */
  head: boolean;
}

/**
 * Манекен — маг на стойке, 1,8 м (как хитбокс): основание и шест вместо ног, мантия, грудь, голова мага с белой
 * маской и глазами стихии на грани −Z, шляпа стихии и две парящие руки.
 */
function buildParts(element: Element | undefined): readonly PartDef[] {
  return [
    { part: "base", size: [0.8, 0.12, 0.8], at: [0, 0.06, 0], bend: 0, upper: false, head: false },
    { part: "post", size: [0.1, 0.36, 0.1], at: [0, 0.3, 0], bend: 0, upper: true, head: false },
    { part: "robe", size: [0.62, 0.62, 0.44], at: [0, 0.78, 0.02], bend: 0, upper: true, head: false },
    { part: "chest", size: [0.46, 0.5, 0.32], at: [0, 1.3, 0.02], bend: 0, upper: true, head: false },
    ...headParts(element, DUMMY_HAT_K).map((h): PartDef => ({ ...h, upper: true, head: true })),
    { part: "handL", size: [0.15, 0.15, 0.15], at: [-0.42, 1.1, -0.26], bend: 0, upper: true, head: false },
    { part: "handR", size: [0.15, 0.15, 0.15], at: [0.42, 1.1, -0.26], bend: 0, upper: true, head: false },
  ];
}
const PARTS_OF: Readonly<Record<Element | "plain", readonly PartDef[]>> = {
  plain: buildParts(undefined),
  fire: buildParts("fire"),
  earth: buildParts("earth"),
  air: buildParts("air"),
  water: buildParts("water"),
};
export const DUMMY_PART_COUNT = PARTS_OF.plain.length;

function rotY(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

// рабочие объекты загнутых частей: поворот Rx(tiltX)·Rz(tiltZ)·Ry(yaw)·Rx(загиб) обратно в Euler "XZY"
const qBent = new Quaternion();
const qBend = new Quaternion();
const eBent = new Euler(0, 0, 0, "XZY");
const AXIS_X = new Vector3(1, 0, 0);

/** Части манекена в мире. Чистая функция: проверяется тестами и пишется в экземпляры InstancedMesh. */
export function dummyParts(p: DummyPose): DummyPart[] {
  const squash = p.squash > 0 ? p.squash : 1;
  const wide = 1 / Math.sqrt(squash);
  // вздрагивание откидывает корпус назад от лица: «назад» в мире — (sin yaw, cos yaw)
  const bx = Math.sin(p.yaw);
  const bz = Math.cos(p.yaw);
  const out: DummyPart[] = [];
  for (const d of PARTS_OF[p.element ?? "plain"]) {
    const isHand = d.part === "handL" || d.part === "handR";
    const ink = figureInk(d.part, p.flash, p.element);
    if (!d.upper) {
      const [x, z] = rotY(d.at[0], d.at[2], p.yaw);
      out.push({ part: d.part, ink, pos: [p.pos.x + x, p.pos.y + d.at[1], p.pos.z + z], scale: [d.size[0], d.size[1], d.size[2]], yaw: p.yaw, tiltX: 0, tiltZ: 0 });
      continue;
    }
    const fl = p.flinch * (d.head ? 1.4 : 1);
    const tiltX = p.leanX + fl * bz;
    const tiltZ = p.leanZ - fl * bx;
    // смещение от оси наклона: сжатие по высоте, руки качаются и от вздрагивания разлетаются в стороны
    let lx = d.at[0] * (isHand ? 1 + Math.abs(p.flinch) * 0.6 : wide);
    let ly = (d.at[1] - PIVOT_Y) * squash + (isHand ? p.bob : 0);
    const lz = d.at[2] + (isHand ? Math.abs(p.flinch) * 0.25 : 0);
    // yaw, затем Rz(tiltZ), затем Rx(tiltX)
    const [yx, yz] = rotY(lx, lz, p.yaw);
    const cz = Math.cos(tiltZ);
    const sz = Math.sin(tiltZ);
    lx = yx * cz - ly * sz;
    ly = yx * sz + ly * cz;
    const cx = Math.cos(tiltX);
    const sx = Math.sin(tiltX);
    const fy = ly * cx - yz * sx;
    const fz = ly * sx + yz * cx;
    let yaw = p.yaw;
    let tx = tiltX;
    let tz = tiltZ;
    if (d.bend !== 0) {
      // загиб — в теле, до yaw и наклона
      qBent.setFromEuler(eBent.set(tiltX, p.yaw, tiltZ, "XZY")).multiply(qBend.setFromAxisAngle(AXIS_X, d.bend));
      eBent.setFromQuaternion(qBent, "XZY");
      yaw = eBent.y;
      tx = eBent.x;
      tz = eBent.z;
    }
    out.push({
      part: d.part,
      ink,
      pos: [p.pos.x + lx, p.pos.y + PIVOT_Y + fy, p.pos.z + fz],
      scale: [d.size[0] * wide, d.size[1] * squash, d.size[2] * wide],
      yaw,
      tiltX: tx,
      tiltZ: tz,
    });
  }
  return out;
}

const HALO_MIN_M = 0.02;
const HALO_MAX_M = 0.3;

/**
 * Отступ оболочки ореола в метрах, чтобы на расстоянии distM он был HALO_PX пикселей кадра высотой viewportH
 * при вертикальном FOV fovDeg; не меньше 2 см вблизи (иначе оболочка тонет в части) и не больше 30 см вдали.
 */
export function haloMargin(distM: number, viewportH: number, fovDeg: number): number {
  const px = (2 * Math.max(0, distM) * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportH);
  return Math.min(HALO_MAX_M, Math.max(HALO_MIN_M, HALO_PX * px));
}

export interface DummyView {
  pose: DummyPose;
  /** Расстояние от камеры до середины манекена, м. */
  distM: number;
}

export interface DummyMeshes {
  /** Тёмные части с маской и глазами: чернила каждого экземпляра — свои (aInk). */
  readonly parts: InstancedMesh<BoxGeometry, ShaderMaterial>;
  /** Вывернутая оболочка ореола (BackSide, чернила halo) вокруг каждой тёмной части. */
  readonly shells: InstancedMesh<BoxGeometry, ShaderMaterial>;
  update(dummies: readonly DummyView[], viewportH: number, fovDeg: number): void;
  dispose(): void;
}

/**
 * Манекены в G-буфер: 2 draw call'а на всех. Ореол — вывернутая оболочка (решение Р2): стилевой проход
 * не трогаем. Контур стилевого прохода ложится на края ореола с обеих сторон (тушь врага внутри и мягкая
 * кромка снаружи), поэтому оболочка шире на столько же пикселей, сколько у контура радиус выборки:
 * белыми остаются HALO_PX.
 */
export function createDummyMeshes(maxDummies = 8): DummyMeshes {
  const n = maxDummies * DUMMY_PART_COUNT;
  const geometry = new BoxGeometry(1, 1, 1);
  const inkAttr = new InstancedBufferAttribute(new Float32Array(n), 1);
  inkAttr.setUsage(DynamicDrawUsage);
  const partsGeometry = geometry.clone();
  partsGeometry.setAttribute("aInk", inkAttr);
  const parts = new InstancedMesh(partsGeometry, createInkMaterial(INK.enemy, worldSun, { instanceInk: true }), n);
  const shells = new InstancedMesh(geometry, createInkMaterial(INK.halo, worldSun, { side: BackSide }), n);
  parts.name = "dummy-parts";
  shells.name = "dummy-halo";
  for (const m of [parts, shells]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.visible = false;
  }
  const mat = new Matrix4();
  const q = new Quaternion();
  const e = new Euler(0, 0, 0, "XZY");
  const pos = new Vector3();
  const scl = new Vector3();

  return {
    parts,
    shells,
    update(dummies, viewportH, fovDeg) {
      let ip = 0;
      let is = 0;
      const lineK = 1 + lineRadiusFor(viewportH);
      for (const d of dummies.slice(0, maxDummies)) {
        const margin = haloMargin(d.distM, viewportH, fovDeg) * lineK;
        for (const part of dummyParts(d.pose)) {
          q.setFromEuler(e.set(part.tiltX, part.yaw, part.tiltZ, "XZY"));
          pos.set(part.pos[0], part.pos[1], part.pos[2]);
          parts.setMatrixAt(ip, mat.compose(pos, q, scl.set(part.scale[0], part.scale[1], part.scale[2])));
          inkAttr.array[ip] = part.ink;
          ip++;
          if (onFace(part.part)) continue;
          shells.setMatrixAt(is++, mat.compose(pos, q, scl.set(part.scale[0] + 2 * margin, part.scale[1] + 2 * margin, part.scale[2] + 2 * margin)));
        }
      }
      parts.count = ip;
      shells.count = is;
      parts.visible = ip > 0;
      shells.visible = is > 0;
      parts.instanceMatrix.needsUpdate = true;
      shells.instanceMatrix.needsUpdate = true;
      inkAttr.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      partsGeometry.dispose();
      parts.material.dispose();
      shells.material.dispose();
      parts.dispose();
      shells.dispose();
    },
  };
}
