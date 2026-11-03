import { centerOf } from "../aabb";
import { bodyBox } from "../body";
import { raycast } from "../raycast";
import { TICK_DT, type AABB, type Vec3 } from "../types";
import { add, clamp, length, scale, sub } from "../vec";
import { forwardXZ } from "../player";
import { applyHit } from "./combat";
import { AIR, EARTH, FIRE, LIMITS, PROJECTILE_SOURCE, WATER, ticks, type ProjectileDef } from "./defs";
import { terrainAt } from "./dynamic";
import { NO_HOOKS, type SimHooks } from "./hooks";
import { horizontalDir } from "./kit";
import { unitById } from "./state";
import { damageTerrain } from "./terrain";
import { NOBODY, type MatchState, type Projectile, type ProjectileKind, type TickCtx, type Unit, type UnitId } from "./types";

/**
 * Снаряды: полёт с гравитацией, прохождение отрезка за тик (без туннелирования), попадания, взрыв огненного шара и
 * впитывание диском Отражения (Р8 фазы 4). Попадание вида, у которого есть хук стихии, разбирает хук.
 * Функции меняют переданное состояние на месте (stepMatch отдаёт им свою копию) и пишут события в t.ev.
 */

/** Прежнее имя вида снаряда. */
export type ProjectileAbility = ProjectileKind;

const DEFS: Readonly<Record<ProjectileKind, ProjectileDef>> = Object.freeze({
  fireFists: FIRE.fireFists.projectile,
  fireball: FIRE.fireball.projectile,
  stoneShot: EARTH.stoneShot.projectile,
  airSickle: AIR.airSickle.projectile,
  waterGrab: WATER.waterGrab.projectile,
  waterAnswer: WATER.waterWard.answer.projectile,
});
export const projectileDef = (a: ProjectileKind): ProjectileDef => DEFS[a];

/** Урон прямого попадания (power нового снаряда); у шара — в центре взрыва; у Ответа — нижний предел, его power — впитанное. */
export const PROJECTILE_DAMAGE: Readonly<Record<ProjectileKind, number>> = Object.freeze({
  fireFists: FIRE.fireFists.damage,
  fireball: FIRE.fireball.damageCenter,
  stoneShot: EARTH.stoneShot.damage,
  airSickle: AIR.airSickle.damage,
  waterGrab: WATER.waterGrab.damage,
  waterAnswer: WATER.waterWard.answer.minDamage,
});

/**
 * «Сок» ЛКМ вбок, м (Р3): кулаки — 0,3 м × min(1, интервал / tempoRefS) = 0,12 м; камень — 0,3 м; серп —
 * 0,3 × min(1, (1/3) / 0,5) = 0,2 м. Шар толкает взрывом (explodeFireball), а не снарядом; жгут и Ответ не толкают.
 */
export const PROJECTILE_JUICE_M: Readonly<Record<ProjectileKind, number>> = Object.freeze({
  fireFists: FIRE.fireFists.knockback.distM * Math.min(1, 1 / FIRE.fireFists.ratePerS / FIRE.fireFists.tempoRefS),
  fireball: 0,
  stoneShot: EARTH.stoneShot.knockback.distM,
  airSickle: AIR.airSickle.knockback.distM * Math.min(1, 1 / AIR.airSickle.ratePerS / AIR.airSickle.tempoRefS),
  waterGrab: 0,
  waterAnswer: 0,
});

/**
 * Встречает ли диск Отражения снаряд со скоростью vel (Р8): диск стоит (now < ward.endTick), и снаряд летит в Воду
 * из передней полусферы — его горизонтальная скорость против взгляда (vel · forwardXZ(yaw) < 0).
 */
export function wardFaces(u: Unit, vel: { x: number; z: number }, now: number): boolean {
  const w = u.mage?.ward;
  if (!w || now >= w.endTick) return false;
  const f = forwardXZ(u.move.yaw);
  return vel.x * f.x + vel.z * f.z < 0;
}

/** Взрыв шара — чуть перед гранью, в которую он врезался, чтобы лучи видимости не начинались в ней. */
const EXPLODE_OFFSET_M = 0.05;
/** Луч видимости взрыва целится не ниже этого над подошвой: иначе его задел бы пол. */
const SPLASH_FLOOR_CLEARANCE_M = 0.2;
/** Луч видимости короче на столько, чтобы не задеть рельеф, в который тело упёрлось. */
const SPLASH_RAY_SHORTEN_M = 1e-3;

/**
 * Новый снаряд из pos по единичному dir с уроном power (по умолчанию — по таблице вида). Пределы GDD 7.3–7.4:
 * у владельца уже LIMITS.projectilesPerMage — уходит его самый старый; всего LIMITS.projectilesTotal — самый старый
 * вообще. Событие release пишет кит. Возвращает id. Снаряд, рождённый до stepProjectiles, шагает уже в этом тике.
 */
export function spawnProjectile(s: MatchState, t: TickCtx, owner: UnitId, ability: ProjectileKind, pos: Vec3, dir: Vec3, power = PROJECTILE_DAMAGE[ability]): number {
  let own = 0;
  for (const p of s.projectiles) if (p.owner === owner) own++;
  while (own >= LIMITS.projectilesPerMage) {
    s.projectiles.splice(s.projectiles.findIndex((p) => p.owner === owner), 1);
    own--;
  }
  while (s.projectiles.length >= LIMITS.projectilesTotal) s.projectiles.shift();
  const def = DEFS[ability];
  const id = s.nextId++;
  s.projectiles.push({
    id, owner, ability,
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: dir.x * def.speed, y: dir.y * def.speed, z: dir.z * def.speed },
    bornTick: t.now,
    endTick: t.now + ticks(def.rangeM / def.speed),
    power,
  });
  return id;
}

/** Первое, во что упёрся отрезок. unit — тело (NOBODY — мир); terrain — id рельефа или null. */
export interface SweepHit {
  dist: number;
  unit: UnitId;
  terrain: number | null;
  point: Vec3;
  normal: Vec3;
}

/** Вход отрезка a → a + d в бокс: доля пути t ∈ [0, 1] и нормаль грани входа (нулевая, если a внутри), или null. */
function segmentBox(a: Vec3, d: Vec3, b: AABB): { t: number; normal: Vec3 } | null {
  let t0 = 0;
  let t1 = 1;
  let axis: "x" | "y" | "z" | null = null;
  let sign = 0;
  for (const k of ["x", "y", "z"] as const) {
    const dk = d[k];
    if (dk === 0) {
      if (a[k] < b.min[k] || a[k] > b.max[k]) return null;
      continue;
    }
    // Ближняя грань — по направлению, а не сравнением: у плоского бокса near = far.
    const near = ((dk > 0 ? b.min[k] : b.max[k]) - a[k]) / dk;
    const far = ((dk > 0 ? b.max[k] : b.min[k]) - a[k]) / dk;
    if (near > t0) {
      t0 = near;
      axis = k;
      sign = dk > 0 ? -1 : 1;
    }
    if (far < t1) t1 = far;
    if (t0 > t1) return null;
  }
  const normal = { x: 0, y: 0, z: 0 };
  if (axis) normal[axis] = sign;
  return { t: t0, normal };
}

/**
 * Прохождение отрезка from → to: мир — точкой центра (луч "shot": стену огня и перила пролетает), тела живых
 * не-владельцев — отрезком против бокса тела, раздутого на radiusM (и ещё на pad(u) по XZ: диск Отражения).
 * Стена на том же расстоянии или ближе — бьёт стена; из тел на равном расстоянии — меньший id. Отрезок короче 1e-9 — промах.
 */
export function sweepSegment(s: MatchState, t: TickCtx, owner: UnitId, from: Vec3, to: Vec3, radiusM: number, pad?: (u: Unit) => number): SweepHit | null {
  const d = sub(to, from);
  const len = length(d);
  if (!(len >= 1e-9)) return null;
  const wall = raycast(t.world, from, scale(d, 1 / len), len, "shot");
  let best: SweepHit | null = wall && { dist: wall.dist, unit: NOBODY, terrain: terrainAt(t, wall.collider), point: wall.point, normal: wall.normal };
  const r = radiusM;
  for (const u of s.units) {
    if (!u.alive || u.id === owner) continue;
    const b = bodyBox(u.move.body);
    const rx = r + (pad ? pad(u) : 0);
    const hit = segmentBox(from, d, { min: { x: b.min.x - rx, y: b.min.y - r, z: b.min.z - rx }, max: { x: b.max.x + rx, y: b.max.y + r, z: b.max.z + rx } });
    if (hit && (!best || hit.t * len < best.dist)) best = { dist: hit.t * len, unit: u.id, terrain: null, point: add(from, scale(d, hit.t)), normal: hit.normal };
  }
  return best;
}

/**
 * Шаг снарядов в порядке массива. Гравитация по трапеции, как у тел; отрезок пути за тик проходится целиком.
 * Попадание в мага, чей диск Отражения встречает снаряд спереди (wardFaces; его тело для этого раздуто на 0,5 м по XZ):
 * снаряд впитан — исчезает без impact и взрыва, ward.absorbed += power, событие absorb.
 * Иначе попадание: событие impact (ability — способность вида, PROJECTILE_SOURCE), снаряд исчезает; дальше хук вида
 * из hooks.projectileHit, а без него — прежнее: шар взрывается, прочие бьют тело (power и «сок») или рельеф (power).
 * Мимо: снаряд летит дальше; после шага тика endTick − 1 исчезает, шар — взрывается на месте.
 */
export function stepProjectiles(s: MatchState, t: TickCtx, hooks: SimHooks = NO_HOOKS): void {
  const keep: Projectile[] = [];
  const now = t.now;
  for (const p of s.projectiles) {
    const def = DEFS[p.ability];
    const vy1 = p.vel.y - def.gravity * TICK_DT;
    const to = { x: p.pos.x + p.vel.x * TICK_DT, y: p.pos.y + ((p.vel.y + vy1) / 2) * TICK_DT, z: p.pos.z + p.vel.z * TICK_DT };
    const hit = sweepSegment(s, t, p.owner, p.pos, to, def.radiusM, (u) => (wardFaces(u, p.vel, now) ? WATER.waterWard.padM : 0));
    const dir = horizontalDir(p.vel);
    if (hit) {
      const pt = hit.point;
      const ward = hit.unit === NOBODY ? undefined : unitById(s, hit.unit);
      if (ward?.mage?.ward && wardFaces(ward, p.vel, now)) {
        const w = ward.mage.ward;
        w.absorbed += p.power;
        t.ev.push({ type: "absorb", unit: ward.id, projectile: p.id, kind: p.ability, owner: p.owner, amount: p.power, total: w.absorbed, pos: { x: pt.x, y: pt.y, z: pt.z } });
        continue;
      }
      const ability = PROJECTILE_SOURCE[p.ability];
      t.ev.push({
        type: "impact", ability, owner: p.owner, pos: { x: pt.x, y: pt.y, z: pt.z }, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
        target: hit.unit, terrain: hit.terrain ?? -1,
      });
      const own = hooks.projectileHit[p.ability];
      if (own) own(s, t, p, hit);
      else if (p.ability === "fireball") explodeFireball(s, t, p.owner, add(pt, scale(hit.normal, EXPLODE_OFFSET_M)), hit.unit, dir);
      else if (hit.unit !== NOBODY) {
        applyHit(s, t, { source: p.owner, target: hit.unit, ability, damage: p.power, pos: pt, dir, knock: { distM: PROJECTILE_JUICE_M[p.ability], upM: 0 } });
      } else if (hit.terrain !== null) damageTerrain(s, t, hit.terrain, p.power, pt);
      continue;
    }
    p.pos = to;
    p.vel.y = vy1;
    if (t.now + 1 >= p.endTick) {
      if (p.ability === "fireball") explodeFireball(s, t, p.owner, { x: to.x, y: to.y, z: to.z }, NOBODY, dir);
      continue;
    }
    keep.push(p);
  }
  s.projectiles = keep;
}

const closestOnBox = (b: AABB, p: Vec3): Vec3 => ({ x: clamp(p.x, b.min.x, b.max.x), y: clamp(p.y, b.min.y, b.max.y), z: clamp(p.z, b.min.z, b.max.z) });

/**
 * Взрыв огненного шара в pos (событие explosion, радиус 3 м). Живой не-владелец в радиусе получает урон и толчок
 * с линейным спадом f = 1 − (1 − край / центр) · d / R от 50 в центре до 20 по краю и Горение; d — до бокса тела,
 * у прямого попадания (direct) — 0. Кроме прямого попадания, взрыв не бьёт сквозь стену: нужен свободный луч "shot"
 * до ближайшей точки тела. Прямое попадание толкает по горизонтали полёта шара travelDir: цель уходит туда, куда
 * целились, даже если шар задел её краем. Остальных — от взрыва к центру тела, ровно над или под ним — по travelDir.
 * Рельеф в радиусе получает урон с тем же спадом.
 */
export function explodeFireball(s: MatchState, t: TickCtx, owner: UnitId, pos: Vec3, direct: UnitId, travelDir: { x: number; z: number }): void {
  const travel = travelDir.x !== 0 || travelDir.z !== 0;
  const fb = FIRE.fireball;
  const R = fb.radiusM;
  const falloff = (d: number) => 1 - ((1 - fb.damageEdge / fb.damageCenter) * d) / R;
  t.ev.push({ type: "explosion", ability: "fireball", owner, pos: { x: pos.x, y: pos.y, z: pos.z }, radius: R });
  for (const u of s.units) {
    if (!u.alive || u.id === owner) continue;
    const box = bodyBox(u.move.body);
    const q = closestOnBox(box, pos);
    let d = 0;
    if (u.id !== direct) {
      d = length(sub(q, pos));
      if (d > R) continue;
      const v = sub({ x: q.x, y: Math.max(q.y, box.min.y + SPLASH_FLOOR_CLEARANCE_M), z: q.z }, pos);
      const len = length(v);
      if (len > SPLASH_RAY_SHORTEN_M && raycast(t.world, pos, scale(v, 1 / len), len - SPLASH_RAY_SHORTEN_M, "shot")) continue;
    }
    const f = falloff(d);
    const c = centerOf(box);
    const away = horizontalDir({ x: c.x - pos.x, z: c.z - pos.z });
    const radial = away.x !== 0 || away.z !== 0;
    applyHit(s, t, {
      source: owner, target: u.id, ability: "fireball", damage: fb.damageCenter * f, pos: q,
      dir: (u.id === direct && travel) || !radial ? travelDir : away,
      knock: { distM: fb.knockback.distM * f, upM: fb.knockback.upM * f }, burn: true,
    });
  }
  for (const tr of [...s.terrain]) {
    const q = closestOnBox(tr.box, pos);
    const d = length(sub(q, pos));
    if (d <= R) damageTerrain(s, t, tr.id, fb.damageCenter * falloff(d), q);
  }
}
