import { PerspectiveCamera } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ABILITY_IDS, ELEMENT_INFO, NOBODY, ULT_IDS, createGame, createMageUnit, createMatchState,
  type Element, type GameState, type MatchEvent, type MatchState, type UnitId, type Zone, type ZoneKind,
} from "@doodlemagic/sim";
import { effectsFor, hitTier } from "../feel/eventMap";
import { zoneDecal } from "../fx/decals";
import { createGestures, isFistGesture, startGesture, stepGestures } from "../hands/gestures";
import { eventKey } from "../net/predict";
import { deathLine, feedLine } from "../pvp/format";
import { createCombatHud, type CombatHud } from "./combatHud";
import { ultFraction, ultPercent } from "./format";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const ME = 1;
const OTHER = 3;

/** Маг стихии el с зарядом ульты charge. */
const mage = (charge: number, el: Element = "fire") => {
  const u = createMageUnit(ME, el, { pos: V(), yaw: 0 });
  u.mage!.ult.charge = charge;
  return u;
};

describe("ultFraction, ultPercent", () => {
  it("fills the X ring by charge / 100, never above 1; the percent is whole and rounds down", () => {
    expect([0, 50, 100, 130].map((c) => ultFraction(mage(c).mage!))).toEqual([0, 0.5, 1, 1]);
    expect([0, 29, 73.4, 99.6, 100, 130].map((c) => ultPercent(mage(c).mage!))).toEqual([0, 29, 73, 99, 100, 100]);
    expect([ultFraction(mage(-5).mage!), ultFraction(mage(Number.NaN).mage!), ultPercent(mage(Number.NaN).mage!)]).toEqual([0, 0, 0]);
  });
});

/**
 * Тесты идут в node: вместо DOM — элемент-двойник (как в hudMenu.test). querySelector отдаёт по селектору всегда
 * один и тот же двойник (разметку innerHTML он не разбирает), document.createElement — новый.
 */
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
  appendChild(n: FakeEl): FakeEl {
    this.children.push(n);
    return n;
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

describe("combat HUD: the X cell", () => {
  let root: FakeEl;
  let hud: CombatHud;
  const camera = new PerspectiveCamera(75, 16 / 9, 0.1, 200);
  const view = (s: MatchState, nowS = 1) => ({ cur: s, prev: s, alpha: 1, localId: ME, camera, nowS, visible: () => true });
  const state = (charge: number, el: Element = "fire"): MatchState => {
    const s = createMatchState([mage(charge, el)]);
    s.tick = 600;
    return s;
  };
  const cells = (): FakeEl[] => root.children[0]!.children.find((c) => c.className === "ch-kit")!.querySelector(".ch-cells").children;
  const x = (): FakeEl => cells().find((c) => c.dataset.slot === "x")!;

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

  it("is the fifth cell of the kit: no «soon» cell, the ult name of the mage's element", () => {
    hud.update(view(state(0)));
    expect(cells().map((c) => c.dataset.slot)).toEqual(["primary", "q", "e", "c", "x"]);
    expect(cells().some((c) => c.className.includes("is-soon"))).toBe(false);
    for (const el of ["fire", "earth", "air", "water"] as const) {
      hud.update(view(state(0, el)));
      expect([x().querySelector(".ch-glyph").textContent, x().querySelector(".ch-name").textContent]).toEqual(["X", ELEMENT_INFO[el].ult]);
    }
  });

  it("fills the ring by charge, writes whole percent under it, and lights up when full", () => {
    hud.update(view(state(73.4)));
    expect(x().querySelector(".ch-pct").textContent).toBe("73%");
    expect([x().classList.contains("is-ult-ready"), x().classList.contains("is-ready")]).toEqual([false, false]);
    const len = 2 * Math.PI * 22;
    expect(Number(x().querySelector(".enso").style.strokeDashoffset)).toBeCloseTo(len * (1 - 0.734), 0);
    hud.update(view(state(100)));
    expect(x().querySelector(".ch-pct").textContent).toBe("100%");
    expect([x().classList.contains("is-ult-ready"), x().classList.contains("is-ready")]).toEqual([true, true]);
    expect(Number(x().querySelector(".enso").style.strokeDashoffset)).toBe(0);
    // полный заряд — толчок ячейки: вспышка готовности, как у прочих слотов
    expect(Number(x().querySelector(".ch-flash").style.opacity)).toBeGreaterThan(0.9);
  });

  it("marks my own ult as active and pales the other slots until it ends", () => {
    const s = state(0);
    s.units[0]!.mage!.ult.cast = { ability: "dragonBreath", startTick: 590, releaseTick: 626, endTick: 806, zone: NOBODY };
    hud.update(view(s));
    expect(x().classList.contains("is-active")).toBe(true);
    expect(cells().map((c) => c.classList.contains("is-busy"))).toEqual([true, true, true, true, false]);
    hud.update(view(state(0)));
    expect([x().classList.contains("is-active"), cells().some((c) => c.classList.contains("is-busy"))]).toEqual([false, false]);
  });

  it("shakes the X cell on an uncharged press — the same deny path as every slot", () => {
    const deny = effectsFor({ type: "reject", unit: ME, slot: "x", reason: "uncharged" }, { localId: ME, state: state(40) });
    expect(deny).toEqual([{ kind: "deny", slot: "x" }]);
    hud.update(view(state(40), 1));
    for (const e of deny) hud.apply(e, 1);
    hud.update(view(state(40), 1.01));
    expect(x().style.transform).toMatch(/^translateX\(/);
    hud.update(view(state(40), 1.5));
    expect(x().style.transform).toBe("");
  });
});

describe("ult events: net keys and feel", () => {
  const view = { localId: ME, state: createMatchState([createMageUnit(ME, "fire", { pos: V(), yaw: 0 }), createMageUnit(OTHER, "water", { pos: V(6, 0, -8), yaw: 0.4 })]) };
  const ult = (unit: UnitId, phase: "ready" | "release" | "end", pos = V()): MatchEvent => ({ type: "ult", unit, ability: "tsunami", phase, pos, dir: V(0, 0, -1) });
  const castX = (unit: UnitId, ability: (typeof ULT_IDS)[number]): MatchEvent => ({ type: "cast", unit, ability, slot: "x", pos: V(6, 1.6, -8), dir: V(0, 0, -1) });

  it("keys an ult event by unit, ability and phase — not by where it happened", () => {
    expect(eventKey(ult(3, "release"))).toBe("ult:3:tsunami:release");
    expect(eventKey(ult(3, "release", V(5, 1, 2)))).toBe(eventKey(ult(3, "release")));
    expect(new Set(["ready", "release", "end"].map((p) => eventKey(ult(3, p as "ready"))))).toHaveProperty("size", 3);
  });

  it("warns about another mage's ult across the whole map; my own cast does not warn", () => {
    for (const a of ULT_IDS) {
      const theirs = effectsFor(castX(OTHER, a), view);
      expect(theirs[0]).toEqual({ kind: "sound", id: "ultWarn", pos: null, gain: 1 });
      const mine = effectsFor(castX(ME, a), view);
      expect(mine.some((e) => e.kind === "sound" && e.id === "ultWarn")).toBe(false);
      // свой каст — как у прочих способностей: жест раньше ладоней
      expect(mine[0]).toEqual({ kind: "gesture", ability: a });
    }
  });

  it("clicks «ready» only for my own full charge; other phases and other mages are left to the elements", () => {
    expect(effectsFor(ult(ME, "ready"), view)).toEqual([{ kind: "sound", id: "ultReady", pos: null, gain: 1 }]);
    expect(effectsFor(ult(OTHER, "ready"), view)).toEqual([]);
    // выпуск Цунами оформляет Вода (waterFx, задача 6): «готово» на нём не щёлкает
    expect(effectsFor(ult(ME, "release"), view).some((e) => e.kind === "sound" && e.id === "ultReady")).toBe(false);
    expect(effectsFor(ult(ME, "end"), view)).toEqual([]);
  });

  it("puts ult hits in the large tier", () => {
    for (const ability of ULT_IDS) expect(hitTier({ ability, dot: false, killed: false })).toBe("large");
  });
});

describe("ult names in the kill feed and on the death screen", () => {
  const NAMES: ReadonlyMap<UnitId, string> = new Map([[1, "Искра 42"], [2, "Валун 17"]]);
  const death = (killer: UnitId, target: UnitId, ability: (typeof ULT_IDS)[number]): MatchEvent => ({ type: "death", target, killer, ability, pos: V() });

  it("names the ult from ELEMENT_INFO", () => {
    expect(feedLine(death(1, 2, "tsunami"), NAMES, 3)).toEqual({ text: "Искра 42 → Валун 17 · Цунами", mine: false });
    const match = createMatchState([createMageUnit(1, "fire", { pos: V(), yaw: 0 }), createMageUnit(2, "earth", { pos: V(), yaw: 0 })]);
    match.units[0]!.hp = 61.2;
    const g: GameState = { ...createGame(), phase: "live", match };
    expect(deathLine(death(1, 2, "dragonBreath"), g, NAMES)).toBe("Тебя победил Искра 42 · Дыхание дракона · у него 62 HP");
    expect(feedLine(death(2, 1, "tectonicRift"), NAMES, 1)?.text).toBe("Валун 17 → Искра 42 · Тектонический разлом");
    expect(feedLine(death(2, 1, "hurricane"), NAMES, 1)?.text).toBe("Валун 17 → Искра 42 · Ураган");
  });
});

describe("client registries cover the new abilities and zones", () => {
  it("has a gesture for every ability; every ult moves the hands", () => {
    for (const a of ABILITY_IDS) expect(typeof isFistGesture(a), a).toBe("boolean");
    // задачи 5 и 6 дали всем ультам свои жесты (не копии C): проверяем только, что ульта двигает руки
    for (const a of ULT_IDS) {
      const pose = (ability: (typeof ABILITY_IDS)[number]) => stepGestures(startGesture(createGestures(), ability), 0.3).pose;
      expect(Object.values(pose(a).right).some((v) => Math.abs(v) > 1e-3) || Object.values(pose(a).left).some((v) => Math.abs(v) > 1e-3), a).toBe(true);
    }
  });

  it("has a decal style entry for every zone kind; the rift is a crack on the floor, the tsunami wave draws no floor decal", () => {
    const KINDS = {
      fireWall: 1, fireTrail: 1, pillar: 1, quake: 1, tornado: 1, fireTornado: 1, sandTornado: 1, spring: 1, steam: 1, bog: 1, rift: 1, tsunami: 1,
    } satisfies Record<ZoneKind, 1>;
    const zone = (kind: ZoneKind): Zone => ({
      id: 7, owner: ME, kind, ability: "spring", shape: { type: "disc", center: V(), radius: 3 }, bornTick: 0, armTick: 30, endTick: 300, rehit: [],
    });
    for (const kind of Object.keys(KINDS) as ZoneKind[]) {
      const d = zoneDecal(zone(kind), 60);
      expect(d === null || typeof d.style === "string", kind).toBe(true);
    }
    // задача 5: трещина Разлома — декаль rift; волна Цунами — своим мешем
    expect([zoneDecal(zone("rift"), 10)?.style, zoneDecal(zone("tsunami"), 60)]).toEqual(["rift", null]);
  });
});
