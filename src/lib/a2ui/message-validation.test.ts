import { describe, expect, it } from "vitest";
import { compileSurfaceSpec } from "@shared/compiler";
import { SourceRecordSchema, SurfaceSpecSchema } from "@shared/schemas";
import { parseTrustedMessages } from "./message-validation";

const sources = SourceRecordSchema.array().parse([
  {
    id: "src_abc123",
    title: "Trusted source",
    url: "https://example.com/source",
    provider: "google-search",
    accessedAt: "2026-08-01T12:00:00.000Z",
  },
]);

const spec = SurfaceSpecSchema.parse({
  kind: "narrative",
  rootId: "answer",
  components: [{ id: "answer", component: "TextBlock", text: "Trusted answer" }],
});

describe("parseTrustedMessages", () => {
  it("accepts and preserves compiler-produced messages", () => {
    const messages = compileSurfaceSpec("surface-main", spec, sources);
    expect(parseTrustedMessages(messages)).toEqual(messages);
  });

  it("rejects component names outside the trusted catalog", () => {
    const messages = structuredClone(compileSurfaceSpec("surface-main", spec, sources));
    const update = messages[2];
    if (!("updateComponents" in update)) throw new Error("Missing component update");
    update.updateComponents.components[0].component = "RawHtml";

    expect(() => parseTrustedMessages(messages)).toThrow(/trusted component/i);
  });

  it("rejects properties not declared by the component schema", () => {
    const messages = structuredClone(compileSurfaceSpec("surface-main", spec, sources));
    const update = messages[2];
    if (!("updateComponents" in update)) throw new Error("Missing component update");
    update.updateComponents.components[0].href = "https://attacker.invalid";

    expect(() => parseTrustedMessages(messages)).toThrow(/component payload/i);
  });
});
