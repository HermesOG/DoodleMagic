import type { AABB, PlayerInput, PlayerState, Spawn, Vec3 } from "../types";
import type { World } from "../world";

/**
 * Контракты фазы 2-lite. Только простые данные: состояние и события уходят в JSON и по сети без потерь.
 * «Нет» — NOBODY (−1), а не undefined; времена — номера тиков (60 Гц), а не секунды.
 */
export type Element = "fire" | "earth";
export const ELEMENTS: readonly Element[] = ["fire", "earth"];
/** ЛКМ — атака, Q — приём, E — спасение, C — поле или контроль (GDD 2.2). */
export type Slot = "primary" | "q" | "e" | "c";
export const SLOTS: readonly Slot[] = ["primary", "q", "e", "c"];
export const ABILITY_IDS = ["fireFists", "fireball", "jetDash", "fireWall", "stoneShot", "stonePillar", "stoneWall", "earthquake"] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];
/** Чем нанесён урон: способностью или горением. */
export type DamageSource = AbilityId | "burning";
export type UnitId = number;
export const NOBODY: UnitId = -1;
/** «Давно»: тик, от которого любое окно уже закрыто. */
export const NEVER = -1_000_000;

/** Ввод мага за тик: движение и взгляд фазы 1 плюс кнопки. Нажатие — переход false → true между тиками. */
export interface MatchInput extends PlayerInput { primary: boolean; q: boolean; e: boolean; c: boolean }
export type Buttons = Pick<MatchInput, Slot>;
/** Отбрасывание из карточки, метры: вбок по ровному полу и вверх (GDD 2.2). */
export interface Knockback { distM: number; upM: number }

/** «…Until» — тик, с которого статус снят (действует, пока now < until). */
export interface Statuses {
  /** Горение: сколько импульсов урона осталось, тик следующего, чьё. */
  burnPulses: number; burnNext: number; burnBy: UnitId;
  slowUntil: number; slowMul: number;
  rootUntil: number;
  /** «В воздухе»: подброшен способностью, держится до приземления. */
  airborne: boolean; noControlUntil: number;
  /** Иммунитет к жёсткому контролю (подброс, обездвиживание); отбрасывание в это время ×0,5. */
  immuneUntil: number;
}

export interface MageState {
  element: Element;
  /** Тик, с которого слот снова готов. */
  ready: Record<Slot, number>;
  /** Кнопки прошлого тика — для нажатий. */
  held: Buttons;
  /**
   * Буфер нажатий: тик нажатия слота, которое ждёт, пока каст станет возможен (перезарядка или замах, до 0,3 с);
   * NEVER — ничего не ждёт.
   */
  pending: Record<Slot, number>;
  /** Замах: выпуск на releaseTick, прицел — на тике выпуска. */
  windup: { ability: AbilityId; slot: Slot; releaseTick: number } | null;
  /** Жар Огня 0…100; у Земли всегда 0. */
  heat: number; overheatUntil: number; lastShotTick: number;
  /** Реактивный рывок: направление по XZ, тик окончания, id зоны следа. */
  dash: { dirX: number; dirZ: number; endTick: number; trailZone: number } | null;
  spawn: Spawn;
  stats: { damage: number; kills: number; falls: number };
}

/** Манекен ходит вдоль rightXZ(yaw) на ±patrolHalfM от точки; без patrolHalfM стоит. */
export interface DummySpot { pos: Vec3; yaw: number; patrolHalfM?: number }
/** dir: +1 вправо, −1 влево, 0 — ещё не начал. */
export interface DummyState { spot: DummySpot; dir: number }

export interface Unit {
  id: UnitId;
  kind: "mage" | "dummy";
  /** Тело и движение — то же состояние, что у stepPlayer фазы 1. */
  move: PlayerState;
  hp: number; maxHp: number;
  /** Канал отбрасывания: горизонтальная скорость, м/с, гаснет сама. */
  kb: { x: number; z: number };
  status: Statuses;
  lastHitTick: number; lastHitBy: UnitId;
  /** Пока !alive — тик возрождения в respawnTick. */
  alive: boolean; respawnTick: number;
  mage: MageState | null;
  dummy: DummyState | null;
}

/** После шага тика endTick − 1 снаряд исчезает (огненный шар — взрывается). */
export interface Projectile { id: number; owner: UnitId; ability: "fireFists" | "fireball" | "stoneShot"; pos: Vec3; vel: Vec3; bornTick: number; endTick: number }

export type ZoneKind = "fireWall" | "fireTrail" | "pillar" | "quake";
export type ZoneShape =
  | { type: "box"; box: AABB }
  | { type: "segment"; a: Vec3; b: Vec3; halfW: number }
  | { type: "disc"; center: Vec3; radius: number };
/** До armTick — телеграф; разовые (столб, землетрясение) бьют ровно на armTick; на endTick зона исчезает. */
export interface Zone {
  id: number; owner: UnitId; kind: ZoneKind; ability: AbilityId; shape: ZoneShape;
  bornTick: number; armTick: number; endTick: number;
  /** Кого и с какого тика можно задеть снова. */
  rehit: { unit: UnitId; tick: number }[];
}

export type TerrainKind = "wall" | "pillar";
/** box — итоговый бокс коллизии; growTicks — рост рисунка (только вид); solid ставит stepTerrain на solidTick. */
export interface Terrain {
  id: number; owner: UnitId; kind: TerrainKind; box: AABB;
  bornTick: number; solidTick: number; endTick: number; growTicks: number;
  solid: boolean; hp: number; maxHp: number;
}

/** tick — сколько тиков посчитано (следующий шаг считает тик с этим номером); units по возрастанию id. */
export interface MatchState { tick: number; units: Unit[]; projectiles: Projectile[]; zones: Zone[]; terrain: Terrain[]; nextId: number }

export type StatusKind = "burning" | "slow" | "root" | "airborne";
export type RejectReason = "cooldown" | "busy" | "notGrounded" | "noTarget" | "rooted";

export type MatchEvent =
  /** Нажатие принято: замах или мгновенный каст. pos — глаза, dir — прицел. */
  | { type: "cast"; unit: UnitId; ability: AbilityId; slot: Slot; pos: Vec3; dir: Vec3 }
  /** Снаряд выпущен (конец замаха или выстрел ЛКМ). */
  | { type: "release"; unit: UnitId; ability: AbilityId; projectile: number; pos: Vec3; dir: Vec3 }
  | { type: "reject"; unit: UnitId; slot: Slot; reason: RejectReason }
  /** Первая фаза попадания: снаряд во что-то врезался. Нет цели — target NOBODY, terrain −1. */
  | { type: "impact"; ability: AbilityId; owner: UnitId; pos: Vec3; normal: Vec3; target: UnitId; terrain: number }
  | { type: "explosion"; ability: AbilityId; owner: UnitId; pos: Vec3; radius: number }
  /** Вторая фаза: урон засчитан. dir — куда толкнуло по XZ, knock — итоговое отбрасывание. */
  | { type: "hit"; source: UnitId; target: UnitId; ability: DamageSource; amount: number; pos: Vec3; dir: Vec3; knock: Knockback; airborne: boolean; dot: boolean; killed: boolean }
  | { type: "status"; target: UnitId; status: StatusKind; ticks: number; source: UnitId }
  | { type: "zone"; zone: number; kind: ZoneKind; owner: UnitId; phase: "telegraph" | "arm" | "end" }
  | { type: "terrain"; terrain: number; kind: TerrainKind; owner: UnitId; phase: "rise" | "solid" | "hit" | "break" | "expire"; pos: Vec3; amount: number }
  | { type: "dash"; unit: UnitId; phase: "start" | "end"; pos: Vec3; dir: Vec3 }
  | { type: "overheat"; unit: UnitId; on: boolean }
  | { type: "courage"; unit: UnitId }
  | { type: "death"; target: UnitId; killer: UnitId; ability: DamageSource; pos: Vec3 }
  | { type: "fall"; target: UnitId; credit: UnitId; pos: Vec3 }
  | { type: "respawn"; target: UnitId; pos: Vec3; yaw: number };

export interface MatchStep { state: MatchState; events: MatchEvent[] }

/** Статика матча: статический мир арены (без рельефа) и высота сброса (низ арены). */
export interface MatchContext { readonly world: World; readonly killBelowY: number }

/**
 * Что видит один тик: мир с рельефом на начало тика и куда писать события. Динамический коллайдер k
 * (номер colliders.length + k) — рельеф terrainIds[k], если k < terrainIds.length; дальше — стены огня.
 */
export interface TickCtx { readonly world: World; readonly terrainIds: readonly number[]; readonly killBelowY: number; readonly now: number; readonly ev: MatchEvent[] }
