import { BoxGeometry, Mesh, Scene, Vector3, type BufferGeometry, type Material as ThreeMaterial } from "three";
import type { Material, RenderBox } from "@doodlemagic/sim";
import "./canvas.css";
import { buildArenaMeshes } from "./arenaMeshes";
import { FPS_METER_MAX_FRAME_MS, createFpsMeter } from "./fpsMeter";
import { createInkMaterial } from "./gbuffer";
import { INK, SUN_DIR } from "./palette";
import { createAutoQuality, isPresetId } from "./quality";
import { StyleRenderer } from "./styleRenderer";

const b = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: Material = "stone"): RenderBox => ({
  box: { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } },
  material,
});

/** Тестовая сцена: каждый материал, ступени, укрытия двух высот, мост над пустотой. */
export const TEST_BOXES: RenderBox[] = [
  b(-12, -0.5, -12, 12, 0, 3, "floor"),
  // обрыв: пол по краям, посередине мост над пустотой
  b(-12, -0.5, 3, -4, 0, 12, "floor"),
  b(4, -0.5, 3, 12, 0, 12, "floor"),
  b(-5, -12, 3, -4, -0.5, 12),
  b(4, -12, 3, 5, -0.5, 12),
  b(-4, -12, 12, 4, -0.5, 13),
  b(-1.5, -0.6, 3, 1.5, 0, 12),
  // стена с проёмом
  b(-10, 0, -8, -9.6, 3, -2),
  b(-10, 2.3, -2, -9.6, 3, 0),
  b(-10, 0, 0, -9.6, 3, 6),
  // полное укрытие 2,6 м и низкое 1 м
  b(-6, 0, -10, -4.5, 2.6, -8.5),
  b(-3, 0, -6, 3, 1, -5.6),
  // ступени по 0,4 м
  b(4, 0, -10, 6, 0.4, -6),
  b(4, 0, -10, 5.5, 0.8, -6),
  b(4, 0, -10, 5, 1.2, -6),
  b(4, 0, -10, 4.5, 1.6, -6),
  // дом с крышей
  b(7, 0, -4, 11, 3, 0),
  b(7, 3, -4.5, 11.5, 3.3, 0.5, "roof"),
  // площадка руны, кромка обрыва, трава
  b(-2, 0, -2, 2, 0.05, 2, "gold"),
  b(-4, 0, 2.7, -1.5, 0.2, 3, "edge"),
  b(1.5, 0, 2.7, 4, 0.2, 3, "edge"),
  b(-7, 0, 6, -6.4, 0.5, 6.6, "grass"),
  b(-6, 0, 7, -5.4, 0.35, 7.6, "grass"),
  b(-7.5, 0, 8, -6.9, 0.65, 8.6, "grass"),
];

/** Широкий пол за дальним краем тестового, в одной плоскости с ним: для вида ?pitch= — верх кадра на полу в 40–50 м. */
const FAR_FLOOR: RenderBox = b(-100, -0.5, -110, 100, 0, -12, "floor");

/**
 * Проба второго слоя: два светлых кубика в углу кадра, как будущие руки, — в 0,3 и 0,6 м, на экране один
 * заходит на другой. Оба рисуются поверх мира всегда, а между собой дают внутренний контур по глубине.
 */
function overlayProbe(): Scene {
  const scene = new Scene();
  const sun = { value: new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) };
  const material = createInkMaterial(INK.hands, sun);
  const near = new Mesh(new BoxGeometry(0.06, 0.06, 0.06), material);
  near.position.set(0.115, -0.085, -0.3);
  near.rotation.set(0.4, 0.6, 0);
  const far = new Mesh(new BoxGeometry(0.12, 0.12, 0.12), material);
  far.position.set(0.27, -0.18, -0.6);
  far.rotation.set(0.5, -0.4, 0.2);
  scene.add(near, far);
  return scene;
}

/** Освобождает геометрию и материалы сцены (общие — один раз). */
function disposeScene(scene: Scene): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<ThreeMaterial>();
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    geometries.add(o.geometry as BufferGeometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m as ThreeMaterial);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

/**
 * /render-test — проверка рендера без игры. Камера медленно облетает сцену.
 * ?near=1 — камера в 0,4 м от стены: проба второго слоя всё равно видна целиком.
 * ?preset=low|medium|high — пресет без автовыбора.
 * ?pitch=37 — камера на высоте глаз (1,6 м) смотрит вниз на столько градусов вдоль −z на широкий пол:
 * верхний край кадра — на дальнем полу, контура вдоль края быть не должно.
 * Возвращает функцию, которая останавливает страницу и освобождает GPU.
 */
export function mountRenderTest(root: HTMLElement): () => void {
  document.body.classList.add("game");
  root.innerHTML = `<canvas class="game-canvas"></canvas><div class="game-corner"></div><div class="game-loading">Загрузка…</div>`;
  const canvas = root.querySelector<HTMLCanvasElement>(".game-canvas")!;
  const corner = root.querySelector<HTMLElement>(".game-corner")!;
  const loading = root.querySelector<HTMLElement>(".game-loading")!;
  const fail = (err: unknown): void => {
    loading.textContent = `Не удалось запустить рендер: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  };
  const params = new URLSearchParams(location.search);
  const near = params.get("near") === "1";
  const fixed = params.get("preset");
  const pitchDeg = Number.parseFloat(params.get("pitch") ?? "");
  const pitch = Number.isFinite(pitchDeg) ? (pitchDeg * Math.PI) / 180 : null;

  let renderer: StyleRenderer;
  try {
    renderer = new StyleRenderer(canvas, isPresetId(fixed) ? fixed : "high");
  } catch (err) {
    fail(err);
    return () => {};
  }
  const world = new Scene();
  world.add(buildArenaMeshes(pitch === null ? TEST_BOXES : [...TEST_BOXES, FAR_FLOOR]));
  const overlay = overlayProbe();
  const unwatchSize = renderer.watchSize();

  const auto = isPresetId(fixed) ? null : createAutoQuality();
  const meter = createFpsMeter();
  let last = 0;
  let angle = 0.6;
  let raf = 0;
  let stopped = false;

  const frame = (now: number): void => {
    // сырое время кадра — в счётчик и автовыбор (длинные заминки он отбрасывает сам), обрезанное — в анимацию
    const raw = now - last;
    last = now;
    angle += Math.max(0, Math.min(100, raw)) * 0.0001;
    if (near) {
      renderer.camera.position.set(-9.2, 1.6, -5);
      renderer.camera.lookAt(-10, 1.6, -5);
    } else if (pitch !== null) {
      renderer.camera.position.set(0, 1.6, -10);
      renderer.camera.lookAt(0, 1.6 - Math.sin(pitch), -10 - Math.cos(pitch));
    } else {
      renderer.camera.position.set(Math.sin(angle) * 16, 4, Math.cos(angle) * 16);
      renderer.camera.lookAt(0, 0.5, 0);
    }
    renderer.render(world, overlay);
    // в счётчик — не длиннее 250 мс: после фоновой вкладки иначе полсекунды «FPS 0 · 13732 мс»
    meter.push(Math.min(raw, FPS_METER_MAX_FRAME_MS));
    const next = auto?.push(raw);
    if (next) renderer.setPreset(next);
    corner.textContent =
      `FPS ${meter.fps.toFixed(0)} · ${meter.frameMs.toFixed(1)} мс\n` +
      `${renderer.preset.label}${auto && !auto.done ? " (подбор)" : ""} · вызовов ${renderer.drawCalls()}`;
    raf = requestAnimationFrame(frame);
  };

  renderer
    .warmUp(world, overlay)
    .then(() => {
      if (stopped) return;
      loading.remove();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    })
    .catch(fail);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    unwatchSize();
    disposeScene(world);
    disposeScene(overlay);
    renderer.dispose();
  };
}
