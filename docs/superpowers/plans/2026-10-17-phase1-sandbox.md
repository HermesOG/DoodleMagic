# Фаза 1: оффлайн-песочница. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Параллельная работа (решение владельца от 17.10.2026).**
> - Задача 1 «Контракты» делается первой и одна: общие типы и вся настройка пакетов, включая `package.json` и `pnpm-lock.yaml`.
> - Потом три потока идут параллельно, каждый в своём git worktree (superpowers:using-git-worktrees), каждый от коммита задачи 1:
>   - **A** — физика и движение в `packages/sim` (задачи 2–3);
>   - **B** — DSL и данные арены в `packages/arena` (задачи 4–5);
>   - **C** — рендер v0 в `apps/client/src/render` (задачи 6–7).
> - Внутри потока задачи идут по порядку. Потоки только добавляют файлы и правят то немногое, что названо в их задачах; двух потоков на одном файле нет (таблица «Потоки и владение файлами»).
> - В новом worktree первым делом `pnpm install --frozen-lockfile`: зависимости уже закреплены задачей 1.
> - **Порядок слияния:** A → B → C в `main`. Конфликтов быть не должно. После каждого слияния `pnpm test` и `pnpm typecheck` зелёные.
> - Потом интеграция, последовательно: задача 8 (песочница на `/`), задача 9 (руки и приёмка фазы).
>
> Код в плане проверен на прототипе вне репозитория: 131 новый тест проходит, типы сходятся с `@types/three`, `/render-test` и песочница открывались в браузере.

**Goal:** Бегать по арене «Горный монастырь — галерея над ущельем» от первого лица, и это уже выглядит как «Тушь и свет».

**Architecture:**
- `packages/sim` — чистый TypeScript без three.js и DOM:
  - контракты (типы и константы);
  - AABB-мир в равномерной сетке по XZ, луч идёт по клеткам сетки (DDA);
  - тело персонажа с поосным разрешением коллизий и заходом на ступеньки;
  - детерминированный `stepPlayer` с тиком 60 Гц — его же потом будет крутить хост.
- `packages/arena` — DSL уровня и блокаут арены. На выходе простые данные `ArenaData`: коллайдеры с флагами, боксы рендера с материалом, объёмы, спауны, пикапы.
- `apps/client`:
  - рендер «Тушь и свет»: G-буфер (тон, номер чернил, нормаль) и один стилевой проход — контур, 3 тона размывки, бумага, туман, небо; пресеты качества с автовыбором; прогрев шейдеров;
  - FPS-контроллер: Pointer Lock, клавиши по `event.code`, фиксированный тик 60 Гц с интерполяцией, возрождение из ущелья;
  - руки-«варежки» вторым слоем G-буфера;
  - маршруты: `/` — песочница, `/render-test` — отладка рендера, `/nettest` без изменений.

**Tech Stack:** Node 24, pnpm 12.14, TypeScript 7.0.2 (strict), Vitest 5.0.5, Vite 8.3.4, three.js 0.186.1 и @types/three 0.186.0 (WebGL2, без React и R3F).

## Global Constraints
- Язык — TypeScript strict, `noUncheckedIndexedAccess` включён. Область имён пакетов — `@doodlemagic/*`.
- three.js закреплён точно: `three` **0.186.1**, `@types/three` **0.186.0**, без `^` и `~`. Типы выходят по минорным версиям three; новее 0.186.0 их нет (проверено `npm view` 17.10.2026).
- `packages/sim` и `packages/arena` не импортируют three.js и DOM. В их tsconfig только `lib: ES2022`, three не в их зависимостях: нарушение просто не соберётся.
- `stepPlayer` детерминирован: нет `Math.random`, часов и общего изменяемого состояния; ввод — простые данные. Хост будет крутить его с тиком 60 Гц.
- Клавиши — только по `event.code`. Ctrl (а также Alt и Cmd) ни на что не назначен.
- Интерфейс на русском языке.
- Бюджет кадра:
  - не больше 120 draw call'ов;
  - 60 FPS на Iris Xe и Vega 8;
  - не меньше 40 FPS на UHD 620 на пресете «Низкое».
- Первая загрузка — не больше 3 МБ.
- Код Doodle District не копируется. Общие техники написаны заново:
  - G-буфер с номером чернил;
  - контур по лапласиану глубины;
  - AABB-мир в сетке;
  - поосное разрешение со ступенькой;
  - DSL боксов со слиянием по материалу.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Автор git в репозитории уже настроен — просто `git commit`.
- Потоки A, B и C трогают только свои файлы. `package.json`, `pnpm-lock.yaml`, `tsconfig*.json` и `vitest.config.ts` меняет только задача 1.

## Потоки и владение файлами

| Задача | Поток | Начинать после | Файлы (создаёт / правит) |
|---|---|---|---|
| 1. Контракты | последовательно | — | `packages/sim/{package.json,tsconfig.json}`, `packages/sim/src/{types,types.test,index}.ts`, `packages/arena/{package.json,tsconfig.json}`, `packages/arena/src/index.ts`, `apps/client/package.json`, `pnpm-lock.yaml` |
| 2. Мир: векторы, AABB, сетка, луч DDA | A | 1 | `packages/sim/src/{vec,aabb,world,raycast,world.test,raycast.test}.ts`; правит `packages/sim/src/index.ts` |
| 3. Тело и шаг игрока | A | 2 | `packages/sim/src/{body,player,body.test,player.test}.ts`; правит `packages/sim/src/index.ts` |
| 4. DSL арены | B | 1 | `packages/arena/src/{geom,dsl,dsl.test}.ts`; правит `packages/arena/src/index.ts` |
| 5. Галерея над ущельем | B | 4 | `packages/arena/src/{gallery,gallery.test}.ts`; правит `packages/arena/src/index.ts` |
| 6. Рендер: чистые части | C | 1 | `apps/client/src/render/{palette,boxMesh,quality,fpsMeter}.ts` и их тесты |
| 7. Рендер: G-буфер, стилевой проход, `/render-test` | C | 6 | `apps/client/src/render/{gbuffer,stylePass,styleRenderer,arenaMeshes,testPage}.ts`, `render/canvas.css`; правит `apps/client/src/main.ts` |
| 8. Песочница на `/` | последовательно | слияние A, B, C | `apps/client/src/sandbox/*`, `packages/arena/src/gallery.sim.test.ts`; правит `apps/client/src/main.ts` |
| 9. Руки-«варежки» и приёмка | последовательно | 8 | `apps/client/src/hands/*`; правит `apps/client/src/sandbox/page.ts`, дорожную карту |

**Порядок слияния:** 1 → (A: 2 → 3 ∥ B: 4 → 5 ∥ C: 6 → 7) → слить A, затем B, затем C → 8 → 9.

## Карта файлов

| Файл | Отвечает за |
|---|---|
| `packages/sim/src/types.ts` | Контракты: `Vec3`, `AABB`, `Collider` с флагами, `Volume`, `RenderBox` с материалом, `Spawn`, `ArenaData`, `Body`, `PlayerInput`, `PlayerState`, `MoveParams`, константы мага и тика |
| `packages/sim/src/vec.ts`, `aabb.ts` | Векторы и боксы как простые данные |
| `packages/sim/src/world.ts` | Неизменяемый мир: коллайдеры в сетке 4 м по XZ, запросы пересечений, объёмы |
| `packages/sim/src/raycast.ts` | Луч по клеткам сетки (DDA), линия видимости, опора под точкой |
| `packages/sim/src/body.ts` | `moveBody`: подшаги по скорости, X → Z → Y, ступенька 0,55 м, прилипание к земле |
| `packages/sim/src/player.ts` | `stepPlayer`: бег 6,5 м/с, прыжок 1,25 м, 60 % в воздухе, койот-время, буфер прыжка, восходящий поток |
| `packages/arena/src/geom.ts` | Мини-геометрия арены (поток B не ждёт поток A): боксы, обрезка, луч перебором |
| `packages/arena/src/dsl.ts` | DSL: `box`, `slab`, `wallX`/`wallZ` с проёмами, `stairs`, `mirror`, `volume`, `spawn`, `pickup`, обрезка арены |
| `packages/arena/src/gallery.ts` | Блокаут «галереи над ущельем» 44 × 36 м и компактный 30 × 36 м |
| `apps/client/src/render/palette.ts` | Номера и цвета чернил, правило трёх слоёв яркости, солнце |
| `apps/client/src/render/boxMesh.ts` | Боксы → массивы вершин, группировка по чернилам (без three.js, с тестами) |
| `apps/client/src/render/quality.ts` | Пресеты «Низкое / Среднее / Высокое» и автовыбор по времени кадра |
| `apps/client/src/render/fpsMeter.ts` | FPS для отладочного угла |
| `apps/client/src/render/gbuffer.ts`, `stylePass.ts` | Шейдеры: проход G-буфера и стилевой проход |
| `apps/client/src/render/styleRenderer.ts` | WebGLRenderer, G-буфер, второй слой, ресайз, пресет, прогрев |
| `apps/client/src/render/arenaMeshes.ts` | Статика арены: один меш на чернила |
| `apps/client/src/render/testPage.ts`, `canvas.css` | `/render-test` и стили полноэкранного холста |
| `apps/client/src/sandbox/controls.ts`, `fixedStep.ts`, `respawn.ts`, `settings.ts` | Чистая логика контроллера: клавиши, мышь, тик, возрождение, настройки |
| `apps/client/src/sandbox/input.ts`, `hud.ts`, `page.ts`, `sandbox.css` | DOM: Pointer Lock, подсказка, меню паузы, отладочный угол, игровой цикл |
| `packages/arena/src/gallery.sim.test.ts` | Стык потоков: арена с настоящей физикой и лучом по сетке |
| `apps/client/src/hands/spring.ts`, `motion.ts`, `mittens.ts` | Пружины, движение рук, варежки из примитивов |

## Решения этого плана
- **Арена — отдельный пакет `@doodlemagic/arena`**, а не папка в `sim`:
  - `sim` — движок, который хост крутит каждый тик; арена — контент со своим темпом изменений (в MVP три арены и импорт из Blender);
  - материалы рендера в `sim` не нужны;
  - потоки A и B не делят ни одного файла.
- **10 спаунов в кельях вдоль дальних стен, а не на открытых террасах.**
  - Келья 3 × 3,5 м под общей крышей. Дверь — в боковой стене у задней стены, выход по проходу 2 м между кельями.
  - Так любая прямая из кельи упирается в соседнюю келью, и «ни один спаун не видит другой» выполняется по построению, а не по удаче.
  - По бокам ряда — глухие кладовые.
- **Арка руны 5 м вместо 12-метрового пролёта над всем ущельем.** По бокам опоры галереи уходят в пустоту ущелья. Это ровно «руну простреливают только сквозь арку» из раунда 1. Без этого косые линии сквозь ущелье тянулись на 40 м.
- **Двор с укрытиями:**
  - две ширмы 2,6 м делят двор на три зоны и стоят вразбежку, поэтому и в зеркальной половине перекрывают косые линии;
  - стелы стоят перед проходами между кельями;
  - фонари стоят у мостов;
  - валуны во рву.

  Тест «линии обзора ≤ 30 м» проверяет это выборкой: сетка 1,5 м, 32 направления. Проверка гуще (0,5 м, 64 направления) дала максимум 30,4 м.
- **Руки — второй слой того же G-буфера:**
  - своя камера (FOV 60°);
  - `depthRange(0, 0.02)`: руки всегда перед миром, поэтому не уходят в стену, но друг друга перекрывают правильно;
  - глубина мира не стирается — она нужна стилевому проходу;
  - контур у рук в 1,5 раза толще;
  - всего 8 draw call'ов на руки.
- **Флаги коллайдеров:**

  | Флаг | Движение | Снаряды | Взгляд | Пример |
  |---|---|---|---|---|
  | (нет) | держит | держит | держит | камень |
  | `noShoot` | держит | пропускает | пропускает | перила, решётки |
  | `noSight` | пропускает | пропускает | держит | трава, пар, стена огня |

  В фазе 1 эти флаги никто не ставит, но запросы их учитывают.
- **`arena.gameplay.json` не пишем.** `ArenaData` — простые данные: есть тест на JSON round-trip. И хост, и клиент — браузеры с тем же модулем, а файл понадобится, когда появится не-JS потребитель: экспорт из Blender или сервер.
- **Гравитация 20 м/с², интегрирование по трапеции.** Высота прыжка — ровно 1,25 м при любом тике. Восходящий поток задаёт стартовую скорость до своей высоты (у башни 6,5 м).
- **Детерминизм и тригонометрия.** `Math.sin`/`Math.cos` бит в бит совпадают в одном движке. У Chrome и Firefox возможна разница в последнем бите — для схемы «хост авторитетен, клиент сверяется» (фаза 3) это не мешает.
- **Ориентация.** `yaw = 0` смотрит вдоль −Z, положительный `yaw` поворачивает влево, `pitch` вверх положительный — как у камеры three.js.

---

### Task 1: Контракты

**Поток:** последовательно, первой. Остальные задачи начинаются от её коммита.

**Files:**
- Create: `packages/sim/package.json`, `packages/sim/tsconfig.json`, `packages/sim/src/types.ts`, `packages/sim/src/index.ts`
- Create: `packages/arena/package.json`, `packages/arena/tsconfig.json`, `packages/arena/src/index.ts`
- Modify: `apps/client/package.json` (зависимости three, типы, workspace-пакеты), `pnpm-lock.yaml` (через `pnpm install`)
- Test: `packages/sim/src/types.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces (импорт из `@doodlemagic/sim`), только типы и константы, без логики:
  - геометрия: `Vec3 { x; y; z }`, `Axis = "x" | "y" | "z"`, `AABB { min: Vec3; max: Vec3 }`;
  - мир:
    - `ColliderFlags { noShoot?: true; noSight?: true }`;
    - `Collider extends ColliderFlags { box: AABB; tag?: string }`;
    - `VolumeKind = "updraft" | "kill" | "grass"`;
    - `Volume { kind; box; liftM? }`;
    - `RayKind = "move" | "shot" | "sight"`;
  - арена:
    - `MATERIALS = ["stone", "floor", "roof", "grass", "edge", "gold"] as const`, `Material`;
    - `RenderBox { box; material }`;
    - `Spawn { pos; yaw }`;
    - `PickupKind = "orb" | "rune"`, `Pickup { kind; pos }`;
    - `ArenaVariant = "full" | "compact"`;
    - `ArenaData { name; variant; bounds; colliders; volumes; render; spawns; pickups }`;
  - тело и игрок:
    - `Body { pos; vel; halfW; height; stepHeight }`;
    - `MoveResult { onGround; hitWall; hitCeiling; landVel; stepped }`;
    - `PlayerInput { moveX; moveZ; jump; yaw; pitch }`;
    - `PlayerState { body; onGround; coyote; jumpBuffer; jumpHeld; yaw; pitch; landVel }`;
    - `MoveParams { runSpeed; groundAccel; groundDecel; airControl; gravity; jumpHeight; coyoteTime; jumpBufferTime; maxFallSpeed }`;
  - константы: `PLAYER_HALF_W = 0.4`, `PLAYER_HEIGHT = 1.8`, `PLAYER_STEP = 0.55`, `EYE_HEIGHT = 1.6`, `TICK_HZ = 60`, `TICK_DT = 1/60`.
- Produces (пакеты):
  - `@doodlemagic/sim`: `exports` → `./src/index.ts`;
  - `@doodlemagic/arena`: зависит от `@doodlemagic/sim`, пока пустой;
  - в `@doodlemagic/client` подключены `three` 0.186.1, `@types/three` 0.186.0 и оба пакета.

- [ ] **Step 1: Создать пакеты**

`packages/sim/package.json`:
```json
{
  "name": "@doodlemagic/sim",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p ." }
}
```

`packages/sim/tsconfig.json` и `packages/arena/tsconfig.json` (одинаковые; `lib` берётся из `tsconfig.base.json` — только ES2022, без DOM):
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/arena/package.json`:
```json
{
  "name": "@doodlemagic/arena",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p ." },
  "dependencies": {
    "@doodlemagic/sim": "workspace:*"
  }
}
```

`packages/arena/src/index.ts`:
```ts
// Наполняется в потоке B (задачи 4–5): DSL арены и блокаут «галереи над ущельем».
export {};
```

`packages/sim/src/index.ts`:
```ts
export * from "./types";
```

`apps/client/package.json` (заменить целиком):
```json
{
  "name": "@doodlemagic/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@doodlemagic/arena": "workspace:*",
    "@doodlemagic/protocol": "workspace:*",
    "@doodlemagic/sim": "workspace:*",
    "peerjs": "1.5.5",
    "three": "0.186.1"
  },
  "devDependencies": {
    "@types/three": "0.186.0",
    "vite": "^8.3.4"
  }
}
```

- [ ] **Step 2: Написать падающий тест**

`packages/sim/src/types.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT,
  MATERIALS,
  PLAYER_HEIGHT,
  PLAYER_STEP,
  TICK_DT,
  TICK_HZ,
  type ArenaData,
  type PlayerInput,
  type PlayerState,
} from "./types";

describe("contracts", () => {
  it("lists the arena materials", () => {
    expect(MATERIALS).toEqual(["stone", "floor", "roof", "grass", "edge", "gold"]);
  });

  it("keeps the movement constants consistent", () => {
    expect(TICK_DT * TICK_HZ).toBe(1);
    expect(EYE_HEIGHT).toBeLessThan(PLAYER_HEIGHT);
    // низкое укрытие 1 м нельзя перешагнуть
    expect(PLAYER_STEP).toBeLessThan(1);
  });

  it("describes plain data that survives JSON", () => {
    const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const arena: ArenaData = {
      name: "t",
      variant: "full",
      bounds: box,
      colliders: [{ box, noSight: true, tag: "x" }],
      volumes: [{ kind: "updraft", box, liftM: 6 }],
      render: [{ box, material: "gold" }],
      spawns: [{ pos: { x: 0, y: 0, z: 0 }, yaw: 1 }],
      pickups: [{ kind: "rune", pos: { x: 0, y: 0.5, z: 0 } }],
    };
    const input: PlayerInput = { moveX: 0, moveZ: 1, jump: false, yaw: 0, pitch: 0 };
    const state: PlayerState = {
      body: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, halfW: 0.4, height: 1.8, stepHeight: 0.55 },
      onGround: true,
      coyote: 0,
      jumpBuffer: 0,
      jumpHeld: false,
      yaw: 0,
      pitch: 0,
      landVel: 0,
    };
    for (const value of [arena, input, state]) expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
});
```

- [ ] **Step 3: Поставить зависимости и убедиться, что тест падает**

Run: `pnpm install`
Expected: в `pnpm-lock.yaml` появились `three@0.186.1`, `@types/three@0.186.0` и ссылки `link:../../packages/sim`, `link:../../packages/arena`. Проверка: `pnpm --filter @doodlemagic/client ls three @types/three` печатает `three 0.186.1` и `@types/three 0.186.0`.

Run: `pnpm test packages/sim`
Expected: FAIL — `Failed to resolve import "./types"`.

- [ ] **Step 4: Написать контракты**

`packages/sim/src/types.ts`:
```ts
/**
 * Контракты фазы 1: общие типы и константы для потоков A (физика), B (арена) и C (рендер).
 * Здесь нет логики, только формы данных. Всё — простые данные: уходит в JSON и по сети без потерь.
 */

// ---------------------------------------------------------------- геометрия

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Axis = "x" | "y" | "z";

/** Бокс по осям, min ≤ max по каждой оси. */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

// ---------------------------------------------------------------- мир

/**
 * Флаги коллайдера. По умолчанию бокс держит движение, снаряды и взгляд.
 * - `noShoot` — перила и решётки: держит только движение, снаряды и взгляд проходят насквозь.
 * - `noSight` — трава, пар, стена огня: только закрывает обзор, движение и снаряды проходят насквозь.
 */
export interface ColliderFlags {
  noShoot?: true;
  noSight?: true;
}

export interface Collider extends ColliderFlags {
  box: AABB;
  /** Метка для тестов и отладки: "bridge", "kerb"… На физику не влияет. */
  tag?: string;
}

export type VolumeKind = "updraft" | "kill" | "grass";

/** Объём без коллизии: восходящий поток, зона смерти, трава. */
export interface Volume {
  kind: VolumeKind;
  box: AABB;
  /** Только для потока: до какой высоты над низом объёма он поднимает, м. */
  liftM?: number;
}

/** Вид запроса к миру: движение, снаряд или взгляд. */
export type RayKind = "move" | "shot" | "sight";

// ---------------------------------------------------------------- арена

/** Материалы арены. Клиент сам решает, какими чернилами рисовать каждый. */
export const MATERIALS = ["stone", "floor", "roof", "grass", "edge", "gold"] as const;
export type Material = (typeof MATERIALS)[number];

export interface RenderBox {
  box: AABB;
  material: Material;
}

export interface Spawn {
  /** Середина подошвы. */
  pos: Vec3;
  /** Куда смотрит появившийся маг, рад (как PlayerInput.yaw). */
  yaw: number;
}

export type PickupKind = "orb" | "rune";

export interface Pickup {
  kind: PickupKind;
  pos: Vec3;
}

export type ArenaVariant = "full" | "compact";

export interface ArenaData {
  name: string;
  variant: ArenaVariant;
  /** Заявленные габариты: в них лежит всё остальное. */
  bounds: AABB;
  colliders: Collider[];
  volumes: Volume[];
  render: RenderBox[];
  spawns: Spawn[];
  pickups: Pickup[];
}

// ---------------------------------------------------------------- тело и игрок

/** Тело персонажа: бокс 2·halfW × height × 2·halfW, pos — середина подошвы. */
export interface Body {
  pos: Vec3;
  vel: Vec3;
  halfW: number;
  height: number;
  /** Ступенька, на которую тело заходит без прыжка, м. */
  stepHeight: number;
}

export interface MoveResult {
  onGround: boolean;
  hitWall: boolean;
  hitCeiling: boolean;
  /** Вертикальная скорость в момент приземления (< 0) или 0, если в этом шаге приземления не было. */
  landVel: number;
  /** Заходили ли на ступеньку. */
  stepped: boolean;
}

/** Ввод за один тик. Только простые данные: его можно переслать хосту как есть. */
export interface PlayerInput {
  /** Стрейф: −1 влево … +1 вправо. */
  moveX: number;
  /** Вперёд-назад: +1 вперёд … −1 назад. */
  moveZ: number;
  /** Кнопка прыжка зажата. Нажатие — переход false → true между тиками. */
  jump: boolean;
  /** Поворот вокруг Y, рад. 0 — взгляд вдоль −Z, положительный — влево (как в three.js). */
  yaw: number;
  /** Наклон взгляда, рад, положительный — вверх. */
  pitch: number;
}

export interface PlayerState {
  body: Body;
  onGround: boolean;
  /** Сколько ещё секунд можно прыгнуть после схода с края. */
  coyote: number;
  /** Сколько ещё секунд помним нажатие прыжка. */
  jumpBuffer: number;
  jumpHeld: boolean;
  yaw: number;
  pitch: number;
  /** Скорость приземления в этом тике (< 0) или 0. Нужна рукам и камере. */
  landVel: number;
}

/** Параметры движения мага. GDD, раздел 3: бег 6–7 м/с, один прыжок 1,25 м, управление в воздухе 60 %. */
export interface MoveParams {
  runSpeed: number;
  /** Разгон и торможение на земле, м/с². */
  groundAccel: number;
  groundDecel: number;
  /** Доля наземного разгона в воздухе. */
  airControl: number;
  gravity: number;
  jumpHeight: number;
  coyoteTime: number;
  jumpBufferTime: number;
  maxFallSpeed: number;
}

// ---------------------------------------------------------------- константы

/** Габариты мага: хитбокс r 0,4 м × 1,8 м (GDD 2.2, рецензия арт-директора). */
export const PLAYER_HALF_W = 0.4;
export const PLAYER_HEIGHT = 1.8;
/** Заход на ступеньку без прыжка. Низкое укрытие 1 м так не перешагнуть, только перепрыгнуть. */
export const PLAYER_STEP = 0.55;
/** Высота глаз над подошвой, м. */
export const EYE_HEIGHT = 1.6;
/** Частота симуляции у хоста и клиента. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
```

- [ ] **Step 5: Убедиться, что тесты проходят, и проверить типы**

Run: `pnpm test` и `pnpm typecheck`
Expected: PASS — 3 новых теста в `types.test.ts`, прежние тесты фазы 0 зелёные; типы без ошибок во всех пакетах (`@doodlemagic/arena` с пустым `index.ts` тоже проходит).

- [ ] **Step 6: Коммит**

```bash
git add packages/sim packages/arena apps/client/package.json pnpm-lock.yaml
git commit -m "chore: phase 1 contracts — sim and arena packages, three.js pinned" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Мир: векторы, AABB, сетка, луч DDA

**Поток:** A (первая задача потока).

**Files:**
- Create: `packages/sim/src/vec.ts`, `packages/sim/src/aabb.ts`, `packages/sim/src/world.ts`, `packages/sim/src/raycast.ts`
- Modify: `packages/sim/src/index.ts`
- Test: `packages/sim/src/world.test.ts`, `packages/sim/src/raycast.test.ts`

**Interfaces:**
- Consumes: типы из `./types` (задача 1).
- Produces (из `@doodlemagic/sim`):
  - `vec.ts`: `AXES`, `vec3(x?, y?, z?)`, `cloneVec`, `add`, `sub`, `scale`, `dot`, `length`, `lengthXZ`, `distance`, `lerpVec(a, b, t)`, `normalize`, `clamp(x, lo, hi)`. Только операции с точным округлением, `Math.hypot` не используется;
  - `aabb.ts`: `aabb(x0, y0, z0, x1, y1, z1): AABB`, `overlaps(a, b, eps?)` (касание не считается), `containsPoint`, `containsBox(outer, inner)`, `intersect(a, b): AABB | null`, `sizeOf`, `centerOf`;
  - `world.ts`:
    - `World { colliders; volumes; cell; x0; z0; cols; rows; cells }` — неизменяем;
    - `createWorld(colliders, volumes?, cell = 4): World`;
    - `blocks(flags, kind: RayKind): boolean`;
    - `cellIndex(w, v, axis)`;
    - `overlapping(w, box, out?, kind = "move"): number[]`;
    - `isFree(w, box)`, `volumeAt(w, box, kind): Volume | null`;
    - константы `DEFAULT_CELL_M = 4`, `OVERLAP_EPS = 1e-6`;
  - `raycast.ts`:
    - `RayHit { dist; point; normal; collider }`, `RayStats { tested }`;
    - `raycast(w, origin, dir, maxDist, kind = "shot", stats?): RayHit | null` — идёт по клеткам сетки (DDA);
    - `lineOfSight(w, a, b): boolean` (луч `"sight"`);
    - `groundBelow(w, p, maxDrop = 50): number | null`.

- [ ] **Step 1: Написать падающие тесты**

`packages/sim/src/world.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { aabb, containsBox, intersect, overlaps } from "./aabb";
import { add, length, lerpVec, normalize, vec3 } from "./vec";
import type { Collider } from "./types";
import { blocks, createWorld, isFree, overlapping, volumeAt } from "./world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<Collider> = {}): Collider => ({
  box: aabb(x0, y0, z0, x1, y1, z1),
  ...extra,
});

describe("vec", () => {
  it("adds, normalizes and interpolates", () => {
    expect(add(vec3(1, 2, 3), vec3(1, 1, 1))).toEqual({ x: 2, y: 3, z: 4 });
    expect(length(normalize(vec3(3, 0, 4)))).toBeCloseTo(1, 12);
    expect(normalize(vec3())).toEqual({ x: 0, y: 0, z: 0 });
    expect(lerpVec(vec3(0, 0, 0), vec3(10, 20, 30), 0.5)).toEqual({ x: 5, y: 10, z: 15 });
  });
});

describe("aabb", () => {
  it("orders corners", () => {
    expect(aabb(2, 2, 2, 0, 0, 0)).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } });
  });

  it("treats touching faces as not overlapping", () => {
    expect(overlaps(aabb(0, 0, 0, 1, 1, 1), aabb(1, 0, 0, 2, 1, 1))).toBe(false);
    expect(overlaps(aabb(0, 0, 0, 1, 1, 1), aabb(0.9, 0, 0, 2, 1, 1))).toBe(true);
  });

  it("intersects and checks containment", () => {
    expect(intersect(aabb(0, 0, 0, 2, 2, 2), aabb(1, 1, 1, 3, 3, 3))).toEqual(aabb(1, 1, 1, 2, 2, 2));
    expect(intersect(aabb(0, 0, 0, 1, 1, 1), aabb(1, 0, 0, 2, 1, 1))).toBeNull();
    expect(containsBox(aabb(0, 0, 0, 10, 10, 10), aabb(1, 1, 1, 2, 2, 2))).toBe(true);
    expect(containsBox(aabb(0, 0, 0, 10, 10, 10), aabb(9, 9, 9, 11, 10, 10))).toBe(false);
  });
});

describe("createWorld", () => {
  it("covers all colliders with a grid of 4 m cells", () => {
    const w = createWorld([col(-10, 0, -6, -9, 1, -5), col(9, 0, 5, 10, 1, 6)]);
    expect(w.x0).toBe(-10);
    expect(w.z0).toBe(-6);
    expect(w.cols).toBe(5);
    expect(w.rows).toBe(3);
    expect(w.cells).toHaveLength(15);
  });

  it("puts a large box into every cell it spans", () => {
    const w = createWorld([col(0, 0, 0, 12, 1, 1)]);
    expect(w.cells.filter((c) => c.includes(0))).toHaveLength(3);
  });
});

describe("overlapping", () => {
  const w = createWorld([
    col(0, 0, 0, 2, 2, 2),
    col(5, 0, 0, 6, 2, 2),
    col(0, 0, 3, 2, 2, 4, { noSight: true }),
    col(0, 0, -3, 2, 2, -2, { noShoot: true }),
  ]);

  it("finds boxes that really overlap and ignores touching ones", () => {
    expect(overlapping(w, aabb(1, 1, 1, 3, 3, 3))).toEqual([0]);
    expect(overlapping(w, aabb(2, 0, 0, 5, 2, 2))).toEqual([]);
  });

  it("returns each collider once even if it spans several cells", () => {
    const big = createWorld([col(0, 0, 0, 20, 1, 20)]);
    expect(overlapping(big, aabb(1, 0, 1, 19, 1, 19))).toEqual([0]);
  });

  it("lets movement pass through sight-only boxes but not through railings", () => {
    expect(isFree(w, aabb(0.5, 0.5, 3.2, 1.5, 1.5, 3.8))).toBe(true);
    expect(isFree(w, aabb(0.5, 0.5, -2.8, 1.5, 1.5, -2.2))).toBe(false);
  });
});

describe("blocks", () => {
  it("matches the flag table", () => {
    expect([blocks({}, "move"), blocks({}, "shot"), blocks({}, "sight")]).toEqual([true, true, true]);
    expect([blocks({ noShoot: true }, "move"), blocks({ noShoot: true }, "shot"), blocks({ noShoot: true }, "sight")]).toEqual([
      true,
      false,
      false,
    ]);
    expect([blocks({ noSight: true }, "move"), blocks({ noSight: true }, "shot"), blocks({ noSight: true }, "sight")]).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe("volumeAt", () => {
  it("finds a volume of the asked kind", () => {
    const w = createWorld([], [
      { kind: "grass", box: aabb(0, 0, 0, 4, 1, 4) },
      { kind: "kill", box: aabb(0, -10, 0, 4, -2, 4) },
    ]);
    expect(volumeAt(w, aabb(1, -5, 1, 2, -3, 2), "kill")?.kind).toBe("kill");
    expect(volumeAt(w, aabb(1, -5, 1, 2, -3, 2), "grass")).toBeNull();
  });
});
```

`packages/sim/src/raycast.test.ts`. Главный тест сверяет луч по сетке с перебором на 500 случайных лучах. Ещё один проверяет счётчиком, что луч не обходит все 400 боксов:
```ts
import { describe, expect, it } from "vitest";
import { aabb } from "./aabb";
import { groundBelow, lineOfSight, raycast, type RayStats } from "./raycast";
import { normalize, vec3 } from "./vec";
import type { Collider } from "./types";
import { createWorld } from "./world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<Collider> = {}): Collider => ({
  box: aabb(x0, y0, z0, x1, y1, z1),
  ...extra,
});

/** Детерминированный ГПСЧ для тестов (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Эталон: перебор всех боксов. */
function bruteForce(colliders: readonly Collider[], o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, maxDist: number): number | null {
  let best: number | null = null;
  for (const c of colliders) {
    let tNear = 0;
    let tFar = maxDist;
    let hit = true;
    for (const a of ["x", "y", "z"] as const) {
      if (d[a] === 0) {
        if (o[a] < c.box.min[a] || o[a] > c.box.max[a]) hit = false;
        continue;
      }
      const t0 = (c.box.min[a] - o[a]) / d[a];
      const t1 = (c.box.max[a] - o[a]) / d[a];
      tNear = Math.max(tNear, Math.min(t0, t1));
      tFar = Math.min(tFar, Math.max(t0, t1));
    }
    if (hit && tNear <= tFar && (best === null || tNear < best)) best = tNear;
  }
  return best;
}

describe("raycast", () => {
  const w = createWorld([col(4, 0, -1, 5, 3, 1), col(10, 0, -1, 11, 3, 1), col(-20, -1, -20, 20, 0, 20)]);

  it("returns the nearest hit with distance, point and normal", () => {
    const hit = raycast(w, vec3(0, 1, 0), vec3(1, 0, 0), 100);
    expect(hit).not.toBeNull();
    expect(hit!.collider).toBe(0);
    expect(hit!.dist).toBeCloseTo(4, 9);
    expect(hit!.point).toEqual({ x: 4, y: 1, z: 0 });
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it("respects maxDist and ignores boxes behind the origin", () => {
    expect(raycast(w, vec3(0, 1, 0), vec3(1, 0, 0), 3.9)).toBeNull();
    expect(raycast(w, vec3(7, 1, 0), vec3(1, 0, 0), 100)!.collider).toBe(1);
  });

  it("enters the grid from outside", () => {
    const hit = raycast(w, vec3(-40, 1, 0), vec3(1, 0, 0), 100);
    expect(hit!.collider).toBe(0);
    expect(hit!.dist).toBeCloseTo(44, 9);
    expect(raycast(w, vec3(-40, 1, 30), vec3(1, 0, 0), 100)).toBeNull();
  });

  it("casts straight down onto the floor", () => {
    expect(groundBelow(w, vec3(2, 5, 2))).toBe(0);
    expect(groundBelow(w, vec3(4.5, 5, 0))).toBe(3);
    expect(groundBelow(w, vec3(50, 5, 50))).toBeNull();
  });

  it("filters by ray kind", () => {
    const fw = createWorld([col(2, 0, -1, 3, 3, 1, { noShoot: true }), col(6, 0, -1, 7, 3, 1, { noSight: true })]);
    expect(raycast(fw, vec3(0, 1, 0), vec3(1, 0, 0), 100, "shot")).toBeNull();
    expect(raycast(fw, vec3(0, 1, 0), vec3(1, 0, 0), 100, "sight")!.collider).toBe(1);
    expect(raycast(fw, vec3(0, 1, 0), vec3(1, 0, 0), 100, "move")!.collider).toBe(0);
  });

  it("walks the grid instead of testing every box", () => {
    const many: Collider[] = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) many.push(col(i * 5, 0, j * 5, i * 5 + 1, 1, j * 5 + 1));
    const big = createWorld(many);
    const stats: RayStats = { tested: 0 };
    const hit = raycast(big, vec3(2.5, 0.5, 0.5), vec3(1, 0, 0), 200, "shot", stats);
    expect(hit!.dist).toBeCloseTo(2.5, 9);
    expect(stats.tested).toBeLessThan(10);
    const miss: RayStats = { tested: 0 };
    expect(raycast(big, vec3(2.5, 0.5, 2.5), vec3(1, 0, 0), 200, "shot", miss)).toBeNull();
    expect(miss.tested).toBeLessThan(60);
  });

  it("agrees with brute force on random scenes", () => {
    const rand = rng(7);
    const colliders: Collider[] = [];
    for (let k = 0; k < 150; k++) {
      const x = rand() * 60 - 30;
      const z = rand() * 60 - 30;
      const y = rand() * 4;
      colliders.push(col(x, y, z, x + 0.2 + rand() * 6, y + 0.2 + rand() * 3, z + 0.2 + rand() * 6));
    }
    const rw = createWorld(colliders);
    for (let r = 0; r < 500; r++) {
      const o = vec3(rand() * 80 - 40, rand() * 6 - 1, rand() * 80 - 40);
      const d = normalize(vec3(rand() * 2 - 1, (rand() * 2 - 1) * 0.3, rand() * 2 - 1));
      const expected = bruteForce(colliders, o, d, 120);
      const got = raycast(rw, o, d, 120);
      if (expected === null) expect(got).toBeNull();
      else expect(got?.dist).toBeCloseTo(expected, 9);
    }
  });
});

describe("lineOfSight", () => {
  it("is blocked by a wall and free around it", () => {
    const w = createWorld([col(-1, 0, -1, 1, 3, 1)]);
    expect(lineOfSight(w, vec3(-5, 1.6, 0), vec3(5, 1.6, 0))).toBe(false);
    expect(lineOfSight(w, vec3(-5, 1.6, 3), vec3(5, 1.6, 3))).toBe(true);
    expect(lineOfSight(w, vec3(-5, 4, 0), vec3(5, 4, 0))).toBe(true);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test packages/sim`
Expected: FAIL — `Failed to resolve import "./aabb"` и `"./raycast"`.

- [ ] **Step 3: Векторы и боксы**

`packages/sim/src/vec.ts`:
```ts
/**
 * Вектор как простые данные: состояние без потерь уходит в JSON и по сети.
 * Только операции с точным округлением (+, −, ×, /, sqrt): у хоста и у клиента результат совпадает бит в бит.
 * Math.hypot не используем — его точность в разных движках разная.
 */
import type { Axis, Vec3 } from "./types";

export const AXES: readonly Axis[] = ["x", "y", "z"];

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const cloneVec = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const lengthXZ = (a: Vec3): number => Math.sqrt(a.x * a.x + a.z * a.z);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : vec3();
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
```

`packages/sim/src/aabb.ts`:
```ts
import type { AABB, Vec3 } from "./types";

/** Бокс по двум углам в любом порядке. */
export function aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB {
  return {
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
  };
}

/** Пересекаются ли боксы. Касание гранями — не пересечение; eps — допуск на погрешность. */
export function overlaps(a: AABB, b: AABB, eps = 0): boolean {
  return (
    a.min.x < b.max.x - eps &&
    a.max.x > b.min.x + eps &&
    a.min.y < b.max.y - eps &&
    a.max.y > b.min.y + eps &&
    a.min.z < b.max.z - eps &&
    a.max.z > b.min.z + eps
  );
}

/** Лежит ли точка в боксе, границы включительно. */
export function containsPoint(b: AABB, p: Vec3): boolean {
  return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
}

/** Лежит ли бокс a целиком в боксе b. */
export function containsBox(b: AABB, a: AABB): boolean {
  return containsPoint(b, a.min) && containsPoint(b, a.max);
}

/** Пересечение боксов или null, если объём нулевой. */
export function intersect(a: AABB, b: AABB): AABB | null {
  const r = aabb(
    Math.max(a.min.x, b.min.x),
    Math.max(a.min.y, b.min.y),
    Math.max(a.min.z, b.min.z),
    Math.min(a.max.x, b.max.x),
    Math.min(a.max.y, b.max.y),
    Math.min(a.max.z, b.max.z),
  );
  const empty =
    Math.max(a.min.x, b.min.x) >= Math.min(a.max.x, b.max.x) ||
    Math.max(a.min.y, b.min.y) >= Math.min(a.max.y, b.max.y) ||
    Math.max(a.min.z, b.min.z) >= Math.min(a.max.z, b.max.z);
  return empty ? null : r;
}

export const sizeOf = (b: AABB): Vec3 => ({ x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z });
export const centerOf = (b: AABB): Vec3 => ({
  x: (b.min.x + b.max.x) / 2,
  y: (b.min.y + b.max.y) / 2,
  z: (b.min.z + b.max.z) / 2,
});
```

- [ ] **Step 4: Мир в сетке**

`packages/sim/src/world.ts`:
```ts
import { overlaps } from "./aabb";
import type { AABB, Collider, ColliderFlags, RayKind, Volume, VolumeKind } from "./types";

/** Держит ли коллайдер данный вид запроса. */
export function blocks(c: ColliderFlags, kind: RayKind): boolean {
  if (kind === "move") return c.noSight !== true;
  if (kind === "shot") return c.noShoot !== true && c.noSight !== true;
  return c.noShoot !== true;
}

export const DEFAULT_CELL_M = 4;
/** Допуск пересечения: касание с погрешностью до микрона не считается столкновением. */
export const OVERLAP_EPS = 1e-6;

/**
 * Статический мир: коллайдеры в равномерной сетке по XZ и объёмы.
 * Мир неизменяем: запросы ничего в нём не пишут, поэтому один мир можно делить между хостом и клиентом.
 */
export interface World {
  readonly colliders: readonly Collider[];
  readonly volumes: readonly Volume[];
  readonly cell: number;
  /** Левый нижний угол сетки по X и Z. */
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  /** Номера коллайдеров в клетке (i, j) лежат в cells[j * cols + i]. */
  readonly cells: readonly (readonly number[])[];
}

export function createWorld(colliders: readonly Collider[], volumes: readonly Volume[] = [], cell = DEFAULT_CELL_M): World {
  let minX = 0;
  let minZ = 0;
  let maxX = cell;
  let maxZ = cell;
  if (colliders.length > 0) {
    minX = Infinity;
    minZ = Infinity;
    maxX = -Infinity;
    maxZ = -Infinity;
    for (const c of colliders) {
      minX = Math.min(minX, c.box.min.x);
      minZ = Math.min(minZ, c.box.min.z);
      maxX = Math.max(maxX, c.box.max.x);
      maxZ = Math.max(maxZ, c.box.max.z);
    }
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  const world: World = { colliders, volumes, cell, x0: minX, z0: minZ, cols, rows, cells };
  colliders.forEach((c, idx) => {
    const [i0, i1] = cellSpan(world, c.box.min.x, c.box.max.x, "x");
    const [j0, j1] = cellSpan(world, c.box.min.z, c.box.max.z, "z");
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * cols + i]!.push(idx);
  });
  return world;
}

/** Номер клетки по координате, прижатый к краям сетки. */
export function cellIndex(w: World, v: number, axis: "x" | "z"): number {
  const origin = axis === "x" ? w.x0 : w.z0;
  const count = axis === "x" ? w.cols : w.rows;
  const i = Math.floor((v - origin) / w.cell);
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}

function cellSpan(w: World, lo: number, hi: number, axis: "x" | "z"): [number, number] {
  return [cellIndex(w, lo, axis), cellIndex(w, hi, axis)];
}

/** Номера коллайдеров вида `kind`, которые пересекают бокс (касание не считается). Без повторов. */
export function overlapping(w: World, box: AABB, out: number[] = [], kind: RayKind = "move"): number[] {
  out.length = 0;
  const [i0, i1] = cellSpan(w, box.min.x, box.max.x, "x");
  const [j0, j1] = cellSpan(w, box.min.z, box.max.z, "z");
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (const idx of w.cells[j * w.cols + i]!) {
        const c = w.colliders[idx]!;
        if (!blocks(c, kind) || out.includes(idx)) continue;
        if (overlaps(box, c.box, OVERLAP_EPS)) out.push(idx);
      }
    }
  }
  return out;
}

/** Свободен ли бокс от коллайдеров, которые держат движение. */
export function isFree(w: World, box: AABB): boolean {
  return overlapping(w, box).length === 0;
}

/** Первый объём вида `kind`, который пересекает бокс, или null. */
export function volumeAt(w: World, box: AABB, kind: VolumeKind): Volume | null {
  for (const v of w.volumes) if (v.kind === kind && overlaps(box, v.box)) return v;
  return null;
}
```

- [ ] **Step 5: Луч по сетке**

`packages/sim/src/raycast.ts`. Алгоритм Amanatides–Woo по клеткам XZ:
- луч обрезается прямоугольником сетки;
- в каждой клетке проверяются её боксы slab-тестом;
- обход останавливается, как только лучшее попадание ближе выхода из текущей клетки.

Бокс может лежать в нескольких клетках; повторная проверка дешевле отметок «уже проверен» и оставляет мир неизменяемым.
```ts
import type { AABB, Axis, RayKind, Vec3 } from "./types";
import { AXES, length, sub, vec3 } from "./vec";
import { blocks, type World } from "./world";

export interface RayHit {
  /** Расстояние от начала луча, м. 0 — луч начался внутри бокса. */
  dist: number;
  point: Vec3;
  /** Нормаль грани, в которую вошёл луч; (0, 0, 0), если луч начался внутри. */
  normal: Vec3;
  /** Номер коллайдера в world.colliders. */
  collider: number;
}

/** Счётчик для тестов: сколько боксов проверил луч. */
export interface RayStats {
  tested: number;
}

interface SlabHit {
  t: number;
  /** Ось грани входа; null — луч начался внутри бокса. */
  axis: Axis | null;
  sign: number;
}

/** Вход луча в бокс на отрезке [0, maxT] или null. Без выделения памяти: вызывается сотни раз за тик. */
function slab(o: Vec3, d: Vec3, b: AABB, maxT: number): SlabHit | null {
  let tNear = 0;
  let tFar = maxT;
  let axis: Axis | null = null;
  let sign = 0;
  for (let k = 0; k < 3; k++) {
    const a = AXES[k]!;
    const ok = o[a];
    const dk = d[a];
    if (dk === 0) {
      if (ok < b.min[a] || ok > b.max[a]) return null;
      continue;
    }
    let t0 = (b.min[a] - ok) / dk;
    let t1 = (b.max[a] - ok) / dk;
    let s = -1;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
      s = 1;
    }
    if (t0 > tNear) {
      tNear = t0;
      axis = a;
      sign = s;
    }
    if (t1 < tFar) tFar = t1;
    if (tNear > tFar) return null;
  }
  return { t: tNear, axis, sign };
}

/**
 * Луч по сетке мира (DDA по клеткам XZ, алгоритм Amanatides–Woo): проверяются только боксы в клетках,
 * через которые луч проходит. `dir` — единичный вектор. Возвращает ближайшее попадание не дальше maxDist.
 */
export function raycast(
  w: World,
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  kind: RayKind = "shot",
  stats?: RayStats,
): RayHit | null {
  // Обрезаем луч прямоугольником сетки по XZ.
  const gx1 = w.x0 + w.cols * w.cell;
  const gz1 = w.z0 + w.rows * w.cell;
  let tStart = 0;
  let tEnd = maxDist;
  for (const [o, d, lo, hi] of [
    [origin.x, dir.x, w.x0, gx1],
    [origin.z, dir.z, w.z0, gz1],
  ] as const) {
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tStart = Math.max(tStart, t0);
    tEnd = Math.min(tEnd, t1);
  }
  if (tStart > tEnd) return null;

  const px = origin.x + dir.x * tStart;
  const pz = origin.z + dir.z * tStart;
  let i = Math.min(w.cols - 1, Math.max(0, Math.floor((px - w.x0) / w.cell)));
  let j = Math.min(w.rows - 1, Math.max(0, Math.floor((pz - w.z0) / w.cell)));
  const stepI = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepJ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;
  const nextX = (cell: number) => w.x0 + (stepI > 0 ? cell + 1 : cell) * w.cell;
  const nextZ = (cell: number) => w.z0 + (stepJ > 0 ? cell + 1 : cell) * w.cell;
  let tMaxX = stepI === 0 ? Infinity : (nextX(i) - origin.x) / dir.x;
  let tMaxZ = stepJ === 0 ? Infinity : (nextZ(j) - origin.z) / dir.z;
  const tDeltaX = stepI === 0 ? Infinity : w.cell / Math.abs(dir.x);
  const tDeltaZ = stepJ === 0 ? Infinity : w.cell / Math.abs(dir.z);

  let best: RayHit | null = null;
  let bestT = maxDist;
  for (;;) {
    for (const idx of w.cells[j * w.cols + i]!) {
      const c = w.colliders[idx]!;
      if (!blocks(c, kind)) continue;
      if (stats) stats.tested++;
      const h = slab(origin, dir, c.box, bestT);
      if (!h || h.t > bestT || (best && h.t === bestT && idx > best.collider)) continue;
      bestT = h.t;
      const normal = vec3();
      if (h.axis) normal[h.axis] = h.sign;
      best = {
        dist: h.t,
        point: { x: origin.x + dir.x * h.t, y: origin.y + dir.y * h.t, z: origin.z + dir.z * h.t },
        normal,
        collider: idx,
      };
    }
    const cellExit = Math.min(tMaxX, tMaxZ);
    // Всё, что лежит дальше по лучу, начинается не ближе выхода из клетки: найденное попадание уже ближайшее.
    if ((best && bestT <= cellExit) || cellExit > tEnd) break;
    if (tMaxX < tMaxZ) {
      i += stepI;
      tMaxX += tDeltaX;
    } else {
      j += stepJ;
      tMaxZ += tDeltaZ;
    }
    if (i < 0 || j < 0 || i >= w.cols || j >= w.rows) break;
  }
  return best;
}

/** Видно ли точку b из точки a (луч вида "sight"). */
export function lineOfSight(w: World, a: Vec3, b: Vec3): boolean {
  const d = sub(b, a);
  const len = length(d);
  if (len < 1e-9) return true;
  const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
  return raycast(w, a, dir, len, "sight") === null;
}

/** Высота первой опоры под точкой не глубже maxDrop или null. */
export function groundBelow(w: World, p: Vec3, maxDrop = 50): number | null {
  const hit = raycast(w, p, { x: 0, y: -1, z: 0 }, maxDrop, "move");
  return hit ? hit.point.y : null;
}
```

`packages/sim/src/index.ts` (заменить целиком):
```ts
export * from "./types";
export * from "./vec";
export * from "./aabb";
export * from "./world";
export * from "./raycast";
```

- [ ] **Step 6: Убедиться, что тесты проходят, и проверить типы**

Run: `pnpm test packages/sim` и `pnpm --filter @doodlemagic/sim typecheck`
Expected: PASS — 3 + 11 + 8 = 22 теста в `packages/sim`; типы без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add packages/sim/src
git commit -m "feat(sim): vectors, AABB world in an XZ grid, DDA raycast" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Тело и шаг игрока

**Поток:** A (после задачи 2).

**Files:**
- Create: `packages/sim/src/body.ts`, `packages/sim/src/player.ts`
- Modify: `packages/sim/src/index.ts`
- Test: `packages/sim/src/body.test.ts`, `packages/sim/src/player.test.ts`

**Interfaces:**
- Consumes: `overlaps` (aabb.ts); `World`, `overlapping`, `createWorld`, `isFree` (world.ts); `clamp`, `cloneVec`, `vec3`, `lengthXZ` (vec.ts); типы и константы из `./types`.
- Produces (из `@doodlemagic/sim`):
  - `body.ts`:
    - `bodyBox(b: Body): AABB`;
    - `moveBody(w, b, dt, wasOnGround): MoveResult` — меняет `b.pos` и `b.vel`;
    - константы `MAX_SUBSTEPS = 8`, `GROUND_PROBE_M = 0.02`;
  - `player.ts`:
    - `DEFAULT_MOVE: MoveParams` (бег 6,5, разгон 60, торможение 50, в воздухе 0,6, гравитация 20, прыжок 1,25, койот 0,1 с, буфер 0,12 с, падение до 40 м/с);
    - `NO_INPUT: PlayerInput`;
    - `createPlayer(pos, yaw = 0): PlayerState`;
    - `forwardXZ(yaw)`;
    - `stepPlayer(state, input, dt, world, params = DEFAULT_MOVE): PlayerState` — новое состояние, старое не меняется;
    - `eyePosition(s): Vec3`.

- [ ] **Step 1: Написать падающие тесты**

`packages/sim/src/body.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { aabb } from "./aabb";
import { bodyBox, moveBody } from "./body";
import type { Body, Collider } from "./types";
import { vec3 } from "./vec";
import { createWorld, isFree } from "./world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({
  box: aabb(x0, y0, z0, x1, y1, z1),
});
const FLOOR = col(-50, -1, -50, 50, 0, 50);
const DT = 1 / 60;

function body(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): Body {
  return { pos: vec3(x, y, z), vel: vec3(vx, vy, vz), halfW: 0.4, height: 1.8, stepHeight: 0.55 };
}

/** Гоняет тело n тиков с постоянной горизонтальной скоростью и гравитацией 20 м/с². */
function run(b: Body, w: ReturnType<typeof createWorld>, ticks: number, vx: number, vz: number): boolean {
  let ground = false;
  for (let t = 0; t < ticks; t++) {
    b.vel.x = vx;
    b.vel.z = vz;
    b.vel.y -= 20 * DT;
    ground = moveBody(w, b, DT, ground).onGround;
  }
  return ground;
}

describe("moveBody", () => {
  it("falls and lands on the floor", () => {
    const w = createWorld([FLOOR]);
    const b = body(0, 2, 0, 0, -6, 0);
    let res = moveBody(w, b, DT, false);
    for (let t = 0; t < 60 && !res.onGround; t++) {
      b.vel.y -= 20 * DT;
      res = moveBody(w, b, DT, false);
    }
    expect(res.onGround).toBe(true);
    expect(res.landVel).toBeLessThan(-6);
    expect(b.pos.y).toBe(0);
    expect(b.vel.y).toBe(0);
  });

  it("stops at a wall and keeps sliding along it", () => {
    const w = createWorld([FLOOR, col(2, 0, -10, 3, 3, 10)]);
    const b = body(0, 0, 0);
    run(b, w, 60, 5, 3);
    expect(b.pos.x).toBeCloseTo(2 - 0.4, 6);
    expect(b.pos.z).toBeCloseTo(3, 1);
    expect(isFree(w, bodyBox(b))).toBe(true);
  });

  it("does not tunnel through a thin wall at high speed", () => {
    const w = createWorld([FLOOR, col(3, 0, -5, 3.1, 3, 5)]);
    const b = body(0, 0, 0);
    run(b, w, 10, 60, 0);
    expect(b.pos.x).toBeLessThanOrEqual(3 - 0.4 + 1e-9);
  });

  it("steps up a 0.4 m step but not a 0.6 m one", () => {
    const low = createWorld([FLOOR, col(1, 0, -5, 10, 0.4, 5)]);
    const a = body(0, 0, 0);
    expect(run(a, low, 60, 4, 0)).toBe(true);
    expect(a.pos.y).toBeCloseTo(0.4, 6);
    expect(a.pos.x).toBeGreaterThan(3);

    const high = createWorld([FLOOR, col(1, 0, -5, 10, 0.6, 5)]);
    const b = body(0, 0, 0);
    run(b, high, 60, 4, 0);
    expect(b.pos.y).toBe(0);
    expect(b.pos.x).toBeCloseTo(1 - 0.4, 6);
  });

  it("does not step up while airborne", () => {
    const w = createWorld([FLOOR, col(1, 0, -5, 10, 0.4, 5)]);
    const b = body(0, 0.1, 0, 4, 0, 0);
    const res = moveBody(w, b, 0.2, false);
    expect(res.stepped).toBe(false);
    expect(b.pos.x).toBeCloseTo(1 - 0.4, 6);
  });

  it("stays on the ground walking down stairs and falls off a high ledge", () => {
    const steps: Collider[] = [FLOOR];
    for (let i = 0; i < 5; i++) steps.push(col(i, 0, -5, i + 1, 2 - 0.4 * i, 5));
    const w = createWorld(steps);
    const b = body(0.5, 2, 0);
    let ground = true;
    let airborneTicks = 0;
    for (let t = 0; t < 90; t++) {
      b.vel.x = 4;
      b.vel.y -= 20 * DT;
      ground = moveBody(w, b, DT, ground).onGround;
      if (!ground) airborneTicks++;
    }
    expect(b.pos.x).toBeGreaterThan(5);
    expect(b.pos.y).toBe(0);
    expect(airborneTicks).toBe(0);

    const ledge = createWorld([FLOOR, col(-5, 0, -5, 1, 2, 5)]);
    const c = body(0, 2, 0);
    let g = true;
    let wasAirborne = false;
    for (let t = 0; t < 60; t++) {
      c.vel.x = 4;
      c.vel.y -= 20 * DT;
      g = moveBody(ledge, c, DT, g).onGround;
      if (!g) wasAirborne = true;
    }
    expect(wasAirborne).toBe(true);
    expect(c.pos.y).toBe(0);
  });

  it("stops upward motion at a ceiling", () => {
    const w = createWorld([FLOOR, col(-5, 2.5, -5, 5, 3, 5)]);
    const b = body(0, 0, 0, 0, 8, 0);
    const res = moveBody(w, b, 0.2, false);
    expect(res.hitCeiling).toBe(true);
    expect(b.pos.y).toBeCloseTo(2.5 - 1.8, 9);
    expect(b.vel.y).toBe(0);
  });

  it("stops in a corner on both axes", () => {
    const w = createWorld([FLOOR, col(2, 0, -10, 3, 3, 10), col(-10, 0, 2, 10, 3, 3)]);
    const b = body(0, 0, 0);
    run(b, w, 60, 4, 4);
    expect(b.pos.x).toBeCloseTo(1.6, 6);
    expect(b.pos.z).toBeCloseTo(1.6, 6);
  });

  it("can walk out of a box it is stuck in", () => {
    const w = createWorld([FLOOR, col(-1, 0, -1, 1, 3, 1)]);
    const b = body(0.5, 0, 0);
    run(b, w, 60, 4, 0);
    expect(b.pos.x).toBeGreaterThan(1.4);
    expect(isFree(w, bodyBox(b))).toBe(true);
  });
});
```

`packages/sim/src/player.test.ts`. Состояния сравниваются через `JSON.stringify`: JSON печатает кратчайшую запись числа, которая читается в тот же double, поэтому равенство строк — это равенство до бита (кроме знака нуля):
```ts
import { describe, expect, it } from "vitest";
import { aabb } from "./aabb";
import { DEFAULT_MOVE, NO_INPUT, createPlayer, eyePosition, stepPlayer } from "./player";
import { TICK_DT, type Collider, type PlayerInput, type PlayerState, type Volume } from "./types";
import { lengthXZ, vec3 } from "./vec";
import { createWorld, type World } from "./world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({
  box: aabb(x0, y0, z0, x1, y1, z1),
});
const flat = createWorld([col(-100, -1, -100, 100, 0, 100)]);

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { ...NO_INPUT, ...over };
}

function settle(world: World = flat, x = 0, z = 0): PlayerState {
  let s = createPlayer(vec3(x, 0, z));
  for (let t = 0; t < 5; t++) s = stepPlayer(s, NO_INPUT, TICK_DT, world);
  return s;
}

function runTicks(s: PlayerState, inp: PlayerInput, ticks: number, world: World = flat): PlayerState {
  for (let t = 0; t < ticks; t++) s = stepPlayer(s, inp, TICK_DT, world);
  return s;
}

describe("stepPlayer on flat ground", () => {
  it("stands still and stays on the ground", () => {
    const s = runTicks(settle(), NO_INPUT, 120);
    expect(s.onGround).toBe(true);
    expect(s.body.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("does not change the state it was given", () => {
    const s = settle();
    const before = JSON.stringify(s);
    stepPlayer(s, input({ moveZ: 1, jump: true }), TICK_DT, flat);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("runs forward along -Z at 6.5 m/s and reaches full speed within 0.15 s", () => {
    const s = runTicks(settle(), input({ moveZ: 1 }), 9);
    expect(lengthXZ(s.body.vel)).toBeCloseTo(DEFAULT_MOVE.runSpeed, 6);
    expect(s.body.vel.z).toBeCloseTo(-6.5, 6);
    const later = runTicks(s, input({ moveZ: 1 }), 60);
    expect(later.body.pos.z).toBeLessThan(-6);
  });

  it("turns with yaw: yaw = +90° runs along -X, strafe right runs along +X at yaw 0", () => {
    expect(runTicks(settle(), input({ moveZ: 1, yaw: Math.PI / 2 }), 30).body.vel.x).toBeCloseTo(-6.5, 6);
    expect(runTicks(settle(), input({ moveX: 1 }), 30).body.vel.x).toBeCloseTo(6.5, 6);
  });

  it("normalizes diagonal input", () => {
    const s = runTicks(settle(), input({ moveX: 1, moveZ: 1 }), 30);
    expect(lengthXZ(s.body.vel)).toBeCloseTo(6.5, 6);
  });

  it("stops when the keys are released", () => {
    const running = runTicks(settle(), input({ moveZ: 1 }), 30);
    const stopped = runTicks(running, NO_INPUT, 12);
    expect(lengthXZ(stopped.body.vel)).toBe(0);
  });
});

describe("jumping", () => {
  it("peaks at 1.25 m", () => {
    let s = stepPlayer(settle(), input({ jump: true }), TICK_DT, flat);
    let apex = 0;
    for (let t = 0; t < 60; t++) {
      s = stepPlayer(s, input({ jump: true }), TICK_DT, flat);
      apex = Math.max(apex, s.body.pos.y);
    }
    expect(apex).toBeGreaterThan(1.24);
    expect(apex).toBeLessThanOrEqual(1.25 + 1e-9);
    expect(s.onGround).toBe(true);
  });

  it("jumps once per press: holding the key does not bounce", () => {
    let s = settle();
    let takeoffs = 0;
    for (let t = 0; t < 180; t++) {
      const before = s.onGround;
      s = stepPlayer(s, input({ jump: true }), TICK_DT, flat);
      if (before && s.body.vel.y > 0) takeoffs++;
    }
    expect(takeoffs).toBe(1);
  });

  it("has no double jump", () => {
    let s = stepPlayer(settle(), input({ jump: true }), TICK_DT, flat);
    s = runTicks(s, NO_INPUT, 10);
    const vyBefore = s.body.vel.y;
    s = stepPlayer(s, input({ jump: true }), TICK_DT, flat);
    expect(s.body.vel.y).toBeLessThan(vyBefore);
  });

  it("allows a jump shortly after walking off a ledge (coyote time) but not later", () => {
    const ledge = createWorld([col(-100, -11, -100, 100, -10, 100), col(-10, -1, -10, 0, 0, 10)]);
    const walkOff = (lateTicks: number): number => {
      let s = settle(ledge, -1, 0);
      while (s.onGround) s = stepPlayer(s, input({ moveX: 1 }), TICK_DT, ledge);
      s = runTicks(s, input({ moveX: 1 }), lateTicks, ledge);
      s = stepPlayer(s, input({ moveX: 1, jump: true }), TICK_DT, ledge);
      return s.body.vel.y;
    };
    expect(walkOff(3)).toBeGreaterThan(5);
    expect(walkOff(12)).toBeLessThan(0);
  });

  it("buffers a jump pressed just before landing", () => {
    const fallThenPress = (pressTicksBeforeLanding: number): boolean => {
      // падаем с 3 м и считаем, за сколько тиков долетим
      let probe = createPlayer(vec3(0, 3, 0));
      let ticks = 0;
      while (!probe.onGround) {
        probe = stepPlayer(probe, NO_INPUT, TICK_DT, flat);
        ticks++;
      }
      let s = createPlayer(vec3(0, 3, 0));
      for (let t = 0; t < ticks + 2; t++) {
        const press = t === ticks - pressTicksBeforeLanding;
        s = stepPlayer(s, input({ jump: press }), TICK_DT, flat);
      }
      return s.body.vel.y > 0;
    };
    expect(fallThenPress(4)).toBe(true);
    expect(fallThenPress(15)).toBe(false);
  });
});

describe("air control", () => {
  it("accelerates at 60 % of the ground rate in the air", () => {
    const ground = stepPlayer(settle(), input({ moveZ: 1 }), TICK_DT, flat);
    const air = stepPlayer(createPlayer(vec3(0, 5, 0)), input({ moveZ: 1 }), TICK_DT, flat);
    expect(lengthXZ(air.body.vel) / lengthXZ(ground.body.vel)).toBeCloseTo(0.6, 9);
  });

  it("keeps momentum in the air without input", () => {
    let s = runTicks(settle(), input({ moveZ: 1 }), 30);
    s = stepPlayer(s, input({ moveZ: 1, jump: true }), TICK_DT, flat);
    s = runTicks(s, NO_INPUT, 10);
    expect(s.onGround).toBe(false);
    expect(lengthXZ(s.body.vel)).toBeCloseTo(6.5, 6);
  });
});

describe("updraft", () => {
  it("lifts the player to the height of the stream", () => {
    const up: Volume = { kind: "updraft", box: aabb(-1, 0, -1, 1, 1, 1), liftM: 6 };
    const w = createWorld([col(-100, -1, -100, 100, 0, 100)], [up]);
    let s = settle(w);
    let apex = 0;
    for (let t = 0; t < 120; t++) {
      s = stepPlayer(s, NO_INPUT, TICK_DT, w);
      apex = Math.max(apex, s.body.pos.y);
    }
    expect(apex).toBeGreaterThan(5.9);
    expect(apex).toBeLessThan(6.2);
  });
});

describe("determinism", () => {
  const script = (t: number): PlayerInput => ({
    moveX: Math.round(Math.sin(t * 0.05)),
    moveZ: t % 200 < 150 ? 1 : -1,
    jump: t % 47 < 3,
    yaw: t * 0.013,
    pitch: Math.sin(t * 0.02) * 0.4,
  });
  const world = createWorld([
    col(-100, -1, -100, 100, 0, 100),
    col(3, 0, -20, 4, 1, 20),
    col(-6, 0, -6, -4, 0.4, 6),
    col(-15, 0, 5, 15, 3, 6),
  ]);

  // JSON печатает кратчайшую запись числа, которая читается обратно в тот же double,
  // поэтому равенство строк — это равенство всех чисел до бита (кроме знака нуля).
  it("gives bit-identical results for the same inputs, also after a JSON round trip", () => {
    let a = createPlayer(vec3(0, 0, 0));
    let b = createPlayer(vec3(0, 0, 0));
    for (let t = 0; t < 1200; t++) {
      a = stepPlayer(a, script(t), TICK_DT, world);
      b = stepPlayer(JSON.parse(JSON.stringify(b)) as PlayerState, script(t), TICK_DT, world);
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(eyePosition(a).y).toBeCloseTo(a.body.pos.y + 1.6, 12);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test packages/sim`
Expected: FAIL — `Failed to resolve import "./body"` и `"./player"`.

- [ ] **Step 3: Тело**

`packages/sim/src/body.ts`. Как это устроено:
- шаг делится на подшаги не длиннее `halfW / 2`;
- каждый подшаг идёт по осям X, потом Z, потом Y;
- на оси учитываются только боксы, которые до сдвига были впереди, — из застрявшего бокса можно выйти;
- если тело упёрлось, стоя на земле, оно пробует подняться на 0,55 м, сдвинуться и опуститься;
- на спуске тело прилипает к ступени, а не взлетает.
```ts
import type { AABB, Body, MoveResult } from "./types";
import { overlapping, type World } from "./world";

export const MAX_SUBSTEPS = 8;
/** Насколько глубоко ниже подошвы ищем опору, чтобы считать тело стоящим, м. */
export const GROUND_PROBE_M = 0.02;
/** Бокс считается «впереди», если его грань не дальше этого от тела до сдвига, м. */
const AHEAD_TOL = 1e-4;

export function bodyBox(b: Body): AABB {
  return {
    min: { x: b.pos.x - b.halfW, y: b.pos.y, z: b.pos.z - b.halfW },
    max: { x: b.pos.x + b.halfW, y: b.pos.y + b.height, z: b.pos.z + b.halfW },
  };
}

const scratch: number[] = [];

/**
 * Сдвиг по одной оси с упором в первый бокс на пути. Учитываются только боксы, которые до сдвига были
 * впереди: из бокса, в котором тело уже застряло, можно выйти. Возвращает true, если упёрлись.
 */
function sweepAxis(w: World, b: Body, axis: "x" | "y" | "z", d: number): boolean {
  if (d === 0) return false;
  const lo = axis === "y" ? 0 : b.halfW;
  const hi = axis === "y" ? b.height : b.halfW;
  const beforeMin = b.pos[axis] - lo;
  const beforeMax = b.pos[axis] + hi;
  b.pos[axis] += d;
  let limit = b.pos[axis];
  let blocked = false;
  for (const idx of overlapping(w, bodyBox(b), scratch)) {
    const box = w.colliders[idx]!.box;
    if (d > 0 && box.min[axis] >= beforeMax - AHEAD_TOL) {
      const p = box.min[axis] - hi;
      if (p < limit) {
        limit = p;
        blocked = true;
      }
    } else if (d < 0 && box.max[axis] <= beforeMin + AHEAD_TOL) {
      const p = box.max[axis] + lo;
      if (p > limit) {
        limit = p;
        blocked = true;
      }
    }
  }
  b.pos[axis] = limit;
  return blocked;
}

/** Есть ли опора прямо под подошвой. */
function supported(w: World, b: Body): boolean {
  const box = bodyBox(b);
  box.min.y -= GROUND_PROBE_M;
  box.max.y = b.pos.y;
  return overlapping(w, box, scratch).length > 0;
}

interface HorizResult {
  blockedX: boolean;
  blockedZ: boolean;
  stepped: boolean;
}

/** Сначала X, потом Z. Если упёрлись, стоя на земле, пробуем зайти на ступеньку: подняться, сдвинуться, опуститься. */
function moveHorizontal(w: World, b: Body, dx: number, dz: number, canStep: boolean): HorizResult {
  const sx = b.pos.x;
  const sy = b.pos.y;
  const sz = b.pos.z;
  const blockedX = sweepAxis(w, b, "x", dx);
  const blockedZ = sweepAxis(w, b, "z", dz);
  const flat: HorizResult = { blockedX, blockedZ, stepped: false };
  if (!(blockedX || blockedZ) || !canStep || b.stepHeight <= 0) return flat;

  const fx = b.pos.x;
  const fz = b.pos.z;
  const flatDist2 = (fx - sx) ** 2 + (fz - sz) ** 2;
  b.pos.x = sx;
  b.pos.z = sz;
  sweepAxis(w, b, "y", b.stepHeight);
  const lifted = b.pos.y - sy;
  if (lifted > 1e-6) {
    const sbx = sweepAxis(w, b, "x", dx);
    const sbz = sweepAxis(w, b, "z", dz);
    sweepAxis(w, b, "y", -lifted);
    const stepDist2 = (b.pos.x - sx) ** 2 + (b.pos.z - sz) ** 2;
    if (stepDist2 > flatDist2 + 1e-8 && b.pos.y >= sy - 1e-6) {
      return { blockedX: sbx, blockedZ: sbz, stepped: b.pos.y > sy + 1e-6 };
    }
  }
  b.pos.x = fx;
  b.pos.y = sy;
  b.pos.z = fz;
  return flat;
}

/**
 * Сдвигает тело на vel·dt с коллизиями: поосно X → Z → Y, с заходом на ступеньки и прилипанием к земле
 * на спуске. Шаг делится на подшаги не длиннее halfW/2, поэтому тело не проскакивает тонкие стены.
 * Меняет body.pos и body.vel (заблокированные составляющие скорости обнуляются).
 */
export function moveBody(w: World, b: Body, dt: number, wasOnGround: boolean): MoveResult {
  const speed = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vel.z * b.vel.z);
  const maxStep = Math.max(0.05, b.halfW * 0.5);
  const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speed * dt) / maxStep)));
  const h = dt / n;
  const res: MoveResult = { onGround: wasOnGround, hitWall: false, hitCeiling: false, landVel: 0, stepped: false };
  let grounded = wasOnGround;
  for (let s = 0; s < n; s++) {
    const hz = moveHorizontal(w, b, b.vel.x * h, b.vel.z * h, grounded);
    if (hz.blockedX) b.vel.x = 0;
    if (hz.blockedZ) b.vel.z = 0;
    if (hz.blockedX || hz.blockedZ) res.hitWall = true;
    if (hz.stepped) res.stepped = true;

    const dy = b.vel.y * h;
    const hitY = sweepAxis(w, b, "y", dy);
    let onGround = false;
    if (hitY && dy < 0) {
      onGround = true;
      if (!grounded) res.landVel = Math.min(res.landVel, b.vel.y);
      b.vel.y = 0;
    } else if (hitY && dy > 0) {
      res.hitCeiling = true;
      b.vel.y = 0;
    } else if (b.vel.y <= 0 && supported(w, b)) {
      onGround = true;
    } else if (grounded && b.vel.y <= 0 && b.stepHeight > 0) {
      // Прилипание: сошли со ступеньки вниз — опускаемся на неё, а не летим.
      const y0 = b.pos.y;
      if (sweepAxis(w, b, "y", -b.stepHeight)) {
        onGround = true;
        b.vel.y = 0;
      } else {
        b.pos.y = y0;
      }
    }
    grounded = onGround;
  }
  res.onGround = grounded;
  return res;
}
```

- [ ] **Step 4: Шаг игрока**

`packages/sim/src/player.ts`:
```ts
import { overlaps } from "./aabb";
import { bodyBox, moveBody } from "./body";
import {
  EYE_HEIGHT,
  PLAYER_HALF_W,
  PLAYER_HEIGHT,
  PLAYER_STEP,
  type Body,
  type MoveParams,
  type PlayerInput,
  type PlayerState,
  type Vec3,
} from "./types";
import { clamp, cloneVec } from "./vec";
import type { World } from "./world";

export const DEFAULT_MOVE: MoveParams = {
  runSpeed: 6.5,
  groundAccel: 60,
  groundDecel: 50,
  airControl: 0.6,
  gravity: 20,
  jumpHeight: 1.25,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  maxFallSpeed: 40,
};

const MAX_PITCH = Math.PI / 2 - 0.01;

export const NO_INPUT: PlayerInput = { moveX: 0, moveZ: 0, jump: false, yaw: 0, pitch: 0 };

export function createPlayer(pos: Vec3, yaw = 0): PlayerState {
  return {
    body: {
      pos: cloneVec(pos),
      vel: { x: 0, y: 0, z: 0 },
      halfW: PLAYER_HALF_W,
      height: PLAYER_HEIGHT,
      stepHeight: PLAYER_STEP,
    },
    onGround: false,
    coyote: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    yaw,
    pitch: 0,
    landVel: 0,
  };
}

/** Взгляд вдоль −Z при yaw = 0; положительный yaw поворачивает влево. */
export function forwardXZ(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Горизонтальная скорость к цели не быстрее maxDelta за шаг. */
function approachXZ(v: Vec3, tx: number, tz: number, maxDelta: number): void {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= maxDelta || d === 0) {
    v.x = tx;
    v.z = tz;
  } else {
    v.x += (dx / d) * maxDelta;
    v.z += (dz / d) * maxDelta;
  }
}

/**
 * Один тик движения игрока. Детерминирован: результат зависит только от аргументов
 * (нет Math.random, часов и общего состояния), поэтому хост и клиент считают одно и то же.
 * Возвращает новое состояние, исходное не меняет.
 */
export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  dt: number,
  world: World,
  p: MoveParams = DEFAULT_MOVE,
): PlayerState {
  const body: Body = { ...state.body, pos: cloneVec(state.body.pos), vel: cloneVec(state.body.vel) };

  const pressed = input.jump && !state.jumpHeld;
  let jumpBuffer = pressed ? p.jumpBufferTime : Math.max(0, state.jumpBuffer - dt);
  let coyote = state.onGround ? p.coyoteTime : Math.max(0, state.coyote - dt);

  // Желаемая скорость из ввода и поворота.
  let ix = clamp(input.moveX, -1, 1);
  let iz = clamp(input.moveZ, -1, 1);
  const il = Math.sqrt(ix * ix + iz * iz);
  if (il > 1) {
    ix /= il;
    iz /= il;
  }
  const f = forwardXZ(input.yaw);
  // вправо = вперёд, повёрнутый на −90°: (−f.z, f.x)
  const wx = (f.x * iz - f.z * ix) * p.runSpeed;
  const wz = (f.z * iz + f.x * ix) * p.runSpeed;
  const hasInput = il > 1e-6;
  if (state.onGround) approachXZ(body.vel, wx, wz, (hasInput ? p.groundAccel : p.groundDecel) * dt);
  else if (hasInput) approachXZ(body.vel, wx, wz, p.groundAccel * p.airControl * dt);

  let onGround = state.onGround;
  if (jumpBuffer > 0 && (onGround || coyote > 0)) {
    body.vel.y = Math.sqrt(2 * p.gravity * p.jumpHeight);
    jumpBuffer = 0;
    coyote = 0;
    onGround = false;
  }

  // Поток задаёт скорость, с которой баллистика донесёт ровно до его высоты.
  const box = bodyBox(body);
  for (const v of world.volumes) {
    if (v.kind !== "updraft" || !overlaps(box, v.box)) continue;
    const rise = v.box.min.y + (v.liftM ?? 0) - body.pos.y;
    if (rise > 0) body.vel.y = Math.max(body.vel.y, Math.sqrt(2 * p.gravity * rise));
  }

  // Гравитация по трапеции: средняя скорость за тик даёт ровно ту высоту прыжка, что в параметрах, при любом тике.
  const vy0 = body.vel.y;
  const vy1 = Math.max(-p.maxFallSpeed, vy0 - p.gravity * dt);
  body.vel.y = (vy0 + vy1) / 2;

  const r = moveBody(world, body, dt, onGround);
  body.vel.y = r.onGround || r.hitCeiling ? 0 : vy1;

  return {
    body,
    onGround: r.onGround,
    coyote,
    jumpBuffer,
    jumpHeld: input.jump,
    yaw: input.yaw,
    pitch: clamp(input.pitch, -MAX_PITCH, MAX_PITCH),
    landVel: r.landVel,
  };
}

/** Позиция глаз для камеры. */
export function eyePosition(s: PlayerState): Vec3 {
  return { x: s.body.pos.x, y: s.body.pos.y + EYE_HEIGHT, z: s.body.pos.z };
}
```

`packages/sim/src/index.ts` (заменить целиком):
```ts
export * from "./types";
export * from "./vec";
export * from "./aabb";
export * from "./world";
export * from "./raycast";
export * from "./body";
export * from "./player";
```

- [ ] **Step 5: Убедиться, что тесты проходят, и проверить типы**

Run: `pnpm test packages/sim` и `pnpm --filter @doodlemagic/sim typecheck`
Expected: PASS — 22 + 9 + 15 = 46 тестов в `packages/sim`; типы без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add packages/sim/src
git commit -m "feat(sim): character body and deterministic stepPlayer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: DSL арены

**Поток:** B (первая задача потока). Из `@doodlemagic/sim` берутся только типы задачи 1: луч и пересечения у потока B свои, в `geom.ts`.

**Files:**
- Create: `packages/arena/src/geom.ts`, `packages/arena/src/dsl.ts`
- Modify: `packages/arena/src/index.ts`
- Test: `packages/arena/src/dsl.test.ts`

**Interfaces:**
- Consumes: типы `AABB`, `ArenaData`, `ArenaVariant`, `Collider`, `Material`, `Pickup`, `PickupKind`, `RenderBox`, `Spawn`, `Vec3`, `Volume`, `VolumeKind` (задача 1).
- Produces:
  - `geom.ts` (внутренний модуль пакета, для DSL и тестов):
    - `box(x0, y0, z0, x1, y1, z1): AABB`, `clipBox(a, b)`, `boxesOverlap(a, b, eps?)`;
    - `pointInBox`, `boxInBox(outer, inner)`;
    - `rayBox(o, dir, b, maxDist)`;
    - `sightDistance(colliders, o, dir, maxDist)`, `canSee(colliders, a, b)`;
    - `floorBelow(colliders, p, maxDrop?)`;
  - из `@doodlemagic/arena`:
    - типы `BoxOpts { material?; collide?; render?; noShoot?; noSight?; tag? }`, `SlabOpts { depth? }`;
    - `Opening { from; to; sill?; top? }`;
    - `WallOpts { y0?; height; thick; openings? }`;
    - `StairDir`, `StairsOpts { x0; z0; x1; z1; y0; y1; dir; steps }`;
    - `ArenaBuilder` с методами `box`, `slab`, `wallX(z, x0, x1, o)`, `wallZ(x, z0, z1, o)`, `stairs`, `volume(kind, x0, y0, z0, x1, y1, z1, liftM?)`, `spawn(x, y, z, yaw)`, `pickup(kind, x, y, z)`, `mirror(build)`, `finish(name, variant, bounds): ArenaData`;
    - `createArenaBuilder()`;
    - `wallPieces(a, b, height, openings)`;
    - `wrapAngle(a)`;
    - `clipArena(a, bounds, variant): ArenaData`.

- [ ] **Step 1: Написать падающий тест**

`packages/arena/src/dsl.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { clipArena, createArenaBuilder, wallPieces, wrapAngle } from "./dsl";
import { box } from "./geom";

const BOUNDS = box(-50, -20, -50, 50, 20, 50);

describe("box and slab", () => {
  it("adds a collider and a render box with material and flags", () => {
    const b = createArenaBuilder();
    b.box(0, 0, 0, 2, 1, 3, { material: "gold", tag: "rune", noShoot: true });
    b.slab(-5, -5, 5, 5, 0, { material: "floor", depth: 1 });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders).toEqual([
      { box: box(0, 0, 0, 2, 1, 3), noShoot: true, tag: "rune" },
      { box: box(-5, -1, -5, 5, 0, 5) },
    ]);
    expect(a.render.map((r) => r.material)).toEqual(["gold", "floor"]);
  });

  it("can make render-only and collision-only boxes", () => {
    const b = createArenaBuilder();
    b.box(0, 0, 0, 1, 1, 1, { collide: false });
    b.box(0, 0, 0, 1, 1, 1, { render: false });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders).toHaveLength(1);
    expect(a.render).toHaveLength(1);
  });
});

describe("wallPieces", () => {
  it("leaves a full wall without openings", () => {
    expect(wallPieces(0, 10, 3, [])).toEqual([{ u0: 0, u1: 10, v0: 0, v1: 3 }]);
  });

  it("cuts a door with a lintel and a window with a sill", () => {
    const pieces = wallPieces(0, 10, 3, [
      { from: 2, to: 4, top: 2.2 },
      { from: 6, to: 8, sill: 1, top: 2 },
    ]);
    expect(pieces).toEqual([
      { u0: 0, u1: 2, v0: 0, v1: 3 },
      { u0: 2, u1: 4, v0: 2.2, v1: 3 },
      { u0: 4, u1: 6, v0: 0, v1: 3 },
      { u0: 6, u1: 8, v0: 0, v1: 1 },
      { u0: 6, u1: 8, v0: 2, v1: 3 },
      { u0: 8, u1: 10, v0: 0, v1: 3 },
    ]);
  });

  it("drops a fully open span and clamps openings to the wall", () => {
    expect(wallPieces(0, 4, 3, [{ from: -1, to: 2 }])).toEqual([{ u0: 2, u1: 4, v0: 0, v1: 3 }]);
  });
});

describe("walls", () => {
  it("builds wallX around its z axis and wallZ around its x axis", () => {
    const b = createArenaBuilder();
    b.wallX(5, 0, 4, { height: 3, thick: 0.4, openings: [{ from: 1, to: 3, top: 2 }] });
    b.wallZ(-2, 0, 6, { height: 2, thick: 1, y0: 4 });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders.map((c) => c.box)).toEqual([
      box(0, 0, 4.8, 1, 3, 5.2),
      box(1, 2, 4.8, 3, 3, 5.2),
      box(3, 0, 4.8, 4, 3, 5.2),
      box(-2.5, 4, 0, -1.5, 6, 6),
    ]);
  });
});

describe("stairs", () => {
  it("builds solid steps rising in the given direction", () => {
    const b = createArenaBuilder();
    b.stairs({ x0: 0, z0: 0, x1: 2, z1: 2, y0: 0, y1: 1, dir: "-z", steps: 4 });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders.map((c) => c.box)).toEqual([
      box(0, 0, 1.5, 2, 0.25, 2),
      box(0, 0, 1, 2, 0.5, 1.5),
      box(0, 0, 0.5, 2, 0.75, 1),
      box(0, 0, 0, 2, 1, 0.5),
    ]);
    expect(a.colliders.every((c) => c.tag === "stairs")).toBe(true);
  });

  it("supports +x stairs", () => {
    const b = createArenaBuilder();
    b.stairs({ x0: 0, z0: 0, x1: 1, z1: 3, y0: 1, y1: 2, dir: "+x", steps: 2 });
    expect(b.finish("t", "full", BOUNDS).colliders.map((c) => c.box)).toEqual([box(0, 1, 0, 0.5, 1.5, 3), box(0.5, 1, 0, 1, 2, 3)]);
  });
});

describe("mirror", () => {
  it("repeats the half with z negated, including spawns, pickups and volumes", () => {
    const b = createArenaBuilder();
    b.mirror(() => {
      b.box(1, 0, -6, 2, 1, -4);
      b.stairs({ x0: 0, z0: -3, x1: 1, z1: -1, y0: 0, y1: 1, dir: "+z", steps: 2 });
      b.volume("updraft", 0, 0, -3, 1, 1, -2, 6);
      b.spawn(3, 0, -10, -Math.PI / 2);
      b.spawn(0, 0, -10, 0);
      b.pickup("orb", 1, 0.5, -7);
    });
    const a = b.finish("t", "full", BOUNDS);
    expect(a.colliders.map((c) => c.box)).toEqual([
      box(1, 0, -6, 2, 1, -4),
      box(0, 0, -3, 1, 0.5, -2),
      box(0, 0, -2, 1, 1, -1),
      box(1, 0, 4, 2, 1, 6),
      box(0, 0, 2, 1, 0.5, 3),
      box(0, 0, 1, 1, 1, 2),
    ]);
    expect(a.volumes[1]).toEqual({ kind: "updraft", box: box(0, 0, 2, 1, 1, 3), liftM: 6 });
    expect(a.spawns[2]!.pos).toEqual({ x: 3, y: 0, z: 10 });
    expect(a.spawns[2]!.yaw).toBeCloseTo(-Math.PI / 2, 12);
    // смотрел на −Z (yaw 0) — в зеркале смотрит на +Z (yaw π)
    expect(a.spawns[3]!.yaw).toBeCloseTo(Math.PI, 12);
    expect(a.pickups[1]!.pos).toEqual({ x: 1, y: 0.5, z: 7 });
  });

  it("refuses nested mirrors", () => {
    const b = createArenaBuilder();
    expect(() => b.mirror(() => b.mirror(() => undefined))).toThrow();
  });
});

describe("wrapAngle", () => {
  it("keeps angles in (−π, π]", () => {
    expect(wrapAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe("clipArena", () => {
  it("cuts boxes and volumes and drops points outside", () => {
    const b = createArenaBuilder();
    b.box(-20, 0, -1, 20, 1, 1);
    b.box(17, 0, -1, 19, 1, 1);
    b.volume("grass", 10, 0, -2, 18, 1, 2);
    b.spawn(0, 0, 0, 0);
    b.spawn(16, 0, 0, 0);
    const a = clipArena(b.finish("t", "full", BOUNDS), box(-15, -20, -18, 15, 20, 18), "compact");
    expect(a.variant).toBe("compact");
    expect(a.colliders.map((c) => c.box)).toEqual([box(-15, 0, -1, 15, 1, 1)]);
    expect(a.volumes[0]!.box).toEqual(box(10, 0, -2, 15, 1, 2));
    expect(a.spawns).toHaveLength(1);
  });

  it("produces plain data that survives JSON", () => {
    const b = createArenaBuilder();
    b.box(0, 0, 0, 1, 1, 1, { tag: "x" });
    b.spawn(0, 0, 0, 1);
    const a = b.finish("t", "full", BOUNDS);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm test packages/arena`
Expected: FAIL — `Failed to resolve import "./dsl"`.

- [ ] **Step 3: Геометрия и DSL**

`packages/arena/src/geom.ts`:
```ts
import type { AABB, Collider, Vec3 } from "@doodlemagic/sim";

/**
 * Мини-геометрия арены. Поток B не зависит от физики потока A: здесь только то, что нужно DSL и
 * тестам инвариантов. Лучи — перебором всех боксов: для проверки одной арены этого достаточно.
 */

export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB {
  return {
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
  };
}

/** Пересечение боксов или null, если объём нулевой. */
export function clipBox(a: AABB, b: AABB): AABB | null {
  const x0 = Math.max(a.min.x, b.min.x);
  const y0 = Math.max(a.min.y, b.min.y);
  const z0 = Math.max(a.min.z, b.min.z);
  const x1 = Math.min(a.max.x, b.max.x);
  const y1 = Math.min(a.max.y, b.max.y);
  const z1 = Math.min(a.max.z, b.max.z);
  return x0 < x1 && y0 < y1 && z0 < z1 ? box(x0, y0, z0, x1, y1, z1) : null;
}

/** Пересекаются ли боксы; касание гранями не считается. */
export function boxesOverlap(a: AABB, b: AABB, eps = 1e-6): boolean {
  return (
    a.min.x < b.max.x - eps &&
    a.max.x > b.min.x + eps &&
    a.min.y < b.max.y - eps &&
    a.max.y > b.min.y + eps &&
    a.min.z < b.max.z - eps &&
    a.max.z > b.min.z + eps
  );
}

export function pointInBox(b: AABB, p: Vec3): boolean {
  return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
}

export function boxInBox(outer: AABB, inner: AABB): boolean {
  return pointInBox(outer, inner.min) && pointInBox(outer, inner.max);
}

/** Расстояние до входа луча в бокс или null. dir — единичный вектор. */
export function rayBox(o: Vec3, dir: Vec3, b: AABB, maxDist: number): number | null {
  let tNear = 0;
  let tFar = maxDist;
  for (const a of ["x", "y", "z"] as const) {
    if (dir[a] === 0) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return null;
      continue;
    }
    const t0 = (b.min[a] - o[a]) / dir[a];
    const t1 = (b.max[a] - o[a]) / dir[a];
    tNear = Math.max(tNear, Math.min(t0, t1));
    tFar = Math.min(tFar, Math.max(t0, t1));
    if (tNear > tFar) return null;
  }
  return tNear;
}

/** Ближайшее попадание луча по коллайдерам, которые закрывают обзор (всё, кроме noShoot), перебором. */
export function sightDistance(colliders: readonly Collider[], o: Vec3, dir: Vec3, maxDist: number): number | null {
  let best: number | null = null;
  for (const c of colliders) {
    if (c.noShoot) continue;
    const t = rayBox(o, dir, c.box, best ?? maxDist);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Видно ли точку b из точки a. */
export function canSee(colliders: readonly Collider[], a: Vec3, b: Vec3): boolean {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
  if (len < 1e-9) return true;
  return sightDistance(colliders, a, { x: d.x / len, y: d.y / len, z: d.z / len }, len) === null;
}

/** Верх первой опоры под точкой (по коллайдерам, которые держат движение) или null. */
export function floorBelow(colliders: readonly Collider[], p: Vec3, maxDrop = 50): number | null {
  let best: number | null = null;
  for (const c of colliders) {
    if (c.noSight) continue;
    const t = rayBox(p, { x: 0, y: -1, z: 0 }, c.box, maxDrop);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best === null ? null : p.y - best;
}
```

`packages/arena/src/dsl.ts`. Как это устроено:
- каждый вызов кладёт бокс и в коллайдеры, и в рендер (если не сказано иначе);
- проёмы в стенах вычитаются как интервалы — по длине и по высоте;
- `mirror` строит половину дважды, во второй раз с `z → −z`;
- у зеркальных спаунов взгляд отражается: `yaw → π − yaw`.
```ts
import type {
  AABB,
  ArenaData,
  ArenaVariant,
  Collider,
  Material,
  Pickup,
  PickupKind,
  RenderBox,
  Spawn,
  Volume,
  VolumeKind,
} from "@doodlemagic/sim";
import { box, clipBox, pointInBox } from "./geom";

export interface BoxOpts {
  material?: Material;
  /** Есть ли коллизия (по умолчанию да). */
  collide?: boolean;
  /** Рисуется ли (по умолчанию да). */
  render?: boolean;
  noShoot?: true;
  noSight?: true;
  tag?: string;
}

export interface SlabOpts extends BoxOpts {
  /** Толщина плиты вниз от верха, м (по умолчанию 0,5). */
  depth?: number;
}

/** Проём в стене: участок [from, to] вдоль стены, открыт по высоте от sill до top над низом стены. */
export interface Opening {
  from: number;
  to: number;
  /** Низ проёма над низом стены (по умолчанию 0 — проём до пола). */
  sill?: number;
  /** Верх проёма над низом стены (по умолчанию — вся высота стены). */
  top?: number;
}

export interface WallOpts extends BoxOpts {
  /** Низ стены (по умолчанию 0). */
  y0?: number;
  height: number;
  thick: number;
  openings?: readonly Opening[];
}

export type StairDir = "+x" | "-x" | "+z" | "-z";

export interface StairsOpts extends BoxOpts {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Пол у подножия и верх последней ступени. */
  y0: number;
  y1: number;
  /** Куда лестница поднимается. */
  dir: StairDir;
  steps: number;
}

export interface ArenaBuilder {
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o?: BoxOpts): void;
  /** Плита с верхом на высоте top. */
  slab(x0: number, z0: number, x1: number, z1: number, top: number, o?: SlabOpts): void;
  /** Стена вдоль X, ось стены на z. */
  wallX(z: number, x0: number, x1: number, o: WallOpts): void;
  /** Стена вдоль Z, ось стены на x. */
  wallZ(x: number, z0: number, z1: number, o: WallOpts): void;
  /** Лестница из сплошных ступеней-блоков. */
  stairs(o: StairsOpts): void;
  volume(kind: VolumeKind, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, liftM?: number): void;
  spawn(x: number, y: number, z: number, yaw: number): void;
  pickup(kind: PickupKind, x: number, y: number, z: number): void;
  /** Строит половину и её зеркальную копию относительно плоскости z = 0. */
  mirror(build: () => void): void;
  finish(name: string, variant: ArenaVariant, bounds: AABB): ArenaData;
}

/** Угол в (−π, π]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/**
 * Сплошные куски стены [a, b] × [0, height] за вычетом проёмов.
 * Возвращает отрезки вдоль стены и по высоте (от низа стены).
 */
export function wallPieces(a: number, b: number, height: number, openings: readonly Opening[]): { u0: number; u1: number; v0: number; v1: number }[] {
  const cuts = new Set<number>([a, b]);
  for (const op of openings) {
    cuts.add(Math.min(Math.max(op.from, a), b));
    cuts.add(Math.min(Math.max(op.to, a), b));
  }
  const xs = [...cuts].sort((p, q) => p - q);
  const pieces: { u0: number; u1: number; v0: number; v1: number }[] = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const u0 = xs[k]!;
    const u1 = xs[k + 1]!;
    if (u1 - u0 < 1e-6) continue;
    const mid = (u0 + u1) / 2;
    const holes = openings
      .filter((op) => Math.min(op.from, op.to) <= mid && Math.max(op.from, op.to) >= mid)
      .map((op) => [op.sill ?? 0, op.top ?? height] as const)
      .sort((p, q) => p[0] - q[0]);
    let v = 0;
    for (const [s, t] of holes) {
      if (s > v + 1e-6) pieces.push({ u0, u1, v0: v, v1: Math.min(s, height) });
      v = Math.max(v, t);
    }
    if (v < height - 1e-6) pieces.push({ u0, u1, v0: v, v1: height });
  }
  return pieces;
}

export function createArenaBuilder(): ArenaBuilder {
  const colliders: Collider[] = [];
  const render: RenderBox[] = [];
  const volumes: Volume[] = [];
  const spawns: Spawn[] = [];
  const pickups: Pickup[] = [];
  let mirrored = false;
  let inMirror = false;
  /** В зеркальном проходе z меняет знак. */
  const mz = (z: number): number => (mirrored ? -z : z);

  function emit(b: AABB, o: BoxOpts = {}): void {
    const bb = mirrored ? box(b.min.x, b.min.y, -b.max.z, b.max.x, b.max.y, -b.min.z) : b;
    if (o.collide !== false) {
      const c: Collider = { box: bb };
      if (o.noShoot) c.noShoot = true;
      if (o.noSight) c.noSight = true;
      if (o.tag) c.tag = o.tag;
      colliders.push(c);
    }
    if (o.render !== false) render.push({ box: bb, material: o.material ?? "stone" });
  }

  const api: ArenaBuilder = {
    box(x0, y0, z0, x1, y1, z1, o) {
      emit(box(x0, y0, z0, x1, y1, z1), o);
    },
    slab(x0, z0, x1, z1, top, o = {}) {
      emit(box(x0, top - (o.depth ?? 0.5), z0, x1, top, z1), o);
    },
    wallX(z, x0, x1, o) {
      const y0 = o.y0 ?? 0;
      for (const p of wallPieces(Math.min(x0, x1), Math.max(x0, x1), o.height, o.openings ?? [])) {
        emit(box(p.u0, y0 + p.v0, z - o.thick / 2, p.u1, y0 + p.v1, z + o.thick / 2), o);
      }
    },
    wallZ(x, z0, z1, o) {
      const y0 = o.y0 ?? 0;
      for (const p of wallPieces(Math.min(z0, z1), Math.max(z0, z1), o.height, o.openings ?? [])) {
        emit(box(x - o.thick / 2, y0 + p.v0, p.u0, x + o.thick / 2, y0 + p.v1, p.u1), o);
      }
    },
    stairs(o) {
      const rise = (o.y1 - o.y0) / o.steps;
      const alongX = o.dir === "+x" || o.dir === "-x";
      const lo = alongX ? Math.min(o.x0, o.x1) : Math.min(o.z0, o.z1);
      const hi = alongX ? Math.max(o.x0, o.x1) : Math.max(o.z0, o.z1);
      const run = (hi - lo) / o.steps;
      const up = o.dir === "+x" || o.dir === "+z";
      for (let i = 0; i < o.steps; i++) {
        const a = up ? lo + i * run : hi - (i + 1) * run;
        const b = a + run;
        const top = o.y0 + (i + 1) * rise;
        const stepOpts: BoxOpts = { ...o, tag: o.tag ?? "stairs" };
        if (alongX) emit(box(a, o.y0, o.z0, b, top, o.z1), stepOpts);
        else emit(box(o.x0, o.y0, a, o.x1, top, b), stepOpts);
      }
    },
    volume(kind, x0, y0, z0, x1, y1, z1, liftM) {
      const b = box(x0, y0, mz(z0), x1, y1, mz(z1));
      volumes.push(liftM === undefined ? { kind, box: b } : { kind, box: b, liftM });
    },
    spawn(x, y, z, yaw) {
      spawns.push({ pos: { x, y, z: mz(z) }, yaw: wrapAngle(mirrored ? Math.PI - yaw : yaw) });
    },
    pickup(kind, x, y, z) {
      pickups.push({ kind, pos: { x, y, z: mz(z) } });
    },
    mirror(build) {
      if (inMirror) throw new Error("mirror() cannot be nested");
      inMirror = true;
      build();
      mirrored = true;
      build();
      mirrored = false;
      inMirror = false;
    },
    finish(name, variant, bounds) {
      return { name, variant, bounds, colliders, volumes, render, spawns, pickups };
    },
  };
  return api;
}

/** Обрезает арену по боксу: что вне него, пропадает (так собирается компактный вариант). */
export function clipArena(a: ArenaData, bounds: AABB, variant: ArenaVariant): ArenaData {
  const colliders: Collider[] = [];
  for (const c of a.colliders) {
    const b = clipBox(c.box, bounds);
    if (b) colliders.push({ ...c, box: b });
  }
  const render: RenderBox[] = [];
  for (const r of a.render) {
    const b = clipBox(r.box, bounds);
    if (b) render.push({ ...r, box: b });
  }
  const volumes: Volume[] = [];
  for (const v of a.volumes) {
    const b = clipBox(v.box, bounds);
    if (b) volumes.push({ ...v, box: b });
  }
  return {
    name: a.name,
    variant,
    bounds,
    colliders,
    render,
    volumes,
    spawns: a.spawns.filter((s) => pointInBox(bounds, s.pos)),
    pickups: a.pickups.filter((p) => pointInBox(bounds, p.pos)),
  };
}
```

`packages/arena/src/index.ts` (заменить целиком):
```ts
export * from "./dsl";
```

- [ ] **Step 4: Убедиться, что тест проходит, и проверить типы**

Run: `pnpm test packages/arena` и `pnpm --filter @doodlemagic/arena typecheck`
Expected: PASS — 13 тестов; типы без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add packages/arena/src
git commit -m "feat(arena): level DSL — boxes, walls with openings, stairs, mirror, volumes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Галерея над ущельем

**Поток:** B (после задачи 4).

**Files:**
- Create: `packages/arena/src/gallery.ts`
- Modify: `packages/arena/src/index.ts`
- Test: `packages/arena/src/gallery.test.ts`

**Interfaces:**
- Consumes:
  - `createArenaBuilder`, `clipArena`, `ArenaBuilder` (задача 4);
  - `box`, `boxInBox`, `boxesOverlap`, `canSee`, `floorBelow`, `pointInBox`, `sightDistance` (`geom.ts`);
  - `EYE_HEIGHT`, `PLAYER_HALF_W`, `PLAYER_HEIGHT` и типы (задача 1).
- Produces (из `@doodlemagic/arena`):
  - `GALLERY = { name, full: AABB, compact: AABB, gorge: { x0, x1, z0, z1 }, deckY: 4, wallTop: 8 }`;
  - `buildGallery(variant: ArenaVariant = "full"): ArenaData`.

  Размеры: полный вариант 44 × 36 м — 148 коллайдеров и 187 боксов рендера; компактный 30 × 36 м — 136 и 155. Спаунов 10, пикапов 7 (руна и 6 сфер), объёмов 7: ущелье, 2 потока, 4 участка травы.

Что внутри, по зонам (оси three.js, пол на y = 0, половина z > 0 — зеркало половины z < 0):
- **Оболочка:** стены 8 м по периметру 44 × 36 м; пол на 0; сухой ров на −1 м вдоль запада (x от −21,5 до −15,5), из него ведёт ступень 0,5 м.
- **Галерея** по z = 0, ширина 3 м, верх +4 м, парапет 0,8 м, над ущельем 1,2 м. Проходы между половинами (тест сверяет ширины на высоте 1 м):

  | Проход | Ширина | Роль |
  |---|---|---|
  | арка над рвом | 6 м | основная линия |
  | западная арка | 4 м | узкое место |
  | арка руны | 5 м | центр, над площадкой руны |
  | восточная арка | 4 м | узкое место |
  | восточный проход за башней | 6 м | основная линия |

  Лестницы по 10 ступеней 0,4 м с «щекой» со стороны арки; башня 4 × 5 м на +4 м — продолжение галереи.
- **Ущелье** 12 × 10 м:
  - зона смерти от −16 до −3 м;
  - площадка руны 4 × 4 м (золото) на столбе;
  - два каменных моста по 3 м;
  - бортик-кромка 0,2 м тушью;
  - обрывы до −14 м растворяются в тумане.
- **Кельи:** по 5 на сторону, у каждой спаун лицом к двери. Общая крыша на 3 м, по краям ряда глухие кладовые.
- **Двор:**
  - две ширмы 2,6 м;
  - низкие стенки 1 м (`tag: "low"`) — перепрыгиваются: прыжок 1,25 м, ступенька только 0,55 м;
  - стелы и фонари 2,6 м — полное укрытие от 2,2 м;
  - в восточном проходе два блока вразбежку;
  - во рву три валуна.
- **Окружение:** 2 восходящих потока у башни (подъём до 6,5 м) с золотым глифом на полу; 4 участка травы (объём для горения в фазе 2 и кочки без коллизии, без контура); 6 сфер и руна.
- **Компактный вариант** (≤ 3 игроков) — та же карта, обрезанная по x = ±15. Фланги закрыты глухими стенами; ров, восточный проход и потоки отрезаны.

- [ ] **Step 1: Написать падающий тест инвариантов**

`packages/arena/src/gallery.test.ts`. Тест проверяет оба варианта:
- арена влезает в заявленные габариты;
- 10 спаунов стоят на полу и ни во что не входят;
- ни один спаун не видит другой (луч перебором по всем коллайдерам);
- под всем ущельем есть зона смерти;
- мосты не уже 3 м, площадка руны 4 × 4 м;
- низкие укрытия 1 м, полные — от 2,2 м;
- коллайдеров не больше 300;
- данные переживают JSON;
- выборка линий обзора не длиннее 30 м.

Отдельно — размеры 44 × 36 и 30 × 36 м, ширины проходов, состав пикапов и объёмов.
```ts
import { describe, expect, it } from "vitest";
import { EYE_HEIGHT, PLAYER_HALF_W, PLAYER_HEIGHT, type ArenaData, type Collider, type Vec3 } from "@doodlemagic/sim";
import { GALLERY, buildGallery } from "./gallery";
import { box, boxInBox, boxesOverlap, canSee, floorBelow, pointInBox, sightDistance } from "./geom";

const full = buildGallery("full");
const compact = buildGallery("compact");
const variants: [string, ArenaData][] = [
  ["full", full],
  ["compact", compact],
];

const movers = (a: ArenaData): Collider[] => a.colliders.filter((c) => !c.noSight);
const eye = (p: Vec3): Vec3 => ({ x: p.x, y: p.y + EYE_HEIGHT, z: p.z });
const bodyAt = (p: Vec3) => box(p.x - PLAYER_HALF_W, p.y, p.z - PLAYER_HALF_W, p.x + PLAYER_HALF_W, p.y + PLAYER_HEIGHT, p.z + PLAYER_HALF_W);

/** Свободные отрезки вдоль X на высоте y и глубине z (шаг 5 см). */
function freeSpans(a: ArenaData, y: number, z: number): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let start: number | null = null;
  for (let x = a.bounds.min.x; x <= a.bounds.max.x + 1e-9; x += 0.05) {
    const blocked = movers(a).some((c) => pointInBox(c.box, { x, y, z }));
    if (!blocked && start === null) start = x;
    if (blocked && start !== null) {
      spans.push({ from: start, to: x });
      start = null;
    }
  }
  return spans;
}

describe.each(variants)("gallery (%s)", (_name, a) => {
  it("fits its stated bounds", () => {
    for (const c of a.colliders) expect(boxInBox(a.bounds, c.box)).toBe(true);
    for (const r of a.render) expect(boxInBox(a.bounds, r.box)).toBe(true);
    for (const v of a.volumes) expect(boxInBox(a.bounds, v.box)).toBe(true);
    for (const p of [...a.spawns.map((s) => s.pos), ...a.pickups.map((p) => p.pos)]) expect(pointInBox(a.bounds, p)).toBe(true);
  });

  it("has 10 FFA spawns standing on the floor and not inside anything", () => {
    expect(a.spawns).toHaveLength(10);
    for (const s of a.spawns) {
      expect(floorBelow(movers(a), { ...s.pos, y: s.pos.y + 0.5 })).toBeCloseTo(s.pos.y, 6);
      expect(movers(a).filter((c) => boxesOverlap(bodyAt(s.pos), c.box))).toEqual([]);
    }
  });

  it("has no direct line of sight between any two spawns", () => {
    for (let i = 0; i < a.spawns.length; i++) {
      for (let j = i + 1; j < a.spawns.length; j++) {
        expect(canSee(a.colliders, eye(a.spawns[i]!.pos), eye(a.spawns[j]!.pos)), `spawn ${i} sees spawn ${j}`).toBe(false);
      }
    }
  });

  it("has a kill volume under the whole gorge", () => {
    const g = GALLERY.gorge;
    const kill = a.volumes.filter((v) => v.kind === "kill");
    expect(
      kill.some((v) => v.box.min.x <= g.x0 && v.box.max.x >= g.x1 && v.box.min.z <= g.z0 && v.box.max.z >= g.z1 && v.box.max.y <= -2),
    ).toBe(true);
  });

  it("has two stone bridges at least 3 m wide and a 4 × 4 m rune platform", () => {
    const bridges = a.colliders.filter((c) => c.tag === "bridge");
    expect(bridges).toHaveLength(2);
    for (const b of bridges) expect(Math.min(b.box.max.x - b.box.min.x, b.box.max.z - b.box.min.z)).toBeGreaterThanOrEqual(3);
    const rune = a.colliders.find((c) => c.tag === "rune")!;
    expect([rune.box.max.x - rune.box.min.x, rune.box.max.z - rune.box.min.z]).toEqual([4, 4]);
    expect(a.pickups.filter((p) => p.kind === "rune")).toHaveLength(1);
  });

  it("uses jumpable 1 m low cover and full cover from 2.2 m", () => {
    const low = a.colliders.filter((c) => c.tag === "low");
    expect(low.length).toBeGreaterThan(0);
    for (const c of low) expect(c.box.max.y - c.box.min.y).toBe(1);
    const standalone = a.colliders.filter((c) => !c.tag && c.box.min.y === 0 && c.box.max.y - c.box.min.y > 1 && c.box.max.y < 3);
    for (const c of standalone) expect(c.box.max.y - c.box.min.y).toBeGreaterThanOrEqual(2.2);
  });

  it("stays within the collider budget of 300 boxes", () => {
    expect(a.colliders.length).toBeLessThanOrEqual(300);
  });

  it("is plain data", () => {
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("keeps ground-level sight lines within 30 m", () => {
    const solid = a.colliders;
    const worst: string[] = [];
    for (let x = a.bounds.min.x + 0.75; x < a.bounds.max.x; x += 1.5) {
      for (let z = a.bounds.min.z + 0.75; z < a.bounds.max.z; z += 1.5) {
        const floor = floorBelow(movers(a), { x, y: 2.5, z }, 4);
        if (floor === null || floor > 1.2) continue;
        const feet = { x, y: floor, z };
        if (movers(a).some((c) => boxesOverlap(bodyAt(feet), c.box))) continue;
        for (let k = 0; k < 32; k++) {
          const ang = (k / 32) * Math.PI * 2;
          const d = sightDistance(solid, eye(feet), { x: Math.cos(ang), y: 0, z: Math.sin(ang) }, 60) ?? 60;
          if (d > 30) worst.push(`(${x.toFixed(2)}, ${z.toFixed(2)}) dir ${k}: ${d.toFixed(1)} m`);
        }
      }
    }
    expect(worst.slice(0, 20)).toEqual([]);
  });
});

describe("gallery layout", () => {
  it("is 44 × 36 m, the compact variant 30 × 36 m", () => {
    const size = (a: ArenaData) => [a.bounds.max.x - a.bounds.min.x, a.bounds.max.z - a.bounds.min.z];
    expect(size(full)).toEqual([44, 36]);
    expect(size(compact)).toEqual([30, 36]);
  });

  it("connects the halves through ≥ 4 m arches and ≥ 6 m main lanes", () => {
    const spans = freeSpans(full, 1, 0).map((s) => Math.round((s.to - s.from) * 10) / 10);
    // ров, западная арка, арка руны, восточная арка, восточный проход
    expect(spans).toEqual([6, 4, 5, 4, 6]);
  });

  it("closes the flanks in the compact variant", () => {
    const spans = freeSpans(compact, 1, 0).map((s) => Math.round((s.to - s.from) * 10) / 10);
    expect(spans).toEqual([4, 5, 4]);
  });

  it("has 6 orbs, 4 grass patches and 2 updrafts", () => {
    expect(full.pickups.filter((p) => p.kind === "orb")).toHaveLength(6);
    expect(full.volumes.filter((v) => v.kind === "grass")).toHaveLength(4);
    expect(full.volumes.filter((v) => v.kind === "updraft")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm test packages/arena`
Expected: FAIL — `Failed to resolve import "./gallery"`.

- [ ] **Step 3: Блокаут**

`packages/arena/src/gallery.ts`:
```ts
import type { ArenaData, ArenaVariant } from "@doodlemagic/sim";
import { clipArena, createArenaBuilder, type ArenaBuilder } from "./dsl";
import { box } from "./geom";

/**
 * «Горный монастырь — галерея над ущельем» (GDD 8, рецензия левел-дизайнера), 44 × 36 м.
 * Оси three.js: X вправо, Y вверх, Z к зрителю; пол на y = 0. Всё внутри mirror() повторяется
 * зеркально относительно z = 0, поэтому половины A (z < 0) и B (z > 0) одинаковы.
 *
 * Поперёк карты по z = 0 идёт галерея +4 м с арками: над рвом 6 м, западная 4 м, арка руны 5 м,
 * восточная 4 м; на востоке галерея упирается в башню, за башней — восточный проход 6 м и поток наверх.
 * Под аркой руны — ущелье 12 × 10 м (зона смерти) с площадкой руны 4 × 4 м и двумя мостами по 3 м.
 * Вдоль дальних стен — по 5 келий со спаунами. Двор перед ними делят две ширмы, стелы и фонари
 * режут прямые линии (≤ 30 м), низкие стенки 1 м перепрыгиваются. На западе — сухой ров на −1 м.
 */
export const GALLERY = {
  name: "Галерея над ущельем",
  full: box(-22, -16, -18, 22, 9, 18),
  compact: box(-15, -16, -18, 15, 9, 18),
  /** Дыра ущелья в полу. */
  gorge: { x0: -6, x1: 6, z0: -5, z1: 5 },
  /** Верх галереи и башни. */
  deckY: 4,
  wallTop: 8,
} as const;

const CELL_X0 = [-12.5, -7.5, -2.5, 2.5, 7.5] as const;

function shell(b: ArenaBuilder): void {
  const top = GALLERY.wallTop;
  b.box(-22, -1.5, -18, -21.5, top, 18);
  b.box(21.5, -1.5, -18, 22, top, 18);
  b.mirror(() => b.box(-22, -1.5, -18, 22, top, -17.5));
  // ров на −1 м и основной пол; вокруг ущелья — четыре плиты
  b.box(-21.5, -1.5, -17.5, -15.5, -1, 17.5, { material: "floor" });
  b.mirror(() => b.box(-15.5, -1.5, -17.5, 21.5, 0, -5, { material: "floor" }));
  b.box(-15.5, -1.5, -5, -6, 0, 5, { material: "floor" });
  b.box(6, -1.5, -5, 21.5, 0, 5, { material: "floor" });
}

function gorge(b: ArenaBuilder): void {
  const { x0, x1, z0, z1 } = GALLERY.gorge;
  // обрывы уходят в туман
  b.mirror(() => b.box(x0, -14, z0 - 1, x1, -1.5, z0));
  b.box(x0 - 1, -14, z0, x0, -1.5, z1);
  b.box(x1, -14, z0, x1 + 1, -1.5, z1);
  // площадка руны 4 × 4 и её столб
  b.box(-2, -0.5, -2, 2, 0, 2, { material: "gold", tag: "rune" });
  b.box(-1.2, -14, -1.2, 1.2, -0.5, 1.2, { collide: false });
  b.mirror(() => {
    // каменный мост 3 м
    b.box(-1.5, -0.6, z0, 1.5, 0, -2, { tag: "bridge" });
    // кромка ущелья: низкий бортик тушью, перешагивается
    b.box(x0, 0, z0 - 0.3, -1.5, 0.2, z0, { material: "edge", tag: "kerb" });
    b.box(1.5, 0, z0 - 0.3, x1, 0.2, z0, { material: "edge", tag: "kerb" });
    // тонкие линии по краям моста и площадки (только рисунок)
    b.box(-1.5, 0, z0, -1.35, 0.12, -2, { material: "edge", collide: false });
    b.box(1.35, 0, z0, 1.5, 0.12, -2, { material: "edge", collide: false });
    b.box(-2, 0, -2, -1.5, 0.12, -1.85, { material: "edge", collide: false });
    b.box(1.5, 0, -2, 2, 0.12, -1.85, { material: "edge", collide: false });
  });
  b.box(x0 - 0.3, 0, z0, x0, 0.2, z1, { material: "edge", tag: "kerb" });
  b.box(x1, 0, z0, x1 + 0.3, 0.2, z1, { material: "edge", tag: "kerb" });
  b.box(-2, 0, -1.85, -1.85, 0.12, 1.85, { material: "edge", collide: false });
  b.box(1.85, 0, -1.85, 2, 0.12, 1.85, { material: "edge", collide: false });
  b.volume("kill", x0, -16, z0, x1, -3, z1);
}

function galleryWall(b: ArenaBuilder): void {
  const y = GALLERY.deckY;
  // стена-галерея: верх — дорожка +4 м, внизу арки
  b.wallX(0, -21.5, 11.5, {
    height: y,
    thick: 3,
    openings: [
      { from: -21.5, to: -15.5, top: 3 }, // арка над рвом, 6 м
      { from: -11.5, to: -7.5, top: 3 }, // западная арка, 4 м
      { from: -6, to: -2.5, top: 0 }, // над ущельем опоры уходят в пустоту (ниже)
      { from: -2.5, to: 2.5, top: 3.5 }, // большая арка над площадкой руны, 5 м
      { from: 2.5, to: 6, top: 0 },
      { from: 7.5, to: 11.5, top: 3 }, // восточная арка, 4 м
    ],
  });
  // опоры галереи из глубины ущелья: руну видно и простреливают только сквозь арку
  b.box(-6, -14, -1.5, -2.5, 0, 1.5);
  b.box(2.5, -14, -1.5, 6, 0, 1.5);
  // башня в конце галереи
  b.box(11.5, 0, -2.5, 15.5, y, 2.5, { tag: "tower" });
  b.mirror(() => {
    // парапет: 0,8 м, над ущельем 1,2 м, проход к лестнице
    b.wallX(-1.375, -21.5, 11.5, {
      y0: y,
      height: 1.2,
      thick: 0.25,
      openings: [
        { from: -21.5, to: -6, sill: 0.8 },
        { from: 6, to: 11.5, sill: 0.8 },
        { from: -14.5, to: -11.5 },
      ],
    });
    // лестница на галерею: 10 ступеней по 0,4 м
    b.stairs({ x0: -14.5, z0: -6.5, x1: -11.5, z1: -1.5, y0: 0, y1: y, dir: "+z", steps: 10 });
    // щека лестницы со стороны арки
    b.box(-11.5, 0, -6.5, -11.2, 2.6, -1.5);
  });
}

function cells(b: ArenaBuilder): void {
  b.mirror(() => {
    for (const x0 of CELL_X0) {
      // келья 3 × 3,5 м: дверь в восточной стене у задней стены, перед кельей сплошная стена
      b.box(x0, 0, -17.5, x0 + 0.3, 3, -14);
      b.wallZ(x0 + 2.85, -17.5, -14, { height: 3, thick: 0.3, openings: [{ from: -17.5, to: -15.8, top: 2.4 }] });
      b.box(x0, 0, -14.3, x0 + 3, 3, -14);
      b.spawn(x0 + 1.4, 0, -16.7, -Math.PI / 2);
    }
    // кладовые по краям ряда келий: глухие блоки
    b.box(-15.5, 0, -17.5, -12.5, 3, -14);
    b.box(12.5, 0, -17.5, 15.5, 3, -14);
    b.box(-15.5, 3, -17.5, 15.5, 3.3, -14, { material: "roof" });
  });
}

function cover(b: ArenaBuilder): void {
  b.mirror(() => {
    // две ширмы 2,6 м делят двор на три зоны: западная примыкает к кельям, восточная — к краю ущелья
    b.wallZ(-6, -14, -8.5, { height: 2.6, thick: 0.4 });
    b.wallZ(6, -11, -5, { height: 2.6, thick: 0.4 });
    // низкие укрытия 1 м — перепрыгиваются
    b.wallX(-8.5, -4.5, 1, { height: 1, thick: 0.4, tag: "low" });
    b.wallX(-6.5, 8, 11.5, { height: 1, thick: 0.4, tag: "low" });
    // стелы 2,6 м: полные укрытия, режут прямые линии из проходов между кельями
    b.box(-14, 0, -9.5, -12.5, 2.6, -8);
    b.box(-9.7, 0, -8, -7.3, 2.6, -6);
    b.box(-5.4, 0, -11.2, -2.3, 2.6, -10);
    b.box(0.3, 0, -11.2, 2.7, 2.6, -10);
    b.box(6.3, 0, -12.4, 8.3, 2.6, -11.6);
    b.box(9.8, 0, -10.5, 11.8, 2.6, -9);
    b.box(12.5, 0, -6.5, 14, 2.6, -2.5);
    // каменные фонари у моста: закрывают косые линии сквозь арку руны
    b.box(-5, 0, -7, -3.2, 2.6, -5.5);
    b.box(3.2, 0, -7, 5, 2.6, -5.5);
    // восточный проход: два блока вразбежку
    b.box(14, 0, -10, 17.5, 2.6, -8);
    b.box(17.5, 0, -5, 21.5, 2.6, -3);
    // ров: валуны ломают прямую линию, ступень для выхода
    b.box(-21.5, -1, -8, -18.5, 2.2, -6.5);
    b.box(-18.5, -1, -13, -15.5, 2.2, -11.5);
    b.box(-20, -1, -3.5, -16.5, 2.2, -2.5);
    b.box(-16.5, -1, -17.5, -15.5, -0.5, -15.5, { material: "floor" });
  });
}

function nature(b: ArenaBuilder): void {
  b.mirror(() => {
    // восходящий поток к башне, глиф на полу
    b.volume("updraft", 15.5, 0, -4.2, 17.4, 1, -2.2, 6.5);
    b.box(15.8, 0, -3.9, 17.1, 0.05, -2.5, { material: "gold", collide: false });
    // трава: объём для горения (фаза 2) и кочки-мазки без коллизии
    for (const [x0, z0, x1, z1] of [
      [16, -15, 21, -11],
      [-12, -12.5, -8.5, -10],
    ] as const) {
      b.volume("grass", x0, 0, z0, x1, 0.8, z1);
      let k = 0;
      for (let x = x0 + 0.6; x < x1 - 0.3; x += 1.4) {
        for (let z = z0 + 0.6; z < z1 - 0.3; z += 1.4) {
          const h = 0.35 + 0.15 * (k++ % 3);
          b.box(x - 0.35, 0, z - 0.35, x + 0.35, h, z + 0.35, { material: "grass", collide: false });
        }
      }
    }
    b.pickup("orb", -9.5, 0.5, -11);
    b.pickup("orb", 18.5, 0.5, -13);
  });
  b.pickup("rune", 0, 0.5, 0);
  b.pickup("orb", -18.5, -0.5, 0);
  b.pickup("orb", 13.5, GALLERY.deckY + 0.5, 0);
}

/** Блокаут арены. Компактный вариант (≤ 3 игроков): фланги закрыты глухими стенами, всё за ними отрезано. */
export function buildGallery(variant: ArenaVariant = "full"): ArenaData {
  const b = createArenaBuilder();
  shell(b);
  gorge(b);
  galleryWall(b);
  cells(b);
  cover(b);
  nature(b);
  if (variant === "compact") {
    const { min, max } = GALLERY.compact;
    b.box(min.x, -1.5, -17.5, min.x + 0.5, GALLERY.wallTop, 17.5);
    b.box(max.x - 0.5, -1.5, -17.5, max.x, GALLERY.wallTop, 17.5);
    return clipArena(b.finish(GALLERY.name, "full", GALLERY.full), GALLERY.compact, "compact");
  }
  return b.finish(GALLERY.name, "full", GALLERY.full);
}
```

`packages/arena/src/index.ts` (заменить целиком):
```ts
export * from "./dsl";
export * from "./gallery";
```

- [ ] **Step 4: Убедиться, что тесты проходят, и проверить типы**

Run: `pnpm test packages/arena` и `pnpm --filter @doodlemagic/arena typecheck`
Expected: PASS — 13 + 22 = 35 тестов (выборка линий обзора идёт около 0,2 с); типы без ошибок.

Если правка геометрии уронит тест «линии обзора», он печатает до 20 строк вида `(x, z) dir k: 33.9 m`: откуда и в каком из 32 направлений луч ушёл дальше 30 м. Длинную линию режут стелой 2,6 м на её пути, а не ослаблением теста.

- [ ] **Step 5: Коммит**

```bash
git add packages/arena/src
git commit -m "feat(arena): gallery over the gorge blockout with compact variant" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Рендер: чистые части

**Поток:** C (первая задача потока). Всё здесь без three.js и проверяется тестами.

**Files:**
- Create: `apps/client/src/render/palette.ts`, `apps/client/src/render/boxMesh.ts`, `apps/client/src/render/quality.ts`, `apps/client/src/render/fpsMeter.ts`
- Test: `apps/client/src/render/palette.test.ts`, `apps/client/src/render/boxMesh.test.ts`, `apps/client/src/render/quality.test.ts`, `apps/client/src/render/fpsMeter.test.ts`

**Interfaces:**
- Consumes: `MATERIALS`, `Material`, `AABB`, `RenderBox` (задача 1).
- Produces:
  - `palette.ts`:
    - `RGB`;
    - `INK = { sky: 0, stone: 1, floor: 2, roof: 3, grass: 4, edge: 5, gold: 6, hands: 7, enemy: 8, magic: 9 }`, `InkName`, `INK_COUNT = 10`;
    - `inkOf(m: Material): number`;
    - `PAPER`, `INK_STYLE: Record<InkName, { wash; bands; line }>`, `INK_BY_ID`;
    - `washColor(ink, band)`, `luminance(c)`, `saturation(c)`;
    - `SUN_DIR`;
  - `boxMesh.ts`:
    - `BoxArrays { positions; normals; indices }`;
    - `buildBoxArrays(boxes: readonly AABB[]): BoxArrays` — 24 вершины и 36 индексов на бокс, плоские нормали;
    - `groupByInk(render: readonly RenderBox[]): Map<number, AABB[]>`;
  - `quality.ts`:
    - `PresetId = "low" | "medium" | "high"`, `Preset { id; label; renderScale; maxPixelRatio }`;
    - `PRESETS` (0,67 / 0,85 / 1,0; потолок pixelRatio 1 / 1,25 / 1,5), `PRESET_ORDER`;
    - `isPresetId(x)`, `pixelRatioFor(preset, devicePixelRatio)`;
    - `AutoQualityOptions`, `AUTO_QUALITY`;
    - `AutoQuality { preset; done; push(frameMs): PresetId | null }`, `createAutoQuality(start = "high", o = AUTO_QUALITY)`;
  - `fpsMeter.ts`: `FpsMeter { push(frameMs); fps; frameMs }`, `createFpsMeter(windowMs = 500)`.

- [ ] **Step 1: Написать падающие тесты**

`apps/client/src/render/palette.test.ts`. Здесь правило трёх слоёв яркости (GDD 6) записано тестом:
- мир держится в средних тонах, 25–90 %;
- враги темнее всего в мире;
- магия — единственное насыщенное и самое яркое.
```ts
import { describe, expect, it } from "vitest";
import { MATERIALS } from "@doodlemagic/sim";
import { INK, INK_BY_ID, INK_COUNT, INK_STYLE, inkOf, luminance, saturation, washColor, type InkName } from "./palette";

const WORLD: InkName[] = ["stone", "floor", "roof", "grass", "edge", "gold", "hands"];
const bands = (ink: InkName) => [washColor(ink, 0), washColor(ink, 1), washColor(ink, 2)];

describe("ink table", () => {
  it("gives every arena material its own ink and fits the shader array", () => {
    const ids = MATERIALS.map(inkOf);
    expect(new Set(ids).size).toBe(MATERIALS.length);
    expect(Math.max(...Object.values(INK))).toBe(INK_COUNT - 1);
    expect(INK_BY_ID).toHaveLength(INK_COUNT);
    INK_BY_ID.forEach((name, id) => expect(INK[name]).toBe(id));
  });

  it("darkens with each band", () => {
    for (const ink of WORLD) {
      const [light, mid, dark] = bands(ink).map(luminance);
      expect(light).toBeGreaterThanOrEqual(mid!);
      expect(mid).toBeGreaterThanOrEqual(dark!);
    }
  });
});

describe("three brightness layers (GDD 6)", () => {
  it("keeps the world in mid tones, 25–90 %", () => {
    for (const ink of WORLD) {
      for (const c of bands(ink)) {
        expect(luminance(c), ink).toBeGreaterThanOrEqual(0.25);
        expect(luminance(c), ink).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it("makes enemies darker than anything in the world", () => {
    const darkestWorld = Math.min(...WORLD.flatMap((ink) => bands(ink).map(luminance)));
    for (const c of bands("enemy")) expect(luminance(c)).toBeLessThan(darkestWorld);
  });

  it("makes magic the only saturated and the brightest colour", () => {
    const magic = washColor("magic", 1);
    const worldMaxSat = Math.max(...WORLD.flatMap((ink) => bands(ink).map(saturation)));
    expect(worldMaxSat).toBeLessThanOrEqual(0.45);
    expect(saturation(magic)).toBeGreaterThan(0.7);
    const worldMaxValue = Math.max(...WORLD.flatMap((ink) => bands(ink).map((c) => Math.max(...c))));
    expect(Math.max(...magic)).toBeGreaterThan(worldMaxValue);
    expect(INK_STYLE.magic.bands).toEqual([1, 1, 1]);
  });
});
```

`apps/client/src/render/boxMesh.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { AABB, RenderBox } from "@doodlemagic/sim";
import { buildBoxArrays, groupByInk } from "./boxMesh";
import { INK } from "./palette";

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB => ({
  min: { x: x0, y: y0, z: z0 },
  max: { x: x1, y: y1, z: z1 },
});

const vec = (a: Float32Array, k: number): [number, number, number] => [a[k * 3]!, a[k * 3 + 1]!, a[k * 3 + 2]!];

describe("buildBoxArrays", () => {
  const boxes = [box(0, 0, 0, 1, 2, 3), box(-5, -1, -5, 5, 0, 5)];
  const g = buildBoxArrays(boxes);

  it("emits 24 vertices and 12 triangles per box", () => {
    expect(g.positions).toHaveLength(2 * 24 * 3);
    expect(g.normals).toHaveLength(2 * 24 * 3);
    expect(g.indices).toHaveLength(2 * 36);
    expect(Math.max(...g.indices)).toBe(47);
  });

  it("keeps every vertex on the box corners", () => {
    for (let k = 0; k < 24; k++) {
      const [x, y, z] = vec(g.positions, k);
      expect([0, 1]).toContain(x);
      expect([0, 2]).toContain(y);
      expect([0, 3]).toContain(z);
    }
  });

  it("winds every triangle counter-clockwise seen from outside, matching the flat normal", () => {
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
      const pa = vec(g.positions, a);
      const pb = vec(g.positions, b);
      const pc = vec(g.positions, c);
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const cross = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const n = vec(g.normals, a);
      expect(cross[0]! * n[0] + cross[1]! * n[1] + cross[2]! * n[2]).toBeGreaterThan(0);
      expect(vec(g.normals, b)).toEqual(n);
      expect(vec(g.normals, c)).toEqual(n);
    }
  });
});

describe("groupByInk", () => {
  it("puts boxes of one material into one bucket", () => {
    const render: RenderBox[] = [
      { box: box(0, 0, 0, 1, 1, 1), material: "stone" },
      { box: box(1, 0, 0, 2, 1, 1), material: "gold" },
      { box: box(2, 0, 0, 3, 1, 1), material: "stone" },
    ];
    const groups = groupByInk(render);
    expect([...groups.keys()].sort()).toEqual([INK.stone, INK.gold].sort());
    expect(groups.get(INK.stone)).toHaveLength(2);
  });
});
```

`apps/client/src/render/quality.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PRESETS, createAutoQuality, isPresetId, pixelRatioFor, type PresetId } from "./quality";

describe("presets", () => {
  it("use render scale 0.67 / 0.85 / 1.0", () => {
    expect([PRESETS.low.renderScale, PRESETS.medium.renderScale, PRESETS.high.renderScale]).toEqual([0.67, 0.85, 1]);
    expect(PRESETS.high.label).toBe("Высокое");
  });

  it("cap the device pixel ratio", () => {
    expect(pixelRatioFor(PRESETS.high, 2)).toBe(1.5);
    expect(pixelRatioFor(PRESETS.low, 2)).toBeCloseTo(0.67, 9);
    expect(pixelRatioFor(PRESETS.medium, 1)).toBeCloseTo(0.85, 9);
    expect(pixelRatioFor(PRESETS.high, Number.NaN)).toBe(1);
  });

  it("recognises preset ids", () => {
    expect(isPresetId("medium")).toBe(true);
    expect(isPresetId("ultra")).toBe(false);
  });
});

/** Гоняет автовыбор на «машине», у которой время кадра зависит от пресета. */
function simulate(frameMs: Record<PresetId, number>, seconds = 10): { preset: PresetId; switches: PresetId[]; doneAtMs: number } {
  const auto = createAutoQuality();
  const switches: PresetId[] = [];
  let t = 0;
  let doneAtMs = -1;
  while (t < seconds * 1000) {
    const dt = frameMs[auto.preset];
    t += dt;
    const next = auto.push(dt);
    if (next) switches.push(next);
    if (auto.done && doneAtMs < 0) doneAtMs = t;
  }
  return { preset: auto.preset, switches, doneAtMs };
}

describe("createAutoQuality", () => {
  it("keeps High on a fast machine and finishes in about 2 s", () => {
    const r = simulate({ high: 16.7, medium: 12, low: 8 });
    expect(r.preset).toBe("high");
    expect(r.switches).toEqual([]);
    expect(r.doneAtMs).toBeGreaterThan(1900);
    expect(r.doneAtMs).toBeLessThan(2200);
  });

  it("steps down until the frame fits", () => {
    expect(simulate({ high: 33.3, medium: 16.7, low: 10 }).switches).toEqual(["medium"]);
    expect(simulate({ high: 50, medium: 33.3, low: 25 })).toMatchObject({ preset: "low", switches: ["medium", "low"] });
  });

  it("ignores single spikes", () => {
    const auto = createAutoQuality();
    let switched = false;
    for (let k = 0; k < 400; k++) if (auto.push(k % 20 === 0 ? 120 : 16.7)) switched = true;
    expect(switched).toBe(false);
    expect(auto.preset).toBe("high");
  });

  it("stops after the time limit even if still slow", () => {
    const r = simulate({ high: 200, medium: 200, low: 200 }, 30);
    expect(r.preset).toBe("low");
    expect(r.doneAtMs).toBeLessThan(6500);
  });
});
```

`apps/client/src/render/fpsMeter.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createFpsMeter } from "./fpsMeter";

describe("createFpsMeter", () => {
  it("reports 0 until the first window is full, then the average", () => {
    const m = createFpsMeter(500);
    for (let k = 0; k < 10; k++) m.push(16);
    expect(m.fps).toBe(0);
    for (let k = 0; k < 30; k++) m.push(16);
    expect(m.fps).toBeCloseTo(62.5, 6);
    expect(m.frameMs).toBeCloseTo(16, 6);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test apps/client/src/render`
Expected: FAIL — `Failed to resolve import "./palette"`, `"./boxMesh"`, `"./quality"`, `"./fpsMeter"`.

- [ ] **Step 3: Палитра**

`apps/client/src/render/palette.ts`. Цвета заданы в пространстве экрана (sRGB): стилевой проход пишет их прямо в холст и смешивает с бумагой, как краску.

Солнце `(0,45; 0,85; 0,3)` даёт граням боксов тона: верх 0,92, две стороны 0,72 и 0,65, две другие 0,35 и 0,28. Ни один из них не попадает на пороги тонов (0,5 и 0,82), поэтому грани не мерцают.
```ts
import type { Material } from "@doodlemagic/sim";

export type RGB = readonly [number, number, number];

/**
 * Номера чернил в G-буфере (канал G хранит id / 255). 0 — пиксель без геометрии (небо).
 * Мир — средние тона, враги — самое тёмное, магия — единственное насыщенное и яркое (GDD 6).
 */
export const INK = {
  sky: 0,
  stone: 1,
  floor: 2,
  roof: 3,
  grass: 4,
  edge: 5,
  gold: 6,
  hands: 7,
  enemy: 8,
  magic: 9,
} as const;
export type InkName = keyof typeof INK;
export const INK_COUNT = 10;

export function inkOf(m: Material): number {
  return INK[m];
}

/** Цвет бумаги: тёплая сепия «Горного монастыря». Все цвета — в пространстве экрана (sRGB). */
export const PAPER: RGB = [0.95, 0.93, 0.88];

interface InkStyle {
  /** Цвет туши при полной плотности. */
  wash: RGB;
  /** Плотность размывки в трёх тонах: свет, полутон, тень. */
  bands: RGB;
  /** Цвет контура. */
  line: RGB;
}

const LINE: RGB = [0.1, 0.09, 0.08];

export const INK_STYLE: Record<InkName, InkStyle> = {
  sky: { wash: PAPER, bands: [0, 0, 0], line: LINE },
  stone: { wash: [0.3, 0.29, 0.27], bands: [0.25, 0.5, 0.75], line: LINE },
  floor: { wash: [0.42, 0.4, 0.37], bands: [0.32, 0.5, 0.66], line: LINE },
  roof: { wash: [0.22, 0.21, 0.22], bands: [0.25, 0.5, 0.72], line: LINE },
  grass: { wash: [0.36, 0.4, 0.3], bands: [0.35, 0.5, 0.65], line: [0.2, 0.22, 0.16] },
  edge: { wash: [0.15, 0.14, 0.13], bands: [0.75, 0.78, 0.8], line: [0.05, 0.05, 0.05] },
  gold: { wash: [0.74, 0.6, 0.34], bands: [0.45, 0.6, 0.75], line: [0.35, 0.24, 0.08] },
  hands: { wash: [0.55, 0.52, 0.48], bands: [0.12, 0.25, 0.42], line: [0.12, 0.11, 0.1] },
  enemy: { wash: [0.06, 0.06, 0.07], bands: [0.88, 0.92, 0.95], line: [0.02, 0.02, 0.02] },
  magic: { wash: [1, 0.62, 0.2], bands: [1, 1, 1], line: [0.6, 0.3, 0.05] },
};

/** Чернила по номеру — в том порядке, в каком их ждёт шейдер. */
export const INK_BY_ID: readonly InkName[] = (Object.keys(INK) as InkName[]).sort((a, b) => INK[a] - INK[b]);

/** Итоговый цвет тона: бумага, на которую положена размывка с плотностью полосы. */
export function washColor(ink: InkName, band: 0 | 1 | 2): RGB {
  const s = INK_STYLE[ink];
  const d = s.bands[band];
  return [PAPER[0] + (s.wash[0] - PAPER[0]) * d, PAPER[1] + (s.wash[1] - PAPER[1]) * d, PAPER[2] + (s.wash[2] - PAPER[2]) * d];
}

/** Яркость по Rec. 709 в пространстве экрана — для правила трёх слоёв. */
export const luminance = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Насыщенность HSV. */
export function saturation(c: RGB): number {
  const max = Math.max(c[0], c[1], c[2]);
  const min = Math.min(c[0], c[1], c[2]);
  return max === 0 ? 0 : (max - min) / max;
}

/** Направление солнца в мире: сверху-сзади-справа, верх граней светлее всего, две стороны в полутоне, две в тени. */
export const SUN_DIR: readonly [number, number, number] = (() => {
  const v = [0.45, 0.85, 0.3];
  const l = Math.sqrt(v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2);
  return [v[0]! / l, v[1]! / l, v[2]! / l] as const;
})();
```

- [ ] **Step 4: Геометрия боксов**

`apps/client/src/render/boxMesh.ts`:
```ts
import type { AABB, RenderBox } from "@doodlemagic/sim";
import { inkOf } from "./palette";

/** Сырые массивы для BufferGeometry: без three.js, поэтому проверяются тестами. */
export interface BoxArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * Грани бокса: нормаль и четыре угла против часовой стрелки, если смотреть снаружи.
 * Угол задан выбором min (0) или max (1) по каждой оси.
 */
const FACES: readonly { n: readonly [number, number, number]; c: readonly (readonly [0 | 1, 0 | 1, 0 | 1])[] }[] = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/** Все боксы одним мешем: 24 вершины и 36 индексов на бокс, нормали плоские — острые рёбра дают контур. */
export function buildBoxArrays(boxes: readonly AABB[]): BoxArrays {
  const positions = new Float32Array(boxes.length * 24 * 3);
  const normals = new Float32Array(boxes.length * 24 * 3);
  const indices = new Uint32Array(boxes.length * 36);
  let v = 0;
  let i = 0;
  for (const b of boxes) {
    for (const face of FACES) {
      const base = v;
      for (const [cx, cy, cz] of face.c) {
        positions[v * 3] = cx ? b.max.x : b.min.x;
        positions[v * 3 + 1] = cy ? b.max.y : b.min.y;
        positions[v * 3 + 2] = cz ? b.max.z : b.min.z;
        normals[v * 3] = face.n[0];
        normals[v * 3 + 1] = face.n[1];
        normals[v * 3 + 2] = face.n[2];
        v++;
      }
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i);
      i += 6;
    }
  }
  return { positions, normals, indices };
}

/** Боксы арены по номерам чернил: одна корзина — один draw call. */
export function groupByInk(render: readonly RenderBox[]): Map<number, AABB[]> {
  const out = new Map<number, AABB[]>();
  for (const r of render) {
    const ink = inkOf(r.material);
    const list = out.get(ink);
    if (list) list.push(r.box);
    else out.set(ink, [r.box]);
  }
  return out;
}
```

- [ ] **Step 5: Пресеты и автовыбор**

`apps/client/src/render/quality.ts`. Как работает автовыбор:
- стартует с «Высокого»;
- первые 0,5 с пропускает (догрузка), потом 1,5 с меряет медиану времени кадра;
- если медиана дольше 1000/55 мс, спускается на пресет ниже и меряет заново;
- укладывается в 6 с.

Медиана не реагирует на одиночные фризы.
```ts
/** Пресеты качества (GDD 6, сводная таблица арт-директора). Частицы, свет магии и bloom появятся в фазах 2 и 5. */
export type PresetId = "low" | "medium" | "high";

export interface Preset {
  id: PresetId;
  label: string;
  /** Доля разрешения экрана, в которой рисуется кадр. */
  renderScale: number;
  /** Потолок devicePixelRatio. */
  maxPixelRatio: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  low: { id: "low", label: "Низкое", renderScale: 0.67, maxPixelRatio: 1 },
  medium: { id: "medium", label: "Среднее", renderScale: 0.85, maxPixelRatio: 1.25 },
  high: { id: "high", label: "Высокое", renderScale: 1, maxPixelRatio: 1.5 },
};

export const PRESET_ORDER: readonly PresetId[] = ["low", "medium", "high"];

export function isPresetId(x: unknown): x is PresetId {
  return x === "low" || x === "medium" || x === "high";
}

/** Итоговый pixelRatio рендера для пресета и экрана. */
export function pixelRatioFor(p: Preset, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, p.maxPixelRatio) * p.renderScale;
}

export interface AutoQualityOptions {
  /** Первые кадры после старта или смены пресета не меряем: там догрузка и компиляция. */
  settleMs: number;
  /** Окно, по которому берём медиану времени кадра. */
  windowMs: number;
  /** Если медиана дольше — пресет ниже. 1000/55: на мониторе 60 Гц это пропуски кадров. */
  slowFrameMs: number;
  /** Автовыбор длится не дольше этого. */
  maxMs: number;
}

export const AUTO_QUALITY: AutoQualityOptions = { settleMs: 500, windowMs: 1500, slowFrameMs: 1000 / 55, maxMs: 6000 };

export interface AutoQuality {
  readonly preset: PresetId;
  readonly done: boolean;
  /** Время очередного кадра, мс. Возвращает новый пресет, если пора переключиться, иначе null. */
  push(frameMs: number): PresetId | null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** Автовыбор пресета по времени кадра за первые секунды: начинаем с высокого и спускаемся, пока не уложимся. */
export function createAutoQuality(start: PresetId = "high", o: AutoQualityOptions = AUTO_QUALITY): AutoQuality {
  let preset = start;
  let done = false;
  let total = 0;
  let sinceSwitch = 0;
  let samples: number[] = [];
  return {
    get preset() {
      return preset;
    },
    get done() {
      return done;
    },
    push(frameMs) {
      if (done) return null;
      total += frameMs;
      sinceSwitch += frameMs;
      if (sinceSwitch > o.settleMs) samples.push(frameMs);
      if (sinceSwitch >= o.settleMs + o.windowMs) {
        const slow = median(samples) > o.slowFrameMs;
        const idx = PRESET_ORDER.indexOf(preset);
        if (slow && idx > 0) {
          preset = PRESET_ORDER[idx - 1]!;
          sinceSwitch = 0;
          samples = [];
          if (total >= o.maxMs) done = true;
          return preset;
        }
        done = true;
      } else if (total >= o.maxMs) {
        done = true;
      }
      return null;
    },
  };
}
```

- [ ] **Step 6: Счётчик FPS**

`apps/client/src/render/fpsMeter.ts`:
```ts
/** Скользящая оценка FPS для отладочного угла: среднее за последние полсекунды. */
export interface FpsMeter {
  push(frameMs: number): void;
  readonly fps: number;
  readonly frameMs: number;
}

export function createFpsMeter(windowMs = 500): FpsMeter {
  let acc = 0;
  let frames = 0;
  let fps = 0;
  let frameMs = 0;
  return {
    push(dt) {
      acc += dt;
      frames++;
      if (acc >= windowMs) {
        frameMs = acc / frames;
        fps = (frames * 1000) / acc;
        acc = 0;
        frames = 0;
      }
    },
    get fps() {
      return fps;
    },
    get frameMs() {
      return frameMs;
    },
  };
}
```

- [ ] **Step 7: Убедиться, что тесты проходят, и проверить типы**

Run: `pnpm test apps/client/src/render` и `pnpm --filter @doodlemagic/client typecheck`
Expected: PASS — 5 + 4 + 7 + 1 = 17 тестов; типы без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add apps/client/src/render
git commit -m "feat(client): ink palette, box geometry, quality presets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Рендер: G-буфер, стилевой проход, `/render-test`

**Поток:** C (после задачи 6). Проверяется типами, сборкой и живой проверкой в браузере.

**Files:**
- Create: `apps/client/src/render/gbuffer.ts`, `apps/client/src/render/stylePass.ts`, `apps/client/src/render/styleRenderer.ts`, `apps/client/src/render/arenaMeshes.ts`, `apps/client/src/render/testPage.ts`, `apps/client/src/render/canvas.css`
- Modify: `apps/client/src/main.ts` (маршрут `/render-test`)

**Interfaces:**
- Consumes: всё из задачи 6; типы `RenderBox`, `Material` (задача 1); `three` 0.186.1.
- Produces:
  - `gbuffer.ts`:
    - `GBUFFER_VERT`, `GBUFFER_FRAG`;
    - `SunUniform = IUniform<Vector3>`, `worldSun`;
    - `createInkMaterial(ink: number, sun = worldSun): ShaderMaterial`;
  - `stylePass.ts`: `STYLE_VERT`, `STYLE_FRAG`, `createStyleMaterial(gbuffer, depth, near, far): ShaderMaterial`;
  - `styleRenderer.ts`:
    - константы `NEAR = 0.05`, `FAR = 160`, `WORLD_FOV = 70`, `HANDS_FOV = 60`, `OVERLAY_DEPTH_RANGE = 0.02`;
    - `class StyleRenderer(canvas, preset: PresetId)` с полями `gl`, `camera`, `overlayCamera`, `preset` и методами:
      - `setPreset(id)`;
      - `resize()`;
      - `render(world: Scene, overlay?: Scene)`;
      - `warmUp(world, overlay?): Promise<void>`;
      - `drawCalls(): number`;
      - `dispose()`;
  - `arenaMeshes.ts`: `buildArenaMeshes(render: readonly RenderBox[]): Group` — один меш на чернила;
  - `testPage.ts`: `TEST_BOXES`, `mountRenderTest(root)`;
  - `canvas.css`: `body.game`, `.game-canvas`, `.game-corner`, `.game-loading`;
  - маршрут `/render-test` (`?near=1`, `?preset=low|medium|high`).

- [ ] **Step 1: Материал G-буфера**

`apps/client/src/render/gbuffer.ts`. three.js сам собирает `ShaderMaterial` как GLSL ES 3.00: подставляет `#version 300 es`, `varying`, `gl_FragColor` и встроенные униформы и атрибуты (`modelMatrix`, `normalMatrix`, `position`, `normal`). Поэтому шейдеры ниже пишутся без этих объявлений.
```ts
import { ShaderMaterial, Vector3, type IUniform } from "three";
import { SUN_DIR } from "./palette";

/**
 * Проход 1: каждый меш пишет в G-буфер не цвет, а данные для стилевого прохода:
 * R — освещённость (полуламберт), G — номер чернил / 255, B и A — нормаль в пространстве камеры (xy).
 */
export const GBUFFER_VERT = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vViewNormal;
varying float vTone;

void main() {
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vTone = dot(n, uSunDir) * 0.5 + 0.5;
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GBUFFER_FRAG = /* glsl */ `
uniform float uInk;
varying vec3 vViewNormal;
varying float vTone;

void main() {
  vec3 n = normalize(vViewNormal);
  gl_FragColor = vec4(clamp(vTone, 0.0, 1.0), uInk / 255.0, n.xy * 0.5 + 0.5);
}
`;

export type SunUniform = IUniform<Vector3>;

/** Солнце мира: общая униформа всех мешей арены. */
export const worldSun: SunUniform = { value: new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) };

/** Материал G-буфера для чернил `ink`. Руки передают своё солнце — в пространстве камеры. */
export function createInkMaterial(ink: number, sun: SunUniform = worldSun): ShaderMaterial {
  return new ShaderMaterial({
    name: `ink-${ink}`,
    uniforms: { uInk: { value: ink }, uSunDir: sun },
    vertexShader: GBUFFER_VERT,
    fragmentShader: GBUFFER_FRAG,
  });
}
```

- [ ] **Step 2: Стилевой проход**

`apps/client/src/render/stylePass.ts`. Порядок в шейдере:
1. **Контур:**
   - по глубине — лапласиан обратной дальности, относительно самой дальности;
   - по излому нормали;
   - по смене чернил.

   Цвет линии берётся у ближайшего к камере соседа, у рук линия толще.
2. **Размывка** — три тона с дрожащим по шуму порогом.
3. **Бумага** — зерно из двух октав шума в «пикселях 900p».
4. **Туман** — по дальности (18–75 м) и «пустота» ниже пола до цвета бумаги. Линии гаснут вместе с туманом.
5. **Небо** там, где нет геометрии: градиент туши к зениту, облака-мазки, два слоя гор, растворяющихся у подножия; нижняя полусфера — чистая бумага.

Всего 10 выборок текстуры.
```ts
import { Matrix4, ShaderMaterial, Vector2, Vector3, type DepthTexture, type Texture } from "three";
import { INK, INK_BY_ID, INK_COUNT, INK_STYLE, PAPER } from "./palette";

export const STYLE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Проход 2, единственный полноэкранный: контур, три тона размывки, зерно бумаги, туман к цвету бумаги
 * и небо там, где нет геометрии. 10 выборок текстуры (бюджет арт-директора — 13).
 */
export const STYLE_FRAG = /* glsl */ `
uniform sampler2D tG;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uPx;
uniform float uNear;
uniform float uFar;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uPaper;
uniform vec3 uSkyInk;
uniform vec2 uFog;
uniform vec3 uInkWash[INK_COUNT];
uniform vec3 uInkBands[INK_COUNT];
uniform vec3 uInkLine[INK_COUNT];
varying vec2 vUv;

// целочисленный хеш: одинаково на всех GPU, без sin()
uint hashU(uvec2 q) {
  uint h = q.x * 2654435769u ^ (q.y + 0x9e3779b9u) * 2246822519u;
  h ^= h >> 15;
  h *= 3266489917u;
  h ^= h >> 13;
  return h;
}

float hash(vec2 p) {
  return float(hashU(uvec2(ivec2(floor(p)) + 32768))) / 4294967295.0;
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// расстояние вдоль взгляда по значению буфера глубины
float viewDist(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

int inkAt(vec4 g) {
  return int(g.g * 255.0 + 0.5);
}

vec3 normalAt(vec4 g) {
  vec2 xy = g.ba * 2.0 - 1.0;
  return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

// туман по дальности и «пустота» ниже пола: ущелье растворяется в бумаге
float fogAt(float d) {
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 vp = v.xyz / v.w;
  vec3 w = (uCamWorld * vec4(vp, 1.0)).xyz;
  return max(0.85 * smoothstep(uFog.x, uFog.y, -vp.z), smoothstep(-0.5, -9.0, w.y));
}

vec3 skyColor(vec3 dir, vec3 paper) {
  float e = dir.y;
  vec3 col = mix(paper, uSkyInk, 0.3 * smoothstep(0.02, 0.85, e));
  vec2 c = dir.xz / max(1e-4, length(dir.xz));
  // облака — длинные горизонтальные мазки
  float cl = noise(vec2(c.x * 2.5 + c.y * 4.0 + 40.0, e * 14.0 + 10.0));
  col = mix(col, uSkyInk, 0.12 * smoothstep(0.62, 0.8, cl) * smoothstep(0.08, 0.3, e));
  // два слоя гор: дальний светлее и выше; у подножия оба растворяются в бумаге
  float farRidge = 0.05 + 0.11 * noise(c * 2.2 + 17.0) + 0.03 * noise(c * 7.0 + 3.0);
  float nearRidge = 0.015 + 0.06 * noise(c * 3.1 + 61.0) + 0.02 * noise(c * 11.0 + 9.0);
  float fade = smoothstep(-0.06, 0.04, e);
  col = mix(col, uSkyInk, 0.22 * fade * (1.0 - smoothstep(farRidge - 0.002, farRidge + 0.002, e)));
  col = mix(col, uSkyInk, 0.4 * fade * (1.0 - smoothstep(nearRidge - 0.002, nearRidge + 0.002, e)));
  return col;
}

void main() {
  vec2 px = 1.0 / uRes;
  vec4 gC = texture(tG, vUv);
  float dC = texture(tDepth, vUv).r;
  int inkC = inkAt(gC);
  bool skyC = dC >= 1.0;

  // руки обведены толще: радиус выборки вдвое больше со стороны руки — в сумме линия в 1,5 раза толще
  float r = uPx * (inkC == INK_HANDS ? 2.0 : 1.0);
  vec2 ox = vec2(r * px.x, 0.0);
  vec2 oy = vec2(0.0, r * px.y);
  vec4 gL = texture(tG, vUv - ox);
  vec4 gR = texture(tG, vUv + ox);
  vec4 gD = texture(tG, vUv - oy);
  vec4 gU = texture(tG, vUv + oy);
  float dL = texture(tDepth, vUv - ox).r;
  float dR = texture(tDepth, vUv + ox).r;
  float dD = texture(tDepth, vUv - oy).r;
  float dU = texture(tDepth, vUv + oy).r;

  // контур по глубине: лапласиан обратной дальности равен нулю на любой плоскости,
  // поэтому пол под острым углом линий не даёт, а дальние силуэты остаются чёткими
  float iC = 1.0 / viewDist(dC);
  float lap = abs(1.0 / viewDist(dL) + 1.0 / viewDist(dR) - 2.0 * iC) + abs(1.0 / viewDist(dD) + 1.0 / viewDist(dU) - 2.0 * iC);
  float edge = smoothstep(0.08, 0.25, lap / iC);

  // контур по излому нормали: острые рёбра боксов
  if (!skyC) {
    vec3 nC = normalAt(gC);
    float bend = max(max(1.0 - dot(nC, normalAt(gL)), 1.0 - dot(nC, normalAt(gR))), max(1.0 - dot(nC, normalAt(gD)), 1.0 - dot(nC, normalAt(gU))));
    edge = max(edge, smoothstep(0.15, 0.4, bend));
  }

  // граница разных чернил на одной плоскости — тоже линия, но тоньше
  if (inkAt(gL) != inkC || inkAt(gR) != inkC || inkAt(gD) != inkC || inkAt(gU) != inkC) edge = max(edge, 0.7);

  // цвет линии — у ближайшего к камере соседа, чтобы силуэт рисовался тушью переднего предмета
  float dMin = dC;
  int inkN = inkC;
  if (dL < dMin) { dMin = dL; inkN = inkAt(gL); }
  if (dR < dMin) { dMin = dR; inkN = inkAt(gR); }
  if (dD < dMin) { dMin = dD; inkN = inkAt(gD); }
  if (dU < dMin) { dMin = dU; inkN = inkAt(gU); }
  // трава — мазки почти без контура
  if (inkN == INK_GRASS) edge *= 0.3;

  // координаты бумаги в «пикселях 900p»: узор не зависит от разрешения рендера
  vec2 pp = gl_FragCoord.xy / uPx;
  float grain = noise(pp * 0.8) * 0.55 + noise(pp * 0.21) * 0.45;
  vec3 paper = uPaper * (0.955 + 0.06 * grain);

  vec3 col;
  float fog = 0.0;
  if (skyC) {
    vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    col = skyColor(normalize(mat3(uCamWorld) * (v.xyz / v.w)), paper);
  } else {
    // три тона размывки; порог чуть дрожит по шуму, чтобы граница тона была мазком, а не линейкой
    float t = gC.r + (noise(pp * 0.06) - 0.5) * 0.08;
    vec3 bands = uInkBands[inkC];
    // пороги 0,5 и 0,82 не совпадают с тонами граней боксов (0,28 / 0,35 / 0,65 / 0,72 / 0,92)
    float density = mix(bands.z, bands.y, smoothstep(0.47, 0.53, t));
    density = mix(density, bands.x, smoothstep(0.8, 0.84, t));
    density *= 0.96 + 0.08 * noise(pp * 0.02 + 7.0);
    col = mix(paper, uInkWash[inkC], clamp(density, 0.0, 1.0));
    fog = fogAt(dC);
    col = mix(col, paper, fog);
  }

  float lineFog = dMin < 1.0 ? fogAt(dMin) : 0.0;
  float ink = edge * (0.75 + 0.25 * noise(pp * 0.4)) * (1.0 - lineFog);
  col = mix(col, uInkLine[inkN], clamp(ink, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

const v3 = (c: readonly [number, number, number]) => new Vector3(c[0], c[1], c[2]);

/** Материал стилевого прохода. Матрицы и размер обновляет StyleRenderer. */
export function createStyleMaterial(gbuffer: Texture, depth: DepthTexture, near: number, far: number): ShaderMaterial {
  return new ShaderMaterial({
    name: "style-pass",
    defines: { INK_COUNT, INK_HANDS: INK.hands, INK_GRASS: INK.grass },
    uniforms: {
      tG: { value: gbuffer },
      tDepth: { value: depth },
      uRes: { value: new Vector2(1, 1) },
      uPx: { value: 1 },
      uNear: { value: near },
      uFar: { value: far },
      uProjInv: { value: new Matrix4() },
      uCamWorld: { value: new Matrix4() },
      uPaper: { value: v3(PAPER) },
      uSkyInk: { value: new Vector3(0.36, 0.38, 0.42) },
      uFog: { value: new Vector2(18, 75) },
      uInkWash: { value: INK_BY_ID.map((n) => v3(INK_STYLE[n].wash)) },
      uInkBands: { value: INK_BY_ID.map((n) => v3(INK_STYLE[n].bands)) },
      uInkLine: { value: INK_BY_ID.map((n) => v3(INK_STYLE[n].line)) },
    },
    vertexShader: STYLE_VERT,
    fragmentShader: STYLE_FRAG,
    depthTest: false,
    depthWrite: false,
  });
}
```

- [ ] **Step 3: Рендерер**

`apps/client/src/render/styleRenderer.ts`:
- G-буфер — `WebGLRenderTarget` RGBA8 с `DepthTexture` float и фильтром nearest: номер чернил нельзя интерполировать;
- холсту буфер глубины не нужен (`depth: false`): на него рисуется только стилевой проход;
- пресет меняет `pixelRatio` холста;
- прогрев компилирует программы с тем же целевым буфером, что и в игре (иначе three соберёт их второй раз при первом кадре), и рисует один кадр.
```ts
import {
  DepthTexture,
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type ShaderMaterial,
} from "three";
import { PRESETS, pixelRatioFor, type Preset, type PresetId } from "./quality";
import { createStyleMaterial } from "./stylePass";

export const NEAR = 0.05;
export const FAR = 160;
/** Вертикальный FOV мира и рук (у рук свой, чтобы не тянулись по краям). */
export const WORLD_FOV = 70;
export const HANDS_FOV = 60;
/**
 * Руки пишут глубину только в самое начало диапазона [0; 0,02]: они всегда перед миром и потому не уходят в стену,
 * но друг друга перекрывают правильно. Глубину мира при этом не стираем — она нужна стилевому проходу.
 */
export const OVERLAY_DEPTH_RANGE = 0.02;

/**
 * Рендер «Тушь и свет»: G-буфер (RGBA8 + глубина float) и один стилевой проход на экран.
 * Второй слой (руки) рисуется в тот же G-буфер со своей камерой и сжатым диапазоном глубины.
 */
export class StyleRenderer {
  readonly gl: WebGLRenderer;
  readonly camera = new PerspectiveCamera(WORLD_FOV, 1, NEAR, FAR);
  readonly overlayCamera = new PerspectiveCamera(HANDS_FOV, 1, NEAR, FAR);
  preset: Preset;
  private readonly target: WebGLRenderTarget;
  private readonly post: ShaderMaterial;
  private readonly postScene = new Scene();
  private readonly postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new Vector2();

  constructor(canvas: HTMLCanvasElement, preset: PresetId) {
    this.preset = PRESETS[preset];
    this.gl = new WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
    this.gl.autoClear = false;
    this.gl.info.autoReset = false;
    const depth = new DepthTexture(1, 1, FloatType);
    this.target = new WebGLRenderTarget(1, 1, {
      type: UnsignedByteType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: depth,
    });
    this.post = createStyleMaterial(this.target.texture, depth, NEAR, FAR);
    const quad = new Mesh(new PlaneGeometry(2, 2), this.post);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.resize();
  }

  setPreset(id: PresetId): void {
    if (this.preset.id === id) return;
    this.preset = PRESETS[id];
    this.resize();
  }

  /** Подгоняет холст, G-буфер и камеры под окно и пресет. Вызывать на `resize`. */
  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.gl.setPixelRatio(pixelRatioFor(this.preset, window.devicePixelRatio));
    this.gl.setSize(w, h, true);
    this.gl.getDrawingBufferSize(this.size);
    this.target.setSize(this.size.x, this.size.y);
    for (const cam of [this.camera, this.overlayCamera]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    const u = this.post.uniforms;
    u.uRes!.value.copy(this.size);
    u.uPx!.value = Math.max(1, this.size.y / 900);
  }

  /** Кадр: мир и (необязательно) руки в G-буфер, потом стилевой проход на экран. */
  render(world: Scene, overlay?: Scene): void {
    const gl = this.gl;
    gl.info.reset();
    gl.setRenderTarget(this.target);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, false);
    gl.render(world, this.camera);
    if (overlay) {
      const ctx = gl.getContext();
      ctx.depthRange(0, OVERLAY_DEPTH_RANGE);
      gl.render(overlay, this.overlayCamera);
      ctx.depthRange(0, 1);
    }
    gl.setRenderTarget(null);
    const u = this.post.uniforms;
    u.uProjInv!.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld!.value.copy(this.camera.matrixWorld);
    gl.render(this.postScene, this.postCamera);
  }

  /**
   * Прогрев: компилирует все шейдеры до первого кадра (с тем же целевым буфером, что и в игре, чтобы
   * three не собрал программу заново) и рисует один кадр, чтобы геометрия ушла в видеопамять.
   */
  async warmUp(world: Scene, overlay?: Scene): Promise<void> {
    this.gl.setRenderTarget(this.target);
    await this.gl.compileAsync(world, this.camera);
    if (overlay) await this.gl.compileAsync(overlay, this.overlayCamera);
    this.gl.setRenderTarget(null);
    await this.gl.compileAsync(this.postScene, this.postCamera);
    this.render(world, overlay);
  }

  /** Вызовы отрисовки за последний кадр (все проходы). */
  drawCalls(): number {
    return this.gl.info.render.calls;
  }

  dispose(): void {
    this.target.dispose();
    this.post.dispose();
    this.gl.dispose();
  }
}
```

- [ ] **Step 4: Меши арены**

`apps/client/src/render/arenaMeshes.ts`:
```ts
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
```

- [ ] **Step 5: Тестовая страница**

`apps/client/src/render/canvas.css`:
```css
/* Полноэкранный холст игры. Подключается только игровыми страницами, /nettest не трогает. */
body.game {
  margin: 0;
  overflow: hidden;
  background: #f2ede0;
  color: #1d1b16;
  overscroll-behavior: none;
}
body.game #app {
  max-width: none;
  margin: 0;
  padding: 0;
}
.game-canvas {
  position: fixed;
  inset: 0;
  display: block;
  width: 100vw;
  height: 100vh;
  touch-action: none;
  cursor: crosshair;
}
.game-corner {
  position: fixed;
  top: 8px;
  left: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(29, 27, 22, 0.72);
  color: #f6f3ea;
  font: 13px/1.4 ui-monospace, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  white-space: pre;
}
.game-loading {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  font: 600 20px/1.4 system-ui, sans-serif;
  color: #1d1b16;
  background: #f2ede0;
}
```

`apps/client/src/render/testPage.ts`:
```ts
import { BoxGeometry, Mesh, Scene, Vector3 } from "three";
import type { Material, RenderBox } from "@doodlemagic/sim";
import "./canvas.css";
import { buildArenaMeshes } from "./arenaMeshes";
import { createFpsMeter } from "./fpsMeter";
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

/** Проба второго слоя: светлый кубик в углу кадра, как будущие руки. Должен рисоваться поверх мира всегда. */
function overlayProbe(): Scene {
  const scene = new Scene();
  const sun = { value: new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) };
  const probe = new Mesh(new BoxGeometry(0.12, 0.12, 0.12), createInkMaterial(INK.hands, sun));
  probe.position.set(0.25, -0.18, -0.6);
  probe.rotation.set(0.4, 0.6, 0);
  scene.add(probe);
  return scene;
}

/**
 * /render-test — проверка рендера без игры. Камера медленно облетает сцену.
 * ?near=1 — камера в 0,4 м от стены: проба второго слоя всё равно видна целиком.
 * ?preset=low|medium|high — пресет без автовыбора.
 */
export function mountRenderTest(root: HTMLElement): void {
  document.body.classList.add("game");
  root.innerHTML = `<canvas class="game-canvas"></canvas><div class="game-corner"></div><div class="game-loading">Загрузка…</div>`;
  const canvas = root.querySelector<HTMLCanvasElement>(".game-canvas")!;
  const corner = root.querySelector<HTMLElement>(".game-corner")!;
  const loading = root.querySelector<HTMLElement>(".game-loading")!;
  const params = new URLSearchParams(location.search);
  const near = params.has("near");
  const fixed = params.get("preset");

  const renderer = new StyleRenderer(canvas, isPresetId(fixed) ? fixed : "high");
  const world = new Scene();
  world.add(buildArenaMeshes(TEST_BOXES));
  const overlay = overlayProbe();
  window.addEventListener("resize", () => renderer.resize());

  const auto = isPresetId(fixed) ? null : createAutoQuality();
  const meter = createFpsMeter();
  let last = 0;
  let angle = 0.6;

  const frame = (now: number): void => {
    const dt = Math.max(0, Math.min(100, now - last));
    last = now;
    angle += dt * 0.0001;
    if (near) {
      renderer.camera.position.set(-9.2, 1.6, -5);
      renderer.camera.lookAt(-10, 1.6, -5);
    } else {
      renderer.camera.position.set(Math.sin(angle) * 16, 4, Math.cos(angle) * 16);
      renderer.camera.lookAt(0, 0.5, 0);
    }
    renderer.render(world, overlay);
    meter.push(dt);
    const next = auto?.push(dt);
    if (next) renderer.setPreset(next);
    corner.textContent =
      `FPS ${meter.fps.toFixed(0)} · ${meter.frameMs.toFixed(1)} мс\n` +
      `${renderer.preset.label}${auto && !auto.done ? " (подбор)" : ""} · вызовов ${renderer.drawCalls()}`;
    requestAnimationFrame(frame);
  };

  void renderer.warmUp(world, overlay).then(() => {
    loading.remove();
    last = performance.now();
    requestAnimationFrame(frame);
  });
}
```

`apps/client/src/main.ts` (заменить целиком; добавлен только маршрут `/render-test`):
```ts
import "./style.css";
import { mountNettest } from "./nettest/page";

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");

if (location.pathname.startsWith("/nettest")) {
  mountNettest(app);
} else if (location.pathname.startsWith("/render-test")) {
  // three.js грузится отдельным чанком только для игровых страниц
  void import("./render/testPage").then((m) => m.mountRenderTest(app));
} else {
  app.innerHTML = `
    <section class="card">
      <h1>DoodleMagic</h1>
      <p>Магическая арена от первого лица. Скоро.</p>
      <p><a class="btn" href="/nettest?host=1">Я организатор: открыть тест связи</a></p>
      <p><a class="btn secondary" href="/nettest">Меня позвали: пройти тест</a></p>
    </section>`;
}
```

- [ ] **Step 6: Проверить типы, тесты и сборку**

Run: `pnpm --filter @doodlemagic/client typecheck`, `pnpm test`, `pnpm build:client`
Expected:
- типы без ошибок, тесты зелёные;
- в `apps/client/dist/assets/` есть отдельный чанк с three.js — около 540 кБ, 136 кБ в gzip.

Предупреждение Vite «Some chunks are larger than 500 kB» ожидаемо: это three.js целиком. Весь `dist/assets` меньше 1 МБ — бюджет 3 МБ соблюдён.

- [ ] **Step 7: Коммит**

```bash
git add apps/client/src/render apps/client/src/main.ts
git commit -m "feat(client): ink-and-light renderer v0 and /render-test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Живая проверка в браузере (контролёр)**

Запустить dev-сервер `client` из `.claude/launch.json` и открыть `http://localhost:5173/render-test`.
1. Первые доли секунды — «Загрузка…» на цвете бумаги, потом сцена. Ожидаемый кадр:
   - фон — тёплая бумага с мелким зерном;
   - вверху светлый серо-голубой градиент, у горизонта два слоя гор, нижний темнее, оба растворяются книзу;
   - у боксов тёмный контур, верх светлее всего, две стороны в полутоне, две в тени;
   - площадка в центре охристая; вдоль обрыва тёмная кромка;
   - по бокам моста пустота белая, обрывы книзу растворяются в бумаге;
   - кочки травы оливковые, почти без контура;
   - в правом нижнем углу светлый кубик с толстым контуром — проба второго слоя.
2. Угол слева сверху:
   - первые ~2 с — `Высокое (подбор)`, потом `Высокое` (на медленной машине пресет станет ниже);
   - FPS — частота монитора;
   - `вызовов 8` (6 чернил + проба + стилевой проход); при облёте бывает меньше, если меш вне кадра.
3. `http://localhost:5173/render-test?near=1`: стена в тени занимает почти весь кадр, кубик-проба виден целиком поверх стены.
4. `?preset=low`: линии мягче, картинка чуть размыта, FPS не ниже, чем на `high`.
5. Изменить размер окна: картинка не растягивается, линии остаются тонкими.
6. В консоли нет ошибок компиляции шейдеров.

---

### Task 8: Песочница на `/`

**Поток:** последовательно, после слияния потоков A, B и C.

**Files:**
- Create: `apps/client/src/sandbox/controls.ts`, `fixedStep.ts`, `respawn.ts`, `settings.ts`, `input.ts`, `hud.ts`, `page.ts`, `sandbox.css`
- Modify: `apps/client/src/main.ts` (`/` → песочница)
- Test:
  - `apps/client/src/sandbox/controls.test.ts`, `fixedStep.test.ts`, `respawn.test.ts`, `settings.test.ts`;
  - `packages/arena/src/gallery.sim.test.ts` — стык потоков A и B.

**Interfaces:**
- Consumes:
  - из `@doodlemagic/sim`: `createWorld`, `stepPlayer`, `createPlayer`, `lerpVec`, `bodyBox`, `volumeAt`, `lineOfSight`, `groundBelow`, `isFree`, `NO_INPUT`, `EYE_HEIGHT`, `TICK_DT`, `PLAYER_HALF_W`, `PLAYER_HEIGHT`, `PLAYER_STEP` и типы;
  - из `@doodlemagic/arena`: `buildGallery`, `GALLERY`;
  - из `render/*`: `StyleRenderer`, `buildArenaMeshes`, `createAutoQuality`, `AutoQuality`, `createFpsMeter`, `isPresetId`, `PRESETS`, `PRESET_ORDER`, `PresetId`, `canvas.css`.
- Produces:
  - `controls.ts`:
    - `KEYS = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", jump: "Space", debug: "Backquote" }`, `GAME_KEYS`;
    - `BASE_SENSITIVITY = 0.0022`, `SENS_MIN = 0.25`, `SENS_MAX = 3`, `MAX_MOUSE_STEP_PX = 300`;
    - `Look { yaw; pitch }`;
    - `moveAxes(down)`, `applyLook(look, dx, dy, sensitivity)`, `buildInput(down, look): PlayerInput`, `clampSensitivity(x)`;
  - `fixedStep.ts`: `ClockStep { ticks; acc; alpha }`, `MAX_TICKS_PER_FRAME = 5`, `advanceClock(acc, frameS, tickS, maxTicks?)`;
  - `respawn.ts`: `shouldRespawn(world, state, arena)`, `nextSpawnIndex(index, count, stride = 3)`, `spawnPlayer(arena, index)`;
  - `settings.ts`: `QualityChoice = "auto" | PresetId`, `Settings { sensitivity; quality }`, `DEFAULT_SETTINGS`, `parseSettings(raw)`, `loadSettings()`, `saveSettings(s)`;
  - `input.ts`: `InputDevice { down; locked; takeMouse(); requestLock(); onLockChange(cb); onPress(code, cb); dispose() }`, `createInput(canvas)`;
  - `hud.ts`:
    - `HINT = "Клик — захват мыши, WASD — ходить, пробел — прыжок, Esc — меню"`;
    - `Hud { canvas; setLocked; setLoading; debugVisible; toggleDebug; setDebugText; onPlay; onQuality; onSensitivity }`, `createHud(root, settings)`;
  - `page.ts`: `mountSandbox(root)`; маршрут `/` (`?arena=compact` — компактный вариант).

- [ ] **Step 1: Написать падающие тесты**

`apps/client/src/sandbox/controls.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { KEYS, MAX_MOUSE_STEP_PX, applyLook, buildInput, clampSensitivity, moveAxes } from "./controls";

describe("moveAxes", () => {
  it("maps WASD by physical key codes", () => {
    expect(moveAxes(new Set(["KeyW", "KeyD"]))).toEqual({ moveX: 1, moveZ: 1 });
    expect(moveAxes(new Set(["KeyS", "KeyA"]))).toEqual({ moveX: -1, moveZ: -1 });
    expect(moveAxes(new Set(["KeyW", "KeyS"]))).toEqual({ moveX: 0, moveZ: 0 });
  });

  it("ignores Ctrl and layout-dependent keys", () => {
    expect(moveAxes(new Set(["ControlLeft", "ц"]))).toEqual({ moveX: 0, moveZ: 0 });
    expect(Object.values(KEYS).some((k) => k.startsWith("Control"))).toBe(false);
  });
});

describe("applyLook", () => {
  it("turns right on positive dx and looks up on negative dy", () => {
    const l = applyLook({ yaw: 0, pitch: 0 }, 100, -50, 1);
    expect(l.yaw).toBeCloseTo(-0.22, 9);
    expect(l.pitch).toBeCloseTo(0.11, 9);
  });

  it("clamps pitch and wraps yaw", () => {
    expect(applyLook({ yaw: 0, pitch: 0 }, 0, -290, 3).pitch).toBeLessThan(Math.PI / 2);
    expect(applyLook({ yaw: 0, pitch: 1.5 }, 0, -290, 3).pitch).toBeCloseTo(Math.PI / 2 - 0.01, 9);
    expect(applyLook({ yaw: 3.1, pitch: 0 }, -200, 0, 1).yaw).toBeLessThan(-2.7);
  });

  it("drops pointer-lock spikes", () => {
    const l = { yaw: 0.3, pitch: 0.1 };
    expect(applyLook(l, MAX_MOUSE_STEP_PX + 1, 0, 1)).toBe(l);
  });
});

describe("buildInput", () => {
  it("is plain data with the jump key and the look", () => {
    expect(buildInput(new Set(["Space", "KeyW"]), { yaw: 1, pitch: -0.2 })).toEqual({ moveX: 0, moveZ: 1, jump: true, yaw: 1, pitch: -0.2 });
  });
});

describe("clampSensitivity", () => {
  it("keeps the multiplier in range", () => {
    expect(clampSensitivity(10)).toBe(3);
    expect(clampSensitivity(0)).toBe(0.25);
    expect(clampSensitivity(Number.NaN)).toBe(1);
  });
});
```

`apps/client/src/sandbox/fixedStep.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MAX_TICKS_PER_FRAME, advanceClock } from "./fixedStep";

const TICK = 1 / 60;

function run(frameS: number, frames: number): number[] {
  let acc = 0;
  const ticks: number[] = [];
  for (let k = 0; k < frames; k++) {
    const s = advanceClock(acc, frameS, TICK);
    acc = s.acc;
    ticks.push(s.ticks);
    expect(s.alpha).toBeGreaterThanOrEqual(0);
    expect(s.alpha).toBeLessThan(1);
  }
  return ticks;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("advanceClock", () => {
  it("runs one tick per frame at 60 FPS", () => {
    expect(run(1 / 60, 120).every((t) => t === 1)).toBe(true);
  });

  it("keeps 60 ticks per second at 144 and 30 FPS", () => {
    expect(sum(run(1 / 144, 144))).toBeGreaterThanOrEqual(59);
    expect(sum(run(1 / 144, 144))).toBeLessThanOrEqual(60);
    expect(run(1 / 30, 30).every((t) => t === 2)).toBe(true);
  });

  it("does not try to catch up after a long freeze", () => {
    const s = advanceClock(0, 2, TICK);
    expect(s.ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(s.acc).toBe(0);
  });

  it("ignores negative frame times", () => {
    expect(advanceClock(0.005, -1, TICK)).toEqual({ ticks: 0, acc: 0.005, alpha: 0.005 / TICK });
  });
});
```

`apps/client/src/sandbox/respawn.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildGallery } from "@doodlemagic/arena";
import { createPlayer, createWorld } from "@doodlemagic/sim";
import { nextSpawnIndex, shouldRespawn, spawnPlayer } from "./respawn";

const arena = buildGallery("full");
const world = createWorld(arena.colliders, arena.volumes);

describe("respawn", () => {
  it("triggers in the gorge kill volume and below the arena, not on the bridge", () => {
    expect(shouldRespawn(world, createPlayer({ x: -4, y: -5, z: 3 }), arena)).toBe(true);
    expect(shouldRespawn(world, createPlayer({ x: 0, y: -40, z: 30 }), arena)).toBe(true);
    expect(shouldRespawn(world, createPlayer({ x: 0, y: 0, z: -3.5 }), arena)).toBe(false);
  });

  it("cycles through all spawns", () => {
    const seen = new Set<number>();
    let i = 0;
    for (let k = 0; k < 10; k++) {
      seen.add(i);
      i = nextSpawnIndex(i, 10);
    }
    expect(seen.size).toBe(10);
  });

  it("places the player at the spawn, facing its direction", () => {
    const s = spawnPlayer(arena, 12);
    expect(s.body.pos).toEqual(arena.spawns[2]!.pos);
    expect(s.yaw).toBe(arena.spawns[2]!.yaw);
  });
});
```

`apps/client/src/sandbox/settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("reads valid settings", () => {
    expect(parseSettings('{"sensitivity":1.5,"quality":"low"}')).toEqual({ sensitivity: 1.5, quality: "low" });
  });

  it("falls back on garbage", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"sensitivity":"x","quality":"ultra"}')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"sensitivity":99}').sensitivity).toBe(3);
  });
});
```

`packages/arena/src/gallery.sim.test.ts`: та же арена глазами настоящей физики потока A. Тест проверяет:
- спауны устойчиво стоят;
- луч по сетке тоже не видит соседние спауны;
- обход пешком по сетке 0,5 м соединяет все спауны с площадкой руны и галереей;
- лестница поднимает на +4 м;
- поток с подруливанием доносит до башни;
- шаг с моста приводит в зону смерти.
```ts
import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT,
  NO_INPUT,
  PLAYER_HALF_W,
  PLAYER_HEIGHT,
  PLAYER_STEP,
  TICK_DT,
  bodyBox,
  createPlayer,
  createWorld,
  groundBelow,
  isFree,
  lineOfSight,
  stepPlayer,
  volumeAt,
  type ArenaData,
  type PlayerInput,
  type PlayerState,
  type Vec3,
  type World,
} from "@doodlemagic/sim";
import { GALLERY, buildGallery } from "./gallery";

/** Стык потоков A и B: та же арена глазами настоящей физики и луча по сетке. */
const arenas: [string, ArenaData][] = [
  ["full", buildGallery("full")],
  ["compact", buildGallery("compact")],
];

function run(world: World, s: PlayerState, inp: PlayerInput, ticks: number, each?: (s: PlayerState) => void): PlayerState {
  for (let t = 0; t < ticks; t++) {
    s = stepPlayer(s, inp, TICK_DT, world);
    each?.(s);
  }
  return s;
}

/** yaw, при котором «вперёд» смотрит из a в b. */
const yawTowards = (a: Vec3, b: Vec3): number => Math.atan2(-(b.x - a.x), -(b.z - a.z));

/** Обход по сетке 0,5 м: куда можно дойти пешком (ступень ≤ 0,55 м, спрыгнуть можно откуда угодно, зона смерти — нет). */
function reachable(world: World, start: Vec3): Vec3[] {
  const step = 0.5;
  const key = (p: Vec3) => `${Math.round(p.x / step)},${Math.round(p.z / step)},${Math.round(p.y * 100)}`;
  const body = (p: Vec3) => ({
    min: { x: p.x - PLAYER_HALF_W, y: p.y, z: p.z - PLAYER_HALF_W },
    max: { x: p.x + PLAYER_HALF_W, y: p.y + PLAYER_HEIGHT, z: p.z + PLAYER_HALF_W },
  });
  const first = { x: Math.round(start.x / step) * step, y: start.y, z: Math.round(start.z / step) * step };
  const seen = new Map<string, Vec3>([[key(first), first]]);
  const queue = [first];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
      const floor = groundBelow(world, { x: p.x + dx, y: p.y + PLAYER_STEP + 0.01, z: p.z + dz }, 30);
      if (floor === null || floor > p.y + PLAYER_STEP) continue;
      const q = { x: p.x + dx, y: floor, z: p.z + dz };
      if (seen.has(key(q)) || !isFree(world, body(q)) || volumeAt(world, body(q), "kill")) continue;
      seen.set(key(q), q);
      queue.push(q);
    }
  }
  return [...seen.values()];
}

describe.each(arenas)("gallery with the real physics (%s)", (_name, arena) => {
  const world = createWorld(arena.colliders, arena.volumes);

  it("lets every spawn stand still on the floor", () => {
    for (const sp of arena.spawns) {
      const s = run(world, createPlayer(sp.pos, sp.yaw), NO_INPUT, 30);
      expect(s.onGround).toBe(true);
      expect(s.body.pos.x).toBeCloseTo(sp.pos.x, 9);
      expect(s.body.pos.y).toBeCloseTo(sp.pos.y, 9);
      expect(s.body.pos.z).toBeCloseTo(sp.pos.z, 9);
    }
  });

  it("hides spawns from each other for the grid raycast too", () => {
    const eye = (p: Vec3) => ({ x: p.x, y: p.y + EYE_HEIGHT, z: p.z });
    for (const a of arena.spawns) for (const b of arena.spawns) if (a !== b) expect(lineOfSight(world, eye(a.pos), eye(b.pos))).toBe(false);
  });

  it("connects every spawn on foot with the rune platform and the gallery deck", () => {
    const deck = (p: Vec3) => Math.abs(p.y - GALLERY.deckY) < 1e-6 && Math.abs(p.z) < 1.5;
    const rune = (p: Vec3) => Math.abs(p.y) < 1e-6 && Math.abs(p.x) <= 1.5 && Math.abs(p.z) <= 1.5;
    const all = reachable(world, arena.spawns[0]!.pos);
    expect(all.some(deck)).toBe(true);
    expect(all.some(rune)).toBe(true);
    const keys = new Set(all.map((p) => `${p.x},${p.z}`));
    for (const sp of arena.spawns) expect(keys.has(`${Math.round(sp.pos.x * 2) / 2},${Math.round(sp.pos.z * 2) / 2}`)).toBe(true);
  });

  it("climbs the stairs to the gallery", () => {
    const from = { x: -13, y: 0, z: -8 };
    let maxY = 0;
    run(world, createPlayer(from), { ...NO_INPUT, moveZ: 1, yaw: Math.PI }, 120, (s) => {
      if (s.onGround) maxY = Math.max(maxY, s.body.pos.y);
    });
    expect(maxY).toBeCloseTo(GALLERY.deckY, 6);
  });
});

describe("gallery traversal (full)", () => {
  const arena = buildGallery("full");
  const world = createWorld(arena.colliders, arena.volumes);

  it("lifts the player from the updraft onto the tower", () => {
    // игрок рулит к центру башни, а над ней гасит скорость обратным ходом — управление в воздухе 60 %
    const target = { x: 13.5, y: 0, z: 0 };
    let s = createPlayer({ x: 16.45, y: 0, z: -3.2 });
    for (let t = 0; t < 180; t++) {
      const p = s.body.pos;
      const far = Math.hypot(target.x - p.x, target.z - p.z) > 1;
      const moving = Math.hypot(s.body.vel.x, s.body.vel.z) > 0.5;
      const inp: PlayerInput = far
        ? { ...NO_INPUT, moveZ: 1, yaw: yawTowards(p, target) }
        : moving
          ? { ...NO_INPUT, moveZ: -1, yaw: yawTowards({ x: 0, y: 0, z: 0 }, s.body.vel) }
          : NO_INPUT;
      s = stepPlayer(s, inp, TICK_DT, world);
    }
    expect(s.onGround).toBe(true);
    expect(s.body.pos.y).toBeCloseTo(GALLERY.deckY, 6);
    expect(Math.abs(s.body.pos.x - target.x)).toBeLessThan(2);
    expect(Math.abs(s.body.pos.z)).toBeLessThan(2.5);
  });

  it("drops a player who steps off the bridge into the kill volume", () => {
    let killed = false;
    run(world, createPlayer({ x: 0, y: 0, z: -3.5 }), { ...NO_INPUT, moveX: 1 }, 120, (s) => {
      if (volumeAt(world, bodyBox(s.body), "kill")) killed = true;
    });
    expect(killed).toBe(true);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test apps/client/src/sandbox packages/arena`
Expected: FAIL. В `sandbox` — `Failed to resolve import "./controls"` и остальные модули. `gallery.sim.test.ts` при уже слитых потоках может пройти сразу: это проверка стыка, а не новый код. Если он падает, причина — в данных арены или физике, чинить там.

- [ ] **Step 3: Чистая логика контроллера**

`apps/client/src/sandbox/controls.ts`:
```ts
import type { PlayerInput } from "@doodlemagic/sim";

/** Клавиши по event.code: на русской раскладке W остаётся KeyW. Ctrl ни на что не назначен (Ctrl+W закрывает вкладку). */
export const KEYS = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  jump: "Space",
  debug: "Backquote",
} as const;

/** Клавиши, у которых гасим действие браузера (прокрутка пробелом). */
export const GAME_KEYS: ReadonlySet<string> = new Set(Object.values(KEYS));

/** Радиан на пиксель мыши при множителе чувствительности 1. */
export const BASE_SENSITIVITY = 0.0022;
export const SENS_MIN = 0.25;
export const SENS_MAX = 3;
/** Pointer Lock иногда присылает скачок в сотни пикселей — такие события пропускаем. */
export const MAX_MOUSE_STEP_PX = 300;
const MAX_PITCH = Math.PI / 2 - 0.01;

export interface Look {
  yaw: number;
  pitch: number;
}

export function moveAxes(down: ReadonlySet<string>): { moveX: number; moveZ: number } {
  const axis = (pos: string, neg: string) => (down.has(pos) ? 1 : 0) - (down.has(neg) ? 1 : 0);
  return { moveX: axis(KEYS.right, KEYS.left), moveZ: axis(KEYS.forward, KEYS.back) };
}

/** Поворот взгляда от сдвига мыши: вправо — yaw уменьшается (как в three.js), вверх — pitch растёт. */
export function applyLook(look: Look, dx: number, dy: number, sensitivity: number): Look {
  if (Math.abs(dx) > MAX_MOUSE_STEP_PX || Math.abs(dy) > MAX_MOUSE_STEP_PX) return look;
  const k = BASE_SENSITIVITY * sensitivity;
  const pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, look.pitch - dy * k));
  let yaw = look.yaw - dx * k;
  if (yaw > Math.PI) yaw -= 2 * Math.PI;
  if (yaw < -Math.PI) yaw += 2 * Math.PI;
  return { yaw, pitch };
}

export function buildInput(down: ReadonlySet<string>, look: Look): PlayerInput {
  return { ...moveAxes(down), jump: down.has(KEYS.jump), yaw: look.yaw, pitch: look.pitch };
}

export function clampSensitivity(x: number): number {
  return Number.isFinite(x) ? Math.min(SENS_MAX, Math.max(SENS_MIN, x)) : 1;
}
```

`apps/client/src/sandbox/fixedStep.ts`:
```ts
/**
 * Фиксированный шаг симуляции при любой частоте кадров: копим время кадра, отдаём целые тики,
 * остаток — доля alpha для интерполяции между двумя последними состояниями.
 */
export interface ClockStep {
  ticks: number;
  acc: number;
  alpha: number;
}

/** Больше стольких тиков за кадр не делаем: после зависания не догоняем, иначе «спираль смерти». */
export const MAX_TICKS_PER_FRAME = 5;

export function advanceClock(acc: number, frameS: number, tickS: number, maxTicks = MAX_TICKS_PER_FRAME): ClockStep {
  let a = acc + Math.max(0, frameS);
  let ticks = Math.floor(a / tickS + 1e-9);
  a -= ticks * tickS;
  if (ticks > maxTicks) {
    ticks = maxTicks;
    a = 0;
  }
  if (a < 0) a = 0;
  return { ticks, acc: a, alpha: a / tickS };
}
```

`apps/client/src/sandbox/respawn.ts`:
```ts
import { bodyBox, createPlayer, volumeAt, type ArenaData, type PlayerState, type World } from "@doodlemagic/sim";

/** Упал в ущелье (зона смерти) или вывалился за низ арены. */
export function shouldRespawn(world: World, s: PlayerState, arena: ArenaData): boolean {
  return volumeAt(world, bodyBox(s.body), "kill") !== null || s.body.pos.y < arena.bounds.min.y;
}

/** Следующая точка появления: шаг 3 по кругу из 10 разводит соседние появления подальше. */
export function nextSpawnIndex(index: number, count: number, stride = 3): number {
  return count > 0 ? (index + stride) % count : 0;
}

export function spawnPlayer(arena: ArenaData, index: number): PlayerState {
  const s = arena.spawns[index % arena.spawns.length];
  if (!s) throw new Error("arena has no spawns");
  return createPlayer(s.pos, s.yaw);
}
```

`apps/client/src/sandbox/settings.ts`:
```ts
import { isPresetId, type PresetId } from "../render/quality";
import { clampSensitivity } from "./controls";

export type QualityChoice = "auto" | PresetId;

export interface Settings {
  sensitivity: number;
  quality: QualityChoice;
}

const KEY = "doodlemagic_settings";
export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, quality: "auto" };

/** Настройки из localStorage: всё непонятное заменяется значением по умолчанию. */
export function parseSettings(raw: string | null): Settings {
  let x: unknown = null;
  try {
    x = raw ? JSON.parse(raw) : null;
  } catch {
    x = null;
  }
  const o = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
  const quality = o.quality === "auto" || isPresetId(o.quality) ? o.quality : DEFAULT_SETTINGS.quality;
  const sensitivity = typeof o.sensitivity === "number" ? clampSensitivity(o.sensitivity) : DEFAULT_SETTINGS.sensitivity;
  return { sensitivity, quality };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // приватный режим: настройки просто не запомнятся
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm test apps/client/src/sandbox packages/arena`
Expected: PASS — в `sandbox` 7 + 4 + 3 + 2 = 16 тестов, в `packages/arena` 13 + 22 + 10 = 45.

- [ ] **Step 5: Ввод, интерфейс и игровой цикл**

`apps/client/src/sandbox/input.ts`. Как работает ввод:
- движение принимается только при захваченной мыши;
- клавиши с Ctrl, Alt и Cmd игра не трогает;
- после Esc Chrome ещё ~1 с отказывает в повторном захвате — промис отклоняется молча, игрок просто кликает ещё раз.
```ts
import { GAME_KEYS } from "./controls";

/** Клавиатура и мышь песочницы. Движение принимается только при захваченной мыши. */
export interface InputDevice {
  readonly down: ReadonlySet<string>;
  readonly locked: boolean;
  /** Сдвиг мыши с прошлого вызова, пиксели. */
  takeMouse(): { dx: number; dy: number };
  requestLock(): void;
  onLockChange(cb: (locked: boolean) => void): void;
  /** Нажатие клавиши-переключателя (работает и без захвата мыши). */
  onPress(code: string, cb: () => void): void;
  dispose(): void;
}

export function createInput(canvas: HTMLCanvasElement): InputDevice {
  const down = new Set<string>();
  let dx = 0;
  let dy = 0;
  let locked = false;
  const lockListeners: ((locked: boolean) => void)[] = [];
  const pressListeners = new Map<string, () => void>();

  const onKeyDown = (e: KeyboardEvent): void => {
    // Ctrl, Alt и Cmd оставляем браузеру и системе: ни одна игровая клавиша с ними не работает
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (locked && GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (locked) down.add(e.code);
    pressListeners.get(e.code)?.();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!locked) return;
    dx += e.movementX;
    dy += e.movementY;
  };
  const onLockChange = (): void => {
    locked = document.pointerLockElement === canvas;
    if (!locked) down.clear();
    for (const cb of lockListeners) cb(locked);
  };
  const onBlur = (): void => down.clear();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLockChange);

  return {
    down,
    get locked() {
      return locked;
    },
    takeMouse() {
      const m = { dx, dy };
      dx = 0;
      dy = 0;
      return m;
    },
    requestLock() {
      // unadjustedMovement — сырая мышь без ускорения ОС; где его нет, просим обычный захват.
      // Firefox возвращает undefined, Chrome — промис, который отклоняется при слишком частом повторе.
      const p = canvas.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
      p?.catch(() => {
        const again = canvas.requestPointerLock() as Promise<void> | undefined;
        again?.catch(() => undefined);
      });
    },
    onLockChange(cb) {
      lockListeners.push(cb);
    },
    onPress(code, cb) {
      pressListeners.set(code, cb);
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
    },
  };
}
```

`apps/client/src/sandbox/hud.ts`:
```ts
import { PRESET_ORDER, PRESETS } from "../render/quality";
import { SENS_MAX, SENS_MIN } from "./controls";
import type { QualityChoice, Settings } from "./settings";

export const HINT = "Клик — захват мыши, WASD — ходить, пробел — прыжок, Esc — меню";

export interface Hud {
  readonly canvas: HTMLCanvasElement;
  setLocked(locked: boolean): void;
  setLoading(loading: boolean): void;
  readonly debugVisible: boolean;
  toggleDebug(): void;
  setDebugText(text: string): void;
  onPlay(cb: () => void): void;
  onQuality(cb: (q: QualityChoice) => void): void;
  onSensitivity(cb: (x: number) => void): void;
}

function el<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

export function createHud(root: HTMLElement, settings: Settings): Hud {
  const options = [`<option value="auto">Авто</option>`, ...PRESET_ORDER.map((id) => `<option value="${id}">${PRESETS[id].label}</option>`)];
  root.innerHTML = `
    <canvas class="game-canvas"></canvas>
    <div class="sb-hint"></div>
    <div class="game-corner" hidden></div>
    <div class="sb-menu">
      <section class="sb-card">
        <h1>DoodleMagic · песочница</h1>
        <p class="sb-muted">Галерея над ущельем. Пока здесь можно только ходить и прыгать.</p>
        <button class="btn sb-play" type="button">Играть</button>
        <label>Качество <select class="sb-quality">${options.join("")}</select></label>
        <label>Чувствительность мыши <span class="sb-sens-out"></span>
          <input class="sb-sens" type="range" min="${SENS_MIN}" max="${SENS_MAX}" step="0.05" />
        </label>
        <p class="sb-muted sb-small">Ё (~) — отладка: FPS и пресет. <a href="/nettest">Тест связи</a></p>
      </section>
    </div>
    <div class="game-loading">Загрузка…</div>`;

  const canvas = el<HTMLCanvasElement>(root, ".game-canvas");
  const corner = el(root, ".game-corner");
  const menu = el(root, ".sb-menu");
  const loadingEl = el(root, ".game-loading");
  const quality = el<HTMLSelectElement>(root, ".sb-quality");
  const sens = el<HTMLInputElement>(root, ".sb-sens");
  const sensOut = el(root, ".sb-sens-out");
  el(root, ".sb-hint").textContent = HINT;
  quality.value = settings.quality;
  sens.value = String(settings.sensitivity);
  sensOut.textContent = `×${settings.sensitivity.toFixed(2)}`;

  const playListeners: (() => void)[] = [];
  const play = () => playListeners.forEach((cb) => cb());
  el(root, ".sb-play").addEventListener("click", play);
  // клик мимо карточки меню тоже захватывает мышь
  menu.addEventListener("click", (e) => {
    if (e.target === menu) play();
  });

  return {
    canvas,
    setLocked(locked) {
      menu.hidden = locked;
      root.classList.toggle("sb-locked", locked);
    },
    setLoading(loading) {
      loadingEl.hidden = !loading;
    },
    get debugVisible() {
      return !corner.hidden;
    },
    toggleDebug() {
      corner.hidden = !corner.hidden;
    },
    setDebugText(text) {
      corner.textContent = text;
    },
    onPlay(cb) {
      playListeners.push(cb);
    },
    onQuality(cb) {
      quality.addEventListener("change", () => cb(quality.value as QualityChoice));
    },
    onSensitivity(cb) {
      sens.addEventListener("input", () => {
        const x = Number(sens.value);
        sensOut.textContent = `×${x.toFixed(2)}`;
        cb(x);
      });
    },
  };
}
```

`apps/client/src/sandbox/sandbox.css`:
```css
/* Песочница: подсказка, меню паузы. Холст и угол отладки — в render/canvas.css. */
.sb-hint {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(29, 27, 22, 0.72);
  color: #f6f3ea;
  font: 14px/1.4 system-ui, sans-serif;
  pointer-events: none;
  white-space: nowrap;
}
.sb-locked .sb-hint {
  opacity: 0.55;
}
.sb-menu {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(242, 237, 224, 0.55);
  cursor: pointer;
}
.sb-card {
  color-scheme: light;
  width: min(420px, calc(100vw - 32px));
  padding: 20px;
  border: 1px solid #d9d3c3;
  border-radius: 12px;
  background: #fffdf7;
  color: #1d1b16;
  font: 16px/1.5 system-ui, sans-serif;
  cursor: default;
}
.sb-card h1 {
  margin: 0 0 8px;
  font-size: 24px;
}
.sb-card label {
  display: block;
  margin: 14px 0 0;
  font-weight: 600;
}
.sb-card select,
.sb-card input[type="range"] {
  display: block;
  width: 100%;
  margin-top: 6px;
}
.sb-card select {
  background: #f6f3ea;
  color: #1d1b16;
  border-color: #d9d3c3;
}
.sb-muted {
  color: #6b665a;
}
.sb-small {
  margin: 14px 0 0;
  font-size: 14px;
}
/* киноварь в интерфейсе — только для HP и опасности (арт-директор), поэтому кнопка тушью; селектор сильнее .btn:not(.secondary) из style.css */
.sb-card .btn.sb-play {
  margin-top: 8px;
  background: #1d1b16;
  color: #f6f3ea;
}
```

`apps/client/src/sandbox/page.ts`. Цикл кадра:
1. Взгляд берётся по мыши сразу.
2. Симуляция догоняет время целыми тиками по 1/60 с (не больше 5 за кадр).
3. Камера ставится между двумя последними состояниями (`alpha`).
4. После каждого тика проверяется зона смерти; при падении — возрождение в следующей келье.

Автовыбор качества меряет кадры и под меню паузы: сцена за ним рисуется.
```ts
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

  const variant = new URLSearchParams(location.search).get("arena") === "compact" ? "compact" : "full";
  const arena = buildGallery(variant);
  const world = createWorld(arena.colliders, arena.volumes);
  const renderer = new StyleRenderer(hud.canvas, settings.quality === "auto" ? "high" : settings.quality);
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
    const frameMs = Math.max(0, Math.min(250, now - last));
    last = now;

    const mouse = input.takeMouse();
    look = applyLook(look, mouse.dx, mouse.dy, settings.sensitivity);
    const keys = input.locked ? input.down : new Set<string>();

    const clock = advanceClock(acc, frameMs / 1000, TICK_DT);
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

    meter.push(frameMs);
    const next = auto?.push(frameMs);
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
  void renderer.warmUp(scene).then(() => {
    hud.setLoading(false);
    last = performance.now();
    requestAnimationFrame(frame);
  });
}
```

`apps/client/src/main.ts` (заменить целиком; старую заглушку с кнопками теста связи заменяет песочница, ссылка «Тест связи» есть в меню паузы):
```ts
import "./style.css";
import { mountNettest } from "./nettest/page";

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");

// three.js, арена и симуляция грузятся отдельными чанками: /nettest остаётся лёгким
if (location.pathname.startsWith("/nettest")) {
  mountNettest(app);
} else if (location.pathname.startsWith("/render-test")) {
  void import("./render/testPage").then((m) => m.mountRenderTest(app));
} else {
  void import("./sandbox/page").then((m) => m.mountSandbox(app));
}
```

- [ ] **Step 6: Проверить типы, тесты и сборку**

Run: `pnpm typecheck`, `pnpm test`, `pnpm build:client`
Expected:
- типы без ошибок;
- все тесты зелёные: прежние + 124 новых (46 в `sim`, 35 в `arena`, 17 в `render`, 26 в `sandbox` и стыке);
- сборка проходит, у песочницы свой чанк (~20 кБ), three.js — отдельным чанком.

- [ ] **Step 7: Коммит**

```bash
git add apps/client/src packages/arena/src/gallery.sim.test.ts
git commit -m "feat(client): sandbox on / — FPS controller, fixed 60 Hz sim, respawn, pause menu" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Живая проверка в браузере (контролёр)**

Dev-сервер `client`, `http://localhost:5173/`. Pointer Lock требует настоящего клика: если в окне проверки захват не срабатывает, проверку движения делает владелец в своём браузере (шаги 2–6).
1. «Загрузка…», затем меню паузы поверх вида изнутри кельи. В меню:
   - заголовок «DoodleMagic · песочница», кнопка «Играть»;
   - «Качество» = «Авто», «Чувствительность мыши ×1.00»;
   - строка «Ё (~) — отладка…» со ссылкой «Тест связи».

   Внизу подсказка «Клик — захват мыши, WASD — ходить, пробел — прыжок, Esc — меню».
2. «Играть» → мышь захвачена, меню исчезло, подсказка стала бледнее. Мышь крутит взгляд, вверх-вниз не дальше вертикали. WASD ходит, в том числе на русской раскладке (ЦФЫВ). Пробел — один прыжок, удержание не прыгает повторно.
3. Из кельи через дверь сбоку и проход между кельями во двор:
   - низкая стенка 1 м перепрыгивается;
   - стела 2,6 м — нет;
   - по лестнице у рва — на галерею +4 м;
   - по галерее — до башни.
4. С моста шагнуть в ущелье. Ожидается: полёт в белую пустоту, через ~0,5 с возрождение в другой келье лицом к двери.
5. Esc → меню вернулось. «Ё»/«~» (`Backquote`) → в левом верхнем углу:

   ```
   FPS 60 · 16.7 мс
   Высокое (авто) · вызовов 7
   x … y … z …
   ```

   Вызовов 7 = 6 чернил + проход; повторное нажатие прячет угол.
6. «Качество» → «Низкое» — картинка мягче сразу, без перезагрузки. Ползунок чувствительности меняет скорость поворота. После перезагрузки оба значения на месте.
7. `/nettest` и `/nettest?host=1` открывают прежние страницы теста связи. `/render-test` работает. `/?arena=compact` — компактный вариант: ров и восточный проход закрыты глухими стенами.

---

### Task 9: Руки-«варежки» и приёмка фазы

**Поток:** последовательно, после задачи 8.

**Files:**
- Create: `apps/client/src/hands/spring.ts`, `apps/client/src/hands/motion.ts`, `apps/client/src/hands/mittens.ts`
- Modify: `apps/client/src/sandbox/page.ts` (руки вторым слоем), `docs/superpowers/plans/2026-10-17-prototype-roadmap.md` (статус)
- Test: `apps/client/src/hands/spring.test.ts`, `apps/client/src/hands/motion.test.ts`

**Interfaces:**
- Consumes:
  - `createInkMaterial`, `SunUniform` (`render/gbuffer.ts`); `INK`, `SUN_DIR` (`render/palette.ts`);
  - `StyleRenderer.render(world, overlay)` и `warmUp(world, overlay)` (задача 7);
  - `DEFAULT_MOVE` (`@doodlemagic/sim`).
- Produces:
  - `spring.ts`: `Spring { x; v }`, `stepSpring(s, target, omega, dt): Spring` — критически задемпфированная пружина, точное решение за шаг;
  - `motion.ts`:
    - `HandMotionInput { dt; speed; onGround; landVel; lookDx; lookDy }`;
    - `HandPose { x; y; roll; swing }`, `HandRig`;
    - `STRIDE_M = 2.2`;
    - `createHandRig()`, `updateHandRig(rig, m, runSpeed): { rig; pose }`;
  - `mittens.ts`: `Mittens { scene; update(pose, cameraWorldInverse) }`, `createMittens()`.

- [ ] **Step 1: Написать падающие тесты**

`apps/client/src/hands/spring.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { stepSpring, type Spring } from "./spring";

function settle(s: Spring, target: number, omega: number, dt: number, steps: number): Spring[] {
  const out: Spring[] = [];
  for (let k = 0; k < steps; k++) {
    s = stepSpring(s, target, omega, dt);
    out.push(s);
  }
  return out;
}

describe("stepSpring", () => {
  it("reaches the target without overshooting from rest", () => {
    const path = settle({ x: 0, v: 0 }, 1, 12, 1 / 60, 120);
    expect(path.at(-1)!.x).toBeCloseTo(1, 4);
    expect(Math.max(...path.map((s) => s.x))).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("gives the same result for one big step and many small ones", () => {
    const big = stepSpring({ x: 0, v: 2 }, 1, 8, 0.5);
    const small = settle({ x: 0, v: 2 }, 1, 8, 0.5 / 50, 50).at(-1)!;
    expect(big.x).toBeCloseTo(small.x, 9);
    expect(big.v).toBeCloseTo(small.v, 9);
  });

  it("stays stable with a huge time step", () => {
    const s = stepSpring({ x: 5, v: -100 }, 0, 20, 10);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
    expect(Number.isFinite(s.v)).toBe(true);
  });
});
```

`apps/client/src/hands/motion.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createHandRig, updateHandRig, type HandMotionInput, type HandPose } from "./motion";

const still: HandMotionInput = { dt: 1 / 60, speed: 0, onGround: true, landVel: 0, lookDx: 0, lookDy: 0 };

function play(frames: number, m: (k: number) => HandMotionInput): HandPose[] {
  let rig = createHandRig();
  const poses: HandPose[] = [];
  for (let k = 0; k < frames; k++) {
    const r = updateHandRig(rig, m(k), 6.5);
    rig = r.rig;
    poses.push(r.pose);
  }
  return poses;
}

const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

describe("updateHandRig", () => {
  it("only breathes a few millimetres when standing", () => {
    const ys = play(600, () => still).map((p) => p.y);
    expect(range(ys)).toBeGreaterThan(0.004);
    expect(range(ys)).toBeLessThan(0.014);
  });

  it("bobs while running and calms down after stopping", () => {
    const run = play(300, () => ({ ...still, speed: 6.5 }));
    expect(range(run.slice(120).map((p) => p.y))).toBeGreaterThan(0.015);
    expect(Math.max(...run.map((p) => Math.abs(p.swing)))).toBeGreaterThan(0.5);
    const stop = play(600, (k) => ({ ...still, speed: k < 300 ? 6.5 : 0 }));
    expect(range(stop.slice(500).map((p) => p.y))).toBeLessThan(0.014);
  });

  it("does not bob in the air", () => {
    const air = play(300, () => ({ ...still, speed: 6.5, onGround: false }));
    expect(range(air.slice(120).map((p) => p.y))).toBeLessThan(0.014);
  });

  it("dips on landing and lags behind a mouse turn", () => {
    const land = play(30, (k) => ({ ...still, landVel: k === 1 ? -9 : 0 }));
    expect(Math.min(...land.map((p) => p.y))).toBeLessThan(-0.02);
    const turn = play(30, () => ({ ...still, lookDx: 40 }));
    expect(turn.at(-1)!.x).toBeLessThan(-0.005);
    expect(turn.at(-1)!.roll).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test apps/client/src/hands`
Expected: FAIL — `Failed to resolve import "./spring"` и `"./motion"`.

- [ ] **Step 3: Пружина и движение рук**

`apps/client/src/hands/spring.ts`:
```ts
/**
 * Критически задемпфированная пружина, точное решение за шаг dt: не раскачивается и устойчива при любом dt.
 * omega — «жёсткость», рад/с: чем больше, тем быстрее догоняет цель.
 */
export interface Spring {
  x: number;
  v: number;
}

export function stepSpring(s: Spring, target: number, omega: number, dt: number): Spring {
  const d = s.x - target;
  const e = Math.exp(-omega * dt);
  const k = (s.v + omega * d) * dt;
  return { x: target + (d + k) * e, v: (s.v - omega * k) * e };
}
```

`apps/client/src/hands/motion.ts`. Медленные части — на пружинах: отставание за взглядом, дыхание, приседание при приземлении. Качание в такт шагам (3 шага в секунду при беге) идёт напрямую: пружина сгладила бы его почти в ноль.
```ts
import { stepSpring, type Spring } from "./spring";

/** Что происходит с магом в этом кадре — из симуляции и мыши. */
export interface HandMotionInput {
  dt: number;
  /** Горизонтальная скорость, м/с. */
  speed: number;
  onGround: boolean;
  /** Скорость приземления (< 0), если в этом кадре приземлились, иначе 0. */
  landVel: number;
  /** Сдвиг мыши за кадр, пиксели. */
  lookDx: number;
  lookDy: number;
}

/** Смещение и наклон обеих рук в пространстве камеры, м и рад; swing — разнос левой и правой при ходьбе. */
export interface HandPose {
  x: number;
  y: number;
  roll: number;
  swing: number;
}

export interface HandRig {
  t: number;
  phase: number;
  walk: Spring;
  x: Spring;
  y: Spring;
  roll: Spring;
}

/** Длина шага: руки качаются в такт шагам, при беге 6,5 м/с — 3 шага в секунду. */
export const STRIDE_M = 2.2;
const BREATH_HZ = 0.22;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createHandRig(): HandRig {
  const rest: Spring = { x: 0, v: 0 };
  return { t: 0, phase: 0, walk: rest, x: rest, y: rest, roll: rest };
}

/**
 * Дыхание в покое, покачивание при ходьбе, отставание за взглядом и приседание при приземлении —
 * всё на пружинах, поэтому руки двигаются мягко при любой частоте кадров.
 */
export function updateHandRig(rig: HandRig, m: HandMotionInput, runSpeed: number): { rig: HandRig; pose: HandPose } {
  const t = rig.t + m.dt;
  const walk = stepSpring(rig.walk, m.onGround ? clamp(m.speed / runSpeed, 0, 1) : 0, 8, m.dt);
  const w = clamp(walk.x, 0, 1);
  const phase = (rig.phase + (m.speed * m.dt * Math.PI) / STRIDE_M) % (2 * Math.PI);
  const breath = Math.sin(t * 2 * Math.PI * BREATH_HZ) * 0.006 * (1 - w);

  // медленное — на пружинах (взгляд, дыхание, приземление), качание шага — напрямую: пружина его бы сгладила
  const targetX = -clamp(m.lookDx * 0.00025, -0.03, 0.03);
  const targetY = breath + clamp(m.lookDy * 0.00025, -0.03, 0.03);
  const targetRoll = -clamp(m.lookDx * 0.0004, -0.08, 0.08);
  const bobX = Math.sin(phase) * 0.012 * w;
  const bobY = -Math.abs(Math.sin(phase)) * 0.022 * w;

  let y = rig.y;
  if (m.landVel < 0) y = { x: y.x, v: y.v + Math.max(-0.8, m.landVel * 0.08) };
  const next: HandRig = {
    t,
    phase,
    walk,
    x: stepSpring(rig.x, targetX, 10, m.dt),
    y: stepSpring(y, targetY, 10, m.dt),
    roll: stepSpring(rig.roll, targetRoll, 8, m.dt),
  };
  return {
    rig: next,
    pose: { x: next.x.x + bobX, y: next.y.x + bobY, roll: next.roll.x + Math.sin(phase) * 0.03 * w, swing: Math.sin(phase) * w },
  };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm test apps/client/src/hands`
Expected: PASS — 3 + 4 = 7 тестов.

- [ ] **Step 5: Варежки и подключение к песочнице**

`apps/client/src/hands/mittens.ts`. Варежки собраны из примитивов:
- сплюснутая сфера;
- большой палец-капсула;
- манжета;
- рукав, уходящий за край кадра.

Сцена рук живёт в пространстве камеры. Солнце на руках каждый кадр переводится в это пространство, чтобы свет совпадал с миром. 8 мешей, около 1,5 тыс. треугольников.
```ts
import { CapsuleGeometry, CylinderGeometry, Group, Mesh, Scene, SphereGeometry, Vector3, type Matrix4 } from "three";
import { createInkMaterial, type SunUniform } from "../render/gbuffer";
import { INK, SUN_DIR } from "../render/palette";
import type { HandPose } from "./motion";

/** Руки-«варежки» из примитивов. Живут в своей сцене в пространстве камеры и рисуются вторым слоем G-буфера. */
export interface Mittens {
  readonly scene: Scene;
  /** Поза из updateHandRig и обратная матрица мировой камеры (чтобы солнце на руках совпадало с миром). */
  update(pose: HandPose, cameraWorldInverse: Matrix4): void;
}

const REST = { x: 0.26, y: -0.25, z: -0.62 } as const;

function makeHand(side: 1 | -1, sun: SunUniform): Group {
  const mat = createInkMaterial(INK.hands, sun);
  const hand = new Group();
  // варежка: сплюснутая капля, большой палец сбоку, манжета и рукав, уходящий за край кадра
  const mitten = new Mesh(new SphereGeometry(1, 18, 12), mat);
  mitten.scale.set(0.05, 0.085, 0.032);
  mitten.position.set(0, 0.03, 0);
  const thumb = new Mesh(new CapsuleGeometry(0.016, 0.04, 4, 10), mat);
  thumb.position.set(-side * 0.046, 0.0, 0.006);
  thumb.rotation.z = side * 0.75;
  const cuff = new Mesh(new CylinderGeometry(0.047, 0.052, 0.05, 14), mat);
  cuff.position.set(0, -0.055, 0);
  const sleeve = new Mesh(new CylinderGeometry(0.056, 0.075, 0.32, 14), mat);
  sleeve.position.set(0, -0.23, 0.02);
  hand.add(mitten, thumb, cuff, sleeve);
  hand.position.set(side * REST.x, REST.y, REST.z);
  hand.rotation.set(0.45, -side * 0.2, side * 0.12);
  return hand;
}

export function createMittens(): Mittens {
  const scene = new Scene();
  const sun: SunUniform = { value: new Vector3() };
  const right = makeHand(1, sun);
  const left = makeHand(-1, sun);
  const rig = new Group();
  rig.add(right, left);
  scene.add(rig);
  const sunWorld = new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
  return {
    scene,
    update(pose, cameraWorldInverse) {
      sun.value.copy(sunWorld).transformDirection(cameraWorldInverse);
      rig.position.set(pose.x, pose.y, 0);
      rig.rotation.z = pose.roll;
      right.position.y = REST.y + pose.swing * 0.008;
      left.position.y = REST.y - pose.swing * 0.008;
    },
  };
}
```

`apps/client/src/sandbox/page.ts` (заменить целиком). По сравнению с задачей 8 добавлено:
- импорт рук и `DEFAULT_MOVE`;
- `mittens` и `handRig`;
- накопление `landVel` по тикам;
- блок `updateHandRig` и `mittens.update`;
- второй аргумент в `render` и `warmUp`.
```ts
import { Scene } from "three";
import { buildGallery } from "@doodlemagic/arena";
import { DEFAULT_MOVE, EYE_HEIGHT, TICK_DT, createWorld, lerpVec, stepPlayer, type PlayerState } from "@doodlemagic/sim";
import "../render/canvas.css";
import "./sandbox.css";
import { buildArenaMeshes } from "../render/arenaMeshes";
import { createFpsMeter } from "../render/fpsMeter";
import { createAutoQuality, type AutoQuality } from "../render/quality";
import { StyleRenderer } from "../render/styleRenderer";
import { createHandRig, updateHandRig } from "../hands/motion";
import { createMittens } from "../hands/mittens";
import { KEYS, applyLook, buildInput, type Look } from "./controls";
import { advanceClock } from "./fixedStep";
import { createHud } from "./hud";
import { createInput } from "./input";
import { nextSpawnIndex, shouldRespawn, spawnPlayer } from "./respawn";
import { loadSettings, saveSettings } from "./settings";

/** Песочница: арена, FPS-контроллер на sim с тиком 60 Гц, рендер «Тушь и свет», руки. */
export function mountSandbox(root: HTMLElement): void {
  document.body.classList.add("game");
  const settings = loadSettings();
  const hud = createHud(root, settings);
  const input = createInput(hud.canvas);

  const variant = new URLSearchParams(location.search).get("arena") === "compact" ? "compact" : "full";
  const arena = buildGallery(variant);
  const world = createWorld(arena.colliders, arena.volumes);
  const renderer = new StyleRenderer(hud.canvas, settings.quality === "auto" ? "high" : settings.quality);
  const scene = new Scene();
  scene.add(buildArenaMeshes(arena.render));
  const mittens = createMittens();
  let handRig = createHandRig();

  let spawnIndex = 0;
  let cur: PlayerState = spawnPlayer(arena, spawnIndex);
  let prev = cur;
  let look: Look = { yaw: cur.yaw, pitch: 0 };
  let acc = 0;
  let landVel = 0;
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
    // метка rAF бывает чуть раньше performance.now(), снятого после прогрева: отрицательный шаг взорвал бы пружины рук
    const frameMs = Math.max(0, Math.min(250, now - last));
    last = now;

    const mouse = input.takeMouse();
    look = applyLook(look, mouse.dx, mouse.dy, settings.sensitivity);
    const keys = input.locked ? input.down : new Set<string>();

    const clock = advanceClock(acc, frameMs / 1000, TICK_DT);
    acc = clock.acc;
    for (let k = 0; k < clock.ticks; k++) {
      prev = cur;
      cur = stepPlayer(cur, buildInput(keys, look), TICK_DT, world);
      if (cur.landVel < 0) landVel = Math.min(landVel, cur.landVel);
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

    const hands = updateHandRig(
      handRig,
      {
        dt: frameMs / 1000,
        speed: Math.hypot(cur.body.vel.x, cur.body.vel.z),
        onGround: cur.onGround,
        landVel,
        lookDx: mouse.dx,
        lookDy: mouse.dy,
      },
      DEFAULT_MOVE.runSpeed,
    );
    handRig = hands.rig;
    landVel = 0;
    mittens.update(hands.pose, cam.matrixWorldInverse);

    renderer.render(scene, mittens.scene);

    meter.push(frameMs);
    const next = auto?.push(frameMs);
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
  void renderer.warmUp(scene, mittens.scene).then(() => {
    hud.setLoading(false);
    last = performance.now();
    requestAnimationFrame(frame);
  });
}
```

- [ ] **Step 6: Проверить типы, тесты и сборку**

Run: `pnpm typecheck`, `pnpm test`, `pnpm build:client`
Expected:
- типы без ошибок;
- все тесты зелёные: прежние + 131 новый;
- общий объём `apps/client/dist/assets` около 0,7 МБ (≈ 180 кБ в gzip) — бюджет 3 МБ соблюдён.

- [ ] **Step 7: Коммит**

```bash
git add apps/client/src/hands apps/client/src/sandbox/page.ts
git commit -m "feat(client): first-person mittens on springs, drawn as a second G-buffer layer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Живая проверка в браузере (контролёр)**

`http://localhost:5173/`, «Играть»:
1. Внизу по углам две светлые варежки с толстым тёмным контуром: большой палец внутрь, манжеты в полосках тона.
2. Стоя: руки еле заметно «дышат» — несколько миллиметров, цикл около 4 с.
3. Бег: руки качаются в такт шагам и чуть расходятся. Резкий поворот мышью — руки отстают и возвращаются без раскачки. Прыжок и приземление — руки приседают и выпрямляются.
4. Упереться лицом в стену или стелу: стена заполняет кадр, варежки видны целиком поверх неё и не обрезаются.
5. Отладочный угол: `вызовов 15` (6 чернил + 8 частей рук + проход).

- [ ] **Step 9: 👤 Владелец: приёмка фазы на своём ноутбуке**

Открыть сборку (прод после деплоя или `pnpm --filter @doodlemagic/client preview`), «Качество: Авто», включить отладочный угол «Ё».
1. **60 FPS:** 2 минуты бега по всей арене, включая галерею и вид на ущелье с моста. Ожидается:
   - FPS в углу держится на 59–60 (или на частоте монитора);
   - пресет после подбора — «Высокое» или «Среднее»;
   - за всю пробежку нет фризов дольше доли секунды.

   Если на «Авто» ниже 60, выбрать «Низкое» и записать FPS для обоих пресетов.
2. **Тест «5 секунд по скриншоту»** (протокол адвоката игрока):
   - сделать три скриншота: со двора на арку руны, с галереи вниз на двор, с моста вбок в ущелье;
   - показать каждый человеку, который игру не видел, на 5 секунд, и спросить: где можно спрятаться? где край, с которого падают? что выше, что ниже?

   Пройдено, если на все три вопроса ответили верно хотя бы по двум скриншотам из трёх: укрытия, кромка с белой пустотой, галерея и лестница.
3. Записать итог одной строкой (FPS, пресет, видеокарта, результат теста) — он идёт в шаг 10.

- [ ] **Step 10: Статус в дорожной карте и коммит**

В `docs/superpowers/plans/2026-10-17-prototype-roadmap.md`, раздел «Статус…», добавить пункт:
```markdown
- Фаза 1, код: готово (песочница на `/`, `/render-test`; 131 новый тест). Проверка владельца: <FPS и пресет на ноутбуке, видеокарта>; тест «5 секунд по скриншоту»: <результат>.
```
```bash
git add docs/superpowers/plans/2026-10-17-prototype-roadmap.md
git commit -m "docs: phase 1 sandbox status" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
`git push` — только с подтверждения владельца.

---

## После фазы 1
1. Если на ноутбуке владельца нет стабильных 60 FPS, сначала профилировать стилевой проход (DevTools → Performance → GPU) и только потом идти в фазу 2. Рычаги по порядку:
   - понизить пресет;
   - пороги автовыбора;
   - число выборок в стилевом проходе.
2. Написать подробный план фазы 2 (движок способностей) в том же формате. Опора на этот план:
   - `stepPlayer` и `World` фазы 1;
   - динамические коллайдеры стен Земли — новый вид мира поверх неизменяемого `World`;
   - заготовленные чернила `enemy` и `magic`.
