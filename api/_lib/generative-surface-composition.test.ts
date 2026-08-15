import { describe, expect, it, vi } from "vitest";
import type { ClientContext, SourceRecord } from "../../shared/schemas.js";
import type {
  GeminiClient,
  GeminiRetrievalResult,
  GeminiStructuredOutputRequest,
} from "./gemini.js";
import { composeGenerativeSurfacePlan } from "./composition.js";
import type { GenerativeSurfacePlan } from "./generative-surface-plan.js";

const clientContext: ClientContext = {
  sizeClass: "expanded",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

const sources: readonly SourceRecord[] = [
  {
    id: "src_research1",
    title: "Primary documentation",
    url: "https://example.com/primary",
    provider: "google-search",
    accessedAt: "2026-08-15T14:00:00.000Z",
    snippet: "The current result is supported by the primary documentation.",
  },
];

const retrieval: GeminiRetrievalResult = {
  outputText: "The current result is supported by the primary documentation.",
  sources,
  steps: [],
  evidence: [],
  toolRounds: 1,
};

const validPlan = {
  version: "v3",
  kind: "research",
  density: "balanced",
  emphasis: "evidence",
  archetypeHint: "research.brief",
  content: [
    {
      id: "lead-content",
      module: {
        type: "lead",
        variant: "brief",
        title: "Current result",
        summary: "The supplied primary documentation supports the current result.",
        sourceIds: ["src_research1"],
      },
    },
    {
      id: "evidence-content",
      module: {
        type: "evidence",
        variant: "grid",
        label: "Supporting evidence",
        items: [
          {
            title: "Primary documentation",
            finding: "The primary documentation states the current result directly.",
            sourceId: "src_research1",
            stance: "support",
          },
        ],
      },
    },
    {
      id: "source-content",
      module: {
        type: "sources",
        label: "Sources",
        sourceIds: ["src_research1"],
      },
    },
  ],
  layout: {
    rootId: "layout-root",
    nodes: [
      {
        id: "layout-root",
        type: "stack",
        children: ["lead-content", "evidence-card"],
        gap: "generous",
        align: "stretch",
      },
      {
        id: "evidence-card",
        type: "card",
        children: ["evidence-content"],
        tone: "neutral",
        prominence: "standard",
      },
    ],
  },
} as const satisfies GenerativeSurfacePlan;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fakeClient(outputs: readonly unknown[]) {
  const remaining = [...outputs];
  const requests: GeminiStructuredOutputRequest[] = [];
  const generate = vi.fn((request: GeminiStructuredOutputRequest) => {
    requests.push(request);
    const next = remaining.shift();
    if (next === undefined) throw new Error("No fake grammar response remains.");
    return Promise.resolve({ text: typeof next === "string" ? next : JSON.stringify(next) });
  });
  return {
    client: {
      interactions: { create: vi.fn() },
      structuredOutput: { generate },
    } as unknown as GeminiClient,
    generate,
    requests,
  };
}

const compose = (client: GeminiClient) => composeGenerativeSurfacePlan({
  gemini: client,
  prompt: "Research the current result and show the supporting evidence.",
  clientContext,
  retrieval,
});

describe("composeGenerativeSurfacePlan", () => {
  it("generates and compiles a recipe-independent grammar-v3 surface first pass", async () => {
    const fake = fakeClient([validPlan]);
    const result = await compose(fake.client);

    expect(result).toMatchObject({ repairCount: 0, fallbackUsed: false });
    expect(result.spec.components[0]).toMatchObject({
      component: "SurfaceFrame",
      compositionMode: "grammar-v3",
    });
    expect(result.metadata).toMatchObject({
      compositionMode: "grammar-v3",
      layoutFamily: "stack",
      contentNodeCount: 3,
      layoutNodeCount: 2,
      compilerResult: "compiled",
    });
    expect(Object.values(result.metadata.qualityChecks).every((check) => check.passed)).toBe(true);
    expect(fake.generate).toHaveBeenCalledOnce();

    const schema = fake.requests[0]?.schema;
    if (!schema || !isRecord(schema.properties)) throw new TypeError("Grammar schema is missing.");
    expect(schema.properties).toHaveProperty("content");
    expect(schema.properties).toHaveProperty("layout");
    expect(schema.required).not.toContain("recipeId");
  });

  it("repairs an invalid graph once with bounded invariant feedback", async () => {
    const invalid = {
      ...validPlan,
      layout: {
        ...validPlan.layout,
        nodes: validPlan.layout.nodes.map((node, index) =>
          index === 1 ? { ...node, children: ["layout-root"] } : node
        ),
      },
    };
    const fake = fakeClient([invalid, validPlan]);
    const result = await compose(fake.client);

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: false,
      firstFailureCategory: "semantic",
    });
    expect(fake.generate).toHaveBeenCalledTimes(2);
    expect(fake.requests[1]?.input).toMatch(/repair the invalid generative surface plan/i);
    expect(fake.requests[1]?.input).not.toContain("https://example.com/primary");
  });

  it("uses the existing deterministic plan-v2 fallback after two invalid outputs", async () => {
    const fake = fakeClient(["not json", "still not json"]);
    const result = await compose(fake.client);

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: true,
      firstFailureCategory: "json",
      metadata: {
        compositionMode: "grammar-v3",
        compilerResult: "deterministic-fallback",
      },
    });
    expect(result.spec.components[0]).toMatchObject({
      component: "SurfaceFrame",
      recipeId: "research.brief",
    });
    expect(result.spec.components[0]).not.toHaveProperty("compositionMode", "grammar-v3");
    expect(fake.generate).toHaveBeenCalledTimes(2);
  });
});
