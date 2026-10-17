# Фаза 0: каркас и тест связи. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** До игрового кода проверить, держит ли связь у владельца и его друзей (Узбекистан и Европа), и поднять весь конвейер: монорепо, тесты, сервер на Cloudflare, клиент на Vercel.

**Architecture:** pnpm-монорепо из трёх пакетов.
- `packages/protocol` — общие типы сообщений и чистые функции; одинаково работает на клиенте и сервере.
- `apps/server` — Cloudflare Worker с двумя Durable Objects:
  - `RoomDO` отвечает на пинги и шлёт поток «снапшотов» 20 раз/с, как будущая игра;
  - `ReportsDO` хранит отправленные результаты.
- `apps/client` — Vite-страница `/nettest`. Она 10 минут гоняет игровой трафик, считает пинг, зависания, обрывы и потери, параллельно проверяет P2P через PeerJS, выносит вердикт и отправляет отчёт.

**Tech Stack:** Node 24, pnpm 12.14, TypeScript 7, Vitest 5, Vite 8, wrangler 4.151 (Workers + Durable Objects на SQLite), PeerJS 1.5.5.

## Global Constraints
- Фронтенд — Vercel (тариф Hobby, некоммерческий); сервер — Cloudflare Workers + Durable Objects (SQLite-классы, бесплатный тариф).
- Язык — TypeScript (strict); монорепо pnpm: `apps/*`, `packages/*`; область имён пакетов `@doodlemagic/*`.
- Критерий теста связи: 9 из 10 играют 10 минут без зависаний, пинг p95 ≤ 120 мс.
- Интерфейс на русском языке.
- Исходники Doodle District в репозиторий не попадают: `research/doodle-district/source/` в `.gitignore`. Сырые результаты теста (имена друзей) тоже не публикуются: `design/nettest/` в `.gitignore`.
- Код комнаты — символы `[A-Z0-9_-]`, до 32 знаков.
- Сервер ограничивает одну сессию 15 минутами.
- Ключ `REPORTS_KEY` никогда не попадает в репозиторий.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Шаги с пометкой **👤 Владелец** требуют действий человека: вход в аккаунты, браузер, подтверждение `git push`.

## Карта файлов

| Файл | Отвечает за |
|---|---|
| `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts` | Корень монорепо: зависимости, общие настройки TS, запуск всех тестов |
| `packages/protocol/src/nettest.ts` | Сообщения теста связи, разбор входящих, ответы `pong` / `welcome`, снапшот, разбор `colo` |
| `packages/protocol/src/index.ts` | Публичный вход пакета |
| `apps/server/wrangler.jsonc` | Worker, привязки DO, миграция SQLite-классов |
| `apps/server/src/index.ts` | Роутер: `/room/:code` (WebSocket), `/report`, `/reports`, `/health` |
| `apps/server/src/RoomDO.ts` | Одна комната: эхо-пинги, поток снапшотов 20 Гц, лимит 15 минут |
| `apps/server/src/ReportsDO.ts` | Хранение отчётов |
| `apps/server/src/env.ts` | Тип окружения Worker |
| `apps/server/scripts/smoke.mjs` | Дымовой тест сервера (локально и в проде) |
| `apps/client/src/config.ts` | Адрес сервера, преобразование `ws`→`http`, очистка кода комнаты |
| `apps/client/src/nettest/stats.ts` | Чистая статистика: перцентили, зависания, потери, вердикт, текст отчёта |
| `apps/client/src/nettest/runner.ts` | Сессия WebSocket: пинги, приём, переподключение, учёт скрытой вкладки |
| `apps/client/src/nettest/webrtc.ts` | Проверка P2P через PeerJS |
| `apps/client/src/nettest/page.ts` | Интерфейс страницы теста |
| `apps/client/src/main.ts`, `index.html`, `src/style.css`, `vercel.json` | Точка входа, маршрут `/nettest`, стили, SPA-перезапись на Vercel |
| `tools/summarize-nettest.ts` | Сводка собранных отчётов в терминале |
| `design/nettest-results.md` | Итог теста и решение: Cloudflare или P2P |

---

### Task 1: Монорепо, git и протокол теста связи

**Files:**
- Create: `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/src/index.ts`, `packages/protocol/src/nettest.ts`
- Test: `packages/protocol/src/nettest.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces (импорт из `@doodlemagic/protocol`):
  - константы `NETTEST_VERSION = 1`, `SNAPSHOT_HZ = 20`, `SNAPSHOT_PAD_BYTES = 800`, `MAX_NAME_LEN = 24`;
  - типы `ClientMsg`, `PingMsg`, `HelloMsg`, `ServerMsg`, `RoomInfo { room; edge; roomColo; peers }`;
  - `parseClientMsg(raw: string | null): ClientMsg | null`;
  - `pong(msg: PingMsg, now: number): ServerMsg`;
  - `welcome(msg: HelloMsg, info: RoomInfo): ServerMsg`;
  - `makeSnapshot(n: number, now: number): ServerMsg`;
  - `parseTraceColo(trace: string): string`.

- [ ] **Step 1: Установить pnpm**

Run: `npm install -g pnpm@12.14.0` и затем `pnpm -v`
Expected: `12.14.0`

- [ ] **Step 2: Создать git-репозиторий и привязать GitHub**

В папке `D:\Claude Code\MagicGG`:
```bash
git init -b main
git remote add origin https://github.com/HermesOG/DoodleMagic.git
```
Expected: `git remote -v` показывает `origin https://github.com/HermesOG/DoodleMagic.git`.

- [ ] **Step 3: Создать корневые файлы**

`.gitignore`:
```gitignore
node_modules/
dist/
.wrangler/
.dev.vars
.vercel/
*.log
.DS_Store
# чужой исходник только для локального изучения — не публикуем
research/doodle-district/source/
# сырые результаты теста связи с именами друзей — не публикуем
design/nettest/
```

`package.json`:
```json
{
  "name": "doodlemagic",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.14.0",
  "scripts": {
    "test": "vitest run",
    "typecheck": "pnpm -r --if-present typecheck",
    "dev:client": "pnpm --filter @doodlemagic/client dev",
    "dev:server": "pnpm --filter @doodlemagic/server dev",
    "build:client": "pnpm --filter @doodlemagic/client build",
    "smoke": "node apps/server/scripts/smoke.mjs"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Поставить общие dev-зависимости**

Run: `pnpm add -D -w typescript vitest`
Expected: в `package.json` появились `devDependencies` с `typescript` 7.x и `vitest` 5.x, создан `pnpm-lock.yaml`. Если pnpm пишет «Ignored build scripts», выполнить `pnpm approve-builds` и одобрить перечисленные пакеты.

- [ ] **Step 5: Создать пакет `protocol`**

`packages/protocol/package.json`:
```json
{
  "name": "@doodlemagic/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p ." }
}
```

`packages/protocol/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/protocol/src/index.ts`:
```ts
export * from "./nettest";
```

- [ ] **Step 6: Написать падающий тест**

`packages/protocol/src/nettest.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  MAX_NAME_LEN,
  NETTEST_VERSION,
  SNAPSHOT_PAD_BYTES,
  makeSnapshot,
  parseClientMsg,
  parseTraceColo,
  pong,
  welcome,
} from "./nettest";

const info = { room: "FRIENDS", edge: "TAS", roomColo: "FRA", peers: 2 };

describe("parseClientMsg", () => {
  it("accepts a valid ping", () => {
    expect(parseClientMsg('{"t":"ping","seq":7,"ct":123.5}')).toEqual({ t: "ping", seq: 7, ct: 123.5 });
  });

  it("trims and truncates the hello name", () => {
    const raw = JSON.stringify({ t: "hello", v: 1, name: `  ${"a".repeat(40)}  ` });
    expect(parseClientMsg(raw)).toEqual({ t: "hello", v: 1, name: "a".repeat(MAX_NAME_LEN) });
  });

  it.each([
    ["broken json", "{"],
    ["null literal", "null"],
    ["unknown type", '{"t":"boom"}'],
    ["negative seq", '{"t":"ping","seq":-1,"ct":1}'],
    ["fractional seq", '{"t":"ping","seq":1.5,"ct":1}'],
    ["string ct", '{"t":"ping","seq":1,"ct":"1"}'],
    ["hello without name", '{"t":"hello","v":1}'],
  ])("rejects %s", (_label, raw) => {
    expect(parseClientMsg(raw)).toBeNull();
  });

  it("rejects null and oversized input", () => {
    expect(parseClientMsg(null)).toBeNull();
    expect(parseClientMsg("x".repeat(2000))).toBeNull();
  });
});

describe("pong", () => {
  it("echoes seq and client time and adds server time", () => {
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

  it("asks an outdated client to reload", () => {
    expect(welcome({ t: "hello", v: 999, name: "x" }, info)).toEqual({ t: "error", reason: "обновите страницу" });
  });
});

describe("makeSnapshot", () => {
  it("pads the snapshot to emulate game traffic", () => {
    const snap = makeSnapshot(4, 1000);
    expect(snap).toMatchObject({ t: "snap", n: 4, st: 1000 });
    expect(snap.t === "snap" && snap.pad.length).toBe(SNAPSHOT_PAD_BYTES);
  });
});

describe("parseTraceColo", () => {
  it("reads the colo line", () => {
    expect(parseTraceColo("fl=1\nh=x\ncolo=FRA\nhttp=http/2\n")).toBe("FRA");
  });

  it("returns ? when the line is missing", () => {
    expect(parseTraceColo("fl=1\n")).toBe("?");
  });
});
```

- [ ] **Step 7: Убедиться, что тест падает**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "./nettest"` (модуля ещё нет).

- [ ] **Step 8: Реализовать протокол**

`packages/protocol/src/nettest.ts`:
```ts
/** Сообщения теста связи. Клиент и сервер используют один и тот же код. */
export const NETTEST_VERSION = 1;
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_PAD_BYTES = 800;
export const MAX_NAME_LEN = 24;
const MAX_MSG_BYTES = 1024;

export type PingMsg = { t: "ping"; seq: number; ct: number };
export type HelloMsg = { t: "hello"; v: number; name: string };
export type ClientMsg = PingMsg | HelloMsg;

export type ServerMsg =
  | { t: "welcome"; v: number; room: string; edge: string; roomColo: string; peers: number }
  | { t: "pong"; seq: number; ct: number; st: number }
  | { t: "snap"; n: number; st: number; pad: string }
  | { t: "error"; reason: string };

export interface RoomInfo {
  room: string;
  edge: string;
  roomColo: string;
  peers: number;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function parseClientMsg(raw: string | null): ClientMsg | null {
  if (raw === null || raw.length > MAX_MSG_BYTES) return null;
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
  return null;
}

export function pong(msg: PingMsg, now: number): ServerMsg {
  return { t: "pong", seq: msg.seq, ct: msg.ct, st: now };
}

export function welcome(msg: HelloMsg, info: RoomInfo): ServerMsg {
  if (msg.v !== NETTEST_VERSION) return { t: "error", reason: "обновите страницу" };
  return { t: "welcome", v: NETTEST_VERSION, ...info };
}

const PAD = "x".repeat(SNAPSHOT_PAD_BYTES);

/** Поток снапшотов примерно того же размера, что будут слать игровые комнаты. */
export function makeSnapshot(n: number, now: number): ServerMsg {
  return { t: "snap", n, st: now, pad: PAD };
}

/** Достаёт код дата-центра из ответа https://cloudflare.com/cdn-cgi/trace. */
export function parseTraceColo(trace: string): string {
  return /^colo=([A-Z0-9]+)$/m.exec(trace)?.[1] ?? "?";
}
```

- [ ] **Step 9: Убедиться, что тесты проходят**

Run: `pnpm test`
Expected: PASS — `Test Files  1 passed`, `Tests  16 passed`.

- [ ] **Step 10: Проверить типы**

Run: `pnpm --filter @doodlemagic/protocol typecheck`
Expected: команда завершается без ошибок.

- [ ] **Step 11: Первый коммит**

Run: `git status --short` — среди файлов **нет** `research/doodle-district/source/`.
```bash
git add .
git commit -m "chore: monorepo skeleton and nettest protocol" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
В коммит попадают и уже лежащие `design/`, `docs/`, `research/doodle-district/README.md`.

---

### Task 2: Статистика теста связи

**Files:**
- Create: `apps/client/package.json`, `apps/client/tsconfig.json`
- Create: `apps/client/src/config.ts`, `apps/client/src/nettest/stats.ts`
- Test: `apps/client/src/config.test.ts`, `apps/client/src/nettest/stats.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - из `apps/client/src/nettest/stats.ts`:
    - `CRITERIA = { maxP95Ms: 120, stallGapMs: 1000, maxStalls: 0, maxLossPct: 2, maxDisconnects: 0, maxHiddenS: 5 }`;
    - типы `RttSummary { count; p50; p95; max; jitter }`, `WsTestData { edge; roomColo; rtts: number[]; arrivals: number[]; sent; received; disconnects; hiddenMs; durationS }`, `P2pResult { role: "hub" | "peer"; connected; peers?; rtt: RttSummary | null; error? }`, `ResultMeta { name; room; ua; conn; tz }`, `NettestResult`, `Verdict { ok; reasons: string[] }`;
    - `percentile(sorted, p)`, `summarizeRtt(samples)`, `countStalls(arrivals, gapMs)`, `lossPct(sent, received)`;
    - `buildResult(d: WsTestData, meta: ResultMeta, p2p?: P2pResult): NettestResult`;
    - `judge(r: NettestResult): Verdict`;
    - `formatReport(r: NettestResult, v: Verdict): string`.
  - из `apps/client/src/config.ts`: `gameServerUrl(): string`, `httpBase(wsUrl: string): string`, `cleanRoom(raw: string | null): string`.

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
import { cleanRoom, httpBase } from "./config";

describe("httpBase", () => {
  it("maps wss to https", () => {
    expect(httpBase("wss://a.workers.dev")).toBe("https://a.workers.dev");
  });

  it("maps ws to http", () => {
    expect(httpBase("ws://localhost:8787")).toBe("http://localhost:8787");
  });
});

describe("cleanRoom", () => {
  it("uppercases and strips unsafe characters", () => {
    expect(cleanRoom("friends-1!<b>")).toBe("FRIENDS-1B");
  });

  it("falls back to FRIENDS", () => {
    expect(cleanRoom(null)).toBe("FRIENDS");
    expect(cleanRoom("!!!")).toBe("FRIENDS");
  });
});
```

`apps/client/src/nettest/stats.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  buildResult,
  countStalls,
  formatReport,
  judge,
  lossPct,
  percentile,
  summarizeRtt,
  type ResultMeta,
  type WsTestData,
} from "./stats";

const meta: ResultMeta = { name: "Аня", room: "FRIENDS", ua: "test", conn: "4g", tz: "Asia/Tashkent" };

/** 10 минут здоровой связи: пинг 60 мс, сообщение от сервера каждые 50 мс. */
function data(over: Partial<WsTestData> = {}): WsTestData {
  return {
    edge: "TAS",
    roomColo: "FRA",
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

  it("fails when the server never answered", () => {
    expect(judge(buildResult(data({ rtts: [] }), meta)).reasons).toContain("сервер не ответил ни разу");
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

  it("describes a P2P result", () => {
    const r = buildResult(data(), meta, { role: "peer", connected: true, rtt: summarizeRtt([40, 42]) });
    expect(formatReport(r, judge(r))).toContain("P2P: напрямую, p50 40 мс");
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "./config"` и `"./stats"`.

- [ ] **Step 4: Реализовать `config.ts`**

`apps/client/src/config.ts`:
```ts
/** Адрес игрового сервера: ?server=… в ссылке, иначе VITE_GAME_SERVER при сборке, иначе локальный wrangler. */
export function gameServerUrl(): string {
  const fromQuery = new URLSearchParams(location.search).get("server");
  const fromEnv = import.meta.env.VITE_GAME_SERVER as string | undefined;
  return (fromQuery || fromEnv || "ws://localhost:8787").replace(/\/+$/, "");
}

export function httpBase(wsUrl: string): string {
  return wsUrl.replace(/^ws(s?):\/\//, "http$1://");
}

export function cleanRoom(raw: string | null): string {
  const room = (raw ?? "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  return room || "FRIENDS";
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

export interface RttSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
  jitter: number;
}

/** Сырые данные одного прогона WebSocket-теста. Время — performance.now() в мс. */
export interface WsTestData {
  edge: string;
  roomColo: string;
  rtts: number[];
  arrivals: number[];
  sent: number;
  received: number;
  disconnects: number;
  hiddenMs: number;
  durationS: number;
}

export interface P2pResult {
  role: "hub" | "peer";
  connected: boolean;
  peers?: number;
  rtt: RttSummary | null;
  error?: string;
}

export interface ResultMeta {
  name: string;
  room: string;
  ua: string;
  conn: string;
  tz: string;
}

export interface NettestResult extends ResultMeta {
  v: 1;
  edge: string;
  roomColo: string;
  durationS: number;
  rtt: RttSummary;
  sent: number;
  received: number;
  lossPct: number;
  stalls: number;
  worstGapMs: number;
  disconnects: number;
  hiddenS: number;
  p2p?: P2pResult;
}

export interface Verdict {
  ok: boolean;
  reasons: string[];
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

export function buildResult(d: WsTestData, meta: ResultMeta, p2p?: P2pResult): NettestResult {
  const { stalls, worstGapMs } = countStalls(d.arrivals, CRITERIA.stallGapMs);
  const result: NettestResult = {
    v: 1,
    ...meta,
    edge: d.edge,
    roomColo: d.roomColo,
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
  if (p2p) result.p2p = p2p;
  return result;
}

export function judge(r: NettestResult): Verdict {
  const reasons: string[] = [];
  if (r.rtt.count === 0) reasons.push("сервер не ответил ни разу");
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

function describeP2p(p: P2pResult, ms: (x: number) => string): string {
  if (p.role === "hub") return `точка сбора, подключилось ${p.peers ?? 0}`;
  if (p.connected) return `напрямую, p50 ${ms(p.rtt?.p50 ?? Number.NaN)}`;
  return `не соединилось${p.error ? ` (${p.error})` : ""}`;
}

export function formatReport(r: NettestResult, v: Verdict): string {
  const ms = (x: number) => (Number.isNaN(x) ? "—" : `${Math.round(x)} мс`);
  const lines = [
    `DoodleMagic · тест связи · ${v.ok ? "OK" : "ПРОБЛЕМЫ"}`,
    `Имя: ${r.name || "—"} · комната ${r.room} · ${r.durationS} с`,
    `Сервер: вход ${r.edge}, комната ${r.roomColo}`,
    `Пинг: p50 ${ms(r.rtt.p50)}, p95 ${ms(r.rtt.p95)}, макс ${ms(r.rtt.max)}, джиттер ${ms(r.rtt.jitter)}`,
    `Потери ${r.lossPct.toFixed(1)}% · зависаний ${r.stalls} · обрывов ${r.disconnects}`,
  ];
  if (r.p2p) lines.push(`P2P: ${describeP2p(r.p2p, ms)}`);
  for (const reason of v.reasons) lines.push(`• ${reason}`);
  return lines.join("\n");
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `pnpm test`
Expected: PASS — `Test Files  3 passed`, все тесты зелёные.

- [ ] **Step 7: Проверить типы**

Run: `pnpm --filter @doodlemagic/client typecheck`
Expected: без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add apps/client pnpm-lock.yaml
git commit -m "feat(client): nettest statistics and verdict" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Сервер: Worker, комната и хранилище отчётов

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/wrangler.jsonc`, `apps/server/.dev.vars`
- Create: `apps/server/src/env.ts`, `apps/server/src/index.ts`, `apps/server/src/RoomDO.ts`, `apps/server/src/ReportsDO.ts`
- Test: `apps/server/scripts/smoke.mjs`

**Interfaces:**
- Consumes: `parseClientMsg`, `pong`, `welcome`, `makeSnapshot`, `parseTraceColo`, `SNAPSHOT_HZ` из `@doodlemagic/protocol` (Task 1).
- Produces (HTTP API, им пользуются Task 4–7):
  - `GET /health` → `{"ok":true}`;
  - `GET /room/:code` с `Upgrade: websocket`:
    - клиент шлёт `hello` и `ping`;
    - сервер шлёт `welcome` с полями `edge` (дата-центр входа) и `roomColo` (где живёт комната), `pong` на каждый пинг и `snap` 20 раз/с;
  - `POST /report` с JSON до 8 КБ → `{"ok":true,"id":"…"}`;
  - `GET /reports?key=<REPORTS_KEY>` → массив `{ id, at, country, data }`; с неверным ключом — 403.

- [ ] **Step 1: Создать пакет сервера**

`apps/server/package.json`:
```json
{
  "name": "@doodlemagic/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --port 8787",
    "deploy": "wrangler deploy",
    "types": "wrangler types",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@doodlemagic/protocol": "workspace:*"
  }
}
```

Run: `pnpm --filter @doodlemagic/server add -D wrangler`
Expected: в `apps/server/package.json` появился `wrangler` 4.x.

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": []
  },
  "include": ["src", "worker-configuration.d.ts"]
}
```

`apps/server/wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "doodlemagic-server",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-01",
  "durable_objects": {
    "bindings": [
      { "name": "ROOMS", "class_name": "RoomDO" },
      { "name": "REPORTS", "class_name": "ReportsDO" }
    ]
  },
  // на бесплатном тарифе Durable Objects бывают только SQLite-классы
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomDO", "ReportsDO"] }]
}
```

`apps/server/.dev.vars` (в git не попадает):
```
REPORTS_KEY=dev
```

- [ ] **Step 2: Написать дымовой тест**

`apps/server/scripts/smoke.mjs`:
```js
// Дымовой тест сервера. Запуск: node apps/server/scripts/smoke.mjs [ws-адрес] [REPORTS_KEY]
const wsBase = (process.argv[2] ?? "ws://localhost:8787").replace(/\/+$/, "");
const key = process.argv[3] ?? "dev";
const httpBase = wsBase.replace(/^ws(s?):\/\//, "http$1://");

function checkRoom() {
  return new Promise((resolve) => {
    const got = { welcome: null, pongs: 0, snaps: 0, error: null };
    const ws = new WebSocket(`${wsBase}/room/SMOKE`);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ t: "hello", v: 1, name: "smoke" }));
      for (let i = 0; i < 10; i++) ws.send(JSON.stringify({ t: "ping", seq: i, ct: performance.now() }));
    });
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.t === "welcome") got.welcome = m;
      else if (m.t === "pong") got.pongs++;
      else if (m.t === "snap") got.snaps++;
    });
    ws.addEventListener("error", () => {
      got.error = "websocket error";
    });
    setTimeout(() => {
      ws.close();
      resolve(got);
    }, 2000);
  });
}

const room = await checkRoom();
console.log("room:", JSON.stringify(room));

let reportOk = false;
try {
  const post = await fetch(`${httpBase}/report`, { method: "POST", body: JSON.stringify({ smoke: true, at: Date.now() }) });
  const list = await fetch(`${httpBase}/reports?key=${encodeURIComponent(key)}`).then((r) => r.json());
  reportOk = post.ok && Array.isArray(list) && list.some((x) => x?.data?.smoke === true);
  console.log("report:", post.status, "stored:", Array.isArray(list) ? list.length : JSON.stringify(list));
} catch (e) {
  console.log("report: request failed", String(e));
}

const ok = room.welcome !== null && room.pongs === 10 && room.snaps >= 20 && reportOk;
console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
process.exit(ok ? 0 : 1);
```

- [ ] **Step 3: Убедиться, что дымовой тест падает**

Run: `pnpm smoke` (сервер ещё не запущен)
Expected: `SMOKE FAIL` и код выхода 1.

- [ ] **Step 4: Реализовать окружение и роутер**

`apps/server/src/env.ts`:
```ts
import type { ReportsDO } from "./ReportsDO";
import type { RoomDO } from "./RoomDO";

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  REPORTS: DurableObjectNamespace<ReportsDO>;
  REPORTS_KEY?: string;
}
```

`apps/server/src/index.ts`:
```ts
import type { Env } from "./env";
import { ReportsDO } from "./ReportsDO";
import { RoomDO } from "./RoomDO";

export { ReportsDO, RoomDO };

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const ROOM_RE = /^\/room\/([A-Za-z0-9_-]{1,32})$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function withCors(res: Response): Response {
  return new Response(res.body, {
    status: res.status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

const cfField = (req: Request, field: "colo" | "country"): string =>
  String((req.cf as unknown as Record<string, unknown> | undefined)?.[field] ?? "?");

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/health") return json({ ok: true });

    const room = ROOM_RE.exec(url.pathname)?.[1]?.toUpperCase();
    if (room) {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const headers = new Headers(req.headers);
      headers.set("x-room", room);
      headers.set("x-edge-colo", cfField(req, "colo"));
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      return stub.fetch(new Request(req, { headers }));
    }

    if (url.pathname === "/report" && req.method === "POST") {
      const stub = env.REPORTS.get(env.REPORTS.idFromName("all"));
      const res = await stub.fetch(
        new Request("https://reports/add", {
          method: "POST",
          headers: { "x-country": cfField(req, "country") },
          body: await req.text(),
        }),
      );
      return withCors(res);
    }

    if (url.pathname === "/reports" && req.method === "GET") {
      if (!env.REPORTS_KEY || url.searchParams.get("key") !== env.REPORTS_KEY) return json({ error: "forbidden" }, 403);
      const stub = env.REPORTS.get(env.REPORTS.idFromName("all"));
      return withCors(await stub.fetch(new Request("https://reports/list")));
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Реализовать комнату**

`apps/server/src/RoomDO.ts`:
```ts
import { DurableObject } from "cloudflare:workers";
import { SNAPSHOT_HZ, makeSnapshot, parseClientMsg, parseTraceColo, pong, welcome } from "@doodlemagic/protocol";
import type { Env } from "./env";

/** Защита от забытых вкладок: одна сессия не дольше 15 минут. */
const MAX_SESSION_MS = 15 * 60 * 1000;

export class RoomDO extends DurableObject<Env> {
  private peers = 0;
  private colo: Promise<string> | null = null;

  async fetch(req: Request): Promise<Response> {
    // Где физически живёт комната — узнаём один раз на экземпляр объекта.
    this.colo ??= fetch("https://cloudflare.com/cdn-cgi/trace")
      .then((r) => r.text())
      .then(parseTraceColo)
      .catch(() => "?");
    const room = req.headers.get("x-room") ?? "?";
    const edge = req.headers.get("x-edge-colo") ?? "?";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.peers++;

    const send = (msg: unknown) => {
      try {
        server.send(JSON.stringify(msg));
      } catch {
        // сокет уже закрыт
      }
    };
    let n = 0;
    const snapTimer = setInterval(() => send(makeSnapshot(n++, Date.now())), 1000 / SNAPSHOT_HZ);
    const limitTimer = setTimeout(() => server.close(4000, "time limit"), MAX_SESSION_MS);
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(snapTimer);
      clearTimeout(limitTimer);
      this.peers--;
    };

    server.addEventListener("message", (ev) => {
      const msg = parseClientMsg(typeof ev.data === "string" ? ev.data : null);
      if (!msg) {
        send({ t: "error", reason: "bad message" });
        return;
      }
      if (msg.t === "ping") {
        send(pong(msg, Date.now()));
        return;
      }
      void this.colo!.then((roomColo) => send(welcome(msg, { room, edge, roomColo, peers: this.peers })));
    });
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }
}
```

- [ ] **Step 6: Реализовать хранилище отчётов**

`apps/server/src/ReportsDO.ts`:
```ts
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

const MAX_REPORT_BYTES = 8192;

export class ReportsDO extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/add" && req.method === "POST") {
      const text = await req.text();
      if (text.length > MAX_REPORT_BYTES) return Response.json({ error: "too large" }, { status: 413 });
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return Response.json({ error: "bad json" }, { status: 400 });
      }
      const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await this.ctx.storage.put(`r:${id}`, {
        id,
        at: new Date().toISOString(),
        country: req.headers.get("x-country") ?? "?",
        data,
      });
      return Response.json({ ok: true, id });
    }
    if (url.pathname === "/list") {
      const all = await this.ctx.storage.list({ prefix: "r:" });
      return Response.json([...all.values()]);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
```

- [ ] **Step 7: Сгенерировать типы Workers и проверить типы**

Run: `pnpm --filter @doodlemagic/server types` и затем `pnpm --filter @doodlemagic/server typecheck`
Expected: создан `apps/server/worker-configuration.d.ts`; проверка типов без ошибок.

- [ ] **Step 8: Запустить сервер и прогнать дымовой тест**

В отдельном терминале: `pnpm dev:server`
Expected в нём: `Ready on http://localhost:8787`.

Run: `pnpm smoke`
Expected:
```
room: {"welcome":{"t":"welcome","v":1,"room":"SMOKE",...},"pongs":10,"snaps":38,"error":null}
report: 200 stored: 1
SMOKE OK
```
(`snaps` около 40, `edge` и `roomColo` локально могут быть `?`.)

- [ ] **Step 9: Коммит**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): nettest room and reports durable objects" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Страница теста связи `/nettest`

**Files:**
- Create: `apps/client/index.html`, `apps/client/vercel.json`
- Create: `apps/client/src/main.ts`, `apps/client/src/style.css`
- Create: `apps/client/src/nettest/runner.ts`, `apps/client/src/nettest/page.ts`

**Interfaces:**
- Consumes: из `@doodlemagic/protocol` — `NETTEST_VERSION` и тип `ServerMsg` (Task 1); из `stats.ts` и `config.ts` — всё, что перечислено в Task 2; HTTP API сервера (Task 3).
- Produces:
  - `runWsTest(o: RunWsOptions): Promise<WsTestData>`, где `RunWsOptions = { url; room; name; durationS; onTick?(data, connected) }`;
  - `mountNettest(root: HTMLElement): void`;
  - маршрут `/nettest?room=КОД[&dur=секунды][&server=wss://…]`.

- [ ] **Step 1: Точка входа и стили**

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
      <p><a class="btn" href="/nettest">Проверить связь</a></p>
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
h2 { margin: 0 0 12px; font-size: 22px; }
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
  white-space: pre-wrap; background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; padding: 12px; font-size: 14px;
}
.ok { color: var(--good); }
.bad { color: var(--accent); }
```

- [ ] **Step 2: Сессия WebSocket**

`apps/client/src/nettest/runner.ts`:
```ts
import { NETTEST_VERSION, type ServerMsg } from "@doodlemagic/protocol";
import type { WsTestData } from "./stats";

/** Как будущая игра: 30 пакетов ввода в секунду вверх, снапшоты 20 раз в секунду вниз. */
export const PING_HZ = 30;
export const RECONNECT_DELAY_MS = 1000;
/** Пинги последних 2 с без ответа не считаем потерянными: ответ мог не успеть прийти. */
export const LOSS_GRACE_MS = 2000;
const TICK_MS = 250;

export interface RunWsOptions {
  url: string;
  room: string;
  name: string;
  durationS: number;
  onTick?: (data: Readonly<WsTestData>, connected: boolean) => void;
}

export function runWsTest(o: RunWsOptions): Promise<WsTestData> {
  return new Promise((resolve) => {
    const data: WsTestData = {
      edge: "?",
      roomColo: "?",
      rtts: [],
      arrivals: [],
      sent: 0,
      received: 0,
      disconnects: 0,
      hiddenMs: 0,
      durationS: 0,
    };
    const start = performance.now();
    const endAt = start + o.durationS * 1000;
    const sentAt = new Map<number, number>();
    let seq = 0;
    let ws: WebSocket | null = null;
    let connected = false;
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

    const connect = () => {
      const sock = new WebSocket(`${o.url}/room/${encodeURIComponent(o.room)}`);
      ws = sock;
      let opened = false;
      sock.addEventListener("open", () => {
        opened = true;
        connected = true;
        sock.send(JSON.stringify({ t: "hello", v: NETTEST_VERSION, name: o.name }));
      });
      sock.addEventListener("message", (ev) => {
        const now = performance.now();
        data.arrivals.push(now);
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg.t === "welcome") {
          data.edge = msg.edge;
          data.roomColo = msg.roomColo;
        } else if (msg.t === "pong") {
          const t0 = sentAt.get(msg.seq);
          if (t0 !== undefined) {
            sentAt.delete(msg.seq);
            data.rtts.push(now - t0);
          }
        }
      });
      sock.addEventListener("close", () => {
        if (finished) return;
        connected = false;
        // обрыв — это потеря уже открытого соединения; неудачные попытки переподключения не считаем
        if (opened) data.disconnects++;
        if (performance.now() < endAt) setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };

    const pingTimer = setInterval(() => {
      if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
      const s = seq++;
      const t = performance.now();
      sentAt.set(s, t);
      ws.send(JSON.stringify({ t: "ping", seq: s, ct: t }));
    }, 1000 / PING_HZ);

    const tickTimer = setInterval(() => {
      o.onTick?.(data, connected);
      if (performance.now() >= endAt) finish();
    }, TICK_MS);

    function finish(): void {
      if (finished) return;
      finished = true;
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
      ws?.close(1000, "done");
      resolve(data);
    }

    connect();
  });
}
```

- [ ] **Step 3: Интерфейс страницы**

`apps/client/src/nettest/page.ts`:
```ts
import { cleanRoom, gameServerUrl, httpBase } from "../config";
import { runWsTest } from "./runner";
import { CRITERIA, buildResult, countStalls, formatReport, judge, summarizeRtt, type ResultMeta } from "./stats";

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

const fmtMs = (x: number | null): string => (x === null || Number.isNaN(x) ? "—" : `${Math.round(x)} мс`);
const fmtClock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const connType = (): string =>
  (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? "?";

export function mountNettest(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const room = cleanRoom(params.get("room"));
  const server = gameServerUrl();
  const debugDur = Number(params.get("dur"));

  root.innerHTML = `
    <section class="card">
      <h1>Тест связи</h1>
      <p class="muted">Проверяем, потянет ли твой интернет онлайн-игру DoodleMagic. Тест идёт 10 минут: не закрывай и не сворачивай вкладку, не давай компьютеру уснуть.</p>
      <label>Как тебя зовут <input id="nt-name" maxlength="24" autocomplete="nickname" placeholder="Например, Аня" /></label>
      <label>Длительность <select id="nt-dur"></select></label>
      <p class="muted small">Комната: <b id="nt-room"></b></p>
      <button id="nt-start" class="btn" type="button">Начать</button>
    </section>
    <section class="card" id="nt-live" hidden>
      <div class="grid">
        <div><span class="k">Прошло</span><b id="nt-elapsed">0:00</b></div>
        <div><span class="k">Пинг сейчас</span><b id="nt-last">—</b></div>
        <div><span class="k">Пинг p95</span><b id="nt-p95">—</b></div>
        <div><span class="k">Зависания</span><b id="nt-stalls">0</b></div>
      </div>
      <p class="muted small" id="nt-status">Подключаемся…</p>
    </section>
    <section class="card" id="nt-result" hidden>
      <h2 id="nt-verdict"></h2>
      <pre id="nt-report"></pre>
      <p class="muted small" id="nt-sent"></p>
      <button id="nt-copy" class="btn secondary" type="button">Скопировать результат</button>
    </section>`;

  const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const node = root.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`missing #${id}`);
    return node;
  };
  const nameInput = el<HTMLInputElement>("nt-name");
  const durSelect = el<HTMLSelectElement>("nt-dur");
  const startBtn = el<HTMLButtonElement>("nt-start");

  el("nt-room").textContent = room;
  nameInput.value = safeGet(NAME_KEY) ?? "";
  const durations: Array<[number, string]> = [
    [600, "10 минут — полный тест"],
    [180, "3 минуты — быстрая проверка"],
  ];
  if (Number.isFinite(debugDur) && debugDur > 0) durations.unshift([debugDur, `${debugDur} с — отладка`]);
  for (const [seconds, label] of durations) durSelect.add(new Option(label, String(seconds)));

  startBtn.addEventListener("click", () => {
    void run();
  });

  async function run(): Promise<void> {
    const name = nameInput.value.trim().slice(0, 24);
    safeSet(NAME_KEY, name);
    startBtn.disabled = true;
    nameInput.disabled = true;
    durSelect.disabled = true;
    el("nt-live").hidden = false;

    let wake: WakeLockSentinel | null = null;
    try {
      wake = await navigator.wakeLock.request("screen");
    } catch {
      wake = null;
    }

    const started = performance.now();
    let lastSummaryAt = 0;
    const data = await runWsTest({
      url: server,
      room,
      name,
      durationS: Number(durSelect.value),
      onTick: (d, connected) => {
        const now = performance.now();
        el("nt-elapsed").textContent = fmtClock((now - started) / 1000);
        el("nt-last").textContent = fmtMs(d.rtts.at(-1) ?? null);
        el("nt-status").textContent = connected
          ? `Связь есть · вход ${d.edge}, комната ${d.roomColo}`
          : "Связь потеряна, переподключаемся…";
        if (now - lastSummaryAt > 1000) {
          lastSummaryAt = now;
          el("nt-p95").textContent = fmtMs(summarizeRtt(d.rtts).p95);
          el("nt-stalls").textContent = String(countStalls(d.arrivals, CRITERIA.stallGapMs).stalls);
        }
      },
    });

    await wake?.release().catch(() => undefined);
    const meta: ResultMeta = {
      name,
      room,
      ua: navigator.userAgent.slice(0, 160),
      conn: connType(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const result = buildResult(data, meta);
    const verdict = judge(result);
    const text = formatReport(result, verdict);

    const verdictEl = el("nt-verdict");
    verdictEl.textContent = verdict.ok ? "Связь в порядке ✓" : "Есть проблемы";
    verdictEl.className = verdict.ok ? "ok" : "bad";
    el("nt-report").textContent = text;
    el("nt-result").hidden = false;
    el("nt-copy").addEventListener("click", () => {
      void navigator.clipboard.writeText(text).then(
        () => {
          el("nt-copy").textContent = "Скопировано ✓";
        },
        () => {
          el("nt-copy").textContent = "Не вышло — выдели текст вручную";
        },
      );
    });

    const sentLine = el("nt-sent");
    sentLine.textContent = "Отправляем результат…";
    try {
      const res = await fetch(`${httpBase(server)}/report`, { method: "POST", body: JSON.stringify(result) });
      sentLine.textContent = res.ok
        ? "Результат отправлен организатору ✓"
        : `Не удалось отправить (код ${res.status}) — скопируй текст и пришли в чат`;
    } catch {
      sentLine.textContent = "Не удалось отправить — скопируй текст и пришли в чат";
    }
  }
}
```

- [ ] **Step 4: Проверить типы и тесты**

Run: `pnpm --filter @doodlemagic/client typecheck` и `pnpm test`
Expected: без ошибок типов; все тесты зелёные, как после Task 2.

- [ ] **Step 5: Проверить страницу вживую против локального сервера**

1. Терминал 1: `pnpm dev:server` → `Ready on http://localhost:8787`.
2. Терминал 2: `pnpm dev:client` → `Local: http://localhost:5173/`.
3. Открыть `http://localhost:5173/nettest?room=LOCAL&dur=20`, выбрать «20 с — отладка», ввести имя, нажать «Начать».

Expected:
- во время теста «Пинг сейчас» — единицы мс, «Зависания» — 0, статус «Связь есть»;
- через 20 с: «Связь в порядке ✓», текст отчёта, строка «Результат отправлен организатору ✓»;
- `curl "http://localhost:8787/reports?key=dev"` показывает запись с этим именем.

Затем остановить сервер (Ctrl+C в терминале 1) посреди нового 20-секундного прогона и снова запустить.
Expected: статус «Связь потеряна, переподключаемся…», затем связь возвращается; в отчёте «обрывов связи: 1» и вердикт «Есть проблемы».

- [ ] **Step 6: Проверить сборку**

Run: `pnpm build:client`
Expected: `apps/client/dist/index.html` и бандл в `dist/assets/`, без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add apps/client
git commit -m "feat(client): /nettest page with live stats and auto report" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Проверка P2P (запасной вариант сети)

P2P у владельца уже косвенно проверен: Doodle District работает у него через PeerJS. Задача добавляет проверку у каждого друга, параллельно основному тесту. Если время поджимает, задачу можно пропустить: страница работает и без неё.

**Files:**
- Create: `apps/client/src/nettest/webrtc.ts`
- Modify: `apps/client/src/nettest/page.ts` (импорт, разметка, функция `run`)

**Interfaces:**
- Consumes: `summarizeRtt` и тип `P2pResult` из `stats.ts` (Task 2); `buildResult(d, meta, p2p?)`.
- Produces: `runP2pCheck(room: string, stop: AbortSignal, onStatus: (s: string) => void): Promise<P2pResult>`, `hubId(room: string): string`.

Как это работает:
- **Первый, кто открыл страницу с этим `room`**, занимает PeerJS-ID `doodlemagic-nt-<room>-hub` и становится точкой сбора на всё время своего теста.
- **Остальные** 20 секунд пингуют его напрямую через WebRTC, только со STUN, без TURN. Если соединение возникло, значит P2P между этой парой работает без ретранслятора.

- [ ] **Step 1: Поставить PeerJS**

Run: `pnpm --filter @doodlemagic/client add peerjs@1.5.5`
Expected: в `apps/client/package.json` в `dependencies` — `"peerjs": "1.5.5"`.

- [ ] **Step 2: Реализовать проверку**

`apps/client/src/nettest/webrtc.ts`:
```ts
import { Peer, type DataConnection } from "peerjs";
import { summarizeRtt, type P2pResult } from "./stats";

export const P2P_PING_MS = 100;
export const P2P_MEASURE_MS = 20_000;
const OPEN_TIMEOUT_MS = 12_000;
/** Только STUN: если соединение возникло, значит P2P работает без ретранслятора. */
const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }],
  },
};

type PeerError = Error & { type?: string };
type PingMsg = { t?: string; s?: number };

export function hubId(room: string): string {
  return `doodlemagic-nt-${room.toLowerCase()}-hub`;
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

function serveAsHub(hub: Peer, stop: AbortSignal, onStatus: (s: string) => void): Promise<P2pResult> {
  let peers = 0;
  onStatus("P2P: ты — точка сбора, ждём других участников…");
  hub.on("connection", (conn: DataConnection) => {
    conn.on("open", () => {
      peers++;
      onStatus(`P2P: подключилось участников — ${peers}`);
    });
    conn.on("data", (d) => {
      const m = d as PingMsg;
      if (m.t === "p") conn.send({ t: "q", s: m.s });
    });
  });
  return new Promise((resolve) => {
    const done = () => {
      hub.destroy();
      resolve({ role: "hub", connected: peers > 0, peers, rtt: null });
    };
    if (stop.aborted) done();
    else stop.addEventListener("abort", done, { once: true });
  });
}

function measureHub(me: Peer, room: string, onStatus: (s: string) => void): Promise<P2pResult> {
  return new Promise((resolve) => {
    const rtts: number[] = [];
    const sentAt = new Map<number, number>();
    let seq = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (connected: boolean, error?: string) => {
      if (done) return;
      done = true;
      clearInterval(pingTimer);
      clearTimeout(openTimer);
      me.destroy();
      resolve({
        role: "peer",
        connected,
        rtt: rtts.length > 0 ? summarizeRtt(rtts) : null,
        ...(error ? { error } : {}),
      });
    };

    onStatus("P2P: соединяемся с точкой сбора напрямую…");
    const conn = me.connect(hubId(room), { serialization: "json", reliable: false });
    openTimer = setTimeout(() => finish(false, "не соединилось напрямую за 12 с"), OPEN_TIMEOUT_MS);
    conn.on("open", () => {
      clearTimeout(openTimer);
      onStatus("P2P: соединились напрямую, меряем…");
      pingTimer = setInterval(() => {
        const s = seq++;
        sentAt.set(s, performance.now());
        conn.send({ t: "p", s });
      }, P2P_PING_MS);
      setTimeout(() => {
        onStatus("P2P: готово");
        finish(true);
      }, P2P_MEASURE_MS);
    });
    conn.on("data", (d) => {
      const m = d as PingMsg;
      if (m.t !== "q" || typeof m.s !== "number") return;
      const t0 = sentAt.get(m.s);
      if (t0 === undefined) return;
      sentAt.delete(m.s);
      rtts.push(performance.now() - t0);
    });
    conn.on("error", (e) => finish(false, String((e as PeerError).type ?? e)));
  });
}

export async function runP2pCheck(room: string, stop: AbortSignal, onStatus: (s: string) => void): Promise<P2pResult> {
  try {
    const hub = await openPeer(hubId(room));
    return await serveAsHub(hub, stop, onStatus);
  } catch (e) {
    const err = e as PeerError;
    if (err.type !== "unavailable-id") {
      onStatus("P2P: сервер сигналинга недоступен");
      return { role: "peer", connected: false, rtt: null, error: err.type ?? err.message };
    }
  }
  try {
    const me = await openPeer(null);
    return await measureHub(me, room, onStatus);
  } catch (e) {
    const err = e as PeerError;
    onStatus("P2P: не удалось начать проверку");
    return { role: "peer", connected: false, rtt: null, error: err.type ?? err.message };
  }
}
```

- [ ] **Step 3: Подключить проверку к странице**

В `apps/client/src/nettest/page.ts`:

1. Заменить строку
```ts
import { runWsTest } from "./runner";
```
на
```ts
import { runWsTest } from "./runner";
import { runP2pCheck } from "./webrtc";
```

2. Заменить строку
```html
      <p class="muted small" id="nt-status">Подключаемся…</p>
```
на
```html
      <p class="muted small" id="nt-status">Подключаемся…</p>
      <p class="muted small" id="nt-p2p">P2P: готовимся…</p>
```

3. Заменить строку
```ts
    const started = performance.now();
```
на
```ts
    const stopP2p = new AbortController();
    const p2pPromise = runP2pCheck(room, stopP2p.signal, (s) => {
      el("nt-p2p").textContent = s;
    });
    const started = performance.now();
```

4. Заменить строку
```ts
    await wake?.release().catch(() => undefined);
```
на
```ts
    stopP2p.abort();
    const p2p = await p2pPromise;
    await wake?.release().catch(() => undefined);
```

5. Заменить строку
```ts
    const result = buildResult(data, meta);
```
на
```ts
    const result = buildResult(data, meta, p2p);
```

- [ ] **Step 4: Проверить типы и тесты**

Run: `pnpm --filter @doodlemagic/client typecheck` и `pnpm test`
Expected: без ошибок; все тесты зелёные.

- [ ] **Step 5: Проверить вживую на двух вкладках**

При запущенных `pnpm dev:server` и `pnpm dev:client`:
- вкладка A: `http://localhost:5173/nettest?room=P2PLOCAL&dur=40`, нажать «Начать»;
- через несколько секунд вкладка B (лучше другой браузер): тот же адрес, «Начать».

Expected:
- A показывает «P2P: ты — точка сбора…», затем «подключилось участников — 1»;
- B показывает «P2P: соединились напрямую, меряем…», затем «P2P: готово»;
- в отчёте B есть строка «P2P: напрямую, p50 … мс», в отчёте A — «P2P: точка сбора, подключилось 1».

- [ ] **Step 6: Коммит**

```bash
git add apps/client pnpm-lock.yaml
git commit -m "feat(client): P2P reachability check via PeerJS" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Деплой: Cloudflare, GitHub, Vercel

**Files:**
- Modify: ничего в коде. Создаются только облачные ресурсы.

**Interfaces:**
- Consumes: сервер (Task 3), клиент (Task 4–5).
- Produces: публичные адреса, которые нужны Task 7:
  - `wss://doodlemagic-server.<поддомен>.workers.dev` — сервер;
  - `https://<проект>.vercel.app/nettest` — страница теста;
  - секрет `REPORTS_KEY` хранится у владельца.

- [ ] **Step 1: 👤 Владелец: вход в Cloudflare**

Run: `pnpm --filter @doodlemagic/server exec wrangler login`
Expected: откроется браузер. Владелец входит или регистрируется в бесплатном аккаунте Cloudflare и нажимает «Allow»; в терминале — `Successfully logged in`.

- [ ] **Step 2: Задеплоить сервер**

Run: `pnpm --filter @doodlemagic/server deploy`
Expected: в выводе есть строка `https://doodlemagic-server.<поддомен>.workers.dev`. Если аккаунт новый, wrangler попросит выбрать поддомен `workers.dev` — выбрать любой. Адрес записать: дальше он `<SERVER>`.

- [ ] **Step 3: 👤 Владелец: задать ключ для чтения отчётов**

Сгенерировать ключ: `node -e "console.log(crypto.randomUUID())"` — сохранить его в менеджер паролей.
Run: `pnpm --filter @doodlemagic/server exec wrangler secret put REPORTS_KEY` и вставить ключ.
Expected: `Success! Uploaded secret REPORTS_KEY`.

- [ ] **Step 4: Дымовой тест прода**

Run: `node apps/server/scripts/smoke.mjs wss://doodlemagic-server.<поддомен>.workers.dev <REPORTS_KEY>`
Expected: `SMOKE OK`; в `welcome` поле `roomColo` — реальный код дата-центра (например, `FRA`), а не `?`.

- [ ] **Step 5: 👤 Владелец подтверждает: отправить код на GitHub**

Перед пушем проверить, что не уходит лишнее: `git ls-files | grep -E "research/doodle-district/source|\.dev\.vars|design/nettest/"` — вывод **пустой**.
Run (после явного «да» владельца): `git push -u origin main`
Expected: ветка `main` появилась на `https://github.com/HermesOG/DoodleMagic`. При запросе входа — авторизация через окно Git Credential Manager.

- [ ] **Step 6: 👤 Владелец: подключить Vercel к репозиторию**

На `https://vercel.com/new` → Import Git Repository → `HermesOG/DoodleMagic`:
- **Project Name:** `doodlemagic`;
- **Root Directory:** `apps/client`;
- **Framework Preset:** Vite (определится сам);
- **Environment Variables:**
  - `VITE_GAME_SERVER` = `wss://doodlemagic-server.<поддомен>.workers.dev`;
  - `ENABLE_EXPERIMENTAL_COREPACK` = `1` (чтобы Vercel взял pnpm 12 из `packageManager`);
- нажать **Deploy**.

Expected: деплой зелёный, адрес вида `https://doodlemagic.vercel.app`. Если имя занято, Vercel даст другое — его записать.

- [ ] **Step 7: Проверить прод целиком**

Открыть `https://<проект>.vercel.app/nettest?room=OWNER`, выбрать «3 минуты», пройти тест.
Expected: «Связь в порядке ✓» или понятные причины; «Результат отправлен организатору ✓»; в ответе `curl "<SERVER-https>/reports?key=<REPORTS_KEY>"` есть запись `OWNER`. Заодно это подтверждает, что `*.vercel.app` открывается из Узбекистана без VPN.

---

### Task 7: Тест с друзьями и решение по сети

**Files:**
- Create: `tools/summarize-nettest.ts`
- Create: `design/nettest-results.md`
- Local only (в `.gitignore`): `design/nettest/results.json`

**Interfaces:**
- Consumes: `judge` и тип `NettestResult` из `apps/client/src/nettest/stats.ts`; `GET /reports` (Task 3); адреса из Task 6.
- Produces: решение «Cloudflare или P2P» для фазы 3 в `design/nettest-results.md`.

- [ ] **Step 1: Сводка отчётов**

`tools/summarize-nettest.ts` (Node 24 запускает TypeScript напрямую):
```ts
// Сводка теста связи. Запуск: node tools/summarize-nettest.ts design/nettest/results.json
import { readFileSync } from "node:fs";
import { judge, type NettestResult } from "../apps/client/src/nettest/stats.ts";

interface Stored {
  id: string;
  at: string;
  country: string;
  data: NettestResult | { smoke: true };
}

const file = process.argv[2];
if (!file) throw new Error("укажи путь к results.json");

const rows = (JSON.parse(readFileSync(file, "utf8")) as Stored[]).filter(
  (r): r is Stored & { data: NettestResult } => (r.data as NettestResult).v === 1,
);

let passed = 0;
for (const { country, data: d } of rows) {
  const v = judge(d);
  if (v.ok) passed++;
  const p2p = !d.p2p
    ? "—"
    : d.p2p.role === "hub"
      ? `hub(${d.p2p.peers ?? 0})`
      : d.p2p.connected
        ? "p2p ok"
        : "p2p FAIL";
  console.log(
    [
      v.ok ? "OK  " : "FAIL",
      (d.name || "—").padEnd(12),
      country,
      `${d.edge}→${d.roomColo}`,
      `p50 ${Math.round(d.rtt.p50)}`,
      `p95 ${Math.round(d.rtt.p95)}`,
      `зав ${d.stalls}`,
      `обр ${d.disconnects}`,
      `пот ${d.lossPct.toFixed(1)}%`,
      `${d.durationS}с`,
      d.conn,
      p2p,
    ].join(" | "),
  );
  for (const reason of v.reasons) console.log(`       • ${reason}`);
}
const pct = rows.length > 0 ? Math.round((passed / rows.length) * 100) : 0;
console.log(`\nПрошли ${passed} из ${rows.length} (${pct}%). Порог: 90%.`);
```

Проверка на данных прода (там уже есть отчёт `OWNER` из Task 6):
```bash
mkdir -p design/nettest
curl -s "https://doodlemagic-server.<поддомен>.workers.dev/reports?key=<REPORTS_KEY>" -o design/nettest/results.json
node tools/summarize-nettest.ts design/nettest/results.json
```
Expected: строка `OK   | OWNER …` (или `FAIL` с причинами) и итог `Прошли 1 из 1 (100%)`.

- [ ] **Step 2: 👤 Владелец: разослать приглашение друзьям**

Текст для чата:
> Привет! Делаю браузерную игру и проверяю, потянет ли связь. Помоги, пожалуйста, это 10 минут:
> 1. Открой **с компьютера** ссылку: https://doodlemagic.vercel.app/nettest?room=FRIENDS
> 2. Впиши имя и нажми «Начать».
> 3. Не закрывай и не сворачивай вкладку 10 минут: можно просто отойти.
>
> Результат отправится сам. Если есть телефон с мобильным интернетом, повтори с него: это тоже полезно. Давайте начнём все примерно в одно время, например в 21:00.

Цель: 5–10 человек, домашний Wi-Fi и разные мобильные операторы Узбекистана, плюс хотя бы один человек из Европы.

- [ ] **Step 3: Собрать результаты и посмотреть сводку**

```bash
curl -s "https://doodlemagic-server.<поддомен>.workers.dev/reports?key=<REPORTS_KEY>" -o design/nettest/results.json
node tools/summarize-nettest.ts design/nettest/results.json
```
Expected: по строке на участника и итог «Прошли N из M».

- [ ] **Step 4: Записать итог и решение**

`design/nettest-results.md` (имена — только инициалы: файл публичный):
```markdown
# Тест связи: результаты (дата)

## Участники
| Кто | Страна | Сеть | Вход → комната | p50 | p95 | Зависания | Обрывы | Потери | P2P | Итог |
|---|---|---|---|---|---|---|---|---|---|---|
| (строки из сводки) |

## Итог
- Прошли: N из M (X %). Порог: 90 %.
- Где жила комната (roomColo): …; медиана p95: … мс.
- P2P: соединились напрямую K из L пар.

## Решение для фазы 3
- [ ] **Cloudflare Durable Objects**: ≥ 90 % OK и медиана p95 ≤ 120 мс.
- [ ] **P2P (хост в браузере)**: Cloudflare не прошёл, а P2P соединяется у большинства.
- [ ] **Обсудить с владельцем**: не прошло ни то, ни другое (варианты: VPS в Алматы или Франкфурте, другой регион DO).
```
Отметить ровно один пункт решения и коротко написать почему.

- [ ] **Step 5: Коммит**

```bash
git add tools/summarize-nettest.ts design/nettest-results.md
git commit -m "docs: nettest results and network decision" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
`git push` — только с подтверждения владельца.

---

## После фазы 0
1. По решению из `design/nettest-results.md` обновить фазу 3 в [дорожной карте](2026-10-17-prototype-roadmap.md).
2. Написать подробный план фазы 1 (оффлайн-песочница) в том же формате.
