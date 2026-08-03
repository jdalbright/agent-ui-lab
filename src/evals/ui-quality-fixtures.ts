import type { SourceRecord } from "@shared/schemas.js";
import type { UiQualityCase } from "./ui-quality-cases.js";

export interface RecordedUiQualityCandidate {
  readonly benchmark: UiQualityCase;
  readonly plan: Readonly<Record<string, unknown>>;
  readonly spec: {
    readonly kind: string;
    readonly rootId: string;
    readonly components: readonly Record<string, unknown>[];
  };
  readonly sources: readonly SourceRecord[];
}

function domainForRecipe(recipeId: UiQualityCase["recipeId"]): string {
  return recipeId.split(".", 1)[0] ?? "narrative";
}

function factSummary(testCase: UiQualityCase): string {
  return testCase.expected.requiredFacts
    .map((requiredFact) => requiredFact.anyOf[0])
    .join(" · ");
}

function sourceRecord(id: string, fixture: string): SourceRecord {
  const weather = id.startsWith("src_weather");
  return {
    id,
    title: `${weather ? "Google Weather" : "Grounded research"} recorded evidence`,
    url: `https://evidence.example.test/${fixture}/${id}`,
    provider: weather ? "google-weather" : "google-search",
    accessedAt: "2026-08-02T12:00:00.000Z",
  };
}

function leafNode(
  component: string,
  id: string,
  summary: string,
  sourceIds: readonly string[],
): Record<string, unknown> {
  const firstSourceId = sourceIds[0];
  switch (component) {
    case "WeatherHero":
      return {
        id,
        component,
        location: "Recorded location",
        dateLabel: "Recorded forecast",
        temperature: 81,
        unit: "F",
        condition: "Partly cloudy",
        conditionKey: "partly-cloudy",
        recommendationLabel: "Answer",
        recommendationValue: "Recorded conditions",
        recommendationDetail: summary,
      };
    case "WeatherAlert":
      return {
        id,
        component,
        title: "Recorded alert",
        severity: "severe",
        description: "Recorded alert detail.",
        sourceId: firstSourceId,
      };
    case "RecommendationBand":
      return {
        id,
        component,
        label: "Recommendation",
        value: "Recorded best option",
        detail: "Based on the recorded evidence.",
        confidence: "high",
      };
    case "HourlyForecast":
      return {
        id,
        component,
        label: "Requested hours",
        unit: "F",
        items: [
          { time: "7 PM", temperature: 78, precipitationProbability: 10, condition: "clear" },
          { time: "8 PM", temperature: 76, precipitationProbability: 10, condition: "clear" },
        ],
      };
    case "DailyForecast":
      return {
        id,
        component,
        label: "Requested days",
        unit: "C",
        items: [{ date: "Tuesday", high: 24, low: 17, precipitationProbability: 40, condition: "rain" }],
      };
    case "ComparisonSummary":
      return {
        id,
        component,
        title: "Recorded comparison",
        recommendation: summary,
        items: [
          { label: "Recorded option", value: "81", recommended: true },
          { label: "Recorded alternative", value: "79", recommended: false },
        ],
      };
    case "ComparisonChart":
      return {
        id,
        component,
        title: "Recorded trend",
        labels: ["Saturday", "Sunday"],
        series: [{ label: "Recorded option", values: [81, 82] }],
        unit: "°F",
      };
    case "ComparisonTable":
      return {
        id,
        component,
        caption: "Recorded trend table",
        columns: ["Option", "Saturday", "Sunday"],
        rows: [["Recorded option", "81", "82"]],
      };
    case "ResearchLead":
      return {
        id,
        component,
        title: "Recorded research answer",
        summary,
        sourceIds,
      };
    case "EvidenceList":
      return {
        id,
        component,
        label: "Evidence",
        items: sourceIds.map((sourceId, index) => ({
          title: `Recorded finding ${index + 1}`,
          finding: "The recorded source supports this finding.",
          sourceId,
        })),
      };
    case "Timeline":
      return {
        id,
        component,
        label: "Timeline",
        items: sourceIds.map((sourceId, index) => ({
          date: `202${4 + index}`,
          title: `Recorded event ${index + 1}`,
          detail: "The recorded source establishes this event.",
          sourceId,
        })),
      };
    case "SourceList":
      return { id, component, label: "Sources", sourceIds };
    default:
      return { id, component, text: "Recorded supporting context." };
  }
}

export function buildRecordedUiQualityCandidate(
  testCase: UiQualityCase,
): RecordedUiQualityCandidate {
  const summary = factSummary(testCase);
  const sourceIds = testCase.expected.requiredSourceIds;
  const children = testCase.expected.requiredComponents.map(
    (_component, index) => `module-${index + 1}`,
  );
  const components: Record<string, unknown>[] = [
    {
      id: "root",
      component: "SurfaceFrame",
      recipeId: testCase.recipeId,
      density: testCase.expected.density,
      emphasis: testCase.expected.emphasis,
      children,
    },
    ...testCase.expected.requiredComponents.map((component, index) =>
      leafNode(component, children[index], summary, sourceIds),
    ),
  ];

  return {
    benchmark: testCase,
    plan: {
      kind: domainForRecipe(testCase.recipeId),
      recipeId: testCase.recipeId,
      density: testCase.expected.density,
      emphasis: testCase.expected.emphasis,
      modules: testCase.expected.requiredComponents.map((component) => ({ component })),
    },
    spec: {
      kind: domainForRecipe(testCase.recipeId),
      rootId: "root",
      components,
    },
    sources: sourceIds.map((sourceId) => sourceRecord(sourceId, testCase.fixture)),
  };
}

export function uiQualityStructuralFingerprint(
  candidate: RecordedUiQualityCandidate,
): string {
  return JSON.stringify({
    recipeId: candidate.plan.recipeId,
    density: candidate.plan.density,
    emphasis: candidate.plan.emphasis,
    components: candidate.spec.components.map((node) => node.component),
  });
}
