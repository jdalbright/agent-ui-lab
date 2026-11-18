/**
 * Closed semantic tokens shared by the render contract, the grammar-v3 plan
 * schema, and the Gemini response schema. The renderer owns every concrete
 * color, spacing, and icon drawing; models only ever choose from these lists.
 */
export const LAYOUT_GAPS = ["compact", "regular", "generous"] as const;
export const STACK_ALIGNMENTS = ["start", "center", "stretch", "end"] as const;
export const GRID_COLUMNS = ["adaptive", "two", "three", "four"] as const;
export const SPLIT_RATIOS = ["equal", "wide-start", "wide-end"] as const;
export const SURFACE_TONES = ["neutral", "accent", "caution", "positive", "info"] as const;
export const SURFACE_PROMINENCE = ["lead", "standard", "quiet"] as const;
export const SECTION_ROLES = ["primary", "supporting", "reference"] as const;
export const SECTION_WIDTHS = ["full", "narrow"] as const;
export const CARD_VARIANTS = ["outlined", "filled", "elevated"] as const;
export const DIVIDER_STYLES = ["line", "space", "ornament"] as const;
export const COLUMN_SPANS = ["third", "half", "two-thirds", "full"] as const;
export const CALLOUT_TONES = ["info", "positive", "caution"] as const;
export const BADGE_TONES = ["neutral", "accent", "positive", "caution", "info"] as const;
export const TREND_DIRECTIONS = ["up", "down", "flat"] as const;
export const RANK_ORDERS = ["desc", "asc"] as const;
export const SURFACE_ICONS = [
  "spark",
  "check",
  "alert",
  "info",
  "clock",
  "trend-up",
  "trend-down",
  "pin",
  "star",
  "scale",
  "book",
  "sun",
] as const;

export const CHART_VARIANTS = ["line", "bar", "area", "stacked-bar", "donut", "range"] as const;
/** Weather-backed charts are server-built from evidence indexes. */
export const WEATHER_CHART_VARIANTS = ["line", "bar", "area", "range"] as const;

export type SurfaceTone = (typeof SURFACE_TONES)[number];
export type SurfaceIcon = (typeof SURFACE_ICONS)[number];
export type ColumnSpan = (typeof COLUMN_SPANS)[number];
export type ChartVariant = (typeof CHART_VARIANTS)[number];
