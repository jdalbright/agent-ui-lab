import type { ClientContext, SurfaceSpec } from "../../shared/schemas.js";
import type {
  SurfacePlanFirstFailureCategory,
  SurfacePlanSchemaIssueDiagnostic,
} from "../../api/_lib/composition.js";
import {
  evaluateGenerativeSurfacePlanQuality,
  type GenerativeSurfacePlan,
  type GenerativeSurfaceQualityCode,
} from "../../api/_lib/generative-surface-plan.js";
import type { GeminiRetrievalResult } from "../../api/_lib/gemini.js";
import { lintSurfaceQuality, type SurfaceQualityCheck } from "../../api/_lib/surface-quality.js";
import { UI_QUALITY_CASES, type UiQualityCase } from "./ui-quality-cases.js";

export interface GenerativeUiQualityCandidate {
  readonly plan: GenerativeSurfacePlan;
  readonly spec: SurfaceSpec;
  readonly retrieval: GeminiRetrievalResult;
  readonly clientContext: ClientContext;
}

export interface GenerativeLiveUiCompositionSample {
  readonly candidate?: GenerativeUiQualityCandidate;
  readonly repairCount: 0 | 1;
  readonly fallbackUsed: boolean;
  readonly compositionFirstFailureCategory: SurfacePlanFirstFailureCategory;
  readonly compositionFirstFailureCodes: readonly string[];
  readonly compositionSchemaIssues?: readonly SurfacePlanSchemaIssueDiagnostic[];
}

export type GenerativeLiveUiComposer = (
  testCase: UiQualityCase,
  run: 1 | 2 | 3,
) => Promise<GenerativeLiveUiCompositionSample>;

export interface GenerativeUiQualitySampleResult {
  readonly caseId: string;
  readonly run: 1 | 2 | 3;
  readonly success: boolean;
  readonly qualityValid: boolean;
  readonly firstPassQualityValid: boolean;
  readonly invariantConformant: boolean;
  readonly repairCount: 0 | 1;
  readonly fallbackUsed: boolean;
  readonly latencyMs: number;
  readonly density: string;
  readonly emphasis: string;
  readonly layoutFamily: string;
  readonly contentNodeCount: number;
  readonly layoutNodeCount: number;
  readonly componentNames: readonly string[];
  readonly structuralFingerprintId: string;
  readonly compositionFirstFailureCategory: SurfacePlanFirstFailureCategory;
  readonly compositionFirstFailureCodes: readonly string[];
  readonly compositionSchemaIssues: readonly SurfacePlanSchemaIssueDiagnostic[];
  readonly firstFailureCategory:
    | SurfaceQualityCheck
    | GenerativeSurfaceQualityCode
    | "none"
    | "fallback_used"
    | "composition_error"
    | "provider_error";
  readonly issueCodes: readonly string[];
  readonly missingFactConcepts: readonly string[];
}

export interface GenerativeUiQualityReport {
  readonly enabled: boolean;
  readonly samples: readonly GenerativeUiQualitySampleResult[];
  readonly totals: {
    readonly attempted: number;
    readonly accepted: number;
    readonly qualityValid: number;
    readonly firstPassQualityValid: number;
    readonly repairs: number;
    readonly fallbacks: number;
    readonly invariantConformant: number;
  };
}

export interface RunGenerativeUiQualityEvaluationInput {
  readonly enabled: boolean;
  readonly compose: GenerativeLiveUiComposer;
  readonly cases?: readonly UiQualityCase[];
  readonly now?: () => number;
}

function emptyReport(): GenerativeUiQualityReport {
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
      invariantConformant: 0,
    },
  };
}

function thrownFailureCategory(error: unknown): "composition_error" | "provider_error" {
  return error instanceof Error &&
      (error.name === "GeminiProviderError" || error.name === "GeminiToolRoundLimitError")
    ? "provider_error"
    : "composition_error";
}

function fingerprintId(candidate: GenerativeUiQualityCandidate): string {
  const structural = JSON.stringify({
    kind: candidate.plan.kind,
    density: candidate.plan.density,
    emphasis: candidate.plan.emphasis,
    rootId: candidate.plan.layout.rootId,
    layout: candidate.plan.layout.nodes.map((node) => ({
      type: node.type,
      children: "children" in node ? node.children : [],
    })),
    components: candidate.spec.components.map((node) => ({
      component: node.component,
      variant: "variant" in node ? node.variant : undefined,
    })),
  });
  let hash = 2_166_136_261;
  for (let index = 0; index < structural.length; index += 1) {
    hash ^= structural.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function runGenerativeUiQualityEvaluation({
  enabled,
  compose,
  cases = UI_QUALITY_CASES,
  now = () => performance.now(),
}: RunGenerativeUiQualityEvaluationInput): Promise<GenerativeUiQualityReport> {
  if (!enabled) return emptyReport();

  const samples: GenerativeUiQualitySampleResult[] = [];
  for (const testCase of cases) {
    for (const run of [1, 2, 3] as const) {
      const startedAt = now();
      try {
        const sample = await compose(testCase, run);
        if (!sample.candidate) {
          if (!sample.fallbackUsed) {
            throw new TypeError("A grammar-v3 composition sample is missing its candidate.");
          }
          samples.push({
            caseId: testCase.id,
            run,
            success: false,
            qualityValid: false,
            firstPassQualityValid: false,
            invariantConformant: false,
            repairCount: sample.repairCount,
            fallbackUsed: true,
            latencyMs: Math.max(0, Math.round(now() - startedAt)),
            density: "plan-v2-fallback",
            emphasis: "plan-v2-fallback",
            layoutFamily: "plan-v2-fallback",
            contentNodeCount: 0,
            layoutNodeCount: 0,
            componentNames: [],
            structuralFingerprintId: "plan-v2-fallback",
            compositionFirstFailureCategory: sample.compositionFirstFailureCategory,
            compositionFirstFailureCodes: sample.compositionFirstFailureCodes.slice(0, 8),
            compositionSchemaIssues: sample.compositionSchemaIssues?.slice(0, 8) ?? [],
            firstFailureCategory: "fallback_used",
            issueCodes: ["fallback_used"],
            missingFactConcepts: [],
          });
          continue;
        }
        const candidate = sample.candidate;
        const invariantChecks = evaluateGenerativeSurfacePlanQuality(
          candidate.plan,
          {
            sources: candidate.retrieval.sources,
            evidence: candidate.retrieval.evidence,
            prompt: testCase.prompt,
            clientContext: candidate.clientContext,
          },
          candidate.spec,
        );
        const invariantIssueCodes = Object.entries(invariantChecks)
          .filter(([, passed]) => !passed)
          .map(([code]) => code as GenerativeSurfaceQualityCode);
        const semantic = lintSurfaceQuality({
          benchmark: testCase,
          plan: candidate.plan,
          spec: candidate.spec,
          sources: candidate.retrieval.sources,
          mode: "grammar-v3",
        });
        const invariantConformant = invariantIssueCodes.length === 0 && !sample.fallbackUsed;
        const qualityValid = semantic.success && invariantConformant;
        const success = qualityValid && !sample.fallbackUsed;
        const rootLayout = candidate.plan.layout.nodes.find(
          (node) => node.id === candidate.plan.layout.rootId,
        );
        samples.push({
          caseId: testCase.id,
          run,
          success,
          qualityValid,
          firstPassQualityValid: success && sample.repairCount === 0,
          invariantConformant,
          repairCount: sample.repairCount,
          fallbackUsed: sample.fallbackUsed,
          latencyMs: Math.max(0, Math.round(now() - startedAt)),
          density: candidate.plan.density,
          emphasis: candidate.plan.emphasis,
          layoutFamily: rootLayout?.type ?? "unknown",
          contentNodeCount: candidate.plan.content.length,
          layoutNodeCount: candidate.plan.layout.nodes.length,
          componentNames: [...new Set(candidate.spec.components.map((node) => node.component))],
          structuralFingerprintId: fingerprintId(candidate),
          compositionFirstFailureCategory: sample.compositionFirstFailureCategory,
          compositionFirstFailureCodes: sample.compositionFirstFailureCodes.slice(0, 8),
          compositionSchemaIssues: sample.compositionSchemaIssues?.slice(0, 8) ?? [],
          firstFailureCategory: sample.fallbackUsed
            ? "fallback_used"
            : semantic.issues[0]?.code ?? invariantIssueCodes[0] ?? "none",
          issueCodes: [
            ...semantic.issues.map((issue) => issue.code),
            ...invariantIssueCodes,
            ...(sample.fallbackUsed ? ["fallback_used"] : []),
          ],
          missingFactConcepts: semantic.missingFactConcepts ?? [],
        });
      } catch (error) {
        const category = thrownFailureCategory(error);
        samples.push({
          caseId: testCase.id,
          run,
          success: false,
          qualityValid: false,
          firstPassQualityValid: false,
          invariantConformant: false,
          repairCount: 0,
          fallbackUsed: false,
          latencyMs: Math.max(0, Math.round(now() - startedAt)),
          density: "unknown",
          emphasis: "unknown",
          layoutFamily: "unknown",
          contentNodeCount: 0,
          layoutNodeCount: 0,
          componentNames: [],
          structuralFingerprintId: category.replace("_", "-"),
          compositionFirstFailureCategory: "none",
          compositionFirstFailureCodes: [],
          compositionSchemaIssues: [],
          firstFailureCategory: category,
          issueCodes: [category],
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
      invariantConformant: samples.filter((sample) => sample.invariantConformant).length,
    },
  };
}

export type GenerativeUiQualityDiagnostic =
  | {
      readonly event: "generative_ui_quality_live_summary";
      readonly totals: GenerativeUiQualityReport["totals"];
      readonly layoutFamilies: Readonly<Record<string, number>>;
      readonly structuralFingerprints: number;
    }
  | {
      readonly event: "generative_ui_quality_live_case";
      readonly caseId: string;
      readonly attempted: number;
      readonly accepted: number;
      readonly samples: readonly Omit<GenerativeUiQualitySampleResult, "caseId" | "success" | "latencyMs">[];
    };

export function generativeUiQualityDiagnostics(
  report: GenerativeUiQualityReport,
): readonly GenerativeUiQualityDiagnostic[] {
  const layoutFamilies = [...new Set(report.samples.map((sample) => sample.layoutFamily))];
  const summary: GenerativeUiQualityDiagnostic = {
    event: "generative_ui_quality_live_summary",
    totals: report.totals,
    layoutFamilies: Object.fromEntries(layoutFamilies.map((family) => [
      family,
      report.samples.filter((sample) => sample.layoutFamily === family).length,
    ])),
    structuralFingerprints: new Set(
      report.samples.map((sample) => sample.structuralFingerprintId),
    ).size,
  };
  const cases: GenerativeUiQualityDiagnostic[] = [
    ...new Set(report.samples.map((sample) => sample.caseId)),
  ].map((caseId) => {
    const samples = report.samples.filter((sample) => sample.caseId === caseId);
    return {
      event: "generative_ui_quality_live_case",
      caseId,
      attempted: samples.length,
      accepted: samples.filter((sample) => sample.success).length,
      samples: samples.map((sample) => {
        const { caseId, success, latencyMs, ...diagnostic } = sample;
        void caseId;
        void success;
        void latencyMs;
        return diagnostic;
      }),
    };
  });
  return [summary, ...cases];
}
