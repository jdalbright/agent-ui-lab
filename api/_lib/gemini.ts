import { createHash } from "node:crypto";
import { GoogleGenAI, type Interactions } from "@google/genai";
import { z } from "zod";
import { LIMITS, MODEL_ID } from "../../shared/constants.js";
import { canonicalizeSafeExternalHttpsUrl } from "../../shared/safe-url.js";
import {
  SourceRecordSchema,
  UnitsSchema,
  type ClientContext,
  type SourceRecord,
} from "../../shared/schemas.js";

const STABLE_API_VERSION = "v1" as const;
export type StructuredOutputFunctionName = "emit_surface_spec" | "emit_surface_plan";

const DEFAULT_STRUCTURED_OUTPUT_FUNCTION: StructuredOutputFunctionName = "emit_surface_spec";

const WEATHER_TOOL = {
  type: "function",
  name: "get_weather_bundle",
  description:
    "Gets normalized current conditions, requested hourly and daily forecasts, public alerts, and deterministic activity-window scores for one to four locations.",
  parameters: {
    type: "object",
    description:
      "Provide exactly one location mode: legacy location, locations with one to four names, or both latitude and longitude. The server rejects mixed or partial modes.",
    additionalProperties: false,
    properties: {
      location: {
        type: "string",
        description: "Legacy single city, region, postal code, or other human-readable place name.",
      },
      locations: {
        type: "array",
        minItems: 1,
        maxItems: LIMITS.locations,
        items: { type: "string", minLength: 1, maxLength: 200 },
        description: "One to four named places, in the same order the user requested them.",
      },
      latitude: {
        type: "number",
        minimum: -90,
        maximum: 90,
      },
      longitude: {
        type: "number",
        minimum: -180,
        maximum: 180,
      },
      units: {
        type: "string",
        enum: ["imperial", "metric"],
      },
      hours: {
        type: "integer",
        minimum: 1,
        maximum: 240,
        description: "Number of hourly forecast records required by the request. Use 24 for a snapshot.",
      },
      days: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Number of daily forecast records required by the request. Seven-day requests must use 7.",
      },
      activity: {
        type: "string",
        minLength: 1,
        maxLength: 60,
        description: "User-requested activity label, such as run, walk, hike, or outdoor dinner.",
      },
      durationHours: {
        type: "integer",
        minimum: 1,
        maximum: 6,
        description: "Requested activity duration in whole hours.",
      },
      targetLocalTime: {
        type: "string",
        pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
        description: "Optional requested local start time in 24-hour HH:MM format, such as 07:00.",
      },
      targetDayOffset: {
        type: "integer",
        minimum: 0,
        maximum: 9,
        description: "Optional local calendar-day offset: today is 0 and tomorrow is 1.",
      },
    },
  },
} satisfies Interactions.Tool;

const GOOGLE_SEARCH_TOOL = {
  type: "google_search",
} satisfies Interactions.Tool;

const RETRIEVAL_TOOLS = [WEATHER_TOOL, GOOGLE_SEARCH_TOOL] satisfies Interactions.Tool[];

const RETRIEVAL_INSTRUCTION = [
  "You are the retrieval and tool-routing stage for a trusted UI composer.",
  "Use get_weather_bundle for current conditions, forecasts, public alerts, or weather-dependent recommendations.",
  "Use google_search for current public-web facts, research, or comparisons that need source grounding.",
  "Use both tools when the request needs both weather data and broader current context.",
  `For named weather comparisons, send all requested places in one locations array, with no more than ${LIMITS.locations} entries.`,
  "Preserve explicitly requested hourly or daily ranges in hours and days; a seven-day outlook uses days=7.",
  "For weather-dependent activities, preserve the user's activity label and whole-hour duration. If they name a time or relative day, also send targetLocalTime in local HH:MM form and targetDayOffset where today=0 and tomorrow=1.",
  "Do not invent tool results. After retrieval, return a concise factual evidence summary; do not generate UI component JSON.",
].join(" ");

const strictInteger = (minimum: number, maximum: number) =>
  z.number().int().min(minimum).max(maximum);

const WeatherArgumentsInputSchema = z
  .object({
    location: z.string().trim().min(1).max(200).optional(),
    locations: z.array(z.string().trim().min(1).max(200)).min(1).max(LIMITS.locations).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    units: UnitsSchema.optional(),
    hours: strictInteger(1, 240).optional(),
    days: strictInteger(1, 10).optional(),
    activity: z.string().trim().min(1).max(60).optional(),
    durationHours: strictInteger(1, 6).optional(),
    targetLocalTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
    targetDayOffset: strictInteger(0, 9).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasLatitude = value.latitude !== undefined;
    const hasLongitude = value.longitude !== undefined;
    const hasLegacyLocation = value.location !== undefined;
    const hasLocationList = value.locations !== undefined;
    const namedLocations = [value.location, ...(value.locations ?? [])].filter(
      (location): location is string => Boolean(location),
    );
    const uniqueLocations = new Set(
      namedLocations.map((location) => location.toLocaleLowerCase("en-US")),
    );
    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "latitude and longitude must be provided together",
      });
    }
    const locationModes =
      Number(hasLegacyLocation) + Number(hasLocationList) + Number(hasLatitude && hasLongitude);
    if (locationModes !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactly one of location, locations, or a coordinate pair is required",
      });
    }
    if (namedLocations.length === 0 && !hasLatitude) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a location or coordinates are required",
      });
    }
    if (namedLocations.length > LIMITS.locations) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `no more than ${LIMITS.locations} named locations are supported`,
      });
    }
    if (uniqueLocations.size !== namedLocations.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "named locations must be unique",
      });
    }
    if (hasLatitude && namedLocations.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "coordinates cannot be combined with named locations",
      });
    }
    if (value.targetLocalTime && value.targetDayOffset === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetDayOffset is required with targetLocalTime",
      });
    }
  });

export interface GeminiInteraction
  extends Pick<Interactions.Interaction, "id" | "status" | "output_text" | "usage"> {
  steps: Interactions.Step[];
}

export interface GeminiClient {
  interactions: {
    create(
      request: Interactions.CreateModelInteractionParamsNonStreaming,
    ): Promise<GeminiInteraction>;
  };
  structuredOutput?: {
    generate(request: GeminiStructuredOutputRequest): Promise<{ text: string }>;
  };
}

export interface GeminiProviderOptions {
  apiKey?: string;
}

export interface GeminiStructuredOutputRequest {
  input: string;
  systemInstruction: string;
  schema: Record<string, unknown>;
  functionName?: StructuredOutputFunctionName;
  signal?: AbortSignal;
}

export interface GetWeatherBundleArguments {
  location?: string;
  locations?: readonly string[];
  latitude?: number;
  longitude?: number;
  units: "imperial" | "metric";
  hours?: number;
  days?: number;
  activity?: string;
  durationHours?: number;
  targetLocalTime?: string;
  targetDayOffset?: number;
}

export interface WeatherToolExecutionResult {
  data: unknown;
  sources?: readonly SourceRecord[];
  traceArguments?: Readonly<Record<string, unknown>>;
}

export type WeatherToolExecutor = (
  arguments_: Readonly<GetWeatherBundleArguments>,
) => Promise<WeatherToolExecutionResult>;

export interface WeatherEvidence {
  tool: "get_weather_bundle";
  arguments: Readonly<GetWeatherBundleArguments>;
  traceArguments?: Readonly<Record<string, unknown>>;
  result: unknown;
}

export interface GeminiRetrievalResult {
  outputText: string;
  steps: readonly Interactions.Step[];
  sources: readonly SourceRecord[];
  evidence: readonly WeatherEvidence[];
  toolRounds: number;
}

export interface RunGeminiRetrievalInput {
  gemini: GeminiClient;
  prompt: string;
  clientContext: ClientContext;
  executeWeather: WeatherToolExecutor;
  now?: () => Date;
}

export class GeminiProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GeminiProviderError";
  }
}

export class GeminiToolRoundLimitError extends GeminiProviderError {
  constructor() {
    super(`Gemini requested more than ${LIMITS.toolRounds} custom-tool rounds.`);
    this.name = "GeminiToolRoundLimitError";
  }
}

export function structuredOutputFromInteraction(
  interaction: GeminiInteraction,
  functionName: StructuredOutputFunctionName = DEFAULT_STRUCTURED_OUTPUT_FUNCTION,
): string {
  const calls = interaction.steps.filter(
    (step): step is Interactions.FunctionCallStep =>
      step.type === "function_call" && step.name === functionName,
  );
  if (interaction.status !== "requires_action" || calls.length !== 1) {
    throw new GeminiProviderError(`Gemini did not emit exactly one ${functionName} result.`);
  }
  const serialized = JSON.stringify(calls[0]?.arguments);
  if (!serialized) throw new GeminiProviderError(`Gemini emitted invalid ${functionName} arguments.`);
  return serialized;
}

function assertInteractionStatus(
  interaction: GeminiInteraction,
  expected: "completed" | "requires_action",
): void {
  if (interaction.status !== expected) {
    throw new GeminiProviderError(
      `Gemini returned status ${interaction.status}; expected ${expected}.`,
    );
  }
}

export function createGeminiProvider(options: GeminiProviderOptions = {}): GeminiClient {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiProviderError("GEMINI_API_KEY is not configured.");
  const sdk = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: STABLE_API_VERSION },
  });

  return {
    interactions: sdk.interactions as GeminiClient["interactions"],
    structuredOutput: {
      async generate(request) {
        if (request.signal?.aborted) throw new DOMException("Request timed out", "AbortError");
        const functionName = request.functionName ?? DEFAULT_STRUCTURED_OUTPUT_FUNCTION;
        const interaction = await sdk.interactions.create({
          model: MODEL_ID,
          store: false,
          input: [
            {
              type: "user_input",
              content: [{ type: "text", text: request.input }],
            },
          ],
          system_instruction: [
            request.systemInstruction,
            `Call ${functionName} exactly once. Do not return narrative text.`,
          ].join(" "),
          tools: [
            {
              type: "function",
              name: functionName,
              description:
                functionName === "emit_surface_plan"
                  ? "Emits one complete semantic SurfacePlan for server validation and compilation."
                  : "Emits one complete trusted SurfaceSpec for server validation.",
              parameters: request.schema,
            },
          ],
        });
        return {
          text: structuredOutputFromInteraction(interaction as GeminiInteraction, functionName),
        };
      },
    },
  };
}

function normalizePrompt(prompt: string): string {
  const normalized = prompt.trim();
  if (!normalized || normalized.length > LIMITS.promptCharacters) {
    throw new GeminiProviderError("The retrieval prompt is outside the allowed size.");
  }
  return normalized;
}

function createUserStep(prompt: string, clientContext: ClientContext): Interactions.UserInputStep {
  const context = {
    locale: clientContext.locale,
    timeZone: clientContext.timeZone,
    units: clientContext.units,
    coordinates: clientContext.coordinates
      ? {
          latitude: clientContext.coordinates.latitude,
          longitude: clientContext.coordinates.longitude,
        }
      : undefined,
  };

  return {
    type: "user_input",
    content: [
      {
        type: "text",
        text: `User request:\n${prompt}\n\nClient context:\n${JSON.stringify(context)}`,
      },
    ],
  };
}

function validateWeatherArguments(
  input: unknown,
  defaultUnits: ClientContext["units"],
): Readonly<GetWeatherBundleArguments> {
  const result = WeatherArgumentsInputSchema.safeParse(input);
  if (!result.success) {
    throw new GeminiProviderError("Gemini returned invalid get_weather_bundle arguments.", {
      cause: result.error,
    });
  }

  return Object.freeze({
    ...result.data,
    units: result.data.units ?? defaultUnits,
  });
}

function weatherLocationCount(arguments_: Readonly<GetWeatherBundleArguments>): number {
  return arguments_.locations?.length ?? 1;
}

function serializeToolResult(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("Tool result is not JSON serializable");
    return serialized;
  } catch (error) {
    throw new GeminiProviderError("get_weather_bundle returned a non-JSON result.", {
      cause: error,
    });
  }
}

function outputTextFromSteps(steps: readonly Interactions.Step[]): string {
  const text: string[] = [];
  for (const step of steps) {
    if (step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type === "text") text.push(content.text);
    }
  }
  return text.join("");
}

function sourceId(url: string): string {
  return `src_${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function boundedText(input: string, maximum: number): string {
  return input.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function utf8Slice(text: string, start: number | undefined, end: number | undefined): string | undefined {
  if (start === undefined || end === undefined) return undefined;
  const bytes = new TextEncoder().encode(text);
  const safeStart = Math.max(0, Math.min(start, bytes.length));
  const safeEnd = Math.max(safeStart, Math.min(end, bytes.length));
  const snippet = boundedText(new TextDecoder().decode(bytes.slice(safeStart, safeEnd)), 600);
  return snippet || undefined;
}

export function normalizeGoogleSearchSources(
  steps: readonly Interactions.Step[],
  accessedAt = new Date(),
): readonly SourceRecord[] {
  const records = new Map<string, SourceRecord>();
  const accessedAtIso = accessedAt.toISOString();

  for (const step of steps) {
    if (step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type !== "text") continue;
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "url_citation") continue;
        const url = canonicalizeSafeExternalHttpsUrl(annotation.url);
        if (!url || records.has(url) || records.size >= LIMITS.sources) continue;

        const fallbackTitle = new URL(url).hostname;
        const title = boundedText(annotation.title ?? fallbackTitle, 240) || fallbackTitle;
        const snippet = utf8Slice(content.text, annotation.start_index, annotation.end_index);
        const parsed = SourceRecordSchema.parse({
          id: sourceId(url),
          title,
          url,
          provider: "google-search",
          accessedAt: accessedAtIso,
          ...(snippet ? { snippet } : {}),
        });
        records.set(url, Object.freeze(parsed));
      }
    }
  }

  return Object.freeze([...records.values()]);
}

function normalizeWeatherSources(sources: readonly SourceRecord[] | undefined): readonly SourceRecord[] {
  if (!sources) return Object.freeze([]);
  const parsed = SourceRecordSchema.array().max(LIMITS.sources).parse(sources);
  return Object.freeze(parsed.map((source) => Object.freeze({ ...source })));
}

function combineSources(
  weatherSources: readonly SourceRecord[],
  searchSources: readonly SourceRecord[],
): readonly SourceRecord[] {
  const records = new Map<string, SourceRecord>();
  for (const source of [...weatherSources, ...searchSources]) {
    if (records.size >= LIMITS.sources) break;
    if (!records.has(source.id)) records.set(source.id, source);
  }
  return Object.freeze([...records.values()]);
}

export async function runGeminiRetrieval({
  gemini,
  prompt,
  clientContext,
  executeWeather,
  now = () => new Date(),
}: RunGeminiRetrievalInput): Promise<GeminiRetrievalResult> {
  const history: Interactions.Step[] = [createUserStep(normalizePrompt(prompt), clientContext)];
  const allModelSteps: Interactions.Step[] = [];
  const evidence: WeatherEvidence[] = [];
  const weatherSources: SourceRecord[] = [];
  let toolRounds = 0;
  let weatherToolCalls = 0;
  let weatherLocations = 0;

  while (true) {
    const interaction = await gemini.interactions.create({
      model: MODEL_ID,
      store: false,
      input: history,
      tools: RETRIEVAL_TOOLS,
      system_instruction: RETRIEVAL_INSTRUCTION,
    });

    const returnedSteps = interaction.steps;
    const functionCalls = returnedSteps.filter(
      (step): step is Interactions.FunctionCallStep => step.type === "function_call",
    );
    assertInteractionStatus(interaction, functionCalls.length > 0 ? "requires_action" : "completed");

    history.push(...returnedSteps);
    allModelSteps.push(...returnedSteps);

    if (functionCalls.length === 0) {
      const outputText = interaction.output_text ?? outputTextFromSteps(returnedSteps);
      const searchSources = normalizeGoogleSearchSources(allModelSteps, now());
      return {
        outputText,
        steps: Object.freeze([...allModelSteps]),
        sources: combineSources(weatherSources, searchSources),
        evidence: Object.freeze([...evidence]),
        toolRounds,
      };
    }

    if (toolRounds >= LIMITS.toolRounds) throw new GeminiToolRoundLimitError();
    toolRounds += 1;

    const weatherCalls = functionCalls.map((functionCall) => {
      if (functionCall.name !== "get_weather_bundle") {
        throw new GeminiProviderError(`Gemini requested an unsupported function: ${functionCall.name}`);
      }
      return {
        functionCall,
        arguments: validateWeatherArguments(functionCall.arguments, clientContext.units),
      };
    });
    const nextWeatherToolCalls = weatherToolCalls + weatherCalls.length;
    if (nextWeatherToolCalls > LIMITS.locations) {
      throw new GeminiProviderError(
        `Gemini requested more than ${LIMITS.locations} weather tool calls.`,
      );
    }
    const batchLocations = weatherCalls.reduce(
      (total, call) => total + weatherLocationCount(call.arguments),
      0,
    );
    const nextWeatherLocations = weatherLocations + batchLocations;
    if (nextWeatherLocations > LIMITS.locations) {
      throw new GeminiProviderError(
        `Gemini requested more than ${LIMITS.locations} weather locations.`,
      );
    }
    weatherToolCalls = nextWeatherToolCalls;
    weatherLocations = nextWeatherLocations;

    for (const { functionCall, arguments: arguments_ } of weatherCalls) {
      const execution = await executeWeather(arguments_);
      const normalizedSources = normalizeWeatherSources(execution.sources);
      weatherSources.push(...normalizedSources);
      evidence.push(
        Object.freeze({
          tool: "get_weather_bundle" as const,
          arguments: arguments_,
          ...(execution.traceArguments ? { traceArguments: execution.traceArguments } : {}),
          result: execution.data,
        }),
      );

      const functionResult: Interactions.FunctionResultStep = {
        type: "function_result",
        name: functionCall.name,
        call_id: functionCall.id,
        result: [
          {
            type: "text",
            text: serializeToolResult(execution.data),
          },
        ],
      };
      history.push(functionResult);
    }
  }
}
