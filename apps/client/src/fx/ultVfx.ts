import {
  ConeGeometry, CylinderGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3, type ShaderMaterial,
} from "three";
import { AIR, EARTH, EYE_HEIGHT, FIRE, NOBODY, TICK_HZ, WATER, aimDir, forwardXZ, type MatchState, type UnitId, type Vec3, type Zone } from "@doodlemagic/sim";
import { breathStreaming } from "../feel/eventMap";
import { createInkMaterial } from "../render/gbuffer";
import { INK } from "../render/palette";
import { glslFloat, styleShared } from "../render/stylePass";
import type { ElementVfx, ElementVfxFactory, ElementVfxFrame } from "./elementVfx";
import { FX_ORDER, createFxMaterial } from "./fxShader";
import { FX_COLOR, RIM, particle, randomCone, randomRing, type ParticleSpec, type Rng } from "./particleKit";
import { CLEAR_DEG } from "./particles";
import { BURST_SHARE } from "./presets";
import type { PresetId } from "../render/quality";

/*
 * Ульты Огня и Земли (фаза 5) поверх общих пулов эффектника:
 * - «Дыхание дракона»: на вдохе у груди мага разгорается свет и сходятся угли; поток — лист пламени на конусе 12 м
 *   с полууглом 15° по взгляду (проход света), частицы огня ≤ 90/с по конусу и свечение со светом огня 7,5 м (свет
 *   разбирает пресет 2/4/8). Всё — по ult.cast в состоянии: чужое Дыхание видно с любого угла, а конец каста — конец
 *   потока, даже без события ult/end.
 * - «Тектонический разлом»: трещина — декаль rift (decals.ts); по ней за 0,8 с бежит фронт с пылью; на взводе шипы
 *   вырастают по всей линии за 0,1 с (G-буфер, чернила рельефа), стоят до конца зоны и тают в последние 0,5 с.
 * Своих мешей два: конус (+1 вызов Огня) и шипы (+1 вызов Земли); частицы и свет — общие пулы.
 * «Магия гасит день» (Р7) — здесь же, по ультам всех стихий в состоянии: пишет styleShared.dayDim.
 */

const DB = FIRE.dragonBreath;
const TR = EARTH.tectonicRift;
/** Конус Дыхания: длина, м, и тангенс полуугла (как в симуляции: 12 м, 15°). */
export const BREATH_LEN_M = DB.rangeM;
const BREATH_HALF = (DB.halfAngleDeg * Math.PI) / 180;
const BREATH_TAN = Math.tan(BREATH_HALF);
/** Частиц потока в секунду на мага. */
export const BREATH_RATE = 90;
/**
 * Своё Дыхание изнутри (V4): поток гуще (120/с, доля пресета его не прореживает) и крупнее к концу (1,4–2 м), рождается
 * в кольце 6–15° от оси взгляда — центр у прицела чист; лист плотнее (α 0,55) и начинается с 0,3 м. На «Низком» —
 * размер × 0,7 (перерисовка у камеры).
 */
export const OWN_BREATH = { rate: 120, ringDeg: [6, 15], size1: [1.4, 2], sheetAlpha: 0.55, sheetFromM: 0.3, lowSize: 0.7 } as const;
/** Свет огня потока, м. */
export const BREATH_LIGHT_M = 7.5;
/** Конус дорастает до 12 м за столько секунд выдоха и гаснет за столько до конца потока. */
const BREATH_GROW_S = 0.15;
const BREATH_FADE_S = 0.25;
/** Угли, сходящиеся к груди чужого мага на вдохе, в секунду. */
const INHALE_RATE = 30;
/** Конусов разом — не больше (магов в комнате до 6). */
const MAX_BREATH = 6;
/** Пыль бегущего фронта трещины, частиц в секунду. */
export const RIFT_DUST_RATE = 70;
/** Шипов на линию — по обе стороны трещины, примерно один на 0,75 м. */
export const SPIKES_PER_RIFT = 34;
const MAX_RIFTS = 6;
const MAX_SPIKES = MAX_RIFTS * SPIKES_PER_RIFT;
/** Шипы вырастают за 0,1 с с перелётом и тают в последние 0,5 с. */
export const SPIKE_GROW_TICKS = Math.round(0.1 * TICK_HZ);
export const SPIKE_MELT_TICKS = Math.round(0.5 * TICK_HZ);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const part = particle;

/**
 * Частица потока от вершины apex по оси dir (единичной) при длине конуса len: рождается на первых 1,2 м оси, летит
 * внутри полуугла и гаснет к концу конуса. Пламя плотное и всплывает слабо, свет и угли — поверх.
 */
export function breathParticle(apex: Vec3, dir: Vec3, len: number, rng: Rng): ParticleSpec {
  const s0 = rng() * 1.2;
  const u = randomCone(dir, BREATH_HALF * 0.85, rng);
  return breathFrom(apex, dir, u, s0, len, rng);
}

/**
 * Своя частица потока (V4): летит в кольце 6–15° от оси взгляда, крупнее к концу; у прицела — чисто (флаг clear),
 * size — множитель пресета (на «Низком» 0,7).
 */
export function ownBreathParticle(apex: Vec3, dir: Vec3, len: number, size: number, rng: Rng): ParticleSpec {
  const s0 = 0.3 + rng() * 0.9;
  const a0 = (OWN_BREATH.ringDeg[0] * Math.PI) / 180;
  const a1 = (OWN_BREATH.ringDeg[1] * Math.PI) / 180;
  const u = randomRing(dir, a0, a1, rng);
  const p = breathFrom(apex, dir, u, s0, len, rng);
  const big = OWN_BREATH.size1[0] + rng() * (OWN_BREATH.size1[1] - OWN_BREATH.size1[0]);
  // пламя — до 1,4–2 м, свет — на треть меньше, угли — как были
  if (p.alpha > 0) p.size1 = big;
  else if (p.size1 > 0.1) p.size1 = big * 0.7;
  p.size0 *= size;
  p.size1 *= size;
  p.own = true;
  p.clear = true;
  return p;
}

function breathFrom(apex: Vec3, dir: Vec3, u: Vec3, s0: number, len: number, rng: Rng): ParticleSpec {
  const speed = 14 + rng() * 5;
  const life = Math.max(0.12, ((Math.max(len, 1.5) - s0) / speed) * (0.75 + 0.25 * rng()));
  const pos = { x: apex.x + dir.x * s0, y: apex.y + dir.y * s0, z: apex.z + dir.z * s0 };
  const vel = { x: u.x * speed, y: u.y * speed, z: u.z * speed };
  const r = rng();
  if (r < 0.55) return part("flame", pos, vel, life, 0.15 + rng() * 0.1, 0.9 + rng() * 0.5, rng, -1.5);
  if (r < 0.8) return part("glow", pos, vel, life, 0.2 + rng() * 0.1, 0.7 + rng() * 0.3, rng);
  return part("ember", pos, vel, life * 1.1, 0.05, 0.03, rng, 2);
}

/** Пыль и осколки у бегущего фронта трещины a → b; p — доля пути фронта 0…1. */
export function riftDust(a: Vec3, b: Vec3, p: number, rng: Rng): ParticleSpec {
  const t = clamp01(p - rng() * 0.04);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l;
  const uz = dz / l;
  const across = (rng() - 0.5) * 2 * TR.halfWidthM * 0.8;
  const pos = { x: a.x + dx * t - uz * across, y: a.y + 0.05, z: a.z + dz * t + ux * across };
  if (rng() < 0.25)
    return part("chip", pos, { x: ux * 2 + (rng() - 0.5), y: 3 + rng() * 2.5, z: uz * 2 + (rng() - 0.5) }, 0.5 + rng() * 0.3, 0.07, 0.05, rng);
  return part(
    "dust",
    pos,
    { x: ux * 1.5 + (rng() - 0.5) * 0.6, y: 0.6 + rng() * 1.2, z: uz * 1.5 + (rng() - 0.5) * 0.6 },
    0.6 + rng() * 0.35,
    0.25 + rng() * 0.15,
    0.8 + rng() * 0.4,
    rng,
  );
}

/**
 * Высота шипов зоны Разлома на тике tick (дробный — между тиками), доля 0…1+: до взвода и с конца зоны — 0; за 0,1 с
 * после взвода вырастают ease-out с перелётом до ≈ 9 %, в последние 0,5 с уходят в землю.
 */
export function spikeRise(z: Zone, tick: number): number {
  if (z.kind !== "rift" || tick < z.armTick || tick >= z.endTick) return 0;
  const g = clamp01((tick - z.armTick) / SPIKE_GROW_TICKS);
  const grow = 1 - (1 - g) ** 3 + (g < 1 ? 0.15 * Math.sin(Math.PI * g) : 0);
  const left = clamp01((z.endTick - tick) / SPIKE_MELT_TICKS);
  return grow * left * left * (3 - 2 * left);
}

/** Хеш (id зоны, номер шипа, канал) → [0, 1): раскладка шипов на каждом кадре и у каждого игрока одна и та же. */
export function spikeHash(zone: number, i: number, ch: number): number {
  let h = Math.imul(zone + 1, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b) ^ Math.imul(ch + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Лист пламени на конусе: вершина у рта (у своего — у ладоней), ось — взгляд. Шум течёт от рта вперёд; координаты
 * шума — точка поперёк оси в метрах, поэтому шва развёртки нет. Конец рваный и гаснет; у своего лист начинается
 * в метре от рук и в полсилы, чтобы не застить прицел. По краю языков — кайма (V3): своя гладкая оранжевая, чужая
 * тёмная зубчатая.
 */
const BREATH_VERT = /* glsl */ `
attribute vec4 aB0; // вершина (x, y, z), семя
attribute vec4 aB1; // ось (x, y, z), длина, м
attribute vec4 aB2; // плотность (гаснет к концу потока), свой (1), чужой (1), 0
varying vec3 vRel;
varying vec4 vInfo;
varying vec3 vView;
void main() {
  vec3 ax = normalize(aB1.xyz);
  vec3 ref = abs(ax.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 sx = normalize(cross(ax, ref));
  vec3 sy = cross(sx, ax);
  float len = aB1.w;
  // position: y ∈ [0, 1] — доля длины; (x, z) — круг радиуса y
  float d = position.y * len;
  vec2 c = position.xz * len * BREATH_TAN;
  vec3 w = aB0.xyz + ax * d + sx * c.x + sy * c.y;
  vRel = vec3(c, d);
  vInfo = vec4(len, aB2.x, aB0.w, aB2.y + 2.0 * aB2.z);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const BREATH_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFire;
uniform vec3 uCore;
uniform vec3 uEmber;
uniform vec3 uShade;
uniform vec3 uRimOwn;
uniform vec3 uRimFoe;
varying vec3 vRel;
varying vec4 vInfo;
varying vec3 vView;
void main() {
  float vis = fxVisibility(0.3);
  if (vis <= 0.0) discard;
  float len = max(vInfo.x, 0.01);
  float fade = vInfo.y;
  float seed = vInfo.z;
  bool own = vInfo.w > 0.5 && vInfo.w < 1.5;
  bool foe = vInfo.w > 1.5;
  float d = vRel.z;
  float a01 = d / BREATH_LEN;
  float t = uTime;
  float n = fxFbm(vec2(vRel.x * 0.9 + vRel.y * 0.7 + seed, d * 0.45 - t * 4.5));
  float n2 = fxNoise(vec2(vRel.y * 1.6 - vRel.x * 0.5 - seed, d * 1.1 - t * 7.0));
  float flame = 0.62 + (n - 0.5) * 1.3 + (n2 - 0.5) * 0.5 - a01 * 0.45;
  float tip = 1.0 - smoothstep(0.7, 1.0, d / len + (n2 - 0.5) * 0.25);
  // свой лист — с 0,3 м от ладоней, центр кадра у прицела чист (V4)
  float root = own ? smoothstep(OWN_FROM, OWN_FROM + 0.6, d) * smoothstep(CLEAR_TAN0, CLEAR_TAN1, length(vView.xy) / max(-vView.z, 1e-3)) : smoothstep(0.0, 0.05, a01);
  float body = tip * root * fade;
  float dens = smoothstep(0.1, 0.45, flame) * body;
  // кайма по краю языков: чужая — шум втрое чаще и тёмная тушь, своя — гладкая оранжевая
  float rim = 0.0;
  if (own || foe) {
    float jag = foe ? (fxNoise(vec2(vRel.x * 2.7 - vRel.y * 2.1 + seed, d * 1.35 - t * 13.5)) - 0.5) * 0.14 : 0.0;
    rim = smoothstep(0.06, 0.11, flame + jag) * (1.0 - smoothstep(0.17, 0.25, flame - jag)) * body * (foe ? RIM_FOE_A : RIM_OWN_A);
  }
  if (dens + rim <= 0.002) discard;
  float heat = clamp(flame, 0.0, 1.0) * (1.0 - 0.45 * a01);
  vec3 col = mix(uEmber, uShade, smoothstep(0.0, 0.18, heat));
  col = mix(col, uFire, smoothstep(0.18, 0.5, heat));
  col = mix(col, uCore, smoothstep(0.62, 1.0, heat));
  float a = dens * (own ? OWN_ALPHA : 0.6) * fxDense(vis);
  vec3 glow = col * heat * 0.55 * dens * vis;
  float ra = rim * fxDense(vis);
  vec3 rc = foe ? uRimFoe : uRimOwn;
  gl_FragColor = vec4(rc * ra + (col * a + glow) * (1.0 - ra), ra + a * (1.0 - ra));
}
`;

/**
 * «Магия гасит день» (Р7): бумага и небо × (1 − 0,12·k). k = 1, пока идёт своя ульта или чужая, в зону которой ты
 * попал (дальность + 5 м); иначе 0. Темнеет за 0,4 с, светлеет за 0,8 с; новое затемнение — не чаще раза в 8 с
 * (ульта, начавшаяся раньше, день не гасит). Линии и враг не гаснут — это стилевой проход.
 */
export const DAY_DIM = { inS: 0.4, outS: 0.8, everyS: 8, nearM: 5 } as const;
/** Разлом — удар через столько секунд после взвода ещё гасит день; шипы потом стоят без затемнения. */
const RIFT_DIM_S = 0.5;

const flat = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
/** Расстояние по XZ от p до отрезка a → b. */
function toSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? clamp01(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}
/** Расстояние по XZ от p до полосы, которую пройдёт гребень Цунами a → b (ход — (n.z, −n.x), на travelM вперёд). */
function toWavePath(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  const nx = dx / l;
  const nz = dz / l;
  const qx = p.x - a.x;
  const qz = p.z - a.z;
  const s = Math.min(l, Math.max(0, qx * nx + qz * nz));
  const t = Math.min(WATER.tsunami.travelM, Math.max(0, qx * nz - qz * nx));
  return Math.hypot(qx - nx * s - nz * t, qz - nz * s + nx * t);
}

/**
 * Гасит ли ульта день на тике tick: своя идёт (каст или её зона: волна Цунами, удар Разлома) — да; чужая — если me
 * (подошва своего мага; null — его нет) в её зоне + 5 м: Дыхание — 12 м от мага, Ураган — 10 м, Разлом — у линии,
 * Цунами — на пути волны.
 */
export function ultDimsDay(s: MatchState, localId: UnitId, tick: number, me: Vec3 | null): boolean {
  const near = DAY_DIM.nearM;
  for (const u of s.units) {
    const c = u.mage?.ult.cast;
    if (!c || !u.alive || tick >= c.endTick) continue;
    if (u.id === localId) return true;
    if (!me) continue;
    const at = u.move.body.pos;
    if (c.ability === "dragonBreath" && Math.hypot(at.x - me.x, at.y - me.y, at.z - me.z) <= FIRE.dragonBreath.rangeM + near) return true;
    if (c.ability === "hurricane" && flat(at, me) <= AIR.hurricane.radiusM + near) return true;
  }
  for (const z of s.zones) {
    if (z.shape.type !== "segment" || tick >= z.endTick) continue;
    const rift = z.kind === "rift" && tick < z.armTick + RIFT_DIM_S * TICK_HZ;
    if (!rift && z.kind !== "tsunami") continue;
    if (z.owner === localId) return true;
    if (!me) continue;
    if (rift && toSegment(me, z.shape.a, z.shape.b) <= z.shape.halfW + near) return true;
    if (z.kind === "tsunami" && toWavePath(me, z.shape.a, z.shape.b) <= near) return true;
  }
  return false;
}

/** k «магии, гасящей день»: want — гасит ли ульта день сейчас; новое затемнение — по фронту want, не чаще everyS. */
export interface DayDimState {
  k: number;
  on: boolean;
  want: boolean;
  lastOnS: number;
}
export const dayDimState = (): DayDimState => ({ k: 0, on: false, want: false, lastOnS: -Infinity });
export function stepDayDim(d: DayDimState, want: boolean, nowS: number, dt: number): number {
  if (want && !d.want && nowS - d.lastOnS >= DAY_DIM.everyS) {
    d.on = true;
    d.lastOnS = nowS;
  }
  if (!want) d.on = false;
  d.want = want;
  d.k = d.on ? Math.min(1, d.k + dt / DAY_DIM.inS) : Math.max(0, d.k - dt / DAY_DIM.outS);
  // плавно у обоих концов
  return d.k * d.k * (3 - 2 * d.k);
}

export const createUltVfx: ElementVfxFactory = ({ gbuffer, time }): ElementVfx => {
  // конус Дыхания: проход света, один вызов на все конусы
  const attr = (): InstancedBufferAttribute => {
    const a = new InstancedBufferAttribute(new Float32Array(MAX_BREATH * 4), 4);
    a.setUsage(DynamicDrawUsage);
    return a;
  };
  const b0 = attr();
  const b1 = attr();
  const b2 = attr();
  const coneAttrs = [b0, b1, b2] as const;
  // открытый конус: вершина в 0, основание радиуса 1 на y = 1
  const coneGeom = new CylinderGeometry(1, 0, 1, 14, 8, true).translate(0, 0.5, 0);
  coneGeom.setAttribute("aB0", b0);
  coneGeom.setAttribute("aB1", b1);
  coneGeom.setAttribute("aB2", b2);
  const coneMat = createFxMaterial({
    name: "fx-ult-breath",
    vertexShader: BREATH_VERT,
    fragmentShader: BREATH_FRAG,
    gbuffer,
    defines: {
      BREATH_TAN: glslFloat(BREATH_TAN),
      BREATH_LEN: glslFloat(BREATH_LEN_M),
      RIM_OWN_A: glslFloat(RIM.own.alpha),
      RIM_FOE_A: glslFloat(RIM.foe.alpha),
      OWN_ALPHA: glslFloat(OWN_BREATH.sheetAlpha),
      OWN_FROM: glslFloat(OWN_BREATH.sheetFromM),
      CLEAR_TAN0: glslFloat(Math.tan((CLEAR_DEG[0] * Math.PI) / 180)),
      CLEAR_TAN1: glslFloat(Math.tan((CLEAR_DEG[1] * Math.PI) / 180)),
    },
    uniforms: {
      uTime: time,
      uFire: { value: new Vector3(...FX_COLOR.fire) },
      uCore: { value: new Vector3(...FX_COLOR.core) },
      uEmber: { value: new Vector3(...FX_COLOR.ember) },
      uShade: { value: new Vector3(...FX_COLOR.fireShade) },
      uRimOwn: { value: new Vector3(...RIM.own.breath) },
      uRimFoe: { value: new Vector3(...RIM.foe.fire) },
    },
  });
  const cones = new InstancedMesh<CylinderGeometry, ShaderMaterial>(coneGeom, coneMat, MAX_BREATH);
  cones.name = "fx-ult-breath";
  cones.frustumCulled = false;
  cones.renderOrder = FX_ORDER.fireWalls;
  cones.count = 0;
  cones.visible = false;

  // шипы Разлома: G-буфер, чернила рельефа Земли, один вызов на все линии
  const spikeGeom = new ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0);
  const spikes = new InstancedMesh<ConeGeometry, ShaderMaterial>(spikeGeom, createInkMaterial(INK.terrain), MAX_SPIKES);
  spikes.name = "ult-spikes";
  spikes.frustumCulled = false;
  spikes.instanceMatrix.setUsage(DynamicDrawUsage);
  spikes.count = 0;
  spikes.visible = false;

  const rng: Rng = Math.random;
  /** Пресет: своё Дыхание не прореживается долей пресета (темп делится на неё заранее), на «Низком» — меньше. */
  let preset: PresetId = "high";
  // покадровое — одно на эффектник: кадр переписывает, а не создаёт
  const apex = new Vector3();
  const axis = new Vector3();
  const mat = new Matrix4();
  const q = new Quaternion();
  const qTwist = new Quaternion();
  const pos = new Vector3();
  const scale = new Vector3();
  const lineAxis = new Vector3();
  const UP = new Vector3(0, 1, 0);
  const specs: ParticleSpec[] = [];
  /** Дробные остатки темпа частиц: поток и вдох по магу, пыль по зоне. */
  const flowAcc = new Map<UnitId, number>();
  const dustAcc = new Map<number, number>();
  const liveUnits = new Set<UnitId>();
  const liveZones = new Set<number>();
  const dim = dayDimState();

  /** Сколько частиц родить за кадр по темпу rate (остаток копится в acc под ключом id). */
  function due<K>(acc: Map<K, number>, id: K, rate: number, dt: number): number {
    const k = (acc.get(id) ?? 0) + dt * rate;
    const n = Math.floor(k);
    acc.set(id, k - n);
    return n;
  }

  /** Вершина и ось чужого мага: поза фигуры (поворот между тиками и пауза попадания), без фигуры — юнит. */
  function mageAim(f: ElementVfxFrame, id: UnitId, at: Vec3, yaw0: number, pitch0: number): void {
    let p = at;
    let yaw = yaw0;
    let pitch = pitch0;
    for (const m of f.mages)
      if (m.id === id) {
        p = m.pose.pos;
        yaw = m.pose.yaw;
        pitch = m.pose.pitch;
        break;
      }
    const fw = forwardXZ(yaw);
    apex.set(p.x + fw.x * 0.35, p.y + EYE_HEIGHT - 0.12, p.z + fw.z * 0.35);
    const d = aimDir(yaw, pitch);
    axis.set(d.x, d.y, d.z);
  }

  function drawBreath(f: ElementVfxFrame): void {
    let n = 0;
    liveUnits.clear();
    for (const it of f.units) {
      const c = it.u.mage?.ult.cast;
      if (!c || c.ability !== "dragonBreath") continue;
      const own = it.id === f.localId;
      const foe = !own && f.localId !== NOBODY;
      if (own) {
        const p = f.palmWorld("both");
        apex.set(p.x, p.y, p.z);
        f.camera.getWorldDirection(axis);
      } else mageAim(f, it.id, it.pos, it.u.move.yaw, it.u.move.pitch);
      if (f.tick < c.releaseTick) {
        // вдох: у груди (у своего — у ладоней) разгорается свет; к чужому сходятся угли
        liveUnits.add(it.id);
        const k = clamp01((f.tick - c.startTick) / Math.max(1, c.releaseTick - c.startTick));
        const chest = own ? 0 : 0.25;
        f.glow({ pos: { x: apex.x, y: apex.y - chest, z: apex.z }, color: FX_COLOR.fire, halo: own ? 0.15 + 0.15 * k : 0.3 + 0.5 * k, light: 2 + 2 * k, intensity: 0.4 + 0.8 * k, core: 0.2 * k }, 2);
        if (own) continue;
        const m = due(flowAcc, it.id, INHALE_RATE, f.dt);
        if (m <= 0) continue;
        specs.length = 0;
        for (let i = 0; i < m; i++) {
          const r = 0.6 + rng() * 0.4;
          const u = randomCone(axis, 1.4, rng);
          const life = 0.25 + rng() * 0.1;
          specs.push(part("glow", { x: apex.x + u.x * r, y: apex.y - 0.25 + u.y * r, z: apex.z + u.z * r }, { x: (-u.x * r) / life, y: (-u.y * r) / life, z: (-u.z * r) / life }, life, 0.1, 0.25, rng, 0));
        }
        f.emit(specs);
        continue;
      }
      if (!breathStreaming(c, f.tick) || n >= MAX_BREATH) continue;
      liveUnits.add(it.id);
      const since = (f.tick - c.releaseTick) / TICK_HZ;
      const grow = 1 - (1 - clamp01(since / BREATH_GROW_S)) ** 2;
      const fade = clamp01((c.endTick - f.tick) / TICK_HZ / BREATH_FADE_S);
      const len = BREATH_LEN_M * Math.max(0.05, grow);
      b0.setXYZW(n, apex.x, apex.y, apex.z, (it.id * 0.618) % 7);
      b1.setXYZW(n, axis.x, axis.y, axis.z, len);
      b2.setXYZW(n, fade, own ? 1 : 0, foe ? 1 : 0, 0);
      n++;
      // частицы огня по конусу ≤ 90/с; своё — 120/с в кольце у прицела (V4)
      const m = due(flowAcc, it.id, own ? OWN_BREATH.rate / BURST_SHARE[preset] : BREATH_RATE, f.dt);
      if (m > 0) {
        specs.length = 0;
        const size = preset === "low" ? OWN_BREATH.lowSize : 1;
        for (let i = 0; i < m; i++) {
          const p = own ? ownBreathParticle(apex, axis, len, size, rng) : breathParticle(apex, axis, len, rng);
          if (foe) p.foe = true;
          specs.push(p);
        }
        f.emit(specs);
      }
      // свет огня 7,5 м у основания потока и ореол дальше по оси; у своего ореолов нет — они легли бы на прицел (V4),
      // остаётся свет на мир
      const flicker = 0.85 + 0.15 * Math.sin(f.nowS * 23 + it.id) * Math.sin(f.nowS * 9.3 + it.id * 2);
      const near = Math.min(3, len);
      const far = len * 0.65;
      f.glow(
        { pos: { x: apex.x + axis.x * near, y: apex.y + axis.y * near, z: apex.z + axis.z * near }, color: FX_COLOR.fire, halo: own ? 0 : 1.4, light: BREATH_LIGHT_M, intensity: (own ? 0.55 : 0.95) * fade * flicker, core: own ? 0 : 0.3 },
        3,
      );
      if (!own) f.glow({ pos: { x: apex.x + axis.x * far, y: apex.y + axis.y * far, z: apex.z + axis.z * far }, color: FX_COLOR.fire, halo: 2.2, light: 0, intensity: 0.6 * fade * flicker, core: 0 }, 2);
    }
    for (const id of flowAcc.keys()) if (!liveUnits.has(id)) flowAcc.delete(id);
    for (const a of coneAttrs) {
      a.clearUpdateRanges();
      if (n === 0) continue;
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    cones.count = n;
    cones.visible = n > 0;
  }

  function drawRifts(f: ElementVfxFrame): void {
    let n = 0;
    liveZones.clear();
    for (const z of f.cur.zones) {
      if (z.kind !== "rift" || z.shape.type !== "segment") continue;
      const { a, b } = z.shape;
      if (f.tick < z.armTick) {
        // телеграф: фронт трещины бежит от мага за 0,8 с и поднимает пыль
        liveZones.add(z.id);
        const m = due(dustAcc, z.id, RIFT_DUST_RATE, f.dt);
        if (m <= 0) continue;
        const p = clamp01((f.tick - z.bornTick) / Math.max(1, z.armTick - z.bornTick));
        specs.length = 0;
        for (let i = 0; i < m; i++) specs.push(riftDust(a, b, p, rng));
        f.emit(specs);
        continue;
      }
      const rise = spikeRise(z, f.tick);
      if (rise <= 0.01) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      lineAxis.set(dx / l, 0, dz / l);
      // поперёк линии: (−uz, ux) — туда шип наклоняется при положительном угле вокруг оси линии
      const px = -lineAxis.z;
      const pz = lineAxis.x;
      for (let i = 0; i < SPIKES_PER_RIFT && n < MAX_SPIKES; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const t = clamp01((i + 0.5 + (spikeHash(z.id, i, 0) - 0.5) * 0.8) / SPIKES_PER_RIFT);
        const across = side * (0.12 + 0.55 * spikeHash(z.id, i, 1));
        const h = 0.9 + spikeHash(z.id, i, 2);
        const r = 0.2 + 0.16 * spikeHash(z.id, i, 3);
        q.setFromAxisAngle(lineAxis, side * (0.1 + 0.25 * spikeHash(z.id, i, 4)));
        qTwist.setFromAxisAngle(UP, spikeHash(z.id, i, 5) * Math.PI * 2);
        q.multiply(qTwist);
        pos.set(a.x + dx * t + px * across, a.y + (b.y - a.y) * t - 0.05, a.z + dz * t + pz * across);
        scale.set(r, h * rise, r);
        spikes.setMatrixAt(n++, mat.compose(pos, q, scale));
      }
    }
    for (const id of dustAcc.keys()) if (!liveZones.has(id)) dustAcc.delete(id);
    spikes.count = n;
    spikes.visible = n > 0;
    if (n > 0) spikes.instanceMatrix.needsUpdate = true;
  }

  return {
    world: spikes,
    light: cones,
    sync(f) {
      drawBreath(f);
      drawRifts(f);
      let me: Vec3 | null = null;
      for (const it of f.units) if (it.id === f.localId) me = it.pos;
      styleShared.dayDim.value = stepDayDim(dim, ultDimsDay(f.cur, f.localId, f.tick, me), f.nowS, f.dt);
    },
    setPreset(p) {
      preset = p;
      // «Низкое» и «Среднее»: шум пламени в две октавы (FX_CHEAP), как у стены огня
      const cheap = p !== "high";
      if (("FX_CHEAP" in coneMat.defines) === cheap) return;
      if (cheap) coneMat.defines.FX_CHEAP = "";
      else delete coneMat.defines.FX_CHEAP;
      coneMat.needsUpdate = true;
    },
    dispose() {
      coneGeom.dispose();
      coneMat.dispose();
      cones.dispose();
      spikeGeom.dispose();
      spikes.material.dispose();
      spikes.dispose();
      flowAcc.clear();
      dustAcc.clear();
      styleShared.dayDim.value = 0;
    },
  };
};
