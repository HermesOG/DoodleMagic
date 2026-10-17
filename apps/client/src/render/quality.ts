/** Пресеты качества (GDD 6, сводная таблица арт-директора). Частицы, свет магии и bloom появятся в фазах 2 и 5. */
export type PresetId = "low" | "medium" | "high";

export interface Preset {
  id: PresetId;
  label: string;
  /** Доля разрешения экрана, в которой рисуется кадр. */
  renderScale: number;
  /** Потолок devicePixelRatio. */
  maxPixelRatio: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  low: { id: "low", label: "Низкое", renderScale: 0.67, maxPixelRatio: 1 },
  medium: { id: "medium", label: "Среднее", renderScale: 0.85, maxPixelRatio: 1.25 },
  high: { id: "high", label: "Высокое", renderScale: 1, maxPixelRatio: 1.5 },
};

export const PRESET_ORDER: readonly PresetId[] = ["low", "medium", "high"];

export function isPresetId(x: unknown): x is PresetId {
  return x === "low" || x === "medium" || x === "high";
}

/** Итоговый pixelRatio рендера для пресета и экрана. */
export function pixelRatioFor(p: Preset, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, p.maxPixelRatio) * p.renderScale;
}

/**
 * Радиус контура на строку кадра: линия занимает примерно одну долю высоты на любом мониторе.
 * Округление даёт 1 тексель до 1250 строк, 2 — до 2083, 3 — до 2916 (1080p → 1, 1440p → 2, 2160p → 3).
 */
export const LINE_RADIUS_PER_ROW = 0.0012;

/** Радиус выборки контура в текселях по высоте G-буфера (строк рендера): целый, не меньше одного. */
export function lineRadiusFor(renderRows: number): number {
  const rows = Number.isFinite(renderRows) && renderRows > 0 ? renderRows : 0;
  return Math.max(1, Math.round(rows * LINE_RADIUS_PER_ROW));
}

export interface AutoQualityOptions {
  /** После старта и после каждой смены пресета столько мс кадры не считаем: перевыделение буферов, догрузка. */
  settleMs: number;
  /** Вердикт выносится не раньше, чем засчитано столько мс кадров… */
  windowMs: number;
  /** …и не меньше стольких кадров. */
  minSamples: number;
  /** Кадр дольше этого — медленный. 1000/55: на мониторе 60 Гц это уже пропуск кадра развёртки. */
  slowFrameMs: number;
  /** Пресет ниже, если медленных кадров в окне не меньше этой доли. */
  slowShare: number;
  /**
   * Кадр дольше этого во время прогрева — заминка (компиляция шейдера, догрузка), а не нагрузка. После прогрева
   * это просто медленный кадр. В часы подбора (прогрев, окно, maxMs) любой кадр идёт не дольше hitchMs:
   * одна заминка не съедает ни прогрев, ни окно, ни предел по времени.
   */
  hitchMs: number;
  /** После стольких мс подбора следующий вердикт — последний, даже если он понизил пресет. */
  maxMs: number;
}

export const AUTO_QUALITY: AutoQualityOptions = {
  settleMs: 500,
  windowMs: 1500,
  minSamples: 20,
  slowFrameMs: 1000 / 55,
  slowShare: 0.2,
  hitchMs: 250,
  maxMs: 6000,
};

export interface AutoQuality {
  readonly preset: PresetId;
  /** Подбор закончен; после этого push больше ничего не меняет. */
  readonly done: boolean;
  /** Время очередного кадра, мс. Возвращает новый пресет, если пора переключиться, иначе null. */
  push(frameMs: number): PresetId | null;
}

/**
 * Автовыбор пресета по времени кадра за первые секунды: начинаем с `start` и только спускаемся.
 * Судим по доле медленных кадров, а не по медиане: при 41 FPS на мониторе 60 Гц кадры идут по 16,7 и 33,3 мс,
 * и медиана ещё 16,7, а пропуск уже почти каждый второй кадр. Пресет закрывается только вердиктом
 * по полному окну — ни заминка, ни предел по времени не завершают подбор без него. Машина, которая
 * не рисует быстрее 250 мс, тоже получает вердикт: после прогрева такие кадры — медленные.
 */
export function createAutoQuality(start: PresetId = "high", o: AutoQualityOptions = AUTO_QUALITY): AutoQuality {
  let preset = start;
  let done = false;
  /** Время подбора; каждый кадр в нём не длиннее hitchMs. */
  let elapsed = 0;
  let sinceSwitch = 0;
  let counted = 0;
  let countedMs = 0;
  let slow = 0;
  return {
    get preset() {
      return preset;
    },
    get done() {
      return done;
    },
    push(frameMs) {
      if (done) return null;
      // NaN, ноль и отрицательные — мусор таймера
      if (!(frameMs > 0)) return null;
      const ms = Math.min(frameMs, o.hitchMs);
      // кадр, начатый во время прогрева, не считаем, каким бы долгим он ни был
      const settling = sinceSwitch < o.settleMs;
      sinceSwitch += ms;
      elapsed += ms;
      if (settling) return null;
      counted++;
      countedMs += ms;
      if (frameMs > o.slowFrameMs) slow++;
      if (counted < o.minSamples || countedMs < o.windowMs) return null;

      // вердикт по текущему пресету
      const idx = PRESET_ORDER.indexOf(preset);
      if (slow < o.slowShare * counted || idx === 0) {
        done = true;
        return null;
      }
      preset = PRESET_ORDER[idx - 1]!;
      sinceSwitch = 0;
      counted = 0;
      countedMs = 0;
      slow = 0;
      if (elapsed >= o.maxMs) done = true;
      return preset;
    },
  };
}

export interface QualityWatchdogOptions {
  /** Окно — столько мс засчитанных кадров; окна идут встык. */
  windowMs: number;
  /** Кадр дольше этого — медленный. */
  slowFrameMs: number;
  /** Пресет ниже, если медленных кадров в окне не меньше этой доли. */
  slowShare: number;
  /** Между сменами пресета — не меньше стольких мс (и от старта сторожа). */
  minGapMs: number;
  /** Кадр дольше этого — заминка (вкладка из фона, GC, alt-tab), а не нагрузка: не считаем. */
  hitchMs: number;
}

export const QUALITY_WATCHDOG: QualityWatchdogOptions = {
  windowMs: 4000,
  slowFrameMs: 18,
  slowShare: 0.3,
  minGapMs: 8000,
  hitchMs: 250,
};

export interface QualityWatchdog {
  readonly preset: PresetId;
  /**
   * Время очередного кадра, мс; counting — кадр боя (мышь захвачена), иначе он только двигает часы между сменами.
   * Возвращает пресет ниже, если пора спуститься, иначе null.
   */
  push(frameMs: number, counting: boolean): PresetId | null;
}

/**
 * Сторож качества после автовыбора: автовыбор судит по первым секундам на экране выбора стихии, а бой тяжелее.
 * Только спускается: окна по ~4 с из кадров с захваченной мышью; если в окне не меньше 30 % кадров дольше 18 мс —
 * пресет на ступень ниже, но не чаще раза в 8 с (первая смена — не раньше 8 с после старта сторожа).
 */
export function createQualityWatchdog(start: PresetId, o: QualityWatchdogOptions = QUALITY_WATCHDOG): QualityWatchdog {
  let preset = start;
  let sinceStep = 0;
  let counted = 0;
  let countedMs = 0;
  let slow = 0;
  return {
    get preset() {
      return preset;
    },
    push(frameMs, counting) {
      // NaN, ноль и отрицательные — мусор таймера
      if (!(frameMs > 0)) return null;
      sinceStep += frameMs;
      if (!counting || frameMs > o.hitchMs || preset === PRESET_ORDER[0]) return null;
      counted++;
      countedMs += frameMs;
      if (frameMs > o.slowFrameMs) slow++;
      if (countedMs < o.windowMs) return null;
      const slowWindow = slow >= o.slowShare * counted;
      counted = 0;
      countedMs = 0;
      slow = 0;
      if (!slowWindow || sinceStep < o.minGapMs) return null;
      preset = PRESET_ORDER[PRESET_ORDER.indexOf(preset) - 1]!;
      sinceStep = 0;
      return preset;
    },
  };
}
