import {
  PLAYER_STEP,
  type AABB,
  type ArenaData,
  type ArenaVariant,
  type Collider,
  type ColliderFlags,
  type Material,
  type Pickup,
  type PickupKind,
  type RenderBox,
  type Spawn,
  type Volume,
  type VolumeKind,
} from "@doodlemagic/sim";
import { box, clipBox, copyBox, pointInBox } from "./geom";

/** Флаги noShoot / noSight — те же, что у коллайдера (ColliderFlags), и попадают в него как есть. */
export interface BoxOpts extends ColliderFlags {
  material?: Material;
  /** Есть ли коллизия (по умолчанию да). */
  collide?: boolean;
  /** Рисуется ли (по умолчанию да). */
  render?: boolean;
  tag?: string;
}

export interface SlabOpts extends BoxOpts {
  /** Толщина плиты вниз от верха, м (по умолчанию 0,5). */
  depth?: number;
}

/**
 * Проём в стене: участок [from, to] вдоль стены, открыт по высоте от sill до top над низом стены.
 * from и to — абсолютные координаты на оси стены (те же, что концы стены), а не смещения от её начала.
 */
export interface Opening {
  from: number;
  to: number;
  /** Низ проёма над низом стены (по умолчанию 0 — проём до пола). */
  sill?: number;
  /** Верх проёма над низом стены (по умолчанию — вся высота стены). */
  top?: number;
}

export interface WallOpts extends BoxOpts {
  /** Низ стены (по умолчанию 0). */
  y0?: number;
  height: number;
  thick: number;
  openings?: readonly Opening[];
}

export type StairDir = "+x" | "-x" | "+z" | "-z";

/**
 * Лестница. steps — целое ≥ 1, y1 > y0, высота ступени (y1 − y0) / steps не больше PLAYER_STEP,
 * иначе stairs() бросает Error.
 */
export interface StairsOpts extends BoxOpts {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Пол у подножия и верх последней ступени. */
  y0: number;
  y1: number;
  /** Куда лестница поднимается. */
  dir: StairDir;
  steps: number;
}

export interface ArenaBuilder {
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o?: BoxOpts): void;
  /** Плита с верхом на высоте top. */
  slab(x0: number, z0: number, x1: number, z1: number, top: number, o?: SlabOpts): void;
  /** Стена вдоль X, ось стены на z. */
  wallX(z: number, x0: number, x1: number, o: WallOpts): void;
  /** Стена вдоль Z, ось стены на x. */
  wallZ(x: number, z0: number, z1: number, o: WallOpts): void;
  /** Лестница из сплошных ступеней-блоков. */
  stairs(o: StairsOpts): void;
  volume(kind: VolumeKind, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, liftM?: number): void;
  spawn(x: number, y: number, z: number, yaw: number): void;
  pickup(kind: PickupKind, x: number, y: number, z: number): void;
  /**
   * Строит половину и её зеркальную копию относительно плоскости z = 0. Если build бросает,
   * исключение уходит наружу, а строитель возвращается в обычный (незеркальный) режим.
   */
  mirror(build: () => void): void;
  /**
   * Снимок построенного — глубокая копия: свои массивы, объекты, боксы и bounds. Дальнейшие вызовы
   * строителя его не меняют, а правка снимка не трогает ни строитель, ни следующие снимки.
   */
  finish(name: string, variant: ArenaVariant, bounds: AABB): ArenaData;
}

/** Угол в (−π, π]. Никогда не −0. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r + 0;
}

/** Глубокие копии частей арены (простые данные, без общих объектов). */
const copyCollider = (c: Collider): Collider => ({ ...c, box: copyBox(c.box) });
const copyRender = (r: RenderBox): RenderBox => ({ ...r, box: copyBox(r.box) });
const copyVolume = (v: Volume): Volume => ({ ...v, box: copyBox(v.box) });
const copySpawn = (s: Spawn): Spawn => ({ pos: { ...s.pos }, yaw: s.yaw });
const copyPickup = (p: Pickup): Pickup => ({ kind: p.kind, pos: { ...p.pos } });

/** −z без −0: зеркало не должно рождать −0, иначе арена не переживает JSON (−0 → 0). */
const negZ = (z: number): number => 0 - z;

/** Прямоугольник в координатах стены: u — вдоль оси стены, v — вверх от низа стены. */
export interface WallPiece {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Допуск сравнения рёбер. Входные числа только сравниваются и переставляются, поэтому хватает очень малого. */
const EDGE_EPS = 1e-9;
const sameEdge = (p: number, q: number): boolean => Math.abs(p - q) <= EDGE_EPS;

/**
 * Прямоугольник r минус дыра h. Если они не пересекаются по площади, r остаётся целым; иначе от него
 * остаётся до четырёх кусков: слева и справа от дыры (во всю высоту r) и под ней и над ней (в ширину
 * пересечения).
 */
function subtractHole(r: WallPiece, h: WallPiece): WallPiece[] {
  const cu0 = Math.max(r.u0, h.u0);
  const cu1 = Math.min(r.u1, h.u1);
  const cv0 = Math.max(r.v0, h.v0);
  const cv1 = Math.min(r.v1, h.v1);
  if (cu1 - cu0 <= EDGE_EPS || cv1 - cv0 <= EDGE_EPS) return [r];
  const rest: WallPiece[] = [];
  if (cu0 - r.u0 > EDGE_EPS) rest.push({ u0: r.u0, u1: cu0, v0: r.v0, v1: r.v1 });
  if (r.u1 - cu1 > EDGE_EPS) rest.push({ u0: cu1, u1: r.u1, v0: r.v0, v1: r.v1 });
  if (cv0 - r.v0 > EDGE_EPS) rest.push({ u0: cu0, u1: cu1, v0: r.v0, v1: cv0 });
  if (r.v1 - cv1 > EDGE_EPS) rest.push({ u0: cu0, u1: cu1, v0: cv1, v1: r.v1 });
  return rest;
}

/** Склейка двух кусков в один прямоугольник, если у них общее ребро целиком; иначе null. */
function joinPieces(p: WallPiece, q: WallPiece): WallPiece | null {
  if (sameEdge(p.v0, q.v0) && sameEdge(p.v1, q.v1)) {
    if (sameEdge(p.u1, q.u0)) return { u0: p.u0, u1: q.u1, v0: p.v0, v1: p.v1 };
    if (sameEdge(q.u1, p.u0)) return { u0: q.u0, u1: p.u1, v0: p.v0, v1: p.v1 };
  }
  if (sameEdge(p.u0, q.u0) && sameEdge(p.u1, q.u1)) {
    if (sameEdge(p.v1, q.v0)) return { u0: p.u0, u1: p.u1, v0: p.v0, v1: q.v1 };
    if (sameEdge(q.v1, p.v0)) return { u0: p.u0, u1: p.u1, v0: q.v0, v1: p.v1 };
  }
  return null;
}

/** Склеивает куски попарно, пока есть что склеить. Кусков у одной стены единицы, перебора хватает. */
function joinAll(pieces: readonly WallPiece[]): WallPiece[] {
  const out = [...pieces];
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const joined = joinPieces(out[i]!, out[j]!);
      if (!joined) continue;
      out[i] = joined;
      out.splice(j, 1);
      // склеенный кусок мог стать соседом уже просмотренных — начинаем проход заново
      i = -1;
      break;
    }
  }
  return out;
}

/**
 * Сплошные куски стены [a, b] × [0, height] за вычетом проёмов.
 *
 * Координаты: u — вдоль оси стены, v — вверх от низа стены. `from`/`to` проёма — АБСОЛЮТНЫЕ координаты
 * на оси стены, в той же системе, что a и b (для wallX — мировой x, для wallZ — мировой z), а не
 * смещения от начала стены. Порядок from/to не важен. Проём обрезается по стене: sill и top
 * зажимаются в [0, height], выступающая за [a, b] часть отбрасывается. Пустой после этого проём
 * (top ≤ sill или to ≤ from) пропускается.
 *
 * Построение: стена — один прямоугольник; из каждого прямоугольника по очереди вычитается каждый
 * проём (до четырёх кусков: слева, справа, снизу, сверху); затем куски с общим ребром и одинаковым
 * размахом по другой оси склеиваются, чтобы соседние окна не оставляли лишних швов.
 *
 * Результат не пересекается сам с собой, вместе с проёмами ровно покрывает стену и отсортирован
 * по u0, затем по v0.
 */
export function wallPieces(a: number, b: number, height: number, openings: readonly Opening[]): WallPiece[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo <= EDGE_EPS || height <= EDGE_EPS) return [];
  const clampV = (v: number): number => Math.min(Math.max(v, 0), height);
  let solid: WallPiece[] = [{ u0: lo, u1: hi, v0: 0, v1: height }];
  for (const op of openings) {
    const hole: WallPiece = {
      u0: Math.max(Math.min(op.from, op.to), lo),
      u1: Math.min(Math.max(op.from, op.to), hi),
      v0: clampV(op.sill ?? 0),
      v1: clampV(op.top ?? height),
    };
    if (hole.u1 - hole.u0 <= EDGE_EPS || hole.v1 - hole.v0 <= EDGE_EPS) continue;
    solid = solid.flatMap((r) => subtractHole(r, hole));
  }
  return joinAll(solid).sort((p, q) => p.u0 - q.u0 || p.v0 - q.v0);
}

export function createArenaBuilder(): ArenaBuilder {
  const colliders: Collider[] = [];
  const render: RenderBox[] = [];
  const volumes: Volume[] = [];
  const spawns: Spawn[] = [];
  const pickups: Pickup[] = [];
  let mirrored = false;
  let inMirror = false;
  /** В зеркальном проходе z меняет знак. */
  const mz = (z: number): number => (mirrored ? negZ(z) : z);

  function emit(b: AABB, o: BoxOpts = {}): void {
    const bb = mirrored ? box(b.min.x, b.min.y, negZ(b.max.z), b.max.x, b.max.y, negZ(b.min.z)) : b;
    if (o.collide !== false) {
      const c: Collider = { box: copyBox(bb) };
      if (o.noShoot) c.noShoot = true;
      if (o.noSight) c.noSight = true;
      if (o.tag) c.tag = o.tag;
      colliders.push(c);
    }
    if (o.render !== false) render.push({ box: copyBox(bb), material: o.material ?? "stone" });
  }

  const api: ArenaBuilder = {
    box(x0, y0, z0, x1, y1, z1, o) {
      emit(box(x0, y0, z0, x1, y1, z1), o);
    },
    slab(x0, z0, x1, z1, top, o = {}) {
      emit(box(x0, top - (o.depth ?? 0.5), z0, x1, top, z1), o);
    },
    wallX(z, x0, x1, o) {
      const y0 = o.y0 ?? 0;
      for (const p of wallPieces(Math.min(x0, x1), Math.max(x0, x1), o.height, o.openings ?? [])) {
        emit(box(p.u0, y0 + p.v0, z - o.thick / 2, p.u1, y0 + p.v1, z + o.thick / 2), o);
      }
    },
    wallZ(x, z0, z1, o) {
      const y0 = o.y0 ?? 0;
      for (const p of wallPieces(Math.min(z0, z1), Math.max(z0, z1), o.height, o.openings ?? [])) {
        emit(box(x - o.thick / 2, y0 + p.v0, p.u0, x + o.thick / 2, y0 + p.v1, p.u1), o);
      }
    },
    stairs(o) {
      if (!Number.isInteger(o.steps) || o.steps < 1) throw new Error(`stairs: steps must be an integer ≥ 1, got ${o.steps}`);
      if (!(o.y1 > o.y0)) throw new Error(`stairs: y1 must be above y0, got y0 = ${o.y0}, y1 = ${o.y1}`);
      const rise = (o.y1 - o.y0) / o.steps;
      if (rise > PLAYER_STEP + 1e-9) {
        throw new Error(`stairs: rise per step ${rise} m is taller than the step-up ${PLAYER_STEP} m; use more steps`);
      }
      const alongX = o.dir === "+x" || o.dir === "-x";
      const lo = alongX ? Math.min(o.x0, o.x1) : Math.min(o.z0, o.z1);
      const hi = alongX ? Math.max(o.x0, o.x1) : Math.max(o.z0, o.z1);
      const run = (hi - lo) / o.steps;
      const up = o.dir === "+x" || o.dir === "+z";
      for (let i = 0; i < o.steps; i++) {
        const a = up ? lo + i * run : hi - (i + 1) * run;
        const b = a + run;
        const top = o.y0 + (i + 1) * rise;
        const stepOpts: BoxOpts = { ...o, tag: o.tag ?? "stairs" };
        if (alongX) emit(box(a, o.y0, o.z0, b, top, o.z1), stepOpts);
        else emit(box(o.x0, o.y0, a, o.x1, top, b), stepOpts);
      }
    },
    volume(kind, x0, y0, z0, x1, y1, z1, liftM) {
      const b = box(x0, y0, mz(z0), x1, y1, mz(z1));
      volumes.push(liftM === undefined ? { kind, box: b } : { kind, box: b, liftM });
    },
    spawn(x, y, z, yaw) {
      spawns.push({ pos: { x, y, z: mz(z) }, yaw: wrapAngle(mirrored ? Math.PI - yaw : yaw) });
    },
    pickup(kind, x, y, z) {
      pickups.push({ kind, pos: { x, y, z: mz(z) } });
    },
    mirror(build) {
      if (inMirror) throw new Error("mirror() cannot be nested");
      inMirror = true;
      try {
        build();
        mirrored = true;
        build();
      } finally {
        mirrored = false;
        inMirror = false;
      }
    },
    finish(name, variant, bounds) {
      return {
        name,
        variant,
        bounds: copyBox(bounds),
        colliders: colliders.map(copyCollider),
        volumes: volumes.map(copyVolume),
        render: render.map(copyRender),
        spawns: spawns.map(copySpawn),
        pickups: pickups.map(copyPickup),
      };
    },
  };
  return api;
}

/**
 * Обрезает арену по боксу: что вне него, пропадает (так собирается компактный вариант).
 * Результат ни с чем не делит объекты: боксы, спауны, подборы и bounds — копии.
 */
export function clipArena(a: ArenaData, bounds: AABB, variant: ArenaVariant): ArenaData {
  const colliders: Collider[] = [];
  for (const c of a.colliders) {
    const b = clipBox(c.box, bounds);
    if (b) colliders.push({ ...c, box: b });
  }
  const render: RenderBox[] = [];
  for (const r of a.render) {
    const b = clipBox(r.box, bounds);
    if (b) render.push({ ...r, box: b });
  }
  const volumes: Volume[] = [];
  for (const v of a.volumes) {
    const b = clipBox(v.box, bounds);
    if (b) volumes.push({ ...v, box: b });
  }
  return {
    name: a.name,
    variant,
    bounds: copyBox(bounds),
    colliders,
    render,
    volumes,
    spawns: a.spawns.filter((s) => pointInBox(bounds, s.pos)).map(copySpawn),
    pickups: a.pickups.filter((p) => pointInBox(bounds, p.pos)).map(copyPickup),
  };
}
