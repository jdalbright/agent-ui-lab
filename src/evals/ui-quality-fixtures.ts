import {
  SurfacePlanSchema,
  compileSurfacePlan,
  type SurfacePlan,
} from "../../api/_lib/surface-plan.js";
import type { GeminiRetrievalResult } from "../../api/_lib/gemini.js";
import type {
  ClientContext,
  SourceRecord,
  SurfaceSpec,
} from "@shared/schemas.js";
import type { UiQualityCase } from "./ui-quality-cases.js";

const ACCESSED_AT = "2026-08-02T12:00:00.000Z";

const DEFAULT_CONTEXT: ClientContext = {
  sizeClass: "expanded",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

interface RecordedUiQualityFixture {
  readonly plan: unknown;
  readonly retrieval: GeminiRetrievalResult;
  readonly clientContext?: ClientContext;
}

export interface RecordedUiQualityCompilationInput {
  readonly plan: SurfacePlan;
  readonly retrieval: GeminiRetrievalResult;
  readonly clientContext: ClientContext;
}

export interface RecordedUiQualityCandidate {
  readonly benchmark: UiQualityCase;
  readonly plan: SurfacePlan;
  readonly spec: SurfaceSpec;
  readonly sources: readonly SourceRecord[];
}

interface RecordedLocationInput {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timeZone: string;
  readonly unit: "F" | "C";
  readonly temperature: number;
  readonly feelsLike?: number;
  readonly conditionText?: string;
  readonly conditionKey?:
    | "clear"
    | "partly-cloudy"
    | "cloudy"
    | "rain"
    | "storms"
    | "snow"
    | "fog"
    | "wind"
    | "unknown";
  readonly hourly?: readonly RecordedHour[];
  readonly daily?: readonly RecordedDay[];
  readonly alerts?: readonly RecordedAlert[];
}

interface RecordedHour {
  readonly startTime: string;
  readonly temperature: number;
  readonly precipitationProbability: number;
  readonly conditionKey?: RecordedLocationInput["conditionKey"];
}

interface RecordedDay {
  readonly date: string;
  readonly high: number;
  readonly low: number;
  readonly precipitationProbability: number;
  readonly conditionKey?: RecordedLocationInput["conditionKey"];
}

interface RecordedAlert {
  readonly title: string;
  readonly description: string;
  readonly severity: "minor" | "moderate" | "severe" | "extreme";
}

interface RecordedActivityWindow {
  readonly location: RecordedLocationInput;
  readonly startTime: string;
  readonly endTime: string;
  readonly label: string;
  readonly detail: string;
  readonly confidence: "high" | "medium" | "low";
}

function sourceRecord(
  id: string,
  fixture: string,
  provider: SourceRecord["provider"],
  title: string,
  snippet: string,
): SourceRecord {
  return {
    id,
    title,
    url: `https://evidence.example.test/${fixture}/${id}`,
    provider,
    accessedAt: ACCESSED_AT,
    snippet,
  };
}

function searchRetrieval(
  fixture: string,
  records: readonly {
    readonly id: string;
    readonly title: string;
    readonly snippet: string;
  }[],
): GeminiRetrievalResult {
  return {
    outputText: records.map((record) => record.snippet).join(" "),
    steps: [],
    sources: records.map((record) =>
      sourceRecord(record.id, fixture, "google-search", record.title, record.snippet),
    ),
    evidence: [],
    toolRounds: 1,
  };
}

function recordedLocation(input: RecordedLocationInput): Record<string, unknown> {
  return {
    location: {
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      placeId: `recorded-${input.name.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-")}`,
    },
    current: {
      observedAt: ACCESSED_AT,
      timeZone: input.timeZone,
      temperature: input.temperature,
      feelsLike: input.feelsLike ?? input.temperature,
      temperatureUnit: input.unit,
      conditionKey: input.conditionKey ?? "partly-cloudy",
      conditionText: input.conditionText ?? "Partly cloudy",
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
      startTime: hour.startTime,
      temperature: hour.temperature,
      temperatureUnit: input.unit,
      precipitationProbability: hour.precipitationProbability,
      conditionKey: hour.conditionKey ?? "partly-cloudy",
    })),
    daily: (input.daily ?? []).map((day) => ({
      date: day.date,
      high: day.high,
      low: day.low,
      temperatureUnit: input.unit,
      precipitationProbability: day.precipitationProbability,
      conditionKey: day.conditionKey ?? "partly-cloudy",
    })),
    alerts: (input.alerts ?? []).map((alert) => ({ ...alert })),
  };
}

function weatherRetrieval(
  fixture: string,
  locations: readonly RecordedLocationInput[],
  snippet: string,
  activityWindows: readonly RecordedActivityWindow[] = [],
): GeminiRetrievalResult {
  const unitSystem = locations[0]?.unit === "C" ? "metric" : "imperial";
  return {
    outputText: snippet,
    steps: [],
    sources: [
      sourceRecord(
        "src_weather01",
        fixture,
        "google-weather",
        "Recorded Google Weather evidence",
        snippet,
      ),
    ],
    evidence: [
      {
        tool: "get_weather_bundle",
        arguments: {
          location: locations.map((location) => location.name).join(", "),
          units: unitSystem,
        },
        result: {
          locations: locations.map(recordedLocation),
          activityWindows: activityWindows.map((window) => ({
            location: (recordedLocation(window.location).location as Record<string, unknown>),
            startTime: window.startTime,
            endTime: window.endTime,
            label: window.label,
            detail: window.detail,
            confidence: window.confidence,
          })),
        },
      },
    ],
    toolRounds: 1,
  };
}

function days(
  dates: readonly string[],
  highs: readonly number[],
  lows: readonly number[],
  precipitation: readonly number[],
): RecordedDay[] {
  return dates.map((date, index) => ({
    date,
    high: highs[index] ?? highs.at(-1) ?? 0,
    low: lows[index] ?? lows.at(-1) ?? 0,
    precipitationProbability: precipitation[index] ?? precipitation.at(-1) ?? 0,
    conditionKey: (precipitation[index] ?? 0) >= 60 ? "rain" : "partly-cloudy",
  }));
}

function hours(
  startTimes: readonly string[],
  temperatures: readonly number[],
  precipitation: readonly number[],
): RecordedHour[] {
  return startTimes.map((startTime, index) => ({
    startTime,
    temperature: temperatures[index] ?? temperatures.at(-1) ?? 0,
    precipitationProbability: precipitation[index] ?? precipitation.at(-1) ?? 0,
    conditionKey: (precipitation[index] ?? 0) >= 60 ? "rain" : "partly-cloudy",
  }));
}

const raleighCurrent: RecordedLocationInput = {
  name: "Raleigh, North Carolina",
  latitude: 35.7796,
  longitude: -78.6382,
  timeZone: "America/New_York",
  unit: "F",
  temperature: 81,
  feelsLike: 83,
  conditionText: "Partly sunny",
  conditionKey: "partly-cloudy",
};

const newOrleansCurrent: RecordedLocationInput = {
  name: "New Orleans, Louisiana",
  latitude: 29.9511,
  longitude: -90.0715,
  timeZone: "America/Chicago",
  unit: "F",
  temperature: 88,
  feelsLike: 96,
  conditionText: "Thunderstorms",
  conditionKey: "storms",
  alerts: [
    {
      title: "Severe Thunderstorm Warning",
      description: "Severe storms are moving through New Orleans. The warning expires at 6:00 PM local time.",
      severity: "severe",
    },
  ],
};

const raleighWalk: RecordedLocationInput = {
  ...raleighCurrent,
  hourly: hours(
    [
      "2026-08-02T22:00:00.000Z",
      "2026-08-02T23:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ],
    [82, 79, 77],
    [20, 10, 8],
  ),
};

const denverRun: RecordedLocationInput = {
  name: "Denver, Colorado",
  latitude: 39.7392,
  longitude: -104.9903,
  timeZone: "America/Denver",
  unit: "F",
  temperature: 62,
  feelsLike: 61,
  conditionText: "Clear",
  conditionKey: "clear",
  hourly: hours(
    [
      "2026-08-03T12:00:00.000Z",
      "2026-08-03T13:00:00.000Z",
      "2026-08-03T14:00:00.000Z",
    ],
    [59, 61, 64],
    [5, 4, 4],
  ),
};

const seattleSevenDay: RecordedLocationInput = {
  name: "Seattle, Washington",
  latitude: 47.6062,
  longitude: -122.3321,
  timeZone: "America/Los_Angeles",
  unit: "C",
  temperature: 21,
  conditionText: "Partly cloudy",
  daily: days(
    [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ],
    [24, 23, 22, 25, 26, 24, 23],
    [16, 15, 15, 16, 17, 16, 15],
    [20, 35, 55, 25, 15, 30, 40],
  ),
};

const tokyoFiveDay: RecordedLocationInput = {
  name: "Tokyo, Japan",
  latitude: 35.6762,
  longitude: 139.6503,
  timeZone: "Asia/Tokyo",
  unit: "C",
  temperature: 30,
  feelsLike: 34,
  conditionText: "Humid and cloudy",
  conditionKey: "cloudy",
  daily: days(
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
    [32, 29, 31, 33, 32],
    [25, 24, 25, 26, 25],
    [35, 85, 45, 25, 30],
  ),
};

const raleighSaturday: RecordedLocationInput = {
  ...raleighCurrent,
  daily: days(["2026-08-08"], [84], [67], [20]),
};

const ashevilleSaturday: RecordedLocationInput = {
  name: "Asheville, North Carolina",
  latitude: 35.5951,
  longitude: -82.5515,
  timeZone: "America/New_York",
  unit: "F",
  temperature: 76,
  conditionText: "Cloudy",
  conditionKey: "cloudy",
  daily: days(["2026-08-08"], [77], [61], [55]),
};

const durhamSunday: RecordedLocationInput = {
  name: "Durham, North Carolina",
  latitude: 35.994,
  longitude: -78.8986,
  timeZone: "America/New_York",
  unit: "F",
  temperature: 80,
  daily: days(["2026-08-09"], [83], [66], [25]),
};

const charlotteSunday: RecordedLocationInput = {
  name: "Charlotte, North Carolina",
  latitude: 35.2271,
  longitude: -80.8431,
  timeZone: "America/New_York",
  unit: "F",
  temperature: 84,
  daily: days(["2026-08-09"], [86], [69], [35]),
};

const raleighSunday: RecordedLocationInput = {
  ...raleighCurrent,
  daily: days(["2026-08-09"], [84], [67], [20]),
};

const ashevilleSunday: RecordedLocationInput = {
  ...ashevilleSaturday,
  daily: days(["2026-08-09"], [78], [61], [45]),
};

const raleighWeekend: RecordedLocationInput = {
  ...raleighCurrent,
  daily: days(["2026-08-08", "2026-08-09"], [84, 83], [67, 66], [20, 30]),
};

const charlotteWeekend: RecordedLocationInput = {
  ...charlotteSunday,
  daily: days(["2026-08-08", "2026-08-09"], [87, 86], [70, 69], [25, 35]),
};

const miamiFiveDay: RecordedLocationInput = {
  name: "Miami, Florida",
  latitude: 25.7617,
  longitude: -80.1918,
  timeZone: "America/New_York",
  unit: "F",
  temperature: 89,
  daily: days(
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
    [91, 90, 91, 92, 90],
    [80, 79, 80, 81, 80],
    [45, 55, 50, 40, 60],
  ),
};

const denverFiveDay: RecordedLocationInput = {
  ...denverRun,
  daily: days(
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
    [86, 88, 84, 82, 85],
    [60, 62, 58, 57, 59],
    [10, 15, 35, 20, 10],
  ),
};

const seattleFiveDay: RecordedLocationInput = {
  ...seattleSevenDay,
  unit: "F",
  temperature: 70,
  daily: days(
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
    [75, 73, 72, 77, 79],
    [60, 59, 58, 61, 62],
    [20, 35, 50, 25, 15],
  ),
};

const RECORDED_UI_QUALITY_FIXTURES: Readonly<Record<string, RecordedUiQualityFixture>> = {
  "quality-wx-raleigh-current": {
    retrieval: weatherRetrieval(
      "quality-wx-raleigh-current",
      [raleighCurrent],
      "Raleigh is 81°F and partly sunny at the recorded observation time.",
    ),
    plan: {
      kind: "weather",
      recipeId: "weather.snapshot",
      density: "brief",
      emphasis: "answer",
      modules: [
        {
          type: "hero",
          variant: "snapshot",
          locationIndex: 0,
          recommendationLabel: "Right now",
          recommendationValue: "81°F",
          recommendationDetail: "Partly sunny in Raleigh, North Carolina.",
        },
        { type: "sources", label: "Source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-wx-new-orleans-alert": {
    retrieval: weatherRetrieval(
      "quality-wx-new-orleans-alert",
      [newOrleansCurrent],
      "New Orleans has a Severe Thunderstorm Warning that expires at 6:00 PM local time.",
    ),
    clientContext: { ...DEFAULT_CONTEXT, timeZone: "America/Chicago" },
    plan: {
      kind: "weather",
      recipeId: "weather.snapshot",
      density: "brief",
      emphasis: "risk",
      modules: [
        {
          type: "hero",
          variant: "snapshot",
          locationIndex: 0,
          recommendationLabel: "Alert status",
          recommendationValue: "Severe warning active",
          recommendationDetail: "New Orleans should monitor the warning through 6:00 PM.",
        },
        { type: "alerts", locationIndex: 0, alertIndexes: [0] },
        { type: "sources", label: "Source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-wx-raleigh-walk-window": {
    retrieval: weatherRetrieval(
      "quality-wx-raleigh-walk-window",
      [raleighWalk],
      "Raleigh's best recorded walk window is 7:00 PM to 8:30 PM.",
      [
        {
          location: raleighWalk,
          startTime: "2026-08-02T23:00:00.000Z",
          endTime: "2026-08-03T00:30:00.000Z",
          label: "Best walk window",
          detail: "Low rain risk and easing heat make this Raleigh's best walk window.",
          confidence: "high",
        },
      ],
    ),
    plan: {
      kind: "weather",
      recipeId: "weather.decision",
      density: "balanced",
      emphasis: "decision",
      modules: [
        {
          type: "hero",
          variant: "decision",
          locationIndex: 0,
          recommendationLabel: "Walk today",
          recommendationValue: "Aim for 7:00 PM",
          recommendationDetail: "Raleigh cools down during the recommended evening window.",
        },
        { type: "recommendation", locationIndex: 0, activityWindowIndex: 0 },
        {
          type: "hourly",
          variant: "strip",
          label: "Raleigh from 6:00 PM to 8:00 PM",
          locationIndex: 0,
          hourIndexes: [0, 1, 2],
        },
        { type: "sources", label: "Source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-wx-denver-run-window": {
    retrieval: weatherRetrieval(
      "quality-wx-denver-run-window",
      [denverRun],
      "Denver's 7:00 AM run starts near 61°F with a low rain chance.",
      [
        {
          location: denverRun,
          startTime: "2026-08-03T13:00:00.000Z",
          endTime: "2026-08-03T14:00:00.000Z",
          label: "7:00 AM run",
          detail: "Wear a light layer for the cool start, then shed it as the run warms up.",
          confidence: "high",
        },
      ],
    ),
    clientContext: { ...DEFAULT_CONTEXT, timeZone: "America/Denver" },
    plan: {
      kind: "weather",
      recipeId: "weather.decision",
      density: "balanced",
      emphasis: "decision",
      modules: [
        {
          type: "hero",
          variant: "decision",
          locationIndex: 0,
          recommendationLabel: "Tomorrow's run",
          recommendationValue: "Light layer at 7:00 AM",
          recommendationDetail: "Denver will be cool and dry for running, with temperatures shown in °F.",
        },
        { type: "recommendation", locationIndex: 0, activityWindowIndex: 0 },
        {
          type: "hourly",
          variant: "chart",
          label: "Denver around the 7:00 AM run",
          locationIndex: 0,
          hourIndexes: [0, 1, 2],
        },
        { type: "sources", label: "Source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-wx-seattle-seven-day": {
    retrieval: weatherRetrieval(
      "quality-wx-seattle-seven-day",
      [seattleSevenDay],
      "Seattle's recorded seven-day forecast is expressed in Celsius.",
    ),
    clientContext: {
      ...DEFAULT_CONTEXT,
      timeZone: "America/Los_Angeles",
      units: "metric",
    },
    plan: {
      kind: "weather",
      recipeId: "weather.outlook",
      density: "balanced",
      emphasis: "trend",
      modules: [
        {
          type: "hero",
          variant: "snapshot",
          locationIndex: 0,
          recommendationLabel: "Seven-day outlook",
          recommendationValue: "Mild with periodic showers",
          recommendationDetail: "Seattle's 7-day trend is shown in Celsius (°C).",
        },
        {
          type: "daily",
          variant: "cards",
          label: "Seattle seven-day forecast in Celsius",
          locationIndex: 0,
          dayIndexes: [0, 1, 2, 3, 4, 5, 6],
        },
        { type: "sources", label: "Source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-wx-tokyo-five-day": {
    retrieval: weatherRetrieval(
      "quality-wx-tokyo-five-day",
      [tokyoFiveDay],
      "Tokyo's recorded five-day Celsius outlook shows Tuesday as the wettest day.",
    ),
    clientContext: { ...DEFAULT_CONTEXT, timeZone: "Asia/Tokyo", units: "metric" },
    plan: {
      kind: "weather",
      recipeId: "weather.outlook",
      density: "detailed",
      emphasis: "trend",
      modules: [
        {
          type: "hero",
          variant: "snapshot",
          locationIndex: 0,
          recommendationLabel: "Five-day outlook",
          recommendationValue: "Tuesday is wettest",
          recommendationDetail: "Tokyo's 5-day outlook is in Celsius (°C), with rain peaking Tuesday.",
        },
        {
          type: "daily",
          variant: "table",
          label: "Tokyo five-day forecast in Celsius",
          locationIndex: 0,
          dayIndexes: [0, 1, 2, 3, 4],
        },
        {
          type: "recommendation",
          locationIndex: 0,
          dayIndex: 1,
          signal: "wettest",
        },
        { type: "sources", label: "Source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-compare-raleigh-asheville-verdict": {
    retrieval: weatherRetrieval(
      "quality-compare-raleigh-asheville-verdict",
      [raleighSaturday, ashevilleSaturday],
      "Raleigh is drier than Asheville for a Saturday outdoor picnic.",
    ),
    plan: {
      kind: "comparison",
      recipeId: "comparison.verdict",
      density: "brief",
      emphasis: "decision",
      modules: [
        {
          type: "summary",
          variant: "verdict",
          title: "Raleigh or Asheville for a Saturday picnic",
          recommendation: "Raleigh is the stronger outdoor picnic choice for Saturday because its recorded rain risk is lower.",
          locationIndexes: [0, 1],
          recommendedLocationIndex: 0,
          sourceIds: ["src_weather01"],
        },
        {
          type: "table",
          caption: "Saturday picnic weather",
          locationIndexes: [0, 1],
          forecastKind: "daily",
          forecastIndexes: [0],
          metric: "precipitation",
          sourceIds: ["src_weather01"],
        },
        { type: "sources", label: "Weather source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-compare-airline-carry-on-verdict": {
    retrieval: searchRetrieval("quality-compare-airline-carry-on-verdict", [
      {
        id: "src_search01",
        title: "Southwest carry-on baggage policy",
        snippet: "Southwest permits one carry-on bag and one personal item.",
      },
      {
        id: "src_search02",
        title: "Delta carry-on baggage policy",
        snippet: "Delta permits one carry-on bag and one personal item with published size limits.",
      },
    ]),
    plan: {
      kind: "comparison",
      recipeId: "comparison.verdict",
      density: "balanced",
      emphasis: "decision",
      modules: [
        {
          type: "summary",
          variant: "verdict",
          title: "Southwest vs. Delta carry-on verdict",
          recommendation: "Southwest is the more generous carry-on choice for this comparison.",
          items: [
            { label: "Southwest", value: "More generous", detail: "One carry-on plus one personal item", recommended: true },
            { label: "Delta", value: "Standard allowance", detail: "One carry-on plus one personal item", recommended: false },
          ],
          sourceIds: ["src_search01", "src_search02"],
        },
        {
          type: "table",
          caption: "Published carry-on allowances",
          columns: ["Airline", "Carry-on", "Personal item"],
          rows: [
            ["Southwest", "1 bag", "1 item"],
            ["Delta", "1 bag", "1 item"],
          ],
          sourceIds: ["src_search01", "src_search02"],
        },
        { type: "sources", label: "Official airline sources", sourceIds: ["src_search01", "src_search02"] },
      ],
    },
  },
  "quality-compare-four-city-scorecard": {
    retrieval: weatherRetrieval(
      "quality-compare-four-city-scorecard",
      [raleighSunday, durhamSunday, charlotteSunday, ashevilleSunday],
      "Raleigh, Durham, Charlotte, and Asheville have recorded Sunday outdoor-brunch forecasts.",
    ),
    plan: {
      kind: "comparison",
      recipeId: "comparison.scorecard",
      density: "balanced",
      emphasis: "answer",
      modules: [
        {
          type: "summary",
          variant: "balanced",
          title: "Four-city Sunday outdoor brunch scorecard",
          recommendation: "Raleigh leads Durham, Charlotte, and Asheville for an outdoor brunch on Sunday based on recorded rain risk.",
          locationIndexes: [0, 1, 2, 3],
          recommendedLocationIndex: 0,
          sourceIds: ["src_weather01"],
        },
        {
          type: "table",
          caption: "Sunday outdoor brunch weather scorecard",
          locationIndexes: [0, 1, 2, 3],
          forecastKind: "daily",
          forecastIndexes: [0],
          metric: "precipitation",
          sourceIds: ["src_weather01"],
        },
        { type: "sources", label: "Weather source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-compare-a2ui-renderer-scorecard": {
    retrieval: searchRetrieval("quality-compare-a2ui-renderer-scorecard", [
      {
        id: "src_search01",
        title: "A2UI React renderer documentation",
        snippet: "A2UI v0.9.1 documents a React renderer and client setup.",
      },
      {
        id: "src_search02",
        title: "A2UI Angular renderer documentation",
        snippet: "A2UI v0.9.1 documents Angular renderer support.",
      },
    ]),
    plan: {
      kind: "comparison",
      recipeId: "comparison.scorecard",
      density: "detailed",
      emphasis: "evidence",
      modules: [
        {
          type: "summary",
          variant: "balanced",
          title: "React and Angular support in A2UI v0.9.1",
          recommendation: "Both renderers are documented; choose based on the host application's framework.",
          items: [
            { label: "React", value: "Supported renderer", detail: "Official client setup is available", recommended: true },
            { label: "Angular", value: "Supported renderer", detail: "Official renderer documentation is available", recommended: false },
          ],
          sourceIds: ["src_search01", "src_search02"],
        },
        {
          type: "table",
          caption: "A2UI 0.9.1 renderer support scorecard",
          columns: ["Framework", "Renderer", "Official support"],
          rows: [
            ["React", "@a2ui/react", "Documented"],
            ["Angular", "Angular renderer", "Documented"],
          ],
          sourceIds: ["src_search01", "src_search02"],
        },
        { type: "sources", label: "Official A2UI sources", sourceIds: ["src_search01", "src_search02"] },
      ],
    },
  },
  "quality-compare-raleigh-charlotte-trend": {
    retrieval: weatherRetrieval(
      "quality-compare-raleigh-charlotte-trend",
      [raleighWeekend, charlotteWeekend],
      "Raleigh and Charlotte high temperatures are recorded for Saturday and Sunday in Fahrenheit.",
    ),
    plan: {
      kind: "comparison",
      recipeId: "comparison.trend",
      density: "detailed",
      emphasis: "trend",
      modules: [
        {
          type: "summary",
          variant: "balanced",
          title: "Raleigh and Charlotte weekend temperature trend",
          recommendation: "Charlotte records the higher high temperature on both Saturday and Sunday; values are shown in Fahrenheit (°F).",
          locationIndexes: [0, 1],
          sourceIds: ["src_weather01"],
        },
        {
          type: "chart",
          variant: "line",
          title: "Saturday and Sunday high temperature",
          locationIndexes: [0, 1],
          forecastKind: "daily",
          forecastIndexes: [0, 1],
          metric: "high",
          sourceIds: ["src_weather01"],
        },
        {
          type: "table",
          caption: "Weekend high temperature table",
          locationIndexes: [0, 1],
          forecastKind: "daily",
          forecastIndexes: [0, 1],
          metric: "high",
          sourceIds: ["src_weather01"],
        },
        { type: "sources", label: "Weather source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-compare-three-city-five-day-trend": {
    retrieval: weatherRetrieval(
      "quality-compare-three-city-five-day-trend",
      [miamiFiveDay, denverFiveDay, seattleFiveDay],
      "Miami, Denver, and Seattle have five recorded days of high temperatures.",
    ),
    plan: {
      kind: "comparison",
      recipeId: "comparison.trend",
      density: "detailed",
      emphasis: "trend",
      modules: [
        {
          type: "summary",
          variant: "balanced",
          title: "Miami, Denver, and Seattle five-day highs",
          recommendation: "The 5-day high-temperature trend keeps Miami warmest, with Denver and Seattle cooler.",
          locationIndexes: [0, 1, 2],
          sourceIds: ["src_weather01"],
        },
        {
          type: "chart",
          variant: "line",
          title: "Five-day high temperature trend",
          locationIndexes: [0, 1, 2],
          forecastKind: "daily",
          forecastIndexes: [0, 1, 2, 3, 4],
          metric: "high",
          sourceIds: ["src_weather01"],
        },
        {
          type: "table",
          caption: "Five-day high temperature table",
          locationIndexes: [0, 1, 2],
          forecastKind: "daily",
          forecastIndexes: [0, 1, 2, 3, 4],
          metric: "high",
          sourceIds: ["src_weather01"],
        },
        { type: "sources", label: "Weather source", sourceIds: ["src_weather01"] },
      ],
    },
  },
  "quality-research-gemini-36-brief": {
    retrieval: searchRetrieval("quality-research-gemini-36-brief", [
      {
        id: "src_search01",
        title: "Gemini 3.6 Flash model documentation",
        snippet: "Gemini 3.6 Flash adds updated capabilities and model behavior.",
      },
      {
        id: "src_search02",
        title: "Gemini API release notes",
        snippet: "The release notes describe what is new and what changed.",
      },
    ]),
    plan: {
      kind: "research",
      recipeId: "research.brief",
      density: "brief",
      emphasis: "answer",
      modules: [
        {
          type: "lead",
          variant: "brief",
          title: "What changed in Gemini 3.6 Flash",
          summary: "Gemini 3.6 Flash brings updated model capabilities; this concise brief separates the documented changes from interpretation.",
          sourceIds: ["src_search01", "src_search02"],
        },
        {
          type: "evidence",
          variant: "stack",
          label: "Documented changes",
          items: [
            { title: "Model documentation", finding: "The official model page describes the new Gemini 3.6 Flash capabilities.", sourceId: "src_search01", stance: "support" },
            { title: "Release record", finding: "The release notes identify what changed in the current model release.", sourceId: "src_search02", stance: "support" },
          ],
        },
        { type: "sources", label: "Sources", sourceIds: ["src_search01", "src_search02"] },
      ],
    },
  },
  "quality-research-fcc-label-brief": {
    retrieval: searchRetrieval("quality-research-fcc-label-brief", [
      {
        id: "src_search01",
        title: "FCC Broadband Consumer Labels",
        snippet: "The FCC requires Broadband Facts labels to disclose price, fees, and performance information.",
      },
      {
        id: "src_search02",
        title: "FCC broadband-label compliance guide",
        snippet: "The Federal Communications Commission explains label display and record requirements.",
      },
    ]),
    plan: {
      kind: "research",
      recipeId: "research.brief",
      density: "balanced",
      emphasis: "evidence",
      modules: [
        {
          type: "lead",
          variant: "feature",
          title: "FCC broadband-label requirements",
          summary: "The Federal Communications Commission requires a Broadband Facts label covering price, fees, and performance information.",
          sourceIds: ["src_search01", "src_search02"],
        },
        {
          type: "evidence",
          variant: "grid",
          label: "Requirements",
          items: [
            { title: "Required disclosures", finding: "FCC labels disclose price, fees, and performance in a standard format.", sourceId: "src_search01", stance: "support" },
            { title: "Compliance", finding: "FCC guidance explains where providers display the broadband label.", sourceId: "src_search02", stance: "support" },
          ],
        },
        { type: "sources", label: "FCC sources", sourceIds: ["src_search01", "src_search02"] },
      ],
    },
  },
  "quality-research-artemis-timeline": {
    retrieval: searchRetrieval("quality-research-artemis-timeline", [
      { id: "src_search01", title: "NASA Artemis II 2024 update", snippet: "NASA announced an Artemis II schedule update in 2024." },
      { id: "src_search02", title: "NASA Artemis II 2025 update", snippet: "NASA published a later Artemis II schedule announcement." },
      { id: "src_search03", title: "NASA Artemis II current status", snippet: "NASA's current status page records the latest schedule milestone." },
    ]),
    plan: {
      kind: "research",
      recipeId: "research.timeline",
      density: "detailed",
      emphasis: "trend",
      modules: [
        {
          type: "lead",
          variant: "feature",
          title: "Artemis II schedule announcements since 2024",
          summary: "NASA's announcement chronology shows how the Artemis II schedule changed from 2024 onward.",
          sourceIds: ["src_search01", "src_search02", "src_search03"],
        },
        {
          type: "timeline",
          label: "NASA announcement timeline",
          items: [
            { date: "2024", title: "Schedule update", detail: "NASA announced a revised Artemis II schedule.", sourceId: "src_search01" },
            { date: "2025", title: "Readiness update", detail: "NASA issued a further schedule announcement.", sourceId: "src_search02" },
            { date: "2026", title: "Current milestone", detail: "NASA published the current Artemis II schedule status.", sourceId: "src_search03" },
          ],
        },
        { type: "sources", label: "NASA sources", sourceIds: ["src_search01", "src_search02", "src_search03"] },
      ],
    },
  },
  "quality-research-a2ui-release-timeline": {
    retrieval: searchRetrieval("quality-research-a2ui-release-timeline", [
      { id: "src_search01", title: "A2UI v0.9.1 release", snippet: "A2UI 0.9.1 is the earlier supported protocol release." },
      { id: "src_search02", title: "A2UI v1.0 status", snippet: "A2UI 1.0 has a separately documented release status." },
    ]),
    plan: {
      kind: "research",
      recipeId: "research.timeline",
      density: "balanced",
      emphasis: "trend",
      modules: [
        {
          type: "lead",
          variant: "brief",
          title: "A2UI 0.9.1 and 1.0 release timeline",
          summary: "The release and support timeline distinguishes A2UI v0.9.1 from the later v1.0 status.",
          sourceIds: ["src_search01", "src_search02"],
        },
        {
          type: "timeline",
          label: "Release and support status",
          items: [
            { date: "0.9.1", title: "Earlier supported release", detail: "A2UI v0.9.1 established the earlier protocol support point.", sourceId: "src_search01" },
            { date: "1.0", title: "Later release status", detail: "A2UI v1.0 has its own documented release and support status.", sourceId: "src_search02" },
          ],
        },
        { type: "sources", label: "Official A2UI sources", sourceIds: ["src_search01", "src_search02"] },
      ],
    },
  },
  "quality-research-pluto-claims": {
    retrieval: searchRetrieval("quality-research-pluto-claims", [
      { id: "src_search01", title: "IAU planet definition", snippet: "The IAU classifies Pluto as a dwarf planet under its formal definition." },
      { id: "src_search02", title: "Planet classification debate", snippet: "Some planetary scientists support a geophysical definition that would call Pluto a planet." },
    ]),
    plan: {
      kind: "research",
      recipeId: "research.claims",
      density: "detailed",
      emphasis: "evidence",
      modules: [
        {
          type: "lead",
          variant: "feature",
          title: "Does the IAU still classify Pluto as a planet?",
          summary: "The International Astronomical Union classifies Pluto as a dwarf planet, while a separate scientific argument supports calling it a planet.",
          sourceIds: ["src_search01", "src_search02"],
        },
        {
          type: "evidence",
          variant: "for-against",
          label: "Evidence for and against the claim",
          items: [
            { title: "Against the claim", finding: "The IAU definition challenges the claim by classifying Pluto as a dwarf planet.", sourceId: "src_search01", stance: "challenge" },
            { title: "For the broader claim", finding: "A geophysical definition offers support for treating Pluto as a planet outside the IAU classification.", sourceId: "src_search02", stance: "support" },
          ],
        },
        { type: "sources", label: "Sources", sourceIds: ["src_search01", "src_search02"] },
      ],
    },
  },
  "quality-research-a2ui-stability-claims": {
    retrieval: searchRetrieval("quality-research-a2ui-stability-claims", [
      { id: "src_search01", title: "A2UI 0.9.1 documentation", snippet: "A2UI 0.9.1 remains a documented protocol version." },
      { id: "src_search02", title: "A2UI 1.0 release status", snippet: "A2UI 1.0 documentation identifies whether it is stable, candidate, or preview." },
    ]),
    plan: {
      kind: "research",
      recipeId: "research.claims",
      density: "balanced",
      emphasis: "evidence",
      modules: [
        {
          type: "lead",
          variant: "brief",
          title: "Has A2UI 1.0 replaced 0.9.1 as stable?",
          summary: "The claim must distinguish A2UI v1.0's stable, candidate, or preview status from the earlier v0.9.1 release.",
          sourceIds: ["src_search01", "src_search02"],
        },
        {
          type: "evidence",
          variant: "for-against",
          label: "Claim assessment",
          items: [
            { title: "Earlier release", finding: "A2UI v0.9.1 remains documented as the earlier protocol release.", sourceId: "src_search01", stance: "neutral" },
            { title: "Newer status", finding: "The v1.0 source determines whether the newer version is stable, candidate, or preview.", sourceId: "src_search02", stance: "challenge" },
          ],
        },
        { type: "sources", label: "Official A2UI sources", sourceIds: ["src_search01", "src_search02"] },
      ],
    },
  },
};

function fixtureFor(testCase: UiQualityCase): RecordedUiQualityFixture {
  const fixture = RECORDED_UI_QUALITY_FIXTURES[testCase.fixture];
  if (!fixture) throw new TypeError(`No recorded UI quality fixture for ${testCase.fixture}.`);
  return fixture;
}

export function recordedUiQualityCompilationInput(
  testCase: UiQualityCase,
): RecordedUiQualityCompilationInput {
  const fixture = fixtureFor(testCase);
  return {
    plan: SurfacePlanSchema.parse(fixture.plan),
    retrieval: fixture.retrieval,
    clientContext: fixture.clientContext ?? DEFAULT_CONTEXT,
  };
}

export function buildRecordedUiQualityCandidate(
  testCase: UiQualityCase,
): RecordedUiQualityCandidate {
  const input = recordedUiQualityCompilationInput(testCase);
  return {
    benchmark: testCase,
    plan: input.plan,
    spec: compileSurfacePlan(input),
    sources: input.retrieval.sources,
  };
}

export function uiQualityStructuralFingerprint(
  candidate: RecordedUiQualityCandidate,
): string {
  return JSON.stringify({
    recipeId: candidate.plan.recipeId,
    density: candidate.plan.density,
    emphasis: candidate.plan.emphasis,
    components: candidate.spec.components.map((node) => node.component),
  });
}
