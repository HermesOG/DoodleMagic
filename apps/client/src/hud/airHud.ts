import { AIR, NEVER, TICK_HZ, type Unit } from "@doodlemagic/sim";
import type { KitWidget, KitWidgetFactory } from "./kitWidgets";

/** Заряд Взмаха и запас парения в тиках (6 с и 3 с). */
const CHARGE_TICKS = Math.round(AIR.swoop.chargeS * TICK_HZ);
const GLIDE_TICKS = Math.round(AIR.passive.glideS * TICK_HZ);

/**
 * Что показывает виджет: доля каждой ленты (1 — заряд готов, иначе — сколько набралось у той, что копится, у
 * следующей 0) и мазок запаса парения (1 — полный; виден после второго прыжка, пока маг в воздухе).
 */
export function airWidgetState(me: Unit, now: number): { ribbons: [number, number]; glide: number; glideShown: boolean } {
  const m = me.mage;
  const charges = m?.charges.e ?? 0;
  const at = m?.chargeAt.e ?? NEVER;
  const filling = at === NEVER ? 0 : Math.min(1, Math.max(0, 1 - (at - now) / CHARGE_TICKS));
  const frac = (i: number): number => (charges > i ? 1 : charges === i ? filling : 0);
  const f = m?.flight;
  return {
    ribbons: [frac(0), frac(1)],
    glide: f ? Math.min(1, Math.max(0, 1 - f.glideTicks / GLIDE_TICKS)) : 1,
    glideShown: !!f && f.doubleJumped && !me.move.onGround,
  };
}

const AIR_INK = "var(--ch-air, #8f84d6)";

/**
 * Виджет Воздуха в ките: две ленты зарядов Взмаха (готовая — цветом Воздуха, копящаяся заливается снизу) и мазок
 * запаса парения. DOM трогаем только при смене чисел.
 */
export const createAirWidget: KitWidgetFactory = (kitRoot: HTMLElement): KitWidget => {
  const root = document.createElement("div");
  root.className = "ch-air";
  root.style.cssText = "display:flex;align-items:flex-end;gap:10px;height:30px;pointer-events:none";
  const ribbons = [0, 1].map(() => {
    const box = document.createElement("div");
    box.style.cssText = `position:relative;width:9px;height:28px;border:1.5px solid ${AIR_INK};border-radius:2px 2px 7px 2px;overflow:hidden;transform:skewX(-10deg);opacity:0.55`;
    const fill = document.createElement("div");
    fill.style.cssText = `position:absolute;left:0;right:0;bottom:0;height:100%;background:${AIR_INK};transform-origin:bottom;transform:scaleY(0)`;
    box.appendChild(fill);
    root.appendChild(box);
    return { box, fill, last: -1 };
  });
  const glide = document.createElement("div");
  glide.style.cssText = `width:72px;height:5px;border-radius:3px;background:rgba(143,132,214,0.2);overflow:hidden;align-self:center;visibility:hidden`;
  const glideFill = document.createElement("div");
  glideFill.style.cssText = `width:100%;height:100%;background:${AIR_INK};transform-origin:left;transform:scaleX(1)`;
  glide.appendChild(glideFill);
  root.appendChild(glide);
  kitRoot.prepend(root);
  let lastGlide = -1;
  let lastShown: boolean | null = null;

  return {
    update(me, now) {
      const s = airWidgetState(me, now);
      s.ribbons.forEach((v, i) => {
        const r = ribbons[i]!;
        const q = Math.round(v * 100) / 100;
        if (q === r.last) return;
        r.last = q;
        r.fill.style.transform = `scaleY(${q.toFixed(2)})`;
        r.box.style.opacity = q >= 1 ? "1" : "0.55";
      });
      if (s.glideShown !== lastShown) {
        lastShown = s.glideShown;
        glide.style.visibility = s.glideShown ? "visible" : "hidden";
      }
      const g = Math.round(s.glide * 100) / 100;
      if (g !== lastGlide) {
        lastGlide = g;
        glideFill.style.transform = `scaleX(${g.toFixed(2)})`;
      }
    },
    dispose() {
      root.remove();
    },
  };
};
