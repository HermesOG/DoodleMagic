import { BoxGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, Vector3, type ShaderMaterial } from "three";
import { AIR, forwardXZ, rightXZ, type Unit, type UnitId, type Vec3, type Zone } from "@doodlemagic/sim";
import { createInkMaterial } from "../render/gbuffer";
import { INK } from "../render/palette";
import type { ElementVfx, ElementVfxFactory, ElementVfxFrame } from "./elementVfx";
import { FX_COLOR, KIND, UP, spawn, type Kind, type ParticleSpec, type Rng } from "./particleKit";
import { AIR_STREAM } from "./presets.air";

/*
 * Эффекты Воздуха (02-air, «Читается»):
 * - ленты-шарфы на плаще чужого мага Воздуха — по ленте на заряд Взмаха; готовая светится (чернила ореола и свечение
 *   без света), потраченная висит тушью; в парении ленты расходятся в стороны и трепещут («раскрытый плащ»);
 * - Смерч: 0,5 с по полу раскручивается кольцо штрихов и пыли, дальше — столб ветра по спирали (≤ 60 частиц/с),
 *   кольцо пыли по краю диска (тяга) и свечение столба без света; огненный смерч — пламя в столбе и свет огня;
 * - Взмах: полоса ветра по траектории рывка.
 * - Ураган (ульта, фаза 5): весь замах (ult.cast до releaseTick) штрихи ветра и пыль кружат и стягиваются к магу по
 *   спирали с круга 10 м (≤ 80 частиц/с), у чужого — растущее свечение вихря без света; на выпуске (всплеск
 *   hurricaneBlast) по кругу уходит кольцо свечения с 1 до 10 м за 0,25 с.
 * Свой меш один — InstancedMesh лент (+1 вызов); частицы — через общий пул (emit), свечение — через общий список.
 * Ураган новых мешей не добавляет (+0 вызовов).
 */

/** Звеньев в ленте, длина звена, м (готовая и в парении — длиннее, развевается). */
export const RIBBON_SEG = 5;
const SEG_M = 0.15;
const SEG_READY_M = 0.18;
const RIBBON_W = 0.11;
const RIBBON_T = 0.025;
/** Лент на мага и магов с лентами (как MAX_MAGES фигур). */
const MAX_RIBBON_MAGES = 6;
const MAX_SEGS = MAX_RIBBON_MAGES * 2 * RIBBON_SEG;

export type RibbonState = "spent" | "ready" | "glide";
/** Ленты мага: 0 — правая, 1 — левая. */
const RIBBONS: readonly (0 | 1)[] = [0, 1];
/** Высоты свечения столба Смерча над центром, м. */
const CORE_GLOW_H: readonly number[] = [1, 2.6];

/** Точка i цепочки out: прежний объект переписывается, новый — только если его ещё нет. */
function setPoint(out: Vec3[], i: number, x: number, y: number, z: number): void {
  const p = out[i];
  if (p) {
    p.x = x;
    p.y = y;
    p.z = z;
  } else out[i] = { x, y, z };
}

/** Готова ли лента side (0 — правая, 1 — левая): по заряду Взмаха на ленту. */
export function ribbonReady(u: Unit, ribbon: 0 | 1): boolean {
  return (u.mage?.charges.e ?? 0) > ribbon;
}

/**
 * Точки ленты в мире: от плеча за спиной вниз-назад. side +1 — правая, −1 — левая; t — часы кадра, с.
 * Потраченная висит, готовая развевается назад, в парении ленты расходятся в стороны и трепещут быстро.
 * out — куда писать (покадрово один и тот же массив и те же точки, без новых объектов); по умолчанию новый.
 */
export function ribbonChain(pos: Vec3, yaw: number, side: 1 | -1, state: RibbonState, t: number, out: Vec3[] = []): Vec3[] {
  const f = forwardXZ(yaw);
  const r = rightXZ(yaw);
  const bx = -f.x;
  const bz = -f.z;
  let px = pos.x + bx * 0.19 + r.x * side * 0.13;
  let py = pos.y + 1.5;
  let pz = pos.z + bz * 0.19 + r.z * side * 0.13;
  setPoint(out, 0, px, py, pz);
  const len = state === "spent" ? SEG_M : SEG_READY_M;
  for (let i = 0; i < RIBBON_SEG; i++) {
    let b: number;
    let d: number;
    let s: number;
    if (state === "spent") {
      b = 0.3;
      d = -0.95;
      s = 0.05 * side + 0.06 * Math.sin(t * 2.2 + i * 0.6 + side);
    } else if (state === "ready") {
      b = 0.8;
      d = -0.5 + 0.22 * Math.sin(t * 7 + i * 0.9 + side * 1.3);
      s = 0.12 * side + 0.12 * Math.sin(t * 5 + i * 0.8);
    } else {
      b = 0.7;
      d = 0.05 + 0.3 * Math.sin(t * 13 + i * 1.1 + side);
      s = 0.65 * side + 0.15 * Math.sin(t * 11 + i);
    }
    const n = Math.hypot(b, d, s) || 1;
    const k = len / n;
    px += (bx * b + r.x * s) * k;
    py += d * k;
    pz += (bz * b + r.z * s) * k;
    setPoint(out, i + 1, px, py, pz);
  }
  out.length = RIBBON_SEG + 1;
  return out;
}

const spec = (kind: Kind, pos: Vec3, vel: Vec3, life: number, size0: number, size1: number, rng: Rng): ParticleSpec => {
  const k = KIND[kind];
  return { pos, vel, gravity: k.gravity, life, size0, size1, color: k.color(rng), alpha: k.alpha(rng) };
};

/** Темп частиц Смерча, в секунду: кольцо роста, столб ветра (≤ 60), пыль по краю, пламя огненного смерча. */
export const VORTEX_RATE = { grow: 90, column: 60, rim: 16, flame: 40 } as const;

/**
 * Частицы вихря за dt: n — сколько каждого вида родить (дробные остатки копит вызывающий). Рост (тик < armTick) —
 * кольцо на радиусе от 35 % до 100 % диска, крутится; дальше — столб по спирали у ядра, пыль по краю, пламя.
 */
export function vortexParticles(z: Zone, tick: number, nowS: number, n: { grow: number; column: number; rim: number; flame: number }, rng: Rng): ParticleSpec[] {
  if (z.shape.type !== "disc") return [];
  const c = z.shape.center;
  const R = z.shape.radius;
  const out: ParticleSpec[] = [];
  const swirl = (r: number, a: number, h: number, vt: number, vin: number, up: number): { pos: Vec3; vel: Vec3 } => {
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    return {
      pos: { x: c.x + cx * r, y: c.y + h, z: c.z + cz * r },
      // против часовой (вид сверху) и чуть к центру
      vel: { x: -cz * vt - cx * vin, y: up, z: cx * vt - cz * vin },
    };
  };
  if (tick < z.armTick) {
    const k = Math.min(1, Math.max(0, (tick - z.bornTick) / Math.max(1, z.armTick - z.bornTick)));
    for (let i = 0; i < n.grow; i++) {
      const r = R * (0.35 + 0.65 * k) * (0.85 + 0.15 * rng());
      const w = swirl(r, rng() * Math.PI * 2, 0.05, 6, 0.5, 0.3 + rng() * 0.5);
      out.push(spec(i % 3 === 0 ? "dust" : "wind", w.pos, w.vel, 0.3 + rng() * 0.15, 0.08 + rng() * 0.05, 0.3 + rng() * 0.2, rng));
    }
    return out;
  }
  const fire = z.kind === "fireTornado";
  for (let i = 0; i < n.column; i++) {
    const h = rng() * 3.6;
    const r = AIR.tornado.coreRadiusM * (0.3 + 0.7 * rng()) * (0.7 + h / 8);
    const w = swirl(r, nowS * 6 + rng() * Math.PI * 2, h, 5 + rng() * 2, 0, 2 + rng());
    out.push(spec("wind", w.pos, w.vel, 0.45 + rng() * 0.2, 0.06 + rng() * 0.05, 0.25 + rng() * 0.2, rng));
  }
  for (let i = 0; i < n.rim; i++) {
    const w = swirl(R * (0.85 + 0.15 * rng()), rng() * Math.PI * 2, 0.05, 3, 1.2, 0.2);
    out.push(spec("dust", w.pos, w.vel, 0.6 + rng() * 0.3, 0.15 + rng() * 0.1, 0.4 + rng() * 0.2, rng));
  }
  if (fire)
    for (let i = 0; i < n.flame; i++) {
      const h = rng() * 3;
      const w = swirl(AIR.tornado.coreRadiusM * (0.2 + 0.8 * rng()), nowS * 6 + rng() * Math.PI * 2, h, 4, 0, 2.5 + rng() * 1.5);
      out.push(spec(i % 4 === 0 ? "glow" : "flame", w.pos, w.vel, 0.35 + rng() * 0.2, 0.2 + rng() * 0.15, 0.45 + rng() * 0.25, rng));
    }
  return out;
}

const isVortex = (z: Zone): boolean => z.kind === "tornado" || z.kind === "fireTornado" || z.kind === "sandTornado";

/** Темп стяжки замаха Урагана, в секунду: штрихи ветра и пыль (вместе ≤ 80). */
export const GATHER_RATE = { wind: 56, dust: 20 } as const;
/** Стяжка начинается с круга Урагана (10 м) и к выпуску сходится до 1,5 м. */
const GATHER_END_M = 1.5;
/** Кольцо свечения выпуска: с 1 до 10 м за 0,25 с (как кольцо штрихов hurricaneBlast), гаснет к 0,3 с; точек на круге. */
export const BLAST_RING_S = 0.25;
const BLAST_GLOW_S = 0.3;
const BLAST_GLOWS = 6;

/**
 * Доля замаха Урагана мага u на дробном тике: 0 — каст, 1 — выпуск. null — замаха нет: нет каста Урагана, маг
 * мёртв или выпуск уже был (tick ≥ releaseTick).
 */
export function hurricaneWindup(u: Unit, tick: number): number | null {
  const c = u.mage?.ult.cast;
  if (!c || c.ability !== "hurricane" || !u.alive || tick >= c.releaseTick) return null;
  return Math.min(1, Math.max(0, (tick - c.startTick) / Math.max(1, c.releaseTick - c.startTick)));
}

/**
 * Частицы стяжки за кадр (n — сколько каждого вида, дробные остатки копит вызывающий): на круге вокруг ног мага c,
 * радиус сходится с 10 м к 1,5 м по доле замаха k. Скорость — по касательной против часовой (вид сверху) и к магу,
 * к выпуску быстрее: кольцо крутится и стягивается. Штрихи — на высоте 0,3–2,5 м, пыль — по полу. out — куда писать.
 */
export function hurricaneGather(c: Vec3, k: number, n: { wind: number; dust: number }, rng: Rng, out: ParticleSpec[] = []): ParticleSpec[] {
  const R = AIR.hurricane.radiusM;
  const base = R - (R - GATHER_END_M) * Math.min(1, Math.max(0, k));
  const vt = 6 + 4 * k;
  const vin = 7 + 5 * k;
  const total = n.wind + n.dust;
  for (let i = 0; i < total; i++) {
    const dust = i >= n.wind;
    const a = rng() * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const r = base * (0.85 + 0.3 * rng());
    const p = spawn(dust ? AIR_STREAM.gatherDust : AIR_STREAM.gatherWind, { x: c.x + cx * r, y: c.y + (dust ? 0.05 : 0.3 + 2.2 * rng()), z: c.z + cz * r }, UP, rng);
    p.vel = { x: -cz * vt - cx * vin, y: dust ? 0.2 : 0.3 * rng(), z: cx * vt - cz * vin };
    out.push(p);
  }
  return out;
}

export const createAirVfx: ElementVfxFactory = (): ElementVfx => {
  const geom = new BoxGeometry(1, 1, 1);
  const inks = new InstancedBufferAttribute(new Float32Array(MAX_SEGS), 1);
  inks.setUsage(DynamicDrawUsage);
  geom.setAttribute("aInk", inks);
  const ribbons = new InstancedMesh<BoxGeometry, ShaderMaterial>(geom, createInkMaterial(INK.enemy, undefined, { instanceInk: true }), MAX_SEGS);
  ribbons.name = "air-ribbons";
  ribbons.frustumCulled = false;
  ribbons.instanceMatrix.setUsage(DynamicDrawUsage);
  ribbons.count = 0;
  ribbons.visible = false;

  const mat = new Matrix4();
  const ax = new Vector3();
  const ay = new Vector3();
  const az = new Vector3();
  /** Дробные остатки темпа частиц по вихрю. */
  const acc = new Map<number, { grow: number; column: number; rim: number; flame: number }>();
  /** Где был маг во Взмахе на прошлом кадре и сколько пути не покрыто частицами. */
  const wake = new Map<UnitId, { last: Vec3; acc: number }>();
  const glideAcc = new Map<UnitId, number>();
  const rng: Rng = Math.random;
  // покадровые контейнеры — одни на эффектник: кадр их очищает, а не создаёт
  const chainBuf: Vec3[] = [];
  const gliders = new Set<UnitId>();
  const liveZones = new Set<number>();
  const liveWakes = new Set<UnitId>();
  const due = { grow: 0, column: 0, rim: 0, flame: 0 };
  const wakeOut: ParticleSpec[] = [];
  /** Дробные остатки темпа стяжки Урагана по магу; маги, у которых замах идёт в этом кадре. */
  const gatherAcc = new Map<UnitId, { wind: number; dust: number }>();
  const liveGathers = new Set<UnitId>();
  const gatherDue = { wind: 0, dust: 0 };
  const gatherOut: ParticleSpec[] = [];
  /** Выпуски Урагана (центр кольца и часы рождения) — по всплеску hurricaneBlast; не больше четырёх разом. */
  const blasts: { x: number; y: number; z: number; bornS: number }[] = [];

  function drawHurricanes(f: ElementVfxFrame): void {
    liveGathers.clear();
    for (const it of f.units) {
      const k = hurricaneWindup(it.u, f.tick);
      if (k === null) continue;
      liveGathers.add(it.id);
      let a = gatherAcc.get(it.id);
      if (!a) {
        a = { wind: 0, dust: 0 };
        gatherAcc.set(it.id, a);
      }
      a.wind += f.dt * GATHER_RATE.wind;
      a.dust += f.dt * GATHER_RATE.dust;
      gatherDue.wind = Math.floor(a.wind);
      gatherDue.dust = Math.floor(a.dust);
      a.wind -= gatherDue.wind;
      a.dust -= gatherDue.dust;
      gatherOut.length = 0;
      hurricaneGather(it.pos, k, gatherDue, rng, gatherOut);
      // emit сразу копирует частицы в пул: массив можно переиспользовать
      if (gatherOut.length > 0) f.emit(gatherOut);
      // чужой Ураган копит вихрь — свечение растёт к выпуску; своё свечение у камеры залило бы кадр
      if (it.id !== f.localId)
        f.glow({ pos: { x: it.pos.x, y: it.pos.y + 1.1, z: it.pos.z }, color: FX_COLOR.air, halo: 0.6 + 1.6 * k, light: 0, intensity: 0.25 + 0.5 * k, core: 0.1 }, 2);
    }
    for (const id of gatherAcc.keys()) if (!liveGathers.has(id)) gatherAcc.delete(id);
    // кольцо выпуска: точки свечения по кругу уходят с 1 до 10 м за 0,25 с (ease-out, как штрихи с сопротивлением)
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i]!;
      const age = f.nowS - b.bornS;
      if (age >= BLAST_GLOW_S || age < -0.5) {
        blasts.splice(i, 1);
        continue;
      }
      const u = Math.min(1, Math.max(0, age / BLAST_RING_S));
      const r = 1 + (AIR.hurricane.radiusM - 1) * (1 - (1 - u) ** 2);
      const fade = 1 - Math.max(0, age) / BLAST_GLOW_S;
      for (let j = 0; j < BLAST_GLOWS; j++) {
        const phi = (j / BLAST_GLOWS) * Math.PI * 2 + b.bornS;
        f.glow({ pos: { x: b.x + Math.cos(phi) * r, y: b.y, z: b.z + Math.sin(phi) * r }, color: FX_COLOR.air, halo: 1.4, light: 0, intensity: 0.7 * fade, core: 0.1 }, 2);
      }
    }
  }

  function drawRibbons(f: ElementVfxFrame): void {
    let n = 0;
    gliders.clear();
    for (const m of f.mages) {
      if (m.u.mage?.flight.gliding) gliders.add(m.id);
      if (m.u.mage?.element !== "air" || !m.u.alive || n + 2 * RIBBON_SEG > MAX_SEGS) continue;
      // мёртвый маг остаётся с gliding = true до возрождения, без события glide off — парение только у живого
      const gliding = m.u.mage.flight.gliding && m.u.alive;
      const r = rightXZ(m.pose.yaw);
      for (const ribbon of RIBBONS) {
        const ready = ribbonReady(m.u, ribbon);
        const side = ribbon === 0 ? 1 : -1;
        const chain = ribbonChain(m.pose.pos, m.pose.yaw, side, gliding ? "glide" : ready ? "ready" : "spent", f.nowS + m.id * 0.37, chainBuf);
        for (let i = 0; i < RIBBON_SEG; i++) {
          const a = chain[i]!;
          const b = chain[i + 1]!;
          ay.set(b.x - a.x, b.y - a.y, b.z - a.z);
          const len = ay.length() || 1e-3;
          ay.divideScalar(len);
          // ширина — поперёк звена, по правой руке мага
          ax.set(r.x, 0, r.z).addScaledVector(ay, -(r.x * ay.x + r.z * ay.z));
          if (ax.lengthSq() < 1e-6) ax.set(-ay.z, 0, ay.x);
          ax.normalize();
          az.crossVectors(ax, ay);
          mat.makeBasis(ax.multiplyScalar(RIBBON_W), ay.multiplyScalar(len), az.multiplyScalar(RIBBON_T));
          mat.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
          ribbons.setMatrixAt(n, mat);
          inks.setX(n, ready ? INK.halo : INK.enemy);
          n++;
        }
        // точки цепочки перепишет следующая лента — свечению своя копия
        const g = chain[3]!;
        if (ready) f.glow({ pos: { x: g.x, y: g.y, z: g.z }, color: FX_COLOR.air, halo: 0.32, light: 0, intensity: 0.65, core: 0.15 }, 1);
        // парящего видно издалека: с концов лент срываются штрихи ветра
        if (gliding) {
          const k = (glideAcc.get(m.id) ?? 0) + f.dt * 8;
          const c = Math.floor(k);
          glideAcc.set(m.id, k - c);
          const tip = chain[RIBBON_SEG]!;
          for (let i = 0; i < c; i++) f.emit([spec("wind", { ...tip }, { x: (rng() - 0.5) * 0.6, y: 0.4, z: (rng() - 0.5) * 0.6 }, 0.4, 0.06, 0.25, rng)]);
        }
      }
    }
    for (const id of glideAcc.keys()) if (!gliders.has(id)) glideAcc.delete(id);
    ribbons.count = n;
    ribbons.visible = n > 0;
    if (n > 0) {
      ribbons.instanceMatrix.needsUpdate = true;
      inks.needsUpdate = true;
    }
  }

  function drawVortices(f: ElementVfxFrame): void {
    liveZones.clear();
    for (const z of f.cur.zones) {
      if (!isVortex(z) || z.shape.type !== "disc") continue;
      liveZones.add(z.id);
      let a = acc.get(z.id);
      if (!a) {
        a = { grow: 0, column: 0, rim: 0, flame: 0 };
        acc.set(z.id, a);
      }
      a.grow += f.dt * VORTEX_RATE.grow;
      a.column += f.dt * VORTEX_RATE.column;
      a.rim += f.dt * VORTEX_RATE.rim;
      a.flame += f.dt * VORTEX_RATE.flame;
      due.grow = Math.floor(a.grow);
      due.column = Math.floor(a.column);
      due.rim = Math.floor(a.rim);
      due.flame = Math.floor(a.flame);
      a.grow -= due.grow;
      a.column -= due.column;
      a.rim -= due.rim;
      a.flame -= due.flame;
      const specs = vortexParticles(z, f.tick, f.nowS, due, rng);
      if (specs.length > 0) f.emit(specs);
      if (f.tick < z.armTick) continue;
      // столб ядра: свечение без света; огненный — свет огня
      const c = z.shape.center;
      const fire = z.kind === "fireTornado";
      for (const h of CORE_GLOW_H)
        f.glow(
          {
            pos: { x: c.x, y: c.y + h, z: c.z },
            color: fire ? FX_COLOR.fire : FX_COLOR.air,
            halo: 1.3,
            light: fire && h === 1 ? 5 : 0,
            intensity: (fire ? 0.85 : 0.45) * (0.9 + 0.1 * Math.sin(f.nowS * 9 + h)),
            core: fire ? 0.3 : 0.1,
          },
          fire ? 2.5 : 1.5,
        );
    }
    for (const id of acc.keys()) if (!liveZones.has(id)) acc.delete(id);
  }

  function drawWakes(f: ElementVfxFrame): void {
    liveWakes.clear();
    for (const it of f.units) {
      const d = it.u.mage?.dash;
      if (!d || d.ability !== "swoop") continue;
      liveWakes.add(it.id);
      const w = wake.get(it.id);
      const p = it.pos;
      if (!w) {
        wake.set(it.id, { last: { x: p.x, y: p.y, z: p.z }, acc: 0 });
        continue;
      }
      const dx = p.x - w.last.x;
      const dz = p.z - w.last.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0 && dist < 6) {
        w.acc += dist / 0.2;
        const n = Math.min(24, Math.floor(w.acc));
        w.acc -= n;
        const out = wakeOut;
        out.length = 0;
        for (let i = 0; i < n; i++) {
          const t = rng();
          out.push(
            spec(
              "wind",
              { x: w.last.x + dx * t + (rng() - 0.5) * 0.5, y: w.last.y + 0.3 + rng() * 1.3, z: w.last.z + dz * t + (rng() - 0.5) * 0.5 },
              { x: (-d.dirX * 1.5) + (rng() - 0.5) * 0.4, y: 0.1, z: (-d.dirZ * 1.5) + (rng() - 0.5) * 0.4 },
              0.4 + rng() * 0.2,
              0.08,
              0.35,
              rng,
            ),
          );
        }
        // emit сразу копирует частицы в пул: массив можно переиспользовать
        if (out.length > 0) f.emit(out);
      }
      w.last.x = p.x;
      w.last.y = p.y;
      w.last.z = p.z;
    }
    for (const id of wake.keys()) if (!liveWakes.has(id)) wake.delete(id);
  }

  return {
    world: ribbons,
    light: null,
    apply(e, nowS) {
      // выпуск Урагана: кольцо свечения из центра всплеска (штрихи и пыль даёт общий пул по пресету)
      if (e.kind !== "burst" || e.preset !== "hurricaneBlast") return;
      blasts.push({ x: e.pos.x, y: e.pos.y, z: e.pos.z, bornS: nowS });
      if (blasts.length > 4) blasts.shift();
    },
    sync(f) {
      drawRibbons(f);
      drawVortices(f);
      drawWakes(f);
      drawHurricanes(f);
    },
    dispose() {
      geom.dispose();
      ribbons.material.dispose();
      ribbons.dispose();
      acc.clear();
      wake.clear();
      glideAcc.clear();
      gatherAcc.clear();
      blasts.length = 0;
    },
  };
};
