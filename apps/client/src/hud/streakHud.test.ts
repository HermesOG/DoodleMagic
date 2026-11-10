import { describe, expect, it } from "vitest";
import { LOOT_LOOK, lootAnim } from "./format";
import {
  FINAL_WAIT_S, LAST_MINUTE, STAMP, STREAK_MARK_FROM, announcement, finalDue, multiText, showFinal, showStreak, showing, stampAnim, streakMark,
  streakStep,
} from "./streakHud";

describe("kill streak announcements (phase 9, Р5)", () => {
  it("picks the text by multi and streak: ×2 / ×3 / ×4+ big with a stamp, streak steps 3 / 5 / 7 / 10 on the line below", () => {
    expect([multiText(1), multiText(2), multiText(3), multiText(4), multiText(6)]).toEqual([null, "Двойное!", "Тройное!", "Разгром!", "Разгром!"]);
    expect([2, 3, 4, 5, 6, 7, 9, 10, 11].map(streakStep)).toEqual([null, "В ударе!", null, "Неудержимый!", null, "Стихийное бедствие!", null, "Легенда монастыря!", null]);
    // мульти — крупно с печатью «×N», кегль 48 / 56 / 64; серия на ступени — строкой ниже
    expect(announcement(2, 2)).toEqual({ big: "Двойное!", px: 48, stamp: "×2", line: null });
    expect(announcement(3, 3)).toEqual({ big: "Тройное!", px: 56, stamp: "×3", line: "В ударе!" });
    expect(announcement(5, 5)).toEqual({ big: "Разгром!", px: 64, stamp: "×5", line: "Неудержимый!" });
    // одна серия — крупно без печати; ни мульти, ни ступени — ничего
    expect(announcement(1, 7)).toEqual({ big: "Стихийное бедствие!", px: 48, stamp: null, line: null });
    expect([announcement(1, 1), announcement(1, 4)]).toEqual([null, null]);
  });

  it("replaces the shown announcement at once, without a queue; «Последняя минута!» only when the line is free", () => {
    const first = showStreak(announcement(2, 2)!, 10);
    const second = showStreak(announcement(3, 3)!, 10.4);
    // новое сменяет старое сразу: строка — от нового момента, с новым текстом
    expect([second.at, second.a.big, showing(second, 10.4)]).toEqual([10.4, "Тройное!", true]);
    // 1,4 с на объявление: 1,1 держится, 0,3 гаснет
    expect([showing(first, 11.39), showing(first, 11.41), STAMP.holdS + STAMP.fadeS]).toEqual([true, false, expect.closeTo(1.4, 9)]);
    // идёт серия — «Последняя минута!» крупно не показываем; строка свободна — 44 px, без печати, 1,5 с
    expect(showFinal(first, 10.5)).toBeNull();
    const fin = showFinal(first, 11.5);
    expect(fin).toEqual({ kind: "final", a: LAST_MINUTE, at: 11.5 });
    expect([LAST_MINUTE.px, LAST_MINUTE.stamp, showing(fin, 12.99), showing(fin, 13.01)]).toEqual([44, null, true, false]);
    // серия перебивает и «Последнюю минуту»
    expect(showStreak(announcement(2, 2)!, 12).kind).toBe("streak");
    // строка была занята: «Последняя минута!» ждёт, пока освободится (серия с 10 гаснет к 11,4), но не дольше 2 с
    expect(FINAL_WAIT_S).toBe(2);
    expect([finalDue(first, 10.5, 11), finalDue(first, 10.5, 11.41)]).toEqual([false, true]);
    const busy = showStreak(announcement(2, 2)!, 12.2);
    expect([finalDue(busy, 10.5, 12.4), finalDue(busy, 10.5, 12.5)]).toEqual([false, true]);
  });

  it("stamps in: scale 1.8 → 0.94 → 1 in 140 ms, tilt −6° → −2°, the stroke draws in 200 ms after 80 ms, fades out over 0.3 s", () => {
    const s = showStreak(announcement(2, 2)!, 0);
    const at = (t: number) => stampAnim(s, t)!;
    expect([at(0).scale, at(0).rotDeg, at(0).stroke, at(0).alpha]).toEqual([1.8, -6, 0, 1]);
    expect(at(STAMP.settleS).scale).toBeCloseTo(0.94);
    expect([at(0.14).scale, at(0.14).rotDeg, at(0.5).scale]).toEqual([1, -2, 1]);
    expect([at(0.08).stroke, at(0.18).stroke, at(0.28).stroke]).toEqual([0, 0.5, 1].map((v) => expect.closeTo(v, 6)));
    expect([at(1.1).alpha, at(1.25).alpha]).toEqual([1, expect.closeTo(0.5, 6)]);
    expect([stampAnim(s, 1.41), stampAnim(s, -0.01)]).toEqual([null, null]);
    // без анимаций по настройке ОС — сразу на месте, только гаснет
    expect(stampAnim(s, 0, true)).toEqual({ scale: 1, rotDeg: -2, alpha: 1, stroke: 1 });
  });

  it("marks a mage over the name from a streak of 3", () => {
    expect(STREAK_MARK_FROM).toBe(3);
    expect([0, 2, 3, 8].map(streakMark)).toEqual([null, null, "3", "8"]);
  });

  it("grows the loot on the HP bar in 0.25 s and keeps «+30» for 0.6 s (L14)", () => {
    expect([LOOT_LOOK.sweepS, LOOT_LOOK.s]).toEqual([0.25, 0.6]);
    expect(lootAnim(0)).toMatchObject({ sweep: 0, alpha: 1, plusAlpha: 1, plusScale: 1.3 });
    expect(lootAnim(0.25)?.sweep).toBe(1);
    expect(lootAnim(0.5)!.alpha).toBeCloseTo(0.5);
    expect([lootAnim(0.6), lootAnim(-0.1)]).toEqual([null, null]);
  });
});
