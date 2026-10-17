import { describe, expect, it } from "vitest";
import { QUALITY_WATCHDOG, createQualityWatchdog, type PresetId, type QualityWatchdog } from "./quality";

/** Кадры по кругу из `pattern` (мс), пока не наберётся `totalMs`; каждая смена пресета — с моментом от начала, мс. */
function run(w: QualityWatchdog, pattern: readonly number[], totalMs: number, locked = true, t0 = 0): { at: number; to: PresetId }[] {
  const steps: { at: number; to: PresetId }[] = [];
  let t = t0;
  for (let i = 0; t < t0 + totalMs; i++) {
    const ms = pattern[i % pattern.length]!;
    t += ms;
    const next = w.push(ms, locked);
    if (next) steps.push({ at: t, to: next });
  }
  return steps;
}

// 3 из 10 кадров по 25 мс — ровно 30 %
const THIRTY = [10, 25, 10, 10, 25, 10, 10, 25, 10, 10];
const TWENTY_FIVE = [10, 10, 25, 10];

describe("createQualityWatchdog", () => {
  it("uses 4 s windows, 18 ms, 30 % and at most one step per 8 s", () => {
    expect(QUALITY_WATCHDOG).toMatchObject({ windowMs: 4000, slowFrameMs: 18, slowShare: 0.3, minGapMs: 8000 });
  });

  it("steps down one preset when 30 % of the locked frames in a window are slower than 18 ms", () => {
    const w = createQualityWatchdog("high");
    // 8 с в меню: время до первой смены идёт, кадры не считаются
    expect(run(w, [40], 8000, false)).toEqual([]);
    const steps = run(w, THIRTY, 4500, true, 8000);
    expect(steps.map((s) => s.to)).toEqual(["medium"]);
    expect(steps[0]!.at).toBeGreaterThanOrEqual(12000);
    expect(steps[0]!.at).toBeLessThan(12100);
    expect(w.preset).toBe("medium");
  });

  it("does not step at 25 % slow frames, however long the fight", () => {
    const w = createQualityWatchdog("high");
    expect(run(w, TWENTY_FIVE, 60000)).toEqual([]);
    expect(w.preset).toBe("high");
  });

  it("counts nothing while the pointer is not locked", () => {
    const w = createQualityWatchdog("high");
    expect(run(w, [40], 60000, false)).toEqual([]);
    expect(w.preset).toBe("high");
  });

  it("steps at most once per 8 s and stops at Low", () => {
    const w = createQualityWatchdog("high");
    const steps = run(w, [30], 60000);
    expect(steps.map((s) => s.to)).toEqual(["medium", "low"]);
    expect(steps[0]!.at).toBeGreaterThanOrEqual(QUALITY_WATCHDOG.minGapMs);
    expect(steps[1]!.at - steps[0]!.at).toBeGreaterThanOrEqual(QUALITY_WATCHDOG.minGapMs);
    expect(w.preset).toBe("low");
  });

  it("never steps up, and never moves from Low", () => {
    const w = createQualityWatchdog("low");
    expect(run(w, [40], 60000)).toEqual([]);
    const m = createQualityWatchdog("medium");
    run(m, [30], 20000);
    expect(m.preset).toBe("low");
    expect(run(m, [5], 60000)).toEqual([]);
    expect(m.preset).toBe("low");
  });

  // вкладка из фона, GC, alt-tab: один огромный кадр — не нагрузка и не окно сам по себе
  it("drops hitches longer than 250 ms and timer garbage", () => {
    const w = createQualityWatchdog("high");
    run(w, [10], 9000, false);
    for (const ms of [13000, 400, 300, Number.NaN, 0, -5]) expect(w.push(ms, true)).toBeNull();
    expect(run(w, [10, 10, 10, 10, 300], 20000)).toEqual([]);
    expect(w.preset).toBe("high");
  });

  it("judges each window on its own: a slow window after clean ones still steps", () => {
    const w = createQualityWatchdog("high");
    expect(run(w, [8], 20000)).toEqual([]);
    expect(run(w, [25], 4100, true, 20000).map((s) => s.to)).toEqual(["medium"]);
  });
});
