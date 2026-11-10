import type { AABB, Pickup, PickupKind, PlayerInput, PlayerState, Spawn, Vec3 } from "../types";
import type { World } from "../world";

/**
 * Контракты фаз 2-lite и 4. Только простые данные: состояние и события уходят в JSON и по сети без потерь.
 * «Нет» — NOBODY (−1), а не undefined; времена — номера тиков (60 Гц), а не секунды.
 */
export type Element = "fire" | "earth" | "air" | "water";
/** Порядок стихий: клавиши 1–4 (Р17 фазы 4). */
export const ELEMENTS: readonly Element[] = ["fire", "earth", "air", "water"];
/** ЛКМ — атака, Q — приём, E — спасение, C — поле или контроль, X — ульта (GDD 2.2). */
export type Slot = "primary" | "q" | "e" | "c" | "x";
export const SLOTS: readonly Slot[] = ["primary", "q", "e", "c", "x"];
export const ABILITY_IDS = [
  "fireFists", "fireball", "jetDash", "fireWall",
  "stoneShot", "stonePillar", "stoneWall", "earthquake",
  "airSickle", "gust", "swoop", "tornado",
  "waterWhip", "waterGrab", "waterWard", "spring",
  "dragonBreath", "tectonicRift", "hurricane", "tsunami",
] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];
/** Ульты по стихиям в порядке ELEMENTS. */
export const ULT_IDS = ["dragonBreath", "tectonicRift", "hurricane", "tsunami"] as const;
export type UltId = (typeof ULT_IDS)[number];
/** Чем нанесён урон: способностью или горением. */
export type DamageSource = AbilityId | "burning";
export type UnitId = number;
export const NOBODY: UnitId = -1;
/** «Давно»: тик, от которого любое окно уже закрыто. */
export const NEVER = -1_000_000;

/** Ввод мага за тик: движение и взгляд фазы 1 плюс кнопки. Нажатие — переход false → true между тиками. */
export interface MatchInput extends PlayerInput { primary: boolean; q: boolean; e: boolean; c: boolean; x: boolean }
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
  /** Иммунитет к жёсткому контролю (подброс, обездвиживание); подброс в это время ×0,5, вбок — полностью (K2). */
  immuneUntil: number;
  /** «Защита после появления»: урона нет, пока now < shieldUntil; свой принятый каст снимает. */
  shieldUntil: number;
  /** «Мокрый» (GDD 4.1): гасит и не пускает Горение, пока now < wetUntil. */
  wetUntil: number;
  /** Пар с этой цели — не раньше этого тика (раз в 3 с). */
  steamReadyAt: number;
  /** K1: своё ускорение ×0,3, пока now < staggerUntil. Не контроль. */
  staggerUntil: number;
  /** «Якорь» диска Отражения: толчок, подброс, буксир и тяга не действуют, пока now < anchoredUntil. */
  anchoredUntil: number;
  /** Руна ярости (GDD 3): урон ×1,3, пока now < furyUntil; смерть снимает. */
  furyUntil: number;
}

/** Буксир Хвата: тащит по XZ к (x, z) со скоростью speed, м/с, до endTick; без гравитации. */
export interface Tow { x: number; z: number; speed: number; endTick: number; by: UnitId }
/** Удар о стену, который ждёт в канале толчка (Порыв): кто, чем, сколько урона. */
export interface Slam { by: UnitId; ability: AbilityId; damage: number }
/** Рывок (Реактивный рывок, Взмах): направление, начало и конец, зона следа (NOBODY — без следа). */
export interface DashState { ability: AbilityId; dirX: number; dirZ: number; startTick: number; endTick: number; trailZone: number }
/** «Лёгкость» Воздуха: второй прыжок потрачен, тиков парения с прыжка, парит ли на этом тике. */
export interface FlightState { doubleJumped: boolean; glideTicks: number; gliding: boolean }
/** Диск Отражения: до какого тика стоит и сколько урона впитал. */
export interface WardState { endTick: number; absorbed: number }
/** Идущая ульта: телеграф до releaseTick, действие до endTick (stepUlts снимает на endTick); zone — её зона или NOBODY. */
export interface UltCast { ability: UltId; startTick: number; releaseTick: number; endTick: number; zone: number }
/** Ульта (X, GDD 3): заряд 0…100 (дробный) и идущий каст. */
export interface UltState { charge: number; cast: UltCast | null }

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
  /** Рывок (Реактивный рывок, Взмах): ведёт кит через dash.ts; moveUnits мага в рывке пропускает. */
  dash: DashState | null;
  /** Заряды слота (Взмах): сколько есть и тик следующего (NEVER — все на месте). У прочих слотов 0 и NEVER. */
  charges: Record<Slot, number>;
  chargeAt: Record<Slot, number>;
  /** «Лёгкость» Воздуха; у прочих стихий не меняется. */
  flight: FlightState;
  /** Диск Отражения Воды; null — не стоит. */
  ward: WardState | null;
  /** Ульта: заряд и идущий каст (ult.ts). Смерть заряд не сжигает, смена стихии — сжигает (Р2). */
  ult: UltState;
  /** Где маг появился последним: в PvP — точка pickSpawn, на полигоне — своя. */
  spawn: Spawn;
  /** deaths — смерти от урона и падения, в том числе свои. */
  stats: { damage: number; kills: number; falls: number; deaths: number };
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
  /** Буксир Хвата: пока не null, юнита тащит stepTow, а не шаги. */
  tow: Tow | null;
  /** Удар о стену, который ждёт в канале толчка. */
  slam: Slam | null;
  /** Кто бил за последние 5 с (помощь, Р1): по одной записи на юнита, tick — последний удар. */
  hitters: { unit: UnitId; tick: number }[];
}

/** Виды снарядов. Ответ Отражения — свой вид, засчитывается способности waterWard (PROJECTILE_SOURCE). */
export const PROJECTILE_KINDS = ["fireFists", "fireball", "stoneShot", "airSickle", "waterGrab", "waterAnswer"] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];
/** После шага тика endTick − 1 снаряд исчезает (огненный шар — взрывается). power — урон попадания: по таблице вида, у Ответа — впитанное. */
export interface Projectile { id: number; owner: UnitId; ability: ProjectileKind; pos: Vec3; vel: Vec3; bornTick: number; endTick: number; power: number }

export type ZoneKind = "fireWall" | "fireTrail" | "pillar" | "quake" | "tornado" | "fireTornado" | "sandTornado" | "spring" | "steam" | "bog" | "rift" | "tsunami";
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
  /** «Огненный вал»: стена едет на (x, z) м за тик, пока now < untilTick; нет поля — стоит. */
  drift?: { x: number; z: number; untilTick: number };
}

export type TerrainKind = "wall" | "pillar";
/** box — итоговый бокс коллизии; growTicks — рост рисунка (только вид); solid ставит stepTerrain на solidTick. */
export interface Terrain {
  id: number; owner: UnitId; kind: TerrainKind; box: AABB;
  bornTick: number; solidTick: number; endTick: number; growTicks: number;
  solid: boolean; hp: number; maxHp: number;
}

/** Объект на карте (фаза 6): лежит, пока now ≥ readyAt; взят — readyAt уходит вперёд. pos — точка арены (0,5 м над полом). */
export interface PickupState { kind: PickupKind; pos: Vec3; readyAt: number }

/**
 * tick — сколько тиков посчитано (следующий шаг считает тик с этим номером); units по возрастанию id. pickups — объекты
 * на карте в порядке MatchContext.pickups (stepMatch заводит их сам).
 */
export interface MatchState { tick: number; units: Unit[]; projectiles: Projectile[]; zones: Zone[]; terrain: Terrain[]; nextId: number; pickups: PickupState[] }

export type ReactionKind = "steam" | "fireTornado" | "fireRampart" | "bog" | "boilOff" | "sandTornado";
export type StatusKind = "burning" | "slow" | "root" | "airborne" | "wet" | "fury";
export type RejectReason = "cooldown" | "busy" | "notGrounded" | "noTarget" | "rooted" | "uncharged";

export type MatchEvent =
  /** Нажатие принято: замах или мгновенный каст. pos — глаза, dir — прицел. */
  | { type: "cast"; unit: UnitId; ability: AbilityId; slot: Slot; pos: Vec3; dir: Vec3 }
  /** Снаряд выпущен (конец замаха или выстрел ЛКМ). Способность без снаряда (Порыв) — projectile −1; у Ответа ability — waterWard. */
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
  | { type: "dash"; unit: UnitId; ability: AbilityId; phase: "start" | "end"; pos: Vec3; dir: Vec3 }
  | { type: "overheat"; unit: UnitId; on: boolean }
  | { type: "courage"; unit: UnitId }
  | { type: "death"; target: UnitId; killer: UnitId; ability: DamageSource; pos: Vec3 }
  | { type: "fall"; target: UnitId; credit: UnitId; pos: Vec3 }
  | { type: "respawn"; target: UnitId; pos: Vec3; yaw: number }
  /** Мгновенный удар лучом (Порыв): от глаз до цели; target — NOBODY, если никого. */
  | { type: "beam"; unit: UnitId; ability: AbilityId; from: Vec3; to: Vec3; target: UnitId }
  /** Чужой снаряд сдут (Порыв). */
  | { type: "blown"; unit: UnitId; projectile: number; kind: ProjectileKind; owner: UnitId; pos: Vec3 }
  /** Удар о стену: канал толчка упёрся в стену на скорости. */
  | { type: "slam"; target: UnitId; source: UnitId; pos: Vec3 }
  | { type: "airJump"; unit: UnitId; pos: Vec3 }
  | { type: "glide"; unit: UnitId; on: boolean; pos: Vec3 }
  /** Заряд слота вернулся; charges — сколько их теперь. */
  | { type: "charge"; unit: UnitId; slot: Slot; charges: number }
  /** Диск Отражения впитал снаряд: amount — его power, total — всего впитано. */
  | { type: "absorb"; unit: UnitId; projectile: number; kind: ProjectileKind; owner: UnitId; amount: number; total: number; pos: Vec3 }
  | { type: "ward"; unit: UnitId; phase: "up" | "down"; absorbed: number }
  | { type: "tow"; target: UnitId; source: UnitId; phase: "start" | "end"; pos: Vec3; to: Vec3 }
  /** Лечение: amount — фактически прибавленное; source NOBODY — сфера жизни на карте (фаза 6). */
  | { type: "heal"; target: UnitId; source: UnitId; amount: number; pos: Vec3 }
  /** Реакция стихий: облако пара, огненный смерч, «Огненный вал», «Топь» или «Выкипание»; zone — её зона. */
  | { type: "reaction"; kind: ReactionKind; owner: UnitId; zone: number; pos: Vec3 }
  /** Ульта: ready — заряд дошёл до 100; release — конец телеграфа; end — каст снят (кончился или маг умер). */
  | { type: "ult"; unit: UnitId; ability: UltId; phase: "ready" | "release" | "end"; pos: Vec3; dir: Vec3 }
  /** Объект на карте: warn — руна через 10 с; spawn — появился (unit NOBODY у обоих); take — взят магом unit. index — номер в state.pickups. */
  | { type: "pickup"; kind: PickupKind; index: number; phase: "warn" | "spawn" | "take"; unit: UnitId; pos: Vec3 }
  /** Ярость снята: end — время вышло; slain — носитель погиб, by — убийца или засчитанный сбросивший (+10 к ульте) или NOBODY. pos — подошва. */
  | { type: "fury"; unit: UnitId; phase: "end" | "slain"; by: UnitId; pos: Vec3 };

export interface MatchStep { state: MatchState; events: MatchEvent[] }

/** Статика матча: статический мир арены (без рельефа) и высота сброса (низ арены). Новые поля необязательны: без них полигон считается как раньше. */
export interface MatchContext {
  readonly world: World;
  readonly killBelowY: number;
  /** PvP: точки возрождения. Маг встаёт на дальнюю от живых врагов (pickSpawn). Нет поля — на свою mage.spawn. */
  readonly spawns?: readonly Spawn[];
  /** Через сколько секунд возрождается маг. Нет поля — MATCH.mageRespawnS (полигон, 1 с). */
  readonly mageRespawnS?: number;
  /** Защита после появления, с. Нет поля — 0: защиты нет. */
  readonly spawnShieldS?: number;
  /** Множитель заряда ульты (Р12): полигон 10, нет поля — 1. */
  readonly ultChargeMul?: number;
  /** Объекты на карте: matchContext берёт их из арены. Нет поля — объектов нет. */
  readonly pickups?: readonly Pickup[];
  /** Полигон: маг там не ранится, поэтому сферу берёт и маг с полным HP (лечения нет, подбор виден). Нет поля — только раненый (Р1 фазы 6). */
  readonly orbsAtFullHp?: boolean;
}

/**
 * Что видит один тик: мир с рельефом на начало тика и куда писать события. Динамический коллайдер k
 * (номер colliders.length + k) — рельеф terrainIds[k], если k < terrainIds.length; дальше — стены огня и облака пара.
 * spawns, mageRespawnTicks, spawnShieldTicks и ultChargeMul stepMatch берёт из MatchContext (нет точек — null, нет множителя — 1).
 */
export interface TickCtx {
  readonly world: World; readonly terrainIds: readonly number[]; readonly killBelowY: number; readonly now: number; readonly ev: MatchEvent[];
  readonly spawns: readonly Spawn[] | null; readonly mageRespawnTicks: number; readonly spawnShieldTicks: number;
  readonly ultChargeMul: number;
  /** MatchContext.orbsAtFullHp; нет поля — false. */
  readonly orbsAtFullHp?: boolean;
}
