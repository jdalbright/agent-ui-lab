import { createHash } from "node:crypto";
import { compileSurfaceSpec } from "../shared/compiler.js";
import { classifyCapability } from "../shared/capability.js";
import { createCapabilityBoundarySpec, createClarificationSpec } from "../shared/capability-surfaces.js";
import { LIMITS } from "../shared/constants.js";
import { narrativeDemoSpec, selectDemoSurface } from "../shared/demo-surfaces.js";
import { canonicalizeSafeExternalHttpsUrl } from "../shared/safe-url.js";
import {
  StreamEventSchema,
  type AgentRequest,
  type SourceRecord,
  type StreamEvent,
  type SurfaceSpec,
} from "../shared/schemas.js";
import {
  compositionKind,
  composeGenerativeSurfacePlan,
  composeSurfacePlan,
  composeSurfaceSpec,
  type GenerativeSurfacePlanCompositionMetadata,
  type SurfacePlanCompositionMetadata,
} from "./_lib/composition.js";
import {
  ContextTokenError,
  createContextToken,
  readContextToken,
  sanitizeTurnSummary,
  type TurnSummary,
} from "./_lib/context-token.js";
import {
  geocodeLocations,
  reverseGeocodeLocation,
  type GeocodedLocation,
} from "./_lib/geocoding.js";
import {
  createGeminiProvider,
  GeminiProviderError,
  runGeminiRetrieval,
  type GeminiClient,
  type GetWeatherBundleArguments,
} from "./_lib/gemini.js";
import { providerErrorReason } from "./_lib/provider-error-reason.js";
import { PROVIDER_LIMIT_MESSAGES, providerLimitKind, providerLimitSpec } from "./_lib/provider-limits.js";
import { getWeatherBundle, type WeatherBundle, type WeatherLocation } from "./_lib/google-weather.js";
import type { ServerRequest, ServerResponse } from "./_lib/http-types.js";
import { logEvent } from "./_lib/logger.js";
import { checkRateLimit } from "./_lib/rate-limit.js";
import { scoreActivityWindows } from "./_lib/recommendations.js";
import {
  parseAgentRequest,
  requestIdentity,
  RequestValidationError,
  validateOrigin,
} from "./_lib/request-validation.js";
import { readRuntimeConfig } from "./_lib/runtime-config.js";
import { selectSurfaceComposer } from "./_lib/surface-composer-routing.js";
import { createTrace } from "./_lib/trace.js";
import { parseWeatherRequestIntent, weekdayDayOffset } from "./_lib/weather-request-intent.js";

type PipelineMode = "live" | "recorded-fixture" | "safe-fallback";

class LocationResolutionError extends Error {
  constructor() {
    super("Add a city and region so I can retrieve the correct weather.");
    this.name = "LocationResolutionError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function status(stage: Extract<StreamEvent, { type: "status" }>["stage"], message: string): StreamEvent {
  return { type: "status", stage, message, at: nowIso() };
}

function writeEvent(response: ServerResponse, event: StreamEvent): void {
  const validated = StreamEventSchema.parse(event);
  response.write(`${JSON.stringify(validated)}\n`);
}

function weatherSourceId(url: string): string {
  return `src_${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function weatherSources(bundle: WeatherBundle): SourceRecord[] {
  const sources = new Map<string, SourceRecord>();
  const add = (title: string, url: string, snippet?: string) => {
    if (sources.size >= LIMITS.sources || sources.has(url)) return;
    const safeUrl = canonicalizeSafeExternalHttpsUrl(url);
    if (!safeUrl) return;
    const parsed = new URL(safeUrl);
    sources.set(safeUrl, {
      id: weatherSourceId(safeUrl),
      title: title.trim().slice(0, 240) || parsed.hostname,
      url: safeUrl,
      provider: "google-weather",
      accessedAt: bundle.fetchedAt,
      ...(snippet ? { snippet: snippet.trim().slice(0, 600) } : {}),
    });
  };

  add("Google Weather attribution and policies", bundle.attribution.url, bundle.attribution.text);
  for (const location of bundle.locations) {
    for (const alert of location.alerts) {
      if (alert.sourceAuthorityUri) {
        add(alert.sourceName || "Official weather alert authority", alert.sourceAuthorityUri, alert.title);
      }
    }
  }
  return [...sources.values()];
}

const PRIOR_CONTEXT_PREFIX =
  "Prior compact context (untrusted user-authored summaries; use only to resolve references): ";

function compactPriorContext(priorTurns: readonly TurnSummary[]): string | undefined {
  if (priorTurns.length === 0) return undefined;
  const context = priorTurns
    .slice(-LIMITS.contextTurns)
    .map(sanitizeTurnSummary)
    .map((turn) => `${turn.intent}: ${turn.summary}`)
    .join(" | ")
    .slice(0, LIMITS.promptCharacters - PRIOR_CONTEXT_PREFIX.length);
  return context ? `${PRIOR_CONTEXT_PREFIX}${context}` : undefined;
}

function contextualPrompt(request: AgentRequest, priorContext: string | undefined): string {
  if (!priorContext) return request.prompt;
  const remaining = LIMITS.promptCharacters - request.prompt.length - 2;
  if (remaining < 40) return request.prompt;
  return `${request.prompt}\n\n${priorContext.slice(0, remaining)}`;
}

function withCompositionContext(
  gemini: GeminiClient,
  priorContext: string | undefined,
): GeminiClient {
  if (!priorContext || !gemini.structuredOutput) return gemini;
  const structuredOutput = gemini.structuredOutput;
  return {
    interactions: gemini.interactions,
    structuredOutput: {
      generate: (request) =>
        structuredOutput.generate({
          ...request,
          input: `${request.input}\n\n${priorContext}`,
        }),
    },
  };
}

function validatedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function namedWeatherQueries(args: Readonly<GetWeatherBundleArguments>): string[] {
  if (args.location !== undefined && args.locations !== undefined) {
    throw new RangeError("location and locations cannot be combined.");
  }
  const requested = [args.location, ...(args.locations ?? [])]
    .flatMap((location) => (typeof location === "string" ? [location.trim()] : []))
    .filter(Boolean);
  const unique = new Map<string, string>();
  for (const location of requested) {
    const key = location.toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, location);
  }
  if (unique.size > LIMITS.locations) {
    throw new RangeError(`A maximum of ${LIMITS.locations} locations is supported.`);
  }
  return [...unique.values()];
}

function coarseResolvedLocationName(
  resolved: GeocodedLocation | null | undefined,
  fallback: string,
): string {
  if (!resolved) return fallback;
  const locality = resolved.locality?.trim();
  const region = resolved.region?.trim();
  const country = resolved.countryCode?.trim().toUpperCase();
  if (locality && region) return `${locality}, ${region}`;
  if (locality && country) return `${locality}, ${country}`;
  if (region && country) return `${region}, ${country}`;
  const name = resolved.name.trim().replace(/\s+/g, " ");
  const isRawAddress =
    /^\d+\s/.test(name) ||
    /\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?)\b/i.test(
      name,
    ) ||
    /\b\d{5}(?:-\d{4})?\b/.test(name);
  return !isRawAddress && name.length <= 80 ? name : fallback;
}

function targetForecastFetchHours(
  targetLocalTime: string | undefined,
  targetDayOffset: number | undefined,
  durationHours: number,
  requestedHours: number,
): number {
  if (targetDayOffset === undefined) return requestedHours;
  if (!targetLocalTime) {
    const conservativeSlots = (targetDayOffset + 1) * 24 + 2;
    return Math.max(requestedHours, Math.min(240, conservativeSlots));
  }
  const [targetHour, targetMinute] = targetLocalTime.split(":").map(Number);
  // This is only a bounded fetch budget. Exact validity is checked below against
  // provider slots formatted in the provider-returned IANA time zone.
  const conservativeSlots =
    targetDayOffset * 24 +
    targetHour +
    durationHours +
    (targetMinute > 0 ? 1 : 0) +
    2;
  return Math.max(requestedHours, Math.min(240, conservativeSlots));
}

export async function executeWeather(
  args: Readonly<GetWeatherBundleArguments>,
  request: AgentRequest,
  apiKey: string,
  signal: AbortSignal,
): Promise<{
  data: unknown;
  sources: readonly SourceRecord[];
  traceArguments: Readonly<Record<string, unknown>>;
}> {
  let locations: WeatherLocation[] = [];
  const approvedCoordinates = request.client.coordinates;
  const namedQueries = namedWeatherQueries(args);
  const hasLatitude = args.latitude !== undefined;
  const hasLongitude = args.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    throw new RangeError("latitude and longitude must be provided together.");
  }
  const hasRequestedCoordinates = hasLatitude && hasLongitude;
  const locationModes = Number(namedQueries.length > 0) + Number(hasRequestedCoordinates);
  if (locationModes !== 1) {
    throw new RangeError("Exactly one named-location mode or coordinate pair is required.");
  }

  const durationHours = validatedInteger(args.durationHours, 2, 1, 6, "durationHours");
  const modelTargetDayOffset =
    args.targetDayOffset === undefined
      ? undefined
      : validatedInteger(args.targetDayOffset, 0, 0, 9, "targetDayOffset");
  const requestIntent = parseWeatherRequestIntent(request.prompt);
  // An activity on one named weekday ("my Saturday bike ride") targets that day
  // even when the model omits targetDayOffset, so the scored window matches.
  const namedWeekdayOffset =
    requestIntent.activity &&
    requestIntent.relativeDayOffsets.length === 0 &&
    requestIntent.namedWeekdays.length === 1
      ? weekdayDayOffset(requestIntent.namedWeekdays[0], request.client.timeZone)
      : undefined;
  const promptTargetDayOffset =
    requestIntent.activity && requestIntent.relativeDayOffsets.length === 1
      ? requestIntent.relativeDayOffsets[0]
      : namedWeekdayOffset;
  const targetDayOffset = promptTargetDayOffset ?? modelTargetDayOffset;
  if (args.targetLocalTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(args.targetLocalTime)) {
    throw new RangeError("targetLocalTime must use 24-hour HH:MM format.");
  }
  if (args.targetLocalTime && modelTargetDayOffset === undefined) {
    throw new RangeError("targetDayOffset is required with targetLocalTime.");
  }
  const scopedTargetDayOffset = args.targetLocalTime
    ? targetDayOffset
    : promptTargetDayOffset;
  const requestedHours = validatedInteger(args.hours, 24, 1, 240, "hours");
  const hours = targetForecastFetchHours(
    args.targetLocalTime,
    scopedTargetDayOffset,
    durationHours,
    requestedHours,
  );
  const days = validatedInteger(args.days, 7, 1, 10, "days");

  if (approvedCoordinates && hasRequestedCoordinates && namedQueries.length === 0) {
    const resolved = await reverseGeocodeLocation(
      { latitude: approvedCoordinates.latitude, longitude: approvedCoordinates.longitude },
      { apiKey, locale: request.client.locale, signal },
    );
    locations = [
      {
        name: coarseResolvedLocationName(resolved, "Current location"),
        latitude: approvedCoordinates.latitude,
        longitude: approvedCoordinates.longitude,
        ...(resolved?.placeId ? { placeId: resolved.placeId } : {}),
      },
    ];
  } else if (namedQueries.length > 0 && !hasRequestedCoordinates) {
    const resolvedLocations = await geocodeLocations({
      queries: namedQueries,
      apiKey,
      locale: request.client.locale,
      signal,
    });
    if (resolvedLocations.length !== namedQueries.length) throw new LocationResolutionError();
    locations = resolvedLocations.map((resolved) => ({
      name: coarseResolvedLocationName(resolved, "Resolved location"),
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      ...(resolved.placeId ? { placeId: resolved.placeId } : {}),
    }));
  }

  if (locations.length === 0) throw new LocationResolutionError();
  const bundle = await getWeatherBundle({
    locations,
    apiKey,
    locale: request.client.locale,
    units: args.units,
    signal,
    hours,
    days,
  });
  const activityWindows = scoreActivityWindows(bundle, {
    activity: args.activity ?? "walk",
    durationHours,
    ...(args.targetLocalTime ? { targetLocalTime: args.targetLocalTime } : {}),
    ...(scopedTargetDayOffset === undefined
      ? {}
      : { targetDayOffset: scopedTargetDayOffset }),
  });
  if (scopedTargetDayOffset !== undefined && activityWindows.length !== bundle.locations.length) {
    throw new RangeError(
      "The requested local activity day or window is outside the provider forecast horizon or unavailable.",
    );
  }
  return {
    data: { ...bundle, activityWindows },
    sources: weatherSources(bundle),
    traceArguments: Object.freeze({
      locations: Object.freeze(locations.map((location) => location.name)),
      units: args.units,
      hours,
      days,
      activity: args.activity ?? "walk",
      durationHours,
      ...(args.targetLocalTime ? { targetLocalTime: args.targetLocalTime } : {}),
      ...(scopedTargetDayOffset === undefined
        ? {}
        : { targetDayOffset: scopedTargetDayOffset }),
    }),
  };
}

function safeBody(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return input;
  }
}

function priorTurns(secret: string | undefined, token: string | undefined): TurnSummary[] {
  if (!secret || !token) return [];
  try {
    return [...readContextToken(secret, token).turns];
  } catch (error) {
    if (error instanceof ContextTokenError) return [];
    return [];
  }
}

function appendContext(
  secret: string | undefined,
  turns: readonly TurnSummary[],
  request: AgentRequest,
  spec: SurfaceSpec,
): { token: string; expiresAt: string } | undefined {
  if (!secret || secret.length < 32) return undefined;
  const next = sanitizeTurnSummary({
    intent: spec.kind,
    summary: request.prompt,
    entities: spec.components.flatMap((component) =>
      "location" in component && typeof component.location === "string" ? [component.location] : [],
    ),
  });
  return createContextToken(secret, [...turns, next]);
}

async function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException("Request timed out", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Request timed out", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export default async function handler(request: ServerRequest, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ message: "Method not allowed." });
    return;
  }

  const runtime = readRuntimeConfig();
  if (!runtime.ready) {
    response.setHeader("Cache-Control", "no-store");
    response.status(503).json({
      code: "SERVICE_UNAVAILABLE",
      message: "The agent service is temporarily unavailable.",
      retryable: true,
    });
    return;
  }
  const { config } = runtime;

  let agentRequest: AgentRequest;
  try {
    const originHeader = request.headers.origin;
    validateOrigin(Array.isArray(originHeader) ? originHeader[0] : originHeader, {
      allowedOrigins: config.allowedOrigins.length > 0 ? config.allowedOrigins.join(",") : undefined,
      vercelUrl: process.env.VERCEL_URL,
    });
    agentRequest = parseAgentRequest(safeBody(request.body));
  } catch (error) {
    const code = error instanceof RequestValidationError ? error.code : "INVALID_REQUEST";
    response.status(code === "ORIGIN_REJECTED" ? 403 : 400).json({
      code,
      message: code === "ORIGIN_REJECTED" ? "This origin is not allowed." : "The request is invalid.",
      retryable: false,
    });
    return;
  }

  const contextSecret = config.contextEncryptionSecret;
  let rateLimit;
  try {
    rateLimit = await checkRateLimit({
      identity: requestIdentity(request),
      salt: contextSecret || process.env.VERCEL_PROJECT_ID || "agent-ui-lab-development",
      upstashUrl: config.upstash?.url,
      upstashToken: config.upstash?.token,
    });
  } catch {
    logEvent({ requestId: agentRequest.requestId, stage: "complete", errorCode: "RATE_LIMIT_PROVIDER_ERROR" });
    response.setHeader("Cache-Control", "no-store");
    response.status(503).json({
      code: "SERVICE_UNAVAILABLE",
      message: "The agent service is temporarily unavailable.",
      retryable: true,
    });
    return;
  }
  response.setHeader("X-RateLimit-Remaining", String(rateLimit.remaining));
  if (!rateLimit.allowed) {
    response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    response.status(429).json({ code: "RATE_LIMITED", message: "Too many requests. Try again shortly.", retryable: true });
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, no-transform");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.flushHeaders();

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIMITS.deadlineMs);
  request.on("close", () => controller.abort());
  writeEvent(response, status("accepted", "Request received"));
  writeEvent(
    response,
    {
      type: "trace",
      trace: createTrace({ stage: "request", label: "Understand request", status: "complete" }),
    },
  );

  let mode: PipelineMode = "live";
  let spec: SurfaceSpec;
  let sources: readonly SourceRecord[] = [];
  let repairCount = 0;
  let presentation:
    | SurfacePlanCompositionMetadata
    | GenerativeSurfacePlanCompositionMetadata
    | undefined;
  const turns = priorTurns(contextSecret, agentRequest.contextToken);
  const priorContext = compactPriorContext(turns);
  const capability = classifyCapability(agentRequest.prompt, {
    hasApprovedCoordinates: agentRequest.client.coordinates?.permission === "granted",
  });

  try {
    if (capability.route === "boundary" && capability.boundary) {
      mode = "safe-fallback";
      spec = createCapabilityBoundarySpec(capability.boundary);
      writeEvent(response, status("understanding", "Applying the read-only capability boundary"));
      writeEvent(response, {
        type: "error",
        code: "SAFE_FALLBACK",
        message: "This request is outside the lab’s read-only capability boundary.",
        retryable: false,
      });
    } else if (capability.route === "clarification") {
      mode = "recorded-fixture";
      const reason = capability.reason === "location-required"
        ? "location-required"
        : "comparison-context-required";
      spec = createClarificationSpec(reason);
      writeEvent(response, status("understanding", "Requesting the missing context"));
    } else if (config.geminiApiKey && config.googleMapsApiKey) {
      writeEvent(response, status("understanding", "Selecting trusted tools"));
      const retrievalStarted = Date.now();
      const gemini = createGeminiProvider({ apiKey: config.geminiApiKey });
      const retrieval = await withDeadline(
        runGeminiRetrieval({
          gemini,
          prompt: contextualPrompt(agentRequest, priorContext),
          clientContext: agentRequest.client,
          executeWeather: (args) =>
            executeWeather(args, agentRequest, config.googleMapsApiKey as string, controller.signal),
        }),
        controller.signal,
      );
      sources = retrieval.sources;
      logEvent({ requestId: agentRequest.requestId, stage: "retrieval", durationMs: Date.now() - retrievalStarted, sourceCount: sources.length });
      for (const evidence of retrieval.evidence) {
        writeEvent(response, {
          type: "trace",
          trace: createTrace({
            stage: "tool",
            label: "Get weather bundle",
            status: "complete",
            toolName: evidence.tool,
            arguments: evidence.traceArguments ?? evidence.arguments,
            sourceIds: sources.filter((source) => source.provider === "google-weather").map((source) => source.id),
          }),
        });
      }
      if (sources.some((source) => source.provider === "google-search")) {
        writeEvent(response, {
          type: "trace",
          trace: createTrace({
            stage: "tool",
            label: "Ground with Google Search",
            status: "complete",
            toolName: "google_search",
            sourceIds: sources.filter((source) => source.provider === "google-search").map((source) => source.id),
          }),
        });
      }

      writeEvent(response, status("composing", "Composing the interface"));
      const compositionStarted = Date.now();
      const compositionGemini = withCompositionContext(gemini, priorContext);
      const composerVersion = selectSurfaceComposer(
        config.surfaceComposerVersion,
        compositionKind(agentRequest.prompt, retrieval),
        agentRequest.prompt,
        config.surfaceGrammarV3RolloutPercent,
      );
      if (composerVersion === "grammar-v3") {
        const composition = await withDeadline(
          composeGenerativeSurfacePlan({
            gemini: compositionGemini,
            prompt: agentRequest.prompt,
            clientContext: agentRequest.client,
            retrieval,
            signal: controller.signal,
          }),
          controller.signal,
        );
        spec = composition.spec;
        repairCount = composition.repairCount;
        presentation = composition.metadata;
        if (composition.fallbackUsed) mode = "safe-fallback";
      } else if (composerVersion === "plan-v2") {
        const composition = await withDeadline(
          composeSurfacePlan({
            gemini: compositionGemini,
            prompt: agentRequest.prompt,
            clientContext: agentRequest.client,
            retrieval,
            signal: controller.signal,
          }),
          controller.signal,
        );
        spec = composition.spec;
        repairCount = composition.repairCount;
        presentation = composition.metadata;
        if (composition.fallbackUsed) mode = "safe-fallback";
      } else {
        const composition = await withDeadline(
          composeSurfaceSpec({
            gemini: compositionGemini,
            prompt: agentRequest.prompt,
            clientContext: agentRequest.client,
            retrieval,
            signal: controller.signal,
          }),
          controller.signal,
        );
        spec = composition.spec;
        repairCount = composition.repairCount;
      }
      const compositionDurationMs = Date.now() - compositionStarted;
      writeEvent(response, {
        type: "trace",
        trace: createTrace({
          stage: "composition",
          label: "Compose interface",
          status:
            presentation?.compilerResult === "deterministic-fallback"
              ? "fallback"
              : repairCount === 1
                ? "repaired"
                : "complete",
          durationMs: compositionDurationMs,
          ...presentation,
        }),
      });
      logEvent({
        requestId: agentRequest.requestId,
        stage: "composition",
        durationMs: compositionDurationMs,
        repairCount,
        componentCount: spec.components.length,
        ...(presentation
          ? {
              recipeId: presentation.recipeId,
              density: presentation.density,
              emphasis: presentation.emphasis,
              ...("compositionMode" in presentation
                ? {
                    compositionMode: presentation.compositionMode,
                    layoutFamily: presentation.layoutFamily,
                    contentNodeCount: presentation.contentNodeCount,
                    layoutNodeCount: presentation.layoutNodeCount,
                  }
                : {}),
              validationCategory:
                presentation.compilerResult === "deterministic-fallback" ? "fallback" : "valid",
            }
          : {}),
      });
    } else if (config.allowDemoFixtures || !config.isProduction) {
      mode = "recorded-fixture";
      writeEvent(response, status("retrieving", "Replaying recorded provider evidence"));
      const demo = selectDemoSurface(agentRequest.prompt, capability);
      spec = demo.spec;
      sources = demo.sources;
      writeEvent(response, {
        type: "trace",
        trace: createTrace({
          stage: "tool",
          label: "Replay recorded provider fixture",
          status: "complete",
          toolName: spec.kind === "research" ? "google_search" : "get_weather_bundle",
          sourceIds: sources.map((source) => source.id),
        }),
      });
    } else {
      throw new GeminiProviderError("Live providers are not configured.");
    }

    writeEvent(response, status("validating", "Validating trusted components"));
    const componentNames = spec.components.map((component) => component.component);
    writeEvent(response, {
      type: "trace",
      trace: createTrace({
        stage: "validation",
        label: "Validate A2UI v0.9.1",
        status: repairCount === 1 ? "repaired" : "complete",
        componentNames,
        validation: { valid: true, repairCount, issues: [] },
        ...presentation,
      }),
    });

    writeEvent(response, status("rendering", "Streaming the validated surface"));
    const messages = compileSurfaceSpec({
      surfaceId: `answer-${agentRequest.requestId}`,
      spec,
      sources,
    });
    for (const message of messages) writeEvent(response, { type: "a2ui", message });
    writeEvent(response, {
      type: "trace",
      trace: createTrace({
        stage: "render",
        label: "Render surface",
        status: mode === "safe-fallback" ? "fallback" : "complete",
        componentNames,
      }),
    });

    const context = appendContext(contextSecret, turns, agentRequest, spec);
    if (context) writeEvent(response, { type: "context", ...context });
    const durationMs = Date.now() - startedAt;
    writeEvent(response, {
      type: "done",
      requestId: agentRequest.requestId,
      completedAt: nowIso(),
      durationMs,
      mode,
      componentCount: spec.components.length,
      sourceCount: sources.length,
    });
    logEvent({
      requestId: agentRequest.requestId,
      stage: "complete",
      durationMs,
      repairCount,
      componentCount: spec.components.length,
      sourceCount: sources.length,
      ...(presentation
        ? {
            recipeId: presentation.recipeId,
            density: presentation.density,
            emphasis: presentation.emphasis,
            ...("compositionMode" in presentation
              ? {
                  compositionMode: presentation.compositionMode,
                  layoutFamily: presentation.layoutFamily,
                  contentNodeCount: presentation.contentNodeCount,
                  layoutNodeCount: presentation.layoutNodeCount,
                }
              : {}),
            validationCategory:
              presentation.compilerResult === "deterministic-fallback" ? "fallback" : "valid",
          }
        : {}),
    });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const locationError = error instanceof LocationResolutionError;
    const providerError = error instanceof GeminiProviderError;
    const limitKind = timedOut ? undefined : providerLimitKind(error);
    const code = timedOut
      ? "TIMEOUT"
      : locationError
        ? "LOCATION_AMBIGUOUS"
        : limitKind
          ? "PROVIDER_LIMIT"
          : "PROVIDER_ERROR";
    writeEvent(response, {
      type: "error",
      code,
      message: timedOut
        ? "The request reached its time limit. Try again."
        : locationError
          ? error.message
          : limitKind
            ? PROVIDER_LIMIT_MESSAGES[limitKind]
            : "A provider could not complete the request. A safe fallback is shown.",
      retryable: !locationError && limitKind !== "paused",
    });
    logEvent({
      requestId: agentRequest.requestId,
      stage: "complete",
      durationMs: Date.now() - startedAt,
      errorCode: limitKind ? "PROVIDER_LIMIT" : providerError ? "PROVIDER_ERROR" : code,
      errorReason: timedOut ? "deadline" : limitKind ? `limit:${limitKind}` : providerErrorReason(error),
    });

    if (!timedOut) {
      try {
        const fallbackSpec = limitKind ? providerLimitSpec(limitKind) : narrativeDemoSpec;
        const fallbackMessages = compileSurfaceSpec({
          surfaceId: `answer-${agentRequest.requestId}`,
          spec: fallbackSpec,
          sources: [],
        });
        for (const message of fallbackMessages) writeEvent(response, { type: "a2ui", message });
        writeEvent(response, {
          type: "done",
          requestId: agentRequest.requestId,
          completedAt: nowIso(),
          durationMs: Date.now() - startedAt,
          mode: "safe-fallback",
          componentCount: fallbackSpec.components.length,
          sourceCount: 0,
        });
      } catch {
        // The response is already an explicit provider error; never expose an internal stack.
      }
    }
  } finally {
    clearTimeout(timeout);
    response.end();
  }
}
