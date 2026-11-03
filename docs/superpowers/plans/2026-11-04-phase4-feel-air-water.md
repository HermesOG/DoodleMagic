# Фаза 4: толчок v2, Воздух и Вода. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Как идёт работа.**
> - Ветка интеграции `phase4` от `main`. Все worktree — от `phase4`, слияния — в `phase4`, в `main` — один раз в задаче 7. В новом worktree первым делом `pnpm install --frozen-lockfile`.
> - **Клиентская часть прохода ощущения** (`design/round3/01-game-feel-pass.md`: H1–H3, M1–M3, A1–A5, K3) — **отдельная задача ощущения, она уже идёт** и правит `apps/client/src/feel/*`, `audio/*`, `hands/*`, `fx/presets.ts`, `fx/particles.ts`, `game/view.ts`, `hud/combatHud.ts` и `.css`, `render/styleRenderer.ts`. Этот план её не делает. Сим-часть ощущения (K1, K2, A6) и починка толчка из дока Воздуха (кубик 8) — в задаче 1.
> - Волна 1 — задача 1 (sim), параллельно с задачей ощущения. Волна 2 — задачи 2, 3, 4 параллельно; задача 2 начинается, когда в `phase4` слиты задача 1 и задача ощущения. Волна 3 — задачи 5 и 6 параллельно. Задача 7 — контролёр.
> - После задачи 1 до слияния задачи 2 `pnpm --filter @doodlemagic/client typecheck` красный (стихий стало четыре) — так и задумано, в `main` это не попадает. `pnpm test` зелёный всегда.
> - Задача создаёт только свои файлы и правит только названные (таблица «Владение файлами»). Где код `phase4` отличается от плана в мелочах, прав код; интерфейсы плана не менять.
> - Контролёр проверяет расход лимита перед каждым агентом (правило владельца: стоп на 75 % недели).

**Goal:** Толчок «со сбросом» (K1 + K2 + честный полёт), профиль рывка, и две новые стихии — Воздух «Свобода» и Вода «Перехватчик» — на полигоне и в PvP, с реакциями «Пар» и «Огненный смерч». Выбор из четырёх стихий в меню, лобби и на экране смерти.

**Architecture:**
- Всё новое в бою — в чистой симуляции `packages/sim`: хост считает, игрок предсказывает тем же `stepGame` (Н1 фазы 3), поэтому состояние новых механик (парение, буксир, диск, заряды, мокрый) само едет в снапшоте и в переигровке.
- Стихия в sim — объект `ElementSim` (кит, хуки движения, шаги своих зон, попадания своих снарядов). `stepMatch` передаёт общий `SIM_HOOKS` в `moveUnits`, `stepProjectiles`, `stepZones`. Воздух и Вода живут в своих файлах `air.ts`, `water.ts`.
- Общие механики, которые трогают обе стихии и бой (толчок v2, удар о стену, мокрый и пар, лечение, якорь, буксир, впитывание снарядов, заряды слота, рывок с профилем), делает задача 1 — один раз.
- Клиент: у каждой стихии свои файлы (id звуков и всплесков, события → эффекты, рецепты звука, частицы, меши, жесты, виджет HUD). Общие таблицы импортируют их одной строкой; эти строки ставит задача 2.

**Tech Stack:** Node 24, pnpm 12.14, TypeScript 7.0.2 (strict, `noUncheckedIndexedAccess`), Vitest 5.0.5, Vite 8.3.4, three.js 0.186.1, PeerJS 1.5.5, Web Audio. Новых зависимостей нет.

## Global Constraints

- Новых пакетов нет: `package.json` и `pnpm-lock.yaml` не меняются. three.js — точно `0.186.1`, `@types/three` — `0.186.0`, `peerjs` — `1.5.5`.
- Чистота `sim`: `packages/sim` не импортирует three.js и DOM. В нём нет `Math.random`, `Date`, `performance` и изменяемого состояния на уровне модулей (кроме буфера `scratch` в `body.ts`). Реестры — замороженные константы.
- Детерминизм: `stepMatch` и `stepGame` не меняют свои аргументы. Одинаковые состояние, ввод и контекст дают одинаковые до байта `JSON.stringify` состояния и события. Состояние — простые данные: «нет» — `NOBODY` (−1) или `null`, времена — номера тиков.
- Полигон и PvP ведут себя как раньше, кроме одобренного: толчок v2, профиль рывка Огня, новые стихии. На старте фазы **940** тестов; прежние тесты правятся только там, где задача их называет.
- **Чистая комната:** не открывать, не читать и не искать ничего в `D:\Claude Code\MagicGG\research\`. Не переносить код и числа других игр. Числа — из `design/round3/*.md`, GDD, этого плана и кода.
- Хосту нельзя доверять вводу: сообщения игрока проходят `parseClientMsg`, ввод — `sanitizeInput`. Новые механики берут из ввода только то, что уже есть: движение, взгляд, прыжок, кнопки.
- Бюджет: 60 FPS на встроенной графике (Iris Xe, Vega 8), в бою ≤ 40 draw call (отладка, клавиша `Backquote`: «вызовов N»). Частицы — только через пулы `InstancedMesh`, всплеск ≤ 150 (`MAX_BURST`), свет — по пресету 2/4/8. Новые меши — `InstancedMesh`, не больше +2 вызовов на стихию.
- Звук: рецепт ≤ 0,8 с, голосов ≤ 24, подпись стихии в своей полосе (GDD 5): Огонь 2–8 кГц, Земля 30–200 Гц, Вода 300–1500 Гц, Воздух 800–4000 Гц. Непрерывные звуки — зёрнами (Р15).
- Интерфейс на русском. Клавиши только по `event.code`. Комментарии в коде — на русском, в стиле соседнего кода.
- Проверки перед коммитом: `pnpm test` (из корня), `pnpm typecheck`, для клиента ещё `pnpm build:client`.
- Коммиты в стиле `feat(sim): …`, `feat(client): …`. Сообщение заканчивается строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Автор git уже настроен (noreply), не менять.

## Решения этого плана

| № | Решение | Почему |
|---|---|---|
| Р1 | **Толчок v2 — одна правка модели (задача 1).** K1: при толчке ≥ 1 м (после множителей) у жертвы гасится своя скорость к источнику (`v −= min(0, v·dir)·dir`) и на 0,2 с её разгон ×0,3 (торможение без ввода прежнее); не контроль, иммунитета нет. K2: шар 4 / 1,5 м, столб вбок 2 м, землетрясение 1 м; в иммунитете вбок ×1, вверх ×0,5. Честный полёт: v₀ канала считается по фактическому времени полёта цели до опоры (скорость вверх после толчка, высота над опорой, нет опоры — ∞). Парящий маг гасит канал как на полу. Удар о стену живёт в канале | Владелец: «толчок со сбросом» (K1 + K2) вместе с кубиком 8 Воздуха — одной правкой. Обобщённый кубик 8: плоский толчок по прыгнувшему больше не уносит в 2–4 раза дальше карточки — у всех стихий |
| Р2 | Следствие K2: Смерч → Порыв толкает в полную силу (в доке Воздуха — вполсилы по старой модели иммунитета) | Владелец утвердил K2. Если сбросов много: первым откатывается K2 (док ощущения), у Воздуха — парение 3 → 2 с |
| Р3 | Рывок — общий модуль `dash.ts`. Профиль A6: скорость линейно 64 → 16 м/с (средняя 40, 8 м за 0,2 с). На выходе Огонь 9 м/с, Взмах Воздуха 7 м/с (бег Воздуха, по карточке) | Один код на два рывка; предсказание как у Реактивного рывка |
| Р4 | Вода — концепция A «Перехватчик» ровно по `03-water.md`: «Круговорот» (Мокрый 3 с; урон Воды по уже Мокрой цели лечит Воду на 20 % урона, и выше ⅔), Родник лечит только Воду, ресурса нет, Отражение — впитать и ответить своим снарядом (без смены хозяина) | Решение владельца |
| Р5 | Хват: точка — 1,5 м перед Водой по линии на цель в момент попадания, не дальше 7 м (Земля и иммунитет — каждый ×0,5). **Укороченный** буксир (упёрся в предел) встаёт на последней точке с опорой: шаг 0,25 м назад к цели, опора не глубже 3 м; опоры нет нигде — буксира нет. Над пустотой кончается только полный буксир (до 1,5 м перед Водой) — то есть только когда Вода сама в 1,5 м от кромки | Владелец: «Хват роняет, только если Вода стоит у края». Без проверки предел 7 м ронял бы цель с дальнего края площадки руны |
| Р6 | Притягивание (буксир, тяга Смерча): Земля ×0,5, иммунитет ×0,5 (перемножаются), «якорь» Отражения — 0 (`pullMul`) | GDD 4.4 «Корни», `03-water` (иммунитет вдвое) — одним правилом |
| Р7 | Пока стоит диск Отражения, Воду не сдвинуть ничем: толчок, подброс, буксир, тяга Смерча и Порыв не действуют; урон, замедление, обездвиживание проходят (`anchoredUntil`) | Решение владельца |
| Р8 | Отражение ловит снаряды, летящие в Воду из передней полусферы (горизонтальная скорость снаряда против взгляда Воды, ±90°), по телу Воды, раздутому на 0,5 м по XZ. Впитанное — урон снаряда (`power`), без урона и взрыва. ЛКМ досрочно гасит диск, нажатие поглощается. E во время своего замаха — `busy` (ждёт в буфере 0,3 с). Ответ: `power = clamp(впитанное, 20, 60)`, ничего не впитал — Ответа нет; засчитывается способности «Отражение» (`waterWard`) | `03-water` §2.2; своего бокса у диска нет, рисунок 2 × 2 м |
| Р9 | Пар — в обе стороны. Удар Воды по горящему гасит Горение и даёт пар. Огонь по Мокрому (шар, стена, след рывка, огненный смерч — всё с `burn` или стихии Огня) сушит, Горение не ложится, даёт пар; кулаки сушат без пара. Облако 2,5 м на 3 с, не чаще раза в 3 с на цель, своё ограничение 4 на арену вне лимита зон; хозяин — тот, чей удар второй; закрывает обзор (`noSight`), снаряды и лучи пропускает | GDD 4.6, `03-water` §3 |
| Р10 | «Огненный смерч»: взведённый Смерч загорается, если в этот тик взорвался огненный шар не дальше 3 м от края диска (по событию `explosion` тика), или Стена огня / след рывка пересекает диск. Хозяин — второй: у взрыва — хозяин шара; у стены и следа — их хозяин, если они родились позже вихря. Стена и след поглощаются. Импульс 8 урона раз в 0,5 с (16/с) + Горение | `02-air` §3 |
| Р11 | Ядро Смерча подбрасывает на 3 м без урона (`launchUnit`): «В воздухе» 0,3 с, только вне иммунитета, сброс засчитывается хозяину вихря. Хозяина на полу ядро поднимает на 2 м, раз в 1 с | `02-air` |
| Р12 | Порыв: цель — живой не-хозяин, центр тела по XZ не дальше 7 + 0,4 м, угол от взгляда ≤ 30°, `|Δy подошв| ≤ 2,5 м`, свободный луч `shot` от глаз до центра тела (камень закрывает, Стена огня — нет). Сдувает чужие снаряды в том же конусе (шар — без взрыва). Удар о стену — +20, один раз, пока скорость канала ≥ 6 м/с | `02-air` (вариант A владельца: 7 м, замах 0,4 с) |
| Р13 | Взмах — только по горизонтали, 2 заряда по 6 с по очереди; `ready.e` — тик ближайшего заряда. Парение — 3 с запаса до приземления | Решения владельца |
| Р14 | Родник лечит импульсами 3 HP раз в 0,25 с (12 HP/с); замедление и Мокрый — каждый тик, событие статуса — только при наложении заново | Иначе 60 событий в секунду в снапшоте |
| Р15 | Непрерывные звуки (парение, гул Смерча, журчание Родника) — зёрна ≤ 0,8 с из покадрового хука стихии | В синтезаторе нет остановки голоса; правило «рецепт ≤ 0,8 с» |
| Р16 | Сеть: `NET_VERSION` 2; в `looks` снапшота шестой столбец — прыжок зажат (0/1); предсказание ведёт чужих магов с ним | Иначе чужое парение в переигровке обрывалось бы на каждом снапшоте |
| Р17 | Порядок стихий: Огонь, Земля, Воздух, Вода — клавиши 1–4 (прежние 1 и 2 не меняются) | GDD 4.1 |
| Р18 | Воздух: 130 HP, 7,0 м/с, «Свобода», «Летай и сдувай врагов с карты», ★★, ульта «Ураган». Вода: 150 HP, 6,5 м/с, «Текучесть», «Тяни к себе, возвращай удары», ★★★, «Цунами». Ульты (X) — «скоро» у всех | Карточки round3, решение владельца |
| Р19 | Реакции в фазе: «Пар», «Огненный смерч». В бэклоге: Выкипание, Топь, Огненный вал, Песчаный смерч / Пыльная буря | Решение владельца |
| Р20 | Звук стихий — под наушники (решение владельца): низ не урезаем, «вес» — реверб, если задача ощущения его сделала; щелчки выпуска и попадания слышны | Игроки в наушниках |
| Р21 | Хлыст бьёт и рельеф (20), как ЛКМ других стихий | Стена Земли «режет» хлыст — и ломается от него |
| Р22 | Рывок цели (Огонь, Взмах) обрывает буксир | `03-water`, кубик «Буксир» |
| Р23 | Вне фазы: новые арены, руна и сферы, миграция хоста, TURN, ульты, двухфазный хитмаркер медленных снарядов (как у шара — по Н5 фазы 3), зубчатая кайма у частиц врага | Решение владельца и порядок выреза |

## Предсказание: что новое и как

Игрок переигрывает весь мир от снапшота (Н1 фазы 3). Всё, что лежит в состоянии матча, предсказывается само.
- **Второй прыжок и парение** — своё движение: тот же `stepPlayer` и хук Воздуха, предсказание точное. Чужих магов переигровка ведёт с прыжком из `looks` (Р16), иначе их парение обрывалось бы.
- **Взмах** — как Реактивный рывок, своё движение.
- **Порыв** — замах, жест и звук сразу у кастующего. Толчок у жертвы приходит со снапшотом: v₀ ≈ 15 м/с (7 м с подбросом 1 м), за 60–110 мс задержки цель уходит на ≤ 1,6 м — меньше `SNAP_DIST_M` = 3 м, поправка сглаживается (τ 0,06 с у своего).
- **Тяга Смерча** — зона неподвижна и есть в снапшоте; тянет `stepZones` в переигровке, в том числе своего мага. Рост 0,5 с прячет задержку: к взводу зона уже у всех.
- **Буксир** — начинает хост; жертва узнаёт со снапшотом. 20 м/с × ≤ 110 мс ≤ 2,2 м < 3 м — сглаживается. Состояние `tow` в юните, дальше переигровка тащит сама.
- **Отражение** — диск у защитника ставится сразу, у хоста — на RTT/2 позже: снаряд в этой щели попадёт (≈ 6 % окна 1 с). Стрелок видит диск со снапшотом и сам предсказывает впитывание.
- **Мокрый, лечение, пар, огненный смерч, удар о стену** — детерминированные следствия ударов: идут в переигровке; события сверяются по `eventKey` (задача 2 добавляет ключи новым событиям).

## Владение файлами

| Задача | Волна | Создаёт | Правит |
|---|---|---|---|
| 1. Контракты sim и толчок v2 | 1 | `packages/sim/src/match/hooks.ts`, `elements.ts`, `dash.ts`, `steam.ts`, `air.ts` (заглушка), `water.ts` (заглушка), `phase4.test.ts` | `match/types.ts`, `defs.ts`, `state.ts`, `combat.ts`, `units.ts`, `kit.ts`, `fire.ts`, `projectiles.ts`, `zones.ts`, `dynamic.ts`, `match.ts`, `index.ts`; тесты (только названные строки): `contracts.test.ts`, `fire.test.ts`, `projectiles.test.ts`, `rules.test.ts` |
| 2. Клиент: реестры стихий, сеть v2, меню на четыре | 2 | заглушки стихий (список в задаче 2), `feel/elementFx.ts`, `fx/elementVfx.ts`, `hud/kitWidgets.ts`, `hud/elementSelect.css`, `hud/prefs.test.ts` | одна строка регистрации в каждой общей таблице (список в задаче 2); `net/protocol.ts`, `snapshot.ts`, `hostCore.ts`, `predict.ts`; `hud/elementSelect.ts`, `hud/prefs.ts`, `pvp/lobby.ts`, `pvp/pvp.css`; названные строки тестов `net/*.test.ts`, `feel/*.test.ts`, `audio/audio.test.ts` |
| 3. Воздух: sim | 2 | `packages/sim/src/match/air.test.ts` | `match/air.ts` (только он) |
| 4. Вода: sim | 2 | `packages/sim/src/match/water.test.ts` | `match/water.ts` (только он) |
| 5. Воздух: клиент | 3 | `feel/airFx.test.ts`, `fx/airVfx.test.ts` | только файлы Воздуха: `feel/airIds.ts`, `feel/airFx.ts`, `audio/airRecipes.ts`, `fx/presets.air.ts`, `fx/airVfx.ts`, `hands/airGestures.ts`, `hud/airHud.ts` |
| 6. Вода: клиент | 3 | `feel/waterFx.test.ts`, `fx/waterVfx.test.ts` | только файлы Воды: `feel/waterIds.ts`, `feel/waterFx.ts`, `audio/waterRecipes.ts`, `fx/presets.water.ts`, `fx/waterVfx.ts`, `hands/waterGestures.ts`, `hud/waterHud.ts` |

---

### Task 1: Контракты sim и толчок v2

**Модель:** Opus (модель толчка — ощущение боя; контракты для четырёх задач).

**НЕ открывать `research/`.**

**Files:**
- Create: `packages/sim/src/match/hooks.ts`, `elements.ts`, `dash.ts`, `steam.ts`, `air.ts`, `water.ts`, `phase4.test.ts`
- Modify: `packages/sim/src/match/types.ts`, `defs.ts`, `state.ts`, `combat.ts`, `units.ts`, `kit.ts`, `fire.ts`, `projectiles.ts`, `zones.ts`, `dynamic.ts`, `match.ts`, `index.ts`
- Modify (только названные строки тестов): `contracts.test.ts` (строка «juice» столба и литерал `statusFlags`), `fire.test.ts` (рывок: `x > 8.6 && x < 9.0` вместо `> 7.9 && < 8.6` — выход 9 м/с), `projectiles.test.ts` (`3 * 0.44` → `FIRE.fireball.knockback.distM * 0.44`), `rules.test.ts:111` (литерал снаряда + `power: 50`)

**Interfaces:**
- Consumes: всё из `main`.
- Produces (задачи 2–6 опираются; экспорт из `@doodlemagic/sim`): блоки кода ниже.

**`types.ts` — новое и изменённое:**

```ts
export type Element = "fire" | "earth" | "air" | "water";
export const ELEMENTS: readonly Element[] = ["fire", "earth", "air", "water"];
export const ABILITY_IDS = [
  "fireFists", "fireball", "jetDash", "fireWall",
  "stoneShot", "stonePillar", "stoneWall", "earthquake",
  "airSickle", "gust", "swoop", "tornado",
  "waterWhip", "waterGrab", "waterWard", "spring",
] as const;
// AbilityId, DamageSource = AbilityId | "burning" — как были

/** Виды снарядов. Ответ Отражения — свой вид, засчитывается способности waterWard (PROJECTILE_SOURCE). */
export const PROJECTILE_KINDS = ["fireFists", "fireball", "stoneShot", "airSickle", "waterGrab", "waterAnswer"] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];
/** power — урон попадания: по таблице вида, у Ответа — впитанное. */
export interface Projectile { id: number; owner: UnitId; ability: ProjectileKind; pos: Vec3; vel: Vec3; bornTick: number; endTick: number; power: number }

export type ZoneKind = "fireWall" | "fireTrail" | "pillar" | "quake" | "tornado" | "fireTornado" | "spring" | "steam";
export type StatusKind = "burning" | "slow" | "root" | "airborne" | "wet";

// В Statuses добавляются (freshStatuses: все 0):
  /** «Мокрый» (GDD 4.1): гасит и не пускает Горение, пока now < wetUntil. */
  wetUntil: number;
  /** Пар с этой цели — не раньше этого тика (раз в 3 с). */
  steamReadyAt: number;
  /** K1: своё ускорение ×0,3, пока now < staggerUntil. Не контроль. */
  staggerUntil: number;
  /** «Якорь» диска Отражения: толчок, подброс, буксир и тяга не действуют, пока now < anchoredUntil. */
  anchoredUntil: number;

/** Буксир Хвата: тащит по XZ к (x, z) со скоростью speed, м/с, до endTick; без гравитации. */
export interface Tow { x: number; z: number; speed: number; endTick: number; by: UnitId }
/** Удар о стену, который ждёт в канале толчка (Порыв): кто, чем, сколько урона. */
export interface Slam { by: UnitId; ability: AbilityId; damage: number }
/** Рывок (Реактивный рывок, Взмах): направление, начало и конец, зона следа (NOBODY — без следа). */
export interface DashState { ability: AbilityId; dirX: number; dirZ: number; startTick: number; endTick: number; trailZone: number }
/** «Лёгкость» Воздуха: второй прыжок потрачен, тиков парения с прыжка, парит ли на этом тике. */
export interface FlightState { doubleJumped: boolean; glideTicks: number; gliding: boolean }
/** Диск Отражения: до какого тика стоит и сколько урона впитал. */
export interface WardState { endTick: number; absorbed: number }

// MageState: dash: DashState | null; и новые поля (createMageUnit):
  /** Заряды слота (Взмах): сколько есть и тик следующего (NEVER — все на месте). У прочих слотов 0 и NEVER. */
  charges: Record<Slot, number>;
  chargeAt: Record<Slot, number>;
  flight: FlightState;          // { false, 0, false }
  ward: WardState | null;       // null
// Unit: tow: Tow | null; slam: Slam | null;   (null)

// MatchEvent: dash получает ability: AbilityId; новые виды:
  | { type: "beam"; unit: UnitId; ability: AbilityId; from: Vec3; to: Vec3; target: UnitId }
  | { type: "blown"; unit: UnitId; projectile: number; kind: ProjectileKind; owner: UnitId; pos: Vec3 }
  | { type: "slam"; target: UnitId; source: UnitId; pos: Vec3 }
  | { type: "airJump"; unit: UnitId; pos: Vec3 }
  | { type: "glide"; unit: UnitId; on: boolean; pos: Vec3 }
  | { type: "charge"; unit: UnitId; slot: Slot; charges: number }
  | { type: "absorb"; unit: UnitId; projectile: number; kind: ProjectileKind; owner: UnitId; amount: number; total: number; pos: Vec3 }
  | { type: "ward"; unit: UnitId; phase: "up" | "down"; absorbed: number }
  | { type: "tow"; target: UnitId; source: UnitId; phase: "start" | "end"; pos: Vec3; to: Vec3 }
  | { type: "heal"; target: UnitId; source: UnitId; amount: number; pos: Vec3 }
  | { type: "reaction"; kind: "steam" | "fireTornado"; owner: UnitId; zone: number; pos: Vec3 }
```

Событие `release` способности без снаряда (Порыв) — `projectile: −1`. У Ответа `release.ability = "waterWard"`, `impact.ability = PROJECTILE_SOURCE[kind]`.

**`defs.ts` — изменения и новые таблицы:**

```ts
// FIRE: fireball.knockback { distM: 4, upM: 1.5 } (K2);
//       jetDash: { slot: "e", name: "Реактивный рывок", cooldownS: 8, distM: 8, durationS: 0.2, profile: 0.6, exitSpeed: 9, trailS: 2, trailDps: 6, trailHalfWidthM: 0.75 } (A6)
// EARTH: stonePillar.knockback { distM: 2, upM: 3.5 }; earthquake.knockback { distM: 1, upM: 0 } (K2)

/** Воздух «Свобода» (round3/02-air.md; Р12, Р13). */
export const AIR = {
  hp: 130, runSpeed: 7,
  airSickle: { slot: "primary", name: "Воздушный серп", damage: 16, ratePerS: 3, projectile: { speed: 60, radiusM: 0.3, gravity: 0, rangeM: 40 }, knockback: { distM: 0.3, upM: 0 }, tempoRefS: 0.5 },
  gust: { slot: "q", name: "Порыв", cooldownS: 8, windupS: 0.4, rangeM: 7, halfAngleDeg: 30, halfHeightM: 2.5, damage: 10, knockback: { distM: 7, upM: 1 }, slamDamage: 20 },
  swoop: { slot: "e", name: "Взмах", distM: 8, durationS: 0.2, profile: 0.6, exitSpeed: 7, charges: 2, chargeS: 6 },
  tornado: {
    slot: "c", name: "Смерч", cooldownS: 18, rangeM: 20, growS: 0.5, lifeS: 4, radiusM: 5, belowM: 0.5, aboveM: 4, pullSpeed: 2.5,
    pulseS: 0.5, pulseDamage: 4, firePulseDamage: 8, coreRadiusM: 1.5, coreLiftM: 3, ownerLiftM: 2, ownerLiftEveryS: 1, fireReachM: 3,
  },
  passive: { name: "Лёгкость", doubleJumpM: 1.25, glideFallSpeed: 2.5, glideAirControl: 1, glideS: 3 },
} as const;

/** Вода «Перехватчик» (round3/03-water.md, концепция A; Р4, Р5, Р8). */
export const WATER = {
  hp: 150, runSpeed: 6.5,
  waterWhip: { slot: "primary", name: "Водяной хлыст", damage: 20, ratePerS: 2.5, windupS: 0.12, rangeM: 15, radiusM: 0.25, knockback: { distM: 0.3, upM: 0 }, tempoRefS: 0.5 },
  waterGrab: { slot: "q", name: "Хват", cooldownS: 8, windupS: 0.25, damage: 25, projectile: { speed: 28, radiusM: 0.4, gravity: 0, rangeM: 15 }, towSpeed: 20, towMaxM: 7, towStopM: 1.5, safeStepM: 0.25, safeDropM: 3 },
  waterWard: { slot: "e", name: "Отражение", cooldownS: 9, durationS: 1, runMul: 0.7, padM: 0.5, answer: { name: "Ответ", minDamage: 20, maxDamage: 60, projectile: { speed: 45, radiusM: 0.35, gravity: 0, rangeM: 30 } } },
  spring: { slot: "c", name: "Родник", cooldownS: 14, rangeM: 15, telegraphS: 0.4, radiusM: 4, heightM: 1.5, lifeS: 6, healPerS: 12, healPulseS: 0.25, slowMul: 0.7, slowAfterS: 0.5 },
  passive: { name: "Круговорот", wetS: 3, drainFrac: 0.2 },
} as const;

// STATUS: wet { durationS: 3 }; immuneKnockbackMul заменяется на immuneKnockSideMul: 1, immuneKnockUpMul: 0.5 (K2); immunePullMul: 0.5 (Р6)
// KNOCKBACK: + staggerMinM: 1, staggerS: 0.2, staggerAccelMul: 0.3, slamMinSpeed: 6, flightProbeM: 30
export const STEAM = { radiusM: 2.5, heightM: 3, lifeS: 3, perArena: 4, everyS: 3 } as const;

// ABILITY_OF: air { primary: "airSickle", q: "gust", e: "swoop", c: "tornado" }, water { primary: "waterWhip", q: "waterGrab", e: "waterWard", c: "spring" }
// ABILITY_NAME — из карточек; ELEMENT_INFO — Р18
/** Стихия способности (по ABILITY_OF). */
export const ELEMENT_OF: Readonly<Record<AbilityId, Element>>;
export const PROJECTILE_SOURCE: Readonly<Record<ProjectileKind, AbilityId>>; // вид → способность; waterAnswer → "waterWard"
/** Заряды слотов на старте мага: у всех 0, у Воздуха e — AIR.swoop.charges. */
export const SLOT_CHARGES: Readonly<Record<Element, Readonly<Record<Slot, number>>>>;
// slotCooldownTicks(element, slot): primary — ticks(1 / ratePerS); e Воздуха — ticks(chargeS); иначе ticks(cooldownS)
//   air: 20, 480, 360, 1080; water: 24, 480, 540, 840
```

**`hooks.ts` (целиком):**

```ts
import type { MoveParams, PlayerInput } from "../types";
import type { Kit } from "./kit";
import type { SweepHit } from "./projectiles";
import type { Element, MatchState, Projectile, ProjectileKind, TickCtx, Unit, Zone, ZoneKind } from "./types";

/** Движение мага стихии. Порядок в moveUnits: before → params → stepPlayer → after → канал толчка. */
export interface MoveHooks {
  /** До stepPlayer; inp уже без шагов и прыжка под обездвиживанием и «В воздухе». Может менять u.move (второй прыжок). */
  before?(u: Unit, t: TickCtx, inp: PlayerInput): void;
  /** Параметры движения на тик: на входе — бег стихии с замедлением и K1. */
  params?(u: Unit, t: TickCtx, inp: PlayerInput, p: MoveParams): MoveParams;
  /** После stepPlayer: сброс на полу, флаги, события. */
  after?(u: Unit, t: TickCtx, inp: PlayerInput): void;
}
/** Шаг своей зоны после взвода (общий шаг уже снял ушедшие и послал zone/arm). */
export type ZoneStep = (s: MatchState, t: TickCtx, z: Zone) => void;
/** Попадание своего снаряда в юнит, рельеф или мир; событие impact уже записано. */
export type ProjectileHit = (s: MatchState, t: TickCtx, p: Projectile, hit: SweepHit) => void;
export interface ElementSim {
  readonly kit: Kit;
  readonly move?: MoveHooks;
  readonly zones?: Readonly<Partial<Record<ZoneKind, ZoneStep>>>;
  readonly projectileHit?: Readonly<Partial<Record<ProjectileKind, ProjectileHit>>>;
}
export interface SimHooks {
  readonly move: Readonly<Partial<Record<Element, MoveHooks>>>;
  readonly zones: Readonly<Partial<Record<ZoneKind, ZoneStep>>>;
  readonly projectileHit: Readonly<Partial<Record<ProjectileKind, ProjectileHit>>>;
}
export const NO_HOOKS: SimHooks = Object.freeze({ move: {}, zones: {}, projectileHit: {} });
/** Сводит хуки стихий; вид зоны или снаряда у двух стихий — ошибка. */
export function mergeHooks(sims: Readonly<Record<Element, ElementSim>>): SimHooks;
```

**`elements.ts`, `air.ts`, `water.ts`:**

```ts
// elements.ts — его импортирует только match.ts (циклов нет: air.ts и water.ts не импортируют match.ts)
export const ELEMENT_SIM: Readonly<Record<Element, ElementSim>> = Object.freeze({ fire: { kit: FIRE_KIT }, earth: { kit: EARTH_KIT }, air: AIR_SIM, water: WATER_SIM });
export const SIM_HOOKS: SimHooks = mergeHooks(ELEMENT_SIM);
// air.ts (заглушка; наполняет задача 3)
/** Воздух «Свобода» (round3/02-air.md). */
export const AIR_SIM: ElementSim = Object.freeze({ kit: NO_KIT });
// water.ts (заглушка; наполняет задача 4) — WATER_SIM так же
```

**`dash.ts` (A6, Р3):**

```ts
export interface DashSpec {
  ability: AbilityId; distM: number; durationS: number;
  /** Профиль: скорость линейно от (1 + profile)·v̄ до (1 − profile)·v̄, v̄ = distM / durationS. */
  profile: number;
  exitSpeed: number;
  trail: { halfWidthM: number; lifeS: number } | null;
}
/** Скорость рывка на k-м тике из n (середина тика): v̄·(1 + profile·(1 − (2k + 1)/n)); сумма шагов — ровно distM. */
export function dashSpeedAt(spec: DashSpec, k: number, n: number): number;
/** Начать рывок по вводу движения (без ввода — вперёд): гасит канал толчка и удар о стену, обрывает буксир (endTow), след — если есть. Событий не пишет. */
export function startDash(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, spec: DashSpec): void;
/** Событие dash/start (кит пишет его после cast — порядок событий Огня прежний: zone/telegraph → cast → dash/start). */
export function dashStarted(t: TickCtx, u: Unit): void;
/** Тик рывка: горизонтально, без гравитации, взгляд из ввода; упор (продвинулся < 0,45 шага) или последний тик — endDash. */
export function stepDash(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, spec: DashSpec): void;
/** Конец: скорость exitSpeed по направлению, след догорает до trailEnd, событие dash/end. */
export function endDash(s: MatchState, t: TickCtx, u: Unit, spec: DashSpec, trailEnd: number): void;
```

`fire.ts` переходит на модуль: `FIRE_DASH = { ability: "jetDash", distM 8, durationS 0.2, profile 0.6, exitSpeed 9, trail { 0.75, 2 } }`; «Кураж» посреди рывка зовёт `endDash`. Тики: первый ≈ 62 м/с, последний ≈ 18 м/с.

**`combat.ts` — толчок v2, статусы, лечение:**

```ts
/** Время полёта до опоры, с: скорость вверх vy, высота над опорой h (нет опоры — Infinity). */
export function flightTime(vy: number, h: number, gravity = G): number; // (vy + √(vy² + 2·g·h)) / g; h ≤ 0 и vy ≤ 0 — 0
/** v₀ канала: цель первые flightS секунд летит (λ 1,5), потом скользит (λ 6) и проходит ровно distM. */
export function knockbackSpeedFor(distM: number, flightS: number): number; // distM / ((1 − e)/λa + e/λg), e = e^(−λa·flightS)
/** Прежняя функция — частный случай: полёт 2·√(2·upM/g) с пола. */
export function knockbackSpeed(distM: number, upM: number, gravity = G): number;
export const isAnchored = (u: Unit, now: number): boolean => now < u.status.anchoredUntil;
/** Множитель притягивания (Р6): якорь — 0; Земля ×0,5; иммунитет ×0,5. */
export function pullMul(u: Unit, now: number): number;

export interface HitSpec {
  source: UnitId; target: UnitId; ability: DamageSource; damage: number; pos: Vec3; dir: { x: number; z: number };
  knock?: Knockback; launch?: boolean; burn?: boolean; slow?: { mul: number; s: number }; rootS?: number; dot?: boolean;
  /** Удар о стену (Порыв): урон, если канал этого толчка упрётся в стену при скорости ≥ KNOCKBACK.slamMinSpeed. */
  slam?: number;
  /** Буксир (Хват): точка по XZ, скорость и сколько тиков; якорь отменяет. */
  tow?: { x: number; z: number; speed: number; ticks: number };
}
export function applyHit(s: MatchState, t: TickCtx, h: HitSpec): number;
export interface StatusSpec { source: UnitId; wetS?: number; slow?: { mul: number; s: number } }
/** Статусы без урона и без события hit (Родник): защита после появления не пускает; событие status — только при наложении заново. */
export function applyStatus(s: MatchState, t: TickCtx, target: UnitId, spec: StatusSpec): void;
/** Лечение до максимума (мимо засечки ⅔); событие heal с фактическим количеством; возвращает его. */
export function healUnit(s: MatchState, t: TickCtx, target: UnitId, amount: number, source: UnitId): number;
/** Подброс без урона (ядро Смерча): Земля ×0,5; в иммунитете, под якорем и защитой — нет (false). Ставит «В воздухе», иммунитет, lastHitBy/lastHitTick = source. */
export function launchUnit(s: MatchState, t: TickCtx, target: UnitId, upM: number, source: UnitId): boolean;
/** Конец буксира: скорость 0, событие tow/end. */
export function endTow(t: TickCtx, u: Unit): void;
```

Толчок v2 (внутренняя `push(u, t, dir, k)`), порядок: подброс (`vel.y = max(vel.y, √(2·g·upM))`, манекену XZ = 0, `onGround = false`) → K1 (если `k.distM ≥ 1`: `along = vel·dir`; `along < 0` → `vel −= along·dir`; `staggerUntil = max(·, now + 12)`) → полёт: парящий (`mage.flight.gliding`) или на полу — 0; иначе `flightTime(vel.y, pos.y − groundBelow(t.world, pos + 0,05 вверх, 30))`, опоры нет — ∞ → `v₀ = knockbackSpeedFor(distM, полёт)` вдоль `dir`, потолок 12 м как раньше.

`applyHit`, порядок (прежние шаги сохраняются):
1. Источник = цель, цели нет, мертва, под защитой — 0, как раньше. Запомнить `wasWet = now < wetUntil`, `wasBurning = burnPulses > 0`, `el = ability === "burning" ? null : ELEMENT_OF[ability]`, `anchored`.
2. Урон (+15 % «В воздухе»).
3. Толчок, если `knock` и не якорь: множители `roots` (Земля 0,5) × иммунитет (вбок 1, вверх 0,5), потолки 12 / 6, `push`. Если итоговый `distM > 0`: `u.slam = h.slam && ability ≠ "burning" ? { by, ability, damage: h.slam } : null`.
4. HP, засчитывание, событие `hit` — как раньше.
5. Подброс (`launch`, не якорь, вне иммунитета), обездвиживание, замедление — как раньше.
6. Мокрый и Пар (Р9): `fireHit = el === "fire" || h.burn`. `fireHit && wasWet` → `wetUntil = now`, Горение не ложится, если способность не `fireFists` — пар. Иначе `burn` — как раньше. Если `el === "water"`: был `wasBurning` → Горение снято (`burnPulses = 0`, `burnBy = NOBODY`) и пар; затем Мокрый 3 с (событие `status wet` только если не был мокрым).
7. Буксир (`tow`, не якорь, цель жива): `u.tow = { x, z, speed, endTick: now + ticks, by }`, канал и удар о стену — 0, скорость 0, `immuneUntil = max(immuneUntil, endTick + 120)`, событие `tow/start`.
8. «Круговорот»: `el === "water" && wasWet` и источник жив → `healUnit(source, amount × 0,2)`.
9. Смерть — как раньше; плюс `tow = null`, `slam = null`.

Пар: `steam(s, t, u, owner, ability)` — если `now ≥ steamReadyAt`: `steamReadyAt = now + 180`, `spawnSteam` в точке подошвы цели.

**`steam.ts`:** `spawnSteam(s, t, pos, owner, ability): number` — зона `steam`, диск 2,5 м, `bornTick = armTick = now`, `endTick = now + 180`; паров уже 4 — самый старый уходит (`zone/end`); события `zone/telegraph` и `reaction {kind: "steam"}`.

**`units.ts`:**
- `moveUnits(s, t, inputs, hooks: SimHooks = NO_HOOKS)`: юнит с `tow` — `stepTow` вместо шагов (тянет по XZ к точке со своей скоростью через `moveBody`, `vel.y = 0`, без гравитации; взгляд и `jumpHeld` из ввода; продвинулся меньше 0,5 шага — упор; дошёл, упёрся или `now + 1 ≥ endTick` — `endTow`). Иначе прежний шаг плюс: `now < staggerUntil` → `groundAccel × 0,3`; хуки стихии `before` → `params` → `stepPlayer` → `after`; затем `moveKnock(s, t, u)`.
- `moveKnock(s, t, u)`: затухание пола, если `onGround` или `mage.flight.gliding`, иначе воздуха. Ось заблокирована (`kb.x ≠ 0` и после `moveBody` `vel.x === 0`, так же Z), скорость канала до шага ≥ 6 м/с и есть `u.slam` → событие `slam`, затем `applyHit(by, ability, damage, dir 0)`, `slam = null`. Скорость < 6 — `slam = null`. Канал погас — `slam = null`.
- `respawned` переносит `charges` и `chargeAt` вместе с `ready`.

**`projectiles.ts`:**
- `PROJECTILE_DAMAGE`, `DEFS`, `PROJECTILE_JUICE_M` — по всем видам: серп 16 и «сок» 0,3 × min(1, (1/3)/0,5) = 0,2 м; жгут 25 и 0; Ответ 20 и 0.
- `spawnProjectile(s, t, owner, kind, pos, dir, power = PROJECTILE_DAMAGE[kind])`.
- `sweepSegment(s, t, owner, from, to, radiusM, pad?: (u: Unit) => number)` — бокс тела раздувается ещё на `pad(u)` по XZ.
- `wardFaces(u, vel, now)`: `u.mage.ward` и `now < ward.endTick` и `vel·forwardXZ(u.move.yaw) < 0`.
- `stepProjectiles(s, t, hooks = NO_HOOKS)`: `pad = wardFaces ? 0,5 : 0`; попал в юнит, у которого `wardFaces` → впитать: снаряд исчезает без impact и взрыва, `ward.absorbed += power`, событие `absorb`. Иначе `impact` (`ability = PROJECTILE_SOURCE[kind]`), затем хук вида из `hooks.projectileHit`, иначе прежнее (шар взрывается; юнит — `applyHit(power, «сок»)`; рельеф — `damageTerrain(power)`).

**`zones.ts`, `dynamic.ts`:**
- `spawnZone`: пар не входит в лимиты 3 на мага и 16 на арену (считаются и вытесняются только не-пары).
- `export function endZone(s, t, z)` (прежний `evict`).
- `stepZones(s, t, hooks = NO_HOOKS)`: зона, снятая раньше в этом шаге (поглотила реакция), пропускается; после взвода — хук вида из `hooks.zones`, иначе прежнее. Пар без хука ничего не делает.
- `buildTickWorld`: каждый пар — коллайдер `noSight` `aabb(c.x − 2,5, c.y − 0,5, c.z − 2,5, c.x + 2,5, c.y + 3, c.z + 2,5)` после стен огня.

**`kit.ts` — заряды:**

```ts
/** Тик кита: копит заряды по очереди (событие charge на каждый); ready[slot] — now, если заряд есть, иначе chargeAt. */
export function refillCharges(t: TickCtx, u: Unit, slot: Slot, max: number, chargeTicks: number): void;
/** Потратить заряд: false — нет. Первый потраченный из полных ставит chargeAt = now + chargeTicks. */
export function spendCharge(t: TickCtx, u: Unit, slot: Slot, chargeTicks: number): boolean;
```

**`state.ts`, `match.ts`, `index.ts`:** свежие поля по умолчанию (выше); `statusFlags` возвращает ещё `wet: now < wetUntil`. `stepMatch` берёт кит из `ELEMENT_SIM[element].kit` и передаёт `SIM_HOOKS` в `moveUnits`, `stepProjectiles`, `stepZones`. `index.ts` экспортирует ещё `./hooks`, `./dash`, `PROJECTILE_KINDS` и из `combat.ts`: `knockbackSpeed`, `knockbackSpeedFor`, `flightTime`, `isAnchored`, `pullMul`.

- [ ] **Step 1: Тесты (`phase4.test.ts`), увидеть падение:**
  - Контракты: `ELEMENTS` — четыре по порядку; 16 способностей без повторов покрывают `ABILITY_IDS`; `ELEMENT_INFO` Воздуха и Воды (Р18); карточки AIR и WATER закреплены числами выше; `slotCooldownTicks` air 20/480/360/1080, water 24/480/540/840; телеграфы `gust.windupS`, `tornado.growS`, `spring.telegraphS` ≥ 0,4; маг Воздуха стартует с `charges.e = 2`, у остальных 0; свежие статусы — нули; `statusFlags().wet`.
  - K1: бегущий к источнику маг (вперёд зажато) после толчка `{4, 1.5}` — своя скорость к источнику 0, `staggerUntil = t + 12`, его всё равно уносит назад ≥ 0,4 м; стоящий манекен уходит на 4 ± 0,35 м; толчок 0,3 м K1 не включает; иммунитет K1 не ставит.
  - Честный полёт: манекен в воздухе на 2 м над полом, толчок `{3, 0}` — сел в 3 ± 0,35 м (прежняя модель — ≈ 7 м); над пустотой (x = 25) скорость канала = 4,5 м/с ровно; парящий (`flight.gliding = true`) — 18 м/с и гаснет как на полу.
  - K2: в иммунитете толчок `{2, 3.5}` даёт `knock {2, 1.75}`; якорь — ни толчка, ни подброса, ни буксира, урон и замедление проходят.
  - Удар о стену: `{7, 1}` со `slam: 20` к стене в 3 м — событие `slam` и +20 один раз; стена в 8 м — нет.
  - Мокрый и пар: удар способностью Воды мочит (событие `status wet` раз); по горящему — гасит, пар, `reaction steam`; шар по мокрому — сушит, Горения нет, пар; кулак по мокрому — сушит, пара нет; второй пар с той же цели раньше 180 тиков — нет; пятый пар вытесняет первый; у мага с тремя стенами огня стены остаются; пар закрывает `lineOfSight`, а луч `shot` проходит.
  - «Круговорот»: первый удар Воды только мочит, второй лечит источник на 20 % урона, и выше ⅔; `healUnit` не выше максимума, событие `heal` с фактическим числом.
  - `applyStatus`: замедление и мокрый без события `hit`, событие статуса — только при наложении заново; защита не пускает.
  - `launchUnit`: вне иммунитета — «В воздухе» и иммунитет, Земле половина высоты, в иммунитете и под якорем — false, `lastHitBy` = source.
  - Буксир: цель идёт 20 м/с к точке, высота не меняется над ямой, ввод движения и прыжок не действуют, взгляд — из ввода; стена останавливает; `endTick` заканчивает; Реактивный рывок цели обрывает (`tow/end`); после — иммунитет до `end + 120`.
  - Впитывание: снаряд спереди в мага с `ward` исчезает, `absorb`, `absorbed += power`, шар без взрыва; сзади — обычное попадание; после `ward.endTick` — обычное.
  - Заряды: два подряд, третий — нет; заряды возвращаются по очереди через 360 и 720 тиков, события `charge`; `ready` следует.
  - Рывок v2: 8 ± 0,1 м за 12 тиков, первый шаг ≈ 62 м/с, последний ≈ 18 м/с, выход 9 м/с; без следа (`trail: null`) — зоны нет, `trailZone = NOBODY`.
  - Хуки: поддельный `ElementSim` с хуками `move`, `zones`, `projectileHit` через `mergeHooks` зовётся из `moveUnits`, `stepZones`, `stepProjectiles` в своём порядке; повтор вида в двух стихиях — `throw`.
- [ ] **Step 2: Реализовать** всё выше; поправить только названные строки старых тестов. `pnpm test` (940 прежних + новые) и `pnpm --filter @doodlemagic/sim typecheck` зелёные. Клиентский typecheck красный — чинит задача 2.
- [ ] **Step 3: Commit** `feat(sim): phase 4 contracts: four elements, knockback v2 (stagger, honest flight, wall slam), dash profile, wet and steam, heal, tow, ward, slot charges`.

---

### Task 2: Клиент: реестры стихий, сеть v2, меню на четыре

**Модель:** Opus (общие таблицы после прохода ощущения: подстроиться под их форму, ничего не сломать).

**НЕ открывать `research/`.**

Начинается, когда в `phase4` слиты задача 1 и задача ощущения. Формы общих таблиц брать **из кода `phase4`** (их могла поменять задача ощущения); план задаёт только места регистрации и имена файлов стихий.

**Files:**
- Create (заглушки Воздуха; Вода — те же с `water`/`Water`): `feel/airIds.ts`, `feel/airFx.ts`, `audio/airRecipes.ts`, `fx/presets.air.ts`, `fx/airVfx.ts`, `hands/airGestures.ts`, `hud/airHud.ts`
- Create: `feel/elementFx.ts`, `fx/elementVfx.ts`, `hud/kitWidgets.ts`, `hud/elementSelect.css`, `hud/prefs.test.ts`; если у общей таблицы есть приватные помощники (слои звука, частиц, ключи жестов), нужные файлам стихий, — вынести их в лист-модуль (`audio/layers.ts`, `fx/particleKit.ts`, `hands/gestureKeys.ts`), чтобы файл стихии не импортировал общий файл, который импортирует его (TDZ при цикле).
- Modify (регистрация — одна строка или одно поле на таблицу; плюс записи Воздуха и Воды в таблицах `Record<Element|AbilityId|ZoneKind|ProjectileKind, …>`): `feel/effects.ts`, `feel/eventMap.ts`, `audio/recipes.ts`, `audio/audition.ts`, `fx/presets.ts`, `fx/projectileMeshes.ts`, `fx/decals.ts`, `fx/vfx.ts`, `hands/gestures.ts`, `hud/combatHud.ts`, `hud/combatHud.css` (переменные `--ch-air`, `--ch-water`), `game/view.ts` (одна строка — кадровый хук стихий)
- Modify: `net/protocol.ts`, `net/snapshot.ts`, `net/hostCore.ts`, `net/predict.ts`, `hud/elementSelect.ts`, `hud/prefs.ts`, `pvp/lobby.ts`, `pvp/pvp.css`
- Modify (только названные строки тестов): литералы `looks` в `net/hostCore.test.ts` и `net/predict.test.ts` — шестой столбец; `"doodlemagic-g1-"` → `"g2-"` в `net/room.test.ts`, `net/link.test.ts`; литералы событий `dash` в `feel/*.test.ts` — `ability: "jetDash"`; тест полос подписи в `audio/audio.test.ts` — полосы по стихиям (Огонь 2–8 кГц, Земля 30–200 Гц, Вода 300–1500 Гц, Воздух 800–4000 Гц)

**Interfaces:**
- Consumes: задача 1 (типы, события, `ELEMENT_OF`, `PROJECTILE_KINDS`, `statusFlags().wet`), код прохода ощущения в `phase4`.
- Produces (задачи 5–6 наполняют свои файлы по этим именам; Вода — то же с `WATER`/`water`):

```ts
// feel/airIds.ts — список правит только задача 5
export const AIR_SOUND_IDS = ["sickleThrow", "sickleHit", "gustWindup", "gustBlast", "airBlown", "airSlam", "swoop", "airCharge", "tornadoRise", "tornadoHum", "fireTornado", "airJump", "glideWhistle"] as const;
export const AIR_BURST_PRESETS = ["sicklePuff", "gustBlast", "airBlown", "airSlam", "swoopWake", "airJumpRing", "tornadoDust", "fireTornadoFlare", "deathAir"] as const;
// feel/waterIds.ts
export const WATER_SOUND_IDS = ["whipCrack", "whipHit", "grabWindup", "grabThrow", "grabHit", "towPull", "wardUp", "wardAbsorb", "wardDown", "answerThrow", "answerHit", "springSpread", "springBubble", "steamHiss", "heal"] as const;
export const WATER_BURST_PRESETS = ["whipSplash", "grabSplash", "wardAbsorb", "wardBurst", "answerSplash", "springRing", "springBubbles", "steamPuff", "healMotes", "wetDrips", "deathWater"] as const;
// feel/effects.ts: SOUND_IDS и BURST_PRESETS = [...прежние, ...AIR_*, ...WATER_*]

// feel/elementFx.ts
export interface FrameView { prev: MatchState; cur: MatchState; alpha: number; localId: UnitId; nowS: number; dtS: number }
/** Событие своей стихии → эффекты; null — не моё (дальше общая карта). */
export type ElementEventFx = (ev: MatchEvent, view: EventView, me: Unit | undefined) => Effect[] | null;
/** Раз в кадр: непрерывные звуки и частицы стихии (зёрна парения, гул Смерча, журчание). */
export type ElementFrameFx = (f: FrameView) => Effect[];
export function elementEffects(ev: MatchEvent, view: EventView, me: Unit | undefined): Effect[] | null; // airEffects, затем waterEffects
export function elementFrameEffects(f: FrameView): Effect[];
// feel/airFx.ts (заглушка): export function airEffects(...): Effect[] | null { return null } ; export function airFrame(f: FrameView): Effect[] { return [] }

// audio/airRecipes.ts
export type AirSoundId = (typeof AIR_SOUND_IDS)[number];
export const AIR_RECIPES: Readonly<Record<AirSoundId, Recipe>>;   // заглушка: шум bandpass 2000 → 2400 Гц, 0,12 с, подпись
export const AIR_SOUND_LABELS: Readonly<Record<AirSoundId, string>>;
// recipes.ts: RECIPES = { ...прежние, ...AIR_RECIPES, ...WATER_RECIPES }; SOUND_ELEMENT — air / water для своих id
// (заглушка Воды — шум bandpass 700 → 900 Гц, подпись)

// fx/presets.air.ts
export const AIR_BURSTS: Readonly<Record<(typeof AIR_BURST_PRESETS)[number], readonly Layer[]>>;
export const AIR_PALM: PalmLayers;                       // те же виды, что у Огня и Земли
export const AIR_TRAILS: Readonly<Partial<Record<ProjectileKind, TrailFn>>>; // airSickle
export const AIR_PROJECTILE_LOOK: Readonly<Partial<Record<ProjectileKind, ProjectileLook>>>; // у ProjectileLook поле mesh: "sphere" | "stone" | "none"
// presets.ts и projectileMeshes.ts сводят эти таблицы; trailParticles для чужих видов зовёт TrailFn стихии
// FX_COLOR: water #2ea8e6, foam [0.86, 0.95, 1], air #c8c0f2, steam [0.88, 0.9, 0.92]; виды частиц water, foam, mist, wind

// fx/elementVfx.ts
export interface ElementVfxFrame {
  prev: MatchState; cur: MatchState; alpha: number; tick: number; nowS: number; dt: number;
  camera: PerspectiveCamera; eye: Vec3; localId: UnitId;
  units: readonly { id: UnitId; pos: Vec3; u: Unit }[];          // живые, между тиками
  mages: readonly { id: UnitId; pose: MagePose; u: Unit }[];     // чужие маги, как их нарисовала фигура
  palmWorld(h: "left" | "right" | "both"): Vec3;
  emit(specs: readonly ParticleSpec[]): void;
  glow(g: Glow, prio: number): void;
  decal(spec: DecalSpec, seed: number, intensity?: number): void;
}
export interface ElementVfx {
  readonly world: Object3D | null;   // G-буфер, в worldGroup
  readonly light: Object3D | null;   // проход света, в fx.world
  apply?(e: Effect, nowS: number): void;
  sync(f: ElementVfxFrame): void;
  setPreset?(p: PresetId): void;
  dispose(): void;
}
export type ElementVfxFactory = (c: { gbuffer: FxGBuffer; time: TimeUniform }) => ElementVfx;
export const ELEMENT_VFX: readonly ElementVfxFactory[];   // [createAirVfx, createWaterVfx]
// vfx.ts: создаёт их, добавляет объекты, зовёт apply / sync (до decals.update и разбора свечений) / setPreset / dispose;
// HAND_GLOW: air { FX_COLOR.air, 0.75, свет 0 }, water { FX_COLOR.water, 0.85, свет 1.6 }

// hands/airGestures.ts
export const AIR_GESTURES: Readonly<Record<"airSickle" | "gust" | "swoop" | "tornado", GestureDef>>; // заглушка: обе руки вперёд 0,1 с и назад к 0,3 с
// gestures.ts: GESTURES = { ...прежние, ...AIR_GESTURES, ...WATER_GESTURES }; export isFistGesture(a) — view и vfx берут руку «кулака» по нему, а не по "fireFists"

// hud/kitWidgets.ts
export interface KitWidget { update(me: Unit, now: number, nowS: number): void; dispose(): void }
export type KitWidgetFactory = (kitRoot: HTMLElement) => KitWidget;
export const KIT_WIDGETS: Readonly<Partial<Record<Element, KitWidgetFactory>>>; // { air: createAirWidget, water: createWaterWidget }
// combatHud.ts: смена стихии — dispose старого и mount нового в .ch-kit; update в конце обновления кита
```

Поведение общих мест:
- `eventMap.effectsFor`: первой строкой `elementEffects(...)`; новые виды событий без своего обработчика — `[]`. Записи Воздуха и Воды во всех таблицах по способностям (звук каста и попадания — свои id из списков выше, ступень — по слоту: ЛКМ малая, Q/E/C средняя, если задача ощущения ввела ступени). Всплеск смерти по стихии убийцы: `deathAir`, `deathWater`. Событие `dash` с `ability ≠ "jetDash"` — `[]` (Взмах рисует Воздух).
- `decals.ts`: стиль по виду зоны с записями `tornado`, `fireTornado`, `spring` (пар — без декали); `zoneDecal(z, tick, localId = NOBODY)` и поле `enemy` (`localId ≠ NOBODY && owner ≠ localId`). Своих узоров у новых стилей пока нет — до задач 5–6 рисуется существующий стиль кольца.
- `view.ts`: после событий кадра — `for (const e of elementFrameEffects({ prev, cur, alpha, localId, nowS, dtS })) route(e)` под `guard`.
- Сеть (Р16): `NET_VERSION = 2`; `looks: [id, moveX, moveZ, yaw, pitch, jump01][]`; хост пишет `inp.jump ? 1 : 0`; `isSnapshot` — 6 столбцов; `lookInputs` ставит `jump: j === 1`; `eventKey`: `beam:unit:ability`, `blown:unit:kind`, `slam:source:target`, `airJump:unit`, `glide:unit:on`, `charge:unit:slot:charges`, `absorb:unit:kind`, `ward:unit:phase`, `tow:source:target:phase`, `heal:source:target`, `reaction:owner:kind`, у `dash` — ещё `ability`.
- Меню на четыре (Р17): экран выбора — 4 карточки, `Digit1…4`/`Numpad1…4` по `ELEMENTS`, клик по `dataset.element` через `ELEMENTS.find`, подсказка «1–4 или клик»; `elementSelect.css` (подключается после `combatHud.css`) — 4 в ряд от 1100 px, иначе 2 × 2, цвета `--ch-air`/`--ch-water`; `parsePrefs` принимает любую из `ELEMENTS`; лобби — 4 карточки, стихия по `dataset` через `ELEMENTS`; `pvp.css` — сетка и цвета; экран смерти уже берёт `ELEMENT_KEYS` из `ELEMENTS`.

- [ ] **Step 1: Тесты:** `parsePrefs` (air, water, мусор → fire); у каждого `SoundId` есть рецепт ≤ 0,8 с и подпись, у каждого `BurstPreset` — слои ≤ 150, у каждой способности — жест, у каждого вида снаряда — вид, у каждого вида зоны — запись стиля (может быть null); `elementEffects` отдаёт результат заглушки, если она не null (подменить через `vi.spyOn` на модуле), иначе — общую карту; `eventKey` новых событий; снапшот с 6 столбцами проходит `isSnapshot`, с 5 — нет; чужой маг с `jump01 = 1` в переигровке держит прыжок.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные. Полигон: выбор Воздуха и Воды не ломает кадр (кит пока заглушка — маг бегает, Q/E/C молчат).
- [ ] **Step 3: Commit** `feat(client): element registries for Air and Water, net v2 (jump in looks), four elements in menus`.

---

### Task 3: Воздух в sim

**Модель:** Opus (характер стихии и чувство полёта).

**НЕ открывать `research/`.**

**Files:** Modify `packages/sim/src/match/air.ts` (только он); Create `packages/sim/src/match/air.test.ts`.

**Interfaces:**
- Consumes (задача 1): `AIR`, `KNOCKBACK`, `ElementSim`, `MoveHooks`, `ZoneStep`, `castSlots`, `castAim`, `emitCast`, `moveDirXZ`, `refillCharges`, `spendCharge`, `startDash`, `dashStarted`, `stepDash`, `DashSpec`, `spawnProjectile`, `spawnZone`, `endZone`, `aimGround`, `applyHit`, `launchUnit`, `pullMul`, `isAnchored`, `raycast`, `moveBody`, `forwardXZ`.
- Produces: `AIR_SIM: ElementSim` с `kit`, `move`, `zones: { tornado, fireTornado }`. Событий новых не вводит (все в задаче 1).

Поведение (тики 60 Гц):
- **«Лёгкость» (`move`).** `before`: в воздухе (не на полу и окно койота закрыто), нажатие прыжка (`inp.jump && !move.jumpHeld`), `!flight.doubleJumped` → `vel.y = √(2·20·1,25) ≈ 7,07`, `doubleJumped = true`, `move.jumpHeld = true` (иначе `stepPlayer` запомнит нажатие в буфер), событие `airJump`. Затем парение на этом тике: `doubleJumped && inp.jump && !onGround && vel.y < 0 && glideTicks < 180`; смена — событие `glide on/off`. `params`: парит → `airControl 1`, `maxFallSpeed 2,5`. `after`: парит → `glideTicks += 1`; на полу → `doubleJumped = false`, `glideTicks = 0`, парение снято (событие `glide off`, если было). Под обездвиживанием и первые 0,3 с «В воздухе» прыжка нет само (ввод уже без прыжка). Обычный прыжок с зажатым пробелом не парит. Бег — 7,0 м/с через `ELEMENT_INFO`.
- **Серп (ЛКМ).** Как кулаки без жара: готов → `ready.primary = now + 20`, `spawnProjectile("airSickle", глаза, прицел)`, `cast` + `release`; в замахе Порыва — `busy` (буфер).
- **Порыв (Q).** `cooldown` / `busy`; `ready.q = now + 480`, замах `{gust, q, now + 24}`, `cast`. В воздухе и во время Взмаха работает. Выпуск в `tick` на `releaseTick` по взгляду этого тика (Р12): цели — `applyHit({ damage 10, dir = forwardXZ(yaw), knock {7, 1}, slam 20, ability "gust" })`; чужие снаряды в конусе (позиция по XZ ≤ 7 м, угол ≤ 30°, `|p.y − (y + 0,9)| ≤ 2,5`) удаляются без взрыва, событие `blown`; событие `release` с `projectile: −1`.
- **Взмах (E).** `now < rootUntil || now < noControlUntil` → `rooted`; нет заряда → `cooldown` (`ready.e` — ближайший заряд, буфер работает); `spendCharge(e, 360)`, `startDash(SWOOP)`, `cast`, `dashStarted`. `SWOOP = { ability "swoop", 8 м, 0,2 с, profile 0,6, exitSpeed 7, trail null }`. `tick`: `refillCharges(e, 2, 360)`, рывок — `stepDash`. Второй прыжок не возвращает.
- **Смерч (C).** `cooldown` / `busy`; точка `aimGround(…, 20)`, нет опоры — `noTarget`; зона `tornado`, диск 5 м, `armTick = now + 30`, `endTick = armTick + 240`; `ready.c = now + 1080`; `cast`.
- **Шаг вихря (`zones.tornado` и `zones.fireTornado`, после взвода).**
  1. Реакция (только `tornado`, Р10): событие `explosion` огненного шара в `t.ev`, у которого расстояние по XZ до центра ≤ 5 + 3 и `|Δy| ≤ 4,5` → `kind = "fireTornado"`, хозяин — хозяин взрыва; иначе Стена огня (взведённая) или след рывка пересекает диск (бокс или отрезок по XZ ближе радиуса) → `fireTornado`, хозяин — их хозяин, если `bornTick` позже вихря; стена и след — `endZone`. Событие `reaction {fireTornado}`.
  2. Тяга: каждый живой не-хозяин без рывка и буксира, центр подошвы по XZ ≤ 5 м, подошва от `c.y − 0,5` до `c.y + 4` (парящие тоже): сдвиг к центру `2,5 × pullMul` м/с отдельным `moveBody` (скорость тела восстанавливается, как у канала толчка), не дальше центра.
  3. Импульсы: каждые 30 тиков на юнита (`rehit`) `applyHit({ ability "tornado", damage 4, dot: true })`; у `fireTornado` — 8 и `burn: true`.
  4. Ядро 1,5 м: не-хозяин — `launchUnit(3 м, хозяин)`; хозяин на полу — `vel.y = max(vel.y, √(2·20·2))`, `onGround = false`, раз в 60 тиков (запись `rehit` хозяина).
- Сеть: всё в состоянии матча, предсказывается само (раздел «Предсказание»).

- [ ] **Step 1: Тесты `air.test.ts`, увидеть падение:**
  - Второй прыжок: `vel.y ≈ 7,07`, один раз до приземления; `airJump`; после приземления снова; в первые 18 тиков «В воздухе» — нет; койот-прыжок второй не тратит; высота двух прыжков ≈ 2,5 м.
  - Парение: только после второго прыжка с зажатым прыжком и при падении: `vel.y ≥ −2,5`; управление 100 % (разгон в воздухе 60 м/с²); 180 тиков, потом обычное падение; события `glide`; обычный прыжок с зажатым пробелом падает как раньше; толчок `{3, 0}` парящего — 3 ± 0,35 м.
  - Серп: 16 урона, 20 тиков, 60 м/с, `endTick − bornTick = 40`, «сок» 0,2 м; в замахе Порыва ждёт буфер.
  - Порыв: `cast` на тике нажатия, `release` через 24 по прицелу тика выпуска; цель в 5 м под 20° — 10 урона, уходит на 7 ± 0,5 м по взгляду; под 40°, дальше 7,4 м, выше 2,5 м, за коробкой — мимо; сквозь Стену огня — попадает; Земля — 3,5 м; в иммунитете — 7 м (K2); под якорем — не сдвинут; стена в 3 м за целью — `slam` и +20 один раз; чужой шар в конусе — `blown`, взрыва нет; свой снаряд — летит; в воздухе и во время Взмаха работает; перезарядка 480.
  - Взмах: 8 м за 12 тиков по вводу, в воздухе на постоянной высоте; два подряд, третий — `reject cooldown`; заряды через 360 и 720, `charge`; гасит толчок; обрывает свой буксир; под обездвиживанием — `rooted`; выход 7 м/с.
  - Смерч: над пустотой — `noTarget`; зона растёт 30 тиков, живёт 240; стоящий в 4 м от центра за 1 с подтянут ≈ на 2,5 м, бегущий прочь 7 м/с уходит; Земля 1,25 м/с; под якорем — нет; ниже 0,5 м и выше 4 м — нет; импульсы 4 раз в 30 тиков с `dot`; ядро — подброс 3 м и «В воздухе», не чаще иммунитета (за 4 с не больше 2); хозяина ядро поднимает на 2 м, без урона, раз в 60 тиков, его не тянет; перезарядка 1080.
  - «Огненный смерч»: взрыв шара у взведённого вихря → `fireTornado`, хозяин — Огонь, `reaction`; дальше импульсы 8 и Горение, Воздух-хозяин теперь тоже враг; Стена огня, родившаяся позже, поглощается (`zone end`) и отдаёт вихрь хозяину стены; след рывка — так же.
  - Детерминизм: 600 тиков Воздух против Огня по сценарию ввода (все слоты, прыжки) дважды дают одинаковый `JSON.stringify`.
- [ ] **Step 2: Реализовать `air.ts`.** `pnpm test`, `pnpm typecheck` (sim) зелёные.
- [ ] **Step 3: Commit** `feat(sim): Air: double jump and glide, sickle, gust with wall slam and blow-out, two-charge swoop, tornado with pull, core lift and fire tornado`.

---

### Task 4: Вода в sim

**Модель:** Opus (буксир у края и стойка — честность под пингом).

**НЕ открывать `research/`.**

**Files:** Modify `packages/sim/src/match/water.ts` (только он); Create `packages/sim/src/match/water.test.ts`.

**Interfaces:**
- Consumes (задача 1): `WATER`, `ElementSim`, `MoveHooks`, `ZoneStep`, `ProjectileHit`, `castSlots`, `castAim`, `emitCast`, `horizontalDir`, `sweepSegment`, `spawnProjectile`, `spawnZone`, `endZone`, `zoneTouches`, `aimGround`, `applyHit`, `applyStatus`, `healUnit`, `pullMul`, `damageTerrain`, `groundBelow`, `unitById`.
- Produces: `WATER_SIM: ElementSim` с `kit`, `move.params`, `zones: { spring }`, `projectileHit: { waterGrab }`. «Круговорот», мокрый, пар, впитывание и якорь уже в задаче 1.

Поведение:
- **Хлыст (ЛКМ).** `busy`, если замах или диск; готов → `ready.primary = now + 24`, замах `{waterWhip, primary, now + 7}`, `cast`. Выпуск: `sweepSegment(глаза → глаза + прицел × 15, радиус 0,25)`: юнит — `applyHit({ 20, ability "waterWhip", dir = −горизонталь прицела, knock {0,24, 0} })` («сок» к Воде: 0,3 × min(1, 0,4/0,5)); рельеф — `damageTerrain(20)` (Р21); событие `beam {from, to: точка попадания или конец, target}`.
- **Хват (Q).** `busy` (замах, диск); `ready.q = now + 480`, замах 15 тиков, `cast`; выпуск — `spawnProjectile("waterGrab")`, `release`. Хук попадания в юнит (`projectileHit.waterGrab`): буксир по Р5 — `W` хозяин (нет или мёртв — только урон), `d` — расстояние по XZ, `full = max(0, d − 1,5)`, `len = min(full, 7 × pullMul(цель))`; `len < 0,05` — без буксира; конец `E = T − dir·len`; если `len < full` — от `E` шагами 0,25 м к цели первая точка с `groundBelow(·, +0,1, 3)`, нет — без буксира; `ticks = ceil(len / (20/60))`; `applyHit({ 25, ability "waterGrab", tow: { x, z, speed 20, ticks } })`. Рельеф и мир — ничего.
- **Отражение (E).** `cooldown`; во время своего замаха — `busy`; `ready.e = now + 540`, `ward = { now + 60, 0 }`, `anchoredUntil = now + 60`, `cast`, событие `ward up`. В `input`: диск стоит и нажата ЛКМ → конец диска, нажатие поглощено (`pressed.primary = false`, `pending.primary = NEVER`). В `tick`: `now ≥ ward.endTick` → конец. Конец: впитано > 0 → `spawnProjectile("waterAnswer", глаза, прицел, clamp(впитано, 20, 60))` и `release {ability "waterWard"}`; событие `ward down`; `ward = null`; `anchoredUntil = min(·, now)`. `move.params`: диск стоит → бег × 0,7. ЛКМ и Q под диском — `busy`.
- **Родник (C).** `busy` (замах); точка `aimGround(…, 15)`, нет — `noTarget`; свой прежний Родник — `endZone`; зона `spring`, диск 4 м, `armTick = now + 24`, `endTick = armTick + 360`; `ready.c = now + 840`; `cast`.
- **Шаг Родника.** Внутри — по XZ ≤ 4 м и `|Δy| ≤ 1,5`. Хозяин: каждые 15 тиков (`rehit`) `healUnit(3)`; каждый тик `applyStatus({ wetS: 3 })`. Враги: каждый тик `applyStatus({ wetS: 3, slow: { mul 0,7, s 0,5 } })`.

- [ ] **Step 1: Тесты `water.test.ts`, увидеть падение:**
  - Хлыст: удар через 7 тиков, `beam`; цель в 14 м — 20 урона, мокрая, подтянута на ≈ 0,24 м; в 16 м — мимо; коробка закрывает, Стена огня — нет; стена Земли получает 20; темп 24 тика; под диском — `busy`.
  - «Круговорот»: второй хлыст по мокрой цели лечит Воду на 4, и выше 100 из 150.
  - Хват: жгут 28 м/с, до 15 м; цель в 6 м — 25 урона, мокрая, тащится 14 тиков и встаёт в 1,5 м перед Водой; в 12 м — ровно 7 м; Земля — 3,5; в иммунитете — 3,5; Земля в иммунитете — 1,75; под якорем — без буксира; стена останавливает; рывок цели обрывает; иммунитет после буксира; Вода в 1,2 м от края ущелья тянет цель через пропасть — цель падает, сброс засчитан Воде; Вода в 6 м от края, цель за пропастью в 14 м — буксир упирается в 7 м и встаёт на последней точке с опорой, не падает.
  - Отражение: кулак, камень и шар спереди — без урона, шар без взрыва, `absorb`; сбоку-сзади — урон; толчок, подброс, буксир, тяга Смерча не действуют; землетрясение обездвиживает и бьёт; бег ×0,7; ЛКМ досрочно — Ответ с уроном впитанного (кулак 12 → 20 по нижней границе), лишний хлыст не вылетает; 1 с без впитанного — Ответа нет; три шара — 60 по потолку; Ответ мочит и засчитывается «Отражению»; Ответ ловит диск другой Воды; E в замахе Хвата выходит из буфера после выпуска.
  - Родник: над пустотой — `noTarget`; телеграф 24; Вода внутри +12 HP/с импульсами по 3 до полного, мокрая, Горение снято; враг внутри медленнее 0,7 и мокрый, через 0,5 с после выхода — нет; новый Родник снимает старый; перезарядка 840.
  - Пар: хлыст по горящему — гасит и пар; шар по стоящему в Роднике — пар, Горения нет.
  - Детерминизм: 600 тиков Вода против Огня по сценарию дважды — одинаковый `JSON.stringify`.
- [ ] **Step 2: Реализовать `water.ts`.** `pnpm test`, `pnpm typecheck` (sim) зелёные.
- [ ] **Step 3: Commit** `feat(sim): Water: whip, grab with edge-safe tow, ward with answer, spring`.

---

### Task 5: Воздух на клиенте

**Модель:** Opus (читаемость и звук стихии).

**НЕ открывать `research/`.** Общие файлы не править: всё — в файлах Воздуха, зарегистрированных задачей 2. Нужна правка общего — сообщить контролёру.

**Files:** Modify `feel/airIds.ts`, `feel/airFx.ts`, `audio/airRecipes.ts`, `fx/presets.air.ts`, `fx/airVfx.ts`, `hands/airGestures.ts`, `hud/airHud.ts`; Create `feel/airFx.test.ts`, `fx/airVfx.test.ts` (все пути от `apps/client/src/`).

**Interfaces:** Consumes — реестры задачи 2, состояние и события задач 1 и 3, эффекты и ступени после прохода ощущения. Produces — содержимое своих файлов.

Что видно и слышно (`02-air.md`, «Читается»):
- **Серп:** бледно-лавандовый штрих (свечение без ядра + след `wind`), свист 2–3 кГц (`sickleThrow`), попадание — `sicklePuff` и `sickleHit`. Жест — по очереди руками, режущий взмах (`hand: "fist"`).
- **Порыв:** руки уходят назад-вбок 0,4 с; у ладоней сходится кольцо `wind`; свист нарастает 800 → 3000 Гц (`gustWindup`, 0,4 с); последние 0,2 с по полу ложится веер штрихов (`airFrame` видит `windup` Порыва у мага за ≤ 12 тиков до выпуска); выпуск — `gustBlast` конусом, толчок камеры как у средней ступени; `blown` — `airBlown` в точке снаряда; `slam` — `airSlam` и глухой удар, жертве — тряска средней ступени.
- **Взмах:** «вжух» с доплером (`swoop`: bandpass 3000 → 900 Гц, 0,25 с), полоса ветра по траектории (`swoopWake`), свой — FOV-импульс как у рывка. Заряды видят все: две ленты на плаще чужого мага (`airVfx`, InstancedMesh в G-буфере + свечение готовых), своему — две ленты в виджете HUD; `charge` — `airCharge`.
- **Смерч:** 0,5 с раскручивается кольцо штрихов и пыли (`tornadoDust`) и `tornadoRise`; дальше столб ядра (частицы `wind` по спирали ≤ 60/с, свечение без света); гул со свистом 800–1500 Гц зёрнами `tornadoHum` 0,6 с раз в 0,5 с, позиционно (`airFrame`); `fireTornado` — пламя в столбе, зёрна `fireTornado`, свет огня, тост «Огненный смерч!» хозяину.
- **«Лёгкость»:** `airJump` — хлопок-кольцо под ногами (`airJumpRing`, `airJump`); парение — у чужого раскрытый плащ и трепет лент; ровный свист зёрнами `glideWhistle` 0,4 с раз в 0,35 с, пока парит; своему — мазок запаса парения (180 тиков) в виджете.
- Смерть от Воздуха — `deathAir`. Свечение рук чужого Воздуха уже в `vfx` (задача 2).
- Звуки — подпись в 800–4000 Гц, каждый ≤ 0,8 с; под наушники (Р20).
- Бюджет: `airVfx` — не больше +2 draw call; частицы через `emit`.

- [ ] **Step 1: Тесты:** `airEffects` — для каждого события Воздуха (`cast`/`release` своих способностей, `impact` серпа, `blown`, `slam`, `airJump`, `glide`, `charge`, `dash` Взмаха, `zone` и `reaction` вихря) — ожидаемые виды эффектов, свои и чужие; чужое — только мир и звук в точке, без жестов и камеры; `airFrame` — зерно парения не чаще раза в 0,35 с на мага, гул вихря — раз в 0,5 с; жесты кончаются в покое; ленты по числу зарядов; все id из `airIds.ts` имеют рецепт, подпись и слои.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные. На полигоне Воздухом: серп, Порыв по манекену у стены (удар о стену), два Взмаха, Смерч с манекеном, двойной прыжок и парение — всё видно и слышно; счётчик вызовов в бою ≤ 40.
- [ ] **Step 3: Commit** `feat(client): Air look and sound: sickle, gust, swoop ribbons, tornado, double jump and glide`.

---

### Task 6: Вода на клиенте

**Модель:** Opus (читаемость и звук стихии).

**НЕ открывать `research/`.** Общие файлы не править: всё — в файлах Воды, зарегистрированных задачей 2. Нужна правка общего — сообщить контролёру.

**Files:** Modify `feel/waterIds.ts`, `feel/waterFx.ts`, `audio/waterRecipes.ts`, `fx/presets.water.ts`, `fx/waterVfx.ts`, `hands/waterGestures.ts`, `hud/waterHud.ts`; Create `feel/waterFx.test.ts`, `fx/waterVfx.test.ts` (все пути от `apps/client/src/`).

**Interfaces:** Consumes — реестры задачи 2, состояние и события задач 1 и 4, эффекты после прохода ощущения. Produces — содержимое своих файлов.

Что видно и слышно (`03-water.md`, «Читается»):
- **Хлыст:** замах правой 0,12 с; по `beam` — лазурная дуга от ладони (свой — `palmWorld`, чужой — руки позы) до точки (частицы `water` по кривой + короткое свечение), щелчок `whipCrack` (300–1500 Гц); попадание — `whipSplash`, `whipHit`.
- **Хват:** рука назад 0,25 с, нарастающий «вшух» `grabWindup`; жгут виден весь полёт: канат от руки хозяина до снаряда (`waterVfx`, InstancedMesh тонких отрезков); попадание — «чпок» `grabHit`, `grabSplash`; пока идёт буксир — натянутый канат от Воды до цели и `towPull`.
- **Отражение:** лазурный диск ~2 × 2 м перед Водой по взгляду (чужой — в мире; свой — кольцо на 1,2 м перед камерой, полупрозрачное); `wardUp` — «водяной колокол»; каждое `absorb` — диск светлее (по `absorbed`), `wardAbsorb`, `wardAbsorb`-всплеск; огненное гаснет с шипением (`steamPuff`, только вид); `ward down` — `wardBurst`, Ответ — свой вид снаряда (лазурный), `answerThrow`, попадание `answerSplash`, `answerHit`. Виджет HUD: «Ответ N» (clamp 20–60), пока стоит диск.
- **Родник:** кольцо воды разбегается 0,4 с (`springRing`, `springSpread`); лужа светится лазурью (свечение по пресету), пузыри (`springBubbles` ≤ 20/с), журчание зёрнами `springBubble` 0,5 с раз в 0,6 с, позиционно.
- **Мокрый:** капли (`wetDrips`, ≤ 6/с на юнита) у всех мокрых, в том числе манекенов. **Лечение:** `heal` своего мага — `healMotes` у ладоней и `heal`. **Пар:** облако частиц `mist` на всё время зоны (≤ 30/с), `steamHiss`, хозяину — тост «Пар!».
- Жесты — плавные круговые; смерть от Воды — `deathWater`. Звуки — подпись 300–1500 Гц, ≤ 0,8 с, под наушники (Р20). Бюджет `waterVfx` ≤ +2 draw call.

- [ ] **Step 1: Тесты:** `waterEffects` для каждого события Воды (`cast`/`release` своих способностей, `beam`, `impact` жгута и Ответа, `absorb`, `ward`, `tow`, `heal`, `zone` Родника и пара, `reaction steam`), свои и чужие; `waterFrame` — частота зёрен Родника; геометрия каната (концы у руки и у снаряда/цели); яркость диска растёт с `absorbed`; виджет «Ответ N» с границами; жесты в покое; все id из `waterIds.ts` имеют рецепт, подпись и слои.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные. На полигоне Водой: хлыст, Хват манекена (у края ущелья — падает), диск против выстрелов манекенов нет — проверить в PvP-вкладках, Родник с лечением; ≤ 40 вызовов в бою.
- [ ] **Step 3: Commit** `feat(client): Water look and sound: whip arc, grab rope and tow, ward disc and answer, spring, wet and steam`.

---

### Task 7: Приёмка, GDD, дорожная карта, деплой (контролёр)

- [ ] Финальное ревью ветки `phase4` (Opus) и мелочи одним исполнителем.
- [ ] Живая проверка во встроенном браузере: полигон Огнём и Землёй (пункты 1–4 §3 дока ощущения), Воздухом и Водой; PvP в 2–3 вкладках, одна с `?lag=120&loss=2`: шар в лоб останавливает и уносит, сброс с моста, Порыв у руны, Хват у края (роняет только с края), диск против шара и кулаков, Пар, Огненный смерч, парение чужого мага без рывков, выбор стихии 1–4 на экране смерти.
- [ ] GDD: 2.2 «толчок ≥ 1 м даёт 0,2 с ослабленного разгона (не контроль)» и честный полёт; 4.3 и 4.4 — дистанции K2; 4.1 — фраза Воды «Тяни к себе, возвращай удары», Воздух и Вода — [фаза 4]; 4.6 — Пар и Огненный смерч [фаза 4].
- [ ] Дорожная карта: статус фазы 4, что отложено (Р19, Р23).
- [ ] Слить `phase4` в `main`, пуш → автодеплой Vercel, проверить, что сайт отвечает.

## Приёмка фазы

- `pnpm test` (940 + новые), `pnpm typecheck`, `pnpm build:client` — зелёные.
- Толчок: бегущий жертва шара останавливается и улетает; на мосту шар в центр сбрасывает неуспевшего; прыгнувший не улетает дальше карточки.
- Четыре стихии на экране выбора, в лобби и на экране смерти; у Воздуха и Воды работают все слоты, пассивки и реакции; в PvP с `?lag=120&loss=2` свой маг без видимых откатов, чужие парят и тащатся плавно.
- ≤ 40 draw call в бою на четырёх стихиях, 60 FPS на ноутбуке владельца.

## После фазы 4

Отложено: Выкипание, Топь, Огненный вал, Песчаный смерч / Пыльная буря, ульты, двухфазный хитмаркер медленных снарядов, зубчатая кайма у частиц врага, новые арены, руна и сферы, миграция хоста, TURN. Если Воздух силён — первым парение 3 → 2 с, потом урон серпа; если Вода слаба — урон Хвата 25 → 30; если сбросов слишком много — откат K2.
