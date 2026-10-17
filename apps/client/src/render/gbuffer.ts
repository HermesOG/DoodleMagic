import { ShaderMaterial, Vector3, type IUniform, type Matrix4 } from "three";
import { SUN_DIR } from "./palette";

/**
 * Проход 1: каждый меш пишет в G-буфер (один RGBA8) не цвет, а данные для стилевого прохода:
 * R — освещённость (полуламберт 0,5 + 0,5·(n·L)), G — номер чернил / 255 (точно: целое в 8 битах),
 * B и A — нормаль в пространстве камеры в октаэдрической развёртке. Развёртка хранит всю сферу:
 * грань, повёрнутая от камеры по z (взгляд вверх под свод, края кадра в перспективе), не теряет знак.
 */
export const GBUFFER_VERT = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vViewNormal;
varying float vTone;

// Нормаль через матрицу m при любом масштабе — неравномерном (сплюснутая варежка, растянутый эффект), зеркальном
// и вырожденном (ось сжата в ноль): присоединённая матрица cof(m) = det(m)·(m⁻¹)ᵀ без деления на det, знак det
// возвращает сторону у зеркала. mat3(m) * n верна только при равномерном масштабе. Копия — cofactorNormal ниже.
vec3 worldNormal(mat3 m, vec3 n) {
  mat3 cof = mat3(cross(m[1], m[2]), cross(m[2], m[0]), cross(m[0], m[1]));
  float side = dot(m[0], cof[0]) < 0.0 ? -1.0 : 1.0;
  return normalize(side * (cof * n));
}

void main() {
  vTone = dot(worldNormal(mat3(modelMatrix), normal), uSunDir) * 0.5 + 0.5;
  vViewNormal = worldNormal(mat3(modelViewMatrix), normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
uniform float uInk;
varying vec3 vViewNormal;
varying float vTone;

// единичная нормаль -> квадрат [0; 1]²: верхняя полусфера (z ≥ 0) — ромб в центре, нижняя загнута в углы
vec2 octEncode(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 e = n.xy;
  if (n.z < 0.0) e = (1.0 - abs(e.yx)) * vec2(e.x >= 0.0 ? 1.0 : -1.0, e.y >= 0.0 ? 1.0 : -1.0);
  return e * 0.5 + 0.5;
}

void main() {
  gl_FragColor = vec4(clamp(vTone, 0.0, 1.0), uInk / 255.0, octEncode(normalize(vViewNormal)));
}
`;

export type SunUniform = IUniform<Vector3>;

/** Солнце мира: общая униформа всех мешей арены. */
export const worldSun: SunUniform = { value: new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) };

/** Материал G-буфера для чернил `ink`. Руки передают своё солнце — в пространстве камеры. */
export function createInkMaterial(ink: number, sun: SunUniform = worldSun): ShaderMaterial {
  return new ShaderMaterial({
    name: `ink-${ink}`,
    uniforms: { uInk: { value: ink }, uSunDir: sun },
    vertexShader: GBUFFER_VERT,
    fragmentShader: GBUFFER_FRAG,
  });
}
