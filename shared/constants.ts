export const MODEL_ID = "gemini-3.6-flash" as const;
export const A2UI_VERSION = "v0.9.1" as const;
export const A2UI_PROTOCOL_VERSION = "0.9.1" as const;
export const CATALOG_ID = "https://lab.jalbright.dev/catalogs/editorial/v0.9.1" as const;

export const LIMITS = {
  promptCharacters: 1_000,
  locations: 4,
  surfaceNodes: 60,
  surfaceDepth: 6,
  sources: 8,
  toolRounds: 2,
  deadlineMs: 45_000,
  contextTurns: 3,
  contextTtlMs: 30 * 60 * 1_000,
  requestsPerWindow: 20,
  rateWindowSeconds: 10 * 60,
  requestsPerDay: 100,
} as const;

export const TRUSTED_COMPONENT_NAMES = [
  "EditorialHeading",
  "TextBlock",
  "Metric",
  "Band",
  "Split",
  "Rail",
  "Divider",
  "WeatherHero",
  "RecommendationBand",
  "HourlyForecast",
  "DailyForecast",
  "WeatherAlert",
  "LocationPrompt",
  "ComparisonSummary",
  "ComparisonTable",
  "ComparisonChart",
  "ResearchLead",
  "EvidenceList",
  "Timeline",
  "SourceList",
] as const;

export type TrustedComponentName = (typeof TRUSTED_COMPONENT_NAMES)[number];
