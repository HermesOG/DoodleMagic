import { describe, expect, it } from "vitest";
import {
  AUTO_QUALITY,
  PRESETS,
  createAutoQuality,
  isPresetId,
  lineRadiusFor,
  pixelRatioFor,
  type AutoQuality,
  type PresetId,
} from "./quality";

describe("presets", () => {
  it("use render scale 0.67 / 0.85 / 1.0", () => {
    expect([PRESETS.low.renderScale, PRESETS.medium.renderScale, PRESETS.high.renderScale]).toEqual([0.67, 0.85, 1]);
    expect(PRESETS.high.label).toBe("Высокое");
  });

  it("cap the device pixel ratio", () => {
    expect(pixelRatioFor(PRESETS.high, 2)).toBe(1.5);
    expect(pixelRatioFor(PRESETS.low, 2)).toBeCloseTo(0.67, 9);
    expect(pixelRatioFor(PRESETS.medium, 1)).toBeCloseTo(0.85, 9);
    expect(pixelRatioFor(PRESETS.high, Number.NaN)).toBe(1);
  });

  it("recognises preset ids", () => {
    expect(isPresetId("medium")).toBe(true);
    expect(isPresetId("ultra")).toBe(false);
  });

  it("grow the outline radius with the render height: 1 texel at 1080 rows, 2 at 1440, 3 at 2160", () => {
    expect(lineRadiusFor(720)).toBe(1);
    expect(lineRadiusFor(1080)).toBe(1);
    expect(lineRadiusFor(1440)).toBe(2);
    expect(lineRadiusFor(2160)).toBe(3);
  });

  it("keep the outline radius a whole number of texels, at least one", () => {
    for (const rows of [Number.NaN, -10, 0, 1, 100, 480]) expect(lineRadiusFor(rows)).toBe(1);
    for (const rows of [480, 724, 918, 1080, 1200, 1440, 1620, 2160, 2880]) expect(Number.isInteger(lineRadiusFor(rows))).toBe(true);
  });
});

const VSYNC_MS = 1000 / 60;

/** Кадр, который рисуется `renderMs`, на мониторе 60 Гц: показ ждёт ближайшего кадра развёртки, поэтому выходят 16,7 и 33,3 мс. */
function vsync(renderMs: number): () => number {
  let ready = 0;
  let shown = 0;
  return () => {
    ready += renderMs;
    const next = Math.ceil(ready / VSYNC_MS - 1e-9) * VSYNC_MS;
    const dt = next - shown;
    shown = next;
    return dt;
  };
}

const steady = (ms: number) => () => ms;

interface Run {
  preset: PresetId;
  switches: PresetId[];
  /** Время (сумма кадров), когда автовыбор закончился; -1 — не закончился. */
  doneAtMs: number;
}

/** Гоняет автовыбор на «машине», у которой время кадра зависит от пресета. `first` — кадры до неё (заминки старта). */
function simulate(machine: Record<PresetId, () => number>, seconds = 15, first: number[] = [], auto: AutoQuality = createAutoQuality()): Run {
  const switches: PresetId[] = [];
  let t = 0;
  let doneAtMs = -1;
  const step = (dt: number): void => {
    t += dt;
    const next = auto.push(dt);
    if (next) switches.push(next);
    if (auto.done && doneAtMs < 0) doneAtMs = t;
  };
  for (const dt of first) step(dt);
  while (t < seconds * 1000) step(machine[auto.preset]());
  return { preset: auto.preset, switches, doneAtMs };
}

describe("createAutoQuality", () => {
  it("keeps High on a clean 60 FPS run and finishes in about 2 s", () => {
    const r = simulate({ high: steady(VSYNC_MS), medium: steady(12), low: steady(8) });
    expect(r).toMatchObject({ preset: "high", switches: [] });
    expect(r.doneAtMs).toBeGreaterThan(1900);
    expect(r.doneAtMs).toBeLessThan(2200);
  });

  it("steps down at 41 FPS on a 60 Hz display, where frames alternate 16.7 / 33.3 ms", () => {
    const at41 = vsync(1000 / 41);
    const r = simulate({ high: at41, medium: steady(VSYNC_MS), low: steady(10) });
    expect(r).toMatchObject({ preset: "medium", switches: ["medium"] });
  });

  it("steps down until the frame fits", () => {
    expect(simulate({ high: steady(33.3), medium: steady(VSYNC_MS), low: steady(10) }).switches).toEqual(["medium"]);
    expect(simulate({ high: steady(50), medium: steady(33.3), low: steady(25) })).toMatchObject({
      preset: "low",
      switches: ["medium", "low"],
    });
  });

  it.each([2000, 5500])("ignores a %i ms first frame (shader compile) on a fast machine", (hitch) => {
    const r = simulate({ high: steady(VSYNC_MS), medium: steady(12), low: steady(8) }, 15, [hitch]);
    expect(r).toMatchObject({ preset: "high", switches: [] });
    // заминка идёт в прогрев не дольше 250 мс; вердикт — по окну нормальных кадров после неё
    expect(r.doneAtMs - hitch).toBeGreaterThan(1700);
    expect(r.doneAtMs - hitch).toBeLessThan(2200);
  });

  it("ignores occasional spikes: 5 % of frames at 33 ms", () => {
    let k = 0;
    const spiky = () => (++k % 20 === 0 ? 33.3 : VSYNC_MS);
    expect(simulate({ high: spiky, medium: steady(12), low: steady(8) })).toMatchObject({ preset: "high", switches: [] });
  });

  it("does not count slow frames of the warm-up", () => {
    // 25 медленных кадров до конца прогрева — если бы их считали, это 28 % окна и спуск
    const warmUp = Array.from({ length: 25 }, () => 19);
    expect(simulate({ high: steady(16), medium: steady(12), low: steady(8) }, 15, warmUp)).toMatchObject({
      preset: "high",
      switches: [],
    });
  });

  it("restarts the warm-up after each step down", () => {
    let mediumFrames = 0;
    // после смены пресета первые полсекунды медленные (перевыделение буферов), потом кадр укладывается
    const medium = () => (++mediumFrames <= 25 ? 19 : 16);
    expect(simulate({ high: steady(33.3), medium, low: steady(8) })).toMatchObject({ preset: "medium", switches: ["medium"] });
  });

  it("needs at least 20 counted frames for a verdict", () => {
    const auto = createAutoQuality();
    // 5 кадров прогрева, потом 19 засчитанных по 100 мс: по времени окно набрано, а кадров мало
    for (let k = 0; k < 5 + 19; k++) expect(auto.push(100)).toBeNull();
    expect(auto).toMatchObject({ preset: "high", done: false });
    expect(auto.push(100)).toBe("medium");
  });

  it("the time limit makes the next verdict the last one on a very slow machine", () => {
    // 5 FPS: каждое окно ждёт 20 кадров, то есть 4 с; без предела выбор длился бы 13 с
    const r = simulate({ high: steady(200), medium: steady(200), low: steady(200) }, 30);
    expect(r).toMatchObject({ preset: "low", switches: ["medium", "low"] });
    expect(r.doneAtMs).toBeGreaterThan(AUTO_QUALITY.maxMs);
    expect(r.doneAtMs).toBeLessThan(9500);
  });

  it("never finishes without a verdict, whatever the input", () => {
    const auto = createAutoQuality();
    for (const dt of [Number.NaN, -5, 0, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 300, 5000, 9000]) expect(auto.push(dt)).toBeNull();
    expect(auto).toMatchObject({ preset: "high", done: false });
  });

  it("judges a machine that never gets under 250 ms: steps down to Low and finishes", () => {
    const r = simulate({ high: steady(300), medium: steady(300), low: steady(300) }, 60);
    expect(r).toMatchObject({ preset: "low", switches: ["medium", "low"] });
    expect(r.doneAtMs).toBeGreaterThan(0);
  });

  it("after the warm-up counts a stall as one slow frame, not a verdict", () => {
    let k = 0;
    // через секунду после старта одна заминка в 3 с (вкладка в фоне, сборка мусора) среди быстрых кадров
    const stall = () => (++k === 60 ? 3000 : VSYNC_MS);
    expect(simulate({ high: stall, medium: steady(12), low: steady(8) })).toMatchObject({ preset: "high", switches: [] });
  });

  it("only steps down, and done is final", () => {
    const auto = createAutoQuality();
    for (let k = 0; k < 200; k++) auto.push(VSYNC_MS);
    expect(auto).toMatchObject({ preset: "high", done: true });
    for (let k = 0; k < 500; k++) expect(auto.push(60)).toBeNull();
    expect(auto.preset).toBe("high");

    const low = createAutoQuality("low");
    for (let k = 0; k < 200; k++) expect(low.push(100)).toBeNull();
    expect(low).toMatchObject({ preset: "low", done: true });
  });
});
