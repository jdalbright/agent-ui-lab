import { describe, expect, it } from "vitest";
import type { NormalizedHourlyForecast, NormalizedWeatherAlert } from "./google-weather.js";
import {
  recommendActivityWindow,
  recommendWalkWindow,
  scoreActivityWindow,
  scoreActivityWindows,
} from "./recommendations.js";

function hour(
  startHour: number,
  overrides: Partial<NormalizedHourlyForecast> = {},
): NormalizedHourlyForecast {
  const start = new Date(Date.UTC(2026, 7, 1, startHour));
  const end = new Date(start.getTime() + 60 * 60 * 1_000);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    temperature: 74,
    feelsLike: 74,
    temperatureUnit: "F",
    precipitationProbability: 5,
    conditionKey: "clear",
    conditionText: "Clear",
    isDaytime: true,
    humidity: 50,
    thunderstormProbability: 0,
    windSpeed: 5,
    windGust: 8,
    windSpeedUnit: "mph",
    ...overrides,
  };
}

describe("deterministic activity recommendations", () => {
  it("chooses the mild, dry two-hour walk window", () => {
    const hours = [
      hour(14, { feelsLike: 96 }),
      hour(15, { conditionKey: "storms", precipitationProbability: 80, windGust: 30 }),
      hour(16, { conditionKey: "rain", precipitationProbability: 65 }),
      hour(17, { temperature: 79, feelsLike: 80, precipitationProbability: 10 }),
      hour(18, { temperature: 76, feelsLike: 76, precipitationProbability: 5 }),
      hour(19, { temperature: 74, feelsLike: 74, precipitationProbability: 5 }),
    ];

    const recommendation = recommendWalkWindow(hours, { durationHours: 2 });

    expect(recommendation).toMatchObject({
      activity: "walk",
      startTime: "2026-08-01T18:00:00.000Z",
      endTime: "2026-08-01T20:00:00.000Z",
      confidence: "high",
    });
    expect(recommendation?.score).toBeGreaterThanOrEqual(90);
    expect(recommendation?.reasons).toContain("Low precipitation risk");
  });

  it("breaks equal-score ties in favor of the earliest window", () => {
    const hours = [hour(10), hour(11), hour(12), hour(13)];

    const recommendation = recommendActivityWindow(hours, {
      activity: "outdoor activity",
      durationHours: 2,
    });

    expect(recommendation?.startTime).toBe("2026-08-01T10:00:00.000Z");
  });

  it("scores storms and overlapping severe alerts as unsafe", () => {
    const window = [
      hour(15, { conditionKey: "storms", precipitationProbability: 80, windGust: 35 }),
      hour(16, { conditionKey: "storms", precipitationProbability: 75, windGust: 30 }),
    ];
    const alerts: NormalizedWeatherAlert[] = [
      {
        id: "warning",
        title: "Severe Thunderstorm Warning",
        eventType: "Severe thunderstorm warning",
        eventTypeCode: "SEVERE_THUNDERSTORM_WARNING",
        areaName: "Wake County",
        description: "Damaging winds possible.",
        instructions: [],
        safetyRecommendations: [],
        startsAt: "2026-08-01T15:00:00.000Z",
        expiresAt: "2026-08-01T17:00:00.000Z",
        severity: "severe",
        certainty: "likely",
        urgency: "immediate",
        sourceName: "National Weather Service",
        sourceAuthorityUri: "https://www.weather.gov/",
      },
    ];

    const score = scoreActivityWindow(window, { alerts });

    expect(score.score).toBeLessThanOrEqual(15);
    expect(score.confidence).toBe("low");
    expect(score.reasons).toContain("Active severe weather alert");
  });

  it("penalizes sustained wind even when gust data is low", () => {
    const score = scoreActivityWindow([
      hour(10, { windSpeed: 40, windGust: 10 }),
      hour(11, { windSpeed: 38, windGust: 10 }),
    ]);

    expect(score.score).toBeLessThan(80);
    expect(score.reasons).toContain("Strong sustained wind");
  });

  it("penalizes a high thunderstorm probability even before the condition enum changes", () => {
    const score = scoreActivityWindow([
      { ...hour(10), thunderstormProbability: 80 },
      { ...hour(11), thunderstormProbability: 75 },
    ]);

    expect(score.score).toBeLessThan(60);
    expect(score.reasons).toContain("High thunderstorm risk");
  });

  it("does not describe sparse forecast data as dry or calm", () => {
    const score = scoreActivityWindow([
      hour(10, {
        conditionKey: "unknown",
        precipitationProbability: null,
        thunderstormProbability: null,
        windSpeed: null,
        windGust: null,
      }),
      hour(11, {
        conditionKey: "unknown",
        precipitationProbability: null,
        thunderstormProbability: null,
        windSpeed: null,
        windGust: null,
      }),
    ]);

    expect(score.confidence).toBe("low");
    expect(score.reasons).toContain("Incomplete forecast data");
    expect(score.reasons).not.toContain("Low precipitation risk");
    expect(score.reasons).not.toContain("Light wind");
  });

  it("retains known hazard penalties when another hour is missing that field", () => {
    const score = scoreActivityWindow([
      hour(10, {
        precipitationProbability: 100,
        thunderstormProbability: 90,
        windSpeed: 40,
      }),
      hour(11, {
        precipitationProbability: null,
        thunderstormProbability: null,
        windSpeed: null,
      }),
    ]);

    expect(score.reasons).toContain("High precipitation risk");
    expect(score.reasons).toContain("High thunderstorm risk");
    expect(score.reasons).toContain("Strong sustained wind");
    expect(score.confidence).toBe("low");
  });

  it("does not treat an explicitly past alert with omitted bounds as active", () => {
    const alert: NormalizedWeatherAlert = {
      id: "past-warning",
      title: "Expired warning",
      eventType: "Flood",
      eventTypeCode: "FLOOD",
      areaName: "Wake County",
      description: "This warning has ended.",
      instructions: [],
      safetyRecommendations: [],
      severity: "severe",
      certainty: "observed",
      urgency: "past",
    };

    const score = scoreActivityWindow([hour(10), hour(11)], { alerts: [alert] });

    expect(score.reasons).not.toContain("Active severe weather alert");
    expect(score.confidence).toBe("high");
  });

  it("returns null when no complete consecutive window is available", () => {
    const hours = [hour(10), hour(12)];
    expect(recommendWalkWindow(hours, { durationHours: 2 })).toBeNull();
  });

  it("scores the best activity window for every location in a weather bundle", () => {
    const hours = [hour(10), hour(11)];
    const recommendations = scoreActivityWindows(
      {
        units: "imperial",
        fetchedAt: "2026-08-01T09:00:00.000Z",
        attribution: {
          text: "Source: Includes weather data from Google",
          url: "https://developers.google.com/maps/documentation/weather/policies",
        },
        locations: [
          {
            location: { name: "Raleigh, NC", latitude: 35.77, longitude: -78.63 },
            units: "imperial",
            fetchedAt: "2026-08-01T09:00:00.000Z",
            current: {
              observedAt: "2026-08-01T09:00:00.000Z",
              timeZone: "America/New_York",
              temperature: 70,
              feelsLike: 70,
              temperatureUnit: "F",
              conditionKey: "clear",
              conditionText: "Clear",
              isDaytime: true,
              humidity: 50,
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
            hourly: hours,
            daily: [],
            alerts: [],
          },
        ],
      },
      "walk",
    );

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      location: { name: "Raleigh, NC" },
      activity: "walk",
      startTime: "2026-08-01T10:00:00.000Z",
    });
  });
});
