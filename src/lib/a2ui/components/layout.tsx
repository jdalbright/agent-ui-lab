/* eslint-disable react-refresh/only-export-components */
import { createComponentImplementation } from "@a2ui/react/v0_9";
import {
  BandNodeSchema,
  DividerNodeSchema,
  EditorialHeadingNodeSchema,
  MetricNodeSchema,
  RailNodeSchema,
  SplitNodeSchema,
  TextBlockNodeSchema,
} from "@shared/schemas";
import { joinClassNames } from "./common";

export const EditorialHeading = createComponentImplementation(
  {
    name: "EditorialHeading",
    schema: EditorialHeadingNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) => {
    const Heading = props.level;
    return (
      <Heading
        className={joinClassNames(
          "a2ui-heading",
          `a2ui-heading--${props.level}`,
          props.align === "center" && "a2ui-heading--center",
        )}
      >
        {props.text}
      </Heading>
    );
  },
);

export const TextBlock = createComponentImplementation(
  {
    name: "TextBlock",
    schema: TextBlockNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) => (
    <p className={joinClassNames("a2ui-text", `a2ui-text--${props.tone}`)}>{props.text}</p>
  ),
);

export const Metric = createComponentImplementation(
  {
    name: "Metric",
    schema: MetricNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) => (
    <dl className={joinClassNames("a2ui-metric", `a2ui-metric--${props.accent}`)}>
      <dt className="a2ui-metric__label">{props.label}</dt>
      <dd className="a2ui-metric__value">{props.value}</dd>
      {props.detail ? <dd className="a2ui-metric__detail">{props.detail}</dd> : null}
    </dl>
  ),
);

export const Band = createComponentImplementation(
  {
    name: "Band",
    schema: BandNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild, context }) => {
    const childIds = props.children as string[];
    const labelId = props.label ? `${context.componentModel.id}-label` : undefined;
    return (
      <section
        className={joinClassNames("a2ui-band", `a2ui-band--${props.tone}`)}
        aria-labelledby={labelId}
      >
        {props.label ? (
          <h3 id={labelId} className="a2ui-eyebrow">
            {props.label}
          </h3>
        ) : null}
        <div className="a2ui-band__content">
          {childIds.map((childId) => buildChild(childId))}
        </div>
      </section>
    );
  },
);

export const Split = createComponentImplementation(
  {
    name: "Split",
    schema: SplitNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild }) => {
    const childIds = props.children as string[];
    return (
      <div className={joinClassNames("a2ui-split", `a2ui-split--${props.ratio}`)}>
        {childIds.map((childId) => (
          <div className="a2ui-split__pane" key={childId}>
            {buildChild(childId)}
          </div>
        ))}
      </div>
    );
  },
);

export const Rail = createComponentImplementation(
  {
    name: "Rail",
    schema: RailNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild, context }) => {
    const childIds = props.children as string[];
    const labelId = props.label ? `${context.componentModel.id}-label` : undefined;
    return (
      <section className="a2ui-rail" aria-labelledby={labelId}>
        {props.label ? (
          <h3 id={labelId} className="a2ui-section-title">
            {props.label}
          </h3>
        ) : null}
        <div
          className="a2ui-rail__track"
          role="region"
          aria-label={props.label ?? "Scrollable highlights"}
          tabIndex={0}
        >
          {childIds.map((childId) => (
            <div className="a2ui-rail__item" key={childId}>
              {buildChild(childId)}
            </div>
          ))}
        </div>
      </section>
    );
  },
);

export const Divider = createComponentImplementation(
  {
    name: "Divider",
    schema: DividerNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) =>
    props.label ? (
      <div className="a2ui-divider" role="separator" aria-label={props.label}>
        <span>{props.label}</span>
      </div>
    ) : (
      <hr className="a2ui-divider a2ui-divider--plain" />
    ),
);

export const layoutComponents = [
  EditorialHeading,
  TextBlock,
  Metric,
  Band,
  Split,
  Rail,
  Divider,
] as const;
