import type { AbilityId, Element, Slot, UnitId, Vec3 } from "@doodlemagic/sim";

/** Всплески частиц. Огонь — вверх, рвано, свет; Земля — угловатые осколки вниз и пыль цвета бумаги (GDD 6). */
export const BURST_PRESETS = [
  "fistFlash", "fistImpact", "fireballCharge", "fireballBoom", "dashBlast", "fireWallSparks", "fireWallIgnite", "burnLick",
  "stoneCrumble", "stoneImpact", "pillarCracks", "pillarBurst", "wallDust", "quakeRing", "terrainChips", "terrainBreak",
  "deathFire", "deathEarth", "respawnPuff", "fizzle",
] as const;
export type BurstPreset = (typeof BURST_PRESETS)[number];
export const SOUND_IDS = [
  "fireFist", "fireballCharge", "fireballBoom", "dash", "fireWallTelegraph", "fireWallIgnite", "stoneCast", "stoneImpact", "pillarTelegraph", "pillarStrike",
  "wallRise", "quakeWindup", "quakeStrike", "terrainHit", "terrainBreak", "hitTick", "kill", "fall", "fizzle", "overheat", "courage",
] as const;
export type SoundId = (typeof SOUND_IDS)[number];
/** Чья рука; "auto" — та, что сейчас бьёт кулаком (решают жесты рук). */
export type Hand = "left" | "right" | "both" | "auto";

export type Effect =
  | { kind: "burst"; preset: BurstPreset; pos: Vec3; dir: Vec3; scale: number }
  | { kind: "palm"; hand: Hand; element: Element; preset: "flash" | "charge" | "fizzle" }
  | { kind: "gesture"; ability: AbilityId }
  | { kind: "sound"; id: SoundId; pos: Vec3 | null; gain: number } // pos null — у слушателя
  | { kind: "trauma"; amount: number }
  | { kind: "kick"; pitchDeg: number; yawDeg: number; rollDeg: number }
  | { kind: "fov"; deg: number; holdS: number }
  | { kind: "hitstop"; ms: number } // визуальный: замирают руки (GDD 2.2)
  | { kind: "hitmarker"; kill: boolean; air: boolean }
  | { kind: "number"; target: UnitId; amount: number; pos: Vec3; dot: boolean; air: boolean }
  | { kind: "flash"; target: UnitId }
  | { kind: "flinch"; target: UnitId; dir: Vec3; amount: number }
  | { kind: "indicator"; from: Vec3; amount: number } // попали в меня: откуда
  | { kind: "toast"; text: string }
  | { kind: "deny"; slot: Slot }; // перезарядка или замах: значок слота вздрагивает
export type EffectKind = Effect["kind"];
