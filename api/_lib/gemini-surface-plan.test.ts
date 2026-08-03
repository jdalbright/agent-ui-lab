import { describe, expect, it } from "vitest";
import type { GeminiInteraction } from "./gemini.js";
import { GeminiProviderError, structuredOutputFromInteraction } from "./gemini.js";

const readStructuredOutput = structuredOutputFromInteraction as (
  interaction: GeminiInteraction,
  functionName?: "emit_surface_spec" | "emit_surface_plan",
) => string;

describe("Gemini declarative function selection", () => {
  it("extracts emit_surface_plan only when that function was requested", () => {
    const interaction: GeminiInteraction = {
      id: "composition-plan-1",
      status: "requires_action",
      steps: [
        {
          type: "function_call",
          id: "surface-plan-1",
          name: "emit_surface_plan",
          arguments: {
            kind: "research",
            recipeId: "research.brief",
            density: "brief",
            emphasis: "answer",
            modules: [],
          },
        },
      ],
    };

    expect(
      JSON.parse(readStructuredOutput(interaction, "emit_surface_plan")) as unknown,
    ).toMatchObject({
      recipeId: "research.brief",
      density: "brief",
      emphasis: "answer",
    });
    expect(() => readStructuredOutput(interaction, "emit_surface_spec")).toThrow(
      GeminiProviderError,
    );
  });

  it("keeps the existing one-argument emit_surface_spec behavior for v1 rollback", () => {
    const interaction: GeminiInteraction = {
      id: "composition-spec-1",
      status: "requires_action",
      steps: [
        {
          type: "function_call",
          id: "surface-spec-1",
          name: "emit_surface_spec",
          arguments: { kind: "narrative", rootId: "root", components: [] },
        },
      ],
    };

    expect(JSON.parse(readStructuredOutput(interaction)) as unknown).toMatchObject({
      rootId: "root",
      components: [],
    });
  });
});
