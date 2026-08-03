import { describe, expect, it } from "vitest";
import { StreamEventSchema, TraceRecordSchema } from "../../shared/schemas.js";
import { createTrace } from "./trace.js";

const safePresentationMetadata = {
  recipeId: "research.claims",
  density: "detailed",
  emphasis: "evidence",
  qualityChecks: [
    { code: "answer_first", passed: true },
    { code: "citation_coverage", passed: true },
  ],
  repairCategory: "none",
  compilerResult: "compiled",
} as const;

describe("public surface-quality trace metadata", () => {
  it("carries bounded presentation choices and check outcomes through createTrace", () => {
    const trace = createTrace({
      stage: "composition",
      label: "Compose interface",
      status: "complete",
      ...safePresentationMetadata,
    });

    expect(trace).toMatchObject(safePresentationMetadata);
    expect(StreamEventSchema.parse({ type: "trace", trace })).toMatchObject({
      type: "trace",
      trace: safePresentationMetadata,
    });
  });

  it.each([
    ["recipeId", "research.private-prompt"],
    ["density", "private prompt body"],
    ["emphasis", "private evidence body"],
    ["repairCategory", "provider-thoughts"],
    ["compilerResult", "eval(privateCode)"],
  ])("rejects an unapproved %s value", (field, value) => {
    const result = TraceRecordSchema.safeParse({
      id: "trace-quality-1",
      stage: "composition",
      label: "Compose interface",
      status: "complete",
      ...safePresentationMetadata,
      [field]: value,
    });

    expect(result.success).toBe(false);
  });

  it("rejects free-form quality details that could expose prompts or evidence", () => {
    const result = TraceRecordSchema.safeParse({
      id: "trace-quality-2",
      stage: "validation",
      label: "Validate interface quality",
      status: "error",
      ...safePresentationMetadata,
      qualityChecks: [
        {
          code: "answer_first",
          passed: false,
          detail: "The private prompt and evidence body appeared here.",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
