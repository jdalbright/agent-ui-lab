const WEATHER_BASE_URL = "https://weather.googleapis.com";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_CACHE_TTL_MS = 15 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_LOCATIONS = 4;
const COARSE_COORDINATE_DECIMALS = 2;

// Weather API v1 REST resources and exact lookup paths:
// https://developers.google.com/maps/documentation/weather/reference/rest
// Unit selection (`unitsSystem`) and conversions:
// https://developers.google.com/maps/documentation/weather/weather-units-systems

export type WeatherUnits = "imperial" | "metric";
export type WeatherFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export const GOOGLE_WEATHER_ATTRIBUTION = Object.freeze({
  text: "Source: Includes weather data from Google",
  url: "https://developers.google.com/maps/documentation/weather/policies",
});
export type TemperatureUnit = "F" | "C";
export type WeatherConditionKey =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "rain"
  | "storms"
  | "snow"
  | "fog"
  | "wind"
  | "unknown";

export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
  placeId?: string;
}

export interface NormalizedCurrentConditions {
  observedAt: string;
  timeZone: string;
  temperature: number;
  feelsLike: number;
  temperatureUnit: TemperatureUnit;
  conditionKey: WeatherConditionKey;
  conditionText: string;
  isDaytime: boolean;
  humidity: number;
  precipitationProbability: number;
  windDirection: string;
  windDegrees: number;
  windSpeed: number;
  windGust: number;
  windSpeedUnit: "mph" | "km/h";
  visibility: number;
  visibilityUnit: "mi" | "km";
  uvIndex: number;
  cloudCover: number;
  thunderstormProbability: number;
}

export interface NormalizedHourlyForecast {
  startTime: string;
  endTime: string;
  temperature: number;
  feelsLike: number;
  temperatureUnit: TemperatureUnit;
  precipitationProbability: number | null;
  thunderstormProbability: number | null;
  conditionKey: WeatherConditionKey;
  conditionText: string;
  isDaytime: boolean;
  humidity: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windSpeedUnit: "mph" | "km/h";
}

export interface NormalizedDailyForecast {
  date: string;
  startTime: string;
  endTime: string;
  high: number;
  low: number;
  temperatureUnit: TemperatureUnit;
  precipitationProbability: number;
  conditionKey: WeatherConditionKey;
  conditionText: string;
  nighttimeConditionKey: WeatherConditionKey;
  nighttimeConditionText: string;
  sunriseTime?: string;
  sunsetTime?: string;
}

export type NormalizedAlertSeverity = "minor" | "moderate" | "severe" | "extreme" | "unknown";
export type NormalizedAlertCertainty = "observed" | "very-likely" | "likely" | "possible" | "unlikely" | "unknown";
export type NormalizedAlertUrgency = "immediate" | "expected" | "future" | "past" | "unknown";

export interface NormalizedWeatherAlert {
  id: string;
  title: string;
  eventType: string;
  eventTypeCode: string;
  areaName: string;
  description: string;
  instructions: string[];
  safetyRecommendations: string[];
  startsAt?: string;
  expiresAt?: string;
  severity: NormalizedAlertSeverity;
  certainty: NormalizedAlertCertainty;
  urgency: NormalizedAlertUrgency;
  sourceName?: string;
  sourcePublisherCode?: string;
  sourceAuthorityUri?: string;
  polygon?: string;
}

export interface LocationWeather {
  location: WeatherLocation;
  units: WeatherUnits;
  fetchedAt: string;
  current: NormalizedCurrentConditions;
  hourly: NormalizedHourlyForecast[];
  daily: NormalizedDailyForecast[];
  alerts: NormalizedWeatherAlert[];
  alertRegionCode?: string;
}

export type GoogleWeatherBundle = LocationWeather;

export interface WeatherBundle {
  locations: LocationWeather[];
  units: WeatherUnits;
  fetchedAt: string;
  attribution: typeof GOOGLE_WEATHER_ATTRIBUTION;
}

export interface GoogleWeatherOptions {
  apiKey?: string;
  locale?: string;
  languageCode?: string;
  units?: WeatherUnits;
  hours?: number;
  days?: number;
  signal?: AbortSignal;
  fetchImpl?: WeatherFetchLike;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface GetWeatherBundleInput extends GoogleWeatherOptions {
  locations: readonly WeatherLocation[];
  apiKey: string;
  units: WeatherUnits;
}

interface GoogleTemperature {
  degrees?: unknown;
  unit?: unknown;
}

interface GoogleCondition {
  type?: unknown;
  description?: { text?: unknown };
}

interface GooglePrecipitation {
  probability?: { percent?: unknown };
}

interface GoogleWind {
  direction?: { cardinal?: unknown; degrees?: unknown };
  speed?: { value?: unknown; unit?: unknown };
  gust?: { value?: unknown; unit?: unknown };
}

interface GoogleCurrentResponse {
  currentTime?: unknown;
  timeZone?: { id?: unknown };
  isDaytime?: unknown;
  weatherCondition?: GoogleCondition;
  temperature?: GoogleTemperature;
  feelsLikeTemperature?: GoogleTemperature;
  relativeHumidity?: unknown;
  precipitation?: GooglePrecipitation;
  thunderstormProbability?: unknown;
  wind?: GoogleWind;
  visibility?: { distance?: unknown; unit?: unknown };
  uvIndex?: unknown;
  cloudCover?: unknown;
}

interface GoogleForecastHour {
  interval?: { startTime?: unknown; endTime?: unknown };
  isDaytime?: unknown;
  weatherCondition?: GoogleCondition;
  temperature?: GoogleTemperature;
  feelsLikeTemperature?: GoogleTemperature;
  precipitation?: GooglePrecipitation;
  thunderstormProbability?: unknown;
  relativeHumidity?: unknown;
  wind?: GoogleWind;
}

interface GoogleHourlyResponse {
  forecastHours?: unknown;
  nextPageToken?: unknown;
}

interface GoogleDayPart {
  weatherCondition?: GoogleCondition;
  precipitation?: GooglePrecipitation;
}

interface GoogleForecastDay {
  interval?: { startTime?: unknown; endTime?: unknown };
  displayDate?: { year?: unknown; month?: unknown; day?: unknown };
  maxTemperature?: GoogleTemperature;
  minTemperature?: GoogleTemperature;
  daytimeForecast?: GoogleDayPart;
  nighttimeForecast?: GoogleDayPart;
  sunEvents?: { sunriseTime?: unknown; sunsetTime?: unknown };
}

interface GoogleDailyResponse {
  forecastDays?: unknown;
}

interface GoogleAlert {
  alertId?: unknown;
  alertTitle?: { text?: unknown };
  eventType?: unknown;
  areaName?: unknown;
  instruction?: unknown;
  safetyRecommendations?: unknown;
  startTime?: unknown;
  expirationTime?: unknown;
  dataSource?: { publisher?: unknown; name?: unknown; authorityUri?: unknown };
  polygon?: unknown;
  description?: unknown;
  severity?: unknown;
  certainty?: unknown;
  urgency?: unknown;
}

interface GoogleAlertsResponse {
  weatherAlerts?: unknown;
  regionCode?: unknown;
  nextPageToken?: unknown;
}

type CachedLocationWeather = Omit<LocationWeather, "location">;

interface WeatherCacheEntry {
  expiresAt: number;
  value: CachedLocationWeather;
}

const cache = new Map<string, WeatherCacheEntry>();

export class GoogleWeatherError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GoogleWeatherError";
    this.status = status;
  }
}

export function clearGoogleWeatherCache(): void {
  cache.clear();
}

function requiredApiKey(apiKey?: string): string {
  const resolved = apiKey?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!resolved) throw new GoogleWeatherError("Google Maps API key is required.");
  return resolved;
}

function assertLocation(location: WeatherLocation): void {
  if (
    !location.name.trim() ||
    !Number.isFinite(location.latitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    !Number.isFinite(location.longitude) ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    throw new GoogleWeatherError("A valid named location with latitude and longitude is required.");
  }
}

function integerInRange(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentValue(value: unknown): number {
  return Math.round(Math.min(100, Math.max(0, numberValue(value))));
}

function optionalPercent(value: unknown): number | null {
  const number = optionalNumber(value);
  return number === null ? null : Math.round(Math.min(100, Math.max(0, number)));
}

function toIso(value: unknown): string {
  if (typeof value !== "string") throw new GoogleWeatherError("Google Weather returned an invalid timestamp.");
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new GoogleWeatherError("Google Weather returned an invalid timestamp.");
  return timestamp.toISOString();
}

function optionalIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function temperatureUnit(rawUnit: unknown, units: WeatherUnits): TemperatureUnit {
  if (rawUnit === "FAHRENHEIT") return "F";
  if (rawUnit === "CELSIUS") return "C";
  return units === "imperial" ? "F" : "C";
}

function speedUnit(rawUnit: unknown, units: WeatherUnits): "mph" | "km/h" {
  if (rawUnit === "MILES_PER_HOUR") return "mph";
  if (rawUnit === "KILOMETERS_PER_HOUR") return "km/h";
  return units === "imperial" ? "mph" : "km/h";
}

function visibilityUnit(rawUnit: unknown, units: WeatherUnits): "mi" | "km" {
  if (rawUnit === "MILES") return "mi";
  if (rawUnit === "KILOMETERS") return "km";
  return units === "imperial" ? "mi" : "km";
}

function titleFromEnum(value: string): string {
  if (!value) return "Unknown conditions";
  const text = value.toLocaleLowerCase("en-US").replaceAll("_", " ");
  return text.charAt(0).toLocaleUpperCase("en-US") + text.slice(1);
}

export function normalizeCondition(value: unknown): WeatherConditionKey {
  const type = stringValue(value).toLocaleUpperCase("en-US");
  if (!type || type.includes("UNSPECIFIED") || type === "UNKNOWN") return "unknown";
  if (type.includes("SNOW") || type.includes("SLEET") || type.includes("ICE")) return "snow";
  if (type.includes("THUNDER") || type.includes("HAIL")) return "storms";
  if (type.includes("RAIN") || type.includes("DRIZZLE") || type.includes("SHOWER")) return "rain";
  if (type.includes("FOG") || type.includes("MIST") || type.includes("HAZE") || type.includes("SMOKE")) return "fog";
  if (type.includes("WIND") || type.includes("BREEZY")) return "wind";
  if (type.includes("PARTLY") || type.includes("MOSTLY_CLEAR")) return "partly-cloudy";
  if (type.includes("CLOUD") || type.includes("OVERCAST")) return "cloudy";
  if (type.includes("CLEAR") || type.includes("SUNNY")) return "clear";
  return "unknown";
}

function conditionValues(condition: GoogleCondition | undefined): {
  conditionKey: WeatherConditionKey;
  conditionText: string;
} {
  const rawType = stringValue(condition?.type);
  return {
    conditionKey: normalizeCondition(rawType),
    conditionText: stringValue(condition?.description?.text, titleFromEnum(rawType)),
  };
}

function normalizeCurrent(raw: GoogleCurrentResponse, units: WeatherUnits): NormalizedCurrentConditions {
  if (typeof raw.temperature?.degrees !== "number") {
    throw new GoogleWeatherError("Google Weather returned current conditions without a temperature.");
  }
  const condition = conditionValues(raw.weatherCondition);
  return {
    observedAt: toIso(raw.currentTime),
    timeZone: stringValue(raw.timeZone?.id, "UTC"),
    temperature: numberValue(raw.temperature.degrees),
    feelsLike: numberValue(raw.feelsLikeTemperature?.degrees, numberValue(raw.temperature.degrees)),
    temperatureUnit: temperatureUnit(raw.temperature.unit, units),
    ...condition,
    isDaytime: raw.isDaytime === true,
    humidity: percentValue(raw.relativeHumidity),
    precipitationProbability: percentValue(raw.precipitation?.probability?.percent),
    windDirection: stringValue(raw.wind?.direction?.cardinal, "UNKNOWN"),
    windDegrees: numberValue(raw.wind?.direction?.degrees),
    windSpeed: numberValue(raw.wind?.speed?.value),
    windGust: numberValue(raw.wind?.gust?.value),
    windSpeedUnit: speedUnit(raw.wind?.speed?.unit, units),
    visibility: numberValue(raw.visibility?.distance),
    visibilityUnit: visibilityUnit(raw.visibility?.unit, units),
    uvIndex: Math.max(0, numberValue(raw.uvIndex)),
    cloudCover: percentValue(raw.cloudCover),
    thunderstormProbability: percentValue(raw.thunderstormProbability),
  };
}

function normalizeHourlyItem(raw: GoogleForecastHour, units: WeatherUnits): NormalizedHourlyForecast | null {
  if (typeof raw.temperature?.degrees !== "number") return null;
  const startTime = optionalIso(raw.interval?.startTime);
  const endTime = optionalIso(raw.interval?.endTime);
  if (!startTime || !endTime) return null;
  const condition = conditionValues(raw.weatherCondition);
  return {
    startTime,
    endTime,
    temperature: raw.temperature.degrees,
    feelsLike: numberValue(raw.feelsLikeTemperature?.degrees, raw.temperature.degrees),
    temperatureUnit: temperatureUnit(raw.temperature.unit, units),
    precipitationProbability: optionalPercent(raw.precipitation?.probability?.percent),
    thunderstormProbability: optionalPercent(raw.thunderstormProbability),
    ...condition,
    isDaytime: raw.isDaytime === true,
    humidity: optionalPercent(raw.relativeHumidity),
    windSpeed: optionalNumber(raw.wind?.speed?.value),
    windGust: optionalNumber(raw.wind?.gust?.value),
    windSpeedUnit: speedUnit(raw.wind?.speed?.unit, units),
  };
}

function displayDate(raw: GoogleForecastDay): string | undefined {
  const year = raw.displayDate?.year;
  const month = raw.displayDate?.month;
  const day = raw.displayDate?.day;
  if (typeof year !== "number" || typeof month !== "number" || typeof day !== "number") return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDailyItem(raw: GoogleForecastDay, units: WeatherUnits): NormalizedDailyForecast | null {
  if (typeof raw.maxTemperature?.degrees !== "number" || typeof raw.minTemperature?.degrees !== "number") return null;
  const startTime = optionalIso(raw.interval?.startTime);
  const endTime = optionalIso(raw.interval?.endTime);
  const date = displayDate(raw) ?? startTime?.slice(0, 10);
  if (!startTime || !endTime || !date) return null;
  const daytime = conditionValues(raw.daytimeForecast?.weatherCondition);
  const nighttime = conditionValues(raw.nighttimeForecast?.weatherCondition);
  return {
    date,
    startTime,
    endTime,
    high: raw.maxTemperature.degrees,
    low: raw.minTemperature.degrees,
    temperatureUnit: temperatureUnit(raw.maxTemperature.unit, units),
    precipitationProbability: Math.max(
      percentValue(raw.daytimeForecast?.precipitation?.probability?.percent),
      percentValue(raw.nighttimeForecast?.precipitation?.probability?.percent),
    ),
    ...daytime,
    nighttimeConditionKey: nighttime.conditionKey,
    nighttimeConditionText: nighttime.conditionText,
    ...(optionalIso(raw.sunEvents?.sunriseTime) ? { sunriseTime: optionalIso(raw.sunEvents?.sunriseTime) } : {}),
    ...(optionalIso(raw.sunEvents?.sunsetTime) ? { sunsetTime: optionalIso(raw.sunEvents?.sunsetTime) } : {}),
  };
}

function alertSeverity(value: unknown): NormalizedAlertSeverity {
  const normalized = stringValue(value).toLocaleUpperCase("en-US");
  if (normalized === "MINOR" || normalized === "MODERATE" || normalized === "SEVERE" || normalized === "EXTREME") {
    return normalized.toLocaleLowerCase("en-US") as NormalizedAlertSeverity;
  }
  return "unknown";
}

function alertCertainty(value: unknown): NormalizedAlertCertainty {
  const normalized = stringValue(value).toLocaleUpperCase("en-US");
  const map: Record<string, NormalizedAlertCertainty> = {
    OBSERVED: "observed",
    VERY_LIKELY: "very-likely",
    LIKELY: "likely",
    POSSIBLE: "possible",
    UNLIKELY: "unlikely",
  };
  return map[normalized] ?? "unknown";
}

function alertUrgency(value: unknown): NormalizedAlertUrgency {
  const normalized = stringValue(value).toLocaleUpperCase("en-US");
  const map: Record<string, NormalizedAlertUrgency> = {
    IMMEDIATE: "immediate",
    EXPECTED: "expected",
    FUTURE: "future",
    PAST: "past",
  };
  return map[normalized] ?? "unknown";
}

function normalizeSafetyRecommendations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((recommendation) => {
    if (typeof recommendation !== "object" || recommendation === null) return [];
    const directive = stringValue((recommendation as { directive?: unknown }).directive);
    const subtext = stringValue((recommendation as { subtext?: unknown }).subtext);
    const combined = [directive, subtext].filter(Boolean).join(": ");
    return combined ? [combined] : [];
  });
}

function normalizeAlert(raw: GoogleAlert, index: number): NormalizedWeatherAlert | null {
  const title = stringValue(raw.alertTitle?.text);
  if (!title) return null;
  const start = optionalIso(raw.startTime);
  const expires = optionalIso(raw.expirationTime);
  const eventTypeCode = stringValue(raw.eventType, "WEATHER_EVENT_TYPE_UNSPECIFIED");
  const fallbackId = [eventTypeCode, start ?? "active", index].join("-");
  return {
    id: stringValue(raw.alertId, fallbackId),
    title,
    eventType: eventTypeCode.includes("_") ? titleFromEnum(eventTypeCode) : eventTypeCode,
    eventTypeCode,
    areaName: stringValue(raw.areaName, "Affected area"),
    description: stringValue(raw.description, title),
    instructions: Array.isArray(raw.instruction)
      ? raw.instruction.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [],
    safetyRecommendations: normalizeSafetyRecommendations(raw.safetyRecommendations),
    ...(start ? { startsAt: start } : {}),
    ...(expires ? { expiresAt: expires } : {}),
    severity: alertSeverity(raw.severity),
    certainty: alertCertainty(raw.certainty),
    urgency: alertUrgency(raw.urgency),
    ...(stringValue(raw.dataSource?.name, stringValue(raw.dataSource?.publisher))
      ? { sourceName: stringValue(raw.dataSource?.name, stringValue(raw.dataSource?.publisher)) }
      : {}),
    ...(stringValue(raw.dataSource?.publisher)
      ? { sourcePublisherCode: stringValue(raw.dataSource?.publisher) }
      : {}),
    ...(httpsUrl(raw.dataSource?.authorityUri)
      ? { sourceAuthorityUri: httpsUrl(raw.dataSource?.authorityUri) }
      : {}),
    ...(stringValue(raw.polygon) ? { polygon: stringValue(raw.polygon) } : {}),
  };
}

function weatherUrl(
  path: string,
  location: WeatherLocation,
  languageCode: string,
  units: WeatherUnits | undefined,
  extra: Record<string, string | number | undefined> = {},
): URL {
  const url = new URL(path, WEATHER_BASE_URL);
  url.searchParams.set("location.latitude", String(location.latitude));
  url.searchParams.set("location.longitude", String(location.longitude));
  url.searchParams.set("languageCode", languageCode);
  if (units) url.searchParams.set("unitsSystem", units === "imperial" ? "IMPERIAL" : "METRIC");
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  return url;
}

async function requestJson<T>(
  url: URL,
  resourceName: string,
  options: GoogleWeatherOptions,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = requiredApiKey(options.apiKey);
  // Header auth keeps the key out of URLs and URL-scanning logs:
  // https://docs.cloud.google.com/docs/authentication/api-keys-use#using_an_api_key_with_rest
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "X-Goog-Api-Key": apiKey },
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new GoogleWeatherError(`Google Weather ${resourceName} request could not be completed.`);
  }
  if (!response.ok) {
    throw new GoogleWeatherError(`Google Weather ${resourceName} request failed.`, response.status);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new GoogleWeatherError(`Google Weather ${resourceName} returned an invalid response.`, response.status);
  }
}

function cacheTtl(options: GoogleWeatherOptions): number {
  const requested = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  if (!Number.isFinite(requested)) return DEFAULT_CACHE_TTL_MS;
  return Math.min(MAX_CACHE_TTL_MS, Math.max(0, requested));
}

function weatherCacheKey(
  location: WeatherLocation,
  units: WeatherUnits,
  languageCode: string,
  hours: number,
  days: number,
): string {
  const placeId = location.placeId?.trim();
  const normalizedName = location.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const locationIdentity = placeId
    ? `place:${placeId}`
    : `location:${normalizedName}:${location.latitude.toFixed(COARSE_COORDINATE_DECIMALS)},${location.longitude.toFixed(COARSE_COORDINATE_DECIMALS)}`;
  return [locationIdentity, units, languageCode, hours, days].join("|");
}

function cacheLookup(key: string, now: number): CachedLocationWeather | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheStore(key: string, value: CachedLocationWeather, now: number, ttlMs: number): void {
  if (ttlMs <= 0) return;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { value, expiresAt: now + ttlMs });
}

async function fetchHourly(
  location: WeatherLocation,
  languageCode: string,
  units: WeatherUnits,
  hours: number,
  options: GoogleWeatherOptions,
): Promise<GoogleForecastHour[]> {
  const items: GoogleForecastHour[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;
  do {
    if (pageToken) {
      if (seenPageTokens.has(pageToken)) {
        throw new GoogleWeatherError("Google Weather hourly forecast returned a repeated page token.");
      }
      seenPageTokens.add(pageToken);
    }
    const pageSize = Math.min(24, hours - items.length);
    const url = weatherUrl("/v1/forecast/hours:lookup", location, languageCode, units, {
      hours,
      pageSize,
      pageToken,
    });
    const payload = await requestJson<GoogleHourlyResponse>(url, "hourly forecast", options);
    const page = Array.isArray(payload.forecastHours) ? (payload.forecastHours as GoogleForecastHour[]) : [];
    items.push(...page);
    pageToken = stringValue(payload.nextPageToken) || undefined;
  } while (pageToken && items.length < hours);
  return items.slice(0, hours);
}

async function fetchAlerts(
  location: WeatherLocation,
  languageCode: string,
  options: GoogleWeatherOptions,
): Promise<{ items: GoogleAlert[]; regionCode?: string }> {
  const items: GoogleAlert[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;
  let regionCode: string | undefined;
  do {
    if (pageToken) {
      if (seenPageTokens.has(pageToken)) {
        throw new GoogleWeatherError("Google Weather public alerts returned a repeated page token.");
      }
      seenPageTokens.add(pageToken);
    }
    const url = weatherUrl("/v1/publicAlerts:lookup", location, languageCode, undefined, {
      pageSize: 10,
      pageToken,
    });
    const payload = await requestJson<GoogleAlertsResponse>(url, "public alerts", options);
    const page = Array.isArray(payload.weatherAlerts) ? (payload.weatherAlerts as GoogleAlert[]) : [];
    items.push(...page);
    regionCode = regionCode ?? (stringValue(payload.regionCode) || undefined);
    pageToken = stringValue(payload.nextPageToken) || undefined;
  } while (pageToken);
  return { items, ...(regionCode ? { regionCode } : {}) };
}

export async function getGoogleWeatherBundle(
  location: WeatherLocation,
  options: GoogleWeatherOptions = {},
): Promise<LocationWeather> {
  assertLocation(location);
  requiredApiKey(options.apiKey);
  const units = options.units ?? "metric";
  const languageCode = (options.locale || options.languageCode || "en").trim() || "en";
  const hours = integerInRange(options.hours, 24, 1, 240, "hours");
  const days = integerInRange(options.days, 7, 1, 10, "days");
  const now = options.now?.() ?? Date.now();
  const ttlMs = cacheTtl(options);
  const key = weatherCacheKey(location, units, languageCode, hours, days);
  const cached = cacheLookup(key, now);
  if (cached) return { location: { ...location, name: location.name.trim() }, ...cached };

  const currentUrl = weatherUrl("/v1/currentConditions:lookup", location, languageCode, units);
  const dailyUrl = weatherUrl("/v1/forecast/days:lookup", location, languageCode, units, {
    days,
    pageSize: days,
  });

  const [currentRaw, hourlyRaw, dailyRaw, alertsRaw] = await Promise.all([
    requestJson<GoogleCurrentResponse>(currentUrl, "current conditions", options),
    fetchHourly(location, languageCode, units, hours, options),
    requestJson<GoogleDailyResponse>(dailyUrl, "daily forecast", options),
    fetchAlerts(location, languageCode, options),
  ]);

  const dailyItems = Array.isArray(dailyRaw.forecastDays) ? (dailyRaw.forecastDays as GoogleForecastDay[]) : [];
  const result: LocationWeather = {
    location: { ...location, name: location.name.trim() },
    units,
    fetchedAt: new Date(now).toISOString(),
    current: normalizeCurrent(currentRaw, units),
    hourly: hourlyRaw.flatMap((item) => {
      const normalized = normalizeHourlyItem(item, units);
      return normalized ? [normalized] : [];
    }),
    daily: dailyItems.flatMap((item) => {
      const normalized = normalizeDailyItem(item, units);
      return normalized ? [normalized] : [];
    }),
    alerts: alertsRaw.items.flatMap((item, index) => {
      const normalized = normalizeAlert(item, index);
      return normalized ? [normalized] : [];
    }),
    ...(alertsRaw.regionCode ? { alertRegionCode: alertsRaw.regionCode } : {}),
  };
  cacheStore(
    key,
    {
      units: result.units,
      fetchedAt: result.fetchedAt,
      current: result.current,
      hourly: result.hourly,
      daily: result.daily,
      alerts: result.alerts,
      ...(result.alertRegionCode ? { alertRegionCode: result.alertRegionCode } : {}),
    },
    now,
    ttlMs,
  );
  return result;
}

export async function getGoogleWeatherBundles(
  locations: readonly WeatherLocation[],
  options: GoogleWeatherOptions = {},
): Promise<LocationWeather[]> {
  if (locations.length > MAX_LOCATIONS) {
    throw new RangeError(`A maximum of ${MAX_LOCATIONS} locations is supported.`);
  }
  return Promise.all(locations.map((location) => getGoogleWeatherBundle(location, options)));
}

export async function getWeatherBundle(input: GetWeatherBundleInput): Promise<WeatherBundle> {
  if (input.locations.length > MAX_LOCATIONS) {
    throw new RangeError(`A maximum of ${MAX_LOCATIONS} locations is supported.`);
  }
  const fetchedAt = new Date(input.now?.() ?? Date.now()).toISOString();
  const locations = await getGoogleWeatherBundles(input.locations, input);
  return { locations, units: input.units, fetchedAt, attribution: GOOGLE_WEATHER_ATTRIBUTION };
}
