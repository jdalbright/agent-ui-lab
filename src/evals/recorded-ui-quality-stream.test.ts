import { describe, expect, it } from "vitest";
import { compileSurfacePlan } from "../../api/_lib/surface-plan.js";
import { compileSurfaceSpec } from "../../shared/compiler.js";
import { UI_QUALITY_CASES } from "./ui-quality-cases.js";
import { recordedUiQualityCompilationInput } from "./ui-quality-fixtures.js";
import { buildRecordedUiQualityStream } from "./recorded-ui-quality-stream.js";

function qualityCase(id: string) {
  const testCase = UI_QUALITY_CASES.find((candidate) => candidate.id === id);
  if (!testCase) throw new TypeError(`Unknown UI quality case ${id}.`);
  return testCase;
}

const client = {
  sizeClass: "compact" as const,
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial" as const,
  reducedMotion: true,
};

describe("recorded UI quality browser stream", () => {
  it("streams the exact SurfacePlan compilation as trusted A2UI messages", () => {
    const testCase = qualityCase("QW03");
    const request = {
      requestId: "68f8acee-1c04-4af0-84ef-09d249deaf21",
      prompt: testCase.prompt,
      client,
    };
    const recorded = recordedUiQualityCompilationInput(testCase);
    const expectedSpec = compileSurfacePlan({
      ...recorded,
      clientContext: client,
      prompt: testCase.prompt,
    });
    const expectedMessages = compileSurfaceSpec({
      surfaceId: `recorded-${request.requestId}`,
      spec: expectedSpec,
      sources: recorded.retrieval.sources,
    });

    const stream = buildRecordedUiQualityStream(testCase, request);
    const streamedMessages = stream.events.flatMap((event) =>
      event.type === "a2ui" ? [event.message] : [],
    );

    expect(stream.candidate.spec).toEqual(expectedSpec);
    expect(streamedMessages).toEqual(expectedMessages);
    expect(stream.events.at(-1)).toMatchObject({
      type: "done",
      requestId: request.requestId,
      mode: "recorded-fixture",
    });
  });

  it("rejects a prompt that does not match the recorded evidence case", () => {
    const testCase = qualityCase("QW01");
    expect(() =>
      buildRecordedUiQualityStream(testCase, {
        requestId: "68f8acee-1c04-4af0-84ef-09d249deaf21",
        prompt: "Show a different city.",
        client,
      }),
    ).toThrow(/does not match the submitted prompt/);
  });
});
