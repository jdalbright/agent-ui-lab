import { describe, expect, it } from "vitest";
import type { ClientContext, SourceRecord } from "../../shared/schemas.js";
import type { GeminiRetrievalResult } from "./gemini.js";
import { buildWeatherCompositionPayload } from "./weather-composition-manifest.js";

const clientContext: ClientContext = {
  sizeClass: "expanded",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

const source: SourceRecord = {
  id: "src_weather01",
  title: "Recorded Google Weather evidence",
  url: "https://weather.example.test/raw-provider-record",
  provider: "google-weather",
  accessedAt: "2026-08-02T12:00:00.000Z",
  snippet: "Raw provider snippet with 81 degrees and a URL.",
};

interface DayInput {
  date: string;
  high: number;
  low: number;
  precipitationProbability: number;
}

function recordedLocation(input: {
  name: string;
  timeZone: string;
  unit: "F" | "C";
  temperature: number;
  feelsLike?: number;
  hourly?: readonly {
    startTime: string;
    temperature: number;
    precipitationProbability: number;
  }[];
  daily?: readonly DayInput[];
  alerts?: readonly {
    title: string;
    severity: "minor" | "moderate" | "severe" | "extreme";
    expiresAt?: string;
    sourceAuthorityUri?: string;
  }[];
}): Record<string, unknown> {
  return {
    location: {
      name: input.name,
      latitude: 35.7796,
      longitude: -78.6382,
      placeId: `place-${input.name.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-")}`,
    },
    current: {
      observedAt: "2026-08-02T12:00:00.000Z",
      timeZone: input.timeZone,
      temperature: input.temperature,
      feelsLike: input.feelsLike ?? input.temperature,
      temperatureUnit: input.unit,
      conditionKey: "partly-cloudy",
      conditionText: `Partly cloudy at ${input.temperature} degrees`,
      isDaytime: true,
      humidity: 58,
      precipitationProbability: 12,
      windDirection: "SW",
      windSpeed: input.unit === "C" ? 11 : 7,
      windSpeedUnit: input.unit === "C" ? "km/h" : "mph",
      visibility: input.unit === "C" ? 16 : 10,
      visibilityUnit: input.unit === "C" ? "km" : "mi",
      uvIndex: 4,
    },
    hourly: (input.hourly ?? []).map((hour) => ({
      ...hour,
      temperatureUnit: input.unit,
      conditionKey: "partly-cloudy",
    })),
    daily: (input.daily ?? []).map((day) => ({
      ...day,
      temperatureUnit: input.unit,
      conditionKey: day.precipitationProbability >= 60 ? "rain" : "partly-cloudy",
    })),
    alerts: (input.alerts ?? []).map((alert) => ({
      ...alert,
      description: "Provider alert description with 60 mph winds.",
    })),
  };
}

function retrieval(
  locations: readonly Record<string, unknown>[],
  activityWindows: readonly Record<string, unknown>[] = [],
  sources: readonly SourceRecord[] = [source],
): GeminiRetrievalResult {
  return {
    outputText: "Raw summary: 81°F, 60%, coordinates, and other measurements.",
    steps: [{ type: "user_input", content: [] }],
    sources,
    evidence: [
      {
        tool: "get_weather_bundle",
        arguments: {
          locations: locations.map((location) =>
            String((location.location as { name: string }).name)
          ),
          units: "imperial",
        },
        traceArguments: { latitude: "redacted", longitude: "redacted" },
        result: { locations, activityWindows },
      },
    ],
    toolRounds: 1,
  };
}

function allObjectKeys(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allObjectKeys(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, item] of Object.entries(value)) {
    output.add(key);
    allObjectKeys(item, output);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new TypeError("Expected recorded object array.");
  }
  return value;
}

describe("weather composition manifest", () => {
  it("maps an exact requested local hour independently for every comparison location", () => {
    const hourly = Array.from({ length: 48 }, (_, index) => ({
      startTime: new Date(Date.parse("2026-08-02T12:00:00.000Z") + index * 3_600_000).toISOString(),
      temperature: 70 + index,
      precipitationProbability: 5,
    }));
    const raleigh = recordedLocation({
      name: "Raleigh, North Carolina",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
      hourly,
    });
    const london = recordedLocation({
      name: "London, England",
      timeZone: "Europe/London",
      unit: "F",
      temperature: 72,
      hourly,
    });

    const payload = buildWeatherCompositionPayload({
      prompt: "Compare Raleigh and London at 8 AM local tomorrow.",
      clientContext,
      retrieval: retrieval([raleigh, london]),
    });

    expect(payload?.weatherManifest.request.hourlyCoverage).toEqual([
      { locationIndex: 0, indexes: [24] },
      { locationIndex: 1, indexes: [19] },
    ]);
    expect(payload?.weatherManifest.comparison?.selectableHourlyIndexes).toEqual([24]);
    expect(payload?.weatherManifest.comparison?.rankings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        forecastKind: "hourly",
        anchorIndex: 24,
        axisLabel: "8:00 AM",
        metric: "temperature",
      }),
    ]));
  });

  it("omits provider records, location identifiers, URLs, and raw numeric measurements", () => {
    const alertSource: SourceRecord = {
      ...source,
      id: "src_weather02",
      title: "Alert authority",
      url: "https://alerts.example.test/current-warning",
    };
    const location = recordedLocation({
      name: "New Orleans, Louisiana",
      timeZone: "America/Chicago",
      unit: "F",
      temperature: 88,
      alerts: [
        {
          title: "Severe Thunderstorm Warning",
          severity: "severe",
          expiresAt: "2026-08-02T23:00:00.000Z",
          sourceAuthorityUri: alertSource.url,
        },
      ],
    });

    const payload = buildWeatherCompositionPayload({
      prompt: "Are there severe weather alerts in New Orleans right now?",
      clientContext,
      retrieval: retrieval([location], [], [source, alertSource]),
    });

    expect(payload).not.toBeNull();
    const serialized = JSON.stringify(payload);
    const keys = allObjectKeys(payload);
    expect(serialized).not.toMatch(/https?:\/\//i);
    expect(serialized).not.toMatch(/81°F|88°F|60\s?mph|60%/i);
    expect(keys).not.toContain("latitude");
    expect(keys).not.toContain("longitude");
    expect(keys).not.toContain("placeId");
    expect(keys).not.toContain("url");
    expect(keys).not.toContain("accessedAt");
    expect(keys).not.toContain("snippet");
    expect(keys).not.toContain("steps");
    expect(keys).not.toContain("traceArguments");
    expect(keys).not.toContain("temperature");
    expect(keys).not.toContain("feelsLike");
    expect(keys).not.toContain("humidity");
    expect(keys).not.toContain("precipitationProbability");
    expect(keys).not.toContain("windSpeed");
    expect(keys).not.toContain("visibility");
    expect(keys).not.toContain("uvIndex");
    expect(keys).not.toContain("high");
    expect(keys).not.toContain("low");
    expect(payload?.sources).toEqual([
      {
        id: "src_weather01",
        title: "Recorded Google Weather evidence",
        provider: "google-weather",
        role: "weather-provider",
      },
      {
        id: "src_weather02",
        title: "Alert authority",
        provider: "google-weather",
        role: "alert-authority",
      },
    ]);
    expect(payload?.weatherManifest.locations[0]?.selectableAlerts[0]).toMatchObject({
      index: 0,
      title: "Severe Thunderstorm Warning",
      severity: "severe",
      expiresLocal: "6:00 PM",
      authoritySourceId: "src_weather02",
    });
  });

  it("preserves QW04 activity and supporting-hour indexes in Denver local time", () => {
    const denver = recordedLocation({
      name: "Denver, Colorado",
      timeZone: "America/Denver",
      unit: "F",
      temperature: 62,
      hourly: [
        { startTime: "2026-08-03T12:00:00.000Z", temperature: 59, precipitationProbability: 5 },
        { startTime: "2026-08-03T13:00:00.000Z", temperature: 61, precipitationProbability: 4 },
        { startTime: "2026-08-03T14:00:00.000Z", temperature: 64, precipitationProbability: 4 },
      ],
    });
    const denverLocation = denver.location as Record<string, unknown>;
    const payload = buildWeatherCompositionPayload({
      prompt: "What should I wear for a 7 AM run in Denver tomorrow?",
      clientContext: { ...clientContext, timeZone: "America/Denver" },
      retrieval: retrieval(
        [denver],
        [
          {
            location: denverLocation,
            activity: "run",
            durationHours: 1,
            startTime: "2026-08-03T13:00:00.000Z",
            endTime: "2026-08-03T14:00:00.000Z",
            label: "7:00 AM run",
            detail: "Wear a light layer around 61°F.",
            confidence: "high",
          },
        ],
      ),
    });

    expect(payload?.weatherManifest.request.activity).toEqual({
      name: "run",
      localTime: "7:00 AM",
      dayOffset: 1,
      eligibleActivityWindowIndexes: [0],
    });
    expect(payload?.weatherManifest.request.hourlyCoverage).toEqual([
      { locationIndex: 0, indexes: [0, 1, 2] },
    ]);
    expect(payload?.weatherManifest.activityWindows[0]).toMatchObject({
      index: 0,
      locationIndex: 0,
      activity: "run",
      startLocal: "7:00 AM",
      endLocal: "8:00 AM",
      weekday: "Monday",
      dayOffset: 1,
      supportingHourIndexes: [0, 1, 2],
    });
  });

  it("matches a provider cycling window to the prompt's canonical bike activity", () => {
    const denver = recordedLocation({
      name: "Denver, Colorado",
      timeZone: "America/Denver",
      unit: "F",
      temperature: 62,
      hourly: [
        { startTime: "2026-08-03T13:00:00.000Z", temperature: 61, precipitationProbability: 4 },
        { startTime: "2026-08-03T14:00:00.000Z", temperature: 64, precipitationProbability: 4 },
      ],
    });

    const payload = buildWeatherCompositionPayload({
      prompt: "What is the best time for cycling in Denver tomorrow?",
      clientContext: { ...clientContext, timeZone: "America/Denver" },
      retrieval: retrieval([denver], [
        {
          location: denver.location,
          activity: "cycling",
          durationHours: 1,
          startTime: "2026-08-03T13:00:00.000Z",
          endTime: "2026-08-03T14:00:00.000Z",
          label: "Morning cycling window",
          detail: "Provider-selected cycling window.",
          confidence: "high",
        },
      ]),
    });

    expect(payload?.weatherManifest.request.activity).toMatchObject({
      name: "bike",
      eligibleActivityWindowIndexes: [0],
    });
    expect(payload?.weatherManifest.activityWindows[0]?.activity).toBe("bike");
  });

  it("does not treat an activity duration as an initial forecast range", () => {
    const raleigh = recordedLocation({
      name: "Raleigh, North Carolina",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
      hourly: [
        { startTime: "2026-08-02T12:00:00.000Z", temperature: 78, precipitationProbability: 10 },
        { startTime: "2026-08-02T13:00:00.000Z", temperature: 79, precipitationProbability: 10 },
        { startTime: "2026-08-02T16:00:00.000Z", temperature: 82, precipitationProbability: 8 },
        { startTime: "2026-08-02T17:00:00.000Z", temperature: 83, precipitationProbability: 8 },
        { startTime: "2026-08-02T18:00:00.000Z", temperature: 84, precipitationProbability: 9 },
        { startTime: "2026-08-02T19:00:00.000Z", temperature: 84, precipitationProbability: 10 },
      ],
    });

    const payload = buildWeatherCompositionPayload({
      prompt: "When should I take a 2-hour run in Raleigh today?",
      clientContext,
      retrieval: retrieval([raleigh], [
        {
          location: raleigh.location,
          activity: "run",
          durationHours: 2,
          startTime: "2026-08-02T17:00:00.000Z",
          endTime: "2026-08-02T19:00:00.000Z",
          label: "Two-hour afternoon run",
          detail: "Provider-selected run window.",
          confidence: "high",
        },
      ]),
    });

    expect(payload?.weatherManifest.request.activity).toMatchObject({
      name: "run",
      durationHours: 2,
      dayOffset: 0,
      eligibleActivityWindowIndexes: [0],
    });
    expect(payload?.weatherManifest.request.hourlyCoverage).toEqual([
      { locationIndex: 0, indexes: [2, 3, 4, 5] },
    ]);
  });

  it("preserves QW06 five-day coverage and deterministic daily extrema with ties", () => {
    const tokyo = recordedLocation({
      name: "Tokyo, Japan",
      timeZone: "Asia/Tokyo",
      unit: "C",
      temperature: 30,
      daily: [
        { date: "2026-08-03", high: 32, low: 25, precipitationProbability: 35 },
        { date: "2026-08-04", high: 29, low: 24, precipitationProbability: 85 },
        { date: "2026-08-05", high: 31, low: 25, precipitationProbability: 45 },
        { date: "2026-08-06", high: 33, low: 26, precipitationProbability: 25 },
        { date: "2026-08-07", high: 33, low: 25, precipitationProbability: 25 },
        { date: "2026-08-08", high: 41, low: 18, precipitationProbability: 99 },
      ],
    });

    const payload = buildWeatherCompositionPayload({
      prompt: "Show Tokyo's five-day outlook in Celsius and call out the wettest day.",
      clientContext: { ...clientContext, timeZone: "Asia/Tokyo", units: "metric" },
      retrieval: retrieval([tokyo]),
    });

    expect(payload?.weatherManifest.request.dailyCoverage).toEqual([
      { locationIndex: 0, indexes: [0, 1, 2, 3, 4] },
    ]);
    expect(payload?.weatherManifest.request.requestedSignals).toEqual(["wettest"]);
    expect(payload?.weatherManifest.locations[0]?.selectableDays.map((day) => day.index)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(payload?.weatherManifest.locations[0]?.dailySignals).toEqual({
      wettest: { preferredIndex: 1, eligibleIndexes: [1] },
      driest: { preferredIndex: 3, eligibleIndexes: [3, 4] },
      warmest: { preferredIndex: 3, eligibleIndexes: [3, 4] },
      coolest: { preferredIndex: 1, eligibleIndexes: [1] },
    });
  });

  it("selects tomorrow by the location's local calendar day", () => {
    const tokyo = recordedLocation({
      name: "Tokyo, Japan",
      timeZone: "Asia/Tokyo",
      unit: "C",
      temperature: 30,
      daily: [
        { date: "2026-08-03", high: 32, low: 25, precipitationProbability: 35 },
        { date: "2026-08-04", high: 29, low: 24, precipitationProbability: 85 },
      ],
    });
    (tokyo.current as Record<string, unknown>).observedAt = "2026-08-02T23:30:00.000Z";

    const payload = buildWeatherCompositionPayload({
      prompt: "Show Tokyo weather tomorrow in Celsius.",
      clientContext: { ...clientContext, timeZone: "Asia/Tokyo", units: "metric" },
      retrieval: retrieval([tokyo]),
    });

    expect(payload?.weatherManifest.request.dailyCoverage).toEqual([
      { locationIndex: 0, indexes: [1] },
    ]);
    expect(payload?.weatherManifest.locations[0]?.selectableDays.map((day) => day.index)).toEqual([
      1,
    ]);
  });

  it.each(["today and tomorrow", "today through tomorrow"])(
    "selects both local relative days for %s",
    (range) => {
      const raleigh = recordedLocation({
        name: "Raleigh, North Carolina",
        timeZone: "America/New_York",
        unit: "F",
        temperature: 81,
        daily: [
          { date: "2026-08-02", high: 84, low: 67, precipitationProbability: 20 },
          { date: "2026-08-03", high: 85, low: 68, precipitationProbability: 25 },
          { date: "2026-08-04", high: 86, low: 69, precipitationProbability: 30 },
        ],
      });

      const payload = buildWeatherCompositionPayload({
        prompt: `Show Raleigh weather ${range}.`,
        clientContext,
        retrieval: retrieval([raleigh]),
      });

      expect(payload?.weatherManifest.request.dailyCoverage).toEqual([
        { locationIndex: 0, indexes: [0, 1] },
      ]);
    },
  );

  it.each(["through Tuesday", "until Tuesday"])(
    "selects the inclusive local range for %s",
    (range) => {
      const raleigh = recordedLocation({
        name: "Raleigh, North Carolina",
        timeZone: "America/New_York",
        unit: "F",
        temperature: 81,
        daily: [
          { date: "2026-08-02", high: 84, low: 67, precipitationProbability: 20 },
          { date: "2026-08-03", high: 85, low: 68, precipitationProbability: 25 },
          { date: "2026-08-04", high: 86, low: 69, precipitationProbability: 30 },
          { date: "2026-08-05", high: 87, low: 70, precipitationProbability: 35 },
        ],
      });

      const payload = buildWeatherCompositionPayload({
        prompt: `Show Raleigh weather ${range}.`,
        clientContext,
        retrieval: retrieval([raleigh]),
      });

      expect(payload?.weatherManifest.request.dailyCoverage).toEqual([
        { locationIndex: 0, indexes: [0, 1, 2] },
      ]);
      expect(payload?.weatherManifest.request.namedDays.map((day) => day.weekday)).toEqual([
        "Sunday",
        "Monday",
        "Tuesday",
      ]);
    },
  );

  it.each(["this weekend", "the weekend"])(
    "selects the next complete Saturday and Sunday for %s",
    (period) => {
      const raleigh = recordedLocation({
        name: "Raleigh, North Carolina",
        timeZone: "America/New_York",
        unit: "F",
        temperature: 81,
        daily: [
          { date: "2026-08-05", high: 86, low: 68, precipitationProbability: 20 },
          { date: "2026-08-06", high: 85, low: 67, precipitationProbability: 25 },
          { date: "2026-08-07", high: 84, low: 66, precipitationProbability: 30 },
          { date: "2026-08-08", high: 82, low: 65, precipitationProbability: 35 },
          { date: "2026-08-09", high: 83, low: 64, precipitationProbability: 15 },
          { date: "2026-08-10", high: 85, low: 65, precipitationProbability: 10 },
        ],
      });
      (raleigh.current as Record<string, unknown>).observedAt = "2026-08-05T16:00:00.000Z";

      const payload = buildWeatherCompositionPayload({
        prompt: `Show Raleigh weather for ${period}.`,
        clientContext,
        retrieval: retrieval([raleigh]),
      });

      expect(payload?.weatherManifest.request.dailyCoverage).toEqual([
        { locationIndex: 0, indexes: [3, 4] },
      ]);
      expect(payload?.weatherManifest.locations[0]?.selectableDays.map((day) => day.weekday)).toEqual([
        "Saturday",
        "Sunday",
      ]);
      expect(payload?.weatherManifest.request.namedDays).toEqual([
        { locationIndex: 0, weekday: "Saturday", dayIndex: 3 },
        { locationIndex: 0, weekday: "Sunday", dayIndex: 4 },
      ]);
    },
  );

  it.each(["this", "next"] as const)(
    "selects the full seven-day evidence range for %s week",
    (week) => {
      const raleigh = recordedLocation({
        name: "Raleigh, North Carolina",
        timeZone: "America/New_York",
        unit: "F",
        temperature: 81,
        daily: Array.from({ length: 9 }, (_, index) => ({
          date: `2026-08-${String(index + 5).padStart(2, "0")}`,
          high: 86 - index,
          low: 68 - index,
          precipitationProbability: 10 + index,
        })),
      });
      (raleigh.current as Record<string, unknown>).observedAt = "2026-08-05T16:00:00.000Z";

      const payload = buildWeatherCompositionPayload({
        prompt: `Show Raleigh weather for ${week} week.`,
        clientContext,
        retrieval: retrieval([raleigh]),
      });

      expect(payload?.weatherManifest.request.dailyCoverage).toEqual([
        { locationIndex: 0, indexes: [0, 1, 2, 3, 4, 5, 6] },
      ]);
      expect(payload?.weatherManifest.locations[0]?.selectableDays).toHaveLength(7);
    },
  );

  it("expands a Monday-through-Friday span to every included forecast day", () => {
    const raleigh = recordedLocation({
      name: "Raleigh, North Carolina",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
      daily: Array.from({ length: 9 }, (_, index) => ({
        date: `2026-08-${String(index + 2).padStart(2, "0")}`,
        high: 86 - index,
        low: 68 - index,
        precipitationProbability: 10 + index,
      })),
    });

    const payload = buildWeatherCompositionPayload({
      prompt: "Show Raleigh weather Monday through Friday.",
      clientContext,
      retrieval: retrieval([raleigh]),
    });

    expect(payload?.weatherManifest.request.dailyCoverage).toEqual([
      { locationIndex: 0, indexes: [1, 2, 3, 4, 5] },
    ]);
    expect(payload?.weatherManifest.locations[0]?.selectableDays.map((day) => day.weekday)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
    expect(payload?.weatherManifest.request.namedDays.map((day) => day.weekday)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
  });

  it("selects only the next local occurrence for next Sunday", () => {
    const tokyo = recordedLocation({
      name: "Tokyo, Japan",
      timeZone: "Asia/Tokyo",
      unit: "C",
      temperature: 30,
      daily: Array.from({ length: 8 }, (_, index) => ({
        date: `2026-08-${String(index + 2).padStart(2, "0")}`,
        high: 32 - index,
        low: 25 - index,
        precipitationProbability: 20 + index,
      })),
    });
    // This instant is already Sunday in Tokyo, so "next Sunday" must skip today.
    (tokyo.current as Record<string, unknown>).observedAt = "2026-08-01T15:30:00.000Z";

    const payload = buildWeatherCompositionPayload({
      prompt: "Show Tokyo weather next Sunday in Celsius.",
      clientContext: { ...clientContext, timeZone: "Asia/Tokyo", units: "metric" },
      retrieval: retrieval([tokyo]),
    });

    expect(payload?.weatherManifest.request.dailyCoverage).toEqual([
      { locationIndex: 0, indexes: [7] },
    ]);
    expect(payload?.weatherManifest.request.namedDays).toEqual([
      { locationIndex: 0, weekday: "Sunday", dayIndex: 7 },
    ]);
    expect(payload?.weatherManifest.locations[0]?.selectableDays.map((day) => day.date)).toEqual([
      "2026-08-09",
    ]);
  });

  it("rejects requested hourly display ranges over the 24-hour component limit", () => {
    const location = recordedLocation({
      name: "Raleigh, North Carolina",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
    });

    expect(() =>
      buildWeatherCompositionPayload({
        prompt: "Show the next 48-hour weather forecast for Raleigh.",
        clientContext,
        retrieval: retrieval([location]),
      })
    ).toThrow("at most 24 requested forecast hours");
  });

  it("rejects requested daily display ranges over the 10-day evidence limit", () => {
    const location = recordedLocation({
      name: "Raleigh, North Carolina",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
    });

    expect(() =>
      buildWeatherCompositionPayload({
        prompt: "Show the next 14-day weather forecast for Raleigh.",
        clientContext,
        retrieval: retrieval([location]),
      })
    ).toThrow("at most 10 requested forecast days");
  });

  it("scrubs bare URLs, coordinates, and expanded measurement forms from projected text", () => {
    const adversarialSource: SourceRecord = {
      ...source,
      title: "www.weather.gov station at 35.7796, -78.6382 reports 105F, 40 knots, and 12 feet",
    };
    const location = recordedLocation({
      name: "Raleigh www.weather.gov 35.7796, -78.6382 105F",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
      alerts: [{
        title: "Flood warning www.weather.gov at 35.7796, -78.6382 with 40 knots and 12 feet",
        severity: "severe",
      }],
    });

    const payload = buildWeatherCompositionPayload({
      prompt: "Are there active alerts for Raleigh?",
      clientContext,
      retrieval: retrieval([location], [{
        location: location.location,
        activity: "walk www.weather.gov at 35.7796, -78.6382 with 12 kph",
        startTime: "2026-08-03T12:00:00.000Z",
        endTime: "2026-08-03T13:00:00.000Z",
        label: "Provider activity window",
        detail: "Provider detail at 105F",
        confidence: "low",
      }], [adversarialSource]),
    });

    expect(payload).not.toBeNull();
    expect(payload?.userRequest).toBe("Are there active alerts for Raleigh?");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/www\./i);
    expect(serialized).not.toContain("35.7796, -78.6382");
    expect(serialized).not.toMatch(/105F|40 knots|12 feet/i);
    expect(payload?.weatherManifest.locations[0]?.name).toBe("Raleigh");
    expect(payload?.weatherManifest.locations[0]?.selectableAlerts[0]?.title).toBe("Flood warning at with and");
    expect(payload?.weatherManifest.activityWindows[0]?.activity).toBe("walk at with");
  });

  it("filters unknown alerts before enforcing the eight-alert projection cap", () => {
    const location = recordedLocation({
      name: "Raleigh, North Carolina",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
      alerts: [{ title: "Severe warning", severity: "severe" }],
    });
    const alerts = (location.alerts as Record<string, unknown>[]);
    location.alerts = [
      ...Array.from({ length: 8 }, (_, index) => ({
        title: `Unclassified alert ${index + 1}`,
        description: "Provider alert detail",
        severity: "unknown",
      })),
      ...alerts,
    ];

    const payload = buildWeatherCompositionPayload({
      prompt: "Are there active alerts for Raleigh?",
      clientContext,
      retrieval: retrieval([location]),
    });

    expect(payload?.weatherManifest.locations[0]?.selectableAlerts).toEqual([
      expect.objectContaining({ index: 8, title: "Severe warning", severity: "severe" }),
    ]);
  });

  const malformedWeatherCases: readonly [
    string,
    (location: Record<string, unknown>) => void,
  ][] = [
    ["missing latitude", (location) => {
      delete (location.location as Record<string, unknown>).latitude;
    }],
    ["out-of-range longitude", (location) => {
      (location.location as Record<string, unknown>).longitude = 181;
    }],
    ["missing current condition text", (location) => {
      delete (location.current as Record<string, unknown>).conditionText;
    }],
    ["missing current wind direction", (location) => {
      delete (location.current as Record<string, unknown>).windDirection;
    }],
    ["out-of-range humidity", (location) => {
      (location.current as Record<string, unknown>).humidity = 101;
    }],
    ["out-of-range hourly precipitation", (location) => {
      recordArray(location.hourly)[0].precipitationProbability = 101;
    }],
    ["out-of-range daily temperature", (location) => {
      recordArray(location.daily)[0].high = 151;
    }],
    ["missing alert description", (location) => {
      delete recordArray(location.alerts)[0].description;
    }],
  ];

  it.each(malformedWeatherCases)("fails closed before composition for %s", (_, mutate) => {
    const location = recordedLocation({
      name: "Raleigh, North Carolina",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
      hourly: [
        { startTime: "2026-08-03T12:00:00.000Z", temperature: 80, precipitationProbability: 5 },
      ],
      daily: [
        { date: "2026-08-03", high: 86, low: 68, precipitationProbability: 20 },
      ],
      alerts: [{ title: "Severe warning", severity: "severe" }],
    });
    mutate(location);

    expect(() =>
      buildWeatherCompositionPayload({
        prompt: "Show Raleigh weather tomorrow.",
        clientContext,
        retrieval: retrieval([location]),
      })
    ).toThrow("Weather evidence cannot be projected safely for composition");
  });

  it("requires activity detail before projecting an activity window", () => {
    const location = recordedLocation({
      name: "Denver, Colorado",
      timeZone: "America/Denver",
      unit: "F",
      temperature: 62,
    });

    expect(() =>
      buildWeatherCompositionPayload({
        prompt: "What should I wear for a run tomorrow?",
        clientContext,
        retrieval: retrieval([location], [{
          location: location.location,
          activity: "run",
          startTime: "2026-08-03T13:00:00.000Z",
          endTime: "2026-08-03T14:00:00.000Z",
          label: "Morning run",
          confidence: "high",
        }]),
      })
    ).toThrow("Weather evidence cannot be projected safely for composition");
  });

  it("exposes aligned multi-location forecast indexes and qualitative metric rankings", () => {
    const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
    const makeDays = (highs: readonly number[]): DayInput[] =>
      dates.map((date, index) => ({
        date,
        high: highs[index] ?? 0,
        low: (highs[index] ?? 0) - 20,
        precipitationProbability: 10 + index,
      }));
    const locations = [
      recordedLocation({ name: "Miami, Florida", timeZone: "America/New_York", unit: "F", temperature: 89, daily: makeDays([91, 90, 91, 92, 90]) }),
      recordedLocation({ name: "Denver, Colorado", timeZone: "America/Denver", unit: "F", temperature: 80, daily: makeDays([86, 88, 84, 82, 85]) }),
      recordedLocation({ name: "Seattle, Washington", timeZone: "America/Los_Angeles", unit: "F", temperature: 70, daily: makeDays([75, 73, 72, 77, 79]) }),
    ];

    const payload = buildWeatherCompositionPayload({
      prompt: "Chart the next five days of highs for Miami, Denver, and Seattle.",
      clientContext,
      retrieval: retrieval(locations),
    });

    expect(payload?.weatherManifest.comparison).toMatchObject({
      anchorLocationIndex: 0,
      locationIndexes: [0, 1, 2],
      selectableDailyIndexes: [0, 1, 2, 3, 4],
    });
    expect(
      payload?.weatherManifest.comparison?.rankings.find(
        (ranking) => ranking.forecastKind === "daily" && ranking.anchorIndex === 0 && ranking.metric === "high",
      ),
    ).toMatchObject({
      lowToHighLocationIndexes: [2, 1, 0],
      preference: "contextual",
    });
  });

  it("compares each location's own local tomorrow across a calendar-date boundary", () => {
    const raleigh = recordedLocation({
      name: "Raleigh, North Carolina",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
      daily: [
        { date: "2026-08-03", high: 80, low: 67, precipitationProbability: 20 },
      ],
    });
    const tokyo = recordedLocation({
      name: "Tokyo, Japan",
      timeZone: "Asia/Tokyo",
      unit: "F",
      temperature: 84,
      daily: [
        { date: "2026-08-03", high: 100, low: 82, precipitationProbability: 50 },
        { date: "2026-08-04", high: 70, low: 61, precipitationProbability: 10 },
      ],
    });
    // One instant is Sunday evening in Raleigh but already Monday morning in Tokyo.
    (raleigh.current as Record<string, unknown>).observedAt = "2026-08-02T23:30:00.000Z";
    (tokyo.current as Record<string, unknown>).observedAt = "2026-08-02T23:30:00.000Z";

    const payload = buildWeatherCompositionPayload({
      prompt: "Compare Raleigh vs Tokyo tomorrow by forecast highs.",
      clientContext,
      retrieval: retrieval([raleigh, tokyo]),
    });

    expect(payload?.weatherManifest.request.dailyCoverage).toEqual([
      { locationIndex: 0, indexes: [0] },
      { locationIndex: 1, indexes: [1] },
    ]);
    expect(
      payload?.weatherManifest.comparison?.rankings.find(
        (ranking) =>
          ranking.forecastKind === "daily" &&
          ranking.anchorIndex === 0 &&
          ranking.metric === "high",
      ),
    ).toMatchObject({
      axisLabel: "Local tomorrow",
      lowToHighLocationIndexes: [1, 0],
      preference: "contextual",
    });
  });

  it("returns null when retrieval has no weather evidence", () => {
    expect(
      buildWeatherCompositionPayload({
        prompt: "Compare two documented products.",
        clientContext,
        retrieval: { outputText: "Search evidence", steps: [], sources: [], evidence: [], toolRounds: 1 },
      }),
    ).toBeNull();
  });

  it("retains user-supplied thresholds while excluding provider measurements", () => {
    const location = recordedLocation({
      name: "Raleigh, North Carolina",
      timeZone: "America/New_York",
      unit: "F",
      temperature: 81,
    });
    const prompt = "Will Raleigh reach 80°F tomorrow?";

    const payload = buildWeatherCompositionPayload({ prompt, clientContext, retrieval: retrieval([location]) });

    expect(payload?.userRequest).toBe(prompt);
  });

  it("lets an explicit prompt unit override the device preference in planning metadata", () => {
    const location = recordedLocation({
      name: "Seattle, Washington",
      timeZone: "America/Los_Angeles",
      unit: "C",
      temperature: 24,
    });

    const payload = buildWeatherCompositionPayload({
      prompt: "Show Seattle's forecast in Celsius.",
      clientContext,
      retrieval: retrieval([location]),
    });

    expect(payload?.weatherManifest.request.requestedUnits).toBe("metric");
  });

  it.each([
    ["Show Seattle's forecast in ° C.", "metric", "imperial"],
    ["Show Seattle's forecast in ° F.", "imperial", "metric"],
  ] as const)("preserves spaced degree units from %s", (prompt, expected, fallback) => {
    const location = recordedLocation({
      name: "Seattle, Washington",
      timeZone: "America/Los_Angeles",
      unit: expected === "metric" ? "C" : "F",
      temperature: 24,
    });

    const payload = buildWeatherCompositionPayload({
      prompt,
      clientContext: { ...clientContext, units: fallback },
      retrieval: retrieval([location]),
    });

    expect(payload?.weatherManifest.request.requestedUnits).toBe(expected);
  });
});
