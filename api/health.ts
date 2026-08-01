import { readRuntimeConfig, type RuntimeReadinessMetadata } from "./_lib/runtime-config.js";

type HealthRequest = {
  method?: string;
};

type HealthBody =
  | { status: "method-not-allowed" }
  | { status: "unavailable"; service: "agent-ui-lab" }
  | { status: "ok"; service: "agent-ui-lab"; readiness: RuntimeReadinessMetadata };

type HealthResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): HealthResponse;
  json(body: HealthBody): void;
};

export default function handler(request: HealthRequest, response: HealthResponse): void {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ status: "method-not-allowed" });
    return;
  }

  const runtime = readRuntimeConfig();
  if (!runtime.ready) {
    response.status(503).json({ status: "unavailable", service: "agent-ui-lab" });
    return;
  }

  response.status(200).json({
    status: "ok",
    service: "agent-ui-lab",
    readiness: runtime.metadata,
  });
}
