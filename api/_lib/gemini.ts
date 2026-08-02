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
const STRUCTURED_OUTPUT_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const WEATHER_TOOL = {
  type: "function",
  name: "get_weather_bundle",
  description:
    "Gets normalized current conditions, hourly and daily forecasts, and public weather alerts for one location.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      location: {
        type: "string",
        description: "A city, region, postal code, or other human-readable place name.",
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
  "Do not invent tool results. After retrieval, return a concise factual evidence summary; do not generate UI component JSON.",
].join(" ");

const WeatherArgumentsInputSchema = z
  .object({
    location: z.string().trim().min(1).max(200).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    units: UnitsSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasLatitude = value.latitude !== undefined;
    const hasLongitude = value.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "latitude and longitude must be provided together",
      });
    }
    if (!value.location && !hasLatitude) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a location or coordinates are required",
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
  fetchImpl?: typeof fetch;
}

export interface GeminiStructuredOutputRequest {
  input: string;
  systemInstruction: string;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface GetWeatherBundleArguments {
  location?: string;
  latitude?: number;
  longitude?: number;
  units: "imperial" | "metric";
}

export interface WeatherToolExecutionResult {
  data: unknown;
  sources?: readonly SourceRecord[];
}

export type WeatherToolExecutor = (
  arguments_: Readonly<GetWeatherBundleArguments>,
) => Promise<WeatherToolExecutionResult>;

export interface WeatherEvidence {
  tool: "get_weather_bundle";
  arguments: Readonly<GetWeatherBundleArguments>;
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

export class GeminiStructuredOutputError extends GeminiProviderError {
  readonly providerCode: string;

  constructor(providerCode: string) {
    super("Gemini rejected the structured-output request.");
    this.name = "GeminiStructuredOutputError";
    this.providerCode = providerCode;
  }
}

export class GeminiToolRoundLimitError extends GeminiProviderError {
  constructor() {
    super(`Gemini requested more than ${LIMITS.toolRounds} custom-tool rounds.`);
    this.name = "GeminiToolRoundLimitError";
  }
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

const StructuredInteractionResponseSchema = z
  .object({
    status: z.string(),
    output_text: z.string().optional(),
    steps: z.array(
      z
        .object({
          type: z.string(),
          content: z
            .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function generatedText(payload: unknown): string {
  const parsed = StructuredInteractionResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GeminiProviderError("Gemini returned an invalid structured-output response.");
  }
  if (parsed.data.status !== "completed") {
    throw new GeminiProviderError(
      `Gemini returned status ${parsed.data.status}; expected completed.`,
    );
  }

  const text = (parsed.data.output_text ?? parsed.data.steps
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .map((part) => part.text ?? "")
    .join("")
  ).trim();
  if (!text) throw new GeminiProviderError("Gemini returned an empty structured-output response.");
  return text;
}

function structuredOutputErrorCode(status: number, body: string): string {
  const normalized = body.toLowerCase();
  if (/response[_ ]?format/.test(normalized)) return "PROVIDER_RESPONSE_FORMAT";
  if (/schema/.test(normalized) && /(complex|large|deep|depth|nested|too many)/.test(normalized)) {
    return "PROVIDER_SCHEMA_COMPLEXITY";
  }
  if (/schema/.test(normalized)) return "PROVIDER_SCHEMA_REJECTED";
  if (/(api key|authentication|permission|credential)/.test(normalized)) return "PROVIDER_AUTH";
  if (/(quota|rate limit|resource exhausted)/.test(normalized)) return "PROVIDER_QUOTA";
  if (/(model).*(not found|unsupported|unavailable)/.test(normalized)) {
    return "PROVIDER_MODEL_UNAVAILABLE";
  }
  return `PROVIDER_HTTP_${status}`;
}

export function createGeminiProvider(options: GeminiProviderOptions = {}): GeminiClient {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiProviderError("GEMINI_API_KEY is not configured.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const sdk = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: STABLE_API_VERSION },
  });

  return {
    interactions: sdk.interactions as GeminiClient["interactions"],
    structuredOutput: {
      async generate(request) {
        const response = await fetchImpl(STRUCTURED_OUTPUT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            model: MODEL_ID,
            store: false,
            input: request.input,
            system_instruction: request.systemInstruction,
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: request.schema,
            },
          }),
          signal: request.signal,
        });

        if (!response.ok) {
          throw new GeminiStructuredOutputError(
            structuredOutputErrorCode(response.status, await response.text()),
          );
        }

        return { text: generatedText(await response.json()) };
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

    for (const functionCall of functionCalls) {
      if (functionCall.name !== "get_weather_bundle") {
        throw new GeminiProviderError(`Gemini requested an unsupported function: ${functionCall.name}`);
      }

      const arguments_ = validateWeatherArguments(functionCall.arguments, clientContext.units);
      const execution = await executeWeather(arguments_);
      const normalizedSources = normalizeWeatherSources(execution.sources);
      weatherSources.push(...normalizedSources);
      evidence.push(
        Object.freeze({
          tool: "get_weather_bundle" as const,
          arguments: arguments_,
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
