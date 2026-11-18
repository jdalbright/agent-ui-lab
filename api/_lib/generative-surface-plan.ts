import { z } from "zod";
import { LIMITS } from "../../shared/constants.js";
import {
  CARD_VARIANTS,
  COLUMN_SPANS,
  DIVIDER_STYLES,
  GRID_COLUMNS,
  LAYOUT_GAPS,
  SECTION_ROLES,
  SECTION_WIDTHS,
  SPLIT_RATIOS,
  STACK_ALIGNMENTS,
  SURFACE_ICONS,
  SURFACE_PROMINENCE,
  SURFACE_TONES,
} from "../../shared/layout-tokens.js";
import {
  measureSurfaceContent,
  SURFACE_CONTENT_BUDGETS,
} from "../../shared/surface-content-budget.js";
import {
  SurfaceDensitySchema,
  SurfaceRecipeIdSchema,
  SurfaceSpecSchema,
  type ClientContext,
  type SurfaceSpec,
} from "../../shared/schemas.js";
import { validateSurfaceSpec } from "../../shared/surface-validation.js";
import type { GeminiRetrievalResult } from "./gemini.js";
import {
  ComparisonPlanModuleSchema,
  ResearchPlanModuleSchema,
  SurfacePlanSchema,
  WeatherPlanModuleSchema,
  compileSurfacePlan,
  evaluateSurfacePlanQuality,
  expectedRecipeForPrompt,
  validateSurfacePlan,
  type SurfacePlan,
  type SurfacePlanModule,
  type SurfacePlanValidationContext,
} from "./surface-plan.js";

const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const safeLabel = (maximum: number) => z
  .string()
  .trim()
  .min(1)
  .max(maximum)
  .refine(
    (value) =>
      !/(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|<\s*\/?\s*[a-z]|\b(?:javascript|data|vbscript)\s*:)/iu.test(
        value,
      ),
    "Use safe declarative labels without URLs, markup, or executable schemes.",
  );
const safeLabelSchema = safeLabel(80);
const generativeEmphasisSchema = z.enum(["answer", "evidence", "exploration"]);
const childIdsSchema = z.array(idSchema).min(1).max(20);
const gapSchema = z.enum(LAYOUT_GAPS);
const toneSchema = z.enum(SURFACE_TONES);
const prominenceSchema = z.enum(SURFACE_PROMINENCE);
const iconSchema = z.enum(SURFACE_ICONS);

const stackLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("stack"),
    children: childIdsSchema,
    gap: gapSchema,
    align: z.enum(STACK_ALIGNMENTS),
  })
  .strict();

const gridLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("grid"),
    children: childIdsSchema,
    columns: z.enum(GRID_COLUMNS),
    gap: gapSchema,
  })
  .strict();

const splitLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("split"),
    children: z.array(idSchema).min(2).max(3),
    ratio: z.enum(SPLIT_RATIOS),
  })
  .strict();

const sectionLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("section"),
    children: childIdsSchema,
    label: safeLabelSchema.optional(),
    role: z.enum(SECTION_ROLES),
    tone: toneSchema,
    prominence: prominenceSchema,
    width: z.enum(SECTION_WIDTHS).optional(),
    icon: iconSchema.optional(),
  })
  .strict();

const cardLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("card"),
    children: z.array(idSchema).min(1).max(8),
    tone: toneSchema,
    prominence: prominenceSchema,
    variant: z.enum(CARD_VARIANTS).optional(),
    icon: iconSchema.optional(),
    label: safeLabelSchema.optional(),
  })
  .strict();

const railLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("rail"),
    children: childIdsSchema,
    label: safeLabelSchema.optional(),
  })
  .strict();

const tabsLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("tabs"),
    children: z.array(idSchema).min(2).max(4),
    labels: z.array(safeLabel(40)).min(2).max(4),
    defaultIndex: z.number().int().min(0).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.children.length !== value.labels.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["labels"],
        message: "Tab labels must match the tab child count.",
      });
    }
    if (value.defaultIndex >= value.children.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultIndex"],
        message: "The default tab must reference an available child.",
      });
    }
  });

const disclosureLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("disclosure"),
    children: z.array(idSchema).min(1).max(4),
    label: safeLabelSchema,
    defaultOpen: z.boolean(),
  })
  .strict();

const dividerLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("divider"),
    label: safeLabelSchema.optional(),
    style: z.enum(DIVIDER_STYLES).optional(),
  })
  .strict();

const accordionLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("accordion"),
    children: z.array(idSchema).min(2).max(5),
    labels: z.array(safeLabel(60)).min(2).max(5),
    defaultOpenIndex: z.number().int().min(0).max(4).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.children.length !== value.labels.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["labels"],
        message: "Accordion labels must match the panel child count.",
      });
    }
    if (value.defaultOpenIndex !== undefined && value.defaultOpenIndex >= value.children.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultOpenIndex"],
        message: "The default accordion panel must reference an available child.",
      });
    }
  });

const scrollerLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("scroller"),
    children: z.array(idSchema).min(2).max(8),
    label: safeLabelSchema,
  })
  .strict();

const columnsLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("columns"),
    children: z.array(idSchema).min(2).max(6),
    spans: z.array(z.enum(COLUMN_SPANS)).min(2).max(6),
    gap: gapSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.children.length !== value.spans.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["spans"],
        message: "Column spans must match the column child count.",
      });
    }
  });

const asideLayoutSchema = z
  .object({
    id: idSchema,
    type: z.literal("aside"),
    children: z.array(idSchema).length(2),
    side: z.enum(["start", "end"]),
    label: safeLabelSchema.optional(),
  })
  .strict();

export const GenerativeLayoutNodeSchema = z.union([
  stackLayoutSchema,
  gridLayoutSchema,
  splitLayoutSchema,
  sectionLayoutSchema,
  cardLayoutSchema,
  railLayoutSchema,
  tabsLayoutSchema,
  disclosureLayoutSchema,
  dividerLayoutSchema,
  accordionLayoutSchema,
  scrollerLayoutSchema,
  columnsLayoutSchema,
  asideLayoutSchema,
]);

function contentNodeSchema(moduleSchema: z.ZodTypeAny) {
  return z
    .object({
      id: idSchema,
      module: moduleSchema,
    })
    .strict();
}

function generativePlanSchema<Kind extends "weather" | "comparison" | "research">(
  kind: Kind,
  moduleSchema: z.ZodTypeAny,
) {
  return z
    .object({
      version: z.literal("v3"),
      kind: z.literal(kind),
      density: SurfaceDensitySchema,
      emphasis: generativeEmphasisSchema,
      archetypeHint: SurfaceRecipeIdSchema.optional(),
      content: z.array(contentNodeSchema(moduleSchema)).min(2).max(12),
      layout: z
        .object({
          rootId: idSchema,
          nodes: z.array(GenerativeLayoutNodeSchema).min(1).max(8),
        })
        .strict(),
    })
    .strict();
}

export const GenerativeSurfacePlanSchema = z.discriminatedUnion("kind", [
  generativePlanSchema("weather", WeatherPlanModuleSchema),
  generativePlanSchema("comparison", ComparisonPlanModuleSchema),
  generativePlanSchema("research", ResearchPlanModuleSchema),
]);

export type GenerativeLayoutNode = z.infer<typeof GenerativeLayoutNodeSchema>;
export interface GenerativeSurfaceContentNode {
  readonly id: string;
  readonly module: SurfacePlanModule;
}

export interface GenerativeSurfacePlan {
  readonly version: "v3";
  readonly kind: SurfacePlan["kind"];
  readonly density: SurfacePlan["density"];
  readonly emphasis: "answer" | "evidence" | "exploration";
  readonly archetypeHint?: SurfacePlan["recipeId"];
  readonly content: readonly GenerativeSurfaceContentNode[];
  readonly layout: {
    readonly rootId: string;
    readonly nodes: readonly GenerativeLayoutNode[];
  };
}

export const GENERATIVE_SURFACE_BUDGETS = Object.freeze({
  brief: { maxContentNodes: 6, maxLayoutNodes: 4 },
  balanced: { maxContentNodes: 9, maxLayoutNodes: 6 },
  detailed: { maxContentNodes: 12, maxLayoutNodes: 8 },
} as const);

const PRIMARY_MODULE_BY_KIND = {
  weather: "hero",
  comparison: "summary",
  research: "lead",
} as const;

const DEFAULT_ARCHETYPE_BY_KIND = {
  weather: "weather.snapshot",
  comparison: "comparison.verdict",
  research: "research.brief",
} as const satisfies Record<GenerativeSurfacePlan["kind"], SurfacePlan["recipeId"]>;

const ARCHETYPE_PREFIX_BY_KIND = {
  weather: "weather.",
  comparison: "comparison.",
  research: "research.",
} as const;

type ParsedPlan = GenerativeSurfacePlan;
type ParsedContent = ParsedPlan["content"][number];

export type GenerativeSurfaceMeasurements = Readonly<{
  contentNodes: number;
  layoutNodes: number;
  maximumDepth: number;
}>;

export type GenerativeSurfaceValidationResult =
  | {
      success: true;
      plan: GenerativeSurfacePlan;
      contentPlan: SurfacePlan;
      orderedContent: readonly ParsedContent[];
      measurements: GenerativeSurfaceMeasurements;
    }
  | { success: false; issues: string[] };

function childrenOf(node: GenerativeLayoutNode): readonly string[] {
  return "children" in node ? node.children : [];
}

function isInteractive(node: GenerativeLayoutNode): boolean {
  return node.type === "tabs" || node.type === "disclosure" || node.type === "accordion";
}

function boundedIssues(issues: readonly string[]): string[] {
  return [...new Set(issues)].slice(0, 12);
}

function orderedContentForPlan(plan: GenerativeSurfacePlan): ParsedContent[] {
  const primaryType = PRIMARY_MODULE_BY_KIND[plan.kind];
  const primary = plan.content.filter(({ module }) => module.type === primaryType);
  const supporting = plan.content.filter(
    ({ module }) => module.type !== primaryType && module.type !== "sources",
  );
  const sources = plan.content.filter(({ module }) => module.type === "sources");
  return [...primary, ...supporting, ...sources];
}

function contentPlanFor(
  plan: GenerativeSurfacePlan,
  orderedContent: readonly ParsedContent[],
  context: SurfacePlanValidationContext,
): SurfacePlan {
  const inferredArchetype = expectedRecipeForPrompt(
    context.prompt,
    plan.kind,
    plan.kind === "comparison" && context.evidence.length > 0,
  );
  const recipeId = plan.archetypeHint ?? inferredArchetype ?? DEFAULT_ARCHETYPE_BY_KIND[plan.kind];
  return SurfacePlanSchema.parse({
    kind: plan.kind,
    recipeId,
    density: plan.density,
    emphasis: plan.emphasis === "exploration" ? "answer" : plan.emphasis,
    modules: orderedContent.map(({ module }) => module),
  });
}

function requestedPresentationIssues(plan: GenerativeSurfacePlan, prompt = ""): string[] {
  const normalized = prompt.toLocaleLowerCase("en-US");
  const moduleTypes = new Set(plan.content.map(({ module }) => module.type));
  const issues: string[] = [];
  if (/\b(?:chart|plot|graph)\b/u.test(normalized) && !moduleTypes.has("chart")) {
    issues.push("The requested chart or plot is not represented in the content graph.");
  }
  if (/\b(?:timeline|chronology|milestones?)\b/u.test(normalized) && !moduleTypes.has("timeline")) {
    issues.push("The requested timeline is not represented in the content graph.");
  }
  return issues;
}

export function validateGenerativeSurfacePlan(
  input: unknown,
  context: SurfacePlanValidationContext,
): GenerativeSurfaceValidationResult {
  const parsed = GenerativeSurfacePlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues
        .slice(0, 12)
        .map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`),
    };
  }

  const plan = parsed.data as GenerativeSurfacePlan;
  const issues: string[] = [];
  const budget = GENERATIVE_SURFACE_BUDGETS[plan.density];
  if (plan.content.length > budget.maxContentNodes) {
    issues.push(`Content exceeds the ${plan.density} content budget of ${budget.maxContentNodes} nodes.`);
  }
  if (plan.layout.nodes.length > budget.maxLayoutNodes) {
    issues.push(`Layout exceeds the ${plan.density} layout budget of ${budget.maxLayoutNodes} nodes.`);
  }

  const prefix = ARCHETYPE_PREFIX_BY_KIND[plan.kind];
  if (plan.archetypeHint && !plan.archetypeHint.startsWith(prefix)) {
    issues.push(`Archetype ${plan.archetypeHint} does not match the ${plan.kind} domain.`);
  }

  const contentById = new Map(plan.content.map((content) => [content.id, content]));
  const layoutById = new Map(plan.layout.nodes.map((node) => [node.id, node]));
  if (contentById.size !== plan.content.length) issues.push("Content IDs must be unique.");
  if (layoutById.size !== plan.layout.nodes.length) issues.push("Layout IDs must be unique.");
  for (const id of contentById.keys()) {
    if (layoutById.has(id)) issues.push(`Content and layout IDs cannot overlap: ${id}.`);
  }
  if (!layoutById.has(plan.layout.rootId)) issues.push("The layout root does not exist.");

  const primaryType = PRIMARY_MODULE_BY_KIND[plan.kind];
  const primaryContent = plan.content.filter(({ module }) => module.type === primaryType);
  const sourceContent = plan.content.filter(({ module }) => module.type === "sources");
  if (primaryContent.length !== 1) issues.push(`Exactly one primary ${primaryType} content node is required.`);
  if (sourceContent.length !== 1) issues.push("Exactly one source content node is required.");

  const placementCounts = new Map<string, number>();
  const layoutParentCounts = new Map<string, number>();
  const active = new Set<string>();
  const visitedLayouts = new Set<string>();
  const readingOrder: string[] = [];
  let maximumDepth = 1;

  const walk = (
    id: string,
    depth: number,
    interactiveAncestor: boolean,
    asideSupporting = false,
  ): void => {
    maximumDepth = Math.max(maximumDepth, depth);
    if (depth > LIMITS.surfaceDepth) {
      issues.push(`Layout depth exceeds ${LIMITS.surfaceDepth} levels.`);
      return;
    }
    const content = contentById.get(id);
    if (content) {
      placementCounts.set(id, (placementCounts.get(id) ?? 0) + 1);
      readingOrder.push(id);
      if (content.module.type === "sources") {
        issues.push("Sources must remain outside the generative layout graph.");
      }
      if (interactiveAncestor && content.module.type === primaryType) {
        issues.push("Primary content cannot be hidden in an interactive container.");
      }
      if (interactiveAncestor && content.module.type === "alerts") {
        issues.push("Critical alerts cannot be hidden in an interactive container.");
      }
      if (asideSupporting && content.module.type === primaryType) {
        issues.push("Primary content must sit in the main column of an aside layout.");
      }
      return;
    }

    const node = layoutById.get(id);
    if (!node) {
      issues.push(`Layout references unknown child ${id}.`);
      return;
    }
    if (active.has(id)) {
      issues.push(`Layout contains a cycle at ${id}.`);
      return;
    }
    const currentInteractive = isInteractive(node);
    if (interactiveAncestor && currentInteractive) {
      issues.push("Interactive layout containers cannot be nested.");
    }
    active.add(id);
    visitedLayouts.add(id);
    childrenOf(node).forEach((childId, childIndex) => {
      if (layoutById.has(childId)) {
        layoutParentCounts.set(childId, (layoutParentCounts.get(childId) ?? 0) + 1);
      }
      walk(
        childId,
        depth + 1,
        interactiveAncestor || currentInteractive,
        asideSupporting || (node.type === "aside" && childIndex === 1),
      );
    });
    active.delete(id);
  };
  walk(plan.layout.rootId, 2, false);

  for (const node of plan.layout.nodes) {
    if (!visitedLayouts.has(node.id)) issues.push(`Layout node ${node.id} is unreachable.`);
    const expectedParents = node.id === plan.layout.rootId ? 0 : 1;
    if ((layoutParentCounts.get(node.id) ?? 0) !== expectedParents) {
      issues.push(`Layout node ${node.id} must have exactly ${expectedParents} parent references.`);
    }
  }
  for (const content of plan.content) {
    const expectedPlacements = content.module.type === "sources" ? 0 : 1;
    if ((placementCounts.get(content.id) ?? 0) !== expectedPlacements) {
      issues.push(`Content node ${content.id} must appear exactly ${expectedPlacements} times in the layout.`);
    }
  }
  if (primaryContent[0] && readingOrder[0] !== primaryContent[0].id) {
    issues.push("Primary content must be first in logical reading order.");
  }

  issues.push(...requestedPresentationIssues(plan, context.prompt));
  const orderedContent = orderedContentForPlan(plan);
  let contentPlan: SurfacePlan | undefined;
  try {
    contentPlan = contentPlanFor(plan, orderedContent, context);
    const contentValidation = validateSurfacePlan(contentPlan, context, { mode: "grammar-v3" });
    if (!contentValidation.success) issues.push(...contentValidation.issues);
  } catch {
    issues.push("Content modules do not form a valid trusted domain surface.");
  }

  if (!contentPlan || issues.length > 0) return { success: false, issues: boundedIssues(issues) };
  return {
    success: true,
    plan,
    contentPlan,
    orderedContent: Object.freeze([...orderedContent]),
    measurements: Object.freeze({
      contentNodes: plan.content.length,
      layoutNodes: plan.layout.nodes.length,
      maximumDepth,
    }),
  };
}

function compileLayoutNode(
  node: GenerativeLayoutNode,
  contentRoots: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const children = childrenOf(node).map((id) => contentRoots.get(id) ?? id);
  switch (node.type) {
    case "stack":
      return { id: node.id, component: "Stack", children, gap: node.gap, align: node.align };
    case "grid":
      return { id: node.id, component: "Grid", children, columns: node.columns, gap: node.gap };
    case "split":
      return { id: node.id, component: "Split", children, ratio: node.ratio };
    case "section":
      return {
        id: node.id,
        component: "Section",
        children,
        ...(node.label ? { label: node.label } : {}),
        role: node.role,
        tone: node.tone,
        prominence: node.prominence,
        ...(node.width ? { width: node.width } : {}),
        ...(node.icon ? { icon: node.icon } : {}),
      };
    case "card":
      return {
        id: node.id,
        component: "Card",
        children,
        tone: node.tone,
        prominence: node.prominence,
        ...(node.variant ? { variant: node.variant } : {}),
        ...(node.icon ? { icon: node.icon } : {}),
        ...(node.label ? { label: node.label } : {}),
      };
    case "rail":
      return { id: node.id, component: "Rail", children, ...(node.label ? { label: node.label } : {}) };
    case "tabs":
      return {
        id: node.id,
        component: "Tabs",
        children,
        labels: [...node.labels],
        defaultIndex: node.defaultIndex,
      };
    case "disclosure":
      return {
        id: node.id,
        component: "Disclosure",
        children,
        label: node.label,
        defaultOpen: node.defaultOpen,
      };
    case "divider":
      return {
        id: node.id,
        component: "Divider",
        ...(node.label ? { label: node.label } : {}),
        ...(node.style ? { style: node.style } : {}),
      };
    case "accordion":
      return {
        id: node.id,
        component: "Accordion",
        children,
        labels: [...node.labels],
        ...(node.defaultOpenIndex === undefined ? {} : { defaultOpenIndex: node.defaultOpenIndex }),
      };
    case "scroller":
      return { id: node.id, component: "Scroller", children, label: node.label };
    case "columns":
      return { id: node.id, component: "Columns", children, spans: [...node.spans], gap: node.gap };
    case "aside":
      return {
        id: node.id,
        component: "Aside",
        children,
        side: node.side,
        ...(node.label ? { label: node.label } : {}),
      };
  }
}

export interface CompileGenerativeSurfacePlanInput {
  plan: unknown;
  retrieval: GeminiRetrievalResult;
  clientContext: ClientContext;
  prompt: string;
}

export function compileGenerativeSurfacePlan({
  plan: input,
  retrieval,
  clientContext,
  prompt,
}: CompileGenerativeSurfacePlanInput): SurfaceSpec {
  const context: SurfacePlanValidationContext = {
    sources: retrieval.sources,
    evidence: retrieval.evidence,
    prompt,
    clientContext,
  };
  const validation = validateGenerativeSurfacePlan(input, context);
  if (!validation.success) {
    throw new TypeError(`Cannot compile invalid GenerativeSurfacePlan: ${validation.issues.join(" ")}`);
  }

  const contentSpec = compileSurfacePlan({
    plan: validation.contentPlan,
    retrieval,
    clientContext,
    prompt,
    validationMode: "grammar-v3",
  });
  const contentFrame = contentSpec.components.find(
    (node) => node.id === contentSpec.rootId && node.component === "SurfaceFrame",
  );
  if (!contentFrame || !("children" in contentFrame)) {
    throw new TypeError("Trusted content compiler did not produce a SurfaceFrame.");
  }
  const compiledRoots = contentFrame.children;
  if (compiledRoots.length !== validation.orderedContent.length) {
    throw new TypeError("Trusted content roots do not match the validated content plan.");
  }
  const contentRoots = new Map(
    validation.orderedContent.map((content, index) => [content.id, compiledRoots[index]]),
  );
  const sourceContent = validation.orderedContent.find(({ module }) => module.type === "sources");
  const sourceRoot = sourceContent ? contentRoots.get(sourceContent.id) : undefined;
  if (!sourceRoot) throw new TypeError("Trusted source content root is unavailable.");

  const components = [
    {
      id: "surface-frame",
      component: "SurfaceFrame",
      children: [validation.plan.layout.rootId, sourceRoot],
      compositionMode: "grammar-v3",
      ...(validation.plan.archetypeHint ? { archetypeHint: validation.plan.archetypeHint } : {}),
      density: validation.plan.density,
      emphasis: validation.plan.emphasis,
    },
    ...validation.plan.layout.nodes.map((node) => compileLayoutNode(node, contentRoots)),
    ...contentSpec.components.filter((node) => node.id !== contentSpec.rootId),
  ];
  const spec = SurfaceSpecSchema.parse({
    kind: validation.plan.kind,
    rootId: "surface-frame",
    components,
  });
  const finalValidation = validateSurfaceSpec(spec, retrieval.sources);
  if (!finalValidation.success) {
    throw new TypeError(`Compiled grammar-v3 surface is invalid: ${finalValidation.issues.join(" ")}`);
  }
  return finalValidation.spec;
}

export type GenerativeSurfaceQualityCode =
  | "graph_integrity"
  | "answer_first"
  | "sources_visible"
  | "requested_coverage"
  | "duplicate_primary"
  | "chart_table_alignment"
  | "citation_coverage"
  | "content_budget";

export function evaluateGenerativeSurfacePlanQuality(
  plan: GenerativeSurfacePlan,
  context: SurfacePlanValidationContext,
  spec: SurfaceSpec,
): Readonly<Record<GenerativeSurfaceQualityCode, boolean>> {
  const validation = validateGenerativeSurfacePlan(plan, context);
  if (!validation.success) {
    return Object.freeze({
      graph_integrity: false,
      answer_first: false,
      sources_visible: false,
      requested_coverage: false,
      duplicate_primary: false,
      chart_table_alignment: false,
      citation_coverage: false,
      content_budget: false,
    });
  }
  const contentQuality = evaluateSurfacePlanQuality(validation.contentPlan, context, spec);
  const contentBudget = SURFACE_CONTENT_BUDGETS[plan.density];
  const prose = measureSurfaceContent(spec);
  const budget = GENERATIVE_SURFACE_BUDGETS[plan.density];
  const root = spec.components.find(
    (node) => node.id === spec.rootId && node.component === "SurfaceFrame",
  );
  const sourceNode = spec.components.find((node) => node.component === "SourceList");
  const sourcesVisible = Boolean(
    root &&
      "children" in root &&
      sourceNode &&
      root.children.at(-1) === sourceNode.id,
  );
  return Object.freeze({
    graph_integrity: true,
    answer_first: contentQuality.answer_first,
    sources_visible: sourcesVisible,
    requested_coverage: contentQuality.requested_coverage,
    duplicate_primary: contentQuality.duplicate_primary,
    chart_table_alignment: contentQuality.chart_table_alignment,
    citation_coverage: contentQuality.citation_coverage,
    content_budget:
      plan.content.length <= budget.maxContentNodes &&
      plan.layout.nodes.length <= budget.maxLayoutNodes &&
      prose.proseCharacters <= contentBudget.maxProseCharacters &&
      prose.leadCharacters <= contentBudget.maxLeadCharacters &&
      spec.components.length <= LIMITS.surfaceNodes,
  });
}

const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;

function toSafeId(raw: string, used: Set<string>): string {
  let id = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(id)) id = `n-${id}`;
  id = id.slice(0, 60).replace(/-+$/, "") || "node";
  let candidate = id;
  for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${id}-${suffix}`;
  used.add(candidate);
  return candidate;
}

/**
 * Rewrites content and layout ids that break the id pattern (for example
 * `claim_1` or `Lead`) into safe ids, updating every reference consistently.
 * Valid ids are left unchanged; anything that is not a plan object passes through.
 */
export function normalizeGenerativePlanIds(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  const plan = input as {
    content?: unknown;
    layout?: { rootId?: unknown; nodes?: unknown };
  };
  const content = Array.isArray(plan.content) ? (plan.content as unknown[]) : [];
  const nodes = Array.isArray(plan.layout?.nodes) ? (plan.layout.nodes as unknown[]) : [];
  const declared = [...content, ...nodes]
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string");
  if (declared.every((id) => SAFE_ID.test(id))) return input;

  const used = new Set(declared.filter((id) => SAFE_ID.test(id)));
  const mapping = new Map<string, string>();
  for (const id of declared) {
    if (!SAFE_ID.test(id) && !mapping.has(id)) mapping.set(id, toSafeId(id, used));
  }
  const rename = (value: unknown): unknown =>
    typeof value === "string" ? mapping.get(value) ?? value : value;
  const withId = (entry: unknown): unknown =>
    typeof entry === "object" && entry !== null
      ? { ...entry, id: rename((entry as { id?: unknown }).id) }
      : entry;

  return {
    ...plan,
    ...(Array.isArray(plan.content) ? { content: content.map(withId) } : {}),
    ...(plan.layout
      ? {
          layout: {
            ...plan.layout,
            rootId: rename(plan.layout.rootId),
            ...(Array.isArray(plan.layout.nodes)
              ? {
                  nodes: nodes.map((node) => {
                    const renamed = withId(node) as { children?: unknown };
                    return Array.isArray(renamed.children)
                      ? { ...renamed, children: (renamed.children as unknown[]).map(rename) }
                      : renamed;
                  }),
                }
              : {}),
          },
        }
      : {}),
  };
}
