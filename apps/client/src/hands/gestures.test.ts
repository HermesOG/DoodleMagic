import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";
import { ABILITY_IDS } from "@doodlemagic/sim";
import { createGestures, startGesture, stepGestures } from "./gestures";
import { createMittens } from "./mittens";

describe("hand gestures", () => {
  it("punch with alternating hands, bring palms together for the fireball, and return to rest after every gesture", () => {
    let r = stepGestures(startGesture(createGestures(), "fireFists"), 0.05);
    expect([r.hand, r.pose.right.z < -0.08, r.pose.left.z]).toEqual(["right", true, 0]);
    r = stepGestures(startGesture(r.state, "fireFists"), 0.05);
    expect([r.hand, r.pose.left.z < -0.08]).toEqual(["left", true]);
    const fb = stepGestures(startGesture(createGestures(), "fireball"), 0.25).pose;
    expect([fb.right.x < -0.1, fb.left.x > 0.1]).toEqual([true, true]);
    for (const a of ABILITY_IDS) {
      const done = stepGestures(startGesture(createGestures(), a), 1.5);
      expect([...Object.values(done.pose.right), ...Object.values(done.pose.left)].every((v) => Math.abs(v) < 1e-6)).toBe(true);
      expect(done.state.active).toHaveLength(0);
    }
  });

  // ладони нужны частицам у рук каждый кадр: те же векторы, сдвинутые жестом, а без жеста — снова поза покоя
  it("moves the punching mitten forward and reports both palms in hands-camera space without allocating", () => {
    const m = createMittens();
    const still = { x: 0, y: 0, roll: 0, swing: 0 };
    m.update(still, new Matrix4());
    const palms = m.palms();
    const rest = { right: palms.right.clone(), left: palms.left.clone() };
    expect([rest.right.x > 0.1, rest.left.x < -0.1, rest.right.z < -0.4, rest.left.z < -0.4]).toEqual([true, true, true, true]);
    m.update(still, new Matrix4(), stepGestures(startGesture(createGestures(), "fireFists"), 0.05).pose);
    const punched = m.palms();
    expect([punched.right === palms.right, punched.left === palms.left]).toEqual([true, true]);
    expect([punched.right.z < rest.right.z - 0.09, punched.left.distanceTo(rest.left) < 1e-9]).toEqual([true, true]);
    m.update(still, new Matrix4());
    expect(m.palms().right.distanceTo(rest.right)).toBeLessThan(1e-9);
    m.dispose();
  });
});
