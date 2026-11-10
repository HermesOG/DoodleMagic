import { Group, Scene, Vector3, type PerspectiveCamera } from "three";
import { EARTH, ELEMENT_INFO, TICK_HZ, statusFlags, type Element, type MatchState, type Projectile, type Terrain, type Unit, type UnitId, type Vec3, type Zone } from "@doodlemagic/sim";
import type { BurstPreset, Effect, FeelTier } from "../feel/effects";
import { TIERS } from "../feel/eventMap";
import { stepSpring, type Spring } from "../hands/spring";
import type { PresetId } from "../render/quality";
import { HANDS_FOV, WORLD_FOV, type FxLayers, type StyleRenderer } from "../render/styleRenderer";
import { createDebris } from "./debris";
import { createDecalMeshes, markDecal, zoneDecal, type DecalSpec, type RootRing } from "./decals";
import { createDummyMeshes, type DummyView } from "./dummyMeshes";
import { ELEMENT_VFX, type ElementVfxFrame } from "./elementVfx";
import { createFireWallMeshes, fireWallSheet, type FireWallSheet } from "./fireWalls";
import type { TimeUniform } from "./fxShader";
import { createGlowMeshes, cullGlows, type Glow } from "./glows";
import { SNAP_M, handToWorldView, lerpById, muzzleBlend, renderTick } from "./interp";
import { createMageMeshes, mageHands, mageLineScale, type MagePose } from "./mageMeshes";
import { createParticlePool } from "./particles";
import { createPickupVfx } from "./pickupVfx";
import {
  BURST_SHARE, FX_COLOR, IDLE_PALM_RATE, KNOCK_DUST_RATE, MAGIC_LIGHTS, PEBBLE_RATE, burstParticles, idlePalmParticle, knockDust, lineFlames, palmParticles,
  pebbleParticle, poolCaps, thinParticles, trailParticles, type ParticleSpec,
} from "./presets";
import { PROJECTILE_LOOK, createProjectileMeshes, type ProjectileDraw } from "./projectileMeshes";
import { createTerrainMeshes, createVeinMeshes, terrainVisualBox, veinFaces, type VeinFace } from "./terrainMeshes";
import { createUltVfx } from "./ultVfx";

/** Что видит эффектник за кадр. Ладони — в пространстве камеры рук (как их ставят руки). */
export interface VfxView {
  prev: MatchState;
  cur: MatchState;
  alpha: number;
  nowS: number;
  camera: PerspectiveCamera;
  localId: UnitId;
  palms: { right: Vector3; left: Vector3 };
}

/**
 * Эффекты магии. Порядок за кадр:
 * 1. поза камеры мира (position, rotation; матрицы обновит sync);
 * 2. `apply` — эффекты этого кадра (из карты событий);
 * 3. `sync` — состояние матча и время;
 * 4. `StyleRenderer.render(world, overlay, vfx.fx)`.
 *
 * Часы одни: `nowS` в `apply` и в `VfxView.nowS` — одна и та же шкала секунд (рост рельефа, вспышки,
 * жизнь частиц); пауза часов замораживает эффекты. `palms` — в пространстве камеры рук (overlayCamera), как их
 * ставят руки. `setPreset` вызывается вместе с `StyleRenderer.setPreset` тем же пресетом: от него зависят бюджет
 * частиц, доля всплесков, число источников света и дешёвый шум стены огня.
 */
export interface Vfx {
  /** Меши G-буфера (манекены, чужие маги, рельеф, ядра снарядов, обломки): добавить в сцену мира. */
  readonly worldGroup: Group;
  /** Сцены прохода света — третий аргумент StyleRenderer.render и warmUp. */
  readonly fx: FxLayers;
  /** Исполняет burst, palm, flash и flinch; остальное пропускает. hand — чья рука для palm с hand "auto". */
  apply(e: Effect, nowS: number, hand: "left" | "right"): void;
  /**
   * Раз в кадр: положения между prev и cur, зоны и рельеф из cur, время эффектов. Живые маги, кроме localId, рисуются
   * фигурами (не больше MAX_MAGES), мёртвые — нет.
   */
  sync(v: VfxView): void;
  setPreset(p: PresetId): void;
  dispose(): void;
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const DEG = Math.PI / 180;
/** Наклон по отбрасыванию: столько градусов на 1 м/с канала kb, не больше 20°. */
const LEAN_PER_MPS = 1.4 * DEG;
const LEAN_MAX = 20 * DEG;
const LEAN_OMEGA = 11;
/** Вздрагивание от удара: пик 10–15° (пружина stepSpring, толчок скорости). */
const FLINCH_OMEGA = 13;
/**
 * Вспышка цели по ступени удара, с (round3/01, H2): малая 90 мс (фаза 9, L5: 3+ кадра на 40 FPS — попадание видно
 * и издалека), средняя 100, крупная 130.
 */
export const FLASH_S: Readonly<Record<FeelTier, number>> = { none: 0.09, small: 0.09, medium: 0.1, large: 0.13 };
/**
 * Пауза цели малой ступени, мс (фаза 9, L5): камень, серп и хлыст 50; кулак Огня 40 — короче остальных, он бьёт
 * 4 раза в секунду (темп). Своя, не hitstop ступени: тот — пауза рук стреляющего.
 */
export const SMALL_FREEZE_MS = { fist: 40, other: 50 } as const;
/** После паузы цель догоняет настоящее положение за столько секунд. */
const CATCH_UP_S = 0.06;

/**
 * Пауза рендера цели и длина вспышки по попаданию (H2). Ступень — по силе вздрагивания из карты событий (0,1 —
 * основная атака, больше — способность). Малая ступень — SMALL_FREEZE_MS, средняя и крупная — hitstop ступени.
 */
export function hitFreeze(flinchAmount: number, shooter: Element | null): { tier: FeelTier; freezeS: number; flashS: number } {
  const tier: FeelTier = flinchAmount <= 0.15 ? "small" : flinchAmount < 0.7 ? "medium" : "large";
  const ms = tier === "small" ? (shooter === "fire" ? SMALL_FREEZE_MS.fist : SMALL_FREEZE_MS.other) : TIERS[tier].hitstopMs;
  return { tier, freezeS: ms / 1000, flashS: FLASH_S[tier] };
}
/** Чужих магов на экране — не больше (комната до 6 магов, свой не рисуется). */
const MAX_MAGES = 6;
/** Фаза шага на метр пути: полный цикл (два шага) — на 2,2 м, на беге ≈ 3 шага в секунду. */
const STRIDE_PER_M = (2 * Math.PI) / 2.2;
/** Сглаживание скорости для размаха ног, с: разгон и остановка без рывка. */
const SPEED_TAU_S = 0.08;
/** Ноги поджимаются, если маг в воздухе дольше этого: ступенька и кочка — не прыжок. */
const AIR_TUCK_S = 0.06;
/**
 * Свечение стихии на руках мага: ореол не меньше HAND_HALO_M и не меньше HAND_HALO_PER_M от расстояния (издалека
 * ≈ 9 px кадра 1080p); в замахе ярче и шире. Огонь дрожит и светит на мир, Земля ровная и не светится (как её камень):
 * стихии отличаются не только оттенком (GDD 6).
 */
const HAND_HALO_M = 0.34;
const HAND_HALO_PER_M = 0.012;
const HAND_LIGHT_M = 2.2;
const HAND_GLOW: Readonly<Record<Element, { color: readonly [number, number, number]; intensity: number; light: number }>> = {
  fire: { color: FX_COLOR.fire, intensity: 0.9, light: HAND_LIGHT_M },
  earth: { color: FX_COLOR.jade, intensity: 0.8, light: 0 },
  air: { color: FX_COLOR.air, intensity: 0.75, light: 0 },
  water: { color: FX_COLOR.water, intensity: 0.85, light: 1.6 },
};
/** Пыль из-под ног — пока толчок по полу не слабее этого, м/с (K3). */
const KNOCK_DUST_MPS = 2;
/** «Корни» Земли: толчок начался (канал kb вырос с почти нуля) — кольцо пыли у ног на столько секунд. */
const ROOTS_FLASH_S = 0.45;
/** Свечение рук уступает свет мира снарядам, стенам и вспышкам, но не горению (prio 1). */
const HAND_PRIO = 0.6;
const REST_PALM = { x: 0.26, y: -0.25, z: -0.62 } as const;

type FlashLight = { light: number; halo: number; intensity: number; life: number; core: number };
/** Свет вспышек всплесков огня: радиус на мир, ореол, яркость, жизнь. Земля не светится. */
const BURST_LIGHT: Partial<Record<BurstPreset, FlashLight>> = {
  // свет «дула» кулака (фаза 9, L6): горит у ладони, а не всплеском в мире — см. MUZZLE_LIGHT; ядро дают частицы ладони
  fistFlash: { light: 2.5, halo: 0, intensity: 1, life: 0.07, core: 0 },
  fistImpact: { light: 2.4, halo: 0.6, intensity: 1.3, life: 0.14, core: 0.8 },
  fireballCharge: { light: 2.2, halo: 0.7, intensity: 0.9, life: 0.25, core: 0.5 },
  fireballBoom: { light: 7.5, halo: 2.8, intensity: 1.7, life: 0.45, core: 1.2 },
  dashBlast: { light: 3.5, halo: 1.1, intensity: 1.2, life: 0.25, core: 0.7 },
  fireWallIgnite: { light: 6, halo: 0, intensity: 1.4, life: 0.4, core: 0 },
  fireWallSparks: { light: 2, halo: 0, intensity: 0.6, life: 0.4, core: 0 },
  deathFire: { light: 4, halo: 1.3, intensity: 1.3, life: 0.45, core: 0.8 },
  // Дыхание дракона: выдох светит на мир; вспышка потока на цели — только ореол (свет потока уже есть)
  breathFlare: { light: 5, halo: 1, intensity: 1.4, life: 0.3, core: 0.8 },
  breathHit: { light: 0, halo: 0.5, intensity: 0.9, life: 0.12, core: 0.4 },
};

/**
 * Свет «дула» своего выстрела (фаза 9, L6): выстрел видно боковым зрением — вокруг вспыхивает мир. Огонь — 2,5 м
 * на 70 мс (оживший fistFlash), Вода — 1,2 м на 60 мс на ударе хлыста. Земля без света (стиль), Воздух не светится.
 * Только свет на мир: ядро у ладони — частицы ладони, ореол в мире перед глазами лёг бы пятном на руку.
 */
export const MUZZLE_LIGHT: Readonly<Record<"fire" | "water", FlashLight>> = {
  fire: BURST_LIGHT.fistFlash!,
  water: { light: 1.2, halo: 0, intensity: 0.9, life: 0.06, core: 0 },
};
/** Свет дула — ниже всех (сферы 0,3, руки магов 0,6): на мир светит, только если источник пресета свободен. */
export const MUZZLE_PRIO = 0.2;

/**
 * Чья ладонь вспыхивает светом дула от эффекта: вспышка ладони Огня — рука этого удара (hand — для "auto"), своя
 * дуга хлыста — правая (хлыст бьёт правой, см. waterVfx). Прочее — null.
 */
export function muzzleOf(e: Effect, localId: UnitId, hand: "left" | "right"): { element: "fire" | "water"; hand: "left" | "right" | "both" } | null {
  if (e.kind === "palm" && e.element === "fire" && e.preset === "flash") return { element: "fire", hand: e.hand === "auto" ? hand : e.hand };
  if (e.kind === "burst" && e.preset === "whipArc" && e.owner === localId) return { element: "water", hand: "right" };
  return null;
}

/** Отклик юнита по id — общий у манекенов и магов: вспышка и вздрагивание приходят по id из эффектов. */
interface DummyAnim {
  sx: Spring;
  sz: Spring;
  kick: Spring;
  squash: Spring;
  flashUntil: number;
  lastBurnS: number;
  landTick: number;
  seen: boolean;
  /** Мага: фаза шага, сглаженная скорость, сколько секунд в воздухе, прошлая точка подошвы. */
  stride: number;
  speed: number;
  airS: number;
  last: Vec3 | null;
  /** Пауза рендера (H2): до freezeUntil поза и место стоят в frozen, потом догоняют за CATCH_UP_S. */
  flashAt: number;
  freezeUntil: number;
  frozenSet: boolean;
  frozen: { x: number; y: number; z: number; yaw: number; pitch: number };
  /** Толчок со стороны (K3): накопитель пыли, прошлая сила канала kb, когда «Корни» погасили толчок. */
  dust: number;
  kbPrev: number;
  rootsAt: number;
}

/** След удара на полу (A3): подпалина шара, трещины землетрясения. Живёт в эффектнике, не в зоне. */
interface Mark {
  kind: "scorch" | "quake";
  center: Vec3;
  radius: number;
  born: number;
  seed: number;
}
/** Следов на полу одновременно — не больше: старый уступает новому. */
const MAX_MARKS = 8;

/**
 * Пол под взрывом шара: попал в стоящего — его подошва; в летящего — пола рядом нет (null); иначе — точка взрыва
 * (пол, рельеф или стена).
 */
export function scorchFloor(pos: Vec3, units: readonly Unit[]): number | null {
  for (const u of units) {
    if (!u.alive) continue;
    const b = u.move.body.pos;
    if (Math.hypot(b.x - pos.x, b.z - pos.z) > 1.2 || pos.y < b.y - 0.3 || pos.y > b.y + 2.4) continue;
    return u.move.onGround ? b.y : null;
  }
  return pos.y;
}

interface Flash {
  pos: Vec3;
  light: number;
  halo: number;
  intensity: number;
  life: number;
  core: number;
  born: number;
  color: readonly [number, number, number];
  prio: number;
  /** Свет дула: точка — эта ладонь, каждый кадр переведённая в мир по камере (вспышка идёт за рукой); null — pos. */
  palm: "left" | "right" | "both" | null;
}

interface Track {
  last: Vec3 | null;
  acc: number;
  hand: "left" | "right" | "both";
  seen: boolean;
}

interface Seen<T> {
  item: T;
  tick: number;
  hp: number;
  hitAt: number;
  seen: boolean;
}

type GlowEntry = Glow & { prio: number };

/** Угол между a и b по короткой дуге: доля t. */
function lerpAngle(a: number, b: number, t: number): number {
  const d = (((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
}

function lineOfBox(z: Zone): { a: Vec3; b: Vec3 } | null {
  if (z.shape.type === "box") {
    const b = z.shape.box;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    return b.max.x - b.min.x >= b.max.z - b.min.z
      ? { a: { x: b.min.x, y: b.min.y, z: cz }, b: { x: b.max.x, y: b.min.y, z: cz } }
      : { a: { x: cx, y: b.min.y, z: b.min.z }, b: { x: cx, y: b.min.y, z: b.max.z } };
  }
  if (z.shape.type === "segment") return { a: z.shape.a, b: z.shape.b };
  return null;
}

/**
 * Эффекты магии поверх G-буфера: собирает пулы частиц, ореолы и свет, декали, стены огня, рельеф с прожилками,
 * манекенов и чужих магов с ореолом, ядра снарядов и обломки. Бюджет: G-буфер +8 вызовов (манекены 2, маги 2,
 * рельеф 1, ядра 2, обломки 1), проход света +5 (стены огня, декали, частицы, ореолы, прожилки), ладони +1;
 * пустые пулы не рисуются. Свечение рук магов — в общем меше ореолов, без своего вызова. Ульты Огня и Земли (ultVfx) —
 * +1 конус Дыхания в проходе света и +1 шипы Разлома в G-буфере, только пока они идут. Объекты на карте (pickupVfx,
 * фаза 6) — +2 в проходе света: тела сфер и руны, печати на полу; свечение носителя ярости — в общем меше ореолов.
 */
export function createVfx(gbuffer: StyleRenderer["gbuffer"], preset: PresetId): Vfx {
  const time: TimeUniform = { value: 0 };
  let epoch: number | null = null;
  const rel = (nowS: number): number => {
    if (epoch === null) epoch = nowS;
    return nowS - epoch;
  };
  let caps = poolCaps(preset);
  let lights = MAGIC_LIGHTS[preset];
  let share = BURST_SHARE[preset];
  const top = poolCaps("high");
  const worldPool = createParticlePool({ name: "fx-particles", maxCap: top.world, cap: caps.world, gbuffer, time });
  const palmPool = createParticlePool({ name: "fx-palm", maxCap: top.palm, cap: caps.palm, gbuffer, time, noDepth: true });
  const glows = createGlowMeshes(gbuffer);
  const decals = createDecalMeshes(gbuffer, time);
  const walls = createFireWallMeshes(gbuffer, time);
  walls.setCheap(preset !== "high");
  const veins = createVeinMeshes(gbuffer, time);
  const dummies = createDummyMeshes(8);
  const mages = createMageMeshes(MAX_MAGES);
  const terrain = createTerrainMeshes(24);
  const cores = createProjectileMeshes(48);
  const debris = createDebris();
  // эффектники стихий фазы 4 (Воздух, Вода), ульт Огня и Земли (фаза 5) и объектов на карте (фаза 6) — тем же интерфейсом
  const elements = [...ELEMENT_VFX, createUltVfx, createPickupVfx].map((make) => make({ gbuffer, time }));
  // стартовый пресет — и эффектникам стихий (дешёвый шум конуса на «Низком» и «Среднем»), не только по смене
  for (const el of elements) el.setPreset?.(preset);

  const worldGroup = new Group();
  worldGroup.name = "vfx";
  worldGroup.add(dummies.parts, dummies.shells, mages.group, terrain.mesh, cores.fire, cores.stone, debris.mesh);
  const fxWorld = new Scene();
  fxWorld.name = "fx-world";
  fxWorld.add(walls.mesh, decals.mesh, worldPool.mesh, glows.mesh, veins.mesh);
  for (const el of elements) {
    if (el.world) worldGroup.add(el.world);
    if (el.light) fxWorld.add(el.light);
  }
  const fxPalm = new Scene();
  fxPalm.name = "fx-palm";
  fxPalm.add(palmPool.mesh);

  const anims = new Map<UnitId, DummyAnim>();
  const tracks = new Map<number, Track>();
  const terrainSeen = new Map<number, Seen<Terrain>>();
  const ignited = new Map<number, { embers: number }>();
  const flashes: Flash[] = [];
  const marks: Mark[] = [];
  /** Юниты прошлого кадра — где пол под взрывом. */
  let lastUnits: readonly Unit[] = [];
  const addMark = (m: Mark): void => {
    if (marks.length >= MAX_MARKS) marks.shift();
    marks.push(m);
  };
  const palms = { right: new Vector3(REST_PALM.x, REST_PALM.y, REST_PALM.z), left: new Vector3(-REST_PALM.x, REST_PALM.y, REST_PALM.z) };
  let lastPalmHand: "left" | "right" = "right";
  /** Стихия своего мага (из прошлого кадра) — у кулака Огня нет паузы цели. */
  let localElement: Element | null = null;
  /** Стихия у своих ладоней (A5): накопители частиц и камешков, замах своего мага. */
  let localWindup = false;
  let idleAcc = 0;
  let pebbleAcc = 0;
  let lastNowS: number | null = null;
  const tmp = new Vector3();
  const eye = new Vector3();

  /** Мировой пул с долей всплесков пресета (BURST_SHARE). */
  const emitWorld = (specs: readonly ParticleSpec[], t: number): void => worldPool.emit(thinParticles(specs, share), t);

  const anim = (id: UnitId): DummyAnim => {
    let a = anims.get(id);
    if (!a) {
      a = {
        sx: { x: 0, v: 0 }, sz: { x: 0, v: 0 }, kick: { x: 0, v: 0 }, squash: { x: 0, v: 0 },
        flashUntil: -1, lastBurnS: -1, landTick: -1, seen: true, stride: 0, speed: 0, airS: 0, last: null,
        flashAt: -1, freezeUntil: -1, frozenSet: false, frozen: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
        dust: 0, kbPrev: 0, rootsAt: -10,
      };
      anims.set(id, a);
    }
    return a;
  };
  // кадр стихий и общие списки кадра — одни на всё время, обнуляются length = 0
  const glowList: GlowEntry[] = [];
  const decalList: { spec: DecalSpec; seed: number; intensity: number }[] = [];
  const roots: RootRing[] = [];
  const liveUnits: { id: UnitId; pos: Vec3; u: Unit }[] = [];
  const liveMages: { id: UnitId; pose: MagePose; u: Unit }[] = [];
  let frameCam: PerspectiveCamera | null = null;
  let frameNowT = 0;
  const frameEye = { x: 0, y: 0, z: 0 };
  const palmWorld = (h: "left" | "right" | "both"): Vec3 => {
    if (h === "both") {
      const r = palmWorld("right");
      const l = palmWorld("left");
      return { x: (r.x + l.x) / 2, y: (r.y + l.y) / 2, z: (r.z + l.z) / 2 };
    }
    const q = handToWorldView(palms[h], HANDS_FOV, WORLD_FOV);
    frameCam?.localToWorld(tmp.set(q.x, q.y, q.z));
    return { x: tmp.x, y: tmp.y, z: tmp.z };
  };
  const frame: ElementVfxFrame = {
    prev: null as unknown as MatchState,
    cur: null as unknown as MatchState,
    alpha: 0,
    tick: 0,
    nowS: 0,
    dt: 0,
    camera: null as unknown as PerspectiveCamera,
    eye: frameEye,
    localId: 0 as UnitId,
    units: liveUnits,
    mages: liveMages,
    palmWorld,
    emit: (specs) => emitWorld(specs, frameNowT),
    glow: (g, prio) => glowList.push({ ...g, prio }),
    decal: (spec, seed, intensity = 1) => decalList.push({ spec, seed, intensity }),
  };

  const viewportH = (): number => {
    const img = gbuffer.surface.image as { height?: number } | null;
    return img?.height && img.height > 1 ? img.height : 1080;
  };

  return {
    worldGroup,
    fx: { world: fxWorld, palm: fxPalm },

    apply(e, nowS, hand) {
      const t = rel(nowS);
      for (const el of elements) el.apply?.(e, nowS);
      // свет дула своего выстрела (L6) — у ладони, низшим приоритетом
      const muzzle = muzzleOf(e, frame.localId, hand);
      if (muzzle) flashes.push({ ...MUZZLE_LIGHT[muzzle.element], pos: palmWorld(muzzle.hand), born: t, color: FX_COLOR[muzzle.element], prio: MUZZLE_PRIO, palm: muzzle.hand });
      switch (e.kind) {
        case "burst": {
          emitWorld(burstParticles(e.preset, e.pos, e.dir, e.scale, Math.random), t);
          const l = BURST_LIGHT[e.preset];
          if (l) flashes.push({ ...l, pos: { ...e.pos }, born: t, light: l.light * Math.min(1.5, Math.max(0.7, e.scale)), color: FX_COLOR.fire, prio: 5, palm: null });
          if (e.preset === "fireballBoom") {
            const y = scorchFloor(e.pos, lastUnits);
            if (y !== null) addMark({ kind: "scorch", center: { x: e.pos.x, y, z: e.pos.z }, radius: 1.2 * Math.min(1.5, Math.max(0.5, e.scale)), born: t, seed: Math.random() * 17 });
          } else if (e.preset === "quakeRing") {
            addMark({ kind: "quake", center: { ...e.pos }, radius: EARTH.earthquake.radiusM * Math.min(1.5, Math.max(0.5, e.scale)), born: t, seed: Math.random() * 17 });
          }
          break;
        }
        case "palm": {
          const hands: ("left" | "right")[] = e.hand === "both" ? ["left", "right"] : [e.hand === "auto" ? hand : e.hand];
          for (const h of hands) palmPool.emit(palmParticles(e.element, e.preset, palms[h], Math.random), t);
          lastPalmHand = hands[hands.length - 1]!;
          break;
        }
        case "flash": {
          const a = anim(e.target);
          a.flashAt = nowS;
          a.flashUntil = Math.max(a.flashUntil, nowS + FLASH_S.small);
          break;
        }
        case "flinch": {
          const a = anim(e.target);
          // вздрагивание того же кадра, что вспышка, — попадание: ступень задаёт паузу цели и длину вспышки
          if (a.flashAt === nowS) {
            const h = hitFreeze(e.amount, localElement);
            a.flashUntil = Math.max(a.flashUntil, nowS + h.flashS);
            if (h.freezeS > 0) a.freezeUntil = Math.max(a.freezeUntil, nowS + h.freezeS);
          }
          const l = Math.hypot(e.dir.x, e.dir.z);
          const dx = l > 1e-6 ? e.dir.x / l : 0;
          const dz = l > 1e-6 ? e.dir.z / l : -1;
          // толчок скорости пружины: пик x·e^{−1}/ω после удара — 10–15° по силе
          const peak = (10 + 5 * Math.min(1, Math.max(0, e.amount))) * DEG;
          const v0 = peak * FLINCH_OMEGA * Math.E;
          a.sx = { x: a.sx.x, v: a.sx.v + v0 * dz };
          a.sz = { x: a.sz.x, v: a.sz.v - v0 * dx };
          a.kick = { x: a.kick.x, v: a.kick.v + v0 * 0.25 };
          break;
        }
        default:
          break;
      }
    },

    sync(v) {
      const nowT = rel(v.nowS);
      time.value = nowT;
      lastUnits = v.cur.units;
      const dt = lastNowS === null ? 0 : Math.min(0.1, Math.max(0, v.nowS - lastNowS));
      lastNowS = v.nowS;
      const tick = renderTick(v.prev, v.cur, v.alpha);
      const cam = v.camera;
      frameCam = cam;
      frameNowT = nowT;
      cam.updateMatrixWorld();
      cam.getWorldPosition(eye);
      palms.right.copy(v.palms.right);
      palms.left.copy(v.palms.left);
      glowList.length = 0;
      decalList.length = 0;
      roots.length = 0;

      // юниты: манекены и чужие маги (поза, ореол, вспышка), горение и обездвиживание у всех
      for (const a of anims.values()) a.seen = false;
      localElement = null;
      localWindup = false;
      const unitsOf = (s: MatchState) => s.units.map((u) => ({ id: u.id, pos: u.move.body.pos, u }));
      const prevUnits = new Map<UnitId, Unit>();
      for (const u of v.prev.units) prevUnits.set(u.id, u);
      const views: DummyView[] = [];
      const mageViews: MagePose[] = [];
      liveUnits.length = 0;
      liveMages.length = 0;
      for (const it of lerpById(unitsOf(v.prev), unitsOf(v.cur), v.alpha)) {
        const u = it.u;
        if (!u.alive) continue;
        liveUnits.push(it);
        const flags = statusFlags(u, v.cur.tick);
        if (flags.rooted) roots.push({ center: { x: it.pos.x, y: it.pos.y, z: it.pos.z }, radius: 0.65 });
        const mage = u.kind === "mage";
        if (u.id === v.localId) {
          localElement = u.mage?.element ?? null;
          localWindup = !!u.mage?.windup;
        }
        // свой маг — руки от первого лица, его фигуры нет
        if (mage && (u.id === v.localId || mageViews.length >= MAX_MAGES)) continue;
        const a = anim(u.id);
        a.seen = true;
        // пауза цели (H2): поза и место стоят, пружины не идут; потом цель «выстреливает» и догоняет
        const frozen = v.nowS < a.freezeUntil;
        const da = frozen ? 0 : dt;
        // наклон по отбрасыванию и толчок удара — у манекенов и магов одинаково
        const kb = Math.hypot(u.kb.x, u.kb.z);
        const lean = Math.min(LEAN_MAX, kb * LEAN_PER_MPS);
        const tx = kb > 1e-4 ? (lean * u.kb.z) / kb : 0;
        const tz = kb > 1e-4 ? (-lean * u.kb.x) / kb : 0;
        a.sx = stepSpring(a.sx, tx, LEAN_OMEGA, da);
        a.sz = stepSpring(a.sz, tz, LEAN_OMEGA, da);
        a.kick = stepSpring(a.kick, 0, FLINCH_OMEGA, da);
        const leanX = Math.max(-LEAN_MAX * 1.6, Math.min(LEAN_MAX * 1.6, a.sx.x));
        const leanZ = Math.max(-LEAN_MAX * 1.6, Math.min(LEAN_MAX * 1.6, a.sz.x));
        const pos = { x: it.pos.x, y: it.pos.y, z: it.pos.z };
        const fz = a.frozen;
        if (frozen && !a.frozenSet) {
          a.frozenSet = true;
          fz.x = pos.x;
          fz.y = pos.y;
          fz.z = pos.z;
          fz.yaw = u.move.yaw;
          fz.pitch = u.move.pitch;
        }
        // 0 — стоит в паузе, 1 — живое положение
        let live = 1;
        if (a.frozenSet) {
          live = frozen ? 0 : Math.min(1, (v.nowS - a.freezeUntil) / CATCH_UP_S);
          if (live >= 1) a.frozenSet = false;
          else {
            const k = live * live * (3 - 2 * live);
            pos.x = fz.x + (pos.x - fz.x) * k;
            pos.y = fz.y + (pos.y - fz.y) * k;
            pos.z = fz.z + (pos.z - fz.z) * k;
            live = k;
          }
        }
        if (mage) {
          // взгляд — между тиками по короткой дуге; новый или прыгнувший (возрождение) — сразу как в cur
          const pu = prevUnits.get(u.id);
          const pp = pu?.move.body.pos;
          const cp = u.move.body.pos;
          const fresh = !pu || !pp || Math.hypot(cp.x - pp.x, cp.y - pp.y, cp.z - pp.z) > SNAP_M;
          const yawNow = fresh ? u.move.yaw : lerpAngle(pu.move.yaw, u.move.yaw, v.alpha);
          const pitchNow = fresh ? u.move.pitch : pu.move.pitch + (u.move.pitch - pu.move.pitch) * v.alpha;
          const yaw = live < 1 ? lerpAngle(fz.yaw, yawNow, live) : yawNow;
          const pitch = live < 1 ? fz.pitch + (pitchNow - fz.pitch) * live : pitchNow;
          // фаза шага копится по пройденному пути; скачок дальше SNAP_M — не шаг
          if (a.last) {
            const d = Math.hypot(pos.x - a.last.x, pos.z - a.last.z);
            if (d < SNAP_M) a.stride = (a.stride + d * STRIDE_PER_M) % (2 * Math.PI);
          }
          a.last = pos;
          // размах ног — от своей скорости бега; отбрасывание несёт мага, ногами он не бежит
          const run = u.kb.x === 0 && u.kb.z === 0 ? Math.hypot(u.move.body.vel.x, u.move.body.vel.z) : 0;
          a.speed += (run - a.speed) * (1 - Math.exp(-da / SPEED_TAU_S));
          a.airS = u.move.onGround ? 0 : a.airS + da;
          const element: Element = u.mage?.element ?? "fire";
          const pose: MagePose = {
            pos,
            yaw,
            pitch,
            stride: a.stride,
            speed01: Math.min(1, a.speed / ELEMENT_INFO[element].runSpeed),
            airborne: a.airS > AIR_TUCK_S,
            flinch: a.kick.x,
            flash: v.nowS < a.flashUntil,
            leanX,
            leanZ,
          };
          mageViews.push(pose);
          liveMages.push({ id: u.id, pose, u });
          // стихия на руках: видно издалека и сбоку; в замахе руки разгораются
          const hands = mageHands(pose);
          const look = HAND_GLOW[element];
          const casting = u.mage?.windup ? 1 : 0;
          const far = Math.hypot(pos.x - eye.x, pos.y + 1.1 - eye.y, pos.z - eye.z) * HAND_HALO_PER_M;
          const halo = Math.max(HAND_HALO_M, far) * (1 + 0.4 * casting);
          const flicker =
            element === "fire" ? 0.85 + 0.15 * Math.sin(v.nowS * 21 + u.id * 2.3) * Math.sin(v.nowS * 7.7 + u.id) : 0.93 + 0.07 * Math.sin(v.nowS * 2.6 + u.id);
          const intensity = look.intensity * flicker * (1 + 0.5 * casting);
          // свет на мир — от одной руки: маг занимает один источник из бюджета пресета
          glowList.push({ pos: hands.right, color: look.color, halo, light: look.light, intensity, core: 0, prio: HAND_PRIO });
          glowList.push({ pos: hands.left, color: look.color, halo, light: 0, intensity, core: 0, prio: HAND_PRIO });
        } else {
          if (u.move.landVel < -2 && a.landTick !== v.cur.tick) {
            a.landTick = v.cur.tick;
            a.squash = { x: a.squash.x, v: a.squash.v - Math.min(4, -u.move.landVel * 0.35) };
          }
          a.squash = stepSpring(a.squash, 0, 18, da);
          views.push({
            pose: {
              pos,
              yaw: live < 1 ? lerpAngle(fz.yaw, u.move.yaw, live) : u.move.yaw,
              leanX,
              leanZ,
              flinch: a.kick.x,
              squash: Math.max(0.72, Math.min(1.15, 1 + a.squash.x)),
              flash: v.nowS < a.flashUntil,
              bob: 0.035 * Math.sin(v.nowS * 2.3 + u.id * 1.7),
            },
            distM: Math.hypot(pos.x - eye.x, pos.y + 0.9 - eye.y, pos.z - eye.z),
          });
        }
        // толчок со стороны (K3): пыль из-под ног, пока несёт по полу; у Земли «Корни» — кольцо у ног в начале толчка
        if (u.move.onGround && kb >= KNOCK_DUST_MPS) {
          a.dust += dt * Math.min(KNOCK_DUST_RATE, 4 + 2 * kb);
          if (a.dust >= 1) {
            a.dust -= 1;
            emitWorld([knockDust(pos, Math.random)], nowT);
          }
        } else a.dust = 0;
        if (mage && u.mage?.element === "earth" && kb >= 1 && a.kbPrev < 0.5) {
          a.rootsAt = v.nowS;
          emitWorld(burstParticles("landDust", pos, UP, 1.4, Math.random), nowT);
        }
        a.kbPrev = kb;
        const rootsK = (v.nowS - a.rootsAt) / ROOTS_FLASH_S;
        if (rootsK >= 0 && rootsK < 1) roots.push({ center: { x: pos.x, y: pos.y, z: pos.z }, radius: 0.5 + 0.35 * rootsK });
        if (flags.burning) {
          if (v.nowS - a.lastBurnS > 0.08) {
            a.lastBurnS = v.nowS;
            const at = { x: pos.x + (Math.random() - 0.5) * 0.4, y: pos.y + 0.5 + Math.random() * 1.1, z: pos.z + (Math.random() - 0.5) * 0.3 };
            emitWorld(burstParticles("burnLick", at, UP, 1, Math.random), nowT);
          }
          const flicker = 0.75 + 0.25 * Math.sin(v.nowS * 23 + u.id) * Math.sin(v.nowS * 9.1);
          glowList.push({ pos: { x: pos.x, y: pos.y + 1, z: pos.z }, color: FX_COLOR.fire, halo: 0, light: 2.4, intensity: 0.7 * flicker, core: 0, prio: 1 });
        }
      }
      for (const [id, a] of anims) if (!a.seen && v.nowS > a.flashUntil + 1) anims.delete(id);
      // стихия у своих ладоней в покое (A5); в замахе — вдвое чаще
      if (localElement) {
        const el = localElement;
        idleAcc += dt * IDLE_PALM_RATE[el] * (localWindup ? 2 : 1);
        while (idleAcc >= 1) {
          idleAcc -= 1;
          palmPool.emit([idlePalmParticle(el, palms.right, Math.random), idlePalmParticle(el, palms.left, Math.random)], nowT);
        }
        if (el === "earth") {
          pebbleAcc += dt * PEBBLE_RATE;
          if (pebbleAcc >= 1) {
            pebbleAcc %= 1;
            const ph = v.nowS * (localWindup ? 9 : 5);
            palmPool.emit(
              [pebbleParticle(palms.right, ph, Math.random), pebbleParticle(palms.right, ph + Math.PI, Math.random), pebbleParticle(palms.left, -ph, Math.random), pebbleParticle(palms.left, Math.PI - ph, Math.random)],
              nowT,
            );
          }
        }
      } else idleAcc = pebbleAcc = 0;
      const vh = viewportH();
      dummies.update(views, vh, WORLD_FOV);
      mages.update(mageViews, mageLineScale(vh, WORLD_FOV), { x: eye.x, y: eye.y, z: eye.z });

      // снаряды: ядра, смещение «из ладони», следы, ореолы и свет
      for (const tr of tracks.values()) tr.seen = false;
      const draws: ProjectileDraw[] = [];
      for (const pr of lerpById<Projectile>(v.prev.projectiles, v.cur.projectiles, v.alpha)) {
        const ageS = Math.max(0, (tick - pr.bornTick) / TICK_HZ);
        let tr = tracks.get(pr.id);
        if (!tr) {
          tr = { last: null, acc: 0, hand: pr.ability === "fireball" ? "both" : lastPalmHand, seen: true };
          tracks.set(pr.id, tr);
        }
        tr.seen = true;
        let pos: Vec3 = pr.pos;
        const k = pr.owner === v.localId ? muzzleBlend(ageS) : 0;
        if (k > 0) {
          const pw = palmWorld(tr.hand);
          pos = { x: pos.x + (pw.x - eye.x) * k, y: pos.y + (pw.y - eye.y) * k, z: pos.z + (pw.z - eye.z) * k };
        }
        // у ладони и вплотную к глазам ядро и ореол меньше: снаряд не заслоняет кадр
        const near = Math.min(1, Math.max(0.25, Math.hypot(pos.x - eye.x, pos.y - eye.y, pos.z - eye.z) / 2.5));
        const scale = Math.min(1 - 0.8 * k, near);
        draws.push({ id: pr.id, ability: pr.ability, pos, ageS, scale });
        const look = PROJECTILE_LOOK[pr.ability];
        if (tr.last) {
          const d = Math.hypot(pos.x - tr.last.x, pos.y - tr.last.y, pos.z - tr.last.z);
          if (d < 8) {
            tr.acc += d;
            const n = Math.floor(tr.acc / look.trailEveryM);
            if (n > 0) {
              tr.acc -= n * look.trailEveryM;
              emitWorld(trailParticles(pr.ability, tr.last, pos, Math.min(n, 16), Math.random), nowT);
            }
          }
        }
        tr.last = pos;
        const flicker = 0.9 + 0.1 * Math.sin(v.nowS * 37 + pr.id * 3.1);
        glowList.push({ pos, color: look.color, halo: look.halo * scale, light: look.light, intensity: look.intensity * flicker, core: look.whiteCore, prio: pr.ability === "fireball" ? 3 : 2 });
      }
      for (const [id, tr] of tracks) if (!tr.seen) tracks.delete(id);
      cores.update(draws);

      // зоны: декали, стены огня (лист, угли по линии, свет), след рывка
      const sheets: FireWallSheet[] = [];
      const liveZones = new Set<number>();
      for (const z of v.cur.zones) {
        liveZones.add(z.id);
        const spec = zoneDecal(z, tick, v.localId);
        if (spec) decalList.push({ spec, seed: (z.id * 0.731) % 17, intensity: 1 });
        const sheet = fireWallSheet(z, tick);
        const line = lineOfBox(z);
        if (sheet && line) {
          sheets.push(sheet);
          let st = ignited.get(z.id);
          if (!st) {
            st = { embers: 0 };
            ignited.set(z.id, st);
            emitWorld(lineFlames(line.a, line.b, 44, true, Math.random), nowT);
          }
          st.embers += dt * 34 * sheet.fade;
          const n = Math.floor(st.embers);
          if (n > 0) {
            st.embers -= n;
            emitWorld(lineFlames(line.a, line.b, n, false, Math.random), nowT);
          }
          for (const f of [0.25, 0.75]) {
            const p = { x: line.a.x + (line.b.x - line.a.x) * f, y: line.a.y + 1.2, z: line.a.z + (line.b.z - line.a.z) * f };
            glowList.push({ pos: p, color: FX_COLOR.fire, halo: 0, light: 4.5, intensity: 0.85 * sheet.fade * (0.9 + 0.1 * Math.sin(v.nowS * 17 + f * 9)), core: 0, prio: 2.5 });
          }
        } else if (z.kind === "fireTrail" && line && tick >= z.armTick) {
          let st = ignited.get(z.id);
          if (!st) {
            st = { embers: 0 };
            ignited.set(z.id, st);
          }
          const life = 1 - Math.min(1, (tick - z.armTick) / Math.max(1, z.endTick - z.armTick));
          st.embers += dt * 26 * life;
          const n = Math.floor(st.embers);
          if (n > 0) {
            st.embers -= n;
            emitWorld(lineFlames(line.a, line.b, n, false, Math.random), nowT);
          }
        }
      }
      for (const id of ignited.keys()) if (!liveZones.has(id)) ignited.delete(id);
      walls.update(sheets);

      // стихии фазы 4: свои меши и логика поверх общих пулов — до декалей и разбора свечений
      // один объект кадра на всё время: поля меняются, замыкания и массивы — те же (без мусора за кадр)
      frame.prev = v.prev;
      frame.cur = v.cur;
      frame.alpha = v.alpha;
      frame.tick = tick;
      frame.nowS = v.nowS;
      frame.dt = dt;
      frame.camera = cam;
      frameEye.x = eye.x;
      frameEye.y = eye.y;
      frameEye.z = eye.z;
      frame.localId = v.localId;
      for (const el of elements) el.sync(frame);
      // следы ударов на полу: подпалины и трещины
      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i]!;
        const spec = markDecal(m.kind, m.center, m.radius, nowT - m.born);
        if (spec) decalList.push({ spec, seed: m.seed, intensity: 1 });
        else marks.splice(i, 1);
      }
      decals.update(decalList, roots);

      // рельеф: боксы в G-буфер, прожилки; сломанный — обломки
      const boxes = [];
      const faces: VeinFace[] = [];
      for (const s of terrainSeen.values()) s.seen = false;
      for (const t of v.cur.terrain) {
        const vb = terrainVisualBox(t, tick);
        boxes.push(vb);
        const prevSeen = terrainSeen.get(t.id);
        const hitAt = prevSeen && t.hp < prevSeen.hp ? v.nowS : (prevSeen?.hitAt ?? -10);
        const rising = tick - t.bornTick < t.growTicks + 8;
        const bright = (rising ? 1.6 : 1) + 1.4 * Math.exp(-(v.nowS - hitAt) * 6);
        faces.push(...veinFaces(vb, t.box.max.y - t.box.min.y, t.id, bright));
        terrainSeen.set(t.id, { item: t, tick: v.cur.tick, hp: t.hp, hitAt, seen: true });
      }
      for (const [id, s] of terrainSeen) {
        if (s.seen) continue;
        // исчез раньше срока — сломан: обломки из видимого бокса
        if (s.tick < s.item.endTick - 2) debris.burst(terrainVisualBox(s.item, s.tick), 20, Math.random);
        terrainSeen.delete(id);
      }
      terrain.update(boxes);
      veins.update(faces);

      // вспышки света всплесков; свет дула — у ладони этого кадра (камера и ладони уже обновлены выше)
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]!;
        const age = nowT - f.born;
        if (age >= f.life || age < -1) {
          flashes.splice(i, 1);
          continue;
        }
        const k = 1 - age / f.life;
        const pos = f.palm ? palmWorld(f.palm) : f.pos;
        glowList.push({ pos, color: f.color, halo: f.halo * (0.6 + 0.4 * k), light: f.light, intensity: f.intensity * k * k, core: f.core * k, prio: f.prio });
      }
      // вне пирамиды видимости — не рисуем и не тратим на них бюджет; из видимых самые важные светят на мир
      // (пресет: 2/4/8), остальные — только ореол
      const visible = cullGlows(glowList, cam);
      visible.sort((a, b) => b.prio - a.prio);
      let lit = 0;
      const out: Glow[] = [];
      for (const g of visible) {
        let light = g.light;
        if (light > 0) {
          if (lit < lights) lit++;
          else light = 0;
        }
        if (light <= 0 && g.halo <= 0) continue;
        out.push({ ...g, light });
      }
      glows.update(out);
      debris.step(dt);
    },

    setPreset(p) {
      caps = poolCaps(p);
      lights = MAGIC_LIGHTS[p];
      share = BURST_SHARE[p];
      walls.setCheap(p !== "high");
      worldPool.setCap(caps.world);
      palmPool.setCap(caps.palm);
      for (const el of elements) el.setPreset?.(p);
    },

    dispose() {
      worldPool.dispose();
      palmPool.dispose();
      glows.dispose();
      decals.dispose();
      walls.dispose();
      veins.dispose();
      dummies.dispose();
      mages.dispose();
      terrain.dispose();
      cores.dispose();
      debris.dispose();
      for (const el of elements) el.dispose();
    },
  };
}
