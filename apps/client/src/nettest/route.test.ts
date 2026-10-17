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
