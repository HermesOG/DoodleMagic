import { aabb } from "../aabb";
import { forwardXZ, sanitizeInput } from "../player";
import { groundBelow } from "../raycast";
import type { Vec3 } from "../types";
import { aimGround } from "./aim";
import { applyHit } from "./combat";
import { EARTH, slotCooldownTicks, ticks } from "./defs";
import type { ElementSim, ZoneStep } from "./hooks";
import { castAim, castSlots, emitCast, horizontalDir, snappedWallBox, type Kit, type TryCast } from "./kit";
import { spawnProjectile } from "./projectiles";
import { spawnTerrain, type TerrainSpec } from "./terrain";
import type { Buttons, MatchInput, MatchState, RejectReason, Slot, TickCtx, Unit } from "./types";
import { startUlt } from "./ult";
import { spawnZone, zoneTouches } from "./zones";

/**
 * Кит Земли «Стойкость» (GDD 4.4). Перезарядки идут с принятого нажатия (Р14); замах камня не даёт стрелять ЛКМ, Q и C,
 * E работает всегда. «Корни»: Q и C — только стоя на полу (отбрасывание ×0,5 считает бой).
 * Нажатие, отклонённое перезарядкой или замахом, ждёт в буфере castSlots до 0,3 с: Q в замахе камня выходит сразу
 * после выпуска камня. X «Тектонический разлом» (Р7 фазы 5) — тоже только с пола; трещина и шипы — зона rift.
 */

const SS = EARTH.stoneShot;
const P = EARTH.stonePillar;
const W = EARTH.stoneWall;
const Q = EARTH.earthquake;

const STONE_WINDUP_TICKS = ticks(SS.windupS); // 12
const PILLAR_TELEGRAPH_TICKS = ticks(P.telegraphS); // 36
const QUAKE_TELEGRAPH_TICKS = ticks(Q.telegraphS); // 24
const TR = EARTH.tectonicRift;
const RIFT_TELEGRAPH_TICKS = ticks(TR.telegraphS); // 48
const SPIKES_TICKS = ticks(TR.spikesS); // 360
const SPIKES_REHIT_TICKS = ticks(TR.spikesRehitS); // 60
/** Цель ровно на линии разлома (по XZ ближе этого) толкает вправо от взгляда. */
const ON_LINE_M = 1e-6;
/** Опору под стеной ищем от точки на 0,6 м выше ступней мага и не глубже 3 м; нет опоры — основание на ступнях. */
const WALL_GROUND_PROBE_UP_M = 0.6;
const WALL_GROUND_DROP_M = 3;
const WALL_SPEC: Readonly<TerrainSpec> = Object.freeze({ growTicks: ticks(W.growS), solidTicks: ticks(W.solidS), lifeTicks: ticks(W.lifeS), hp: W.hp }); // 18, 12, 360, 250

/** Перезарядка слота или замах — причина отказа; null — слот свободен. */
function blocked(t: TickCtx, u: Unit, slot: Slot): RejectReason | null {
  const m = u.mage!;
  if (t.now < m.ready[slot]) return "cooldown";
  return m.windup ? "busy" : null;
}

/** «Корни»: Q и C только стоя на полу, затем перезарядка и замах; null — можно кастовать. */
const groundedAndFree = (t: TickCtx, u: Unit, slot: Slot): RejectReason | null => (u.move.onGround ? blocked(t, u, slot) : "notGrounded");

/**
 * ЛКМ: пока удержана (или нажатие ждёт в буфере) и слот готов — замах камня 0,2 с; снаряд выпускает tick.
 * Свой замах идёт на перезарядке ЛКМ, поэтому отказ ЛКМ — всегда «перезарядка», и castSlots его не шлёт.
 */
function stoneShot(_s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  const no = blocked(t, u, "primary");
  if (no) return no;
  m.ready.primary = t.now + slotCooldownTicks("earth", "primary");
  m.windup = { ability: "stoneShot", slot: "primary", releaseTick: t.now + STONE_WINDUP_TICKS };
  emitCast(t, u, "stoneShot", "primary", castAim(u, inp));
  return null;
}

/**
 * Q: трещины 0,6 с в точке под прицелом, затем удар и столб (их делает зона). Точка ближе 1,0 м к магу по XZ — столб
 * под ним самим (Р9, теперь 1,0 м = половина столба 0,6 + полтела 0,4): по центру мага, от его ступней, с подъёмом
 * на вершину. Дальше столб не задевает мага: обычный удар в точке.
 */
function stonePillar(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const no = groundedAndFree(t, u, "q");
  if (no) return no;
  const c = sanitizeInput(inp, u.move);
  const at = aimGround(s, t, u.id, c.yaw, c.pitch, P.rangeM);
  if (!at) return "noTarget";
  const pos = u.move.body.pos;
  const self = Math.hypot(at.x - pos.x, at.z - pos.z) < P.selfRadiusM;
  const cx = self ? pos.x : at.x;
  const cz = self ? pos.z : at.z;
  const base = self ? pos.y : at.y;
  const h = P.sizeM / 2;
  const box = aabb(cx - h, base, cz - h, cx + h, base + P.heightM, cz + h);
  const now = t.now;
  spawnZone(s, t, { owner: u.id, kind: "pillar", ability: "stonePillar", shape: { type: "box", box }, bornTick: now, armTick: now + PILLAR_TELEGRAPH_TICKS, endTick: now + PILLAR_TELEGRAPH_TICKS + 1 });
  u.mage!.ready.q = now + slotCooldownTicks("earth", "q");
  emitCast(t, u, "stonePillar", "q", castAim(u, inp));
  return null;
}

/** E: стена 2 м перед магом поперёк взгляда (Р6), основание — опора под ней. Можно и в воздухе, и во время замаха. */
function stoneWall(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const m = u.mage!;
  if (t.now < m.ready.e) return "cooldown";
  const yaw = sanitizeInput(inp, u.move).yaw;
  const f = forwardXZ(yaw);
  const pos = u.move.body.pos;
  const cx = pos.x + f.x * W.aheadM + 0;
  const cz = pos.z + f.z * W.aheadM + 0;
  const base = groundBelow(t.world, { x: cx, y: pos.y + WALL_GROUND_PROBE_UP_M, z: cz }, WALL_GROUND_DROP_M) ?? pos.y;
  const box = snappedWallBox({ x: cx, y: base, z: cz }, yaw, W.lengthM, W.thickM, W.heightM);
  spawnTerrain(s, t, u.id, "wall", box, WALL_SPEC);
  m.ready.e = t.now + slotCooldownTicks("earth", "e");
  emitCast(t, u, "stoneWall", "e", castAim(u, inp));
  return null;
}

/** C: нога поднимается 0,4 с, затем удар по диску 7 м вокруг точки каста (бьёт зона, Р8). */
function earthquake(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const no = groundedAndFree(t, u, "c");
  if (no) return no;
  const now = t.now;
  const p = u.move.body.pos;
  spawnZone(s, t, {
    owner: u.id, kind: "quake", ability: "earthquake", shape: { type: "disc", center: { x: p.x, y: p.y, z: p.z }, radius: Q.radiusM },
    bornTick: now, armTick: now + QUAKE_TELEGRAPH_TICKS, endTick: now + QUAKE_TELEGRAPH_TICKS + 1,
  });
  u.mage!.ready.c = now + slotCooldownTicks("earth", "c");
  emitCast(t, u, "earthquake", "c", castAim(u, inp));
  return null;
}

/**
 * X: «Тектонический разлом» (Р7 фазы 5). Только с пола (на полу или в окне «койота»); опору проверяем до startUlt —
 * в воздухе отказ «нет опоры», заряд цел. Линия 25 м по взгляду (не по осям) от 1,5 м перед ступнями, шириной 3 м,
 * на высоте ступней; видна сразу (zone/telegraph), трещина бежит 0,8 с, затем удар и 6 с шипов (stepRift).
 */
function tectonicRift(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): RejectReason | null {
  const mv = u.move;
  if (!mv.onGround && !(mv.coyote > 0)) return "notGrounded";
  const no = startUlt(t, u, inp, "tectonicRift");
  if (no) return no;
  const d = forwardXZ(sanitizeInput(inp, mv).yaw);
  const p = mv.body.pos;
  const far = TR.startM + TR.lengthM;
  const a: Vec3 = { x: p.x + d.x * TR.startM + 0, y: p.y, z: p.z + d.z * TR.startM + 0 };
  const b: Vec3 = { x: p.x + d.x * far + 0, y: p.y, z: p.z + d.z * far + 0 };
  const now = t.now;
  const arm = now + RIFT_TELEGRAPH_TICKS;
  u.mage!.ult.cast!.zone = spawnZone(s, t, {
    owner: u.id, kind: "rift", ability: "tectonicRift", shape: { type: "segment", a, b, halfW: TR.halfWidthM },
    bornTick: now, armTick: arm, endTick: arm + SPIKES_TICKS,
  });
  return null;
}

/** Слоты Земли для castSlots: он же держит буфер нажатий и пишет отказы. */
const EARTH_CASTS: Readonly<Record<Slot, TryCast>> = Object.freeze({ primary: stoneShot, q: stonePillar, e: stoneWall, c: earthquake, x: tectonicRift });
/**
 * Q, E и C — раньше удержанной ЛКМ: у них нет замаха, а замах камня, начатый первым, отклонил бы Q и C, нажатые
 * ровно на тике, когда камень снова готов. Так оба каста выходят тем же тиком. X — последней, как в SLOTS.
 */
const EARTH_ORDER: readonly Slot[] = Object.freeze(["q", "e", "c", "primary", "x"]);

export const EARTH_KIT: Kit = Object.freeze({
  input(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, pressed: Buttons): void {
    castSlots(s, t, u, inp, pressed, EARTH_CASTS, EARTH_ORDER);
  },
  /** Конец замаха: камень вылетает из глаз по прицелу этого тика. */
  tick(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
    const m = u.mage!;
    if (!m.windup || t.now < m.windup.releaseTick) return;
    const aim = castAim(u, inp);
    const id = spawnProjectile(s, t, u.id, "stoneShot", aim.eye, aim.dir);
    t.ev.push({ type: "release", unit: u.id, ability: "stoneShot", projectile: id, pos: aim.eye, dir: aim.dir });
    m.windup = null;
  },
});

const bodyCenter = (u: Unit): Vec3 => ({ x: u.move.body.pos.x, y: u.move.body.pos.y + u.move.body.height / 2, z: u.move.body.pos.z });

/**
 * Шаг разлома после взвода (Р7 фазы 5). Полоса — не коллайдер; хозяина не трогает. Задевает тех, чья подошва от 1,5 м
 * ниже до 2 м выше линии и кто касается отрезка (zoneTouches); толкает перпендикулярно линии в сторону цели (ровно на
 * линии — вправо от взгляда).
 * - armTick — удар по всей линии (ширина 3 м): живым не-хозяевам на полу 100, подброс 5 м («В воздухе») и 1 м вбок;
 *   кто в воздухе — не задет. Удар — первое касание: шипы колют его цель не раньше чем через 1 с (rehit). Затем
 *   полоса сужается до 1,5 м («шипы»).
 * - Дальше до endTick — «стена шипов»: касание (и в воздухе) — 20 и 3 м вбок, раз в 1 с на юнита.
 */
const stepRift: ZoneStep = (s, t, z) => {
  const sh = z.shape;
  if (sh.type !== "segment") return;
  const now = t.now;
  const d = horizontalDir({ x: sh.b.x - sh.a.x, z: sh.b.z - sh.a.z });
  const right = { x: -d.z + 0, z: d.x + 0 };
  const lo = sh.a.y - TR.belowM;
  const hi = sh.a.y + TR.aboveM;
  const strike = now === z.armTick;
  for (const v of s.units) {
    if (!v.alive || v.id === z.owner || (strike && !v.move.onGround)) continue;
    const p = v.move.body.pos;
    if (p.y < lo || p.y > hi || !zoneTouches(sh, v)) continue;
    const rec = z.rehit.find((r) => r.unit === v.id);
    if (!strike && rec && rec.tick > now) continue;
    const side = (p.x - sh.a.x) * right.x + (p.z - sh.a.z) * right.z;
    const dir = side < -ON_LINE_M ? { x: -right.x + 0, z: -right.z + 0 } : right;
    applyHit(s, t, {
      source: z.owner, target: v.id, ability: "tectonicRift", damage: strike ? TR.damage : TR.spikesDamage, pos: bodyCenter(v), dir,
      knock: strike ? { distM: TR.knockback.distM, upM: TR.knockback.upM } : { distM: TR.spikesKnock.distM, upM: TR.spikesKnock.upM }, launch: strike || undefined,
    });
    if (rec) rec.tick = now + SPIKES_REHIT_TICKS;
    else z.rehit.push({ unit: v.id, tick: now + SPIKES_REHIT_TICKS });
  }
  if (strike) sh.halfW = TR.spikesHalfWidthM;
};

/** Земля «Стойкость» в реестре стихий: кит и шаг зоны разлома. */
export const EARTH_SIM: ElementSim = Object.freeze({ kit: EARTH_KIT, zones: Object.freeze({ rift: stepRift }) });
