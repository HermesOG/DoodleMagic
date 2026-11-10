import { describe, expect, it } from "vitest";
import { NAME_MAX } from "../net/protocol";
import {
  NAME_KEY, enteredName, initialName, joinErrorText, joinStatusText, loadName, rosterText, saveName, taglineText, type NameStore,
} from "./lobby";

/** Хранилище в памяти; broken — каждое обращение бросает (приватный режим). */
function memoryStore(broken = false): NameStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key) {
      if (broken) throw new Error("denied");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (broken) throw new Error("denied");
      data.set(key, value);
    },
  };
}

describe("initialName", () => {
  it("takes the saved name, cleaned", () => {
    expect(initialName("  Искра   42 ", () => "Валун 17")).toBe("Искра 42");
  });

  it("falls back to a fresh default name when nothing usable is saved", () => {
    expect(initialName(null, () => "Валун 17")).toBe("Валун 17");
    expect(initialName("\u0000​  ", () => "Валун 17")).toBe("Валун 17");
    expect(initialName(null, () => "   ")).toBe("Маг");
  });
});

describe("enteredName", () => {
  it("cleans what was typed and uses the default for an empty field", () => {
    expect(enteredName(" Огонёк\t ", "Искра 42")).toBe("Огонёк");
    expect(enteredName("   ", "Искра 42")).toBe("Искра 42");
    expect(enteredName("", "")).toBe("Маг");
  });

  it("cuts to NAME_MAX code points", () => {
    expect(Array.from(enteredName("Я".repeat(40), "x"))).toHaveLength(NAME_MAX);
  });
});

describe("loadName / saveName", () => {
  it("saves the cleaned name under dm.name and reads it back", () => {
    const store = memoryStore();
    saveName("  Искра  42 ", store);
    expect(store.data.get(NAME_KEY)).toBe("Искра 42");
    expect(NAME_KEY).toBe("dm.name");
    expect(loadName(store)).toBe("Искра 42");
  });

  it("does not save an empty name", () => {
    const store = memoryStore();
    saveName("Валун", store);
    saveName("   ", store);
    expect(loadName(store)).toBe("Валун");
  });

  it("survives a missing or broken storage", () => {
    expect(loadName(null)).toBeNull();
    expect(() => saveName("Искра", null)).not.toThrow();
    const broken = memoryStore(true);
    expect(loadName(broken)).toBeNull();
    expect(() => saveName("Искра", broken)).not.toThrow();
  });
});

describe("lobby texts", () => {
  it("invites under the game title: the host gathers friends, the guest was called", () => {
    expect(taglineText(true)).toBe("Дуэль магов с друзьями");
    expect(taglineText(false)).toBe("Тебя зовут на дуэль магов");
  });

  it("lists who is in the room", () => {
    expect(rosterText(["Искра 42", "Валун 17"])).toBe("В комнате: Искра 42, Валун 17");
    expect(rosterText([])).toBe("В комнате пока никого");
  });

  it("explains every way joining can fail", () => {
    expect(joinErrorText("noHost", "ABCD")).toBe("Комната ABCD не найдена: хост закрыл вкладку или код неверный");
    expect(joinErrorText("noChannel", "ABCD")).toBe("Не удалось соединиться с хостом напрямую. Возможно, нужен TURN-сервер — скажи разработчику");
    expect(joinErrorText("signalling", "ABCD")).toBe("Сервер подключения PeerJS не отвечает, попробуй ещё раз");
    expect(joinErrorText("full", "ABCD")).toBe("Комната полна (6 из 6)");
    expect(joinErrorText("version", "ABCD")).toBe("У вас разные версии игры — обновите страницу оба");
  });

  it("shows the joining steps", () => {
    expect(joinStatusText("connecting")).toBe("Подключаюсь…");
    expect(joinStatusText("joining")).toBe("Вхожу…");
  });
});
