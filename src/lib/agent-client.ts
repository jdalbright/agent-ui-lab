import { compileSurfaceSpec } from "@shared/compiler";
import { LIMITS } from "@shared/constants";
import {
  StreamEventSchema,
  type AgentRequest,
  type StreamEvent,
  type TraceRecord,
} from "@shared/schemas";
import { selectDemoSurface } from "@shared/demo-surfaces";

export class AgentStreamError extends Error {
  readonly partial: boolean;
  readonly retryable: boolean;

  constructor(message: string, options?: { partial?: boolean; retryable?: boolean }) {
    super(message);
    this.name = "AgentStreamError";
    this.partial = options?.partial ?? false;
    this.retryable = options?.retryable ?? true;
  }
}

function isLocalPreview(): boolean {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

async function* recordedFixtureStream(request: AgentRequest): AsyncGenerator<StreamEvent> {
  const selected = selectDemoSurface(request.prompt);
  const delay = request.client.reducedMotion ? 0 : 90;
  const pause = () => new Promise((resolve) => window.setTimeout(resolve, delay));
  const at = () => new Date().toISOString();
  const componentNames = selected.spec.components.map((node) => node.component);
  const sourceIds = selected.sources.map((source) => source.id);
  const root = selected.spec.components.find((node) => node.id === selected.spec.rootId);
  const presentationTrace: Partial<TraceRecord> = root?.component === "SurfaceFrame"
    ? {
        recipeId: root.recipeId,
        density: root.density,
        emphasis: root.emphasis,
      }
    : {};
  const completedQualityTrace: Partial<TraceRecord> = root?.component === "SurfaceFrame"
    ? {
        ...presentationTrace,
        qualityChecks: [
          { code: "recipe_fit", passed: true },
          { code: "answer_first", passed: true },
          { code: "sources_last", passed: true },
          { code: "requested_coverage", passed: true },
          { code: "duplicate_primary", passed: true },
          { code: "chart_table_alignment", passed: true },
          { code: "citation_coverage", passed: true },
          { code: "content_budget", passed: true },
        ],
        repairCategory: "none",
        compilerResult: "compiled",
      }
    : {};
  const trace = (entry: TraceRecord): StreamEvent => ({ type: "trace", trace: entry });

  yield { type: "status", stage: "accepted", message: "Request received", at: at() };
  yield trace({ id: "demo-request", stage: "request", label: "Understand request", status: "complete" });
  await pause();

  yield { type: "status", stage: "retrieving", message: "Retrieving trusted context", at: at() };
  if (selected.sources.length > 0) {
    const usesSearch = selected.sources.some((source) => source.provider === "google-search");
    yield trace({
      id: "demo-tool",
      stage: "tool",
      label: usesSearch ? "Ground with Google Search" : "Get weather bundle",
      status: "complete",
      durationMs: 218,
      toolName: usesSearch ? "google_search" : "get_weather_bundle",
      arguments: usesSearch
        ? { query: "official-source research" }
        : { locations: "recorded-location-set", units: request.client.units },
      sourceIds,
    });
  }
  await pause();

  yield { type: "status", stage: "composing", message: "Composing the interface", at: at() };
  yield trace({
    id: "demo-compose",
    stage: "composition",
    label: "Select presentation recipe",
    status: "complete",
    durationMs: 184,
    ...presentationTrace,
  });
  await pause();

  const messages = compileSurfaceSpec({
    surfaceId: `answer-${request.requestId}`,
    spec: selected.spec,
    sources: selected.sources,
  });
  yield { type: "status", stage: "validating", message: "Validating trusted components", at: at() };
  yield trace({
    id: "demo-validation",
    stage: "validation",
    label: "Validate A2UI v0.9.1",
    status: "complete",
    durationMs: 12,
    componentNames,
    validation: { valid: true, repairCount: 0, issues: [] },
    ...completedQualityTrace,
  });

  for (const message of messages) {
    await pause();
    yield { type: "a2ui", message };
  }
  yield trace({ id: "demo-render", stage: "render", label: "Render surface", status: "complete", durationMs: 16, componentNames });
  yield {
    type: "done",
    requestId: request.requestId,
    completedAt: at(),
    durationMs: delay * 5 + 430,
    mode: "recorded-fixture",
    componentCount: selected.spec.components.length,
    sourceCount: selected.sources.length,
  };
}

async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const input = (await response.json()) as { message?: unknown };
    return typeof input.message === "string" ? input.message.slice(0, 240) : "The agent request failed.";
  } catch {
    return "The agent request failed.";
  }
}

async function* remoteStream(request: AgentRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    throw new AgentStreamError(await parseErrorResponse(response), {
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  if (!response.body) throw new AgentStreamError("The response stream was unavailable.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedEvents = 0;

  const parseLine = (line: string): StreamEvent => {
    let input: unknown;
    try {
      input = JSON.parse(line) as unknown;
    } catch {
      throw new AgentStreamError("The response stream contained malformed data.", { partial: receivedEvents > 0 });
    }
    const result = StreamEventSchema.safeParse(input);
    if (!result.success) {
      throw new AgentStreamError("The response stream failed contract validation.", { partial: receivedEvents > 0 });
    }
    receivedEvents += 1;
    return result.data;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) yield parseLine(trimmed);
    }
    if (done) break;
  }
  if (buffer.trim()) yield parseLine(buffer.trim());
}

export async function* streamAgent(
  request: AgentRequest,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  if (request.prompt.length > LIMITS.promptCharacters) {
    throw new AgentStreamError(`Prompts are limited to ${LIMITS.promptCharacters} characters.`, {
      retryable: false,
    });
  }
  try {
    yield* remoteStream(request, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    if (isLocalPreview()) {
      yield* recordedFixtureStream(request);
      return;
    }
    throw error;
  }
}
