/** Пульс по умолчанию, мс: симуляция хоста накапливает время сама, поэтому частота пульса её не определяет. */
const DEFAULT_INTERVAL_MS = 4;

/** Исходник воркера: по сообщению с интервалом запускает таймер и шлёт пульсы в главный поток. */
const WORKER_SOURCE = `let id = 0;
onmessage = (e) => {
  clearInterval(id);
  const ms = e.data;
  id = setInterval(() => postMessage(0), ms);
};`;

/**
 * Пульс примерно каждые intervalMs из Web Worker: в фоновой вкладке таймеры главного потока тормозятся до 1 Гц,
 * а таймеры воркера — нет (решение Н11). Нет Worker или он не запустился — обычный setInterval.
 * Пульсы могут прийти пачкой, если главный поток был занят: время считайте по часам, а не по числу пульсов.
 * Возвращает stop.
 */
export function startTicker(onPulse: () => void, intervalMs: number = DEFAULT_INTERVAL_MS): () => void {
  const ms = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
  let stopped = false;
  let stopCurrent: () => void = () => undefined;

  const startTimer = () => {
    const id = setInterval(onPulse, ms);
    stopCurrent = () => clearInterval(id);
  };

  const startWorker = (): boolean => {
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL.createObjectURL !== "function") {
      return false;
    }
    let created: string | undefined;
    let worker: Worker;
    try {
      created = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      worker = new Worker(created);
    } catch {
      if (created !== undefined) URL.revokeObjectURL(created);
      return false;
    }
    const url = created;
    const release = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    worker.onmessage = () => {
      if (!stopped) onPulse();
    };
    // Воркер из Blob может быть запрещён политикой страницы (CSP): ошибка приходит событием, а не исключением.
    worker.onerror = (e) => {
      e.preventDefault();
      console.warn("ticker: Worker не запустился, пульс идёт от setInterval");
      release();
      if (!stopped) startTimer();
    };
    worker.postMessage(ms);
    stopCurrent = release;
    return true;
  };

  if (!startWorker()) startTimer();
  return () => {
    if (stopped) return;
    stopped = true;
    stopCurrent();
  };
}
