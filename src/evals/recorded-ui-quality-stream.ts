import { compileSurfacePlan } from "../../api/_lib/surface-plan.js";
import { compileSurfaceSpec } from "../../shared/compiler.js";
import {
  AgentRequestSchema,
  StreamEventSchema,
  type StreamEvent,
} from "../../shared/schemas.js";
import { lintSurfaceQuality } from "../../api/_lib/surface-quality.js";
import type { UiQualityCase } from "./ui-quality-cases.js";
import {
  recordedUiQualityCompilationInput,
  type RecordedUiQualityCandidate,
} from "./ui-quality-fixtures.js";
import {
  buildRecordedExtendedToolkitCandidate,
  buildRecordedGenerativeUiQualityCandidate,
  type GenerativeFixtureLayoutFamily,
} from "./generative-ui-quality-fixtures.js";
import { evaluateGenerativeSurfacePlanQuality } from "../../api/_lib/generative-surface-plan.js";

const RECORDED_AT = "2026-08-02T12:00:00.000Z";

export interface RecordedUiQualityStream {
  readonly candidate: RecordedUiQualityCandidate;
  readonly events: readonly StreamEvent[];
}

export function buildRecordedGenerativeUiQualityStream(
  testCase: UiQualityCase,
  request: unknown,
  family: GenerativeFixtureLayoutFamily | "extended",
): { readonly events: readonly StreamEvent[] } {
  const parsedRequest = AgentRequestSchema.parse(request);
  if (parsedRequest.prompt !== testCase.prompt) {
    throw new TypeError(`Recorded case ${testCase.id} does not match the submitted prompt.`);
  }
  const candidate = family === "extended"
    ? buildRecordedExtendedToolkitCandidate(testCase)
    : buildRecordedGenerativeUiQualityCandidate(testCase, family);
  const invariantChecks = evaluateGenerativeSurfacePlanQuality(
    candidate.plan,
    {
      sources: candidate.retrieval.sources,
      evidence: candidate.retrieval.evidence,
      prompt: parsedRequest.prompt,
      clientContext: parsedRequest.client,
    },
    candidate.spec,
  );
  const quality = lintSurfaceQuality({
    benchmark: testCase,
    plan: candidate.plan,
    spec: candidate.spec,
    sources: candidate.retrieval.sources,
    mode: "grammar-v3",
  });
  if (!quality.success || !Object.values(invariantChecks).every(Boolean)) {
    throw new TypeError(`Recorded grammar-v3 case ${testCase.id} failed its quality contract.`);
  }
  const messages = compileSurfaceSpec({
    surfaceId: `recorded-v3-${parsedRequest.requestId}`,
    spec: candidate.spec,
    sources: candidate.retrieval.sources,
  });
  return {
    events: StreamEventSchema.array().parse([
      {
        type: "status",
        stage: "accepted",
        message: "Request received",
        at: RECORDED_AT,
      },
      ...messages.map((message) => ({ type: "a2ui" as const, message })),
      {
        type: "done",
        requestId: parsedRequest.requestId,
        completedAt: RECORDED_AT,
        durationMs: 8,
        mode: "recorded-fixture",
        componentCount: candidate.spec.components.length,
        sourceCount: candidate.retrieval.sources.length,
      },
    ]),
  };
}

/**
 * Builds the browser benchmark stream from the same bounded artifacts as plan-v2:
 * recorded provider evidence -> validated SurfacePlan -> trusted SurfaceSpec -> A2UI.
 */
export function buildRecordedUiQualityStream(
  testCase: UiQualityCase,
  request: unknown,
): RecordedUiQualityStream {
  const parsedRequest = AgentRequestSchema.parse(request);
  if (parsedRequest.prompt !== testCase.prompt) {
    throw new TypeError(`Recorded case ${testCase.id} does not match the submitted prompt.`);
  }

  const recorded = recordedUiQualityCompilationInput(testCase);
  const spec = compileSurfacePlan({
    plan: recorded.plan,
    retrieval: recorded.retrieval,
    clientContext: parsedRequest.client,
    prompt: parsedRequest.prompt,
  });
  const candidate: RecordedUiQualityCandidate = {
    benchmark: testCase,
    plan: recorded.plan,
    spec,
    sources: recorded.retrieval.sources,
  };
  const quality = lintSurfaceQuality(candidate);
  if (!quality.success) {
    throw new TypeError(
      `Recorded case ${testCase.id} failed quality lint: ${quality.issues
        .map((issue) => issue.code)
        .join(", ")}`,
    );
  }

  const messages = compileSurfaceSpec({
    surfaceId: `recorded-${parsedRequest.requestId}`,
    spec,
    sources: candidate.sources,
  });
  const componentNames = [...new Set(spec.components.map((node) => node.component))];
  const sourceIds = candidate.sources.map((source) => source.id);
  const toolName = recorded.retrieval.evidence.some(
    (entry) => entry.tool === "get_weather_bundle",
  )
    ? "get_weather_bundle"
    : "google_search";
  const qualityChecks = Object.entries(quality.checks).map(([code, passed]) => ({
    code,
    passed,
  }));

  const events = StreamEventSchema.array().parse([
    {
      type: "status",
      stage: "accepted",
      message: "Request received",
      at: RECORDED_AT,
    },
    {
      type: "trace",
      trace: {
        id: `recorded-request-${testCase.id.toLocaleLowerCase("en-US")}`,
        stage: "request",
        label: "Understand request",
        status: "complete",
        durationMs: 1,
      },
    },
    {
      type: "status",
      stage: "retrieving",
      message: "Loading recorded evidence",
      at: RECORDED_AT,
    },
    {
      type: "trace",
      trace: {
        id: `recorded-tool-${testCase.id.toLocaleLowerCase("en-US")}`,
        stage: "tool",
        label: toolName === "get_weather_bundle" ? "Get weather bundle" : "Ground with Google Search",
        status: "complete",
        durationMs: 2,
        toolName,
        arguments: { fixture: testCase.fixture, recordedEvidence: true },
        sourceIds,
      },
    },
    {
      type: "status",
      stage: "composing",
      message: "Composing the interface",
      at: RECORDED_AT,
    },
    {
      type: "trace",
      trace: {
        id: `recorded-compose-${testCase.id.toLocaleLowerCase("en-US")}`,
        stage: "composition",
        label: "Compile recorded SurfacePlan",
        status: "complete",
        durationMs: 3,
        recipeId: candidate.plan.recipeId,
        density: candidate.plan.density,
        emphasis: candidate.plan.emphasis,
      },
    },
    {
      type: "status",
      stage: "validating",
      message: "Validating trusted components",
      at: RECORDED_AT,
    },
    {
      type: "trace",
      trace: {
        id: `recorded-validation-${testCase.id.toLocaleLowerCase("en-US")}`,
        stage: "validation",
        label: "Validate compiled A2UI",
        status: "complete",
        durationMs: 1,
        componentNames,
        validation: { valid: true, repairCount: 0, issues: [] },
        recipeId: candidate.plan.recipeId,
        density: candidate.plan.density,
        emphasis: candidate.plan.emphasis,
        qualityChecks,
        repairCategory: "none",
        compilerResult: "compiled",
      },
    },
    ...messages.map((message) => ({ type: "a2ui" as const, message })),
    {
      type: "trace",
      trace: {
        id: `recorded-render-${testCase.id.toLocaleLowerCase("en-US")}`,
        stage: "render",
        label: "Render trusted surface",
        status: "complete",
        durationMs: 1,
        componentNames,
      },
    },
    {
      type: "done",
      requestId: parsedRequest.requestId,
      completedAt: RECORDED_AT,
      durationMs: 8,
      mode: "recorded-fixture",
      componentCount: spec.components.length,
      sourceCount: candidate.sources.length,
    },
  ]);

  return { candidate, events };
}
