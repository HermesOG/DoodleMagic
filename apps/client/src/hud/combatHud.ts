import { Vector3, type PerspectiveCamera } from "three";
import {
  ABILITY_NAME,
  ABILITY_OF,
  ELEMENT_INFO,
  SLOTS,
  TICK_HZ,
  statusFlags,
  unitById,
  type Element as Elem,
  type MatchState,
  type Slot,
  type Unit,
  type UnitId,
  type Vec3,
} from "@doodlemagic/sim";
import type { Effect, FeelTier } from "../feel/effects";
import { MAGE_TOP_M } from "../fx/mageMeshes";
import "./combatHud.css";
import { glyphSvg } from "./glyphs";
import { KIT_WIDGETS, type KitWidget } from "./kitWidgets";
import {
  NUMBER_LIFE_S, cooldownFraction, formatDamage, furyLeftS, heatFraction, hpBar, mergeNumbers, numberAnim, runeCue, runeText, ultFraction, ultPercent,
  type FloatingNumber,
} from "./format";

/** Что HUD видит в кадре: два последних состояния и доля между ними, камера мира, часы и проверка видимости точки. */
export interface HudView {
  cur: MatchState;
  prev: MatchState;
  alpha: number;
  localId: UnitId;
  camera: PerspectiveCamera;
  nowS: number;
  visible(p: Vec3): boolean;
  /** Имена магов: есть — над полосой HP чужого мага пишется его имя. */
  names?: ReadonlyMap<UnitId, string>;
}
export interface CombatHud {
  /** hitmarker, number, indicator, toast, deny; остальные эффекты HUD не касаются. */
  apply(e: Effect, nowS: number): void;
  update(v: HudView): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

const NUMBER_POOL = 24;
const TOAST_POOL = 3;
const ARC_POOL = 4;
/** Хитмаркер по ступени отклика (round3/01, H3): малая 0,12 с, средняя 0,22 с, крупная 0,35 с. */
export const HITMARKER_S: Readonly<Record<FeelTier, number>> = { none: 0.12, small: 0.12, medium: 0.22, large: 0.35 };

/**
 * Хитмаркер через age секунд после попадания: null — погас. Малая ступень вспыхивает ×1,18 и оседает; средняя
 * и крупная — «поп» ×1,4 → 1 за первую треть; убийство крупнее (×1,45). Последние 40 % — гаснет.
 */
export function hitmarkerAnim(age: number, tier: FeelTier, kill: boolean): { alpha: number; scale: number } | null {
  const dur = HITMARKER_S[tier];
  if (!(age >= 0 && age < dur)) return null;
  const u = age / dur;
  const pop = tier === "medium" || tier === "large" ? 1 + 0.4 * Math.max(0, 1 - u * 3) ** 2 : 1.18 - 0.18 * u;
  return { alpha: u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4, scale: (kill ? 1.45 : 1) * pop };
}
const TOAST_S = 1.2;
const INDICATOR_S = 1.2;
const DENY_S = 0.15;
const READY_FLASH_S = 0.32;
/** Строка руны пульсирует последние столько секунд до появления (раз в секунду, в такт цифрам). */
const RUNE_PULSE_S = 3;
/** Виньетка урона: сила = урон / 40, гаснет 3/с (round1/03 п. 3). */
const VIGNETTE_PER_DMG = 1 / 40;
const VIGNETTE_DECAY_PER_S = 3;
/** Полоса над манекеном и чужим магом: видна ближе 35 м; ширина — 0,9 м мира в пикселях, в пределах 26…110 px. */
const BAR_RANGE_M = 35;
const BAR_WORLD_M = 0.9;
const BAR_PX = { min: 26, max: 110 } as const;
const HEAD_M = 1.75;
const BAR_ABOVE_M = 0.45;
/** У мага полоса — над шляпой. */
const MAGE_BAR_M = MAGE_TOP_M + 0.15;
const KEY_LABEL: Readonly<Record<Slot, string>> = { primary: "ЛКМ", q: "Q", e: "E", c: "C", x: "X" };
const ELEMENT_COLOR: Readonly<Record<Elem, string>> = { fire: "var(--ch-fire)", earth: "var(--ch-earth)", air: "var(--ch-air)", water: "var(--ch-water)" };
const ENSO_R = 22;
const ENSO_LEN = 2 * Math.PI * ENSO_R;

const RETICLE_SVG = `<svg class="ch-reticle" viewBox="-16 -16 32 32" aria-hidden="true">
  <g class="halo"><path d="M0 -12.5V-7.5M0 7.5V12.5M-12.5 0H-7.5M7.5 0H12.5"/></g>
  <g class="ink"><path d="M0 -12.5V-7.5M0 7.5V12.5M-12.5 0H-7.5M7.5 0H12.5"/></g>
  <circle class="dot-halo" r="2.6"/><circle class="dot" r="1.5"/></svg>`;
// четыре диагональных штриха тушью, неровной длины — как мазки; стрелка вверх — воздушное попадание
const HIT_PATH = "M-7 -7L-14.5 -15M7.5 -7L14 -14.5M7 7.5L15 14.5M-7.5 7L-14 15";
const HIT_SVG = `<svg class="ch-hit" viewBox="-24 -24 48 48" aria-hidden="true">
  <path class="halo" d="${HIT_PATH}"/><path class="ink" d="${HIT_PATH}"/>
  <path class="arrow" d="M-4.5 -18.5L0 -23L4.5 -18.5M0 -23V-15.5"/></svg>`;
const ICON: Readonly<Record<"burn" | "root" | "slow" | "air", string>> = {
  burn: "M6.5 1.5C9 4.5 11 6.5 11 9a4.5 4.5 0 0 1-9 0C2 7 3.6 5.8 4.6 4.2C5 6 5.8 6.8 6.5 7C6.8 5 6.6 3.4 6.5 1.5Z",
  root: "M6.5 2.2a4.3 4.3 0 1 0 0.01 0M6.5 4.6a1.9 1.9 0 1 0 0.01 0",
  slow: "M6.5 1.5V11M2.8 7.5L6.5 11.2L10.2 7.5",
  air: "M6.5 11.5V2M2.8 5.5L6.5 1.8L10.2 5.5",
};
const STATUS_LABEL: Readonly<Record<keyof typeof ICON, string>> = { burn: "горит", root: "корни", slow: "медленно", air: "в воздухе" };

const icon = (k: keyof typeof ICON): string =>
  `<span class="ch-st ${k}" hidden><svg viewBox="0 0 13 13" aria-hidden="true"><path class="halo" d="${ICON[k]}"/><path class="ink" d="${ICON[k]}"/></svg>${STATUS_LABEL[k]}</span>`;

function div(className: string, html = ""): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  if (html) d.innerHTML = html;
  return d;
}
function pick<T extends HTMLElement | SVGElement = HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}
/** Пишет в DOM, только когда значение изменилось: HUD обновляется каждый кадр, а меняется редко. */
function setText(el: HTMLElement | SVGElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
type StyleProp = "transform" | "opacity" | "left" | "strokeDashoffset";
/**
 * Последняя записанная строка каждого свойства: сравнивать с el.style нельзя — браузер нормализует значение
 * ("translate(1px, 2px)" читается иначе, "0.500" — как "0.5"), и запись шла бы каждый кадр.
 */
const written = new WeakMap<HTMLElement | SVGElement, Partial<Record<StyleProp, string>>>();
function setStyle(el: HTMLElement | SVGElement, prop: StyleProp, value: string): void {
  let last = written.get(el);
  if (!last) written.set(el, (last = {}));
  if (last[prop] === value) return;
  last[prop] = value;
  el.style[prop] = value;
}
function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

interface Cell {
  root: HTMLDivElement;
  enso: SVGCircleElement;
  glyph: HTMLDivElement;
  name: HTMLDivElement;
  flash: HTMLDivElement;
  prevFrac: number;
  flashAt: number;
  denyAt: number;
}
interface DummyBar {
  root: HTMLDivElement;
  /** Имя мага над полосой; у манекена пустое и скрыто. */
  name: HTMLDivElement;
  /** Полоса шириной BAR_PX.max; ширину по расстоянию даёт scaleX (без пересчёта раскладки в кадре). */
  track: HTMLDivElement;
  fill: HTMLDivElement;
  icons: Record<keyof typeof ICON, HTMLElement>;
}
interface Timed {
  el: HTMLDivElement;
  at: number;
}

/** Боевой HUD поверх холста, pointer-events: none. Создаётся скрытым: показывает его захват мыши (setVisible). */
export function createCombatHud(root: HTMLElement): CombatHud {
  const hud = div("ch");
  hud.hidden = true;
  const vignette = div("ch-vignette");
  const numbersLayer = div("ch-layer");
  const barsLayer = div("ch-layer");
  const cross = div("ch-cross", RETICLE_SVG + HIT_SVG);
  const hit = pick<SVGSVGElement>(cross, ".ch-hit");
  const arcs: Timed[] = Array.from({ length: ARC_POOL }, () => ({ el: div("ch-arc"), at: -Infinity }));
  const arcFrom: Vec3[] = arcs.map(() => ({ x: 0, y: 0, z: 0 }));
  const arcAmount = arcs.map(() => 0);
  for (const a of arcs) cross.append(a.el);
  const toastsBox = div("ch-toasts");
  const toasts: Timed[] = Array.from({ length: TOAST_POOL }, () => ({ el: div("ch-toast"), at: -Infinity }));
  for (const t of toasts) toastsBox.append(t.el);
  const score = div("ch-score");
  // объявление руны (фаза 6): по центру сверху, под строкой матча PvP — та же позиция и на полигоне
  const runeLine = div("ch-rune");
  runeLine.hidden = true;
  // своя ярость — «Ярость N» золотом над правым краем мазка HP; имя стихии над мазком — с печатью стихии (знак и цвет)
  const life = div(
    "ch-life",
    `<div class="ch-elem"><span class="ch-seal" aria-hidden="true"></span><span class="ch-elem-name"></span></div><div class="ch-hp"><div class="ch-hp-trail"></div><div class="ch-hp-fill"></div><i class="ch-hp-notch"></i></div><div class="ch-hp-text"></div><div class="ch-fury" hidden></div>`,
  );
  const elemSeal = pick<HTMLSpanElement>(life, ".ch-seal");
  const elemName = pick<HTMLSpanElement>(life, ".ch-elem-name");
  const hpBox = pick<HTMLDivElement>(life, ".ch-hp");
  const furyLabel = pick<HTMLDivElement>(life, ".ch-fury");
  const hpTrail = pick<HTMLDivElement>(life, ".ch-hp-trail");
  const hpFill = pick<HTMLDivElement>(life, ".ch-hp-fill");
  const hpNotch = pick<HTMLElement>(life, ".ch-hp-notch");
  const hpText = pick<HTMLDivElement>(life, ".ch-hp-text");
  const kit = div("ch-kit", `<div class="ch-heat" hidden><div class="ch-heat-fill"></div><span class="ch-heat-label">Перегрев</span></div><div class="ch-cells"></div>`);
  const heat = pick<HTMLDivElement>(kit, ".ch-heat");
  const heatFill = pick<HTMLDivElement>(kit, ".ch-heat-fill");
  const cellsBox = pick<HTMLDivElement>(kit, ".ch-cells");
  const ensoSvg = `<svg viewBox="0 0 56 56" aria-hidden="true"><circle class="seat" cx="28" cy="28" r="${ENSO_R + 4}"/><circle class="ghost" cx="28" cy="28" r="${ENSO_R}"/><circle class="enso" cx="28" cy="28" r="${ENSO_R}" stroke-dasharray="${ENSO_LEN.toFixed(2)}"/></svg>`;
  const cells = {} as Record<Slot, Cell>;
  for (const slot of SLOTS) {
    // у X под кольцом — заряд ульты в процентах
    const pct = slot === "x" ? `<div class="ch-pct"></div>` : "";
    const c = div("ch-cell", `<div class="ch-flash"></div>${ensoSvg}<div class="ch-glyph"></div>${pct}<div class="ch-name"></div>`);
    c.dataset.slot = slot;
    cells[slot] = {
      root: c,
      enso: pick<SVGCircleElement>(c, ".enso"),
      glyph: pick<HTMLDivElement>(c, ".ch-glyph"),
      name: pick<HTMLDivElement>(c, ".ch-name"),
      flash: pick<HTMLDivElement>(c, ".ch-flash"),
      prevFrac: 0,
      flashAt: -Infinity,
      denyAt: -Infinity,
    };
    cellsBox.append(c);
  }
  const ultPct = pick<HTMLDivElement>(cells.x.root, ".ch-pct");
  hud.append(vignette, barsLayer, numbersLayer, cross, runeLine, toastsBox, score, life, kit);
  root.append(hud);

  const numberEls = Array.from({ length: NUMBER_POOL }, () => {
    const d = div("ch-num ch-at");
    numbersLayer.append(d);
    return d;
  });
  const bars = new Map<UnitId, DummyBar>();
  const barFor = (id: UnitId): DummyBar => {
    let b = bars.get(id);
    if (!b) {
      // сверху вниз: значки статусов, имя, полоса — имя не прыгает, когда появляются значки
      const r = div(
        "ch-dbar ch-at",
        `<div class="ch-dbar-st">${icon("burn")}${icon("root")}${icon("slow")}${icon("air")}</div><div class="ch-dbar-name" hidden></div><div class="ch-dbar-track"><div class="ch-dbar-fill"></div></div>`,
      );
      // ширина задаётся один раз; ближе или дальше полосу делает scaleX дорожки
      r.style.width = `${BAR_PX.max}px`;
      barsLayer.append(r);
      b = {
        root: r,
        name: pick<HTMLDivElement>(r, ".ch-dbar-name"),
        track: pick<HTMLDivElement>(r, ".ch-dbar-track"),
        fill: pick<HTMLDivElement>(r, ".ch-dbar-fill"),
        icons: { burn: pick(r, ".ch-st.burn"), root: pick(r, ".ch-st.root"), slow: pick(r, ".ch-st.slow"), air: pick(r, ".ch-st.air") },
      };
      bars.set(id, b);
    }
    return b;
  };

  let numbers: FloatingNumber[] = [];
  let hitAt = -Infinity;
  let hitKill = false;
  let hitTier: FeelTier = "small";
  let vignetteK = 0;
  let lastNowS = Number.NaN;
  let element: Elem | null = null;
  /** Свой виджет стихии в ките (Воздух, Вода); у Огня и Земли — null. */
  let widget: KitWidget | null = null;
  // экран: размер окна, без чтения раскладки в кадре
  let W = window.innerWidth;
  let H = window.innerHeight;
  const onResize = (): void => {
    W = window.innerWidth;
    H = window.innerHeight;
  };
  window.addEventListener("resize", onResize);

  const v = new Vector3();
  const screen = { x: 0, y: 0, depth: 0 };
  /** Точка мира → пиксели экрана; false — за камерой. depth — расстояние вдоль взгляда, м. */
  const project = (p: Vec3, cam: PerspectiveCamera): boolean => {
    v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -cam.near) return false;
    screen.depth = -v.z;
    v.applyMatrix4(cam.projectionMatrix);
    screen.x = ((v.x + 1) / 2) * W;
    screen.y = ((1 - v.y) / 2) * H;
    return true;
  };

  const setElement = (e: Elem): void => {
    if (element === e) return;
    element = e;
    setText(elemName, ELEMENT_INFO[e].name);
    elemSeal.dataset.element = e;
    elemSeal.innerHTML = glyphSvg(e);
    for (const slot of SLOTS) {
      const c = cells[slot];
      // у X — имя ульты стихии
      setText(c.name, slot === "x" ? ELEMENT_INFO[e].ult : ABILITY_NAME[ABILITY_OF[e][slot]]);
      c.root.style.setProperty("--ch-el", ELEMENT_COLOR[e]);
      c.prevFrac = 0;
    }
    setHidden(heat, e !== "fire");
    // смена стихии: виджет прежней — долой, новой — в кит
    widget?.dispose();
    widget = KIT_WIDGETS[e]?.(kit) ?? null;
  };

  const lerpPos = (prev: MatchState, u: Unit, alpha: number): Vec3 => {
    const a = unitById(prev, u.id)?.move.body.pos ?? u.move.body.pos;
    const b = u.move.body.pos;
    // скачок больше 3 м (возрождение, сброс) не тянем через полкарты
    const jump = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 3;
    const t = jump ? 1 : Math.min(1, Math.max(0, alpha));
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  };

  const updateKit = (me: Unit, now: number, nowS: number): void => {
    const m = me.mage;
    if (!m) return;
    setElement(m.element);
    // замах ЛКМ (камень, 0,2 с ≈ 1,9 раза в секунду) ячейки не гасит: иначе при зажатой ЛКМ мигали бы три ячейки
    const busy = m.windup !== null && m.windup.slot !== "primary";
    // идёт своя ульта: прочие слоты заняты до её конца (Р3)
    const ulting = m.ult.cast !== null;
    for (const slot of SLOTS) {
      const c = cells[slot];
      const ult = slot === "x";
      // X ждёт не перезарядку, а заряд ульты: кольцо заливается по мере заряда, полное — готова
      const frac = ult ? 1 - ultFraction(m) : cooldownFraction(m, slot, now);
      setStyle(c.enso, "strokeDashoffset", (ENSO_LEN * frac).toFixed(1));
      const ready = frac <= 0;
      c.root.classList.toggle("is-ready", ready);
      // замах шара не даёт стрелять ЛКМ, Q, C и X (Р14): ячейки бледнеют
      c.root.classList.toggle("is-busy", (busy && slot !== "e") || (ulting && !ult));
      // секунды до готовности — у Q / E / C; у ЛКМ перезарядка — доли секунды, у X — проценты под кольцом
      const counting = !ready && slot !== "primary" && !ult;
      c.glyph.classList.toggle("is-count", counting);
      setText(c.glyph, counting ? String(Math.ceil((m.ready[slot] - now) / TICK_HZ)) : KEY_LABEL[slot]);
      // готовность — короткая вспышка ячейки (у ЛКМ 5 раз/с — без вспышки); у X — толчок на полном заряде (ult/ready)
      if (ready && c.prevFrac > 0 && slot !== "primary") c.flashAt = nowS;
      c.prevFrac = frac;
      const fa = nowS - c.flashAt;
      if (fa >= 0 && fa < READY_FLASH_S) {
        const u = fa / READY_FLASH_S;
        setStyle(c.flash, "opacity", (1 - u).toFixed(3));
        setStyle(c.flash, "transform", `scale(${(1 + 0.3 * u).toFixed(3)})`);
      } else setStyle(c.flash, "opacity", "0");
      // «нельзя» — дрожь 150 мс
      const da = nowS - c.denyAt;
      const shake = da >= 0 && da < DENY_S ? 5 * Math.sin(da * 2 * Math.PI * 22) * (1 - da / DENY_S) : 0;
      setStyle(c.root, "transform", shake ? `translateX(${shake.toFixed(2)}px)` : "");
    }
    // X: заряд целыми процентами; полная — ярче и медленно пульсирует; идёт своя ульта — is-active
    setText(ultPct, `${ultPercent(m)}%`);
    cells.x.root.classList.toggle("is-ult-ready", ultFraction(m) >= 1);
    cells.x.root.classList.toggle("is-active", ulting);
    if (m.element === "fire") {
      setStyle(heatFill, "transform", `scaleX(${heatFraction(m).toFixed(4)})`);
      heat.classList.toggle("is-hot", now < m.overheatUntil);
    }
    widget?.update(me, now, nowS);
  };

  const updateLife = (me: Unit): void => {
    const bar = hpBar(me);
    const sx = `scaleX(${bar.frac.toFixed(4)})`;
    setStyle(hpFill, "transform", sx);
    setStyle(hpTrail, "transform", sx);
    setStyle(hpNotch, "left", `${(bar.notch * 100).toFixed(2)}%`);
    setHidden(hpNotch, bar.notch >= 1);
    setText(hpText, bar.text);
    const st = me.mage?.stats;
    if (st) setText(score, `Урон ${Math.round(st.damage)} · Убийства ${st.kills} · Сбросы ${st.falls}`);
  };

  /**
   * Руна ярости (фаза 6) — по cur (у игрока предсказанный), имена — из кадра. Строка сверху: «через N» последние 3 с
   * пульсирует (is-soon), появление бьёт печатью (is-here); без анимаций по настройке ОС — CSS. Своя ярость — у полосы HP.
   */
  const updateRune = (view: HudView): void => {
    const now = view.cur.tick;
    const cue = runeCue(view.cur, view.localId, now);
    setHidden(runeLine, cue === null);
    if (cue) {
      setText(runeLine, runeText(cue, view.names));
      runeLine.classList.toggle("is-soon", cue.kind === "soon" && cue.s <= RUNE_PULSE_S);
      runeLine.classList.toggle("is-here", cue.kind === "here");
    }
    const fury = furyLeftS(view.cur, view.localId, now);
    setHidden(furyLabel, fury <= 0);
    if (fury > 0) setText(furyLabel, `Ярость ${fury}`);
    hpBox.classList.toggle("is-fury", fury > 0);
  };

  const updateBars = (view: HudView): void => {
    const seen = new Set<UnitId>();
    const tanHalf = Math.tan(((view.camera.fov / 2) * Math.PI) / 180);
    for (const u of view.cur.units) {
      // манекены и живые чужие маги; над собой полосы нет
      if (!u.alive || (u.kind === "mage" && u.id === view.localId)) continue;
      const mage = u.kind === "mage";
      const p = lerpPos(view.prev, u, view.alpha);
      const head = { x: p.x, y: p.y + HEAD_M, z: p.z };
      const above = { x: p.x, y: p.y + (mage ? MAGE_BAR_M : HEAD_M + BAR_ABOVE_M), z: p.z };
      const d = Math.hypot(head.x - view.camera.position.x, head.y - view.camera.position.y, head.z - view.camera.position.z);
      if (d > BAR_RANGE_M || !project(above, view.camera) || !view.visible(head)) continue;
      seen.add(u.id);
      const b = barFor(u.id);
      setHidden(b.root, false);
      const px = Math.min(BAR_PX.max, Math.max(BAR_PX.min, (BAR_WORLD_M * H) / (2 * screen.depth * tanHalf)));
      setStyle(b.track, "transform", `scaleX(${(px / BAR_PX.max).toFixed(3)})`);
      setStyle(b.root, "transform", `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px) translate(-50%, -100%)`);
      setStyle(b.fill, "transform", `scaleX(${hpBar(u).frac.toFixed(4)})`);
      const name = mage ? (view.names?.get(u.id) ?? "") : "";
      setText(b.name, name);
      setHidden(b.name, name === "");
      const f = statusFlags(u, view.cur.tick);
      setHidden(b.icons.burn, !f.burning);
      setHidden(b.icons.root, !f.rooted);
      setHidden(b.icons.slow, !f.slowed);
      setHidden(b.icons.air, !f.airborne);
    }
    for (const [id, b] of bars) if (!seen.has(id)) setHidden(b.root, true);
  };

  const updateNumbers = (view: HudView): void => {
    numbers = numbers.filter((n) => view.nowS - n.updated < NUMBER_LIFE_S).slice(-NUMBER_POOL);
    for (let k = 0; k < NUMBER_POOL; k++) {
      const el = numberEls[k]!;
      const n = numbers[k];
      if (!n) {
        setStyle(el, "opacity", "0");
        continue;
      }
      // подъём — от рождения цифры, подскок и угасание — от последней прибавки: растущая цифра горения не гаснет
      const rise = numberAnim(view.nowS - n.born);
      const pop = numberAnim(view.nowS - n.updated);
      if (!project({ x: n.pos.x, y: n.pos.y + rise.dy, z: n.pos.z }, view.camera)) {
        setStyle(el, "opacity", "0");
        continue;
      }
      setText(el, formatDamage(n.amount, n.air));
      el.classList.toggle("is-dot", n.dot);
      setStyle(el, "opacity", pop.alpha.toFixed(3));
      setStyle(el, "transform", `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.scale.toFixed(3)})`);
    }
  };

  const updateCross = (view: HudView, dt: number): void => {
    // мазки вспыхивают крупнее и оседают; длительность и «поп» — по ступени, убийство — крупнее
    const hm = hitmarkerAnim(view.nowS - hitAt, hitTier, hitKill);
    if (hm) {
      setStyle(hit, "opacity", hm.alpha >= 1 ? "1" : hm.alpha.toFixed(3));
      setStyle(hit, "transform", `scale(${hm.scale.toFixed(3)})`);
    } else setStyle(hit, "opacity", "0");

    for (let k = 0; k < ARC_POOL; k++) {
      const a = arcs[k]!;
      const age = view.nowS - a.at;
      if (!(age >= 0 && age < INDICATOR_S)) {
        setStyle(a.el, "opacity", "0");
        continue;
      }
      // сторона источника в осях камеры: 0 — спереди (дуга сверху), π/2 — справа, π — сзади
      const f = arcFrom[k]!;
      v.set(f.x, f.y, f.z).applyMatrix4(view.camera.matrixWorldInverse);
      if (Math.hypot(v.x, v.z) < 1e-3) {
        setStyle(a.el, "opacity", "0");
        continue;
      }
      const angle = Math.atan2(v.x, -v.z);
      const strength = Math.min(1, 0.45 + arcAmount[k]! * VIGNETTE_PER_DMG);
      const fade = age < INDICATOR_S - 0.4 ? 1 : (INDICATOR_S - age) / 0.4;
      setStyle(a.el, "opacity", (strength * fade).toFixed(3));
      setStyle(a.el, "transform", `rotate(${angle.toFixed(4)}rad)`);
    }
    vignetteK = Math.max(0, vignetteK - VIGNETTE_DECAY_PER_S * dt);
    setStyle(vignette, "opacity", vignetteK.toFixed(3));
  };

  const updateToasts = (nowS: number): void => {
    for (const t of toasts) {
      const age = nowS - t.at;
      if (!(age >= 0 && age < TOAST_S)) {
        setStyle(t.el, "opacity", "0");
        continue;
      }
      // печать: ударом крупнее, оседает за 0,1 с, гаснет последние 0,3 с
      const s = age < 0.1 ? 1.25 - 2.5 * age : 1;
      const o = age > TOAST_S - 0.3 ? (TOAST_S - age) / 0.3 : 1;
      setStyle(t.el, "opacity", o.toFixed(3));
      setStyle(t.el, "transform", `scale(${s.toFixed(3)})`);
    }
  };

  /** Свободная ячейка пула — самая старая. */
  const oldest = (pool: Timed[]): number => {
    let k = 0;
    for (let i = 1; i < pool.length; i++) if (pool[i]!.at < pool[k]!.at) k = i;
    return k;
  };

  return {
    apply(e, nowS) {
      switch (e.kind) {
        case "hitmarker":
          hitAt = nowS;
          hitKill = e.kill;
          hitTier = e.tier ?? (e.kill ? "large" : "small");
          hit.classList.toggle("is-kill", e.kill);
          hit.classList.toggle("is-air", e.air);
          break;
        case "number":
          numbers = mergeNumbers(numbers, e, nowS);
          break;
        case "indicator": {
          const k = oldest(arcs);
          arcs[k]!.at = nowS;
          arcFrom[k] = { ...e.from };
          arcAmount[k] = e.amount;
          vignetteK = Math.min(1, Math.max(vignetteK, e.amount * VIGNETTE_PER_DMG));
          break;
        }
        case "toast": {
          // тот же текст ещё на экране — продлеваем, а не дублируем
          const same = toasts.find((t) => t.el.textContent === e.text && nowS - t.at < TOAST_S);
          const t = same ?? toasts[oldest(toasts)]!;
          t.at = nowS;
          setText(t.el, e.text);
          // новые тосты — сверху
          toastsBox.prepend(t.el);
          break;
        }
        case "deny":
          cells[e.slot].denyAt = nowS;
          break;
        default:
          break;
      }
    },
    update(view) {
      const dt = Number.isFinite(lastNowS) ? Math.min(0.25, Math.max(0, view.nowS - lastNowS)) : 0;
      lastNowS = view.nowS;
      const me = unitById(view.cur, view.localId);
      // время для перезарядок — между двумя тиками, как и всё остальное в кадре
      const now = view.prev.tick + (view.cur.tick - view.prev.tick) * Math.min(1, Math.max(0, view.alpha));
      if (me) {
        updateKit(me, now, view.nowS);
        updateLife(me);
      }
      updateRune(view);
      updateBars(view);
      updateNumbers(view);
      updateCross(view, dt);
      updateToasts(view.nowS);
    },
    setVisible(on) {
      hud.hidden = !on;
    },
    dispose() {
      window.removeEventListener("resize", onResize);
      widget?.dispose();
      widget = null;
      hud.remove();
      bars.clear();
      numbers = [];
    },
  };
}
