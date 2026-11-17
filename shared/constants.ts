export const MODEL_ID = "gemini-3.8-flash" as const;
export const A2UI_VERSION = "v0.9.1" as const;
export const A2UI_PROTOCOL_VERSION = "0.9.1" as const;
export const CATALOG_ID_V2 = "https://lab.jalbright.dev/catalogs/editorial/v2" as const;
export const CATALOG_ID_V3 = "https://lab.jalbright.dev/catalogs/editorial/v3" as const;
export const CATALOG_ID = CATALOG_ID_V2;
export const CATALOG_IDS = [CATALOG_ID_V2, CATALOG_ID_V3] as const;

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
  "SurfaceFrame",
  "EditorialHeading",
  "TextBlock",
  "Metric",
  "Band",
  "Split",
  "Rail",
  "Divider",
  "Stack",
  "Grid",
  "Section",
  "Card",
  "Tabs",
  "Disclosure",
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
