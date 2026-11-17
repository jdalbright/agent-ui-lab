import { LIMITS } from "../../shared/constants.js";
import type { TRUSTED_COMPONENT_NAMES } from "../../shared/constants.js";
import type { ClientContext, SourceRecord, SurfaceSpec } from "../../shared/schemas.js";
import {
  SURFACE_CONTENT_BUDGETS,
  evaluateSurfaceContentBudget,
} from "../../shared/surface-content-budget.js";
import { validateSurfaceSpec } from "../../shared/surface-validation.js";
import {
  GeminiProviderError,
  type GeminiClient,
  type GeminiRetrievalResult,
} from "./gemini.js";
import {
  SURFACE_RECIPES,
  SurfacePlanSchema,
  buildFallbackSurfacePlan,
  compileSurfacePlan,
  evaluateSurfacePlanQuality,
  expectedRecipeForPrompt,
  validateSurfacePlan,
  type SurfacePlan,
} from "./surface-plan.js";
import {
  buildWeatherCompositionPayload,
  type WeatherCompositionManifest,
} from "./weather-composition-manifest.js";
import {
  buildResearchChangeFallbackPlan,
  buildResearchChangeManifest,
  researchChangeCoverageIssues,
  type ResearchChangeManifest,
} from "./research-change-manifest.js";
import {
  GENERATIVE_SURFACE_BUDGETS,
  GenerativeSurfacePlanSchema,
  compileGenerativeSurfacePlan,
  evaluateGenerativeSurfacePlanQuality,
  normalizeGenerativePlanIds,
  validateGenerativeSurfacePlan,
  type GenerativeSurfacePlan,
  type GenerativeSurfaceQualityCode,
} from "./generative-surface-plan.js";

type JsonSchema = Record<string, unknown>;
type TrustedComponentName = (typeof TRUSTED_COMPONENT_NAMES)[number];
type CompositionKind = "weather" | "comparison" | "research" | "narrative";

const idSchema: JsonSchema = {
  type: "string",
  description: "A lowercase component ID beginning with a letter, at most 64 characters.",
};

const sourceIdSchema: JsonSchema = {
  type: "string",
  description: "An unchanged source ID from the supplied evidence payload.",
};

const boundedString = (maximum: number): JsonSchema => ({
  type: "string",
  minLength: 1,
  maxLength: maximum,
  description: `Non-empty text of at most ${maximum} characters.`,
});

const optionalBoundedString = (maximum: number): JsonSchema => ({
  type: "string",
  minLength: 0,
  maxLength: maximum,
  description: `Text of at most ${maximum} characters.`,
});

const enumSchema = (values: readonly string[]): JsonSchema => ({
  type: "string",
  enum: [...values],
});

const arraySchema = (items: JsonSchema, minimum: number, maximum: number): JsonSchema => ({
  type: "array",
  items,
  minItems: minimum,
  maxItems: maximum,
});

// Gemini's GA function schema does not support JSON Schema's uniqueItems keyword.
// The server still rejects duplicate references; this instruction makes the
// generation constraint explicit without sending an unsupported keyword.
const uniqueArraySchema = (
  items: JsonSchema,
  minimum: number,
  maximum: number,
): JsonSchema => ({
  ...arraySchema(items, minimum, maximum),
  description: "All array items must be unique and retain their requested order.",
});

const strictObject = (
  properties: Record<string, JsonSchema>,
  required: readonly string[],
): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: [...required],
});

const node = (
  component: (typeof TRUSTED_COMPONENT_NAMES)[number],
  properties: Record<string, JsonSchema>,
  required: readonly string[],
): JsonSchema =>
  strictObject(
    {
      id: idSchema,
      component: { type: "string", enum: [component] },
      ...properties,
    },
    ["id", "component", ...required],
  );

const weatherConditionSchema = enumSchema([
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

const temperatureSchema: JsonSchema = { type: "number", minimum: -150, maximum: 150 };
const probabilitySchema: JsonSchema = { type: "number", minimum: 0, maximum: 100 };
const childrenSchema = uniqueArraySchema(idSchema, 1, 20);
const sourceIdsSchema = uniqueArraySchema(sourceIdSchema, 1, LIMITS.sources);

const hourlyItemSchema = strictObject(
  {
    time: boundedString(40),
    temperature: temperatureSchema,
    precipitationProbability: probabilitySchema,
    condition: weatherConditionSchema,
  },
  ["time", "temperature", "precipitationProbability", "condition"],
);

const dailyItemSchema = strictObject(
  {
    date: boundedString(60),
    high: temperatureSchema,
    low: temperatureSchema,
    precipitationProbability: probabilitySchema,
    condition: weatherConditionSchema,
  },
  ["date", "high", "low", "precipitationProbability", "condition"],
);

const comparisonItemSchema = strictObject(
  {
    label: boundedString(120),
    value: boundedString(120),
    detail: optionalBoundedString(220),
    recommended: { type: "boolean" },
  },
  ["label", "value", "recommended"],
);

const chartSeriesSchema = strictObject(
  {
    label: boundedString(80),
    values: arraySchema({ type: "number" }, 2, 12),
  },
  ["label", "values"],
);

const evidenceItemSchema = strictObject(
  {
    title: boundedString(180),
    finding: boundedString(700),
    sourceId: sourceIdSchema,
  },
  ["title", "finding", "sourceId"],
);

const timelineItemSchema = strictObject(
  {
    date: boundedString(80),
    title: boundedString(180),
    detail: boundedString(500),
    sourceId: sourceIdSchema,
  },
  ["date", "title", "detail"],
);

const componentSchemas: JsonSchema[] = [
  node(
    "EditorialHeading",
    {
      text: boundedString(220),
      level: enumSchema(["h1", "h2", "h3"]),
      align: enumSchema(["start", "center"]),
    },
    ["text", "level", "align"],
  ),
  node(
    "TextBlock",
    {
      text: boundedString(2_000),
      tone: enumSchema(["default", "muted", "bounded"]),
    },
    ["text", "tone"],
  ),
  node(
    "Metric",
    {
      label: boundedString(80),
      value: boundedString(80),
      detail: optionalBoundedString(180),
      accent: enumSchema(["blue", "coral", "neutral"]),
    },
    ["label", "value", "accent"],
  ),
  node(
    "Band",
    {
      children: childrenSchema,
      tone: enumSchema(["plain", "sky", "coral", "muted"]),
      label: optionalBoundedString(80),
    },
    ["children", "tone"],
  ),
  node(
    "Split",
    {
      children: arraySchema(idSchema, 2, 3),
      ratio: enumSchema(["equal", "wide-start", "wide-end"]),
    },
    ["children", "ratio"],
  ),
  node(
    "Rail",
    {
      children: childrenSchema,
      label: optionalBoundedString(80),
    },
    ["children"],
  ),
  node("Divider", { label: optionalBoundedString(80) }, []),
  node(
    "WeatherHero",
    {
      location: boundedString(120),
      dateLabel: boundedString(80),
      temperature: temperatureSchema,
      unit: enumSchema(["F", "C"]),
      condition: boundedString(80),
      conditionKey: weatherConditionSchema,
      recommendationLabel: boundedString(80),
      recommendationValue: boundedString(120),
      recommendationDetail: boundedString(240),
    },
    [
      "location",
      "dateLabel",
      "temperature",
      "unit",
      "condition",
      "conditionKey",
      "recommendationLabel",
      "recommendationValue",
      "recommendationDetail",
    ],
  ),
  node(
    "RecommendationBand",
    {
      label: boundedString(80),
      value: boundedString(160),
      detail: boundedString(320),
      confidence: enumSchema(["high", "medium", "low"]),
    },
    ["label", "value", "detail", "confidence"],
  ),
  node(
    "HourlyForecast",
    {
      label: boundedString(80),
      unit: enumSchema(["F", "C"]),
      items: arraySchema(hourlyItemSchema, 2, 24),
    },
    ["label", "unit", "items"],
  ),
  node(
    "DailyForecast",
    {
      label: boundedString(80),
      unit: enumSchema(["F", "C"]),
      items: arraySchema(dailyItemSchema, 1, 10),
    },
    ["label", "unit", "items"],
  ),
  node(
    "WeatherAlert",
    {
      title: boundedString(160),
      severity: enumSchema(["minor", "moderate", "severe", "extreme"]),
      description: boundedString(700),
      sourceId: sourceIdSchema,
    },
    ["title", "severity", "description"],
  ),
  node(
    "LocationPrompt",
    {
      message: boundedString(300),
      suggestions: arraySchema(boundedString(120), 0, LIMITS.locations),
    },
    ["message", "suggestions"],
  ),
  node(
    "ComparisonSummary",
    {
      title: boundedString(180),
      recommendation: boundedString(400),
      items: arraySchema(comparisonItemSchema, 2, 4),
    },
    ["title", "recommendation", "items"],
  ),
  node(
    "ComparisonTable",
    {
      caption: boundedString(160),
      columns: arraySchema(boundedString(80), 2, 6),
      rows: arraySchema(arraySchema(optionalBoundedString(160), 2, 6), 1, 12),
    },
    ["caption", "columns", "rows"],
  ),
  node(
    "ComparisonChart",
    {
      title: boundedString(160),
      labels: arraySchema(boundedString(60), 2, 12),
      series: arraySchema(chartSeriesSchema, 1, 4),
      unit: optionalBoundedString(24),
    },
    ["title", "labels", "series"],
  ),
  node(
    "ResearchLead",
    {
      title: boundedString(220),
      summary: boundedString(1_200),
      sourceIds: sourceIdsSchema,
    },
    ["title", "summary", "sourceIds"],
  ),
  node(
    "EvidenceList",
    {
      label: boundedString(80),
      items: arraySchema(evidenceItemSchema, 1, 8),
    },
    ["label", "items"],
  ),
  node(
    "Timeline",
    {
      label: boundedString(80),
      items: arraySchema(timelineItemSchema, 1, 12),
    },
    ["label", "items"],
  ),
  node(
    "SourceList",
    {
      label: boundedString(80),
      sourceIds: sourceIdsSchema,
    },
    ["label", "sourceIds"],
  ),
];

export const SURFACE_SPEC_JSON_SCHEMA: JsonSchema = strictObject(
  {
    kind: enumSchema(["weather", "comparison", "research", "narrative", "location"]),
    rootId: idSchema,
    components: {
      type: "array",
      minItems: 1,
      maxItems: LIMITS.surfaceNodes,
      items: { anyOf: componentSchemas },
    },
  },
  ["kind", "rootId", "components"],
);

const COMPONENTS_BY_KIND = {
  weather: [
    "Band",
    "WeatherHero",
    "RecommendationBand",
    "HourlyForecast",
    "DailyForecast",
    "WeatherAlert",
    "SourceList",
  ],
  comparison: [
    "Band",
    "Divider",
    "ComparisonSummary",
    "ComparisonTable",
    "ComparisonChart",
    "SourceList",
  ],
  research: ["Band", "Divider", "ResearchLead", "EvidenceList", "Timeline", "SourceList"],
  narrative: ["Band", "Divider", "EditorialHeading", "TextBlock"],
} as const satisfies Record<CompositionKind, readonly TrustedComponentName[]>;

const optionalObject = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
});

const weatherRuntimeItemSchema = optionalObject({
  time: boundedString(40),
  date: boundedString(60),
  temperature: temperatureSchema,
  high: temperatureSchema,
  low: temperatureSchema,
  precipitationProbability: probabilitySchema,
  condition: weatherConditionSchema,
});

const researchRuntimeItemSchema = optionalObject({
  date: boundedString(80),
  title: boundedString(180),
  detail: boundedString(500),
  finding: boundedString(700),
  sourceId: sourceIdSchema,
});

const RUNTIME_PROPERTIES_BY_KIND = {
  weather: {
    children: childrenSchema,
    tone: enumSchema(["plain", "sky", "coral", "muted"]),
    label: optionalBoundedString(80),
    location: boundedString(120),
    dateLabel: boundedString(80),
    temperature: temperatureSchema,
    unit: enumSchema(["F", "C"]),
    condition: boundedString(80),
    conditionKey: weatherConditionSchema,
    recommendationLabel: boundedString(80),
    recommendationValue: boundedString(120),
    recommendationDetail: boundedString(240),
    value: boundedString(160),
    detail: boundedString(320),
    confidence: enumSchema(["high", "medium", "low"]),
    items: arraySchema(weatherRuntimeItemSchema, 1, 24),
    title: boundedString(160),
    severity: enumSchema(["minor", "moderate", "severe", "extreme"]),
    description: boundedString(700),
    sourceId: sourceIdSchema,
    sourceIds: sourceIdsSchema,
  },
  comparison: {
    children: childrenSchema,
    tone: enumSchema(["plain", "sky", "coral", "muted"]),
    label: optionalBoundedString(80),
    title: boundedString(180),
    recommendation: boundedString(400),
    items: arraySchema(comparisonItemSchema, 2, 4),
    caption: boundedString(160),
    columns: arraySchema(boundedString(80), 2, 6),
    rows: arraySchema(arraySchema(optionalBoundedString(160), 2, 6), 1, 12),
    labels: arraySchema(boundedString(60), 2, 12),
    series: arraySchema(chartSeriesSchema, 1, 4),
    unit: optionalBoundedString(24),
    sourceIds: sourceIdsSchema,
  },
  research: {
    children: childrenSchema,
    tone: enumSchema(["plain", "sky", "coral", "muted"]),
    label: optionalBoundedString(80),
    title: boundedString(220),
    summary: boundedString(1_200),
    sourceIds: sourceIdsSchema,
    items: arraySchema(researchRuntimeItemSchema, 1, 12),
  },
  narrative: {
    children: childrenSchema,
    tone: enumSchema(["plain", "sky", "coral", "muted", "default", "bounded"]),
    label: optionalBoundedString(80),
    text: boundedString(2_000),
    level: enumSchema(["h1", "h2", "h3"]),
    align: enumSchema(["start", "center"]),
  },
} as const satisfies Record<CompositionKind, Record<string, JsonSchema>>;

const COMPONENT_CONTRACTS_BY_KIND = {
  weather: [
    "Band: children, tone, optional label",
    "WeatherHero: location, dateLabel, temperature, unit, condition, conditionKey, recommendationLabel, recommendationValue, recommendationDetail",
    "RecommendationBand: label, value, detail, confidence",
    "HourlyForecast: label, unit, items with time, temperature, precipitationProbability, condition",
    "DailyForecast: label, unit, items with date, high, low, precipitationProbability, condition",
    "WeatherAlert: title, severity, description, optional sourceId",
    "SourceList: label, sourceIds",
  ],
  comparison: [
    "Band: children, tone, optional label",
    "Divider: optional label",
    "ComparisonSummary: title, recommendation, items with label, value, optional detail, recommended",
    "ComparisonTable: caption, columns, rows",
    "ComparisonChart: title, labels, series with label and numeric values, optional unit",
    "SourceList: label, sourceIds",
  ],
  research: [
    "Band: children, tone, optional label",
    "Divider: optional label",
    "ResearchLead: title, summary, sourceIds",
    "EvidenceList: label, items with title, finding, sourceId",
    "Timeline: label, items with date, title, detail, optional sourceId",
    "SourceList: label, sourceIds",
  ],
  narrative: [
    "Band: children, tone, optional label",
    "Divider: optional label",
    "EditorialHeading: text, level, align",
    "TextBlock: text, tone",
  ],
} as const satisfies Record<CompositionKind, readonly string[]>;

function requestedComparison(prompt: string): boolean {
  return /\b(compare|comparison|versus|vs\.?|better|difference|score|rank|which (?:city|location|place|option))\b/i.test(
    prompt,
  );
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function requestedMultiLocationWeatherVisualization(
  prompt: string,
  retrieval: GeminiRetrievalResult,
): boolean {
  if (!/\b(chart|plot|graph|visuali[sz]e)\b/i.test(prompt)) return false;
  const locationKeys = new Set<string>();
  for (const evidence of retrieval.evidence) {
    const normalizedLocationKeys: string[] = [];
    if (isUnknownRecord(evidence.result)) {
      const normalizedLocations = evidence.result.locations;
      if (isUnknownArray(normalizedLocations)) {
        for (const candidate of normalizedLocations) {
          if (!isUnknownRecord(candidate)) continue;

          const normalizedLocation = candidate.location;
          if (!isUnknownRecord(normalizedLocation)) continue;

          const name = normalizedLocation.name;
          if (typeof name !== "string") continue;

          const key = name.trim().toLocaleLowerCase("en-US");
          if (key) normalizedLocationKeys.push(`name:${key}`);
        }
      }
    }

    // Provider-normalized locations are the authoritative cardinality for this
    // tool result. Mixing them with raw aliases, ZIP codes, or coordinates would
    // count one resolved place twice.
    if (normalizedLocationKeys.length > 0) {
      for (const key of normalizedLocationKeys) locationKeys.add(key);
      continue;
    }

    for (const location of evidence.arguments.locations ?? []) {
      const key = location.trim().toLocaleLowerCase("en-US");
      if (key) locationKeys.add(`name:${key}`);
    }
    if (evidence.arguments.location) {
      const key = evidence.arguments.location.trim().toLocaleLowerCase("en-US");
      if (key) locationKeys.add(`name:${key}`);
    }
    if (
      evidence.arguments.latitude !== undefined &&
      evidence.arguments.longitude !== undefined
    ) {
      locationKeys.add(
        `coordinates:${evidence.arguments.latitude.toFixed(5)},${evidence.arguments.longitude.toFixed(5)}`,
      );
    }
  }
  return locationKeys.size >= 2;
}

export function compositionKind(prompt: string, retrieval: GeminiRetrievalResult): CompositionKind {
  if (
    requestedComparison(prompt) ||
    requestedMultiLocationWeatherVisualization(prompt, retrieval)
  ) {
    return "comparison";
  }
  if (retrieval.evidence.length > 0) return "weather";
  if (retrieval.sources.some((source) => source.provider === "google-search")) return "research";
  return "narrative";
}

function responseSchema(kind: CompositionKind): JsonSchema {
  return strictObject(
    {
      kind: enumSchema([kind]),
      rootId: idSchema,
      components: {
        type: "array",
        minItems: 1,
        maxItems: LIMITS.surfaceNodes,
        items: strictObject(
          {
            id: idSchema,
            component: enumSchema(COMPONENTS_BY_KIND[kind]),
            ...RUNTIME_PROPERTIES_BY_KIND[kind],
          },
          ["id", "component"],
        ),
      },
    },
    ["kind", "rootId", "components"],
  );
}

function compositionInstruction(kind: CompositionKind): string {
  return [
    "You compose a SurfaceSpec for a trusted, server-owned component catalog.",
    `Create a ${kind} surface using only these component names: ${COMPONENTS_BY_KIND[kind].join(", ")}.`,
    "Every component ID must be unique, every child must exist, every component must be reachable from rootId, and layouts must be acyclic.",
    `Component contracts: ${COMPONENT_CONTRACTS_BY_KIND[kind].join("; ")}.`,
    "Use only the source IDs supplied in the evidence payload. Never create or alter a source ID.",
    "Provide one complete object matching the supplied composition schema.",
  ].join(" ");
}

export interface ComposeSurfaceSpecInput {
  gemini: GeminiClient;
  prompt: string;
  clientContext: ClientContext;
  retrieval: GeminiRetrievalResult;
  signal?: AbortSignal;
}

export interface CompositionResult {
  spec: SurfaceSpec;
  repairCount: 0 | 1;
}

type ValidationFailure = {
  success: false;
  issues: readonly string[];
  rawOutput: string;
};

type ValidationSuccess = {
  success: true;
  spec: SurfaceSpec;
};

type CompositionValidation = ValidationFailure | ValidationSuccess;

export class CompositionValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[], options?: ErrorOptions) {
    super("Gemini could not produce a valid SurfaceSpec after one repair attempt.", options);
    this.name = "CompositionValidationError";
    this.issues = Object.freeze([...issues]);
  }
}

function normalizedPrompt(prompt: string): string {
  const value = prompt.trim();
  if (!value || value.length > LIMITS.promptCharacters) {
    throw new CompositionValidationError(["The composition prompt is outside the allowed size."]);
  }
  return value;
}

function evidencePayload(
  prompt: string,
  clientContext: ClientContext,
  retrieval: GeminiRetrievalResult,
): Record<string, unknown> {
  return {
    userRequest: normalizedPrompt(prompt),
    clientContext: {
      sizeClass: clientContext.sizeClass,
      locale: clientContext.locale,
      timeZone: clientContext.timeZone,
      units: clientContext.units,
      reducedMotion: clientContext.reducedMotion,
    },
    evidenceSummary: retrieval.outputText,
    weatherEvidence: retrieval.evidence,
    sources: retrieval.sources,
  };
}

interface SurfacePlanEvidenceProjection {
  payload: Record<string, unknown>;
  weatherManifest?: WeatherCompositionManifest;
}

function surfacePlanEvidencePayload(
  prompt: string,
  clientContext: ClientContext,
  retrieval: GeminiRetrievalResult,
  researchChangeManifest?: ResearchChangeManifest,
): SurfacePlanEvidenceProjection {
  const weatherPayload = buildWeatherCompositionPayload({ prompt, clientContext, retrieval });
  if (weatherPayload) {
    return {
      payload: {
        userRequest: weatherPayload.userRequest,
        clientContext: weatherPayload.clientContext,
        weatherManifest: weatherPayload.weatherManifest,
        sources: weatherPayload.sources,
      },
      weatherManifest: weatherPayload.weatherManifest,
    };
  }

  return {
    payload: {
      userRequest: normalizedPrompt(prompt),
      clientContext: {
        sizeClass: clientContext.sizeClass,
        locale: clientContext.locale,
        timeZone: clientContext.timeZone,
        units: clientContext.units,
        reducedMotion: clientContext.reducedMotion,
      },
      evidenceSummary: retrieval.outputText,
      sources: retrieval.sources.map((source) => ({
        id: source.id,
        title: source.title,
        provider: source.provider,
        ...(source.snippet ? { snippet: source.snippet } : {}),
      })),
      ...(researchChangeManifest
        ? {
            researchChangeManifest: {
              version: researchChangeManifest.version,
              subject: researchChangeManifest.subject,
              leadSummary: researchChangeManifest.leadSummary,
              evidenceLabel: researchChangeManifest.evidenceLabel,
              sourceLabel: researchChangeManifest.sourceLabel,
              renderUnits: researchChangeManifest.renderUnits,
              requiredSourceIds: researchChangeManifest.requiredSourceIds,
            },
          }
        : {}),
    },
  };
}

function boundedIssue(issue: string): string {
  return issue.replace(/\s+/g, " ").trim().slice(0, 160);
}

function validateComposition(rawOutput: string, sources: readonly SourceRecord[]): CompositionValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return {
      success: false,
      issues: ["The response was not valid JSON."],
      rawOutput,
    };
  }

  const validation = validateSurfaceSpec(parsed, sources);
  if (!validation.success) {
    return {
      success: false,
      issues: validation.issues.map(boundedIssue),
      rawOutput,
    };
  }

  return { success: true, spec: validation.spec };
}

function initialCompositionInput(payload: Record<string, unknown>): string {
  return [
    "Create the best concise SurfaceSpec for this request and evidence.",
    "Evidence payload:",
    JSON.stringify(payload),
  ].join("\n\n");
}

function repairCompositionInput(
  payload: Record<string, unknown>,
  failure: ValidationFailure,
): string {
  return [
    "Repair the invalid SurfaceSpec. Return a complete replacement object, not a patch.",
    `Validation issues: ${JSON.stringify(failure.issues.slice(0, 8))}`,
    `Invalid output: ${failure.rawOutput.slice(0, 32_000)}`,
    `Original evidence payload: ${JSON.stringify(payload)}`,
  ].join("\n\n");
}

export async function composeSurfaceSpec({
  gemini,
  prompt,
  clientContext,
  retrieval,
  signal,
}: ComposeSurfaceSpecInput): Promise<CompositionResult> {
  const payload = evidencePayload(prompt, clientContext, retrieval);
  const kind = compositionKind(prompt, retrieval);
  const generator = gemini.structuredOutput;
  if (!generator) throw new GeminiProviderError("Gemini structured composition is unavailable.");
  let input = initialCompositionInput(payload);
  let lastFailure: ValidationFailure | undefined;

  for (const repairCount of [0, 1] as const) {
    let output: { text?: string };
    try {
      output = await generator.generate({
        input,
        systemInstruction: compositionInstruction(kind),
        schema: responseSchema(kind),
        signal,
      });
    } catch (error) {
      if (error instanceof GeminiProviderError) throw error;
      throw new GeminiProviderError("Gemini composition request failed.", { cause: error });
    }

    const validation = validateComposition(output.text ?? "", retrieval.sources);
    if (validation.success) return { spec: validation.spec, repairCount };

    lastFailure = validation;
    if (repairCount === 0) input = repairCompositionInput(payload, validation);
  }

  throw new CompositionValidationError(lastFailure?.issues ?? ["Unknown composition failure."]);
}

type PlanKind = "weather" | "comparison" | "research";

const PLAN_RECIPES_BY_KIND = {
  weather: ["weather.snapshot", "weather.decision", "weather.outlook"],
  comparison: ["comparison.verdict", "comparison.scorecard", "comparison.trend"],
  research: ["research.brief", "research.timeline", "research.claims"],
} as const satisfies Record<PlanKind, readonly SurfacePlan["recipeId"][]>;

const planIndexSchema: JsonSchema = { type: "integer", minimum: 0 };
const planIndexesSchema = (minimum: number, maximum: number): JsonSchema =>
  uniqueArraySchema(planIndexSchema, minimum, maximum);

const planSourceModuleSchema = strictObject(
  {
    type: enumSchema(["sources"]),
    label: boundedString(80),
    sourceIds: sourceIdsSchema,
  },
  ["type", "label", "sourceIds"],
);

const PLAN_MODULE_SCHEMAS_BY_KIND: Record<PlanKind, readonly JsonSchema[]> = {
  weather: [
    strictObject(
      {
        type: enumSchema(["hero"]),
        variant: enumSchema(["snapshot", "decision"]),
        locationIndex: planIndexSchema,
        recommendationLabel: boundedString(80),
        recommendationValue: boundedString(120),
        recommendationDetail: boundedString(240),
      },
      [
        "type",
        "variant",
        "locationIndex",
        "recommendationLabel",
        "recommendationValue",
        "recommendationDetail",
      ],
    ),
    strictObject(
      {
        type: enumSchema(["recommendation"]),
        locationIndex: planIndexSchema,
        activityWindowIndex: planIndexSchema,
      },
      ["type", "locationIndex", "activityWindowIndex"],
    ),
    strictObject(
      {
        type: enumSchema(["recommendation"]),
        locationIndex: planIndexSchema,
        dayIndex: planIndexSchema,
        signal: enumSchema(["wettest", "driest", "warmest", "coolest"]),
      },
      ["type", "locationIndex", "dayIndex", "signal"],
    ),
    strictObject(
      {
        type: enumSchema(["hourly"]),
        variant: enumSchema(["strip", "chart"]),
        label: boundedString(80),
        locationIndex: planIndexSchema,
        hourIndexes: planIndexesSchema(1, 24),
      },
      ["type", "variant", "label", "locationIndex", "hourIndexes"],
    ),
    strictObject(
      {
        type: enumSchema(["daily"]),
        variant: enumSchema(["cards", "table"]),
        label: boundedString(80),
        locationIndex: planIndexSchema,
        dayIndexes: planIndexesSchema(1, 10),
      },
      ["type", "variant", "label", "locationIndex", "dayIndexes"],
    ),
    strictObject(
      {
        type: enumSchema(["alerts"]),
        locationIndex: planIndexSchema,
        alertIndexes: planIndexesSchema(1, 8),
      },
      ["type", "locationIndex", "alertIndexes"],
    ),
    strictObject(
      {
        type: enumSchema(["metrics"]),
        locationIndex: planIndexSchema,
        metrics: arraySchema(
          enumSchema(["feelsLike", "humidity", "wind", "uv", "visibility", "precipitation"]),
          1,
          6,
        ),
      },
      ["type", "locationIndex", "metrics"],
    ),
    planSourceModuleSchema,
  ],
  comparison: [
    strictObject(
      {
        type: enumSchema(["summary"]),
        variant: enumSchema(["verdict", "balanced"]),
        title: boundedString(180),
        recommendation: boundedString(400),
        items: arraySchema(comparisonItemSchema, 2, 4),
        sourceIds: sourceIdsSchema,
      },
      ["type", "variant", "title", "recommendation", "items", "sourceIds"],
    ),
    strictObject(
      {
        type: enumSchema(["table"]),
        caption: boundedString(160),
        columns: arraySchema(boundedString(80), 2, 6),
        rows: arraySchema(arraySchema(optionalBoundedString(160), 2, 6), 1, 12),
        sourceIds: sourceIdsSchema,
      },
      ["type", "caption", "columns", "rows", "sourceIds"],
    ),
    strictObject(
      {
        type: enumSchema(["chart"]),
        variant: enumSchema(["line", "bar"]),
        title: boundedString(160),
        labels: arraySchema(boundedString(60), 2, 12),
        series: arraySchema(chartSeriesSchema, 1, 4),
        unit: optionalBoundedString(24),
        sourceIds: sourceIdsSchema,
      },
      ["type", "variant", "title", "labels", "series", "sourceIds"],
    ),
    planSourceModuleSchema,
  ],
  research: [
    strictObject(
      {
        type: enumSchema(["lead"]),
        variant: enumSchema(["feature", "brief"]),
        title: boundedString(220),
        summary: boundedString(1_200),
        sourceIds: sourceIdsSchema,
      },
      ["type", "variant", "title", "summary", "sourceIds"],
    ),
    strictObject(
      {
        type: enumSchema(["evidence"]),
        variant: enumSchema(["stack", "grid", "for-against"]),
        label: boundedString(80),
        items: arraySchema(
          strictObject(
            {
              title: boundedString(180),
              finding: boundedString(700),
              sourceId: sourceIdSchema,
              stance: enumSchema(["support", "challenge", "neutral"]),
            },
            ["title", "finding", "sourceId", "stance"],
          ),
          1,
          8,
        ),
      },
      ["type", "variant", "label", "items"],
    ),
    strictObject(
      {
        type: enumSchema(["timeline"]),
        label: boundedString(80),
        items: arraySchema(
          strictObject(
            {
              date: boundedString(80),
              title: boundedString(180),
              detail: boundedString(500),
              sourceId: sourceIdSchema,
            },
            ["date", "title", "detail", "sourceId"],
          ),
          1,
          12,
        ),
      },
      ["type", "label", "items"],
    ),
    planSourceModuleSchema,
  ],
};

const weatherComparisonLocationIndexesSchema = planIndexesSchema(2, LIMITS.locations);
const weatherComparisonTableBase = {
  type: enumSchema(["table"]),
  caption: boundedString(160),
  locationIndexes: weatherComparisonLocationIndexesSchema,
  sourceIds: sourceIdsSchema,
};

const WEATHER_COMPARISON_PLAN_MODULE_SCHEMAS: readonly JsonSchema[] = [
  strictObject(
    {
      type: enumSchema(["summary"]),
      variant: enumSchema(["verdict", "balanced"]),
      title: boundedString(180),
      recommendation: boundedString(400),
      locationIndexes: weatherComparisonLocationIndexesSchema,
      recommendedLocationIndex: planIndexSchema,
      sourceIds: sourceIdsSchema,
    },
    ["type", "variant", "title", "recommendation", "locationIndexes", "sourceIds"],
  ),
  strictObject(
    {
      ...weatherComparisonTableBase,
      forecastKind: enumSchema(["current"]),
      metrics: arraySchema(
        enumSchema([
          "temperature",
          "feelsLike",
          "humidity",
          "precipitation",
          "wind",
          "uv",
          "visibility",
        ]),
        1,
        7,
      ),
    },
    ["type", "caption", "locationIndexes", "forecastKind", "metrics", "sourceIds"],
  ),
  strictObject(
    {
      ...weatherComparisonTableBase,
      forecastKind: enumSchema(["hourly"]),
      forecastIndexes: planIndexesSchema(1, 24),
      metric: enumSchema(["temperature", "precipitation"]),
    },
    [
      "type",
      "caption",
      "locationIndexes",
      "forecastKind",
      "forecastIndexes",
      "metric",
      "sourceIds",
    ],
  ),
  strictObject(
    {
      ...weatherComparisonTableBase,
      forecastKind: enumSchema(["daily"]),
      forecastIndexes: planIndexesSchema(1, 24),
      metric: enumSchema(["high", "low", "precipitation"]),
    },
    [
      "type",
      "caption",
      "locationIndexes",
      "forecastKind",
      "forecastIndexes",
      "metric",
      "sourceIds",
    ],
  ),
  strictObject(
    {
      type: enumSchema(["chart"]),
      variant: enumSchema(["line", "bar"]),
      title: boundedString(160),
      locationIndexes: weatherComparisonLocationIndexesSchema,
      forecastKind: enumSchema(["hourly", "daily"]),
      forecastIndexes: planIndexesSchema(2, 24),
      metric: enumSchema(["temperature", "high", "low", "precipitation"]),
      sourceIds: sourceIdsSchema,
    },
    [
      "type",
      "variant",
      "title",
      "locationIndexes",
      "forecastKind",
      "forecastIndexes",
      "metric",
      "sourceIds",
    ],
  ),
  planSourceModuleSchema,
];

interface ResolvedPlanContract {
  recipeId?: SurfacePlan["recipeId"];
  density?: SurfacePlan["density"];
  emphasis?: SurfacePlan["emphasis"];
  twoSidedClaims: boolean;
  authoredWinnerRequired?: true;
  preserveIndependentDirectionalChanges?: true;
}

function requestsExplicitAuthoredWinner(prompt: string): boolean {
  const normalized = prompt.toLocaleLowerCase("en-US");
  return [...normalized.matchAll(/\btell me which\b/g)].some((match) => {
    const before = normalized.slice(Math.max(0, (match.index ?? 0) - 32), match.index);
    return !/\b(?:do not|don't|never)(?:\s+\w+){0,2}\s*$/u.test(before);
  });
}

function isQuotedTextIndex(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const after = text.slice(index);
  const straightDoubleCount = before.match(/"/gu)?.length ?? 0;
  if (straightDoubleCount % 2 === 1 && after.includes('"')) return true;
  if (before.lastIndexOf("“") > before.lastIndexOf("”") && after.includes("”")) return true;
  if (before.lastIndexOf("‘") > before.lastIndexOf("’") && after.includes("’")) return true;

  const straightSingleIndex = before.lastIndexOf("'");
  return straightSingleIndex >= 0 &&
    (straightSingleIndex === 0 || !/[\p{L}\p{N}]/u.test(before[straightSingleIndex - 1] ?? "")) &&
    after.includes("'");
}

function requestsChangeSummary(prompt: string): boolean {
  const normalized = prompt.toLocaleLowerCase("en-US");
  const matches = normalized.matchAll(
    /\bwhat(?:(?:['’]s)|\s+(?:is|has))?\s+(?:changed|new|different)\b/gu,
  );
  return [...matches].some((match) => {
    const index = match.index ?? 0;
    const before = normalized.slice(Math.max(0, index - 64), index);
    if (/\b(?:do not|don't|never)(?:\s+\w+){0,3}\s*$/u.test(before)) return false;
    if (isQuotedTextIndex(normalized, index)) return false;
    return !/\b(?:phrase|query|prompt)\b[^.!?;]{0,48}$/u.test(before);
  });
}

function resolvedPlanContract(
  kind: PlanKind,
  prompt: string,
  weatherBackedComparison: boolean,
): ResolvedPlanContract {
  const normalized = prompt.toLocaleLowerCase("en-US");
  const recipeId = expectedRecipeForPrompt(prompt, kind, weatherBackedComparison);
  const twoSidedClaims =
    /\bevidence\s+for\s+and\s+against\b|\bfor\s+and\s+against\s+(?:the\s+)?claim\b/.test(
      normalized,
    );
  if (!recipeId) return { twoSidedClaims };

  if (recipeId === "research.brief" && requestsChangeSummary(prompt)) {
    return {
      recipeId,
      density: "brief",
      emphasis: "answer",
      twoSidedClaims,
      preserveIndependentDirectionalChanges: true,
    };
  }

  if (recipeId === "weather.snapshot") {
    return {
      recipeId,
      density: "brief",
      emphasis: /\b(?:alerts?|warnings?|advisories|hazards?|severe)\b/.test(normalized)
        ? "risk"
        : "answer",
      twoSidedClaims,
    };
  }
  if (recipeId === "weather.decision") {
    return { recipeId, density: "balanced", emphasis: "decision", twoSidedClaims };
  }
  if (recipeId === "weather.outlook") {
    return {
      recipeId,
      density: /\b(?:wettest|driest|warmest|coolest)\b/.test(normalized)
        ? "detailed"
        : "balanced",
      emphasis: "trend",
      twoSidedClaims,
    };
  }
  if (recipeId === "comparison.trend") {
    return { recipeId, density: "detailed", emphasis: "trend", twoSidedClaims };
  }
  if (recipeId === "comparison.scorecard") {
    const officialTechnical =
      /\bofficial\b/.test(normalized) &&
      /\b(?:renderer|support|framework|client|sdk|api|protocol)\b/.test(normalized);
    return {
      recipeId,
      density: officialTechnical ? "detailed" : "balanced",
      emphasis: officialTechnical ? "evidence" : "answer",
      twoSidedClaims,
    };
  }
  if (recipeId === "comparison.verdict") {
    return {
      recipeId,
      density: weatherBackedComparison ? "brief" : "balanced",
      emphasis: "decision",
      twoSidedClaims,
      ...(!weatherBackedComparison && requestsExplicitAuthoredWinner(prompt)
        ? { authoredWinnerRequired: true as const }
        : {}),
    };
  }
  if (recipeId === "research.timeline") {
    return {
      recipeId,
      density: /\bsince\s+\d{4}\b/.test(normalized) ? "detailed" : "balanced",
      emphasis: "trend",
      twoSidedClaims,
    };
  }
  if (recipeId === "research.claims") {
    return {
      recipeId,
      density: twoSidedClaims ? "detailed" : "balanced",
      emphasis: "evidence",
      twoSidedClaims,
    };
  }
  if (/\b(?:using|from)\s+only\b[^.?!]*\bsources?\b/.test(normalized)) {
    return {
      recipeId,
      density: "balanced",
      emphasis: "evidence",
      twoSidedClaims,
    };
  }
  if (/\b(?:concise|brief)\b/.test(normalized)) {
    return {
      recipeId,
      density: "brief",
      emphasis: "answer",
      twoSidedClaims,
    };
  }
  return { recipeId, twoSidedClaims };
}

const twoSidedResearchEvidenceModuleSchema = strictObject(
  {
    type: enumSchema(["evidence"]),
    variant: enumSchema(["for-against"]),
    label: boundedString(80),
    items: arraySchema(
      strictObject(
        {
          title: boundedString(180),
          finding: boundedString(700),
          sourceId: sourceIdSchema,
          stance: enumSchema(["support", "challenge"]),
        },
        ["title", "finding", "sourceId", "stance"],
      ),
      2,
      8,
    ),
  },
  ["type", "variant", "label", "items"],
);

// The generic, non-manifest concise research brief has three authored prose-bearing
// modules. These limits close that provider contract over the trusted brief budget:
// 72 + 164 + 24 + (2 * (48 + 160)) + 24 = 700 prose characters,
// while the lead remains 236 characters, below its 280-character ceiling.
const BRIEF_RESEARCH_LIMITS = Object.freeze({
  leadTitle: 72,
  leadSummary: 164,
  evidenceLabel: 24,
  evidenceItems: 2,
  evidenceTitle: 48,
  evidenceFinding: 160,
  sourceLabel: 24,
});

function briefResearchLeadModuleSchema(
  researchChangeManifest?: ResearchChangeManifest,
): JsonSchema {
  return strictObject(
    {
      type: enumSchema(["lead"]),
      variant: enumSchema(["brief"]),
      title: researchChangeManifest
        ? {
            ...boundedString(BRIEF_RESEARCH_LIMITS.leadTitle),
            enum: [researchChangeManifest.subject],
            description: "Copy the exact requested change subject unchanged.",
          }
        : boundedString(BRIEF_RESEARCH_LIMITS.leadTitle),
      summary: researchChangeManifest
        ? {
            ...boundedString(BRIEF_RESEARCH_LIMITS.leadSummary),
            enum: [researchChangeManifest.leadSummary],
            description: "Copy the exact compiler-issued lead summary unchanged.",
          }
        : boundedString(BRIEF_RESEARCH_LIMITS.leadSummary),
      sourceIds: researchChangeManifest
        ? {
            ...sourceIdsSchema,
            minItems: researchChangeManifest.requiredSourceIds.length,
            maxItems: researchChangeManifest.requiredSourceIds.length,
            items: enumSchema(researchChangeManifest.requiredSourceIds),
            description: "Copy every required manifest source ID once in manifest order.",
          }
        : sourceIdsSchema,
    },
    ["type", "variant", "title", "summary", "sourceIds"],
  );
}

function briefResearchEvidenceModuleSchema(
  contract: ResolvedPlanContract,
  researchChangeManifest?: ResearchChangeManifest,
): JsonSchema {
  const genericFindingSchema = boundedString(BRIEF_RESEARCH_LIMITS.evidenceFinding);
  if (contract.preserveIndependentDirectionalChanges) {
    appendSchemaDescription(
      genericFindingSchema,
      "For a resolved change brief, preserve every independent directional change from the cited source, including multiple changes, and compress them instead of using only an umbrella topic label.",
    );
  }
  return strictObject(
    {
      type: enumSchema(["evidence"]),
      variant: enumSchema(["stack"]),
      label: researchChangeManifest
        ? {
            ...boundedString(BRIEF_RESEARCH_LIMITS.evidenceLabel),
            enum: [researchChangeManifest.evidenceLabel],
          }
        : boundedString(BRIEF_RESEARCH_LIMITS.evidenceLabel),
      items: arraySchema(
        researchChangeManifest
          ? {
              anyOf: researchChangeManifest.renderUnits.map((unit) =>
                strictObject(
                  {
                    title: {
                      ...boundedString(BRIEF_RESEARCH_LIMITS.evidenceTitle),
                      enum: [unit.title],
                    },
                    finding: {
                      ...boundedString(unit.finding.length),
                      enum: [unit.finding],
                      description:
                        "Copy this exact compiler-issued source change finding unchanged.",
                    },
                    sourceId: enumSchema([unit.sourceId]),
                    stance: enumSchema(["support"]),
                  },
                  ["title", "finding", "sourceId", "stance"],
                )
              ),
            }
          : strictObject(
              {
                title: boundedString(BRIEF_RESEARCH_LIMITS.evidenceTitle),
                finding: genericFindingSchema,
                sourceId: sourceIdSchema,
                stance: enumSchema(["support", "challenge", "neutral"]),
              },
              ["title", "finding", "sourceId", "stance"],
            ),
        researchChangeManifest?.renderUnits.length ?? 1,
        researchChangeManifest?.renderUnits.length ?? BRIEF_RESEARCH_LIMITS.evidenceItems,
      ),
    },
    ["type", "variant", "label", "items"],
  );
}

function briefResearchSourceModuleSchema(
  researchChangeManifest?: ResearchChangeManifest,
): JsonSchema {
  return strictObject(
    {
      type: enumSchema(["sources"]),
      label: researchChangeManifest
        ? {
            ...boundedString(BRIEF_RESEARCH_LIMITS.sourceLabel),
            enum: [researchChangeManifest.sourceLabel],
          }
        : boundedString(BRIEF_RESEARCH_LIMITS.sourceLabel),
      sourceIds: researchChangeManifest
        ? {
            ...sourceIdsSchema,
            minItems: researchChangeManifest.requiredSourceIds.length,
            maxItems: researchChangeManifest.requiredSourceIds.length,
            items: enumSchema(researchChangeManifest.requiredSourceIds),
            description: "Copy every required manifest source ID once in manifest order.",
          }
        : sourceIdsSchema,
    },
    ["type", "label", "sourceIds"],
  );
}

function schemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstSchemaEnum(value: unknown): unknown {
  if (!schemaRecord(value) || !Array.isArray(value.enum)) return undefined;
  return value.enum[0];
}

function appendSchemaDescription(schema: Record<string, unknown>, detail: string): void {
  const current = typeof schema.description === "string" ? schema.description.trim() : "";
  schema.description = current ? `${current} ${detail}` : detail;
}

interface SurfacePlanSchemaConstraints {
  sourceIds: readonly string[];
  weatherManifest?: WeatherCompositionManifest;
  researchChangeManifest?: ResearchChangeManifest;
}

function constrainSurfacePlanSchema(
  schema: JsonSchema,
  constraints: SurfacePlanSchemaConstraints,
): JsonSchema {
  const manifest = constraints.weatherManifest;
  const locationIndexes = manifest?.request.locationIndexes ?? [];
  const hourlyIndexes = [...new Set(
    manifest?.request.hourlyCoverage.flatMap((coverage) => coverage.indexes) ?? [],
  )].sort((left, right) => left - right);
  const dailyIndexes = [...new Set(
    manifest?.request.dailyCoverage.flatMap((coverage) => coverage.indexes) ?? [],
  )].sort((left, right) => left - right);
  const comparisonHourlyIndexes = manifest?.comparison?.selectableHourlyIndexes ?? hourlyIndexes;
  const comparisonDailyIndexes = manifest?.comparison?.selectableDailyIndexes ?? dailyIndexes;
  const activityWindowIndexes = manifest?.activityWindows.map((window) => window.index) ?? [];
  const alertIndexes = [...new Set(
    manifest?.locations.flatMap((location) =>
      location.selectableAlerts.map((alert) => alert.index)
    ) ?? [],
  )].sort((left, right) => left - right);

  const withEnum = (value: unknown, values: readonly (string | number)[]): unknown => {
    if (!schemaRecord(value) || values.length === 0) return value;
    const existing = Array.isArray(value.enum) ? value.enum : undefined;
    return {
      ...value,
      enum: existing
        ? existing.filter((candidate) => values.includes(candidate as string | number))
        : [...values],
    };
  };
  const constrainIndexArray = (
    value: unknown,
    values: readonly number[],
    detail: string,
  ): unknown => {
    if (!schemaRecord(value) || values.length === 0) return value;
    const constrained = {
      ...value,
      items: withEnum(value.items, values),
    };
    appendSchemaDescription(constrained, detail);
    return constrained;
  };

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!schemaRecord(value)) return value;
    const clone: Record<string, unknown> = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, visit(item)]),
    );
    if (!schemaRecord(clone.properties)) return clone;
    const properties = { ...clone.properties };

    if (constraints.sourceIds.length > 0) {
      if (properties.sourceId) {
        properties.sourceId = withEnum(properties.sourceId, constraints.sourceIds);
      }
      if (schemaRecord(properties.sourceIds)) {
        properties.sourceIds = {
          ...properties.sourceIds,
          items: withEnum(properties.sourceIds.items, constraints.sourceIds),
        };
      }
    }
    if (locationIndexes.length > 0) {
      if (properties.locationIndex) {
        properties.locationIndex = withEnum(properties.locationIndex, locationIndexes);
      }
      if (properties.recommendedLocationIndex) {
        properties.recommendedLocationIndex = withEnum(
          properties.recommendedLocationIndex,
          locationIndexes,
        );
      }
      if (properties.locationIndexes) {
        properties.locationIndexes = constrainIndexArray(
          properties.locationIndexes,
          locationIndexes,
          `Use only requested location indexes in this order: ${locationIndexes.join(", ")}.`,
        );
      }
    }
    if (properties.hourIndexes) {
      properties.hourIndexes = constrainIndexArray(
        properties.hourIndexes,
        hourlyIndexes,
        `Copy the requested hourly coverage indexes: ${hourlyIndexes.join(", ")}.`,
      );
    }
    if (properties.dayIndexes) {
      properties.dayIndexes = constrainIndexArray(
        properties.dayIndexes,
        dailyIndexes,
        `Copy the requested daily coverage indexes: ${dailyIndexes.join(", ")}.`,
      );
    }
    if (properties.activityWindowIndex) {
      properties.activityWindowIndex = withEnum(
        properties.activityWindowIndex,
        activityWindowIndexes,
      );
    }
    if (properties.dayIndex) {
      properties.dayIndex = withEnum(properties.dayIndex, dailyIndexes);
    }
    if (properties.alertIndexes) {
      properties.alertIndexes = constrainIndexArray(
        properties.alertIndexes,
        alertIndexes,
        `Use only selectable alert indexes: ${alertIndexes.join(", ")}.`,
      );
    }
    if (properties.forecastIndexes) {
      const forecastKind = firstSchemaEnum(properties.forecastKind);
      const indexes = forecastKind === "hourly"
        ? comparisonHourlyIndexes
        : forecastKind === "daily"
          ? comparisonDailyIndexes
          : [];
      properties.forecastIndexes = constrainIndexArray(
        properties.forecastIndexes,
        indexes,
        `Copy the aligned ${String(forecastKind)} comparison indexes: ${indexes.join(", ")}.`,
      );
    }
    clone.properties = properties;
    return clone;
  };

  return visit(schema) as JsonSchema;
}

function surfacePlanResponseSchema(
  kind: PlanKind,
  weatherBackedComparison: boolean,
  contract: ResolvedPlanContract,
  constraints: SurfacePlanSchemaConstraints,
): JsonSchema {
  let moduleSchemas = weatherBackedComparison
    ? WEATHER_COMPARISON_PLAN_MODULE_SCHEMAS
    : PLAN_MODULE_SCHEMAS_BY_KIND[kind];
  let minimumModules = 1;
  let maximumModules = 16;
  const recipeId = contract.recipeId;
  if (recipeId) {
    const compatibleModules = new Set<string>(
      SURFACE_RECIPES[recipeId].compatibleModules,
    );
    moduleSchemas = moduleSchemas
      .filter((schema) => {
        if (!schemaRecord(schema.properties)) return false;
        const moduleType = firstSchemaEnum(schema.properties.type);
        return typeof moduleType === "string" && compatibleModules.has(moduleType);
      })
      .map((schema) => {
        if (!schemaRecord(schema.properties)) return schema;
        const properties = { ...schema.properties };
        const moduleType = firstSchemaEnum(properties.type);
        if (moduleType === "hero" && recipeId.startsWith("weather.")) {
          properties.variant = enumSchema([
            recipeId === "weather.decision" ? "decision" : "snapshot",
          ]);
        }
        if (moduleType === "summary" && recipeId.startsWith("comparison.")) {
          properties.variant = enumSchema([
            recipeId === "comparison.verdict" ? "verdict" : "balanced",
          ]);
        }
        return { ...schema, properties };
      });
  }
  if (recipeId === "comparison.scorecard") {
    moduleSchemas = moduleSchemas.filter((schema) => {
      if (!schemaRecord(schema.properties)) return false;
      return firstSchemaEnum(schema.properties.type) !== "chart";
    });
    minimumModules = 3;
    maximumModules = 3;
  }
  if (recipeId === "research.brief" && contract.density === "brief") {
    moduleSchemas = [
      briefResearchLeadModuleSchema(constraints.researchChangeManifest),
      briefResearchEvidenceModuleSchema(contract, constraints.researchChangeManifest),
      briefResearchSourceModuleSchema(constraints.researchChangeManifest),
    ];
    minimumModules = 3;
    maximumModules = 3;
  }
  if (kind === "research" && contract.twoSidedClaims) {
    moduleSchemas = moduleSchemas.map((schema) => {
      if (!schemaRecord(schema.properties)) return schema;
      return firstSchemaEnum(schema.properties.type) === "evidence"
        ? twoSidedResearchEvidenceModuleSchema
        : schema;
    });
  }
  const schema = strictObject(
    {
      kind: enumSchema([kind]),
      recipeId: enumSchema(contract.recipeId ? [contract.recipeId] : PLAN_RECIPES_BY_KIND[kind]),
      density: enumSchema(contract.density ? [contract.density] : ["brief", "balanced", "detailed"]),
      emphasis: enumSchema(
        contract.emphasis
          ? [contract.emphasis]
          : ["answer", "decision", "trend", "evidence", "risk"],
      ),
      modules: {
        type: "array",
        minItems: minimumModules,
        maxItems: maximumModules,
        items: { anyOf: [...moduleSchemas] },
      },
    },
    ["kind", "recipeId", "density", "emphasis", "modules"],
  );
  return constrainSurfacePlanSchema(schema, constraints);
}

const grammarGapSchema = enumSchema(["compact", "regular", "generous"]);
const grammarToneSchema = enumSchema(["neutral", "accent", "caution"]);
const grammarProminenceSchema = enumSchema(["lead", "standard", "quiet"]);
const grammarChildrenSchema = uniqueArraySchema(idSchema, 1, 20);

const GRAMMAR_LAYOUT_NODE_SCHEMAS: readonly JsonSchema[] = [
  strictObject(
    {
      id: idSchema,
      type: enumSchema(["stack"]),
      children: grammarChildrenSchema,
      gap: grammarGapSchema,
      align: enumSchema(["start", "center", "stretch"]),
    },
    ["id", "type", "children", "gap", "align"],
  ),
  strictObject(
    {
      id: idSchema,
      type: enumSchema(["grid"]),
      children: grammarChildrenSchema,
      columns: enumSchema(["adaptive", "two", "three"]),
      gap: grammarGapSchema,
    },
    ["id", "type", "children", "columns", "gap"],
  ),
  strictObject(
    {
      id: idSchema,
      type: enumSchema(["split"]),
      children: uniqueArraySchema(idSchema, 2, 3),
      ratio: enumSchema(["equal", "wide-start", "wide-end"]),
    },
    ["id", "type", "children", "ratio"],
  ),
  strictObject(
    {
      id: idSchema,
      type: enumSchema(["section"]),
      children: grammarChildrenSchema,
      label: optionalBoundedString(80),
      role: enumSchema(["primary", "supporting", "reference"]),
      tone: grammarToneSchema,
      prominence: grammarProminenceSchema,
    },
    ["id", "type", "children", "role", "tone", "prominence"],
  ),
  strictObject(
    {
      id: idSchema,
      type: enumSchema(["card"]),
      children: uniqueArraySchema(idSchema, 1, 8),
      tone: grammarToneSchema,
      prominence: grammarProminenceSchema,
    },
    ["id", "type", "children", "tone", "prominence"],
  ),
  strictObject(
    {
      id: idSchema,
      type: enumSchema(["rail"]),
      children: grammarChildrenSchema,
      label: optionalBoundedString(80),
    },
    ["id", "type", "children"],
  ),
  strictObject(
    {
      id: idSchema,
      type: enumSchema(["tabs"]),
      children: uniqueArraySchema(idSchema, 2, 4),
      labels: arraySchema(boundedString(40), 2, 4),
      defaultIndex: { type: "integer", minimum: 0, maximum: 3 },
    },
    ["id", "type", "children", "labels", "defaultIndex"],
  ),
  strictObject(
    {
      id: idSchema,
      type: enumSchema(["disclosure"]),
      children: uniqueArraySchema(idSchema, 1, 4),
      label: boundedString(80),
      defaultOpen: { type: "boolean" },
    },
    ["id", "type", "children", "label", "defaultOpen"],
  ),
  strictObject(
    {
      id: idSchema,
      type: enumSchema(["divider"]),
      label: optionalBoundedString(80),
    },
    ["id", "type"],
  ),
];

function generativeModuleSchemas(
  kind: PlanKind,
  weatherBackedComparison: boolean,
  contract: ResolvedPlanContract,
  constraints: SurfacePlanSchemaConstraints,
): JsonSchema {
  let schemas = weatherBackedComparison
    ? [...WEATHER_COMPARISON_PLAN_MODULE_SCHEMAS]
    : [...PLAN_MODULE_SCHEMAS_BY_KIND[kind]];
  if (constraints.researchChangeManifest) {
    schemas = [
      briefResearchLeadModuleSchema(constraints.researchChangeManifest),
      briefResearchEvidenceModuleSchema(contract, constraints.researchChangeManifest),
      briefResearchSourceModuleSchema(constraints.researchChangeManifest),
    ];
  } else if (kind === "research" && contract.twoSidedClaims) {
    schemas = schemas.map((schema) => {
      if (!schemaRecord(schema.properties)) return schema;
      return firstSchemaEnum(schema.properties.type) === "evidence"
        ? twoSidedResearchEvidenceModuleSchema
        : schema;
    });
  }
  const constrained = constrainSurfacePlanSchema(
    strictObject({ module: { anyOf: schemas } }, ["module"]),
    constraints,
  );
  const properties = schemaRecord(constrained.properties) ? constrained.properties : {};
  return schemaRecord(properties.module) ? properties.module : { anyOf: schemas };
}

function generativeSurfacePlanResponseSchema(
  kind: PlanKind,
  weatherBackedComparison: boolean,
  contract: ResolvedPlanContract,
  constraints: SurfacePlanSchemaConstraints,
): JsonSchema {
  const moduleSchema = generativeModuleSchemas(
    kind,
    weatherBackedComparison,
    contract,
    constraints,
  );
  return strictObject(
    {
      version: enumSchema(["v3"]),
      kind: enumSchema([kind]),
      density: enumSchema(contract.density ? [contract.density] : ["brief", "balanced", "detailed"]),
      emphasis: enumSchema([
        contract.emphasis === "evidence"
          ? "evidence"
          : contract.emphasis === "answer"
            ? "answer"
            : "exploration",
      ]),
      archetypeHint: enumSchema(PLAN_RECIPES_BY_KIND[kind]),
      content: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        items: strictObject({ id: idSchema, module: moduleSchema }, ["id", "module"]),
        description:
          "Evidence-bound content nodes. IDs are layout references; modules retain server-issued indexes and source IDs.",
      },
      layout: strictObject(
        {
          rootId: idSchema,
          nodes: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { anyOf: [...GRAMMAR_LAYOUT_NODE_SCHEMAS] },
          },
        },
        ["rootId", "nodes"],
      ),
    },
    ["version", "kind", "density", "emphasis", "content", "layout"],
  );
}

function planKindFor(prompt: string, retrieval: GeminiRetrievalResult): PlanKind {
  const kind = compositionKind(prompt, retrieval);
  if (kind === "narrative") {
    throw new CompositionValidationError([
      "SurfacePlan composition is limited to weather, comparison, and research.",
    ]);
  }
  return kind;
}

const PLAN_PRIMARY_BY_KIND = {
  weather: "hero",
  comparison: "summary",
  research: "lead",
} as const satisfies Record<PlanKind, string>;

const PLAN_ORDER_BY_RECIPE = {
  "weather.snapshot": "hero -> metrics? -> hourly? -> alerts? -> sources",
  "weather.decision": "hero -> recommendation -> hourly? -> daily? -> alerts? -> sources",
  "weather.outlook": "hero -> daily|hourly -> recommendation? -> alerts? -> sources",
  "comparison.verdict": "summary -> table -> sources",
  "comparison.scorecard": "summary -> table -> sources",
  "comparison.trend": "summary -> chart -> table -> sources",
  "research.brief": "lead -> evidence -> sources",
  "research.timeline": "lead -> timeline -> evidence? -> sources",
  "research.claims": "lead -> evidence -> sources",
} as const satisfies Record<SurfacePlan["recipeId"], string>;

const DENSITY_EMPHASIS_MATRIX = {
  weather: [
    "current single-location answer => brief + answer",
    "current alert or immediate hazard question => brief + risk",
    "activity timing, clothing, or go/no-go decision => balanced + decision",
    "ordinary multi-day forecast => balanced + trend",
    "multi-day outlook with an explicit callout such as wettest day => detailed + trend",
  ],
  comparison: [
    "simple weather activity verdict => brief + decision",
    "grounded two-option allowance or policy verdict => balanced + decision",
    "official-source technical support comparison, including score or rank wording => detailed + evidence",
    "otherwise, score or rank across three or more options => balanced + answer",
    "ordered time range or explicit chart/plot => detailed + trend",
  ],
  research: [
    "concise sourced brief => brief + answer",
    "authority-only requirements => balanced + evidence",
    "timeline spanning announcements since a year => detailed + trend",
    "compact release and support timeline => balanced + trend",
    "explicit evidence for and against a claim => detailed + evidence",
    "bounded assessment of a claim => balanced + evidence",
  ],
} as const satisfies Record<PlanKind, readonly string[]>;

function surfaceContentBudgetInstruction(): string {
  return `Exact compiled content budgets by density: ${(
    ["brief", "balanced", "detailed"] as const
  ).map((density) => {
    const budget = SURFACE_CONTENT_BUDGETS[density];
    return `${density} <= ${budget.maxComponents} components, <= ${budget.maxProseCharacters} prose characters, <= ${budget.maxLeadCharacters} lead characters`;
  }).join("; ")}.`;
}

function surfacePlanInstruction(
  kind: PlanKind,
  weatherBackedComparison: boolean,
  contract: ResolvedPlanContract,
  researchChangeManifest?: ResearchChangeManifest,
): string {
  const recipes = PLAN_RECIPES_BY_KIND[kind].map((recipeId) => {
    const recipe = SURFACE_RECIPES[recipeId];
    const definingModule = recipeId === "weather.outlook"
      ? "daily, or hourly for an explicit hour range"
      : recipe.requiredModule;
    return [
      `${recipeId}: defining module: ${definingModule}; canonical order: ${PLAN_ORDER_BY_RECIPE[recipeId]}; ${recipe.selectionRule}`,
      `Ideal use: ${recipe.idealUse}`,
      `Misuse warning: ${recipe.misuseWarning}`,
      `Compatible modules: ${recipe.compatibleModules.join(", ")}.`,
      `Example: ${recipe.example}`,
    ].join(" ");
  });
  const resolvedContract = [
    contract.recipeId ? `recipeId=${contract.recipeId}` : undefined,
    contract.density ? `density=${contract.density}` : undefined,
    contract.emphasis ? `emphasis=${contract.emphasis}` : undefined,
    contract.authoredWinnerRequired ? "winner=required" : undefined,
    contract.preserveIndependentDirectionalChanges
      ? "changeCoverage=all-directional"
      : undefined,
  ].filter((value): value is string => Boolean(value));

  return [
    "You compose a semantic SurfacePlan for a trusted, server-owned UI compiler.",
    `Choose exactly one ${kind} recipe from the supplied schema.`,
    ...(resolvedContract.length > 0
      ? [`Resolved request contract: ${resolvedContract.join("; ")}. This contract takes precedence over more general examples.`]
      : []),
    `The exact primary-first module type is ${PLAN_PRIMARY_BY_KIND[kind]}; put exactly one first and put a single sources module last.`,
    `Use the first matching deterministic density and emphasis rule: ${DENSITY_EMPHASIS_MATRIX[kind].join("; ")}. Official-source technical support takes precedence even when the request also uses score or rank wording.`,
    surfaceContentBudgetInstruction(),
    "Brief density includes the canonical required modules and only explicitly requested optional modules; do not add decorative or merely available modules.",
    ...(contract.recipeId === "research.brief" && contract.density === "brief"
      ? [
          "For this resolved concise research brief, emit exactly lead -> evidence -> sources with at most two evidence items; the schema text limits are the complete compiled 700-character prose budget.",
        ]
      : []),
    ...(contract.preserveIndependentDirectionalChanges
      ? [
          "For this resolved change brief, preserve every independent directional change from the supplied evidence.",
          "When there are multiple changes from one source, compress all of them into the available findings within the schema limits.",
          "An umbrella topic label without the direction and result of each change is insufficient.",
          ...(researchChangeManifest
            ? [
                "Copy every compiler-issued researchChangeManifest render-unit finding exactly once, unchanged, into an EvidenceList item with its matching sourceId.",
                "Copy researchChangeManifest.subject unchanged as the lead title, and copy requiredSourceIds unchanged into both the lead and final sources module.",
                "Do not quote, negate, qualify, summarize, or embed a compiler-issued finding inside other prose.",
              ]
            : []),
        ]
      : []),
    ...(contract.recipeId === "comparison.scorecard"
      ? ["For this resolved scorecard, emit exactly summary -> table -> sources; do not add a chart."]
      : []),
    "Balanced density may add one useful supporting module; detailed density may include every module needed to cover a multi-part request, but still no duplicates.",
    "Omit optional properties instead of emitting null. Required properties must never be null.",
    "Preserve every requested location, unit, hour, day, range, criterion, and evidence item.",
    "Weather modules may reference only supplied manifest indexes; never copy, infer, or invent weather measurements.",
    "When weatherManifest is present, copy the exact hourlyCoverage and dailyCoverage indexes into the relevant forecast modules, use eligibleActivityWindowIndexes for activity decisions, and use each requested signal's preferredIndex for its recommendation.",
    "Copy requiredFinalSourceIds unchanged into the single final sources module.",
    weatherBackedComparison
      ? "This comparison is weather-backed. The compiler creates the scorecard or trend from references, so never add authored score, item, row, label, series, value, or measurement properties. Use only locationIndexes, forecastIndexes, metric references, and source IDs. Current tables require metrics and must omit forecastIndexes and metric. Hourly/daily tables and charts require one compatible metric plus forecastIndexes. For scorecard and trend summaries, omit recommendedLocationIndex unless the user explicitly requests a winner and the manifest rankings prove one. Weather-backed comparison prose must stay qualitative-only: in model-authored titles and recommendations, do not write numeric values, measurements, dates, or times; use relative language such as warmer, cooler, wetter, drier, steadier, or more variable."
      : "Non-weather comparisons may summarize supplied search evidence but must retain its source IDs.",
    ...(contract.authoredWinnerRequired
      ? ["For this explicit winner request, set recommended=true on exactly one authored summary item and false on every other item. Select only the option supported by the supplied evidence; if the evidence cannot support a unique winner, do not invent one and allow validation to use the safe fallback."]
      : ["For authored comparison summaries, set recommended=true on at most one item; zero is allowed when the evidence has no unique winner."]),
    "Every explicitly requested comparison criterion must appear in structured summary items or table content, not only in the title or recommendation.",
    "Every table row must contain the same number of cells as the table columns.",
    "A comparison trend chart and table must use identical locationIndexes, forecastKind, forecastIndexes, metric, and sourceIds.",
    "Comparison and research claims must retain unchanged server-issued source IDs. URLs never belong in the plan.",
    "For research.claims, set stance on every evidence item relative to the user's claim: support, challenge, or neutral.",
    ...(contract.twoSidedClaims
      ? ["For this explicit two-sided claim request, use variant for-against, include both sides, and set stance exactly support or challenge; never use for or against as stance values."]
      : []),
    "Do not emit component names, CSS, HTML, JavaScript, URLs, hidden reasoning, or executable instructions.",
    ...recipes,
  ].join(" ");
}

export type SurfaceQualityCheck = {
  code:
    | "recipe_fit"
    | "answer_first"
    | "sources_last"
    | "requested_coverage"
    | "duplicate_primary"
    | "chart_table_alignment"
    | "citation_coverage"
    | "content_budget";
  passed: boolean;
};

export type SurfacePlanFirstFailureCategory =
  | "none"
  | "json"
  | "schema"
  | "semantic"
  | "quality"
  | "compilation";

export type SurfacePlanFirstFailureCode =
  | "invalid_json"
  | "invalid_schema"
  | "invalid_semantic"
  | "compilation_failed"
  | SurfaceQualityCheck["code"];

export type SurfacePlanSchemaIssueCode =
  | "invalid_type"
  | "invalid_literal"
  | "invalid_union"
  | "invalid_union_discriminator"
  | "invalid_enum_value"
  | "unrecognized_keys"
  | "invalid_arguments"
  | "invalid_return_type"
  | "invalid_date"
  | "invalid_string"
  | "too_small"
  | "too_big"
  | "invalid_intersection_types"
  | "not_multiple_of"
  | "not_finite"
  | "custom";

export interface SurfacePlanSchemaIssueDiagnostic {
  readonly attempt: 0 | 1;
  readonly path: string;
  readonly code: SurfacePlanSchemaIssueCode;
}

type SurfacePlanSchemaIssue = Omit<SurfacePlanSchemaIssueDiagnostic, "attempt">;

const SURFACE_PLAN_SCHEMA_ISSUE_CODES = new Set<SurfacePlanSchemaIssueCode>([
  "invalid_type",
  "invalid_literal",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite",
  "custom",
]);
const SURFACE_PLAN_SCHEMA_PATH_FIELDS = new Set([
  "version",
  "kind",
  "recipeId",
  "archetypeHint",
  "density",
  "emphasis",
  "content",
  "module",
  "layout",
  "rootId",
  "nodes",
  "children",
  "gap",
  "align",
  "ratio",
  "role",
  "tone",
  "prominence",
  "defaultIndex",
  "defaultOpen",
  "modules",
  "type",
  "variant",
  "title",
  "summary",
  "recommendation",
  "recommendationLabel",
  "recommendationValue",
  "recommendationDetail",
  "label",
  "items",
  "value",
  "detail",
  "recommended",
  "stance",
  "caption",
  "columns",
  "rows",
  "labels",
  "series",
  "values",
  "unit",
  "date",
  "finding",
  "sourceId",
  "sourceIds",
  "locationIndex",
  "locationIndexes",
  "recommendedLocationIndex",
  "activityWindowIndex",
  "dayIndex",
  "signal",
  "hourIndexes",
  "dayIndexes",
  "alertIndexes",
  "metrics",
  "metric",
  "forecastKind",
  "forecastIndexes",
]);

function safeSurfacePlanSchemaIssueCode(code: string): SurfacePlanSchemaIssueCode {
  return SURFACE_PLAN_SCHEMA_ISSUE_CODES.has(code as SurfacePlanSchemaIssueCode)
    ? code as SurfacePlanSchemaIssueCode
    : "custom";
}

function safeSurfacePlanSchemaIssuePath(path: readonly PropertyKey[]): string {
  const segments = path.slice(0, 8).map((segment) => {
    if (typeof segment === "number") return String(segment);
    if (typeof segment !== "string") return "$field";
    return SURFACE_PLAN_SCHEMA_PATH_FIELDS.has(segment) ? segment : "$field";
  });
  return segments.join(".") || "plan";
}

interface ZodIssueLike {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly unionErrors?: readonly {
    readonly issues: readonly ZodIssueLike[];
  }[];
}

function categoricalSurfacePlanSchemaIssues(issue: ZodIssueLike): SurfacePlanSchemaIssue[] {
  if (issue.code === "invalid_union" && issue.unionErrors?.length) {
    const bestBranch = [...issue.unionErrors].sort((left, right) => {
      const branchScore = (branch: { readonly issues: readonly ZodIssueLike[] }): number =>
        branch.issues.length + branch.issues.filter((candidate) =>
          candidate.code === "invalid_literal" && candidate.path.at(-1) === "type"
        ).length * 100;
      return branchScore(left) - branchScore(right);
    })[0];
    if (bestBranch) {
      return bestBranch.issues.flatMap(categoricalSurfacePlanSchemaIssues);
    }
  }
  return [{
    path: safeSurfacePlanSchemaIssuePath(issue.path),
    code: safeSurfacePlanSchemaIssueCode(issue.code),
  }];
}

function planQualityChecks(
  plan: SurfacePlan,
  spec: SurfaceSpec,
  prompt: string,
  retrieval: GeminiRetrievalResult,
  clientContext: ClientContext,
): readonly SurfaceQualityCheck[] {
  const evaluated = evaluateSurfacePlanQuality(plan, {
    sources: retrieval.sources,
    evidence: retrieval.evidence,
    prompt,
    clientContext,
  }, spec);
  return Object.freeze(
    Object.entries(evaluated).map(([code, passed]) => ({
      code: code as SurfaceQualityCheck["code"],
      passed,
    })),
  );
}

type SurfacePlanValidationFailure = {
  success: false;
  category: Exclude<SurfacePlanFirstFailureCategory, "none">;
  codes: readonly SurfacePlanFirstFailureCode[];
  issues: readonly string[];
  rawOutput: string;
  schemaIssues?: readonly SurfacePlanSchemaIssue[];
};

type SurfacePlanValidationSuccess = {
  success: true;
  plan: SurfacePlan;
};

type SurfacePlanCompositionValidation =
  | SurfacePlanValidationFailure
  | SurfacePlanValidationSuccess;

function omitNullProperty(
  value: Record<string, unknown>,
  property: string,
): Record<string, unknown> {
  if (value[property] !== null) return value;
  const copy = { ...value };
  delete copy[property];
  return copy;
}

function normalizeOptionalSurfacePlanNulls(input: unknown): unknown {
  if (!schemaRecord(input) || !Array.isArray(input.modules)) return input;
  const modules = input.modules as readonly unknown[];
  return {
    ...input,
    modules: modules.map((candidate) => {
      if (!schemaRecord(candidate)) return candidate;
      let module = candidate;
      if (module.type === "summary") {
        module = omitNullProperty(module, "recommendedLocationIndex");
        if (Array.isArray(module.items)) {
          const items = module.items as readonly unknown[];
          module = {
            ...module,
            items: items.map((item) =>
              schemaRecord(item) ? omitNullProperty(item, "detail") : item
            ),
          };
        }
      } else if (module.type === "table") {
        module = omitNullProperty(module, "forecastIndexes");
        module = omitNullProperty(module, "metrics");
        module = omitNullProperty(module, "metric");
      } else if (module.type === "chart") {
        module = omitNullProperty(module, "unit");
      }
      return module;
    }),
  };
}

function resolvedModuleContractIssues(
  plan: SurfacePlan,
  contract: ResolvedPlanContract,
  researchChangeManifest?: ResearchChangeManifest,
): string[] {
  const issues: string[] = [];
  const moduleTypes = plan.modules.map((module) => module.type);
  if (
    contract.recipeId === "comparison.scorecard" &&
    moduleTypes.join(",") !== "summary,table,sources"
  ) {
    issues.push("Resolved scorecard contract requires exactly summary, table, and sources.");
  }
  if (contract.recipeId !== "research.brief" || contract.density !== "brief") {
    return issues;
  }
  if (moduleTypes.join(",") !== "lead,evidence,sources") {
    issues.push("Resolved concise brief contract requires exactly lead, evidence, and sources.");
    return issues;
  }

  const [lead, evidence, sources] = plan.modules;
  if (lead?.type !== "lead" || evidence?.type !== "evidence" || sources?.type !== "sources") {
    return issues;
  }
  if (
    lead.variant !== "brief" ||
    lead.title.length > BRIEF_RESEARCH_LIMITS.leadTitle ||
    lead.summary.length > BRIEF_RESEARCH_LIMITS.leadSummary
  ) {
    issues.push("Resolved concise brief lead exceeds its bounded contract.");
  }
  const maximumFindingCharacters = researchChangeManifest
    ? Math.max(...researchChangeManifest.renderUnits.map((unit) => unit.finding.length))
    : BRIEF_RESEARCH_LIMITS.evidenceFinding;
  if (
    evidence.variant !== "stack" ||
    evidence.label.length > BRIEF_RESEARCH_LIMITS.evidenceLabel ||
    evidence.items.length > BRIEF_RESEARCH_LIMITS.evidenceItems ||
    evidence.items.some((item) =>
      item.title.length > BRIEF_RESEARCH_LIMITS.evidenceTitle ||
      item.finding.length > maximumFindingCharacters
    )
  ) {
    issues.push("Resolved concise brief evidence exceeds its bounded contract.");
  }
  if (sources.label.length > BRIEF_RESEARCH_LIMITS.sourceLabel) {
    issues.push("Resolved concise brief source label exceeds its bounded contract.");
  }
  return issues;
}

function validatePlanComposition(
  rawOutput: string,
  prompt: string,
  clientContext: ClientContext,
  retrieval: GeminiRetrievalResult,
  contract: ResolvedPlanContract,
  researchChangeManifest?: ResearchChangeManifest,
): SurfacePlanCompositionValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return {
      success: false,
      category: "json",
      codes: ["invalid_json"],
      issues: ["The SurfacePlan was not valid JSON."],
      rawOutput,
    };
  }
  parsed = normalizeOptionalSurfacePlanNulls(parsed);

  const schemaValidation = SurfacePlanSchema.safeParse(parsed);
  if (!schemaValidation.success) {
    const schemaIssues = schemaValidation.error.issues
      .flatMap((issue) => categoricalSurfacePlanSchemaIssues(issue as ZodIssueLike))
      .filter((issue, index, issues) =>
        issues.findIndex(
          (candidate) => candidate.path === issue.path && candidate.code === issue.code,
        ) === index
      )
      .slice(0, 4);
    return {
      success: false,
      category: "schema",
      codes: ["invalid_schema"],
      issues: schemaValidation.error.issues
        .slice(0, 8)
        .map((issue) => boundedIssue(`${issue.path.join(".") || "plan"}: ${issue.message}`)),
      rawOutput,
      schemaIssues,
    };
  }

  const validation = validateSurfacePlan(schemaValidation.data, {
    sources: retrieval.sources,
    evidence: retrieval.evidence,
    prompt,
    clientContext,
  });
  if (!validation.success) {
    return {
      success: false,
      category: "semantic",
      codes: ["invalid_semantic"],
      issues: validation.issues.map(boundedIssue),
      rawOutput,
    };
  }

  const contractIssues: string[] = [];
  if (contract.recipeId && validation.plan.recipeId !== contract.recipeId) {
    contractIssues.push(`Resolved request contract requires recipe ${contract.recipeId}.`);
  }
  if (contract.density && validation.plan.density !== contract.density) {
    contractIssues.push(`Resolved request contract requires density ${contract.density}.`);
  }
  if (contract.emphasis && validation.plan.emphasis !== contract.emphasis) {
    contractIssues.push(`Resolved request contract requires emphasis ${contract.emphasis}.`);
  }
  contractIssues.push(
    ...resolvedModuleContractIssues(validation.plan, contract, researchChangeManifest),
  );
  if (researchChangeManifest) {
    contractIssues.push(
      ...researchChangeCoverageIssues(validation.plan, researchChangeManifest),
    );
  }
  if (contract.authoredWinnerRequired && validation.plan.kind === "comparison") {
    const recommendedCount = validation.plan.modules.reduce((count, module) => {
      if (module.type !== "summary" || !("items" in module)) return count;
      return count + module.items.filter((item) => item.recommended).length;
    }, 0);
    if (recommendedCount !== 1) {
      contractIssues.push("Resolved explicit winner request requires exactly one recommended option.");
    }
  }
  if (contractIssues.length > 0) {
    return {
      success: false,
      category: "semantic",
      codes: ["invalid_semantic"],
      issues: contractIssues.map(boundedIssue),
      rawOutput,
    };
  }

  return { success: true, plan: validation.plan };
}

function initialPlanCompositionInput(payload: Record<string, unknown>): string {
  return [
    "Choose the best semantic recipe and emit one complete SurfacePlan.",
    "Evidence payload:",
    JSON.stringify(payload),
  ].join("\n\n");
}

function repairPlanCompositionInput(
  payload: Record<string, unknown>,
  failure: SurfacePlanValidationFailure,
): string {
  return [
    "Repair the invalid SurfacePlan. Return a complete replacement plan, not a patch.",
    `Validation issues: ${JSON.stringify(failure.issues.slice(0, 8))}`,
    `Invalid output: ${failure.rawOutput.slice(0, 32_000)}`,
    `Original evidence payload: ${JSON.stringify(payload)}`,
  ].join("\n\n");
}

export interface SurfacePlanCompositionMetadata {
  recipeId: SurfacePlan["recipeId"];
  density: SurfacePlan["density"];
  emphasis: SurfacePlan["emphasis"];
  qualityChecks: readonly SurfaceQualityCheck[];
  repairCategory: "none" | "semantic";
  compilerResult: "compiled" | "deterministic-fallback";
}

export interface SurfacePlanCompositionResult {
  plan: SurfacePlan;
  spec: SurfaceSpec;
  repairCount: 0 | 1;
  fallbackUsed: boolean;
  firstFailureCategory: SurfacePlanFirstFailureCategory;
  firstFailureCodes: readonly SurfacePlanFirstFailureCode[];
  schemaIssues: readonly SurfacePlanSchemaIssueDiagnostic[];
  metadata: SurfacePlanCompositionMetadata;
}

function qualityFailureIssue(
  check: SurfaceQualityCheck,
  plan: SurfacePlan,
  spec: SurfaceSpec,
): string {
  if (check.code !== "content_budget") {
    return `SurfacePlan quality check failed: ${check.code}.`;
  }
  const budget = SURFACE_CONTENT_BUDGETS[plan.density];
  const { measurements } = evaluateSurfaceContentBudget(spec, budget);
  return boundedIssue(
    `SurfacePlan quality check failed: content_budget. Content budget measurements for ${plan.density}: components ${measurements.componentCount}/${budget.maxComponents}; prose ${measurements.proseCharacters}/${budget.maxProseCharacters}; lead ${measurements.leadCharacters}/${budget.maxLeadCharacters}.`,
  );
}

export async function composeSurfacePlan({
  gemini,
  prompt,
  clientContext,
  retrieval,
  signal,
}: ComposeSurfaceSpecInput): Promise<SurfacePlanCompositionResult> {
  const kind = planKindFor(prompt, retrieval);
  const weatherBackedComparison = kind === "comparison" && retrieval.evidence.length > 0;
  const contract = resolvedPlanContract(kind, prompt, weatherBackedComparison);
  let researchChangeManifest: ResearchChangeManifest | undefined;
  if (contract.preserveIndependentDirectionalChanges) {
    const manifestResult = buildResearchChangeManifest({
      prompt,
      sources: retrieval.sources,
      searchEvidence: retrieval.searchEvidence,
    });
    if (manifestResult.status !== "ready") {
      throw new CompositionValidationError([
        `Resolved change manifest is unavailable: ${manifestResult.reason}.`,
      ]);
    }
    researchChangeManifest = manifestResult.manifest;
  }
  const projection = surfacePlanEvidencePayload(
    prompt,
    clientContext,
    retrieval,
    researchChangeManifest,
  );
  const payload = projection.payload;
  const generator = gemini.structuredOutput;
  if (!generator) throw new GeminiProviderError("Gemini structured composition is unavailable.");

  let input = initialPlanCompositionInput(payload);
  let firstFailure: SurfacePlanValidationFailure | undefined;
  const schemaIssues: SurfacePlanSchemaIssueDiagnostic[] = [];

  for (const repairCount of [0, 1] as const) {
    let output: { text?: string };
    try {
      output = await generator.generate({
        input,
        systemInstruction: surfacePlanInstruction(
          kind,
          weatherBackedComparison,
          contract,
          researchChangeManifest,
        ),
        schema: surfacePlanResponseSchema(kind, weatherBackedComparison, contract, {
          sourceIds: retrieval.sources.map((source) => source.id),
          weatherManifest: projection.weatherManifest,
          researchChangeManifest,
        }),
        functionName: "emit_surface_plan",
        signal,
      });
    } catch (error) {
      if (error instanceof GeminiProviderError) throw error;
      throw new GeminiProviderError("Gemini plan composition request failed.", { cause: error });
    }

    const validation = validatePlanComposition(
      output.text ?? "",
      prompt,
      clientContext,
      retrieval,
      contract,
      researchChangeManifest,
    );
    if (validation.success) {
      let spec: SurfaceSpec;
      try {
        spec = compileSurfacePlan({
          plan: validation.plan,
          retrieval,
          clientContext,
          prompt,
        });
      } catch {
        const compilationFailure: SurfacePlanValidationFailure = {
          success: false,
          category: "compilation",
          codes: ["compilation_failed"],
          issues: ["The SurfacePlan could not be compiled within the trusted catalog budget."],
          rawOutput: output.text ?? "",
        };
        firstFailure ??= compilationFailure;
        if (repairCount === 0) input = repairPlanCompositionInput(payload, compilationFailure);
        continue;
      }

      const qualityChecks = planQualityChecks(
        validation.plan,
        spec,
        prompt,
        retrieval,
        clientContext,
      );
      const failedChecks = qualityChecks.filter((check) => !check.passed);
      if (failedChecks.length > 0) {
        const qualityFailure: SurfacePlanValidationFailure = {
          success: false,
          category: "quality",
          codes: failedChecks.map((check) => check.code),
          issues: failedChecks.map((check) =>
            qualityFailureIssue(check, validation.plan, spec)
          ),
          rawOutput: output.text ?? "",
        };
        firstFailure ??= qualityFailure;
        if (repairCount === 0) input = repairPlanCompositionInput(payload, qualityFailure);
        continue;
      }
      return {
        plan: validation.plan,
        spec,
        repairCount,
        fallbackUsed: false,
        firstFailureCategory: firstFailure?.category ?? "none",
        firstFailureCodes: firstFailure?.codes ?? [],
        schemaIssues: Object.freeze(schemaIssues.slice(0, 8)),
        metadata: {
          recipeId: validation.plan.recipeId,
          density: validation.plan.density,
          emphasis: validation.plan.emphasis,
          qualityChecks,
          repairCategory: repairCount === 0 ? "none" : "semantic",
          compilerResult: "compiled",
        },
      };
    }

    if (validation.schemaIssues) {
      schemaIssues.push(
        ...validation.schemaIssues.map((issue) => ({ ...issue, attempt: repairCount })),
      );
    }
    firstFailure ??= validation;
    if (repairCount === 0) input = repairPlanCompositionInput(payload, validation);
  }

  try {
    const builtFallbackPlan = researchChangeManifest
      ? buildResearchChangeFallbackPlan(researchChangeManifest)
      : buildFallbackSurfacePlan({
          kind,
          prompt,
          retrieval,
          clientContext,
        });
    const parsedFallbackPlan = SurfacePlanSchema.parse({
      ...builtFallbackPlan,
      ...(contract.recipeId ? { recipeId: contract.recipeId } : {}),
      ...(contract.density ? { density: contract.density } : {}),
      ...(contract.emphasis ? { emphasis: contract.emphasis } : {}),
    });
    const fallbackContract = contract.authoredWinnerRequired
      ? { ...contract, authoredWinnerRequired: undefined }
      : contract;
    const fallbackValidation = validatePlanComposition(
      JSON.stringify(parsedFallbackPlan),
      prompt,
      clientContext,
      retrieval,
      fallbackContract,
      researchChangeManifest,
    );
    if (!fallbackValidation.success) {
      throw new TypeError("The deterministic fallback failed SurfacePlan validation.");
    }
    const fallbackPlan = fallbackValidation.plan;
    const fallbackSpec = compileSurfacePlan({
      plan: fallbackPlan,
      retrieval,
      clientContext,
      prompt,
    });
    const fallbackChecks = planQualityChecks(
      fallbackPlan,
      fallbackSpec,
      prompt,
      retrieval,
      clientContext,
    );
    if (fallbackChecks.some((check) => !check.passed)) {
      throw new TypeError("The deterministic fallback failed a SurfacePlan quality check.");
    }
    return {
      plan: fallbackPlan,
      spec: fallbackSpec,
      repairCount: 1,
      fallbackUsed: true,
      firstFailureCategory: firstFailure?.category ?? "none",
      firstFailureCodes: firstFailure?.codes ?? [],
      schemaIssues: Object.freeze(schemaIssues.slice(0, 8)),
      metadata: {
        recipeId: fallbackPlan.recipeId,
        density: fallbackPlan.density,
        emphasis: fallbackPlan.emphasis,
        qualityChecks: fallbackChecks,
        repairCategory: firstFailure ? "semantic" : "none",
        compilerResult: "deterministic-fallback",
      },
    };
  } catch (error) {
    throw new CompositionValidationError([
      "The deterministic domain fallback could not be compiled safely.",
    ], { cause: error });
  }
}

type GenerativeQualityCheck = Readonly<{
  code: GenerativeSurfaceQualityCode;
  passed: boolean;
}>;

export interface GenerativeSurfacePlanCompositionMetadata {
  compositionMode: "grammar-v3";
  recipeId?: SurfacePlan["recipeId"];
  density: GenerativeSurfacePlan["density"];
  emphasis: GenerativeSurfacePlan["emphasis"] | SurfacePlan["emphasis"];
  layoutFamily:
    | GenerativeSurfacePlan["layout"]["nodes"][number]["type"]
    | "plan-v2-fallback"
    | "unknown";
  contentNodeCount: number;
  layoutNodeCount: number;
  qualityChecks: readonly (GenerativeQualityCheck | SurfaceQualityCheck)[];
  repairCategory: "none" | "semantic";
  compilerResult: "compiled" | "deterministic-fallback";
}

export interface GenerativeSurfacePlanCompositionResult {
  plan?: GenerativeSurfacePlan;
  fallbackPlan?: SurfacePlan;
  spec: SurfaceSpec;
  repairCount: 0 | 1;
  fallbackUsed: boolean;
  firstFailureCategory: SurfacePlanFirstFailureCategory;
  firstFailureCodes: readonly (SurfacePlanFirstFailureCode | GenerativeSurfaceQualityCode)[];
  schemaIssues: readonly SurfacePlanSchemaIssueDiagnostic[];
  metadata: GenerativeSurfacePlanCompositionMetadata;
}

type GenerativeValidationFailure = {
  success: false;
  category: Exclude<SurfacePlanFirstFailureCategory, "none">;
  codes: readonly (SurfacePlanFirstFailureCode | GenerativeSurfaceQualityCode)[];
  issues: readonly string[];
  rawOutput: string;
  schemaIssues?: readonly SurfacePlanSchemaIssue[];
};

type GenerativeValidationSuccess = {
  success: true;
  plan: GenerativeSurfacePlan;
};

function normalizeOptionalGenerativePlanNulls(input: unknown): unknown {
  if (!schemaRecord(input) || !Array.isArray(input.content)) return input;
  const content: unknown[] = input.content;
  return {
    ...input,
    content: content.map((candidate: unknown) => {
      if (!schemaRecord(candidate) || !schemaRecord(candidate.module)) return candidate;
      const normalized = normalizeOptionalSurfacePlanNulls({ modules: [candidate.module] });
      if (!schemaRecord(normalized) || !Array.isArray(normalized.modules)) return candidate;
      const modules: unknown[] = normalized.modules;
      return { ...candidate, module: modules[0] };
    }),
  };
}

function validateGenerativeComposition(
  rawOutput: string,
  prompt: string,
  clientContext: ClientContext,
  retrieval: GeminiRetrievalResult,
): GenerativeValidationFailure | GenerativeValidationSuccess {
  let parsed: unknown;
  try {
    parsed = normalizeGenerativePlanIds(normalizeOptionalGenerativePlanNulls(JSON.parse(rawOutput)));
  } catch {
    return {
      success: false,
      category: "json",
      codes: ["invalid_json"],
      issues: ["The GenerativeSurfacePlan was not valid JSON."],
      rawOutput,
    };
  }

  const schemaValidation = GenerativeSurfacePlanSchema.safeParse(parsed);
  if (!schemaValidation.success) {
    const schemaIssues = schemaValidation.error.issues
      .flatMap((issue) => categoricalSurfacePlanSchemaIssues(issue as ZodIssueLike))
      .filter((issue, index, issues) =>
        issues.findIndex(
          (candidate) => candidate.path === issue.path && candidate.code === issue.code,
        ) === index
      )
      .slice(0, 4);
    return {
      success: false,
      category: "schema",
      codes: ["invalid_schema"],
      issues: schemaValidation.error.issues
        .slice(0, 8)
        .map((issue) => boundedIssue(`${issue.path.join(".") || "plan"}: ${issue.message}`)),
      rawOutput,
      schemaIssues,
    };
  }

  const validation = validateGenerativeSurfacePlan(schemaValidation.data, {
    sources: retrieval.sources,
    evidence: retrieval.evidence,
    prompt,
    clientContext,
  });
  if (!validation.success) {
    return {
      success: false,
      category: "semantic",
      codes: ["invalid_semantic"],
      issues: validation.issues.map(boundedIssue),
      rawOutput,
    };
  }
  return { success: true, plan: validation.plan };
}

function presentationAtomManifest(
  weatherManifest: WeatherCompositionManifest | undefined,
  retrieval: GeminiRetrievalResult,
): readonly Record<string, unknown>[] {
  const atoms: Record<string, unknown>[] = retrieval.sources.map((source) => ({
    id: `source:${source.id}`,
    kind: "source",
    sourceId: source.id,
  }));
  if (!weatherManifest) return Object.freeze(atoms);
  for (const locationIndex of weatherManifest.request.locationIndexes) {
    atoms.push({
      id: `weather:location:${locationIndex}:current`,
      kind: "weather-current",
      locationIndex,
    });
  }
  for (const coverage of weatherManifest.request.hourlyCoverage) {
    for (const index of coverage.indexes) {
      atoms.push({
        id: `weather:location:${coverage.locationIndex}:hour:${index}`,
        kind: "weather-hour",
        locationIndex: coverage.locationIndex,
        index,
      });
    }
  }
  for (const coverage of weatherManifest.request.dailyCoverage) {
    for (const index of coverage.indexes) {
      atoms.push({
        id: `weather:location:${coverage.locationIndex}:day:${index}`,
        kind: "weather-day",
        locationIndex: coverage.locationIndex,
        index,
      });
    }
  }
  for (const index of weatherManifest.request.activity?.eligibleActivityWindowIndexes ?? []) {
    atoms.push({ id: `weather:activity-window:${index}`, kind: "activity-window", index });
  }
  for (const location of weatherManifest.locations) {
    for (const alert of location.selectableAlerts) {
      atoms.push({
        id: `weather:location:${location.index}:alert:${alert.index}`,
        kind: "weather-alert",
        locationIndex: location.index,
        index: alert.index,
      });
    }
  }
  return Object.freeze(atoms.slice(0, LIMITS.surfaceNodes));
}

function generativeSurfaceInstruction(
  kind: PlanKind,
  contract: ResolvedPlanContract,
  weatherBackedComparison: boolean,
  researchChangeManifest?: ResearchChangeManifest,
): string {
  return [
    "You compose a GenerativeSurfacePlan v3 for a trusted server-owned UI compiler.",
    `Create one ${kind} surface. Select evidence-bound content modules, then arrange them with the supplied semantic layout grammar.`,
    "Recipes are not templates or ordering rules. archetypeHint is optional metadata only; choose a coherent graph for the request.",
    "The content array contains trusted domain modules. Give each content node a unique ID. Use server-issued weather indexes and source IDs unchanged; never copy or invent measurements or URLs.",
    "The layout is one acyclic tree. Its children reference content IDs or layout-node IDs. Place every non-source content ID exactly once, keep source content out of the layout, and make every layout node reachable from rootId.",
    `Put exactly one ${PLAN_PRIMARY_BY_KIND[kind]} content node first in depth-first logical reading order. Never place primary content or alerts inside tabs or disclosures, and never nest tabs or disclosures.`,
    "Use only these layout types: stack, grid, split, section, card, rail, tabs, disclosure, divider. Use only their semantic enum properties; never emit CSS, class names, raw sizes, colors, HTML, JavaScript, or actions.",
    "Use tabs or disclosures only when they make supporting material easier to scan. Prefer a stable answer-first hierarchy over novelty.",
    `Separate budgets: brief <= ${GENERATIVE_SURFACE_BUDGETS.brief.maxContentNodes} content and ${GENERATIVE_SURFACE_BUDGETS.brief.maxLayoutNodes} layout nodes; balanced <= ${GENERATIVE_SURFACE_BUDGETS.balanced.maxContentNodes} content and ${GENERATIVE_SURFACE_BUDGETS.balanced.maxLayoutNodes} layout nodes; detailed <= ${GENERATIVE_SURFACE_BUDGETS.detailed.maxContentNodes} content and ${GENERATIVE_SURFACE_BUDGETS.detailed.maxLayoutNodes} layout nodes.`,
    surfaceContentBudgetInstruction(),
    "Preserve every requested location, unit, hour, day, range, comparison criterion, evidence side, and cited source. Include exactly one sources module covering every cited source ID.",
    "A requested chart or plot requires chart content. A requested timeline requires timeline content. Comparison charts and tables must retain exactly aligned data references.",
    weatherBackedComparison
      ? "This comparison is weather-backed. Use only manifest location, forecast, metric, and source references; do not author numeric measurements."
      : "Research and authored comparison prose must remain bounded and retain its issued source IDs.",
    ...(contract.twoSidedClaims
      ? ["This request requires both support and challenge stances in evidence content."]
      : []),
    ...(researchChangeManifest
      ? [
          "This change brief uses a compiler-issued researchChangeManifest. Copy its subject, lead summary, render-unit findings, titles, stances, and source IDs exactly once and unchanged into lead, evidence, and sources content.",
        ]
      : []),
    "Return one complete object matching the supplied JSON Schema.",
  ].join(" ");
}

function initialGenerativeCompositionInput(payload: Record<string, unknown>): string {
  return [
    "Create the best purposeful GenerativeSurfacePlan v3 for this request and evidence.",
    "Evidence and presentation-atom payload:",
    JSON.stringify(payload),
  ].join("\n\n");
}

function repairGenerativeCompositionInput(
  payload: Record<string, unknown>,
  failure: GenerativeValidationFailure,
): string {
  return [
    "Repair the invalid generative surface plan. Return a complete replacement plan, not a patch.",
    `Validation issues: ${JSON.stringify(failure.issues.slice(0, 8))}`,
    `Invalid output: ${failure.rawOutput.slice(0, 32_000)}`,
    `Original bounded payload: ${JSON.stringify(payload)}`,
  ].join("\n\n");
}

function generativeQualityChecks(
  plan: GenerativeSurfacePlan,
  spec: SurfaceSpec,
  prompt: string,
  retrieval: GeminiRetrievalResult,
  clientContext: ClientContext,
): readonly GenerativeQualityCheck[] {
  const evaluated = evaluateGenerativeSurfacePlanQuality(
    plan,
    { sources: retrieval.sources, evidence: retrieval.evidence, prompt, clientContext },
    spec,
  );
  return Object.freeze(
    Object.entries(evaluated).map(([code, passed]) => ({
      code: code as GenerativeSurfaceQualityCode,
      passed,
    })),
  );
}

export async function composeGenerativeSurfacePlan({
  gemini,
  prompt,
  clientContext,
  retrieval,
  signal,
}: ComposeSurfaceSpecInput): Promise<GenerativeSurfacePlanCompositionResult> {
  const kind = planKindFor(prompt, retrieval);
  const weatherBackedComparison = kind === "comparison" && retrieval.evidence.length > 0;
  const contract = resolvedPlanContract(kind, prompt, weatherBackedComparison);
  let researchChangeManifest: ResearchChangeManifest | undefined;
  if (contract.preserveIndependentDirectionalChanges) {
    const manifestResult = buildResearchChangeManifest({
      prompt,
      sources: retrieval.sources,
      searchEvidence: retrieval.searchEvidence,
    });
    if (manifestResult.status !== "ready") {
      throw new CompositionValidationError([
        `Resolved change manifest is unavailable: ${manifestResult.reason}.`,
      ]);
    }
    researchChangeManifest = manifestResult.manifest;
  }
  const projection = surfacePlanEvidencePayload(
    prompt,
    clientContext,
    retrieval,
    researchChangeManifest,
  );
  const payload = {
    ...projection.payload,
    presentationAtoms: presentationAtomManifest(projection.weatherManifest, retrieval),
  };
  const generator = gemini.structuredOutput;
  if (!generator) throw new GeminiProviderError("Gemini structured composition is unavailable.");

  let input = initialGenerativeCompositionInput(payload);
  let firstFailure: GenerativeValidationFailure | undefined;
  const schemaIssues: SurfacePlanSchemaIssueDiagnostic[] = [];

  for (const repairCount of [0, 1] as const) {
    let output: { text?: string };
    try {
      output = await generator.generate({
        input,
        systemInstruction: generativeSurfaceInstruction(
          kind,
          contract,
          weatherBackedComparison,
          researchChangeManifest,
        ),
        schema: generativeSurfacePlanResponseSchema(kind, weatherBackedComparison, contract, {
          sourceIds: retrieval.sources.map((source) => source.id),
          weatherManifest: projection.weatherManifest,
          researchChangeManifest,
        }),
        functionName: "emit_generative_surface_plan",
        signal,
      });
    } catch (error) {
      if (error instanceof GeminiProviderError) throw error;
      throw new GeminiProviderError("Gemini generative composition request failed.", { cause: error });
    }

    const validation = validateGenerativeComposition(
      output.text ?? "",
      prompt,
      clientContext,
      retrieval,
    );
    if (validation.success) {
      let spec: SurfaceSpec;
      try {
        spec = compileGenerativeSurfacePlan({
          plan: validation.plan,
          retrieval,
          clientContext,
          prompt,
        });
      } catch {
        const failure: GenerativeValidationFailure = {
          success: false,
          category: "compilation",
          codes: ["compilation_failed"],
          issues: ["The GenerativeSurfacePlan could not be compiled within the trusted catalog limits."],
          rawOutput: output.text ?? "",
        };
        firstFailure ??= failure;
        if (repairCount === 0) input = repairGenerativeCompositionInput(payload, failure);
        continue;
      }
      const qualityChecks = generativeQualityChecks(
        validation.plan,
        spec,
        prompt,
        retrieval,
        clientContext,
      );
      const failed = qualityChecks.filter((check) => !check.passed);
      if (failed.length > 0) {
        const failure: GenerativeValidationFailure = {
          success: false,
          category: "quality",
          codes: failed.map((check) => check.code),
          issues: failed.map((check) => boundedIssue(`Generative surface quality check failed: ${check.code}.`)),
          rawOutput: output.text ?? "",
        };
        firstFailure ??= failure;
        if (repairCount === 0) input = repairGenerativeCompositionInput(payload, failure);
        continue;
      }
      const rootLayout = validation.plan.layout.nodes.find(
        (node) => node.id === validation.plan.layout.rootId,
      );
      return {
        plan: validation.plan,
        spec,
        repairCount,
        fallbackUsed: false,
        firstFailureCategory: firstFailure?.category ?? "none",
        firstFailureCodes: firstFailure?.codes ?? [],
        schemaIssues: Object.freeze(schemaIssues.slice(0, 8)),
        metadata: {
          compositionMode: "grammar-v3",
          ...(validation.plan.archetypeHint ? { recipeId: validation.plan.archetypeHint } : {}),
          density: validation.plan.density,
          emphasis: validation.plan.emphasis,
          layoutFamily: rootLayout?.type ?? "unknown",
          contentNodeCount: validation.plan.content.length,
          layoutNodeCount: validation.plan.layout.nodes.length,
          qualityChecks,
          repairCategory: repairCount === 0 ? "none" : "semantic",
          compilerResult: "compiled",
        },
      };
    }

    if (validation.schemaIssues) {
      schemaIssues.push(
        ...validation.schemaIssues.map((issue) => ({ ...issue, attempt: repairCount })),
      );
    }
    firstFailure ??= validation;
    if (repairCount === 0) input = repairGenerativeCompositionInput(payload, validation);
  }

  try {
    const builtFallback = researchChangeManifest
      ? buildResearchChangeFallbackPlan(researchChangeManifest)
      : buildFallbackSurfacePlan({ kind, prompt, retrieval, clientContext });
    // The contract's density can be tighter than the content the fallback carries
    // (for example, a brief density over eight search sources). Try the contract
    // density first, then progressively roomier budgets before giving up.
    const densities = [
      ...new Set([contract.density, builtFallback.density, "balanced", "detailed"]),
    ].filter((density): density is SurfacePlan["density"] => Boolean(density));
    let failed: string[] = [];
    let accepted:
      | { fallbackPlan: SurfacePlan; fallbackSpec: ReturnType<typeof compileSurfacePlan>; qualityChecks: ReturnType<typeof planQualityChecks> }
      | undefined;
    for (const density of densities) {
      const candidatePlan = SurfacePlanSchema.parse({
        ...builtFallback,
        ...(contract.recipeId ? { recipeId: contract.recipeId } : {}),
        density,
        ...(contract.emphasis ? { emphasis: contract.emphasis } : {}),
      });
      const candidateSpec = compileSurfacePlan({
        plan: candidatePlan,
        retrieval,
        clientContext,
        prompt,
      });
      const candidateChecks = planQualityChecks(
        candidatePlan,
        candidateSpec,
        prompt,
        retrieval,
        clientContext,
      );
      failed = candidateChecks.filter((check) => !check.passed).map((check) => check.code);
      if (failed.length === 0) {
        accepted = { fallbackPlan: candidatePlan, fallbackSpec: candidateSpec, qualityChecks: candidateChecks };
        break;
      }
      if (!failed.every((code) => code === "content_budget")) break;
    }
    if (!accepted) {
      throw new TypeError(`The deterministic plan-v2 fallback failed a quality check: ${failed.join(" ")}`);
    }
    const { fallbackPlan, fallbackSpec, qualityChecks } = accepted;
    return {
      fallbackPlan,
      spec: fallbackSpec,
      repairCount: 1,
      fallbackUsed: true,
      firstFailureCategory: firstFailure?.category ?? "none",
      firstFailureCodes: firstFailure?.codes ?? [],
      schemaIssues: Object.freeze(schemaIssues.slice(0, 8)),
      metadata: {
        compositionMode: "grammar-v3",
        recipeId: fallbackPlan.recipeId,
        density: fallbackPlan.density,
        emphasis: fallbackPlan.emphasis,
        layoutFamily: "plan-v2-fallback",
        contentNodeCount: fallbackPlan.modules.length,
        layoutNodeCount: 0,
        qualityChecks,
        repairCategory: firstFailure ? "semantic" : "none",
        compilerResult: "deterministic-fallback",
      },
    };
  } catch (error) {
    const v3Failure = firstFailure
      ? ` Grammar v3 first failed with ${firstFailure.category}: ${(firstFailure.codes ?? []).join(" ") || "none"} at ${
          schemaIssues.slice(0, 2).map((issue) => `${issue.path} ${issue.code}`).join(" ") || "no schema path"
        }.`
      : "";
    throw new CompositionValidationError([
      `The deterministic plan-v2 fallback could not be compiled safely.${v3Failure}`,
    ], { cause: error });
  }
}
