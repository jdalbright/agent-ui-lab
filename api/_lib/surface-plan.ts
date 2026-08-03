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

const weatherRecommendationModuleSchema = z
  .object({
    type: z.literal("recommendation"),
    locationIndex: indexSchema,
    activityWindowIndex: indexSchema,
  })
  .strict();

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

const weatherModuleSchema = z.discriminatedUnion("type", [
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

const comparisonSummaryModuleSchema = z
  .object({
    type: z.literal("summary"),
    variant: z.enum(["verdict", "balanced"]),
    title: boundedText(180),
    recommendation: boundedText(400),
    items: z.array(comparisonItemSchema).min(2).max(4),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const comparisonTableModuleSchema = z
  .object({
    type: z.literal("table"),
    caption: boundedText(160),
    columns: z.array(boundedText(80)).min(2).max(6),
    rows: z.array(z.array(z.string().trim().max(160)).min(2).max(6)).min(1).max(12),
    sourceIds: sourceIdsSchema,
  })
  .strict();

const comparisonChartModuleSchema = z
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

const comparisonModuleSchema = z.discriminatedUnion("type", [
  comparisonSummaryModuleSchema,
  comparisonTableModuleSchema,
  comparisonChartModuleSchema,
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
    compatibleModules: ["hero", "daily", "hourly", "alerts", "sources"],
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

function planSourceIds(plan: SurfacePlan): string[] {
  const sourceIds: string[] = [];
  for (const module of plan.modules) {
    if ("sourceIds" in module) sourceIds.push(...module.sourceIds);
    if (module.type === "evidence" || module.type === "timeline") {
      for (const item of module.items) sourceIds.push(item.sourceId);
    }
  }
  return sourceIds;
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

  const issuedSourceIds = new Set(context.sources.map((source) => source.id));
  for (const sourceId of planSourceIds(plan)) {
    if (!issuedSourceIds.has(sourceId)) issues.push(`Unknown source reference: ${sourceId}.`);
  }

  if (plan.kind === "weather") {
    const state = readWeatherState(context.evidence);
    issues.push(...state.issues);
    if (state.locations.length === 0) issues.push("Weather plan has no normalized evidence to reference.");

    for (const module of plan.modules) {
      if (module.type === "sources") continue;
      const location = state.locations[module.locationIndex];
      if (!location) {
        issues.push(`Weather evidence location index ${module.locationIndex} is out of range.`);
        continue;
      }

      if (module.type === "hourly") {
        if (!uniqueValues(module.hourIndexes)) {
          issues.push("Hourly evidence references must be unique.");
        }
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
        const window = state.activityWindows[module.activityWindowIndex];
        if (!window) {
          issues.push(
            `Activity-window evidence index ${module.activityWindowIndex} is out of range.`,
          );
        } else if (!locationsMatch(location.location, window.location)) {
          issues.push("Activity-window evidence does not match the referenced location.");
        }
      }

      if (module.type === "metrics" && new Set(module.metrics).size !== module.metrics.length) {
        issues.push("Weather metric references must be unique.");
      }
    }
  }

  if (plan.kind === "comparison") {
    for (const module of plan.modules) {
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
    }
  }

  return issues.length > 0
    ? { success: false, issues: [...new Set(issues)].slice(0, 12) }
    : { success: true, plan };
}

interface CompileSurfacePlanInput {
  plan: SurfacePlan;
  retrieval: GeminiRetrievalResult;
  clientContext: ClientContext;
}

function formatDate(value: string, context: ClientContext): string {
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
      timeZone: context.timeZone,
    }).format(new Date(value));
  } catch {
    return value.slice(0, 60);
  }
}

function formatTime(value: string, context: ClientContext): string {
  try {
    return new Intl.DateTimeFormat(context.locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: context.timeZone,
    }).format(new Date(value));
  } catch {
    return value.slice(11, 16) || value.slice(0, 40);
  }
}

function formatTimeRange(start: string, end: string, context: ClientContext): string {
  return `${formatTime(start, context)}–${formatTime(end, context)}`.slice(0, 160);
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
  const weatherSourceId =
    retrieval.sources.find((source) => source.provider === "google-weather")?.id ??
    retrieval.sources[0]?.id;

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
        roots.push(baseId);
        body.push({
          id: baseId,
          component: "WeatherHero",
          location: location.location.name,
          dateLabel: formatDate(location.current.observedAt, clientContext),
          temperature: location.current.temperature,
          unit: location.current.temperatureUnit,
          condition: location.current.conditionText,
          conditionKey: location.current.conditionKey,
          recommendationLabel: module.recommendationLabel,
          recommendationValue: module.recommendationValue,
          recommendationDetail: module.recommendationDetail,
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
        const window = weatherState.activityWindows[module.activityWindowIndex];
        if (!window) throw new TypeError("Validated activity-window evidence is unavailable.");
        roots.push(baseId);
        body.push({
          id: baseId,
          component: "RecommendationBand",
          label: window.label,
          value: formatTimeRange(window.startTime, window.endTime, clientContext),
          detail: window.detail,
          confidence: window.confidence,
        });
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
              time: formatTime(hour.startTime, clientContext),
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
            ...(weatherSourceId ? { sourceId: weatherSourceId } : {}),
          });
        });
      }
      return;
    }

    if (trustedPlan.kind === "comparison") {
      if (module.type === "summary") {
        roots.push(baseId);
        body.push({
          id: baseId,
          component: "ComparisonSummary",
          title: module.title,
          recommendation: module.recommendation,
          items: module.items.map((item) => ({ ...item })),
          variant: module.variant,
        });
      } else if (module.type === "table") {
        roots.push(baseId);
        body.push({
          id: baseId,
          component: "ComparisonTable",
          caption: module.caption,
          columns: [...module.columns],
          rows: module.rows.map((row) => [...row]),
        });
      } else if (module.type === "chart") {
        roots.push(baseId);
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
      {
        type: "metrics",
        locationIndex: 0,
        metrics: ["feelsLike", "humidity", "wind", "precipitation"],
      },
    ];
    if (sourceIds.length > 0) {
      modules.push({ type: "sources", label: "Weather source", sourceIds });
    }
    return SurfacePlanSchema.parse({
      kind: "weather",
      recipeId: "weather.snapshot",
      density: "brief",
      emphasis: "answer",
      modules,
    });
  }

  if (sourceIds.length === 0) {
    throw new TypeError(`${kind} fallback requires at least one issued source.`);
  }

  if (kind === "comparison") {
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
