import { OUTDATED_REASON, SNAPSHOT_HZ, parsePeerTag, type PeerTag } from "@doodlemagic/protocol";

/** Критерии из GDD, раздел 10: «9 из 10 играют 10 минут без зависаний, пинг p95 ≤ 120 мс». */
export const CRITERIA = {
  maxP95Ms: 120,
  stallGapMs: 1000,
  maxStalls: 0,
  /** Порог для пингов без ответа (поле lossPct). */
  maxLossPct: 2,
  maxDisconnects: 0,
  maxHiddenS: 5,
  /** Хост шлёт 20 снапшотов в секунду; заметно реже — хост тормозил или его вкладку свернули, и браузер придушил таймеры. */
  minSnapRate: 18,
  /**
   * Здоровый тест короче этого не идёт в итог «9 из 10» (10 минут минус запас на старт и разброс таймеров).
   * Короткий тест с проблемами идёт в итог как провал.
   */
  minDurationS: 570,
  passShare: 0.9,
} as const;

export type Route = "direct" | "relay" | "?";

export interface RttSummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
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
  /** Когда впервые открылся P2P-канал с хостом (performance.now); null — не открылся ни разу. */
  openedAt: number | null;
  /** Сколько снапшотов пришло от хоста за прогон. */
  snaps: number;
}

export interface ResultMeta {
  name: string;
  room: string;
  host: string;
  ua: string;
  conn: string;
  tz: string;
  /** «телефон» или «ПК»: один человек может пройти тест с двух устройств. */
  device: string;
  /** Тип сети из navigator.connection.type («wifi», «cellular») или «?», если браузер его не даёт. */
  net: string;
  /** Прогон шёл принудительно только через TURN (`/nettest?relay=1`). */
  relayOnly: boolean;
}

export interface NettestResult extends ResultMeta {
  v: 3;
  route: Route;
  durationS: number;
  rtt: RttSummary;
  sent: number;
  received: number;
  /**
   * Доля пингов без ответа. Канал PeerJS с reliable: false лишь неупорядоченный, SCTP всё равно досылает
   * потерянные пакеты, поэтому сюда попадают только пинги, застрявшие в оборвавшемся соединении.
   */
  lossPct: number;
  stalls: number;
  worstGapMs: number;
  disconnects: number;
  hiddenS: number;
  opened: boolean;
  /** Снапшотов от хоста в секунду с первого открытия канала до конца прогона. */
  snapRate: number;
}

export interface Verdict {
  /** Качество связи в порядке. Короткий тест сам по себе не делает его false. */
  ok: boolean;
  /**
   * Тест длился достаточно долго. Здоровый короткий прогон в итог «9 из 10» не идёт,
   * а неудачный короткий идёт как провал.
   */
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

const fmtRate = (x: number | null | undefined): string =>
  typeof x === "number" && Number.isFinite(x) ? x.toFixed(1) : "?";

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export function summarizeRtt(samples: readonly number[]): RttSummary {
  if (samples.length === 0) {
    return { count: 0, p50: Number.NaN, p95: Number.NaN, p99: Number.NaN, max: Number.NaN, jitter: Number.NaN };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  let diff = 0;
  for (let i = 1; i < samples.length; i++) diff += Math.abs(samples[i]! - samples[i - 1]!);
  return {
    count: samples.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
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
  // Частоту снапшотов считаем с открытия канала: подключение (ICE, TURN) снапшотов не несёт и в неё не входит.
  const openS = d.openedAt === null ? 0 : (d.endedAt - d.openedAt) / 1000;
  return {
    v: 3,
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
    opened: d.openedAt !== null,
    // округляем до десятых здесь, чтобы вердикт и текст отчёта видели одно и то же число
    snapRate: openS > 0 ? Math.round((d.snaps / openS) * 10) / 10 : 0,
  };
}

export function judge(r: NettestResult): Verdict {
  const reasons: string[] = [];
  if (r.rtt.count === 0) {
    reasons.push(r.opened ? "хост не ответил ни разу" : "канал с хостом не открылся (прямое P2P-соединение не прошло, а TURN пока не настроен)");
  } else {
    // Отчёт пришёл по сети: после JSON NaN становится null, а `null <= 120` в JS — true.
    // Поэтому проверяем конечность явно: непонятное значение считается провалом.
    if (!(Number.isFinite(r.rtt.p95) && r.rtt.p95 <= CRITERIA.maxP95Ms)) {
      reasons.push(
        Number.isFinite(r.rtt.p95)
          ? `пинг p95 ${Math.round(r.rtt.p95)} мс — выше ${CRITERIA.maxP95Ms}`
          : "пинг p95 неизвестен",
      );
    }
    // Свёрнутая вкладка хоста душит его таймеры: пинги он ещё отбивает, а снапшоты шлёт раз в секунду.
    if (!(Number.isFinite(r.snapRate) && r.snapRate >= CRITERIA.minSnapRate)) {
      reasons.push(
        `снапшоты от хоста приходили ${fmtRate(r.snapRate)}/с вместо ${SNAPSHOT_HZ} — хост тормозил или его вкладка была скрыта`,
      );
    }
  }
  if (r.stalls > CRITERIA.maxStalls) {
    reasons.push(`зависаний дольше ${CRITERIA.stallGapMs / 1000} с: ${r.stalls} (худшее ${r.worstGapMs} мс)`);
  }
  if (r.disconnects > CRITERIA.maxDisconnects) reasons.push(`обрывов связи: ${r.disconnects}`);
  if (r.lossPct > CRITERIA.maxLossPct) reasons.push(`пинги без ответа: ${r.lossPct.toFixed(1)}%`);
  if (r.hiddenS > CRITERIA.maxHiddenS) {
    reasons.push(`вкладка была свёрнута ${r.hiddenS} с — результат неточный, лучше повторить`);
  }
  return { ok: reasons.length === 0, full: r.durationS >= CRITERIA.minDurationS, reasons };
}

export function formatReport(r: NettestResult, v: Verdict): string {
  const lines = [
    `DoodleMagic · тест связи · ${v.ok ? (v.full ? "OK" : "OK (короткий тест)") : "ПРОБЛЕМЫ"}`,
    `Имя: ${r.name || "—"} · ${r.device} · сеть ${r.net} · комната ${r.room} · ${r.durationS} с`,
  ];
  if (r.relayOnly) lines.push("Режим: только через ретранслятор (TURN)");
  lines.push(
    `Связь с хостом ${r.host || "—"}: ${ROUTE_LABEL[r.route]}`,
    `Пинг: p50 ${fmtMs(r.rtt.p50)}, p95 ${fmtMs(r.rtt.p95)}, p99 ${fmtMs(r.rtt.p99)}, макс ${fmtMs(r.rtt.max)}, джиттер ${fmtMs(r.rtt.jitter)}`,
    `Пинги без ответа ${r.lossPct.toFixed(1)}% · зависаний ${r.stalls} · обрывов ${r.disconnects} · снапшоты ${fmtRate(r.snapRate)}/с`,
  );
  for (const reason of v.reasons) lines.push(`• ${reason}`);
  // Короткий, но неудачный прогон в итог идёт — как провал, причины уже перечислены выше.
  if (v.ok && !v.full) lines.push("Короткий тест: в итог «9 из 10» не идёт");
  return lines.join("\n");
}

const isNum = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x);

/** Отчёт приходит хосту от участника по сети — проверяем форму перед тем, как показывать. */
export function isNettestResult(x: unknown): x is NettestResult {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  const rtt = r.rtt as Record<string, unknown> | null | undefined;
  return (
    r.v === 3 &&
    typeof r.name === "string" &&
    typeof r.host === "string" &&
    typeof r.device === "string" &&
    typeof r.net === "string" &&
    typeof r.opened === "boolean" &&
    typeof r.relayOnly === "boolean" &&
    typeof r.route === "string" &&
    Object.hasOwn(ROUTE_LABEL, r.route) &&
    typeof rtt === "object" &&
    rtt !== null &&
    isNum(rtt.count) &&
    [r.durationS, r.sent, r.received, r.lossPct, r.stalls, r.worstGapMs, r.disconnects, r.hiddenS, r.snapRate].every(
      isNum,
    )
  );
}

export interface SummaryExtras {
  /** Участники, у которых P2P-канал с хостом так и не открылся: отчёта от них нет и не будет. */
  failedOpens?: readonly PeerTag[];
  /** Сколько секунд вкладка хоста была скрыта. */
  hostHiddenS?: number;
}

const turnTag = (relayOnly: boolean): string => (relayOnly ? " · проверка TURN" : "");

/**
 * Сводка для хоста: строка на участника и устройство и итог по критерию «9 из 10».
 * В зачёт идут полные тесты, любые тесты с проблемами и участники, у которых канал не открылся:
 * короткий, но неудачный прогон — это провал, а не повод вычеркнуть участника из знаменателя.
 * Исключаются только короткие здоровые прогоны и проверки «только через TURN»: они не показывают обычную игру.
 */
export function formatSummary(results: readonly NettestResult[], extras: SummaryExtras = {}): string {
  const failedOpens = extras.failedOpens ?? [];
  const hostHiddenS = Math.round(extras.hostHiddenS ?? 0);
  const hiddenLine = `Вкладка хоста была скрыта ${hostHiddenS} с — результаты за это время ненадёжны`;
  if (results.length === 0 && failedOpens.length === 0) {
    return hostHiddenS > 0 ? `Пока нет результатов.\n${hiddenLine}` : "Пока нет результатов.";
  }
  const lines: string[] = [];
  let passed = 0;
  let counted = 0;
  let short = 0;
  let normal = 0;
  let relayed = 0;
  let turnChecks = 0;
  let turnPassed = 0;
  for (const r of results) {
    const v = judge(r);
    if (r.relayOnly) {
      turnChecks++;
      if (v.ok) turnPassed++;
    } else {
      normal++;
      if (r.route === "relay") relayed++;
      if (v.full || !v.ok) {
        counted++;
        if (v.ok) passed++;
      } else short++;
    }
    lines.push(
      `${v.ok ? "OK  " : "FAIL"} ${r.name || "—"} · ${r.device} · сеть ${r.net}${v.full ? "" : " · короткий"}${turnTag(r.relayOnly)} · ${ROUTE_SHORT[r.route]} · p50 ${fmtMs(r.rtt.p50)} · p95 ${fmtMs(r.rtt.p95)} · p99 ${fmtMs(r.rtt.p99)} · зав ${r.stalls} · обр ${r.disconnects} · без ответа ${r.lossPct.toFixed(1)}% · ${r.durationS} с`,
    );
    for (const reason of v.reasons) lines.push(`     • ${reason}`);
  }
  for (const f of failedOpens) {
    if (f.relayOnly) turnChecks++;
    else counted++;
    lines.push(`FAIL ${f.name} · ${f.device}${turnTag(f.relayOnly)} · канал не открылся`);
  }
  const threshold = Math.round(CRITERIA.passShare * 100);
  const pct = counted === 0 ? 0 : Math.round((passed / counted) * 100);
  lines.push("", `Прошли ${passed} из ${counted} в зачёте (${pct} %). Порог: ${threshold} %.`);
  if (short > 0) lines.push(`Коротких тестов (не в зачёт): ${short}.`);
  if (turnChecks > 0) lines.push(`Проверок только через TURN (не в зачёт): ${turnChecks}, прошли ${turnPassed}.`);
  lines.push(`Через ретранслятор (TURN): ${relayed} из ${normal}.`);
  if (hostHiddenS > 0) lines.push(hiddenLine);
  lines.push(
    counted === 0
      ? "Критерий: пока не оценить — нет результатов в зачёте"
      : `Критерий (≥ ${threshold} % в зачёте): ${passed / counted >= CRITERIA.passShare ? "выполнен ✓" : "не выполнен ✗"}`,
  );
  return lines.join("\n");
}

/**
 * Текст для участника, когда хост ответил `error`. Хост шлёт OUTDATED_REASON, если версии не совпали; v3 — новейшая,
 * поэтому участнику с этой страницей такое приходит только от хоста со старой. Причину пишет чужой браузер — режем.
 */
export function hostErrorText(reason: string): string {
  if (reason === OUTDATED_REASON) return "Хост на старой версии страницы — попроси его обновить страницу";
  return reason.trim().slice(0, 200) || "Хост прервал тест";
}

/** Что страница хоста хранит в localStorage, чтобы результаты пережили перезагрузку. */
export interface HostSave {
  reports: NettestResult[];
  failedOpens: PeerTag[];
  hostHiddenS: number;
}

/** Разбор сохранённого состояния хоста: битые и устаревшие записи отбрасываем, а не роняем страницу. */
export function parseHostSave(raw: string | null): HostSave {
  const empty: HostSave = { reports: [], failedOpens: [], hostHiddenS: 0 };
  if (raw === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return empty;
  const o = parsed as Record<string, unknown>;
  return {
    reports: Array.isArray(o.reports) ? o.reports.filter(isNettestResult) : [],
    failedOpens: Array.isArray(o.failedOpens)
      ? o.failedOpens.filter((f) => typeof f === "object" && f !== null).map(parsePeerTag)
      : [],
    hostHiddenS: typeof o.hostHiddenS === "number" && o.hostHiddenS > 0 ? Math.round(o.hostHiddenS) : 0,
  };
}
