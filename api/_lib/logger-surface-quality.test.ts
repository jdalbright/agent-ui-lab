import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "./logger.js";

describe("surface-quality structured logs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs only categorical presentation metadata, counts, and timing", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const event = {
      requestId: "019fbdb7-373b-74a3-af1e-c098150ce1a4",
      stage: "composition",
      durationMs: 128.6,
      recipeId: "comparison.scorecard",
      density: "detailed",
      emphasis: "evidence",
      validationCategory: "valid",
      repairCount: 0,
      componentCount: 14,
      prompt: "private comparison prompt",
      evidence: [{ finding: "private evidence body" }],
    } as Parameters<typeof logEvent>[0];

    logEvent(event);

    expect(info).toHaveBeenCalledOnce();
    const serialized = info.mock.calls[0]?.[0] as string;
    expect(JSON.parse(serialized)).toEqual({
      event: "agent_pipeline",
      requestId: "019fbdb7-373b-74a3-af1e-c098150ce1a4",
      stage: "composition",
      durationMs: 129,
      recipeId: "comparison.scorecard",
      density: "detailed",
      emphasis: "evidence",
      validationCategory: "valid",
      repairCount: 0,
      componentCount: 14,
    });
    expect(serialized).not.toMatch(/private comparison|private evidence|finding/i);
  });

  it("logs bounded grammar-v3 shape metadata without content", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logEvent({
      requestId: "019fbdb7-373b-74a3-af1e-c098150ce1a4",
      stage: "composition",
      compositionMode: "grammar-v3",
      layoutFamily: "tabs",
      contentNodeCount: 99,
      layoutNodeCount: 99,
      density: "balanced",
      emphasis: "exploration",
    });

    expect(JSON.parse(info.mock.calls[0]?.[0] as string)).toEqual({
      event: "agent_pipeline",
      requestId: "019fbdb7-373b-74a3-af1e-c098150ce1a4",
      stage: "composition",
      density: "balanced",
      emphasis: "exploration",
      compositionMode: "grammar-v3",
      layoutFamily: "tabs",
      contentNodeCount: 12,
      layoutNodeCount: 8,
    });
  });
});
