/* eslint-disable react-refresh/only-export-components */
import type { ComponentContext } from "@a2ui/web_core/v0_9";
import { SourceRecordSchema, type SourceRecord } from "@shared/schemas";

export function joinClassNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export function readTrustedSources(context: ComponentContext): readonly SourceRecord[] {
  const result = SourceRecordSchema.array().safeParse(context.dataContext.dataModel.get("/sources"));
  return result.success ? result.data : [];
}

export function sourceMap(context: ComponentContext): ReadonlyMap<string, SourceRecord> {
  return new Map(readTrustedSources(context).map((source) => [source.id, source]));
}

export function formatSourceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Access date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function SourceAnchor({ source, prefix }: { source?: SourceRecord; prefix?: string }) {
  if (!source) return <span className="a2ui-source-missing">Source unavailable</span>;

  return (
    <a
      className="a2ui-source-link"
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {prefix}
      {source.title}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

export function WeatherGlyph({ condition }: { condition: string }) {
  const glyph = (() => {
    switch (condition) {
      case "clear":
        return (
          <>
            <circle className="a2ui-weather-glyph__sun" cx="32" cy="32" r="10" />
            <path className="a2ui-weather-glyph__sun" d="M32 8v8M32 48v8M8 32h8M48 32h8M15 15l6 6M43 43l6 6M49 15l-6 6M21 43l-6 6" />
          </>
        );
      case "rain":
      case "storms":
        return (
          <>
            <path d="M18 42h29a10 10 0 0 0 0-20 16 16 0 0 0-30-2A11 11 0 0 0 18 42Z" />
            <path d="m23 48-3 7M34 48l-3 7M45 48l-3 7" />
          </>
        );
      case "snow":
        return (
          <>
            <path d="M18 39h29a10 10 0 0 0 0-20 16 16 0 0 0-30-2A11 11 0 0 0 18 39Z" />
            <path d="M22 50h.01M34 50h.01M46 50h.01" />
          </>
        );
      case "wind":
        return <path d="M10 24h30c8 0 8-11 1-11-4 0-6 3-6 6M10 34h38c8 0 8 11 1 11-4 0-6-3-6-6M10 44h22" />;
      case "fog":
        return <path d="M10 23h44M15 32h36M9 41h46M17 50h30" />;
      default:
        return (
          <>
            <circle className="a2ui-weather-glyph__sun" cx="25" cy="28" r="10" />
            <path className="a2ui-weather-glyph__sun" d="M25 9v6M10 13l5 5M6 28h7" />
            <path d="M36 38h13a8 8 0 0 0 0-16 12 12 0 0 0-22 2" />
          </>
        );
    }
  })();

  return (
    <svg className="a2ui-weather-glyph" viewBox="0 0 64 64" aria-hidden="true">
      {glyph}
    </svg>
  );
}

export function temperatureLabel(value: number, unit: "F" | "C"): string {
  return `${Math.round(value)}°${unit}`;
}
