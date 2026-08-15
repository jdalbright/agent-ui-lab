import { describe, expect, it } from "vitest";
import { compileSurfaceSpec } from "../../shared/compiler.js";
import { CATALOG_ID_V3 } from "../../shared/constants.js";
import { SourceRecordSchema, type ClientContext } from "../../shared/schemas.js";
import type { GeminiRetrievalResult } from "./gemini.js";
import {
  GenerativeSurfacePlanSchema,
  compileGenerativeSurfacePlan,
  evaluateGenerativeSurfacePlanQuality,
  validateGenerativeSurfacePlan,
  type GenerativeSurfacePlan,
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
]);

const retrieval: GeminiRetrievalResult = {
  outputText: "The release is stable and improves production-ready code generation.",
  steps: [],
  sources,
  searchEvidence: {
    status: "complete",
    spans: [{ sourceId: "src_abc123", ordinal: 0, text: "The release is stable." }],
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
        title: "Current release",
        summary: "The official release notes describe a stable production release.",
        sourceIds: ["src_abc123"],
      },
    },
    {
      id: "evidence-content",
      module: {
        type: "evidence",
        variant: "stack",
        label: "What changed",
        items: [
          {
            title: "Production status",
            finding: "The current release is stable and improves production-ready code generation.",
            sourceId: "src_abc123",
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
        sourceIds: ["src_abc123"],
      },
    },
  ],
  layout: {
    rootId: "layout-root",
    nodes: [
      {
        id: "layout-root",
        type: "stack",
        children: ["lead-content", "support-grid"],
        gap: "generous",
        align: "stretch",
      },
      {
        id: "support-grid",
        type: "grid",
        children: ["evidence-content"],
        columns: "adaptive",
        gap: "regular",
      },
    ],
  },
} as const satisfies GenerativeSurfacePlan;

interface MutableTestPlan {
  emphasis?: unknown;
  density?: unknown;
  layout: { nodes: Array<Record<string, unknown>> };
}

function mutablePlan(): MutableTestPlan {
  return structuredClone(validPlan) as unknown as MutableTestPlan;
}

function childIds(plan: MutableTestPlan, index: number): unknown[] {
  const children = plan.layout.nodes[index]?.children;
  if (!Array.isArray(children)) throw new TypeError(`Layout node ${index} has no children.`);
  return children as unknown[];
}

const validationContext = {
  sources,
  evidence: retrieval.evidence,
  prompt: "What changed in the current release?",
  clientContext,
};

describe("GenerativeSurfacePlan v3", () => {
  it("accepts evidence-bound content and a recipe-independent layout graph", () => {
    expect(GenerativeSurfacePlanSchema.safeParse(validPlan).success).toBe(true);
    expect(validateGenerativeSurfacePlan(validPlan, validationContext)).toMatchObject({
      success: true,
      measurements: { contentNodes: 3, layoutNodes: 2 },
    });
  });

  it("limits v3 emphasis to answer, evidence, or exploration", () => {
    const plan = mutablePlan();
    plan.emphasis = "trend";

    expect(GenerativeSurfacePlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects raw or unknown visual values instead of treating them as semantic tokens", () => {
    const plan = mutablePlan();
    const first = plan.layout.nodes[0];
    const second = plan.layout.nodes[1];
    if (!first || !second) throw new TypeError("Expected two layout nodes.");
    first.gap = "24px";
    second.columns = "repeat(3, 1fr)";

    expect(GenerativeSurfacePlanSchema.safeParse(plan).success).toBe(false);
  });

  it("compiles the graph into the editorial/v3 catalog with sources outside the layout", () => {
    const spec = compileGenerativeSurfacePlan({
      plan: validPlan,
      retrieval,
      clientContext,
      prompt: "What changed in the current release?",
    });

    expect(spec.rootId).toBe("surface-frame");
    expect(spec.components[0]).toMatchObject({
      component: "SurfaceFrame",
      compositionMode: "grammar-v3",
      archetypeHint: "research.brief",
      children: ["layout-root", "module-3-sources"],
    });
    expect(spec.components.map((node) => node.component)).toEqual([
      "SurfaceFrame",
      "Stack",
      "Grid",
      "ResearchLead",
      "EvidenceList",
      "SourceList",
    ]);
    const messages = compileSurfaceSpec("grammar-surface", spec, sources);
    expect(messages[0]).toMatchObject({
      createSurface: { catalogId: CATALOG_ID_V3 },
    });
  });

  it.each([
    ["duplicate content placement", (plan: MutableTestPlan) => childIds(plan, 0).push("lead-content")],
    ["source placement inside the layout", (plan: MutableTestPlan) => childIds(plan, 0).push("source-content")],
    ["a layout cycle", (plan: MutableTestPlan) => {
      const node = plan.layout.nodes[1];
      if (node) node.children = ["layout-root"];
    }],
    ["an unreachable layout node", (plan: MutableTestPlan) => plan.layout.nodes.push({ id: "orphan", type: "divider" })],
    ["a missing content placement", (plan: MutableTestPlan) => {
      const node = plan.layout.nodes[1];
      if (node) node.children = [];
    }],
    ["a non-primary first content node", (plan: MutableTestPlan) => childIds(plan, 0).reverse()],
  ])("rejects %s", (_label, mutate) => {
    const plan = mutablePlan();
    mutate(plan);
    const result = validateGenerativeSurfacePlan(plan, validationContext);

    expect(result.success).toBe(false);
  });

  it("rejects nested interactive containers and primary content hidden in a tab", () => {
    const plan = mutablePlan();
    plan.layout.nodes = [
      {
        id: "layout-root",
        type: "tabs",
        children: ["lead-content", "nested-disclosure"],
        labels: ["Answer", "Details"],
        defaultIndex: 0,
      },
      {
        id: "nested-disclosure",
        type: "disclosure",
        children: ["evidence-content"],
        label: "More",
        defaultOpen: false,
      },
    ];

    const result = validateGenerativeSurfacePlan(plan, validationContext);
    expect(result).toMatchObject({ success: false });
    if (result.success) return;
    expect(result.issues.join(" ")).toMatch(/primary|interactive|nested/i);
  });

  it("enforces separate content and layout budgets", () => {
    const plan = mutablePlan();
    plan.density = "brief";
    for (let index = 0; index < 4; index += 1) {
      plan.layout.nodes.push({ id: `orphan-${index}`, type: "divider" });
    }

    const result = validateGenerativeSurfacePlan(plan, validationContext);
    expect(result).toMatchObject({ success: false });
    if (result.success) return;
    expect(result.issues.join(" ")).toMatch(/layout budget/i);
  });

  it("reports invariant quality without requiring an exact recipe tree", () => {
    const spec = compileGenerativeSurfacePlan({
      plan: validPlan,
      retrieval,
      clientContext,
      prompt: "What changed in the current release?",
    });

    expect(Object.values(evaluateGenerativeSurfacePlanQuality(
      validPlan,
      validationContext,
      spec,
    )).every(Boolean)).toBe(true);
  });
});
