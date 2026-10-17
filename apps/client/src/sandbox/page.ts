import { Scene, type Object3D } from "three";
import { TRAINING, buildGallery } from "@doodlemagic/arena";
import {
  ELEMENT_INFO,
  EYE_HEIGHT,
  TICK_DT,
  buildTickWorld,
  createMatch,
  lerpVec,
  lineOfSight,
  matchContext,
  respawnMage,
  stepMatch,
  unitById,
  type Element,
  type MatchState,
  type Vec3,
} from "@doodlemagic/sim";
import "../render/canvas.css";
import "./sandbox.css";
import { createAudio, unlockOnGesture } from "../audio/synth";
import { addFeel, createCameraFeel, stepCameraFeel, type CameraOffset } from "../feel/camera";
import type { Effect } from "../feel/effects";
import { effectsFor } from "../feel/eventMap";
import { createVfx } from "../fx/vfx";
import { createGestures, startGesture, stepGestures } from "../hands/gestures";
import { createMittens } from "../hands/mittens";
import { createHandRig, updateHandRig } from "../hands/motion";
import { createCombatHud } from "../hud/combatHud";
import { showElementSelect } from "../hud/elementSelect";
import { loadPrefs, savePrefs } from "../hud/prefs";
import { buildArenaMeshes } from "../render/arenaMeshes";
import { FPS_METER_MAX_FRAME_MS, createFpsMeter } from "../render/fpsMeter";
import { createAutoQuality, type AutoQuality, type PresetId } from "../render/quality";
import { StyleRenderer, WORLD_FOV } from "../render/styleRenderer";
import { KEYS, applyLook, buildMatchInput, lookRate, type Look } from "./controls";
import { advanceClock } from "./fixedStep";
import { CONTEXT_LOST_MESSAGE, createHud } from "./hud";
import { createInput } from "./input";
import { createGuard, sinkOf } from "./route";
import { loadSettings, saveSettings } from "./settings";

/** Маг игрока в матче полигона: createMatch даёт магам id с 1, манекены идут следом. */
const LOCAL = 1;
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_EFFECTS: readonly Effect[] = [];
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const STILL: CameraOffset = { x: 0, y: 0, pitch: 0, yaw: 0, roll: 0, fovDeg: 0 };
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Сделать видимыми все скрытые объекты под корнями (пустые пулы эффектов) — на время прогрева. Возвращает откат. */
function revealForWarmUp(roots: readonly Object3D[]): () => void {
  const hidden: Object3D[] = [];
  for (const r of roots) {
    r.traverse((o) => {
      if (o.visible) return;
      o.visible = true;
      hidden.push(o);
    });
  }
  return () => {
    for (const o of hidden) o.visible = false;
  };
}

/**
 * Полигон на «/»: «Галерея над ущельем», маг игрока (Огонь или Земля) и шесть манекенов (TRAINING), stepMatch с тиком
 * 60 Гц, рендер «Тушь и свет» с проходом света магии, руки-«варежки» с жестами, боевой HUD, синтез звука.
 * Кадр: ввод → тики матча → события → эффекты (руки, магия, звук, камера, hitstop, HUD) → камера → руки → магия →
 * HUD → слушатель звука → рендер. Сбой эффектов, звука, HUD или рук кадр не останавливает (createGuard);
 * сбой симуляции или рендера показывает сообщение поверх всего.
 */
export function mountSandbox(root: HTMLElement): void {
  document.body.classList.add("game");
  const settings = loadSettings();
  const prefs = loadPrefs();
  const hud = createHud(root, settings, prefs);
  const input = createInput(hud.canvas);
  const guard = createGuard();
  const fail = (err: unknown): void => {
    hud.setLoading(true, `Не удалось запустить игру: ${message(err)}`);
    console.error(err);
  };

  const variant = new URLSearchParams(location.search).get("arena") === "compact" ? "compact" : "full";
  const arena = buildGallery(variant);
  const ctx = matchContext(arena);
  let renderer: StyleRenderer;
  try {
    renderer = new StyleRenderer(hud.canvas, settings.quality === "auto" ? "high" : settings.quality);
  } catch (err) {
    fail(err);
    return;
  }
  const vfx = createVfx(renderer.gbuffer, renderer.preset.id);
  const scene = new Scene();
  scene.add(buildArenaMeshes(arena.render), vfx.worldGroup);
  const mittens = createMittens();
  const combat = createCombatHud(root);
  // звук: контекст создаёт первый жест (клик «Играть», выбор стихии, любая клавиша); без Web Audio — тишина, не сбой
  const audio = createAudio();
  unlockOnGesture(audio);
  if (import.meta.env.DEV) {
    // dmAudio.play("fireballBoom", 5) в консоли — только в dev-сборке
    void import("../audio/audition").then((m) => m.installAudioConsole(audio)).catch(() => undefined);
  }

  let cur: MatchState = createMatch({ mages: [{ element: prefs.element, spawn: TRAINING.spawn }], dummies: [...TRAINING.dummies] });
  let prev = cur;
  let look: Look = { yaw: TRAINING.spawn.yaw, pitch: 0 };
  let acc = 0;
  let feel = createCameraFeel();
  let gestures = createGestures();
  let fistHand: "left" | "right" = "right";
  let hitstopUntil = 0;
  let handRig = createHandRig();
  let auto: AutoQuality | null = settings.quality === "auto" ? createAutoQuality("high") : null;
  const meter = createFpsMeter();
  let selecting = false;
  let stopped = false;
  let raf = 0;

  const setPreset = (p: PresetId): void => {
    renderer.setPreset(p);
    guard.run(
      "vfx",
      () => {
        vfx.setPreset(p);
        // FX_CHEAP стены огня — другая программа: собираем её сейчас (параллельно, если драйвер умеет), а не на
        // первой стене после смены. compile обходит сцену сразу, поэтому скрытое можно вернуть до конца сборки
        const restore = revealForWarmUp([vfx.fx.world]);
        try {
          void renderer.gl.compileAsync(vfx.fx.world, renderer.camera).catch(() => undefined);
        } finally {
          restore();
        }
      },
      undefined,
    );
  };

  /** Эффект — своему исполнителю; исключение исполнителя ловит guard, остальные эффекты кадра идут. */
  const route = (e: Effect, nowS: number): void => {
    const sink = sinkOf(e.kind);
    guard.run(
      sink,
      () => {
        if (e.kind === "gesture") {
          // gesture идёт раньше palm: palm с hand "auto" вспыхнет на руке этого удара
          if (e.ability === "fireFists") fistHand = gestures.nextFist;
          gestures = startGesture(gestures, e.ability);
        } else if (sink === "vfx") vfx.apply(e, nowS, fistHand);
        else if (e.kind === "sound") audio.play(e.id, e.pos, e.gain);
        else if (sink === "camera") feel = addFeel(feel, e);
        else if (e.kind === "hitstop") hitstopUntil = Math.max(hitstopUntil, nowS + e.ms / 1000);
        else combat.apply(e, nowS);
      },
      undefined,
    );
  };

  /** Маг заново на точке полигона выбранной стихией; счёт сохраняется, его снаряды, зоны и рельеф убраны. */
  const chooseElement = (e: Element): void => {
    prefs.element = e;
    savePrefs(prefs);
    cur = respawnMage(cur, LOCAL, e);
    prev = cur;
    const spawn = unitById(cur, LOCAL)?.mage?.spawn ?? TRAINING.spawn;
    look = { yaw: spawn.yaw, pitch: 0 };
    gestures = createGestures();
    handRig = createHandRig();
    feel = createCameraFeel();
    hitstopUntil = 0;
    hud.setElement(e);
    route({ kind: "burst", preset: "respawnPuff", pos: { ...spawn.pos }, dir: UP, scale: 1 }, performance.now() / 1000);
  };

  /** Клик «Играть» или выбор стихии кликом: жест пользователя даёт право и на звук, и на захват мыши. */
  const play = (): void => {
    audio.unlock();
    input.requestLock(settings.rawMouse);
  };

  /** Экран «Выбери стихию» поверх сцены. Выбор кликом или клавишей — сразу в игру; по таймеру — меню с «Играть». */
  const openElementSelect = (): void => {
    if (selecting || stopped) return;
    selecting = true;
    hud.setSelecting(true);
    const initial = unitById(cur, LOCAL)?.mage?.element ?? prefs.element;
    void showElementSelect(root, initial).then(({ element, byClick }) => {
      selecting = false;
      hud.setSelecting(false);
      guard.run("select", () => chooseElement(element), undefined);
      if (byClick && !stopped) play();
    });
  };

  /** Сбой симуляции или рендера: дальше кадры не идут, мышь отпускаем, сообщение — поверх всего. */
  const fatal = (err: unknown): void => {
    stopped = true;
    cancelAnimationFrame(raf);
    console.error(err);
    if (document.pointerLockElement) document.exitPointerLock();
    hud.setLoading(true, `Игра остановилась из-за ошибки: ${message(err)}. Перезагрузите страницу.`);
  };

  // холст и буфер кадра — по ResizeObserver на холсте: размер окна без события resize тоже ловится
  renderer.watchSize();
  // видеокарта сбросила контекст (драйвер, сон ноутбука): preventDefault разрешает восстановление, мышь отпускаем
  hud.canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    if (document.pointerLockElement) document.exitPointerLock();
    hud.setLoading(true, CONTEXT_LOST_MESSAGE);
  });
  hud.canvas.addEventListener("webglcontextrestored", () => {
    if (!stopped) hud.setLoading(false);
  });
  input.onLockChange((locked) => {
    hud.setLocked(locked);
    combat.setVisible(locked);
  });
  input.onLockError(() => hud.showLockRefused());
  input.onPress(KEYS.debug, () => hud.toggleDebug());
  input.onPress(KEYS.ult, () => {
    if (!input.locked) return;
    const element = unitById(cur, LOCAL)?.mage?.element ?? prefs.element;
    route({ kind: "toast", text: `${ELEMENT_INFO[element].ult} — скоро` }, performance.now() / 1000);
  });
  hud.onPlay(play);
  hud.onChangeElement(openElementSelect);
  hud.onQuality((q) => {
    settings.quality = q;
    saveSettings(settings);
    if (q === "auto") {
      // подбор умеет только спускаться: после ручного пресета начинаем снова с высокого
      setPreset("high");
      auto = createAutoQuality("high");
    } else {
      auto = null;
      setPreset(q);
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
  hud.onCameraMotion((x) => {
    prefs.cameraMotion = x;
    savePrefs(prefs);
  });

  const cam = renderer.camera;
  /** Камера мира в глазах мага: между двумя последними тиками, взгляд — сразу по мыши, плюс тряска и толчки. */
  const placeCamera = (alpha: number, offset: CameraOffset): Vec3 => {
    const me = unitById(cur, LOCAL)!;
    const was = unitById(prev, LOCAL) ?? me;
    const p = lerpVec(was.move.body.pos, me.move.body.pos, alpha);
    cam.position.set(p.x, p.y + EYE_HEIGHT, p.z);
    cam.rotation.set(look.pitch + offset.pitch, look.yaw + offset.yaw, offset.roll, "YXZ");
    cam.translateX(offset.x);
    cam.translateY(offset.y);
    const fov = WORLD_FOV + offset.fovDeg;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    return p;
  };

  let last = 0;
  const step = (now: number): void => {
    // метка rAF бывает чуть раньше performance.now(), снятого после прогрева: шаг не должен быть отрицательным
    const rawMs = Math.max(0, now - last);
    last = now;
    const dtS = rawMs / 1000;
    const nowS = now / 1000;

    const mouse = input.takeMouse();
    const lookBefore = look;
    look = applyLook(look, mouse.dx, mouse.dy, settings.sensitivity, rawMs);
    // рукам — скорость поворота, который взгляд действительно получил; сброс взгляда при возрождении сюда не попадает
    const turn = lookRate(lookBefore, look, dtS);
    const keys = input.locked ? input.down : NO_KEYS;

    // после зависания advanceClock не догоняет: больше 5 тиков за кадр не делает
    const clock = advanceClock(acc, dtS, TICK_DT);
    acc = clock.acc;
    /** Самое сильное приземление за тики кадра и номер его тика. */
    let landVel = 0;
    let landTick = 0;
    let respawned = false;
    for (let k = 0; k < clock.ticks; k++) {
      // исключение симуляции не ловим здесь: кадр падает в fatal
      const r = stepMatch(cur, { [LOCAL]: buildMatchInput(keys, look) }, ctx);
      prev = cur;
      cur = r.state;
      const m = unitById(cur, LOCAL)?.move;
      if (m && m.landVel < landVel) {
        landVel = m.landVel;
        landTick = k;
      }
      for (const ev of r.events) {
        if (ev.type === "respawn" && ev.target === LOCAL) {
          // зажатый с прыжка пробел sim переносит сам; взгляд — на точку полигона, камера не тянется через карту
          look = { yaw: ev.yaw, pitch: 0 };
          prev = cur;
          landVel = 0;
          respawned = true;
        }
        if (ev.type === "fall" && ev.target === LOCAL) route({ kind: "toast", text: "Сорвался!" }, nowS);
        const state = cur;
        for (const e of guard.run("effects", () => effectsFor(ev, { localId: LOCAL, state }), NO_EFFECTS)) route(e, nowS);
      }
    }
    // тики кадра нажатия увидели: отпущенные раньше тика (тап тачпада) теперь гаснут
    if (clock.ticks > 0) input.ticked();
    // руки после возрождения — в покое, а не с отставанием и креном от падения
    if (respawned) handRig = createHandRig();

    const shake = guard.run("camera", () => stepCameraFeel(feel, dtS, prefs.cameraMotion), null);
    if (shake) feel = shake.feel;
    const p = placeCamera(clock.alpha, shake?.offset ?? STILL);

    // визуальный hitstop: руки замирают, симуляция идёт (GDD 2.2)
    const handDt = nowS < hitstopUntil ? 0 : dtS;
    guard.run(
      "hands",
      () => {
        const me = unitById(cur, LOCAL)!;
        // возраст приземления — от момента, который показывает камера (она на тик позади), до тика приземления
        const landAge = Math.max(0, (clock.ticks - 2 - landTick) * TICK_DT + clock.acc);
        const element = me.mage?.element ?? prefs.element;
        const hands = updateHandRig(
          handRig,
          {
            dt: handDt,
            speed: Math.hypot(me.move.body.vel.x, me.move.body.vel.z),
            onGround: me.move.onGround,
            landVel,
            landAge,
            yawRate: turn.yaw,
            pitchRate: turn.pitch,
          },
          ELEMENT_INFO[element].runSpeed,
        );
        handRig = hands.rig;
        const g = stepGestures(gestures, handDt);
        gestures = g.state;
        mittens.update(hands.pose, cam.matrixWorldInverse, g.pose);
      },
      undefined,
    );
    guard.run("vfx", () => vfx.sync({ prev, cur, alpha: clock.alpha, nowS, camera: cam, localId: LOCAL, palms: mittens.palms() }), undefined);
    guard.run(
      "hud",
      () => {
        // полоса HP манекена прячется и за рельефом Земли, и за стеной огня (она закрывает обзор), а не только за аркой
        const sight = buildTickWorld(ctx.world, cur).world;
        combat.update({ cur, prev, alpha: clock.alpha, localId: LOCAL, camera: cam, nowS, visible: (q) => lineOfSight(sight, cam.position, q) });
      },
      undefined,
    );
    guard.run("audio", () => audio.setListener(cam.position, look.yaw), undefined);

    renderer.render(scene, mittens.scene, vfx.fx);

    // в счётчик — не длиннее 250 мс (иначе после фоновой вкладки «FPS 0 · 13732 мс»); в автовыбор — сырое
    // время кадра, длинные заминки он отбрасывает сам
    meter.push(Math.min(rawMs, FPS_METER_MAX_FRAME_MS));
    const next = auto?.push(rawMs);
    if (next) setPreset(next);
    if (hud.debugVisible) {
      const mode = auto ? (auto.done ? " (авто)" : " (подбор)") : "";
      hud.setDebugText(
        `FPS ${meter.fps.toFixed(0)} · ${meter.frameMs.toFixed(1)} мс\n${renderer.preset.label}${mode} · вызовов ${renderer.drawCalls()}\n` +
          `x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} z ${p.z.toFixed(1)} · снарядов ${cur.projectiles.length}`,
      );
    }
  };
  const frame = (now: number): void => {
    if (stopped) return;
    try {
      step(now);
    } catch (err) {
      fatal(err);
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  // прогрев шейдеров до первого взаимодействия, пока на экране «Загрузка…»: кадр с манекенами на местах, а пустые
  // пулы эффектов на время компиляции видимы — иначе первый шар или стена компилировали бы шейдер посреди боя
  hud.setSelecting(true);
  hud.setLocked(false);
  hud.setElement(prefs.element);
  placeCamera(0, STILL);
  vfx.sync({ prev: cur, cur, alpha: 0, nowS: performance.now() / 1000, camera: cam, localId: LOCAL, palms: mittens.palms() });
  const restore = revealForWarmUp([vfx.worldGroup, vfx.fx.world, vfx.fx.palm]);
  renderer
    .warmUp(scene, mittens.scene, vfx.fx)
    .then(() => {
      restore();
      hud.setLoading(false);
      last = performance.now();
      raf = requestAnimationFrame(frame);
      hud.setSelecting(false);
      openElementSelect();
    })
    .catch((err: unknown) => {
      restore();
      fail(err);
    });
}
