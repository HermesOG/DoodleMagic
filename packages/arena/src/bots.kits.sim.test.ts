import { describe, expect, it } from "vitest";
import {
  ELEMENTS, ULT_CHARGE, addMage, buildNav, claimsFor, createBot, createGame, pvpContext, stepBot, stepGame, unitById, voidDistM,
  type BotLevel, type BotState, type Element, type GameState, type MatchEvent, type MatchInput, type UnitId, type Vec3,
} from "@doodlemagic/sim";
import { buildGallery } from "./gallery";

/**
 * Фаза 8, задача 2: характеры стихий на «Галерее» — по сцене на условие (ГД 4). Уровень Маг, если не сказано иначе.
 * Ущелье: x −6…6, z −5…5; северная кромка — z = −5 (мост посередине, |x| ≤ 1,5).
 */
const arena = buildGallery("full");
const ctx = pvpContext(arena);
const nav = buildNav(ctx.world, ctx.killBelowY);
const LONG = 30_000;
const host = globalThis as unknown as { console: { log(...a: unknown[]): void } };
const report = (...a: unknown[]): void => host.console.log(...a);
/** Взгляд вдоль +z и −z (yaw: вперёд — (−sin, −cos)). */
const FACE_PZ = Math.PI;
const FACE_NZ = 0;

interface Scene { g: GameState; ids: UnitId[]; bots: BotState[] }

function scene(mages: { element: Element; at: Vec3; yaw?: number; bot?: BotLevel }[], seed = 1): Scene {
  let g = createGame();
  const ids: UnitId[] = [];
  const bots: BotState[] = [];
  mages.forEach((m, k) => {
    const r = addMage(g, m.element, ctx);
    g = r.game;
    ids.push(r.id);
    const u = unitById(g.match, r.id)!;
    u.move.body.pos = { ...m.at };
    u.move.yaw = m.yaw ?? 0;
    u.status.shieldUntil = 0;
    if (m.bot) bots.push(createBot(r.id, m.bot, seed * 31 + k));
  });
  return { g, ids, bots };
}

const idle = (yaw: number): MatchInput => ({ moveX: 0, moveZ: 0, jump: false, yaw, pitch: 0, primary: false, q: false, e: false, c: false, x: false });

/** Тик: боты по очереди, остальные — ввод script (по умолчанию стоят). */
function tick(sc: Scene, script?: (id: UnitId, t: number) => MatchInput | null): MatchEvent[] {
  const s = sc.g.match;
  const inputs: Partial<Record<UnitId, MatchInput>> = {};
  for (const id of sc.ids) {
    const u = unitById(s, id)!;
    inputs[id] = script?.(id, s.tick) ?? idle(u.move.yaw);
  }
  for (let k = 0; k < sc.bots.length; k++) {
    const r = stepBot(sc.bots[k]!, s, { nav, ctx, humans: [], claims: claimsFor(sc.bots, sc.bots[k]!.id) });
    inputs[sc.bots[k]!.id] = r.input;
    sc.bots[k] = r.bot;
  }
  const out = stepGame(sc.g, inputs, ctx);
  sc.g = out.game;
  return out.events;
}

describe("element characters on the gallery", () => {
  // Порыв идёт раньше Смерча (Смерч утаскивал цель с линии толчка). Сцена — у открытой кромки: при x = −4 Воздух
  // стоял за ширмой (z −12,2…−10,6, цели не видно), а толчок упирался в фонарь у кромки (x −6…−3)
  it("Air blows a mage standing 2.5 m from the gorge kerb with Gust, and the fall is credited to Air", () => {
    let ok = 0;
    for (let seed = 1; seed <= 3; seed++) {
      // цель в 2,5 м от северной кромки в просвете между мостом и фонарём (x 1,5…3,3), Воздух в 2,8 м за ней
      const sc = scene([{ element: "air", at: { x: 2.4, y: 0, z: -10.3 }, yaw: FACE_PZ, bot: "mage" }, { element: "water", at: { x: 2.4, y: 0, z: -7.5 }, yaw: FACE_NZ }], seed);
      const [air, target] = sc.ids as [UnitId, UnitId];
      expect(voidDistM(nav, { x: 2.4, y: 0, z: -7.5 })).toBeLessThan(5);
      let fell = false;
      for (let t = 0; t < 600 && !fell; t++) {
        for (const e of tick(sc)) if (e.type === "fall" && e.target === target) fell = e.credit === air;
      }
      if (fell) ok++;
    }
    report(`gust ring-outs ${ok}/3`);
    expect(ok).toBeGreaterThanOrEqual(2);
  }, LONG);

  // столб ложился под самого бота: в бою он отступал за укрытие и жал Q в стену перед собой — теперь ждёт точку у цели
  it("Earth puts a pillar under a mage standing 15 m away", () => {
    const sc = scene([{ element: "earth", at: { x: 8, y: 0, z: -10 }, yaw: Math.PI / 2, bot: "mage" }, { element: "fire", at: { x: -7, y: 0, z: -10 } }]);
    let pillarAt: Vec3 | null = null;
    for (let t = 0; t < 600 && !pillarAt; t++) {
      tick(sc);
      const z = sc.g.match.zones.find((q) => q.kind === "pillar" && q.owner === sc.ids[0]);
      if (z && z.shape.type === "box") pillarAt = { x: (z.shape.box.min.x + z.shape.box.max.x) / 2, y: 0, z: (z.shape.box.min.z + z.shape.box.max.z) / 2 };
    }
    expect(pillarAt).not.toBeNull();
    expect(Math.hypot(pillarAt!.x + 7, pillarAt!.z + 10)).toBeLessThan(1.5);
  }, LONG);

  it("Water raises the ward against a fireball flying at it", () => {
    let raised = 0;
    for (let seed = 1; seed <= 5; seed++) {
      // Огонь в 18 м на той же линии бросает шар в Воду на 40-м тике
      const sc = scene([{ element: "water", at: { x: 8, y: 0, z: -9 }, yaw: Math.PI / 2, bot: "mage" }, { element: "fire", at: { x: -10, y: 0, z: -9 }, yaw: -Math.PI / 2 }], seed);
      const [water, fire] = sc.ids as [UnitId, UnitId];
      const shoot = (id: UnitId, t: number): MatchInput | null => (id === fire ? { ...idle(-Math.PI / 2), q: t === 40, pitch: -0.02 } : null);
      let warded = false;
      for (let t = 0; t < 160 && !warded; t++) for (const e of tick(sc, shoot)) if (e.type === "cast" && e.unit === water && e.ability === "waterWard") warded = sc.g.match.projectiles.some((p) => p.ability === "fireball") || e.type === "cast";
      if (warded) raised++;
    }
    report(`wards vs fireball ${raised}/5`);
    expect(raised).toBeGreaterThanOrEqual(2);
  }, LONG);

  it("an Archmage Fire blown over the gorge by Gust dashes back to the floor in most seeds", () => {
    let saved = 0;
    let overVoid = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const sc = scene([{ element: "fire", at: { x: -4, y: 0, z: -6.5 }, yaw: FACE_PZ, bot: "archmage" }, { element: "air", at: { x: -4, y: 0, z: -9.5 }, yaw: FACE_PZ }], seed);
      const [fire, air] = sc.ids as [UnitId, UnitId];
      let fell = false;
      let over = false;
      for (let t = 0; t < 240 && !fell; t++) {
        if (t === 3 + seed) {
          // толчок Порыва {7, 1} к ущелью, как applyHit: подброс 1 м, канал 7 м за полёт, «В воздухе» 0,3 с
          const u = unitById(sc.g.match, fire)!;
          const now = sc.g.match.tick;
          u.move.body.vel.y = Math.sqrt(2 * 20 * 1);
          Object.assign(u.move, { onGround: false, coyote: 0 });
          u.kb = { x: 0, z: 7 / 0.63 };
          Object.assign(u.status, { airborne: true, noControlUntil: now + 18 });
          Object.assign(u, { lastHitBy: air, lastHitTick: now });
        }
        for (const e of tick(sc)) if (e.type === "fall" && e.target === fire) fell = true;
        const u = unitById(sc.g.match, fire)!;
        if (u.alive && voidDistM(nav, u.move.body.pos) === 0 && !u.move.onGround) over = true;
      }
      if (over) overVoid++;
      if (over && !fell) saved++;
    }
    report(`fire rescues ${saved}/${overVoid} over the void`);
    expect(overVoid).toBeGreaterThanOrEqual(8);
    expect(saved).toBeGreaterThanOrEqual(6);
  }, LONG);

  it("Earth never casts the earthquake at a gliding Air", () => {
    const sc = scene([{ element: "earth", at: { x: 8, y: 0, z: -10 }, yaw: Math.PI / 2, bot: "mage" }, { element: "air", at: { x: 4.5, y: 0, z: -10 } }]);
    const [earth, air] = sc.ids as [UnitId, UnitId];
    // прыжок, второй прыжок и парение по кругу 1,5 с
    const glide = (id: UnitId, t: number): MatchInput | null => {
      if (id !== air) return null;
      const k = t % 150;
      return { ...idle(-Math.PI / 2), jump: k < 2 || (k >= 20 && k < 140 && k !== 21 && k !== 22 ? k >= 23 || k === 20 : false) };
    };
    let quakes = 0;
    let airborne = 0;
    for (let t = 0; t < 900; t++) {
      const flying = !unitById(sc.g.match, air)!.move.onGround;
      if (flying) airborne++;
      for (const e of tick(sc, glide)) if (e.type === "cast" && e.unit === earth && e.ability === "earthquake" && flying) quakes++;
    }
    expect(airborne).toBeGreaterThan(300);
    expect(quakes).toBe(0);
  }, LONG);

  it.each(ELEMENTS)("%s presses X with two enemies in range and a full charge", (element) => {
    const sc = scene([
      { element, at: { x: 10, y: 0, z: -9 }, yaw: Math.PI / 2, bot: "mage" },
      { element: "earth", at: { x: 4, y: 0, z: -9 } }, { element: "earth", at: { x: 3, y: 0, z: -9.6 } },
    ]);
    let pressed = false;
    for (let t = 0; t < 300 && !pressed; t++) {
      unitById(sc.g.match, sc.ids[0]!)!.mage!.ult.charge = ULT_CHARGE.max;
      for (const e of tick(sc)) if (e.type === "cast" && e.unit === sc.ids[0] && e.slot === "x") pressed = true;
    }
    expect(pressed).toBe(true);
  }, LONG);

  it("a Novice Earth makes no combos: in 2 minutes no pillar and stone hit on one target within 0.5 s", () => {
    const sc = scene([{ element: "earth", at: { x: 8, y: 0, z: -10 }, yaw: Math.PI / 2, bot: "novice" }, { element: "fire", at: { x: -7, y: 0, z: -10 } }]);
    const [earth, target] = sc.ids as [UnitId, UnitId];
    let pillarHit = -1e9;
    let pillars = 0;
    let combos = 0;
    for (let t = 0; t < 2 * 60 * 60; t++) {
      const u = unitById(sc.g.match, target)!;
      u.hp = u.maxHp;
      for (const e of tick(sc)) {
        if (e.type !== "hit" || e.source !== earth || e.target !== target) continue;
        if (e.ability === "stonePillar") {
          pillarHit = sc.g.match.tick;
          pillars++;
        } else if (e.ability === "stoneShot" && sc.g.match.tick - pillarHit <= 30) combos++;
      }
    }
    report(`novice earth: pillar hits ${pillars}, combos ${combos}`);
    expect(combos).toBe(0);
  }, LONG);
});

