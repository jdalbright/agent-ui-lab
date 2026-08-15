/* eslint-disable react-refresh/only-export-components */
import { createComponentImplementation } from "@a2ui/react/v0_9";
import {
  ComparisonChartNodeSchema,
  ComparisonSummaryNodeSchema,
  ComparisonTableNodeSchema,
} from "@shared/schemas";
import { joinClassNames } from "./common";

export const ComparisonSummary = createComponentImplementation(
  {
    name: "ComparisonSummary",
    schema: ComparisonSummaryNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) => (
    <section
      className={joinClassNames(
        "a2ui-comparison-summary",
        `a2ui-comparison-summary--${props.variant ?? "balanced"}`,
      )}
      data-variant={props.variant ?? "balanced"}
    >
      <div className="a2ui-comparison-summary__lead">
        <p className="a2ui-eyebrow">Comparison</p>
        <h2>{props.title}</h2>
        <p>{props.recommendation}</p>
      </div>
      <ul className="a2ui-comparison-summary__items">
        {props.items.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            className={joinClassNames(item.recommended && "is-recommended")}
          >
            <div>
              <span>{item.label}</span>
              {item.recommended ? <strong>Recommended</strong> : null}
            </div>
            <p>{item.value}</p>
            {item.detail ? <small>{item.detail}</small> : null}
          </li>
        ))}
      </ul>
    </section>
  ),
);

export const ComparisonTable = createComponentImplementation(
  {
    name: "ComparisonTable",
    schema: ComparisonTableNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) => {
    const columns = props.columns as string[];
    return (
      <div className="a2ui-table-scroll" tabIndex={0} role="region" aria-label={props.caption}>
      <table className="a2ui-table">
        <caption>{props.caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, rowIndex) => (
            <tr key={`${row[0] ?? "row"}-${rowIndex}`}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    );
  },
);

const chartWidth = 720;
const chartHeight = 260;
const chartInset = { top: 24, right: 24, bottom: 38, left: 48 } as const;

function chartPoints(values: readonly number[], minimum: number, maximum: number): string {
  const width = chartWidth - chartInset.left - chartInset.right;
  const height = chartHeight - chartInset.top - chartInset.bottom;
  const span = maximum - minimum || 1;
  const divisor = Math.max(values.length - 1, 1);

  return values
    .map((value, index) => {
      const x = chartInset.left + (index / divisor) * width;
      const y = chartInset.top + ((maximum - value) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export const ComparisonChart = createComponentImplementation(
  {
    name: "ComparisonChart",
    schema: ComparisonChartNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) => {
    const variant = props.variant ?? "line";
    const labels = props.labels as string[];
    const allValues = props.series.flatMap((series) => series.values);
    const dataMinimum = Math.min(...allValues);
    const dataMaximum = Math.max(...allValues);
    const minimum = variant === "bar" ? Math.min(0, dataMinimum) : dataMinimum;
    const maximumCandidate = variant === "bar" ? Math.max(0, dataMaximum) : dataMaximum;
    const maximum = variant === "bar" && maximumCandidate === minimum
      ? minimum + 1
      : maximumCandidate;
    const plotWidth = chartWidth - chartInset.left - chartInset.right;
    const plotHeight = chartHeight - chartInset.top - chartInset.bottom;
    const valueSpan = maximum - minimum || 1;
    const groupWidth = plotWidth / labels.length;
    const barWidth = Math.max(3, (groupWidth * 0.72) / props.series.length);
    const yForValue = (value: number) =>
      chartInset.top + ((maximum - value) / valueSpan) * plotHeight;
    const zeroBaselineY = yForValue(0);
    const barTicks = [...new Set([maximum, 0, minimum])];

    return (
      <figure
        className={joinClassNames("a2ui-chart", `a2ui-chart--${variant}`)}
        data-variant={variant}
      >
        <h3>{props.title}</h3>
        <div className="a2ui-chart__graphic">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label={props.title}
            preserveAspectRatio="xMidYMid meet"
            data-domain-min={minimum}
            data-domain-max={maximum}
          >
            <desc>
              {variant === "bar"
                ? "Bar chart with a labeled zero baseline."
                : "Line chart."}{" "}
              The complete values are available in the table immediately below.
            </desc>
            {[0, 1, 2, 3, 4].map((line) => {
              const y = chartInset.top + (line / 4) * (chartHeight - chartInset.top - chartInset.bottom);
              return (
                <line
                  className="a2ui-chart__grid"
                  key={line}
                  x1={chartInset.left}
                  x2={chartWidth - chartInset.right}
                  y1={y}
                  y2={y}
                />
              );
            })}
            {variant === "bar" ? (
              <>
                <line
                  className="a2ui-chart__baseline"
                  data-value="0"
                  x1={chartInset.left}
                  x2={chartWidth - chartInset.right}
                  y1={zeroBaselineY}
                  y2={zeroBaselineY}
                />
                {barTicks.map((tick) => (
                  <text
                    className={joinClassNames(
                      "a2ui-chart__tick",
                      tick === 0 && "a2ui-chart__tick--zero",
                    )}
                    key={tick}
                    x={chartInset.left - 8}
                    y={yForValue(tick) + 4}
                    textAnchor="end"
                  >
                    {Number.isInteger(tick) ? tick : Number(tick.toFixed(2))}
                  </text>
                ))}
              </>
            ) : null}
            {variant === "bar"
              ? props.series.flatMap((series, seriesIndex) =>
                  series.values.map((value, valueIndex) => {
                    const valueY = yForValue(value);
                    const height = Math.abs(zeroBaselineY - valueY);
                    const groupStart = chartInset.left + valueIndex * groupWidth;
                    const x =
                      groupStart +
                      groupWidth * 0.14 +
                      seriesIndex * barWidth;
                    const y = Math.min(valueY, zeroBaselineY);
                    return (
                      <rect
                        key={`${series.label}-${valueIndex}`}
                        className={`a2ui-chart__bar a2ui-chart__bar--${seriesIndex % 4}`}
                        x={x}
                        y={y}
                        width={barWidth}
                        height={height}
                        rx="1"
                      />
                    );
                  }),
                )
              : props.series.map((series, index) => (
                  <polyline
                    key={series.label}
                    className={`a2ui-chart__series a2ui-chart__series--${index % 4}`}
                    points={chartPoints(series.values, minimum, maximum)}
                  />
                ))}
          </svg>
        </div>
        <ul className="a2ui-chart__legend" aria-label="Chart legend">
          {props.series.map((series, index) => (
            <li key={series.label}>
              <span className={`a2ui-chart__key a2ui-chart__key--${index % 4}`} aria-hidden="true" />
              {series.label}
            </li>
          ))}
        </ul>
        <div className="a2ui-table-scroll" tabIndex={0} role="region" aria-label={`${props.title} data`}>
          <table className="a2ui-table a2ui-chart__table" aria-label={`${props.title} data`}>
            <thead>
              <tr>
                <th scope="col">Series</th>
                {labels.map((label) => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.series.map((series) => (
                <tr key={series.label}>
                  <th scope="row">{series.label}</th>
                  {labels.map((_, index) => (
                    <td key={index}>
                      {series.values[index] === undefined ? "—" : series.values[index]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {props.unit ? <figcaption>Values shown in {props.unit}.</figcaption> : null}
      </figure>
    );
  },
);

export const comparisonComponents = [ComparisonSummary, ComparisonTable, ComparisonChart] as const;
