import { DynamicDrawUsage, Frustum, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Sphere, type Camera, type ShaderMaterial } from "three";
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
varying vec3 vQ;
varying vec3 vC;
varying vec4 vG;
varying vec3 vCol;
void main() {
  vec3 c = (viewMatrix * vec4(aG0.xyz, 1.0)).xyz;
  float R = max(aG0.w, aG1.x);
  vC = c;
  vG = vec4(aG0.w, aG1.x, aG1.y, aG1.z);
  vCol = aG2;
  vQ = vec3(0.0, 0.0, -1.0);
  // сфера целиком за камерой — ничего не рисуем (обычно такие отсекает ещё процессор, cullGlows)
  if (c.z > R) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
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
    // точка плоскости z = −1 под углом кадра: при w = 1 линейна по экрану, интерполяция точна
    vQ = vec3(corner.x / projectionMatrix[0][0], corner.y / projectionMatrix[1][1], -1.0);
  } else {
    gl_Position = projectionMatrix * vec4(q, 1.0);
    // точка квадрата в пространстве камеры: перспективная интерполяция даёт точную точку под пикселем
    vQ = q;
  }
}
`;

const GLOW_FRAG = /* glsl */ `
varying vec3 vQ;
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
  // луч через пиксель — из точки квадрата в фрагменте (в вершинах деление на z интерполировалось бы криво)
  vec3 ray = vQ / -vQ.z;
  float rayLen = length(ray);
  vec3 dir = ray / rayLen;
  float halo = vG.x;
  float g = 0.0;
  float front = 0.0;
  float x = 1.0e3;
  if (halo > 0.0) {
    float tc = dot(dir, vC);
    x = length(vC - dir * tc) / halo;
    // сколько сияния перед поверхностью: мягко гаснет, где ядро уходит за стену или в пол
    front = clamp((D * rayLen - tc) / halo + 0.5, 0.0, 1.0) * step(0.0, tc);
    g = (0.55 * exp(-x * x * 9.0) + 0.45 * exp(-x * x * 2.2)) * front;
  }
  float Lr = vG.y;
  float att = 0.0;
  vec3 L = vec3(0.0);
  float dist = 1.0;
  if (Lr > 0.0 && !sky) {
    L = vC - ray * D;
    dist = length(L);
    att = clamp(1.0 - dist * dist / (Lr * Lr), 0.0, 1.0);
    att *= att;
  }
  // ни ореола, ни света — до выборок чернил и нормали
  if (g < 1.0e-3 && att <= 0.0) discard;
  bool enemy = !sky && fxIsEnemy(fxInkAt(p));
  float vis = enemy ? FX_ENEMY_LIGHT : 1.0;
  vec3 tinted = vCol * (g * vis * vG.z * 0.75);
  // белое ядро над врагом — как плотное: десятая доля, иначе вспышка взрыва белит силуэт в момент удара
  vec3 col = vec3(1.0, 0.96, 0.86) * (exp(-x * x * 40.0) * vG.w * front * (enemy ? FX_ENEMY_DENSE : 1.0));
  if (att > 0.0 && !enemy) {
    float ndl = 0.3 + 0.7 * max(dot(fxNormalAt(p), L / max(dist, 1e-3)), 0.0);
    tinted += vCol * att * ndl * vG.z * LIGHT_GAIN;
  }
  vec4 light = fxLight(tinted, 0.6);
  gl_FragColor = vec4(light.rgb + col, light.a);
}
`;

const cullFrustum = new Frustum();
const cullMatrix = new Matrix4();
const cullSphere = new Sphere();

/**
 * Свечения, сфера которых (центр, max(ореол, свет)) пересекает пирамиду видимости камеры. Остальные не рисуются
 * и не занимают бюджет источников света: иначе свет за спиной рисовался бы на весь кадр.
 * Матрицы камеры должны быть обновлены (updateMatrixWorld).
 */
export function cullGlows<T extends Glow>(glows: readonly T[], camera: Camera): T[] {
  cullFrustum.setFromProjectionMatrix(cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return glows.filter((g) => {
    cullSphere.center.set(g.pos.x, g.pos.y, g.pos.z);
    cullSphere.radius = Math.max(g.halo, g.light);
    return cullSphere.radius > 0 && cullFrustum.intersectsSphere(cullSphere);
  });
}

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
        if (n === 0) continue;
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
