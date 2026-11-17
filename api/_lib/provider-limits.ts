import type { SurfaceSpec } from "../../shared/schemas.js";

/**
 * Why Gemini refused a request for capacity or billing reasons, if it did.
 * - "paused": the project's monthly spend cap was reached or prepaid credit ran out.
 *   Nothing works again until the cap resets or is raised.
 * - "busy": a per-minute or per-day rate limit. It clears on its own.
 */
export type ProviderLimitKind = "paused" | "busy";

export function providerLimitKind(error: unknown): ProviderLimitKind | undefined {
  if (!(error instanceof Error)) return undefined;
  const status = (error as { status?: unknown }).status;
  const message = error.message;
  // Google returns 429 "...exceeded its monthly spending cap" for spend caps and 402 for empty prepay.
  if (status === 402 || /monthly spending cap|spend(?:ing)? cap/i.test(message)) return "paused";
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(message)) return "busy";
  return undefined;
}

export const PROVIDER_LIMIT_MESSAGES: Readonly<Record<ProviderLimitKind, string>> = {
  paused:
    "The live demo has reached its usage limit for this month, so new answers are paused until it resets.",
  busy: "The live demo is getting a lot of requests right now. Try again in a minute.",
};

export function providerLimitSpec(kind: ProviderLimitKind): SurfaceSpec {
  return {
    kind: "narrative",
    rootId: "limit-root",
    components: [
      {
        id: "limit-root",
        component: "Band",
        tone: "muted",
        children: ["limit-heading", "limit-copy"],
      },
      {
        id: "limit-heading",
        component: "EditorialHeading",
        text: kind === "paused" ? "The live demo is resting until next month" : "The live demo is busy",
        level: "h1",
        align: "start",
      },
      {
        id: "limit-copy",
        component: "TextBlock",
        text:
          kind === "paused"
            ? "This lab runs on a small monthly budget, and it has been used up. Answers will be back when the budget resets at the start of next month."
            : "Too many answers are being built at once. Wait a minute, then send your question again.",
        tone: "bounded",
      },
    ],
  };
}
