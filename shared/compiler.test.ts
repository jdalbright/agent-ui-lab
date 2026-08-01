import { describe, expect, it } from "vitest";
import { CATALOG_ID } from "./constants.js";
import { compileSurfaceSpec } from "./compiler.js";
import {
  A2uiMessageSchema,
  SourceRecordSchema,
  SurfaceSpecSchema,
  type SourceRecord,
  type SurfaceSpec,
} from "./schemas.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) deepFreeze(nestedValue);
    Object.freeze(value);
  }
  return value;
}

function validInputs(): { spec: SurfaceSpec; sources: SourceRecord[] } {
  const spec = SurfaceSpecSchema.parse({
    kind: "research",
    rootId: "research-page",
    components: [
      {
        id: "research-page",
        component: "Band",
        children: ["lead", "evidence-band"],
        tone: "plain",
        label: "Research brief",
      },
      {
        id: "lead",
        component: "ResearchLead",
        title: "A grounded answer",
        summary: "The answer is based on the cited evidence below.",
        sourceIds: ["src_abc123"],
      },
      {
        id: "evidence-band",
        component: "Band",
        children: ["evidence", "sources"],
        tone: "muted",
        label: "Evidence",
      },
      {
        id: "evidence",
        component: "EvidenceList",
        label: "Evidence",
        items: [
          {
            title: "Primary finding",
            finding: "The source directly supports the answer.",
            sourceId: "src_abc123",
          },
        ],
      },
      {
        id: "sources",
        component: "SourceList",
        label: "Sources",
        sourceIds: ["src_abc123"],
      },
    ],
  });

  const sources = SourceRecordSchema.array().parse([
    {
      id: "src_abc123",
      title: "Primary source",
      url: "https://example.com/primary-source",
      provider: "google-search",
      accessedAt: "2026-08-01T12:00:00.000Z",
      snippet: "Evidence collected from the primary source.",
    },
  ]);

  return { spec, sources };
}

describe("compileSurfaceSpec", () => {
  it("compiles validated immutable inputs into the exact ordered A2UI v0.9.1 message sequence", () => {
    const { spec, sources } = validInputs();
    const originalSpec = structuredClone(spec);
    const originalSources = structuredClone(sources);
    deepFreeze(spec);
    deepFreeze(sources);

    const messages = compileSurfaceSpec("surface-research", spec, sources);

    expect(messages).toEqual([
      {
        version: "v0.9.1",
        createSurface: {
          surfaceId: "surface-research",
          catalogId: CATALOG_ID,
          sendDataModel: false,
        },
      },
      {
        version: "v0.9.1",
        updateDataModel: {
          surfaceId: "surface-research",
          path: "/",
          value: { sources: originalSources },
        },
      },
      {
        version: "v0.9.1",
        updateComponents: {
          surfaceId: "surface-research",
          components: [
            {
              id: "root",
              component: "Band",
              children: ["lead", "evidence-band"],
              tone: "plain",
              label: "Research brief",
            },
            {
              id: "lead",
              component: "ResearchLead",
              title: "A grounded answer",
              summary: "The answer is based on the cited evidence below.",
              sourceIds: ["src_abc123"],
            },
            {
              id: "evidence-band",
              component: "Band",
              children: ["evidence", "sources"],
              tone: "muted",
              label: "Evidence",
            },
            {
              id: "evidence",
              component: "EvidenceList",
              label: "Evidence",
              items: [
                {
                  title: "Primary finding",
                  finding: "The source directly supports the answer.",
                  sourceId: "src_abc123",
                },
              ],
            },
            {
              id: "sources",
              component: "SourceList",
              label: "Sources",
              sourceIds: ["src_abc123"],
            },
          ],
        },
      },
    ]);
    expect(messages.map((message) => A2uiMessageSchema.parse(message))).toEqual(messages);
    expect(spec).toEqual(originalSpec);
    expect(sources).toEqual(originalSources);
  });

  it("rewrites the root ID without breaking any nested child reference", () => {
    const { spec, sources } = validInputs();

    const messages = compileSurfaceSpec("surface-research", deepFreeze(spec), deepFreeze(sources));
    const componentMessage = A2uiMessageSchema.parse(messages[2]);

    expect(componentMessage).toHaveProperty("updateComponents.components.0.id", "root");
    expect(componentMessage).toHaveProperty(
      "updateComponents.components.0.children",
      ["lead", "evidence-band"],
    );
    expect(componentMessage).toHaveProperty(
      "updateComponents.components.2.children",
      ["evidence", "sources"],
    );

    const serializedComponents = JSON.stringify(componentMessage);
    expect(serializedComponents).not.toContain('"research-page"');
  });

  it("places full source records only in the data-model message", () => {
    const { spec, sources } = validInputs();

    const messages = compileSurfaceSpec("surface-research", deepFreeze(spec), deepFreeze(sources));
    const sourceUrl = sources[0].url;

    expect(JSON.stringify(messages[0])).not.toContain(sourceUrl);
    expect(JSON.stringify(messages[1])).toContain(sourceUrl);
    expect(JSON.stringify(messages[2])).not.toContain(sourceUrl);
  });

  it("throws when the surface graph fails existing semantic validation", () => {
    const { spec, sources } = validInputs();
    const invalidSpec = {
      ...spec,
      components: spec.components.map((component) =>
        component.id === spec.rootId && component.component === "Band"
          ? { ...component, children: ["missing-child"] }
          : component,
      ),
    };

    expect(() => compileSurfaceSpec("surface-research", invalidSpec, sources)).toThrow();
  });

  it("throws when a source fails the existing SourceRecord schema", () => {
    const { spec, sources } = validInputs();
    const invalidSources = [{ ...sources[0], url: "http://example.com/not-https" }];

    expect(() => compileSurfaceSpec("surface-research", spec, invalidSources)).toThrow();
  });
});
