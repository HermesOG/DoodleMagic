import { overlaps } from "../aabb";
import { bodyBox } from "../body";
import { DEFAULT_MOVE } from "../player";
import type { AABB, Body, Vec3 } from "../types";
import { OVERLAP_EPS } from "../world";
import { applyHit } from "./combat";
import { EARTH, FIRE, LIMITS, STATUS, ticks } from "./defs";
import { horizontalDir } from "./kit";
import { clonePlain, unitById } from "./state";
import { spawnTerrain } from "./terrain";
import type { MatchState, TickCtx, Unit, Zone, ZoneShape } from "./types";

/**
 * Зоны: стена огня и след рывка бьют касанием с повтором, столб и землетрясение — разово на armTick.
 * Функции меняют переданное состояние на месте (stepMatch отдаёт им свою копию) и пишут события в t.ev.
 */

export type NewZone = Omit<Zone, "id" | "rehit">;

/** Отрезок следа держит тела от 0,5 м ниже до 2 м выше своих концов. */
const SEGMENT_BELOW_M = 0.5;
const SEGMENT_ABOVE_M = 2;
/** Столб задевает тех, чьи ступни от 0,6 м ниже до 1 м выше его основания (Р9). */
const PILLAR_FEET_BELOW_M = 0.6;
const PILLAR_FEET_ABOVE_M = 1;
/** Подъём «под себя» — на высоту столба и ещё на столько: маг встаёт на вершину, а не упирается в неё. */
const SELF_LIFT_CLEARANCE_M = 0.3;

const FIRE_WALL_REHIT_TICKS = ticks(FIRE.fireWall.rehitS); // 60
const TRAIL_PULSE_TICKS = ticks(STATUS.burning.pulseS); // 30
const TRAIL_PULSE_DAMAGE = FIRE.jetDash.trailDps * STATUS.burning.pulseS; // 3
const P = EARTH.stonePillar;
const Q = EARTH.earthquake;
const SELF_LIFT_SPEED = Math.sqrt(2 * DEFAULT_MOVE.gravity * (P.selfLiftM + SELF_LIFT_CLEARANCE_M));
const PILLAR_SPEC = Object.freeze({ growTicks: ticks(P.growS), solidTicks: ticks(P.solidS), lifeTicks: ticks(P.lifeS), hp: P.hp }); // 6, 12, 240, 200

function zoneEvent(t: TickCtx, z: Zone, phase: "telegraph" | "arm" | "end"): void {
  t.ev.push({ type: "zone", zone: z.id, kind: z.kind, owner: z.owner, phase });
}

function evict(s: MatchState, t: TickCtx, z: Zone): void {
  s.zones.splice(s.zones.indexOf(z), 1);
  zoneEvent(t, z, "end");
}

/**
 * Новая зона. Сначала пределы GDD 7.3–7.4: у владельца уже LIMITS.zonesPerMage — уходит его самая старая;
 * всего LIMITS.zonesTotal — самая старая вообще (обе — событием zone/end). Событие zone/telegraph. Возвращает id.
 */
export function spawnZone(s: MatchState, t: TickCtx, z: NewZone): number {
  let own = 0;
  for (const q of s.zones) if (q.owner === z.owner) own++;
  while (own >= LIMITS.zonesPerMage) {
    evict(s, t, s.zones.find((q) => q.owner === z.owner)!);
    own--;
  }
  while (s.zones.length >= LIMITS.zonesTotal) evict(s, t, s.zones[0]!);
  const zone: Zone = {
    id: s.nextId++, owner: z.owner, kind: z.kind, ability: z.ability, shape: clonePlain(z.shape),
    bornTick: z.bornTick, armTick: z.armTick, endTick: z.endTick, rehit: [],
  };
  s.zones.push(zone);
  zoneEvent(t, zone, "telegraph");
  return zone.id;
}

/** Расстояние по XZ от точки до отрезка ab. */
function distXZToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
  const dx = p.x - (a.x + abx * k);
  const dz = p.z - (a.z + abz * k);
  return Math.sqrt(dx * dx + dz * dz);
}

/** XZ-расстояние от центра подошвы до центра диска. */
function discDist(b: Body, c: Vec3): number {
  const dx = b.pos.x - c.x;
  const dz = b.pos.z - c.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Касается ли зона тела. box — пересечение боксов; segment — по XZ от центра подошвы до отрезка ≤ halfW + halfW тела,
 * и тело по Y пересекает [min(a.y, b.y) − 0,5; max(a.y, b.y) + 2]; disc — по XZ до центра ≤ radius и разница высот
 * с центром ≤ EARTH.earthquake.heightM (диск — только у землетрясения, Р8).
 */
export function zoneTouches(shape: ZoneShape, u: Unit): boolean {
  const b = u.move.body;
  if (shape.type === "box") return overlaps(bodyBox(b), shape.box, OVERLAP_EPS);
  if (shape.type === "segment") {
    const lo = Math.min(shape.a.y, shape.b.y) - SEGMENT_BELOW_M;
    const hi = Math.max(shape.a.y, shape.b.y) + SEGMENT_ABOVE_M;
    if (b.pos.y > hi || b.pos.y + b.height < lo) return false;
    return distXZToSegment(b.pos, shape.a, shape.b) <= shape.halfW + b.halfW;
  }
  return discDist(b, shape.center) <= shape.radius && Math.abs(b.pos.y - shape.center.y) <= Q.heightM;
}

const bodyCenter = (b: Body): Vec3 => ({ x: b.pos.x, y: b.pos.y + b.height / 2, z: b.pos.z });

/**
 * Касание: живой не-владелец в зоне без записи rehit (или с истёкшей) получает удар; запись — на rehitTicks вперёд.
 * Урон по времени (dot, камеру не трясёт): у следа рывка — каждый импульс (alwaysDot), у стены огня — повтор после первого удара.
 */
function contact(s: MatchState, t: TickCtx, z: Zone, damage: number, rehitTicks: number, burn: boolean, alwaysDot: boolean): void {
  const now = t.now;
  for (const u of s.units) {
    if (!u.alive || u.id === z.owner || !zoneTouches(z.shape, u)) continue;
    const rec = z.rehit.find((r) => r.unit === u.id);
    if (rec && rec.tick > now) continue;
    applyHit(s, t, { source: z.owner, target: u.id, ability: z.ability, damage, pos: bodyCenter(u.move.body), dir: { x: 0, z: 0 }, burn, dot: alwaysDot || rec !== undefined });
    if (rec) rec.tick = now + rehitTicks;
    else z.rehit.push({ unit: u.id, tick: now + rehitTicks });
  }
}

/** Пересекает ли тело по XZ бокс, раздутый на pad. */
function overlapsXZ(b: Body, box: AABB, pad: number): boolean {
  return (
    b.pos.x - b.halfW < box.max.x + pad - OVERLAP_EPS &&
    b.pos.x + b.halfW > box.min.x - pad + OVERLAP_EPS &&
    b.pos.z - b.halfW < box.max.z + pad - OVERLAP_EPS &&
    b.pos.z + b.halfW > box.min.z - pad + OVERLAP_EPS
  );
}

/**
 * Удар столба (Р9): бокс зоны — будущий столб. Юниты со ступнями у его основания: владелец над следом взлетает
 * на вершину без урона; остальные над следом, раздутым на 0,4 м, получают 35 и подброс на 3,5 м от центра столба
 * (ровно в центре — от владельца). Затем растёт сам столб.
 */
function pillarStrike(s: MatchState, t: TickCtx, z: Zone): void {
  if (z.shape.type !== "box") return;
  const box = z.shape.box;
  const base = box.min.y;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const owner = unitById(s, z.owner);
  for (const u of s.units) {
    if (!u.alive) continue;
    const b = u.move.body;
    if (b.pos.y < base - PILLAR_FEET_BELOW_M || b.pos.y > base + PILLAR_FEET_ABOVE_M) continue;
    if (u.id === z.owner) {
      if (!overlapsXZ(b, box, 0)) continue;
      b.vel.y = Math.max(b.vel.y, SELF_LIFT_SPEED);
      u.move.onGround = false;
      u.move.coyote = 0;
      continue;
    }
    if (!overlapsXZ(b, box, P.hitPadM)) continue;
    let dx = b.pos.x - cx;
    let dz = b.pos.z - cz;
    if (Math.sqrt(dx * dx + dz * dz) < 1e-6 && owner) {
      dx = b.pos.x - owner.move.body.pos.x;
      dz = b.pos.z - owner.move.body.pos.z;
    }
    applyHit(s, t, {
      source: z.owner, target: u.id, ability: z.ability, damage: P.damage, pos: bodyCenter(b), dir: horizontalDir({ x: dx, z: dz }),
      knock: { distM: P.knockback.distM, upM: P.knockback.upM }, launch: true,
    });
  }
  spawnTerrain(s, t, z.owner, "pillar", clonePlain(box), PILLAR_SPEC);
}

/** Удар землетрясения: живые не-владельцы на полу в диске — 40, замедление, толчок наружу; в 3 м — обездвиживание. */
function quakeStrike(s: MatchState, t: TickCtx, z: Zone): void {
  if (z.shape.type !== "disc") return;
  const c = z.shape.center;
  for (const u of s.units) {
    if (!u.alive || u.id === z.owner || !u.move.onGround || !zoneTouches(z.shape, u)) continue;
    const b = u.move.body;
    const d = discDist(b, c);
    applyHit(s, t, {
      source: z.owner, target: u.id, ability: z.ability, damage: Q.damage, pos: bodyCenter(b), dir: horizontalDir({ x: b.pos.x - c.x, z: b.pos.z - c.z }),
      slow: { mul: Q.slowMul, s: Q.slowS }, rootS: d <= Q.rootRadiusM ? Q.rootS : undefined, knock: { distM: Q.knockback.distM, upM: Q.knockback.upM },
    });
  }
}

/**
 * Шаг зон на тике t.now (по копии списка): на endTick зона исчезает (zone/end); на armTick — zone/arm;
 * с armTick стена огня и след бьют касанием, а столб и землетрясение бьют один раз ровно на armTick.
 */
export function stepZones(s: MatchState, t: TickCtx): void {
  const now = t.now;
  for (const z of [...s.zones]) {
    if (now >= z.endTick) {
      const k = s.zones.indexOf(z);
      if (k >= 0) s.zones.splice(k, 1);
      zoneEvent(t, z, "end");
      continue;
    }
    if (now === z.armTick) zoneEvent(t, z, "arm");
    if (now < z.armTick) continue;
    if (z.kind === "fireWall") contact(s, t, z, FIRE.fireWall.contactDamage, FIRE_WALL_REHIT_TICKS, true, false);
    else if (z.kind === "fireTrail") contact(s, t, z, TRAIL_PULSE_DAMAGE, TRAIL_PULSE_TICKS, false, true);
    else if (now === z.armTick) (z.kind === "pillar" ? pillarStrike : quakeStrike)(s, t, z);
  }
}
