import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_SUGGESTIONS,
  MORE_EXAMPLE_PROMPT_SUGGESTIONS,
  type PromptSuggestion,
} from "../src/components/shell/promptSuggestions.js";
import { TRUSTED_COMPONENT_NAMES } from "./constants.js";
import {
  evaluateRecordedSurfaceQuality,
  selectDemoSurface,
} from "./demo-surfaces.js";
import {
  SurfaceRecipeIdSchema,
  TraceRecordSchema,
  type SurfaceNode,
  type SurfaceRecipeId,
  type SurfaceSpec,
} from "./schemas.js";
import { validateSurfaceSpec } from "./surface-validation.js";

type ShowcaseExpectation = {
  readonly kind: "weather" | "comparison" | "research";
  readonly recipeId: SurfaceRecipeId;
};

const EXPECTED_BY_PROMPT_ID: Readonly<Record<string, ShowcaseExpectation>> = {
  "weather-saturday-ride": { kind: "weather", recipeId: "weather.decision" },
  "comparison-weekend-getaway": { kind: "comparison", recipeId: "comparison.verdict" },
  "research-gemini-hydrogen": { kind: "research", recipeId: "research.brief" },
  "weather-raleigh-jacket": { kind: "weather", recipeId: "weather.snapshot" },
  "weather-chicago-packing": { kind: "weather", recipeId: "weather.outlook" },
  "comparison-three-city-trend": { kind: "comparison", recipeId: "comparison.trend" },
  "comparison-hosting-scorecard": { kind: "comparison", recipeId: "comparison.scorecard" },
  "research-artemis-timeline": { kind: "research", recipeId: "research.timeline" },
  "research-four-day-week": { kind: "research", recipeId: "research.claims" },
};

const SHOWCASE_PROMPTS: readonly PromptSuggestion[] = [
  ...DEFAULT_PROMPT_SUGGESTIONS,
  ...MORE_EXAMPLE_PROMPT_SUGGESTIONS,
];

const LAYOUT_COMPONENTS = new Set(["SurfaceFrame", "Band", "Split", "Rail"]);

function expectationFor(suggestion: PromptSuggestion): ShowcaseExpectation {
  const expectation = EXPECTED_BY_PROMPT_ID[suggestion.id];
  if (!expectation) throw new Error(`Missing showcase expectation for ${suggestion.id}`);
  return expectation;
}

function rootNode(spec: SurfaceSpec): SurfaceNode {
  const root = spec.components.find((node) => node.id === spec.rootId);
  if (!root) throw new Error(`Missing root component ${spec.rootId}`);
  return root;
}

function readableModules(spec: SurfaceSpec): SurfaceNode[] {
  const nodes = new Map(spec.components.map((node) => [node.id, node]));
  const leaves: SurfaceNode[] = [];

  const visit = (id: string): void => {
    const node = nodes.get(id);
    if (!node) throw new Error(`Missing component ${id}`);
    if (LAYOUT_COMPONENTS.has(node.component) && "children" in node) {
      node.children.forEach(visit);
      return;
    }
    leaves.push(node);
  };

  visit(spec.rootId);
  return leaves;
}

describe("Phase 2 deterministic showcase surfaces", () => {
  it("binds the three starters and six more examples to all nine approved recipes exactly once", () => {
    expect(DEFAULT_PROMPT_SUGGESTIONS).toHaveLength(3);
    expect(MORE_EXAMPLE_PROMPT_SUGGESTIONS).toHaveLength(6);
    expect(new Set(SHOWCASE_PROMPTS.map(({ id }) => id)).size).toBe(9);
    expect(Object.keys(EXPECTED_BY_PROMPT_ID).sort()).toEqual(
      SHOWCASE_PROMPTS.map(({ id }) => id).sort(),
    );

    const selectedRecipeIds = SHOWCASE_PROMPTS.map((suggestion) => {
      const selected = selectDemoSurface(suggestion.prompt);
      const root = rootNode(selected.spec);
      expect(root.component, suggestion.id).toBe("SurfaceFrame");
      if (root.component !== "SurfaceFrame") {
        throw new Error(`${suggestion.id} did not produce a SurfaceFrame root`);
      }
      return root.recipeId;
    });

    expect(new Set(selectedRecipeIds).size).toBe(9);
    expect([...new Set(selectedRecipeIds)].sort()).toEqual(
      [...SurfaceRecipeIdSchema.options].sort(),
    );
  });

  it.each(SHOWCASE_PROMPTS)(
    "$id selects its intent-matched recipe and a trusted-valid grounded surface",
    (suggestion) => {
      const expectation = expectationFor(suggestion);
      const first = selectDemoSurface(suggestion.prompt);
      const second = selectDemoSurface(suggestion.prompt);
      const validation = validateSurfaceSpec(first.spec, first.sources);
      const root = rootNode(first.spec);

      expect(second, suggestion.id).toEqual(first);
      expect(validation.success, suggestion.id).toBe(true);
      expect(first.spec.kind, suggestion.id).toBe(expectation.kind);
      expect(first.spec.components.every(({ component }) =>
        TRUSTED_COMPONENT_NAMES.includes(component))).toBe(true);
      expect(root.component, suggestion.id).toBe("SurfaceFrame");
      if (root.component !== "SurfaceFrame") {
        throw new Error(`${suggestion.id} did not produce a SurfaceFrame root`);
      }
      expect(root.recipeId, suggestion.id).toBe(expectation.recipeId);

      const leaves = readableModules(first.spec);
      const sourceLists = leaves.filter((node) => node.component === "SourceList");
      expect(first.sources.length, suggestion.id).toBeGreaterThan(0);
      expect(sourceLists, suggestion.id).toHaveLength(1);
      expect(leaves.at(-1)?.component, suggestion.id).toBe("SourceList");

      const sourceList = sourceLists[0];
      if (sourceList?.component !== "SourceList") {
        throw new Error(`${suggestion.id} did not end with a SourceList`);
      }
      expect(new Set(sourceList.sourceIds), suggestion.id).toEqual(
        new Set(first.sources.map(({ id }) => id)),
      );
    },
  );

  it("keeps the comparison trend answer-first and its chart aligned to the table alternative", () => {
    const selected = selectDemoSurface("Compare this weekend’s weather in Raleigh and Asheville.");
    const leaves = readableModules(selected.spec);
    const checks = evaluateRecordedSurfaceQuality(selected.spec, selected.sources);

    expect(leaves[0]?.component).toBe("ComparisonSummary");
    expect(checks).toContainEqual({ code: "answer_first", passed: true });
    expect(checks).toContainEqual({ code: "chart_table_alignment", passed: true });
  });

  it.each(SHOWCASE_PROMPTS)(
    "$id evaluates only the six fixture-proven quality checks",
    (suggestion) => {
      const selected = selectDemoSurface(suggestion.prompt);
      const checks = evaluateRecordedSurfaceQuality(selected.spec, selected.sources);

      expect(checks.map(({ code }) => code)).toEqual([
        "recipe_fit",
        "answer_first",
        "sources_last",
        "duplicate_primary",
        "chart_table_alignment",
        "citation_coverage",
      ]);
      expect(checks.every(({ passed }) => passed), suggestion.id).toBe(true);
    },
  );

  it("reports failures when recorded surface structure or evidence does not prove a check", () => {
    const selected = selectDemoSurface("Compare this weekend’s weather in Raleigh and Asheville.");
    const altered = structuredClone(selected.spec);
    const root = rootNode(altered);
    if (root.component !== "SurfaceFrame") throw new Error("Expected a SurfaceFrame root");

    const summary = altered.components.find((node) => node.component === "ComparisonSummary");
    const chart = altered.components.find((node) => node.component === "ComparisonChart");
    const sourceList = altered.components.find((node) => node.component === "SourceList");
    if (summary?.component !== "ComparisonSummary") throw new Error("Expected a comparison summary");
    if (chart?.component !== "ComparisonChart") throw new Error("Expected a comparison chart");
    if (sourceList?.component !== "SourceList") throw new Error("Expected a source list");

    altered.components.push({
      id: "decorative-heading",
      component: "EditorialHeading",
      text: "Decorative context",
      level: "h2",
      align: "start",
    });
    altered.components.push({ ...summary, id: "comparison-summary-duplicate" });
    root.children = [
      "decorative-heading",
      ...root.children.filter((id) => id !== sourceList.id),
      "comparison-summary-duplicate",
    ];
    root.recipeId = "research.brief";
    chart.labels = [...chart.labels, "Extra range"];
    sourceList.sourceIds = [];

    expect(evaluateRecordedSurfaceQuality(altered, selected.sources)).toEqual([
      { code: "recipe_fit", passed: false },
      { code: "answer_first", passed: false },
      { code: "sources_last", passed: false },
      { code: "duplicate_primary", passed: false },
      { code: "chart_table_alignment", passed: false },
      { code: "citation_coverage", passed: false },
    ]);
  });

  it.each(SHOWCASE_PROMPTS)(
    "$id derives bounded public trace metadata from its recorded fixture",
    (suggestion) => {
      const selected = selectDemoSurface(suggestion.prompt);
      const root = rootNode(selected.spec);
      if (root.component !== "SurfaceFrame") {
        throw new Error(`${suggestion.id} did not produce a SurfaceFrame root`);
      }

      const trace = TraceRecordSchema.parse({
        id: "trace-recorded-showcase",
        stage: "composition",
        label: "Compose recorded showcase",
        status: "complete",
        recipeId: root.recipeId,
        density: root.density,
        emphasis: root.emphasis,
        qualityChecks: [
          { code: "answer_first", passed: true },
          { code: "citation_coverage", passed: true },
        ],
        repairCategory: "none",
        compilerResult: "compiled",
        sourceIds: selected.sources.map(({ id }) => id),
        componentNames: selected.spec.components.map(({ component }) => component),
        validation: { valid: true, repairCount: 0, issues: [] },
      });
      const serialized = JSON.stringify(trace);

      expect(TraceRecordSchema.safeParse(trace).success, suggestion.id).toBe(true);
      expect(trace).toMatchObject({
        recipeId: expectationFor(suggestion).recipeId,
        density: root.density,
        emphasis: root.emphasis,
        repairCategory: "none",
        compilerResult: "compiled",
      });
      expect(serialized, suggestion.id).not.toContain(suggestion.prompt);
      for (const source of selected.sources) {
        expect(serialized, suggestion.id).not.toContain(source.url);
        expect(serialized, suggestion.id).not.toContain(source.title);
        if (source.snippet) expect(serialized, suggestion.id).not.toContain(source.snippet);
      }
    },
  );
});
