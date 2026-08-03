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

export interface UiRequiredFact {
  readonly concept: string;
  readonly anyOf: readonly [string, ...string[]];
}

export interface UiContentBudget {
  readonly maxComponents: number;
  readonly maxProseCharacters: number;
  readonly maxLeadCharacters: number;
}

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
    readonly requiredFacts: readonly UiRequiredFact[];
    readonly requiredSourceIds: readonly string[];
    readonly contentBudget: UiContentBudget;
  };
}

export const UI_CONTENT_BUDGETS = {
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
} as const satisfies Record<UiDensity, UiContentBudget>;

function fact(concept: string, ...anyOf: [string, ...string[]]): UiRequiredFact {
  return { concept, anyOf };
}

function qualityCase(input: {
  id: string;
  recipeId: UiRecipeId;
  prompt: string;
  fixture: string;
  density: UiDensity;
  emphasis: UiEmphasis;
  requiredComponents: readonly string[];
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
] as const satisfies readonly UiQualityCase[];
