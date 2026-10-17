import { BufferAttribute, BufferGeometry, Group, Mesh } from "three";
import type { RenderBox } from "@doodlemagic/sim";
import { buildBoxArrays, groupByInk } from "./boxMesh";
import { createInkMaterial } from "./gbuffer";

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
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, createInkMaterial(ink));
    mesh.name = `arena-ink-${ink}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.matrixAutoUpdate = false;
  return group;
}
