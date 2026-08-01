import { AgentRequestSchema, type AgentRequest } from "../../shared/schemas.js";
import type { ServerRequest } from "./http-types.js";

export class RequestValidationError extends Error {
  readonly code: "INVALID_REQUEST" | "ORIGIN_REJECTED";
  readonly issues: string[];

  constructor(code: RequestValidationError["code"], issues: string[]) {
    super(code === "ORIGIN_REJECTED" ? "This origin is not allowed." : "The request is invalid.");
    this.name = "RequestValidationError";
    this.code = code;
    this.issues = issues;
  }
}

function configuredOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "https://lab.jalbright.dev,http://127.0.0.1:5173,http://localhost:5173")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function validateOrigin(origin: string | undefined, options?: {
  allowedOrigins?: string;
  vercelUrl?: string;
}): void {
  if (!origin) throw new RequestValidationError("ORIGIN_REJECTED", ["Origin header is required."]);
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new RequestValidationError("ORIGIN_REJECTED", ["Origin is malformed."]);
  }
  if (parsed.origin !== origin || !["https:", "http:"].includes(parsed.protocol)) {
    throw new RequestValidationError("ORIGIN_REJECTED", ["Origin must be exact."]);
  }
  const allowed = configuredOrigins(options?.allowedOrigins);
  const previewOrigin = options?.vercelUrl ? `https://${options.vercelUrl}` : undefined;
  if (!allowed.has(origin) && origin !== previewOrigin) {
    throw new RequestValidationError("ORIGIN_REJECTED", ["Origin is not on the allowlist."]);
  }
}

export function parseAgentRequest(body: unknown): AgentRequest {
  const result = AgentRequestSchema.safeParse(body);
  if (!result.success) {
    throw new RequestValidationError(
      "INVALID_REQUEST",
      result.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}

export function requestIdentity(request: ServerRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const first = typeof forwarded === "string" ? forwarded.split(",")[0] : forwarded?.[0];
  return first?.trim() || request.socket.remoteAddress || "unknown";
}
