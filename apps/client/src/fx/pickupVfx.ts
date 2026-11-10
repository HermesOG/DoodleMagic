import { DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, Vector3, type ShaderMaterial } from "three";
import { NOBODY, PICKUPS, TICK_HZ, hasFury, pickupPresent, type PickupState, type Unit, type UnitId, type Vec3 } from "@doodlemagic/sim";
import { INK_STYLE, type RGB } from "../render/palette";
import { glslFloat } from "../render/stylePass";
import type { ElementVfx, ElementVfxFactory, ElementVfxFrame } from "./elementVfx";
import { FX_ORDER, createFxMaterial } from "./fxShader";
import { L, UP, spawn, type ParticleSpec, type Rng } from "./particleKit";
import { GOLD, burstParticles, toGold } from "./presets";

/*
 * Объекты на карте (фаза 6): сферы жизни и руна ярости — «золото с печатью» (GDD 6) в проходе света. Вид — только
 * по состоянию кадра (prev / cur / alpha / nowS), событий не читает.
 * - Сфера: золотой шар 0,28 м в кольце-печати тушью парит на точке объекта (0,5 м над полом), покачивается ±0,08 м
 *   (0,5 Гц), кольцо медленно вращается; слабое свечение (свет 2 м — последним в очереди пресета). Под точкой всегда
 *   печать-круг тушью: под сферой тусклая, пока её нет — бледная, за 2 с до возврата разгорается золотом. Появление —
 *   рост из печати за 0,25 с и orbSpawn; взятие — orbTake.
 * - Руна: золотой знак-диск 1,1 м с печатью тушью парит на 1,2 м над площадкой; повёрнут к глазам вокруг вертикали
 *   (ребром не встаёт), печать вращается в плоскости диска; свечение и свет 5 м. Последние 10 с до появления на площадке
 *   тушью дорисовывается круг-печать (доля — прошедшее / 10 с), к центру тянутся золотые искры. Появление — runeSpawn
 *   и вспышка света; взятие — runeTake; пропала (взята, перенесена отсчётом) — печать тает.
 * - Носитель ярости: золотое свечение у груди, пульс 1,5 Гц (свет 2,5 м; ореол растёт с расстоянием — носитель виден
 *   на любой дистанции боя), за ним — искры furyMote ≤ 20/с; последние 2 с пульс чаще и гаснет. Свой — только искры
 *   у ладоней: ни ореола, ни света у камеры, прицел чист.
 * - Своё взятие — низко: orbTakeOwn / runeTakeOwn кольцом по полу, путь искр ниже глаз. Ореолы и вспышка у глаз камеры
 *   гаснут; стоишь в столбе появления руны — столба нет.
 * Мешей два (+2 вызова): тела (сферы и руна) и печати на полу. Частицы — общий пул, свет — общие свечения в лимите
 * пресета.
 * Объект смотрится на последнем посчитанном тике состояния (now = tick − 1: на нём родились его события). Появление
 * и взятие — по самому состоянию на тиках (seenNow, now] с прошлого кадра: срок объекта наступил — появился (так видно
 * и появление со взятием на одном тике, когда маг ждёт на площадке); сфера взята — её срок стал now + 15 с с тиком
 * взятия в окне; руну взял маг, у которого furyUntil − 12 с — в окне (так известно, моё ли взятие). Кадр с той же парой
 * тиков ничего не повторит, пропущенный тик не потеряется; объект, вернувшийся откатом предсказания (срок в прошлом),
 * встаёт тихо; перенос руны отсчётом и новый бой — не взятие.
 */

/** Точка объекта на арене — на 0,5 м над полом. */
const POINT_LIFT_M = 0.5;
const WARN_S = PICKUPS.rune.warnS;
/** Шар сферы, радиус, м (0,28 м в поперечнике); квадрат — вдвое шире шара, в нём кольцо-печать. */
export const ORB_R_M = 0.14;
const ORB_QUAD = 2;
export const ORB_BOB_M = 0.08;
const ORB_BOB_HZ = 0.5;
/** Кольцо сферы вращается, оборотов в секунду. */
const ORB_SPIN_HZ = 0.12;
export const ORB_GROW_S = 0.25;
/** Печать под сферой, радиус, м. */
export const ORB_SEAL_M = 0.5;
/** За столько секунд до возврата печать сферы разгорается. */
export const ORB_WAKE_S = 2;
/** Свечение сферы: ореол не меньше ORB_HALO_M и не меньше ORB_HALO_PER_M от расстояния (видна издалека), свет 2 м. */
const ORB_HALO_M = 0.32;
const ORB_HALO_PER_M = 0.016;
export const ORB_LIGHT_M = 2;
const ORB_GLOW = 0.45;
/** Свет сфер уступает всему (руки магов — 0,6): шесть сфер не съедают бюджет пресета 2/4/8, ореол остаётся. */
export const ORB_PRIO = 0.3;

/** Диск руны, радиус, м (1,1 м в поперечнике); парит на 1,2 м над площадкой. */
export const RUNE_R_M = 0.55;
const RUNE_QUAD = 1.04;
export const RUNE_HOVER_M = 1.2;
const RUNE_BOB_M = 0.05;
const RUNE_BOB_HZ = 0.35;
const RUNE_SPIN_HZ = 0.15;
const RUNE_PULSE_HZ = 0.6;
const RUNE_GROW_S = 0.35;
/** Печать руны на площадке 4 × 4, радиус, м. */
export const RUNE_SEAL_M = 1.6;
const RUNE_SEAL_INK = 0.8;
const RUNE_SEAL_GOLD = 0.45;
/**
 * Свечение руны: свет 5 м, ореол не меньше 0,9 м. Свет — выше рук магов (0,6), ниже горения (1): на «Низком»
 * (2 источника) руна не вытесняет огонь на цели.
 */
export const RUNE_LIGHT_M = 5;
const RUNE_HALO_M = 0.9;
const RUNE_HALO_PER_M = 0.02;
const RUNE_GLOW = 0.45;
export const RUNE_PRIO = 0.8;
/** Вспышка появления руны: свет 7 м, гаснет за 0,5 с; приоритет — как у вспышек всплесков. */
export const RUNE_FLASH = { light: 7, halo: 1.6, intensity: 1.5, core: 0.9, life: 0.5, prio: 5 } as const;
/** Искры к центру печати в объявлении, в секунду: в начале и к появлению. */
const WARN_SPARKS = [6, 36] as const;
/** Печать пропавшей руны тает за столько секунд. */
export const SEAL_FADE_S = 0.6;
/** Полная печать лежащей руны — с неё тает печать руны, появившейся и взятой в одном кадре. */
const RUNE_SEAL_FULL: Readonly<SealLook> = { ink: RUNE_SEAL_INK, gold: RUNE_SEAL_GOLD, progress: 1 };
/** Стоишь в столбе появления (глаза ближе 1,2 м к оси) — столба нет: он прошёл бы сквозь камеру. */
const COLUMN_R_M = 1.2;
/** Сферу взял ближний к точке живой маг (не дальше 1,6 м по горизонтали): так видно, моё ли взятие. */
const ORB_TAKER_M = 1.6;
const ORB_RESPAWN_TICKS = Math.round(PICKUPS.orb.respawnS * TICK_HZ);
const FURY_TICKS = Math.round(PICKUPS.rune.furyS * TICK_HZ);
/** Свет — только при доле яркости ≥ 0,3: почти погасшее свечение не держит источник пресета. */
const LIT_MIN = 0.3;
/** Ореол у глаз камеры гаснет: ближе 0,3 м его нет, к 2 м — полный (как ядро снаряда у глаз). */
const FACE_NEAR_M = 0.3;
const FACE_FULL_M = 2;

/** Носитель ярости: пульс 1,5 Гц, последние 2 с — 4 Гц и гаснет. */
export const FURY_HZ = 1.5;
export const FURY_FAST_HZ = 4;
export const FURY_FADE_S = 2;
/** Свечение у груди (1,3 м над подошвой): свет 2,5 м, ореол не меньше 0,5 м и 3 см на метр расстояния. */
export const FURY_LIGHT_M = 2.5;
const FURY_CHEST_M = 1.3;
const FURY_HALO_M = 0.5;
const FURY_HALO_PER_M = 0.03;
const FURY_GLOW = 0.9;
/** Свет носителя — ниже рук магов (0,6): носителя видно по ореолу, свет на мир — когда источник свободен. */
export const FURY_PRIO = 0.5;
/** Искр за чужим носителем в секунду (≤ 20); своему — у ладоней. */
export const FURY_MOTE_RATE = 16;
export const OWN_MOTE_RATE = 10;
/** Объектов на карте — не больше (на галерее 7). */
const MAX_OBJECTS = 16;
/** Тушь печатей — как линии декалей. */
const SEAL_INK: RGB = [0.1, 0.09, 0.08];
/** Квадрат печати шире её круга: под мазок кисти. */
const SEAL_PAD = 1.12;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Поворот на hz оборотов в секунду к моменту t, рад, — в пределах оборота: cos и sin в шейдере не теряют точность. */
const turn = (hz: number, t: number): number => ((hz * t) % 1) * 2 * Math.PI;
/** Свет при доле яркости k: меньше LIT_MIN — 0. */
const lit = (light: number, k: number): number => (k < LIT_MIN ? 0 : light);
/** Доля ореола у точки p по расстоянию до глаз: 0 вплотную, 1 с 2 м. */
export const faceK = (p: Vec3, eye: Vec3): number => clamp01((dist(p, eye) - FACE_NEAR_M) / (FACE_FULL_M - FACE_NEAR_M));

/**
 * Рост из печати: 0 → 1 за durS секунд, ease-out с перелётом ≈ 6 % (язык шипов Разлома). До начала — 0, после — 1.
 */
export function growIn(sinceS: number, durS: number): number {
  const g = clamp01(sinceS / durS);
  return 1 - (1 - g) ** 3 + (g < 1 ? 0.12 * Math.sin(Math.PI * g) : 0);
}

/** Печать под объектом: ink — плотность туши, gold — золотой свет в круге, progress — доля дорисованного круга. */
export interface SealLook {
  ink: number;
  gold: number;
  progress: number;
}

/**
 * Печать на полу под объектом на дробном тике tick. Сфера — всегда: под лежащей тусклая, пока её нет — бледная, за
 * последние 2 с до возврата разгорается золотом. Руна — пока лежит (полная), а до появления только последние 10 с:
 * круг дорисовывается (progress — прошедшее / 10 с), золото в нём разгорается. null — печати нет.
 */
export function sealLook(p: Readonly<PickupState>, tick: number): SealLook | null {
  const left = (p.readyAt - tick) / TICK_HZ;
  if (p.kind === "orb") {
    if (left <= 0) return { ink: 0.55, gold: 0.25, progress: 1 };
    const k = clamp01(1 - left / ORB_WAKE_S);
    return { ink: 0.3 + 0.25 * k, gold: 0.7 * k * k, progress: 1 };
  }
  if (left <= 0) return { ink: RUNE_SEAL_INK, gold: RUNE_SEAL_GOLD, progress: 1 };
  if (left > WARN_S) return null;
  const k = 1 - left / WARN_S;
  return { ink: RUNE_SEAL_INK, gold: 0.1 + 0.5 * k * k, progress: k };
}

/**
 * Свечение носителя ярости: pulse 0…1 (1,5 Гц, с пиком в момент взятия; последние 2 с — 4 Гц, фаза без скачка),
 * fade — доля яркости (последние 2 с гаснет к нулю). Есть ли ярость — по hasFury на тике now (cur), пульс — по дробному
 * тику кадра. null — ярости нет (вышла или маг мёртв).
 */
export function furyGlow(u: Readonly<Unit>, now: number, tick: number): { pulse: number; fade: number } | null {
  if (!hasFury(u, now)) return null;
  const full = PICKUPS.rune.furyS;
  const left = Math.max(0, (u.status.furyUntil - tick) / TICK_HZ);
  const cycles = left >= FURY_FADE_S ? FURY_HZ * (full - left) : FURY_HZ * (full - FURY_FADE_S) + FURY_FAST_HZ * (FURY_FADE_S - left);
  return { pulse: 0.5 + 0.5 * Math.cos(2 * Math.PI * cycles), fade: clamp01(left / FURY_FADE_S) };
}

/** Искра объявления руны: свет, без тяжести; летит от круга печати к точке появления. */
const WARN_SPARK = L("glow", 1, "up", [0, 0], [0.8, 1.2], [0.07, 0.1], [0.03, 0.05], { gravity: 0 });
/** Искра ярости у своей ладони: мелкая и короткая — у края кадра, ниже прицела. */
const OWN_SPARK = L("ember", 1, "up", [0.08, 0.25], [0.35, 0.5], [0.014, 0.02], [0.005, 0.008], { gravity: -0.5, cone: 0.7 });

/** Искра объявления: рождается на круге печати у пола и к концу жизни долетает до точки появления руны hover. */
function warnSpark(hover: Vec3, floorY: number, rng: Rng): ParticleSpec {
  const s = spawn(WARN_SPARK, hover, UP, rng);
  const phi = 2 * Math.PI * rng();
  const r = RUNE_SEAL_M * (0.85 + 0.15 * rng());
  s.pos = { x: hover.x + Math.cos(phi) * r, y: floorY + 0.08 + 0.3 * rng(), z: hover.z + Math.sin(phi) * r };
  s.vel = { x: (hover.x - s.pos.x) / s.life, y: (hover.y - s.pos.y) / s.life, z: (hover.z - s.pos.z) / s.life };
  return s;
}

const BODY_VERT = /* glsl */ `
attribute vec4 aB0; // центр (x, y, z), вид: 0 — сфера, 1 — руна
attribute vec4 aB1; // радиус тела, м (с ростом); поворот печати, рад; яркость; семя
varying vec2 vP;
varying vec4 vB;
void main() {
  bool rune = aB0.w > 0.5;
  vec2 q = position.xy * 2.0 * (rune ? RUNE_QUAD : ORB_QUAD);
  vec3 c = aB0.xyz;
  vec4 mv;
  if (rune) {
    // руна — вертикальный диск, повёрнутый к глазам вокруг вертикали: ребром не встаёт, сверху виден эллипсом
    vec2 d = cameraPosition.xz - c.xz;
    float l = length(d);
    vec2 n = l > 1e-4 ? d / l : vec2(0.0, 1.0);
    vec3 right = vec3(n.y, 0.0, -n.x);
    mv = viewMatrix * vec4(c + (right * q.x + vec3(0.0, q.y, 0.0)) * aB1.x, 1.0);
  } else {
    // шар — квадрат к камере, как частица
    mv = viewMatrix * vec4(c, 1.0);
    mv.xy += q * aB1.x;
  }
  vP = q;
  vB = vec4(aB0.w, aB1.yzw);
  gl_Position = projectionMatrix * mv;
}
`;

/** Полоса толщины w вокруг нуля — не тоньше полутора пикселей (px — пиксель в тех же единицах): печать читается и с 25 м. */
const PK_LINE = /* glsl */ `
float pkLine(float x, float w, float px) {
  float hw = max(w, 1.5 * px) * 0.5;
  return 1.0 - smoothstep(hw - 0.5 * px, hw + 0.5 * px, abs(x));
}
`;

const BODY_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uGold;
uniform vec3 uDeep;
uniform vec3 uPale;
uniform vec3 uInk;
uniform vec3 uRim;
varying vec2 vP;
varying vec4 vB;
const float TAU = 6.2831853;
const vec3 KEY = vec3(-0.36, 0.64, 0.68);
${PK_LINE}
// видимость тела: за миром и за руками его нет, у стены мягко тает; над тушью врага не бледнеет — тело не свет магии
float pkVisibility(float softM) {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float d = texelFetch(gDepth, p, 0).r;
  if (d < OVERLAY_BAND) return 0.0;
  return clamp((fxDist(d) - fxDist(gl_FragCoord.z)) / softM, 0.0, 1.0);
}
// мазок кисти по отрезку a → b: полуширина w в начале, к концу вдвое тоньше
float pkStroke(vec2 p, vec2 a, vec2 b, float w, float px) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float hw = max(w * (1.0 - 0.5 * h), 0.75 * px);
  return 1.0 - smoothstep(hw - 0.5 * px, hw + 0.5 * px, length(pa - ba * h));
}
void main() {
  bool rune = vB.x > 0.5;
  float r = length(vP);
  // производная — до первого discard: соседние пиксели квадрата ещё считают её вместе
  float px = max(fwidth(r), 1e-4);
  if (r > (rune ? 1.02 : 1.95)) discard;
  float vis = pkVisibility(0.12);
  if (vis <= 0.0) discard;
  float spin = vB.y;
  float bright = vB.z;
  float seed = vB.w;
  vec3 col = uGold;
  float a = 0.0;
  vec3 add = vec3(0.0);
  if (!rune) {
    if (r < 1.0) {
      // шар: золото с бликом сверху-слева, кромка — линией туши, как вещи мира
      vec3 n = vec3(vP, sqrt(max(0.0, 1.0 - r * r)));
      float key = clamp(dot(n, normalize(KEY)), 0.0, 1.0);
      col = mix(uDeep, uGold, smoothstep(0.05, 0.75, key));
      col = mix(col, uPale, smoothstep(0.86, 0.98, key));
      float rim = smoothstep(0.86 - 2.0 * px, 1.0 - px, r);
      col = mix(col, uRim, rim);
      a = 1.0 - smoothstep(1.0 - px, 1.0, r);
      // свет поверх — немного: золото и так у предела, ореол свечения добавит своё
      add = uGold * (0.04 + 0.1 * key) * bright * (1.0 - rim) * a;
    } else {
      // кольцо-печать на 1,65 радиуса: мазок от толстого начала к тонкому концу с разрывом в десятую круга (энсо)
      // и четыре засечки; всё вращается
      float u = fract((atan(vP.y, vP.x) - spin) / TAU + 1.0);
      float n = fxNoise(vec2(u * 14.0 + seed, seed * 3.0));
      float ring = pkLine(r - 1.65, 0.2 * (0.7 + 0.6 * n) * (1.0 - 0.5 * u), px) * smoothstep(0.0, 0.03, u) * (1.0 - smoothstep(0.86, 0.9, u));
      float sec = fract(u * 4.0 + 0.5) - 0.5;
      float tick = pkLine(sec * TAU / 4.0 * r, 0.1, px) * step(1.42, r) * step(r, 1.88);
      col = uInk;
      a = max(ring, tick) * 0.9;
    }
  } else {
    // руна: золотой диск; кромка — двойной круг тушью с восемью засечками, в середине квадратная печать со знаком
    // ярости (стрела-пламя вверх); печать вращается в плоскости диска, по золоту ходит блик
    vec2 s = vec2(cos(spin) * vP.x + sin(spin) * vP.y, -sin(spin) * vP.x + cos(spin) * vP.y);
    float sweep = fract(uTime * 0.16 + seed) * 3.6 - 1.8;
    float sheen = fxBell((dot(vP, vec2(0.8, 0.6)) - sweep) / 0.2);
    col = mix(uDeep, uGold, smoothstep(-0.9, 0.6, vP.y * 0.6 + (1.0 - r * r) * 0.6));
    col = mix(col, uPale, 0.55 * sheen);
    a = 1.0 - smoothstep(1.0 - px, 1.0, r);
    // atan(0, 0) не определён: в самой середине угол — 0
    float u = r > 1e-5 ? fract(atan(s.y, s.x) / TAU + 1.0) : 0.0;
    float sec = fract(u * 8.0 + 0.5) - 0.5;
    float rimO = pkLine(r - 0.955, 0.075, px);
    float rimI = pkLine(r - 0.83, 0.03, px);
    float tick = pkLine(sec * TAU / 8.0 * r, 0.035, px) * step(0.84, r) * step(r, 0.93);
    float frame = pkLine(max(abs(s.x), abs(s.y)) - 0.5, 0.06, px);
    float glyph = max(
      max(pkStroke(s, vec2(0.0, -0.36), vec2(0.0, 0.33), 0.07, px), pkStroke(s, vec2(-0.3, -0.05), vec2(0.0, 0.34), 0.055, px)),
      max(pkStroke(s, vec2(0.3, -0.05), vec2(0.0, 0.34), 0.055, px), pkStroke(s, vec2(-0.27, -0.35), vec2(0.27, -0.35), 0.05, px)));
    float ink = max(max(rimO, rimI), max(tick, max(frame, glyph)));
    col = mix(col, uInk, ink * 0.92);
    add = (uGold * (0.04 + 0.1 * bright) + uPale * sheen * 0.15) * (1.0 - ink) * a;
  }
  if (a <= 0.002) discard;
  gl_FragColor = fxCompose(col, a * vis, fxLight(add * vis, 0.5));
}
`;

const SEAL_VERT = /* glsl */ `
attribute vec4 aS0; // середина на полу (x, y, z), радиус, м
attribute vec4 aS1; // вид (0 — сфера, 1 — руна), доля круга, тушь, золото
attribute vec4 aS2; // начало круга, рад; семя; —; —
varying vec2 vL;
varying vec4 vS1;
varying vec2 vS2;
void main() {
  vec2 q = position.xy * 2.0 * SEAL_PAD;
  // чуть над полом: глубина мира не прячет печать (как лужа Родника)
  vec3 w = vec3(aS0.x + q.x * aS0.w, aS0.y + 0.05, aS0.z + q.y * aS0.w);
  vL = q;
  vS1 = aS1;
  vS2 = aS2.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const SEAL_FRAG = /* glsl */ `
uniform vec3 uGold;
uniform vec3 uPale;
uniform vec3 uInk;
varying vec2 vL;
varying vec4 vS1;
varying vec2 vS2;
const float TAU = 6.2831853;
${PK_LINE}
void main() {
  float r = length(vL);
  // производная — до первого discard
  float px = max(fwidth(r), 1e-4);
  if (r > SEAL_PAD) discard;
  float vis = fxVisibility(0.04);
  if (vis <= 0.0) discard;
  bool rune = vS1.x > 0.5;
  float prog = vS1.y;
  float seed = vS2.y;
  // доля круга от начала по ходу кисти (в самой середине угол не определён — 0); голова кисти мягкая
  float u = r > 1e-5 ? fract((atan(vL.y, vL.x) - vS2.x) / TAU + 1.0) : 0.0;
  float drawn = prog >= 1.0 ? 1.0 : 1.0 - smoothstep(prog - 0.01, prog, u);
  float n = fxNoise(vec2(u * (rune ? 36.0 : 14.0) + seed, seed * 3.0));
  // внешний мазок с сухой кистью: просветы вдоль круга
  float outer = pkLine(r - 0.9, (rune ? 0.07 : 0.11) * (0.75 + 0.5 * n), px) * drawn;
  outer *= 0.72 + 0.28 * fxNoise(vec2(u * 70.0 + seed, r * 30.0));
  float inner = pkLine(r - 0.7, 0.025, px) * drawn;
  // засечки (у сферы 4, у руны 8) появляются, когда кисть прошла их угол
  float N = rune ? 8.0 : 4.0;
  float sec = fract(u * N + 0.5) - 0.5;
  float tick = pkLine(sec * TAU / N * r, 0.04, px) * step(0.72, r) * step(r, 0.86) * drawn;
  float ink = max(outer, max(inner, tick));
  // у руны ко второй половине объявления проступает квадрат печати
  if (rune) ink = max(ink, pkLine(max(abs(vL.x), abs(vL.y)) - 0.42, 0.035, px) * smoothstep(0.5, 0.9, prog));
  ink *= vS1.z;
  // золото: свет в круге и по мазку; голова кисти, пока круг дорисовывается, горит
  float fill = (1.0 - smoothstep(0.15, 0.9, r)) * 0.35 + outer * 0.55 + inner * 0.25;
  vec3 add = uGold * vS1.w * fill;
  if (prog < 1.0) add += uPale * fxBell((u - prog) * 30.0) * fxBell((r - 0.9) / 0.08) * 1.4;
  float a = clamp(ink, 0.0, 1.0) * fxDense(vis);
  if (a <= 0.002 && max(add.r, max(add.g, add.b)) <= 0.002) discard;
  gl_FragColor = fxCompose(uInk, a, fxLight(add * vis, 0.6));
}
`;

export const createPickupVfx: ElementVfxFactory = ({ gbuffer, time }): ElementVfx => {
  const attr = (): InstancedBufferAttribute => {
    const a = new InstancedBufferAttribute(new Float32Array(MAX_OBJECTS * 4), 4);
    a.setUsage(DynamicDrawUsage);
    return a;
  };
  const v3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);
  const mesh = (name: string, geom: PlaneGeometry, mat: ShaderMaterial, order: number): InstancedMesh<PlaneGeometry, ShaderMaterial> => {
    const m = new InstancedMesh(geom, mat, MAX_OBJECTS);
    m.name = name;
    m.frustumCulled = false;
    m.renderOrder = order;
    m.count = 0;
    m.visible = false;
    return m;
  };

  // тела: сферы и руна, один вызов на все
  const b0 = attr();
  const b1 = attr();
  const bodyGeom = new PlaneGeometry(1, 1);
  bodyGeom.setAttribute("aB0", b0);
  bodyGeom.setAttribute("aB1", b1);
  const bodyMat = createFxMaterial({
    name: "fx-pickup-bodies",
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    gbuffer,
    defines: { ORB_QUAD: glslFloat(ORB_QUAD), RUNE_QUAD: glslFloat(RUNE_QUAD) },
    uniforms: {
      uTime: time, uGold: { value: v3(GOLD.light) }, uDeep: { value: v3(GOLD.deep) }, uPale: { value: v3(GOLD.pale) },
      uInk: { value: v3(SEAL_INK) }, uRim: { value: v3(INK_STYLE.gold.line) },
    },
  });
  // поверх печатей и телеграфов, под частицами и ореолами: искры и свечение ложатся на золото
  const bodies = mesh("fx-pickup-bodies", bodyGeom, bodyMat, FX_ORDER.decals + 0.5);

  // печати на полу, один вызов на все
  const s0 = attr();
  const s1 = attr();
  const s2 = attr();
  const sealGeom = new PlaneGeometry(1, 1);
  sealGeom.setAttribute("aS0", s0);
  sealGeom.setAttribute("aS1", s1);
  sealGeom.setAttribute("aS2", s2);
  const sealMat = createFxMaterial({
    name: "fx-pickup-seals",
    vertexShader: SEAL_VERT,
    fragmentShader: SEAL_FRAG,
    gbuffer,
    defines: { SEAL_PAD: glslFloat(SEAL_PAD) },
    uniforms: { uGold: { value: v3(GOLD.light) }, uPale: { value: v3(GOLD.pale) }, uInk: { value: v3(SEAL_INK) } },
  });
  const seals = mesh("fx-pickup-seals", sealGeom, sealMat, FX_ORDER.decals);

  const group = new Group();
  group.name = "fx-pickups";
  group.add(seals, bodies);
  const bodyAttrs = [b0, b1] as const;
  const sealAttrs = [s0, s1, s2] as const;

  const rng: Rng = Math.random;
  // покадровое — одно на эффектник: кадр переписывает, а не создаёт
  const specs: ParticleSpec[] = [];
  /** Свои искры (объявление, ладони) — перекрашиваются в золото разом; всплески приходят золотыми из burstParticles. */
  const raw: ParticleSpec[] = [];
  const camRight = new Vector3();
  const camUp = new Vector3();
  /** Последний посчитанный тик прошлого кадра и этого: события кадра — на тиках (seenNow, frameNow]. */
  let seenNow = 0;
  let frameNow = 0;
  /** По номеру объекта: срок в прошлом кадре. */
  let seenReady: number[] = [];
  /** По номеру руны: печать прошлого кадра (без угасания); с какой печати и когда она тает; когда появилась (вспышка). */
  let shown: (SealLook | null)[] = [];
  let fadeFrom: (Readonly<SealLook> | null)[] = [];
  let goneS: number[] = [];
  let flashS: number[] = [];
  /** Дробные остатки темпа частиц: объявление — по номеру объекта, искры ярости — по магу. */
  const warnAcc = new Map<number, number>();
  const moteAcc = new Map<UnitId, number>();
  const liveWarn = new Set<number>();
  const liveFury = new Set<UnitId>();
  let ownHand = false;
  let nb = 0;
  let ns = 0;

  /** Тик t — в окне кадра (seenNow, frameNow]: событие на нём случилось с прошлого кадра. */
  const inWin = (t: number): boolean => t > seenNow && t <= frameNow;

  /** Сколько частиц родить за кадр по темпу rate (остаток копится в acc под ключом id). */
  function due<K>(acc: Map<K, number>, id: K, rate: number, dt: number): number {
    const k = (acc.get(id) ?? 0) + dt * rate;
    const n = Math.floor(k);
    acc.set(id, k - n);
    return n;
  }

  function pushBody(c: Vec3, rune: boolean, radius: number, spin: number, bright: number, seed: number): void {
    if (nb >= MAX_OBJECTS) return;
    b0.setXYZW(nb, c.x, c.y, c.z, rune ? 1 : 0);
    b1.setXYZW(nb, radius, spin, bright, seed);
    nb++;
  }

  function pushSeal(p: PickupState, floorY: number, look: Readonly<SealLook>, i: number): void {
    if (ns >= MAX_OBJECTS) return;
    const rune = p.kind === "rune";
    s0.setXYZW(ns, p.pos.x, floorY, p.pos.z, rune ? RUNE_SEAL_M : ORB_SEAL_M);
    s1.setXYZW(ns, rune ? 1 : 0, look.progress, look.ink, look.gold);
    // круг руны начинается с −Z (к мосту), у сфер засечки повёрнуты по номеру
    s2.setXYZW(ns, rune ? -Math.PI / 2 : i * 0.7, (i * 1.37) % 7, 0, 0);
    ns++;
  }

  /** Кто взял сферу (взятие известно по сроку): ближний к точке живой маг, не дальше ORB_TAKER_M; никого — NOBODY. */
  function orbTaker(f: ElementVfxFrame, p: PickupState): UnitId {
    let best: UnitId = NOBODY;
    let bestD = ORB_TAKER_M;
    for (const it of f.units) {
      if (!it.u.mage) continue;
      const b = it.u.move.body.pos;
      const d = Math.hypot(b.x - p.pos.x, b.z - p.pos.z);
      if (d > bestD || p.pos.y < b.y - 1 || p.pos.y > b.y + 2.5) continue;
      best = it.id;
      bestD = d;
    }
    return best;
  }

  /** Кто взял руну: маг, у которого ярость началась в окне кадра (furyUntil − 12 с); никого — NOBODY. */
  function runeTaker(f: ElementVfxFrame): UnitId {
    for (const u of f.cur.units) if (u.mage && inWin(u.status.furyUntil - FURY_TICKS)) return u.id;
    return NOBODY;
  }

  /** Объект появился: сфера — кольцо искр из печати, руна — столб искр и вспышка (в столбе стоишь — без столба). */
  function appear(f: ElementVfxFrame, i: number, p: PickupState, floorY: number): void {
    const base = { x: p.pos.x, y: floorY + 0.05, z: p.pos.z };
    if (p.kind === "orb") {
      specs.push(...burstParticles("orbSpawn", base, UP, 1, rng));
      return;
    }
    flashS[i] = f.nowS;
    if (Math.hypot(f.eye.x - p.pos.x, f.eye.z - p.pos.z) < COLUMN_R_M && f.eye.y > floorY) return;
    specs.push(...burstParticles("runeSpawn", base, UP, 1, rng));
  }

  /** Объект взят магом who: чужой — искры от объекта; свой — низко, кольцом по полу у ног (путь ниже глаз). */
  function take(f: ElementVfxFrame, p: PickupState, floorY: number, who: UnitId): void {
    const own = who !== NOBODY && who === f.localId;
    const feet = { x: p.pos.x, y: floorY + 0.05, z: p.pos.z };
    if (p.kind === "orb") specs.push(...burstParticles(own ? "orbTakeOwn" : "orbTake", own ? feet : { ...p.pos }, UP, 1, rng));
    else specs.push(...burstParticles(own ? "runeTakeOwn" : "runeTake", own ? feet : { x: p.pos.x, y: floorY + RUNE_HOVER_M, z: p.pos.z }, UP, 1, rng));
  }

  function drawOrb(f: ElementVfxFrame, i: number, p: PickupState, here: boolean, floorY: number, ft: number): void {
    const look = sealLook(p, ft);
    if (look) pushSeal(p, floorY, look, i);
    if (!here) return;
    // растёт из печати: поднимается с пола на свою высоту, пока растёт
    const g = growIn((ft - p.readyAt) / TICK_HZ, ORB_GROW_S);
    const up = Math.min(1, g);
    const phase = i * 1.7;
    const w = 2 * Math.PI * ORB_BOB_HZ * f.nowS + phase;
    const c = { x: p.pos.x, y: floorY + (POINT_LIFT_M + ORB_BOB_M * Math.sin(w)) * up, z: p.pos.z };
    const bright = 0.9 + 0.1 * Math.sin(w + 1);
    pushBody(c, false, ORB_R_M * g, turn(ORB_SPIN_HZ, f.nowS) + phase, bright, (i * 1.37) % 7);
    const near = faceK(c, f.eye);
    const halo = Math.max(ORB_HALO_M, dist(c, f.eye) * ORB_HALO_PER_M) * up * near;
    f.glow({ pos: c, color: GOLD.light, halo, light: lit(ORB_LIGHT_M, up), intensity: ORB_GLOW * bright * up, core: 0.1 * up * near }, ORB_PRIO);
  }

  /** Руна; changed — в этом кадре появилась или взята (печать тает с полной, а не с печати объявления). */
  function drawRune(f: ElementVfxFrame, i: number, p: PickupState, here: boolean, floorY: number, ft: number, changed: boolean): void {
    const hover = { x: p.pos.x, y: floorY + RUNE_HOVER_M, z: p.pos.z };
    const seal = sealLook(p, ft);
    let look: Readonly<SealLook> | null = seal;
    if (seal) fadeFrom[i] = null;
    else {
      // печать пропала (взята, перенесена отсчётом) — тает с той, что была видна
      if (changed) fadeFrom[i] = RUNE_SEAL_FULL;
      else if (shown[i]) fadeFrom[i] = shown[i]!;
      if (changed || shown[i]) goneS[i] = f.nowS;
      const from = fadeFrom[i];
      const k = from ? 1 - (f.nowS - goneS[i]!) / SEAL_FADE_S : 0;
      if (from && k > 0) look = { ink: from.ink * k, gold: from.gold * k, progress: from.progress };
      else fadeFrom[i] = null;
    }
    shown[i] = seal;
    if (here) {
      const g = growIn((ft - p.readyAt) / TICK_HZ, RUNE_GROW_S);
      const up = Math.min(1, g);
      const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * RUNE_PULSE_HZ * f.nowS);
      // поднимается к своей высоте, пока растёт; парит и медленно дышит светом
      const lift = (RUNE_HOVER_M + RUNE_BOB_M * Math.sin(2 * Math.PI * RUNE_BOB_HZ * f.nowS)) * (0.5 + 0.5 * up);
      const c = { x: p.pos.x, y: floorY + lift, z: p.pos.z };
      pushBody(c, true, RUNE_R_M * g, turn(RUNE_SPIN_HZ, f.nowS), pulse, (i * 1.37) % 7);
      if (seal) seal.gold *= 0.8 + 0.4 * pulse;
      const halo = Math.max(RUNE_HALO_M, dist(c, f.eye) * RUNE_HALO_PER_M) * up * faceK(c, f.eye);
      f.glow({ pos: c, color: GOLD.light, halo, light: lit(RUNE_LIGHT_M, up), intensity: RUNE_GLOW * (0.85 + 0.15 * pulse) * up, core: 0 }, RUNE_PRIO);
    } else if (seal) {
      // объявление: к центру тянутся искры, свет на площадке разгорается; ореол у глаз мага в центре гаснет
      const k = seal.progress;
      liveWarn.add(i);
      for (let n = due(warnAcc, i, WARN_SPARKS[0] + (WARN_SPARKS[1] - WARN_SPARKS[0]) * k, f.dt); n > 0; n--) raw.push(warnSpark(hover, floorY, rng));
      if (k > 0) f.glow({ pos: hover, color: GOLD.light, halo: 0.6 * k * k * faceK(hover, f.eye), light: lit(3 * k, k), intensity: 0.6 * k * k, core: 0 }, RUNE_PRIO);
    }
    if (look) pushSeal(p, floorY, look, i);
    // вспышка появления: у глаз — без ореола и ядра, свет на мир остаётся
    const age = f.nowS - flashS[i]!;
    if (age >= 0 && age < RUNE_FLASH.life) {
      const k = 1 - age / RUNE_FLASH.life;
      const near = faceK(hover, f.eye);
      f.glow(
        {
          pos: hover, color: GOLD.light, halo: RUNE_FLASH.halo * (0.6 + 0.4 * k) * near, light: lit(RUNE_FLASH.light, k),
          intensity: RUNE_FLASH.intensity * k * k * (0.35 + 0.65 * near), core: RUNE_FLASH.core * k * near,
        },
        RUNE_FLASH.prio,
      );
    }
  }

  function drawFury(f: ElementVfxFrame): void {
    liveFury.clear();
    for (const it of f.units) {
      if (!it.u.mage) continue;
      const fg = furyGlow(it.u, f.cur.tick, f.tick);
      if (!fg) continue;
      liveFury.add(it.id);
      if (it.id === f.localId) {
        // свой: искры в 8–12 см от ладони наружу и вниз — варежка их не прячет, прицел чист; уходят от ладони наружу
        // и идут вместе с руками — к своей скорости прибавлена скорость мага
        const v = it.u.move.body.vel;
        camRight.setFromMatrixColumn(f.camera.matrixWorld, 0);
        camUp.setFromMatrixColumn(f.camera.matrixWorld, 1);
        for (let n = due(moteAcc, it.id, OWN_MOTE_RATE * (0.4 + 0.6 * fg.fade), f.dt); n > 0; n--) {
          ownHand = !ownHand;
          const side = ownHand ? -1 : 1;
          const palm = f.palmWorld(ownHand ? "left" : "right");
          const out = (0.06 + 0.02 * rng()) * side;
          const down = 0.05 + 0.02 * rng();
          const at = { x: palm.x + camRight.x * out - camUp.x * down, y: palm.y + camRight.y * out - camUp.y * down, z: palm.z + camRight.z * out - camUp.z * down };
          const s = spawn(OWN_SPARK, at, UP, rng);
          const drift = (0.08 + 0.1 * rng()) * side;
          s.vel = { x: s.vel.x + camRight.x * drift + v.x, y: s.vel.y + camRight.y * drift + v.y, z: s.vel.z + camRight.z * drift + v.z };
          raw.push(s);
        }
        continue;
      }
      // чужой: свечение у груди фигуры (поза — как её нарисовали), за ним — искры
      let at = it.pos;
      for (const m of f.mages)
        if (m.id === it.id) {
          at = m.pose.pos;
          break;
        }
      const chest = { x: at.x, y: at.y + FURY_CHEST_M, z: at.z };
      const k = fg.fade;
      const near = faceK(chest, f.eye);
      const halo = Math.max(FURY_HALO_M, dist(chest, f.eye) * FURY_HALO_PER_M) * (0.85 + 0.15 * fg.pulse) * near;
      f.glow({ pos: chest, color: GOLD.light, halo, light: lit(FURY_LIGHT_M, k), intensity: FURY_GLOW * (0.5 + 0.5 * fg.pulse) * k, core: 0.15 * fg.pulse * k * near }, FURY_PRIO);
      for (let n = due(moteAcc, it.id, FURY_MOTE_RATE * (0.5 + 0.5 * k), f.dt); n > 0; n--) {
        const q = { x: at.x + (rng() - 0.5) * 0.6, y: at.y + 0.8 + rng(), z: at.z + (rng() - 0.5) * 0.6 };
        specs.push(...burstParticles("furyMote", q, UP, 1, rng));
      }
    }
    for (const id of moteAcc.keys()) if (!liveFury.has(id)) moteAcc.delete(id);
  }

  function flush(m: InstancedMesh, attrs: readonly InstancedBufferAttribute[], n: number): void {
    for (const a of attrs) {
      a.clearUpdateRanges();
      if (n === 0) continue;
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    m.count = n;
    m.visible = n > 0;
  }

  return {
    world: null,
    light: group,
    sync(f) {
      const cur = f.cur;
      const list = cur.pickups;
      // объект смотрится на последнем посчитанном тике: на нём родились его события
      frameNow = cur.tick - 1;
      const ft = f.tick - 1;
      specs.length = 0;
      raw.length = 0;
      liveWarn.clear();
      nb = 0;
      ns = 0;
      if (seenReady.length !== list.length || frameNow < seenNow) {
        // новый список объектов (первый кадр, другая арена, новый мир): прошлое — из prev, если он того же мира
        const base = f.prev.pickups.length === list.length && f.prev.tick <= cur.tick ? f.prev : cur;
        seenNow = base.tick - 1;
        seenReady = base.pickups.map((q) => q.readyAt);
        shown = list.map(() => null);
        fadeFrom = list.map(() => null);
        goneS = list.map(() => -Infinity);
        flashS = list.map(() => -Infinity);
        warnAcc.clear();
      }
      for (let i = 0; i < list.length; i++) {
        const p = list[i]!;
        const old = seenReady[i]!;
        const floorY = p.pos.y - POINT_LIFT_M;
        // появился: прежний или новый срок наступил в окне (прежний — и тут же взят); вернувшийся откатом предсказания
        // (срок в прошлом) — тихо
        const spawned = inWin(old) || inWin(p.readyAt);
        let who: UnitId = NOBODY;
        let took = false;
        if (p.kind === "orb") {
          took = inWin(p.readyAt - ORB_RESPAWN_TICKS);
          if (took) who = orbTaker(f, p);
        } else if (p.readyAt !== old) {
          // руна ушла со своего срока: взята, если кто-то получил ярость в окне; иначе перенесена (отсчёт, новый бой)
          who = runeTaker(f);
          took = who !== NOBODY;
        }
        if (spawned) appear(f, i, p, floorY);
        if (took) take(f, p, floorY, who);
        seenReady[i] = p.readyAt;
        const here = pickupPresent(p, frameNow);
        if (p.kind === "orb") drawOrb(f, i, p, here, floorY, ft);
        else drawRune(f, i, p, here, floorY, ft, spawned || took);
      }
      seenNow = frameNow;
      for (const k of warnAcc.keys()) if (!liveWarn.has(k)) warnAcc.delete(k);
      drawFury(f);
      if (raw.length > 0) specs.push(...toGold(raw));
      if (specs.length > 0) f.emit(specs);
      flush(bodies, bodyAttrs, nb);
      flush(seals, sealAttrs, ns);
    },
    dispose() {
      bodyGeom.dispose();
      bodyMat.dispose();
      bodies.dispose();
      sealGeom.dispose();
      sealMat.dispose();
      seals.dispose();
      warnAcc.clear();
      moteAcc.clear();
      seenReady = [];
    },
  };
};
