import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { A2uiSurface } from "@a2ui/react/v0_9";
import { MessageProcessor, type A2uiMessage as ProtocolMessage } from "@a2ui/web_core/v0_9";
import { afterEach, describe, expect, it } from "vitest";

import { A2UI_VERSION, CATALOG_ID_V3 } from "@shared/constants";
import { A2uiMessageSchema, SourceRecordSchema, SurfaceSpecSchema } from "@shared/schemas";
import { validateSurfaceSpec } from "@shared/surface-validation";
import { trustedCatalogV3 } from "./catalog";

afterEach(cleanup);

const source = SourceRecordSchema.parse({
  id: "src_abc123",
  title: "Official release notes",
  url: "https://example.com/releases/current",
  provider: "google-search",
  accessedAt: "2026-08-01T12:00:00.000Z",
  snippet: "A validated source record.",
});

function renderSurface(root: Record<string, unknown>, children: Record<string, unknown>[] = []) {
  const spec = SurfaceSpecSchema.parse({ kind: "narrative", rootId: "root", components: [root, ...children] });
  const validation = validateSurfaceSpec(spec, [source]);
  if (!validation.success) throw new Error(validation.issues.join("\n"));
  const surfaceId = `toolkit-${root.component as string}`;
  const messages = [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: CATALOG_ID_V3, sendDataModel: false } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components: validation.spec.components } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: "/", value: { sources: validation.sources } } },
  ].map((message) => A2uiMessageSchema.parse(message)) as ProtocolMessage[];
  const processor = new MessageProcessor([trustedCatalogV3], undefined, { version: A2UI_VERSION });
  processor.processMessages(messages);
  const surface = processor.model.getSurface(surfaceId);
  if (!surface) throw new Error("Surface was not created.");
  return render(<A2uiSurface surface={surface} />);
}

const text = (id: string, value: string) => ({ id, component: "TextBlock", text: value });

describe("extended toolkit components", () => {
  it.each([
    [
      "KeyFacts",
      {
        id: "root",
        component: "KeyFacts",
        label: "At a glance",
        facts: [
          { label: "Build time", value: "Faster", trend: "up", sparkline: [1, 2, 4] },
          { label: "Memory", value: "Higher", trend: "down" },
        ],
        sourceIds: [source.id],
      },
      /At a glance/,
    ],
    [
      "Callout",
      { id: "root", component: "Callout", tone: "caution", title: "Check headroom", body: "Memory use is higher.", sourceIds: [source.id] },
      /Check headroom/,
    ],
    [
      "ProsCons",
      {
        id: "root",
        component: "ProsCons",
        subject: "Upgrade trade-offs",
        pros: [{ text: "Faster builds", sourceId: source.id }],
        cons: [{ text: "More memory", sourceId: source.id }],
      },
      /Upgrade trade-offs/,
    ],
    [
      "RankedList",
      {
        id: "root",
        component: "RankedList",
        label: "Top picks",
        order: "desc",
        items: [
          { title: "Option A", detail: "Best overall", score: "9/10", sourceId: source.id },
          { title: "Option B", detail: "Runner-up", sourceId: source.id },
        ],
      },
      /Top picks/,
    ],
    [
      "PullQuote",
      { id: "root", component: "PullQuote", text: "The release is stable.", attribution: "Release notes", sourceId: source.id },
      /The release is stable/,
    ],
    [
      "BadgeRow",
      { id: "root", component: "BadgeRow", badges: [{ label: "Stable", tone: "positive" }], sourceIds: [source.id] },
      /Stable/,
    ],
  ])("renders %s with trusted citations", (_, root, visible) => {
    renderSurface(root);
    expect(screen.getByText(visible)).toBeVisible();
    expect(screen.getAllByRole("link", { name: /Official release notes/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Unknown component:/i)).not.toBeInTheDocument();
  });

  it("exposes ScoreMeter values through the meter role", () => {
    renderSurface({
      id: "root",
      component: "ScoreMeter",
      meters: [{ label: "Stability", value: 8, min: 0, max: 10 }],
      sourceIds: [source.id],
    });
    const meter = screen.getByRole("meter", { name: "Stability" });
    expect(meter).toHaveAttribute("aria-valuenow", "8");
    expect(meter).toHaveAttribute("aria-valuemax", "10");
  });

  it("toggles accordion panels with pointer and moves focus with arrow keys", async () => {
    const user = userEvent.setup();
    renderSurface(
      { id: "root", component: "Accordion", children: ["a", "b"], labels: ["First", "Second"], defaultOpenIndex: 0 },
      [text("a", "First panel"), text("b", "Second panel")],
    );
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("First panel")).toBeVisible();
    expect(second).toHaveAttribute("aria-expanded", "false");

    await user.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Second panel")).toBeVisible();

    await user.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();
    await user.keyboard("{End}");
    expect(second).toHaveFocus();
  });

  it("renders a labeled, focusable scroller region and spanned columns", () => {
    renderSurface(
      { id: "root", component: "Stack", children: ["scroller", "columns"], gap: "regular", align: "stretch" },
      [
        { id: "scroller", component: "Scroller", children: ["a", "b"], label: "Highlights" },
        { id: "columns", component: "Columns", children: ["c", "d"], spans: ["two-thirds", "third"], gap: "compact" },
        text("a", "Scroll one"),
        text("b", "Scroll two"),
        text("c", "Wide column"),
        text("d", "Narrow column"),
      ],
    );
    const region = screen.getByRole("region", { name: "Highlights" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByText("Scroll two")).toBeVisible();
    expect(screen.getByText("Wide column").closest(".a2ui-columns__item--two-thirds")).not.toBeNull();
  });

  it("keeps aside main content first in DOM order and styles cards with tokens", () => {
    const { container } = renderSurface(
      { id: "root", component: "Aside", children: ["main", "card"], side: "start", label: "Notes" },
      [
        text("main", "Main answer"),
        { id: "card", component: "Card", children: ["c"], tone: "positive", prominence: "quiet", variant: "filled", icon: "check", label: "Good news" },
        text("c", "Card body"),
      ],
    );
    const textNodes = [...container.querySelectorAll(".a2ui-text")].map((node) => node.textContent);
    expect(textNodes).toEqual(["Main answer", "Card body"]);
    expect(screen.getByRole("complementary", { name: "Notes" })).toBeVisible();
    const card = container.querySelector(".a2ui-card");
    expect(card).toHaveClass("a2ui-card--tone-positive", "a2ui-card--filled");
    expect(card?.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  it.each(["area", "stacked-bar", "donut", "range"] as const)(
    "renders a %s chart with its tabular equivalent",
    (variant) => {
      const series =
        variant === "donut"
          ? [{ label: "Share", values: [60, 40] }]
          : variant === "range"
            ? [{ label: "Low", values: [1, 2] }, { label: "High", values: [3, 5] }]
            : [{ label: "A", values: [1, 2] }, { label: "B", values: [2, 3] }];
      const { container } = renderSurface({
        id: "root",
        component: "ComparisonChart",
        title: "Variant chart",
        labels: ["One", "Two"],
        series,
        variant,
      });
      expect(screen.getByRole("img", { name: "Variant chart" })).toBeVisible();
      expect(screen.getByRole("table", { name: /Variant chart data/ })).toBeVisible();
      expect(container.querySelector(`.a2ui-chart--${variant}`)).not.toBeNull();
    },
  );

  it("rejects chart shapes that violate variant invariants", () => {
    const parse = SurfaceSpecSchema.safeParse({
      kind: "narrative",
      rootId: "root",
      components: [
        { id: "root", component: "ComparisonChart", title: "Bad", labels: ["A", "B"], series: [{ label: "S", values: [1, -1] }], variant: "donut" },
      ],
    });
    expect(parse.success).toBe(false);
  });
});
