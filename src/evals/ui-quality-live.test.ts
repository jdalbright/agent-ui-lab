import { describe, expect, it } from "vitest";
import type { ClientContext, SurfaceSpec } from "@shared/schemas.js";
import type {
  SurfacePlanFirstFailureCategory,
  SurfacePlanFirstFailureCode,
  SurfacePlanSchemaIssueDiagnostic,
} from "../../api/_lib/composition.js";
import { createGeminiProvider, type GeminiRetrievalResult } from "../../api/_lib/gemini.js";
import type { SurfacePlan } from "../../api/_lib/surface-plan.js";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import { recordedUiQualityCompilationInput } from "./ui-quality-fixtures.js";
import {
  liveUiQualityDiagnostics,
  runLiveUiQualityEvaluation,
  selectLiveUiQualityCases,
} from "./ui-quality-live-runner.js";

const LIVE_REQUESTED = process.env.RUN_LIVE_UI_EVALS === "true";
const LIVE_ENABLED =
  LIVE_REQUESTED &&
  typeof process.env.GEMINI_API_KEY === "string" &&
  process.env.GEMINI_API_KEY.length > 0;
const FOCUSED_CASES_REQUESTED = LIVE_REQUESTED && Boolean(process.env.LIVE_UI_CASE_IDS?.trim());
const LIVE_CASES = LIVE_REQUESTED
  ? selectLiveUiQualityCases(process.env.LIVE_UI_CASE_IDS)
  : UI_QUALITY_CASES;

describe.skipIf(!LIVE_REQUESTED)("opt-in live UI composition evaluation", () => {
  it("meets the supported-case validity and fallback thresholds", async () => {
    if (!LIVE_ENABLED) {
      throw new TypeError("GEMINI_API_KEY is required when RUN_LIVE_UI_EVALS=true.");
    }
    const compositionModule = await import("../../api/_lib/composition.js") as unknown as {
      composeSurfacePlan?: (input: {
        gemini: ReturnType<typeof createGeminiProvider>;
        prompt: string;
        clientContext: ClientContext;
        retrieval: GeminiRetrievalResult;
        signal?: AbortSignal;
      }) => Promise<{
        plan: SurfacePlan;
        spec: SurfaceSpec;
        repairCount: 0 | 1;
        fallbackUsed: boolean;
        firstFailureCategory: SurfacePlanFirstFailureCategory;
        firstFailureCodes: readonly SurfacePlanFirstFailureCode[];
        schemaIssues: readonly SurfacePlanSchemaIssueDiagnostic[];
      }>;
    };
    if (!compositionModule.composeSurfacePlan) {
      throw new TypeError("composeSurfacePlan is unavailable; plan-v2 must be implemented first.");
    }
    const composeSurfacePlan = compositionModule.composeSurfacePlan;
    const gemini = createGeminiProvider();

    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      cases: LIVE_CASES,
      compose: async (testCase) => {
        const recorded = recordedUiQualityCompilationInput(testCase);
        const retrieval = recorded.retrieval;
        const result = await composeSurfacePlan({
          gemini,
          prompt: testCase.prompt,
          clientContext: recorded.clientContext,
          retrieval,
          signal: AbortSignal.timeout(45_000),
        });
        return {
          candidate: {
            benchmark: testCase,
            plan: result.plan,
            spec: result.spec,
            sources: retrieval.sources,
          },
          repairCount: result.repairCount,
          fallbackUsed: result.fallbackUsed,
          compositionFirstFailureCategory: result.firstFailureCategory,
          compositionFirstFailureCodes: result.firstFailureCodes,
          compositionSchemaIssues: result.schemaIssues,
        };
      },
    });

    for (const diagnostic of liveUiQualityDiagnostics(report)) {
      console.info(JSON.stringify(diagnostic));
    }

    expect(report.totals.attempted).toBe(LIVE_CASES.length * 3);
    if (!FOCUSED_CASES_REQUESTED) {
      const firstPassRate = report.totals.firstPassQualityValid / report.totals.attempted;
      expect(firstPassRate).toBeGreaterThanOrEqual(0.95);
    }
    expect(report.totals.fallbacks).toBe(0);
    expect(report.totals.qualityValid).toBe(report.totals.attempted);
    expect(report.totals.structuralConformant).toBe(report.totals.attempted);
    expect(report.totals.accepted).toBe(report.totals.attempted);
    expect(report.samples.every((sample) => sample.structuralConformant)).toBe(true);
    expect(new Set(report.samples.map((sample) => sample.recipeId))).toEqual(
      new Set(LIVE_CASES.map((testCase) => testCase.recipeId)),
    );
  }, 900_000);
});

describe.skipIf(LIVE_REQUESTED)("opt-in live UI composition evaluation", () => {
  it("stays disabled without both explicit opt-in and a Gemini key", () => {
    expect(LIVE_ENABLED).toBe(false);
  });
});
