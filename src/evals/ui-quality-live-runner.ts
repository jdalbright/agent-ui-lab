import {
  lintSurfaceQuality,
  type SurfaceQualityCheck,
} from "../../api/_lib/surface-quality.js";
import type {
  SurfacePlanFirstFailureCategory,
  SurfacePlanFirstFailureCode,
  SurfacePlanSchemaIssueDiagnostic,
} from "../../api/_lib/composition.js";
import { UI_QUALITY_CASES, type UiQualityCase } from "./ui-quality-cases.js";
import {
  evaluateUiQualityStructuralConformance,
  type RecordedUiQualityCandidate,
  type UiQualityStructuralConformanceIssue,
  uiQualityStructuralFingerprint,
} from "./ui-quality-fixtures.js";

export interface LiveUiCompositionSample {
  readonly candidate: RecordedUiQualityCandidate;
  readonly repairCount: 0 | 1;
  readonly fallbackUsed: boolean;
  readonly compositionFirstFailureCategory: SurfacePlanFirstFailureCategory;
  readonly compositionFirstFailureCodes: readonly SurfacePlanFirstFailureCode[];
  readonly compositionSchemaIssues?: readonly SurfacePlanSchemaIssueDiagnostic[];
}

export type LiveUiComposer = (
  testCase: UiQualityCase,
  run: 1 | 2 | 3,
) => Promise<LiveUiCompositionSample>;

export interface LiveUiQualitySampleResult {
  readonly caseId: string;
  readonly run: 1 | 2 | 3;
  readonly success: boolean;
  readonly qualityValid: boolean;
  readonly firstPassQualityValid: boolean;
  readonly structuralConformant: boolean;
  readonly repairCount: 0 | 1;
  readonly fallbackUsed: boolean;
  readonly latencyMs: number;
  readonly recipeId: string;
  readonly density: string;
  readonly emphasis: string;
  readonly componentNames: readonly string[];
  readonly compositionFirstFailureCategory: SurfacePlanFirstFailureCategory;
  readonly compositionFirstFailureCodes: readonly SurfacePlanFirstFailureCode[];
  readonly compositionSchemaIssues: readonly SurfacePlanSchemaIssueDiagnostic[];
  readonly firstFailureCategory:
    | SurfaceQualityCheck
    | "none"
    | "composition_repair"
    | "structural_mismatch"
    | "composition_error"
    | "provider_error";
  readonly structuralFingerprint: string;
  readonly structuralIssueCodes: readonly UiQualityStructuralConformanceIssue["code"][];
  readonly issueCodes: readonly string[];
  readonly missingFactConcepts: readonly string[];
}

export interface LiveUiQualityReport {
  readonly enabled: boolean;
  readonly samples: readonly LiveUiQualitySampleResult[];
  readonly totals: {
    readonly attempted: number;
    readonly accepted: number;
    readonly qualityValid: number;
    readonly firstPassQualityValid: number;
    readonly repairs: number;
    readonly fallbacks: number;
    readonly structuralConformant: number;
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
      accepted: 0,
      qualityValid: 0,
      firstPassQualityValid: 0,
      repairs: 0,
      fallbacks: 0,
      structuralConformant: 0,
    },
  };
}

function thrownFailureCategory(error: unknown): "composition_error" | "provider_error" {
  if (
    error instanceof Error &&
    (error.name === "GeminiProviderError" || error.name === "GeminiToolRoundLimitError")
  ) {
    return "provider_error";
  }
  return "composition_error";
}

export function selectLiveUiQualityCases(
  caseIds: string | undefined,
  availableCases: readonly UiQualityCase[] = UI_QUALITY_CASES,
): readonly UiQualityCase[] {
  if (!caseIds?.trim()) return availableCases;
  const requestedIds = [...new Set(
    caseIds.split(",").map((caseId) => caseId.trim().toLocaleUpperCase("en-US")).filter(Boolean),
  )];
  const casesById = new Map(availableCases.map((testCase) => [testCase.id, testCase]));
  const unknownIds = requestedIds.filter((caseId) => !casesById.has(caseId));
  if (unknownIds.length > 0) {
    throw new TypeError(`LIVE_UI_CASE_IDS contains unknown case IDs: ${unknownIds.join(", ")}.`);
  }
  return Object.freeze(
    requestedIds.map((caseId) => casesById.get(caseId)).filter(
      (testCase): testCase is UiQualityCase => Boolean(testCase),
    ),
  );
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
        const benchmarkedCandidate: RecordedUiQualityCandidate = {
          ...sample.candidate,
          benchmark: testCase,
        };
        const latencyMs = Math.max(0, Math.round(now() - startedAt));
        const quality = lintSurfaceQuality(benchmarkedCandidate);
        const selectedRecipe = sample.candidate.plan.recipeId;
        const componentNames = [...new Set(
          sample.candidate.spec.components.map((component) => component.component),
        )];
        const structuralFingerprint = uiQualityStructuralFingerprint(sample.candidate);
        const structural = evaluateUiQualityStructuralConformance(sample.candidate, testCase);
        const qualityValid = quality.success;
        const firstPassQualityValid =
          qualityValid && sample.repairCount === 0 && !sample.fallbackUsed;
        const success = qualityValid && structural.success;
        samples.push({
          caseId: testCase.id,
          run,
          success,
          qualityValid,
          firstPassQualityValid,
          structuralConformant: structural.success,
          repairCount: sample.repairCount,
          fallbackUsed: sample.fallbackUsed,
          latencyMs,
          recipeId: typeof selectedRecipe === "string" ? selectedRecipe : "unknown",
          density: sample.candidate.plan.density,
          emphasis: sample.candidate.plan.emphasis,
          componentNames,
          compositionFirstFailureCategory: sample.compositionFirstFailureCategory,
          compositionFirstFailureCodes: sample.compositionFirstFailureCodes.slice(0, 8),
          compositionSchemaIssues: sample.compositionSchemaIssues?.slice(0, 8) ?? [],
          firstFailureCategory:
            quality.issues[0]?.code ??
            (!structural.success
              ? "structural_mismatch"
              : sample.repairCount > 0
                ? "composition_repair"
                : "none"),
          structuralFingerprint,
          structuralIssueCodes: structural.issues.map((issue) => issue.code),
          issueCodes: [
            ...quality.issues.map((issue) => issue.code),
            ...structural.issues.map((issue) => issue.code),
          ],
          missingFactConcepts: quality.missingFactConcepts ?? [],
        });
      } catch (error) {
        const failureCategory = thrownFailureCategory(error);
        samples.push({
          caseId: testCase.id,
          run,
          success: false,
          qualityValid: false,
          firstPassQualityValid: false,
          structuralConformant: false,
          repairCount: 0,
          fallbackUsed: false,
          latencyMs: Math.max(0, Math.round(now() - startedAt)),
          recipeId: failureCategory === "provider_error" ? "provider-error" : "composition-error",
          density: "unknown",
          emphasis: "unknown",
          componentNames: [],
          compositionFirstFailureCategory: "none",
          compositionFirstFailureCodes: [],
          compositionSchemaIssues: [],
          firstFailureCategory: failureCategory,
          structuralFingerprint: failureCategory.replace("_", "-"),
          structuralIssueCodes: [],
          issueCodes: [failureCategory],
          missingFactConcepts: [],
        });
      }
    }
  }

  return {
    enabled: true,
    samples,
    totals: {
      attempted: samples.length,
      accepted: samples.filter((sample) => sample.success).length,
      qualityValid: samples.filter((sample) => sample.qualityValid).length,
      firstPassQualityValid: samples.filter((sample) => sample.firstPassQualityValid).length,
      repairs: samples.filter((sample) => sample.repairCount > 0).length,
      fallbacks: samples.filter((sample) => sample.fallbackUsed).length,
      structuralConformant: samples.filter((sample) => sample.structuralConformant).length,
    },
  };
}

export interface LiveUiQualitySummaryDiagnostic {
  readonly event: "ui_quality_live_summary";
  readonly totals: LiveUiQualityReport["totals"];
  readonly recipeSelections: Readonly<Record<string, number>>;
  readonly structuralFingerprints: number;
  readonly latencyMs: {
    readonly maximum: number;
    readonly average: number;
  };
}

export interface LiveUiQualityCaseDiagnostic {
  readonly event: "ui_quality_live_case";
  readonly caseId: string;
  readonly attempted: number;
  readonly accepted: number;
  readonly qualityValid: number;
  readonly firstPassQualityValid: number;
  readonly repairs: number;
  readonly fallbacks: number;
  readonly structuralConformant: number;
  readonly samples: ReadonlyArray<{
    readonly run: 1 | 2 | 3;
    readonly selectedRecipe: string;
    readonly density: string;
    readonly emphasis: string;
    readonly componentNames: readonly string[];
    readonly compositionFirstFailureCategory: SurfacePlanFirstFailureCategory;
    readonly compositionFirstFailureCodes: readonly SurfacePlanFirstFailureCode[];
    readonly compositionSchemaIssues: readonly SurfacePlanSchemaIssueDiagnostic[];
    readonly firstFailureCategory: LiveUiQualitySampleResult["firstFailureCategory"];
    readonly qualityValid: boolean;
    readonly structuralConformant: boolean;
    readonly structuralIssueCodes: readonly UiQualityStructuralConformanceIssue["code"][];
    readonly missingFactConcepts: readonly string[];
    readonly structuralFingerprintId: string;
    readonly repairCount: 0 | 1;
    readonly fallbackUsed: boolean;
  }>;
}

export type LiveUiQualityDiagnostic =
  | LiveUiQualitySummaryDiagnostic
  | LiveUiQualityCaseDiagnostic;

function structuralFingerprintId(fingerprint: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Builds prompt- and evidence-free records that are safe to print one per line
 * in CI logs. A separate bounded record per case prevents a provider's log-line
 * limit from truncating every case after the first few samples.
 */
export function liveUiQualityDiagnostics(
  report: LiveUiQualityReport,
): readonly LiveUiQualityDiagnostic[] {
  const caseIds = [...new Set(report.samples.map((sample) => sample.caseId))];
  const summary: LiveUiQualitySummaryDiagnostic = {
    event: "ui_quality_live_summary",
    totals: report.totals,
    recipeSelections: Object.fromEntries(
      [...new Set([
        ...UI_QUALITY_CASES.map((testCase) => testCase.recipeId),
        ...report.samples.map((sample) => sample.recipeId),
      ])].map((recipeId) => [
        recipeId,
        report.samples.filter((sample) => sample.recipeId === recipeId).length,
      ]),
    ),
    structuralFingerprints: new Set(
      report.samples.map((sample) => sample.structuralFingerprint),
    ).size,
    latencyMs: {
      maximum: Math.max(0, ...report.samples.map((sample) => sample.latencyMs)),
      average: report.samples.length === 0
        ? 0
        : Math.round(
          report.samples.reduce((total, sample) => total + sample.latencyMs, 0) /
            report.samples.length,
        ),
    },
  };

  const caseRecords: LiveUiQualityCaseDiagnostic[] = caseIds.map((caseId) => {
    const samples = report.samples.filter((sample) => sample.caseId === caseId);
    return {
      event: "ui_quality_live_case",
      caseId,
      attempted: samples.length,
      accepted: samples.filter((sample) => sample.success).length,
      qualityValid: samples.filter((sample) => sample.qualityValid).length,
      firstPassQualityValid: samples.filter((sample) => sample.firstPassQualityValid).length,
      repairs: samples.filter((sample) => sample.repairCount > 0).length,
      fallbacks: samples.filter((sample) => sample.fallbackUsed).length,
      structuralConformant: samples.filter((sample) => sample.structuralConformant).length,
      samples: samples.map((sample) => ({
        run: sample.run,
        selectedRecipe: sample.recipeId,
        density: sample.density,
        emphasis: sample.emphasis,
        componentNames: sample.componentNames,
        compositionFirstFailureCategory: sample.compositionFirstFailureCategory,
        compositionFirstFailureCodes: sample.compositionFirstFailureCodes,
        compositionSchemaIssues: sample.compositionSchemaIssues,
        firstFailureCategory: sample.firstFailureCategory,
        qualityValid: sample.qualityValid,
        structuralConformant: sample.structuralConformant,
        structuralIssueCodes: sample.structuralIssueCodes,
        missingFactConcepts: sample.missingFactConcepts,
        structuralFingerprintId: structuralFingerprintId(sample.structuralFingerprint),
        repairCount: sample.repairCount,
        fallbackUsed: sample.fallbackUsed,
      })),
    };
  });

  return [summary, ...caseRecords];
}
