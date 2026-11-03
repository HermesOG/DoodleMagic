import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, Vector3, type ShaderMaterial } from "three";
import { NOBODY, TICK_HZ, WATER, forwardXZ, type Projectile, type Unit, type UnitId, type Vec3, type Zone } from "@doodlemagic/sim";
import type { ElementVfx, ElementVfxFactory, ElementVfxFrame } from "./elementVfx";
import { FX_ORDER, createFxMaterial } from "./fxShader";
import { lerpById, muzzleBlend } from "./interp";
import { mageHands } from "./mageMeshes";
import { FX_COLOR, UP, spawn, type ParticleSpec } from "./particleKit";
import { WATER_STREAM } from "./presets.water";

/*
 * Эффекты Воды (03-water, «Читается»). Один меш прохода света — InstancedMesh «листов» трёх видов, один вызов отрисовки:
 * - 0 — отрезок струи: канат Хвата в полёте и натянутый канат буксира, дуга хлыста (лента к камере, тонкие отрезки);
 * - 1 — диск Отражения ~2 × 2 м перед чужой Водой; свой — полупрозрачное кольцо в 1,2 м перед камерой;
 * - 2 — лужа Родника: кольцо разбегается за 0,4 с, рябь, лазурное свечение; у чужой — тёмная зубчатая кромка (GDD 2.2).
 * Частицы (пузыри, пар, капли Мокрого, брызги дуги) — общим пулом через frame.emit, свет — frame.glow.
 */

/** Отрезков на канат и на дугу хлыста. */
export const ROPE_SEGMENTS = 10;
export const ARC_SEGMENTS = 12;
/** Дуга хлыста видна столько секунд. */
export const ARC_S = 0.18;
/** Свой диск — кольцо в 1,2 м перед камерой; чужой — диск радиусом 1 м в 0,9 м перед Водой. */
export const OWN_WARD_M = 1.2;
const OWN_WARD_R = 0.62;
const WARD_R = 1;
/** Частоты струй, в секунду: пузыри лужи ≤ 20, пар ≤ 30, капли Мокрого ≤ 6 на юнита. */
export const RATE = { bubbles: 16, steam: 24, drips: 5, towSpray: 10 } as const;
const MAX_SHEETS = 160;

export type Sheet =
  | { type: 0; a: Vec3; b: Vec3; width: number; intensity: number; seed: number }
  | { type: 1; centre: Vec3; normal: Vec3; radius: number; intensity: number; seed: number; bright: number; ringOnly: boolean }
  | { type: 2; centre: Vec3; radius: number; intensity: number; seed: number; spread: number; enemy: boolean };

const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Точки каната от руки from до конца to: n отрезков (n + 1 точек), концы ровно в from и to. Посередине — волна
 * поперёк (wave, м; затухает к концам) и провис вниз (sag, м).
 */
export function ropePoints(from: Vec3, to: Vec3, n: number, wave: number, phase: number, sag = 0): Vec3[] {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const h = Math.hypot(d.x, d.z);
  // поперёк — горизонталь, перпендикулярная канату
  const side = h > 1e-6 ? { x: -d.z / h, z: d.x / h } : { x: 1, z: 0 };
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * t);
    const w = wave * env * Math.sin(phase + t * 9);
    const s = sag * env;
    out.push(i === 0 ? { ...from } : i === n ? { ...to } : { x: from.x + d.x * t + side.x * w, y: from.y + d.y * t - s, z: from.z + d.z * t + side.z * w });
  }
  return out;
}

/** Дуга хлыста: квадратичная кривая от ладони к точке, выгнута вверх и вбок на долю длины. */
export function arcPoints(from: Vec3, to: Vec3, n: number, bend = 0.12): Vec3[] {
  const len = dist(from, to);
  const d = { x: to.x - from.x, z: to.z - from.z };
  const h = Math.hypot(d.x, d.z);
  const side = h > 1e-6 ? { x: -d.z / h, z: d.x / h } : { x: 1, z: 0 };
  const c = { x: (from.x + to.x) / 2 + side.x * len * bend * 0.6, y: (from.y + to.y) / 2 + len * bend, z: (from.z + to.z) / 2 + side.z * len * bend * 0.6 };
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const e = t * t;
    out.push({ x: a * from.x + b * c.x + e * to.x, y: a * from.y + b * c.y + e * to.y, z: a * from.z + b * c.z + e * to.z });
  }
  return out;
}

/** Яркость диска по впитанному: 0 пустой, 1 — к пределу Ответа (60). */
export function wardBrightness(absorbed: number): number {
  return clamp01(absorbed / WATER.waterWard.answer.maxDamage);
}

/** Диск стоит на тике tick: есть, маг жив и срок не вышел (мёртвая Вода держит ward до возрождения). */
export function wardShown(u: Unit, tick: number): boolean {
  const w = u.mage?.ward;
  return !!w && u.alive && tick < w.endTick;
}

/** Канат: откуда (рука хозяина) и куда (снаряд или цель буксира); taut — натянутый буксир. */
export interface Rope {
  key: number;
  from: Vec3;
  to: Vec3;
  taut: boolean;
  ageS: number;
}

/**
 * Канаты Воды за кадр: жгут Хвата в полёте — от руки хозяина до снаряда; буксир — от руки Воды до середины цели.
 * hand — рука юнита в мире (свой — ладонь, чужой — рука фигуры), null — не видно.
 */
export function waterRopes(
  projectiles: readonly { pr: Projectile; pos: Vec3 }[],
  units: readonly { id: UnitId; pos: Vec3; u: Unit }[],
  tick: number,
  hand: (id: UnitId) => Vec3 | null,
): Rope[] {
  const out: Rope[] = [];
  for (const { pr, pos } of projectiles) {
    if (pr.ability !== "waterGrab") continue;
    const from = hand(pr.owner);
    if (from) out.push({ key: pr.id, from, to: pos, taut: false, ageS: Math.max(0, (tick - pr.bornTick) / TICK_HZ) });
  }
  for (const it of units) {
    const tow = it.u.tow;
    if (!tow || tow.by === NOBODY) continue;
    const from = hand(tow.by);
    if (from) out.push({ key: -1 - it.id, from, to: { x: it.pos.x, y: it.pos.y + it.u.move.body.height / 2, z: it.pos.z }, taut: true, ageS: 0 });
  }
  return out;
}

/** Лужа Родника на дробном тике: доля радиуса (кольцо разбегается до взвода, 0,4 с) и плотность (гаснет к концу). */
export function springPool(z: Zone, tick: number, localId: UnitId): Extract<Sheet, { type: 2 }> | null {
  if (z.kind !== "spring" || z.shape.type !== "disc" || tick < z.bornTick || tick >= z.endTick) return null;
  const t = clamp01((tick - z.bornTick) / Math.max(1, z.armTick - z.bornTick));
  const spread = 1 - (1 - t) ** 3;
  const fade = clamp01((z.endTick - tick) / 18);
  const c = z.shape.center;
  return {
    type: 2,
    centre: { x: c.x, y: c.y, z: c.z },
    radius: z.shape.radius,
    intensity: fade,
    seed: (z.id * 0.37) % 13,
    spread: Math.max(0.02, spread),
    enemy: localId !== NOBODY && z.owner !== localId,
  };
}

const VERT = /* glsl */ `
attribute vec4 aA; // 0: начало отрезка; 1, 2: центр. w — вид листа
attribute vec4 aB; // 0: конец отрезка; 1: нормаль диска. w — полуширина или радиус
attribute vec4 aC; // яркость, семя, p, q (диск: светлота, «только кольцо»; лужа: доля радиуса, чужая)
varying vec2 vQ;
varying vec4 vS;
varying float vType;
varying float vLen;
void main() {
  float type = aA.w;
  vec2 q = position.xy * 2.0;
  vec3 w;
  vLen = 1.0;
  if (type < 0.5) {
    // лента от a до b, развёрнута к камере
    vec3 d = aB.xyz - aA.xyz;
    vec3 mid = (aA.xyz + aB.xyz) * 0.5;
    vec3 side = cross(d, cameraPosition - mid);
    float sl = length(side);
    side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
    w = mid + d * (0.5 * q.x) + side * (aB.w * q.y);
    vLen = length(d);
  } else if (type < 1.5) {
    vec3 n = normalize(aB.xyz);
    vec3 u = normalize(abs(n.y) < 0.95 ? cross(vec3(0.0, 1.0, 0.0), n) : cross(vec3(1.0, 0.0, 0.0), n));
    vec3 v = cross(n, u);
    w = aA.xyz + (u * q.x + v * q.y) * aB.w;
  } else {
    // лужа чуть над полом: глубина мира не прячет её целиком
    w = aA.xyz + vec3(q.x * aB.w, 0.06, q.y * aB.w);
  }
  vQ = q;
  vS = aC;
  vType = type;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uWater;
uniform vec3 uFoam;
uniform vec3 uDark;
varying vec2 vQ;
varying vec4 vS;
varying float vType;
varying float vLen;
void main() {
  float vis = fxVisibility(vType > 1.5 ? 0.04 : 0.15);
  if (vis <= 0.0) discard;
  float I = vS.x;
  float seed = vS.y;
  vec3 col = uWater;
  float a = 0.0;
  float glow = 0.0;
  if (vType < 0.5) {
    // струя: плотная середина, края рвутся, вдоль бегут блики пены
    float across = abs(vQ.y);
    float n = fxNoise(vec2(vQ.x * vLen * 2.5 - uTime * 10.0 + seed, vQ.y * 1.5 + seed));
    float body = 1.0 - smoothstep(0.45, 1.0, across + (n - 0.5) * 0.5);
    float hi = (1.0 - smoothstep(0.0, 0.4, across)) * smoothstep(0.45, 0.8, n);
    col = mix(uWater, uFoam, hi * 0.7);
    a = body * 0.8 * I;
    glow = body * 0.4 * I;
  } else if (vType < 1.5) {
    // диск Отражения: кромка и рябь; чем больше впитал, тем светлее; свой — только кромка
    float r = length(vQ);
    if (r > 1.0) discard;
    float n = fxFbm(vQ * 2.5 + vec2(seed, uTime * 0.7));
    float rim = smoothstep(0.8, 0.93, r + (n - 0.5) * 0.1) * (1.0 - smoothstep(0.95, 1.0, r));
    float ripple = 0.5 + 0.5 * sin(r * 20.0 - uTime * 5.0 + n * 5.0);
    float ringOnly = step(0.5, vS.w);
    float fill = (1.0 - ringOnly) * (0.16 + 0.1 * ripple) * (1.0 - smoothstep(0.6, 0.95, r));
    float bright = vS.z;
    col = mix(uWater, uFoam, 0.15 + 0.65 * bright);
    a = (rim * 0.7 + fill) * I * mix(1.0, 0.5, ringOnly);
    glow = (rim * (0.35 + 0.9 * bright) + fill * bright * 1.2) * I;
  } else {
    // лужа: тело до доли радиуса vS.z, светлая кромка-волна, рябь
    float r = length(vQ);
    float rr = r / max(vS.z, 0.001);
    if (rr > 1.02) discard;
    float n = fxFbm(vQ * 5.0 + seed);
    float body = 1.0 - smoothstep(0.92, 1.0, rr + (n - 0.5) * 0.08);
    float ring = smoothstep(0.82, 0.96, rr + (n - 0.5) * 0.1) * body;
    float ripple = 0.5 + 0.5 * sin(r * 26.0 - uTime * 3.0 + n * 6.0);
    col = mix(uWater, uFoam, ring * 0.6 + ripple * 0.12);
    a = (0.22 + 0.08 * ripple + ring * 0.4) * body * I;
    glow = (0.18 + ring * 0.5) * body * I;
    if (vS.w > 0.5) {
      // чужая: тёмная зубчатая кромка, 60 зубцов
      float saw = abs(fract(atan(vQ.y, vQ.x) * 9.5493 + seed) - 0.5) * 2.0;
      float band = step(0.88, rr) * (1.0 - step(0.9 + 0.08 * saw, rr)) * body;
      col = mix(col, uDark, band);
      a = mix(a, 0.75 * I, band);
      glow *= 1.0 - band;
    }
  }
  if (a + glow <= 0.002) discard;
  vec4 L = fxLight(col * glow * vis, 0.5);
  gl_FragColor = fxCompose(col, a * fxDense(vis), L);
}
`;

interface Arc {
  to: Vec3;
  /** Глаза кастующего (to + dir эффекта). */
  eye: Vec3;
  bornS: number;
  /** Кто бьёт (owner эффекта); null — неизвестно, рисуем от глаз. Своя дуга — из ладони: id сверяется с localId. */
  owner: UnitId | null;
  sprayed: boolean;
}

export const createWaterVfx: ElementVfxFactory = ({ gbuffer, time }): ElementVfx => {
  const a0 = new InstancedBufferAttribute(new Float32Array(MAX_SHEETS * 4), 4);
  const a1 = new InstancedBufferAttribute(new Float32Array(MAX_SHEETS * 4), 4);
  const a2 = new InstancedBufferAttribute(new Float32Array(MAX_SHEETS * 4), 4);
  for (const a of [a0, a1, a2]) a.setUsage(DynamicDrawUsage);
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute("aA", a0);
  geometry.setAttribute("aB", a1);
  geometry.setAttribute("aC", a2);
  const v3 = (c: readonly [number, number, number]) => new Vector3(c[0], c[1], c[2]);
  const material: ShaderMaterial = createFxMaterial({
    name: "fx-water",
    vertexShader: VERT,
    fragmentShader: FRAG,
    gbuffer,
    uniforms: { uTime: time, uWater: { value: v3(FX_COLOR.water) }, uFoam: { value: v3(FX_COLOR.foam) }, uDark: { value: new Vector3(0.08, 0.1, 0.13) } },
  });
  const mesh = new InstancedMesh(geometry, material, MAX_SHEETS);
  mesh.name = "fx-water";
  mesh.frustumCulled = false;
  // поверх стен огня и телеграфов, под частицами
  mesh.renderOrder = FX_ORDER.decals;
  mesh.count = 0;
  mesh.visible = false;

  const arcs: Arc[] = [];
  const acc = new Map<string, number>();
  const camDir = new Vector3();
  let n = 0;

  const push = (s: Sheet): void => {
    if (n >= MAX_SHEETS) return;
    if (s.type === 0) {
      a0.setXYZW(n, s.a.x, s.a.y, s.a.z, 0);
      a1.setXYZW(n, s.b.x, s.b.y, s.b.z, s.width);
      a2.setXYZW(n, s.intensity, s.seed, 0, 0);
    } else if (s.type === 1) {
      a0.setXYZW(n, s.centre.x, s.centre.y, s.centre.z, 1);
      a1.setXYZW(n, s.normal.x, s.normal.y, s.normal.z, s.radius);
      a2.setXYZW(n, s.intensity, s.seed, s.bright, s.ringOnly ? 1 : 0);
    } else {
      a0.setXYZW(n, s.centre.x, s.centre.y, s.centre.z, 2);
      a1.setXYZW(n, 0, 1, 0, s.radius);
      a2.setXYZW(n, s.intensity, s.seed, s.spread, s.enemy ? 1 : 0);
    }
    n++;
  };
  const strip = (pts: readonly Vec3[], width: number, intensity: number, seed: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) push({ type: 0, a: pts[i]!, b: pts[i + 1]!, width, intensity, seed: seed + i * 0.13 });
  };
  /** Сколько частиц выпустить за кадр при частоте rate, с накоплением по ключу. */
  const due = (key: string, rate: number, dt: number, live: Set<string>): number => {
    live.add(key);
    const v = (acc.get(key) ?? Math.random()) + rate * dt;
    const k = Math.floor(v);
    acc.set(key, v - k);
    return k;
  };

  return {
    world: null,
    light: mesh,
    apply(e, nowS) {
      // дуга хлыста: конец — pos, глаза кастующего — pos + dir (см. waterFx, beam)
      if (e.kind !== "burst" || e.preset !== "whipArc") return;
      arcs.push({ to: { ...e.pos }, eye: { x: e.pos.x + e.dir.x, y: e.pos.y + e.dir.y, z: e.pos.z + e.dir.z }, bornS: nowS, owner: e.owner ?? null, sprayed: false });
      if (arcs.length > 8) arcs.shift();
    },
    sync(f: ElementVfxFrame) {
      n = 0;
      const out: ParticleSpec[] = [];
      const live = new Set<string>();
      const rng = Math.random;
      const tick = f.tick;
      const byId = new Map<UnitId, { pos: Vec3; u: Unit }>();
      for (const it of f.units) byId.set(it.id, it);
      const poseOf = (id: UnitId) => f.mages.find((m) => m.id === id);
      /** Рука юнита в мире: свой — правая ладонь, чужой — правая рука фигуры, манекен — грудь. */
      const hand = (id: UnitId): Vec3 | null => {
        if (id === f.localId) return f.palmWorld("right");
        const m = poseOf(id);
        if (m) return mageHands(m.pose).right;
        const it = byId.get(id);
        return it ? { x: it.pos.x, y: it.pos.y + 1.2, z: it.pos.z } : null;
      };

      // канаты: жгут в полёте и натянутый буксир
      const projectiles = lerpById<Projectile>(f.prev.projectiles, f.cur.projectiles, f.alpha)
        .filter((pr) => pr.ability === "waterGrab")
        .map((pr) => {
          // свой жгут первые 0,15 с выходит из ладони, как его ядро (vfx.ts)
          const k = pr.owner === f.localId ? muzzleBlend(Math.max(0, (tick - pr.bornTick) / TICK_HZ)) : 0;
          if (k <= 0) return { pr, pos: pr.pos };
          const pw = f.palmWorld("right");
          return { pr, pos: { x: pr.pos.x + (pw.x - f.eye.x) * k, y: pr.pos.y + (pw.y - f.eye.y) * k, z: pr.pos.z + (pw.z - f.eye.z) * k } };
        });
      for (const r of waterRopes(projectiles, f.units, tick, hand)) {
        const len = dist(r.from, r.to);
        // в полёте канат вьётся и провисает, волна гаснет; натянутый — дрожит
        const wave = r.taut ? 0.025 : 0.14 * Math.exp(-r.ageS * 5) + 0.03;
        const pts = ropePoints(r.from, r.to, ROPE_SEGMENTS, wave, f.nowS * (r.taut ? 40 : 18) + r.key, r.taut ? 0 : Math.min(0.25, len * 0.02));
        strip(pts, r.taut ? 0.05 : 0.04, 1, (r.key * 0.71) % 7);
        if (r.taut) {
          for (let i = due(`tow${r.key}`, RATE.towSpray, f.dt, live); i > 0; i--) out.push(spawn(WATER_STREAM.spray, lerpV(r.from, r.to, rng()), UP, rng));
          f.glow({ pos: lerpV(r.from, r.to, 0.5), color: FX_COLOR.water, halo: 0, light: 2, intensity: 0.5, core: 0 }, 2);
        }
      }

      // дуги хлыста
      for (let i = arcs.length - 1; i >= 0; i--) {
        const arc = arcs[i]!;
        const age = f.nowS - arc.bornS;
        if (age >= ARC_S || age < -0.5) {
          arcs.splice(i, 1);
          continue;
        }
        // чья рука — по id кастующего, не по расстоянию до камеры: чужой хлыст в упор не выходит из моей ладони
        const from = arc.owner !== null ? (hand(arc.owner) ?? arc.eye) : { x: arc.eye.x, y: arc.eye.y - 0.35, z: arc.eye.z };
        const k = 1 - age / ARC_S;
        const pts = arcPoints(from, arc.to, ARC_SEGMENTS);
        strip(pts, 0.05 * (0.6 + 0.4 * k), k, 3.1);
        if (!arc.sprayed) {
          arc.sprayed = true;
          for (let j = 0; j < 14; j++) out.push(spawn(WATER_STREAM.spray, pts[1 + Math.floor(rng() * (pts.length - 1))]!, UP, rng));
        }
        f.glow({ pos: arc.to, color: FX_COLOR.water, halo: 0.5 * k, light: 2.5, intensity: 0.8 * k, core: 0.2 * k }, 3);
      }

      // диски Отражения
      for (const it of f.units) {
        const u = it.u;
        const w = u.mage?.ward;
        if (!w || !wardShown(u, f.cur.tick)) continue;
        // встаёт за 0,1 с, уходит за 0,1 с
        const sinceUp = tick - (w.endTick - WATER.waterWard.durationS * TICK_HZ);
        const k = clamp01(sinceUp / 6) * clamp01((w.endTick - tick) / 6);
        const bright = wardBrightness(w.absorbed);
        if (it.id === f.localId) {
          f.camera.getWorldDirection(camDir);
          const c = { x: f.eye.x + camDir.x * OWN_WARD_M, y: f.eye.y + camDir.y * OWN_WARD_M, z: f.eye.z + camDir.z * OWN_WARD_M };
          push({ type: 1, centre: c, normal: { x: camDir.x, y: camDir.y, z: camDir.z }, radius: OWN_WARD_R * (0.8 + 0.2 * k), intensity: k, seed: 1.7, bright, ringOnly: true });
          continue;
        }
        const yaw = poseOf(it.id)?.pose.yaw ?? u.move.yaw;
        const fw = forwardXZ(yaw);
        const c = { x: it.pos.x + fw.x * 0.9, y: it.pos.y + 1.2, z: it.pos.z + fw.z * 0.9 };
        push({ type: 1, centre: c, normal: { x: fw.x, y: 0, z: fw.z }, radius: WARD_R * (0.6 + 0.4 * k), intensity: k, seed: (it.id * 0.53) % 5, bright, ringOnly: false });
        f.glow({ pos: c, color: FX_COLOR.water, halo: 0, light: 3, intensity: (0.4 + 0.8 * bright) * k, core: 0 }, 3);
      }

      // Родник: лужа, свечение, пузыри; пар: облако
      for (const z of f.cur.zones) {
        if (z.kind === "spring") {
          const pool = springPool(z, tick, f.localId);
          if (!pool) continue;
          push(pool);
          f.glow({ pos: { x: pool.centre.x, y: pool.centre.y + 0.4, z: pool.centre.z }, color: FX_COLOR.water, halo: 0, light: pool.radius + 1, intensity: 0.55 * pool.intensity, core: 0 }, 1);
          const r = pool.radius * pool.spread;
          for (let i = due(`spring${z.id}`, RATE.bubbles, f.dt, live); i > 0; i--) {
            const phi = rng() * Math.PI * 2;
            const d = r * Math.sqrt(rng());
            out.push(spawn(WATER_STREAM.bubble, { x: pool.centre.x + Math.cos(phi) * d, y: pool.centre.y + 0.05, z: pool.centre.z + Math.sin(phi) * d }, UP, rng));
          }
        } else if (z.kind === "steam" && z.shape.type === "disc" && tick < z.endTick) {
          const c = z.shape.center;
          for (let i = due(`steam${z.id}`, RATE.steam, f.dt, live); i > 0; i--) {
            const phi = rng() * Math.PI * 2;
            const d = z.shape.radius * Math.sqrt(rng());
            out.push(spawn(WATER_STREAM.mist, { x: c.x + Math.cos(phi) * d, y: c.y + rng() * 1.6, z: c.z + Math.sin(phi) * d }, UP, rng));
          }
        }
      }

      // Мокрые: капли с тела (свой — с ладоней), в том числе у манекенов
      for (const it of f.units) {
        if (it.u.status.wetUntil <= f.cur.tick) continue;
        for (let i = due(`wet${it.id}`, RATE.drips, f.dt, live); i > 0; i--) {
          const p =
            it.id === f.localId
              ? f.palmWorld(rng() < 0.5 ? "left" : "right")
              : { x: it.pos.x + (rng() - 0.5) * 0.6, y: it.pos.y + 0.6 + rng() * 1.1, z: it.pos.z + (rng() - 0.5) * 0.6 };
          out.push(spawn(WATER_STREAM.drip, p, UP, rng));
        }
      }
      for (const k of acc.keys()) if (!live.has(k)) acc.delete(k);

      if (out.length > 0) f.emit(out);
      for (const a of [a0, a1, a2]) {
        a.clearUpdateRanges();
        if (n === 0) continue;
        a.addUpdateRange(0, n * 4);
        a.needsUpdate = true;
      }
      mesh.count = n;
      mesh.visible = n > 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      arcs.length = 0;
      acc.clear();
    },
  };
};
