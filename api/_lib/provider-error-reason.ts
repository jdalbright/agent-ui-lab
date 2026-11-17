import { ZodError } from "zod";
import { CompositionValidationError } from "./composition.js";
import { GeminiProviderError, GeminiToolRoundLimitError } from "./gemini.js";
import { WeatherProjectionError } from "./weather-composition-manifest.js";

const MAX_REASON_LENGTH = 240;

/**
 * Maps a pipeline failure to a short, content-free reason for operational logs.
 * Only fixed labels, schema paths, interaction statuses, and HTTP status codes are
 * emitted, so prompts, tool results, and provider payloads never reach the logs.
 */
export function providerErrorReason(error: unknown): string {
  if (error instanceof GeminiToolRoundLimitError) return "tool_round_limit";

  if (error instanceof GeminiProviderError) {
    const message = error.message;
    if (message.includes("invalid get_weather_bundle arguments")) {
      return bounded(`weather_args:${zodPaths(error.cause)}`);
    }
    if (message.includes("weather tool calls")) return "weather_call_limit";
    if (message.includes("weather locations")) return "weather_location_limit";
    if (message.includes("unsupported function")) return "unsupported_function";
    if (message.includes("did not emit exactly one")) return "structured_output_count";
    if (message.includes("emitted invalid")) return "structured_output_args";
    if (message.includes("non-JSON result")) return "weather_result_not_json";
    if (message.includes("outside the allowed size")) return "retrieval_prompt_size";
    if (message.includes("not configured")) return "provider_not_configured";
    const status = /returned status (\w+); expected (\w+)/.exec(message);
    if (status) return bounded(`interaction_status:${status[1]}->${status[2]}`);
    return "gemini_provider_other";
  }

  if (error instanceof WeatherProjectionError) {
    return bounded(`weather_projection:${error.issuePaths.map(safeLabelPath).join(",")}`);
  }

  if (error instanceof CompositionValidationError) {
    const base = `composition:${issueSlug(error.issues[0])}`;
    return bounded(error.cause === undefined ? base : `${base}<-${providerErrorReason(error.cause)}`);
  }

  if (error instanceof Error) {
    const frame = firstAppFrame(error.stack);
    if (frame && !(typeof (error as { status?: unknown }).status === "number")) {
      const detail = error.message.includes(":") ? error.message.slice(error.message.indexOf(":") + 1) : "";
      return bounded(`${safeLabel(error.name)}@${frame}${detail ? `:${issueSlug(detail)}` : ""}`);
    }
    const httpStatus = (error as { status?: unknown }).status;
    const suffix = typeof httpStatus === "number" ? `:${httpStatus}` : "";
    return bounded(`${safeLabel(error.name)}${suffix}`);
  }

  return "unknown";
}

/** Turns a validator issue into a short slug: lowercase words only, no quoted values or numbers. */
function issueSlug(issue: string | undefined): string {
  if (!issue) return "unknown";
  const words = issue
    .replace(/(["'`]).*?\1/g, " ")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 24);
  return words.join("_") || "unknown";
}

/** Returns the first stack frame inside the app's api/ or shared/ code as file:line. */
function firstAppFrame(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.split("\n").slice(1, 12)) {
    const match = /(?:api|shared)\/(?:[\w-]+\/)*([\w.-]+\.[cm]?[jt]s):(\d+)/.exec(line);
    if (match) return `${match[1]}:${match[2]}`;
  }
  return undefined;
}

function zodPaths(cause: unknown): string {
  if (!(cause instanceof ZodError)) return "unknown";
  const paths = cause.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.map(String).map(safeLabel).join(".") || "root"}/${safeLabel(issue.code)}`);
  return paths.join(",") || "unknown";
}

function safeLabelPath(value: string): string {
  return value.replace(/[^A-Za-z0-9_./-]/g, "").slice(0, 48) || "x";
}

function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "x";
}

function bounded(value: string): string {
  return value.slice(0, MAX_REASON_LENGTH);
}
