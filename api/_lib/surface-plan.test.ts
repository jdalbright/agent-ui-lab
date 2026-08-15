import { describe, expect, it } from "vitest";
import type { ClientContext, SourceRecord } from "../../shared/schemas.js";
import { validateSurfaceSpec } from "../../shared/surface-validation.js";
import type { GeminiRetrievalResult } from "./gemini.js";
import {
  SURFACE_RECIPE_IDS,
  SurfacePlanSchema,
  buildFallbackSurfacePlan,
  compileSurfacePlan,
  evaluateSurfacePlanQuality,
  validateSurfacePlan,
  type SurfacePlan,
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
      {
        type: "table",
        caption: "Adoption trend data",
        columns: ["Option", "Now", "Next", "Later"],
        rows: [
          ["Option Alpha", "8", "7", "6"],
          ["Option Beta", "4", "7", "9"],
        ],
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

  it("requires each recipe's defining module immediately after its primary answer", () => {
    const plan = structuredClone(plansByRecipe["weather.outlook"]);
    const modules = plan.modules as Array<Record<string, unknown>>;
    modules.splice(1, 0, {
      type: "hourly",
      variant: "strip",
      label: "Next two hours",
      locationIndex: 0,
      hourIndexes: [0, 1],
    });

    const result = validateSurfacePlan(plan, validationContextFor("weather.outlook"));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/defining daily module.*immediately/i);
  });

  it.each([
    ["weather.decision", "snapshot"],
    ["comparison.verdict", "balanced"],
  ] as const)("rejects the wrong primary semantic variant for %s", (recipeId, variant) => {
    const plan = structuredClone(plansByRecipe[recipeId]);
    (plan.modules as Array<Record<string, unknown>>)[0].variant = variant;

    const result = validateSurfacePlan(plan, validationContextFor(recipeId));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/requires the .* variant/i);
  });

  it("rejects optional modules that violate the recipe's canonical semantic order", () => {
    const plan = structuredClone(plansByRecipe["weather.snapshot"]);
    const modules = plan.modules as Array<Record<string, unknown>>;
    const metricsIndex = modules.findIndex((module) => module.type === "metrics");
    const [metrics] = modules.splice(metricsIndex, 1);
    const sourceIndex = modules.findIndex((module) => module.type === "sources");
    modules.splice(sourceIndex, 0, {
      type: "alerts",
      locationIndex: 0,
      alertIndexes: [0],
    }, metrics);

    const result = validateSurfacePlan(plan, validationContextFor("weather.snapshot"));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/canonical semantic order/i);
  });

  it.each([
    "Show me Raleigh for the next five days.",
    "Show me Raleigh for the next two weeks.",
    "Show me Raleigh for the seven-day period.",
  ])("selects the outlook recipe for a word-number weather range: %s", (prompt) => {
    const plan = structuredClone(plansByRecipe["weather.snapshot"]);
    const result = validateSurfacePlan(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
      prompt,
      clientContext,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/requested weather\.outlook intent/i);
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

  it.each([
    ["raw URL", "Read https://attacker.example/payload before rendering."],
    ["www URL", "Read www.attacker.example/payload before rendering."],
    ["HTML tag", "Render <img src=x onerror=alert(1)> as the answer."],
    ["slash-delimited markup", "Render <svg/onload=alert(1)> as the answer."],
    ["JavaScript scheme", "Open javascript:alert(document.cookie) now."],
    ["data scheme", "Open data:text/html,<script>alert(1)</script> now."],
    ["VBScript scheme", "Open vbscript:msgbox('x') now."],
  ])("rejects %s content in model-authored plan text", (_label, unsafeText) => {
    const plan = structuredClone(plansByRecipe["research.brief"]);
    const lead = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "lead",
    );
    lead!.summary = unsafeText;

    expect(SurfacePlanSchema.safeParse(plan).success).toBe(false);
  });

  it("applies the text boundary to nested cells while preserving ordinary technical prose", () => {
    const unsafePlan = structuredClone(plansByRecipe["comparison.verdict"]);
    const table = (unsafePlan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "table",
    );
    const rows = table!.rows as string[][];
    rows[0][1] = "See https://attacker.example/details";

    const legitimatePlan = structuredClone(plansByRecipe["research.brief"]);
    const lead = (legitimatePlan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "lead",
    );
    lead!.summary =
      "HTML, CSS, and JavaScript remain application-owned; Node.js is discussed as ordinary prose.";

    expect(SurfacePlanSchema.safeParse(unsafePlan).success).toBe(false);
    expect(SurfacePlanSchema.safeParse(legitimatePlan).success).toBe(true);
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

  it.each([
    [0, true],
    [1, true],
    [2, false],
  ] as const)(
    "allows at most one recommended option in an authored verdict (%i recommended)",
    (recommendedCount, expectedSuccess) => {
      const plan = structuredClone(plansByRecipe["comparison.verdict"]);
      const summary = (plan.modules as Array<Record<string, unknown>>).find(
        (module) => module.type === "summary",
      );
      const items = summary?.items as Array<Record<string, unknown>>;
      items.forEach((item, index) => {
        item.recommended = index < recommendedCount;
      });

      const result = validateSurfacePlan(plan, {
        sources: searchSources,
        evidence: [],
      });

      expect(result.success).toBe(expectedSuccess);
      if (!result.success) expect(result.issues.join(" ")).toMatch(/at most one option/i);
    },
  );

  it("requires exactly one final SourceList whose IDs cover every cited module and item", () => {
    const incomplete = structuredClone(plansByRecipe["research.claims"]);
    const sourceModule = (incomplete.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "sources",
    );
    sourceModule!.sourceIds = [searchSources[0].id];

    const incompleteResult = validateSurfacePlan(incomplete, {
      sources: searchSources,
      evidence: [],
    });
    expect(incompleteResult.success).toBe(false);
    if (!incompleteResult.success) {
      expect(incompleteResult.issues.join(" ")).toMatch(/final sources|cover|cited/i);
    }

    const missing = structuredClone(plansByRecipe["research.brief"]);
    missing.modules = (missing.modules as Array<{ type: string }>).filter(
      (module) => module.type !== "sources",
    );
    const missingResult = validateSurfacePlan(missing, { sources: searchSources, evidence: [] });
    expect(missingResult.success).toBe(false);
    if (!missingResult.success) expect(missingResult.issues.join(" ")).toMatch(/exactly one.*sources/i);
  });

  it("requires support and challenge stances for an explicit two-sided research request", () => {
    const plan = structuredClone(plansByRecipe["research.claims"]);
    const evidence = (plan.modules as Array<{
      type: string;
      items?: Array<Record<string, unknown>>;
    }>).find((module) => module.type === "evidence");
    if (!evidence?.items) {
      throw new TypeError("Research claims fixture is missing evidence.");
    }
    for (const item of evidence.items) item.stance = "neutral";

    const result = validateSurfacePlan(plan, {
      sources: searchSources,
      evidence: [],
      prompt: "Find evidence for and against this claim.",
      clientContext,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.stringMatching(/supporting evidence/i),
        expect.stringMatching(/challenging evidence/i),
      ]));
    }
  });

  it("fails the production requested-coverage check for all-neutral two-sided claims", () => {
    const prompt = "Find evidence for and against this claim.";
    const validPlan = SurfacePlanSchema.parse(plansByRecipe["research.claims"]);
    const spec = compileSurfacePlan({
      plan: validPlan,
      retrieval: researchRetrieval,
      clientContext,
      prompt,
    });
    const neutralPlan = structuredClone(validPlan);
    const evidence = neutralPlan.modules.find((module) => module.type === "evidence");
    if (!evidence || evidence.type !== "evidence") {
      throw new TypeError("Research claims fixture is missing evidence.");
    }
    for (const item of evidence.items) item.stance = "neutral";

    const checks = evaluateSurfacePlanQuality(neutralPlan, {
      sources: searchSources,
      evidence: [],
      prompt,
      clientContext,
    }, spec);

    expect(checks.requested_coverage).toBe(false);
  });

  it.each([
    "Show me the 7-day forecast for Raleigh.",
    "Show me the seven-day forecast for Raleigh.",
    "Show me the next five days in Raleigh.",
  ])("rejects a one-day selection for the requested range: %s", (prompt) => {
    const retrieval = structuredClone(weatherRetrieval);
    const weatherResult = retrieval.evidence[0].result as {
      locations: Array<typeof raleighWeather>;
    };
    weatherResult.locations[0].daily = Array.from({ length: 7 }, (_, index) => ({
      ...raleighWeather.daily[index % raleighWeather.daily.length],
      date: `2026-08-${String(index + 2).padStart(2, "0")}`,
    }));
    const plan = structuredClone(plansByRecipe["weather.outlook"]);
    const daily = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "daily",
    );
    daily!.dayIndexes = [0];

    const result = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/(?:7|5)-day range.*not fully covered/i);
  });

  it("rejects a trend whose chart and table measurements differ", () => {
    const plan = structuredClone(plansByRecipe["comparison.trend"]);
    const table = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "table",
    );
    (table!.rows as string[][])[0][1] = "9999";

    const result = validateSurfacePlan(plan, { sources: searchSources, evidence: [] });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/chart.*table.*aligned/i);
  });

  it("aligns complete currency, signed, decimal, and accounting table values with chart data", () => {
    const plan = structuredClone(plansByRecipe["comparison.trend"]);
    const chart = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "chart",
    );
    const table = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "table",
    );
    (chart!.series as Array<Record<string, unknown>>)[0].values = [1200.5, -7, 6];
    (table!.rows as string[][])[0] = ["Option Alpha", "$1,200.50", "(7.00)", "+6.00"];

    const result = validateSurfacePlan(plan, { sources: searchSources, evidence: [] });

    expect(result.success).toBe(true);
  });

  it("rejects malformed formatted table values instead of extracting a partial chart value", () => {
    const plan = structuredClone(plansByRecipe["comparison.trend"]);
    const chart = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "chart",
    );
    const table = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "table",
    );
    (chart!.series as Array<Record<string, unknown>>)[0].values = [1200, 7, 6];
    (table!.rows as string[][])[0][1] = "$1,200 or $2,400";

    const result = validateSurfacePlan(plan, { sources: searchSources, evidence: [] });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/chart.*table.*aligned/i);
  });

  it("preflights compiler expansion against the 60-node surface budget", () => {
    const plan = structuredClone(plansByRecipe["weather.snapshot"]);
    const metrics = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "metrics",
    );
    const sources = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "sources",
    );
    plan.modules = [
      (plan.modules as Array<Record<string, unknown>>)[0],
      ...Array.from({ length: 9 }, () => structuredClone(metrics!)),
      sources!,
    ];

    const result = validateSurfacePlan(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/60-node budget/i);
  });
});

describe("weather-backed comparison integrity", () => {
  function weatherComparisonFixture() {
    const retrieval = structuredClone(weatherRetrieval);
    const weatherResult = retrieval.evidence[0].result as {
      locations: Array<typeof raleighWeather>;
    };
    weatherResult.locations.push({
      ...structuredClone(raleighWeather),
      location: {
        name: "Charlotte, NC",
        latitude: 35.2271,
        longitude: -80.8431,
        placeId: "charlotte-place",
      },
      current: {
        ...structuredClone(raleighWeather.current),
        temperature: 77,
        feelsLike: 79,
        precipitationProbability: 24,
        conditionText: "Cloudy",
        conditionKey: "cloudy" as const,
      },
      hourly: raleighWeather.hourly.map((hour, index) => ({
        ...structuredClone(hour),
        temperature: 77 + index,
        precipitationProbability: 24 - index,
      })),
      daily: raleighWeather.daily.map((day, index) => ({
        ...structuredClone(day),
        high: 80 + index,
        low: 64 + index,
        precipitationProbability: 45 - index * 5,
      })),
      alerts: [],
    });
    const sourceIds = retrieval.sources.map((source) => source.id);
    const plan = {
      kind: "comparison",
      recipeId: "comparison.trend",
      density: "detailed",
      emphasis: "trend",
      modules: [
        {
          type: "summary",
          variant: "balanced",
          title: "Raleigh and Charlotte weather",
          recommendation: "Compare the provider-observed conditions and trend.",
          locationIndexes: [0, 1],
          recommendedLocationIndex: 1,
          sourceIds,
        },
        {
          type: "chart",
          variant: "line",
          title: "Two-hour temperature trend",
          locationIndexes: [0, 1],
          forecastKind: "hourly",
          forecastIndexes: [0, 1],
          metric: "temperature",
          sourceIds,
        },
        {
          type: "table",
          caption: "Temperature trend data",
          locationIndexes: [0, 1],
          forecastKind: "hourly",
          forecastIndexes: [0, 1],
          metric: "temperature",
          sourceIds,
        },
        { type: "sources", label: "Weather sources", sourceIds },
      ],
    };
    return { retrieval, plan };
  }

  it("rejects model-authored 9999 weather values and compiles only trusted measurements", () => {
    const { retrieval, plan } = weatherComparisonFixture();
    const authored = structuredClone(plansByRecipe["comparison.trend"]);
    const chart = (authored.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "chart",
    );
    (chart!.series as Array<{ values: number[] }>)[0].values[0] = 9999;
    const authoredResult = validateSurfacePlan(authored, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
    });
    expect(authoredResult.success).toBe(false);
    if (!authoredResult.success) {
      expect(authoredResult.issues.join(" ")).toMatch(/weather-backed.*bounded evidence references/i);
    }

    const narratedMeasurement = structuredClone(plan);
    const summary = (narratedMeasurement.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "summary",
    );
    summary!.recommendation = "Raleigh will be 9999°F.";
    const narrativeResult = validateSurfacePlan(narratedMeasurement, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
    });
    expect(narrativeResult.success).toBe(false);
    if (!narrativeResult.success) {
      expect(narrativeResult.issues.join(" ")).toMatch(/model-authored measurements/i);
    }

    const narratedBareNumbers = structuredClone(plan);
    const bareSummary = (narratedBareNumbers.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "summary",
    );
    bareSummary!.recommendation = "Raleigh reaches 9999 while Charlotte stays at 1.";
    const bareNumberResult = validateSurfacePlan(narratedBareNumbers, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
    });
    expect(bareNumberResult.success).toBe(false);
    if (!bareNumberResult.success) {
      expect(bareNumberResult.issues.join(" ")).toMatch(/ungrounded numeric claim/i);
    }

    const parsed = SurfacePlanSchema.parse(plan);
    const spec = compileSurfacePlan({ plan: parsed, retrieval, clientContext });
    const compiledChart = spec.components.find((node) => node.component === "ComparisonChart");
    const compiledSummary = spec.components.find((node) => node.component === "ComparisonSummary");
    const compiledTable = spec.components.find((node) => node.component === "ComparisonTable");
    expect(compiledChart).toMatchObject({
      series: [
        { label: "Raleigh, NC", values: [82, 83] },
        { label: "Charlotte, NC", values: [77, 78] },
      ],
    });
    expect(JSON.stringify([compiledSummary, compiledTable, compiledChart])).not.toContain("9999");
  });

  it("rejects a four-city plan when one prompt-requested city is absent from evidence", () => {
    const { retrieval } = weatherComparisonFixture();
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations[1].location = {
      name: "Durham, NC",
      latitude: 35.994,
      longitude: -78.8986,
      placeId: "durham-place",
    };
    result.locations.push({
      ...structuredClone(result.locations[1]),
      location: {
        name: "Charlotte, NC",
        latitude: 35.2271,
        longitude: -80.8431,
        placeId: "charlotte-place",
      },
    });
    (retrieval.evidence[0].arguments as { locations?: string[] }).locations = [
      "Raleigh",
      "Durham",
      "Charlotte",
      "Asheville",
    ];
    const sourceIds = retrieval.sources.map((source) => source.id);
    const plan = {
      kind: "comparison",
      recipeId: "comparison.scorecard",
      density: "detailed",
      emphasis: "evidence",
      modules: [
        {
          type: "summary",
          variant: "balanced",
          title: "Outdoor brunch weather scorecard",
          recommendation: "Compare the provider-observed conditions for each available city.",
          locationIndexes: [0, 1, 2],
          sourceIds,
        },
        {
          type: "table",
          caption: "Current brunch conditions",
          locationIndexes: [0, 1, 2],
          forecastKind: "current",
          metrics: ["temperature", "precipitation", "wind"],
          sourceIds,
        },
        { type: "sources", label: "Weather sources", sourceIds },
      ],
    };

    const validation = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt: "Score Raleigh, Durham, Charlotte, and Asheville for a Sunday outdoor brunch.",
      clientContext,
    });

    expect(validation.success).toBe(false);
    if (!validation.success) expect(validation.issues.join(" ")).toMatch(/Asheville/i);
  });

  it("extracts locations after a weather-for phrase without treating weather as a city", () => {
    const { retrieval, plan } = weatherComparisonFixture();
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations[1].location = {
      name: "Durham, NC",
      latitude: 35.994,
      longitude: -78.8986,
      placeId: "durham-place",
    };
    const validation = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt: "Compare the weather for Raleigh and Charlotte.",
      clientContext,
    });

    expect(validation.success).toBe(false);
    if (!validation.success) {
      expect(validation.issues.join(" ")).toMatch(/Charlotte/i);
      expect(validation.issues.join(" ")).not.toMatch(/missing from evidence: weather/i);
    }
  });

  it("accepts a requested alias when geocoding resolves a different canonical place name", () => {
    const retrieval = structuredClone(weatherRetrieval);
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations[0].location = {
      name: "New York, NY, USA",
      latitude: 40.7128,
      longitude: -74.006,
      placeId: "new-york-place",
    };
    (retrieval.evidence[0].arguments as { location?: string }).location = "NYC";
    const plan = structuredClone(plansByRecipe["weather.snapshot"]);

    const validation = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt: "What is the weather in NYC?",
      clientContext,
    });

    expect(validation).toMatchObject({ success: true });
  });

  it.each([
    ["What is the weather in Raleigh right now?", /Raleigh/i],
    ["Weather in New Orleans?", /New Orleans/i],
    ["Show Raleigh weather right now.", /Raleigh/i],
  ] as const)("rejects wrong-city evidence for: %s", (prompt, requestedLocation) => {
    const retrieval = structuredClone(weatherRetrieval);
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations[0].location = {
      name: "New York, NY, USA",
      latitude: 40.7128,
      longitude: -74.006,
      placeId: "new-york-place",
    };
    (retrieval.evidence[0].arguments as { location?: string }).location = "New York, NY";
    const plan = structuredClone(plansByRecipe["weather.snapshot"]);

    const validation = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    });

    expect(validation.success).toBe(false);
    if (!validation.success) expect(validation.issues.join(" ")).toMatch(requestedLocation);
  });

  it("extracts locations from a versus prompt without a compare verb", () => {
    const { retrieval, plan } = weatherComparisonFixture();
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations[1].location = {
      name: "Durham, NC",
      latitude: 35.994,
      longitude: -78.8986,
      placeId: "durham-place",
    };
    const validation = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt: "Raleigh vs Asheville for brunch.",
      clientContext,
    });

    expect(validation.success).toBe(false);
    if (!validation.success) expect(validation.issues.join(" ")).toMatch(/Asheville/i);
  });

  it("extracts every city from a comma-separated plain compare list", () => {
    const { retrieval, plan } = weatherComparisonFixture();
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations.push({
      ...structuredClone(result.locations[1]),
      location: {
        name: "Durham, NC",
        latitude: 35.994,
        longitude: -78.8986,
        placeId: "durham-place",
      },
    });
    for (const module of plan.modules as Array<Record<string, unknown>>) {
      if (module.type === "summary" || module.type === "chart" || module.type === "table") {
        module.locationIndexes = [0, 1, 2];
      }
    }
    const validation = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt: "Compare Raleigh, Charlotte, and Asheville weather.",
      clientContext,
    });

    expect(validation.success).toBe(false);
    if (!validation.success) expect(validation.issues.join(" ")).toMatch(/Asheville/i);
  });

  it("rejects a Monday-to-Friday request represented by only two daily records", () => {
    const { retrieval, plan } = weatherComparisonFixture();
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations.forEach((location, locationIndex) => {
      location.daily = Array.from({ length: 7 }, (_, dayIndex) => ({
        ...structuredClone(raleighWeather.daily[dayIndex % raleighWeather.daily.length]),
        date: `2026-08-${String(dayIndex + 2).padStart(2, "0")}`,
        high: 80 + locationIndex * 5 + dayIndex,
      }));
    });
    for (const module of plan.modules as Array<Record<string, unknown>>) {
      if (module.type === "chart" || module.type === "table") {
        module.forecastKind = "daily";
        module.forecastIndexes = [1, 2];
        module.metric = "high";
      }
      if (module.type === "chart") module.title = "Weekday high trend";
      if (module.type === "table") module.caption = "Weekday high data";
    }

    const validation = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt: "Compare Raleigh and Charlotte from Monday to Friday.",
      clientContext,
    });

    expect(validation.success).toBe(false);
    if (!validation.success) expect(validation.issues.join(" ")).toMatch(/named day index/i);
  });

  it("aligns daily comparison values by ISO date across provider time zones", () => {
    const { retrieval, plan } = weatherComparisonFixture();
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    const tokyo = result.locations[0];
    const honolulu = result.locations[1];
    tokyo.location = {
      name: "Tokyo, Japan",
      latitude: 35.6762,
      longitude: 139.6503,
      placeId: "tokyo-place",
    };
    tokyo.current.timeZone = "Asia/Tokyo";
    tokyo.daily = [
      { ...structuredClone(raleighWeather.daily[0]), date: "2026-08-02", high: 90 },
      { ...structuredClone(raleighWeather.daily[1]), date: "2026-08-03", high: 91 },
    ];
    honolulu.location = {
      name: "Honolulu, HI",
      latitude: 21.3099,
      longitude: -157.8581,
      placeId: "honolulu-place",
    };
    honolulu.current.timeZone = "Pacific/Honolulu";
    honolulu.daily = [
      { ...structuredClone(raleighWeather.daily[0]), date: "2026-08-01", high: 60 },
      { ...structuredClone(raleighWeather.daily[0]), date: "2026-08-02", high: 70 },
      { ...structuredClone(raleighWeather.daily[1]), date: "2026-08-03", high: 71 },
    ];
    delete (retrieval.evidence[0].arguments as { location?: string }).location;
    (retrieval.evidence[0].arguments as { locations?: string[] }).locations = [
      "Tokyo",
      "Honolulu",
    ];
    for (const module of plan.modules as Array<Record<string, unknown>>) {
      if (module.type === "chart" || module.type === "table") {
        module.forecastKind = "daily";
        module.forecastIndexes = [0, 1];
        module.metric = "high";
      }
      if (module.type === "summary") {
        module.title = "Tokyo and Honolulu outlook";
        module.recommendation = "Compare the provider-observed daily highs.";
      }
      if (module.type === "chart") module.title = "Daily high trend";
      if (module.type === "table") module.caption = "Daily high data";
    }

    const parsed = SurfacePlanSchema.parse(plan);
    expect(
      validateSurfacePlan(parsed, {
        sources: retrieval.sources,
        evidence: retrieval.evidence,
      }),
    ).toMatchObject({ success: true });
    const spec = compileSurfacePlan({ plan: parsed, retrieval, clientContext });
    expect(spec.components.find((node) => node.component === "ComparisonChart")).toMatchObject({
      series: [
        { label: "Tokyo, Japan", values: [90, 91] },
        { label: "Honolulu, HI", values: [70, 71] },
      ],
    });
    expect(spec.components.find((node) => node.component === "ComparisonTable")).toMatchObject({
      rows: [
        expect.arrayContaining(["90°F", "70°F"]),
        expect.arrayContaining(["91°F", "71°F"]),
      ],
    });
  });

  it("aligns tomorrow to each location's local calendar and validates the evidence winner", () => {
    const retrieval = structuredClone(weatherRetrieval);
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    const raleigh = structuredClone(raleighWeather);
    raleigh.current.observedAt = "2026-08-02T23:30:00.000Z";
    raleigh.daily = [
      { ...structuredClone(raleighWeather.daily[0]), date: "2026-08-03", high: 80 },
      { ...structuredClone(raleighWeather.daily[1]), date: "2026-08-04", high: 81 },
    ];
    const tokyo = structuredClone(raleighWeather);
    tokyo.location = {
      name: "Tokyo, Japan",
      latitude: 35.6762,
      longitude: 139.6503,
      placeId: "tokyo-place",
    };
    tokyo.current.observedAt = "2026-08-02T23:30:00.000Z";
    tokyo.current.timeZone = "Asia/Tokyo";
    tokyo.daily = [
      { ...structuredClone(raleighWeather.daily[0]), date: "2026-08-03", high: 100 },
      { ...structuredClone(raleighWeather.daily[1]), date: "2026-08-04", high: 70 },
    ];
    result.locations = [raleigh, tokyo];
    delete (retrieval.evidence[0].arguments as { location?: string }).location;
    (retrieval.evidence[0].arguments as { locations?: string[] }).locations = ["Raleigh", "Tokyo"];
    const prompt = "Which city is warmer tomorrow: Raleigh or Tokyo?";

    const plan = buildFallbackSurfacePlan({ kind: "comparison", prompt, retrieval, clientContext });
    const spec = compileSurfacePlan({ plan, retrieval, clientContext, prompt });

    expect(plan.modules.find((module) => module.type === "summary")).toMatchObject({
      recommendedLocationIndex: 0,
    });
    expect(spec.components.find((node) => node.component === "ComparisonTable")).toMatchObject({
      rows: [["Tomorrow", "80°F", "70°F"]],
    });
  });

  it("rejects a weather recommendation that contradicts a deterministic objective", () => {
    const { retrieval, plan } = weatherComparisonFixture();
    const prompt = "Compare Raleigh and Charlotte over the next two hours and choose the drier location.";

    const validation = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    });

    expect(validation.success).toBe(false);
    if (!validation.success) {
      expect(validation.issues.join(" ")).toMatch(/deterministic evidence winner/i);
    }
  });
});

describe("requested comparison coverage", () => {
  it.each([
    ["Compare Framework A and Framework B on warranty length and repairability.", ["warranty length", "repairability"]],
    ["Compare Framework A and Framework B for warranty length and repairability.", ["warranty length", "repairability"]],
    ["Compare Framework A and Framework B for repairability.", ["repairability"]],
    ["Framework A versus Framework B: warranty length and repairability.", ["warranty length", "repairability"]],
    ["Score Framework A and Framework B using maintainability and ecosystem maturity.", ["maintainability", "ecosystem maturity"]],
    ["Compare Framework A and Framework B with warranty length and repairability.", ["warranty length", "repairability"]],
    ["Compare Framework A and Framework B using bundle size and accessibility.", ["bundle size", "accessibility"]],
  ] as const)("rejects a scorecard that omits explicitly requested criteria: %s", (prompt, criteria) => {
    const plan = structuredClone(plansByRecipe["comparison.scorecard"]);
    const validation = validateSurfacePlan(plan, {
      sources: searchSources,
      evidence: [],
      prompt,
      clientContext,
    });

    expect(validation.success).toBe(false);
    if (!validation.success) {
      for (const criterion of criteria) {
        expect(validation.issues.join(" ")).toContain(criterion);
      }
    }
  });
});

describe("compileSurfacePlan", () => {
  it("refuses to compile a plan containing unsafe authored text", () => {
    const plan = structuredClone(plansByRecipe["research.brief"]);
    const lead = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "lead",
    );
    lead!.summary = "Use <script>location='https://attacker.example'</script> for the answer.";

    expect(() =>
      compileSurfacePlan({
        plan: plan as unknown as SurfacePlan,
        retrieval: researchRetrieval,
        clientContext,
      })
    ).toThrow(/cannot compile invalid SurfacePlan.*safe declarative text/i);
  });

  it("replaces an unsupported quantitative weather hero claim with trusted copy", () => {
    const plan = structuredClone(plansByRecipe["weather.snapshot"]);
    const hero = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "hero",
    );
    hero!.recommendationLabel = "Tomorrow";
    hero!.recommendationValue = "Tomorrow will be 81°F";
    hero!.recommendationDetail = "Meet at 7 PM, when the evidence-matched window begins.";

    const spec = compileSurfacePlan({
      plan: SurfacePlanSchema.parse(plan),
      retrieval: weatherRetrieval,
      clientContext,
    });
    const compiledHero = spec.components.find((node) => node.component === "WeatherHero");

    expect(compiledHero).toMatchObject({
      recommendationLabel: "Current conditions",
      recommendationValue: "Partly cloudy",
      recommendationDetail: "Provider-observed conditions for Raleigh, NC.",
    });
    expect(JSON.stringify(compiledHero)).not.toContain("Tomorrow will be 81°F");
    expect(JSON.stringify(compiledHero)).not.toContain("7 PM");
  });

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

  it("binds a WeatherAlert to its exact authority source when the provider supplies one", () => {
    const authority: SourceRecord = {
      id: "src_authority1",
      title: "National Weather Service",
      url: "https://weather.gov/alerts/heat-advisory",
      provider: "google-weather",
      accessedAt: "2026-08-02T14:00:00.000Z",
    };
    const cloned = structuredClone(weatherRetrieval);
    const result = cloned.evidence[0].result as {
      locations: Array<{ alerts: Array<Record<string, unknown>> }>;
    };
    result.locations[0].alerts[0].sourceAuthorityUri = authority.url;
    const retrieval: GeminiRetrievalResult = {
      ...cloned,
      sources: Object.freeze([Object.freeze(weatherSource), Object.freeze(authority)]),
    };
    const plan = structuredClone(plansByRecipe["weather.outlook"]);
    const sources = (plan.modules as Array<Record<string, unknown>>).find(
      (module) => module.type === "sources",
    );
    sources!.sourceIds = [weatherSource.id, authority.id];

    const spec = compileSurfacePlan({
      plan: SurfacePlanSchema.parse(plan),
      retrieval,
      clientContext,
    });

    expect(spec.components.find((node) => node.component === "WeatherAlert")).toMatchObject({
      title: "Heat advisory",
      sourceId: authority.id,
    });
    expect(spec.components.find((node) => node.component === "SourceList")).toMatchObject({
      sourceIds: [weatherSource.id, authority.id],
    });
  });

  it("requires every server-issued weather source in the final source list", () => {
    const additional: SourceRecord = {
      id: "src_weather2",
      title: "Weather alert authority",
      url: "https://weather.gov/alerts/raleigh",
      provider: "google-weather",
      accessedAt: "2026-08-02T14:00:00.000Z",
    };
    const retrieval: GeminiRetrievalResult = {
      ...structuredClone(weatherRetrieval),
      sources: Object.freeze([Object.freeze(weatherSource), Object.freeze(additional)]),
    };
    const plan = structuredClone(plansByRecipe["weather.snapshot"]);

    const result = validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/final sources.*src_weather2/i);
  });

  it("compiles a wettest-day recommendation from the referenced daily evidence", () => {
    const plan = structuredClone(plansByRecipe["weather.outlook"]);
    const dailyIndex = (plan.modules as Array<{ type: string }>).findIndex(
      (module) => module.type === "daily",
    );
    if (dailyIndex < 0) throw new TypeError("Outlook fixture is missing its daily module.");
    (plan.modules as unknown[]).splice(dailyIndex + 1, 0, {
      type: "recommendation",
      locationIndex: 0,
      dayIndex: 1,
      signal: "wettest",
    });

    const spec = compileSurfacePlan({
      plan: SurfacePlanSchema.parse(plan),
      retrieval: weatherRetrieval,
      clientContext,
    });

    expect(spec.components.find((node) => node.component === "RecommendationBand")).toMatchObject({
      label: "Wettest day",
      detail: "35% precipitation probability · 88°F high",
      confidence: "high",
    });
  });

  it("validates the requested activity and renders its window in the provider location timezone", () => {
    const cloned = structuredClone(weatherRetrieval);
    (cloned.evidence[0].arguments as { location?: string }).location = "Denver, CO";
    const result = cloned.evidence[0].result as {
      locations: Array<typeof raleighWeather>;
      activityWindows: Array<{
        location: typeof raleighWeather.location;
        activity?: string;
        startTime: string;
        endTime: string;
        label: string;
      }>;
    };
    result.locations[0].location = {
      name: "Denver, CO",
      latitude: 39.7392,
      longitude: -104.9903,
      placeId: "denver-place",
    };
    result.locations[0].current.timeZone = "America/Denver";
    result.activityWindows[0].location = result.locations[0].location;
    result.activityWindows[0].activity = "run";
    result.activityWindows[0].startTime = "2026-08-02T13:00:00.000Z";
    result.activityWindows[0].endTime = "2026-08-02T15:00:00.000Z";
    result.activityWindows[0].label = "2-hour run window at requested time";
    const plan = SurfacePlanSchema.parse(structuredClone(plansByRecipe["weather.decision"]));
    const prompt = "Can I take a 2-hour run at 7 AM in Denver today?";

    expect(
      validateSurfacePlan(plan, {
        sources: cloned.sources,
        evidence: cloned.evidence,
        prompt,
        clientContext,
      }),
    ).toMatchObject({ success: true });
    const spec = compileSurfacePlan({ plan, retrieval: cloned, clientContext });
    expect(spec.components.find((node) => node.component === "RecommendationBand")).toMatchObject({
      label: "2-hour run window at requested time",
      value: "7:00 AM–9:00 AM",
    });

    result.activityWindows[0].activity = "walk";
    result.activityWindows[0].label = "2-hour walk window at requested time";
    const mismatch = validateSurfacePlan(plan, {
      sources: cloned.sources,
      evidence: cloned.evidence,
      prompt,
      clientContext,
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) expect(mismatch.issues.join(" ")).toMatch(/requested run activity/i);
  });
});

describe("domain-specific deterministic SurfacePlan fallbacks", () => {
  function weatherTrendRetrieval(names: readonly string[], dates: readonly string[]) {
    const retrieval = structuredClone(weatherRetrieval);
    (retrieval.evidence[0].arguments as { location?: string; locations?: string[] }).locations = [
      ...names,
    ];
    delete (retrieval.evidence[0].arguments as { location?: string }).location;
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations = names.map((name, locationIndex) => ({
      ...structuredClone(raleighWeather),
      location: {
        name,
        latitude: 25 + locationIndex * 5,
        longitude: -80 - locationIndex * 10,
        placeId: `place-${locationIndex}`,
      },
      daily: dates.map((date, dayIndex) => ({
        ...structuredClone(raleighWeather.daily[dayIndex % raleighWeather.daily.length]),
        date,
        high: 80 + locationIndex * 4 + dayIndex,
      })),
    }));
    return retrieval;
  }

  it("sanitizes prompt and provider prose before building a deterministic fallback plan", () => {
    const unsafeRetrieval = structuredClone(researchRetrieval);
    unsafeRetrieval.outputText =
      "HTML and CSS remain useful. <script>alert(1)</script> Read https://attacker.example/details.";
    (unsafeRetrieval.sources as SourceRecord[])[0].title =
      "<strong>JavaScript documentation</strong> javascript:alert(1)";
    const prompt =
      "What evidence supports HTML, CSS, and JavaScript? See www.attacker.example/payload";

    const plan = buildFallbackSurfacePlan({
      kind: "research",
      prompt,
      retrieval: unsafeRetrieval,
      clientContext,
    });
    const serialized = JSON.stringify(plan);

    expect(serialized).toContain("HTML");
    expect(serialized).toContain("CSS");
    expect(serialized).toContain("JavaScript");
    expect(serialized).not.toMatch(/https?:\/\/|www\.|<\/?[a-z]|\b(?:javascript|data|vbscript)\s*:/i);
    expect(() => compileSurfacePlan({ plan, retrieval: unsafeRetrieval, clientContext, prompt })).not.toThrow();
  });

  it("sanitizes weather-provider prose copied into a deterministic fallback plan", () => {
    const unsafeRetrieval = structuredClone(weatherRetrieval);
    const result = unsafeRetrieval.evidence[0].result as {
      locations: Array<typeof raleighWeather>;
    };
    result.locations[0].location.name =
      "<strong>Raleigh</strong> https://attacker.example/location";
    result.locations[0].current.conditionText =
      "Clear <script>alert(1)</script> javascript:alert(1)";

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt: "What is the weather in Raleigh?",
      retrieval: unsafeRetrieval,
      clientContext,
    });
    const serialized = JSON.stringify(plan);

    expect(serialized).toContain("Raleigh");
    expect(serialized).toContain("Clear");
    expect(serialized).not.toMatch(/https?:\/\/|www\.|<\/?[a-z]|\b(?:javascript|data|vbscript)\s*:/i);
    expect(SurfacePlanSchema.safeParse(plan).success).toBe(true);
  });

  it("centers decision fallback hours on the deterministic activity window", () => {
    const prompt = "When should I walk in Raleigh?";
    const retrieval = structuredClone(weatherRetrieval);
    const result = retrieval.evidence[0].result as {
      locations: Array<typeof raleighWeather>;
      activityWindows: Array<{
        startTime: string;
        endTime: string;
      }>;
    };
    result.locations[0].hourly = Array.from({ length: 40 }, (_, index) => ({
      ...structuredClone(raleighWeather.hourly[index % raleighWeather.hourly.length]),
      startTime: new Date(Date.parse("2026-08-02T14:00:00.000Z") + index * 3_600_000).toISOString(),
      endTime: new Date(Date.parse("2026-08-02T15:00:00.000Z") + index * 3_600_000).toISOString(),
    }));
    result.activityWindows[0].startTime = result.locations[0].hourly[30].startTime;
    result.activityWindows[0].endTime = result.locations[0].hourly[32].endTime;

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval,
      clientContext,
    });

    expect(plan.modules.find((module) => module.type === "hourly")).toMatchObject({
      hourIndexes: [29, 30, 31, 32],
    });
  });

  it("preserves a named two-day weather comparison in the deterministic trend fallback", () => {
    const prompt = "Compare Raleigh and Charlotte temperatures this Saturday and Sunday.";
    const retrieval = weatherTrendRetrieval(
      ["Raleigh, NC", "Charlotte, NC"],
      ["2026-08-08", "2026-08-09"],
    );

    const plan = buildFallbackSurfacePlan({
      kind: "comparison",
      prompt,
      retrieval,
      clientContext,
    });

    expect(plan).toMatchObject({ recipeId: "comparison.trend", density: "detailed", emphasis: "trend" });
    expect(plan.modules.map((module) => module.type)).toEqual(["summary", "chart", "table", "sources"]);
    expect(validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
    expect(() => compileSurfacePlan({ plan, retrieval, clientContext, prompt })).not.toThrow();
  });

  it("uses detailed outlook metadata and preserves an explicit extreme-day callout", () => {
    const prompt = "Show Raleigh's five-day outlook and call out the wettest day.";
    const retrieval = structuredClone(weatherRetrieval);
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations[0].daily = Array.from({ length: 6 }, (_, index) => ({
      ...structuredClone(raleighWeather.daily[index % raleighWeather.daily.length]),
      date: `2026-08-${String(index + 3).padStart(2, "0")}`,
      precipitationProbability: index === 5 ? 99 : index === 3 ? 90 : 10 + index,
    }));

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval,
      clientContext,
    });

    expect(plan).toMatchObject({
      recipeId: "weather.outlook",
      density: "detailed",
      emphasis: "trend",
    });
    expect(plan.modules.map((module) => module.type)).toEqual([
      "hero",
      "daily",
      "recommendation",
      "sources",
    ]);
    expect(plan.modules.find((module) => module.type === "daily")).toMatchObject({
      dayIndexes: [0, 1, 2, 3, 4],
    });
    expect(plan.modules.find((module) => module.type === "recommendation")).toMatchObject({
      dayIndex: 3,
      signal: "wettest",
    });
    expect(validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
  });

  it("uses the requested local tomorrow record without requiring an activity window", () => {
    const prompt = "Show Tokyo weather tomorrow in ° C.";
    const retrieval = structuredClone(weatherRetrieval);
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    const location = result.locations[0];
    location.location = {
      name: "Tokyo, Japan",
      latitude: 35.6762,
      longitude: 139.6503,
      placeId: "tokyo-place",
    };
    location.current.timeZone = "Asia/Tokyo";
    location.current.observedAt = "2026-08-02T14:00:00.000Z";
    location.current.temperatureUnit = "C";
    location.hourly = location.hourly.map((hour) => ({ ...hour, temperatureUnit: "C" as const }));
    location.daily = location.daily.map((day) => ({ ...day, temperatureUnit: "C" as const }));
    result.locations[0] = location;
    (retrieval.evidence[0].arguments as { location?: string; units?: "metric" }).location = "Tokyo, Japan";
    (retrieval.evidence[0].arguments as { units?: "metric" }).units = "metric";

    const plan = buildFallbackSurfacePlan({ kind: "weather", prompt, retrieval, clientContext });

    expect(plan).toMatchObject({ recipeId: "weather.outlook" });
    expect(plan.modules.find((module) => module.type === "daily")).toMatchObject({
      dayIndexes: [1],
    });
    expect(plan.modules.some(
      (module) => module.type === "recommendation" && "activityWindowIndex" in module,
    )).toBe(false);
    expect(validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
  });

  it("uses hourly as the defining outlook module for an explicit hour range", () => {
    const prompt = "Show Raleigh weather for the next three hours.";

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval: weatherRetrieval,
      clientContext,
    });

    expect(plan).toMatchObject({ recipeId: "weather.outlook" });
    expect(plan.modules.map((module) => module.type)).toEqual(["hero", "hourly", "sources"]);
    expect(plan.modules[1]).toMatchObject({
      type: "hourly",
      hourIndexes: [0, 1, 2],
    });
    expect(validateSurfacePlan(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
  });

  it("builds and compiles a one-hour outlook", () => {
    const prompt = "Show Raleigh weather for the next 1 hour.";

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval: weatherRetrieval,
      clientContext,
    });

    expect(plan).toMatchObject({ recipeId: "weather.outlook" });
    expect(plan.modules.find((module) => module.type === "hourly")).toMatchObject({
      hourIndexes: [0],
    });
    expect(validateSurfacePlan(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
    expect(() => compileSurfacePlan({
      plan,
      retrieval: weatherRetrieval,
      clientContext,
      prompt,
    })).not.toThrow();
  });

  it("selects an exact future hour in the weather location's local time", () => {
    const prompt = "Show Tokyo weather at 9 AM next Tuesday.";
    const retrieval = structuredClone(weatherRetrieval);
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    const location = result.locations[0];
    location.location = {
      name: "Tokyo, Japan",
      latitude: 35.6762,
      longitude: 139.6503,
      placeId: "tokyo-place",
    };
    location.current.timeZone = "Asia/Tokyo";
    location.hourly = Array.from({ length: 240 }, (_, index) => ({
      ...structuredClone(raleighWeather.hourly[index % raleighWeather.hourly.length]),
      startTime: new Date(Date.parse("2026-08-02T14:00:00.000Z") + index * 3_600_000).toISOString(),
      endTime: new Date(Date.parse("2026-08-02T15:00:00.000Z") + index * 3_600_000).toISOString(),
    }));
    (retrieval.evidence[0].arguments as { location?: string }).location = "Tokyo, Japan";

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval,
      clientContext,
    });

    expect(plan).toMatchObject({ recipeId: "weather.outlook" });
    expect(plan.modules.find((module) => module.type === "hourly")).toMatchObject({
      label: "9:00 AM local outlook",
      locationIndex: 0,
      hourIndexes: [34],
    });
    expect(validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
    expect(compileSurfacePlan({ plan, retrieval, clientContext, prompt }).components.find(
      (node) => node.component === "HourlyForecast",
    )).toMatchObject({ items: [expect.objectContaining({ time: "9:00 AM" })] });
  });

  it("compares the requested local hour rather than a shared UTC timestamp", () => {
    const prompt = "Which city is warmer at 8 AM local tomorrow: Raleigh or London?";
    const retrieval = weatherTrendRetrieval(
      ["Raleigh, NC", "London, England"],
      ["2026-08-03", "2026-08-04"],
    );
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations[0].current.timeZone = "America/New_York";
    result.locations[1].current.timeZone = "Europe/London";
    result.locations.forEach((location, locationIndex) => {
      location.hourly = Array.from({ length: 48 }, (_, index) => ({
        ...structuredClone(raleighWeather.hourly[index % raleighWeather.hourly.length]),
        startTime: new Date(Date.parse("2026-08-02T14:00:00.000Z") + index * 3_600_000).toISOString(),
        endTime: new Date(Date.parse("2026-08-02T15:00:00.000Z") + index * 3_600_000).toISOString(),
        temperature: locationIndex === 0 && index === 22
          ? 90
          : locationIndex === 1 && index === 17
            ? 60
            : 70,
      }));
    });

    const plan = buildFallbackSurfacePlan({
      kind: "comparison",
      prompt,
      retrieval,
      clientContext,
    });

    expect(plan).toMatchObject({ recipeId: "comparison.verdict" });
    expect(plan.modules.find((module) => module.type === "summary")).toMatchObject({
      recommendedLocationIndex: 0,
    });
    expect(plan.modules.find((module) => module.type === "table")).toMatchObject({
      forecastKind: "hourly",
      forecastIndexes: [22],
      metric: "temperature",
    });
    expect(validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
    const spec = compileSurfacePlan({ plan, retrieval, clientContext, prompt });
    expect(spec.components.find((node) => node.component === "ComparisonSummary")).toMatchObject({
      items: [
        expect.objectContaining({ label: "Raleigh, NC", value: "90°F", recommended: true }),
        expect.objectContaining({ label: "London, England", value: "60°F", recommended: false }),
      ],
    });
    expect(spec.components.find((node) => node.component === "ComparisonTable")).toMatchObject({
      rows: [["8:00 AM local", "90°F", "60°F"]],
    });
  });

  it("routes every retrieved current-weather location through the compact comparison fallback", () => {
    const prompt = "Show current weather in Raleigh and Charlotte.";
    const retrieval = weatherTrendRetrieval(
      ["Raleigh, NC", "Charlotte, NC"],
      ["2026-08-03", "2026-08-04"],
    );

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval,
      clientContext,
    });

    expect(plan).toMatchObject({ kind: "comparison", recipeId: "comparison.verdict" });
    expect(plan.modules.find((module) => module.type === "table")).toMatchObject({
      locationIndexes: [0, 1],
      forecastKind: "current",
    });
    expect(validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });

    const spec = compileSurfacePlan({ plan, retrieval, clientContext, prompt });
    expect(spec.components.find((node) => node.component === "ComparisonTable")).toMatchObject({
      columns: ["Metric", "Raleigh, NC", "Charlotte, NC"],
    });
    expect(evaluateSurfacePlanQuality(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    }, spec)).toEqual(expect.objectContaining({
      requested_coverage: true,
      content_budget: true,
    }));
  });

  it("keeps the deterministic single-location snapshot within every production quality gate", () => {
    const prompt = "What is the weather in Raleigh right now?";
    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval: weatherRetrieval,
      clientContext,
    });
    const spec = compileSurfacePlan({ plan, retrieval: weatherRetrieval, clientContext, prompt });

    expect(Object.values(evaluateSurfacePlanQuality(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
      prompt,
      clientContext,
    }, spec))).toEqual(Array(8).fill(true));
  });

  it.each([
    ["driest", 0],
    ["warmest", 4],
    ["coolest", 0],
  ] as const)("preserves an explicit %s-day fallback recommendation", (signal, expectedIndex) => {
    const prompt = `Show Raleigh's five-day outlook and call out the ${signal} day.`;
    const retrieval = structuredClone(weatherRetrieval);
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations[0].daily = Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(raleighWeather.daily[index % raleighWeather.daily.length]),
      date: `2026-08-${String(index + 3).padStart(2, "0")}`,
      high: 80 + index,
      low: 60 + index,
      precipitationProbability: 10 + index,
    }));

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval,
      clientContext,
    });

    expect(plan.modules.find((module) => module.type === "recommendation")).toMatchObject({
      dayIndex: expectedIndex,
      signal,
    });
  });

  it("rejects an outlook that omits an explicitly requested extreme-day recommendation", () => {
    const prompt = "Show Raleigh's two-day outlook and call out the driest day.";
    const plan = structuredClone(plansByRecipe["weather.outlook"]);

    const result = validateSurfacePlan(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
      prompt,
      clientContext,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(" ")).toMatch(/driest-day recommendation/i);
  });

  it("includes a requested severe alert in the snapshot fallback", () => {
    const prompt = "Are there severe weather alerts in Raleigh right now?";

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval: weatherRetrieval,
      clientContext,
    });

    expect(plan).toMatchObject({ recipeId: "weather.snapshot" });
    expect(plan.modules.find((module) => module.type === "alerts")).toMatchObject({
      locationIndex: 0,
      alertIndexes: [0],
    });
    const spec = compileSurfacePlan({ plan, retrieval: weatherRetrieval, clientContext, prompt });
    expect(evaluateSurfacePlanQuality(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
      prompt,
      clientContext,
    }, spec).content_budget).toBe(true);
  });

  it("includes requested alerts after an outlook without breaking semantic order", () => {
    const prompt = "Show Raleigh's two-day outlook and any weather alerts.";

    const plan = buildFallbackSurfacePlan({
      kind: "weather",
      prompt,
      retrieval: weatherRetrieval,
      clientContext,
    });

    expect(plan.modules.map((module) => module.type)).toEqual([
      "hero",
      "daily",
      "alerts",
      "sources",
    ]);
    expect(validateSurfacePlan(plan, {
      sources: weatherRetrieval.sources,
      evidence: weatherRetrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
  });

  it.each([
    [
      "Which has better weather for a Saturday picnic: Raleigh or Asheville?",
      ["Raleigh, NC", "Asheville, NC"],
      ["2026-08-08"],
      "comparison.verdict",
    ],
    [
      "Score Raleigh, Durham, Charlotte, and Asheville for a Sunday outdoor brunch.",
      ["Raleigh, NC", "Durham, NC", "Charlotte, NC", "Asheville, NC"],
      ["2026-08-09"],
      "comparison.scorecard",
    ],
  ] as const)("preserves named-day evidence in fallback: %s", (prompt, names, dates, recipeId) => {
    const retrieval = weatherTrendRetrieval(names, dates);

    const plan = buildFallbackSurfacePlan({ kind: "comparison", prompt, retrieval, clientContext });

    expect(plan).toMatchObject({ recipeId });
    expect(plan.modules.find((module) => module.type === "table")).toMatchObject({
      forecastKind: "daily",
      forecastIndexes: [0],
      metric: "precipitation",
    });
    expect(validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
  });

  it("recognizes the exact QC06 chart request and preserves all five days in trend fallback", () => {
    const prompt = "Chart the next five days of highs for Miami, Denver, and Seattle.";
    const retrieval = weatherTrendRetrieval(
      ["Miami, FL", "Denver, CO", "Seattle, WA"],
      ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
    );

    const plan = buildFallbackSurfacePlan({
      kind: "comparison",
      prompt,
      retrieval,
      clientContext,
    });
    const chart = plan.modules.find((module) => module.type === "chart");
    const table = plan.modules.find((module) => module.type === "table");

    expect(plan).toMatchObject({ kind: "comparison", recipeId: "comparison.trend" });
    expect(chart).toMatchObject({
      type: "chart",
      forecastKind: "daily",
      forecastIndexes: [0, 1, 2, 3, 4],
      metric: "high",
    });
    expect(table).toMatchObject({
      type: "table",
      forecastKind: "daily",
      forecastIndexes: [0, 1, 2, 3, 4],
      metric: "high",
    });
    expect(validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
    expect(() => compileSurfacePlan({ plan, retrieval, clientContext, prompt })).not.toThrow();
  });

  it("preserves an hourly range in a weather-comparison trend fallback", () => {
    const prompt = "Chart the next three hours of temperature for Raleigh and Charlotte.";
    const retrieval = weatherTrendRetrieval(
      ["Raleigh, NC", "Charlotte, NC"],
      ["2026-08-03", "2026-08-04"],
    );

    const plan = buildFallbackSurfacePlan({ kind: "comparison", prompt, retrieval, clientContext });

    expect(plan).toMatchObject({ recipeId: "comparison.trend" });
    expect(plan.modules.find((module) => module.type === "chart")).toMatchObject({
      forecastKind: "hourly",
      forecastIndexes: [0, 1, 2],
      metric: "temperature",
    });
    expect(plan.modules.find((module) => module.type === "table")).toMatchObject({
      forecastKind: "hourly",
      forecastIndexes: [0, 1, 2],
      metric: "temperature",
    });
    expect(validateSurfacePlan(plan, {
      sources: retrieval.sources,
      evidence: retrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
  });

  it("compiles the full supported 24-hour weather-comparison range", () => {
    const prompt = "Chart the next 24 hours of temperature for Raleigh and Charlotte.";
    const retrieval = weatherTrendRetrieval(
      ["Raleigh, NC", "Charlotte, NC"],
      ["2026-08-03", "2026-08-04"],
    );
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    for (const location of result.locations) {
      location.hourly = Array.from({ length: 24 }, (_, index) => ({
        ...structuredClone(raleighWeather.hourly[index % raleighWeather.hourly.length]),
        startTime: new Date(Date.parse("2026-08-02T14:00:00.000Z") + index * 3_600_000).toISOString(),
      }));
    }

    const plan = buildFallbackSurfacePlan({ kind: "comparison", prompt, retrieval, clientContext });

    expect(plan.modules.find((module) => module.type === "chart")).toMatchObject({
      forecastIndexes: Array.from({ length: 24 }, (_, index) => index),
    });
    expect(() => compileSurfacePlan({ plan, retrieval, clientContext, prompt })).not.toThrow();
  });

  it("refuses to compile a fallback that drops a requested word-number range", () => {
    const prompt = "Chart the next five days of highs for Miami, Denver, and Seattle.";
    const retrieval = weatherTrendRetrieval(
      ["Miami, FL", "Denver, CO", "Seattle, WA"],
      ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
    );
    const complete = buildFallbackSurfacePlan({
      kind: "comparison",
      prompt,
      retrieval,
      clientContext,
    });
    const incomplete = structuredClone(complete);
    for (const module of incomplete.modules) {
      if ((module.type === "chart" || module.type === "table") && "locationIndexes" in module) {
        module.forecastIndexes = [0, 1];
      }
    }

    expect(() =>
      compileSurfacePlan({ plan: incomplete, retrieval, clientContext, prompt })
    ).toThrow(/(?:5|five)-day range.*not fully covered/i);
  });

  it("never copies a generated weather-comparison claim into the deterministic fallback", () => {
    const retrieval = structuredClone(weatherRetrieval);
    const result = retrieval.evidence[0].result as { locations: Array<typeof raleighWeather> };
    result.locations.push({
      ...structuredClone(raleighWeather),
      location: {
        name: "Durham, NC",
        latitude: 35.994,
        longitude: -78.8986,
        placeId: "durham-place",
      },
    });
    retrieval.outputText = "Raleigh reaches 9999 while Durham stays at 1.";

    const plan = buildFallbackSurfacePlan({
      kind: "comparison",
      prompt: "Compare Raleigh and Durham weather.",
      retrieval,
      clientContext,
    });
    const spec = compileSurfacePlan({ plan, retrieval, clientContext });

    expect(JSON.stringify(plan)).not.toContain("9999");
    expect(JSON.stringify(spec)).not.toContain("9999");
    expect(JSON.stringify(plan)).toContain(
      "Provider-observed conditions are shown side by side without a generated winner.",
    );
  });

  it("uses a scorecard fallback for a scored search-backed comparison", () => {
    const prompt = "Score React and Angular on renderer and support.";
    const plan = buildFallbackSurfacePlan({
      kind: "comparison",
      prompt,
      retrieval: comparisonRetrieval,
      clientContext,
    });

    expect(plan).toMatchObject({
      recipeId: "comparison.scorecard",
      emphasis: "answer",
    });
    expect(plan.modules.map((module) => module.type)).toEqual(["summary", "table", "sources"]);
    expect(plan.modules.find((module) => module.type === "summary")).toMatchObject({
      title: "React and Angular scorecard",
      items: [{ label: "React" }, { label: "Angular" }],
    });
    expect(plan.modules.find((module) => module.type === "table")).toMatchObject({
      caption: "Requested criteria without invented scores",
      columns: ["Criterion", "React", "Angular"],
      rows: [
        ["renderer", "Not deterministically scored", "Not deterministically scored"],
        ["support", "Not deterministically scored", "Not deterministically scored"],
      ],
    });
    expect(validateSurfacePlan(plan, {
      sources: comparisonRetrieval.sources,
      evidence: comparisonRetrieval.evidence,
      prompt,
      clientContext,
    })).toMatchObject({ success: true });
  });

  it("does not present retrieval access time as a researched event date", () => {
    const plan = buildFallbackSurfacePlan({
      kind: "research",
      prompt: "Show the release timeline.",
      retrieval: researchRetrieval,
      clientContext,
    });
    const timeline = plan.modules.find((module) => module.type === "timeline");

    expect(timeline && "items" in timeline ? timeline.items.map((item) => item.date) : []).toEqual([
      "Date not established",
      "Date not established",
    ]);
    expect(JSON.stringify(timeline)).not.toContain(searchSources[0].accessedAt.slice(0, 10));
  });

  it("fails closed instead of manufacturing opposing stances in a claims fallback", () => {
    expect(() =>
      buildFallbackSurfacePlan({
        kind: "research",
        prompt: "What evidence supports and challenges this claim?",
        retrieval: researchRetrieval,
        clientContext,
      })
    ).toThrow(/supporting evidence.*challenging evidence/i);
  });

  it.each([
    ["weather", "weather.snapshot", "WeatherHero"],
    ["comparison", "comparison.verdict", "ComparisonSummary"],
    ["research", "research.timeline", "ResearchLead"],
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
