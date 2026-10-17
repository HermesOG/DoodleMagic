import { cleanRoom, deviceKind, netKind } from "../config";
import { hostRoom, runPeerTest, type HostSession, type HostState, type PeerOutcome } from "./p2p";
import {
  CRITERIA,
  buildResult,
  countStalls,
  fmtMs,
  formatReport,
  formatSummary,
  judge,
  parseHostSave,
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
    // приватный режим или переполнение: значение просто не запомнится
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // хранилище недоступно — удалять нечего
  }
}

const fmtClock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const navConnection = () =>
  (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection;

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
  else mountPeer(root, room, Number(params.get("dur")), params.get("relay") === "1");
}

// ---------------------------------------------------------------- хост

function mountHost(root: HTMLElement, room: string): void {
  const shareLink = `${location.origin}/nettest?room=${encodeURIComponent(room)}`;
  // результаты переживают перезагрузку вкладки хоста; у каждой комнаты свои
  const saveKey = `nettest_host_${room}`;
  const saved = parseHostSave(safeGet(saveKey));
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
      <p class="small" id="nt-hidden"></p>
      <h2>Результаты</h2>
      <pre id="nt-summary"></pre>
      <div class="actions">
        <button id="nt-copy-summary" class="btn secondary" type="button">Скопировать сводку</button>
        <button id="nt-clear" class="btn secondary" type="button">Очистить результаты</button>
      </div>
    </section>`;

  const nameInput = byId<HTMLInputElement>(root, "nt-name");
  const openBtn = byId<HTMLButtonElement>(root, "nt-open");
  const status = byId(root, "nt-status");
  const hiddenLine = byId(root, "nt-hidden");
  let summary = "";
  let session: HostSession | null = null;
  let state: HostState = { peers: [], reports: saved.reports, failedOpens: saved.failedOpens };
  // Скрытая вкладка хоста: браузер душит её таймеры, и снапшоты идут реже. Считаем с открытия комнаты.
  let hiddenBeforeS = saved.hostHiddenS;
  let hiddenSince: number | null = null;
  const hostHiddenS = (): number =>
    Math.round(hiddenBeforeS + (hiddenSince === null ? 0 : (performance.now() - hiddenSince) / 1000));

  const render = (): void => {
    const hidden = hostHiddenS();
    summary = formatSummary(state.reports, { failedOpens: state.failedOpens, hostHiddenS: hidden });
    byId(root, "nt-summary").textContent = summary;
    byId(root, "nt-count").textContent = String(state.peers.length);
    byId(root, "nt-peers").textContent = state.peers.join(", ");
    hiddenLine.textContent =
      hidden > 0 ? `Вкладка хоста была скрыта ${hidden} с — результаты за это время ненадёжны` : "Вкладка хоста не скрывалась ✓";
    hiddenLine.className = hidden > 0 ? "small bad" : "small ok";
  };
  const save = (): void => {
    safeSet(
      saveKey,
      JSON.stringify({ reports: state.reports, failedOpens: state.failedOpens, hostHiddenS: hostHiddenS() }),
    );
  };
  const onVisibility = (): void => {
    const now = performance.now();
    if (document.hidden) hiddenSince ??= now;
    else if (hiddenSince !== null) {
      hiddenBeforeS += (now - hiddenSince) / 1000;
      hiddenSince = null;
    }
    render();
    save();
  };

  byId(root, "nt-room").textContent = room;
  byId(root, "nt-link").textContent = shareLink;
  nameInput.value = safeGet(HOST_NAME_KEY) ?? "";
  render();
  const restored = saved.reports.length + saved.failedOpens.length;
  if (restored > 0) {
    status.textContent = `Сохранены результаты прошлого запуска: ${restored}. Они будут в сводке, когда откроешь комнату.`;
  }
  copyOnClick(byId<HTMLButtonElement>(root, "nt-copy-link"), () => shareLink);
  copyOnClick(byId<HTMLButtonElement>(root, "nt-copy-summary"), () => summary);
  byId<HTMLButtonElement>(root, "nt-clear").addEventListener("click", () => {
    if (!confirm("Удалить все результаты этой комнаты? Вернуть их будет нельзя.")) return;
    hiddenBeforeS = 0;
    hiddenSince = null;
    state = { ...state, reports: [], failedOpens: [] };
    session?.clear();
    safeRemove(saveKey);
    render();
  });

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
      session = await hostRoom(
        room,
        name,
        (s) => {
          state = s;
          render();
          save();
        },
        { reports: saved.reports, failedOpens: saved.failedOpens },
      );
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
    window.addEventListener(
      "pagehide",
      () => {
        wake.release();
        save();
      },
      { once: true },
    );
    if (document.hidden) hiddenSince = performance.now();
    document.addEventListener("visibilitychange", onVisibility);
    status.textContent = "Комната открыта ✓ Не закрывай и не сворачивай эту вкладку.";
    byId(root, "nt-room-card").hidden = false;
    render();
  }
}

// ---------------------------------------------------------------- участник

function mountPeer(root: HTMLElement, room: string, debugDur: number, relayOnly: boolean): void {
  root.innerHTML = `
    <section class="card">
      <h1>Тест связи</h1>
      <p class="muted">Проверяем, потянет ли твой интернет онлайн-игру DoodleMagic. Тест идёт 10 минут: не закрывай и не сворачивай вкладку, не давай компьютеру уснуть.</p>
      <p class="small" id="nt-mode" hidden><b>Режим: только через ретранслятор (TURN)</b></p>
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
  const device = deviceKind(navigator.userAgent);
  let reportText = "";
  byId(root, "nt-room").textContent = room;
  byId(root, "nt-mode").hidden = !relayOnly;
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
    // хост ведёт результаты по имени и устройству: без имени их не отличить
    if (!name) {
      errorLine.textContent = "Впиши имя, чтобы хост тебя узнал";
      nameInput.focus();
      return;
    }
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
        device,
        relayOnly,
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
      conn: navConnection()?.effectiveType ?? "?",
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      device,
      net: netKind(navConnection()),
      relayOnly,
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
    const sentLine = byId(root, "nt-sent");
    sentLine.textContent = "Отправляем результат хосту…";
    // peer живёт, пока хост не подтвердит получение или не выйдет срок ожидания
    const delivered = await outcome.sendReport(result);
    outcome.close();
    sentLine.textContent = delivered
      ? "Результат доставлен хосту ✓"
      : "Хост не подтвердил получение — скопируй текст и пришли в чат";
    sentLine.className = delivered ? "small ok" : "small bad";
  }
}
