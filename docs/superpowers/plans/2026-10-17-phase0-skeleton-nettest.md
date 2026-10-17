# Фаза 0: каркас и P2P-тест связи. План реализации (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **v2, 17.10.2026.** Владелец решил: бюджет $0, своих серверов нет, сеть как в Doodle District. Сервер на Cloudflare из v1 убран, тест связи стал P2P-тестом «хост — участники». Задача 1 выполнена по v1 и остаётся в силе.
>
> **После выполнения.** Код в задачах 2–5 — исходная версия плана. По итогам ревью итоговый код в репозитории (коммиты до `82a410d` и позже) отличается:
> - протокол v3 с подтверждением доставки отчёта (`ack`);
> - хост видит участников, у которых канал не открылся;
> - результаты хранятся отдельно по человеку и устройству;
> - режим `?relay=1`;
> - частота снапшотов и время скрытой вкладки хоста;
> - p99, явная строка «Критерий выполнен / не выполнен»;
> - сохранение сводки хоста в браузере.
>
> Публичный TURN openrelay закрыт, поэтому TURN-серверов в настройках пока нет.

**Goal:** До игрового кода проверить, держит ли P2P-связь с хостом у владельца и его друзей (Узбекистан и Европа), и поднять конвейер: монорепо, тесты, сайт на Vercel.

**Architecture:** pnpm-монорепо без серверной части.
- `packages/protocol` — общие сообщения теста и чистые функции.
- `apps/client` — Vite-страница `/nettest` с двумя ролями:
  - **хост** (`/nettest?host=1`) занимает PeerJS-ID комнаты, отвечает на пинги, шлёт «снапшоты» 20 раз/с, как будущая игра, и собирает отчёты участников в сводку;
  - **участник** (`/nettest`) 10 минут шлёт хосту 30 пакетов/с, считает пинг, зависания, обрывы, потери и путь соединения (напрямую или через TURN), в конце отправляет отчёт хосту.

**Tech Stack:** Node 24, pnpm 12.14, TypeScript 7, Vitest 5, Vite 8, PeerJS 1.5.5 (WebRTC).

## Global Constraints
- Фронтенд — статика на Vercel (тариф Hobby, некоммерческий). Своих серверов нет, бюджет $0.
- Сеть — P2P через PeerJS 1.5.5:
  - сигналинг — облако PeerJS;
  - ICE — STUN Google и Cloudflare плюс публичный TURN `openrelay.metered.ca` (логин и пароль `openrelayproject`), как в Doodle District.
- PeerJS-ID хоста комнаты: `doodlemagic-nt-<код комнаты в нижнем регистре>-host`.
- Язык — TypeScript (strict); монорепо pnpm: `apps/*`, `packages/*`; область имён пакетов `@doodlemagic/*`.
- Критерий теста связи: 9 из 10 играют 10 минут без зависаний, пинг p95 ≤ 120 мс.
- Интерфейс на русском языке.
- Исходники Doodle District в репозиторий не попадают: `research/doodle-district/source/` в `.gitignore`. Сырые результаты теста (имена друзей) тоже не публикуются: `design/nettest/` в `.gitignore`.
- Код комнаты — символы `[A-Z0-9_-]`, до 32 знаков.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Шаги с пометкой **👤 Владелец** требуют действий человека: аккаунты, браузер, подтверждение `git push`.

## Карта файлов

| Файл | Отвечает за |
|---|---|
| `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts` | Корень монорепо (сделано в задаче 1) |
| `packages/protocol/src/nettest.ts` | Сообщения теста: разбор входящих, `pong` / `welcome`, снапшот |
| `packages/protocol/src/index.ts` | Публичный вход пакета |
| `apps/client/src/config.ts` | Очистка кода комнаты |
| `apps/client/src/nettest/stats.ts` | Чистая статистика: перцентили, зависания, потери, вердикт, текст отчёта, сводка хоста, проверка формы отчёта |
| `apps/client/src/nettest/route.ts` | Определение пути соединения (напрямую или TURN) по `RTCStatsReport` |
| `apps/client/src/nettest/p2p.ts` | PeerJS: хост комнаты и сессия участника |
| `apps/client/src/nettest/page.ts` | Интерфейс страницы: режимы хоста и участника |
| `apps/client/src/main.ts`, `index.html`, `src/style.css`, `vercel.json` | Точка входа, маршрут `/nettest`, стили, SPA-перезапись на Vercel |
| `.claude/launch.json` | Запуск dev-сервера клиента для проверки в браузере |
| `design/nettest-results.md` | Итог теста и решение |

---

### Task 1: Монорепо, git и протокол теста связи — ВЫПОЛНЕНО

Сделано коммитом `ae5a115` по плану v1:
- корень монорепо (`.gitignore`, `package.json` с `packageManager: pnpm@12.14.0`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`);
- dev-зависимости `typescript` 7.0.2 и `vitest` 5.0.5;
- пакет `packages/protocol` с `src/nettest.ts`, `src/nettest.test.ts`, `src/index.ts` — 16 тестов зелёные.

В v2 протокол меняется в задаче 2.

---

### Task 2: Протокол под P2P

**Files:**
- Modify: `packages/protocol/src/nettest.ts` (заменить целиком)
- Test: `packages/protocol/src/nettest.test.ts` (заменить целиком)

**Interfaces:**
- Consumes: существующий пакет `@doodlemagic/protocol` из задачи 1.
- Produces (импорт из `@doodlemagic/protocol`):
  - константы `NETTEST_VERSION = 2`, `SNAPSHOT_HZ = 20`, `SNAPSHOT_PAD_BYTES = 800`, `MAX_NAME_LEN = 24`, `MAX_MSG_CHARS = 8192`;
  - типы `PingMsg`, `HelloMsg`, `ReportMsg { t: "report"; data: Record<string, unknown> }`, `ClientMsg`;
  - тип `HostMsg` — сообщения хоста, замена `ServerMsg`: `welcome { v; room; host; peers }`, `pong`, `snap`, `error`;
  - тип `RoomInfo { room; host; peers }`;
  - `parseClientMsg(raw: string | null): ClientMsg | null`;
  - `pong(msg, now): PongMsg`, `welcome(msg, info): WelcomeMsg | ErrorMsg`, `makeSnapshot(n, now): SnapMsg` — с узкими типами возврата;
  - `parseTraceColo` удаляется: Cloudflare больше не используется.

Что меняется и почему:
- **Новое сообщение `report`:** участник отправляет хосту итог теста.
- **Лимит длины:** 8192 символа вместо 1024 — отчёт длиннее килобайта. Константа называется `MAX_MSG_CHARS`, потому что `length` считает символы, а не байты.
- **`ServerMsg` → `HostMsg`:** в P2P «сервер» — это браузер хоста.
- **`welcome`** сообщает имя хоста вместо дата-центров Cloudflare.
- **Тест «слишком длинное сообщение»** теперь проверяет именно ограничение длины: вход — валидный JSON длиннее лимита. Раньше тест проходил за счёт ошибки разбора JSON.
- **Узкие типы возврата** делают сужение в тестах ненужным.

- [ ] **Step 1: Заменить тест**

`packages/protocol/src/nettest.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  MAX_MSG_CHARS,
  MAX_NAME_LEN,
  NETTEST_VERSION,
  SNAPSHOT_PAD_BYTES,
  makeSnapshot,
  parseClientMsg,
  pong,
  welcome,
} from "./nettest";

const info = { room: "FRIENDS", host: "Хост", peers: 2 };

/** Валидный ping, раздутый лишним полем до нужной длины. */
function pingOfLength(length: number): string {
  const base = JSON.stringify({ t: "ping", seq: 1, ct: 1, pad: "" });
  return JSON.stringify({ t: "ping", seq: 1, ct: 1, pad: "x".repeat(length - base.length) });
}

describe("parseClientMsg", () => {
  it("accepts a valid ping", () => {
    expect(parseClientMsg('{"t":"ping","seq":7,"ct":123.5}')).toEqual({ t: "ping", seq: 7, ct: 123.5 });
  });

  it("trims and truncates the hello name", () => {
    const raw = JSON.stringify({ t: "hello", v: 2, name: `  ${"a".repeat(40)}  ` });
    expect(parseClientMsg(raw)).toEqual({ t: "hello", v: 2, name: "a".repeat(MAX_NAME_LEN) });
  });

  it("accepts a report with an object payload", () => {
    expect(parseClientMsg('{"t":"report","data":{"v":2,"name":"Аня"}}')).toEqual({
      t: "report",
      data: { v: 2, name: "Аня" },
    });
  });

  it.each([
    ["broken json", "{"],
    ["null literal", "null"],
    ["unknown type", '{"t":"boom"}'],
    ["negative seq", '{"t":"ping","seq":-1,"ct":1}'],
    ["fractional seq", '{"t":"ping","seq":1.5,"ct":1}'],
    ["unsafe seq", `{"t":"ping","seq":${2 ** 60},"ct":1}`],
    ["string ct", '{"t":"ping","seq":1,"ct":"1"}'],
    ["ping without ct", '{"t":"ping","seq":1}'],
    ["hello without name", '{"t":"hello","v":2}'],
    ["hello with string version", '{"t":"hello","v":"2","name":"x"}'],
    ["report with array data", '{"t":"report","data":[1,2]}'],
    ["report with null data", '{"t":"report","data":null}'],
  ])("rejects %s", (_label, raw) => {
    expect(parseClientMsg(raw)).toBeNull();
  });

  it("rejects null input", () => {
    expect(parseClientMsg(null)).toBeNull();
  });

  it("enforces the length limit on otherwise valid messages", () => {
    expect(parseClientMsg(pingOfLength(MAX_MSG_CHARS))).toMatchObject({ t: "ping", seq: 1 });
    expect(parseClientMsg(pingOfLength(MAX_MSG_CHARS + 1))).toBeNull();
  });
});

describe("pong", () => {
  it("echoes seq and client time and adds host time", () => {
    expect(pong({ t: "ping", seq: 3, ct: 99 }, 5000)).toEqual({ t: "pong", seq: 3, ct: 99, st: 5000 });
  });
});

describe("welcome", () => {
  it("returns room info for the current version", () => {
    expect(welcome({ t: "hello", v: NETTEST_VERSION, name: "Аня" }, info)).toEqual({
      t: "welcome",
      v: NETTEST_VERSION,
      ...info,
    });
  });

  it("asks an outdated participant to reload", () => {
    expect(welcome({ t: "hello", v: 1, name: "x" }, info)).toEqual({ t: "error", reason: "обновите страницу" });
  });
});

describe("makeSnapshot", () => {
  it("pads the snapshot to emulate game traffic", () => {
    const snap = makeSnapshot(4, 1000);
    expect(snap).toMatchObject({ t: "snap", n: 4, st: 1000 });
    expect(snap.pad).toHaveLength(SNAPSHOT_PAD_BYTES);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm test packages/protocol`
Expected: FAIL. Нет экспорта `MAX_MSG_CHARS`, `report` отклоняется, `welcome` с полем `host` не совпадает.

- [ ] **Step 3: Заменить протокол**

`packages/protocol/src/nettest.ts`:
```ts
/** Сообщения P2P-теста связи. Хост (браузер организатора) и участники используют один и тот же код. */
export const NETTEST_VERSION = 2;
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_PAD_BYTES = 800;
export const MAX_NAME_LEN = 24;
/** Лимит длины строки сообщения в символах: отчёт участника весит около 1–2 тыс. символов. */
export const MAX_MSG_CHARS = 8192;

export type PingMsg = { t: "ping"; seq: number; ct: number };
export type HelloMsg = { t: "hello"; v: number; name: string };
export type ReportMsg = { t: "report"; data: Record<string, unknown> };
export type ClientMsg = PingMsg | HelloMsg | ReportMsg;

export type WelcomeMsg = { t: "welcome"; v: number; room: string; host: string; peers: number };
export type PongMsg = { t: "pong"; seq: number; ct: number; st: number };
export type SnapMsg = { t: "snap"; n: number; st: number; pad: string };
export type ErrorMsg = { t: "error"; reason: string };
export type HostMsg = WelcomeMsg | PongMsg | SnapMsg | ErrorMsg;

export interface RoomInfo {
  room: string;
  host: string;
  peers: number;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function parseClientMsg(raw: string | null): ClientMsg | null {
  if (raw === null || raw.length > MAX_MSG_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const m = parsed as Record<string, unknown>;
  if (m.t === "ping") {
    if (!Number.isSafeInteger(m.seq) || (m.seq as number) < 0 || !isFiniteNumber(m.ct)) return null;
    return { t: "ping", seq: m.seq as number, ct: m.ct };
  }
  if (m.t === "hello") {
    if (!isFiniteNumber(m.v) || typeof m.name !== "string") return null;
    return { t: "hello", v: m.v, name: m.name.trim().slice(0, MAX_NAME_LEN) };
  }
  if (m.t === "report") {
    if (typeof m.data !== "object" || m.data === null || Array.isArray(m.data)) return null;
    return { t: "report", data: m.data as Record<string, unknown> };
  }
  return null;
}

export function pong(msg: PingMsg, now: number): PongMsg {
  return { t: "pong", seq: msg.seq, ct: msg.ct, st: now };
}

export function welcome(msg: HelloMsg, info: RoomInfo): WelcomeMsg | ErrorMsg {
  if (msg.v !== NETTEST_VERSION) return { t: "error", reason: "обновите страницу" };
  return { t: "welcome", v: NETTEST_VERSION, ...info };
}

const PAD = "x".repeat(SNAPSHOT_PAD_BYTES);

/** Поток снапшотов примерно того же размера, что будет слать хост в игре. */
export function makeSnapshot(n: number, now: number): SnapMsg {
  return { t: "snap", n, st: now, pad: PAD };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят, и проверить типы**

Run: `pnpm test` и `pnpm --filter @doodlemagic/protocol typecheck`
Expected: PASS, `Tests  21 passed`; типы без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add packages/protocol
git commit -m "feat(protocol): P2P nettest messages with host reports" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Статистика, путь соединения, код комнаты

**Files:**
- Create: `apps/client/package.json`, `apps/client/tsconfig.json`
- Create: `apps/client/src/config.ts`, `apps/client/src/nettest/stats.ts`, `apps/client/src/nettest/route.ts`
- Test: `apps/client/src/config.test.ts`, `apps/client/src/nettest/stats.test.ts`, `apps/client/src/nettest/route.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - **`stats.ts`:**
    - `CRITERIA = { maxP95Ms: 120, stallGapMs: 1000, maxStalls: 0, maxLossPct: 2, maxDisconnects: 0, maxHiddenS: 5 }`;
    - типы `Route = "direct" | "relay" | "?"`, `RttSummary { count; p50; p95; max; jitter }`, `LinkTestData { route; rtts: number[]; arrivals: number[]; sent; received; disconnects; hiddenMs; durationS }`, `ResultMeta { name; room; host; ua; conn; tz }`, `NettestResult` (= `ResultMeta` + `v: 2`, `route`, `durationS`, `rtt`, `sent`, `received`, `lossPct`, `stalls`, `worstGapMs`, `disconnects`, `hiddenS`), `Verdict { ok; reasons: string[] }`;
    - `fmtMs(x)`, `percentile`, `summarizeRtt`, `countStalls`, `lossPct`;
    - `buildResult(d: LinkTestData, meta: ResultMeta): NettestResult`, `judge(r): Verdict`, `formatReport(r, v): string`, `isNettestResult(x: unknown): x is NettestResult`, `formatSummary(results: readonly NettestResult[]): string`.
  - **`route.ts`:** тип `StatsEntry`, `routeFromStats(entries: Iterable<StatsEntry>): Route`.
  - **`config.ts`:** `cleanRoom(raw: string | null): string`.

- [ ] **Step 1: Создать пакет клиента**

`apps/client/package.json`:
```json
{
  "name": "@doodlemagic/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@doodlemagic/protocol": "workspace:*"
  }
}
```

`apps/client/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

Run: `pnpm --filter @doodlemagic/client add -D vite`
Expected: в `apps/client/package.json` появился `vite` 8.x.

- [ ] **Step 2: Написать падающие тесты**

`apps/client/src/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cleanRoom } from "./config";

describe("cleanRoom", () => {
  it("uppercases and strips unsafe characters", () => {
    expect(cleanRoom("friends-1!<b>")).toBe("FRIENDS-1B");
  });

  it("limits the code to 32 characters", () => {
    expect(cleanRoom("a".repeat(40))).toBe("A".repeat(32));
  });

  it("falls back to FRIENDS", () => {
    expect(cleanRoom(null)).toBe("FRIENDS");
    expect(cleanRoom("!!!")).toBe("FRIENDS");
  });
});
```

`apps/client/src/nettest/route.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { routeFromStats } from "./route";

const candidates = (local: string, remote: string) => [
  { id: "L1", type: "local-candidate", candidateType: local },
  { id: "R1", type: "remote-candidate", candidateType: remote },
];

describe("routeFromStats", () => {
  it("is direct when the transport's selected pair has no relay candidate (Chrome)", () => {
    const stats = [
      { id: "T1", type: "transport", selectedCandidatePairId: "CP1" },
      { id: "CP1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      ...candidates("srflx", "host"),
    ];
    expect(routeFromStats(stats)).toBe("direct");
  });

  it("is relay when either side of the selected pair is a TURN candidate", () => {
    const stats = [
      { id: "T1", type: "transport", selectedCandidatePairId: "CP1" },
      { id: "CP1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      ...candidates("relay", "srflx"),
    ];
    expect(routeFromStats(stats)).toBe("relay");
  });

  it("falls back to the selected flag (Firefox)", () => {
    const stats = [
      { id: "CP1", type: "candidate-pair", state: "succeeded", selected: true, localCandidateId: "L1", remoteCandidateId: "R1" },
      ...candidates("host", "relay"),
    ];
    expect(routeFromStats(stats)).toBe("relay");
  });

  it("falls back to a nominated succeeded pair", () => {
    const stats = [
      { id: "CP1", type: "candidate-pair", state: "succeeded", nominated: true, localCandidateId: "L1", remoteCandidateId: "R1" },
      ...candidates("host", "host"),
    ];
    expect(routeFromStats(stats)).toBe("direct");
  });

  it("is unknown without a usable pair", () => {
    expect(routeFromStats([])).toBe("?");
    expect(
      routeFromStats([{ id: "T1", type: "transport", selectedCandidatePairId: "CP1" }, { id: "CP1", type: "candidate-pair", state: "succeeded" }]),
    ).toBe("?");
  });
});
```

`apps/client/src/nettest/stats.test.ts`:
```ts
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
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `pnpm test apps/client`
Expected: FAIL — `Failed to resolve import "./config"`, `"./route"`, `"./stats"`.

- [ ] **Step 4: Реализовать `config.ts` и `route.ts`**

`apps/client/src/config.ts`:
```ts
/** Код комнаты из ссылки: только A–Z, 0–9, «_» и «-», не длиннее 32 знаков. */
export function cleanRoom(raw: string | null): string {
  const room = (raw ?? "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  return room || "FRIENDS";
}
```

`apps/client/src/nettest/route.ts`:
```ts
import type { Route } from "./stats";

/** Одна запись из RTCStatsReport. Поля зависят от типа записи и браузера. */
export type StatsEntry = { id?: unknown; type?: unknown; [key: string]: unknown };

function selectedPair(byId: Map<string, StatsEntry>): StatsEntry | undefined {
  for (const e of byId.values()) {
    if (e.type === "transport" && typeof e.selectedCandidatePairId === "string") {
      const pair = byId.get(e.selectedCandidatePairId);
      if (pair) return pair;
    }
  }
  for (const e of byId.values()) {
    if (e.type === "candidate-pair" && e.state === "succeeded" && (e.selected === true || e.nominated === true)) return e;
  }
  return undefined;
}

/** Идёт ли выбранная пара ICE-кандидатов через ретранслятор (TURN). */
export function routeFromStats(entries: Iterable<StatsEntry>): Route {
  const byId = new Map<string, StatsEntry>();
  for (const e of entries) if (typeof e.id === "string") byId.set(e.id, e);
  const pair = selectedPair(byId);
  if (!pair) return "?";
  const local = byId.get(String(pair.localCandidateId));
  const remote = byId.get(String(pair.remoteCandidateId));
  if (!local || !remote) return "?";
  return local.candidateType === "relay" || remote.candidateType === "relay" ? "relay" : "direct";
}
```

- [ ] **Step 5: Реализовать `stats.ts`**

`apps/client/src/nettest/stats.ts`:
```ts
/** Критерии из GDD, раздел 10: «9 из 10 играют 10 минут без зависаний, пинг p95 ≤ 120 мс». */
export const CRITERIA = {
  maxP95Ms: 120,
  stallGapMs: 1000,
  maxStalls: 0,
  maxLossPct: 2,
  maxDisconnects: 0,
  maxHiddenS: 5,
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
  ok: boolean;
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
  const { stalls, worstGapMs } = countStalls(d.arrivals, CRITERIA.stallGapMs);
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
  else if (r.rtt.p95 > CRITERIA.maxP95Ms) {
    reasons.push(`пинг p95 ${Math.round(r.rtt.p95)} мс — выше ${CRITERIA.maxP95Ms}`);
  }
  if (r.stalls > CRITERIA.maxStalls) {
    reasons.push(`зависаний дольше 1 с: ${r.stalls} (худшее ${r.worstGapMs} мс)`);
  }
  if (r.disconnects > CRITERIA.maxDisconnects) reasons.push(`обрывов связи: ${r.disconnects}`);
  if (r.lossPct > CRITERIA.maxLossPct) reasons.push(`потеряно ${r.lossPct.toFixed(1)}% пакетов`);
  if (r.hiddenS > CRITERIA.maxHiddenS) {
    reasons.push(`вкладка была свёрнута ${r.hiddenS} с — результат неточный, лучше повторить`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function formatReport(r: NettestResult, v: Verdict): string {
  const lines = [
    `DoodleMagic · тест связи · ${v.ok ? "OK" : "ПРОБЛЕМЫ"}`,
    `Имя: ${r.name || "—"} · комната ${r.room} · ${r.durationS} с`,
    `Связь с хостом ${r.host || "—"}: ${ROUTE_LABEL[r.route]}`,
    `Пинг: p50 ${fmtMs(r.rtt.p50)}, p95 ${fmtMs(r.rtt.p95)}, макс ${fmtMs(r.rtt.max)}, джиттер ${fmtMs(r.rtt.jitter)}`,
    `Потери ${r.lossPct.toFixed(1)}% · зависаний ${r.stalls} · обрывов ${r.disconnects}`,
  ];
  for (const reason of v.reasons) lines.push(`• ${reason}`);
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

/** Сводка для хоста: строка на участника и итог по критерию «9 из 10». */
export function formatSummary(results: readonly NettestResult[]): string {
  if (results.length === 0) return "Пока нет результатов.";
  const lines: string[] = [];
  let passed = 0;
  let relayed = 0;
  for (const r of results) {
    const v = judge(r);
    if (v.ok) passed++;
    if (r.route === "relay") relayed++;
    lines.push(
      `${v.ok ? "OK  " : "FAIL"} ${r.name || "—"} · ${ROUTE_SHORT[r.route]} · p50 ${fmtMs(r.rtt.p50)} · p95 ${fmtMs(r.rtt.p95)} · зав ${r.stalls} · обр ${r.disconnects} · пот ${r.lossPct.toFixed(1)}% · ${r.durationS} с`,
    );
    for (const reason of v.reasons) lines.push(`     • ${reason}`);
  }
  const pct = Math.round((passed / results.length) * 100);
  lines.push(
    "",
    `Прошли ${passed} из ${results.length} (${pct} %). Порог: 90 %.`,
    `Через ретранслятор (TURN): ${relayed} из ${results.length}.`,
  );
  return lines.join("\n");
}
```

- [ ] **Step 6: Убедиться, что тесты проходят, и проверить типы**

Run: `pnpm test` и `pnpm --filter @doodlemagic/client typecheck`
Expected: PASS — `Test Files  4 passed`, все тесты зелёные, вывод без предупреждений; типы без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add apps/client pnpm-lock.yaml
git commit -m "feat(client): nettest statistics, route detection and host summary" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Правки после ревью** (отдельный коммит `fix(client): nettest verdict enforces full runs and trailing stalls`). Код выше дополнен так:
- **`LinkTestData`** получил поле `endedAt` (момент конца прогона). Пауза от последнего сообщения до конца тоже считается зависанием.
- **`CRITERIA`** получил `minDurationS: 570` и `passShare: 0.9`.
- **`Verdict`** получил поле `full`: короткий прогон не провал, но в итог «9 из 10» не идёт. Об этом пишут и `formatReport`, и `formatSummary`.
- **Проверка p95** не проходит, если значение неизвестно.
- **Строки с порогами** берутся из `CRITERIA`.

---

### Task 4: P2P-сессии: хост и участник

**Files:**
- Create: `apps/client/src/nettest/p2p.ts`
- Modify: `apps/client/package.json` (добавить `peerjs`)

**Interfaces:**
- Consumes:
  - из `@doodlemagic/protocol` (Task 2): `NETTEST_VERSION`, `SNAPSHOT_HZ`, `makeSnapshot`, `parseClientMsg`, `pong`, `welcome`, тип `HostMsg`;
  - из `stats.ts`: `isNettestResult`, типы `LinkTestData`, `NettestResult`;
  - из `route.ts`: `routeFromStats`, тип `StatsEntry`.
- Produces:
  - `PEER_OPTIONS`, `hostPeerId(room: string): string`;
  - `hostRoom(room: string, hostName: string, onUpdate: (s: HostState) => void): Promise<HostSession>`, где `HostState = { peers: string[]; reports: NettestResult[] }`, `HostSession = { close(): void }`. Если комнату уже занял другой хост, промис отклоняется ошибкой с `type === "unavailable-id"`;
  - `runPeerTest(o: PeerRunOptions): Promise<PeerOutcome>`, где:
    - `PeerRunOptions = { room; name; durationS; onTick?(data, connected, hostName) }`;
    - `PeerOutcome = { hostFound: boolean; hostName: string; data: LinkTestData; sendReport(r: NettestResult): boolean; close(): void }`;
    - промис отклоняется, только если недоступен сам сигналинг PeerJS.

Устройство:
- Соединение PeerJS — `serialization: "raw"` (строки как есть, их разбирает `parseClientMsg`) и `reliable: false` (неупорядоченный канал, как для игровых снапшотов).
- Хост на каждое соединение шлёт снапшоты 20 раз/с, на `hello` отвечает `welcome`, на `ping` — `pong`, принимает `report`.
- Участник 30 раз/с шлёт `ping`; переподключается через 1 с после обрыва. Через 1,5 с после открытия соединения определяет путь по `getStats()`. Если за 12 с с хостом соединиться не удалось, тест заканчивается с `hostFound: false`.
- WebRTC работает только в браузере, поэтому этот модуль проверяется типами, сборкой и живой проверкой в задаче 5. Вся считаемая логика уже покрыта тестами в задачах 2–3.

- [ ] **Step 1: Поставить PeerJS**

Run: `pnpm --filter @doodlemagic/client add peerjs@1.5.5`
Expected: в `apps/client/package.json` в `dependencies` — `"peerjs": "1.5.5"`.

- [ ] **Step 2: Реализовать сессии**

`apps/client/src/nettest/p2p.ts`:
```ts
import { Peer, type DataConnection } from "peerjs";
import { NETTEST_VERSION, SNAPSHOT_HZ, makeSnapshot, parseClientMsg, pong, welcome, type HostMsg } from "@doodlemagic/protocol";
import { routeFromStats, type StatsEntry } from "./route";
import { isNettestResult, type LinkTestData, type NettestResult } from "./stats";

/** Как будущая игра: 30 пакетов ввода в секунду к хосту, снапшоты 20 раз в секунду от хоста. */
export const PING_HZ = 30;
export const RECONNECT_DELAY_MS = 1000;
/** Пинги последних 2 с без ответа не считаем потерянными: ответ мог не успеть прийти. */
export const LOSS_GRACE_MS = 2000;
const TICK_MS = 250;
const OPEN_TIMEOUT_MS = 12_000;
const ROUTE_CHECK_DELAY_MS = 1500;

/** Как в Doodle District: STUN от Google и Cloudflare и бесплатный публичный TURN на случай строгого NAT. */
export const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      {
        urls: [
          "turn:openrelay.metered.ca:80",
          "turn:openrelay.metered.ca:443",
          "turn:openrelay.metered.ca:443?transport=tcp",
        ],
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
  },
};
const CONN_OPTIONS = { serialization: "raw", reliable: false };

type PeerError = Error & { type?: string };

export function hostPeerId(room: string): string {
  return `doodlemagic-nt-${room.toLowerCase()}-host`;
}

function openPeer(id: string | null): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, PEER_OPTIONS) : new Peer(PEER_OPTIONS);
    const timer = setTimeout(() => {
      peer.destroy();
      reject(Object.assign(new Error("signalling timeout"), { type: "timeout" }));
    }, OPEN_TIMEOUT_MS);
    peer.once("open", () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.once("error", (e: PeerError) => {
      clearTimeout(timer);
      peer.destroy();
      reject(e);
    });
  });
}

/** Сигналинг PeerJS иногда рвёт связь: открытые P2P-каналы живут, а для новых нужно переподключиться. */
function keepSignalling(peer: Peer): void {
  peer.on("disconnected", () => {
    if (!peer.destroyed) peer.reconnect();
  });
}

// ---------------------------------------------------------------- хост

export interface HostState {
  peers: string[];
  reports: NettestResult[];
}

export interface HostSession {
  close(): void;
}

export async function hostRoom(room: string, hostName: string, onUpdate: (s: HostState) => void): Promise<HostSession> {
  const peer = await openPeer(hostPeerId(room));
  keepSignalling(peer);
  const names = new Map<DataConnection, string>();
  /** Один результат на участника: при повторном прохождении остаётся последний. */
  const reports = new Map<string, NettestResult>();
  const emit = () => onUpdate({ peers: [...names.values()], reports: [...reports.values()] });

  peer.on("connection", (conn: DataConnection) => {
    let snapTimer: ReturnType<typeof setInterval> | undefined;
    const send = (msg: HostMsg) => {
      if (conn.open) void conn.send(JSON.stringify(msg));
    };
    conn.on("open", () => {
      let n = 0;
      snapTimer = setInterval(() => send(makeSnapshot(n++, Date.now())), 1000 / SNAPSHOT_HZ);
    });
    conn.on("data", (raw) => {
      const msg = parseClientMsg(typeof raw === "string" ? raw : null);
      if (!msg) return;
      if (msg.t === "ping") {
        send(pong(msg, Date.now()));
      } else if (msg.t === "hello") {
        names.set(conn, msg.name || "без имени");
        send(welcome(msg, { room, host: hostName, peers: names.size }));
        emit();
      } else if (isNettestResult(msg.data)) {
        reports.set(msg.data.name || conn.peer, msg.data);
        emit();
      }
    });
    const drop = () => {
      clearInterval(snapTimer);
      if (names.delete(conn)) emit();
    };
    conn.on("close", drop);
    conn.on("error", drop);
  });

  emit();
  return { close: () => peer.destroy() };
}

// ---------------------------------------------------------------- участник

export interface PeerRunOptions {
  room: string;
  name: string;
  durationS: number;
  onTick?: (data: Readonly<LinkTestData>, connected: boolean, hostName: string) => void;
}

export interface PeerOutcome {
  hostFound: boolean;
  hostName: string;
  data: LinkTestData;
  sendReport(r: NettestResult): boolean;
  close(): void;
}

export async function runPeerTest(o: PeerRunOptions): Promise<PeerOutcome> {
  const me = await openPeer(null);
  keepSignalling(me);

  return new Promise((resolve) => {
    const data: LinkTestData = {
      route: "?",
      rtts: [],
      arrivals: [],
      sent: 0,
      received: 0,
      disconnects: 0,
      hiddenMs: 0,
      durationS: 0,
      endedAt: 0,
    };
    const start = performance.now();
    const endAt = start + o.durationS * 1000;
    const sentAt = new Map<number, number>();
    let seq = 0;
    let conn: DataConnection | null = null;
    let connected = false;
    let everOpened = false;
    let hostName = "";
    let finished = false;
    let hiddenSince: number | null = document.hidden ? start : null;

    const onVisibility = () => {
      const now = performance.now();
      if (document.hidden) hiddenSince = now;
      else if (hiddenSince !== null) {
        data.hiddenMs += now - hiddenSince;
        hiddenSince = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    me.on("error", (e: PeerError) => {
      if (e.type === "peer-unavailable" && !everOpened) finish(false);
    });

    const connect = () => {
      if (finished) return;
      // PeerJS 1.5.5 возвращает undefined, пока нет связи с сигналингом: просто пробуем позже
      const c = me.connect(hostPeerId(o.room), CONN_OPTIONS) as DataConnection | undefined;
      if (!c) {
        setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      conn = c;
      let opened = false;
      c.on("open", () => {
        opened = true;
        everOpened = true;
        connected = true;
        void c.send(JSON.stringify({ t: "hello", v: NETTEST_VERSION, name: o.name }));
        setTimeout(() => {
          c.peerConnection
            ?.getStats()
            .then((report) => {
              data.route = routeFromStats(report.values() as Iterable<StatsEntry>);
            })
            .catch(() => undefined);
        }, ROUTE_CHECK_DELAY_MS);
      });
      c.on("data", (raw) => {
        const now = performance.now();
        data.arrivals.push(now);
        let msg: HostMsg;
        try {
          msg = JSON.parse(String(raw)) as HostMsg;
        } catch {
          return;
        }
        if (msg.t === "welcome") {
          hostName = msg.host;
        } else if (msg.t === "pong") {
          const t0 = sentAt.get(msg.seq);
          if (t0 !== undefined) {
            sentAt.delete(msg.seq);
            data.rtts.push(now - t0);
          }
        }
      });
      c.on("close", () => {
        if (finished || conn !== c) return;
        connected = false;
        // обрыв — это потеря уже открытого соединения; неудачные попытки переподключения не считаем
        if (opened) data.disconnects++;
        if (performance.now() < endAt) setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };

    const openTimer = setTimeout(() => {
      if (!everOpened) finish(false);
    }, OPEN_TIMEOUT_MS);

    const pingTimer = setInterval(() => {
      if (!connected || !conn?.open) return;
      const s = seq++;
      const t = performance.now();
      sentAt.set(s, t);
      void conn.send(JSON.stringify({ t: "ping", seq: s, ct: t }));
    }, 1000 / PING_HZ);

    const tickTimer = setInterval(() => {
      o.onTick?.(data, connected, hostName);
      if (performance.now() >= endAt) finish(true);
    }, TICK_MS);

    function finish(hostFound: boolean): void {
      if (finished) return;
      finished = true;
      clearTimeout(openTimer);
      clearInterval(pingTimer);
      clearInterval(tickTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      const now = performance.now();
      if (hiddenSince !== null) data.hiddenMs += now - hiddenSince;
      const cutoff = now - LOSS_GRACE_MS;
      let recent = 0;
      let lost = 0;
      for (const t of sentAt.values()) {
        if (t >= cutoff) recent++;
        else lost++;
      }
      data.sent = seq - recent;
      data.received = data.sent - lost;
      data.durationS = (now - start) / 1000;
      data.endedAt = now;
      resolve({
        hostFound,
        hostName,
        data,
        sendReport: (r) => {
          if (!conn?.open) return false;
          void conn.send(JSON.stringify({ t: "report", data: r }));
          return true;
        },
        close: () => me.destroy(),
      });
    }

    connect();
  });
}
```

- [ ] **Step 3: Проверить типы, тесты и сборку**

Run: `pnpm --filter @doodlemagic/client typecheck` и `pnpm test`
Expected: без ошибок типов; все тесты зелёные, как после задачи 3.

- [ ] **Step 4: Коммит**

```bash
git add apps/client pnpm-lock.yaml
git commit -m "feat(client): PeerJS host room and participant session" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Страница `/nettest`

**Files:**
- Create: `apps/client/index.html`, `apps/client/vercel.json`
- Create: `apps/client/src/main.ts`, `apps/client/src/style.css`, `apps/client/src/nettest/page.ts`
- Create: `.claude/launch.json`

**Interfaces:**
- Consumes:
  - из `config.ts`: `cleanRoom`;
  - из `p2p.ts`: `hostRoom`, `runPeerTest`, тип `PeerOutcome`;
  - из `stats.ts`: `CRITERIA`, `buildResult`, `countStalls`, `fmtMs`, `formatReport`, `formatSummary`, `judge`, `summarizeRtt`, тип `ResultMeta`.
- Produces:
  - `mountNettest(root: HTMLElement): void`;
  - маршруты: `/nettest?room=КОД&host=1` — хост, `/nettest?room=КОД[&dur=секунды]` — участник.

- [ ] **Step 1: Точка входа, стили, перезапись для Vercel**

`apps/client/index.html`:
```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DoodleMagic</title>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/client/vercel.json`:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

`apps/client/src/main.ts`:
```ts
import "./style.css";
import { mountNettest } from "./nettest/page";

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");

if (location.pathname.startsWith("/nettest")) {
  mountNettest(app);
} else {
  app.innerHTML = `
    <section class="card">
      <h1>DoodleMagic</h1>
      <p>Магическая арена от первого лица. Скоро.</p>
      <p><a class="btn" href="/nettest?host=1">Я организатор: открыть тест связи</a></p>
      <p><a class="btn secondary" href="/nettest">Меня позвали: пройти тест</a></p>
    </section>`;
}
```

`apps/client/src/style.css`:
```css
:root {
  color-scheme: light dark;
  --bg: #f6f3ea;
  --fg: #1d1b16;
  --muted: #6b665a;
  --card: #fffdf7;
  --line: #d9d3c3;
  --accent: #c8322a;
  --good: #2f8a4a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15140f;
    --fg: #eeeae0;
    --muted: #a39d8f;
    --card: #1f1d17;
    --line: #38352c;
    --good: #5fbf7a;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
#app { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
h1 { margin: 0 0 8px; font-size: 28px; }
h2 { margin: 16px 0 8px; font-size: 20px; }
label { display: block; margin: 12px 0; font-weight: 600; }
input, select {
  display: block; width: 100%; margin-top: 6px; padding: 10px 12px; font: inherit;
  border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg);
}
.btn {
  display: inline-block; padding: 12px 20px; border: 0; border-radius: 8px; background: var(--accent);
  color: #fff; font: inherit; font-weight: 700; cursor: pointer; text-decoration: none;
}
.btn:disabled { opacity: 0.5; cursor: default; }
.btn.secondary { background: transparent; color: var(--fg); border: 1px solid var(--line); }
.muted { color: var(--muted); }
.small { font-size: 14px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grid .k { display: block; font-size: 13px; color: var(--muted); }
.grid b { font-size: 22px; font-variant-numeric: tabular-nums; }
pre {
  white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; padding: 12px; font-size: 14px;
}
.ok { color: var(--good); }
.bad { color: var(--accent); }
```

- [ ] **Step 2: Интерфейс страницы**

`apps/client/src/nettest/page.ts`:
```ts
import { cleanRoom } from "../config";
import { hostRoom, runPeerTest, type PeerOutcome } from "./p2p";
import {
  CRITERIA,
  buildResult,
  countStalls,
  fmtMs,
  formatReport,
  formatSummary,
  judge,
  summarizeRtt,
  type ResultMeta,
} from "./stats";

const NAME_KEY = "nettest_name";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим: имя просто не запомнится
  }
}

const fmtClock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const connType = (): string =>
  (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? "?";

function byId<T extends HTMLElement = HTMLElement>(root: HTMLElement, id: string): T {
  const node = root.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

async function keepAwake(): Promise<WakeLockSentinel | null> {
  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    return null;
  }
}

function copyOnClick(btn: HTMLButtonElement, text: () => string): void {
  btn.addEventListener("click", () => {
    void navigator.clipboard.writeText(text()).then(
      () => {
        btn.textContent = "Скопировано ✓";
      },
      () => {
        btn.textContent = "Не вышло — выдели текст вручную";
      },
    );
  });
}

export function mountNettest(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const room = cleanRoom(params.get("room"));
  if (params.get("host") === "1") mountHost(root, room);
  else mountPeer(root, room, Number(params.get("dur")));
}

// ---------------------------------------------------------------- хост

function mountHost(root: HTMLElement, room: string): void {
  const shareLink = `${location.origin}/nettest?room=${encodeURIComponent(room)}`;
  root.innerHTML = `
    <section class="card">
      <h1>Тест связи: ты хост</h1>
      <p class="muted">Твой браузер будет «сервером», как в будущей игре. Открой комнату, отправь друзьям ссылку и не закрывай и не сворачивай эту вкладку, пока все не закончат.</p>
      <label>Твоё имя (его увидят участники) <input id="nt-name" maxlength="24" autocomplete="nickname" placeholder="Например, Хост" /></label>
      <p class="muted small">Комната: <b id="nt-room"></b></p>
      <button id="nt-open" class="btn" type="button">Открыть комнату</button>
      <p class="muted small" id="nt-status"></p>
    </section>
    <section class="card" id="nt-room-card" hidden>
      <p>Ссылка для друзей:</p>
      <pre id="nt-link"></pre>
      <button id="nt-copy-link" class="btn secondary" type="button">Скопировать ссылку</button>
      <h2>Сейчас в тесте: <span id="nt-count">0</span></h2>
      <p class="muted small" id="nt-peers"></p>
      <h2>Результаты</h2>
      <pre id="nt-summary"></pre>
      <button id="nt-copy-summary" class="btn secondary" type="button">Скопировать сводку</button>
    </section>`;

  const nameInput = byId<HTMLInputElement>(root, "nt-name");
  const openBtn = byId<HTMLButtonElement>(root, "nt-open");
  const status = byId(root, "nt-status");
  let summary = formatSummary([]);
  byId(root, "nt-room").textContent = room;
  byId(root, "nt-link").textContent = shareLink;
  byId(root, "nt-summary").textContent = summary;
  nameInput.value = safeGet(NAME_KEY) ?? "";
  copyOnClick(byId<HTMLButtonElement>(root, "nt-copy-link"), () => shareLink);
  copyOnClick(byId<HTMLButtonElement>(root, "nt-copy-summary"), () => summary);

  openBtn.addEventListener("click", () => {
    void open();
  });

  async function open(): Promise<void> {
    const name = nameInput.value.trim().slice(0, 24) || "Хост";
    safeSet(NAME_KEY, name);
    openBtn.disabled = true;
    nameInput.disabled = true;
    status.textContent = "Открываем комнату…";
    try {
      await hostRoom(room, name, (s) => {
        byId(root, "nt-count").textContent = String(s.peers.length);
        byId(root, "nt-peers").textContent = s.peers.join(", ");
        summary = formatSummary(s.reports);
        byId(root, "nt-summary").textContent = summary;
      });
    } catch (e) {
      const type = (e as { type?: string }).type;
      status.textContent =
        type === "unavailable-id"
          ? `Комната ${room} уже открыта (в другой вкладке или у другого хоста). Закрой её или возьми другой код: ?room=ДРУГОЙ&host=1`
          : `Не удалось открыть комнату (${type ?? String(e)}). Проверь интернет и обнови страницу.`;
      openBtn.disabled = false;
      nameInput.disabled = false;
      return;
    }
    await keepAwake();
    status.textContent = "Комната открыта ✓ Не закрывай и не сворачивай эту вкладку.";
    byId(root, "nt-room-card").hidden = false;
  }
}

// ---------------------------------------------------------------- участник

function mountPeer(root: HTMLElement, room: string, debugDur: number): void {
  root.innerHTML = `
    <section class="card">
      <h1>Тест связи</h1>
      <p class="muted">Проверяем, потянет ли твой интернет онлайн-игру DoodleMagic. Тест идёт 10 минут: не закрывай и не сворачивай вкладку, не давай компьютеру уснуть.</p>
      <label>Как тебя зовут <input id="nt-name" maxlength="24" autocomplete="nickname" placeholder="Например, Аня" /></label>
      <label>Длительность <select id="nt-dur"></select></label>
      <p class="muted small">Комната: <b id="nt-room"></b></p>
      <button id="nt-start" class="btn" type="button">Начать</button>
      <p class="bad small" id="nt-error"></p>
    </section>
    <section class="card" id="nt-live" hidden>
      <div class="grid">
        <div><span class="k">Прошло</span><b id="nt-elapsed">0:00</b></div>
        <div><span class="k">Пинг сейчас</span><b id="nt-last">—</b></div>
        <div><span class="k">Пинг p95</span><b id="nt-p95">—</b></div>
        <div><span class="k">Зависания</span><b id="nt-stalls">0</b></div>
      </div>
      <p class="muted small" id="nt-status">Подключаемся к хосту…</p>
    </section>
    <section class="card" id="nt-result" hidden>
      <h2 id="nt-verdict"></h2>
      <pre id="nt-report"></pre>
      <p class="muted small" id="nt-sent"></p>
      <button id="nt-copy" class="btn secondary" type="button">Скопировать результат</button>
    </section>`;

  const nameInput = byId<HTMLInputElement>(root, "nt-name");
  const durSelect = byId<HTMLSelectElement>(root, "nt-dur");
  const startBtn = byId<HTMLButtonElement>(root, "nt-start");
  const errorLine = byId(root, "nt-error");
  let reportText = "";
  byId(root, "nt-room").textContent = room;
  nameInput.value = safeGet(NAME_KEY) ?? "";
  const durations: Array<[number, string]> = [
    [600, "10 минут — полный тест"],
    [180, "3 минуты — быстрая проверка"],
  ];
  if (Number.isFinite(debugDur) && debugDur > 0) durations.unshift([debugDur, `${debugDur} с — отладка`]);
  for (const [seconds, label] of durations) durSelect.add(new Option(label, String(seconds)));
  copyOnClick(byId<HTMLButtonElement>(root, "nt-copy"), () => reportText);

  const setInputsDisabled = (disabled: boolean) => {
    startBtn.disabled = disabled;
    nameInput.disabled = disabled;
    durSelect.disabled = disabled;
  };

  startBtn.addEventListener("click", () => {
    void run();
  });

  async function run(): Promise<void> {
    const name = nameInput.value.trim().slice(0, 24);
    safeSet(NAME_KEY, name);
    setInputsDisabled(true);
    errorLine.textContent = "";
    byId(root, "nt-live").hidden = false;
    const wake = await keepAwake();

    const started = performance.now();
    let lastSummaryAt = 0;
    let outcome: PeerOutcome;
    try {
      outcome = await runPeerTest({
        room,
        name,
        durationS: Number(durSelect.value),
        onTick: (d, connected, hostName) => {
          const now = performance.now();
          byId(root, "nt-elapsed").textContent = fmtClock((now - started) / 1000);
          byId(root, "nt-last").textContent = fmtMs(d.rtts.at(-1));
          byId(root, "nt-status").textContent = connected
            ? `Связь с хостом ${hostName || "…"} есть`
            : "Связь с хостом потеряна, переподключаемся…";
          if (now - lastSummaryAt > 1000) {
            lastSummaryAt = now;
            byId(root, "nt-p95").textContent = fmtMs(summarizeRtt(d.rtts).p95);
            byId(root, "nt-stalls").textContent = String(countStalls(d.arrivals, CRITERIA.stallGapMs).stalls);
          }
        },
      });
    } catch (e) {
      await wake?.release().catch(() => undefined);
      byId(root, "nt-live").hidden = true;
      errorLine.textContent = `Не удалось подключиться к сигналингу PeerJS (${(e as { type?: string }).type ?? String(e)}). Проверь интернет и нажми «Начать» ещё раз.`;
      setInputsDisabled(false);
      return;
    }
    await wake?.release().catch(() => undefined);

    if (!outcome.hostFound) {
      outcome.close();
      byId(root, "nt-live").hidden = true;
      errorLine.textContent = "Хост не найден. Проверь ссылку или попроси организатора открыть комнату, потом нажми «Начать» ещё раз.";
      setInputsDisabled(false);
      return;
    }

    const meta: ResultMeta = {
      name,
      room,
      host: outcome.hostName,
      ua: navigator.userAgent.slice(0, 160),
      conn: connType(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const result = buildResult(outcome.data, meta);
    const verdict = judge(result);
    reportText = formatReport(result, verdict);

    const verdictEl = byId(root, "nt-verdict");
    verdictEl.textContent = verdict.ok ? "Связь в порядке ✓" : "Есть проблемы";
    verdictEl.className = verdict.ok ? "ok" : "bad";
    byId(root, "nt-report").textContent = reportText;
    byId(root, "nt-result").hidden = false;
    byId(root, "nt-sent").textContent = outcome.sendReport(result)
      ? "Результат отправлен хосту ✓"
      : "Связь с хостом уже закрыта — скопируй текст и пришли в чат";
    setTimeout(() => outcome.close(), 1500);
  }
}
```

- [ ] **Step 3: Проверить типы, тесты и сборку**

Run: `pnpm --filter @doodlemagic/client typecheck`, `pnpm test`, `pnpm build:client`
Expected: без ошибок типов; все тесты зелёные; `apps/client/dist/index.html` и бандл в `dist/assets/` собраны без ошибок.

- [ ] **Step 4: Конфигурация запуска для проверки в браузере**

`.claude/launch.json`:
```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "client",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@doodlemagic/client", "dev", "--port", "5173", "--strictPort"],
      "port": 5173
    }
  ]
}
```

- [ ] **Step 5: Коммит**

```bash
git add apps/client .claude/launch.json
git commit -m "feat(client): /nettest page with host and participant modes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Живая проверка в браузере (контролёр)**

Запустить dev-сервер `client` из `.claude/launch.json` и открыть две вкладки (нужен интернет: облако PeerJS):
1. Вкладка A: `http://localhost:5173/nettest?room=LOCALTEST&host=1` → «Открыть комнату».
   Expected: «Комната открыта ✓», «Сейчас в тесте: 0».
2. Вкладка B: `http://localhost:5173/nettest?room=LOCALTEST&dur=20` → выбрать «20 с — отладка», ввести имя, «Начать».
   Expected во время теста: «Связь с хостом … есть», пинг — единицы или десятки мс, зависаний 0; во вкладке A — «Сейчас в тесте: 1».
3. Через 20 с во вкладке B: «Связь в порядке ✓», в отчёте «Связь с хостом …: напрямую», «Результат отправлен хосту ✓».
   Expected во вкладке A: сводка со строкой участника и «Прошли 1 из 1 (100 %)».
4. Вкладка C: `http://localhost:5173/nettest?room=NOHOST&dur=20` → «Начать».
   Expected: не позже чем через 12 с — «Хост не найден…», кнопка снова активна.

---

### Task 6: Деплой на Vercel

**Files:**
- Modify: ничего в коде.

**Interfaces:**
- Consumes: клиент из задач 3–5.
- Produces: публичная страница `https://doodle-magic-eight.vercel.app/nettest`, которую использует задача 7.

- [ ] **Step 1: 👤 Владелец: автор коммитов**

**Выполнено 17.10.2026:** все коммиты переписаны на адрес GitHub noreply, личная почта в историю не попала. Если коммиты подписаны личной почтой, перед пушем в публичный репозиторий её стоит скрыть: взять адрес вида `…+HermesOG@users.noreply.github.com` (GitHub → Settings → Emails) и переписать автора всех локальных коммитов:
```bash
git config user.name "HermesOG"
git config user.email "<адрес noreply>"
git rebase --root --exec "git commit --amend --no-edit --reset-author"
```
Expected: `git log --format='%an <%ae>'` показывает нужный адрес у всех коммитов.

- [ ] **Step 2: 👤 Владелец подтверждает: отправить код на GitHub**

Проверить, что не уходит лишнее: `git ls-files | grep -E "research/doodle-district/source|design/nettest/|\.superpowers"` — вывод **пустой**.
Run (после явного «да» владельца): `git push -u origin main`
Expected: ветка `main` есть на `https://github.com/HermesOG/DoodleMagic`.

- [ ] **Step 3: 👤 Владелец: подключить Vercel к репозиторию**

На `https://vercel.com/new` → Import Git Repository → `HermesOG/DoodleMagic`:
- **Project Name:** `doodlemagic`;
- **Root Directory:** `apps/client`;
- **Framework Preset:** Vite (определится сам);
- **Environment Variables:** `ENABLE_EXPERIMENTAL_COREPACK` = `1`, чтобы Vercel взял pnpm 12 из `packageManager`;
- нажать **Deploy**.

Expected: деплой зелёный, адрес вида `https://doodle-magic-eight.vercel.app`. Если имя занято, Vercel даст другое — записать его.

- [ ] **Step 4: Проверить прод**

На продовом адресе, комната `CHECK`:
1. Хост — компьютер владельца (`/nettest?room=CHECK&host=1`), участник — телефон на мобильном интернете (`/nettest?room=CHECK`, 3 минуты).
   Expected: участник получает «Связь в порядке ✓» или понятные причины; хост видит строку «… · телефон …», а участник — «Результат доставлен хосту ✓». Заодно это подтверждает, что `*.vercel.app` открывается без VPN.
2. Тот же участник под тем же именем проходит тест с компьютера.
   Expected: в сводке две строки, «телефон» и «ПК»; результат телефона не затёрт.
3. Во время прогона хост на 30 с переключается на другую вкладку.
   Expected: «Вкладка хоста была скрыта ~30 с» в сводке, у участника — причина про снапшоты ниже 18/с.
4. После проверок нажать «Очистить результаты». Для теста с друзьями взять **новый** код комнаты, чтобы проверочные прогоны не попали в сводку.

---

### Task 7: Тест с друзьями и решение

**Files:**
- Create: `design/nettest-results.md`

**Interfaces:**
- Consumes: продовая страница из задачи 6.
- Produces: решение по сети для фазы 3.

- [ ] **Step 1: 👤 Владелец: открыть комнату и разослать приглашение**

Владелец открывает `https://doodle-magic-eight.vercel.app/nettest?room=DM-1021&host=1` на своём компьютере (код комнаты новый, не `CHECK`), жмёт «Открыть комнату» и не трогает эту вкладку. Чат с друзьями держать **в отдельном окне рядом**, а не во вкладке того же окна: скрытая вкладка хоста портит измерения.

**Две волны по 5 человек или меньше.** 10 человек сразу дают хосту примерно вдвое больше исходящего трафика, чем будет в игре, и могут уронить всех из-за узкого канала хоста. Волна 1 — например, в 21:00, волна 2 — в 21:15.

Текст для чата:
> Привет! Делаю браузерную игру и проверяю, потянет ли связь. Помоги, пожалуйста, это 10 минут:
> 1. Открой **с компьютера** ссылку: https://doodle-magic-eight.vercel.app/nettest?room=DM-1021
> 2. Впиши имя и нажми «Начать».
> 3. Не закрывай и не сворачивай вкладку 10 минут: можно просто отойти.
>
> Результат придёт мне сам: на экране будет «Результат доставлен хосту ✓». Если есть телефон с мобильным интернетом, повтори с него под тем же именем — это отдельная строка, тоже полезно. Твоя волна: в 21:00 (или в 21:15).

Цель: 5–10 человек, домашний Wi-Fi и разные мобильные операторы Узбекистана, плюс хотя бы один человек из Европы.

**Правило оценки:** сводка сама пишет «Критерий (≥ 90 % в зачёте): выполнен ✓ / не выполнен ✗». При 9 и меньше участниках 90 % означает «ни одного провала в зачёте». Строки «канал не открылся» — главный сигнал, что нужен TURN.

- [ ] **Step 2: Записать итог и решение**

Когда все закончат, владелец жмёт «Скопировать сводку» и присылает её. Из сводки заполняется `design/nettest-results.md` (имена — только инициалы: файл публичный):
```markdown
# Тест связи: результаты (дата)

## Сводка хоста
(вставить сводку, заменив имена инициалами)

## Итог
- Прошли: N из M (X %). Порог: 90 %.
- Через ретранслятор (TURN): R из M.
- Медиана p95: … мс.

## Решение для фазы 3
- [ ] **P2P как есть**: критерий выполнен, строк «канал не открылся» нет.
- [ ] **P2P плюс бесплатный TURN (Cloudflare)**: проблемы в основном — «канал не открылся» (строгий NAT).
- [ ] **Обсудить с владельцем**: зависания и обрывы у прямых соединений.
```
Отметить ровно один пункт решения и коротко написать почему.

- [ ] **Step 3: Коммит**

```bash
git add design/nettest-results.md
git commit -m "docs: nettest results and network decision" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
`git push` — только с подтверждения владельца.

---

## После фазы 0
1. По решению из `design/nettest-results.md` уточнить фазу 3 в [дорожной карте](2026-10-17-prototype-roadmap.md).
2. Написать подробный план фазы 1 (оффлайн-песочница) в том же формате.
