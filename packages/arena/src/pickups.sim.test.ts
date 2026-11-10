import { describe, expect, it } from "vitest";
import {
  NEVER, NO_MATCH_INPUT, createMatch, initPickups, matchContext, pickupPresent, stepMatch,
  type MatchEvent, type MatchInput, type MatchState, type UnitId, type Vec3,
} from "@doodlemagic/sim";
import { buildGallery } from "./gallery";

/** Фаза 6: сферы и руна на «Галерее над ущельем» (6 сфер и руна по GDD 3). */
const arena = buildGallery("full");
const ctx = matchContext(arena);
const RUNE = arena.pickups.findIndex((p) => p.kind === "rune");

/** Глубокая заморозка входа: любая запись в него бросит TypeError. */
function freeze<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  for (const k of Object.keys(v)) freeze((v as Record<string, unknown>)[k]);
  return Object.freeze(v);
}
type Log = { t: number; e: MatchEvent }[];
function steps(s: MatchState, n: number, input: (tick: number, s: MatchState) => Partial<Record<UnitId, MatchInput>> = () => ({})): { s: MatchState; log: Log } {
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const t = s.tick;
    const r = stepMatch(freeze(s), input(t, s), ctx);
    s = r.state;
    for (const e of r.events) log.push({ t, e });
  }
  return { s, log };
}
const takes = (log: Log) => log.flatMap(({ e }) => (e.type === "pickup" && e.phase === "take" ? [[e.kind, e.index, e.unit]] : []));

describe("pickups on the gallery", () => {
  it("matchContext gives 7 points — 6 orbs and the rune; the first step lays the orbs at once and the rune at 2700", () => {
    expect([ctx.pickups!.length, ctx.pickups!.filter((p) => p.kind === "orb").length, ctx.pickups!.filter((p) => p.kind === "rune").length]).toEqual([7, 6, 1]);
    const r = steps(createMatch({ mages: [{ element: "fire", spawn: { pos: { x: -5, y: 0, z: -8.5 }, yaw: 0 } }], dummies: [] }), 1);
    expect(r.s.pickups).toEqual(initPickups(arena.pickups, 0));
    expect(r.s.pickups.map((p) => p.readyAt)).toEqual(arena.pickups.map((p) => (p.kind === "rune" ? 2700 : NEVER)));
    expect(r.log.filter(({ e }) => e.type === "pickup")).toEqual([]);
  });

  it("a wounded mage standing under any point takes it", () => {
    arena.pickups.forEach((p, k) => {
      const s = createMatch({ mages: [{ element: "earth", spawn: { pos: { x: p.pos.x, y: p.pos.y - 0.5, z: p.pos.z }, yaw: 0 } }], dummies: [] });
      s.units[0]!.hp = 50;
      s.pickups = initPickups(arena.pickups, 0);
      s.pickups[RUNE]!.readyAt = -1; // руна уже лежит
      expect(takes(steps(s, 1).log), `${p.kind} ${k}`).toEqual([[p.kind, k, 1]]);
    });
  });

  it("4000 ticks with two mages fighting and running for an orb and the rune are byte-identical twice", () => {
    const ORB = 0; // западная сфера половины A
    const yawTo = (from: Vec3, to: Vec3): number => Math.atan2(-(to.x - from.x), -(to.z - from.z));
    const go = (from: Vec3, to: Vec3): Partial<MatchInput> => {
      const far = Math.hypot(to.x - from.x, to.z - from.z) > 0.3;
      return { yaw: yawTo(from, to), moveZ: far ? 1 : 0 };
    };
    /** Огонь на мосту ждёт руну, Вода у моста — сферу; через каждые 200 тиков — перестрелка. */
    const drive = (tick: number, s: MatchState): Partial<Record<UnitId, MatchInput>> => {
      const out: Partial<Record<UnitId, MatchInput>> = {};
      for (const u of s.units) {
        if (!u.alive) continue;
        const foe = s.units.find((o) => o.id !== u.id)!;
        const p = u.move.body.pos;
        if (tick % 400 < 200) {
          out[u.id] = { ...NO_MATCH_INPUT, yaw: yawTo(p, foe.move.body.pos), primary: tick % 30 < 15 };
          continue;
        }
        const rune = s.pickups[RUNE]!;
        const orb = s.pickups[ORB]!;
        const goal = u.id === 1 ? (pickupPresent(rune, tick) ? rune.pos : null) : u.hp < u.maxHp && pickupPresent(orb, tick) ? orb.pos : null;
        out[u.id] = { ...NO_MATCH_INPUT, ...(goal ? go(p, goal) : { yaw: u.move.yaw }) };
      }
      return out;
    };
    const run = () =>
      steps(
        createMatch({ mages: [{ element: "fire", spawn: { pos: { x: 0, y: 0, z: -3.5 }, yaw: Math.PI } }, { element: "water", spawn: { pos: { x: 0, y: 0, z: -8 }, yaw: 0 } }], dummies: [] }),
        4000,
        drive,
      );
    const [a, b] = [run(), run()];
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    const got = takes(a.log);
    expect([got.some(([kind]) => kind === "orb"), got.some(([kind]) => kind === "rune"), a.log.some(({ e }) => e.type === "hit")]).toEqual([true, true, true]);
  });
});
