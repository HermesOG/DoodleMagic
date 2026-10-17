import { centerOf, overlaps } from "../aabb";
import { bodyBox } from "../body";
import { DEFAULT_MOVE } from "../player";
import type { AABB, Collider, Vec3 } from "../types";
import { isFree, OVERLAP_EPS, withDynamic, type World } from "../world";
import { LIMITS } from "./defs";
import type { MatchState, Terrain, TerrainKind, TickCtx, Unit, UnitId } from "./types";

/** Жизнь куска рельефа в тиках от появления: рост рисунка, твёрдость, исчезновение; и его HP. */
export interface TerrainSpec {
  growTicks: number;
  solidTicks: number;
  lifeTicks: number;
  hp: number;
}

/** Центр основания бокса: там рельеф растёт и уходит в землю. */
const baseCenter = (b: AABB): Vec3 => ({ x: (b.min.x + b.max.x) / 2, y: b.min.y, z: (b.min.z + b.max.z) / 2 });

function emit(t: TickCtx, tr: Terrain, phase: "rise" | "solid" | "hit" | "break" | "expire", pos: Vec3, amount = 0): void {
  t.ev.push({ type: "terrain", terrain: tr.id, kind: tr.kind, owner: tr.owner, phase, pos, amount });
}

function remove(s: MatchState, tr: Terrain): void {
  const k = s.terrain.indexOf(tr);
  if (k >= 0) s.terrain.splice(k, 1);
}

/**
 * Новый кусок рельефа: ещё не твёрдый, твёрдым его делает stepTerrain на solidTick. Сначала соблюдаются пределы
 * GDD 7.3–7.4: у владельца уже LIMITS.terrainPerMage кусков — его самый старый уходит (expire); всего
 * LIMITS.terrainTotal — уходит самый старый вообще. Событие rise. Возвращает id.
 */
export function spawnTerrain(s: MatchState, t: TickCtx, owner: UnitId, kind: TerrainKind, box: AABB, spec: TerrainSpec): number {
  for (;;) {
    const own = s.terrain.filter((tr) => tr.owner === owner);
    if (own.length < LIMITS.terrainPerMage) break;
    remove(s, own[0]!);
    emit(t, own[0]!, "expire", baseCenter(own[0]!.box));
  }
  while (s.terrain.length >= LIMITS.terrainTotal) {
    const first = s.terrain[0]!;
    remove(s, first);
    emit(t, first, "expire", baseCenter(first.box));
  }
  const now = t.now;
  const tr: Terrain = {
    id: s.nextId++, owner, kind, box,
    bornTick: now, solidTick: now + spec.solidTicks, endTick: now + spec.lifeTicks, growTicks: spec.growTicks,
    solid: false, hp: spec.hp, maxHp: spec.hp,
  };
  s.terrain.push(tr);
  emit(t, tr, "rise", baseCenter(box));
  return tr.id;
}

/** Урон рельефу в точке pos: событие hit; HP ≤ 0 — кусок ломается (break в центре бокса). Нет такого id — ничего. */
export function damageTerrain(s: MatchState, t: TickCtx, id: number, amount: number, pos: Vec3): void {
  const tr = s.terrain.find((x) => x.id === id);
  if (!tr) return;
  tr.hp -= amount;
  emit(t, tr, "hit", { x: pos.x, y: pos.y, z: pos.z }, amount);
  if (tr.hp <= 0) {
    remove(s, tr);
    emit(t, tr, "break", centerOf(tr.box));
  }
}

/**
 * Шаг рельефа на тике t.now: на endTick кусок уходит (expire); на solidTick становится твёрдым (solid) и выталкивает
 * из себя живые тела (pushOut). Выталкивание видит мир тика, этот кусок и куски, затвердевшие раньше на этом же шаге.
 */
export function stepTerrain(s: MatchState, t: TickCtx): void {
  const now = t.now;
  const hardened: Collider[] = [];
  for (const tr of [...s.terrain]) {
    if (now >= tr.endTick) {
      remove(s, tr);
      emit(t, tr, "expire", baseCenter(tr.box));
    } else if (!tr.solid && now >= tr.solidTick) {
      tr.solid = true;
      hardened.push({ box: tr.box });
      const world = withDynamic(t.world, [...(t.world.dynamic ?? []), ...hardened]);
      for (const u of s.units) if (u.alive) pushOut(world, u, tr.box);
      emit(t, tr, "solid", baseCenter(tr.box));
    }
  }
}

/** Гравитация движения юнитов: та же, что у stepPlayer (маги и манекены идут от DEFAULT_MOVE). */
const G = DEFAULT_MOVE.gravity;

/**
 * Выталкивание из рельефа, выросшего в теле (Р16): кратчайший свободный путь из box — вверх на верх бокса, ±x, ±z
 * (при равной длине — в этом порядке). Путь вверх считается за вычетом собственного подъёма тела v²/2g: взлетающее
 * тело (подъём «под себя» на столбе) и так поднимется выше, поэтому выйти на верх ему почти ничего не стоит, и вбок
 * его не сносит, даже если маг стоял не по центру столба. Стоящему и падающему телу подъёма нет — путь как есть.
 * Вверх — без прибавки к вершине полёта: взлетающему телу скорость уменьшается на набранную высоту.
 * Возвращает true, если тело сдвинуто.
 */
export function pushOut(world: World, u: Unit, box: AABB): boolean {
  const b = u.move.body;
  if (!overlaps(bodyBox(b), box, OVERLAP_EPS)) return false;
  const p = b.pos;
  const options = [
    { dx: 0, dy: box.max.y - p.y, dz: 0 },
    { dx: box.max.x + b.halfW - p.x, dy: 0, dz: 0 },
    { dx: box.min.x - b.halfW - p.x, dy: 0, dz: 0 },
    { dx: 0, dy: 0, dz: box.max.z + b.halfW - p.z },
    { dx: 0, dy: 0, dz: box.min.z - b.halfW - p.z },
  ];
  const rise = b.vel.y > 0 ? (b.vel.y * b.vel.y) / (2 * G) : 0;
  let best: (typeof options)[number] | null = null;
  let bestLen = Infinity;
  for (const o of options) {
    const len = Math.abs(o.dx) + Math.abs(o.dz) + (o.dy > 0 ? Math.max(0, o.dy - rise) : Math.abs(o.dy));
    if (len < bestLen && isFree(world, bodyBox({ ...b, pos: { x: p.x + o.dx, y: p.y + o.dy, z: p.z + o.dz } }))) {
      best = o;
      bestLen = len;
    }
  }
  if (!best) return false; // нет пути — тело остаётся: из бокса, в котором утоплено, moveBody его выпустит
  p.x += best.dx;
  p.y += best.dy;
  p.z += best.dz;
  if (best.dy > 0) {
    if (b.vel.y > 0) b.vel.y = Math.sqrt(Math.max(0, b.vel.y * b.vel.y - 2 * G * best.dy));
    u.move.onGround = b.vel.y <= 0;
  }
  return true;
}
