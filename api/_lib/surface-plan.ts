import { z } from "zod";
import { LIMITS } from "../../shared/constants.js";
import {
  SURFACE_CONTENT_BUDGETS,
  evaluateSurfaceContentBudget,
} from "../../shared/surface-content-budget.js";
import { parseStrictFormattedNumber } from "../../shared/strict-numeric.js";
import {
  SurfaceSpecSchema,
  type ClientContext,
  type SourceRecord,
  type SurfaceSpec,
} from "../../shared/schemas.js";
import type { GeminiRetrievalResult, WeatherEvidence } from "./gemini.js";
import { requestedLocalHourCoverage } from "./weather-local-hour.js";
import { parseWeatherRequestIntent } from "./weather-request-intent.js";

export const SURFACE_RECIPE_IDS = [
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

const densitySchema = z.enum(["brief", "balanced", "detailed"]);
const emphasisSchema = z.enum(["answer", "decision", "trend", "evidence", "risk"]);
const sourceIdSchema = z.string().regex(/^src_[a-z0-9]{6,32}$/);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const boundedOptionalText = (maximum: number) => z.string().trim().max(maximum).optional();
const RAW_PLAN_URL_PATTERN = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s<>"']*/i;
const MARKUP_LIKE_TAG_PATTERN =
  /<\s*\/?\s*[a-z][^<>]*>|<!--[\s\S]*?-->|<!doctype\b[^>]*>|<\?xml\b[\s\S]*?\?>/i;
const EXECUTABLE_URL_SCHEME_PATTERN = /\b(?:javascript|data|vbscript)\s*:/i;
const SAFE_PLAN_TEXT_MESSAGE =
  "Use safe declarative text without raw URLs, markup-like tags, or executable URL schemes.";

function isSafePlanText(value: string): boolean {
  return (
    !RAW_PLAN_URL_PATTERN.test(value) &&
    !MARKUP_LIKE_TAG_PATTERN.test(value) &&
    !EXECUTABLE_URL_SCHEME_PATTERN.test(value)
  );
}

const safePlanText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).refine(isSafePlanText, SAFE_PLAN_TEXT_MESSAGE);
const safePlanTextAllowEmpty = (maximum: number) =>
  z.string().trim().max(maximum).refine(isSafePlanText, SAFE_PLAN_TEXT_MESSAGE);
const safeOptionalPlanText = (maximum: number) => safePlanTextAllowEmpty(maximum).optional();
const sourceIdsSchema = z.array(sourceIdSchema).min(1).max(LIMITS.sources);
const indexSchema = z.number().int().min(0);

const sourceModuleSchema = z
  .object({
    type: z.literal("sources"),
    label: safePlanText(80),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const weatherHeroModuleSchema = z
  .object({
    type: z.literal("hero"),
    variant: z.enum(["snapshot", "decision"]),
    locationIndex: indexSchema,
    recommendationLabel: safePlanText(80),
    recommendationValue: safePlanText(120),
    recommendationDetail: safePlanText(240),
  })
  .strict();

const weatherActivityRecommendationModuleSchema = z
  .object({
    type: z.literal("recommendation"),
    locationIndex: indexSchema,
    activityWindowIndex: indexSchema,
  })
  .strict();

const weatherDailyRecommendationModuleSchema = z
  .object({
    type: z.literal("recommendation"),
    locationIndex: indexSchema,
    dayIndex: indexSchema,
    signal: z.enum(["wettest", "driest", "warmest", "coolest"]),
  })
  .strict();

const weatherRecommendationModuleSchema = z.union([
  weatherActivityRecommendationModuleSchema,
  weatherDailyRecommendationModuleSchema,
]);

const weatherHourlyModuleSchema = z
  .object({
    type: z.literal("hourly"),
    variant: z.enum(["strip", "chart"]),
    label: safePlanText(80),
    locationIndex: indexSchema,
    hourIndexes: z.array(indexSchema).min(1).max(24),
  })
  .strict();

const weatherDailyModuleSchema = z
  .object({
    type: z.literal("daily"),
    variant: z.enum(["cards", "table"]),
    label: safePlanText(80),
    locationIndex: indexSchema,
    dayIndexes: z.array(indexSchema).min(1).max(10),
  })
  .strict();

const weatherAlertsModuleSchema = z
  .object({
    type: z.literal("alerts"),
    locationIndex: indexSchema,
    alertIndexes: z.array(indexSchema).min(1).max(8),
  })
  .strict();

const weatherMetricsModuleSchema = z
  .object({
    type: z.literal("metrics"),
    locationIndex: indexSchema,
    metrics: z
      .array(
        z.enum(["feelsLike", "humidity", "wind", "uv", "visibility", "precipitation"]),
      )
      .min(1)
      .max(6),
  })
  .strict();

const weatherModuleSchema = z.union([
  weatherHeroModuleSchema,
  weatherRecommendationModuleSchema,
  weatherHourlyModuleSchema,
  weatherDailyModuleSchema,
  weatherAlertsModuleSchema,
  weatherMetricsModuleSchema,
  sourceModuleSchema,
]);

const comparisonItemSchema = z
  .object({
    label: safePlanText(120),
    value: safePlanText(120),
    detail: safeOptionalPlanText(220),
    recommended: z.boolean(),
  })
  .strict();

const locationIndexesSchema = z.array(indexSchema).min(2).max(LIMITS.locations);

const authoredComparisonSummaryModuleSchema = z
  .object({
    type: z.literal("summary"),
    variant: z.enum(["verdict", "balanced"]),
    title: safePlanText(180),
    recommendation: safePlanText(400),
    items: z.array(comparisonItemSchema).min(2).max(4),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const weatherComparisonSummaryModuleSchema = z
  .object({
    type: z.literal("summary"),
    variant: z.enum(["verdict", "balanced"]),
    title: safePlanText(180),
    recommendation: safePlanText(400),
    locationIndexes: locationIndexesSchema,
    recommendedLocationIndex: indexSchema.optional(),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const authoredComparisonTableModuleSchema = z
  .object({
    type: z.literal("table"),
    caption: safePlanText(160),
    columns: z.array(safePlanText(80)).min(2).max(6),
    rows: z.array(z.array(safePlanTextAllowEmpty(160)).min(2).max(6)).min(1).max(12),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const weatherCurrentMetricSchema = z.enum([
  "temperature",
  "feelsLike",
  "humidity",
  "precipitation",
  "wind",
  "uv",
  "visibility",
]);

const weatherForecastMetricSchema = z.enum([
  "temperature",
  "high",
  "low",
  "precipitation",
]);

const weatherComparisonTableModuleSchema = z
  .object({
    type: z.literal("table"),
    caption: safePlanText(160),
    locationIndexes: locationIndexesSchema,
    forecastKind: z.enum(["current", "hourly", "daily"]),
    forecastIndexes: z.array(indexSchema).min(1).max(24).optional(),
    metrics: z.array(weatherCurrentMetricSchema).min(1).max(7).optional(),
    metric: weatherForecastMetricSchema.optional(),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const authoredComparisonChartModuleSchema = z
  .object({
    type: z.literal("chart"),
    variant: z.enum(["line", "bar"]),
    title: safePlanText(160),
    labels: z.array(safePlanText(60)).min(2).max(12),
    series: z
      .array(
        z
          .object({
            label: safePlanText(80),
            values: z.array(z.number().finite()).min(2).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    unit: safeOptionalPlanText(24),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const weatherComparisonChartModuleSchema = z
  .object({
    type: z.literal("chart"),
    variant: z.enum(["line", "bar"]),
    title: safePlanText(160),
    locationIndexes: locationIndexesSchema,
    forecastKind: z.enum(["hourly", "daily"]),
    forecastIndexes: z.array(indexSchema).min(2).max(24),
    metric: weatherForecastMetricSchema,
    sourceIds: sourceIdsSchema,
  })
  .strict();

const comparisonModuleSchema = z.union([
  authoredComparisonSummaryModuleSchema,
  weatherComparisonSummaryModuleSchema,
  authoredComparisonTableModuleSchema,
  weatherComparisonTableModuleSchema,
  authoredComparisonChartModuleSchema,
  weatherComparisonChartModuleSchema,
  sourceModuleSchema,
]);

const researchLeadModuleSchema = z
  .object({
    type: z.literal("lead"),
    variant: z.enum(["feature", "brief"]),
    title: safePlanText(220),
    summary: safePlanText(1_200),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const researchEvidenceModuleSchema = z
  .object({
    type: z.literal("evidence"),
    variant: z.enum(["stack", "grid", "for-against"]),
    label: safePlanText(80),
    items: z
      .array(
        z
          .object({
            title: safePlanText(180),
            finding: safePlanText(700),
            sourceId: sourceIdSchema,
            stance: z.enum(["support", "challenge", "neutral"]),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

const researchTimelineModuleSchema = z
  .object({
    type: z.literal("timeline"),
    label: safePlanText(80),
    items: z
      .array(
        z
          .object({
            date: safePlanText(80),
            title: safePlanText(180),
            detail: safePlanText(500),
            sourceId: sourceIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

const researchModuleSchema = z.discriminatedUnion("type", [
  researchLeadModuleSchema,
  researchEvidenceModuleSchema,
  researchTimelineModuleSchema,
  sourceModuleSchema,
]);

function planSchema<
  const Kind extends "weather" | "comparison" | "research",
  const Recipe extends (typeof SURFACE_RECIPE_IDS)[number],
  ModuleSchema extends z.ZodTypeAny,
>(kind: Kind, recipeId: Recipe, modules: ModuleSchema) {
  return z
    .object({
      kind: z.literal(kind),
      recipeId: z.literal(recipeId),
      density: densitySchema,
      emphasis: emphasisSchema,
      modules: z.array(modules).min(1).max(16),
    })
    .strict();
}

export const SurfacePlanSchema = z.discriminatedUnion("recipeId", [
  planSchema("weather", "weather.snapshot", weatherModuleSchema),
  planSchema("weather", "weather.decision", weatherModuleSchema),
  planSchema("weather", "weather.outlook", weatherModuleSchema),
  planSchema("comparison", "comparison.verdict", comparisonModuleSchema),
  planSchema("comparison", "comparison.scorecard", comparisonModuleSchema),
  planSchema("comparison", "comparison.trend", comparisonModuleSchema),
  planSchema("research", "research.brief", researchModuleSchema),
  planSchema("research", "research.timeline", researchModuleSchema),
  planSchema("research", "research.claims", researchModuleSchema),
]);

export type SurfacePlan = z.infer<typeof SurfacePlanSchema>;
export const WeatherPlanModuleSchema = weatherModuleSchema;
export const ComparisonPlanModuleSchema = comparisonModuleSchema;
export const ResearchPlanModuleSchema = researchModuleSchema;
export type SurfacePlanModule = SurfacePlan["modules"][number];

function definingModuleForPlan(
  plan: SurfacePlan,
  prompt: string | undefined,
): SurfacePlan["modules"][number]["type"] {
  const intent = parseWeatherRequestIntent(prompt ?? "");
  if (
    plan.recipeId === "weather.outlook" &&
    (intent.forecastHours !== undefined || intent.localTime !== undefined)
  ) {
    return "hourly";
  }
  return SURFACE_RECIPES[plan.recipeId].requiredModule;
}

export const SURFACE_RECIPES = Object.freeze({
  "weather.snapshot": {
    selectionRule: "Choose for current conditions or a short near-term answer.",
    idealUse: "A fast glance at one location now.",
    misuseWarning: "Do not use when the user is making an activity decision or asks for a multi-day range.",
    compatibleModules: ["hero", "metrics", "hourly", "alerts", "sources"],
    requiredModule: "hero",
    example: "What is the weather in Raleigh right now?",
  },
  "weather.decision": {
    selectionRule: "Choose when weather determines whether or when to do an activity.",
    idealUse: "A recommendation backed by a deterministic activity window.",
    misuseWarning: "Do not use for a plain current-conditions request without a decision.",
    compatibleModules: ["hero", "recommendation", "hourly", "daily", "alerts", "sources"],
    requiredModule: "recommendation",
    example: "When should I walk this evening?",
  },
  "weather.outlook": {
    selectionRule: "Choose for requested hour or day ranges and changing conditions over time.",
    idealUse: "A bounded hourly or multi-day forecast and risk outlook.",
    misuseWarning: "Do not use when only the current temperature is requested.",
    compatibleModules: ["hero", "recommendation", "daily", "hourly", "alerts", "sources"],
    requiredModule: "daily",
    example: "Show the weather through Tuesday.",
  },
  "comparison.verdict": {
    selectionRule: "Choose when the user primarily wants a concise recommendation.",
    idealUse: "A decision-first comparison with a compact evidence table.",
    misuseWarning: "Do not use when change over time is the central question.",
    compatibleModules: ["summary", "table", "sources"],
    requiredModule: "summary",
    example: "Which option is better for a quick launch?",
  },
  "comparison.scorecard": {
    selectionRule: "Choose when several explicit criteria must be weighed side by side.",
    idealUse: "A balanced, criteria-complete scorecard.",
    misuseWarning: "Do not use for a single-metric trend question.",
    compatibleModules: ["summary", "table", "chart", "sources"],
    requiredModule: "table",
    example: "Compare these tools on price, setup, and accessibility.",
  },
  "comparison.trend": {
    selectionRule: "Choose when the options are compared across an ordered sequence or time range.",
    idealUse: "A chart-led comparison with aligned evidence.",
    misuseWarning: "Do not use when the evidence has no meaningful ordered axis.",
    compatibleModules: ["summary", "chart", "table", "sources"],
    requiredModule: "chart",
    example: "Compare their adoption over the last three releases.",
  },
  "research.brief": {
    selectionRule: "Choose for a direct grounded answer with a small evidence set.",
    idealUse: "An answer-first research brief.",
    misuseWarning: "Do not use when chronology or contested claims are essential.",
    compatibleModules: ["lead", "evidence", "timeline", "sources"],
    requiredModule: "lead",
    example: "What changed in the latest release?",
  },
  "research.timeline": {
    selectionRule: "Choose when sequence, milestones, or dates explain the answer.",
    idealUse: "A chronology with a source on every milestone.",
    misuseWarning: "Do not force unrelated facts into a timeline.",
    compatibleModules: ["lead", "timeline", "evidence", "sources"],
    requiredModule: "timeline",
    example: "How did the product move from preview to general availability?",
  },
  "research.claims": {
    selectionRule: "Choose when claims need support, challenge, or qualification.",
    idealUse: "A claim-by-claim evidence review.",
    misuseWarning: "Do not manufacture opposition when the sources are not in tension.",
    compatibleModules: ["lead", "evidence", "sources"],
    requiredModule: "evidence",
    example: "What evidence supports and challenges this claim?",
  },
} as const);

const CANONICAL_MODULE_ORDER = {
  "weather.snapshot": ["hero", "metrics", "hourly", "alerts", "sources"],
  "weather.decision": ["hero", "recommendation", "hourly", "daily", "alerts", "sources"],
  "weather.outlook": ["hero", "daily", "recommendation", "hourly", "alerts", "sources"],
  "comparison.verdict": ["summary", "table", "sources"],
  "comparison.scorecard": ["summary", "table", "chart", "sources"],
  "comparison.trend": ["summary", "chart", "table", "sources"],
  "research.brief": ["lead", "evidence", "timeline", "sources"],
  "research.timeline": ["lead", "timeline", "evidence", "sources"],
  "research.claims": ["lead", "evidence", "sources"],
} as const satisfies Readonly<Record<SurfacePlan["recipeId"], readonly string[]>>;

function canonicalModuleOrder(plan: SurfacePlan, prompt: string | undefined): readonly string[] {
  const intent = parseWeatherRequestIntent(prompt ?? "");
  if (
    plan.recipeId === "weather.outlook" &&
    (intent.forecastHours !== undefined || intent.localTime !== undefined)
  ) {
    return ["hero", "hourly", "recommendation", "daily", "alerts", "sources"];
  }
  return CANONICAL_MODULE_ORDER[plan.recipeId];
}

function modulesFollowCanonicalOrder(plan: SurfacePlan, prompt: string | undefined): boolean {
  const order = canonicalModuleOrder(plan, prompt);
  let previous = -1;
  for (const module of plan.modules) {
    const current = order.indexOf(module.type);
    if (current < 0 || current < previous) return false;
    previous = current;
  }
  return true;
}

const conditionSchema = z.enum([
  "clear",
  "partly-cloudy",
  "cloudy",
  "rain",
  "storms",
  "snow",
  "fog",
  "wind",
  "unknown",
]);

const weatherLocationSchema = z
  .object({
    name: boundedText(120),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    placeId: z.string().trim().max(240).optional(),
  })
  .passthrough();

const currentConditionsSchema = z
  .object({
    observedAt: z.string().min(1).max(80),
    timeZone: z.string().min(1).max(80),
    temperature: z.number().finite().min(-150).max(150),
    feelsLike: z.number().finite().min(-150).max(150),
    temperatureUnit: z.enum(["F", "C"]),
    conditionKey: conditionSchema,
    conditionText: boundedText(80),
    humidity: z.number().finite().min(0).max(100),
    precipitationProbability: z.number().finite().min(0).max(100),
    windDirection: z.string().trim().max(20),
    windSpeed: z.number().finite().min(0).max(500),
    windSpeedUnit: z.enum(["mph", "km/h"]),
    visibility: z.number().finite().min(0).max(1_000),
    visibilityUnit: z.enum(["mi", "km"]),
    uvIndex: z.number().finite().min(0).max(100),
  })
  .passthrough();

const hourlyForecastSchema = z
  .object({
    startTime: z.string().min(1).max(80),
    temperature: z.number().finite().min(-150).max(150),
    temperatureUnit: z.enum(["F", "C"]),
    precipitationProbability: z.number().finite().min(0).max(100).nullable(),
    conditionKey: conditionSchema,
  })
  .passthrough();

const dailyForecastSchema = z
  .object({
    date: boundedText(60),
    high: z.number().finite().min(-150).max(150),
    low: z.number().finite().min(-150).max(150),
    temperatureUnit: z.enum(["F", "C"]),
    precipitationProbability: z.number().finite().min(0).max(100),
    conditionKey: conditionSchema,
  })
  .passthrough();

const weatherAlertSchema = z
  .object({
    title: boundedText(160),
    description: boundedText(700),
    severity: z.enum(["minor", "moderate", "severe", "extreme", "unknown"]),
    sourceName: boundedOptionalText(160),
    sourceAuthorityUri: z.string().url().optional(),
    startsAt: z.string().min(1).max(80).optional(),
    expiresAt: z.string().min(1).max(80).optional(),
  })
  .passthrough();

const locationWeatherSchema = z
  .object({
    location: weatherLocationSchema,
    current: currentConditionsSchema,
    hourly: z.array(hourlyForecastSchema).max(240),
    daily: z.array(dailyForecastSchema).max(10),
    alerts: z.array(weatherAlertSchema).max(32),
  })
  .passthrough();

const activityWindowSchema = z
  .object({
    location: weatherLocationSchema,
    activity: boundedOptionalText(80),
    durationHours: z.number().int().min(1).max(6).optional(),
    startTime: z.string().min(1).max(80),
    endTime: z.string().min(1).max(80),
    label: boundedText(80),
    detail: boundedText(320),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .passthrough();

const weatherResultSchema = z
  .object({
    locations: z.array(locationWeatherSchema).min(1).max(LIMITS.locations),
    activityWindows: z.array(activityWindowSchema).max(LIMITS.locations).default([]),
  })
  .passthrough();

type WeatherLocationEvidence = z.infer<typeof locationWeatherSchema>;
type ActivityWindowEvidence = z.infer<typeof activityWindowSchema>;
type PlanModule = SurfacePlan["modules"][number];
type WeatherModule = Extract<SurfacePlan, { kind: "weather" }>["modules"][number];
type WeatherContentModule = Exclude<WeatherModule, { type: "sources" }>;
type WeatherComparisonSummaryModule = z.infer<typeof weatherComparisonSummaryModuleSchema>;
type AuthoredComparisonTableModule = z.infer<typeof authoredComparisonTableModuleSchema>;
type WeatherComparisonTableModule = z.infer<typeof weatherComparisonTableModuleSchema>;
type AuthoredComparisonChartModule = z.infer<typeof authoredComparisonChartModuleSchema>;
type WeatherComparisonChartModule = z.infer<typeof weatherComparisonChartModuleSchema>;

interface WeatherState {
  locations: WeatherLocationEvidence[];
  activityWindows: ActivityWindowEvidence[];
  issues: string[];
}

function readWeatherState(evidence: readonly WeatherEvidence[]): WeatherState {
  const locations: WeatherLocationEvidence[] = [];
  const activityWindows: ActivityWindowEvidence[] = [];
  const issues: string[] = [];

  for (const record of evidence) {
    if (record.tool !== "get_weather_bundle") continue;
    const parsed = weatherResultSchema.safeParse(record.result);
    if (!parsed.success) {
      issues.push("Weather evidence is malformed and cannot be referenced safely.");
      continue;
    }
    locations.push(...parsed.data.locations);
    activityWindows.push(...parsed.data.activityWindows);
  }

  if (locations.length > LIMITS.locations) {
    issues.push(`Weather evidence exceeds the ${LIMITS.locations}-location limit.`);
  }

  return { locations, activityWindows, issues };
}

function isWeatherContentModule(module: PlanModule): module is WeatherContentModule {
  return (
    module.type === "hero" ||
    module.type === "recommendation" ||
    module.type === "hourly" ||
    module.type === "daily" ||
    module.type === "alerts" ||
    module.type === "metrics"
  );
}

export interface SurfacePlanValidationContext {
  sources: readonly SourceRecord[];
  evidence: readonly WeatherEvidence[];
  prompt?: string;
  clientContext?: ClientContext;
}

export interface SurfacePlanValidationOptions {
  mode?: "recipe-v2" | "grammar-v3";
}

export type SurfacePlanValidationResult =
  | { success: true; plan: SurfacePlan }
  | { success: false; issues: string[] };

function uniqueValues(values: readonly number[]): boolean {
  return new Set(values).size === values.length;
}

function locationsMatch(
  left: WeatherLocationEvidence["location"],
  right: ActivityWindowEvidence["location"],
): boolean {
  if (left.placeId && right.placeId) return left.placeId === right.placeId;
  return (
    left.name === right.name &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isSourceModule(module: PlanModule): module is z.infer<typeof sourceModuleSchema> {
  return module.type === "sources";
}

function isWeatherComparisonSummary(
  module: PlanModule,
): module is WeatherComparisonSummaryModule {
  return module.type === "summary" && "locationIndexes" in module;
}

function isWeatherComparisonTable(
  module: PlanModule,
): module is WeatherComparisonTableModule {
  return module.type === "table" && "locationIndexes" in module;
}

function isWeatherComparisonChart(
  module: PlanModule,
): module is WeatherComparisonChartModule {
  return module.type === "chart" && "locationIndexes" in module;
}

function canonicalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

function alertAuthoritySourceId(
  alert: z.infer<typeof weatherAlertSchema>,
  sources: readonly SourceRecord[],
): string | undefined {
  const authorityUrl = canonicalUrl(alert.sourceAuthorityUri);
  if (!authorityUrl) return undefined;
  return sources.find((source) => canonicalUrl(source.url) === authorityUrl)?.id;
}

function generalWeatherSourceId(
  sources: readonly SourceRecord[],
  state: WeatherState,
): string | undefined {
  const authorityUrls = new Set(
    state.locations.flatMap((location) =>
      location.alerts
        .map((alert) => canonicalUrl(alert.sourceAuthorityUri))
        .filter((url): url is string => Boolean(url)),
    ),
  );
  const weatherSources = sources.filter((source) => source.provider === "google-weather");
  return (
    weatherSources.find((source) => !authorityUrls.has(canonicalUrl(source.url) ?? ""))?.id ??
    weatherSources[0]?.id
  );
}

function referencedLocationIndexes(plan: SurfacePlan): number[] {
  const indexes: number[] = [];
  for (const module of plan.modules) {
    if (isSourceModule(module)) continue;
    if ("locationIndexes" in module) indexes.push(...module.locationIndexes);
    else if ("locationIndex" in module) indexes.push(module.locationIndex);
  }
  return indexes;
}

function contentSourceIds(
  plan: SurfacePlan,
  context: SurfacePlanValidationContext,
  state: WeatherState,
): string[] {
  const sourceIds: string[] = state.locations.length > 0
    ? context.sources
        .filter((source) => source.provider === "google-weather")
        .map((source) => source.id)
    : [];
  const generalWeatherId = generalWeatherSourceId(context.sources, state);

  for (const module of plan.modules) {
    if (isSourceModule(module)) continue;
    if ("sourceIds" in module) sourceIds.push(...module.sourceIds);
    if (module.type === "evidence" || module.type === "timeline") {
      for (const item of module.items) sourceIds.push(item.sourceId);
    }

    if (plan.kind === "weather" && isWeatherContentModule(module)) {
      if (generalWeatherId) sourceIds.push(generalWeatherId);
      if (module.type === "alerts") {
        const location = state.locations[module.locationIndex];
        for (const alertIndex of module.alertIndexes) {
          const alert = location?.alerts[alertIndex];
          const authorityId = alert ? alertAuthoritySourceId(alert, context.sources) : undefined;
          if (authorityId) sourceIds.push(authorityId);
        }
      }
    }

    if (
      plan.kind === "comparison" &&
      state.locations.length > 0 &&
      (isWeatherComparisonSummary(module) ||
        isWeatherComparisonTable(module) ||
        isWeatherComparisonChart(module)) &&
      generalWeatherId
    ) {
      sourceIds.push(generalWeatherId);
    }
  }

  return [...new Set(sourceIds)];
}

export function expectedRecipeForPrompt(
  prompt: string | undefined,
  kind: SurfacePlan["kind"],
  weatherBacked = false,
): SurfacePlan["recipeId"] | undefined {
  if (!prompt?.trim()) return undefined;
  const normalized = prompt.toLocaleLowerCase("en-US");
  const weatherIntent = parseWeatherRequestIntent(prompt);
  const wordNumber = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten)`;
  const orderedTimeRange = new RegExp(
    String.raw`\b(?:next\s+)?(?:\d{1,4}|${wordNumber})\s*[- ]?(?:hours?|days?|weeks?|months?|years?|releases?)\b|\b(?:next|this)\s+week\b`,
  ).test(normalized);
  const chartOrPlot = /\b(?:chart|plot|graph)\b/.test(normalized);

  if (kind === "weather") {
    if (
      /\b(when should|best time|best window|should i|safe to|can i|walk|run|hike|ride|activity|outdoor plan)\b/.test(
        normalized,
      )
    ) {
      return "weather.decision";
    }
    if (
      orderedTimeRange ||
      weatherIntent.localTime !== undefined ||
      weatherIntent.nextWeekday !== undefined ||
      /\b(outlook|forecast|through|until|weekend|tomorrow)\b/.test(normalized)
    ) {
      return "weather.outlook";
    }
    return "weather.snapshot";
  }

  if (kind === "comparison") {
    if (
      /\b(trend|over time|timeline|history|growth|adoption|across (?:the )?(?:last|next))\b/.test(normalized) ||
      orderedTimeRange ||
      (chartOrPlot && weatherBacked) ||
      (weatherBacked &&
        (/\bweekend\b/.test(normalized) ||
          /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.+\b(?:and|through|to|versus|vs\.?)\b.+\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
            normalized,
          ) ||
          /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*[-–]\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(normalized)))
    ) {
      return "comparison.trend";
    }
    if (/\b(score|rank|scorecard)\b/.test(normalized)) return "comparison.scorecard";
    if (/\b(which|better|best|choose|recommend|winner|verdict|more generous|tell me which)\b/.test(normalized)) {
      return "comparison.verdict";
    }
    if (extractRequestedCriteria(normalized).length >= 2) return "comparison.scorecard";
    return undefined;
  }

  if (/\b(timeline|chronology|history|evolution|milestones?|from .+ to)\b/.test(normalized)) {
    return "research.timeline";
  }
  if (
    /\b(claims?|evidence (?:for|against)|supports? (?:or|and) challenges?|verify|fact[- ]?check|debunk|is .+ true)\b/.test(
      normalized,
    )
  ) {
    return "research.claims";
  }
  return "research.brief";
}

function extractRequestedCriteria(prompt: string): string[] {
  const normalized = prompt
    .toLocaleLowerCase("en-US")
    .replace(/[?.!]+$/, "")
    .trim();
  const colonClause = /(?:\bcompare\b|\bversus\b|\bvs\.?\b)[^:?.]*:\s*([^?.]+)/.exec(
    normalized,
  )?.[1];
  const forMatch = /\bfor\s+([^?.:]+)$/.exec(normalized);
  const forClause = forMatch?.[1];
  const rawForClause = /\bfor\s+([^?.:]+)[?.!]*$/i.exec(prompt.trim())?.[1]?.trim();
  const forParts = forClause
    ? forClause.split(/,|\band\b|\bversus\b|\bvs\.?\b/).map((value) => value.trim()).filter(Boolean)
    : [];
  const beforeFor = forMatch ? normalized.slice(0, forMatch.index) : "";
  const forNamesWeatherLocations = /\b(?:weather|forecasts?|conditions?|temperatures?|highs?|lows?)\b/.test(
    beforeFor,
  );
  const forNamesActivitiesOrDates = forParts.some((value) =>
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|weekend|brunch|dinner|walk(?:ing)?|run(?:ning)?|jog(?:ging)?|hik(?:e|ing)|bik(?:e|ing)|cycl(?:e|ing)|golf|outdoors?)\b/.test(
      value,
    ),
  );
  const singleForLooksLikeLocation =
    forParts.length === 1 &&
    rawForClause !== undefined &&
    /^[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*(?:,\s*[A-Z]{2})?$/.test(rawForClause);
  const explicitForCriteria =
    forParts.length >= 1 &&
    !forNamesWeatherLocations &&
    !forNamesActivitiesOrDates &&
    !singleForLooksLikeLocation
      ? forClause
      : undefined;
  const methodClause = /\b(?:using|with)\s+([^?.]+)/.exec(normalized)?.[1];
  const explicitMethodCriteria =
    methodClause &&
    !/^(?:only\s+)?(?:official\s+)?(?:sources?|evidence|documentation)$/.test(methodClause.trim())
      ? methodClause
      : undefined;
  const explicit =
    normalized.match(/(?:criteria(?:\s+(?:are|of))?)\s*[:-]?\s*([^?.]+)/)?.[1] ??
    normalized.match(/(?:^|\s)(?:on|by|across)\s+([^?.]+)/)?.[1] ??
    colonClause ??
    explicitForCriteria ??
    explicitMethodCriteria;
  const criteriaText = explicit
    ?.replace(
      /\b(?:then\s+)?(?:and\s+)?(?:tell me|which|recommend|choose|decide)\b.*$/,
      "",
    )
    .replace(/\b(?:using|with)\s+(?:only\s+)?(?:official\s+)?(?:sources?|evidence|documentation)\b.*$/, "");
  const candidates = criteriaText
    ? criteriaText.split(/,|\band\b|\bversus\b|\bvs\.?\b/)
    : [];
  const cleaned = candidates
    .map((value) => value.replace(/^(?:the|their|its)\s+/, "").trim())
    .filter((value) => value.length >= 2 && value.length <= 48)
    .slice(0, 6);
  if (cleaned.length >= 1) return [...new Set(cleaned)];

  const knownCriteria = [
    "price",
    "cost",
    "setup",
    "accessibility",
    "performance",
    "security",
    "features",
    "support",
    "reliability",
    "speed",
    "battery",
    "privacy",
    "temperature",
    "humidity",
    "rain",
    "precipitation",
    "wind",
    "uv",
  ];
  return knownCriteria.filter((criterion) => new RegExp(`\\b${criterion}\\b`).test(normalized));
}

function requestedRange(prompt: string | undefined, unit: "hour" | "day"): number | undefined {
  if (!prompt) return undefined;
  const intent = parseWeatherRequestIntent(prompt);
  if (unit === "hour") return intent.forecastHours;
  if (intent.forecastDays !== undefined) return intent.forecastDays;
  return intent.relativeDayOffsets.length > 1
    ? Math.max(...intent.relativeDayOffsets) + 1
    : undefined;
}

function requestedTemperatureUnit(
  prompt: string | undefined,
  clientContext: ClientContext | undefined,
): "F" | "C" | undefined {
  const requestedUnits = parseWeatherRequestIntent(prompt ?? "").requestedUnits;
  if (requestedUnits) return requestedUnits === "metric" ? "C" : "F";
  return clientContext?.units === "metric"
    ? "C"
    : clientContext?.units === "imperial"
      ? "F"
      : undefined;
}

function requestedDayCount(prompt: string | undefined, state: WeatherState): number | undefined {
  const direct = requestedRange(prompt, "day");
  if (direct || !prompt || state.locations.length === 0) return direct;
  if (
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:through|to|[-–])\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      prompt,
    )
  ) {
    return undefined;
  }
  const weekday = /\b(?:through|until)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(
    prompt,
  )?.[1]?.toLocaleLowerCase("en-US");
  if (!weekday) return undefined;
  const targetIndex = state.locations[0].daily.findIndex((day) => {
    const parsed = new Date(`${day.date}T12:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" })
      .format(parsed)
      .toLocaleLowerCase("en-US") === weekday;
  });
  return targetIndex >= 0 ? targetIndex + 1 : undefined;
}

function requestedSpecificDayIndexes(
  prompt: string | undefined,
  state: WeatherState,
): number[] {
  if (!prompt || state.locations.length === 0) return [];
  const normalized = prompt.toLocaleLowerCase("en-US");
  const weekdayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const;
  const requested = new Set<string>();
  const range = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:through|to|[-–])\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(
    normalized,
  );
  if (range) {
    let index = weekdayNames.indexOf(range[1] as (typeof weekdayNames)[number]);
    const end = weekdayNames.indexOf(range[2] as (typeof weekdayNames)[number]);
    for (let count = 0; count < weekdayNames.length; count += 1) {
      requested.add(weekdayNames[index]);
      if (index === end) break;
      index = (index + 1) % weekdayNames.length;
    }
  }
  const pair = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.+\b(?:and|versus|vs\.?)\b.+\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(
    normalized,
  );
  if (pair) {
    requested.add(pair[1]);
    requested.add(pair[2]);
  }
  if (/\bweekend\b/.test(normalized)) {
    requested.add("saturday");
    requested.add("sunday");
  }
  const single = /\b(?:for|on|this|next)\s+(?:a\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(
    normalized,
  );
  if (single) requested.add(single[1]);
  const relativeDayOffset =
    /\btomorrow\b/.test(normalized) &&
    !requestedActivity(prompt) &&
    requestedLocalMinutes(prompt) === undefined
      ? 1
      : undefined;
  if (requested.size === 0 && relativeDayOffset === undefined) return [];

  const indexes: number[] = [];
  state.locations[0].daily.forEach((day, index) => {
    const parsed = new Date(`${day.date}T12:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return;
    const weekday = weekdayNames[parsed.getUTCDay()];
    if (requested.has(weekday)) indexes.push(index);
  });
  const nextWeekday = /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(
    normalized,
  )?.[1];
  if (nextWeekday) {
    const location = state.locations[0];
    const observed = localCalendarOrdinal(location.current.observedAt, location.current.timeZone);
    const nextIndex = indexes.find((index) => {
      const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(location.daily[index]?.date ?? "");
      if (!parsed || observed === undefined) return false;
      const ordinal = Math.floor(
        Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])) / 86_400_000,
      );
      return ordinal > observed;
    });
    return [nextIndex ?? -1];
  }
  if (relativeDayOffset !== undefined) {
    const location = state.locations[0];
    const observed = localCalendarOrdinal(location.current.observedAt, location.current.timeZone);
    const relativeIndex = location.daily.findIndex((day) => {
      const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.date);
      if (!parsed) return false;
      const ordinal = Math.floor(
        Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])) / 86_400_000,
      );
      return observed !== undefined && ordinal - observed === relativeDayOffset;
    });
    indexes.push(relativeIndex);
  }
  return indexes.length >= requested.size + (relativeDayOffset === undefined ? 0 : 1)
    ? [...new Set(indexes)]
    : [...new Set([...indexes, -1])];
}

function requestedDailyCandidateIndexes(
  prompt: string | undefined,
  state: WeatherState,
  locationIndex: number,
): number[] {
  const location = state.locations[locationIndex];
  if (!location) return [];
  const count = requestedDayCount(prompt, state);
  if (count !== undefined) {
    return location.daily.slice(0, Math.min(count, location.daily.length)).map((_, index) => index);
  }
  const specific = requestedSpecificDayIndexes(prompt, state).filter(
    (index) => index >= 0 && index < location.daily.length,
  );
  return specific.length > 0
    ? [...new Set(specific)]
    : location.daily.map((_, index) => index);
}

function requestedActivity(prompt: string | undefined): string | undefined {
  if (!prompt) return undefined;
  const normalized = prompt.toLocaleLowerCase("en-US");
  const activities: readonly [RegExp, string][] = [
    [/\b(?:run|running|jog|jogging)\b/, "run"],
    [/\b(?:walk|walking)\b/, "walk"],
    [/\b(?:hike|hiking)\b/, "hike"],
    [/\b(?:bike|biking|cycle|cycling|ride)\b/, "bike"],
    [/\bbrunch\b/, "brunch"],
    [/\bdinner\b/, "dinner"],
    [/\bgolf\b/, "golf"],
  ];
  return activities.find(([pattern]) => pattern.test(normalized))?.[1];
}

function canonicalActivity(value: string): string {
  const normalized = value.toLocaleLowerCase("en-US");
  if (/\b(?:run|running|jog|jogging)\b/.test(normalized)) return "run";
  if (/\b(?:walk|walking)\b/.test(normalized)) return "walk";
  if (/\b(?:hike|hiking)\b/.test(normalized)) return "hike";
  if (/\b(?:bike|biking|cycle|cycling|ride)\b/.test(normalized)) return "bike";
  if (/\bbrunch\b/.test(normalized)) return "brunch";
  if (/\bdinner\b/.test(normalized)) return "dinner";
  if (/\bgolf\b/.test(normalized)) return "golf";
  return normalized.trim();
}

function requestedLocalMinutes(prompt: string | undefined): number | undefined {
  if (!prompt) return undefined;
  const match = /\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(prompt);
  if (!match) return undefined;
  let hour = Number(match[1]) % 12;
  if (match[3].toLocaleLowerCase("en-US").startsWith("p")) hour += 12;
  return hour * 60 + Number(match[2] ?? 0);
}

function localWindowParts(value: string, timeZone: string): { minutes: number; weekday: string } | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value.toLocaleLowerCase("en-US");
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !weekday) return undefined;
  return { minutes: hour * 60 + minute, weekday };
}

function localCalendarOrdinal(value: string, timeZone: string): number | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (![year, month, day].every(Number.isFinite)) return undefined;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function activityRecommendationCoverageIssues(
  plan: SurfacePlan,
  context: SurfacePlanValidationContext,
  state: WeatherState,
): string[] {
  if (plan.kind !== "weather" || !context.prompt) return [];
  const activity = requestedActivity(context.prompt);
  const localMinutes = requestedLocalMinutes(context.prompt);
  const weekday = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(
    context.prompt,
  )?.[1]?.toLocaleLowerCase("en-US");
  const requestedDayOffset = /\btomorrow\b/i.test(context.prompt)
    ? 1
    : /\btoday\b/i.test(context.prompt)
      ? 0
      : undefined;
  const decisionIntent = /\b(?:when should|best time|best window|safe to|can i)\b/i.test(
    context.prompt,
  );
  if (!activity && !decisionIntent) return [];

  const issues: string[] = [];
  const recommendations = plan.modules.filter(
    (module): module is z.infer<typeof weatherActivityRecommendationModuleSchema> =>
      module.type === "recommendation" && "activityWindowIndex" in module,
  );
  if (recommendations.length === 0) return ["Requested activity window is not covered."];
  for (const module of recommendations) {
    const location = state.locations[module.locationIndex];
    const window = state.activityWindows[module.activityWindowIndex];
    if (!location || !window) continue;
    const describedActivity = canonicalActivity(`${window.activity ?? ""} ${window.label}`);
    if (activity && describedActivity !== activity) {
      issues.push(`Requested ${activity} activity is not covered by the selected window.`);
    }
    const local = localWindowParts(window.startTime, location.current.timeZone);
    if (localMinutes !== undefined && local?.minutes !== localMinutes) {
      issues.push("Requested local activity time is not covered by the selected window.");
    }
    if (weekday && local?.weekday !== weekday) {
      issues.push(`Requested ${weekday} activity day is not covered by the selected window.`);
    }
    if (requestedDayOffset !== undefined) {
      const observed = localCalendarOrdinal(location.current.observedAt, location.current.timeZone);
      const selected = localCalendarOrdinal(window.startTime, location.current.timeZone);
      if (observed === undefined || selected === undefined || selected - observed !== requestedDayOffset) {
        issues.push("Requested relative activity day is not covered by the selected window.");
      }
    }
  }
  return issues;
}

interface WeatherNarrativeField {
  text: string;
  policy: "sanitize-hero" | "validate-weather" | "validate-comparison";
  locationIndex?: number;
}

function weatherNarrativeFields(plan: SurfacePlan): WeatherNarrativeField[] {
  const fields: WeatherNarrativeField[] = [];
  for (const module of plan.modules) {
    if (module.type === "sources") {
      fields.push({
        text: module.label,
        policy: plan.kind === "comparison" ? "validate-comparison" : "validate-weather",
      });
      continue;
    }
    if (plan.kind === "weather") {
      if (module.type === "hero") {
        fields.push(
          {
            text: module.recommendationLabel,
            policy: "sanitize-hero",
            locationIndex: module.locationIndex,
          },
          {
            text: module.recommendationValue,
            policy: "sanitize-hero",
            locationIndex: module.locationIndex,
          },
          {
            text: module.recommendationDetail,
            policy: "sanitize-hero",
            locationIndex: module.locationIndex,
          },
        );
      } else if (module.type === "hourly" || module.type === "daily") {
        fields.push({
          text: module.label,
          policy: "validate-weather",
          locationIndex: module.locationIndex,
        });
      }
      continue;
    }
    if (plan.kind === "comparison") {
      if (module.type === "summary") {
        fields.push(
          { text: module.title, policy: "validate-comparison" },
          { text: module.recommendation, policy: "validate-comparison" },
        );
      } else if (module.type === "table") {
        fields.push({ text: module.caption, policy: "validate-comparison" });
      } else if (module.type === "chart") {
        fields.push({ text: module.title, policy: "validate-comparison" });
      }
    }
  }
  return fields;
}

function scopedWeatherLocations(
  state: WeatherState,
  locationIndex?: number,
): WeatherLocationEvidence[] {
  return locationIndex === undefined
    ? state.locations
    : state.locations[locationIndex]
      ? [state.locations[locationIndex]]
      : [];
}

function evidenceMeasurementNumbers(
  state: WeatherState,
  narrative: string,
  token: string,
  locationIndex?: number,
): number[] {
  const locations = scopedWeatherLocations(state, locationIndex);
  const normalized = narrative.toLocaleLowerCase("en-US");
  const values: number[] = [];
  const temperatureUnit = /(?:°|degrees?)\s*([fc])\b/i.exec(token)?.[1]?.toLocaleUpperCase("en-US");
  if (/(?:°|degrees?)/i.test(token)) {
    for (const location of locations) {
      if (temperatureUnit && location.current.temperatureUnit !== temperatureUnit) continue;
      if (/\bfeels?(?: like)?\b/.test(normalized)) values.push(location.current.feelsLike);
      else if (/\bhigh\b/.test(normalized)) values.push(...location.daily.map((day) => day.high));
      else if (/\blow\b/.test(normalized)) values.push(...location.daily.map((day) => day.low));
      else {
        values.push(
          location.current.temperature,
          location.current.feelsLike,
          ...location.hourly.map((hour) => hour.temperature),
          ...location.daily.flatMap((day) => [day.high, day.low]),
        );
      }
    }
    return values;
  }

  if (/%/.test(token)) {
    for (const location of locations) {
      if (/\bhumid(?:ity)?\b/.test(normalized)) values.push(location.current.humidity);
      else if (/\b(?:precipitation|rain|storm|shower)\b/.test(normalized)) {
        values.push(
          location.current.precipitationProbability,
          ...location.hourly.flatMap((hour) =>
            hour.precipitationProbability === null ? [] : [hour.precipitationProbability]
          ),
          ...location.daily.map((day) => day.precipitationProbability),
        );
      } else {
        values.push(
          location.current.humidity,
          location.current.precipitationProbability,
          ...location.hourly.flatMap((hour) =>
            hour.precipitationProbability === null ? [] : [hour.precipitationProbability]
          ),
          ...location.daily.map((day) => day.precipitationProbability),
        );
      }
    }
    return values;
  }

  if (/mph\b|km\/h\b/i.test(token)) {
    const unit = /mph\b/i.test(token) ? "mph" : "km/h";
    return locations
      .filter((location) => location.current.windSpeedUnit === unit)
      .map((location) => location.current.windSpeed);
  }
  if (/mi\b|km\b/i.test(token)) {
    const unit = /mi\b/i.test(token) ? "mi" : "km";
    return locations
      .filter((location) => location.current.visibilityUnit === unit)
      .map((location) => location.current.visibility);
  }
  return values;
}

function evidenceLocalTimes(state: WeatherState, locationIndex?: number): number[] {
  const values: number[] = [];
  const add = (timestamp: string | undefined, timeZone: string): void => {
    if (!timestamp) return;
    const local = localWindowParts(timestamp, timeZone);
    if (local) values.push(local.minutes);
  };
  const locations = scopedWeatherLocations(state, locationIndex);
  for (const location of locations) {
    add(location.current.observedAt, location.current.timeZone);
    for (const hour of location.hourly) add(hour.startTime, location.current.timeZone);
    for (const alert of location.alerts) {
      add(alert.startsAt, location.current.timeZone);
      add(alert.expiresAt, location.current.timeZone);
    }
  }
  for (const window of state.activityWindows) {
    const location = locations.find((candidate) => locationsMatch(candidate.location, window.location));
    if (!location) continue;
    add(window.startTime, location.current.timeZone);
    add(window.endTime, location.current.timeZone);
  }
  return values;
}

const WEATHER_QUANTITATIVE_TOKEN_SOURCE = String.raw`\b\d{1,2}(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)\b|-?\d+(?:\.\d+)?\s*(?:°\s*[fc]?|degrees?\s*[fc]?|%|mph\b|km\/h\b|mi\b|km\b)|-?\d+(?:\.\d+)?\s*[- ](?:hours?|days?|locations?|cities?)\b|-?\d+(?:\.\d+)?`;

function quantitativeTokens(value: string): string[] {
  return [...value.matchAll(new RegExp(WEATHER_QUANTITATIVE_TOKEN_SOURCE, "gi"))].map(
    (match) => match[0],
  );
}

function normalizedQuantitativeToken(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trustedWeatherNarrativeTokens(state: WeatherState, locationIndex?: number): Set<string> {
  const trustedText: string[] = [];
  const locations = locationIndex === undefined
    ? state.locations
    : state.locations[locationIndex]
      ? [state.locations[locationIndex]]
      : [];
  for (const location of locations) {
    for (const alert of location.alerts) trustedText.push(alert.title, alert.description);
  }
  for (const window of state.activityWindows) {
    if (
      locationIndex !== undefined &&
      !locations.some((location) => locationsMatch(location.location, window.location))
    ) {
      continue;
    }
    trustedText.push(window.label, window.detail);
  }
  return new Set(
    trustedText.flatMap(quantitativeTokens).map(normalizedQuantitativeToken),
  );
}

function weatherNarrativeFieldIssues(
  field: WeatherNarrativeField,
  state: WeatherState,
  counts: ReadonlySet<number>,
): string[] {
  const localTimes = new Set(evidenceLocalTimes(state, field.locationIndex));
  const trustedTokens = trustedWeatherNarrativeTokens(state, field.locationIndex);
  const issues: string[] = [];

  for (const token of quantitativeTokens(field.text)) {
    const number = Number.parseFloat(token);
    if (/\b(?:hours?|days?|locations?|cities?)\b/i.test(token)) {
      if (!counts.has(number)) {
        issues.push(`Weather narrative contains an unsupported range claim: ${token}.`);
      }
      continue;
    }

    if (field.policy === "validate-comparison") {
      if (/(?:°|degrees?|%|mph\b|km\/h\b|mi\b|km\b)/i.test(token)) {
        issues.push(`Weather comparison narrative contains a model-authored measurement: ${token}.`);
      } else if (/^\d{1,2}(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)$/i.test(token.trim())) {
        issues.push(`Weather comparison narrative contains a model-authored time: ${token}.`);
      } else {
        issues.push(`Weather comparison narrative contains an ungrounded numeric claim: ${token}.`);
      }
      continue;
    }

    if (trustedTokens.has(normalizedQuantitativeToken(token))) continue;
    const time = /^(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)$/i.exec(token.trim());
    if (time) {
      let hour = Number(time[1]);
      if (time[3]) {
        hour %= 12;
        if (time[3].toLocaleLowerCase("en-US").startsWith("p")) hour += 12;
      }
      const minutes = hour * 60 + Number(time[2] ?? 0);
      if (!localTimes.has(minutes)) {
        issues.push(`Weather narrative contains an unsupported time claim: ${token}.`);
      }
      continue;
    }

    if (/(?:°|degrees?|%|mph\b|km\/h\b|mi\b|km\b)/i.test(token)) {
      const measurementNumbers = evidenceMeasurementNumbers(
        state,
        field.text,
        token,
        field.locationIndex,
      );
      if (!measurementNumbers.some((value) => Math.abs(value - number) < 0.000_001)) {
        issues.push(`Weather narrative contains an unsupported measurement claim: ${token}.`);
      }
      continue;
    }
    issues.push(`Weather narrative contains an ungrounded numeric claim: ${token}.`);
  }
  return issues;
}

function weatherNarrativeIssues(plan: SurfacePlan, state: WeatherState): string[] {
  if (state.locations.length === 0 || (plan.kind !== "weather" && plan.kind !== "comparison")) {
    return [];
  }
  const issues: string[] = [];
  const counts = new Set<number>([state.locations.length]);
  for (const module of plan.modules) {
    if (module.type === "hourly") counts.add(module.hourIndexes.length);
    else if (module.type === "daily") counts.add(module.dayIndexes.length);
    else if (module.type === "recommendation" && "activityWindowIndex" in module) {
      const window = state.activityWindows[module.activityWindowIndex];
      if (window?.durationHours) counts.add(window.durationHours);
    } else if (
      (isWeatherComparisonTable(module) || isWeatherComparisonChart(module)) &&
      module.forecastIndexes
    ) {
      counts.add(module.forecastIndexes.length);
    }
  }

  for (const field of weatherNarrativeFields(plan)) {
    if (field.policy === "sanitize-hero") continue;
    issues.push(...weatherNarrativeFieldIssues(field, state, counts));
  }
  return issues;
}

function safeWeatherHeroNarrative(
  value: string,
  fallback: string,
): string {
  const wordQuantity = /\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)[\s-]+)+(?:degrees?|percent|mph|km\/h|miles?|kilometers?|hours?|days?)\b/i.test(
    value,
  );
  const temporalClaim = /\b(?:current(?:ly)?|now|today|tonight|tomorrow|yesterday|morning|afternoon|evening|overnight|noon|midnight|sunrise|sunset|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
    value,
  );
  return quantitativeTokens(value).length === 0 && !wordQuantity && !temporalClaim
    ? value
    : fallback;
}

function includesInitialRange(indexes: readonly number[], count: number): boolean {
  const values = new Set(indexes);
  for (let index = 0; index < count; index += 1) {
    if (!values.has(index)) return false;
  }
  return true;
}

function authoredChartTableAligned(
  chart: AuthoredComparisonChartModule,
  table: AuthoredComparisonTableModule,
): boolean {
  const rowOriented =
    table.columns.length === chart.labels.length + 1 &&
    chart.labels.every((label, index) => table.columns[index + 1] === label) &&
    table.rows.length === chart.series.length &&
    chart.series.every((series, seriesIndex) => {
      const row = table.rows[seriesIndex];
      return (
        row?.[0] === series.label &&
        series.values.every(
          (value, valueIndex) => parseStrictFormattedNumber(row[valueIndex + 1]) === value,
        )
      );
    });
  if (rowOriented) return true;

  return (
    table.columns.length === chart.series.length + 1 &&
    chart.series.every((series, index) => table.columns[index + 1] === series.label) &&
    table.rows.length === chart.labels.length &&
    chart.labels.every((label, labelIndex) => {
      const row = table.rows[labelIndex];
      return (
        row?.[0] === label &&
        chart.series.every(
          (series, seriesIndex) =>
            parseStrictFormattedNumber(row[seriesIndex + 1]) === series.values[labelIndex],
        )
      );
    })
  );
}

function comparisonChartTableAligned(plan: Extract<SurfacePlan, { kind: "comparison" }>): boolean {
  const charts = plan.modules.filter((module) => module.type === "chart");
  const tables = plan.modules.filter((module) => module.type === "table");
  if (charts.length === 0) return true;
  if (charts.length !== 1 || tables.length !== 1) return false;
  const chart = charts[0];
  const table = tables[0];
  if (isWeatherComparisonChart(chart)) {
    return (
      isWeatherComparisonTable(table) &&
      table.forecastKind === chart.forecastKind &&
      table.metric === chart.metric &&
      JSON.stringify(table.locationIndexes) === JSON.stringify(chart.locationIndexes) &&
      JSON.stringify(table.forecastIndexes) === JSON.stringify(chart.forecastIndexes)
    );
  }
  return !isWeatherComparisonTable(table) && authoredChartTableAligned(chart, table);
}

function estimatedCompiledNodeCount(plan: SurfacePlan): number {
  let count = 1;
  for (const module of plan.modules) {
    if (module.type === "metrics") count += 1 + module.metrics.length;
    else if (module.type === "alerts") count += module.alertIndexes.length + (module.alertIndexes.length > 1 ? 1 : 0);
    else count += 1;
  }
  return count;
}

function alignedForecastIndex(
  anchor: WeatherLocationEvidence,
  location: WeatherLocationEvidence,
  forecastKind: "hourly" | "daily",
  anchorIndex: number,
  prompt?: string,
): number {
  if (forecastKind === "hourly") {
    if (parseWeatherRequestIntent(prompt ?? "").localTime !== undefined) {
      const coverage = requestedLocalHourCoverage(prompt ?? "", [anchor, location]);
      const anchorIndexes = coverage.find((item) => item.locationIndex === 0)?.indexes ?? [];
      const selectionPosition = anchorIndexes.indexOf(anchorIndex);
      if (selectionPosition < 0) return -1;
      return coverage.find((item) => item.locationIndex === 1)?.indexes[selectionPosition] ?? -1;
    }
    const timestamp = anchor.hourly[anchorIndex]?.startTime;
    return timestamp
      ? location.hourly.findIndex((item) => item.startTime === timestamp)
      : -1;
  }
  const normalizedPrompt = prompt?.toLocaleLowerCase("en-US") ?? "";
  const anchorDay = anchor.daily[anchorIndex];
  const anchorOrdinal = anchorDay ? dateOnlyOrdinal(anchorDay.date) : undefined;
  const anchorObserved = localCalendarOrdinal(anchor.current.observedAt, anchor.current.timeZone);
  const locationObserved = localCalendarOrdinal(
    location.current.observedAt,
    location.current.timeZone,
  );
  const usesNamedLocalDayAxis = /\b(?:weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
    normalizedPrompt,
  );
  if (anchorDay && usesNamedLocalDayAxis) {
    const anchorWeekday = weekdayForDate(anchorDay.date);
    const strictlyFuture = /\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)\b/.test(
      normalizedPrompt,
    );
    if (anchorWeekday && locationObserved !== undefined) {
      const localIndex = location.daily.findIndex((day) => {
        const ordinal = dateOnlyOrdinal(day.date);
        return (
          weekdayForDate(day.date) === anchorWeekday &&
          ordinal !== undefined &&
          (strictlyFuture ? ordinal > locationObserved : ordinal >= locationObserved)
        );
      });
      if (localIndex >= 0) return localIndex;
    }
  }
  const usesRelativeLocalDayAxis = /\b(?:today|tomorrow|next\s+(?:(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?days?|this\s+week|next\s+week)\b/.test(
    normalizedPrompt,
  );
  if (
    usesRelativeLocalDayAxis &&
    anchorOrdinal !== undefined &&
    anchorObserved !== undefined &&
    locationObserved !== undefined
  ) {
    const relativeOffset = anchorOrdinal - anchorObserved;
    const localIndex = location.daily.findIndex(
      (day) => dateOnlyOrdinal(day.date) === locationObserved + relativeOffset,
    );
    if (localIndex >= 0) return localIndex;
  }
  const date = anchor.daily[anchorIndex]?.date;
  return date ? location.daily.findIndex((item) => item.date === date) : -1;
}

function dateOnlyOrdinal(value: string): number | undefined {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parsed) return undefined;
  return Math.floor(
    Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])) / 86_400_000,
  );
}

function weekdayForDate(value: string): number | undefined {
  const ordinal = dateOnlyOrdinal(value);
  if (ordinal === undefined) return undefined;
  return new Date(ordinal * 86_400_000).getUTCDay();
}

function validateWeatherForecastReferences(
  module: WeatherComparisonTableModule | WeatherComparisonChartModule,
  state: WeatherState,
  issues: string[],
  prompt?: string,
): void {
  if (module.forecastKind === "current") return;
  const indexes = module.forecastIndexes ?? [];
  const allowedMetrics = module.forecastKind === "hourly"
    ? new Set(["temperature", "precipitation"])
    : new Set(["high", "low", "precipitation"]);
  if (!module.metric || !allowedMetrics.has(module.metric)) {
    issues.push(`${module.forecastKind} weather comparisons cannot reference metric ${module.metric ?? "none"}.`);
  }
  const anchor = state.locations[module.locationIndexes[0]];
  if (!anchor) return;
  for (const locationIndex of module.locationIndexes) {
    const location = state.locations[locationIndex];
    if (!location) continue;
    for (const index of indexes) {
      const alignedIndex = alignedForecastIndex(
        anchor,
        location,
        module.forecastKind,
        index,
        prompt,
      );
      const forecast = alignedIndex < 0
        ? undefined
        : module.forecastKind === "hourly"
          ? location.hourly[alignedIndex]
          : location.daily[alignedIndex];
      if (!forecast) {
        issues.push(
          `${module.forecastKind} comparison evidence index ${index} has no semantically aligned record for location ${locationIndex}.`,
        );
      } else if (
        module.metric === "precipitation" &&
        module.forecastKind === "hourly" &&
        forecast.precipitationProbability === null
      ) {
        issues.push(`Hourly comparison evidence index ${index} lacks a precipitation measurement.`);
      }
    }
  }
}

type WeatherWinnerObjective = Readonly<{
  metric: "precipitation" | "temperature" | "wind";
  direction: "lower" | "higher";
}>;

function requestedWeatherWinnerObjective(prompt: string | undefined): WeatherWinnerObjective | undefined {
  if (!prompt) return undefined;
  const normalized = prompt.toLocaleLowerCase("en-US");
  const objectives: WeatherWinnerObjective[] = [];
  if (
    /\b(?:drier|driest|less rain|lower precipitation|lowest precipitation|picnic|brunch|outdoor)\b/.test(
      normalized,
    )
  ) {
    objectives.push({ metric: "precipitation", direction: "lower" });
  }
  if (/\b(?:wetter|wettest|more rain|higher precipitation|highest precipitation)\b/.test(normalized)) {
    objectives.push({ metric: "precipitation", direction: "higher" });
  }
  if (/\b(?:warmer|warmest|hotter|hottest|higher temperature)\b/.test(normalized)) {
    objectives.push({ metric: "temperature", direction: "higher" });
  }
  if (/\b(?:cooler|coolest|colder|coldest|lower temperature)\b/.test(normalized)) {
    objectives.push({ metric: "temperature", direction: "lower" });
  }
  if (/\b(?:calmer|least windy|less wind|lower wind)\b/.test(normalized)) {
    objectives.push({ metric: "wind", direction: "lower" });
  }
  if (/\b(?:windier|windiest|more wind|higher wind)\b/.test(normalized)) {
    objectives.push({ metric: "wind", direction: "higher" });
  }
  const unique = objectives.filter(
    (objective, index) =>
      objectives.findIndex(
        (candidate) =>
          candidate.metric === objective.metric && candidate.direction === objective.direction,
      ) === index,
  );
  return unique.length === 1 ? unique[0] : undefined;
}

function deterministicWeatherRecommendedLocation(
  prompt: string | undefined,
  state: WeatherState,
  locationIndexes: readonly number[],
): number | undefined {
  const objective = requestedWeatherWinnerObjective(prompt);
  const anchor = state.locations[locationIndexes[0]];
  if (!objective || !anchor) return undefined;

  const localHourCoverage = prompt
    ? requestedLocalHourCoverage(prompt, state.locations)
    : [];
  if (localHourCoverage.length > 0 && objective.metric !== "wind") {
    const hourlyValues = locationIndexes.flatMap((locationIndex) => {
      const location = state.locations[locationIndex];
      const hourIndex = localHourCoverage.find(
        (coverage) => coverage.locationIndex === locationIndex,
      )?.indexes[0];
      const hour = hourIndex === undefined ? undefined : location?.hourly[hourIndex];
      if (!hour) return [];
      const value = objective.metric === "precipitation"
        ? hour.precipitationProbability
        : hour.temperature;
      return value === null ? [] : [{ locationIndex, value }];
    });
    if (hourlyValues.length !== locationIndexes.length) return undefined;
    const ordered = [...hourlyValues].sort((left, right) =>
      objective.direction === "lower"
        ? left.value - right.value || left.locationIndex - right.locationIndex
        : right.value - left.value || left.locationIndex - right.locationIndex
    );
    if (!ordered[0] || !ordered[1] || ordered[0].value === ordered[1].value) return undefined;
    return ordered[0].locationIndex;
  }

  const explicitIndexes = requestedSpecificDayIndexes(prompt, state).filter(
    (index) => index >= 0 && index < anchor.daily.length,
  );
  const requestedCount = requestedDayCount(prompt, state);
  const anchorIndexes = explicitIndexes.length > 0
    ? explicitIndexes
    : requestedCount
      ? anchor.daily.slice(0, requestedCount).map((_, index) => index)
      : [];
  const values = locationIndexes.flatMap((locationIndex) => {
    const location = state.locations[locationIndex];
    if (!location) return [];
    if (objective.metric === "wind") {
      return [{ locationIndex, value: location.current.windSpeed }];
    }
    if (anchorIndexes.length === 0) {
      return [{
        locationIndex,
        value: objective.metric === "precipitation"
          ? location.current.precipitationProbability
          : location.current.temperature,
      }];
    }
    const dailyValues = anchorIndexes.flatMap((anchorIndex) => {
      const alignedIndex = alignedForecastIndex(anchor, location, "daily", anchorIndex, prompt);
      const day = alignedIndex >= 0 ? location.daily[alignedIndex] : undefined;
      if (!day) return [];
      return [objective.metric === "precipitation" ? day.precipitationProbability : day.high];
    });
    if (dailyValues.length !== anchorIndexes.length) return [];
    return [{
      locationIndex,
      value: dailyValues.reduce((sum, value) => sum + value, 0) / dailyValues.length,
    }];
  });
  if (values.length !== locationIndexes.length) return undefined;
  const ordered = [...values].sort((left, right) =>
    objective.direction === "lower"
      ? left.value - right.value || left.locationIndex - right.locationIndex
      : right.value - left.value || left.locationIndex - right.locationIndex
  );
  if (!ordered[0] || !ordered[1] || ordered[0].value === ordered[1].value) return undefined;
  return ordered[0].locationIndex;
}

function validateRequestedForecastRange(
  plan: SurfacePlan,
  forecastKind: "hourly" | "daily",
  count: number,
  state: WeatherState,
  issues: string[],
): void {
  if (count < 1) return;
  if (count > (forecastKind === "hourly" ? 24 : 10)) {
    issues.push(`Requested ${count}-${forecastKind === "hourly" ? "hour" : "day"} range exceeds the supported evidence window.`);
    return;
  }
  const indexesByLocation = new Map<number, number[]>();
  const add = (locationIndexes: readonly number[], indexes: readonly number[]): void => {
    for (const locationIndex of locationIndexes) {
      const current = indexesByLocation.get(locationIndex) ?? [];
      current.push(...indexes);
      indexesByLocation.set(locationIndex, current);
    }
  };

  if (plan.kind === "weather") {
    for (const module of plan.modules) {
      if (forecastKind === "hourly" && module.type === "hourly") {
        add([module.locationIndex], module.hourIndexes);
      }
      if (forecastKind === "daily" && module.type === "daily") {
        add([module.locationIndex], module.dayIndexes);
      }
    }
  } else if (plan.kind === "comparison") {
    for (const module of plan.modules) {
      if (
        (isWeatherComparisonTable(module) || isWeatherComparisonChart(module)) &&
        module.forecastKind === forecastKind
      ) {
        add(module.locationIndexes, module.forecastIndexes ?? []);
      }
    }
  }

  for (let locationIndex = 0; locationIndex < state.locations.length; locationIndex += 1) {
    const indexes = indexesByLocation.get(locationIndex) ?? [];
    if (!includesInitialRange(indexes, count)) {
      issues.push(
        `Requested ${count}-${forecastKind === "hourly" ? "hour" : "day"} range is not fully covered for location index ${locationIndex}.`,
      );
    }
  }
}

function validateRequestedLocalHourCoverage(
  plan: SurfacePlan,
  prompt: string | undefined,
  state: WeatherState,
  issues: string[],
): void {
  if (!prompt) return;
  const intent = parseWeatherRequestIntent(prompt);
  if (intent.localTime === undefined || intent.activity !== undefined) return;
  const expectedCoverage = requestedLocalHourCoverage(prompt, state.locations);
  const expectedByLocation = new Map(
    expectedCoverage.map((coverage) => [coverage.locationIndex, coverage.indexes] as const),
  );
  const coveredByLocation = new Map<number, Set<number>>();
  const add = (locationIndex: number, index: number): void => {
    const covered = coveredByLocation.get(locationIndex) ?? new Set<number>();
    covered.add(index);
    coveredByLocation.set(locationIndex, covered);
  };

  if (plan.kind === "weather") {
    for (const module of plan.modules) {
      if (module.type !== "hourly") continue;
      for (const index of module.hourIndexes) add(module.locationIndex, index);
    }
  } else if (plan.kind === "comparison") {
    for (const module of plan.modules) {
      if (
        (!isWeatherComparisonTable(module) && !isWeatherComparisonChart(module)) ||
        module.forecastKind !== "hourly"
      ) {
        continue;
      }
      const anchorIndex = module.locationIndexes[0];
      const anchor = state.locations[anchorIndex];
      if (!anchor) continue;
      for (const locationIndex of module.locationIndexes) {
        const location = state.locations[locationIndex];
        if (!location) continue;
        for (const forecastIndex of module.forecastIndexes ?? []) {
          const alignedIndex = alignedForecastIndex(
            anchor,
            location,
            "hourly",
            forecastIndex,
            prompt,
          );
          if (alignedIndex >= 0) add(locationIndex, alignedIndex);
        }
      }
    }
  }

  for (let locationIndex = 0; locationIndex < state.locations.length; locationIndex += 1) {
    const expected = expectedByLocation.get(locationIndex) ?? [];
    if (expected.length === 0) {
      issues.push(`Requested local forecast time is unavailable for location index ${locationIndex}.`);
      continue;
    }
    const covered = coveredByLocation.get(locationIndex) ?? new Set<number>();
    if (!expected.every((index) => covered.has(index))) {
      issues.push(`Requested local forecast time is not covered for location index ${locationIndex}.`);
    }
  }
}

function validateRequestedSpecificDays(
  plan: SurfacePlan,
  requestedIndexes: readonly number[],
  state: WeatherState,
  issues: string[],
): void {
  if (requestedIndexes.length === 0) return;
  const indexesByLocation = new Map<number, Set<number>>();
  const add = (locationIndexes: readonly number[], indexes: readonly number[]): void => {
    for (const locationIndex of locationIndexes) {
      const current = indexesByLocation.get(locationIndex) ?? new Set<number>();
      for (const index of indexes) current.add(index);
      indexesByLocation.set(locationIndex, current);
    }
  };
  if (plan.kind === "weather") {
    for (const module of plan.modules) {
      if (module.type === "daily") add([module.locationIndex], module.dayIndexes);
    }
  } else if (plan.kind === "comparison") {
    for (const module of plan.modules) {
      if (
        (isWeatherComparisonTable(module) || isWeatherComparisonChart(module)) &&
        module.forecastKind === "daily"
      ) {
        add(module.locationIndexes, module.forecastIndexes ?? []);
      }
    }
  }
  for (let locationIndex = 0; locationIndex < state.locations.length; locationIndex += 1) {
    const covered = indexesByLocation.get(locationIndex) ?? new Set<number>();
    for (const index of requestedIndexes) {
      if (!covered.has(index)) {
        issues.push(`Requested named day index ${index} is not covered for location index ${locationIndex}.`);
      }
    }
  }
}

function normalizeLocationLabel(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedPromptLocations(prompt: string | undefined): string[] {
  if (!prompt) return [];
  const candidates: string[] = [];
  const addList = (value: string | undefined): void => {
    if (!value) return;
    candidates.push(...value.split(/,\s*(?![A-Z]{2}\b)|\band\b|\bversus\b|\bvs\.?\b/i));
  };
  const score = /\b(?:score|rank)\s+(.+?)\s+(?:for|on|by|across|using)\b/i.exec(prompt)?.[1];
  addList(score);
  const chart = /\bchart\b.+?\bfor\s+(.+?)(?:\s+(?:on|this|next|over)\b|[?.]|$)/i.exec(prompt)?.[1];
  addList(chart);

  const directWeatherLocationCandidate = /\b(?:weather|forecasts?|conditions?|temperatures?)\s+(?:like\s+)?(?:for|in|at)\s+(.+?)(?=\s+(?:right\s+now|today|tomorrow|this\s+week|next\s+week|at\s+\d|in\s+(?:celsius|fahrenheit|metric|imperial|°)|with\b|and\s+(?:call|show|include))|[?.]|$)/i.exec(
    prompt,
  )?.[1];
  const directWeatherLocation = directWeatherLocationCandidate &&
      !/^(?:(?:the\s+)?next|this|today|tomorrow|current|active|severe|any|celsius|fahrenheit|metric|imperial|\d|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(
        directWeatherLocationCandidate.trim(),
      ) &&
      !/\b(?:hours?|days?|alerts?|warnings?|advisories)\b/i.test(directWeatherLocationCandidate)
    ? directWeatherLocationCandidate
    : undefined;
  addList(directWeatherLocation);
  const possessiveWeatherLocation = /^(?:show|display|check|give me)\s+([A-Z][A-Za-z .'-]{1,79}?)(?:'s)?\s+(?:(?:\w+|\d+)\s*[- ]day\s+)?(?:current\s+)?(?:weather|forecast|conditions?|outlook)\b/i.exec(
    prompt.trim(),
  )?.[1] ?? /\b([A-Z][A-Za-z .'-]{1,79}?)'s\s+(?:(?:\w+|\d+)\s*[- ]day\s+)?(?:weather|forecast|conditions?|outlook)\b/.exec(
    prompt,
  )?.[1];
  if (!directWeatherLocation) {
    addList(possessiveWeatherLocation?.replace(/^(?:show|display|check|give me)\s+/i, ""));
  }

  const weatherFor = /(?:\bcompare\s+(?:the\s+)?(?:weather|forecasts?|conditions?|temperatures?)|^(?:the\s+)?(?:weather|forecasts?|conditions?|temperatures?))\s+(?:for|in|between)\s+(.+?)(?=[?.]|$)/i.exec(
    prompt,
  )?.[1];
  if (weatherFor) {
    addList(weatherFor.replace(/\s+(?:for|on|during)\s+.+$/i, ""));
  } else {
    const compareList = /\bcompare\s+(.+?)(?=\s+(?:for|on|during|from|this|next|over|across|weather|conditions?|forecasts?|temperatures?|highs?|lows?)\b|[?.:]|$)/i.exec(
      prompt,
    )?.[1];
    if (compareList) {
      addList(compareList);
    } else {
      const binary = /^\s*([A-Za-z][A-Za-z .'-]{1,79}?)\s+(?:versus|vs\.?)\s+([A-Za-z][A-Za-z .'-]{1,79}?)(?=\s+(?:for|on|during|from|this|next|over|across|weather|conditions?|forecasts?|temperatures?)\b|[?.:]|$)/i.exec(
        prompt,
      );
      if (binary) candidates.push(binary[1], binary[2]);
    }
  }

  const locations = candidates.map((part) =>
    part
      .replace(/^\s*(?:compare\s+)?(?:the|a|an)\s+/i, "")
      .replace(/^\s*(?:show|display|check|give me)\s+/i, "")
      .replace(/^\s*(?:weather|temperatures?|conditions?|forecasts?)\s+(?:for|in|between)\s+/i, "")
      .replace(/\s+(?:for|on|during|this|next|over|across)\s+.+$/i, "")
      .replace(
        /\s+(?:weather|temperatures?|conditions?|forecasts?|highs?|lows?|rain(?:fall)?|snow(?:fall)?)(?:\s+.*)?$/i,
        "",
      )
      .trim(),
  );
  return [
    ...new Set(
      locations.filter(
        (value) =>
          /^[A-Za-z][A-Za-z .'-]{1,79}$/.test(value) &&
          !/^(?:weather|forecast|conditions?|temperatures?|brunch|dinner|outdoors?)$/i.test(value),
      ),
    ),
  ];
}

function evidenceLocationIndex(state: WeatherState, requested: string): number {
  const normalizedRequested = normalizeLocationLabel(sanitizePlanText(requested)).replace(/\s+city$/, "");
  return state.locations.findIndex((location) => {
    const normalizedEvidence = normalizeLocationLabel(
      sanitizePlanText(location.location.name),
    ).replace(/\s+city$/, "");
    return (
      normalizedEvidence === normalizedRequested ||
      normalizedEvidence.startsWith(`${normalizedRequested} `) ||
      normalizedRequested.startsWith(`${normalizedEvidence} `)
    );
  });
}

function requestedLocationCoverageIssues(
  plan: SurfacePlan,
  context: SurfacePlanValidationContext,
  state: WeatherState,
): string[] {
  if (state.locations.length === 0) return [];
  const promptRequested = new Set<string>(requestedPromptLocations(context.prompt));
  const argumentRequested = new Set<string>();
  const argumentAliases = new Map<string, number>();
  let resultOffset = 0;
  for (const record of context.evidence) {
    const parsedResult = weatherResultSchema.safeParse(record.result);
    const resultCount = parsedResult.success ? parsedResult.data.locations.length : 0;
    const argumentLocations = record.arguments.locations?.length
      ? record.arguments.locations
      : record.arguments.location
        ? [record.arguments.location]
        : [];
    for (const [argumentIndex, location] of argumentLocations.entries()) {
      argumentRequested.add(location);
      if (argumentLocations.length === resultCount) {
        argumentAliases.set(normalizeLocationLabel(location), resultOffset + argumentIndex);
      } else if (argumentLocations.length === 1 && resultCount === 1) {
        argumentAliases.set(normalizeLocationLabel(location), resultOffset);
      }
    }
    resultOffset += resultCount;
  }
  const coveredIndexes = new Set(referencedLocationIndexes(plan));
  const issues: string[] = [];
  const validateLabel = (label: string, allowArgumentAlias: boolean): void => {
    const directIndex = evidenceLocationIndex(state, label);
    const index = directIndex >= 0
      ? directIndex
      : allowArgumentAlias
        ? argumentAliases.get(normalizeLocationLabel(label)) ?? -1
        : -1;
    if (index < 0) {
      issues.push(`Requested weather location is missing from evidence: ${label}.`);
    } else if (!coveredIndexes.has(index)) {
      issues.push(`Requested weather location is missing from the surface: ${label}.`);
    }
  };
  const normalizedArgumentLabels = new Set(
    [...argumentRequested].map((label) => normalizeLocationLabel(label)),
  );
  for (const label of promptRequested) {
    validateLabel(label, normalizedArgumentLabels.has(normalizeLocationLabel(label)));
  }
  for (const label of argumentRequested) {
    if (!promptRequested.has(label)) validateLabel(label, true);
  }
  return issues;
}

function requestsTwoSidedResearchEvidence(prompt: string): boolean {
  const normalized = prompt.toLocaleLowerCase("en-US");
  const requestsSupport =
    /\b(?:support(?:s|ed|ing)?|evidence\s+(?:for|supporting)|in\s+favor\s+of)\b/.test(normalized);
  const requestsChallenge =
    /\b(?:challeng(?:e|es|ed|ing)|evidence\s+against|against\s+(?:(?:the|this|that)\s+)?claim|counter[- ]?evidence|contradict(?:s|ed|ing)?)\b/.test(
      normalized,
    );
  return requestsSupport && requestsChallenge;
}

function requestedCoverageIssues(
  plan: SurfacePlan,
  context: SurfacePlanValidationContext,
  state: WeatherState,
): string[] {
  const issues: string[] = [];
  const requestedLocations = new Set(state.locations.map((_, index) => index));
  const coveredLocations = new Set(referencedLocationIndexes(plan));
  for (const index of requestedLocations) {
    if (!coveredLocations.has(index)) issues.push(`Requested weather location index ${index} is not covered.`);
  }
  issues.push(...requestedLocationCoverageIssues(plan, context, state));

  const expectedUnit = requestedTemperatureUnit(context.prompt, context.clientContext);
  for (const index of coveredLocations) {
    const location = state.locations[index];
    if (location && expectedUnit && location.current.temperatureUnit !== expectedUnit) {
      issues.push(`Requested unit ${expectedUnit} is not covered for location index ${index}.`);
    }
  }

  const requestedHours = requestedRange(context.prompt, "hour");
  const requestedDays = requestedDayCount(context.prompt, state);
  const requestedNamedDays = requestedSpecificDayIndexes(context.prompt, state);
  const hasRequestedLocalTime = parseWeatherRequestIntent(context.prompt ?? "").localTime !== undefined;
  if (requestedHours) validateRequestedForecastRange(plan, "hourly", requestedHours, state, issues);
  if (requestedDays && !hasRequestedLocalTime) {
    validateRequestedForecastRange(plan, "daily", requestedDays, state, issues);
  }
  if (!hasRequestedLocalTime) validateRequestedSpecificDays(plan, requestedNamedDays, state, issues);
  validateRequestedLocalHourCoverage(plan, context.prompt, state, issues);
  issues.push(...activityRecommendationCoverageIssues(plan, context, state));

  if (plan.kind === "weather" && context.prompt) {
    const requestedSignal = /\b(wettest|driest|warmest|coolest)\b/i.exec(context.prompt)?.[1]
      ?.toLocaleLowerCase("en-US");
    if (
      requestedSignal &&
      !plan.modules.some(
        (module) =>
          module.type === "recommendation" &&
          "signal" in module &&
          module.signal === requestedSignal,
      )
    ) {
      issues.push(`Requested ${requestedSignal}-day recommendation is not covered.`);
    }

    const asksForAlerts = /\b(?:alerts?|warnings?|advisories)\b/i.test(context.prompt);
    const hasRenderableAlert = state.locations.some((location) =>
      location.alerts.some((alert) => alert.severity !== "unknown")
    );
    if (
      asksForAlerts &&
      hasRenderableAlert &&
      !plan.modules.some((module) => module.type === "alerts")
    ) {
      issues.push("Requested weather alerts are not covered.");
    }
  }

  if (plan.kind === "comparison" && context.prompt) {
    const structuredComparisonContent: unknown[] = [];
    for (const module of plan.modules) {
      if (module.type === "sources") continue;
      if (module.type === "summary") {
        structuredComparisonContent.push(
          "items" in module ? module.items : module.locationIndexes,
        );
      } else if (module.type === "table") {
        structuredComparisonContent.push(
          "columns" in module
            ? [module.columns, module.rows]
            : [module.metrics, module.metric, module.forecastKind],
        );
      } else {
        structuredComparisonContent.push(
          "labels" in module
            ? [module.labels, module.series.map((series) => series.label), module.unit]
            : [module.metric, module.forecastKind],
        );
      }
    }
    const searchablePlan = JSON.stringify(structuredComparisonContent).toLocaleLowerCase("en-US");
    for (const criterion of extractRequestedCriteria(context.prompt)) {
      const normalizedCriterion = criterion === "rain" ? "precipitation" : criterion;
      if (!searchablePlan.includes(normalizedCriterion)) {
        issues.push(`Requested comparison criterion is not covered: ${criterion}.`);
      }
    }
  }

  if (plan.kind === "research" && context.prompt) {
    const needsEvidence = /\b(evidence|sources?|support|challenge|claims?)\b/i.test(context.prompt);
    if (
      needsEvidence &&
      !plan.modules.some((module) => module.type === "evidence" || module.type === "timeline")
    ) {
      issues.push("Requested research evidence is not covered.");
    }
    const requestedItems = /\b(\d{1,2})\s+(?:pieces? of )?(?:evidence|sources?|claims?)\b/i.exec(
      context.prompt,
    );
    if (requestedItems) {
      const required = Math.min(Number(requestedItems[1]), LIMITS.sources);
      const citedItems = plan.modules.reduce((count, module) => {
        return module.type === "evidence" || module.type === "timeline" ? count + module.items.length : count;
      }, 0);
      if (citedItems < required) issues.push(`Requested ${required} evidence items are not covered.`);
    }
    if (requestsTwoSidedResearchEvidence(context.prompt)) {
      const stances = new Set(
        plan.modules.flatMap((module) =>
          module.type === "evidence" ? module.items.map((item) => item.stance) : []
        ),
      );
      if (!stances.has("support")) {
        issues.push("Requested two-sided research claim is missing supporting evidence.");
      }
      if (!stances.has("challenge")) {
        issues.push("Requested two-sided research claim is missing challenging evidence.");
      }
    }
  }

  return issues;
}

export type EvaluatedSurfacePlanQualityCode =
  | "recipe_fit"
  | "answer_first"
  | "sources_last"
  | "requested_coverage"
  | "duplicate_primary"
  | "chart_table_alignment"
  | "citation_coverage"
  | "content_budget";

export function evaluateSurfacePlanQuality(
  plan: SurfacePlan,
  context: SurfacePlanValidationContext,
  spec: SurfaceSpec,
): Readonly<Record<EvaluatedSurfacePlanQualityCode, boolean>> {
  const moduleTypes = plan.modules.map((module) => module.type);
  const primary = plan.kind === "weather" ? "hero" : plan.kind === "comparison" ? "summary" : "lead";
  const sourceIndexes = moduleTypes.flatMap((type, index) => (type === "sources" ? [index] : []));
  const definingModule = definingModuleForPlan(plan, context.prompt);
  const requiredModuleIndex = moduleTypes.indexOf(definingModule);
  const canonicalRequiredModuleIndex = definingModule === primary ? 0 : 1;
  const expectedRecipe = expectedRecipeForPrompt(
    context.prompt,
    plan.kind,
    context.evidence.length > 0,
  );
  const state = readWeatherState(context.evidence);
  const contentIds = contentSourceIds(plan, context, state);
  const sourceModule = plan.modules.find(isSourceModule);
  const issuedIds = new Set(context.sources.map((source) => source.id));
  const sourceIds = new Set(sourceModule?.sourceIds ?? []);
  const citationCoverage =
    sourceIndexes.length === 1 &&
    Boolean(sourceModule) &&
    uniqueStrings(sourceModule?.sourceIds ?? []) &&
    [...contentIds].every((id) => issuedIds.has(id) && sourceIds.has(id)) &&
    [...sourceIds].every((id) => issuedIds.has(id));
  const contentBudget = evaluateSurfaceContentBudget(
    spec,
    SURFACE_CONTENT_BUDGETS[plan.density],
  ).passed;

  return Object.freeze({
    recipe_fit:
      moduleTypes.includes(definingModule) &&
      requiredModuleIndex === canonicalRequiredModuleIndex &&
      modulesFollowCanonicalOrder(plan, context.prompt) &&
      (expectedRecipe === undefined || plan.recipeId === expectedRecipe),
    answer_first: moduleTypes[0] === primary,
    sources_last: sourceIndexes.length === 1 && sourceIndexes[0] === moduleTypes.length - 1,
    requested_coverage: requestedCoverageIssues(plan, context, state).length === 0,
    duplicate_primary: moduleTypes.filter((type) => type === primary).length === 1,
    chart_table_alignment:
      plan.kind !== "comparison" || comparisonChartTableAligned(plan),
    citation_coverage: citationCoverage,
    content_budget: contentBudget,
  });
}

export function validateSurfacePlan(
  input: unknown,
  context: SurfacePlanValidationContext,
  options: SurfacePlanValidationOptions = {},
): SurfacePlanValidationResult {
  const result = SurfacePlanSchema.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues
        .slice(0, 12)
        .map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`),
    };
  }

  const plan = result.data;
  const issues: string[] = [];
  const enforceRecipe = (options.mode ?? "recipe-v2") === "recipe-v2";
  const moduleTypes = plan.modules.map((module) => module.type);
  const primaryType = plan.kind === "weather" ? "hero" : plan.kind === "comparison" ? "summary" : "lead";
  if (enforceRecipe) {
    const recipe = SURFACE_RECIPES[plan.recipeId];
    const definingModule = definingModuleForPlan(plan, context.prompt);
    const compatibleModules = new Set<string>(recipe.compatibleModules);
    for (const moduleType of moduleTypes) {
      if (!compatibleModules.has(moduleType)) {
        issues.push(`Module ${moduleType} is incompatible with recipe ${plan.recipeId}.`);
      }
    }
    if (!moduleTypes.includes(definingModule)) {
      issues.push(`Recipe ${plan.recipeId} requires a ${definingModule} module.`);
    }

    if (moduleTypes[0] !== primaryType) {
      issues.push(`Recipe ${plan.recipeId} must place its answer-first ${primaryType} module first.`);
    }
    const primaryModule = plan.modules[0];
    if (plan.kind === "weather" && primaryModule?.type === "hero") {
      const expectedVariant = plan.recipeId === "weather.decision" ? "decision" : "snapshot";
      if (primaryModule.variant !== expectedVariant) {
        issues.push(`Recipe ${plan.recipeId} requires the ${expectedVariant} weather hero variant.`);
      }
    }
    if (plan.kind === "comparison" && primaryModule?.type === "summary") {
      const expectedVariant = plan.recipeId === "comparison.verdict" ? "verdict" : "balanced";
      if (primaryModule.variant !== expectedVariant) {
        issues.push(`Recipe ${plan.recipeId} requires the ${expectedVariant} comparison summary variant.`);
      }
    }
    const requiredModuleIndex = moduleTypes.indexOf(definingModule);
    const canonicalRequiredModuleIndex = definingModule === primaryType ? 0 : 1;
    if (requiredModuleIndex >= 0 && requiredModuleIndex !== canonicalRequiredModuleIndex) {
      issues.push(
        `Recipe ${plan.recipeId} must place its defining ${definingModule} module ${
          canonicalRequiredModuleIndex === 0 ? "first" : "immediately after the primary module"
        }.`,
      );
    }
    if (!modulesFollowCanonicalOrder(plan, context.prompt)) {
      issues.push(`Recipe ${plan.recipeId} modules do not follow the canonical semantic order.`);
    }

    const expectedRecipe = expectedRecipeForPrompt(
      context.prompt,
      plan.kind,
      context.evidence.length > 0,
    );
    if (expectedRecipe && plan.recipeId !== expectedRecipe) {
      issues.push(`Recipe ${plan.recipeId} does not fit the requested ${expectedRecipe} intent.`);
    }
  }

  if (!moduleTypes.includes(primaryType)) {
    issues.push(`Surface content requires one primary ${primaryType} module.`);
  }
  if (moduleTypes.filter((type) => type === primaryType).length > 1) {
    issues.push(`Surface content cannot contain competing ${primaryType} modules.`);
  }

  if (estimatedCompiledNodeCount(plan) > LIMITS.surfaceNodes) {
    issues.push(`Compiled surface would exceed the ${LIMITS.surfaceNodes}-node budget.`);
  }

  const state = readWeatherState(context.evidence);
  issues.push(...state.issues);
  const issuedSourceIds = new Set(context.sources.map((source) => source.id));
  const allReferencedSourceIds = contentSourceIds(plan, context, state);
  const sourceModules = plan.modules.filter(isSourceModule);
  if (sourceModules.length !== 1) {
    issues.push("Every SurfacePlan requires exactly one final sources module.");
  }
  const sourceModule = sourceModules[0];
  if (sourceModule && plan.modules.at(-1) !== sourceModule) {
    issues.push("The sources module must be the final module.");
  }
  if (sourceModule && !uniqueStrings(sourceModule.sourceIds)) {
    issues.push("Final source references must be unique.");
  }
  for (const sourceId of [...allReferencedSourceIds, ...(sourceModule?.sourceIds ?? [])]) {
    if (!issuedSourceIds.has(sourceId)) issues.push(`Unknown source reference: ${sourceId}.`);
  }
  if (sourceModule) {
    const finalSourceIds = new Set(sourceModule.sourceIds);
    for (const sourceId of allReferencedSourceIds) {
      if (!finalSourceIds.has(sourceId)) {
        issues.push(`Final sources do not cover cited source ${sourceId}.`);
      }
    }
  }

  const weatherBacked = state.locations.length > 0;
  const expectedUnit = requestedTemperatureUnit(context.prompt, context.clientContext);

  const validateLocationIndexes = (indexes: readonly number[], label: string): void => {
    if (!uniqueValues(indexes)) issues.push(`${label} location references must be unique.`);
    for (const index of indexes) {
      const location = state.locations[index];
      if (!location) issues.push(`${label} location index ${index} is out of range.`);
      else if (expectedUnit && location.current.temperatureUnit !== expectedUnit) {
        issues.push(`${label} location index ${index} does not use the requested ${expectedUnit} unit.`);
      }
    }
  };

  if (plan.kind === "weather") {
    if (!weatherBacked) issues.push("Weather plan has no normalized evidence to reference.");

    for (const module of plan.modules) {
      if (module.type === "sources") continue;
      const location = state.locations[module.locationIndex];
      if (!location) {
        issues.push(`Weather evidence location index ${module.locationIndex} is out of range.`);
        continue;
      }
      if (expectedUnit && location.current.temperatureUnit !== expectedUnit) {
        issues.push(`Weather location index ${module.locationIndex} does not use the requested ${expectedUnit} unit.`);
      }

      if (module.type === "hourly") {
        if (!uniqueValues(module.hourIndexes)) issues.push("Hourly evidence references must be unique.");
        for (const index of module.hourIndexes) {
          const hour = location.hourly[index];
          if (!hour) issues.push(`Hourly evidence index ${index} is out of range.`);
          else if (hour.precipitationProbability === null) {
            issues.push(`Hourly evidence index ${index} lacks a precipitation measurement.`);
          }
        }
      }

      if (module.type === "daily") {
        if (!uniqueValues(module.dayIndexes)) issues.push("Daily evidence references must be unique.");
        for (const index of module.dayIndexes) {
          if (!location.daily[index]) issues.push(`Daily evidence index ${index} is out of range.`);
        }
      }

      if (module.type === "alerts") {
        if (!uniqueValues(module.alertIndexes)) issues.push("Alert evidence references must be unique.");
        for (const index of module.alertIndexes) {
          const alert = location.alerts[index];
          if (!alert) issues.push(`Alert evidence index ${index} is out of range.`);
          else if (alert.severity === "unknown") {
            issues.push(`Alert evidence index ${index} has an unrenderable severity.`);
          }
        }
      }

      if (module.type === "recommendation") {
        if ("activityWindowIndex" in module) {
          const window = state.activityWindows[module.activityWindowIndex];
          if (!window) {
            issues.push(`Activity-window evidence index ${module.activityWindowIndex} is out of range.`);
          } else if (!locationsMatch(location.location, window.location)) {
            issues.push("Activity-window evidence does not match the referenced location.");
          }
        } else {
          const day = location.daily[module.dayIndex];
          if (!day) {
            issues.push(`Daily recommendation evidence index ${module.dayIndex} is out of range.`);
          } else {
            const candidateIndexes = requestedDailyCandidateIndexes(
              context.prompt,
              state,
              module.locationIndex,
            );
            const values = candidateIndexes.map((index) => {
              const candidate = location.daily[index];
              if (module.signal === "wettest" || module.signal === "driest") {
                return candidate.precipitationProbability;
              }
              return module.signal === "warmest" ? candidate.high : candidate.low;
            });
            const target = module.signal === "driest" || module.signal === "coolest"
              ? Math.min(...values)
              : Math.max(...values);
            const selectedCandidateIndex = candidateIndexes.indexOf(module.dayIndex);
            const selected = selectedCandidateIndex >= 0
              ? values[selectedCandidateIndex]
              : undefined;
            if (selected === undefined || selected !== target) {
              issues.push(`Daily recommendation index ${module.dayIndex} is not the deterministic ${module.signal} day.`);
            }
          }
        }
      }

      if (module.type === "metrics" && !uniqueStrings(module.metrics)) {
        issues.push("Weather metric references must be unique.");
      }
    }
  }

  if (plan.kind === "comparison") {
    for (const module of plan.modules) {
      if (module.type === "sources") continue;
      const evidenceReferenced =
        isWeatherComparisonSummary(module) ||
        isWeatherComparisonTable(module) ||
        isWeatherComparisonChart(module);
      if (weatherBacked !== evidenceReferenced) {
        issues.push(
          weatherBacked
            ? `Weather-backed comparison ${module.type} modules must use bounded evidence references.`
            : `Comparison ${module.type} references weather evidence that was not retrieved.`,
        );
        continue;
      }

      if (!evidenceReferenced) {
        if (
          module.type === "summary" &&
          "items" in module &&
          module.items.filter((item) => item.recommended).length > 1
        ) {
          issues.push("Comparison summaries can recommend at most one option.");
        }
        if (module.type === "table") {
          for (const row of module.rows) {
            if (row.length !== module.columns.length) {
              issues.push("Comparison table rows must align with the column count.");
            }
          }
        }
        if (module.type === "chart") {
          for (const series of module.series) {
            if (series.values.length !== module.labels.length) {
              issues.push("Comparison chart series must align with the label count.");
            }
          }
        }
        continue;
      }

      validateLocationIndexes(module.locationIndexes, `Comparison ${module.type}`);
      if (isWeatherComparisonSummary(module)) {
        if (
          /-?\d+(?:\.\d+)?\s*(?:°|degrees?\b|%|mph\b|km\/h\b|mi\b|km\b)/i.test(
            `${module.title} ${module.recommendation}`,
          )
        ) {
          issues.push("Weather comparison narrative cannot contain model-authored measurements.");
        }
        if (
          module.recommendedLocationIndex !== undefined &&
          !module.locationIndexes.includes(module.recommendedLocationIndex)
        ) {
          issues.push("Recommended weather location must be included in the comparison.");
        }
        const deterministicWinner = deterministicWeatherRecommendedLocation(
          context.prompt,
          state,
          module.locationIndexes,
        );
        if (
          deterministicWinner !== undefined &&
          module.recommendedLocationIndex !== undefined &&
          module.recommendedLocationIndex !== deterministicWinner
        ) {
          issues.push("Recommended weather location does not match the deterministic evidence winner.");
        }
        if (
          plan.recipeId === "comparison.verdict" &&
          deterministicWinner !== undefined &&
          module.recommendedLocationIndex === undefined
        ) {
          issues.push("Weather verdict must identify the deterministic evidence winner.");
        }
      } else if (isWeatherComparisonTable(module)) {
        if (module.forecastKind === "current") {
          if (!module.metrics || module.metrics.length === 0 || module.metric || module.forecastIndexes) {
            issues.push("Current weather tables require only bounded metric references.");
          }
          if (module.metrics && !uniqueStrings(module.metrics)) {
            issues.push("Weather comparison metric references must be unique.");
          }
        } else {
          if (!module.metric || !module.forecastIndexes || module.metrics) {
            issues.push("Forecast weather tables require one metric and bounded forecast indexes.");
          }
          if (module.forecastIndexes && !uniqueValues(module.forecastIndexes)) {
            issues.push("Forecast table indexes must be unique.");
          }
          validateWeatherForecastReferences(module, state, issues, context.prompt);
        }
      } else if (isWeatherComparisonChart(module)) {
        if (!uniqueValues(module.forecastIndexes)) issues.push("Forecast chart indexes must be unique.");
        validateWeatherForecastReferences(module, state, issues, context.prompt);
      }
    }

    if (plan.recipeId === "comparison.trend") {
      const chartCount = moduleTypes.filter((type) => type === "chart").length;
      const tableCount = moduleTypes.filter((type) => type === "table").length;
      if (chartCount !== 1 || tableCount !== 1) {
        issues.push("Comparison trend requires exactly one chart and one aligned table.");
      }
    }
    if (!comparisonChartTableAligned(plan)) {
      issues.push("Comparison chart and table data must be exactly aligned.");
    }
  }

  issues.push(...weatherNarrativeIssues(plan, state));
  issues.push(...requestedCoverageIssues(plan, context, state));

  return issues.length > 0
    ? { success: false, issues: [...new Set(issues)].slice(0, 12) }
    : { success: true, plan };
}

interface CompileSurfacePlanInput {
  plan: SurfacePlan;
  retrieval: GeminiRetrievalResult;
  clientContext: ClientContext;
  prompt?: string;
  validationMode?: "recipe-v2" | "grammar-v3";
}

function formatDate(value: string, context: ClientContext, timeZone = context.timeZone): string {
  try {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      const date = new Date(
        Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])),
      );
      return new Intl.DateTimeFormat(context.locale, {
        weekday: "long",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(date);
    }
    return new Intl.DateTimeFormat(context.locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone,
    }).format(new Date(value));
  } catch {
    return value.slice(0, 60);
  }
}

function formatTime(value: string, context: ClientContext, timeZone = context.timeZone): string {
  try {
    return new Intl.DateTimeFormat(context.locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));
  } catch {
    return value.slice(11, 16) || value.slice(0, 40);
  }
}

function formatTimeRange(
  start: string,
  end: string,
  context: ClientContext,
  timeZone = context.timeZone,
): string {
  return `${formatTime(start, context, timeZone)}–${formatTime(end, context, timeZone)}`.slice(0, 160);
}

function metricNode(
  id: string,
  metric: z.infer<typeof weatherMetricsModuleSchema>["metrics"][number],
  current: z.infer<typeof currentConditionsSchema>,
): Record<string, unknown> {
  switch (metric) {
    case "feelsLike":
      return {
        id,
        component: "Metric",
        label: "Feels like",
        value: `${current.feelsLike}°${current.temperatureUnit}`,
        accent: "neutral",
      };
    case "humidity":
      return {
        id,
        component: "Metric",
        label: "Humidity",
        value: `${current.humidity}%`,
        accent: "blue",
      };
    case "wind":
      return {
        id,
        component: "Metric",
        label: "Wind",
        value: `${current.windSpeed} ${current.windSpeedUnit}`,
        detail: current.windDirection || undefined,
        accent: "neutral",
      };
    case "uv":
      return {
        id,
        component: "Metric",
        label: "UV index",
        value: String(current.uvIndex),
        accent: "coral",
      };
    case "visibility":
      return {
        id,
        component: "Metric",
        label: "Visibility",
        value: `${current.visibility} ${current.visibilityUnit}`,
        accent: "neutral",
      };
    case "precipitation":
      return {
        id,
        component: "Metric",
        label: "Precipitation",
        value: `${current.precipitationProbability}%`,
        accent: "blue",
      };
  }
}

function currentMetricLabel(metric: z.infer<typeof weatherCurrentMetricSchema>): string {
  return {
    temperature: "Temperature",
    feelsLike: "Feels like",
    humidity: "Humidity",
    precipitation: "Precipitation",
    wind: "Wind",
    uv: "UV index",
    visibility: "Visibility",
  }[metric];
}

function currentMetricValue(
  location: WeatherLocationEvidence,
  metric: z.infer<typeof weatherCurrentMetricSchema>,
): string {
  const current = location.current;
  switch (metric) {
    case "temperature":
      return `${current.temperature}°${current.temperatureUnit}`;
    case "feelsLike":
      return `${current.feelsLike}°${current.temperatureUnit}`;
    case "humidity":
      return `${current.humidity}%`;
    case "precipitation":
      return `${current.precipitationProbability}%`;
    case "wind":
      return `${current.windSpeed} ${current.windSpeedUnit}`;
    case "uv":
      return String(current.uvIndex);
    case "visibility":
      return `${current.visibility} ${current.visibilityUnit}`;
  }
}

function weatherForecastLabels(
  location: WeatherLocationEvidence,
  kind: "hourly" | "daily",
  indexes: readonly number[],
  clientContext: ClientContext,
  prompt?: string,
  timeZone = location.current.timeZone,
  suffix = "",
): string[] {
  const normalizedPrompt = prompt?.toLocaleLowerCase("en-US") ?? "";
  const observedOrdinal = localCalendarOrdinal(
    location.current.observedAt,
    location.current.timeZone,
  );
  return indexes.map((index) => {
    if (kind === "hourly") {
      const item = location.hourly[index];
      if (!item) throw new TypeError("Validated weather comparison evidence is unavailable.");
      return `${formatTime(item.startTime, clientContext, timeZone)}${suffix}`;
    }
    const item = location.daily[index];
    if (!item) throw new TypeError("Validated weather comparison evidence is unavailable.");
    const ordinal = dateOnlyOrdinal(item.date);
    const offset = ordinal !== undefined && observedOrdinal !== undefined
      ? ordinal - observedOrdinal
      : undefined;
    if (/\btomorrow\b/.test(normalizedPrompt) && offset === 1) return "Tomorrow";
    if (/\btoday\b/.test(normalizedPrompt) && offset === 0) return "Today";
    if (
      /\b(?:weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
        normalizedPrompt,
      )
    ) {
      try {
        return new Intl.DateTimeFormat(clientContext.locale, {
          weekday: "long",
          timeZone: "UTC",
        }).format(new Date(`${item.date}T12:00:00.000Z`));
      } catch {
        return item.date;
      }
    }
    if (
      /\b(?:next\s+(?:(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?days?|this\s+week|next\s+week)\b/.test(
        normalizedPrompt,
      ) &&
      offset !== undefined
    ) {
      return offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : `In ${offset} days`;
    }
    return formatDate(item.date, clientContext);
  });
}

function weatherForecastValue(
  location: WeatherLocationEvidence,
  kind: "hourly" | "daily",
  index: number,
  metric: z.infer<typeof weatherForecastMetricSchema>,
): number {
  if (kind === "hourly") {
    const hour = location.hourly[index];
    if (!hour) throw new TypeError("Validated hourly comparison evidence is unavailable.");
    if (metric === "temperature") return hour.temperature;
    if (metric === "precipitation" && hour.precipitationProbability !== null) {
      return hour.precipitationProbability;
    }
    throw new TypeError("Validated hourly comparison metric is unavailable.");
  }

  const day = location.daily[index];
  if (!day) throw new TypeError("Validated daily comparison evidence is unavailable.");
  if (metric === "high") return day.high;
  if (metric === "low") return day.low;
  if (metric === "precipitation") return day.precipitationProbability;
  throw new TypeError("Validated daily comparison metric is unavailable.");
}

function alignedWeatherForecastValue(
  anchor: WeatherLocationEvidence,
  location: WeatherLocationEvidence,
  kind: "hourly" | "daily",
  anchorIndex: number,
  metric: z.infer<typeof weatherForecastMetricSchema>,
  prompt?: string,
): number {
  const index = alignedForecastIndex(anchor, location, kind, anchorIndex, prompt);
  if (index < 0) throw new TypeError("Validated weather comparison evidence is unavailable.");
  return weatherForecastValue(location, kind, index, metric);
}

function weatherForecastUnit(
  location: WeatherLocationEvidence,
  metric: z.infer<typeof weatherForecastMetricSchema>,
): string {
  return metric === "precipitation" ? "%" : `°${location.current.temperatureUnit}`;
}

function weatherComparisonAxis(
  locations: readonly WeatherLocationEvidence[],
  prompt?: string,
): { timeZone: string; suffix: string } {
  if (parseWeatherRequestIntent(prompt ?? "").localTime !== undefined) {
    return {
      timeZone: locations[0]?.current.timeZone ?? "UTC",
      suffix: " local",
    };
  }
  const timeZones = new Set(locations.map((location) => location.current.timeZone));
  return timeZones.size === 1
    ? { timeZone: locations[0]?.current.timeZone ?? "UTC", suffix: "" }
    : { timeZone: "UTC", suffix: " UTC" };
}

function dailyRecommendationCopy(
  location: WeatherLocationEvidence,
  module: z.infer<typeof weatherDailyRecommendationModuleSchema>,
  clientContext: ClientContext,
): { label: string; value: string; detail: string; confidence: "high" } {
  const day = location.daily[module.dayIndex];
  if (!day) throw new TypeError("Validated daily recommendation evidence is unavailable.");
  const date = formatDate(day.date, clientContext);
  if (module.signal === "wettest" || module.signal === "driest") {
    return {
      label: module.signal === "wettest" ? "Wettest day" : "Driest day",
      value: date,
      detail: `${day.precipitationProbability}% precipitation probability · ${day.high}°${day.temperatureUnit} high`,
      confidence: "high",
    };
  }
  return {
    label: module.signal === "warmest" ? "Warmest day" : "Coolest day",
    value: date,
    detail: `${module.signal === "warmest" ? day.high : day.low}°${day.temperatureUnit} · ${day.precipitationProbability}% precipitation probability`,
    confidence: "high",
  };
}

function sourceNode(
  id: string,
  module: z.infer<typeof sourceModuleSchema>,
): Record<string, unknown> {
  return {
    id,
    component: "SourceList",
    label: module.label,
    sourceIds: [...module.sourceIds],
  };
}

export function compileSurfacePlan({
  plan,
  retrieval,
  clientContext,
  prompt,
  validationMode,
}: CompileSurfacePlanInput): SurfaceSpec {
  const validation = validateSurfacePlan(plan, {
    sources: retrieval.sources,
    evidence: retrieval.evidence,
    prompt,
    clientContext,
  }, { mode: validationMode });
  if (!validation.success) {
    throw new TypeError(`Cannot compile invalid SurfacePlan: ${validation.issues.join(" ")}`);
  }

  const trustedPlan = validation.plan;
  const weatherState = readWeatherState(retrieval.evidence);
  const body: Array<Record<string, unknown>> = [];
  const roots: string[] = [];
  const weatherSourceId = generalWeatherSourceId(retrieval.sources, weatherState);

  trustedPlan.modules.forEach((module, moduleIndex) => {
    const baseId = `module-${moduleIndex + 1}-${module.type}`;

    if (module.type === "sources") {
      roots.push(baseId);
      body.push(sourceNode(baseId, module));
      return;
    }

    if (trustedPlan.kind === "weather") {
      if (!isWeatherContentModule(module)) {
        throw new TypeError("Validated weather plan contains an incompatible module.");
      }
      const location = weatherState.locations[module.locationIndex];
      if (!location) throw new TypeError("Validated weather location is unavailable.");

      if (module.type === "hero") {
        const safeLabel = safeWeatherHeroNarrative(
          module.recommendationLabel,
          "Current conditions",
        );
        const safeValue = safeWeatherHeroNarrative(
          module.recommendationValue,
          location.current.conditionText,
        );
        const safeDetail = safeWeatherHeroNarrative(
          module.recommendationDetail,
          `Provider-observed conditions for ${location.location.name}.`,
        );
        roots.push(baseId);
        body.push({
          id: baseId,
          component: "WeatherHero",
          location: location.location.name,
          dateLabel: formatDate(
            location.current.observedAt,
            clientContext,
            location.current.timeZone,
          ),
          temperature: location.current.temperature,
          unit: location.current.temperatureUnit,
          condition: location.current.conditionText,
          conditionKey: location.current.conditionKey,
          recommendationLabel: safeLabel,
          recommendationValue: safeValue,
          recommendationDetail: safeDetail,
          variant: module.variant,
        });
        return;
      }

      if (module.type === "metrics") {
        const metricIds = module.metrics.map((_, index) => `${baseId}-${index + 1}`);
        roots.push(baseId);
        body.push({
          id: baseId,
          component: "Rail",
          children: metricIds,
          label: weatherState.locations.length > 1
            ? `${location.location.name} conditions`
            : "Conditions",
        });
        module.metrics.forEach((metric, index) => {
          body.push(metricNode(metricIds[index], metric, location.current));
        });
        return;
      }

      if (module.type === "recommendation") {
        roots.push(baseId);
        if ("activityWindowIndex" in module) {
          const window = weatherState.activityWindows[module.activityWindowIndex];
          if (!window) throw new TypeError("Validated activity-window evidence is unavailable.");
          body.push({
            id: baseId,
            component: "RecommendationBand",
            label: window.label,
            value: formatTimeRange(
              window.startTime,
              window.endTime,
              clientContext,
              location.current.timeZone,
            ),
            detail: window.detail,
            confidence: window.confidence,
          });
        } else {
          body.push({
            id: baseId,
            component: "RecommendationBand",
            ...dailyRecommendationCopy(location, module, clientContext),
          });
        }
        return;
      }

      if (module.type === "hourly") {
        roots.push(baseId);
        body.push({
          id: baseId,
          component: "HourlyForecast",
          label: module.label,
          unit: location.current.temperatureUnit,
          variant: module.variant,
          items: module.hourIndexes.map((index) => {
            const hour = location.hourly[index];
            if (!hour || hour.precipitationProbability === null) {
              throw new TypeError("Validated hourly evidence is unavailable.");
            }
            return {
              time: formatTime(hour.startTime, clientContext, location.current.timeZone),
              temperature: hour.temperature,
              precipitationProbability: hour.precipitationProbability,
              condition: hour.conditionKey,
            };
          }),
        });
        return;
      }

      if (module.type === "daily") {
        roots.push(baseId);
        body.push({
          id: baseId,
          component: "DailyForecast",
          label: module.label,
          unit: location.current.temperatureUnit,
          variant: module.variant,
          items: module.dayIndexes.map((index) => {
            const day = location.daily[index];
            if (!day) throw new TypeError("Validated daily evidence is unavailable.");
            return {
              date: formatDate(day.date, clientContext),
              high: day.high,
              low: day.low,
              precipitationProbability: day.precipitationProbability,
              condition: day.conditionKey,
            };
          }),
        });
        return;
      }

      if (module.type === "alerts") {
        const alertIds = module.alertIndexes.map((_, index) => `${baseId}-${index + 1}`);
        if (alertIds.length === 1) roots.push(alertIds[0]);
        else {
          roots.push(baseId);
          body.push({
            id: baseId,
            component: "Band",
            children: alertIds,
            tone: "coral",
            label: "Weather alerts",
          });
        }
        module.alertIndexes.forEach((index, alertIndex) => {
          const alert = location.alerts[index];
          if (!alert || alert.severity === "unknown") {
            throw new TypeError("Validated weather alert evidence is unavailable.");
          }
          body.push({
            id: alertIds[alertIndex],
            component: "WeatherAlert",
            title: alert.title,
            severity: alert.severity,
            description: alert.description,
            ...((alertAuthoritySourceId(alert, retrieval.sources) ?? weatherSourceId)
              ? { sourceId: alertAuthoritySourceId(alert, retrieval.sources) ?? weatherSourceId }
              : {}),
          });
        });
      }
      return;
    }

    if (trustedPlan.kind === "comparison") {
      if (module.type === "summary") {
        roots.push(baseId);
        const localHourCoverage = requestedLocalHourCoverage(prompt ?? "", weatherState.locations);
        const items = isWeatherComparisonSummary(module)
          ? module.locationIndexes.map((index) => {
              const location = weatherState.locations[index];
              if (!location) throw new TypeError("Validated weather comparison location is unavailable.");
              const localHourIndex = localHourCoverage.find(
                (coverage) => coverage.locationIndex === index,
              )?.indexes[0];
              const localHour = localHourIndex === undefined
                ? undefined
                : location.hourly[localHourIndex];
              if (localHour) {
                return {
                  label: location.location.name,
                  value: `${localHour.temperature}°${localHour.temperatureUnit}`,
                  detail: localHour.precipitationProbability === null
                    ? `${formatTime(localHour.startTime, clientContext, location.current.timeZone)} local forecast`
                    : `${localHour.precipitationProbability}% precipitation · ${formatTime(
                        localHour.startTime,
                        clientContext,
                        location.current.timeZone,
                      )} local`,
                  recommended: module.recommendedLocationIndex === index,
                };
              }
              return {
                label: location.location.name,
                value: `${location.current.temperature}°${location.current.temperatureUnit} · ${location.current.conditionText}`,
                detail: `Feels like ${location.current.feelsLike}°${location.current.temperatureUnit} · ${location.current.precipitationProbability}% precipitation`,
                recommended: module.recommendedLocationIndex === index,
              };
            })
          : module.items.map((item) => ({ ...item }));
        body.push({
          id: baseId,
          component: "ComparisonSummary",
          title: module.title,
          recommendation: module.recommendation,
          items,
          variant: module.variant,
        });
      } else if (module.type === "table") {
        roots.push(baseId);
        if (isWeatherComparisonTable(module)) {
          const locations = module.locationIndexes.map((index) => {
            const location = weatherState.locations[index];
            if (!location) throw new TypeError("Validated weather comparison location is unavailable.");
            return location;
          });
          if (module.forecastKind === "current") {
            body.push({
              id: baseId,
              component: "ComparisonTable",
              caption: module.caption,
              columns: ["Metric", ...locations.map((location) => location.location.name)],
              rows: (module.metrics ?? []).map((metric) => [
                currentMetricLabel(metric),
                ...locations.map((location) => currentMetricValue(location, metric)),
              ]),
            });
            return;
          }
          const forecastKind = module.forecastKind;
          const indexes = module.forecastIndexes ?? [];
          const metric = module.metric;
          if (!metric || locations.length === 0) {
            throw new TypeError("Validated weather comparison table references are unavailable.");
          }
          const axis = weatherComparisonAxis(locations, prompt);
          const labels = weatherForecastLabels(
            locations[0],
            forecastKind,
            indexes,
            clientContext,
            prompt,
            axis.timeZone,
            axis.suffix,
          );
          body.push({
            id: baseId,
            component: "ComparisonTable",
            caption: module.caption,
            columns: ["Period", ...locations.map((location) => location.location.name)],
            rows: labels.map((label, labelIndex) => [
              label,
              ...locations.map((location) => {
                const value = alignedWeatherForecastValue(
                  locations[0],
                  location,
                  forecastKind,
                  indexes[labelIndex],
                  metric,
                  prompt,
                );
                return `${value}${weatherForecastUnit(location, metric)}`;
              }),
            ]),
          });
          return;
        }
        body.push({
          id: baseId,
          component: "ComparisonTable",
          caption: module.caption,
          columns: [...module.columns],
          rows: module.rows.map((row) => [...row]),
        });
      } else if (module.type === "chart") {
        roots.push(baseId);
        if (isWeatherComparisonChart(module)) {
          const locations = module.locationIndexes.map((index) => {
            const location = weatherState.locations[index];
            if (!location) throw new TypeError("Validated weather comparison location is unavailable.");
            return location;
          });
          if (locations.length === 0) {
            throw new TypeError("Validated weather comparison chart references are unavailable.");
          }
          const axis = weatherComparisonAxis(locations, prompt);
          body.push({
            id: baseId,
            component: "ComparisonChart",
            title: module.title,
            labels: weatherForecastLabels(
              locations[0],
              module.forecastKind,
              module.forecastIndexes,
              clientContext,
              prompt,
              axis.timeZone,
              axis.suffix,
            ),
            series: locations.map((location) => ({
              label: location.location.name,
              values: module.forecastIndexes.map((index) =>
                alignedWeatherForecastValue(
                  locations[0],
                  location,
                  module.forecastKind,
                  index,
                  module.metric,
                  prompt,
                ),
              ),
            })),
            unit: weatherForecastUnit(locations[0], module.metric),
            variant: module.variant,
          });
          return;
        }
        body.push({
          id: baseId,
          component: "ComparisonChart",
          title: module.title,
          labels: [...module.labels],
          series: module.series.map((series) => ({
            label: series.label,
            values: [...series.values],
          })),
          ...(module.unit ? { unit: module.unit } : {}),
          variant: module.variant,
        });
      }
      return;
    }

    if (module.type === "lead") {
      roots.push(baseId);
      body.push({
        id: baseId,
        component: "ResearchLead",
        title: module.title,
        summary: module.summary,
        sourceIds: [...module.sourceIds],
        variant: module.variant,
      });
    } else if (module.type === "evidence") {
      roots.push(baseId);
      body.push({
        id: baseId,
        component: "EvidenceList",
        label: module.label,
        items: module.items.map((item) => ({ ...item })),
        variant: module.variant,
      });
    } else if (module.type === "timeline") {
      roots.push(baseId);
      body.push({
        id: baseId,
        component: "Timeline",
        label: module.label,
        items: module.items.map((item) => ({ ...item })),
      });
    }
  });

  return SurfaceSpecSchema.parse({
    kind: trustedPlan.kind,
    rootId: "surface-frame",
    components: [
      {
        id: "surface-frame",
        component: "SurfaceFrame",
        children: roots,
        recipeId: trustedPlan.recipeId,
        density: trustedPlan.density,
        emphasis: trustedPlan.emphasis,
      },
      ...body,
    ],
  });
}

interface BuildFallbackSurfacePlanInput {
  kind: "weather" | "comparison" | "research";
  prompt: string;
  retrieval: GeminiRetrievalResult;
  clientContext: ClientContext;
}

function sanitizePlanText(value: string): string {
  const removeAll = (input: string, pattern: RegExp): string =>
    input.replace(new RegExp(pattern.source, `${pattern.flags}g`), " ");
  return removeAll(
    removeAll(removeAll(value, MARKUP_LIKE_TAG_PATTERN), EXECUTABLE_URL_SCHEME_PATTERN),
    RAW_PLAN_URL_PATTERN,
  )
    .replace(/\s+/g, " ")
    .trim();
}

function limited(value: string, maximum: number, fallback: string): string {
  const safeFallback = sanitizePlanText(fallback);
  const normalized = sanitizePlanText(value);
  const candidate = (normalized || safeFallback).slice(0, maximum).trim() || safeFallback;
  if (!candidate || !isSafePlanText(candidate)) {
    throw new TypeError("Deterministic fallback text is outside the safe SurfacePlan boundary.");
  }
  return candidate;
}

function comparisonLabels(prompt: string): readonly [string, string] {
  const normalized = prompt.trim().replace(/[?.!]+$/, "");
  const commandBody = normalized
    .replace(/^(?:please\s+)?(?:compare|score|rank)\s+/i, "")
    .replace(/^.*?:\s*/, "");
  const match = commandBody.match(
    /^(.+?)\s+(?:and|or|vs\.?|versus)\s+(.+?)(?=\s+(?:on|by|across|using|with|for|in\s+terms\s+of)\b|$)/i,
  );
  if (!match) return ["First option", "Second option"];
  return [
    limited(match[1], 120, "First option"),
    limited(match[2], 120, "Second option"),
  ];
}

function rangeWord(value: number): string {
  return [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ][value] ?? String(value);
}

function requestedWeekdayLabel(prompt: string): string | undefined {
  const weekdays = [
    ...prompt.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi),
  ].map((match) => `${match[1][0].toLocaleUpperCase("en-US")}${match[1].slice(1).toLocaleLowerCase("en-US")}`);
  const unique = [...new Set(weekdays)];
  return unique.length >= 2 ? unique.join("–") : undefined;
}

function fallbackActivityHourIndexes(
  location: WeatherLocationEvidence,
  window: ActivityWindowEvidence,
): number[] {
  const start = Date.parse(window.startTime);
  const end = Date.parse(window.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const indexes = location.hourly.flatMap((hour, index) => {
    const timestamp = Date.parse(hour.startTime);
    return timestamp >= start - 3_600_000 && timestamp < end ? [index] : [];
  });
  if (indexes.length >= 2 || location.hourly.length < 2) return indexes.slice(0, 24);

  const nearest = location.hourly
    .map((hour, index) => ({ index, distance: Math.abs(Date.parse(hour.startTime) - start) }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((left, right) => left.distance - right.distance || left.index - right.index);
  for (const entry of nearest) {
    if (!indexes.includes(entry.index)) indexes.push(entry.index);
    if (indexes.length >= 2) break;
  }
  return indexes.sort((left, right) => left - right).slice(0, 24);
}

function validatedFallbackPlan(
  input: BuildFallbackSurfacePlanInput,
  candidate: unknown,
): SurfacePlan {
  const parsed = SurfacePlanSchema.parse(candidate);
  const validation = validateSurfacePlan(parsed, {
    sources: input.retrieval.sources,
    evidence: input.retrieval.evidence,
    prompt: input.prompt,
    clientContext: input.clientContext,
  });
  if (!validation.success) {
    throw new TypeError(`Cannot build valid ${input.kind} fallback: ${validation.issues.join(" ")}`);
  }
  return validation.plan;
}

export function buildFallbackSurfacePlan(input: BuildFallbackSurfacePlanInput): SurfacePlan {
  const { kind, prompt, retrieval } = input;
  const sourceIds = retrieval.sources.slice(0, LIMITS.sources).map((source) => source.id);
  if (sourceIds.length === 0) {
    throw new TypeError(`${kind} fallback requires at least one issued source.`);
  }

  if (kind === "weather") {
    const state = readWeatherState(retrieval.evidence);
    const weatherRecipeId = expectedRecipeForPrompt(prompt, "weather", true) ?? "weather.snapshot";
    if (state.locations.length > 1 && weatherRecipeId === "weather.snapshot") {
      return buildFallbackSurfacePlan({ ...input, kind: "comparison" });
    }
    const location = state.locations[0];
    if (!location) throw new TypeError("A weather fallback requires normalized weather evidence.");
    const recipeId = weatherRecipeId;
    const requestIntent = parseWeatherRequestIntent(prompt);
    const localHourCoverage = requestedLocalHourCoverage(prompt, state.locations);
    const asksForAlerts = /\b(?:alerts?|warnings?|advisories)\b/i.test(prompt);
    const modules: Array<z.infer<typeof weatherModuleSchema>> = [
      {
        type: "hero",
        variant: recipeId === "weather.decision" ? "decision" : "snapshot",
        locationIndex: 0,
        recommendationLabel: "Current conditions",
        recommendationValue: limited(location.current.conditionText, 120, "Provider conditions"),
        recommendationDetail: limited(
          `Provider-observed conditions for ${location.location.name}.`,
          240,
          "Provider-observed conditions.",
        ),
      },
    ];

    if (recipeId === "weather.decision") {
      const decisions = state.locations.flatMap((candidateLocation, locationIndex) => {
        const activityWindowIndex = state.activityWindows.findIndex((window) =>
          locationsMatch(candidateLocation.location, window.location)
        );
        return activityWindowIndex < 0
          ? []
          : [{ candidateLocation, locationIndex, activityWindowIndex }];
      });
      if (decisions.length === 0) {
        throw new TypeError("A weather decision fallback requires a deterministic activity window.");
      }
      for (const decision of decisions) {
        modules.push({
          type: "recommendation",
          locationIndex: decision.locationIndex,
          activityWindowIndex: decision.activityWindowIndex,
        });
      }
      for (const decision of decisions) {
        const hourIndexes = fallbackActivityHourIndexes(
          decision.candidateLocation,
          state.activityWindows[decision.activityWindowIndex],
        );
        if (hourIndexes.length === 0) continue;
        modules.push({
          type: "hourly",
          variant: "chart",
          label: state.locations.length > 1
            ? limited(
                `${decision.candidateLocation.location.name} around the recommended window`,
                80,
                "Conditions around the recommended window",
              )
            : "Conditions around the recommended window",
          locationIndex: decision.locationIndex,
          hourIndexes,
        });
      }
    } else if (recipeId === "weather.outlook") {
      const requestedHours = requestIntent.forecastHours;
      if (requestedHours !== undefined || requestIntent.localTime !== undefined) {
        state.locations.forEach((candidateLocation, locationIndex) => {
          const hourIndexes = [...new Set([
            ...(requestedHours === undefined
              ? []
              : candidateLocation.hourly
                  .slice(0, Math.min(requestedHours, 24))
                  .map((_, index) => index)),
            ...(localHourCoverage.find(
              (coverage) => coverage.locationIndex === locationIndex,
            )?.indexes ?? []),
          ])].slice(0, 24);
          if (hourIndexes.length === 0) return;
          const rangeLabel = requestIntent.localTime
            ? `${requestIntent.localTime} local outlook`
            : `${rangeWord(hourIndexes.length)}-hour outlook`;
          modules.push({
            type: "hourly",
            variant: "chart",
            label: state.locations.length > 1
              ? limited(
                  `${candidateLocation.location.name} · ${rangeLabel}`,
                  80,
                  rangeLabel,
                )
              : rangeLabel,
            locationIndex,
            hourIndexes,
          });
        });
      } else {
        const requestedIndexes = requestedSpecificDayIndexes(prompt, state).filter(
          (index) => index >= 0,
        );
        const dayIndexesByLocation = state.locations.map((candidateLocation, locationIndex) => {
          const count = requestedDayCount(prompt, state) ?? Math.min(3, candidateLocation.daily.length);
          const dayIndexes = requestedIndexes.length > 0
            ? [...new Set(requestedIndexes)].filter((index) => index < candidateLocation.daily.length)
            : candidateLocation.daily.slice(0, count).map((_, index) => index);
          if (dayIndexes.length > 0) {
            modules.push({
              type: "daily",
              variant: "table",
              label: state.locations.length > 1
                ? limited(
                    `${candidateLocation.location.name} · ${rangeWord(dayIndexes.length)}-day outlook`,
                    80,
                    `${rangeWord(dayIndexes.length)}-day outlook`,
                  )
                : `${rangeWord(dayIndexes.length)}-day outlook`,
              locationIndex,
              dayIndexes,
            });
          }
          return dayIndexes;
        });
        const signal = /\b(wettest|driest|warmest|coolest)\b/i.exec(prompt)?.[1]
          ?.toLocaleLowerCase("en-US") as z.infer<typeof weatherDailyRecommendationModuleSchema>["signal"] | undefined;
        const dayIndexes = dayIndexesByLocation[0] ?? [];
        if (signal && dayIndexes.length > 0) {
          const valueFor = (index: number): number => {
            const day = location.daily[index];
            if (signal === "wettest" || signal === "driest") {
              return day.precipitationProbability;
            }
            return signal === "warmest" ? day.high : day.low;
          };
          const dayIndex = dayIndexes.reduce((best, index) => {
            const value = valueFor(index);
            const bestValue = valueFor(best);
            return signal === "driest" || signal === "coolest"
              ? value < bestValue ? index : best
              : value > bestValue ? index : best;
          });
          modules.push({ type: "recommendation", locationIndex: 0, dayIndex, signal });
        }
      }
    } else {
      if (!asksForAlerts) {
        state.locations.forEach((_, locationIndex) => {
          modules.push({
            type: "metrics",
            locationIndex,
            metrics: ["humidity", "wind"],
          });
        });
      }
    }
    if (asksForAlerts) {
      state.locations.forEach((candidateLocation, locationIndex) => {
        const alertIndexes = candidateLocation.alerts.flatMap((alert, index) =>
          alert.severity === "unknown" ? [] : [index]
        ).slice(0, 8);
        if (alertIndexes.length > 0) {
          modules.push({ type: "alerts", locationIndex, alertIndexes });
        }
      });
    }
    modules.push({ type: "sources", label: "Weather source", sourceIds });
    return validatedFallbackPlan(input, {
      kind: "weather",
      recipeId,
      density:
        recipeId === "weather.snapshot"
          ? "brief"
          : recipeId === "weather.outlook" && /\b(?:wettest|driest|warmest|coolest)\b/i.test(prompt)
            ? "detailed"
            : "balanced",
      emphasis: recipeId === "weather.decision" ? "decision" : recipeId === "weather.outlook" ? "trend" : "answer",
      modules,
    });
  }

  if (kind === "comparison") {
    const state = readWeatherState(retrieval.evidence);
    if (state.locations.length >= 2) {
      const locationIndexes = state.locations.map((_, index) => index);
      const requestIntent = parseWeatherRequestIntent(prompt);
      const localHourCoverage = requestedLocalHourCoverage(prompt, state.locations);
      const localAnchorHourIndexes = localHourCoverage.find(
        (coverage) => coverage.locationIndex === 0,
      )?.indexes ?? [];
      const recipeId = expectedRecipeForPrompt(prompt, "comparison", true) ?? "comparison.verdict";
      const deterministicWinner = deterministicWeatherRecommendedLocation(
        prompt,
        state,
        locationIndexes,
      );
      const summary = {
        type: "summary" as const,
        variant: recipeId === "comparison.verdict" ? "verdict" as const : "balanced" as const,
        title: recipeId === "comparison.trend" ? "Weather trend comparison" : "Weather comparison",
        recommendation: deterministicWinner === undefined
          ? "Provider-observed conditions are shown side by side without a generated winner."
          : limited(
              `The requested provider evidence favors ${state.locations[deterministicWinner].location.name}.`,
              400,
              "The requested provider evidence identifies a preferred location.",
            ),
        locationIndexes,
        ...(deterministicWinner === undefined
          ? {}
          : { recommendedLocationIndex: deterministicWinner }),
        sourceIds,
      };
      if (recipeId === "comparison.trend") {
        const requestedHourCount = requestIntent.forecastHours;
        const forecastKind = requestedHourCount === undefined && requestIntent.localTime === undefined
          ? "daily" as const
          : "hourly" as const;
        const specificallyRequested = requestedSpecificDayIndexes(prompt, state).filter(
          (index) => index >= 0,
        );
        const requestedDayCount = requestedRange(prompt, "day");
        const forecastIndexes = forecastKind === "hourly"
          ? [...new Set([
              ...(requestedHourCount === undefined
                ? []
                : state.locations[0].hourly
                    .slice(0, Math.min(requestedHourCount, 24))
                    .map((_, index) => index)),
              ...localAnchorHourIndexes,
            ])].slice(0, 24)
          : specificallyRequested.length > 0
            ? specificallyRequested
            : state.locations[0].daily.slice(0, requestedDayCount ?? 2).map((_, index) => index);
        const metric: z.infer<typeof weatherForecastMetricSchema> = forecastKind === "hourly"
          ? /\b(?:rain|precipitation)\b/i.test(prompt) ? "precipitation" : "temperature"
          : /\blows?\b/i.test(prompt)
            ? "low"
            : /\b(?:rain|precipitation)\b/i.test(prompt)
              ? "precipitation"
              : "high";
        const weekdayLabel = requestedWeekdayLabel(prompt);
        const rangeLabel = weekdayLabel ?? `${rangeWord(forecastIndexes.length)}-${forecastKind === "hourly" ? "hour" : "day"}`;
        return validatedFallbackPlan(input, {
          kind: "comparison",
          recipeId,
          density: "detailed",
          emphasis: "trend",
          modules: [
            summary,
            {
              type: "chart",
              variant: "line",
              title: `${rangeLabel} ${metric === "precipitation" ? "precipitation" : `${metric} temperature`} trend`,
              locationIndexes,
              forecastKind,
              forecastIndexes,
              metric,
              sourceIds,
            },
            {
              type: "table",
              caption: `${rangeLabel} trend data`,
              locationIndexes,
              forecastKind,
              forecastIndexes,
              metric,
              sourceIds,
            },
            { type: "sources", label: "Weather sources", sourceIds },
          ],
        });
      }
      const specificallyRequested = requestedSpecificDayIndexes(prompt, state).filter(
        (index) => index >= 0,
      );
      const requestedCount = requestedRange(prompt, "day");
      const forecastIndexes = specificallyRequested.length > 0
        ? specificallyRequested
        : requestedCount
          ? state.locations[0].daily.slice(0, requestedCount).map((_, index) => index)
          : [];
      const forecastMetric: z.infer<typeof weatherForecastMetricSchema> = /\blows?\b/i.test(prompt)
        ? "low"
        : /\b(?:rain|precipitation|picnic|brunch|outdoor)\b/i.test(prompt)
          ? "precipitation"
          : "high";
      const comparisonTable = localAnchorHourIndexes.length > 0
        ? {
            type: "table" as const,
            caption: "Requested local-time weather",
            locationIndexes,
            forecastKind: "hourly" as const,
            forecastIndexes: localAnchorHourIndexes,
            metric: /\b(?:rain|precipitation)\b/i.test(prompt)
              ? "precipitation" as const
              : "temperature" as const,
            sourceIds,
          }
        : forecastIndexes.length > 0
        ? {
            type: "table" as const,
            caption: `${requestedWeekdayLabel(prompt) ?? "Requested day"} weather`,
            locationIndexes,
            forecastKind: "daily" as const,
            forecastIndexes,
            metric: forecastMetric,
            sourceIds,
          }
        : {
            type: "table" as const,
            caption: "Current conditions",
            locationIndexes,
            forecastKind: "current" as const,
            metrics: ["temperature", "feelsLike", "precipitation", "wind"] as const,
            sourceIds,
          };
      return validatedFallbackPlan(input, {
        kind: "comparison",
        recipeId,
        density: recipeId === "comparison.scorecard" ? "balanced" : "brief",
        emphasis: recipeId === "comparison.scorecard" ? "answer" : "decision",
        modules: [
          summary,
          comparisonTable,
          { type: "sources", label: "Weather sources", sourceIds },
        ],
      });
    }
    const [first, second] = comparisonLabels(prompt);
    const recommendation = limited(
      retrieval.outputText,
      400,
      "The available evidence does not support a single clear winner.",
    );
    const recipeId = expectedRecipeForPrompt(prompt, "comparison", false) ?? "comparison.verdict";
    if (recipeId === "comparison.trend") {
      throw new TypeError("A search-backed trend fallback requires structured numeric evidence.");
    }
    const summary = {
      type: "summary" as const,
      variant: recipeId === "comparison.verdict" ? "verdict" as const : "balanced" as const,
      title: limited(
        recipeId === "comparison.scorecard"
          ? `${first} and ${second} scorecard`
          : `${first} compared with ${second}`,
        180,
        recipeId === "comparison.scorecard" ? "Comparison scorecard" : "Comparison verdict",
      ),
      recommendation,
      items: [
        {
          label: first,
          value: "Evidence available",
          detail: limited(retrieval.sources[0]?.title ?? "Primary source", 220, "Primary source"),
          recommended: false,
        },
        {
          label: second,
          value: "Evidence available",
          detail: limited(retrieval.sources[1]?.title ?? "Additional source", 220, "Additional source"),
          recommended: false,
        },
      ],
      sourceIds,
    };
    const modules: Array<z.infer<typeof comparisonModuleSchema>> = [summary];
    if (recipeId === "comparison.scorecard") {
      const criteria = extractRequestedCriteria(prompt);
      const criterionRows = (criteria.length > 0 ? criteria : ["Available evidence"]).map(
        (criterion) => [
          limited(criterion, 80, "Criterion"),
          "Not deterministically scored",
          "Not deterministically scored",
        ],
      );
      modules.push({
        type: "table",
        caption: "Requested criteria without invented scores",
        columns: ["Criterion", first, second],
        rows: criterionRows,
        sourceIds,
      });
    }
    modules.push({ type: "sources", label: "Sources", sourceIds });
    return validatedFallbackPlan(input, {
      kind: "comparison",
      recipeId,
      density: recipeId === "comparison.scorecard" ? "balanced" : "brief",
      emphasis: recipeId === "comparison.scorecard" ? "answer" : "decision",
      modules,
    });
  }

  const recipeId = expectedRecipeForPrompt(prompt, "research") ?? "research.brief";
  const lead = {
    type: "lead" as const,
    variant: recipeId === "research.brief" ? "brief" as const : "feature" as const,
    title: limited(prompt, 220, "Research brief"),
    summary: limited(retrieval.outputText, 1_200, "The available sources provide a bounded research answer."),
    sourceIds,
  };
  const modules: Array<z.infer<typeof researchModuleSchema>> = [lead];
  if (recipeId === "research.timeline") {
    modules.push({
      type: "timeline",
      label: "Available source chronology",
      items: retrieval.sources.slice(0, LIMITS.sources).map((source) => ({
        date: "Date not established",
        title: limited(source.title, 180, "Issued source"),
        detail: "The retrieved evidence does not establish a trustworthy event date for this source.",
        sourceId: source.id,
      })),
    });
  } else if (recipeId === "research.claims" || /\b(?:evidence|sources?)\b/i.test(prompt)) {
    modules.push({
      type: "evidence",
      variant: "stack",
      label: "Available evidence",
      items: retrieval.sources.slice(0, LIMITS.sources).map((source) => ({
        title: limited(source.title, 180, "Issued source"),
        finding: limited(source.title, 400, "Issued source"),
        stance: "neutral" as const,
        sourceId: source.id,
      })),
    });
  }
  modules.push({ type: "sources", label: "Sources", sourceIds });
  return validatedFallbackPlan(input, {
    kind: "research",
    recipeId,
    density: recipeId === "research.brief" ? "brief" : "detailed",
    emphasis: recipeId === "research.timeline" ? "trend" : recipeId === "research.claims" ? "evidence" : "answer",
    modules,
  });
}
