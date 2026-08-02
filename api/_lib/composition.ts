import { LIMITS } from "../../shared/constants.js";
import type { TRUSTED_COMPONENT_NAMES } from "../../shared/constants.js";
import type { ClientContext, SourceRecord, SurfaceSpec } from "../../shared/schemas.js";
import { validateSurfaceSpec } from "../../shared/surface-validation.js";
import {
  GeminiProviderError,
  type GeminiClient,
  type GeminiRetrievalResult,
} from "./gemini.js";

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
  description: `Non-empty text of at most ${maximum} characters.`,
});

const optionalBoundedString = (maximum: number): JsonSchema => ({
  type: "string",
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
const childrenSchema = arraySchema(idSchema, 1, 20);
const sourceIdsSchema = arraySchema(sourceIdSchema, 1, LIMITS.sources);

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
  return /\b(compare|comparison|versus|vs\.?|better|difference)\b/i.test(prompt);
}

function compositionKind(prompt: string, retrieval: GeminiRetrievalResult): CompositionKind {
  if (requestedComparison(prompt)) return "comparison";
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
    "Return only the JSON object required by response_format.",
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

  constructor(issues: readonly string[]) {
    super("Gemini could not produce a valid SurfaceSpec after one repair attempt.");
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
