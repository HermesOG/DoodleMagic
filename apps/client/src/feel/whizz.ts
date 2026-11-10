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
 */

export const WHIZZ = { radiusM: 1.5, gainMin: 0.3, maxPerS: 2, shooterGapS: 0.5 } as const;
/** Звук по снаряду: кулак и шар — треск, камень — «вумм», серп — свист, Хват и Ответ — плеск. */
export const WHIZZ_SOUND: Readonly<Record<ProjectileKind, SoundId>> = {
  fireFists: "whizzFire", fireball: "whizzFire", stoneShot: "whizzStone", airSickle: "whizzSickle", waterGrab: "whizzWater", waterAnswer: "whizzWater",
};
/** Громкость свиста по ближнему расстоянию d < 1,5 м: у самого уха 1, на краю 0,3. */
export const whizzGain = (d: number): number => WHIZZ.gainMin + (1 - WHIZZ.gainMin) * (1 - Math.min(1, Math.max(0, d) / WHIZZ.radiusM));

/** Ближняя к p точка отрезка a–b: доля u ∈ [0, 1] и сама точка; у отрезка нулевой длины u = 1 (снаряд стоит). */
function nearest(a: Vec3, b: Vec3, p: Vec3): { u: number; at: Vec3; d: number } {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = len2 > 0 ? ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / len2 : 1;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const at = { x: a.x + ab.x * u, y: a.y + ab.y * u, z: a.z + ab.z * u };
  return { u, at, d: Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) };
}

/** Кадровая функция свиста со своей памятью: где был каждый снаряд в прошлом кадре, кто уже свистел, лимиты. */
export function createWhizzFrame(): (f: FrameView) => Effect[] {
  /** id снаряда → его точка в прошлом кадре (меняется на месте: без выделения памяти на кадр). */
  const last = new Map<number, Vec3>();
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
    seen.clear();
    for (const p of f.cur.projectiles) {
      seen.add(p.id);
      const a = last.get(p.id);
      if (a === undefined) {
        // первый кадр снаряда: отрезка ещё нет
        last.set(p.id, { ...p.pos });
        continue;
      }
      if (eye && p.owner !== f.localId && !done.has(p.id)) {
        const n = nearest(a, p.pos, eye);
        if (n.u < 1 && n.d < WHIZZ.radiusM) {
          done.add(p.id);
          // время пошло назад (перезапуск часов) — прошлые свисты не в счёт
          recent = recent.filter((t) => t <= f.nowS && f.nowS - t < 1);
          const prevShot = byShooter.get(p.owner);
          const shooterOk = prevShot === undefined || f.nowS < prevShot || f.nowS - prevShot >= WHIZZ.shooterGapS - 1e-9;
          if (recent.length < WHIZZ.maxPerS && shooterOk) {
            recent.push(f.nowS);
            byShooter.set(p.owner, f.nowS);
            // floor 1 — громкость ровно по формуле, расстояние её не гасит; позиция даёт сторону
            (out ??= []).push({ kind: "sound", id: WHIZZ_SOUND[p.ability], pos: n.at, gain: whizzGain(n.d), floor: 1 });
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
