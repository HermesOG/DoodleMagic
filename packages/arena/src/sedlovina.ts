import type { ArenaData, ArenaVariant } from "@doodlemagic/sim";
import { clipArena, createArenaBuilder, type ArenaBuilder } from "./dsl";
import { box } from "./geom";

/**
 * «Седловина» (design/round5-arena/05-sedlovina-plus.md), 64 × 48 м. Оси three.js: X вправо, Y вверх, Z к зрителю;
 * пол на y = 0. Всё внутри mirror() повторяется зеркально относительно z = 0: половины A (z < 0) и B (z > 0) одинаковы.
 * Ниже координаты записаны для половины A.
 *
 * Монастырь на седловине: с севера и юга дворы замыкает корпус (7 м на x ±12…±22, иначе ограда 4 м — окна неба), на
 * западе и востоке гора обрывается в облака. По оси карты (|z| < 6…7,5) три пустоты: западный разлом, колодец руны и
 * восточный разлом. В колодце — остров руны 6 × 6 с крестом из четырёх мостов по 4 м и звонницей; между колодцем и
 * разломами — перешейки 14,5 м с фонарями у кромок. На западе — плато +2,8 с павильоном, лестницей, потоком и висячим
 * мостом к плато B; на востоке — сад: помост +2,8 с лестницей и потоком, трава у кромки и садовый мост на 0.
 * Ярусы: 0; +1,4 (парапеты); +2,8 (плато, помосты, висячий мост: Хват стягивает, Цунами снизу не достаёт); кровля
 * звонницы +7; шпиль +12. Навесов ниже 6 м над дворами нет: Ураган поднимает мага на 3 м.
 * Со дворов обычным ударом не сбросить: колодец прикрыт парапетом 1,4 м (проём 4 м под мост), к разломам дворы не
 * выходят — их отделяют дровяники. Сбрасывают с острова, мостов, перешейков у пустоты и полосы сада у разлома.
 * Между полными укрытиями — либо вплотную, либо не меньше 1,2 м; между укрытием и кромкой — так же.
 * Ступа и сторожевая башня за разломами — только рисунок, без коллизии (дальше, чем долетает Воздух).
 */
export const SEDLOVINA = {
  name: "Седловина",
  full: box(-32, -16, -24, 32, 13, 24),
  /** Компакт (≤ 3 игроков): стены x = ±22 там, где были плато и сад, на оси — x = ±25 (щели-пустоты 3 м у перешейков). */
  compact: box(-25.5, -16, -24, 25.5, 13, 24),
  /** Пустоты по оси: зоны смерти ниже −3 м во всю ширину. */
  voids: {
    west: { x0: -32, x1: -22, z0: -6, z1: 6 },
    well: { x0: -7.5, x1: 7.5, z0: -7.5, z1: 7.5 },
    east: { x0: 22, x1: 32, z0: -6, z1: 6 },
  },
  /** Ярус плато, помостов и висячего моста. */
  tierY: 2.8,
  /** Остров руны: половина стороны. */
  islandHalf: 3,
  /** Кровля звонницы и верх шпиля. */
  belfryRoofY: 7,
  spireY: 12,
} as const;

// ---------------------------------------------------------------- размеры

const TIER = SEDLOVINA.tierY;
const V = SEDLOVINA.voids;
/** Низ фундамента: до него уходят плиты пола и стены. */
const FOUNDATION_Y = -1.5;
/** Дно пустот: туда уходят обрывы. */
const CLIFF_Y = -14;
/** Зона смерти: от −3 м до низа арены. */
const KILL_TOP = -3;
/** Корпус: задняя грань, толщина; высоты ограды и корпуса со знамёнами. */
const BACK_Z = -22;
const SHELL_T = 2;
const FENCE_H = 4;
const HALL_H = 7;
/** Полное укрытие — 2,6 м; кровля зала, беседок и кладовой — слоем 0,3 м поверх. */
const COVER_H = 2.6;
const ROOF_T = 0.3;
/** Парапет: видно поверх (глаза 1,6 м), не запрыгнуть (прыжок 1,25 м). */
const PARAPET_H = 1.4;
const PARAPET_T = 0.3;
/** Поток поднимает на 5,3 м: выше яруса на рост мага. */
const LIFT_M = 5.3;
/** Лестница на ярус: 6 ступеней по 0,47 м. */
const STAIR_STEPS = 6;
/** Мосты: толщина плиты. */
const BRIDGE_T = 0.6;
/** Тонкие линии тушью по кромкам (только рисунок). */
const LINE = { t: 0.15, h: 0.12 };

// ---------------------------------------------------------------- части

/** Корпус, плиты пола и обрывы пустот. */
function shell(b: ArenaBuilder, variant: ArenaVariant): void {
  b.mirror(() => {
    // корпус: 7 м там, где висят знамёна (x ±12…±22), иначе ограда 4 м; над плато — на парапет 1,4 м выше яруса
    const seg = (x0: number, x1: number, h: number) => b.box(x0, FOUNDATION_Y, BACK_Z - SHELL_T, x1, h, BACK_Z, { tag: "shell" });
    if (variant === "full") seg(-32, -22, TIER + PARAPET_H);
    seg(-22, -12, HALL_H);
    seg(-12, 12, FENCE_H);
    seg(12, 22, HALL_H);
    if (variant === "full") seg(22, 32, FENCE_H);
    // плиты пола: двор до кромки колодца
    b.box(-22, FOUNDATION_Y, BACK_Z, 22, 0, V.well.z0, { material: "floor" });
    // обрыв колодца со стороны двора
    b.box(V.well.x0, CLIFF_Y, V.well.z0 - 1, V.well.x1, FOUNDATION_Y, V.well.z0);
  });
  // перешейки: от разломов до колодца
  b.box(-22, FOUNDATION_Y, V.well.z0, V.well.x0, 0, V.well.z1, { material: "floor" });
  b.box(V.well.x1, FOUNDATION_Y, V.well.z0, 22, 0, V.well.z1, { material: "floor" });
  // обрывы колодца и разломов со стороны перешейков
  b.box(V.well.x0 - 1, CLIFF_Y, V.well.z0, V.well.x0, FOUNDATION_Y, V.well.z1);
  b.box(V.well.x1, CLIFF_Y, V.well.z0, V.well.x1 + 1, FOUNDATION_Y, V.well.z1);
  b.box(V.west.x1, CLIFF_Y, V.west.z0, V.west.x1 + 1, FOUNDATION_Y, V.west.z1);
  b.box(V.east.x0 - 1, CLIFF_Y, V.east.z0, V.east.x0, FOUNDATION_Y, V.east.z1);
  // зоны смерти: во всю ширину пустот, от −3 м до низа арены
  const bottom = SEDLOVINA.full.min.y;
  for (const v of [V.west, V.well, V.east]) b.volume("kill", v.x0, bottom, v.z0, v.x1, KILL_TOP, v.z1);
}

/** Колодец руны: остров 6 × 6, крест из четырёх мостов, звонница. */
function well(b: ArenaBuilder): void {
  const h = SEDLOVINA.islandHalf;
  const w = V.well;
  // остров руны и его столб из облаков (столб — только рисунок)
  b.box(-h, -BRIDGE_T, -h, h, 0, h, { material: "floor", tag: "rune" });
  b.box(-1.5, CLIFF_Y, -1.5, 1.5, -BRIDGE_T, 1.5, { collide: false });
  // знак руны на острове — золото, только рисунок
  b.box(-1.2, 0, -1.2, 1.2, 0.04, 1.2, { material: "gold", collide: false });
  // мосты запад и восток (4,5 × 4) — с перешейков
  b.box(w.x0, -BRIDGE_T, -2, -h, 0, 2, { material: "floor", tag: "bridge" });
  b.box(h, -BRIDGE_T, -2, w.x1, 0, 2, { material: "floor", tag: "bridge" });
  b.mirror(() => {
    // мост A (4 × 4,5) — со двора через проём парапета
    b.box(-2, -BRIDGE_T, w.z0, 2, 0, -h, { material: "floor", tag: "bridge" });
    // парапет 1,4 м по кромке колодца со стороны двора, в нём проём 4 м под мост
    b.box(w.x0, 0, w.z0 - PARAPET_T, -2, PARAPET_H, w.z0, { tag: "parapet" });
    b.box(2, 0, w.z0 - PARAPET_T, w.x1, PARAPET_H, w.z0, { tag: "parapet" });
    // звонница: столбы 1 × 1 по углам острова (западный и восточный в половине A)
    b.box(-h, 0, -h, -h + 1, SEDLOVINA.belfryRoofY, -h + 1, { tag: "belfry" });
    b.box(h - 1, 0, -h, h, SEDLOVINA.belfryRoofY, -h + 1, { tag: "belfry" });
    // линии тушью по кромкам моста A и острова
    b.box(-2, 0, w.z0, -2 + LINE.t, LINE.h, -h, { material: "edge", collide: false });
    b.box(2 - LINE.t, 0, w.z0, 2, LINE.h, -h, { material: "edge", collide: false });
    // кромки перешейков у колодца (вдоль x = ±7,5 от фонарей у углов до мостов) и кромки мостов запад и восток
    b.box(w.x0 - LINE.t, 0, -6.8, w.x0, LINE.h, -2, { material: "edge", collide: false });
    b.box(w.x1, 0, -6.8, w.x1 + LINE.t, LINE.h, -2, { material: "edge", collide: false });
    b.box(w.x0, 0, -2, -h, LINE.h, -2 + LINE.t, { material: "edge", collide: false });
    b.box(h, 0, -2, w.x1, LINE.h, -2 + LINE.t, { material: "edge", collide: false });
  });
  // кровля звонницы +7…7,6 (с выносом 0,5 м), колокол 4,8–7 под ней, шпиль до +12 — только рисунок
  const roof = SEDLOVINA.belfryRoofY;
  b.box(-h - 0.5, roof, -h - 0.5, h + 0.5, roof + 0.6, h + 0.5, { material: "roof", tag: "belfry" });
  b.box(-0.7, 4.8, -0.7, 0.7, roof, 0.7, { material: "roof", tag: "bell" });
  b.box(-1, roof + 0.6, -1, 1, 9.6, 1, { material: "roof", collide: false });
  b.box(-0.4, 9.6, -0.4, 0.4, SEDLOVINA.spireY, 0.4, { material: "roof", collide: false });
  b.pickup("rune", 0, 0.5, 0);
}

/** Двор половины: зал, беседки, контрфорсы, пилон, кладовая, фонарные столбы, дровяники, фонари у колодца. */
function courtyard(b: ArenaBuilder): void {
  const cover = (x0: number, z0: number, x1: number, z1: number, h = COVER_H, tag?: string) =>
    b.box(x0, 0, z0, x1, h, z1, tag ? { tag } : {});
  /** Постройка с кровлей: тело камнем, сверху слой кровли; верх — на h. */
  const roofed = (x0: number, z0: number, x1: number, z1: number, h: number) => {
    b.box(x0, 0, z0, x1, h - ROOF_T, z1);
    b.box(x0, h - ROOF_T, z0, x1, h, z1, { material: "roof" });
  };
  b.mirror(() => {
    // Против 05 двор поправлен по тестам Р13 (sedlovina.test.ts): проходы между зонами не уже 4 м и линии по
    // земле не длиннее 40 м держатся только вместе, поэтому сдвиги ниже согласованы между собой.
    // Зал 8 × 5,5 × 4 (в 05 — 8 × 6): полоса между залом и парапетом колодца была 3,7 м, стала 4,2.
    roofed(-4, -17.5, 4, -12, FENCE_H);
    // Беседки 5 × 3 × 2,6 (в 05 — 5 × 4): от них до фонарей у углов колодца 4 м — проход из бокового двора в
    // полосу перед залом. Восточная сдвинута на 1 м к востоку: вместе с фонарём у колодца она закрывает косые
    // линии из-за зала через перешеек во двор другой половины.
    roofed(-13, -16, -8, -13, COVER_H);
    roofed(9, -16, 14, -13, COVER_H);
    // у корпуса: контрфорсы и пилон; за ними и сбоку от них стоят спауны
    cover(-12, BACK_Z, -10, -17.5, FENCE_H);
    cover(10, BACK_Z, 12, -17.5, FENCE_H);
    cover(-1, BACK_Z, 1, -19.5, FENCE_H);
    // кладовая в западном углу, вплотную к плато (в компакте — к стене)
    roofed(-22, BACK_Z, -19, -19, FENCE_H);
    // Фонарные столбы: укрытие во дворе не дальше 6 м, режут линии вдоль полосы перед залом. Западный 1,5 × 3,5
    // (в 05 — z −11,5…−8) стоял в устье прохода 5 м между лестницей плато и беседкой и делил его на 1,3 и 2,3 м —
    // сдвинут на север вплотную к дровянику. Восточный вытянут стенкой 1,5 × 6,2 от линии беседки до дровяника и
    // отодвинут на x 18…19,5: короче он пропускает косые линии с запада двора в сад (до 43 м)
    cover(-18, -10.3, -16.5, -6.8);
    cover(18, -13, 19.5, -6.8);
    // дровяники у выхода на перешеек: в 1,2 м от угла разлома, двор к разломам не выходит
    cover(-20.8, -6.8, -12.5, -5.8);
    cover(12.5, -6.8, 20.8, -5.8);
    // фонари у углов колодца: вплотную к кромке перешейка
    cover(V.well.x0 - 1, -9, V.well.x0, -6.8, COVER_H, "lantern");
    cover(V.well.x1, -9, V.well.x1 + 1, -6.8, COVER_H, "lantern");
    // спауны у светлой стены: за контрфорсами и по сторонам пилона, лицом во двор
    for (const x of [-13, -2, 2, 13]) b.spawn(x, 0, -21.2, Math.PI);
  });
  // перешейки: фонарь вплотную к разлому и фонарь 1 × 1 в 4 м от колодца (в 05 — 1,5 × 1 в 2 м: он стоял прямо
  // перед мостом к руне, и обход вокруг него был 2,6 м); между ними 8,5 м свободной середины
  for (const [x0, x1] of [
    [-22, -21],
    [-12.5, -11.5],
    [11.5, 12.5],
    [21, 22],
  ] as const) {
    b.box(x0, 0, -0.5, x1, COVER_H, 0.5, { tag: "lantern" });
  }
  // «жадные» сферы за фонарём перешейка у разломов
  b.pickup("orb", -20.25, 0.5, 0);
  b.pickup("orb", 20.25, 0.5, 0);
}

/** Трава: объём для горения и кочки-мазки без коллизии. */
function grass(b: ArenaBuilder, x0: number, z0: number, x1: number, z1: number): void {
  b.volume("grass", x0, 0, z0, x1, 0.8, z1);
  let k = 0;
  for (let x = x0 + 0.5; x < x1 - 0.2; x += 1) {
    for (let z = z0 + 0.5; z < z1 - 0.2; z += 1) {
      const h = 0.35 + 0.15 * (k++ % 3);
      b.box(x - 0.3, 0, z - 0.3, x + 0.3, h, z + 0.3, { material: "grass", collide: false });
    }
  }
}

/** Восходящий поток: объём у края яруса и глиф на полу. */
function updraft(b: ArenaBuilder, x0: number, z0: number, x1: number, z1: number): void {
  b.volume("updraft", x0, 0, z0, x1, 1, z1, LIFT_M);
  b.box(x0 + 0.3, 0, z0 + 0.3, x1 - 0.3, 0.05, z1 - 0.3, { material: "gold", collide: false });
}

/** Запад полного варианта: плато +2,8 с павильоном, лестницей, потоком и висячим мостом. */
function plateau(b: ArenaBuilder): void {
  b.mirror(() => {
    // плато от фундамента: его край у разлома — обрыв
    b.box(-32, FOUNDATION_Y, BACK_Z, V.west.x1, TIER, V.west.z0, { tag: "tier" });
    b.box(-32, CLIFF_Y, V.west.z0 - 1, V.west.x1, FOUNDATION_Y, V.west.z0);
    // павильон у края мира: тело и кровля, верх +5,4
    b.box(-32, TIER, -17, -26, TIER + COVER_H - ROOF_T, -11);
    b.box(-32, TIER + COVER_H - ROOF_T, -17, -26, TIER + COVER_H, -11, { material: "roof" });
    // парапет 1,4 м по краю мира (x = −32), до павильона и после него — до фонаря моста: дальше угол плато и так
    // у кромки разлома, а парапет до самой кромки оставил бы между собой и фонарём глухой карман 1,7 м
    b.box(-32, TIER, BACK_Z, -32 + PARAPET_T, TIER + PARAPET_H, -17, { tag: "parapet" });
    b.box(-32, TIER, -11, -32 + PARAPET_T, TIER + PARAPET_H, -7.25, { tag: "parapet" });
    // лестница со двора на плато: поднимается на запад
    b.stairs({ x0: V.west.x1, z0: -16, x1: -18, z1: -12, y0: 0, y1: TIER, dir: "-x", steps: STAIR_STEPS });
    updraft(b, V.west.x1, -18.5, -20, -16.5);
    // фонари у головы висячего моста, на плато
    b.box(-30, TIER, -7.25, -29, TIER + COVER_H, V.west.z0, { tag: "lantern" });
    b.box(-25, TIER, -7.25, -24, TIER + COVER_H, V.west.z0, { tag: "lantern" });
    // спаун A1 — на плато за павильоном, лицом на восток. В 05 он в (−30; −18,5): оттуда его видно с моста A
    // и садового моста мимо угла павильона; ближе к павильону и к краю мира угол павильона его закрывает
    b.spawn(-31, TIER, -17.8, -Math.PI / 2);
  });
  // висячий мост +2,8 между плато A и B: 3 м до края мира и 3 м до перешейка
  b.box(-29, TIER - 0.4, V.west.z0, -25, TIER, V.west.z1, { material: "floor", tag: "bridge" });
  b.box(-29, TIER, V.west.z0, -29 + LINE.t, TIER + LINE.h, V.west.z1, { material: "edge", collide: false });
  b.box(-25 - LINE.t, TIER, V.west.z0, -25, TIER + LINE.h, V.west.z1, { material: "edge", collide: false });
}

/** Восток полного варианта: сад с помостом +2,8, лестницей, потоком, травой у кромки и садовым мостом. */
function garden(b: ArenaBuilder): void {
  b.mirror(() => {
    b.box(V.east.x0, FOUNDATION_Y, BACK_Z, 32, 0, V.east.z0, { material: "floor" });
    b.box(V.east.x0, CLIFF_Y, V.east.z0 - 1, 32, FOUNDATION_Y, V.east.z0);
    // контрфорс сада: за ним спаун A6
    b.box(22, 0, BACK_Z, 24, FENCE_H, -17.5);
    // помост +2,8 у края мира; лестница с юга, поток с севера
    b.box(25, 0, -16, 32, TIER, -10, { tag: "tier" });
    b.stairs({ x0: 27.7, z0: -20, x1: 31.7, z1: -16, y0: 0, y1: TIER, dir: "+z", steps: STAIR_STEPS });
    updraft(b, 26, -10, 28, -8);
    // край мира (x = 32): парапет 1,4 м на полу и на помосте, вдоль лестницы — глухая щека вровень с парапетом
    // помоста; лестница из-за неё на 0,3 м западнее, чем в 05 (x 27,7…31,7), и остаётся шириной 4 м
    const px = 32 - PARAPET_T;
    b.box(px, 0, BACK_Z, 32, PARAPET_H, -20, { tag: "parapet" });
    b.box(px, 0, -20, 32, TIER + PARAPET_H, -16);
    b.box(px, TIER, -16, 32, TIER + PARAPET_H, -10, { tag: "parapet" });
    b.box(px, 0, -10, 32, PARAPET_H, V.east.z0, { tag: "parapet" });
    // фонарь у головы садового моста
    b.box(27, 0, -7, 28, COVER_H, V.east.z0, { tag: "lantern" });
    grass(b, 22, -10, 25, -6);
    b.spawn(26, 0, -21.2, Math.PI);
    b.pickup("orb", 29, TIER + 0.5, -13);
  });
  // садовый мост на 0, вплотную к краю мира: 6 м до перешейка
  b.box(28, -BRIDGE_T, V.east.z0, 32, 0, V.east.z1, { material: "floor", tag: "bridge" });
  b.box(28, 0, V.east.z0, 28 + LINE.t, LINE.h, V.east.z1, { material: "edge", collide: false });
}

/** Ориентиры без коллизии за разломами: ступа на скале (запад, верх +9) и сторожевая башня (восток, верх +14). */
function landmarks(b: ArenaBuilder): void {
  // ступа: скала из облаков, тело, «купол», шпиль
  b.box(-41, CLIFF_Y, -3, -35, 2, 3, { collide: false });
  b.box(-40, 2, -2, -36, 5, 2, { collide: false });
  b.box(-39.2, 5, -1.2, -36.8, 7, 1.2, { collide: false });
  b.box(-38.3, 7, -0.3, -37.7, 9, 0.3, { material: "gold", collide: false });
  // сторожевая башня на скальном зубце
  b.box(35, CLIFF_Y, -3, 41, 1, 3, { collide: false });
  b.box(36.5, 1, -1.5, 39.5, 12.5, 1.5, { collide: false });
  b.box(36, 12.5, -2, 40, 13.2, 2, { material: "roof", collide: false });
  b.box(37.7, 13.2, -0.3, 38.3, 14, 0.3, { material: "roof", collide: false });
}

/**
 * Компакт: плато, сад, висячий и садовый мосты убраны. Стены x = ±22 при |z| ≥ 6 — глыбой до края компакта, её грань
 * у разлома — обрыв щели; на оси — стена x = ±25: вдоль внешних краёв перешейков остаётся щель-пустота 3 м.
 */
function compactWalls(b: ArenaBuilder): void {
  const { min, max } = SEDLOVINA.compact;
  b.mirror(() => {
    b.box(min.x, CLIFF_Y, BACK_Z - SHELL_T, V.west.x1, HALL_H, V.west.z0, { tag: "shell" });
    b.box(V.east.x0, CLIFF_Y, BACK_Z - SHELL_T, max.x, HALL_H, V.east.z0, { tag: "shell" });
  });
  b.box(min.x, CLIFF_Y, V.west.z0, -25, HALL_H, V.west.z1, { tag: "shell" });
  b.box(25, CLIFF_Y, V.east.z0, max.x, HALL_H, V.east.z1, { tag: "shell" });
}

/** Блокаут «Седловины». Компакт (≤ 3 игроков) — без запада и востока, за стенами x = ±22 / ±25 всё отрезано. */
export function buildSedlovina(variant: ArenaVariant = "full"): ArenaData {
  const b = createArenaBuilder();
  shell(b, variant);
  well(b);
  courtyard(b);
  b.mirror(() => grass(b, -20, -11, -18, -8));
  b.mirror(() => b.pickup("orb", -19, 0.5, -9.5));
  if (variant === "compact") {
    compactWalls(b);
    const a = clipArena(b.finish(SEDLOVINA.name, "full", SEDLOVINA.full), SEDLOVINA.compact, "compact");
    // ориентиры за стенами видны поверх них: добавляются после обрезки
    const marks = createArenaBuilder();
    landmarks(marks);
    return { ...a, render: [...a.render, ...marks.finish(SEDLOVINA.name, "compact", SEDLOVINA.compact).render] };
  }
  plateau(b);
  garden(b);
  landmarks(b);
  return b.finish(SEDLOVINA.name, "full", SEDLOVINA.full);
}
