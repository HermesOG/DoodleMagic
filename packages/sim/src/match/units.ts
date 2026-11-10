import { bodyBox, moveBody } from "../body";
import { DEFAULT_MOVE, NO_INPUT, stepPlayer } from "../player";
import { groundBelow } from "../raycast";
import { TICK_DT, type MoveParams, type PlayerInput, type Spawn } from "../types";
import { volumeAt, type World } from "../world";
import { applyHit, courage, endTow, respawnAt } from "./combat";
import { DUMMY, ELEMENT_INFO, KNOCKBACK, MATCH, ULT_MOVE, ticks } from "./defs";
import { NO_HOOKS, type SimHooks } from "./hooks";
import { furyOnDeath } from "./pickups";
import { createDummyUnit, createMageUnit, idleInput, rightXZ, unitById } from "./state";
import { NOBODY, type Element, type MatchInput, type MatchState, type TickCtx, type Unit, type UnitId } from "./types";
import { ultOnKill } from "./ult";

/**
 * Юниты: движение по вводу и ИИ манекенов, канал отбрасывания, сброс в пропасть и возрождение.
 * Порядок в тике (его повторяет stepMatch): moveUnits → (снаряды, зоны, рельеф, объекты на карте) → stepStatuses → stepLife.
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
/** Буксир упёрся, если за тик продвинулся меньше этой доли шага; дошёл — если до точки осталось не больше этого, м. */
const TOW_STALL_FRAC = 0.5;
const TOW_ARRIVE_M = 1e-6;

/**
 * Второй вызов moveBody — по каналу отбрасывания, со своими стенами и ступенькой; заблокированная ось гасит канал.
 * Канал гаснет как на полу, если юнит на полу или парит (Р1 фазы 4), иначе как в воздухе.
 * Удар о стену (Порыв): ось заблокирована, канал по ней до шага ≥ KNOCKBACK.slamMinSpeed, и ждёт u.slam — событие
 * slam и удар его урона (один раз). Скорость канала ниже порога или канал погас — удар о стену больше не ждёт.
 */
export function moveKnock(s: MatchState, t: TickCtx, u: Unit): void {
  const kb = u.kb;
  const sp = Math.sqrt(kb.x * kb.x + kb.z * kb.z);
  if (sp < KNOCKBACK.stopSpeed) {
    Object.assign(kb, { x: 0, z: 0 });
    u.slam = null;
    return;
  }
  const k = u.move.onGround || u.mage?.flight.gliding === true ? GROUND : AIR;
  const b = u.move.body;
  const own = b.vel;
  b.vel = { x: kb.x * k.mean, y: 0, z: kb.z * k.mean };
  const r = moveBody(t.world, b, TICK_DT, u.move.onGround);
  // Скорость канала в стену — по заблокированной оси: задеть стену вскользь на полной скорости — не удар.
  const into = Math.max(kb.x !== 0 && b.vel.x === 0 ? Math.abs(kb.x) : 0, kb.z !== 0 && b.vel.z === 0 ? Math.abs(kb.z) : 0);
  kb.x = b.vel.x === 0 ? 0 : kb.x * k.e;
  kb.z = b.vel.z === 0 ? 0 : kb.z * k.e;
  b.vel = own;
  if (!r.onGround) u.move.onGround = false; // столкнули с края — следующий stepPlayer уже в воздухе
  const slam = u.slam;
  if (!slam) return;
  if (into >= KNOCKBACK.slamMinSpeed) {
    u.slam = null;
    t.ev.push({ type: "slam", target: u.id, source: slam.by, pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z } });
    applyHit(s, t, { source: slam.by, target: u.id, ability: slam.ability, damage: slam.damage, pos: { x: b.pos.x, y: b.pos.y + b.height / 2, z: b.pos.z }, dir: { x: 0, z: 0 } });
  } else if (sp < KNOCKBACK.slamMinSpeed || (kb.x === 0 && kb.z === 0)) u.slam = null;
}

/**
 * Шаг буксира (Р5): тянет по XZ к точке буксира со своей скоростью через moveBody, без гравитации (vel.y = 0);
 * ввод движения и прыжок не действуют, взгляд и jumpHeld — из ввода. Дошёл, упёрся (за тик продвинулся меньше
 * половины шага) или последний тик (now + 1 ≥ endTick) — endTow.
 */
function stepTow(t: TickCtx, u: Unit, inp: PlayerInput): void {
  const tow = u.tow!;
  const b = u.move.body;
  const dx = tow.x - b.pos.x;
  const dz = tow.z - b.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const step = Math.min(d, tow.speed * TICK_DT);
  const ux = d > 1e-9 ? dx / d : 0;
  const uz = d > 1e-9 ? dz / d : 0;
  const x0 = b.pos.x;
  const z0 = b.pos.z;
  b.vel = { x: (ux * step) / TICK_DT, y: 0, z: (uz * step) / TICK_DT };
  const r = moveBody(t.world, b, TICK_DT, u.move.onGround);
  b.vel.y = 0;
  Object.assign(u.move, { onGround: r.onGround, landVel: r.landVel, yaw: inp.yaw, pitch: inp.pitch, jumpHeld: inp.jump });
  const progress = (b.pos.x - x0) * ux + (b.pos.z - z0) * uz;
  const arrived = d - progress <= TOW_ARRIVE_M;
  if (arrived || progress < TOW_STALL_FRAC * step || t.now + 1 >= tow.endTick) endTow(t, u);
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
 * Шаг движения живых юнитов; маги в рывке пропускаются (их ведёт кит), юнит на буксире идёт stepTow. Обездвиживание и
 * «В воздухе» отнимают шаги и прыжок, но не взгляд. Маг без ввода на этом тике стоит и смотрит, куда смотрел.
 * Своя ульта (ULT_MOVE, до releaseTick или endTick каста) режет бег ×runMul и снимает прыжок из ввода.
 * Порядок у мага: хуки стихии before → params → stepPlayer → after → канал толчка (moveKnock).
 * Манекен, который шагает, но второй тик подряд стоит на месте (до шага и после него скорость по XZ ≈ 0), упёрся в
 * стену или рельеф: он разворачивается. На обычном развороте патруля скорость проходит через 0 только на одном тике.
 */
export function moveUnits(s: MatchState, t: TickCtx, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>, hooks: SimHooks = NO_HOOKS): void {
  for (const u of s.units) {
    if (!u.alive || (u.mage !== null && u.mage.dash !== null)) continue;
    const st = u.status;
    if (u.tow) {
      stepTow(t, u, u.mage ? (inputs[u.id] ?? idleInput(u)) : { ...NO_INPUT, yaw: u.move.yaw, pitch: u.move.pitch });
      continue;
    }
    let inp: PlayerInput = u.mage ? (inputs[u.id] ?? idleInput(u)) : dummyInput(t.world, u);
    let p: MoveParams = u.mage ? mageMoveParams(u.mage.element) : DUMMY_MOVE;
    if (t.now < st.rootUntil || t.now < st.noControlUntil) inp = { ...inp, moveX: 0, moveZ: 0, jump: false }; // взгляд не отнимаем (GDD 2.2)
    if (t.now < st.slowUntil) p = { ...p, runSpeed: p.runSpeed * st.slowMul };
    const uc = u.mage?.ult.cast ?? null;
    if (uc) {
      const um = ULT_MOVE[uc.ability];
      if (t.now < (um.until === "release" ? uc.releaseTick : uc.endTick)) {
        if (um.runMul !== 1) p = { ...p, runSpeed: p.runSpeed * um.runMul };
        if (um.noJump) inp = { ...inp, jump: false };
      }
    }
    // K1: после толчка ≥ 1 м своё ускорение ×0,3 (и в воздухе: там оно — доля наземного); торможение без ввода прежнее
    if (t.now < st.staggerUntil) p = { ...p, groundAccel: p.groundAccel * KNOCKBACK.staggerAccelMul };
    const h = u.mage ? hooks.move[u.mage.element] : undefined;
    h?.before?.(u, t, inp);
    if (h?.params) p = h.params(u, t, inp, p);
    const stillBefore = horizSpeed(u) < STUCK_SPEED;
    u.move = stepPlayer(u.move, inp, TICK_DT, t.world, p);
    if (u.dummy && inp.moveX !== 0 && stillBefore && horizSpeed(u) < STUCK_SPEED) u.dummy.dir = -u.dummy.dir;
    if (t.now < st.rootUntil) Object.assign(u.move.body.vel, { x: 0, z: 0 });
    h?.after?.(u, t, inp);
    moveKnock(s, t, u);
  }
}

/**
 * Точка появления мага id в PvP: дальняя от живых врагов. Для каждой точки — наименьшее расстояние по XZ до живых
 * магов, кроме самого id (их нет — Infinity); берётся наибольшее, при равенстве — меньший номер. Возвращает саму точку
 * из списка, не копию. Пустой список — ошибка. Квадраты расстояний вместо корней: порядок тот же, а счёт точен.
 */
export function pickSpawn(s: Readonly<MatchState>, id: UnitId, spawns: readonly Spawn[]): Spawn {
  if (spawns.length === 0) throw new Error("pickSpawn: нет точек появления");
  let best = 0;
  let bestD2 = -1;
  for (let k = 0; k < spawns.length; k++) {
    const p = spawns[k]!.pos;
    let d2 = Infinity;
    for (const u of s.units) {
      if (u.kind !== "mage" || !u.alive || u.id === id) continue;
      const dx = u.move.body.pos.x - p.x;
      const dz = u.move.body.pos.z - p.z;
      d2 = Math.min(d2, dx * dx + dz * dz);
    }
    if (d2 > bestD2) {
      best = k;
      bestD2 = d2;
    }
  }
  return spawns[best]!;
}

/**
 * Свежий юнит; маг сохраняет счёт, перезарядки и заряд ульты (каст к этому времени уже снят; Р2 фазы 5), hitters — [].
 * Маг встаёт на pickSpawn, если в тике есть точки PvP (иначе — на свою mage.spawn), и получает защиту на t.spawnShieldTicks.
 */
function respawned(s: MatchState, t: TickCtx, u: Unit): Unit {
  if (!u.mage) return createDummyUnit(u.id, u.dummy!.spot);
  const at = t.spawns === null ? u.mage.spawn : pickSpawn(s, u.id, t.spawns);
  const fresh = createMageUnit(u.id, u.mage.element, at);
  fresh.mage!.stats = { ...u.mage.stats };
  fresh.mage!.ready = { ...u.mage.ready };
  fresh.mage!.charges = { ...u.mage.charges };
  fresh.mage!.chargeAt = { ...u.mage.chargeAt };
  fresh.mage!.ult = { charge: u.mage.ult.charge, cast: null };
  // маг встаёт в конце тика now: защита на полные spawnShieldTicks тиков, как у addMage и старта боя
  if (t.spawnShieldTicks > 0) fresh.status.shieldUntil = t.now + 1 + t.spawnShieldTicks;
  return fresh;
}

/**
 * Сброс: живой в зоне смерти или ниже killBelowY выбывает (маг +1 deaths, и когда упал сам); сброс засчитывается
 * последнему ударившему за 5 с (Р13), засчитанному магу — falls и «Кураж»; засчитанный сброс даёт заряд ульты, как
 * убийство (+6 и помощь, Р1 фазы 5); сброс носителя ярости снимает её, засчитанному +10 (Р5 фазы 6).
 * Возрождение: на respawnTick юнит заменяется свежим (respawned) — по текущему состоянию: маги, вставшие раньше
 * в этом тике, уже стоят на своих точках.
 */
export function stepLife(s: MatchState, t: TickCtx): void {
  const now = t.now;
  for (let i = 0; i < s.units.length; i++) {
    const u = s.units[i]!;
    if (u.alive) {
      const b = u.move.body;
      if (volumeAt(t.world, bodyBox(b), "kill") === null && !(b.pos.y < t.killBelowY)) continue;
      u.alive = false;
      endTow(t, u);
      u.slam = null;
      u.respawnTick = respawnAt(u, t);
      if (u.mage) u.mage.stats.deaths += 1;
      const by = u.lastHitBy;
      const credit = by !== NOBODY && by !== u.id && now - u.lastHitTick <= FALL_CREDIT_TICKS ? by : NOBODY;
      t.ev.push({ type: "fall", target: u.id, credit, pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z } });
      const c = credit === NOBODY ? undefined : unitById(s, credit);
      if (c?.mage) {
        c.mage.stats.falls += 1;
        courage(t, c);
      }
      if (credit !== NOBODY) ultOnKill(s, t, u, credit);
      furyOnDeath(s, t, u, credit);
    } else if (now >= u.respawnTick) {
      const fresh = respawned(s, t, u);
      s.units[i] = fresh;
      const at = fresh.mage ? fresh.mage.spawn : fresh.dummy!.spot;
      t.ev.push({ type: "respawn", target: u.id, pos: { x: at.pos.x, y: at.pos.y, z: at.pos.z }, yaw: at.yaw });
    }
  }
}
