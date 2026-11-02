# Фаза 3-lite: PvP с друзьями. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Как идёт работа.**
> - Волна 1 — задачи 1–5 параллельно, каждая в своём git worktree от `main`. В новом worktree первым делом `pnpm install --frozen-lockfile`: новых зависимостей нет.
> - Волна 2 — задача 6 (нужны 1 и 2). Волна 3 — задача 7 (нужны 3–6). Волна 4 — задача 8. Задача 9 — приёмку, дорожную карту и деплой — делает контролёр.
> - Задача создаёт только свои файлы и правит только названные в ней (таблица «Владение файлами»). Две задачи одной волны не правят один файл.
> - Где код в `main` отличается от плана в мелочах (имена переменных, порядок строк), прав код в `main`: подстраиваться под него, интерфейсы этого плана не менять.

**Goal:** Владелец кидает друзьям ссылку `/r/КОД`, и 2–6 человек играют «Свалку» Огнём и Землёй: разминка, отсчёт, 7-минутный бой до 10/12/15 очков, итоги и «Ещё раз». Свой маг слушается мгновенно, чужие двигаются плавно.

**Architecture:**
- Хост — браузер того, кто создал комнату. Он крутит ту же чистую симуляцию (`stepGame` поверх `stepMatch`, 60 Гц) от таймера в Web Worker и рассылает снапшоты 20 раз в секунду. Игроки шлют только ввод.
- Правила «Свалки» (фазы, счёт, возрождение, защита, лимиты) — чистые функции в `packages/sim/src/match/rules.ts`. Их крутят и хост, и предсказание игрока.
- Игрок предсказывает весь мир: берёт последний снапшот хоста и переигрывает свой неподтверждённый ввод, чужих магов ведёт по их последнему движению и взгляду (решение Н1). Поправки сглаживаются.
- Клиентский кадр отделяется от источника состояния: общий игровой вид `game/view.ts` получает кадры от «драйвера». Полигон — драйвер одиночной игры, сеть — драйверы хоста и игрока.
- Связь — PeerJS (облачный сигналинг, STUN Google и Cloudflare), как в тесте связи фазы 0. Снапшоты — JSON с округлением чисел, сжатый `deflate-raw`.

**Tech Stack:** Node 24, pnpm 12.14, TypeScript 7.0.2 (strict, `noUncheckedIndexedAccess`), Vitest 5.0.5, Vite 8.3.4, three.js 0.186.1, PeerJS 1.5.5, Web Audio, Web Workers, CompressionStream. Новых зависимостей нет.

## Global Constraints

- Новых пакетов нет: `package.json` и `pnpm-lock.yaml` не меняются. three.js — точно `0.186.1`, `@types/three` — `0.186.0`, `peerjs` — `1.5.5`.
- Чистота `sim`: `packages/sim` не импортирует three.js и DOM. В нём нет `Math.random`, `Date`, `performance` и изменяемого состояния на уровне модулей (кроме уже существующего буфера `scratch` в `body.ts`).
- Детерминизм: `stepMatch` и `stepGame` не меняют свои аргументы. Одинаковые состояние, ввод и контекст дают одинаковые до байта `JSON.stringify` состояния и события. Состояние — простые данные: «нет» — `NOBODY` (−1), времена — номера тиков.
- Полигон на `/` ведёт себя как раньше: без `spawns`, `mageRespawnS` и `spawnShieldS` в контексте матча всё считается по-старому. На старте фазы **634** теста; прежние тесты не правятся, кроме названных в задачах (дополнить литералы `TickCtx` новыми полями).
- **Чистая комната:** не открывать, не читать и не искать ничего в `D:\Claude Code\MagicGG\research\`. Не переносить код и числа других игр. Числа — из GDD (разделы 2.2, 3, 7), этого плана и кода `main`.
- Хосту нельзя доверять чужому вводу: каждое сообщение игрока проходит строгий разбор (`parseClientMsg`), длинные и битые отбрасываются, ввод очищает `sanitizeInput` симуляции.
- Интерфейс на русском. Клавиши только по `event.code`, Ctrl/Alt/Cmd ни на что не назначены. Комментарии в коде — на русском, в стиле соседнего кода.
- Проверки перед коммитом: `pnpm test` (из корня), `pnpm typecheck`, для задач клиента ещё `pnpm build:client`.
- Коммиты в стиле `feat(sim): …`, `feat(client): …`, `test(…)`. Сообщение заканчивается строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Автор git уже настроен (noreply), не менять.

## Решения этого плана

| № | Решение | Почему |
|---|---|---|
| Н1 | **Предсказание всего мира от снапшота** (rollback-lite): игрок берёт состояние хоста на тике T и переигрывает свой ввод с номерами после подтверждённого. Чужие маги в переигровке идут по своему последнему движению и взгляду, без кнопок. Рендер — одно предсказанное «сейчас», буфера интерполяции нет | Свой каст, снаряд, стена и попадание видны в тот же кадр. Друзья в одном городе (пинг 10–60 мс), экстраполяция чужих короткая. Код вида, эффектов и HUD работает с одним состоянием, как на полигоне |
| Н2 | Ввод: каждый тик (60 Гц) с номером `seq`, в пакете 3 последних. Хост держит очередь на игрока и берёт один ввод за тик. Хвост больше 6 обрезается до 2, нажатия выброшенных переносятся в следующий. Ввода нет — повтор последнего, тишина больше 250 мс — маг стоит | Часы игрока и хоста не синхронизируются: подтверждение `ack` по номеру ввода. Вкладка игрока в фоне не уводит мага в ущелье |
| Н3 | Снапшот 20 Гц: всё `GameState`, подтверждения, последнее движение магов, состав комнаты, события с номерами тиков. Нецелые числа округляются до 1e−5, JSON сжимается `deflate-raw` | Проще всего и надёжно: никакой дельта-логики. ≈ 1–3 КБ на снапшот, хосту на 5 игроков ≈ 0,3 МБ/с |
| Н4 | Поправка предсказания сглаживается: сдвиг гаснет как e^(−t/τ), τ = 100 мс у чужих и 60 мс у своего. Сдвиг больше 3 м — без сглаживания (возрождение, телепорт) | Без рывков при обычной поправке и без «полёта через карту» |
| Н5 | События: свои и предсказанные — сразу из предсказания. События хоста идут в эффекты, только если предсказание их не показало (ключ события ±8 тиков) и им не больше 60 тиков. Килфид, счёт и экран смерти — только по событиям и состоянию хоста | Каст отзывается мгновенно, чужое не теряется, ложное предсказание не попадает в счёт |
| Н6 | Правила «Свалки» по GDD 3: 7 мин; лимит 10 очков при ≤ 2 магах, 12 при 3–4, 15 при 5–6; при ничьей по таймеру — внезапная смерть до 60 с, потом ничья. Очко — убийство или засчитанный сброс (последний ударивший за 5 с), сам упал — 0 | Цифры GDD; ничья после внезапной смерти — проще, чем бесконечное продление |
| Н7 | Возрождение через 3 с само (клик-раньше — отложено). Точка — дальняя от живых врагов из `arena.spawns` (видимость — отложено). Защита 2 с: урона нет, свой каст снимает | GDD 3 в упрощении на день работы |
| Н8 | Фазы: разминка (счёт не важен) → хост жмёт «Начать матч» → отсчёт 3 с → бой → итоги → хост жмёт «Ещё раз» → отсчёт. В начале боя все встают на дальние точки, счёт обнуляется | Друзья заходят по одному; бой начинается, когда собрались |
| Н9 | Комната: код из 4 знаков без похожих букв, ссылка `/r/КОД`, до 6 магов, ник генерируется и правится. Хост открывает комнату сразу при заходе на `/play` | Ссылку можно кинуть, пока хост выбирает стихию |
| Н10 | Хост ушёл — у всех «Хост вышел», матч окончен (миграции нет). Игрок отключился — его маг исчезает; вернётся — заходит заново с нулём очков | Миграция и место на 30 с — отложены |
| Н11 | Таймер хоста — Web Worker (в фоновой вкладке таймеры главного потока тормозятся до 1 Гц). Нет Worker — `setInterval` | Хост свернул окно, а матч идёт |
| Н12 | Смена стихии: на экране смерти клавишами 1/2 (применится при возрождении), в разминке и на итогах — сразу, в бою живым — нельзя | GDD: смена на экране смерти |
| Н13 | Имитация сети `?lag=МС&loss=%` на обеих сторонах: задержка отправки lag/2 ± 10 %, потеря loss % | Проверить предсказание в двух вкладках одного компьютера |
| Н14 | Отложено: миграция хоста, возврат на место, руна и сферы, корона лидера, компенсация пинга, видимость при выборе точки, возрождение кликом, Вода и Воздух, ульты, реакции, TURN | Порядок выреза ради игры с друзьями в ближайшие дни |

## Владение файлами

| Задача | Волна | Создаёт | Правит |
|---|---|---|---|
| 1. Правила «Свалки» | 1 | `packages/sim/src/match/rules.ts`, `rules.test.ts` | `match/types.ts`, `state.ts`, `combat.ts`, `units.ts`, `kit.ts`, `match.ts`, `index.ts`; литералы `TickCtx` в `aim.test.ts`, `combat.test.ts`, `projectiles.test.ts`, `terrain.test.ts`, `units.test.ts`, `zones.test.ts` |
| 2. Сетевые основы | 1 | `apps/client/src/net/protocol.ts`, `codec.ts`, `inputQueue.ts`, `room.ts` и тесты | — |
| 3. Транспорт | 1 | `apps/client/src/net/link.ts`, `ticker.ts` и тесты | `apps/client/src/nettest/p2p.ts` (только `export`) |
| 4. Общий игровой цикл | 1 | `apps/client/src/game/driver.ts`, `game/view.ts`, `sandbox/soloDriver.ts`, `soloDriver.test.ts` | `apps/client/src/sandbox/page.ts` |
| 5. Чужие маги на экране | 1 | `apps/client/src/fx/mageMeshes.ts`, `mageMeshes.test.ts` | `fx/vfx.ts`, `hud/combatHud.ts`, `feel/eventMap.ts`, `eventMap.test.ts`, `fx/fxTestPage.ts` |
| 6. Хост и предсказание | 2 | `apps/client/src/net/snapshot.ts`, `hostCore.ts`, `predict.ts`, `loopback.test.ts` и тесты | — |
| 7. Страница PvP | 3 | `apps/client/src/pvp/page.ts`, `lobby.ts`, `hostDriver.ts`, `clientDriver.ts`, `pvp.css` | `main.ts`, `game/view.ts`, `sandbox/hud.ts`, `sandbox/page.ts` |
| 8. Интерфейс матча | 4 | `apps/client/src/pvp/matchHud.ts`, `pvp/format.ts`, `format.test.ts` | `pvp/page.ts`, `pvp.css` |

---

### Task 1: Правила «Свалки» в sim

**Модель:** Opus (правила и ощущение боя).

**Files:**
- Create: `packages/sim/src/match/rules.ts`, `packages/sim/src/match/rules.test.ts`
- Modify: `packages/sim/src/match/types.ts`, `state.ts`, `combat.ts`, `units.ts`, `kit.ts`, `match.ts`, `index.ts`
- Modify (только дописать новые поля в литералы `TickCtx`, утверждения не трогать): `aim.test.ts`, `combat.test.ts`, `projectiles.test.ts`, `terrain.test.ts`, `units.test.ts`, `zones.test.ts`

**Interfaces:**
- Consumes: `stepMatch`, `createMatchState`, `createMageUnit`, `clonePlain`, `matchContext`, `ticks`, `NEVER` из `main`.
- Produces (задачи 2–8 импортируют из `@doodlemagic/sim`): всё из блока `rules.ts` ниже, `statusFlags(...).shielded`, `Statuses.shieldUntil`, `stats.deaths`.

**Изменения контрактов (`types.ts`, `state.ts`):**

```ts
/** Статика матча. Новые поля необязательны: без них полигон считается как раньше. */
export interface MatchContext {
  readonly world: World;
  readonly killBelowY: number;
  /** PvP: точки возрождения. Маг встаёт на дальнюю от живых врагов (pickSpawn). Нет поля — на свою mage.spawn. */
  readonly spawns?: readonly Spawn[];
  /** Через сколько секунд возрождается маг. Нет поля — MATCH.mageRespawnS (полигон, 1 с). */
  readonly mageRespawnS?: number;
  /** Защита после появления, с. Нет поля — 0: защиты нет. */
  readonly spawnShieldS?: number;
}

/** К прежним полям TickCtx добавляются (stepMatch заполняет их из MatchContext): */
readonly spawns: readonly Spawn[] | null;
readonly mageRespawnTicks: number;
readonly spawnShieldTicks: number;

/** В Statuses: «Защита после появления» — урона нет, пока now < shieldUntil; свой каст снимает. freshStatuses: 0. */
shieldUntil: number;

/** В MageState.stats добавляется deaths: смерти от урона и падения, в том числе свои. createMageUnit: 0. */
stats: { damage: number; kills: number; falls: number; deaths: number };

/** statusFlags возвращает ещё shielded: now < status.shieldUntil. */
```

**Изменения поведения:**
- `combat.ts`: `respawnAt(u, t)` берёт у мага `t.mageRespawnTicks`, у манекена — как раньше `DUMMY.respawnS`. В `applyHit` сразу после проверки «цель жива» стоит защита: `if (t.now < u.status.shieldUntil) return 0;` — ни урона, ни толчка, ни события `hit`. При убийстве `deaths` цели +1.
- `units.ts`, `stepLife`: на сбросе (в том числе самопадении) `deaths` мага +1. На возрождении мага: если `t.spawns` не `null`, точка — `pickSpawn(s, u.id, t.spawns)` (по текущему состоянию, сам маг мёртв и в расчёт не входит). Эта точка записывается в `fresh.mage.spawn`, туда же идёт событие `respawn`. Если `t.spawnShieldTicks > 0`, то `fresh.status.shieldUntil = now + t.spawnShieldTicks`.
- `kit.ts`, `emitCast`: принятый каст снимает защиту: `u.status.shieldUntil = Math.min(u.status.shieldUntil, t.now)`.
- `match.ts`, `stepMatch`: `TickCtx` получает `spawns: ctx.spawns ?? null`, `mageRespawnTicks: ticks(ctx.mageRespawnS ?? MATCH.mageRespawnS)`, `spawnShieldTicks: ticks(ctx.spawnShieldS ?? 0)`.

**`rules.ts` — константы, типы, функции:**

```ts
import { NEVER, type Element, type MatchContext, type MatchEvent, type MatchInput, type MatchState, type Unit, type UnitId } from "./types";

/** «Свалка» (GDD 3; решения Н6–Н8 плана фазы 3-lite). */
export const PVP = { maxPlayers: 6, countdownS: 3, matchS: 420, suddenDeathS: 60, respawnS: 3, shieldS: 2 } as const;

export type GamePhase = "warmup" | "countdown" | "live" | "results";
export interface Standing { id: UnitId; score: number; kills: number; falls: number; deaths: number }
export interface GameState {
  phase: GamePhase;
  /** countdown — тик начала боя; live — тик конца времени (во внезапной смерти — её конца); warmup и results — NEVER. */
  phaseEnd: number;
  suddenDeath: boolean;
  /** Лимит очков: в разминке — по числу магов, в бою — не меньше, чем был на старте (вошедшие поднимают). */
  scoreLimit: number;
  /** Итог боя по местам; вне results — []. */
  results: Standing[];
  /** id следующего мага. id не переиспользуются; маги — 1…999, снаряды и зоны — с 1000. */
  nextMageId: number;
  match: MatchState;
}
export interface GameStep { game: GameState; events: MatchEvent[] }

export function scoreOf(u: Unit): number;                       // маг: kills + falls; иначе 0
export function standings(g: Readonly<GameState>): Standing[];  // маги: очки ↓, смерти ↑, id ↑
export function scoreLimitFor(mages: number): number;           // ≤ 2 → 10; 3–4 → 12; ≥ 5 → 15
export function pvpContext(arena: ArenaData): MatchContext;     // matchContext(arena) + spawns (копия), mageRespawnS 3, spawnShieldS 2; без точек — throw
export function pickSpawn(s: Readonly<MatchState>, id: UnitId, spawns: readonly Spawn[]): Spawn;
export function createGame(): GameState;                        // warmup, NEVER, false, 10, [], 1, пустой матч
export function addMage(g: Readonly<GameState>, element: Element, ctx: MatchContext): { game: GameState; id: UnitId };
export function removeMage(g: Readonly<GameState>, id: UnitId): GameState;
export function setElement(g: Readonly<GameState>, id: UnitId, element: Element, ctx: MatchContext): GameState;
export function startCountdown(g: Readonly<GameState>): GameState;
export function stepGame(g: Readonly<GameState>, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>, ctx: MatchContext): GameStep;
```

Поведение:
- `pickSpawn`: для каждой точки k — d_k = наименьшее расстояние по XZ до живых магов с id ≠ `id` (их нет — `Infinity`). Берётся наибольшее d_k, при равенстве — меньший k. Пустой список — `throw`.
- `addMage`: нужен `ctx.spawns` (нет — `throw`). id = `nextMageId`, маг через `createMageUnit` на `pickSpawn`, защита `match.tick + ticks(ctx.spawnShieldS ?? 0)`, юнит в конец `units` (id растут). `scoreLimit`: в разминке `scoreLimitFor(число магов)`, в бою и на отсчёте `max(текущий, scoreLimitFor(число магов))`. Аргумент не меняется.
- `removeMage`: копия без юнита, его снарядов, зон и рельефа. `scoreLimit` не меняется.
- `setElement`: нет такого мага — копия без изменений. Мёртвый — меняется только `mage.element` (возродится им). Живой в `warmup`, `countdown` или `results` — сразу свежий маг этой стихии на `pickSpawn` с прежним счётом и защитой; его снаряды, зоны и рельеф убраны. Живой в `live` — без изменений.
- `startCountdown`: из `warmup` или `results` — `countdown`, `phaseEnd = match.tick + ticks(PVP.countdownS)`, `results = []`, `suddenDeath = false`. Из других фаз — копия без изменений.
- `stepGame` — `stepMatch`, затем по фазе (тик — `match.tick` после шага):
  - `warmup`: `scoreLimit = scoreLimitFor(число магов)`.
  - `countdown`: тик ≥ `phaseEnd` → старт боя. Маги по возрастанию id заново: свежий маг той же стихии на `pickSpawn` среди уже расставленных в этом старте, с защитой. Счёт обнулён, снаряды, зоны и рельеф убраны. Для каждого мага — событие `respawn` (вид поставит камеру и взгляд). `phase = "live"`, `phaseEnd = тик + ticks(PVP.matchS)`, `scoreLimit = scoreLimitFor(число магов)`.
  - `live`: `scoreLimit = max(scoreLimit, scoreLimitFor(число магов))`. Лидер набрал лимит — конец. Иначе, если тик ≥ `phaseEnd`: при ничьей лидеров (магов ≥ 2 и очки первых двух равны) без внезапной смерти — `suddenDeath = true`, `phaseEnd = тик + ticks(PVP.suddenDeathS)`; иначе конец. Во внезапной смерти ничья разбита — конец.
  - Конец: `phase = "results"`, `results = standings(...)`, `phaseEnd = NEVER`, `suddenDeath = false`.
  - `results`: ничего не меняется, бой идёт без счёта.

**Тестовый контекст** (`rules.test.ts`):

```ts
const SPAWNS: Spawn[] = [
  { pos: { x: -30, y: 0, z: -30 }, yaw: 0 },
  { pos: { x: 10, y: 0, z: 30 }, yaw: Math.PI },
  { pos: { x: -30, y: 0, z: 30 }, yaw: Math.PI },
  { pos: { x: 10, y: 0, z: -30 }, yaw: 0 },
];
const ctx: MatchContext = { ...testContext(), spawns: SPAWNS, mageRespawnS: PVP.respawnS, spawnShieldS: PVP.shieldS };
```

- [ ] **Step 1: Тесты контрактов и защиты.** `freshStatuses().shieldUntil === 0`, `stats.deaths === 0`; удар по защищённому магу даёт 0 и нет события `hit`; принятый каст снимает защиту; без `spawnShieldS` в контексте защиты нет. Запустить, увидеть падение.
- [ ] **Step 2: Реализовать изменения контрактов** (`types.ts`, `state.ts`, `combat.ts`, `units.ts`, `kit.ts`, `match.ts`), дописать новые поля в литералы `TickCtx` шести тестов. `pnpm test`: прежние 634 зелёные, новые проходят.
- [ ] **Step 3: Тесты `rules.ts`:**
  - `scoreLimitFor`: 0, 1, 2 → 10; 3, 4 → 12; 5, 6, 7 → 15.
  - `pickSpawn`: никого — `SPAWNS[0]`; враг у точки 0 — самая дальняя от него; равенство — меньший индекс; мёртвые и сам маг не считаются; пустой список — `throw`.
  - `addMage`: id 1, 2, 3; второй встаёт дальше всех от первого; защита до `tick + 120`; аргумент под `deepFreeze` не меняется.
  - `deaths`: убийство — у цели +1 `deaths`, у убийцы +1 `kills`; сброс — `deaths` +1, засчитанному +1 `falls`; самопадение — только `deaths`.
  - Возрождение в PvP: мёртвый маг встаёт через 180 тиков на точку дальше всех от живых врагов, событие `respawn` с этой точкой, `mage.spawn` обновлён, защита есть.
  - Фазы: `startCountdown` → 180 тиков отсчёта → `live`. Счёт обнулён, маги на разных точках, снарядов и зон нет, по событию `respawn` на мага, `phaseEnd = тик + 25200`.
  - Конец по лимиту: в бою у мага `kills = scoreLimit` (правка копии) → после шага `results` с местами.
  - Таймер без ничьей → `results`; с ничьей → внезапная смерть (`phaseEnd` + 3600); ничья разбита → `results` на следующем шаге; время вышло — `results` (ничья).
  - `standings`: очки ↓, смерти ↑, id ↑.
  - `removeMage`: юнит, его снаряды, зоны, рельеф убраны; аргумент не меняется.
  - `setElement`: мёртвый — возродится новой стихией с её HP; живой в разминке — сразу свежий, счёт сохранён; живой в бою — без изменений.
  - Детерминизм: два прогона 600 тиков (два мага стреляют ЛКМ и Q по сценарию ввода, один старт отсчёта) дают одинаковый `JSON.stringify` всех состояний и событий.
- [ ] **Step 4: Реализовать `rules.ts`**, экспортировать из `match/index.ts`. `pnpm test` и `pnpm typecheck` зелёные.
- [ ] **Step 5: Commit** `feat(sim): free-for-all rules, respawn points, spawn shield, deaths`.

---

### Task 2: Сетевые основы

**Модель:** Sonnet (код задан почти целиком).

**Files:**
- Create: `apps/client/src/net/protocol.ts`, `codec.ts`, `inputQueue.ts`, `room.ts`
- Test: `apps/client/src/net/protocol.test.ts`, `codec.test.ts`, `inputQueue.test.ts`, `room.test.ts`

**Interfaces:**
- Consumes: `ELEMENTS`, `Element`, `MatchInput`, `UnitId` из `@doodlemagic/sim` (есть в `main`).
- Produces: всё ниже. Задачи 6–8 опираются на эти имена.

**`protocol.ts`:**

```ts
import { ELEMENTS, type Element, type MatchInput, type UnitId } from "@doodlemagic/sim";

/** Версия сетевого протокола игры: хост и игрок разных версий вместе не играют. */
export const NET_VERSION = 1;
export const NAME_MAX = 16;
/** Предел текстового сообщения игрока, знаков. */
export const MAX_TEXT_CHARS = 4096;
/** Сколько последних вводов несёт пакет игрока: пропавший пакет покрывают следующие. */
export const INPUTS_PER_PACKET = 3;
export const MAX_INPUTS_PER_PACKET = 8;
export const BIT = { jump: 1, primary: 2, q: 4, e: 8, c: 16 } as const;

/** Ввод тика в пакете: [seq, moveX, moveZ, yaw, pitch, кнопки по BIT]. */
export type PackedInput = [number, number, number, number, number, number];
export interface SeqInput { seq: number; input: MatchInput }
export type DenyReason = "full" | "version";

export type ClientMsg =
  | { t: "join"; v: number; name: string; element: Element }
  | { t: "in"; items: SeqInput[] }
  | { t: "el"; element: Element }
  | { t: "ping"; ct: number; rtt: number };
/** Текстовые сообщения хоста; снапшот идёт отдельно, двоичным (codec.ts). */
export type HostText =
  | { t: "welcome"; v: number; id: UnitId; room: string }
  | { t: "deny"; reason: DenyReason }
  | { t: "pong"; ct: number };

export function packInput(seq: number, inp: MatchInput): PackedInput;
export function unpackInput(p: PackedInput): MatchInput;
/** Сообщение игрока для отправки: join, el, ping как JSON; ввод — {t:"in", i: PackedInput[]}. */
export function joinText(name: string, element: Element): string;
export function inputText(packets: readonly PackedInput[]): string;
export function elementText(element: Element): string;
export function pingText(ct: number, rtt: number): string;
export function hostText(m: HostText): string;
export function cleanName(raw: unknown): string;
export function parseClientMsg(raw: unknown): ClientMsg | null;
export function parseHostText(raw: unknown): HostText | null;
```

Разбор (`parseClientMsg`) — всё, что не подходит, даёт `null`:
- `raw` — строка не длиннее `MAX_TEXT_CHARS`, `JSON.parse` без исключения, объект (не массив).
- `join`: `v` — конечное число; имя через `cleanName`, пустое → «Маг»; `element` из `ELEMENTS`.
- `in`: поле `i` — массив длиной 1…`MAX_INPUTS_PER_PACKET`; каждый элемент — массив ровно из 6 конечных чисел; `seq` — `Number.isSafeInteger` и ≥ 0; кнопки — целое 0…31; `moveX`, `moveZ` зажимаются в [−1, 1]. Результат — `items` в порядке пакета.
- `el`: `element` из `ELEMENTS`.
- `ping`: `ct` конечное; `rtt` конечное, зажимается в [−1, 10000].

`cleanName`: не строка → `""`; убрать управляющие и невидимые знаки (`\p{Cc}`, `\p{Cf}`), серии пробелов → один, обрезать края, не больше `NAME_MAX` кодовых точек.

`parseHostText`: строка → JSON → `welcome` (`v` конечное, `id` — безопасное целое ≥ 1, `room` — строка ≤ 8 знаков) | `deny` (`reason` из `"full" | "version"`) | `pong` (`ct` конечное); иначе `null`.

**`codec.ts`:**

```ts
/** Нецелые числа снапшота округляются до 1e−5: 10 мкм по положению, JSON вдвое короче. */
export const QUANT = 1e5;
export const MAX_DECODED_BYTES = 4 * 1024 * 1024;
const FORMAT_JSON = 0;
const FORMAT_DEFLATE = 1;

/** Глубокая копия: нецелые конечные числа округлены, −0 → 0, NaN и ±Infinity → 0. Строки, true/false, null — как есть. */
export function quantize(v: unknown): unknown {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return 0;
    return (Number.isInteger(v) ? v : Math.round(v * QUANT) / QUANT) + 0;
  }
  if (Array.isArray(v)) return v.map(quantize);
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = quantize((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

/** Первый байт — формат: 1 — JSON(quantize(value)) в deflate-raw; 0 — тот же JSON без сжатия (нет CompressionStream). */
export async function encodeBinary(value: unknown): Promise<Uint8Array>;
/** Обратно. Любой сбой (формат, распаковка, JSON, больше MAX_DECODED_BYTES) → undefined. */
export async function decodeBinary(data: ArrayBuffer | Uint8Array): Promise<unknown>;
```

Сжатие и распаковка — через `new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()` (и `DecompressionStream`). В Node 24 оба класса глобальные — тесты идут без моков.

**`inputQueue.ts`:**

```ts
import type { MatchInput } from "@doodlemagic/sim";
import type { SeqInput } from "./protocol";

/** Ввода нет дольше — маг стоит (вкладка игрока в фоне, обрыв). */
export const STALE_INPUT_MS = 250;
/** Хвост очереди длиннее — обрезается до TRIM_TO: хост не копит задержку. */
export const MAX_BACKLOG = 6;
export const TRIM_TO = 2;
export const MAX_PENDING = 64;
const BUTTONS = ["jump", "primary", "q", "e", "c"] as const;

/** Очередь ввода одного игрока у хоста. ack — номер последнего применённого ввода (−1 — ни одного). */
export interface InputQueue { ack: number; last: MatchInput | null; lastAt: number; pending: SeqInput[] }

export function createInputQueue(): InputQueue {
  return { ack: -1, last: null, lastAt: -Infinity, pending: [] };
}

/** Новые вводы в очередь: старые (seq ≤ ack) и повторы отбрасываются, очередь по возрастанию seq, не длиннее MAX_PENDING. */
export function pushInputs(q: InputQueue, items: readonly SeqInput[], nowMs: number): void {
  if (items.length > 0) q.lastAt = nowMs;
  for (const it of items) {
    if (it.seq <= q.ack || q.pending.some((p) => p.seq === it.seq)) continue;
    q.pending.push(it);
  }
  q.pending.sort((a, b) => a.seq - b.seq);
  if (q.pending.length > MAX_PENDING) q.pending.splice(0, q.pending.length - MAX_PENDING);
}

/**
 * Ввод на тик. Очередь пуста: последний ввод ещё свеж — он же (кнопки остаются зажатыми, новых нажатий нет),
 * иначе null — маг стоит. Хвост длиннее MAX_BACKLOG — старые выбрасываются до TRIM_TO, их нажатия переходят в
 * следующий ввод (тап не теряется). Пропуск номера (потеря) — берётся следующий по порядку.
 */
export function takeInput(q: InputQueue, nowMs: number): MatchInput | null {
  if (q.pending.length === 0) return q.last !== null && nowMs - q.lastAt <= STALE_INPUT_MS ? q.last : null;
  if (q.pending.length > MAX_BACKLOG) {
    const dropped = q.pending.splice(0, q.pending.length - TRIM_TO);
    const next = q.pending[0]!;
    const merged = { ...next.input };
    for (const d of dropped) for (const b of BUTTONS) if (d.input[b]) merged[b] = true;
    next.input = merged;
  }
  const it = q.pending.shift()!;
  q.ack = it.seq;
  q.last = it.input;
  return it.input;
}
```

**`room.ts`:**

```ts
import { NET_VERSION } from "./protocol";

/** Без I, L, O, 0, 1: код читают голосом и переписывают с экрана. */
export const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_LEN = 4;
export const NAME_POOL = ["Искра", "Уголёк", "Пепел", "Факел", "Жар", "Валун", "Кремень", "Гранит", "Щебень", "Скала"] as const;

export function newRoomCode(rand: () => number = Math.random): string;     // ROOM_LEN знаков из алфавита
/** Верхний регистр, без пробелов и «-»; ровно ROOM_LEN знаков алфавита — код, иначе null. */
export function cleanRoomCode(raw: string): string | null;
/** "/r/abcd", "/r/ABCD/" → "ABCD"; другой путь или плохой код → null. decodeURIComponent с защитой от исключения. */
export function parseRoomPath(pathname: string): string | null;
/** PeerJS-ID хоста; отличается от теста связи (`doodlemagic-nt-…`). */
export function gamePeerId(code: string): string { return `doodlemagic-g${NET_VERSION}-${code.toLowerCase()}-host`; }
export function roomLink(origin: string, code: string): string { return `${origin}/r/${code}`; }
/** «Искра 42»: слово из NAME_POOL и число 10…99. */
export function defaultName(rand: () => number = Math.random): string;
```

- [ ] **Step 1: Тесты `protocol.ts`:** `packInput`/`unpackInput` туда и обратно для всех сочетаний кнопок; `parseClientMsg` принимает правильные `join`, `in`, `el`, `ping` и отвергает: не строку, длиннее 4096, не JSON, массив, неизвестный `t`, `in` с 0 и 9 вводами, с 5 числами, с `NaN`/строкой, с дробным или отрицательным `seq`, с кнопками 32 и 1.5, `join` с неизвестной стихией; `moveX` 5 зажимается в 1; `cleanName` режет управляющие и невидимые знаки, схлопывает пробелы, обрезает до 16 кодовых точек (эмодзи не рвутся); пустое имя в `join` → «Маг»; `parseHostText` для трёх видов и мусора.
- [ ] **Step 2: Реализовать `protocol.ts`**, тесты зелёные.
- [ ] **Step 3: Тесты `codec.ts`:** `quantize` (дробные до 1e−5, целые и `NEVER` как есть, −0 → 0, `NaN`/`Infinity` → 0, вложенные массивы и объекты, строки и `null`); `encodeBinary` → `decodeBinary` возвращает то же, что `quantize`, для состояния настоящего матча (`createMatch` с двумя магами и 120 тиков `stepMatch`); первый байт 1; сжатое меньше JSON больше чем вдвое; битые байты, пустой массив, неизвестный формат → `undefined`; без `CompressionStream` (временно убрать глобал в тесте) — формат 0 и обратный разбор работает.
- [ ] **Step 4: Реализовать `codec.ts`**, тесты зелёные.
- [ ] **Step 5: Тесты `inputQueue.ts`:** по порядку; повтор и старый `seq` отбрасываются; пропуск номера; пустая очередь — повтор последнего до 250 мс и `null` после; хвост 9 → обрезка до 2, нажатия выброшенных (`q`, `jump`) переходят в следующий; `ack` растёт; больше 64 — старые выкинуты.
- [ ] **Step 6: Реализовать `inputQueue.ts`**, тесты зелёные.
- [ ] **Step 7: Тесты `room.ts`:** код из 4 знаков алфавита (детерминированный `rand`); `cleanRoomCode("ab-cd")` → `"ABCD"`, `"ABCI"` → `null`, `"ABC"` → `null`; `parseRoomPath` для `/r/abcd`, `/r/ABCD/`, `/r/%zz`, `/play`, `/r/`; `gamePeerId("ABCD")` → `"doodlemagic-g1-abcd-host"`; `defaultName` — слово из пула и число 10…99.
- [ ] **Step 8: Реализовать `room.ts`.** `pnpm test`, `pnpm typecheck` зелёные.
- [ ] **Step 9: Commit** `feat(client): game protocol, snapshot codec, input queue, room codes`.

---

### Task 3: Транспорт

**Модель:** Sonnet.

**Files:**
- Create: `apps/client/src/net/link.ts`, `apps/client/src/net/ticker.ts`
- Test: `apps/client/src/net/link.test.ts`, `apps/client/src/net/ticker.test.ts`
- Modify: `apps/client/src/nettest/p2p.ts` — только дописать `export` к `openPeer`, `keepSignalling`, `CONN_OPTIONS`. Поведение теста связи не меняется.

**Interfaces:**
- Consumes: `openPeer`, `keepSignalling`, `CONN_OPTIONS` из `nettest/p2p.ts`; `gamePeerId` из `net/room.ts` (задача 2 — в своей ветке её ещё нет: импортировать по этому имени и сигнатуре `(code: string) => string`; если файла ещё нет, временно объявить такую же функцию в `link.ts` с пометкой и при слиянии контролёр заменит её импортом).
- Produces:

```ts
// link.ts
export interface LagOptions { lagMs: number; lossPct: number }
/** ?lag=120&loss=2 → { lagMs: 120, lossPct: 2 }; lag зажат в 0…1000, loss в 0…50; нет обоих — null. */
export function lagFromQuery(search: string): LagOptions | null;
/** Одна отправка: потеря с вероятностью loss %, задержка lag/2 × (0,9 + 0,2·rand) — в одну сторону. */
export function lagDecision(o: LagOptions, rand: () => number): { drop: boolean; delayMs: number };

/** Канал до одного игрока у хоста. */
export interface Conn {
  /** Уникален для соединения (connectionId PeerJS). */
  readonly id: string;
  readonly open: boolean;
  send(data: string | Uint8Array): void;
  close(): void;
}
export interface HostLinkHandlers {
  onConn(c: Conn): void;
  onData(c: Conn, data: string | ArrayBuffer): void;
  onClose(c: Conn): void;
}
export interface HostLink { close(): void }
/** Открывает комнату: PeerJS-ID gamePeerId(code). Занят — reject с ошибкой type "unavailable-id". */
export function openHostLink(code: string, h: HostLinkHandlers, lag?: LagOptions | null): Promise<HostLink>;

export type JoinFailure = "noHost" | "noChannel";
export interface JoinHandlers {
  onOpen(): void;
  onData(data: string | ArrayBuffer): void;
  /** Канал был открыт и закрылся (хост ушёл, обрыв). */
  onClose(): void;
  /** Канал так и не открылся: хоста нет (peer-unavailable) или P2P не поднялся за 15 с. */
  onFail(reason: JoinFailure): void;
}
export interface JoinLink { send(data: string | Uint8Array): void; close(): void }
/** Сигналинг недоступен — reject. Дальше исход — через обработчики. */
export function openJoinLink(code: string, h: JoinHandlers, lag?: LagOptions | null): Promise<JoinLink>;

// ticker.ts
/** Пульс примерно каждые intervalMs из Web Worker (в фоновой вкладке не тормозится); нет Worker — setInterval. Возвращает stop. */
export function startTicker(onPulse: () => void, intervalMs?: number): () => void;
```

Поведение:
- Данные PeerJS приводятся к `string | ArrayBuffer`: строка и `ArrayBuffer` — как есть; `ArrayBufferView` — копия его байтов в новый `ArrayBuffer`; `Blob` — `arrayBuffer()` и доставка после чтения; прочее отбрасывается.
- Хост: `onConn` — на `open` соединения; `onClose` — один раз на соединение (`close` или `error`); `send` при закрытом канале молчит. Имитация лага — на каждой отправке.
- Игрок: `me.connect(gamePeerId(code), CONN_OPTIONS)`; `undefined` (сигналинг отключён) — повтор через 1 с до срока 15 с. Ошибка `peer-unavailable` до открытия — `onFail("noHost")`; срок 15 с без открытия — `onFail("noChannel")`; оба зовутся не больше одного раза, после них `peer.destroy()`. Автопереподключения нет (Н10).
- `ticker.ts`: исходник воркера строкой в `Blob`, `URL.createObjectURL`, сообщение с интервалом запускает `setInterval(() => postMessage(0), ms)`; `stop()` завершает воркер и отзывает URL. `typeof Worker === "undefined"` или исключение при создании — запасной `setInterval`. По умолчанию `intervalMs = 4`.

- [ ] **Step 1: Тесты:** `lagFromQuery` (оба, один, мусор, зажим); `lagDecision` (детерминированный `rand`: потеря и граница, задержка в пределах); `startTicker` в Node (Worker нет) с фальшивыми таймерами `vi.useFakeTimers()`: пульсы идут, после `stop()` — нет.
- [ ] **Step 2: Реализовать `link.ts`, `ticker.ts`, экспорт в `p2p.ts`.** Тесты, `pnpm typecheck`, `pnpm build:client` зелёные. Живую проверку двух вкладок делает контролёр в задаче 9.
- [ ] **Step 3: Commit** `feat(client): PeerJS game link with lag simulation, worker ticker`.

---

### Task 4: Общий игровой цикл: вид и драйвер

**Модель:** Opus (весь кадр полигона, ощущение не должно измениться).

**Files:**
- Create: `apps/client/src/game/driver.ts`, `apps/client/src/game/view.ts`, `apps/client/src/sandbox/soloDriver.ts`, `apps/client/src/sandbox/soloDriver.test.ts`
- Modify: `apps/client/src/sandbox/page.ts` — становится тонким: собирает матч полигона, `createSoloDriver` и `mountGameView`.

**Interfaces:**
- Consumes: всё, что сейчас импортирует `sandbox/page.ts`.
- Produces (задачи 7–8 опираются):

```ts
// game/driver.ts
import type { Element, MatchEvent, MatchInput, MatchState, Spawn, UnitId } from "@doodlemagic/sim";

export interface TickOut { state: MatchState; events: MatchEvent[] }
export interface Frame {
  /** Новые тики кадра по порядку; их события — эффекты «сейчас». */
  ticks: TickOut[];
  /** События не из новых тиков (сеть: хост посчитал, предсказание не показало) — тоже в эффекты. */
  late: MatchEvent[];
  /** Подтверждённые события, ставшие известны в этом кадре: полигон и хост — события тиков, игрок — из снапшотов. */
  confirmed: MatchEvent[];
  prev: MatchState;
  cur: MatchState;
  alpha: number;
}
export interface Driver {
  readonly localId: UnitId;
  /** Кадр длиной dtS. sample() — ввод игрока на тик; хост может звать его и между кадрами (из таймера). */
  advance(dtS: number, sample: () => MatchInput): Frame;
  /** Игрок выбрал стихию. Вернул точку — маг уже стоит там (вид ставит взгляд и руки); null — запрос ушёл хосту. */
  chooseElement(e: Element): Spawn | null;
  dispose(): void;
}

// game/view.ts
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
}
export interface GameView {
  readonly hud: Hud;
  readonly input: InputDevice;
  readonly combat: CombatHud;
  route(e: Effect): void;
  stop(): void;
}
/** Сбой рендера при запуске — сообщение в HUD и null. */
export function mountGameView(o: GameViewOptions): GameView | null;

// sandbox/soloDriver.ts
export function createSoloDriver(ctx: MatchContext, initial: MatchState, localId: UnitId): Driver;
```

Что переезжает и как:
- В `view.ts` — всё из нынешнего `mountSandbox` про рендер, эффекты, звук, руки, камеру, падение, HUD, качество, настройки, прогрев, страховку `createGuard`, `fatal`. Цикл кадра: мышь → `look` → `driver.advance(dtS, sample)` → по `frame.ticks` как сейчас (сильнейшее приземление, тост «Сорвался!», `effectsFor` → `route`) → по `frame.late` эффекты (`effectsFor` с `state: frame.cur`) → `input.ticked()` при `ticks.length > 0` → камера → руки → магия → HUD → `onFrame` → звук → рендер.
- `sample()` = `buildMatchInput(input.locked ? input.down : NO_KEYS, look)` — читает текущие клавиши и взгляд в момент вызова.
- Событие `respawn` своего мага — и в `ticks`, и в `late` — ставит `look` на его `yaw`, руки в покой. `prev = cur` при возрождении теперь делает драйвер (у одиночного — в `advance`).
- `localId` — из драйвера. Своего юнита в состоянии может не быть (сеть: ещё не появился, удалён): тогда камера и руки не обновляются, кадр не падает.
- Руки прячутся и когда свой маг мёртв (`!alive`), не только при удержании камеры падения.
- `hud.onChangeElement` → экран выбора → `driver.chooseElement(e)`; если вернулась точка — сброс взгляда, жестов, рук, тряски, hitstop и пыль появления, как сейчас в `chooseElement`. `prefs.element` сохраняется в обоих случаях.
- Клавиша X (ульта «скоро») и отладка — как сейчас.
- `createSoloDriver`: накопитель `advanceClock(acc, dtS, TICK_DT)`, на тик `stepMatch(cur, { [localId]: sample() }, ctx)`, `prev = cur`; событие `respawn` своего мага → `prev = cur` после шага; `confirmed` — все события тиков; `late = []`. `chooseElement(e)`: `cur = prev = respawnMage(cur, localId, e)` и возврат `mage.spawn`. `dispose` — ничего.

- [ ] **Step 1: Тесты `soloDriver`:** `advance(1/60 × 3, …)` даёт 3 тика и `alpha` ≈ 0; `advance(0.5/60)` — 0 тиков и `alpha` 0,5; `sample` зовётся раз на тик; падение мага в ущелье полигона (поставить мага над зоной смерти правкой копии) → тик с `fall`, потом `respawn` и `prev === cur`; `chooseElement("earth")` → точка `TRAINING.spawn`, маг Земли, `prev === cur`; `confirmed` совпадает со склейкой событий тиков.
- [ ] **Step 2: Вынести `driver.ts`, `view.ts`, `soloDriver.ts`; `sandbox/page.ts` — тонкий.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные.
- [ ] **Step 3: Самопроверка поведения:** сравнить по коду старый и новый кадр по шагам (порядок этапов, `guard`, прогрев, автокачество, сторож, отладка). Никаких новых эффектов и правок цифр.
- [ ] **Step 4: Commit** `refactor(client): split the game view from its driver; training runs on a solo driver`.

---

### Task 5: Чужие маги на экране

**Модель:** Opus (вид и читаемость противника).

**Files:**
- Create: `apps/client/src/fx/mageMeshes.ts`, `apps/client/src/fx/mageMeshes.test.ts`
- Modify: `apps/client/src/fx/vfx.ts`, `apps/client/src/hud/combatHud.ts`, `apps/client/src/feel/eventMap.ts`, `apps/client/src/feel/eventMap.test.ts`, `apps/client/src/fx/fxTestPage.ts`

**Interfaces:**
- Consumes: `DummyPart` из `fx/dummyMeshes.ts` (тот же формат частей), `INK`, `createInkMaterial`, glows из `fx/glows.ts`, `FX_COLOR` из `fx/presets.ts`.
- Produces:

```ts
// fx/mageMeshes.ts
export interface MagePose {
  pos: Vec3;          // середина подошвы
  yaw: number;        // как PlayerInput.yaw
  pitch: number;      // взгляд; голова кивает на 0,4 от него
  /** Фаза шага, рад: ноги машут ± по синусу; амплитуда — speed / runSpeed, не больше 1. */
  stride: number;
  speed01: number;
  airborne: boolean;  // в воздухе ноги поджаты
  flinch: number;     // как у манекена
  flash: boolean;     // вспышка попадания
}
export function mageParts(p: MagePose): DummyPart[];
export const MAGE_PART_COUNT: number;
export function createMageMeshes(max: number): { group: Group; update(views: readonly MagePose[], lineScale: number): void; dispose(): void };

// hud/combatHud.ts — HudView получает необязательное поле:
names?: ReadonlyMap<UnitId, string>;
```

Поведение:
- Фигура мага 1,8 м из боксов (как манекен, но без подставки): две ноги, мантия, голова с белой маской на грани взгляда, шляпа (поля и тулья над хитбоксом), две «парящие» руки перед грудью. Чернила корпуса — `INK.enemy`, маски — `INK.halo`, вспышка попадания — как у манекена. Начальные размеры — на усмотрение исполнителя; итог смотрится в `/fx-test` рядом с манекеном.
- Стихия видна издалека: на руках мага — свечение в проходе света магии цветом его стихии (`FX_COLOR`), бюджет источников света — по пресету, как у прочих свечений.
- `vfx.sync`: каждый живой юнит `kind === "mage"` с `id !== localId` рисуется магом; положение и взгляд — между `prev` и `cur` по `alpha` (`lerpById`), фаза шага копится по пройденному пути. Вспышка и вздрагивание по эффектам `flash`/`flinch` работают для магов так же, как для манекенов (общая карта анимаций по id). Мёртвые не рисуются. Не больше 6 магов на экране; draw call'ов — не больше +3 к прежнему числу.
- `combatHud`: полоса HP над живыми чужими магами — как над манекенами (прячется за укрытием по `visible`). Есть `names` — над полосой имя.
- `eventMap`: `cast` чужого мага — позиционный звук каста (`sound(CAST_SOUND[ability], ev.pos)`), без жестов, ладоней и толчков камеры. `dash` `start` чужого — `burst("dashBlast", ev.pos, −dir)`. Свои события — как раньше.
- `/fx-test`: два мага (Огонь и Земля) ходят по кругу рядом с манекеном; их видно сбоку и спереди.

- [ ] **Step 1: Тесты `mageParts`:** число частей = `MAGE_PART_COUNT`; низ ног на `pos.y`; маска на стороне взгляда при yaw 0 и π/2; при `stride` π/2 и `speed01` 1 ноги разведены в разные стороны, при `speed01` 0 — вместе; `airborne` поднимает стопы; `flash` меняет чернила.
- [ ] **Step 2: Тесты `eventMap`:** чужой `cast` → один позиционный звук в точке каста; чужой `dash start` → `dashBlast`; свои `cast`, `dash` — как раньше (прежние тесты не меняются).
- [ ] **Step 3: Реализовать `mageMeshes.ts`, правки `vfx.ts`, `combatHud.ts`, `eventMap.ts`, `/fx-test`.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные.
- [ ] **Step 4: Commit** `feat(client): other mages on screen: figure, element glow, HP bars with names, their cast sounds`.

---

### Task 6: Ядро хоста и предсказание игрока

**Модель:** Opus (самая тонкая часть сети).

**Files:**
- Create: `apps/client/src/net/snapshot.ts`, `apps/client/src/net/hostCore.ts`, `apps/client/src/net/predict.ts`
- Test: `apps/client/src/net/hostCore.test.ts`, `apps/client/src/net/predict.test.ts`, `apps/client/src/net/loopback.test.ts`

**Interfaces:**
- Consumes: задача 1 (`GameState`, `stepGame`, `addMage`, `removeMage`, `setElement`, `startCountdown`, `pvpContext`, `PVP`), задача 2 (`SeqInput`, `PackedInput`, `packInput`, `INPUTS_PER_PACKET`, `InputQueue`, `createInputQueue`, `pushInputs`, `takeInput`, `quantize`).
- Produces:

```ts
// snapshot.ts
/** Снапшоты — каждый третий тик хоста (20 Гц). */
export const SNAPSHOT_EVERY_TICKS = 3;
export interface SnapshotMsg {
  tick: number;                                        // game.match.tick
  game: GameState;
  acks: [UnitId, number][];                            // последний применённый seq игроков (хоста здесь нет)
  looks: [UnitId, number, number, number, number][];   // id, moveX, moveZ, yaw, pitch — ввод каждого мага на последнем тике
  roster: [UnitId, string, number][];                  // id, имя, пинг мс (−1 — неизвестен)
  events: [number, MatchEvent][];                      // тик (match.tick до шага), событие — всё с прошлого снапшота
}
/** Грубая проверка формы после decodeBinary: поля есть и нужных типов (game.match.units — массив). */
export function isSnapshot(x: unknown): x is SnapshotMsg;

// hostCore.ts
export const LOCAL_PEER = "local";
export interface HostCore {
  readonly game: GameState;
  readonly prevGame: GameState;
  join(peer: string, name: string, element: Element, nowMs: number): { ok: true; id: UnitId } | { ok: false; reason: "full" };
  leave(peer: string): void;
  inputs(peer: string, items: readonly SeqInput[], nowMs: number): void;
  setElement(peer: string, element: Element): void;
  setPing(peer: string, ms: number): void;
  /** Разминка или итоги → отсчёт; иначе false. */
  start(): boolean;
  /** Тик хоста: local — ввод игрока за этим браузером (LOCAL_PEER). Каждый SNAPSHOT_EVERY_TICKS-й тик — снапшот. */
  tick(local: MatchInput | null, nowMs: number): { step: GameStep; snapshot: SnapshotMsg | null };
  idOf(peer: string): UnitId | null;
  names(): ReadonlyMap<UnitId, string>;
  pings(): ReadonlyMap<UnitId, number>;
}
export function createHostCore(ctx: MatchContext): HostCore;

// predict.ts
export const MAX_REPLAY = 90;          // тиков переигровки, старше — выбрасываются
export const DEDUP_WINDOW = 8;         // тиков: событие хоста совпало с предсказанным
export const LATE_FX_MAX_AGE = 60;     // тиков: старше — в эффекты не идёт (только в килфид)
export const SMOOTH_TAU_S = 0.1;
export const SMOOTH_SELF_TAU_S = 0.06;
export const SNAP_DIST_M = 3;

export interface Predictor {
  readonly localId: UnitId;
  /** Пришёл снапшот, в котором есть свой маг. До этого step ничего не делает. */
  readonly ready: boolean;
  readonly cur: GameState;
  readonly prev: GameState;
  readonly confirmed: GameState | null;
  readonly roster: readonly [UnitId, string, number][];
  /** Новый тик: ввод → seq, шаг предсказания. События нового тика и пакет отправки (последние INPUTS_PER_PACKET вводов). */
  step(input: MatchInput): { events: MatchEvent[]; packet: PackedInput[] };
  /** Снапшот хоста: новее прежнего — перебазировать и переиграть; события — один раз на снапшот. */
  applySnapshot(s: SnapshotMsg): { late: MatchEvent[]; confirmed: MatchEvent[] };
  /** Сглаживающие сдвиги рендера: гаснут на dtS и возвращаются по id юнита. */
  offsets(dtS: number): ReadonlyMap<UnitId, Vec3>;
}
export function createPredictor(ctx: MatchContext, localId: UnitId): Predictor;
/** Ключ события для сверки с хостом: вид и участники без координат и id снарядов. Возрождение — с точкой до 0,1 м. */
export function eventKey(ev: MatchEvent): string;
/** Копия состояния, где body.pos юнитов сдвинут на offsets (рендер; исходник не меняется). */
export function withOffsets(s: MatchState, offsets: ReadonlyMap<UnitId, Vec3>): MatchState;
```

Поведение `hostCore`:
- `createHostCore(ctx)`: `createGame()`; игроки по `peer`.
- `join`: магов уже `PVP.maxPlayers` → `{ ok: false, reason: "full" }`. Имя занято (без учёта регистра) → « 2», « 3»… с обрезкой основы, чтобы влезть в `NAME_MAX`. `addMage` → id; у удалённого игрока — своя `InputQueue`.
- `leave`: `removeMage`, игрок забыт. Повторный `leave` — ничего.
- `inputs` → `pushInputs`. `setElement` → `rules.setElement`. `setPing` — хранится для `roster` (у хоста 0).
- `tick`: ввод на тик — у `LOCAL_PEER` переданный `local`, у прочих `takeInput(queue, nowMs)` (`null` — нет записи, маг стоит). `stepGame`. Запоминается применённый ввод каждого мага (для `looks`; нет ввода — 0, 0 и взгляд юнита). События копятся с тиком (`match.tick` до шага). Тик после шага кратен `SNAPSHOT_EVERY_TICKS` → снапшот со всем накопленным, копилка очищается. `prevGame` — состояние до шага.
- Снапшот не держит ссылок на живое состояние хоста (`clonePlain` или сериализация сразу).

Поведение `predict`:
- `step(input)` до `ready` — `{ events: [], packet: [] }`. После: `seq += 1`, ввод в список неподтверждённых, `stepGame(cur, { [localId]: input, …чужие по looks }, ctx)`, `prev = cur`, `cur = новое`. Чужие по looks: `{ moveX, moveZ, yaw, pitch, jump: false, кнопки false }`. События тика записываются в «показанные» с тиком `prev.match.tick` и ключом `eventKey`.
- `applySnapshot(s)`:
  1. Снапшот с этим `tick` уже был — `{ late: [], confirmed: [] }`.
  2. События снапшота: каждое → в `confirmed`. Если `последний тик снапшотов − tick события > LATE_FX_MAX_AGE` — в эффекты не идёт. Иначе ищется показанное событие с тем же ключом и тиком в пределах ±`DEDUP_WINDOW`: нашлось — убрать его из «показанных», не повторять; нет — в `late`.
  3. Снапшот старее последнего — только события, состояние не трогается.
  4. Новее: `confirmed = s.game`; неподтверждённые с `seq ≤ ack` своего id выбрасываются (нет `ack` — все остаются), оставшихся не больше `MAX_REPLAY` (старые долой). Своего мага в `s.game` нет — `ready = false`, `cur = prev = s.game`. Есть — `ready = true`, переигровка: `g = s.game`, на каждый неподтверждённый ввод `prevG = g; g = stepGame(g, …).game` (события переигровки выбрасываются). Пусто — `prev = cur = s.game`.
  5. Сглаживание: для юнитов, которые есть в старом и новом `cur`, сдвиг += старая позиция − новая; длина больше `SNAP_DIST_M` — сдвиг 0. Свой юнит — так же, но гаснет с `SMOOTH_SELF_TAU_S`.
  6. «Показанные» старше тика снапшота − 120 забываются.
- `offsets(dtS)`: каждый сдвиг × e^(−dtS/τ); короче 1 мм — удаляется.

**Тестовая «петля»** (`loopback.test.ts`) — хост и 1–2 предсказателя в одном процессе без PeerJS: сообщения идут через очереди с задержкой N тиков в каждую сторону, снапшоты проходят `quantize` (как в сети). Контекст: `pvpContext` на арене из `TEST_FLOOR` с 4 точками задачи 1 (или `testContext()` + точки).

- [ ] **Step 1: Тесты `hostCore`:** `join` до 6, седьмой — `full`; имена «Искра», «Искра 2»; ввод из очереди двигает мага; без ввода 250 мс маг стоит; снапшот каждый 3-й тик, события с тиками и без потерь между снапшотами, `acks` и `looks` верные; `leave` убирает мага; `start` из разминки — отсчёт, из боя — false; снапшот не меняется после следующих тиков.
- [ ] **Step 2: Реализовать `snapshot.ts`, `hostCore.ts`.**
- [ ] **Step 3: Тесты `predict` и петли:**
  - Задержка 0 и постоянный ввод: после каждого снапшота свой маг в `cur` совпадает с хостом того же тика до 1e−4 м, сдвиг сглаживания своего ≈ 0.
  - Задержка 6 тиков в каждую сторону, бег и прыжки по сценарию: в установившемся режиме поправка своего мага на снапшоте < 1 см.
  - Каст ЛКМ: событие `cast` своего мага приходит из `step` один раз; копия из снапшота хоста в `late` не попадает.
  - Каст чужого мага (второй предсказатель стреляет) у первого — в `late`, один раз.
  - Снапшоты не по порядку: старый после нового не откатывает состояние, его события обработаны один раз.
  - Свой маг возродился на другой точке, чем предсказано (подвинуть врага в снапшоте) → `late` содержит `respawn` с точкой хоста.
  - `offsets` гаснут к 0; сдвиг > 3 м не сглаживается.
  - До снапшота со своим магом `step` пуст; `MAX_REPLAY` ограничивает переигровку.
  - `eventKey`: одинаковый для двух `hit` с разными координатами; разный для разных целей; `respawn` в разных точках — разный.
- [ ] **Step 4: Реализовать `predict.ts`.** `pnpm test`, `pnpm typecheck` зелёные.
- [ ] **Step 5: Commit** `feat(client): host authority core and client prediction with replay, smoothing and event dedup`.

---

### Task 7: Страница PvP: вход, драйверы, связь

**Модель:** Opus (интеграция).

**Files:**
- Create: `apps/client/src/pvp/page.ts`, `pvp/lobby.ts`, `pvp/hostDriver.ts`, `pvp/clientDriver.ts`, `pvp/pvp.css`
- Modify: `apps/client/src/main.ts`, `apps/client/src/game/view.ts`, `apps/client/src/sandbox/hud.ts`, `apps/client/src/sandbox/page.ts`

**Interfaces:**
- Consumes: задачи 2–6.
- Produces (задача 8 опирается):

```ts
// pvp/hostDriver.ts, pvp/clientDriver.ts — оба реализуют
export type LinkState = "ok" | "stale" | "closed";
export interface PvpDriver extends Driver {
  readonly isHost: boolean;
  readonly roomCode: string;
  /** Состояние игры сейчас: у хоста — настоящее, у игрока — предсказанное. */
  game(): GameState;
  /** Последнее подтверждённое хостом (у хоста — то же, что game()). */
  confirmedGame(): GameState;
  names(): ReadonlyMap<UnitId, string>;
  pings(): ReadonlyMap<UnitId, number>;
  /** Свой пинг до хоста, мс; у хоста 0, неизвестен — −1. */
  ownPing(): number;
  link(): LinkState;
  /** Только хост: «Начать матч» / «Ещё раз». */
  start(): void;
}

// game/view.ts — GameViewOptions получает
names?: () => ReadonlyMap<UnitId, string>;   // уходит в combat.update({ …, names })

// sandbox/hud.ts — Hud получает
addMenuButton(label: string, onClick: () => void): { setVisible(v: boolean): void; setLabel(s: string): void };
```

Поведение:
- **Маршруты (`main.ts`):** `/play` → хост, `/r/КОД` → игрок (`parseRoomPath`; плохой код — экран «Нет такой комнаты» и ссылка на `/`). Прочее — как раньше. Телефон (`deviceKind(navigator.userAgent) === "телефон"`) на `/play` и `/r/…` — экран «Нужен компьютер с клавиатурой и мышью». Полигон: в меню (Esc) кнопка «Играть с друзьями» → `/play`.
- **Лобби (`lobby.ts`):** имя (поле, по умолчанию сохранённое `localStorage` «dm.name» или `defaultName()`, сохраняется при входе), две карточки стихий (по умолчанию `prefs.element`), кнопка «Войти». У хоста сверху «Комната ABCD», ссылка и «Скопировать ссылку» (`navigator.clipboard`, при отказе — выделить текст); ниже, пока он в лобби, — «В комнате: Искра 42, Валун 17». У игрока — статусы «Подключаюсь…», «Вхожу…» и ошибки:
  - нет хоста — «Комната ABCD не найдена: хост закрыл вкладку или код неверный»;
  - канал не открылся — «Не удалось соединиться с хостом напрямую. Возможно, нужен TURN-сервер — скажи разработчику»;
  - сигналинг недоступен — «Сервер подключения PeerJS не отвечает, попробуй ещё раз»;
  - `deny full` — «Комната полна (6 из 6)»;
  - `deny version` — «У вас разные версии игры — обновите страницу оба».
- **Хост (`hostDriver.ts`):** на заходе `/play` — `newRoomCode()`, `openHostLink` (ID занят — новый код, до 5 попыток), `createHostCore(pvpContext(arena))`, `startTicker`: на каждый пульс `advanceClock(acc, прошедшее, TICK_DT, 10)` тиков `core.tick(sample?.() ?? null, now)` — ввод хоста только после «Войти». Снапшот: `encodeBinary` один раз и отправка всем открытым каналам. Сообщения: `join` → `welcome` или `deny` (версия — `deny version`); `in`, `el`, `ping` (→ `pong` и `setPing`) — только от вошедших; закрытие канала → `leave`. «Войти» хоста → `core.join(LOCAL_PEER, …)` и вид. `advance` отдаёт тики, накопленные таймером с прошлого кадра (их события — `confirmed`), `prev`/`cur` — два последних состояния, `alpha` по времени с последнего тика. `chooseElement` → `core.setElement(LOCAL_PEER, e)`, возврат `null`. `pagehide` → закрыть связь.
- **Игрок (`clientDriver.ts`):** `openJoinLink`; на `open` — `joinText`; `welcome` → `createPredictor(ctx, id)`; снапшоты (`decodeBinary` → `isSnapshot`) копятся и применяются в начале `advance`; вид монтируется после первого `ready`. `advance`: тики по `advanceClock`, на тик `predictor.step(sample())` и `inputText(packet)`; затем `applySnapshot` для накопленного (`late`, `confirmed` в кадр); `prev`/`cur` — `withOffsets(…, predictor.offsets(dtS))`. Пинг раз в секунду `pingText(now, rtt)`, `rtt` — сглаженный по `pong`. Нет снапшота 3 с — `link() = "stale"`, канал закрыт — `"closed"`. `chooseElement` → `elementText(e)`, `null`.
- **Вид:** `mountGameView` с `selectOnStart: false`, `names: driver.names`. Клик по холсту — захват мыши, как на полигоне.
- **Меню хоста:** `addMenuButton("Начать матч", () => driver.start())` — видна в разминке и на итогах (подпись «Ещё раз» на итогах); всем — «Скопировать ссылку».

- [ ] **Step 1: Реализовать `hud.addMenuButton`, `names` во view, маршруты, лобби, оба драйвера, экраны ошибок.**
- [ ] **Step 2: Тесты чистых частей:** разбор маршрутов в `main.ts` вынести в функцию `routeOf(pathname)` и покрыть; уникальность и сохранение имени — в `lobby.ts` через чистые функции.
- [ ] **Step 3:** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные. Живую проверку в двух-трёх вкладках делает контролёр (задача 9); исполнитель описывает в отчёте, что и как проверять.
- [ ] **Step 4: Commit** `feat(client): PvP rooms: lobby, host and client drivers, connection errors`.

---

### Task 8: Интерфейс матча

**Модель:** Opus (то, что игрок видит каждую секунду).

**Files:**
- Create: `apps/client/src/pvp/matchHud.ts`, `apps/client/src/pvp/format.ts`, `apps/client/src/pvp/format.test.ts`
- Modify: `apps/client/src/pvp/page.ts` (подключить `matchHud` через `onFrame`), `apps/client/src/pvp/pvp.css`

**Interfaces:**
- Consumes: `PvpDriver` (задача 7), `standings`, `PVP`, `ABILITY_NAME`, `ELEMENT_INFO`, `statusFlags`.
- Produces: `createMatchHud(root, driver, view): { update(f: Frame, nowS: number): void; dispose(): void }`.

`format.ts` — чистые функции под тесты:

```ts
/** Тики → «м:сс», вверх до целой секунды; отрицательное → «0:00». */
export function formatClock(ticks: number): string;
/** Строка сверху по фазе. */
export function topLine(g: GameState, localId: UnitId, names: ReadonlyMap<UnitId, string>, isHost: boolean): string;
/** Строка килфида по подтверждённому событию death/fall; прочие → null. mine — я убийца или жертва. */
export function feedLine(ev: MatchEvent, names: ReadonlyMap<UnitId, string>, localId: UnitId): { text: string; mine: boolean } | null;
/** Текст экрана смерти по последнему death/fall со мной в роли цели. */
export function deathLine(ev: MatchEvent | null, g: GameState, names: ReadonlyMap<UnitId, string>): string;
/** Строки таблицы: место, имя, стихия, очки, убийства, сбросы, смерти, пинг; свои помечены. */
export function scoreRows(g: GameState, names: ReadonlyMap<UnitId, string>, pings: ReadonlyMap<UnitId, number>, localId: UnitId): ScoreRow[];
```

Тексты (без родовых окончаний — пол игрока неизвестен):
- Разминка: «Разминка · магов: N · хост начнёт матч» (у хоста: «Разминка · магов: N · Esc → «Начать матч»»).
- Отсчёт: крупно по центру «3», «2», «1».
- Бой: «6:42 · Ты 3 · Лидер: Искра 42 — 5 · до 12»; лидер — я: «Лидер — ты». Внезапная смерть: «Внезапная смерть 0:41 · …».
- Итоги — окно поверх: «Победа: Искра 42» или «Ничья: Искра 42, Валун 17», таблица, у хоста «R или Esc → «Ещё раз»», у остальных «Ждём, когда хост начнёт снова».
- Килфид (справа сверху, 5 строк, 6 с): `death` — «Искра 42 → Валун 17 · Огненный шар» (`burning` — «Горение»; убийцы нет в составе — «Валун 17 · Горение»); `fall` с засчитанным — «Искра 42 ⇣ Валун 17 · сброс»; без — «Валун 17 · в ущелье». Свои строки выделены.
- Экран смерти (свой маг мёртв): «Тебя победил Искра 42 · Огненный шар · у него 64 HP» / «Тебя сбросил Искра 42» / «Ты сорвался в ущелье» (одна форма для всех: «Сорвался в ущелье»), «Возрождение через 2», «1 — Огонь · 2 — Земля» с текущей выбранной. Цифры 1/2 (`Digit1`, `Digit2`) → `driver.chooseElement`, выбор подсвечивается сразу.
- Таблица по удержанию Tab (`preventDefault`), сверху «Комната ABCD · пинг 34 мс».
- «Защита» у прицела, пока свой маг защищён.
- Связь: `stale` — плашка «Нет связи с хостом…»; `closed` — окно «Хост вышел из игры» с кнопкой «На главную».
- Клавиша R у хоста на итогах → `driver.start()`.

- [ ] **Step 1: Тесты `format.ts`** для всех текстов выше: `formatClock(25200)` → «7:00», `(1)` → «0:01», `(0)` → «0:00»; лидер и «Лидер — ты»; внезапная смерть; ничья; килфид всех видов; экран смерти всех видов; таблица в порядке `standings`.
- [ ] **Step 2: Реализовать `format.ts`, `matchHud.ts`, подключение.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные.
- [ ] **Step 3: Commit** `feat(client): match HUD: timer and score, kill feed, death screen, scoreboard, results`.

---

### Task 9: Приёмка, дорожная карта, деплой (контролёр)

- [ ] Финальное ревью всей ветки (Opus) по пакету `review-package` и список мелочей из журнала; исправления — одним исполнителем.
- [ ] Живая проверка во встроенном браузере: dev-сервер `client`, вкладка A — `/play`, вкладки B и C — `/r/КОД`, у одной `?lag=120&loss=2`. Подмена захвата мыши, как в фазе 2. Проверить: вход, видимость друг друга, свой маг без рывков, попадания, убийство и сброс в счёт, килфид, экран смерти и смена стихии, возрождение с защитой, старт матча, отсчёт, конец, итоги, «Ещё раз», уход игрока, уход хоста. Полигон на `/` — как раньше.
- [ ] Дорожная карта: статус фазы 3-lite, что отложено.
- [ ] Пуш в `main` → автодеплой Vercel, проверка, что сайт отвечает.

## Приёмка фазы

- `pnpm test` (634 + новые), `pnpm typecheck`, `pnpm build:client` — зелёные.
- В двух-трёх вкладках, в том числе с `?lag=120&loss=2`: свой маг слушается мгновенно и без видимых откатов, чужие двигаются плавно, попадания и толчки читаются, счёт, килфид и итоги верные, «Ещё раз» запускает новый бой.
- Полигон на `/` ведёт себя как до фазы.

## После фазы 3-lite

Отложено (Н14): миграция хоста и возврат на место, руна ярости и сферы, корона лидера, компенсация пинга, выбор точки вне видимости, возрождение кликом, Вода и Воздух, ульты, реакции, TURN (если у кого-то не откроется канал).
