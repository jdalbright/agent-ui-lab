import { createHmac } from "node:crypto";
import { LIMITS } from "../../shared/constants.js";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  source: "upstash" | "memory";
};

type MemoryEntry = { windowCount: number; dayCount: number; windowExpires: number; dayExpires: number };
const memory = new Map<string, MemoryEntry>();

function anonymousKey(identity: string, salt: string): string {
  return createHmac("sha256", salt).update(identity).digest("hex").slice(0, 32);
}

function fixedWindowStart(now: number, seconds: number): number {
  return Math.floor(now / 1_000 / seconds) * seconds;
}

function inMemoryLimit(key: string, now: number): RateLimitResult {
  const windowStart = fixedWindowStart(now, LIMITS.rateWindowSeconds);
  const dayStart = fixedWindowStart(now, 86_400);
  const windowExpires = (windowStart + LIMITS.rateWindowSeconds) * 1_000;
  const dayExpires = (dayStart + 86_400) * 1_000;
  const existing = memory.get(key);
  const next: MemoryEntry = {
    windowCount: existing && existing.windowExpires > now ? existing.windowCount + 1 : 1,
    dayCount: existing && existing.dayExpires > now ? existing.dayCount + 1 : 1,
    windowExpires,
    dayExpires,
  };
  memory.set(key, next);
  const allowed =
    next.windowCount <= LIMITS.requestsPerWindow && next.dayCount <= LIMITS.requestsPerDay;
  const blockedUntil = Math.max(
    next.windowCount > LIMITS.requestsPerWindow ? windowExpires : 0,
    next.dayCount > LIMITS.requestsPerDay ? dayExpires : 0,
  );
  return {
    allowed,
    remaining: Math.max(
      0,
      Math.min(LIMITS.requestsPerWindow - next.windowCount, LIMITS.requestsPerDay - next.dayCount),
    ),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((blockedUntil - now) / 1_000)),
    source: "memory",
  };
}

async function upstashLimit(
  key: string,
  url: string,
  token: string,
  now: number,
  signal?: AbortSignal,
): Promise<RateLimitResult> {
  const windowStart = fixedWindowStart(now, LIMITS.rateWindowSeconds);
  const dayStart = fixedWindowStart(now, 86_400);
  const windowKey = `aul:rl:w:${windowStart}:${key}`;
  const dayKey = `aul:rl:d:${dayStart}:${key}`;
  const response = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", windowKey],
      ["EXPIRE", windowKey, LIMITS.rateWindowSeconds + 2, "NX"],
      ["INCR", dayKey],
      ["EXPIRE", dayKey, 86_402, "NX"],
    ]),
    signal,
  });
  if (!response.ok) throw new Error("Rate limit provider failed");
  const values = (await response.json()) as Array<{ result?: number; error?: string }>;
  const windowCount = Number(values[0]?.result);
  const dayCount = Number(values[2]?.result);
  if (!Number.isFinite(windowCount) || !Number.isFinite(dayCount)) {
    throw new Error("Rate limit provider returned an invalid result");
  }
  const allowed = windowCount <= LIMITS.requestsPerWindow && dayCount <= LIMITS.requestsPerDay;
  const windowExpires = (windowStart + LIMITS.rateWindowSeconds) * 1_000;
  const dayExpires = (dayStart + 86_400) * 1_000;
  const blockedUntil = Math.max(
    windowCount > LIMITS.requestsPerWindow ? windowExpires : 0,
    dayCount > LIMITS.requestsPerDay ? dayExpires : 0,
  );
  return {
    allowed,
    remaining: Math.max(
      0,
      Math.min(LIMITS.requestsPerWindow - windowCount, LIMITS.requestsPerDay - dayCount),
    ),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((blockedUntil - now) / 1_000)),
    source: "upstash",
  };
}

export async function checkRateLimit(options: {
  identity: string;
  salt: string;
  upstashUrl?: string;
  upstashToken?: string;
  now?: number;
  signal?: AbortSignal;
}): Promise<RateLimitResult> {
  const now = options.now ?? Date.now();
  const key = anonymousKey(options.identity || "unknown", options.salt);
  if (options.upstashUrl && options.upstashToken) {
    return upstashLimit(key, options.upstashUrl, options.upstashToken, now, options.signal);
  }
  return inMemoryLimit(key, now);
}

export function resetMemoryRateLimitForTests(): void {
  memory.clear();
}
