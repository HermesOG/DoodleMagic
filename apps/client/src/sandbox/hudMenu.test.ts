import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MENU_LEAD, MENU_TITLE, createHud, type Hud } from "./hud";
import { DEFAULT_SETTINGS } from "./settings";

/**
 * Тесты идут в node: вместо DOM — элемент-двойник. querySelector отдаёт по селектору всегда один и тот же двойник
 * (разметку innerHTML он не разбирает), document.createElement — новый.
 */
class FakeEl extends EventTarget {
  textContent = "";
  hidden = false;
  value = "";
  checked = false;
  type = "";
  className = "";
  innerHTML = "";
  dataset: Record<string, string> = {};
  classList = { add: () => undefined, toggle: () => undefined, remove: () => undefined };
  private readonly kids: FakeEl[] = [];
  private readonly found = new Map<string, FakeEl>();
  get children(): readonly FakeEl[] {
    return this.kids;
  }
  append(...nodes: FakeEl[]): void {
    this.kids.push(...nodes);
  }
  replaceChildren(...nodes: FakeEl[]): void {
    this.kids.splice(0, this.kids.length, ...nodes);
  }
  setAttribute(): void {}
  querySelector(selector: string): FakeEl {
    let e = this.found.get(selector);
    if (!e) {
      e = new FakeEl();
      this.found.set(selector, e);
    }
    return e;
  }
  click(): void {
    this.dispatchEvent(new Event("click"));
  }
}

let root: FakeEl;
let hud: Hud;
const row = () => root.querySelector(".sb-extra");

beforeEach(() => {
  vi.stubGlobal("document", { createElement: () => new FakeEl() });
  root = new FakeEl();
  hud = createHud(root as unknown as HTMLElement, { ...DEFAULT_SETTINGS }, { element: "fire", cameraMotion: 1 });
});
afterEach(() => vi.unstubAllGlobals());

describe("hud.addMenuButton", () => {
  it("adds a button with the label under «Играть» and calls back on click", () => {
    const onClick = vi.fn();
    hud.addMenuButton("Начать матч", onClick);
    const [b] = row().children;
    expect(b!.textContent).toBe("Начать матч");
    expect(b!.type).toBe("button");
    b!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps buttons in the order they were added; setLabel renames one", () => {
    const start = hud.addMenuButton("Начать матч", () => undefined);
    hud.addMenuButton("Скопировать ссылку", () => undefined);
    start.setLabel("Ещё раз");
    expect(row().children.map((b) => b.textContent)).toEqual(["Ещё раз", "Скопировать ссылку"]);
  });

  it("hides a button, and the whole row while every button in it is hidden", () => {
    const start = hud.addMenuButton("Начать матч", () => undefined);
    expect(row().hidden).toBe(false);
    start.setVisible(false);
    expect(row().children[0]!.hidden).toBe(true);
    expect(row().hidden).toBe(true);
    const copy = hud.addMenuButton("Скопировать ссылку", () => undefined);
    expect(row().hidden).toBe(false);
    copy.setVisible(false);
    expect(row().hidden).toBe(true);
    start.setVisible(true);
    expect(row().hidden).toBe(false);
    expect(row().children.map((b) => b.hidden)).toEqual([false, true]);
  });
});

describe("hud.setMenuText", () => {
  it("starts with the training-ground copy and replaces the title and the lead", () => {
    const title = root.querySelector(".sb-card h1");
    const lead = root.querySelector(".sb-lead");
    expect([title.textContent, lead.textContent]).toEqual([MENU_TITLE, MENU_LEAD]);
    hud.setMenuText("Комната ABCD", "Матч начинает хост.");
    expect([title.textContent, lead.textContent]).toEqual(["Комната ABCD", "Матч начинает хост."]);
  });
});
