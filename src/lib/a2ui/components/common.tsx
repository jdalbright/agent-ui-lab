/* eslint-disable react-refresh/only-export-components */
import type { ComponentContext } from "@a2ui/web_core/v0_9";
import type { SurfaceIcon } from "@shared/layout-tokens";
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

const SURFACE_ICON_PATHS: Readonly<Record<SurfaceIcon, string>> = {
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
  check: "M5 12.5 10 17l9-10",
  alert: "M12 4 2.8 19.5h18.4L12 4ZM12 10v4.5M12 17h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  "trend-up": "M3 17l6-6 4 4 8-8M15 7h6v6",
  "trend-down": "M3 7l6 6 4-4 8 8M15 17h6v-6",
  pin: "M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  star: "m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z",
  scale: "M12 4v16M7 20h10M4 8h16M6.5 8 3.5 14a3 3 0 0 0 6 0L6.5 8ZM17.5 8l-3 6a3 3 0 0 0 6 0l-3-6Z",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
};

/** Decorative icon chosen from the closed SURFACE_ICONS token set. */
export function SurfaceIconGlyph({ icon, className }: { icon?: SurfaceIcon; className?: string }) {
  if (!icon) return null;
  return (
    <svg
      className={joinClassNames("a2ui-icon", className)}
      data-icon={icon}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={SURFACE_ICON_PATHS[icon]} />
    </svg>
  );
}

/** Sources cited by a component, rendered as a compact trusted citation row. */
export function CitationRow({
  context,
  sourceIds,
}: {
  context: ComponentContext;
  sourceIds: readonly string[];
}) {
  const sources = sourceMap(context);
  const unique = [...new Set(sourceIds)];
  if (unique.length === 0) return null;
  return (
    <p className="a2ui-citations">
      <span className="a2ui-citations__label">Sources:</span>{" "}
      {unique.map((sourceId, index) => (
        <span key={sourceId}>
          {index > 0 ? " · " : null}
          <SourceAnchor source={sources.get(sourceId)} />
        </span>
      ))}
    </p>
  );
}
