import { aabb } from "../aabb";
import { forwardXZ, sanitizeInput } from "../player";
import { groundBelow } from "../raycast";
import { aimGround } from "./aim";
import { EARTH, slotCooldownTicks, ticks } from "./defs";
import { castAim, emitCast, rejectCast, snappedWallBox, type Kit } from "./kit";
import { spawnProjectile } from "./projectiles";
import { spawnTerrain, type TerrainSpec } from "./terrain";
import type { Buttons, MatchInput, MatchState, Slot, TickCtx, Unit } from "./types";
import { spawnZone } from "./zones";

/**
 * Кит Земли «Стойкость» (GDD 4.4). Перезарядки идут с нажатия (Р14); замах камня не даёт стрелять ЛКМ, Q и C,
 * E работает всегда. «Корни»: Q и C — только стоя на полу (отбрасывание ×0,5 считает бой).
 */

const SS = EARTH.stoneShot;
const P = EARTH.stonePillar;
const W = EARTH.stoneWall;
const Q = EARTH.earthquake;

const STONE_WINDUP_TICKS = ticks(SS.windupS); // 12
const PILLAR_TELEGRAPH_TICKS = ticks(P.telegraphS); // 36
const QUAKE_TELEGRAPH_TICKS = ticks(Q.telegraphS); // 24
/** Опору под стеной ищем от точки на 0,6 м выше ступней мага и не глубже 3 м; нет опоры — основание на ступнях. */
const WALL_GROUND_PROBE_UP_M = 0.6;
const WALL_GROUND_DROP_M = 3;
const WALL_SPEC: Readonly<TerrainSpec> = Object.freeze({ growTicks: ticks(W.growS), solidTicks: ticks(W.solidS), lifeTicks: ticks(W.lifeS), hp: W.hp }); // 18, 12, 360, 250

/** Перезарядка слота или замах; true — каст отклонён (событие reject уже записано). */
function blocked(t: TickCtx, u: Unit, slot: Slot): boolean {
  const m = u.mage!;
  if (t.now < m.ready[slot]) {
    rejectCast(t, u, slot, "cooldown");
    return true;
  }
  if (m.windup) {
    rejectCast(t, u, slot, "busy");
    return true;
  }
  return false;
}

/** «Корни»: Q и C только стоя на полу; true — каст отклонён. */
function notGrounded(t: TickCtx, u: Unit, slot: Slot): boolean {
  if (u.move.onGround) return false;
  rejectCast(t, u, slot, "notGrounded");
  return true;
}

/** ЛКМ: пока удержана и слот готов — замах камня 0,2 с; снаряд выпускает tick. Отказов не шлёт. */
function stoneShot(t: TickCtx, u: Unit, inp: MatchInput): void {
  const m = u.mage!;
  if (!inp.primary || m.windup || t.now < m.ready.primary) return;
  m.ready.primary = t.now + slotCooldownTicks("earth", "primary");
  m.windup = { ability: "stoneShot", slot: "primary", releaseTick: t.now + STONE_WINDUP_TICKS };
  emitCast(t, u, "stoneShot", "primary", castAim(u, inp));
}

/**
 * Q: трещины 0,6 с в точке под прицелом, затем удар и столб (их делает зона). Точка ближе 0,9 м к магу — столб
 * под ним самим (Р9): по центру мага, от его ступней.
 */
function stonePillar(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
  if (notGrounded(t, u, "q") || blocked(t, u, "q")) return;
  const c = sanitizeInput(inp, u.move);
  const at = aimGround(s, t, u.id, c.yaw, c.pitch, P.rangeM);
  if (!at) return rejectCast(t, u, "q", "noTarget");
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
}

/** E: стена 2 м перед магом поперёк взгляда (Р6), основание — опора под ней. Можно и в воздухе, и во время замаха. */
function stoneWall(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
  const m = u.mage!;
  if (t.now < m.ready.e) return rejectCast(t, u, "e", "cooldown");
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
}

/** C: нога поднимается 0,4 с, затем удар по диску 7 м вокруг точки каста (бьёт зона, Р8). */
function earthquake(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void {
  if (notGrounded(t, u, "c") || blocked(t, u, "c")) return;
  const now = t.now;
  const p = u.move.body.pos;
  spawnZone(s, t, {
    owner: u.id, kind: "quake", ability: "earthquake", shape: { type: "disc", center: { x: p.x, y: p.y, z: p.z }, radius: Q.radiusM },
    bornTick: now, armTick: now + QUAKE_TELEGRAPH_TICKS, endTick: now + QUAKE_TELEGRAPH_TICKS + 1,
  });
  u.mage!.ready.c = now + slotCooldownTicks("earth", "c");
  emitCast(t, u, "earthquake", "c", castAim(u, inp));
}

export const EARTH_KIT: Kit = Object.freeze({
  input(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, pressed: Buttons): void {
    stoneShot(t, u, inp);
    if (pressed.q) stonePillar(s, t, u, inp);
    if (pressed.e) stoneWall(s, t, u, inp);
    if (pressed.c) earthquake(s, t, u, inp);
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
