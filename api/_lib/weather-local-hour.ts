import {
  WEATHER_WEEKDAYS,
  parseWeatherRequestIntent,
  type WeatherRequestIntent,
  type WeatherWeekday,
} from "./weather-request-intent.js";

export interface WeatherLocalHourLocation {
  readonly current: {
    readonly observedAt: string;
    readonly timeZone: string;
  };
  readonly hourly: readonly {
    readonly startTime: string;
  }[];
}

export interface WeatherLocalHourCoverage {
  readonly locationIndex: number;
  readonly indexes: readonly number[];
}

interface LocalDateTime {
  readonly ordinal: number;
  readonly minutes: number;
  readonly weekday: WeatherWeekday;
}

function localDateTime(value: string, timeZone: string): LocalDateTime | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(date);
    const numberPart = (type: Intl.DateTimeFormatPartTypes): number | undefined => {
      const valuePart = Number(parts.find((part) => part.type === type)?.value);
      return Number.isFinite(valuePart) ? valuePart : undefined;
    };
    const year = numberPart("year");
    const month = numberPart("month");
    const day = numberPart("day");
    const hour = numberPart("hour");
    const minute = numberPart("minute");
    const weekday = parts
      .find((part) => part.type === "weekday")
      ?.value.toLocaleLowerCase("en-US") as WeatherWeekday | undefined;
    if (
      year === undefined ||
      month === undefined ||
      day === undefined ||
      hour === undefined ||
      minute === undefined ||
      !weekday ||
      !WEATHER_WEEKDAYS.includes(weekday)
    ) {
      return undefined;
    }
    return {
      ordinal: Math.floor(Date.UTC(year, month - 1, day) / 86_400_000),
      minutes: hour * 60 + minute,
      weekday,
    };
  } catch {
    return undefined;
  }
}

function requestedMinutes(localTime: string | undefined): number | undefined {
  if (!localTime) return undefined;
  const match = /^(\d{1,2}):([0-5]\d)\s+(AM|PM)$/i.exec(localTime);
  if (!match) return undefined;
  let hour = Number(match[1]) % 12;
  if (match[3].toLocaleUpperCase("en-US") === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

function weekdayOffset(from: WeatherWeekday, to: WeatherWeekday): number {
  const fromIndex = WEATHER_WEEKDAYS.indexOf(from);
  const toIndex = WEATHER_WEEKDAYS.indexOf(to);
  return (toIndex - fromIndex + WEATHER_WEEKDAYS.length) % WEATHER_WEEKDAYS.length;
}

function offsetsForIntent(
  intent: WeatherRequestIntent,
  observedWeekday: WeatherWeekday,
): readonly number[] | undefined {
  if (intent.relativeDayOffsets.length > 0) return intent.relativeDayOffsets;
  if (intent.throughWeekday) {
    const lastOffset = weekdayOffset(observedWeekday, intent.throughWeekday);
    return Array.from({ length: lastOffset + 1 }, (_, index) => index);
  }
  if (intent.weekdaySpan) {
    const firstOffset = weekdayOffset(observedWeekday, intent.weekdaySpan.start);
    const spanLength = weekdayOffset(intent.weekdaySpan.start, intent.weekdaySpan.end);
    return Array.from({ length: spanLength + 1 }, (_, index) => firstOffset + index);
  }
  if (intent.weekend) {
    const saturdayOffset = weekdayOffset(observedWeekday, "saturday");
    return [saturdayOffset, saturdayOffset + 1];
  }
  if (intent.forecastDays) {
    return Array.from({ length: intent.forecastDays }, (_, index) => index);
  }
  return undefined;
}

function firstIndexesForNamedWeekdays(
  candidates: readonly { index: number; local: LocalDateTime }[],
  weekdays: readonly WeatherWeekday[],
  minimumOrdinal: number,
): number[] {
  return weekdays.flatMap((weekday) => {
    const match = candidates.find(
      (candidate) =>
        candidate.local.weekday === weekday && candidate.local.ordinal >= minimumOrdinal,
    );
    return match ? [match.index] : [];
  });
}

export function requestedLocalHourCoverage(
  prompt: string,
  locations: readonly WeatherLocalHourLocation[],
): readonly WeatherLocalHourCoverage[] {
  const intent = parseWeatherRequestIntent(prompt);
  const minutes = requestedMinutes(intent.localTime);
  if (minutes === undefined) return [];

  return locations.flatMap((location, locationIndex) => {
    const observed = localDateTime(location.current.observedAt, location.current.timeZone);
    if (!observed) return [];
    const candidates = location.hourly.flatMap((hour, index) => {
      const local = localDateTime(hour.startTime, location.current.timeZone);
      return local?.minutes === minutes ? [{ index, local }] : [];
    });
    let indexes: number[];
    const offsets = offsetsForIntent(intent, observed.weekday);
    if (offsets) {
      const ordinals = new Set(offsets.map((offset) => observed.ordinal + offset));
      indexes = candidates
        .filter((candidate) => ordinals.has(candidate.local.ordinal))
        .map((candidate) => candidate.index);
    } else if (intent.nextWeekday) {
      indexes = firstIndexesForNamedWeekdays(
        candidates,
        [intent.nextWeekday],
        observed.ordinal + 1,
      );
    } else if (intent.namedWeekdays.length > 0) {
      indexes = firstIndexesForNamedWeekdays(
        candidates,
        intent.namedWeekdays,
        observed.ordinal,
      );
    } else {
      const next = candidates.find((candidate) => candidate.local.ordinal >= observed.ordinal);
      indexes = next ? [next.index] : [];
    }
    return indexes.length > 0 ? [{ locationIndex, indexes: [...new Set(indexes)].slice(0, 24) }] : [];
  });
}
