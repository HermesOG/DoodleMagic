import { MATCH, PICKUPS, ULT_CHARGE, ticks } from "../match/defs";
import { buildTickWorld } from "../match/dynamic";
import { scoreOf } from "../match/rules";
import { NO_MATCH_INPUT, aimDir, clonePlain, eyeOf, idleInput, rightXZ, unitById } from "../match/state";
import { NEVER, NOBODY, type AbilityId, type Element, type MatchContext, type MatchInput, type MatchState, type Slot, type Unit, type UnitId, type UltId } from "../match/types";
import { forwardXZ } from "../player";
import { raycast } from "../raycast";
import { TICK_DT, TICK_HZ, type Vec3 } from "../types";
import type { World } from "../world";
import { BOT_KITS, type BotKit, type BotPrimary } from "./kits";
import {
  NAV_JUMP, NAV_WALK, columnNode, dashLandingOk, edgeKindOf, navColumn, findPath, navNode, nearestFloor, nearestSafe, nodePos, safeNodeNear, voidDir, voidDistM, type NavGrid,
} from "./nav";
import { BOT_PARAMS, BOT_RULES, BOT_TRAITS, type BotLevel, type BotParams, type BotTrait } from "./params";
import { nextRandom, seedRandom } from "./rng";
import {
  CHEST_M, SEEN_AIRBORNE, SEEN_DASH, SEEN_FURY, SEEN_GLIDE, SEEN_OVERHEAT, SEEN_ROOTED, SEEN_SHIELD, SEEN_WARD, canSee, perceivedGlimpse,
  scanThreats, takeGlimpse, type BotView, type CastPlan, type Glimpse, type Perceived, type Threat,
} from "./sense";

/**
 * Мозг бота-мага (фаза 8): stepBot(bot, state, world) → { bot, input }. Бот играет по тем же правилам, что игрок (Р1):
 * обычный MatchInput, тот же sanitizeInput, никаких подсказок от симуляции. Сложность — восприятие (Р2, Р3), точность
 * и решения (Р4). Чистая функция: аргументы не меняются, случайность — только PRNG в памяти бота.
 *
 * Тик: учёт (появления, убийства, «сводник») → угрозы (каждый тик, через реакцию) → мысль (раз в 60 / thinkHz тиков со
 * сдвигом id: снимок, память, цель, режим, путь, план кита) → ход (спасение у края, уворот, режим; фильтр края) →
 * взгляд (предел поворота с разгоном, дрейф ошибки) → ЛКМ и нажатие плана.
 */

/** Режим хода: бродит, гонится, бьётся, идёт к сфере или руне, отходит от края. */
export type BotMode = "roam" | "chase" | "combat" | "orb" | "rune" | "edge";

/** Память о маге: последний воспринятый снимок (или слух). until — когда забыть. */
export interface BotMemory {
  id: UnitId; element: Element;
  tick: number; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  /** Средняя скорость по XZ от опорного снимка (refX, refZ на refTick) — по ней упреждение. */
  ax: number; az: number; refX: number; refZ: number; refTick: number;
  hp: number; maxHp: number; flags: number; windup: AbilityId | null; ult: UltId | null;
  /** Тик снимка, где видели глазами; heard — позиция по слуху (новее seenTick). */
  seenTick: number; heard: boolean; until: number;
}
/** Отметки о маге (Р8): когда появился и сколько урона нанёс на тот момент, «не трогать до», мёртв ли. */
export interface BotMark { id: UnitId; spawn: number; dmg: number; dead: boolean; avoidUntil: number }
/** Решение по угрозе (бросается один раз, Р4): с какого тика бот её замечает, уходит ли, прыгал ли уже. */
export interface BotThreatMemo { key: number; notice: number; dodge: boolean; jumped: boolean }
/** План каста кита: ждёт notBefore и взгляд, живёт до until. */
export interface BotPlan {
  slot: "q" | "e" | "c" | "x" | null;
  aim: Vec3 | null; track: UnitId; trackDy: number; trackShot: BotPrimary;
  move: { x: number; z: number } | null; jump: boolean; tolDeg: number; notBefore: number; until: number;
  /** Рывок на moveM: приземление проверяется заново на тике нажатия (0 — без проверки). */
  moveM: number;
  /** Держать прыжок столько тиков после нажатия (парение). */
  holdJump: number;
  /** План спасения над пустотой: новое спасение его не перебивает. */
  rescue: boolean;
  /** Наземный каст: дальность для проверки точки под прицелом на тике нажатия (0 — не наземный). */
  groundRangeM: number;
  /** Без задержки уровня (спасение, уворот, ульта): жмётся и в своём замахе. */
  urgent: boolean;
}

/** Память бота — простые данные (JSON), её держит хост. */
export interface BotState {
  readonly id: UnitId;
  readonly level: BotLevel;
  readonly trait: BotTrait;
  rng: number;
  mode: BotMode;
  /** Цель: id мага или NOBODY; с какого тика держим (липкость). */
  target: UnitId;
  targetSince: number;
  /** Реакция сейчас, тики (бросается заново на каждой новой цели). */
  reaction: number;
  /** Снимки мыслей и тик последнего «осознанного». */
  glimpses: Glimpse[];
  pgTick: number;
  memory: BotMemory[];
  marks: BotMark[];
  threats: BotThreatMemo[];
  /** Куда ведёт путь, путь и до какого узла дошли; тик расчёта. */
  goal: Vec3 | null;
  path: number[];
  pathAt: number;
  pathTick: number;
  /** Последний расчёт пути не нашёл его (цель недостижима). */
  pathFailed: boolean;
  /** Застревание (Р10): где и когда был последний сдвиг; шаг вбок до unstickUntil. */
  stuckTick: number; stuckX: number; stuckZ: number;
  unstickUntil: number; unstickX: number; unstickZ: number;
  /** Бой: сторона стрейфа (±1) и до какого тика; с какого тика стоит, хотя идёт. */
  strafe: number; strafeUntil: number; slowTick: number;
  jumpReq: boolean;
  /** Взгляд: угловые скорости, рад/с; дрейф ошибки (сейчас и куда идёт), следующая смена; до какого тика «новая цель». */
  yawVel: number; pitchVel: number;
  errYaw: number; errPitch: number; errYawGoal: number; errPitchGoal: number; driftAt: number; newTargetUntil: number;
  plan: BotPlan | null;
  /** Бродилка: где был (x, z парами), когда отметился; пауза на точке и взгляд, от которого осматривается. */
  trail: number[]; trailTick: number; pauseUntil: number; lookYaw: number;
  /** Последняя жертва и сколько раз подряд (антизадира). */
  victim: UnitId; streak: number;
  /** «Сводник»: с какого тика к человеку никто не шёл. */
  lonely: { id: UnitId; since: number }[];
  /** Шаг от края (Р9): до какого тика и куда — узел с запасом до кромки. */
  edgeUntil: number; edgeX: number; edgeZ: number;
  /** С какого тика заряд ульты полон (Р5: Архимаг ждёт верного). */
  ultSince: number;
  /** Держать прыжок до этого тика (парение по плану). */
  jumpHoldUntil: number;
  /** Своя позиция прошлого тика: скачок дальше teleportM (перестановка на старте боя) — память сброшена. */
  selfX: number; selfZ: number;
}

/**
 * Мир для решений бота. humans и claims даёт хост: бот иначе не знает, кто человек и куда идут другие боты. Хост шагает
 * ботов по очереди и считает claims каждого по уже обновлённым состояниям ботов этого тика (claimsFor): иначе два бота,
 * думающие на одном тике, пробивают квоту (Р8).
 */
export interface BotWorld {
  readonly nav: NavGrid;
  readonly ctx: MatchContext;
  readonly humans: readonly UnitId[];
  /** Сколько ботов (кроме спрашивающего) сейчас выбрали цель id; ключ RUNE_CLAIM — сколько идут к руне. */
  readonly claims: Readonly<Record<number, number>>;
}
export const RUNE_CLAIM = -100;

const R = BOT_RULES;
const DT = TICK_DT;
const DEG = Math.PI / 180;
const MAX_PITCH = Math.PI / 2 - 0.01;
/** Дрейф ошибки догоняет свою цель с этой постоянной времени, с. */
const DRIFT_TAU_S = 0.15;
const DRIFT_K = 1 - Math.exp(-DT / DRIFT_TAU_S);
/** Путь: узел достигнут ближе этого по XZ; прыжок по ребру — ближе этого к середине верхней колонки (0,6 м до её края). */
const REACH_M = 0.4;
const JUMP_AT_M = 0.6 + 0.25;
const LOOKAHEAD = 5;
/** Время полёта прыжка по ровному (1,25 м при g 20): для проверки приземления. */
const JUMP_AIR_S = 0.72;
const FALL_CREDIT_TICKS = ticks(MATCH.fallCreditS);
const RUNE_WARN_TICKS = ticks(PICKUPS.rune.warnS);
/** Средняя скорость цели: опорный снимок не старше 1 с, сдвиг не короче 0,3 с; между снимками не больше 40 тиков. */
const AVG_MAX_TICKS = 60;
const AVG_MIN_S = 0.3;
const AVG_GAP_TICKS = 40;
/** Повороты фильтра края (Р9): ±30°, ±60°, ±90°, ±120°. */
const TURNS: readonly (readonly [number, number])[] = Object.freeze([30, 60, 90, 120].map((a) => Object.freeze([Math.cos(a * DEG), Math.sin(a * DEG)] as const)));

const wrap = (a: number): number => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};
const clampN = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const msTicks = (ms: number): number => Math.round((ms * TICK_HZ) / 1000);
const yawTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
const norm2 = (x: number, z: number): { x: number; z: number } | null => {
  const l = Math.sqrt(x * x + z * z);
  return l < 1e-9 ? null : { x: x / l, z: z / l };
};

/** Реакция уровня в тиках: среднее ± разброс, не меньше порога (Р4). */
function rollReaction(P: Readonly<BotParams>, rand: () => number): number {
  return msTicks(Math.max(P.reactionMinMs, P.reactionMs + (rand() * 2 - 1) * P.reactionJitterMs));
}
function gauss(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const between = (rand: () => number, r: readonly [number, number]): number => r[0] + (r[1] - r[0]) * rand();

/** Новый бот: характер — из PRNG по сиду (Р11). */
export function createBot(id: UnitId, level: BotLevel, seed: number): BotState {
  const r = nextRandom(seedRandom(seed, id));
  const trait = BOT_TRAITS[Math.min(BOT_TRAITS.length - 1, Math.floor(r.value * BOT_TRAITS.length))]!;
  return {
    id, level, trait, rng: r.state, mode: "roam", target: NOBODY, targetSince: NEVER, reaction: msTicks(BOT_PARAMS[level].reactionMs),
    glimpses: [], pgTick: NEVER, memory: [], marks: [], threats: [], goal: null, path: [], pathAt: 0, pathTick: NEVER, pathFailed: false,
    stuckTick: NEVER, stuckX: 0, stuckZ: 0, unstickUntil: NEVER, unstickX: 0, unstickZ: 0, strafe: 1, strafeUntil: NEVER, slowTick: NEVER, jumpReq: false,
    yawVel: 0, pitchVel: 0, errYaw: 0, errPitch: 0, errYawGoal: 0, errPitchGoal: 0, driftAt: NEVER, newTargetUntil: NEVER, plan: null,
    trail: [], trailTick: NEVER, pauseUntil: NEVER, lookYaw: 0, victim: NOBODY, streak: 0, lonely: [], edgeUntil: NEVER, edgeX: 0, edgeZ: 0, ultSince: NEVER,
    jumpHoldUntil: NEVER, selfX: NEVER, selfZ: NEVER,
  };
}

/** Цель бота для claims: id мага, RUNE_CLAIM или NOBODY. */
export function botClaim(b: Readonly<BotState>): number {
  return b.mode === "rune" ? RUNE_CLAIM : b.target;
}

/**
 * claims для бота id (Р8): сколько других ботов выбрали каждую цель. Для хоста и тестов: bots — состояния этого тика,
 * у уже шагнувших — новые (боты шагают по очереди).
 */
export function claimsFor(bots: readonly Readonly<BotState>[], id: UnitId): Record<number, number> {
  const out: Record<number, number> = {};
  for (const o of bots) {
    if (o.id === id) continue;
    const c = botClaim(o);
    if (c !== NOBODY) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

/** Всё, что нужно шагу бота: память (её и меняем), состояние, свой маг, мир, числа уровня и кит, PRNG. */
interface Ctx {
  readonly b: BotState;
  readonly s: Readonly<MatchState>;
  readonly me: Readonly<Unit>;
  readonly w: BotWorld;
  readonly nav: NavGrid;
  readonly P: Readonly<BotParams>;
  readonly kit: BotKit;
  readonly now: number;
  readonly rand: () => number;
  readonly world: () => World;
  readonly band: readonly [number, number];
}

const memOf = (b: BotState, id: UnitId): BotMemory | undefined => b.memory.find((m) => m.id === id);
const markOf = (b: BotState, id: UnitId): BotMark | undefined => b.marks.find((m) => m.id === id);
const isHuman = (w: BotWorld, id: UnitId): boolean => w.humans.includes(id);
/** Видна ли запомненная цель в последнем осознанном снимке. */
const visibleMem = (b: BotState, m: BotMemory | undefined): boolean => m !== undefined && m.seenTick === b.pgTick && b.pgTick !== NEVER;

/** Полоса стихии с поправкой характера (Р11): «Задира» ближе, «Осторожный» дальше. */
function bandOf(kit: BotKit, trait: BotTrait): readonly [number, number] {
  const k = trait === "bully" ? R.bullyBandMul : trait === "careful" ? R.carefulBandMul : 1;
  return [kit.bandM[0] * k, kit.bandM[1] * k];
}

function dropTarget(b: BotState): void {
  b.target = NOBODY;
  b.targetSince = NEVER;
  b.plan = null;
}

function setTarget(c: Ctx, id: UnitId): void {
  const { b, P, now, rand } = c;
  if (b.target === id) return;
  b.target = id;
  b.targetSince = now;
  b.reaction = rollReaction(P, rand);
  b.newTargetUntil = now + ticks(P.aimNewTargetS);
  b.plan = null;
}

// ---------------------------------------------------------------- учёт

/**
 * Каждый тик (Р8): отметки о магах — появление (смерть → жизнь или свежая защита после появления), урон на тот момент;
 * своё убийство (умер маг, которого последним бил бот) — «не трогать» 5 с, антизадира; таймеры «сводника».
 */
function bookkeeping(c: Ctx): void {
  const { b, s, w, P, now } = c;
  const shieldTicks = ticks(w.ctx.spawnShieldS ?? 0);
  const marks: BotMark[] = [];
  for (const v of s.units) {
    if (!v.mage || v.id === b.id) continue;
    const k = markOf(b, v.id) ?? { id: v.id, spawn: NEVER, dmg: v.mage.stats.damage, dead: !v.alive, avoidUntil: NEVER };
    if (!v.alive) {
      if (!k.dead) {
        k.dead = true;
        if (v.lastHitBy === b.id && now - v.lastHitTick <= FALL_CREDIT_TICKS) onKill(c, v.id, k);
      }
    } else {
      if (k.dead) {
        k.dead = false;
        k.spawn = now;
        k.dmg = v.mage.stats.damage;
      }
      if (shieldTicks > 0 && now < v.status.shieldUntil) {
        const at = v.status.shieldUntil - shieldTicks;
        if (at > k.spawn) {
          k.spawn = at;
          k.dmg = v.mage.stats.damage;
        }
      }
    }
    marks.push(k);
  }
  b.marks = marks;
  // маг ушёл из матча (вышел, бота вытеснил человек) — забыть сразу, а не на мысли: цель в claims не висит лишние тики
  if (b.memory.some((m) => !unitById(s, m.id))) b.memory = b.memory.filter((m) => unitById(s, m.id) !== undefined);
  if (b.target !== NOBODY && !unitById(s, b.target)) dropTarget(b);
  const lonely: { id: UnitId; since: number }[] = [];
  for (const h of w.humans) {
    const v = unitById(s, h);
    if (!v?.mage) continue;
    const prev = b.lonely.find((l) => l.id === h);
    const claimed = (w.claims[h] ?? 0) > 0 || b.target === h || !v.alive;
    lonely.push({ id: h, since: claimed || !prev ? now : prev.since });
  }
  b.lonely = lonely;
  if (P.antiBullyS <= 0) b.streak = 0;
}

function onKill(c: Ctx, victim: UnitId, k: BotMark): void {
  const { b, w, P, now } = c;
  k.avoidUntil = Math.max(k.avoidUntil, now + ticks(R.killAvoidS));
  b.streak = b.victim === victim ? b.streak + 1 : 1;
  b.victim = victim;
  if (P.antiBullyS > 0 && isHuman(w, victim) && b.streak >= 2) {
    k.avoidUntil = now + ticks(P.antiBullyS);
    b.streak = 0;
  }
  if (b.target === victim) dropTarget(b);
  b.memory = b.memory.filter((m) => m.id !== victim);
}

/** Мёртвый бот (Р3): цель, путь, память и планы сброшены; отметки о других остаются. */
function forget(b: BotState): void {
  dropTarget(b);
  b.mode = "roam";
  b.glimpses = [];
  b.pgTick = NEVER;
  b.memory = [];
  b.threats = [];
  b.goal = null;
  b.path = [];
  b.pathAt = 0;
  b.pathTick = NEVER;
  b.pathFailed = false;
  b.yawVel = 0;
  b.pitchVel = 0;
  b.unstickUntil = NEVER;
  b.pauseUntil = NEVER;
  b.edgeUntil = NEVER;
  b.jumpReq = false;
  b.jumpHoldUntil = NEVER;
}

// ---------------------------------------------------------------- цель (Р7, Р8)

/** Можно ли бить мага id: жив, не под защитой, не «не трогать», без поблажки, квота не занята. */
function validTarget(c: Ctx, id: UnitId): boolean {
  const { b, s, w, P, now } = c;
  if (id === b.id) return false;
  const v = unitById(s, id);
  if (!v?.mage || !v.alive || now < v.status.shieldUntil) return false;
  const k = markOf(b, id);
  const human = isHuman(w, id);
  if (k) {
    if (now < k.avoidUntil) return false;
    const attacked = v.mage.stats.damage > k.dmg;
    if (!attacked && now < k.spawn + ticks(R.respawnGraceS)) return false;
    if (human && P.humanGraceS > 0 && now < k.spawn + ticks(P.humanGraceS)) return false;
  }
  const limit = human ? Math.min(P.maxPerHuman, P.maxPerTarget) : P.maxPerTarget;
  return (w.claims[id] ?? 0) < limit;
}

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);
}

/** Оценка цели (Р7): бил меня, мало HP, ярость, лидер, у кромки, дистанция, сколько ботов уже на ней. */
function scoreTarget(c: Ctx, m: BotMemory, leader: UnitId): number {
  const { me, w, nav, now, kit, band } = c;
  let sc = 0;
  if (me.hitters.some((h) => h.unit === m.id && now - h.tick <= ticks(R.attackerS))) sc += R.scoreHitMe;
  if (m.hp < m.maxHp * R.lowHpFrac) sc += R.scoreLowHp;
  if (m.flags & SEEN_FURY) sc += R.scoreFury;
  if (m.id === leader) sc += R.scoreLeader;
  if (voidDistM(nav, m) < R.scoreEdgeM) sc += kit.edgeBonus;
  const d = Math.sqrt(dist2(m, me.move.body.pos));
  sc -= (R.scorePer10M * Math.max(0, d - band[1])) / 10;
  sc -= R.scorePerClaim * (w.claims[m.id] ?? 0);
  return sc - d * 1e-3;
}

/** Лидер с отрывом от второго не меньше leaderGap, иначе NOBODY (счёт игрок видит в HUD). */
function leaderOf(s: Readonly<MatchState>): UnitId {
  let best = NOBODY;
  let a = -Infinity;
  let second = -Infinity;
  for (const u of s.units) {
    if (!u.mage) continue;
    const sc = scoreOf(u);
    if (sc > a) {
      second = a;
      a = sc;
      best = u.id;
    } else if (sc > second) second = sc;
  }
  return a - second >= R.leaderGap ? best : NOBODY;
}

/**
 * Выбор цели на мысли (Р7, Р8). Кандидаты — маги в памяти, которых можно бить; limitM — только видимые ближе (по пути к
 * руне). Липкость 2,5 с; смена — в 1,3 раза лучше или бьёт другой. Нет цели — «сводник»: к человеку 8 с никто не шёл,
 * ближайший свободный бот идёт на его звук (каждый следующий по дальности — на 1 с позже).
 */
function chooseTarget(c: Ctx, limitM: number): void {
  const { b, s, me, w, now, rand } = c;
  const pos = me.move.body.pos;
  const leader = leaderOf(s);
  let best: BotMemory | null = null;
  let bestSc = -Infinity;
  let curSc = -Infinity;
  const cur = b.target;
  for (const m of b.memory) {
    if (!validTarget(c, m.id)) continue;
    if (limitM < Infinity && m.id !== cur && (!visibleMem(b, m) || dist2(m, pos) > limitM * limitM)) continue;
    const sc = scoreTarget(c, m, leader);
    if (m.id === cur) curSc = sc;
    if (sc > bestSc) {
      best = m;
      bestSc = sc;
    }
  }
  const curOk = cur !== NOBODY && curSc > -Infinity;
  if (cur !== NOBODY && !curOk) dropTarget(b);
  // «бьёт другой»: ударивший за последнюю секунду, если его можно бить и он в памяти
  const by = me.lastHitBy;
  const attacker = by !== NOBODY && by !== cur && now - me.lastHitTick <= ticks(R.hitNowS) && memOf(b, by) !== undefined && validTarget(c, by) ? by : NOBODY;
  if (curOk) {
    if (attacker !== NOBODY && now - b.targetSince >= ticks(R.hitNowS)) setTarget(c, attacker);
    else if (best && best.id !== cur && now - b.targetSince >= ticks(R.stickS)) {
      const better = curSc > 0 ? bestSc >= curSc * R.switchMul : bestSc >= curSc + 1;
      if (better) setTarget(c, best.id);
    }
    return;
  }
  if (attacker !== NOBODY) return setTarget(c, attacker);
  if (best) return setTarget(c, best.id);
  // «сводник»
  for (const l of b.lonely) {
    const wait = now - l.since;
    if (wait < ticks(R.lonelyS) || !validTarget(c, l.id)) continue;
    const h = unitById(s, l.id)!;
    const hp = h.move.body.pos;
    const myD = dist2(pos, hp);
    let rank = 0;
    for (const o of s.units) if (o.mage && o.alive && o.id !== b.id && !isHuman(w, o.id) && dist2(o.move.body.pos, hp) < myD) rank++;
    if (wait < ticks(R.lonelyS + rank * R.lonelyRankS)) continue;
    const x = hp.x + (rand() * 2 - 1) * R.hearNoiseM;
    const z = hp.z + (rand() * 2 - 1) * R.hearNoiseM;
    const old = memOf(b, l.id);
    const entry: BotMemory = old ?? {
      id: l.id, element: h.mage!.element, tick: now, x, y: hp.y, z, vx: 0, vy: 0, vz: 0, ax: 0, az: 0, refX: x, refZ: z, refTick: NEVER, hp: h.maxHp, maxHp: h.maxHp, flags: 0, windup: null, ult: null,
      seenTick: NEVER, heard: true, until: now,
    };
    Object.assign(entry, { tick: now, x, y: hp.y, z, vx: 0, vy: 0, vz: 0, ax: 0, az: 0, refTick: NEVER, heard: true, until: now + ticks(20) });
    if (!old) b.memory.push(entry);
    setTarget(c, l.id);
    return;
  }
}

// ---------------------------------------------------------------- мысль

/** Снимок, память и забывание (Р2, Р3): осознанный снимок — самый новый не моложе реакции. */
function perceive(c: Ctx, period: number): void {
  const { b, s, me, P, now, rand } = c;
  b.glimpses.push(takeGlimpse(s, me, c.world(), now - period + 1, rand));
  if (b.glimpses.length > R.glimpses) b.glimpses = b.glimpses.slice(-R.glimpses);
  const pg = perceivedGlimpse(b.glimpses, now - b.reaction);
  if (pg && pg.tick > b.pgTick) {
    b.pgTick = pg.tick;
    const keep = ticks(P.memoryS);
    for (const v of pg.seen) {
      const m = memOf(b, v.id);
      // средняя скорость по сдвигу от снимка 0,15–0,6 с назад: упреждение по ней не перелетает, когда цель качается
      let ref = { x: v.x, z: v.z, t: pg.tick };
      let ax = v.vx;
      let az = v.vz;
      if (m && !m.heard && m.seenTick !== NEVER && pg.tick - m.seenTick <= AVG_GAP_TICKS) {
        ref = pg.tick - m.refTick > AVG_MAX_TICKS ? { x: m.x, z: m.z, t: m.seenTick } : { x: m.refX, z: m.refZ, t: m.refTick };
        const dt = (pg.tick - ref.t) / TICK_HZ;
        if (dt >= AVG_MIN_S) {
          ax = (v.x - ref.x) / dt;
          az = (v.z - ref.z) / dt;
        }
      }
      const e: BotMemory = {
        id: v.id, element: v.element, tick: pg.tick, x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, ax, az, refX: ref.x, refZ: ref.z, refTick: ref.t,
        hp: v.hp, maxHp: v.maxHp, flags: v.flags, windup: v.windup, ult: v.ult, seenTick: pg.tick, heard: false, until: pg.tick + keep,
      };
      if (m) Object.assign(m, e);
      else b.memory.push(e);
    }
    for (const h of pg.heard) {
      const m = memOf(b, h.id);
      const v = unitById(s, h.id);
      if (!v?.mage) continue;
      if (m) {
        if (m.tick >= pg.tick) continue;
        Object.assign(m, { tick: pg.tick, x: h.x, y: h.y, z: h.z, vx: 0, vy: 0, vz: 0, ax: 0, az: 0, refTick: NEVER, heard: true, until: Math.max(m.until, pg.tick + keep) });
      } else {
        b.memory.push({
          id: h.id, element: v.mage.element, tick: pg.tick, x: h.x, y: h.y, z: h.z, vx: 0, vy: 0, vz: 0, ax: 0, az: 0, refX: h.x, refZ: h.z, refTick: NEVER, hp: v.maxHp, maxHp: v.maxHp, flags: 0,
          windup: null, ult: null, seenTick: NEVER, heard: true, until: pg.tick + keep,
        });
      }
    }
  }
  // забыть: срок вышел, маг мёртв или ушёл из матча
  b.memory = b.memory.filter((m) => {
    const v = unitById(s, m.id);
    return v !== undefined && v.alive && now <= m.until;
  });
  if (b.target !== NOBODY && !memOf(b, b.target)) dropTarget(b);
}

/** Воспринятый маг для кита и решений: память + свежие расстояния. */
function perceived(c: Ctx, m: BotMemory): Perceived {
  const { b, me, nav } = c;
  const p = me.move.body.pos;
  const f = m.flags;
  return {
    id: m.id, element: m.element, tick: m.tick, visible: visibleMem(b, m), heard: m.heard,
    pos: { x: m.x, y: m.y, z: m.z }, vel: { x: m.vx, y: m.vy, z: m.vz }, hp: m.hp, maxHp: m.maxHp,
    dist: Math.sqrt(dist2(m, p)), voidM: voidDistM(nav, m),
    ward: (f & SEEN_WARD) !== 0, dash: (f & SEEN_DASH) !== 0, overheat: (f & SEEN_OVERHEAT) !== 0, fury: (f & SEEN_FURY) !== 0,
    airborne: (f & SEEN_AIRBORNE) !== 0, rooted: (f & SEEN_ROOTED) !== 0, shielded: (f & SEEN_SHIELD) !== 0, gliding: (f & SEEN_GLIDE) !== 0,
    windup: m.windup, ult: m.ult,
  };
}

function viewOf(c: Ctx, threats: readonly Threat[]): BotView {
  const { b, s, me, w, nav, P, now } = c;
  const enemies = b.memory.map((m) => perceived(c, m));
  const target = enemies.find((e) => e.id === b.target) ?? null;
  const underFire = now - me.lastHitTick <= TICK_HZ;
  const tele = threats.some((t) => t.inside && t.cls === "telegraph");
  return {
    now, state: s, world: c.world(), nav, ctx: w.ctx, self: me, level: b.level, trait: b.trait, params: P, band: c.band, enemies, target, threats,
    voidM: voidDistM(nav, me.move.body.pos), voidDir: voidDir(nav, me.move.body.pos), underFire,
    inTrouble: (me.hp < me.maxHp * R.lowHpFrac && underFire) || tele,
    ultHeldS: b.ultSince === NEVER ? 0 : (now - b.ultSince) / TICK_HZ,
  };
}

/** Есть ли враг (в памяти) ближе rM. */
function enemyNear(c: Ctx, rM: number): boolean {
  const p = c.me.move.body.pos;
  return c.b.memory.some((m) => dist2(m, p) <= rM * rM);
}

/** Куда идти за сферой (Р12): HP ниже порога, угрозы ближе 6 м нет, сфера лежит — ближняя; иначе null. */
function orbGoal(c: Ctx): Vec3 | null {
  const { b, s, me, P, now } = c;
  const heal = P.healFrac + (b.trait === "careful" ? R.carefulHealFrac : 0);
  if (!(me.hp < me.maxHp * heal) || enemyNear(c, R.orbSafeM)) return null;
  const p = me.move.body.pos;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (const o of s.pickups) {
    if (o.kind !== "orb" || now < o.readyAt) continue;
    const at = { x: o.pos.x, y: o.pos.y - 0.5, z: o.pos.z };
    // сфера там, куда можно дойти (на башню — только потоком, Р18)
    const node = navNode(c.nav, at);
    if (node < 0 || !c.nav.nodeMain[node]) continue;
    const d = dist2(at, p) + (at.y - p.y) * (at.y - p.y) * 4;
    if (d < bestD) {
      best = at;
      bestD = d;
    }
  }
  return best;
}

/** Куда идти за руной (Р12): Ученик — ближе 10 м, Маг — когда лежит, Архимаг и «Охотник» — с объявления; ботов ≤ 2. */
function runeGoal(c: Ctx): Vec3 | null {
  const { b, s, me, w, P, now } = c;
  const rune = s.pickups.find((p) => p.kind === "rune");
  if (!rune || (w.claims[RUNE_CLAIM] ?? 0) >= R.runeBots) return null;
  if (me.hp < me.maxHp * P.healFrac) return null;
  const rule = b.trait === "runeHunter" ? "warn" : P.rune;
  const present = now >= rune.readyAt;
  const at = { x: rune.pos.x, y: rune.pos.y - 0.5, z: rune.pos.z };
  const ok = rule === "near" ? present && dist2(at, me.move.body.pos) <= P.runeNearM * P.runeNearM : rule === "present" ? present : now >= rune.readyAt - RUNE_WARN_TICKS;
  return ok ? at : null;
}

/**
 * Точка бродилки (Р3): объекты на карте и случайные узлы главной области — подальше от того, где бот уже был. К точкам
 * появления не ходит (АИ 2, «никогда»: спавн-кэмп).
 */
function roamGoal(c: Ctx): Vec3 | null {
  const { b, w, nav, me, rand } = c;
  const p = me.move.body.pos;
  const spawns = w.ctx.spawns ?? [];
  const nearSpawn = (q: Vec3): boolean => spawns.some((sp) => dist2(sp.pos, q) < R.spawnAvoidM * R.spawnAvoidM);
  const cand: Vec3[] = [];
  for (const o of w.ctx.pickups ?? []) {
    const q = { x: o.pos.x, y: o.pos.y - 0.5, z: o.pos.z };
    const node = navNode(nav, q);
    if (node >= 0 && nav.nodeMain[node]) cand.push(q);
  }
  const n = nav.nodeY.length;
  for (let k = 0; k < 10 && n > 0; k++) {
    const node = Math.min(n - 1, Math.floor(rand() * n));
    if (!nav.nodeMain[node] || nav.voidM[node]! < 2) continue;
    const q = nodePos(nav, node);
    if (!nearSpawn(q)) cand.push(q);
  }
  let best: Vec3 | null = null;
  let bestSc = -Infinity;
  for (const q of cand) {
    const d = Math.sqrt(dist2(q, p));
    if (d < R.roamMinM) continue;
    let fresh = 15;
    for (let k = 0; k + 1 < b.trail.length; k += 2) fresh = Math.min(fresh, Math.sqrt(dist2(q, { x: b.trail[k]!, z: b.trail[k + 1]! })));
    const sc = fresh - Math.max(0, d - 30) * 0.3 + rand() * 4;
    if (sc > bestSc) {
      best = q;
      bestSc = sc;
    }
  }
  return best;
}

/** Цена узла для A* (Р10): рельеф Земли — запрет, вооружённые зоны врагов — +8. Нет ни того ни другого — undefined. */
function pathCost(c: Ctx): ((n: number) => number) | undefined {
  const { s, me, nav, now } = c;
  const bans = s.terrain.map((t) => t.box);
  const zones = s.zones.filter((z) => z.owner !== me.id && now >= z.armTick && z.kind !== "steam" && z.kind !== "spring" && z.kind !== "pillar" && z.kind !== "quake");
  if (bans.length === 0 && zones.length === 0) return undefined;
  return (node: number): number => {
    const q = nodePos(nav, node);
    for (const bx of bans) {
      if (q.x + 0.4 > bx.min.x && q.x - 0.4 < bx.max.x && q.z + 0.4 > bx.min.z && q.z - 0.4 < bx.max.z && q.y + 1.8 > bx.min.y && q.y < bx.max.y) return Infinity;
    }
    let extra = 0;
    for (const z of zones) {
      const sh = z.shape;
      let inside = false;
      if (sh.type === "box") inside = q.x > sh.box.min.x - 0.4 && q.x < sh.box.max.x + 0.4 && q.z > sh.box.min.z - 0.4 && q.z < sh.box.max.z + 0.4;
      else if (sh.type === "disc") inside = dist2(q, sh.center) <= (sh.radius + 0.4) * (sh.radius + 0.4);
      else {
        const abx = sh.b.x - sh.a.x;
        const abz = sh.b.z - sh.a.z;
        const l2 = abx * abx + abz * abz;
        const k = l2 > 0 ? clampN(((q.x - sh.a.x) * abx + (q.z - sh.a.z) * abz) / l2, 0, 1) : 0;
        inside = dist2(q, { x: sh.a.x + abx * k, z: sh.a.z + abz * k }) <= (sh.halfW + 0.4) * (sh.halfW + 0.4);
      }
      if (inside) extra += 8;
    }
    return extra;
  };
}

/** Путь к goal (A*): от узла под ногами к безопасному узлу у цели. Нет пути — пустой. */
function planPath(c: Ctx, goal: Vec3): void {
  const { b, me, nav, now } = c;
  const p = me.move.body.pos;
  let from = navNode(nav, p);
  if (from < 0) from = nearestFloor(nav, p, 3);
  const to = safeNodeNear(nav, goal, 2.5, R.safeM, true);
  b.goal = { x: goal.x, y: goal.y, z: goal.z };
  b.pathTick = now;
  const path = from >= 0 && to >= 0 ? findPath(nav, from, to, pathCost(c)) : null;
  b.path = path ?? [];
  b.pathAt = b.path.length > 1 ? 1 : 0;
  b.pathFailed = path === null;
}

/**
 * Мысль (Р3): снимок → память → режим, цель и путь → план кита. Режимы: от края (враг с толчком у кромки), к сфере,
 * к руне (цели нет: видимый враг ближе полосы её заменяет), бой (цель видна и не дальше полосы), погоня, бродилка.
 */
function think(c: Ctx, period: number, threats: readonly Threat[]): void {
  const { b, me, nav, P, kit, now, rand, band } = c;
  perceive(c, period);
  const pos = me.move.body.pos;
  const orb = orbGoal(c);
  const rune = orb ? null : runeGoal(c);
  // от края (Р9): ближе 3 м к кромке в бою и враг с толчком ближе pushNearM или видимый в своей дальности толчка —
  // шаг от края; Ученик не отходит; к руне и сфере идут и у кромки (иначе топчется у моста)
  const fighting = b.mode === "combat" || b.mode === "edge";
  if (P.edgeStepAway && fighting && !orb && !rune && voidDistM(nav, pos) < R.dangerM) {
    const pusher = b.memory.some((m) => {
      const r = R.pushM[m.element];
      const d2 = dist2(m, pos);
      return r > 0 && (d2 <= R.pushNearM * R.pushNearM || (visibleMem(b, m) && d2 <= r * r));
    });
    if (pusher) {
      // куда отходить — ближний узел с запасом dangerM (с моста — на пол, а не вбок к другой кромке)
      const f = nearestSafe(nav, pos, 8, R.dangerM);
      const q = f >= 0 ? nodePos(nav, f) : null;
      if (q) {
        b.edgeUntil = now + ticks(R.edgeS);
        b.edgeX = q.x;
        b.edgeZ = q.z;
      }
    }
  }
  chooseTarget(c, rune && b.target === NOBODY ? band[1] : Infinity);
  const tm = memOf(b, b.target);
  let goal: Vec3 | null = null;
  let mode: BotMode;
  if (now < b.edgeUntil) mode = "edge";
  else if (orb) {
    mode = "orb";
    goal = orb;
  } else if (rune && b.target === NOBODY) {
    mode = "rune";
    goal = rune;
  } else if (tm) {
    const d = Math.sqrt(dist2(tm, pos));
    if (visibleMem(b, tm) && d <= band[1] + 1) mode = "combat";
    else {
      mode = "chase";
      goal = { x: tm.x, y: tm.y, z: tm.z };
      // проверил место и никого — забыть (по слуху — тоже)
      if (!visibleMem(b, tm) && d < 1.5) {
        b.memory = b.memory.filter((m) => m.id !== tm.id);
        dropTarget(b);
        mode = "roam";
        goal = null;
      }
    }
  } else mode = "roam";
  if (mode === "roam") {
    // дошёл — пауза 0,5–1,5 с (осматривается), потом новая точка; путь не нашёлся — тоже новая
    const arrived = b.goal !== null && dist2(b.goal, pos) < 2.25 && Math.abs(b.goal.y - pos.y) < 1.5;
    const failed = !arrived && b.pathFailed;
    if (b.mode === "roam" && arrived && b.pauseUntil === NEVER) {
      b.pauseUntil = now + ticks(between(rand, R.roamPauseS));
      b.lookYaw = me.move.yaw;
      goal = b.goal;
    } else if (b.mode !== "roam" || b.goal === null || failed || (arrived && now >= b.pauseUntil)) {
      goal = roamGoal(c);
      b.pauseUntil = NEVER;
    } else goal = b.goal;
  } else b.pauseUntil = NEVER;
  b.mode = mode;
  // путь: цель ушла от конца больше 2 м (не чаще раз в 10 тиков), раз в 30 тиков у погони, или пути нет
  if (goal && mode !== "combat" && mode !== "edge") {
    const moved = b.goal === null || dist2(goal, b.goal) > R.pathMoveM * R.pathMoveM;
    const exhausted = b.path.length === 0 || b.pathAt >= b.path.length;
    const since = now - b.pathTick;
    if ((moved && since >= 10) || (since >= R.pathTicks && (exhausted || mode === "chase"))) planPath(c, goal);
  } else if (mode === "combat" || mode === "edge") {
    b.path = [];
    b.goal = null;
  }
  // бой: смена стороны стрейфа, редкий прыжок
  if (mode === "combat") {
    if (now >= b.strafeUntil) {
      b.strafe = rand() < 0.5 ? -1 : 1;
      b.strafeUntil = now + ticks(between(rand, R.strafeS));
    }
    if (rand() < P.combatJumpChance) b.jumpReq = true;
  }
  // след бродилки: раз в 2 с, 12 точек
  if (now - b.trailTick >= 120) {
    b.trail = [...b.trail, pos.x, pos.z].slice(-24);
    b.trailTick = now;
  }
  // ульта полна с этого тика (Р5: Архимаг ждёт верного до ultWaitS)
  const ult = me.mage!.ult;
  if (ult.charge < ULT_CHARGE.max || ult.cast) b.ultSince = NEVER;
  else if (b.ultSince === NEVER) b.ultSince = now;
  // план кита (условия Q/E/C/X стихии), пока своего плана нет; спасение над пустотой — каждый тик в stepBot
  if (!b.plan) {
    const plan = kit.decide(viewOf(c, threats), rand);
    if (plan) b.plan = toPlan(c, plan);
  }
}

function toPlan(c: Ctx, p: CastPlan, rescue = false): BotPlan {
  const { P, now, rand } = c;
  const delay = p.urgent ? 0 : ticks(between(rand, P.castDelayS));
  const notBefore = now + delay;
  return {
    slot: p.slot, aim: p.aim ? { x: p.aim.x, y: p.aim.y, z: p.aim.z } : null, track: p.track ? p.track.id : NOBODY, trackDy: p.track ? p.track.dy : 0,
    // в памяти — без Infinity (JSON): скорость 0 — удар без полёта
    trackShot: { speed: p.track?.speed ?? 0, gravity: p.track?.gravity ?? 0, rangeM: 0, windupS: p.track?.windupS ?? 0, instant: !((p.track?.speed ?? 0) > 0) },
    move: p.move ? { x: p.move.x, z: p.move.z } : null, jump: p.jump === true, tolDeg: p.tolDeg ?? R.castTolDeg, notBefore, until: notBefore + ticks(p.ttlS ?? R.planTtlS),
    moveM: p.moveM ?? 0, holdJump: p.holdJumpS ? ticks(p.holdJumpS) : 0, rescue, groundRangeM: p.groundRangeM ?? 0,
    urgent: p.urgent === true,
  };
}

// ---------------------------------------------------------------- угрозы (Р4)

/**
 * Угрозы тика и решения по ним: новую бот замечает через свою реакцию после появления и один раз бросает, уйдёт ли
 * (телеграф — dodgeTelegraph, снаряд Q — dodgeProjectile, опасная зона под ногами — всегда). Возвращает замеченные.
 */
function noticeThreats(c: Ctx, raw: readonly Threat[]): { noticed: Threat[]; dodge: { t: Threat; memo: BotThreatMemo } | null } {
  const { b, P, now, rand } = c;
  const memos: BotThreatMemo[] = [];
  const noticed: Threat[] = [];
  let dodge: { t: Threat; memo: BotThreatMemo } | null = null;
  for (const t of raw) {
    let memo = b.threats.find((m) => m.key === t.key);
    if (!memo) {
      const chance = t.cls === "hazard" ? 1 : t.cls === "projectile" ? P.dodgeProjectile : P.dodgeTelegraph;
      memo = { key: t.key, notice: t.born + rollReaction(P, rand), dodge: rand() < chance, jumped: false };
    }
    memos.push(memo);
    if (now < memo.notice) continue;
    noticed.push(t);
    if (memo.dodge && t.inside && t.escape && (!dodge || t.etaS < dodge.t.etaS)) dodge = { t, memo };
  }
  b.threats = memos;
  return { noticed, dodge };
}

// ---------------------------------------------------------------- ход

/** Можно ли идти по d (Р9): на 0,6 и 1,2 м вперёд до кромки не меньше safeM. */
function stepOk(nav: NavGrid, p: Vec3, d: { x: number; z: number }): number {
  const a = voidDistM(nav, { x: p.x + d.x * R.probeNearM, y: p.y, z: p.z + d.z * R.probeNearM });
  if (a < R.safeM) return -1;
  const b2 = voidDistM(nav, { x: p.x + d.x * R.probeFarM, y: p.y, z: p.z + d.z * R.probeFarM });
  return b2 < R.safeM ? -1 : Math.min(a, b2);
}

/** Фильтр края (Р9): направление или повёрнутое на ±30°, ±60°, ±90°, ±120°, где безопасно; иначе стоять (null). */
function edgeFilter(nav: NavGrid, p: Vec3, d: { x: number; z: number }): { x: number; z: number } | null {
  if (stepOk(nav, p, d) >= 0) return d;
  for (const [cs, sn] of TURNS) {
    const l = { x: d.x * cs - d.z * sn, z: d.x * sn + d.z * cs };
    const r = { x: d.x * cs + d.z * sn, z: -d.x * sn + d.z * cs };
    const ql = stepOk(nav, p, l);
    const qr = stepOk(nav, p, r);
    if (ql < 0 && qr < 0) continue;
    return ql >= qr ? l : r;
  }
  return null;
}

/** Приземление прыжка с ходом v (м/с) не ближе landingM к кромке, середина полёта — не над краем (Р9). */
function landingOk(nav: NavGrid, p: Vec3, vx: number, vz: number): boolean {
  const end = { x: p.x + vx * JUMP_AIR_S, y: p.y, z: p.z + vz * JUMP_AIR_S };
  const mid = { x: p.x + vx * JUMP_AIR_S * 0.5, y: p.y, z: p.z + vz * JUMP_AIR_S * 0.5 };
  return voidDistM(nav, end) >= R.landingM && voidDistM(nav, mid) >= R.safeM;
}

/**
 * Спасение у края (Р9): в воздухе — если под ногами или по ходу (0,2–0,6 с) край; на полу — если толчок несёт к краю.
 * Курс — к ближайшему узлу с запасом до кромки 1 м. Ученик после удара правит курс только через реакцию.
 */
function safetyDir(c: Ctx): { x: number; z: number } | null {
  const { b, me, nav, P, now } = c;
  const p = me.move.body.pos;
  const onGround = me.move.onGround;
  const kb = me.kb;
  const kb2 = kb.x * kb.x + kb.z * kb.z;
  if (onGround && kb2 < 0.25) return null;
  if (P.lateAirFix && now - me.lastHitTick < b.reaction) return null;
  const vx = me.move.body.vel.x + kb.x;
  const vz = me.move.body.vel.z + kb.z;
  let danger = voidDistM(nav, p) < R.safeM;
  if (!danger) {
    const ts = onGround ? [1 / 6] : [0.2, 0.4, 0.6];
    for (const t of ts) {
      const q = onGround ? { x: p.x + kb.x * t + me.move.body.vel.x * 0.15, y: p.y, z: p.z + kb.z * t + me.move.body.vel.z * 0.15 } : { x: p.x + vx * t, y: p.y, z: p.z + vz * t };
      if (voidDistM(nav, q) < R.safeM) danger = true;
    }
  }
  if (!danger) return null;
  const f = nearestSafe(nav, p, 6, 1);
  if (f < 0) {
    // над пропастью (колонка без опоры или узла под ногами нет) voidDir ведёт к полу; на узле — от кромки
    const d = voidDir(nav, p);
    const col = navColumn(nav, p.x, p.z);
    const over = col < 0 || nav.colVoid[col] === 1 || columnNode(nav, p.x, p.z, p.y) < 0;
    return d && !over ? { x: -d.x, z: -d.z } : d;
  }
  const q = nodePos(nav, f);
  return norm2(q.x - p.x, q.z - p.z);
}

/** Бой (Р3): стрейф поперёк линии на цель, шаг к середине полосы. Цель — по памяти, продлённой на её возраст (≤ 1 с). */
function combatDir(c: Ctx, tm: BotMemory): { x: number; z: number } | null {
  const { b, me, now, band } = c;
  const p = me.move.body.pos;
  const age = Math.min(1, (now - tm.tick) / TICK_HZ);
  const dx = tm.x + tm.ax * age - p.x;
  const dz = tm.z + tm.az * age - p.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return { x: b.strafe, z: 0 };
  const ux = dx / d;
  const uz = dz / d;
  const [lo, hi] = band;
  const mid = (lo + hi) / 2;
  // своя точка боя кита (заход для Порыва, постановка под сброс) вместо полосы: к ней, рядом — мелкий стрейф
  const st = c.kit.stance ? c.kit.stance(viewOf(c, [])) : null;
  if (st) {
    const sx = st.x - p.x;
    const sz = st.z - p.z;
    const sd = Math.sqrt(sx * sx + sz * sz);
    // свой замах (Порыв под сброс): к точке прямо и стоять на ней — линия толчка не уходит вбок со стрейфом
    const winding = c.me.mage!.windup !== null;
    if (sd > 1) return winding ? { x: sx / sd, z: sz / sd } : norm2(sx / sd - uz * b.strafe * 0.3, sz / sd + ux * b.strafe * 0.3);
    if (winding) return sd > 0.3 ? { x: sx / sd, z: sz / sd } : null;
    return norm2(-uz * b.strafe * 0.4 + sx * 0.5, ux * b.strafe * 0.4 + sz * 0.5);
  }
  const radial = d < lo ? -1 : d > hi ? 1 : clampN((d - mid) / ((hi - lo) / 2), -1, 1) * 0.5;
  return norm2(ux * radial - uz * b.strafe * 0.85, uz * radial + ux * b.strafe * 0.85);
}

/** Прямая от from до to проходима шагом: колонки по пути с узлом на той же высоте (±0,6 м) и не у кромки. */
function clearLine(nav: NavGrid, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const L = Math.sqrt(dx * dx + dz * dz);
  const n = Math.ceil(L / 0.25);
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const y = from.y + (to.y - from.y) * t;
    const node = columnNode(nav, from.x + dx * t, from.z + dz * t, y);
    if (node < 0 || Math.abs(nav.nodeY[node]! - y) > 0.6 || nav.voidM[node]! < 0.75) return false;
  }
  return true;
}

/**
 * Ход по пути: дошёл до узла — следующий; по шагам — к самому дальнему из 5 следующих, до которого прямая проходима;
 * ребро «прыжок» — нажатие за 0,6 м до края верхней колонки. Путь кончился — null.
 */
function followPath(c: Ctx): { dir: { x: number; z: number } | null; jump: boolean } | null {
  const { b, me, nav } = c;
  const path = b.path;
  if (path.length === 0) return null;
  const p = me.move.body.pos;
  let at = b.pathAt;
  for (let k = at; k < Math.min(path.length, at + LOOKAHEAD + 1); k++) {
    const q = nodePos(nav, path[k]!);
    if (dist2(q, p) < REACH_M * REACH_M && Math.abs(q.y - p.y) < 0.8) at = k + 1;
  }
  b.pathAt = at;
  if (at >= path.length) {
    b.path = [];
    return null;
  }
  const kind = at > 0 ? edgeKindOf(nav, path[at - 1]!, path[at]!) : NAV_WALK;
  let steer = path[at]!;
  if (kind === NAV_WALK) {
    for (let k = at + 1; k < Math.min(path.length, at + LOOKAHEAD); k++) {
      if (edgeKindOf(nav, path[k - 1]!, path[k]!) !== NAV_WALK) break;
      if (!clearLine(nav, p, nodePos(nav, path[k]!))) break;
      steer = path[k]!;
    }
  }
  const sp = nodePos(nav, steer);
  const dir = norm2(sp.x - p.x, sp.z - p.z);
  const tq = nodePos(nav, path[at]!);
  const jump = kind === NAV_JUMP && me.move.onGround && dist2(tq, p) <= JUMP_AT_M * JUMP_AT_M;
  return { dir, jump };
}

// ---------------------------------------------------------------- взгляд

/** Поворот к goal с пределом скорости и разгоном (Р4): скорость, с которой ещё можно остановиться на цели. */
function turn(cur: number, goal: number, vel: number, maxW: number, acc: number): { a: number; w: number } {
  const err = wrap(goal - cur);
  const want = Math.sign(err) * Math.min(maxW, Math.sqrt(2 * acc * Math.abs(err)));
  const dv = acc * DT;
  let w = clampN(vel + clampN(want - vel, -dv, dv), -maxW, maxW);
  let step = w * DT;
  if (err !== 0 && Math.sign(step) === Math.sign(err) && Math.abs(step) > Math.abs(err)) {
    step = err;
    w = err / DT;
  }
  return { a: cur + step, w };
}

/**
 * Точка прицела по памяти (Р4): dy над ступнями с упреждением lead · (возраст снимка + полёт), у снаряда с гравитацией —
 * выше на дугу. pr — снаряд (по умолчанию ЛКМ стихии).
 */
function aimPoint(c: Ctx, m: BotMemory, dy: number, pr: BotPrimary = c.kit.primary): Vec3 {
  const { me, P, now } = c;
  const eye = eyeOf(me as Unit);
  const age = (now - m.tick) / TICK_HZ;
  const d0 = Math.sqrt((m.x - eye.x) * (m.x - eye.x) + (m.z - eye.z) * (m.z - eye.z));
  const tf = pr.instant ? pr.windupS : d0 / pr.speed + pr.windupS;
  const fresh = !m.heard && age <= 1.2;
  const ka = fresh ? P.aimTrack * age : 0;
  const kf = fresh ? P.lead * tf : 0;
  const x = m.x + m.vx * ka + m.ax * kf;
  const z = m.z + m.vz * ka + m.az * kf;
  let y = m.y + dy;
  if (pr.gravity > 0) {
    const dd = Math.sqrt((x - eye.x) * (x - eye.x) + (y - eye.y) * (y - eye.y) + (z - eye.z) * (z - eye.z));
    const t = dd / pr.speed;
    y += 0.5 * pr.gravity * t * t;
  }
  return { x, y, z };
}

/** Угол между взглядом (yaw, pitch) и направлением из глаз на точку, градусы. */
function angleTo(eye: Vec3, yaw: number, pitch: number, q: Vec3): number {
  const d = aimDir(yaw, pitch);
  const dx = q.x - eye.x;
  const dy = q.y - eye.y;
  const dz = q.z - eye.z;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (l < 1e-9) return 0;
  return Math.acos(clampN((d.x * dx + d.y * dy + d.z * dz) / l, -1, 1)) / DEG;
}

/**
 * Куда ляжет наземный каст по взгляду (yaw, pitch) — как видит игрок по прицелу (aimGround): луч на rangeM ловит тело
 * цели (по памяти, body — её ступни) — её ступни; иначе первое попадание в мир; ничего — конец дальности. Только XZ.
 */
function groundLanding(c: Ctx, eye: Vec3, yaw: number, pitch: number, rangeM: number, body: Vec3 | null): { x: number; z: number } {
  const d = aimDir(yaw, pitch);
  const hit = raycast(c.world(), eye, d, rangeM, "shot");
  const wallT = hit ? hit.dist : rangeM;
  const h2 = d.x * d.x + d.z * d.z;
  if (body && h2 > 1e-9) {
    // точка луча, ближайшая по XZ к оси тела, — внутри тела и до стены
    const hw = c.me.move.body.halfW;
    const t = clampN(((body.x - eye.x) * d.x + (body.z - eye.z) * d.z) / h2, 0, wallT);
    const y = eye.y + d.y * t;
    if (Math.abs(eye.x + d.x * t - body.x) <= hw && Math.abs(eye.z + d.z * t - body.z) <= hw && y >= body.y && y <= body.y + c.me.move.body.height) return { x: body.x, z: body.z };
  }
  return hit ? { x: hit.point.x, z: hit.point.z } : { x: eye.x + d.x * rangeM, z: eye.z + d.z * rangeM };
}

// ---------------------------------------------------------------- шаг

/** Без полёта и замаха: aimPoint с ним — где цель по памяти сейчас (её ступни при dy 0). */
const STILL_SHOT: BotPrimary = Object.freeze({ speed: 0, gravity: 0, rangeM: 0, windupS: 0, instant: true });

function slotReady(me: Readonly<Unit>, slot: "q" | "e" | "c" | "x", now: number): boolean {
  const m = me.mage!;
  if (slot === "x") return m.ult.charge >= ULT_CHARGE.max && !m.ult.cast;
  return now >= m.ready[slot as Slot];
}

/** Ввод бота на тик s.tick (до stepMatch этого тика). Чистая: аргументы не меняет. Мёртвый бот — idleInput. */
export function stepBot(bot: Readonly<BotState>, s: Readonly<MatchState>, w: BotWorld): { bot: BotState; input: MatchInput } {
  const b = clonePlain(bot as BotState);
  const now = s.tick;
  const me = unitById(s, b.id);
  if (!me?.mage) return { bot: b, input: { ...NO_MATCH_INPUT } };
  let rng = b.rng;
  const rand = (): number => {
    const r = nextRandom(rng);
    rng = r.state;
    return r.value;
  };
  let tw: World | null = null;
  const P = BOT_PARAMS[b.level];
  const kit = BOT_KITS[me.mage.element];
  const c: Ctx = {
    b, s, me, w, nav: w.nav, P, kit, now, rand, band: bandOf(kit, b.trait),
    world: () => (tw ??= buildTickWorld(w.ctx.world, s).world),
  };
  bookkeeping(c);
  // перестановка без смерти (старт боя): своя позиция скакнула — память, цель и путь сброшены
  const sp = me.move.body.pos;
  const jumped = b.selfX !== NEVER && dist2(sp, { x: b.selfX, z: b.selfZ }) > R.teleportM * R.teleportM;
  b.selfX = sp.x;
  b.selfZ = sp.z;
  if (jumped) forget(b);
  if (!me.alive) {
    forget(b);
    b.rng = rng;
    return { bot: b, input: idleInput(me) };
  }
  const nav = w.nav;
  const m = me.mage;
  const p = me.move.body.pos;
  const eye = eyeOf(me as Unit);
  const busy = m.windup !== null || m.ult.cast !== null || m.dash !== null;

  // угрозы — каждый тик, через реакцию
  const { noticed, dodge } = noticeThreats(c, scanThreats(s, me, nav));

  // мысль
  const period = Math.max(1, Math.round(TICK_HZ / P.thinkHz));
  if ((now + b.id) % period === 0) think(c, period, noticed);
  // спасение над пустотой (Р9): каждый тик, вытесняет любой план, кроме уже идущего спасения
  if (!me.move.onGround && kit.rescue && !b.plan?.rescue && voidDistM(nav, p) < R.safeM) {
    const r = kit.rescue(viewOf(c, noticed), rand);
    if (r) b.plan = toPlan(c, r, true);
  }
  const tm = memOf(b, b.target);

  // ход
  let dir: { x: number; z: number } | null = null;
  let jump = false;
  let pathMove = false;
  const paused = b.mode === "roam" && now < b.pauseUntil;
  const safe = safetyDir(c);
  if (safe) dir = safe;
  else if (dodge && !busy && me.move.onGround) {
    dir = dodge.t.escape;
    const jf = dodge.t.jumpFrom;
    const jt = dodge.t.jumpTo;
    if (jf !== null && jt !== null && now >= jf && now <= jt && !dodge.memo.jumped && landingOk(nav, p, (dir?.x ?? 0) * 6.5, (dir?.z ?? 0) * 6.5)) {
      jump = true;
      dodge.memo.jumped = true;
    }
  } else if (now < b.unstickUntil) dir = { x: b.unstickX, z: b.unstickZ };
  else if (b.mode === "edge") dir = norm2(b.edgeX - p.x, b.edgeZ - p.z);
  else if (b.mode === "combat" && tm) dir = combatDir(c, tm);
  else if (!paused) {
    const f = followPath(c);
    if (f) {
      dir = f.dir;
      jump = f.jump;
      pathMove = true;
    } else if (b.goal && b.mode !== "roam") {
      // пути нет (A* не нашёл) — прямо к цели, фильтр края не пустит в пропасть
      dir = norm2(b.goal.x - p.x, b.goal.z - p.z);
      pathMove = true;
    }
  }
  if (dir && me.move.onGround && !safe) dir = edgeFilter(nav, p, dir);
  // редкий прыжок в бою (Р3) — если приземление с запасом
  if (b.jumpReq) {
    if (me.move.onGround && !busy && landingOk(nav, p, (dir?.x ?? 0) * 6.5 + me.move.body.vel.x * 0.5, (dir?.z ?? 0) * 6.5 + me.move.body.vel.z * 0.5)) jump = true;
    b.jumpReq = false;
  }
  // застревание (Р10): 1,5 с без сдвига на 0,6 м по пути — прыжок, шаг вбок, новый путь
  if (Math.sqrt(dist2(p, { x: b.stuckX, z: b.stuckZ })) >= R.stuckM || !pathMove) {
    b.stuckTick = now;
    b.stuckX = p.x;
    b.stuckZ = p.z;
  } else if (now - b.stuckTick >= ticks(R.stuckS) && dir) {
    const sideK = rand() < 0.5 ? 1 : -1;
    b.unstickX = -dir.z * sideK;
    b.unstickZ = dir.x * sideK;
    b.unstickUntil = now + ticks(R.unstickS);
    if (me.move.onGround && landingOk(nav, p, b.unstickX * 6.5, b.unstickZ * 6.5)) jump = true;
    b.path = [];
    b.pathTick = NEVER;
    b.stuckTick = now;
  }
  // бой: стоит, хотя идёт (стена) — сменить сторону
  const hs = Math.sqrt(me.move.body.vel.x * me.move.body.vel.x + me.move.body.vel.z * me.move.body.vel.z);
  if (b.mode === "combat" && dir && hs < 0.8) {
    if (b.slowTick === NEVER) b.slowTick = now;
    else if (now - b.slowTick >= 20) {
      b.strafe = -b.strafe;
      b.strafeUntil = now + ticks(between(rand, R.strafeS));
      b.slowTick = NEVER;
    }
  } else b.slowTick = NEVER;

  // взгляд: план → цель → память → ход
  const plan = b.plan;
  let look: Vec3 | null = null;
  if (plan && now >= plan.notBefore) {
    const pm = plan.track !== NOBODY ? memOf(b, plan.track) : undefined;
    look = pm ? aimPoint(c, pm, plan.trackDy, plan.trackShot) : plan.aim;
  }
  const visible = visibleMem(b, tm);
  const aim = tm ? (visible ? aimPoint(c, tm, CHEST_M) : { x: tm.x, y: tm.y + CHEST_M, z: tm.z }) : null;
  if (!look && aim) look = aim;
  let yawGoal: number;
  let pitchGoal: number;
  if (look) {
    const dx = look.x - eye.x;
    const dz = look.z - eye.z;
    yawGoal = yawTo(dx, dz);
    pitchGoal = Math.atan2(look.y - eye.y, Math.sqrt(dx * dx + dz * dz));
  } else {
    // по ходу, поглядывая по сторонам; на паузе бродилки — осматривается ±70°
    const sweep = Math.sin((2 * Math.PI * (now + b.id * 17)) / 150) * DEG;
    yawGoal = paused ? b.lookYaw + 70 * sweep : dir ? yawTo(dir.x, dir.z) + 30 * sweep : me.move.yaw;
    pitchGoal = 0;
  }
  // дрейф ошибки (Р4): цель дрейфа раз в ~0,4 с, σ ×1,3 на бегу, ×2 на новой цели
  const sigma = P.aimSigmaDeg * DEG * (hs > 1 ? P.aimMoveMul : 1) * (now < b.newTargetUntil ? P.aimNewTargetMul : 1);
  if (now >= b.driftAt) {
    b.errYawGoal = gauss(rand) * sigma;
    b.errPitchGoal = gauss(rand) * sigma * 0.5;
    b.driftAt = now + Math.max(1, ticks(P.aimDriftS * (0.75 + 0.5 * rand())));
  }
  b.errYaw += (b.errYawGoal - b.errYaw) * DRIFT_K;
  b.errPitch += (b.errPitchGoal - b.errPitch) * DRIFT_K;
  const maxW = P.turnDegS * DEG;
  const acc = P.turnAccelDegS2 * DEG;
  const ty = turn(me.move.yaw, yawGoal + b.errYaw, b.yawVel, maxW, acc);
  const tp = turn(me.move.pitch, clampN(pitchGoal + b.errPitch, -MAX_PITCH, MAX_PITCH), b.pitchVel, maxW, acc);
  b.yawVel = ty.w;
  b.pitchVel = tp.w;
  const yaw = ty.a;
  const pitch = clampN(tp.a, -MAX_PITCH, MAX_PITCH);

  // ЛКМ (Р4): цель видна (в осознанном снимке и луч сейчас открыт), не под защитой, в дальности, взгляд у точки
  let primary = false;
  if (tm && aim && visible && !busy) {
    const tu = unitById(s, tm.id);
    const range = Math.sqrt((aim.x - eye.x) * (aim.x - eye.x) + (aim.y - eye.y) * (aim.y - eye.y) + (aim.z - eye.z) * (aim.z - eye.z));
    if (tu?.alive && now >= tu.status.shieldUntil && range <= kit.primary.rangeM && angleTo(eye, yaw, pitch, aim) <= R.fireTolDeg + sigma / DEG) {
      primary = kit.holdPrimary(me, P, perceived(c, tm), now) && canSee(c.world(), eye, tu);
    }
  }

  // план: задержка вышла, слот готов, кнопка была отпущена, взгляд у точки — нажатие на один тик
  const btn = { q: false, e: false, c: false, x: false };
  if (plan) {
    if (now > plan.until) b.plan = null;
    else if (now >= plan.notBefore) {
      const aimed = plan.aim !== null || plan.track !== NOBODY;
      // прицельный каст по плану не жмётся в своём замахе или рывке: игра держит нажатие в буфере, и каст уходит
      // позже — со взглядом того тика, уже не на точку плана (столб улетал на всю дальность)
      const free = !aimed || plan.urgent || !busy;
      const ready = free && (plan.slot === null || (slotReady(me, plan.slot, now) && !m.held[plan.slot])) && (!plan.jump || !me.move.jumpHeld);
      let aligned = !aimed || (look !== null && angleTo(eye, yaw, pitch, look) <= plan.tolDeg);
      // наземный каст: точка под прицелом — у точки плана или под телом цели, а не в укрытии перед собой (столб под
      // себя за стеной) и не в конце дальности за промахнувшимся лучом
      if (aligned && look && plan.groundRangeM > 0) {
        const pm = plan.track !== NOBODY ? memOf(b, plan.track) : undefined;
        const body = pm ? aimPoint(c, pm, 0, STILL_SHOT) : null;
        const at = groundLanding(c, eye, yaw, pitch, plan.groundRangeM, body);
        const near = (q: { x: number; z: number }): boolean => dist2(at, q) <= R.groundTolM * R.groundTolM;
        aligned = near(look) || (body !== null && near(body));
      }
      // рывок по отложенному плану: бот с тех пор сдвинулся — приземление проверяется заново (Р9)
      if (ready && plan.move && plan.moveM > 0 && !dashLandingOk(nav, p, plan.move, plan.moveM)) b.plan = null;
      else if (ready && aligned) {
        if (plan.slot) btn[plan.slot] = true;
        // ЛКМ на том же тике начала бы замах раньше слота (порядок слотов: ЛКМ первой) — и слот ушёл бы в буфер
        if (aimed && !plan.urgent) primary = false;
        if (plan.jump) jump = true;
        if (plan.jump && plan.holdJump > 0) b.jumpHoldUntil = now + plan.holdJump;
        if (plan.move) dir = { x: plan.move.x, z: plan.move.z };
        b.plan = null;
      }
    }
  }

  // ввод: желаемое направление по XZ → оси взгляда этого тика
  const f = forwardXZ(yaw);
  const r = rightXZ(yaw);
  const dx = dir?.x ?? 0;
  const dz = dir?.z ?? 0;
  const input: MatchInput = {
    moveX: dx * r.x + dz * r.z, moveZ: dx * f.x + dz * f.z, jump: (jump && !me.move.jumpHeld) || (now < b.jumpHoldUntil && me.move.jumpHeld), yaw, pitch,
    primary, q: btn.q, e: btn.e, c: btn.c, x: btn.x,
  };
  b.rng = rng;
  return { bot: b, input };
}
