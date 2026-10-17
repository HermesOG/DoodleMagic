import { DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3, type ShaderMaterial } from "three";
import type { Projectile, Vec3 } from "@doodlemagic/sim";
import { createInkMaterial } from "../render/gbuffer";
import { INK } from "../render/palette";
import { FX_COLOR } from "./presets";

type ProjectileKind = Projectile["ability"];

/**
 * Вид снаряда: ядро в G-буфер (огонь — сфера чернилами magic, камень — икосаэдр terrain), ореол и свет —
 * в проходе света. Свет на мир — только у огня: Земля не светится (round1/05).
 */
export const PROJECTILE_LOOK: Readonly<
  Record<ProjectileKind, { core: number; halo: number; color: readonly [number, number, number]; light: number; intensity: number; whiteCore: number; trailEveryM: number }>
> = {
  fireFists: { core: 0.12, halo: 0.5, color: FX_COLOR.fire, light: 1.8, intensity: 1.1, whiteCore: 0.8, trailEveryM: 0.35 },
  fireball: { core: 0.35, halo: 1.4, color: FX_COLOR.fire, light: 5, intensity: 1.15, whiteCore: 1, trailEveryM: 0.1 },
  stoneShot: { core: 0.25, halo: 0.4, color: FX_COLOR.jade, light: 0, intensity: 0.5, whiteCore: 0, trailEveryM: 0.14 },
};

export interface ProjectileDraw {
  id: number;
  ability: ProjectileKind;
  /** Видимое положение (уже со смещением из ладони). */
  pos: Vec3;
  ageS: number;
  /** Доля размера: у ладони и вплотную к камере ядро меньше, чтобы не заслоняло кадр. */
  scale: number;
}

export interface ProjectileMeshes {
  /** Огненные ядра: сферы чернилами magic. */
  readonly fire: InstancedMesh<SphereGeometry, ShaderMaterial>;
  /** Камни: икосаэдры чернилами terrain, кувыркаются. */
  readonly stone: InstancedMesh<IcosahedronGeometry, ShaderMaterial>;
  update(list: readonly ProjectileDraw[]): void;
  dispose(): void;
}

export function createProjectileMeshes(max = 48): ProjectileMeshes {
  const fire = new InstancedMesh(new SphereGeometry(1, 14, 10), createInkMaterial(INK.magic), max);
  const stone = new InstancedMesh(new IcosahedronGeometry(1, 0), createInkMaterial(INK.terrain), max);
  fire.name = "projectile-fire";
  stone.name = "projectile-stone";
  for (const m of [fire, stone]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.visible = false;
  }
  const mat = new Matrix4();
  const q = new Quaternion();
  const axis = new Vector3();
  const p = new Vector3();
  const s = new Vector3();
  return {
    fire,
    stone,
    update(list) {
      let nf = 0;
      let ns = 0;
      for (const d of list) {
        const look = PROJECTILE_LOOK[d.ability];
        p.set(d.pos.x, d.pos.y, d.pos.z);
        if (d.ability === "stoneShot") {
          if (ns >= max) continue;
          // кувырок: ось и скорость — по id
          const h = Math.sin(d.id * 12.9898) * 43758.5453;
          axis.set(Math.sin(h), Math.cos(h * 1.3), Math.sin(h * 0.7)).normalize();
          q.setFromAxisAngle(axis, d.ageS * (7 + (Math.abs(h) % 5)));
          s.setScalar(look.core * d.scale);
          stone.setMatrixAt(ns++, mat.compose(p, q, s));
        } else {
          if (nf >= max) continue;
          // огненное ядро чуть дышит
          const r = look.core * d.scale * (1 + 0.08 * Math.sin(d.ageS * 40 + d.id));
          fire.setMatrixAt(nf++, mat.compose(p, q.identity(), s.setScalar(r)));
        }
      }
      fire.count = nf;
      stone.count = ns;
      fire.visible = nf > 0;
      stone.visible = ns > 0;
      fire.instanceMatrix.needsUpdate = true;
      stone.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const m of [fire, stone]) {
        m.geometry.dispose();
        m.material.dispose();
        m.dispose();
      }
    },
  };
}
