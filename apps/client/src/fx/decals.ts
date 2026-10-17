import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, Vector3, type ShaderMaterial } from "three";
import { EARTH, type Vec3, type Zone, type ZoneKind } from "@doodlemagic/sim";
import { glslFloat } from "../render/stylePass";
import { FX_ORDER, createFxMaterial, type FxGBuffer, type TimeUniform } from "./fxShader";
import { FX_COLOR } from "./presets";

/**
 * Декаль зоны на полу. stage: до armTick — телеграф (progress 0…1 от каста до взвода), потом — действие
 * (progress 0…1 до конца зоны). angle — поворот вокруг Y: локальная +X декали идёт в мире вдоль (cos a, −sin a).
 */
export interface DecalSpec {
  stage: "telegraph" | "active";
  progress: number;
  shape: "rect" | "ring" | "segment";
  style: "sparks" | "cracks" | "quake" | "embers";
  center: Vec3;
  sizeX: number;
  sizeZ: number;
  angle: number;
}

const STYLE: Readonly<Record<ZoneKind, DecalSpec["style"]>> = { fireWall: "sparks", fireTrail: "embers", pillar: "cracks", quake: "quake" };
/** Разовые зоны бьют ровно на armTick: после взвода декали нет, удар рисует всплеск. */
const ONE_SHOT: ReadonlySet<ZoneKind> = new Set<ZoneKind>(["pillar", "quake"]);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Что рисовать на полу для зоны на тике nowTick (дробный — между тиками). null — ничего. */
export function zoneDecal(z: Zone, nowTick: number): DecalSpec | null {
  if (nowTick >= z.endTick) return null;
  const telegraph = nowTick < z.armTick;
  if (!telegraph && ONE_SHOT.has(z.kind)) return null;
  const progress = telegraph
    ? z.armTick > z.bornTick
      ? clamp01((nowTick - z.bornTick) / (z.armTick - z.bornTick))
      : 1
    : z.endTick > z.armTick
      ? clamp01((nowTick - z.armTick) / (z.endTick - z.armTick))
      : 1;
  const base = { stage: telegraph ? "telegraph" : "active", progress, style: STYLE[z.kind] } as const;
  const s = z.shape;
  switch (s.type) {
    case "box":
      return {
        ...base,
        shape: "rect",
        center: { x: (s.box.min.x + s.box.max.x) / 2, y: s.box.min.y, z: (s.box.min.z + s.box.max.z) / 2 },
        sizeX: s.box.max.x - s.box.min.x,
        sizeZ: s.box.max.z - s.box.min.z,
        angle: 0,
      };
    case "disc":
      return { ...base, shape: "ring", center: { ...s.center }, sizeX: 2 * s.radius, sizeZ: 2 * s.radius, angle: 0 };
    case "segment": {
      const dx = s.b.x - s.a.x;
      const dz = s.b.z - s.a.z;
      return {
        ...base,
        shape: "segment",
        center: { x: (s.a.x + s.b.x) / 2, y: Math.min(s.a.y, s.b.y), z: (s.a.z + s.b.z) / 2 },
        sizeX: Math.sqrt(dx * dx + dz * dz),
        sizeZ: 2 * s.halfW,
        angle: Math.atan2(-dz, dx),
      };
    }
  }
}

/** Внутренний стиль декали «обездвижен»: нефритовое кольцо у ног (не зона, а статус юнита). */
export interface RootRing {
  center: Vec3;
  radius: number;
}

const STYLE_ID = { sparks: 0, cracks: 1, quake: 2, embers: 3 } as const;
const SHAPE_ID = { rect: 0, ring: 1, segment: 2 } as const;
const STYLE_ROOT = 4;

/**
 * Декали — плоские квадраты над полом (y + 0,02), но узор кладётся на настоящую поверхность под пикселем:
 * точка восстанавливается из глубины G-буфера, поэтому декаль ложится на ступени и не висит над пропастью,
 * а руки и предметы перед ней её закрывают. Квадрат шире следа на «разлив» света.
 */
const DECAL_VERT = /* glsl */ `
attribute vec4 aD0; // середина (x, y, z), угол
attribute vec4 aD1; // sizeX, sizeZ, progress, яркость
attribute vec4 aD2; // стиль, стадия (0 телеграф, 1 действие), форма, семя
varying vec3 vRay;
varying float vViewZ;
varying vec4 vD0;
varying vec4 vD1;
varying vec4 vD2;
void main() {
  float style = aD2.x;
  float spill = style < 0.5 ? (aD2.y > 0.5 ? 1.9 : 0.6) : style < 1.5 ? 0.5 : style < 2.5 ? 0.3 : style < 3.5 ? 0.9 : 0.2;
  vec2 halfSize = aD1.xy * 0.5 + spill;
  vec2 l = position.xy * 2.0 * halfSize;
  float c = cos(aD0.w);
  float s = sin(aD0.w);
  vec3 w = vec3(aD0.x + l.x * c + l.y * s, aD0.y + 0.02, aD0.z - l.x * s + l.y * c);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vRay = w - cameraPosition;
  vViewZ = -mv.z;
  vD0 = aD0;
  vD1 = aD1;
  vD2 = aD2;
  gl_Position = projectionMatrix * mv;
}
`;

const DECAL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFire;
uniform vec3 uCore;
uniform vec3 uEmber;
uniform vec3 uJade;
varying vec3 vRay;
varying float vViewZ;
varying vec4 vD0;
varying vec4 vD1;
varying vec4 vD2;
const vec3 INK_LINE = vec3(0.1, 0.09, 0.08);

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float d = texelFetch(gDepth, p, 0).r;
  if (d < OVERLAY_BAND || d >= 1.0) discard;
  // точка поверхности под пикселем: тот же луч, что у квадрата, до глубины G-буфера
  vec3 S = cameraPosition + vRay * (fxDist(d) / vViewZ);
  float dy = S.y - vD0.y;
  float hfade = 1.0 - smoothstep(0.12, 0.5, abs(dy));
  if (hfade <= 0.0) discard;
  float c = cos(vD0.w);
  float s = sin(vD0.w);
  vec2 rel = S.xz - vD0.xz;
  vec2 l = vec2(rel.x * c - rel.y * s, rel.x * s + rel.y * c);
  vec2 hs = max(vD1.xy * 0.5, vec2(0.01));
  float prog = vD1.z;
  float inten = vD1.w;
  int style = int(vD2.x + 0.5);
  bool tele = vD2.y < 0.5;
  int shape = int(vD2.z + 0.5);
  float seed = vD2.w;
  float t = uTime;
  vec3 add = vec3(0.0);
  vec3 ink = INK_LINE;
  float a = 0.0;

  if (style == 0) {
    // стена огня: телеграф — бегущий от середины к концам запал и тёплая полоса следа; потом — ложе углей
    float along = abs(l.x) / hs.x;
    float across = abs(l.y);
    if (tele) {
      float band = (1.0 - smoothstep(hs.y, hs.y + 0.15, across)) * (1.0 - smoothstep(0.97, 1.02, along));
      add += uFire * band * (0.14 + 0.3 * prog);
      float lit = 1.0 - smoothstep(prog - 0.03, prog, along);
      float line = exp(-across * across / 0.004);
      float flick = 0.6 + 0.4 * fxNoise(vec2(l.x * 6.0, t * 20.0));
      add += mix(uFire, uCore, 0.4) * line * lit * flick;
      float head = exp(-pow((along - prog) * hs.x / 0.25, 2.0)) * exp(-across * across / 0.02) * step(along, 1.02);
      add += uCore * head * 2.2;
      vec2 cell = vec2(floor(l.x / 0.3), floor(t * 14.0) + seed);
      float sp = step(0.8, fxHash(cell));
      float sx = fract(l.x / 0.3) - 0.5;
      add += uCore * sp * lit * exp(-(sx * sx * 40.0 + across * across * 160.0)) * 1.4;
    } else {
      float env = smoothstep(0.0, 0.03, prog) * (1.0 - smoothstep(0.9, 1.0, prog));
      float inside = 1.0 - smoothstep(0.94, 1.04, along);
      float bed = 1.0 - smoothstep(hs.y * 0.5, hs.y + 0.3, across);
      float n = fxNoise(l * vec2(2.2, 4.0) + vec2(0.0, -t * 1.3) + seed);
      add += mix(uEmber, uFire, n) * bed * inside * (0.5 + 0.7 * n) * env;
      float spill = exp(-across * across / 1.6) * (1.0 - smoothstep(0.85, 1.3, along));
      add += uFire * spill * 0.24 * env;
      a = bed * inside * 0.3 * env;
      ink = vec3(0.16, 0.08, 0.05);
    }
  } else if (style == 1) {
    // столб: трещины тушью (края ячеек шума) расходятся от середины, в них и под столбом — нефрит
    float r = shape == 1 ? length(l) / hs.x : max(abs(l.x) / hs.x, abs(l.y) / hs.y);
    float reach = mix(0.35, 1.3, prog);
    float mask = 1.0 - smoothstep(reach - 0.25, reach, r + (fxNoise(l * 3.0 + seed) - 0.5) * 0.25);
    float cell = fxCells(l * 2.6 + seed);
    float keep = 0.35 + 0.65 * smoothstep(0.35, 0.6, fxNoise(l * 1.7 + seed * 5.0));
    float edge = (1.0 - smoothstep(0.03, 0.09, cell)) * keep;
    float core = (1.0 - smoothstep(0.0, 0.035, cell)) * keep;
    float pulse = 0.75 + 0.25 * sin(t * 18.0 + seed);
    a = edge * mask * 0.85;
    add += uJade * core * mask * (0.5 + 0.9 * prog) * pulse;
    add += uJade * (1.0 - smoothstep(0.5, 1.0, r)) * (0.06 + 0.22 * prog) * pulse;
  } else if (style == 2) {
    // землетрясение: тёмная граница 7 м, к удару внутрь сходится нефритовое кольцо, за ним — трещины
    float rr = length(l);
    float R = hs.x;
    float conv = R * (1.0 - prog);
    a = exp(-pow((rr - R) / 0.07, 2.0)) * 0.85;
    float ring = exp(-pow((rr - conv) / (0.1 + 0.3 * (1.0 - prog)), 2.0)) * step(rr, R + 0.1);
    add += uJade * ring * (0.55 + 0.9 * prog);
    add += uJade * (1.0 - smoothstep(R - 0.25, R, rr)) * (0.04 + 0.1 * prog);
    float rootR = R * ROOT_FRAC;
    float dash = step(0.5, fract(atan(l.y, l.x) * 7.0 / 3.14159265 + t * 0.4));
    add += uJade * exp(-pow((rr - rootR) / 0.05, 2.0)) * dash * 0.4;
    // трещины — редкими пучками, а не сеткой: только где низкочастотный шум высок
    float swept = smoothstep(conv, conv + 0.5, rr) * (1.0 - smoothstep(R - 0.1, R, rr));
    float cell = fxCells(l * 0.85 + seed);
    float keep = smoothstep(0.5, 0.72, fxNoise(l * 0.45 + seed * 3.0));
    a = max(a, (1.0 - smoothstep(0.015, 0.05, cell)) * swept * keep * 0.7);
  } else if (style == 3) {
    // след рывка: телеграф — светлая полоса, потом — тлеющие угли, к концу — подпалина тушью
    float along = abs(l.x) / hs.x;
    float across = abs(l.y) / hs.y;
    float inside = (1.0 - smoothstep(0.9, 1.05, along)) * (1.0 - smoothstep(0.55, 1.0, across + (fxNoise(l * 2.5 + seed) - 0.5) * 0.4));
    float n = fxNoise(l * 3.0 + vec2(t * 0.7, -t * 1.1) + seed);
    if (tele) {
      add += mix(uFire, uCore, 0.5) * inside * (0.25 + 0.35 * prog);
    } else {
      float env = smoothstep(0.0, 0.03, prog) * (1.0 - smoothstep(0.6, 1.0, prog));
      add += mix(uEmber, uFire, n) * inside * (0.3 + 0.8 * n * n) * env;
      a = inside * 0.35 * smoothstep(0.15, 0.9, prog) * (1.0 - smoothstep(0.85, 1.0, prog));
      ink = vec3(0.12, 0.1, 0.09);
    }
  } else {
    // обездвижен: нефритовое кольцо у ног, бегущие штрихи
    float rr = length(l);
    float R = hs.x * 0.85;
    float ring = exp(-pow((rr - R) / 0.04, 2.0));
    float dash = 0.55 + 0.45 * sin(atan(l.y, l.x) * 8.0 - t * 4.0);
    float pulse = 0.75 + 0.25 * sin(t * 9.0);
    add += uJade * ring * dash * pulse * 1.2;
    add += uJade * (1.0 - smoothstep(0.0, R, rr)) * 0.12 * pulse;
  }

  float k = hfade * inten * (fxIsEnemy(fxInkAt(p)) ? 0.25 : 1.0);
  a = clamp(a, 0.0, 1.0) * k;
  gl_FragColor = fxCompose(ink, a, fxLight(add * k, 0.6));
}
`;

export interface DecalMeshes {
  readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  /** Декали зон (с яркостью и семенем) и кольца обездвиженных. */
  update(decals: readonly { spec: DecalSpec; seed: number; intensity: number }[], roots: readonly RootRing[]): void;
  dispose(): void;
}

export function createDecalMeshes(gbuffer: FxGBuffer, time: TimeUniform, max = 32): DecalMeshes {
  const attr = (): InstancedBufferAttribute => {
    const a = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    a.setUsage(DynamicDrawUsage);
    return a;
  };
  const a0 = attr();
  const a1 = attr();
  const a2 = attr();
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute("aD0", a0);
  geometry.setAttribute("aD1", a1);
  geometry.setAttribute("aD2", a2);
  const v3 = (c: readonly [number, number, number]) => new Vector3(c[0], c[1], c[2]);
  const material = createFxMaterial({
    name: "fx-decals",
    vertexShader: DECAL_VERT,
    fragmentShader: DECAL_FRAG,
    gbuffer,
    defines: { ROOT_FRAC: glslFloat(EARTH.earthquake.rootRadiusM / EARTH.earthquake.radiusM) },
    uniforms: { uTime: time, uFire: { value: v3(FX_COLOR.fire) }, uCore: { value: v3(FX_COLOR.core) }, uEmber: { value: v3(FX_COLOR.ember) }, uJade: { value: v3(FX_COLOR.jade) } },
  });
  const mesh = new InstancedMesh(geometry, material, max);
  mesh.name = "fx-decals";
  mesh.frustumCulled = false;
  mesh.renderOrder = FX_ORDER.decals;
  mesh.count = 0;
  mesh.visible = false;
  return {
    mesh,
    update(decals, roots) {
      let n = 0;
      for (const d of decals) {
        if (n >= max) break;
        const s = d.spec;
        a0.setXYZW(n, s.center.x, s.center.y, s.center.z, s.angle);
        a1.setXYZW(n, s.sizeX, s.sizeZ, s.progress, d.intensity);
        a2.setXYZW(n, STYLE_ID[s.style], s.stage === "telegraph" ? 0 : 1, SHAPE_ID[s.shape], d.seed);
        n++;
      }
      for (const r of roots) {
        if (n >= max) break;
        a0.setXYZW(n, r.center.x, r.center.y, r.center.z, 0);
        a1.setXYZW(n, 2 * r.radius, 2 * r.radius, 0, 1);
        a2.setXYZW(n, STYLE_ROOT, 1, SHAPE_ID.ring, 0);
        n++;
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
