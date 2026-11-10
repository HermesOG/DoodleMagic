import { raycast } from "../raycast";
import { PLAYER_STEP, type AABB, type Vec3 } from "../types";
import { colliderAt, isFree, overlapping, volumeAt, type World } from "../world";

/**
 * Навигация ботов (Р9, Р10): сетка проходимости по XZ с уровнями. Строится один раз из статических коллайдеров арены,
 * без ручных точек и тегов: новая арена подхватывается сама. После buildNav сетку никто не меняет (только чтение).
 */

export const NAV_CELL_M = 0.5;
/** Виды рёбер: шаг (перепад до PLAYER_STEP), прыжок (вверх до 1,1 м), спуск (вниз до 6 м, одностороннее). */
export const NAV_WALK = 0;
export const NAV_JUMP = 1;
export const NAV_DROP = 2;

/** Тело сетки: 0,6 × 1,8 м (полуширина 0,3), на 0,01 м над опорой. */
const BODY_HALF_W = 0.3;
const BODY_H = 1.8;
const LIFT_M = 0.01;
/** Сетка шире мира на столько с каждой стороны: за краем мира — пропасть. */
const MARGIN_M = 2;
const MAX_LEVELS = 8;
const JUMP_UP_M = 1.1;
const DROP_DOWN_M = 6;
/** Узел «под ногами» — не выше ступней на столько (ступени, подъём на шаг). */
const FEET_TOL_M = 0.6;
/** navNode ищет ближайший узел не дальше, м. */
const NEAR_M = 1;
/** Цена ребра (A*): длина, прыжок +0,6 м, спуск +0,3 м; ближе 1,5 м к кромке — ×3, ближе 0,5 м — запрет (Р9). */
const JUMP_COST_M = 0.6;
const DROP_COST_M = 0.3;
const EDGE_NEAR_M = 1.5;
const EDGE_MUL = 3;
const EDGE_BAN_M = 0.5;
/** Прыжок и спуск — только туда, где до кромки не меньше этого (Р9: приземление с запасом). */
const LANDING_M = 1.5;
const MAX_EXPAND = 8000;
const SQRT2 = Math.SQRT2;
const DOWN: Vec3 = Object.freeze({ x: 0, y: -1, z: 0 }) as Vec3;

/**
 * Сетка проходимости (только чтение после buildNav). Колонки cols × rows по XZ, в колонке — уровни (узлы) по
 * возрастанию высоты; рёбра в CSR; voidM — расстояние по графу до кромки пропасти, м (Infinity — кромки нет).
 */
export interface NavGrid {
  readonly cellM: number;
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  /** Узлы колонки c — с colStart[c] до colStart[c + 1]. */
  readonly colStart: Int32Array;
  readonly nodeY: Float32Array;
  readonly nodeCol: Int32Array;
  /** Рёбра узла n — с edgeStart[n] до edgeStart[n + 1]. */
  readonly edgeStart: Int32Array;
  readonly edgeTo: Int32Array;
  readonly edgeKind: Uint8Array;
  readonly voidM: Float32Array;
  /** Колонка-пропасть: луч сверху до killBelowY не нашёл опоры вне объёма kill. */
  readonly colVoid: Uint8Array;
  /** Ближайшая по графу точка пропасти (середина колонки за кромкой); NaN — кромки нет. */
  readonly voidX: Float32Array;
  readonly voidZ: Float32Array;
  /** 1 — узел главной области (самая большая сильно связная компонента): туда можно дойти и оттуда уйти. */
  readonly nodeMain: Uint8Array;
}

const bodyAt = (x: number, y: number, z: number): AABB => ({
  min: { x: x - BODY_HALF_W, y: y + LIFT_M, z: z - BODY_HALF_W },
  max: { x: x + BODY_HALF_W, y: y + LIFT_M + BODY_H, z: z + BODY_HALF_W },
});

/** Мини-куча по ключу (A*, Дейкстра): локальная, у каждого вызова своя. */
interface Heap { keys: number[]; vals: number[] }
function heapPush(h: Heap, key: number, val: number): void {
  const k = h.keys;
  const v = h.vals;
  let i = k.length;
  k.push(key);
  v.push(val);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (k[p]! <= key) break;
    k[i] = k[p]!;
    v[i] = v[p]!;
    i = p;
  }
  k[i] = key;
  v[i] = val;
}
/** Снять минимум: значение; ключ — в h.top. Куча не пуста. */
function heapPop(h: Heap): number {
  const k = h.keys;
  const v = h.vals;
  const top = v[0]!;
  const lk = k.pop()!;
  const lv = v.pop()!;
  const n = k.length;
  if (n > 0) {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && k[r]! < k[l]! ? r : l;
      if (k[c]! >= lk) break;
      k[i] = k[c]!;
      v[i] = v[c]!;
      i = c;
    }
    k[i] = lk;
    v[i] = lv;
  }
  return top;
}

/** 8 соседей: сначала прямые (+x, −x, +z, −z), затем диагонали; у диагонали — номера её прямых соседей. */
const DIRS: readonly (readonly [number, number, number, number])[] = Object.freeze([
  [1, 0, -1, -1], [-1, 0, -1, -1], [0, 1, -1, -1], [0, -1, -1, -1],
  [1, 1, 0, 2], [1, -1, 0, 3], [-1, 1, 1, 2], [-1, -1, 1, 3],
]);

/**
 * Сетка по статическому миру. Колонки 0,5 м покрывают сетку мира плюс 2 м с каждой стороны; их середины — на кратных
 * 0,5 м. Поверхности колонки — сверху вниз лучом "move" по середине колонки (верх бокса; следующий луч — от низа бокса
 * − 0,01), не больше 8 уровней; тело, задевшее рядом бокс не выше ступеньки, стоит на нём (край ступени посреди колонки).
 * Узел — если тело 0,6 × 1,8 м свободно на 0,01 м выше и не в объёме kill. Рёбра — к 8 соседним колонкам, к каждой одно
 * лучшее (шаг, иначе прыжок, иначе спуск); диагональ — только если оба прямых соседа проходимы шагом.
 * Кромка: узел, из которого можно шагнуть (тело свободно над соседней колонкой на высоте узла) туда, где луч вниз до
 * killBelowY не находит опоры вне kill. Стены и перила кромкой не считаются. Расстояние от узла кромки до края опоры —
 * двоичным поиском лучом вниз; voidM — Дейкстра от узлов кромки по шагам и спускам в их сторону: сколько пройти до
 * кромки. Прыжки в voidM не входят — их бот делает сам, а не по ошибке; так галерея за высоким парапетом над ущельем
 * не «у кромки». nodeMain — главная область (см. mainComponent).
 */
export function buildNav(world: World, killBelowY: number): NavGrid {
  const cell = NAV_CELL_M;
  // середины колонок — на кратных 0,5 м: стены арены стоят на той же сетке, и проход 1 м между ними проходим
  const x0 = Math.floor((world.x0 - MARGIN_M) / cell) * cell - cell / 2;
  const z0 = Math.floor((world.z0 - MARGIN_M) / cell) * cell - cell / 2;
  const cols = Math.ceil((world.x0 + world.cols * world.cell + MARGIN_M - x0) / cell - 1e-9);
  const rows = Math.ceil((world.z0 + world.rows * world.cell + MARGIN_M - z0) / cell - 1e-9);
  let top = killBelowY;
  for (const c of world.colliders) top = Math.max(top, c.box.max.y);
  top += 1;
  const ncol = cols * rows;
  const colStart = new Int32Array(ncol + 1);
  const colVoid = new Uint8Array(ncol);
  const ys: number[] = [];
  const nc: number[] = [];
  const levels: number[] = [];
  const cxOf = (i: number): number => x0 + (i + 0.5) * cell;
  const czOf = (j: number): number => z0 + (j + 0.5) * cell;
  const probeIds: number[] = [];
  /**
   * Высота, на которой тело стоит над поверхностью y: след тела задевает бокс с верхом не выше ступеньки — тело на нём
   * (так moveBody заходит на ступень). Без этого край ступени посреди колонки рвал бы сетку: лестница, выход изо рва.
   */
  const standY = (cx: number, y: number, cz: number): number => {
    let sy = y;
    for (let k = 0; k < 4; k++) {
      const probe: AABB = { min: { x: cx - BODY_HALF_W, y: sy + 1e-4, z: cz - BODY_HALF_W }, max: { x: cx + BODY_HALF_W, y: sy + PLAYER_STEP, z: cz + BODY_HALF_W } };
      let t = sy;
      for (const id of overlapping(world, probe, probeIds)) {
        const top = world.colliders[id]!.box.max.y;
        if (top > t && top <= sy + PLAYER_STEP + 1e-9) t = top;
      }
      if (t <= sy) break;
      sy = t;
    }
    return sy;
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = j * cols + i;
      colStart[c] = ys.length;
      const cx = cxOf(i);
      const cz = czOf(j);
      levels.length = 0;
      let support = false;
      let y = top;
      for (let guard = 0; guard < 64 && levels.length < MAX_LEVELS && y > killBelowY; guard++) {
        const hit = raycast(world, { x: cx, y, z: cz }, DOWN, y - killBelowY, "move");
        if (!hit) break;
        const box = colliderAt(world, hit.collider).box;
        if (hit.normal.y === 1) {
          let sy = box.max.y;
          let body = bodyAt(cx, sy, cz);
          if (volumeAt(world, body, "kill") === null) {
            support = true;
            let free = isFree(world, body);
            if (!free) {
              sy = standY(cx, sy, cz);
              body = bodyAt(cx, sy, cz);
              free = isFree(world, body) && volumeAt(world, body, "kill") === null;
            }
            if (free && !levels.some((l) => Math.abs(l - sy) < 1e-6)) levels.push(sy);
          }
        }
        y = box.min.y - 0.01;
      }
      colVoid[c] = support ? 0 : 1;
      levels.sort((a, b) => b - a);
      for (let k = levels.length - 1; k >= 0; k--) {
        ys.push(levels[k]!);
        nc.push(c);
      }
    }
  }
  colStart[ncol] = ys.length;
  const n = ys.length;
  const nodeY = Float32Array.from(ys);
  const nodeCol = Int32Array.from(nc);

  // рёбра
  const eTo: number[] = [];
  const eKind: number[] = [];
  const edgeStart = new Int32Array(n + 1);
  const voidD = new Float64Array(n).fill(Infinity);
  const vX = new Float64Array(n).fill(NaN);
  const vZ = new Float64Array(n).fill(NaN);
  const toCol: number[] = [-1, -1, -1, -1, -1, -1, -1, -1];
  const walkDir: boolean[] = [false, false, false, false];
  const freeDir: boolean[] = [false, false, false, false];

  /** Лучшее ребро из узла a (колонка i, j, высота y) в колонку (ii, jj); −1 — нет. Вид — в kindOut[0]. */
  const kindOut = [0];
  const bestEdge = (i: number, j: number, y: number, ii: number, jj: number): number => {
    if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) return -1;
    const c2 = jj * cols + ii;
    let walk = -1;
    let walkD = Infinity;
    let jump = -1;
    let jumpD = Infinity;
    let drop = -1;
    let dropD = Infinity;
    for (let b = colStart[c2]!; b < colStart[c2 + 1]!; b++) {
      const dy = nodeY[b]! - y;
      if (Math.abs(dy) <= PLAYER_STEP) {
        if (Math.abs(dy) < walkD) {
          walk = b;
          walkD = Math.abs(dy);
        }
      } else if (dy > 0 && dy <= JUMP_UP_M) {
        if (dy < jumpD && isFree(world, bodyAt(cxOf(i), nodeY[b]!, czOf(j)))) {
          jump = b;
          jumpD = dy;
        }
      } else if (dy < 0 && dy >= -DROP_DOWN_M) {
        if (-dy < dropD && isFree(world, bodyAt(cxOf(ii), y, czOf(jj)))) {
          drop = b;
          dropD = -dy;
        }
      }
    }
    if (walk >= 0) {
      kindOut[0] = NAV_WALK;
      return walk;
    }
    if (jump >= 0) {
      kindOut[0] = NAV_JUMP;
      return jump;
    }
    kindOut[0] = NAV_DROP;
    return drop;
  };

  for (let a = 0; a < n; a++) {
    edgeStart[a] = eTo.length;
    const c = nodeCol[a]!;
    const i = c % cols;
    const j = (c - i) / cols;
    const y = ys[a]!;
    for (let d = 0; d < 8; d++) {
      const dir = DIRS[d]!;
      toCol[d] = -1;
      if (d >= 4 && !(walkDir[dir[2]]! && walkDir[dir[3]]!)) continue;
      const b = bestEdge(i, j, y, i + dir[0], j + dir[1]);
      if (d < 4) walkDir[d] = b >= 0 && kindOut[0] === NAV_WALK;
      if (b < 0) continue;
      toCol[d] = b;
      eTo.push(b);
      eKind.push(kindOut[0]!);
    }
    // кромка: шаг туда, где нет ребра, тело свободно и под ним нет опоры вне kill
    for (let d = 0; d < 8; d++) {
      const dir = DIRS[d]!;
      // есть ребро — туда не провалиться; прямой сосед с ребром проходим и для диагонали
      if (toCol[d]! >= 0) {
        if (d < 4) freeDir[d] = true;
        continue;
      }
      if (d >= 4 && !(freeDir[dir[2]]! && freeDir[dir[3]]!)) continue;
      const ii = i + dir[0];
      const jj = j + dir[1];
      const out = ii < 0 || jj < 0 || ii >= cols || jj >= rows;
      const free = out || isFree(world, bodyAt(cxOf(ii), y, czOf(jj)));
      if (d < 4) freeDir[d] = free;
      if (!free) continue;
      let isVoid = out;
      if (!out) {
        const px = cxOf(ii);
        const pz = czOf(jj);
        const from = { x: px, y: y + LIFT_M, z: pz };
        const hit = raycast(world, from, DOWN, from.y - killBelowY, "move");
        if (!hit) isVoid = true;
        else {
          const sy = hit.normal.y === 1 ? colliderAt(world, hit.collider).box.max.y : hit.point.y;
          isVoid = volumeAt(world, bodyAt(px, sy, pz), "kill") !== null;
        }
      }
      if (!isVoid) continue;
      // край опоры между серединой узла и пропастью — двоичным поиском лучом вниз (опора не глубже шага)
      const k = d < 4 ? 1 : SQRT2;
      const ux = dir[0] / k;
      const uz = dir[1] / k;
      let lo = 0;
      let hi = k * cell;
      for (let it = 0; it < 6; it++) {
        const t = (lo + hi) / 2;
        const q = { x: cxOf(i) + ux * t, y: y + LIFT_M, z: czOf(j) + uz * t };
        if (raycast(world, q, DOWN, PLAYER_STEP + LIFT_M, "move")) lo = t;
        else hi = t;
      }
      const dist = (lo + hi) / 2;
      if (dist < voidD[a]!) {
        voidD[a] = dist;
        vX[a] = cxOf(ii);
        vZ[a] = czOf(jj);
      }
    }
  }
  edgeStart[n] = eTo.length;
  const edgeTo = Int32Array.from(eTo);
  const edgeKind = Uint8Array.from(eKind);

  // voidM: Дейкстра от узлов кромки по обратным шагам и спускам
  const rCount = new Int32Array(n + 1);
  for (let e = 0; e < edgeTo.length; e++) if (edgeKind[e] !== NAV_JUMP) rCount[edgeTo[e]! + 1]! += 1;
  for (let k = 0; k < n; k++) rCount[k + 1]! += rCount[k]!;
  const rFrom = new Int32Array(rCount[n]!);
  const fill = rCount.slice(0, n);
  for (let a = 0; a < n; a++) {
    for (let e = edgeStart[a]!; e < edgeStart[a + 1]!; e++) {
      if (edgeKind[e] === NAV_JUMP) continue;
      const b = edgeTo[e]!;
      rFrom[fill[b]!++] = a;
    }
  }
  const heap: Heap = { keys: [], vals: [] };
  for (let a = 0; a < n; a++) if (voidD[a]! < Infinity) heapPush(heap, voidD[a]!, a);
  while (heap.keys.length > 0) {
    const d0 = heap.keys[0]!;
    const v = heapPop(heap);
    if (d0 > voidD[v]!) continue;
    const cv = nodeCol[v]!;
    for (let k = rCount[v]!; k < rCount[v + 1]!; k++) {
      const a = rFrom[k]!;
      const ca = nodeCol[a]!;
      const diag = ca % cols !== cv % cols && Math.floor(ca / cols) !== Math.floor(cv / cols);
      const nd = d0 + (diag ? SQRT2 : 1) * cell;
      if (nd < voidD[a]!) {
        voidD[a] = nd;
        vX[a] = vX[v]!;
        vZ[a] = vZ[v]!;
        heapPush(heap, nd, a);
      }
    }
  }

  return {
    cellM: cell, x0, z0, cols, rows, colStart, nodeY, nodeCol, edgeStart, edgeTo, edgeKind,
    voidM: Float32Array.from(voidD), colVoid, voidX: Float32Array.from(vX), voidZ: Float32Array.from(vZ),
    nodeMain: mainComponent(n, edgeStart, edgeTo),
  };
}

/**
 * Главная область сетки: самая большая сильно связная компонента (из любого её узла дойти до любого другого, с прыжками).
 * Крыши келий, вершины стел и валунов, верх стен в неё не входят: туда не зайти, только спрыгнуть. Тарьян без рекурсии.
 */
function mainComponent(n: number, edgeStart: Int32Array, edgeTo: Int32Array): Uint8Array {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const callV: number[] = [];
  const callE: number[] = [];
  let next = 0;
  let best: number[] = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (index[s0]! >= 0) continue;
    index[s0] = low[s0] = next++;
    stack.push(s0);
    onStack[s0] = 1;
    callV.push(s0);
    callE.push(edgeStart[s0]!);
    while (callV.length > 0) {
      const top = callV.length - 1;
      const v = callV[top]!;
      const e = callE[top]!;
      if (e < edgeStart[v + 1]!) {
        callE[top] = e + 1;
        const w = edgeTo[e]!;
        if (index[w]! < 0) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = 1;
          callV.push(w);
          callE.push(edgeStart[w]!);
        } else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
        continue;
      }
      callV.pop();
      callE.pop();
      if (callV.length > 0) {
        const u = callV[callV.length - 1]!;
        low[u] = Math.min(low[u]!, low[v]!);
      }
      if (low[v] !== index[v]) continue;
      const comp: number[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack[w] = 0;
        comp.push(w);
        if (w === v) break;
      }
      if (comp.length > best.length) best = comp;
    }
  }
  const main = new Uint8Array(n);
  for (const v of best) main[v] = 1;
  return main;
}

/** Номер колонки точки или −1 — вне сетки. */
export function navColumn(nav: NavGrid, x: number, z: number): number {
  const i = Math.floor((x - nav.x0) / nav.cellM);
  const j = Math.floor((z - nav.z0) / nav.cellM);
  if (!(i >= 0 && j >= 0 && i < nav.cols && j < nav.rows)) return -1;
  return j * nav.cols + i;
}

/** Узел колонки c под высотой y: самый высокий не выше y + FEET_TOL_M; −1 — нет. */
function nodeUnder(nav: NavGrid, c: number, y: number): number {
  for (let b = nav.colStart[c + 1]! - 1; b >= nav.colStart[c]!; b--) if (nav.nodeY[b]! <= y + FEET_TOL_M) return b;
  return -1;
}

/** Узел колонки точки (x, z) под высотой y — самый высокий не выше y + 0,6 м; −1 — нет или вне сетки. */
export function columnNode(nav: NavGrid, x: number, z: number, y: number): number {
  const c = navColumn(nav, x, z);
  return c < 0 ? -1 : nodeUnder(nav, c, y);
}

/**
 * Ближайший по XZ узел не выше ступней (и не глубже 10 м под ними), у которого до кромки не меньше minVoidM, в радиусе rM:
 * кольцами колонок от точки, первое кольцо с находкой и следующее. Куда править полёт над пустотой; −1 — нет.
 */
export function nearestSafe(nav: NavGrid, pos: Vec3, rM: number, minVoidM: number): number {
  const cell = nav.cellM;
  const i0 = Math.floor((pos.x - nav.x0) / cell);
  const j0 = Math.floor((pos.z - nav.z0) / cell);
  const rr = Math.ceil(rM / cell);
  let best = -1;
  let bestD = rM * rM;
  let stopAt = rr;
  for (let r = 0; r <= stopAt; r++) {
    for (let dj = -r; dj <= r; dj++) {
      const edge = Math.abs(dj) === r;
      for (let di = -r; di <= r; di += edge ? 1 : 2 * r) {
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= nav.cols || j >= nav.rows) {
          if (r === 0) break;
          continue;
        }
        const dx = nav.x0 + (i + 0.5) * cell - pos.x;
        const dz = nav.z0 + (j + 0.5) * cell - pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= bestD) {
          if (r === 0) break;
          continue;
        }
        const c = j * nav.cols + i;
        for (let b = nav.colStart[c + 1]! - 1; b >= nav.colStart[c]!; b--) {
          const y = nav.nodeY[b]!;
          if (y > pos.y + FEET_TOL_M) continue;
          if (y < pos.y - 10) break;
          if (nav.voidM[b]! < minVoidM) continue;
          best = b;
          bestD = d2;
          break;
        }
        if (r === 0) break;
      }
    }
    if (best >= 0 && stopAt === rr) stopAt = Math.min(rr, r + 1);
  }
  return best;
}

/** Узел под ногами в своей колонке, иначе ближайший по XZ не дальше 1 м (тоже не выше ступней); −1 — нет. */
export function navNode(nav: NavGrid, pos: Vec3): number {
  const c = navColumn(nav, pos.x, pos.z);
  if (c >= 0) {
    const b = nodeUnder(nav, c, pos.y);
    if (b >= 0) return b;
  }
  const cell = nav.cellM;
  const r = Math.ceil(NEAR_M / cell);
  const i0 = Math.floor((pos.x - nav.x0) / cell);
  const j0 = Math.floor((pos.z - nav.z0) / cell);
  let best = -1;
  let bestD = Infinity;
  for (let dj = -r; dj <= r; dj++) {
    const j = j0 + dj;
    if (j < 0 || j >= nav.rows) continue;
    for (let di = -r; di <= r; di++) {
      const i = i0 + di;
      if (i < 0 || i >= nav.cols || (di === 0 && dj === 0)) continue;
      const dx = nav.x0 + (i + 0.5) * cell - pos.x;
      const dz = nav.z0 + (j + 0.5) * cell - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > NEAR_M * NEAR_M || d2 >= bestD) continue;
      const b = nodeUnder(nav, j * nav.cols + i, pos.y);
      if (b < 0) continue;
      best = b;
      bestD = d2;
    }
  }
  return best;
}

export function nodePos(nav: NavGrid, n: number): Vec3 {
  const c = nav.nodeCol[n]!;
  const i = c % nav.cols;
  const j = (c - i) / nav.cols;
  return { x: nav.x0 + (i + 0.5) * nav.cellM, y: nav.nodeY[n]!, z: nav.z0 + (j + 0.5) * nav.cellM };
}

/** XZ-расстояние между серединами колонок узлов. */
function colDist(nav: NavGrid, a: number, b: number): number {
  const ca = nav.nodeCol[a]!;
  const cb = nav.nodeCol[b]!;
  const dx = (ca % nav.cols) - (cb % nav.cols);
  const dz = Math.floor(ca / nav.cols) - Math.floor(cb / nav.cols);
  return Math.sqrt(dx * dx + dz * dz) * nav.cellM;
}

/** Можно ли пройти в узел b по ребру вида kind (Р9): кромка ближе 0,5 м — нет; прыжок и спуск — с запасом 1,5 м. */
function allowed(nav: NavGrid, b: number, kind: number): boolean {
  const v = nav.voidM[b]!;
  return v >= EDGE_BAN_M && (kind === NAV_WALK || v >= LANDING_M);
}

/**
 * A* от узла from до узла to; путь — узлы от from до to включительно, null — нет пути (или больше 8000 раскрытий).
 * Цена ребра — длина по XZ, прыжок +0,6 м, спуск +0,3 м; узел ближе 1,5 м к кромке — ×3, ближе 0,5 м — запрет,
 * прыжок и спуск — только туда, где до кромки не меньше 1,5 м. cost(n) — прибавка за узел (Infinity — запрет).
 */
export function findPath(nav: NavGrid, from: number, to: number, cost?: (n: number) => number): number[] | null {
  const n = nav.nodeY.length;
  if (!(from >= 0 && from < n && to >= 0 && to < n)) return null;
  if (from === to) return [from];
  if (!(nav.voidM[to]! >= EDGE_BAN_M) || (cost && !(cost(to) < Infinity))) return null;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap: Heap = { keys: [], vals: [] };
  g[from] = 0;
  heapPush(heap, colDist(nav, from, to), from);
  let expanded = 0;
  while (heap.keys.length > 0) {
    const a = heapPop(heap);
    if (closed[a]) continue;
    closed[a] = 1;
    if (a === to) {
      const path: number[] = [];
      for (let k = to; k >= 0; k = parent[k]!) path.push(k);
      return path.reverse();
    }
    if (++expanded > MAX_EXPAND) return null;
    const ga = g[a]!;
    for (let e = nav.edgeStart[a]!; e < nav.edgeStart[a + 1]!; e++) {
      const b = nav.edgeTo[e]!;
      if (closed[b]) continue;
      const kind = nav.edgeKind[e]!;
      if (!allowed(nav, b, kind)) continue;
      let c = colDist(nav, a, b) + (kind === NAV_JUMP ? JUMP_COST_M : kind === NAV_DROP ? DROP_COST_M : 0);
      if (nav.voidM[b]! < EDGE_NEAR_M) c *= EDGE_MUL;
      if (cost) {
        const x = cost(b);
        if (!(x < Infinity)) continue;
        c += x;
      }
      const ng = ga + c;
      if (ng < g[b]!) {
        g[b] = ng;
        parent[b] = a;
        heapPush(heap, ng + colDist(nav, b, to), b);
      }
    }
  }
  return null;
}

/**
 * Сколько до кромки от точки, м: узел под ногами — его voidM; нет узла и колонка — пропасть (или вне сетки) — 0;
 * иначе ближайший узел в 1 м; ничего — 0 (в сомнении — край).
 */
export function voidDistM(nav: NavGrid, pos: Vec3): number {
  const c = navColumn(nav, pos.x, pos.z);
  if (c < 0) return 0;
  const b = nodeUnder(nav, c, pos.y);
  if (b >= 0) return nav.voidM[b]!;
  if (nav.colVoid[c]) return 0;
  const near = navNode(nav, pos);
  return near >= 0 ? nav.voidM[near]! : 0;
}

/**
 * Куда ближе к кромке (для сброса и ухода): единичный XZ от точки к ближайшей по графу точке пропасти. Над пропастью —
 * к ближайшему узлу пола в 6 м (туда же «ближе к кромке» с той стороны). null — кромки нет или точка уже там.
 */
export function voidDir(nav: NavGrid, pos: Vec3): { x: number; z: number } | null {
  const c = navColumn(nav, pos.x, pos.z);
  const under = c >= 0 ? nodeUnder(nav, c, pos.y) : -1;
  const overVoid = under < 0 && (c < 0 || nav.colVoid[c] === 1);
  const b = overVoid ? -1 : under >= 0 ? under : navNode(nav, pos);
  let tx: number;
  let tz: number;
  if (b >= 0) {
    tx = nav.voidX[b]!;
    tz = nav.voidZ[b]!;
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) return null;
  } else {
    const f = nearestFloor(nav, pos, 6);
    if (f < 0) return null;
    const p = nodePos(nav, f);
    tx = p.x;
    tz = p.z;
  }
  const dx = tx - pos.x;
  const dz = tz - pos.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  return l < 1e-6 ? null : { x: dx / l + 0, z: dz / l + 0 };
}

/** Ближайший по XZ узел не выше ступней в радиусе rM (кольцами колонок); −1 — нет. */
export function nearestFloor(nav: NavGrid, pos: Vec3, rM: number): number {
  const cell = nav.cellM;
  const i0 = Math.floor((pos.x - nav.x0) / cell);
  const j0 = Math.floor((pos.z - nav.z0) / cell);
  const rr = Math.ceil(rM / cell);
  let best = -1;
  let bestD = rM * rM;
  for (let r = 0; r <= rr; r++) {
    if (best >= 0 && (r - 1) * cell > Math.sqrt(bestD)) break;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= nav.cols || j >= nav.rows) continue;
        const dx = nav.x0 + (i + 0.5) * cell - pos.x;
        const dz = nav.z0 + (j + 0.5) * cell - pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > bestD) continue;
        const b = nodeUnder(nav, j * nav.cols + i, pos.y);
        if (b < 0) continue;
        best = b;
        bestD = d2;
      }
    }
  }
  return best;
}

/**
 * Узел для цели пути у точки: узел под ногами или ближайший в rM, у которого до кромки не меньше minVoidM и перепад
 * с точкой не больше 1,5 м (mainOnly — только из главной области); −1 — нет. Так путь к цели у самой кромки или на
 * вершине стелы ведёт на безопасный достижимый узел рядом.
 */
export function safeNodeNear(nav: NavGrid, pos: Vec3, rM: number, minVoidM: number, mainOnly = false): number {
  const cell = nav.cellM;
  const i0 = Math.floor((pos.x - nav.x0) / cell);
  const j0 = Math.floor((pos.z - nav.z0) / cell);
  const rr = Math.ceil(rM / cell);
  let best = -1;
  let bestD = Infinity;
  for (let dj = -rr; dj <= rr; dj++) {
    for (let di = -rr; di <= rr; di++) {
      const i = i0 + di;
      const j = j0 + dj;
      if (i < 0 || j < 0 || i >= nav.cols || j >= nav.rows) continue;
      const dx = nav.x0 + (i + 0.5) * cell - pos.x;
      const dz = nav.z0 + (j + 0.5) * cell - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > rM * rM) continue;
      const c = j * nav.cols + i;
      for (let b = nav.colStart[c]!; b < nav.colStart[c + 1]!; b++) {
        const dy = nav.nodeY[b]! - pos.y;
        if (dy > FEET_TOL_M || dy < -1.5 || nav.voidM[b]! < minVoidM || (mainOnly && !nav.nodeMain[b])) continue;
        const score = d2 + dy * dy;
        if (score < bestD) {
          best = b;
          bestD = score;
        }
      }
    }
  }
  return best;
}

/**
 * Рывок или Взмах на distM по dir из pos (Р9): в точке приземления до кромки не меньше 1,5 м, по пути через каждые 0,5 м —
 * не над пропастью. Для кита (задача 2): фильтр края ход на тике нажатия не трогает.
 */
export function dashLandingOk(nav: NavGrid, pos: Vec3, dir: { x: number; z: number }, distM: number): boolean {
  const n = Math.max(1, Math.ceil(distM / 0.5));
  for (let k = 1; k <= n; k++) {
    const t = (distM * k) / n;
    const v = voidDistM(nav, { x: pos.x + dir.x * t, y: pos.y, z: pos.z + dir.z * t });
    if (k === n ? v < LANDING_M : v <= 0) return false;
  }
  return true;
}

/** Вид ребра a → b или −1 — ребра нет. */
export function edgeKindOf(nav: NavGrid, a: number, b: number): number {
  for (let e = nav.edgeStart[a]!; e < nav.edgeStart[a + 1]!; e++) if (nav.edgeTo[e] === b) return nav.edgeKind[e]!;
  return -1;
}
