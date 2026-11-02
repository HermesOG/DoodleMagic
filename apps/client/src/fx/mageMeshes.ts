import { BackSide, BoxGeometry, DynamicDrawUsage, Euler, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { Vec3 } from "@doodlemagic/sim";
import { createInkMaterial, worldSun } from "../render/gbuffer";
import { INK } from "../render/palette";
import { lineRadiusFor } from "../render/quality";
import { HALO_PX, type DummyPart } from "./dummyMeshes";

/** Поза чужого мага на кадр: положение и взгляд между тиками, шаг и отклик на попадание. */
export interface MagePose {
  /** Середина подошвы. */
  pos: Vec3;
  /** Куда смотрит, рад (как PlayerInput.yaw: 0 — вдоль −Z). */
  yaw: number;
  /** Взгляд вверх-вниз, рад; голова кивает на 0,4 от него, руки поднимаются на 0,5. */
  pitch: number;
  /** Фаза шага, рад: ноги машут ± по синусу; амплитуда — speed / runSpeed, не больше 1. */
  stride: number;
  speed01: number;
  /** В воздухе ноги поджаты. */
  airborne: boolean;
  /** Вздрагивание, рад: как у манекена — корпус откидывается назад от лица, голова сильнее, руки разлетаются. */
  flinch: number;
  /** Вспышка попадания: тушь становится бумагой, маска — тушью. */
  flash: boolean;
  /** Наклон всей фигуры вокруг подошвы по мировым X и Z, рад (как у манекена: отбрасывание и толчок удара). */
  leanX?: number;
  leanZ?: number;
}

export type MagePartName = "legL" | "legR" | "robe" | "chest" | "head" | "mask" | "brim" | "crown" | "cone" | "tip" | "handL" | "handR";
/** Часть мага — в том же формате, что DummyPart, со своими именами частей. */
export type MagePart = Omit<DummyPart, "part"> & { part: MagePartName };

/** Поворот вокруг локальной оси X (вправо) у точки опоры: + поднимает лицо и уводит верх назад (+Z). */
interface Hinge {
  at: readonly [number, number, number];
  angle: (p: MagePose, k: Kin) => number;
}
interface PartDef {
  part: MagePartName;
  size: readonly [number, number, number];
  /** Середина при yaw = 0, лицом к −Z, в покое. */
  at: readonly [number, number, number];
  /** Повороты в теле — от внутреннего к внешнему (наконечник шляпы, затем кивок головы). */
  hinges: readonly Hinge[];
  /** Голова и всё, что на ней: вздрагивает сильнее. */
  head: boolean;
}
/** Величины позы, общие для частей. */
interface Kin {
  swing: number;
  air: boolean;
  speed: number;
  stride: number;
}

/** Бедро: ноги машут вокруг него. Ноги закрыты мантией до подола, видны ниже. */
const HIP_Y = 0.86;
const LEG_LEN = 0.86;
/** Размах ног на полном беге, рад; в воздухе — поджаты: передняя вперёд, задняя назад, стопы выше. */
const SWING = 0.55;
const TUCK_FRONT = 0.5;
const TUCK_BACK = -0.25;
const TUCK_LIFT = 0.14;
/** Подол отстаёт на бегу и бьётся в такт шагу. */
const HEM_TOP_Y = 1.09;
const HEM_DRAG = 0.22;
const HEM_FLAP = 0.06;
/** Шея — опора кивка; кивок — 0,4 от взгляда. Руки поднимаются от плеч на 0,5 от взгляда. */
const NECK: readonly [number, number, number] = [0, 1.46, 0];
const NOD = 0.4;
const SHOULDER: readonly [number, number, number] = [0, 1.42, 0];
const AIM = 0.5;
/** Колпак шляпы гнётся назад: средняя часть от тульи, наконечник — ещё сильнее от средней. */
const CONE_BACK = 0.16;
const TIP_BACK = 0.42;
const CONE_HINGE: Hinge = { at: [0, 2.02, 0.03], angle: () => CONE_BACK };

const legHinge = (side: 1 | -1): Hinge => ({
  at: [side * 0.12, HIP_Y, 0],
  // левая нога вперёд при sin(stride) > 0, правая — назад
  angle: (_p, k) => (k.air ? (side < 0 ? TUCK_FRONT : TUCK_BACK) : side < 0 ? k.swing : -k.swing),
});
const nod: Hinge = { at: NECK, angle: (p) => NOD * p.pitch };
const aim: Hinge = { at: SHOULDER, angle: (p) => AIM * p.pitch };

/**
 * Маг 1,8 м из боксов: две ноги под мантией, мантия расширяется книзу, голова с белой маской на грани взгляда (−Z),
 * остроконечная шляпа над хитбоксом (поля, тулья, колпак и наконечник, загнутые назад) и две парящие руки перед грудью.
 */
const PARTS: readonly PartDef[] = [
  { part: "legL", size: [0.15, LEG_LEN, 0.17], at: [-0.12, LEG_LEN / 2, 0], hinges: [legHinge(-1)], head: false },
  { part: "legR", size: [0.15, LEG_LEN, 0.17], at: [0.12, LEG_LEN / 2, 0], hinges: [legHinge(1)], head: false },
  {
    part: "robe",
    size: [0.62, 0.62, 0.44],
    at: [0, HEM_TOP_Y - 0.31, 0.02],
    hinges: [{ at: [0, HEM_TOP_Y, 0.02], angle: (_p, k) => -(HEM_DRAG * k.speed + HEM_FLAP * k.speed * Math.sin(2 * k.stride)) }],
    head: false,
  },
  { part: "chest", size: [0.46, 0.5, 0.32], at: [0, 1.3, 0.02], hinges: [], head: false },
  { part: "head", size: [0.32, 0.34, 0.32], at: [0, 1.63, 0], hinges: [nod], head: true },
  { part: "mask", size: [0.25, 0.19, 0.03], at: [0, 1.62, -0.175], hinges: [nod], head: true },
  { part: "brim", size: [0.7, 0.04, 0.7], at: [0, 1.82, 0.01], hinges: [nod], head: true },
  { part: "crown", size: [0.34, 0.18, 0.34], at: [0, 1.93, 0.03], hinges: [nod], head: true },
  { part: "cone", size: [0.24, 0.16, 0.24], at: [0, 2.1, 0.03], hinges: [CONE_HINGE, nod], head: true },
  { part: "tip", size: [0.13, 0.17, 0.13], at: [0, 2.265, 0.03], hinges: [{ at: [0, 2.18, 0.03], angle: () => TIP_BACK }, CONE_HINGE, nod], head: true },
  { part: "handL", size: [0.15, 0.15, 0.15], at: [-0.38, 1.2, -0.36], hinges: [aim], head: false },
  { part: "handR", size: [0.15, 0.15, 0.15], at: [0.38, 1.2, -0.36], hinges: [aim], head: false },
];
export const MAGE_PART_COUNT = PARTS.length;
/** Верх шляпы над подошвой, м: над ним ставится полоса HP. */
export const MAGE_TOP_M = 2.36;

// рабочие объекты: функция чистая по результату, но не выделяет кватернионы на каждую часть
const qPart = new Quaternion();
const qStep = new Quaternion();
const qWorld = new Quaternion();
const vOff = new Vector3();
const vPivot = new Vector3();
const eOut = new Euler(0, 0, 0, "XZY");
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/** Части мага в мире. Чистая функция: проверяется тестами и пишется в экземпляры InstancedMesh. */
export function mageParts(p: MagePose): MagePart[] {
  const speed = Math.min(1, Math.max(0, p.speed01));
  const kin: Kin = { swing: SWING * speed * Math.sin(p.stride), air: p.airborne, speed, stride: p.stride };
  // вздрагивание откидывает корпус назад от лица: «назад» в мире — (sin yaw, cos yaw), как у манекена
  const bx = Math.sin(p.yaw);
  const bz = Math.cos(p.yaw);
  const leanX = p.leanX ?? 0;
  const leanZ = p.leanZ ?? 0;
  const spread = Math.abs(p.flinch);
  // на бегу руки качаются против ног
  const handSwing = 0.08 * speed * Math.sin(p.stride);
  const out: MagePart[] = [];
  for (const d of PARTS) {
    const isHand = d.part === "handL" || d.part === "handR";
    const isLeg = d.part === "legL" || d.part === "legR";
    const ink = d.part === "mask" ? (p.flash ? INK.enemy : INK.halo) : p.flash ? INK.flash : INK.enemy;
    // середина и поворот в теле
    vOff.set(d.at[0], d.at[1], d.at[2]);
    if (isHand) {
      vOff.x *= 1 + spread * 0.6;
      vOff.z += spread * 0.25 + (d.part === "handL" ? handSwing : -handSwing);
      vOff.y += 0.03 * speed * Math.abs(Math.sin(p.stride));
    }
    qPart.identity();
    for (const h of d.hinges) {
      const a = h.angle(p, kin);
      if (a === 0) continue;
      qStep.setFromAxisAngle(X, a);
      vPivot.set(h.at[0], h.at[1], h.at[2]);
      vOff.sub(vPivot).applyQuaternion(qStep).add(vPivot);
      qPart.premultiply(qStep);
    }
    if (isLeg && p.airborne) vOff.y += TUCK_LIFT;
    // yaw, затем наклон вокруг подошвы: Rz(tiltZ), потом Rx(tiltX) — порядок Euler "XZY", как у манекена
    const fl = p.flinch * (d.head ? 1.4 : 1);
    const tiltX = leanX + fl * bz;
    const tiltZ = leanZ - fl * bx;
    qStep.setFromAxisAngle(Y, p.yaw);
    vOff.applyQuaternion(qStep);
    qPart.premultiply(qStep);
    qWorld.setFromAxisAngle(X, tiltX).multiply(qStep.setFromAxisAngle(Z, tiltZ));
    vOff.applyQuaternion(qWorld);
    qPart.premultiply(qWorld);
    eOut.setFromQuaternion(qPart, "XZY");
    out.push({
      part: d.part,
      ink,
      pos: [p.pos.x + vOff.x, p.pos.y + vOff.y, p.pos.z + vOff.z],
      scale: [d.size[0], d.size[1], d.size[2]],
      yaw: eOut.y,
      tiltX: eOut.x,
      tiltZ: eOut.z,
    });
  }
  return out;
}

/** Середины ладоней мага в мире: там светится его стихия. */
export function mageHands(p: MagePose): { left: Vec3; right: Vec3 } {
  const parts = mageParts(p);
  const at = (name: MagePartName): Vec3 => {
    const q = parts.find((x) => x.part === name)!;
    return { x: q.pos[0], y: q.pos[1], z: q.pos[2] };
  };
  return { left: at("handL"), right: at("handR") };
}

/**
 * Метры ореола на метр расстояния до мага: HALO_PX пикселей кадра высотой viewportH при FOV fovDeg, с поправкой на
 * радиус контура стилевого прохода (как у манекена: белыми после контура остаются HALO_PX).
 */
export function mageLineScale(viewportH: number, fovDeg: number): number {
  return ((HALO_PX * 2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportH)) * (1 + lineRadiusFor(viewportH));
}
/** Отступ оболочки ореола: не меньше 4 см вблизи (тонет в части) и не больше 60 см вдали — как у манекена на 1080p. */
const MARGIN_MIN_M = 0.04;
const MARGIN_MAX_M = 0.6;

export interface MageMeshes {
  /** Тёмные части с маской (чернила экземпляра) и вывернутая оболочка ореола: 2 draw call'а на всех магов. */
  readonly group: Group;
  /**
   * views — не больше max магов; lineScale — mageLineScale кадра; eye — глаза камеры: ореол на расстоянии держит
   * HALO_PX пикселей. Без eye — наименьший отступ.
   */
  update(views: readonly MagePose[], lineScale: number, eye?: Vec3): void;
  dispose(): void;
}

/** Чужие маги в G-буфер так же, как манекены: тушь врага с маской и белый ореол вывернутой оболочкой (решение Р2). */
export function createMageMeshes(max: number): MageMeshes {
  const n = Math.max(1, max) * MAGE_PART_COUNT;
  const geometry = new BoxGeometry(1, 1, 1);
  const inkAttr = new InstancedBufferAttribute(new Float32Array(n), 1);
  inkAttr.setUsage(DynamicDrawUsage);
  const partsGeometry = geometry.clone();
  partsGeometry.setAttribute("aInk", inkAttr);
  const parts = new InstancedMesh(partsGeometry, createInkMaterial(INK.enemy, worldSun, { instanceInk: true }), n);
  const shells = new InstancedMesh(geometry, createInkMaterial(INK.halo, worldSun, { side: BackSide }), n);
  parts.name = "mage-parts";
  shells.name = "mage-halo";
  for (const m of [parts, shells]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.visible = false;
  }
  const group = new Group();
  group.name = "mages";
  group.add(parts, shells);
  const mat = new Matrix4();
  const q = new Quaternion();
  const e = new Euler(0, 0, 0, "XZY");
  const pos = new Vector3();
  const scl = new Vector3();

  return {
    group,
    update(views, lineScale, eye) {
      let ip = 0;
      let is = 0;
      for (const v of views.slice(0, Math.max(0, max))) {
        const dist = eye ? Math.hypot(v.pos.x - eye.x, v.pos.y + 0.9 - eye.y, v.pos.z - eye.z) : 0;
        const margin = Math.min(MARGIN_MAX_M, Math.max(MARGIN_MIN_M, lineScale * dist));
        for (const part of mageParts(v)) {
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
