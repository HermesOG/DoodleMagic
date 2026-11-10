import { AIR, EARTH, FIRE } from "../match/defs";
import { eyeOf } from "../match/state";
import type { AbilityId, Element, MatchContext, MatchState, Unit, UnitId, UltId, Zone, ZoneKind } from "../match/types";
import { forwardXZ } from "../player";
import { lineOfSight } from "../raycast";
import type { Vec3 } from "../types";
import type { World } from "../world";
import { voidDistM, type NavGrid } from "./nav";
import { BOT_RULES, type BotLevel, type BotParams, type BotTrait } from "./params";

/**
 * Восприятие бота (Р2, Р3): что он видит и слышит на мысли, и какие угрозы ему грозят. Всё — простые данные: снимки
 * кладутся в память бота, решения берут снимок не моложе реакции. Функции чистые: состояние не меняют.
 */

/** Видимые состояния мага в снимке — биты. */
export const SEEN_WARD = 1;
export const SEEN_DASH = 2;
export const SEEN_OVERHEAT = 4;
export const SEEN_FURY = 8;
export const SEEN_AIRBORNE = 16;
export const SEEN_ROOTED = 32;
export const SEEN_SHIELD = 64;
export const SEEN_GLIDE = 128;

/** Маг в снимке: что видно глазами (Р2). */
export interface SeenMage {
  id: UnitId; element: Element;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  hp: number; maxHp: number; flags: number;
  /** Видимый замах и идущая ульта. */
  windup: AbilityId | null; ult: UltId | null;
}
/** Услышанный маг (Р2): точка ±2 м, без прицела. */
export interface HeardMage { id: UnitId; x: number; y: number; z: number }
/** Снимок мысли: тик и кого бот увидел и услышал. */
export interface Glimpse { tick: number; seen: SeenMage[]; heard: HeardMage[] }

/** Маг, каким его знает бот (память по запаздывающему восприятию). Так его видит кит стихии. */
export interface Perceived {
  readonly id: UnitId;
  readonly element: Element;
  /** Тик снимка, по которому известен маг. */
  readonly tick: number;
  /** Был в последнем воспринятом снимке. */
  readonly visible: boolean;
  /** Известен только по слуху: позиция приблизительна, HP и скорость — старые. */
  readonly heard: boolean;
  readonly pos: Vec3;
  readonly vel: Vec3;
  readonly hp: number;
  readonly maxHp: number;
  /** От бота до pos по XZ, м. */
  readonly dist: number;
  /** До кромки от pos, м. */
  readonly voidM: number;
  readonly ward: boolean; readonly dash: boolean; readonly overheat: boolean; readonly fury: boolean;
  readonly airborne: boolean; readonly rooted: boolean; readonly shielded: boolean; readonly gliding: boolean;
  readonly windup: AbilityId | null;
  readonly ult: UltId | null;
}

export type ThreatKind = "zone" | "projectile" | "windup" | "ult";
/** От чего уворот (Р4): телеграф (зона, замах, ульта), снаряд Q, опасная зона под ногами (уходит всегда). */
export type DodgeClass = "telegraph" | "projectile" | "hazard";

/** Угроза боту на этом тике: геометрия посчитана по его телу. */
export interface Threat {
  /** Ключ: id зоны или снаряда; замах и ульта — отрицательный от id мага и тика выпуска. */
  readonly key: number;
  readonly kind: ThreatKind;
  readonly cls: DodgeClass;
  readonly ability: AbilityId;
  readonly owner: UnitId;
  /** Тик появления: от него идёт реакция. */
  readonly born: number;
  /** Через сколько секунд ударит; 0 — уже бьёт. */
  readonly etaS: number;
  /** Бот в зоне поражения. */
  readonly inside: boolean;
  /** Где угроза: центр зоны, снаряд, кастующий. */
  readonly from: Vec3;
  /** Куда уходить: единичный XZ (сторона с большим запасом до кромки при равных) или null. */
  readonly escape: { x: number; z: number } | null;
  /** Тики, в которые нажатие прыжка спасает от удара по стоящим (землетрясение, разлом, столб); null — не спасает. */
  readonly jumpFrom: number | null;
  readonly jumpTo: number | null;
}

/**
 * План каста от кита (задача 2): мозг ждёт задержку уровня (Р4, кроме urgent), ведёт взгляд и жмёт слот на один тик.
 * slot null — только прыжок и ход на тике нажатия (второй прыжок над пустотой).
 */
export interface CastPlan {
  readonly slot: "q" | "e" | "c" | "x" | null;
  /** Куда смотреть при нажатии; null — взгляд не важен. */
  readonly aim: Vec3 | null;
  /**
   * Вести взгляд за магом вместо aim: его воспринятая позиция + dy над ступнями, с упреждением уровня по снаряду
   * (скорость, гравитация, замах; без скорости — без полёта, как у мгновенного удара).
   */
  readonly track?: { readonly id: UnitId; readonly dy: number; readonly speed?: number; readonly gravity?: number; readonly windupS?: number } | null;
  /**
   * Ход на тике нажатия (рывок, Взмах): направление по XZ; нет — как идёт бот. Фильтр края его не трогает: приземление
   * с запасом 1,5 м (Р9) проверяет кит — dashLandingOk.
   */
  readonly move?: { readonly x: number; readonly z: number } | null;
  /** Нажать и прыжок на тике нажатия. */
  readonly jump?: boolean;
  /** Допуск взгляда, градусы (по умолчанию BOT_RULES.castTolDeg). */
  readonly tolDeg?: number;
  /** Сколько план живёт после задержки, с (по умолчанию BOT_RULES.planTtlS). */
  readonly ttlS?: number;
  /** Без задержки уровня: спасение, уворот, ульта. */
  readonly urgent?: boolean;
}

/** Что бот знает на мысли — вход кита стихии (задача 2). */
export interface BotView {
  readonly now: number;
  readonly state: Readonly<MatchState>;
  /** Мир тика: статика, рельеф Земли, Стены огня, пар. */
  readonly world: World;
  readonly nav: NavGrid;
  readonly ctx: MatchContext;
  /** Свой маг: тело, перезарядки (mage.ready), заряды (mage.charges), жар, ульта — их бот знает всегда. */
  readonly self: Readonly<Unit>;
  readonly level: BotLevel;
  readonly trait: BotTrait;
  readonly params: Readonly<BotParams>;
  /** Рабочая полоса с поправкой характера, м. */
  readonly band: readonly [number, number];
  /** Враги в памяти (запаздывающее восприятие и слух). */
  readonly enemies: readonly Perceived[];
  readonly target: Perceived | null;
  /** Замеченные угрозы (через реакцию после появления). */
  readonly threats: readonly Threat[];
  /** Свой запас до кромки, м, и куда кромка. */
  readonly voidM: number;
  readonly voidDir: { x: number; z: number } | null;
  /** По боту били за последнюю секунду. */
  readonly underFire: boolean;
  /** «В беде» (Р4): HP < 35 % под огнём или телеграф по боту. */
  readonly inTrouble: boolean;
}

const COS_VIEW = Math.cos((BOT_RULES.viewHalfDeg * Math.PI) / 180);
/** Голова и грудь цели над подошвой: по ним луч видимости. */
export const HEAD_M = 1.6;
export const CHEST_M = 1.2;

function seenFlags(v: Unit, now: number): number {
  const m = v.mage!;
  const st = v.status;
  let f = 0;
  if (m.ward && now < m.ward.endTick) f |= SEEN_WARD;
  if (m.dash) f |= SEEN_DASH;
  if (now < m.overheatUntil) f |= SEEN_OVERHEAT;
  if (now < st.furyUntil) f |= SEEN_FURY;
  if (st.airborne) f |= SEEN_AIRBORNE;
  if (now < st.rootUntil) f |= SEEN_ROOTED;
  if (now < st.shieldUntil) f |= SEEN_SHIELD;
  if (m.flight.gliding) f |= SEEN_GLIDE;
  return f;
}

/** Видно ли мага v из глаз бота: луч sight до головы или груди не перекрыт. */
export function canSee(world: World, eye: Vec3, v: Unit): boolean {
  const p = v.move.body.pos;
  return lineOfSight(world, eye, { x: p.x, y: p.y + HEAD_M, z: p.z }) || lineOfSight(world, eye, { x: p.x, y: p.y + CHEST_M, z: p.z });
}

/**
 * Снимок мысли (Р2) по состоянию тика: маги в конусе 110° по взгляду или ближе 3,5 м с открытым лучом до головы или
 * груди (лучи — только до кандидатов ближе 40 м). Невидимых слышно: ульту — по всей карте; замах, рывок, свежий
 * выстрел (снаряд с bornTick ≥ since) — до 25 м; ударившего бота с since — где угодно. Точка слуха ±2 м (rand).
 */
export function takeGlimpse(s: Readonly<MatchState>, me: Readonly<Unit>, world: World, since: number, rand: () => number): Glimpse {
  const now = s.tick;
  const eye = eyeOf(me as Unit);
  const f = forwardXZ(me.move.yaw);
  const seen: SeenMage[] = [];
  const heard: HeardMage[] = [];
  const R = BOT_RULES;
  for (const v of s.units) {
    if (v.id === me.id || !v.mage || !v.alive) continue;
    const p = v.move.body.pos;
    const dx = p.x - eye.x;
    const dz = p.z - eye.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    let visible = false;
    if (d <= R.senseMaxM) {
      const inCone = d <= R.nearSenseM || (d > 1e-6 && (dx * f.x + dz * f.z) / d >= COS_VIEW);
      visible = inCone && canSee(world, eye, v);
    }
    const m = v.mage;
    if (visible) {
      seen.push({
        id: v.id, element: m.element, x: p.x, y: p.y, z: p.z,
        vx: v.move.body.vel.x + v.kb.x, vy: v.move.body.vel.y, vz: v.move.body.vel.z + v.kb.z,
        hp: v.hp, maxHp: v.maxHp, flags: seenFlags(v, now), windup: m.windup ? m.windup.ability : null, ult: m.ult.cast ? m.ult.cast.ability : null,
      });
      continue;
    }
    let loud = m.ult.cast !== null || (me.lastHitBy === v.id && me.lastHitTick >= since);
    if (!loud && d <= R.hearM) {
      loud = m.windup !== null || m.dash !== null;
      if (!loud) for (const q of s.projectiles) if (q.owner === v.id && q.bornTick >= since) loud = true;
    }
    if (!loud) continue;
    const nx = (rand() * 2 - 1) * R.hearNoiseM;
    const nz = (rand() * 2 - 1) * R.hearNoiseM;
    heard.push({ id: v.id, x: p.x + nx, y: p.y, z: p.z + nz });
  }
  return { tick: now, seen, heard };
}

/** Снимок, который бот уже «осознал»: самый новый с tick ≤ at; null — ещё ни одного. */
export function perceivedGlimpse(glimpses: readonly Glimpse[], at: number): Glimpse | null {
  for (let k = glimpses.length - 1; k >= 0; k--) if (glimpses[k]!.tick <= at) return glimpses[k]!;
  return null;
}

// ---------------------------------------------------------------- угрозы

const BODY_HALF = 0.4;
/** Запас к зоне поражения: бот уходит чуть дальше, чем нужно. */
const MARGIN_M = 0.3;
const PILLAR = EARTH.stonePillar;
const QUAKE = EARTH.earthquake;
const GUST = AIR.gust;
const BREATH = FIRE.dragonBreath;
const HURRICANE = AIR.hurricane;
const DEG = Math.PI / 180;
/** Снаряды, от которых уходят (Р4: шар, Хват, Ответ); радиус опасности от оси полёта до центра тела, м. */
const DODGE_SHOTS: Readonly<Partial<Record<string, number>>> = Object.freeze({ fireball: 1.8, waterGrab: 1.1, waterAnswer: 1.1 });
const SHOT_HORIZON_S = 1.5;
/** Опасные взведённые зоны врага: из них бот уходит всегда. */
const HAZARDS: Readonly<Partial<Record<ZoneKind, true>>> = Object.freeze({ fireWall: true, fireTrail: true, rift: true, tornado: true, fireTornado: true, sandTornado: true, bog: true });
/** Телеграфы, от которых уходят с шансом уровня. */
const TELEGRAPHS: Readonly<Partial<Record<ZoneKind, true>>> = Object.freeze({ pillar: true, quake: true, rift: true, fireWall: true, tornado: true, tsunami: true });
const TSUNAMI_HALF_M = 7;
const TSUNAMI_STEP_M = 15 / 60;

const unit2 = (x: number, z: number): { x: number; z: number } | null => {
  const l = Math.sqrt(x * x + z * z);
  return l < 1e-9 ? null : { x: x / l + 0, z: z / l + 0 };
};

/** Из двух сторон (a и −a) — своя, если там не у самой кромки, иначе та, где запас больше (Р4). */
function side(nav: NavGrid, p: Vec3, a: { x: number; z: number }, mine: boolean | null): { x: number; z: number } {
  const b = { x: -a.x + 0, z: -a.z + 0 };
  const va = voidDistM(nav, { x: p.x + a.x * 1.5, y: p.y, z: p.z + a.z * 1.5 });
  const vb = voidDistM(nav, { x: p.x + b.x * 1.5, y: p.y, z: p.z + b.z * 1.5 });
  if (mine === true) return va >= 1 || va >= vb ? a : b;
  if (mine === false) return vb >= 1 || vb >= va ? b : a;
  return va >= vb ? a : b;
}

function distXZToSegment(p: Vec3, a: Vec3, b: Vec3): { d: number; kx: number; kz: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
  const kx = a.x + abx * k;
  const kz = a.z + abz * k;
  return { d: Math.sqrt((p.x - kx) * (p.x - kx) + (p.z - kz) * (p.z - kz)), kx, kz };
}

/** Уход перпендикулярно отрезку ab на свою сторону (ровно на линии — где запас больше). */
function segmentEscape(nav: NavGrid, p: Vec3, a: Vec3, b: Vec3): { x: number; z: number } | null {
  const n = unit2(-(b.z - a.z), b.x - a.x);
  if (!n) return null;
  const s = (p.x - a.x) * n.x + (p.z - a.z) * n.z;
  return side(nav, p, n, Math.abs(s) < 0.2 ? null : s > 0);
}

/** Уход из диска: от центра (ровно в центре — где запас больше). */
function discEscape(nav: NavGrid, p: Vec3, c: Vec3, look: number): { x: number; z: number } | null {
  const r = unit2(p.x - c.x, p.z - c.z);
  if (r) return r;
  const f = forwardXZ(look);
  return side(nav, p, { x: -f.z + 0, z: f.x + 0 }, null);
}

/** Уход из бокса: к ближней грани (с телом и запасом pad); почти равные — где запас больше. */
function boxEscape(nav: NavGrid, p: Vec3, box: { min: Vec3; max: Vec3 }, pad: number): { x: number; z: number } {
  const opts = [
    { x: 1, z: 0, d: box.max.x + pad - p.x },
    { x: -1, z: 0, d: p.x - (box.min.x - pad) },
    { x: 0, z: 1, d: box.max.z + pad - p.z },
    { x: 0, z: -1, d: p.z - (box.min.z - pad) },
  ].sort((a, b) => a.d - b.d);
  const a = opts[0]!;
  const b = opts[1]!;
  if (b.d - a.d > 0.3) return { x: a.x, z: a.z };
  const va = voidDistM(nav, { x: p.x + a.x * 1.5, y: p.y, z: p.z + a.z * 1.5 });
  const vb = voidDistM(nav, { x: p.x + b.x * 1.5, y: p.y, z: p.z + b.z * 1.5 });
  return vb > va ? { x: b.x, z: b.z } : { x: a.x, z: a.z };
}

/** Уход из конуса (apex, взгляд yaw): вбок от оси на свою сторону. */
function coneEscape(nav: NavGrid, p: Vec3, apex: Vec3, yaw: number): { x: number; z: number } {
  const f = forwardXZ(yaw);
  const n = { x: -f.z + 0, z: f.x + 0 };
  const s = (p.x - apex.x) * n.x + (p.z - apex.z) * n.z;
  return side(nav, p, n, Math.abs(s) < 0.3 ? null : s > 0);
}

function inCone(p: Vec3, apex: Vec3, yaw: number, rangeM: number, halfDeg: number): boolean {
  const dx = p.x - apex.x;
  const dz = p.z - apex.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > rangeM) return false;
  if (d < 1) return true;
  const f = forwardXZ(yaw);
  return (dx * f.x + dz * f.z) / d >= Math.cos(halfDeg * DEG);
}

function zoneThreat(z: Zone, me: Readonly<Unit>, nav: NavGrid, now: number): Threat | null {
  const tele = now < z.armTick;
  const cls: DodgeClass | null = tele ? (TELEGRAPHS[z.kind] ? "telegraph" : null) : HAZARDS[z.kind] ? "hazard" : null;
  if (!cls) return null;
  const p = me.move.body.pos;
  const sh = z.shape;
  const arm = z.armTick;
  const eta = tele ? (arm - now) / 60 : 0;
  let inside = false;
  let escape: { x: number; z: number } | null = null;
  let from: Vec3;
  let jumpFrom: number | null = null;
  let jumpTo: number | null = null;
  if (sh.type === "box") {
    const b = sh.box;
    from = { x: (b.min.x + b.max.x) / 2, y: b.min.y, z: (b.min.z + b.max.z) / 2 };
    const pad = BODY_HALF + MARGIN_M + (z.kind === "pillar" ? PILLAR.hitPadM : 0);
    const footOk = z.kind === "pillar" ? p.y >= b.min.y - 0.6 - MARGIN_M && p.y <= b.min.y + 1 + MARGIN_M : p.y <= b.max.y && p.y + 1.8 >= b.min.y;
    inside = footOk && p.x > b.min.x - pad && p.x < b.max.x + pad && p.z > b.min.z - pad && p.z < b.max.z + pad;
    if (inside) escape = boxEscape(nav, p, b, pad);
    // столб бьёт тех, чьи ступни не выше основания + 1 м: прыжок за 0,22–0,48 с до удара поднимает выше
    if (z.kind === "pillar" && tele) {
      jumpFrom = arm - 29;
      jumpTo = arm - 13;
    }
  } else if (sh.type === "disc") {
    from = sh.center;
    const dx = p.x - sh.center.x;
    const dz = p.z - sh.center.z;
    const r = sh.radius + BODY_HALF + MARGIN_M;
    inside = dx * dx + dz * dz <= r * r && Math.abs(p.y - sh.center.y) <= QUAKE.heightM + 0.5;
    if (inside) escape = discEscape(nav, p, sh.center, me.move.yaw);
    // землетрясение бьёт только стоящих на полу
    if (z.kind === "quake" && tele) {
      jumpFrom = arm - 36;
      jumpTo = arm - 3;
    }
  } else {
    from = { x: (sh.a.x + sh.b.x) / 2, y: sh.a.y, z: (sh.a.z + sh.b.z) / 2 };
    if (z.kind === "tsunami") {
      // волна катится поперёк отрезка по d (как stepTsunami) до endTick: полоса впереди неё
      const n = unit2(sh.b.x - sh.a.x, sh.b.z - sh.a.z);
      if (!n) return null;
      const d = { x: n.z, z: -n.x + 0 };
      const lat = (p.x - from.x) * n.x + (p.z - from.z) * n.z;
      const fwd = (p.x - from.x) * d.x + (p.z - from.z) * d.z;
      const travel = (z.endTick - Math.max(now, arm)) * TSUNAMI_STEP_M;
      inside = Math.abs(lat) <= TSUNAMI_HALF_M + BODY_HALF + MARGIN_M && fwd >= -1.5 && fwd <= travel + 1 && Math.abs(p.y - sh.a.y) <= 3;
      if (inside) escape = side(nav, p, n, Math.abs(lat) < 0.5 ? null : lat > 0);
      const t = Math.max(0, arm - now) / 60 + Math.max(0, fwd) / 15;
      return { key: z.id, kind: "zone", cls, ability: z.ability, owner: z.owner, born: z.bornTick, etaS: t, inside, from, escape, jumpFrom: null, jumpTo: null };
    }
    const q = distXZToSegment(p, sh.a, sh.b);
    inside = q.d <= sh.halfW + BODY_HALF + MARGIN_M && p.y >= Math.min(sh.a.y, sh.b.y) - 1.5 && p.y <= Math.max(sh.a.y, sh.b.y) + 2;
    if (inside) escape = segmentEscape(nav, p, sh.a, sh.b);
    // разлом бьёт по линии только стоящих на полу; дальше шипы колют и в воздухе
    if (z.kind === "rift" && tele) {
      jumpFrom = arm - 36;
      jumpTo = arm - 3;
    }
  }
  return { key: z.id, kind: "zone", cls, ability: z.ability, owner: z.owner, born: z.bornTick, etaS: eta, inside, from, escape, jumpFrom, jumpTo };
}

/**
 * Угрозы боту на тике s.tick: телеграфы и опасные зоны врагов, летящие в него шар, Хват и Ответ, замах Порыва в его
 * сторону, Дыхание дракона и Ураган. Порядок — как в состоянии (зоны, снаряды, маги по id).
 */
export function scanThreats(s: Readonly<MatchState>, me: Readonly<Unit>, nav: NavGrid): Threat[] {
  const now = s.tick;
  const out: Threat[] = [];
  const p = me.move.body.pos;
  for (const z of s.zones) {
    if (z.owner === me.id) continue;
    const t = zoneThreat(z, me, nav, now);
    if (t) out.push(t);
  }
  const c = { x: p.x, y: p.y + 0.9, z: p.z };
  for (const q of s.projectiles) {
    const R = DODGE_SHOTS[q.ability];
    if (R === undefined || q.owner === me.id) continue;
    const rx = c.x - q.pos.x;
    const ry = c.y - q.pos.y;
    const rz = c.z - q.pos.z;
    const v = q.vel;
    const vv = v.x * v.x + v.y * v.y + v.z * v.z;
    if (vv < 1e-6) continue;
    const t = (rx * v.x + ry * v.y + rz * v.z) / vv;
    if (t < 0 || t > SHOT_HORIZON_S) continue;
    const mx = rx - v.x * t;
    const my = ry - v.y * t;
    const mz = rz - v.z * t;
    const miss = Math.sqrt(mx * mx + my * my + mz * mz);
    const n = unit2(-v.z, v.x);
    let escape: { x: number; z: number } | null = null;
    if (n) {
      const sd = rx * n.x + rz * n.z;
      escape = side(nav, p, n, Math.abs(sd) < 0.2 ? null : sd > 0);
    }
    out.push({
      key: q.id, kind: "projectile", cls: "projectile", ability: q.ability === "waterAnswer" ? "waterWard" : q.ability, owner: q.owner, born: q.bornTick,
      etaS: t, inside: miss < R, from: { x: q.pos.x, y: q.pos.y, z: q.pos.z }, escape, jumpFrom: null, jumpTo: null,
    });
  }
  for (const v of s.units) {
    const m = v.mage;
    if (!m || !v.alive || v.id === me.id) continue;
    const apex = v.move.body.pos;
    if (m.windup && m.windup.ability === "gust") {
      const w = m.windup;
      const inside = inCone(p, apex, v.move.yaw, GUST.rangeM + 1, GUST.halfAngleDeg + 5) && Math.abs(p.y - apex.y) <= GUST.halfHeightM;
      out.push({
        key: -(v.id * 1e7 + w.releaseTick), kind: "windup", cls: "telegraph", ability: "gust", owner: v.id, born: w.releaseTick - Math.round(GUST.windupS * 60),
        etaS: Math.max(0, w.releaseTick - now) / 60, inside, from: { x: apex.x, y: apex.y, z: apex.z }, escape: inside ? coneEscape(nav, p, apex, v.move.yaw) : null, jumpFrom: null, jumpTo: null,
      });
    }
    const uc = m.ult.cast;
    if (uc && (uc.ability === "dragonBreath" || (uc.ability === "hurricane" && now < uc.releaseTick))) {
      let inside: boolean;
      let escape: { x: number; z: number } | null = null;
      if (uc.ability === "dragonBreath") {
        inside = inCone(p, apex, v.move.yaw, BREATH.rangeM + 1, BREATH.halfAngleDeg + 6);
        if (inside) escape = coneEscape(nav, p, apex, v.move.yaw);
      } else {
        const dx = p.x - apex.x;
        const dz = p.z - apex.z;
        const r = HURRICANE.radiusM + 1;
        inside = dx * dx + dz * dz <= r * r && Math.abs(p.y - apex.y) <= HURRICANE.halfHeightM;
        if (inside) escape = discEscape(nav, p, apex, v.move.yaw);
      }
      out.push({
        key: -(v.id * 1e7 + uc.releaseTick), kind: "ult", cls: "telegraph", ability: uc.ability, owner: v.id, born: uc.startTick,
        etaS: Math.max(0, uc.releaseTick - now) / 60, inside, from: { x: apex.x, y: apex.y, z: apex.z }, escape, jumpFrom: null, jumpTo: null,
      });
    }
  }
  return out;
}
