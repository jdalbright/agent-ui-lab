import { describe, expect, it } from "vitest";
import { requestedLocalHourCoverage, type WeatherLocalHourLocation } from "./weather-local-hour.js";

function hourlyLocation(
  observedAt: string,
  timeZone: string,
  firstHour: string,
  count = 72,
): WeatherLocalHourLocation {
  const start = Date.parse(firstHour);
  return {
    current: { observedAt, timeZone },
    hourly: Array.from({ length: count }, (_, index) => ({
      startTime: new Date(start + index * 3_600_000).toISOString(),
    })),
  };
}

describe("requestedLocalHourCoverage", () => {
  it("maps the same requested local hour independently across time zones", () => {
    const locations = [
      hourlyLocation("2026-08-02T14:00:00.000Z", "America/New_York", "2026-08-02T14:00:00.000Z"),
      hourlyLocation("2026-08-02T14:00:00.000Z", "Europe/London", "2026-08-02T14:00:00.000Z"),
    ];

    expect(requestedLocalHourCoverage("Compare both cities at 8 AM local tomorrow.", locations))
      .toEqual([
        { locationIndex: 0, indexes: [22] },
        { locationIndex: 1, indexes: [17] },
      ]);
  });

  it("selects the strictly future named weekday", () => {
    const tokyo = hourlyLocation(
      "2026-08-02T14:00:00.000Z",
      "Asia/Tokyo",
      "2026-08-02T14:00:00.000Z",
      240,
    );

    expect(requestedLocalHourCoverage("Tokyo at 9 AM next Tuesday.", [tokyo])).toEqual([
      { locationIndex: 0, indexes: [34] },
    ]);
  });

  it("returns no coverage when hourly evidence cannot represent the requested minute", () => {
    const raleigh = hourlyLocation(
      "2026-08-02T14:00:00.000Z",
      "America/New_York",
      "2026-08-02T14:00:00.000Z",
    );

    expect(requestedLocalHourCoverage("Raleigh at 8:30 AM tomorrow.", [raleigh])).toEqual([]);
  });
});
