import { Scene } from "three";
import { buildGallery } from "@doodlemagic/arena";
import { EYE_HEIGHT, TICK_DT, createWorld, lerpVec, stepPlayer, type PlayerState } from "@doodlemagic/sim";
import "../render/canvas.css";
import "./sandbox.css";
import { buildArenaMeshes } from "../render/arenaMeshes";
import { createFpsMeter } from "../render/fpsMeter";
import { createAutoQuality, type AutoQuality } from "../render/quality";
import { StyleRenderer } from "../render/styleRenderer";
import { KEYS, applyLook, buildInput, type Look } from "./controls";
import { advanceClock } from "./fixedStep";
import { createHud } from "./hud";
import { createInput } from "./input";
import { nextSpawnIndex, shouldRespawn, spawnPlayer } from "./respawn";
import { loadSettings, saveSettings } from "./settings";

/** Песочница: арена, FPS-контроллер на sim с тиком 60 Гц, рендер «Тушь и свет». */
export function mountSandbox(root: HTMLElement): void {
  document.body.classList.add("game");
  const settings = loadSettings();
  const hud = createHud(root, settings);
  const input = createInput(hud.canvas);
  const fail = (err: unknown): void => {
    hud.setLoading(true, `Не удалось запустить игру: ${err instanceof Error ? err.message : String(err)}`);
    console.error(err);
  };

  const variant = new URLSearchParams(location.search).get("arena") === "compact" ? "compact" : "full";
  const arena = buildGallery(variant);
  const world = createWorld(arena.colliders, arena.volumes);
  let renderer: StyleRenderer;
  try {
    renderer = new StyleRenderer(hud.canvas, settings.quality === "auto" ? "high" : settings.quality);
  } catch (err) {
    fail(err);
    return;
  }
  const scene = new Scene();
  scene.add(buildArenaMeshes(arena.render));

  let spawnIndex = 0;
  let cur: PlayerState = spawnPlayer(arena, spawnIndex);
  let prev = cur;
  let look: Look = { yaw: cur.yaw, pitch: 0 };
  let acc = 0;
  let auto: AutoQuality | null = settings.quality === "auto" ? createAutoQuality("high") : null;
  const meter = createFpsMeter();

  window.addEventListener("resize", () => renderer.resize());
  input.onLockChange((locked) => hud.setLocked(locked));
  input.onPress(KEYS.debug, () => hud.toggleDebug());
  hud.onPlay(() => input.requestLock());
  hud.onQuality((q) => {
    settings.quality = q;
    saveSettings(settings);
    auto = q === "auto" ? createAutoQuality(renderer.preset.id) : null;
    if (q !== "auto") renderer.setPreset(q);
  });
  hud.onSensitivity((x) => {
    settings.sensitivity = x;
    saveSettings(settings);
  });

  let last = 0;
  const frame = (now: number): void => {
    // метка rAF бывает чуть раньше performance.now(), снятого после прогрева: шаг не должен быть отрицательным
    const rawMs = Math.max(0, now - last);
    last = now;

    const mouse = input.takeMouse();
    look = applyLook(look, mouse.dx, mouse.dy, settings.sensitivity);
    const keys = input.locked ? input.down : new Set<string>();

    // после зависания advanceClock не догоняет: больше 5 тиков за кадр не делает
    const clock = advanceClock(acc, rawMs / 1000, TICK_DT);
    acc = clock.acc;
    for (let k = 0; k < clock.ticks; k++) {
      prev = cur;
      cur = stepPlayer(cur, buildInput(keys, look), TICK_DT, world);
      if (shouldRespawn(world, cur, arena)) {
        spawnIndex = nextSpawnIndex(spawnIndex, arena.spawns.length);
        cur = spawnPlayer(arena, spawnIndex);
        prev = cur;
        look = { yaw: cur.yaw, pitch: 0 };
      }
    }

    // камера — между двумя последними тиками, взгляд — сразу по мыши
    const p = lerpVec(prev.body.pos, cur.body.pos, clock.alpha);
    const cam = renderer.camera;
    cam.position.set(p.x, p.y + EYE_HEIGHT, p.z);
    cam.rotation.set(look.pitch, look.yaw, 0, "YXZ");
    cam.updateMatrixWorld();

    renderer.render(scene);

    // сырое время кадра — в счётчик и автовыбор (длинные заминки он отбрасывает сам)
    meter.push(rawMs);
    const next = auto?.push(rawMs);
    if (next) renderer.setPreset(next);
    if (hud.debugVisible) {
      const mode = auto ? (auto.done ? " (авто)" : " (подбор)") : "";
      hud.setDebugText(
        `FPS ${meter.fps.toFixed(0)} · ${meter.frameMs.toFixed(1)} мс\n${renderer.preset.label}${mode} · вызовов ${renderer.drawCalls()}\n` +
          `x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} z ${p.z.toFixed(1)}`,
      );
    }
    requestAnimationFrame(frame);
  };

  // прогрев шейдеров до первого взаимодействия: пока он идёт, на экране «Загрузка…»
  hud.setLocked(false);
  renderer
    .warmUp(scene)
    .then(() => {
      hud.setLoading(false);
      last = performance.now();
      requestAnimationFrame(frame);
    })
    .catch(fail);
}
