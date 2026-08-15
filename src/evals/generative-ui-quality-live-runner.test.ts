import { describe, expect, it, vi } from "vitest";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import { buildRecordedGenerativeUiQualityCandidate } from "./generative-ui-quality-fixtures.js";
import {
  generativeUiQualityDiagnostics,
  runGenerativeUiQualityEvaluation,
} from "./generative-ui-quality-live-runner.js";

function recordedGenerativeCandidate(caseId: string) {
  const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === caseId);
  if (!testCase) throw new TypeError(`Missing UI quality case ${caseId}.`);
  return {
    testCase,
    candidate: buildRecordedGenerativeUiQualityCandidate(testCase),
  };
}

describe("grammar-v3 live quality runner", () => {
  it("accepts multiple invariant-conformant compositions without recipe fingerprints", async () => {
    const { testCase, candidate } = recordedGenerativeCandidate("QC05");
    const report = await runGenerativeUiQualityEvaluation({
      enabled: true,
      cases: [testCase],
      compose: vi.fn().mockResolvedValue({
        candidate,
        repairCount: 0,
        fallbackUsed: false,
        compositionFirstFailureCategory: "none",
        compositionFirstFailureCodes: [],
      }),
    });

    expect(report.totals).toEqual({
      attempted: 3,
      accepted: 3,
      qualityValid: 3,
      firstPassQualityValid: 3,
      repairs: 0,
      fallbacks: 0,
      invariantConformant: 3,
    });
    expect(report.samples.every((sample) => sample.invariantConformant)).toBe(true);
    expect(report.samples.every((sample) => sample.layoutFamily === "stack")).toBe(true);
    expect(generativeUiQualityDiagnostics(report)).toHaveLength(2);
    expect(JSON.stringify(generativeUiQualityDiagnostics(report))).not.toContain(testCase.prompt);
  });

  it("counts plan-v2 fallback as rejected grammar output", async () => {
    const { testCase, candidate } = recordedGenerativeCandidate("QR02");
    const report = await runGenerativeUiQualityEvaluation({
      enabled: true,
      cases: [testCase],
      compose: vi.fn().mockResolvedValue({
        candidate,
        repairCount: 1,
        fallbackUsed: true,
        compositionFirstFailureCategory: "semantic",
        compositionFirstFailureCodes: ["requested_coverage"],
      }),
    });

    expect(report.totals).toMatchObject({ attempted: 3, accepted: 0, fallbacks: 3 });
    expect(report.samples[0]).toMatchObject({
      qualityValid: false,
      invariantConformant: false,
      firstFailureCategory: "fallback_used",
    });
  });
});
