import { z } from "zod";
import { A2UI_VERSION, CATALOG_ID, LIMITS, TRUSTED_COMPONENT_NAMES } from "./constants.js";
import { isSafeExternalHttpsUrl } from "./safe-url.js";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const sourceIdSchema = z.string().regex(/^src_[a-z0-9]{6,32}$/);

export const SizeClassSchema = z.enum(["compact", "medium", "expanded"]);
export const UnitsSchema = z.enum(["imperial", "metric"]);

export const ClientContextSchema = z
  .object({
    sizeClass: SizeClassSchema,
    locale: z.string().min(2).max(35),
    timeZone: z.string().min(1).max(80),
    units: UnitsSchema,
    reducedMotion: z.boolean(),
    coordinates: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        permission: z.literal("granted"),
      })
      .strict()
      .optional(),
  })
  .strict();

export const AgentRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(LIMITS.promptCharacters),
    contextToken: z.string().min(32).max(8_192).optional(),
    client: ClientContextSchema,
  })
  .strict();

export const SourceRecordSchema = z
  .object({
    id: sourceIdSchema,
    title: boundedText(240),
    url: z.string().url().refine(isSafeExternalHttpsUrl, "A public HTTPS URL is required"),
    provider: z.enum(["google-search", "google-weather", "google-geocoding"]),
    accessedAt: z.string().datetime(),
    snippet: z.string().trim().max(600).optional(),
  })
  .strict();

export const WeatherConditionSchema = z.enum([
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

const nodeBase = {
  id: idSchema,
};

const children = z.array(idSchema).min(1).max(20);

export const EditorialHeadingNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("EditorialHeading"),
    text: boundedText(220),
    level: z.enum(["h1", "h2", "h3"]).default("h2"),
    align: z.enum(["start", "center"]).default("start"),
  })
  .strict();

export const TextBlockNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("TextBlock"),
    text: boundedText(2_000),
    tone: z.enum(["default", "muted", "bounded"]).default("default"),
  })
  .strict();

export const MetricNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Metric"),
    label: boundedText(80),
    value: boundedText(80),
    detail: z.string().trim().max(180).optional(),
    accent: z.enum(["blue", "coral", "neutral"]).default("neutral"),
  })
  .strict();

export const BandNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Band"),
    children,
    tone: z.enum(["plain", "sky", "coral", "muted"]).default("plain"),
    label: z.string().trim().max(80).optional(),
  })
  .strict();

export const SplitNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Split"),
    children: z.array(idSchema).min(2).max(3),
    ratio: z.enum(["equal", "wide-start", "wide-end"]).default("equal"),
  })
  .strict();

export const RailNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Rail"),
    children,
    label: z.string().trim().max(80).optional(),
  })
  .strict();

export const DividerNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Divider"),
    label: z.string().trim().max(80).optional(),
  })
  .strict();

export const WeatherHeroNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("WeatherHero"),
    location: boundedText(120),
    dateLabel: boundedText(80),
    temperature: z.number().min(-150).max(150),
    unit: z.enum(["F", "C"]),
    condition: boundedText(80),
    conditionKey: WeatherConditionSchema,
    recommendationLabel: boundedText(80),
    recommendationValue: boundedText(120),
    recommendationDetail: boundedText(240),
  })
  .strict();

export const RecommendationBandNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("RecommendationBand"),
    label: boundedText(80),
    value: boundedText(160),
    detail: boundedText(320),
    confidence: z.enum(["high", "medium", "low"]).default("medium"),
  })
  .strict();

const hourlyItemSchema = z
  .object({
    time: boundedText(40),
    temperature: z.number().min(-150).max(150),
    precipitationProbability: z.number().min(0).max(100),
    condition: WeatherConditionSchema,
  })
  .strict();

export const HourlyForecastNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("HourlyForecast"),
    label: boundedText(80).default("Hourly"),
    unit: z.enum(["F", "C"]),
    items: z.array(hourlyItemSchema).min(2).max(24),
  })
  .strict();

const dailyItemSchema = z
  .object({
    date: boundedText(60),
    high: z.number().min(-150).max(150),
    low: z.number().min(-150).max(150),
    precipitationProbability: z.number().min(0).max(100),
    condition: WeatherConditionSchema,
  })
  .strict();

export const DailyForecastNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("DailyForecast"),
    label: boundedText(80).default("Outlook"),
    unit: z.enum(["F", "C"]),
    items: z.array(dailyItemSchema).min(1).max(10),
  })
  .strict();

export const WeatherAlertNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("WeatherAlert"),
    title: boundedText(160),
    severity: z.enum(["minor", "moderate", "severe", "extreme"]),
    description: boundedText(700),
    sourceId: sourceIdSchema.optional(),
  })
  .strict();

export const LocationPromptNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("LocationPrompt"),
    message: boundedText(300),
    suggestions: z.array(boundedText(120)).max(LIMITS.locations).default([]),
  })
  .strict();

const comparisonItemSchema = z
  .object({
    label: boundedText(120),
    value: boundedText(120),
    detail: z.string().trim().max(220).optional(),
    recommended: z.boolean().default(false),
  })
  .strict();

export const ComparisonSummaryNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("ComparisonSummary"),
    title: boundedText(180),
    recommendation: boundedText(400),
    items: z.array(comparisonItemSchema).min(2).max(4),
  })
  .strict();

export const ComparisonTableNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("ComparisonTable"),
    caption: boundedText(160),
    columns: z.array(boundedText(80)).min(2).max(6),
    rows: z.array(z.array(z.string().trim().max(160)).min(2).max(6)).min(1).max(12),
  })
  .strict();

const chartSeriesSchema = z
  .object({
    label: boundedText(80),
    values: z.array(z.number().finite()).min(2).max(12),
  })
  .strict();

export const ComparisonChartNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("ComparisonChart"),
    title: boundedText(160),
    labels: z.array(boundedText(60)).min(2).max(12),
    series: z.array(chartSeriesSchema).min(1).max(4),
    unit: z.string().trim().max(24).optional(),
  })
  .strict();

export const ResearchLeadNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("ResearchLead"),
    title: boundedText(220),
    summary: boundedText(1_200),
    sourceIds: z.array(sourceIdSchema).min(1).max(LIMITS.sources),
  })
  .strict();

const evidenceItemSchema = z
  .object({
    title: boundedText(180),
    finding: boundedText(700),
    sourceId: sourceIdSchema,
  })
  .strict();

export const EvidenceListNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("EvidenceList"),
    label: boundedText(80).default("Evidence"),
    items: z.array(evidenceItemSchema).min(1).max(8),
  })
  .strict();

const timelineItemSchema = z
  .object({
    date: boundedText(80),
    title: boundedText(180),
    detail: boundedText(500),
    sourceId: sourceIdSchema.optional(),
  })
  .strict();

export const TimelineNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Timeline"),
    label: boundedText(80).default("Timeline"),
    items: z.array(timelineItemSchema).min(1).max(12),
  })
  .strict();

export const SourceListNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("SourceList"),
    label: boundedText(80).default("Sources"),
    sourceIds: z.array(sourceIdSchema).min(1).max(LIMITS.sources),
  })
  .strict();

export const SurfaceNodeSchema = z.discriminatedUnion("component", [
  EditorialHeadingNodeSchema,
  TextBlockNodeSchema,
  MetricNodeSchema,
  BandNodeSchema,
  SplitNodeSchema,
  RailNodeSchema,
  DividerNodeSchema,
  WeatherHeroNodeSchema,
  RecommendationBandNodeSchema,
  HourlyForecastNodeSchema,
  DailyForecastNodeSchema,
  WeatherAlertNodeSchema,
  LocationPromptNodeSchema,
  ComparisonSummaryNodeSchema,
  ComparisonTableNodeSchema,
  ComparisonChartNodeSchema,
  ResearchLeadNodeSchema,
  EvidenceListNodeSchema,
  TimelineNodeSchema,
  SourceListNodeSchema,
]);

export const SurfaceSpecSchema = z
  .object({
    kind: z.enum(["weather", "comparison", "research", "narrative", "location"]),
    rootId: idSchema,
    components: z.array(SurfaceNodeSchema).min(1).max(LIMITS.surfaceNodes),
  })
  .strict();

export const A2uiMessageSchema = z.union([
  z.object({
    version: z.literal(A2UI_VERSION),
    createSurface: z.object({
      surfaceId: z.string().min(1).max(80),
      catalogId: z.literal(CATALOG_ID),
      sendDataModel: z.literal(false).optional(),
    }),
  }),
  z.object({
    version: z.literal(A2UI_VERSION),
    updateDataModel: z.object({
      surfaceId: z.string().min(1).max(80),
      path: z.string().max(200).optional(),
      value: z.unknown().optional(),
    }),
  }),
  z.object({
    version: z.literal(A2UI_VERSION),
    updateComponents: z.object({
      surfaceId: z.string().min(1).max(80),
      components: z.array(z.record(z.unknown())).max(LIMITS.surfaceNodes),
    }),
  }),
]);

export const TraceRecordSchema = z
  .object({
    id: z.string().min(1).max(80),
    stage: z.enum(["request", "model", "tool", "composition", "validation", "render"]),
    label: boundedText(120),
    status: z.enum(["running", "complete", "repaired", "fallback", "error"]),
    durationMs: z.number().int().min(0).max(60_000).optional(),
    toolName: z.enum(["get_weather_bundle", "google_search"]).optional(),
    arguments: z.record(z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
    sourceIds: z.array(sourceIdSchema).max(LIMITS.sources).optional(),
    componentNames: z.array(z.enum(TRUSTED_COMPONENT_NAMES)).max(LIMITS.surfaceNodes).optional(),
    validation: z
      .object({
        valid: z.boolean(),
        repairCount: z.number().int().min(0).max(1),
        issues: z.array(z.string().max(160)).max(8),
      })
      .strict()
      .optional(),
  })
  .strict();

export const StreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    stage: z.enum(["accepted", "understanding", "retrieving", "composing", "validating", "rendering"]),
    message: boundedText(120),
    at: z.string().datetime(),
  }),
  z.object({ type: z.literal("trace"), trace: TraceRecordSchema }),
  z.object({ type: z.literal("a2ui"), message: A2uiMessageSchema }),
  z.object({ type: z.literal("context"), token: z.string().min(32).max(8_192), expiresAt: z.string().datetime() }),
  z.object({
    type: z.literal("error"),
    code: z.enum([
      "INVALID_REQUEST",
      "ORIGIN_REJECTED",
      "RATE_LIMITED",
      "LOCATION_AMBIGUOUS",
      "LOCATION_DENIED",
      "PROVIDER_ERROR",
      "TIMEOUT",
      "STREAM_INTERRUPTED",
      "SAFE_FALLBACK",
    ]),
    message: boundedText(240),
    retryable: z.boolean(),
  }),
  z.object({
    type: z.literal("done"),
    requestId: z.string().uuid(),
    completedAt: z.string().datetime(),
    durationMs: z.number().int().min(0).max(60_000),
    mode: z.enum(["live", "recorded-fixture", "safe-fallback"]),
    componentCount: z.number().int().min(0).max(LIMITS.surfaceNodes),
    sourceCount: z.number().int().min(0).max(LIMITS.sources),
  }),
]);

export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export type ClientContext = z.infer<typeof ClientContextSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type SurfaceNode = z.infer<typeof SurfaceNodeSchema>;
export type SurfaceSpec = z.infer<typeof SurfaceSpecSchema>;
export type A2uiMessage = z.infer<typeof A2uiMessageSchema>;
export type TraceRecord = z.infer<typeof TraceRecordSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
