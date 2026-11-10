import { eyeOf, unitById, type ProjectileKind, type UnitId, type Vec3 } from "@doodlemagic/sim";
import type { Effect, SoundId } from "./effects";
import type { FrameView } from "./elementFx";

/*
 * Свист мимо уха (фаза 9, L12): чужой снаряд прошёл рядом и не попал — слышно, что по тебе стреляют, и откуда.
 * Раз в кадр, по образцу ульт-кадра (createUltFrame): у каждого снаряда отрезок между прошлым и этим кадром. Если
 * ближайшая к глазам точка отрезка ближе 1,5 м и снаряд её уже миновал (она не в конце отрезка: тот, что летит в лицо,
 * ещё может попасть, а попавший исчезает раньше, чем минует), — один свист на снаряд. Свой снаряд не свистит.
 * Громкость 0,3 + 0,7·(1 − d/1,5), звук — из ближней точки: панорама по стороне, сзади — глуше. Не больше 2 свистов
 * за любую секунду и одного за 0,5 с от одного стрелка; снаряд, который срезал лимит, больше не свистит.
 * Переигровка предсказания (PvP) раздаёт id заново: чужой снаряд может получить id моего неподтверждённого кулака.
 * Поэтому снаряд узнаётся по id вместе со стрелком и тиком рождения; не совпали — снаряд новый, отрезка нет. И отрезок
 * длиннее, чем снаряд пролетит за кадр (быстрее 70 м/с с запасом 0,05 с), — не полёт, а скачок: его пропускаем.
 */

export const WHIZZ = { radiusM: 1.5, gainMin: 0.3, maxPerS: 2, shooterGapS: 0.5, maxSpeedMps: 70, slackS: 0.05 } as const;
/** Звук по снаряду: кулак и шар — треск, камень — «вумм», серп — свист, Хват и Ответ — плеск. */
export const WHIZZ_SOUND: Readonly<Record<ProjectileKind, SoundId>> = {
  fireFists: "whizzFire", fireball: "whizzFire", stoneShot: "whizzStone", airSickle: "whizzSickle", waterGrab: "whizzWater", waterAnswer: "whizzWater",
};
/** Громкость свиста по ближнему расстоянию d < 1,5 м: у самого уха 1, на краю 0,3. */
export const whizzGain = (d: number): number => WHIZZ.gainMin + (1 - WHIZZ.gainMin) * (1 - Math.min(1, Math.max(0, d) / WHIZZ.radiusM));

/** Снаряд в прошлом кадре: точка и то, по чему его узнать после переигровки (стрелок, тик рождения). */
interface Seen extends Vec3 {
  owner: UnitId;
  born: number;
}

/** Кадровая функция свиста со своей памятью: где был каждый снаряд в прошлом кадре, кто уже свистел, лимиты. */
export function createWhizzFrame(): (f: FrameView) => Effect[] {
  /** id снаряда → он в прошлом кадре (меняется на месте: без выделения памяти на кадр). */
  const last = new Map<number, Seen>();
  /** Снаряды, которые уже свистнули (или их срезал лимит): второго свиста нет. */
  const done = new Set<number>();
  const seen = new Set<number>();
  /** Когда свистел снаряд стрелка — последний раз. */
  const byShooter = new Map<UnitId, number>();
  /** Часы последних свистов, не старше секунды. */
  let recent: number[] = [];
  return (f) => {
    let out: Effect[] | null = null;
    const me = unitById(f.cur, f.localId);
    const eye = me?.alive ? eyeOf(me) : null;
    const maxStep = WHIZZ.maxSpeedMps * ((Number.isFinite(f.dtS) && f.dtS > 0 ? f.dtS : 0) + WHIZZ.slackS);
    seen.clear();
    for (const p of f.cur.projectiles) {
      seen.add(p.id);
      const a = last.get(p.id);
      if (a === undefined) {
        // первый кадр снаряда: отрезка ещё нет
        last.set(p.id, { x: p.pos.x, y: p.pos.y, z: p.pos.z, owner: p.owner, born: p.bornTick });
        continue;
      }
      if (a.owner !== p.owner || a.born !== p.bornTick) {
        // тот же id у другого снаряда (переигровка): он новый — точку запомнить, отрезка нет, свистеть может заново
        a.owner = p.owner;
        a.born = p.bornTick;
        a.x = p.pos.x;
        a.y = p.pos.y;
        a.z = p.pos.z;
        done.delete(p.id);
        continue;
      }
      if (eye && p.owner !== f.localId && !done.has(p.id)) {
        // ближняя к глазам точка отрезка a → p.pos: доля u ∈ [0, 1] и расстояние — числами, без объектов
        const abx = p.pos.x - a.x;
        const aby = p.pos.y - a.y;
        const abz = p.pos.z - a.z;
        const len2 = abx * abx + aby * aby + abz * abz;
        // стоит (кадр без тика) — u = 1, ждём; скачок длиннее кадра полёта — не полёт
        const t = len2 > 0 && len2 <= maxStep * maxStep ? ((eye.x - a.x) * abx + (eye.y - a.y) * aby + (eye.z - a.z) * abz) / len2 : 1;
        const u = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(eye.x - (a.x + abx * u), eye.y - (a.y + aby * u), eye.z - (a.z + abz * u));
        if (u < 1 && d < WHIZZ.radiusM) {
          done.add(p.id);
          // время пошло назад (перезапуск часов) — прошлые свисты не в счёт
          recent = recent.filter((t) => t <= f.nowS && f.nowS - t < 1);
          const prevShot = byShooter.get(p.owner);
          const shooterOk = prevShot === undefined || f.nowS < prevShot || f.nowS - prevShot >= WHIZZ.shooterGapS - 1e-9;
          if (recent.length < WHIZZ.maxPerS && shooterOk) {
            recent.push(f.nowS);
            byShooter.set(p.owner, f.nowS);
            // floor 1 — громкость ровно по формуле, расстояние её не гасит; позиция даёт сторону
            const at: Vec3 = { x: a.x + abx * u, y: a.y + aby * u, z: a.z + abz * u };
            (out ??= []).push({ kind: "sound", id: WHIZZ_SOUND[p.ability], pos: at, gain: whizzGain(d), floor: 1 });
          }
        }
      }
      a.x = p.pos.x;
      a.y = p.pos.y;
      a.z = p.pos.z;
    }
    for (const id of last.keys()) {
      if (seen.has(id)) continue;
      last.delete(id);
      done.delete(id);
    }
    return out ?? NO_WHIZZ;
  };
}
/** Пустой ответ кадра — один на всё время (заморожен: его не дополнить по ошибке). */
const NO_WHIZZ = Object.freeze([]) as unknown as Effect[];
