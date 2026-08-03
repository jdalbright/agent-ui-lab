import type { SurfaceSpec } from "../../shared/schemas.js";
import type { SurfaceComposerVersion } from "./runtime-config.js";

const PLAN_DOMAINS = new Set<SurfaceSpec["kind"]>([
  "weather",
  "comparison",
  "research",
]);

export function selectSurfaceComposer(
  configuredVersion: SurfaceComposerVersion,
  kind: SurfaceSpec["kind"],
): SurfaceComposerVersion {
  return configuredVersion === "plan-v2" && PLAN_DOMAINS.has(kind)
    ? "plan-v2"
    : "spec-v1";
}
