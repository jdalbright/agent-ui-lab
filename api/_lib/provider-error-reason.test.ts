import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeminiProviderError, GeminiToolRoundLimitError } from "./gemini.js";
import { providerErrorReason } from "./provider-error-reason.js";

describe("providerErrorReason", () => {
  it("names the tool-round limit", () => {
    expect(providerErrorReason(new GeminiToolRoundLimitError())).toBe("tool_round_limit");
  });

  it("reports schema paths for invalid weather arguments without values", () => {
    const parsed = z
      .object({ locations: z.array(z.string()).max(1) })
      .strict()
      .safeParse({ locations: ["Raleigh", "Durham"], secret: "do not log" });
    const error = new GeminiProviderError("Gemini returned invalid get_weather_bundle arguments.", {
      cause: parsed.error,
    });
    const reason = providerErrorReason(error);
    expect(reason.startsWith("weather_args:")).toBe(true);
    expect(reason).toContain("locations/too_big");
    expect(reason).not.toContain("Raleigh");
    expect(reason).not.toContain("do not log");
  });

  it("captures interaction status mismatches", () => {
    const error = new GeminiProviderError("Gemini returned status completed; expected requires_action.");
    expect(providerErrorReason(error)).toBe("interaction_status:completed->requires_action");
  });

  it("maps weather limits", () => {
    expect(providerErrorReason(new GeminiProviderError("Gemini requested more than 4 weather tool calls."))).toBe(
      "weather_call_limit",
    );
    expect(providerErrorReason(new GeminiProviderError("Gemini requested more than 4 weather locations."))).toBe(
      "weather_location_limit",
    );
  });

  it("keeps only the class name and HTTP status for SDK errors", () => {
    const error = Object.assign(new Error("Request contained the prompt text"), {
      name: "ApiError",
      status: 400,
    });
    expect(providerErrorReason(error)).toBe("ApiError:400");
  });

  it("handles non-errors", () => {
    expect(providerErrorReason("nope")).toBe("unknown");
  });
});
