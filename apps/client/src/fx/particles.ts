import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, type ShaderMaterial } from "three";
import { glslFloat } from "../render/stylePass";
import { FX_ORDER, GLAZE_TINT, createFxMaterial, type FxGBuffer, type TimeUniform } from "./fxShader";
import { RIM, type ParticleSpec } from "./particleKit";

/**
 * Место под n новых частиц в кольце ёмкостью cap, начиная с head: один или два диапазона (с переносом через
 * конец). Больше cap за раз не помещается — n обрезается до cap. Возвращает новую голову кольца.
 */
/**
 * Флаги частицы — в атрибуте тяжести, без нового атрибута: aGrav = тяжесть + FLAG_STEP × флаги (|тяжесть| < 50).
 * Штрих кисти, чужая и своя магия (кайма V3), своё у прицела (центр кадра чист, V4).
 */
export const FLAG_STEP = 100;
export const FLAG = { stroke: 1, foe: 2, own: 4, clear: 8 } as const;
/** Центр кадра у своего у прицела: чисто до 5°, полностью видно с 7,5° от оси взгляда. */
export const CLEAR_DEG = [5, 7.5] as const;

export function packGravity(s: ParticleSpec): number {
  const f = (s.stroke ? FLAG.stroke : 0) | (s.foe ? FLAG.foe : 0) | (s.own && !s.foe ? FLAG.own : 0) | (s.clear ? FLAG.clear : 0);
  return Math.max(-49, Math.min(49, s.gravity)) + FLAG_STEP * f;
}

/** Тяжесть и флаги обратно (как в шейдере). */
export function unpackGravity(g: number): { gravity: number; flags: number } {
  const flags = Math.floor((g + FLAG_STEP / 2) / FLAG_STEP);
  return { gravity: g - flags * FLAG_STEP, flags };
}

const v3 = (c: readonly [number, number, number]): string => `vec3(${c.map((x) => glslFloat(Math.round(x * 1e4) / 1e4)).join(", ")})`;
const tanDeg = (d: number): number => Math.tan((d * Math.PI) / 180);

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
 * частиц (пыль, дым, тело пламени) и штрихов скорость гаснет от сопротивления воздуха. Свет (альфа 0) вытянут шлейфом
 * по скорости на экране, штрих кисти — тоже по скорости, длиной в размер и тонкий; осколки крутятся. Мёртвая частица
 * уходит за кадр. Вид и флаги — в aGrav (packGravity).
 */
const PARTICLE_VERT = /* glsl */ `
uniform float uTime;
attribute vec3 aP0;
attribute vec3 aV0;
attribute vec4 aTime;
attribute vec4 aColor;
attribute float aGrav; // тяжесть + 100 × флаги (packGravity)
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vInfo;
varying float vSoft;
varying float vNear;
varying vec3 vView;
const float DRAG = 2.6;
const float STREAK_S = 0.04;
// ширина штриха — доля его длины
const float STROKE_W = 0.16;
// не больше этой доли высоты кадра на глубине частицы: вплотную к камере квадрат не заливает экран
const float MAX_SCREEN = 0.35;

// целочисленный хеш номера и момента рождения: одинаково на всех GPU, не теряет точность с ростом времени
float seedOf(uint i, float birth) {
  uint h = i * 2654435769u ^ floatBitsToUint(birth) * 2246822519u;
  h ^= h >> 15;
  h *= 3266489917u;
  h ^= h >> 13;
  return float(h & 0xffffffu) / 16777215.0;
}

void main() {
  float age = uTime - aTime.x;
  float life = aTime.y;
  vUv = position.xy * 2.0;
  vColor = aColor;
  vInfo = vec4(1.0, 0.0, 0.0, 0.0);
  vSoft = 1.0;
  vNear = 1.0;
  vView = vec3(0.0, 0.0, -1.0);
  if (life <= 0.0 || age < 0.0 || age >= life) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float t = age / life;
  float fl = floor((aGrav + 50.0) / 100.0);
  int flags = int(fl + 0.5);
  float grav = aGrav - fl * 100.0;
  // 0 — свет, 1 — мягкое облако, 2 — осколок, 3 — штрих кисти (ветер, удар тушью)
  float kind = aColor.a <= 0.0 ? 0.0 : (flags & FLAG_STROKE) != 0 ? 3.0 : (grav >= 9.0 ? 2.0 : 1.0);
  float drag = kind == 1.0 || kind == 3.0 ? DRAG : 0.0;
  float e = exp(-drag * age);
  float tv = drag > 0.0 ? (1.0 - e) / drag : age;
  vec3 pos = aP0 + aV0 * tv - vec3(0.0, 0.5 * grav * age * age, 0.0);
  vec3 vel = aV0 * e - vec3(0.0, grav * age, 0.0);
  float size = mix(aTime.z, aTime.w, t);
  float seed = seedOf(uint(gl_InstanceID), aTime.x);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float depth = -mv.z;
#ifdef FX_NO_DEPTH
  float nearK = 1.0;
#else
  // ближе 0,6 м к глазам частица гаснет, ближе 0,35 м — не рисуется
  float nearK = smoothstep(0.35, 0.6, depth);
  if (nearK <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
#endif
  float maxSize = 2.0 * MAX_SCREEN * depth / projectionMatrix[1][1];
  size = min(size, maxSize);
  vec2 ax;
  float along = size;
  float across = size;
  if (kind == 0.0 || kind == 3.0) {
    vec2 sv = (mat3(modelViewMatrix) * vel).xy;
    float sp = length(sv);
    ax = sp > 1e-3 ? sv / sp : vec2(1.0, 0.0);
    if (kind == 0.0) along = min(size + sp * STREAK_S, maxSize);
    else across = size * STROKE_W;
  } else {
    float spin = kind == 2.0 ? (seed - 0.5) * 18.0 : (seed - 0.5) * 1.2;
    float a = seed * 6.2831853 + age * spin;
    ax = vec2(cos(a), sin(a));
  }
  vec2 ay = vec2(-ax.y, ax.x);
  mv.xy += ax * (position.x * along) + ay * (position.y * across);
  gl_Position = projectionMatrix * mv;
  vView = mv.xyz;
  vInfo = vec4(t, seed, kind, float(flags));
  vSoft = max(0.04, across * 0.5);
  vNear = nearK;
}
`;

const PARTICLE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vInfo;
varying float vSoft;
varying float vNear;
varying vec3 vView;

void main() {
  float t = vInfo.x;
  float seed = vInfo.y;
  float kind = vInfo.z;
  int flags = int(vInfo.w + 0.5);
  // пятно, облако и осколок лежат в единичном круге: угол квадрата отбрасываем до выборок G-буфера; штрих — на весь
  // квадрат
  float r2 = kind > 2.5 ? max(vUv.x * vUv.x, vUv.y * vUv.y) : dot(vUv, vUv);
  if (r2 >= 1.0) discard;
  float vis = fxVisibility(vSoft) * vNear;
  // своё у прицела (Дыхание изнутри, V4): центр кадра остаётся чистым
  if ((flags & FLAG_CLEAR) != 0) vis *= smoothstep(CLEAR_TAN0, CLEAR_TAN1, length(vView.xy) / max(-vView.z, 1e-3));
  if (vis <= 0.0) discard;
  vec3 rgb = vColor.rgb;
  float a = vColor.a;
  float fadeIn = smoothstep(0.0, 0.06, t);
  if (kind < 0.5) {
    // свет: мягкое пятно, белый центр, мерцание
    float f = 1.0 - r2;
    float m = f * f * (1.0 - smoothstep(0.45, 1.0, t)) * fadeIn;
    m *= 0.8 + 0.2 * fxNoise(vec2(seed * 40.0, t * 18.0));
    // белеет в центре только светлое ядро; насыщенный огонь и нефрит держат цвет
    float hi = max(rgb.r, max(rgb.g, rgb.b));
    float sat = hi > 0.0 ? (hi - min(rgb.r, min(rgb.g, rgb.b))) / hi : 0.0;
    vec3 light = mix(rgb, vec3(1.0, 0.98, 0.92), 0.6 * f * f * f * (1.0 - 0.75 * sat)) * m;
    // свет частиц копится слоями (десяток ядер взрыва): над врагом он гаснет как плотное, иначе залил бы силуэт белым
    gl_FragColor = fxLight(light * fxDense(vis), PARTICLE_TINT);
    return;
  }
  if (kind > 2.5) {
    // штрих кисти: x — вдоль (к +1 голова, по скорости), y — поперёк; у хвоста толще и скруглён, к голове — остриё,
    // край рвёт сухая кисть. Светлая тушь (Воздух) — с белым бликом вдоль, тёмная (удар) — без
    float u = vUv.x * 0.5 + 0.5;
    float n = fxNoise(vec2(vUv.x * 3.5 + seed * 23.0, seed * 7.0 + vUv.y * 0.8));
    float w = mix(0.95, 0.2, u) * (0.8 + 0.4 * n) * sqrt(smoothstep(0.0, 0.16, u));
    float m = (1.0 - smoothstep(w - 0.18, w, abs(vUv.y))) * (1.0 - smoothstep(0.86, 1.0, u)) * (1.0 - smoothstep(0.6, 1.0, t)) * fadeIn;
    if (m <= 0.002) discard;
    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float hl = step(0.2, lum) * (1.0 - smoothstep(0.0, 0.16, abs(vUv.y - w * 0.4))) * smoothstep(0.15, 0.4, u) * (1.0 - smoothstep(0.6, 0.85, u));
    rgb = mix(rgb, vec3(1.0, 0.99, 0.96), 0.75 * hl);
    a *= m * fxDense(vis);
    gl_FragColor = vec4(rgb * a, a);
    return;
  }
  if (kind < 1.5) {
    // облако: рваный край по шуму (языки пламени, клубы пыли и дыма)
    float n = fxNoise(vUv * 2.1 + vec2(seed * 31.0, seed * 17.0 - t * 2.5));
    float rr = sqrt(r2) + (n - 0.5) * 0.6;
    // пламя (насыщенный тёплый цвет) — рваный, но чёткий край мазка; пыль и дым — мягкие клубы
    float hot = smoothstep(0.4, 0.7, rgb.r - rgb.b);
    // вода — лазурь (синее красного); пена — почти белая с голубизной: у неё линия
    float wet = smoothstep(0.35, 0.55, rgb.b - rgb.r);
    float froth = step(0.06, rgb.b - rgb.r) * smoothstep(0.86, 0.92, dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
    float life = (1.0 - smoothstep(0.55, 1.0, t)) * fadeIn;
    float m = (1.0 - smoothstep(mix(0.45, 0.6, hot), mix(1.0, 0.8, hot), rr)) * life;
    // кайма (V3, GDD 2.2) — у края мазка: чужая тёмная зубчатая (шум втрое чаще), своя гладкая средним тоном;
    // хозяин неизвестен — без каймы. Пена — тонкая линия всегда
    bool foe = (flags & FLAG_FOE) != 0;
    bool own = (flags & FLAG_OWN) != 0;
    float q = rr / mix(1.0, 0.8, hot);
    float rimA = 0.0;
    vec3 rimC = RIM_FOAM;
    if ((foe || own) && hot + wet > 0.0) {
      float jag = foe ? (fxNoise(vUv * 6.3 + vec2(seed * 13.0, -t * 7.5)) - 0.5) * 0.24 : 0.0;
      float band = smoothstep(0.74, 0.8, q + jag) * (1.0 - smoothstep(0.92, 0.98, q - jag));
      rimC = foe ? mix(RIM_FOE_WATER, RIM_FOE_FIRE, hot) : mix(RIM_OWN_WATER, RIM_OWN_FIRE, hot);
      rimA = band * max(hot, wet) * (foe ? RIM_FOE_A : RIM_OWN_A);
    } else if (froth > 0.0) {
      rimA = smoothstep(0.82, 0.87, q) * (1.0 - smoothstep(0.93, 0.98, q)) * froth * RIM_FOAM_A;
    }
    rimA *= life;
    if (m + rimA <= 0.002) discard;
    // к концу жизни пламя остывает к тёмной охре (а не к красному HP) и копоти
    vec3 cooled = mix(rgb, vec3(0.48, 0.22, 0.08), 0.8 * smoothstep(0.35, 1.0, t));
    rgb = mix(rgb, cooled, hot);
    rgb = mix(rgb, vec3(1.0, 0.89, 0.63), hot * (1.0 - smoothstep(0.0, 0.35, t)) * (1.0 - smoothstep(0.0, 0.6, rr)));
    float dk = fxDense(vis);
    a *= m * dk;
    rimA *= dk;
    vec3 glow = rgb * (hot * 0.38 * m * (1.0 - t));
    // кайма — слой поверх тела (предумноженно)
    gl_FragColor = vec4(rimC * rimA + (rgb * a + glow * vis) * (1.0 - rimA), rimA + a * (1.0 - rimA));
    return;
  }
  // осколок камня: угловатый четырёхугольник с кромкой туши, освещённая и теневая половины
  vec2 q = abs(vUv);
  float shape = max(q.x * 0.95 + q.y * 0.5, q.y * 1.05 + q.x * 0.15);
  if (shape > 0.9) discard;
  rgb *= vUv.y > 0.1 * vUv.x ? 1.08 : 0.72;
  rgb = mix(rgb, vec3(0.1, 0.09, 0.08), smoothstep(0.66, 0.8, shape));
  a *= (1.0 - smoothstep(0.8, 1.0, t)) * fxDense(vis);
  gl_FragColor = vec4(rgb * a, a);
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
    defines: {
      PARTICLE_TINT: glslFloat(GLAZE_TINT.particles),
      FLAG_STROKE: FLAG.stroke,
      FLAG_FOE: FLAG.foe,
      FLAG_OWN: FLAG.own,
      FLAG_CLEAR: FLAG.clear,
      CLEAR_TAN0: glslFloat(tanDeg(CLEAR_DEG[0])),
      CLEAR_TAN1: glslFloat(tanDeg(CLEAR_DEG[1])),
      RIM_FOE_FIRE: v3(RIM.foe.fire),
      RIM_FOE_WATER: v3(RIM.foe.water),
      RIM_OWN_FIRE: v3(RIM.own.fire),
      RIM_OWN_WATER: v3(RIM.own.water),
      RIM_FOAM: v3(RIM.foamLine.color),
      RIM_FOE_A: glslFloat(RIM.foe.alpha),
      RIM_OWN_A: glslFloat(RIM.own.alpha),
      RIM_FOAM_A: glslFloat(RIM.foamLine.alpha),
    },
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
          aGrav.array[i] = packGravity(s);
        }
        for (const a of all) {
          // кадр без отрисовки (вкладка в фоне) копил бы диапазоны: больше 32 — грузим кольцо целиком
          if (a.updateRanges.length >= 32) {
            a.clearUpdateRanges();
            a.addUpdateRange(0, cap * a.itemSize);
          } else a.addUpdateRange(range.start * a.itemSize, range.count * a.itemSize);
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
