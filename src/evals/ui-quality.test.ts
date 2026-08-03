import { describe, expect, it, vi } from "vitest";
import type { SourceRecord } from "@shared/schemas.js";
import * as evalCases from "./cases.js";

const RECIPE_IDS = [
  "weather.snapshot",
  "weather.decision",
  "weather.outlook",
  "comparison.verdict",
  "comparison.scorecard",
  "comparison.trend",
  "research.brief",
  "research.timeline",
  "research.claims",
] as const;

const QUALITY_CHECKS = [
  "recipe_fit",
  "answer_first",
  "sources_last",
  "requested_coverage",
  "duplicate_primary",
  "chart_table_alignment",
  "citation_coverage",
  "content_budget",
] as const;

type RecipeId = (typeof RECIPE_IDS)[number];
type QualityCheck = (typeof QUALITY_CHECKS)[number];
type Density = "brief" | "balanced" | "detailed";
type Emphasis = "answer" | "decision" | "trend" | "evidence" | "risk";

interface RequiredFact {
  readonly concept: string;
  readonly anyOf: readonly [string, ...string[]];
}

interface ContentBudget {
  readonly maxComponents: number;
  readonly maxProseCharacters: number;
  readonly maxLeadCharacters: number;
}

interface ExpectedQualityCase {
  readonly id: string;
  readonly recipeId: RecipeId;
  readonly prompt: string;
  readonly fixture: string;
  readonly expected: {
    readonly allowedRecipes: readonly [RecipeId, ...RecipeId[]];
    readonly density: Density;
    readonly emphasis: Emphasis;
    readonly requiredComponents: readonly string[];
    readonly orderedComponents: readonly string[];
    readonly requiredFacts: readonly RequiredFact[];
    readonly requiredSourceIds: readonly string[];
    readonly contentBudget: ContentBudget;
  };
}

interface QualityLintIssue {
  readonly code: QualityCheck;
  readonly message: string;
}

interface QualityLintResult {
  readonly success: boolean;
  readonly checks: Readonly<Record<QualityCheck, boolean>>;
  readonly issues: readonly QualityLintIssue[];
}

interface LooseSurfaceSpec {
  kind: string;
  rootId: string;
  components: Array<Record<string, unknown>>;
}

interface QualityLintInput {
  readonly benchmark: ExpectedQualityCase;
  readonly plan: Record<string, unknown>;
  readonly spec: LooseSurfaceSpec;
  readonly sources: readonly SourceRecord[];
}

type QualityLinter = (input: QualityLintInput) => QualityLintResult;

const BUDGETS = {
  brief: {
    maxComponents: 6,
    maxProseCharacters: 700,
    maxLeadCharacters: 280,
  },
  balanced: {
    maxComponents: 9,
    maxProseCharacters: 1_400,
    maxLeadCharacters: 480,
  },
  detailed: {
    maxComponents: 12,
    maxProseCharacters: 2_200,
    maxLeadCharacters: 700,
  },
} as const satisfies Record<Density, ContentBudget>;

function fact(concept: string, ...anyOf: [string, ...string[]]): RequiredFact {
  return { concept, anyOf };
}

function qualityCase(input: {
  id: string;
  recipeId: RecipeId;
  prompt: string;
  fixture: string;
  density: Density;
  emphasis: Emphasis;
  requiredComponents: readonly string[];
  requiredFacts: readonly RequiredFact[];
  requiredSourceIds: readonly string[];
}): ExpectedQualityCase {
  return {
    id: input.id,
    recipeId: input.recipeId,
    prompt: input.prompt,
    fixture: input.fixture,
    expected: {
      allowedRecipes: [input.recipeId],
      density: input.density,
      emphasis: input.emphasis,
      requiredComponents: input.requiredComponents,
      orderedComponents: input.requiredComponents,
      requiredFacts: input.requiredFacts,
      requiredSourceIds: input.requiredSourceIds,
      contentBudget: BUDGETS[input.density],
    },
  };
}

const EXPECTED_UI_QUALITY_CASES = [
  qualityCase({
    id: "QW01",
    recipeId: "weather.snapshot",
    prompt: "What is the weather in Raleigh right now?",
    fixture: "quality-wx-raleigh-current",
    density: "brief",
    emphasis: "answer",
    requiredComponents: ["WeatherHero", "SourceList"],
    requiredFacts: [
      fact("location", "Raleigh", "Raleigh, North Carolina"),
      fact("current temperature", "81°F", "81 F", "81 degrees"),
      fact("current condition", "Partly sunny", "Partly cloudy"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QW02",
    recipeId: "weather.snapshot",
    prompt: "Are there severe weather alerts in New Orleans right now?",
    fixture: "quality-wx-new-orleans-alert",
    density: "brief",
    emphasis: "risk",
    requiredComponents: ["WeatherHero", "WeatherAlert", "SourceList"],
    requiredFacts: [
      fact("location", "New Orleans"),
      fact("alert title", "Severe Thunderstorm Warning"),
      fact("alert expiry", "6:00 PM", "6 PM"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QW03",
    recipeId: "weather.decision",
    prompt: "When should I take a walk in Raleigh today?",
    fixture: "quality-wx-raleigh-walk-window",
    density: "balanced",
    emphasis: "decision",
    requiredComponents: ["WeatherHero", "RecommendationBand", "HourlyForecast", "SourceList"],
    requiredFacts: [
      fact("location", "Raleigh"),
      fact("recommended start", "7:00 PM", "7 PM"),
      fact("recommended end", "8:30 PM", "8:30"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QW04",
    recipeId: "weather.decision",
    prompt: "What should I wear for a 7 AM run in Denver tomorrow?",
    fixture: "quality-wx-denver-run-window",
    density: "balanced",
    emphasis: "decision",
    requiredComponents: ["WeatherHero", "RecommendationBand", "HourlyForecast", "SourceList"],
    requiredFacts: [
      fact("location", "Denver"),
      fact("requested time", "7:00 AM", "7 AM"),
      fact("temperature unit", "°F", "Fahrenheit"),
      fact("activity", "run", "running"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QW05",
    recipeId: "weather.outlook",
    prompt: "Give me Seattle's seven-day forecast in Celsius.",
    fixture: "quality-wx-seattle-seven-day",
    density: "balanced",
    emphasis: "trend",
    requiredComponents: ["WeatherHero", "DailyForecast", "SourceList"],
    requiredFacts: [
      fact("location", "Seattle"),
      fact("seven-day range", "7-day", "seven-day", "7 days"),
      fact("temperature unit", "°C", "Celsius"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QW06",
    recipeId: "weather.outlook",
    prompt: "Show Tokyo's five-day outlook in Celsius and call out the wettest day.",
    fixture: "quality-wx-tokyo-five-day",
    density: "detailed",
    emphasis: "trend",
    requiredComponents: ["WeatherHero", "DailyForecast", "RecommendationBand", "SourceList"],
    requiredFacts: [
      fact("location", "Tokyo"),
      fact("five-day range", "5-day", "five-day", "5 days"),
      fact("temperature unit", "°C", "Celsius"),
      fact("wettest day", "Tuesday"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QC01",
    recipeId: "comparison.verdict",
    prompt: "Which has better weather for a Saturday picnic: Raleigh or Asheville?",
    fixture: "quality-compare-raleigh-asheville-verdict",
    density: "brief",
    emphasis: "decision",
    requiredComponents: ["ComparisonSummary", "ComparisonTable", "SourceList"],
    requiredFacts: [
      fact("first option", "Raleigh"),
      fact("second option", "Asheville"),
      fact("criterion", "picnic", "outdoor"),
      fact("requested day", "Saturday"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QC02",
    recipeId: "comparison.verdict",
    prompt: "Compare Southwest and Delta carry-on limits and tell me which is more generous.",
    fixture: "quality-compare-airline-carry-on-verdict",
    density: "balanced",
    emphasis: "decision",
    requiredComponents: ["ComparisonSummary", "ComparisonTable", "SourceList"],
    requiredFacts: [
      fact("first option", "Southwest"),
      fact("second option", "Delta"),
      fact("criterion", "carry-on", "carry on"),
      fact("decision", "more generous", "better allowance"),
    ],
    requiredSourceIds: ["src_search01", "src_search02"],
  }),
  qualityCase({
    id: "QC03",
    recipeId: "comparison.scorecard",
    prompt: "Score Raleigh, Durham, Charlotte, and Asheville for a Sunday outdoor brunch.",
    fixture: "quality-compare-four-city-scorecard",
    density: "balanced",
    emphasis: "answer",
    requiredComponents: ["ComparisonSummary", "ComparisonTable", "SourceList"],
    requiredFacts: [
      fact("Raleigh option", "Raleigh"),
      fact("Durham option", "Durham"),
      fact("Charlotte option", "Charlotte"),
      fact("Asheville option", "Asheville"),
      fact("criterion", "outdoor brunch", "brunch"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QC04",
    recipeId: "comparison.scorecard",
    prompt: "Compare React and Angular support in A2UI 0.9.1 using official sources.",
    fixture: "quality-compare-a2ui-renderer-scorecard",
    density: "detailed",
    emphasis: "evidence",
    requiredComponents: ["ComparisonSummary", "ComparisonTable", "SourceList"],
    requiredFacts: [
      fact("first option", "React"),
      fact("second option", "Angular"),
      fact("version", "0.9.1", "v0.9.1"),
      fact("criterion", "renderer", "support"),
    ],
    requiredSourceIds: ["src_search01", "src_search02"],
  }),
  qualityCase({
    id: "QC05",
    recipeId: "comparison.trend",
    prompt: "Compare Raleigh and Charlotte temperatures this Saturday and Sunday.",
    fixture: "quality-compare-raleigh-charlotte-trend",
    density: "detailed",
    emphasis: "trend",
    requiredComponents: ["ComparisonSummary", "ComparisonChart", "ComparisonTable", "SourceList"],
    requiredFacts: [
      fact("first location", "Raleigh"),
      fact("second location", "Charlotte"),
      fact("range start", "Saturday"),
      fact("range end", "Sunday"),
      fact("temperature unit", "°F", "Fahrenheit"),
      fact("comparison criterion", "temperature", "high"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QC06",
    recipeId: "comparison.trend",
    prompt: "Chart the next five days of highs for Miami, Denver, and Seattle.",
    fixture: "quality-compare-three-city-five-day-trend",
    density: "detailed",
    emphasis: "trend",
    requiredComponents: ["ComparisonSummary", "ComparisonChart", "ComparisonTable", "SourceList"],
    requiredFacts: [
      fact("Miami series", "Miami"),
      fact("Denver series", "Denver"),
      fact("Seattle series", "Seattle"),
      fact("five-day range", "5-day", "five-day", "5 days"),
      fact("criterion", "highs", "high temperature"),
    ],
    requiredSourceIds: ["src_weather01"],
  }),
  qualityCase({
    id: "QR01",
    recipeId: "research.brief",
    prompt: "What changed in Gemini 3.6 Flash? Give me a concise sourced brief.",
    fixture: "quality-research-gemini-36-brief",
    density: "brief",
    emphasis: "answer",
    requiredComponents: ["ResearchLead", "EvidenceList", "SourceList"],
    requiredFacts: [
      fact("model", "Gemini 3.6 Flash"),
      fact("change", "change", "new"),
    ],
    requiredSourceIds: ["src_search01", "src_search02"],
  }),
  qualityCase({
    id: "QR02",
    recipeId: "research.brief",
    prompt: "Summarize the FCC broadband-label requirements using only FCC sources.",
    fixture: "quality-research-fcc-label-brief",
    density: "balanced",
    emphasis: "evidence",
    requiredComponents: ["ResearchLead", "EvidenceList", "SourceList"],
    requiredFacts: [
      fact("authority", "FCC", "Federal Communications Commission"),
      fact("subject", "broadband label", "Broadband Facts"),
      fact("requirement", "price", "fees", "performance"),
    ],
    requiredSourceIds: ["src_search01", "src_search02"],
  }),
  qualityCase({
    id: "QR03",
    recipeId: "research.timeline",
    prompt: "Build a timeline of NASA's Artemis II schedule announcements since 2024.",
    fixture: "quality-research-artemis-timeline",
    density: "detailed",
    emphasis: "trend",
    requiredComponents: ["ResearchLead", "Timeline", "SourceList"],
    requiredFacts: [
      fact("program", "Artemis II"),
      fact("range start", "2024"),
      fact("chronology", "announcement", "schedule"),
    ],
    requiredSourceIds: ["src_search01", "src_search02", "src_search03"],
  }),
  qualityCase({
    id: "QR04",
    recipeId: "research.timeline",
    prompt: "Show the release and support timeline for A2UI 0.9.1 and 1.0.",
    fixture: "quality-research-a2ui-release-timeline",
    density: "balanced",
    emphasis: "trend",
    requiredComponents: ["ResearchLead", "Timeline", "SourceList"],
    requiredFacts: [
      fact("earlier version", "0.9.1", "v0.9.1"),
      fact("later version", "1.0", "v1.0"),
      fact("status", "support", "release"),
    ],
    requiredSourceIds: ["src_search01", "src_search02"],
  }),
  qualityCase({
    id: "QR05",
    recipeId: "research.claims",
    prompt: "Find evidence for and against the claim that the IAU still classifies Pluto as a planet.",
    fixture: "quality-research-pluto-claims",
    density: "detailed",
    emphasis: "evidence",
    requiredComponents: ["ResearchLead", "EvidenceList", "SourceList"],
    requiredFacts: [
      fact("subject", "Pluto"),
      fact("authority", "IAU", "International Astronomical Union"),
      fact("supporting evidence", "for", "support"),
      fact("challenging evidence", "against", "challenge"),
    ],
    requiredSourceIds: ["src_search01", "src_search02"],
  }),
  qualityCase({
    id: "QR06",
    recipeId: "research.claims",
    prompt: "Assess the claim that A2UI 1.0 has replaced 0.9.1 as the stable release.",
    fixture: "quality-research-a2ui-stability-claims",
    density: "balanced",
    emphasis: "evidence",
    requiredComponents: ["ResearchLead", "EvidenceList", "SourceList"],
    requiredFacts: [
      fact("new version", "1.0", "v1.0"),
      fact("earlier version", "0.9.1", "v0.9.1"),
      fact("stability claim", "stable", "candidate", "preview"),
    ],
    requiredSourceIds: ["src_search01", "src_search02"],
  }),
] as const satisfies readonly ExpectedQualityCase[];

function exportedQualityCases(): readonly ExpectedQualityCase[] | undefined {
  return (evalCases as unknown as { UI_QUALITY_CASES?: readonly ExpectedQualityCase[] })
    .UI_QUALITY_CASES;
}

async function loadQualityLinter(): Promise<QualityLinter> {
  const module = await vi.importActual<Record<string, unknown>>(
    "../../api/_lib/surface-quality.js",
  );
  expect(module.lintSurfaceQuality).toBeTypeOf("function");
  return module.lintSurfaceQuality as QualityLinter;
}

function source(
  id: string,
  provider: SourceRecord["provider"],
): SourceRecord {
  return {
    id,
    title: `${id} recorded evidence`,
    url: `https://evidence.example.test/${id}`,
    provider,
    accessedAt: "2026-08-02T12:00:00.000Z",
  };
}

function comparisonTrendCandidate(): QualityLintInput {
  const benchmark = EXPECTED_UI_QUALITY_CASES.find((testCase) => testCase.id === "QC05")!;
  return {
    benchmark,
    plan: {
      kind: "comparison",
      recipeId: "comparison.trend",
      density: "detailed",
      emphasis: "trend",
      modules: [
        {
          type: "summary",
          variant: "balanced",
          title: "Raleigh versus Charlotte",
          recommendation: "Raleigh is warmer across Saturday and Sunday.",
          items: [
            { label: "Raleigh", value: "82–84°F", recommended: true },
            { label: "Charlotte", value: "80–81°F", recommended: false },
          ],
          sourceIds: ["src_weather01"],
        },
        {
          type: "chart",
          variant: "line",
          title: "Weekend high temperatures",
          labels: ["Saturday", "Sunday"],
          series: [
            { label: "Raleigh", values: [82, 84] },
            { label: "Charlotte", values: [80, 81] },
          ],
          unit: "°F",
          sourceIds: ["src_weather01"],
        },
        {
          type: "table",
          caption: "Weekend high temperatures in °F",
          columns: ["City", "Saturday", "Sunday"],
          rows: [
            ["Raleigh", "82", "84"],
            ["Charlotte", "80", "81"],
          ],
          sourceIds: ["src_weather01"],
        },
        { type: "sources", label: "Sources", sourceIds: ["src_weather01"] },
      ],
    },
    spec: {
      kind: "comparison",
      rootId: "root",
      components: [
        {
          id: "root",
          component: "SurfaceFrame",
          recipeId: "comparison.trend",
          density: "detailed",
          emphasis: "trend",
          children: ["summary", "chart", "table", "sources"],
        },
        {
          id: "summary",
          component: "ComparisonSummary",
          title: "Raleigh versus Charlotte",
          recommendation: "Raleigh is warmer across Saturday and Sunday.",
          items: [
            { label: "Raleigh", value: "82–84°F", recommended: true },
            { label: "Charlotte", value: "80–81°F", recommended: false },
          ],
        },
        {
          id: "chart",
          component: "ComparisonChart",
          title: "Weekend high temperatures",
          labels: ["Saturday", "Sunday"],
          series: [
            { label: "Raleigh", values: [82, 84] },
            { label: "Charlotte", values: [80, 81] },
          ],
          unit: "°F",
        },
        {
          id: "table",
          component: "ComparisonTable",
          caption: "Weekend high temperatures in °F",
          columns: ["City", "Saturday", "Sunday"],
          rows: [
            ["Raleigh", "82", "84"],
            ["Charlotte", "80", "81"],
          ],
        },
        {
          id: "sources",
          component: "SourceList",
          label: "Sources",
          sourceIds: ["src_weather01"],
        },
      ],
    },
    sources: [source("src_weather01", "google-weather")],
  };
}

function researchBriefCandidate(): QualityLintInput {
  const benchmark = EXPECTED_UI_QUALITY_CASES.find((testCase) => testCase.id === "QR01")!;
  return {
    benchmark,
    plan: {
      kind: "research",
      recipeId: "research.brief",
      density: "brief",
      emphasis: "answer",
      modules: [
        {
          type: "lead",
          variant: "feature",
          title: "What changed in Gemini 3.6 Flash",
          summary: "Gemini 3.6 Flash adds new capabilities while preserving its fast model profile.",
          sourceIds: ["src_search01", "src_search02"],
        },
        {
          type: "evidence",
          variant: "stack",
          label: "Evidence",
          items: [
            {
              title: "Model update",
              finding: "The official model page describes what is new.",
              sourceId: "src_search01",
              stance: "support",
            },
            {
              title: "Capability details",
              finding: "The official API documentation explains the change.",
              sourceId: "src_search02",
              stance: "neutral",
            },
          ],
        },
        {
          type: "sources",
          label: "Sources",
          sourceIds: ["src_search01", "src_search02"],
        },
      ],
    },
    spec: {
      kind: "research",
      rootId: "root",
      components: [
        {
          id: "root",
          component: "SurfaceFrame",
          recipeId: "research.brief",
          density: "brief",
          emphasis: "answer",
          children: ["lead", "evidence", "sources"],
        },
        {
          id: "lead",
          component: "ResearchLead",
          title: "What changed in Gemini 3.6 Flash",
          summary: "Gemini 3.6 Flash adds new capabilities while preserving its fast model profile.",
          sourceIds: ["src_search01", "src_search02"],
        },
        {
          id: "evidence",
          component: "EvidenceList",
          label: "Evidence",
          items: [
            {
              title: "Model update",
              finding: "The official model page describes what is new.",
              sourceId: "src_search01",
            },
            {
              title: "Capability details",
              finding: "The official API documentation explains the change.",
              sourceId: "src_search02",
            },
          ],
        },
        {
          id: "sources",
          component: "SourceList",
          label: "Sources",
          sourceIds: ["src_search01", "src_search02"],
        },
      ],
    },
    sources: [
      source("src_search01", "google-search"),
      source("src_search02", "google-search"),
    ],
  };
}

function issueCodes(result: QualityLintResult): QualityCheck[] {
  return result.issues.map((issue) => issue.code);
}

function rootNode(input: QualityLintInput): Record<string, unknown> {
  return input.spec.components.find((node) => node.id === input.spec.rootId)!;
}

function component(
  input: QualityLintInput,
  componentName: string,
): Record<string, unknown> {
  return input.spec.components.find((node) => node.component === componentName)!;
}

describe("UI quality benchmark cases", () => {
  it("exports the 18 decision-complete recorded-evidence cases", () => {
    expect(exportedQualityCases()).toEqual(EXPECTED_UI_QUALITY_CASES);
  });

  it("contains exactly two unique cases and fixtures for every approved recipe", () => {
    const cases = exportedQualityCases();
    expect(cases).toBeDefined();
    expect(cases).toHaveLength(18);
    expect(new Set(cases?.map((testCase) => testCase.id)).size).toBe(18);
    expect(new Set(cases?.map((testCase) => testCase.fixture)).size).toBe(18);

    for (const recipeId of RECIPE_IDS) {
      expect(
        cases?.filter((testCase) => testCase.recipeId === recipeId),
        recipeId,
      ).toHaveLength(2);
    }
  });

  it("makes recipe fit, order, coverage, citations, and content budgets executable", () => {
    const cases = exportedQualityCases();
    expect(cases).toBeDefined();

    for (const testCase of cases ?? []) {
      expect(testCase.expected.allowedRecipes, testCase.id).toContain(testCase.recipeId);
      expect(testCase.expected.requiredComponents.length, testCase.id).toBeGreaterThan(0);
      expect(testCase.expected.orderedComponents, testCase.id).toEqual(
        testCase.expected.requiredComponents,
      );
      expect(testCase.expected.requiredFacts.length, testCase.id).toBeGreaterThan(0);
      expect(testCase.expected.requiredSourceIds.length, testCase.id).toBeGreaterThan(0);
      expect(testCase.expected.contentBudget.maxComponents, testCase.id).toBeGreaterThanOrEqual(
        testCase.expected.requiredComponents.length + 1,
      );
      expect(testCase.expected.contentBudget.maxLeadCharacters, testCase.id).toBeLessThanOrEqual(
        testCase.expected.contentBudget.maxProseCharacters,
      );
    }
  });
});

describe("deterministic surface quality linter", () => {
  it("accepts an answer-first, source-last surface that covers its benchmark", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const result = lintSurfaceQuality(comparisonTrendCandidate());

    expect(result).toEqual({
      success: true,
      checks: Object.fromEntries(QUALITY_CHECKS.map((check) => [check, true])),
      issues: [],
    });
  });

  it("rejects a recipe outside the case's allowed recipes", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = comparisonTrendCandidate();
    input.plan.recipeId = "comparison.scorecard";
    rootNode(input).recipeId = "comparison.scorecard";

    const result = lintSurfaceQuality(input);

    expect(result.success).toBe(false);
    expect(result.checks.recipe_fit).toBe(false);
    expect(issueCodes(result)).toContain("recipe_fit");
  });

  it("rejects detail-first hierarchy when the primary answer is not first", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = comparisonTrendCandidate();
    rootNode(input).children = ["chart", "summary", "table", "sources"];

    const result = lintSurfaceQuality(input);

    expect(result.success).toBe(false);
    expect(result.checks.answer_first).toBe(false);
    expect(issueCodes(result)).toContain("answer_first");
  });

  it("rejects a source list that is not the final readable module", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = comparisonTrendCandidate();
    rootNode(input).children = ["summary", "sources", "chart", "table"];

    const result = lintSurfaceQuality(input);

    expect(result.success).toBe(false);
    expect(result.checks.sources_last).toBe(false);
    expect(issueCodes(result)).toContain("sources_last");
  });

  it("rejects output that omits a requested location, unit, range, criterion, or fact", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = comparisonTrendCandidate();
    const summary = component(input, "ComparisonSummary");
    summary.title = "Raleigh weekend temperatures";
    summary.recommendation = "Raleigh is warmer across Saturday and Sunday.";
    summary.items = [{ label: "Raleigh", value: "82–84°F", recommended: true }];
    const chart = component(input, "ComparisonChart");
    chart.series = [{ label: "Raleigh", values: [82, 84] }];
    const table = component(input, "ComparisonTable");
    table.rows = [["Raleigh", "82", "84"]];

    const result = lintSurfaceQuality(input);

    expect(result.success).toBe(false);
    expect(result.checks.requested_coverage).toBe(false);
    expect(issueCodes(result)).toContain("requested_coverage");
    expect(result.issues.some((issue) => issue.message.includes("second location"))).toBe(true);
  });

  it("rejects competing duplicate primary sections", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = comparisonTrendCandidate();
    const duplicate = structuredClone(component(input, "ComparisonSummary"));
    duplicate.id = "summary-duplicate";
    input.spec.components.push(duplicate);
    rootNode(input).children = ["summary", "summary-duplicate", "chart", "table", "sources"];

    const result = lintSurfaceQuality(input);

    expect(result.success).toBe(false);
    expect(result.checks.duplicate_primary).toBe(false);
    expect(issueCodes(result)).toContain("duplicate_primary");
  });

  it("rejects charts whose labels, series, or values disagree with their table alternative", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const mutations: Array<(input: QualityLintInput) => void> = [
      (input) => {
        component(input, "ComparisonChart").labels = ["Saturday", "Monday"];
      },
      (input) => {
        const chart = component(input, "ComparisonChart");
        const series = chart.series as Array<Record<string, unknown>>;
        series[1].label = "Asheville";
      },
      (input) => {
        const chart = component(input, "ComparisonChart");
        const series = chart.series as Array<Record<string, unknown>>;
        series[0].values = [82, 99];
      },
    ];

    for (const mutate of mutations) {
      const input = comparisonTrendCandidate();
      mutate(input);
      const result = lintSurfaceQuality(input);

      expect(result.success).toBe(false);
      expect(result.checks.chart_table_alignment).toBe(false);
      expect(issueCodes(result)).toContain("chart_table_alignment");
    }
  });

  it("rejects missing, unknown, or unlisted research citation IDs", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const mutations: Array<(input: QualityLintInput) => void> = [
      (input) => {
        const items = component(input, "EvidenceList").items as Array<Record<string, unknown>>;
        delete items[1].sourceId;
      },
      (input) => {
        const items = component(input, "EvidenceList").items as Array<Record<string, unknown>>;
        items[1].sourceId = "src_missing1";
      },
      (input) => {
        component(input, "SourceList").sourceIds = ["src_search01"];
      },
    ];

    for (const mutate of mutations) {
      const input = researchBriefCandidate();
      mutate(input);
      const result = lintSurfaceQuality(input);

      expect(result.success).toBe(false);
      expect(result.checks.citation_coverage).toBe(false);
      expect(issueCodes(result)).toContain("citation_coverage");
    }
  });

  it("rejects a surface that exceeds its case's prose or component budget", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const mutations: Array<(input: QualityLintInput) => void> = [
      (input) => {
        const lead = component(input, "ResearchLead");
        lead.summary = "x".repeat(
          input.benchmark.expected.contentBudget.maxLeadCharacters + 1,
        );
      },
      (input) => {
        const root = rootNode(input);
        const children = root.children as string[];
        while (input.spec.components.length <= input.benchmark.expected.contentBudget.maxComponents) {
          const id = `supporting-${input.spec.components.length}`;
          input.spec.components.push({
            id,
            component: "TextBlock",
            text: "Supporting context.",
            tone: "muted",
          });
          children.splice(children.length - 1, 0, id);
        }
      },
    ];

    for (const mutate of mutations) {
      const input = researchBriefCandidate();
      mutate(input);
      const result = lintSurfaceQuality(input);

      expect(result.success).toBe(false);
      expect(result.checks.content_budget).toBe(false);
      expect(issueCodes(result)).toContain("content_budget");
    }
  });
});
