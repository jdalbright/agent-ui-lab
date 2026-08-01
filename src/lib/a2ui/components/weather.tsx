/* eslint-disable react-refresh/only-export-components */
import { createComponentImplementation } from "@a2ui/react/v0_9";
import {
  DailyForecastNodeSchema,
  HourlyForecastNodeSchema,
  LocationPromptNodeSchema,
  RecommendationBandNodeSchema,
  WeatherAlertNodeSchema,
  WeatherHeroNodeSchema,
} from "@shared/schemas";
import {
  SourceAnchor,
  WeatherGlyph,
  joinClassNames,
  sourceMap,
  temperatureLabel,
} from "./common";

export const WeatherHero = createComponentImplementation(
  {
    name: "WeatherHero",
    schema: WeatherHeroNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) => (
    <section className="a2ui-weather-hero" aria-label={`Weather for ${props.location}`}>
      <div className="a2ui-weather-hero__place">
        <h2>{props.location}</h2>
        <p>{props.dateLabel}</p>
      </div>
      <div className="a2ui-weather-hero__reading">
        <strong aria-label={`${props.temperature} degrees ${props.unit === "F" ? "Fahrenheit" : "Celsius"}`}>
          {Math.round(props.temperature)}°
        </strong>
      </div>
      <div className="a2ui-weather-hero__condition">
        <WeatherGlyph condition={props.conditionKey} />
        <p>{props.condition}</p>
      </div>
      <dl className="a2ui-weather-hero__recommendation">
        <dt>{props.recommendationLabel}</dt>
        <dd>{props.recommendationValue}</dd>
        <dd>{props.recommendationDetail}</dd>
      </dl>
    </section>
  ),
);

export const RecommendationBand = createComponentImplementation(
  {
    name: "RecommendationBand",
    schema: RecommendationBandNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) => (
    <aside
      className={joinClassNames(
        "a2ui-recommendation",
        `a2ui-recommendation--${props.confidence}`,
      )}
      aria-label={props.label}
    >
      <p className="a2ui-eyebrow">{props.label}</p>
      <p className="a2ui-recommendation__value">{props.value}</p>
      <p>{props.detail}</p>
      <span className="a2ui-confidence">{props.confidence} confidence</span>
    </aside>
  ),
);

export const HourlyForecast = createComponentImplementation(
  {
    name: "HourlyForecast",
    schema: HourlyForecastNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const labelId = `${context.componentModel.id}-label`;
    const temperatures = props.items.map((item) => item.temperature);
    const minimum = Math.min(...temperatures);
    const maximum = Math.max(...temperatures);
    const range = Math.max(1, maximum - minimum);
    const points = temperatures
      .map((temperature, index) => {
        const x = props.items.length === 1 ? 0 : (index / (props.items.length - 1)) * 100;
        const y = 18 - ((temperature - minimum) / range) * 12;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return (
      <section className="a2ui-forecast" aria-labelledby={labelId}>
        <h3 id={labelId} className="a2ui-section-title">
          {props.label}
        </h3>
        <ol className="a2ui-hourly" tabIndex={0} aria-label={`${props.label}, scroll for more`}>
          {props.items.map((item, index) => (
            <li key={`${item.time}-${index}`}>
              <time>{item.time}</time>
              <WeatherGlyph condition={item.condition} />
              <strong>{temperatureLabel(item.temperature, props.unit)}</strong>
              <span>{item.precipitationProbability}% rain</span>
            </li>
          ))}
        </ol>
        <svg
          className="a2ui-hourly-chart"
          viewBox="0 0 100 20"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <polyline points={points} />
          {temperatures.map((temperature, index) => {
            const x = temperatures.length === 1 ? 0 : (index / (temperatures.length - 1)) * 100;
            const y = 18 - ((temperature - minimum) / range) * 12;
            return <circle key={`${temperature}-${index}`} cx={x} cy={y} r="0.65" />;
          })}
        </svg>
      </section>
    );
  },
);

export const DailyForecast = createComponentImplementation(
  {
    name: "DailyForecast",
    schema: DailyForecastNodeSchema.omit({ id: true, component: true }),
  },
  ({ props }) => (
    <section className="a2ui-forecast">
      <h3 className="a2ui-section-title">{props.label}</h3>
      <div className="a2ui-table-scroll" tabIndex={0} role="region" aria-label={props.label}>
        <table className="a2ui-table a2ui-daily-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Conditions</th>
              <th scope="col">High</th>
              <th scope="col">Low</th>
              <th scope="col">Rain</th>
            </tr>
          </thead>
          <tbody>
            {props.items.map((item, index) => (
              <tr key={`${item.date}-${index}`}>
                <th scope="row">{item.date}</th>
                <td className="a2ui-condition-cell">
                  <WeatherGlyph condition={item.condition} />
                  <span>{item.condition.replaceAll("-", " ")}</span>
                </td>
                <td>{temperatureLabel(item.high, props.unit)}</td>
                <td>{temperatureLabel(item.low, props.unit)}</td>
                <td>{item.precipitationProbability}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  ),
);

export const WeatherAlert = createComponentImplementation(
  {
    name: "WeatherAlert",
    schema: WeatherAlertNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const alertId = `${context.componentModel.id}-title`;
    const source = props.sourceId ? sourceMap(context).get(props.sourceId) : undefined;
    return (
      <aside
        className={joinClassNames("a2ui-alert", `a2ui-alert--${props.severity}`)}
        role="alert"
        aria-labelledby={alertId}
      >
        <div className="a2ui-alert__header">
          <span className="a2ui-alert__severity">{props.severity} alert</span>
          <h3 id={alertId}>{props.title}</h3>
        </div>
        <p>{props.description}</p>
        {props.sourceId ? <SourceAnchor source={source} prefix="Source: " /> : null}
      </aside>
    );
  },
);

export const LocationPrompt = createComponentImplementation(
  {
    name: "LocationPrompt",
    schema: LocationPromptNodeSchema.omit({ id: true, component: true }),
  },
  ({ props, context }) => {
    const suggestions = props.suggestions as string[];
    return (
      <section className="a2ui-location-prompt" aria-label="Location clarification">
      <h3>{props.message}</h3>
      {suggestions.length > 0 ? (
        <div className="a2ui-location-prompt__choices">
          {suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              onClick={() => {
                void context.dispatchAction({
                  event: { name: "selectLocation", context: { suggestion } },
                });
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : (
        <p className="a2ui-text a2ui-text--muted">Enter a city and region to continue.</p>
      )}
      </section>
    );
  },
);

export const weatherComponents = [
  WeatherHero,
  RecommendationBand,
  HourlyForecast,
  DailyForecast,
  WeatherAlert,
  LocationPrompt,
] as const;
