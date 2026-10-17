import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, type ShaderMaterial } from "three";
import type { Vec3 } from "@doodlemagic/sim";
import { FX_ORDER, createFxMaterial, type FxGBuffer } from "./fxShader";

/**
 * Свечение магии: ореол вокруг ядра и свет на поверхности мира. Ореол — объёмное сияние вокруг точки,
 * обрезанное там, где перед ним стоит поверхность. Свет — точечный источник «в проходе света» (без PointLight):
 * точка поверхности под пикселем восстанавливается из глубины G-буфера, нормаль — из G-буфера, свет падает
 * только на заливки мира: на тушь врага, его ореол и вспышку (GDD 6), на руки и на небо — нет.
 */
export interface Glow {
  pos: Vec3;
  color: readonly [number, number, number];
  /** Радиус ореола, м (0 — без ореола). */
  halo: number;
  /** Радиус света на поверхности, м (0 — не светит на мир). */
  light: number;
  intensity: number;
  /** Доля белого ядра в центре ореола. */
  core: number;
}

const GLOW_VERT = /* glsl */ `
attribute vec4 aG0; // центр (x, y, z), радиус ореола
attribute vec4 aG1; // радиус света, яркость, ядро, —
attribute vec3 aG2; // цвет
varying vec3 vRay;
varying vec3 vC;
varying vec4 vG;
varying vec3 vCol;
void main() {
  vec3 c = (viewMatrix * vec4(aG0.xyz, 1.0)).xyz;
  float R = max(aG0.w, aG1.x);
  float dist = length(c);
  vec2 corner = position.xy * 2.0;
  // описанный квадрат сферы: перпендикулярно лучу к центру, с поправкой на конус касательных
  float k = dist > R * 1.05 ? dist / sqrt(dist * dist - R * R) : 0.0;
  vec3 axis = c / max(dist, 1e-4);
  vec3 ux = normalize(abs(axis.y) < 0.95 ? cross(vec3(0.0, 1.0, 0.0), axis) : cross(vec3(1.0, 0.0, 0.0), axis));
  vec3 uy = cross(axis, ux);
  vec3 q = c + (ux * corner.x + uy * corner.y) * R * k * 1.04;
  // камера внутри сферы или квадрат заходит за ближнюю плоскость — рисуем на весь кадр
  if (k == 0.0 || -c.z < R * k * 1.5 + 0.1) {
    gl_Position = vec4(corner, 0.0, 1.0);
    vRay = vec3(corner.x / projectionMatrix[0][0], corner.y / projectionMatrix[1][1], -1.0);
  } else {
    gl_Position = projectionMatrix * vec4(q, 1.0);
    vRay = q / -q.z;
  }
  vC = c;
  vG = vec4(aG0.w, aG1.x, aG1.y, aG1.z);
  vCol = aG2;
}
`;

const GLOW_FRAG = /* glsl */ `
varying vec3 vRay;
varying vec3 vC;
varying vec4 vG;
varying vec3 vCol;
const float LIGHT_GAIN = 0.55;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float d = texelFetch(gDepth, p, 0).r;
  if (d < OVERLAY_BAND) discard;
  bool sky = d >= 1.0;
  float D = sky ? 1.0e5 : fxDist(d);
  float rayLen = length(vRay);
  vec3 dir = vRay / rayLen;
  bool enemy = !sky && fxIsEnemy(fxInkAt(p));
  vec3 col = vec3(0.0);
  vec3 tinted = vec3(0.0);
  float halo = vG.x;
  if (halo > 0.0) {
    float tc = dot(dir, vC);
    float perp = length(vC - dir * tc);
    float x = perp / halo;
    // сколько сияния перед поверхностью: мягко гаснет, где ядро уходит за стену или в пол
    float front = clamp((D * rayLen - tc) / halo + 0.5, 0.0, 1.0) * step(0.0, tc);
    if (enemy) front *= 0.25;
    float g = 0.55 * exp(-x * x * 9.0) + 0.45 * exp(-x * x * 2.2);
    tinted += vCol * g * front * vG.z * 0.75;
    col += vec3(1.0, 0.96, 0.86) * exp(-x * x * 40.0) * vG.w * front;
  }
  float Lr = vG.y;
  if (Lr > 0.0 && !sky && !enemy) {
    vec3 S = vRay * D;
    vec3 L = vC - S;
    float dist = length(L);
    float att = clamp(1.0 - dist * dist / (Lr * Lr), 0.0, 1.0);
    att *= att;
    float ndl = 0.3 + 0.7 * max(dot(fxNormalAt(p), L / max(dist, 1e-3)), 0.0);
    tinted += vCol * att * ndl * vG.z * LIGHT_GAIN;
  }
  if (col.r + col.g + col.b + tinted.r + tinted.g + tinted.b <= 0.0) discard;
  vec4 light = fxLight(tinted, 0.6);
  gl_FragColor = vec4(light.rgb + col, light.a);
}
`;

export interface GlowMeshes {
  readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  update(glows: readonly Glow[]): void;
  dispose(): void;
}

/** Все ореолы и источники света — один InstancedMesh, один draw call. */
export function createGlowMeshes(gbuffer: FxGBuffer, max = 48): GlowMeshes {
  const a0 = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const a1 = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const a2 = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  for (const a of [a0, a1, a2]) a.setUsage(DynamicDrawUsage);
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute("aG0", a0);
  geometry.setAttribute("aG1", a1);
  geometry.setAttribute("aG2", a2);
  const material = createFxMaterial({ name: "fx-glows", vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, gbuffer });
  const mesh = new InstancedMesh(geometry, material, max);
  mesh.name = "fx-glows";
  mesh.frustumCulled = false;
  mesh.renderOrder = FX_ORDER.glows;
  mesh.count = 0;
  mesh.visible = false;
  return {
    mesh,
    update(glows) {
      const n = Math.min(max, glows.length);
      for (let i = 0; i < n; i++) {
        const g = glows[i]!;
        a0.setXYZW(i, g.pos.x, g.pos.y, g.pos.z, g.halo);
        a1.setXYZW(i, g.light, g.intensity, g.core, 0);
        a2.setXYZ(i, g.color[0], g.color[1], g.color[2]);
      }
      for (const a of [a0, a1, a2]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
      mesh.count = n;
      mesh.visible = n > 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
