/**
 * Звуки и всплески Воздуха (фаза 4). Список правит только задача 5 (клиент Воздуха); общие таблицы
 * (effects.ts, recipes.ts, presets.ts) берут его одной строкой.
 *
 * Ульта «Ураган» (фаза 5): hurricaneWindup — свист замаха 0,8 с, hurricaneBoom — хлопок выпуска; hurricaneBlast —
 * кольцо штрихов ветра на высоте груди, hurricaneDust — кольцо пыли по полу. Стяжку замаха рисует airVfx.
 */
export const AIR_SOUND_IDS = [
  "sickleThrow", "sickleHit", "gustWindup", "gustBlast", "airBlown", "airSlam", "swoop", "airCharge", "tornadoCast", "tornadoRise", "tornadoHum",
  "fireTornado", "airJump", "glideWhistle", "hurricaneWindup", "hurricaneBoom",
] as const;
export const AIR_BURST_PRESETS = [
  "sicklePuff", "gustFan", "gustBlast", "airBlown", "airSlam", "swoopWake", "airJumpRing", "tornadoDust", "fireTornadoFlare", "deathAir",
  "hurricaneBlast", "hurricaneDust",
] as const;
