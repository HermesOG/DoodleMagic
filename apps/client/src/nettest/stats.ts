/** Критерии из GDD, раздел 10: «9 из 10 играют 10 минут без зависаний, пинг p95 ≤ 120 мс». */
export const CRITERIA = {
  maxP95Ms: 120,
  stallGapMs: 1000,
  maxStalls: 0,
  maxLossPct: 2,
  maxDisconnects: 0,
  maxHiddenS: 5,
  /** Тест короче этого не идёт в итог «9 из 10» (10 минут минус запас на старт и разброс таймеров). */
  minDurationS: 570,
  passShare: 0.9,
} as const;

export type Route = "direct" | "relay" | "?";

export interface RttSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
  jitter: number;
}

/** Сырые данные одного прогона участника. Время — performance.now() в мс. */
export interface LinkTestData {
  route: Route;
  rtts: number[];
  arrivals: number[];
  /** Момент окончания прогона: хвост без сообщений от хоста тоже считается зависанием. */
  endedAt: number;
  sent: number;
  received: number;
  disconnects: number;
  hiddenMs: number;
  durationS: number;
}

export interface ResultMeta {
  name: string;
  room: string;
  host: string;
  ua: string;
  conn: string;
  tz: string;
}

export interface NettestResult extends ResultMeta {
  v: 2;
  route: Route;
  durationS: number;
  rtt: RttSummary;
  sent: number;
  received: number;
  lossPct: number;
  stalls: number;
  worstGapMs: number;
  disconnects: number;
  hiddenS: number;
}

export interface Verdict {
  /** Качество связи в порядке. Короткий тест сам по себе не делает его false. */
  ok: boolean;
  /** Тест длился достаточно долго, чтобы идти в итог «9 из 10». */
  full: boolean;
  reasons: string[];
}

const ROUTE_LABEL: Record<Route, string> = {
  direct: "напрямую",
  relay: "через ретранслятор (TURN)",
  "?": "не определено",
};
const ROUTE_SHORT: Record<Route, string> = { direct: "напрямую", relay: "TURN", "?": "?" };

/** Миллисекунды для людей. После JSON NaN превращается в null — тоже показываем прочерк. */
export function fmtMs(x: number | null | undefined): string {
  return typeof x === "number" && Number.isFinite(x) ? `${Math.round(x)} мс` : "—";
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export function summarizeRtt(samples: readonly number[]): RttSummary {
  if (samples.length === 0) {
    return { count: 0, p50: Number.NaN, p95: Number.NaN, max: Number.NaN, jitter: Number.NaN };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  let diff = 0;
  for (let i = 1; i < samples.length; i++) diff += Math.abs(samples[i]! - samples[i - 1]!);
  return {
    count: samples.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
    jitter: samples.length > 1 ? diff / (samples.length - 1) : 0,
  };
}

export function countStalls(arrivals: readonly number[], gapMs: number): { stalls: number; worstGapMs: number } {
  let stalls = 0;
  let worst = 0;
  for (let i = 1; i < arrivals.length; i++) {
    const gap = arrivals[i]! - arrivals[i - 1]!;
    if (gap > worst) worst = gap;
    if (gap > gapMs) stalls++;
  }
  return { stalls, worstGapMs: worst };
}

export function lossPct(sent: number, received: number): number {
  if (sent <= 0) return 0;
  return Math.max(0, ((sent - received) / sent) * 100);
}

export function buildResult(d: LinkTestData, meta: ResultMeta): NettestResult {
  // Если хост молчал до самого конца, последний промежуток тоже считается; без единого
  // сообщения его не с чем мерить — это уже ловит «хост не ответил ни разу».
  const times = d.arrivals.length > 0 ? [...d.arrivals, d.endedAt] : d.arrivals;
  const { stalls, worstGapMs } = countStalls(times, CRITERIA.stallGapMs);
  return {
    v: 2,
    ...meta,
    route: d.route,
    durationS: Math.round(d.durationS),
    rtt: summarizeRtt(d.rtts),
    sent: d.sent,
    received: d.received,
    lossPct: lossPct(d.sent, d.received),
    stalls,
    worstGapMs: Math.round(worstGapMs),
    disconnects: d.disconnects,
    hiddenS: Math.round(d.hiddenMs / 1000),
  };
}

export function judge(r: NettestResult): Verdict {
  const reasons: string[] = [];
  if (r.rtt.count === 0) reasons.push("хост не ответил ни разу");
  // Отчёт пришёл по сети: после JSON NaN становится null, а `null <= 120` в JS — true.
  // Поэтому проверяем конечность явно: непонятное значение считается провалом.
  else if (!(Number.isFinite(r.rtt.p95) && r.rtt.p95 <= CRITERIA.maxP95Ms)) {
    reasons.push(
      Number.isFinite(r.rtt.p95)
        ? `пинг p95 ${Math.round(r.rtt.p95)} мс — выше ${CRITERIA.maxP95Ms}`
        : "пинг p95 неизвестен",
    );
  }
  if (r.stalls > CRITERIA.maxStalls) {
    reasons.push(`зависаний дольше ${CRITERIA.stallGapMs / 1000} с: ${r.stalls} (худшее ${r.worstGapMs} мс)`);
  }
  if (r.disconnects > CRITERIA.maxDisconnects) reasons.push(`обрывов связи: ${r.disconnects}`);
  if (r.lossPct > CRITERIA.maxLossPct) reasons.push(`потеряно ${r.lossPct.toFixed(1)}% пакетов`);
  if (r.hiddenS > CRITERIA.maxHiddenS) {
    reasons.push(`вкладка была свёрнута ${r.hiddenS} с — результат неточный, лучше повторить`);
  }
  return { ok: reasons.length === 0, full: r.durationS >= CRITERIA.minDurationS, reasons };
}

export function formatReport(r: NettestResult, v: Verdict): string {
  const lines = [
    `DoodleMagic · тест связи · ${v.ok ? (v.full ? "OK" : "OK (короткий тест)") : "ПРОБЛЕМЫ"}`,
    `Имя: ${r.name || "—"} · комната ${r.room} · ${r.durationS} с`,
    `Связь с хостом ${r.host || "—"}: ${ROUTE_LABEL[r.route]}`,
    `Пинг: p50 ${fmtMs(r.rtt.p50)}, p95 ${fmtMs(r.rtt.p95)}, макс ${fmtMs(r.rtt.max)}, джиттер ${fmtMs(r.rtt.jitter)}`,
    `Потери ${r.lossPct.toFixed(1)}% · зависаний ${r.stalls} · обрывов ${r.disconnects}`,
  ];
  for (const reason of v.reasons) lines.push(`• ${reason}`);
  if (!v.full) lines.push("Короткий тест: в итог «9 из 10» не идёт");
  return lines.join("\n");
}

const isNum = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x);

/** Отчёт приходит хосту от участника по сети — проверяем форму перед тем, как показывать. */
export function isNettestResult(x: unknown): x is NettestResult {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  const rtt = r.rtt as Record<string, unknown> | null | undefined;
  return (
    r.v === 2 &&
    typeof r.name === "string" &&
    typeof r.host === "string" &&
    typeof r.route === "string" &&
    Object.hasOwn(ROUTE_LABEL, r.route) &&
    typeof rtt === "object" &&
    rtt !== null &&
    isNum(rtt.count) &&
    [r.durationS, r.sent, r.received, r.lossPct, r.stalls, r.worstGapMs, r.disconnects, r.hiddenS].every(isNum)
  );
}

/**
 * Сводка для хоста: строка на участника и итог по критерию «9 из 10».
 * В зачёт идут полные тесты и любые тесты с проблемами: короткий, но неудачный прогон — это провал,
 * а не повод вычеркнуть участника из знаменателя. Исключаются только короткие здоровые прогоны.
 */
export function formatSummary(results: readonly NettestResult[]): string {
  if (results.length === 0) return "Пока нет результатов.";
  const lines: string[] = [];
  let passed = 0;
  let counted = 0;
  let relayed = 0;
  for (const r of results) {
    const v = judge(r);
    if (v.full || !v.ok) {
      counted++;
      if (v.ok && v.full) passed++;
    }
    if (r.route === "relay") relayed++;
    lines.push(
      `${v.ok ? "OK  " : "FAIL"} ${r.name || "—"}${v.full ? "" : " · короткий"} · ${ROUTE_SHORT[r.route]} · p50 ${fmtMs(r.rtt.p50)} · p95 ${fmtMs(r.rtt.p95)} · зав ${r.stalls} · обр ${r.disconnects} · пот ${r.lossPct.toFixed(1)}% · ${r.durationS} с`,
    );
    for (const reason of v.reasons) lines.push(`     • ${reason}`);
  }
  const excluded = results.length - counted;
  const pct = counted === 0 ? 0 : Math.round((passed / counted) * 100);
  lines.push("", `Прошли ${passed} из ${counted} в зачёте (${pct} %). Порог: ${Math.round(CRITERIA.passShare * 100)} %.`);
  if (excluded > 0) lines.push(`Коротких тестов (не в зачёт): ${excluded}.`);
  lines.push(`Через ретранслятор (TURN): ${relayed} из ${results.length}.`);
  return lines.join("\n");
}
