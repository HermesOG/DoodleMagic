import { DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, Vector3, type ShaderMaterial } from "three";
import { PICKUPS, TICK_HZ, hasFury, pickupPresent, type PickupState, type Unit, type UnitId, type Vec3 } from "@doodlemagic/sim";
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
 *   и вспышка света; взятие — runeTake (своё — у ног, не в лицо).
 * - Носитель ярости: золотое свечение у груди, пульс 1,5 Гц (свет 2,5 м; ореол растёт с расстоянием — носитель виден
 *   на любой дистанции боя), за ним — искры furyMote ≤ 20/с; последние 2 с пульс чаще и гаснет. Свой — только искры
 *   у ладоней: ни ореола, ни света у камеры, прицел чист.
 * Мешей два (+2 вызова): тела (сферы и руна) и печати на полу. Частицы — общий пул, свет — общие свечения в лимите
 * пресета. Переходы «лежит → нет» и «нет → лежит» считаются от прошлого увиденного кадра, а не от пары prev / cur:
 * кадр с той же парой тиков всплеск не повторит, а пропущенный тик его не потеряет.
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
const ORB_PRIO = 0.3;

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
/** Свечение руны: свет 5 м, ореол не меньше 0,9 м; свет — выше рук магов, ниже снарядов. */
export const RUNE_LIGHT_M = 5;
const RUNE_HALO_M = 0.9;
const RUNE_HALO_PER_M = 0.02;
const RUNE_GLOW = 0.45;
const RUNE_PRIO = 1.4;
/** Вспышка появления руны: свет 7 м, гаснет за 0,5 с; приоритет — как у вспышек всплесков. */
export const RUNE_FLASH = { light: 7, halo: 1.6, intensity: 1.5, core: 0.9, life: 0.5, prio: 5 } as const;
/** Искры к центру печати в объявлении, в секунду: в начале и к появлению. */
const WARN_SPARKS = [6, 36] as const;
/** Печать взятой руны тает за столько секунд. */
const SEAL_FADE_S = 0.6;
/** Взял руну я: всплеск у ног и в 0,7 силы — не в лицо камеры. */
const OWN_TAKE_SCALE = 0.7;
/**
 * Всплеск взятия — только если у точки живой маг (по горизонтали не дальше этого): объекты, заведённые заново на
 * старте боя, исчезают без всплеска.
 */
const TAKE_NEAR_M = 1.6;

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
/** Свет носителя — выше рук магов и горения: носителя ищут глазами. */
const FURY_PRIO = 1.2;
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

  const rng: Rng = Math.random;
  // покадровое — одно на эффектник: кадр переписывает, а не создаёт
  const specs: ParticleSpec[] = [];
  /** Свои искры (объявление, ладони) — перекрашиваются в золото разом; всплески приходят золотыми из burstParticles. */
  const raw: ParticleSpec[] = [];
  /** По номеру объекта: лежал ли в прошлом кадре; когда руна исчезла (печать тает) и появилась (вспышка), с. */
  let known: boolean[] = [];
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

  function pushSeal(p: PickupState, floorY: number, look: SealLook, i: number): void {
    if (ns >= MAX_OBJECTS) return;
    const rune = p.kind === "rune";
    s0.setXYZW(ns, p.pos.x, floorY, p.pos.z, rune ? RUNE_SEAL_M : ORB_SEAL_M);
    s1.setXYZW(ns, rune ? 1 : 0, look.progress, look.ink, look.gold);
    // круг руны начинается с −Z (к мосту), у сфер засечки повёрнуты по номеру
    s2.setXYZW(ns, rune ? -Math.PI / 2 : i * 0.7, (i * 1.37) % 7, 0, 0);
    ns++;
  }

  /** Кто взял объект: ближний живой маг у точки (по горизонтали ≤ TAKE_NEAR_M, по высоте — в рост с запасом). */
  function takerOf(f: ElementVfxFrame, p: PickupState): UnitId | null {
    let best: UnitId | null = null;
    let bestD = TAKE_NEAR_M;
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

  /** Объект появился: сфера — кольцо искр из печати, руна — столб искр и вспышка. */
  function appear(f: ElementVfxFrame, i: number, p: PickupState, floorY: number): void {
    const base = { x: p.pos.x, y: floorY + 0.05, z: p.pos.z };
    if (p.kind === "orb") {
      specs.push(...burstParticles("orbSpawn", base, UP, 1, rng));
      return;
    }
    specs.push(...burstParticles("runeSpawn", base, UP, 1, rng));
    flashS[i] = f.nowS;
  }

  /** Объект исчез: взят магом — всплеск взятия; рядом никого (заведён заново) — тихо. Печать руны тает в любом случае. */
  function vanish(f: ElementVfxFrame, i: number, p: PickupState, floorY: number): void {
    if (p.kind === "rune") goneS[i] = f.nowS;
    const who = takerOf(f, p);
    if (who === null) return;
    if (p.kind === "orb") specs.push(...burstParticles("orbTake", { ...p.pos }, UP, 1, rng));
    else if (who === f.localId) specs.push(...burstParticles("runeTake", { x: p.pos.x, y: floorY + 0.1, z: p.pos.z }, UP, OWN_TAKE_SCALE, rng));
    else specs.push(...burstParticles("runeTake", { x: p.pos.x, y: floorY + RUNE_HOVER_M, z: p.pos.z }, UP, 1, rng));
  }

  function drawOrb(f: ElementVfxFrame, i: number, p: PickupState, here: boolean, floorY: number): void {
    const look = sealLook(p, f.tick);
    if (look) pushSeal(p, floorY, look, i);
    if (!here) return;
    // растёт из печати: поднимается с пола на свою высоту, пока растёт
    const g = growIn((f.tick - p.readyAt) / TICK_HZ, ORB_GROW_S);
    const up = Math.min(1, g);
    const phase = i * 1.7;
    const w = 2 * Math.PI * ORB_BOB_HZ * f.nowS + phase;
    const c = { x: p.pos.x, y: floorY + (POINT_LIFT_M + ORB_BOB_M * Math.sin(w)) * up, z: p.pos.z };
    const bright = 0.9 + 0.1 * Math.sin(w + 1);
    pushBody(c, false, ORB_R_M * g, turn(ORB_SPIN_HZ, f.nowS) + phase, bright, (i * 1.37) % 7);
    const halo = Math.max(ORB_HALO_M, dist(c, f.eye) * ORB_HALO_PER_M);
    f.glow({ pos: c, color: GOLD.light, halo: halo * up, light: ORB_LIGHT_M, intensity: ORB_GLOW * bright * up, core: 0.1 * up }, ORB_PRIO);
  }

  function drawRune(f: ElementVfxFrame, i: number, p: PickupState, here: boolean, floorY: number): void {
    const hover = { x: p.pos.x, y: floorY + RUNE_HOVER_M, z: p.pos.z };
    let look = sealLook(p, f.tick);
    if (here) {
      const g = growIn((f.tick - p.readyAt) / TICK_HZ, RUNE_GROW_S);
      const up = Math.min(1, g);
      const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * RUNE_PULSE_HZ * f.nowS);
      // поднимается к своей высоте, пока растёт; парит и медленно дышит светом
      const lift = (RUNE_HOVER_M + RUNE_BOB_M * Math.sin(2 * Math.PI * RUNE_BOB_HZ * f.nowS)) * (0.5 + 0.5 * up);
      const c = { x: p.pos.x, y: floorY + lift, z: p.pos.z };
      pushBody(c, true, RUNE_R_M * g, turn(RUNE_SPIN_HZ, f.nowS), pulse, (i * 1.37) % 7);
      if (look) look = { ...look, gold: look.gold * (0.8 + 0.4 * pulse) };
      const halo = Math.max(RUNE_HALO_M, dist(c, f.eye) * RUNE_HALO_PER_M);
      f.glow({ pos: c, color: GOLD.light, halo: halo * up, light: RUNE_LIGHT_M, intensity: RUNE_GLOW * (0.85 + 0.15 * pulse) * up, core: 0 }, RUNE_PRIO);
    } else if (look) {
      // объявление: к центру тянутся искры, свет на площадке разгорается
      const k = look.progress;
      liveWarn.add(i);
      for (let n = due(warnAcc, i, WARN_SPARKS[0] + (WARN_SPARKS[1] - WARN_SPARKS[0]) * k, f.dt); n > 0; n--) raw.push(warnSpark(hover, floorY, rng));
      if (k > 0) f.glow({ pos: hover, color: GOLD.light, halo: 0.6 * k * k, light: 3 * k, intensity: 0.6 * k * k, core: 0 }, RUNE_PRIO);
    } else {
      // взятая руна: печать тает
      const k = 1 - (f.nowS - goneS[i]!) / SEAL_FADE_S;
      if (k > 0 && k <= 1) look = { ink: RUNE_SEAL_INK * k, gold: RUNE_SEAL_GOLD * k, progress: 1 };
    }
    if (look) pushSeal(p, floorY, look, i);
    const age = f.nowS - flashS[i]!;
    if (age >= 0 && age < RUNE_FLASH.life) {
      const k = 1 - age / RUNE_FLASH.life;
      f.glow({ pos: hover, color: GOLD.light, halo: RUNE_FLASH.halo * (0.6 + 0.4 * k), light: RUNE_FLASH.light, intensity: RUNE_FLASH.intensity * k * k, core: RUNE_FLASH.core * k }, RUNE_FLASH.prio);
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
        // свой: искры у ладоней; идут вместе с руками — к своей скорости прибавлена скорость мага
        const v = it.u.move.body.vel;
        for (let n = due(moteAcc, it.id, OWN_MOTE_RATE * (0.4 + 0.6 * fg.fade), f.dt); n > 0; n--) {
          ownHand = !ownHand;
          const s = spawn(OWN_SPARK, f.palmWorld(ownHand ? "left" : "right"), UP, rng);
          s.vel = { x: s.vel.x + v.x, y: s.vel.y + v.y, z: s.vel.z + v.z };
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
      const halo = Math.max(FURY_HALO_M, dist(chest, f.eye) * FURY_HALO_PER_M) * (0.85 + 0.15 * fg.pulse);
      f.glow({ pos: chest, color: GOLD.light, halo, light: FURY_LIGHT_M, intensity: FURY_GLOW * (0.5 + 0.5 * fg.pulse) * k, core: 0.15 * fg.pulse * k }, FURY_PRIO);
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
      specs.length = 0;
      raw.length = 0;
      liveWarn.clear();
      nb = 0;
      ns = 0;
      if (known.length !== list.length) {
        // новый список объектов (первый кадр, другая арена): прошлое — из prev, если в нём тот же список
        const before = f.prev.pickups.length === list.length ? f.prev : cur;
        known = list.map((_, i) => pickupPresent(before.pickups[i]!, before.tick));
        goneS = list.map(() => -Infinity);
        flashS = list.map(() => -Infinity);
        warnAcc.clear();
      }
      for (let i = 0; i < list.length; i++) {
        const p = list[i]!;
        const here = pickupPresent(p, cur.tick);
        const floorY = p.pos.y - POINT_LIFT_M;
        if (here !== known[i]) {
          known[i] = here;
          if (here) appear(f, i, p, floorY);
          else vanish(f, i, p, floorY);
        }
        if (p.kind === "orb") drawOrb(f, i, p, here, floorY);
        else drawRune(f, i, p, here, floorY);
      }
      for (const k of warnAcc.keys()) if (!liveWarn.has(k)) warnAcc.delete(k);
      drawFury(f);
      if (raw.length > 0) specs.push(...toGold(raw));
      if (specs.length > 0) f.emit(specs);
      flush(bodies, [b0, b1], nb);
      flush(seals, [s0, s1, s2], ns);
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
      known = [];
    },
  };
};
