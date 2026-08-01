const PRODUCTION_ORIGIN = "https://lab.jalbright.dev";

export type RuntimeMode = "production" | "preview" | "development" | "test";

export type RuntimeIssueCode =
  | "LIVE_PROVIDERS_REQUIRED"
  | "CONTEXT_SECRET_REQUIRED"
  | "CONTEXT_SECRET_WEAK"
  | "UPSTASH_PAIR_REQUIRED"
  | "UPSTASH_URL_INVALID"
  | "ORIGIN_ALLOWLIST_REQUIRED"
  | "ORIGIN_ALLOWLIST_INVALID"
  | "DEMO_FIXTURES_FORBIDDEN";

export type RuntimeConfig = {
  mode: RuntimeMode;
  isProduction: boolean;
  geminiApiKey?: string;
  googleMapsApiKey?: string;
  contextEncryptionSecret?: string;
  upstash?: {
    url: string;
    token: string;
  };
  allowedOrigins: readonly string[];
  allowDemoFixtures: boolean;
};

export type RuntimeReadinessMetadata = {
  environment: RuntimeMode;
  providers: "live" | "recorded-fixtures";
  rateLimit: "distributed" | "memory";
  context: "encrypted" | "development-only";
  fixtures: "disabled" | "development-only";
};

export type RuntimeConfigResult =
  | {
      ready: true;
      config: RuntimeConfig;
      metadata: RuntimeReadinessMetadata;
    }
  | {
      ready: false;
      issues: readonly RuntimeIssueCode[];
    };

type Environment = Readonly<Record<string, string | undefined>>;

function value(environment: Environment, name: string): string | undefined {
  const resolved = environment[name]?.trim();
  return resolved ? resolved : undefined;
}

function runtimeMode(environment: Environment): RuntimeMode {
  switch (value(environment, "VERCEL_ENV")) {
    case "production":
      return "production";
    case "preview":
      return "preview";
    case "development":
      return "development";
    default:
      break;
  }

  switch (value(environment, "NODE_ENV")) {
    case "production":
      return "production";
    case "test":
      return "test";
    default:
      return "development";
  }
}

function parseBoolean(valueToParse: string | undefined): boolean {
  return valueToParse?.trim().toLowerCase() === "true";
}

function isStrongContextSecret(secret: string): boolean {
  if (secret.length < 32 || /\s/.test(secret)) return false;
  if (
    /(change[-_ ]?me|replace[-_ ]?with|placeholder|example|your[-_ ]?(?:secret|key)|insert[-_ ]?here|development[-_ ]?only)/i.test(
      secret,
    )
  ) {
    return false;
  }

  return new Set(secret).size >= 8;
}

function parseHttpsUrl(candidate: string): string | undefined {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return undefined;
    return candidate.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function parseOrigin(candidate: string): string | undefined {
  try {
    const parsed = new URL(candidate);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.origin !== candidate) {
      return undefined;
    }
    return candidate;
  } catch {
    return undefined;
  }
}

function allowedOrigins(environment: Environment): {
  origins: string[];
  containsInvalidOrigin: boolean;
} {
  const entries = (value(environment, "ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const origins = entries.map(parseOrigin).filter((origin): origin is string => Boolean(origin));
  return { origins: [...new Set(origins)], containsInvalidOrigin: origins.length !== entries.length };
}

/**
 * Reads and validates the server-only runtime contract without logging or
 * returning secret values on failure. Callers may use issue codes internally,
 * but public responses must remain generic.
 */
export function readRuntimeConfig(
  environment: Environment = process.env,
): RuntimeConfigResult {
  const mode = runtimeMode(environment);
  const isProduction = mode === "production";
  const geminiApiKey = value(environment, "GEMINI_API_KEY");
  const googleMapsApiKey = value(environment, "GOOGLE_MAPS_API_KEY");
  const contextEncryptionSecret = value(environment, "CONTEXT_ENCRYPTION_SECRET");
  // Vercel's managed Upstash integration currently injects KV_REST_API_*.
  // Keep the direct Upstash names as the primary contract so either setup can
  // be used without copying or re-exposing provider credentials.
  const upstashUrlValue =
    value(environment, "UPSTASH_REDIS_REST_URL") ?? value(environment, "KV_REST_API_URL");
  const upstashToken =
    value(environment, "UPSTASH_REDIS_REST_TOKEN") ?? value(environment, "KV_REST_API_TOKEN");
  const allowDemoFixtures = parseBoolean(environment.ALLOW_DEMO_FIXTURES);
  const originResult = allowedOrigins(environment);
  const issues = new Set<RuntimeIssueCode>();

  if (isProduction && (!geminiApiKey || !googleMapsApiKey)) {
    issues.add("LIVE_PROVIDERS_REQUIRED");
  }

  if (isProduction && !contextEncryptionSecret) {
    issues.add("CONTEXT_SECRET_REQUIRED");
  } else if (isProduction && contextEncryptionSecret && !isStrongContextSecret(contextEncryptionSecret)) {
    issues.add("CONTEXT_SECRET_WEAK");
  }

  if (Boolean(upstashUrlValue) !== Boolean(upstashToken) || (isProduction && !upstashUrlValue)) {
    issues.add("UPSTASH_PAIR_REQUIRED");
  }
  const upstashUrl = upstashUrlValue ? parseHttpsUrl(upstashUrlValue) : undefined;
  if (upstashUrlValue && !upstashUrl) issues.add("UPSTASH_URL_INVALID");

  if (originResult.containsInvalidOrigin) issues.add("ORIGIN_ALLOWLIST_INVALID");
  if (isProduction && !originResult.origins.includes(PRODUCTION_ORIGIN)) {
    issues.add("ORIGIN_ALLOWLIST_REQUIRED");
  }

  if (isProduction && allowDemoFixtures) issues.add("DEMO_FIXTURES_FORBIDDEN");

  if (issues.size > 0) return { ready: false, issues: [...issues] };

  const upstash = upstashUrl && upstashToken ? { url: upstashUrl, token: upstashToken } : undefined;
  const config: RuntimeConfig = {
    mode,
    isProduction,
    geminiApiKey,
    googleMapsApiKey,
    contextEncryptionSecret,
    upstash,
    allowedOrigins: originResult.origins,
    allowDemoFixtures,
  };

  return {
    ready: true,
    config,
    metadata: {
      environment: mode,
      providers: geminiApiKey && googleMapsApiKey ? "live" : "recorded-fixtures",
      rateLimit: upstash ? "distributed" : "memory",
      context: contextEncryptionSecret ? "encrypted" : "development-only",
      fixtures: isProduction ? "disabled" : "development-only",
    },
  };
}
