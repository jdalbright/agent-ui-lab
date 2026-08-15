export const WEATHER_WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WeatherWeekday = (typeof WEATHER_WEEKDAYS)[number];
export type WeatherDailySignal = "wettest" | "driest" | "warmest" | "coolest";
export type WeatherComparisonMetric =
  | "temperature"
  | "feelsLike"
  | "humidity"
  | "precipitation"
  | "wind"
  | "uv"
  | "visibility"
  | "high"
  | "low";

export interface WeatherActivityIntent {
  readonly name: string;
  readonly durationHours?: number;
}

export interface WeatherRequestIntent {
  readonly forecastHours?: number;
  readonly forecastDays?: number;
  readonly relativeDayOffsets: readonly number[];
  readonly namedWeekdays: readonly WeatherWeekday[];
  readonly weekdaySpan?: Readonly<{ start: WeatherWeekday; end: WeatherWeekday }>;
  readonly throughWeekday?: WeatherWeekday;
  readonly nextWeekday?: WeatherWeekday;
  readonly weekend: boolean;
  readonly weekRange?: "this" | "next";
  readonly localTime?: string;
  readonly activity?: WeatherActivityIntent;
  readonly requestedUnits?: "imperial" | "metric";
  readonly requestedSignals: readonly WeatherDailySignal[];
  readonly comparisonMetrics: readonly WeatherComparisonMetric[];
}

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const NUMBER_PATTERN = String.raw`(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)`;
const WEEKDAY_PATTERN = WEATHER_WEEKDAYS.join("|");
const ACTIVITY_PATTERN =
  String.raw`(?:run(?:ning)?|jog(?:ging)?|walk(?:ing)?|hik(?:e|ing)|bik(?:e|ing)|cycl(?:e|ing)|ride|picnic|brunch|dinner|golf)`;

function parsedNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return WORD_NUMBERS[value.toLocaleLowerCase("en-US")] ?? Number(value);
}

function firstCount(prompt: string, patterns: readonly RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(prompt);
    const value = parsedNumber(match?.[1]);
    if (value !== undefined && Number.isFinite(value)) return value;
  }
  return undefined;
}

function requestedActivity(prompt: string): string | undefined {
  const normalized = prompt.toLocaleLowerCase("en-US");
  const activities: readonly [RegExp, string][] = [
    [/\b(?:run|running|jog|jogging)\b/, "run"],
    [/\b(?:walk|walking)\b/, "walk"],
    [/\b(?:hike|hiking)\b/, "hike"],
    [/\b(?:bike|biking|cycle|cycling|ride)\b/, "bike"],
    [/\bpicnic\b/, "picnic"],
    [/\bbrunch\b/, "brunch"],
    [/\bdinner\b/, "dinner"],
    [/\bgolf\b/, "golf"],
  ];
  return activities.find(([pattern]) => pattern.test(normalized))?.[1];
}

function activityDurationMatch(prompt: string): RegExpExecArray | null {
  const beforeActivity = new RegExp(
    String.raw`\b(${NUMBER_PATTERN})\s*[- ]?hours?\s+${ACTIVITY_PATTERN}\b`,
    "i",
  ).exec(prompt);
  if (beforeActivity) return beforeActivity;
  return new RegExp(
    String.raw`\b${ACTIVITY_PATTERN}\b\s+(?:for\s+)?(?:the\s+)?(?:next\s+)?(${NUMBER_PATTERN})\s*[- ]?hours?\b`,
    "i",
  ).exec(prompt);
}

function withoutMatch(prompt: string, match: RegExpExecArray | null): string {
  if (!match || match.index === undefined) return prompt;
  return `${prompt.slice(0, match.index)} ${prompt.slice(match.index + match[0].length)}`;
}

function forecastHourCount(prompt: string): number | undefined {
  return firstCount(prompt, [
    new RegExp(String.raw`\bnext\s+(${NUMBER_PATTERN})\s*[- ]?hours?\b`, "i"),
    new RegExp(
      String.raw`\b(${NUMBER_PATTERN})\s*[- ]?hours?\s+(?:weather\s+)?(?:forecast|outlook|trend|range)\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:forecast|outlook|trend)\b[\s\S]{0,30}?\b(?:for\s+)?(?:the\s+)?(?:next\s+)?(${NUMBER_PATTERN})\s*[- ]?hours?\b`,
      "i",
    ),
  ]);
}

function forecastDayCount(prompt: string, weekRange: "this" | "next" | undefined): number | undefined {
  if (weekRange) return 7;
  return firstCount(prompt, [
    new RegExp(String.raw`\bnext\s+(${NUMBER_PATTERN})\s*[- ]?days?\b`, "i"),
    new RegExp(
      String.raw`\b(${NUMBER_PATTERN})\s*[- ]?days?\s+(?:weather\s+)?(?:forecast|outlook|trend|range)\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:forecast|outlook|trend)\b[\s\S]{0,30}?\b(?:for\s+)?(?:the\s+)?(?:next\s+)?(${NUMBER_PATTERN})\s*[- ]?days?\b`,
      "i",
    ),
  ]);
}

function relativeDayOffsets(prompt: string): number[] {
  if (
    /\btoday\s+(?:and|through|thru|to|until)\s+tomorrow\b/i.test(prompt) ||
    /\btomorrow\s+and\s+today\b/i.test(prompt)
  ) {
    return [0, 1];
  }
  const offsets: number[] = [];
  if (/\btoday\b/i.test(prompt)) offsets.push(0);
  if (/\btomorrow\b/i.test(prompt)) offsets.push(1);
  return offsets;
}

function localTime(prompt: string): string | undefined {
  const match = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(prompt);
  if (!match) return undefined;
  return `${Number(match[1])}:${match[2] ?? "00"} ${match[3].toLocaleUpperCase("en-US").replace(/\./g, "")}`;
}

function requestedUnits(prompt: string): "imperial" | "metric" | undefined {
  if (/\b(?:celsius|metric)\b|°\s*c\b|\bdegrees?\s+(?:c|celsius)\b/i.test(prompt)) {
    return "metric";
  }
  if (/\b(?:fahrenheit|imperial)\b|°\s*f\b|\bdegrees?\s+(?:f|fahrenheit)\b/i.test(prompt)) {
    return "imperial";
  }
  return undefined;
}

function requestedComparisonMetrics(prompt: string): WeatherComparisonMetric[] {
  const normalized = prompt.toLocaleLowerCase("en-US");
  const metrics: WeatherComparisonMetric[] = [];
  const add = (metric: WeatherComparisonMetric): void => {
    if (!metrics.includes(metric)) metrics.push(metric);
  };
  if (/\bhighs?\b/.test(normalized)) add("high");
  if (/\blows?\b/.test(normalized)) add("low");
  if (/\btemperatures?\b/.test(normalized) && !metrics.includes("high")) {
    add(
      /\b(?:day|week|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/.test(
          normalized,
        )
        ? "high"
        : "temperature",
    );
  }
  if (/\b(?:rain|precipitation|picnic|brunch|outdoor)\b/.test(normalized)) add("precipitation");
  if (/\bhumid(?:ity)?\b/.test(normalized)) add("humidity");
  if (/\bwind\b/.test(normalized)) add("wind");
  if (/\buv\b/.test(normalized)) add("uv");
  if (/\bvisibility\b/.test(normalized)) add("visibility");
  return metrics;
}

export function parseWeatherRequestIntent(prompt: string): WeatherRequestIntent {
  const normalized = prompt.trim();
  const activityName = requestedActivity(normalized);
  const durationMatch = activityName ? activityDurationMatch(normalized) : null;
  const durationHours = parsedNumber(durationMatch?.[1]);
  const forecastPrompt = withoutMatch(normalized, durationMatch);
  const weekMatch = /\b(this|next)\s+week\b/i.exec(normalized);
  const weekRange = weekMatch
    ? weekMatch[1].toLocaleLowerCase("en-US") as "this" | "next"
    : undefined;
  const weekdaySpanMatch = new RegExp(
    String.raw`\b(${WEEKDAY_PATTERN})\s*(?:through|thru|to|[-–—])\s*(${WEEKDAY_PATTERN})\b`,
    "i",
  ).exec(normalized);
  const weekdaySpan = weekdaySpanMatch
    ? {
        start: weekdaySpanMatch[1].toLocaleLowerCase("en-US") as WeatherWeekday,
        end: weekdaySpanMatch[2].toLocaleLowerCase("en-US") as WeatherWeekday,
      }
    : undefined;
  const throughMatch = weekdaySpan
    ? null
    : new RegExp(String.raw`\b(?:through|until)\s+(${WEEKDAY_PATTERN})\b`, "i").exec(normalized);
  const nextMatch = new RegExp(String.raw`\bnext\s+(${WEEKDAY_PATTERN})\b`, "i").exec(
    normalized,
  );
  const namedWeekdays = WEATHER_WEEKDAYS.filter((weekday) =>
    new RegExp(`\\b${weekday}\\b`, "i").test(normalized)
  );
  const signals = (["wettest", "driest", "warmest", "coolest"] as const).filter((signal) =>
    new RegExp(`\\b${signal}\\b`, "i").test(normalized)
  );
  const forecastHours = forecastHourCount(forecastPrompt);
  const forecastDays = forecastDayCount(normalized, weekRange);
  const requestedLocalTime = localTime(normalized);
  const units = requestedUnits(normalized);

  return {
    ...(forecastHours === undefined ? {} : { forecastHours }),
    ...(forecastDays === undefined ? {} : { forecastDays }),
    relativeDayOffsets: relativeDayOffsets(normalized),
    namedWeekdays,
    ...(weekdaySpan ? { weekdaySpan } : {}),
    ...(throughMatch
      ? { throughWeekday: throughMatch[1].toLocaleLowerCase("en-US") as WeatherWeekday }
      : {}),
    ...(nextMatch
      ? { nextWeekday: nextMatch[1].toLocaleLowerCase("en-US") as WeatherWeekday }
      : {}),
    weekend: /\b(?:this\s+)?weekend\b/i.test(normalized),
    ...(weekRange ? { weekRange } : {}),
    ...(requestedLocalTime ? { localTime: requestedLocalTime } : {}),
    ...(activityName
      ? {
          activity: {
            name: activityName,
            ...(durationHours === undefined ? {} : { durationHours }),
          },
        }
      : {}),
    ...(units ? { requestedUnits: units } : {}),
    requestedSignals: signals,
    comparisonMetrics: requestedComparisonMetrics(normalized),
  };
}
