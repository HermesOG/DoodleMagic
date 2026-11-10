import { Scene, type Object3D } from "three";
import {
  ELEMENT_INFO,
  EYE_HEIGHT,
  TICK_DT,
  buildTickWorld,
  groundBelow,
  lerpVec,
  lineOfSight,
  unitById,
  type ArenaData,
  type Element,
  type MatchContext,
  type MatchEvent,
  type MatchInput,
  type MatchState,
  type UnitId,
  type Vec3,
} from "@doodlemagic/sim";
import "../render/canvas.css";
import "../sandbox/sandbox.css";
import { createAudio, unlockOnGesture } from "../audio/synth";
import { createMusic } from "../audio/music";
import {
  createMusicDirector, createSeedKeeper, emptySituation, musicCue, readSituation, streakCue, type DirectorInput, type MusicCue,
} from "../audio/musicDirector";
import { createEyeSmooth, createMoveTracker, stepEyeSmooth, trackMovement } from "../feel/body";
import { addFeel, addLanding, createCameraFeel, stepCameraFeel, type CameraOffset } from "../feel/camera";
import type { Effect } from "../feel/effects";
import { elementFrameEffects } from "../feel/elementFx";
import { effectsFor } from "../feel/eventMap";
import { createWhizzFrame } from "../feel/whizz";
import { createVfx } from "../fx/vfx";
import { createGestures, isFistGesture, startGesture, stepGestures } from "../hands/gestures";
import { createMittens } from "../hands/mittens";
import { createHandRig, updateHandRig } from "../hands/motion";
import { createCombatHud, type CombatHud } from "../hud/combatHud";
import { showElementSelect } from "../hud/elementSelect";
import { loadPrefs, savePrefs } from "../hud/prefs";
import { buildArenaMeshes } from "../render/arenaMeshes";
import { FPS_METER_MAX_FRAME_MS, createFpsMeter } from "../render/fpsMeter";
import { createAutoQuality, createQualityWatchdog, type AutoQuality, type PresetId, type QualityWatchdog } from "../render/quality";
import { StyleRenderer, WORLD_FOV } from "../render/styleRenderer";
import { KEYS, applyLook, buildMatchInput, lookRate, type Look } from "../sandbox/controls";
import { FALL_HOLD_Y, createFallCamera, stepFallCamera } from "../sandbox/fallCamera";
import { CONTEXT_LOST_MESSAGE, createHud, type Hud } from "../sandbox/hud";
import { createInput, type InputDevice } from "../sandbox/input";
import { createGuard, sinkOf } from "../sandbox/route";
import { loadSettings, saveSettings } from "../sandbox/settings";
import type { Driver, Frame } from "./driver";
import type { GameState } from "@doodlemagic/sim";

export interface GameViewOptions {
  root: HTMLElement;
  arena: ArenaData;
  ctx: MatchContext;
  driver: Driver;
  /** Стихия на старте: HUD, руки, экран выбора. */
  element: Element;
  /** Экран «Выбери стихию» сразу после загрузки (полигон). */
  selectOnStart: boolean;
  /** Каждый кадр после HUD: интерфейс режима (таймер, килфид…). */
  onFrame?: (f: Frame, nowS: number) => void;
  /** Имена магов (сеть): над полосой HP чужого мага. */
  names?: () => ReadonlyMap<UnitId, string>;
}
export interface GameView {
  readonly hud: Hud;
  readonly input: InputDevice;
  readonly combat: CombatHud;
  route(e: Effect): void;
  /**
   * Выбор стихии, как с экрана выбора (экран смерти PvP): запоминается в настройках вида, уходит драйверу; вернул он
   * точку — взгляд, руки и пыль появления, как у полигона.
   */
  chooseElement(e: Element): void;
  stop(): void;
}

const NO_KEYS: ReadonlySet<string> = new Set();
const NO_EFFECTS: readonly Effect[] = [];
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const STILL: CameraOffset = { x: 0, y: 0, pitch: 0, yaw: 0, roll: 0, fovDeg: 0, lift: 0 };
/** Пол ближе этого под падающим магом — не ущелье (ров на −1 м): камера идёт за ним, как обычно. */
const FALL_PROBE_M = 2;
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
 * Ввод игрока на тик: клавиши и взгляд в момент вызова; без захвата мыши — только взгляд. Прочитав down, сразу
 * ticked(): нажатие, отпущенное раньше, чем его увидел тик (тап тачпада, клавиша короче тика), видит ровно следующий
 * тик. Не по кадру: хост зовёт sample из пульсов таймера между кадрами, и кадр мог бы погасить нажатие, которого ни
 * один тик ещё не видел. buildMatchInput копирует кнопки в простые boolean — ticked() их уже не трогает.
 */
export function tickSampler(input: Pick<InputDevice, "locked" | "down" | "ticked">, look: () => Look): () => MatchInput {
  return () => {
    const m = buildMatchInput(input.locked ? input.down : NO_KEYS, look());
    input.ticked();
    return m;
  };
}

/**
 * Игровой вид: арена, маг игрока глазами камеры, рендер «Тушь и свет» с проходом света магии, руки-«варежки»
 * с жестами, боевой HUD, синтез звука. Состояния и события даёт драйвер (полигон — одиночная игра, сеть — хост
 * и предсказание игрока); вид — одно «сейчас» на кадр.
 * Кадр: ввод → драйвер (тики) → события → эффекты (руки, магия, звук, камера, hitstop, HUD) → камера → руки → магия →
 * HUD → интерфейс режима → слушатель звука → рендер. Сбой эффектов, звука, HUD или рук кадр не останавливает
 * (createGuard); сбой драйвера (симуляции) или рендера показывает сообщение поверх всего.
 */
export function mountGameView(o: GameViewOptions): GameView | null {
  const { root, arena, ctx, driver } = o;
  document.body.classList.add("game");
  const settings = loadSettings();
  const prefs = { ...loadPrefs(), element: o.element };
  const hud = createHud(root, settings, prefs);
  const input = createInput(hud.canvas);
  const guard = createGuard();
  const fail = (err: unknown): void => {
    hud.setLoading(true, `Не удалось запустить игру: ${message(err)}`);
    console.error(err);
  };

  let renderer: StyleRenderer;
  try {
    renderer = new StyleRenderer(hud.canvas, settings.quality === "auto" ? "high" : settings.quality);
  } catch (err) {
    fail(err);
    return null;
  }
  const vfx = createVfx(renderer.gbuffer, renderer.preset.id);
  const scene = new Scene();
  scene.add(buildArenaMeshes(arena.render), vfx.worldGroup);
  const mittens = createMittens();
  const combat = createCombatHud(root);
  // звук: контекст создаёт первый жест (клик «Играть», выбор стихии, любая клавиша); без Web Audio — тишина, не сбой
  const audio = createAudio();
  unlockOnGesture(audio);
  // боевая музыка (фаза 9): своя шина в лимитер, директор решает по своим событиям и подтверждённому состоянию игры
  audio.setVolume(settings.sfxVolume);
  const music = createMusic({ bus: () => audio.musicBus() });
  music.setEnabled(settings.musicOn);
  music.setVolume(settings.musicVolume);
  const director = createMusicDirector();
  /** В PvP драйвер знает подтверждённую игру и код комнаты; на полигоне их нет — фаза training. */
  const pvpSource = driver as Partial<{ roomCode: string; confirmedGame(): GameState }>;
  const seedOf = createSeedKeeper();
  // вход директора и события кадра — одни на все кадры: кадр музыки ничего не создаёт
  const cues: MusicCue[] = [];
  const musicIn: DirectorInput = { ...emptySituation(), nowS: 0, cues };
  const addCue = (c: MusicCue | null): void => {
    if (c) cues.push(c);
  };
  const feedMusic = (frame: Frame, nowS: number): void => {
    const localId = driver.localId;
    cues.length = 0;
    for (let k = 0; k < frame.ticks.length; k++) {
      const t = frame.ticks[k]!;
      for (let i = 0; i < t.events.length; i++) addCue(musicCue(t.events[i]!, localId, t.state));
    }
    for (let i = 0; i < frame.late.length; i++) addCue(musicCue(frame.late[i]!, localId, frame.cur));
    // серии — только подтверждённые
    for (let i = 0; i < frame.confirmed.length; i++) addCue(streakCue(frame.confirmed[i]!, localId));
    const game = pvpSource.confirmedGame?.() ?? null;
    music.setSeed(seedOf(pvpSource.roomCode ?? null, game));
    musicIn.nowS = nowS;
    music.set(director.step(readSituation(game, frame.cur, localId, musicIn)));
  };
  if (import.meta.env.DEV) {
    // dmAudio.play("fireballBoom", 5) в консоли — только в dev-сборке
    void import("../audio/audition").then((m) => m.installAudioConsole(audio)).catch(() => undefined);
  }

  let look: Look = { yaw: 0, pitch: 0 };
  const sample = tickSampler(input, () => look);
  // нулевой кадр: тиков нет, драйвер отдаёт текущее состояние — для прогрева и взгляда на старте; его события
  // (late, confirmed) вид не показывает, и onFrame его не получает
  const start = driver.advance(0, sample);
  /** cur последнего кадра драйвера; между кадрами — стихия для экрана выбора и подсказки ульты. */
  let cur: MatchState = start.cur;
  look = { yaw: unitById(cur, driver.localId)?.move.yaw ?? 0, pitch: 0 };
  let feel = createCameraFeel();
  /** Сглаживание ступеней лестницы (M1) и звуки шагов, прыжков и приземлений всех магов (M2). */
  let eyeSmooth = createEyeSmooth();
  const moves = createMoveTracker();
  let gestures = createGestures();
  let fistHand: "left" | "right" = "right";
  /** Свист чужого снаряда мимо уха (L12): своя память снарядов на этот вид. */
  const whizz = createWhizzFrame();
  let hitstopUntil = 0;
  let handRig = createHandRig();
  let auto: AutoQuality | null = settings.quality === "auto" ? createAutoQuality("high") : null;
  /** После вердикта автовыбора — сторож боя (только вниз); ручной пресет выключает и его. */
  let watchdog: QualityWatchdog | null = null;
  let fallCam = createFallCamera();
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
          if (isFistGesture(e.ability)) fistHand = gestures.nextFist;
          gestures = startGesture(gestures, e.ability);
        } else if (sink === "vfx") vfx.apply(e, nowS, fistHand);
        else if (e.kind === "sound") audio.play(e.id, e.pos, e.gain, e.floor, e.pitch);
        // отдача кулака и серпа вбок — по руке этого удара (как palm "auto")
        else if (sink === "camera") feel = addFeel(feel, e, fistHand);
        // пауза рук — только если жест ещё идёт: у снаряда жест кончился раньше, чем он долетел (round3/01, H2)
        else if (e.kind === "hitstop") {
          if (gestures.active.length > 0) hitstopUntil = Math.max(hitstopUntil, nowS + e.ms / 1000);
        }
        else combat.apply(e, nowS);
      },
      undefined,
    );
  };

  /**
   * Выбрана стихия. Драйвер вернул точку — маг уже там заново (счёт сохраняется, его снаряды, зоны и рельеф убраны):
   * взгляд на точку, руки, жесты, тряска и hitstop с нуля, пыль появления. null — запрос ушёл хосту.
   */
  const chooseElement = (e: Element): void => {
    prefs.element = e;
    savePrefs(prefs);
    const spawn = driver.chooseElement(e);
    hud.setElement(e);
    if (!spawn) return;
    look = { yaw: spawn.yaw, pitch: 0 };
    gestures = createGestures();
    handRig = createHandRig();
    feel = createCameraFeel();
    eyeSmooth = createEyeSmooth();
    hitstopUntil = 0;
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
    const initial = unitById(cur, driver.localId)?.mage?.element ?? prefs.element;
    void showElementSelect(root, initial).then(({ element, byClick }) => {
      selecting = false;
      hud.setSelecting(false);
      guard.run("select", () => chooseElement(element), undefined);
      if (byClick && !stopped) play();
    });
  };

  /** Кадры больше не идут, мышь отпускаем. */
  const halt = (): void => {
    stopped = true;
    cancelAnimationFrame(raf);
    music.dispose();
    if (document.pointerLockElement) document.exitPointerLock();
  };

  /** Сбой драйвера (симуляции) или рендера: дальше кадры не идут, мышь отпускаем, сообщение — поверх всего. */
  const fatal = (err: unknown): void => {
    halt();
    console.error(err);
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
  hud.onPlay(play);
  hud.onChangeElement(openElementSelect);
  hud.onQuality((q) => {
    settings.quality = q;
    saveSettings(settings);
    // сторож — часть «Авто»: ручной пресет его выключает, «Авто» включит снова после нового вердикта
    watchdog = null;
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
  hud.onSfxVolume((x) => {
    settings.sfxVolume = x;
    saveSettings(settings);
    audio.setVolume(x);
  });
  hud.onMusicOn((on) => {
    settings.musicOn = on;
    saveSettings(settings);
    music.setEnabled(on);
  });
  hud.onMusicVolume((x) => {
    settings.musicVolume = x;
    saveSettings(settings);
    music.setVolume(x);
  });

  const cam = renderer.camera;
  /**
   * Камера мира в глазах мага: между двумя последними тиками, взгляд — сразу по мыши, плюс тряска и толчки.
   * Сорвался в ущелье: пока маг ниже пола и падает (и до возрождения), камера стоит на последнем глазе над полом и
   * доворачивает на мага, руки спрятаны. Возрождение возвращает её в глаза сразу: драйвер даёт prev = cur, проводки
   * через карту нет. Руки спрятаны и пока свой маг мёртв. Своего мага в состоянии нет (сеть: ещё не появился или
   * удалён) — камера стоит, где была, руки спрятаны, null.
   */
  const placeCamera = (from: MatchState, to: MatchState, alpha: number, offset: CameraOffset, dtS: number): Vec3 | null => {
    const me = unitById(to, driver.localId);
    if (!me) {
      mittens.scene.visible = false;
      return null;
    }
    const was = unitById(from, driver.localId) ?? me;
    const p = lerpVec(was.move.body.pos, me.move.body.pos, alpha);
    // ступени лестницы камера догоняет за ≈ 0,07 с, а не прыгает на 0,4 м за тик (M1)
    const eye = { x: p.x, y: stepEyeSmooth(eyeSmooth, p.y + EYE_HEIGHT, was.move.onGround && me.move.onGround, dtS), z: p.z };
    // в ров (пол на −1 м) маг тоже спрыгивает ниже FALL_HOLD_Y, но под ним пол: это не падение
    const falling = p.y < FALL_HOLD_Y && !me.move.onGround && groundBelow(ctx.world, p, FALL_PROBE_M) === null;
    fallCam = stepFallCamera(fallCam, { eye, target: { x: p.x, y: p.y + EYE_HEIGHT / 2, z: p.z }, falling, look, dt: dtS });
    const hold = fallCam.hold;
    mittens.scene.visible = hold === null && me.alive;
    if (hold) {
      cam.position.set(hold.pos.x, hold.pos.y, hold.pos.z);
      cam.rotation.set(hold.pitch, hold.yaw, 0, "YXZ");
    } else {
      // проседание (приземление, удар ладонями в землю) — по вертикали мира, а не по осям взгляда
      cam.position.set(eye.x, eye.y + offset.lift, eye.z);
      cam.rotation.set(look.pitch + offset.pitch, look.yaw + offset.yaw, offset.roll, "YXZ");
      cam.translateX(offset.x);
      cam.translateY(offset.y);
    }
    const fov = WORLD_FOV + offset.fovDeg;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    return p;
  };

  let last = 0;
  /** Время текущего кадра для звуков движения: обработчик создаётся один раз, а не каждый кадр. */
  let frameNowS = 0;
  const emitMove = (e: Effect): void => route(e, frameNowS);
  /** Тик для звуков движения: один обработчик на все тики, а не замыкание на каждый. */
  let moveState: MatchState = cur;
  const trackTick = (): void => trackMovement(moves, moveState, driver.localId, emitMove);
  const step = (now: number): void => {
    // метка rAF бывает чуть раньше performance.now(), снятого после прогрева: шаг не должен быть отрицательным
    const rawMs = Math.max(0, now - last);
    last = now;
    const dtS = rawMs / 1000;
    const nowS = now / 1000;
    frameNowS = nowS;

    const mouse = input.takeMouse();
    const lookBefore = look;
    look = applyLook(look, mouse.dx, mouse.dy, settings.sensitivity, rawMs);
    // рукам — скорость поворота, который взгляд действительно получил; сброс взгляда при возрождении сюда не попадает
    const turn = lookRate(lookBefore, look, dtS);

    // исключение драйвера (симуляции) не ловим здесь: кадр падает в fatal
    const frame = driver.advance(dtS, sample);
    cur = frame.cur;
    const { prev, alpha } = frame;
    const localId = driver.localId;
    /** Самое сильное приземление за тики кадра и номер его тика. */
    let landVel = 0;
    let landTick = 0;
    let respawned = false;
    /** Событие — в эффекты; state — состояние после шага, в котором оно родилось (для поздних — текущее). */
    const onEvent = (ev: MatchEvent, state: MatchState): void => {
      if (ev.type === "respawn" && ev.target === localId) {
        // зажатый с прыжка пробел sim переносит сам; взгляд — на точку появления, prev = cur уже сделал драйвер
        look = { yaw: ev.yaw, pitch: 0 };
        landVel = 0;
        respawned = true;
      }
      if (ev.type === "fall" && ev.target === localId) route({ kind: "toast", text: "Сорвался!" }, nowS);
      for (const e of guard.run("effects", () => effectsFor(ev, { localId, state }), NO_EFFECTS)) route(e, nowS);
    };
    for (let k = 0; k < frame.ticks.length; k++) {
      const t = frame.ticks[k]!;
      const m = unitById(t.state, localId)?.move;
      if (m && m.landVel < landVel) {
        landVel = m.landVel;
        landTick = k;
      }
      for (const ev of t.events) onEvent(ev, t.state);
      moveState = t.state;
      guard.run("effects", trackTick, undefined);
    }
    for (const ev of frame.late) onEvent(ev, cur);
    // непрерывное у стихий (зёрна парения, гул Смерча, журчание Родника) — раз в кадр
    for (const e of guard.run("effects", () => elementFrameEffects({ prev, cur, alpha, localId, nowS, dtS }), NO_EFFECTS)) route(e, nowS);
    // свист чужого снаряда мимо уха — раз в кадр, по отрезку снаряда между кадрами (L12)
    for (const e of guard.run("effects", () => whizz({ prev, cur, alpha, localId, nowS, dtS }), NO_EFFECTS)) route(e, nowS);
    // руки после возрождения — в покое, а не с отставанием и креном от падения
    if (respawned) handRig = createHandRig();
    // приземление садит камеру: −0,006 м на 1 м/с, не глубже 8 см (M1)
    else if (landVel < 0) feel = addLanding(feel, landVel);

    const shake = guard.run("camera", () => stepCameraFeel(feel, dtS, prefs.cameraMotion), null);
    if (shake) feel = shake.feel;
    const p = placeCamera(prev, cur, alpha, shake?.offset ?? STILL, dtS);

    // визуальный hitstop: руки замирают, симуляция идёт (GDD 2.2)
    const handDt = nowS < hitstopUntil ? 0 : dtS;
    guard.run(
      "hands",
      () => {
        const me = unitById(cur, localId);
        if (!me) return;
        // возраст приземления — от момента, который показывает камера (она на тик позади), до тика приземления;
        // остаток накопителя — alpha тика
        const landAge = Math.max(0, (frame.ticks.length - 2 - landTick) * TICK_DT + alpha * TICK_DT);
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
    guard.run("vfx", () => vfx.sync({ prev, cur, alpha, nowS, camera: cam, localId, palms: mittens.palms() }), undefined);
    guard.run(
      "hud",
      () => {
        // полоса HP манекена прячется и за рельефом Земли, и за стеной огня (она закрывает обзор), а не только за аркой
        const sight = buildTickWorld(ctx.world, cur).world;
        combat.update({ cur, prev, alpha, localId, camera: cam, nowS, visible: (q) => lineOfSight(sight, cam.position, q), names: o.names?.() });
      },
      undefined,
    );
    const onFrame = o.onFrame;
    if (onFrame) guard.run("mode", () => onFrame(frame, nowS), undefined);
    guard.run("audio", () => audio.setListener(cam.position, look.yaw), undefined);
    guard.run("music", () => feedMusic(frame, nowS), undefined);

    renderer.render(scene, mittens.scene, vfx.fx);

    // в счётчик — не длиннее 250 мс (иначе после фоновой вкладки «FPS 0 · 13732 мс»); в автовыбор — сырое
    // время кадра, длинные заминки он отбрасывает сам
    meter.push(Math.min(rawMs, FPS_METER_MAX_FRAME_MS));
    const next = auto?.push(rawMs);
    if (next) setPreset(next);
    // автовыбор судил по экрану выбора стихии; бой тяжелее — дальше смотрит сторож, по кадрам с захваченной мышью
    if (auto?.done && !watchdog) watchdog = createQualityWatchdog(renderer.preset.id);
    const lower = watchdog?.push(rawMs, input.locked);
    if (lower) setPreset(lower);
    if (hud.debugVisible) {
      const mode = auto ? (auto.done ? " (авто)" : " (подбор)") : "";
      const where = p ? `x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} z ${p.z.toFixed(1)}` : "мага нет";
      hud.setDebugText(
        `FPS ${meter.fps.toFixed(0)} · ${meter.frameMs.toFixed(1)} мс\n${renderer.preset.label}${mode} · вызовов ${renderer.drawCalls()}\n` +
          `${where} · снарядов ${cur.projectiles.length}`,
      );
    }
  };
  const loop = (now: number): void => {
    if (stopped) return;
    try {
      step(now);
    } catch (err) {
      fatal(err);
      return;
    }
    raf = requestAnimationFrame(loop);
  };

  // прогрев шейдеров до первого взаимодействия, пока на экране «Загрузка…»: кадр с манекенами на местах, а пустые
  // пулы эффектов на время компиляции видимы — иначе первый шар или стена компилировали бы шейдер посреди боя
  hud.setSelecting(true);
  hud.setLocked(false);
  hud.setElement(prefs.element);
  placeCamera(start.prev, cur, start.alpha, STILL, 0);
  vfx.sync({
    prev: start.prev,
    cur,
    alpha: start.alpha,
    nowS: performance.now() / 1000,
    camera: cam,
    localId: driver.localId,
    palms: mittens.palms(),
  });
  const restore = revealForWarmUp([vfx.worldGroup, vfx.fx.world, vfx.fx.palm]);
  renderer
    .warmUp(scene, mittens.scene, vfx.fx)
    .then(() => {
      restore();
      // вид остановили, пока шёл прогрев: кадров не начинаем
      if (stopped) return;
      hud.setLoading(false);
      last = performance.now();
      raf = requestAnimationFrame(loop);
      hud.setSelecting(false);
      if (o.selectOnStart) openElementSelect();
    })
    .catch((err: unknown) => {
      restore();
      fail(err);
    });

  return {
    hud,
    input,
    combat,
    route: (e) => route(e, performance.now() / 1000),
    chooseElement: (e) => guard.run("select", () => chooseElement(e), undefined),
    stop: halt,
  };
}
