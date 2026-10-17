# Фаза 2-lite: демо способностей на полигоне. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Параллельная работа.**
> - Задача 1 «Контракты» делается первой и одна.
> - Потом потоки идут параллельно, каждый в своём git worktree (superpowers:using-git-worktrees) от коммита задачи 1. В новом worktree первым делом `pnpm install --frozen-lockfile`: новых зависимостей в этой фазе нет.
> - Поток только создаёт свои файлы и правит те, что названы в его задаче (таблица «Потоки и владение файлами»). Двух потоков на одном файле нет.
> - Задачи 8 и 9 фазы 1 уже в `main` (62dbdac, 249a1a7). Где код в `main` отличается от этого плана в мелочах (имена переменных, порядок строк), прав код в `main`: подстраиваться под него, интерфейсы этого плана не менять.

**Goal:** К утру ссылка, где владелец ходит и прыгает по «Галерее над ущельем», выбирает Огонь или Землю, пробует все 8 способностей и экспериментирует на манекенах. Ощущение важнее всего: попадание читается, отбрасывание приятное, каст мгновенный и мощный.

**Architecture:**
- Способности живут в чистой детерминированной симуляции `packages/sim/src/match/`: состояние матча (юниты-маги и манекены, снаряды, зоны, рельеф) шагает чистой функцией `stepMatch(state, inputs, ctx)` с тиком 60 Гц. Каждый шаг отдаёт список событий; будущий хост сети крутит ту же функцию.
- Рельеф Земли — динамические AABB поверх неизменяемой сетки мира. Их видят `moveBody`, `raycast`, `groundBelow` и `isFree` через одно новое поле `World.dynamic` и одну функцию `colliderAt`.
- Отбрасывание — отдельный канал скорости `kb` с экспоненциальным затуханием. Начальная скорость считается из метров карточки так, чтобы на ровном полу цель проходила ровно `distM`.
- Клиент превращает события в эффекты чистой функцией `effectsFor`, а их — в частицы, звук, тряску, цифры и жесты рук.
- Магия рисуется отдельным проходом света после стилевого прохода (см. решение Р1). Манекены, рельеф и ядра снарядов пишутся в G-буфер своими чернилами.

**Tech Stack:** Node 24, pnpm 12.14, TypeScript 7.0.2 (strict), Vitest 5.0.5, Vite 8.3.4, three.js 0.186.1 (WebGL2), Web Audio. Новых зависимостей нет.

## Global Constraints
- three.js закреплён точно: `three` **0.186.1**, `@types/three` **0.186.0**. Новых пакетов нет, `package.json` и `pnpm-lock.yaml` не меняются.
- Не больше **120** draw call'ов на кадр (цель этой фазы — не больше 40), частицы только в `InstancedMesh`.
- Цель — **60 FPS** на Iris Xe и Vega 8; частиц не больше 600 / 1500 / 3000 на пресетах «Низкое» / «Среднее» / «Высокое».
- Чистота `sim`: `packages/sim` не импортирует three.js и DOM, `lib: ES2022`. Нет `Math.random`, `Date`, `performance`, изменяемого состояния на уровне модулей (кроме уже существующего буфера `scratch` в `body.ts`).
- Детерминизм: `stepMatch` не меняет свои аргументы; одинаковые состояние, ввод и контекст дают одинаковые до байта `JSON.stringify` состояния и событий. Состояние — простые данные: «нет» — `NOBODY` (−1), времена — номера тиков.
- **Чистая комната:** не открывать, не читать и не искать ничего в `D:\Claude Code\MagicGG\research\`. Не переносить код и числа других игр. Все числа — из GDD 4.3–4.4, 2.2, 3, 7.3–7.4, заметок ролей в `design/` или из таблицы решений этого плана.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Автор git уже настроен.
- Тесты арены и фазы 1 остаются зелёными: на старте фазы **412** тестов, ни один прежний тест не правится, кроме названных в задачах (`palette.test.ts`, `controls.test.ts` — только дополняются).
- Интерфейс на русском. Клавиши только по `event.code`, Ctrl/Alt/Cmd ни на что не назначены.

## Покрытие карточек GDD

| Способность (GDD) | Цифры | Где |
|---|---|---|
| Огонь, 150 HP, 6,5 м/с | — | defs (1), units (3) |
| ЛКМ «Огненные кулаки» | 12 урона, 5 выстр/с, снаряд 40 м/с; жар +8, остывает 35/с через 0,3 с; на 100 темп ×0,5 на 1,5 с | defs (1), снаряды (4), кит Огня (5) |
| Q «Огненный шар» | замах 0,25 с; 50 в центре, 20 по краю, радиус 3 м; 22 м/с; Горение 6/с × 3 с; КД 8 с | снаряды (4), кит (5) |
| E «Реактивный рывок» | 8 м за 0,2 с по движению, и в воздухе; след 2 с, 6 урона/с; КД 8 с | зоны (4), кит (5) |
| C «Стена огня» | до 15 м, 10 × 2,5 м, 5 с; искры 0,4 с; проход 30 + Горение; закрывает обзор, снаряды пропускает; КД 12 с | динамика (2), зоны (4), кит (5) |
| Пассивка «Кураж» | убийство снимает жар и перезаряжает E | бой (3) |
| Земля, 170 HP, 6,0 м/с | — | defs (1), units (3) |
| ЛКМ «Каменный снаряд» | 30 урона, 1,9 выстр/с, 40 м/с, лёгкая баллистика, камень 0,5 м, замах 0,2 с | снаряды (4), кит Земли (5) |
| Q «Каменный столб» | 20 м; трещины 0,6 с; 35 урона, подброс 3,5 м («В воздухе»); укрытие 1,2 × 1,2 × 2,5 м, 200 HP, 4 с; под себя — подъём на 2,5 м; КД 10 с | рельеф (2), зоны (4), кит (5) |
| E «Каменная стена» | 2 м перед магом, 4 × 2,5 × 0,6 м; растёт 0,3 с, твёрдая через 0,2 с; 250 HP, 6 с; держит снаряды и проход; КД 12 с | рельеф (2), кит (5) |
| C «Землетрясение» | замах 0,4 с; радиус 7 м: 40 урона + замедление 40 % на 2 с; в 3 м — обездвиживание 0,5 с; не задевает тех, кто в воздухе; КД 14 с | зоны (4), кит (5) |
| Пассивка «Корни» | отбрасывание по Земле ×0,5; Q и C только стоя на полу | бой (3), кит (5) |
| Статусы | Горение; «В воздухе»: без управления 0,3 с, +15 % урона; иммунитет к жёсткому контролю 2 с; замедление ≤ 40 % и ≤ 2 с; обездвиживание ≤ 1 с | бой (3) |
| HP | одна полоса; через 4 с без урона +20/с до ⅔ | бой (3), HUD (7) |
| X (ульта) | вне фазы: значок «скоро» | HUD (7) |

## Решения этого плана (неоднозначности GDD)

| # | Вопрос | Решение | Почему |
|---|---|---|---|
| Р1 | Как рисовать магию в «Туши и свете» | Ядра снарядов, рельеф, манекены — в G-буфер (чернила `magic`, `terrain`, `enemy`, `halo`, `flash`). Свечение, частицы, следы, телеграфы и стена огня — **отдельный проход света** после стилевого прохода, прямо на экран, с ручной проверкой глубины по G-буферу | G-буфер непрозрачный, по одним чернилам на пиксель; стилевой проход обвёл бы каждую частицу. Оранжевый и нефрит заливкой не проходят правило «магия ярче всего» по яркости, а свет поверх бумаги всегда ярче того, что под ним. Над тушью врага свет гасится до ¼: «магический свет на вражескую тушь не падает» (GDD 6). 1 draw call на пул |
| Р2 | Белый ореол врага (GDD 6, «2 px») | Вывернутая оболочка (back faces) каждой части манекена чернилами `halo`, отступ ≈ 2 px по расстоянию | Не трогает стилевой проход (13 выборок уже почти в бюджете) |
| Р3 | Отбрасывание в карточках почти не задано | Канал `kb`, затухание e^(−λt): на полу λ = 6/с, в воздухе 1,5/с (`design/round1/03`). v₀ подбирается так, чтобы на ровном полу путь был ровно `distM` с учётом полёта на `upM`. Числа: кулаки 0,3 м × темп (min(1, 0,2 / 0,5)) = 0,12 м; камень 0,3 м; шар 3 м и 1,2 м вверх в центре, к краю × 0,4; столб 1 м вбок и 3,5 м вверх; землетрясение 0,5 м наружу. Потолок 12 м вбок, 6 м вверх | GDD 2.2: метры в карточке, «сок» ЛКМ ≤ 0,3 м, способностей ≤ 1 м, предел 12/6. Шар — главное оружие сброса в ущелье. Цифры шара и столба вбок — решение плана, крутить на живой проверке |
| Р4 | Где «В воздухе» | Статус ставят только способности с подбросом в карточке (столб). Без управления 0,3 с, +15 % любого урона до приземления. После жёсткого контроля (подброс, обездвиживание) иммунитет 2 с: новый жёсткий контроль не ставится, отбрасывание ×0,5 | GDD 2.2 и рецензия геймдизайнера (`round2/02`, п. 5) |
| Р5 | Мягкий перегрев | Достигли 100 — 1,5 с темп ×0,5; жар за это время линейно падает до 0, выстрелы его не добавляют | Цикл «2,5 с полный темп → 1,5 с половинный» читается на полосе жара |
| Р6 | Стены и прямоугольники в AABB-мире | Стена огня и каменная стена ставятся поперёк взгляда с поворотом к ближайшей оси мира | Коллизии только AABB (GDD 7.4); проходы арены и так вдоль осей |
| Р7 | Не заданы дальности снарядов | Кулаки 24 м, камень 50 м с гравитацией 6 м/с², шар 44 м (2 с) и в конце взрывается. Темп ЛКМ: кулаки 12 тиков, камень 32 тика (1,875/с ≈ 1,9) | Тик целый; «держать дистанцию больше 20 м» против кулаков |
| Р8 | Землетрясение по высоте | Цилиндр r 7 м, разница высот с магом ≤ 1,5 м, только стоящие на полу; обездвиживание — центр тела в 3 м | Галерея +4 м не должна трястись от удара снизу |
| Р9 | Точка под прицелом | Луч из глаз до мира или до тела юнита (тогда — его ступни); от вертикальной грани — 0,3 м назад и вниз до опоры. Столб: площадь удара +0,4 м; «под себя» — если точка ближе 0,9 м к магу | Прицел в манекен ставит столб под манекен, а не за ним |
| Р10 | Горение | 6/с × 3 с импульсами по 3 урона раз в 0,5 с; повтор продлевает, не складывается | GDD: урон по времени камеру не трясёт, цифры суммируются |
| Р11 | Свои эффекты | Своё никогда не ранит кастующего. Рельеф получает урон от любого снаряда, в том числе своего | Один игрок: иначе стену не сломать |
| Р12 | Манекены | 170 HP, через 3 с без урона +85/с до полного, возрождение через 3 с после смерти или сброса, ходят 2 м/с | Правило полигона, не мага: каждый опыт с полного HP |
| Р13 | Засчитывание | Сброс — последнему ударившему за 5 с (GDD 3). «Кураж» — и на убийство, и на засчитанный сброс | Сброс — тоже убийство по счёту GDD |
| Р14 | Перезарядки | Идут с нажатия. Замах (шар, камень) не даёт стрелять ЛКМ, Q и C; E работает всегда | «В беде жми E» |
| Р15 | Рывок | Горизонтально, без гравитации 0,2 с, на выходе скорость бега по направлению; гасит своё отбрасывание | Работает и в воздухе (карточка) |
| Р16 | Рельеф вырос в теле | Выталкивание по кратчайшему свободному пути: вверх, ±x, ±z; вверх — без прибавки к высоте полёта | GDD 7.3 |
| Р17 | Возрождение мага | После сброса через 1 с на точке полигона | Полигон, а не матч |
| Р18 | Удары по себе | Эффекты «попали в меня» (толчок камеры от источника, индикатор, тряска) сделаны и покрыты тестами, но в одиночном демо их источника нет | Манекены не атакуют (решение контролёра) |

## Потоки и владение файлами

Пути без префикса — от `packages/sim/src/match/` (sim) или `apps/client/src/` (клиент).

| Задача | Поток | После | Создаёт / правит |
|---|---|---|---|
| 1. Контракты | одна | — | sim: `types.ts`, `defs.ts`, `state.ts`, `fixtures.ts`, `index.ts`, `contracts.test.ts`; правит `packages/sim/src/index.ts`. Клиент: `feel/effects.ts` |
| 2. Динамические коллайдеры и рельеф | S1 | 1 | sim: `dynamic.ts`, `terrain.ts`, `dynamic.test.ts`, `terrain.test.ts`; правит `packages/sim/src/{world,body,raycast}.ts` |
| 3. Бой: урон, отбрасывание, статусы, жизнь | S2 | 1 | sim: `combat.ts`, `units.ts`, `combat.test.ts`, `units.test.ts` |
| 4. Снаряды, зоны, прицел, шаг матча | S | 2 и 3 | sim: `projectiles.ts`, `zones.ts`, `aim.ts`, `kit.ts`, `fire.ts` (заглушка), `earth.ts` (заглушка), `match.ts` и их тесты; правит `index.ts` |
| 5. Киты Огня и Земли | S (5F ∥ 5E) | 4 | 5F: `fire.ts`, `fire.test.ts`; 5E: `earth.ts`, `earth.test.ts`; после обоих — `determinism.test.ts` |
| 6. Рендер магии, манекены, рельеф | V | 1 | клиент: `fx/*`; правит `render/{palette,palette.test,gbuffer,styleRenderer}.ts`, `main.ts` |
| 7. Ощущение, HUD, руки, ввод | H | 1 | клиент: `feel/{eventMap,camera}.ts`, `hud/*`, `hands/gestures.ts` и тесты; правит `hands/mittens.ts`, `sandbox/{controls,controls.test,input}.ts` |
| 8. Синтез звука (необязательная) | A | 1 | клиент: `audio/*` |
| 9. Полигон, интеграция, приёмка | одна | 5, 6, 7 (и 8, если готова) | `packages/arena/src/{training,training.sim.test}.ts`, правит `packages/arena/src/index.ts`; клиент: правит `sandbox/{page,hud}.ts` и `sandbox/sandbox.css`; дорожная карта |

**Порядок:** 1 → (S1: 2 ∥ S2: 3 ∥ V: 6 ∥ H: 7 ∥ A: 8) → 4 → (5F ∥ 5E) → слить S, V, H, A в `main` → 9. Конфликтов быть не должно; после каждого слияния `pnpm test` и `pnpm typecheck` зелёные.

Оценка по часам: 1 — 0,7; 2 — 1; 3 — 1,25; 4 — 1,25; 5 — 0,75 (две половины параллельно); 6 — 2,5; 7 — 2; 8 — 0,75; 9 — 1. Критический путь 1 → 3 → 4 → 5 → 9 ≈ 5 ч.

---

### Task 1: Контракты

**Поток:** одна, первой.

**Files:**
- Create: `packages/sim/src/match/{types,defs,state,fixtures,index}.ts`, `packages/sim/src/match/contracts.test.ts`, `apps/client/src/feel/effects.ts`
- Modify: `packages/sim/src/index.ts` (добавить `export * from "./match";`)

**Interfaces:**
- Consumes: из `../types` — `AABB`, `PlayerInput`, `PlayerState`, `Spawn`, `Vec3`, `Collider`, `Volume`, `TICK_HZ`, `EYE_HEIGHT`; из `../world` — `World`, `createWorld`; из `../player` — `createPlayer`, `forwardXZ`; из `../aabb` — `aabb`.
- Produces: всё ниже дословно. Последующие задачи импортируют из `./types`, `./defs`, `./state`, `./fixtures`.

- [ ] **Step 1: Написать падающий тест**

`packages/sim/src/match/contracts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ABILITY_OF, CC_LIMITS, DUMMY, EARTH, ELEMENT_INFO, FIRE, KNOCKBACK, MAGE_REGEN, STATUS, TELEGRAPH_MIN_S, slotCooldownTicks, ticks } from "./defs";
import { aimDir, clonePlain, createDummyUnit, createMageUnit, createMatchState, rightXZ, statusFlags, unitById } from "./state";
import { ABILITY_IDS, ELEMENTS, SLOTS } from "./types";

describe("ability tables follow GDD 4.3–4.4", () => {
  it("pins the Fire card", () => {
    expect([FIRE.hp, FIRE.runSpeed, FIRE.fireFists.damage, FIRE.fireFists.ratePerS, FIRE.fireFists.projectile.speed]).toEqual([150, 6.5, 12, 5, 40]);
    expect(FIRE.heat).toEqual({ perShot: 8, max: 100, coolPerS: 35, coolDelayS: 0.3, overheatS: 1.5, overheatRateMul: 0.5 });
    expect(FIRE.fireball).toMatchObject({ cooldownS: 8, windupS: 0.25, damageCenter: 50, damageEdge: 20, radiusM: 3, projectile: { speed: 22 } });
    expect(FIRE.jetDash).toMatchObject({ cooldownS: 8, distM: 8, durationS: 0.2, trailS: 2, trailDps: 6 });
    expect(FIRE.fireWall).toMatchObject({ cooldownS: 12, rangeM: 15, lengthM: 10, heightM: 2.5, lifeS: 5, telegraphS: 0.4, contactDamage: 30 });
  });

  it("pins the Earth card", () => {
    expect([EARTH.hp, EARTH.runSpeed, EARTH.passive.knockbackMul]).toEqual([170, 6, 0.5]);
    expect(EARTH.stoneShot).toMatchObject({ damage: 30, ratePerS: 1.9, windupS: 0.2, projectile: { speed: 40, radiusM: 0.25 } });
    expect(EARTH.stonePillar).toMatchObject({ cooldownS: 10, rangeM: 20, telegraphS: 0.6, damage: 35, sizeM: 1.2, heightM: 2.5, hp: 200, lifeS: 4, selfLiftM: 2.5, knockback: { upM: 3.5 } });
    expect(EARTH.stoneWall).toMatchObject({ cooldownS: 12, aheadM: 2, lengthM: 4, heightM: 2.5, thickM: 0.6, growS: 0.3, solidS: 0.2, hp: 250, lifeS: 6 });
    expect(EARTH.earthquake).toMatchObject({ cooldownS: 14, telegraphS: 0.4, radiusM: 7, damage: 40, slowMul: 0.6, slowS: 2, rootRadiusM: 3, rootS: 0.5 });
  });

  it("pins statuses, regen and dummies", () => {
    expect([STATUS.burning, STATUS.airborne, STATUS.hardCcImmunityS]).toEqual([{ dps: 6, durationS: 3, pulseS: 0.5 }, { noControlS: 0.3, damageMul: 1.15 }, 2]);
    expect([MAGE_REGEN, DUMMY.hp]).toEqual([{ delayS: 4, perS: 20, capFrac: 2 / 3 }, 170]);
  });

  it("keeps every telegraph ≥ 0.4 s, control within the GDD limits and knockback within the caps", () => {
    for (const s of [FIRE.fireWall.telegraphS, EARTH.stonePillar.telegraphS, EARTH.earthquake.telegraphS]) expect(s).toBeGreaterThanOrEqual(TELEGRAPH_MIN_S);
    expect([EARTH.earthquake.rootS <= CC_LIMITS.rootMaxS, 1 - EARTH.earthquake.slowMul <= CC_LIMITS.slowMaxFrac + 1e-12, EARTH.earthquake.slowS <= CC_LIMITS.slowMaxS]).toEqual([true, true, true]);
    for (const k of [FIRE.fireFists.knockback, FIRE.fireball.knockback, EARTH.stoneShot.knockback, EARTH.stonePillar.knockback, EARTH.earthquake.knockback]) {
      expect([k.distM <= KNOCKBACK.maxSideM, k.upM <= KNOCKBACK.maxUpM]).toEqual([true, true]);
    }
    expect(Math.max(FIRE.fireFists.knockback.distM, EARTH.stoneShot.knockback.distM)).toBeLessThanOrEqual(KNOCKBACK.juicePrimaryMaxM);
    expect(Math.max(EARTH.earthquake.knockback.distM, EARTH.stonePillar.knockback.distM)).toBeLessThanOrEqual(KNOCKBACK.juiceAbilityMaxM);
  });

  it("maps every slot of both elements to its own ability", () => {
    const ids = ELEMENTS.flatMap((e) => SLOTS.map((s) => ABILITY_OF[e][s]));
    expect([...ids].sort()).toEqual([...ABILITY_IDS].sort());
    expect([ELEMENT_INFO.fire.name, ELEMENT_INFO.earth.motto]).toEqual(["Огонь", "Строй стены, бей тяжело, стой насмерть"]);
  });

  it("converts seconds to whole ticks", () => {
    expect([ticks(0.25), ticks(0.2), ticks(0.4), ticks(1.5)]).toEqual([15, 12, 24, 90]);
    expect([slotCooldownTicks("fire", "primary"), slotCooldownTicks("earth", "primary"), slotCooldownTicks("fire", "q"), slotCooldownTicks("earth", "c")]).toEqual([12, 32, 480, 840]);
  });
});

describe("match state", () => {
  const mage = createMageUnit(1, "earth", { pos: { x: 1, y: 0, z: 2 }, yaw: 0.5 });
  const dummy = createDummyUnit(2, { pos: { x: -3, y: 0, z: 0 }, yaw: 0, patrolHalfM: 2 });

  it("creates plain-data units with full HP that survive JSON", () => {
    expect([mage.hp, mage.maxHp, dummy.hp, mage.mage?.ready]).toEqual([170, 170, 170, { primary: 0, q: 0, e: 0, c: 0 }]);
    const s = createMatchState([mage, dummy]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect([unitById(s, 2), unitById(s, 9)]).toEqual([s.units[1], undefined]);
  });

  it("clones deeply", () => {
    const s = createMatchState([mage, dummy]);
    clonePlain(s).units[0]!.move.body.pos.x = 99;
    expect(s.units[0]!.move.body.pos.x).toBe(1);
  });

  it("aims along −Z at yaw 0, up with positive pitch; right is +X; a fresh unit has no status", () => {
    const d = aimDir(0, 0);
    expect([Math.abs(d.x) < 1e-12, d.y, d.z]).toEqual([true, 0, -1]);
    const up = aimDir(0, 0.5);
    expect([up.y, Math.hypot(up.x, up.y, up.z)].map((v) => Number(v.toFixed(12)))).toEqual([Number(Math.sin(0.5).toFixed(12)), 1]);
    expect(rightXZ(0)).toEqual({ x: 1, z: 0 });
    expect(statusFlags(dummy, 0)).toEqual({ burning: false, slowed: false, rooted: false, airborne: false });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm test packages/sim/src/match` → FAIL: `Failed to resolve import "./defs"`.

- [ ] **Step 3: Контракты**

`packages/sim/src/match/types.ts` (целиком):
```ts
import type { AABB, PlayerInput, PlayerState, Spawn, Vec3 } from "../types";
import type { World } from "../world";

/**
 * Контракты фазы 2-lite. Только простые данные: состояние и события уходят в JSON и по сети без потерь.
 * «Нет» — NOBODY (−1), а не undefined; времена — номера тиков (60 Гц), а не секунды.
 */
export type Element = "fire" | "earth";
export const ELEMENTS: readonly Element[] = ["fire", "earth"];
/** ЛКМ — атака, Q — приём, E — спасение, C — поле или контроль (GDD 2.2). */
export type Slot = "primary" | "q" | "e" | "c";
export const SLOTS: readonly Slot[] = ["primary", "q", "e", "c"];
export const ABILITY_IDS = ["fireFists", "fireball", "jetDash", "fireWall", "stoneShot", "stonePillar", "stoneWall", "earthquake"] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];
/** Чем нанесён урон: способностью или горением. */
export type DamageSource = AbilityId | "burning";
export type UnitId = number;
export const NOBODY: UnitId = -1;
/** «Давно»: тик, от которого любое окно уже закрыто. */
export const NEVER = -1_000_000;

/** Ввод мага за тик: движение и взгляд фазы 1 плюс кнопки. Нажатие — переход false → true между тиками. */
export interface MatchInput extends PlayerInput { primary: boolean; q: boolean; e: boolean; c: boolean }
export type Buttons = Pick<MatchInput, Slot>;
/** Отбрасывание из карточки, метры: вбок по ровному полу и вверх (GDD 2.2). */
export interface Knockback { distM: number; upM: number }

/** «…Until» — тик, с которого статус снят (действует, пока now < until). */
export interface Statuses {
  /** Горение: сколько импульсов урона осталось, тик следующего, чьё. */
  burnPulses: number; burnNext: number; burnBy: UnitId;
  slowUntil: number; slowMul: number;
  rootUntil: number;
  /** «В воздухе»: подброшен способностью, держится до приземления. */
  airborne: boolean; noControlUntil: number;
  /** Иммунитет к жёсткому контролю (подброс, обездвиживание); отбрасывание в это время ×0,5. */
  immuneUntil: number;
}

export interface MageState {
  element: Element;
  /** Тик, с которого слот снова готов. */
  ready: Record<Slot, number>;
  /** Кнопки прошлого тика — для нажатий. */
  held: Buttons;
  /** Замах: выпуск на releaseTick, прицел — на тике выпуска. */
  windup: { ability: AbilityId; slot: Slot; releaseTick: number } | null;
  /** Жар Огня 0…100; у Земли всегда 0. */
  heat: number; overheatUntil: number; lastShotTick: number;
  /** Реактивный рывок: направление по XZ, тик окончания, id зоны следа. */
  dash: { dirX: number; dirZ: number; endTick: number; trailZone: number } | null;
  spawn: Spawn;
  stats: { damage: number; kills: number; falls: number };
}

/** Манекен ходит вдоль rightXZ(yaw) на ±patrolHalfM от точки; без patrolHalfM стоит. */
export interface DummySpot { pos: Vec3; yaw: number; patrolHalfM?: number }
/** dir: +1 вправо, −1 влево, 0 — ещё не начал. */
export interface DummyState { spot: DummySpot; dir: number }

export interface Unit {
  id: UnitId;
  kind: "mage" | "dummy";
  /** Тело и движение — то же состояние, что у stepPlayer фазы 1. */
  move: PlayerState;
  hp: number; maxHp: number;
  /** Канал отбрасывания: горизонтальная скорость, м/с, гаснет сама. */
  kb: { x: number; z: number };
  status: Statuses;
  lastHitTick: number; lastHitBy: UnitId;
  /** Пока !alive — тик возрождения в respawnTick. */
  alive: boolean; respawnTick: number;
  mage: MageState | null;
  dummy: DummyState | null;
}

/** После шага тика endTick − 1 снаряд исчезает (огненный шар — взрывается). */
export interface Projectile { id: number; owner: UnitId; ability: "fireFists" | "fireball" | "stoneShot"; pos: Vec3; vel: Vec3; bornTick: number; endTick: number }

export type ZoneKind = "fireWall" | "fireTrail" | "pillar" | "quake";
export type ZoneShape =
  | { type: "box"; box: AABB }
  | { type: "segment"; a: Vec3; b: Vec3; halfW: number }
  | { type: "disc"; center: Vec3; radius: number };
/** До armTick — телеграф; разовые (столб, землетрясение) бьют ровно на armTick; на endTick зона исчезает. */
export interface Zone {
  id: number; owner: UnitId; kind: ZoneKind; ability: AbilityId; shape: ZoneShape;
  bornTick: number; armTick: number; endTick: number;
  /** Кого и с какого тика можно задеть снова. */
  rehit: { unit: UnitId; tick: number }[];
}

export type TerrainKind = "wall" | "pillar";
/** box — итоговый бокс коллизии; growTicks — рост рисунка (только вид); solid ставит stepTerrain на solidTick. */
export interface Terrain {
  id: number; owner: UnitId; kind: TerrainKind; box: AABB;
  bornTick: number; solidTick: number; endTick: number; growTicks: number;
  solid: boolean; hp: number; maxHp: number;
}

/** tick — сколько тиков посчитано (следующий шаг считает тик с этим номером); units по возрастанию id. */
export interface MatchState { tick: number; units: Unit[]; projectiles: Projectile[]; zones: Zone[]; terrain: Terrain[]; nextId: number }

export type StatusKind = "burning" | "slow" | "root" | "airborne";
export type RejectReason = "cooldown" | "busy" | "notGrounded" | "noTarget" | "rooted";

export type MatchEvent =
  /** Нажатие принято: замах или мгновенный каст. pos — глаза, dir — прицел. */
  | { type: "cast"; unit: UnitId; ability: AbilityId; slot: Slot; pos: Vec3; dir: Vec3 }
  /** Снаряд выпущен (конец замаха или выстрел ЛКМ). */
  | { type: "release"; unit: UnitId; ability: AbilityId; projectile: number; pos: Vec3; dir: Vec3 }
  | { type: "reject"; unit: UnitId; slot: Slot; reason: RejectReason }
  /** Первая фаза попадания: снаряд во что-то врезался. Нет цели — target NOBODY, terrain −1. */
  | { type: "impact"; ability: AbilityId; owner: UnitId; pos: Vec3; normal: Vec3; target: UnitId; terrain: number }
  | { type: "explosion"; ability: AbilityId; owner: UnitId; pos: Vec3; radius: number }
  /** Вторая фаза: урон засчитан. dir — куда толкнуло по XZ, knock — итоговое отбрасывание. */
  | { type: "hit"; source: UnitId; target: UnitId; ability: DamageSource; amount: number; pos: Vec3; dir: Vec3; knock: Knockback; airborne: boolean; dot: boolean; killed: boolean }
  | { type: "status"; target: UnitId; status: StatusKind; ticks: number; source: UnitId }
  | { type: "zone"; zone: number; kind: ZoneKind; owner: UnitId; phase: "telegraph" | "arm" | "end" }
  | { type: "terrain"; terrain: number; kind: TerrainKind; owner: UnitId; phase: "rise" | "solid" | "hit" | "break" | "expire"; pos: Vec3; amount: number }
  | { type: "dash"; unit: UnitId; phase: "start" | "end"; pos: Vec3; dir: Vec3 }
  | { type: "overheat"; unit: UnitId; on: boolean }
  | { type: "courage"; unit: UnitId }
  | { type: "death"; target: UnitId; killer: UnitId; ability: DamageSource; pos: Vec3 }
  | { type: "fall"; target: UnitId; credit: UnitId; pos: Vec3 }
  | { type: "respawn"; target: UnitId; pos: Vec3; yaw: number };

export interface MatchStep { state: MatchState; events: MatchEvent[] }

/** Статика матча: статический мир арены (без рельефа) и высота сброса (низ арены). */
export interface MatchContext { readonly world: World; readonly killBelowY: number }

/**
 * Что видит один тик: мир с рельефом на начало тика и куда писать события. Динамический коллайдер k
 * (номер colliders.length + k) — рельеф terrainIds[k], если k < terrainIds.length; дальше — стены огня.
 */
export interface TickCtx { readonly world: World; readonly terrainIds: readonly number[]; readonly killBelowY: number; readonly now: number; readonly ev: MatchEvent[] }
```

`packages/sim/src/match/defs.ts` (целиком). Все цифры — простые данные с единицами в именах: таблицы потом без правок переезжают в YAML.
```ts
import { TICK_HZ } from "../types";
import type { AbilityId, Element, Slot } from "./types";

/** Секунды → целые тики (60 Гц). */
export const ticks = (s: number): number => Math.round(s * TICK_HZ);
/** gravity — ускорение вниз, м/с². */
export interface ProjectileDef { speed: number; radiusM: number; gravity: number; rangeM: number }

/** Огонь «Напор» (GDD 4.3). Цифры не из GDD помечены «Р» — решения плана. */
export const FIRE = {
  hp: 150, runSpeed: 6.5,
  fireFists: {
    slot: "primary", name: "Огненные кулаки", damage: 12, ratePerS: 5,
    projectile: { speed: 40, radiusM: 0.2, gravity: 0, rangeM: 24 }, // дальность — Р7
    knockback: { distM: 0.3, upM: 0 }, // «сок» ЛКМ ≤ 0,3 м, × min(1, интервал / tempoRefS) (round2/03, п. 7)
    tempoRefS: 0.5,
  },
  heat: { perShot: 8, max: 100, coolPerS: 35, coolDelayS: 0.3, overheatS: 1.5, overheatRateMul: 0.5 },
  fireball: {
    slot: "q", name: "Огненный шар", cooldownS: 8, windupS: 0.25, damageCenter: 50, damageEdge: 20, radiusM: 3,
    projectile: { speed: 22, radiusM: 0.45, gravity: 0, rangeM: 44 }, // дальность — Р7
    knockback: { distM: 3, upM: 1.2 }, // Р3, в центре; к краю × damageEdge / damageCenter
  },
  jetDash: { slot: "e", name: "Реактивный рывок", cooldownS: 8, distM: 8, durationS: 0.2, trailS: 2, trailDps: 6, trailHalfWidthM: 0.75 },
  fireWall: { slot: "c", name: "Стена огня", cooldownS: 12, rangeM: 15, lengthM: 10, heightM: 2.5, thickM: 0.6, lifeS: 5, telegraphS: 0.4, contactDamage: 30, rehitS: 1 }, // толщина и повтор — Р6
  passive: { name: "Кураж" },
} as const;

/** Земля «Стойкость» (GDD 4.4). */
export const EARTH = {
  hp: 170, runSpeed: 6,
  stoneShot: {
    slot: "primary", name: "Каменный снаряд", damage: 30, ratePerS: 1.9, windupS: 0.2,
    projectile: { speed: 40, radiusM: 0.25, gravity: 6, rangeM: 50 }, // гравитация и дальность — Р7
    knockback: { distM: 0.3, upM: 0 },
  },
  stonePillar: {
    slot: "q", name: "Каменный столб", cooldownS: 10, rangeM: 20, telegraphS: 0.6, damage: 35,
    knockback: { distM: 1, upM: 3.5 }, // вбок — Р3
    sizeM: 1.2, heightM: 2.5, hp: 200, lifeS: 4, growS: 0.1, solidS: 0.2, hitPadM: 0.4, selfRadiusM: 0.9, selfLiftM: 2.5, // площадь и «под себя» — Р9
  },
  stoneWall: { slot: "e", name: "Каменная стена", cooldownS: 12, aheadM: 2, lengthM: 4, heightM: 2.5, thickM: 0.6, growS: 0.3, solidS: 0.2, hp: 250, lifeS: 6 },
  earthquake: {
    slot: "c", name: "Землетрясение", cooldownS: 14, telegraphS: 0.4, radiusM: 7, heightM: 1.5, damage: 40,
    slowMul: 0.6, slowS: 2, rootRadiusM: 3, rootS: 0.5, knockback: { distM: 0.5, upM: 0 }, // высота и «сок» — Р8, Р3
  },
  passive: { name: "Корни", knockbackMul: 0.5 },
} as const;

export const STATUS = { burning: { dps: 6, durationS: 3, pulseS: 0.5 }, airborne: { noControlS: 0.3, damageMul: 1.15 }, hardCcImmunityS: 2, immuneKnockbackMul: 0.5 } as const;
/** Пределы контроля и телеграфа (GDD 2.2). */
export const CC_LIMITS = { stunMaxS: 0.75, rootMaxS: 1, slowMaxFrac: 0.4, slowMaxS: 2 } as const;
export const TELEGRAPH_MIN_S = 0.4;
/** Канал отбрасывания: затухание e^(−λt) на полу и в воздухе (round1/03); пределы (GDD 2.2). */
export const KNOCKBACK = { groundDecayPerS: 6, airDecayPerS: 1.5, maxSideM: 12, maxUpM: 6, juicePrimaryMaxM: 0.3, juiceAbilityMaxM: 1, stopSpeed: 0.05 } as const;
export const MAGE_REGEN = { delayS: 4, perS: 20, capFrac: 2 / 3 } as const;
/** Манекен полигона (Р12). */
export const DUMMY = { hp: 170, runSpeed: 2, regenDelayS: 3, regenPerS: 85, respawnS: 3 } as const;
export const MATCH = { fallCreditS: 5, mageRespawnS: 1 } as const;
/** GDD 7.3–7.4. */
export const LIMITS = { projectilesPerMage: 8, projectilesTotal: 48, zonesPerMage: 3, zonesTotal: 16, terrainPerMage: 3, terrainTotal: 24 } as const;

export const ABILITY_OF: Readonly<Record<Element, Readonly<Record<Slot, AbilityId>>>> = {
  fire: { primary: "fireFists", q: "fireball", e: "jetDash", c: "fireWall" },
  earth: { primary: "stoneShot", q: "stonePillar", e: "stoneWall", c: "earthquake" },
};
export const ABILITY_NAME: Readonly<Record<AbilityId, string>> = {
  fireFists: FIRE.fireFists.name, fireball: FIRE.fireball.name, jetDash: FIRE.jetDash.name, fireWall: FIRE.fireWall.name,
  stoneShot: EARTH.stoneShot.name, stonePillar: EARTH.stonePillar.name, stoneWall: EARTH.stoneWall.name, earthquake: EARTH.earthquake.name,
};
/** Экран выбора (GDD 4.1). */
export const ELEMENT_INFO: Readonly<Record<Element, { name: string; title: string; motto: string; stars: string; hp: number; runSpeed: number; ult: string }>> = {
  fire: { name: "Огонь", title: "Напор", motto: "Жги в упор, только не перегрейся", stars: "★ Новичку", hp: FIRE.hp, runSpeed: FIRE.runSpeed, ult: "Дыхание дракона" },
  earth: { name: "Земля", title: "Стойкость", motto: "Строй стены, бей тяжело, стой насмерть", stars: "★★", hp: EARTH.hp, runSpeed: EARTH.runSpeed, ult: "Тектонический разлом" },
};

/** Полная перезарядка слота в тиках; у ЛКМ — интервал между выстрелами без перегрева. */
export function slotCooldownTicks(element: Element, slot: Slot): number {
  if (slot === "primary") return ticks(1 / (element === "fire" ? FIRE.fireFists.ratePerS : EARTH.stoneShot.ratePerS));
  const kit = element === "fire" ? { q: FIRE.fireball, e: FIRE.jetDash, c: FIRE.fireWall } : { q: EARTH.stonePillar, e: EARTH.stoneWall, c: EARTH.earthquake };
  return ticks(kit[slot].cooldownS);
}
```

`packages/sim/src/match/state.ts`:
```ts
import { createPlayer, forwardXZ } from "../player";
import { EYE_HEIGHT, type Spawn, type Vec3 } from "../types";
import { DUMMY, ELEMENT_INFO } from "./defs";
import { NEVER, NOBODY, type DummySpot, type Element, type MatchInput, type MatchState, type Statuses, type Unit, type UnitId } from "./types";

export const NO_MATCH_INPUT: Readonly<MatchInput> = Object.freeze({ moveX: 0, moveZ: 0, jump: false, yaw: 0, pitch: 0, primary: false, q: false, e: false, c: false });
export const freshStatuses = (): Statuses => ({ burnPulses: 0, burnNext: 0, burnBy: NOBODY, slowUntil: 0, slowMul: 1, rootUntil: 0, airborne: false, noControlUntil: 0, immuneUntil: 0 });

function baseUnit(id: UnitId, kind: Unit["kind"], pos: Vec3, yaw: number, hp: number): Unit {
  return { id, kind, move: createPlayer(pos, yaw), hp, maxHp: hp, kb: { x: 0, z: 0 }, status: freshStatuses(), lastHitTick: NEVER, lastHitBy: NOBODY, alive: true, respawnTick: 0, mage: null, dummy: null };
}
export function createMageUnit(id: UnitId, element: Element, spawn: Spawn): Unit {
  const u = baseUnit(id, "mage", spawn.pos, spawn.yaw, ELEMENT_INFO[element].hp);
  u.mage = {
    element, ready: { primary: 0, q: 0, e: 0, c: 0 }, held: { primary: false, q: false, e: false, c: false }, windup: null,
    heat: 0, overheatUntil: 0, lastShotTick: NEVER, dash: null, spawn: { pos: { ...spawn.pos }, yaw: spawn.yaw }, stats: { damage: 0, kills: 0, falls: 0 },
  };
  return u;
}
export function createDummyUnit(id: UnitId, spot: DummySpot): Unit {
  const u = baseUnit(id, "dummy", spot.pos, spot.yaw, DUMMY.hp);
  u.dummy = { spot: clonePlain(spot), dir: 0 };
  return u;
}
/** id снарядов, зон и рельефа — с 1000: не путаются с id юнитов в логах. */
export const createMatchState = (units: Unit[]): MatchState => ({ tick: 0, units, projectiles: [], zones: [], terrain: [], nextId: 1000 });
export const unitById = (s: Readonly<MatchState>, id: UnitId): Unit | undefined => s.units.find((u) => u.id === id);

/** Глубокая копия простых данных. В отличие от JSON сохраняет −0 и Infinity. */
export function clonePlain<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clonePlain) as T;
  if (v === null || typeof v !== "object") return v;
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(v)) o[k] = clonePlain((v as Record<string, unknown>)[k]);
  return o as T;
}

/** Единичное направление взгляда: yaw как у forwardXZ, pitch вверх положительный. */
export function aimDir(yaw: number, pitch: number): Vec3 {
  const f = forwardXZ(yaw);
  const c = Math.cos(pitch);
  return { x: f.x * c, y: Math.sin(pitch), z: f.z * c };
}
/** «Вправо» по XZ — ось стрейфа stepPlayer; `+ 0` убирает −0. */
export function rightXZ(yaw: number): { x: number; z: number } {
  const f = forwardXZ(yaw);
  return { x: -f.z + 0, z: f.x + 0 };
}
export const eyeOf = (u: Unit): Vec3 => ({ x: u.move.body.pos.x, y: u.move.body.pos.y + EYE_HEIGHT, z: u.move.body.pos.z });
export function statusFlags(u: Unit, now: number): { burning: boolean; slowed: boolean; rooted: boolean; airborne: boolean } {
  const s = u.status;
  return { burning: s.burnPulses > 0, slowed: now < s.slowUntil, rooted: now < s.rootUntil, airborne: s.airborne };
}
```
`packages/sim/src/match/fixtures.ts` — общий тестовый мир для задач 2–5 (не тест, его импортируют тесты):
```ts
import { aabb } from "../aabb";
import type { Collider, Volume } from "../types";
import { createWorld } from "../world";
import type { MatchContext } from "./types";

/** Пол испытаний: x −40…20, z −40…40, верх y = 0. Восточнее x = 20 — пропасть, зона смерти ниже −3 м. */
export const TEST_FLOOR: Collider = { box: aabb(-40, -1, -40, 20, 0, 40), tag: "floor" };
export const TEST_KILL: Volume = { kind: "kill", box: aabb(20, -30, -40, 40, -3, 40) };
export const testContext = (extra: readonly Collider[] = []): MatchContext => ({ world: createWorld([TEST_FLOOR, ...extra], [TEST_KILL]), killBelowY: -30 });

/** Глубокая заморозка: в строгом режиме любая запись в замороженное бросает TypeError. */
export function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  Object.freeze(v);
  return v;
}
```

`packages/sim/src/match/index.ts`:
```ts
export * from "./types";
export * from "./defs";
export * from "./state";
```

`apps/client/src/feel/effects.ts` — контракт клиента между событиями (задача 7) и исполнителями: частицы (6), звук (8), камера и HUD (7). Целиком:
```ts
import type { AbilityId, Element, Slot, UnitId, Vec3 } from "@doodlemagic/sim";

/** Всплески частиц. Огонь — вверх, рвано, свет; Земля — угловатые осколки вниз и пыль цвета бумаги (GDD 6). */
export const BURST_PRESETS = [
  "fistFlash", "fistImpact", "fireballCharge", "fireballBoom", "dashBlast", "fireWallSparks", "fireWallIgnite", "burnLick",
  "stoneCrumble", "stoneImpact", "pillarCracks", "pillarBurst", "wallDust", "quakeRing", "terrainChips", "terrainBreak",
  "deathFire", "deathEarth", "respawnPuff", "fizzle",
] as const;
export type BurstPreset = (typeof BURST_PRESETS)[number];
export const SOUND_IDS = [
  "fireFist", "fireballCharge", "fireballBoom", "dash", "fireWallTelegraph", "fireWallIgnite", "stoneCast", "stoneImpact", "pillarTelegraph", "pillarStrike",
  "wallRise", "quakeWindup", "quakeStrike", "terrainHit", "terrainBreak", "hitTick", "kill", "fall", "fizzle", "overheat", "courage",
] as const;
export type SoundId = (typeof SOUND_IDS)[number];
/** Чья рука; "auto" — та, что сейчас бьёт кулаком (решают жесты рук). */
export type Hand = "left" | "right" | "both" | "auto";

export type Effect =
  | { kind: "burst"; preset: BurstPreset; pos: Vec3; dir: Vec3; scale: number }
  | { kind: "palm"; hand: Hand; element: Element; preset: "flash" | "charge" | "fizzle" }
  | { kind: "gesture"; ability: AbilityId }
  | { kind: "sound"; id: SoundId; pos: Vec3 | null; gain: number } // pos null — у слушателя
  | { kind: "trauma"; amount: number }
  | { kind: "kick"; pitchDeg: number; yawDeg: number; rollDeg: number }
  | { kind: "fov"; deg: number; holdS: number }
  | { kind: "hitstop"; ms: number } // визуальный: замирают руки (GDD 2.2)
  | { kind: "hitmarker"; kill: boolean; air: boolean }
  | { kind: "number"; target: UnitId; amount: number; pos: Vec3; dot: boolean; air: boolean }
  | { kind: "flash"; target: UnitId }
  | { kind: "flinch"; target: UnitId; dir: Vec3; amount: number }
  | { kind: "indicator"; from: Vec3; amount: number } // попали в меня: откуда
  | { kind: "toast"; text: string }
  | { kind: "deny"; slot: Slot }; // перезарядка или замах: значок слота вздрагивает
export type EffectKind = Effect["kind"];
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm test packages/sim/src/match` и `pnpm typecheck` → PASS: 9 тестов; типы без ошибок. `pnpm test` — 421 тест.

- [ ] **Step 5: Коммит**

```bash
git add packages/sim/src/match packages/sim/src/index.ts apps/client/src/feel/effects.ts && git commit -m "feat(sim): phase 2-lite contracts — match state, ability tables, events, client effects" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Динамические коллайдеры и рельеф

**Поток:** S1, после задачи 1, параллельно с 3, 6, 7, 8.

**Files:**
- Modify: `packages/sim/src/world.ts`, `packages/sim/src/body.ts` (одна строка), `packages/sim/src/raycast.ts`
- Create: `packages/sim/src/match/{dynamic,terrain}.ts`
- Test: `packages/sim/src/match/{dynamic,terrain}.test.ts`

**Interfaces:**
- Consumes: `World`, `createWorld`, `overlapping`, `isFree`, `OVERLAP_EPS`, `blocks` (`world.ts`); `moveBody`, `bodyBox`; `raycast`, `groundBelow`, `lineOfSight`; `DEFAULT_MOVE`; из задачи 1 — `MatchState`, `Terrain`, `TerrainKind`, `TickCtx`, `Unit`, `UnitId`, `MatchEvent`, `LIMITS`, `createDummyUnit`, `createMageUnit`, `createMatchState`, `testContext`.
- Produces:
  - `world.ts`: поле `World.dynamic?: readonly Collider[]`; `colliderAt(w: World, idx: number): Collider`; `withDynamic(w: World, dynamic: readonly Collider[]): World`. `overlapping`, `isFree`, `raycast`, `groundBelow`, `lineOfSight`, `moveBody` видят динамику; номер динамического коллайдера — `colliders.length + k`.
  - `match/dynamic.ts`: `interface TickWorld { world: World; terrainIds: number[] }`; `buildTickWorld(staticWorld: World, s: Readonly<MatchState>): TickWorld` — статика + твёрдый рельеф (по порядку `s.terrain`) + стены огня, действующие на тик `s.tick` (`noSight`); `terrainAt(t: Pick<TickCtx, "world" | "terrainIds">, collider: number): number | null`.
  - `match/terrain.ts`: `interface TerrainSpec { growTicks: number; solidTicks: number; lifeTicks: number; hp: number }`; `spawnTerrain(s, t, owner: UnitId, kind: TerrainKind, box: AABB, spec: TerrainSpec): number`; `damageTerrain(s, t, id: number, amount: number, pos: Vec3): void`; `stepTerrain(s, t): void`; `pushOut(world: World, u: Unit, box: AABB): boolean`.
  - События: `{type:"terrain", phase:"rise"}` при появлении, `"solid"` на solidTick, `"hit"` (amount) при уроне, `"break"` при HP ≤ 0, `"expire"` на endTick и при вытеснении лимитом. `pos` у rise/solid/expire — центр основания бокса, у hit — точка удара, у break — центр бокса.

- [ ] **Step 1: Написать падающие тесты**

`packages/sim/src/match/dynamic.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { moveBody } from "../body";
import { groundBelow, lineOfSight, raycast } from "../raycast";
import type { Body, Collider } from "../types";
import { vec3 } from "../vec";
import { colliderAt, createWorld, isFree, overlapping, withDynamic, type World } from "../world";

const col = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({ box: aabb(x0, y0, z0, x1, y1, z1) });
const FLOOR = col(-20, -1, -20, 20, 0, 20);
const base = createWorld([FLOOR]);
const body = (x: number, y: number, z: number, vy = 0): Body => ({ pos: vec3(x, y, z), vel: vec3(0, vy, 0), halfW: 0.4, height: 1.8, stepHeight: 0.55 });
/** Как в body.test: постоянная скорость по X и гравитация 20 м/с². */
function run(b: Body, w: World, ticks: number, vx: number, ground: boolean): boolean {
  for (let t = 0; t < ticks; t++) {
    b.vel.x = vx;
    b.vel.y -= 20 / 60;
    ground = moveBody(w, b, 1 / 60, ground).onGround;
  }
  return ground;
}

describe("dynamic colliders", () => {
  it("are numbered after the static ones and leave the static world alone", () => {
    const w = withDynamic(base, [col(2, 0, -1, 3, 2, 1)]);
    const probe = aabb(2.5, 0.5, 0, 2.6, 0.6, 0.1);
    expect([w.colliders === base.colliders, colliderAt(w, 1).box.min.x, overlapping(w, probe), isFree(base, probe)]).toEqual([true, 2, [1], true]);
  });

  it("stop a moving body, carry a landing one and let it step onto a low one", () => {
    const b = body(0, 0, 0);
    run(b, withDynamic(base, [col(2, 0, -5, 3, 3, 5)]), 60, 5, true);
    expect(b.pos.x).toBeCloseTo(2 - 0.4, 6);
    const w = withDynamic(base, [col(-1, 0, -1, 1, 2.5, 1), col(3, 0, -2, 6, 0.4, 2)]);
    const a = body(0, 3, 0, -5);
    expect([run(a, w, 60, 0, false), a.pos.y]).toEqual([true, 2.5]);
    const s = body(2, 0, 0);
    expect(run(s, w, 40, 4, true)).toBe(true);
    expect(s.pos.y).toBeCloseTo(0.4, 6);
  });

  it("give the nearest raycast hit across static and dynamic boxes; on a tie the static one wins", () => {
    const wall = col(5, 0, -1, 6, 3, 1);
    const hit = raycast(withDynamic(createWorld([FLOOR, wall]), [col(3, 0, -1, 4, 3, 1)]), vec3(0, 1, 0), vec3(1, 0, 0), 50);
    expect([hit?.collider, hit?.normal]).toEqual([2, { x: -1, y: 0, z: 0 }]);
    expect(hit?.dist).toBeCloseTo(3, 9);
    expect(raycast(withDynamic(createWorld([FLOOR, wall]), [wall]), vec3(0, 1, 0), vec3(1, 0, 0), 50)?.collider).toBe(1);
  });

  it("let a noSight box (a fire wall) block sight but not movement or shots", () => {
    const w = withDynamic(base, [{ box: aabb(3, 0, -5, 3.6, 2.5, 5), noSight: true }]);
    expect([lineOfSight(w, vec3(0, 1.6, 0), vec3(6, 1.6, 0)), raycast(w, vec3(0, 1, 0), vec3(1, 0, 0), 10, "shot"), isFree(w, aabb(3.1, 0.1, -0.2, 3.5, 1.9, 0.2))]).toEqual([false, null, true]);
  });

  it("carry ground and are hit outside the static grid too", () => {
    const w = withDynamic(base, [col(-1, 0, -1, 1, 2.5, 1)]);
    expect([groundBelow(w, vec3(0, 5, 0)), groundBelow(w, vec3(3, 5, 0))]).toEqual([2.5, 0]);
    const far = withDynamic(createWorld([col(-2, -1, -2, 2, 0, 2)]), [col(30, 0, -1, 31, 2, 1)]);
    expect(raycast(far, vec3(25, 1, 0), vec3(1, 0, 0), 10)?.dist).toBeCloseTo(5, 9);
    expect(raycast(far, vec3(0, 1, 0), vec3(1, 0, 0), 40)?.dist).toBeCloseTo(30, 9);
  });

  it("do not hold a body that is already inside a new one", () => {
    const b = body(0, 0, 0);
    run(b, withDynamic(base, [col(-1, 0, -1, 1, 2.5, 1)]), 30, 4, true);
    expect(b.pos.x).toBeGreaterThan(1.4);
  });
});
```

`packages/sim/src/match/terrain.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { bodyBox } from "../body";
import { isFree } from "../world";
import { buildTickWorld } from "./dynamic";
import { testContext } from "./fixtures";
import { createDummyUnit, createMageUnit, createMatchState } from "./state";
import { damageTerrain, spawnTerrain, stepTerrain, type TerrainSpec } from "./terrain";
import type { MatchEvent, MatchState, TickCtx } from "./types";

const ctx = testContext();
function tick(s: MatchState, now: number, ev: MatchEvent[] = []): TickCtx {
  const tw = buildTickWorld(ctx.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: ctx.killBelowY, now, ev };
}
const solidWorld = (s: MatchState) => buildTickWorld(ctx.world, s).world;
const WALL = aabb(-2, 0, -5.3, 2, 2.5, -4.7);
const PILLAR = aabb(-0.6, 0, -0.6, 0.6, 2.5, 0.6);
const WALL_SPEC: TerrainSpec = { growTicks: 18, solidTicks: 12, lifeTicks: 360, hp: 250 };
const PILLAR_SPEC: TerrainSpec = { growTicks: 6, solidTicks: 12, lifeTicks: 240, hp: 200 };
const mage = () => createMageUnit(1, "earth", { pos: { x: 10, y: 0, z: 10 }, yaw: 0 });
const dummy = (id: number, x: number, y: number, z: number) => createDummyUnit(id, { pos: { x, y, z }, yaw: 0 });
const phases = (ev: MatchEvent[]) => ev.flatMap((e) => (e.type === "terrain" ? [e.phase] : []));
const runTerrain = (s: MatchState, from: number, to: number, ev: MatchEvent[] = []) => {
  for (let now = from; now <= to; now++) stepTerrain(s, tick(s, now, ev));
};

describe("terrain", () => {
  it("is solid from solidTick, not before, and expires at endTick", () => {
    const s = createMatchState([mage()]);
    const ev: MatchEvent[] = [];
    spawnTerrain(s, tick(s, 0, ev), 1, "wall", WALL, WALL_SPEC);
    const probe = aabb(-0.2, 0.5, -5.1, 0.2, 1, -4.9);
    runTerrain(s, 0, 11, ev);
    expect(isFree(solidWorld(s), probe)).toBe(true);
    runTerrain(s, 12, 12, ev);
    expect(isFree(solidWorld(s), probe)).toBe(false);
    runTerrain(s, 13, 360, ev);
    expect([s.terrain.length, phases(ev)]).toEqual([0, ["rise", "solid", "expire"]]);
  });

  it("takes damage, reports it and breaks at zero", () => {
    const s = createMatchState([mage()]);
    const ev: MatchEvent[] = [];
    const id = spawnTerrain(s, tick(s, 0, ev), 1, "pillar", PILLAR, PILLAR_SPEC);
    damageTerrain(s, tick(s, 20, ev), id, 150, { x: 0, y: 1, z: 0.6 });
    expect(s.terrain[0]!.hp).toBe(50);
    damageTerrain(s, tick(s, 21, ev), id, 60, { x: 0, y: 1, z: 0.6 });
    expect([s.terrain.length, phases(ev)]).toEqual([0, ["rise", "hit", "hit", "break"]]);
  });

  it("keeps at most three pieces per mage, dropping the oldest", () => {
    const s = createMatchState([mage()]);
    const ev: MatchEvent[] = [];
    const ids = [0, 1, 2, 3].map((k) => spawnTerrain(s, tick(s, k, ev), 1, "pillar", aabb(k * 3, 0, 0, k * 3 + 1.2, 2.5, 1.2), PILLAR_SPEC));
    expect(s.terrain.map((t) => t.id)).toEqual(ids.slice(1));
    expect(ev).toContainEqual(expect.objectContaining({ type: "terrain", terrain: ids[0], phase: "expire" }));
  });

  it("pushes a body out of a wall that solidifies around it, the shortest free way", () => {
    const s = createMatchState([mage(), dummy(2, 0.5, 0, -5)]);
    spawnTerrain(s, tick(s, 0), 1, "wall", WALL, WALL_SPEC);
    runTerrain(s, 0, 12);
    const p = s.units[1]!.move.body.pos;
    expect(isFree(solidWorld(s), bodyBox(s.units[1]!.move.body))).toBe(true);
    expect([p.x, Math.abs(p.z + 5)].map((v) => Number(v.toFixed(6)))).toEqual([0.5, 0.7]);
  });

  it("lifts a body onto the top when that is shortest, without raising its flight", () => {
    const s = createMatchState([mage(), dummy(2, 0, 1.9, 0), dummy(3, 5, 1.5, 0)]);
    s.units[2]!.move.body.vel.y = 8;
    spawnTerrain(s, tick(s, 0), 1, "pillar", PILLAR, PILLAR_SPEC);
    spawnTerrain(s, tick(s, 0), 1, "pillar", aabb(4.4, 0, -0.6, 5.6, 2.5, 0.6), PILLAR_SPEC);
    runTerrain(s, 0, 12);
    expect([s.units[1]!.move.body.pos.y, s.units[1]!.move.onGround]).toEqual([2.5, true]);
    const flyer = s.units[2]!.move.body;
    expect(flyer.pos.y).toBe(2.5);
    expect(2.5 + (flyer.vel.y * flyer.vel.y) / 40).toBeCloseTo(1.5 + (8 * 8) / 40, 9); // вершина та же
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test packages/sim/src/match/dynamic packages/sim/src/match/terrain` → FAIL: `colliderAt` / `withDynamic` не экспортированы, `./dynamic` и `./terrain` не найдены.

- [ ] **Step 3: Динамика в мире — минимальная правка `world.ts`, `body.ts`, `raycast.ts`**

`world.ts` — поле в `interface World`, две функции и хвост `overlapping` (после цикла по клеткам, перед `return out`):
```ts
  /** Динамические коллайдеры поверх сетки (рельеф Земли, стены огня), перебором. Номер в overlapping и raycast — colliders.length + индекс. */
  readonly dynamic?: readonly Collider[];

/** Коллайдер по номеру из overlapping или raycast: статический или динамический. */
export function colliderAt(w: World, idx: number): Collider {
  const n = w.colliders.length;
  const c = idx < n ? w.colliders[idx] : w.dynamic?.[idx - n];
  if (!c) throw new RangeError(`colliderAt: no collider ${idx}`);
  return c;
}
/** Тот же мир с другим набором динамики: сетка и статика общие, ничего не копируется. */
export const withDynamic = (w: World, dynamic: readonly Collider[]): World => ({ ...w, dynamic });

  // хвост overlapping
  const dyn = w.dynamic;
  if (dyn) for (let k = 0; k < dyn.length; k++) if (blocks(dyn[k]!, kind) && overlaps(box, dyn[k]!.box, OVERLAP_EPS)) out.push(w.colliders.length + k);
```
`body.ts`, в `sweepAxis`: `w.colliders[idx]!.box` → `colliderAt(w, idx).box`. `raycast.ts`, в `groundBelow`: `w.colliders[hit.collider]!.box.max.y` → `colliderAt(w, hit.collider).box.max.y`.

`raycast.ts` — динамика проверяется после обхода сетки, даже если луч сетку не задел:
1. `interface BestHit { idx: number; t: number; axis: Axis | null; sign: number }`.
2. Прежнее тело `raycast` от «Обрезаем луч прямоугольником сетки» до конца `for (;;)` без изменений логики переезжает в `function gridRay(w, origin, dir, maxDist, kind, stats, h: SlabHit, best: BestHit): void`: каждое `return null` → `return`, `bestIdx/bestT/bestAxis/bestSign` → поля `best`.
3. Новая `raycast`:
```ts
export function raycast(w: World, origin: Vec3, dir: Vec3, maxDist: number, kind: RayKind = "shot", stats?: RayStats): RayHit | null {
  if (!(maxDist >= 0) || !finite3(origin) || !finite3(dir)) return null;
  const h: SlabHit = { t: 0, axis: null, sign: 0 };
  const best: BestHit = { idx: -1, t: maxDist, axis: null, sign: 0 };
  gridRay(w, origin, dir, maxDist, kind, stats, h, best);
  const dyn = w.dynamic ?? [];
  for (let k = 0; k < dyn.length; k++) {
    if (!blocks(dyn[k]!, kind)) continue;
    if (stats) stats.tested++;
    // при равном расстоянии остаётся найденный раньше: статика или динамика с меньшим номером
    if (!slab(origin, dir, dyn[k]!.box, best.t, h) || (best.idx >= 0 && h.t === best.t)) continue;
    Object.assign(best, { idx: w.colliders.length + k, t: h.t, axis: h.axis, sign: h.sign });
  }
  if (best.idx < 0) return null;
  const normal = vec3();
  if (best.axis) normal[best.axis] = best.sign;
  const p = { x: origin.x + dir.x * best.t, y: origin.y + dir.y * best.t, z: origin.z + dir.z * best.t };
  return { dist: best.t, point: p, normal, collider: best.idx };
}
```
Run: `pnpm test packages/sim/src` — прежние `world`, `raycast`, `body`, `player` зелёные без правок, `dynamic.test.ts` проходит.

- [ ] **Step 4: Мир тика и рельеф**

`match/dynamic.ts`:
```ts
export interface TickWorld { world: World; terrainIds: number[] }

/** Мир на начало тика s.tick: статика, твёрдый рельеф в порядке s.terrain, затем действующие стены огня (noSight, GDD 4.3). Боксы только читаются. */
export function buildTickWorld(staticWorld: World, s: Readonly<MatchState>): TickWorld {
  const dynamic: Collider[] = [];
  const terrainIds: number[] = [];
  for (const t of s.terrain) {
    if (!t.solid) continue;
    dynamic.push({ box: t.box, tag: `terrain-${t.id}` });
    terrainIds.push(t.id);
  }
  for (const z of s.zones) {
    if (z.kind === "fireWall" && z.shape.type === "box" && s.tick >= z.armTick && s.tick < z.endTick) dynamic.push({ box: z.shape.box, noSight: true, tag: `fire-wall-${z.id}` });
  }
  return { world: dynamic.length > 0 ? withDynamic(staticWorld, dynamic) : staticWorld, terrainIds };
}
export function terrainAt(t: Pick<TickCtx, "world" | "terrainIds">, collider: number): number | null {
  const k = collider - t.world.colliders.length;
  return k >= 0 && k < t.terrainIds.length ? t.terrainIds[k]! : null;
}
```
`match/terrain.ts`:
- `spawnTerrain`: `id = s.nextId++`, `solid: false`, `bornTick = now`, `solidTick = now + solidTicks`, `endTick = now + lifeTicks`, `hp = maxHp`. До добавления: у владельца уже `LIMITS.terrainPerMage` — его самый старый удаляется с `expire`; всего `terrainTotal` — удаляется первый. Событие `rise`.
- `damageTerrain`: нет id — ничего; `hp -= amount`, событие `hit`; HP ≤ 0 — удалить, `break` в центре бокса.
- `stepTerrain` (по копии массива): `now >= endTick` — удалить, `expire`. Иначе при `!solid && now >= solidTick`: `solid = true`, `pushOut` каждого живого юнита в мире `withDynamic(t.world, [...(t.world.dynamic ?? []), { box }])`, событие `solid`.

Выталкивание (Р16) — целиком:
```ts
/** Кратчайший свободный путь из box: вверх на верх, ±x, ±z (при равной длине — в этом порядке). Вверх — без прибавки к вершине полёта. */
export function pushOut(world: World, u: Unit, box: AABB): boolean {
  const b = u.move.body;
  if (!overlaps(bodyBox(b), box, OVERLAP_EPS)) return false;
  const p = b.pos;
  const options = [
    { dx: 0, dy: box.max.y - p.y, dz: 0 }, { dx: box.max.x + b.halfW - p.x, dy: 0, dz: 0 }, { dx: box.min.x - b.halfW - p.x, dy: 0, dz: 0 },
    { dx: 0, dy: 0, dz: box.max.z + b.halfW - p.z }, { dx: 0, dy: 0, dz: box.min.z - b.halfW - p.z },
  ];
  let best: (typeof options)[number] | null = null;
  let bestLen = Infinity;
  for (const o of options) {
    const len = Math.abs(o.dx) + Math.abs(o.dy) + Math.abs(o.dz);
    if (len < bestLen && isFree(world, bodyBox({ ...b, pos: { x: p.x + o.dx, y: p.y + o.dy, z: p.z + o.dz } }))) [best, bestLen] = [o, len];
  }
  if (!best) return false; // нет пути — тело остаётся: из бокса, в котором утоплено, moveBody его выпустит
  Object.assign(p, { x: p.x + best.dx, y: p.y + best.dy, z: p.z + best.dz });
  if (best.dy > 0) {
    if (b.vel.y > 0) b.vel.y = Math.sqrt(Math.max(0, b.vel.y * b.vel.y - 2 * DEFAULT_MOVE.gravity * best.dy));
    u.move.onGround = b.vel.y <= 0;
  }
  return true;
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `pnpm test packages/sim` и `pnpm typecheck` → PASS: 11 новых тестов (6 + 5), все прежние зелёные; типы без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add packages/sim/src/world.ts packages/sim/src/body.ts packages/sim/src/raycast.ts packages/sim/src/match/dynamic.ts packages/sim/src/match/terrain.ts packages/sim/src/match/dynamic.test.ts packages/sim/src/match/terrain.test.ts && git commit -m "feat(sim): dynamic colliders over the static grid; Earth terrain lifecycle and push-out" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Бой: урон, отбрасывание, статусы, жизнь

**Поток:** S2, после задачи 1, параллельно с 2, 6, 7, 8. Динамика задачи 2 здесь не нужна: тесты идут на статическом мире.

**Files:**
- Create: `packages/sim/src/match/{combat,units}.ts`
- Test: `packages/sim/src/match/{combat,units}.test.ts`

**Interfaces:**
- Consumes: `moveBody`, `bodyBox`, `stepPlayer`, `DEFAULT_MOVE`, `NO_INPUT`, `volumeAt`, `TICK_DT`; из задачи 1 — типы, `FIRE`, `EARTH`, `STATUS`, `KNOCKBACK`, `MAGE_REGEN`, `DUMMY`, `MATCH`, `ticks`, `createMageUnit`, `createDummyUnit`, `createMatchState`, `unitById`, `rightXZ`, `NO_MATCH_INPUT`, `testContext`.
- Produces:
  - `combat.ts`:
    - `interface HitSpec { source: UnitId; target: UnitId; ability: DamageSource; damage: number; pos: Vec3; dir: { x: number; z: number }; knock?: Knockback; launch?: boolean; burn?: boolean; slow?: { mul: number; s: number }; rootS?: number; dot?: boolean }` — `dir` единичный по XZ или нулевой;
    - `knockbackSpeed(distM: number, upM: number, gravity?: number): number`;
    - `applyHit(s: MatchState, t: TickCtx, h: HitSpec): number` — возвращает нанесённый урон (0, если цель — сам источник, мёртв или нет такого);
    - `courage(t: TickCtx, killer: Unit): void` — «Кураж»;
    - `stepStatuses(s: MatchState, t: TickCtx): void` — импульсы горения, конец «В воздухе», реген.
  - `units.ts`:
    - `DUMMY_MOVE: Readonly<MoveParams>`; `mageMoveParams(element: Element): MoveParams`;
    - `moveKnock(world: World, u: Unit): void` — сдвиг по каналу `kb`;
    - `moveUnits(s: MatchState, t: TickCtx, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>): void` — пропускает мёртвых и магов в рывке (`mage.dash !== null`);
    - `stepLife(s: MatchState, t: TickCtx): void` — сброс в зону смерти или ниже `killBelowY`, возрождение.
  - Порядок в тике, на который рассчитаны эти функции (его повторяет `stepMatch`): `moveUnits` → (снаряды, зоны, рельеф) → `stepStatuses` → `stepLife`.

- [ ] **Step 1: Написать падающие тесты**

`packages/sim/src/match/combat.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { applyHit, knockbackSpeed, stepStatuses, type HitSpec } from "./combat";
import { DUMMY } from "./defs";
import { testContext } from "./fixtures";
import { createDummyUnit, createMageUnit, createMatchState } from "./state";
import { NOBODY, type MatchContext, type MatchEvent, type MatchState, type TickCtx, type Unit } from "./types";
import { moveUnits, stepLife } from "./units";

const ctx = testContext();
const tickOf = (c: MatchContext, now: number, ev: MatchEvent[]): TickCtx => ({ world: c.world, terrainIds: [], killBelowY: c.killBelowY, now, ev });
/** Тики без ввода в порядке stepMatch: движение, статусы, жизнь. */
function run(s: MatchState, c: MatchContext, ticks: number, each?: (s: MatchState) => void): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const t = tickOf(c, s.tick, ev);
    moveUnits(s, t, {});
    stepStatuses(s, t);
    stepLife(s, t);
    s.tick += 1;
    each?.(s);
  }
  return ev;
}
function settled(units: Unit[], c: MatchContext = ctx): MatchState {
  const s = createMatchState(units);
  run(s, c, 5);
  return s;
}
const mage = (el: "fire" | "earth" = "fire") => createMageUnit(1, el, { pos: { x: -30, y: 0, z: -30 }, yaw: 0 });
const dummy = (x: number, z = 0) => createDummyUnit(2, { pos: { x, y: 0, z }, yaw: 0 });
const u2 = (s: MatchState) => s.units.find((u) => u.id === 2)!;
const hit = (s: MatchState, ev: MatchEvent[], over: Partial<HitSpec>, c: MatchContext = ctx): number =>
  applyHit(s, tickOf(c, s.tick, ev), { source: 1, target: 2, ability: "fireball", damage: 0, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 1 }, ...over });
const topOf = (s: MatchState, n: number) => {
  let top = 0;
  run(s, ctx, n, (st) => (top = Math.max(top, u2(st).move.body.pos.y)));
  return top;
};

describe("knockback", () => {
  it("solves v0 = 6·distM on the floor and less when the target flies first", () => {
    expect(knockbackSpeed(3, 0)).toBeCloseTo(18, 9);
    expect(knockbackSpeed(3, 1.2)).toBeGreaterThan(4.5);
    expect(knockbackSpeed(3, 1.2)).toBeLessThan(8);
    expect(knockbackSpeed(0, 2)).toBe(0);
  });

  it("slides a target exactly distM, or launches it to upM and lands it about distM away", () => {
    const s = settled([mage(), dummy(-10)]);
    hit(s, [], { knock: { distM: 3, upM: 0 } });
    run(s, ctx, 150);
    expect(u2(s).move.body.pos.z).toBeCloseTo(3, 1);
    expect(u2(s).kb).toEqual({ x: 0, z: 0 });
    const f = settled([mage(), dummy(-10)]);
    hit(f, [], { knock: { distM: 3, upM: 1.2 } });
    expect(topOf(f, 150)).toBeCloseTo(1.2, 1);
    expect(Math.abs(u2(f).move.body.pos.z - 3)).toBeLessThan(0.35);
  });

  it("halves knockback on an Earth mage («Корни») and stops at a wall", () => {
    const s = settled([mage("fire"), createMageUnit(2, "earth", { pos: { x: -10, y: 0, z: 0 }, yaw: 0 })]);
    hit(s, [], { knock: { distM: 3, upM: 0 } });
    run(s, ctx, 150);
    expect(u2(s).move.body.pos.z).toBeCloseTo(1.5, 1);
    const walled = testContext([{ box: aabb(-12, 0, 1.5, -8, 3, 2) }]);
    const w = settled([mage(), dummy(-10)], walled);
    hit(w, [], { knock: { distM: 3, upM: 0 } }, walled);
    run(w, walled, 60);
    expect([Number(u2(w).move.body.pos.z.toFixed(6)), u2(w).kb.z]).toEqual([1.1, 0]);
  });
});

describe("falls and respawns", () => {
  it("drops a pushed target into the pit, credits the last hitter and brings it back in 3 s", () => {
    const s = settled([mage(), dummy(19)]);
    hit(s, [], { dir: { x: 1, z: 0 }, knock: { distM: 3, upM: 0 } });
    expect(run(s, ctx, 120)).toContainEqual(expect.objectContaining({ type: "fall", target: 2, credit: 1 }));
    expect([s.units[0]!.mage!.stats.falls, u2(s).alive]).toEqual([1, false]);
    expect(run(s, ctx, 181)).toContainEqual(expect.objectContaining({ type: "respawn", target: 2 }));
    expect([u2(s).alive, u2(s).hp, Number(u2(s).move.body.pos.x.toFixed(6))]).toEqual([true, DUMMY.hp, 19]);
  });

  it("credits the last hitter for 5 s and nobody after that", () => {
    for (const [ago, credit] of [[300, 1], [301, NOBODY]] as const) {
      const s = settled([mage(), dummy(-10)]);
      Object.assign(u2(s), { lastHitBy: 1, lastHitTick: s.tick - ago });
      u2(s).move.body.pos = { x: 25, y: -5, z: 0 };
      const ev: MatchEvent[] = [];
      stepLife(s, tickOf(ctx, s.tick, ev));
      expect(ev).toContainEqual(expect.objectContaining({ type: "fall", target: 2, credit }));
    }
  });
});

describe("statuses", () => {
  it("airborne: no control for 0.3 s, +15 % damage until landing, then 2 s of immunity", () => {
    const s = settled([mage(), dummy(-10)]);
    const ev: MatchEvent[] = [];
    const t0 = s.tick;
    hit(s, ev, { knock: { distM: 1, upM: 3.5 }, launch: true });
    expect(u2(s).status).toMatchObject({ airborne: true, noControlUntil: t0 + 18, immuneUntil: t0 + 18 + 120 });
    expect(ev).toContainEqual(expect.objectContaining({ type: "status", target: 2, status: "airborne", ticks: 18 }));
    run(s, ctx, 10);
    expect(hit(s, ev, { damage: 12 })).toBeCloseTo(13.8, 9);
    run(s, ctx, 90);
    expect([u2(s).status.airborne, hit(s, ev, { damage: 12 })]).toEqual([false, 12]);
    hit(s, ev, { knock: { distM: 0, upM: 3.5 }, launch: true }); // ещё в иммунитете: подброс вполсилы, без статуса
    expect(u2(s).status.airborne).toBe(false);
    expect(topOf(s, 60)).toBeCloseTo(1.75, 1);
  });

  it("burning: 6/s for 3 s in pulses of 3; a refresh extends it without stacking", () => {
    const once = settled([mage(), dummy(-10)]);
    hit(once, [], { burn: true });
    const pulses = run(once, ctx, 200).filter((e) => e.type === "hit" && e.dot);
    expect(u2(once).hp).toBeCloseTo(DUMMY.hp - 18, 9);
    expect(pulses).toHaveLength(6);
    expect(pulses.every((e) => e.type === "hit" && e.amount === 3 && e.ability === "burning" && e.source === 1)).toBe(true);
    const twice = settled([mage(), dummy(-10)]);
    hit(twice, [], { burn: true });
    run(twice, ctx, 60);
    hit(twice, [], { burn: true });
    run(twice, ctx, 200);
    expect(u2(twice).hp).toBeCloseTo(DUMMY.hp - 21, 9);
  });

  it("regen: a mage 20/s after 4 s up to ⅔, a dummy 85/s after 3 s to full", () => {
    const s = settled([mage(), dummy(-10)]);
    const m = s.units[0]!;
    const d = u2(s);
    Object.assign(m, { hp: 50, lastHitTick: s.tick });
    Object.assign(d, { hp: 10, lastHitTick: s.tick });
    run(s, ctx, 180);
    expect([m.hp, d.hp]).toEqual([50, 10]);
    run(s, ctx, 60);
    expect(m.hp).toBe(50);
    run(s, ctx, 60);
    expect([Number(m.hp.toFixed(6)), d.hp]).toEqual([70, DUMMY.hp]);
    m.hp = 95;
    run(s, ctx, 60);
    expect(m.hp).toBeCloseTo(100, 9);
  });
});

describe("kills", () => {
  it("credits the killer; «Кураж» clears heat and refreshes E", () => {
    const s = settled([mage("fire"), dummy(-10)]);
    const m = s.units[0]!.mage!;
    Object.assign(m, { heat: 60, overheatUntil: s.tick + 50 });
    m.ready.e = s.tick + 400;
    u2(s).hp = 10;
    const ev: MatchEvent[] = [];
    expect(hit(s, ev, { ability: "fireFists", damage: 12 })).toBe(12);
    for (const e of [{ type: "hit", target: 2, killed: true }, { type: "death", target: 2, killer: 1, ability: "fireFists" }, { type: "courage", unit: 1 }]) {
      expect(ev).toContainEqual(expect.objectContaining(e));
    }
    expect([m.stats.kills, m.stats.damage, m.heat, m.overheatUntil, m.ready.e <= s.tick, u2(s).alive]).toEqual([1, 12, 0, 0, true, false]);
  });

  it("ignores hits on yourself and on the dead", () => {
    const s = settled([mage(), dummy(-10)]);
    expect(hit(s, [], { target: 1, damage: 50 })).toBe(0);
    u2(s).alive = false;
    expect(hit(s, [], { damage: 50 })).toBe(0);
  });
});
```

`packages/sim/src/match/units.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { applyHit, stepStatuses, type HitSpec } from "./combat";
import { testContext } from "./fixtures";
import { NO_MATCH_INPUT, createDummyUnit, createMageUnit, createMatchState } from "./state";
import type { MatchInput, MatchState, TickCtx, Unit, UnitId } from "./types";
import { moveUnits, stepLife } from "./units";

const ctx = testContext();
const tickOf = (s: MatchState): TickCtx => ({ world: ctx.world, terrainIds: [], killBelowY: ctx.killBelowY, now: s.tick, ev: [] });
function step(s: MatchState, n: number, inputs: Partial<Record<UnitId, MatchInput>> = {}, each?: (s: MatchState) => void): void {
  for (let k = 0; k < n; k++) {
    const t = tickOf(s);
    moveUnits(s, t, inputs);
    stepStatuses(s, t);
    stepLife(s, t);
    s.tick += 1;
    each?.(s);
  }
}
const speed = (u: Unit) => Math.hypot(u.move.body.vel.x, u.move.body.vel.z);
const fwd: MatchInput = { ...NO_MATCH_INPUT, moveZ: 1 };
const withMage = () => createMatchState([createMageUnit(1, "fire", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }), createDummyUnit(2, { pos: { x: -10, y: 0, z: 10 }, yaw: 0 })]);
const onMage = (s: MatchState, over: Partial<HitSpec>) =>
  applyHit(s, tickOf(s), { source: 2, target: 1, ability: "earthquake", damage: 0, pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, z: 0 }, ...over });

describe("control", () => {
  it("slows a running mage by 40 % for 2 s", () => {
    const s = withMage();
    step(s, 60, { 1: fwd });
    expect(speed(s.units[0]!)).toBeCloseTo(6.5, 6);
    onMage(s, { slow: { mul: 0.6, s: 2 } });
    step(s, 30, { 1: fwd });
    expect(speed(s.units[0]!)).toBeCloseTo(6.5 * 0.6, 6);
    step(s, 120, { 1: fwd });
    expect(speed(s.units[0]!)).toBeCloseTo(6.5, 6);
  });

  it("roots for 0.5 s: no steps and no jump, then moves again", () => {
    const s = withMage();
    step(s, 5);
    onMage(s, { rootS: 0.5 });
    const z0 = s.units[0]!.move.body.pos.z;
    step(s, 30, { 1: { ...fwd, jump: true } });
    expect([Number((s.units[0]!.move.body.pos.z - z0).toFixed(9)), s.units[0]!.move.body.pos.y]).toEqual([0, 0]);
    step(s, 30, { 1: fwd });
    expect(s.units[0]!.move.body.pos.z).toBeLessThan(z0 - 1);
  });
});

describe("dummies", () => {
  it("strafe ±patrolHalfM along their right axis at 2 m/s, or stand still without a patrol", () => {
    const s = createMatchState([createDummyUnit(2, { pos: { x: -10, y: 0, z: 0 }, yaw: 0, patrolHalfM: 2 }), createDummyUnit(3, { pos: { x: -10, y: 0, z: 10 }, yaw: 0 })]);
    let lo = Infinity;
    let hi = -Infinity;
    let top = 0;
    step(s, 600, {}, (st) => {
      const b = st.units[0]!.move.body;
      [lo, hi, top] = [Math.min(lo, b.pos.x), Math.max(hi, b.pos.x), Math.max(top, Math.hypot(b.vel.x, b.vel.z))];
      expect(b.pos.z).toBeCloseTo(0, 9);
    });
    expect([lo < -11.8, lo > -12.15, hi > -8.2, hi < -7.85, top <= 2 + 1e-9]).toEqual([true, true, true, true, true]);
    expect(s.units[1]!.move.body.pos).toEqual({ x: -10, y: 0, z: 10 });
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test packages/sim/src/match/combat packages/sim/src/match/units` → FAIL: `Failed to resolve import "./combat"`.

- [ ] **Step 3: Отбрасывание — целиком**

Модель (Р3): канал `kb` гаснет как e^(−λt), λ = 6/с на полу и 1,5/с в воздухе; на ровном полу путь — v₀/λ. Подброшенная на `upM` цель первые T = 2·√(2·upM/g) с летит с λ воздуха, поэтому v₀ = distM / ((1 − e^(−λₐT))/λₐ + e^(−λₐT)/λ_g): карточные метры — настоящие. За тик тело сдвигается на среднюю за тик скорость v·(1 − e^(−λdt))/(λdt), и сумма шагов — ровно v₀/λ при любом тике.
```ts
const G = DEFAULT_MOVE.gravity;
const [LG, LA] = [KNOCKBACK.groundDecayPerS, KNOCKBACK.airDecayPerS];

export function knockbackSpeed(distM: number, upM: number, gravity = G): number {
  if (!(distM > 0)) return 0;
  const e = Math.exp(-LA * (upM > 0 ? 2 * Math.sqrt((2 * upM) / gravity) : 0));
  return distM / ((1 - e) / LA + e / LG);
}
/** За тик: множитель затухания и доля средней скорости тика. */
const decay = (lambda: number) => ({ e: Math.exp(-lambda * TICK_DT), mean: (1 - Math.exp(-lambda * TICK_DT)) / (lambda * TICK_DT) });
const [GROUND, AIR] = [decay(LG), decay(LA)];

/** Второй вызов moveBody — по каналу отбрасывания, со своими стенами и ступенькой; заблокированная ось гасит канал. */
export function moveKnock(world: World, u: Unit): void {
  const kb = u.kb;
  if (Math.sqrt(kb.x * kb.x + kb.z * kb.z) < KNOCKBACK.stopSpeed) return void Object.assign(kb, { x: 0, z: 0 });
  const k = u.move.onGround ? GROUND : AIR;
  const b = u.move.body;
  const own = b.vel;
  b.vel = { x: kb.x * k.mean, y: 0, z: kb.z * k.mean };
  const r = moveBody(world, b, TICK_DT, u.move.onGround);
  kb.x = b.vel.x === 0 ? 0 : kb.x * k.e;
  kb.z = b.vel.z === 0 ? 0 : kb.z * k.e;
  b.vel = own;
  if (!r.onGround) u.move.onGround = false; // столкнули с края — следующий stepPlayer уже в воздухе
}

/** Толчок из applyHit: канал вбок с потолком 12 м, подброс — как прыжок, точной высоты upM. */
function push(u: Unit, dir: { x: number; z: number }, k: Knockback): void {
  const v0 = knockbackSpeed(k.distM, k.upM);
  u.kb.x += dir.x * v0;
  u.kb.z += dir.z * v0;
  const cap = knockbackSpeed(KNOCKBACK.maxSideM, 0);
  const sp = Math.sqrt(u.kb.x * u.kb.x + u.kb.z * u.kb.z);
  if (sp > cap) Object.assign(u.kb, { x: (u.kb.x * cap) / sp, z: (u.kb.z * cap) / sp });
  if (k.upM > 0) {
    u.move.body.vel.y = Math.max(u.move.body.vel.y, Math.sqrt(2 * G * k.upM));
    Object.assign(u.move, { onGround: false, coyote: 0 });
  }
}
```
`stepPlayer` фазы 1 не меняется: своя скорость мага и толчок не смешиваются.

`applyHit` по порядку:
1. `h.source === h.target`, цели нет или `!alive` → 0.
2. `amount = st.airborne ? damage × 1,15 : damage` — бонус от статуса, поставленного раньше, а не этим ударом.
3. `knock`: `distM` и `upM` × 0,5 у мага Земли × 0,5 в иммунитете (`now < immuneUntil`), потолок 12 / 6 м; `push(u, h.dir, knock)`.
4. `u.hp -= amount`, `lastHitTick = now`, `lastHitBy = source`; у мага-источника `stats.damage += amount`.
5. Событие `hit` (`knock` — итоговый, `airborne` — был ли бонус, `dot`, `killed = hp ≤ 0`).
6. Статусы, каждый со своим событием `status`:
   - `launch` и `now >= immuneUntil`: `airborne = true`, `noControlUntil = now + 18`, `immuneUntil = noControlUntil + 120`;
   - `rootS` и `now >= immuneUntil`: `rootUntil = now + ticks(rootS)`, `immuneUntil = rootUntil + 120`, своя скорость по XZ — 0;
   - `slow`: `slowUntil = max(slowUntil, now + ticks(s))`, `slowMul = min(slowMul, mul)`;
   - `burn`: если `burnPulses === 0`, то `burnNext = now + 30`; затем `burnPulses = 6`, `burnBy = source` (продление без сложения, Р10).
7. `hp ≤ 0`: `hp = 0`, `alive = false`, `kb = 0`, `respawnTick = now + 180` (манекен) или `+ 60` (маг); событие `death` (`pos` — подошва); у мага-убийцы `stats.kills++` и `courage(t, killer)`.

`courage` (только маг Огня): `heat = 0`, `overheatUntil = 0`, `ready.e = min(ready.e, now)`, событие `courage`.

- [ ] **Step 4: Статусы, движение, жизнь**

`stepStatuses` для живых:
- горение: `burnPulses > 0 && now >= burnNext` → `applyHit({ source: burnBy, ability: "burning", damage: 3, pos: центр тела, dir: {0, 0}, dot: true })`, `burnPulses--`, `burnNext += 30`;
- `airborne && onGround && now >= noControlUntil` → `airborne = false`; `now >= slowUntil` → `slowMul = 1`;
- реген: `now − lastHitTick ≥ delay` (маг 240, манекен 180) и `hp < cap` (маг ⅔·maxHp, манекен maxHp) → `hp = min(cap, hp + perS / 60)`.

`moveUnits` для живых и не в рывке:
```ts
const st = u.status;
let inp: PlayerInput = u.mage ? (inputs[u.id] ?? NO_MATCH_INPUT) : dummyInput(u);
let p: MoveParams = u.mage ? mageMoveParams(u.mage.element) : DUMMY_MOVE;
if (t.now < st.rootUntil || t.now < st.noControlUntil) inp = { ...inp, moveX: 0, moveZ: 0, jump: false }; // взгляд не отнимаем (GDD 2.2)
if (t.now < st.slowUntil) p = { ...p, runSpeed: p.runSpeed * st.slowMul };
u.move = stepPlayer(u.move, inp, TICK_DT, t.world, p);
if (t.now < st.rootUntil) Object.assign(u.move.body.vel, { x: 0, z: 0 });
moveKnock(t.world, u);
```
`mageMoveParams(el) = { ...DEFAULT_MOVE, runSpeed: el === "fire" ? 6.5 : 6 }`, `DUMMY_MOVE = Object.freeze({ ...DEFAULT_MOVE, runSpeed: DUMMY.runSpeed })`.

ИИ манекена (`dummyInput`): стоит (`NO_INPUT`, `yaw = spot.yaw`), если нет `patrolHalfM`, не на земле или `kb ≠ 0`. Иначе смещение вдоль `rightXZ(spot.yaw)`: `off ≥ half` → `dir = −1`, `off ≤ −half` → `dir = 1`, `dir === 0` → `1`; ввод `moveX = dir`.

`stepLife`:
- живой в зоне смерти (`volumeAt(t.world, bodyBox(body), "kill")`) или ниже `killBelowY` → `alive = false`, `respawnTick` как при смерти. Засчитывается `lastHitBy`, если это не NOBODY, не сам юнит и `now − lastHitTick ≤ 300` (Р13), иначе NOBODY. Событие `fall`; у засчитанного мага `stats.falls++` и `courage`;
- мёртвый и `now >= respawnTick` → элемент массива заменяется свежим `createDummyUnit(id, spot)` или `createMageUnit(id, element, mage.spawn)` с прежними `stats` и `ready`; событие `respawn` (`pos`, `yaw` точки).

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `pnpm test packages/sim` и `pnpm typecheck` → PASS: 13 новых тестов (10 + 3), прежние зелёные.

- [ ] **Step 6: Коммит**

```bash
git add packages/sim/src/match/combat.ts packages/sim/src/match/units.ts packages/sim/src/match/combat.test.ts packages/sim/src/match/units.test.ts && git commit -m "feat(sim): damage, knockback channel in metres, statuses, regen, falls, dummies and passives" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Снаряды, зоны, прицел и шаг матча

**Поток:** S, после слияния задач 2 и 3 в ветку потока S.

**Files:**
- Create: `packages/sim/src/match/{projectiles,zones,aim,kit,match}.ts`, заглушки `packages/sim/src/match/{fire,earth}.ts`
- Modify: `packages/sim/src/match/index.ts`
- Test: `packages/sim/src/match/{projectiles,zones,aim,kit,match}.test.ts`

**Interfaces:**
- Consumes: задачи 1–3 целиком (`buildTickWorld`, `terrainAt`, `spawnTerrain`, `damageTerrain`, `stepTerrain`, `applyHit`, `stepStatuses`, `moveUnits`, `stepLife`); `raycast`, `groundBelow`, `bodyBox`, `overlaps`, `centerOf`, `sanitizeInput`, `forwardXZ`, `createWorld`, `EYE_HEIGHT`, `TICK_DT`.
- Produces:
  - `projectiles.ts`: `type ProjectileAbility = Projectile["ability"]`; `projectileDef(a): ProjectileDef`; `PROJECTILE_JUICE_M: Record<ProjectileAbility, number>` (кулаки 0,12, камень 0,3, шар 0); `spawnProjectile(s, t, owner: UnitId, ability: ProjectileAbility, pos: Vec3, dir: Vec3): number`; `interface SweepHit { dist: number; unit: UnitId; terrain: number | null; point: Vec3; normal: Vec3 }`; `sweepSegment(s, t, owner: UnitId, from: Vec3, to: Vec3, radiusM: number): SweepHit | null`; `stepProjectiles(s, t): void`; `explodeFireball(s, t, owner: UnitId, pos: Vec3, direct: UnitId, fallbackDir: { x: number; z: number }): void`.
  - `zones.ts`: `type NewZone = Omit<Zone, "id" | "rehit">`; `spawnZone(s, t, z: NewZone): number` (событие `zone/telegraph`, лимиты 3 / 16); `zoneTouches(shape: ZoneShape, u: Unit): boolean`; `stepZones(s, t): void`.
  - `aim.ts`: `aimGround(s, t, caster: UnitId, yaw: number, pitch: number, rangeM: number): Vec3 | null`.
  - `kit.ts`: `interface Kit { input(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput, pressed: Buttons): void; tick(s: MatchState, t: TickCtx, u: Unit, inp: MatchInput): void }`; `NO_KIT`; `castAim(u: Unit, inp: MatchInput): { eye: Vec3; dir: Vec3 }`; `moveDirXZ(inp: MatchInput): { x: number; z: number }`; `horizontalDir(v: { x: number; z: number }): { x: number; z: number }`; `snappedWallBox(c: Vec3, yaw: number, lengthM: number, thickM: number, heightM: number): AABB`; `emitCast(t, u, ability: AbilityId, slot: Slot, aim: { eye: Vec3; dir: Vec3 }): void`; `rejectCast(t, u, slot: Slot, reason: RejectReason): void`.
  - `fire.ts`: `export const FIRE_KIT: Kit = NO_KIT;` `earth.ts`: `export const EARTH_KIT: Kit = NO_KIT;` — заменит задача 5.
  - `match.ts`: `matchContext(arena: ArenaData): MatchContext`; `interface MatchSetup { mages: { element: Element; spawn: Spawn }[]; dummies: DummySpot[] }`; `createMatch(setup: MatchSetup): MatchState` (маги — id 1…, затем манекены); `stepMatch(state: Readonly<MatchState>, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>, ctx: MatchContext): MatchStep`; `respawnMage(state: Readonly<MatchState>, id: UnitId, element: Element): MatchState`.
  - `index.ts` дополняется: `export * from "./match";` и `export { buildTickWorld, type TickWorld } from "./dynamic";`.

- [ ] **Step 1: Написать падающие тесты**

Общий заголовок для `projectiles.test.ts`, `zones.test.ts`, `aim.test.ts` (в каждом файле свой экземпляр):
```ts
import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { stepStatuses } from "./combat";
import { buildTickWorld } from "./dynamic";
import { testContext } from "./fixtures";
import { createDummyUnit, createMageUnit, createMatchState, statusFlags } from "./state";
import { stepTerrain } from "./terrain";
import { NOBODY, type MatchContext, type MatchEvent, type MatchState, type TickCtx } from "./types";
import { moveUnits } from "./units";

const ctx = testContext();
function tickOf(s: MatchState, c: MatchContext, ev: MatchEvent[]): TickCtx {
  const tw = buildTickWorld(c.world, s);
  return { world: tw.world, terrainIds: tw.terrainIds, killBelowY: c.killBelowY, now: s.tick, ev };
}
const mage = () => createMageUnit(1, "fire", { pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
const dummy = (id: number, x: number, z: number) => createDummyUnit(id, { pos: { x, y: 0, z }, yaw: 0 });
const byId = (s: MatchState, id: number) => s.units.find((u) => u.id === id)!;
const EYE = { x: 0, y: 1.6, z: 0 };
const AHEAD = { x: 0, y: 0, z: -1 };
```
Лишние в конкретном файле импорты не мешают: `noUnusedLocals` выключен.

`packages/sim/src/match/projectiles.test.ts` (после заголовка):
```ts
import { EARTH, FIRE, LIMITS } from "./defs";
import { spawnProjectile, stepProjectiles, sweepSegment } from "./projectiles";
import { spawnTerrain } from "./terrain";

function fly(s: MatchState, c: MatchContext, n: number): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (let k = 0; k < n; k++) {
    const t = tickOf(s, c, ev);
    moveUnits(s, t, {});
    stepProjectiles(s, t);
    stepStatuses(s, t);
    s.tick += 1;
  }
  return ev;
}
const shoot = (s: MatchState, c: MatchContext, a: "fireFists" | "fireball" | "stoneShot") => spawnProjectile(s, tickOf(s, c, []), 1, a, EYE, AHEAD);
const FAR = { x: 0, y: 1.6, z: -20 };

describe("projectiles", () => {
  it("sweep: hit the first body, inflated by the radius, skip the owner, stop at a wall in front", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10), dummy(3, 0, -14)]);
    const h = sweepSegment(s, tickOf(s, ctx, []), 1, EYE, FAR, 0.2);
    expect([h?.unit, h?.normal]).toEqual([2, { x: 0, y: 0, z: 1 }]);
    expect(h?.dist).toBeCloseTo(10 - 0.4 - 0.2, 9);
    const walled = testContext([{ box: aabb(-3, 0, -6, 3, 3, -5.5) }]);
    const w = sweepSegment(s, tickOf(s, walled, []), 1, EYE, FAR, 0.2);
    expect([w?.unit, w?.terrain]).toEqual([NOBODY, null]);
    expect(w?.dist).toBeCloseTo(5.5, 9);
  });

  it("fire fist: 12 damage and a small tempo-scaled push; gone after 24 m (36 ticks)", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10)]);
    shoot(s, ctx, "fireFists");
    const ev = fly(s, ctx, 30);
    const hit = ev.find((e) => e.type === "hit");
    expect(hit).toMatchObject({ source: 1, target: 2, ability: "fireFists", amount: 12 });
    expect(hit?.type === "hit" && Number(hit.knock.distM.toFixed(9))).toBe(0.12);
    expect(ev).toContainEqual(expect.objectContaining({ type: "impact", ability: "fireFists", target: 2 }));
    const free = createMatchState([mage()]);
    shoot(free, ctx, "fireFists");
    fly(free, ctx, 35);
    expect(free.projectiles).toHaveLength(1);
    fly(free, ctx, 1);
    expect([s.projectiles.length, free.projectiles.length]).toEqual([0, 0]);
  });

  it("stone drops on a light ballistic arc and chips the terrain it hits", () => {
    const s = createMatchState([mage()]);
    shoot(s, ctx, "stoneShot");
    fly(s, ctx, 30);
    expect(s.projectiles[0]!.pos.z).toBeCloseTo(-20, 6);
    expect(s.projectiles[0]!.pos.y).toBeCloseTo(1.6 - 0.5 * EARTH.stoneShot.projectile.gravity * 0.25, 6);
    const w = createMatchState([mage()]);
    const id = spawnTerrain(w, tickOf(w, ctx, []), 1, "wall", aabb(-2, 0, -6.3, 2, 2.5, -5.7), { growTicks: 18, solidTicks: 0, lifeTicks: 360, hp: 250 });
    w.terrain[0]!.solid = true;
    shoot(w, ctx, "stoneShot");
    expect(fly(w, ctx, 20)).toContainEqual(expect.objectContaining({ type: "impact", ability: "stoneShot", terrain: id }));
    expect(w.terrain[0]!.hp).toBe(250 - EARTH.stoneShot.damage);
  });

  it("fireball: 50 on a direct hit, falling to 20 at 3 m, burning, push scaled the same", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10), dummy(3, 3.2, -9.15), dummy(4, 4, -9.15)]);
    shoot(s, ctx, "fireball");
    const ev = fly(s, ctx, 40);
    const hits = new Map(ev.flatMap((e) => (e.type === "hit" && !e.dot ? [[e.target, e] as const] : [])));
    expect(hits.get(2)?.amount).toBeCloseTo(FIRE.fireball.damageCenter, 9);
    expect(hits.get(2)?.knock.distM).toBeCloseTo(FIRE.fireball.knockback.distM, 9);
    expect(hits.get(3)?.amount).toBeCloseTo(22, 6);
    expect(hits.get(3)?.knock.distM).toBeCloseTo(3 * 0.44, 6);
    expect([hits.has(4), byId(s, 2).status.burnPulses > 0]).toEqual([false, true]);
    expect(ev).toContainEqual(expect.objectContaining({ type: "explosion", ability: "fireball", radius: FIRE.fireball.radiusM }));
  });

  it("does not splash through a wall", () => {
    const walled = testContext([{ box: aabb(1.6, 0, -12, 2.2, 3, -6) }]);
    const s = createMatchState([mage(), dummy(2, 0, -10), dummy(3, 3.2, -9.15)]);
    shoot(s, walled, "fireball");
    const ev = fly(s, walled, 40);
    expect([2, 3].map((id) => ev.some((e) => e.type === "hit" && e.target === id))).toEqual([true, false]);
  });

  it("keeps at most 8 projectiles per mage, dropping the oldest", () => {
    const s = createMatchState([mage()]);
    const ids = Array.from({ length: LIMITS.projectilesPerMage + 1 }, () => shoot(s, ctx, "fireFists"));
    expect(s.projectiles.map((p) => p.id)).toEqual(ids.slice(1));
  });
});
```

`packages/sim/src/match/zones.test.ts` (после заголовка):
```ts
import { spawnZone, stepZones, type NewZone } from "./zones";

function step(s: MatchState, n: number, each?: (s: MatchState) => void): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (let k = 0; k < n; k++) {
    const t = tickOf(s, ctx, ev);
    moveUnits(s, t, {});
    stepZones(s, t);
    stepTerrain(s, t);
    stepStatuses(s, t);
    s.tick += 1;
    each?.(s);
  }
  return ev;
}
const zone = (s: MatchState, z: NewZone, ev: MatchEvent[] = []) => spawnZone(s, tickOf(s, ctx, ev), z);
const hitsOn = (ev: MatchEvent[], id: number) => ev.flatMap((e) => (e.type === "hit" && e.target === id && !e.dot ? [e] : []));
const wallZone = (box: ReturnType<typeof aabb>): NewZone => ({ owner: 1, kind: "fireWall", ability: "fireWall", shape: { type: "box", box }, bornTick: 0, armTick: 24, endTick: 324 });
const pillarZone = (box: ReturnType<typeof aabb>, born: number): NewZone => ({ owner: 1, kind: "pillar", ability: "stonePillar", shape: { type: "box", box }, bornTick: born, armTick: born + 36, endTick: born + 37 });

describe("zones", () => {
  it("fire wall: arms after 0.4 s, 30 + burning on contact, again after 1 s inside", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10)]);
    const id = zone(s, wallZone(aabb(-5, 0, -10.3, 5, 2.5, -9.7)));
    expect(hitsOn(step(s, 24), 2)).toHaveLength(0);
    const ev = step(s, 61);
    expect([hitsOn(ev, 2).map((e) => e.amount), byId(s, 2).status.burnPulses > 0]).toEqual([[30, 30], true]);
    expect(ev).toContainEqual(expect.objectContaining({ type: "zone", zone: id, phase: "arm" }));
  });

  it("fire trail: 3 damage every 0.5 s to bodies along the segment", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10), dummy(3, 0, -12)]);
    zone(s, { owner: 1, kind: "fireTrail", ability: "jetDash", shape: { type: "segment", a: { x: -3, y: 0, z: -10 }, b: { x: 3, y: 0, z: -10 }, halfW: 0.75 }, bornTick: 0, armTick: 0, endTick: 120 });
    const ev = step(s, 130);
    expect([hitsOn(ev, 2).reduce((a, e) => a + e.amount, 0), hitsOn(ev, 3).length]).toEqual([12, 0]);
  });

  it("pillar: strikes after 0.6 s for 35, launches to 3.5 m, leaves a solid pillar for 4 s", () => {
    const s = createMatchState([mage(), dummy(2, 0, -10)]);
    zone(s, pillarZone(aabb(-0.6, 0, -10.6, 0.6, 2.5, -9.4), 0));
    let top = 0;
    const ev = step(s, 120, (st) => (top = Math.max(top, byId(st, 2).move.body.pos.y)));
    expect(hitsOn(ev, 2)).toEqual([expect.objectContaining({ ability: "stonePillar", amount: 35 })]);
    expect(ev).toContainEqual(expect.objectContaining({ type: "status", target: 2, status: "airborne" }));
    expect(top).toBeCloseTo(3.5, 1);
    expect(s.terrain).toEqual([expect.objectContaining({ kind: "pillar", solid: true, solidTick: 48, endTick: 36 + 240, hp: 200 })]);
    step(s, 200);
    expect(s.terrain).toHaveLength(0);
  });

  it("pillar underfoot lifts its caster onto it without hurting", () => {
    const s = createMatchState([mage()]);
    step(s, 5);
    zone(s, pillarZone(aabb(-0.6, 0, -0.6, 0.6, 2.5, 0.6), s.tick));
    expect(step(s, 120).some((e) => e.type === "hit")).toBe(false);
    expect([s.units[0]!.move.onGround, Number(s.units[0]!.move.body.pos.y.toFixed(6))]).toEqual([true, 2.5]);
  });

  it("quake: 40 and a slow within 7 m, a root within 3 m, nothing for those in the air", () => {
    const s = createMatchState([mage(), dummy(2, 0, -2), dummy(3, 0, -5), dummy(4, 0, -8), dummy(5, 4, 0)]);
    step(s, 5);
    const air = byId(s, 5);
    Object.assign(air.move.body.pos, { y: 1 });
    air.move.body.vel.y = 4;
    air.move.onGround = false;
    zone(s, { owner: 1, kind: "quake", ability: "earthquake", shape: { type: "disc", center: { x: 0, y: 0, z: 0 }, radius: 7 }, bornTick: s.tick, armTick: s.tick, endTick: s.tick + 1 });
    const ev = step(s, 2);
    expect([2, 3, 4, 5].map((id) => hitsOn(ev, id).map((e) => e.amount))).toEqual([[40], [40], [], []]);
    expect(statusFlags(byId(s, 2), s.tick)).toMatchObject({ slowed: true, rooted: true });
    expect(statusFlags(byId(s, 3), s.tick)).toMatchObject({ slowed: true, rooted: false });
  });

  it("keeps at most three zones per mage", () => {
    const s = createMatchState([mage()]);
    const ev: MatchEvent[] = [];
    const ids = [0, 1, 2, 3].map((k) => zone(s, wallZone(aabb(k * 12, 0, -10, k * 12 + 10, 2.5, -9.4)), ev));
    expect(s.zones.map((z) => z.id)).toEqual(ids.slice(1));
    expect(ev).toContainEqual(expect.objectContaining({ type: "zone", zone: ids[0], phase: "end" }));
  });
});
```

`packages/sim/src/match/aim.test.ts` (после заголовка):
```ts
import { aimGround } from "./aim";

describe("aimGround", () => {
  const down8 = -Math.atan2(1.6, 8);
  const at = (s: MatchState, c: MatchContext, yaw: number, pitch: number, range: number) => aimGround(s, tickOf(s, c, []), 1, yaw, pitch, range);
  const round = (p: { x: number; y: number; z: number } | null) => p && [p.x, p.y, p.z].map((v) => Number(v.toFixed(6)));

  it("finds the floor under the crosshair, or the feet of a body on the way", () => {
    expect(round(at(createMatchState([mage()]), ctx, 0, down8, 20))).toEqual([0, 0, -8]);
    expect(at(createMatchState([mage(), dummy(2, 0, -6)]), ctx, 0, down8, 20)).toEqual({ x: 0, y: 0, z: -6 });
  });

  it("drops from the end of the range, or from a wall face, down to the ground", () => {
    expect(round(at(createMatchState([mage()]), ctx, 0, 0, 15))).toEqual([0, 0, -15]);
    const walled = testContext([{ box: aabb(-5, 0, -10.5, 5, 4, -10) }]);
    expect(round(at(createMatchState([mage()]), walled, 0, 0, 15))).toEqual([0, 0, -9.7]);
  });

  it("returns null over the void", () => {
    const s = createMatchState([createMageUnit(1, "fire", { pos: { x: 18, y: 0, z: 0 }, yaw: -Math.PI / 2 })]);
    expect(at(s, ctx, -Math.PI / 2, 0, 15)).toBeNull();
  });
});
```

`packages/sim/src/match/kit.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { aabb } from "../aabb";
import { moveDirXZ, snappedWallBox } from "./kit";
import { NO_MATCH_INPUT } from "./state";

describe("kit helpers", () => {
  it("snaps a wall across the view to the nearest world axis", () => {
    const c = { x: 0, y: 0, z: -10 };
    expect(snappedWallBox(c, 0, 10, 0.5, 2.5)).toEqual(aabb(-5, 0, -10.25, 5, 2.5, -9.75));
    expect(snappedWallBox(c, Math.PI / 2, 10, 0.5, 2.5)).toEqual(aabb(-0.25, 0, -15, 0.25, 2.5, -5));
    expect(snappedWallBox(c, 0.7, 4, 0.5, 2.5)).toEqual(aabb(-2, 0, -10.25, 2, 2.5, -9.75));
  });

  it("moves along the input relative to the view, or forward without input", () => {
    expect([moveDirXZ({ ...NO_MATCH_INPUT, moveX: 1 }), moveDirXZ({ ...NO_MATCH_INPUT })]).toEqual([{ x: 1, z: 0 }, { x: 0, z: -1 }]);
    const d = moveDirXZ({ ...NO_MATCH_INPUT, moveX: 1, moveZ: 1 });
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 12);
  });
});
```

`packages/sim/src/match/match.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deepFreeze, testContext } from "./fixtures";
import { createMatch, respawnMage, stepMatch } from "./match";
import { NO_MATCH_INPUT } from "./state";
import type { MatchState } from "./types";

const ctx = testContext();
const setup = {
  mages: [{ element: "fire" as const, spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 } }],
  dummies: [{ pos: { x: 0, y: 0, z: -10 }, yaw: 0, patrolHalfM: 2 }, { pos: { x: 5, y: 0, z: -5 }, yaw: 0 }],
};

describe("match", () => {
  it("creates mages first, then dummies, with full HP", () => {
    expect(createMatch(setup).units.map((u) => [u.id, u.kind, u.hp])).toEqual([[1, "mage", 150], [2, "dummy", 170], [3, "dummy", 170]]);
  });

  it("advances one tick and never mutates its input", () => {
    const s0 = deepFreeze(createMatch(setup));
    const r = stepMatch(s0, { 1: { ...NO_MATCH_INPUT, moveZ: 1, primary: true, q: true } }, ctx);
    expect([r.state.tick, s0.tick, r.state === s0]).toEqual([1, 0, false]);
  });

  it("keeps plain data: a JSON copy steps exactly like the original", () => {
    let a: MatchState = createMatch(setup);
    for (let k = 0; k < 120; k++) a = stepMatch(a, { 1: { ...NO_MATCH_INPUT, moveX: 1, yaw: k / 40 } }, ctx).state;
    const b = JSON.parse(JSON.stringify(a)) as MatchState;
    const inp = { 1: { ...NO_MATCH_INPUT, moveZ: 1 } };
    expect(JSON.stringify(stepMatch(a, inp, ctx))).toBe(JSON.stringify(stepMatch(b, inp, ctx)));
  });

  it("respawnMage switches the element and keeps the counters", () => {
    const s = createMatch(setup);
    s.units[0]!.mage!.stats.kills = 3;
    const r = respawnMage(s, 1, "earth");
    expect([r.units[0]!.mage!.element, r.units[0]!.hp, r.units[0]!.mage!.stats.kills, s.units[0]!.mage!.element]).toEqual(["earth", 170, 3, "fire"]);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test packages/sim/src/match` → FAIL: `Failed to resolve import "./projectiles"` (и `./zones`, `./aim`, `./kit`, `./match`).

- [ ] **Step 3: Снаряды**

Прохождение отрезка (снаряд, луч прицела) — целиком. Мир — точкой центра через `raycast` вида `"shot"` (стену огня и перила пролетает); тела — отрезок против бокса тела, раздутого на радиус.
```ts
/** Вход отрезка a → a + d в бокс: доля пути t ∈ [0, 1] и нормаль грани входа, или null. */
function segmentBox(a: Vec3, d: Vec3, b: AABB): { t: number; normal: Vec3 } | null {
  let [t0, t1, axis, sign] = [0, 1, null as Axis | null, 0];
  for (const k of AXES) {
    const dk = d[k];
    if (dk === 0) {
      if (a[k] < b.min[k] || a[k] > b.max[k]) return null;
      continue;
    }
    const near = ((dk > 0 ? b.min[k] : b.max[k]) - a[k]) / dk;
    const far = ((dk > 0 ? b.max[k] : b.min[k]) - a[k]) / dk;
    if (near > t0) [t0, axis, sign] = [near, k, dk > 0 ? -1 : 1];
    if (far < t1) t1 = far;
    if (t0 > t1) return null;
  }
  const normal = vec3();
  if (axis) normal[axis] = sign;
  return { t: t0, normal };
}
const inflate = (b: AABB, r: number): AABB => ({ min: { x: b.min.x - r, y: b.min.y - r, z: b.min.z - r }, max: { x: b.max.x + r, y: b.max.y + r, z: b.max.z + r } });

export function sweepSegment(s: MatchState, t: TickCtx, owner: UnitId, from: Vec3, to: Vec3, radiusM: number): SweepHit | null {
  const d = sub(to, from);
  const len = length(d);
  if (len < 1e-9) return null;
  const wall = raycast(t.world, from, scale(d, 1 / len), len, "shot");
  let best: SweepHit | null = wall && { dist: wall.dist, unit: NOBODY, terrain: terrainAt(t, wall.collider), point: wall.point, normal: wall.normal };
  for (const u of s.units) {
    if (!u.alive || u.id === owner) continue;
    const hit = segmentBox(from, d, inflate(bodyBox(u.move.body), radiusM));
    // стена на том же расстоянии или ближе — бьёт стена; из тел на равном расстоянии — меньший id
    if (hit && (!best || hit.t * len < best.dist)) best = { dist: hit.t * len, unit: u.id, terrain: null, point: add(from, scale(d, hit.t)), normal: hit.normal };
  }
  return best;
}
```
`stepProjectiles` (снаряды в порядке массива, гравитация по трапеции, как у тел):
```ts
const def = projectileDef(p.ability);
const vy1 = p.vel.y - def.gravity * TICK_DT;
const to = { x: p.pos.x + p.vel.x * TICK_DT, y: p.pos.y + ((p.vel.y + vy1) / 2) * TICK_DT, z: p.pos.z + p.vel.z * TICK_DT };
const hit = sweepSegment(s, t, p.owner, p.pos, to, def.radiusM);
```
- Попадание: событие `impact` (`target: hit.unit`, `terrain: hit.terrain ?? -1`), снаряд удаляется. Шар — `explodeFireball(s, t, owner, point + normal × 0,05, hit.unit, horizontalDir(vel))`. Кулак и камень: тело — `applyHit({ damage, pos: point, dir: horizontalDir(vel), knock: { distM: PROJECTILE_JUICE_M[ability], upM: 0 } })`, рельеф — `damageTerrain(id, damage, point)`.
- Мимо: `pos = to`, `vel.y = vy1`; `now + 1 >= endTick` — снаряд исчезает, шар взрывается на месте.
- Снаряд, рождённый в этом тике (касты идут раньше), шагает уже в нём: выстрел в упор попадает сразу.

`spawnProjectile`: у владельца уже `projectilesPerMage` — удалить его самый старый; всего `projectilesTotal` — первый. `id = nextId++`, `vel = dir × speed`, `endTick = now + ticks(rangeM / speed)`. Событие `release` пишет кит.

`explodeFireball(s, t, owner, pos, direct, fallbackDir)`: событие `explosion` (`radius: 3`). Для живых не-владельцев:
- `d = 0` у `direct`, иначе расстояние от `pos` до бокса тела; `d > 3` — мимо;
- не `direct`: луч `"shot"` от `pos` к ближайшей точке бокса (её `y` не ниже `box.min.y + 0.2`, чтобы не задеть пол), длина `len − 1e-3`; задел что-то — мимо;
- `f = 1 − 0,6 · d / 3`; `applyHit({ damage: 50·f, knock: { distM: 3·f, upM: 1.2·f }, burn: true, dir: horizontalDir(центр тела − pos) или fallbackDir })`.

Рельеф в радиусе (по копии `s.terrain`) получает `50·f` через `damageTerrain`.

- [ ] **Step 4: Зоны, прицел, общее для китов**

`spawnZone`: лимиты (у владельца 3, всего 16; вытесненной — `zone/end`), `id = nextId++`, `rehit: []`, событие `zone/telegraph`.

`zoneTouches(shape, u)`: `box` — `overlaps(bodyBox, box, OVERLAP_EPS)`; `segment` — по XZ от `pos` тела до отрезка ≤ `halfW + body.halfW`, и тело по Y пересекает [min(a.y, b.y) − 0,5; max + 2]; `disc` — по XZ до центра ≤ `radius` и `|Δy| ≤ EARTH.earthquake.heightM` (диск — только у землетрясения).

`stepZones` — по копии `s.zones`:
```ts
for (const z of [...s.zones]) {
  const zev = (phase: "arm" | "end") => t.ev.push({ type: "zone", zone: z.id, kind: z.kind, owner: z.owner, phase });
  if (t.now >= z.endTick) {
    removeZone(s, z.id);
    zev("end");
    continue;
  }
  if (t.now === z.armTick) zev("arm");
  if (t.now < z.armTick) continue;
  if (z.kind === "fireWall") contact(s, t, z, FIRE.fireWall.contactDamage, ticks(FIRE.fireWall.rehitS), true);
  else if (z.kind === "fireTrail") contact(s, t, z, FIRE.jetDash.trailDps * STATUS.burning.pulseS, ticks(STATUS.burning.pulseS), false);
  else if (t.now === z.armTick) (z.kind === "pillar" ? pillarStrike : quakeStrike)(s, t, z);
}
```
- `contact`: живой не-владелец, которого касается зона и у которого нет записи `rehit` или её `tick <= now`, получает `applyHit({ damage, burn, pos: центр тела, dir: {0, 0} })`; запись `{ unit, tick: now + rehitTicks }`.
- `pillarStrike` (Р9): бокс зоны — будущий столб, основание `base = box.min.y`, центр `c`. Юниты со ступнями в [base − 0,6; base + 1,0]:
  - владелец, если пересекает след столба по XZ: `vel.y = max(vel.y, √(2g·(2,5 + 0,3)))`, `onGround = false`, `coyote = 0`, без урона;
  - остальные, если пересекают след, раздутый на 0,4 м по XZ: `applyHit({ ability: "stonePillar", damage: 35, knock: { distM: 1, upM: 3.5 }, launch: true, dir })`, `dir` — от центра столба к телу, а ровно в центре (< 1e-6) — от владельца к телу;
  - затем `spawnTerrain(s, t, owner, "pillar", box, { growTicks: 6, solidTicks: 12, lifeTicks: 240, hp: 200 })`.
- `quakeStrike`: живые не-владельцы на земле, которых касается диск: `applyHit({ ability: "earthquake", damage: 40, slow: { mul: 0.6, s: 2 }, rootS: d ≤ 3 ? 0.5 : undefined, knock: { distM: 0.5, upM: 0 }, dir: наружу })`, `d` — по XZ до центра.

`aimGround` (Р9) — целиком:
```ts
export function aimGround(s: MatchState, t: TickCtx, caster: UnitId, yaw: number, pitch: number, rangeM: number): Vec3 | null {
  const u = unitById(s, caster);
  if (!u) return null;
  const [eye, dir] = [eyeOf(u), aimDir(yaw, pitch)];
  const ground = (p: Vec3) => groundBelow(t.world, { x: p.x, y: p.y + 0.1, z: p.z }, 30);
  const hit = sweepSegment(s, t, caster, eye, add(eye, scale(dir, rangeM)), 0);
  if (hit && hit.unit !== NOBODY) {
    const p = unitById(s, hit.unit)!.move.body.pos; // прицел на теле — его ступни
    return { x: p.x, y: ground(p) ?? p.y, z: p.z };
  }
  if (hit && hit.normal.y > 0.5) return hit.point;
  const h = horizontalDir({ x: dir.x, z: dir.z });
  // вертикальная грань — шаг 0,3 м назад по горизонтали; дальше — вниз до опоры
  const p = hit ? { x: hit.point.x - h.x * 0.3, y: hit.point.y, z: hit.point.z - h.z * 0.3 } : add(eye, scale(dir, rangeM));
  const y = ground(p);
  return y === null ? null : { x: p.x, y, z: p.z };
}
```
`kit.ts`:
- `castAim(u, inp)`: `const c = sanitizeInput(inp, u.move); return { eye: eyeOf(u), dir: aimDir(c.yaw, c.pitch) }`;
- `moveDirXZ(inp)`: формула `stepPlayer` (`wx = f.x·iz − f.z·ix`, `wz = f.z·iz + f.x·ix`), нормировка, без ввода — `forwardXZ(yaw)`, на выходе `+ 0` против −0; `horizontalDir(v)`: нормированный `{x, z}` или `{0, 0}` при длине < 1e-9;
- `snappedWallBox` (Р6): `alongX = |f.z| ≥ |f.x|` (смотрим вдоль Z — стена тянется вдоль X); полуразмеры `alongX ? (length/2, thick/2) : (thick/2, length/2)`; бокс от `c.y` до `c.y + height`;
- `emitCast`, `rejectCast` — события `cast` и `reject`.

- [ ] **Step 5: Шаг матча**

`match.ts` — `stepMatch` целиком (порядок фиксирован, на нём держится детерминизм):
```ts
const KITS: Readonly<Record<Element, Kit>> = { fire: FIRE_KIT, earth: EARTH_KIT };

export function stepMatch(state: Readonly<MatchState>, inputs: Readonly<Partial<Record<UnitId, MatchInput>>>, ctx: MatchContext): MatchStep {
  const s = clonePlain(state as MatchState);
  const ev: MatchEvent[] = [];
  const tw = buildTickWorld(ctx.world, s);
  const t: TickCtx = { world: tw.world, terrainIds: tw.terrainIds, killBelowY: ctx.killBelowY, now: s.tick, ev };
  const clean: Partial<Record<UnitId, MatchInput>> = {};
  for (const u of s.units) {
    const m = u.mage;
    if (!m) continue;
    const raw = inputs[u.id] ?? NO_MATCH_INPUT;
    const inp: MatchInput = { ...raw, primary: raw.primary === true, q: raw.q === true, e: raw.e === true, c: raw.c === true };
    const pressed: Buttons = { primary: inp.primary && !m.held.primary, q: inp.q && !m.held.q, e: inp.e && !m.held.e, c: inp.c && !m.held.c };
    [clean[u.id], m.held] = [inp, { primary: inp.primary, q: inp.q, e: inp.e, c: inp.c }];
    if (u.alive) KITS[m.element].input(s, t, u, inp, pressed);
  }
  for (const u of s.units) if (u.mage && u.alive) KITS[u.mage.element].tick(s, t, u, clean[u.id]!);
  moveUnits(s, t, clean);
  stepProjectiles(s, t);
  stepZones(s, t);
  stepTerrain(s, t);
  stepStatuses(s, t);
  stepLife(s, t);
  s.tick += 1;
  return { state: s, events: ev };
}
```
`createMatch`: маги с id 1…M, затем манекены, `createMatchState(units)`. `matchContext(arena) = { world: createWorld(arena.colliders, arena.volumes), killBelowY: arena.bounds.min.y }`. `respawnMage`: копия состояния, маг заменяется `createMageUnit(id, element, старый mage.spawn)` с прежними `stats`, его снаряды, зоны и рельеф удаляются, событий нет.

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `pnpm test packages/sim` и `pnpm typecheck` → PASS: 21 новый тест (6 + 6 + 3 + 2 + 4), все прежние зелёные.

- [ ] **Step 7: Коммит**

```bash
git add packages/sim/src/match && git commit -m "feat(sim): projectiles with swept hits, fireball falloff, zones and strikes, aim point, stepMatch" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Киты Огня и Земли

**Поток:** S, после задачи 4. Делится на два параллельных подзадания с непересекающимися файлами: **5F** — `fire.ts` и `fire.test.ts`, **5E** — `earth.ts` и `earth.test.ts`. `determinism.test.ts` пишет тот, кто закончит вторым, или контролёр после слияния обоих.

**Files:**
- Modify: `packages/sim/src/match/fire.ts` (5F), `packages/sim/src/match/earth.ts` (5E) — заглушки задачи 4 заменяются целиком
- Test: `packages/sim/src/match/fire.test.ts` (5F), `earth.test.ts` (5E), `determinism.test.ts` (после обоих)

**Interfaces:**
- Consumes: `Kit`, `castAim`, `moveDirXZ`, `horizontalDir`, `snappedWallBox`, `emitCast`, `rejectCast` (`kit.ts`); `spawnProjectile`; `spawnZone`; `aimGround`; `spawnTerrain`; `mageMoveParams` (`units.ts`); `moveBody`, `groundBelow`, `forwardXZ`, `sanitizeInput`, `TICK_DT`; `FIRE`, `EARTH`, `ticks`, `slotCooldownTicks`; `createMatch`, `stepMatch`.
- Produces: `FIRE_KIT: Kit`, `EARTH_KIT: Kit`. Через `stepMatch` — все события карточек.

Общие правила китов:
- `input` вызывается раз в тик для живого мага: `pressed` — фронты Q/E/C (и ЛКМ), `inp.primary` — удержание. Прицел — `castAim(u, inp)`, точка на земле — `aimGround(s, t, u.id, yaw, pitch, range)` с `yaw`/`pitch` из `sanitizeInput(inp, u.move)`.
- Перезарядка ставится на нажатии: `ready[slot] = now + slotCooldownTicks(...)` (Р14). Отказы: перезарядка → `reject/cooldown`; идёт замах (для ЛКМ, Q, C) → `reject/busy`; Земля без опоры (Q, C) → `reject/notGrounded`; некуда поставить → `reject/noTarget`, перезарядка не тратится. Удержание ЛКМ на перезарядке отказов не шлёт.
- Каждый принятый каст — `emitCast` на тике нажатия: клиент рисует жест, вспышку и звук на этом кадре. Выпуск снаряда — событие `release` с id снаряда (у ЛКМ Огня — тем же тиком).

- [ ] **Step 1 (5F): Написать падающие тесты Огня**

`packages/sim/src/match/fire.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { NO_MATCH_INPUT } from "./state";
import type { DummySpot, Element, MatchEvent, MatchInput, MatchState, Spawn } from "./types";

const ELEMENT: Element = "fire";
const ctx = testContext();
const HOME: Spawn = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
/** Наклон взгляда из глаз (1,6 м) на точку высотой y в d метрах впереди. */
const pitchTo = (d: number, y = 1) => Math.atan2(y - 1.6, d);
const at = (z: number, x = 0): DummySpot => ({ pos: { x, y: 0, z }, yaw: 0 });
type Log = { t: number; e: MatchEvent }[];
/** Маг в spawn и манекены; ввод по относительному тику k. log — события с относительным тиком. */
function play(dummies: DummySpot[], n: number, input: (k: number, s: MatchState) => Partial<MatchInput>, spawn: Spawn = HOME) {
  let s = createMatch({ mages: [{ element: ELEMENT, spawn }], dummies });
  for (let k = 0; k < 5; k++) s = stepMatch(s, {}, ctx).state;
  const start = s.tick;
  const log: Log = [];
  for (let k = 0; k < n; k++) {
    const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, ...input(k, s) } }, ctx);
    s = r.state;
    for (const e of r.events) log.push({ t: k, e });
  }
  return { s, log, start };
}
const ticksOf = (log: Log, type: MatchEvent["type"], ability: string) => log.filter(({ e }) => e.type === type && "ability" in e && e.ability === ability).map(({ t }) => t);
const hitsOf = (log: Log, ability: string) => log.flatMap(({ t, e }) => (e.type === "hit" && e.ability === ability ? [{ t, e }] : []));
const reject = (t: number, slot: string, reason: string) => ({ t, e: expect.objectContaining({ type: "reject", slot, reason }) });

describe("Fire kit", () => {
  it("fists: 5 shots a second while LMB is held, 12 damage each", () => {
    const { log } = play([at(-10)], 80, () => ({ primary: true, pitch: pitchTo(10) }));
    expect(ticksOf(log, "cast", "fireFists").slice(0, 5)).toEqual([0, 12, 24, 36, 48]);
    expect(ticksOf(log, "release", "fireFists").slice(0, 5)).toEqual([0, 12, 24, 36, 48]);
    const hits = hitsOf(log, "fireFists");
    expect([hits.length >= 5, hits.every(({ e }) => e.amount === 12)]).toEqual([true, true]);
  });

  it("heat: +8 a shot; at 100 the rate halves for 1.5 s while heat drains; cools 35/s after 0.3 s idle", () => {
    const { log } = play([], 300, () => ({ primary: true }));
    const shots = ticksOf(log, "cast", "fireFists");
    expect(shots.slice(0, 13)).toEqual(Array.from({ length: 13 }, (_, k) => 12 * k));
    const on = log.find(({ e }) => e.type === "overheat" && e.on)!.t;
    const off = log.find(({ e }) => e.type === "overheat" && !e.on)!.t;
    expect([on, off, shots.filter((t) => t > on && t < off)]).toEqual([144, 234, [168, 192, 216]]);
    const idle = play([], 109, (k) => ({ primary: k < 49 })).s;
    expect(idle.units[0]!.mage!.heat).toBeCloseTo(40 - (42 * 35) / 60, 9);
  });

  it("fireball: 0.25 s windup, 50 with burning on a hit, 8 s cooldown", () => {
    const { log } = play([at(-10)], 500, (k) => ({ q: k === 0 || k === 100 || k === 480, pitch: pitchTo(10) }));
    expect([ticksOf(log, "cast", "fireball"), ticksOf(log, "release", "fireball")[0], hitsOf(log, "burning").length]).toEqual([[0, 480], 15, 6]);
    expect(hitsOf(log, "fireball")[0]!.e).toMatchObject({ amount: 50, target: 2 });
    expect(log).toContainEqual(reject(100, "q", "cooldown"));
  });

  it("jet dash: 8 m in 0.2 s along the strafe, leaving a 2 s burning trail", () => {
    const { log, s } = play([at(0, 4)], 200, (k) => ({ e: k === 0, moveX: k === 0 ? 1 : 0 }));
    expect(log).toContainEqual({ t: 0, e: expect.objectContaining({ type: "dash", phase: "start" }) });
    expect(log.find(({ e }) => e.type === "dash" && e.phase === "end")!.t).toBe(11);
    const x = s.units[0]!.move.body.pos.x;
    const dmg = hitsOf(log, "jetDash").reduce((a, { e }) => a + e.amount, 0);
    expect([x > 7.9, x < 8.6, dmg >= 12, dmg <= 15]).toEqual([true, true, true, true]);
  });

  it("fire wall: under the crosshair, across the view, arms after 0.4 s, 30 + burning; refused over the void", () => {
    const { log, s } = play([at(-10, 3)], 40, (k) => ({ c: k === 0, pitch: -Math.atan2(1.6, 10) }));
    const z = s.zones.find((q) => q.kind === "fireWall")!;
    if (z.shape.type !== "box") throw new Error("box expected");
    const b = z.shape.box;
    expect([b.min.x, b.max.x, (b.min.z + b.max.z) / 2, b.min.y, b.max.y].map((v) => Number(v.toFixed(6)))).toEqual([-5, 5, -10, 0, 2.5]);
    expect(hitsOf(log, "fireWall")[0]).toEqual({ t: 24, e: expect.objectContaining({ amount: 30, target: 2 }) });
    const edge = play([], 2, () => ({ c: true, yaw: -Math.PI / 2 }), { pos: { x: 18, y: 0, z: 0 }, yaw: -Math.PI / 2 });
    expect(edge.log).toContainEqual(reject(0, "c", "noTarget"));
    expect(edge.s.units[0]!.mage!.ready.c).toBeLessThanOrEqual(edge.s.tick);
  });

  it("«Кураж»: a kill clears heat and refreshes the dash", () => {
    const { log, s, start } = play([at(-10)], 150, (k, st) => {
      if (k === 0) Object.assign(st.units[1]!, { hp: 20, lastHitTick: st.tick });
      const p = st.units[0]!.move.body.pos;
      return { e: k === 0, moveX: k === 0 ? -1 : 0, primary: k >= 30, yaw: Math.atan2(p.x, 10 + p.z), pitch: pitchTo(Math.hypot(p.x, 10 + p.z)) };
    });
    const kill = log.find(({ e }) => e.type === "courage")!;
    expect(s.units[0]!.mage!.ready.e).toBeLessThanOrEqual(start + kill.t);
  });
});
```

- [ ] **Step 2 (5F): Убедиться, что тесты падают**

Run: `pnpm test packages/sim/src/match/fire` → FAIL: касты не выходят (`FIRE_KIT` — заглушка).

- [ ] **Step 3 (5F): Кит Огня**

```ts
const FF = FIRE.fireFists;
const H = FIRE.heat;
const FIST_TICKS = ticks(1 / FF.ratePerS); // 12
const FIST_HOT_TICKS = ticks(1 / (FF.ratePerS * H.overheatRateMul)); // 24
const OVERHEAT_TICKS = ticks(H.overheatS); // 90
const COOL_DELAY_TICKS = ticks(H.coolDelayS); // 18
const DASH_TICKS = ticks(FIRE.jetDash.durationS); // 12
const DASH_SPEED = FIRE.jetDash.distM / FIRE.jetDash.durationS; // 40 м/с
```
`input`:
1. **ЛКМ** (удержание, без замаха шара, `now >= ready.primary`): `lastShotTick = now`; если не перегрет — `heat = min(100, heat + 8)`, и на 100 — `overheatUntil = now + 90`, событие `overheat {on: true}`. Затем `ready.primary = now + (now < overheatUntil ? 24 : 12)` — 13-й выстрел, включивший перегрев, уже ставит 24. Снаряд `fireFists` из `castAim`; события `cast` и `release`.
2. **Q** (фронт): перезарядка / замах → отказ. Иначе `ready.q = now + 480`, `windup = { ability: "fireball", slot: "q", releaseTick: now + 15 }`, `cast`.
3. **E** (фронт, замах не мешает): `now < rootUntil || now < noControlUntil` → `reject/rooted`; перезарядка → отказ. Иначе:
   - `dir = moveDirXZ(inp)`, `ready.e = now + 480`, `u.kb = {0, 0}` (Р15);
   - зона следа: `spawnZone({ kind: "fireTrail", ability: "jetDash", shape: { type: "segment", a: pos, b: pos, halfW: 0.75 }, bornTick: now, armTick: now, endTick: now + 12 + 120 })`;
   - `dash = { dirX, dirZ, endTick: now + 12, trailZone }`; события `cast`, `dash/start`.
4. **C** (фронт): перезарядка → отказ. `P = aimGround(range 15)`; `null` → `reject/noTarget`. Иначе `box = snappedWallBox(P, yaw, 10, 0.6, 2.5)`, `spawnZone({ kind: "fireWall", shape: { type: "box", box }, bornTick: now, armTick: now + 24, endTick: now + 24 + 300 })`, `ready.c = now + 720`, `cast`.

`tick` (после `input` того же тика):
```ts
const m = u.mage!;
const now = t.now;
// замах шара
if (m.windup && now >= m.windup.releaseTick) {
  const aim = castAim(u, inp);
  const id = spawnProjectile(s, t, u.id, "fireball", aim.eye, aim.dir);
  t.ev.push({ type: "release", unit: u.id, ability: "fireball", projectile: id, pos: aim.eye, dir: aim.dir });
  m.windup = null;
}
// жар (Р5)
if (now < m.overheatUntil) m.heat = (H.max * (m.overheatUntil - now - 1)) / OVERHEAT_TICKS;
else if (m.overheatUntil > 0 && now === m.overheatUntil) {
  m.heat = 0;
  t.ev.push({ type: "overheat", unit: u.id, on: false });
} else if (now - m.lastShotTick > COOL_DELAY_TICKS) m.heat = Math.max(0, m.heat - H.coolPerS * TICK_DT);
// рывок: горизонтально, без гравитации, через moveBody со стенами
if (m.dash) {
  const b = u.move.body;
  b.vel = { x: m.dash.dirX * DASH_SPEED, y: 0, z: m.dash.dirZ * DASH_SPEED };
  const r = moveBody(t.world, b, TICK_DT, u.move.onGround);
  u.move.onGround = r.onGround;
  const trail = s.zones.find((z) => z.id === m.dash!.trailZone);
  if (trail && trail.shape.type === "segment") trail.shape.b = { ...b.pos };
  if (r.hitWall || now + 1 >= m.dash.endTick) {
    const run = mageMoveParams("fire").runSpeed;
    b.vel = { x: m.dash.dirX * run, y: 0, z: m.dash.dirZ * run };
    if (trail) trail.endTick = now + 1 + ticks(FIRE.jetDash.trailS);
    t.ev.push({ type: "dash", unit: u.id, phase: "end", pos: { ...b.pos }, dir: { x: m.dash.dirX, y: 0, z: m.dash.dirZ } });
    m.dash = null;
  }
}
```
`moveUnits` пропускает мага в рывке, поэтому за тик тело двигается один раз.

- [ ] **Step 4 (5F): Убедиться, что тесты проходят и закоммитить**

Run: `pnpm test packages/sim/src/match/fire` → PASS, 6 тестов.
```bash
git add packages/sim/src/match/fire.ts packages/sim/src/match/fire.test.ts && git commit -m "feat(sim): Fire kit — fists with soft overheat, fireball, jet dash with trail, fire wall" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5 (5E): Написать падающие тесты Земли**

`packages/sim/src/match/earth.test.ts` — заголовок копирует всё до `describe` из `fire.test.ts`, с `ELEMENT: Element = "earth"` и импортом `statusFlags` из `./state`:
```ts
describe("Earth kit", () => {
  it("stone shot: 0.2 s windup, 30 damage, every 32 ticks while held", () => {
    const { log } = play([at(-12)], 120, () => ({ primary: true, pitch: pitchTo(12, 1.3) }));
    expect([ticksOf(log, "cast", "stoneShot"), ticksOf(log, "release", "stoneShot")]).toEqual([[0, 32, 64, 96], [12, 44, 76, 108]]);
    const hits = hitsOf(log, "stoneShot");
    expect([hits.length >= 3, hits.every(({ e }) => e.amount === 30)]).toEqual([true, true]);
  });

  it("pillar: at the target after 0.6 s of cracks, 35 and a launch, cover 1.2 × 1.2 × 2.5 for 4 s", () => {
    const { log, s } = play([at(-12)], 100, (k) => ({ q: k === 0, pitch: pitchTo(12, 0.5) }));
    expect(log).toContainEqual({ t: 0, e: expect.objectContaining({ type: "zone", kind: "pillar", phase: "telegraph" }) });
    expect(hitsOf(log, "stonePillar")[0]).toEqual({ t: 36, e: expect.objectContaining({ amount: 35, target: 2 }) });
    expect(log.some(({ e }) => e.type === "status" && e.status === "airborne" && e.target === 2)).toBe(true);
    const p = s.terrain.find((q) => q.kind === "pillar")!;
    const size = [p.box.max.y - p.box.min.y, p.box.max.x - p.box.min.x, (p.box.min.z + p.box.max.z) / 2].map((v) => Number(v.toFixed(6)));
    expect([size, p.endTick - p.bornTick]).toEqual([[2.5, 1.2, -12], 240]);
  });

  it("pillar needs ground underfoot, has a 10 s cooldown, and lifts its caster when cast underfoot", () => {
    const { log } = play([at(-12)], 700, (k) => ({ jump: k === 0, q: k === 5 || k === 100 || k === 640, pitch: pitchTo(12, 0.5) }));
    expect(log).toContainEqual(reject(5, "q", "notGrounded"));
    expect(ticksOf(log, "cast", "stonePillar")).toEqual([100]);
    expect(log).toContainEqual(reject(640, "q", "cooldown"));
    const self = play([], 120, (k) => ({ q: k === 0, pitch: -1.5 }));
    expect(self.log.some(({ e }) => e.type === "hit")).toBe(false);
    expect([self.s.units[0]!.move.onGround, Number(self.s.units[0]!.move.body.pos.y.toFixed(6))]).toEqual([true, 2.5]);
  });

  it("stone wall: 2 m ahead, 4 × 2.5 × 0.6, solid after 0.2 s, holds stones until 250 HP are gone", () => {
    const b = play([], 1, () => ({ e: true })).s.terrain[0]!.box;
    expect([b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z].map((v) => Number(v.toFixed(6)))).toEqual([-2, 2, 0, 2.5, -2.3, -1.7]);
    const { log } = play([at(-6)], 380, (k) => ({ e: k === 0, primary: k >= 14 && k < 290, pitch: pitchTo(2, 1.2) }));
    const phase = (p: string) => log.find(({ e }) => e.type === "terrain" && e.phase === p)?.t;
    expect([phase("rise"), phase("solid"), phase("break") !== undefined]).toEqual([0, 12, true]);
    expect(log.some(({ e }) => e.type === "hit" && e.target === 2)).toBe(false);
  });

  it("earthquake: 0.4 s windup, 40 and a slow in 7 m, a root within 3 m, needs ground", () => {
    const { log, s } = play([at(-2), at(-5), at(-8)], 30, (k) => ({ c: k === 0 }));
    expect(hitsOf(log, "earthquake").map(({ t, e }) => [t, e.target, e.amount])).toEqual([[24, 2, 40], [24, 3, 40]]);
    expect([statusFlags(s.units[1]!, s.tick), statusFlags(s.units[2]!, s.tick)]).toEqual([
      expect.objectContaining({ slowed: true, rooted: true }),
      expect.objectContaining({ slowed: true, rooted: false }),
    ]);
    expect(play([], 10, (k) => ({ jump: k === 0, c: k === 3 })).log).toContainEqual(reject(3, "c", "notGrounded"));
  });
});
```

- [ ] **Step 6 (5E): Убедиться, что тесты падают**

Run: `pnpm test packages/sim/src/match/earth` → FAIL: `EARTH_KIT` ещё заглушка.

- [ ] **Step 7 (5E): Кит Земли**

`input`:
1. **ЛКМ** (удержание, без замаха, `now >= ready.primary`): `ready.primary = now + 32`, `windup = { ability: "stoneShot", slot: "primary", releaseTick: now + 12 }`, `cast`.
2. **Q** (фронт): не на земле → `reject/notGrounded`; перезарядка или замах → отказ; `P = aimGround(range 20)`, `null` → `reject/noTarget`.
   - Под себя (Р9): расстояние по XZ от мага до P < 0,9 м → центр — позиция мага, основание — `pos.y`.
   - Бокс `aabb(cx − 0.6, base, cz − 0.6, cx + 0.6, base + 2.5, cz + 0.6)`.
   - `spawnZone({ kind: "pillar", ability: "stonePillar", shape: { type: "box", box }, bornTick: now, armTick: now + 36, endTick: now + 37 })`; `ready.q = now + 600`; `cast`.
3. **E** (фронт): перезарядка → отказ. `f = forwardXZ(yaw)`, центр — `pos + f · 2`. Основание — `groundBelow(world, { cx, pos.y + 0.6, cz }, 3) ?? pos.y`. `box = snappedWallBox({ cx, base, cz }, yaw, 4, 0.6, 2.5)`. Затем `spawnTerrain(..., "wall", box, { growTicks: 18, solidTicks: 12, lifeTicks: 360, hp: 250 })`, `ready.e = now + 720`, `cast`. В воздухе тоже можно: «Корни» запрещают только Q и C.
4. **C** (фронт): не на земле → `reject/notGrounded`; перезарядка или замах → отказ. `spawnZone({ kind: "quake", ability: "earthquake", shape: { type: "disc", center: pos, radius: 7 }, bornTick: now, armTick: now + 24, endTick: now + 25 })`, `ready.c = now + 840`, `cast`.

`tick`: замах камня на `releaseTick` → снаряд `stoneShot` из `castAim` на тике выпуска, событие `release`, `windup = null`.

- [ ] **Step 8 (5E): Убедиться, что тесты проходят и закоммитить**

Run: `pnpm test packages/sim/src/match/earth` → PASS, 5 тестов.
```bash
git add packages/sim/src/match/earth.ts packages/sim/src/match/earth.test.ts && git commit -m "feat(sim): Earth kit — stone shot, pillar with self-lift, stone wall, earthquake; «Корни» ground rule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Детерминизм (после 5F и 5E)**

`packages/sim/src/match/determinism.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deepFreeze, testContext } from "./fixtures";
import { createMatch, stepMatch } from "./match";
import { NO_MATCH_INPUT } from "./state";
import { ELEMENTS, type Element, type MatchEvent, type MatchInput, type MatchState } from "./types";

const ctx = testContext();
/** Ввод по номеру тика: бег, стрейф, прыжки, поворот, все кнопки. */
const script = (n: number): MatchInput => ({
  ...NO_MATCH_INPUT, moveZ: n % 200 < 100 ? 1 : -1, moveX: n % 120 < 60 ? 1 : -1, jump: n % 90 === 0, yaw: Math.sin(n / 50) * 0.8, pitch: -0.15,
  primary: n % 70 < 40, q: n % 150 === 10, e: n % 170 === 20, c: n % 230 === 30,
});
const dummies = [{ pos: { x: 0, y: 0, z: -10 }, yaw: 0, patrolHalfM: 2 }, { pos: { x: 4, y: 0, z: -6 }, yaw: 0 }, { pos: { x: 15, y: 0, z: -4 }, yaw: 0 }];
function runScript(el: Element, n: number, from?: MatchState): { s: MatchState; events: MatchEvent[] } {
  let s = from ?? createMatch({ mages: [{ element: el, spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 } }], dummies });
  const events: MatchEvent[] = [];
  for (let k = 0; k < n; k++) {
    const r = stepMatch(deepFreeze(s), { 1: script(s.tick) }, ctx); // замороженный вход: любая запись в него бросит TypeError
    s = r.state;
    events.push(...r.events);
  }
  return { s, events };
}

describe.each(ELEMENTS)("stepMatch determinism (%s)", (el) => {
  it("gives byte-identical states and events for the same inputs, without mutating them", () => {
    const [a, b] = [runScript(el, 900), runScript(el, 900)];
    expect([JSON.stringify(a.s) === JSON.stringify(b.s), JSON.stringify(a.events) === JSON.stringify(b.events)]).toEqual([true, true]);
    expect([a.events.filter((e) => e.type === "cast").length > 10, a.events.some((e) => e.type === "hit")]).toEqual([true, true]);
  });

  it("continues identically from a JSON copy of the state", () => {
    const half = runScript(el, 300).s;
    const copy = JSON.parse(JSON.stringify(half)) as MatchState;
    expect(JSON.stringify(runScript(el, 300, half).s)).toBe(JSON.stringify(runScript(el, 300, copy).s));
  });
});
```
Run: `pnpm test packages/sim` и `pnpm typecheck` → PASS, 4 новых теста; весь `sim` зелёный.
```bash
git add packages/sim/src/match/determinism.test.ts && git commit -m "test(sim): stepMatch determinism and JSON round trip for both kits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Рендер магии, манекены, рельеф

**Поток:** V, после задачи 1. Симуляции пока нет: всё проверяется на синтетическом состоянии в `/fx-test`.

**Files:**
- Modify: `apps/client/src/render/{palette,palette.test,gbuffer,styleRenderer}.ts`, `apps/client/src/main.ts` (маршрут `/fx-test`)
- Create: `apps/client/src/fx/{fxShader,particles,presets,interp,glows,decals,fireWalls,projectileMeshes,terrainMeshes,dummyMeshes,debris,vfx,fxTestPage}.ts`
- Test: `apps/client/src/fx/fx.test.ts`

**Interfaces:**
- Consumes: из `@doodlemagic/sim` — `MatchState`, `Unit`, `Zone`, `Terrain`, `Projectile`, `Vec3`, `UnitId`, `statusFlags`, `FIRE`, `EARTH`, `TICK_DT`; из `feel/effects.ts` — `Effect`, `BurstPreset`, `BURST_PRESETS`; `PresetId`; `StyleRenderer`, `WORLD_FOV`, `HANDS_FOV`, `OVERLAY_DEPTH_RANGE`, `createInkMaterial`, `INK`.
- Produces:
  - `palette.ts`: `INK.halo = 10`, `INK.flash = 11`, `INK.terrain = 12`, `INK_COUNT = 13`.
  - `gbuffer.ts`: `createInkMaterial(ink: number, sun?: SunUniform, opts?: { instanceInk?: boolean; side?: Side }): ShaderMaterial` — поддерживает `InstancedMesh`, с `instanceInk` берёт чернила из атрибута экземпляра `aInk`.
  - `styleRenderer.ts`: `interface FxLayers { world: Scene; palm: Scene }`; `render(world: Scene, overlay?: Scene, fx?: FxLayers): void`; `warmUp(world: Scene, overlay?: Scene, fx?: FxLayers): Promise<void>`; `readonly gbuffer: { surface: Texture; depth: DepthTexture; invDepth: Vector2 }`.
  - `fx/vfx.ts`:
    - `interface VfxView { prev: MatchState; cur: MatchState; alpha: number; nowS: number; camera: PerspectiveCamera; localId: UnitId; palms: { right: Vector3; left: Vector3 } }` — ладони в пространстве камеры рук;
    - `interface Vfx { readonly worldGroup: Group; readonly fx: FxLayers; apply(e: Effect, nowS: number, hand: "left" | "right"): void; sync(v: VfxView): void; setPreset(p: PresetId): void; dispose(): void }` — `apply` исполняет `burst`, `palm`, `flash`, `flinch`, остальное пропускает;
    - `createVfx(gbuffer: StyleRenderer["gbuffer"], preset: PresetId): Vfx`.
  - Чистые части (тесты): `interp.ts` — `lerpById<T extends { id: number; pos: Vec3 }>(prev: readonly T[], cur: readonly T[], alpha: number): T[]`, `muzzleBlend(ageS: number): number`, `handToWorldView(p: Vec3, handsFovDeg: number, worldFovDeg: number): Vec3`; `presets.ts` — `PARTICLE_BUDGET`, `FX_COLOR`, `interface ParticleSpec { pos: Vec3; vel: Vec3; gravity: number; life: number; size0: number; size1: number; color: readonly [number, number, number]; alpha: number }`, `burstParticles(p: BurstPreset, pos: Vec3, dir: Vec3, scale: number, rng: () => number): ParticleSpec[]`; `particles.ts` — `allocateRing(head: number, cap: number, n: number): { head: number; ranges: { start: number; count: number }[] }`; `dummyMeshes.ts` — `interface DummyPose { pos: Vec3; yaw: number; leanX: number; leanZ: number; flinch: number; squash: number; flash: boolean; bob: number }`, `interface DummyPart { part: "base" | "post" | "body" | "head" | "mask" | "handL" | "handR"; ink: number; pos: [number, number, number]; scale: [number, number, number]; yaw: number; tiltX: number; tiltZ: number }`, `dummyParts(p: DummyPose): DummyPart[]`, `haloMargin(distM: number, viewportH: number, fovDeg: number): number`; `terrainMeshes.ts` — `terrainVisualBox(t: Terrain, nowTick: number): AABB`; `decals.ts` — `interface DecalSpec { stage: "telegraph" | "active"; progress: number; shape: "rect" | "ring" | "segment"; style: "sparks" | "cracks" | "quake" | "embers"; center: Vec3; sizeX: number; sizeZ: number; angle: number }`, `zoneDecal(z: Zone, nowTick: number): DecalSpec | null`.

- [ ] **Step 1: Написать падающие тесты**

В `render/palette.test.ts` дополнить `WORLD` чернилами `"terrain"` (прежние тесты трёх слоёв сразу проверят его как мир) и добавить:
```ts
it("adds the enemy halo, the hit flash and Earth terrain inks", () => {
  expect([INK.halo, INK.flash, INK.terrain, INK_COUNT]).toEqual([10, 11, 12, 13]);
  for (const ink of ["halo", "flash"] as const) {
    for (const c of bands(ink)) {
      expect(luminance(c)).toBeGreaterThanOrEqual(luminance(PAPER));
      expect(saturation(c)).toBeLessThanOrEqual(0.05);
    }
  }
});
```
(импорт `PAPER` из `./palette`).

`apps/client/src/fx/fx.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Terrain, Zone } from "@doodlemagic/sim";
import { BURST_PRESETS } from "../feel/effects";
import { INK } from "../render/palette";
import { zoneDecal } from "./decals";
import { dummyParts, haloMargin, type DummyPose } from "./dummyMeshes";
import { handToWorldView, lerpById, muzzleBlend } from "./interp";
import { allocateRing } from "./particles";
import { FX_COLOR, burstParticles } from "./presets";
import { terrainVisualBox } from "./terrainMeshes";

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
const rng = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pose: DummyPose = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, leanX: 0, leanZ: 0, flinch: 0, squash: 1, flash: false, bob: 0 };
const O = { x: 0, y: 1, z: 0 };

describe("fx pure parts", () => {
  it("wraps the particle ring; every burst ≤ 150; fire is additive light, earth dust is paper-coloured", () => {
    expect(allocateRing(4, 10, 8)).toEqual({ head: 2, ranges: [{ start: 4, count: 6 }, { start: 0, count: 2 }] });
    expect(allocateRing(3, 10, 25).ranges.reduce((a, r) => a + r.count, 0)).toBe(10);
    for (const id of BURST_PRESETS) expect(burstParticles(id, O, O, 1, rng()).length).toBeLessThanOrEqual(150);
    expect(burstParticles("fireballBoom", O, O, 1, rng()).some((p) => p.alpha === 0)).toBe(true);
    expect(burstParticles("wallDust", O, O, 1, rng()).every((p) => p.alpha > 0 && Math.abs(p.color[0] - FX_COLOR.dust[0]) < 0.08)).toBe(true);
  });

  it("lerps by id, snaps jumps over 3 m, and blends a fresh projectile from the palm in 0.15 s", () => {
    const prev = [{ id: 1, pos: { x: 0, y: 0, z: 0 } }, { id: 3, pos: { x: 0, y: 0, z: 0 } }];
    const cur = [{ id: 1, pos: { x: 2, y: 0, z: 0 } }, { id: 2, pos: { x: 5, y: 1, z: 0 } }, { id: 3, pos: { x: 10, y: 0, z: 0 } }];
    expect(lerpById(prev, cur, 0.25).map((p) => p.pos.x)).toEqual([0.5, 5, 10]);
    expect([muzzleBlend(0), muzzleBlend(0.15), muzzleBlend(0.3), muzzleBlend(0.05) > muzzleBlend(0.1)]).toEqual([1, 0, 0, true]);
    const p = { x: 0.26, y: -0.25, z: -0.62 };
    const q = handToWorldView(p, 60, 70);
    const ndc = (v: typeof p, fov: number) => v.x / (-v.z * Math.tan((fov * Math.PI) / 360));
    expect([Number((ndc(q, 70) - ndc(p, 60)).toFixed(9)), q.z]).toEqual([0, p.z]);
  });

  it("builds a dark dummy with a white mask toward −Z, inverts it on a hit, keeps the halo ~2 px", () => {
    const parts = dummyParts(pose);
    expect(parts.every((p) => p.pos[1] - p.scale[1] / 2 >= -1e-9 && p.pos[1] + p.scale[1] / 2 <= 1.8 + 1e-9)).toBe(true);
    const mask = parts.find((p) => p.part === "mask")!;
    expect([mask.ink, mask.pos[2] < parts.find((p) => p.part === "head")!.pos[2]]).toEqual([INK.halo, true]);
    const lit = dummyParts({ ...pose, flash: true });
    expect([lit.filter((p) => p.part !== "mask").every((p) => p.ink === INK.flash), lit.find((p) => p.part === "mask")!.ink]).toEqual([true, INK.enemy]);
    expect(dummyParts({ ...pose, yaw: Math.PI / 2 }).find((p) => p.part === "mask")!.pos[0]).toBeLessThan(-0.1);
    expect(haloMargin(15, 1080, 70)).toBeCloseTo((2 * 15 * Math.tan((35 * Math.PI) / 180)) / 540, 9);
    expect(haloMargin(1, 1080, 70)).toBe(0.02);
  });

  it("raises terrain out of the ground and runs telegraphs from cast to arm", () => {
    const t = { id: 1001, owner: 1, kind: "wall", box: box(-2, 0, -2.3, 2, 2.5, -1.7), bornTick: 100, solidTick: 112, endTick: 460, growTicks: 18, solid: false, hp: 250, maxHp: 250 } as Terrain;
    expect([terrainVisualBox(t, 100).max.y, terrainVisualBox(t, 109).max.y > 1, terrainVisualBox(t, 118).max.y, terrainVisualBox(t, 459).max.y < 0.5]).toEqual([0, true, 2.5, true]);
    const wall = { id: 1, owner: 1, kind: "fireWall", ability: "fireWall", shape: { type: "box", box: box(-5, 0, -10.3, 5, 2.5, -9.7) }, bornTick: 100, armTick: 124, endTick: 424, rehit: [] } as Zone;
    expect(zoneDecal(wall, 100)).toMatchObject({ stage: "telegraph", progress: 0, shape: "rect", style: "sparks" });
    expect([zoneDecal(wall, 112)!.progress, zoneDecal(wall, 124)!.stage]).toEqual([0.5, "active"]);
    const quake = { ...wall, kind: "quake", ability: "earthquake", shape: { type: "disc", center: { x: 0, y: 0, z: 0 }, radius: 7 }, endTick: 125 } as Zone;
    expect([zoneDecal(quake, 110), zoneDecal(quake, 124)]).toEqual([expect.objectContaining({ shape: "ring", sizeX: 14, style: "quake" }), null]);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test apps/client/src/fx apps/client/src/render` → FAIL: нет модулей `./decals`, `./dummyMeshes`… и чернил `halo`.

- [ ] **Step 3: Палитра и G-буфер**

`palette.ts` — три новых чернила (номера 10–12, `INK_COUNT = 13`):
```ts
  // белый ореол врага (GDD 6) — ярче бумаги, кромка мягкая
  halo: { wash: [1, 1, 1], bands: [1, 1, 1], line: [0.72, 0.71, 0.68] },
  // инверсия попадания на 60 мс: тёмная тушь врага становится бумагой
  flash: { wash: [1, 0.99, 0.96], bands: [1, 1, 1], line: [0.3, 0.3, 0.3] },
  // камень Земли: средний тон, чуть светлее и теплее камня арены
  terrain: { wash: [0.36, 0.35, 0.32], bands: [0.3, 0.52, 0.72], line: [0.1, 0.09, 0.08] },
```
`gbuffer.ts` — вершинный шейдер получает ветку инстансинга (без неё путь прежний, байт в байт), чернила идут через varying:
```glsl
uniform vec3 uSunDir;
uniform float uInk;
varying vec3 vViewNormal;
varying float vTone;
varying float vInk;
#ifdef INSTANCE_INK
attribute float aInk;
#endif
void main() {
#ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
  vec3 n = normalize(mat3(m) * normal);
  vViewNormal = normalize(mat3(viewMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
#else
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#endif
  vTone = dot(n, uSunDir) * 0.5 + 0.5;
#ifdef INSTANCE_INK
  vInk = aInk;
#else
  vInk = uInk;
#endif
}
```
Во фрагментном — `varying float vInk;` вместо `uniform float uInk;` и `vInk / 255.0` в канале G. `createInkMaterial(ink, sun = worldSun, opts = {})`: `defines: opts.instanceInk ? { INSTANCE_INK: "" } : {}`, `side: opts.side ?? FrontSide`. Для экземпляров только боксы и сферы с поворотом и масштабом по осям: `mat3(m) * normal` для них верен.

`styleRenderer.ts`:
- в конструкторе `this.gbuffer = { surface: this.target.texture, depth, invDepth: new Vector2(1, 0) }`;
- `render(world, overlay, fx)`: после `gl.render(this.postScene, this.postCamera)`, если есть `fx`, — `inverseDepth(this.camera.near, this.camera.far, 1, this.gbuffer.invDepth)`, `gl.render(fx.world, this.camera)`, `gl.render(fx.palm, this.overlayCamera)`. Холст без буфера глубины, поэтому у материалов прохода света `depthTest: false`, `depthWrite: false`;
- `warmUp` дополнительно компилирует `fx.world` с камерой мира и `fx.palm` с камерой рук (цель — экран, как в игре), потом рисует один кадр с `fx`.

- [ ] **Step 4: Проход света (Р1)**

`fx/fxShader.ts` — общий кусок GLSL всех материалов света (defines: `OVERLAY_BAND`, `INK_ENEMY`, `INK_HALO`, `INK_FLASH`; uniforms `gDepth`, `gSurface`, `uInvDepth` — общие объекты из `renderer.gbuffer`):
```glsl
uniform sampler2D gDepth;
uniform sampler2D gSurface;
uniform vec2 uInvDepth;
float fxDist(float d) { return 1.0 / (uInvDepth.x - uInvDepth.y * d); }
// 0 — фрагмент за миром или за рукой; у пересечения с миром мягко гаснет на softM метрах;
// над тушью врага, его ореолом и вспышкой — четверть: магический свет на врага не падает, силуэт читается
float fxVisibility(float softM) {
#ifdef FX_NO_DEPTH
  return 1.0;
#else
  ivec2 p = ivec2(gl_FragCoord.xy);
  float d = texelFetch(gDepth, p, 0).r;
  if (d < OVERLAY_BAND) return 0.0;
  float gap = fxDist(d) - fxDist(gl_FragCoord.z);
  if (gap <= 0.0) return 0.0;
  float vis = clamp(gap / softM, 0.0, 1.0);
  int ink = int(texelFetch(gSurface, p, 0).g * 255.0 + 0.5);
  if (ink == INK_ENEMY || ink == INK_HALO || ink == INK_FLASH) vis *= 0.25;
  return vis;
#endif
}
```
Смешивание у всех материалов света — предумноженная альфа: `blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor`. Альфа 0 — чистое сложение (свет огня, нефрит). Альфа > 0 — плотное (пыль цвета бумаги, дым, тёмные трещины телеграфа, лист стены огня). Порядок в `fx.world`: стены огня → телеграфы → частицы → ореолы снарядов → прожилки рельефа (`renderOrder`). Сцена `fx.palm` — те же частицы с `FX_NO_DEPTH`, координаты в пространстве камеры рук.

Модули (каждый пул — один `InstancedMesh`, `frustumCulled = false`, ёмкость на пресет, данные экземпляров в `InstancedBufferAttribute`):
- `particles.ts` — пул квадратов-billboard'ов: атрибуты `aP0`, `aV0`, `aTime` (рождение, жизнь, размер в начале и в конце), `aColor` (rgb, альфа), `aGrav`. Положение `p0 + v0·t − ½·g·t²` считает вершинный шейдер по `uTime`, процессор пишет только диапазоны новых частиц (`allocateRing` → `addUpdateRange`). Мёртвая частица уходит за кадр. Мировой пул — 4/5 бюджета, пул ладоней — 1/5.
- `presets.ts` — таблица всплесков. Цвета (`round1/05`): огонь `#FF7A1A`, ядро `#FFE2A0`, угли `[0.85, 0.25, 0.05]`, дым `[0.22, 0.21, 0.2]` с альфой 0,35, нефрит `#3DBE7A`, пыль — `PAPER`. Огонь — вверх, рвано, 0,3–0,6 с, свет. Земля — пыль цвета бумаги (альфа) и осколки вниз с g ≥ 9. Число — `round(count × clamp(scale, 0.5, 3))`, не больше 150. `rng` передаётся снаружи: в игре `Math.random` (клиент — не симуляция), в тестах — семя.
- `glows.ts` — ореолы снарядов и свет вокруг ядра, каждый кадр из состояния.
- `projectileMeshes.ts` — ядра в G-буфер: кулак и шар — сфера чернилами `magic` (r 0,12 и 0,35), камень — икосаэдр `terrain` r 0,25. Ореол — оранжевый 0,5 / 1,4 м или нефритовый 0,4 м. Следы — частицы, которые снаряд роняет каждый кадр (число по пройденному пути). Свежий снаряд: `pos + (ладонь − точка выпуска) · muzzleBlend(age)`; ладонь в мире — `camera.localToWorld(handToWorldView(palm, HANDS_FOV, WORLD_FOV))`.
- `fireWalls.ts` — лист пламени вдоль бокса стены огня: шум, текущий вверх, плотность почти 1 внизу и языки сверху (закрывает обзор), угли по линии. След рывка — частицы вдоль отрезка и светлая полоса телеграфа.
- `decals.ts` — квадраты на полу (y + 0,02), форма в фрагментном шейдере:
  - `rect` / `sparks`: искры бегут по линии стены огня от `progress`;
  - `rect` / `cracks`: трещины тушью (края ячеек шума) с нефритовым светом под столбом;
  - `ring` / `quake`: кольцо 7 м, к удару сходится внутрь;
  - `segment` / `embers`: полоса следа.
  Телеграф (`now < armTick`) у всех ≥ 0,4 с (GDD 2.2). Обездвиженным — нефритовое кольцо у ног (из `statusFlags`).
- `terrainMeshes.ts` — рельеф: экземпляры единичного бокса чернилами `terrain` по `terrainVisualBox` (рост за `growTicks` с ease-out, проседание в последние 15 тиков). Нефритовые прожилки — 3–4 тонкие полосы на больших гранях, место по хешу id, пульсируют в проходе света.
- `dummyMeshes.ts` — манекен из боксов:
  - основание 0,8 × 0,12 × 0,8, стойка, тело 0,62 × 0,95 × 0,4, голова 0,4³, маска 0,3 × 0,22 × 0,03 чернилами `halo` на грани −Z, две парящие «руки» 0,16³;
  - один `InstancedMesh` с `instanceInk`; оболочка ореола — второй, чернила `halo`, `side: BackSide`, каждая тёмная часть больше на `haloMargin(расстояние до камеры, высота кадра, WORLD_FOV)`;
  - поза из состояния: наклон по `kb` до 20°, `flinch` — пружина `stepSpring` 10–15° от удара, вспышка 60 мс (`flash`), `squash` на приземлении, руки качаются;
  - горит — языки пламени из частиц, мёртв — скрыт.
- `debris.ts` — до 64 обломков рельефа (G-буфер, `terrain`): баллистика на процессоре, пол — основание рельефа, гаснут уменьшением.
- `vfx.ts` собирает всё. `sync(v)` раз в кадр: `lerpById` юнитов и снарядов между `prev` и `cur`, зоны и рельеф из `cur`, `uTime = nowS`. `apply(e)`:
  - `burst` — пресет в мировой пул;
  - `palm` — вспышка, заряд или «пшик» в пул ладоней у `palms.right` / `palms.left` (`hand: "auto"` разрешает вызывающий);
  - `flash` / `flinch` — в позу манекена.
  Бюджет: G-буфер +6 вызовов (манекены 2, рельеф 1, ядра 2, обломки 1), свет +6, ладони +1 — вместе с фазой 1 около 28.

`fx/fxTestPage.ts` и маршрут `/fx-test` в `main.ts` (как `/render-test`, отдельным чанком): арена, синтетическое `MatchState` по таймеру. В нём три манекена (один мигает и качается), огненный шар и камень летают туда-обратно, телеграф и стена огня, столб и стена растут и проседают, каждые 0,7 с — следующий `BURST_PRESETS`. В углу FPS и число вызовов.

- [ ] **Step 5: Тесты, типы, сборка**

Run: `pnpm test apps/client` → PASS (+5 тестов); `pnpm typecheck`; `pnpm build:client`.

- [ ] **Step 6: Коммит**

```bash
git add apps/client/src/render apps/client/src/fx apps/client/src/main.ts && git commit -m "feat(client): magic light pass over the G-buffer, particles, telegraphs, terrain, dummies with halo, /fx-test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Живая проверка (контролёр)**

`/fx-test`: шейдеры собираются без ошибок в консоли. Огонь оранжевый с почти белым ядром и ярче всего в кадре. Земля — камень средних тонов с нефритовыми прожилками и пылью цвета бумаги. Манекен — самое тёмное в кадре, с белым ореолом; свет взрыва его не заливает. Руки (`?near=1` в `/render-test`) закрывают эффекты за ними. Вызовов ≤ 40, на «Высоком» 60 FPS.

---

### Task 7: Ощущение, HUD, руки, ввод

**Поток:** H, после задачи 1. Работает с контрактами: события задачи 1 на входе, эффекты `feel/effects.ts` на выходе.

**Files:**
- Create: `apps/client/src/feel/{eventMap,camera}.ts`, `apps/client/src/hud/{format,prefs,combatHud,elementSelect}.ts`, `apps/client/src/hud/combatHud.css`, `apps/client/src/hands/gestures.ts`
- Modify: `apps/client/src/hands/mittens.ts`, `apps/client/src/sandbox/{controls,input}.ts`
- Test: `apps/client/src/feel/feel.test.ts`, `apps/client/src/hud/format.test.ts`, `apps/client/src/hands/gestures.test.ts`; дополнить `apps/client/src/sandbox/controls.test.ts`

**Interfaces:**
- Consumes: из `@doodlemagic/sim` — `MatchEvent`, `MatchState`, `MageState`, `Unit`, `Slot`, `Element`, `AbilityId`, `ABILITY_IDS`, `ABILITY_OF`, `ABILITY_NAME`, `ELEMENT_INFO`, `slotCooldownTicks`, `statusFlags`, `unitById`, `NO_MATCH_INPUT`; `Effect` (`feel/effects.ts`); `stepSpring`, `Spring` (`hands/spring.ts`); `HandPose` (`hands/motion.ts`).
- Produces:
  - `feel/eventMap.ts`: `interface EventView { localId: UnitId; state: MatchState }`; `effectsFor(ev: MatchEvent, view: EventView): Effect[]`.
  - `feel/camera.ts`: `SHAKE = { maxRotDeg: 0.5, maxShiftM: 0.05, decayPerS: 1.5, kickOmega: 25, fovOmega: 20 }`; `interface CameraFeel { trauma: number; t: number; pitch: Spring; yaw: Spring; roll: Spring; fov: Spring; fovTarget: number; fovHold: number }`; `interface CameraOffset { x: number; y: number; pitch: number; yaw: number; roll: number; fovDeg: number }` (м, рад, градусы FOV); `createCameraFeel(): CameraFeel`; `addFeel(f: CameraFeel, e: Effect): CameraFeel` (берёт `trauma`, `kick`, `fov`); `stepCameraFeel(f: CameraFeel, dt: number, motion: number, roll?: boolean): { feel: CameraFeel; offset: CameraOffset }`.
  - `hud/format.ts`: `formatDamage(n: number, air: boolean): string`; `interface FloatingNumber { target: UnitId; amount: number; dot: boolean; air: boolean; pos: Vec3; born: number; updated: number }`; `mergeNumbers(list: FloatingNumber[], e: { target: UnitId; amount: number; dot: boolean; air: boolean; pos: Vec3 }, nowS: number): FloatingNumber[]`; `numberAnim(ageS: number): { dy: number; scale: number; alpha: number }`; `cooldownFraction(m: MageState, slot: Slot, now: number): number`; `heatFraction(m: MageState): number`; `hpBar(u: Unit): { frac: number; notch: number; text: string }`.
  - `hud/prefs.ts`: `interface CombatPrefs { element: Element; cameraMotion: number }`; `DEFAULT_PREFS`; `parsePrefs(raw: string | null): CombatPrefs`; `loadPrefs()`, `savePrefs(p)` — ключ `doodlemagic_combat`.
  - `hud/combatHud.ts`: `interface HudView { cur: MatchState; prev: MatchState; alpha: number; localId: UnitId; camera: PerspectiveCamera; nowS: number; visible(p: Vec3): boolean }`; `interface CombatHud { apply(e: Effect, nowS: number): void; update(v: HudView): void; setVisible(on: boolean): void; dispose(): void }`; `createCombatHud(root: HTMLElement): CombatHud`.
  - `hud/elementSelect.ts`: `showElementSelect(root: HTMLElement, initial: Element, autoS?: number): Promise<{ element: Element; byClick: boolean }>`.
  - `hands/gestures.ts`: `interface HandOffset { x: number; y: number; z: number; pitch: number }`; `interface HandGesture { right: HandOffset; left: HandOffset }`; `interface GestureState { active: { ability: AbilityId; hand: "left" | "right" | "both"; t: number }[]; nextFist: "left" | "right" }`; `createGestures()`; `startGesture(g: GestureState, a: AbilityId): GestureState`; `stepGestures(g: GestureState, dt: number): { state: GestureState; pose: HandGesture; hand: "left" | "right" }` (`hand` — рука последнего удара кулаком, для `palm: "auto"`).
  - `hands/mittens.ts`: `update(pose: HandPose, cameraWorldInverse: Matrix4, gesture?: HandGesture): void`; `palms(): { right: Vector3; left: Vector3 }` — центры варежек в пространстве камеры рук.
  - `sandbox/controls.ts`: в `KEYS` — `primary: "Mouse0"`, `q: "KeyQ"`, `e: "KeyE"`, `c: "KeyC"`, `ult: "KeyX"`; `buildMatchInput(down: ReadonlySet<string>, look: Look): MatchInput`. `sandbox/input.ts`: при захваченной мыши левая кнопка — `"Mouse0"` в `down` (mousedown / mouseup, `button === 0`), очищается вместе с клавишами.

- [ ] **Step 1: Написать падающие тесты**

`apps/client/src/feel/feel.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createDummyUnit, createMageUnit, createMatchState, type MatchEvent } from "@doodlemagic/sim";
import { addFeel, createCameraFeel, stepCameraFeel } from "./camera";
import { effectsFor } from "./eventMap";

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const me = { localId: 1, state: createMatchState([createMageUnit(1, "fire", { pos: V(), yaw: 0 }), createDummyUnit(2, { pos: V(0, 0, -10), yaw: 0 })]) };
const fx = (ev: MatchEvent) => effectsFor(ev, me);
const kinds = (ev: MatchEvent) => fx(ev).map((e) => e.kind);
const hitOn = (target: number, over: Partial<Extract<MatchEvent, { type: "hit" }>> = {}): MatchEvent => ({
  type: "hit", source: target === 1 ? 2 : 1, target, ability: "fireFists", amount: 12, pos: V(0, 1, -9.6), dir: V(0, 0, -1),
  knock: { distM: 0.12, upM: 0 }, airborne: false, dot: false, killed: false, ...over,
});
const cast = (unit: number): MatchEvent => ({ type: "cast", unit, ability: "fireFists", slot: "primary", pos: V(0, 1.6, 0), dir: V(0, 0, -1) });

describe("effectsFor", () => {
  it("gives my cast a gesture, a palm flash, a sound and recoil on the same frame, no shake; not for others", () => {
    expect(kinds(cast(1))).toEqual(expect.arrayContaining(["gesture", "palm", "sound", "kick"]));
    expect(kinds(cast(1))).not.toContain("trauma");
    expect(kinds(cast(1)).indexOf("gesture")).toBeLessThan(kinds(cast(1)).indexOf("palm"));
    expect(kinds(cast(2))).not.toContain("gesture");
  });

  it("splits a hit: the impact shows in the world, the hit confirms it", () => {
    const impact = kinds({ type: "impact", ability: "fireFists", owner: 1, pos: V(0, 1, -9.6), normal: V(0, 0, 1), target: 2, terrain: -1 });
    expect([impact.includes("burst"), impact.includes("sound"), impact.includes("hitmarker")]).toEqual([true, true, false]);
    expect(kinds(hitOn(2))).toEqual(expect.arrayContaining(["hitmarker", "number", "flash", "flinch", "sound", "hitstop"]));
    expect(kinds(hitOn(2))).not.toContain("trauma");
  });

  it("shakes me and pushes my camera ≤ 1° away from the source when I am hit, never for damage over time", () => {
    const got = fx(hitOn(1, { ability: "fireball", amount: 50, dir: V(0, 0, 1), knock: { distM: 3, upM: 1.2 } }));
    expect(got).toContainEqual(expect.objectContaining({ kind: "trauma", amount: 0.35 }));
    const kick = got.find((e) => e.kind === "kick");
    expect(kick?.kind === "kick" && Math.abs(kick.pitchDeg) + Math.abs(kick.yawDeg) <= 1).toBe(true);
    expect([got.some((e) => e.kind === "indicator"), got.some((e) => e.kind === "hitmarker")]).toEqual([true, false]);
    expect(kinds(hitOn(1, { ability: "burning", amount: 3, dot: true })).filter((k) => k === "trauma" || k === "kick")).toEqual([]);
  });

  it("punches the FOV on a dash, marks kills, ring-outs and «Кураж», fizzles bad casts, wiggles on cooldown", () => {
    expect(fx({ type: "dash", unit: 1, phase: "start", pos: V(), dir: V(1, 0, 0) })).toContainEqual(expect.objectContaining({ kind: "fov", deg: 6 }));
    expect(fx(hitOn(2, { killed: true }))).toContainEqual(expect.objectContaining({ kind: "hitmarker", kill: true }));
    expect(fx({ type: "fall", target: 2, credit: 1, pos: V(2, -4, -3) })).toContainEqual(expect.objectContaining({ kind: "toast", text: "Сброс!" }));
    expect(fx({ type: "courage", unit: 1 })).toContainEqual(expect.objectContaining({ kind: "toast", text: "Кураж!" }));
    expect(kinds({ type: "reject", unit: 1, slot: "q", reason: "notGrounded" })).toEqual(expect.arrayContaining(["palm", "sound", "toast"]));
    expect(kinds({ type: "reject", unit: 1, slot: "q", reason: "cooldown" })).toEqual(["deny"]);
  });
});

describe("camera feel", () => {
  const deg = Math.PI / 180;

  it("caps trauma at 1, decays it at 1.5/s, shakes ≤ 0.5° and ≤ 5 cm per axis", () => {
    let f = addFeel(addFeel(createCameraFeel(), { kind: "trauma", amount: 0.7 }), { kind: "trauma", amount: 0.7 });
    expect([f.trauma, Number(stepCameraFeel(f, 0.5, 1).feel.trauma.toFixed(9))]).toEqual([1, 0.25]);
    let rot = 0;
    let shift = 0;
    for (let k = 0; k < 240; k++) {
      const r = stepCameraFeel(f, 1 / 120, 1);
      f = { ...r.feel, trauma: 1 };
      rot = Math.max(rot, Math.abs(r.offset.pitch), Math.abs(r.offset.yaw));
      shift = Math.max(shift, Math.abs(r.offset.x), Math.abs(r.offset.y));
    }
    expect([rot > 0, rot <= 0.5 * deg + 1e-12, shift <= 0.05 + 1e-12]).toEqual([true, true, true]);
  });

  it("peaks a kick at its amount and settles it within 0.25 s", () => {
    let f = addFeel(createCameraFeel(), { kind: "kick", pitchDeg: 1.5, yawDeg: 0, rollDeg: 0 });
    const path: number[] = [];
    for (let k = 0; k < 30; k++) {
      const r = stepCameraFeel(f, 1 / 120, 1);
      f = r.feel;
      path.push(r.offset.pitch / (1.5 * deg));
    }
    expect([Math.max(...path) > 0.9, Math.max(...path) < 1.05, Math.abs(path.at(-1)!) < 0.1]).toEqual([true, true, true]);
  });

  it("holds a FOV punch, eases it back, and keeps the camera still at camera motion 0", () => {
    let r = stepCameraFeel(addFeel(createCameraFeel(), { kind: "fov", deg: 6, holdS: 0.2 }), 0.1, 1);
    expect(r.offset.fovDeg).toBeGreaterThan(3);
    for (let k = 0; k < 60; k++) r = stepCameraFeel(r.feel, 1 / 60, 1);
    expect(r.offset.fovDeg).toBeLessThan(0.2);
    const busy = addFeel(addFeel(createCameraFeel(), { kind: "trauma", amount: 1 }), { kind: "kick", pitchDeg: 1, yawDeg: 1, rollDeg: 3 });
    expect(stepCameraFeel(busy, 1 / 60, 0, true).offset).toEqual({ x: 0, y: 0, pitch: 0, yaw: 0, roll: 0, fovDeg: 0 });
  });
});
```

`apps/client/src/hud/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createMageUnit } from "@doodlemagic/sim";
import { cooldownFraction, formatDamage, heatFraction, hpBar, mergeNumbers, numberAnim, type FloatingNumber } from "./format";
import { DEFAULT_PREFS, parsePrefs } from "./prefs";

const pos = { x: 0, y: 1, z: 0 };
const dot = (amount: number) => ({ target: 2, amount, dot: true, air: false, pos });

describe("HUD formatting", () => {
  it("rounds damage, marks the air bonus, merges damage over time within 0.4 s, pops and fades", () => {
    expect([formatDamage(13.8, false), formatDamage(13.8, true), formatDamage(0.4, false)]).toEqual(["14", "14↑", "1"]);
    let list: FloatingNumber[] = [];
    for (const [amount, t] of [[3, 1.0], [3, 1.3], [3, 1.8]] as const) list = mergeNumbers(list, dot(amount), t);
    list = mergeNumbers(list, { ...dot(12), dot: false }, 1.85);
    expect(list.map((n) => n.amount)).toEqual([6, 3, 12]);
    const a = [numberAnim(0).scale, numberAnim(0.12).scale, numberAnim(0.8).dy, numberAnim(0.2).alpha, numberAnim(0.9).alpha];
    expect(a.map((v) => Number(v.toFixed(9)))).toEqual([1.4, 1, 0.6, 1, 0]);
  });

  it("reads cooldowns, heat and HP with the ⅔ regen notch; prefs fall back on garbage", () => {
    const u = createMageUnit(1, "fire", { pos, yaw: 0 });
    u.mage!.ready.q = 340;
    u.mage!.heat = 40;
    u.hp = 75;
    expect([cooldownFraction(u.mage!, "q", 100), cooldownFraction(u.mage!, "q", 400), heatFraction(u.mage!)]).toEqual([0.5, 0, 0.4]);
    expect(hpBar(u)).toEqual({ frac: 0.5, notch: 2 / 3, text: "75 / 150" });
    expect(parsePrefs('{"element":"earth","cameraMotion":0.5}')).toEqual({ element: "earth", cameraMotion: 0.5 });
    expect([parsePrefs(null), parsePrefs('{"element":"water","cameraMotion":7}')]).toEqual([DEFAULT_PREFS, { element: "fire", cameraMotion: 1 }]);
  });
});
```

`apps/client/src/hands/gestures.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ABILITY_IDS } from "@doodlemagic/sim";
import { createGestures, startGesture, stepGestures } from "./gestures";

describe("hand gestures", () => {
  it("punch with alternating hands, bring palms together for the fireball, and return to rest after every gesture", () => {
    let r = stepGestures(startGesture(createGestures(), "fireFists"), 0.05);
    expect([r.hand, r.pose.right.z < -0.08, r.pose.left.z]).toEqual(["right", true, 0]);
    r = stepGestures(startGesture(r.state, "fireFists"), 0.05);
    expect([r.hand, r.pose.left.z < -0.08]).toEqual(["left", true]);
    const fb = stepGestures(startGesture(createGestures(), "fireball"), 0.25).pose;
    expect([fb.right.x < -0.1, fb.left.x > 0.1]).toEqual([true, true]);
    for (const a of ABILITY_IDS) {
      const done = stepGestures(startGesture(createGestures(), a), 1.5);
      expect([...Object.values(done.pose.right), ...Object.values(done.pose.left)].every((v) => Math.abs(v) < 1e-6)).toBe(true);
      expect(done.state.active).toHaveLength(0);
    }
  });
});
```

В `apps/client/src/sandbox/controls.test.ts` добавить (импорт `buildMatchInput`):
```ts
describe("buildMatchInput", () => {
  it("adds LMB and Q / E / C by physical code", () => {
    expect(buildMatchInput(new Set(["Mouse0", "KeyQ", "KeyW"]), { yaw: 0, pitch: 0 })).toEqual({
      moveX: 0, moveZ: 1, jump: false, yaw: 0, pitch: 0, primary: true, q: true, e: false, c: false,
    });
    expect(Object.values(KEYS)).toEqual(expect.arrayContaining(["Mouse0", "KeyQ", "KeyE", "KeyC", "KeyX"]));
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm test apps/client/src/feel apps/client/src/hud apps/client/src/hands apps/client/src/sandbox` → FAIL: нет `./eventMap`, `./camera`, `./format`, `./prefs`, `./gestures`, `buildMatchInput`.

- [ ] **Step 3: События → эффекты**

`effectsFor` — таблица по типу события. Числа ощущения — из `round1/03` и `round2/03`: шкала мощности, «сок» ЛКМ по темпу, урон по времени не трясёт, отклик на кадре нажатия. «Я» — `view.localId`. Элемент кастующего — из `view.state` (`unitById(...).mage.element`). В списке эффектов каста `gesture` всегда раньше `palm`: по нему интеграция узнаёт руку удара.

| Событие | Эффекты |
|---|---|
| `cast`, мой | `gesture`; `palm` (`auto` у кулаков, `both` у остального; `charge` у шара и камня, иначе `flash`); `sound` способности у слушателя (`fireFist`, `fireballCharge`, `stoneCast`, `fireWallTelegraph`, `pillarTelegraph`, `wallRise`, `quakeWindup`, у рывка — `dash`); `kick` 0,2° кулаки, 0,6° камень, 1° остальное; камень — ещё `burst stoneCrumble` у ног |
| `release`, мой | шар — `kick` 1,5°, `fov` +3° на 0,15 с, `trauma` 0,15; камень — `burst stoneCrumble` |
| `impact` | `burst` (`fistImpact` / `stoneImpact` / по рельефу `terrainChips`) по нормали, `sound` в точке |
| `explosion` | `burst fireballBoom` (scale = радиус / 3), `sound fireballBoom`; я ближе 5 м — `trauma` 0,15 |
| `hit`, источник я, не `dot` | `hitmarker` (`kill`, `air`), `number`, `flash`, `flinch` 0,2 рад (ЛКМ 0,1), `sound hitTick`, `hitstop` 25 мс (ЛКМ) / 60 мс; способности — `trauma` 0,05 |
| `hit`, источник я, `dot` | `number` (`dot: true`) |
| `hit`, цель я, не `dot` | `trauma` 0,1 (ЛКМ) / 0,35; `kick`: −dir в осях камеры, сумма модулей ≤ 1°; `indicator` (`from = pos − dir`); `sound` удара |
| `zone` `telegraph` | столб — `burst pillarCracks`; стена огня — `burst fireWallSparks` |
| `zone` `arm` | столб — `burst pillarBurst`, `sound pillarStrike`, я ближе 4 м — `trauma` 0,35; землетрясение — `burst quakeRing` (scale 7), `sound quakeStrike`, я на земле в 7 м — `trauma` 0,4; стена огня — `burst fireWallIgnite`, `sound fireWallIgnite`, я ближе 5 м — `trauma` 0,15 |
| `terrain` | `rise` — `burst wallDust` у основания, кастующему стену `trauma` 0,1; `hit` — `terrainChips` и `sound terrainHit`; `break` — `terrainBreak` и `sound terrainBreak`; `expire` — `wallDust` |
| `dash` `start`, мой | `fov` +6° на 0,2 с, `kick` с `rollDeg` 3° по направлению, `burst dashBlast` |
| `reject` | `cooldown`, `busy` → только `deny`; `notGrounded` → `palm fizzle`, `sound fizzle`, `toast` «Нужна опора»; `noTarget` → то же с «Некуда»; `rooted` → `deny` |
| `overheat` `on`, мой | `sound overheat`, `palm fizzle`, `toast` «Перегрев» |
| `courage`, мой | `toast` «Кураж!», `sound courage` |
| `death` | `burst deathFire` / `deathEarth` по стихии убийцы; убил я — `sound kill` |
| `fall`, засчитан мне | `toast` «Сброс!», `sound fall` |
| `respawn` | `burst respawnPuff` |
| `status` | ничего: HUD и частицы читают статусы из состояния |

`kick` на удар по мне: направление толчка `dir` переводится в оси взгляда мага (`yaw` из `state`). Его продольная часть — `pitchDeg`, поперечная — `yawDeg`; масштаб `min(1, amount / 40)`, но сумма модулей не больше 1°.

`camera.ts` — trauma и пружины (`round1/03`, GDD 5: тряска в основном сдвигом, поворот ≤ 0,5°):
```ts
export function stepCameraFeel(f: CameraFeel, dt: number, motion: number, roll = false): { feel: CameraFeel; offset: CameraOffset } {
  const t = f.t + dt;
  const trauma = Math.max(0, f.trauma - SHAKE.decayPerS * dt);
  const fovHold = Math.max(0, f.fovHold - dt);
  const feel: CameraFeel = {
    trauma, t, fovHold, fovTarget: f.fovTarget,
    pitch: stepSpring(f.pitch, 0, SHAKE.kickOmega, dt),
    yaw: stepSpring(f.yaw, 0, SHAKE.kickOmega, dt),
    roll: stepSpring(f.roll, 0, SHAKE.kickOmega, dt),
    fov: stepSpring(f.fov, fovHold > 0 ? f.fovTarget : 0, SHAKE.fovOmega, dt),
  };
  const k = trauma * trauma * Math.max(0, Math.min(1, motion));
  // гладкий шум без Math.random: сумма синусов с несоизмеримыми частотами, |n| ≤ 1
  const n = (a: number, b: number) => 0.6 * Math.sin(t * a) + 0.4 * Math.sin(t * b + 1.7);
  const rot = SHAKE.maxRotDeg * (Math.PI / 180);
  const m = Math.max(0, Math.min(1, motion));
  const offset: CameraOffset = {
    x: k * SHAKE.maxShiftM * n(47, 83) + 0,
    y: k * SHAKE.maxShiftM * n(59, 101) + 0,
    pitch: (k * rot * n(37, 71) + feel.pitch.x * m) + 0,
    yaw: (k * rot * n(43, 67) + feel.yaw.x * m) + 0,
    roll: roll ? feel.roll.x * m + 0 : 0,
    fovDeg: feel.fov.x * m + 0,
  };
  return { feel, offset };
}
```
Поворот от тряски не больше 0,5°, но вместе с толчком камеры сумма может быть больше: толчок — отдельный канал, у него свой предел в таблице выше. `addFeel`:
- `trauma` — `min(1, trauma + amount)`;
- `kick` — импульс скорости `v += amount·ω·e` (`e = Math.E`, угол в радианах): пик у критически задемпфированной пружины ровно `amount` через 1/ω;
- `fov` — `fovTarget = deg`, `fovHold = holdS`.

Крен по умолчанию выключен (GDD 5), `motion` — ползунок «Движение камеры» 0…1.

- [ ] **Step 4: HUD, выбор стихии, руки, ввод**

`hud/format.ts`:
- `formatDamage`: `max(1, round(n))`, у воздушного попадания суффикс «↑»;
- `mergeNumbers`: `dot`-число сливается с последним `dot`-числом той же цели, если с его `updated` прошло ≤ 0,4 с;
- `numberAnim`: `scale` 1,4 → 1 за 0,12 с; `dy = 0,6 · min(1, age / 0,8)` м; `alpha` 1 до 0,5 с, к 0,9 с — 0;
- `cooldownFraction = clamp((ready − now) / slotCooldownTicks(element, slot), 0, 1)`; `heatFraction = heat / 100`;
- `hpBar`: `frac = hp / maxHp`, `notch = 2/3`, `text = "75 / 150"`.

`hud/prefs.ts`: элемент — только `fire` или `earth`, `cameraMotion` прижат к [0; 1], по умолчанию `{ element: "fire", cameraMotion: 1 }`.

`hud/combatHud.ts` + `combatHud.css` — DOM поверх холста, `pointer-events: none`, стиль «кисть и печать» (GDD 6), киноварь `#c8402a` только для HP и урона:
- прицел — точка и четыре коротких штриха. Хитмаркер — четыре диагональных штриха тушью на 120 мс; при убийстве крупнее и киноварью, при воздушном попадании — стрелка вверх;
- внизу по центру 5 ячеек «ЛКМ, Q, E, C, X» с названием способности. Перезарядка — SVG-круг-энсо, дорисовывается по `1 − cooldownFraction`; готовность — короткая вспышка ячейки; `deny` — дрожь 150 мс. X — серая ячейка «скоро»;
- над ячейками у Огня — полоса жара; в перегреве мигает и подписана «Перегрев»;
- слева внизу HP мазком с засечкой ⅔ и «hp / max», над ним «Огонь» или «Земля»;
- справа вверху «Урон N · Убийства N · Сбросы N» из `mage.stats` (урон округлён);
- цифры урона — пул из 24 `div`: экранная позиция — проекция `pos` камерой, движение — `numberAnim`;
- над манекенами (`visible(голова)`, ближе 35 м): полоса HP шириной по расстоянию и значки статусов из `statusFlags` — пламя «горит», кольцо «корни», стрелка вниз «медленно», стрелка вверх «в воздухе»;
- тосты по центру сверху на 1,2 с; `indicator` — дуга вокруг прицела со стороны `from` на 1,2 с; при уроне по мне — виньетка киноварью.

`hud/elementSelect.ts` — экран «Выбери стихию», две карточки из `ELEMENT_INFO`:
- «Огонь — Напор», «Жги в упор, только не перегрейся», «★ Новичку · 150 HP · 6,5 м/с»;
- «Земля — Стойкость», «Строй стены, бей тяжело, стой насмерть», «★★ · 170 HP · 6,0 м/с».

`initial` подсвечена; 1 / 2 или клик — выбор; через `autoS = 10` с выбирается подсвеченная (`byClick: false`, GDD 9). Подсказка «1 / 2 или клик · через 10 с — выбранная».

`hands/gestures.ts` — ключевые позы (время, смещение правой и левой руки, наклон), между позами smoothstep, сумма активных жестов, через `durS` жест снимается:

| Способность | Жест (м, рад; в пространстве камеры рук) | durS |
|---|---|---|
| fireFists | бьющая рука: z −0,12 к 0,05 с, обратно к 0,2 с; руки по очереди | 0,22 |
| fireball | правая x −0,2, левая x +0,2, y +0,05 к 0,25 с; толчок обеими z −0,15 к 0,32; покой к 0,6 | 0,6 |
| jetDash | обе z +0,1, y −0,08 к 0,1 с; покой к 0,4 | 0,4 |
| fireWall | правая — взмах x +0,1 → −0,25 к 0,3 с; покой к 0,55 | 0,55 |
| stoneShot | правая y −0,12 к 0,1 с, y +0,05 к 0,2 с, z −0,1 к 0,26 с; покой к 0,5 | 0,5 |
| stonePillar | обе y −0,15 к 0,12 с, держат до 0,3 с; покой к 0,6 | 0,6 |
| stoneWall | обе y −0,1 к 0,1 с, y +0,12 к 0,28 с; покой к 0,6 | 0,6 |
| earthquake | обе y +0,08 к 0,4 с, удар y −0,18 к 0,46 с; покой к 0,8 | 0,8 |

`hands/mittens.ts`: `update` прибавляет к `REST` руки смещение жеста (`x`, `y`, `z`, `rotation.x += pitch`); `palms()` — текущие позиции групп `right` и `left` в пространстве камеры рук (`Vector3`, без выделения памяти за кадр).

- [ ] **Step 5: Тесты и типы**

Run: `pnpm test apps/client` → PASS (+11 тестов); `pnpm typecheck`.

- [ ] **Step 6: Коммит**

```bash
git add apps/client/src/feel apps/client/src/hud apps/client/src/hands apps/client/src/sandbox/controls.ts apps/client/src/sandbox/controls.test.ts apps/client/src/sandbox/input.ts && git commit -m "feat(client): event-to-effect map, camera trauma and kicks, combat HUD, element select, cast gestures, LMB/Q/E/C input" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Синтез звука (необязательная, последняя в потоке клиента)

**Поток:** A, после задачи 1. Если к задаче 9 не готова, интеграция идёт без звука (`audio = null`).

**Files:**
- Create: `apps/client/src/audio/{recipes,pan,synth}.ts`
- Test: `apps/client/src/audio/audio.test.ts`

**Interfaces:**
- Consumes: `SoundId`, `SOUND_IDS` (`feel/effects.ts`); `Vec3`, `forwardXZ`.
- Produces:
  - `recipes.ts`: `interface Layer { kind: "noise" | "tone"; wave?: OscillatorType; freq: number; freqEnd: number; filter?: BiquadFilterType; q?: number; delay: number; attack: number; dur: number; gain: number; signature?: true }`; `interface Recipe { layers: Layer[] }`; `RECIPES: Record<SoundId, Recipe>`; `bandOf(r: Recipe): [number, number]` — полоса слоя-подписи;
  - `pan.ts`: `spatial(listener: { pos: Vec3; yaw: number }, pos: Vec3 | null): { pan: number; gain: number; behind: boolean }`; `createRateLimiter(perS: number): (tS: number) => boolean`;
  - `synth.ts`: `interface GameAudio { unlock(): void; setListener(pos: Vec3, yaw: number): void; play(id: SoundId, pos: Vec3 | null, gain: number): void }`; `createAudio(): GameAudio`.

- [ ] **Step 1: Написать падающий тест**

`apps/client/src/audio/audio.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SOUND_IDS } from "../feel/effects";
import { createRateLimiter, spatial } from "./pan";
import { RECIPES, bandOf } from "./recipes";

describe("audio", () => {
  it("has a short recipe for every sound; Fire signs in 2–8 kHz, Earth in 30–200 Hz (GDD 5)", () => {
    for (const id of SOUND_IDS) expect(Math.max(...RECIPES[id].layers.map((l) => l.delay + l.dur))).toBeLessThanOrEqual(0.8);
    for (const id of ["fireFist", "fireballBoom", "fireWallIgnite", "dash"] as const) expect(bandOf(RECIPES[id]).map((f) => f >= 2000 && f <= 8000)).toEqual([true, true]);
    for (const id of ["stoneCast", "stoneImpact", "pillarStrike", "quakeStrike"] as const) expect(bandOf(RECIPES[id]).map((f) => f >= 30 && f <= 200)).toEqual([true, true]);
  });

  it("pans by side, fades with distance, knows what is behind, and limits the hit tick to 4 a second", () => {
    const l = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 };
    const at = (x: number, z: number) => spatial(l, { x, y: 1.6, z });
    expect([at(5, 0).pan > 0.9, at(-5, 0).pan < -0.9, at(0, -30).gain < at(0, -3).gain, at(0, 5).behind]).toEqual([true, true, true, true]);
    expect(spatial(l, null)).toEqual({ pan: 0, gain: 1, behind: false });
    const ok = createRateLimiter(4);
    expect([0, 0.1, 0.2, 0.25, 0.3, 0.5, 0.55].map((t) => ok(t))).toEqual([true, false, false, true, false, true, false]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm test apps/client/src/audio` → FAIL: нет модулей.

- [ ] **Step 3: Реализация**

Рецепты (`round1/03`, п. 4; у каждой стихии — слой-подпись `signature`):
- огонь — треск: шум highpass 3–6 кГц со щелчками, 60–150 мс. Розжиг шара и стены: шум lowpass с фильтром 200 → 2000 Гц, 0,25–0,4 с;
- земля — саб-удар: синус 90 → 40 Гц (камень) и 70 → 30 Гц (столб, землетрясение) с хрустом lowpass 400 Гц; скрежет стены — bandpass 300 Гц, 0,25 с; гул телеграфа — 40 Гц;
- общее: `hitTick` — синус 1,8 кГц 40 мс; `kill` — две ноты (880 и 1320 Гц); `fizzle` — синус 600 → 200 Гц за 120 мс и пых шума; `fall` — свист вниз 1200 → 300 Гц; `courage` — короткий восходящий аккорд.

`pan.ts`: `pan` — синус угла от направления взгляда до источника; `gain = 1 / (1 + 0.15·d)`; `behind` — источник за спиной (скалярное произведение с `forwardXZ(yaw)` < 0).

`synth.ts`:
- `AudioContext({ latencyHint: "interactive" })` создаётся в `unlock()` по первому клику «Играть», один буфер белого шума на 1 с на всё;
- голос — `noise/osc → BiquadFilter → Gain` с огибающей (attack, экспонента вниз за `dur`) `→ StereoPanner → master`; за спиной — lowpass 3 кГц;
- `master → DynamicsCompressor (порог −12 дБ, 4:1 — свой выбор, не из заметок про чужую игру) → destination`; не больше 24 голосов, лишние не запускаются;
- `hitTick` — через `createRateLimiter(4)`.

- [ ] **Step 4: Проверить и закоммитить**

Run: `pnpm test apps/client/src/audio` → PASS, 2 теста; `pnpm typecheck`.
```bash
git add apps/client/src/audio && git commit -m "feat(client): synthesized Web Audio — Fire crackle and Earth thumps in their own bands, panning, hit tick limiter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Полигон, интеграция в песочницу, приёмка

**Поток:** одна, после слияния S (задачи 2–5), V (6), H (7) и, если готова, A (8).

**Files:**
- Create: `packages/arena/src/training.ts`, `packages/arena/src/training.sim.test.ts`
- Modify: `packages/arena/src/index.ts` (`export * from "./training";`), `apps/client/src/sandbox/{page,hud}.ts`, `apps/client/src/sandbox/sandbox.css`, `docs/superpowers/plans/2026-10-17-prototype-roadmap.md`

**Interfaces:**
- Consumes: всё выше; из фазы 1 — `buildGallery`, `GALLERY`, `StyleRenderer`, `buildArenaMeshes`, `createMittens`, `updateHandRig`, `advanceClock`, `applyLook`, `createInput`, `createHud`, `loadSettings`.
- Produces: `TRAINING: { readonly spawn: Spawn; readonly dummies: readonly DummySpot[] }` в `@doodlemagic/arena`; маршрут `/` — полигон с магом и манекенами (`?arena=compact` по-прежнему работает).

- [ ] **Step 1: Написать падающий тест**

`packages/arena/src/training.sim.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT, NO_MATCH_INPUT, bodyBox, createMatch, createPlayer, createWorld, groundBelow, isFree, lineOfSight, matchContext, rightXZ, stepMatch, volumeAt,
  type MatchEvent, type Vec3,
} from "@doodlemagic/sim";
import { GALLERY, buildGallery } from "./gallery";
import { TRAINING } from "./training";

describe.each(["full", "compact"] as const)("training ground (%s)", (variant) => {
  const arena = buildGallery(variant);
  const world = createWorld(arena.colliders, arena.volumes);
  const free = (p: Vec3) => {
    const box = bodyBox(createPlayer(p).body);
    return isFree(world, box) && groundBelow(world, { ...p, y: p.y + 0.5 }) === p.y && volumeAt(world, box, "kill") === null;
  };

  it("puts the mage and six dummies (two strafing) on free floor with clear patrol paths", () => {
    expect([TRAINING.dummies.length, TRAINING.dummies.filter((d) => (d.patrolHalfM ?? 0) > 0).length]).toEqual([6, 2]);
    for (const p of [TRAINING.spawn.pos, ...TRAINING.dummies.map((d) => d.pos)]) expect(free(p), JSON.stringify(p)).toBe(true);
    for (const d of TRAINING.dummies) {
      const r = rightXZ(d.yaw);
      const half = (d.patrolHalfM ?? 0) * 1.05;
      for (const s of [-1, -0.5, 0.5, 1]) expect(free({ x: d.pos.x + r.x * half * s, y: d.pos.y, z: d.pos.z + r.z * half * s })).toBe(true);
    }
  });

  it("puts two dummies at the open gorge edge and one on the bridge, and shows at least three from the spawn", () => {
    const g = GALLERY.gorge;
    expect(TRAINING.dummies.filter((d) => d.pos.z < g.z0 && d.pos.z > g.z0 - 1.3 && d.pos.x > g.x0 && d.pos.x < g.x1)).toHaveLength(2);
    expect(TRAINING.dummies.filter((d) => d.pos.z > g.z0 && d.pos.z < g.z1 && Math.abs(d.pos.x) < 1.5)).toHaveLength(1);
    const eye = { ...TRAINING.spawn.pos, y: TRAINING.spawn.pos.y + EYE_HEIGHT };
    expect(TRAINING.dummies.filter((d) => lineOfSight(world, eye, { ...d.pos, y: d.pos.y + 1 })).length).toBeGreaterThanOrEqual(3);
  });
});

describe("knock-off (full)", () => {
  it("lets a fireball from the courtyard knock an edge dummy into the gorge", () => {
    const ctx = matchContext(buildGallery("full"));
    const target = TRAINING.dummies.find((d) => d.pos.x > 2 && d.pos.z < GALLERY.gorge.z0)!;
    let s = createMatch({ mages: [{ element: "fire", spawn: { pos: { x: target.pos.x, y: 0, z: target.pos.z - 3.6 }, yaw: Math.PI } }], dummies: [target] });
    const ev: MatchEvent[] = [];
    for (let k = 0; k < 200; k++) {
      const r = stepMatch(s, { 1: { ...NO_MATCH_INPUT, yaw: Math.PI, pitch: Math.atan2(1 - 1.6, 3.6), q: k === 10 } }, ctx);
      s = r.state;
      ev.push(...r.events);
    }
    expect(ev).toContainEqual(expect.objectContaining({ type: "hit", target: 2, ability: "fireball" }));
    expect(ev).toContainEqual(expect.objectContaining({ type: "fall", target: 2, credit: 1 }));
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm test packages/arena/src/training` → FAIL: `Failed to resolve import "./training"`.

- [ ] **Step 3: Полигон в данных арены**

`packages/arena/src/training.ts`. Половина A (z < 0): маг в западной части двора смотрит на ущелье; манекены на 6–23 м от него.
```ts
import type { DummySpot, Spawn } from "@doodlemagic/sim";

/** Полигон фазы 2-lite в «Галерее над ущельем». Ось патруля — rightXZ(yaw): у yaw = π/2 — вдоль Z, поперёк взгляда мага. */
export const TRAINING: { readonly spawn: Spawn; readonly dummies: readonly DummySpot[] } = {
  spawn: { pos: { x: -11.5, y: 0, z: -9 }, yaw: -1.83 },
  dummies: [
    { pos: { x: -5, y: 0, z: -8.5 }, yaw: Math.PI / 2 }, // двор, стоит, 6,5 м
    { pos: { x: 1.5, y: 0, z: -8.5 }, yaw: Math.PI / 2, patrolHalfM: 1.6 }, // двор, ходит
    { pos: { x: 11, y: 0, z: -6.5 }, yaw: Math.PI / 2, patrolHalfM: 2 }, // дальний, ходит, 23 м
    { pos: { x: -2.25, y: 0, z: -5.9 }, yaw: 0 }, // у открытой кромки ущелья
    { pos: { x: 2.4, y: 0, z: -5.9 }, yaw: 0 }, // у открытой кромки ущелья
    { pos: { x: 0, y: 0, z: -3.5 }, yaw: Math.PI / 2 }, // на мосту: сбросить можно только вбок
  ],
};
```
Если тест видимости или свободы точки падает, двигать точки (по 0,5 м), а не ослаблять тест. Затем `pnpm test packages/arena` → PASS (+5).

- [ ] **Step 4: Песочница становится полигоном**

`sandbox/hud.ts` (меню паузы фазы 1):
- заголовок «DoodleMagic · полигон», под ним «Галерея над ущельем. Шесть манекенов ждут — попробуй каждую способность.»;
- строка «Стихия» с двумя кнопками «Огонь» и «Земля» (текущая выделена): `onElement(cb: (e: Element) => void)`, `setElement(e)`;
- ползунок «Движение камеры» 0…1, шаг 0,1: `onCameraMotion(cb)`, начальное значение — из `loadPrefs()`;
- `HINT = "ЛКМ — атака · Q E C — приёмы · пробел — прыжок · Esc — меню"`.

`sandbox/page.ts` — `stepMatch` заменяет `stepPlayer`. Остальное из фазы 1 остаётся: настройки, автокачество, руки, угол отладки. Ядро кадра:
```ts
const LOCAL = 1;
const prefs = loadPrefs();
const ctx = matchContext(arena);
let cur = createMatch({ mages: [{ element: prefs.element, spawn: TRAINING.spawn }], dummies: [...TRAINING.dummies] });
let prev = cur;
let look: Look = { yaw: TRAINING.spawn.yaw, pitch: 0 };
const vfx = createVfx(renderer.gbuffer, renderer.preset.id);
scene.add(vfx.worldGroup);
const combat = createCombatHud(root);
const audio: GameAudio | null = createAudio(); // без задачи 8 — null
let feel = createCameraFeel();
let gestures = createGestures();
let fistHand: "left" | "right" = "right";
let hitstopUntil = 0;

const route = (e: Effect, nowS: number): void => {
  if (e.kind === "gesture") {
    if (e.ability === "fireFists") fistHand = gestures.nextFist; // gesture идёт раньше palm: рука этого удара
    gestures = startGesture(gestures, e.ability);
  } else if (e.kind === "burst" || e.kind === "palm" || e.kind === "flash" || e.kind === "flinch") vfx.apply(e, nowS, fistHand);
  else if (e.kind === "sound") audio?.play(e.id, e.pos, e.gain);
  else if (e.kind === "trauma" || e.kind === "kick" || e.kind === "fov") feel = addFeel(feel, e);
  else if (e.kind === "hitstop") hitstopUntil = Math.max(hitstopUntil, nowS + e.ms / 1000);
  else combat.apply(e, nowS);
};

// в кадре, вместо цикла stepPlayer фазы 1:
for (let k = 0; k < clock.ticks; k++) {
  const step = stepMatch(cur, { [LOCAL]: buildMatchInput(keys, look) }, ctx);
  prev = cur;
  cur = step.state;
  const m = unitById(cur, LOCAL)!.move;
  if (m.landVel < 0) landVel = Math.min(landVel, m.landVel);
  for (const ev of step.events) {
    if (ev.type === "respawn" && ev.target === LOCAL) [look, prev] = [{ yaw: ev.yaw, pitch: 0 }, cur];
    for (const e of effectsFor(ev, { localId: LOCAL, state: cur })) route(e, nowS);
  }
}
const me = unitById(cur, LOCAL)!;
const p = lerpVec((unitById(prev, LOCAL) ?? me).move.body.pos, me.move.body.pos, clock.alpha);
const shake = stepCameraFeel(feel, rawMs / 1000, prefs.cameraMotion);
feel = shake.feel;
cam.position.set(p.x, p.y + EYE_HEIGHT, p.z);
cam.rotation.set(look.pitch + shake.offset.pitch, look.yaw + shake.offset.yaw, shake.offset.roll, "YXZ");
cam.translateX(shake.offset.x);
cam.translateY(shake.offset.y);
if (cam.fov !== WORLD_FOV + shake.offset.fovDeg) {
  cam.fov = WORLD_FOV + shake.offset.fovDeg;
  cam.updateProjectionMatrix();
}
cam.updateMatrixWorld();
const handDt = nowS < hitstopUntil ? 0 : rawMs / 1000; // визуальный hitstop: руки стоят, симуляция идёт (GDD 2.2)
// updateHandRig — как в фазе 1, но с handDt и скоростью/опорой из me.move
const g = stepGestures(gestures, handDt);
gestures = g.state;
mittens.update(hands.pose, cam.matrixWorldInverse, g.pose);
vfx.sync({ prev, cur, alpha: clock.alpha, nowS, camera: cam, localId: LOCAL, palms: mittens.palms() });
combat.update({ cur, prev, alpha: clock.alpha, localId: LOCAL, camera: cam, nowS, visible: (q) => lineOfSight(world, cam.position, q) });
audio?.setListener(cam.position, look.yaw);
renderer.render(scene, mittens.scene, vfx.fx);
```
Обвязка:
- прогрев: `renderer.warmUp(scene, mittens.scene, vfx.fx)`, затем `showElementSelect(root, prefs.element)`. Выбор: `prefs.element = e`, `savePrefs`, `cur = prev = respawnMage(cur, LOCAL, e)`. Если выбор кликом — сразу `input.requestLock()` и `audio?.unlock()` (клик даёт право на захват мыши и звук), иначе меню паузы с «Играть»;
- «Играть» — `audio?.unlock()` и захват;
- меню, «Огонь» / «Земля»: `respawnMage`, `look = spawn.yaw`, `savePrefs`, `hud.setElement`. Счётчики сохраняются;
- ползунок «Движение камеры» — `prefs.cameraMotion`, `savePrefs`;
- `input.onPress(KEYS.ult, …)` — тост «<ульта> — скоро» через `combat.apply`, название из `ELEMENT_INFO[element].ult`;
- `combat.setVisible(input.locked)` при смене захвата;
- `shouldRespawn` и `spawnPlayer` фазы 1 больше не вызываются — сброс и возрождение теперь в `stepMatch` (`respawn.ts` и его тесты остаются).

Run: `pnpm typecheck`, `pnpm test`, `pnpm build:client`
Expected: типы без ошибок; все тесты зелёные — 412 прежних и 92 новых (9 + 11 + 13 + 21 + 15 + 5 + 11 + 2 + 5), итого 504; сборка проходит, `dist/assets` в сумме ≤ 1 МБ.

- [ ] **Step 5: Коммит**

```bash
git add packages/arena/src/training.ts packages/arena/src/training.sim.test.ts packages/arena/src/index.ts apps/client/src/sandbox && git commit -m "feat: training ground on / — six dummies, both elements, all eight abilities with VFX, HUD and sound" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Живая проверка (контролёр, затем владелец)**

`pnpm dev:client`, `http://localhost:5173/`. Pointer Lock требует настоящего клика: шаги с мышью делает владелец, если в окне проверки захват не срабатывает.
1. «Загрузка…», потом поверх сцены «Выбери стихию». Через 10 с выбирается подсвеченная, открывается меню «DoodleMagic · полигон».
2. «Играть» → ходьба, прыжок, лестница — как в фазе 1. Внизу ячейки «ЛКМ Q E C X», слева HP, справа «Урон 0 · Убийства 0 · Сбросы 0».
3. **Огонь, ЛКМ.** Руки бьют по очереди со вспышкой и треском, трассы оранжевые. На манекене — хитмаркер, белая вспышка, «12» с подскоком, полоса HP падает, манекен качается. Через ~2,5 с удержания — «Перегрев», темп вдвое меньше, полоса жара тает за 1,5 с. Отпустить — жар остывает.
4. **Q.** Ладони сходятся 0,25 с, шар летит, оранжевый взрыв; «50», цифры горения складываются; манекен подлетает и отъезжает на ~3 м. Шар в манекен у кромки → манекен в ущелье, «Сброс!», «Сбросы 1», через 3 с манекен на месте.
5. **E.** Рывок на 8 м с толчком FOV, в том числе в прыжке; горящий след 2 с жжёт манекен, сквозь которого проскочил.
6. **C.** По полу 0,4 с бегут искры, встаёт стена пламени 10 м и закрывает манекены за собой; кулаки летят сквозь неё; проходящий манекен получает «30» и горит.
7. **«Кураж»:** добить манекен → «Кураж!», жар 0, E сразу готов.
8. **Меню → «Земля»:** маг на точке полигона, счётчики те же. ЛКМ — камень вырывается из пола, замах 0,2 с, глухой удар, «30».
9. **Q.** Трещины под прицелом 0,6 с (прицел на манекене — под ним), удар, манекен взлетает на 3,5 м, столб стоит 4 с. Q себе под ноги — маг поднимается на столб 2,5 м. Q в прыжке — «Нужна опора».
10. **E.** Стена растёт 2 м впереди за 0,3 с, держит камни, после 9 попаданий рассыпается обломками; сама проседает через 6 с.
11. **C.** Замах 0,4 с, глухой удар, кольцо пыли 7 м. Близкие манекены с нефритовым кольцом «корни», все «медленно». На галерее (+4 м) не задевает.
12. X — тост «Дыхание дракона — скоро» или «Тектонический разлом — скоро».
13. Вид (GDD 6): манекены — самое тёмное в кадре, с белым ореолом; магия — самое яркое и единственное цветное; свет взрыва не заливает манекен; руки закрывают эффекты за собой.
14. «Ё»: вызовов ≤ 40, 60 FPS на «Высоком». Перезагрузка — стихия и «Движение камеры» на месте. `/nettest`, `/render-test`, `/fx-test` открываются.

- [ ] **Step 7: Приёмка: цифры GDD → код**

| GDD | Константа (`packages/sim/src/match/defs.ts`) | Тест |
|---|---|---|
| Огонь 150 HP, 6,5 м/с; Земля 170, 6,0 | `FIRE.hp/runSpeed`, `EARTH.hp/runSpeed` | `contracts`, `units: slows…` |
| Кулаки 12 урона, 5/с, 40 м/с | `FIRE.fireFists` | `fire: fists…`, `projectiles: fire fist…` |
| Жар +8, 35/с через 0,3 с, 100 → ×0,5 на 1,5 с | `FIRE.heat` | `fire: heat…`, `fire: cools…` |
| Шар 50/20, r 3 м, 22 м/с, замах 0,25 с, Горение 6/с × 3 с, КД 8 с | `FIRE.fireball`, `STATUS.burning` | `fire: fireball…`, `projectiles: fireball…`, `combat: burning…` |
| Рывок 8 м / 0,2 с, след 2 с × 6/с, КД 8 с | `FIRE.jetDash` | `fire: jet dash…`, `zones: fire trail…` |
| Стена огня ≤ 15 м, 10 × 2,5 м, 5 с, 0,4 с, 30 + Горение, КД 12 с | `FIRE.fireWall` | `fire: fire wall…`, `zones: fire wall…`, `dynamic: noSight…` |
| «Кураж» | `courage()` | `combat: kills…`, `fire: «Кураж»…` |
| Камень 30, 1,9/с, 40 м/с, замах 0,2 с, 0,5 м | `EARTH.stoneShot` | `earth: stone shot…`, `projectiles: stone…` |
| Столб 20 м, 0,6 с, 35, подброс 3,5 м, 1,2 × 1,2 × 2,5, 200 HP, 4 с, под себя 2,5 м, КД 10 с | `EARTH.stonePillar` | `earth: pillar…` (3 теста), `zones: pillar…` |
| Стена 2 м, 4 × 2,5 × 0,6, 0,3 / 0,2 с, 250 HP, 6 с, КД 12 с | `EARTH.stoneWall` | `earth: stone wall…`, `terrain: *` |
| Землетрясение 7 м, 40, −40 % 2 с, 3 м — 0,5 с, не в воздухе, КД 14 с | `EARTH.earthquake` | `earth: earthquake…`, `zones: quake…` |
| «Корни»: ×0,5, Q и C только на полу | `EARTH.passive`, проверки в `earth.ts` | `combat: halves…`, `earth: pillar needs ground…`, `earth: earthquake…` |
| «В воздухе» 0,3 с, +15 %, иммунитет 2 с | `STATUS.airborne`, `STATUS.hardCcImmunityS` | `combat: airborne…` |
| Реген 4 с, 20/с до ⅔ | `MAGE_REGEN` | `combat: regen…` |
| Телеграф ≥ 0,4 с, контроль в пределах | `TELEGRAPH_MIN_S`, `CC_LIMITS` | `contracts: keeps every telegraph…` |
| Отбрасывание в метрах, ≤ 12 / 6 м | `KNOCKBACK`, `knockbackSpeed` | `combat: knockback…` |
| Рельеф твёрдый через ≥ 0,2 с, ≤ 3 на мага, ≤ 24 | `LIMITS`, `solidS` | `terrain: *` |
| Сброс засчитывается за 5 с | `MATCH.fallCreditS` | `combat: credits the last hitter…`, `training: knock-off…` |

- [ ] **Step 8: Статус в дорожной карте, пуш**

В `docs/superpowers/plans/2026-10-17-prototype-roadmap.md`, раздел «Статус…»:
```markdown
- Фаза 2-lite, код: готово на <дата> — полигон на `/`: Огонь и Земля, все 8 способностей ЛКМ/Q/E/C по GDD 4.3–4.4, пассивки, статусы, шесть манекенов, проход света магии, HUD, синтез звука. `/fx-test` — отладка эффектов. Тестов в репозитории: <N>. Вне фазы: YAML и hot-reload, реакции стихий, ульты, `pnpm balance`, сеть. Оценка владельца: <стоит ли продолжать, что понравилось, что нет>.
```
```bash
git add docs/superpowers/plans/2026-10-17-prototype-roadmap.md && git commit -m "docs: phase 2-lite abilities demo status" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```
Пуш в `main` выкатывает Vercel на https://doodle-magic-eight.vercel.app. Ссылку отдать владельцу.

---

## После фазы 2-lite
- Если владелец решит продолжать: таблицы `defs.ts` переезжают в YAML со схемами Zod и hot-reload, затем реакции «Раскалённый камень», «Метеор», «воздушное попадание», затем сеть фазы 3 на том же `stepMatch`.
- Цифры, которые решил этот план (таблица решений), — первые кандидаты на правку по впечатлениям владельца.
