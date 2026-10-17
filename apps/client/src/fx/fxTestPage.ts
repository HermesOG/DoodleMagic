import { BoxGeometry, Mesh, Scene, Vector3, type BufferGeometry, type Material as ThreeMaterial } from "three";
import {
  EARTH,
  FIRE,
  TICK_HZ,
  createDummyUnit,
  createMageUnit,
  createMatchState,
  type Material,
  type MatchState,
  type Projectile,
  type RenderBox,
  type Terrain,
  type Vec3,
  type Zone,
} from "@doodlemagic/sim";
import "../render/canvas.css";
import { BURST_PRESETS, type BurstPreset, type Effect } from "../feel/effects";
import { buildArenaMeshes } from "../render/arenaMeshes";
import { FPS_METER_MAX_FRAME_MS, createFpsMeter } from "../render/fpsMeter";
import { createInkMaterial } from "../render/gbuffer";
import { INK, SUN_DIR } from "../render/palette";
import { createAutoQuality, isPresetId } from "../render/quality";
import { StyleRenderer } from "../render/styleRenderer";
import { createVfx } from "./vfx";

const b = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: Material = "stone"): RenderBox => ({
  box: { min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) }, max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) } },
  material,
});
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => b(x0, y0, z0, x1, y1, z1).box;

/** Площадка полигона: пол, дальняя стена, дом слева, ступени справа, площадка руны, трава. */
const FX_BOXES: RenderBox[] = [
  b(-24, -0.5, -30, 24, 0, 14, "floor"),
  b(-16, 0, -17, 16, 4.5, -16),
  b(-16, 0, -16, -15, 3, 4),
  b(-13, 0, -12, -9.5, 3.2, -8),
  b(-13.4, 3.2, -12.4, -9.1, 3.5, -7.6, "roof"),
  b(10, 0, -12, 13, 0.5, -9),
  b(10.5, 0, -12, 13, 1, -9),
  b(11, 0, -12, 13, 1.5, -9),
  b(5, 0, -2.5, 7.4, 0.05, -0.1, "gold"),
  b(-8, 0, 3, -7.4, 0.5, 3.6, "grass"),
  b(-7.2, 0, 3.8, -6.6, 0.35, 4.4, "grass"),
  b(7, 0, 2, 7.6, 0.6, 2.6, "grass"),
  b(-16, 0, 6, 16, 0.25, 6.4, "edge"),
];

const EARTH_BURSTS = new Set<BurstPreset>(["stoneCrumble", "stoneImpact", "pillarCracks", "pillarBurst", "wallDust", "quakeRing", "terrainChips", "terrainBreak", "deathEarth", "respawnPuff"]);
const T = (s: number): number => Math.round(s * TICK_HZ);
const LOCAL = 1;
const OTHER = 99;
const DUMMY_A = 10;
const DUMMY_B = 11;
const DUMMY_C = 12;
const DUMMY_A_POS = { x: -3.2, y: 0, z: -4.5 };
const FIST_PERIOD = T(0.45);
const STAGE = { x: -1.4, y: 0, z: 1.2 };

interface View {
  pos: Vector3;
  look: Vector3;
}
const VIEWS: Record<string, View> = {
  wide: { pos: new Vector3(0, 2.1, 7.5), look: new Vector3(0, 0.9, -5) },
  low: { pos: new Vector3(-0.5, 1.6, 2.5), look: new Vector3(-0.8, 1.2, -6) },
  top: { pos: new Vector3(0, 9, 5.5), look: new Vector3(0, 0, -5) },
};

/** Глаза мага-наблюдателя (камера) на времени t: медленное покачивание. */
function eyeAt(view: View, t: number, still: boolean): { pos: Vector3; look: Vector3 } {
  const sway = still ? 0 : Math.sin(t * 0.25) * 1.2;
  return { pos: new Vector3(view.pos.x + sway, view.pos.y, view.pos.z), look: view.look.clone() };
}

const cyc = (tick: number, period: number, offset = 0): { n: number; at: number } => {
  const k = tick - offset;
  const n = Math.floor(k / period);
  return { n, at: k - n * period };
};

/**
 * Синтетическое состояние матча на тике: три манекена (один мигает и качается, один горит, один обездвижен),
 * кулаки по манекену, огненный шар и камень туда-обратно, стена огня с телеграфом, столб и каменная стена
 * растут и проседают, землетрясение и след рывка.
 */
function buildState(tick: number, view: View, still: boolean): MatchState {
  const t = tick / TICK_HZ;
  const eye = eyeAt(view, t, still).pos;
  const mage = createMageUnit(LOCAL, "fire", { pos: { x: eye.x, y: eye.y - 1.6, z: eye.z }, yaw: 0 });
  const a = createDummyUnit(DUMMY_A, { pos: DUMMY_A_POS, yaw: Math.PI + 0.25 });
  const bU = createDummyUnit(DUMMY_B, { pos: { x: 0.4, y: 0, z: -6.8 }, yaw: Math.PI - 0.15 });
  const c = createDummyUnit(DUMMY_C, { pos: { x: 3.7, y: 0, z: -4.3 }, yaw: Math.PI - 0.5 });
  // b качается под отбрасыванием и горит
  bU.kb = { x: Math.sin(t * 1.4) * 12, z: Math.cos(t * 0.9) * 4 };
  bU.status.burnPulses = 4;
  // c обездвижен половину цикла
  c.status.rootUntil = cyc(tick, T(4)).at < T(2) ? tick + 10 : 0;
  for (const u of [mage, a, bU, c]) u.move.onGround = true;
  const s = createMatchState([mage, a, bU, c]);
  s.tick = tick;

  const projectiles: Projectile[] = [];
  // кулаки из глаз в грудь манекена A
  {
    const { n, at } = cyc(tick, FIST_PERIOD);
    const born = n * FIST_PERIOD;
    const from = eyeAt(view, born / TICK_HZ, still).pos;
    const to = { x: DUMMY_A_POS.x, y: 1.1, z: DUMMY_A_POS.z + 0.25 };
    const d = new Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = d.length();
    const flight = Math.ceil((len / FIRE.fireFists.projectile.speed) * TICK_HZ);
    if (at < flight) {
      d.normalize();
      const age = at / TICK_HZ;
      const sp = FIRE.fireFists.projectile.speed;
      projectiles.push({ id: 2000 + n, owner: LOCAL, ability: "fireFists", pos: { x: from.x + d.x * sp * age, y: from.y + d.y * sp * age, z: from.z + d.z * sp * age }, vel: { x: d.x * sp, y: d.y * sp, z: d.z * sp }, bornTick: born, endTick: born + flight });
    }
  }
  // огненный шар туда-обратно вдоль стены огня
  {
    const period = T(3);
    const { n, at } = cyc(tick, period);
    const flight = T(15 / FIRE.fireball.projectile.speed);
    if (at < flight) {
      const dir = n % 2 === 0 ? 1 : -1;
      const sp = FIRE.fireball.projectile.speed;
      const x = -7.5 * dir + dir * sp * (at / TICK_HZ);
      projectiles.push({ id: 3000 + n, owner: OTHER, ability: "fireball", pos: { x, y: 1.5, z: -8.6 }, vel: { x: dir * sp, y: 0, z: 0 }, bornTick: n * period, endTick: n * period + flight });
    }
  }
  // камень по дуге поперёк кадра
  {
    const period = T(2.4);
    const { n, at } = cyc(tick, period, T(0.8));
    const flight = T(18 / EARTH.stoneShot.projectile.speed);
    if (at < flight && n >= 0) {
      const dir = n % 2 === 0 ? -1 : 1;
      const sp = EARTH.stoneShot.projectile.speed;
      const age = at / TICK_HZ;
      const g = EARTH.stoneShot.projectile.gravity;
      projectiles.push({ id: 4000 + n, owner: OTHER, ability: "stoneShot", pos: { x: 9 * -dir + dir * sp * age, y: 1.7 + 1.2 * age - 0.5 * g * age * age, z: -2.4 }, vel: { x: dir * sp, y: 1.2 - g * age, z: 0 }, bornTick: n * period, endTick: n * period + flight });
    }
  }
  s.projectiles = projectiles;

  const zones: Zone[] = [];
  const terrain: Terrain[] = [];
  // стена огня: телеграф 0,4 с, 5 с огня, пауза
  {
    const period = T(7.5);
    const { n, at } = cyc(tick, period);
    const born = n * period;
    const arm = born + T(FIRE.fireWall.telegraphS);
    const end = arm + T(FIRE.fireWall.lifeS);
    if (at < end - born) zones.push({ id: 5000 + n, owner: OTHER, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: box(-5, 0, -11.6, 5, FIRE.fireWall.heightM, -11) }, bornTick: born, armTick: arm, endTick: end, rehit: [] });
  }
  // столб: трещины 0,6 с, потом камень 4 с
  {
    const period = T(6);
    const { n, at } = cyc(tick, period, T(1));
    const born = n * period + T(1);
    const arm = born + T(EARTH.stonePillar.telegraphS);
    if (n >= 0 && at < arm - born) zones.push({ id: 6000 + n, owner: OTHER, kind: "pillar", ability: "stonePillar", shape: { type: "box", box: box(-7.6, 0, -7.1, -6.4, 2.5, -5.9) }, bornTick: born, armTick: arm, endTick: arm + 1, rehit: [] });
    const life = T(EARTH.stonePillar.lifeS);
    if (n >= 0 && tick >= arm && tick < arm + life)
      terrain.push({ id: 6500 + n, owner: OTHER, kind: "pillar", box: box(-7.6, 0, -7.1, -6.4, 2.5, -5.9), bornTick: arm, solidTick: arm + T(EARTH.stonePillar.solidS), endTick: arm + life, growTicks: T(EARTH.stonePillar.growS), solid: true, hp: 200, maxHp: 200 });
  }
  // каменная стена: растёт 0,3 с, стоит 6 с; каждый второй раз ломается на 4-й секунде
  {
    const period = T(8);
    const { n, at } = cyc(tick, period, T(2));
    const born = n * period + T(2);
    const life = T(EARTH.stoneWall.lifeS);
    const breaks = n % 2 === 1;
    const until = breaks ? T(4) : life;
    if (n >= 0 && at < until)
      terrain.push({ id: 7000 + n, owner: OTHER, kind: "wall", box: box(4.6, 0, -8.6, 8.6, EARTH.stoneWall.heightM, -8.0), bornTick: born, solidTick: born + T(EARTH.stoneWall.solidS), endTick: born + life, growTicks: T(EARTH.stoneWall.growS), solid: true, hp: breaks ? 250 - Math.floor(at / T(1)) * 40 : 250, maxHp: 250 });
  }
  // землетрясение: замах 0,4 с
  {
    const period = T(9);
    const { n, at } = cyc(tick, period, T(4.5));
    const born = n * period + T(4.5);
    const arm = born + T(EARTH.earthquake.telegraphS);
    if (n >= 0 && at < arm - born + 1) zones.push({ id: 8000 + n, owner: OTHER, kind: "quake", ability: "earthquake", shape: { type: "disc", center: { x: 0, y: 0, z: -5.5 }, radius: EARTH.earthquake.radiusM }, bornTick: born, armTick: arm, endTick: arm + 1, rehit: [] });
  }
  // след рывка 2 с
  {
    const period = T(5);
    const { n, at } = cyc(tick, period, T(3));
    const born = n * period + T(3);
    if (n >= 0 && at < T(FIRE.jetDash.trailS))
      zones.push({ id: 9000 + n, owner: OTHER, kind: "fireTrail", ability: "jetDash", shape: { type: "segment", a: { x: -7, y: 0, z: 0.5 }, b: { x: 1, y: 0, z: -1.5 }, halfW: FIRE.jetDash.trailHalfWidthM }, bornTick: born, armTick: born, endTick: born + T(FIRE.jetDash.trailS), rehit: [] });
  }
  s.zones = zones;
  s.terrain = terrain;
  return s;
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };

/** Эффекты, которые выдала бы карта событий на тике tick (синтетика: по расписанию состояния). */
function effectsAt(tick: number, prev: MatchState, cur: MatchState): Effect[] {
  const out: Effect[] = [];
  // исчезнувшие снаряды — попадания
  for (const p of prev.projectiles) {
    if (cur.projectiles.some((q) => q.id === p.id)) continue;
    if (p.ability === "fireFists") {
      out.push({ kind: "burst", preset: "fistImpact", pos: p.pos, dir: { x: -p.vel.x, y: 0, z: -p.vel.z }, scale: 1 });
      out.push({ kind: "flash", target: DUMMY_A });
      out.push({ kind: "flinch", target: DUMMY_A, dir: { x: p.vel.x, y: 0, z: p.vel.z }, amount: 0.4 });
    } else if (p.ability === "fireball") {
      out.push({ kind: "burst", preset: "fireballBoom", pos: p.pos, dir: UP, scale: 1 });
    } else {
      out.push({ kind: "burst", preset: "stoneImpact", pos: { x: p.pos.x, y: Math.max(0.05, p.pos.y), z: p.pos.z }, dir: { x: -Math.sign(p.vel.x), y: 0.5, z: 0 }, scale: 1 });
    }
  }
  // новые снаряды — выпуск: вспышка у ладони
  for (const p of cur.projectiles) {
    if (prev.projectiles.some((q) => q.id === p.id) || p.owner !== LOCAL) continue;
    out.push({ kind: "palm", hand: "auto", element: "fire", preset: "flash" });
  }
  for (const z of cur.zones) {
    if (z.bornTick === tick) {
      if (z.kind === "fireWall") out.push({ kind: "burst", preset: "fireWallSparks", pos: { x: 0, y: 0.1, z: -11.3 }, dir: UP, scale: 1 });
      if (z.kind === "pillar") out.push({ kind: "burst", preset: "pillarCracks", pos: { x: -7, y: 0, z: -6.5 }, dir: UP, scale: 1 });
      if (z.kind === "fireTrail") out.push({ kind: "burst", preset: "dashBlast", pos: { x: -7, y: 0.9, z: 0.5 }, dir: { x: -1, y: 0.1, z: 0.25 }, scale: 1 });
    }
    if (z.armTick === tick) {
      if (z.kind === "fireWall") out.push({ kind: "burst", preset: "fireWallIgnite", pos: { x: 0, y: 0.2, z: -11.3 }, dir: UP, scale: 1 });
      if (z.kind === "quake" && z.shape.type === "disc") out.push({ kind: "burst", preset: "quakeRing", pos: z.shape.center, dir: UP, scale: 1 });
    }
  }
  for (const t of cur.terrain) {
    if (t.bornTick === tick) out.push({ kind: "burst", preset: t.kind === "pillar" ? "pillarBurst" : "wallDust", pos: { x: (t.box.min.x + t.box.max.x) / 2, y: 0.05, z: (t.box.min.z + t.box.max.z) / 2 }, dir: UP, scale: 1 });
    const was = prev.terrain.find((q) => q.id === t.id);
    if (was && t.hp < was.hp) out.push({ kind: "burst", preset: "terrainChips", pos: { x: t.box.min.x + 0.5, y: 1.4, z: t.box.max.z }, dir: { x: 0, y: 0.3, z: 1 }, scale: 1 });
  }
  for (const t of prev.terrain) {
    if (cur.terrain.some((q) => q.id === t.id) || tick >= t.endTick - 1) continue;
    out.push({ kind: "burst", preset: "terrainBreak", pos: { x: (t.box.min.x + t.box.max.x) / 2, y: 1.2, z: (t.box.min.z + t.box.max.z) / 2 }, dir: UP, scale: 1 });
  }
  return out;
}

/** Вспышка, заряд, «пшик» по ладоням по кругу. */
const PALM_CYCLE: Effect[] = [
  { kind: "palm", hand: "right", element: "fire", preset: "charge" },
  { kind: "palm", hand: "left", element: "fire", preset: "fizzle" },
  { kind: "palm", hand: "both", element: "earth", preset: "flash" },
  { kind: "palm", hand: "right", element: "earth", preset: "charge" },
  { kind: "palm", hand: "left", element: "earth", preset: "fizzle" },
];

/** Заглушки рук в пространстве камеры рук (как варежки): ладони эффектов и проверка «руки закрывают свет». */
function handProbe(): Scene {
  const scene = new Scene();
  const material = createInkMaterial(INK.hands, { value: new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) });
  const geometry = new BoxGeometry(0.08, 0.12, 0.045);
  for (const side of [1, -1]) {
    const m = new Mesh(geometry, material);
    m.position.set(side * 0.26, -0.29, -0.62);
    m.rotation.set(-0.35, -side * 0.2, side * 0.22);
    scene.add(m);
  }
  return scene;
}

function disposeScene(scene: Scene): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<ThreeMaterial>();
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    geometries.add(o.geometry as BufferGeometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m as ThreeMaterial);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

/**
 * /fx-test — эффекты магии на синтетическом состоянии, без симуляции.
 * ?preset=low|medium|high — пресет без автовыбора; ?view=wide|low|top — точка обзора; ?still=1 — камера стоит;
 * ?speed=0.25 — замедление; ?t=4.4 — начать с этой секунды расписания; ?burst=fireballBoom — первый всплеск
 * на площадке. Пробел — пауза. Возвращает функцию остановки страницы.
 */
export function mountFxTest(root: HTMLElement): () => void {
  document.body.classList.add("game");
  root.innerHTML = `<canvas class="game-canvas"></canvas><div class="game-corner"></div><div class="game-loading">Загрузка…</div>`;
  const canvas = root.querySelector<HTMLCanvasElement>(".game-canvas")!;
  const corner = root.querySelector<HTMLElement>(".game-corner")!;
  const loading = root.querySelector<HTMLElement>(".game-loading")!;
  const fail = (err: unknown): void => {
    loading.textContent = `Не удалось запустить эффекты: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  };
  const params = new URLSearchParams(location.search);
  const fixed = params.get("preset");
  const view = VIEWS[params.get("view") ?? "wide"] ?? VIEWS.wide!;
  const still = params.get("still") === "1";
  const speedArg = Number.parseFloat(params.get("speed") ?? "1");
  const speed = Number.isFinite(speedArg) && speedArg > 0 ? Math.min(4, speedArg) : 1;
  const startArg = Number.parseFloat(params.get("t") ?? "0");
  const start = Number.isFinite(startArg) && startArg > 0 ? Math.min(600, startArg) : 0;

  let renderer: StyleRenderer;
  try {
    renderer = new StyleRenderer(canvas, isPresetId(fixed) ? fixed : "high");
  } catch (err) {
    fail(err);
    return () => {};
  }
  const vfx = createVfx(renderer.gbuffer, renderer.preset.id);
  const world = new Scene();
  world.add(buildArenaMeshes(FX_BOXES), vfx.worldGroup);
  const overlay = handProbe();
  const unwatchSize = renderer.watchSize();
  const auto = isPresetId(fixed) ? null : createAutoQuality();
  const meter = createFpsMeter();
  const palms = { right: new Vector3(0.26, -0.22, -0.62), left: new Vector3(-0.26, -0.22, -0.62) };

  let simT = start;
  let lastTick = Math.floor(start * TICK_HZ) - 1;
  let last = 0;
  let raf = 0;
  let stopped = false;
  let paused = false;
  // ?burst=fireballBoom — начать круг всплесков с этого пресета
  let burstIdx = Math.max(0, BURST_PRESETS.indexOf(params.get("burst") as BurstPreset));
  let palmIdx = 0;
  let nextBurst = start + 0.5;
  let nextPalm = start + 0.3;
  let lastPreset = "—";
  let rightNext = true;

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === "Space") {
      paused = !paused;
      e.preventDefault();
    }
  };
  window.addEventListener("keydown", onKey);

  const frame = (now: number): void => {
    const raw = now - last;
    last = now;
    if (!paused) simT += (Math.max(0, Math.min(100, raw)) / 1000) * speed;
    const tickF = simT * TICK_HZ;
    const tick = Math.floor(tickF);
    const prev = buildState(tick, view, still);
    const cur = buildState(tick + 1, view, still);
    // эффекты всех переходов, пройденных с прошлого кадра: переход k → k + 1 — в тот кадр, где k + 1 стал cur
    for (let k = Math.max(lastTick + 1, tick - 30); k <= tick; k++) {
      const before = buildState(k, view, still);
      const at = buildState(k + 1, view, still);
      for (const e of effectsAt(k + 1, before, at)) vfx.apply(e, simT, rightNext ? "right" : "left");
      if (at.projectiles.some((p) => p.owner === LOCAL && p.bornTick === k + 1)) rightNext = !rightNext;
    }
    lastTick = tick;
    while (simT >= nextBurst) {
      const id = BURST_PRESETS[burstIdx % BURST_PRESETS.length]!;
      burstIdx++;
      lastPreset = id;
      const pos = EARTH_BURSTS.has(id) ? { x: STAGE.x, y: 0.05, z: STAGE.z } : { x: STAGE.x, y: 1.1, z: STAGE.z };
      vfx.apply({ kind: "burst", preset: id, pos, dir: UP, scale: 1 }, simT, "right");
      nextBurst += 0.7;
    }
    while (simT >= nextPalm) {
      vfx.apply(PALM_CYCLE[palmIdx % PALM_CYCLE.length]!, simT, "right");
      palmIdx++;
      nextPalm += 1.1;
    }
    const eye = eyeAt(view, simT, still);
    renderer.camera.position.copy(eye.pos);
    renderer.camera.lookAt(eye.look);
    vfx.sync({ prev, cur, alpha: tickF - tick, nowS: simT, camera: renderer.camera, localId: LOCAL, palms });
    renderer.render(world, overlay, vfx.fx);
    meter.push(Math.min(raw, FPS_METER_MAX_FRAME_MS));
    const next = auto?.push(raw);
    if (next) {
      renderer.setPreset(next);
      vfx.setPreset(next);
    }
    corner.textContent =
      `FPS ${meter.fps.toFixed(0)} · ${meter.frameMs.toFixed(1)} мс\n` +
      `${renderer.preset.label}${auto && !auto.done ? " (подбор)" : ""} · вызовов ${renderer.drawCalls()}\n` +
      `всплеск: ${lastPreset}${paused ? " · пауза" : ""}`;
    raf = requestAnimationFrame(frame);
  };

  // прогрев: шейдеры всех слоёв компилируются на кадре с непустыми пулами
  const t0 = Math.floor(start * TICK_HZ);
  vfx.sync({ prev: buildState(t0, view, still), cur: buildState(t0 + 1, view, still), alpha: 0, nowS: start, camera: renderer.camera, localId: LOCAL, palms });
  renderer
    .warmUp(world, overlay, vfx.fx)
    .then(() => {
      if (stopped) return;
      loading.remove();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    })
    .catch(fail);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    unwatchSize();
    vfx.dispose();
    disposeScene(world);
    disposeScene(overlay);
    renderer.dispose();
  };
}
