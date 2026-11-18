import type { ChartVariant } from "./layout-tokens.js";

export interface ChartShapeInput {
  readonly variant?: ChartVariant;
  readonly labels: readonly string[];
  readonly series: readonly { readonly label: string; readonly values: readonly number[] }[];
}

/**
 * Variant-specific chart invariants shared by the plan validator and the
 * render contract. Returns human-readable issues; an empty array means valid.
 */
export function chartShapeIssues({ variant, labels, series }: ChartShapeInput): string[] {
  const issues: string[] = [];
  if (variant === "donut") {
    if (series.length !== 1) issues.push("Donut charts take exactly one series.");
    if (labels.length > 8) issues.push("Donut charts take at most eight slices.");
    const values = series[0]?.values ?? [];
    if (values.some((value) => value < 0)) issues.push("Donut chart values must be non-negative.");
    if (values.length > 0 && values.every((value) => value === 0)) {
      issues.push("Donut charts need at least one positive value.");
    }
  }
  if (variant === "range") {
    if (series.length !== 2) {
      issues.push("Range charts take exactly two series: low then high.");
    } else {
      const [low, high] = series;
      if (low.values.some((value, index) => value > (high.values[index] ?? Number.NEGATIVE_INFINITY))) {
        issues.push("Range chart low values must not exceed high values.");
      }
    }
  }
  if (variant === "stacked-bar") {
    if (series.length < 2) issues.push("Stacked bar charts need at least two series.");
    if (series.some(({ values }) => values.some((value) => value < 0))) {
      issues.push("Stacked bar chart values must be non-negative.");
    }
  }
  return issues;
}
