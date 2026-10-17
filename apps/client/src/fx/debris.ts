import { DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3, type ShaderMaterial } from "three";
import type { AABB } from "@doodlemagic/sim";
import { createInkMaterial } from "../render/gbuffer";
import { INK } from "../render/palette";

export const MAX_DEBRIS = 64;
const GRAVITY = 14;

interface Chunk {
  p: Vector3;
  v: Vector3;
  axis: Vector3;
  angle: number;
  spin: number;
  size: number;
  age: number;
  life: number;
  floorY: number;
}

export interface DebrisField {
  /** Обломки в G-буфер: икосаэдры чернилами terrain, один draw call. */
  readonly mesh: InstancedMesh<IcosahedronGeometry, ShaderMaterial>;
  /** Рассыпать n обломков из бокса рельефа (сломан). Пол — основание бокса. */
  burst(box: AABB, n: number, rng: () => number): void;
  /** Баллистика на процессоре: падают, отскакивают от пола, гаснут уменьшением. */
  step(dtS: number): void;
  dispose(): void;
}

export function createDebris(): DebrisField {
  const mesh = new InstancedMesh(new IcosahedronGeometry(1, 0), createInkMaterial(INK.terrain), MAX_DEBRIS);
  mesh.name = "debris";
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  const chunks: Chunk[] = [];
  let oldest = 0;
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  return {
    mesh,
    burst(box, n, rng) {
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      for (let i = 0; i < n; i++) {
        const p = new Vector3(
          box.min.x + (box.max.x - box.min.x) * rng(),
          box.min.y + (box.max.y - box.min.y) * rng(),
          box.min.z + (box.max.z - box.min.z) * rng(),
        );
        const out = new Vector3(p.x - cx, 0, p.z - cz).normalize().multiplyScalar(1 + rng() * 3);
        const c: Chunk = {
          p,
          v: new Vector3(out.x + (rng() - 0.5) * 2, 2 + rng() * 4, out.z + (rng() - 0.5) * 2),
          axis: new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
          angle: rng() * 6.28,
          spin: 4 + rng() * 8,
          size: 0.1 + rng() * 0.16,
          age: 0,
          life: 1.4 + rng() * 1.2,
          floorY: box.min.y,
        };
        if (chunks.length < MAX_DEBRIS) chunks.push(c);
        else {
          chunks[oldest] = c;
          oldest = (oldest + 1) % MAX_DEBRIS;
        }
      }
    },
    step(dtS) {
      const dt = Math.min(0.05, Math.max(0, dtS));
      for (let i = chunks.length - 1; i >= 0; i--) {
        const c = chunks[i]!;
        c.age += dt;
        if (c.age >= c.life) {
          chunks.splice(i, 1);
          if (oldest > i) oldest--;
          continue;
        }
        c.v.y -= GRAVITY * dt;
        c.p.addScaledVector(c.v, dt);
        c.angle += c.spin * dt;
        if (c.p.y - c.size * 0.8 < c.floorY) {
          c.p.y = c.floorY + c.size * 0.8;
          c.v.y = Math.abs(c.v.y) * 0.3;
          c.v.x *= 0.6;
          c.v.z *= 0.6;
          c.spin *= 0.6;
        }
      }
      if (oldest >= chunks.length) oldest = 0;
      chunks.forEach((c, i) => {
        const shrink = 1 - Math.min(1, Math.max(0, (c.age - (c.life - 0.5)) / 0.5));
        q.setFromAxisAngle(c.axis, c.angle);
        mesh.setMatrixAt(i, m.compose(c.p, q, s.setScalar(c.size * shrink)));
      });
      mesh.count = chunks.length;
      mesh.visible = chunks.length > 0;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    },
  };
}
