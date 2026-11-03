import {
  ABILITY_OF,
  EARTH,
  NOBODY,
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
import type { BurstPreset, Effect, FeelTier, SoundId } from "./effects";

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
/** Ступень попадания: урон по времени — нет; ЛКМ — малая; остальное — средняя; убийство — крупная. */
export function hitTier(ev: Pick<Extract<MatchEvent, { type: "hit" }>, "ability" | "dot" | "killed">): FeelTier {
  if (ev.killed) return "large";
  if (ev.dot || ev.ability === "jetDash" || ev.ability === "burning") return "none";
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

/** Звук каста у слушателя: предвосхищение или выпуск (round2/03, п. 4.2). */
const CAST_SOUND: Readonly<Record<AbilityId, SoundId>> = {
  fireFists: "fireFist", fireball: "fireballCharge", jetDash: "dash", fireWall: "fireWallTelegraph",
  stoneShot: "stoneCast", stonePillar: "pillarTelegraph", stoneWall: "wallRise", earthquake: "quakeWindup",
};
/**
 * Отдача камеры у кастующего на нажатии, градусы: кулаки и камень 0,2° (у камня ещё 0,6° на броске, A1), ладони в
 * землю — вниз (GROUND_SLAM, A2), замах землетрясения — 0 (удар вниз придёт с ударом), остальное 1°.
 */
const castKick = (a: AbilityId): Effect =>
  a === "stonePillar" || a === "stoneWall"
    ? GROUND_SLAM
    : { kind: "kick", pitchDeg: a === "fireFists" || a === "stoneShot" ? 0.2 : a === "earthquake" ? 0 : 1, yawDeg: 0, rollDeg: 0 };
/** Чем попали в меня — глухой удар плюс отпечаток стихии (round1/03, п. 3); у кулака свой треск попадания (H3). */
const HIT_SOUND: Readonly<Record<DamageSource, SoundId>> = {
  fireFists: "fistHit", fireball: "fireballBoom", jetDash: "fireWallIgnite", fireWall: "fireWallIgnite", burning: "fireWallIgnite",
  stoneShot: "stoneImpact", stonePillar: "pillarStrike", stoneWall: "terrainHit", earthquake: "quakeStrike",
};

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
  if (s.type === "segment") {
    const ab = { x: s.b.x - s.a.x, y: s.b.y - s.a.y, z: s.b.z - s.a.z };
    const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    const u = len2 > 0 ? clampTo(((p.x - s.a.x) * ab.x + (p.y - s.a.y) * ab.y + (p.z - s.a.z) * ab.z) / len2, 0, 1) : 0;
    return dist(p, { x: s.a.x + ab.x * u, y: s.a.y + ab.y * u, z: s.a.z + ab.z * u });
  }
  return dist(p, s.center);
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
  if (ev.source === view.localId && ev.target !== view.localId) {
    if (overTime(ev)) {
      out.push({ kind: "number", target: ev.target, amount: ev.amount, pos: ev.pos, dot: true, air: ev.airborne });
      // добил горением или следом — убийство всё равно отмечается
      if (ev.killed) out.push({ kind: "hitmarker", kill: true, air: ev.airborne, tier: "large" });
    } else {
      // вторая фаза попадания: урон засчитан (round2/03, конфликт 1). Тряски у стреляющего нет — вместо неё пауза
      const confirm = TIERS[tier].confirm;
      const ms = hitstopMs(tier, ev.ability);
      out.push(
        { kind: "hitmarker", kill: ev.killed, air: ev.airborne, tier },
        { kind: "number", target: ev.target, amount: ev.amount, pos: ev.pos, dot: false, air: ev.airborne },
        { kind: "flash", target: ev.target },
        { kind: "flinch", target: ev.target, dir: ev.dir, amount: lmb ? 0.1 : 0.2 },
      );
      if (confirm) out.push(sound(confirm));
      if (ms > 0) out.push({ kind: "hitstop", ms });
    }
  }
  if (ev.target === view.localId && ev.source !== view.localId && !overTime(ev)) {
    // жертве — ступень самого удара, а не «крупная» за убийство: экран смерти и так всё скажет. Часть trauma уже
    // дало событие области (зона, взрыв) — здесь только остаток
    const own: FeelTier = lmb ? "small" : "medium";
    const k = tempo(ev.ability);
    const area = ev.ability in AREA_TRAUMA ? AREA_TRAUMA[ev.ability as keyof typeof AREA_TRAUMA] : 0;
    const shake = Math.max(0, TIERS[own].trauma * k - area);
    if (shake > 0) out.push({ kind: "trauma", amount: shake, profile: elementOf(ev.ability) === "earth" ? "earth" : "fire" });
    out.push(
      hitKick(ev, me?.move.yaw ?? 0, TIERS[own].kickDeg * k),
      { kind: "indicator", from: { x: ev.pos.x - ev.dir.x, y: ev.pos.y - ev.dir.y, z: ev.pos.z - ev.dir.z }, amount: ev.amount },
      sound(HIT_SOUND[ev.ability]),
    );
    // толчок видно и слышно (K3): от ≥ 4 м/с — FOV-удар и «вжух»
    if (ev.knock.distM >= KNOCK_FEEL_M) out.push({ kind: "fov", deg: 3 }, sound("knockWhoosh"));
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
 * Событие матча → эффекты ощущения (round1/03, round2/03, GDD 5). Чистая функция: частицы, звук, камера, руки
 * и HUD исполняют результат сами. Мой каст отзывается на кадре нажатия; в эффектах каста gesture всегда раньше
 * palm — по нему интеграция узнаёт, какой рукой бьёт кулак. Чужой каст слышно там, где он кастует; чужой рывок —
 * пламя за его спиной, без моей камеры.
 */
export function effectsFor(ev: MatchEvent, view: EventView): Effect[] {
  const me = unitById(view.state, view.localId);
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
          hand: ev.ability === "fireFists" ? "auto" : "both",
          element,
          preset: ev.ability === "fireball" || ev.ability === "stoneShot" ? "charge" : "flash",
        },
        sound(CAST_SOUND[ev.ability]),
        castKick(ev.ability),
      ];
      // камень вырывается из пола у ног
      if (ev.ability === "stoneShot" && caster) out.push(burst("stoneCrumble", { ...caster.move.body.pos }));
      return out;
    }
    case "release": {
      // такт «удар» (A1): выпуск звучит — у меня у уха, у чужого — там, где он бросил
      const id: SoundId | null = ev.ability === "fireball" ? "fireballLaunch" : ev.ability === "stoneShot" ? "stoneThrow" : null;
      if (!mine(ev.unit)) return id ? [sound(id, ev.pos)] : [];
      if (ev.ability === "fireball")
        return [{ kind: "kick", pitchDeg: 1.5, yawDeg: 0, rollDeg: 0 }, { kind: "fov", deg: 3 }, { kind: "trauma", amount: 0.15 }, sound("fireballLaunch")];
      // pos выпуска — глаза: крошка сыплется у рук, впереди и ниже, а не в лицо (≈ 1,9 раза в секунду); отдача 0,6° — на броске
      if (ev.ability === "stoneShot")
        return [burst("stoneCrumble", releaseCrumblePoint(ev.pos, ev.dir)), { kind: "kick", pitchDeg: 0.6, yawDeg: 0, rollDeg: 0 }, sound("stoneThrow")];
      return [];
    }
    case "impact": {
      // первая фаза попадания: снаряд врезался — видно и слышно в мире, хитмаркер ждёт события hit
      const stone = ev.ability === "stoneShot";
      const preset: BurstPreset = ev.terrain >= 0 ? "terrainChips" : stone ? "stoneImpact" : "fistImpact";
      // пол громкости — только своему попаданию в цель, промах звучит по расстоянию
      const hit = ownSound(stone ? "stoneImpact" : "fistHit", ev.pos, mine(ev.owner) && ev.target !== NOBODY);
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
      if (ev.phase !== "start") return [];
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
