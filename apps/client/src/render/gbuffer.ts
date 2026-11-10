import { FrontSide, ShaderMaterial, Vector3, type IUniform, type Matrix4, type Side } from "three";
import { SUN_DIR } from "./palette";
import { glslFloat, styleShared } from "./stylePass";

/**
 * Проход 1: каждый меш пишет в G-буфер (один RGBA8) не цвет, а данные для стилевого прохода:
 * R — освещённость (полуламберт 0,5 + 0,5·(n·L)), G — номер чернил / 255 (точно: целое в 8 битах),
 * B и A — нормаль в пространстве камеры в октаэдрической развёртке. Развёртка хранит всю сферу:
 * грань, повёрнутая от камеры по z (взгляд вверх под свод, края кадра в перспективе), не теряет знак.
 * InstancedMesh (USE_INSTANCING) берёт матрицу экземпляра; с INSTANCE_INK чернила идут из атрибута `aInk`
 * экземпляра, а не из униформы. Без инстансинга путь прежний.
 * SWAY (только трава и знамёна, Р8): вершина смещается по ветру на вес качания из атрибута `aSway` — время
 * `uTime` = styleShared.time; с SWAY_CLOTH — вдоль стены (по x), медленнее и меньше. Остальные меши — прежний путь.
 */
export const GBUFFER_VERT = /* glsl */ `
uniform vec3 uSunDir;
uniform float uInk;
varying vec3 vViewNormal;
varying float vTone;
varying float vInk;
#ifdef INSTANCE_INK
attribute float aInk;
#endif
#ifdef SWAY
uniform float uTime;
// вес качания (0 у закреплённого края бокса, 1 у свободного) и середина бокса x, z: фаза и порыв одни на бокс
attribute vec3 aSway;
// ветер мира (x, z); волна порыва — длиной 12 м
const vec2 WIND = vec2(0.8, 0.6);
const float GUST_K = 0.5236;
// Смещение вершины: размах SWAY_AMP · вес² (изгиб растёт к свободному краю как h²), качание SWAY_RATE рад/с
// со сдвигом фазы по ветру (соседние кочки не в ногу) и порыв — гребень волны идёт по ветру со скоростью SWAY_GUST м/с
vec3 swayOffset() {
  float w = aSway.x * aSway.x;
  float along = dot(aSway.yz, WIND);
  float g = 0.5 + 0.5 * sin((along - SWAY_GUST * uTime) * GUST_K);
  float s = SWAY_AMP * w * (0.55 * sin(SWAY_RATE * uTime + along * 0.9) + 0.45 * g * g);
#ifdef SWAY_CLOTH
  return vec3(s, 0.0, 0.0);
#else
  return vec3(WIND.x * s, 0.0, WIND.y * s);
#endif
}
#endif

// Нормаль через матрицу m при любом масштабе — неравномерном (сплюснутая варежка, растянутый эффект), зеркальном
// и вырожденном (ось сжата в ноль): присоединённая матрица cof(m) = det(m)·(m⁻¹)ᵀ без деления на det, знак det
// возвращает сторону у зеркала. mat3(m) * n верна только при равномерном масштабе. Копия — cofactorNormal ниже.
vec3 worldNormal(mat3 m, vec3 n) {
  mat3 cof = mat3(cross(m[1], m[2]), cross(m[2], m[0]), cross(m[0], m[1]));
  float side = dot(m[0], cof[0]) < 0.0 ? -1.0 : 1.0;
  return normalize(side * (cof * n));
}

void main() {
#ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
  vTone = dot(worldNormal(mat3(m), normal), uSunDir) * 0.5 + 0.5;
  vViewNormal = worldNormal(mat3(viewMatrix * m), normal);
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
#else
  vTone = dot(worldNormal(mat3(modelMatrix), normal), uSunDir) * 0.5 + 0.5;
  vViewNormal = worldNormal(mat3(modelViewMatrix), normal);
#ifdef SWAY
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.xyz += swayOffset();
  gl_Position = projectionMatrix * viewMatrix * wp;
#else
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#endif
#endif
#ifdef INSTANCE_INK
  vInk = aInk;
#else
  vInk = uInk;
#endif
}
`;

/**
 * То же, что worldNormal в GBUFFER_VERT, на JS (для тестов): нормаль n через верхнюю 3×3 матрицы m по
 * присоединённой матрице — верно при неравномерном, зеркальном и вырожденном масштабе.
 */
export function cofactorNormal(m: Matrix4, n: Vector3): Vector3 {
  const e = m.elements;
  const c0 = new Vector3(e[0], e[1], e[2]);
  const c1 = new Vector3(e[4], e[5], e[6]);
  const c2 = new Vector3(e[8], e[9], e[10]);
  const k0 = new Vector3().crossVectors(c1, c2);
  const k1 = new Vector3().crossVectors(c2, c0);
  const k2 = new Vector3().crossVectors(c0, c1);
  const side = c0.dot(k0) < 0 ? -1 : 1;
  return k0.multiplyScalar(n.x).addScaledVector(k1, n.y).addScaledVector(k2, n.z).multiplyScalar(side).normalize();
}

export const GBUFFER_FRAG = /* glsl */ `
varying vec3 vViewNormal;
varying float vTone;
varying float vInk;

// единичная нормаль -> квадрат [0; 1]²: верхняя полусфера (z ≥ 0) — ромб в центре, нижняя загнута в углы
vec2 octEncode(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 e = n.xy;
  if (n.z < 0.0) e = (1.0 - abs(e.yx)) * vec2(e.x >= 0.0 ? 1.0 : -1.0, e.y >= 0.0 ? 1.0 : -1.0);
  return e * 0.5 + 0.5;
}

void main() {
  gl_FragColor = vec4(clamp(vTone, 0.0, 1.0), vInk / 255.0, octEncode(normalize(vViewNormal)));
}
`;

export type SunUniform = IUniform<Vector3>;

/** Солнце мира: общая униформа всех мешей арены. */
export const worldSun: SunUniform = { value: new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) };

/**
 * Качание мира (Р8): размах у свободного края, м, и частота, рад/с; порыв — волна по ветру, м/с.
 * Знамёна медленнее и меньше травы; их закреплённый край — верх (под венцом).
 */
export const SWAY = {
  grass: { amp: 0.06, rate: 1.7 },
  cloth: { amp: 0.045, rate: 1.1 },
  gust: 3,
} as const;
export type SwayKind = "grass" | "cloth";

export interface InkMaterialOptions {
  /** Чернила каждого экземпляра InstancedMesh — из атрибута `aInk` (Float32, по одному числу на экземпляр). */
  instanceInk?: boolean;
  /** Сторона граней: BackSide — вывернутая оболочка ореола врага. */
  side?: Side;
  /** Качание травы или ткани: нужен атрибут `aSway` (buildSwayArrays). */
  sway?: SwayKind;
}

/**
 * Материал G-буфера для чернил `ink`. Руки передают своё солнце — в пространстве камеры. Работает и с
 * InstancedMesh (матрица экземпляра; с `instanceInk` — и чернила экземпляра, тогда `ink` — запасные).
 */
export function createInkMaterial(ink: number, sun: SunUniform = worldSun, opts: InkMaterialOptions = {}): ShaderMaterial {
  const defines: Record<string, string> = opts.instanceInk ? { INSTANCE_INK: "" } : {};
  const uniforms: Record<string, IUniform> = { uInk: { value: ink }, uSunDir: sun };
  if (opts.sway) {
    const k = SWAY[opts.sway];
    Object.assign(defines, { SWAY: "", SWAY_AMP: glslFloat(k.amp), SWAY_RATE: glslFloat(k.rate), SWAY_GUST: glslFloat(SWAY.gust) });
    if (opts.sway === "cloth") defines.SWAY_CLOTH = "";
    // общее время стилевого прохода: тот же объект, что пишет StyleRenderer каждый кадр
    uniforms.uTime = styleShared.time;
  }
  return new ShaderMaterial({
    name: `ink-${ink}${opts.instanceInk ? "-instanced" : ""}${opts.sway ? `-sway-${opts.sway}` : ""}`,
    defines,
    uniforms,
    vertexShader: GBUFFER_VERT,
    fragmentShader: GBUFFER_FRAG,
    side: opts.side ?? FrontSide,
  });
}
