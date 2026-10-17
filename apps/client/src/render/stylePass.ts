import { Matrix4, ShaderMaterial, Vector2, Vector3, type DepthTexture, type Texture } from "three";
import { INK, INK_BY_ID, INK_COUNT, INK_STYLE, PAPER, TONE } from "./palette";

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

export const STYLE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Проход 2, единственный полноэкранный: контур, три тона размывки, бумага, туман к цвету бумаги,
 * «пустота» ниже пола и небо там, где нет геометрии. 10 выборок (центр и крест по 2 текстуры; бюджет — 13).
 * Все выборки — texelFetch целых текселей; радиус контура растёт с высотой кадра. Узоры бумаги и сухой кисти —
 * в CSS-пикселях, от пресета не зависят.
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
uniform vec3 uPaperTone;
uniform vec3 uSkyInk;
uniform vec2 uFog;
uniform vec3 uInkWash[INK_COUNT];
uniform vec3 uInkBands[INK_COUNT];
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
// медленная облачная неровность проклейки и редкие тёмные соринки. Координаты — CSS-пиксели.
vec3 paperAt(vec2 css) {
  vec2 a = mat2(0.94, 0.34, -0.34, 0.94) * css;
  vec2 b = mat2(0.82, -0.57, 0.57, 0.82) * css;
  float fibreA = smoothstep(0.66, 0.86, noise(vec2(a.x * 0.045, a.y * 0.42) + 11.0));
  float fibreB = smoothstep(0.7, 0.9, noise(vec2(b.x * 0.06, b.y * 0.5) + 57.0));
  float cloud = noise(css * 0.011 + 3.0) * 0.7 + noise(css * 0.027 + 29.0) * 0.3;
  vec2 cell = floor(css / 6.0);
  vec2 spot = cell * 6.0 + 1.5 + 3.0 * vec2(hash(cell + vec2(13.0, 0.0)), hash(cell + vec2(0.0, 37.0)));
  float speck = step(0.996, hash(cell + vec2(71.0, 71.0))) * (1.0 - smoothstep(0.5, 1.4, length(css - spot)));
  float tone = 1.0 + 0.045 * (cloud - 0.5) - 0.022 * fibreA - 0.015 * fibreB - 0.18 * speck;
  return uPaperTone * tone;
}

// туман по дальности и «пустота» ниже пола: ущелье растворяется в бумаге (только для мира)
float fogAt(vec2 uv, float d) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 vp = v.xyz / v.w;
  vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
  float haze = 0.85 * smoothstep(uFog.x, uFog.y, -vp.z);
  float gorge = 1.0 - smoothstep(-9.0, -0.5, wp.y);
  return max(haze, gorge);
}

vec3 skyColor(vec3 dir, vec3 paper) {
  float e = dir.y;
  vec3 col = mix(paper, uSkyInk, 0.3 * smoothstep(0.02, 0.85, e));
  // облака — слой на плоскости над камерой (dir.xz / e): двумерный шум, без зеркальной симметрии по азимуту
  // и без стяжки в зените; вытянуты по оси x мира, к зениту и к горизонту гаснут
  if (e > 0.02) {
    vec2 sp = dir.xz / e;
    float cl = noise(vec2(sp.x * 0.9, sp.y * 2.6) + 40.0) * 0.65 + noise(sp * 3.1 + 5.0) * 0.35;
    float layer = smoothstep(0.08, 0.3, e) * (1.0 - smoothstep(0.5, 0.8, e));
    col = mix(col, uSkyInk, 0.12 * smoothstep(0.58, 0.78, cl) * layer);
  }
  // два слоя гор: дальний светлее и выше; у подножия оба растворяются в бумаге
  vec2 c = dir.xz / max(1e-4, length(dir.xz));
  float farRidge = 0.05 + 0.11 * noise(c * 2.2 + 17.0) + 0.03 * noise(c * 7.0 + 3.0);
  float nearRidge = 0.015 + 0.06 * noise(c * 3.1 + 61.0) + 0.02 * noise(c * 11.0 + 9.0);
  float fade = smoothstep(-0.06, 0.04, e);
  col = mix(col, uSkyInk, 0.22 * fade * (1.0 - smoothstep(farRidge - 0.002, farRidge + 0.002, e)));
  col = mix(col, uSkyInk, 0.4 * fade * (1.0 - smoothstep(nearRidge - 0.002, nearRidge + 0.002, e)));
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

  // руки обведены толще: со стороны руки радиус выборки вдвое больше — в сумме линия в 1,5 раза толще
  int r = inkC == INK_HANDS ? 2 * uLineRadius : uLineRadius;
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
  vec3 paper = paperAt(css);

  vec3 col;
  if (skyC) {
    vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    col = skyColor(normalize(mat3(uCamWorld) * (v.xyz / v.w)), paper);
  } else {
    // три тона размывки; порог чуть дрожит по шуму, чтобы граница тона была мазком, а не линейкой
    float t = gC.r + (noise(css * 0.045) - 0.5) * (2.0 * TONE_JITTER);
    vec3 bands = uInkBands[inkC];
    float density = mix(bands.z, bands.y, smoothstep(TONE_MID - TONE_SOFT, TONE_MID + TONE_SOFT, t));
    density = mix(density, bands.x, smoothstep(TONE_LIGHT - TONE_SOFT, TONE_LIGHT + TONE_SOFT, t));
    density *= 0.96 + 0.08 * noise(css * 0.015 + 7.0);
    col = mix(paper, uInkWash[inkC], clamp(density, 0.0, 1.0));
    // туман и пустота — только для мира: руки всегда ясные
    if (!ovC) col = mix(col, paper, fogAt(vUv, dC));
  }

  // Линия: сухая кисть и нажим. Где кисть пересыхает, линия рвётся короткими пропусками — отдельный шум,
  // пороговый, привязанный к бумаге; близкие линии прижаты сильнее, дальние легче (туман добавляет своё).
  float dry = mix(0.3, 1.0, smoothstep(0.14, 0.28, noise(css * 0.05 + 231.0)));
  float pressure = ovF ? 1.0 : mix(1.0, 0.8, smoothstep(8.0, 60.0, 1.0 / wF));
  float lineFog = (ovF || dF >= 1.0) ? 0.0 : fogAt(vUv, dF);
  float amount = edge * dry * pressure * (1.0 - lineFog);
  col = mix(col, uInkLine[inkF], clamp(amount, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

const v3 = (c: readonly [number, number, number]) => new Vector3(c[0], c[1], c[2]);

/** Материал стилевого прохода. Размер, масштаб, матрицы и раскодировку глубины обновляет StyleRenderer. */
export function createStyleMaterial(surface: Texture, depth: DepthTexture): ShaderMaterial {
  return new ShaderMaterial({
    name: "style-pass",
    defines: {
      INK_COUNT,
      INK_HANDS: INK.hands,
      INK_GRASS: INK.grass,
      OVERLAY_BAND: glslFloat(OVERLAY_DEPTH_RANGE),
      TONE_MID: glslFloat(TONE.mid),
      TONE_LIGHT: glslFloat(TONE.light),
      TONE_SOFT: glslFloat(TONE.soft),
      TONE_JITTER: glslFloat(TONE.jitter),
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
      uPaperTone: { value: v3(PAPER) },
      uSkyInk: { value: new Vector3(0.36, 0.38, 0.42) },
      uFog: { value: new Vector2(18, 75) },
      uInkWash: { value: INK_BY_ID.map((n) => v3(INK_STYLE[n].wash)) },
      uInkBands: { value: INK_BY_ID.map((n) => v3(INK_STYLE[n].bands)) },
      uInkLine: { value: INK_BY_ID.map((n) => v3(INK_STYLE[n].line)) },
    },
    vertexShader: STYLE_VERT,
    fragmentShader: STYLE_FRAG,
    depthTest: false,
    depthWrite: false,
  });
}
