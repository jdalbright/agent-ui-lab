import { lintSurfaceQuality } from "../../api/_lib/surface-quality.js";
import { UI_QUALITY_CASES, type UiQualityCase } from "./ui-quality-cases.js";
import {
  type RecordedUiQualityCandidate,
  uiQualityStructuralFingerprint,
} from "./ui-quality-fixtures.js";

export interface LiveUiCompositionSample {
  readonly candidate: RecordedUiQualityCandidate;
  readonly repairCount: 0 | 1;
  readonly fallbackUsed: boolean;
}

export type LiveUiComposer = (
  testCase: UiQualityCase,
  run: 1 | 2 | 3,
) => Promise<LiveUiCompositionSample>;

export interface LiveUiQualitySampleResult {
  readonly caseId: string;
  readonly run: 1 | 2 | 3;
  readonly success: boolean;
  readonly firstPassValid: boolean;
  readonly repairCount: 0 | 1;
  readonly fallbackUsed: boolean;
  readonly latencyMs: number;
  readonly recipeId: string;
  readonly structuralFingerprint: string;
  readonly issueCodes: readonly string[];
}

export interface LiveUiQualityReport {
  readonly enabled: boolean;
  readonly samples: readonly LiveUiQualitySampleResult[];
  readonly totals: {
    readonly attempted: number;
    readonly valid: number;
    readonly firstPassValid: number;
    readonly repairs: number;
    readonly fallbacks: number;
  };
}

export interface RunLiveUiQualityEvaluationInput {
  readonly enabled: boolean;
  readonly compose: LiveUiComposer;
  readonly cases?: readonly UiQualityCase[];
  readonly now?: () => number;
}

function emptyReport(): LiveUiQualityReport {
  return {
    enabled: false,
    samples: [],
    totals: {
      attempted: 0,
      valid: 0,
      firstPassValid: 0,
      repairs: 0,
      fallbacks: 0,
    },
  };
}

export async function runLiveUiQualityEvaluation({
  enabled,
  compose,
  cases = UI_QUALITY_CASES,
  now = () => performance.now(),
}: RunLiveUiQualityEvaluationInput): Promise<LiveUiQualityReport> {
  if (!enabled) return emptyReport();

  const samples: LiveUiQualitySampleResult[] = [];
  for (const testCase of cases) {
    for (const run of [1, 2, 3] as const) {
      const startedAt = now();
      try {
        const sample = await compose(testCase, run);
        const latencyMs = Math.max(0, Math.round(now() - startedAt));
        const quality = lintSurfaceQuality(sample.candidate);
        const selectedRecipe = sample.candidate.plan.recipeId;
        samples.push({
          caseId: testCase.id,
          run,
          success: quality.success,
          firstPassValid: quality.success && sample.repairCount === 0 && !sample.fallbackUsed,
          repairCount: sample.repairCount,
          fallbackUsed: sample.fallbackUsed,
          latencyMs,
          recipeId: typeof selectedRecipe === "string" ? selectedRecipe : "unknown",
          structuralFingerprint: uiQualityStructuralFingerprint(sample.candidate),
          issueCodes: quality.issues.map((issue) => issue.code),
        });
      } catch {
        samples.push({
          caseId: testCase.id,
          run,
          success: false,
          firstPassValid: false,
          repairCount: 0,
          fallbackUsed: false,
          latencyMs: Math.max(0, Math.round(now() - startedAt)),
          recipeId: "provider-error",
          structuralFingerprint: "provider-error",
          issueCodes: ["provider_error"],
        });
      }
    }
  }

  return {
    enabled: true,
    samples,
    totals: {
      attempted: samples.length,
      valid: samples.filter((sample) => sample.success).length,
      firstPassValid: samples.filter((sample) => sample.firstPassValid).length,
      repairs: samples.filter((sample) => sample.repairCount > 0).length,
      fallbacks: samples.filter((sample) => sample.fallbackUsed).length,
    },
  };
}
