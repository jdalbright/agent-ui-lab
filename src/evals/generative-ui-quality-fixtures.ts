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
