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
  evaluateUiQualityStructuralConformance,
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

function compiledRecordedCandidate(
  testCase: (typeof UI_QUALITY_CASES)[number],
  mutatePlan: (plan: Parameters<typeof compileSurfacePlan>[0]["plan"]) => void,
) {
  const input = recordedUiQualityCompilationInput(testCase);
  const plan = structuredClone(input.plan);
  mutatePlan(plan);
  return {
    benchmark: testCase,
    plan,
    spec: compileSurfacePlan({ ...input, plan, prompt: testCase.prompt }),
    sources: input.retrieval.sources,
  };
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

  it("records multi-location weather requests as an ordered locations array", () => {
    const input = recordedUiQualityCompilationInput(qualityCase("QC06"));
    const weatherEvidence = input.retrieval.evidence[0];

    expect(weatherEvidence?.arguments).toEqual({
      locations: ["Miami, Florida", "Denver, Colorado", "Seattle, Washington"],
      units: "imperial",
    });
    expect(weatherEvidence?.arguments).not.toHaveProperty("location");
  });

  it("requires QC02 to choose Southwest from the recorded size limits", () => {
    const accepted = buildRecordedUiQualityCandidate(qualityCase("QC02"));
    expect(lintSurfaceQuality(accepted).checks.requested_coverage).toBe(true);

    const rejected = structuredClone(accepted);
    const summary = component(rejected.spec, "ComparisonSummary");
    summary.recommendation = "The two airlines have equivalent allowances; neither is more generous.";
    summary.items = [
      { label: "Southwest", value: "Equivalent", detail: "Published policy", recommended: false },
      { label: "Delta", value: "Equivalent", detail: "Published policy", recommended: false },
    ];

    expect(lintSurfaceQuality(rejected).checks.requested_coverage).toBe(false);
    expect(
      lintSurfaceQuality(rejected).issues.find((issue) => issue.code === "requested_coverage")?.message,
    ).toContain("decision");
  });

  it("credits the structured QC02 recommendation when the prose paraphrases generosity", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QC02"));
    const summary = component(candidate.spec, "ComparisonSummary");
    summary.recommendation = "Southwest gives travelers more carry-on room.";
    summary.items = [
      {
        label: "Southwest",
        value: "Roomier cabin bag",
        detail: "24 × 16 × 10 in carry-on",
        recommended: true,
      },
      {
        label: "Delta",
        value: "More compact cabin bag",
        detail: "22 × 14 × 9 in carry-on",
        recommended: false,
      },
    ];

    expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
  });

  it("binds the QC02 recommendation to Southwest dimensions in its structured table row", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QC02"));
    const summary = component(candidate.spec, "ComparisonSummary");
    summary.recommendation = "Southwest gives travelers more carry-on room.";
    summary.items = [
      { label: "Southwest", value: "Roomier allowance", recommended: true },
      { label: "Delta", value: "Smaller allowance", recommended: false },
    ];

    expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
  });

  it("accepts the bounded Southwest Airlines identity alias in the summary and table", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QC02"));
    const summary = component(candidate.spec, "ComparisonSummary");
    const table = component(candidate.spec, "ComparisonTable");
    summary.recommendation = "Southwest Airlines gives travelers more carry-on room.";
    summary.items = [
      { label: "Southwest Airlines", value: "Roomier allowance", recommended: true },
      { label: "Delta Air Lines", value: "Smaller allowance", recommended: false },
    ];
    table.rows = [
      ["Southwest Airlines", "24 × 16 × 10 in", "1 item"],
      ["Delta Air Lines", "22 × 14 × 9 in", "1 item"],
    ];

    expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
  });

  it.each(["Not Southwest", "Southwest Cargo", "Southwest and Delta"]) (
    "does not treat %s as the bounded Southwest identity alias",
    (label) => {
      const candidate = buildRecordedUiQualityCandidate(qualityCase("QC02"));
      const summary = component(candidate.spec, "ComparisonSummary");
      const table = component(candidate.spec, "ComparisonTable");
      summary.items = [
        { label, value: "Roomier allowance", recommended: true },
        { label: "Delta", value: "Smaller allowance", recommended: false },
      ];
      table.rows = [
        [label, "24 × 16 × 10 in", "1 item"],
        ["Delta", "22 × 14 × 9 in", "1 item"],
      ];

      const result = lintSurfaceQuality(candidate);

      expect(result.checks.requested_coverage).toBe(false);
      expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
        "decision",
      );
    },
  );

  it("does not bind QC02 dimensions from the other option's structured table row", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QC02"));
    const summary = component(candidate.spec, "ComparisonSummary");
    const table = component(candidate.spec, "ComparisonTable");
    summary.recommendation = "Southwest gives travelers more carry-on room.";
    summary.items = [
      { label: "Southwest", value: "Roomier allowance", recommended: true },
      { label: "Delta", value: "Smaller allowance", recommended: false },
    ];
    table.rows = [
      ["Southwest", "22 × 14 × 9 in", "1 item"],
      ["Delta", "24 × 16 × 10 in", "1 item"],
    ];

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      "decision",
    );
  });

  it.each([
    "Gemini 3.6 Flash has reached general availability.",
    "Gemini 3.6 Flash is available for production use.",
    "Gemini 3.6 Flash is production ready.",
  ])("credits the faithful QR01 release-status assertion: %s", (replacement) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "What changed in Gemini 3.6 Flash";
    lead.summary = "A concise sourced release brief.";
    items[0].finding = replacement;
    items[1].finding =
      "The release completes agentic workflows with fewer reasoning steps and turns and improves production-ready code generation with fewer debugging loops.";

    expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
  });

  it.each([
    {
      release:
        "Generally available and production-ready, with function calling and grounded search.",
      gains:
        "Completes agentic workflows with fewer reasoning steps, turns, and tool calls and improves production-ready code generation with fewer debugging loops.",
    },
    {
      release: "Reached general availability and is production ready.",
      gains:
        "Reduces reasoning overhead for agentic workflows and generates higher-quality production code.",
    },
  ])(
    "credits subjectless QR01 evidence when the ResearchLead establishes Gemini 3.6: $gains",
    ({ release, gains }) => {
      const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
      const lead = component(candidate.spec, "ResearchLead");
      const evidence = component(candidate.spec, "EvidenceList");
      const items = evidence.items as Array<Record<string, unknown>>;
      lead.title = "Gemini 3.6 Flash release brief";
      lead.summary = "What changed in Gemini 3.6 Flash.";
      items[0].finding = release;
      items[1].finding = gains;

      expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
    },
  );

  it("does not credit subjectless QR01 evidence without a ResearchLead target", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "Release brief";
    lead.summary = "A concise sourced update.";
    items[0].finding = "Generally available and production-ready.";
    items[1].finding =
      "Completes agentic workflows with fewer reasoning steps and tool calls and improves production-ready code generation with fewer debugging loops.";

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.missingFactConcepts).toEqual(expect.arrayContaining([
      "model",
      "release status",
      "agentic efficiency",
      "code improvement",
    ]));
  });

  it.each([
    "Gemini 3.5 Flash completes agentic workflows with fewer reasoning steps and tool calls and improves production-ready code generation.",
    "Gemini 4.0 completes agentic workflows with fewer reasoning steps and tool calls and improves production-ready code generation.",
  ])("does not rebind subjectless QR01 discourse to the wrong model: %s", (gains) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "Gemini 3.6 Flash release brief";
    lead.summary = "What changed in Gemini 3.6 Flash.";
    items[0].finding = "Generally available and production-ready.";
    items[1].finding = gains;

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.missingFactConcepts).toEqual(expect.arrayContaining([
      "agentic efficiency",
      "code improvement",
    ]));
  });

  it.each([
    {
      title: "Gemini 3.5 gains",
      finding:
        "Completes agentic workflows with fewer reasoning steps and tool calls and improves production-ready code generation.",
    },
    {
      title: "Earlier-model gains",
      finding:
        "Gemini 3.5 was the prior model. Completes agentic workflows with fewer reasoning steps and tool calls and improves production-ready code generation.",
    },
  ])(
    "does not inherit QR01 discourse across an item-local wrong target: $title",
    ({ title, finding }) => {
      const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
      const lead = component(candidate.spec, "ResearchLead");
      const evidence = component(candidate.spec, "EvidenceList");
      const items = evidence.items as Array<Record<string, unknown>>;
      lead.title = "Gemini 3.6 Flash release brief";
      lead.summary = "Gemini 3.6 Flash is generally available and production-ready.";
      items[1].title = title;
      items[1].finding = finding;

      const result = lintSurfaceQuality(candidate);

      expect(result.checks.requested_coverage).toBe(false);
      expect(result.missingFactConcepts).toEqual(expect.arrayContaining([
        "agentic efficiency",
        "code improvement",
      ]));
    },
  );

  it("keeps a prior-model mention in one evidence item from poisoning a later current-gains item", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    lead.title = "Gemini 3.6 Flash release brief";
    lead.summary = "Gemini 3.6 Flash is generally available and production-ready.";
    evidence.items = [
      {
        title: "Gemini 3.5 Flash",
        finding: "The prior model required more reasoning steps and debugging loops.",
        sourceId: "src_search01",
        stance: "support",
      },
      {
        title: "Current gains",
        finding:
          "Completes agentic workflows with fewer reasoning steps and tool calls and improves production-ready code generation with fewer debugging loops.",
        sourceId: "src_search02",
        stance: "support",
      },
    ];

    expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
  });

  it.each([
    {
      title: "Improved code generation",
      finding: "The sources do not substantiate that heading.",
      concept: "code improvement",
    },
    {
      title: "Fewer tool calls",
      finding: "That target was not achieved.",
      concept: "agentic efficiency",
    },
  ])("does not treat an EvidenceList heading as QR01 proof: $title", ({ title, finding, concept }) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "Gemini 3.6 Flash release brief";
    lead.summary = "Gemini 3.6 Flash is generally available and production-ready.";
    items[1].title = title;
    items[1].finding = finding;

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.missingFactConcepts).toContain(concept);
  });

  it.each([
    "Gemini 3.6 Flash was generally available.",
    "Gemini 3.6 Flash was a stable release.",
  ])("rejects the historical-only QR01 release-status claim: %s", (replacement) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "What changed in Gemini 3.6 Flash";
    lead.summary = "A concise sourced release brief.";
    items[0].finding = replacement;
    items[1].finding =
      "The release completes agentic workflows with fewer reasoning steps and turns and improves production-ready code generation with fewer debugging loops.";

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.missingFactConcepts).toContain("release status");
  });

  it.each([
    {
      label: "the wrong option is recommended",
      items: [
        {
          label: "Southwest",
          value: "Roomier cabin bag",
          detail: "24 × 16 × 10 in carry-on",
          recommended: false,
        },
        {
          label: "Delta",
          value: "Recommended cabin bag",
          detail: "22 × 14 × 9 in carry-on",
          recommended: true,
        },
      ],
    },
    {
      label: "the recommended option carries the wrong dimensions",
      items: [
        {
          label: "Southwest",
          value: "Roomier cabin bag",
          detail: "22 × 14 × 9 in carry-on",
          recommended: true,
        },
        {
          label: "Delta",
          value: "More compact cabin bag",
          detail: "24 × 16 × 10 in carry-on",
          recommended: false,
        },
      ],
    },
    {
      label: "more than one option is recommended",
      items: [
        {
          label: "Southwest",
          value: "Roomier cabin bag",
          detail: "24 × 16 × 10 in carry-on",
          recommended: true,
        },
        {
          label: "Delta",
          value: "Recommended cabin bag",
          detail: "22 × 14 × 9 in carry-on",
          recommended: true,
        },
      ],
    },
  ])("rejects QC02 when $label", ({ items }) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QC02"));
    const summary = component(candidate.spec, "ComparisonSummary");
    summary.recommendation = "Southwest gives travelers more carry-on room.";
    summary.items = items;

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      "decision",
    );
  });

  it.each([
    {
      concept: "release status",
      replacement: "Gemini 3.6 Flash is ready for production use.",
    },
    {
      concept: "agentic efficiency",
      replacement: "The model completes agentic work with less deliberation and fewer interactions.",
    },
    {
      concept: "code improvement",
      replacement: "The model produces stronger deployable code.",
    },
  ])("credits the bounded QR01 $concept paraphrase", ({ concept, replacement }) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;

    if (concept === "release status") {
      lead.title = "What changed in Gemini 3.6 Flash";
      lead.summary = "Gemini 3.6 Flash improves agentic work and production code.";
      items[0].finding = replacement;
      items[1].finding =
        "The release completes workflows with fewer reasoning steps and fewer debugging loops.";
    } else if (concept === "agentic efficiency") {
      items[1].finding = `${replacement} The release also improves code generation with fewer debugging loops.`;
    } else {
      items[1].finding = `The release completes workflows with fewer reasoning steps and turns. ${replacement}`;
    }

    expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
  });

  it.each([
    {
      concept: "release status",
      replacement: "Gemini 3.6 Flash is not ready for production use.",
    },
    {
      concept: "agentic efficiency",
      replacement: "The model requires more deliberation and more interactions to finish agentic work.",
    },
    {
      concept: "code improvement",
      replacement: "The model produces stronger prototype code that is not deployable.",
    },
  ])("rejects the bounded QR01 $concept negative control", ({ concept, replacement }) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;

    if (concept === "release status") {
      lead.title = "What changed in Gemini 3.6 Flash";
      lead.summary = "Gemini 3.6 Flash improves agentic work and production code.";
      items[0].finding = replacement;
      items[1].finding =
        "The release completes workflows with fewer reasoning steps and fewer debugging loops.";
    } else if (concept === "agentic efficiency") {
      items[1].finding = `${replacement} The release still improves code generation with fewer debugging loops.`;
    } else {
      items[1].finding = `The release completes workflows with fewer reasoning steps and turns. ${replacement}`;
    }

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      concept,
    );
  });

  it("does not assemble QR01 semantic atoms across unrelated text fields", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "What changed in Gemini 3.6 Flash";
    lead.summary = "Gemini 3.6 Flash is ready.";
    items[0].finding = "Its production profile is documented for teams that use the model.";
    items[1].finding =
      "The release completes workflows with fewer reasoning steps and fewer debugging loops.";

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      "release status",
    );
  });

  it.each([
    {
      concept: "agentic efficiency",
      replacement: "Gemini 3.6 Flash makes agentic workflows more efficient.",
    },
    {
      concept: "agentic efficiency",
      replacement:
        "The release completes agent work with less reasoning and fewer tool invocations.",
    },
    {
      concept: "agentic efficiency",
      replacement: "The release reduces reasoning overhead for agentic workflows.",
    },
    {
      concept: "code improvement",
      replacement: "The release generates higher-quality production code.",
    },
    {
      concept: "code improvement",
      replacement: "The release improves code quality for production use.",
    },
    {
      concept: "code improvement",
      replacement: "The release's generated code needs fewer debugging iterations before deployment.",
    },
  ])("credits the faithful QR01 $concept assertion: $replacement", ({ concept, replacement }) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "What changed in Gemini 3.6 Flash";
    lead.summary = "A concise sourced release brief.";
    items[0].finding = "Gemini 3.6 Flash is generally available and production-ready.";
    items[1].finding = concept === "agentic efficiency"
      ? `${replacement} The release also improves production-ready code generation with fewer debugging loops.`
      : `The release completes agentic workflows with fewer reasoning steps and turns. ${replacement}`;

    expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
  });

  it.each([
    {
      concept: "agentic efficiency",
      replacement: "Token efficiency remains unknown.",
    },
    {
      concept: "agentic efficiency",
      replacement: "No fewer reasoning steps were observed.",
    },
    {
      concept: "agentic efficiency",
      replacement: "There is no evidence that the model uses fewer turns.",
    },
    {
      concept: "agentic efficiency",
      replacement: "Whether the model uses fewer turns is unknown.",
    },
    {
      concept: "agentic efficiency",
      replacement: "Gemini 3.6 Flash does not make agentic workflows more efficient.",
    },
    {
      concept: "agentic efficiency",
      replacement: "More efficient agentic workflows remain unconfirmed.",
    },
    {
      concept: "agentic efficiency",
      replacement: "Could Gemini 3.6 make agentic workflows more efficient?",
    },
    {
      concept: "agentic efficiency",
      replacement:
        "Gemini 3.5 made agentic workflows more efficient; Gemini 3.6 requires more reasoning.",
    },
    {
      concept: "agentic efficiency",
      replacement:
        "Unlike Gemini 3.6 Flash, Gemini 3.5 makes agentic workflows more efficient.",
    },
    {
      concept: "agentic efficiency",
      replacement:
        "The release notes report Gemini 3.5 used fewer turns; Gemini 3.6 regressed.",
    },
    {
      concept: "agentic efficiency",
      replacement:
        "The release reduces reasoning steps and tool calls for Gemini 3.5 Flash, while Gemini 3.6 requires more.",
    },
    {
      concept: "agentic efficiency",
      replacement: "Gemini 3.5 was the model with fewer reasoning steps.",
    },
    {
      concept: "agentic efficiency",
      replacement: "Gemini 3.6 benchmarks measure fewer tool calls.",
    },
    {
      concept: "agentic efficiency",
      replacement: "It is possible that Gemini 3.6 uses fewer tool calls.",
    },
    {
      concept: "agentic efficiency",
      replacement:
        "Gemini 3.6 Flash used fewer tool calls last year but no longer does.",
    },
    {
      concept: "agentic efficiency",
      replacement:
        "The release uses fewer reasoning steps, but that claim remains unconfirmed.",
    },
    {
      concept: "agentic efficiency",
      replacement:
        "The release uses fewer tool calls; however, the evidence does not support that claim.",
    },
    {
      concept: "code improvement",
      replacement: "No improved code generation was found.",
    },
    {
      concept: "code improvement",
      replacement: "There is no evidence of improved code generation from this release.",
    },
    {
      concept: "code improvement",
      replacement: "Whether this release has improved code generation is unknown.",
    },
    {
      concept: "code improvement",
      replacement: "Improved code generation may arrive in a later release.",
    },
    {
      concept: "code improvement",
      replacement: "Gemini 3.6 Flash does not generate higher-quality production code.",
    },
    {
      concept: "code improvement",
      replacement: "Higher-quality production code remains unconfirmed.",
    },
    {
      concept: "code improvement",
      replacement: "Gemini 3.6 may generate higher-quality production code.",
    },
    {
      concept: "code improvement",
      replacement:
        "Gemini 3.5 generated higher-quality production code; Gemini 3.6 did not improve code quality.",
    },
    {
      concept: "code improvement",
      replacement: "Compared with Gemini 3.6, Gemini 3.5 had fewer debugging loops.",
    },
    {
      concept: "code improvement",
      replacement:
        "The release reduces debugging cycles for Gemini 3.5 Flash, while Gemini 3.6 produces worse code.",
    },
    {
      concept: "code improvement",
      replacement: "Testing asks whether Gemini 3.6 improves code generation.",
    },
    {
      concept: "code improvement",
      replacement: "Gemini 3.6 allegedly improves code generation.",
    },
    {
      concept: "code improvement",
      replacement:
        "Gemini 3.6 Flash improved code generation last year but no longer does.",
    },
    {
      concept: "code improvement",
      replacement:
        "The release improves code generation, but that claim remains unconfirmed.",
    },
    {
      concept: "code improvement",
      replacement:
        "The release generates higher-quality production code; however, the evidence does not support that claim.",
    },
  ])("rejects the non-affirmative QR01 $concept claim: $replacement", ({ concept, replacement }) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "What changed in Gemini 3.6 Flash";
    lead.summary = "A concise sourced release brief.";
    items[0].finding = "Gemini 3.6 Flash is generally available and production-ready.";
    items[1].finding = concept === "agentic efficiency"
      ? `${replacement} The release still improves production-ready code generation with fewer debugging loops.`
      : `The release still completes agentic workflows with fewer reasoning steps and turns. ${replacement}`;

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.missingFactConcepts).toContain(concept);
    expect(result.missingFactConcepts).not.toContain(
      concept === "agentic efficiency" ? "code improvement" : "agentic efficiency",
    );
  });

  it("does not assemble QR01 efficiency across unrelated assertions in one field", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "What changed in Gemini 3.6 Flash";
    lead.summary = "A concise sourced release brief.";
    items[0].finding = "Gemini 3.6 Flash is generally available and production-ready.";
    items[1].finding =
      "Agentic workflows remain unchanged. The deployment runtime is more efficient. The release improves production-ready code generation.";

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.missingFactConcepts).toContain("agentic efficiency");
  });

  it("rejects QR01 topical language that does not assert either documented gain", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "What changed in Gemini 3.6 Flash";
    lead.summary = "A concise sourced release brief.";
    items[0].finding = "Gemini 3.6 Flash is generally available and production-ready.";
    items[1].finding =
      "The documentation discusses token efficiency and improved code generation without reporting a gain.";

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.missingFactConcepts).toEqual(expect.arrayContaining([
      "agentic efficiency",
      "code improvement",
    ]));
  });

  it("rejects QR01 topical language even when it contains otherwise valid paraphrases", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "What changed in Gemini 3.6 Flash";
    lead.summary = "A concise sourced release brief.";
    items[0].finding = "Gemini 3.6 Flash is generally available and production-ready.";
    items[1].finding =
      "The release documentation discusses more efficient agentic workflows and higher-quality production code without reporting a gain.";

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.missingFactConcepts).toEqual(expect.arrayContaining([
      "agentic efficiency",
      "code improvement",
    ]));
  });

  it("does not credit QR01 release status from the superseded model", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR01"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "What changed in Gemini 3.6 Flash";
    lead.summary = "A concise sourced release brief.";
    items[0].finding =
      "Gemini 3.6 Flash remains preview-only. Gemini 3.5 is stable for production use.";
    items[1].finding =
      "The release completes workflows with fewer reasoning steps and turns and improves production-ready code generation with fewer debugging loops.";

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.missingFactConcepts).toContain("release status");
  });

  it("credits bounded QR06 release-status paraphrases without a v prefix", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR06"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "A2UI 1.0 has not displaced 0.9.1";
    lead.summary =
      "A2UI 1.0 remains at release-candidate status, while A2UI 0.9.1 is still the stable release used in production.";
    items[0] = {
      title: "Current line",
      finding: "A2UI 0.9.1 is still the stable release used in production.",
      sourceId: "src_search01",
      stance: "support",
    };
    items[1] = {
      title: "Candidate line",
      finding: "A2UI 1.0 remains a release candidate, contradicting the replacement claim.",
      sourceId: "src_search02",
      stance: "challenge",
    };

    expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
  });

  it("records QR06 evidence stances relative to the user-stated replacement claim", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR06"));
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<{ stance?: string }>;

    expect(items.map((item) => item.stance)).toEqual(["challenge", "challenge"]);
  });

  it.each([
    {
      concept: "v1.0 status",
      summary:
        "A2UI 1.0 is not a release candidate; it is stable. A2UI 0.9.1 remains the current release.",
    },
    {
      concept: "v0.9.1 status",
      summary:
        "A2UI 1.0 remains a release candidate. A2UI 0.9.1 is not current and has been superseded.",
    },
    {
      concept: "v0.9.1 status",
      summary:
        "A2UI 1.0 remains a release candidate. A2UI 0.9.1 is no longer the current release.",
    },
    {
      concept: "v0.9.1 status",
      summary:
        "A2UI 1.0 remains a release candidate. A2UI 0.9.1 was the current production release before 1.0 replaced it.",
    },
  ])("rejects the bounded QR06 $concept negative control", ({ concept, summary }) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QR06"));
    const lead = component(candidate.spec, "ResearchLead");
    const evidence = component(candidate.spec, "EvidenceList");
    const items = evidence.items as Array<Record<string, unknown>>;
    lead.title = "A2UI 1.0 and 0.9.1 release status";
    lead.summary = summary;
    items[0] = {
      title: "Earlier line",
      finding: summary,
      sourceId: "src_search01",
      stance: "support",
    };
    items[1] = {
      title: "Later line",
      finding: summary,
      sourceId: "src_search02",
      stance: "challenge",
    };

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      concept,
    );
  });

  it.each([
    "It does not expire at 6:00 PM.",
    "One report mentions 6 PM; the expiration is unknown.",
    "It does not expire at 6:00 PM; the expiration is unknown.",
  ])("does not credit negated or unknown QW02 alert-expiration copy: %s", (description) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QW02"));
    const hero = component(candidate.spec, "WeatherHero");
    const alert = component(candidate.spec, "WeatherAlert");
    hero.recommendationDetail = "New Orleans should continue monitoring the severe warning.";
    alert.description = description;

    const result = lintSurfaceQuality(candidate);

    expect(result.checks.requested_coverage).toBe(false);
    expect(result.issues.find((issue) => issue.code === "requested_coverage")?.message).toContain(
      "alert expiry",
    );
  });

  it.each([
    "The Severe Thunderstorm Warning expires at 6:00 PM local time.",
    "The Severe Thunderstorm Warning remains active through 6 PM.",
    "The storm's cause is unknown, but the warning remains active through 6 PM.",
  ])("credits affirmative QW02 alert-expiration copy: %s", (description) => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QW02"));
    const hero = component(candidate.spec, "WeatherHero");
    const alert = component(candidate.spec, "WeatherAlert");
    hero.recommendationDetail = "New Orleans should continue monitoring the severe warning.";
    alert.description = description;

    expect(lintSurfaceQuality(candidate).checks.requested_coverage).toBe(true);
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

  it("accepts QW01 when its unrequested optional metrics are omitted", () => {
    const testCase = qualityCase("QW01");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "weather") throw new TypeError("QW01 is not a weather plan.");
      plan.modules = plan.modules.filter((module) => module.type !== "metrics");
    });

    expect(candidate.spec.components.map((node) => node.component)).toEqual([
      "SurfaceFrame",
      "WeatherHero",
      "SourceList",
    ]);
    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: true,
      issues: [],
    });
  });

  it.each(["strip", "chart"] as const)(
    "accepts QW04 with the allowed %s hourly variant",
    (variant) => {
      const testCase = qualityCase("QW04");
      const candidate = compiledRecordedCandidate(testCase, (plan) => {
        if (plan.kind !== "weather") throw new TypeError("QW04 is not a weather plan.");
        const hourlyModule = plan.modules.find((module) => module.type === "hourly");
        if (!hourlyModule || hourlyModule.type !== "hourly") {
          throw new TypeError("QW04 is missing its hourly module.");
        }
        hourlyModule.variant = variant;
      });

      expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
        success: true,
        issues: [],
      });
    },
  );

  it("accepts QC05 with the trusted bar chart variant", () => {
    const testCase = qualityCase("QC05");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "comparison") throw new TypeError("QC05 is not a comparison plan.");
      const chartModule = plan.modules.find((module) => module.type === "chart");
      if (!chartModule || chartModule.type !== "chart") {
        throw new TypeError("QC05 is missing its chart module.");
      }
      chartModule.variant = "bar";
    });

    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: true,
      issues: [],
    });
  });

  it("still requires QC05's balanced summary when the chart uses bars", () => {
    const testCase = qualityCase("QC05");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "comparison") throw new TypeError("QC05 is not a comparison plan.");
      const chartModule = plan.modules.find((module) => module.type === "chart");
      if (!chartModule || chartModule.type !== "chart") {
        throw new TypeError("QC05 is missing its chart module.");
      }
      chartModule.variant = "bar";
    });
    component(candidate.spec, "ComparisonSummary").variant = "verdict";

    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: false,
      issues: [
        {
          code: "semantic_variant",
          component: "ComparisonSummary",
          actual: "verdict",
          allowed: ["balanced"],
        },
      ],
    });
  });

  it("accepts QC06 with the trusted bar chart variant", () => {
    const testCase = qualityCase("QC06");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "comparison") throw new TypeError("QC06 is not a comparison plan.");
      const chartModule = plan.modules.find((module) => module.type === "chart");
      if (!chartModule || chartModule.type !== "chart") {
        throw new TypeError("QC06 is missing its chart module.");
      }
      chartModule.variant = "bar";
    });

    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: true,
      issues: [],
    });
  });

  it("keeps QC06's balanced summary and complete trend structure strict for bars", () => {
    const testCase = qualityCase("QC06");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "comparison") throw new TypeError("QC06 is not a comparison plan.");
      const chartModule = plan.modules.find((module) => module.type === "chart");
      if (!chartModule || chartModule.type !== "chart") {
        throw new TypeError("QC06 is missing its chart module.");
      }
      chartModule.variant = "bar";
    });
    const table = candidate.spec.components.find(
      (node) => node.component === "ComparisonTable",
    );
    if (!table) throw new TypeError("QC06 is missing its comparison table.");
    component(candidate.spec, "ComparisonSummary").variant = "verdict";
    const frame = component(candidate.spec, "SurfaceFrame");
    frame.children = (frame.children as string[]).filter((childId) => childId !== table.id);
    const incompleteCandidate = {
      ...candidate,
      spec: {
        ...candidate.spec,
        components: candidate.spec.components.filter((node) => node.id !== table.id),
      },
    };

    expect(evaluateUiQualityStructuralConformance(incompleteCandidate)).toEqual({
      success: false,
      issues: [
        {
          code: "ordered_components",
          expected: [
            "ComparisonSummary",
            "ComparisonChart",
            "ComparisonTable",
            "SourceList",
          ],
          actual: ["SurfaceFrame", "ComparisonSummary", "ComparisonChart", "SourceList"],
        },
        {
          code: "semantic_variant",
          component: "ComparisonSummary",
          actual: "verdict",
          allowed: ["balanced"],
        },
      ],
    });
  });

  it("accepts QW06 with the trusted cards daily variant", () => {
    const testCase = qualityCase("QW06");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "weather") throw new TypeError("QW06 is not a weather plan.");
      const dailyModule = plan.modules.find((module) => module.type === "daily");
      if (!dailyModule || dailyModule.type !== "daily") {
        throw new TypeError("QW06 is missing its daily module.");
      }
      dailyModule.variant = "cards";
    });

    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: true,
      issues: [],
    });
  });

  it("accepts QR02 with trusted brief lead and stacked evidence variants", () => {
    const testCase = qualityCase("QR02");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "research") throw new TypeError("QR02 is not a research plan.");
      const leadModule = plan.modules.find((module) => module.type === "lead");
      const evidenceModule = plan.modules.find((module) => module.type === "evidence");
      if (!leadModule || leadModule.type !== "lead") {
        throw new TypeError("QR02 is missing its lead module.");
      }
      if (!evidenceModule || evidenceModule.type !== "evidence") {
        throw new TypeError("QR02 is missing its evidence module.");
      }
      leadModule.variant = "brief";
      evidenceModule.variant = "stack";
    });

    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: true,
      issues: [],
    });
  });

  it("accepts QR04 with the trusted feature lead variant", () => {
    const testCase = qualityCase("QR04");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "research") throw new TypeError("QR04 is not a research plan.");
      const leadModule = plan.modules.find((module) => module.type === "lead");
      if (!leadModule || leadModule.type !== "lead") {
        throw new TypeError("QR04 is missing its lead module.");
      }
      leadModule.variant = "feature";
    });

    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: true,
      issues: [],
    });
  });

  it("accepts QR06 with trusted feature lead and stacked evidence variants", () => {
    const testCase = qualityCase("QR06");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "research") throw new TypeError("QR06 is not a research plan.");
      const leadModule = plan.modules.find((module) => module.type === "lead");
      const evidenceModule = plan.modules.find((module) => module.type === "evidence");
      if (!leadModule || leadModule.type !== "lead") {
        throw new TypeError("QR06 is missing its lead module.");
      }
      if (!evidenceModule || evidenceModule.type !== "evidence") {
        throw new TypeError("QR06 is missing its evidence module.");
      }
      leadModule.variant = "feature";
      evidenceModule.variant = "stack";
    });

    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: true,
      issues: [],
    });
  });

  it("still requires for-against evidence when the prompt explicitly requests both sides", () => {
    const testCase = qualityCase("QR05");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "research") throw new TypeError("QR05 is not a research plan.");
      const evidenceModule = plan.modules.find((module) => module.type === "evidence");
      if (!evidenceModule || evidenceModule.type !== "evidence") {
        throw new TypeError("QR05 is missing its evidence module.");
      }
      evidenceModule.variant = "stack";
    });

    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: false,
      issues: [
        {
          code: "semantic_variant",
          component: "EvidenceList",
          actual: "stack",
          allowed: ["for-against"],
        },
      ],
    });
  });

  it("rejects QW03 when its required strip variant changes to chart", () => {
    const testCase = qualityCase("QW03");
    const candidate = compiledRecordedCandidate(testCase, (plan) => {
      if (plan.kind !== "weather") throw new TypeError("QW03 is not a weather plan.");
      const hourlyModule = plan.modules.find((module) => module.type === "hourly");
      if (!hourlyModule || hourlyModule.type !== "hourly") {
        throw new TypeError("QW03 is missing its hourly module.");
      }
      hourlyModule.variant = "chart";
    });

    expect(evaluateUiQualityStructuralConformance(candidate)).toEqual({
      success: false,
      issues: [
        {
          code: "semantic_variant",
          component: "HourlyForecast",
          actual: "chart",
          allowed: ["strip"],
        },
      ],
    });
  });

  it("rejects a reachable tree that violates the required component order", () => {
    const candidate = structuredClone(buildRecordedUiQualityCandidate(qualityCase("QW03")));
    const frame = component(candidate.spec, "SurfaceFrame");
    frame.children = [...(frame.children as string[])].reverse();

    const result = evaluateUiQualityStructuralConformance(candidate);

    expect(result.success).toBe(false);
    expect(result.issues).toContainEqual({
      code: "ordered_components",
      expected: ["WeatherHero", "RecommendationBand", "HourlyForecast", "SourceList"],
      actual: [
        "SurfaceFrame",
        "SourceList",
        "HourlyForecast",
        "RecommendationBand",
        "WeatherHero",
      ],
    });
  });

  it("changes the structural fingerprint when an hourly semantic variant changes", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QW03"));
    const changed = {
      ...candidate,
      spec: {
        ...candidate.spec,
        components: candidate.spec.components.map((node) =>
          node.component === "HourlyForecast"
            ? { ...node, variant: "chart" as const }
            : node,
        ),
      },
    };

    expect(component(candidate.spec, "HourlyForecast").variant).toBe("strip");
    expect(uiQualityStructuralFingerprint(changed)).not.toBe(
      uiQualityStructuralFingerprint(candidate),
    );
  });

  it("encodes reachable child order instead of only the flat component list", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QW03"));
    const reordered = {
      ...candidate,
      spec: {
        ...candidate.spec,
        components: candidate.spec.components.map((node) =>
          node.component === "SurfaceFrame"
            ? { ...node, children: [...node.children].reverse() }
            : node,
        ),
      },
    };

    expect(reordered.spec.components.map((node) => node.component)).toEqual(
      candidate.spec.components.map((node) => node.component),
    );
    expect(uiQualityStructuralFingerprint(reordered)).not.toBe(
      uiQualityStructuralFingerprint(candidate),
    );
  });

  it("does not fingerprint generated copy or weather measurements", () => {
    const candidate = buildRecordedUiQualityCandidate(qualityCase("QW03"));
    const contentChanged = {
      ...candidate,
      spec: {
        ...candidate.spec,
        components: candidate.spec.components.map((node) => {
          if (node.component === "WeatherHero") {
            return {
              ...node,
              temperature: node.temperature + 20,
              recommendationDetail: "Different generated copy.",
            };
          }
          return node;
        }),
      },
    };

    expect(uiQualityStructuralFingerprint(contentChanged)).toBe(
      uiQualityStructuralFingerprint(candidate),
    );
  });
});
