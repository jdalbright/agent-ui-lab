import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRequest } from "../../shared/schemas.js";
import type * as CompositionModule from "../../api/_lib/composition.js";
import type { GeminiClient } from "../../api/_lib/gemini.js";
import type { ServerRequest, ServerResponse } from "../../api/_lib/http-types.js";

const providerMocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  composeSurfacePlan: vi.fn(),
  composeSurfaceSpec: vi.fn(),
  createGeminiProvider: vi.fn(),
  logEvent: vi.fn(),
  readRuntimeConfig: vi.fn(),
  runGeminiRetrieval: vi.fn(),
  structuredGenerate: vi.fn(),
}));

vi.mock("../../api/_lib/composition.js", async (importOriginal) => {
  const composition = await importOriginal<typeof CompositionModule>();
  return {
    ...composition,
    composeSurfacePlan: providerMocks.composeSurfacePlan,
    composeSurfaceSpec: providerMocks.composeSurfaceSpec,
  };
});

vi.mock("../../api/_lib/gemini.js", () => ({
  GeminiProviderError: class MockGeminiProviderError extends Error {},
  createGeminiProvider: providerMocks.createGeminiProvider,
  runGeminiRetrieval: providerMocks.runGeminiRetrieval,
}));

vi.mock("../../api/_lib/logger.js", () => ({ logEvent: providerMocks.logEvent }));
vi.mock("../../api/_lib/rate-limit.js", () => ({ checkRateLimit: providerMocks.checkRateLimit }));
vi.mock("../../api/_lib/runtime-config.js", () => ({
  readRuntimeConfig: providerMocks.readRuntimeConfig,
}));

import handler from "../../api/agent.js";

const CONTEXT_SECRET = "test-only-context-secret-with-32-characters";
const ORIGIN = "https://lab.jalbright.dev";
const client: AgentRequest["client"] = {
  sizeClass: "medium",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

function requestFor(prompt: string): ServerRequest {
  return {
    method: "POST",
    headers: { origin: ORIGIN },
    body: {
      requestId: "10000000-0000-4000-8000-000000000099",
      prompt,
      client,
    },
    socket: { remoteAddress: "127.0.0.1" },
    on: vi.fn(),
  };
}

function responseRecorder(): ServerResponse & { chunks: string[] } {
  const response: ServerResponse & { chunks: string[] } = {
    statusCode: 200,
    chunks: [],
    setHeader: vi.fn(),
    status(code) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn(),
    write(chunk) {
      this.chunks.push(String(chunk));
      return true;
    },
    flushHeaders: vi.fn(),
    end: vi.fn(),
  };
  return response;
}

function events(response: { chunks: string[] }) {
  return response.chunks
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; code?: string; retryable?: boolean; message?: unknown });
}

function providerFailure(status: number, message: string): Error {
  return Object.assign(new Error(message), { name: "ApiError", status });
}

describe("agent provider limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const gemini: GeminiClient = {
      interactions: { create: vi.fn() },
      structuredOutput: { generate: providerMocks.structuredGenerate },
    };
    providerMocks.readRuntimeConfig.mockReturnValue({
      ready: true,
      config: {
        mode: "test",
        isProduction: false,
        geminiApiKey: "test-gemini-key",
        googleMapsApiKey: "test-maps-key",
        contextEncryptionSecret: CONTEXT_SECRET,
        allowedOrigins: [ORIGIN],
        allowDemoFixtures: false,
        surfaceComposerVersion: "plan-v2",
      },
      metadata: {
        environment: "test",
        providers: "live",
        rateLimit: "memory",
        context: "encrypted",
        fixtures: "disabled",
      },
    });
    providerMocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 });
    providerMocks.createGeminiProvider.mockReturnValue(gemini);
  });

  it("explains a reached monthly spend cap without offering a retry", async () => {
    providerMocks.runGeminiRetrieval.mockRejectedValue(
      providerFailure(429, "429 RESOURCE_EXHAUSTED: Your project has exceeded its monthly spending cap."),
    );
    const response = responseRecorder();

    await handler(requestFor("What changed in Gemini 4 Hydrogen?"), response);

    const streamed = events(response);
    const error = streamed.find((event) => event.type === "error");
    expect(error).toMatchObject({ code: "PROVIDER_LIMIT", retryable: false });
    expect(JSON.stringify(streamed)).toContain("The live demo is resting until next month");
    expect(streamed.at(-1)).toMatchObject({ type: "done", mode: "safe-fallback" });
    expect(providerMocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PROVIDER_LIMIT", errorReason: "limit:paused" }),
    );
  });

  it("treats empty prepaid credit like a reached cap", async () => {
    providerMocks.runGeminiRetrieval.mockRejectedValue(providerFailure(402, "Payment required"));
    const response = responseRecorder();

    await handler(requestFor("What changed in Gemini 4 Hydrogen?"), response);

    expect(events(response).find((event) => event.type === "error")).toMatchObject({
      code: "PROVIDER_LIMIT",
      retryable: false,
    });
  });

  it("asks people to retry shortly when a rate limit is hit", async () => {
    providerMocks.runGeminiRetrieval.mockRejectedValue(
      providerFailure(429, "429 RESOURCE_EXHAUSTED: Resource has been exhausted (e.g. check quota)."),
    );
    const response = responseRecorder();

    await handler(requestFor("What changed in Gemini 4 Hydrogen?"), response);

    const streamed = events(response);
    expect(streamed.find((event) => event.type === "error")).toMatchObject({
      code: "PROVIDER_LIMIT",
      retryable: true,
    });
    expect(JSON.stringify(streamed)).toContain("The live demo is busy");
  });
});
