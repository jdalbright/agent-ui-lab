/* eslint-disable react-refresh/only-export-components */
import { createComponentImplementation } from "@a2ui/react/v0_9";
import {
  BadgeRowNodeSchema,
  CalloutNodeSchema,
  KeyFactsNodeSchema,
  ProsConsNodeSchema,
  PullQuoteNodeSchema,
  RankedListNodeSchema,
  ScoreMeterNodeSchema,
} from "@shared/schemas";
import { CitationRow, joinClassNames, SourceAnchor, sourceMap, SurfaceIconGlyph } from "./common";

const TREND_LABEL = { up: "Trending up", down: "Trending down", flat: "Holding steady" } as const;
const TREND_GLYPH = { up: "↑", down: "↓", flat: "→" } as const;

export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const width = 96;
  const height = 28;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * (width - 4) + 2;
      const y = height - 2 - ((value - minimum) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="a2ui-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label} trend: ${values.join(", ")}`}
    >
      <polyline points={points} />
    </svg>
  );
}

export const KeyFacts = createComponentImplementation(
  {
    name: "KeyFacts",
    schema: KeyFactsNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const labelId = props.label ? `${context.componentModel.id}-label` : undefined;
    return (
      <section className="a2ui-key-facts" aria-labelledby={labelId} aria-label={labelId ? undefined : "Key facts"}>
        {props.label ? (
          <h3 className="a2ui-section-title" id={labelId}>
            {props.label}
          </h3>
        ) : null}
        <dl className="a2ui-key-facts__grid">
          {props.facts.map((fact) => (
            <div className="a2ui-key-facts__item" key={fact.label}>
              <dt className="a2ui-key-facts__label">{fact.label}</dt>
              <dd className="a2ui-key-facts__value">
                {fact.value}
                {fact.trend ? (
                  <span
                    className={`a2ui-key-facts__trend a2ui-key-facts__trend--${fact.trend}`}
                    aria-label={TREND_LABEL[fact.trend]}
                    role="img"
                  >
                    {TREND_GLYPH[fact.trend]}
                  </span>
                ) : null}
              </dd>
              {fact.sparkline ? (
                <dd className="a2ui-key-facts__spark">
                  <Sparkline values={fact.sparkline} label={fact.label} />
                </dd>
              ) : null}
              {fact.detail ? <dd className="a2ui-key-facts__detail">{fact.detail}</dd> : null}
            </div>
          ))}
        </dl>
        <CitationRow context={context} sourceIds={props.sourceIds as string[]} />
      </section>
    );
  },
);

export const Callout = createComponentImplementation(
  {
    name: "Callout",
    schema: CalloutNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const titleId = `${context.componentModel.id}-title`;
    const icon = props.icon ?? (props.tone === "caution" ? "alert" : props.tone === "positive" ? "check" : "info");
    return (
      <aside
        className={joinClassNames("a2ui-callout", `a2ui-callout--${props.tone}`)}
        aria-labelledby={titleId}
      >
        <SurfaceIconGlyph icon={icon} className="a2ui-callout__icon" />
        <div className="a2ui-callout__body">
          <h3 className="a2ui-callout__title" id={titleId}>
            {props.title}
          </h3>
          <p>{props.body}</p>
          <CitationRow context={context} sourceIds={props.sourceIds as string[]} />
        </div>
      </aside>
    );
  },
);

export const ProsCons = createComponentImplementation(
  {
    name: "ProsCons",
    schema: ProsConsNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const sources = sourceMap(context);
    const titleId = `${context.componentModel.id}-title`;
    const column = (kind: "pros" | "cons", heading: string) => (
      <div className={`a2ui-pros-cons__column a2ui-pros-cons__column--${kind}`}>
        <h4>{heading}</h4>
        <ul>
          {props[kind].map((point) => (
            <li key={point.text}>
              <span>{point.text}</span> <SourceAnchor source={sources.get(point.sourceId)} prefix="Source: " />
            </li>
          ))}
        </ul>
      </div>
    );
    return (
      <section className="a2ui-pros-cons" aria-labelledby={titleId}>
        <h3 className="a2ui-section-title" id={titleId}>
          {props.subject}
        </h3>
        <div className="a2ui-pros-cons__grid">
          {column("pros", "Strengths")}
          {column("cons", "Trade-offs")}
        </div>
      </section>
    );
  },
);

export const RankedList = createComponentImplementation(
  {
    name: "RankedList",
    schema: RankedListNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const sources = sourceMap(context);
    const titleId = `${context.componentModel.id}-title`;
    return (
      <section className="a2ui-ranked" aria-labelledby={titleId}>
        <h3 className="a2ui-section-title" id={titleId}>
          {props.label}
        </h3>
        <ol className="a2ui-ranked__list" data-order={props.order}>
          {props.items.map((item) => (
            <li className="a2ui-ranked__item" key={item.title}>
              <div className="a2ui-ranked__heading">
                <strong>{item.title}</strong>
                {item.score ? <span className="a2ui-ranked__score">{item.score}</span> : null}
              </div>
              <p>{item.detail}</p>
              <SourceAnchor source={sources.get(item.sourceId)} prefix="Source: " />
            </li>
          ))}
        </ol>
      </section>
    );
  },
);

export const ScoreMeter = createComponentImplementation(
  {
    name: "ScoreMeter",
    schema: ScoreMeterNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const labelId = props.label ? `${context.componentModel.id}-label` : undefined;
    return (
      <section className="a2ui-meters" aria-labelledby={labelId} aria-label={labelId ? undefined : "Scores"}>
        {props.label ? (
          <h3 className="a2ui-section-title" id={labelId}>
            {props.label}
          </h3>
        ) : null}
        <ul className="a2ui-meters__list">
          {props.meters.map((meter) => {
            const percent = ((meter.value - meter.min) / (meter.max - meter.min)) * 100;
            const valueText = `${meter.value}${meter.unit ? ` ${meter.unit}` : ""} of ${meter.max}${meter.unit ? ` ${meter.unit}` : ""}`;
            return (
              <li className="a2ui-meters__item" key={meter.label}>
                <div className="a2ui-meters__heading">
                  <span>{meter.label}</span>
                  <span className="a2ui-meters__value">{valueText}</span>
                </div>
                <div
                  className="a2ui-meters__track"
                  role="meter"
                  aria-label={meter.label}
                  aria-valuemin={meter.min}
                  aria-valuemax={meter.max}
                  aria-valuenow={meter.value}
                  aria-valuetext={valueText}
                >
                  <span className="a2ui-meters__fill" style={{ inlineSize: `${percent.toFixed(1)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        <CitationRow context={context} sourceIds={props.sourceIds as string[]} />
      </section>
    );
  },
);

export const PullQuote = createComponentImplementation(
  {
    name: "PullQuote",
    schema: PullQuoteNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const source = sourceMap(context).get(props.sourceId);
    return (
      <figure className="a2ui-pull-quote">
        <blockquote>
          <p>{props.text}</p>
        </blockquote>
        <figcaption>
          {props.attribution} · <SourceAnchor source={source} />
        </figcaption>
      </figure>
    );
  },
);

export const BadgeRow = createComponentImplementation(
  {
    name: "BadgeRow",
    schema: BadgeRowNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => (
    <div className="a2ui-badges">
      {props.label ? <p className="a2ui-eyebrow">{props.label}</p> : null}
      <ul className="a2ui-badges__list" aria-label={props.label ?? "Tags"}>
        {props.badges.map((badge) => (
          <li className={`a2ui-badge a2ui-badge--${badge.tone}`} key={badge.label}>
            {badge.label}
          </li>
        ))}
      </ul>
      <CitationRow context={context} sourceIds={props.sourceIds as string[]} />
    </div>
  ),
);

export const insightComponents = [
  KeyFacts,
  Callout,
  ProsCons,
  RankedList,
  ScoreMeter,
  PullQuote,
  BadgeRow,
] as const;
