import type { Element } from "@doodlemagic/sim";
import { Matrix4, ShaderMaterial, Vector2, Vector3, Vector4, type DepthTexture, type Texture } from "three";
import { BAND_TINT, INK, INK_BY_ID, INK_COUNT, INK_STYLE, PAPER, SKY, SLEEVE_WASH, SUN_DIR, TONE, type InkName } from "./palette";

const v3 = (c: readonly [number, number, number]) => new Vector3(c[0], c[1], c[2]);
/** Плотности тонов чернил и доля температуры тона — одним vec4 (как ждёт `uInkBands`). */
const bandsOf = (n: InkName): Vector4 => {
  const s = INK_STYLE[n];
  return new Vector4(s.bands[0], s.bands[1], s.bands[2], s.tint ?? 0);
};

/**
 * Второй слой (руки) пишет глубину только в [0; OVERLAY_DEPTH_RANGE]: он всегда перед миром и не уходит в стену.
 * По этой же полосе стилевой проход узнаёт его пиксели и раскодирует их глубину камерой рук, а не мира.
 */
export const OVERLAY_DEPTH_RANGE = 0.02;

/** Число для GLSL: всегда с точкой, чтобы `#define` подставлял float, а не int. */
export function glslFloat(x: number): string {
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}

/**
 * Коэффициенты обратной дальности: 1 / D = x − y·d, где d — значение буфера глубины перспективной камеры
 * (диапазон 0…band), D — расстояние вдоль оси взгляда. Для d = (z_ndc + 1) / 2 выходит 1/near − d·(1/near − 1/far);
 * сжатый диапазон band делит наклон. Обратная дальность на любой плоскости линейна по экрану.
 */
export function inverseDepth(near: number, far: number, band: number, out: Vector2): Vector2 {
  return out.set(1 / near, (1 / near - 1 / far) / band);
}

/**
 * Дымка по дальности: от near до far метров доля растёт до max (даль холодеет, но не пропадает). 25…95 — под открытую
 * «Седловину» (Р15 фазы 7): на 40 м враг светлеет примерно на 8 %, на 50 м — на 20 %.
 */
export const FOG = { near: 25, far: 95, max: 0.7 } as const;

/**
 * Облака ущелья: всё ниже края `edge` (м) растворяется в облаках на глубине `fade` под ним; край течёт шумом
 * ±`sway` м по мировым x, z и времени, узор плывёт по x со скоростью `flow` м/с. `floor` — дно ущелья (низ обрывов
 * арены): на этой высоте взгляд ниже горизонта упирается в те же облака, и шва с обрывами нет.
 */
export const GORGE = { edge: -1.5, sway: 1.5, fade: 6, floor: -14, flow: 0.6 } as const;

/** Облака неба плывут по оси x мира: у зенита ≈ 0,01 рад/с. */
export const CLOUD_DRIFT = 0.01;

/** Доли неба: облака кроют на 0,35–0,55 (плотные ядра — сильнее), дальний хребет — на 0,7, ближний — на 0,85. */
export const SKY_SHARE = { cloud: [0.35, 0.55], ridgeFar: 0.7, ridgeNear: 0.85 } as const;

/** «Магия гасит день»: при k = 1 бумага, небо, дымка и облака × (1 − DAY_DIM); линии и метки не гаснут. */
export const DAY_DIM = 0.12;

/**
 * Общие униформы стилевого прохода — одни и те же объекты во всех материалах, которым они нужны (стилевой
 * проход, G-буфер, частицы окружения): запись в `value` сразу видна всем.
 * - `time` — секунды; каждый кадр пишет StyleRenderer (облака, ущелье, качание травы).
 * - `dayDim` — k «магии, гасящей день», от 0 до 1; пишет проход света, стилевой проход только читает.
 * - `sleeveWash` — тушь рукава своих рук: тот же Vector3, что `uInkWash[INK.sleeve]` (меняет setSleeveElement).
 */
export const styleShared = {
  time: { value: 0 },
  dayDim: { value: 0 },
  sleeveWash: { value: v3(INK_STYLE.sleeve.wash) },
};

/** Рукав своих рук — тушью стихии `el`: при выборе и смене стихии. */
export function setSleeveElement(el: Element): void {
  const c = SLEEVE_WASH[el];
  styleShared.sleeveWash.value.set(c[0], c[1], c[2]);
}

export const STYLE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Проход 2, единственный полноэкранный: контур, три тона размывки с тёплым светом и холодной тенью, бумага,
 * дымка по дальности, облака ущелья ниже пола и небо ясного дня там, где нет геометрии. 10 выборок (центр и крест
 * по 2 текстуры; бюджет — 13). Все выборки — texelFetch целых текселей; шум облаков, края ущелья и бумаги —
 * арифметика. Радиус контура растёт с высотой кадра. Узоры бумаги и сухой кисти — в CSS-пикселях, от пресета
 * не зависят.
 */
export const STYLE_FRAG = /* glsl */ `
uniform sampler2D gSurface;
uniform sampler2D gDepth;
uniform ivec2 uViewport;
uniform float uCssPerTexel;
uniform int uLineRadius;
uniform vec2 uWorldInvDepth;
uniform vec2 uOverlayInvDepth;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform float uTime;
uniform float uDayDim;
uniform vec3 uPaperTone;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunGlow;
uniform vec2 uSunAzimuth;
uniform vec3 uCloud;
uniform vec3 uRidgeFar;
uniform vec3 uRidgeNear;
uniform vec3 uHaze;
uniform vec3 uGorgeTop;
uniform vec3 uGorgeDeep;
uniform vec2 uFog;
uniform vec3 uBandTint[3];
uniform vec3 uInkWash[INK_COUNT];
// x, y, z — плотность в свету, полутоне и тени; w — доля температуры тона uBandTint
uniform vec4 uInkBands[INK_COUNT];
uniform vec3 uInkLine[INK_COUNT];
varying vec2 vUv;

// крест выборок: влево, вправо, вниз, вверх; пары (0, 1) и (2, 3) — две оси экрана
const ivec2 TAPS[4] = ivec2[4](ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1));
// пиксели рук ближе любого пикселя мира: в сравнении «кто впереди» их обратная дальность поднята на это
const float OVERLAY_LEAD = 1.0e4;
// излом наклона обратной дальности, с которого начинается и где насыщается линия по глубине
const float BREAK_LO = 0.35;
const float BREAK_HI = 0.6;
// пол чувствительности: плоскость почти анфас даёт шаги ~0, и без пола линию рисовал бы шум глубины
const float SLOPE_FLOOR = 0.02;

// целочисленный хеш: одинаково на всех GPU, без sin()
uint hashU(uvec2 q) {
  uint h = q.x * 2654435769u ^ (q.y + 0x9e3779b9u) * 2246822519u;
  h ^= h >> 15;
  h *= 3266489917u;
  h ^= h >> 13;
  return h;
}

float hash(vec2 p) {
  return float(hashU(uvec2(ivec2(floor(p)) + 32768))) / 4294967295.0;
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

int inkOf(vec4 g) {
  return clamp(int(g.g * 255.0 + 0.5), 0, INK_COUNT - 1);
}

// нормаль из октаэдрической развёртки (B, A): обе полусферы, знак z сохраняется
vec3 octDecode(vec2 e) {
  vec2 f = e * 2.0 - 1.0;
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  float fold = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -fold : fold;
  n.y += n.y >= 0.0 ? -fold : fold;
  return normalize(n);
}

// 1 / D по значению буфера глубины: мир и руки — каждый своей камерой
float invDist(float d, bool overlay) {
  vec2 k = overlay ? uOverlayInvDepth : uWorldInvDepth;
  return k.x - k.y * d;
}

// Согласие наклонов 1/D по одной оси: две разности через центр (сосед сзади — центр, центр — сосед спереди),
// их расхождение, делённое на сумму их модулей, — число от 0 до 1. 0 — разности совпадают: три текселя лежат
// на одной плоскости, ведь 1/D меняется вдоль экрана линейно. 1 — одна разность несёт скачок на другую
// поверхность. Числитель и знаменатель линейны по 1/D, поэтому общий множитель всех глубин сокращается
// и порогу не нужна поправка на расстояние. SLOPE_FLOOR не даёт почти нулевым разностям (грань смотрит
// прямо в камеру) раздувать квантование буфера глубины в линию.
float slopeBreak(float wBack, float wMid, float wFwd) {
  float back = wMid - wBack;
  float fwd = wFwd - wMid;
  return abs(fwd - back) / (abs(back) + abs(fwd) + SLOPE_FLOOR * wMid);
}

// Бумага: длинные тонкие волокна в двух направлениях (шум, сжатый поперёк волокна, — видны только гребни),
// медленная облачная неровность проклейки и редкие тёмные соринки. Координаты — CSS-пиксели. Возвращает тон
// бумаги в пикселе (около 1): на него множатся бумага, небо, дымка и облака — волокна проступают везде.
float paperGrain(vec2 css) {
  vec2 a = mat2(0.94, 0.34, -0.34, 0.94) * css;
  vec2 b = mat2(0.82, -0.57, 0.57, 0.82) * css;
  float fibreA = smoothstep(0.66, 0.86, noise(vec2(a.x * 0.045, a.y * 0.42) + 11.0));
  float fibreB = smoothstep(0.7, 0.9, noise(vec2(b.x * 0.06, b.y * 0.5) + 57.0));
  float cloud = noise(css * 0.011 + 3.0) * 0.7 + noise(css * 0.027 + 29.0) * 0.3;
  vec2 cell = floor(css / 6.0);
  vec2 spot = cell * 6.0 + 1.5 + 3.0 * vec2(hash(cell + vec2(13.0, 0.0)), hash(cell + vec2(0.0, 37.0)));
  float speck = step(0.996, hash(cell + vec2(71.0, 71.0))) * (1.0 - smoothstep(0.5, 1.4, length(css - spot)));
  return 1.0 + 0.045 * (cloud - 0.5) - 0.022 * fibreA - 0.015 * fibreB - 0.18 * speck;
}

// Высота края облаков ущелья в точке xz мира: два слоя шума плывут по x навстречу друг другу, край ходит
// на ±GORGE_SWAY м около GORGE_EDGE — облака текут и клубятся у обрывов.
float gorgeEdge(vec2 xz) {
  float flow = GORGE_FLOW * uTime;
  float n = noise(vec2(xz.x - flow, xz.y) * 0.3 + 71.0) * 0.65 + noise(vec2(xz.x + 0.5 * flow, xz.y) * 0.7 + 13.0) * 0.35;
  return GORGE_EDGE + GORGE_SWAY * (2.0 * n - 1.0);
}

// Облака в тени ущелья: светлый верх у края, а где облака уже скрыли обрывы (GORGE_FADE ниже края) — тёмная
// глубина; так пропасть темнеет книзу и темнее пола. Клубы плывут вместе с краем. Узор берёт и высоту, чтобы
// на отвесных обрывах не было полос; вдали клубы гладятся (dist), чтобы шум не рябил. Без бумаги и дня.
vec3 gorgeCloud(vec3 wp, float dist) {
  vec2 q = vec2(wp.x + 0.5 * wp.y - GORGE_FLOW * uTime, wp.z - 0.5 * wp.y);
  float billow = noise(q * 0.22 + 5.0) * 0.6 + noise(q * 0.53 + 19.0) * 0.4;
  vec3 c = mix(uGorgeTop, uGorgeDeep, 1.0 - smoothstep(GORGE_EDGE - GORGE_FADE, GORGE_EDGE, wp.y));
  return c * (1.0 + 0.1 * (billow - 0.5) * (1.0 - smoothstep(40.0, 120.0, dist)));
}

// Воздух у пикселя мира по его глубине: x — доля дымки по дальности, y — доля облаков ущелья ниже пола.
// wp — точка в мире, dist — дальность вдоль взгляда. Выше верхнего предела края облаков шум не считаем.
vec2 airAt(vec2 uv, float d, out vec3 wp, out float dist) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 vp = v.xyz / v.w;
  wp = (uCamWorld * vec4(vp, 1.0)).xyz;
  // евклидова дальность — как у неба ниже горизонта: дымка не шьётся с ним и не поворачивается с камерой
  dist = length(vp);
  float gorge = 0.0;
  // верх края облаков совпал бы с полом (y = 0): шум глубины пола платил бы шум края — порог чуть ниже
  if (wp.y < GORGE_EDGE + GORGE_SWAY - 0.05) {
    float top = gorgeEdge(wp.xz);
    gorge = 1.0 - smoothstep(top - GORGE_FADE, top, wp.y);
  }
  return vec2(FOG_MAX * smoothstep(uFog.x, uFog.y, dist), gorge);
}

// Небо ясного дня (без бумаги и дня — их множит вызывающий). dir — единичное направление взгляда в мире,
// cam — точка камеры: ниже горизонта взгляд упирается в облака на высоте дна ущелья, у горизонта — в дымку.
vec3 skyColor(vec3 dir, vec3 cam) {
  float e = dir.y;
  vec2 az = dir.xz / max(1e-4, length(dir.xz));
  vec3 col = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.7, e));
  // облака — слой на плоскости над камерой (dir.xz / e): двумерный шум, без зеркальной симметрии по азимуту
  // и без стяжки в зените; вытянуты по оси x мира и плывут вдоль неё (второй слой быстрее — облака меняются),
  // к зениту и к горизонту гаснут; плотные ядра кроют сильнее
  if (e > 0.02) {
    vec2 sp = dir.xz / e;
    float drift = CLOUD_DRIFT * uTime;
    float cl = noise(vec2((sp.x - drift) * 0.9, sp.y * 2.6) + 40.0) * 0.65 + noise(vec2(sp.x - 1.6 * drift, sp.y) * 3.1 + 5.0) * 0.35;
    float layer = smoothstep(0.04, 0.2, e) * (1.0 - smoothstep(0.7, 0.95, e));
    float share = mix(CLOUD_SHARE_LO, CLOUD_SHARE_HI, smoothstep(0.66, 0.84, cl));
    col = mix(col, uCloud, share * smoothstep(0.52, 0.7, cl) * layer);
  }
  // ниже горизонта — облака в тени на высоте дна ущелья (как у обрывов), вдали и у горизонта — дымка
  if (e < 0.0) {
    float t = clamp((GORGE_FLOOR - cam.y) / min(e, -1e-3), 0.0, 400.0);
    vec3 below = gorgeCloud(cam + dir * t, t);
    below = mix(below, uHaze, FOG_MAX * smoothstep(uFog.x, uFog.y, t));
    // к горизонту снизу — в цвет горизонта, без ступеньки под хребтами
    col = mix(below, col, smoothstep(-0.1, 0.0, e));
  }
  // два слоя гор: дальний светлее и выше; подножия обоих уходят в дымку
  float farRidge = 0.05 + 0.11 * noise(az * 2.2 + 17.0) + 0.03 * noise(az * 7.0 + 3.0);
  float nearRidge = 0.015 + 0.06 * noise(az * 3.1 + 61.0) + 0.02 * noise(az * 11.0 + 9.0);
  float fade = smoothstep(-0.06, 0.02, e);
  vec3 farCol = mix(uHaze, uRidgeFar, smoothstep(-0.02, farRidge, e));
  vec3 nearCol = mix(uHaze, uRidgeNear, smoothstep(-0.02, nearRidge, e));
  col = mix(col, farCol, RIDGE_FAR_SHARE * fade * (1.0 - smoothstep(farRidge - 0.002, farRidge + 0.002, e)));
  col = mix(col, nearCol, RIDGE_NEAR_SHARE * fade * (1.0 - smoothstep(nearRidge - 0.002, nearRidge + 0.002, e)));
  // тёплое пятно у горизонта со стороны солнца, без диска: светится воздух, поэтому ложится и на хребты
  float sunward = max(dot(az, uSunAzimuth), 0.0);
  sunward *= sunward;
  col += uSunGlow * (sunward * sunward) * (1.0 - smoothstep(-0.02, 0.4, e)) * smoothstep(-0.08, 0.0, e);
  return col;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 last = uViewport - 1;
  vec4 gC = texelFetch(gSurface, p, 0);
  float dC = texelFetch(gDepth, p, 0).r;
  int inkC = inkOf(gC);
  bool skyC = dC >= 1.0;
  bool ovC = dC < OVERLAY_BAND;
  float wC = invDist(dC, ovC);

  // руки (варежка и рукав) обведены толще: со стороны руки радиус выборки вдвое больше — в сумме линия
  // в 1,5 раза толще
  int r = (inkC == INK_HANDS || inkC == INK_SLEEVE) ? 2 * uLineRadius : uLineRadius;
  vec4 g[4];
  float d[4];
  float w[4];
  int ink[4];
  bool ov[4];
  bool off[4];
  for (int i = 0; i < 4; i++) {
    ivec2 want = p + TAPS[i] * r;
    ivec2 q = clamp(want, ivec2(0), last);
    // выборка за краем кадра прижата к краю: по ней наклон не судим (см. ниже)
    off[i] = q != want;
    g[i] = texelFetch(gSurface, q, 0);
    d[i] = texelFetch(gDepth, q, 0).r;
    ov[i] = d[i] < OVERLAY_BAND;
    w[i] = invDist(d[i], ov[i]);
    ink[i] = inkOf(g[i]);
  }

  // линия по глубине: излом наклона 1/D по каждой оси; стык рук и мира — всегда линия (шкалы глубины разные).
  // Если выборка оси ушла за край кадра, её прижатый тексель стоит ближе r (или это сам центр), и шаг по нему
  // ложный — у края кадра вдоль оси была бы линия на ровном полу. Такую ось по наклону не судим.
  float edge = 0.0;
  for (int a = 0; a < 2; a++) {
    int i = 2 * a;
    int j = i + 1;
    float brk = (ov[i] != ovC || ov[j] != ovC) ? 1.0 : (off[i] || off[j]) ? 0.0 : slopeBreak(w[i], wC, w[j]);
    edge = max(edge, smoothstep(BREAK_LO, BREAK_HI, brk));
  }

  // линия по излому нормали: острые рёбра боксов (небо и другой слой не сравниваем)
  if (!skyC) {
    vec3 nC = octDecode(gC.ba);
    float bend = 0.0;
    for (int i = 0; i < 4; i++) {
      if (d[i] >= 1.0 || ov[i] != ovC) continue;
      bend = max(bend, 1.0 - dot(nC, octDecode(g[i].ba)));
    }
    edge = max(edge, smoothstep(0.15, 0.4, bend));
  }

  // граница разных чернил на одной плоскости — тоже линия, но тоньше
  bool border = false;
  for (int i = 0; i < 4; i++) border = border || ink[i] != inkC;
  if (border) edge = max(edge, 0.7);

  // тушь линии — у самой близкой к камере из пяти выборок: силуэт рисуется тушью переднего предмета
  float front = ovC ? OVERLAY_LEAD + wC : wC;
  int inkF = inkC;
  float dF = dC;
  float wF = wC;
  bool ovF = ovC;
  for (int i = 0; i < 4; i++) {
    float nearness = ov[i] ? OVERLAY_LEAD + w[i] : w[i];
    if (nearness > front) {
      front = nearness;
      inkF = ink[i];
      dF = d[i];
      wF = w[i];
      ovF = ov[i];
    }
  }
  // трава — мазки почти без контура
  if (inkF == INK_GRASS) edge *= 0.3;

  vec2 css = gl_FragCoord.xy * uCssPerTexel;
  // день: тон бумаги в пикселе, «магия гасит день» — бумага, небо, дымка и облака гаснут вместе,
  // линии и метки (ореолы, глаза, магия — без бумаги) нет
  float day = (1.0 - DAY_DIM * clamp(uDayDim, 0.0, 1.0)) * paperGrain(css);
  vec3 paper = uPaperTone * day;

  vec3 col;
  if (skyC) {
    vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    col = skyColor(normalize(mat3(uCamWorld) * (v.xyz / v.w)), uCamWorld[3].xyz) * day;
  } else {
    // три тона размывки; порог чуть дрожит по шуму, чтобы граница тона была мазком, а не линейкой.
    // Температура тона идёт за плотностью: тёплый свет, холодная тень (доля — bands.w)
    float t = gC.r + (noise(css * 0.045) - 0.5) * (2.0 * TONE_JITTER);
    vec4 bands = uInkBands[inkC];
    float toMid = smoothstep(TONE_MID - TONE_SOFT, TONE_MID + TONE_SOFT, t);
    float toLight = smoothstep(TONE_LIGHT - TONE_SOFT, TONE_LIGHT + TONE_SOFT, t);
    float density = mix(mix(bands.z, bands.y, toMid), bands.x, toLight);
    vec3 tint = mix(mix(uBandTint[2], uBandTint[1], toMid), uBandTint[0], toLight);
    density *= 0.96 + 0.08 * noise(css * 0.015 + 7.0);
    col = mix(paper, uInkWash[inkC], clamp(density, 0.0, 1.0)) * mix(vec3(1.0), tint, bands.w);
    // облака ущелья и дымка — только для мира: руки всегда ясные
    if (!ovC) {
      vec3 wp;
      float dist;
      vec2 air = airAt(vUv, dC, wp, dist);
      if (air.y > 0.0) col = mix(col, gorgeCloud(wp, dist) * day, air.y);
      col = mix(col, uHaze * day, air.x);
    }
  }

  // Линия: сухая кисть и нажим. Где кисть пересыхает, линия рвётся короткими пропусками — отдельный шум,
  // пороговый, привязанный к бумаге; близкие линии прижаты сильнее, дальние легче (дымка и облака добавляют своё).
  float dry = mix(0.3, 1.0, smoothstep(0.14, 0.28, noise(css * 0.05 + 231.0)));
  float pressure = ovF ? 1.0 : mix(1.0, 0.8, smoothstep(8.0, 60.0, 1.0 / wF));
  float lineFog = 0.0;
  // без линии (edge = 0) дымка линии не нужна — второй airAt не считаем
  if (!ovF && dF < 1.0 && edge > 0.0) {
    vec3 wpF;
    float distF;
    vec2 airF = airAt(vUv, dF, wpF, distF);
    lineFog = max(airF.x, airF.y);
  }
  float amount = edge * dry * pressure * (1.0 - lineFog);
  col = mix(col, uInkLine[inkF], clamp(amount, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Материал стилевого прохода. Размер, масштаб, матрицы и раскодировку глубины обновляет StyleRenderer. */
export function createStyleMaterial(surface: Texture, depth: DepthTexture): ShaderMaterial {
  const sun = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
  return new ShaderMaterial({
    name: "style-pass",
    defines: {
      INK_COUNT,
      INK_HANDS: INK.hands,
      INK_SLEEVE: INK.sleeve,
      INK_GRASS: INK.grass,
      OVERLAY_BAND: glslFloat(OVERLAY_DEPTH_RANGE),
      TONE_MID: glslFloat(TONE.mid),
      TONE_LIGHT: glslFloat(TONE.light),
      TONE_SOFT: glslFloat(TONE.soft),
      TONE_JITTER: glslFloat(TONE.jitter),
      FOG_MAX: glslFloat(FOG.max),
      DAY_DIM: glslFloat(DAY_DIM),
      GORGE_EDGE: glslFloat(GORGE.edge),
      GORGE_SWAY: glslFloat(GORGE.sway),
      GORGE_FADE: glslFloat(GORGE.fade),
      GORGE_FLOOR: glslFloat(GORGE.floor),
      GORGE_FLOW: glslFloat(GORGE.flow),
      CLOUD_DRIFT: glslFloat(CLOUD_DRIFT),
      CLOUD_SHARE_LO: glslFloat(SKY_SHARE.cloud[0]),
      CLOUD_SHARE_HI: glslFloat(SKY_SHARE.cloud[1]),
      RIDGE_FAR_SHARE: glslFloat(SKY_SHARE.ridgeFar),
      RIDGE_NEAR_SHARE: glslFloat(SKY_SHARE.ridgeNear),
    },
    uniforms: {
      gSurface: { value: surface },
      gDepth: { value: depth },
      uViewport: { value: new Vector2(1, 1) },
      uCssPerTexel: { value: 1 },
      uLineRadius: { value: 1 },
      uWorldInvDepth: { value: new Vector2(1, 0) },
      uOverlayInvDepth: { value: new Vector2(1, 0) },
      uProjInv: { value: new Matrix4() },
      uCamWorld: { value: new Matrix4() },
      // общие на все материалы: время, «магия гасит день» (см. styleShared)
      uTime: styleShared.time,
      uDayDim: styleShared.dayDim,
      uPaperTone: { value: v3(PAPER) },
      uSkyZenith: { value: v3(SKY.zenith) },
      uSkyHorizon: { value: v3(SKY.horizon) },
      uSunGlow: { value: v3(SKY.sunGlow) },
      uSunAzimuth: { value: new Vector2(SUN_DIR[0] / sun, SUN_DIR[2] / sun) },
      uCloud: { value: v3(SKY.cloud) },
      uRidgeFar: { value: v3(SKY.ridgeFar) },
      uRidgeNear: { value: v3(SKY.ridgeNear) },
      uHaze: { value: v3(SKY.haze) },
      uGorgeTop: { value: v3(SKY.gorgeTop) },
      uGorgeDeep: { value: v3(SKY.gorgeDeep) },
      uFog: { value: new Vector2(FOG.near, FOG.far) },
      uBandTint: { value: BAND_TINT.map(v3) },
      // рукав — общий Vector3 из styleShared: смена стихии видна без пересборки массива
      uInkWash: { value: INK_BY_ID.map((n) => (n === "sleeve" ? styleShared.sleeveWash.value : v3(INK_STYLE[n].wash))) },
      uInkBands: { value: INK_BY_ID.map((n) => bandsOf(n)) },
      uInkLine: { value: INK_BY_ID.map((n) => v3(INK_STYLE[n].line)) },
    },
    vertexShader: STYLE_VERT,
    fragmentShader: STYLE_FRAG,
    depthTest: false,
    depthWrite: false,
  });
}
