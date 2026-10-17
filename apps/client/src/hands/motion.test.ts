import { describe, expect, it } from "vitest";
import { LOOK_LAG_MAX_M, LOOK_ROLL_MAX, createHandRig, updateHandRig, type HandMotionInput, type HandPose } from "./motion";

const still: HandMotionInput = { dt: 1 / 60, speed: 0, onGround: true, landVel: 0, yawRate: 0, pitchRate: 0 };
const DEG = Math.PI / 180;

function play(frames: number, m: (k: number) => HandMotionInput): HandPose[] {
  let rig = createHandRig();
  const poses: HandPose[] = [];
  for (let k = 0; k < frames; k++) {
    const r = updateHandRig(rig, m(k), 6.5);
    rig = r.rig;
    poses.push(r.pose);
  }
  return poses;
}

const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const peak = (xs: number[]) => xs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);

/**
 * Физическое движение во времени: угол взгляда (рад, точный интеграл скорости поворота), скорость бега,
 * приземление. Кадр (t0; t1] получает то, что получил бы от страницы: поворот за кадр / dt (как lookRate),
 * скорость в середине кадра и приземление с его возрастом к концу кадра.
 */
interface Motion {
  T: number;
  yaw(t: number): number;
  pitch(t: number): number;
  speed(t: number): number;
  landAt?: number;
  landVel?: number;
}

interface Sample {
  t: number;
  pose: HandPose;
}

function playMotion(mo: Motion, fps: number): Sample[] {
  let rig = createHandRig();
  const out: Sample[] = [];
  const frames = Math.round(mo.T * fps);
  for (let k = 1; k <= frames; k++) {
    const t0 = (k - 1) / fps;
    const t1 = k / fps;
    const dt = t1 - t0;
    const lands = mo.landAt !== undefined && mo.landAt > t0 && mo.landAt <= t1;
    const r = updateHandRig(
      rig,
      {
        dt,
        speed: mo.speed((t0 + t1) / 2),
        onGround: true,
        landVel: lands ? mo.landVel! : 0,
        landAge: lands ? t1 - mo.landAt! : 0,
        yawRate: (mo.yaw(t1) - mo.yaw(t0)) / dt,
        pitchRate: (mo.pitch(t1) - mo.pitch(t0)) / dt,
      },
      6.5,
    );
    rig = r.rig;
    out.push({ t: t1, pose: r.pose });
  }
  return out;
}

/** Угол от плавного «колокола» скорости: ω = peak · sin²(π(t − t0)/T) на [t0; t0 + T], интеграл точный. */
function bellAngle(t: number, t0: number, T: number, peakRate: number): number {
  const u = Math.min(Math.max(t - t0, 0), T);
  return peakRate * (u / 2 - (T / (4 * Math.PI)) * Math.sin((2 * Math.PI * u) / T));
}

/** Поворот с постоянной скоростью rate на [t0; t1], угол — интеграл. */
function steadyAngle(t: number, t0: number, t1: number, rate: number): number {
  return rate * (Math.min(Math.max(t, t0), t1) - t0);
}

describe("updateHandRig", () => {
  it("only breathes a few millimetres when standing", () => {
    const ys = play(600, () => still).map((p) => p.y);
    expect(range(ys)).toBeGreaterThan(0.004);
    expect(range(ys)).toBeLessThan(0.014);
  });

  it("bobs while running and calms down after stopping", () => {
    const run = play(300, () => ({ ...still, speed: 6.5 }));
    expect(range(run.slice(120).map((p) => p.y))).toBeGreaterThan(0.015);
    expect(Math.max(...run.map((p) => Math.abs(p.swing)))).toBeGreaterThan(0.5);
    const stop = play(600, (k) => ({ ...still, speed: k < 300 ? 6.5 : 0 }));
    expect(range(stop.slice(500).map((p) => p.y))).toBeLessThan(0.014);
  });

  it("does not bob in the air", () => {
    const air = play(300, () => ({ ...still, speed: 6.5, onGround: false }));
    expect(range(air.slice(120).map((p) => p.y))).toBeLessThan(0.014);
  });

  it("dips on landing and lags behind a mouse turn", () => {
    const land = play(30, (k) => ({ ...still, landVel: k === 1 ? -9 : 0 }));
    expect(Math.min(...land.map((p) => p.y))).toBeLessThan(-0.02);
    // поворот вправо (yaw убывает): руки отстают влево и кренятся
    const turn = play(30, () => ({ ...still, yawRate: -165 * DEG }));
    expect(turn.at(-1)!.x).toBeLessThan(-0.005);
    expect(turn.at(-1)!.roll).toBeLessThan(0);
  });

  // сим сообщает приземление и на первом тике после createPlayer (≈ −0,17 м/с): руки при появлении не приседают
  it("ignores the tiny landing the sim reports on the first tick after a spawn", () => {
    const spawn = play(60, (k) => ({ ...still, landVel: k === 0 ? -0.17 : 0 }));
    expect(spawn).toEqual(play(60, () => still));
  });

  it("dips on a small hop and caps the dip of a very long fall", () => {
    const hop = play(30, (k) => ({ ...still, landVel: k === 1 ? -3 : 0 }));
    expect(Math.min(...hop.map((p) => p.y))).toBeLessThan(-0.005);
    const fall = play(60, (k) => ({ ...still, landVel: k === 1 ? -40 : 0 }));
    const capped = play(60, (k) => ({ ...still, landVel: k === 1 ? -12 : 0 }));
    expect(Math.min(...fall.map((p) => p.y))).toBeCloseTo(Math.min(...capped.map((p) => p.y)), 9);
    expect(Math.min(...fall.map((p) => p.y))).toBeGreaterThan(-0.05);
  });

  it("stays finite when the frame time is negative, NaN or very long", () => {
    for (const dt of [-1, Number.NaN, 60]) {
      const poses = play(30, () => ({ ...still, dt, speed: 6.5, yawRate: 40, pitchRate: -40, landVel: -9, landAge: dt }));
      for (const p of poses) {
        for (const v of [p.x, p.y, p.roll, p.swing]) expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(p.y)).toBeLessThan(0.1);
        expect(Math.abs(p.x)).toBeLessThan(0.1);
      }
    }
  });

  it("treats a non-numeric look rate as no turn", () => {
    expect(play(30, () => ({ ...still, yawRate: Number.NaN, pitchRate: Number.POSITIVE_INFINITY }))).toEqual(play(30, () => still));
  });

  // ощущение из рецензии: быстрый поворот 165°/с — около 15 мм отставания и 21 мрад крена, прицеливание 45°/с —
  // около 4 мм, по вертикали — 0,8 от горизонтали; при любой частоте кадров одинаково
  for (const fps of [30, 60, 144]) {
    it(`lags behind a fast turn and an aiming turn by a readable amount at ${fps} Hz`, () => {
      const turn = play(Math.round(0.6 * fps), () => ({ ...still, dt: 1 / fps, yawRate: -165 * DEG }));
      expect(-peak(turn.map((p) => p.x))).toBeGreaterThan(0.014);
      expect(-peak(turn.map((p) => p.x))).toBeLessThan(0.016);
      expect(-peak(turn.map((p) => p.roll))).toBeGreaterThan(0.019);
      expect(-peak(turn.map((p) => p.roll))).toBeLessThan(0.023);

      const aim = play(fps, () => ({ ...still, dt: 1 / fps, yawRate: 45 * DEG }));
      expect(aim.at(-1)!.x).toBeGreaterThan(0.0037);
      expect(aim.at(-1)!.x).toBeLessThan(0.0044);

      // взгляд вверх: руки отстают вниз, на установившемся повороте — 0,8 от бокового отставания;
      // дыхание вычитаем — оно одинаково в обоих прогонах
      const n = Math.round(1.5 * fps);
      const up = play(n, () => ({ ...still, dt: 1 / fps, pitchRate: 165 * DEG }));
      const calm = play(n, () => ({ ...still, dt: 1 / fps }));
      const side = play(n, () => ({ ...still, dt: 1 / fps, yawRate: -165 * DEG }));
      const lift = up.at(-1)!.y - calm.at(-1)!.y;
      expect(lift / (side.at(-1)!.x - calm.at(-1)!.x)).toBeCloseTo(0.8, 2);
    });
  }

  it("clamps the lag and the roll of an impossible turn", () => {
    const wild = play(120, () => ({ ...still, yawRate: 500, pitchRate: -500 }));
    for (const p of wild) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(LOOK_LAG_MAX_M + 1e-12);
      expect(Math.abs(p.roll)).toBeLessThanOrEqual(LOOK_ROLL_MAX + 1e-12);
    }
    expect(Math.abs(wild.at(-1)!.x)).toBeCloseTo(LOOK_LAG_MAX_M, 4);
    expect(Math.abs(wild.at(-1)!.roll)).toBeCloseTo(LOOK_ROLL_MAX, 4);
  });

  it("dips about 3 cm on a jump landing", () => {
    const land = play(60, (k) => ({ ...still, landVel: k === 10 ? -7 : 0 }));
    const calm = play(60, () => still);
    const dip = Math.min(...land.map((p, i) => p.y - calm[i]!.y));
    expect(dip).toBeLessThan(-0.028);
    expect(dip).toBeGreaterThan(-0.034);
  });

  // одна и та же физическая секунда при 30, 60 и 144 Гц: поворот-флик, прицеливание, взгляд вверх и вниз,
  // бег с остановкой и приземление посреди кадра — позы в общие моменты совпадают до миллиметра
  it("plays the same physical motion into the same poses at 30, 60 and 144 Hz", () => {
    const mo: Motion = {
      T: 2,
      yaw: (t) => bellAngle(t, 0.1, 0.3, -300 * DEG) + steadyAngle(t, 0.55, 1.05, 45 * DEG) + bellAngle(t, 1.6, 0.25, 200 * DEG),
      pitch: (t) => bellAngle(t, 1.1, 0.3, 120 * DEG) + bellAngle(t, 1.45, 0.2, -150 * DEG),
      speed: (t) => (t < 1 ? 6.5 : 0),
      landAt: 1.237,
      landVel: -7,
    };
    const runs = new Map([30, 60, 144].map((fps) => [fps, playMotion(mo, fps)]));
    // во всех трёх прогонах есть заметное движение — иначе сравнение ничего бы не доказало
    const r60 = runs.get(60)!;
    expect(Math.max(...r60.map((s) => Math.abs(s.pose.x)))).toBeGreaterThan(0.01);
    expect(Math.max(...r60.map((s) => Math.abs(s.pose.roll)))).toBeGreaterThan(0.015);
    expect(Math.min(...r60.map((s) => s.pose.y))).toBeLessThan(-0.025);

    let worst = { x: 0, y: 0, roll: 0, swing: 0, compared: 0 };
    for (const [a, b] of [[30, 60], [60, 144], [30, 144]] as const) {
      const byTime = new Map(runs.get(b)!.map((s) => [Math.round(s.t * 1e6), s.pose]));
      for (const s of runs.get(a)!) {
        const q = byTime.get(Math.round(s.t * 1e6));
        if (!q) continue;
        worst = {
          x: Math.max(worst.x, Math.abs(s.pose.x - q.x)),
          y: Math.max(worst.y, Math.abs(s.pose.y - q.y)),
          roll: Math.max(worst.roll, Math.abs(s.pose.roll - q.roll)),
          swing: Math.max(worst.swing, Math.abs(s.pose.swing - q.swing)),
          compared: worst.compared + 1,
        };
      }
    }
    expect(worst.compared).toBeGreaterThan(80);
    expect(worst.x).toBeLessThan(0.001);
    expect(worst.y).toBeLessThan(0.001);
    expect(worst.roll).toBeLessThan(0.001);
    expect(worst.swing).toBeLessThan(0.05);
  });
});
