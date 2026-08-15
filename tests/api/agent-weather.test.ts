import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRequest } from "../../shared/schemas.js";
import type {
  NormalizedHourlyForecast,
  WeatherBundle,
  WeatherLocation,
} from "../../api/_lib/google-weather.js";
import type { GetWeatherBundleArguments } from "../../api/_lib/gemini.js";

const providerMocks = vi.hoisted(() => ({
  geocodeLocations: vi.fn(),
  reverseGeocodeLocation: vi.fn(),
  getWeatherBundle: vi.fn(),
}));

vi.mock("../../api/_lib/geocoding.js", () => ({
  geocodeLocations: providerMocks.geocodeLocations,
  reverseGeocodeLocation: providerMocks.reverseGeocodeLocation,
}));

vi.mock("../../api/_lib/google-weather.js", () => ({
  getWeatherBundle: providerMocks.getWeatherBundle,
}));

import * as agentModule from "../../api/agent.js";

const request: AgentRequest = {
  requestId: "10000000-0000-4000-8000-000000000001",
  prompt: "weather",
  client: {
    sizeClass: "medium",
    locale: "en-US",
    timeZone: "America/New_York",
    units: "imperial",
    reducedMotion: false,
  },
};

const hour = (
  startTime: string,
  overrides: Partial<NormalizedHourlyForecast> = {},
): NormalizedHourlyForecast => ({
  startTime,
  endTime: new Date(Date.parse(startTime) + 60 * 60 * 1_000).toISOString(),
  temperature: 70,
  feelsLike: 70,
  temperatureUnit: "F",
  precipitationProbability: 5,
  thunderstormProbability: 0,
  conditionKey: "clear",
  conditionText: "Clear",
  isDaytime: true,
  humidity: 40,
  windSpeed: 5,
  windGust: 8,
  windSpeedUnit: "mph",
  ...overrides,
});

function bundle(
  locations: readonly WeatherLocation[],
  hourly: readonly NormalizedHourlyForecast[] = [hour("2026-08-01T18:00:00.000Z")],
  timeZone = "America/New_York",
  observedAt = "2026-08-01T18:00:00.000Z",
): WeatherBundle {
  return {
    units: "imperial",
    fetchedAt: "2026-08-01T18:00:00.000Z",
    attribution: {
      text: "Source: Includes weather data from Google",
      url: "https://developers.google.com/maps/documentation/weather/policies",
    },
    locations: locations.map((location) => ({
      location,
      units: "imperial",
      fetchedAt: "2026-08-01T18:00:00.000Z",
      current: {
        observedAt,
        timeZone,
        temperature: 70,
        feelsLike: 70,
        temperatureUnit: "F",
        conditionKey: "clear",
        conditionText: "Clear",
        isDaytime: true,
        humidity: 40,
        precipitationProbability: 5,
        windDirection: "WEST",
        windDegrees: 270,
        windSpeed: 5,
        windGust: 8,
        windSpeedUnit: "mph",
        visibility: 10,
        visibilityUnit: "mi",
        uvIndex: 2,
        cloudCover: 5,
        thunderstormProbability: 0,
      },
      hourly: [...hourly],
      daily: [],
      alerts: [],
    })),
  };
}

type ExecuteWeather = (
  args: Readonly<GetWeatherBundleArguments>,
  request: AgentRequest,
  apiKey: string,
  signal: AbortSignal,
) => Promise<{ data: unknown; traceArguments?: Readonly<Record<string, unknown>> }>;

const executeWeather = (agentModule as unknown as { executeWeather: ExecuteWeather }).executeWeather;

function requestWithPrompt(prompt: string): AgentRequest {
  return { ...request, prompt };
}

describe("executeWeather", () => {
  beforeEach(() => {
    providerMocks.geocodeLocations.mockReset();
    providerMocks.reverseGeocodeLocation.mockReset();
    providerMocks.getWeatherBundle.mockReset();
  });

  it("requests the full seven-day Seattle outlook", async () => {
    const seattle = { name: "Seattle, WA", latitude: 47.6062, longitude: -122.3321 };
    providerMocks.geocodeLocations.mockResolvedValue([seattle]);
    providerMocks.getWeatherBundle.mockResolvedValue(bundle([seattle]));
    const signal = new AbortController().signal;

    await executeWeather(
      { locations: ["Seattle, WA"], hours: 24, days: 7, units: "metric" },
      request,
      "maps-key",
      signal,
    );

    expect(providerMocks.geocodeLocations).toHaveBeenCalledWith({
      queries: ["Seattle, WA"],
      apiKey: "maps-key",
      locale: "en-US",
      signal,
    });
    expect(providerMocks.getWeatherBundle).toHaveBeenCalledWith(
      expect.objectContaining({ locations: [seattle], hours: 24, days: 7, units: "metric" }),
    );
  });

  it("reports the resolved coarse place name without exposing the raw address", async () => {
    const resolved = {
      query: "123 Main Street, Seattle, WA 98101",
      name: "123 Main Street, Seattle, WA 98101, USA",
      locality: "Seattle",
      region: "WA",
      countryCode: "US",
      latitude: 47.6062,
      longitude: -122.3321,
      types: ["street_address"],
    };
    const seattle = { name: "Seattle, WA", latitude: 47.6062, longitude: -122.3321 };
    providerMocks.geocodeLocations.mockResolvedValue([resolved]);
    providerMocks.getWeatherBundle.mockResolvedValue(bundle([seattle]));

    const result = await executeWeather(
      { location: resolved.query, units: "imperial" },
      request,
      "maps-key",
      new AbortController().signal,
    );

    expect(result.traceArguments).toMatchObject({ locations: ["Seattle, WA"] });
    expect(JSON.stringify(result.traceArguments)).not.toContain("123 Main");
    expect(providerMocks.getWeatherBundle).toHaveBeenCalledWith(
      expect.objectContaining({ locations: [seattle] }),
    );
  });

  it("geocodes and retrieves all four requested named locations", async () => {
    const locations = [
      { name: "Raleigh, NC", latitude: 35.77, longitude: -78.63 },
      { name: "Seattle, WA", latitude: 47.61, longitude: -122.33 },
      { name: "Denver, CO", latitude: 39.74, longitude: -104.99 },
      { name: "Miami, FL", latitude: 25.76, longitude: -80.19 },
    ];
    const queries = locations.map((location) => location.name);
    providerMocks.geocodeLocations.mockResolvedValue(locations);
    providerMocks.getWeatherBundle.mockResolvedValue(bundle(locations));

    const result = await executeWeather(
      { locations: queries, days: 7, units: "imperial" },
      request,
      "maps-key",
      new AbortController().signal,
    );

    expect(providerMocks.geocodeLocations).toHaveBeenCalledWith(
      expect.objectContaining({ queries }),
    );
    expect(providerMocks.getWeatherBundle).toHaveBeenCalledWith(
      expect.objectContaining({ locations }),
    );
    expect((result.data as WeatherBundle).locations).toHaveLength(4);
  });

  it("scores the requested Denver 7 AM run tomorrow and fetches enough hourly evidence", async () => {
    const denver = { name: "Denver, CO", latitude: 39.7392, longitude: -104.9903 };
    const forecast = [
      hour("2026-08-01T19:00:00.000Z"),
      hour("2026-08-01T20:00:00.000Z"),
      hour("2026-08-02T13:00:00.000Z", {
        conditionKey: "rain",
        precipitationProbability: 60,
      }),
      hour("2026-08-02T14:00:00.000Z"),
    ];
    providerMocks.geocodeLocations.mockResolvedValue([denver]);
    providerMocks.getWeatherBundle.mockResolvedValue(bundle([denver], forecast, "America/Denver"));

    const result = await executeWeather(
      {
        locations: ["Denver, CO"],
        hours: 24,
        days: 2,
        units: "imperial",
        activity: "run",
        durationHours: 1,
        targetLocalTime: "07:00",
        targetDayOffset: 1,
      },
      request,
      "maps-key",
      new AbortController().signal,
    );

    expect(providerMocks.getWeatherBundle).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 34, days: 2 }),
    );
    expect(result.data).toMatchObject({
      activityWindows: [
        {
          activity: "run",
          startTime: "2026-08-02T13:00:00.000Z",
          endTime: "2026-08-02T14:00:00.000Z",
          durationHours: 1,
          label: "1-hour run window at requested time",
        },
      ],
    });
  });

  it.each([
    ["omits", undefined],
    ["mismatches", 1],
  ] as const)(
    "keeps an open-ended walk inside today when the tool %s targetDayOffset",
    async (_label, toolTargetDayOffset) => {
      const raleigh = { name: "Raleigh, NC", latitude: 35.7796, longitude: -78.6382 };
      const forecast = [
        hour("2026-08-02T02:00:00.000Z", {
          feelsLike: 96,
          precipitationProbability: 80,
          conditionKey: "rain",
        }),
        hour("2026-08-02T03:00:00.000Z", {
          feelsLike: 96,
          precipitationProbability: 80,
          conditionKey: "rain",
        }),
        hour("2026-08-02T04:00:00.000Z"),
        hour("2026-08-02T05:00:00.000Z"),
      ];
      providerMocks.geocodeLocations.mockResolvedValue([raleigh]);
      providerMocks.getWeatherBundle.mockResolvedValue(bundle([raleigh], forecast));

      const result = await executeWeather(
        {
          locations: ["Raleigh, NC"],
          hours: 24,
          days: 2,
          units: "imperial",
          activity: "walk",
          durationHours: 2,
          ...(toolTargetDayOffset === undefined
            ? {}
            : { targetDayOffset: toolTargetDayOffset }),
        },
        requestWithPrompt("When should I take a walk in Raleigh today?"),
        "maps-key",
        new AbortController().signal,
      );

      expect(providerMocks.getWeatherBundle).toHaveBeenCalledWith(
        expect.objectContaining({ hours: 26, days: 2 }),
      );
      expect(result).toMatchObject({
        data: {
          activityWindows: [
            {
              startTime: "2026-08-02T02:00:00.000Z",
              endTime: "2026-08-02T04:00:00.000Z",
            },
          ],
        },
        traceArguments: { targetDayOffset: 0 },
      });
    },
  );

  it.each([
    ["omits", undefined],
    ["mismatches", 0],
  ] as const)(
    "keeps an open-ended walk inside tomorrow when the tool %s targetDayOffset",
    async (_label, toolTargetDayOffset) => {
      const raleigh = { name: "Raleigh, NC", latitude: 35.7796, longitude: -78.6382 };
      const forecast = [
        hour("2026-08-02T02:00:00.000Z"),
        hour("2026-08-02T03:00:00.000Z"),
        hour("2026-08-02T04:00:00.000Z", {
          feelsLike: 96,
          precipitationProbability: 80,
          conditionKey: "rain",
        }),
        hour("2026-08-02T05:00:00.000Z", {
          feelsLike: 96,
          precipitationProbability: 80,
          conditionKey: "rain",
        }),
      ];
      providerMocks.geocodeLocations.mockResolvedValue([raleigh]);
      providerMocks.getWeatherBundle.mockResolvedValue(bundle([raleigh], forecast));

      const result = await executeWeather(
        {
          locations: ["Raleigh, NC"],
          hours: 24,
          days: 2,
          units: "imperial",
          activity: "walk",
          durationHours: 2,
          ...(toolTargetDayOffset === undefined
            ? {}
            : { targetDayOffset: toolTargetDayOffset }),
        },
        requestWithPrompt("When should I take a walk in Raleigh tomorrow?"),
        "maps-key",
        new AbortController().signal,
      );

      expect(providerMocks.getWeatherBundle).toHaveBeenCalledWith(
        expect.objectContaining({ hours: 50, days: 2 }),
      );
      expect(result).toMatchObject({
        data: {
          activityWindows: [
            {
              startTime: "2026-08-02T04:00:00.000Z",
              endTime: "2026-08-02T06:00:00.000Z",
            },
          ],
        },
        traceArguments: { targetDayOffset: 1 },
      });
    },
  );

  it("uses the prompt day for an exact-time request when tool arguments disagree", async () => {
    const denver = { name: "Denver, CO", latitude: 39.7392, longitude: -104.9903 };
    const forecast = [
      hour("2026-08-01T13:00:00.000Z"),
      hour("2026-08-02T13:00:00.000Z"),
    ];
    providerMocks.geocodeLocations.mockResolvedValue([denver]);
    providerMocks.getWeatherBundle.mockResolvedValue(bundle([denver], forecast, "America/Denver"));

    const result = await executeWeather(
      {
        locations: ["Denver, CO"],
        hours: 24,
        days: 2,
        units: "imperial",
        activity: "run",
        durationHours: 1,
        targetLocalTime: "07:00",
        targetDayOffset: 0,
      },
      requestWithPrompt("When should I run in Denver at 7 AM tomorrow?"),
      "maps-key",
      new AbortController().signal,
    );

    expect(providerMocks.getWeatherBundle).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 34 }),
    );
    expect(result).toMatchObject({
      data: { activityWindows: [{ startTime: "2026-08-02T13:00:00.000Z" }] },
      traceArguments: { targetLocalTime: "07:00", targetDayOffset: 1 },
    });
  });

  it("preserves the exact-time requirement for an explicit tool day offset", async () => {
    const denver = { name: "Denver, CO", latitude: 39.7392, longitude: -104.9903 };
    providerMocks.geocodeLocations.mockResolvedValue([denver]);

    await expect(
      executeWeather(
        {
          locations: ["Denver, CO"],
          units: "imperial",
          activity: "run",
          durationHours: 1,
          targetLocalTime: "07:00",
        },
        requestWithPrompt("When should I run in Denver at 7 AM tomorrow?"),
        "maps-key",
        new AbortController().signal,
      ),
    ).rejects.toThrow("targetDayOffset is required with targetLocalTime");
    expect(providerMocks.getWeatherBundle).not.toHaveBeenCalled();
  });

  it.each([1.5, 10])(
    "rejects malformed targetDayOffset %s even when the prompt supplies today",
    async (targetDayOffset) => {
      const raleigh = { name: "Raleigh, NC", latitude: 35.7796, longitude: -78.6382 };
      providerMocks.geocodeLocations.mockResolvedValue([raleigh]);

      await expect(
        executeWeather(
          {
            locations: ["Raleigh, NC"],
            units: "imperial",
            activity: "walk",
            durationHours: 1,
            targetDayOffset,
          },
          requestWithPrompt("When should I take a walk in Raleigh today?"),
          "maps-key",
          new AbortController().signal,
        ),
      ).rejects.toThrow("targetDayOffset must be an integer from 0 through 9");
      expect(providerMocks.getWeatherBundle).not.toHaveBeenCalled();
    },
  );

  it("fails closed when no complete activity window remains in the requested local day", async () => {
    const raleigh = { name: "Raleigh, NC", latitude: 35.7796, longitude: -78.6382 };
    const forecast = [
      hour("2026-08-02T03:00:00.000Z"),
      hour("2026-08-02T04:00:00.000Z"),
    ];
    providerMocks.geocodeLocations.mockResolvedValue([raleigh]);
    providerMocks.getWeatherBundle.mockResolvedValue(
      bundle([raleigh], forecast, "America/New_York", "2026-08-02T03:30:00.000Z"),
    );

    await expect(
      executeWeather(
        {
          locations: ["Raleigh, NC"],
          hours: 24,
          units: "imperial",
          activity: "walk",
          durationHours: 1,
        },
        requestWithPrompt("When should I take a walk in Raleigh today?"),
        "maps-key",
        new AbortController().signal,
      ),
    ).rejects.toThrow("requested local activity day");
    expect(providerMocks.getWeatherBundle).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 26 }),
    );
  });

  it.each([
    ["fractional hours", { locations: ["Seattle, WA"], hours: 24.5, units: "imperial" }],
    ["excess daily range", { locations: ["Seattle, WA"], days: 11, units: "imperial" }],
    [
      "fractional activity duration",
      { locations: ["Seattle, WA"], durationHours: 1.5, units: "imperial" },
    ],
  ] satisfies Array<[string, GetWeatherBundleArguments]>)(
    "rejects malformed provider ranges instead of changing them: %s",
    async (_label, args) => {
      const seattle = { name: "Seattle, WA", latitude: 47.6062, longitude: -122.3321 };
      providerMocks.geocodeLocations.mockResolvedValue([seattle]);
      providerMocks.getWeatherBundle.mockResolvedValue(bundle([seattle]));

      await expect(
        executeWeather(args, request, "maps-key", new AbortController().signal),
      ).rejects.toBeInstanceOf(RangeError);
      expect(providerMocks.getWeatherBundle).not.toHaveBeenCalled();
    },
  );

  it("rejects target windows beyond the 240-hour forecast horizon", async () => {
    const denver = { name: "Denver, CO", latitude: 39.7392, longitude: -104.9903 };
    const start = Date.parse("2026-10-24T04:00:00.000Z");
    const forecast = Array.from({ length: 240 }, (_, index) =>
      hour(new Date(start + index * 60 * 60 * 1_000).toISOString()),
    );
    providerMocks.geocodeLocations.mockResolvedValue([denver]);
    providerMocks.getWeatherBundle.mockResolvedValue(
      bundle(
        [denver],
        forecast,
        "America/New_York",
        "2026-10-24T04:00:00.000Z",
      ),
    );

    await expect(
      executeWeather(
        {
          locations: ["Denver, CO"],
          units: "imperial",
          activity: "run",
          durationHours: 1,
          targetLocalTime: "23:00",
          targetDayOffset: 9,
        },
        request,
        "maps-key",
        new AbortController().signal,
      ),
    ).rejects.toThrow("provider forecast horizon");
    expect(providerMocks.getWeatherBundle).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 240 }),
    );
  });

  it("accepts the final fall-back provider slot and a spring-forward target", async () => {
    const place = { name: "New York, NY", latitude: 40.7128, longitude: -74.006 };
    providerMocks.geocodeLocations.mockResolvedValue([place]);

    const fallStart = Date.parse("2026-10-24T04:00:00.000Z");
    const fallForecast = Array.from({ length: 240 }, (_, index) =>
      hour(new Date(fallStart + index * 60 * 60 * 1_000).toISOString()),
    );
    providerMocks.getWeatherBundle.mockResolvedValueOnce(
      bundle(
        [place],
        fallForecast,
        "America/New_York",
        "2026-10-24T04:00:00.000Z",
      ),
    );

    const fall = await executeWeather(
      {
        locations: ["New York, NY"],
        units: "imperial",
        activity: "walk",
        durationHours: 1,
        targetLocalTime: "22:00",
        targetDayOffset: 9,
      },
      request,
      "maps-key",
      new AbortController().signal,
    );
    expect(fall.data).toMatchObject({
      activityWindows: [{ startTime: "2026-11-03T03:00:00.000Z" }],
    });

    const springStart = Date.parse("2026-02-28T05:00:00.000Z");
    const springForecast = Array.from({ length: 240 }, (_, index) =>
      hour(new Date(springStart + index * 60 * 60 * 1_000).toISOString()),
    );
    providerMocks.getWeatherBundle.mockResolvedValueOnce(
      bundle(
        [place],
        springForecast,
        "America/New_York",
        "2026-02-28T05:00:00.000Z",
      ),
    );

    const spring = await executeWeather(
      {
        locations: ["New York, NY"],
        units: "imperial",
        activity: "walk",
        durationHours: 1,
        targetLocalTime: "23:00",
        targetDayOffset: 9,
      },
      request,
      "maps-key",
      new AbortController().signal,
    );
    expect(spring.data).toMatchObject({
      activityWindows: [{ startTime: "2026-03-10T03:00:00.000Z" }],
    });
  });
});
