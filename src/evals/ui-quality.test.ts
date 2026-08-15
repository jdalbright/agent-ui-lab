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

interface SemanticAtomAlternative {
  readonly allOf: readonly [string, ...string[]];
}

type RequiredFactMatcher =
  | {
      readonly kind: "recommended-comparison-item";
      readonly labelAnyOf: readonly [string, ...string[]];
      readonly detailAnyOf: readonly [string, ...string[]];
    }
  | {
      readonly kind: "semantic-atoms";
      readonly subjectAnyOf?: readonly [string, ...string[]];
      readonly excludedSubjectAnyOf?: readonly [string, ...string[]];
      readonly discourseTargetAnyOf?: readonly [string, ...string[]];
      readonly requiresCurrentAssertion?: boolean;
      readonly anyOf: readonly [SemanticAtomAlternative, ...SemanticAtomAlternative[]];
    };

interface RequiredFact {
  readonly concept: string;
  readonly anyOf: readonly [string, ...string[]];
  readonly matcher?: RequiredFactMatcher;
}

interface SemanticVariantExpectation {
  readonly component: string;
  readonly allowed: readonly [string, ...string[]];
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
    readonly semanticVariants: readonly SemanticVariantExpectation[];
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
  readonly mode?: "recipe-v2" | "grammar-v3";
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

const QR01_TARGET_SUBJECTS = [
  "Gemini 3.6 Flash",
  "Gemini 3.6",
  "3.6 Flash",
  "the model",
  "this model",
  "the release",
  "this release",
] as const;

const QR01_DISCOURSE_TARGETS = [
  "Gemini 3.6 Flash",
  "Gemini 3.6",
  "3.6 Flash",
] as const;

const QR01_EXCLUDED_SUBJECTS = [
  "Gemini 3.5 Flash",
  "Gemini 3.5",
  "3.5 Flash",
] as const;

function fact(concept: string, ...anyOf: [string, ...string[]]): RequiredFact {
  return { concept, anyOf };
}

function matchedFact(
  concept: string,
  anyOf: [string, ...string[]],
  matcher: RequiredFactMatcher,
): RequiredFact {
  return { concept, anyOf, matcher };
}

function qualityCase(input: {
  id: string;
  recipeId: RecipeId;
  prompt: string;
  fixture: string;
  density: Density;
  emphasis: Emphasis;
  requiredComponents: readonly string[];
  semanticVariants: readonly SemanticVariantExpectation[];
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
      semanticVariants: input.semanticVariants,
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
    semanticVariants: [{ component: "WeatherHero", allowed: ["snapshot"] }],
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
    semanticVariants: [{ component: "WeatherHero", allowed: ["snapshot"] }],
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
    semanticVariants: [
      { component: "WeatherHero", allowed: ["decision"] },
      { component: "HourlyForecast", allowed: ["strip"] },
    ],
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
    semanticVariants: [
      { component: "WeatherHero", allowed: ["decision"] },
      { component: "HourlyForecast", allowed: ["strip", "chart"] },
    ],
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
    semanticVariants: [
      { component: "WeatherHero", allowed: ["snapshot"] },
      { component: "DailyForecast", allowed: ["cards"] },
    ],
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
    semanticVariants: [
      { component: "WeatherHero", allowed: ["snapshot"] },
      { component: "DailyForecast", allowed: ["table", "cards"] },
    ],
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
    semanticVariants: [{ component: "ComparisonSummary", allowed: ["verdict"] }],
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
    semanticVariants: [{ component: "ComparisonSummary", allowed: ["verdict"] }],
    requiredFacts: [
      fact("first option", "Southwest"),
      fact("second option", "Delta"),
      fact("criterion", "carry-on", "carry on"),
      fact("Southwest carry-on limit", "24 × 16 × 10", "24 x 16 x 10", "24 by 16 by 10"),
      fact("Delta carry-on limit", "22 × 14 × 9", "22 x 14 x 9", "22 by 14 by 9"),
      matchedFact(
        "decision",
        [
          "Southwest is more generous",
          "Southwest is the more generous",
          "Southwest has the better allowance",
          "Southwest offers a better allowance",
          "Southwest has a larger allowance",
          "Southwest offers a larger allowance",
          "Southwest has the larger carry-on",
          "Southwest allows a larger carry-on",
          "Southwest permits a larger carry-on",
          "Southwest permits the larger carry-on",
          "Southwest's carry-on limit is larger",
          "Southwest has larger carry-on dimensions",
          "Southwest offers more carry-on space",
          "Southwest more generous",
        ],
        {
          kind: "recommended-comparison-item",
          labelAnyOf: ["Southwest", "Southwest Airlines"],
          detailAnyOf: ["24 × 16 × 10", "24 x 16 x 10", "24 by 16 by 10"],
        },
      ),
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
    semanticVariants: [{ component: "ComparisonSummary", allowed: ["balanced"] }],
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
    prompt: "Score React and Angular in A2UI 0.9.1 on renderer and support. Use official sources.",
    fixture: "quality-compare-a2ui-renderer-scorecard",
    density: "detailed",
    emphasis: "evidence",
    requiredComponents: ["ComparisonSummary", "ComparisonTable", "SourceList"],
    semanticVariants: [{ component: "ComparisonSummary", allowed: ["balanced"] }],
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
    semanticVariants: [
      { component: "ComparisonSummary", allowed: ["balanced"] },
      { component: "ComparisonChart", allowed: ["line", "bar"] },
    ],
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
    semanticVariants: [
      { component: "ComparisonSummary", allowed: ["balanced"] },
      { component: "ComparisonChart", allowed: ["line", "bar"] },
    ],
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
    semanticVariants: [
      { component: "ResearchLead", allowed: ["brief"] },
      { component: "EvidenceList", allowed: ["stack"] },
    ],
    requiredFacts: [
      fact("model", "Gemini 3.6 Flash"),
      matchedFact(
        "release status",
        [
          "generally available",
          "has reached general availability",
          "GA",
          "production-ready release",
          "ready for production use",
          "available for production use",
          "production ready",
          "stable release",
        ],
        {
          kind: "semantic-atoms",
          subjectAnyOf: QR01_TARGET_SUBJECTS,
          excludedSubjectAnyOf: QR01_EXCLUDED_SUBJECTS,
          discourseTargetAnyOf: QR01_DISCOURSE_TARGETS,
          requiresCurrentAssertion: true,
          anyOf: [
            { allOf: ["generally available"] },
            { allOf: ["has reached general availability"] },
            { allOf: ["GA"] },
            { allOf: ["production-ready release"] },
            { allOf: ["release is production-ready"] },
            { allOf: ["model is production-ready"] },
            { allOf: ["is production-ready"] },
            { allOf: ["ready for production use"] },
            { allOf: ["is available for production use"] },
            { allOf: ["is production ready"] },
            { allOf: ["stable release"] },
            { allOf: ["release is stable"] },
            { allOf: ["model is stable"] },
            { allOf: ["is stable"] },
            { allOf: ["remains stable"] },
            { allOf: ["stable for production use"] },
          ],
        },
      ),
      matchedFact(
        "agentic efficiency",
        ["fewer reasoning steps", "fewer turns", "fewer tool calls"],
        {
          kind: "semantic-atoms",
          subjectAnyOf: QR01_TARGET_SUBJECTS,
          excludedSubjectAnyOf: QR01_EXCLUDED_SUBJECTS,
          discourseTargetAnyOf: QR01_DISCOURSE_TARGETS,
          requiresCurrentAssertion: true,
          anyOf: [
            { allOf: ["fewer reasoning steps"] },
            { allOf: ["fewer turns"] },
            { allOf: ["fewer tool calls"] },
            { allOf: ["less deliberation"] },
            { allOf: ["fewer interactions"] },
            { allOf: ["agentic workflows more efficient"] },
            { allOf: ["more efficient agentic workflows"] },
            { allOf: ["less reasoning", "fewer tool invocations"] },
            { allOf: ["reduces reasoning overhead", "agentic workflows"] },
            { allOf: ["agentic tasks", "less reasoning overhead"] },
            { allOf: ["agent workflows", "fewer steps", "calls"] },
            { allOf: ["cuts tool use", "agent workflows"] },
            { allOf: ["reduces reasoning steps and tool calls"] },
          ],
        },
      ),
      matchedFact(
        "code improvement",
        ["improved code generation", "higher quality production-ready code", "fewer debugging loops"],
        {
          kind: "semantic-atoms",
          subjectAnyOf: QR01_TARGET_SUBJECTS,
          excludedSubjectAnyOf: QR01_EXCLUDED_SUBJECTS,
          discourseTargetAnyOf: QR01_DISCOURSE_TARGETS,
          requiresCurrentAssertion: true,
          anyOf: [
            { allOf: ["improved code generation"] },
            { allOf: ["improves code generation"] },
            { allOf: ["higher quality production-ready code"] },
            { allOf: ["higher-quality production-ready code"] },
            { allOf: ["fewer debugging loops"] },
            { allOf: ["stronger deployable code"] },
            { allOf: ["higher-quality production code"] },
            { allOf: ["higher quality production code"] },
            { allOf: ["improves code quality"] },
            { allOf: ["improved code quality"] },
            { allOf: ["generated code", "fewer debugging iterations"] },
            { allOf: ["better production code", "less debugging"] },
            { allOf: ["code generation", "more reliable", "fewer fixes"] },
            { allOf: ["generates better production-ready code"] },
            { allOf: ["higher-quality deployable code"] },
            { allOf: ["higher quality generated code"] },
            { allOf: ["reduces debugging cycles"] },
            { allOf: ["reduces debugging iterations"] },
          ],
        },
      ),
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
    semanticVariants: [
      { component: "ResearchLead", allowed: ["feature", "brief"] },
      { component: "EvidenceList", allowed: ["grid", "stack"] },
    ],
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
    semanticVariants: [{ component: "ResearchLead", allowed: ["feature"] }],
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
    semanticVariants: [{ component: "ResearchLead", allowed: ["brief", "feature"] }],
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
    semanticVariants: [
      { component: "ResearchLead", allowed: ["feature"] },
      { component: "EvidenceList", allowed: ["for-against"] },
    ],
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
    semanticVariants: [
      { component: "ResearchLead", allowed: ["brief", "feature"] },
      { component: "EvidenceList", allowed: ["for-against", "stack"] },
    ],
    requiredFacts: [
      fact("new version", "1.0", "v1.0"),
      fact("earlier version", "0.9.1", "v0.9.1"),
      matchedFact(
        "v1.0 status",
        [
          "v1.0 is still a candidate",
          "v1.0 remains a candidate",
          "v1.0 is a release candidate",
          "1.0 remains a release candidate",
        ],
        {
          kind: "semantic-atoms",
          anyOf: [
            { allOf: ["v1.0", "release", "candidate"] },
            { allOf: ["1.0", "release", "candidate"] },
            { allOf: ["v1.0", "pre-release"] },
            { allOf: ["1.0", "pre-release"] },
            { allOf: ["v1.0", "pre release"] },
            { allOf: ["1.0", "pre release"] },
          ],
        },
      ),
      matchedFact(
        "v0.9.1 status",
        [
          "v0.9.1 remains current",
          "v0.9.1 is current",
          "current production release",
          "0.9.1 is the current stable release",
        ],
        {
          kind: "semantic-atoms",
          anyOf: [
            { allOf: ["v0.9.1", "current", "release"] },
            { allOf: ["0.9.1", "current", "release"] },
            { allOf: ["v0.9.1", "production", "release"] },
            { allOf: ["0.9.1", "production", "release"] },
            { allOf: ["v0.9.1", "stable", "release"] },
            { allOf: ["0.9.1", "stable", "release"] },
          ],
        },
      ),
      fact("challenging evidence", "challenge"),
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
          variant: "balanced",
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
      expect(testCase.expected.semanticVariants.length, testCase.id).toBeGreaterThan(0);
      for (const expectation of testCase.expected.semanticVariants) {
        expect(testCase.expected.requiredComponents, testCase.id).toContain(expectation.component);
        expect(expectation.allowed.length, `${testCase.id}:${expectation.component}`).toBeGreaterThan(
          0,
        );
      }
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

  it("declares QW03 as strip-only and QW04 as strip-or-chart", () => {
    const cases = exportedQualityCases();
    const hourlyVariants = (caseId: string) => cases
      ?.find((testCase) => testCase.id === caseId)
      ?.expected.semanticVariants.find((expectation) => expectation.component === "HourlyForecast")
      ?.allowed;

    expect(hourlyVariants("QW03")).toEqual(["strip"]);
    expect(hourlyVariants("QW04")).toEqual(["strip", "chart"]);
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
    expect(result.issues.find((issue) => issue.code === "recipe_fit")?.message).toBe(
      "Recipe fit mismatch: allowed recipe.",
    );
  });

  it("rejects a primary semantic variant that conflicts with its recipe", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = comparisonTrendCandidate();
    component(input, "ComparisonSummary").variant = "verdict";

    const result = lintSurfaceQuality(input);

    expect(result.checks.recipe_fit).toBe(false);
    expect(result.issues.find((issue) => issue.code === "recipe_fit")?.message).toContain(
      "primary variant",
    );
  });

  it("accepts a grammar-v3 composition without enforcing a recipe tree", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = {
      ...comparisonTrendCandidate(),
      mode: "grammar-v3" as const,
      plan: {
        version: "v3",
        kind: "comparison",
        density: "detailed",
        emphasis: "exploration",
        content: [{}, {}, {}, {}],
      },
    };
    rootNode(input).compositionMode = "grammar-v3";
    delete rootNode(input).recipeId;
    rootNode(input).children = ["editorial-grid", "sources"];
    input.spec.components.push({
      id: "editorial-grid",
      component: "Grid",
      columns: "adaptive",
      gap: "regular",
      children: ["summary", "table", "chart"],
    });

    const result = lintSurfaceQuality(input);

    expect(result.success).toBe(true);
    expect(result.checks.recipe_fit).toBe(true);
    expect(result.checks.answer_first).toBe(true);
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

  it("recognizes Fahrenheit and Celsius aliases from trusted structured unit fields", async () => {
    const lintSurfaceQuality = await loadQualityLinter();

    for (const [unit, requiredUnit] of [
      ["F", "Fahrenheit"],
      ["C", "Celsius"],
    ] as const) {
      const input = comparisonTrendCandidate();
      const chart = component(input, "ComparisonChart");
      chart.unit = unit;
      const summary = component(input, "ComparisonSummary");
      summary.items = [
        { label: "Raleigh", value: "82–84", recommended: true },
        { label: "Charlotte", value: "80–81", recommended: false },
      ];
      const table = component(input, "ComparisonTable");
      table.caption = "Weekend high temperatures";
      const candidate = {
        ...input,
        benchmark: {
          ...input.benchmark,
          expected: {
            ...input.benchmark.expected,
            requiredFacts: [fact("temperature unit", requiredUnit)],
          },
        },
      };

      const result = lintSurfaceQuality(candidate);

      expect(result.checks.requested_coverage, unit).toBe(true);
    }
  });

  it("recognizes requested daily and hourly ranges from trusted item counts", async () => {
    const lintSurfaceQuality = await loadQualityLinter();

    for (const forecast of [
      {
        component: "DailyForecast",
        requiredRange: "seven-day",
        unit: "C",
        items: Array.from({ length: 7 }, (_, index) => ({
          date: `2026-08-${String(index + 3).padStart(2, "0")}`,
          high: 24,
          low: 16,
          precipitationProbability: 20,
          condition: "partly-cloudy",
        })),
      },
      {
        component: "HourlyForecast",
        requiredRange: "four-hour",
        unit: "F",
        items: Array.from({ length: 4 }, (_, index) => ({
          time: `${index + 1}:00 PM`,
          temperature: 81,
          precipitationProbability: 10,
          condition: "clear",
        })),
      },
    ] as const) {
      const input = comparisonTrendCandidate();
      input.spec.components.push({
        id: "forecast",
        component: forecast.component,
        label: "Forecast",
        unit: forecast.unit,
        items: forecast.items,
      });
      const children = rootNode(input).children as string[];
      children.splice(children.length - 1, 0, "forecast");
      const candidate = {
        ...input,
        benchmark: {
          ...input.benchmark,
          expected: {
            ...input.benchmark.expected,
            requiredFacts: [fact("forecast range", forecast.requiredRange)],
          },
        },
      };

      const result = lintSurfaceQuality(candidate);

      expect(result.checks.requested_coverage, forecast.component).toBe(true);
    }
  });

  it("rejects a shortened comparison range even when its chart and table agree with each other", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = comparisonTrendCandidate();
    const summary = component(input, "ComparisonSummary");
    summary.recommendation = "This prose still calls the result a five-day comparison.";
    const chart = component(input, "ComparisonChart");
    chart.labels = ["Saturday", "Sunday"];
    chart.series = [
      { label: "Raleigh", values: [82, 84] },
      { label: "Charlotte", values: [80, 81] },
    ];
    const table = component(input, "ComparisonTable");
    table.columns = ["Period", "Raleigh", "Charlotte"];
    table.rows = [
      ["Saturday", "82", "80"],
      ["Sunday", "84", "81"],
    ];
    const candidate = {
      ...input,
      benchmark: {
        ...input.benchmark,
        expected: {
          ...input.benchmark.expected,
          requiredFacts: [fact("five-day range", "5-day", "five-day", "5 days")],
        },
      },
    };

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.chart_table_alignment).toBe(true);
    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      "five-day range",
    );
  });

  it("requires a decision fact to match the option marked as recommended", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = comparisonTrendCandidate();
    const summary = component(input, "ComparisonSummary");
    summary.recommendation = "It is false that Southwest is more generous; choose Delta.";
    summary.items = [
      { label: "Southwest", value: "Larger published dimensions", recommended: false },
      { label: "Delta", value: "More generous", recommended: true },
    ];
    const candidate = {
      ...input,
      benchmark: {
        ...input.benchmark,
        expected: {
          ...input.benchmark.expected,
          requiredFacts: [fact("decision", "Southwest is more generous", "Southwest more generous")],
        },
      },
    };

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      "decision",
    );
  });

  it("recognizes support, challenge, and neutral coverage from EvidenceList item stances", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = researchBriefCandidate();
    const evidence = component(input, "EvidenceList");
    evidence.items = [
      {
        title: "Official classification",
        finding: "The authority applies its formal definition.",
        sourceId: "src_search01",
        stance: "support",
      },
      {
        title: "Alternative definition",
        finding: "A second source applies a different definition.",
        sourceId: "src_search02",
        stance: "challenge",
      },
      {
        title: "Background",
        finding: "The release record supplies context.",
        sourceId: "src_search02",
        stance: "neutral",
      },
    ];
    const candidate = {
      ...input,
      benchmark: {
        ...input.benchmark,
        expected: {
          ...input.benchmark.expected,
          requiredFacts: [
            fact("supporting evidence", "support"),
            fact("challenging evidence", "challenge"),
            fact("neutral evidence", "neutral"),
          ],
        },
      },
    };

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(true);
  });

  it("requires structured support and challenge stances instead of matching generic prose", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = researchBriefCandidate();
    const evidence = component(input, "EvidenceList");
    evidence.items = [
      {
        title: "Supporting evidence",
        finding: "This prose says the claim has support and evidence for it.",
        sourceId: "src_search01",
        stance: "neutral",
      },
      {
        title: "Challenging evidence",
        finding: "This prose says the evidence is against the claim and presents a challenge.",
        sourceId: "src_search02",
        stance: "neutral",
      },
    ];
    const candidate = {
      ...input,
      benchmark: {
        ...input.benchmark,
        expected: {
          ...input.benchmark.expected,
          requiredFacts: [
            fact("supporting evidence", "for", "support"),
            fact("challenging evidence", "against", "challenge"),
          ],
        },
      },
    };

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      "supporting evidence, challenging evidence",
    );
  });

  it("does not infer structured coverage from arbitrary unit fields or unsupported stances", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const input = comparisonTrendCandidate();
    const summary = component(input, "ComparisonSummary");
    summary.items = [
      { label: "Raleigh", value: "82–84", recommended: true },
      { label: "Charlotte", value: "80–81", recommended: false },
    ];
    const chart = component(input, "ComparisonChart");
    delete chart.unit;
    const table = component(input, "ComparisonTable");
    table.caption = "Weekend high temperatures";
    input.spec.components.push({
      id: "untrusted-semantics",
      component: "TextBlock",
      text: "Additional context.",
      unit: "F",
      stance: "supportive",
    });
    const candidate = {
      ...input,
      benchmark: {
        ...input.benchmark,
        expected: {
          ...input.benchmark.expected,
          requiredFacts: [
            fact("temperature unit", "Fahrenheit"),
            fact("supporting evidence", "support"),
          ],
        },
      },
    };

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      "temperature unit, supporting evidence",
    );
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

  it("aligns complete formatted table values and rejects partial numeric matches", async () => {
    const lintSurfaceQuality = await loadQualityLinter();
    const aligned = comparisonTrendCandidate();
    const alignedChart = component(aligned, "ComparisonChart");
    const alignedTable = component(aligned, "ComparisonTable");
    alignedChart.series = [
      { label: "Raleigh", values: [1200.5, -84] },
      { label: "Charlotte", values: [80, 81] },
    ];
    alignedTable.rows = [
      ["Raleigh", "$1,200.50", "(84.00)"],
      ["Charlotte", "80", "81"],
    ];

    const alignedResult = lintSurfaceQuality(aligned);

    expect(alignedResult.checks.chart_table_alignment).toBe(true);

    const malformed = comparisonTrendCandidate();
    const malformedChart = component(malformed, "ComparisonChart");
    const malformedTable = component(malformed, "ComparisonTable");
    malformedChart.series = [
      { label: "Raleigh", values: [1200, 84] },
      { label: "Charlotte", values: [80, 81] },
    ];
    malformedTable.rows = [
      ["Raleigh", "$1,200 or $2,400", "84"],
      ["Charlotte", "80", "81"],
    ];

    const malformedResult = lintSurfaceQuality(malformed);

    expect(malformedResult.checks.chart_table_alignment).toBe(false);
    expect(issueCodes(malformedResult)).toContain("chart_table_alignment");
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
