import { describe, expect, it } from "vitest";
import type { SearchEvidenceProjection } from "./gemini.js";
import {
  buildResearchChangeFallbackPlan,
  buildResearchChangeManifest,
  researchChangeCoverageIssues,
} from "./research-change-manifest.js";
import { SurfacePlanSchema, type SurfacePlan } from "./surface-plan.js";
import type { SourceRecord } from "../../shared/schemas.js";

const accessedAt = "2026-08-01T12:00:00.000Z";

function source(id: string): SourceRecord {
  return {
    id,
    title: `Source ${id}`,
    url: `https://example.com/${id}`,
    provider: "google-search",
    accessedAt,
  };
}

const qrSources = [source("src_search01"), source("src_search02")];
const qrEvidence: SearchEvidenceProjection = {
  status: "complete",
  spans: [
    {
      sourceId: "src_search01",
      ordinal: 0,
      text: "Gemini 3.6 Flash is generally available and production-ready, with function calling, Search grounding, and structured outputs.",
    },
    {
      sourceId: "src_search02",
      ordinal: 1,
      text: "Compared with Gemini 3.5 Flash, Gemini 3.6 Flash completes agentic workflows with fewer reasoning steps, turns, and tool calls, and improves production-ready code generation with fewer debugging loops.",
    },
  ],
};

function manifest() {
  const result = buildResearchChangeManifest({
    prompt: "What changed in Gemini 3.6 Flash? Give me a concise sourced brief.",
    sources: qrSources,
    searchEvidence: qrEvidence,
  });
  if (result.status !== "ready") throw new TypeError(`Manifest unavailable: ${result.reason}`);
  return result.manifest;
}

function planWithFindings(
  findings: readonly { sourceId: string; finding: string }[],
): SurfacePlan {
  return SurfacePlanSchema.parse({
    kind: "research",
    recipeId: "research.brief",
    density: "brief",
    emphasis: "answer",
    modules: [
      {
        type: "lead",
        variant: "brief",
        title: "Gemini 3.6 Flash",
        summary: "A concise source-derived digest of the requested changes.",
        sourceIds: ["src_search01", "src_search02"],
      },
      {
        type: "evidence",
        variant: "stack",
        label: "Documented changes",
        items: findings.map((item, index) => ({
          title: `Source change ${index + 1}`,
          finding: item.finding,
          sourceId: item.sourceId,
          stance: "support",
        })),
      },
      {
        type: "sources",
        label: "Sources",
        sourceIds: ["src_search01", "src_search02"],
      },
    ],
  });
}

describe("buildResearchChangeManifest", () => {
  it("derives bounded target-scoped changes from every complete same-source citation span", () => {
    const result = buildResearchChangeManifest({
      prompt: "What changed in Gemini 3.6 Flash? Give me a concise sourced brief.",
      sources: qrSources,
      searchEvidence: qrEvidence,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.manifest.entries.map(({ id, sourceId }) => ({ id, sourceId }))).toEqual([
      { id: "change_1", sourceId: "src_search01" },
      { id: "change_2", sourceId: "src_search02" },
      { id: "change_3", sourceId: "src_search02" },
    ]);
    expect(result.manifest.renderUnits).toHaveLength(2);
    expect(result.manifest.renderUnits[1]).toMatchObject({
      sourceId: "src_search02",
      entryIds: ["change_2", "change_3"],
    });
    expect(result.manifest.renderUnits.every((unit) =>
      unit.finding.startsWith("Gemini 3.6 Flash ")
    )).toBe(true);
    expect(result.manifest.renderUnits[1]?.finding).toMatch(
      /completes agentic workflows[^;]*; improves production-ready code generation/i,
    );
    expect(result.manifest.renderUnits[1]?.finding.length).toBeGreaterThan(160);
  });

  it("retains generic added, removed, replaced, and no-longer directional predicates", () => {
    const result = buildResearchChangeManifest({
      prompt: "What changed in Widget 2? Give me a concise sourced brief.",
      sources: [source("src_widget")],
      searchEvidence: {
        status: "complete",
        spans: [
          { sourceId: "src_widget", ordinal: 0, text: "Widget 2 adds offline mode." },
          { sourceId: "src_widget", ordinal: 1, text: "Widget 2 removes the legacy API." },
          { sourceId: "src_widget", ordinal: 2, text: "Widget 2 replaces XML with JSON." },
          { sourceId: "src_widget", ordinal: 3, text: "Widget 2 no longer requires an account." },
        ],
      },
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.manifest.entries).toHaveLength(4);
    expect(result.manifest.renderUnits[0]?.finding).toMatch(
      /adds offline mode.*removes the legacy API.*replaces XML with JSON.*no longer requires an account/i,
    );
  });

  it("does not mistake a year-shaped product version for historical evidence", () => {
    const result = buildResearchChangeManifest({
      prompt: "What changed in Widget 2026? Give me a concise sourced brief.",
      sources: [source("src_widget")],
      searchEvidence: {
        status: "complete",
        spans: [
          { sourceId: "src_widget", ordinal: 0, text: "Widget 2026 adds offline mode." },
        ],
      },
    });

    expect(result.status).toBe("ready");
  });

  it("preserves punctuation-distinct changes when deduplicating entries", () => {
    const result = buildResearchChangeManifest({
      prompt: "What changed in Widget 2? Give me a concise sourced brief.",
      sources: [source("src_widget")],
      searchEvidence: {
        status: "complete",
        spans: [
          { sourceId: "src_widget", ordinal: 0, text: "Widget 2 adds C++ support." },
          { sourceId: "src_widget", ordinal: 1, text: "Widget 2 adds C support." },
        ],
      },
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.manifest.entries.map((entry) => entry.coverageText)).toEqual([
      "adds C++ support",
      "adds C support",
    ]);
  });

  it("preserves case-distinct source changes when deduplicating entries", () => {
    const result = buildResearchChangeManifest({
      prompt: "What changed in Widget 2? Give me a concise sourced brief.",
      sources: [source("src_widget")],
      searchEvidence: {
        status: "complete",
        spans: [
          { sourceId: "src_widget", ordinal: 0, text: "Widget 2 supports HTTP." },
          { sourceId: "src_widget", ordinal: 1, text: "Widget 2 supports http." },
        ],
      },
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.manifest.entries.map((entry) => entry.coverageText)).toEqual([
      "supports HTTP",
      "supports http",
    ]);
  });

  it.each([
    {
      name: "missing citation provenance",
      searchEvidence: undefined,
      reason: "missing-provenance",
    },
    {
      name: "incomplete citation provenance",
      searchEvidence: { status: "incomplete", reason: "missing-span", spans: [] } as const,
      reason: "incomplete-provenance",
    },
    {
      name: "complete but empty citation provenance",
      searchEvidence: { status: "complete", spans: [] } as const,
      reason: "missing-provenance",
    },
  ])("fails closed for $name", ({ searchEvidence, reason }) => {
    expect(
      buildResearchChangeManifest({
        prompt: "What changed in Widget 2? Give me a concise sourced brief.",
        sources: [source("src_widget")],
        searchEvidence,
      }),
    ).toMatchObject({ status: "unavailable", reason });
  });

  it("fails closed instead of treating topical or unsafe text as a change", () => {
    for (const text of [
      "The Widget 2 documentation discusses features that were added.",
      "Widget 2 does not add offline mode.",
      "Widget 2 may add offline mode.",
      "The documentation asks whether Widget 2 adds offline mode.",
      "Evidence does not show that Widget 2 adds offline mode.",
      "The report denies that Widget 2 adds offline mode.",
      "There is scant evidence that Widget 2 adds offline mode.",
      "It is false that Widget 2 adds offline mode.",
      "There is no evidence that Widget 2 adds offline mode.",
      "It remains unconfirmed that Widget 2 adds offline mode.",
      "It might be true that Widget 2 adds offline mode.",
      "Does Widget 2 support offline mode?",
      "Widget 2 added offline mode last year but no longer does.",
      "Widget 2 adds offline mode; however, the source does not support that claim.",
      "Widget 2 adds offline mode, but that claim is unconfirmed.",
      "Widget 1 adds offline mode; Widget 2 is unchanged.",
      "Unlike Widget 2, Widget 1 adds offline mode.",
      "Widget 2 adds offline mode, while Widget 2 removes the legacy API.",
      "Widget 2 adds offline mode. It also removes the legacy API.",
      "Widget 2 adds offline mode. It removes the legacy API.",
      "Widget 2 adds offline mode. The release removes the legacy API.",
      "Widget 2 adds offline mode. This version removes the legacy API.",
      "Widget 2 adds offline mode. Widget 2 retires the legacy API.",
      "Widget 2 adds offline mode. Removes the legacy API.",
      "Widget 2 adds <script>alert(1)</script> support.",
    ]) {
      const result = buildResearchChangeManifest({
        prompt: "What changed in Widget 2? Give me a concise sourced brief.",
        sources: [source("src_widget")],
        searchEvidence: {
          status: "complete",
          spans: [{ sourceId: "src_widget", ordinal: 0, text }],
        },
      });
      expect(result.status).toBe("unavailable");
    }
  });

  it("fails closed when any cited span is not a self-contained target-scoped change", () => {
    const result = buildResearchChangeManifest({
      prompt: "What changed in Widget 2? Give me a concise sourced brief.",
      sources: [source("src_widget")],
      searchEvidence: {
        status: "complete",
        spans: [
          { sourceId: "src_widget", ordinal: 0, text: "Widget 2 adds offline mode." },
          { sourceId: "src_widget", ordinal: 1, text: "Offline mode is now supported." },
        ],
      },
    });

    expect(result).toMatchObject({ status: "unavailable", reason: "unscoped-change" });
  });

  it("fails closed when complete changes require more than two source groups", () => {
    const sources = [source("src_a"), source("src_b"), source("src_c")];
    const result = buildResearchChangeManifest({
      prompt: "What changed in Widget 2? Give me a concise sourced brief.",
      sources,
      searchEvidence: {
        status: "complete",
        spans: sources.map((record, ordinal) => ({
          sourceId: record.id,
          ordinal,
          text: `Widget 2 adds capability ${ordinal + 1}.`,
        })),
      },
    });

    expect(result).toMatchObject({ status: "unavailable", reason: "source-capacity" });
  });

  it("fails closed when manifest prose cannot fit the aggregate brief budget", () => {
    const longObject = "a".repeat(560);
    const result = buildResearchChangeManifest({
      prompt: "What changed in Widget 2? Give me a concise sourced brief.",
      sources: [source("src_widget")],
      searchEvidence: {
        status: "complete",
        spans: [
          { sourceId: "src_widget", ordinal: 0, text: `Widget 2 adds ${longObject}.` },
          { sourceId: "src_widget", ordinal: 1, text: "Widget 2 removes the legacy API." },
        ],
      },
    });

    expect(result).toMatchObject({ status: "unavailable", reason: "content-capacity" });
  });
});

describe("research change coverage", () => {
  it("requires each exact change in a finding carrying the same issued source ID", () => {
    const digest = manifest();
    const complete = planWithFindings([
      {
        sourceId: "src_search01",
        finding: digest.renderUnits[0]?.finding ?? "",
      },
      {
        sourceId: "src_search02",
        finding: digest.renderUnits[1]?.finding ?? "",
      },
    ]);
    const wrongSource = structuredClone(complete);
    const evidence = wrongSource.modules.find((module) => module.type === "evidence");
    if (!evidence || evidence.type !== "evidence") throw new TypeError("Evidence unavailable.");
    evidence.items[0] = { ...evidence.items[0], sourceId: "src_search02" };

    expect(researchChangeCoverageIssues(complete, digest)).toEqual([]);
    expect(researchChangeCoverageIssues(wrongSource, digest)).toEqual([
      "Resolved change coverage is missing required change change_1 for source src_search01.",
    ]);
  });

  it("reports only opaque missing entry and source IDs", () => {
    const digest = manifest();
    const incomplete = planWithFindings([
      {
        sourceId: "src_search01",
        finding: "The source lists supported capabilities.",
      },
      {
        sourceId: "src_search02",
        finding: "Completes agentic workflows with fewer reasoning steps, turns, and tool calls.",
      },
    ]);

    expect(researchChangeCoverageIssues(incomplete, digest)).toEqual([
      "Resolved change coverage is missing required change change_1 for source src_search01.",
      "Resolved change coverage is missing required change change_2 for source src_search02.",
      "Resolved change coverage is missing required change change_3 for source src_search02.",
    ]);
  });

  it.each([
    (finding: string) => `It is false that ${finding}`,
    (finding: string) => `${finding}; however, that claim is unsupported.`,
  ])("does not accept a trusted render unit embedded in negated or retracted prose", (wrap) => {
    const digest = manifest();
    const fallback = buildResearchChangeFallbackPlan(digest);
    const candidate = structuredClone(fallback);
    const evidence = candidate.modules.find((module) => module.type === "evidence");
    if (!evidence || evidence.type !== "evidence" || !evidence.items[0]) {
      throw new TypeError("Evidence unavailable.");
    }
    evidence.items[0] = {
      ...evidence.items[0],
      finding: wrap(evidence.items[0].finding),
    };

    expect(researchChangeCoverageIssues(candidate, digest)).toContain(
      "Resolved change coverage is missing required change change_1 for source src_search01.",
    );
  });

  it("requires exact ordered one-to-one render-unit closure with no extra evidence items", () => {
    const digest = manifest();
    const fallback = buildResearchChangeFallbackPlan(digest);
    const candidate = structuredClone(fallback);
    const evidence = candidate.modules.find((module) => module.type === "evidence");
    if (!evidence || evidence.type !== "evidence") throw new TypeError("Evidence unavailable.");
    evidence.items.push({
      title: "Contradiction",
      finding: "The requested changes are unconfirmed.",
      sourceId: "src_search01",
      stance: "challenge",
    });

    expect(researchChangeCoverageIssues(candidate, digest)).toContain(
      "Resolved change coverage contains unexpected evidence items.",
    );
  });

  it("requires the lead to establish the exact requested subject", () => {
    const digest = manifest();
    const candidate = structuredClone(buildResearchChangeFallbackPlan(digest));
    const lead = candidate.modules.find((module) => module.type === "lead");
    if (!lead || lead.type !== "lead") throw new TypeError("Lead unavailable.");
    lead.title = "Requested changes";
    lead.summary = "A concise source-derived digest.";

    expect(researchChangeCoverageIssues(candidate, digest)).toContain(
      "Resolved change coverage lead must equal the requested subject.",
    );
  });

  it("requires exact lead subject and manifest source closure in both boundary modules", () => {
    const digest = manifest();
    const candidate = structuredClone(buildResearchChangeFallbackPlan(digest));
    const lead = candidate.modules.find((module) => module.type === "lead");
    const sources = candidate.modules.find((module) => module.type === "sources");
    if (!lead || lead.type !== "lead" || !sources || sources.type !== "sources") {
      throw new TypeError("Boundary modules unavailable.");
    }
    lead.title = `${digest.subject} update`;
    lead.sourceIds = [...digest.requiredSourceIds].reverse();
    sources.sourceIds = [...digest.requiredSourceIds, "src_extra"];

    expect(researchChangeCoverageIssues(candidate, digest)).toEqual(
      expect.arrayContaining([
        "Resolved change coverage lead must equal the requested subject.",
        "Resolved change coverage lead sources do not match the manifest.",
        "Resolved change coverage final sources do not match the manifest.",
      ]),
    );
  });

  it("rejects contradictory model-authored framing around trusted findings", () => {
    const digest = manifest();
    const candidate = structuredClone(buildResearchChangeFallbackPlan(digest));
    const lead = candidate.modules.find((module) => module.type === "lead");
    if (!lead || lead.type !== "lead") throw new TypeError("Lead unavailable.");
    lead.summary = "No changes were found in the supplied evidence.";

    expect(researchChangeCoverageIssues(candidate, digest)).toContain(
      "Resolved change coverage framing does not match the manifest.",
    );
  });

  it("requires literal compiler-issued lead and finding text", () => {
    const digest = manifest();
    const candidate = structuredClone(buildResearchChangeFallbackPlan(digest));
    const lead = candidate.modules.find((module) => module.type === "lead");
    const evidence = candidate.modules.find((module) => module.type === "evidence");
    if (!lead || lead.type !== "lead" || !evidence || evidence.type !== "evidence") {
      throw new TypeError("Manifest modules unavailable.");
    }
    lead.title = lead.title.toLocaleLowerCase("en-US");
    evidence.items[0].finding = `${evidence.items[0].finding}?`;

    expect(researchChangeCoverageIssues(candidate, digest)).toEqual(
      expect.arrayContaining([
        "Resolved change coverage lead must equal the requested subject.",
        "Resolved change coverage is missing required change change_1 for source src_search01.",
      ]),
    );
  });

  it("builds a bounded manifest-backed fallback that passes the same coverage check", () => {
    const digest = manifest();
    const fallback = buildResearchChangeFallbackPlan(digest);

    expect(fallback.modules.map((module) => module.type)).toEqual([
      "lead",
      "evidence",
      "sources",
    ]);
    expect(researchChangeCoverageIssues(fallback, digest)).toEqual([]);
    const evidence = fallback.modules.find((module) => module.type === "evidence");
    expect(evidence?.type === "evidence" ? evidence.items : []).toHaveLength(2);
  });
});
