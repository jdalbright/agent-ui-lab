import { describe, expect, it, vi } from "vitest";
import type { ClientContext, SourceRecord, SurfaceSpec } from "../../shared/schemas.js";
import type {
  GeminiClient,
  GeminiRetrievalResult,
  GeminiStructuredOutputRequest,
} from "./gemini.js";
import { UI_QUALITY_CASES } from "../../src/evals/ui-quality-cases.js";
import { recordedUiQualityCompilationInput } from "../../src/evals/ui-quality-fixtures.js";
import * as compositionModule from "./composition.js";
import { lintSurfaceQuality } from "./surface-quality.js";

type PlanStructuredOutputRequest = GeminiStructuredOutputRequest & {
  functionName?: string;
};

interface InspectablePropertySchema {
  type?: unknown;
  enum?: unknown[];
  items?: InspectablePropertySchema;
  anyOf?: InspectablePropertySchema[];
  properties?: Record<string, InspectablePropertySchema>;
  required?: string[];
  minItems?: unknown;
  maxItems?: unknown;
  description?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  pattern?: unknown;
}

interface PlanCompositionResult {
  plan: unknown;
  spec: SurfaceSpec;
  repairCount: 0 | 1;
  fallbackUsed: boolean;
  firstFailureCategory: string;
  firstFailureCodes: readonly string[];
  schemaIssues: readonly {
    attempt: 0 | 1;
    path: string;
    code: string;
  }[];
  metadata: {
    recipeId: string;
    density: string;
    emphasis: string;
    qualityChecks: readonly unknown[];
    repairCategory: string;
    compilerResult: string;
  };
}

type ComposeSurfacePlan = (input: {
  gemini: GeminiClient;
  prompt: string;
  clientContext: ClientContext;
  retrieval: GeminiRetrievalResult;
  signal?: AbortSignal;
}) => Promise<PlanCompositionResult>;

const composeSurfacePlan = (
  compositionModule as unknown as { composeSurfacePlan?: ComposeSurfacePlan }
).composeSurfacePlan;

const clientContext: ClientContext = {
  sizeClass: "expanded",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

const sources: readonly SourceRecord[] = Object.freeze([
  Object.freeze({
    id: "src_research1",
    title: "Primary documentation",
    url: "https://example.com/primary",
    provider: "google-search" as const,
    accessedAt: "2026-08-02T14:00:00.000Z",
  }),
  Object.freeze({
    id: "src_research2",
    title: "Independent analysis",
    url: "https://example.org/analysis",
    provider: "google-search" as const,
    accessedAt: "2026-08-02T14:00:00.000Z",
  }),
]);

const retrieval: GeminiRetrievalResult = {
  outputText: "The primary documentation and independent analysis agree on the core result.",
  sources,
  steps: Object.freeze([]),
  evidence: Object.freeze([]),
  toolRounds: 0,
};

function weatherLocation(name: string, timeZone: string, highOffset: number) {
  return {
    location: { name, latitude: 35, longitude: -80 },
    current: {
      observedAt: "2026-08-02T12:00:00.000Z",
      timeZone,
      temperature: 80 + highOffset,
      feelsLike: 80 + highOffset,
      temperatureUnit: "F" as const,
      conditionKey: "clear" as const,
      conditionText: "Clear",
      humidity: 50,
      precipitationProbability: 10,
      windDirection: "N",
      windSpeed: 5,
      windSpeedUnit: "mph" as const,
      visibility: 10,
      visibilityUnit: "mi" as const,
      uvIndex: 4,
    },
    hourly: [],
    daily: Array.from({ length: 5 }, (_, index) => ({
      date: `2026-08-${String(index + 3).padStart(2, "0")}`,
      high: 80 + highOffset + index,
      low: 65 + highOffset + index,
      temperatureUnit: "F" as const,
      precipitationProbability: 10 + index,
      conditionKey: "clear" as const,
    })),
    alerts: [],
  };
}

const weatherBackedRetrieval: GeminiRetrievalResult = {
  ...retrieval,
  evidence: Object.freeze([
    Object.freeze({
      tool: "get_weather_bundle" as const,
      arguments: Object.freeze({
        locations: Object.freeze(["Miami", "Denver", "Seattle"]),
        units: "imperial" as const,
      }),
      result: Object.freeze({
        locations: Object.freeze([
          weatherLocation("Miami, Florida", "America/New_York", 10),
          weatherLocation("Denver, Colorado", "America/Denver", 0),
          weatherLocation("Seattle, Washington", "America/Los_Angeles", -8),
        ]),
        activityWindows: Object.freeze([]),
      }),
    }),
  ]),
};

const validPlan = {
  kind: "research",
  recipeId: "research.brief",
  density: "brief",
  emphasis: "answer",
  modules: [
    {
      type: "lead",
      variant: "feature",
      title: "The core result is well supported",
      summary: "Both supplied sources support the concise answer.",
      sourceIds: sources.map((source) => source.id),
    },
    {
      type: "evidence",
      variant: "stack",
      label: "Evidence",
      items: [
        {
          title: "Primary source",
          finding: "The primary documentation states the result directly.",
          sourceId: sources[0]?.id,
          stance: "support",
        },
      ],
    },
    {
      type: "sources",
      label: "Sources",
      sourceIds: sources.map((source) => source.id),
    },
  ],
} as const;

const semanticallyInvalidPlan = {
  ...validPlan,
  recipeId: "research.timeline",
};

const validClaimsPlan = {
  ...validPlan,
  recipeId: "research.claims",
  density: "detailed",
  emphasis: "evidence",
  modules: [
    { ...validPlan.modules[0], variant: "brief" },
    {
      ...validPlan.modules[1],
      variant: "for-against",
      items: [
        validPlan.modules[1].items[0],
        {
          ...validPlan.modules[1].items[0],
          title: "Challenging source",
          finding: "The independent analysis challenges the claim.",
          sourceId: sources[1]?.id,
          stance: "challenge",
        },
      ],
    },
    validPlan.modules[2],
  ],
} as const;

const validTechnicalScorecardPlan = {
  kind: "comparison",
  recipeId: "comparison.scorecard",
  density: "detailed",
  emphasis: "evidence",
  modules: [
    {
      type: "summary",
      variant: "balanced",
      title: "React and Angular renderer support",
      recommendation: "Both renderers are documented; choose the host framework that fits the application.",
      items: [
        {
          label: "React",
          value: "Documented renderer",
          detail: "Official client setup is available.",
          recommended: false,
        },
        {
          label: "Angular",
          value: "Documented renderer",
          detail: "Official renderer support is available.",
          recommended: false,
        },
      ],
      sourceIds: sources.map((source) => source.id),
    },
    {
      type: "table",
      caption: "Renderer and support scorecard",
      columns: ["Framework", "Renderer", "Support"],
      rows: [
        ["React", "Documented", "Official"],
        ["Angular", "Documented", "Official"],
      ],
      sourceIds: sources.map((source) => source.id),
    },
    {
      type: "sources",
      label: "Official sources",
      sourceIds: sources.map((source) => source.id),
    },
  ],
} as const;

const validWeatherScorecardPlan = {
  kind: "comparison",
  recipeId: "comparison.scorecard",
  density: "balanced",
  emphasis: "answer",
  modules: [
    {
      type: "summary",
      variant: "balanced",
      title: "Outdoor brunch weather scorecard",
      recommendation: "Provider evidence shows the locations side by side without a unique leader.",
      locationIndexes: [0, 1, 2],
      sourceIds: sources.map((source) => source.id),
    },
    {
      type: "table",
      caption: "Outdoor brunch conditions",
      locationIndexes: [0, 1, 2],
      forecastKind: "current",
      metrics: ["precipitation"],
      sourceIds: sources.map((source) => source.id),
    },
    {
      type: "sources",
      label: "Weather sources",
      sourceIds: sources.map((source) => source.id),
    },
  ],
} as const;

function response(output: unknown): { text: string } {
  return { text: typeof output === "string" ? output : JSON.stringify(output) };
}

function fakeClient(outputs: readonly unknown[]) {
  const remaining = [...outputs];
  const requests: PlanStructuredOutputRequest[] = [];
  const generate = vi.fn((request: GeminiStructuredOutputRequest) => {
    requests.push(request as PlanStructuredOutputRequest);
    const next = remaining.shift();
    if (next === undefined) throw new Error("No fake plan response remains");
    return Promise.resolve(response(next));
  });

  return {
    client: {
      interactions: { create: vi.fn() },
      structuredOutput: { generate },
    } as unknown as GeminiClient,
    requests,
  };
}

function compose(client: GeminiClient): Promise<PlanCompositionResult> {
  if (!composeSurfacePlan) throw new TypeError("composeSurfacePlan is not implemented");
  return composeSurfacePlan({
    gemini: client,
    prompt: "Research the current result and show the supporting evidence.",
    clientContext,
    retrieval,
  });
}

describe("composeSurfacePlan", () => {
  it.each(UI_QUALITY_CASES)(
    "closes the provider selection schema around the deterministic $id contract",
    async (testCase) => {
      const recorded = recordedUiQualityCompilationInput(testCase);
      const { client, requests } = fakeClient([recorded.plan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt: testCase.prompt,
        clientContext: recorded.clientContext,
        retrieval: recorded.retrieval,
      });

      expect(result).toMatchObject({
        repairCount: 0,
        fallbackUsed: false,
        plan: {
          recipeId: testCase.recipeId,
          density: testCase.expected.density,
          emphasis: testCase.expected.emphasis,
        },
      });
      expect(requests[0]?.schema).toMatchObject({
        properties: {
          recipeId: { enum: [testCase.recipeId] },
          density: { enum: [testCase.expected.density] },
          emphasis: { enum: [testCase.expected.emphasis] },
        },
      });
    },
  );

  it("repairs a winnerless authored verdict when the user explicitly asks which option wins", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QC02");
    if (!testCase) throw new TypeError("QC02 is unavailable.");
    const recorded = recordedUiQualityCompilationInput(testCase);
    const winnerlessPlan = structuredClone(recorded.plan);
    if (winnerlessPlan.kind !== "comparison") throw new TypeError("QC02 is not a comparison.");
    const summary = winnerlessPlan.modules.find((module) => module.type === "summary");
    if (!summary || !("items" in summary)) throw new TypeError("QC02 has no authored summary.");
    for (const item of summary.items) item.recommended = false;
    const { client, requests } = fakeClient([winnerlessPlan, recorded.plan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt: testCase.prompt,
      clientContext: recorded.clientContext,
      retrieval: recorded.retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: false,
      firstFailureCategory: "semantic",
      firstFailureCodes: ["invalid_semantic"],
    });
    expect(requests[0]?.systemInstruction).toMatch(
      /explicit winner request[^.]*recommended=true[^.]*exactly one/i,
    );
    expect(requests[1]?.input).toMatch(/exactly one recommended option/i);
  });

  it("allows a winnerless authored verdict when the user explicitly declines a winner", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QC02");
    if (!testCase) throw new TypeError("QC02 is unavailable.");
    const recorded = recordedUiQualityCompilationInput(testCase);
    const winnerlessPlan = structuredClone(recorded.plan);
    if (winnerlessPlan.kind !== "comparison") throw new TypeError("QC02 is not a comparison.");
    const summary = winnerlessPlan.modules.find((module) => module.type === "summary");
    if (!summary || !("items" in summary)) throw new TypeError("QC02 has no authored summary.");
    for (const item of summary.items) item.recommended = false;
    const { client, requests } = fakeClient([winnerlessPlan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt:
        "Compare Southwest and Delta carry-on limits, but do not tell me which is more generous.",
      clientContext: recorded.clientContext,
      retrieval: recorded.retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 0,
      fallbackUsed: false,
      firstFailureCategory: "none",
    });
    expect(requests[0]?.systemInstruction).not.toMatch(/explicit winner request/i);
  });

  it("uses the safe winnerless fallback when both explicit-winner composition attempts fail", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QC02");
    if (!testCase) throw new TypeError("QC02 is unavailable.");
    const recorded = recordedUiQualityCompilationInput(testCase);
    const winnerlessPlan = structuredClone(recorded.plan);
    if (winnerlessPlan.kind !== "comparison") throw new TypeError("QC02 is not a comparison.");
    const summary = winnerlessPlan.modules.find((module) => module.type === "summary");
    if (!summary || !("items" in summary)) throw new TypeError("QC02 has no authored summary.");
    for (const item of summary.items) item.recommended = false;
    const { client } = fakeClient([winnerlessPlan, winnerlessPlan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt: testCase.prompt,
      clientContext: recorded.clientContext,
      retrieval: recorded.retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: true,
      firstFailureCategory: "semantic",
      firstFailureCodes: ["invalid_semantic"],
    });
    const fallbackPlan = result.plan as {
      modules: Array<{ type: string; items?: Array<{ recommended: boolean }> }>;
    };
    const fallbackSummary = fallbackPlan.modules.find((module) => module.type === "summary");
    expect(fallbackSummary?.items?.every((item) => item.recommended === false)).toBe(true);
  });

  it("routes a scored multi-city weather prompt to the comparison plan schema", () => {
    const weatherBacked: GeminiRetrievalResult = {
      ...retrieval,
      evidence: Object.freeze([
        Object.freeze({
          tool: "get_weather_bundle" as const,
          arguments: Object.freeze({
            locations: Object.freeze(["Raleigh", "Durham", "Charlotte", "Asheville"]),
            units: "imperial" as const,
          }),
          result: Object.freeze({}),
        }),
      ]),
    };

    expect(
      compositionModule.compositionKind(
        "Score Raleigh, Durham, Charlotte, and Asheville for a Sunday outdoor brunch.",
        weatherBacked,
      ),
    ).toBe("comparison");
  });

  it.each([
    "Chart the next five days of highs for Miami, Denver, and Seattle.",
    "Plot the next five days of highs for Miami, Denver, and Seattle.",
  ])("routes a multi-city weather visualization to comparison: %s", (prompt) => {
    expect(compositionModule.compositionKind(prompt, weatherBackedRetrieval)).toBe("comparison");
  });

  it("routes a weather chart to comparison when locations arrive in separate tool records", () => {
    const splitWeatherRetrieval: GeminiRetrievalResult = {
      ...retrieval,
      evidence: Object.freeze([
        Object.freeze({
          tool: "get_weather_bundle" as const,
          arguments: Object.freeze({ location: "Raleigh", units: "imperial" as const }),
          result: Object.freeze({}),
        }),
        Object.freeze({
          tool: "get_weather_bundle" as const,
          arguments: Object.freeze({ location: "Denver", units: "imperial" as const }),
          result: Object.freeze({}),
        }),
      ]),
    };

    expect(
      compositionModule.compositionKind(
        "Chart tomorrow's highs for Raleigh and Denver.",
        splitWeatherRetrieval,
      ),
    ).toBe("comparison");
  });

  it("routes a weather chart from normalized multi-location evidence when legacy arguments are ambiguous", () => {
    const normalizedMultiLocationRetrieval = structuredClone(weatherBackedRetrieval);
    normalizedMultiLocationRetrieval.evidence[0].arguments = {
      location: "Miami, Denver, and Seattle",
      units: "imperial",
    };

    expect(
      compositionModule.compositionKind(
        "Chart the next five days of highs for Miami, Denver, and Seattle.",
        normalizedMultiLocationRetrieval,
      ),
    ).toBe("comparison");
  });

  it.each([2, 3, 4])(
    "routes a true %i-location weather chart from a legacy comma-joined argument",
    (locationCount) => {
      const names = ["Miami", "Denver", "Seattle", "Boston"].slice(0, locationCount);
      const normalizedMultiLocationRetrieval: GeminiRetrievalResult = {
        ...retrieval,
        evidence: Object.freeze([
          Object.freeze({
            tool: "get_weather_bundle" as const,
            arguments: Object.freeze({
              location: names.join(", "),
              units: "imperial" as const,
            }),
            result: Object.freeze({
              locations: Object.freeze(
                names.map((name, index) =>
                  weatherLocation(`${name}, USA`, "America/New_York", index),
                ),
              ),
              activityWindows: Object.freeze([]),
            }),
          }),
        ]),
      };

      expect(
        compositionModule.compositionKind(
          "Chart the next five days of highs for these places.",
          normalizedMultiLocationRetrieval,
        ),
      ).toBe("comparison");
    },
  );

  it.each([
    {
      mode: "a city alias",
      arguments: { location: "Raleigh", units: "imperial" as const },
    },
    {
      mode: "a ZIP code",
      arguments: { location: "27601", units: "imperial" as const },
    },
    {
      mode: "coordinates",
      arguments: {
        latitude: 35.7796,
        longitude: -78.6382,
        units: "imperial" as const,
      },
    },
  ])(
    "keeps a single-location weather chart as weather when $mode normalizes to a full place name",
    ({ arguments: weatherArguments }) => {
      const singleLocationRetrieval: GeminiRetrievalResult = {
        ...retrieval,
        evidence: Object.freeze([
          Object.freeze({
            tool: "get_weather_bundle" as const,
            arguments: Object.freeze(weatherArguments),
            result: Object.freeze({
              locations: Object.freeze([
                weatherLocation("Raleigh, NC, USA", "America/New_York", 0),
              ]),
              activityWindows: Object.freeze([]),
            }),
          }),
        ]),
      };

      expect(
        compositionModule.compositionKind(
          "Chart Raleigh's temperature for the next five days.",
          singleLocationRetrieval,
        ),
      ).toBe("weather");
    },
  );

  it("uses a separate emit_surface_plan schema call and compiles the validated plan", async () => {
    const { client, requests } = fakeClient([validPlan]);

    const result = await compose(client);

    expect(result).toMatchObject({
      plan: validPlan,
      repairCount: 0,
      fallbackUsed: false,
      firstFailureCategory: "none",
      firstFailureCodes: [],
      metadata: {
        recipeId: "research.brief",
        density: "brief",
        emphasis: "answer",
        repairCategory: "none",
        compilerResult: "compiled",
      },
      spec: {
        kind: "research",
      },
    });
    expect(Array.isArray(result.metadata.qualityChecks)).toBe(true);
    expect(result.spec.components.find((component) => component.id === result.spec.rootId)).toMatchObject({
      component: "SurfaceFrame",
      recipeId: "research.brief",
      density: "brief",
      emphasis: "answer",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.functionName).toBe("emit_surface_plan");
    expect(requests[0]?.systemInstruction).toMatch(/SurfacePlan|recipe/i);
    expect(requests[0]?.systemInstruction).toMatch(
      /research\.brief[^.]*defining module: lead[^.]*canonical order: lead -> evidence -> sources/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /research\.timeline[^.]*defining module: timeline[^.]*canonical order: lead -> timeline -> evidence\? -> sources/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /research\.claims[^.]*defining module: evidence[^.]*canonical order: lead -> evidence -> sources/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(/exact primary-first module type is lead/i);
    expect(requests[0]?.systemInstruction).toMatch(
      /concise sourced brief => brief \+ answer[^.]*authority-only requirements => balanced \+ evidence/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /brief density[^.]*only[^.]*explicitly requested optional modules/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /research\.claims[^.]*set stance on every evidence item[^.]*relative to the user's claim/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /exact compiled content budgets by density: brief <= 6 components, <= 700 prose characters, <= 280 lead characters; balanced <= 9 components, <= 1400 prose characters, <= 480 lead characters; detailed <= 12 components, <= 2200 prose characters, <= 700 lead characters/i,
    );
    expect(requests[0]?.input).toContain("Evidence payload:");
    expect(requests[0]?.input).toContain("src_research1");
    expect(requests[0]?.input).not.toContain("https://example.com/primary");
    expect(requests[0]?.input).not.toContain("accessedAt");
    expect(requests[0]?.schema).toMatchObject({
      type: "object",
      properties: {
        kind: { enum: ["research"] },
        recipeId: {
          enum: ["research.brief"],
        },
        density: { enum: ["brief", "balanced", "detailed"] },
        emphasis: { enum: ["answer", "decision", "trend", "evidence", "risk"] },
        modules: { type: "array" },
      },
      required: ["kind", "recipeId", "density", "emphasis", "modules"],
    });
    expect(requests[0]?.schema).not.toHaveProperty("properties.components");
    expect(requests[0]?.schema).not.toHaveProperty("properties.rootId");
    const researchSchema = requests[0]?.schema as {
      properties?: {
        modules?: {
          items?: {
            anyOf?: Array<{
              properties?: {
                type?: { enum?: string[] };
                items?: { items?: { required?: string[] } };
              };
            }>;
          };
        };
      };
    };
    const evidenceSchema = researchSchema.properties?.modules?.items?.anyOf?.find(
      (candidate) => candidate.properties?.type?.enum?.[0] === "evidence",
    );
    expect(evidenceSchema?.properties?.items?.items?.required).toContain("stance");
    expect("tools" in (requests[0] ?? {})).toBe(false);
  });

  it("resolves the official technical scorecard contract before generation", async () => {
    const { client, requests } = fakeClient([validTechnicalScorecardPlan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt:
        "Score React and Angular in A2UI 0.9.1 on renderer and support. Use official sources.",
      clientContext,
      retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 0,
      plan: {
        recipeId: "comparison.scorecard",
        density: "detailed",
        emphasis: "evidence",
      },
    });
    expect(requests[0]?.schema).toMatchObject({
      properties: {
        recipeId: { enum: ["comparison.scorecard"] },
        density: { enum: ["detailed"] },
        emphasis: { enum: ["evidence"] },
      },
    });
    const scorecardModuleSchemas = ((requests[0]?.schema as {
      properties?: {
        modules?: {
          items?: {
            anyOf?: Array<{
              properties?: Record<string, InspectablePropertySchema>;
            }>;
          };
        };
      };
    }).properties?.modules?.items?.anyOf ?? []);
    const summarySchema = scorecardModuleSchemas.find(
      (candidate) => candidate.properties?.type?.enum?.[0] === "summary",
    );
    expect(summarySchema?.properties?.variant?.enum).toEqual(["balanced"]);
    expect((requests[0]?.schema as {
      properties?: { modules?: InspectablePropertySchema };
    }).properties?.modules).toMatchObject({
      minItems: 3,
      maxItems: 3,
    });
    expect(
      scorecardModuleSchemas.map((candidate) => candidate.properties?.type?.enum?.[0]),
    ).toEqual(["summary", "table", "sources"]);
    expect(requests[0]?.systemInstruction).toMatch(
      /resolved request contract[^.]*comparison\.scorecard[^.]*detailed[^.]*evidence/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /official-source technical support[^.]*takes precedence[^.]*score|score[^.]*official-source technical support[^.]*takes precedence/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /recommended=true on at most one item[^.]*zero is allowed/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /every explicitly requested comparison criterion[^.]*structured summary items or table/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /every table row[^.]*same number of cells[^.]*columns/i,
    );
  });

  it("closes a resolved concise research brief schema inside its compiled content budget", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QR01");
    if (!testCase) throw new TypeError("QR01 is unavailable.");
    const recorded = recordedUiQualityCompilationInput(testCase);
    const maximumBriefPlan = structuredClone(recorded.plan) as {
      modules: Array<Record<string, unknown>>;
    };
    const lead = maximumBriefPlan.modules.find((module) => module.type === "lead");
    const evidence = maximumBriefPlan.modules.find((module) => module.type === "evidence");
    const sourceList = maximumBriefPlan.modules.find((module) => module.type === "sources");
    if (!lead || !evidence || !sourceList) {
      throw new TypeError("QR01 is missing a canonical research module.");
    }
    lead.title = "t".repeat(72);
    lead.summary = "s".repeat(164);
    evidence.label = "e".repeat(24);
    evidence.items = recorded.retrieval.sources.map((source) => ({
      title: "i".repeat(48),
      finding: "f".repeat(160),
      sourceId: source.id,
      stance: "support",
    }));
    sourceList.label = "r".repeat(24);
    const { client, requests } = fakeClient([maximumBriefPlan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt: "Summarize Gemini 3.6 Flash in a concise sourced brief.",
      clientContext: recorded.clientContext,
      retrieval: recorded.retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 0,
      fallbackUsed: false,
      firstFailureCategory: "none",
      schemaIssues: [],
    });
    const modulesSchema = (requests[0]?.schema as {
      properties?: { modules?: InspectablePropertySchema };
    }).properties?.modules;
    expect(modulesSchema).toMatchObject({ minItems: 3, maxItems: 3 });
    const moduleSchemas = modulesSchema?.items?.anyOf ?? [];
    expect(moduleSchemas.map((schema) => schema.properties?.type?.enum?.[0])).toEqual([
      "lead",
      "evidence",
      "sources",
    ]);
    const leadSchema = moduleSchemas[0]?.properties;
    const evidenceSchema = moduleSchemas[1]?.properties;
    const sourceSchema = moduleSchemas[2]?.properties;
    expect(leadSchema?.variant?.enum).toEqual(["brief"]);
    expect(leadSchema?.title?.maxLength).toBe(72);
    expect(leadSchema?.summary?.maxLength).toBe(164);
    expect(evidenceSchema?.variant?.enum).toEqual(["stack"]);
    expect(evidenceSchema?.label?.maxLength).toBe(24);
    expect(evidenceSchema?.items?.maxItems).toBe(2);
    expect(evidenceSchema?.items?.items?.properties?.title?.maxLength).toBe(48);
    expect(evidenceSchema?.items?.items?.properties?.finding?.maxLength).toBe(160);
    expect(sourceSchema?.label?.maxLength).toBe(24);
    const contentCheck = result.metadata.qualityChecks.find(
      (check) => (check as { code?: string }).code === "content_budget",
    ) as { passed?: boolean } | undefined;
    expect(contentCheck?.passed).toBe(true);
  });

  it.each([
    "What changed in Gemini 3.6 Flash? Give me a concise sourced brief.",
    "What's new in Gemini 3.6 Flash? Give me a concise sourced brief.",
    "What is different in Gemini 3.6 Flash? Give me a concise sourced brief.",
  ])(
    "preserves every independent directional change in a resolved change brief: %s",
    async (prompt) => {
      const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QR01");
      if (!testCase) throw new TypeError("QR01 is unavailable.");
      const recorded = recordedUiQualityCompilationInput(testCase);
      const { client, requests } = fakeClient([recorded.plan]);

      await composeSurfacePlan!({
        gemini: client,
        prompt,
        clientContext: recorded.clientContext,
        retrieval: recorded.retrieval,
      });

      expect(requests[0]?.systemInstruction).toMatch(
        /preserve every independent directional change[^.]*supplied evidence/i,
      );
      expect(requests[0]?.systemInstruction).toMatch(
        /multiple changes from one source[^.]*compress[^.]*findings/i,
      );
      expect(requests[0]?.systemInstruction).toMatch(
        /umbrella topic label[^.]*insufficient/i,
      );
      const modulesSchema = (requests[0]?.schema as {
        properties?: { modules?: InspectablePropertySchema };
      }).properties?.modules;
      const evidenceSchema = modulesSchema?.items?.anyOf?.find(
        (schema) => schema.properties?.type?.enum?.[0] === "evidence",
      );
      const manifestItemSchemas = evidenceSchema?.properties?.items?.items?.anyOf ?? [];
      expect(manifestItemSchemas).toHaveLength(2);
      expect(
        manifestItemSchemas.map((schema) => schema.properties?.finding?.description),
      ).toEqual([
        "Copy this exact compiler-issued source change finding unchanged.",
        "Copy this exact compiler-issued source change finding unchanged.",
      ]);
      expect(
        manifestItemSchemas.map((schema) => ({
          finding: schema.properties?.finding?.enum?.[0],
          sourceId: schema.properties?.sourceId?.enum?.[0],
        })),
      ).toEqual([
        expect.objectContaining({ sourceId: "src_search01" }),
        expect.objectContaining({ sourceId: "src_search02" }),
      ]);
      const longestFindingSchema = manifestItemSchemas[1]?.properties?.finding;
      expect(longestFindingSchema?.maxLength).toBeGreaterThan(160);
      expect(longestFindingSchema?.maxLength).toBe(
        (longestFindingSchema?.enum?.[0] as string | undefined)?.length,
      );
    },
  );

  it.each([
    "What changed in Gemini 3.6 Flash?",
    "What changed in Gemini 3.6 Flash using only official sources",
  ])("activates the trusted change manifest regardless of brief or authority wording: %s", async (prompt) => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QR01");
    if (!testCase) throw new TypeError("QR01 is unavailable.");
    const recorded = recordedUiQualityCompilationInput(testCase);
    const { client, requests } = fakeClient([recorded.plan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt,
      clientContext: recorded.clientContext,
      retrieval: recorded.retrieval,
    });

    expect(result.plan).toMatchObject({
      recipeId: "research.brief",
      density: "brief",
      emphasis: "answer",
    });
    expect(requests[0]?.input).toMatch(/researchChangeManifest/);
    expect(requests[0]?.systemInstruction).toMatch(/changeCoverage=all-directional/);
  });

  it.each([
    "Summarize Gemini 3.6 Flash in a concise sourced brief.",
    "Do not explain what changed in Gemini 3.6 Flash; summarize its current behavior in a concise sourced brief.",
    'The phrase "what changed in Gemini 3.6 Flash" is only an example; summarize its current behavior in a concise sourced brief.',
    "The query what changed in Gemini 3.6 Flash is not my request; summarize its current behavior in a concise sourced brief.",
    "The prompt says what changed in Gemini 3.6 Flash; summarize its current behavior in a concise sourced brief.",
  ])("does not impose complete change coverage on a non-change concise brief: %s", async (prompt) => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QR01");
    if (!testCase) throw new TypeError("QR01 is unavailable.");
    const recorded = recordedUiQualityCompilationInput(testCase);
    const ordinaryPlan = structuredClone(recorded.plan);
    const evidence = ordinaryPlan.modules.find((module) => module.type === "evidence");
    if (!evidence || evidence.type !== "evidence" || !evidence.items[1]) {
      throw new TypeError("QR01 evidence is unavailable.");
    }
    evidence.items[1].finding =
      "The release completes workflows with fewer reasoning steps, turns, and tool calls and improves production-ready code generation with fewer debugging loops.";
    const { client, requests } = fakeClient([ordinaryPlan]);

    await composeSurfacePlan!({
      gemini: client,
      prompt,
      clientContext: recorded.clientContext,
      retrieval: recorded.retrieval,
    });

    expect(requests[0]?.systemInstruction).not.toMatch(
      /preserve every independent directional change/i,
    );
  });

  it("repairs a change brief that preserves agentic gains but omits release status and code gains", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QR01");
    if (!testCase) throw new TypeError("QR01 is unavailable.");
    const recorded = recordedUiQualityCompilationInput(testCase);
    const incompletePlan = structuredClone(recorded.plan) as {
      modules: Array<{
        type: string;
        items?: Array<{ finding: string; sourceId: string }>;
      }>;
    };
    const evidence = incompletePlan.modules.find((module) => module.type === "evidence");
    if (!evidence?.items?.[0] || !evidence.items[1]) {
      throw new TypeError("QR01 evidence is unavailable.");
    }
    evidence.items[0].finding =
      "The official documentation describes function calling, Search grounding, and structured outputs.";
    evidence.items[1].finding =
      "Gemini 3.6 Flash completes agentic workflows with fewer reasoning steps, turns, and tool calls.";
    const { client, requests } = fakeClient([incompletePlan, recorded.plan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt: testCase.prompt,
      clientContext: recorded.clientContext,
      retrieval: recorded.retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: false,
      firstFailureCategory: "semantic",
      firstFailureCodes: ["invalid_semantic"],
      metadata: { compilerResult: "compiled", repairCategory: "semantic" },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.input).toMatch(/missing required change/i);
    expect(requests[1]?.input).toMatch(/change_1/i);
    expect(requests[1]?.input).toMatch(/change_3/i);
  });

  it("repairs a change brief that preserves both gains but omits release status", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QR01");
    if (!testCase) throw new TypeError("QR01 is unavailable.");
    const recorded = recordedUiQualityCompilationInput(testCase);
    const incompletePlan = structuredClone(recorded.plan) as {
      modules: Array<{
        type: string;
        items?: Array<{ finding: string; sourceId: string }>;
      }>;
    };
    const evidence = incompletePlan.modules.find((module) => module.type === "evidence");
    if (!evidence?.items?.[0]) throw new TypeError("QR01 evidence is unavailable.");
    evidence.items[0].finding =
      "The official documentation describes function calling, Search grounding, and structured outputs.";
    const { client, requests } = fakeClient([incompletePlan, recorded.plan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt: testCase.prompt,
      clientContext: recorded.clientContext,
      retrieval: recorded.retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: false,
      firstFailureCategory: "semantic",
      firstFailureCodes: ["invalid_semantic"],
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.input).toMatch(/missing required change[^\n]*change_1/i);
    expect(requests[1]?.input).not.toMatch(/missing required change[^\n]*change_2/i);
    expect(requests[1]?.input).not.toMatch(/missing required change[^\n]*change_3/i);
  });

  it("uses a manifest-complete deterministic fallback after both change-brief attempts omit changes", async () => {
    const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === "QR01");
    if (!testCase) throw new TypeError("QR01 is unavailable.");
    const recorded = recordedUiQualityCompilationInput(testCase);
    const incompletePlan = structuredClone(recorded.plan) as {
      modules: Array<{
        type: string;
        items?: Array<{ finding: string; sourceId: string }>;
      }>;
    };
    const evidence = incompletePlan.modules.find((module) => module.type === "evidence");
    if (!evidence?.items?.[0] || !evidence.items[1]) {
      throw new TypeError("QR01 evidence is unavailable.");
    }
    evidence.items[0].finding = "The official documentation lists supported capabilities.";
    evidence.items[1].finding = "The release improves agentic workflows.";
    const { client } = fakeClient([incompletePlan, incompletePlan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt: testCase.prompt,
      clientContext: recorded.clientContext,
      retrieval: recorded.retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: true,
      firstFailureCategory: "semantic",
      firstFailureCodes: ["invalid_semantic"],
      metadata: {
        compilerResult: "deterministic-fallback",
        repairCategory: "semantic",
      },
    });
    const fallbackPlan = result.plan as {
      modules: Array<{
        type: string;
        variant?: string;
        items?: Array<{ sourceId: string; finding: string }>;
      }>;
    };
    const fallbackEvidence = fallbackPlan.modules.find((module) => module.type === "evidence");
    expect(fallbackEvidence).toMatchObject({ variant: "stack" });
    const fallbackText = fallbackEvidence?.type === "evidence" && fallbackEvidence.items
      ? fallbackEvidence.items.map((item) => `${item.sourceId}:${item.finding}`).join(" ")
      : "";
    expect(fallbackText).toMatch(/src_search01:.*generally available.*production-ready/i);
    expect(fallbackText).toMatch(/src_search02:.*fewer reasoning steps.*tool calls/i);
    expect(fallbackText).toMatch(/src_search02:.*improves production-ready code generation.*debugging loops/i);
    const quality = lintSurfaceQuality({
      benchmark: testCase,
      plan: result.plan as Readonly<Record<string, unknown>>,
      spec: result.spec,
      sources: recorded.retrieval.sources,
    });
    expect(quality.success).toBe(true);
    expect(quality.checks.requested_coverage).toBe(true);
    expect(quality.missingFactConcepts).toBeUndefined();
  });

  it("repairs provider output that violates the resolved density and emphasis contract", async () => {
    const wrongPresentation = {
      ...validTechnicalScorecardPlan,
      density: "balanced",
      emphasis: "answer",
    } as const;
    const { client, requests } = fakeClient([
      wrongPresentation,
      validTechnicalScorecardPlan,
    ]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt:
        "Score React and Angular in A2UI 0.9.1 on renderer and support. Use official sources.",
      clientContext,
      retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 1,
      firstFailureCategory: "semantic",
      firstFailureCodes: ["invalid_semantic"],
      plan: {
        density: "detailed",
        emphasis: "evidence",
      },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.input).toMatch(/density detailed/i);
    expect(requests[1]?.input).toMatch(/emphasis evidence/i);
  });

  it("omits null values only for known optional SurfacePlan fields before validation", async () => {
    const nullOptionalPlan = structuredClone(validWeatherScorecardPlan) as unknown as {
      modules: Array<Record<string, unknown>>;
    };
    nullOptionalPlan.modules[0].recommendedLocationIndex = null;
    const { client } = fakeClient([nullOptionalPlan]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt: "Score Miami, Denver, and Seattle for an outdoor brunch.",
      clientContext,
      retrieval: weatherBackedRetrieval,
    });

    expect(result).toMatchObject({
      repairCount: 0,
      firstFailureCategory: "none",
    });
    expect(
      (result.plan as { modules: readonly unknown[] }).modules[0],
    ).not.toHaveProperty("recommendedLocationIndex");
  });

  it("keeps required null fields invalid instead of coercing them", async () => {
    const nullRequiredPlan = structuredClone(validTechnicalScorecardPlan) as unknown as {
      density: unknown;
    };
    nullRequiredPlan.density = null;
    const { client } = fakeClient([nullRequiredPlan, validTechnicalScorecardPlan]);

    const result = await composeSurfacePlan!({
        gemini: client,
        prompt:
          "Score React and Angular in A2UI 0.9.1 on renderer and support. Use official sources.",
        clientContext,
        retrieval,
      });

    expect(result).toMatchObject({
      repairCount: 1,
      firstFailureCategory: "schema",
      firstFailureCodes: ["invalid_schema"],
      schemaIssues: [
        { attempt: 0, path: "density", code: "invalid_type" },
      ],
    });
    expect(JSON.stringify(result.schemaIssues)).not.toMatch(/React|Angular|official sources/i);
  });

  it("keeps both schema attempts categorical and applies the resolved contract to fallback", async () => {
    const firstInvalid = structuredClone(validTechnicalScorecardPlan) as unknown as {
      density: unknown;
    };
    firstInvalid.density = null;
    const secondInvalid = structuredClone(validTechnicalScorecardPlan) as unknown as {
      modules: Array<{ items?: Array<{ recommended?: unknown }> }>;
    };
    if (!secondInvalid.modules[0]?.items?.[0]) {
      throw new TypeError("Technical scorecard summary is unavailable.");
    }
    secondInvalid.modules[0].items[0].recommended = null;
    const { client } = fakeClient([firstInvalid, secondInvalid]);

    const result = await composeSurfacePlan!({
      gemini: client,
      prompt:
        "Score React and Angular in A2UI 0.9.1 on renderer and support. Use official sources.",
      clientContext,
      retrieval,
    });

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: true,
      firstFailureCategory: "schema",
      firstFailureCodes: ["invalid_schema"],
      plan: {
        recipeId: "comparison.scorecard",
        density: "detailed",
        emphasis: "evidence",
      },
      schemaIssues: [
        { attempt: 0, path: "density", code: "invalid_type" },
        {
          attempt: 1,
          path: "modules.0.items.0.recommended",
          code: "invalid_type",
        },
      ],
    });
  });

  it("keeps a two-sided claims plan schema inside the trusted stance vocabulary", async () => {
    const { client, requests } = fakeClient([validClaimsPlan]);

    await expect(
      composeSurfacePlan!({
        gemini: client,
        prompt:
          "Find evidence for and against the claim that the IAU still classifies Pluto as a planet.",
        clientContext,
        retrieval,
      }),
    ).resolves.toMatchObject({ repairCount: 0, firstFailureCategory: "none" });

    const moduleSchemas = ((requests[0]?.schema as {
      properties?: {
        modules?: {
          items?: {
            anyOf?: Array<{
              properties?: Record<string, InspectablePropertySchema>;
            }>;
          };
        };
      };
    }).properties?.modules?.items?.anyOf ?? []);
    const evidenceSchema = moduleSchemas.find(
      (candidate) => candidate.properties?.type?.enum?.[0] === "evidence",
    );
    const evidenceItem = evidenceSchema?.properties?.items?.items as unknown as {
      properties?: Record<string, InspectablePropertySchema>;
      required?: string[];
    };
    expect(evidenceSchema?.properties?.variant?.enum).toEqual(["for-against"]);
    expect(evidenceItem.required).toContain("stance");
    expect(evidenceItem.properties?.stance?.enum).toEqual(["support", "challenge"]);
    expect(requests[0]?.systemInstruction).toMatch(
      /stance exactly support or challenge[^.]*never use for or against/i,
    );
  });

  it("uses Gemini-supported JSON Schema keywords and distinct weather table contracts", async () => {
    const { client, requests } = fakeClient([validPlan, validPlan]);

    await expect(
      composeSurfacePlan!({
        gemini: client,
        prompt: "Chart the next five days of highs for Miami, Denver, and Seattle.",
        clientContext,
        retrieval: weatherBackedRetrieval,
      }),
    ).resolves.toMatchObject({
      fallbackUsed: true,
      plan: { recipeId: "comparison.trend", density: "detailed", emphasis: "trend" },
    });

    const schema = requests[0]?.schema as {
      properties?: {
        modules?: {
          items?: {
            anyOf?: Array<{
              properties?: Record<string, InspectablePropertySchema>;
              required?: string[];
            }>;
          };
        };
      };
    };
    const moduleSchemas = schema.properties?.modules?.items?.anyOf ?? [];
    expect(requests[0]?.input).toContain('"weatherManifest"');
    expect(requests[0]?.input).not.toContain('"weatherEvidence"');
    expect(requests[0]?.input).not.toContain('"temperature":');
    expect(requests[0]?.input).not.toContain("https://example.com/primary");
    const tableSchemas = moduleSchemas.filter(
      (candidate) => candidate.properties?.type?.enum?.[0] === "table",
    );
    const currentTableSchema = tableSchemas.find(
      (candidate) => candidate.properties?.forecastKind?.enum?.[0] === "current",
    );
    const hourlyTableSchema = tableSchemas.find(
      (candidate) => candidate.properties?.forecastKind?.enum?.[0] === "hourly",
    );
    const dailyTableSchema = tableSchemas.find(
      (candidate) => candidate.properties?.forecastKind?.enum?.[0] === "daily",
    );

    expect(tableSchemas).toHaveLength(3);
    expect(currentTableSchema?.properties?.metrics?.type).toBe("array");
    expect(currentTableSchema?.required).toContain("metrics");
    expect(currentTableSchema?.properties).not.toHaveProperty("forecastIndexes");
    expect(currentTableSchema?.properties).not.toHaveProperty("metric");
    expect(hourlyTableSchema?.properties?.metric).toEqual({
      type: "string",
      enum: ["temperature", "precipitation"],
    });
    expect(hourlyTableSchema?.properties?.forecastIndexes?.type).toBe("array");
    expect(hourlyTableSchema?.required).toContain("forecastIndexes");
    expect(hourlyTableSchema?.required).toContain("metric");
    expect(dailyTableSchema?.properties?.metric).toEqual({
      type: "string",
      enum: ["high", "low", "precipitation"],
    });
    expect(dailyTableSchema?.properties?.forecastIndexes?.type).toBe("array");
    expect(dailyTableSchema?.required).toContain("forecastIndexes");
    expect(dailyTableSchema?.required).toContain("metric");

    const sourcesSchema = moduleSchemas.find(
      (candidate) => candidate.properties?.type?.enum?.[0] === "sources",
    );
    expect(sourcesSchema?.properties?.label).toMatchObject({
      type: "string",
      description: "Non-empty text of at most 80 characters.",
      minLength: 1,
      maxLength: 80,
    });
    expect(sourcesSchema?.properties?.sourceIds?.items).toMatchObject({
      type: "string",
      description: "An unchanged source ID from the supplied evidence payload.",
      enum: sources.map((source) => source.id),
    });
    expect(sourcesSchema?.properties?.sourceIds?.items).not.toHaveProperty("pattern");
    expect(sourcesSchema?.properties?.sourceIds?.description).toMatch(/unique/i);
    expect(hourlyTableSchema?.properties?.forecastIndexes?.description).toMatch(/unique/i);
    expect(hourlyTableSchema?.properties?.locationIndexes?.items?.enum).toEqual([0, 1, 2]);
    expect(dailyTableSchema?.properties?.forecastIndexes?.items?.enum).toEqual([0, 1, 2, 3, 4]);
    expect(requests[0]?.schema).toMatchObject({
      properties: {
        recipeId: { enum: ["comparison.trend"] },
        density: { enum: ["detailed"] },
        emphasis: { enum: ["trend"] },
      },
    });

    expect(requests[0]?.systemInstruction).toMatch(/exact primary-first module type is summary/i);
    expect(requests[0]?.systemInstruction).toMatch(
      /comparison\.trend[^.]*defining module: chart[^.]*canonical order: summary -> chart -> table -> sources/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /weather-backed comparison prose must stay qualitative-only/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /copy the exact hourlyCoverage and dailyCoverage indexes/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /copy requiredFinalSourceIds unchanged/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(/do not write numeric values, measurements, dates, or times/i);
    expect(requests[0]?.systemInstruction).toMatch(
      /ordered time range or explicit chart\/plot => detailed \+ trend/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /official-source technical support comparison, including score or rank wording => detailed \+ evidence/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /otherwise, score or rank across three or more options => balanced \+ answer/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(
      /comparison trend chart and table[^.]*identical locationIndexes[^.]*forecastIndexes[^.]*metric[^.]*sourceIds/i,
    );
    expect(requests[0]?.systemInstruction).toMatch(/omit optional properties instead of emitting null/i);
  });

  it("makes one bounded repair and then compiles the replacement plan", async () => {
    const { client, requests } = fakeClient([semanticallyInvalidPlan, validPlan]);

    const result = await compose(client);

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: false,
      firstFailureCategory: "semantic",
      firstFailureCodes: ["invalid_semantic"],
      metadata: {
        recipeId: "research.brief",
        repairCategory: "semantic",
        compilerResult: "compiled",
      },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.functionName).toBe("emit_surface_plan");
    expect(requests[1]?.input).toMatch(/repair|validation/i);
    expect("tools" in (requests[1] ?? {})).toBe(false);
  });

  it("repairs a research evidence item that omits its semantic stance", async () => {
    const missingStancePlan = structuredClone(validPlan);
    const evidence = missingStancePlan.modules.find((module) => module.type === "evidence");
    if (!evidence || evidence.type !== "evidence") {
      throw new TypeError("Research plan is missing evidence.");
    }
    delete (evidence.items as unknown as Array<{ stance?: string }>)[0]?.stance;
    const { client, requests } = fakeClient([missingStancePlan, validPlan]);

    const result = await compose(client);

    expect(result).toMatchObject({
      repairCount: 1,
      fallbackUsed: false,
      firstFailureCategory: "schema",
      firstFailureCodes: ["invalid_schema"],
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.input).toMatch(/stance/i);
  });

  it.each([
    {
      name: "lead",
      plan: {
        ...validPlan,
        modules: [
          {
            ...validPlan.modules[0],
            summary: "x".repeat(281),
          },
          ...validPlan.modules.slice(1),
        ],
      },
    },
    {
      name: "prose",
      plan: {
        ...validPlan,
        modules: [
          validPlan.modules[0],
          {
            ...validPlan.modules[1],
            items: [
              {
                ...validPlan.modules[1].items[0],
                finding: "x".repeat(600),
              },
              {
                ...validPlan.modules[1].items[0],
                title: "Additional evidence",
                finding: "y".repeat(600),
                sourceId: sources[1]?.id,
              },
            ],
          },
          validPlan.modules[2],
        ],
      },
    },
    {
      name: "component",
      plan: {
        ...validPlan,
        modules: [
          validPlan.modules[0],
          validPlan.modules[1],
          validPlan.modules[1],
          validPlan.modules[1],
          validPlan.modules[1],
          validPlan.modules[2],
        ],
      },
    },
  ])("repairs a plan that exceeds the compiled $name budget", async ({ name, plan }) => {
    const { client, requests } = fakeClient([plan, validPlan]);

    const result = await compose(client);

    expect(result).toMatchObject({ repairCount: 1, fallbackUsed: false });
    expect(result).toMatchObject({
      firstFailureCategory: "quality",
      firstFailureCodes: ["content_budget"],
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.input).toMatch(/content_budget/);
    const measurements = /Content budget measurements for brief: components (\d+)\/6; prose (\d+)\/700; lead (\d+)\/280\./i.exec(
      requests[1]?.input ?? "",
    );
    expect(measurements).not.toBeNull();
    const measured = {
      component: Number(measurements?.[1]),
      prose: Number(measurements?.[2]),
      lead: Number(measurements?.[3]),
    };
    const limits = { component: 6, prose: 700, lead: 280 };
    expect(measured[name as keyof typeof measured]).toBeGreaterThan(
      limits[name as keyof typeof limits],
    );
  });

  it("fails closed when an explicit two-sided claims request remains all-neutral", async () => {
    const neutralPlan = structuredClone(validClaimsPlan);
    const evidence = neutralPlan.modules.find((module) => module.type === "evidence");
    if (!evidence || evidence.type !== "evidence") {
      throw new TypeError("Claims plan is missing evidence.");
    }
    for (const item of evidence.items as unknown as Array<{ stance: string }>) {
      item.stance = "neutral";
    }
    const { client } = fakeClient([neutralPlan, neutralPlan]);

    await expect(
      composeSurfacePlan!({
        gemini: client,
        prompt: "Find evidence for and against this claim.",
        clientContext,
        retrieval,
      }),
    ).rejects.toMatchObject({
      name: "CompositionValidationError",
      issues: ["The deterministic domain fallback could not be compiled safely."],
    });
  });

  it("uses a deterministic domain recipe and safe metadata after the repair also fails", async () => {
    const firstClient = fakeClient([semanticallyInvalidPlan, semanticallyInvalidPlan]);
    const secondClient = fakeClient([semanticallyInvalidPlan, semanticallyInvalidPlan]);

    const first = await compose(firstClient.client);
    const second = await compose(secondClient.client);

    expect(firstClient.requests).toHaveLength(2);
    expect(secondClient.requests).toHaveLength(2);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      plan: {
        kind: "research",
        recipeId: "research.brief",
      },
      spec: {
        kind: "research",
      },
      repairCount: 1,
      fallbackUsed: true,
      firstFailureCategory: "semantic",
      firstFailureCodes: ["invalid_semantic"],
      metadata: {
        recipeId: "research.brief",
        density: "brief",
        emphasis: "answer",
        repairCategory: "semantic",
        compilerResult: "deterministic-fallback",
      },
    });
    expect(Array.isArray(first.metadata.qualityChecks)).toBe(true);
    expect(JSON.stringify(first.metadata)).not.toMatch(
      /current result|supporting evidence|primary documentation|independent analysis/i,
    );
  });

  it("fails closed when the deterministic fallback cannot be compiled safely", async () => {
    const { client } = fakeClient([validPlan, validPlan]);
    const emptyRetrieval: GeminiRetrievalResult = {
      outputText: "Untrusted generated fallback text.",
      sources: Object.freeze([]),
      steps: Object.freeze([]),
      evidence: Object.freeze([]),
      toolRounds: 0,
    };

    await expect(
      composeSurfacePlan!({
        gemini: client,
        prompt: "Compare the current result with the previous result.",
        clientContext,
        retrieval: emptyRetrieval,
      }),
    ).rejects.toMatchObject({
      name: "CompositionValidationError",
      issues: ["The deterministic domain fallback could not be compiled safely."],
    });
  });
});
