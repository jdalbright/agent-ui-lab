import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "./logger.js";

describe("logEvent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits one structured, normalized pipeline record", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logEvent({
      requestId: "019fbdb7-373b-74a3-af1e-c098150ce1a4",
      stage: "complete",
      durationMs: -2.4,
      inputTokens: 10.6,
      outputTokens: -1,
      repairCount: 8,
      componentCount: 12,
      sourceCount: 3,
      errorCode: "E".repeat(100),
    });

    expect(info).toHaveBeenCalledOnce();
    const record = JSON.parse(info.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(record).toEqual({
      event: "agent_pipeline",
      requestId: "019fbdb7-373b-74a3-af1e-c098150ce1a4",
      stage: "complete",
      durationMs: 0,
      inputTokens: 11,
      outputTokens: 0,
      repairCount: 1,
      componentCount: 12,
      sourceCount: 3,
      errorCode: "E".repeat(80),
    });
  });

  it("drops prompt bodies, coordinates, provider steps, keys, and context tokens", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const unsafeInput = {
      requestId: "019fbdb7-373b-74a3-af1e-c098150ce1a4",
      stage: "tool",
      toolName: "get_weather_bundle",
      toolSuccess: true,
      prompt: "private prompt body",
      coordinates: { latitude: 35.7796, longitude: -78.6382 },
      providerSteps: [{ type: "thought", signature: "hidden" }],
      apiKey: "private-api-key",
      contextToken: "private-context-token",
    } as Parameters<typeof logEvent>[0];

    logEvent(unsafeInput);

    const serialized = info.mock.calls[0]?.[0] as string;
    expect(JSON.parse(serialized)).toEqual({
      event: "agent_pipeline",
      requestId: "019fbdb7-373b-74a3-af1e-c098150ce1a4",
      stage: "tool",
      toolName: "get_weather_bundle",
      toolSuccess: true,
    });
    expect(serialized).not.toMatch(/private|35\.7796|thought|signature/);
  });
});
