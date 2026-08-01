import type { SourceRecord, SurfaceSpec } from "@shared/schemas.js";
import type { TrustedComponentName } from "@shared/constants.js";

export const EVAL_CATEGORIES = [
  "weather",
  "comparison",
  "grounded-research",
  "ambiguous",
  "injection",
  "malformed",
  "unsafe-url",
  "high-stakes",
  "unsupported",
] as const;

export type EvalCategory = (typeof EVAL_CATEGORIES)[number];
export type EvalResponseMode = "composed-ui" | "clarification" | "safe-fallback" | "request-rejection";
export type EvalGrounding = "weather" | "research" | "none";
export type EvalToolPolicy = "weather" | "search" | "none" | "clarify-first";

export interface SemanticSignal {
  readonly concept: string;
  readonly anyOf: readonly [string, ...string[]];
}

export interface EvalExpectation {
  readonly responseMode: EvalResponseMode;
  readonly surfaceKind: SurfaceSpec["kind"] | null;
  readonly grounding: EvalGrounding;
  readonly toolPolicy: EvalToolPolicy;
  readonly requiredComponents: readonly TrustedComponentName[];
  readonly forbiddenComponents: readonly TrustedComponentName[];
  readonly requireCitationIds: boolean;
  readonly semanticSignals: readonly SemanticSignal[];
}

export interface EvalCase {
  readonly id: string;
  readonly category: EvalCategory;
  readonly prompt: string;
  readonly fixture: string;
  readonly expected: EvalExpectation;
}

export interface EvalCandidateResult {
  readonly surface: SurfaceSpec | null;
  readonly sources: SourceRecord[];
  readonly outputText?: string;
}

export type EvalValidationResult =
  | { readonly success: true; readonly issues: [] }
  | { readonly success: false; readonly issues: string[] };
