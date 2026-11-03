import { moveBody } from "../body";
import { TICK_DT, type Vec3 } from "../types";
import { endTow } from "./combat";
import { ticks } from "./defs";
import { moveDirXZ } from "./kit";
import { NOBODY, type AbilityId, type MatchInput, type MatchState, type TickCtx, type Unit } from "./types";
import { spawnZone } from "./zones";

/**
 * Рывок (A6, Р3 фазы 4): общий модуль Реактивного рывка Огня и Взмаха Воздуха. Горизонтально, без гравитации,
 * скорость падает линейно от (1 + profile)·v̄ до (1 − profile)·v̄: рывок «выстреливает» и мягко садится, путь и время
 * прежние. Функции меняют переданное состояние на месте и пишут события в t.ev.
 */

export interface DashSpec {
  ability: AbilityId; distM: number; durationS: number;
  /** Профиль: скорость линейно от (1 + profile)·v̄ до (1 − profile)·v̄, v̄ = distM / durationS. */
  profile: number;
  exitSpeed: number;
  /** След огня (зона fireTrail) за магом; null — без следа. */
  trail: { halfWidthM: number; lifeS: number } | null;
}

/**
 * Упор (правка контролёра после ревью китов): рывок кончается о стену, только если за тик продвинулся вдоль себя
 * меньше этой доли шага тика. Скольжение вдоль стены под 45° даёт ровно половину шага и идёт дальше; в лоб — около нуля.
 */
const DASH_STALL_FRAC = 0.45;

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const trailTicks = (spec: DashSpec): number => (spec.trail ? ticks(spec.trail.lifeS) : 0);

/** Скорость рывка на k-м тике из n (середина тика): v̄·(1 + profile·(1 − (2k + 1)/n)); сумма шагов — ровно distM. */
export function dashSpeedAt(spec: DashSpec, k: number, n: number): number {
  return (spec.distM / spec.durationS) * (1 + spec.profile * (1 - (2 * k + 1) / n));
}

/**
 * Начать рывок по вводу движения (без ввода — вперёд): гасит канал толчка и удар о стену, обрывает буксир (endTow),
 * след — если есть (отрезок от старта, его конец тянется за магом). Перезарядку и событие cast ставит кит. Событий
 * рывка не пишет: dash/start — dashStarted, после cast.
 */
export function startDash(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, spec: DashSpec): void {
  const m = u.mage!;
  const now = t.now;
  const dir = moveDirXZ(inp);
  u.kb.x = 0;
  u.kb.z = 0;
  u.slam = null;
  if (u.tow) endTow(t, u);
  const n = ticks(spec.durationS);
  const p = u.move.body.pos;
  const trailZone = spec.trail
    ? spawnZone(s, t, {
        owner: u.id, kind: "fireTrail", ability: spec.ability, shape: { type: "segment", a: copy(p), b: copy(p), halfW: spec.trail.halfWidthM },
        bornTick: now, armTick: now, endTick: now + n + trailTicks(spec),
      })
    : NOBODY;
  m.dash = { ability: spec.ability, dirX: dir.x, dirZ: dir.z, startTick: now, endTick: now + n, trailZone };
}

/** Событие dash/start (кит пишет его после cast — порядок событий Огня прежний: zone/telegraph → cast → dash/start). */
export function dashStarted(t: TickCtx, u: Unit): void {
  const d = u.mage!.dash!;
  t.ev.push({ type: "dash", unit: u.id, ability: d.ability, phase: "start", pos: copy(u.move.body.pos), dir: { x: d.dirX, y: 0, z: d.dirZ } });
}

/**
 * Тик рывка: горизонтально, без гравитации, через moveBody со стенами (moveUnits мага в рывке пропускает). Взгляд
 * не отнимаем: stepPlayer в эти тики не идёт, поэтому yaw и pitch тела — из ввода. Скорость ставится заново каждый
 * тик по профилю: задетая вскользь стена гасит только свою составляющую, и маг скользит вдоль неё. Конец — последний
 * тик или упор: за тик продвинулся вдоль рывка меньше DASH_STALL_FRAC шага этого тика.
 */
export function stepDash(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, spec: DashSpec): void {
  const d = u.mage!.dash!;
  const b = u.move.body;
  const x0 = b.pos.x;
  const z0 = b.pos.z;
  const v = dashSpeedAt(spec, t.now - d.startTick, ticks(spec.durationS));
  b.vel = { x: d.dirX * v, y: 0, z: d.dirZ * v };
  const r = moveBody(t.world, b, TICK_DT, u.move.onGround);
  Object.assign(u.move, { onGround: r.onGround, landVel: r.landVel, yaw: inp.yaw, pitch: inp.pitch });
  const trail = d.trailZone === NOBODY ? undefined : s.zones.find((z) => z.id === d.trailZone);
  if (trail && trail.shape.type === "segment") trail.shape.b = copy(b.pos);
  const progress = (b.pos.x - x0) * d.dirX + (b.pos.z - z0) * d.dirZ;
  if (progress < DASH_STALL_FRAC * v * TICK_DT || t.now + 1 >= d.endTick) endDash(s, t, u, spec, t.now + 1 + trailTicks(spec));
}

/** Конец: скорость exitSpeed по направлению, след догорает до trailEnd, событие dash/end. */
export function endDash(s: MatchState, t: TickCtx, u: Unit, spec: DashSpec, trailEnd: number): void {
  const m = u.mage!;
  const d = m.dash!;
  const b = u.move.body;
  b.vel = { x: d.dirX * spec.exitSpeed, y: 0, z: d.dirZ * spec.exitSpeed };
  const trail = d.trailZone === NOBODY ? undefined : s.zones.find((z) => z.id === d.trailZone);
  if (trail) trail.endTick = trailEnd;
  t.ev.push({ type: "dash", unit: u.id, ability: d.ability, phase: "end", pos: copy(b.pos), dir: { x: d.dirX, y: 0, z: d.dirZ } });
  m.dash = null;
}
