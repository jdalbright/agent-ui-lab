import { describe, expect, it } from "vitest";
import type { ClientContext, SourceRecord } from "../../shared/schemas.js";
import { validateSurfaceSpec } from "../../shared/surface-validation.js";
import type { GeminiRetrievalResult } from "./gemini.js";
import {
  SURFACE_RECIPE_IDS,
  SurfacePlanSchema,
  buildFallbackSurfacePlan,
  compileSurfacePlan,
  validateSurfacePlan,
} from "./surface-plan.js";

const clientContext: ClientContext = {
  sizeClass: "expanded",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

const weatherSource: SourceRecord = {
  id: "src_weather1",
  title: "Google Weather",
  url: "https://developers.google.com/maps/documentation/weather",
  provider: "google-weather",
  accessedAt: "2026-08-02T14:00:00.000Z",
};

const searchSources: readonly SourceRecord[] = [
  {
    id: "src_research1",
    title: "Primary documentation",
    url: "https://example.com/primary",
    provider: "google-search",
    accessedAt: "2026-08-02T14:00:00.000Z",
  },
  {
    id: "src_research2",
    title: "Independent analysis",
    url: "https://example.org/analysis",
    provider: "google-search",
    accessedAt: "2026-08-02T14:00:00.000Z",
  },
];

const raleighWeather = {
  location: {
    name: "Raleigh, NC",
    latitude: 35.7796,
    longitude: -78.6382,
    placeId: "raleigh-place",
  },
  units: "imperial",
  fetchedAt: "2026-08-02T14:00:00.000Z",
  current: {
    observedAt: "2026-08-02T14:00:00.000Z",
    timeZone: "America/New_York",
    temperature: 81,
    feelsLike: 83,
    temperatureUnit: "F",
    conditionKey: "partly-cloudy",
    conditionText: "Partly cloudy",
    isDaytime: true,
    humidity: 58,
    precipitationProbability: 12,
    windDirection: "SW",
    windDegrees: 225,
    windSpeed: 7,
    windGust: 11,
    windSpeedUnit: "mph",
    visibility: 10,
    visibilityUnit: "mi",
    uvIndex: 4,
    cloudCover: 35,
    thunderstormProbability: 3,
  },
  hourly: [
    {
      startTime: "2026-08-02T14:00:00.000Z",
      endTime: "2026-08-02T15:00:00.000Z",
      temperature: 82,
      feelsLike: 84,
      temperatureUnit: "F",
      precipitationProbability: 12,
      thunderstormProbability: 3,
      conditionKey: "partly-cloudy",
      conditionText: "Partly cloudy",
      isDaytime: true,
      humidity: 57,
      windSpeed: 7,
      windGust: 11,
      windSpeedUnit: "mph",
    },
    {
      startTime: "2026-08-02T15:00:00.000Z",
      endTime: "2026-08-02T16:00:00.000Z",
      temperature: 83,
      feelsLike: 85,
      temperatureUnit: "F",
      precipitationProbability: 9,
      thunderstormProbability: 2,
      conditionKey: "partly-cloudy",
      conditionText: "Partly cloudy",
      isDaytime: true,
      humidity: 55,
      windSpeed: 8,
      windGust: 12,
      windSpeedUnit: "mph",
    },
    {
      startTime: "2026-08-02T16:00:00.000Z",
      endTime: "2026-08-02T17:00:00.000Z",
      temperature: 84,
      feelsLike: 86,
      temperatureUnit: "F",
      precipitationProbability: 8,
      thunderstormProbability: 2,
      conditionKey: "clear",
      conditionText: "Mostly sunny",
      isDaytime: true,
      humidity: 53,
      windSpeed: 8,
      windGust: 12,
      windSpeedUnit: "mph",
    },
  ],
  daily: [
    {
      date: "2026-08-02",
      startTime: "2026-08-02T10:00:00.000Z",
      endTime: "2026-08-03T10:00:00.000Z",
      high: 86,
      low: 68,
      temperatureUnit: "F",
      precipitationProbability: 20,
      conditionKey: "partly-cloudy",
      conditionText: "Partly cloudy",
      nighttimeConditionKey: "clear",
      nighttimeConditionText: "Clear",
      sunriseTime: "2026-08-02T10:23:00.000Z",
      sunsetTime: "2026-08-03T00:17:00.000Z",
    },
    {
      date: "2026-08-03",
      startTime: "2026-08-03T10:00:00.000Z",
      endTime: "2026-08-04T10:00:00.000Z",
      high: 88,
      low: 70,
      temperatureUnit: "F",
      precipitationProbability: 35,
      conditionKey: "rain",
      conditionText: "Scattered showers",
      nighttimeConditionKey: "cloudy",
      nighttimeConditionText: "Cloudy",
    },
  ],
  alerts: [
    {
      id: "heat-advisory",
      title: "Heat advisory",
      eventType: "Heat Advisory",
      eventTypeCode: "HEAT",
      areaName: "Wake County",
      description: "Heat index values may become elevated this afternoon.",
      instructions: ["Drink water."],
      safetyRecommendations: ["Limit strenuous activity."],
      startsAt: "2026-08-02T16:00:00.000Z",
      expiresAt: "2026-08-02T23:00:00.000Z",
      severity: "moderate",
      certainty: "likely",
      urgency: "expected",
      sourceName: "National Weather Service",
    },
  ],
};

const weatherRetrieval: GeminiRetrievalResult = {
  outputText: "Raleigh is partly cloudy and 81 degrees. The best walk window begins at 7 PM.",
  sources: Object.freeze([Object.freeze(weatherSource)]),
  steps: Object.freeze([]),
  evidence: Object.freeze([
    Object.freeze({
      tool: "get_weather_bundle" as const,
      arguments: Object.freeze({ location: "Raleigh, NC", units: "imperial" as const }),
      result: Object.freeze({
        locations: Object.freeze([raleighWeather]),
        units: "imperial",
        fetchedAt: "2026-08-02T14:00:00.000Z",
        attribution: Object.freeze({
          text: "Source: Includes weather data from Google",
          url: "https://developers.google.com/maps/documentation/weather/policies",
        }),
        activityWindows: Object.freeze([
          Object.freeze({
            location: raleighWeather.location,
            activity: "walk",
            startTime: "2026-08-02T23:00:00.000Z",
            endTime: "2026-08-03T01:00:00.000Z",
            durationHours: 2,
            score: 91,
            confidence: "high",
            reasons: Object.freeze(["Comfortable temperature", "Low precipitation risk"]),
            label: "Best 2-hour walk window",
            detail: "Comfortable temperature · Low precipitation risk",
          }),
        ]),
      }),
    }),
  ]),
  toolRounds: 1,
};

const comparisonRetrieval: GeminiRetrievalResult = {
  outputText:
    "Option Alpha is easier to adopt, while Option Beta has the stronger long-term feature set.",
  sources: Object.freeze(searchSources.map((source) => Object.freeze(source))),
  steps: Object.freeze([]),
  evidence: Object.freeze([]),
  toolRounds: 0,
};

const researchRetrieval: GeminiRetrievalResult = {
  outputText:
    "The release moved from preview to general availability after the public preview milestone.",
  sources: Object.freeze(searchSources.map((source) => Object.freeze(source))),
  steps: Object.freeze([]),
  evidence: Object.freeze([]),
  toolRounds: 0,
};

const weatherHero = {
  type: "hero",
  variant: "snapshot",
  locationIndex: 0,
  recommendationLabel: "Right now",
  recommendationValue: "Comfortable outside",
  recommendationDetail: "Partly cloudy with a light breeze.",
};

const weatherSources = {
  type: "sources",
  label: "Weather source",
  sourceIds: [weatherSource.id],
};

const comparisonSummary = {
  type: "summary",
  variant: "verdict",
  title: "Alpha is easier now; Beta is stronger later",
  recommendation: "Choose Alpha for speed or Beta for a broader long-term feature set.",
  items: [
    {
      label: "Option Alpha",
      value: "Faster adoption",
      detail: "The simpler setup lowers initial effort.",
      recommended: true,
    },
    {
      label: "Option Beta",
      value: "Broader feature set",
      detail: "The larger feature set supports more advanced needs.",
      recommended: false,
    },
  ],
  sourceIds: searchSources.map((source) => source.id),
};

const comparisonTable = {
  type: "table",
  caption: "Decision scorecard",
  columns: ["Criterion", "Option Alpha", "Option Beta"],
  rows: [
    ["Setup", "Lower effort", "Higher effort"],
    ["Features", "Focused", "Broad"],
  ],
  sourceIds: searchSources.map((source) => source.id),
};

const comparisonSources = {
  type: "sources",
  label: "Sources",
  sourceIds: searchSources.map((source) => source.id),
};

const researchLead = {
  type: "lead",
  variant: "feature",
  title: "The release reached general availability",
  summary: "The public preview milestone preceded the generally available release.",
  sourceIds: searchSources.map((source) => source.id),
};

const researchEvidence = {
  type: "evidence",
  variant: "stack",
  label: "Evidence",
  items: [
    {
      title: "General availability",
      finding: "The primary documentation marks the release as generally available.",
      sourceId: searchSources[0].id,
      stance: "support",
    },
    {
      title: "Earlier preview",
      finding: "The analysis records the earlier public preview milestone.",
      sourceId: searchSources[1].id,
      stance: "neutral",
    },
  ],
};

const researchSources = {
  type: "sources",
  label: "Sources",
  sourceIds: searchSources.map((source) => source.id),
};

const plansByRecipe: Readonly<Record<string, Record<string, unknown>>> = {
  "weather.snapshot": {
    kind: "weather",
    recipeId: "weather.snapshot",
    density: "brief",
    emphasis: "answer",
    modules: [
      weatherHero,
      {
        type: "metrics",
        locationIndex: 0,
        metrics: ["feelsLike", "humidity", "wind", "uv", "visibility", "precipitation"],
      },
      {
        type: "hourly",
        variant: "strip",
        label: "Next two hours",
        locationIndex: 0,
        hourIndexes: [0, 1],
      },
      weatherSources,
    ],
  },
  "weather.decision": {
    kind: "weather",
    recipeId: "weather.decision",
    density: "balanced",
    emphasis: "decision",
    modules: [
      { ...weatherHero, variant: "decision" },
      {
        type: "recommendation",
        locationIndex: 0,
        activityWindowIndex: 0,
      },
      {
        type: "hourly",
        variant: "chart",
        label: "Around the recommended window",
        locationIndex: 0,
        hourIndexes: [1, 2],
      },
      weatherSources,
    ],
  },
  "weather.outlook": {
    kind: "weather",
    recipeId: "weather.outlook",
    density: "detailed",
    emphasis: "trend",
    modules: [
      weatherHero,
      {
        type: "daily",
        variant: "table",
        label: "Two-day outlook",
        locationIndex: 0,
        dayIndexes: [0, 1],
      },
      {
        type: "alerts",
        locationIndex: 0,
        alertIndexes: [0],
      },
      weatherSources,
    ],
  },
  "comparison.verdict": {
    kind: "comparison",
    recipeId: "comparison.verdict",
    density: "brief",
    emphasis: "decision",
    modules: [comparisonSummary, comparisonTable, comparisonSources],
  },
  "comparison.scorecard": {
    kind: "comparison",
    recipeId: "comparison.scorecard",
    density: "detailed",
    emphasis: "evidence",
    modules: [
      { ...comparisonSummary, variant: "balanced" },
      comparisonTable,
      comparisonSources,
    ],
  },
  "comparison.trend": {
    kind: "comparison",
    recipeId: "comparison.trend",
    density: "detailed",
    emphasis: "trend",
    modules: [
      { ...comparisonSummary, variant: "balanced" },
      {
        type: "chart",
        variant: "line",
        title: "Adoption trend",
        labels: ["Now", "Next", "Later"],
        series: [
          { label: "Option Alpha", values: [8, 7, 6] },
          { label: "Option Beta", values: [4, 7, 9] },
        ],
        unit: "score",
        sourceIds: searchSources.map((source) => source.id),
      },
      comparisonSources,
    ],
  },
  "research.brief": {
    kind: "research",
    recipeId: "research.brief",
    density: "brief",
    emphasis: "answer",
    modules: [researchLead, researchEvidence, researchSources],
  },
  "research.timeline": {
    kind: "research",
    recipeId: "research.timeline",
    density: "detailed",
    emphasis: "trend",
    modules: [
      { ...researchLead, variant: "brief" },
      {
        type: "timeline",
        label: "Release timeline",
        items: [
          {
            date: "2026-04",
            title: "Public preview",
            detail: "The public preview opened first.",
            sourceId: searchSources[1].id,
          },
          {
            date: "2026-07",
            title: "General availability",
            detail: "The stable release followed.",
            sourceId: searchSources[0].id,
          },
        ],
      },
      researchSources,
    ],
  },
  "research.claims": {
    kind: "research",
    recipeId: "research.claims",
    density: "detailed",
    emphasis: "evidence",
    modules: [
      { ...researchLead, variant: "brief" },
      {
        ...researchEvidence,
        variant: "for-against",
        items: [
          researchEvidence.items[0],
          { ...researchEvidence.items[1], stance: "challenge" },
        ],
      },
      researchSources,
    ],
  },
};

function validationContextFor(recipeId: string) {
  if (recipeId.startsWith("weather.")) {
    return { sources: weatherRetrieval.sources, evidence: weatherRetrieval.evidence };
  }
  return { sources: searchSources, evidence: [] };
}

function retrievalFor(kind: "weather" | "comparison" | "research") {
  if (kind === "weather") return weatherRetrieval;
  if (kind === "comparison") return comparisonRetrieval;
  return researchRetrieval;
}

describe("SurfacePlan contract", () => {
  it("exposes exactly the nine approved recipe IDs", () => {
    expect(SURFACE_RECIPE_IDS).toEqual([
      "weather.snapshot",
      "weather.decision",
      "weather.outlook",
      "comparison.verdict",
      "comparison.scorecard",
      "comparison.trend",
      "research.brief",
      "research.timeline",
      "research.claims",
    ]);
  });

  it.each(Object.entries(plansByRecipe))(
    "accepts a valid %s plan with its capability-specific modules",
    (recipeId, plan) => {
      expect(SurfacePlanSchema.safeParse(plan).success).toBe(true);
      expect(validateSurfacePlan(plan, validationContextFor(recipeId))).toMatchObject({
        success: true,
      });
    },
  );

  it.each([
    ["weather.snapshot", "hero"],
    ["weather.decision", "recommendation"],
    ["weather.outlook", "daily"],
    ["comparison.verdict", "summary"],
    ["comparison.scorecard", "table"],
    ["comparison.trend", "chart"],
    ["research.brief", "lead"],
    ["research.timeline", "timeline"],
    ["research.claims", "evidence"],
  ])("rejects %s when its defining %s module is absent", (recipeId, requiredModule) => {
    const plan = structuredClone(plansByRecipe[recipeId]);
    plan.modules = (plan.modules as Array<{ type: string }>).filter(
      (module) => module.type !== requiredModule,
    );

    const result = validateSurfacePlan(plan, validationContextFor(recipeId));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/recipe|module|required/i);
  });

  it("rejects a recipe whose namespace does not match its plan kind", () => {
    const plan = {
      ...structuredClone(plansByRecipe["weather.snapshot"]),
      kind: "research",
    };

    const result = validateSurfacePlan(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
    });

    expect(result.success).toBe(false);
  });

  it("rejects cross-domain modules even when the top-level recipe is otherwise valid", () => {
    const plan = structuredClone(plansByRecipe["weather.snapshot"]);
    plan.modules = [researchLead, ...(plan.modules as unknown[])];

    expect(SurfacePlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects model-authored weather measurements and presentation escape hatches", () => {
    const plan = structuredClone(plansByRecipe["weather.snapshot"]);
    const hero = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "hero",
    );
    Object.assign(hero ?? {}, {
      temperature: 999,
      url: "https://attacker.example",
      css: "position:fixed",
    });

    expect(SurfacePlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe("SurfacePlan evidence references", () => {
  it("rejects source IDs that were not issued by the retrieval stage", () => {
    const plan = structuredClone(plansByRecipe["research.claims"]);
    const evidence = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "evidence",
    );
    const items = evidence?.items as Array<Record<string, unknown>>;
    items[0].sourceId = "src_invented1";

    const result = validateSurfacePlan(plan, { sources: searchSources, evidence: [] });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/source/i);
  });

  it.each([
    ["hero", "locationIndex", 4],
    ["hourly", "hourIndexes", [0, 99]],
    ["daily", "dayIndexes", [99]],
    ["alerts", "alertIndexes", [99]],
    ["recommendation", "activityWindowIndex", 99],
  ])("rejects an out-of-range weather reference on %s.%s", (moduleType, property, value) => {
    const recipeId =
      moduleType === "daily" || moduleType === "alerts"
        ? "weather.outlook"
        : moduleType === "recommendation"
          ? "weather.decision"
          : "weather.snapshot";
    const plan = structuredClone(plansByRecipe[recipeId]);
    const module = (plan.modules as Array<Record<string, unknown>>).find(
      (candidate) => candidate.type === moduleType,
    );
    Object.assign(module ?? {}, { [property]: value });

    const result = validateSurfacePlan(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/evidence|reference|index|range/i);
  });
});

describe("compileSurfacePlan", () => {
  it("deterministically compiles semantic plan choices into a trusted SurfaceSpec", () => {
    const plan = SurfacePlanSchema.parse(
      structuredClone(plansByRecipe["weather.snapshot"]),
    );
    const originalPlan = structuredClone(plan);
    const originalRetrieval = structuredClone(weatherRetrieval);

    const first = compileSurfacePlan({ plan, retrieval: weatherRetrieval, clientContext });
    const second = compileSurfacePlan({ plan, retrieval: weatherRetrieval, clientContext });

    expect(first).toEqual(second);
    expect(plan).toEqual(originalPlan);
    expect(weatherRetrieval).toEqual(originalRetrieval);
    expect(validateSurfaceSpec(first, weatherRetrieval.sources).success).toBe(true);
    expect(first).toMatchObject({ kind: "weather" });

    const frame = first.components.find((node) => node.id === first.rootId);
    expect(frame).toMatchObject({
      component: "SurfaceFrame",
      recipeId: "weather.snapshot",
      density: "brief",
      emphasis: "answer",
    });

    const hero = first.components.find((node) => node.component === "WeatherHero");
    expect(hero).toMatchObject({
      location: "Raleigh, NC",
      temperature: 81,
      unit: "F",
      condition: "Partly cloudy",
      conditionKey: "partly-cloudy",
      variant: "snapshot",
    });

    const hourly = first.components.find((node) => node.component === "HourlyForecast");
    expect(hourly).toMatchObject({
      variant: "strip",
      unit: "F",
      items: [{ temperature: 82 }, { temperature: 83 }],
    });

    const metrics = first.components.filter((node) => node.component === "Metric");
    expect(metrics.map((node) => ("label" in node ? node.label : undefined))).toEqual([
      "Feels like",
      "Humidity",
      "Wind",
      "UV index",
      "Visibility",
      "Precipitation",
    ]);
    const trustedMetricNumbers = new Map([
      ["Feels like", 83],
      ["Humidity", 58],
      ["Wind", 7],
      ["UV index", 4],
      ["Visibility", 10],
      ["Precipitation", 12],
    ]);
    for (const node of metrics) {
      if (!("label" in node) || !("value" in node)) continue;
      expect(Number.parseFloat(String(node.value))).toBe(trustedMetricNumbers.get(node.label));
    }
  });

  it("copies recommendation, daily, and alert values from normalized weather evidence", () => {
    const decision = compileSurfacePlan({
      plan: SurfacePlanSchema.parse(plansByRecipe["weather.decision"]),
      retrieval: weatherRetrieval,
      clientContext,
    });
    const outlook = compileSurfacePlan({
      plan: SurfacePlanSchema.parse(plansByRecipe["weather.outlook"]),
      retrieval: weatherRetrieval,
      clientContext,
    });

    expect(decision.components.find((node) => node.component === "RecommendationBand")).toMatchObject({
      label: "Best 2-hour walk window",
      detail: "Comfortable temperature · Low precipitation risk",
      confidence: "high",
    });
    expect(outlook.components.find((node) => node.component === "DailyForecast")).toMatchObject({
      variant: "table",
      unit: "F",
      items: [
        { high: 86, low: 68, precipitationProbability: 20 },
        { high: 88, low: 70, precipitationProbability: 35 },
      ],
    });
    expect(outlook.components.find((node) => node.component === "WeatherAlert")).toMatchObject({
      title: "Heat advisory",
      severity: "moderate",
      description: "Heat index values may become elevated this afternoon.",
    });
  });
});

describe("domain-specific deterministic SurfacePlan fallbacks", () => {
  it.each([
    ["weather", "weather.snapshot", "WeatherHero"],
    ["comparison", "comparison.verdict", "ComparisonSummary"],
    ["research", "research.brief", "ResearchLead"],
  ] as const)(
    "uses the %s fallback recipe instead of collapsing to generic narrative prose",
    (kind, recipeId, expectedPrimaryComponent) => {
      const retrieval = retrievalFor(kind);
      const input = {
        kind,
        prompt:
          kind === "weather"
            ? "What is the weather in Raleigh?"
            : kind === "comparison"
              ? "Compare Option Alpha and Option Beta."
              : "Research the release timeline.",
        retrieval,
        clientContext,
      };

      const first = buildFallbackSurfacePlan(input);
      const second = buildFallbackSurfacePlan(input);

      expect(first).toEqual(second);
      expect(first).toMatchObject({ kind, recipeId });
      expect(
        validateSurfacePlan(first, {
          sources: retrieval.sources,
          evidence: retrieval.evidence,
        }),
      ).toMatchObject({ success: true });

      const spec = compileSurfacePlan({ plan: first, retrieval, clientContext });
      expect(validateSurfaceSpec(spec, retrieval.sources).success).toBe(true);
      expect(spec.kind).toBe(kind);
      expect(spec.components.some((node) => node.component === expectedPrimaryComponent)).toBe(true);
      expect(spec.components.some((node) => node.component === "TextBlock")).toBe(false);
    },
  );
});
