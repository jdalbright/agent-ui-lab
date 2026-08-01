import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../../shared/constants.js";
import { checkRateLimit, resetMemoryRateLimitForTests } from "./rate-limit.js";

const salt = "anonymous-rate-limit-test-salt";
const windowMs = LIMITS.rateWindowSeconds * 1_000;
const base = Math.floor(Date.parse("2026-08-01T12:00:00.000Z") / windowMs) * windowMs;

describe("checkRateLimit", () => {
  beforeEach(() => resetMemoryRateLimitForTests());
  afterEach(() => vi.unstubAllGlobals());

  it("allows 20 requests per ten minutes and denies the next one", async () => {
    let result;
    for (let index = 0; index < LIMITS.requestsPerWindow; index += 1) {
      result = await checkRateLimit({ identity: "203.0.113.10", salt, now: base });
    }

    expect(result).toMatchObject({ allowed: true, remaining: 0, source: "memory" });
    await expect(
      checkRateLimit({ identity: "203.0.113.10", salt, now: base }),
    ).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: LIMITS.rateWindowSeconds,
      source: "memory",
    });
  });

  it("resets the short window and isolates anonymous identities", async () => {
    for (let index = 0; index < LIMITS.requestsPerWindow; index += 1) {
      await checkRateLimit({ identity: "identity-a", salt, now: base });
    }

    await expect(checkRateLimit({ identity: "identity-b", salt, now: base })).resolves.toMatchObject({
      allowed: true,
      remaining: LIMITS.requestsPerWindow - 1,
    });
    await expect(
      checkRateLimit({ identity: "identity-a", salt, now: base + windowMs }),
    ).resolves.toMatchObject({ allowed: true, remaining: LIMITS.requestsPerWindow - 1 });
  });

  it("enforces the daily cap across multiple short windows", async () => {
    const dayStart = Math.floor(base / 86_400_000) * 86_400_000;
    for (let index = 0; index < LIMITS.requestsPerDay; index += 1) {
      const requestWindow = Math.floor(index / LIMITS.requestsPerWindow);
      const result = await checkRateLimit({
        identity: "daily-limited",
        salt,
        now: dayStart + 1_000 + requestWindow * windowMs,
      });
      expect(result.allowed).toBe(true);
    }

    const deniedAt = dayStart + 1_000 + 5 * windowMs;
    const denied = await checkRateLimit({ identity: "daily-limited", salt, now: deniedAt });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(Math.ceil((dayStart + 86_400_000 - deniedAt) / 1_000));
  });

  it("uses an HMAC identifier and the atomic Upstash pipeline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    const result = await checkRateLimit({
      identity: "raw-address-must-not-leave-the-process",
      salt,
      upstashUrl: "https://redis.example.com/",
      upstashToken: "upstash-token",
      now: base,
      signal,
    });

    expect(result).toEqual({
      allowed: true,
      remaining: LIMITS.requestsPerWindow - 1,
      retryAfterSeconds: 0,
      source: "upstash",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://redis.example.com/pipeline");
    expect(init.signal).toBe(signal);
    expect(init.headers).toMatchObject({ Authorization: "Bearer upstash-token" });
    expect(init.body).not.toContain("raw-address-must-not-leave-the-process");
    expect(init.body).toContain("aul:rl:w:");
    expect(init.body).toContain("aul:rl:d:");
  });

  it("rejects invalid Upstash responses instead of silently allowing requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ result: "invalid" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      checkRateLimit({
        identity: "identity",
        salt,
        upstashUrl: "https://redis.example.com",
        upstashToken: "token",
        now: base,
      }),
    ).rejects.toThrow("Rate limit provider returned an invalid result");
  });
});
