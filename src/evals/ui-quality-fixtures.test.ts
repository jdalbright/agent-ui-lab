import { describe, expect, it } from "vitest";
import {
  compileSurfacePlan,
  validateSurfacePlan,
} from "../../api/_lib/surface-plan.js";
import type { GeminiRetrievalResult } from "../../api/_lib/gemini.js";
import { lintSurfaceQuality } from "../../api/_lib/surface-quality.js";
import { validateSurfaceSpec } from "../../shared/surface-validation.js";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import {
  buildRecordedUiQualityCandidate,
  recordedUiQualityCompilationInput,
  uiQualityStructuralFingerprint,
} from "./ui-quality-fixtures.js";

function qualityCase(id: string) {
  const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === id);
  if (!testCase) throw new TypeError(`Unknown UI quality case ${id}.`);
  return testCase;
}

function component(
  spec: ReturnType<typeof compileSurfacePlan>,
  name: string,
): Record<string, unknown> {
  const node = spec.components.find((candidate) => candidate.component === name);
  if (!node) throw new TypeError(`Compiled surface is missing ${name}.`);
  return node;
}

function mutableWeatherResult(retrieval: GeminiRetrievalResult): {
  locations: Array<{
    current: { temperature: number };
    daily: Array<{ high: number; low: number; precipitationProbability: number }>;
  }>;
} {
  const evidence = retrieval.evidence[0];
  if (!evidence) throw new TypeError("Recorded weather evidence is missing.");
  return evidence.result as {
    locations: Array<{
      current: { temperature: number };
      daily: Array<{ high: number; low: number; precipitationProbability: number }>;
    }>;
  };
}

describe("recorded UI quality evaluation", () => {
  it.each(UI_QUALITY_CASES)("$id records a valid plan before compilation", (testCase) => {
    const input = recordedUiQualityCompilationInput(testCase);
    const validation = validateSurfacePlan(input.plan, {
      sources: input.retrieval.sources,
      evidence: input.retrieval.evidence,
      prompt: testCase.prompt,
      clientContext: input.clientContext,
    });
    if (!validation.success) {
      throw new TypeError(`${testCase.id}: ${validation.issues.join(" ")}`);
    }
    expect(buildRecordedUiQualityCandidate(testCase).spec, testCase.id).toEqual(
      compileSurfacePlan(input),
    );
  });

  it.each(UI_QUALITY_CASES)("$id passes all deterministic quality checks", (testCase) => {
    const candidate = buildRecordedUiQualityCandidate(testCase);
    expect(validateSurfaceSpec(candidate.spec, candidate.sources), testCase.id).toMatchObject({
      success: true,
    });
    expect(lintSurfaceQuality(candidate), testCase.id).toEqual({
      success: true,
      checks: {
        recipe_fit: true,
        answer_first: true,
        sources_last: true,
        requested_coverage: true,
        duplicate_primary: true,
        chart_table_alignment: true,
        citation_coverage: true,
        content_budget: true,
      },
      issues: [],
    });
  });

  it("copies current weather measurements from evidence instead of plan prose", () => {
    const input = recordedUiQualityCompilationInput(qualityCase("QW01"));
    const retrieval = structuredClone(input.retrieval);
    mutableWeatherResult(retrieval).locations[0].current.temperature = 42;

    const spec = compileSurfacePlan({ ...input, retrieval });

    expect(component(spec, "WeatherHero").temperature).toBe(42);
  });

  it("preserves every requested seven-day and five-day weather record", () => {
    const sevenDayInput = recordedUiQualityCompilationInput(qualityCase("QW05"));
    const sevenDayRetrieval = structuredClone(sevenDayInput.retrieval);
    mutableWeatherResult(sevenDayRetrieval).locations[0].daily[6].high = 29;
    const sevenDaySpec = compileSurfacePlan({ ...sevenDayInput, retrieval: sevenDayRetrieval });
    const sevenDayItems = component(sevenDaySpec, "DailyForecast").items as Array<{
      high: number;
    }>;

    const fiveDayInput = recordedUiQualityCompilationInput(qualityCase("QW06"));
    const fiveDaySpec = compileSurfacePlan(fiveDayInput);
    const fiveDayItems = component(fiveDaySpec, "DailyForecast").items as unknown[];

    expect(sevenDayItems).toHaveLength(7);
    expect(sevenDayItems[6].high).toBe(29);
    expect(fiveDayItems).toHaveLength(5);
  });

  it("preserves the full location and day range in a weather-backed comparison", () => {
    const input = recordedUiQualityCompilationInput(qualityCase("QC06"));
    const retrieval = structuredClone(input.retrieval);
    mutableWeatherResult(retrieval).locations[2].daily[4].high = 78;

    const spec = compileSurfacePlan({ ...input, retrieval });
    const chart = component(spec, "ComparisonChart");
    const series = chart.series as Array<{ label: string; values: number[] }>;

    expect(chart.labels).toHaveLength(5);
    expect(series).toHaveLength(3);
    expect(series.map((item) => item.label).join(" ")).toMatch(/Miami.*Denver.*Seattle/);
    expect(series[2].values).toHaveLength(5);
    expect(series[2].values[4]).toBe(78);
  });

  it("rejects a recorded plan that cites a source the server did not issue", () => {
    const input = recordedUiQualityCompilationInput(qualityCase("QR01"));
    const plan = structuredClone(input.plan);
    const evidenceModule = plan.modules.find((module) => module.type === "evidence");
    if (!evidenceModule || evidenceModule.type !== "evidence") {
      throw new TypeError("Recorded research plan is missing its evidence module.");
    }
    evidenceModule.items[0].sourceId = "src_unknown1";

    expect(() => compileSurfacePlan({ ...input, plan })).toThrow(/Unknown source reference/);
  });

  it("rejects a final SourceList that drops a cited source", () => {
    const input = recordedUiQualityCompilationInput(qualityCase("QR01"));
    const plan = structuredClone(input.plan);
    const sourceModule = plan.modules.find((module) => module.type === "sources");
    if (!sourceModule || sourceModule.type !== "sources") {
      throw new TypeError("Recorded research plan is missing its source module.");
    }
    sourceModule.sourceIds.splice(1, 1);

    expect(() => compileSurfacePlan({ ...input, plan })).toThrow(
      /Final sources do not cover cited source/,
    );
  });

  it.each(UI_QUALITY_CASES)("$id preserves required source IDs in the final SourceList", (testCase) => {
    const candidate = buildRecordedUiQualityCandidate(testCase);
    const sourceList = component(candidate.spec, "SourceList");
    expect(sourceList.sourceIds, testCase.id).toEqual(testCase.expected.requiredSourceIds);
  });

  it("produces stable structural fingerprints without provider access", () => {
    for (const testCase of UI_QUALITY_CASES) {
      const first = uiQualityStructuralFingerprint(buildRecordedUiQualityCandidate(testCase));
      const second = uiQualityStructuralFingerprint(buildRecordedUiQualityCandidate(testCase));
      expect(first, testCase.id).toBe(second);
    }
  });
});
