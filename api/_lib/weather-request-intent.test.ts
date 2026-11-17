import { describe, expect, it } from "vitest";
import { parseWeatherRequestIntent, weekdayDayOffset } from "./weather-request-intent.js";

describe("parseWeatherRequestIntent", () => {
  it.each(["this week", "next week"])(
    "normalizes %s to a seven-day forecast range",
    (range) => {
      const intent = parseWeatherRequestIntent(`Show Raleigh weather for ${range}.`);

      expect(intent.forecastDays).toBe(7);
    },
  );

  it.each(["today and tomorrow", "today through tomorrow"])(
    "preserves both local relative days for %s",
    (range) => {
      const intent = parseWeatherRequestIntent(`Show Raleigh weather ${range}.`);

      expect(intent.relativeDayOffsets).toEqual([0, 1]);
    },
  );

  it.each(["through Tuesday", "until Tuesday"])(
    "recognizes the inclusive ending weekday in %s",
    (range) => {
      const intent = parseWeatherRequestIntent(`Show Raleigh weather ${range}.`);

      expect(intent.throughWeekday).toBe("tuesday");
    },
  );

  it.each([
    ["Show the forecast in ° C.", "metric"],
    ["Show the forecast in ° F.", "imperial"],
  ] as const)("recognizes spaced degree units in %s", (prompt, units) => {
    expect(parseWeatherRequestIntent(prompt).requestedUnits).toBe(units);
  });

  it("keeps an activity duration separate from a forecast-hour range", () => {
    const intent = parseWeatherRequestIntent(
      "Show the next six hours around my 2-hour run in Raleigh today.",
    );

    expect(intent.forecastHours).toBe(6);
    expect(intent.activity).toMatchObject({
      name: "run",
      durationHours: 2,
    });
    expect(intent.relativeDayOffsets).toEqual([0]);
  });

  it("does not turn a standalone activity duration into forecast coverage", () => {
    const intent = parseWeatherRequestIntent(
      "When should I take a 2-hour run in Raleigh today?",
    );

    expect(intent.forecastHours).toBeUndefined();
    expect(intent.relativeDayOffsets).toEqual([0]);
    expect(intent.activity).toMatchObject({
      name: "run",
      durationHours: 2,
    });
  });
});

describe("weekdayDayOffset", () => {
  // Tuesday, November 17, 2026 at 3 PM in New York.
  const tuesday = new Date("2026-11-17T20:00:00Z");

  it("counts forward to the next named weekday", () => {
    expect(weekdayDayOffset("saturday", "America/New_York", tuesday)).toBe(4);
    expect(weekdayDayOffset("monday", "America/New_York", tuesday)).toBe(6);
  });

  it("returns zero for today and respects the time zone's date", () => {
    expect(weekdayDayOffset("tuesday", "America/New_York", tuesday)).toBe(0);
    expect(weekdayDayOffset("wednesday", "Asia/Tokyo", tuesday)).toBe(0);
  });

  it("returns undefined for an invalid time zone", () => {
    expect(weekdayDayOffset("saturday", "Not/AZone", tuesday)).toBeUndefined();
  });

  it("recognizes a single weekday and an activity in a planning prompt", () => {
    const intent = parseWeatherRequestIntent(
      "Plan my Saturday in Raleigh: when is the best 3-hour window for a bike ride, and what should I bring?",
    );
    expect(intent.namedWeekdays).toEqual(["saturday"]);
    expect(intent.activity).toBeDefined();
  });
});
