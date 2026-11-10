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
  // ульты Огня и Земли (фаза 5): выдох Дыхания, вспышка потока на цели, трещина Разлома и удар шипов
  "breathFlare", "breathHit", "riftCrack", "riftBurst",
  // объекты на карте (фаза 6): сфера и руна появились и взяты (своё взятие — низко, у ног), искры за носителем ярости —
  // вид по состоянию (pickupVfx)
  "orbSpawn", "orbTake", "orbTakeOwn", "runeSpawn", "runeTake", "runeTakeOwn", "furyMote",
  ...AIR_BURST_PRESETS, ...WATER_BURST_PRESETS,
] as const;
export type BurstPreset = (typeof BURST_PRESETS)[number];
export const SOUND_IDS = [
  "fireFist", "fireballCharge", "fireballBoom", "dash", "fireWallTelegraph", "fireWallIgnite", "stoneCast", "stoneImpact", "pillarTelegraph", "pillarStrike",
  "wallRise", "quakeWindup", "quakeStrike", "terrainHit", "terrainBreak", "hitLight", "hitHeavy", "kill", "fall", "fizzle", "overheat", "courage",
  "fireballLaunch", "stoneThrow", "fistHit", "step", "jump", "land", "knockWhoosh",
  // ульта (фаза 5): гул чужой ульты на всю карту и «заряд полон» — общие, без подписи стихии
  "ultWarn", "ultReady",
  // Дыхание дракона: вдох и зёрна рёва потока; Тектонический разлом: гул бегущей трещины и удар шипов
  "breathInhale", "breathRoar", "riftRumble", "riftStrike",
  // объекты на карте (фаза 6): сфера жизни, руна ярости и сама ярость — «нейтральный язык», колокола без подписи стихии
  "orbTake", "runeWarn", "runeSpawn", "runeTake", "furyEnd", "furySlain",
  // свист чужого снаряда мимо уха (фаза 9, L12) — по стихии стрелка; Воздух и Вода тоже здесь, рядом с Огнём и Землёй
  "whizzFire", "whizzStone", "whizzSickle", "whizzWater",
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
  // pos null — у слушателя; floor — громкость не ниже этой после расстояния (своё попадание слышно и с 20 м);
  // pitch — множитель частот всех слоёв (тик попадания выше к смерти цели, фаза 9, L2)
  | { kind: "sound"; id: SoundId; pos: Vec3 | null; gain: number; floor?: number; pitch?: number }
  // profile — шум тряски: Огонь (по умолчанию) или Земля; floor — не прибавка, а пол: trauma не ниже amount
  | { kind: "trauma"; amount: number; profile?: "fire" | "earth"; floor?: true }
  // dropM — камера вниз в мире на столько метров (удары ладонями в землю); recoil — отдача ЛКМ на своей быстрой
  // пружине (фаза 9, Р6); hand "auto" — yawDeg задан для правой руки, у левой (рука удара кулаком) — зеркально
  | { kind: "kick"; pitchDeg: number; yawDeg: number; rollDeg: number; dropM?: number; recoil?: true; hand?: "auto" }
  // FOV-удар — импульс с пиком deg через ≈ 33 мс (round3/01, M3); holdS больше не читается — для старых таблиц
  | { kind: "fov"; deg: number; holdS?: number }
  | { kind: "hitstop"; ms: number } // визуальный: замирают руки, пока идёт жест (GDD 2.2)
  | { kind: "hitmarker"; kill: boolean; air: boolean; tier?: FeelTier }
  // lmb — попадание ЛКМ (и добивающее): такие цифры копятся в одну (L7); урон по времени — всегда false
  | { kind: "number"; target: UnitId; amount: number; pos: Vec3; dot: boolean; air: boolean; lmb: boolean }
  | { kind: "flash"; target: UnitId }
  | { kind: "flinch"; target: UnitId; dir: Vec3; amount: number }
  | { kind: "indicator"; from: Vec3; amount: number } // попали в меня: откуда
  | { kind: "toast"; text: string }
  | { kind: "deny"; slot: Slot }; // перезарядка или замах: значок слота вздрагивает
export type EffectKind = Effect["kind"];
