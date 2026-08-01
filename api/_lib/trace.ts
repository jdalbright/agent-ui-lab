import { randomUUID } from "node:crypto";
import { TraceRecordSchema, type TraceRecord } from "../../shared/schemas.js";

const SAFE_ARGUMENT_KEYS = new Set([
  "locations",
  "location",
  "units",
  "days",
  "hours",
  "activity",
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

export function sanitizeTraceArguments(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!input) return undefined;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_ARGUMENT_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      const rendered = value.map(safeScalar).filter((item) => item !== undefined).join(", ");
      if (rendered) output[key] = rendered.slice(0, 200);
      continue;
    }
    const safe = safeScalar(value);
    if (safe !== undefined) output[key] = safe;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export function createTrace(input: Omit<TraceRecord, "id" | "arguments"> & {
  id?: string;
  arguments?: Record<string, unknown>;
}): TraceRecord {
  return TraceRecordSchema.parse({
    ...input,
    id: input.id ?? randomUUID(),
    arguments: sanitizeTraceArguments(input.arguments),
  });
}
