import type { SourceRecord } from "../../shared/schemas.js";
import {
  evaluateSurfaceContentBudget,
  isSurfaceStructuralTextKey,
  type SurfaceContentBudget,
} from "../../shared/surface-content-budget.js";
import { parseStrictFormattedNumber } from "../../shared/strict-numeric.js";

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

export interface SurfaceQualitySemanticAtomAlternative {
  readonly allOf: readonly [string, ...string[]];
}

export type SurfaceQualityFactMatcher =
  | {
      readonly kind: "recommended-comparison-item";
      readonly labelAnyOf: readonly [string, ...string[]];
      readonly detailAnyOf: readonly [string, ...string[]];
    }
  | {
      readonly kind: "semantic-atoms";
      readonly subjectAnyOf?: readonly [string, ...string[]];
      readonly excludedSubjectAnyOf?: readonly [string, ...string[]];
      readonly discourseTargetAnyOf?: readonly [string, ...string[]];
      readonly requiresCurrentAssertion?: boolean;
      readonly anyOf: readonly [
        SurfaceQualitySemanticAtomAlternative,
        ...SurfaceQualitySemanticAtomAlternative[],
      ];
    };

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
      readonly matcher?: SurfaceQualityFactMatcher;
    }[];
    readonly requiredSourceIds: readonly string[];
    readonly contentBudget: SurfaceContentBudget;
  };
}

export interface LooseSurfaceSpec {
  readonly kind: string;
  readonly rootId: string;
  readonly components: readonly Record<string, unknown>[];
}

export interface SurfaceQualityLintInput {
  readonly benchmark: SurfaceQualityBenchmark;
  readonly plan: Readonly<object>;
  readonly spec: LooseSurfaceSpec;
  readonly sources: readonly SourceRecord[];
  readonly mode?: "recipe-v2" | "grammar-v3";
}

export interface SurfaceQualityLintIssue {
  readonly code: SurfaceQualityCheck;
  readonly message: string;
}

export interface SurfaceQualityLintResult {
  readonly success: boolean;
  readonly checks: Readonly<Record<SurfaceQualityCheck, boolean>>;
  readonly issues: readonly SurfaceQualityLintIssue[];
  readonly missingFactConcepts?: readonly string[];
}

const LAYOUT_COMPONENTS = new Set([
  "SurfaceFrame",
  "Band",
  "Stack",
  "Grid",
  "Split",
  "Section",
  "Card",
  "Rail",
  "Tabs",
  "Disclosure",
  "Divider",
  "Accordion",
  "Scroller",
  "Columns",
  "Aside",
]);

const PRIMARY_COMPONENTS = new Set([
  "WeatherHero",
  "ComparisonSummary",
  "ResearchLead",
]);

const STRUCTURED_UNIT_COMPONENTS = new Set([
  "WeatherHero",
  "HourlyForecast",
  "DailyForecast",
  "ComparisonChart",
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

function textSegmentsFromValue(value: unknown): string[] {
  const strings: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      strings.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (!isSurfaceStructuralTextKey(key)) collect(item);
    }
  };

  collect(value);
  return strings.map(normalizedCoverageTerm).filter(Boolean);
}

function surfaceTextSegments(spec: LooseSurfaceSpec): string[] {
  return spec.components.flatMap(textSegmentsFromValue);
}

interface SemanticCoverageSegment {
  readonly text: string;
  readonly allowInheritedSubject: boolean;
  readonly localContext: readonly string[];
}

function semanticCoverageSegments(spec: LooseSurfaceSpec): SemanticCoverageSegment[] {
  const segments: SemanticCoverageSegment[] = [];
  for (const node of spec.components) {
    if (componentName(node) !== "EvidenceList" || !Array.isArray(node.items)) {
      for (const text of textSegmentsFromValue(node)) {
        segments.push({ text, allowInheritedSubject: false, localContext: [text] });
      }
      continue;
    }

    const sharedContext = textSegmentsFromValue(
      Object.fromEntries(Object.entries(node).filter(([key]) => key !== "items")),
    );
    for (const text of sharedContext) {
      segments.push({ text, allowInheritedSubject: false, localContext: sharedContext });
    }
    for (const item of node.items) {
      if (!isRecord(item)) continue;
      const localContext = [...sharedContext, ...textSegmentsFromValue(item)];
      for (const [key, value] of Object.entries(item)) {
        if (isSurfaceStructuralTextKey(key)) continue;
        for (const text of textSegmentsFromValue(value)) {
          segments.push({
            text,
            allowInheritedSubject: key === "finding",
            localContext,
          });
        }
      }
    }
  }
  return segments;
}

function surfaceTextValues(spec: LooseSurfaceSpec): string[] {
  const segments = surfaceTextSegments(spec);
  return segments.length > 1 ? [...segments, segments.join(" ")] : segments;
}

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "twenty-one",
  "twenty-two",
  "twenty-three",
  "twenty-four",
] as const;

function normalizedCoverageTerm(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function addUnitCoverageTerms(unit: unknown, output: Set<string>): void {
  if (typeof unit !== "string") return;
  const normalized = normalizedCoverageTerm(unit);
  if (["f", "°f", "fahrenheit"].includes(normalized)) {
    for (const alias of ["f", "°f", "fahrenheit", "degrees fahrenheit"]) {
      output.add(alias);
    }
  }
  if (["c", "°c", "celsius"].includes(normalized)) {
    for (const alias of ["c", "°c", "celsius", "degrees celsius"]) {
      output.add(alias);
    }
  }
}

function addCountCoverageTerms(
  count: number,
  rangeUnit: "day" | "hour" | "point",
  output: Set<string>,
): void {
  if (!Number.isInteger(count) || count < 1) return;
  const countWord = COUNT_WORDS[count];
  const pluralUnit = `${rangeUnit}s`;
  for (const prefix of [String(count), countWord].filter((value): value is string => Boolean(value))) {
    output.add(`${prefix}-${rangeUnit}`);
    output.add(`${prefix} ${rangeUnit}`);
    output.add(`${prefix} ${pluralUnit}`);
  }
}

function structuredCoverageTerms(spec: LooseSurfaceSpec): Set<string> {
  const terms = new Set<string>();
  const hasForecastPeriodTable = spec.components.some((node) =>
    componentName(node) === "ComparisonTable" &&
    Array.isArray(node.columns) &&
    normalizedCoverageTerm(String(node.columns[0] ?? "")) === "period"
  );
  for (const node of spec.components) {
    const name = componentName(node);
    if (name && STRUCTURED_UNIT_COMPONENTS.has(name)) {
      addUnitCoverageTerms(node.unit, terms);
    }
    if ((name === "DailyForecast" || name === "HourlyForecast") && Array.isArray(node.items)) {
      addCountCoverageTerms(node.items.length, name === "DailyForecast" ? "day" : "hour", terms);
    }
    if (name === "ComparisonChart" && Array.isArray(node.labels)) {
      addCountCoverageTerms(node.labels.length, "point", terms);
      const labels = node.labels.filter((label): label is string => typeof label === "string");
      const allDayLabels = labels.length === node.labels.length && labels.every((label) =>
        /^(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b|^\d{4}-\d{2}-\d{2}$/iu.test(label.trim())
      );
      const allHourLabels = labels.length === node.labels.length && labels.every((label) =>
        /(?:^|\s)\d{1,2}(?::\d{2})?\s*(?:am|pm)$/iu.test(label.trim())
      );
      if (hasForecastPeriodTable && (allDayLabels || !allHourLabels)) {
        addCountCoverageTerms(labels.length, "day", terms);
      }
      if (hasForecastPeriodTable && allHourLabels) {
        addCountCoverageTerms(labels.length, "hour", terms);
      }
    }
  }
  return terms;
}

type EvidenceStance = "support" | "challenge" | "neutral";

function structuredEvidenceStances(spec: LooseSurfaceSpec): Set<EvidenceStance> {
  const stances = new Set<EvidenceStance>();
  for (const node of spec.components) {
    if (componentName(node) !== "EvidenceList" || !Array.isArray(node.items)) continue;
    for (const item of node.items) {
      if (!isRecord(item)) continue;
      if (item.stance === "support" || item.stance === "challenge" || item.stance === "neutral") {
        stances.add(item.stance);
      }
    }
  }
  return stances;
}

function structuredRecommendedComparisonTerms(spec: LooseSurfaceSpec): readonly string[] {
  const terms: string[] = [];
  for (const node of spec.components) {
    if (componentName(node) !== "ComparisonSummary" || !Array.isArray(node.items)) continue;
    for (const item of node.items) {
      if (!isRecord(item) || item.recommended !== true) continue;
      const text = [item.label, item.value, item.detail]
        .filter((value): value is string => typeof value === "string")
        .join(" ");
      const normalized = normalizedCoverageTerm(text);
      if (normalized) terms.push(normalized);
    }
  }
  return terms;
}

function requiredEvidenceStance(concept: string): EvidenceStance | undefined {
  const normalized = normalizedCoverageTerm(concept);
  if (/\b(?:support|supporting)\b.*\bevidence\b/u.test(normalized)) return "support";
  if (/\b(?:challenge|challenging)\b.*\bevidence\b/u.test(normalized)) return "challenge";
  if (/\bneutral\b.*\bevidence\b/u.test(normalized)) return "neutral";
  return undefined;
}

function requiresStructuredRangeCount(
  fact: SurfaceQualityBenchmark["expected"]["requiredFacts"][number],
): boolean {
  if (!normalizedCoverageTerm(fact.concept).includes("range")) return false;
  return fact.anyOf.some((alternative) =>
    /^(?:(?:\d+)|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:-(?:one|two|three|four))?))[ -](?:day|hour|point)s?$/u.test(
      normalizedCoverageTerm(alternative),
    )
  );
}

function alternativeMatchIndexes(searchable: string, alternative: string): number[] {
  const normalized = normalizedCoverageTerm(alternative);
  if (!normalized) return [];
  const indexes: number[] = [];
  let fromIndex = 0;
  while (fromIndex <= searchable.length - normalized.length) {
    const index = searchable.indexOf(normalized, fromIndex);
    if (index < 0) break;
    const before = searchable[index - 1] ?? "";
    const after = searchable[index + normalized.length] ?? "";
    if (
      !/^[a-z]{1,3}$/.test(normalized) ||
      (!/[a-z]/u.test(before) && !/[a-z]/u.test(after))
    ) {
      indexes.push(index);
    }
    fromIndex = index + Math.max(normalized.length, 1);
  }
  return indexes;
}

function hasNonAffirmativePolarity(
  searchable: string,
  matchIndex: number,
  matchLength: number,
): boolean {
  const protectDecimalPoints = (value: string) => value.replace(/(\d)\.(?=\d)/gu, "$1·");
  const before = protectDecimalPoints(
    searchable.slice(Math.max(0, matchIndex - 80), matchIndex),
  );
  const after = protectDecimalPoints(
    searchable.slice(matchIndex + matchLength, matchIndex + matchLength + 80),
  );
  const matched = protectDecimalPoints(searchable.slice(matchIndex, matchIndex + matchLength));
  const negatedBefore =
    /(?:\b(?:does|do|did|is|are|was|were|will|would|can|could|should|has|have|had)\s+not\b|\b(?:doesn't|don't|didn't|isn't|aren't|wasn't|weren't|won't|wouldn't|can't|couldn't|shouldn't|hasn't|haven't|hadn't)\b|\bnever\b)[^.;!?]{0,48}$/u.test(
      before,
    ) || /\bnot\s+(?:(?:set|scheduled|expected)\s+)?(?:at|by|until|through)\s*$/u.test(before) ||
    /\bno\s+longer\b[^.;!?]{0,48}$/u.test(before) ||
    /\bno\s*$/u.test(before) ||
    /\bno\s+(?:evidence|sign|indication|proof)\s+(?:that|of|for)\b[^.;!?]{0,64}$/u.test(
      before,
    );
  const topicalBefore =
    /\b(?:discuss(?:es|ed|ing)?|mention(?:s|ed|ing)?|refer(?:s|red|ring)?\s+to|measur(?:e|es|ed|ing))\b[^.;!?]{0,64}$/u.test(
      before,
    );
  const historicalStatusBefore =
    /^(?:current|stable|production)$/u.test(matched) &&
    /\b(?:was|were)\b[^.;!?]{0,48}$/u.test(before);
  const uncertainBefore =
    /(?:\b(?:expiry|expiration|time|date|value|status)\s+(?:(?:is|remains)\s+)?(?:unknown|unclear|unconfirmed|undetermined)\b|\b(?:unknown|unclear|unconfirmed|undetermined)\s+(?:whether|if)\b|\bnot\s+(?:known|established|confirmed)\b|\b(?:cannot|can't|couldn't)\s+(?:determine|confirm)\b)[^.;!?]{0,64}$/u.test(
      before,
    ) || /\b(?:may|might|could|possibly|perhaps|allegedly)\b[^,;.!?]{0,48}$/u.test(before) ||
    /\b(?:asks?|asked|asking)\s+whether\b[^.;!?]{0,64}$/u.test(before) ||
    /\b(?:possible|plausible)\s+that\b[^.;!?]{0,64}$/u.test(before);
  const negatedAfter = /^[^.;!?]{0,40}\b(?:is|was|does|did)\s+not\b/u.test(after);
  const unknownAfter =
    /^[-\s,:;()]{0,12}(?:(?:is|are|was|were|remains?|seems?)\s+)?(?:unknown|unclear|unconfirmed|undetermined)\b/u.test(
      after,
    ) ||
    /^[^.!?]{0,64}\b(?:the\s+)?(?:expiry|expiration|time|date|value|status)\s+(?:(?:is|remains)\s+)?(?:unknown|unclear|unconfirmed|undetermined)\b/u.test(
      after,
    );
  const speculativeAfter =
    /^[-\s,:;()]{0,12}(?:may|might|could)\s+(?:arrive|appear|emerge|happen|become)\b/u.test(
      after,
    );
  const questionedAfter = /^[^?]{0,80}\?/u.test(after);
  return negatedBefore || topicalBefore || historicalStatusBefore || uncertainBefore ||
    negatedAfter || unknownAfter || speculativeAfter || questionedAfter;
}

function hasHistoricalAssertionPolarity(
  searchable: string,
  matchIndex: number,
  matchLength: number,
): boolean {
  const protectDecimalPoints = (value: string) => value.replace(/(\d)\.(?=\d)/gu, "$1·");
  const before = protectDecimalPoints(
    searchable.slice(Math.max(0, matchIndex - 80), matchIndex),
  );
  const after = protectDecimalPoints(
    searchable.slice(matchIndex + matchLength, matchIndex + matchLength + 80),
  );
  return /\b(?:was|were)\b[^.;!?]{0,48}$/u.test(before) ||
    /^[^.;!?]{0,64}\b(?:last year|previously|formerly|in the past|no longer)\b/u.test(after);
}

function surfaceContainsAffirmativeAlternative(
  searchableValues: readonly string[],
  alternative: string,
): boolean {
  const normalized = normalizedCoverageTerm(alternative);
  if (!normalized) return false;
  return searchableValues.some((searchable) =>
    alternativeMatchIndexes(searchable, normalized).some(
      (matchIndex) => !hasNonAffirmativePolarity(searchable, matchIndex, normalized.length),
    )
  );
}

function affirmativeSemanticAtomIndexes(
  searchable: string,
  atom: string,
  requiresCurrentAssertion = false,
): number[] {
  const normalized = normalizedCoverageTerm(atom);
  if (!normalized) return [];
  const startsWithWordCharacter = /^[a-z0-9]/u.test(normalized);
  const endsWithWordCharacter = /[a-z0-9]$/u.test(normalized);
  return alternativeMatchIndexes(searchable, normalized).filter((matchIndex) => {
    const before = searchable[matchIndex - 1] ?? "";
    const after = searchable[matchIndex + normalized.length] ?? "";
    const hasStartBoundary = !startsWithWordCharacter || !/[a-z0-9]/u.test(before);
    const hasEndBoundary = !endsWithWordCharacter || !/[a-z0-9]/u.test(after);
    return hasStartBoundary && hasEndBoundary &&
      !hasNonAffirmativePolarity(searchable, matchIndex, normalized.length) &&
      (!requiresCurrentAssertion ||
        !hasHistoricalAssertionPolarity(searchable, matchIndex, normalized.length));
  });
}

function affirmativeSemanticSubjectIndexes(searchable: string, subject: string): number[] {
  const normalized = normalizedCoverageTerm(subject);
  return affirmativeSemanticAtomIndexes(searchable, normalized).filter((matchIndex) => {
    const before = searchable.slice(Math.max(0, matchIndex - 40), matchIndex);
    if (
      /\b(?:unlike|versus|vs\.?|compared\s+(?:with|to))\s+(?:gemini\s+)?$/u.test(before)
    ) {
      return false;
    }
    const after = searchable.slice(matchIndex + normalized.length).trimStart();
    return !/^(?:notes?|documentation|docs?|report|page|article|announcement|blog|guide)\b/u.test(
      after,
    );
  });
}

function namedGeminiModelKeys(searchable: string): string[] {
  const keys: string[] = [];
  const pattern = /\bgemini\s+(\d+(?:\.\d+)+)(?:\s+(flash(?:-lite)?|pro|ultra|nano|lite))?\b/gu;
  for (const match of normalizedCoverageTerm(searchable).matchAll(pattern)) {
    const version = match[1];
    if (!version) continue;
    keys.push(match[2] ? `${version} ${match[2]}` : version);
  }
  return keys;
}

function hasConflictingDiscourseTarget(
  searchableValues: readonly string[],
  matcher: Extract<SurfaceQualityFactMatcher, { readonly kind: "semantic-atoms" }>,
): boolean {
  const targets = matcher.discourseTargetAnyOf;
  if (!targets) return false;
  const allowedNamedModels = new Set(targets.flatMap(namedGeminiModelKeys));
  return searchableValues.some((searchable) =>
    matcher.excludedSubjectAnyOf?.some(
      (subject) => alternativeMatchIndexes(searchable, normalizedCoverageTerm(subject)).length > 0,
    ) === true || namedGeminiModelKeys(searchable).some((key) => !allowedNamedModels.has(key))
  );
}

function researchLeadEstablishesDiscourseTarget(
  spec: LooseSurfaceSpec,
  matcher: Extract<SurfaceQualityFactMatcher, { readonly kind: "semantic-atoms" }>,
): boolean {
  const targets = matcher.discourseTargetAnyOf;
  if (!targets) return false;
  const lead = spec.components.find((node) => componentName(node) === "ResearchLead");
  if (!lead) return false;
  const leadSegments = textSegmentsFromValue(lead);
  return !hasConflictingDiscourseTarget(leadSegments, matcher) && targets.some((target) =>
    leadSegments.some((segment) => affirmativeSemanticSubjectIndexes(segment, target).length > 0)
  );
}

function immediateClaimRetractionIndex(searchable: string): number | undefined {
  const match = /(?:\bbut\s+that\s+claim\s+(?:is|remains?)\s+(?:unconfirmed|unsupported|unclear|unknown)\b|\bhowever\b[^.;!?]{0,32}\bthe\s+evidence\s+(?:does|did)\s+not\s+support\s+that\s+claim\b)/u.exec(
    searchable,
  );
  return match?.index;
}

function semanticAtomsMatchSurface(
  searchableSegments: readonly SemanticCoverageSegment[],
  matcher: Extract<SurfaceQualityFactMatcher, { readonly kind: "semantic-atoms" }>,
  discourseTargetEstablished: boolean,
): boolean {
  const assertionClauses = searchableSegments.flatMap((coverageSegment) => {
    const segment = coverageSegment.text;
    const sentences: Array<{ readonly text: string; readonly start: number }> = [];
    let start = 0;
    for (let index = 0; index < segment.length; index += 1) {
      const character = segment[index];
      const isDecimalPoint = character === "." && /\d/u.test(segment[index - 1] ?? "") &&
        /\d/u.test(segment[index + 1] ?? "");
      if (!isDecimalPoint && character !== undefined && ".!?;".includes(character)) {
        sentences.push({ text: segment.slice(start, index + 1), start });
        start = index + 1;
      }
    }
    sentences.push({ text: segment.slice(start), start });
    const clauses = sentences.flatMap((sentence) => {
      const splitPattern = /\b(?:but|whereas|however)\b/giu;
      const clauses: Array<{ readonly text: string; readonly start: number }> = [];
      let clauseStart = 0;
      for (const match of sentence.text.matchAll(splitPattern)) {
        const matchIndex = match.index;
        const text = sentence.text.slice(clauseStart, matchIndex).trim();
        if (text) clauses.push({ text, start: sentence.start + clauseStart });
        clauseStart = matchIndex + match[0].length;
      }
      const text = sentence.text.slice(clauseStart).trim();
      if (text) clauses.push({ text, start: sentence.start + clauseStart });
      return clauses;
    });
    const retractionIndex = immediateClaimRetractionIndex(segment);
    let retractedClauseIndex = -1;
    if (retractionIndex !== undefined) {
      for (let index = clauses.length - 1; index >= 0; index -= 1) {
        const clause = clauses[index];
        if (clause && clause.start < retractionIndex) {
          retractedClauseIndex = index;
          break;
        }
      }
    }
    return clauses.map((clause, index) => ({
      ...coverageSegment,
      text: clause.text,
      retracted: index === retractedClauseIndex,
    }));
  });
  return matcher.anyOf.some((alternative) =>
    assertionClauses.some((segment) => {
      if (segment.retracted || hasConflictingDiscourseTarget([segment.text], matcher)) return false;
      const indexesByAtom = alternative.allOf.map((atom) =>
        affirmativeSemanticAtomIndexes(segment.text, atom, matcher.requiresCurrentAssertion)
      );
      if (indexesByAtom.some((indexes) => indexes.length === 0)) return false;
      const subjectMatches = matcher.subjectAnyOf?.flatMap((subject) =>
        affirmativeSemanticSubjectIndexes(segment.text, subject).map((index) => ({
          index,
          generic: /^(?:the|this)\s+(?:model|release)$/u.test(normalizedCoverageTerm(subject)),
        }))
      ) ?? [];
      const excludedSubjectIndexes = matcher.excludedSubjectAnyOf?.flatMap((subject) => {
        const normalized = normalizedCoverageTerm(subject);
        return alternativeMatchIndexes(segment.text, normalized);
      }) ?? [];
      const canInheritSubject = segment.allowInheritedSubject &&
        discourseTargetEstablished &&
        !hasConflictingDiscourseTarget(segment.localContext, matcher);
      const windowStarts = indexesByAtom.flat();
      return windowStarts.some((windowStart) =>
        indexesByAtom.every((indexes) =>
          indexes.some((index) => index >= windowStart && index <= windowStart + 64)
        ) &&
        (!matcher.subjectAnyOf || canInheritSubject || subjectMatches.some((subjectMatch) =>
          subjectMatch.index <= windowStart &&
          windowStart - subjectMatch.index <= 160 &&
          !excludedSubjectIndexes.some(
            (excludedIndex) =>
              (excludedIndex > subjectMatch.index && excludedIndex <= windowStart + 64) ||
              (subjectMatch.generic &&
                excludedIndex >= subjectMatch.index - 64 &&
                excludedIndex < subjectMatch.index),
          )
        ))
      );
    })
  );
}

function recommendedComparisonItemMatches(
  spec: LooseSurfaceSpec,
  matcher: Extract<
    SurfaceQualityFactMatcher,
    { readonly kind: "recommended-comparison-item" }
  >,
): boolean {
  const recommendedItems: Record<string, unknown>[] = [];
  for (const node of spec.components) {
    if (componentName(node) !== "ComparisonSummary" || !Array.isArray(node.items)) continue;
    for (const item of node.items) {
      if (isRecord(item) && item.recommended === true) recommendedItems.push(item);
    }
  }
  if (recommendedItems.length !== 1) return false;

  const recommendedItem = recommendedItems[0];
  const expectedLabels = new Set(matcher.labelAnyOf.map(normalizedCoverageTerm));
  if (
    typeof recommendedItem.label !== "string" ||
    !expectedLabels.has(normalizedCoverageTerm(recommendedItem.label))
  ) {
    return false;
  }

  const detail = [recommendedItem.value, recommendedItem.detail]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const searchableDetail = normalizedCoverageTerm(detail);
  const matchesRecommendedItem = matcher.detailAnyOf.some((alternative) =>
    surfaceContainsAffirmativeAlternative([searchableDetail], alternative)
  );
  if (matchesRecommendedItem) return true;
  if (
    /\b\d{1,3}(?:\.\d+)?\s*(?:×|x|by)\s*\d{1,3}(?:\.\d+)?\s*(?:×|x|by)\s*\d{1,3}(?:\.\d+)?\b/iu.test(
      searchableDetail,
    )
  ) {
    return false;
  }

  return spec.components.some((node) => {
    if (componentName(node) !== "ComparisonTable" || !Array.isArray(node.rows)) return false;
    return node.rows.some((row) => {
      if (!Array.isArray(row)) return false;
      const cells = row.filter((value): value is string => typeof value === "string");
      const bindsExpectedOption = cells.some(
        (cell) => expectedLabels.has(normalizedCoverageTerm(cell)),
      );
      if (!bindsExpectedOption) return false;
      const searchableRow = normalizedCoverageTerm(cells.join(" "));
      return matcher.detailAnyOf.some((alternative) =>
        surfaceContainsAffirmativeAlternative([searchableRow], alternative)
      );
    });
  });
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
  const numericValue = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value)
      ? value
      : parseStrictFormattedNumber(value);
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
  const plan = input.plan as Readonly<Record<string, unknown>>;
  const grammarMode = input.mode === "grammar-v3";
  const planRecipe = typeof plan.recipeId === "string" ? plan.recipeId : "";
  const rootRecipe = typeof root?.recipeId === "string" ? root.recipeId : "";
  const planDensity = typeof plan.density === "string" ? plan.density : "";
  const planEmphasis = typeof plan.emphasis === "string" ? plan.emphasis : "";
  const planKind = typeof plan.kind === "string" ? plan.kind : "";
  const componentNames = new Set(input.spec.components.map(componentName).filter(Boolean));
  const recipeMismatches: string[] = [];
  if (grammarMode) {
    if (plan.version !== "v3") recipeMismatches.push("grammar version");
    if (root?.compositionMode !== "grammar-v3") recipeMismatches.push("frame composition mode");
    if (planKind !== input.spec.kind) recipeMismatches.push("surface kind");
  } else {
    if (!input.benchmark.expected.allowedRecipes.includes(planRecipe)) {
      recipeMismatches.push("allowed recipe");
    }
    if (planRecipe !== rootRecipe) recipeMismatches.push("frame recipe");
    if (planDensity !== input.benchmark.expected.density) recipeMismatches.push("density");
    if (planEmphasis !== input.benchmark.expected.emphasis) recipeMismatches.push("emphasis");
    if (planKind !== input.spec.kind) recipeMismatches.push("surface kind");
    if (domainForRecipe(planRecipe) !== input.spec.kind) recipeMismatches.push("recipe domain");
  }
  const expectedPrimaryVariant = planRecipe === "weather.decision"
    ? "decision"
    : planRecipe === "weather.snapshot" || planRecipe === "weather.outlook"
      ? "snapshot"
      : planRecipe === "comparison.verdict"
        ? "verdict"
        : planRecipe === "comparison.scorecard" || planRecipe === "comparison.trend"
          ? "balanced"
          : undefined;
  const primaryComponent = input.spec.components.find((node) =>
    PRIMARY_COMPONENTS.has(componentName(node) ?? "")
  );
  if (!grammarMode && expectedPrimaryVariant && primaryComponent?.variant !== expectedPrimaryVariant) {
    recipeMismatches.push("primary variant");
  }
  const missingRequiredComponents = input.benchmark.expected.requiredComponents.filter(
    (name) => !componentNames.has(name),
  );
  if (!grammarMode && missingRequiredComponents.length > 0) {
    recipeMismatches.push(`required modules (${missingRequiredComponents.join(", ")})`);
  }
  if (recipeMismatches.length > 0) {
    addIssue("recipe_fit", `Recipe fit mismatch: ${recipeMismatches.join(", ")}.`);
  }

  const readable = readableNodes(input.spec);
  const readableNames = readable.map(componentName);
  const expectedFirst = grammarMode
    ? input.spec.kind === "weather"
      ? "WeatherHero"
      : input.spec.kind === "comparison"
        ? "ComparisonSummary"
        : input.spec.kind === "research"
          ? "ResearchLead"
          : undefined
    : input.benchmark.expected.orderedComponents[0];
  let previousIndex = -1;
  const expectedOrderIsPreserved = grammarMode || input.benchmark.expected.orderedComponents.every(
    (name) => {
      const nextIndex = readableNames.indexOf(name, previousIndex + 1);
      if (nextIndex < 0) return false;
      previousIndex = nextIndex;
      return true;
    },
  );
  if (!expectedFirst || readableNames[0] !== expectedFirst || !expectedOrderIsPreserved) {
    addIssue("answer_first", `Expected ${expectedFirst ?? "a primary answer"} to be the first readable module.`);
  }

  const sourceIndexes = readableNames
    .map((name, index) => name === "SourceList" ? index : -1)
    .filter((index) => index >= 0);
  if (sourceIndexes.length !== 1 || sourceIndexes[0] !== readable.length - 1) {
    addIssue("sources_last", "SourceList must be the single final readable module.");
  }

  const semanticSegments = semanticCoverageSegments(input.spec);
  const searchableValues = surfaceTextValues(input.spec);
  const structuredTerms = structuredCoverageTerms(input.spec);
  const structuredStances = structuredEvidenceStances(input.spec);
  const structuredDecisions = structuredRecommendedComparisonTerms(input.spec);
  const missingFacts = input.benchmark.expected.requiredFacts.filter(
    (fact) => {
      if (fact.matcher?.kind === "recommended-comparison-item") {
        return !recommendedComparisonItemMatches(input.spec, fact.matcher);
      }
      if (fact.matcher?.kind === "semantic-atoms") {
        return !semanticAtomsMatchSurface(
          semanticSegments,
          fact.matcher,
          researchLeadEstablishesDiscourseTarget(input.spec, fact.matcher),
        );
      }
      const requiredStance = requiredEvidenceStance(fact.concept);
      if (requiredStance) return !structuredStances.has(requiredStance);
      if (normalizedCoverageTerm(fact.concept) === "decision") {
        return !fact.anyOf.some((alternative) => {
          const normalized = normalizedCoverageTerm(alternative);
          return structuredDecisions.some((decision) => decision.includes(normalized));
        });
      }
      const requireStructuredCount = requiresStructuredRangeCount(fact);
      return !fact.anyOf.some((alternative) => {
        const normalized = normalizedCoverageTerm(alternative);
        return structuredTerms.has(normalized) ||
          (!requireStructuredCount && surfaceContainsAffirmativeAlternative(searchableValues, normalized));
      });
    },
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
  const budgetResult = evaluateSurfaceContentBudget(input.spec, contentBudget);
  const { componentCount, proseCharacters, leadCharacters } = budgetResult.measurements;
  const grammarContentNodes = Array.isArray(plan.content) ? plan.content.length : 0;
  const contentBudgetPassed = grammarMode
    ? grammarContentNodes > 0 &&
      grammarContentNodes <= contentBudget.maxComponents &&
      proseCharacters <= contentBudget.maxProseCharacters &&
      leadCharacters <= contentBudget.maxLeadCharacters
    : budgetResult.passed;
  if (!contentBudgetPassed) {
    addIssue(
      "content_budget",
      `Surface exceeds its content budget (${grammarMode ? grammarContentNodes : componentCount}/${contentBudget.maxComponents} content nodes, ${proseCharacters}/${contentBudget.maxProseCharacters} prose characters, ${leadCharacters}/${contentBudget.maxLeadCharacters} lead characters).`,
    );
  }

  const checks = Object.fromEntries(
    SURFACE_QUALITY_CHECKS.map((check) => [check, !issues.some((issue) => issue.code === check)]),
  ) as Record<SurfaceQualityCheck, boolean>;

  return {
    success: issues.length === 0,
    checks,
    issues,
    ...(missingFacts.length > 0
      ? { missingFactConcepts: missingFacts.slice(0, 8).map((fact) => fact.concept.slice(0, 64)) }
      : {}),
  };
}
