import type { SourceRecord } from "../../shared/schemas.js";
import { SURFACE_CONTENT_BUDGETS } from "../../shared/surface-content-budget.js";
import type { SearchEvidenceProjection } from "./gemini.js";
import { SurfacePlanSchema, type SurfacePlan } from "./surface-plan.js";

const MAX_SUBJECT_CHARACTERS = 72;
const MAX_EVIDENCE_ITEMS = 2;
const MAX_FINDING_CHARACTERS = 700;
const MAX_CHANGE_ENTRIES = 8;
const MANIFEST_LEAD_SUMMARY = "A concise source-derived digest of the requested changes.";
const MANIFEST_EVIDENCE_LABEL = "Documented changes";
const MANIFEST_SOURCE_LABEL = "Sources";

const unsafePlanTextPattern =
  /(?:https?:\/\/|www\.|javascript\s*:|data\s*:|<\/?[a-z][^>]*>|\bon(?:click|error|load)\s*=)/iu;
const reportingPrefixPattern =
  /\b(?:asks?|asked|whether|discusses?|discussed|mentions?|mentioned|measures?|measured|tests?|tested|allegedly|possibly|possible|might|may|could|does\s+not\s+show|do\s+not\s+show|fails?\s+to\s+show|is\s+false\s+that|no\s+evidence\s+that|remains?\s+unconfirmed\s+that)\b/iu;
const retractedOrHistoricalPattern =
  /\b(?:last year|previously|formerly|used to|but no longer|but\b[^.!?;]*(?:unconfirmed|unsupported|false|unknown|not confirmed)|however\b[^.!?;]*(?:does not|did not|no longer|unconfirmed|unsupported|false|unknown))\b/iu;
const directionalStartSource = [
  "is\\s+(?:now\\s+)?(?:generally\\s+available|production[- ]ready|stable|deprecated|unsupported|unavailable)",
  "are\\s+(?:now\\s+)?(?:generally\\s+available|production[- ]ready|stable|deprecated|unsupported|unavailable)",
  "(?:now\\s+)?(?:adds?|added|introduces?|introduced|removes?|removed|replaces?|replaced|deprecates?|deprecated|stops?|stopped|improves?|improved|reduces?|reduced|increases?|increased|decreases?|decreased|completes?|completed|uses?|used|needs?|needed|requires?|required|supports?|supported|enables?|enabled|ships?|shipped|moves?|moved|switches?|switched)\\b",
  "no\\s+longer\\b",
].join("|");
const directionalStartPattern = new RegExp(`^(?:${directionalStartSource})`, "iu");
const coordinatedChangePattern = new RegExp(
  `\\s*,?\\s+and\\s+(?=(?:${directionalStartSource}))`,
  "giu",
);

export interface ResearchChangeManifestEntry {
  readonly id: `change_${number}`;
  readonly sourceId: string;
  readonly coverageText: string;
}

export interface ResearchChangeRenderUnit {
  readonly sourceId: string;
  readonly entryIds: readonly ResearchChangeManifestEntry["id"][];
  readonly title: string;
  readonly finding: string;
}

export interface ResearchChangeManifest {
  readonly version: "research-change-v1";
  readonly subject: string;
  readonly leadSummary: string;
  readonly evidenceLabel: string;
  readonly sourceLabel: string;
  readonly entries: readonly ResearchChangeManifestEntry[];
  readonly renderUnits: readonly ResearchChangeRenderUnit[];
  readonly requiredSourceIds: readonly string[];
}

export type ResearchChangeManifestUnavailableReason =
  | "missing-subject"
  | "missing-provenance"
  | "incomplete-provenance"
  | "unknown-source"
  | "unsafe-text"
  | "unscoped-change"
  | "no-changes"
  | "change-capacity"
  | "source-capacity"
  | "content-capacity";

export type ResearchChangeManifestBuildResult =
  | { readonly status: "ready"; readonly manifest: ResearchChangeManifest }
  | { readonly status: "unavailable"; readonly reason: ResearchChangeManifestUnavailableReason };

export interface BuildResearchChangeManifestInput {
  readonly prompt: string;
  readonly sources: readonly SourceRecord[];
  readonly searchEvidence?: SearchEvidenceProjection;
}

function normalizedComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[‐‑‒–—−-]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function extractRequestedSubject(prompt: string): string | undefined {
  const request = prompt.split(/[?!]/u, 1)[0]?.trim() ?? "";
  const match = request.match(
    /\bwhat(?:(?:['’]s)|\s+(?:is|has))?\s+(?:changed|new|different)\s+(?:(?:in|with|about|for)\s+)?(.+)$/iu,
  );
  const subject = match?.[1]
    ?.replace(/\s+(?:using|from)\s+only\b[^.?!]*\bsources?\b.*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!subject || subject.length > MAX_SUBJECT_CHARACTERS || unsafePlanTextPattern.test(subject)) {
    return undefined;
  }
  return subject;
}

function splitSentences(text: string): readonly string[] {
  return text
    .replace(/\s+/gu, " ")
    .trim()
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function literalSubjectIndexes(text: string, subject: string): readonly number[] {
  const escapedSubject = subject.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])(${escapedSubject})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  return [...text.matchAll(pattern)].map(
    (match) => (match.index ?? 0) + (match[1]?.length ?? 0),
  );
}

function exactTargetScopedPredicates(text: string, subject: string): readonly string[] {
  const subjectComparable = normalizedComparableText(subject);
  if (!subjectComparable) return [];
  const results: string[] = [];

  for (const sentence of splitSentences(text)) {
    if (sentence.endsWith("?")) continue;
    if (retractedOrHistoricalPattern.test(sentence)) continue;
    // Use the literal target occurrence for slicing so a comparative baseline
    // cannot be mistaken for the requested/current subject.
    const subjectIndexes = literalSubjectIndexes(sentence, subject);
    const literalIndex = subjectIndexes.at(-1);
    if (literalIndex === undefined) continue;
    const prefix = sentence.slice(0, literalIndex);
    const allowedPrefix =
      prefix.trim().length === 0 ||
      /^\s*compared\s+with\s+[^,]{1,100},\s*$/iu.test(prefix);
    if (!allowedPrefix) continue;
    if (reportingPrefixPattern.test(prefix)) continue;

    const tail = sentence
      .slice(literalIndex + subject.length)
      .replace(/^\s*[,;:]?\s*/u, "")
      .replace(/[.!?]+$/u, "")
      .trim();
    if (!directionalStartPattern.test(tail)) continue;

    const predicates = tail
      .split(coordinatedChangePattern)
      .map((predicate) => predicate.replace(/[.!?]+$/u, "").trim())
      .filter((predicate) => directionalStartPattern.test(predicate));
    results.push(...predicates);
  }

  return results;
}

function hasUnscopedDirectionalChange(text: string, subject: string): boolean {
  return splitSentences(text).some((sentence) => {
    const occurrenceCount = literalSubjectIndexes(sentence, subject).length;
    return (
      occurrenceCount !== 1 ||
      exactTargetScopedPredicates(sentence, subject).length === 0
    );
  });
}

function renderFinding(subject: string, entries: readonly ResearchChangeManifestEntry[]): string {
  return `${subject} ${entries.map((entry) => entry.coverageText).join("; ")}`;
}

export function buildResearchChangeManifest({
  prompt,
  sources,
  searchEvidence,
}: BuildResearchChangeManifestInput): ResearchChangeManifestBuildResult {
  const subject = extractRequestedSubject(prompt);
  if (!subject) return { status: "unavailable", reason: "missing-subject" };
  if (!searchEvidence) {
    return { status: "unavailable", reason: "missing-provenance" };
  }
  if (searchEvidence.status !== "complete") {
    return { status: "unavailable", reason: "incomplete-provenance" };
  }
  if (searchEvidence.spans.length === 0) {
    return { status: "unavailable", reason: "missing-provenance" };
  }

  const issuedSourceIds = new Set(sources.map((source) => source.id));
  const entries: ResearchChangeManifestEntry[] = [];
  const uniqueEntries = new Set<string>();
  for (const span of searchEvidence.spans) {
    if (!issuedSourceIds.has(span.sourceId)) {
      return { status: "unavailable", reason: "unknown-source" };
    }
    if (unsafePlanTextPattern.test(span.text)) {
      return { status: "unavailable", reason: "unsafe-text" };
    }
    if (hasUnscopedDirectionalChange(span.text, subject)) {
      return { status: "unavailable", reason: "unscoped-change" };
    }
    for (const coverageText of exactTargetScopedPredicates(span.text, subject)) {
      const key = `${span.sourceId}\u0000${coverageText}`;
      if (uniqueEntries.has(key)) continue;
      uniqueEntries.add(key);
      if (entries.length >= MAX_CHANGE_ENTRIES) {
        return { status: "unavailable", reason: "change-capacity" };
      }
      entries.push(
        Object.freeze({
          id: `change_${entries.length + 1}` as const,
          sourceId: span.sourceId,
          coverageText,
        }),
      );
    }
  }
  if (entries.length === 0) return { status: "unavailable", reason: "no-changes" };

  const entriesBySource = new Map<string, ResearchChangeManifestEntry[]>();
  for (const entry of entries) {
    const grouped = entriesBySource.get(entry.sourceId) ?? [];
    grouped.push(entry);
    entriesBySource.set(entry.sourceId, grouped);
  }
  if (entriesBySource.size > MAX_EVIDENCE_ITEMS) {
    return { status: "unavailable", reason: "source-capacity" };
  }

  const renderUnits: ResearchChangeRenderUnit[] = [];
  for (const [sourceId, groupedEntries] of entriesBySource) {
    const finding = renderFinding(subject, groupedEntries);
    if (finding.length > MAX_FINDING_CHARACTERS) {
      return { status: "unavailable", reason: "content-capacity" };
    }
    renderUnits.push(
      Object.freeze({
        sourceId,
        entryIds: Object.freeze(groupedEntries.map((entry) => entry.id)),
        title: `Source change ${renderUnits.length + 1}`,
        finding,
      }),
    );
  }

  const proseCharacters =
    subject.length +
    MANIFEST_LEAD_SUMMARY.length +
    MANIFEST_EVIDENCE_LABEL.length +
    MANIFEST_SOURCE_LABEL.length +
    renderUnits.reduce(
      (total, unit) => total + unit.title.length + unit.finding.length,
      0,
    );
  if (proseCharacters > SURFACE_CONTENT_BUDGETS.brief.maxProseCharacters) {
    return { status: "unavailable", reason: "content-capacity" };
  }

  const requiredSourceIds = Object.freeze(renderUnits.map((unit) => unit.sourceId));
  return {
    status: "ready",
    manifest: Object.freeze({
      version: "research-change-v1",
      subject,
      leadSummary: MANIFEST_LEAD_SUMMARY,
      evidenceLabel: MANIFEST_EVIDENCE_LABEL,
      sourceLabel: MANIFEST_SOURCE_LABEL,
      entries: Object.freeze([...entries]),
      renderUnits: Object.freeze(renderUnits),
      requiredSourceIds,
    }),
  };
}

export function researchChangeCoverageIssues(
  plan: SurfacePlan,
  manifest: ResearchChangeManifest,
): readonly string[] {
  const evidence = plan.modules.find((module) => module.type === "evidence");
  const findings = evidence?.type === "evidence" ? evidence.items : [];
  const issues: string[] = [];
  const lead = plan.modules.find((module) => module.type === "lead");
  const exactLeadSubject =
    lead?.type === "lead" &&
    lead.title === manifest.subject;
  if (!exactLeadSubject) {
    issues.push("Resolved change coverage lead must equal the requested subject.");
  }
  const sameIds = (actual: readonly string[] | undefined): boolean =>
    actual?.length === manifest.requiredSourceIds.length &&
    actual.every((sourceId, index) => sourceId === manifest.requiredSourceIds[index]);
  if (lead?.type !== "lead" || !sameIds(lead.sourceIds)) {
    issues.push("Resolved change coverage lead sources do not match the manifest.");
  }
  const sourceModule = plan.modules.find((module) => module.type === "sources");
  if (sourceModule?.type !== "sources" || !sameIds(sourceModule.sourceIds)) {
    issues.push("Resolved change coverage final sources do not match the manifest.");
  }
  if (
    lead?.type !== "lead" ||
    lead.summary !== manifest.leadSummary ||
    evidence?.type !== "evidence" ||
    evidence.label !== manifest.evidenceLabel ||
    sourceModule?.type !== "sources" ||
    sourceModule.label !== manifest.sourceLabel
  ) {
    issues.push("Resolved change coverage framing does not match the manifest.");
  }
  if (findings.length !== manifest.renderUnits.length) {
    issues.push("Resolved change coverage contains unexpected evidence items.");
  }
  for (const [index, unit] of manifest.renderUnits.entries()) {
    const item = findings[index];
    const covered =
      item?.sourceId === unit.sourceId &&
      item.finding === unit.finding &&
      item.title === unit.title &&
      item.stance === "support";
    if (covered) continue;
    for (const entryId of unit.entryIds) {
      issues.push(
        `Resolved change coverage is missing required change ${entryId} for source ${unit.sourceId}.`,
      );
    }
  }
  return Object.freeze(issues);
}

export function buildResearchChangeFallbackPlan(manifest: ResearchChangeManifest): SurfacePlan {
  return SurfacePlanSchema.parse({
    kind: "research",
    recipeId: "research.brief",
    density: "brief",
    emphasis: "answer",
    modules: [
      {
        type: "lead",
        variant: "brief",
        title: manifest.subject,
        summary: manifest.leadSummary,
        sourceIds: manifest.requiredSourceIds,
      },
      {
        type: "evidence",
        variant: "stack",
        label: manifest.evidenceLabel,
        items: manifest.renderUnits.map((unit) => ({
          title: unit.title,
          finding: unit.finding,
          sourceId: unit.sourceId,
          stance: "support",
        })),
      },
      {
        type: "sources",
        label: manifest.sourceLabel,
        sourceIds: manifest.requiredSourceIds,
      },
    ],
  });
}
