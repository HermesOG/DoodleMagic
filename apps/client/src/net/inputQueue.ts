import type { MatchInput } from "@doodlemagic/sim";
import type { SeqInput } from "./protocol";

/** Ввода нет дольше — маг стоит (вкладка игрока в фоне, обрыв). */
export const STALE_INPUT_MS = 250;
/** Хвост очереди длиннее — обрезается до TRIM_TO: хост не копит задержку. */
export const MAX_BACKLOG = 6;
export const TRIM_TO = 2;
export const MAX_PENDING = 64;
const BUTTONS = ["jump", "primary", "q", "e", "c"] as const;

/** Очередь ввода одного игрока у хоста. ack — номер последнего применённого ввода (−1 — ни одного). */
export interface InputQueue { ack: number; last: MatchInput | null; lastAt: number; pending: SeqInput[] }

export function createInputQueue(): InputQueue {
  return { ack: -1, last: null, lastAt: -Infinity, pending: [] };
}

/** Новые вводы в очередь: старые (seq ≤ ack) и повторы отбрасываются, очередь по возрастанию seq, не длиннее MAX_PENDING. */
export function pushInputs(q: InputQueue, items: readonly SeqInput[], nowMs: number): void {
  if (items.length > 0) q.lastAt = nowMs;
  for (const it of items) {
    if (it.seq <= q.ack || q.pending.some((p) => p.seq === it.seq)) continue;
    q.pending.push(it);
  }
  q.pending.sort((a, b) => a.seq - b.seq);
  if (q.pending.length > MAX_PENDING) q.pending.splice(0, q.pending.length - MAX_PENDING);
}

/**
 * Ввод на тик. Очередь пуста: последний ввод ещё свеж — он же (кнопки остаются зажатыми, новых нажатий нет),
 * иначе null — маг стоит. Хвост длиннее MAX_BACKLOG — старые выбрасываются до TRIM_TO, их нажатия переходят в
 * следующий ввод (тап не теряется). Пропуск номера (потеря) — берётся следующий по порядку.
 */
export function takeInput(q: InputQueue, nowMs: number): MatchInput | null {
  if (q.pending.length === 0) return q.last !== null && nowMs - q.lastAt <= STALE_INPUT_MS ? q.last : null;
  if (q.pending.length > MAX_BACKLOG) {
    const dropped = q.pending.splice(0, q.pending.length - TRIM_TO);
    const next = q.pending[0]!;
    const merged = { ...next.input };
    for (const d of dropped) for (const b of BUTTONS) if (d.input[b]) merged[b] = true;
    next.input = merged;
  }
  const it = q.pending.shift()!;
  q.ack = it.seq;
  q.last = it.input;
  return it.input;
}
