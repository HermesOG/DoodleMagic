import { TICK_HZ, WATER, type Unit } from "@doodlemagic/sim";
import type { KitWidget, KitWidgetFactory } from "./kitWidgets";

/**
 * Виджет Воды в ките: пока стоит диск Отражения — «Ответ N» (впитанное, в пределах 20–60) и полоска оставшейся
 * секунды. Ничего не впитал — «Ответа нет»: так и будет, если диск уйдёт сейчас.
 */

const ANSWER = WATER.waterWard.answer;

/** Надпись виджета по впитанному: 0 — Ответа не будет, иначе урон Ответа в пределах 20–60. */
export function answerLabel(absorbed: number): string {
  if (!(absorbed > 0)) return "Ответа нет";
  return `Ответ ${Math.round(Math.min(ANSWER.maxDamage, Math.max(ANSWER.minDamage, absorbed)))}`;
}

/** Что показать на тике now: null — диска нет (снят, истёк или маг мёртв), иначе надпись и доля оставшегося времени. */
export function wardWidget(me: Unit, now: number): { text: string; left01: number; full: boolean } | null {
  const w = me.mage?.ward;
  // мёртвая Вода под диском: kit мёртвых не ведёт, ward остаётся до возрождения — прячем сами
  if (!w || !me.alive || now >= w.endTick) return null;
  const total = WATER.waterWard.durationS * TICK_HZ;
  return { text: answerLabel(w.absorbed), left01: Math.min(1, Math.max(0, (w.endTick - now) / total)), full: w.absorbed >= ANSWER.maxDamage };
}

export const createWaterWidget: KitWidgetFactory = (kitRoot): KitWidget => {
  const box = document.createElement("div");
  box.className = "ch-water-ward";
  box.hidden = true;
  // своего .css у Воды нет: оформление — здесь, в цветах HUD (--ch-water, --ch-ink, --ch-head)
  box.style.cssText =
    "display:flex;flex-direction:column;align-items:center;gap:3px;margin-bottom:6px;pointer-events:none;" +
    "font:700 15px/1 var(--ch-head, serif);letter-spacing:0.04em;color:var(--ch-water, #2ea8e6);text-shadow:0 0 3px rgba(245,240,228,0.9)";
  const label = document.createElement("span");
  const track = document.createElement("div");
  track.style.cssText = "width:120px;height:5px;border-radius:3px 4px 3px 2px;background:rgba(29,27,22,0.16);overflow:hidden";
  const fill = document.createElement("div");
  fill.style.cssText = "width:100%;height:100%;background:var(--ch-water, #2ea8e6);transform-origin:0 50%";
  track.append(fill);
  box.append(label, track);
  kitRoot.prepend(box);
  // DOM трогаем только при смене: надпись, её прозрачность и полоска (как у виджета Воздуха)
  const NO_ANSWER = answerLabel(0);
  let shown = "";
  let hidden = true;
  let left = -1;
  return {
    update(me, now) {
      const s = wardWidget(me, now);
      if ((s === null) !== hidden) {
        hidden = s === null;
        box.hidden = hidden;
      }
      if (!s) return;
      if (s.text !== shown) {
        label.textContent = s.text;
        label.style.opacity = s.text === NO_ANSWER ? "0.6" : "1";
        shown = s.text;
      }
      const q = Math.round(s.left01 * 1000);
      if (q !== left) {
        left = q;
        fill.style.transform = `scaleX(${(q / 1000).toFixed(3)})`;
      }
    },
    dispose() {
      box.remove();
    },
  };
};
