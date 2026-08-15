/* eslint-disable react-refresh/only-export-components */
import { useState, type KeyboardEvent } from "react";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import {
  BandNodeSchema,
  CardNodeSchema,
  DisclosureNodeSchema,
  DividerNodeSchema,
  EditorialHeadingNodeSchema,
  GridNodeSchema,
  MetricNodeSchema,
  RailNodeSchema,
  SectionNodeSchema,
  SplitNodeSchema,
  StackNodeSchema,
  SurfaceFrameNodeSchema,
  TabsNodeSchema,
  TextBlockNodeSchema,
} from "@shared/schemas";
import { joinClassNames } from "./common";

export const SurfaceFrame = createComponentImplementation(
  {
    name: "SurfaceFrame",
    schema: SurfaceFrameNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild }) => {
    const childIds = props.children as string[];
    return (
      <div
        className="a2ui-surface-frame"
        data-recipe={props.recipeId}
        data-composition-mode={props.compositionMode}
        data-archetype={props.archetypeHint}
        data-density={props.density}
        data-emphasis={props.emphasis}
      >
        {childIds.map((childId) => (
          <div className="a2ui-surface-frame__module" key={childId}>
            {buildChild(childId)}
          </div>
        ))}
      </div>
    );
  },
);

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

export const Stack = createComponentImplementation(
  {
    name: "Stack",
    schema: StackNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild }) => (
    <div
      className={joinClassNames(
        "a2ui-stack",
        `a2ui-stack--gap-${props.gap}`,
        `a2ui-stack--align-${props.align}`,
      )}
    >
      {(props.children as string[]).map((childId) => (
        <div className="a2ui-stack__item" key={childId}>{buildChild(childId)}</div>
      ))}
    </div>
  ),
);

export const Grid = createComponentImplementation(
  {
    name: "Grid",
    schema: GridNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild }) => (
    <div
      className={joinClassNames(
        "a2ui-grid",
        `a2ui-grid--${props.columns}`,
        `a2ui-grid--gap-${props.gap}`,
      )}
    >
      {(props.children as string[]).map((childId) => (
        <div className="a2ui-grid__item" key={childId}>{buildChild(childId)}</div>
      ))}
    </div>
  ),
);

export const Section = createComponentImplementation(
  {
    name: "Section",
    schema: SectionNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild, context }) => {
    const labelId = props.label ? `${context.componentModel.id}-label` : undefined;
    return (
      <section
        className={joinClassNames(
          "a2ui-section",
          `a2ui-section--${props.role}`,
          `a2ui-section--tone-${props.tone}`,
          `a2ui-section--prominence-${props.prominence}`,
        )}
        aria-labelledby={labelId}
      >
        {props.label ? <h3 className="a2ui-section__label" id={labelId}>{props.label}</h3> : null}
        <div className="a2ui-section__content">
          {(props.children as string[]).map((childId) => buildChild(childId))}
        </div>
      </section>
    );
  },
);

export const Card = createComponentImplementation(
  {
    name: "Card",
    schema: CardNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild }) => (
    <div
      className={joinClassNames(
        "a2ui-card",
        `a2ui-card--tone-${props.tone}`,
        `a2ui-card--prominence-${props.prominence}`,
      )}
    >
      {(props.children as string[]).map((childId) => buildChild(childId))}
    </div>
  ),
);

export const Tabs = createComponentImplementation(
  {
    name: "Tabs",
    schema: TabsNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild, context }) => {
    const childIds = props.children as string[];
    const labels = props.labels as string[];
    const [selectedIndex, setSelectedIndex] = useState(props.defaultIndex);
    const baseId = context.componentModel.id;
    const selectAndFocus = (index: number): void => {
      const nextIndex = (index + childIds.length) % childIds.length;
      setSelectedIndex(nextIndex);
      globalThis.document?.getElementById(`${baseId}-tab-${nextIndex}`)?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
      if (event.key === "ArrowRight") selectAndFocus(index + 1);
      else if (event.key === "ArrowLeft") selectAndFocus(index - 1);
      else if (event.key === "Home") selectAndFocus(0);
      else if (event.key === "End") selectAndFocus(childIds.length - 1);
      else return;
      event.preventDefault();
    };
    return (
      <div className="a2ui-tabs">
        <div className="a2ui-tabs__list" role="tablist" aria-label="Surface views">
          {labels.map((label, index) => (
            <button
              aria-controls={`${baseId}-panel-${index}`}
              aria-selected={selectedIndex === index}
              className="a2ui-tabs__tab"
              id={`${baseId}-tab-${index}`}
              key={childIds[index]}
              onClick={() => setSelectedIndex(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              role="tab"
              tabIndex={selectedIndex === index ? 0 : -1}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {childIds.map((childId, index) => (
          <div
            aria-labelledby={`${baseId}-tab-${index}`}
            className="a2ui-tabs__panel"
            hidden={selectedIndex !== index}
            id={`${baseId}-panel-${index}`}
            key={childId}
            role="tabpanel"
            tabIndex={0}
          >
            {buildChild(childId)}
          </div>
        ))}
      </div>
    );
  },
);

export const Disclosure = createComponentImplementation(
  {
    name: "Disclosure",
    schema: DisclosureNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, buildChild }) => (
    <details className="a2ui-disclosure" open={props.defaultOpen || undefined}>
      <summary className="a2ui-disclosure__summary">{props.label}</summary>
      <div className="a2ui-disclosure__content">
        {(props.children as string[]).map((childId) => buildChild(childId))}
      </div>
    </details>
  ),
);

export const layoutComponents = [
  SurfaceFrame,
  EditorialHeading,
  TextBlock,
  Metric,
  Band,
  Split,
  Rail,
  Divider,
  Stack,
  Grid,
  Section,
  Card,
  Tabs,
  Disclosure,
] as const;
