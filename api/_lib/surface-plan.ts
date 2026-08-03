import { z } from "zod";
import { LIMITS } from "../../shared/constants.js";
import {
  SurfaceSpecSchema,
  type ClientContext,
  type SourceRecord,
  type SurfaceSpec,
} from "../../shared/schemas.js";
import type { GeminiRetrievalResult, WeatherEvidence } from "./gemini.js";

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
const sourceIdsSchema = z.array(sourceIdSchema).min(1).max(LIMITS.sources);
const indexSchema = z.number().int().min(0);

const sourceModuleSchema = z
  .object({
    type: z.literal("sources"),
    label: boundedText(80),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const weatherHeroModuleSchema = z
  .object({
    type: z.literal("hero"),
    variant: z.enum(["snapshot", "decision"]),
    locationIndex: indexSchema,
    recommendationLabel: boundedText(80),
    recommendationValue: boundedText(120),
    recommendationDetail: boundedText(240),
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
    label: boundedText(80),
    locationIndex: indexSchema,
    hourIndexes: z.array(indexSchema).min(2).max(24),
  })
  .strict();

const weatherDailyModuleSchema = z
  .object({
    type: z.literal("daily"),
    variant: z.enum(["cards", "table"]),
    label: boundedText(80),
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
    label: boundedText(120),
    value: boundedText(120),
    detail: boundedOptionalText(220),
    recommended: z.boolean(),
  })
  .strict();

const locationIndexesSchema = z.array(indexSchema).min(2).max(LIMITS.locations);

const authoredComparisonSummaryModuleSchema = z
  .object({
    type: z.literal("summary"),
    variant: z.enum(["verdict", "balanced"]),
    title: boundedText(180),
    recommendation: boundedText(400),
    items: z.array(comparisonItemSchema).min(2).max(4),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const weatherComparisonSummaryModuleSchema = z
  .object({
    type: z.literal("summary"),
    variant: z.enum(["verdict", "balanced"]),
    title: boundedText(180),
    recommendation: boundedText(400),
    locationIndexes: locationIndexesSchema,
    recommendedLocationIndex: indexSchema.optional(),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const authoredComparisonTableModuleSchema = z
  .object({
    type: z.literal("table"),
    caption: boundedText(160),
    columns: z.array(boundedText(80)).min(2).max(6),
    rows: z.array(z.array(z.string().trim().max(160)).min(2).max(6)).min(1).max(12),
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
    caption: boundedText(160),
    locationIndexes: locationIndexesSchema,
    forecastKind: z.enum(["current", "hourly", "daily"]),
    forecastIndexes: z.array(indexSchema).min(1).max(12).optional(),
    metrics: z.array(weatherCurrentMetricSchema).min(1).max(7).optional(),
    metric: weatherForecastMetricSchema.optional(),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const authoredComparisonChartModuleSchema = z
  .object({
    type: z.literal("chart"),
    variant: z.enum(["line", "bar"]),
    title: boundedText(160),
    labels: z.array(boundedText(60)).min(2).max(12),
    series: z
      .array(
        z
          .object({
            label: boundedText(80),
            values: z.array(z.number().finite()).min(2).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    unit: boundedOptionalText(24),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const weatherComparisonChartModuleSchema = z
  .object({
    type: z.literal("chart"),
    variant: z.enum(["line", "bar"]),
    title: boundedText(160),
    locationIndexes: locationIndexesSchema,
    forecastKind: z.enum(["hourly", "daily"]),
    forecastIndexes: z.array(indexSchema).min(2).max(12),
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
    title: boundedText(220),
    summary: boundedText(1_200),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const researchEvidenceModuleSchema = z
  .object({
    type: z.literal("evidence"),
    variant: z.enum(["stack", "grid", "for-against"]),
    label: boundedText(80),
    items: z
      .array(
        z
          .object({
            title: boundedText(180),
            finding: boundedText(700),
            sourceId: sourceIdSchema,
            stance: z.enum(["support", "challenge", "neutral"]).optional(),
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
    label: boundedText(80),
    items: z
      .array(
        z
          .object({
            date: boundedText(80),
            title: boundedText(180),
            detail: boundedText(500),
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
    selectionRule: "Choose for requested day ranges or changing conditions over time.",
    idealUse: "A multi-day forecast and risk outlook.",
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
  const sourceIds: string[] = [];
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

function expectedRecipeForPrompt(
  prompt: string | undefined,
  kind: SurfacePlan["kind"],
  weatherBacked = false,
): SurfacePlan["recipeId"] | undefined {
  if (!prompt?.trim()) return undefined;
  const normalized = prompt.toLocaleLowerCase("en-US");

  if (kind === "weather") {
    if (
      /\b(when should|best time|best window|should i|safe to|can i|walk|run|hike|ride|activity|outdoor plan)\b/.test(
        normalized,
      )
    ) {
      return "weather.decision";
    }
    if (
      /\b(outlook|forecast|through|until|next week|this week|weekend|tomorrow|\d+\s*[- ]?days?)\b/.test(
        normalized,
      )
    ) {
      return "weather.outlook";
    }
    return "weather.snapshot";
  }

  if (kind === "comparison") {
    if (
      /\b(trend|over time|timeline|history|growth|adoption|across (?:the )?(?:last|next)|\d+\s*(?:days?|weeks?|months?|years?|releases?))\b/.test(normalized) ||
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
  const normalized = prompt.toLocaleLowerCase("en-US");
  const explicit =
    normalized.match(/(?:criteria(?:\s+(?:are|of))?)\s*[:-]?\s*([^?.]+)/)?.[1] ??
    normalized.match(/(?:^|\s)(?:on|by|across)\s+([^?.]+)/)?.[1];
  const criteriaText = explicit?.replace(
    /\b(?:then\s+)?(?:and\s+)?(?:tell me|which|recommend|choose|decide)\b.*$/,
    "",
  );
  const candidates = criteriaText
    ? criteriaText.split(/,|\band\b|\bversus\b|\bvs\.?\b/)
    : [];
  const cleaned = candidates
    .map((value) => value.replace(/^(?:the|their|its)\s+/, "").trim())
    .filter((value) => value.length >= 2 && value.length <= 48)
    .slice(0, 6);
  if (cleaned.length >= 2) return [...new Set(cleaned)];

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
  const normalized = prompt.toLocaleLowerCase("en-US");
  const expression = unit === "hour"
    ? /\b(?:next\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?hours?\b/
    : /\b(?:next\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?days?\b/;
  const numeric = expression.exec(normalized);
  if (numeric) {
    const wordNumbers: Readonly<Record<string, number>> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    return wordNumbers[numeric[1]] ?? Number(numeric[1]);
  }
  if (unit === "day") {
    if (/\b(?:next|this) week\b/.test(normalized)) return 7;
    if (/\btoday\s+(?:and|through)\s+tomorrow\b/.test(normalized)) return 2;
  }
  return undefined;
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
  if (requested.size === 0) return [];

  const indexes: number[] = [];
  state.locations[0].daily.forEach((day, index) => {
    const parsed = new Date(`${day.date}T12:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return;
    const weekday = weekdayNames[parsed.getUTCDay()];
    if (requested.has(weekday)) indexes.push(index);
  });
  return indexes.length >= requested.size ? indexes : [...indexes, -1];
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
  if (!activity && localMinutes === undefined && !weekday && requestedDayOffset === undefined) return [];

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
    const describedActivity = `${window.activity ?? ""} ${window.label}`.toLocaleLowerCase("en-US");
    if (activity && !describedActivity.includes(activity)) {
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

const WEATHER_QUANTITATIVE_TOKEN_SOURCE = String.raw`\b\d{1,2}:[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)?\b|-?\d+(?:\.\d+)?\s*(?:°\s*[fc]?|degrees?\s*[fc]?|%|mph\b|km\/h\b|mi\b|km\b)|-?\d+(?:\.\d+)?\s*[- ](?:hours?|days?|locations?|cities?)\b|-?\d+(?:\.\d+)?`;

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
      } else if (/^\d{1,2}:[0-5]\d/i.test(token.trim())) {
        issues.push(`Weather comparison narrative contains a model-authored time: ${token}.`);
      } else {
        issues.push(`Weather comparison narrative contains an ungrounded numeric claim: ${token}.`);
      }
      continue;
    }

    if (trustedTokens.has(normalizedQuantitativeToken(token))) continue;
    const time = /^(\d{1,2}):([0-5]\d)\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(token.trim());
    if (time) {
      let hour = Number(time[1]);
      if (time[3]) {
        hour %= 12;
        if (time[3].toLocaleLowerCase("en-US").startsWith("p")) hour += 12;
      }
      const minutes = hour * 60 + Number(time[2]);
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
  locationIndex: number,
  state: WeatherState,
  plan: SurfacePlan,
): string {
  if (quantitativeTokens(value).length === 0) return value;
  const counts = new Set<number>([state.locations.length]);
  for (const module of plan.modules) {
    if (module.type === "hourly") counts.add(module.hourIndexes.length);
    else if (module.type === "daily") counts.add(module.dayIndexes.length);
    else if (module.type === "recommendation" && "activityWindowIndex" in module) {
      const window = state.activityWindows[module.activityWindowIndex];
      if (window?.durationHours) counts.add(window.durationHours);
    }
  }
  const issues = weatherNarrativeFieldIssues(
    { text: value, policy: "validate-weather", locationIndex },
    state,
    counts,
  );
  return issues.length === 0 ? value : fallback;
}

function includesInitialRange(indexes: readonly number[], count: number): boolean {
  const values = new Set(indexes);
  for (let index = 0; index < count; index += 1) {
    if (!values.has(index)) return false;
  }
  return true;
}

function parseNumericCell(value: string): number | undefined {
  const parsed = Number.parseFloat(value.replace(/[^0-9+-.]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
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
        series.values.every((value, valueIndex) => parseNumericCell(row[valueIndex + 1] ?? "") === value)
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
          (series, seriesIndex) => parseNumericCell(row[seriesIndex + 1] ?? "") === series.values[labelIndex],
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
): number {
  if (forecastKind === "hourly") {
    const timestamp = anchor.hourly[anchorIndex]?.startTime;
    return timestamp
      ? location.hourly.findIndex((item) => item.startTime === timestamp)
      : -1;
  }
  const date = anchor.daily[anchorIndex]?.date;
  return date ? location.daily.findIndex((item) => item.date === date) : -1;
}

function validateWeatherForecastReferences(
  module: WeatherComparisonTableModule | WeatherComparisonChartModule,
  state: WeatherState,
  issues: string[],
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
      const alignedIndex = alignedForecastIndex(anchor, location, module.forecastKind, index);
      const forecast = alignedIndex < 0
        ? undefined
        : module.forecastKind === "hourly"
          ? location.hourly[alignedIndex]
          : location.daily[alignedIndex];
      if (!forecast) {
        issues.push(
          `${module.forecastKind} comparison evidence index ${index} has no date-aligned record for location ${locationIndex}.`,
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
  const segments: string[] = [];
  const score = /\b(?:score|rank)\s+(.+?)\s+(?:for|on|by|across|using)\b/i.exec(prompt)?.[1];
  if (score) segments.push(score);
  const chart = /\bchart\b.+?\bfor\s+(.+?)(?:\s+(?:on|this|next|over)\b|[?.]|$)/i.exec(prompt)?.[1];
  if (chart) segments.push(chart);
  const compare = /\bcompare\s+(.+?)(?:\s+(?:for|on|this|next|over|across)\b|[?.]|$)/i.exec(prompt)?.[1];
  if (compare) segments.push(compare.replace(/^.*\bin\s+/i, ""));

  const locations = segments.flatMap((segment) =>
    segment.split(/,|\band\b/i).map((part) =>
      part
        .replace(/^\s*(?:the|a|an)\s+/i, "")
        .replace(
          /\s+(?:weather|temperatures?|conditions?|forecasts?|highs?|lows?|rain(?:fall)?|snow(?:fall)?)(?:\s+.*)?$/i,
          "",
        )
        .trim(),
    ),
  );
  return [...new Set(locations.filter((value) => /^[A-Za-z][A-Za-z .'-]{1,79}$/.test(value)))];
}

function evidenceLocationIndex(state: WeatherState, requested: string): number {
  const normalizedRequested = normalizeLocationLabel(requested);
  const requestedCity = normalizedRequested.split(" ")[0] ?? normalizedRequested;
  return state.locations.findIndex((location) => {
    const normalizedEvidence = normalizeLocationLabel(location.location.name);
    const evidenceCity = normalizedEvidence.split(" ")[0] ?? normalizedEvidence;
    return (
      normalizedEvidence.includes(normalizedRequested) ||
      normalizedRequested.includes(normalizedEvidence) ||
      evidenceCity === requestedCity
    );
  });
}

function requestedLocationCoverageIssues(
  plan: SurfacePlan,
  context: SurfacePlanValidationContext,
  state: WeatherState,
): string[] {
  if (state.locations.length === 0) return [];
  const requested = new Set<string>(requestedPromptLocations(context.prompt));
  for (const record of context.evidence) {
    for (const location of [record.arguments.location, ...(record.arguments.locations ?? [])]) {
      if (location) requested.add(location);
    }
  }
  const coveredIndexes = new Set(referencedLocationIndexes(plan));
  const issues: string[] = [];
  for (const label of requested) {
    const index = evidenceLocationIndex(state, label);
    if (index < 0) {
      issues.push(`Requested weather location is missing from evidence: ${label}.`);
    } else if (!coveredIndexes.has(index)) {
      issues.push(`Requested weather location is missing from the surface: ${label}.`);
    }
  }
  return issues;
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

  const expectedUnit = /\b(celsius|metric|°c)\b/i.test(context.prompt ?? "")
    ? "C"
    : /\b(fahrenheit|imperial|°f)\b/i.test(context.prompt ?? "")
      ? "F"
      : context.clientContext?.units === "metric"
        ? "C"
        : context.clientContext?.units === "imperial"
          ? "F"
          : undefined;
  for (const index of coveredLocations) {
    const location = state.locations[index];
    if (location && expectedUnit && location.current.temperatureUnit !== expectedUnit) {
      issues.push(`Requested unit ${expectedUnit} is not covered for location index ${index}.`);
    }
  }

  const requestedHours = requestedRange(context.prompt, "hour");
  const requestedDays = requestedDayCount(context.prompt, state);
  const requestedNamedDays = requestedSpecificDayIndexes(context.prompt, state);
  if (requestedHours) validateRequestedForecastRange(plan, "hourly", requestedHours, state, issues);
  if (requestedDays) validateRequestedForecastRange(plan, "daily", requestedDays, state, issues);
  validateRequestedSpecificDays(plan, requestedNamedDays, state, issues);
  issues.push(...activityRecommendationCoverageIssues(plan, context, state));

  if (plan.kind === "comparison" && context.prompt) {
    const searchablePlan = JSON.stringify(plan.modules).toLocaleLowerCase("en-US");
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
): Readonly<Record<EvaluatedSurfacePlanQualityCode, boolean>> {
  const moduleTypes = plan.modules.map((module) => module.type);
  const primary = plan.kind === "weather" ? "hero" : plan.kind === "comparison" ? "summary" : "lead";
  const sourceIndexes = moduleTypes.flatMap((type, index) => (type === "sources" ? [index] : []));
  const recipe = SURFACE_RECIPES[plan.recipeId];
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
  const budget = plan.density === "brief" ? 6 : plan.density === "balanced" ? 9 : 12;

  return Object.freeze({
    recipe_fit:
      moduleTypes.includes(recipe.requiredModule) &&
      (expectedRecipe === undefined || plan.recipeId === expectedRecipe),
    answer_first: moduleTypes[0] === primary,
    sources_last: sourceIndexes.length === 1 && sourceIndexes[0] === moduleTypes.length - 1,
    requested_coverage: requestedCoverageIssues(plan, context, state).length === 0,
    duplicate_primary: moduleTypes.filter((type) => type === primary).length === 1,
    chart_table_alignment:
      plan.kind !== "comparison" || comparisonChartTableAligned(plan),
    citation_coverage: citationCoverage,
    content_budget:
      plan.modules.length <= budget && estimatedCompiledNodeCount(plan) <= LIMITS.surfaceNodes,
  });
}

export function validateSurfacePlan(
  input: unknown,
  context: SurfacePlanValidationContext,
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
  const recipe = SURFACE_RECIPES[plan.recipeId];
  const moduleTypes = plan.modules.map((module) => module.type);
  const compatibleModules = new Set<string>(recipe.compatibleModules);
  for (const moduleType of moduleTypes) {
    if (!compatibleModules.has(moduleType)) {
      issues.push(`Module ${moduleType} is incompatible with recipe ${plan.recipeId}.`);
    }
  }
  if (!moduleTypes.includes(recipe.requiredModule)) {
    issues.push(`Recipe ${plan.recipeId} requires a ${recipe.requiredModule} module.`);
  }

  const primaryType = plan.kind === "weather" ? "hero" : plan.kind === "comparison" ? "summary" : "lead";
  if (!moduleTypes.includes(primaryType)) {
    issues.push(`Recipe ${plan.recipeId} requires an answer-first ${primaryType} module.`);
  }
  if (moduleTypes.filter((type) => type === primaryType).length > 1) {
    issues.push(`Recipe ${plan.recipeId} cannot contain competing primary modules.`);
  }

  if (moduleTypes[0] !== primaryType) {
    issues.push(`Recipe ${plan.recipeId} must place its answer-first ${primaryType} module first.`);
  }

  const expectedRecipe = expectedRecipeForPrompt(
    context.prompt,
    plan.kind,
    context.evidence.length > 0,
  );
  if (expectedRecipe && plan.recipeId !== expectedRecipe) {
    issues.push(`Recipe ${plan.recipeId} does not fit the requested ${expectedRecipe} intent.`);
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
  const expectedUnit = /\b(celsius|metric|°c)\b/i.test(context.prompt ?? "")
    ? "C"
    : /\b(fahrenheit|imperial|°f)\b/i.test(context.prompt ?? "")
      ? "F"
      : context.clientContext?.units === "metric"
        ? "C"
        : context.clientContext?.units === "imperial"
          ? "F"
          : undefined;

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
            const values = location.daily.map((candidate) => {
              if (module.signal === "wettest" || module.signal === "driest") {
                return candidate.precipitationProbability;
              }
              return module.signal === "warmest" ? candidate.high : candidate.low;
            });
            const target = module.signal === "driest" || module.signal === "coolest"
              ? Math.min(...values)
              : Math.max(...values);
            const selected = values[module.dayIndex];
            if (selected !== target) {
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
          validateWeatherForecastReferences(module, state, issues);
        }
      } else if (isWeatherComparisonChart(module)) {
        if (!uniqueValues(module.forecastIndexes)) issues.push("Forecast chart indexes must be unique.");
        validateWeatherForecastReferences(module, state, issues);
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
  timeZone = location.current.timeZone,
  suffix = "",
): string[] {
  return indexes.map((index) => {
    if (kind === "hourly") {
      const item = location.hourly[index];
      if (!item) throw new TypeError("Validated weather comparison evidence is unavailable.");
      return `${formatTime(item.startTime, clientContext, timeZone)}${suffix}`;
    }
    const item = location.daily[index];
    if (!item) throw new TypeError("Validated weather comparison evidence is unavailable.");
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
): number {
  const index = alignedForecastIndex(anchor, location, kind, anchorIndex);
  if (index < 0) throw new TypeError("Validated date-aligned weather comparison evidence is unavailable.");
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
): { timeZone: string; suffix: string } {
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
}: CompileSurfacePlanInput): SurfaceSpec {
  const validation = validateSurfacePlan(plan, {
    sources: retrieval.sources,
    evidence: retrieval.evidence,
  });
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
          module.locationIndex,
          weatherState,
          trustedPlan,
        );
        const safeValue = safeWeatherHeroNarrative(
          module.recommendationValue,
          location.current.conditionText,
          module.locationIndex,
          weatherState,
          trustedPlan,
        );
        const safeDetail = safeWeatherHeroNarrative(
          module.recommendationDetail,
          `Provider-observed conditions for ${location.location.name}.`,
          module.locationIndex,
          weatherState,
          trustedPlan,
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
        body.push({ id: baseId, component: "Rail", children: metricIds, label: "Conditions" });
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
        const items = isWeatherComparisonSummary(module)
          ? module.locationIndexes.map((index) => {
              const location = weatherState.locations[index];
              if (!location) throw new TypeError("Validated weather comparison location is unavailable.");
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
          const axis = weatherComparisonAxis(locations);
          const labels = weatherForecastLabels(
            locations[0],
            forecastKind,
            indexes,
            clientContext,
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
          const axis = weatherComparisonAxis(locations);
          body.push({
            id: baseId,
            component: "ComparisonChart",
            title: module.title,
            labels: weatherForecastLabels(
              locations[0],
              module.forecastKind,
              module.forecastIndexes,
              clientContext,
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

function limited(value: string, maximum: number, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, maximum).trim() || fallback;
}

function comparisonLabels(prompt: string): readonly [string, string] {
  const normalized = prompt.trim().replace(/[?.!]+$/, "");
  const match = normalized.match(
    /(?:compare\s+)?(.+?)\s+(?:and|vs\.?|versus)\s+(.+)$/i,
  );
  if (!match) return ["First option", "Second option"];
  return [
    limited(match[1], 120, "First option"),
    limited(match[2], 120, "Second option"),
  ];
}

export function buildFallbackSurfacePlan({
  kind,
  prompt,
  retrieval,
}: BuildFallbackSurfacePlanInput): SurfacePlan {
  const sourceIds = retrieval.sources.slice(0, LIMITS.sources).map((source) => source.id);
  if (sourceIds.length === 0) {
    throw new TypeError(`${kind} fallback requires at least one issued source.`);
  }

  if (kind === "weather") {
    const state = readWeatherState(retrieval.evidence);
    const location = state.locations[0];
    if (!location) throw new TypeError("A weather fallback requires normalized weather evidence.");
    const modules: Array<z.infer<typeof weatherModuleSchema>> = [
      {
        type: "hero",
        variant: "snapshot",
        locationIndex: 0,
        recommendationLabel: "Current conditions",
        recommendationValue: location.current.conditionText,
        recommendationDetail: `Provider-observed conditions for ${location.location.name}.`,
      },
    ];
    for (let locationIndex = 0; locationIndex < state.locations.length; locationIndex += 1) {
      modules.push({
        type: "metrics",
        locationIndex,
        metrics: ["feelsLike", "humidity", "wind", "precipitation"],
      });
    }
    modules.push({ type: "sources", label: "Weather source", sourceIds });
    return SurfacePlanSchema.parse({
      kind: "weather",
      recipeId: "weather.snapshot",
      density: "brief",
      emphasis: "answer",
      modules,
    });
  }

  if (kind === "comparison") {
    const state = readWeatherState(retrieval.evidence);
    if (state.locations.length >= 2) {
      const locationIndexes = state.locations.map((_, index) => index);
      return SurfacePlanSchema.parse({
        kind: "comparison",
        recipeId: "comparison.verdict",
        density: "brief",
        emphasis: "decision",
        modules: [
          {
            type: "summary",
            variant: "verdict",
            title: "Weather comparison",
            recommendation: "Provider-observed conditions are shown side by side without a generated winner.",
            locationIndexes,
            sourceIds,
          },
          {
            type: "table",
            caption: "Current conditions",
            locationIndexes,
            forecastKind: "current",
            metrics: ["temperature", "feelsLike", "precipitation", "wind"],
            sourceIds,
          },
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
    return SurfacePlanSchema.parse({
      kind: "comparison",
      recipeId: "comparison.verdict",
      density: "brief",
      emphasis: "decision",
      modules: [
        {
          type: "summary",
          variant: "verdict",
          title: limited(`${first} compared with ${second}`, 180, "Comparison verdict"),
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
        },
        { type: "sources", label: "Sources", sourceIds },
      ],
    });
  }

  return SurfacePlanSchema.parse({
    kind: "research",
    recipeId: "research.brief",
    density: "brief",
    emphasis: "answer",
    modules: [
      {
        type: "lead",
        variant: "brief",
        title: limited(prompt, 220, "Research brief"),
        summary: limited(retrieval.outputText, 1_200, "The available sources provide a bounded research answer."),
        sourceIds,
      },
      { type: "sources", label: "Sources", sourceIds },
    ],
  });
}
