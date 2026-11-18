import { z } from "zod";
import { A2UI_VERSION, CATALOG_IDS, LIMITS, TRUSTED_COMPONENT_NAMES } from "./constants.js";
import {
  BADGE_TONES,
  CALLOUT_TONES,
  CARD_VARIANTS,
  CHART_VARIANTS,
  COLUMN_SPANS,
  DIVIDER_STYLES,
  GRID_COLUMNS,
  LAYOUT_GAPS,
  RANK_ORDERS,
  SECTION_ROLES,
  SECTION_WIDTHS,
  SPLIT_RATIOS,
  STACK_ALIGNMENTS,
  SURFACE_ICONS,
  SURFACE_PROMINENCE,
  SURFACE_TONES,
  TREND_DIRECTIONS,
} from "./layout-tokens.js";
import { chartShapeIssues } from "./chart-shape.js";
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

export const SurfaceRecipeIdSchema = z.enum([
  "weather.snapshot",
  "weather.decision",
  "weather.outlook",
  "comparison.verdict",
  "comparison.scorecard",
  "comparison.trend",
  "research.brief",
  "research.timeline",
  "research.claims",
]);

export const SurfaceDensitySchema = z.enum(["brief", "balanced", "detailed"]);
export const SurfaceEmphasisSchema = z.enum([
  "answer",
  "decision",
  "trend",
  "evidence",
  "risk",
  "exploration",
]);

const nodeBase = {
  id: idSchema,
};

const children = z.array(idSchema).min(1).max(20);

export const SurfaceFrameNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("SurfaceFrame"),
    children,
    recipeId: SurfaceRecipeIdSchema.optional(),
    compositionMode: z.enum(["plan-v2", "grammar-v3"]).optional(),
    archetypeHint: SurfaceRecipeIdSchema.optional(),
    density: SurfaceDensitySchema,
    emphasis: SurfaceEmphasisSchema,
  })
  .strict();

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
    ratio: z.enum(SPLIT_RATIOS).default("equal"),
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
    style: z.enum(DIVIDER_STYLES).optional(),
  })
  .strict();

export const StackNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Stack"),
    children,
    gap: z.enum(LAYOUT_GAPS),
    align: z.enum(STACK_ALIGNMENTS),
  })
  .strict();

export const GridNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Grid"),
    children,
    columns: z.enum(GRID_COLUMNS),
    gap: z.enum(LAYOUT_GAPS),
  })
  .strict();

export const SectionNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Section"),
    children,
    label: z.string().trim().max(80).optional(),
    role: z.enum(SECTION_ROLES),
    tone: z.enum(SURFACE_TONES),
    prominence: z.enum(SURFACE_PROMINENCE),
    width: z.enum(SECTION_WIDTHS).optional(),
    icon: z.enum(SURFACE_ICONS).optional(),
  })
  .strict();

export const CardNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Card"),
    children: z.array(idSchema).min(1).max(8),
    tone: z.enum(SURFACE_TONES),
    prominence: z.enum(SURFACE_PROMINENCE),
    variant: z.enum(CARD_VARIANTS).optional(),
    icon: z.enum(SURFACE_ICONS).optional(),
    label: z.string().trim().max(80).optional(),
  })
  .strict();

export const TabsNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Tabs"),
    children: z.array(idSchema).min(2).max(4),
    labels: z.array(boundedText(40)).min(2).max(4),
    defaultIndex: z.number().int().min(0).max(3),
  })
  .strict();

export const DisclosureNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Disclosure"),
    children: z.array(idSchema).min(1).max(4),
    label: boundedText(80),
    defaultOpen: z.boolean(),
  })
  .strict();

export const AccordionNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Accordion"),
    children: z.array(idSchema).min(2).max(5),
    labels: z.array(boundedText(60)).min(2).max(5),
    defaultOpenIndex: z.number().int().min(0).max(4).optional(),
  })
  .strict();

export const ScrollerNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Scroller"),
    children: z.array(idSchema).min(2).max(8),
    label: boundedText(80),
  })
  .strict();

export const ColumnsNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Columns"),
    children: z.array(idSchema).min(2).max(6),
    spans: z.array(z.enum(COLUMN_SPANS)).min(2).max(6),
    gap: z.enum(LAYOUT_GAPS),
  })
  .strict();

export const AsideNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Aside"),
    children: z.array(idSchema).length(2),
    side: z.enum(["start", "end"]),
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
    variant: z.enum(["snapshot", "decision"]).optional(),
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
    items: z.array(hourlyItemSchema).min(1).max(24),
    variant: z.enum(["strip", "chart"]).optional(),
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
    variant: z.enum(["cards", "table"]).optional(),
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
    variant: z.enum(["verdict", "balanced"]).optional(),
  })
  .strict();

export const ComparisonTableNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("ComparisonTable"),
    caption: boundedText(160),
    columns: z.array(boundedText(80)).min(2).max(6),
    rows: z.array(z.array(z.string().trim().max(160)).min(2).max(6)).min(1).max(24),
  })
  .strict();

const chartSeriesSchema = z
  .object({
    label: boundedText(80),
    values: z.array(z.number().finite()).min(2).max(24),
  })
  .strict();

export const ComparisonChartNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("ComparisonChart"),
    title: boundedText(160),
    labels: z.array(boundedText(60)).min(2).max(24),
    series: z.array(chartSeriesSchema).min(1).max(4),
    unit: z.string().trim().max(24).optional(),
    variant: z.enum(CHART_VARIANTS).optional(),
  })
  .strict();

export const ResearchLeadNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("ResearchLead"),
    title: boundedText(220),
    summary: boundedText(1_200),
    sourceIds: z.array(sourceIdSchema).min(1).max(LIMITS.sources),
    variant: z.enum(["feature", "brief"]).optional(),
  })
  .strict();

const evidenceItemSchema = z
  .object({
    title: boundedText(180),
    finding: boundedText(700),
    sourceId: sourceIdSchema,
    stance: z.enum(["support", "challenge", "neutral"]).optional(),
  })
  .strict();

export const EvidenceListNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("EvidenceList"),
    label: boundedText(80).default("Evidence"),
    items: z.array(evidenceItemSchema).min(1).max(8),
    variant: z.enum(["stack", "grid", "for-against"]).optional(),
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

const citedSourceIds = z.array(sourceIdSchema).min(1).max(LIMITS.sources);

const keyFactSchema = z
  .object({
    label: boundedText(60),
    value: boundedText(40),
    detail: z.string().trim().max(160).optional(),
    trend: z.enum(TREND_DIRECTIONS).optional(),
    sparkline: z.array(z.number().finite()).min(3).max(12).optional(),
  })
  .strict();

export const KeyFactsNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("KeyFacts"),
    label: z.string().trim().max(80).optional(),
    facts: z.array(keyFactSchema).min(2).max(6),
    sourceIds: citedSourceIds,
  })
  .strict();

export const CalloutNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("Callout"),
    tone: z.enum(CALLOUT_TONES),
    icon: z.enum(SURFACE_ICONS).optional(),
    title: boundedText(120),
    body: boundedText(500),
    sourceIds: citedSourceIds,
  })
  .strict();

const citedPointSchema = z
  .object({
    text: boundedText(240),
    sourceId: sourceIdSchema,
  })
  .strict();

export const ProsConsNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("ProsCons"),
    subject: boundedText(120),
    pros: z.array(citedPointSchema).min(1).max(5),
    cons: z.array(citedPointSchema).min(1).max(5),
  })
  .strict();

const rankedItemSchema = z
  .object({
    title: boundedText(120),
    detail: boundedText(320),
    score: z.string().trim().max(24).optional(),
    sourceId: sourceIdSchema,
  })
  .strict();

export const RankedListNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("RankedList"),
    label: boundedText(80),
    order: z.enum(RANK_ORDERS),
    items: z.array(rankedItemSchema).min(2).max(8),
  })
  .strict();

const meterSchema = z
  .object({
    label: boundedText(60),
    value: z.number().finite(),
    min: z.number().finite(),
    max: z.number().finite(),
    unit: z.string().trim().max(16).optional(),
  })
  .strict()
  .refine((meter) => meter.min < meter.max && meter.value >= meter.min && meter.value <= meter.max, {
    message: "Meter values must fall within an increasing min/max range.",
  });

export const ScoreMeterNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("ScoreMeter"),
    label: z.string().trim().max(80).optional(),
    meters: z.array(meterSchema).min(1).max(4),
    sourceIds: citedSourceIds,
  })
  .strict();

export const PullQuoteNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("PullQuote"),
    text: boundedText(280),
    attribution: boundedText(120),
    sourceId: sourceIdSchema,
  })
  .strict();

const badgeSchema = z
  .object({
    label: boundedText(24),
    tone: z.enum(BADGE_TONES),
  })
  .strict();

export const BadgeRowNodeSchema = z
  .object({
    ...nodeBase,
    component: z.literal("BadgeRow"),
    label: z.string().trim().max(80).optional(),
    badges: z.array(badgeSchema).min(1).max(8),
    sourceIds: citedSourceIds,
  })
  .strict();

export const SurfaceNodeSchema = z.discriminatedUnion("component", [
  SurfaceFrameNodeSchema,
  EditorialHeadingNodeSchema,
  TextBlockNodeSchema,
  MetricNodeSchema,
  BandNodeSchema,
  SplitNodeSchema,
  RailNodeSchema,
  DividerNodeSchema,
  StackNodeSchema,
  GridNodeSchema,
  SectionNodeSchema,
  CardNodeSchema,
  TabsNodeSchema,
  DisclosureNodeSchema,
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
  AccordionNodeSchema,
  ScrollerNodeSchema,
  ColumnsNodeSchema,
  AsideNodeSchema,
  KeyFactsNodeSchema,
  CalloutNodeSchema,
  ProsConsNodeSchema,
  RankedListNodeSchema,
  ScoreMeterNodeSchema,
  PullQuoteNodeSchema,
  BadgeRowNodeSchema,
]);

export const SurfaceSpecSchema = z
  .object({
    kind: z.enum(["weather", "comparison", "research", "narrative", "location"]),
    rootId: idSchema,
    components: z.array(SurfaceNodeSchema).min(1).max(LIMITS.surfaceNodes),
  })
  .strict()
  .superRefine((spec, context) => {
    spec.components.forEach((component, componentIndex) => {
      if (component.component === "ComparisonTable") {
        component.rows.forEach((row, rowIndex) => {
          if (row.length === component.columns.length) return;
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["components", componentIndex, "rows", rowIndex],
            message: "Comparison table rows must match the column count.",
          });
        });
      }

      if (component.component === "ComparisonChart") {
        component.series.forEach((series, seriesIndex) => {
          if (series.values.length === component.labels.length) return;
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["components", componentIndex, "series", seriesIndex, "values"],
            message: "Comparison chart series values must match the label count.",
          });
        });
        for (const message of chartShapeIssues(component)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["components", componentIndex, "series"],
            message,
          });
        }
      }

      if (component.component === "Accordion") {
        if (component.labels.length !== component.children.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["components", componentIndex, "labels"],
            message: "Accordion labels must match the panel child count.",
          });
        }
        if (
          component.defaultOpenIndex !== undefined &&
          component.defaultOpenIndex >= component.children.length
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["components", componentIndex, "defaultOpenIndex"],
            message: "The default accordion panel must reference an available child.",
          });
        }
      }

      if (component.component === "Columns" && component.spans.length !== component.children.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["components", componentIndex, "spans"],
          message: "Column spans must match the column child count.",
        });
      }

      if (component.component === "Tabs") {
        if (component.labels.length !== component.children.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["components", componentIndex, "labels"],
            message: "Tab labels must match the tab child count.",
          });
        }
        if (component.defaultIndex >= component.children.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["components", componentIndex, "defaultIndex"],
            message: "The default tab must reference an available child.",
          });
        }
      }
    });
  });

export const A2uiMessageSchema = z.union([
  z.object({
    version: z.literal(A2UI_VERSION),
    createSurface: z.object({
      surfaceId: z.string().min(1).max(80),
      catalogId: z.enum(CATALOG_IDS),
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
    recipeId: SurfaceRecipeIdSchema.optional(),
    density: SurfaceDensitySchema.optional(),
    emphasis: SurfaceEmphasisSchema.optional(),
    qualityChecks: z
      .array(
        z
          .object({
            code: z.enum([
              "recipe_fit",
              "graph_integrity",
              "answer_first",
              "sources_last",
              "sources_visible",
              "requested_coverage",
              "duplicate_primary",
              "chart_table_alignment",
              "citation_coverage",
              "content_budget",
            ]),
            passed: z.boolean(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    repairCategory: z.enum(["none", "semantic"]).optional(),
    compilerResult: z.enum(["compiled", "deterministic-fallback"]).optional(),
    compositionMode: z.enum(["plan-v2", "grammar-v3"]).optional(),
    layoutFamily: z.enum([
      "stack",
      "grid",
      "split",
      "section",
      "card",
      "rail",
      "tabs",
      "disclosure",
      "divider",
      "plan-v2-fallback",
      "unknown",
    ]).optional(),
    contentNodeCount: z.number().int().min(0).max(12).optional(),
    layoutNodeCount: z.number().int().min(0).max(8).optional(),
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
      "PROVIDER_LIMIT",
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
export type SurfaceRecipeId = z.infer<typeof SurfaceRecipeIdSchema>;
export type SurfaceDensity = z.infer<typeof SurfaceDensitySchema>;
export type SurfaceEmphasis = z.infer<typeof SurfaceEmphasisSchema>;
export type SurfaceNode = z.infer<typeof SurfaceNodeSchema>;
export type SurfaceSpec = z.infer<typeof SurfaceSpecSchema>;
export type A2uiMessage = z.infer<typeof A2uiMessageSchema>;
export type TraceRecord = z.infer<typeof TraceRecordSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
