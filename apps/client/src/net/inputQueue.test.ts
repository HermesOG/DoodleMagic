import { NO_MATCH_INPUT, type MatchInput } from "@doodlemagic/sim";
import { describe, expect, it } from "vitest";
import { MAX_BACKLOG, MAX_PENDING, STALE_INPUT_MS, TRIM_TO, createInputQueue, pushInputs, takeInput } from "./inputQueue";
import type { SeqInput } from "./protocol";

/** Ввод номера seq; вводы различаются по yaw. */
const item = (seq: number, over: Partial<MatchInput> = {}): SeqInput => ({ seq, input: { ...NO_MATCH_INPUT, yaw: seq / 100, ...over } });
const range = (from: number, to: number): SeqInput[] => Array.from({ length: to - from + 1 }, (_, k) => item(from + k));

describe("inputQueue", () => {
  it("starts empty with ack −1 and gives nothing to take", () => {
    const q = createInputQueue();
    expect([q.ack, q.last, q.pending.length]).toEqual([-1, null, 0]);
    expect(takeInput(q, 0)).toBeNull();
    expect(q.ack).toBe(-1);
  });

  it("hands out inputs in seq order and raises ack", () => {
    const q = createInputQueue();
    pushInputs(q, [item(2), item(0), item(1)], 1000);
    const out = [takeInput(q, 1000), takeInput(q, 1000), takeInput(q, 1000)];
    expect(out.map((i) => i?.yaw)).toEqual([0, 0.01, 0.02]);
    expect(q.ack).toBe(2);
    expect(q.pending).toEqual([]);
  });

  it("ack grows with every taken input", () => {
    const q = createInputQueue();
    pushInputs(q, range(10, 14), 0);
    const acks: number[] = [];
    for (let k = 0; k < 5; k++) {
      takeInput(q, 0);
      acks.push(q.ack);
    }
    expect(acks).toEqual([10, 11, 12, 13, 14]);
  });

  it("drops repeats of pending inputs and old ones (seq ≤ ack)", () => {
    const q = createInputQueue();
    pushInputs(q, range(0, 2), 0);
    takeInput(q, 0);
    takeInput(q, 0); // ack = 1
    pushInputs(q, [item(0), item(1), item(2), item(3)], 5); // 0 и 1 — старые, 2 — уже в очереди
    expect(q.pending.map((p) => p.seq)).toEqual([2, 3]);
  });

  it("keeps the first copy of a repeated seq", () => {
    const q = createInputQueue();
    pushInputs(q, [item(4, { jump: true })], 0);
    pushInputs(q, [item(4, { jump: false })], 1);
    expect(q.pending).toHaveLength(1);
    expect(q.pending[0]?.input.jump).toBe(true);
  });

  it("overlapping packets (3 latest inputs each) add up to one clean sequence", () => {
    const q = createInputQueue();
    pushInputs(q, range(0, 2), 0);
    pushInputs(q, range(1, 3), 16); // пакет 1 потерян бы — тут пришёл, перекрытие 1–2
    pushInputs(q, range(3, 5), 32);
    expect(q.pending.map((p) => p.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("a lost packet leaves a gap in seq: the next one in order is taken", () => {
    const q = createInputQueue();
    pushInputs(q, [item(0), item(1), item(5), item(6)], 0);
    const seqs: number[] = [];
    for (let k = 0; k < 4; k++) {
      takeInput(q, 0);
      seqs.push(q.ack);
    }
    expect(seqs).toEqual([0, 1, 5, 6]);
  });

  it("an empty queue repeats the last input while it is fresh, then gives null", () => {
    const q = createInputQueue();
    pushInputs(q, [item(0, { moveZ: 1, primary: true })], 1000);
    const first = takeInput(q, 1000);
    expect(first).toMatchObject({ moveZ: 1, primary: true });
    expect(STALE_INPUT_MS).toBe(250);
    expect(takeInput(q, 1100)).toBe(first);
    expect(takeInput(q, 1000 + STALE_INPUT_MS)).toBe(first);
    expect(takeInput(q, 1000 + STALE_INPUT_MS + 1)).toBeNull();
    expect(takeInput(q, 5000)).toBeNull();
    expect(q.ack).toBe(0); // повторы ack не двигают
  });

  it("silence is measured from the last push, not from the last take", () => {
    const q = createInputQueue();
    pushInputs(q, [item(0)], 1000);
    takeInput(q, 1000);
    pushInputs(q, [], 1200); // пустой пакет не продлевает свежесть
    expect(takeInput(q, 1251)).toBeNull();
    pushInputs(q, [item(1)], 1300);
    expect(takeInput(q, 1300)?.yaw).toBe(0.01);
    expect(takeInput(q, 1500)?.yaw).toBe(0.01);
  });

  it("a new input after the silence works again", () => {
    const q = createInputQueue();
    pushInputs(q, [item(0)], 0);
    takeInput(q, 0);
    expect(takeInput(q, 1000)).toBeNull();
    pushInputs(q, [item(1, { moveX: -1 })], 1000);
    expect(takeInput(q, 1000)).toMatchObject({ moveX: -1 });
  });

  it("trims a backlog of 9 to 2 and carries the dropped presses into the next input", () => {
    expect([MAX_BACKLOG, TRIM_TO]).toEqual([6, 2]);
    const q = createInputQueue();
    const items = range(0, 8);
    items[1] = item(1, { q: true });
    items[3] = item(3, { jump: true });
    items[5] = item(5, { primary: true, e: true });
    pushInputs(q, items, 0);
    const got = takeInput(q, 0);
    // выброшены seq 0…6, взят seq 7 с чужими нажатиями
    expect(q.ack).toBe(7);
    expect(got).toMatchObject({ yaw: 0.07, q: true, jump: true, primary: true, e: true, c: false });
    expect(q.pending.map((p) => p.seq)).toEqual([8]);
    expect(takeInput(q, 0)).toMatchObject({ yaw: 0.08, q: false, jump: false });
    expect(q.ack).toBe(8);
  });

  it("does not trim a backlog of exactly MAX_BACKLOG", () => {
    const q = createInputQueue();
    pushInputs(q, range(0, MAX_BACKLOG - 1), 0);
    takeInput(q, 0);
    expect(q.ack).toBe(0);
    expect(q.pending).toHaveLength(MAX_BACKLOG - 1);
  });

  it("trims a backlog of MAX_BACKLOG + 1", () => {
    const q = createInputQueue();
    pushInputs(q, range(0, MAX_BACKLOG), 0);
    takeInput(q, 0);
    expect(q.ack).toBe(MAX_BACKLOG + 1 - TRIM_TO); // 7 вводов: семь минус два оставшихся = пять выброшено, взят seq 5
  });

  it("keeps the movement of the input it keeps, and does not touch the dropped inputs", () => {
    const q = createInputQueue();
    const items = range(0, 8).map((it) => ({ ...it, input: { ...it.input, moveZ: 1 } }));
    items[0] = item(0, { q: true, moveZ: -1 });
    const kept = items[7]!.input;
    pushInputs(q, items, 0);
    const got = takeInput(q, 0);
    expect(got).toMatchObject({ moveZ: 1, q: true });
    expect(got).not.toBe(kept);
    expect(kept.q).toBe(false); // сам объект ввода не мутируется: склейка — копия
  });

  it("holds at most 64 inputs, the oldest are thrown out", () => {
    expect(MAX_PENDING).toBe(64);
    const q = createInputQueue();
    pushInputs(q, range(0, 69), 0);
    expect(q.pending).toHaveLength(64);
    expect(q.pending[0]?.seq).toBe(6);
    expect(q.pending[63]?.seq).toBe(69);
  });
});
