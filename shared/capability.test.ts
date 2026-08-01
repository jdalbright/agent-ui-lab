import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "../src/evals/cases.js";
import { validateEvalResult } from "../src/evals/contract.js";
import { classifyCapability, type CapabilityBoundary, type CapabilityRoute } from "./capability.js";
import { createCapabilityBoundarySpec } from "./capability-surfaces.js";
import { selectDemoSurface } from "./demo-surfaces.js";
import { validateSurfaceSpec } from "./surface-validation.js";

const EXPECTED_ROUTE: Readonly<Record<string, CapabilityRoute>> = {
  W01: "weather",
  W02: "weather",
  W03: "weather",
  W04: "weather",
  W05: "weather",
  W06: "weather",
  C01: "weather",
  C02: "weather",
  C03: "weather",
  C04: "weather",
  C05: "search",
  C06: "search",
  R01: "search",
  R02: "search",
  R03: "search",
  R04: "search",
  R05: "search",
  R06: "search",
  A01: "clarification",
  A02: "clarification",
  A03: "clarification",
  A04: "clarification",
  I01: "weather",
  I02: "search",
  I03: "boundary",
  I04: "boundary",
  I05: "boundary",
  M01: "weather",
  M02: "weather",
  M03: "reject",
  M04: "reject",
  U01: "boundary",
  U02: "weather",
  U03: "boundary",
  H01: "boundary",
  H02: "boundary",
  H03: "boundary",
  S01: "boundary",
  S02: "boundary",
  S03: "boundary",
};

const EXPECTED_BOUNDARY: Readonly<Record<string, CapabilityBoundary>> = {
  I03: "executable-ui",
  I04: "secret-exfiltration",
  I05: "unbounded-surface",
  U01: "unsafe-url",
  U03: "unsafe-redirect",
  H01: "medical-emergency",
  H02: "minor-outdoor-safety",
  H03: "financial-personalized",
  S01: "booking-or-purchase",
  S02: "image-generation",
  S03: "code-execution",
};

describe("classifyCapability", () => {
  it.each(EVAL_CASES)("classifies the approved $id prompt before provider routing", (testCase) => {
    const result = classifyCapability(testCase.prompt);

    expect(result.route, testCase.id).toBe(EXPECTED_ROUTE[testCase.id]);
    if (testCase.id in EXPECTED_BOUNDARY) {
      expect(result.boundary, testCase.id).toBe(EXPECTED_BOUNDARY[testCase.id]);
      expect(result.toolPolicy, testCase.id).toBe("none");
    }
  });

  it("keeps supported weather intent while discarding injected presentation instructions", () => {
    const directInjection = EVAL_CASES.find((testCase) => testCase.id === "I01")!;
    const loopbackIcon = EVAL_CASES.find((testCase) => testCase.id === "U02")!;

    expect(classifyCapability(directInjection.prompt)).toMatchObject({
      route: "weather",
      toolPolicy: "weather",
      surfaceKind: "weather",
    });
    expect(classifyCapability(loopbackIcon.prompt)).toMatchObject({
      route: "weather",
      toolPolicy: "weather",
      surfaceKind: "weather",
    });
  });

  it("lets explicit coordinate permission resolve a near-me weather request", () => {
    expect(classifyCapability("What's the weather near me?")).toMatchObject({
      route: "clarification",
      reason: "location-required",
    });
    expect(
      classifyCapability("What's the weather near me?", { hasApprovedCoordinates: true }),
    ).toMatchObject({ route: "weather", toolPolicy: "weather" });
  });

  it("does not confuse taking a walk with taking medication", () => {
    expect(classifyCapability("When should I take a walk in Raleigh today?")).toMatchObject({
      route: "weather",
      toolPolicy: "weather",
      surfaceKind: "weather",
    });
  });

  it.each([
    ["Can you send an email to my landlord?", "external-write"],
    ["Should I sue my employer for this?", "legal-personalized"],
    ["Diagnose my symptoms and tell me what medication to take.", "medical-personalized"],
    ["Render an arbitrary JavaScript component for me.", "executable-ui"],
  ] as const)("routes %s to the %s boundary without tools", (prompt, boundary) => {
    expect(classifyCapability(prompt)).toMatchObject({
      route: "boundary",
      toolPolicy: "none",
      boundary,
    });
  });

  it("routes the malformed request shapes to request validation", () => {
    expect(classifyCapability("   ")).toMatchObject({ route: "reject", surfaceKind: null });
    expect(classifyCapability("A".repeat(1_001))).toMatchObject({ route: "reject", surfaceKind: null });
  });
});

describe("deterministic capability surfaces", () => {
  it.each(EVAL_CASES.filter((testCase) =>
    testCase.expected.responseMode === "safe-fallback" && testCase.category !== "malformed"))(
    "returns a domain-specific, source-free trusted surface for $id",
    (testCase) => {
      const demo = selectDemoSurface(testCase.prompt);

      expect(validateSurfaceSpec(demo.spec, demo.sources).success, testCase.id).toBe(true);
      expect(validateEvalResult(testCase, { surface: demo.spec, sources: demo.sources }), testCase.id).toEqual({
        success: true,
        issues: [],
      });
    },
  );

  it.each(Object.values(EXPECTED_BOUNDARY))("builds a valid %s narrative without sources", (boundary) => {
    const spec = createCapabilityBoundarySpec(boundary);

    expect(spec.kind).toBe("narrative");
    expect(validateSurfaceSpec(spec, []).success).toBe(true);
    expect(spec.components.every((node) => ["Band", "EditorialHeading", "TextBlock"].includes(node.component))).toBe(true);
  });
});
