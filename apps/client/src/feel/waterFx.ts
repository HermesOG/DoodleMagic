import {
  NOBODY,
  TICK_HZ,
  WATER,
  forwardXZ,
  unitById,
  type AbilityId,
  type MatchEvent,
  type MatchState,
  type ProjectileKind,
  type Unit,
  type UnitId,
  type Vec3,
  type Zone,
} from "@doodlemagic/sim";
import type { BurstPreset, Effect, SoundId } from "./effects";
import type { FrameView } from "./elementFx";
import type { EventView } from "./eventMap";

/*
 * Ощущение Воды (03-water, «Читается»): события Воды → эффекты и покадровые зёрна журчания Родника.
 * Чистые функции, как общая карта: частицы, звук, камеру, руки и HUD исполняют результат сами.
 * Попадание (hit), смерть и статусы остаются общей карте: хитмаркер, цифры и отклик жертвы там одни на все стихии.
 *
 * Ульта «Цунами» (фаза 5): каст — шум роста 0,8 с, руки черпают снизу и поднимают волну; зона tsunami встаёт —
 * вода бьёт из-под пола; выпуск (ult/release) — толчок обеими, у себя — крупная ступень. Ход волны — по состоянию
 * (waterFrame): рокот зёрнами в гребне и всплеск с ударом на каждом, кого волна записала в rehit; гребень рисует
 * waterVfx. Смерть от Цунами — с тостом убийце. Гул ultWarn чужой ульты добавляет общая карта (effectsFor).
 */

const UP: Vec3 = { x: 0, y: 1, z: 0 };
/** Крупная ступень у кастующего ульту (round3/01, 2.1; TIERS.large общей карты): trauma 0,8, толчок 2°, FOV +10°. */
const ULT_CASTER = { trauma: 0.8, kickDeg: 2, fovDeg: 10 } as const;
/** Зерно рокота хода Цунами: раз в 0,4 с, длина 0,5 с (Р15). */
export const ROLL_GRAIN_S = 0.4;
/** Рокот и всплеск — у гребня, на середине его высоты (2,5 м / 2). */
const CREST_MID_M = WATER.tsunami.heightM / 2;
const WATER_ABILITIES: readonly AbilityId[] = ["waterWhip", "waterGrab", "waterWard", "spring"];
const isWater = (a: AbilityId): boolean => WATER_ABILITIES.includes(a);
/** Своё попадание слышно не тише этого и издалека (как OWN_HIT_FLOOR общей карты, round3/01 H3). */
const OWN_HIT_FLOOR = 0.6;
/** Зерно журчания Родника: раз в 0,6 с, длина 0,5 с (Р15). */
export const SPRING_GRAIN_S = 0.6;
/** Впитанное, с которого звон впитывания идёт тоном выше: средний и высокий (Ответ 20…60). */
export const ABSORB_TONE_AT = { mid: 25, high: 45 } as const;
/** Огненные снаряды гаснут на диске с шипением (только вид). */
const FIERY: readonly ProjectileKind[] = ["fireFists", "fireball"];
/** Импульс лечения Родника — 0,25 с (15 тиков); свой звон — на первом импульсе подряд и потом не чаще раза в 1 с. */
const HEAL_PULSE_TICKS = Math.round(WATER.spring.healPulseS * TICK_HZ);
export const HEAL_CHIME_TICKS = TICK_HZ;

const sound = (id: SoundId, pos: Vec3 | null = null, gain = 1): Effect => ({ kind: "sound", id, pos, gain });
/** Своё — у уха, чужое — в точке мира. */
const at = (id: SoundId, pos: Vec3, own: boolean, gain = 1): Effect => sound(id, own ? null : pos, gain);
/** Попадание в мире; своё — не тише OWN_HIT_FLOOR и издалека. */
const hitSound = (id: SoundId, pos: Vec3, own: boolean): Effect => (own ? { kind: "sound", id, pos, gain: 1, floor: OWN_HIT_FLOOR } : sound(id, pos));
const burst = (preset: BurstPreset, pos: Vec3, dir: Vec3 = UP, scale = 1): Effect => ({ kind: "burst", preset, pos, dir, scale });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unitDir = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 1e-6 ? { x: v.x / l, y: v.y / l, z: v.z / l } : UP;
};
/** Середина диска Отражения в мире: 0,9 м перед Водой по взгляду, на высоте груди (как его рисует waterVfx). */
export function wardCentre(u: Unit): Vec3 {
  const f = forwardXZ(u.move.yaw);
  return { x: u.move.body.pos.x + f.x * 0.9, y: u.move.body.pos.y + 1.2, z: u.move.body.pos.z + f.z * 0.9 };
}
/** Звон впитывания по сумме впитанного: чем больше, тем выше. */
export function absorbSound(total: number): SoundId {
  return total >= ABSORB_TONE_AT.high ? "wardAbsorbHigh" : total >= ABSORB_TONE_AT.mid ? "wardAbsorbMid" : "wardAbsorb";
}

/**
 * Звук каста — у меня у уха, у чужого — там, где он кастует (как у всех стихий): хлыст — тихий «вжик» замаха (щелчок
 * придёт с дугой), Хват — нарастающий «вшух», Отражение — «водяной колокол», Родник — разлив.
 */
const CAST_SOUND: Readonly<Record<"waterWhip" | "waterGrab" | "waterWard" | "spring", SoundId>> = {
  waterWhip: "whipSwish", waterGrab: "grabWindup", waterWard: "wardUp", spring: "springSpread",
};

/** Мой каст Воды: жест, ладонь, звук, отдача. */
function ownCast(a: keyof typeof CAST_SOUND): Effect[] {
  const hand = a === "waterWhip" || a === "waterGrab" ? "right" : "both";
  const out: Effect[] = [{ kind: "gesture", ability: a }, { kind: "palm", hand, element: "water", preset: "flash" }, sound(CAST_SOUND[a])];
  // ЛКМ — 0,2° (малая ступень); Родник — ладони вниз, к луже; остальное — 0,6°
  if (a === "spring") out.push({ kind: "kick", pitchDeg: -0.8, yawDeg: 0, rollDeg: 0, dropM: 0.02 });
  else out.push({ kind: "kick", pitchDeg: a === "waterWhip" ? 0.2 : 0.6, yawDeg: 0, rollDeg: 0 });
  return out;
}

/** Память своего звона лечения: тик прошлого импульса и прошлого звона. */
interface HealChime { pulse: number; chime: number }

/**
 * Звенеть ли своему импульсу лечения на тике tick: первый импульс подряд (прошлый был дальше одного шага — вышла
 * из лужи или HP было полным; или время пошло назад) звенит всегда, дальше — не чаще раза в HEAL_CHIME_TICKS.
 */
function healChime(m: HealChime, tick: number): boolean {
  const first = tick < m.pulse || tick - m.pulse > HEAL_PULSE_TICKS;
  m.pulse = tick;
  if (!first && tick - m.chime < HEAL_CHIME_TICKS) return false;
  m.chime = tick;
  return true;
}

/** Событие Воды → эффекты со своей памятью (звон лечения); null — не Воды (дальше общая карта). */
export function createWaterEffects(): (ev: MatchEvent, view: EventView, me: Unit | undefined) => Effect[] | null {
  const heal: HealChime = { pulse: -Infinity, chime: -Infinity };
  return (ev, view, me) => waterEffectsWith(heal, ev, view, me);
}

function waterEffectsWith(healMem: HealChime, ev: MatchEvent, view: EventView, _me: Unit | undefined): Effect[] | null {
  const mine = (id: UnitId): boolean => id === view.localId;
  switch (ev.type) {
    case "cast": {
      if (ev.ability === "tsunami")
        // рост волны: у себя — жест, ладони, шум у уха и ладони вниз, к воде; чужой — шум в точке каста
        return mine(ev.unit)
          ? [
              { kind: "gesture", ability: "tsunami" },
              { kind: "palm", hand: "both", element: "water", preset: "flash" },
              sound("tsunamiRise"),
              { kind: "kick", pitchDeg: -0.8, yawDeg: 0, rollDeg: 0, dropM: 0.03 },
            ]
          : [sound("tsunamiRise", ev.pos)];
      if (!isWater(ev.ability)) return null;
      const a = ev.ability as keyof typeof CAST_SOUND;
      // чужой каст: только звук в точке каста — без жестов, ладоней и толчка моей камеры
      return mine(ev.unit) ? ownCast(a) : [sound(CAST_SOUND[a], ev.pos)];
    }
    case "release":
      if (!isWater(ev.ability)) return null;
      if (ev.ability === "waterGrab")
        return mine(ev.unit) ? [sound("grabThrow"), { kind: "kick", pitchDeg: 0.8, yawDeg: 0, rollDeg: 0 }] : [sound("grabThrow", ev.pos)];
      // у Отражения выпуск — это Ответ
      if (ev.ability === "waterWard")
        return mine(ev.unit)
          ? [sound("answerThrow"), { kind: "kick", pitchDeg: 1, yawDeg: 0, rollDeg: 0 }, { kind: "fov", deg: 2 }]
          : [sound("answerThrow", ev.pos)];
      // хлыст: щелчок и дуга — по beam того же тика
      return [];
    case "beam": {
      if (ev.ability !== "waterWhip") return null;
      const own = mine(ev.unit);
      // whipArc: pos — конец дуги, dir — вектор от конца к глазам кастующего (не единичный), owner — кто бьёт: по нему
      // waterVfx находит руку, из которой рисовать дугу; общий пул нормирует dir и бросает капли к Воде
      const arc: Effect = { kind: "burst", preset: "whipArc", pos: ev.to, dir: sub(ev.from, ev.to), scale: 1, owner: ev.unit };
      const out: Effect[] = [arc, at("whipCrack", ev.from, own)];
      if (ev.target !== NOBODY) out.push(burst("whipSplash", ev.to, unitDir(sub(ev.from, ev.to))), hitSound("whipHit", ev.to, own));
      return out;
    }
    case "impact": {
      if (ev.ability !== "waterGrab" && ev.ability !== "waterWard") return null;
      const grab = ev.ability === "waterGrab";
      const hit = ev.target !== NOBODY;
      return [
        burst(grab ? "grabSplash" : "answerSplash", ev.pos, ev.normal, hit ? 1 : 0.6),
        hitSound(grab ? "grabHit" : "answerHit", ev.pos, mine(ev.owner) && hit),
      ];
    }
    case "absorb": {
      const own = mine(ev.unit);
      const out: Effect[] = [burst("wardAbsorb", ev.pos, UP, 0.8), at(absorbSound(ev.total), ev.pos, own)];
      // огненное гаснет на воде с шипением — только вид, не реакция «Пар»
      if (FIERY.includes(ev.kind)) out.push(burst("steamPuff", ev.pos, UP, 0.5), sound("steamHiss", ev.pos, 0.6));
      return out;
    }
    case "ward": {
      // колокол диска звучит кастом того же тика (CAST_SOUND)
      if (ev.phase === "up") return [];
      const u = unitById(view.state, ev.unit);
      if (!u) return [];
      const own = mine(ev.unit);
      // диск обрушивается: чем больше впитал, тем больше воды
      const c = wardCentre(u);
      return [burst("wardBurst", c, UP, 0.6 + Math.min(60, ev.absorbed) / 60), at("wardDown", c, own)];
    }
    case "tow":
      if (ev.phase === "start") {
        // тащат меня или тащу я — у уха; иначе — у цели
        const ear = mine(ev.target) || mine(ev.source);
        return [at("towPull", ev.pos, ear, mine(ev.source) ? 0.8 : 1)];
      }
      return [burst("grabSplash", ev.pos, UP, 0.5)];
    case "heal":
      // лечение без источника — сфера жизни на карте (фаза 6): её звон и искры — у объектов карты, не у Воды
      if (ev.source === NOBODY) return null;
      // своё лечение — искры сходятся к ладоням (каждый импульс) и мягкий звон (первый и раз в секунду); чужое — искры у тела
      if (mine(ev.target)) {
        const palm: Effect = { kind: "palm", hand: "both", element: "water", preset: "charge" };
        return healChime(healMem, view.state.tick) ? [palm, sound("heal", null, 0.45)] : [palm];
      }
      return [burst("healMotes", ev.pos, UP, 0.6)];
    case "zone": {
      if (ev.kind === "steam") return [];
      if (ev.kind === "tsunami") {
        // волна встаёт за спиной Воды: вода бьёт из-под пола посередине; дальше гребень, рокот и всплески — по состоянию
        if (ev.phase !== "telegraph") return [];
        const z = view.state.zones.find((q) => q.id === ev.zone);
        if (!z || z.shape.type !== "segment") return [];
        const { a, b } = z.shape;
        return [burst("tsunamiSurge", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 })];
      }
      if (ev.kind !== "spring") return null;
      if (ev.phase !== "telegraph") return [];
      const z = view.state.zones.find((q) => q.id === ev.zone);
      if (!z || z.shape.type !== "disc") return [];
      const c = z.shape.center;
      // разлив звучит кастом у кастующего; у самой лужи — первое журчание, по нему слышно, где она
      return [burst("springRing", c, UP, 1), sound("springBubble", c)];
    }
    case "reaction": {
      if (ev.kind === "bog") {
        // «Топь»: кольцо землетрясения и тёмная муть по луже; звук — удар и бульканье в точке
        const out: Effect[] = [burst("quakeRing", ev.pos, UP, 0.6), burst("bogMuck", ev.pos), sound("quakeStrike", ev.pos, 0.7), sound("springBubble", ev.pos)];
        if (mine(ev.owner)) out.push({ kind: "toast", text: "Топь!" });
        return out;
      }
      if (ev.kind === "boilOff") {
        // «Выкипание»: лужа вскипает — кольцо Родника и густой клуб пара во все 4 м; шипение в точке
        const out: Effect[] = [burst("springRing", ev.pos, UP, 0.6), burst("steamPuff", ev.pos, UP, 2), sound("steamHiss", ev.pos), sound("springBubble", ev.pos, 0.6)];
        if (mine(ev.owner)) out.push({ kind: "toast", text: "Выкипание!" });
        return out;
      }
      if (ev.kind !== "steam") return null;
      const out: Effect[] = [burst("steamPuff", ev.pos, UP, 1.3), sound("steamHiss", ev.pos)];
      if (mine(ev.owner)) out.push({ kind: "toast", text: "Пар!" });
      return out;
    }
    case "ult":
      // «заряд полон» — общий звук (общая карта); выпуск — волна покатилась: у себя толчок обеими и крупная ступень,
      // у чужой её видно и слышно по гребню; конец каста — на следующем тике, волна живёт своей зоной
      if (ev.ability !== "tsunami" || ev.phase === "ready") return null;
      if (ev.phase !== "release" || !mine(ev.unit)) return [];
      return [
        { kind: "palm", hand: "both", element: "water", preset: "flash" },
        { kind: "trauma", amount: ULT_CASTER.trauma },
        { kind: "kick", pitchDeg: ULT_CASTER.kickDeg, yawDeg: 0, rollDeg: 0 },
        { kind: "fov", deg: ULT_CASTER.fovDeg },
      ];
    case "death":
      // смерть от Цунами — как в общей карте (брызги по стихии убийцы, «kill» убийце) и тост убийце
      if (ev.ability !== "tsunami") return null;
      return mine(ev.killer) ? [burst("deathWater", ev.pos), sound("kill"), { kind: "toast", text: "Цунами!" }] : [burst("deathWater", ev.pos)];
    default:
      return null;
  }
}

/** Событие Воды → эффекты; null — не Воды (дальше общая карта). Один на клиент: звон лечения помнит прошлый. */
export const waterEffects = createWaterEffects();

/** Перешли ли часы кадра границу зерна длины step со сдвигом ph за этот кадр (не чаще раза в step). */
const grainDue = (f: FrameView, step: number, ph: number): boolean => Math.floor((f.nowS + ph) / step) > Math.floor((f.nowS - f.dtS + ph) / step);

/**
 * Середина гребня Цунами между тиками: середина отрезка зоны, линейно от prev к cur по alpha (как его рисует waterVfx),
 * на высоте половины гребня. Зоны нет в prev — как в cur.
 */
export function crestMid(prev: MatchState, z: Zone, alpha: number): Vec3 | null {
  if (z.shape.type !== "segment") return null;
  const s = z.shape;
  let ps = s;
  for (const q of prev.zones) if (q.id === z.id && q.shape.type === "segment") ps = q.shape;
  const mx = (s.a.x + s.b.x) / 2;
  const mz = (s.a.z + s.b.z) / 2;
  const px = (ps.a.x + ps.b.x) / 2;
  const pz = (ps.a.z + ps.b.z) / 2;
  return { x: px + (mx - px) * alpha, y: s.a.y + CREST_MID_M, z: pz + (mz - pz) * alpha };
}

/**
 * Покадровые эффекты Воды со своей памятью:
 * - журчание Родника зёрнами (Р15) — раз в SPRING_GRAIN_S у каждой взведённой лужи, в её центре; фаза — от id зоны,
 *   две лужи не журчат в такт;
 * - рокот хода Цунами — зерно tsunamiRoll раз в ROLL_GRAIN_S в середине гребня, от взвода до конца зоны;
 * - удар волны — по состоянию: новая запись rehit зоны tsunami (волна задела юнита) даёт всплеск tsunamiSplash и
 *   tsunamiHit на нём: задетому — у уха, хозяйке волны — не тише OWN_HIT_FLOOR, прочим — в точке. Записи, что уже
 *   были у зоны, когда кадр увидел её впервые (подключился посреди волны), молчат.
 */
export function createWaterFrame(): (f: FrameView) => Effect[] {
  /** Кого волна уже задела (по зоне): им всплеск уже был. */
  const splashed = new Map<number, UnitId[]>();
  const live = new Set<number>();
  return (f) => {
    let out: Effect[] | null = null;
    live.clear();
    for (const z of f.cur.zones) {
      if (z.kind === "spring") {
        if (z.shape.type !== "disc" || f.cur.tick < z.armTick || f.cur.tick >= z.endTick) continue;
        if (!grainDue(f, SPRING_GRAIN_S, (z.id * 0.37) % SPRING_GRAIN_S)) continue;
        (out ??= []).push(sound("springBubble", z.shape.center, z.owner === f.localId ? 0.5 : 0.6));
        continue;
      }
      if (z.kind !== "tsunami" || z.shape.type !== "segment") continue;
      live.add(z.id);
      if (f.cur.tick >= z.armTick && f.cur.tick < z.endTick && grainDue(f, ROLL_GRAIN_S, (z.id * 0.29) % ROLL_GRAIN_S))
        (out ??= []).push(sound("tsunamiRoll", crestMid(f.prev, z, f.alpha)));
      const seen = splashed.get(z.id);
      if (!seen) {
        splashed.set(z.id, z.rehit.map((r) => r.unit));
        continue;
      }
      for (const r of z.rehit) {
        if (seen.includes(r.unit)) continue;
        seen.push(r.unit);
        const v = unitById(f.cur, r.unit);
        if (!v) continue;
        const b = v.move.body;
        const at = { x: b.pos.x, y: b.pos.y + b.height / 2, z: b.pos.z };
        // всплеск — по ходу волны и вверх: ход d = (n.z, −n.x), n — вдоль гребня
        const n = unitDir({ x: z.shape.b.x - z.shape.a.x, y: 0, z: z.shape.b.z - z.shape.a.z });
        (out ??= []).push(
          burst("tsunamiSplash", at, unitDir({ x: n.z, y: 0.8, z: -n.x })),
          r.unit === f.localId ? sound("tsunamiHit") : hitSound("tsunamiHit", at, z.owner === f.localId),
        );
      }
    }
    for (const id of splashed.keys()) if (!live.has(id)) splashed.delete(id);
    return out ?? [];
  };
}

/** Раз в кадр: непрерывные звуки Воды (журчание Родника, рокот Цунами) и удары волны. Один на клиент. */
export const waterFrame: (f: FrameView) => Effect[] = createWaterFrame();
