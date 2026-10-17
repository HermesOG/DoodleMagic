import { BoxGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3, type ShaderMaterial } from "three";
import type { AABB, Terrain } from "@doodlemagic/sim";
import { createInkMaterial } from "../render/gbuffer";
import { INK } from "../render/palette";
import { FX_ORDER, createFxMaterial, type FxGBuffer, type TimeUniform } from "./fxShader";
import { FX_COLOR } from "./presets";

/** В последние столько тиков рельеф уходит обратно в землю. */
export const TERRAIN_SINK_TICKS = 15;

/**
 * Видимый бокс рельефа на тике nowTick (дробный — между тиками): растёт из земли за growTicks с ease-out,
 * в последние TERRAIN_SINK_TICKS тиков проседает. Коллизия — всегда полный `t.box` (это решает симуляция).
 */
export function terrainVisualBox(t: Terrain, nowTick: number): AABB {
  const h = t.box.max.y - t.box.min.y;
  const age = nowTick - t.bornTick;
  const g = t.growTicks > 0 ? Math.min(1, Math.max(0, age / t.growTicks)) : age >= 0 ? 1 : 0;
  const grow = 1 - (1 - g) ** 3;
  const left = Math.min(1, Math.max(0, (t.endTick - nowTick) / TERRAIN_SINK_TICKS));
  const sink = left * left * (3 - 2 * left);
  const k = grow * sink;
  return { min: { ...t.box.min }, max: { x: t.box.max.x, y: k >= 1 ? t.box.max.y : t.box.min.y + h * k, z: t.box.max.z } };
}

/** Рельеф в G-буфер: экземпляры единичного бокса чернилами terrain, один draw call. */
export interface TerrainMeshes {
  readonly mesh: InstancedMesh<BoxGeometry, ShaderMaterial>;
  update(boxes: readonly AABB[]): void;
  dispose(): void;
}

export function createTerrainMeshes(max = 24): TerrainMeshes {
  const geometry = new BoxGeometry(1, 1, 1);
  const mesh = new InstancedMesh(geometry, createInkMaterial(INK.terrain), max);
  mesh.name = "terrain";
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  return {
    mesh,
    update(boxes) {
      let n = 0;
      for (const b of boxes) {
        if (n >= max) break;
        const hy = b.max.y - b.min.y;
        if (hy <= 0.005) continue;
        p.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
        s.set(b.max.x - b.min.x, hy, b.max.z - b.min.z);
        mesh.setMatrixAt(n++, m.compose(p, q, s));
      }
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    },
  };
}

/**
 * Нефритовые прожилки (проход света): квадрат на каждую большую грань рельефа, чуть над ней. В квадрате —
 * 3–4 тонкие извилистые жилы, место — по хешу id; узор привязан к верху камня и поднимается вместе с ним.
 * Пульсируют; ярче, пока камень растёт, и вспыхивают, когда по нему бьют.
 */
const VEIN_VERT = /* glsl */ `
attribute vec4 aV0; // середина грани (x, y, z), семя
attribute vec4 aV1; // ось ширины грани (x, z), ширина, высота видимой части
attribute vec4 aV2; // нормаль грани (x, z), верх камня y, яркость
varying vec2 vFace;
varying vec4 vInfo;
void main() {
  vec3 u = vec3(aV1.x, 0.0, aV1.y);
  vec3 n = vec3(aV2.x, 0.0, aV2.y);
  vec3 w = aV0.xyz + u * (position.x * aV1.z) + vec3(0.0, position.y * aV1.w, 0.0) + n * 0.015;
  vFace = vec2(position.x * aV1.z, aV2.z - w.y);
  vInfo = vec4(aV0.w, aV1.z, aV2.w, aV1.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const VEIN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uJade;
varying vec2 vFace;
varying vec4 vInfo;
void main() {
  float vis = fxVisibility(0.01);
  if (vis <= 0.0) discard;
  float seed = vInfo.x;
  float width = vInfo.y;
  float bright = vInfo.z;
  float depthM = vFace.y; // метров от верха камня
  int count = 3 + int(fract(seed * 7.31) * 2.0);
  float core = 0.0;
  float glow = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= count) break;
    float h = fract(sin(seed * 91.7 + float(i) * 37.3) * 4375.85);
    float h2 = fract(h * 13.7 + 0.31);
    float x0 = (float(i) + 0.5) / float(count) - 0.5 + (h - 0.5) * 0.18;
    x0 *= width * 0.8;
    float len = mix(0.9, 2.4, h2);
    float wob = 0.12 * sin(depthM * 2.7 + h * 6.28) + 0.05 * sin(depthM * 7.3 + h * 17.0) + (fxNoise(vec2(depthM * 3.0, h * 10.0)) - 0.5) * 0.14;
    float dx = abs(vFace.x - x0 - wob);
    float taper = 1.0 - smoothstep(len * 0.6, len, depthM);
    float w = 0.022 * taper + 0.004;
    core += (1.0 - smoothstep(w * 0.5, w, dx)) * taper;
    glow += exp(-dx * dx / 0.004) * taper;
  }
  core = min(core, 1.0);
  glow = min(glow, 1.5);
  float pulse = 0.7 + 0.3 * sin(uTime * 2.2 + seed * 6.2831 + depthM * 1.7);
  float k = bright * pulse * vis;
  float a = core * 0.55 * k;
  gl_FragColor = fxCompose(uJade, a, fxLight(uJade * (glow * 0.3 + core * 0.35) * k, 0.5));
}
`;

export interface VeinFace {
  /** Середина грани (y — середина видимой части). */
  center: { x: number; y: number; z: number };
  /** Ось ширины грани в XZ (единичная) и наружная нормаль в XZ. */
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  width: number;
  height: number;
  topY: number;
  seed: number;
  bright: number;
}

/** Большие грани (у полного бокса площадь ≥ 2 м²) видимого бокса рельефа: жилы только на них. */
export function veinFaces(box: AABB, fullHeight: number, id: number, bright: number): VeinFace[] {
  const sx = box.max.x - box.min.x;
  const sz = box.max.z - box.min.z;
  const h = box.max.y - box.min.y;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const out: VeinFace[] = [];
  const fullH = Math.max(h, 0.01);
  const faces = [
    { nx: 0, nz: -1, ux: 1, uz: 0, w: sx, c: { x: cx, y: cy, z: box.min.z } },
    { nx: 0, nz: 1, ux: -1, uz: 0, w: sx, c: { x: cx, y: cy, z: box.max.z } },
    { nx: -1, nz: 0, ux: 0, uz: -1, w: sz, c: { x: box.min.x, y: cy, z: cz } },
    { nx: 1, nz: 0, ux: 0, uz: 1, w: sz, c: { x: box.max.x, y: cy, z: cz } },
  ];
  faces.forEach((f, i) => {
    if (f.w * fullHeight < 2 || h < 0.05) return;
    out.push({ center: f.c, ux: f.ux, uz: f.uz, nx: f.nx, nz: f.nz, width: f.w, height: fullH, topY: box.max.y, seed: ((id * 0.6180339887 + i * 0.1373) % 1) * 97.3, bright });
  });
  return out;
}

export interface VeinMeshes {
  readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  update(faces: readonly VeinFace[]): void;
  dispose(): void;
}

export function createVeinMeshes(gbuffer: FxGBuffer, time: TimeUniform, max = 96): VeinMeshes {
  const attr = (): InstancedBufferAttribute => {
    const a = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    a.setUsage(DynamicDrawUsage);
    return a;
  };
  const a0 = attr();
  const a1 = attr();
  const a2 = attr();
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute("aV0", a0);
  geometry.setAttribute("aV1", a1);
  geometry.setAttribute("aV2", a2);
  const material = createFxMaterial({
    name: "fx-veins",
    vertexShader: VEIN_VERT,
    fragmentShader: VEIN_FRAG,
    gbuffer,
    uniforms: { uTime: time, uJade: { value: new Vector3(...FX_COLOR.jade) } },
  });
  const mesh = new InstancedMesh(geometry, material, max);
  mesh.name = "fx-veins";
  mesh.frustumCulled = false;
  mesh.renderOrder = FX_ORDER.veins;
  mesh.count = 0;
  mesh.visible = false;
  return {
    mesh,
    update(faces) {
      const n = Math.min(max, faces.length);
      for (let i = 0; i < n; i++) {
        const f = faces[i]!;
        a0.setXYZW(i, f.center.x, f.center.y, f.center.z, f.seed);
        a1.setXYZW(i, f.ux, f.uz, f.width, f.height);
        a2.setXYZW(i, f.nx, f.nz, f.topY, f.bright);
      }
      for (const a of [a0, a1, a2]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * 4);
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
