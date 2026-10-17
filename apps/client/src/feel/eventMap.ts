import {
  ABILITY_OF,
  EARTH,
  forwardXZ,
  rightXZ,
  unitById,
  type AbilityId,
  type DamageSource,
  type Element,
  type MatchEvent,
  type MatchState,
  type Unit,
  type UnitId,
  type Vec3,
  type Zone,
  type ZoneShape,
} from "@doodlemagic/sim";
import type { BurstPreset, Effect, SoundId } from "./effects";

/** Чьими глазами смотрим: «я» — localId; state — состояние после шага, в котором родилось событие. */
export interface EventView {
  localId: UnitId;
  state: MatchState;
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const FIRE_ABILITIES: ReadonlySet<DamageSource> = new Set<DamageSource>([...Object.values(ABILITY_OF.fire), "burning"]);
const elementOf = (a: DamageSource): Element => (FIRE_ABILITIES.has(a) ? "fire" : "earth");
/** ЛКМ — лёгкая ступень шкалы мощности: свой «сок» по темпу, без тряски у стреляющего (round2/03, п. 7). */
const isPrimary = (a: DamageSource): boolean => a === ABILITY_OF.fire.primary || a === ABILITY_OF.earth.primary;
/**
 * Урон по времени камеру не трясёт и хитмаркер не зажигает (GDD 5). Горение приходит с dot; след рывка жжёт
 * импульсами 3 урона раз в 0,5 с (зона-контакт без dot), но это тоже урон по времени.
 */
const overTime = (ev: Extract<MatchEvent, { type: "hit" }>): boolean => ev.dot || ev.ability === "jetDash";

/** Звук каста у слушателя: предвосхищение или выпуск (round2/03, п. 4.2). */
const CAST_SOUND: Readonly<Record<AbilityId, SoundId>> = {
  fireFists: "fireFist", fireball: "fireballCharge", jetDash: "dash", fireWall: "fireWallTelegraph",
  stoneShot: "stoneCast", stonePillar: "pillarTelegraph", stoneWall: "wallRise", earthquake: "quakeWindup",
};
/** Отдача камеры у кастующего, градусы: кулаки 0,2°, камень 0,6°, остальное 1° (round2/03, п. 4.2). */
const castKickDeg = (a: AbilityId): number => (a === "fireFists" ? 0.2 : a === "stoneShot" ? 0.6 : 1);
/** Чем попали в меня — глухой удар плюс отпечаток стихии (round1/03, п. 3). */
const HIT_SOUND: Readonly<Record<DamageSource, SoundId>> = {
  fireFists: "fireFist", fireball: "fireballBoom", jetDash: "fireWallIgnite", fireWall: "fireWallIgnite", burning: "fireWallIgnite",
  stoneShot: "stoneImpact", stonePillar: "pillarStrike", stoneWall: "terrainHit", earthquake: "quakeStrike",
};

const sound = (id: SoundId, pos: Vec3 | null = null, gain = 1): Effect => ({ kind: "sound", id, pos, gain });
const burst = (preset: BurstPreset, pos: Vec3, dir: Vec3 = UP, scale = 1): Effect => ({ kind: "burst", preset, pos, dir, scale });
const centre = (u: Unit): Vec3 => ({ x: u.move.body.pos.x, y: u.move.body.pos.y + u.move.body.height / 2, z: u.move.body.pos.z });
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Точка зоны для всплеска: середина основания бокса, середина отрезка, центр диска. */
function zonePoint(s: ZoneShape): Vec3 {
  if (s.type === "box") return { x: (s.box.min.x + s.box.max.x) / 2, y: s.box.min.y, z: (s.box.min.z + s.box.max.z) / 2 };
  if (s.type === "segment") return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2, z: (s.a.z + s.b.z) / 2 };
  return { ...s.center };
}
/** Расстояние от точки до зоны: до бокса, до отрезка, до центра диска. */
function zoneDistance(s: ZoneShape, p: Vec3): number {
  if (s.type === "box") {
    const q = { x: clampTo(p.x, s.box.min.x, s.box.max.x), y: clampTo(p.y, s.box.min.y, s.box.max.y), z: clampTo(p.z, s.box.min.z, s.box.max.z) };
    return dist(p, q);
  }
  if (s.type === "segment") {
    const ab = { x: s.b.x - s.a.x, y: s.b.y - s.a.y, z: s.b.z - s.a.z };
    const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    const u = len2 > 0 ? clampTo(((p.x - s.a.x) * ab.x + (p.y - s.a.y) * ab.y + (p.z - s.a.z) * ab.z) / len2, 0, 1) : 0;
    return dist(p, { x: s.a.x + ab.x * u, y: s.a.y + ab.y * u, z: s.a.z + ab.z * u });
  }
  return dist(p, s.center);
}

/** Толчок камеры, когда попали в меня: −dir в осях взгляда, 1° × min(1, урон / 40), сумма модулей ≤ 1°. */
function hitKick(ev: Extract<MatchEvent, { type: "hit" }>, yaw: number): Effect {
  const f = forwardXZ(yaw);
  const r = rightXZ(yaw);
  const s = Math.min(1, Math.max(0, ev.amount) / 40);
  // вперёд от меня (удар спереди) — голова откидывается вверх; толкнули вправо — взгляд уходит вправо (yaw < 0)
  let pitch = -(ev.dir.x * f.x + ev.dir.z * f.z) * s;
  let yawDeg = -(ev.dir.x * r.x + ev.dir.z * r.z) * s;
  const sum = Math.abs(pitch) + Math.abs(yawDeg);
  if (sum > 1) [pitch, yawDeg] = [pitch / sum, yawDeg / sum];
  return { kind: "kick", pitchDeg: pitch + 0, yawDeg: yawDeg + 0, rollDeg: 0 };
}

function hitEffects(ev: Extract<MatchEvent, { type: "hit" }>, view: EventView, me: Unit | undefined): Effect[] {
  const out: Effect[] = [];
  const lmb = isPrimary(ev.ability);
  if (ev.source === view.localId && ev.target !== view.localId) {
    if (overTime(ev)) out.push({ kind: "number", target: ev.target, amount: ev.amount, pos: ev.pos, dot: true, air: ev.airborne });
    else {
      // вторая фаза попадания: урон засчитан (round2/03, конфликт 1)
      out.push(
        { kind: "hitmarker", kill: ev.killed, air: ev.airborne },
        { kind: "number", target: ev.target, amount: ev.amount, pos: ev.pos, dot: false, air: ev.airborne },
        { kind: "flash", target: ev.target },
        { kind: "flinch", target: ev.target, dir: ev.dir, amount: lmb ? 0.1 : 0.2 },
        sound("hitTick"),
        { kind: "hitstop", ms: lmb ? 25 : 60 },
      );
      if (!lmb) out.push({ kind: "trauma", amount: 0.05 });
    }
  }
  if (ev.target === view.localId && ev.source !== view.localId && !overTime(ev)) {
    out.push(
      { kind: "trauma", amount: lmb ? 0.1 : 0.35 },
      hitKick(ev, me?.move.yaw ?? 0),
      { kind: "indicator", from: { x: ev.pos.x - ev.dir.x, y: ev.pos.y - ev.dir.y, z: ev.pos.z - ev.dir.z }, amount: ev.amount },
      sound(HIT_SOUND[ev.ability]),
    );
  }
  return out;
}

function zoneEffects(ev: Extract<MatchEvent, { type: "zone" }>, view: EventView, me: Unit | undefined): Effect[] {
  if (ev.phase === "end") return [];
  const z: Zone | undefined = view.state.zones.find((q) => q.id === ev.zone);
  if (!z) return [];
  const at = zonePoint(z.shape);
  const near = (m: number): boolean => me !== undefined && me.alive && zoneDistance(z.shape, centre(me)) < m;
  if (ev.phase === "telegraph") {
    if (ev.kind === "pillar") return [burst("pillarCracks", at)];
    if (ev.kind === "fireWall") return [burst("fireWallSparks", at)];
    return [];
  }
  if (ev.kind === "pillar") return [burst("pillarBurst", at), sound("pillarStrike", at), ...(near(4) ? [{ kind: "trauma", amount: 0.35 } as const] : [])];
  if (ev.kind === "quake") {
    // всем на земле в радиусе; на галерее над ударом и в воздухе не трясёт (Р8)
    const r = z.shape.type === "disc" ? z.shape.radius : EARTH.earthquake.radiusM;
    const inside =
      me !== undefined && me.alive && me.move.onGround && Math.hypot(me.move.body.pos.x - at.x, me.move.body.pos.z - at.z) <= r &&
      Math.abs(me.move.body.pos.y - at.y) <= EARTH.earthquake.heightM;
    return [burst("quakeRing", at, UP, r), sound("quakeStrike", at), ...(inside ? [{ kind: "trauma", amount: 0.4 } as const] : [])];
  }
  if (ev.kind === "fireWall") return [burst("fireWallIgnite", at), sound("fireWallIgnite", at), ...(near(5) ? [{ kind: "trauma", amount: 0.15 } as const] : [])];
  return [];
}

/**
 * Событие матча → эффекты ощущения (round1/03, round2/03, GDD 5). Чистая функция: частицы, звук, камера, руки
 * и HUD исполняют результат сами. Мой каст отзывается на кадре нажатия; в эффектах каста gesture всегда раньше
 * palm — по нему интеграция узнаёт, какой рукой бьёт кулак.
 */
export function effectsFor(ev: MatchEvent, view: EventView): Effect[] {
  const me = unitById(view.state, view.localId);
  const mine = (unit: UnitId): boolean => unit === view.localId;
  switch (ev.type) {
    case "cast": {
      if (!mine(ev.unit)) return [];
      const caster = unitById(view.state, ev.unit);
      const element = caster?.mage?.element ?? elementOf(ev.ability);
      const out: Effect[] = [
        { kind: "gesture", ability: ev.ability },
        {
          kind: "palm",
          hand: ev.ability === "fireFists" ? "auto" : "both",
          element,
          preset: ev.ability === "fireball" || ev.ability === "stoneShot" ? "charge" : "flash",
        },
        sound(CAST_SOUND[ev.ability]),
        { kind: "kick", pitchDeg: castKickDeg(ev.ability), yawDeg: 0, rollDeg: 0 },
      ];
      // камень вырывается из пола у ног
      if (ev.ability === "stoneShot" && caster) out.push(burst("stoneCrumble", { ...caster.move.body.pos }));
      return out;
    }
    case "release":
      if (!mine(ev.unit)) return [];
      if (ev.ability === "fireball")
        return [{ kind: "kick", pitchDeg: 1.5, yawDeg: 0, rollDeg: 0 }, { kind: "fov", deg: 3, holdS: 0.15 }, { kind: "trauma", amount: 0.15 }];
      if (ev.ability === "stoneShot") return [burst("stoneCrumble", ev.pos)];
      return [];
    case "impact": {
      // первая фаза попадания: снаряд врезался — видно и слышно в мире, хитмаркер ждёт события hit
      const preset: BurstPreset = ev.terrain >= 0 ? "terrainChips" : ev.ability === "stoneShot" ? "stoneImpact" : "fistImpact";
      return [burst(preset, ev.pos, ev.normal), sound(ev.ability === "stoneShot" ? "stoneImpact" : "fireFist", ev.pos)];
    }
    case "explosion": {
      const out: Effect[] = [burst("fireballBoom", ev.pos, UP, ev.radius / 3), sound("fireballBoom", ev.pos)];
      if (me?.alive && dist(centre(me), ev.pos) < 5) out.push({ kind: "trauma", amount: 0.15 });
      return out;
    }
    case "hit":
      return hitEffects(ev, view, me);
    case "zone":
      return zoneEffects(ev, view, me);
    case "terrain":
      if (ev.phase === "rise") return [burst("wallDust", ev.pos), ...(ev.kind === "wall" && mine(ev.owner) ? [{ kind: "trauma", amount: 0.1 } as const] : [])];
      if (ev.phase === "hit") return [burst("terrainChips", ev.pos), sound("terrainHit", ev.pos)];
      if (ev.phase === "break") return [burst("terrainBreak", ev.pos), sound("terrainBreak", ev.pos)];
      if (ev.phase === "expire") return [burst("wallDust", ev.pos)];
      return [];
    case "dash": {
      if (!mine(ev.unit) || ev.phase !== "start") return [];
      const r = rightXZ(me?.move.yaw ?? 0);
      const side = ev.dir.x * r.x + ev.dir.z * r.z;
      // крен в сторону рывка (вправо — по часовой, rotation.z < 0); пламя бьёт назад, за спину
      return [
        { kind: "fov", deg: 6, holdS: 0.2 },
        { kind: "kick", pitchDeg: 0, yawDeg: 0, rollDeg: -3 * side + 0 },
        burst("dashBlast", ev.pos, { x: -ev.dir.x + 0, y: -ev.dir.y + 0, z: -ev.dir.z + 0 }),
      ];
    }
    case "reject": {
      if (!mine(ev.unit)) return [];
      if (ev.reason !== "notGrounded" && ev.reason !== "noTarget") return [{ kind: "deny", slot: ev.slot }];
      // «пшик» отклонённого каста (round2/03, п. 4.1)
      const element = me?.mage?.element ?? "fire";
      return [
        { kind: "palm", hand: "both", element, preset: "fizzle" },
        sound("fizzle"),
        { kind: "toast", text: ev.reason === "notGrounded" ? "Нужна опора" : "Некуда" },
      ];
    }
    case "overheat":
      if (!mine(ev.unit) || !ev.on) return [];
      return [sound("overheat"), { kind: "palm", hand: "both", element: "fire", preset: "fizzle" }, { kind: "toast", text: "Перегрев" }];
    case "courage":
      return mine(ev.unit) ? [{ kind: "toast", text: "Кураж!" }, sound("courage")] : [];
    case "death": {
      const element = unitById(view.state, ev.killer)?.mage?.element ?? elementOf(ev.ability);
      return [burst(element === "fire" ? "deathFire" : "deathEarth", ev.pos), ...(mine(ev.killer) ? [sound("kill")] : [])];
    }
    case "fall":
      return mine(ev.credit) ? [{ kind: "toast", text: "Сброс!" }, sound("fall")] : [];
    case "respawn":
      return [burst("respawnPuff", ev.pos)];
    case "status":
      // статусы HUD и частицы читают из состояния
      return [];
  }
}
