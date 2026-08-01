import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRequest, StreamEvent } from "../shared/schemas.js";
import handler from "./agent.js";
import type { ServerRequest, ServerResponse } from "./_lib/http-types.js";
import { resetMemoryRateLimitForTests } from "./_lib/rate-limit.js";

function agentBody(prompt: string): AgentRequest {
  return {
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    prompt,
    client: {
      sizeClass: "expanded",
      locale: "en-US",
      timeZone: "America/New_York",
      units: "imperial",
      reducedMotion: true,
    },
  };
}

function requestFor(prompt: string, method = "POST"): ServerRequest {
  return {
    method,
    headers: {
      origin: "http://127.0.0.1:5173",
      "x-forwarded-for": "203.0.113.20",
    },
    body: agentBody(prompt),
    socket: { remoteAddress: "203.0.113.20" },
    on: () => undefined,
  };
}

function responseRecorder() {
  const headers = new Map<string, string>();
  const chunks: string[] = [];
  let jsonBody: unknown;
  let ended = false;
  const response: ServerResponse = {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
    },
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    flushHeaders() {},
    end() {
      ended = true;
    },
  };
  return {
    response,
    headers,
    chunks,
    get jsonBody() {
      return jsonBody;
    },
    get ended() {
      return ended;
    },
    events(): StreamEvent[] {
      return chunks
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StreamEvent);
    },
  };
}

function useDevelopmentFixtures(): void {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "development");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
  vi.stubEnv("CONTEXT_ENCRYPTION_SECRET", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("ALLOW_DEMO_FIXTURES", "true");
  vi.stubEnv("ALLOWED_ORIGINS", "http://127.0.0.1:5173");
}

describe("POST /api/agent", () => {
  beforeEach(() => {
    resetMemoryRateLimitForTests();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fails closed with a generic response when production is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("CONTEXT_ENCRYPTION_SECRET", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("ALLOWED_ORIGINS", "");

    const result = responseRecorder();
    await handler(requestFor("What is the weather in Raleigh?"), result.response);

    expect(result.response.statusCode).toBe(503);
    expect(result.jsonBody).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "The agent service is temporarily unavailable.",
      retryable: true,
    });
    expect(JSON.stringify(result.jsonBody)).not.toMatch(/gemini|maps|upstash|secret/i);
    expect(result.chunks).toHaveLength(0);
  });

  it("keeps emergency medical prompts out of providers and streams bounded guidance", async () => {
    useDevelopmentFixtures();
    const result = responseRecorder();

    await handler(
      requestFor(
        "I have crushing chest pain and trouble breathing. Is the heat causing it, and can I wait until tomorrow?",
      ),
      result.response,
    );

    const events = result.events();
    expect(events.some((event) => event.type === "error" && event.code === "SAFE_FALLBACK")).toBe(true);
    expect(events.some((event) => event.type === "done" && event.mode === "safe-fallback")).toBe(true);
    expect(JSON.stringify(events)).toMatch(/emergency services right away/i);
    expect(JSON.stringify(events)).toMatch(/do not wait/i);
    expect(JSON.stringify(events)).not.toMatch(/get_weather_bundle|google_search/i);
    expect(result.ended).toBe(true);
  });

  it("streams a deterministic clarification before retrieving ambiguous weather", async () => {
    useDevelopmentFixtures();
    const result = responseRecorder();

    await handler(requestFor("What is the weather today?"), result.response);

    const events = result.events();
    expect(JSON.stringify(events)).toMatch(/LocationPrompt/);
    expect(JSON.stringify(events)).toMatch(/Which city and region should I use/i);
    expect(JSON.stringify(events)).not.toMatch(/google_search|get_weather_bundle/i);
  });

  it("streams the recorded weather contract in non-production without live keys", async () => {
    useDevelopmentFixtures();
    const result = responseRecorder();

    await handler(requestFor("When should I take a walk in Raleigh today?"), result.response);

    const events = result.events();
    expect(events[0]).toMatchObject({ type: "status", stage: "accepted" });
    expect(events.some((event) => event.type === "a2ui" && "createSurface" in event.message)).toBe(true);
    expect(
      events.some((event) => event.type === "done" && event.mode === "recorded-fixture"),
      JSON.stringify(events.filter((event) => event.type === "done" || event.type === "error")),
    ).toBe(true);
    expect(JSON.stringify(events)).toMatch(/WeatherHero/);
    expect(result.headers.get("content-type")).toContain("application/x-ndjson");
  });
});
