import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, Vector3, type ShaderMaterial } from "three";
import { TICK_HZ, type AABB, type Zone } from "@doodlemagic/sim";
import { FX_ORDER, createFxMaterial, type FxGBuffer, type TimeUniform } from "./fxShader";
import { FX_COLOR } from "./presets";

/** Лист пламени поднимается за столько секунд после взвода и опадает за столько до конца зоны. */
export const FIRE_WALL_RISE_S = 0.18;
export const FIRE_WALL_FALL_S = 0.35;

export interface FireWallSheet {
  box: AABB;
  /** 0…1 — доля высоты листа. */
  rise: number;
  /** 0…1 — плотность (гаснет к концу). */
  fade: number;
  seed: number;
}

/** Лист стены огня на тике nowTick: только у взведённой зоны fireWall с формой «бокс». */
export function fireWallSheet(z: Zone, nowTick: number): FireWallSheet | null {
  if (z.kind !== "fireWall" || z.shape.type !== "box" || nowTick < z.armTick || nowTick >= z.endTick) return null;
  const sinceArm = (nowTick - z.armTick) / TICK_HZ;
  const toEnd = (z.endTick - nowTick) / TICK_HZ;
  const up = Math.min(1, sinceArm / FIRE_WALL_RISE_S);
  const down = Math.min(1, toEnd / FIRE_WALL_FALL_S);
  return { box: z.shape.box, rise: (1 - (1 - up) ** 2) * (0.35 + 0.65 * down), fade: down, seed: (z.id * 0.37) % 13 };
}

/**
 * Стена огня — один двусторонний лист пламени по середине бокса зоны вдоль длинной оси: шум течёт вверх,
 * плотность почти 1 у основания (закрывает обзор), выше — рваные языки, по краям языков — дымка, концы обгрызены.
 * Лист выше стены на 25 %: там лижут языки.
 */
const WALL_VERT = /* glsl */ `
attribute vec4 aW0; // середина основания (x, y, z), семя
attribute vec4 aW1; // размер x, высота, размер z, подъём
attribute vec4 aW2; // плотность
varying vec2 vUV;
varying vec4 vInfo;
varying vec2 vAlong;
void main() {
  float h = aW1.y * 1.25 * aW1.w;
  float len = max(aW1.x, aW1.z);
  vec3 axis = aW1.x >= aW1.z ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 w = vec3(aW0.x, aW0.y + position.y * h, aW0.z) + axis * (position.x * len);
  // координата по длинной оси от середины и половина длины: модуль берёт фрагментный шейдер
  vAlong = vec2(position.x * len, len * 0.5);
  vUV = vec2(dot(w, axis), w.y - aW0.y);
  vInfo = vec4(h, aW2.x, aW0.w, aW1.y * aW1.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFire;
uniform vec3 uCore;
uniform vec3 uEmber;
varying vec2 vUV;
varying vec4 vInfo;
varying vec2 vAlong;
void main() {
  float vis = fxVisibility(0.25);
  // до ближнего конца стены, м: на торцах — 0
  float toEnd = vAlong.y - abs(vAlong.x);
  if (vis <= 0.0) discard;
  float H = max(vInfo.x, 0.01);
  float fade = vInfo.y;
  float seed = vInfo.z;
  float y = vUV.y;
  float y01 = y / H;
  float t = uTime;
  float n = fxFbm(vec2(vUV.x * 0.8 + seed, y * 0.7 - t * 1.7));
  float n2 = fxNoise(vec2(vUV.x * 2.4 - seed, y * 1.8 - t * 3.1));
  float flame = (1.0 - y01) * 1.25 + (n - 0.5) * 1.05 + (n2 - 0.5) * 0.4 - 0.18;
  // концы стены обгрызены языками, а не обрезаны
  flame -= (1.0 - smoothstep(0.0, 0.9, toEnd + (n2 - 0.5) * 0.5)) * 1.1;
  float dens = smoothstep(0.0, 0.22, flame);
  float smoke = smoothstep(-0.3, -0.04, flame) * (1.0 - dens) * 0.28;
  if (dens + smoke <= 0.002) discard;
  float heat = clamp(flame, 0.0, 1.0);
  vec3 col = mix(uEmber, uFire, smoothstep(0.05, 0.45, heat));
  col = mix(col, uCore, smoothstep(0.6, 1.05, heat));
  float a = dens * 0.95 * fade * fxDense(vis);
  float sa = smoke * fade * fxDense(vis);
  vec3 glow = col * heat * 0.45 * fade * vis;
  gl_FragColor = vec4(col * a + glow + vec3(0.22, 0.21, 0.2) * sa, a + sa * (1.0 - a));
}
`;

export interface FireWallMeshes {
  readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  update(sheets: readonly FireWallSheet[]): void;
  /** «Низкое» и «Среднее»: шум пламени в две октавы вместо трёх (FX_CHEAP). */
  setCheap(cheap: boolean): void;
  dispose(): void;
}

export function createFireWallMeshes(gbuffer: FxGBuffer, time: TimeUniform, max = 8): FireWallMeshes {
  const a0 = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const a1 = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const a2 = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
  for (const a of [a0, a1, a2]) a.setUsage(DynamicDrawUsage);
  // лист: x ∈ [−0,5; 0,5] вдоль стены, y ∈ [0; 1] вверх
  const geometry = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
  geometry.setAttribute("aW0", a0);
  geometry.setAttribute("aW1", a1);
  geometry.setAttribute("aW2", a2);
  const v3 = (c: readonly [number, number, number]) => new Vector3(c[0], c[1], c[2]);
  const material = createFxMaterial({
    name: "fx-fire-walls",
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    gbuffer,
    uniforms: { uTime: time, uFire: { value: v3(FX_COLOR.fire) }, uCore: { value: v3(FX_COLOR.core) }, uEmber: { value: v3(FX_COLOR.ember) } },
  });
  const mesh = new InstancedMesh(geometry, material, max);
  mesh.name = "fx-fire-walls";
  mesh.frustumCulled = false;
  mesh.renderOrder = FX_ORDER.fireWalls;
  mesh.count = 0;
  mesh.visible = false;
  return {
    mesh,
    update(sheets) {
      const n = Math.min(max, sheets.length);
      for (let i = 0; i < n; i++) {
        const s = sheets[i]!;
        const b = s.box;
        a0.setXYZW(i, (b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2, s.seed);
        a1.setXYZW(i, b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, s.rise);
        a2.setXYZW(i, s.fade, 0, 0, 0);
      }
      for (const a of [a0, a1, a2]) {
        a.clearUpdateRanges();
        if (n === 0) continue;
        a.addUpdateRange(0, n * 4);
        a.needsUpdate = true;
      }
      mesh.count = n;
      mesh.visible = n > 0;
    },
    setCheap(cheap) {
      if (("FX_CHEAP" in material.defines) === cheap) return;
      if (cheap) material.defines.FX_CHEAP = "";
      else delete material.defines.FX_CHEAP;
      material.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
