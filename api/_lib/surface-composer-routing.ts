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
  rolloutKey?: string,
  rolloutPercent = 100,
): SurfaceComposerVersion {
  if (!PLAN_DOMAINS.has(kind)) return "spec-v1";
  if (configuredVersion !== "grammar-v3") {
    return configuredVersion === "plan-v2" ? "plan-v2" : "spec-v1";
  }
  const percent = Math.min(100, Math.max(0, Math.round(rolloutPercent)));
  if (percent >= 100) return "grammar-v3";
  if (percent <= 0 || !rolloutKey) return "plan-v2";
  return surfaceGrammarRolloutBucket(rolloutKey) < percent ? "grammar-v3" : "plan-v2";
}

export function surfaceGrammarRolloutBucket(key: string): number {
  let hash = 2_166_136_261;
  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash % 100;
}
