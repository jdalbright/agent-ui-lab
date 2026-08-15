/**
 * Parse a display-formatted number only when the entire cell is a recognized
 * numeric presentation. This deliberately does not try to recover a number
 * from arbitrary prose: chart/table alignment must fail closed.
 */
const DISPLAY_NUMBER = /^(?<sign>[+-])?\s*(?<currency>[$€£¥₹])?\s*(?<number>(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(?<unit>%|°\s*[cf](?:elsius|ahrenheit)?|usd|eur|gbp|jpy|cad|aud|points?|pts?\.?|score|degrees?|percent|mph|km\/h|km|mi|miles?|kilometers?|hours?|days?))?$/i;

/**
 * Returns the numeric value represented by a complete, display-formatted cell.
 *
 * Accepted examples include "$1,200.50", "-1,200", "82°F", and
 * "($1,200.50)". Malformed grouping, embedded prose, multiple numbers, and
 * partially numeric strings return undefined rather than being coerced.
 */
export function parseStrictFormattedNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;

  let normalized = value.trim();
  if (!normalized) return undefined;

  const accounting = normalized.startsWith("(") || normalized.endsWith(")");
  if (accounting) {
    if (!normalized.startsWith("(") || !normalized.endsWith(")")) return undefined;
    normalized = normalized.slice(1, -1).trim();
    if (!normalized) return undefined;
  }

  const match = DISPLAY_NUMBER.exec(normalized);
  if (!match?.groups) return undefined;
  if (accounting && match.groups.sign) return undefined;

  const numeric = Number(match.groups.number.replaceAll(",", ""));
  if (!Number.isFinite(numeric)) return undefined;

  const signed = match.groups.sign === "-" ? -numeric : numeric;
  return accounting ? -signed : signed;
}
