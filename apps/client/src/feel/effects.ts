import type { AbilityId, Element, Slot, UnitId, Vec3 } from "@doodlemagic/sim";
import { AIR_BURST_PRESETS, AIR_SOUND_IDS } from "./airIds";
import { WATER_BURST_PRESETS, WATER_SOUND_IDS } from "./waterIds";

/**
 * Всплески частиц. Огонь — вверх, рвано, свет; Земля — угловатые осколки вниз и пыль цвета бумаги (GDD 6).
 * Воздух и Вода — своими списками (airIds.ts, waterIds.ts).
 */
export const BURST_PRESETS = [
  "fistFlash", "fistImpact", "fireballCharge", "fireballBoom", "dashBlast", "fireWallSparks", "fireWallIgnite", "burnLick",
  "stoneCrumble", "stoneImpact", "pillarCracks", "pillarBurst", "wallDust", "quakeRing", "terrainChips", "terrainBreak",
  "deathFire", "deathEarth", "respawnPuff", "fizzle", "paperFlash", "landDust",
  ...AIR_BURST_PRESETS, ...WATER_BURST_PRESETS,
] as const;
export type BurstPreset = (typeof BURST_PRESETS)[number];
export const SOUND_IDS = [
  "fireFist", "fireballCharge", "fireballBoom", "dash", "fireWallTelegraph", "fireWallIgnite", "stoneCast", "stoneImpact", "pillarTelegraph", "pillarStrike",
  "wallRise", "quakeWindup", "quakeStrike", "terrainHit", "terrainBreak", "hitLight", "hitHeavy", "kill", "fall", "fizzle", "overheat", "courage",
  "fireballLaunch", "stoneThrow", "fistHit", "step", "jump", "land", "knockWhoosh",
  ...AIR_SOUND_IDS, ...WATER_SOUND_IDS,
] as const;
export type SoundId = (typeof SOUND_IDS)[number];
/**
 * Ступень отклика (round3/01, 2.1): нет — урон по времени; малая — кулак, камень, попадание в рельеф; средняя — шар,
 * столб, стена, землетрясение, стена огня, рывок, разрушение рельефа; крупная — убийство, сброс, ульта.
 */
export type FeelTier = "none" | "small" | "medium" | "large";
/** Чья рука; "auto" — та, что сейчас бьёт кулаком (решают жесты рук). */
export type Hand = "left" | "right" | "both" | "auto";

export type Effect =
  // owner — чей всплеск, если эффектнику стихии это важно (дуга хлыста: своя — из ладони)
  | { kind: "burst"; preset: BurstPreset; pos: Vec3; dir: Vec3; scale: number; owner?: UnitId }
  | { kind: "palm"; hand: Hand; element: Element; preset: "flash" | "charge" | "fizzle" }
  | { kind: "gesture"; ability: AbilityId }
  // pos null — у слушателя; floor — громкость не ниже этой после расстояния (своё попадание слышно и с 20 м)
  | { kind: "sound"; id: SoundId; pos: Vec3 | null; gain: number; floor?: number }
  // profile — шум тряски: Огонь (по умолчанию) или Земля
  | { kind: "trauma"; amount: number; profile?: "fire" | "earth" }
  // dropM — камера вниз в мире на столько метров (удары ладонями в землю)
  | { kind: "kick"; pitchDeg: number; yawDeg: number; rollDeg: number; dropM?: number }
  // FOV-удар — импульс с пиком deg через ≈ 33 мс (round3/01, M3); holdS больше не читается — для старых таблиц
  | { kind: "fov"; deg: number; holdS?: number }
  | { kind: "hitstop"; ms: number } // визуальный: замирают руки, пока идёт жест (GDD 2.2)
  | { kind: "hitmarker"; kill: boolean; air: boolean; tier?: FeelTier }
  | { kind: "number"; target: UnitId; amount: number; pos: Vec3; dot: boolean; air: boolean }
  | { kind: "flash"; target: UnitId }
  | { kind: "flinch"; target: UnitId; dir: Vec3; amount: number }
  | { kind: "indicator"; from: Vec3; amount: number } // попали в меня: откуда
  | { kind: "toast"; text: string }
  | { kind: "deny"; slot: Slot }; // перезарядка или замах: значок слота вздрагивает
export type EffectKind = Effect["kind"];
