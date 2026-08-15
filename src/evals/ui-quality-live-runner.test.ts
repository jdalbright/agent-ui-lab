import { describe, expect, it, vi } from "vitest";
import { compileSurfacePlan } from "../../api/_lib/surface-plan.js";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import {
  buildRecordedUiQualityCandidate,
  recordedUiQualityCompilationInput,
} from "./ui-quality-fixtures.js";
import {
  liveUiQualityDiagnostics,
  runLiveUiQualityEvaluation,
  selectLiveUiQualityCases,
  type LiveUiQualityCaseDiagnostic,
  type LiveUiQualityDiagnostic,
} from "./ui-quality-live-runner.js";

function caseDiagnostic(
  records: readonly LiveUiQualityDiagnostic[],
  caseId: string,
): LiveUiQualityCaseDiagnostic | undefined {
  return records.find(
    (record): record is LiveUiQualityCaseDiagnostic =>
      record.event === "ui_quality_live_case" && record.caseId === caseId,
  );
}

function compiledRecordedCandidate(
  testCase: (typeof UI_QUALITY_CASES)[number],
  mutatePlan: (plan: Parameters<typeof compileSurfacePlan>[0]["plan"]) => void,
) {
  const input = recordedUiQualityCompilationInput(testCase);
  const plan = structuredClone(input.plan);
  mutatePlan(plan);
  return {
    benchmark: testCase,
    plan,
    spec: compileSurfacePlan({ ...input, plan, prompt: testCase.prompt }),
    sources: input.retrieval.sources,
  };
}

describe("live UI quality runner", () => {
  it("selects an explicit bounded case subset for focused live diagnostics", () => {
    expect(selectLiveUiQualityCases(undefined)).toBe(UI_QUALITY_CASES);
    expect(selectLiveUiQualityCases(" qc04, QR01,QC04 ").map((testCase) => testCase.id)).toEqual([
      "QC04",
      "QR01",
    ]);
    expect(() => selectLiveUiQualityCases("QC04,PRIVATE_PROMPT_TEXT")).toThrow(
      /unknown case IDs: PRIVATE_PROMPT_TEXT/i,
    );
  });

  it("does not invoke composition unless explicitly enabled", async () => {
    const compose = vi.fn();
    const report = await runLiveUiQualityEvaluation({ enabled: false, compose });

    expect(compose).not.toHaveBeenCalled();
    expect(report).toEqual({
      enabled: false,
      samples: [],
      totals: {
        attempted: 0,
        accepted: 0,
        qualityValid: 0,
        firstPassQualityValid: 0,
        repairs: 0,
        fallbacks: 0,
        structuralConformant: 0,
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
        compositionFirstFailureCategory: "none",
        compositionFirstFailureCodes: [],
      }),
    });

    expect(report.enabled).toBe(true);
    expect(report.samples).toHaveLength(54);
    expect(report.totals).toEqual({
      attempted: 54,
      accepted: 54,
      qualityValid: 54,
      firstPassQualityValid: 54,
      repairs: 0,
      fallbacks: 0,
      structuralConformant: 54,
    });
    expect(report.samples[0]).toMatchObject({
      success: true,
      qualityValid: true,
      firstPassQualityValid: true,
      structuralConformant: true,
      density: UI_QUALITY_CASES[0].expected.density,
      emphasis: UI_QUALITY_CASES[0].expected.emphasis,
      firstFailureCategory: "none",
      compositionFirstFailureCategory: "none",
      compositionFirstFailureCodes: [],
    });
    expect(report.samples[0]?.componentNames).toContain("SurfaceFrame");
    expect(JSON.stringify(report)).not.toMatch(/what is the weather|recorded evidence/i);

    const diagnostics = liveUiQualityDiagnostics(report);
    const firstCaseDiagnostics = caseDiagnostic(diagnostics, UI_QUALITY_CASES[0].id);
    expect(firstCaseDiagnostics).toMatchObject({
      event: "ui_quality_live_case",
      caseId: UI_QUALITY_CASES[0].id,
      attempted: 3,
      accepted: 3,
      qualityValid: 3,
      firstPassQualityValid: 3,
      repairs: 0,
      fallbacks: 0,
      structuralConformant: 3,
    });
    expect(firstCaseDiagnostics?.samples[0]).toMatchObject({
      run: 1,
      selectedRecipe: UI_QUALITY_CASES[0].recipeId,
      density: UI_QUALITY_CASES[0].expected.density,
      emphasis: UI_QUALITY_CASES[0].expected.emphasis,
      firstFailureCategory: "none",
      compositionFirstFailureCategory: "none",
      compositionFirstFailureCodes: [],
      qualityValid: true,
      structuralConformant: true,
      repairCount: 0,
      fallbackUsed: false,
    });
    expect(firstCaseDiagnostics?.samples[0]?.componentNames).toEqual([
      "SurfaceFrame",
      "WeatherHero",
      "Rail",
      "Metric",
      "SourceList",
    ]);
    expect(diagnostics).toHaveLength(UI_QUALITY_CASES.length + 1);
    expect(diagnostics.every((record) => JSON.stringify(record).length < 4_096)).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toMatch(/what is the weather|recorded evidence/i);
  });

  it("reports the first bounded quality failure category without issue text", async () => {
    const testCase = UI_QUALITY_CASES[0];
    const candidate = buildRecordedUiQualityCandidate(testCase);
    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [testCase],
      compose: () => Promise.resolve({
        candidate: {
          ...candidate,
          plan: { ...candidate.plan, density: "detailed" },
        },
        repairCount: 1,
        fallbackUsed: false,
        compositionFirstFailureCategory: "quality",
        compositionFirstFailureCodes: ["recipe_fit"],
      }),
    });

    expect(report.samples[0]).toMatchObject({
      success: false,
      qualityValid: false,
      structuralConformant: true,
      firstFailureCategory: "recipe_fit",
      compositionFirstFailureCategory: "quality",
      compositionFirstFailureCodes: ["recipe_fit"],
      repairCount: 1,
    });
    const diagnostics = liveUiQualityDiagnostics(report);
    const caseDiagnostics = caseDiagnostic(diagnostics, testCase.id);
    expect(caseDiagnostics?.samples[0]).toMatchObject({
      firstFailureCategory: "recipe_fit",
      compositionFirstFailureCategory: "quality",
      compositionFirstFailureCodes: ["recipe_fit"],
      qualityValid: false,
      structuralConformant: true,
      repairCount: 1,
      selectedRecipe: testCase.recipeId,
      density: "detailed",
    });
    expect(JSON.stringify(diagnostics)).not.toContain("Surface does not match");
  });

  it("reports only categorical schema paths and codes for composition repairs", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QC04");
    if (!testCase) throw new TypeError("QC04 is unavailable.");
    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [testCase],
      compose: () => Promise.resolve({
        candidate: buildRecordedUiQualityCandidate(testCase),
        repairCount: 1,
        fallbackUsed: false,
        compositionFirstFailureCategory: "schema",
        compositionFirstFailureCodes: ["invalid_schema"],
        compositionSchemaIssues: [
          {
            attempt: 0,
            path: "modules.0.items.0.recommended",
            code: "invalid_type",
          },
        ],
      }),
    });

    expect(report.samples[0]?.compositionSchemaIssues).toEqual([
      {
        attempt: 0,
        path: "modules.0.items.0.recommended",
        code: "invalid_type",
      },
    ]);
    const diagnostic = caseDiagnostic(liveUiQualityDiagnostics(report), testCase.id);
    expect(diagnostic?.samples[0]?.compositionSchemaIssues).toEqual(
      report.samples[0]?.compositionSchemaIssues,
    );
    expect(JSON.stringify(diagnostic)).not.toMatch(/React|Angular|official sources/i);
  });

  it("reports benchmark-owned missing fact concepts without logging candidate prose", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QC02");
    if (!testCase) throw new TypeError("QC02 is unavailable.");
    const candidate = buildRecordedUiQualityCandidate(testCase);
    const summary = candidate.spec.components.find(
      (component) => component.component === "ComparisonSummary",
    );
    if (!summary || !Array.isArray(summary.items)) {
      throw new TypeError("QC02 is missing its comparison summary.");
    }
    for (const item of summary.items as Array<{ recommended: boolean }>) {
      item.recommended = false;
    }
    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [testCase],
      compose: () => Promise.resolve({
        candidate,
        repairCount: 0,
        fallbackUsed: false,
        compositionFirstFailureCategory: "none",
        compositionFirstFailureCodes: [],
      }),
    });

    expect(report.samples[0]).toMatchObject({
      firstFailureCategory: "requested_coverage",
      missingFactConcepts: ["decision"],
    });
    const diagnostics = liveUiQualityDiagnostics(report);
    expect(caseDiagnostic(diagnostics, testCase.id)?.samples[0]).toMatchObject({
      missingFactConcepts: ["decision"],
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/Southwest|Delta|24 × 16 × 10/i);
  });

  it("fails QW03 when its required hourly semantic variant changes", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QW03");
    if (!testCase) throw new TypeError("QW03 is unavailable.");
    const changedCandidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "weather") throw new TypeError("QW03 is not a weather plan.");
      const hourlyModule = plan.modules.find((module) => module.type === "hourly");
      if (!hourlyModule || hourlyModule.type !== "hourly") {
        throw new TypeError("QW03 is missing its hourly module.");
      }
      hourlyModule.variant = "chart";
    });

    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [testCase],
      compose: () => Promise.resolve({
        candidate: changedCandidate,
        repairCount: 0,
        fallbackUsed: false,
        compositionFirstFailureCategory: "none",
        compositionFirstFailureCodes: [],
      }),
    });

    expect(report.samples[0]).toMatchObject({
      success: false,
      qualityValid: true,
      firstPassQualityValid: true,
      structuralConformant: false,
      firstFailureCategory: "structural_mismatch",
      issueCodes: ["semantic_variant"],
    });
    expect(report.totals).toMatchObject({
      accepted: 0,
      qualityValid: 3,
      firstPassQualityValid: 3,
      structuralConformant: 0,
    });
  });

  it("accepts QC05's trusted bar chart while retaining distinct fingerprint diagnostics", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QC05");
    if (!testCase) throw new TypeError("QC05 is unavailable.");
    const lineCandidate = buildRecordedUiQualityCandidate(testCase);
    const barCandidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "comparison") throw new TypeError("QC05 is not a comparison plan.");
      const chartModule = plan.modules.find((module) => module.type === "chart");
      if (!chartModule || chartModule.type !== "chart") {
        throw new TypeError("QC05 is missing its chart module.");
      }
      chartModule.variant = "bar";
    });

    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [testCase],
      compose: (_testCase, run) => Promise.resolve({
        candidate: run === 3 ? barCandidate : lineCandidate,
        repairCount: 0,
        fallbackUsed: false,
        compositionFirstFailureCategory: "none",
        compositionFirstFailureCodes: [],
      }),
    });

    expect(report.totals).toMatchObject({
      attempted: 3,
      accepted: 3,
      qualityValid: 3,
      firstPassQualityValid: 3,
      structuralConformant: 3,
    });
    expect(caseDiagnostic(liveUiQualityDiagnostics(report), testCase.id)?.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          run: 1,
          structuralFingerprintId: "07a10349",
          structuralConformant: true,
        }),
        expect.objectContaining({
          run: 3,
          structuralFingerprintId: "5bfc8e80",
          structuralConformant: true,
        }),
      ]),
    );
  });

  it("uses the requested case contract instead of candidate benchmark metadata", async () => {
    const qw03 = UI_QUALITY_CASES.find((candidate) => candidate.id === "QW03");
    const qw04 = UI_QUALITY_CASES.find((candidate) => candidate.id === "QW04");
    if (!qw03 || !qw04) throw new TypeError("Weather quality cases are unavailable.");
    const candidate = compiledRecordedCandidate(qw03, (plan) => {
      if (plan.kind !== "weather") throw new TypeError("QW03 is not a weather plan.");
      const hourlyModule = plan.modules.find((module) => module.type === "hourly");
      if (!hourlyModule || hourlyModule.type !== "hourly") {
        throw new TypeError("QW03 is missing its hourly module.");
      }
      hourlyModule.variant = "chart";
    });
    const changedCandidate = {
      ...candidate,
      benchmark: qw04,
    };

    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [qw03],
      compose: () => Promise.resolve({
        candidate: changedCandidate,
        repairCount: 0,
        fallbackUsed: false,
        compositionFirstFailureCategory: "none",
        compositionFirstFailureCodes: [],
      }),
    });

    expect(report.samples[0]).toMatchObject({
      qualityValid: true,
      structuralConformant: false,
      firstFailureCategory: "structural_mismatch",
      issueCodes: ["semantic_variant"],
    });
  });

  it("accepts QW01 without optional metrics and QW04 with either hourly variant", async () => {
    const qw01 = UI_QUALITY_CASES.find((candidate) => candidate.id === "QW01");
    const qw04 = UI_QUALITY_CASES.find((candidate) => candidate.id === "QW04");
    if (!qw01 || !qw04) throw new TypeError("Weather quality cases are unavailable.");

    const withoutMetrics = compiledRecordedCandidate(qw01, (plan) => {
      if (plan.kind !== "weather") throw new TypeError("QW01 is not a weather plan.");
      plan.modules = plan.modules.filter((module) => module.type !== "metrics");
    });

    const withStrip = compiledRecordedCandidate(qw04, (plan) => {
      if (plan.kind !== "weather") throw new TypeError("QW04 is not a weather plan.");
      const hourlyModule = plan.modules.find((module) => module.type === "hourly");
      if (!hourlyModule || hourlyModule.type !== "hourly") {
        throw new TypeError("QW04 is missing its hourly module.");
      }
      hourlyModule.variant = "strip";
    });

    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [qw01, qw04],
      compose: (testCase, run) => Promise.resolve({
        candidate: testCase.id === "QW01"
          ? withoutMetrics
          : run === 1
            ? withStrip
            : buildRecordedUiQualityCandidate(qw04),
        repairCount: 0,
        fallbackUsed: false,
        compositionFirstFailureCategory: "none",
        compositionFirstFailureCodes: [],
      }),
    });

    expect(report.totals).toMatchObject({
      attempted: 6,
      accepted: 6,
      qualityValid: 6,
      firstPassQualityValid: 6,
      structuralConformant: 6,
    });
  });

  it("preserves a bounded composition-repair category after a successful repair", async () => {
    const testCase = UI_QUALITY_CASES[0];
    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [testCase],
      compose: () => Promise.resolve({
        candidate: buildRecordedUiQualityCandidate(testCase),
        repairCount: 1,
        fallbackUsed: false,
        compositionFirstFailureCategory: "semantic",
        compositionFirstFailureCodes: ["invalid_semantic"],
      }),
    });

    expect(report.samples[0]).toMatchObject({
      success: true,
      qualityValid: true,
      firstPassQualityValid: false,
      structuralConformant: true,
      firstFailureCategory: "composition_repair",
      compositionFirstFailureCategory: "semantic",
      compositionFirstFailureCodes: ["invalid_semantic"],
      repairCount: 1,
      issueCodes: [],
    });
    const caseDiagnostics = caseDiagnostic(liveUiQualityDiagnostics(report), testCase.id);
    expect(caseDiagnostics?.samples[0]).toMatchObject({
      firstFailureCategory: "composition_repair",
      compositionFirstFailureCategory: "semantic",
      compositionFirstFailureCodes: ["invalid_semantic"],
      repairCount: 1,
    });
  });

  it("records provider failures without exposing their error text or aborting the run", async () => {
    const providerError = new Error("private provider response");
    providerError.name = "GeminiProviderError";
    const compose = vi.fn()
      .mockRejectedValueOnce(providerError)
      .mockImplementation((testCase: (typeof UI_QUALITY_CASES)[number]) => Promise.resolve({
        candidate: buildRecordedUiQualityCandidate(testCase),
        repairCount: 0,
        fallbackUsed: false,
        compositionFirstFailureCategory: "none",
        compositionFirstFailureCodes: [],
      }));
    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [UI_QUALITY_CASES[0]],
      compose,
    });

    expect(report.totals).toMatchObject({
      attempted: 3,
      accepted: 2,
      qualityValid: 2,
      structuralConformant: 2,
    });
    expect(report.samples[0]).toMatchObject({
      success: false,
      qualityValid: false,
      structuralConformant: false,
      recipeId: "provider-error",
      density: "unknown",
      emphasis: "unknown",
      componentNames: [],
      firstFailureCategory: "provider_error",
      issueCodes: ["provider_error"],
    });
    expect(JSON.stringify(report)).not.toContain("private provider response");
  });

  it("classifies composition validation failures separately from provider failures", async () => {
    const compositionError = new Error("private invalid composition output");
    compositionError.name = "CompositionValidationError";
    const testCase = UI_QUALITY_CASES[0];
    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: [testCase],
      compose: vi.fn()
        .mockRejectedValueOnce(compositionError)
        .mockImplementation(() => Promise.resolve({
          candidate: buildRecordedUiQualityCandidate(testCase),
          repairCount: 0,
          fallbackUsed: false,
          compositionFirstFailureCategory: "none",
          compositionFirstFailureCodes: [],
        })),
    });

    expect(report.samples[0]).toMatchObject({
      success: false,
      recipeId: "composition-error",
      firstFailureCategory: "composition_error",
      issueCodes: ["composition_error"],
    });
    expect(JSON.stringify(report)).not.toContain("private invalid composition output");
  });
});
