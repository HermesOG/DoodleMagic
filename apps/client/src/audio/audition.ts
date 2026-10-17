import type { Vec3 } from "@doodlemagic/sim";
import { SOUND_IDS, type SoundId } from "../feel/effects";
import { RECIPES, SOUND_ELEMENT, recipeLength } from "./recipes";
import { createAudio, createVoiceKit, scheduleRecipe, type GameAudio } from "./synth";

/**
 * Прослушка звуков без игры. Страница: `/src/audio/audition.html` в `pnpm dev:client` (в сборку не входит).
 * Для интеграции — installAudioConsole(audio): в консоли появляется `dmAudio`.
 */

export const SOUND_LABELS: Record<SoundId, string> = {
  fireFist: "Кулак",
  fireballCharge: "Шар: замах",
  fireballBoom: "Шар: взрыв",
  dash: "Рывок",
  fireWallTelegraph: "Стена огня: искры",
  fireWallIgnite: "Стена огня: розжиг",
  overheat: "Перегрев",
  stoneCast: "Камень: бросок",
  stoneImpact: "Камень: удар",
  pillarTelegraph: "Столб: трещины",
  pillarStrike: "Столб: удар",
  wallRise: "Стена: рост",
  quakeWindup: "Землетрясение: замах",
  quakeStrike: "Землетрясение: удар",
  terrainHit: "Рельеф: попадание",
  terrainBreak: "Рельеф: разрушение",
  hitTick: "Тик попадания",
  kill: "Убийство",
  fall: "Падение",
  fizzle: "Пшик",
  courage: "Кураж",
};

const EAR = 1.6;

/** Где звучит источник, если слушатель в начале координат и смотрит вдоль −Z. */
const PLACES: { label: string; pos: Vec3 | null }[] = [
  { label: "у уха", pos: null },
  { label: "слева 5 м", pos: { x: -5, y: EAR, z: 0 } },
  { label: "справа 5 м", pos: { x: 5, y: EAR, z: 0 } },
  { label: "спереди 15 м", pos: { x: 0, y: EAR, z: -15 } },
  { label: "сзади 5 м", pos: { x: 0, y: EAR, z: 5 } },
  { label: "далеко 40 м", pos: { x: 0, y: EAR, z: -40 } },
];

const GROUPS: { title: string; ids: SoundId[] }[] = [
  { title: "Огонь", ids: SOUND_IDS.filter((id) => SOUND_ELEMENT[id] === "fire") },
  { title: "Земля", ids: SOUND_IDS.filter((id) => SOUND_ELEMENT[id] === "earth") },
  { title: "Общие", ids: SOUND_IDS.filter((id) => SOUND_ELEMENT[id] === null) },
];

/** Доли энергии в полосах подписей и центроид спектра (усреднение окон Ханна по 4096). */
export function bandShares(x: Float32Array, sampleRate: number): { earth: number; fire: number; centroidHz: number } {
  const n = 4096;
  const power = new Float64Array(n / 2);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let off = 0; off === 0 || off + n <= x.length; off += n / 2) {
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re[i] = (x[off + i] ?? 0) * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) power[k] = power[k]! + re[k]! * re[k]! + im[k]! * im[k]!;
  }
  let total = 0;
  let earth = 0;
  let fire = 0;
  let moment = 0;
  for (let k = 1; k < n / 2; k++) {
    const f = (k * sampleRate) / n;
    const p = power[k]!;
    total += p;
    moment += p * f;
    if (f >= 30 && f <= 200) earth += p;
    if (f >= 2000 && f <= 8000) fire += p;
  }
  return total > 0 ? { earth: earth / total, fire: fire / total, centroidHz: moment / total } : { earth: 0, fire: 0, centroidHz: 0 };
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Рецепт, отрисованный в буфер без мастера и компрессора: для замера спектра и пика. */
export async function renderSound(id: SoundId, sampleRate = 48000): Promise<Float32Array> {
  const length = Math.ceil((recipeLength(RECIPES[id]) + 0.1) * sampleRate);
  const oc = new OfflineAudioContext(1, length, sampleRate);
  scheduleRecipe(oc, RECIPES[id], oc.destination, 0, createVoiceKit(oc, Math.random));
  return (await oc.startRendering()).getChannelData(0);
}

export interface AudioConsole {
  ids: readonly SoundId[];
  /** Без x — у уха; иначе источник в (x, 1.6, z) от слушателя в начале координат, взгляд вдоль −Z. */
  play(id: SoundId, x?: number, z?: number): void;
  /** Все звуки группы подряд через 0,9 с. */
  all(group?: "fire" | "earth" | "common"): void;
  stats(): ReturnType<GameAudio["stats"]>;
  volume(v: number): void;
  mute(m?: boolean): void;
}

/** Консольный доступ к звуку для живой проверки: `dmAudio.play("fireballBoom", 5)`, `dmAudio.all("earth")`. */
export function installAudioConsole(audio: GameAudio, target: object = globalThis): AudioConsole {
  const play = (id: SoundId, x?: number, z = 0) => {
    audio.unlock();
    audio.play(id, x === undefined ? null : { x, y: EAR, z }, 1);
  };
  const api: AudioConsole = {
    ids: SOUND_IDS,
    play,
    all(group) {
      const el = group === "fire" ? "fire" : group === "earth" ? "earth" : group === "common" ? null : undefined;
      const ids = SOUND_IDS.filter((id) => el === undefined || SOUND_ELEMENT[id] === el);
      ids.forEach((id, i) => setTimeout(() => play(id), i * 900));
    },
    stats: () => audio.stats(),
    volume: (v) => audio.setVolume(v),
    mute: (m = true) => audio.setMuted(m),
  };
  (target as { dmAudio?: AudioConsole }).dmAudio = api;
  return api;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

/** Страница прослушки: кнопки всех звуков, место источника, громкость, слепой тест «Огонь или Земля», спектр. */
export function mountAudition(root: HTMLElement): GameAudio {
  const audio = createAudio();
  installAudioConsole(audio);
  audio.setListener({ x: 0, y: EAR, z: 0 }, 0);
  let place: Vec3 | null = null;
  const play = (id: SoundId) => {
    audio.unlock();
    audio.play(id, place, 1);
  };

  const status = el("span", { className: "status", textContent: "звук выключен — нажмите любую кнопку" });
  const refresh = () => {
    const s = audio.stats();
    status.textContent = s.unlocked ? `голосов: ${s.voices}, громкость ${Math.round(s.volume * 100)} %${s.muted ? ", без звука" : ""}` : "звук выключен — нажмите любую кнопку";
  };
  setInterval(refresh, 200);

  const volume = el("input", { type: "range", min: "0", max: "1", step: "0.05", value: "0.8" });
  volume.addEventListener("input", () => audio.setVolume(Number(volume.value)));
  const mute = el("input", { type: "checkbox" });
  mute.addEventListener("change", () => audio.setMuted(mute.checked));

  const places = el("div", { className: "row" }, "Источник: ");
  PLACES.forEach((p, i) => {
    const r = el("input", { type: "radio", name: "place", checked: i === 0 });
    r.addEventListener("change", () => (place = p.pos));
    places.append(el("label", {}, r, p.label));
  });

  const groups = GROUPS.map((g) => {
    const row = el("div", { className: "row" }, el("b", { textContent: `${g.title}: ` }));
    for (const id of g.ids) {
      const b = el("button", { textContent: SOUND_LABELS[id], title: id });
      b.addEventListener("click", () => play(id));
      row.append(b);
    }
    const allBtn = el("button", { textContent: "все подряд", className: "all" });
    allBtn.addEventListener("click", () => g.ids.forEach((id, i) => setTimeout(() => play(id), i * 900)));
    row.append(allBtn);
    return row;
  });

  // Слепой тест: стихию нужно узнать только по звуку (GDD 5).
  const pool = SOUND_IDS.filter((id) => SOUND_ELEMENT[id] !== null);
  let secret: SoundId | null = null;
  let right = 0;
  let asked = 0;
  const verdict = el("span", { className: "status" });
  const ask = el("button", { textContent: "сыграть загадку" });
  ask.addEventListener("click", () => {
    secret = pool[Math.floor(Math.random() * pool.length)] ?? null;
    if (secret) play(secret);
    verdict.textContent = "Огонь или Земля?";
  });
  const guess = (g: "fire" | "earth") => () => {
    if (!secret) return;
    asked++;
    const ok = SOUND_ELEMENT[secret] === g;
    if (ok) right++;
    verdict.textContent = `${ok ? "да" : "нет"}: это «${SOUND_LABELS[secret]}». Счёт ${right} из ${asked}`;
    secret = null;
  };
  const fireBtn = el("button", { textContent: "Огонь" });
  fireBtn.addEventListener("click", guess("fire"));
  const earthBtn = el("button", { textContent: "Земля" });
  earthBtn.addEventListener("click", guess("earth"));

  const table = el("table");
  const measure = el("button", { textContent: "посчитать спектр" });
  measure.addEventListener("click", async () => {
    table.replaceChildren(el("tr", {}, ...["звук", "30–200 Гц", "2–8 кГц", "центроид", "пик"].map((t) => el("th", { textContent: t }))));
    for (const id of SOUND_IDS) {
      const x = await renderSound(id);
      const s = bandShares(x, 48000);
      let peak = 0;
      for (const v of x) peak = Math.max(peak, Math.abs(v));
      const pct = (v: number) => `${Math.round(v * 100)} %`;
      table.append(
        el("tr", { className: SOUND_ELEMENT[id] ?? "common" }, ...[SOUND_LABELS[id], pct(s.earth), pct(s.fire), `${Math.round(s.centroidHz)} Гц`, peak.toFixed(2)].map((t) => el("td", { textContent: t }))),
      );
    }
  });

  root.replaceChildren(
    el("h1", { textContent: "Звук: прослушка" }),
    el("div", { className: "row" }, "Громкость ", volume, el("label", {}, mute, "без звука"), status),
    places,
    ...groups,
    el("div", { className: "row" }, el("b", { textContent: "Слепой тест: " }), ask, fireBtn, earthBtn, verdict),
    el("div", { className: "row" }, el("b", { textContent: "Спектр: " }), measure),
    table,
  );
  return audio;
}
