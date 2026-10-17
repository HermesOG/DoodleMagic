import { bodyBox, moveBody } from "../body";
import { DEFAULT_MOVE, NO_INPUT, stepPlayer } from "../player";
import { groundBelow } from "../raycast";
import { TICK_DT, type MoveParams, type PlayerInput } from "../types";
import { volumeAt, type World } from "../world";
import { courage, respawnAt } from "./combat";
import { DUMMY, ELEMENT_INFO, KNOCKBACK, MATCH, ticks } from "./defs";
import { NO_MATCH_INPUT, createDummyUnit, createMageUnit, rightXZ, unitById } from "./state";
import { NOBODY, type Element, type MatchInput, type MatchState, type TickCtx, type Unit, type UnitId } from "./types";

/**
 * Юниты: движение по вводу и ИИ манекенов, канал отбрасывания, сброс в пропасть и возрождение.
 * Порядок в тике (его повторяет stepMatch): moveUnits → (снаряды, зоны, рельеф) → stepStatuses → stepLife.
 */

/** Манекен полигона ходит 2 м/с (Р12). */
export const DUMMY_MOVE: Readonly<MoveParams> = Object.freeze({ ...DEFAULT_MOVE, runSpeed: DUMMY.runSpeed });
export const mageMoveParams = (element: Element): MoveParams => ({ ...DEFAULT_MOVE, runSpeed: ELEMENT_INFO[element].runSpeed });

/**
 * За тик: множитель затухания e^(−λ·dt) и доля средней скорости тика (1 − e^(−λ·dt)) / (λ·dt).
 * Сдвиг за тик v·mean·dt = v·(1 − e)/λ, поэтому сумма шагов по ровному полу — ровно v₀/λ при любом тике.
 */
const decay = (lambda: number) => Object.freeze({ e: Math.exp(-lambda * TICK_DT), mean: (1 - Math.exp(-lambda * TICK_DT)) / (lambda * TICK_DT) });
const GROUND = decay(KNOCKBACK.groundDecayPerS);
const AIR = decay(KNOCKBACK.airDecayPerS);
const FALL_CREDIT_TICKS = ticks(MATCH.fallCreditS); // 300

/** Второй вызов moveBody — по каналу отбрасывания, со своими стенами и ступенькой; заблокированная ось гасит канал. */
export function moveKnock(world: World, u: Unit): void {
  const kb = u.kb;
  if (Math.sqrt(kb.x * kb.x + kb.z * kb.z) < KNOCKBACK.stopSpeed) return void Object.assign(kb, { x: 0, z: 0 });
  const k = u.move.onGround ? GROUND : AIR;
  const b = u.move.body;
  const own = b.vel;
  b.vel = { x: kb.x * k.mean, y: 0, z: kb.z * k.mean };
  const r = moveBody(world, b, TICK_DT, u.move.onGround);
  kb.x = b.vel.x === 0 ? 0 : kb.x * k.e;
  kb.z = b.vel.z === 0 ? 0 : kb.z * k.e;
  b.vel = own;
  if (!r.onGround) u.move.onGround = false; // столкнули с края — следующий stepPlayer уже в воздухе
}

/** Насколько дальше передней грани тела манекен смотрит, есть ли впереди опора, м. */
const LEDGE_LOOK_M = 0.6;
/** Ниже этой скорости по XZ, м/с, манекен считается стоящим (для проверки «упёрся в стену»). */
const STUCK_SPEED = 0.05;
const horizSpeed = (u: Unit): number => Math.sqrt(u.move.body.vel.x * u.move.body.vel.x + u.move.body.vel.z * u.move.body.vel.z);

/**
 * Есть ли опора там, куда манекен шагнёт: точка на LEDGE_LOOK_M впереди передней грани тела по ходу (wx, wz),
 * опора не дальше высоты ступеньки вверх или вниз. Стена впереди тоже «опора»: от неё разворачивает moveUnits.
 */
function groundAhead(world: World, u: Unit, wx: number, wz: number): boolean {
  const b = u.move.body;
  const ahead = b.halfW + LEDGE_LOOK_M;
  const probe = { x: b.pos.x + wx * ahead, y: b.pos.y + b.stepHeight, z: b.pos.z + wz * ahead };
  return groundBelow(world, probe, 2 * b.stepHeight) !== null;
}

/**
 * ИИ манекена: стрейф вдоль rightXZ(spot.yaw) на ±patrolHalfM; стоит без патруля, в воздухе и пока его несёт толчок.
 * Сам с края не сходит: если впереди по ходу нет опоры (ущелье, край моста или столба), разворачивается и на этом
 * тике стоит. Проверка смотрит на то место, где манекен стоит сейчас, поэтому работает и после толчка в сторону
 * от линии патруля. Отбрасывание идёт мимо этого ИИ: пока kb ≠ 0, манекен стоит, и канал несёт его за край.
 */
function dummyInput(world: World, u: Unit): PlayerInput {
  const d = u.dummy!;
  const spot = d.spot;
  const half = spot.patrolHalfM;
  const stand: PlayerInput = { ...NO_INPUT, yaw: spot.yaw };
  if (half === undefined || !(half > 0) || !u.move.onGround || u.kb.x !== 0 || u.kb.z !== 0) return stand;
  const r = rightXZ(spot.yaw);
  const p = u.move.body.pos;
  const off = (p.x - spot.pos.x) * r.x + (p.z - spot.pos.z) * r.z;
  if (off >= half) d.dir = -1;
  else if (off <= -half) d.dir = 1;
  else if (d.dir === 0) d.dir = 1;
  if (!groundAhead(world, u, r.x * d.dir, r.z * d.dir)) {
    d.dir = -d.dir;
    return stand;
  }
  return { ...stand, moveX: d.dir };
}

/**
 * Шаг движения живых юнитов; маги в рывке пропускаются (их ведёт кит). Обездвиживание и «В воздухе» отнимают шаги и
 * прыжок, но не взгляд. Маг без ввода на этом тике стоит и смотрит, куда смотрел.
 * Манекен, который шагает, но второй тик подряд стоит на месте (до шага и после него скорость по XZ ≈ 0), упёрся в
 * стену или рельеф: он разворачивается. На обычном развороте патруля скорость проходит через 0 только на одном тике.
 */
export function moveUnits(s: MatchState, t: TickCtx, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>): void {
  for (const u of s.units) {
    if (!u.alive || (u.mage !== null && u.mage.dash !== null)) continue;
    const st = u.status;
    let inp: PlayerInput = u.mage ? (inputs[u.id] ?? { ...NO_MATCH_INPUT, yaw: u.move.yaw, pitch: u.move.pitch }) : dummyInput(t.world, u);
    let p: MoveParams = u.mage ? mageMoveParams(u.mage.element) : DUMMY_MOVE;
    if (t.now < st.rootUntil || t.now < st.noControlUntil) inp = { ...inp, moveX: 0, moveZ: 0, jump: false }; // взгляд не отнимаем (GDD 2.2)
    if (t.now < st.slowUntil) p = { ...p, runSpeed: p.runSpeed * st.slowMul };
    const stillBefore = horizSpeed(u) < STUCK_SPEED;
    u.move = stepPlayer(u.move, inp, TICK_DT, t.world, p);
    if (u.dummy && inp.moveX !== 0 && stillBefore && horizSpeed(u) < STUCK_SPEED) u.dummy.dir = -u.dummy.dir;
    if (t.now < st.rootUntil) Object.assign(u.move.body.vel, { x: 0, z: 0 });
    moveKnock(t.world, u);
  }
}

/** Свежий юнит на его точке; маг сохраняет счёт и перезарядки. */
function respawned(u: Unit): Unit {
  if (!u.mage) return createDummyUnit(u.id, u.dummy!.spot);
  const fresh = createMageUnit(u.id, u.mage.element, u.mage.spawn);
  fresh.mage!.stats = { ...u.mage.stats };
  fresh.mage!.ready = { ...u.mage.ready };
  return fresh;
}

/**
 * Сброс: живой в зоне смерти или ниже killBelowY выбывает; сброс засчитывается последнему ударившему за 5 с (Р13),
 * засчитанному магу — falls и «Кураж». Возрождение: на respawnTick юнит заменяется свежим на своей точке.
 */
export function stepLife(s: MatchState, t: TickCtx): void {
  const now = t.now;
  for (let i = 0; i < s.units.length; i++) {
    const u = s.units[i]!;
    if (u.alive) {
      const b = u.move.body;
      if (volumeAt(t.world, bodyBox(b), "kill") === null && !(b.pos.y < t.killBelowY)) continue;
      u.alive = false;
      u.respawnTick = respawnAt(u, now);
      const by = u.lastHitBy;
      const credit = by !== NOBODY && by !== u.id && now - u.lastHitTick <= FALL_CREDIT_TICKS ? by : NOBODY;
      t.ev.push({ type: "fall", target: u.id, credit, pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z } });
      const c = credit === NOBODY ? undefined : unitById(s, credit);
      if (c?.mage) {
        c.mage.stats.falls += 1;
        courage(t, c);
      }
    } else if (now >= u.respawnTick) {
      const fresh = respawned(u);
      s.units[i] = fresh;
      const at = fresh.mage ? fresh.mage.spawn : fresh.dummy!.spot;
      t.ev.push({ type: "respawn", target: u.id, pos: { x: at.pos.x, y: at.pos.y, z: at.pos.z }, yaw: at.yaw });
    }
  }
}
