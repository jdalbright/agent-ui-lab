import { describe, expect, it } from "vitest";
import { createTrace, sanitizeTraceArguments } from "./trace.js";

describe("sanitizeTraceArguments", () => {
  it("keeps only approved semantic arguments", () => {
    expect(
      sanitizeTraceArguments({
        location: "Raleigh, NC",
        units: "imperial",
        days: 5,
        hours: 24,
        activity: "walk",
        query: "current forecast",
        apiKey: "must-not-appear",
        contextToken: "must-not-appear",
        coordinates: { latitude: 35.7796, longitude: -78.6382 },
        providerSteps: ["hidden"],
      }),
    ).toEqual({
      location: "Raleigh, NC",
      units: "imperial",
      days: 5,
      hours: 24,
      activity: "walk",
      query: "current forecast",
    });
  });

  it("redacts identifiers, secrets, coordinates, and control characters", () => {
    const result = sanitizeTraceArguments({
      query:
        "Email jacob@example.com\nwith token=private-value from 35.7796, -78.6382",
      locations: ["jacob@example.com", "password:secret-value", "35.7796,-78.6382"],
    });

    expect(result).toEqual({
      query: "Email [email] with [redacted] from [coordinates]",
      locations: "[email], [redacted], [coordinates]",
    });
    expect(JSON.stringify(result)).not.toMatch(/jacob|private-value|secret-value|35\.7796/);
  });

  it("drops unsupported values and bounds displayed values", () => {
    expect(sanitizeTraceArguments({ query: { nested: "private" }, unknown: "private" })).toBeUndefined();
    expect(sanitizeTraceArguments({ query: "x".repeat(250) })?.query).toBe("x".repeat(200));
  });
});

describe("createTrace", () => {
  it("assigns an id and applies argument redaction before schema validation", () => {
    const trace = createTrace({
      stage: "tool",
      label: "Get weather bundle",
      status: "complete",
      toolName: "get_weather_bundle",
      arguments: {
        location: "Raleigh, NC",
        apiKey: "private-key",
      },
      sourceIds: ["src_abcdef12"],
    });

    expect(trace.id).toBeTruthy();
    expect(trace.arguments).toEqual({ location: "Raleigh, NC" });
    expect(JSON.stringify(trace)).not.toContain("private-key");
  });
});
