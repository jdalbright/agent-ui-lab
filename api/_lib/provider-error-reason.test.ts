import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CompositionValidationError } from "./composition.js";
import { GeminiProviderError, GeminiToolRoundLimitError } from "./gemini.js";
import { providerErrorReason } from "./provider-error-reason.js";
import { WeatherProjectionError } from "./weather-composition-manifest.js";

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

  it("slugs the first composition issue without quoted values or numbers", () => {
    const error = new CompositionValidationError([
      'Component "Raleigh secret" references 3 unknown children.',
    ]);
    const reason = providerErrorReason(error);
    expect(reason).toBe("composition:component_references_unknown_children");
  });

  it("reports the first app stack frame for runtime errors", () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'temperature')");
    error.stack = [
      "TypeError: Cannot read properties of undefined (reading 'temperature')",
      "    at compileWeather (/var/task/node_modules/lib/x.js:1:1)",
      "    at buildTable (/var/task/api/_lib/composition.js:2417:31)",
    ].join("\n");
    expect(providerErrorReason(error)).toBe("TypeError@composition.js:2417");
  });

  it("reports weather projection schema paths with indexes collapsed", () => {
    const parsed = z
      .object({ alerts: z.array(z.object({ description: z.string().max(5) })) })
      .safeParse({ alerts: [{ description: "Frost advisory text that is long" }] });
    const error = new WeatherProjectionError(parsed.error?.issues ?? []);
    expect(providerErrorReason(error)).toBe("weather_projection:alerts.n.description/too_big");
  });

  it("follows the cause of a failed fallback", () => {
    const cause = new WeatherProjectionError([
      { code: "too_big", path: ["locations", 0, "daily"], message: "x", maximum: 10, inclusive: true, type: "array" },
    ]);
    const error = new CompositionValidationError(
      ["The deterministic plan-v2 fallback could not be compiled safely."],
      { cause },
    );
    expect(providerErrorReason(error)).toBe(
      "composition:the_deterministic_plan-v_fallback_could_not_be_compiled<-weather_projection:locations.n.daily/too_big",
    );
  });

  it("handles non-errors", () => {
    expect(providerErrorReason("nope")).toBe("unknown");
  });
});
