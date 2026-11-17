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
  errorReason?: string;
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
  emphasis?: "answer" | "decision" | "trend" | "evidence" | "risk" | "exploration";
  compositionMode?: "plan-v2" | "grammar-v3";
  layoutFamily?: string;
  contentNodeCount?: number;
  layoutNodeCount?: number;
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
const EMPHASES = new Set(["answer", "decision", "trend", "evidence", "risk", "exploration"]);
const COMPOSITION_MODES = new Set(["plan-v2", "grammar-v3"]);
const LAYOUT_FAMILIES = new Set([
  "stack",
  "grid",
  "split",
  "section",
  "card",
  "rail",
  "tabs",
  "disclosure",
  "divider",
  "plan-v2-fallback",
  "unknown",
]);
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
    ...(event.errorReason ? { errorReason: event.errorReason.replace(/[^A-Za-z0-9_.,:/>@-]/g, "").slice(0, 80) } : {}),
    ...(event.recipeId && RECIPE_IDS.has(event.recipeId) ? { recipeId: event.recipeId } : {}),
    ...(event.density && DENSITIES.has(event.density) ? { density: event.density } : {}),
    ...(event.emphasis && EMPHASES.has(event.emphasis) ? { emphasis: event.emphasis } : {}),
    ...(event.compositionMode && COMPOSITION_MODES.has(event.compositionMode)
      ? { compositionMode: event.compositionMode }
      : {}),
    ...(event.layoutFamily && LAYOUT_FAMILIES.has(event.layoutFamily)
      ? { layoutFamily: event.layoutFamily }
      : {}),
    ...(event.contentNodeCount === undefined
      ? {}
      : { contentNodeCount: Math.min(12, Math.max(0, Math.round(event.contentNodeCount))) }),
    ...(event.layoutNodeCount === undefined
      ? {}
      : { layoutNodeCount: Math.min(8, Math.max(0, Math.round(event.layoutNodeCount))) }),
    ...(event.validationCategory && VALIDATION_CATEGORIES.has(event.validationCategory)
      ? { validationCategory: event.validationCategory }
      : {}),
  };
}

export function logEvent(event: LogEvent): void {
  console.info(JSON.stringify({ event: "agent_pipeline", ...normalized(event) }));
}
