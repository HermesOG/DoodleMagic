import { overlaps } from "../aabb";
import { bodyBox } from "../body";
import { DEFAULT_MOVE } from "../player";
import type { AABB, Body, Vec3 } from "../types";
import { groundBelow } from "../raycast";
import { OVERLAP_EPS, isFree } from "../world";
import { applyHit, applyStatus } from "./combat";
import { BOG, EARTH, FIRE, LIMITS, RAMPART, STATUS, WATER, ticks } from "./defs";
import { NO_HOOKS, type SimHooks } from "./hooks";
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
const BOG_MIN_LIFE_TICKS = ticks(BOG.minLifeS); // 120
const PILLAR_SPEC = Object.freeze({ growTicks: ticks(P.growS), solidTicks: ticks(P.solidS), lifeTicks: ticks(P.lifeS), hp: P.hp }); // 6, 12, 240, 200

function zoneEvent(t: TickCtx, z: Zone, phase: "telegraph" | "arm" | "end"): void {
  t.ev.push({ type: "zone", zone: z.id, kind: z.kind, owner: z.owner, phase });
}

/** Снять зону раньше срока (вытеснение, реакция): событие zone/end. Зоны уже нет в списке — ничего. */
export function endZone(s: MatchState, t: TickCtx, z: Zone): void {
  const k = s.zones.indexOf(z);
  if (k < 0) return;
  s.zones.splice(k, 1);
  zoneEvent(t, z, "end");
}

/** Пар живёт вне лимитов зон: у него своё ограничение на арену (steam.ts). */
const limited = (q: Zone): boolean => q.kind !== "steam";

/**
 * Зона переходит к новому хозяину (реакция «Огненный вал»): отметки повторов старого и нового хозяина сброшены (один
 * стал целью, другой — хозяином). Всего зон не прибавилось; у нового хозяина их теперь больше LIMITS.zonesPerMage —
 * уходят его самые старые прочие (zone/end).
 */
export function adoptZone(s: MatchState, t: TickCtx, z: Zone, owner: number): void {
  const was = z.owner;
  z.owner = owner;
  z.rehit = z.rehit.filter((r) => r.unit !== was && r.unit !== owner);
  if (!limited(z)) return;
  let own = 0;
  for (const q of s.zones) if (q.owner === owner && limited(q)) own++;
  while (own > LIMITS.zonesPerMage) {
    endZone(s, t, s.zones.find((q) => q !== z && q.owner === owner && limited(q))!);
    own--;
  }
}

/**
 * Новая зона. Сначала пределы GDD 7.3–7.4 (пар в них не входит и их не трогает): у владельца уже LIMITS.zonesPerMage —
 * уходит его самая старая; всего LIMITS.zonesTotal — самая старая вообще (обе — событием zone/end).
 * Событие zone/telegraph. Возвращает id.
 */
export function spawnZone(s: MatchState, t: TickCtx, z: NewZone): number {
  if (z.kind !== "steam") {
    let own = 0;
    for (const q of s.zones) if (q.owner === z.owner && limited(q)) own++;
    while (own >= LIMITS.zonesPerMage) {
      endZone(s, t, s.zones.find((q) => q.owner === z.owner && limited(q))!);
      own--;
    }
    let total = 0;
    for (const q of s.zones) if (limited(q)) total++;
    while (total >= LIMITS.zonesTotal) {
      endZone(s, t, s.zones.find(limited)!);
      total--;
    }
  }
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

/**
 * Ход «Огненного вала» на тике: бокс стены сдвигается на drift, пока now < untilTick. Встаёт (drift снят) у камня —
 * сдвинутый бокс без нижних RAMPART.liftM задел бы статику или рельеф (Стена огня и пар не мешают), — и там, где под
 * серединой нет опоры не глубже RAMPART.probeDownM. Доезд — тоже конец хода; срок стены не меняется.
 */
function driveWall(t: TickCtx, z: Zone): void {
  const d = z.drift;
  if (!d || z.shape.type !== "box") return;
  if (t.now >= d.untilTick) {
    delete z.drift;
    return;
  }
  const b = z.shape.box;
  const min = { x: b.min.x + d.x, y: b.min.y, z: b.min.z + d.z };
  const max = { x: b.max.x + d.x, y: b.max.y, z: b.max.z + d.z };
  const probe = { min: { x: min.x, y: min.y + RAMPART.liftM, z: min.z }, max };
  const mid = { x: (min.x + max.x) / 2, y: min.y + RAMPART.liftM, z: (min.z + max.z) / 2 };
  if (!isFree(t.world, probe) || groundBelow(t.world, mid, RAMPART.liftM + RAMPART.probeDownM) === null) {
    delete z.drift;
    return;
  }
  z.shape.box = { min, max };
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
  makeBog(s, t, z);
}

/**
 * «Топь» (GDD 4.6): удар землетрясения по взведённому Роднику — их диски пересекаются по XZ, центры по высоте
 * не дальше EARTH.earthquake.heightM. Родник уходит (zone/end), на его месте — зона bog хозяина землетрясения (его
 * эффект пришёл вторым): тот же диск, взведена сразу, живёт остаток Родника, но не меньше 2 с. Лимиты зон — как
 * у новой зоны (spawnZone): итог по арене не растёт. Событие reaction {kind: "bog"}.
 */
function makeBog(s: MatchState, t: TickCtx, quake: Zone): void {
  if (quake.shape.type !== "disc") return;
  const qc = quake.shape.center;
  const qr = quake.shape.radius;
  const now = t.now;
  for (const z of s.zones.filter((q) => q.kind === "spring" && now >= q.armTick && q.shape.type === "disc")) {
    if (z.shape.type !== "disc" || !s.zones.includes(z)) continue;
    const c = z.shape.center;
    const dx = c.x - qc.x;
    const dz = c.z - qc.z;
    if (Math.sqrt(dx * dx + dz * dz) >= qr + z.shape.radius || Math.abs(c.y - qc.y) > Q.heightM) continue;
    const endTick = Math.max(z.endTick, now + BOG_MIN_LIFE_TICKS);
    const shape: ZoneShape = { type: "disc", center: { x: c.x, y: c.y, z: c.z }, radius: z.shape.radius };
    endZone(s, t, z);
    const id = spawnZone(s, t, { owner: quake.owner, kind: "bog", ability: quake.ability, shape, bornTick: now, armTick: now, endTick });
    t.ev.push({ type: "reaction", kind: "bog", owner: quake.owner, zone: id, pos: { x: c.x, y: c.y, z: c.z } });
  }
}

/**
 * Шаг Топи: живые враги хозяина в диске (как у Родника: по XZ до радиуса, по высоте до 1,5 м) каждый тик Мокрые
 * и замедлены до 0,6 на 2 с (пределы CC: −40 % и 2 с на применение; внутри — заново). Хозяина не трогает, не лечит.
 */
function stepBog(s: MatchState, t: TickCtx, z: Zone): void {
  for (const u of s.units) {
    if (!u.alive || u.id === z.owner || !zoneTouches(z.shape, u)) continue;
    applyStatus(s, t, u.id, { source: z.owner, wetS: WATER.passive.wetS, slow: { mul: BOG.slowMul, s: BOG.slowS } });
  }
}

/**
 * Шаг зон на тике t.now (по копии списка): зона, снятая раньше в этом шаге (вытеснили, поглотила реакция), пропускается;
 * на endTick зона исчезает (zone/end); на armTick — zone/arm. С armTick зона вида, у которого есть хук стихии
 * (hooks.zones), шагает им; иначе стена огня и след бьют касанием, а столб и землетрясение бьют один раз ровно
 * на armTick. Пар без хука ничего не делает: он только закрывает обзор (buildTickWorld).
 */
export function stepZones(s: MatchState, t: TickCtx, hooks: SimHooks = NO_HOOKS): void {
  const now = t.now;
  for (const z of [...s.zones]) {
    if (!s.zones.includes(z)) continue;
    if (now >= z.endTick) {
      const k = s.zones.indexOf(z);
      if (k >= 0) s.zones.splice(k, 1);
      zoneEvent(t, z, "end");
      continue;
    }
    if (now === z.armTick) zoneEvent(t, z, "arm");
    if (now < z.armTick) continue;
    const step = hooks.zones[z.kind];
    if (step) step(s, t, z);
    else if (z.kind === "fireWall") {
      driveWall(t, z);
      contact(s, t, z, FIRE.fireWall.contactDamage, FIRE_WALL_REHIT_TICKS, true, false);
    }
    else if (z.kind === "fireTrail") contact(s, t, z, TRAIL_PULSE_DAMAGE, TRAIL_PULSE_TICKS, false, true);
    else if (now === z.armTick && z.kind === "pillar") pillarStrike(s, t, z);
    else if (now === z.armTick && z.kind === "quake") quakeStrike(s, t, z);
    else if (z.kind === "bog") stepBog(s, t, z);
  }
}
