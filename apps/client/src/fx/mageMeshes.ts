import { BackSide, BoxGeometry, DynamicDrawUsage, Euler, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { Element, Vec3 } from "@doodlemagic/sim";
import { createInkMaterial, worldSun } from "../render/gbuffer";
import { EYE_INK, INK } from "../render/palette";
import { lineRadiusFor } from "../render/quality";
import type { DummyPart } from "./dummyMeshes";

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
  /** Вспышка попадания: тушь становится бумагой, маска — тушью; глаза остаются цветом стихии. */
  flash: boolean;
  /** Наклон всей фигуры вокруг подошвы по мировым X и Z, рад (как у манекена: отбрасывание и толчок удара). */
  leanX?: number;
  leanZ?: number;
  /** Стихия: глаза в маске и форма шляпы (решение Р9). Без неё глаза — под цвет маски, шляпа обычная. */
  element?: Element;
}

/** Голова и всё, что на ней: у мага и у манекена одинаковые (манекен — маг на стойке). */
export type HeadPartName = "head" | "mask" | "eyeL" | "eyeR" | "brim" | "crown" | "cone" | "tip";
export type MagePartName = "legL" | "legR" | "robe" | "chest" | HeadPartName | "handL" | "handR";
/** Часть мага — в том же формате, что DummyPart, со своими именами частей. */
export type MagePart = Omit<DummyPart, "part"> & { part: MagePartName };

/** Ширина ореола, пикселей кадра (GDD 6, round1/05: «белый ореол 2 px»): у мага и у манекена. */
export const HALO_PX = 2;

/** Часть головы в теле: середина при yaw = 0, лицом к −Z, в покое; загиб — постоянный поворот вокруг локальной X, рад. */
export interface HeadPart {
  part: HeadPartName;
  size: readonly [number, number, number];
  at: readonly [number, number, number];
  bend: number;
}

/**
 * Шляпа: поля, тулья, колпак и наконечник — [ширина, высота], м; колпак загибается от тульи, наконечник — ещё
 * от колпака, рад (+ — назад, от лица; − — вперёд). Опора загиба — низ части.
 */
export interface HatShape {
  brim: readonly [number, number];
  crown: readonly [number, number];
  cone: readonly [number, number];
  tip: readonly [number, number];
  coneBend: number;
  tipBend: number;
}

/** Обычная шляпа (без стихии): колпак и наконечник загнуты назад. */
const HAT_PLAIN: HatShape = { brim: [0.7, 0.04], crown: [0.34, 0.18], cone: [0.24, 0.16], tip: [0.13, 0.17], coneBend: 0.16, tipBend: 0.42 };
/**
 * Шляпа по стихии — те же четыре части, другие размеры и загибы (Р9): стихия читается по силуэту над укрытием
 * и с любого ракурса, без нового цвета (дальтоник узнаёт её по форме).
 */
export const HATS: Readonly<Record<Element, HatShape>> = {
  // Огонь — высокая, кончик вперёд, как язык пламени
  fire: { brim: [0.66, 0.04], crown: [0.32, 0.19], cone: [0.22, 0.19], tip: [0.12, 0.22], coneBend: -0.06, tipBend: -0.5 },
  // Земля — низкая, широкие поля
  earth: { brim: [0.86, 0.045], crown: [0.36, 0.12], cone: [0.26, 0.09], tip: [0.15, 0.07], coneBend: 0.08, tipBend: 0.2 },
  // Воздух — длинный кончик назад, как по ветру
  air: { brim: [0.68, 0.04], crown: [0.32, 0.17], cone: [0.22, 0.17], tip: [0.11, 0.34], coneBend: 0.3, tipBend: 0.95 },
  // Вода — кончик свисает за спиной каплей (ромб углом вниз)
  water: { brim: [0.7, 0.04], crown: [0.33, 0.17], cone: [0.23, 0.17], tip: [0.15, 0.15], coneBend: 0.45, tipBend: 1.9 },
};

/** Голова: верх — на верхе хитбокса (1,8 м), маска — на грани взгляда (−Z). */
const HEAD: HeadPart = { part: "head", size: [0.32, 0.34, 0.32], at: [0, 1.63, 0], bend: 0 };
const HEAD_TOP_Y = HEAD.at[1] + HEAD.size[1] / 2;
const MASK: HeadPart = { part: "mask", size: [0.25, 0.19, 0.03], at: [0, 1.62, -0.175], bend: 0 };
/**
 * Глаза — две точки в маске чернилами стихии: лицевая грань на 5 мм впереди маски, задняя — в ней. Сбоку их почти
 * не видно, сзади закрывает голова; ореолом не обводятся (он у головы).
 */
const EYE_SIZE: readonly [number, number, number] = [0.075, 0.065, 0.02];
const EYE_X = 0.06;
const EYE_Y = MASK.at[1] + 0.015;
const EYE_Z = MASK.at[2] - MASK.size[2] / 2 - 0.005 + EYE_SIZE[2] / 2;
const EYES: readonly HeadPart[] = [
  { part: "eyeL", size: EYE_SIZE, at: [-EYE_X, EYE_Y, EYE_Z], bend: 0 },
  { part: "eyeR", size: EYE_SIZE, at: [EYE_X, EYE_Y, EYE_Z], bend: 0 },
];

/** Части шляпы на макушке topY (в теле, лицом к −Z); высоты частей × k (у манекена шляпа ниже его полосы HP). */
export function hatParts(h: HatShape, topY: number, k = 1): HeadPart[] {
  const z = 0.03;
  const brimH = h.brim[1] * k;
  const crownH = h.crown[1] * k;
  const coneH = h.cone[1] * k;
  const tipH = h.tip[1] * k;
  const a = h.coneBend;
  const b = h.coneBend + h.tipBend;
  // опора колпака — верх тульи, опора наконечника — верх загнутого колпака; поворот вокруг X: (0, L) → (L cos, L sin)
  const coneY = topY + brimH + crownH;
  const tipY = coneY + coneH * Math.cos(a);
  const tipZ = z + coneH * Math.sin(a);
  return [
    { part: "brim", size: [h.brim[0], brimH, h.brim[0]], at: [0, topY + brimH / 2, 0.01], bend: 0 },
    { part: "crown", size: [h.crown[0], crownH, h.crown[0]], at: [0, topY + brimH + crownH / 2, z], bend: 0 },
    { part: "cone", size: [h.cone[0], coneH, h.cone[0]], at: [0, coneY + (coneH / 2) * Math.cos(a), z + (coneH / 2) * Math.sin(a)], bend: a },
    { part: "tip", size: [h.tip[0], tipH, h.tip[0]], at: [0, tipY + (tipH / 2) * Math.cos(b), tipZ + (tipH / 2) * Math.sin(b)], bend: b },
  ];
}

/** Голова мага в теле: голова, маска, глаза и шляпа его стихии (без стихии — обычная); высоты шляпы × hatK. */
export function headParts(element: Element | undefined, hatK = 1): HeadPart[] {
  return [HEAD, MASK, ...EYES, ...hatParts(element ? HATS[element] : HAT_PLAIN, HEAD_TOP_Y, hatK)];
}

/**
 * Чернила части фигуры (Р9, правило честности): тело — тушь врага, во вспышке — бумага; маска — ореол, во вспышке —
 * тушь; глаза — метка стихии, вспышка их не стирает. Без стихии глаза — под цвет маски (их не видно).
 */
export function figureInk(part: string, flash: boolean, element: Element | undefined): number {
  const mask = flash ? INK.enemy : INK.halo;
  if (part === "mask") return mask;
  if (part === "eyeL" || part === "eyeR") return element ? EYE_INK[element] : mask;
  return flash ? INK.flash : INK.enemy;
}

/** Маска и глаза — на лицевой грани головы: оболочки ореола у них нет, их обводит ореол головы. */
export function onFace(part: string): boolean {
  return part === "mask" || part === "eyeL" || part === "eyeR";
}

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
  /** Постоянный загиб вокруг локальной X, рад (колпак и наконечник шляпы): до петель. */
  bend: number;
  /** Повороты в теле — от внутреннего к внешнему (ноги и подол — от бедра, голова — кивок). */
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

const legHinge = (side: 1 | -1): Hinge => ({
  at: [side * 0.12, HIP_Y, 0],
  // левая нога вперёд при sin(stride) > 0, правая — назад
  angle: (_p, k) => (k.air ? (side < 0 ? TUCK_FRONT : TUCK_BACK) : side < 0 ? k.swing : -k.swing),
});
const nod: Hinge = { at: NECK, angle: (p) => NOD * p.pitch };
const aim: Hinge = { at: SHOULDER, angle: (p) => AIM * p.pitch };

/**
 * Маг 1,8 м из боксов: две ноги под мантией, мантия расширяется книзу, голова с белой маской на грани взгляда (−Z)
 * и двумя глазами цветом стихии, остроконечная шляпа стихии над хитбоксом и две парящие руки перед грудью.
 */
function buildParts(element: Element | undefined): readonly PartDef[] {
  return [
    { part: "legL", size: [0.15, LEG_LEN, 0.17], at: [-0.12, LEG_LEN / 2, 0], bend: 0, hinges: [legHinge(-1)], head: false },
    { part: "legR", size: [0.15, LEG_LEN, 0.17], at: [0.12, LEG_LEN / 2, 0], bend: 0, hinges: [legHinge(1)], head: false },
    {
      part: "robe",
      size: [0.62, 0.62, 0.44],
      at: [0, HEM_TOP_Y - 0.31, 0.02],
      bend: 0,
      hinges: [{ at: [0, HEM_TOP_Y, 0.02], angle: (_p, k) => -(HEM_DRAG * k.speed + HEM_FLAP * k.speed * Math.sin(2 * k.stride)) }],
      head: false,
    },
    { part: "chest", size: [0.46, 0.5, 0.32], at: [0, 1.3, 0.02], bend: 0, hinges: [], head: false },
    ...headParts(element).map((h): PartDef => ({ ...h, hinges: [nod], head: true })),
    { part: "handL", size: [0.15, 0.15, 0.15], at: [-0.38, 1.2, -0.36], bend: 0, hinges: [aim], head: false },
    { part: "handR", size: [0.15, 0.15, 0.15], at: [0.38, 1.2, -0.36], bend: 0, hinges: [aim], head: false },
  ];
}
const PARTS_OF: Readonly<Record<Element | "plain", readonly PartDef[]>> = {
  plain: buildParts(undefined),
  fire: buildParts("fire"),
  earth: buildParts("earth"),
  air: buildParts("air"),
  water: buildParts("water"),
};
export const MAGE_PART_COUNT = PARTS_OF.plain.length;
/** Верх самой высокой шляпы (Огонь) над подошвой, м: над ним ставится полоса HP. */
export const MAGE_TOP_M = 2.44;

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
  for (const d of PARTS_OF[p.element ?? "plain"]) {
    const isHand = d.part === "handL" || d.part === "handR";
    const isLeg = d.part === "legL" || d.part === "legR";
    // середина и поворот в теле: загиб, затем петли
    vOff.set(d.at[0], d.at[1], d.at[2]);
    if (isHand) {
      vOff.x *= 1 + spread * 0.6;
      vOff.z += spread * 0.25 + (d.part === "handL" ? handSwing : -handSwing);
      vOff.y += 0.03 * speed * Math.abs(Math.sin(p.stride));
    }
    if (d.bend !== 0) qPart.setFromAxisAngle(X, d.bend);
    else qPart.identity();
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
      ink: figureInk(d.part, p.flash, p.element),
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
  /** Тёмные части с маской и глазами (чернила экземпляра) и вывернутая оболочка ореола: 2 draw call'а на всех магов. */
  readonly group: Group;
  /**
   * views — не больше max магов; lineScale — mageLineScale кадра; eye — глаза камеры: ореол на расстоянии держит
   * HALO_PX пикселей. Без eye — наименьший отступ.
   */
  update(views: readonly MagePose[], lineScale: number, eye?: Vec3): void;
  dispose(): void;
}

/** Чужие маги в G-буфер так же, как манекены: тушь врага с маской и глазами и белый ореол вывернутой оболочкой (решение Р2). */
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
