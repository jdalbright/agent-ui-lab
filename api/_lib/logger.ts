type LogEvent = {
  requestId: string;
  stage: "request" | "retrieval" | "tool" | "composition" | "validation" | "render" | "complete";
  durationMs?: number;
  toolName?: "get_weather_bundle" | "google_search";
  toolSuccess?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  repairCount?: number;
  componentCount?: number;
  sourceCount?: number;
  errorCode?: string;
  recipeId?:
    | "weather.snapshot"
    | "weather.decision"
    | "weather.outlook"
    | "comparison.verdict"
    | "comparison.scorecard"
    | "comparison.trend"
    | "research.brief"
    | "research.timeline"
    | "research.claims";
  density?: "brief" | "balanced" | "detailed";
  emphasis?: "answer" | "decision" | "trend" | "evidence" | "risk";
  validationCategory?: "valid" | "json" | "schema" | "semantic" | "evidence" | "fallback";
};

const RECIPE_IDS = new Set([
  "weather.snapshot",
  "weather.decision",
  "weather.outlook",
  "comparison.verdict",
  "comparison.scorecard",
  "comparison.trend",
  "research.brief",
  "research.timeline",
  "research.claims",
]);
const DENSITIES = new Set(["brief", "balanced", "detailed"]);
const EMPHASES = new Set(["answer", "decision", "trend", "evidence", "risk"]);
const VALIDATION_CATEGORIES = new Set([
  "valid",
  "json",
  "schema",
  "semantic",
  "evidence",
  "fallback",
]);

function normalized(event: LogEvent): LogEvent {
  return {
    requestId: event.requestId,
    stage: event.stage,
    ...(event.durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(event.durationMs)) }),
    ...(event.toolName ? { toolName: event.toolName } : {}),
    ...(event.toolSuccess === undefined ? {} : { toolSuccess: event.toolSuccess }),
    ...(event.inputTokens === undefined ? {} : { inputTokens: Math.max(0, Math.round(event.inputTokens)) }),
    ...(event.outputTokens === undefined ? {} : { outputTokens: Math.max(0, Math.round(event.outputTokens)) }),
    ...(event.repairCount === undefined ? {} : { repairCount: Math.min(1, Math.max(0, event.repairCount)) }),
    ...(event.componentCount === undefined ? {} : { componentCount: Math.max(0, event.componentCount) }),
    ...(event.sourceCount === undefined ? {} : { sourceCount: Math.max(0, event.sourceCount) }),
    ...(event.errorCode ? { errorCode: event.errorCode.slice(0, 80) } : {}),
    ...(event.recipeId && RECIPE_IDS.has(event.recipeId) ? { recipeId: event.recipeId } : {}),
    ...(event.density && DENSITIES.has(event.density) ? { density: event.density } : {}),
    ...(event.emphasis && EMPHASES.has(event.emphasis) ? { emphasis: event.emphasis } : {}),
    ...(event.validationCategory && VALIDATION_CATEGORIES.has(event.validationCategory)
      ? { validationCategory: event.validationCategory }
      : {}),
  };
}

export function logEvent(event: LogEvent): void {
  console.info(JSON.stringify({ event: "agent_pipeline", ...normalized(event) }));
}
