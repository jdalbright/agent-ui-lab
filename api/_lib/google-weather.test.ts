import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../_fixtures/google-weather.json" with { type: "json" };
import {
  GoogleWeatherError,
  clearGoogleWeatherCache,
  getGoogleWeatherBundle,
  getGoogleWeatherBundles,
  getWeatherBundle,
  normalizeCondition,
} from "./google-weather.js";

const location = {
  name: "Raleigh, NC",
  latitude: 35.7795897,
  longitude: -78.6381787,
};

function responseFor(input: RequestInfo | URL): Response {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.pathname.endsWith("/currentConditions:lookup")) {
    return Response.json(fixture.current);
  }
  if (url.pathname.endsWith("/forecast/hours:lookup")) {
    return Response.json(fixture.hourly);
  }
  if (url.pathname.endsWith("/forecast/days:lookup")) {
    return Response.json(fixture.daily);
  }
  if (url.pathname.endsWith("/publicAlerts:lookup")) {
    return Response.json(fixture.alerts);
  }
  return Response.json({ error: "unexpected path" }, { status: 404 });
}

describe("Google Weather provider", () => {
  beforeEach(() => clearGoogleWeatherCache());

  it("calls the four documented v1 endpoints and normalizes their payloads", async () => {
    const seen: URL[] = [];
    const seenHeaders: Headers[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new URL(input instanceof Request ? input.url : input.toString()));
      seenHeaders.push(new Headers(init?.headers));
      return Promise.resolve(responseFor(input));
    });

    const result = await getWeatherBundle({
      locations: [location],
      apiKey: "test-key",
      fetchImpl,
      units: "imperial",
      locale: "en",
      hours: 6,
      days: 2,
      cacheTtlMs: 0,
      now: () => Date.parse("2026-08-01T14:05:00Z"),
    });
    const bundle = result.locations[0];

    expect(seen.map((url) => url.pathname).sort()).toEqual([
      "/v1/currentConditions:lookup",
      "/v1/forecast/days:lookup",
      "/v1/forecast/hours:lookup",
      "/v1/publicAlerts:lookup",
    ]);
    for (const [index, url] of seen.entries()) {
      expect(url.searchParams.has("key")).toBe(false);
      expect(seenHeaders[index].get("X-Goog-Api-Key")).toBe("test-key");
      expect(url.searchParams.get("location.latitude")).toBe(String(location.latitude));
      expect(url.searchParams.get("location.longitude")).toBe(String(location.longitude));
      expect(url.searchParams.get("languageCode")).toBe("en");
    }
    expect(seen.find((url) => url.pathname.includes("forecast/hours"))?.searchParams.get("hours")).toBe("6");
    expect(seen.find((url) => url.pathname.includes("forecast/hours"))?.searchParams.get("pageSize")).toBe("6");
    expect(seen.find((url) => url.pathname.includes("forecast/days"))?.searchParams.get("days")).toBe("2");
    expect(seen.find((url) => url.pathname.includes("forecast/days"))?.searchParams.get("pageSize")).toBe("2");
    expect(seen.find((url) => url.pathname.includes("publicAlerts"))?.searchParams.has("unitsSystem")).toBe(false);
    expect(seen.filter((url) => !url.pathname.includes("publicAlerts")).every((url) => url.searchParams.get("unitsSystem") === "IMPERIAL")).toBe(true);

    expect(bundle).toMatchObject({
      location,
      units: "imperial",
      fetchedAt: "2026-08-01T14:05:00.000Z",
      alertRegionCode: "US",
      current: {
        observedAt: "2026-08-01T14:00:00.123Z",
        timeZone: "America/New_York",
        temperature: 82.4,
        temperatureUnit: "F",
        conditionKey: "partly-cloudy",
        precipitationProbability: 15,
        windSpeed: 9,
        visibility: 10,
      },
    });
    expect(bundle.hourly).toHaveLength(6);
    expect(bundle.hourly[1]).toMatchObject({
      startTime: "2026-08-01T15:00:00.000Z",
      conditionKey: "storms",
      precipitationProbability: 70,
      thunderstormProbability: 65,
    });
    expect(bundle.daily[0]).toMatchObject({
      date: "2026-08-01",
      high: 91,
      low: 72,
      conditionKey: "storms",
      precipitationProbability: 70,
    });
    expect(bundle.alerts[0]).toMatchObject({
      id: "fixture-alert-1",
      title: "Severe Thunderstorm Warning",
      eventType: "Severe thunderstorm warning",
      eventTypeCode: "SEVERE_THUNDERSTORM_WARNING",
      severity: "severe",
      sourcePublisherCode: "NOAA",
      sourceName: "National Weather Service",
      sourceAuthorityUri: "https://www.weather.gov/",
      startsAt: "2026-08-01T15:00:00.000Z",
      expiresAt: "2026-08-01T17:00:00.000Z",
    });
    expect(result).toMatchObject({
      units: "imperial",
      fetchedAt: "2026-08-01T14:05:00.000Z",
      attribution: {
        text: "Source: Includes weather data from Google",
        url: "https://developers.google.com/maps/documentation/weather/policies",
      },
    });
  });

  it("normalizes Google condition enums into the trusted condition set", () => {
    expect(normalizeCondition("CLEAR")).toBe("clear");
    expect(normalizeCondition("MOSTLY_CLEAR")).toBe("partly-cloudy");
    expect(normalizeCondition("MOSTLY_CLOUDY")).toBe("cloudy");
    expect(normalizeCondition("RAIN_SHOWERS")).toBe("rain");
    expect(normalizeCondition("SCATTERED_THUNDERSTORMS")).toBe("storms");
    expect(normalizeCondition("HEAVY_SNOW_STORM")).toBe("snow");
    expect(normalizeCondition("DENSE_FOG")).toBe("fog");
    expect(normalizeCondition("WINDY")).toBe("wind");
    expect(normalizeCondition("TYPE_UNSPECIFIED")).toBe("unknown");
  });

  it("uses place identity for cache reuse and rebinds exact caller metadata", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => Promise.resolve(responseFor(input)));
    const options = {
      apiKey: "test-key",
      fetchImpl,
      units: "metric" as const,
      hours: 6,
      days: 2,
      cacheTtlMs: 60_000,
      now: () => now,
    };

    const firstLocation = { ...location, placeId: "place-raleigh" };
    await getGoogleWeatherBundle(firstLocation, options);
    const cachedLocation = {
      ...firstLocation,
      name: "Current selection",
      latitude: 35.7798,
      longitude: -78.6384,
    };
    const cached = await getGoogleWeatherBundle(cachedLocation, options);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(cached.location).toEqual(cachedLocation);

    now += 60_001;
    await getGoogleWeatherBundle(firstLocation, options);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  it("coarsens coordinate cache identity when a place ID is unavailable", async () => {
    const seen: URL[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      seen.push(new URL(input instanceof Request ? input.url : input.toString()));
      return Promise.resolve(responseFor(input));
    });
    const options = {
      apiKey: "test-key",
      fetchImpl,
      units: "metric" as const,
      hours: 6,
      days: 2,
      cacheTtlMs: 60_000,
    };
    const nearbyLocation = {
      name: "  RALEIGH,   NC ",
      latitude: 35.7798,
      longitude: -78.6384,
    };

    await getGoogleWeatherBundle(location, options);
    const cached = await getGoogleWeatherBundle(nearbyLocation, options);

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(seen[0]?.searchParams.get("location.latitude")).toBe(String(location.latitude));
    expect(seen[0]?.searchParams.get("location.longitude")).toBe(String(location.longitude));
    expect(cached.location).toEqual({ ...nearbyLocation, name: "RALEIGH,   NC" });
  });

  it("follows public-alert page tokens without changing request parameters", async () => {
    const alertUrls: URL[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (!url.pathname.endsWith("/publicAlerts:lookup")) return Promise.resolve(responseFor(input));
      alertUrls.push(url);
      if (url.searchParams.get("pageToken") === "alerts-page-2") {
        return Promise.resolve(
          Response.json({
            regionCode: "US",
            weatherAlerts: [
              {
                ...fixture.alerts.weatherAlerts[0],
                alertId: "fixture-alert-2",
                alertTitle: { text: "Flood Warning", languageCode: "en" },
              },
            ],
          }),
        );
      }
      return Promise.resolve(Response.json({ ...fixture.alerts, nextPageToken: "alerts-page-2" }));
    });

    const bundle = await getGoogleWeatherBundle(location, {
      apiKey: "test-key",
      fetchImpl,
      hours: 6,
      days: 2,
      cacheTtlMs: 0,
    });

    expect(bundle.alerts.map((alert) => alert.id)).toEqual(["fixture-alert-1", "fixture-alert-2"]);
    expect(alertUrls).toHaveLength(2);
    expect(alertUrls[1].searchParams.get("pageToken")).toBe("alerts-page-2");
    for (const parameter of ["location.latitude", "location.longitude", "languageCode", "pageSize"]) {
      expect(alertUrls[1].searchParams.get(parameter)).toBe(alertUrls[0].searchParams.get(parameter));
    }
  });

  it("rejects comparisons above four locations before making a request", async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => Promise.resolve(responseFor(input)));
    const locations = Array.from({ length: 5 }, (_, index) => ({
      name: `Location ${index + 1}`,
      latitude: 30 + index,
      longitude: -80 - index,
    }));

    await expect(getGoogleWeatherBundles(locations, { apiKey: "test-key", fetchImpl })).rejects.toThrow(
      "A maximum of 4 locations is supported.",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not expose API keys or coordinates in provider errors", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json({ error: { message: "denied" } }, { status: 403 })));

    const promise = getGoogleWeatherBundle(location, {
      apiKey: "super-secret-key",
      fetchImpl,
      cacheTtlMs: 0,
    });
    await expect(promise).rejects.toBeInstanceOf(GoogleWeatherError);
    await expect(promise).rejects.not.toThrow(/super-secret-key|35\.7795897|-78\.6381787/);
  });
});
