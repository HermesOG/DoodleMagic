import { PerspectiveCamera } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOBODY, createMageUnit, createMatchState, type MatchEvent, type MatchState, type UnitId } from "@doodlemagic/sim";
import { feedLine } from "../pvp/format";
import { createCombatHud, type CombatHud } from "./combatHud";
import { furyLeftS, runeNotice } from "./format";

/** Объявление руны, своя ярость у полосы HP и строки килфида (фаза 6, задача 3). */
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 2;
const RUNE_AT = 2700;
const NAMES: ReadonlyMap<UnitId, string> = new Map([[1, "Искра 42"], [2, "Валун 17"]]);

/** Два мага и руна, которая появится (или появилась) на тике readyAt; сферы лежат с начала. */
function state(readyAt = RUNE_AT, tick = 0): MatchState {
  const s = createMatchState([createMageUnit(ME, "fire", { pos: V(), yaw: 0 }), createMageUnit(OTHER, "earth", { pos: V(6, 0, -8), yaw: 0.4 })]);
  s.pickups = [
    { kind: "orb", pos: V(10, 0.5, 0), readyAt: -1_000_000 },
    { kind: "rune", pos: V(0, 0.5, -20), readyAt },
  ];
  s.tick = tick;
  return s;
}
const sec = (s: number) => Math.round(s * 60);

describe("runeNotice", () => {
  it("counts the last 10 s before the rune, seconds rounded up; silent before that", () => {
    const s = state();
    expect(runeNotice(s, ME, RUNE_AT - sec(10))).toBe("Руна ярости через 10");
    expect(runeNotice(s, ME, RUNE_AT - sec(9.1))).toBe("Руна ярости через 10");
    expect(runeNotice(s, ME, RUNE_AT - sec(0.5))).toBe("Руна ярости через 1");
    expect(runeNotice(s, ME, RUNE_AT - sec(10) - 1)).toBeNull();
    expect(runeNotice(s, ME, 0)).toBeNull();
  });

  it("calls the rune in the centre for its first 3 s on the floor, then falls silent while it lies", () => {
    const s = state();
    expect(runeNotice(s, ME, RUNE_AT)).toBe("Руна ярости в центре");
    expect(runeNotice(s, ME, RUNE_AT + sec(2))).toBe("Руна ярости в центре");
    expect(runeNotice(s, ME, RUNE_AT + sec(3))).toBe("Руна ярости в центре");
    expect(runeNotice(s, ME, RUNE_AT + sec(5))).toBeNull();
  });

  it("names another holder with the fury seconds left; a nameless holder is «мага»; my own fury is not here", () => {
    const now = RUNE_AT + sec(20);
    const s = state(RUNE_AT + sec(60), now);
    s.units[1]!.status.furyUntil = now + sec(7.2);
    expect(runeNotice(s, ME, now, NAMES)).toBe("Руна у Валун 17 · 8");
    expect(runeNotice(s, ME, now)).toBe("Руна у мага · 8");
    expect(runeNotice(s, ME, now, new Map([[1, "Искра 42"]]))).toBe("Руна у мага · 8");
    // глазами носителя: своя ярость — у полосы HP, строки нет
    expect(runeNotice(s, OTHER, now, NAMES)).toBeNull();
    // погибший носитель ярость потерял
    s.units[1]!.alive = false;
    expect(runeNotice(s, ME, now, NAMES)).toBeNull();
  });

  it("puts the coming rune before the holder: the announcement is for the whole arena", () => {
    const now = RUNE_AT + sec(50);
    const s = state(RUNE_AT + sec(60), now);
    s.units[1]!.status.furyUntil = now + sec(5);
    expect(runeNotice(s, ME, now, NAMES)).toBe("Руна ярости через 10");
  });
});

describe("furyLeftS", () => {
  it("is my fury in whole seconds rounded up; 0 without fury, after it ends or when dead", () => {
    const now = 4000;
    const s = state(RUNE_AT, now);
    expect(furyLeftS(s, ME, now)).toBe(0);
    s.units[0]!.status.furyUntil = now + 300;
    expect(furyLeftS(s, ME, now)).toBe(5);
    expect(furyLeftS(s, ME, now - 1)).toBe(6);
    expect(furyLeftS(s, ME, now + 300)).toBe(0);
    expect(furyLeftS(s, OTHER, now)).toBe(0);
    s.units[0]!.alive = false;
    expect(furyLeftS(s, ME, now)).toBe(0);
  });
});

describe("kill feed: the rune and its holder", () => {
  const pickup = (kind: "orb" | "rune", phase: "warn" | "spawn" | "take", unit: UnitId = NOBODY): MatchEvent => ({ type: "pickup", kind, index: 0, phase, unit, pos: V() });
  const fury = (unit: UnitId, phase: "end" | "slain", by: UnitId): MatchEvent => ({ type: "fury", unit, phase, by, pos: V() });

  it("writes who took the rune; mine when I took it", () => {
    expect(feedLine(pickup("rune", "take", 1), NAMES, 3)).toEqual({ text: "Искра 42 · руна ярости", mine: false });
    expect(feedLine(pickup("rune", "take", 1), NAMES, 1)).toEqual({ text: "Искра 42 · руна ярости", mine: true });
    expect(feedLine(pickup("rune", "take", 9), NAMES, 1)).toEqual({ text: "Маг · руна ярости", mine: false });
  });

  it("writes who slew the holder and the +10; mine for the slayer and the holder", () => {
    expect(feedLine(fury(2, "slain", 1), NAMES, 3)).toEqual({ text: "Искра 42 · +10 к ульте за носителя руны", mine: false });
    expect(feedLine(fury(2, "slain", 1), NAMES, 1)?.mine).toBe(true);
    expect(feedLine(fury(2, "slain", 1), NAMES, 2)?.mine).toBe(true);
    // сбивший вышел: заряд никому, строки нет
    expect(feedLine(fury(2, "slain", 9), NAMES, 1)).toBeNull();
  });

  it("stays quiet about warnings, spawns, orbs, the end of a fury and a holder who fell alone", () => {
    for (const ev of [pickup("rune", "warn"), pickup("rune", "spawn"), pickup("orb", "spawn"), pickup("orb", "take", 1), fury(1, "end", NOBODY), fury(1, "slain", NOBODY)])
      expect(feedLine(ev, NAMES, 1)).toBeNull();
  });
});

/** Элемент-двойник DOM, как в ultHud.test: querySelector по селектору — всегда один и тот же двойник. */
class FakeEl {
  textContent = "";
  hidden = false;
  className = "";
  innerHTML = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> & { setProperty(k: string, v: string): void } = Object.assign(Object.create(null) as Record<string, string>, {
    setProperty(this: Record<string, string>, k: string, v: string) {
      this[k] = v;
    },
  });
  private readonly classes = new Set<string>();
  classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on?: boolean) => {
      const want = on ?? !this.classes.has(c);
      if (want) this.classes.add(c);
      else this.classes.delete(c);
      return want;
    },
  };
  readonly children: FakeEl[] = [];
  private readonly found = new Map<string, FakeEl>();
  append(...nodes: FakeEl[]): void {
    this.children.push(...nodes);
  }
  prepend(...nodes: FakeEl[]): void {
    this.children.unshift(...nodes);
  }
  remove(): void {}
  querySelector(selector: string): FakeEl {
    let e = this.found.get(selector);
    if (!e) {
      e = new FakeEl();
      this.found.set(selector, e);
    }
    return e;
  }
}

describe("combat HUD: the rune line and my fury", () => {
  let root: FakeEl;
  let hud: CombatHud;
  const camera = new PerspectiveCamera(75, 16 / 9, 0.1, 200);
  const view = (s: MatchState, names?: ReadonlyMap<UnitId, string>) => ({ cur: s, prev: s, alpha: 1, localId: ME, camera, nowS: 1, visible: () => true, names });
  const part = (cls: string): FakeEl => root.children[0]!.children.find((c) => c.className === cls)!;
  const line = (): FakeEl => part("ch-rune");
  const life = (): FakeEl => part("ch-life");

  beforeEach(() => {
    vi.stubGlobal("document", { createElement: () => new FakeEl() });
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720, addEventListener: () => undefined, removeEventListener: () => undefined });
    root = new FakeEl();
    hud = createCombatHud(root as unknown as HTMLElement);
  });
  afterEach(() => {
    hud.dispose();
    vi.unstubAllGlobals();
  });

  it("shows the announcement from the frame's state, pulses in the last 3 s and stamps the spawn", () => {
    hud.update(view(state(RUNE_AT, RUNE_AT - sec(20))));
    expect(line().hidden).toBe(true);
    hud.update(view(state(RUNE_AT, RUNE_AT - sec(9.5))));
    expect([line().hidden, line().textContent, line().classList.contains("is-soon")]).toEqual([false, "Руна ярости через 10", false]);
    hud.update(view(state(RUNE_AT, RUNE_AT - sec(2.5))));
    expect([line().textContent, line().classList.contains("is-soon")]).toEqual(["Руна ярости через 3", true]);
    hud.update(view(state(RUNE_AT, RUNE_AT + 1)));
    expect([line().textContent, line().classList.contains("is-soon"), line().classList.contains("is-here")]).toEqual(["Руна ярости в центре", false, true]);
    hud.update(view(state(RUNE_AT, RUNE_AT + sec(6))));
    expect(line().hidden).toBe(true);
  });

  it("names another holder with the names of the frame", () => {
    const now = RUNE_AT + sec(20);
    const s = state(RUNE_AT + sec(60), now);
    s.units[1]!.status.furyUntil = now + sec(4);
    hud.update(view(s, NAMES));
    expect([line().hidden, line().textContent, line().classList.contains("is-here")]).toEqual([false, "Руна у Валун 17 · 4", false]);
  });

  it("writes «Ярость N» by my HP bar in gold and marks the bar while my fury lasts", () => {
    const now = RUNE_AT + sec(20);
    const s = state(RUNE_AT + sec(60), now);
    s.units[0]!.status.furyUntil = now + sec(8.5);
    hud.update(view(s));
    const fury = life().querySelector(".ch-fury");
    expect([fury.hidden, fury.textContent, life().querySelector(".ch-hp").classList.contains("is-fury")]).toEqual([false, "Ярость 9", true]);
    // своя ярость — не строка руны сверху
    expect(line().hidden).toBe(true);
    s.units[0]!.status.furyUntil = now;
    hud.update(view(s));
    expect([fury.hidden, life().querySelector(".ch-hp").classList.contains("is-fury")]).toEqual([true, false]);
  });
});
