import { describe, expect, it, vi } from "vitest";
import type { ClientContext, SourceRecord, SurfaceSpec } from "../../shared/schemas.js";
import type {
  GeminiClient,
  GeminiRetrievalResult,
  GeminiStructuredOutputRequest,
} from "./gemini.js";
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

function response(output: unknown): { text: string } {
  return { text: typeof output === "string" ? output : JSON.stringify(output) };
}

function fakeClient(responses: Array<{ text: string } | Error>) {
  const requests: GeminiStructuredOutputRequest[] = [];
  const generate = vi.fn((request: GeminiStructuredOutputRequest) => {
    requests.push(request);
    const next = responses.shift();
    if (!next) throw new Error("No fake composition response remains");
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
  return {
    client: {
      interactions: { create: vi.fn() },
      structuredOutput: { generate },
    } as unknown as GeminiClient,
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

  it("uses a separate declarative schema-emission composition call", async () => {
    const { client, requests } = fakeClient([response(validSpec)]);

    const result = await composeSurfaceSpec({
      gemini: client,
      prompt: "Research Gemini 3.6 Flash.",
      clientContext,
      retrieval,
    });

    expect(result).toEqual({ spec: validSpec, repairCount: 0 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toContain("Evidence payload:");
    expect(requests[0]?.systemInstruction).toContain(
      "trusted, server-owned component catalog",
    );
    const responseSchema = requests[0]?.schema;
    expect(responseSchema).toMatchObject({
      type: "object",
      properties: {
        kind: { enum: ["research"] },
      },
      required: ["kind", "rootId", "components"],
    });
    const runtimeSchema = responseSchema as InspectableSchema;
    const runtimeNode = runtimeSchema.properties?.components?.items;
    const runtimeNames = runtimeNode?.properties?.component?.enum ?? [];
    expect(runtimeNames).toEqual([
      "Band",
      "Divider",
      "ResearchLead",
      "EvidenceList",
      "Timeline",
      "SourceList",
    ]);
    expect(runtimeNames).not.toContain("WeatherHero");
    expect(runtimeNode?.anyOf).toBeUndefined();
    expect(JSON.stringify(responseSchema).length).toBeLessThan(8_000);
    expect("tools" in (requests[0] ?? {})).toBe(false);
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
    expect(requests[1]?.input).toContain("root component");
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
      new Error("provider failed"),
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
