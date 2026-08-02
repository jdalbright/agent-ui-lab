import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/health.js";

type ResponseBody = unknown;

function responseMock() {
  const headers = new Map<string, string>();
  const state: { status?: number; body?: ResponseBody } = {};
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    status(code: number) {
      state.status = code;
      return response;
    },
    json(body: ResponseBody) {
      state.body = body;
    },
  };
  return { response, state, headers };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("health endpoint", () => {
  it("returns a generic 503 without configuration names or values", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("CONTEXT_ENCRYPTION_SECRET", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("ALLOWED_ORIGINS", "");
    const { response, state, headers } = responseMock();

    handler({ method: "GET" }, response);

    expect(state.status).toBe(503);
    expect(state.body).toEqual({ status: "unavailable", service: "agent-ui-lab" });
    expect(JSON.stringify(state.body)).not.toMatch(/GEMINI|MAPS|UPSTASH|SECRET|ORIGIN/i);
    expect(headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns safe categorical readiness metadata when production is ready", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "gemini-live-key");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "maps-live-key");
    vi.stubEnv("CONTEXT_ENCRYPTION_SECRET", "Q4$rV8!nZ2@pL7#tC5&xM9*kD3_wH6+y");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://polished-crow-12345.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "upstash-live-token");
    vi.stubEnv("ALLOWED_ORIGINS", "https://lab.jalbright.dev");
    vi.stubEnv("ALLOW_DEMO_FIXTURES", "false");
    const { response, state } = responseMock();

    handler({ method: "GET" }, response);

    expect(state.status).toBe(200);
    expect(state.body).toEqual({
      status: "ok",
      service: "agent-ui-lab",
      readiness: {
        environment: "production",
        providers: "live",
        rateLimit: "distributed",
        context: "encrypted",
        fixtures: "disabled",
      },
    });
    expect(JSON.stringify(state.body)).not.toMatch(/live-key|live-token|upstash\.io/i);
  });

  it("rejects non-GET methods without evaluating readiness", () => {
    const { response, state, headers } = responseMock();

    handler({ method: "POST" }, response);

    expect(state.status).toBe(405);
    expect(state.body).toEqual({ status: "method-not-allowed" });
    expect(headers.get("Allow")).toBe("GET");
  });
});
