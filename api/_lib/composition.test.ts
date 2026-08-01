import type { Interactions } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import type { ClientContext, SourceRecord, SurfaceSpec } from "../../shared/schemas.js";
import type { GeminiClient, GeminiInteraction, GeminiRetrievalResult } from "./gemini.js";
import { GeminiProviderError } from "./gemini.js";
import {
  CompositionValidationError,
  SURFACE_SPEC_JSON_SCHEMA,
  composeSurfaceSpec,
} from "./composition.js";

interface InspectableSchema {
  anyOf?: InspectableSchema[];
  enum?: string[];
  items?: InspectableSchema;
  properties?: Record<string, InspectableSchema>;
  required?: string[];
}

const clientContext: ClientContext = {
  sizeClass: "medium",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

const source: SourceRecord = {
  id: "src_a1b2c3d4",
  title: "Gemini model documentation",
  url: "https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash",
  provider: "google-search",
  accessedAt: "2026-08-01T12:34:56.000Z",
};

const validSpec: SurfaceSpec = {
  kind: "research",
  rootId: "root",
  components: [
    {
      id: "root",
      component: "Band",
      children: ["lead", "sources"],
      tone: "plain",
    },
    {
      id: "lead",
      component: "ResearchLead",
      title: "Gemini 3.6 Flash",
      summary: "Gemini 3.6 Flash is generally available.",
      sourceIds: [source.id],
    },
    {
      id: "sources",
      component: "SourceList",
      label: "Sources",
      sourceIds: [source.id],
    },
  ],
};

const retrieval: GeminiRetrievalResult = {
  outputText: "Gemini 3.6 Flash is generally available.",
  sources: Object.freeze([Object.freeze(source)]),
  steps: Object.freeze([]),
  evidence: Object.freeze([]),
  toolRounds: 0,
};

function response(output: unknown): GeminiInteraction {
  return {
    id: "composition_fixture",
    status: "completed",
    steps: [
      {
        type: "model_output",
        content: [{ type: "text", text: JSON.stringify(output) }],
      },
    ],
    output_text: typeof output === "string" ? output : JSON.stringify(output),
  };
}

function fakeClient(responses: GeminiInteraction[]) {
  const requests: Interactions.CreateModelInteractionParamsNonStreaming[] = [];
  const create = vi.fn((request: Interactions.CreateModelInteractionParamsNonStreaming) => {
    requests.push(request);
    const next = responses.shift();
    if (!next) throw new Error("No fake composition response remains");
    return Promise.resolve(next);
  });
  return {
    client: { interactions: { create } } satisfies GeminiClient,
    requests,
  };
}

describe("composeSurfaceSpec", () => {
  it("keeps optional timeline citations optional in the response schema", () => {
    const schema = SURFACE_SPEC_JSON_SCHEMA as InspectableSchema;
    const variants = schema.properties?.components?.items?.anyOf ?? [];
    const timeline = variants.find((variant) =>
      variant.properties?.component?.enum?.includes("Timeline"),
    );

    expect(timeline).toBeDefined();
    expect(timeline?.properties?.items?.items?.required).not.toContain("sourceId");
  });

  it("uses a separate stateless no-tools JSON-schema interaction", async () => {
    const { client, requests } = fakeClient([response(validSpec)]);

    const result = await composeSurfaceSpec({
      gemini: client,
      prompt: "Research Gemini 3.6 Flash.",
      clientContext,
      retrieval,
    });

    expect(result).toEqual({ spec: validSpec, repairCount: 0 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "gemini-3.6-flash",
      store: false,
      response_format: {
        type: "text",
        mime_type: "application/json",
      },
    });
    const responseFormat = requests[0]?.response_format;
    expect(Array.isArray(responseFormat)).toBe(false);
    expect(responseFormat).toMatchObject({
      type: "text",
      mime_type: "application/json",
      schema: {
        type: "object",
        required: ["kind", "rootId", "components"],
      },
    });
    expect("tools" in (requests[0] ?? {})).toBe(false);
    expect(requests[0]?.previous_interaction_id).toBeUndefined();
  });

  it("makes one bounded repair call after schema or graph validation fails", async () => {
    const invalid = {
      kind: "research",
      rootId: "missing-root",
      components: validSpec.components,
    };
    const { client, requests } = fakeClient([response(invalid), response(validSpec)]);

    const result = await composeSurfaceSpec({
      gemini: client,
      prompt: "Research Gemini 3.6 Flash.",
      clientContext,
      retrieval,
    });

    expect(result).toEqual({ spec: validSpec, repairCount: 1 });
    expect(requests).toHaveLength(2);
    expect("tools" in (requests[1] ?? {})).toBe(false);
    expect(JSON.stringify(requests[1]?.input)).toContain("root component");
  });

  it("fails after exactly one unsuccessful repair attempt", async () => {
    const invalid = { kind: "research", rootId: "missing-root", components: [] };
    const { client, requests } = fakeClient([response(invalid), response(invalid)]);

    await expect(
      composeSurfaceSpec({
        gemini: client,
        prompt: "Research Gemini 3.6 Flash.",
        clientContext,
        retrieval,
      }),
    ).rejects.toBeInstanceOf(CompositionValidationError);

    expect(requests).toHaveLength(2);
  });

  it("does not spend the repair attempt on a failed provider interaction", async () => {
    const { client, requests } = fakeClient([
      {
        id: "composition_failed",
        status: "failed",
        steps: [],
      },
    ]);

    await expect(
      composeSurfaceSpec({
        gemini: client,
        prompt: "Research Gemini 3.6 Flash.",
        clientContext,
        retrieval,
      }),
    ).rejects.toBeInstanceOf(GeminiProviderError);

    expect(requests).toHaveLength(1);
  });
});
