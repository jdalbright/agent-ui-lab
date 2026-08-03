import { describe, expect, it, vi } from "vitest";
import type { ClientContext, SourceRecord, SurfaceSpec } from "../../shared/schemas.js";
import type {
  GeminiClient,
  GeminiRetrievalResult,
  GeminiStructuredOutputRequest,
} from "./gemini.js";
import * as compositionModule from "./composition.js";

type PlanStructuredOutputRequest = GeminiStructuredOutputRequest & {
  functionName?: string;
};

interface PlanCompositionResult {
  plan: unknown;
  spec: SurfaceSpec;
  repairCount: 0 | 1;
  fallbackUsed: boolean;
  metadata: {
    recipeId: string;
    density: string;
    emphasis: string;
    qualityChecks: readonly unknown[];
    repairCategory: string;
    compilerResult: string;
  };
}

type ComposeSurfacePlan = (input: {
  gemini: GeminiClient;
  prompt: string;
  clientContext: ClientContext;
  retrieval: GeminiRetrievalResult;
  signal?: AbortSignal;
}) => Promise<PlanCompositionResult>;

const composeSurfacePlan = (
  compositionModule as unknown as { composeSurfacePlan?: ComposeSurfacePlan }
).composeSurfacePlan;

const clientContext: ClientContext = {
  sizeClass: "expanded",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

const sources: readonly SourceRecord[] = Object.freeze([
  Object.freeze({
    id: "src_research1",
    title: "Primary documentation",
    url: "https://example.com/primary",
    provider: "google-search" as const,
    accessedAt: "2026-08-02T14:00:00.000Z",
  }),
  Object.freeze({
    id: "src_research2",
    title: "Independent analysis",
    url: "https://example.org/analysis",
    provider: "google-search" as const,
    accessedAt: "2026-08-02T14:00:00.000Z",
  }),
]);

const retrieval: GeminiRetrievalResult = {
  outputText: "The primary documentation and independent analysis agree on the core result.",
  sources,
  steps: Object.freeze([]),
  evidence: Object.freeze([]),
  toolRounds: 0,
};

const validPlan = {
  kind: "research",
  recipeId: "research.brief",
  density: "brief",
  emphasis: "answer",
  modules: [
    {
      type: "lead",
      variant: "feature",
      title: "The core result is well supported",
      summary: "Both supplied sources support the concise answer.",
      sourceIds: sources.map((source) => source.id),
    },
    {
      type: "evidence",
      variant: "stack",
      label: "Evidence",
      items: [
        {
          title: "Primary source",
          finding: "The primary documentation states the result directly.",
          sourceId: sources[0]?.id,
          stance: "support",
        },
      ],
    },
    {
      type: "sources",
      label: "Sources",
      sourceIds: sources.map((source) => source.id),
    },
  ],
} as const;

const semanticallyInvalidPlan = {
  ...validPlan,
  recipeId: "research.timeline",
};

function response(output: unknown): { text: string } {
  return { text: typeof output === "string" ? output : JSON.stringify(output) };
}

function fakeClient(outputs: readonly unknown[]) {
  const remaining = [...outputs];
  const requests: PlanStructuredOutputRequest[] = [];
  const generate = vi.fn((request: GeminiStructuredOutputRequest) => {
    requests.push(request as PlanStructuredOutputRequest);
    const next = remaining.shift();
    if (next === undefined) throw new Error("No fake plan response remains");
    return Promise.resolve(response(next));
  });

  return {
    client: {
      interactions: { create: vi.fn() },
      structuredOutput: { generate },
    } as unknown as GeminiClient,
    requests,
  };
}

function compose(client: GeminiClient): Promise<PlanCompositionResult> {
  if (!composeSurfacePlan) throw new TypeError("composeSurfacePlan is not implemented");
  return composeSurfacePlan({
    gemini: client,
    prompt: "Research the current result and show the supporting evidence.",
    clientContext,
    retrieval,
  });
}

describe("composeSurfacePlan", () => {
  it("uses a separate emit_surface_plan schema call and compiles the validated plan", async () => {
    const { client, requests } = fakeClient([validPlan]);

    const result = await compose(client);

    expect(result).toMatchObject({
      plan: validPlan,
      repairCount: 0,
      fallbackUsed: false,
      metadata: {
        recipeId: "research.brief",
        density: "brief",
        emphasis: "answer",
        repairCategory: "none",
        compilerResult: "compiled",
      },
      spec: {
        kind: "research",
      },
    });
    expect(Array.isArray(result.metadata.qualityChecks)).toBe(true);
    expect(result.spec.components.find((component) => component.id === result.spec.rootId)).toMatchObject({
      component: "SurfaceFrame",
      recipeId: "research.brief",
      density: "brief",
      emphasis: "answer",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.functionName).toBe("emit_surface_plan");
    expect(requests[0]?.systemInstruction).toMatch(/SurfacePlan|recipe/i);
    expect(requests[0]?.input).toContain("Evidence payload:");
    expect(requests[0]?.schema).toMatchObject({
      type: "object",
      properties: {
        kind: { enum: ["research"] },
        recipeId: {
          enum: ["research.brief", "research.timeline", "research.claims"],
        },
        density: { enum: ["brief", "balanced", "detailed"] },
        emphasis: { enum: ["answer", "decision", "trend", "evidence", "risk"] },
        modules: { type: "array" },
      },
      required: ["kind", "recipeId", "density", "emphasis", "modules"],
    });
    expect(requests[0]?.schema).not.toHaveProperty("properties.components");
    expect(requests[0]?.schema).not.toHaveProperty("properties.rootId");
    expect("tools" in (requests[0] ?? {})).toBe(false);
  });

  it("makes one bounded repair and then compiles the replacement plan", async () => {
    const { client, requests } = fakeClient([semanticallyInvalidPlan, validPlan]);

    const result = await compose(client);

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: false,
      metadata: {
        recipeId: "research.brief",
        repairCategory: "semantic",
        compilerResult: "compiled",
      },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.functionName).toBe("emit_surface_plan");
    expect(requests[1]?.input).toMatch(/repair|validation/i);
    expect("tools" in (requests[1] ?? {})).toBe(false);
  });

  it("uses a deterministic domain recipe and safe metadata after the repair also fails", async () => {
    const firstClient = fakeClient([semanticallyInvalidPlan, semanticallyInvalidPlan]);
    const secondClient = fakeClient([semanticallyInvalidPlan, semanticallyInvalidPlan]);

    const first = await compose(firstClient.client);
    const second = await compose(secondClient.client);

    expect(firstClient.requests).toHaveLength(2);
    expect(secondClient.requests).toHaveLength(2);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      plan: {
        kind: "research",
        recipeId: "research.brief",
      },
      spec: {
        kind: "research",
      },
      repairCount: 1,
      fallbackUsed: true,
      metadata: {
        recipeId: "research.brief",
        density: "brief",
        emphasis: "answer",
        repairCategory: "semantic",
        compilerResult: "deterministic-fallback",
      },
    });
    expect(Array.isArray(first.metadata.qualityChecks)).toBe(true);
    expect(JSON.stringify(first.metadata)).not.toMatch(
      /current result|supporting evidence|primary documentation|independent analysis/i,
    );
  });
});
