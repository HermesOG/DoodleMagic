import { CustomBlending, DoubleSide, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, type IUniform, type Side } from "three";
import { INK } from "../render/palette";
import { glslFloat } from "../render/stylePass";
import { OVERLAY_DEPTH_RANGE, type StyleRenderer } from "../render/styleRenderer";

export type FxGBuffer = StyleRenderer["gbuffer"];

/**
 * Проход света (решение Р1): общий кусок GLSL всех материалов света. Глубину и чернила под пикселем читаем из
 * G-буфера (texelFetch целых текселей, как стилевой проход): у холста нет своего буфера глубины.
 * Свет поверх бумаги всегда ярче того, что под ним, — поэтому магия и остаётся самым ярким в кадре.
 */
export const FX_COMMON = /* glsl */ `
uniform sampler2D gDepth;
uniform sampler2D gSurface;
uniform vec2 uInvDepth;
float fxDist(float d) { return 1.0 / (uInvDepth.x - uInvDepth.y * d); }
// Над тушью врага плотному (альфа — пламя, пыль, дым) остаётся ещё меньше, чем свету: fxVisibility запоминает здесь
// множитель, fxDense применяет его к альфе. Иначе перекрывающиеся языки набирают заливку и топят силуэт.
float fxDenseK = 1.0;
int fxInkAt(ivec2 p) { return int(texelFetch(gSurface, p, 0).g * 255.0 + 0.5); }
// враг — его тушь, ореол, вспышка и метки на нём: глаза стихии и тёплый ореол горения (номера подряд, eyeFire…haloBurn)
bool fxIsEnemy(int ink) { return ink == INK_ENEMY || ink == INK_HALO || ink == INK_FLASH || (ink >= INK_EYE_FIRE && ink <= INK_HALO_BURN); }
// 0 — фрагмент за миром или за рукой; у пересечения с миром мягко гаснет на softM метрах;
// над тушью врага, его ореолом и вспышкой — четверть: магический свет на врага не падает, силуэт читается
float fxVisibility(float softM) {
#ifdef FX_NO_DEPTH
  return 1.0;
#else
  ivec2 p = ivec2(gl_FragCoord.xy);
  float d = texelFetch(gDepth, p, 0).r;
  if (d < OVERLAY_BAND) return 0.0;
  float gap = fxDist(d) - fxDist(gl_FragCoord.z);
  if (gap <= 0.0) return 0.0;
  float vis = clamp(gap / softM, 0.0, 1.0);
  if (fxIsEnemy(fxInkAt(p))) {
    vis *= FX_ENEMY_LIGHT;
    fxDenseK = FX_ENEMY_DENSE / FX_ENEMY_LIGHT;
  }
  return vis;
#endif
}
// видимость плотного слоя: после fxVisibility; над врагом — FX_ENEMY_DENSE вместо FX_ENEMY_LIGHT
float fxDense(float vis) { return vis * fxDenseK; }
// нормаль поверхности в пространстве камеры из октаэдрической развёртки G-буфера (B, A)
vec3 fxNormalAt(ivec2 p) {
  vec2 f = texelFetch(gSurface, p, 0).ba * 2.0 - 1.0;
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  float fold = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -fold : fold;
  n.y += n.y >= 0.0 ? -fold : fold;
  return normalize(n);
}
// целочисленный хеш: одинаково на всех GPU, без sin()
uint fxHashU(uvec2 q) {
  uint h = q.x * 2654435769u ^ (q.y + 0x9e3779b9u) * 2246822519u;
  h ^= h >> 15;
  h *= 3266489917u;
  h ^= h >> 13;
  return h;
}
float fxHash(vec2 p) { return float(fxHashU(uvec2(ivec2(floor(p)) + 32768))) / 4294967295.0; }
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), u.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// три октавы; FX_CHEAP (пресеты «Низкое» и «Среднее») — две
float fxFbm(vec2 p) {
#ifdef FX_CHEAP
  return 0.65 * fxNoise(p) + 0.35 * fxNoise(p * 2.03 + 17.0);
#else
  return 0.55 * fxNoise(p) + 0.3 * fxNoise(p * 2.03 + 17.0) + 0.15 * fxNoise(p * 4.1 + 41.0);
#endif
}
// гауссов колокол e^(−u²): без pow() — у pow с отрицательным основанием в GLSL ES результат не определён
float fxBell(float u) { return exp(-u * u); }
// Свет как глазурь (V1): добавляет цвет и гасит подложку на долю своей насыщенности (× tint), чтобы на светлой
// бумаге оранжевый и нефрит не выцветали в крем, — но не сильнее, чем светит сам (яркость / 0,7: мир в свету
// не темнеет) и не больше 0,9. Потолок белого 0,97: альфа не меньше доли света от 0,97 — слой не поднимет пиксель
// выше 0,97, а под ним ничего не потемнеет (как «экран»). Белое ядро — сложение с этим потолком.
vec4 fxLight(vec3 light, float tint) {
  light = min(light, vec3(FX_WHITE));
  float hi = max(light.r, max(light.g, light.b));
  float lo = min(light.r, min(light.g, light.b));
  float sat = hi > 1e-4 ? (hi - lo) / hi : 0.0;
  float lum = dot(light, vec3(0.2126, 0.7152, 0.0722));
  float glaze = min(min(sat * tint, lum / FX_GLAZE_LUM), FX_GLAZE_MAX);
  return vec4(light, clamp(max(glaze, hi / FX_WHITE), 0.0, 1.0));
}
// плотный слой (rgb, альфа) и свет поверх него — в один предумноженный цвет
vec4 fxCompose(vec3 inkRgb, float inkA, vec4 light) {
  return vec4(inkRgb * inkA + light.rgb, inkA + light.a * (1.0 - inkA));
}
// края ячеек шума: 0 на границе двух ячеек (трещина), растёт к центру ячейки
float fxCells(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(fxHash(i + g), fxHash(i + g + 71.0));
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return d2 - d1;
}
`;

/**
 * Над тушью врага, его ореолом и вспышкой (GDD 6, «магический свет на вражескую тушь не падает»): свет — четверть,
 * плотное (пламя, пыль, дым, тушь декалей) — десятая доля, чтобы перекрывающиеся языки взрыва не залили силуэт.
 */
export const ENEMY_LIGHT = 0.25;
export const ENEMY_DENSE = 0.1;

/**
 * Глазурь света (V1, рецензия 02): потолок белого, яркость подложки, до которой свет её не темнит, предел альфы.
 * Множитель насыщенности (tint) — у материала: ореолы 0,85, частицы-свет 0,7.
 */
export const GLAZE = { white: 0.97, lum: 0.7, max: 0.9 } as const;
export const GLAZE_TINT = { glows: 0.85, particles: 0.7 } as const;

/** То же, что fxLight в шейдере: альфа глазури света light (прямой цвет × сила) при множителе tint. */
export function glazeAlpha(light: readonly [number, number, number], tint: number): number {
  const l = light.map((c) => Math.min(c, GLAZE.white));
  const hi = Math.max(l[0]!, l[1]!, l[2]!);
  const lo = Math.min(l[0]!, l[1]!, l[2]!);
  const sat = hi > 1e-4 ? (hi - lo) / hi : 0;
  const lum = 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
  const glaze = Math.min(sat * tint, lum / GLAZE.lum, GLAZE.max);
  return Math.min(1, Math.max(0, glaze, hi / GLAZE.white));
}

/** Пиксель после слоя света light (предумноженное «цвет + подложка × (1 − α)») поверх подложки under. */
export function glazeOver(light: readonly [number, number, number], tint: number, under: readonly [number, number, number]): [number, number, number] {
  const a = glazeAlpha(light, tint);
  const l = light.map((c) => Math.min(c, GLAZE.white));
  return [l[0]! + under[0] * (1 - a), l[1]! + under[1] * (1 - a), l[2]! + under[2] * (1 - a)];
}

/** Униформы G-буфера для материала света: значения — общие объекты рендера (текстуры и вектор раскодировки). */
export function fxUniforms(g: FxGBuffer): Record<"gDepth" | "gSurface" | "uInvDepth", IUniform> {
  return { gDepth: { value: g.depth }, gSurface: { value: g.surface }, uInvDepth: { value: g.invDepth } };
}

export interface FxMaterialOptions {
  name: string;
  vertexShader: string;
  /** Тело фрагментного шейдера; FX_COMMON подставляется перед ним. */
  fragmentShader: string;
  gbuffer: FxGBuffer;
  uniforms?: Record<string, IUniform>;
  defines?: Record<string, string | number>;
  /** Слой ладоней: глубину не проверяем — эффект у ладони всегда поверх руки. */
  noDepth?: boolean;
  /** По умолчанию обе стороны: квадраты света строятся в разных базисах, отсекать нечего (глубины нет). */
  side?: Side;
}

/**
 * Материал прохода света: предумноженная альфа (One, OneMinusSrcAlpha). Альфа 0 — чистое сложение (свет);
 * альфа > 0 — плотное (пыль, дым, тушь трещин и штрихов, лист стены огня). Буфера глубины у холста нет,
 * поэтому depthTest и depthWrite выключены — видимость считает fxVisibility. transparent: все материалы света
 * в одном списке отрисовки, порядок — по renderOrder.
 */
export function createFxMaterial(o: FxMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    name: o.name,
    defines: {
      OVERLAY_BAND: glslFloat(OVERLAY_DEPTH_RANGE),
      INK_ENEMY: INK.enemy,
      INK_HALO: INK.halo,
      INK_FLASH: INK.flash,
      INK_EYE_FIRE: INK.eyeFire,
      INK_HALO_BURN: INK.haloBurn,
      FX_ENEMY_LIGHT: glslFloat(ENEMY_LIGHT),
      FX_ENEMY_DENSE: glslFloat(ENEMY_DENSE),
      FX_WHITE: glslFloat(GLAZE.white),
      FX_GLAZE_LUM: glslFloat(GLAZE.lum),
      FX_GLAZE_MAX: glslFloat(GLAZE.max),
      ...(o.noDepth ? { FX_NO_DEPTH: "" } : {}),
      ...o.defines,
    },
    uniforms: { ...fxUniforms(o.gbuffer), ...o.uniforms },
    vertexShader: o.vertexShader,
    fragmentShader: FX_COMMON + o.fragmentShader,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: o.side ?? DoubleSide,
  });
}

/** Порядок в fx.world (renderOrder): стены огня → телеграфы → частицы → ореолы снарядов → прожилки рельефа. */
export const FX_ORDER = { fireWalls: 1, decals: 2, particles: 3, glows: 4, veins: 5 } as const;

/** Общее время прохода света, с — от эпохи эффектов (float32 в шейдере не теряет точность). */
export type TimeUniform = IUniform<number>;
