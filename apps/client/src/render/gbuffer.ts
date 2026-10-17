import { ShaderMaterial, Vector3, type IUniform } from "three";
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

void main() {
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vTone = dot(n, uSunDir) * 0.5 + 0.5;
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

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
