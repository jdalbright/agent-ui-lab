/* eslint-disable react-refresh/only-export-components */
import { createComponentImplementation } from "@a2ui/react/v0_9";
import {
  EvidenceListNodeSchema,
  ResearchLeadNodeSchema,
  SourceListNodeSchema,
  TimelineNodeSchema,
} from "@shared/schemas";
import { SourceAnchor, formatSourceDate, joinClassNames, sourceMap } from "./common";

const STANCE_LABELS = {
  support: "Supports",
  challenge: "Challenges",
  neutral: "Context",
} as const;

export const ResearchLead = createComponentImplementation(
  {
    name: "ResearchLead",
    schema: ResearchLeadNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const sourceIds = props.sourceIds as string[];
    const sources = sourceMap(context);
    const availableCount = sourceIds.filter((id) => sources.has(id)).length;
    return (
      <header
        className={joinClassNames(
          "a2ui-research-lead",
          `a2ui-research-lead--${props.variant ?? "feature"}`,
        )}
        data-variant={props.variant ?? "feature"}
      >
        <p className="a2ui-eyebrow">Grounded research</p>
        <h2>{props.title}</h2>
        <p>{props.summary}</p>
        <span className="a2ui-source-count">
          {availableCount} verified {availableCount === 1 ? "source" : "sources"}
        </span>
      </header>
    );
  },
);

export const EvidenceList = createComponentImplementation(
  {
    name: "EvidenceList",
    schema: EvidenceListNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const variant = props.variant ?? "stack";
    const sources = sourceMap(context);
    return (
      <section
        className={joinClassNames("a2ui-evidence", `a2ui-evidence--${variant}`)}
        data-variant={variant}
      >
        <h3 className="a2ui-section-title">{props.label}</h3>
        <ol>
          {props.items.map((item, index) => {
            const stance = item.stance ?? "neutral";
            return (
              <li key={`${item.title}-${index}`} data-stance={stance}>
                <span className="a2ui-evidence__number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  {variant === "for-against" || item.stance ? (
                    <span className="a2ui-evidence__stance">{STANCE_LABELS[stance]}</span>
                  ) : null}
                  <h4>{item.title}</h4>
                  <p>{item.finding}</p>
                  <SourceAnchor source={sources.get(item.sourceId)} prefix="Source: " />
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    );
  },
);

export const Timeline = createComponentImplementation(
  {
    name: "Timeline",
    schema: TimelineNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const sources = sourceMap(context);
    return (
      <section className="a2ui-timeline">
        <h3 className="a2ui-section-title">{props.label}</h3>
        <ol>
          {props.items.map((item, index) => (
            <li key={`${item.date}-${item.title}-${index}`}>
              <time>{item.date}</time>
              <div>
                <h4>{item.title}</h4>
                <p>{item.detail}</p>
                {item.sourceId ? (
                  <SourceAnchor source={sources.get(item.sourceId)} prefix="Source: " />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  },
);

export const SourceList = createComponentImplementation(
  {
    name: "SourceList",
    schema: SourceListNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const sourceIds = props.sourceIds as string[];
    const sources = sourceMap(context);
    const compact = props.label.toLowerCase().startsWith("weather data");
    return (
      <section className={compact ? "a2ui-sources a2ui-sources--compact" : "a2ui-sources"}>
        <h3 className="a2ui-section-title">{props.label}</h3>
        <ol>
          {sourceIds.map((sourceId) => {
            const source = sources.get(sourceId);
            return (
              <li key={sourceId}>
                <SourceAnchor source={source} />
                {source ? (
                  <p>
                    <span>{source.provider}</span>
                    <span aria-hidden="true"> · </span>
                    <span>Accessed {formatSourceDate(source.accessedAt)}</span>
                  </p>
                ) : null}
                {source?.snippet ? <p className="a2ui-sources__snippet">{source.snippet}</p> : null}
              </li>
            );
          })}
        </ol>
      </section>
    );
  },
);

export const researchComponents = [ResearchLead, EvidenceList, Timeline, SourceList] as const;
