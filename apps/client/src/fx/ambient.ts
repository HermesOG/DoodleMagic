import { InstancedBufferAttribute, InstancedMesh, PlaneGeometry, type ShaderMaterial } from "three";
import type { AABB, ArenaData, Vec3 } from "@doodlemagic/sim";
import { hex } from "../render/palette";
import type { PresetId } from "../render/quality";
import { glslFloat, styleShared } from "../render/stylePass";
import { FX_ORDER, createFxMaterial, type FxGBuffer } from "./fxShader";

/**
 * Частицы окружения (Р8): один InstancedMesh на весь мир, один вызов. Позиция каждой — от времени в вершинном
 * шейдере (styleShared.time), процессор её не трогает: при смене пресета меняется только число экземпляров.
 * - светлые пылинки ≤ 4 см дрейфуют медленнее 0,5 м/с в коробке вокруг камеры и гаснут ближе 3 м к ней;
 * - золотые искры поднимаются над руной;
 * - белые штрихи летят вверх над восходящими потоками.
 * Тёмного пепла и птиц нет. Все три — плотный слой прохода света: над тушью врага — × 0,1 (fxDense).
 */
export const AMBIENT_COUNT: Readonly<Record<PresetId, number>> = { low: 48, medium: 96, high: 160 };

export const AMBIENT = {
  dust: {
    color: hex(0xf2ebdc),
    alpha: 0.5,
    /** Сторона квадрата пылинки, м. */
    size: 0.035,
    /** Дрейф: по каждой оси до ±drift м/с (по высоте — × 0,4), плюс колыхание ±sway м с частотой swayRate рад/с. */
    drift: 0.25,
    sway: 0.12,
    swayRate: 0.7,
    /** Коробка вокруг камеры по x и z (м) и слой над полом по высоте. */
    box: 24,
    y0: 0.3,
    height: 5,
    /** Ближе к камере не видно (м); гаснет на fade метрах дальше. */
    near: 3,
    fade: 1,
  },
  spark: { color: hex(0xe8c66a), alpha: 0.85, size: 0.05, radius: 2.6, rise: 0.45, height: 3.2 },
  stroke: { color: hex(0xf4f2ec), alpha: 0.45, width: 0.025, length: 0.45, speed: 2.4 },
} as const;

/** Наибольшая скорость пылинки, м/с — по формуле шейдера (дрейф по трём осям и колыхание по двум). */
export function dustSpeedMax(): number {
  const d = AMBIENT.dust;
  const drift = d.drift * Math.hypot(1, 0.4, 1);
  return drift + d.sway * d.swayRate * Math.SQRT2;
}

/** Где над миром искры и штрихи: руна (или её нет) и восходящие потоки с высотой подъёма. */
export interface AmbientSpots {
  rune: Vec3 | null;
  updrafts: readonly { box: AABB; lift: number }[];
}

export function ambientSpots(a: Pick<ArenaData, "pickups" | "volumes">): AmbientSpots {
  return {
    rune: a.pickups.find((p) => p.kind === "rune")?.pos ?? null,
    updrafts: a.volumes.filter((v) => v.kind === "updraft").map((v) => ({ box: v.box, lift: v.liftM ?? v.box.max.y - v.box.min.y })),
  };
}

export const KIND = { dust: 0, spark: 1, stroke: 2 } as const;
export type AmbientKind = (typeof KIND)[keyof typeof KIND];

/**
 * Вид экземпляра i: в каждом десятке — одна искра (место 0) и один штрих (место 5), остальное пыль. Поэтому любые
 * первые N (пресет) держат те же доли. Без руны искры и без потоков штрихи становятся пылью.
 */
export function ambientKind(i: number, spots: AmbientSpots): AmbientKind {
  const k = i % 10;
  if (k === 0 && spots.rune) return KIND.spark;
  if (k === 5 && spots.updrafts.length > 0) return KIND.stroke;
  return KIND.dust;
}

/** Детерминированная «случайность» экземпляра: одинаковая картина на всех машинах. */
function rand(i: number, k: number): number {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const AMBIENT_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // искра: руна (x, y, z); штрих: середина низа потока (x, y, z) и высота подъёма
attribute vec4 aB; // штрих: полуширина потока по x и z; вид; запас
attribute vec3 aR; // случайные 0…1
varying vec2 vUv;
varying float vAlpha;
varying vec3 vCol;
varying float vStroke;
void main() {
  float kind = aB.z;
  vec3 c;
  vec2 size;
  if (kind < 0.5) {
    // пылинка: дрейф и колыхание от времени; по x, z — коробка вокруг камеры, по высоте — слой над полом
    vec3 vel = (aR - 0.5) * 2.0 * DUST_DRIFT * vec3(1.0, 0.4, 1.0);
    vec3 p = aR.zxy * vec3(DUST_BOX, DUST_H, DUST_BOX) + vel * uTime;
    p.xz += DUST_SWAY * vec2(sin(DUST_SWAY_RATE * uTime + aR.x * 6.2832), cos(DUST_SWAY_RATE * uTime + aR.y * 6.2832));
    vec2 rel = mod(p.xz - cameraPosition.xz + 0.5 * DUST_BOX, DUST_BOX) - 0.5 * DUST_BOX;
    float y = mod(p.y, DUST_H);
    c = vec3(cameraPosition.x + rel.x, DUST_Y0 + y, cameraPosition.z + rel.y);
    // у краёв коробки и слоя гаснет: перескок на другую сторону не виден
    float edge = max(abs(rel.x), abs(rel.y)) / DUST_BOX;
    float layer = y / DUST_H;
    vAlpha = DUST_ALPHA * (1.0 - smoothstep(0.36, 0.5, edge)) * smoothstep(0.0, 0.1, layer) * (1.0 - smoothstep(0.9, 1.0, layer));
    vCol = DUST_COLOR;
    size = vec2(DUST_SIZE);
  } else if (kind < 1.5) {
    // искра над руной: поднимается по кругу, медленно обходит его, гаснет у земли и вверху
    float ph = fract(aR.x + uTime * SPARK_RISE / SPARK_H);
    float ang = aR.y * 6.2832 + uTime * 0.3;
    float r = SPARK_R * sqrt(aR.z);
    c = aA.xyz + vec3(cos(ang) * r, ph * SPARK_H, sin(ang) * r);
    vAlpha = SPARK_ALPHA * sin(ph * 3.14159);
    vCol = SPARK_COLOR;
    size = vec2(SPARK_SIZE);
  } else {
    // штрих потока: летит вверх по объёму до высоты подъёма
    float ph = fract(aR.x + uTime * STROKE_SPEED / max(aA.w, 0.5));
    c = aA.xyz + vec3((aR.y - 0.5) * 2.0 * aB.x, ph * aA.w, (aR.z - 0.5) * 2.0 * aB.y);
    vAlpha = STROKE_ALPHA * sin(ph * 3.14159);
    vCol = STROKE_COLOR;
    size = vec2(STROKE_W, STROKE_LEN);
  }
  // ближе DUST_NEAR к камере не видно ничего: частица не лезет в глаза
  vAlpha *= smoothstep(DUST_NEAR, DUST_NEAR + DUST_FADE, distance(c, cameraPosition));
  vStroke = step(1.5, kind);
  // квадрат лицом к камере; штрих стоит вертикально (вверх — мировая ось)
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = kind > 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vUv = position.xy * 2.0;
  vec3 q = c + right * position.x * size.x + up * position.y * size.y;
  gl_Position = vAlpha > 0.0 ? projectionMatrix * viewMatrix * vec4(q, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const AMBIENT_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vCol;
varying float vStroke;
void main() {
  float vis = fxVisibility(0.3);
  if (vis <= 0.0) discard;
  // точка — мягкий круг; штрих — узкий, к концам гаснет
  float shape = vStroke > 0.5
    ? (1.0 - smoothstep(0.3, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.2, 1.0, abs(vUv.y)))
    : 1.0 - smoothstep(0.35, 1.0, length(vUv));
  float a = shape * vAlpha * fxDense(vis);
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a, a);
}
`;

const vec3 = (c: readonly [number, number, number]) => `vec3(${c.map(glslFloat).join(", ")})`;

export interface Ambient {
  readonly mesh: InstancedMesh;
  /** Число частиц по пресету: только mesh.count, данные экземпляров не меняются. */
  setPreset(p: PresetId): void;
}

/** Частицы окружения мира: добавить `mesh` в fx.world. */
export function createAmbient(gbuffer: FxGBuffer, spots: AmbientSpots, preset: PresetId): Ambient {
  const max = AMBIENT_COUNT.high;
  const a = new Float32Array(max * 4);
  const b = new Float32Array(max * 4);
  const r = new Float32Array(max * 3);
  for (let i = 0; i < max; i++) {
    const kind = ambientKind(i, spots);
    for (let k = 0; k < 3; k++) r[i * 3 + k] = rand(i, k);
    b[i * 4 + 2] = kind;
    if (kind === KIND.spark && spots.rune) {
      a.set([spots.rune.x, spots.rune.y, spots.rune.z, 0], i * 4);
    } else if (kind === KIND.stroke) {
      const u = spots.updrafts[Math.floor(i / 10) % spots.updrafts.length]!;
      const bx = u.box;
      a.set([(bx.min.x + bx.max.x) / 2, bx.min.y, (bx.min.z + bx.max.z) / 2, u.lift], i * 4);
      b[i * 4] = (bx.max.x - bx.min.x) / 2;
      b[i * 4 + 1] = (bx.max.z - bx.min.z) / 2;
    }
  }
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute("aA", new InstancedBufferAttribute(a, 4));
  geometry.setAttribute("aB", new InstancedBufferAttribute(b, 4));
  geometry.setAttribute("aR", new InstancedBufferAttribute(r, 3));
  const d = AMBIENT.dust;
  const s = AMBIENT.spark;
  const t = AMBIENT.stroke;
  const material: ShaderMaterial = createFxMaterial({
    name: "fx-ambient",
    vertexShader: AMBIENT_VERT,
    fragmentShader: AMBIENT_FRAG,
    gbuffer,
    // общее время стилевого прохода: тот же объект, что пишет StyleRenderer
    uniforms: { uTime: styleShared.time },
    defines: {
      DUST_COLOR: vec3(d.color),
      DUST_ALPHA: glslFloat(d.alpha),
      DUST_SIZE: glslFloat(d.size),
      DUST_DRIFT: glslFloat(d.drift),
      DUST_SWAY: glslFloat(d.sway),
      DUST_SWAY_RATE: glslFloat(d.swayRate),
      DUST_BOX: glslFloat(d.box),
      DUST_Y0: glslFloat(d.y0),
      DUST_H: glslFloat(d.height),
      DUST_NEAR: glslFloat(d.near),
      DUST_FADE: glslFloat(d.fade),
      SPARK_COLOR: vec3(s.color),
      SPARK_ALPHA: glslFloat(s.alpha),
      SPARK_SIZE: glslFloat(s.size),
      SPARK_R: glslFloat(s.radius),
      SPARK_RISE: glslFloat(s.rise),
      SPARK_H: glslFloat(s.height),
      STROKE_COLOR: vec3(t.color),
      STROKE_ALPHA: glslFloat(t.alpha),
      STROKE_W: glslFloat(t.width),
      STROKE_LEN: glslFloat(t.length),
      STROKE_SPEED: glslFloat(t.speed),
    },
  });
  const mesh = new InstancedMesh(geometry, material, max);
  mesh.name = "fx-ambient";
  // экземпляры двигает шейдер: границы по матрицам экземпляров ничего не значат
  mesh.frustumCulled = false;
  // плотный слой под частицами магии
  mesh.renderOrder = FX_ORDER.particles - 0.5;
  mesh.count = AMBIENT_COUNT[preset];
  return {
    mesh,
    setPreset(p) {
      mesh.count = AMBIENT_COUNT[p];
    },
  };
}
