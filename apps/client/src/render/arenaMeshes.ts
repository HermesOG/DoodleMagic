import { BufferAttribute, BufferGeometry, Group, Mesh } from "three";
import type { RenderBox } from "@doodlemagic/sim";
import { buildBoxArrays, buildSwayArrays, groupByInk } from "./boxMesh";
import { createInkMaterial, worldSun, type SwayKind } from "./gbuffer";
import { INK } from "./palette";

/** Качаются только трава и знамёна (Р8): у остальных чернил прежний путь шейдера. */
const SWAY_OF: ReadonlyMap<number, SwayKind> = new Map([
  [INK.grass, "grass"],
  [INK.clothA, "cloth"],
  [INK.clothB, "cloth"],
]);

/** Статика арены: один меш на чернила — несколько draw call'ов на всю карту. */
export function buildArenaMeshes(render: readonly RenderBox[]): Group {
  const group = new Group();
  group.name = "arena";
  for (const [ink, boxes] of groupByInk(render)) {
    const a = buildBoxArrays(boxes);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(a.positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(a.normals, 3));
    geometry.setIndex(new BufferAttribute(a.indices, 1));
    const sway = SWAY_OF.get(ink);
    if (sway) geometry.setAttribute("aSway", new BufferAttribute(buildSwayArrays(boxes, sway === "cloth"), 3));
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, createInkMaterial(ink, worldSun, sway ? { sway } : {}));
    mesh.name = `arena-ink-${ink}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.matrixAutoUpdate = false;
  return group;
}
