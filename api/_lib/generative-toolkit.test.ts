import { describe, expect, it, vi } from "vitest";
import { compileSurfaceSpec } from "../../shared/compiler.js";
import { SourceRecordSchema, type ClientContext } from "../../shared/schemas.js";
import { validateSurfaceSpec } from "../../shared/surface-validation.js";
import type { GeminiClient, GeminiRetrievalResult, GeminiStructuredOutputRequest } from "./gemini.js";
import { composeGenerativeSurfacePlan, grammarLayoutNodeSchemas } from "./composition.js";
import {
  compileGenerativeSurfacePlan,
  validateGenerativeSurfacePlan,
} from "./generative-surface-plan.js";

const sources = SourceRecordSchema.array().parse([
  {
    id: "src_abc123",
    title: "Official release notes",
    url: "https://example.com/releases/current",
    provider: "google-search",
    accessedAt: "2026-08-15T12:00:00.000Z",
    snippet: "The release is stable and improves production-ready code generation.",
  },
  {
    id: "src_def456",
    title: "Independent benchmark",
    url: "https://example.org/benchmarks/current",
    provider: "google-search",
    accessedAt: "2026-08-15T12:00:00.000Z",
    snippet: "Benchmark results show faster builds with higher memory use.",
  },
]);

const retrieval: GeminiRetrievalResult = {
  outputText: "The release is stable. Benchmarks show faster builds with higher memory use.",
  steps: [],
  sources,
  searchEvidence: {
    status: "complete",
    spans: [
      { sourceId: "src_abc123", ordinal: 0, text: "The release is stable." },
      { sourceId: "src_def456", ordinal: 1, text: "Builds are faster but use more memory." },
    ],
  },
  evidence: [],
  toolRounds: 1,
};

const clientContext: ClientContext = {
  sizeClass: "expanded",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

const context = { sources, evidence: [], prompt: "Summarize the current release and its upgrade trade-offs.", clientContext };

function extendedResearchPlan() {
  return {
    version: "v3",
    kind: "research",
    density: "detailed",
    emphasis: "evidence",
    content: [
      {
        id: "lead-content",
        module: {
          type: "lead",
          variant: "brief",
          title: "Current release",
          summary: "The release is stable, with faster builds and higher memory use.",
          sourceIds: ["src_abc123"],
        },
      },
      {
        id: "facts-content",
        module: {
          type: "facts",
          label: "At a glance",
          facts: [
            { label: "Build time", value: "Faster", trend: "up", sparkline: [3, 4, 6] },
            { label: "Memory", value: "Higher", trend: "down" },
          ],
          sourceIds: ["src_def456"],
        },
      },
      {
        id: "tradeoffs-content",
        module: {
          type: "proscons",
          subject: "Upgrade trade-offs",
          pros: [{ text: "Builds finish faster.", sourceId: "src_def456" }],
          cons: [{ text: "Memory use is higher.", sourceId: "src_def456" }],
        },
      },
      {
        id: "quote-content",
        module: {
          type: "quote",
          text: "The release is stable.",
          attribution: "Official release notes",
          sourceId: "src_abc123",
        },
      },
      {
        id: "callout-content",
        module: {
          type: "callout",
          tone: "caution",
          title: "Check memory headroom",
          body: "Plan for higher memory use before upgrading busy build agents.",
          sourceIds: ["src_def456"],
        },
      },
      {
        id: "badges-content",
        module: {
          type: "badges",
          badges: [
            { label: "Stable", tone: "positive" },
            { label: "Memory heavier", tone: "caution" },
          ],
          sourceIds: ["src_abc123", "src_def456"],
        },
      },
      {
        id: "source-content",
        module: { type: "sources", label: "Sources", sourceIds: ["src_abc123", "src_def456"] },
      },
    ],
    layout: {
      rootId: "layout-root",
      nodes: [
        {
          id: "layout-root",
          type: "aside",
          children: ["main-stack", "side-card"],
          side: "end",
          label: "Upgrade notes",
        },
        {
          id: "main-stack",
          type: "stack",
          children: ["lead-content", "facts-content", "detail-accordion"],
          gap: "regular",
          align: "stretch",
        },
        {
          id: "detail-accordion",
          type: "accordion",
          children: ["tradeoffs-content", "quote-content"],
          labels: ["Trade-offs", "From the notes"],
          defaultOpenIndex: 0,
        },
        {
          id: "side-card",
          type: "card",
          children: ["callout-content", "badges-content"],
          tone: "info",
          prominence: "quiet",
          variant: "elevated",
          icon: "info",
          label: "Before you upgrade",
        },
      ],
    },
  };
}

type Plan = ReturnType<typeof extendedResearchPlan>;
type LayoutNode = Record<string, unknown>;

function withLayout(plan: Plan, nodes: LayoutNode[]): unknown {
  return { ...plan, layout: { ...plan.layout, nodes } };
}

describe("extended grammar-v3 toolkit", () => {
  it("validates and compiles new layouts, style tokens, and insight modules", () => {
    const plan = extendedResearchPlan();
    const validation = validateGenerativeSurfacePlan(plan, context);
    expect(validation.success ? [] : validation.issues).toEqual([]);

    const spec = compileGenerativeSurfacePlan({ plan, retrieval, clientContext, prompt: context.prompt });
    const names = spec.components.map((node) => node.component);
    expect(names).toEqual(
      expect.arrayContaining([
        "Aside",
        "Accordion",
        "KeyFacts",
        "ProsCons",
        "PullQuote",
        "Callout",
        "BadgeRow",
      ]),
    );
    expect(spec.components.find((node) => node.component === "Card")).toMatchObject({
      tone: "info",
      variant: "elevated",
      icon: "info",
      label: "Before you upgrade",
    });
    expect(validateSurfaceSpec(spec, sources).success).toBe(true);
    expect(() => compileSurfaceSpec("surface-test", spec, sources)).not.toThrow();
  });

  it("rejects primary content inside an accordion and nested interactive containers", () => {
    const plan = extendedResearchPlan();
    const nodes = plan.layout.nodes.map((node) => ({ ...node })) as LayoutNode[];
    nodes[1] = { ...nodes[1], children: ["facts-content", "detail-accordion"] };
    nodes[2] = { ...nodes[2], children: ["lead-content", "tradeoffs-content", "quote-content"], labels: ["A", "B", "C"] };
    const hidden = validateGenerativeSurfacePlan(withLayout(plan, nodes), context);
    expect(hidden.success).toBe(false);
    if (!hidden.success) {
      expect(hidden.issues.join(" ")).toMatch(/Primary content cannot be hidden/);
    }

    const nested = extendedResearchPlan();
    const nestedNodes = nested.layout.nodes.map((node) => ({ ...node })) as LayoutNode[];
    nestedNodes[2] = { ...nestedNodes[2], children: ["tradeoffs-content", "inner-tabs"] };
    nestedNodes.push({
      id: "inner-tabs",
      type: "tabs",
      children: ["quote-content", "callout-content"],
      labels: ["Quote", "Note"],
      defaultIndex: 0,
    } as LayoutNode);
    nestedNodes[3] = { ...nestedNodes[3], children: ["badges-content"] };
    const result = validateGenerativeSurfacePlan(withLayout(nested, nestedNodes), context);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/cannot be nested/);
  });

  it("keeps primary content in the main column of an aside", () => {
    const plan = extendedResearchPlan();
    const nodes = plan.layout.nodes.map((node) => ({ ...node })) as LayoutNode[];
    nodes[0] = { ...nodes[0], children: ["side-card", "main-stack"] };
    const result = validateGenerativeSurfacePlan(withLayout(plan, nodes), context);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/main column of an aside/);
  });

  it("requires one column span per child", () => {
    const plan = extendedResearchPlan();
    const nodes = plan.layout.nodes.map((node) => ({ ...node })) as LayoutNode[];
    nodes[1] = {
      id: "main-stack",
      type: "columns",
      children: ["lead-content", "facts-content", "detail-accordion"],
      spans: ["full", "half"],
      gap: "regular",
    } as LayoutNode;
    expect(validateGenerativeSurfacePlan(withLayout(plan, nodes), context).success).toBe(false);
    nodes[1] = { ...nodes[1], spans: ["full", "half", "half"] };
    expect(validateGenerativeSurfacePlan(withLayout(plan, nodes), context).success).toBe(true);
  });

  it("accepts scroller and narrow sections with icons", () => {
    const plan = extendedResearchPlan();
    const nodes = plan.layout.nodes.map((node) => ({ ...node })) as LayoutNode[];
    nodes[1] = { ...nodes[1], children: ["lead-content", "facts-scroller", "detail-accordion"] };
    nodes.push(
      { id: "facts-scroller", type: "scroller", children: ["facts-section", "badges-content"], label: "Highlights" } as LayoutNode,
      {
        id: "facts-section",
        type: "section",
        children: ["facts-content"],
        role: "supporting",
        tone: "positive",
        prominence: "standard",
        width: "narrow",
        icon: "trend-up",
      } as LayoutNode,
    );
    nodes[3] = { ...nodes[3], children: ["callout-content"] };
    const result = validateGenerativeSurfacePlan(withLayout(plan, nodes), context);
    expect(result.success ? [] : result.issues).toEqual([]);
  });

  it("requires insight citations to be issued and covered by the final sources", () => {
    const plan = extendedResearchPlan();
    const unknown = structuredClone(plan);
    unknown.content[2].module = {
      type: "proscons",
      subject: "Upgrade trade-offs",
      pros: [{ text: "Builds finish faster.", sourceId: "src_zzz999" }],
      cons: [{ text: "Memory use is higher.", sourceId: "src_def456" }],
    };
    const unknownResult = validateGenerativeSurfacePlan(unknown, context);
    expect(unknownResult.success).toBe(false);
    if (!unknownResult.success) expect(unknownResult.issues.join(" ")).toMatch(/src_zzz999/);

    const uncovered = structuredClone(plan);
    uncovered.content[6].module = { type: "sources", label: "Sources", sourceIds: ["src_abc123"] };
    const uncoveredResult = validateGenerativeSurfacePlan(uncovered, context);
    expect(uncoveredResult.success).toBe(false);
    if (!uncoveredResult.success) {
      expect(uncoveredResult.issues.join(" ")).toMatch(/do not cover cited source src_def456/);
    }
  });

  it("rejects meters whose value falls outside the declared range", () => {
    const plan = extendedResearchPlan();
    plan.content[1].module = {
      type: "meter",
      meters: [{ label: "Stability", value: 12, min: 0, max: 10 }],
      sourceIds: ["src_def456"],
    } as unknown as typeof plan.content[1]["module"];
    const result = validateGenerativeSurfacePlan(plan, context);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/within its range/);
  });

  it("limits quotes to research and authored figures to non-weather surfaces", () => {
    const comparison = {
      version: "v3",
      kind: "comparison",
      density: "balanced",
      emphasis: "answer",
      content: [
        {
          id: "summary-content",
          module: {
            type: "summary",
            variant: "balanced",
            title: "Both options are viable",
            recommendation: "Choose based on memory headroom.",
            items: [
              { label: "Option A", value: "Faster builds", recommended: false },
              { label: "Option B", value: "Lower memory", recommended: false },
            ],
            sourceIds: ["src_def456"],
          },
        },
        {
          id: "quote-content",
          module: { type: "quote", text: "Builds are faster.", attribution: "Benchmark", sourceId: "src_def456" },
        },
        { id: "source-content", module: { type: "sources", label: "Sources", sourceIds: ["src_def456"] } },
      ],
      layout: {
        rootId: "layout-root",
        nodes: [{ id: "layout-root", type: "stack", children: ["summary-content", "quote-content"], gap: "regular", align: "stretch" }],
      },
    };
    expect(validateGenerativeSurfacePlan(comparison, { ...context, prompt: "Compare A and B" }).success).toBe(false);
  });
});

describe("extended chart variants", () => {
  function chartPlan(chart: Record<string, unknown>, rows: string[][], columns: string[]) {
    return {
      version: "v3",
      kind: "comparison",
      density: "balanced",
      emphasis: "evidence",
      content: [
        {
          id: "summary-content",
          module: {
            type: "summary",
            variant: "balanced",
            title: "Usage share",
            recommendation: "Option A holds the larger share.",
            items: [
              { label: "Option A", value: "Larger share", recommended: false },
              { label: "Option B", value: "Smaller share", recommended: false },
            ],
            sourceIds: ["src_def456"],
          },
        },
        { id: "chart-content", module: { type: "chart", title: "Share", sourceIds: ["src_def456"], ...chart } },
        {
          id: "table-content",
          module: { type: "table", caption: "Share data", columns, rows, sourceIds: ["src_def456"] },
        },
        { id: "source-content", module: { type: "sources", label: "Sources", sourceIds: ["src_def456"] } },
      ],
      layout: {
        rootId: "layout-root",
        nodes: [
          {
            id: "layout-root",
            type: "stack",
            children: ["summary-content", "chart-content", "table-content"],
            gap: "regular",
            align: "stretch",
          },
        ],
      },
    };
  }
  const prompt = "Compare option A and option B usage share in a chart";

  it("accepts an aligned donut chart and compiles its variant", () => {
    const plan = chartPlan(
      { variant: "donut", labels: ["Option A", "Option B"], series: [{ label: "Share", values: [60, 40] }], unit: "%" },
      [["Option A", "60"], ["Option B", "40"]],
      ["Option", "Share"],
    );
    const result = validateGenerativeSurfacePlan(plan, { ...context, prompt });
    expect(result.success ? [] : result.issues).toEqual([]);
    const spec = compileGenerativeSurfacePlan({ plan, retrieval, clientContext, prompt });
    expect(spec.components.find((node) => node.component === "ComparisonChart")).toMatchObject({ variant: "donut" });
  });

  it("rejects donut negatives and inverted range bands", () => {
    const donut = chartPlan(
      { variant: "donut", labels: ["Option A", "Option B"], series: [{ label: "Share", values: [60, -40] }] },
      [["Option A", "60"], ["Option B", "-40"]],
      ["Option", "Share"],
    );
    const donutResult = validateGenerativeSurfacePlan(donut, { ...context, prompt });
    expect(donutResult.success).toBe(false);
    if (!donutResult.success) expect(donutResult.issues.join(" ")).toMatch(/non-negative/);

    const range = chartPlan(
      {
        variant: "range",
        labels: ["Q1", "Q2"],
        series: [
          { label: "Low", values: [5, 9] },
          { label: "High", values: [8, 7] },
        ],
      },
      [["Low", "5", "9"], ["High", "8", "7"]],
      ["Series", "Q1", "Q2"],
    );
    const rangeResult = validateGenerativeSurfacePlan(range, { ...context, prompt });
    expect(rangeResult.success).toBe(false);
    if (!rangeResult.success) expect(rangeResult.issues.join(" ")).toMatch(/low values must not exceed/);
  });
});

describe("toolkit-gated Gemini schema", () => {
  function layoutTypes(toolkit: "base" | "extended"): string[] {
    return grammarLayoutNodeSchemas(toolkit).map((schema) => {
      const properties = schema.properties as Record<string, { enum?: string[] }>;
      return properties.type?.enum?.[0] ?? "";
    });
  }

  it("advertises new layouts only in the extended toolkit", () => {
    expect(layoutTypes("base")).not.toContain("accordion");
    expect(layoutTypes("extended")).toEqual(
      expect.arrayContaining(["accordion", "scroller", "columns", "aside"]),
    );
  });

  function fakeClient(outputs: readonly unknown[]) {
    const remaining = [...outputs];
    const requests: GeminiStructuredOutputRequest[] = [];
    const generate = vi.fn((request: GeminiStructuredOutputRequest) => {
      requests.push(request);
      return Promise.resolve({ text: JSON.stringify(remaining.shift()) });
    });
    return {
      client: { interactions: { create: vi.fn() }, structuredOutput: { generate } } as unknown as GeminiClient,
      requests,
    };
  }

  it("composes an extended surface end to end and normalizes optional nulls", async () => {
    const plan = extendedResearchPlan() as unknown as Record<string, unknown>;
    const withNulls = structuredClone(plan) as { content: { module: Record<string, unknown> }[]; layout: { nodes: Record<string, unknown>[] } };
    withNulls.content[4].module.icon = null;
    withNulls.layout.nodes[1].label = null;
    const fake = fakeClient([withNulls]);
    const result = await composeGenerativeSurfacePlan({
      gemini: fake.client,
      prompt: context.prompt,
      clientContext,
      retrieval,
      toolkit: "extended",
    });
    expect(result).toMatchObject({ repairCount: 0, fallbackUsed: false });
    expect(result.metadata.layoutFamily).toBe("aside");

    const serialized = JSON.stringify(fake.requests[0]?.schema);
    expect(serialized).toContain('"accordion"');
    expect(serialized).toContain('"quote"');
    expect(serialized).toContain('"facts"');
    // Research surfaces have no chart module, so chart variants are not advertised.
    expect(serialized).not.toContain('"donut"');
    expect(fake.requests[0]?.systemInstruction).toMatch(/accordion/);
  });

  it("keeps the base toolkit vocabulary unchanged by default", async () => {
    const fake = fakeClient([extendedResearchPlan()]);
    await composeGenerativeSurfacePlan({ gemini: fake.client, prompt: context.prompt, clientContext, retrieval }).catch(
      () => undefined,
    );
    const serialized = JSON.stringify(fake.requests[0]?.schema);
    expect(serialized).not.toContain('"accordion"');
    expect(serialized).not.toContain('"callout"');
    expect(serialized).not.toContain('"donut"');
  });
});
