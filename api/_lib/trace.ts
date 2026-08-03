import { randomUUID } from "node:crypto";
import { TraceRecordSchema, type TraceRecord } from "../../shared/schemas.js";

const SAFE_ARGUMENT_KEYS = new Set([
  "units",
  "days",
  "hours",
  "activity",
  "durationHours",
  "targetLocalTime",
  "targetDayOffset",
  "query",
]);

function safeScalar(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === "boolean" || typeof value === "number" || value === null) return value;
  if (typeof value !== "string") return undefined;
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\b\s*[:=]?\s*\S*/gi, "[redacted]")
    .replace(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, "[coordinates]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function integerArgument(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function semanticArgument(
  key: string,
  value: unknown,
): string | number | boolean | null | undefined {
  if (key === "hours") return integerArgument(value, 1, 240);
  if (key === "days") return integerArgument(value, 1, 10);
  if (key === "durationHours") return integerArgument(value, 1, 6);
  if (key === "targetDayOffset") return integerArgument(value, 0, 9);
  if (key === "units") {
    return value === "imperial" || value === "metric" ? value : undefined;
  }
  if (key === "targetLocalTime") {
    return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
      ? value
      : undefined;
  }
  if (key === "activity") {
    const safe = safeScalar(value);
    return typeof safe === "string" ? safe.slice(0, 60) : undefined;
  }
  return safeScalar(value);
}

export function sanitizeTraceArguments(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!input) return undefined;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_ARGUMENT_KEYS.has(key)) continue;
    if (Array.isArray(value)) continue;
    const safe = semanticArgument(key, value);
    if (safe !== undefined) output[key] = safe;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

type TraceQualityCheck = NonNullable<TraceRecord["qualityChecks"]>[number];

export function createTrace(
  input: Omit<TraceRecord, "id" | "arguments" | "qualityChecks"> & {
    id?: string;
    arguments?: Record<string, unknown>;
    qualityChecks?: readonly TraceQualityCheck[];
  },
): TraceRecord {
  return TraceRecordSchema.parse({
    ...input,
    id: input.id ?? randomUUID(),
    arguments: sanitizeTraceArguments(input.arguments),
    qualityChecks: input.qualityChecks ? [...input.qualityChecks] : undefined,
  });
}
