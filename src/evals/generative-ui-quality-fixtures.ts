import {
  compileGenerativeSurfacePlan,
  type GenerativeLayoutNode,
  type GenerativeSurfacePlan,
} from "../../api/_lib/generative-surface-plan.js";
import type { UiQualityCase } from "./ui-quality-cases.js";
import { recordedUiQualityCompilationInput } from "./ui-quality-fixtures.js";

export type GenerativeFixtureLayoutFamily = "stack" | "grid" | "section";

function rootNode(
  family: GenerativeFixtureLayoutFamily,
  children: string[],
): GenerativeLayoutNode {
  if (family === "grid") {
    return { id: "layout-root", type: "grid", children, columns: "adaptive", gap: "regular" };
  }
  if (family === "section") {
    return {
      id: "layout-root",
      type: "section",
      children,
      role: "primary",
      tone: "neutral",
      prominence: "standard",
    };
  }
  return { id: "layout-root", type: "stack", children, gap: "regular", align: "stretch" };
}

export function buildRecordedGenerativeUiQualityCandidate(
  testCase: UiQualityCase,
  family: GenerativeFixtureLayoutFamily = "stack",
) {
  const recorded = recordedUiQualityCompilationInput(testCase);
  const content = recorded.plan.modules.map((module, index) => ({
    id: `content-${index + 1}`,
    module,
  }));
  const source = content.find((node) => node.module.type === "sources");
  if (!source) throw new TypeError(`${testCase.id} is missing sources.`);
  const plan: GenerativeSurfacePlan = {
    version: "v3",
    kind: recorded.plan.kind,
    density: recorded.plan.density,
    emphasis: recorded.plan.emphasis === "evidence"
      ? "evidence"
      : recorded.plan.emphasis === "answer"
        ? "answer"
        : "exploration",
    archetypeHint: recorded.plan.recipeId,
    content,
    layout: {
      rootId: "layout-root",
      nodes: [rootNode(
        family,
        content.filter((node) => node !== source).map((node) => node.id),
      )],
    },
  };
  return {
    plan,
    spec: compileGenerativeSurfacePlan({
      plan,
      retrieval: recorded.retrieval,
      clientContext: recorded.clientContext,
      prompt: testCase.prompt,
    }),
    retrieval: recorded.retrieval,
    clientContext: recorded.clientContext,
  };
}

/**
 * Recorded cases that exercise the extended grammar-v3 toolkit: new layout
 * primitives, style tokens, and cited insight modules over the same recorded
 * evidence as the base fixtures.
 */
export const EXTENDED_TOOLKIT_CASE_IDS = ["QR02", "QC04"] as const;
export type ExtendedToolkitCaseId = (typeof EXTENDED_TOOLKIT_CASE_IDS)[number];

function extendedToolkitPlan(testCase: UiQualityCase): GenerativeSurfacePlan {
  const recorded = recordedUiQualityCompilationInput(testCase);
  const base = recorded.plan;
  const byType = (type: string) => {
    const module = base.modules.find((candidate) => candidate.type === type);
    if (!module) throw new TypeError(`${testCase.id} is missing ${type} content.`);
    return module;
  };

  if (testCase.id === "QR02") {
    return {
      version: "v3",
      kind: "research",
      density: "balanced",
      emphasis: "evidence",
      archetypeHint: "research.brief",
      content: [
        { id: "lead-content", module: byType("lead") },
        {
          id: "facts-content",
          module: {
            type: "facts",
            label: "Label at a glance",
            facts: [
              { label: "Required content", value: "Price, fees, performance" },
              { label: "Format", value: "Standard label" },
            ],
            sourceIds: ["src_search01"],
          },
        },
        { id: "evidence-content", module: byType("evidence") },
        {
          id: "callout-content",
          module: {
            type: "callout",
            tone: "info",
            title: "Where the label appears",
            body: "FCC guidance explains where providers display the broadband label.",
            sourceIds: ["src_search02"],
          },
        },
        {
          id: "badges-content",
          module: {
            type: "badges",
            label: "Disclosed",
            badges: [
              { label: "Price", tone: "accent" },
              { label: "Fees", tone: "caution" },
              { label: "Performance", tone: "info" },
            ],
            sourceIds: ["src_search01"],
          },
        },
        { id: "source-content", module: byType("sources") },
      ],
      layout: {
        rootId: "layout-root",
        nodes: [
          { id: "layout-root", type: "aside", children: ["main-stack", "side-card"], side: "end" },
          {
            id: "main-stack",
            type: "stack",
            children: ["lead-content", "detail-columns"],
            gap: "regular",
            align: "stretch",
          },
          {
            id: "detail-columns",
            type: "columns",
            children: ["facts-content", "evidence-content"],
            spans: ["third", "two-thirds"],
            gap: "regular",
          },
          {
            id: "side-card",
            type: "card",
            children: ["callout-content", "badges-content"],
            tone: "info",
            prominence: "quiet",
            variant: "filled",
            icon: "book",
            label: "Provider notes",
          },
        ],
      },
    };
  }

  if (testCase.id === "QC04") {
    return {
      version: "v3",
      kind: "comparison",
      density: "detailed",
      emphasis: "evidence",
      archetypeHint: "comparison.scorecard",
      content: [
        { id: "summary-content", module: byType("summary") },
        { id: "table-content", module: byType("table") },
        {
          id: "react-content",
          module: {
            type: "proscons",
            subject: "React renderer",
            pros: [{ text: "Official client setup is available.", sourceId: "src_search01" }],
            cons: [{ text: "Requires a React host application.", sourceId: "src_search01" }],
          },
        },
        {
          id: "angular-content",
          module: {
            type: "proscons",
            subject: "Angular renderer",
            pros: [{ text: "Official renderer documentation is available.", sourceId: "src_search02" }],
            cons: [{ text: "Requires an Angular host application.", sourceId: "src_search02" }],
          },
        },
        {
          id: "ranked-content",
          module: {
            type: "ranked",
            label: "Choose by host framework",
            order: "desc",
            items: [
              { title: "React", detail: "Use @a2ui/react in React hosts.", sourceId: "src_search01" },
              { title: "Angular", detail: "Use the Angular renderer in Angular hosts.", sourceId: "src_search02" },
            ],
          },
        },
        { id: "source-content", module: byType("sources") },
      ],
      layout: {
        rootId: "layout-root",
        nodes: [
          {
            id: "layout-root",
            type: "stack",
            children: ["summary-content", "tradeoff-columns", "detail-accordion"],
            gap: "regular",
            align: "stretch",
          },
          {
            id: "tradeoff-columns",
            type: "columns",
            children: ["react-content", "angular-content"],
            spans: ["half", "half"],
            gap: "regular",
          },
          {
            id: "detail-accordion",
            type: "accordion",
            children: ["table-content", "ranked-content"],
            labels: ["Scorecard", "Recommendation by host"],
            defaultOpenIndex: 0,
          },
        ],
      },
    };
  }

  throw new TypeError(`${testCase.id} has no extended toolkit fixture.`);
}

export function buildRecordedExtendedToolkitCandidate(testCase: UiQualityCase) {
  const recorded = recordedUiQualityCompilationInput(testCase);
  const plan = extendedToolkitPlan(testCase);
  return {
    plan,
    spec: compileGenerativeSurfacePlan({
      plan,
      retrieval: recorded.retrieval,
      clientContext: recorded.clientContext,
      prompt: testCase.prompt,
    }),
    retrieval: recorded.retrieval,
    clientContext: recorded.clientContext,
  };
}
