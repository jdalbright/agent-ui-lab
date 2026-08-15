import {
  SURFACE_CONTENT_BUDGETS,
  type SurfaceContentBudget,
} from "../../shared/surface-content-budget.js";

export const UI_RECIPE_IDS = [
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

export type UiRecipeId = (typeof UI_RECIPE_IDS)[number];
export type UiDensity = "brief" | "balanced" | "detailed";
export type UiEmphasis = "answer" | "decision" | "trend" | "evidence" | "risk";

export interface UiSemanticAtomAlternative {
  readonly allOf: readonly [string, ...string[]];
}

export type UiRequiredFactMatcher =
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
      readonly anyOf: readonly [UiSemanticAtomAlternative, ...UiSemanticAtomAlternative[]];
    };

export interface UiRequiredFact {
  readonly concept: string;
  readonly anyOf: readonly [string, ...string[]];
  readonly matcher?: UiRequiredFactMatcher;
}

export interface UiSemanticVariantExpectation {
  readonly component: string;
  readonly allowed: readonly [string, ...string[]];
}

export type UiContentBudget = SurfaceContentBudget;

export interface UiQualityCase {
  readonly id: string;
  readonly recipeId: UiRecipeId;
  readonly prompt: string;
  readonly fixture: string;
  readonly expected: {
    readonly allowedRecipes: readonly [UiRecipeId, ...UiRecipeId[]];
    readonly density: UiDensity;
    readonly emphasis: UiEmphasis;
    readonly requiredComponents: readonly string[];
    readonly orderedComponents: readonly string[];
    readonly semanticVariants: readonly UiSemanticVariantExpectation[];
    readonly requiredFacts: readonly UiRequiredFact[];
    readonly requiredSourceIds: readonly string[];
    readonly contentBudget: UiContentBudget;
  };
}

export const UI_CONTENT_BUDGETS = SURFACE_CONTENT_BUDGETS;

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

function fact(concept: string, ...anyOf: [string, ...string[]]): UiRequiredFact {
  return { concept, anyOf };
}

function matchedFact(
  concept: string,
  anyOf: [string, ...string[]],
  matcher: UiRequiredFactMatcher,
): UiRequiredFact {
  return { concept, anyOf, matcher };
}

function qualityCase(input: {
  id: string;
  recipeId: UiRecipeId;
  prompt: string;
  fixture: string;
  density: UiDensity;
  emphasis: UiEmphasis;
  requiredComponents: readonly string[];
  semanticVariants: readonly UiSemanticVariantExpectation[];
  requiredFacts: readonly UiRequiredFact[];
  requiredSourceIds: readonly string[];
}): UiQualityCase {
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
      contentBudget: UI_CONTENT_BUDGETS[input.density],
    },
  };
}

export const UI_QUALITY_CASES = [
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
    prompt:
      "Score React and Angular in A2UI 0.9.1 on renderer and support. Use official sources.",
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
] as const satisfies readonly UiQualityCase[];
