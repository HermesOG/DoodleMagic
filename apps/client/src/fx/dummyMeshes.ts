import { BackSide, BoxGeometry, DynamicDrawUsage, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3, type ShaderMaterial } from "three";
import type { Vec3 } from "@doodlemagic/sim";
import { createInkMaterial, worldSun } from "../render/gbuffer";
import { INK } from "../render/palette";
import { lineRadiusFor } from "../render/quality";

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
  /** Вспышка попадания: тушь становится бумагой, маска — тушью. */
  flash: boolean;
  /** Покачивание парящих рук, м. */
  bob: number;
}

export interface DummyPart {
  part: "base" | "post" | "body" | "head" | "mask" | "handL" | "handR";
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

/** Корпус наклоняется вокруг верха основания: основание стоит на полу ровно. */
const PIVOT_Y = 0.12;

interface PartDef {
  part: DummyPart["part"];
  size: readonly [number, number, number];
  /** Середина при yaw = 0, лицом к −Z. */
  at: readonly [number, number, number];
  upper: boolean;
}

/** Манекен 1,8 м: основание, стойка, тело, голова, белая маска на грани −Z и две парящие «руки». */
const PARTS: readonly PartDef[] = [
  { part: "base", size: [0.8, 0.12, 0.8], at: [0, 0.06, 0], upper: false },
  { part: "post", size: [0.1, 0.36, 0.1], at: [0, 0.3, 0], upper: true },
  { part: "body", size: [0.62, 0.95, 0.4], at: [0, 0.925, 0], upper: true },
  { part: "head", size: [0.4, 0.4, 0.4], at: [0, 1.6, 0], upper: true },
  { part: "mask", size: [0.3, 0.22, 0.03], at: [0, 1.58, -0.215], upper: true },
  { part: "handL", size: [0.16, 0.16, 0.16], at: [-0.5, 0.98, -0.1], upper: true },
  { part: "handR", size: [0.16, 0.16, 0.16], at: [0.5, 0.98, -0.1], upper: true },
];
export const DUMMY_PART_COUNT = PARTS.length;

function rotY(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

/** Части манекена в мире. Чистая функция: проверяется тестами и пишется в экземпляры InstancedMesh. */
export function dummyParts(p: DummyPose): DummyPart[] {
  const squash = p.squash > 0 ? p.squash : 1;
  const wide = 1 / Math.sqrt(squash);
  // вздрагивание откидывает корпус назад от лица: «назад» в мире — (sin yaw, cos yaw)
  const bx = Math.sin(p.yaw);
  const bz = Math.cos(p.yaw);
  const out: DummyPart[] = [];
  for (const d of PARTS) {
    const isHand = d.part === "handL" || d.part === "handR";
    const isHead = d.part === "head" || d.part === "mask";
    const ink = d.part === "mask" ? (p.flash ? INK.enemy : INK.halo) : p.flash ? INK.flash : INK.enemy;
    if (!d.upper) {
      const [x, z] = rotY(d.at[0], d.at[2], p.yaw);
      out.push({ part: d.part, ink, pos: [p.pos.x + x, p.pos.y + d.at[1], p.pos.z + z], scale: [d.size[0], d.size[1], d.size[2]], yaw: p.yaw, tiltX: 0, tiltZ: 0 });
      continue;
    }
    const fl = p.flinch * (isHead ? 1.4 : 1);
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
    out.push({
      part: d.part,
      ink,
      pos: [p.pos.x + lx, p.pos.y + PIVOT_Y + fy, p.pos.z + fz],
      scale: [d.size[0] * wide, d.size[1] * squash, d.size[2] * wide],
      yaw: p.yaw,
      tiltX,
      tiltZ,
    });
  }
  return out;
}

/** Ширина ореола, пикселей кадра (GDD 6, round1/05: «белый ореол 2 px»). */
export const HALO_PX = 2;
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
  /** Тёмные части с маской: чернила каждого экземпляра — свои (aInk). */
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
          if (part.part === "mask") continue;
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
