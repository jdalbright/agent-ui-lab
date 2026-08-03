import { describe, expect, it, vi } from "vitest";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import { buildRecordedUiQualityCandidate } from "./ui-quality-fixtures.js";
import { runLiveUiQualityEvaluation } from "./ui-quality-live-runner.js";

describe("live UI quality runner", () => {
  it("does not invoke composition unless explicitly enabled", async () => {
    const compose = vi.fn();
    const report = await runLiveUiQualityEvaluation({ enabled: false, compose });

    expect(compose).not.toHaveBeenCalled();
    expect(report).toEqual({
      enabled: false,
      samples: [],
      totals: {
        attempted: 0,
        valid: 0,
        firstPassValid: 0,
        repairs: 0,
        fallbacks: 0,
      },
    });
  });

  it("reports three samples per case without logging prompts or evidence", async () => {
    let tick = 0;
    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: UI_QUALITY_CASES,
      now: () => tick++ * 10,
      compose: (testCase) => Promise.resolve({
        candidate: buildRecordedUiQualityCandidate(testCase),
        repairCount: 0,
        fallbackUsed: false,
      }),
    });

    expect(report.enabled).toBe(true);
    expect(report.samples).toHaveLength(54);
    expect(report.totals).toEqual({
      attempted: 54,
      valid: 54,
      firstPassValid: 54,
      repairs: 0,
      fallbacks: 0,
    });
    expect(JSON.stringify(report)).not.toMatch(/what is the weather|recorded evidence/i);
  });

  it("records provider failures without exposing their error text or aborting the run", async () => {
    const compose = vi.fn()
      .mockRejectedValueOnce(new Error("private provider response"))
      .mockImplementation((testCase: (typeof UI_QUALITY_CASES)[number]) => Promise.resolve({
        candidate: buildRecordedUiQualityCandidate(testCase),
        repairCount: 0,
        fallbackUsed: false,
      }));
    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [UI_QUALITY_CASES[0]],
      compose,
    });

    expect(report.totals).toMatchObject({ attempted: 3, valid: 2 });
    expect(report.samples[0]).toMatchObject({
      success: false,
      recipeId: "provider-error",
      issueCodes: ["provider_error"],
    });
    expect(JSON.stringify(report)).not.toContain("private provider response");
  });
});
