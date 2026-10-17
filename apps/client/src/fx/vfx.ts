import { Group, Scene, Vector3, type PerspectiveCamera } from "three";
import { TICK_HZ, statusFlags, type MatchState, type Projectile, type Terrain, type UnitId, type Vec3, type Zone } from "@doodlemagic/sim";
import type { BurstPreset, Effect } from "../feel/effects";
import { stepSpring, type Spring } from "../hands/spring";
import type { PresetId } from "../render/quality";
import { HANDS_FOV, WORLD_FOV, type FxLayers, type StyleRenderer } from "../render/styleRenderer";
import { createDebris } from "./debris";
import { createDecalMeshes, zoneDecal, type DecalSpec, type RootRing } from "./decals";
import { createDummyMeshes, type DummyView } from "./dummyMeshes";
import { createFireWallMeshes, fireWallSheet, type FireWallSheet } from "./fireWalls";
import type { TimeUniform } from "./fxShader";
import { createGlowMeshes, type Glow } from "./glows";
import { handToWorldView, lerpById, muzzleBlend, renderTick } from "./interp";
import { createParticlePool } from "./particles";
import { FX_COLOR, MAGIC_LIGHTS, burstParticles, lineFlames, palmParticles, poolCaps, trailParticles } from "./presets";
import { PROJECTILE_LOOK, createProjectileMeshes, type ProjectileDraw } from "./projectileMeshes";
import { createTerrainMeshes, createVeinMeshes, terrainVisualBox, veinFaces, type VeinFace } from "./terrainMeshes";

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

export interface Vfx {
  /** Меши G-буфера (манекены, рельеф, ядра снарядов, обломки): добавить в сцену мира. */
  readonly worldGroup: Group;
  /** Сцены прохода света — третий аргумент StyleRenderer.render и warmUp. */
  readonly fx: FxLayers;
  /** Исполняет burst, palm, flash и flinch; остальное пропускает. hand — чья рука для palm с hand "auto". */
  apply(e: Effect, nowS: number, hand: "left" | "right"): void;
  /** Раз в кадр: положения между prev и cur, зоны и рельеф из cur, время эффектов. */
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
const FLASH_S = 0.06;
const REST_PALM = { x: 0.26, y: -0.25, z: -0.62 } as const;

/** Свет вспышек всплесков огня: радиус на мир, ореол, яркость, жизнь. Земля не светится. */
const BURST_LIGHT: Partial<Record<BurstPreset, { light: number; halo: number; intensity: number; life: number; core: number }>> = {
  fistFlash: { light: 1.5, halo: 0.3, intensity: 1, life: 0.08, core: 0.6 },
  fistImpact: { light: 2.4, halo: 0.6, intensity: 1.3, life: 0.14, core: 0.8 },
  fireballCharge: { light: 2.2, halo: 0.7, intensity: 0.9, life: 0.25, core: 0.5 },
  fireballBoom: { light: 7.5, halo: 2.8, intensity: 1.7, life: 0.45, core: 1.2 },
  dashBlast: { light: 3.5, halo: 1.1, intensity: 1.2, life: 0.25, core: 0.7 },
  fireWallIgnite: { light: 6, halo: 0, intensity: 1.4, life: 0.4, core: 0 },
  fireWallSparks: { light: 2, halo: 0, intensity: 0.6, life: 0.4, core: 0 },
  deathFire: { light: 4, halo: 1.3, intensity: 1.3, life: 0.45, core: 0.8 },
};

interface DummyAnim {
  sx: Spring;
  sz: Spring;
  kick: Spring;
  squash: Spring;
  flashUntil: number;
  lastBurnS: number;
  landTick: number;
  seen: boolean;
}

interface Flash {
  pos: Vec3;
  light: number;
  halo: number;
  intensity: number;
  life: number;
  core: number;
  born: number;
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
 * манекенов с ореолом, ядра снарядов и обломки. Бюджет: G-буфер +6 вызовов (манекены 2, рельеф 1, ядра 2,
 * обломки 1), проход света +5 (стены огня, декали, частицы, ореолы, прожилки), ладони +1; пустые пулы не рисуются.
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
  const top = poolCaps("high");
  const worldPool = createParticlePool({ name: "fx-particles", maxCap: top.world, cap: caps.world, gbuffer, time });
  const palmPool = createParticlePool({ name: "fx-palm", maxCap: top.palm, cap: caps.palm, gbuffer, time, noDepth: true });
  const glows = createGlowMeshes(gbuffer);
  const decals = createDecalMeshes(gbuffer, time);
  const walls = createFireWallMeshes(gbuffer, time);
  const veins = createVeinMeshes(gbuffer, time);
  const dummies = createDummyMeshes(8);
  const terrain = createTerrainMeshes(24);
  const cores = createProjectileMeshes(48);
  const debris = createDebris();

  const worldGroup = new Group();
  worldGroup.name = "vfx";
  worldGroup.add(dummies.parts, dummies.shells, terrain.mesh, cores.fire, cores.stone, debris.mesh);
  const fxWorld = new Scene();
  fxWorld.name = "fx-world";
  fxWorld.add(walls.mesh, decals.mesh, worldPool.mesh, glows.mesh, veins.mesh);
  const fxPalm = new Scene();
  fxPalm.name = "fx-palm";
  fxPalm.add(palmPool.mesh);

  const anims = new Map<UnitId, DummyAnim>();
  const tracks = new Map<number, Track>();
  const terrainSeen = new Map<number, Seen<Terrain>>();
  const ignited = new Map<number, { embers: number }>();
  const flashes: Flash[] = [];
  const palms = { right: new Vector3(REST_PALM.x, REST_PALM.y, REST_PALM.z), left: new Vector3(-REST_PALM.x, REST_PALM.y, REST_PALM.z) };
  let lastPalmHand: "left" | "right" = "right";
  let lastNowS: number | null = null;
  const tmp = new Vector3();
  const eye = new Vector3();

  const anim = (id: UnitId): DummyAnim => {
    let a = anims.get(id);
    if (!a) {
      a = { sx: { x: 0, v: 0 }, sz: { x: 0, v: 0 }, kick: { x: 0, v: 0 }, squash: { x: 0, v: 0 }, flashUntil: -1, lastBurnS: -1, landTick: -1, seen: true };
      anims.set(id, a);
    }
    return a;
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
      switch (e.kind) {
        case "burst": {
          worldPool.emit(burstParticles(e.preset, e.pos, e.dir, e.scale, Math.random), t);
          const l = BURST_LIGHT[e.preset];
          if (l) flashes.push({ ...l, pos: { ...e.pos }, born: t, light: l.light * Math.min(1.5, Math.max(0.7, e.scale)) });
          break;
        }
        case "palm": {
          const hands: ("left" | "right")[] = e.hand === "both" ? ["left", "right"] : [e.hand === "auto" ? hand : e.hand];
          for (const h of hands) palmPool.emit(palmParticles(e.element, e.preset, palms[h], Math.random), t);
          lastPalmHand = hands[hands.length - 1]!;
          break;
        }
        case "flash":
          anim(e.target).flashUntil = nowS + FLASH_S;
          break;
        case "flinch": {
          const a = anim(e.target);
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
      const dt = lastNowS === null ? 0 : Math.min(0.1, Math.max(0, v.nowS - lastNowS));
      lastNowS = v.nowS;
      const tick = renderTick(v.prev, v.cur, v.alpha);
      const cam = v.camera;
      cam.updateMatrixWorld();
      cam.getWorldPosition(eye);
      palms.right.copy(v.palms.right);
      palms.left.copy(v.palms.left);
      const palmWorld = (h: "left" | "right" | "both"): Vec3 => {
        if (h === "both") {
          const r = palmWorld("right");
          const l = palmWorld("left");
          return { x: (r.x + l.x) / 2, y: (r.y + l.y) / 2, z: (r.z + l.z) / 2 };
        }
        const q = handToWorldView(palms[h], HANDS_FOV, WORLD_FOV);
        cam.localToWorld(tmp.set(q.x, q.y, q.z));
        return { x: tmp.x, y: tmp.y, z: tmp.z };
      };
      const glowList: GlowEntry[] = [];
      const decalList: { spec: DecalSpec; seed: number; intensity: number }[] = [];
      const roots: RootRing[] = [];

      // юниты: манекены (поза, ореол, вспышка), горение и обездвиживание у всех
      for (const a of anims.values()) a.seen = false;
      const unitsOf = (s: MatchState) => s.units.map((u) => ({ id: u.id, pos: u.move.body.pos, u }));
      const views: DummyView[] = [];
      for (const it of lerpById(unitsOf(v.prev), unitsOf(v.cur), v.alpha)) {
        const u = it.u;
        if (!u.alive) continue;
        const flags = statusFlags(u, v.cur.tick);
        if (flags.rooted) roots.push({ center: { x: it.pos.x, y: it.pos.y, z: it.pos.z }, radius: 0.65 });
        if (u.kind !== "dummy") continue;
        const a = anim(u.id);
        a.seen = true;
        const kb = Math.hypot(u.kb.x, u.kb.z);
        const lean = Math.min(LEAN_MAX, kb * LEAN_PER_MPS);
        const tx = kb > 1e-4 ? (lean * u.kb.z) / kb : 0;
        const tz = kb > 1e-4 ? (-lean * u.kb.x) / kb : 0;
        a.sx = stepSpring(a.sx, tx, LEAN_OMEGA, dt);
        a.sz = stepSpring(a.sz, tz, LEAN_OMEGA, dt);
        a.kick = stepSpring(a.kick, 0, FLINCH_OMEGA, dt);
        if (u.move.landVel < -2 && a.landTick !== v.cur.tick) {
          a.landTick = v.cur.tick;
          a.squash = { x: a.squash.x, v: a.squash.v - Math.min(4, -u.move.landVel * 0.35) };
        }
        a.squash = stepSpring(a.squash, 0, 18, dt);
        const pos = { x: it.pos.x, y: it.pos.y, z: it.pos.z };
        views.push({
          pose: {
            pos,
            yaw: u.move.yaw,
            leanX: Math.max(-LEAN_MAX * 1.6, Math.min(LEAN_MAX * 1.6, a.sx.x)),
            leanZ: Math.max(-LEAN_MAX * 1.6, Math.min(LEAN_MAX * 1.6, a.sz.x)),
            flinch: a.kick.x,
            squash: Math.max(0.72, Math.min(1.15, 1 + a.squash.x)),
            flash: v.nowS < a.flashUntil,
            bob: 0.035 * Math.sin(v.nowS * 2.3 + u.id * 1.7),
          },
          distM: Math.hypot(pos.x - eye.x, pos.y + 0.9 - eye.y, pos.z - eye.z),
        });
        if (flags.burning) {
          if (v.nowS - a.lastBurnS > 0.08) {
            a.lastBurnS = v.nowS;
            const at = { x: pos.x + (Math.random() - 0.5) * 0.4, y: pos.y + 0.5 + Math.random() * 1.1, z: pos.z + (Math.random() - 0.5) * 0.3 };
            worldPool.emit(burstParticles("burnLick", at, UP, 1, Math.random), nowT);
          }
          const flicker = 0.75 + 0.25 * Math.sin(v.nowS * 23 + u.id) * Math.sin(v.nowS * 9.1);
          glowList.push({ pos: { x: pos.x, y: pos.y + 1, z: pos.z }, color: FX_COLOR.fire, halo: 0, light: 2.4, intensity: 0.7 * flicker, core: 0, prio: 1 });
        }
      }
      for (const [id, a] of anims) if (!a.seen && v.nowS > a.flashUntil + 1) anims.delete(id);
      dummies.update(views, viewportH(), WORLD_FOV);

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
              worldPool.emit(trailParticles(pr.ability, tr.last, pos, Math.min(n, 16), Math.random), nowT);
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
        const spec = zoneDecal(z, tick);
        if (spec) decalList.push({ spec, seed: (z.id * 0.731) % 17, intensity: 1 });
        const sheet = fireWallSheet(z, tick);
        const line = lineOfBox(z);
        if (sheet && line) {
          sheets.push(sheet);
          let st = ignited.get(z.id);
          if (!st) {
            st = { embers: 0 };
            ignited.set(z.id, st);
            worldPool.emit(lineFlames(line.a, line.b, 44, true, Math.random), nowT);
          }
          st.embers += dt * 34 * sheet.fade;
          const n = Math.floor(st.embers);
          if (n > 0) {
            st.embers -= n;
            worldPool.emit(lineFlames(line.a, line.b, n, false, Math.random), nowT);
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
            worldPool.emit(lineFlames(line.a, line.b, n, false, Math.random), nowT);
          }
        }
      }
      for (const id of ignited.keys()) if (!liveZones.has(id)) ignited.delete(id);
      walls.update(sheets);
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

      // вспышки света всплесков
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]!;
        const age = nowT - f.born;
        if (age >= f.life || age < -1) {
          flashes.splice(i, 1);
          continue;
        }
        const k = 1 - age / f.life;
        glowList.push({ pos: f.pos, color: FX_COLOR.fire, halo: f.halo * (0.6 + 0.4 * k), light: f.light, intensity: f.intensity * k * k, core: f.core * k, prio: 5 });
      }
      // бюджет источников света на мир (пресет): самые важные светят, остальные — только ореол
      glowList.sort((a, b) => b.prio - a.prio);
      let lit = 0;
      const out: Glow[] = [];
      for (const g of glowList) {
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
      worldPool.setCap(caps.world);
      palmPool.setCap(caps.palm);
    },

    dispose() {
      worldPool.dispose();
      palmPool.dispose();
      glows.dispose();
      decals.dispose();
      walls.dispose();
      veins.dispose();
      dummies.dispose();
      terrain.dispose();
      cores.dispose();
      debris.dispose();
    },
  };
}
