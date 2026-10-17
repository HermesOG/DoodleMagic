/**
 * Счётчик одновременных голосов. Голос — один сыгранный звук со всеми его слоями; он занят до своего конца.
 * Если все заняты, новый звук не запускается: старые не обрываются, чтобы не щёлкало.
 */
export interface VoiceLimiter {
  /** Занять голос с now до until; false — мест нет. */
  tryStart(now: number, until: number): boolean;
  active(now: number): number;
}

export function createVoiceLimiter(max: number): VoiceLimiter {
  const ends: number[] = [];
  const prune = (now: number) => {
    for (let i = ends.length - 1; i >= 0; i--) if (ends[i]! <= now) ends.splice(i, 1);
  };
  return {
    tryStart(now, until) {
      prune(now);
      if (ends.length >= max) return false;
      ends.push(until);
      return true;
    },
    active(now) {
      prune(now);
      return ends.length;
    },
  };
}
