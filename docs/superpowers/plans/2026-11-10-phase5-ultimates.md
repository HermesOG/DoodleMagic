# Фаза 5: ульты на X для четырёх стихий. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Как идёт работа.**
> - Ветка интеграции `phase5` от `main`. Все worktree — от `phase5`, слияния — в `phase5`, в `main` — один раз в задаче 7. В новом worktree первым делом `pnpm install --frozen-lockfile`.
> - Волна 1 — задача 1 (одна). Волна 2 — задачи 2, 3, 4 параллельно, после слияния задачи 1. Волна 3 — задачи 5 и 6 параллельно, после слияния задач 2–4. Задача 7 — контролёр.
> - После задачи 1 до слияния задачи 4 `pnpm --filter @doodlemagic/client typecheck` красный (новые способности, вид зон и слот X в таблицах клиента) — так и задумано, в `main` это не попадает. `pnpm test` зелёный всегда.
> - Задача создаёт только свои файлы и правит только названные (таблица «Владение файлами»). Где код `phase5` отличается от плана в мелочах, прав код; интерфейсы плана не менять.
> - Владелец хочет фазу сегодня, за несколько часов: исполнителям не расширять объём, всё сверх плана — в отчёт контролёру.

**Goal:** Ульта на X у всех четырёх стихий: Огонь «Дыхание дракона», Земля «Тектонический разлом», Воздух «Ураган», Вода «Цунами». Заряд по GDD 3, кольцо заряда на ячейке X, отказ «не готово», имена ульт в килфиде и на экране смерти, на полигоне и в PvP.

**Architecture:**
- Всё боевое — в чистой симуляции `packages/sim` (хост считает, игрок переигрывает тем же `stepGame`), поэтому заряд, каст ульты, её зоны и удары предсказываются сами.
- X — пятый слот `Slot = … | "x"`: тот же `castSlots`, буфер нажатий, события `cast` / `reject`. Вместо перезарядки слот ждёт заряд: общий модуль `ult.ts` копит заряд, начинает и заканчивает каст, пишет событие `ult`. Что ульта делает — в файле своей стихии (`fire.ts`, `earth.ts`, `air.ts`, `water.ts`).
- Клиент: общий слой (HUD, сеть v3, заглушки таблиц, общий звук «ульта!») — задача 4; вид и звук Огня и Земли живут в общих таблицах (задача 5), Воздуха и Воды — в своих файлах (задача 6).

**Tech Stack:** Node 24, pnpm 12.14, TypeScript 7.0.2 (strict, `noUncheckedIndexedAccess`), Vitest 5.0.5, Vite 8.3.4, three.js 0.186.1, PeerJS 1.5.5, Web Audio. Новых зависимостей нет.

## Global Constraints

- Новых пакетов нет: `package.json` и `pnpm-lock.yaml` не меняются. three.js — точно `0.186.1`, `@types/three` — `0.186.0`, `peerjs` — `1.5.5`.
- Чистота `sim`: `packages/sim` не импортирует three.js и DOM. В нём нет `Math.random`, `Date`, `performance` и изменяемого состояния на уровне модулей (кроме буфера `scratch` в `body.ts`). Реестры — замороженные константы.
- Детерминизм: `stepMatch` и `stepGame` не меняют свои аргументы. Одинаковые состояние, ввод и контекст дают одинаковые до байта `JSON.stringify` состояния и события. Состояние — простые данные: «нет» — `NOBODY` (−1) или `null`, времена — номера тиков.
- Полигон и PvP ведут себя как раньше, кроме одобренного: слот X, заряд ульты, четыре ульты, сеть v3. На старте фазы **1168** тестов (`pnpm test`, 85 файлов); прежние тесты правятся только там, где задача их называет.
- **Чистая комната:** не открывать, не читать и не искать ничего в `D:\Claude Code\MagicGG\research\`. Не переносить код и числа других игр. Числа — из `design/GDD.md`, `design/round1/04-role-designer.md`, `design/round3/*.md`, этого плана и кода.
- Хосту нельзя доверять вводу: сообщения игрока проходят `parseClientMsg`, ввод — `sanitizeInput`. Новое из ввода — только кнопка X (бит 32).
- Бюджет: 60 FPS на встроенной графике (Iris Xe, Vega 8), в бою ≤ 40 draw call (отладка, клавиша `Backquote`: «вызовов N»). Частицы — только через пулы `InstancedMesh`, всплеск ≤ 150 (`MAX_BURST`), свет — по пресету 2/4/8. Новые меши — `InstancedMesh`, не больше +2 вызовов на стихию на все её эффекты ульты.
- Звук: рецепт ≤ 0,8 с, голосов ≤ 24, подпись стихии в своей полосе (GDD 5): Огонь 2–8 кГц, Земля 30–200 Гц, Вода 300–1500 Гц, Воздух 800–4000 Гц. Непрерывные звуки (поток Дыхания, рокот волны) — зёрнами ≤ 0,8 с (Р15 фазы 4). Под наушники (Р20 фазы 4).
- Интерфейс на русском. Клавиши только по `event.code`. Комментарии в коде — на русском, в стиле соседнего кода.
- Проверки перед коммитом: `pnpm test` (из корня), `pnpm typecheck`, для клиента ещё `pnpm build:client`.
- Коммиты в стиле `feat(sim): …`, `feat(client): …`. Сообщение заканчивается строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Автор git уже настроен (noreply), не менять.

## Решения этого плана

| № | Решение | Почему |
|---|---|---|
| Р1 | **Заряд — ровно GDD 3:** 100 очков; источнику 1 за каждые 15 нанесённого урона, цели 1 за каждые 30 полученного (дробно); +6 за убийство (и за засчитанный сброс); +3 за помощь — каждому, кто бил жертву за последние 5 с, кроме убийцы; +1 каждые 6 с живому магу. Урон своих ульт заряд источнику **не** даёт (цели — даёт). Не выше 100 | GDD 3. Без исключения ульта перезаряжала бы сама себя |
| Р2 | **Смерть заряд не сжигает; смена стихии — сжигает в 0** (экран смерти, разминка, полигон). Каст ульты тратит весь заряд сразу | GDD 3 — про смерть. Смена стихии с полной ультой давала бы «ульту под контрпик» бесплатно — решение плана, владелец может перевернуть одной строкой в `rules.ts` / `match.ts` |
| Р3 | **X — пятый слот** `"x"`: `castSlots`, буфер 0,3 с, события `cast`/`reject` как у прочих. Заряд < 100 — отказ `uncharged` сразу (на ячейке — «отказ», `deny`). Во время своей ульты прочие слоты — `busy` | Один код нажатий; отказ читается мгновенно |
| Р4 | Порог отбрасывания ульт — ×1,5 к общему: вбок 18 м, вверх 9 м (`isUlt(ability)` в `applyHit`). Жёсткий контроль ульт — только «В воздухе» (подброс) с прежним иммунитетом 2 с | GDD 2.2 |
| Р5 | **Телеграфы:** Дыхание — вдох 0,6 с (карточка GDD 4.3; убить мгновенно не может — урон потоком 3 с); Разлом, Ураган, Цунами — 0,8 с (могут сбросить или снести 100 HP) плюс звук на всю карту у всех четырёх | GDD 2.2 «ульта — от 0,6 с; может сбросить — от 0,8 с, звук на всю карту» |
| Р6 | **«Дыхание дракона»** (GDD 4.3): вдох 0,6 с, поток 3 с, конус 12 м, **полуугол 15°** («конус 30°» — полный раствор), 45 урона/с импульсами 7,5 раз в 10 тиков + Горение; маг ×0,6 и без прыжка весь каст; конус идёт за взглядом. Камень и стены Земли закрывают (луч `shot`), Стена огня и пар — нет. Диск Отражения спереди не пускает поток (урона нет, впитанного нет) | GDD 4.3 — 45/с (раунд 1 — 60, заменено). Отражение — контригра из `round1/04` |
| Р7 | **«Тектонический разлом»** (GDD 4.4): только стоя на полу; линия 25 × 3 м от 1,5 м перед магом **точно по взгляду** (не по осям), вся видна сразу, трещина бежит 0,8 с; удар по всей линии в конце: 100 урона, подброс 5 м («В воздухе»), 1 м вбок от линии; кто в воздухе — не задет. Дальше 6 с «стена шипов» — **опасная полоса**, не твёрдый рельеф: касание — 20 урона и 3 м вбок от линии, раз в 1 с на юнита | Твёрдая стена 25 м по взгляду — это 8–10 AABB, а рельефа ≤ 3 на мага и ≤ 24 на арену (GDD 7.4). Полоса держит смысл «стены поперёк арены» и укладывается в лимит зон |
| Р8 | **«Ураган»** (раунд 1 + правки GDD 4.5): замах 0,8 с (маг ×0,5, без прыжка), радиус 10 м, `|Δy| ≤ 4`, 60 урона, толчок от мага 16 м у центра → 8 м на краю + 2 м вверх + «В воздухе»; сдувает чужие снаряды (`blown`) и чужие зоны (центр в 10 м), ломает чужой рельеф в 10 м; маг взлетает на 3 м и получает свежие 3 с парения «Лёгкости» | В «Свалке» «вражеские» = чужие. 16 м < 18 (Р4) |
| Р9 | **«Цунами»** (раунд 1 + правки GDD 4.5): волна 14 м шириной поднимается 0,8 с в 2 м за магом и катится по взгляду 15 м/с на 30 м; 80 урона, 10 м по ходу волны + 1 м вверх, Мокрый (гасит Горение — пар); бьёт раз на юнита, подошва от `y₀ − 1` до `y₀ + 2,5`; закрывает укрытие между линией старта волны и целью; гасит любые Стены огня, следы рывка и огненные смерчи на пути (пар) | Подъём выше 2,5 м и стена Земли — контригра из карточки |
| Р10 | Сеть: `NET_VERSION` **3**, бит X = 32, хост принимает кнопки 0…63; id комнаты `doodlemagic-g3-…` (как g1 → g2) | Старые клиенты не смешиваются с новыми |
| Р11 | Килфид и экран смерти берут `ABILITY_NAME`: у четырёх ульт имена из `ELEMENT_INFO.ult`. Сброс волной или Ураганом — обычный «сброс» с засчитыванием | `pvp/format.ts` уже так устроен |
| Р12 | Полигон: заряд копится ×10 (`MatchContext.ultChargeMul = 10`), PvP — ×1 | Иначе ульту на полигоне не проверить за минуту |
| Р13 | Вне фазы: реакции ульт (Дыхание в Смерч, Цунами в Родник и т. п.), руна и корона (+10 / +15 к ульте), ульт-сферы, твёрдая стена шипов | Время; бэклог |

## Предсказание: что новое и как

Игрок переигрывает весь мир от снапшота (Н1 фазы 3). Всё, что лежит в состоянии матча, предсказывается само.
- **Заряд** — поле `mage.ult.charge` в снапшоте; своя переигровка копит его теми же правилами. Кольцо HUD — по предсказанному состоянию.
- **Свой каст** — нажатие X сразу в своей переигровке: `cast` и телеграф без задержки; у хоста — на RTT/2 позже, внутри телеграфа 0,6–0,8 с.
- **Чужая ульта** — приходит со снапшотом (`mage.ult.cast`, зоны `rift` и `tsunami`); телеграф 0,6–0,8 с больше задержки 60–110 мс.
- **Толчки ульт** у жертвы — со снапшотом, как Порыв (раздел фазы 4): v₀ до ≈ 30 м/с × ≤ 110 мс ≤ 3,3 м — на грани `SNAP_DIST_M` = 3 м; если откат заметен, задача 7 решает (поднять порог для своего толчка ≥ 12 м).
- Новые события сверяются по `eventKey` (задача 4).

## Владение файлами

| Задача | Волна | Создаёт | Правит |
|---|---|---|---|
| 1. Контракты sim: слот X, заряд, `ult.ts`, бит ввода | 1 | `packages/sim/src/match/ult.ts`, `phase5.test.ts`; `apps/client/src/net/netV3.test.ts` | sim `match/`: `types.ts`, `defs.ts`, `state.ts`, `kit.ts`, `combat.ts`, `units.ts`, `match.ts`, `rules.ts`, `elements.ts`, `fire.ts`, `earth.ts`, `air.ts`, `water.ts` (только заглушка `x` и экспорт), `index.ts`; клиент: `net/protocol.ts`, `sandbox/controls.ts`; названные строки тестов |
| 2. Огонь и Земля: ульты в sim | 2 | `packages/sim/src/match/ultFireEarth.test.ts` | `match/fire.ts`, `match/earth.ts` (только они) |
| 3. Воздух и Вода: ульты в sim | 2 | `packages/sim/src/match/ultAirWater.test.ts` | `match/air.ts`, `match/water.ts` (только они) |
| 4. Клиент: ячейка X, заглушки таблиц, сеть v3 | 2 | `hud/ultHud.test.ts` | `hud/combatHud.ts`, `hud/combatHud.css`, `hud/format.ts`, `game/view.ts`, `net/predict.ts`, `sandbox/page.ts`, `feel/effects.ts`, `feel/eventMap.ts`, `audio/recipes.ts`, `hands/gestures.ts`, `hands/airGestures.ts`, `hands/waterGestures.ts`, `fx/decals.ts`, где нужно typecheck — `feel/airFx.ts`, `feel/waterFx.ts`; названные строки тестов |
| 5. Огонь и Земля: вид и звук | 3 | `feel/ultFireEarth.test.ts`, `fx/ultVfx.ts`, `fx/ultVfx.test.ts` | общие таблицы: `feel/effects.ts`, `feel/eventMap.ts`, `audio/recipes.ts`, `fx/presets.ts`, `fx/vfx.ts`, `fx/decals.ts`, `hands/gestures.ts` |
| 6. Воздух и Вода: вид и звук | 3 | `feel/ultAirWater.test.ts` | только файлы Воздуха и Воды: `feel/airIds.ts`, `feel/airFx.ts`, `audio/airRecipes.ts`, `fx/presets.air.ts`, `fx/airVfx.ts`, `hands/airGestures.ts`, то же для `water` |

Пути клиента — от `apps/client/src/`.

---

### Task 1: Контракты sim: слот X, заряд ульты, бит ввода

**Модель:** Opus (контракты для пяти задач и правило заряда).

**НЕ открывать `research/`.**

**Files:**
- Create: `packages/sim/src/match/ult.ts`, `packages/sim/src/match/phase5.test.ts`, `apps/client/src/net/netV3.test.ts`
- Modify (sim): `match/types.ts`, `defs.ts`, `state.ts`, `kit.ts`, `combat.ts`, `units.ts`, `match.ts`, `rules.ts`, `elements.ts`, `index.ts`; в `fire.ts`, `earth.ts`, `air.ts`, `water.ts` — только запись `x` в таблице слотов и (Огонь, Земля) экспорт `FIRE_SIM` / `EARTH_SIM`
- Modify (клиент): `net/protocol.ts`, `sandbox/controls.ts`
- Modify (только названные строки тестов): литералы `ready`/`held`/кнопок в `contracts.test.ts`, `match.test.ts`, `rules.test.ts` — плюс `x`; `net/netV2.test.ts:31–32` (`3`, `"doodlemagic-g3-abcd-host"`), `net/room.test.ts:95–96`, `net/link.test.ts:260, 469` (`g2` → `g3`); литерал ввода в `net/inputQueue.test.ts` — плюс `x: false`

**Interfaces:**
- Consumes: всё из `main`.
- Produces (задачи 2–6 опираются; экспорт из `@doodlemagic/sim`): блоки ниже.

**`types.ts`:**

```ts
/** ЛКМ — атака, Q — приём, E — спасение, C — поле или контроль, X — ульта (GDD 2.2). */
export type Slot = "primary" | "q" | "e" | "c" | "x";
export const SLOTS: readonly Slot[] = ["primary", "q", "e", "c", "x"];
export const ABILITY_IDS = [
  "fireFists", "fireball", "jetDash", "fireWall",
  "stoneShot", "stonePillar", "stoneWall", "earthquake",
  "airSickle", "gust", "swoop", "tornado",
  "waterWhip", "waterGrab", "waterWard", "spring",
  "dragonBreath", "tectonicRift", "hurricane", "tsunami",
] as const;
/** Ульты по стихиям в порядке ELEMENTS. */
export const ULT_IDS = ["dragonBreath", "tectonicRift", "hurricane", "tsunami"] as const;
export type UltId = (typeof ULT_IDS)[number];
export interface MatchInput extends PlayerInput { primary: boolean; q: boolean; e: boolean; c: boolean; x: boolean }
// Buttons = Pick<MatchInput, Slot> — теперь с x

export type ZoneKind = "fireWall" | "fireTrail" | "pillar" | "quake" | "tornado" | "fireTornado" | "sandTornado" | "spring" | "steam" | "bog" | "rift" | "tsunami";
export type RejectReason = "cooldown" | "busy" | "notGrounded" | "noTarget" | "rooted" | "uncharged";

/** Идущая ульта: телеграф до releaseTick, действие до endTick (stepUlts снимает на endTick); zone — её зона или NOBODY. */
export interface UltCast { ability: UltId; startTick: number; releaseTick: number; endTick: number; zone: number }
/** Ульта (X, GDD 3): заряд 0…100 (дробный) и идущий каст. */
export interface UltState { charge: number; cast: UltCast | null }
// MageState: + ult: UltState;   (createMageUnit: { charge: 0, cast: null })
// Unit: + /** Кто бил за последние 5 с (помощь, Р1): по одной записи на юнита, tick — последний удар. */
//         hitters: { unit: UnitId; tick: number }[];   ([])

// MatchEvent — новый вид:
  /** Ульта: ready — заряд дошёл до 100; release — конец телеграфа; end — каст снят (кончился или маг умер). */
  | { type: "ult"; unit: UnitId; ability: UltId; phase: "ready" | "release" | "end"; pos: Vec3; dir: Vec3 }

// MatchContext: + /** Множитель заряда ульты (Р12): полигон 10, нет поля — 1. */ readonly ultChargeMul?: number;
// TickCtx:      + readonly ultChargeMul: number;
```

**`defs.ts`:**

```ts
/** Заряд ульты (GDD 3, Р1). */
export const ULT_CHARGE = { max: 100, dealtPer: 15, takenPer: 30, kill: 6, assist: 3, passiveEveryS: 6, assistS: 5 } as const;
// KNOCKBACK: + ultCapMul: 1.5   (Р4)

// FIRE: + dragonBreath (Р6)
dragonBreath: { slot: "x", name: "Дыхание дракона", windupS: 0.6, channelS: 3, rangeM: 12, halfAngleDeg: 15, pulseTicks: 10, pulseDamage: 7.5, runMul: 0.6 },
// EARTH: + tectonicRift (Р7)
tectonicRift: {
  slot: "x", name: "Тектонический разлом", telegraphS: 0.8, startM: 1.5, lengthM: 25, halfWidthM: 1.5, belowM: 1.5, aboveM: 2,
  damage: 100, knockback: { distM: 1, upM: 5 }, spikesS: 6, spikesHalfWidthM: 0.75, spikesDamage: 20, spikesKnock: { distM: 3, upM: 0 }, spikesRehitS: 1,
},
// AIR: + hurricane (Р8)
hurricane: { slot: "x", name: "Ураган", windupS: 0.8, runMul: 0.5, radiusM: 10, halfHeightM: 4, damage: 60, knockback: { distM: 16, upM: 2 }, edgeKnockMul: 0.5, selfLiftM: 3, terrainDamage: 1000 },
// WATER: + tsunami (Р9)
tsunami: { slot: "x", name: "Цунами", growS: 0.8, backM: 2, widthM: 14, depthM: 2, belowM: 1, heightM: 2.5, speed: 15, travelM: 30, damage: 80, knockback: { distM: 10, upM: 1 } },

// ABILITY_OF: fire.x "dragonBreath", earth.x "tectonicRift", air.x "hurricane", water.x "tsunami"
// ABILITY_NAME: четыре имени = ELEMENT_INFO[el].ult; SLOT_CHARGES: x — 0; slotCooldownTicks(el, "x") — 0
/** Способность — ульта (порог толчка ×1,5, свой урон не копит заряд). "burning" — нет. */
export function isUlt(a: DamageSource): a is UltId;
/** Как ульта двигает своего мага: бег ×runMul и без прыжка, до releaseTick ("release") или до конца каста ("end"). */
export const ULT_MOVE: Readonly<Record<UltId, { runMul: number; noJump: boolean; until: "release" | "end" }>>;
// dragonBreath { 0.6, true, "end" }; tectonicRift { 1, false, "release" }; hurricane { 0.5, true, "release" }; tsunami { 1, false, "release" }
/** Тайминг каста в тиках: телеграф и сколько длится после него (ult.cast.endTick = now + windup + active). */
export const ULT_TIMING: Readonly<Record<UltId, { windupTicks: number; activeTicks: number }>>;
// dragonBreath 36 / 180; tectonicRift 48 / 1; hurricane 48 / 1; tsunami 48 / 1  (зоны Разлома и Цунами живут дольше каста)
```

**`ult.ts` (новый):**

```ts
/** Прибавить заряд: points × t.ultChargeMul, не выше 100; переход через 100 — событие ult/ready. Мёртвым тоже (Р2). */
export function gainUlt(t: TickCtx, u: Unit, points: number): void;
/** Зовёт applyHit после HP: источнику-магу amount/15 (не за урон ульт), цели-магу amount/30; запись hitters цели. */
export function ultOnDamage(t: TickCtx, src: Unit | undefined, target: Unit, ability: DamageSource, amount: number): void;
/** Убийство (applyHit) или засчитанный сброс (units.ts): убийце +6; каждому из hitters цели за ≤ 300 тиков, кроме убийцы и цели, +3; hitters = []. */
export function ultOnKill(s: MatchState, t: TickCtx, victim: Unit, killer: UnitId): void;
/** TryCast слота X стихии: заряд < 100 → "uncharged"; замах, рывок, диск или идёт ульта → "busy"; иначе charge = 0, cast по ULT_TIMING, emitCast(slot "x"), null. */
export function startUlt(t: TickCtx, u: Unit, inp: MatchInput, ability: UltId): RejectReason | null;
/** stepMatch, после input китов и до их tick: живым +1 при now % 360 === 0; cast и (маг мёртв или now ≥ endTick) → ult/end, cast = null; now === releaseTick → ult/release (глаза, прицел из ввода). */
export function stepUlts(s: MatchState, t: TickCtx, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>): void;
```

Поведение общих мест:
- `kit.ts` `castSlots`: слот ≠ `x` при `m.ult.cast` — отказ `busy` без вызова каста; `legalAt`: `busy` учитывает `ult.cast.endTick`, `uncharged` → `null` (отказ сразу).
- `combat.ts` `applyHit`: пороги `maxSideM`/`maxUpM` × `ultCapMul`, если `isUlt(ability)`; после HP — `ultOnDamage`; в ветке смерти — `ultOnKill(s, t, u, h.source)`.
- `units.ts`: засчитанный сброс — `ultOnKill(s, t, u, credit)`; маг с `ult.cast` по `ULT_MOVE` (до `releaseTick` или `endTick`): бег × `runMul`, прыжок снят из ввода; `respawned` — `hitters = []`, `ult` сохраняется (каст уже снят).
- `match.ts`: в ввод `x: raw.x === true`, `pressed`/`held` с `x`; `stepUlts` между циклом `input` и циклом `tick`; `TickCtx.ultChargeMul = ctx.ultChargeMul ?? 1`; `respawnMage` — заряд прежний, если стихия та же, иначе 0.
- `rules.ts` `setElement`: мёртвый — `ready` с `x: 0`, `ult = { charge: 0, cast: null }` (Р2); свежий маг — 0 сам.
- `elements.ts`: `fire: FIRE_SIM, earth: EARTH_SIM` (`export const FIRE_SIM: ElementSim = Object.freeze({ kit: FIRE_KIT })` в `fire.ts`, так же `EARTH_SIM` в `earth.ts`) — задача 2 добавит им `zones`.
- Заглушки X во всех четырёх китах: `x: (s, t, u, inp) => startUlt(t, u, inp, "<ульта стихии>")` — каст, трата заряда и события работают, действия ещё нет.
- `index.ts`: экспорт `./ult`, `ULT_IDS`, `isUlt`, `ULT_CHARGE`, `ULT_MOVE`, `ULT_TIMING`.

Клиент (только ввод и протокол):
- `net/protocol.ts`: `NET_VERSION = 3`; `BIT.x = 32`; `BUTTONS_MAX = 63`; упаковка и распаковка `x`.
- `sandbox/controls.ts` `buildMatchInput`: `x: down.has(KEYS.ult)`.

- [ ] **Step 1: Тесты (`phase5.test.ts`, `netV3.test.ts`), увидеть падение:**
  - Контракты: `SLOTS` из пяти; `ABILITY_IDS` — 20 без повторов; `ABILITY_OF[el].x` = `ULT_IDS[i]`; имена ульт = `ELEMENT_INFO.ult`; карточки ульт закреплены числами выше; `isUlt`; телеграфы: Дыхание ≥ 0,6 с, прочие ≥ 0,8 с; `ULT_TIMING` = 36/180, 48/1 ×3; свежий маг — `ult {0, null}`, `hitters []`.
  - Заряд: 30 урона по манекену → источнику +2; цели-магу 30 → +1; урон `"burning"` копит хозяину Горения; урон ульты источнику не копит, цели — копит; убийство +6; помощь +3 бившему за 4,9 с, бившему 5,1 с назад — 0, убийце помощи нет; сброс с засчитыванием — +6 и помощь; пассивно +1 на тике 360·k живому, мёртвому нет; не выше 100; `ult/ready` один раз при переходе; `ultChargeMul 10` — ×10.
  - Смерть и смена: заряд 70 переживает смерть и возрождение; `setElement` мёртвого — 0; `respawnMage` той же стихией — 70, другой — 0.
  - X: заряд 99 — `reject uncharged` на тике нажатия, буфера нет; 100 — `cast {slot "x"}`, заряд 0, `ult.cast` по таймингу; `ult/release` на `releaseTick`, `ult/end` на `endTick`; во время каста ЛКМ/Q/E/C — `busy` и ждут буфер; смерть посреди каста — `ult/end` на следующем тике; маг Огня в касте бежит ×0,6 и не прыгает до конца, Воздух — ×0,5 до выпуска, Земля и Вода — как обычно.
  - Порог: толчок ульты `{20, 10}` по манекену даёт `knock {18, 9}`, не-ульты — `{12, 6}`.
  - Сеть (`netV3.test.ts`): `NET_VERSION` 3; `gamePeerId("ABCD")` — `doodlemagic-g3-abcd-host`; `x` проходит упаковку туда и обратно; кнопки 63 — принимаются, 64 и −1 — `null`; `buildMatchInput` с `KeyX` — `x: true`.
  - Детерминизм: 600 тиков, четыре мага с полным зарядом жмут X, дважды — одинаковый `JSON.stringify`.
- [ ] **Step 2: Реализовать** всё выше; поправить только названные строки старых тестов. `pnpm test` (1168 + новые) и `pnpm --filter @doodlemagic/sim typecheck` зелёные. Клиентский typecheck красный — чинит задача 4.
- [ ] **Step 3: Commit** `feat(sim,client): phase 5 contracts: X slot, ult charge per GDD, ult cast lifecycle, net v3 input bit`.

---

### Task 2: Огонь и Земля: ульты в sim

**Модель:** Opus (сила и честность ульт — ощущение боя).

**НЕ открывать `research/`.**

**Files:** Modify `packages/sim/src/match/fire.ts`, `packages/sim/src/match/earth.ts` (только они); Create `packages/sim/src/match/ultFireEarth.test.ts`.

**Interfaces:**
- Consumes (задача 1 и прежнее): `FIRE.dragonBreath`, `EARTH.tectonicRift`, `startUlt`, `UltCast`, `applyHit`, `wardFaces`, `castAim`, `forwardXZ`, `raycast` (`shot`), `spawnZone`, `zoneTouches`, `groundBelow`, `ElementSim`, `ZoneStep`.
- Produces: `x` китов Огня и Земли; `EARTH_SIM.zones.rift`. Новых событий нет.

Поведение (тики 60 Гц):
- **«Дыхание дракона» (X Огня).** `x` = `startUlt(…, "dragonBreath")`. В `tick` при `c = m.ult.cast`, `c.ability === "dragonBreath"`, `now ≥ c.releaseTick` и `(now − c.releaseTick) % 10 === 0` — импульс по прицелу этого тика: глаза → направление взгляда (3D); цель — живой не-хозяин, центр тела ≤ 12 м от глаз, угол к оси ≤ 15°, луч `shot` от глаз до центра свободен; цель с `wardFaces(цель, направление глаза → цель)` — пропуск; иначе `applyHit({ damage 7.5, ability "dragonBreath", burn: true, dir: горизонталь луча, dot: true })`. 18 импульсов, всего 135 + Горение. Жар во время каста не растёт, перегрев не мешает. «Кураж» (убийство) перезаряжает E как раньше.
- **«Тектонический разлом» (X Земли).** `x`: не на полу (`!onGround` и окно койота закрыто) → `notGrounded` (заряд не тратится — проверка до `startUlt`); `d = forwardXZ(yaw)`; подошва `p`; `a = p + d·1,5`, `b = p + d·26,5` (y = p.y); `startUlt`; зона `rift`: `{ type: "segment", a, b, halfW: 1.5 }`, `armTick = now + 48`, `endTick = armTick + 360`; `ult.cast.zone = id`.
- **Шаг `zones.rift`** (после взвода): на `armTick` — каждый живой не-хозяин на полу, касается отрезка (`zoneTouches`), подошва в `[a.y − 1,5; a.y + 2]` → `applyHit({ 100, ability "tectonicRift", dir: перпендикуляр от линии в сторону цели (на линии — вправо от d), knock {1, 5}, launch: true })`; затем `shape.halfW = 0.75` («шипы»). Дальше каждый тик до `endTick`: касается отрезка с 0,75 и подошва в той же полосе (в воздухе — тоже) → не чаще 60 тиков на юнита (`rehit`) `applyHit({ 20, ability "tectonicRift", dir: от линии, knock {3, 0} })`. Хозяина не трогает. Полоса не коллайдер.
- Всё — в состоянии матча, предсказывается само.

- [ ] **Step 1: Тесты `ultFireEarth.test.ts`, увидеть падение:**
  - Дыхание: телеграф 36 тиков без урона; цель в 8 м по оси — 18 импульсов по 7,5 (×1,15 «В воздухе» не считаем — цель на полу), Горение; цель под 20° от оси или в 13 м — мимо; цель за коробкой — мимо, за Стеной огня — попадает; поворот взгляда ведёт конус; Вода с диском лицом к Огню — без урона, спиной — урон; мокрая цель — сохнет и пар (одно облако на 3 с); маг ×0,6, прыжок не работает до `endTick`; смерть мага посреди потока — импульсы прекращаются; урон Дыхания не копит заряд Огню.
  - Разлом: в воздухе — `reject notGrounded`, заряд 100 остаётся; на полу — зона `rift` 25 м по взгляду под 30° к оси X (не по оси); телеграф 48 тиков; цель на линии в 20 м — 100 урона, «В воздухе», подброс ≈ 5 м; цель в прыжке над линией — не задета; цель в 2 м сбоку от линии — мимо; Земля-цель — подброс 2,5 м; после удара касание полосы — 20 и уход ≥ 2,5 м вбок, повтор не раньше 60 тиков; через 6 с зона уходит (`zone end`).
  - Детерминизм: 600 тиков Огонь и Земля с ультами против манекенов дважды — одинаковый `JSON.stringify`.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm --filter @doodlemagic/sim typecheck` зелёные.
- [ ] **Step 3: Commit** `feat(sim): Fire dragon breath and Earth tectonic rift ultimates`.

---

### Task 3: Воздух и Вода: ульты в sim

**Модель:** Opus (сбросы и волна — честность под пингом).

**НЕ открывать `research/`.**

**Files:** Modify `packages/sim/src/match/air.ts`, `packages/sim/src/match/water.ts` (только они); Create `packages/sim/src/match/ultAirWater.test.ts`.

**Interfaces:**
- Consumes: `AIR.hurricane`, `WATER.tsunami`, `startUlt`, `applyHit`, `endZone`, `spawnSteam`, `damageTerrain`, `raycast` (`shot`), `zoneTouches`, `forwardXZ`, прежние хуки стихий.
- Produces: `x` китов Воздуха и Воды; `WATER_SIM.zones.tsunami`. Новых событий нет (`blown`, `reaction steam` — уже есть).

Поведение:
- **«Ураган» (X Воздуха).** `x` = `startUlt(…, "hurricane")`. На `releaseTick` в `tick`, центр — центр тела мага `C`:
  1. Цели: живой не-хозяин, центр по XZ ≤ 10 м, `|Δy| ≤ 4` → `applyHit({ 60, ability "hurricane", dir: от C по XZ (в центре — по взгляду), knock { distM: 16 × (1 − 0,5 × d/10), upM: 2 }, launch: true })`. Без луча: ветер огибает укрытия.
  2. Чужие снаряды в сфере 10 м — удалить без взрыва, событие `blown` (как Порыв).
  3. Чужие зоны, у которых точка (центр диска, середина отрезка, центр бокса) по XZ ≤ 10 м и `|Δy| ≤ 4` — `endZone`.
  4. Чужой рельеф (стены, столбы), бокс которого ближе 10 м по XZ к C — `damageTerrain(1000)`.
  5. Маг: `vel.y = max(vel.y, √(2·20·3))`, `onGround = false`, `flight = { doubleJumped: true, glideTicks: 0, gliding: false }` — свежие 3 с парения с зажатым прыжком.
- **«Цунами» (X Воды).** `x`: `d = forwardXZ(yaw)`, `n = (−d.z, d.x)`, `O = подошва − d·2`; `startUlt`; зона `tsunami`: `{ type: "segment", a: O − n·7, b: O + n·7, halfW: 1 }`, `armTick = now + 48`, `endTick = armTick + 120`; `ult.cast.zone = id`. Ход волны отдельно не хранится: `n = (b − a) / 14`, `d = (n.z, −n.x)`; точка старта `O` = середина `ab` − `d·0,25·(now − armTick)`, `O.y = a.y` (всё — из зоны: модульного состояния в sim нет).
- **Шаг `zones.tsunami`** (после взвода): каждый тик `a`, `b` += `d·0,25` (15 м/с). Юнит: живой не-хозяин, ещё не битый этой волной (`rehit` до `endTick`), `zoneTouches`, подошва в `[O.y − 1; O.y + 2,5]`, луч `shot` от точки старта `O + n·s` (s — его боковая координата, clamp ±7) на высоте `O.y + 1,25` до центра тела свободен → `applyHit({ 80, ability "tsunami", dir: d, knock {10, 1} })` (Мокрый и пар — уже в `applyHit` по стихии Воды). Зоны `fireWall`, `fireTrail`, `fireTornado`, которых касается волна (точка зоны в полосе волны) — `endZone` и `spawnSteam` в их точке, хозяин — Вода.
- Всё — в состоянии матча, предсказывается само.

- [ ] **Step 1: Тесты `ultAirWater.test.ts`, увидеть падение:**
  - Ураган: замах 48 тиков, маг ×0,5 без прыжка; цель в 2 м — 60 урона, уходит ≈ 15 м (порог 18 не срезает), «В воздухе»; в 9 м — ≈ 8,8 м; в 11 м или на 5 м выше — мимо; Земля — вдвое; в иммунитете вбок полностью; под диском Отражения — урон есть, толчка нет; чужой шар и Смерч рядом — `blown` и `zone end`, свой Смерч — стоит; чужая стена Земли в 6 м — `terrain break`; маг поднят ≈ 3 м и парит до 180 тиков с зажатым прыжком; сброс с моста засчитан Воздуху (+6 к заряду).
  - Цунами: телеграф 48; волна проходит 30 м за 120 тиков; цель в 10 м перед Водой — 80 урона, мокрая, уходит ≈ 10 м по ходу; бьёт один раз; цель за коробкой относительно старта — мимо; на 3 м выше — мимо; горящая — Горение снято и пар; Стена огня на пути — `zone end` и пар; Земля — 5 м; Воду-хозяина не трогает.
  - Детерминизм: 600 тиков Воздух и Вода с ультами против Огня дважды — одинаковый `JSON.stringify`.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm --filter @doodlemagic/sim typecheck` зелёные.
- [ ] **Step 3: Commit** `feat(sim): Air hurricane and Water tsunami ultimates`.

---

### Task 4: Клиент: ячейка X, заглушки таблиц, сеть v3

**Модель:** Opus (общие таблицы и HUD — ничего не сломать).

**НЕ открывать `research/`.** Визуал и звук ульт — не здесь (задачи 5–6); здесь только заглушки и общий слой.

**Files:**
- Create: `hud/ultHud.test.ts`
- Modify: `hud/combatHud.ts`, `hud/combatHud.css`, `hud/format.ts`, `game/view.ts`, `net/predict.ts`, `sandbox/page.ts`
- Modify (заглушки — одна запись на ключ): `feel/effects.ts`, `feel/eventMap.ts`, `audio/recipes.ts`, `hands/gestures.ts`, `hands/airGestures.ts`, `hands/waterGestures.ts`, `fx/decals.ts`; `feel/airFx.ts`, `feel/waterFx.ts` — только если их таблицы требует typecheck
- Modify (только названные строки тестов): литералы ввода `MatchInput` в `net/*.test.ts` — плюс `x: false`

**Interfaces:**
- Consumes: задача 1 (`Slot "x"`, `ULT_IDS`, `isUlt`, событие `ult`, `reject uncharged`, `mage.ult`, `ultChargeMul`).
- Produces (задачи 5–6 наполняют по этим именам):

```ts
// feel/effects.ts: SOUND_IDS += "ultWarn", "ultReady"   (общие; рецепты-заглушки, финал — задача 5)
// hud/format.ts
/** Доля заряда ульты 0…1 для кольца X. */
export function ultFraction(m: MageState): number; // min(1, charge / 100)
```

Поведение:
- **Ячейка X** (`combatHud.ts`): ячейка «скоро» убрана; X — пятая ячейка из цикла `SLOTS`, подпись `X`, имя `ELEMENT_INFO[e].ult`. Кольцо (тот же `ensoSvg`) заполняется по `ultFraction`, под ним целое число `N%` (до 100). Полная — класс `is-ult-ready`: ярче, медленная пульсация 1,2 с (CSS, гасится настройкой «Движение камеры» как прочие анимации, если такая связь уже есть). Идёт своя ульта — `is-active`. Отказ `uncharged` → существующий эффект `deny` на ячейке X (тот же путь, что у прочих слотов).
- `game/view.ts`: обработчик `KEYS.ult` с тостом «— скоро» удалён (X уходит в ввод через `buildMatchInput`).
- `net/predict.ts`: литералы ввода с `x: false`; `eventKey`: `ult:unit:ability:phase`.
- `sandbox/page.ts`: `{ ...matchContext(arena), ultChargeMul: 10 }` (Р12).
- `feel/eventMap.ts`: заглушки ульт в `CAST_SOUND` (существующий звук каста C своей стихии); `hitTier`: `isUlt(ev.ability)` → `"large"`; в `effectsFor` до `elementEffects`: событие `cast` со `slot === "x"` от чужого мага → звук `ultWarn` без позиции (на всю карту), от своего — нет (своё оформляет стихия); `ult/ready` своего — звук `ultReady` и толчок HUD-ячейки; событие `ult` прочих фаз и чужих — `[]`.
- `audio/recipes.ts`: заглушки `ultWarn` (низкий гул 120 → 60 Гц, 0,6 с) и `ultReady` (два щелчка 1,5 кГц, 0,2 с), подписи.
- Жесты-заглушки ульт: копия жеста C своей стихии (`gestures.ts` — Огонь, Земля; `airGestures.ts` / `waterGestures.ts` — расширить ключи до `"hurricane"` / `"tsunami"`). `decals.ts` `STYLE`: `rift: null`, `tsunami: null`.
- Килфид и экран смерти (`pvp/format.ts` не меняется) — только тест: смерть от `"tsunami"` даёт «Цунами», от `"dragonBreath"` — «Дыхание дракона».

- [ ] **Step 1: Тесты `hud/ultHud.test.ts`:** `ultFraction` 0 / 0,5 / 1 (и 1 при 100+); ячейка X — пять ячеек, имя ульты по стихии, класс `is-ult-ready` при 100, текст `73%` при 73,4; `reject {slot x, uncharged}` → `deny` на X; `eventKey` события `ult`; чужой `cast x` → `ultWarn` без позиции, свой — нет; `hitTier` ульты — `large`; `feedLine` / `deathLine` с именами ульт; у каждой способности есть жест, у каждого вида зоны — запись стиля.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные. Полигон: заряд растёт (×10), кольцо заполняется, X на неполном — отказ на ячейке, на полном — каст (действие ульт — по мере слияния задач 2–3).
- [ ] **Step 3: Commit** `feat(client): X slot with ult charge ring and deny, ult registries, net v3 event keys`.

---

### Task 5: Огонь и Земля: вид и звук ульт

**Модель:** Opus (читаемость телеграфа и «вес» крупной ступени).

**НЕ открывать `research/`.** Файлы Воздуха и Воды не трогать.

**Files:** Create `fx/ultVfx.ts` (меши ульт Огня и Земли: конус Дыхания, линия и шипы Разлома — `InstancedMesh`, ≤ +2 вызова на стихию), `fx/ultVfx.test.ts`, `feel/ultFireEarth.test.ts`; Modify `feel/effects.ts`, `feel/eventMap.ts`, `audio/recipes.ts`, `fx/presets.ts`, `fx/vfx.ts` (создать и звать `ultVfx` как `ELEMENT_VFX`: `apply` / `sync` / `setPreset` / `dispose`), `fx/decals.ts` (`rift` — стиль трещины), `hands/gestures.ts`.

**Interfaces:** Consumes — задачи 1, 2, 4; ступени ощущения (`TIERS.large`: trauma 0,8 у кастующего, толчок 2°, FOV +10°, пауза цели 90 мс, вспышка 130 мс, хитмаркер 0,35 с, `kill` + низкий удар + реверб 0,35, 100–150 частиц + декаль + тост — `design/round3/01-game-feel-pass.md` 2.1). Produces — содержимое своих таблиц; финальные рецепты `ultWarn`, `ultReady`.

Что видно и слышно:
- **Общее (для всех четырёх стихий):** `ultWarn` — «ульта!» на всю карту, один общий звук без подписи стихии: низкий нарастающий гул 120 → 60 Гц с шорохом сверху, 0,6 с; `ultReady` — короткий звон-«щелчок» своему, 0,2 с.
- **Дыхание:** вдох 0,6 с — `breathInhale` (втягивание: шум lowpass 600 → 3000 Гц, 0,6 с), руки разгораются (жест: обе руки к груди, затем вперёд); поток — конус пламени по взгляду (частицы огня ≤ 90/с по конусу + свечение со светом огня 7,5 м по пресету), зёрна `breathRoar` 0,4 с раз в 0,3 с (рёв 2–6 кГц с телом 150 Гц), у своего — тряска trauma 0,3 на весь поток и FOV +4°; попадание — малая вспышка огня на цели не чаще 3/с. Чужое Дыхание видно с любого угла: конус рисуется по `ult.cast` и взгляду мага.
- **Разлом:** с каста вся линия 25 × 3 м — тёмная трещина-декаль (`rift`), по ней за 0,8 с бежит светлый фронт с пылью; `riftRumble` (30–200 Гц, 0,8 с); удар — шипы вырастают по всей линии за 0,1 с (`ultVfx`, инстансы), `riftStrike` (низкий удар + каменный хруст), камера кастующего и задетых — крупная ступень, профиль Земли (вниз); 6 с шипы стоят и тают в последние 0,5 с.
- Хиты ульт — крупная ступень (`hitTier` уже `large`), тост убийцы «Дыхание дракона!» / «Разлом!» при убийстве ультой.
- Звуки — ≤ 0,8 с каждый, Огонь в 2–8 кГц, Земля в 30–200 Гц.

- [ ] **Step 1: Тесты:** события Огня и Земли (`cast x`, `ult` release/end, `hit` ульт, `zone rift` telegraph/arm/end) → ожидаемые эффекты, свои и чужие; чужое — только мир и звук в точке плюс `ultWarn`; зёрна `breathRoar` не чаще раза в 0,3 с; `ultVfx` — конус живёт ровно `ult.cast` от `releaseTick` до `endTick`, шипы — от `armTick` до `endTick`, ≤ +2 вызова на стихию; у новых id есть рецепт ≤ 0,8 с, подпись и слои ≤ 150.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные. Полигон Огнём и Землёй: Дыхание и Разлом по манекенам видны и слышны; в бою ≤ 40 вызовов.
- [ ] **Step 3: Commit** `feat(client): dragon breath and tectonic rift look and sound, shared ult warning`.

---

### Task 6: Воздух и Вода: вид и звук ульт

**Модель:** Opus (читаемость и звук стихии).

**НЕ открывать `research/`.** Общие файлы не править: всё — в файлах Воздуха и Воды, зарегистрированных в фазе 4 и задачей 4. Нужна правка общего — сообщить контролёру.

**Files:** Modify `feel/airIds.ts`, `feel/airFx.ts`, `audio/airRecipes.ts`, `fx/presets.air.ts`, `fx/airVfx.ts`, `hands/airGestures.ts`, `feel/waterIds.ts`, `feel/waterFx.ts`, `audio/waterRecipes.ts`, `fx/presets.water.ts`, `fx/waterVfx.ts`, `hands/waterGestures.ts`; Create `feel/ultAirWater.test.ts`.

**Interfaces:** Consumes — задачи 1, 3, 4; `airFrame` / `waterFrame` (кадровые хуки фазы 4), крупная ступень. Produces — содержимое своих файлов. `ultWarn` и `ultReady` — общие (задача 4/5), здесь не дублировать.

Что видно и слышно:
- **Ураган:** замах 0,8 с — пыль и штрихи `wind` стягиваются к магу по спирали из круга 10 м (по `ult.cast` до `releaseTick`, ≤ 80 частиц/с), свист нарастает 800 → 4000 Гц (`hurricaneWindup`, 0,8 с), руки сведены над головой; выпуск — кольцевой взрыв `hurricaneBlast` (кольцо штрихов 1 → 10 м за 0,25 с, ≤ 150), хлопок `hurricaneBoom` (800–2500 Гц с низким телом без подписи), кастующему — крупная ступень и FOV +10°; жертвам — средняя ступень и «вжух» толчка (уже есть).
- **Цунами:** рост 0,8 с — гребень 14 × 2,5 м за спиной мага (`waterVfx`, инстансы полос гребня + пена `foam`), нарастающий шум `tsunamiRise` (300–1500 Гц); ход — гребень едет по зоне `tsunami` (позиция — `a`, `b` зоны с интерполяцией между тиками), брызги ≤ 60/с, рокот зёрнами `tsunamiRoll` 0,5 с раз в 0,4 с, позиционно; попадание — `tsunamiHit` и всплеск `whipSplash`-класса крупнее (≤ 120), пар на погашенном огне — уже от `reaction steam`.
- Жесты: Ураган — руки вверх и резко в стороны; Цунами — обе руки снизу вверх и вперёд. Тост убийце «Ураган!» / «Цунами!».
- Звуки — ≤ 0,8 с, Воздух 800–4000 Гц, Вода 300–1500 Гц. Бюджет: Воздух и Вода — каждая ≤ +2 вызова сверх фазы 4 на все свои меши.

- [ ] **Step 1: Тесты:** `airEffects` / `waterEffects` для `cast x`, `ult` release/end, `hit` ульты, `zone tsunami` — свои и чужие (чужое — без жестов и камеры); `airFrame` — частицы стяжки только до `releaseTick`; `waterFrame` — зёрна рокота не чаще раза в 0,4 с; гребень совпадает с `a`, `b` зоны; новые id — рецепт, подпись, слои.
- [ ] **Step 2: Реализовать.** `pnpm test`, `pnpm typecheck`, `pnpm build:client` зелёные. Полигон Воздухом и Водой: Ураган у края (сброс манекена) и Цунами по манекенам видны и слышны; в бою ≤ 40 вызовов.
- [ ] **Step 3: Commit** `feat(client): hurricane and tsunami look and sound`.

---

### Task 7: Приёмка, GDD, дорожная карта, деплой (контролёр)

- [ ] Финальное ревью ветки `phase5` (Opus) и мелочи одним исполнителем.
- [ ] Живая проверка во встроенном браузере: полигон всеми четырьмя (заряд ×10, отказ на неполном, все четыре ульты по манекенам); PvP в 2–3 вкладках, одна с `?lag=120&loss=2`: чужая ульта слышна на всей карте, телеграф виден заранее, Ураган и Цунами сбрасывают у края без видимого отката у жертвы (иначе — порог снапа, раздел «Предсказание»), Дыхание в диск Отражения, заряд сохраняется после смерти и сгорает при смене стихии, имена ульт в килфиде и на экране смерти.
- [ ] GDD: 2.2 — ульта на X, порог ×1,5 в коде; 3 — «смена стихии сжигает заряд» (Р2); 4.3 и 4.4 — ульты [фаза 5] с полууглом 15° и полосой шипов (Р6, Р7); 4.5 — карточки Урагана и Цунами из этого плана.
- [ ] Дорожная карта `docs/superpowers/plans/2026-10-17-prototype-roadmap.md`: статус фазы 5, отложенное (Р13).
- [ ] Слить `phase5` в `main`, пуш → автодеплой Vercel, проверить, что сайт отвечает.

## Приёмка фазы

- `pnpm test` (1168 + новые), `pnpm typecheck`, `pnpm build:client` — зелёные.
- X у всех четырёх стихий: заряд по GDD 3 (полигон ×10), кольцо на ячейке, отказ на неполном, каст на полном.
- Каждая ульта читается заранее (≥ 0,6 / 0,8 с) и слышна на всей карте; толчки не выше 18 / 9 м.
- PvP с `?lag=120&loss=2`: свой каст без задержки, чужие ульты и сбросы без видимых откатов; ≤ 40 draw call в бою, 60 FPS на ноутбуке владельца.

## После фазы 5

Отложено: реакции ульт (Дыхание в Смерч → огненный смерч, Цунами в Родник, Ураган по Стене огня → «Огненный вал»), руна ярости и корона лидера (+10 / +15 к ульте), ульт-сферы, твёрдая стена шипов. Если ульты слишком часто — пассив +1 раз в 8 с; если Ураган сбрасывает слишком легко — 16 → 12 м; если Дыхание слабое — полуугол 15° → 20°.
