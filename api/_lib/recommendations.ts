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
  let best: ActivityWindowRecommendation | null = null;

  for (let index = 0; index <= sortedHours.length - durationHours; index += 1) {
    const candidateHours = sortedHours.slice(index, index + durationHours);
    if (!isConsecutiveWindow(candidateHours)) continue;
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
  activity = "walk",
): LocationActivityWindowRecommendation[] {
  return bundle.locations.flatMap((locationWeather) => {
    const recommendation = recommendActivityWindow(locationWeather.hourly, {
      activity,
      durationHours: 2,
      alerts: locationWeather.alerts,
    });
    return recommendation ? [{ location: locationWeather.location, ...recommendation }] : [];
  });
}
