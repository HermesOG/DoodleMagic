import type { AABB, RenderBox } from "@doodlemagic/sim";
import { inkOf } from "./palette";

/** Сырые массивы для BufferGeometry: без three.js, поэтому проверяются тестами. */
export interface BoxArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * Грани бокса: нормаль и четыре угла против часовой стрелки, если смотреть снаружи.
 * Угол задан выбором min (0) или max (1) по каждой оси.
 */
const FACES: readonly { n: readonly [number, number, number]; c: readonly (readonly [0 | 1, 0 | 1, 0 | 1])[] }[] = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/** Все боксы одним мешем: 24 вершины и 36 индексов на бокс, нормали плоские — острые рёбра дают контур. */
export function buildBoxArrays(boxes: readonly AABB[]): BoxArrays {
  const positions = new Float32Array(boxes.length * 24 * 3);
  const normals = new Float32Array(boxes.length * 24 * 3);
  const indices = new Uint32Array(boxes.length * 36);
  let v = 0;
  let i = 0;
  for (const b of boxes) {
    for (const face of FACES) {
      const base = v;
      for (const [cx, cy, cz] of face.c) {
        positions[v * 3] = cx ? b.max.x : b.min.x;
        positions[v * 3 + 1] = cy ? b.max.y : b.min.y;
        positions[v * 3 + 2] = cz ? b.max.z : b.min.z;
        normals[v * 3] = face.n[0];
        normals[v * 3 + 1] = face.n[1];
        normals[v * 3 + 2] = face.n[2];
        v++;
      }
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i);
      i += 6;
    }
  }
  return { positions, normals, indices };
}

/** Боксы арены по номерам чернил: одна корзина — один draw call. Корзины по возрастанию номера (числом), порядок отрисовки один и тот же. */
export function groupByInk(render: readonly RenderBox[]): Map<number, AABB[]> {
  const byInk = new Map<number, AABB[]>();
  for (const r of render) {
    const ink = inkOf(r.material);
    const list = byInk.get(ink);
    if (list) list.push(r.box);
    else byInk.set(ink, [r.box]);
  }
  return new Map([...byInk].sort((a, b) => a[0] - b[0]));
}
