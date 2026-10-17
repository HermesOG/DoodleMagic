import { Scene } from "three";
import { buildGallery } from "@doodlemagic/arena";
import { DEFAULT_MOVE, EYE_HEIGHT, TICK_DT, createWorld, lerpVec, stepPlayer, type PlayerState } from "@doodlemagic/sim";
import "../render/canvas.css";
import "./sandbox.css";
import { createMittens } from "../hands/mittens";
import { createHandRig, updateHandRig } from "../hands/motion";
import { buildArenaMeshes } from "../render/arenaMeshes";
import { FPS_METER_MAX_FRAME_MS, createFpsMeter } from "../render/fpsMeter";
import { createAutoQuality, type AutoQuality } from "../render/quality";
import { StyleRenderer } from "../render/styleRenderer";
import { KEYS, applyLook, buildInput, lookRate, type Look } from "./controls";
import { advanceClock } from "./fixedStep";
import { CONTEXT_LOST_MESSAGE, createHud } from "./hud";
import { createInput } from "./input";
import { nextSpawnIndex, respawnPlayer, shouldRespawn, spawnPlayer } from "./respawn";
import { loadSettings, saveSettings } from "./settings";

/** Песочница: арена, FPS-контроллер на sim с тиком 60 Гц, рендер «Тушь и свет», руки-«варежки». */
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
  const mittens = createMittens();
  let handRig = createHandRig();

  let spawnIndex = 0;
  let cur: PlayerState = spawnPlayer(arena, spawnIndex);
  let prev = cur;
  let look: Look = { yaw: cur.yaw, pitch: 0 };
  let acc = 0;
  let auto: AutoQuality | null = settings.quality === "auto" ? createAutoQuality("high") : null;
  const meter = createFpsMeter();

  // холст и буфер кадра — по ResizeObserver на холсте: размер окна без события resize тоже ловится
  renderer.watchSize();
  // видеокарта сбросила контекст (драйвер, сон ноутбука): preventDefault разрешает восстановление, мышь отпускаем
  hud.canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    if (document.pointerLockElement) document.exitPointerLock();
    hud.setLoading(true, CONTEXT_LOST_MESSAGE);
  });
  hud.canvas.addEventListener("webglcontextrestored", () => hud.setLoading(false));
  input.onLockChange((locked) => hud.setLocked(locked));
  input.onLockError(() => hud.showLockRefused());
  input.onPress(KEYS.debug, () => hud.toggleDebug());
  hud.onPlay(() => input.requestLock(settings.rawMouse));
  hud.onQuality((q) => {
    settings.quality = q;
    saveSettings(settings);
    if (q === "auto") {
      // подбор умеет только спускаться: после ручного пресета начинаем снова с высокого
      renderer.setPreset("high");
      auto = createAutoQuality("high");
    } else {
      auto = null;
      renderer.setPreset(q);
    }
  });
  hud.onRawMouse((raw) => {
    settings.rawMouse = raw;
    saveSettings(settings);
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
    const lookBefore = look;
    look = applyLook(look, mouse.dx, mouse.dy, settings.sensitivity, rawMs);
    // рукам — скорость поворота, который взгляд действительно получил (с множителем, без выброшенных скачков);
    // сброс взгляда при респауне ниже сюда не попадает
    const turn = lookRate(lookBefore, look, rawMs / 1000);
    const keys = input.locked ? input.down : new Set<string>();

    // после зависания advanceClock не догоняет: больше 5 тиков за кадр не делает
    const clock = advanceClock(acc, rawMs / 1000, TICK_DT);
    acc = clock.acc;
    /** Самое сильное приземление за тики кадра и номер его тика. */
    let landVel = 0;
    let landTick = 0;
    let respawned = false;
    for (let k = 0; k < clock.ticks; k++) {
      prev = cur;
      cur = stepPlayer(cur, buildInput(keys, look), TICK_DT, world);
      if (cur.landVel < landVel) {
        landVel = cur.landVel;
        landTick = k;
      }
      if (shouldRespawn(world, cur, arena)) {
        spawnIndex = nextSpawnIndex(spawnIndex, arena.spawns.length);
        // зажатый с прыжка пробел не должен подбросить мага сразу после появления
        cur = respawnPlayer(arena, spawnIndex, cur);
        prev = cur;
        look = { yaw: cur.yaw, pitch: 0 };
        landVel = 0;
        respawned = true;
      }
    }
    // руки после респауна — в покое, а не с отставанием и креном от падения
    if (respawned) handRig = createHandRig();

    // камера — между двумя последними тиками, взгляд — сразу по мыши
    const p = lerpVec(prev.body.pos, cur.body.pos, clock.alpha);
    const cam = renderer.camera;
    cam.position.set(p.x, p.y + EYE_HEIGHT, p.z);
    cam.rotation.set(look.pitch, look.yaw, 0, "YXZ");
    cam.updateMatrixWorld();

    // руки: приземление ниже LAND_MIN_SPEED (в том числе −0,17 м/с на первом тике после появления) они не замечают;
    // шаг по времени motion сам обрезает и чинит, поэтому сюда идёт сырое время кадра.
    // Возраст приземления — от момента, который камера показывает сейчас (она на тик позади: между prev и cur),
    // до тика приземления; если камера до него ещё не дошла — толчок в конце кадра
    const landAge = Math.max(0, (clock.ticks - 2 - landTick) * TICK_DT + clock.acc);
    const hands = updateHandRig(
      handRig,
      {
        dt: rawMs / 1000,
        speed: Math.hypot(cur.body.vel.x, cur.body.vel.z),
        onGround: cur.onGround,
        landVel,
        landAge,
        yawRate: turn.yaw,
        pitchRate: turn.pitch,
      },
      DEFAULT_MOVE.runSpeed,
    );
    handRig = hands.rig;
    mittens.update(hands.pose, cam.matrixWorldInverse);

    renderer.render(scene, mittens.scene);

    // в счётчик — не длиннее 250 мс (иначе после фоновой вкладки «FPS 0 · 13732 мс»); в автовыбор — сырое
    // время кадра, длинные заминки он отбрасывает сам
    meter.push(Math.min(rawMs, FPS_METER_MAX_FRAME_MS));
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
    .warmUp(scene, mittens.scene)
    .then(() => {
      hud.setLoading(false);
      last = performance.now();
      requestAnimationFrame(frame);
    })
    .catch(fail);
}
