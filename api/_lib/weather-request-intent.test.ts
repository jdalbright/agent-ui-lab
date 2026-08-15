import { describe, expect, it } from "vitest";
import { parseWeatherRequestIntent } from "./weather-request-intent.js";

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
