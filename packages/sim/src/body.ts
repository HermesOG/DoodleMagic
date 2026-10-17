import type { AABB, Body, MoveResult } from "./types";
import { colliderAt, overlapping, type World } from "./world";

export const MAX_SUBSTEPS = 8;
/** Насколько глубоко ниже подошвы ищем опору, чтобы считать тело стоящим, м. */
export const GROUND_PROBE_M = 0.02;
/**
 * Бокс считается «впереди», если его грань не дальше этого от тела до сдвига, м. Бокс, в который тело утоплено
 * глубже, движение не держит: из него можно выйти, но в нём же можно и провалиться.
 */
const AHEAD_TOL = 1e-4;

export function bodyBox(b: Body): AABB {
  return {
    min: { x: b.pos.x - b.halfW, y: b.pos.y, z: b.pos.z - b.halfW },
    max: { x: b.pos.x + b.halfW, y: b.pos.y + b.height, z: b.pos.z + b.halfW },
  };
}

// Общий буфер для overlapping: очищается при каждом вызове; moveBody нельзя вызывать изнутри цикла по overlapping.
const scratch: number[] = [];

/**
 * Сдвиг по одной оси с упором в первый бокс на пути. Учитываются только боксы, которые до сдвига были
 * впереди: из бокса, в котором тело уже застряло, можно выйти. Возвращает true, если упёрлись.
 */
function sweepAxis(w: World, b: Body, axis: "x" | "y" | "z", d: number): boolean {
  if (d === 0) return false;
  const lo = axis === "y" ? 0 : b.halfW;
  const hi = axis === "y" ? b.height : b.halfW;
  const beforeMin = b.pos[axis] - lo;
  const beforeMax = b.pos[axis] + hi;
  b.pos[axis] += d;
  let limit = b.pos[axis];
  let blocked = false;
  for (const idx of overlapping(w, bodyBox(b), scratch)) {
    const box = colliderAt(w, idx).box;
    if (d > 0 && box.min[axis] >= beforeMax - AHEAD_TOL) {
      const p = box.min[axis] - hi;
      if (p < limit) {
        limit = p;
        blocked = true;
      }
    } else if (d < 0 && box.max[axis] <= beforeMin + AHEAD_TOL) {
      const p = box.max[axis] + lo;
      if (p > limit) {
        limit = p;
        blocked = true;
      }
    }
  }
  b.pos[axis] = limit;
  return blocked;
}

/** Есть ли опора прямо под подошвой. */
function supported(w: World, b: Body): boolean {
  const box = bodyBox(b);
  box.min.y -= GROUND_PROBE_M;
  box.max.y = b.pos.y;
  return overlapping(w, box, scratch).length > 0;
}

interface HorizResult {
  blockedX: boolean;
  blockedZ: boolean;
  stepped: boolean;
}

/** Сначала X, потом Z. Если упёрлись, стоя на земле, пробуем зайти на ступеньку: подняться, сдвинуться, опуститься. */
function moveHorizontal(w: World, b: Body, dx: number, dz: number, canStep: boolean): HorizResult {
  const sx = b.pos.x;
  const sy = b.pos.y;
  const sz = b.pos.z;
  const blockedX = sweepAxis(w, b, "x", dx);
  const blockedZ = sweepAxis(w, b, "z", dz);
  const flat: HorizResult = { blockedX, blockedZ, stepped: false };
  if (!(blockedX || blockedZ) || !canStep || b.stepHeight <= 0) return flat;

  const fx = b.pos.x;
  const fz = b.pos.z;
  const flatDist2 = (fx - sx) * (fx - sx) + (fz - sz) * (fz - sz);
  b.pos.x = sx;
  b.pos.z = sz;
  sweepAxis(w, b, "y", b.stepHeight);
  const lifted = b.pos.y - sy;
  if (lifted > 1e-6) {
    const sbx = sweepAxis(w, b, "x", dx);
    const sbz = sweepAxis(w, b, "z", dz);
    sweepAxis(w, b, "y", -lifted);
    const stepDist2 = (b.pos.x - sx) * (b.pos.x - sx) + (b.pos.z - sz) * (b.pos.z - sz);
    if (stepDist2 > flatDist2 + 1e-8 && b.pos.y >= sy - 1e-6) {
      return { blockedX: sbx, blockedZ: sbz, stepped: b.pos.y > sy + 1e-6 };
    }
  }
  b.pos.x = fx;
  b.pos.y = sy;
  b.pos.z = fz;
  return flat;
}

/**
 * Сдвигает тело на vel·dt с коллизиями: поосно X → Z → Y, с заходом на ступеньки и прилипанием к земле
 * на спуске. Шаг делится на подшаги не длиннее halfW/2, поэтому тело не проскакивает тонкие стены.
 * Меняет body.pos и body.vel (заблокированные составляющие скорости обнуляются).
 *
 * landVel — это body.vel.y в момент касания. stepPlayer передаёт сюда среднюю за тик скорость (гравитация по
 * трапеции), поэтому через stepPlayer landVel отличается от баллистической скорости касания не больше чем на g·dt/2.
 * Приземление сообщается всегда, в том числе когда подшаг кончился над опорой ближе GROUND_PROBE_M, не коснувшись её:
 * тогда подошва ставится точно на верх опоры.
 *
 * Тело, утопленное в коллайдер глубже AHEAD_TOL (0,1 мм), этот коллайдер не видит: может из него выйти, но может
 * и провалиться сквозь него вниз. Поэтому точки появления и телепорта нужно заранее проверять: isFree(w, bodyBox(b)).
 */
export function moveBody(w: World, b: Body, dt: number, wasOnGround: boolean): MoveResult {
  const speed = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vel.z * b.vel.z);
  const maxStep = Math.max(0.05, b.halfW * 0.5);
  const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speed * dt) / maxStep)));
  const h = dt / n;
  const res: MoveResult = { onGround: wasOnGround, hitWall: false, hitCeiling: false, landVel: 0, stepped: false };
  let grounded = wasOnGround;
  for (let s = 0; s < n; s++) {
    const hz = moveHorizontal(w, b, b.vel.x * h, b.vel.z * h, grounded);
    if (hz.blockedX) b.vel.x = 0;
    if (hz.blockedZ) b.vel.z = 0;
    if (hz.blockedX || hz.blockedZ) res.hitWall = true;
    if (hz.stepped) res.stepped = true;

    const dy = b.vel.y * h;
    const hitY = sweepAxis(w, b, "y", dy);
    let onGround = false;
    if (hitY && dy < 0) {
      onGround = true;
      if (!grounded) res.landVel = Math.min(res.landVel, b.vel.y);
      b.vel.y = 0;
    } else if (hitY && dy > 0) {
      res.hitCeiling = true;
      b.vel.y = 0;
    } else if (b.vel.y <= 0 && supported(w, b)) {
      onGround = true;
      if (!grounded) {
        // Подшаг в воздухе кончился над опорой ближе GROUND_PROBE_M, не коснувшись её: это тоже приземление.
        // Ставим подошву точно на опору (без этого тело зависало бы и оседало несколько тиков) и отдаём landVel,
        // как при касании. Если опора — бокс, в который тело утоплено глубже AHEAD_TOL, сдвиг его не видит: стоим где были.
        const y0 = b.pos.y;
        if (!sweepAxis(w, b, "y", -GROUND_PROBE_M)) b.pos.y = y0;
        res.landVel = Math.min(res.landVel, b.vel.y);
        b.vel.y = 0;
      }
    } else if (grounded && b.vel.y <= 0 && b.stepHeight > 0) {
      // Прилипание: сошли со ступеньки вниз — опускаемся на неё, а не летим.
      const y0 = b.pos.y;
      if (sweepAxis(w, b, "y", -b.stepHeight)) {
        onGround = true;
        b.vel.y = 0;
      } else {
        b.pos.y = y0;
      }
    }
    grounded = onGround;
  }
  res.onGround = grounded;
  return res;
}
