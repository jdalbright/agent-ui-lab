import { describe, expect, it } from "vitest";
import { normalizeGenerativePlanIds } from "./generative-surface-plan.js";

describe("normalizeGenerativePlanIds", () => {
  it("rewrites unsafe ids and every reference to them consistently", () => {
    const plan = {
      version: "v3",
      content: [
        { id: "Lead_Answer", module: { type: "lead" } },
        { id: "claim_1", module: { type: "evidence" } },
        { id: "sources", module: { type: "sources" } },
      ],
      layout: {
        rootId: "Root Stack",
        nodes: [{ id: "Root Stack", type: "stack", children: ["Lead_Answer", "claim_1", "sources"] }],
      },
    };

    const result = normalizeGenerativePlanIds(plan) as typeof plan;

    expect(result.content.map((node) => node.id)).toEqual(["lead-answer", "claim-1", "sources"]);
    expect(result.layout.rootId).toBe("root-stack");
    expect(result.layout.nodes[0].id).toBe("root-stack");
    expect(result.layout.nodes[0].children).toEqual(["lead-answer", "claim-1", "sources"]);
  });

  it("avoids collisions and ids that do not start with a letter", () => {
    const plan = {
      content: [
        { id: "claim-1", module: {} },
        { id: "claim_1", module: {} },
        { id: "1st", module: {} },
      ],
      layout: { rootId: "claim-1", nodes: [] },
    };
    const result = normalizeGenerativePlanIds(plan) as typeof plan;
    expect(result.content.map((node) => node.id)).toEqual(["claim-1", "claim-1-2", "n-1st"]);
  });

  it("returns valid plans unchanged", () => {
    const plan = { content: [{ id: "lead", module: {} }], layout: { rootId: "root", nodes: [{ id: "root", children: ["lead"] }] } };
    expect(normalizeGenerativePlanIds(plan)).toBe(plan);
  });

  it("passes non-objects through", () => {
    expect(normalizeGenerativePlanIds("x")).toBe("x");
    expect(normalizeGenerativePlanIds(null)).toBeNull();
  });
});
