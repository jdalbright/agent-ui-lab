import { describe, expect, it } from "vitest";
import type { ClientContext, SurfaceSpec } from "@shared/schemas.js";
import { createGeminiProvider, type GeminiRetrievalResult } from "../../api/_lib/gemini.js";
import type { SurfacePlan } from "../../api/_lib/surface-plan.js";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import { recordedUiQualityCompilationInput } from "./ui-quality-fixtures.js";
import { runLiveUiQualityEvaluation } from "./ui-quality-live-runner.js";

const LIVE_ENABLED =
  process.env.RUN_LIVE_UI_EVALS === "true" &&
  typeof process.env.GEMINI_API_KEY === "string" &&
  process.env.GEMINI_API_KEY.length > 0;

describe.skipIf(!LIVE_ENABLED)("opt-in live UI composition evaluation", () => {
  it("meets the supported-case validity and fallback thresholds", async () => {
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
      }>;
    };
    if (!compositionModule.composeSurfacePlan) {
      throw new TypeError("composeSurfacePlan is unavailable; plan-v2 must be implemented first.");
    }
    const composeSurfacePlan = compositionModule.composeSurfacePlan;
    const gemini = createGeminiProvider();

    const report = await runLiveUiQualityEvaluation({
      enabled: true,
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
        };
      },
    });

    console.info(JSON.stringify({
      event: "ui_quality_live_report",
      totals: report.totals,
      cases: Object.fromEntries(
        UI_QUALITY_CASES.map((testCase) => {
          const samples = report.samples.filter((sample) => sample.caseId === testCase.id);
          return [
            testCase.id,
            {
              attempted: samples.length,
              valid: samples.filter((sample) => sample.success).length,
              firstPassValid: samples.filter((sample) => sample.firstPassValid).length,
              repairs: samples.filter((sample) => sample.repairCount > 0).length,
              fallbacks: samples.filter((sample) => sample.fallbackUsed).length,
              recipeSelections: [...new Set(samples.map((sample) => sample.recipeId))],
              issueCodes: [...new Set(samples.flatMap((sample) => sample.issueCodes))],
            },
          ];
        }),
      ),
      recipeSelections: Object.fromEntries(
        UI_QUALITY_CASES.map((testCase) => [
          testCase.recipeId,
          report.samples.filter((sample) => sample.recipeId === testCase.recipeId).length,
        ]),
      ),
      structuralFingerprints: new Set(
        report.samples.map((sample) => sample.structuralFingerprint),
      ).size,
      latencyMs: {
        maximum: Math.max(...report.samples.map((sample) => sample.latencyMs)),
        average: Math.round(
          report.samples.reduce((total, sample) => total + sample.latencyMs, 0) /
            report.samples.length,
        ),
      },
    }));

    const firstPassRate = report.totals.firstPassValid / report.totals.attempted;
    expect(report.totals.attempted).toBe(UI_QUALITY_CASES.length * 3);
    expect(firstPassRate).toBeGreaterThanOrEqual(0.95);
    expect(report.totals.fallbacks).toBe(0);
    expect(report.totals.valid).toBe(report.totals.attempted);
    expect(new Set(report.samples.map((sample) => sample.recipeId))).toEqual(
      new Set(UI_QUALITY_CASES.map((testCase) => testCase.recipeId)),
    );
  }, 900_000);
});

describe.skipIf(LIVE_ENABLED)("opt-in live UI composition evaluation", () => {
  it("stays disabled without both explicit opt-in and a Gemini key", () => {
    expect(LIVE_ENABLED).toBe(false);
  });
});
