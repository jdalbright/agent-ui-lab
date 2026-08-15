import { describe, expect, it } from "vitest";
import { evaluateGenerativeSurfacePlanQuality } from "../../api/_lib/generative-surface-plan.js";
import { lintSurfaceQuality } from "../../api/_lib/surface-quality.js";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import {
  buildRecordedGenerativeUiQualityCandidate,
  type GenerativeFixtureLayoutFamily,
} from "./generative-ui-quality-fixtures.js";

const REPRESENTATIVE_CASES = ["QW01", "QC05", "QR02"] as const;
const LAYOUT_FAMILIES: readonly GenerativeFixtureLayoutFamily[] = ["stack", "grid", "section"];

describe("recorded grammar-v3 quality", () => {
  it.each(REPRESENTATIVE_CASES)(
    "accepts multiple purposeful %s compositions without an exact recipe tree",
    (caseId) => {
      const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === caseId);
      if (!testCase) throw new TypeError(`Missing UI quality case ${caseId}.`);

      for (const family of LAYOUT_FAMILIES) {
        const candidate = buildRecordedGenerativeUiQualityCandidate(testCase, family);
        const invariants = evaluateGenerativeSurfacePlanQuality(
          candidate.plan,
          {
            sources: candidate.retrieval.sources,
            evidence: candidate.retrieval.evidence,
            prompt: testCase.prompt,
            clientContext: candidate.clientContext,
          },
          candidate.spec,
        );
        const semantic = lintSurfaceQuality({
          benchmark: testCase,
          plan: candidate.plan,
          spec: candidate.spec,
          sources: candidate.retrieval.sources,
          mode: "grammar-v3",
        });

        expect(Object.values(invariants).every(Boolean), `${caseId}/${family}`).toBe(true);
        expect(semantic.success, `${caseId}/${family}: ${JSON.stringify(semantic.issues)}`).toBe(true);
      }
    },
  );
});
