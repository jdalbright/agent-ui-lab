import { LIMITS } from "./constants.js";
import {
  SourceRecordSchema,
  SurfaceSpecSchema,
  type SourceRecord,
  type SurfaceNode,
  type SurfaceSpec,
} from "./schemas.js";

export type SurfaceValidationResult =
  | { success: true; spec: SurfaceSpec; sources: SourceRecord[]; depth: number }
  | { success: false; issues: string[] };

type LayoutNode = Extract<SurfaceNode, { component: "Band" | "Split" | "Rail" }>;

function isLayoutNode(node: SurfaceNode): node is LayoutNode {
  return node.component === "Band" || node.component === "Split" || node.component === "Rail";
}

function referencedSourceIds(spec: SurfaceSpec): string[] {
  const ids: string[] = [];
  for (const node of spec.components) {
    if ("sourceId" in node && node.sourceId) ids.push(node.sourceId);
    if ("sourceIds" in node) ids.push(...node.sourceIds);
    if (node.component === "EvidenceList" || node.component === "Timeline") {
      for (const item of node.items) {
        if ("sourceId" in item && item.sourceId) ids.push(item.sourceId);
      }
    }
  }
  return ids;
}

export function validateSurfaceSpec(input: unknown, sourceInput: unknown): SurfaceValidationResult {
  const surfaceResult = SurfaceSpecSchema.safeParse(input);
  if (!surfaceResult.success) {
    return {
      success: false,
      issues: surfaceResult.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }

  const sourcesResult = SourceRecordSchema.array().max(LIMITS.sources).safeParse(sourceInput);
  if (!sourcesResult.success) {
    return {
      success: false,
      issues: sourcesResult.error.issues.slice(0, 8).map((issue) => `sources.${issue.path.join(".")}: ${issue.message}`),
    };
  }

  const spec = surfaceResult.data;
  const sources = sourcesResult.data;
  const issues: string[] = [];
  const nodes = new Map(spec.components.map((node) => [node.id, node]));

  if (nodes.size !== spec.components.length) issues.push("Component IDs must be unique.");
  if (!nodes.has(spec.rootId)) issues.push("The root component does not exist.");

  const childIds = new Set<string>();
  for (const node of spec.components) {
    if (!isLayoutNode(node)) continue;
    for (const childId of node.children) {
      childIds.add(childId);
      if (!nodes.has(childId)) issues.push(`Component ${node.id} references missing child ${childId}.`);
      if (childId === node.id) issues.push(`Component ${node.id} cannot contain itself.`);
    }
  }
  if (childIds.has(spec.rootId)) issues.push("The root component cannot be nested under another component.");

  let maximumDepth = 0;
  const active = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string, depth: number): void => {
    maximumDepth = Math.max(maximumDepth, depth);
    if (depth > LIMITS.surfaceDepth) {
      issues.push(`Layout depth exceeds ${LIMITS.surfaceDepth} levels.`);
      return;
    }
    if (active.has(id)) {
      issues.push(`Layout contains a cycle at ${id}.`);
      return;
    }
    const node = nodes.get(id);
    if (!node) return;
    active.add(id);
    visited.add(id);
    if (isLayoutNode(node)) {
      for (const childId of node.children) walk(childId, depth + 1);
    }
    active.delete(id);
  };
  walk(spec.rootId, 1);
  if (visited.size !== nodes.size) issues.push("Every component must be reachable from the root.");

  const sourceIds = new Set(sources.map((source) => source.id));
  for (const referencedId of referencedSourceIds(spec)) {
    if (!sourceIds.has(referencedId)) issues.push(`Unknown source reference: ${referencedId}.`);
  }

  return issues.length > 0
    ? { success: false, issues: [...new Set(issues)].slice(0, 8) }
    : { success: true, spec, sources, depth: maximumDepth };
}
