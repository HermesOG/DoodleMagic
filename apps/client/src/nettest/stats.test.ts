import { describe, expect, it } from "vitest";
import {
  buildResult,
  countStalls,
  fmtMs,
  formatReport,
  formatSummary,
  isNettestResult,
  judge,
  lossPct,
  percentile,
  summarizeRtt,
  type LinkTestData,
  type ResultMeta,
} from "./stats";

const meta: ResultMeta = { name: "Аня", room: "FRIENDS", host: "Хост", ua: "test", conn: "4g", tz: "Asia/Tashkent" };

/** 10 минут здоровой связи: пинг 60 мс, сообщение от хоста каждые 50 мс. */
function data(over: Partial<LinkTestData> = {}): LinkTestData {
  return {
    route: "direct",
    rtts: Array.from({ length: 1000 }, () => 60),
    arrivals: Array.from({ length: 12000 }, (_, i) => i * 50),
    sent: 1000,
    received: 1000,
    disconnects: 0,
    hiddenMs: 0,
    durationS: 600,
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
    expect(summarizeRtt([30, 10, 20])).toEqual({ count: 3, p50: 20, p95: 30, max: 30, jitter: 15 });
  });

  it("handles no samples", () => {
    const s = summarizeRtt([]);
    expect(s.count).toBe(0);
    expect(s.p95).toBeNaN();
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

describe("judge", () => {
  it("passes a healthy run", () => {
    expect(judge(buildResult(data(), meta))).toEqual({ ok: true, reasons: [] });
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
    const v = judge(buildResult(data({ arrivals: [0, 50, 100, 2100, 2150] }), meta));
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("зависаний дольше 1 с: 1");
  });

  it("fails on disconnects, loss and a hidden tab", () => {
    const v = judge(buildResult(data({ disconnects: 1, sent: 100, received: 90, hiddenMs: 30_000 }), meta));
    expect(v.reasons).toHaveLength(3);
  });

  it("fails when the host never answered", () => {
    expect(judge(buildResult(data({ rtts: [] }), meta)).reasons).toContain("хост не ответил ни разу");
  });
});

describe("formatReport", () => {
  it("includes the verdict, ping and reasons", () => {
    const r = buildResult(data({ disconnects: 2 }), meta);
    const text = formatReport(r, judge(r));
    expect(text).toContain("ПРОБЛЕМЫ");
    expect(text).toContain("p50 60 мс");
    expect(text).toContain("обрывов связи: 2");
  });

  it("names the host and the route", () => {
    const r = buildResult(data({ route: "relay" }), meta);
    expect(formatReport(r, judge(r))).toContain("Связь с хостом Хост: через ретранслятор (TURN)");
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
    ["missing rtt", { ...buildResult(data(), meta), rtt: undefined }],
    ["string stalls", { ...buildResult(data(), meta), stalls: "0" }],
    ["unknown route", { ...buildResult(data(), meta), route: "satellite" }],
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
    expect(text).toContain("OK   Аня");
    expect(text).toContain("FAIL Боря · TURN");
    expect(text).toContain("• обрывов связи: 1");
    expect(text).toContain("Прошли 1 из 2 (50 %). Порог: 90 %.");
    expect(text).toContain("Через ретранслятор (TURN): 1 из 2.");
  });

  it("shows missing ping values after a JSON round trip as dashes", () => {
    const r = JSON.parse(JSON.stringify(buildResult(data({ rtts: [] }), meta)));
    expect(formatSummary([r])).toContain("p50 —");
  });
});
