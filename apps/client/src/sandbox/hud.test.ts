import { describe, expect, it } from "vitest";
import { HINT, MENU_LEAD, MENU_TITLE, controlRows } from "./hud";

describe("pause menu copy", () => {
  it("names the training ground and invites to try every ability", () => {
    expect(MENU_TITLE).toBe("DoodleMagic · полигон");
    expect(MENU_LEAD).toBe("Галерея над ущельем. Шесть манекенов ждут — попробуй каждую способность.");
    expect(HINT).toBe("ЛКМ — атака · Q E C — приёмы · пробел — прыжок · Esc — меню");
  });

  it("lists the element's four abilities by key, the ult as «скоро», then movement and the menu", () => {
    expect(controlRows("fire")).toEqual([
      { key: "ЛКМ", action: "Огненные кулаки", soon: false },
      { key: "Q", action: "Огненный шар", soon: false },
      { key: "E", action: "Реактивный рывок", soon: false },
      { key: "C", action: "Стена огня", soon: false },
      { key: "X", action: "Дыхание дракона", soon: true },
      { key: "WASD", action: "ходить", soon: false },
      { key: "Пробел", action: "прыжок", soon: false },
      { key: "Esc", action: "меню", soon: false },
    ]);
    expect(controlRows("earth").slice(0, 5).map((r) => r.action)).toEqual(["Каменный снаряд", "Каменный столб", "Каменная стена", "Землетрясение", "Тектонический разлом"]);
  });
});
