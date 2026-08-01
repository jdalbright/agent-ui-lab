import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileSurfaceSpec } from "@shared/compiler";
import { SourceRecordSchema, SurfaceSpecSchema } from "@shared/schemas";
import { SurfaceRenderer } from "./SurfaceRenderer";

afterEach(cleanup);

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
  components: [{ id: "answer", component: "TextBlock", text: "Rendered safely" }],
});

describe("SurfaceRenderer", () => {
  it("renders compiler-produced messages through the trusted v0.9.1 processor", async () => {
    const messages = compileSurfaceSpec("surface-main", spec, sources);
    render(<SurfaceRenderer messages={messages} />);

    expect(await screen.findByText("Rendered safely")).toBeVisible();
    expect(screen.queryByText(/Unknown component:/i)).not.toBeInTheDocument();
  });

  it("shows a safe error state instead of mounting an untrusted component", async () => {
    const messages = structuredClone(compileSurfaceSpec("surface-main", spec, sources));
    const update = messages[2];
    if (!("updateComponents" in update)) throw new Error("Missing component update");
    update.updateComponents.components[0].component = "RawHtml";
    const onError = vi.fn();

    render(<SurfaceRenderer messages={messages} onError={onError} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be rendered safely/i);
    expect(screen.queryByText(/Unknown component:/i)).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledOnce();
  });
});
