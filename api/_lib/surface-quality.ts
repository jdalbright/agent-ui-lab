import type { SourceRecord } from "../../shared/schemas.js";

export const SURFACE_QUALITY_CHECKS = [
  "recipe_fit",
  "answer_first",
  "sources_last",
  "requested_coverage",
  "duplicate_primary",
  "chart_table_alignment",
  "citation_coverage",
  "content_budget",
] as const;

export type SurfaceQualityCheck = (typeof SURFACE_QUALITY_CHECKS)[number];

export interface SurfaceQualityBenchmark {
  readonly id: string;
  readonly recipeId: string;
  readonly expected: {
    readonly allowedRecipes: readonly [string, ...string[]];
    readonly density: string;
    readonly emphasis: string;
    readonly requiredComponents: readonly string[];
    readonly orderedComponents: readonly string[];
    readonly requiredFacts: readonly {
      readonly concept: string;
      readonly anyOf: readonly [string, ...string[]];
    }[];
    readonly requiredSourceIds: readonly string[];
    readonly contentBudget: {
      readonly maxComponents: number;
      readonly maxProseCharacters: number;
      readonly maxLeadCharacters: number;
    };
  };
}

export interface LooseSurfaceSpec {
  readonly kind: string;
  readonly rootId: string;
  readonly components: readonly Record<string, unknown>[];
}

export interface SurfaceQualityLintInput {
  readonly benchmark: SurfaceQualityBenchmark;
  readonly plan: Readonly<Record<string, unknown>>;
  readonly spec: LooseSurfaceSpec;
  readonly sources: readonly SourceRecord[];
}

export interface SurfaceQualityLintIssue {
  readonly code: SurfaceQualityCheck;
  readonly message: string;
}

export interface SurfaceQualityLintResult {
  readonly success: boolean;
  readonly checks: Readonly<Record<SurfaceQualityCheck, boolean>>;
  readonly issues: readonly SurfaceQualityLintIssue[];
}

const LAYOUT_COMPONENTS = new Set([
  "SurfaceFrame",
  "Band",
  "Split",
  "Rail",
  "Divider",
]);

const PRIMARY_COMPONENTS = new Set([
  "WeatherHero",
  "ComparisonSummary",
  "ResearchLead",
]);

const STRUCTURAL_TEXT_KEYS = new Set([
  "id",
  "component",
  "children",
  "recipeId",
  "density",
  "emphasis",
  "sourceId",
  "sourceIds",
  "variant",
  "conditionKey",
  "stance",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function componentName(node: Record<string, unknown> | undefined): string | undefined {
  return typeof node?.component === "string" ? node.component : undefined;
}

function indexComponents(spec: LooseSurfaceSpec): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const node of spec.components) {
    if (typeof node.id === "string") byId.set(node.id, node);
  }
  return byId;
}

function readableNodes(spec: LooseSurfaceSpec): Record<string, unknown>[] {
  const byId = indexComponents(spec);
  const ordered: Record<string, unknown>[] = [];
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    const name = componentName(node);
    const children = stringArray(node.children);

    if (name && !LAYOUT_COMPONENTS.has(name)) ordered.push(node);
    for (const childId of children) visit(childId);
  };

  visit(spec.rootId);
  return ordered;
}

function allSurfaceText(spec: LooseSurfaceSpec): string {
  const strings: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (!STRUCTURAL_TEXT_KEYS.has(key)) collect(item);
    }
  };

  for (const node of spec.components) collect(node);
  return strings.join(" ").toLocaleLowerCase("en-US");
}

function proseCharacterCount(spec: LooseSurfaceSpec): number {
  let count = 0;
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      count += value.length;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (!STRUCTURAL_TEXT_KEYS.has(key)) collect(item);
    }
  };

  for (const node of spec.components) collect(node);
  return count;
}

function primaryLeadCharacterCount(spec: LooseSurfaceSpec): number {
  const primary = spec.components.find((node) => PRIMARY_COMPONENTS.has(componentName(node) ?? ""));
  if (!primary) return 0;
  const leadFields = ["title", "summary", "recommendation", "recommendationValue", "recommendationDetail"];
  return leadFields.reduce((total, field) => {
    const value = primary[field];
    return total + (typeof value === "string" ? value.length : 0);
  }, 0);
}

function domainForRecipe(recipeId: string): string | undefined {
  const separator = recipeId.indexOf(".");
  return separator > 0 ? recipeId.slice(0, separator) : undefined;
}

function compareChartAndTable(spec: LooseSurfaceSpec): string | undefined {
  const chart = spec.components.find((node) => componentName(node) === "ComparisonChart");
  const table = spec.components.find((node) => componentName(node) === "ComparisonTable");
  if (!chart) return undefined;
  if (!table) return "Comparison charts require an aligned table alternative.";

  const labels = stringArray(chart.labels);
  const columns = stringArray(table.columns);
  if (!Array.isArray(chart.series) || !Array.isArray(table.rows)) {
    return "Chart series or table rows are malformed.";
  }
  const chartSeries: readonly unknown[] = chart.series;
  const tableRows: readonly unknown[] = table.rows;
  const numericValue = (value: unknown): number =>
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.replace(/[^0-9+-.]/g, ""))
        : Number.NaN;
  const validSeries = chartSeries.every(
    (series) =>
      isRecord(series) &&
      typeof series.label === "string" &&
      Array.isArray(series.values) &&
      series.values.length === labels.length &&
      series.values.every((value) => typeof value === "number"),
  );
  if (!validSeries) return "Chart series values do not match the requested range.";

  const seriesRowsAligned =
    columns.length === labels.length + 1 &&
    labels.every((label, index) => label === columns[index + 1]) &&
    tableRows.length === chartSeries.length &&
    chartSeries.every((series, seriesIndex) => {
      if (!isRecord(series) || !Array.isArray(series.values)) return false;
      const row = tableRows[seriesIndex];
      return (
        Array.isArray(row) &&
        row[0] === series.label &&
        series.values.every(
          (value, valueIndex) => numericValue(row[valueIndex + 1]) === value,
        )
      );
    });
  if (seriesRowsAligned) return undefined;

  const periodRowsAligned =
    columns.length === chartSeries.length + 1 &&
    chartSeries.every(
      (series, index) => isRecord(series) && series.label === columns[index + 1],
    ) &&
    tableRows.length === labels.length &&
    labels.every((label, labelIndex) => {
      const row = tableRows[labelIndex];
      return (
        Array.isArray(row) &&
        row[0] === label &&
        chartSeries.every((series, seriesIndex) => {
          return (
            isRecord(series) &&
            Array.isArray(series.values) &&
            numericValue(row[seriesIndex + 1]) === series.values[labelIndex]
          );
        })
      );
    });
  return periodRowsAligned ? undefined : "Chart values do not match the table alternative.";
}

function collectCitationIds(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCitationIds(item, output);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.sourceId === "string") output.add(value.sourceId);
  for (const sourceId of stringArray(value.sourceIds)) output.add(sourceId);
  for (const [key, item] of Object.entries(value)) {
    if (key !== "sourceId" && key !== "sourceIds") collectCitationIds(item, output);
  }
}

function citationIssue(input: SurfaceQualityLintInput): string | undefined {
  const sourceIds = new Set(input.sources.map((source) => source.id));
  const sourceList = input.spec.components.find((node) => componentName(node) === "SourceList");
  const listedIds = new Set(stringArray(sourceList?.sourceIds));
  const citedIds = new Set<string>();
  collectCitationIds(input.spec.components, citedIds);

  for (const requiredId of input.benchmark.expected.requiredSourceIds) {
    if (!sourceIds.has(requiredId)) return `Required source ${requiredId} is missing from evidence.`;
    if (!listedIds.has(requiredId)) return `Required source ${requiredId} is missing from SourceList.`;
  }

  for (const citationId of citedIds) {
    if (!sourceIds.has(citationId)) return `Citation ${citationId} is not a server-issued source ID.`;
    if (!listedIds.has(citationId)) return `Citation ${citationId} is missing from SourceList.`;
  }

  if (input.spec.kind === "research") {
    const evidenceNodes = input.spec.components.filter((node) => {
      const name = componentName(node);
      return name === "EvidenceList" || name === "Timeline";
    });
    for (const node of evidenceNodes) {
      if (!Array.isArray(node.items)) return `${String(node.component)} items are missing citations.`;
      for (const item of node.items) {
        if (!isRecord(item) || typeof item.sourceId !== "string") {
          return `${String(node.component)} contains an item without a source ID.`;
        }
        if (!sourceIds.has(item.sourceId)) {
          return `${String(node.component)} cites unknown source ${item.sourceId}.`;
        }
        if (!listedIds.has(item.sourceId)) {
          return `${String(node.component)} citation ${item.sourceId} is not listed.`;
        }
      }
    }
  }

  return undefined;
}

export function lintSurfaceQuality(input: SurfaceQualityLintInput): SurfaceQualityLintResult {
  const issues: SurfaceQualityLintIssue[] = [];
  const addIssue = (code: SurfaceQualityCheck, message: string): void => {
    if (!issues.some((issue) => issue.code === code)) issues.push({ code, message });
  };

  const root = indexComponents(input.spec).get(input.spec.rootId);
  const planRecipe = typeof input.plan.recipeId === "string" ? input.plan.recipeId : "";
  const rootRecipe = typeof root?.recipeId === "string" ? root.recipeId : "";
  const planDensity = typeof input.plan.density === "string" ? input.plan.density : "";
  const planEmphasis = typeof input.plan.emphasis === "string" ? input.plan.emphasis : "";
  const planKind = typeof input.plan.kind === "string" ? input.plan.kind : "";
  const componentNames = new Set(input.spec.components.map(componentName).filter(Boolean));
  const recipeFits =
    input.benchmark.expected.allowedRecipes.includes(planRecipe) &&
    planRecipe === rootRecipe &&
    planDensity === input.benchmark.expected.density &&
    planEmphasis === input.benchmark.expected.emphasis &&
    planKind === input.spec.kind &&
    domainForRecipe(planRecipe) === input.spec.kind &&
    input.benchmark.expected.requiredComponents.every((name) => componentNames.has(name));
  if (!recipeFits) {
    addIssue(
      "recipe_fit",
      `Surface does not match the allowed recipe, density, emphasis, kind, or required modules for ${input.benchmark.id}.`,
    );
  }

  const readable = readableNodes(input.spec);
  const readableNames = readable.map(componentName);
  const expectedFirst = input.benchmark.expected.orderedComponents[0];
  let previousIndex = -1;
  const expectedOrderIsPreserved = input.benchmark.expected.orderedComponents.every((name) => {
    const nextIndex = readableNames.indexOf(name, previousIndex + 1);
    if (nextIndex < 0) return false;
    previousIndex = nextIndex;
    return true;
  });
  if (!expectedFirst || readableNames[0] !== expectedFirst || !expectedOrderIsPreserved) {
    addIssue("answer_first", `Expected ${expectedFirst ?? "a primary answer"} to be the first readable module.`);
  }

  const sourceIndexes = readableNames
    .map((name, index) => name === "SourceList" ? index : -1)
    .filter((index) => index >= 0);
  if (sourceIndexes.length !== 1 || sourceIndexes[0] !== readable.length - 1) {
    addIssue("sources_last", "SourceList must be the single final readable module.");
  }

  const searchable = allSurfaceText(input.spec);
  const missingFacts = input.benchmark.expected.requiredFacts.filter(
    (fact) => !fact.anyOf.some((alternative) => searchable.includes(alternative.toLocaleLowerCase("en-US"))),
  );
  if (missingFacts.length > 0) {
    addIssue(
      "requested_coverage",
      `Missing requested fact: ${missingFacts.map((fact) => fact.concept).join(", ")}.`,
    );
  }

  const primaryNames = readableNames.filter(
    (name): name is string => typeof name === "string" && PRIMARY_COMPONENTS.has(name),
  );
  if (primaryNames.length !== 1) {
    addIssue("duplicate_primary", "Surface must contain exactly one non-competing primary answer section.");
  }

  const alignmentIssue = compareChartAndTable(input.spec);
  if (alignmentIssue) addIssue("chart_table_alignment", alignmentIssue);

  const citations = citationIssue(input);
  if (citations) addIssue("citation_coverage", citations);

  const { contentBudget } = input.benchmark.expected;
  const componentCount = input.spec.components.length;
  const proseCount = proseCharacterCount(input.spec);
  const leadCount = primaryLeadCharacterCount(input.spec);
  if (
    componentCount > contentBudget.maxComponents ||
    proseCount > contentBudget.maxProseCharacters ||
    leadCount > contentBudget.maxLeadCharacters
  ) {
    addIssue(
      "content_budget",
      `Surface exceeds its content budget (${componentCount}/${contentBudget.maxComponents} components, ${proseCount}/${contentBudget.maxProseCharacters} prose characters, ${leadCount}/${contentBudget.maxLeadCharacters} lead characters).`,
    );
  }

  const checks = Object.fromEntries(
    SURFACE_QUALITY_CHECKS.map((check) => [check, !issues.some((issue) => issue.code === check)]),
  ) as Record<SurfaceQualityCheck, boolean>;

  return {
    success: issues.length === 0,
    checks,
    issues,
  };
}
