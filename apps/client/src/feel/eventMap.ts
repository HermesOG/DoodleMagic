import {
  ABILITY_OF,
  EARTH,
  ELEMENT_OF,
  FIRE,
  NOBODY,
  aimDir,
  eyeOf,
  forwardXZ,
  isUlt,
  rightXZ,
  unitById,
  type AbilityId,
  type DamageSource,
  type Element,
  type MatchEvent,
  type MatchState,
  type UltCast,
  type Unit,
  type UnitId,
  type Vec3,
  type Zone,
  type ZoneShape,
} from "@doodlemagic/sim";
import { isFistGesture } from "../hands/gestures";
import { SHAKE } from "./camera";
import type { BurstPreset, Effect, FeelTier, SoundId } from "./effects";
import { elementEffects, type FrameView } from "./elementFx";

/** Чьими глазами смотрим: «я» — localId; state — состояние после шага, в котором родилось событие. */
export interface EventView {
  localId: UnitId;
  state: MatchState;
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };
/** Стихия источника урона; горение — Огонь. */
const elementOf = (a: DamageSource): Element => (a === "burning" ? "fire" : ELEMENT_OF[a]);
/** ЛКМ — лёгкая ступень шкалы мощности: свой «сок» по темпу, без тряски у стреляющего (round2/03, п. 7). */
const isPrimary = (a: DamageSource): boolean => a !== "burning" && ABILITY_OF[ELEMENT_OF[a]].primary === a;

/**
 * Ступени отклика (round3/01, 2.1) — одна таблица чисел на все события. trauma — жертве; kickDeg — предел толчка
 * камеры жертве; hitstopMs — пауза у стреляющего (руки, если жест ещё идёт); confirm — звук подтверждения.
 * Хитмаркер по ступени (0,12 / 0,22 / 0,35 с) держит HUD, реверб по ступени — рецепт звука.
 */
export const TIERS: Readonly<Record<FeelTier, { trauma: number; kickDeg: number; hitstopMs: number; confirm: SoundId | null }>> = {
  none: { trauma: 0, kickDeg: 0, hitstopMs: 0, confirm: null },
  small: { trauma: 0.2, kickDeg: 0.75, hitstopMs: 30, confirm: "hitLight" },
  medium: { trauma: 0.5, kickDeg: 1.25, hitstopMs: 60, confirm: "hitHeavy" },
  large: { trauma: 0.8, kickDeg: 2, hitstopMs: 90, confirm: null }, // убийство звучит «kill» из события death
};
type HitEvent = Extract<MatchEvent, { type: "hit" }>;
/**
 * Касание шипов Разлома после удара (20 урона, вбок 3 м без подброса, раз в 1 с на юнита): не удар по линии.
 * Удар — 100 и подброс; в воздухе урон ×1,15, поэтому порог — полтора урона шипов.
 */
const riftSpike = (ev: Pick<HitEvent, "ability"> & Partial<Pick<HitEvent, "amount" | "knock">>): boolean =>
  ev.ability === "tectonicRift" && ev.knock !== undefined && ev.knock.upM <= 0 && ev.amount !== undefined && ev.amount <= EARTH.tectonicRift.spikesDamage * 1.5;
/**
 * Ступень попадания: урон по времени (и поток Дыхания — импульсы dot) — нет; ЛКМ — малая; остальное и шипы Разлома —
 * средняя; убийство и ульта (удар Разлома, Ураган, Цунами) — крупная.
 */
export function hitTier(ev: Pick<HitEvent, "ability" | "dot" | "killed"> & Partial<Pick<HitEvent, "amount" | "knock">>): FeelTier {
  if (ev.killed) return "large";
  if (ev.dot || ev.ability === "jetDash" || ev.ability === "burning") return "none";
  if (riftSpike(ev)) return "medium";
  if (isUlt(ev.ability)) return "large";
  return isPrimary(ev.ability) ? "small" : "medium";
}
/**
 * Темп малой ступени: скорострельной ЛКМ тряска и толчок меньше (GDD 5). Кулаки 5 раз/с — половина, камень
 * 1,9 раза/с — целиком; средней и крупной ступени — 1.
 */
const tempo = (a: DamageSource): number => (a === ABILITY_OF.fire.primary ? 0.5 : 1);
/** Пауза у стреляющего: у кулака — 0 (5 раз/с, иначе руки стояли бы), у камня — 30 мс, дальше — по ступени. */
const hitstopMs = (tier: FeelTier, a: DamageSource): number => (a === ABILITY_OF.fire.primary && tier === "small" ? 0 : TIERS[tier].hitstopMs);
/**
 * trauma, которую жертва уже получила от события области того же удара (зона столба и землетрясения, взрыв шара):
 * попадание добавляет только остаток до своей ступени, а не складывается с ней. Итого столб 0,5, шар 0,5,
 * землетрясение 0,65 (round3/01, 2.1).
 */
export const AREA_TRAUMA = { stonePillar: 0.35, earthquake: 0.65, fireball: 0.15 } as const;
/** Своё попадание и взрыв слышно не тише этого и издалека (round3/01, H3): на 20 м было 25 %. */
const OWN_HIT_FLOOR = 0.6;
/** Толчок от 2 м по полу — это ≥ 4 м/с (v₀ ≈ 2·distM, Р3): жертве FOV-удар и «вжух» (round3/01, K3). */
const KNOCK_FEEL_M = 2;
/** Удар ладонями в землю (round3/01, A2): камера вниз на 1,2° и на 4 см. */
const GROUND_SLAM: Effect = { kind: "kick", pitchDeg: -1.2, yawDeg: 0, rollDeg: 0, dropM: 0.04 };
/**
 * Урон по времени камеру не трясёт и хитмаркер не зажигает (GDD 5). Горение приходит с dot; след рывка жжёт
 * импульсами 3 урона раз в 0,5 с (зона-контакт без dot), но это тоже урон по времени.
 */
const overTime = (ev: Extract<MatchEvent, { type: "hit" }>): boolean => ev.dot || ev.ability === "jetDash";

/**
 * Ульты Огня и Земли (фаза 5). Поток Дыхания — с выдоха до конца каста, ровно по ult.cast в состоянии: каст может
 * исчезнуть и без события ult/end, и тогда поток кончается сам.
 */
export function breathStreaming(c: UltCast | null | undefined, tick: number): c is UltCast {
  return !!c && c.ability === "dragonBreath" && tick >= c.releaseTick && tick < c.endTick;
}
/** Зерно рёва потока — раз в 0,3 с на мага (Р15 фазы 4: непрерывное — зёрнами ≤ 0,8 с). */
export const ROAR_GRAIN_S = 0.3;
/** Свои ладони разгораются на вдохе: заряд у рук раз в столько секунд. */
const INHALE_PALM_S = 0.2;
/** Своя тряска на весь поток: 0,3 на выдохе, дальше кадр доливает ровно свой спад (SHAKE.decayPerS × dt). */
export const BREATH_TRAUMA = 0.3;
/** FOV-удар своего выдоха (+4°) и крупной ступени — удар Разлома у кастующего и задетых (+10°, round3/01, 2.1). */
const BREATH_FOV_DEG = 4;
const LARGE_FOV_DEG = 10;
/** Вспышка потока на цели — на каждом втором импульсе (импульс раз в 10 тиков): 3 раза в секунду. */
const BREATH_HIT_EVERY = 2;
/**
 * Импульс потока, на котором цель вспыхивает: тик импульса (state.tick − 1) в десятках тиков — чётный. Импульсы идут
 * подряд через pulseTicks, поэтому чётность чередуется: ровно каждый второй, без памяти между событиями.
 */
export const breathBeat = (s: MatchState): boolean => Math.floor((s.tick - 1) / FIRE.dragonBreath.pulseTicks) % BREATH_HIT_EVERY === 0;
/** Жертве Дыхания на вспышке: лёгкая тряска (урон по времени камеру не трясёт — это поток в лицо). */
const BREATH_VICTIM_TRAUMA = 0.12;
/** trauma удара Разлома всем на полу у линии (до 4 м): жертва получает остаток до крупной ступени. */
export const RIFT_NEAR_TRAUMA = 0.3;
/** Всплесков удара шипов по линии (по 30 частиц, MAX_BURST на всплеск не превышен). */
export const RIFT_BURSTS = 5;
/** Тост убийцы ультой (round3/01, 2.1: крупная ступень — тост). */
const ULT_KILL_TOAST: Readonly<Partial<Record<DamageSource, string>>> = { dragonBreath: "Дыхание дракона!", tectonicRift: "Разлом!" };

/** Звук каста у слушателя: предвосхищение или выпуск (round2/03, п. 4.2). */
const CAST_SOUND: Readonly<Record<AbilityId, SoundId>> = {
  fireFists: "fireFist", fireball: "fireballCharge", jetDash: "dash", fireWall: "fireWallTelegraph",
  stoneShot: "stoneCast", stonePillar: "pillarTelegraph", stoneWall: "wallRise", earthquake: "quakeWindup",
  airSickle: "sickleThrow", gust: "gustWindup", swoop: "swoop", tornado: "tornadoRise",
  waterWhip: "whipCrack", waterGrab: "grabWindup", waterWard: "wardUp", spring: "springSpread",
  // ульты (фаза 5): вдох Дыхания, гул бегущей трещины Разлома; Ураган и Цунами — заглушки до задачи 6
  dragonBreath: "breathInhale", tectonicRift: "riftRumble", hurricane: "tornadoCast", tsunami: "springSpread",
};
/**
 * Отдача камеры у кастующего на нажатии, градусы: ЛКМ (кулаки, камень, серп, хлыст) 0,2° (у камня ещё 0,6° на броске,
 * A1), ладони в землю — вниз (GROUND_SLAM, A2: столб, стена, Разлом), замах землетрясения — 0 (удар вниз придёт
 * с ударом), вдох Дыхания — 0,4° вверх (выдох толкнёт сильнее), остальное 1°.
 */
const castKick = (a: AbilityId): Effect =>
  a === "stonePillar" || a === "stoneWall" || a === "tectonicRift"
    ? GROUND_SLAM
    : { kind: "kick", pitchDeg: isPrimary(a) ? 0.2 : a === "earthquake" ? 0 : a === "dragonBreath" ? 0.4 : 1, yawDeg: 0, rollDeg: 0 };
/** Чем попали в меня — глухой удар плюс отпечаток стихии (round1/03, п. 3); у кулака свой треск попадания (H3). */
const HIT_SOUND: Readonly<Record<DamageSource, SoundId>> = {
  fireFists: "fistHit", fireball: "fireballBoom", jetDash: "fireWallIgnite", fireWall: "fireWallIgnite", burning: "fireWallIgnite",
  stoneShot: "stoneImpact", stonePillar: "pillarStrike", stoneWall: "terrainHit", earthquake: "quakeStrike",
  airSickle: "sickleHit", gust: "airBlown", swoop: "airBlown", tornado: "airBlown",
  waterWhip: "whipHit", waterGrab: "grabHit", waterWard: "answerHit", spring: "springBubble",
  // ульты (фаза 5): поток Дыхания — урон по времени, его звук — рёв (ultFrame); Разлом — глухой удар камня у уха,
  // сам удар шипов звучит из линии (zone/arm); Ураган и Цунами — заглушки до задачи 6
  dragonBreath: "fireWallIgnite", tectonicRift: "stoneImpact", hurricane: "airBlown", tsunami: "springBubble",
};
/** Выпуск снаряда или удара в конце замаха (A1): звук у меня у уха, у чужого — там, где он бросил. */
const RELEASE_SOUND: Readonly<Partial<Record<AbilityId, SoundId>>> = {
  fireball: "fireballLaunch", stoneShot: "stoneThrow", gust: "gustBlast", waterGrab: "grabThrow", waterWard: "answerThrow",
};
/** Попадание снаряда в цель или мир (первая фаза): всплеск и звук по способности; рельеф — всегда крошка камня. */
const IMPACT_FX: Readonly<Partial<Record<AbilityId, { burst: BurstPreset; sound: SoundId }>>> = {
  fireFists: { burst: "fistImpact", sound: "fistHit" },
  fireball: { burst: "fistImpact", sound: "fistHit" },
  stoneShot: { burst: "stoneImpact", sound: "stoneImpact" },
  airSickle: { burst: "sicklePuff", sound: "sickleHit" },
  waterGrab: { burst: "grabSplash", sound: "grabHit" },
  waterWard: { burst: "answerSplash", sound: "answerHit" },
};
/** Всплеск смерти — по стихии убийцы. */
const DEATH_BURST: Readonly<Record<Element, BurstPreset>> = { fire: "deathFire", earth: "deathEarth", air: "deathAir", water: "deathWater" };

const sound = (id: SoundId, pos: Vec3 | null = null, gain = 1): Effect => ({ kind: "sound", id, pos, gain });
/** Звук попадания в мире; своё — не тише OWN_HIT_FLOOR и издалека. */
const ownSound = (id: SoundId, pos: Vec3, own: boolean): Effect => (own ? { kind: "sound", id, pos, gain: 1, floor: OWN_HIT_FLOOR } : sound(id, pos));
const burst = (preset: BurstPreset, pos: Vec3, dir: Vec3 = UP, scale = 1): Effect => ({ kind: "burst", preset, pos, dir, scale });
const centre = (u: Unit): Vec3 => ({ x: u.move.body.pos.x, y: u.move.body.pos.y + u.move.body.height / 2, z: u.move.body.pos.z });
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Крошка выпущенного камня: 0,8 м вперёд по прицелу от глаз и 0,35 м вниз — там, где руки. */
const releaseCrumblePoint =(eye: Vec3, dir: Vec3): Vec3 => ({ x: eye.x + dir.x * 0.8, y: eye.y + dir.y * 0.8 - 0.35, z: eye.z + dir.z * 0.8 });

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
  if (s.type === "segment") return dist(p, segmentPoint(s.a, s.b, p));
  return dist(p, s.center);
}
/** Ближайшая к p точка отрезка a–b. */
function segmentPoint(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const u = len2 > 0 ? clampTo(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / len2, 0, 1) : 0;
  return { x: a.x + ab.x * u, y: a.y + ab.y * u, z: a.z + ab.z * u };
}

/**
 * Толчок камеры, когда попали в меня: −dir в осях взгляда, предел × min(1, урон / 40), сумма модулей не больше
 * предела (предел — ступень × темп).
 */
function hitKick(ev: Extract<MatchEvent, { type: "hit" }>, yaw: number, capDeg: number): Effect {
  const f = forwardXZ(yaw);
  const r = rightXZ(yaw);
  const s = capDeg * Math.min(1, Math.max(0, ev.amount) / 40);
  // вперёд от меня (удар спереди) — голова откидывается вверх; толкнули вправо — взгляд уходит вправо (yaw < 0)
  let pitch = -(ev.dir.x * f.x + ev.dir.z * f.z) * s;
  let yawDeg = -(ev.dir.x * r.x + ev.dir.z * r.z) * s;
  const sum = Math.abs(pitch) + Math.abs(yawDeg);
  if (sum > capDeg) [pitch, yawDeg] = [(pitch * capDeg) / sum, (yawDeg * capDeg) / sum];
  return { kind: "kick", pitchDeg: pitch + 0, yawDeg: yawDeg + 0, rollDeg: 0 };
}

function hitEffects(ev: Extract<MatchEvent, { type: "hit" }>, view: EventView, me: Unit | undefined): Effect[] {
  const out: Effect[] = [];
  const lmb = isPrimary(ev.ability);
  const tier = hitTier(ev);
  // поток Дыхания — урон по времени 6 раз/с: малая вспышка огня на цели видна всем, но только на каждом втором
  // импульсе (≤ 3 раз/с); крупной ступени, паузы и хитмаркера на каждый импульс нет
  const beat = ev.ability === "dragonBreath" && breathBeat(view.state);
  if (beat) out.push(burst("breathHit", ev.pos));
  if (ev.source === view.localId && ev.target !== view.localId) {
    if (overTime(ev)) {
      out.push({ kind: "number", target: ev.target, amount: ev.amount, pos: ev.pos, dot: true, air: ev.airborne });
      // добил горением или следом — убийство всё равно отмечается
      if (ev.killed) out.push({ kind: "hitmarker", kill: true, air: ev.airborne, tier: "large" });
      // поток попадает: лёгкое подтверждение на вспышке — малый хитмаркер, вспышка цели и тихий щелчок, без паузы
      else if (beat) out.push({ kind: "hitmarker", kill: false, air: ev.airborne, tier: "small" }, { kind: "flash", target: ev.target }, sound("hitLight", null, 0.5));
    } else {
      // вторая фаза попадания: урон засчитан (round2/03, конфликт 1). Тряски у стреляющего нет — вместо неё пауза.
      // Удар ульты (крупная ступень) — пауза цели 90 мс и вспышка 130 мс (сила вздрагивания ≥ 0,7, hitFreeze);
      // подтверждения у крупной ступени нет (убийство звучит kill), поэтому живой цели ульта отвечает hitHeavy
      const ult = tier === "large" && isUlt(ev.ability);
      const confirm = TIERS[tier].confirm ?? (ult && !ev.killed ? "hitHeavy" : null);
      const ms = hitstopMs(tier, ev.ability);
      out.push(
        { kind: "hitmarker", kill: ev.killed, air: ev.airborne, tier },
        { kind: "number", target: ev.target, amount: ev.amount, pos: ev.pos, dot: false, air: ev.airborne },
        { kind: "flash", target: ev.target },
        { kind: "flinch", target: ev.target, dir: ev.dir, amount: ult ? 0.8 : lmb ? 0.1 : 0.2 },
      );
      if (confirm) out.push(sound(confirm));
      if (ms > 0) out.push({ kind: "hitstop", ms });
    }
  }
  if (ev.target === view.localId && ev.source !== view.localId && overTime(ev) && beat) {
    // в потоке Дыхания: откуда жжёт и лёгкая тряска — на вспышке, не чаще 3 раз/с
    out.push(
      { kind: "indicator", from: { x: ev.pos.x - ev.dir.x, y: ev.pos.y - ev.dir.y, z: ev.pos.z - ev.dir.z }, amount: ev.amount },
      { kind: "trauma", amount: BREATH_VICTIM_TRAUMA, profile: "fire" },
    );
  }
  if (ev.target === view.localId && ev.source !== view.localId && !overTime(ev)) {
    // жертве — ступень самого удара, а не «крупная» за убийство: экран смерти и так всё скажет. Часть trauma уже
    // дало событие области (зона, взрыв, линия Разлома) — здесь только остаток
    const own: FeelTier = hitTier({ ...ev, killed: false });
    const k = tempo(ev.ability);
    const strike = own === "large" && ev.ability === "tectonicRift";
    const area = strike ? RIFT_NEAR_TRAUMA : ev.ability in AREA_TRAUMA ? AREA_TRAUMA[ev.ability as keyof typeof AREA_TRAUMA] : 0;
    const shake = Math.max(0, TIERS[own].trauma * k - area);
    if (shake > 0) out.push({ kind: "trauma", amount: shake, profile: elementOf(ev.ability) === "earth" ? "earth" : "fire" });
    out.push(
      hitKick(ev, me?.move.yaw ?? 0, TIERS[own].kickDeg * k),
      { kind: "indicator", from: { x: ev.pos.x - ev.dir.x, y: ev.pos.y - ev.dir.y, z: ev.pos.z - ev.dir.z }, amount: ev.amount },
      sound(HIT_SOUND[ev.ability]),
    );
    // удар ульты — крупная ступень: FOV +10° и «вжух» подброса; толчок видно и слышно (K3): от ≥ 4 м/с — FOV-удар и «вжух»
    if (own === "large" && isUlt(ev.ability)) out.push({ kind: "fov", deg: LARGE_FOV_DEG }, sound("knockWhoosh"));
    else if (ev.knock.distM >= KNOCK_FEEL_M) out.push({ kind: "fov", deg: 3 }, sound("knockWhoosh"));
  }
  return out;
}

function zoneEffects(ev: Extract<MatchEvent, { type: "zone" }>, view: EventView, me: Unit | undefined): Effect[] {
  if (ev.phase === "end") return [];
  const z: Zone | undefined = view.state.zones.find((q) => q.id === ev.zone);
  if (!z) return [];
  const at = zonePoint(z.shape);
  const near = (m: number): boolean => me !== undefined && me.alive && zoneDistance(z.shape, centre(me)) < m;
  if (ev.kind === "rift") return riftEffects(ev, z, view, me, near(4));
  if (ev.phase === "telegraph") {
    if (ev.kind === "pillar") return [burst("pillarCracks", at)];
    if (ev.kind === "fireWall") return [burst("fireWallSparks", at)];
    return [];
  }
  if (ev.kind === "pillar")
    return [
      burst("pillarBurst", at),
      sound("pillarStrike", at),
      ...(near(4) ? [{ kind: "trauma", amount: AREA_TRAUMA.stonePillar, profile: "earth" } as const] : []),
    ];
  if (ev.kind === "quake") {
    // всем на земле в радиусе; на галерее над ударом и в воздухе не трясёт (Р8)
    const r = z.shape.type === "disc" ? z.shape.radius : EARTH.earthquake.radiusM;
    const inside =
      me !== undefined && me.alive && me.move.onGround && Math.hypot(me.move.body.pos.x - at.x, me.move.body.pos.z - at.z) <= r &&
      Math.abs(me.move.body.pos.y - at.y) <= EARTH.earthquake.heightM;
    // кольцо задано в метрах (до 7 м): scale 1 — 120 частиц, основная масса во внешнем поясе (A3)
    const out: Effect[] = [burst("quakeRing", at, UP, 1), sound("quakeStrike", at)];
    // свой удар (A2): ладони бьют в землю — камера вниз, trauma 0,6 по профилю Земли; чужой — жертве 0,65
    if (ev.owner === view.localId) out.push(GROUND_SLAM, { kind: "trauma", amount: 0.6, profile: "earth" });
    else if (inside) out.push({ kind: "trauma", amount: AREA_TRAUMA.earthquake, profile: "earth" });
    return out;
  }
  if (ev.kind === "fireWall") return [burst("fireWallIgnite", at), sound("fireWallIgnite", at), ...(near(5) ? [{ kind: "trauma", amount: 0.15 } as const] : [])];
  return [];
}

/**
 * Тектонический разлом. Телеграф: пол лопается у ног мага (трещину по всей линии и бегущий фронт с пылью рисуют
 * декаль rift и ultVfx, гул — звук каста). Взвод: шипы по всей линии — всплески на каждые 5 м и удар riftStrike: своему —
 * у уха и крупная ступень по профилю Земли (вниз), чужому — из ближней точки линии; кто ближе 4 м к линии — тряска.
 */
function riftEffects(ev: Extract<MatchEvent, { type: "zone" }>, z: Zone, view: EventView, me: Unit | undefined, near: boolean): Effect[] {
  if (z.shape.type !== "segment") return [];
  const { a, b } = z.shape;
  if (ev.phase === "telegraph") return [burst("riftCrack", { ...a })];
  const out: Effect[] = [];
  for (let i = 0; i < RIFT_BURSTS; i++) {
    const t = (i + 0.5) / RIFT_BURSTS;
    out.push(burst("riftBurst", { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }));
  }
  if (ev.owner === view.localId) {
    out.push(
      sound("riftStrike"),
      { kind: "trauma", amount: TIERS.large.trauma, profile: "earth" },
      { kind: "kick", pitchDeg: -TIERS.large.kickDeg, yawDeg: 0, rollDeg: 0, dropM: 0.06 },
      { kind: "fov", deg: LARGE_FOV_DEG },
    );
    return out;
  }
  out.push(sound("riftStrike", me ? segmentPoint(a, b, centre(me)) : zonePoint(z.shape)));
  if (near) out.push({ kind: "trauma", amount: RIFT_NEAR_TRAUMA, profile: "earth" });
  return out;
}

/**
 * Событие матча → эффекты ощущения (round1/03, round2/03, GDD 5). Чистая функция: частицы, звук, камера, руки
 * и HUD исполняют результат сами. Мой каст отзывается на кадре нажатия; в эффектах каста gesture всегда раньше
 * palm — по нему интеграция узнаёт, какой рукой бьёт кулак. Чужой каст слышно там, где он кастует; чужой рывок —
 * пламя за его спиной, без моей камеры. Чужая ульта (каст X) — ещё и гул ultWarn без позиции, на всю карту.
 */
export function effectsFor(ev: MatchEvent, view: EventView): Effect[] {
  const fx = mapEvent(ev, view);
  // чужая ульта слышна на всю карту (GDD 2.2, Р5) — гул до эффектов стихии, они его не отменят; свою оформляет стихия
  return ev.type === "cast" && ev.slot === "x" && ev.unit !== view.localId ? [sound("ultWarn"), ...fx] : fx;
}

/** Событие → эффекты: сначала файл своей стихии (Воздух, Вода), потом общая карта. */
function mapEvent(ev: MatchEvent, view: EventView): Effect[] {
  const me = unitById(view.state, view.localId);
  // событие своей стихии (Воздух, Вода) — её файл; null — общая карта
  const own = elementEffects(ev, view, me);
  if (own) return own;
  const mine = (unit: UnitId): boolean => unit === view.localId;
  switch (ev.type) {
    case "cast": {
      // чужой каст: только звук в точке каста — без жестов, ладоней и толчка моей камеры
      if (!mine(ev.unit)) return [sound(CAST_SOUND[ev.ability], ev.pos)];
      const caster = unitById(view.state, ev.unit);
      const element = caster?.mage?.element ?? elementOf(ev.ability);
      const out: Effect[] = [
        { kind: "gesture", ability: ev.ability },
        {
          kind: "palm",
          hand: isFistGesture(ev.ability) ? "auto" : "both",
          element,
          // на вдохе Дыхания ладони разгораются: заряд, а не вспышка
          preset: ev.ability === "fireball" || ev.ability === "stoneShot" || ev.ability === "dragonBreath" ? "charge" : "flash",
        },
        sound(CAST_SOUND[ev.ability]),
        castKick(ev.ability),
      ];
      // камень вырывается из пола у ног
      if (ev.ability === "stoneShot" && caster) out.push(burst("stoneCrumble", { ...caster.move.body.pos }));
      // ладони Разлома бьют в пол: тряска по профилю Земли (удар шипов — крупная ступень на взводе)
      if (ev.ability === "tectonicRift") out.push({ kind: "trauma", amount: 0.2, profile: "earth" });
      return out;
    }
    case "release": {
      // такт «удар» (A1): выпуск звучит — у меня у уха, у чужого — там, где он бросил
      const id: SoundId | null = RELEASE_SOUND[ev.ability] ?? null;
      if (!mine(ev.unit)) return id ? [sound(id, ev.pos)] : [];
      if (ev.ability === "fireball")
        return [{ kind: "kick", pitchDeg: 1.5, yawDeg: 0, rollDeg: 0 }, { kind: "fov", deg: 3 }, { kind: "trauma", amount: 0.15 }, sound("fireballLaunch")];
      // pos выпуска — глаза: крошка сыплется у рук, впереди и ниже, а не в лицо (≈ 1,9 раза в секунду); отдача 0,6° — на броске
      if (ev.ability === "stoneShot")
        return [burst("stoneCrumble", releaseCrumblePoint(ev.pos, ev.dir)), { kind: "kick", pitchDeg: 0.6, yawDeg: 0, rollDeg: 0 }, sound("stoneThrow")];
      return id ? [sound(id)] : [];
    }
    case "impact": {
      // первая фаза попадания: снаряд врезался — видно и слышно в мире, хитмаркер ждёт события hit
      const stone = ev.ability === "stoneShot";
      const fx = IMPACT_FX[ev.ability] ?? IMPACT_FX.fireFists!;
      const preset: BurstPreset = ev.terrain >= 0 ? "terrainChips" : fx.burst;
      // пол громкости — только своему попаданию в цель, промах звучит по расстоянию
      const hit = ownSound(fx.sound, ev.pos, mine(ev.owner) && ev.target !== NOBODY);
      // Земле вместо света — белая бумажная вспышка (H3)
      return stone && ev.terrain < 0 ? [burst(preset, ev.pos, ev.normal), burst("paperFlash", ev.pos), hit] : [burst(preset, ev.pos, ev.normal), hit];
    }
    case "explosion": {
      const out: Effect[] = [burst("fireballBoom", ev.pos, UP, ev.radius / 3), ownSound("fireballBoom", ev.pos, mine(ev.owner))];
      if (me?.alive && dist(centre(me), ev.pos) < 5) out.push({ kind: "trauma", amount: AREA_TRAUMA.fireball });
      return out;
    }
    case "hit":
      return hitEffects(ev, view, me);
    case "zone":
      return zoneEffects(ev, view, me);
    case "terrain":
      if (ev.phase === "rise")
        return [burst("wallDust", ev.pos), ...(ev.kind === "wall" && mine(ev.owner) ? [{ kind: "trauma", amount: 0.2, profile: "earth" } as const] : [])];
      if (ev.phase === "hit") return [burst("terrainChips", ev.pos), sound("terrainHit", ev.pos)];
      if (ev.phase === "break") return [burst("terrainBreak", ev.pos), sound("terrainBreak", ev.pos)];
      if (ev.phase === "expire") return [burst("wallDust", ev.pos)];
      return [];
    case "dash": {
      // Взмах рисует Воздух (airFx); здесь — только Реактивный рывок
      if (ev.phase !== "start" || ev.ability !== "jetDash") return [];
      // пламя бьёт назад, за спину рывка
      const blast = burst("dashBlast", ev.pos, { x: -ev.dir.x + 0, y: -ev.dir.y + 0, z: -ev.dir.z + 0 });
      if (!mine(ev.unit)) return [blast];
      const r = rightXZ(me?.move.yaw ?? 0);
      const side = ev.dir.x * r.x + ev.dir.z * r.z;
      // крен в сторону рывка (вправо — по часовой, rotation.z < 0)
      // FOV-удар +8° с пиком в самом начале рывка (M3)
      return [{ kind: "fov", deg: 8 }, { kind: "kick", pitchDeg: 0, yawDeg: 0, rollDeg: -3 * side + 0 }, blast];
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
      const out: Effect[] = [burst(DEATH_BURST[element], ev.pos)];
      if (!mine(ev.killer)) return out;
      out.push(sound("kill"));
      // убийство ультой — тост с её именем
      const toast = ULT_KILL_TOAST[ev.ability];
      if (toast) out.push({ kind: "toast", text: toast });
      return out;
    }
    case "fall":
      return mine(ev.credit) ? [{ kind: "toast", text: "Сброс!" }, sound("fall")] : [];
    case "respawn":
      return [burst("respawnPuff", ev.pos)];
    case "status":
      // статусы HUD и частицы читают из состояния
      return [];
    case "ult":
      // заряд полон: своему — звон «готово», ячейку X толкает HUD по заряду
      if (ev.phase === "ready") return mine(ev.unit) ? [sound("ultReady")] : [];
      // выдох Дыхания: пламя срывается с рук (у чужого — у рта); своему — отдача, FOV +4° и тряска 0,3 на весь поток
      // (её держит ultFrame). Поток, рёв и конец — по ult.cast в состоянии; Разлом звучит из зоны; прочее — стихии
      if (ev.phase === "release" && ev.ability === "dragonBreath") {
        if (!mine(ev.unit)) return [burst("breathFlare", { x: ev.pos.x + ev.dir.x * 0.5, y: ev.pos.y + ev.dir.y * 0.5 - 0.12, z: ev.pos.z + ev.dir.z * 0.5 }, ev.dir)];
        return [
          burst("breathFlare", releaseCrumblePoint(ev.pos, ev.dir), ev.dir),
          { kind: "palm", hand: "both", element: "fire", preset: "flash" },
          { kind: "kick", pitchDeg: 1.2, yawDeg: 0, rollDeg: 0 },
          { kind: "fov", deg: BREATH_FOV_DEG },
          { kind: "trauma", amount: BREATH_TRAUMA },
        ];
      }
      return [];
    // события фазы 4 без общего отклика: их рисуют файлы стихий (elementEffects)
    case "beam":
    case "blown":
    case "slam":
    case "airJump":
    case "glide":
    case "charge":
    case "absorb":
    case "ward":
    case "tow":
    case "heal":
    case "reaction":
      return [];
  }
}

/** Куда слушателю звучит поток: ближняя к нему точка оси потока (от глаз мага на 12 м по взгляду). */
function breathEar(u: Unit, me: Unit | undefined): Vec3 {
  const e = eyeOf(u);
  if (!me) return e;
  const d = aimDir(u.move.yaw, u.move.pitch);
  const m = eyeOf(me);
  const k = clampTo((m.x - e.x) * d.x + (m.y - e.y) * d.y + (m.z - e.z) * d.z, 0, FIRE.dragonBreath.rangeM);
  return { x: e.x + d.x * k, y: e.y + d.y * k, z: e.z + d.z * k };
}

/**
 * Покадровое у ульт Огня и Земли — по ult.cast в состоянии, а не по событиям (каст может исчезнуть без ult/end):
 * вдох — свои ладони разгораются (заряд раз в 0,2 с); поток — зёрна рёва раз в 0,3 с на мага (своему у уха, чужое — из
 * ближней точки потока), у своего — вспышка ладоней на зерне и тряска, которую кадр доливает ровно на её спад.
 */
export function createUltFrame(): (f: FrameView) => Effect[] {
  const roarAt = new Map<UnitId, number>();
  const seen = new Set<UnitId>();
  /** Свой вдох: какой каст (startTick) и когда ладони разгорались последний раз. */
  let inhaleCast = -1;
  let inhaleAt = 0;
  return (f) => {
    const out: Effect[] = [];
    const s = f.cur;
    const me = unitById(s, f.localId);
    seen.clear();
    for (const u of s.units) {
      const c = u.mage?.ult.cast;
      if (!u.alive || !c || c.ability !== "dragonBreath") continue;
      const own = u.id === f.localId;
      if (s.tick < c.releaseTick) {
        if (!own) continue;
        // первый кадр вдоха — заряд у рук уже дал каст; дальше раз в 0,2 с
        if (inhaleCast !== c.startTick) {
          inhaleCast = c.startTick;
          inhaleAt = f.nowS;
        } else if (f.nowS - inhaleAt >= INHALE_PALM_S || f.nowS < inhaleAt) {
          inhaleAt = f.nowS;
          out.push({ kind: "palm", hand: "both", element: "fire", preset: "charge" });
        }
        continue;
      }
      if (!breathStreaming(c, s.tick)) continue;
      seen.add(u.id);
      if (own) out.push({ kind: "trauma", amount: SHAKE.decayPerS * Math.max(0, f.dtS) });
      const last = roarAt.get(u.id);
      if (last === undefined || f.nowS - last >= ROAR_GRAIN_S || f.nowS < last) {
        roarAt.set(u.id, f.nowS);
        if (own) out.push(sound("breathRoar", null, 0.8), { kind: "palm", hand: "both", element: "fire", preset: "flash" });
        else out.push(sound("breathRoar", breathEar(u, me)));
      }
    }
    for (const id of roarAt.keys()) if (!seen.has(id)) roarAt.delete(id);
    return out;
  };
}

/** Раз в кадр: непрерывное у ульт Огня и Земли (зовёт elementFrameEffects). */
export const ultFrame: (f: FrameView) => Effect[] = createUltFrame();
