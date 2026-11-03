import type { Object3D, PerspectiveCamera } from "three";
import type { MatchState, Unit, UnitId, Vec3 } from "@doodlemagic/sim";
import type { Effect } from "../feel/effects";
import type { PresetId } from "../render/quality";
import { createAirVfx } from "./airVfx";
import type { DecalSpec } from "./decals";
import type { FxGBuffer, TimeUniform } from "./fxShader";
import type { Glow } from "./glows";
import type { MagePose } from "./mageMeshes";
import type { ParticleSpec } from "./particleKit";
import { createWaterVfx } from "./waterVfx";

/** Что видит эффектник стихии за кадр: состояние, камера и общие пулы (частицы, свет, декали) эффектника. */
export interface ElementVfxFrame {
  prev: MatchState;
  cur: MatchState;
  alpha: number;
  /** Дробный тик между prev и cur. */
  tick: number;
  nowS: number;
  dt: number;
  camera: PerspectiveCamera;
  eye: Vec3;
  localId: UnitId;
  /** Живые, между тиками. */
  units: readonly { id: UnitId; pos: Vec3; u: Unit }[];
  /** Чужие маги, как их нарисовала фигура. */
  mages: readonly { id: UnitId; pose: MagePose; u: Unit }[];
  /** Ладонь своего мага в мире. */
  palmWorld(h: "left" | "right" | "both"): Vec3;
  emit(specs: readonly ParticleSpec[]): void;
  glow(g: Glow, prio: number): void;
  decal(spec: DecalSpec, seed: number, intensity?: number): void;
}

/** Эффекты одной стихии: свои меши и покадровая логика поверх общих пулов. */
export interface ElementVfx {
  /** G-буфер, в worldGroup. */
  readonly world: Object3D | null;
  /** Проход света, в fx.world. */
  readonly light: Object3D | null;
  apply?(e: Effect, nowS: number): void;
  sync(f: ElementVfxFrame): void;
  setPreset?(p: PresetId): void;
  dispose(): void;
}
export type ElementVfxFactory = (c: { gbuffer: FxGBuffer; time: TimeUniform }) => ElementVfx;

/** Эффектники стихий фазы 4: Воздух, Вода. */
export const ELEMENT_VFX: readonly ElementVfxFactory[] = [createAirVfx, createWaterVfx];
