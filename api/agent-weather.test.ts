import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRequest } from "../shared/schemas.js";
import type {
  NormalizedHourlyForecast,
  WeatherBundle,
  WeatherLocation,
} from "./_lib/google-weather.js";
import type { GetWeatherBundleArguments } from "./_lib/gemini.js";

const providerMocks = vi.hoisted(() => ({
  geocodeLocations: vi.fn(),
  reverseGeocodeLocation: vi.fn(),
  getWeatherBundle: vi.fn(),
}));

vi.mock("./_lib/geocoding.js", () => ({
  geocodeLocations: providerMocks.geocodeLocations,
  reverseGeocodeLocation: providerMocks.reverseGeocodeLocation,
}));

vi.mock("./_lib/google-weather.js", () => ({
  getWeatherBundle: providerMocks.getWeatherBundle,
}));

import * as agentModule from "./agent.js";

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
        observedAt: "2026-08-01T18:00:00.000Z",
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
) => Promise<{ data: unknown }>;

const executeWeather = (agentModule as unknown as { executeWeather: ExecuteWeather }).executeWeather;

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
      expect.objectContaining({ hours: 48, days: 2 }),
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
    providerMocks.geocodeLocations.mockResolvedValue([denver]);
    providerMocks.getWeatherBundle.mockResolvedValue(bundle([denver], [], "America/Denver"));

    await expect(
      executeWeather(
        {
          locations: ["Denver, CO"],
          units: "imperial",
          activity: "run",
          durationHours: 6,
          targetLocalTime: "23:30",
          targetDayOffset: 9,
        },
        request,
        "maps-key",
        new AbortController().signal,
      ),
    ).rejects.toThrow("240-hour");
    expect(providerMocks.getWeatherBundle).not.toHaveBeenCalled();
  });
});
