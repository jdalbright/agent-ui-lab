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
import { composeSurfaceSpec } from "./_lib/composition.js";
import {
  ContextTokenError,
  createContextToken,
  readContextToken,
  sanitizeTurnSummary,
  type TurnSummary,
} from "./_lib/context-token.js";
import { geocodeLocations, reverseGeocodeLocation } from "./_lib/geocoding.js";
import {
  createGeminiProvider,
  GeminiProviderError,
  GeminiStructuredOutputError,
  runGeminiRetrieval,
  type GetWeatherBundleArguments,
} from "./_lib/gemini.js";
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
import { createTrace } from "./_lib/trace.js";

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

function contextualPrompt(request: AgentRequest, priorTurns: readonly TurnSummary[]): string {
  if (priorTurns.length === 0) return request.prompt;
  const prefix = "Prior compact context: ";
  const context = priorTurns.map((turn) => `${turn.intent}: ${turn.summary}`).join(" | ");
  const remaining = LIMITS.promptCharacters - request.prompt.length - prefix.length - 2;
  if (remaining < 40) return request.prompt;
  return `${request.prompt}\n\n${prefix}${context.slice(0, remaining)}`;
}

async function executeWeather(
  args: Readonly<GetWeatherBundleArguments>,
  request: AgentRequest,
  apiKey: string,
  signal: AbortSignal,
): Promise<{ data: unknown; sources: readonly SourceRecord[] }> {
  let location: WeatherLocation | undefined;
  const approvedCoordinates = request.client.coordinates;

  if (approvedCoordinates && args.latitude !== undefined && args.longitude !== undefined) {
    const resolved = await reverseGeocodeLocation(
      { latitude: approvedCoordinates.latitude, longitude: approvedCoordinates.longitude },
      { apiKey, locale: request.client.locale, signal },
    );
    location = {
      name: resolved?.name || "Current location",
      latitude: approvedCoordinates.latitude,
      longitude: approvedCoordinates.longitude,
      ...(resolved?.placeId ? { placeId: resolved.placeId } : {}),
    };
  } else if (args.location) {
    const [resolved] = await geocodeLocations({
      queries: [args.location],
      apiKey,
      locale: request.client.locale,
      signal,
    });
    if (resolved) {
      location = {
        name: resolved.name,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        ...(resolved.placeId ? { placeId: resolved.placeId } : {}),
      };
    }
  }

  if (!location) throw new LocationResolutionError();
  const bundle = await getWeatherBundle({
    locations: [location],
    apiKey,
    locale: request.client.locale,
    units: args.units,
    signal,
    hours: 24,
    days: 5,
  });
  return {
    data: { ...bundle, activityWindows: scoreActivityWindows(bundle, "walk") },
    sources: weatherSources(bundle),
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
  const turns = priorTurns(contextSecret, agentRequest.contextToken);
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
          prompt: contextualPrompt(agentRequest, turns),
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
            arguments: evidence.arguments,
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
      const composition = await withDeadline(
        composeSurfaceSpec({
          gemini,
          prompt: contextualPrompt(agentRequest, turns),
          clientContext: agentRequest.client,
          retrieval,
          signal: controller.signal,
        }),
        controller.signal,
      );
      spec = composition.spec;
      repairCount = composition.repairCount;
      writeEvent(response, {
        type: "trace",
        trace: createTrace({
          stage: "composition",
          label: "Compose interface",
          status: "complete",
          durationMs: Date.now() - compositionStarted,
        }),
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
    });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const locationError = error instanceof LocationResolutionError;
    const providerError = error instanceof GeminiProviderError;
    const code = timedOut ? "TIMEOUT" : locationError ? "LOCATION_AMBIGUOUS" : "PROVIDER_ERROR";
    writeEvent(response, {
      type: "error",
      code,
      message: timedOut
        ? "The request reached its time limit. Try again."
        : locationError
          ? error.message
          : "A provider could not complete the request. A safe fallback is shown.",
      retryable: !locationError,
    });
    logEvent({
      requestId: agentRequest.requestId,
      stage: "complete",
      durationMs: Date.now() - startedAt,
      errorCode:
        error instanceof GeminiStructuredOutputError
          ? error.providerCode
          : providerError
            ? "PROVIDER_ERROR"
            : code,
    });

    if (!timedOut) {
      try {
        const fallbackMessages = compileSurfaceSpec({
          surfaceId: `answer-${agentRequest.requestId}`,
          spec: narrativeDemoSpec,
          sources: [],
        });
        for (const message of fallbackMessages) writeEvent(response, { type: "a2ui", message });
        writeEvent(response, {
          type: "done",
          requestId: agentRequest.requestId,
          completedAt: nowIso(),
          durationMs: Date.now() - startedAt,
          mode: "safe-fallback",
          componentCount: narrativeDemoSpec.components.length,
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
