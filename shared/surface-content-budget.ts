export type SurfaceDensity = "brief" | "balanced" | "detailed";

export interface SurfaceContentBudget {
  readonly maxComponents: number;
  readonly maxProseCharacters: number;
  readonly maxLeadCharacters: number;
}

export interface SurfaceContentMeasurements {
  readonly componentCount: number;
  readonly proseCharacters: number;
  readonly leadCharacters: number;
}

export interface ContentBudgetSurface {
  readonly components: readonly Record<string, unknown>[];
}

export const SURFACE_CONTENT_BUDGETS = {
  brief: {
    maxComponents: 6,
    maxProseCharacters: 700,
    maxLeadCharacters: 280,
  },
  balanced: {
    maxComponents: 9,
    maxProseCharacters: 1_400,
    maxLeadCharacters: 480,
  },
  detailed: {
    maxComponents: 12,
    maxProseCharacters: 2_200,
    maxLeadCharacters: 700,
  },
} as const satisfies Readonly<Record<SurfaceDensity, SurfaceContentBudget>>;

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
  // Closed presentation tokens added with the extended toolkit are layout
  // choices, not prose. (Earlier tokens keep their historical measurement.)
  "width",
  "icon",
  "style",
  "spans",
  "side",
  "order",
  "trend",
]);

const PRIMARY_COMPONENTS = new Set([
  "WeatherHero",
  "ComparisonSummary",
  "ResearchLead",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSurfaceStructuralTextKey(key: string): boolean {
  return STRUCTURAL_TEXT_KEYS.has(key);
}

export function measureSurfaceContent(
  surface: ContentBudgetSurface,
): SurfaceContentMeasurements {
  let proseCharacters = 0;
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      proseCharacters += value.length;
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

  for (const node of surface.components) collect(node);

  const primary = surface.components.find(
    (node) => typeof node.component === "string" && PRIMARY_COMPONENTS.has(node.component),
  );
  const leadFields = [
    "title",
    "summary",
    "recommendation",
    "recommendationValue",
    "recommendationDetail",
  ];
  const leadCharacters = primary
    ? leadFields.reduce((total, field) => {
        const value = primary[field];
        return total + (typeof value === "string" ? value.length : 0);
      }, 0)
    : 0;

  return {
    componentCount: surface.components.length,
    proseCharacters,
    leadCharacters,
  };
}

export function evaluateSurfaceContentBudget(
  surface: ContentBudgetSurface,
  budget: SurfaceContentBudget,
): { readonly passed: boolean; readonly measurements: SurfaceContentMeasurements } {
  const measurements = measureSurfaceContent(surface);
  return {
    passed:
      measurements.componentCount <= budget.maxComponents &&
      measurements.proseCharacters <= budget.maxProseCharacters &&
      measurements.leadCharacters <= budget.maxLeadCharacters,
    measurements,
  };
}
