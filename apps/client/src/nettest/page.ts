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
// у хоста своё поле: иначе участник в том же браузере получит предзаполненное «Хост»
const HOST_NAME_KEY = "nettest_host_name";

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

// Экран не гаснет, пока вкладка видна. Браузер сам снимает блокировку, когда вкладка скрывается,
// поэтому при возвращении запрашиваем её заново. Ошибки игнорируем: в части браузеров API нет.
function holdWakeLock(): { release(): void } {
  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  const acquire = async (): Promise<void> => {
    try {
      const s = await navigator.wakeLock.request("screen");
      if (released || sentinel) {
        void s.release().catch(() => undefined);
        return;
      }
      sentinel = s;
      s.addEventListener("release", () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      // нет поддержки или отказ браузера: тест идёт и без этого
    }
  };
  const onVisible = (): void => {
    if (document.visibilityState === "visible" && !sentinel) void acquire();
  };

  document.addEventListener("visibilitychange", onVisible);
  void acquire();
  return {
    release() {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      const s = sentinel;
      sentinel = null;
      void s?.release().catch(() => undefined);
    },
  };
}

function copyOnClick(btn: HTMLButtonElement, text: () => string): void {
  const label = btn.textContent;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const flash = (message: string): void => {
    btn.textContent = message;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      btn.textContent = label;
    }, 2000);
  };
  btn.addEventListener("click", () => {
    void navigator.clipboard.writeText(text()).then(
      () => flash("Скопировано ✓"),
      () => flash("Не вышло — выдели текст вручную"),
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
  nameInput.value = safeGet(HOST_NAME_KEY) ?? "";
  copyOnClick(byId<HTMLButtonElement>(root, "nt-copy-link"), () => shareLink);
  copyOnClick(byId<HTMLButtonElement>(root, "nt-copy-summary"), () => summary);

  openBtn.addEventListener("click", () => {
    void open();
  });

  async function open(): Promise<void> {
    const name = nameInput.value.trim().slice(0, 24) || "Хост";
    safeSet(HOST_NAME_KEY, name);
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
    const wake = holdWakeLock();
    window.addEventListener("pagehide", () => wake.release(), { once: true });
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
    const wake = holdWakeLock();

    // часы стартуют с первого тика, а не с нажатия кнопки: подключение к сигналингу в тест не входит
    let started: number | null = null;
    let lastSummaryAt = 0;
    let outcome: PeerOutcome;
    try {
      outcome = await runPeerTest({
        room,
        name,
        durationS: Number(durSelect.value),
        onTick: (d, connected, hostName) => {
          const now = performance.now();
          started ??= now;
          byId(root, "nt-elapsed").textContent = fmtClock((now - started) / 1000);
          byId(root, "nt-last").textContent = fmtMs(d.rtts.at(-1));
          const neverConnected = d.arrivals.length === 0 && !hostName;
          byId(root, "nt-status").textContent = connected
            ? `Связь с хостом ${hostName || "…"} есть`
            : neverConnected
              ? "Подключаемся к хосту…"
              : "Связь с хостом потеряна, переподключаемся…";
          if (now - lastSummaryAt > 1000) {
            lastSummaryAt = now;
            byId(root, "nt-p95").textContent = fmtMs(summarizeRtt(d.rtts).p95);
            byId(root, "nt-stalls").textContent = String(countStalls(d.arrivals, CRITERIA.stallGapMs).stalls);
          }
        },
      });
    } catch (e) {
      wake.release();
      byId(root, "nt-live").hidden = true;
      errorLine.textContent = `Не удалось подключиться к сигналингу PeerJS (${(e as { type?: string }).type ?? String(e)}). Проверь интернет и нажми «Начать» ещё раз.`;
      setInputsDisabled(false);
      return;
    }
    wake.release();

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
    // последний тик в onTick не приходит, и живой счётчик зависаний не видит хвостовой разрыв: итог показывает только отчёт
    byId(root, "nt-live").hidden = true;
    byId(root, "nt-result").hidden = false;
    byId(root, "nt-sent").textContent = outcome.sendReport(result)
      ? "Результат отправлен хосту ✓"
      : "Связь с хостом уже закрыта — скопируй текст и пришли в чат";
    setTimeout(() => outcome.close(), 1500);
  }
}
