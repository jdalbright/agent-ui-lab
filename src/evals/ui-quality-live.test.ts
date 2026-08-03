import { describe, expect, it } from "vitest";
import type { SourceRecord } from "@shared/schemas.js";
import { createGeminiProvider, type GeminiRetrievalResult } from "../../api/_lib/gemini.js";
import type { UiQualityCase } from "./ui-quality-cases.js";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import { runLiveUiQualityEvaluation } from "./ui-quality-live-runner.js";

const LIVE_ENABLED =
  process.env.RUN_LIVE_UI_EVALS === "true" &&
  typeof process.env.GEMINI_API_KEY === "string" &&
  process.env.GEMINI_API_KEY.length > 0;

const CLIENT_CONTEXT = {
  sizeClass: "expanded" as const,
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial" as const,
  reducedMotion: false,
};

function facts(testCase: UiQualityCase): string {
  return testCase.expected.requiredFacts.map((requiredFact) => requiredFact.anyOf[0]).join(". ");
}

function sources(testCase: UiQualityCase): SourceRecord[] {
  return testCase.expected.requiredSourceIds.map((id) => ({
    id,
    title: id.startsWith("src_weather") ? "Recorded Google Weather evidence" : "Recorded primary-source evidence",
    url: `https://evidence.example.test/${testCase.fixture}/${id}`,
    provider: id.startsWith("src_weather") ? "google-weather" : "google-search",
    accessedAt: "2026-08-02T12:00:00.000Z",
    snippet: facts(testCase),
  }));
}

function weatherEvidence(testCase: UiQualityCase): GeminiRetrievalResult["evidence"] {
  if (!testCase.expected.requiredSourceIds.some((id) => id.startsWith("src_weather"))) return [];
  const metric = testCase.prompt.toLocaleLowerCase("en-US").includes("celsius");
  const unit = metric ? "C" : "F";
  const daily = Array.from({ length: 7 }, (_unused, index) => ({
    date: `2026-08-${String(index + 3).padStart(2, "0")}`,
    startTime: `2026-08-${String(index + 3).padStart(2, "0")}T10:00:00.000Z`,
    endTime: `2026-08-${String(index + 4).padStart(2, "0")}T10:00:00.000Z`,
    high: metric ? 25 - index : 82 - index,
    low: metric ? 17 - index : 66 - index,
    temperatureUnit: unit,
    precipitationProbability: index === 2 ? 80 : 20 + index,
    conditionKey: index === 2 ? "rain" : "partly-cloudy",
    conditionText: index === 2 ? "Rain" : "Partly cloudy",
    nighttimeConditionKey: "cloudy",
    nighttimeConditionText: "Cloudy",
  }));
  const hourly = Array.from({ length: 12 }, (_unused, index) => ({
    startTime: `2026-08-02T${String(11 + index).padStart(2, "0")}:00:00.000Z`,
    endTime: `2026-08-02T${String(12 + index).padStart(2, "0")}:00:00.000Z`,
    temperature: metric ? 23 - Math.floor(index / 4) : 74 - Math.floor(index / 4),
    feelsLike: metric ? 23 - Math.floor(index / 4) : 74 - Math.floor(index / 4),
    temperatureUnit: unit,
    precipitationProbability: 10,
    thunderstormProbability: 2,
    conditionKey: "partly-cloudy",
    conditionText: "Partly cloudy",
    isDaytime: index < 9,
    humidity: 55,
    windSpeed: 7,
    windGust: 10,
    windSpeedUnit: metric ? "km/h" : "mph",
  }));

  return [
    {
      tool: "get_weather_bundle",
      arguments: { location: "Recorded location", units: metric ? "metric" : "imperial" },
      result: {
        locations: [
          {
            location: {
              name: testCase.expected.requiredFacts[0]?.anyOf[0] ?? "Recorded location",
              latitude: 35.7796,
              longitude: -78.6382,
              placeId: `recorded-${testCase.id.toLocaleLowerCase("en-US")}`,
            },
            units: metric ? "metric" : "imperial",
            fetchedAt: "2026-08-02T12:00:00.000Z",
            current: {
              observedAt: "2026-08-02T12:00:00.000Z",
              timeZone: "America/New_York",
              temperature: metric ? 27 : 81,
              feelsLike: metric ? 28 : 83,
              temperatureUnit: unit,
              conditionKey: "partly-cloudy",
              conditionText: "Partly cloudy",
              isDaytime: true,
              humidity: 58,
              precipitationProbability: 12,
              windDirection: "SW",
              windDegrees: 225,
              windSpeed: 7,
              windGust: 11,
              windSpeedUnit: metric ? "km/h" : "mph",
              visibility: metric ? 16 : 10,
              visibilityUnit: metric ? "km" : "mi",
              uvIndex: 4,
              cloudCover: 35,
              thunderstormProbability: 3,
            },
            hourly,
            daily,
            alerts: [
              {
                id: "recorded-alert",
                title: "Severe Thunderstorm Warning",
                eventType: "Severe Thunderstorm Warning",
                eventTypeCode: "SVR",
                areaName: "Recorded area",
                description: "Recorded severe-weather alert.",
                instructions: ["Follow local official guidance."],
                safetyRecommendations: ["Move indoors."],
                startsAt: "2026-08-02T16:00:00.000Z",
                expiresAt: "2026-08-02T22:00:00.000Z",
                severity: "severe",
                certainty: "observed",
                urgency: "immediate",
                sourceName: "National Weather Service",
              },
            ],
          },
        ],
        units: metric ? "metric" : "imperial",
        fetchedAt: "2026-08-02T12:00:00.000Z",
        attribution: {
          text: "Source: Includes weather data from Google",
          url: "https://developers.google.com/maps/documentation/weather/policies",
        },
        activityWindows: [
          {
            location: {
              name: "Recorded location",
              latitude: 35.7796,
              longitude: -78.6382,
              placeId: `recorded-${testCase.id.toLocaleLowerCase("en-US")}`,
            },
            activity: testCase.prompt.includes("run") ? "run" : "walk",
            startTime: "2026-08-02T23:00:00.000Z",
            endTime: "2026-08-03T00:30:00.000Z",
            durationHours: 1.5,
            score: 91,
            confidence: "high",
            reasons: ["Comfortable temperature", "Low precipitation risk"],
            label: "Best activity window",
            detail: "7:00 PM to 8:30 PM",
          },
        ],
      },
    },
  ];
}

function recordedRetrieval(testCase: UiQualityCase): GeminiRetrievalResult {
  const evidence = weatherEvidence(testCase);
  return {
    outputText: facts(testCase),
    sources: sources(testCase),
    evidence,
    steps: [],
    toolRounds: evidence.length > 0 ? 1 : 0,
  };
}

describe.skipIf(!LIVE_ENABLED)("opt-in live UI composition evaluation", () => {
  it("meets the supported-case validity and fallback thresholds", async () => {
    const compositionModule = await import("../../api/_lib/composition.js") as unknown as {
      composeSurfacePlan?: (input: {
        gemini: ReturnType<typeof createGeminiProvider>;
        prompt: string;
        clientContext: typeof CLIENT_CONTEXT;
        retrieval: GeminiRetrievalResult;
        signal?: AbortSignal;
      }) => Promise<{
        plan: Record<string, unknown>;
        spec: { kind: string; rootId: string; components: Array<Record<string, unknown>> };
        repairCount: 0 | 1;
        fallbackUsed: boolean;
      }>;
    };
    if (!compositionModule.composeSurfacePlan) {
      throw new TypeError("composeSurfacePlan is unavailable; plan-v2 must be implemented first.");
    }
    const composeSurfacePlan = compositionModule.composeSurfacePlan;
    const gemini = createGeminiProvider();

    const report = await runLiveUiQualityEvaluation({
      enabled: true,
      compose: async (testCase) => {
        const retrieval = recordedRetrieval(testCase);
        const result = await composeSurfacePlan({
          gemini,
          prompt: testCase.prompt,
          clientContext: CLIENT_CONTEXT,
          retrieval,
          signal: AbortSignal.timeout(45_000),
        });
        return {
          candidate: {
            benchmark: testCase,
            plan: result.plan,
            spec: result.spec,
            sources: retrieval.sources,
          },
          repairCount: result.repairCount,
          fallbackUsed: result.fallbackUsed,
        };
      },
    });

    const firstPassRate = report.totals.firstPassValid / report.totals.attempted;
    expect(report.totals.attempted).toBe(UI_QUALITY_CASES.length * 3);
    expect(firstPassRate).toBeGreaterThanOrEqual(0.95);
    expect(report.totals.fallbacks).toBe(0);
    expect(report.totals.valid).toBe(report.totals.attempted);
    expect(new Set(report.samples.map((sample) => sample.recipeId))).toEqual(
      new Set(UI_QUALITY_CASES.map((testCase) => testCase.recipeId)),
    );
    console.info(JSON.stringify({
      event: "ui_quality_live_report",
      totals: report.totals,
      recipeSelections: Object.fromEntries(
        UI_QUALITY_CASES.map((testCase) => [
          testCase.recipeId,
          report.samples.filter((sample) => sample.recipeId === testCase.recipeId).length,
        ]),
      ),
      structuralFingerprints: new Set(
        report.samples.map((sample) => sample.structuralFingerprint),
      ).size,
      latencyMs: {
        maximum: Math.max(...report.samples.map((sample) => sample.latencyMs)),
        average: Math.round(
          report.samples.reduce((total, sample) => total + sample.latencyMs, 0) /
            report.samples.length,
        ),
      },
    }));
  }, 900_000);
});

describe.skipIf(LIVE_ENABLED)("opt-in live UI composition evaluation", () => {
  it("stays disabled without both explicit opt-in and a Gemini key", () => {
    expect(LIVE_ENABLED).toBe(false);
  });
});
