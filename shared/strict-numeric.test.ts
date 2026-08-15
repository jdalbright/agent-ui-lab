import { describe, expect, it } from "vitest";
import { parseStrictFormattedNumber } from "./strict-numeric.js";

describe("parseStrictFormattedNumber", () => {
  it.each([
    ["1,200", 1200],
    ["$1,200.50", 1200.5],
    ["-$1,200.50", -1200.5],
    ["+1,200.50", 1200.5],
    ["($1,200.50)", -1200.5],
    ["82°F", 82],
    ["12.5%", 12.5],
  ])("parses a complete display value: %s", (value, expected) => {
    expect(parseStrictFormattedNumber(value)).toBe(expected);
  });

  it.each([
    "1,20",
    "1,,200",
    "1,200.5.0",
    "about $1,200",
    "$1,200 or $2,400",
    "($-1,200)",
    "(1,200",
    "1,200)",
  ])("rejects malformed or partially numeric values: %s", (value) => {
    expect(parseStrictFormattedNumber(value)).toBeUndefined();
  });
});
