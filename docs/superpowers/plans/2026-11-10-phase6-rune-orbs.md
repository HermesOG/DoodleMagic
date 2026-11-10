# Фаза 6: руна ярости и сферы здоровья. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Как идёт работа.**
> - Ветка интеграции `phase6` от `main` (ac89df6), worktree `D:\Claude Code\MagicGG\.claude\worktrees\phase6`. Основную папку `D:\Claude Code\MagicGG` не трогать: её делят другие сессии (рядом идёт фаза 7 «вид ярче», ветка `phase7`).
> - Волна 1 — задача 1 (в worktree `phase6`). Волна 2 — задачи 2 и 3 параллельно, каждая в своём worktree от `phase6` после слияния задачи 1. Задача 4 — контролёр. В новом worktree первым делом `pnpm install --frozen-lockfile`.
> - Задача создаёт только свои файлы и правит только названные (таблица «Владение файлами»). Где код отличается от плана в мелочах, прав код; интерфейсы плана не менять.
> - Владелец хочет фазу сегодня: исполнителям не расширять объём, всё сверх плана — в отчёт контролёру.

**Goal:** На «Галерее над ущельем» — 6 малых сфер жизни и руна ярости в центре по GDD 3, на полигоне и в PvP: появляются по таймерам, подбираются, сфера лечит, руна даёт +30 % урона на 12 с, носитель светится золотом, за его убийство +10 к ульте; объявление руны в интерфейсе, строки килфида, звук.

**Architecture:**
- Всё игровое — в чистой симуляции `packages/sim` (новый `match/pickups.ts`): состояние объектов лежит в `MatchState`, поэтому подбор, таймеры и бафф хост считает, а игрок предсказывает тем же `stepGame` без нового сетевого кода (снапшот — всё состояние).
- Точки берутся из `ArenaData.pickups` через `MatchContext.pickups` (`matchContext(arena)`); состояние заводится лениво на первом шаге и заново на старте боя.
- Клиент: вид (меши сфер и руны, свечение носителя) — от состояния, без событий (задача 2); отклик на события (звук, тосты, объявление, килфид) — задача 3.

**Tech Stack:** Node 24, pnpm 12.14, TypeScript 7.0.2 (strict, `noUncheckedIndexedAccess`), Vitest 5.0.5, Vite 8.3.4, three.js 0.186.1, PeerJS 1.5.5, Web Audio. Новых зависимостей нет.

## Global Constraints

- Новых пакетов нет: `package.json` и `pnpm-lock.yaml` не меняются.
- Чистота `sim`: `packages/sim` не импортирует three.js и DOM. В нём нет `Math.random`, `Date`, `performance` и изменяемого состояния на уровне модулей. Реестры — замороженные константы.
- Детерминизм: `stepMatch` и `stepGame` не меняют свои аргументы. Одинаковые состояние, ввод и контекст дают одинаковые до байта `JSON.stringify` состояния и события. Состояние — простые данные: «нет» — `NOBODY` (−1) или `NEVER`, времена — номера тиков.
- Полигон и PvP ведут себя как раньше, кроме одобренного: сферы, руна, ярость, сеть v4. На старте фазы **1294** теста (`pnpm test`, 93 файла); прежние тесты правятся только там, где задача их называет.
- **Чистая комната:** не открывать, не читать и не искать ничего в `D:\Claude Code\MagicGG\research\`. Не переносить код и числа других игр. Числа — из `design/GDD.md`, этого плана и кода.
- Хосту нельзя доверять вводу: нового ввода нет.
- Бюджет: 60 FPS на встроенной графике, в бою ≤ 40 draw call (отладка, `Backquote`). Частицы — только через пулы, всплеск ≤ 150, свет — по пресету 2/4/8 через существующие свечения. Все меши сфер и руны — не больше +2 вызовов (`InstancedMesh`).
- Звук: рецепт ≤ 0,8 с, голосов ≤ 24. Объекты карты — «нейтральный язык» (GDD 6: золото с печатью): тональные колокольные звуки, не шумовые подписи стихий.
- Интерфейс на русском, без родовых окончаний (пол игрока неизвестен). Комментарии в коде — на русском, в стиле соседнего кода.
- Проверки перед коммитом: `pnpm test` (из корня worktree), `pnpm typecheck`, для клиента ещё `pnpm build:client`.
- Коммиты в стиле `feat(sim): …`, `feat(client): …`. Сообщение заканчивается строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Автор git уже настроен (noreply), не менять.

## Решения этого плана

| № | Решение | Почему |
|---|---|---|
| Р1 | **Сфера жизни:** +35 HP (`healUnit`, событие `heal`), лежит с начала, взята — вернётся через 15 с (900 тиков). Берёт только живой маг с HP < максимума: полный пробегает насквозь, сфера остаётся. Манекены не берут | GDD 3. Полный маг не «сжигает» сферу впустую |
| Р2 | **Руна по часам:** первая — через 45 с от начала (полигон — от первого шага, PvP — от разминки и заново от старта боя), дальше на отметках каждые 60 с. Лежащая руна ждёт; на её отметке ничего не происходит. Взята в T — следующая на первой отметке M с M − 10 с > T (объявление всегда получает свои 10 с) | GDD 3: «первая на 0:45, потом каждые 60 с, объявление за 10 с» |
| Р3 | **Подбор касанием:** расстояние от точки объекта (0,5 м над полом) до бокса тела ≤ 0,6 м (сфера) / 0,8 м (руна). Касаются двое — ближний, при равенстве — меньший id | Детерминизм и честность «кто первый добежал» |
| Р4 | **Ярость** — статус `furyUntil`: весь урон носителя ×1,3 (до ×1,15 «В воздухе», множители перемножаются), в том числе Горение, зоны, ульты; отбрасывание не меняется. 12 с; новая руна обновляет до 12 с. Смерть снимает | GDD 3. Один множитель в `applyHit` |
| Р5 | **Убийство носителя:** убийце или засчитанному сбросившему +10 к ульте (через `gainUlt`, сверх +6), событие `fury slain`. Помощь не меняется | GDD 3 |
| Р6 | Сеть: `NET_VERSION` **4**, комната `doodlemagic-g4-…`: у состояния новое поле, старые клиенты не смешиваются | Как g2 → g3 |
| Р7 | Объявление руны — в общем боевом HUD (`combatHud`): работает и на полигоне, и в PvP. Килфид PvP — `pvp/format.ts` | Полигон тоже должен видеть руну |
| Р8 | Вне фазы: большая сфера, руны потока и оплота, ульт-сферы, корона лидера | GDD 3 [MVP] |

## Предсказание

Игрок переигрывает весь мир от снапшота (Н1 фазы 3): `pickups` и `furyUntil` — в снапшоте, свой подбор предсказывается сразу. Спор двух игроков за одну сферу решает хост; у проигравшего сфера мигнёт (взял → вернулась со снапшотом) — допустимо. События `pickup` и `fury` сверяются по `eventKey`.

## Владение файлами

| Задача | Волна | Создаёт | Правит |
|---|---|---|---|
| 1. Sim: объекты карты, ярость, сеть v4 | 1 | `packages/sim/src/match/pickups.ts`, `pickups.test.ts`; `apps/client/src/net/netV4.test.ts` | sim `match/`: `types.ts`, `defs.ts`, `state.ts`, `match.ts`, `rules.ts`, `combat.ts`, `units.ts`, `index.ts`; клиент: `net/protocol.ts`, `net/snapshot.ts`, `net/predict.ts`; заглушки для typecheck в `feel/eventMap.ts` (только новые `case`); названные строки тестов |
| 2. Клиент: вид сфер, руны и носителя | 2 | `fx/pickupVfx.ts`, `fx/pickupVfx.test.ts` | `fx/vfx.ts` (создать и звать `pickupVfx`), `fx/presets.ts` (новые всплески), `feel/effects.ts` (только список `BURST_PRESETS`) |
| 3. Клиент: объявление, килфид, звук | 2 | `feel/pickupFx.test.ts`, `hud/runeHud.test.ts` | `feel/eventMap.ts`, `feel/effects.ts` (только список `SOUND_IDS`), `audio/recipes.ts`, `hud/combatHud.ts`, `hud/combatHud.css`, `hud/format.ts`, `pvp/format.ts`, `pvp/matchHud.ts` (если нужно) |

Пути клиента — от `apps/client/src/`.

---

### Task 1: Sim: сферы, руна, ярость; сеть v4

**Модель:** Opus (правила и контракты для двух задач).

**НЕ открывать `research/`.**

**Files:**
- Create: `packages/sim/src/match/pickups.ts`, `packages/sim/src/match/pickups.test.ts`, `apps/client/src/net/netV4.test.ts`
- Modify (sim `match/`): `types.ts`, `defs.ts`, `state.ts`, `match.ts`, `rules.ts`, `combat.ts`, `units.ts`, `index.ts`
- Modify (клиент): `net/protocol.ts` (`NET_VERSION = 4`), `net/snapshot.ts` (`isSnapshot`: `Array.isArray(m.pickups)`), `net/predict.ts` (`eventKey`), `feel/eventMap.ts` — только `case` новых событий и статуса, если без них не проходит typecheck (пустой ответ `[]`)
- Modify (только названные строки тестов): `net/netV2.test.ts:31–32`, `net/netV3.test.ts:12–13` (версия и комната → 4 / `g4`), `net/link.test.ts:260, 469` (`g3` → `g4`); тесты, которые сравнивают `freshStatuses()` или `createMatchState` целиком — плюс новые поля

**Interfaces** (экспорт из `@doodlemagic/sim`; задачи 2–3 опираются на них):

**`types.ts`:**

```ts
import type { …, Pickup, PickupKind } from "../types";

/** Объект на карте (фаза 6): лежит, пока now ≥ readyAt; взят — readyAt уходит вперёд. pos — точка арены (0,5 м над полом). */
export interface PickupState { kind: PickupKind; pos: Vec3; readyAt: number }
// MatchState: + pickups: PickupState[];          (createMatchState: [])
// Statuses:   + /** Руна ярости (GDD 3): урон ×1,3, пока now < furyUntil; смерть снимает. */ furyUntil: number;   (freshStatuses: 0)
// StatusKind: + "fury"
// MatchContext: + /** Объекты на карте: matchContext берёт их из арены. Нет поля — объектов нет. */ readonly pickups?: readonly Pickup[];

// MatchEvent — два новых вида:
  /** Объект на карте: warn — руна через 10 с; spawn — появился (unit NOBODY у обоих); take — взят магом unit. index — номер в state.pickups. */
  | { type: "pickup"; kind: PickupKind; index: number; phase: "warn" | "spawn" | "take"; unit: UnitId; pos: Vec3 }
  /** Ярость снята: end — время вышло; slain — носитель погиб, by — убийца или засчитанный сбросивший (+10 к ульте) или NOBODY. pos — подошва. */
  | { type: "fury"; unit: UnitId; phase: "end" | "slain"; by: UnitId; pos: Vec3 }
```

**`defs.ts`:**

```ts
/** Объекты на карте (GDD 3; Р1–Р5 фазы 6). reachM — от точки объекта до бокса тела. */
export const PICKUPS = {
  orb: { heal: 35, respawnS: 15, reachM: 0.6 },
  rune: { firstS: 45, everyS: 60, warnS: 10, furyS: 12, damageMul: 1.3, killUlt: 10, reachM: 0.8 },
} as const;
```

**`pickups.ts` (новый):**

```ts
/** Состояние объектов арены на тике now: сферы лежат сразу (readyAt NEVER — без события spawn), руна — на now + 45 с. */
export function initPickups(list: readonly Pickup[], now: number): PickupState[];
/** Объект лежит на тике now. */
export const pickupPresent = (p: Readonly<PickupState>, now: number): boolean => now >= p.readyAt;
/** Носитель ярости: живой, now < furyUntil. */
export function hasFury(u: Readonly<Unit>, now: number): boolean;
/**
 * Шаг объектов (stepMatch, после stepTerrain, до stepStatuses): по индексу — руна на readyAt − 600 → pickup/warn;
 * на readyAt → pickup/spawn; лежит — касание (Р3) → подбор и pickup/take. Сфера: healUnit(+35), readyAt = now + 900.
 * Руна: furyUntil = now + 720, событие status fury (ticks 720, source — сам маг), readyAt — следующая отметка (Р2).
 * Затем живым магам с furyUntil === now — fury/end.
 */
export function stepPickups(s: MatchState, t: TickCtx): void;
/**
 * Смерть юнита: был носителем (now < furyUntil) — furyUntil = now, событие fury/slain; by не NOBODY и не сам — +10 к
 * ульте (gainUlt, × ultChargeMul). Зовут applyHit (ветка смерти, после ultOnKill, by = source) и stepLife (сброс, by = credit).
 */
export function furyOnDeath(s: MatchState, t: TickCtx, victim: Unit, by: UnitId): void;
```

Поведение общих мест:
- `state.ts`: `freshStatuses` + `furyUntil: 0`; `createMatchState` + `pickups: []`.
- `match.ts`: `matchContext(arena)` + `pickups: clonePlain(arena.pickups)`; в `stepMatch` сразу после копии: `s.pickups.length !== (ctx.pickups?.length ?? 0)` → `s.pickups = initPickups(ctx.pickups ?? [], s.tick)` (ленивое заведение: полигон, разминка PvP); `stepPickups(s, t)` между `stepTerrain` и `stepStatuses`; порядок в комментарии `stepMatch` дополнить. `respawnMage` — свежий маг без ярости (так и выйдет само).
- `rules.ts` `startLive`: `s.pickups = initPickups(ctx.pickups ?? [], now)` рядом с очисткой снарядов и зон (сферы снова на месте, руна — через 45 с от старта боя).
- `combat.ts` `applyHit`: источник ищется до расчёта урона; `hasFury(src, now)` → урон × `PICKUPS.rune.damageMul` (затем ×1,15 «В воздухе», как сейчас); в ветке смерти после `ultOnKill` — `furyOnDeath(s, t, u, h.source)`. В JSDoc порядок дополнить.
- `units.ts` `stepLife`: на сброс — после засчитывания и `ultOnKill` — `furyOnDeath(s, t, u, credit)`.
- `index.ts`: экспорт `./pickups`.
- Клиент `net/predict.ts` `eventKey`: `pickup:${kind}:${index}:${phase}:${unit}`, `fury:${unit}:${phase}:${by}`.

- [ ] **Step 1: Тесты (`pickups.test.ts`, `netV4.test.ts`), увидеть падение:**
  - Заведение: `matchContext(buildGallery())` даёт 7 точек (6 `orb` + 1 `rune`); первый `stepMatch` заводит `pickups`: сферы лежат на тике 0 без событий, руна — `readyAt` = 2700; без `ctx.pickups` (тестовая арена) — `pickups []`, как раньше.
  - Сфера: маг с HP 50 входит в точку → `heal` +35 и `pickup take`, сфера пропадает; через 900 тиков — `pickup spawn` и снова лежит; маг с полным HP проходит — сфера на месте; HP 90 из 100 — лечит до 100 (событие с фактическим +10); манекен не берёт; двое касаются — берёт ближний (равно — меньший id); на 0,7 м от бокса — не берёт, на 0,5 — берёт.
  - Руна: `pickup warn` ровно на тике 2100, `spawn` на 2700, до 2700 не берётся; взята на 2750 → `furyUntil` 3470, событие `status fury` 720, следующая — `warn` 5700 / `spawn` 6300; лежит 55 с и взята на 6300 + 3300 → следующая на 6300 + 7200 (отметка через 60 с ближе 10 с — пропущена); лежащая руна на своей отметке не даёт событий.
  - Ярость: удар 20 от носителя — 26; Горение носителя — импульс ×1,3; по цели «В воздухе» — ×1,3 × 1,15; отбрасывание то же, что без ярости; на тике `furyUntil` — `fury end`, урон снова ×1; вторая руна в ярости — `furyUntil` от новой.
  - Смерть носителя: убит магом → `fury slain` с `by` убийцы, убийце +6 +10 (на полигоне ×10 — до 100), `furyUntil` = тик смерти; сброшен с засчитыванием — `slain` и +10 сбросившему; сам упал — `slain` с `by` NOBODY, заряда нет.
  - PvP: в разминке руна через 45 с от первого шага; `startLive` — сферы на месте, руна на старт + 2700; `setElement` живого в разминке — без ярости.
  - Сеть (`netV4.test.ts`): `NET_VERSION` 4; `gamePeerId("ABCD")` — `doodlemagic-g4-abcd-host`; снапшот без `pickups` — `isSnapshot` false, с ним — true; `eventKey` для `pickup` и `fury`.
  - Детерминизм: 4000 тиков на галерее, два мага бегут по сферам и к руне, дерутся, дважды — одинаковый `JSON.stringify`.
- [ ] **Step 2: Реализовать** всё выше; поправить только названные строки старых тестов. `pnpm test`, `pnpm typecheck` зелёные.
- [ ] **Step 3: Commit** `feat(sim,client): phase 6 pickups: health orbs, fury rune with +30 % damage and +10 ult for the kill, net v4`.

---

### Task 2: Клиент: вид сфер, руны и носителя

**Модель:** Opus (читаемость «золота с печатью» в «Туши и свете»).

**НЕ открывать `research/`.** Файлы задачи 3 не трогать (параллельно в другом worktree).

**Files:** Create `fx/pickupVfx.ts`, `fx/pickupVfx.test.ts`; Modify `fx/vfx.ts` (создать и звать `pickupVfx` как `ultVfx`: `sync` / `setPreset` / `dispose`), `fx/presets.ts` (всплески ниже), `feel/effects.ts` (только список `BURST_PRESETS`: `"orbTake"`, `"orbSpawn"`, `"runeSpawn"`, `"runeTake"`, `"furyMote"`).

**Interfaces:** Consumes — задача 1 (`MatchState.pickups`, `pickupPresent`, `hasFury`, `PICKUPS`, `Statuses.furyUntil`). Produces — вид в мире; событий не читает: всё по `prev` / `cur` кадра (переходы «лежит → нет» и «нет → лежит» — всплески на месте объекта).

Что видно (GDD 6: руна, корона и сферы — золото с печатью; мир — тушь, магия — единственное насыщенное и яркое):
- **Сфера:** золотой шар ≈ 0,28 м в кольце-печати тушью, покачивается ±0,08 м (0,5 Гц) и медленно вращается; слабое золотое свечение (свет ≈ 2 м, низкая яркость, по бюджету пресета). На полу под точкой всегда видна тусклая печать-круг: игрок учит места. Пока сферы нет — печать бледная; за последние 2 с до `readyAt` разгорается. Появление — рост из печати за 0,25 с и `orbSpawn` (≤ 30 частиц); взятие — `orbTake` (золотые искры вверх, ≤ 40).
- **Руна:** золотой знак-диск ≈ 1,1 м, парит на 1,2 м над площадкой, вращается, свечение ≈ 5 м. Объявление: последние 10 с до `readyAt` на площадке тушью дорисовывается круг-печать (доля = прошедшее / 10 с), к центру тянутся золотые искры. Появление — `runeSpawn` (столб искр, ≤ 120) и вспышка света; взятие — `runeTake` (≤ 120).
- **Носитель ярости** (любой маг, `hasFury` по `cur`): золотое свечение у груди, пульс 1,5 Гц (свет ≈ 2,5 м), за ним — золотые искры `furyMote` ≤ 20/с. Своему — искры у ладоней (не закрывать прицел), без света в лицо камеры. Последние 2 с ярости — пульс чаще (гаснет).
- Бюджет: все меши — один-два `InstancedMesh` (≤ +2 вызова), частицы — общий пул, свет — существующие свечения (`glows`) в лимите пресета.

- [ ] **Step 1: Тесты `pickupVfx.test.ts`:** число инстансов = лежащим объектам; переход «лежит → нет» между `prev` и `cur` даёт всплеск взятия в точке, «нет → лежит» — появления; печать руны видна только последние 10 с до `readyAt`, её доля растёт; свечение носителя есть только у живого с `furyUntil > now`; ≤ 2 новых вызова; `dispose` чистит.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные. Полигон: сферы видны на своих местах, руна — с 0:45.
- [ ] **Step 3: Commit** `feat(client): health orbs, fury rune and fury holder glow in ink and light`.

---

### Task 3: Клиент: объявление руны, килфид, звук

**Модель:** Opus (звук и тексты — ощущение).

**НЕ открывать `research/`.** Файлы задачи 2 не трогать (параллельно в другом worktree).

**Files:** Create `feel/pickupFx.test.ts`, `hud/runeHud.test.ts`; Modify `feel/eventMap.ts`, `feel/effects.ts` (только список `SOUND_IDS`: `"orbTake"`, `"runeWarn"`, `"runeSpawn"`, `"runeTake"`, `"furyEnd"`, `"furySlain"`), `audio/recipes.ts`, `hud/format.ts`, `hud/combatHud.ts`, `hud/combatHud.css`, `pvp/format.ts`, `pvp/matchHud.ts` (только если без него строки килфида не идут).

**Interfaces:** Consumes — задача 1. Produces:

```ts
// hud/format.ts
/** Строка объявления руны по состоянию: руны нет и до появления ≤ 10 с — «Руна ярости через N» (N — секунды вверх);
 *  появилась ≤ 3 с назад и лежит — «Руна ярости в центре»; лежит дольше — null; у чужого носителя — «Руна у {имя} · N»;
 *  у меня — null (своё — у полосы HP). names нет или имени нет — «мага». */
export function runeNotice(s: Readonly<MatchState>, localId: UnitId, now: number, names?: ReadonlyMap<UnitId, string>): string | null;
/** Своя ярость: секунды вверх, 0 — нет. */
export function furyLeftS(s: Readonly<MatchState>, localId: UnitId, now: number): number;
```

Поведение:
- **Звук** (`audio/recipes.ts`, колокола и золото, ≤ 0,8 с): `orbTake` — светлый двузвучный звон (вверх), 0,35 с; `runeWarn` — низкий гонг с мерцанием сверху, 0,8 с, на всю карту; `runeSpawn` — гонг и восходящее мерцание, 0,8 с, на всю карту; `runeTake` — глубокий удар-аккорд, 0,6 с; `furyEnd` — нисходящий мягкий звон, 0,4 с; `furySlain` — резкий звон с «треском печати», 0,5 с. Подписи — как у соседей.
- **`effectsFor`** (`eventMap.ts`): `pickup warn` → `runeWarn` без позиции; `pickup spawn` руны → `runeSpawn` без позиции (сферы — тихо, без звука); `take` сферы своим → `orbTake` без позиции, чужим → в точке, тихо; `take` руны своим → `runeTake` без позиции, FOV +4°, тост «Руна ярости! +30 % урона»; чужим — `runeTake` в точке с `floor` (слышно издалека); `status fury` — `[]`; `fury end` своего → `furyEnd`; `fury slain`: `by` — я → `furySlain` и тост «Руна сбита! +10 к ульте»; прочие — `[]`. Всплесков здесь нет (вид — задача 2, по состоянию).
- **Объявление** (`combatHud.ts`, `.css`): строка `runeNotice` по центру сверху под строкой матча (на полигоне её нет — та же позиция), золотая; «через N» — с пульсом последние 3 с (гасится настройкой движения, если связь есть). Своя ярость — у полосы HP «Ярость N» золотом и класс `is-fury` на полосе. Источник — `cur` (предсказанный), имена — `names` из `update`.
- **Килфид** (`pvp/format.ts` `feedLine`, только подтверждённые): `pickup take` руны — «{имя} · руна ярости» (mine — я взял); `fury slain` с `by` ≠ NOBODY — «{by} · +10 к ульте за носителя руны» (mine — я `by` или жертва); прочие — `null`.

- [ ] **Step 1: Тесты:** `effectsFor` для всех фаз `pickup` и `fury`, своих и чужих; `runeNotice` — 0 / 10 / 9,1 с до появления («через 10»), лежит 2 с и 5 с, чужой носитель с именем и без, свой — null; `furyLeftS`; `feedLine` — две новые строки и `null` для `warn` / `spawn` / сферы; у новых звуков есть рецепт ≤ 0,8 с и подпись.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные.
- [ ] **Step 3: Commit** `feat(client): rune announcement, fury HUD, pickup sounds and kill feed lines`.

---

### Task 4: Приёмка, дорожная карта, деплой (контролёр)

- [ ] Слить задачи 2 и 3 в `phase6`, финальное ревью ветки (Opus), мелочи — одним исполнителем.
- [ ] Живая проверка во встроенном браузере на полигоне `/`: сферы на шести местах, лечат раненого; руна на 0:45 с объявлением за 10 с, подбор, золотое свечение у рук, «Ярость N», урон ×1,3 по манекену; ≤ 40 вызовов. PvP вживую не проверить (сервер PeerJS не пускает встроенный браузер) — покрыто тестами sim и снапшота.
- [ ] GDD 3: отметить «Объекты на карте» как сделанные в фазе 6 и правила Р1–Р3 (полный не берёт сферу, часы руны).
- [ ] Дорожная карта `docs/superpowers/plans/2026-10-17-prototype-roadmap.md`: статус фазы 6, отложенное (Р8). Журнал `.superpowers/sdd/progress.md`.
- [ ] Если в `main` уже есть фаза 7 — слить `main` в `phase6` и пройти проверки. Слить `phase6` в `main`, пуш → автодеплой Vercel, проверить, что сайт отвечает.

## Приёмка фазы

- `pnpm test` (1294 + новые), `pnpm typecheck`, `pnpm build:client` — зелёные.
- Сферы и руна появляются по таймерам, подбираются на полигоне и в PvP; бафф ×1,3 и свечение носителя работают; за убийство носителя +10 к ульте; объявление руны за 10 с, строки килфида, звук.
- Всё в `main` и на сайте.
