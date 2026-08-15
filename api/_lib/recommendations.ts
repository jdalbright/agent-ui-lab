import type {
  NormalizedHourlyForecast,
  NormalizedWeatherAlert,
  WeatherBundle,
  WeatherLocation,
} from "./google-weather.js";

export type RecommendationConfidence = "high" | "medium" | "low";

export interface ActivityScoringOptions {
  alerts?: readonly NormalizedWeatherAlert[];
  idealTemperatureMin?: number;
  idealTemperatureMax?: number;
}

export interface ActivityWindowOptions extends ActivityScoringOptions {
  activity?: string;
  durationHours?: number;
  targetLocalTime?: string;
  targetDayOffset?: number;
  timeZone?: string;
  referenceTime?: string;
}

export interface ActivityWindowScore {
  score: number;
  confidence: RecommendationConfidence;
  reasons: string[];
}

export interface ActivityWindowRecommendation extends ActivityWindowScore {
  activity: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  label: string;
  detail: string;
}

export interface LocationActivityWindowRecommendation extends ActivityWindowRecommendation {
  location: WeatherLocation;
}

function confidenceForScore(score: number): RecommendationConfidence {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function alertOverlapsWindow(
  alert: NormalizedWeatherAlert,
  windowStart: number,
  windowEnd: number,
): boolean {
  if (alert.urgency === "past") return false;
  const alertStart = alert.startsAt ? Date.parse(alert.startsAt) : Number.NEGATIVE_INFINITY;
  const alertEnd = alert.expiresAt ? Date.parse(alert.expiresAt) : Number.POSITIVE_INFINITY;
  return alertStart < windowEnd && alertEnd > windowStart;
}

function uniqueReasons(reasons: string[]): string[] {
  return [...new Set(reasons)];
}

export function scoreActivityWindow(
  hours: readonly NormalizedHourlyForecast[],
  options: ActivityScoringOptions = {},
): ActivityWindowScore {
  if (hours.length === 0) return { score: 0, confidence: "low", reasons: ["No forecast data"] };

  const precipitationValues = hours.flatMap((hour) =>
    hour.precipitationProbability === null ? [] : [hour.precipitationProbability],
  );
  const thunderstormValues = hours.flatMap((hour) =>
    hour.thunderstormProbability === null ? [] : [hour.thunderstormProbability],
  );
  const windValues = hours.flatMap((hour) => (hour.windSpeed === null ? [] : [hour.windSpeed]));
  const gustValues = hours.flatMap((hour) => (hour.windGust === null ? [] : [hour.windGust]));
  const maximumPrecipitation = precipitationValues.length > 0 ? Math.max(...precipitationValues) : null;
  const maximumThunderstormProbability =
    thunderstormValues.length > 0 ? Math.max(...thunderstormValues) : null;
  const maximumWind = windValues.length > 0 ? Math.max(...windValues) : null;
  const maximumGust = gustValues.length > 0 ? Math.max(...gustValues) : null;
  const averageFeelsLike = hours.reduce((total, hour) => total + hour.feelsLike, 0) / hours.length;
  const isMetric = hours[0]?.temperatureUnit === "C";
  const idealMinimum = options.idealTemperatureMin ?? (isMetric ? 13 : 55);
  const idealMaximum = options.idealTemperatureMax ?? (isMetric ? 28 : 82);
  const conditions = new Set(hours.map((hour) => hour.conditionKey));
  const reasons: string[] = [];
  let score = 100;
  let incomplete = false;
  let incompleteSafetyData = false;

  if (precipitationValues.length !== hours.length) {
    score -= 20;
    incomplete = true;
    incompleteSafetyData = true;
  }
  if (maximumPrecipitation !== null) {
    score -= maximumPrecipitation * 0.45;
    if (maximumPrecipitation <= 15) reasons.push("Low precipitation risk");
    else if (maximumPrecipitation >= 60) reasons.push("High precipitation risk");
    else if (maximumPrecipitation >= 30) reasons.push("Possible precipitation");
  }

  if (thunderstormValues.length !== hours.length) {
    score -= 15;
    incomplete = true;
    incompleteSafetyData = true;
  }
  if (maximumThunderstormProbability !== null && maximumThunderstormProbability >= 60) {
    score -= 45;
    reasons.push("High thunderstorm risk");
  } else if (maximumThunderstormProbability !== null && maximumThunderstormProbability >= 30) {
    score -= 25;
    reasons.push("Elevated thunderstorm risk");
  } else if (maximumThunderstormProbability !== null && maximumThunderstormProbability >= 15) {
    score -= 10;
    reasons.push("Some thunderstorm risk");
  }

  if (averageFeelsLike < idealMinimum) {
    score -= Math.min(25, (idealMinimum - averageFeelsLike) * 1.5);
    reasons.push("Cooler than ideal");
  } else if (averageFeelsLike > idealMaximum) {
    score -= Math.min(25, (averageFeelsLike - idealMaximum) * 1.5);
    reasons.push("Warmer than ideal");
  } else {
    reasons.push("Comfortable temperature");
  }

  if (conditions.has("storms")) {
    score -= 45;
    reasons.push("Thunderstorms possible");
  } else if (conditions.has("snow")) {
    score -= 35;
    reasons.push("Snow or ice possible");
  } else if (conditions.has("rain")) {
    score -= 20;
    reasons.push("Rain possible");
  } else if (conditions.has("fog")) {
    score -= 15;
    reasons.push("Reduced visibility possible");
  } else if (conditions.has("wind")) {
    score -= 12;
    reasons.push("Windy conditions");
  } else if (conditions.has("unknown")) {
    score -= 15;
    incomplete = true;
  }

  const highWindThreshold = isMetric ? 24 : 15;
  const highGustThreshold = isMetric ? 32 : 20;
  if (windValues.length !== hours.length || gustValues.length !== hours.length) {
    score -= 10;
    incomplete = true;
    incompleteSafetyData = true;
  }
  if (maximumWind !== null && maximumWind > highWindThreshold) {
    const unitScale = isMetric ? 0.75 : 1.2;
    score -= Math.min(25, (maximumWind - highWindThreshold) * unitScale);
    reasons.push("Strong sustained wind");
  }
  if (maximumGust !== null && maximumGust > highGustThreshold) {
    const unitScale = isMetric ? 0.9 : 1.5;
    score -= Math.min(20, (maximumGust - highGustThreshold) * unitScale);
    reasons.push("Strong gusts possible");
  } else if (
    windValues.length === hours.length &&
    gustValues.length === hours.length &&
    maximumWind !== null &&
    maximumWind <= highWindThreshold
  ) {
    reasons.push("Light wind");
  }

  if (hours.some((hour) => hour.humidity === null)) {
    score -= 5;
    incomplete = true;
  }
  if (incomplete) reasons.push("Incomplete forecast data");

  if (hours.every((hour) => hour.isDaytime)) reasons.push("Daylight");
  else score -= 8;

  const windowStart = Date.parse(hours[0].startTime);
  const windowEnd = Date.parse(hours[hours.length - 1].endTime);
  const overlappingAlerts = (options.alerts ?? []).filter((alert) =>
    alertOverlapsWindow(alert, windowStart, windowEnd),
  );
  const severityPenalty: Record<NormalizedWeatherAlert["severity"], number> = {
    extreme: 60,
    severe: 45,
    moderate: 25,
    minor: 10,
    unknown: 5,
  };
  const highestAlertPenalty = overlappingAlerts.reduce(
    (maximum, alert) => Math.max(maximum, severityPenalty[alert.severity]),
    0,
  );
  if (highestAlertPenalty > 0) {
    score -= highestAlertPenalty;
    const hasSevereAlert = overlappingAlerts.some(
      (alert) => alert.severity === "severe" || alert.severity === "extreme",
    );
    reasons.push(hasSevereAlert ? "Active severe weather alert" : "Active weather alert");
  }

  const roundedScore = Math.round(Math.min(100, Math.max(0, score)));
  const scoreConfidence = confidenceForScore(roundedScore);
  const confidence = incompleteSafetyData
    ? "low"
    : incomplete && scoreConfidence === "high"
      ? "medium"
      : scoreConfidence;
  return {
    score: roundedScore,
    confidence,
    reasons: uniqueReasons(reasons),
  };
}

function isConsecutiveWindow(hours: readonly NormalizedHourlyForecast[]): boolean {
  for (let index = 1; index < hours.length; index += 1) {
    if (Date.parse(hours[index - 1].endTime) !== Date.parse(hours[index].startTime)) return false;
  }
  return true;
}

interface LocalDateTime {
  date: string;
  hour: number;
}

function localDateTime(instant: string, timeZone: string): LocalDateTime {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError("referenceTime must be a valid timestamp.");
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    throw new RangeError("timeZone must be a valid IANA time zone.");
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  const hour = Number(part("hour"));
  if (![year, month, day, hour].every(Number.isInteger)) {
    throw new RangeError("Unable to resolve the requested local time.");
  }
  return {
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    hour,
  };
}

function addLocalCalendarDays(date: string, offset: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + offset));
  return target.toISOString().slice(0, 10);
}

interface RequestedActivityDate {
  date: string;
  referenceTimestamp: number;
  timeZone: string;
}

function requestedActivityDate(options: ActivityWindowOptions): RequestedActivityDate | null {
  if (
    options.targetDayOffset === undefined ||
    !Number.isInteger(options.targetDayOffset) ||
    options.targetDayOffset < 0 ||
    options.targetDayOffset > 9
  ) {
    throw new RangeError("targetDayOffset must be an integer from 0 through 9.");
  }
  if (!options.timeZone || !options.referenceTime) return null;
  const referenceLocal = localDateTime(options.referenceTime, options.timeZone);
  return {
    date: addLocalCalendarDays(referenceLocal.date, options.targetDayOffset),
    referenceTimestamp: Date.parse(options.referenceTime),
    timeZone: options.timeZone,
  };
}

function requestedActivityWindow(
  sortedHours: readonly NormalizedHourlyForecast[],
  options: ActivityWindowOptions,
  activity: string,
  durationHours: number,
  requestedDate: RequestedActivityDate,
): ActivityWindowRecommendation | null {
  if (!options.targetLocalTime) return null;
  const timeMatch = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(options.targetLocalTime);
  if (!timeMatch) throw new RangeError("targetLocalTime must use 24-hour HH:MM format.");
  const [targetHour, targetMinute] = options.targetLocalTime.split(":").map(Number);
  const startIndex = sortedHours.findIndex((hour) => {
    const local = localDateTime(hour.startTime, requestedDate.timeZone);
    return local.date === requestedDate.date && local.hour === targetHour;
  });
  if (startIndex < 0) return null;

  const forecastHoursRequired = durationHours + (targetMinute > 0 ? 1 : 0);
  const candidateHours = sortedHours.slice(startIndex, startIndex + forecastHoursRequired);
  if (candidateHours.length !== forecastHoursRequired || !isConsecutiveWindow(candidateHours)) return null;

  const candidateScore = scoreActivityWindow(candidateHours, options);
  const startTimestamp = Date.parse(candidateHours[0].startTime) + targetMinute * 60 * 1_000;
  const endTimestamp = startTimestamp + durationHours * 60 * 60 * 1_000;
  return {
    activity,
    startTime: new Date(startTimestamp).toISOString(),
    endTime: new Date(endTimestamp).toISOString(),
    durationHours,
    ...candidateScore,
    label: `${durationHours}-hour ${activity} window at requested time`,
    detail: candidateScore.reasons.join(" · "),
  };
}

export function recommendActivityWindow(
  hours: readonly NormalizedHourlyForecast[],
  options: ActivityWindowOptions = {},
): ActivityWindowRecommendation | null {
  const durationHours = options.durationHours ?? 2;
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 6) {
    throw new RangeError("durationHours must be an integer from 1 through 6.");
  }
  const activity = options.activity?.trim() || "outdoor activity";
  const sortedHours = [...hours].sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
  let requestedDate: RequestedActivityDate | undefined;
  if (options.targetDayOffset !== undefined) {
    const resolvedDate = requestedActivityDate(options);
    if (!resolvedDate) return null;
    requestedDate = resolvedDate;
  }
  if (options.targetLocalTime) {
    if (!requestedDate) {
      throw new RangeError("targetDayOffset must be an integer from 0 through 9.");
    }
    return requestedActivityWindow(sortedHours, options, activity, durationHours, requestedDate);
  }
  let best: ActivityWindowRecommendation | null = null;

  for (let index = 0; index <= sortedHours.length - durationHours; index += 1) {
    const candidateHours = sortedHours.slice(index, index + durationHours);
    if (!isConsecutiveWindow(candidateHours)) continue;
    if (
      requestedDate &&
      Date.parse(candidateHours[0].startTime) < requestedDate.referenceTimestamp
    ) {
      continue;
    }
    if (
      requestedDate &&
      candidateHours.some(
        (hour) => localDateTime(hour.startTime, requestedDate.timeZone).date !== requestedDate.date,
      )
    ) {
      continue;
    }
    const candidateScore = scoreActivityWindow(candidateHours, options);
    const startTime = candidateHours[0].startTime;
    const endTime = candidateHours[candidateHours.length - 1].endTime;
    const candidate: ActivityWindowRecommendation = {
      activity,
      startTime,
      endTime,
      durationHours,
      ...candidateScore,
      label: `Best ${durationHours}-hour ${activity} window`,
      detail: candidateScore.reasons.join(" · "),
    };
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && Date.parse(candidate.startTime) < Date.parse(best.startTime))
    ) {
      best = candidate;
    }
  }
  return best;
}

export function recommendWalkWindow(
  hours: readonly NormalizedHourlyForecast[],
  options: Omit<ActivityWindowOptions, "activity"> = {},
): ActivityWindowRecommendation | null {
  return recommendActivityWindow(hours, { ...options, activity: "walk" });
}

export function scoreActivityWindows(
  bundle: WeatherBundle,
  activityOrOptions: string | ActivityWindowOptions = "walk",
): LocationActivityWindowRecommendation[] {
  const options =
    typeof activityOrOptions === "string"
      ? { activity: activityOrOptions }
      : { ...activityOrOptions };
  return bundle.locations.flatMap((locationWeather) => {
    const recommendation = recommendActivityWindow(locationWeather.hourly, {
      ...options,
      activity: options.activity ?? "walk",
      durationHours: options.durationHours ?? 2,
      alerts: locationWeather.alerts,
      ...(options.targetLocalTime || options.targetDayOffset !== undefined
        ? {
            timeZone: locationWeather.current.timeZone,
            referenceTime: locationWeather.current.observedAt,
          }
        : {}),
    });
    return recommendation ? [{ location: locationWeather.location, ...recommendation }] : [];
  });
}
