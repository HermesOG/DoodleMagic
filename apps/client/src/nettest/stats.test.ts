import { describe, expect, it } from "vitest";
import {
  buildResult,
  countStalls,
  fmtMs,
  formatReport,
  formatSummary,
  hostErrorText,
  isNettestResult,
  judge,
  lossPct,
  parseHostSave,
  percentile,
  summarizeRtt,
  type LinkTestData,
  type ResultMeta,
} from "./stats";

const meta: ResultMeta = {
  name: "Аня",
  room: "FRIENDS",
  host: "Хост",
  ua: "test",
  conn: "4g",
  tz: "Asia/Tashkent",
  device: "ПК",
  net: "wifi",
  relayOnly: false,
};

/** 10 минут здоровой связи: пинг 60 мс, сообщение от хоста каждые 50 мс. */
function data(over: Partial<LinkTestData> = {}): LinkTestData {
  return {
    route: "direct",
    rtts: Array.from({ length: 1000 }, () => 60),
    arrivals: Array.from({ length: 12000 }, (_, i) => i * 50),
    endedAt: 600_000,
    sent: 1000,
    received: 1000,
    disconnects: 0,
    hiddenMs: 0,
    durationS: 600,
    openedAt: 0,
    snaps: 12000,
    ...over,
  };
}

describe("fmtMs", () => {
  it("rounds finite numbers and hides missing ones", () => {
    expect(fmtMs(59.6)).toBe("60 мс");
    expect(fmtMs(Number.NaN)).toBe("—");
    expect(fmtMs(null)).toBe("—");
    expect(fmtMs(undefined)).toBe("—");
  });
});

describe("percentile", () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it("uses nearest rank", () => {
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(100);
    expect(percentile(sorted, 0)).toBe(10);
  });

  it("returns NaN for no samples", () => {
    expect(percentile([], 50)).toBeNaN();
  });
});

describe("summarizeRtt", () => {
  it("summarizes samples kept in arrival order", () => {
    expect(summarizeRtt([30, 10, 20])).toEqual({ count: 3, p50: 20, p95: 30, p99: 30, max: 30, jitter: 15 });
  });

  it("reports the p99 tail separately from p95", () => {
    const s = summarizeRtt(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s.p95).toBe(95);
    expect(s.p99).toBe(99);
  });

  it("handles no samples", () => {
    const s = summarizeRtt([]);
    expect(s.count).toBe(0);
    expect(s.p95).toBeNaN();
    expect(s.p99).toBeNaN();
  });
});

describe("countStalls", () => {
  it("counts gaps longer than the threshold", () => {
    expect(countStalls([0, 50, 100, 1300, 1350], 1000)).toEqual({ stalls: 1, worstGapMs: 1200 });
  });
});

describe("lossPct", () => {
  it("is the share of unanswered pings", () => {
    expect(lossPct(200, 196)).toBe(2);
  });

  it("is zero when nothing was sent", () => {
    expect(lossPct(0, 0)).toBe(0);
  });
});

describe("buildResult", () => {
  it("is a v3 result with device, network, open flag and snapshot rate", () => {
    const r = buildResult(data(), meta);
    expect(r).toMatchObject({ v: 3, device: "ПК", net: "wifi", relayOnly: false, opened: true, snapRate: 20 });
  });

  it("rounds the snapshot rate to tenths", () => {
    expect(buildResult(data({ snaps: 10_799 }), meta).snapRate).toBe(18);
  });

  it("measures the snapshot rate from the first open, so connection setup does not count", () => {
    // 3 s до открытия канала, дальше 20 снапшотов в секунду до конца 20-секундного прогона
    const arrivals = Array.from({ length: 340 }, (_, i) => 3000 + i * 50);
    const r = buildResult(
      data({ durationS: 20, openedAt: 3000, endedAt: 20_000, snaps: 340, arrivals, rtts: [60, 60, 60] }),
      meta,
    );
    expect(r.snapRate).toBe(20);
    expect(judge(r).ok).toBe(true);
  });

  it("has a snapshot rate of 0 when the channel never opened or had no time", () => {
    expect(buildResult(data({ openedAt: null, snaps: 100 }), meta).snapRate).toBe(0);
    expect(buildResult(data({ openedAt: 600_000, snaps: 100 }), meta).snapRate).toBe(0);
  });
});

describe("judge", () => {
  it("passes a healthy run", () => {
    expect(judge(buildResult(data(), meta))).toEqual({ ok: true, full: true, reasons: [] });
  });

  it("does not fail a run just because it went through TURN", () => {
    expect(judge(buildResult(data({ route: "relay" }), meta)).ok).toBe(true);
  });

  it("fails on a high p95", () => {
    const rtts = Array.from({ length: 100 }, (_, i) => (i < 90 ? 60 : 200));
    const v = judge(buildResult(data({ rtts }), meta));
    expect(v.ok).toBe(false);
    expect(v.reasons[0]).toContain("p95 200");
  });

  it("fails on a stall", () => {
    const v = judge(buildResult(data({ arrivals: [0, 50, 100, 2100, 2150], endedAt: 2200 }), meta));
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("зависаний дольше 1 с: 1");
  });

  it("counts a freeze that lasts until the end of the run as a stall", () => {
    const arrivals = Array.from({ length: 6001 }, (_, i) => i * 50); // last message at 300000 ms
    const r = buildResult(data({ arrivals, endedAt: 600_000 }), meta);
    expect(r.stalls).toBe(1);
    expect(r.worstGapMs).toBe(300_000);
    expect(judge(r).ok).toBe(false);
  });

  it("does not add a trailing stall when the host never sent anything", () => {
    const r = buildResult(data({ arrivals: [], endedAt: 600_000 }), meta);
    expect(r.stalls).toBe(0);
  });

  it("passes p95 exactly at the limit and fails just above it", () => {
    const flat = (ms: number) => Array.from({ length: 100 }, () => ms);
    expect(judge(buildResult(data({ rtts: flat(120) }), meta)).ok).toBe(true);
    expect(judge(buildResult(data({ rtts: flat(121) }), meta)).ok).toBe(false);
  });

  it("fails closed when a remote report has a null p95 but some pings", () => {
    const r = buildResult(data(), meta);
    const wire = JSON.parse(JSON.stringify({ ...r, rtt: { ...r.rtt, p95: Number.NaN } }));
    expect(wire.rtt.p95).toBeNull();
    expect(isNettestResult(wire)).toBe(true);
    const v = judge(wire);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("пинг p95 неизвестен");
  });

  it("marks a short run as not full without failing it", () => {
    const v = judge(buildResult(data({ durationS: 180 }), meta));
    expect(v.full).toBe(false);
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("treats 570 s as the shortest full run", () => {
    expect(judge(buildResult(data({ durationS: 570 }), meta)).full).toBe(true);
    expect(judge(buildResult(data({ durationS: 569 }), meta)).full).toBe(false);
  });

  it("fails on disconnects, loss and a hidden tab", () => {
    const v = judge(buildResult(data({ disconnects: 1, sent: 100, received: 90, hiddenMs: 30_000 }), meta));
    expect(v.reasons).toHaveLength(3);
    expect(v.reasons).toContain("пинги без ответа: 10.0%");
  });

  it("fails when the host never answered on an open channel", () => {
    expect(judge(buildResult(data({ rtts: [] }), meta)).reasons).toEqual(["хост не ответил ни разу"]);
  });

  it("says the P2P channel never opened when no connection opened", () => {
    const r = buildResult(data({ rtts: [], arrivals: [], snaps: 0, openedAt: null }), meta);
    expect(judge(r)).toEqual({
      ok: false,
      full: true,
      reasons: ["канал с хостом не открылся (P2P не прошёл даже через TURN)"],
    });
  });

  it("fails when host snapshots came too rarely", () => {
    const v = judge(buildResult(data({ snaps: 6000 }), meta));
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual([
      "снапшоты от хоста приходили 10.0/с вместо 20 — хост тормозил или его вкладка была скрыта",
    ]);
  });

  it("accepts a snapshot rate of exactly 18 per second and fails just below", () => {
    expect(judge(buildResult(data({ snaps: 10_800 }), meta)).ok).toBe(true);
    expect(judge(buildResult(data({ snaps: 10_740 }), meta)).ok).toBe(false);
  });

  it("fails closed when a remote report has a null snapshot rate", () => {
    const wire = JSON.parse(JSON.stringify({ ...buildResult(data(), meta), snapRate: Number.NaN }));
    expect(judge(wire).reasons.join(" ")).toContain("снапшоты от хоста приходили ?/с");
  });
});

describe("formatReport", () => {
  it("includes the verdict, ping and reasons", () => {
    const r = buildResult(data({ disconnects: 2 }), meta);
    const text = formatReport(r, judge(r));
    expect(text).toContain("ПРОБЛЕМЫ");
    expect(text).toContain("p50 60 мс");
    expect(text).toContain("p99 60 мс");
    expect(text).toContain("обрывов связи: 2");
  });

  it("names unanswered pings honestly and shows the snapshot rate, device and network", () => {
    const r = buildResult(data(), meta);
    const text = formatReport(r, judge(r));
    expect(text).toContain("Имя: Аня · ПК · сеть wifi · комната FRIENDS · 600 с");
    expect(text).toContain("Пинги без ответа 0.0% · зависаний 0 · обрывов 0 · снапшоты 20.0/с");
    expect(text).not.toContain("Потери");
    expect(text).not.toContain("Режим:");
  });

  it("marks a forced-TURN check", () => {
    const r = buildResult(data({ route: "relay" }), { ...meta, relayOnly: true });
    expect(formatReport(r, judge(r))).toContain("Режим: только через ретранслятор (TURN)");
  });

  it("names the host and the route", () => {
    const r = buildResult(data({ route: "relay" }), meta);
    expect(formatReport(r, judge(r))).toContain("Связь с хостом Хост: через ретранслятор (TURN)");
  });

  it("says that a short test does not count toward 9 of 10", () => {
    const short = buildResult(data({ durationS: 180 }), meta);
    expect(formatReport(short, judge(short))).toContain("Короткий тест: в итог «9 из 10» не идёт");
    const full = buildResult(data(), meta);
    expect(formatReport(full, judge(full))).not.toContain("Короткий тест");
  });

  it("has no «не идёт» note for a failed short run, because it counts as a failure", () => {
    const shortBad = buildResult(data({ durationS: 180, disconnects: 1 }), meta);
    const text = formatReport(shortBad, judge(shortBad));
    expect(text).not.toContain("не идёт");
    expect(text).toContain("обрывов связи: 1");
  });

  it("marks a healthy short run in the headline", () => {
    const short = buildResult(data({ durationS: 180 }), meta);
    const first = formatReport(short, judge(short)).split("\n")[0];
    expect(first).toContain("OK (короткий тест)");
    const full = buildResult(data(), meta);
    const fullFirst = formatReport(full, judge(full)).split("\n")[0];
    expect(fullFirst).toMatch(/· OK$/);
  });

  it("keeps ПРОБЛЕМЫ in the headline of a failed short run", () => {
    const shortBad = buildResult(data({ durationS: 180, disconnects: 1 }), meta);
    const first = formatReport(shortBad, judge(shortBad)).split("\n")[0];
    expect(first).toContain("ПРОБЛЕМЫ");
    expect(first).not.toContain("OK");
  });
});

describe("isNettestResult", () => {
  it("accepts a built result, also after a JSON round trip", () => {
    const r = buildResult(data({ rtts: [] }), meta);
    expect(isNettestResult(r)).toBe(true);
    expect(isNettestResult(JSON.parse(JSON.stringify(r)))).toBe(true);
  });

  it.each([
    ["null", null],
    ["old version", { ...buildResult(data(), meta), v: 1 }],
    ["v2 report", { ...buildResult(data(), meta), v: 2 }],
    ["missing rtt", { ...buildResult(data(), meta), rtt: undefined }],
    ["string stalls", { ...buildResult(data(), meta), stalls: "0" }],
    ["unknown route", { ...buildResult(data(), meta), route: "satellite" }],
    ["missing device", { ...buildResult(data(), meta), device: undefined }],
    ["numeric net", { ...buildResult(data(), meta), net: 4 }],
    ["string opened", { ...buildResult(data(), meta), opened: "true" }],
    ["string relayOnly", { ...buildResult(data(), meta), relayOnly: "false" }],
    ["missing snapRate", { ...buildResult(data(), meta), snapRate: undefined }],
  ])("rejects %s", (_label, value) => {
    expect(isNettestResult(value)).toBe(false);
  });
});

describe("formatSummary", () => {
  it("says when there is nothing yet", () => {
    expect(formatSummary([])).toBe("Пока нет результатов.");
  });

  it("lists every participant and the totals", () => {
    const good = buildResult(data(), meta);
    const bad = buildResult(data({ route: "relay", disconnects: 1 }), { ...meta, name: "Боря" });
    const text = formatSummary([good, bad]);
    expect(text).toContain("OK   Аня · ПК · сеть wifi · напрямую");
    expect(text).toContain("FAIL Боря · ПК · сеть wifi · TURN");
    expect(text).toContain("• обрывов связи: 1");
    expect(text).toContain("Прошли 1 из 2 в зачёте (50 %). Порог: 90 %.");
    expect(text).toContain("Через ретранслятор (TURN): 1 из 2.");
    expect(text).not.toContain("Коротких тестов");
  });

  it("keeps healthy short runs out of the 9-of-10 count and tags them", () => {
    const good = buildResult(data(), meta);
    const bad = buildResult(data({ disconnects: 1 }), { ...meta, name: "Боря" });
    const short = buildResult(data({ durationS: 180, route: "relay" }), { ...meta, name: "Вася" });
    const text = formatSummary([good, bad, short]);
    expect(text).toContain("Прошли 1 из 2 в зачёте (50 %). Порог: 90 %.");
    expect(text).toContain("Коротких тестов (не в зачёт): 1.");
    expect(text).toContain("OK   Вася · ПК · сеть wifi · короткий · TURN");
    expect(text).not.toContain("OK   Аня · ПК · сеть wifi · короткий");
    expect(text).toContain("Через ретранслятор (TURN): 1 из 3.");
  });

  it("counts a failed short run as a failure and not as excluded", () => {
    const good = buildResult(data(), meta);
    const shortBad = buildResult(data({ durationS: 180, disconnects: 1 }), { ...meta, name: "Вася" });
    const text = formatSummary([good, shortBad]);
    expect(text).toContain("Прошли 1 из 2 в зачёте (50 %). Порог: 90 %.");
    expect(text).not.toContain("Коротких тестов");
    expect(text).toContain("FAIL Вася · ПК · сеть wifi · короткий");
    expect(text).toContain("• обрывов связи: 1");
  });

  it("cannot reach 100 % while a short run reported problems", () => {
    const shortBad = buildResult(data({ durationS: 180, disconnects: 1 }), meta);
    const text = formatSummary([buildResult(data(), meta), shortBad]);
    expect(text).not.toContain("(100 %)");
  });

  it("reports 0 % when no run counts", () => {
    const short = buildResult(data({ durationS: 60 }), meta);
    const text = formatSummary([short]);
    expect(text).toContain("Прошли 0 из 0 в зачёте (0 %). Порог: 90 %.");
    expect(text).toContain("Коротких тестов (не в зачёт): 1.");
  });

  it("shows missing ping values after a JSON round trip as dashes", () => {
    const r = JSON.parse(JSON.stringify(buildResult(data({ rtts: [] }), meta)));
    expect(formatSummary([r])).toContain("p50 —");
  });

  it("shows the device, network, p99 and unanswered pings in each row", () => {
    const phone = buildResult(data(), { ...meta, device: "телефон", net: "cellular" });
    const text = formatSummary([phone]);
    expect(text).toContain(
      "OK   Аня · телефон · сеть cellular · напрямую · p50 60 мс · p95 60 мс · p99 60 мс · зав 0 · обр 0 · без ответа 0.0% · 600 с",
    );
    expect(text).not.toContain("пот ");
  });

  it("counts participants whose channel never opened as failures", () => {
    const good = buildResult(data(), meta);
    const text = formatSummary([good], { failedOpens: [{ name: "Вася", device: "телефон", relayOnly: false }] });
    expect(text).toContain("FAIL Вася · телефон · канал не открылся");
    expect(text).toContain("Прошли 1 из 2 в зачёте (50 %). Порог: 90 %.");
    expect(text).toContain("Через ретранслятор (TURN): 0 из 1.");
  });

  it("lists failed opens even without any report", () => {
    const text = formatSummary([], { failedOpens: [{ name: "Вася", device: "ПК", relayOnly: false }] });
    expect(text).toContain("FAIL Вася · ПК · канал не открылся");
    expect(text).toContain("Прошли 0 из 1 в зачёте (0 %).");
    expect(text.split("\n").at(-1)).toBe("Критерий (≥ 90 % в зачёте): не выполнен ✗");
  });

  it("warns when the host tab was hidden", () => {
    const r = buildResult(data(), meta);
    expect(formatSummary([r], { hostHiddenS: 42 })).toContain(
      "Вкладка хоста была скрыта 42 с — результаты за это время ненадёжны",
    );
    expect(formatSummary([r], { hostHiddenS: 0 })).not.toContain("Вкладка хоста");
    expect(formatSummary([], { hostHiddenS: 7 })).toContain("Вкладка хоста была скрыта 7 с");
  });

  it("ends with an explicit verdict on the 90 % rule", () => {
    const good = (name: string) => buildResult(data(), { ...meta, name });
    const bad = (name: string) => buildResult(data({ disconnects: 1 }), { ...meta, name });
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const nine = formatSummary([...names.map(good), good("I"), bad("J")]);
    expect(nine).toContain("Прошли 9 из 10 в зачёте (90 %).");
    expect(nine.split("\n").at(-1)).toBe("Критерий (≥ 90 % в зачёте): выполнен ✓");
    const eight = formatSummary([...names.map(good), bad("I"), bad("J")], { hostHiddenS: 3 });
    expect(eight.split("\n").at(-1)).toBe("Критерий (≥ 90 % в зачёте): не выполнен ✗");
  });

  it("cannot judge the rule while nothing counts", () => {
    const short = buildResult(data({ durationS: 60 }), meta);
    expect(formatSummary([short]).split("\n").at(-1)).toBe("Критерий: пока не оценить — нет результатов в зачёте");
  });

  it("keeps forced-TURN checks out of the 9-of-10 count and the natural TURN share", () => {
    const good = buildResult(data(), meta);
    const turnOk = buildResult(data({ route: "relay" }), { ...meta, name: "Боря", relayOnly: true });
    const turnBad = buildResult(data({ route: "relay", rtts: Array.from({ length: 100 }, () => 300) }), {
      ...meta,
      name: "Вася",
      relayOnly: true,
    });
    const text = formatSummary([good, turnOk, turnBad], {
      failedOpens: [{ name: "Гена", device: "ПК", relayOnly: true }],
    });
    expect(text).toContain("OK   Боря · ПК · сеть wifi · проверка TURN · TURN");
    expect(text).toContain("FAIL Вася · ПК · сеть wifi · проверка TURN · TURN");
    expect(text).toContain("FAIL Гена · ПК · проверка TURN · канал не открылся");
    expect(text).toContain("Прошли 1 из 1 в зачёте (100 %).");
    expect(text).toContain("Проверок только через TURN (не в зачёт): 3, прошли 1.");
    expect(text).toContain("Через ретранслятор (TURN): 0 из 1.");
    expect(text.split("\n").at(-1)).toBe("Критерий (≥ 90 % в зачёте): выполнен ✓");
  });
});

describe("hostErrorText", () => {
  it("explains a version mismatch: the host page is older than this one", () => {
    expect(hostErrorText("обновите страницу")).toBe("Хост на старой версии страницы — попроси его обновить страницу");
  });

  it("shows any other reason as is, trimmed and limited", () => {
    expect(hostErrorText("  комната закрыта ")).toBe("комната закрыта");
    expect(hostErrorText("x".repeat(500))).toHaveLength(200);
  });

  it("has a fallback for an empty reason", () => {
    expect(hostErrorText("  ")).toBe("Хост прервал тест");
  });
});

describe("parseHostSave", () => {
  const empty = { reports: [], failedOpens: [], hostHiddenS: 0 };

  it("is empty without saved data or with broken JSON", () => {
    expect(parseHostSave(null)).toEqual(empty);
    expect(parseHostSave("{")).toEqual(empty);
    expect(parseHostSave("[]")).toEqual(empty);
  });

  it("restores what the host page saved", () => {
    const saved = {
      reports: [buildResult(data(), meta)],
      failedOpens: [{ name: "Вася", device: "телефон", relayOnly: false }],
      hostHiddenS: 42,
    };
    expect(parseHostSave(JSON.stringify(saved))).toEqual(JSON.parse(JSON.stringify(saved)));
  });

  it("drops reports of another version and malformed entries", () => {
    const raw = JSON.stringify({
      reports: [{ ...buildResult(data(), meta), v: 2 }, "junk", buildResult(data(), { ...meta, name: "Боря" })],
      failedOpens: [null, "Вася", { name: " Гена ", device: "ПК" }],
      hostHiddenS: -5,
    });
    const s = parseHostSave(raw);
    expect(s.reports.map((r) => r.name)).toEqual(["Боря"]);
    expect(s.failedOpens).toEqual([{ name: "Гена", device: "ПК", relayOnly: false }]);
    expect(s.hostHiddenS).toBe(0);
  });
});
