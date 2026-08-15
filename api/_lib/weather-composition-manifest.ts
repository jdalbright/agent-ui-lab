import { z } from "zod";
import type { ClientContext, SourceRecord } from "../../shared/schemas.js";
import type { GeminiRetrievalResult } from "./gemini.js";
import { requestedLocalHourCoverage } from "./weather-local-hour.js";
import {
  parseWeatherRequestIntent,
  type WeatherComparisonMetric,
  type WeatherDailySignal,
  type WeatherRequestIntent,
  type WeatherWeekday,
} from "./weather-request-intent.js";

const conditionKeySchema = z.enum([
  "clear",
  "partly-cloudy",
  "cloudy",
  "rain",
  "storms",
  "snow",
  "fog",
  "wind",
  "unknown",
]);

const locationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    placeId: z.string().trim().max(240).optional(),
  })
  .passthrough();

const currentSchema = z
  .object({
    observedAt: z.string().min(1).max(80),
    timeZone: z.string().min(1).max(80),
    temperature: z.number().finite().min(-150).max(150),
    feelsLike: z.number().finite().min(-150).max(150),
    temperatureUnit: z.enum(["F", "C"]),
    conditionKey: conditionKeySchema,
    conditionText: z.string().trim().min(1).max(80),
    isDaytime: z.boolean().optional(),
    humidity: z.number().finite().min(0).max(100),
    precipitationProbability: z.number().finite().min(0).max(100),
    windDirection: z.string().trim().max(20),
    windSpeed: z.number().finite().min(0).max(500),
    windSpeedUnit: z.enum(["mph", "km/h"]),
    visibility: z.number().finite().min(0).max(1_000),
    visibilityUnit: z.enum(["mi", "km"]),
    uvIndex: z.number().finite().min(0).max(100),
  })
  .passthrough();

const hourlySchema = z
  .object({
    startTime: z.string().min(1).max(80),
    temperature: z.number().finite().min(-150).max(150),
    temperatureUnit: z.enum(["F", "C"]),
    precipitationProbability: z.number().finite().min(0).max(100).nullable(),
    conditionKey: conditionKeySchema,
  })
  .passthrough();

const dailySchema = z
  .object({
    date: z.string().trim().min(1).max(60),
    high: z.number().finite().min(-150).max(150),
    low: z.number().finite().min(-150).max(150),
    temperatureUnit: z.enum(["F", "C"]),
    precipitationProbability: z.number().finite().min(0).max(100),
    conditionKey: conditionKeySchema,
  })
  .passthrough();

const alertSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(700),
    severity: z.enum(["minor", "moderate", "severe", "extreme", "unknown"]),
    urgency: z.string().trim().max(40).optional(),
    startsAt: z.string().min(1).max(80).optional(),
    expiresAt: z.string().min(1).max(80).optional(),
    sourceAuthorityUri: z.string().url().optional(),
  })
  .passthrough();

const weatherLocationSchema = z
  .object({
    location: locationSchema,
    current: currentSchema,
    hourly: z.array(hourlySchema).max(240),
    daily: z.array(dailySchema).max(10),
    alerts: z.array(alertSchema).max(32),
  })
  .passthrough();

const activityWindowSchema = z
  .object({
    location: locationSchema,
    activity: z.string().trim().max(80).optional(),
    durationHours: z.number().int().min(1).max(6).optional(),
    startTime: z.string().min(1).max(80),
    endTime: z.string().min(1).max(80),
    label: z.string().trim().min(1).max(80),
    detail: z.string().trim().min(1).max(320),
    confidence: z.enum(["high", "medium", "low"]),
    reasons: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  })
  .passthrough();

const weatherResultSchema = z
  .object({
    locations: z.array(weatherLocationSchema).min(1).max(4),
    activityWindows: z.array(activityWindowSchema).max(4).default([]),
  })
  .passthrough();

type ParsedLocation = z.infer<typeof weatherLocationSchema>;
type ParsedActivityWindow = z.infer<typeof activityWindowSchema>;
type ConditionKey = z.infer<typeof conditionKeySchema>;

export type TemperatureBand =
  | "very-cold"
  | "cold"
  | "cool"
  | "mild"
  | "warm"
  | "hot"
  | "extreme-heat";
export type PrecipitationBand = "none" | "low" | "possible" | "elevated" | "high";
export type WindBand = "calm" | "breezy" | "windy" | "strong";
export type HumidityBand = "dry" | "comfortable" | "humid" | "oppressive";
export type UvBand = "low" | "moderate" | "high" | "very-high" | "extreme";
export type VisibilityBand = "good" | "reduced" | "poor";
export type Trend = "rising" | "falling" | "steady";
export type DailySignal = WeatherDailySignal;
export type ComparisonMetric = WeatherComparisonMetric;
export type ActivityReasonCode =
  | "preferred-window"
  | "low-precipitation-risk"
  | "possible-precipitation"
  | "high-precipitation-risk"
  | "comfortable-temperature"
  | "cooler-than-ideal"
  | "warmer-than-ideal"
  | "elevated-thunderstorm-risk"
  | "strong-wind"
  | "active-severe-alert"
  | "incomplete-forecast";

export interface IndexedCoverage {
  locationIndex: number;
  indexes: readonly number[];
}

export interface WeatherCompositionManifest {
  version: "weather-manifest-v1";
  request: {
    locationIndexes: readonly number[];
    requestedUnits: "imperial" | "metric";
    hourlyCoverage: readonly IndexedCoverage[];
    dailyCoverage: readonly IndexedCoverage[];
    namedDays: readonly { locationIndex: number; weekday: string; dayIndex: number }[];
    activity?: {
      name: string;
      localTime?: string;
      dayOffset?: number;
      durationHours?: number;
      eligibleActivityWindowIndexes: readonly number[];
    };
    requestedSignals: readonly DailySignal[];
    comparisonMetrics: readonly ComparisonMetric[];
  };
  requiredFinalSourceIds: readonly string[];
  locations: readonly {
    index: number;
    name: string;
    timeZone: string;
    temperatureUnit: "F" | "C";
    current: {
      conditionKey: ConditionKey;
      conditionLabel: string;
      isDaytime?: boolean;
      temperatureBand: TemperatureBand;
      feelsLikeBand: TemperatureBand;
      feelsRelation: "cooler" | "similar" | "warmer";
      precipitationBand: PrecipitationBand;
      humidityBand: HumidityBand;
      windBand: WindBand;
      uvBand: UvBand;
      visibilityBand: VisibilityBand;
    };
    selectableHours: readonly {
      index: number;
      weekday: string;
      localDateLabel: string;
      localTimeLabel: string;
      conditionKey: ConditionKey;
      temperatureBand: TemperatureBand;
      precipitationBand: PrecipitationBand | "unavailable";
      temperatureTrend: Trend;
    }[];
    selectableDays: readonly {
      index: number;
      date: string;
      weekday: string;
      conditionKey: ConditionKey;
      highBand: TemperatureBand;
      lowBand: TemperatureBand;
      precipitationBand: PrecipitationBand;
      highTrend: Trend;
    }[];
    selectableAlerts: readonly {
      index: number;
      title: string;
      severity: "minor" | "moderate" | "severe" | "extreme";
      urgency?: string;
      startsLocal?: string;
      expiresLocal?: string;
      authoritySourceId?: string;
    }[];
    dailySignals: Readonly<
      Record<DailySignal, { preferredIndex: number; eligibleIndexes: readonly number[] } | null>
    >;
    availableCurrentMetrics: readonly ComparisonMetric[];
  }[];
  activityWindows: readonly {
    index: number;
    locationIndex: number;
    activity: string;
    label: string;
    confidence: "high" | "medium" | "low";
    startLocal: string;
    endLocal: string;
    weekday: string;
    dayOffset: number;
    durationHours?: number;
    reasonCodes: readonly ActivityReasonCode[];
    supportingHourIndexes: readonly number[];
  }[];
  comparison?: {
    anchorLocationIndex: number;
    locationIndexes: readonly number[];
    selectableHourlyIndexes: readonly number[];
    selectableDailyIndexes: readonly number[];
    rankings: readonly {
      forecastKind: "current" | "hourly" | "daily";
      anchorIndex?: number;
      axisLabel: string;
      metric: ComparisonMetric;
      lowToHighLocationIndexes: readonly number[];
      tiedLocationIndexes: readonly (readonly number[])[];
      preference: "lower" | "higher" | "contextual";
    }[];
  };
}

export interface ProjectedWeatherSource {
  id: string;
  title: string;
  provider: SourceRecord["provider"];
  role: "weather-provider" | "alert-authority";
}

export interface WeatherCompositionPayload {
  userRequest: string;
  clientContext: Pick<
    ClientContext,
    "sizeClass" | "locale" | "timeZone" | "units" | "reducedMotion"
  >;
  weatherManifest: WeatherCompositionManifest;
  sources: readonly ProjectedWeatherSource[];
}

export interface BuildWeatherCompositionPayloadInput {
  prompt: string;
  clientContext: ClientContext;
  retrieval: GeminiRetrievalResult;
}

const CONDITION_LABELS: Readonly<Record<ConditionKey, string>> = {
  clear: "Clear",
  "partly-cloudy": "Partly cloudy",
  cloudy: "Cloudy",
  rain: "Rain",
  storms: "Storms",
  snow: "Snow",
  fog: "Fog",
  wind: "Windy",
  unknown: "Conditions unavailable",
};

const MEASUREMENT_TOKEN =
  /-?\d+(?:\.\d+)?\s*(?:°\s*[fc]?|degrees?\s*[fc]?|[fc]\b|%|mph\b|km\/h\b|kph\b|knots?\b|feet\b|foot\b|ft\b|mi\b|km\b)/gi;
const URL_TOKEN = /(?:https?:\/\/|www\.)\S+/gi;
const COORDINATE_PAIR_TOKEN =
  /\(?[+-]?(?:90(?:\.0+)?|[1-8]?\d(?:\.\d+)?)\s*[,/]\s*[+-]?(?:180(?:\.0+)?|(?:1[0-7]\d|[1-9]?\d)(?:\.\d+)?)\)?/g;

function safeText(value: string, fallback: string): string {
  const sanitized = value
    .replace(URL_TOKEN, "")
    .replace(COORDINATE_PAIR_TOKEN, "")
    .replace(MEASUREMENT_TOKEN, "")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || fallback;
}

function canonicalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

function toCelsius(value: number, unit: "F" | "C"): number {
  return unit === "C" ? value : (value - 32) * (5 / 9);
}

function temperatureBand(value: number, unit: "F" | "C"): TemperatureBand {
  const celsius = toCelsius(value, unit);
  if (celsius < 0) return "very-cold";
  if (celsius < 10) return "cold";
  if (celsius < 16) return "cool";
  if (celsius < 24) return "mild";
  if (celsius < 30) return "warm";
  if (celsius < 38) return "hot";
  return "extreme-heat";
}

function precipitationBand(value: number): PrecipitationBand {
  if (value <= 0) return "none";
  if (value <= 15) return "low";
  if (value < 30) return "possible";
  if (value < 60) return "elevated";
  return "high";
}

function humidityBand(value: number): HumidityBand {
  if (value < 30) return "dry";
  if (value <= 60) return "comfortable";
  if (value <= 75) return "humid";
  return "oppressive";
}

function windBand(value: number, unit: "mph" | "km/h"): WindBand {
  const kilometersPerHour = unit === "km/h" ? value : value * 1.609344;
  if (kilometersPerHour < 10) return "calm";
  if (kilometersPerHour < 25) return "breezy";
  if (kilometersPerHour < 40) return "windy";
  return "strong";
}

function visibilityBand(value: number, unit: "mi" | "km"): VisibilityBand {
  const kilometers = unit === "km" ? value : value * 1.609344;
  if (kilometers >= 10) return "good";
  if (kilometers >= 5) return "reduced";
  return "poor";
}

function uvBand(value: number): UvBand {
  if (value <= 2) return "low";
  if (value <= 5) return "moderate";
  if (value <= 7) return "high";
  if (value <= 10) return "very-high";
  return "extreme";
}

function trend(current: number, previous: number | undefined, unit: "F" | "C"): Trend {
  if (previous === undefined) return "steady";
  const tolerance = unit === "C" ? 1 : 2;
  if (current - previous >= tolerance) return "rising";
  if (previous - current >= tolerance) return "falling";
  return "steady";
}

function localTimeLabel(value: string, timeZone: string, locale: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

function localDateLabel(value: string, timeZone: string, locale: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone }).format(date);
}

function localWeekday(value: string, timeZone: string, locale: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone }).format(date);
}

function localOrdinal(value: string, timeZone: string): number | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (![year, month, day].every(Number.isFinite)) return undefined;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function dayWeekday(dateValue: string, locale: string): string | undefined {
  const date = new Date(`${dateValue}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date);
}

function canonicalActivity(value: string, fallback: string): string {
  const sanitized = safeText(value, fallback);
  const aliases: Readonly<Record<string, string>> = {
    run: "run",
    running: "run",
    jog: "run",
    jogging: "run",
    walk: "walk",
    walking: "walk",
    hike: "hike",
    hiking: "hike",
    bike: "bike",
    biking: "bike",
    cycle: "bike",
    cycling: "bike",
    ride: "bike",
  };
  return aliases[sanitized.toLocaleLowerCase("en-US")] ?? sanitized;
}

function locationsMatch(left: ParsedLocation["location"], right: ParsedActivityWindow["location"]): boolean {
  if (left.placeId && right.placeId) return left.placeId === right.placeId;
  const coordinatesMatch =
    left.latitude !== undefined &&
    right.latitude !== undefined &&
    left.longitude !== undefined &&
    right.longitude !== undefined &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude;
  return left.name === right.name && (coordinatesMatch || left.latitude === undefined || right.latitude === undefined);
}

function supportingHourIndexes(location: ParsedLocation, window: ParsedActivityWindow): number[] {
  const start = Date.parse(window.startTime);
  const end = Date.parse(window.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const selected = location.hourly.flatMap((hour, index) => {
    const timestamp = Date.parse(hour.startTime);
    return timestamp >= start - 3_600_000 && timestamp <= end ? [index] : [];
  });
  if (selected.length >= 2 || location.hourly.length < 2) return selected.slice(0, 24);
  const nearest = location.hourly
    .map((hour, index) => ({ index, distance: Math.abs(Date.parse(hour.startTime) - start) }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((left, right) => left.distance - right.distance || left.index - right.index);
  for (const entry of nearest) {
    if (!selected.includes(entry.index)) selected.push(entry.index);
    if (selected.length >= 2) break;
  }
  return selected.sort((left, right) => left - right).slice(0, 24);
}

function reasonCodes(window: ParsedActivityWindow): ActivityReasonCode[] {
  const normalized = `${window.label} ${(window.reasons ?? []).join(" ")}`.toLocaleLowerCase("en-US");
  const codes: ActivityReasonCode[] = ["preferred-window"];
  const add = (pattern: RegExp, code: ActivityReasonCode): void => {
    if (pattern.test(normalized) && !codes.includes(code)) codes.push(code);
  };
  add(/low (?:rain|precipitation)/, "low-precipitation-risk");
  add(/possible (?:rain|precipitation)/, "possible-precipitation");
  add(/high (?:rain|precipitation)/, "high-precipitation-risk");
  add(/comfortable/, "comfortable-temperature");
  add(/cooler|cold/, "cooler-than-ideal");
  add(/warmer|hot|heat/, "warmer-than-ideal");
  add(/thunderstorm/, "elevated-thunderstorm-risk");
  add(/strong wind/, "strong-wind");
  add(/severe alert/, "active-severe-alert");
  add(/incomplete|unavailable/, "incomplete-forecast");
  return codes;
}

function dailySignal(
  location: ParsedLocation,
  signal: DailySignal,
  selectableIndexes: readonly number[],
): { preferredIndex: number; eligibleIndexes: readonly number[] } | null {
  const candidates = selectableIndexes.flatMap((index) => {
    const day = location.daily[index];
    return day ? [{ day, index }] : [];
  });
  if (candidates.length === 0) return null;
  const values = candidates.map(({ day }) => {
    if (signal === "wettest" || signal === "driest") return day.precipitationProbability;
    return signal === "warmest" ? day.high : day.low;
  });
  const target = signal === "driest" || signal === "coolest" ? Math.min(...values) : Math.max(...values);
  const eligibleIndexes = candidates.flatMap(({ index }, candidateIndex) =>
    values[candidateIndex] === target ? [index] : []
  );
  return eligibleIndexes.length > 0
    ? { preferredIndex: eligibleIndexes[0], eligibleIndexes }
    : null;
}

function matchedSourceId(uri: string | undefined, sources: readonly SourceRecord[]): string | undefined {
  const target = canonicalUrl(uri);
  if (!target) return undefined;
  return sources.find((source) => canonicalUrl(source.url) === target)?.id;
}

function parseWeatherState(retrieval: GeminiRetrievalResult): {
  locations: ParsedLocation[];
  activityWindows: ParsedActivityWindow[];
} | null {
  if (retrieval.evidence.length === 0) return null;
  const locations: ParsedLocation[] = [];
  const activityWindows: ParsedActivityWindow[] = [];
  for (const evidence of retrieval.evidence) {
    const parsed = weatherResultSchema.safeParse(evidence.result);
    if (!parsed.success) throw new TypeError("Weather evidence cannot be projected safely for composition.");
    locations.push(...parsed.data.locations);
    activityWindows.push(...parsed.data.activityWindows);
  }
  if (locations.length === 0 || locations.length > 4) {
    throw new TypeError("Weather evidence contains an unsupported location count.");
  }
  return { locations, activityWindows };
}

function selectedDayIndexes(location: ParsedLocation, intent: WeatherRequestIntent): number[] {
  const count = intent.forecastDays;
  if (count) return location.daily.slice(0, Math.min(count, 10)).map((_, index) => index);
  const datedDays = location.daily
    .flatMap((day, index) => {
      const ordinal = calendarOrdinal(day.date);
      const weekday = dayWeekday(day.date, "en-US")?.toLocaleLowerCase("en-US");
      return ordinal === undefined || !weekday
        ? []
        : [{ index, ordinal, weekday: weekday as WeatherWeekday }];
    })
    .sort((left, right) => left.ordinal - right.ordinal || left.index - right.index);
  const observedOrdinal = localOrdinal(location.current.observedAt, location.current.timeZone);

  if (intent.relativeDayOffsets.length > 0) {
    if (observedOrdinal === undefined) return [];
    return intent.relativeDayOffsets.flatMap((offset) => {
      const selected = datedDays.find((day) => day.ordinal === observedOrdinal + offset);
      return selected ? [selected.index] : [];
    });
  }

  if (intent.nextWeekday) {
    const next = datedDays.find(
      (day) =>
        day.weekday === intent.nextWeekday &&
        (observedOrdinal === undefined || day.ordinal > observedOrdinal),
    );
    return next ? [next.index] : [];
  }
  if (intent.weekend) {
    for (const saturday of datedDays) {
      if (saturday.weekday !== "saturday") continue;
      if (observedOrdinal !== undefined && saturday.ordinal < observedOrdinal) continue;
      const sunday = datedDays.find(
        (day) => day.weekday === "sunday" && day.ordinal === saturday.ordinal + 1,
      );
      if (sunday) return [saturday, sunday].map((day) => day.index);
    }
    return [];
  }
  if (intent.weekdaySpan) {
    const starts = datedDays.filter(
      (day) =>
        day.weekday === intent.weekdaySpan?.start &&
        (observedOrdinal === undefined || day.ordinal >= observedOrdinal),
    );
    for (const start of starts) {
      const end = datedDays.find(
        (day) =>
          day.weekday === intent.weekdaySpan?.end &&
          day.ordinal >= start.ordinal &&
          day.ordinal - start.ordinal <= 6,
      );
      if (!end) continue;
      return datedDays
        .filter((day) => day.ordinal >= start.ordinal && day.ordinal <= end.ordinal)
        .map((day) => day.index);
    }
    return [];
  }

  if (intent.throughWeekday) {
    const end = datedDays.find(
      (day) =>
        day.weekday === intent.throughWeekday &&
        (observedOrdinal === undefined || day.ordinal >= observedOrdinal),
    );
    if (!end) return [];
    return datedDays
      .filter(
        (day) =>
          (observedOrdinal === undefined || day.ordinal >= observedOrdinal) &&
          day.ordinal <= end.ordinal,
      )
      .map((day) => day.index);
  }

  const weekdays = new Set(intent.namedWeekdays);
  if (weekdays.size === 0) return [];
  return datedDays.flatMap((day) => weekdays.has(day.weekday) ? [day.index] : []);
}

function calendarOrdinal(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const normalized = new Date(timestamp);
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    return undefined;
  }
  return Math.floor(timestamp / 86_400_000);
}

function preferenceFor(metric: ComparisonMetric): "lower" | "higher" | "contextual" {
  if (["precipitation", "wind", "uv"].includes(metric)) return "lower";
  if (metric === "visibility") return "higher";
  return "contextual";
}

function ranking(
  values: readonly { locationIndex: number; value: number }[],
): { lowToHighLocationIndexes: number[]; tiedLocationIndexes: number[][] } {
  const ordered = [...values].sort(
    (left, right) => left.value - right.value || left.locationIndex - right.locationIndex,
  );
  const groups = new Map<number, number[]>();
  for (const item of ordered) {
    const group = groups.get(item.value) ?? [];
    group.push(item.locationIndex);
    groups.set(item.value, group);
  }
  return {
    lowToHighLocationIndexes: ordered.map((item) => item.locationIndex),
    tiedLocationIndexes: [...groups.values()].filter((group) => group.length > 1),
  };
}

function alignedHourlyIndex(anchor: ParsedLocation, location: ParsedLocation, anchorIndex: number): number {
  const timestamp = anchor.hourly[anchorIndex]?.startTime;
  return timestamp ? location.hourly.findIndex((hour) => hour.startTime === timestamp) : -1;
}

function alignedDailyIndex(anchor: ParsedLocation, location: ParsedLocation, anchorIndex: number): number {
  const date = anchor.daily[anchorIndex]?.date;
  return date ? location.daily.findIndex((day) => day.date === date) : -1;
}

function localRelativeDailyIndex(
  dailyCoverage: readonly IndexedCoverage[],
  locationIndex: number,
  anchorIndex: number,
): number {
  const anchorIndexes = dailyCoverage.find((coverage) => coverage.locationIndex === 0)?.indexes ?? [];
  const selectionPosition = anchorIndexes.indexOf(anchorIndex);
  if (selectionPosition < 0) return -1;
  return dailyCoverage.find((coverage) => coverage.locationIndex === locationIndex)
    ?.indexes[selectionPosition] ?? -1;
}

function buildComparison(
  locations: readonly ParsedLocation[],
  locale: string,
  hourlyCoverage: readonly IndexedCoverage[],
  dailyCoverage: readonly IndexedCoverage[],
  relativeDayOffset: number | undefined,
  alignByLocalHour: boolean,
): WeatherCompositionManifest["comparison"] {
  if (locations.length < 2) return undefined;
  const locationIndexes = locations.map((_, index) => index);
  const anchor = locations[0];
  const requestedHourlyIndexes = hourlyCoverage.find(
    (coverage) => coverage.locationIndex === 0,
  )?.indexes ?? [];
  const localRelativeHourlyIndex = (
    locationIndex: number,
    anchorIndex: number,
  ): number => {
    const selectionPosition = requestedHourlyIndexes.indexOf(anchorIndex);
    if (selectionPosition < 0) return -1;
    return hourlyCoverage.find((coverage) => coverage.locationIndex === locationIndex)
      ?.indexes[selectionPosition] ?? -1;
  };
  const comparisonHourlyIndex = (
    location: ParsedLocation,
    locationIndex: number,
    anchorIndex: number,
  ): number =>
    alignByLocalHour
      ? localRelativeHourlyIndex(locationIndex, anchorIndex)
      : alignedHourlyIndex(anchor, location, anchorIndex);
  const hourlyIndexes = requestedHourlyIndexes
    .filter((anchorIndex) => anchorIndex >= 0 && anchorIndex < anchor.hourly.length)
    .filter((anchorIndex) =>
      locations.every((location, locationIndex) =>
        comparisonHourlyIndex(location, locationIndex, anchorIndex) >= 0
      )
    );
  const requestedDailyIndexes = dailyCoverage.find((coverage) => coverage.locationIndex === 0)?.indexes ?? [];
  const comparisonDailyIndex = (
    location: ParsedLocation,
    locationIndex: number,
    anchorIndex: number,
  ): number =>
    relativeDayOffset === undefined
      ? alignedDailyIndex(anchor, location, anchorIndex)
      : localRelativeDailyIndex(dailyCoverage, locationIndex, anchorIndex);
  const dailyIndexes = requestedDailyIndexes
    .filter((anchorIndex) => anchorIndex >= 0 && anchorIndex < anchor.daily.length)
    .filter((anchorIndex) =>
      locations.every((location, locationIndex) => {
        const index = comparisonDailyIndex(location, locationIndex, anchorIndex);
        return index >= 0 && index < location.daily.length;
      })
    );
  const rankings: NonNullable<WeatherCompositionManifest["comparison"]>["rankings"][number][] = [];

  const currentMetrics: readonly [ComparisonMetric, (location: ParsedLocation) => number][] = [
    ["temperature", (location) => location.current.temperature],
    ["feelsLike", (location) => location.current.feelsLike],
    ["humidity", (location) => location.current.humidity],
    ["precipitation", (location) => location.current.precipitationProbability],
    ["wind", (location) => location.current.windSpeed],
    ["uv", (location) => location.current.uvIndex],
    ["visibility", (location) => location.current.visibility],
  ];
  for (const [metric, read] of currentMetrics) {
    rankings.push({
      forecastKind: "current",
      axisLabel: "Current conditions",
      metric,
      ...ranking(locations.map((location, locationIndex) => ({ locationIndex, value: read(location) }))),
      preference: preferenceFor(metric),
    });
  }

  for (const anchorIndex of hourlyIndexes) {
    const anchorHour = anchor.hourly[anchorIndex];
    if (!anchorHour) continue;
    const axisLabel = localTimeLabel(anchorHour.startTime, anchor.current.timeZone, locale) ?? "Forecast hour";
    const metricReaders: readonly [ComparisonMetric, (location: ParsedLocation, index: number) => number | null][] = [
      ["temperature", (location, index) => location.hourly[index]?.temperature ?? null],
      ["precipitation", (location, index) => location.hourly[index]?.precipitationProbability ?? null],
    ];
    for (const [metric, read] of metricReaders) {
      const values = locations.flatMap((location, locationIndex) => {
        const index = comparisonHourlyIndex(location, locationIndex, anchorIndex);
        const value = read(location, index);
        return value === null ? [] : [{ locationIndex, value }];
      });
      if (values.length !== locations.length) continue;
      rankings.push({
        forecastKind: "hourly",
        anchorIndex,
        axisLabel,
        metric,
        ...ranking(values),
        preference: preferenceFor(metric),
      });
    }
  }

  for (const anchorIndex of dailyIndexes) {
    const anchorDay = anchor.daily[anchorIndex];
    if (!anchorDay) continue;
    const axisLabel = relativeDayOffset === 0
      ? "Local today"
      : relativeDayOffset === 1
        ? "Local tomorrow"
        : dayWeekday(anchorDay.date, locale) ?? anchorDay.date;
    const metricReaders: readonly [ComparisonMetric, (location: ParsedLocation, index: number) => number][] = [
      ["high", (location, index) => location.daily[index]?.high ?? Number.NaN],
      ["low", (location, index) => location.daily[index]?.low ?? Number.NaN],
      ["precipitation", (location, index) => location.daily[index]?.precipitationProbability ?? Number.NaN],
    ];
    for (const [metric, read] of metricReaders) {
      const values = locations.map((location, locationIndex) => ({
        locationIndex,
        value: read(location, comparisonDailyIndex(location, locationIndex, anchorIndex)),
      }));
      if (values.some((item) => !Number.isFinite(item.value))) continue;
      rankings.push({
        forecastKind: "daily",
        anchorIndex,
        axisLabel,
        metric,
        ...ranking(values),
        preference: preferenceFor(metric),
      });
    }
  }

  return {
    anchorLocationIndex: 0,
    locationIndexes,
    selectableHourlyIndexes: hourlyIndexes,
    selectableDailyIndexes: dailyIndexes,
    rankings,
  };
}

export function buildWeatherCompositionPayload({
  prompt,
  clientContext,
  retrieval,
}: BuildWeatherCompositionPayloadInput): WeatherCompositionPayload | null {
  const state = parseWeatherState(retrieval);
  if (!state) return null;
  const intent = parseWeatherRequestIntent(prompt);
  const requestedHours = intent.forecastHours;
  if (requestedHours !== undefined && requestedHours > 24) {
    throw new TypeError("Weather surfaces can display at most 24 requested forecast hours.");
  }
  const requestedDayCount = intent.forecastDays;
  if (requestedDayCount !== undefined && requestedDayCount > 10) {
    throw new TypeError("Weather surfaces can display at most 10 requested forecast days.");
  }
  const { locations } = state;
  const activityName = intent.activity?.name;
  const localTime = intent.localTime;
  const dayOffset = intent.relativeDayOffsets.length === 1
    ? intent.relativeDayOffsets[0]
    : undefined;
  const durationHours = intent.activity?.durationHours;

  const activityWindows = state.activityWindows.map((window, index) => {
    const locationIndex = locations.findIndex((location) => locationsMatch(location.location, window.location));
    if (locationIndex < 0) throw new TypeError("Activity-window evidence does not match a weather location.");
    const location = locations[locationIndex];
    const startLocal = localTimeLabel(window.startTime, location.current.timeZone, clientContext.locale);
    const endLocal = localTimeLabel(window.endTime, location.current.timeZone, clientContext.locale);
    const weekday = localWeekday(window.startTime, location.current.timeZone, clientContext.locale);
    const observedOrdinal = localOrdinal(location.current.observedAt, location.current.timeZone);
    const windowOrdinal = localOrdinal(window.startTime, location.current.timeZone);
    if (!startLocal || !endLocal || !weekday || observedOrdinal === undefined || windowOrdinal === undefined) {
      throw new TypeError("Activity-window timestamps cannot be localized safely.");
    }
    const activity = canonicalActivity(window.activity ?? activityName ?? "activity", "activity");
    return {
      index,
      locationIndex,
      activity,
      label: `${activity.charAt(0).toLocaleUpperCase(clientContext.locale)}${activity.slice(1)} window`,
      confidence: window.confidence,
      startLocal,
      endLocal,
      weekday,
      dayOffset: windowOrdinal - observedOrdinal,
      ...(window.durationHours === undefined ? {} : { durationHours: window.durationHours }),
      reasonCodes: reasonCodes(window),
      supportingHourIndexes: supportingHourIndexes(location, window),
    };
  });

  const eligibleActivityWindows = activityWindows.filter((window) => {
    if (activityName && window.activity.toLocaleLowerCase("en-US") !== activityName) return false;
    if (localTime && window.startLocal !== localTime) return false;
    if (dayOffset !== undefined && window.dayOffset !== dayOffset) return false;
    return true;
  });

  const localHourCoverage = requestedLocalHourCoverage(prompt, locations);

  const hourlyCoverage = locations.flatMap((location, locationIndex) => {
    const indexes = new Set<number>();
    if (requestedHours) {
      location.hourly.slice(0, Math.min(requestedHours, 24)).forEach((_, index) => indexes.add(index));
    }
    for (const index of localHourCoverage.find(
      (coverage) => coverage.locationIndex === locationIndex,
    )?.indexes ?? []) {
      indexes.add(index);
    }
    for (const window of eligibleActivityWindows) {
      if (window.locationIndex === locationIndex) {
        for (const index of window.supportingHourIndexes) indexes.add(index);
      }
    }
    return indexes.size > 0
      ? [{ locationIndex, indexes: [...indexes].sort((left, right) => left - right).slice(0, 24) }]
      : [];
  });

  const dailyCoverage = locations.flatMap((location, locationIndex) => {
    const indexes = selectedDayIndexes(location, intent);
    return indexes.length > 0 ? [{ locationIndex, indexes }] : [];
  });
  const requestedDays = new Set<string>(intent.namedWeekdays);
  const expandedNamedDaySelection =
    intent.weekend ||
    intent.weekdaySpan !== undefined ||
    intent.throughWeekday !== undefined ||
    intent.nextWeekday !== undefined;
  const namedDays = locations.flatMap((location, locationIndex) => {
    const selectedIndexes = new Set(
      dailyCoverage.find((coverage) => coverage.locationIndex === locationIndex)?.indexes ?? [],
    );
    return location.daily.flatMap((day, dayIndex) => {
      const weekday = dayWeekday(day.date, clientContext.locale);
      const isSelectedNamedDay = expandedNamedDaySelection
        ? selectedIndexes.has(dayIndex)
        : weekday && requestedDays.has(weekday.toLocaleLowerCase("en-US"));
      return weekday && isSelectedNamedDay
        ? [{ locationIndex, weekday, dayIndex }]
        : [];
    });
  });

  const alertAuthorityUrls = new Set(
    locations.flatMap((location) =>
      location.alerts
        .map((alert) => canonicalUrl(alert.sourceAuthorityUri))
        .filter((url): url is string => Boolean(url)),
    ),
  );
  const sources = retrieval.sources.map((sourceRecord) => ({
    id: sourceRecord.id,
    title: safeText(sourceRecord.title, `${sourceRecord.provider} source`),
    provider: sourceRecord.provider,
    role: alertAuthorityUrls.has(canonicalUrl(sourceRecord.url) ?? "")
      ? "alert-authority" as const
      : "weather-provider" as const,
  }));

  const manifestLocations: WeatherCompositionManifest["locations"] = locations.map(
    (location, locationIndex) => {
      const requiredHourIndexes = new Set(
        hourlyCoverage.find((coverage) => coverage.locationIndex === locationIndex)?.indexes ?? [],
      );
      const selectableHourIndexes = requiredHourIndexes;
      const selectableDayIndexes = new Set(
        dailyCoverage.find((coverage) => coverage.locationIndex === locationIndex)?.indexes ?? [],
      );
      const dailySignalIndexes = [...selectableDayIndexes].sort((left, right) => left - right);
      const current = location.current;
      const relationThreshold = current.temperatureUnit === "C" ? 2 : 3;
      const relationDelta = current.feelsLike - current.temperature;
      return {
        index: locationIndex,
        name: safeText(location.location.name, "Resolved location"),
        timeZone: current.timeZone,
        temperatureUnit: current.temperatureUnit,
        current: {
          conditionKey: current.conditionKey,
          conditionLabel: CONDITION_LABELS[current.conditionKey],
          ...(current.isDaytime === undefined ? {} : { isDaytime: current.isDaytime }),
          temperatureBand: temperatureBand(current.temperature, current.temperatureUnit),
          feelsLikeBand: temperatureBand(current.feelsLike, current.temperatureUnit),
          feelsRelation:
            relationDelta >= relationThreshold
              ? "warmer" as const
              : relationDelta <= -relationThreshold
                ? "cooler" as const
                : "similar" as const,
          precipitationBand: precipitationBand(current.precipitationProbability),
          humidityBand: humidityBand(current.humidity),
          windBand: windBand(current.windSpeed, current.windSpeedUnit),
          uvBand: uvBand(current.uvIndex),
          visibilityBand: visibilityBand(current.visibility, current.visibilityUnit),
        },
        selectableHours: [...selectableHourIndexes]
          .sort((left, right) => left - right)
          .slice(0, 24)
          .flatMap((index) => {
            const hour = location.hourly[index];
            if (!hour) return [];
            const weekday = localWeekday(hour.startTime, current.timeZone, clientContext.locale);
            const dateLabel = localDateLabel(hour.startTime, current.timeZone, clientContext.locale);
            const timeLabel = localTimeLabel(hour.startTime, current.timeZone, clientContext.locale);
            if (!weekday || !dateLabel || !timeLabel) return [];
            return [{
              index,
              weekday,
              localDateLabel: dateLabel,
              localTimeLabel: timeLabel,
              conditionKey: hour.conditionKey,
              temperatureBand: temperatureBand(hour.temperature, hour.temperatureUnit),
              precipitationBand:
                hour.precipitationProbability === null
                  ? "unavailable" as const
                  : precipitationBand(hour.precipitationProbability),
              temperatureTrend: trend(
                hour.temperature,
                location.hourly[index - 1]?.temperature,
                hour.temperatureUnit,
              ),
            }];
          }),
        selectableDays: [...selectableDayIndexes]
          .sort((left, right) => left - right)
          .flatMap((index) => {
            const day = location.daily[index];
            if (!day) return [];
            return [{
              index,
              date: day.date,
              weekday: dayWeekday(day.date, clientContext.locale) ?? day.date,
              conditionKey: day.conditionKey,
              highBand: temperatureBand(day.high, day.temperatureUnit),
              lowBand: temperatureBand(day.low, day.temperatureUnit),
              precipitationBand: precipitationBand(day.precipitationProbability),
              highTrend: trend(day.high, location.daily[index - 1]?.high, day.temperatureUnit),
            }];
          }),
        selectableAlerts: location.alerts.flatMap((alert, index) => {
          if (alert.severity === "unknown") return [];
          return [{
            index,
            title: safeText(alert.title, "Weather alert"),
            severity: alert.severity,
            ...(alert.urgency ? { urgency: safeText(alert.urgency, "unknown") } : {}),
            ...(alert.startsAt
              ? { startsLocal: localTimeLabel(alert.startsAt, current.timeZone, clientContext.locale) }
              : {}),
            ...(alert.expiresAt
              ? { expiresLocal: localTimeLabel(alert.expiresAt, current.timeZone, clientContext.locale) }
              : {}),
            ...(matchedSourceId(alert.sourceAuthorityUri, retrieval.sources)
              ? { authoritySourceId: matchedSourceId(alert.sourceAuthorityUri, retrieval.sources) }
              : {}),
          }];
        }).slice(0, 8),
        dailySignals: {
          wettest: dailySignal(location, "wettest", dailySignalIndexes),
          driest: dailySignal(location, "driest", dailySignalIndexes),
          warmest: dailySignal(location, "warmest", dailySignalIndexes),
          coolest: dailySignal(location, "coolest", dailySignalIndexes),
        },
        availableCurrentMetrics: [
          "temperature",
          "feelsLike",
          "humidity",
          "precipitation",
          "wind",
          "uv",
          "visibility",
        ],
      };
    },
  );

  return {
    userRequest: prompt.trim(),
    clientContext: {
      sizeClass: clientContext.sizeClass,
      locale: clientContext.locale,
      timeZone: clientContext.timeZone,
      units: clientContext.units,
      reducedMotion: clientContext.reducedMotion,
    },
    weatherManifest: {
      version: "weather-manifest-v1",
      request: {
        locationIndexes: locations.map((_, index) => index),
        requestedUnits: intent.requestedUnits ?? clientContext.units,
        hourlyCoverage,
        dailyCoverage,
        namedDays,
        ...(activityName
          ? {
              activity: {
                name: activityName,
                ...(localTime ? { localTime } : {}),
                ...(dayOffset === undefined ? {} : { dayOffset }),
                ...(durationHours === undefined ? {} : { durationHours }),
                eligibleActivityWindowIndexes: eligibleActivityWindows.map((window) => window.index),
              },
            }
          : {}),
        requestedSignals: intent.requestedSignals,
        comparisonMetrics: intent.comparisonMetrics,
      },
      requiredFinalSourceIds: sources.map((sourceRecord) => sourceRecord.id),
      locations: manifestLocations,
      activityWindows,
      ...(locations.length > 1
        ? {
            comparison: buildComparison(
              locations,
              clientContext.locale,
              hourlyCoverage,
              dailyCoverage,
              dayOffset,
              localTime !== undefined,
            ),
          }
        : {}),
    },
    sources,
  };
}
