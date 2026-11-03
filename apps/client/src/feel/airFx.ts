import { NOBODY, forwardXZ, rightXZ, unitById, type AbilityId, type MatchEvent, type Unit, type UnitId, type Vec3, type ZoneKind } from "@doodlemagic/sim";
import type { BurstPreset, Effect, SoundId } from "./effects";
import type { FrameView } from "./elementFx";
import type { EventView } from "./eventMap";

/*
 * Ощущение Воздуха (02-air, «Читается»): события Воздуха → эффекты и покадровые зёрна (парение, гул Смерча).
 * Своё — жест, ладони, камера и звук у уха; чужое — только мир и звук в точке. Попадания (hit) и смерть
 * остаются общей карте (ступени, хитмаркер, deathAir по стихии убийцы).
 */

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const AIR_ABILITIES: ReadonlySet<AbilityId> = new Set<AbilityId>(["airSickle", "gust", "swoop", "tornado"]);
const VORTEX: ReadonlySet<ZoneKind> = new Set<ZoneKind>(["tornado", "fireTornado"]);
/** Своё попадание слышно не тише этого и издалека — как в общей карте (round3/01, H3). */
const OWN_FLOOR = 0.6;
/** Толчок камеры средней ступени (TIERS.medium.kickDeg) и её trauma — у выпуска Порыва и удара о стену. */
const MEDIUM_KICK_DEG = 1.25;
const MEDIUM_TRAUMA = 0.5;
/** Зерно парения — раз в 0,35 с на мага; гул Смерча — раз в 0,5 с на вихрь (Р15). */
export const GLIDE_GRAIN_S = 0.35;
export const HUM_GRAIN_S = 0.5;
/** Веер штрихов по полу — последние 0,2 с замаха Порыва (12 тиков). */
export const FAN_TICKS = 12;

const sound = (id: SoundId, pos: Vec3 | null = null, gain = 1): Effect => ({ kind: "sound", id, pos, gain });
const ownSound = (id: SoundId, pos: Vec3, own: boolean): Effect => (own ? { kind: "sound", id, pos, gain: 1, floor: OWN_FLOOR } : sound(id, pos));
const burst = (preset: BurstPreset, pos: Vec3, dir: Vec3 = UP, scale = 1): Effect => ({ kind: "burst", preset, pos, dir, scale });
const centre = (u: Unit): Vec3 => ({ x: u.move.body.pos.x, y: u.move.body.pos.y + u.move.body.height / 2, z: u.move.body.pos.z });
const ahead = (p: Vec3, d: Vec3, m: number): Vec3 => ({ x: p.x + d.x * m, y: p.y + d.y * m, z: p.z + d.z * m });
const back = (d: Vec3): Vec3 => ({ x: -d.x + 0, y: -d.y + 0, z: -d.z + 0 });

/** Каст Воздуха. Чужой — звук в точке каста; рост Смерча звучит ещё и из зоны (zone/telegraph). */
function castFx(ev: Extract<MatchEvent, { type: "cast" }>, mine: boolean): Effect[] {
  if (!mine) {
    if (ev.ability === "airSickle") return [sound("sickleThrow", ev.pos)];
    if (ev.ability === "gust") return [sound("gustWindup", ev.pos)];
    if (ev.ability === "swoop") return [sound("swoop", ev.pos)];
    if (ev.ability === "tornado") return [sound("tornadoCast", ev.pos)];
    return [];
  }
  // gesture всегда раньше palm: по нему интеграция узнаёт руку серпа
  switch (ev.ability) {
    case "airSickle":
      return [
        { kind: "gesture", ability: "airSickle" },
        { kind: "palm", hand: "auto", element: "air", preset: "flash" },
        sound("sickleThrow"),
        { kind: "kick", pitchDeg: 0.2, yawDeg: 0, rollDeg: 0 },
      ];
    case "gust":
      // замах: у ладоней сходится кольцо ветра, свист растёт; удар камеры — на выпуске
      return [{ kind: "gesture", ability: "gust" }, { kind: "palm", hand: "both", element: "air", preset: "charge" }, sound("gustWindup")];
    case "swoop":
      // FOV-импульс и крен — на старте рывка (dash/start)
      return [{ kind: "gesture", ability: "swoop" }, { kind: "palm", hand: "both", element: "air", preset: "flash" }, sound("swoop")];
    case "tornado":
      return [
        { kind: "gesture", ability: "tornado" },
        { kind: "palm", hand: "both", element: "air", preset: "flash" },
        sound("tornadoCast"),
        { kind: "kick", pitchDeg: 1, yawDeg: 0, rollDeg: 0 },
      ];
    default:
      return [];
  }
}

/** Выпуск: серп звучит на касте; Порыв — удар ветра конусом, у себя — толчок камеры средней ступени. */
function releaseFx(ev: Extract<MatchEvent, { type: "release" }>, mine: boolean): Effect[] {
  if (ev.ability !== "gust") return [];
  const blast = burst("gustBlast", ahead(ev.pos, ev.dir, 0.8), ev.dir);
  if (!mine) return [blast, sound("gustBlast", ev.pos)];
  return [
    blast,
    { kind: "palm", hand: "both", element: "air", preset: "flash" },
    sound("gustBlast"),
    { kind: "kick", pitchDeg: MEDIUM_KICK_DEG, yawDeg: 0, rollDeg: 0 },
    { kind: "fov", deg: 3 },
  ];
}

/**
 * Событие Воздуха → эффекты; null — не Воздуха (дальше общая карта). me — свой маг (localId) в состоянии события.
 */
export function airEffects(ev: MatchEvent, view: EventView, me: Unit | undefined): Effect[] | null {
  const mine = (unit: UnitId): boolean => unit === view.localId;
  switch (ev.type) {
    case "cast":
      return AIR_ABILITIES.has(ev.ability) ? castFx(ev, mine(ev.unit)) : null;
    case "release":
      return AIR_ABILITIES.has(ev.ability) ? releaseFx(ev, mine(ev.unit)) : null;
    case "impact": {
      if (ev.ability !== "airSickle") return null;
      const out: Effect[] = [burst("sicklePuff", ev.pos, ev.normal)];
      if (ev.terrain >= 0) out.push(burst("terrainChips", ev.pos, ev.normal, 0.5));
      // пол громкости — только своему попаданию в цель, промах звучит по расстоянию
      out.push(ownSound("sickleHit", ev.pos, mine(ev.owner) && ev.target !== NOBODY));
      return out;
    }
    case "blown":
      // Порыв сдул снаряд: клочья ветра в точке снаряда
      return [burst("airBlown", ev.pos), ownSound("airBlown", ev.pos, mine(ev.unit))];
    case "slam": {
      // удар о стену: хлопок и глухой удар; жертве — тряска средней ступени и звук у уха
      if (mine(ev.target)) return [burst("airSlam", ev.pos), sound("airSlam"), { kind: "trauma", amount: MEDIUM_TRAUMA, profile: "earth" }];
      return [burst("airSlam", ev.pos), ownSound("airSlam", ev.pos, mine(ev.source))];
    }
    case "airJump":
      // хлопок-кольцо под ногами
      return mine(ev.unit) ? [burst("airJumpRing", ev.pos), sound("airJump")] : [burst("airJumpRing", ev.pos), sound("airJump", ev.pos)];
    case "glide":
      // свист парения — зёрнами из airFrame, ленты — в airVfx; своему на раскрытии — лёгкий FOV-импульс
      return ev.on && mine(ev.unit) ? [{ kind: "fov", deg: 1.5 }] : [];
    case "charge": {
      if (unitById(view.state, ev.unit)?.mage?.element !== "air") return null;
      // ленту на плаще видят все (airVfx); звук — только своему
      return mine(ev.unit) && ev.slot === "e" ? [sound("airCharge", null, 0.8)] : [];
    }
    case "dash": {
      if (ev.ability !== "swoop") return null;
      if (ev.phase !== "start") return [];
      const wake = burst("swoopWake", ev.pos, back(ev.dir));
      if (!mine(ev.unit)) return [wake];
      const r = rightXZ(me?.move.yaw ?? 0);
      const side = ev.dir.x * r.x + ev.dir.z * r.z;
      // FOV-импульс как у Реактивного рывка, крен в сторону рывка
      return [{ kind: "fov", deg: 8 }, { kind: "kick", pitchDeg: 0, yawDeg: 0, rollDeg: -3 * side + 0 }, wake];
    }
    case "zone": {
      if (!VORTEX.has(ev.kind)) return null;
      if (ev.phase !== "telegraph") return [];
      const z = view.state.zones.find((q) => q.id === ev.zone);
      if (!z || z.shape.type !== "disc") return [];
      const c = z.shape.center;
      // 0,5 с по полу раскручивается кольцо пыли и штрихов; рост слышно из центра (своё — и издалека)
      return [burst("tornadoDust", c), ownSound("tornadoRise", c, mine(ev.owner))];
    }
    case "reaction": {
      if (ev.kind !== "fireTornado") return null;
      const out: Effect[] = [burst("fireTornadoFlare", ev.pos), ownSound("fireTornado", ev.pos, mine(ev.owner))];
      if (mine(ev.owner)) out.push({ kind: "toast", text: "Огненный смерч!" });
      return out;
    }
    default:
      return null;
  }
}

/**
 * Покадровые эффекты Воздуха со своей памятью: зёрна парения (раз в 0,35 с на мага, и после мигания парения тоже),
 * гул Смерча (раз в 0,5 с на вихрь, позиционно), веер Порыва (раз на замах, за ≤ 12 тиков до выпуска).
 */
export function createAirFrame(): (f: FrameView) => Effect[] {
  const glideAt = new Map<UnitId, number>();
  const humAt = new Map<number, number>();
  const fanFor = new Map<UnitId, number>();
  const seen = new Set<number>();
  return (f) => {
    const out: Effect[] = [];
    const s = f.cur;
    seen.clear();
    for (const u of s.units) {
      const m = u.mage;
      // мёртвый маг держит gliding = true до возрождения без glide off — зёрна только у живого
      if (!m || m.element !== "air" || !u.alive) continue;
      seen.add(u.id);
      const own = u.id === f.localId;
      if (m.flight.gliding) {
        const last = glideAt.get(u.id);
        if (last === undefined || f.nowS - last >= GLIDE_GRAIN_S || f.nowS < last) {
          glideAt.set(u.id, f.nowS);
          // парящего слышно издалека; свой свист у уха тише — он идёт до 3 с
          out.push(own ? sound("glideWhistle", null, 0.5) : sound("glideWhistle", centre(u)));
        }
      }
      const w = m.windup;
      if (w && w.ability === "gust" && w.releaseTick - s.tick <= FAN_TICKS && fanFor.get(u.id) !== w.releaseTick) {
        fanFor.set(u.id, w.releaseTick);
        const fw = forwardXZ(u.move.yaw);
        const p = u.move.body.pos;
        out.push(burst("gustFan", { x: p.x + fw.x * 0.6, y: p.y + 0.05, z: p.z + fw.z * 0.6 }, { x: fw.x, y: 0.04, z: fw.z }));
      }
    }
    for (const id of glideAt.keys()) if (!seen.has(id)) glideAt.delete(id);
    for (const id of fanFor.keys()) if (!seen.has(id)) fanFor.delete(id);
    seen.clear();
    for (const z of s.zones) {
      if (!VORTEX.has(z.kind) || z.shape.type !== "disc" || s.tick < z.armTick) continue;
      seen.add(z.id);
      const last = humAt.get(z.id);
      if (last === undefined || f.nowS - last >= HUM_GRAIN_S || f.nowS < last) {
        humAt.set(z.id, f.nowS);
        const c = z.shape.center;
        out.push(sound(z.kind === "fireTornado" ? "fireTornado" : "tornadoHum", { x: c.x, y: c.y + 1.5, z: c.z }));
      }
    }
    for (const id of humAt.keys()) if (!seen.has(id)) humAt.delete(id);
    return out;
  };
}

/** Раз в кадр: непрерывные звуки и частицы Воздуха. */
export const airFrame: (f: FrameView) => Effect[] = createAirFrame();
