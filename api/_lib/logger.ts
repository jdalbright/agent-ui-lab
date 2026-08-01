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
};

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
  };
}

export function logEvent(event: LogEvent): void {
  console.info(JSON.stringify({ event: "agent_pipeline", ...normalized(event) }));
}
