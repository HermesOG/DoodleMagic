import type { ArenaData, ArenaVariant } from "@doodlemagic/sim";
import { clipArena, createArenaBuilder, type ArenaBuilder } from "./dsl";
import { box } from "./geom";

/**
 * «Горный монастырь — галерея над ущельем» (GDD 8, рецензия левел-дизайнера), 44 × 36 м.
 * Оси three.js: X вправо, Y вверх, Z к зрителю; пол на y = 0. Всё внутри mirror() повторяется
 * зеркально относительно z = 0, поэтому половины A (z < 0) и B (z > 0) одинаковы. Ниже координаты
 * записаны для половины A.
 *
 * Поперёк карты по z = 0 идёт галерея +4 м с арками: над рвом 6 м, западная 4 м, арка руны 5 м,
 * восточная 4 м; на востоке галерея упирается в башню, за башней — восточный проход 6 м и поток наверх.
 * Под аркой руны — ущелье 12 × 10 м (зона смерти) с площадкой руны 4 × 4 м и двумя мостами по 3 м.
 * Вдоль дальних стен — по 5 келий со спаунами. Двор перед ними делят на три зоны две короткие
 * ширмы у ряда келий; зоны и площадки перед арками связаны пешими путями не уже 4 м. Прямые линии
 * (с земли не длиннее 32 м) режут стелы перед проходами келий, фонари и столбы у ущелья, стена
 * вдоль кромки рва и восточная стена; низкий блок 1 м перепрыгивается. На западе — сухой ров
 * на −1 м; его концы у келий завалены, поэтому вдоль рва линия не длиннее 28 м. Восточный проход
 * за башней закрыт от двора стеной, вход в него — у восточной кладовой.
 * Между полными укрытиями — либо вплотную, либо не меньше 1,2 м: уже — маг застревает.
 */
export const GALLERY = {
  name: "Галерея над ущельем",
  full: box(-22, -16, -18, 22, 9, 18),
  compact: box(-15, -16, -18, 15, 9, 18),
  /** Дыра ущелья в полу. Симметрична относительно z = 0 (z1 = −z0): плиты пола строятся зеркалом. */
  gorge: { x0: -6, x1: 6, z0: -5, z1: 5 },
  /** Верх галереи и башни. */
  deckY: 4,
  wallTop: 8,
} as const;

// ---------------------------------------------------------------- размеры

/** Внутренние грани наружных стен и их толщина. */
const WEST_X = -21.5;
const EAST_X = 21.5;
const BACK_Z = -17.5;
const OUTER_T = 0.5;
/** Низ фундамента: до него уходят плиты пола и стены. */
const FOUNDATION_Y = -1.5;
/** Сухой ров: восточная кромка и дно. */
const MOAT_X1 = -15.5;
const MOAT_Y = -1;
/** Полное укрытие — стелы, ширмы, фонари; низкое укрытие перепрыгивается. */
const FULL_COVER = 2.6;
const LOW_COVER = 1;
/** Толщина ширм и низких стенок. */
const SCREEN_T = 0.4;
/** Валуны во рву: верх над полом двора. */
const BOULDER_TOP = 2.2;

/** Ряд келий: передняя грань, ширина кельи, толщина и высота стен. */
const CELL_ROW_Z = -14;
const CELL_W = 3;
const CELL_WALL = 0.3;
const CELL_H = 3;
const CELL_X0 = [-12.5, -7.5, -2.5, 2.5, 7.5] as const;
const CELL_DOOR = { z1: -15.8, top: 2.4 };
const SPAWN_INSET = { x: 1.4, z: -16.7 };
/**
 * Кладовые по краям ряда: западная — вплотную к первой келье, восточная — через проход 2 м и
 * отступает от ряда на 0,8 м, чтобы вход в восточный проход был 4,2 м.
 */
const STORES = [
  { x0: -15.5, x1: -12.5, z1: CELL_ROW_Z },
  { x0: 12.5, x1: 15.5, z1: -14.8 },
] as const;

/** Галерея: полуширина (стена толщиной 3 м, её верх — дорожка), арки, парапет. */
const DECK_HALF = 1.5;
const ARCH_TOP = 3;
const RUNE_ARCH_TOP = 3.5;
const RUNE_ARCH_HALF = 2.5;
const WEST_ARCH = { x0: -11.5, x1: -7.5 };
const EAST_ARCH = { x0: 7.5, x1: 11.5 };
const PARAPET_T = 0.25;
/** Ось парапета — у внешнего края дорожки. */
const PARAPET_Z = -(DECK_HALF - PARAPET_T / 2);
const PARAPET_LOW = 0.8;
/** Над ущельем парапет выше прыжка (1,25 м), но ниже глаз (1,6 м): через него видно, на него не запрыгнуть. */
const PARAPET_HIGH = 1.4;

/** Башня в конце галереи. */
const TOWER = { x0: 11.5, x1: 15.5, halfZ: 2.5 };
/** Выемка в юго-восточном углу башни (в полном варианте): в ней восходящий поток. */
const NOTCH = { x0: 13.3, x1: TOWER.x1, z1: -1 };

/** Ширмы у ряда келий: западная — у края кельи x0 = −7,5, восточная — у прохода x 5,5…7,5. */
const SCREEN_W_X = -4.7;
const SCREEN_E_X = 6;
/** Северный конец ширм: дальше до фонарей у ущелья 4,1…4,6 м — проход между зонами двора. */
const SCREEN_END_Z = -10.6;
/** Ряд стел перед проходами келий; за ним у келий остаётся полоса 1,8 м. */
const STELE_ROW = { z0: -12.2, z1: -10.6 };
/** Восточная стена: от входа в восточный проход до башни. */
const EAST_WALL = { x0: 15.5, x1: 17.3, z0: -10.6 };
/** Лестница на галерею: от пола у z0 до дорожки у края галереи. */
const STAIR = { x0: -14.5, x1: -11.5, z0: -6.5, steps: 10 };

/** Дно ущелья: туда уходят обрывы и опоры. */
const CLIFF_Y = -14;
/** Площадка руны и мосты. */
const RUNE_HALF = 2;
const BRIDGE_HALF = 1.5;
const KERB = { t: 0.3, h: 0.2 };

// ---------------------------------------------------------------- части

function shell(b: ArenaBuilder): void {
  const top = GALLERY.wallTop;
  const g = GALLERY.gorge;
  b.box(WEST_X - OUTER_T, FOUNDATION_Y, BACK_Z - OUTER_T, WEST_X, top, -BACK_Z + OUTER_T);
  b.box(EAST_X, FOUNDATION_Y, BACK_Z - OUTER_T, EAST_X + OUTER_T, top, -BACK_Z + OUTER_T);
  b.mirror(() => b.box(WEST_X - OUTER_T, FOUNDATION_Y, BACK_Z - OUTER_T, EAST_X + OUTER_T, top, BACK_Z));
  // ров на −1 м и основной пол; вокруг ущелья — четыре плиты, их края берутся из GALLERY.gorge
  b.box(WEST_X, FOUNDATION_Y, BACK_Z, MOAT_X1, MOAT_Y, -BACK_Z, { material: "floor" });
  b.mirror(() => b.box(MOAT_X1, FOUNDATION_Y, BACK_Z, EAST_X, 0, g.z0, { material: "floor" }));
  b.box(MOAT_X1, FOUNDATION_Y, g.z0, g.x0, 0, g.z1, { material: "floor" });
  b.box(g.x1, FOUNDATION_Y, g.z0, EAST_X, 0, g.z1, { material: "floor" });
}

function gorge(b: ArenaBuilder): void {
  const { x0, x1, z0, z1 } = GALLERY.gorge;
  // обрывы уходят в туман
  b.mirror(() => b.box(x0, CLIFF_Y, z0 - 1, x1, FOUNDATION_Y, z0));
  b.box(x0 - 1, CLIFF_Y, z0, x0, FOUNDATION_Y, z1);
  b.box(x1, CLIFF_Y, z0, x1 + 1, FOUNDATION_Y, z1);
  // площадка руны 4 × 4 и её столб
  b.box(-RUNE_HALF, -0.5, -RUNE_HALF, RUNE_HALF, 0, RUNE_HALF, { material: "gold", tag: "rune" });
  b.box(-1.2, CLIFF_Y, -1.2, 1.2, -0.5, 1.2, { collide: false });
  b.mirror(() => {
    // каменный мост 3 м
    b.box(-BRIDGE_HALF, -0.6, z0, BRIDGE_HALF, 0, -RUNE_HALF, { tag: "bridge" });
    // кромка ущелья: низкий бортик тушью, перешагивается
    b.box(x0, 0, z0 - KERB.t, -BRIDGE_HALF, KERB.h, z0, { material: "edge", tag: "kerb" });
    b.box(BRIDGE_HALF, 0, z0 - KERB.t, x1, KERB.h, z0, { material: "edge", tag: "kerb" });
    // тонкие линии по краям моста и площадки (только рисунок)
    b.box(-BRIDGE_HALF, 0, z0, -1.35, 0.12, -RUNE_HALF, { material: "edge", collide: false });
    b.box(1.35, 0, z0, BRIDGE_HALF, 0.12, -RUNE_HALF, { material: "edge", collide: false });
    b.box(-RUNE_HALF, 0, -RUNE_HALF, -BRIDGE_HALF, 0.12, -1.85, { material: "edge", collide: false });
    b.box(BRIDGE_HALF, 0, -RUNE_HALF, RUNE_HALF, 0.12, -1.85, { material: "edge", collide: false });
  });
  b.box(x0 - KERB.t, 0, z0, x0, KERB.h, z1, { material: "edge", tag: "kerb" });
  b.box(x1, 0, z0, x1 + KERB.t, KERB.h, z1, { material: "edge", tag: "kerb" });
  b.box(-RUNE_HALF, 0, -1.85, -1.85, 0.12, 1.85, { material: "edge", collide: false });
  b.box(1.85, 0, -1.85, RUNE_HALF, 0.12, 1.85, { material: "edge", collide: false });
  // зона смерти: от −3 м до дна арены, во всю дыру
  b.volume("kill", x0, GALLERY.full.min.y, z0, x1, -3, z1);
}

/** Башня в конце галереи; в полном варианте с выемками под восходящие потоки. */
function tower(b: ArenaBuilder, variant: ArenaVariant): void {
  const y = GALLERY.deckY;
  if (variant === "compact") {
    b.box(TOWER.x0, 0, -TOWER.halfZ, TOWER.x1, y, TOWER.halfZ, { tag: "tower" });
    return;
  }
  b.box(TOWER.x0, 0, -TOWER.halfZ, NOTCH.x0, y, TOWER.halfZ, { tag: "tower" });
  b.box(NOTCH.x0, 0, NOTCH.z1, TOWER.x1, y, -NOTCH.z1, { tag: "tower" });
}

function galleryWall(b: ArenaBuilder): void {
  const y = GALLERY.deckY;
  const g = GALLERY.gorge;
  // стена-галерея: верх — дорожка +4 м, внизу арки; над ущельем она стоит на опорах (ниже)
  b.wallX(0, WEST_X, TOWER.x0, {
    height: y,
    thick: 2 * DECK_HALF,
    openings: [
      { from: WEST_X, to: MOAT_X1, top: ARCH_TOP }, // арка над рвом, 6 м
      { from: WEST_ARCH.x0, to: WEST_ARCH.x1, top: ARCH_TOP }, // западная арка, 4 м
      { from: -RUNE_ARCH_HALF, to: RUNE_ARCH_HALF, top: RUNE_ARCH_TOP }, // большая арка над площадкой руны, 5 м
      { from: EAST_ARCH.x0, to: EAST_ARCH.x1, top: ARCH_TOP }, // восточная арка, 4 м
    ],
  });
  // опоры галереи из глубины ущелья: руну видно и простреливают только сквозь арку
  b.box(g.x0, CLIFF_Y, -DECK_HALF, -RUNE_ARCH_HALF, 0, DECK_HALF);
  b.box(RUNE_ARCH_HALF, CLIFF_Y, -DECK_HALF, g.x1, 0, DECK_HALF);
  b.mirror(() => {
    // парапет: 0,8 м, над ущельем 1,4 м, проход к лестнице
    b.wallX(PARAPET_Z, WEST_X, TOWER.x0, {
      y0: y,
      height: PARAPET_HIGH,
      thick: PARAPET_T,
      tag: "parapet",
      openings: [
        { from: WEST_X, to: g.x0, sill: PARAPET_LOW },
        { from: g.x1, to: TOWER.x0, sill: PARAPET_LOW },
        { from: STAIR.x0, to: STAIR.x1 },
      ],
    });
    // лестница на галерею: 10 ступеней по 0,4 м
    b.stairs({ x0: STAIR.x0, z0: STAIR.z0, x1: STAIR.x1, z1: -DECK_HALF, y0: 0, y1: y, dir: "+z", steps: STAIR.steps });
    // щека лестницы со стороны арки — по краю лестницы, вровень с парапетом: со ступеней на неё
    // не шагнуть, и она не сужает площадку перед западной аркой
    b.box(STAIR.x1 - 0.3, 0, STAIR.z0, STAIR.x1, y + PARAPET_LOW, -DECK_HALF);
  });
}

function cells(b: ArenaBuilder): void {
  b.mirror(() => {
    for (const x0 of CELL_X0) {
      // келья 3 × 3,5 м: дверь в восточной стене у задней стены, перед кельей сплошная стена
      b.box(x0, 0, BACK_Z, x0 + CELL_WALL, CELL_H, CELL_ROW_Z);
      b.wallZ(x0 + CELL_W - CELL_WALL / 2, BACK_Z, CELL_ROW_Z, {
        height: CELL_H,
        thick: CELL_WALL,
        openings: [{ from: BACK_Z, to: CELL_DOOR.z1, top: CELL_DOOR.top }],
      });
      b.box(x0, 0, CELL_ROW_Z - CELL_WALL, x0 + CELL_W, CELL_H, CELL_ROW_Z);
      b.spawn(x0 + SPAWN_INSET.x, 0, SPAWN_INSET.z, -Math.PI / 2);
    }
    // кладовые по краям ряда келий: глухие блоки
    for (const s of STORES) b.box(s.x0, 0, BACK_Z, s.x1, CELL_H, s.z1);
    b.box(STORES[0].x0, CELL_H, BACK_Z, STORES[1].x1, CELL_H + 0.3, CELL_ROW_Z, { material: "roof" });
  });
}

function cover(b: ArenaBuilder): void {
  b.mirror(() => {
    const g = GALLERY.gorge;
    // две короткие ширмы у ряда келий делят двор на три зоны; между их северными концами и
    // фонарями — проходы между зонами не уже 4 м
    b.wallZ(SCREEN_W_X, CELL_ROW_Z, SCREEN_END_Z, { height: FULL_COVER, thick: SCREEN_T });
    b.wallZ(SCREEN_E_X, -12.4, SCREEN_END_Z, { height: FULL_COVER, thick: SCREEN_T });
    // стелы перед проходами келий режут прямые линии из проходов; между двумя центральными —
    // низкий блок 1 м: он перепрыгивается и не оставляет у келий глухого кармана
    b.box(-9.6, 0, STELE_ROW.z0, -7.4, FULL_COVER, -11.2); // проход x −9,5…−7,5
    b.box(-4.5, 0, STELE_ROW.z0, -1.5, FULL_COVER, STELE_ROW.z1); // проход x −4,5…−2,5, вплотную к ширме
    b.box(-1.5, 0, STELE_ROW.z0, 0.3, LOW_COVER, STELE_ROW.z1, { tag: "low" });
    b.box(0.3, 0, STELE_ROW.z0, 4.6, FULL_COVER, STELE_ROW.z1); // проход x 0,5…2,5 и дверь средней кельи
    b.box(6.2, 0, -12.4, 8.2, FULL_COVER, -11.6); // проход x 5,5…7,5, примыкает к ширме
    b.box(9.5, 0, STELE_ROW.z0, 11.5, FULL_COVER, -9.6); // проход x 10,5…12,5; вытянута к двору
    // фонари у края ущелья — от прохода к мосту до углов ущелья; западный глубже, он режет
    // косые линии сквозь арку руны из-за западной ширмы
    b.box(g.x0, 0, -6.5, -3, FULL_COVER, g.z0);
    b.box(3.3, 0, -6, g.x1, FULL_COVER, g.z0);
    // столбы у боковых кромок ущелья — рама западной и восточной арок: режут косые линии из арки руны
    b.box(WEST_ARCH.x1, 0, g.z0, g.x0, FULL_COVER, -DECK_HALF);
    b.box(g.x1, 0, g.z0, EAST_ARCH.x0, FULL_COVER, -DECK_HALF);
    // запад: стена вдоль кромки рва и короткая щека у подножия лестницы — длинные линии двора
    // не уходят в ров; выход изо рва — ступень у лестницы и 1 м между концом стены и лестницей
    b.box(MOAT_X1, 0, CELL_ROW_Z, MOAT_X1 + 0.4, FULL_COVER, STAIR.z0 - 1);
    b.box(STAIR.x1 - 0.3, 0, STAIR.z0 - 1, STAIR.x1, FULL_COVER, STAIR.z0);
    // восток: стена от входа в восточный проход до башни закрывает проход от двора; вход — 4,2 м
    // между кладовой и стеной, дальше 4,2 м вдоль восточной стены; угол за кладовой и северо-
    // восточный угол завалены
    b.box(EAST_WALL.x0, 0, EAST_WALL.z0, EAST_WALL.x1, FULL_COVER, -TOWER.halfZ);
    b.box(STORES[1].x1, 0, BACK_Z, 17.5, FULL_COVER, STORES[1].z1);
    b.box(17.5, 0, BACK_Z, EAST_X, FULL_COVER, -15);
    // ров: концы у келий завалены; валун у восточной кромки — укрытие, рядом остаётся 4,2 м,
    // и вместе со щекой у лестницы он не пускает линии со двора в ров
    b.box(WEST_X, MOAT_Y, BACK_Z, MOAT_X1, BOULDER_TOP, CELL_ROW_Z);
    b.box(MOAT_X1 - 1.8, MOAT_Y, -8.5, MOAT_X1, BOULDER_TOP, -6.5);
    // ступень для выхода из рва — у лестницы, между валуном и аркой
    b.box(MOAT_X1 - 1, MOAT_Y, STAIR.z0, MOAT_X1, -0.5, STAIR.z0 + 2, { material: "floor" });
  });
}

function nature(b: ArenaBuilder): void {
  b.mirror(() => {
    // трава: объём для горения (фаза 2) и кочки-мазки без коллизии
    for (const [x0, z0, x1, z1] of [
      [17.5, -15, 21, -11],
      [-13.6, -12.5, -10.2, -10],
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
    b.pickup("orb", -11.9, 0.5, -11.25);
    b.pickup("orb", 18.5, 0.5, -13);
  });
  b.pickup("rune", 0, 0.5, 0);
  b.pickup("orb", -18.5, MOAT_Y + 0.5, 0);
  b.pickup("orb", 13.5, GALLERY.deckY + 0.5, 0);
}

/** Блокаут арены. Компактный вариант (≤ 3 игроков): фланги закрыты глухими стенами, всё за ними отрезано. */
export function buildGallery(variant: ArenaVariant = "full"): ArenaData {
  const b = createArenaBuilder();
  shell(b);
  gorge(b);
  galleryWall(b);
  tower(b, variant);
  cells(b);
  cover(b);
  nature(b);
  if (variant === "full") {
    // восходящий поток на башню — в выемке её угла: сбоку от прохода, а не в нём; глиф на полу
    b.mirror(() => {
      b.volume("updraft", NOTCH.x0, 0, -TOWER.halfZ, NOTCH.x1, 1, NOTCH.z1, 6.5);
      b.box(NOTCH.x0 + 0.3, 0, -TOWER.halfZ + 0.3, NOTCH.x1 - 0.3, 0.05, NOTCH.z1 - 0.3, { material: "gold", collide: false });
    });
  }
  if (variant === "compact") {
    const { min, max } = GALLERY.compact;
    b.box(min.x, FOUNDATION_Y, BACK_Z, min.x + OUTER_T, GALLERY.wallTop, -BACK_Z);
    b.box(max.x - OUTER_T, FOUNDATION_Y, BACK_Z, max.x, GALLERY.wallTop, -BACK_Z);
    return clipArena(b.finish(GALLERY.name, "full", GALLERY.full), GALLERY.compact, "compact");
  }
  return b.finish(GALLERY.name, "full", GALLERY.full);
}
