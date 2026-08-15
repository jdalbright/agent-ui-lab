import { describe, expect, it } from "vitest";
import { composeGenerativeSurfacePlan } from "../../api/_lib/composition.js";
import { createGeminiProvider } from "../../api/_lib/gemini.js";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import { recordedUiQualityCompilationInput } from "./ui-quality-fixtures.js";
import {
  generativeUiQualityDiagnostics,
  runGenerativeUiQualityEvaluation,
} from "./generative-ui-quality-live-runner.js";
import { selectLiveUiQualityCases } from "./ui-quality-live-runner.js";

const LIVE_REQUESTED = process.env.RUN_LIVE_GENERATIVE_UI_EVALS === "true";
const LIVE_ENABLED = LIVE_REQUESTED && Boolean(process.env.GEMINI_API_KEY?.trim());
const FOCUSED_CASES_REQUESTED = LIVE_REQUESTED && Boolean(process.env.LIVE_UI_CASE_IDS?.trim());
const LIVE_CASES = LIVE_REQUESTED
  ? selectLiveUiQualityCases(process.env.LIVE_UI_CASE_IDS)
  : UI_QUALITY_CASES;

describe.skipIf(!LIVE_REQUESTED)("opt-in live grammar-v3 composition evaluation", () => {
  it("meets invariant, semantic, first-pass, and no-fallback thresholds", async () => {
    if (!LIVE_ENABLED) {
      throw new TypeError(
        "GEMINI_API_KEY is required when RUN_LIVE_GENERATIVE_UI_EVALS=true.",
      );
    }
    const gemini = createGeminiProvider();
    const report = await runGenerativeUiQualityEvaluation({
      enabled: true,
      cases: LIVE_CASES,
      compose: async (testCase) => {
        const recorded = recordedUiQualityCompilationInput(testCase);
        const result = await composeGenerativeSurfacePlan({
          gemini,
          prompt: testCase.prompt,
          clientContext: recorded.clientContext,
          retrieval: recorded.retrieval,
          signal: AbortSignal.timeout(45_000),
        });
        return {
          ...(result.plan
            ? {
                candidate: {
                  plan: result.plan,
                  spec: result.spec,
                  retrieval: recorded.retrieval,
                  clientContext: recorded.clientContext,
                },
              }
            : {}),
          repairCount: result.repairCount,
          fallbackUsed: result.fallbackUsed,
          compositionFirstFailureCategory: result.firstFailureCategory,
          compositionFirstFailureCodes: result.firstFailureCodes,
          compositionSchemaIssues: result.schemaIssues,
        };
      },
    });

    for (const diagnostic of generativeUiQualityDiagnostics(report)) {
      console.info(JSON.stringify(diagnostic));
    }

    expect(report.totals.attempted).toBe(LIVE_CASES.length * 3);
    if (!FOCUSED_CASES_REQUESTED) {
      expect(report.totals.firstPassQualityValid).toBeGreaterThanOrEqual(52);
    }
    expect(report.totals.fallbacks).toBe(0);
    expect(report.totals.qualityValid).toBe(report.totals.attempted);
    expect(report.totals.invariantConformant).toBe(report.totals.attempted);
    expect(report.totals.accepted).toBe(report.totals.attempted);
  }, 900_000);
});

describe.skipIf(LIVE_REQUESTED)("opt-in live grammar-v3 composition evaluation", () => {
  it("stays disabled without explicit opt-in", () => {
    expect(LIVE_ENABLED).toBe(false);
  });
});
