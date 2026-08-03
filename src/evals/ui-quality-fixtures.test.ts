import { describe, expect, it } from "vitest";
import { lintSurfaceQuality } from "../../api/_lib/surface-quality.js";
import { validateSurfaceSpec } from "../../shared/surface-validation.js";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import {
  buildRecordedUiQualityCandidate,
  uiQualityStructuralFingerprint,
} from "./ui-quality-fixtures.js";

describe("recorded UI quality evaluation", () => {
  it.each(UI_QUALITY_CASES)("$id passes all deterministic quality checks", (testCase) => {
    const candidate = buildRecordedUiQualityCandidate(testCase);
    expect(validateSurfaceSpec(candidate.spec, candidate.sources), testCase.id).toMatchObject({
      success: true,
    });
    expect(lintSurfaceQuality(candidate), testCase.id).toEqual({
      success: true,
      checks: {
        recipe_fit: true,
        answer_first: true,
        sources_last: true,
        requested_coverage: true,
        duplicate_primary: true,
        chart_table_alignment: true,
        citation_coverage: true,
        content_budget: true,
      },
      issues: [],
    });
  });

  it("produces stable structural fingerprints without provider access", () => {
    for (const testCase of UI_QUALITY_CASES) {
      const first = uiQualityStructuralFingerprint(buildRecordedUiQualityCandidate(testCase));
      const second = uiQualityStructuralFingerprint(buildRecordedUiQualityCandidate(testCase));
      expect(first, testCase.id).toBe(second);
    }
  });
});
