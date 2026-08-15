import { beforeEach, describe, expect, it, vi } from "vitest";
import { narrativeDemoSpec } from "../../shared/demo-surfaces.js";
import type { AgentRequest } from "../../shared/schemas.js";
import type * as CompositionModule from "../../api/_lib/composition.js";
import { createContextToken } from "../../api/_lib/context-token.js";
import type { GeminiClient, GeminiRetrievalResult } from "../../api/_lib/gemini.js";
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

function requestFor(prompt: string, contextToken: string): ServerRequest {
  return {
    method: "POST",
    headers: { origin: ORIGIN },
    body: {
      requestId: "10000000-0000-4000-8000-000000000099",
      prompt,
      contextToken,
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

describe("agent follow-up context integrity", () => {
  let gemini: GeminiClient;
  let retrieval: GeminiRetrievalResult;

  beforeEach(() => {
    vi.clearAllMocks();
    gemini = {
      interactions: { create: vi.fn() },
      structuredOutput: { generate: providerMocks.structuredGenerate },
    };
    retrieval = {
      outputText: "The contextual retrieval result is limited to tomorrow.",
      steps: [],
      sources: [],
      evidence: [
        {
          tool: "get_weather_bundle",
          arguments: {
            location: "Raleigh",
            units: "imperial",
            days: 1,
          },
          result: { locations: [] },
        },
      ],
      toolRounds: 0,
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
    providerMocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      retryAfterSeconds: 0,
    });
    providerMocks.createGeminiProvider.mockReturnValue(gemini);
    providerMocks.runGeminiRetrieval.mockResolvedValue(retrieval);
    providerMocks.structuredGenerate.mockResolvedValue({ text: "{}" });
    providerMocks.composeSurfaceSpec.mockImplementation(
      async ({ gemini: compositionGemini }: { gemini: GeminiClient }) => {
        await compositionGemini.structuredOutput?.generate({
          input: "Current-turn composition payload",
          systemInstruction: "Compose a trusted surface.",
          schema: {},
        });
        return { spec: narrativeDemoSpec, repairCount: 0 };
      },
    );
    providerMocks.composeSurfacePlan.mockImplementation(
      async ({ gemini: compositionGemini }: { gemini: GeminiClient }) => {
        await compositionGemini.structuredOutput?.generate({
          input: "Current-turn plan payload",
          systemInstruction: "Compose a trusted plan.",
          schema: {},
          functionName: "emit_surface_plan",
        });
        return {
          spec: narrativeDemoSpec,
          plan: {},
          repairCount: 0,
          fallbackUsed: false,
          metadata: {
            recipeId: "weather.snapshot",
            density: "brief",
            emphasis: "answer",
            qualityChecks: [],
            repairCategory: "none",
            compilerResult: "compiled",
          },
        };
      },
    );
  });

  it("routes a contextual tomorrow follow-up from retrieved weather evidence through plan-v2", async () => {
    const contextToken = createContextToken(CONTEXT_SECRET, [
      {
        intent: "weather",
        summary: "Show Raleigh's five-day outlook.",
        entities: ["Raleigh"],
      },
    ]).token;
    const response = responseRecorder();

    await handler(requestFor("What about tomorrow?", contextToken), response);

    const retrievalCall = providerMocks.runGeminiRetrieval.mock.calls[0]?.[0] as {
      prompt: string;
    };
    expect(retrievalCall.prompt).toMatch(
      /^What about tomorrow\?\n\nPrior compact context .*weather: Show Raleigh's five-day outlook\.$/,
    );
    expect(providerMocks.composeSurfacePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "What about tomorrow?",
        retrieval,
      }),
    );
    expect(providerMocks.composeSurfaceSpec).not.toHaveBeenCalled();
    const structuredCall = providerMocks.structuredGenerate.mock.calls[0]?.[0] as {
      input: string;
    };
    expect(structuredCall.input).toMatch(
      /^Current-turn plan payload\n\nPrior compact context .*weather: Show Raleigh's five-day outlook\.$/,
    );
    const compositionCall = providerMocks.composeSurfacePlan.mock.calls[0]?.[0] as {
      prompt: string;
    };
    expect(compositionCall.prompt).not.toMatch(/five-day/i);
    expect(response.statusCode).toBe(200);
    expect(response.chunks.join("")).toContain('"type":"done"');
  });

  it("passes only the current weather follow-up into plan routing and validation", async () => {
    const contextToken = createContextToken(CONTEXT_SECRET, [
      {
        intent: "weather",
        summary: "Show Raleigh's five-day outlook.",
        entities: ["Raleigh"],
      },
    ]).token;
    const response = responseRecorder();

    await handler(requestFor("Show Raleigh weather tomorrow.", contextToken), response);

    expect(providerMocks.composeSurfacePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Show Raleigh weather tomorrow.",
        retrieval,
      }),
    );
    expect(providerMocks.composeSurfaceSpec).not.toHaveBeenCalled();
    const structuredCall = providerMocks.structuredGenerate.mock.calls[0]?.[0] as {
      input: string;
    };
    expect(structuredCall.input).toContain("Current-turn plan payload\n\nPrior compact context");
    const compositionCall = providerMocks.composeSurfacePlan.mock.calls[0]?.[0] as {
      prompt: string;
    };
    expect(compositionCall.prompt).not.toMatch(/five-day/i);
  });

  it("keeps an explicit narrative with no retrieved domain evidence on spec-v1", async () => {
    const contextToken = createContextToken(CONTEXT_SECRET, [
      {
        intent: "weather",
        summary: "Show Raleigh's five-day outlook.",
        entities: ["Raleigh"],
      },
    ]).token;
    const narrativeRetrieval: GeminiRetrievalResult = {
      outputText: "An adaptive interface changes its presentation for the current need.",
      steps: [],
      sources: [],
      evidence: [],
      toolRounds: 0,
    };
    providerMocks.runGeminiRetrieval.mockResolvedValue(narrativeRetrieval);
    const response = responseRecorder();

    await handler(
      requestFor("Explain adaptive interfaces in plain language.", contextToken),
      response,
    );

    expect(providerMocks.composeSurfaceSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Explain adaptive interfaces in plain language.",
        retrieval: narrativeRetrieval,
      }),
    );
    expect(providerMocks.composeSurfacePlan).not.toHaveBeenCalled();
  });
});
