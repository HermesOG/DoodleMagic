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
