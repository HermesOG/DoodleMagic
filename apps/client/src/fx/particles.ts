import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, type ShaderMaterial } from "three";
import { FX_ORDER, createFxMaterial, type FxGBuffer, type TimeUniform } from "./fxShader";
import type { ParticleSpec } from "./presets";

/**
 * Место под n новых частиц в кольце ёмкостью cap, начиная с head: один или два диапазона (с переносом через
 * конец). Больше cap за раз не помещается — n обрезается до cap. Возвращает новую голову кольца.
 */
export function allocateRing(head: number, cap: number, n: number): { head: number; ranges: { start: number; count: number }[] } {
  const k = Math.max(0, Math.min(Math.floor(n), cap));
  if (k === 0 || cap <= 0) return { head, ranges: [] };
  const h = ((head % cap) + cap) % cap;
  const first = Math.min(k, cap - h);
  const ranges = [{ start: h, count: first }];
  if (k > first) ranges.push({ start: 0, count: k - first });
  return { head: (h + k) % cap, ranges };
}

/**
 * Квадрат-billboard на частицу. Положение p0 + v0·t − ½·g·t² считает вершинный шейдер по uTime; у плотных мягких
 * частиц (пыль, дым, тело пламени) скорость гаснет от сопротивления воздуха. Свет (альфа 0) вытянут шлейфом
 * по скорости на экране, осколки крутятся. Мёртвая частица уходит за кадр.
 */
const PARTICLE_VERT = /* glsl */ `
uniform float uTime;
attribute vec3 aP0;
attribute vec3 aV0;
attribute vec4 aTime;
attribute vec4 aColor;
attribute float aGrav;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vInfo;
varying float vSoft;
const float DRAG = 2.6;
const float STREAK_S = 0.03;

float seedOf(float i) { return fract(sin(i * 12.9898 + 78.233) * 43758.5453); }

void main() {
  float age = uTime - aTime.x;
  float life = aTime.y;
  vUv = position.xy * 2.0;
  vColor = aColor;
  vInfo = vec3(1.0, 0.0, 0.0);
  vSoft = 1.0;
  if (life <= 0.0 || age < 0.0 || age >= life) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float t = age / life;
  // 0 — свет, 1 — мягкое облако, 2 — осколок
  float kind = aColor.a <= 0.0 ? 0.0 : (aGrav >= 9.0 ? 2.0 : 1.0);
  float drag = kind == 1.0 ? DRAG : 0.0;
  float e = exp(-drag * age);
  float tv = drag > 0.0 ? (1.0 - e) / drag : age;
  vec3 pos = aP0 + aV0 * tv - vec3(0.0, 0.5 * aGrav * age * age, 0.0);
  vec3 vel = aV0 * e - vec3(0.0, aGrav * age, 0.0);
  float size = mix(aTime.z, aTime.w, t);
  float seed = seedOf(float(gl_InstanceID) + aTime.x * 7.13);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec2 ax;
  float along = size;
  if (kind == 0.0) {
    vec2 sv = (mat3(modelViewMatrix) * vel).xy;
    float sp = length(sv);
    ax = sp > 1e-3 ? sv / sp : vec2(1.0, 0.0);
    along = size + sp * STREAK_S;
  } else {
    float spin = kind == 2.0 ? (seed - 0.5) * 18.0 : (seed - 0.5) * 1.2;
    float a = seed * 6.2831853 + age * spin;
    ax = vec2(cos(a), sin(a));
  }
  vec2 ay = vec2(-ax.y, ax.x);
  mv.xy += ax * (position.x * along) + ay * (position.y * size);
  gl_Position = projectionMatrix * mv;
  vInfo = vec3(t, seed, kind);
  vSoft = max(0.04, size * 0.5);
}
`;

const PARTICLE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vInfo;
varying float vSoft;

void main() {
  float t = vInfo.x;
  float seed = vInfo.y;
  float kind = vInfo.z;
  float r2 = dot(vUv, vUv);
  float vis = fxVisibility(vSoft);
  if (vis <= 0.0) discard;
  vec3 rgb = vColor.rgb;
  float a = vColor.a;
  float fadeIn = smoothstep(0.0, 0.06, t);
  if (kind < 0.5) {
    // свет: мягкое пятно, белый центр, мерцание
    if (r2 >= 1.0) discard;
    float f = 1.0 - r2;
    float m = f * f * (1.0 - smoothstep(0.45, 1.0, t)) * fadeIn;
    m *= 0.8 + 0.2 * fxNoise(vec2(seed * 40.0, t * 18.0));
    // белеет в центре только светлое ядро; насыщенный огонь и нефрит держат цвет
    float hi = max(rgb.r, max(rgb.g, rgb.b));
    float sat = hi > 0.0 ? (hi - min(rgb.r, min(rgb.g, rgb.b))) / hi : 0.0;
    vec3 light = mix(rgb, vec3(1.0, 0.98, 0.92), 0.6 * f * f * f * (1.0 - 0.75 * sat)) * m;
    gl_FragColor = fxLight(light * vis, 0.35);
    return;
  }
  if (kind < 1.5) {
    // облако: рваный край по шуму (языки пламени, клубы пыли и дыма)
    float n = fxNoise(vUv * 2.1 + vec2(seed * 31.0, seed * 17.0 - t * 2.5));
    float rr = sqrt(r2) + (n - 0.5) * 0.6;
    // пламя (насыщенный тёплый цвет) — рваный, но чёткий край мазка; пыль и дым — мягкие клубы
    float hot = smoothstep(0.4, 0.7, rgb.r - rgb.b);
    float m = (1.0 - smoothstep(mix(0.45, 0.6, hot), mix(1.0, 0.8, hot), rr)) * (1.0 - smoothstep(0.55, 1.0, t)) * fadeIn;
    if (m <= 0.002) discard;
    // к концу жизни пламя остывает к углям и копоти
    vec3 cooled = mix(rgb, vec3(0.5, 0.17, 0.06), 0.8 * smoothstep(0.35, 1.0, t));
    rgb = mix(rgb, cooled, hot);
    rgb = mix(rgb, vec3(1.0, 0.89, 0.63), hot * (1.0 - smoothstep(0.0, 0.35, t)) * (1.0 - smoothstep(0.0, 0.6, rr)));
    a *= m;
    vec3 glow = rgb * (hot * 0.38 * m * (1.0 - t));
    gl_FragColor = vec4((rgb * a + glow) * vis, a * vis);
    return;
  }
  // осколок камня: угловатый четырёхугольник с кромкой туши, освещённая и теневая половины
  vec2 q = abs(vUv);
  float shape = max(q.x * 0.95 + q.y * 0.5, q.y * 1.05 + q.x * 0.15);
  if (shape > 0.9) discard;
  rgb *= vUv.y > 0.1 * vUv.x ? 1.08 : 0.72;
  rgb = mix(rgb, vec3(0.1, 0.09, 0.08), smoothstep(0.66, 0.8, shape));
  a *= 1.0 - smoothstep(0.8, 1.0, t);
  gl_FragColor = vec4(rgb * a * vis, a * vis);
}
`;

export interface ParticlePool {
  readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  /** Сколько частиц в кольце сейчас (бюджет пресета). */
  readonly cap: number;
  setCap(cap: number): void;
  /** Новые частицы, рождённые в момент tS (секунды эпохи эффектов, та же шкала, что uTime). */
  emit(specs: readonly ParticleSpec[], tS: number): void;
  dispose(): void;
}

export interface ParticlePoolOptions {
  name: string;
  /** Наибольшая ёмкость (бюджет пресета «Высокое»): память выделяется один раз. */
  maxCap: number;
  cap: number;
  gbuffer: FxGBuffer;
  time: TimeUniform;
  /** Пул ладоней: координаты в пространстве камеры рук, без проверки глубины. */
  noDepth?: boolean;
}

/** Пул частиц: один InstancedMesh — один draw call. Процессор пишет только диапазоны новых частиц. */
export function createParticlePool(o: ParticlePoolOptions): ParticlePool {
  const max = Math.max(1, o.maxCap);
  const attr = (itemSize: number): InstancedBufferAttribute => {
    const a = new InstancedBufferAttribute(new Float32Array(max * itemSize), itemSize);
    a.setUsage(DynamicDrawUsage);
    return a;
  };
  const aP0 = attr(3);
  const aV0 = attr(3);
  const aTime = attr(4);
  const aColor = attr(4);
  const aGrav = attr(1);
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute("aP0", aP0);
  geometry.setAttribute("aV0", aV0);
  geometry.setAttribute("aTime", aTime);
  geometry.setAttribute("aColor", aColor);
  geometry.setAttribute("aGrav", aGrav);
  const material = createFxMaterial({
    name: o.name,
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    gbuffer: o.gbuffer,
    uniforms: { uTime: o.time },
    noDepth: o.noDepth ?? false,
  });
  const mesh = new InstancedMesh(geometry, material, max);
  mesh.name = o.name;
  mesh.frustumCulled = false;
  mesh.renderOrder = FX_ORDER.particles;
  let cap = Math.max(1, Math.min(max, o.cap));
  let head = 0;
  mesh.count = cap;
  const all = [aP0, aV0, aTime, aColor, aGrav];

  return {
    mesh,
    get cap() {
      return cap;
    },
    setCap(next) {
      cap = Math.max(1, Math.min(max, Math.floor(next)));
      head %= cap;
      mesh.count = cap;
    },
    emit(specs, tS) {
      if (specs.length === 0) return;
      // всплеск больше кольца: берём последние частицы, остальные всё равно затёрлись бы
      const list = specs.length > cap ? specs.slice(specs.length - cap) : specs;
      const r = allocateRing(head, cap, list.length);
      head = r.head;
      let k = 0;
      for (const range of r.ranges) {
        for (let i = range.start; i < range.start + range.count; i++, k++) {
          const s = list[k]!;
          aP0.array[i * 3] = s.pos.x;
          aP0.array[i * 3 + 1] = s.pos.y;
          aP0.array[i * 3 + 2] = s.pos.z;
          aV0.array[i * 3] = s.vel.x;
          aV0.array[i * 3 + 1] = s.vel.y;
          aV0.array[i * 3 + 2] = s.vel.z;
          aTime.array[i * 4] = tS;
          aTime.array[i * 4 + 1] = s.life;
          aTime.array[i * 4 + 2] = s.size0;
          aTime.array[i * 4 + 3] = s.size1;
          aColor.array[i * 4] = s.color[0];
          aColor.array[i * 4 + 1] = s.color[1];
          aColor.array[i * 4 + 2] = s.color[2];
          aColor.array[i * 4 + 3] = s.alpha;
          aGrav.array[i] = s.gravity;
        }
        for (const a of all) {
          a.addUpdateRange(range.start * a.itemSize, range.count * a.itemSize);
          a.needsUpdate = true;
        }
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
