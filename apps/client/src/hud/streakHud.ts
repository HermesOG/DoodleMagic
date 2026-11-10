import "./streakHud.css";

/*
 * Серии убийств и дуга матча (фаза 9, задача 5; Р4, Р5; 02-feel-lmb, раздел 3; 04, T7). Правила и тексты — чистые
 * функции под тесты; DOM — одна строка объявления над прицелом (top: 30vh), переиспользуется: новое объявление сразу
 * сменяет старое, без очереди и без нового узла на событие.
 */

/** Мульти (очков подряд в окне 4 с, Р4): ×2, ×3, ×4 и больше. */
export function multiText(multi: number): string | null {
  return multi >= 4 ? "Разгром!" : multi === 3 ? "Тройное!" : multi === 2 ? "Двойное!" : null;
}
/** Ступени серии без смерти (Р5): между ними и после 10 — без объявления. */
const STREAK_STEPS: Readonly<Record<number, string>> = { 3: "В ударе!", 5: "Неудержимый!", 7: "Стихийное бедствие!", 10: "Легенда монастыря!" };
/** Текст ступени серии; не ступень — null. */
export const streakStep = (streak: number): string | null => STREAK_STEPS[streak] ?? null;
/** С этой серии маг помечен печатью с числом над именем (и экран смерти говорит «его серия: N»). */
export const STREAK_MARK_FROM = 3;
/** С этой ступени чужая серия слышна всем (далёкий гонг) и идёт строкой в килфид. */
export const STREAK_LOUD_FROM = 5;
/** Печать над именем: число серии от STREAK_MARK_FROM; меньше — null. */
export const streakMark = (streak: number): string | null => (streak >= STREAK_MARK_FROM ? String(streak) : null);
/** Тост прервавшему чужую серию от 3. */
export const BROKE_TEXT = "Серия прервана!";
export const LAST_MINUTE_TEXT = "Последняя минута!";

/** Своё объявление: крупная строка (кегль px), печать «×N» (у мульти) и строка серии под ней (34 px). */
export interface Announcement {
  big: string;
  px: number;
  stamp: string | null;
  line: string | null;
}
/** Кегль мульти: ×2 — 48 px, ×3 — 56, ×4+ — 64; серия без мульти — 48. */
const multiPx = (multi: number): number => (multi >= 4 ? 64 : multi === 3 ? 56 : 48);
export const LINE_PX = 34;
/**
 * Объявление очка: мульти от ×2 — крупно с печатью, серия на ступени — строкой ниже; одна серия — крупно без печати;
 * нечего сказать — null.
 */
export function announcement(multi: number, streak: number): Announcement | null {
  const m = multiText(multi);
  const s = streakStep(streak);
  if (m) return { big: m, px: multiPx(multi), stamp: `×${Math.floor(multi)}`, line: s };
  return s ? { big: s, px: multiPx(1), stamp: null, line: null } : null;
}
/** «Последняя минута!» — 44 px в слое серий, без печати. */
export const LAST_MINUTE: Announcement = { big: LAST_MINUTE_TEXT, px: 44, stamp: null, line: null };

/**
 * Анимация «печать»: масштаб 1,8 → 0,94 → 1 за 140 мс, поворот −6° → −2°; мазок-подчёркивание дорисовывается за 200 мс
 * с задержкой 80 мс; держится до 1,1 с, гаснет за 0,3 с — всего 1,4 с. «Последняя минута!» держится 1,2 с — всего 1,5 с.
 */
export const STAMP = { inS: 0.14, settleS: 0.09, strokeDelayS: 0.08, strokeS: 0.2, holdS: 1.1, fadeS: 0.3 } as const;
export const FINAL_HOLD_S = 1.2;
/** Что сейчас в строке: объявление серии или «Последняя минута!», с какого момента. */
export interface Shown {
  kind: "streak" | "final";
  a: Announcement;
  at: number;
}
const lifeS = (s: Shown): number => (s.kind === "final" ? FINAL_HOLD_S : STAMP.holdS) + STAMP.fadeS;
/** Строка ещё видна в момент nowS. */
export const showing = (s: Shown | null, nowS: number): boolean => s !== null && nowS - s.at >= 0 && nowS - s.at < lifeS(s);
/** Объявление серии сменяет любое прежнее сразу, без очереди. */
export const showStreak = (a: Announcement, nowS: number): Shown => ({ kind: "streak", a, at: nowS });
/** «Последняя минута!» крупно — только если строка свободна; идёт серия — null (подождёт, finalDue). */
export const showFinal = (cur: Shown | null, nowS: number): Shown | null => (showing(cur, nowS) ? null : { kind: "final", a: LAST_MINUTE, at: nowS });
/** Строка занята серией — «Последняя минута!» ждёт, пока она освободится, но не дольше этого. */
export const FINAL_WAIT_S = 2;
/** Пора ли показать отложенную с askedAt «Последнюю минуту»: строка свободна или ждали FINAL_WAIT_S. */
export const finalDue = (cur: Shown | null, askedAt: number, nowS: number): boolean => !showing(cur, nowS) || nowS - askedAt >= FINAL_WAIT_S;

/** Кадр печати по возрасту: масштаб, поворот (градусы), прозрачность, доля мазка 0…1; погасла — null. calm — без движения. */
export function stampAnim(s: Shown, nowS: number, calm = false): { scale: number; rotDeg: number; alpha: number; stroke: number } | null {
  if (!showing(s, nowS)) return null;
  const age = nowS - s.at;
  const hold = lifeS(s) - STAMP.fadeS;
  const alpha = age < hold ? 1 : Math.max(0, 1 - (age - hold) / STAMP.fadeS);
  const stroke = calm ? 1 : Math.min(1, Math.max(0, (age - STAMP.strokeDelayS) / STAMP.strokeS));
  if (calm) return { scale: 1, rotDeg: -2, alpha, stroke };
  // удар: 1,8 → 0,94 к 90 мс (быстро, со сжатием), отскок 0,94 → 1 к 140 мс
  const scale =
    age < STAMP.settleS ? 1.8 - 0.86 * easeOut(age / STAMP.settleS) : age < STAMP.inS ? 0.94 + 0.06 * ((age - STAMP.settleS) / (STAMP.inS - STAMP.settleS)) : 1;
  const rotDeg = -6 + 4 * Math.min(1, age / STAMP.inS);
  return { scale, rotDeg, alpha, stroke };
}
const easeOut = (u: number): number => 1 - (1 - u) * (1 - u);

export interface StreakHud {
  /** Своё объявление очка (сменяет прежнее). */
  announce(a: Announcement, nowS: number): void;
  /** «Последняя минута!» крупно; строка занята серией — когда освободится, но не позже чем через FINAL_WAIT_S. */
  lastMinute(nowS: number): void;
  update(nowS: number): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

function div(className: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

/** Слой серий поверх боевого HUD (переменные и видимость — как у .ch): одна строка, кадр двигает transform и opacity. */
export function createStreakHud(root: HTMLElement): StreakHud {
  const layer = div("ch sh");
  layer.hidden = true;
  const line = div("sh-line");
  const big = div("sh-big");
  const text = document.createElement("span");
  text.className = "sh-text";
  const stamp = document.createElement("span");
  stamp.className = "sh-stamp";
  stamp.hidden = true;
  big.append(text, stamp);
  const stroke = div("sh-stroke");
  const sub = div("sh-sub");
  sub.hidden = true;
  line.append(big, stroke, sub);
  layer.append(line);
  root.append(layer);

  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let shown: Shown | null = null;
  /** Когда попросили «Последнюю минуту», пока строка была занята; NaN — не ждёт. */
  let finalAsked = Number.NaN;
  /** Последние записанные значения: в DOM пишем только перемены. */
  let lastTransform = "";
  let lastOpacity = "";
  let lastStroke = "";

  const fill = (s: Shown): void => {
    shown = s;
    // текст и кегль — раз на объявление, не в кадре
    text.textContent = s.a.big;
    big.style.fontSize = `${s.a.px}px`;
    stamp.hidden = s.a.stamp === null;
    stamp.textContent = s.a.stamp ?? "";
    sub.hidden = s.a.line === null;
    sub.textContent = s.a.line ?? "";
    line.classList.toggle("is-final", s.kind === "final");
  };
  const write = (transform: string, opacity: string, strokeX: string): void => {
    if (transform !== lastTransform) line.style.transform = lastTransform = transform;
    if (opacity !== lastOpacity) line.style.opacity = lastOpacity = opacity;
    if (strokeX !== lastStroke) stroke.style.transform = lastStroke = strokeX;
  };

  return {
    announce(a, nowS) {
      fill(showStreak(a, nowS));
    },
    lastMinute(nowS) {
      const s = showFinal(shown, nowS);
      if (s) fill(s);
      else finalAsked = nowS;
    },
    update(nowS) {
      if (!Number.isNaN(finalAsked) && finalDue(shown, finalAsked, nowS)) {
        finalAsked = Number.NaN;
        fill({ kind: "final", a: LAST_MINUTE, at: nowS });
      }
      const f = shown ? stampAnim(shown, nowS, calm?.matches ?? false) : null;
      if (!f) {
        write(lastTransform, "0", lastStroke);
        return;
      }
      write(
        `translateX(-50%) rotate(${f.rotDeg.toFixed(2)}deg) scale(${f.scale.toFixed(3)})`,
        f.alpha >= 1 ? "1" : f.alpha.toFixed(3),
        `scaleX(${f.stroke.toFixed(3)})`,
      );
    },
    setVisible(on) {
      layer.hidden = !on;
    },
    dispose() {
      layer.remove();
      shown = null;
    },
  };
}
