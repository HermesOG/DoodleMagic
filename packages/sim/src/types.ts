/**
 * Контракты фазы 1: общие типы и константы для потоков A (физика), B (арена) и C (рендер).
 * Здесь нет логики, только формы данных. Всё — простые данные: уходит в JSON и по сети без потерь.
 */

// ---------------------------------------------------------------- геометрия

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Axis = "x" | "y" | "z";

/** Бокс по осям, min ≤ max по каждой оси. */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

// ---------------------------------------------------------------- мир

/**
 * Флаги коллайдера. По умолчанию бокс держит движение, снаряды и взгляд.
 * - `noShoot` — перила и решётки: держит только движение, снаряды и взгляд проходят насквозь.
 * - `noSight` — трава, пар, стена огня: только закрывает обзор, движение и снаряды проходят насквозь.
 */
export interface ColliderFlags {
  noShoot?: true;
  noSight?: true;
}

export interface Collider extends ColliderFlags {
  box: AABB;
  /** Метка для тестов и отладки: "bridge", "kerb"… На физику не влияет. */
  tag?: string;
}

export type VolumeKind = "updraft" | "kill" | "grass";

/** Объём без коллизии: восходящий поток, зона смерти, трава. */
export interface Volume {
  kind: VolumeKind;
  box: AABB;
  /** Только для потока: до какой высоты над низом объёма он поднимает, м. */
  liftM?: number;
}

/** Вид запроса к миру: движение, снаряд или взгляд. */
export type RayKind = "move" | "shot" | "sight";

// ---------------------------------------------------------------- арена

/** Материалы арены. Клиент сам решает, какими чернилами рисовать каждый. */
export const MATERIALS = ["stone", "floor", "roof", "grass", "edge", "gold"] as const;
export type Material = (typeof MATERIALS)[number];

export interface RenderBox {
  box: AABB;
  material: Material;
}

export interface Spawn {
  /** Середина подошвы. */
  pos: Vec3;
  /** Куда смотрит появившийся маг, рад (как PlayerInput.yaw). */
  yaw: number;
}

export type PickupKind = "orb" | "rune";

export interface Pickup {
  kind: PickupKind;
  pos: Vec3;
}

export type ArenaVariant = "full" | "compact";

export interface ArenaData {
  name: string;
  variant: ArenaVariant;
  /** Заявленные габариты: в них лежит всё остальное. */
  bounds: AABB;
  colliders: Collider[];
  volumes: Volume[];
  render: RenderBox[];
  spawns: Spawn[];
  pickups: Pickup[];
}

// ---------------------------------------------------------------- тело и игрок

/** Тело персонажа: бокс 2·halfW × height × 2·halfW, pos — середина подошвы. */
export interface Body {
  pos: Vec3;
  vel: Vec3;
  halfW: number;
  height: number;
  /** Ступенька, на которую тело заходит без прыжка, м. */
  stepHeight: number;
}

export interface MoveResult {
  onGround: boolean;
  hitWall: boolean;
  hitCeiling: boolean;
  /** Вертикальная скорость в момент приземления (< 0) или 0, если в этом шаге приземления не было. */
  landVel: number;
  /** Заходили ли на ступеньку. */
  stepped: boolean;
}

/** Ввод за один тик. Только простые данные: его можно переслать хосту как есть. */
export interface PlayerInput {
  /** Стрейф: −1 влево … +1 вправо. */
  moveX: number;
  /** Вперёд-назад: +1 вперёд … −1 назад. */
  moveZ: number;
  /** Кнопка прыжка зажата. Нажатие — переход false → true между тиками. */
  jump: boolean;
  /** Поворот вокруг Y, рад. 0 — взгляд вдоль −Z, положительный — влево (как в three.js). */
  yaw: number;
  /** Наклон взгляда, рад, положительный — вверх. */
  pitch: number;
}

export interface PlayerState {
  body: Body;
  onGround: boolean;
  /** Сколько ещё секунд можно прыгнуть после схода с края. */
  coyote: number;
  /** Сколько ещё секунд помним нажатие прыжка. */
  jumpBuffer: number;
  jumpHeld: boolean;
  yaw: number;
  pitch: number;
  /** Скорость приземления в этом тике (< 0) или 0. Нужна рукам и камере. */
  landVel: number;
}

/** Параметры движения мага. GDD, раздел 3: бег 6–7 м/с, один прыжок 1,25 м, управление в воздухе 60 %. */
export interface MoveParams {
  runSpeed: number;
  /** Разгон и торможение на земле, м/с². */
  groundAccel: number;
  groundDecel: number;
  /** Доля наземного разгона в воздухе. */
  airControl: number;
  gravity: number;
  jumpHeight: number;
  coyoteTime: number;
  jumpBufferTime: number;
  maxFallSpeed: number;
}

// ---------------------------------------------------------------- константы

/** Габариты мага: хитбокс r 0,4 м × 1,8 м (GDD 2.2, рецензия арт-директора). */
export const PLAYER_HALF_W = 0.4;
export const PLAYER_HEIGHT = 1.8;
/** Заход на ступеньку без прыжка. Низкое укрытие 1 м так не перешагнуть, только перепрыгнуть. */
export const PLAYER_STEP = 0.55;
/** Высота глаз над подошвой, м. */
export const EYE_HEIGHT = 1.6;
/** Частота симуляции у хоста и клиента. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
