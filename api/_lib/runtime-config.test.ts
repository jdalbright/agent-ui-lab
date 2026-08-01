import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "./runtime-config.js";

const productionEnvironment = {
  VERCEL_ENV: "production",
  GEMINI_API_KEY: "gemini-live-key",
  GOOGLE_MAPS_API_KEY: "google-maps-live-key",
  CONTEXT_ENCRYPTION_SECRET: "Q4$rV8!nZ2@pL7#tC5&xM9*kD3_wH6+y",
  UPSTASH_REDIS_REST_URL: "https://polished-crow-12345.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "upstash-live-token",
  ALLOWED_ORIGINS: "https://lab.jalbright.dev",
  ALLOW_DEMO_FIXTURES: "false",
} as const;

describe("readRuntimeConfig", () => {
  it("accepts a complete production contract and exposes only categorical readiness metadata", () => {
    const result = readRuntimeConfig(productionEnvironment);

    expect(result.ready).toBe(true);
    if (!result.ready) return;
    expect(result.config.upstash).toEqual({
      url: "https://polished-crow-12345.upstash.io",
      token: "upstash-live-token",
    });
    expect(result.metadata).toEqual({
      environment: "production",
      providers: "live",
      rateLimit: "distributed",
      context: "encrypted",
      fixtures: "disabled",
    });
    expect(JSON.stringify(result.metadata)).not.toMatch(/key|token|secret|upstash\.io/i);
  });

  it("accepts Vercel managed Upstash variable names", () => {
    const result = readRuntimeConfig({
      ...productionEnvironment,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      KV_REST_API_URL: "https://polished-crow-12345.upstash.io",
      KV_REST_API_TOKEN: "vercel-managed-token",
    });

    expect(result).toMatchObject({
      ready: true,
      metadata: { rateLimit: "distributed" },
      config: {
        upstash: {
          url: "https://polished-crow-12345.upstash.io",
          token: "vercel-managed-token",
        },
      },
    });
  });

  it("reports every missing production capability with non-secret issue codes", () => {
    const result = readRuntimeConfig({ VERCEL_ENV: "production" });

    expect(result).toEqual({
      ready: false,
      issues: [
        "LIVE_PROVIDERS_REQUIRED",
        "CONTEXT_SECRET_REQUIRED",
        "UPSTASH_PAIR_REQUIRED",
        "ORIGIN_ALLOWLIST_REQUIRED",
      ],
    });
  });

  it.each([
    ["documented placeholder", "replace-with-a-random-secret-of-at-least-32-characters"],
    ["too short", "short-secret"],
    ["low entropy", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ["whitespace", "long context secret with whitespace 123456789"],
  ])("rejects a %s context secret in production", (_label, secret) => {
    const result = readRuntimeConfig({
      ...productionEnvironment,
      CONTEXT_ENCRYPTION_SECRET: secret,
    });

    expect(result).toEqual({ ready: false, issues: ["CONTEXT_SECRET_WEAK"] });
  });

  it("requires an HTTPS Upstash URL and a paired token", () => {
    expect(
      readRuntimeConfig({
        ...productionEnvironment,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      }),
    ).toEqual({ ready: false, issues: ["UPSTASH_PAIR_REQUIRED"] });

    expect(
      readRuntimeConfig({
        ...productionEnvironment,
        UPSTASH_REDIS_REST_URL: "http://polished-crow-12345.upstash.io",
      }),
    ).toEqual({ ready: false, issues: ["UPSTASH_URL_INVALID"] });
  });

  it("requires the exact production origin and rejects malformed allowlist entries", () => {
    expect(
      readRuntimeConfig({
        ...productionEnvironment,
        ALLOWED_ORIGINS: "https://agent-ui-lab.vercel.app",
      }),
    ).toEqual({ ready: false, issues: ["ORIGIN_ALLOWLIST_REQUIRED"] });

    expect(
      readRuntimeConfig({
        ...productionEnvironment,
        ALLOWED_ORIGINS: "https://lab.jalbright.dev/,https://lab.jalbright.dev",
      }),
    ).toEqual({ ready: false, issues: ["ORIGIN_ALLOWLIST_INVALID"] });
  });

  it("forbids demo fixtures in production", () => {
    expect(
      readRuntimeConfig({ ...productionEnvironment, ALLOW_DEMO_FIXTURES: "TRUE" }),
    ).toEqual({ ready: false, issues: ["DEMO_FIXTURES_FORBIDDEN"] });
  });

  it("allows local and test runtimes to use recorded fixtures and the memory limiter", () => {
    for (const environment of [{ NODE_ENV: "development" }, { NODE_ENV: "test" }]) {
      const result = readRuntimeConfig(environment);
      expect(result.ready).toBe(true);
      if (!result.ready) continue;
      expect(result.metadata).toMatchObject({
        providers: "recorded-fixtures",
        rateLimit: "memory",
        context: "development-only",
        fixtures: "development-only",
      });
    }
  });

  it("does not silently accept half-configured Upstash in development", () => {
    expect(
      readRuntimeConfig({ NODE_ENV: "development", UPSTASH_REDIS_REST_TOKEN: "token-only" }),
    ).toEqual({ ready: false, issues: ["UPSTASH_PAIR_REQUIRED"] });
  });
});
