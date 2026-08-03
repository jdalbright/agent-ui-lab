import "@testing-library/jest-dom/vitest";

import { A2uiSurface } from "@a2ui/react/v0_9";
import {
  MessageProcessor,
  type A2uiMessage as ProtocolMessage,
} from "@a2ui/web_core/v0_9";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import {
  A2UI_VERSION,
  CATALOG_ID,
  TRUSTED_COMPONENT_NAMES,
} from "@shared/constants";
import { A2uiMessageSchema, SourceRecordSchema } from "@shared/schemas";
import * as schemas from "@shared/schemas";
import { trustedCatalog } from "./catalog";

afterEach(cleanup);

const RECIPE_IDS = [
  "weather.snapshot",
  "weather.decision",
  "weather.outlook",
  "comparison.verdict",
  "comparison.scorecard",
  "comparison.trend",
  "research.brief",
  "research.timeline",
  "research.claims",
] as const;

const DENSITIES = ["brief", "balanced", "detailed"] as const;
const EMPHASES = ["answer", "decision", "trend", "evidence", "risk"] as const;

const trustedSource = SourceRecordSchema.parse({
  id: "src_abc123",
  title: "Trusted research source",
  url: "https://example.com/research",
  provider: "google-search",
  accessedAt: "2026-08-01T12:00:00.000Z",
});

function requiredSchema(name: string): ZodTypeAny {
  const candidate = (schemas as Record<string, unknown>)[name];
  expect(candidate, `${name} must be exported as a trusted schema`).toBeDefined();
  if (!candidate) throw new Error(`${name} is not implemented`);
  return candidate as ZodTypeAny;
}

function renderTrustedSurface(components: readonly Record<string, unknown>[]) {
  const surfaceId = `surface-${components[0]?.component as string}`;
  const messages = [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId: CATALOG_ID, sendDataModel: false },
    },
    {
      version: A2UI_VERSION,
      updateDataModel: { surfaceId, path: "/", value: { sources: [trustedSource] } },
    },
    {
      version: A2UI_VERSION,
      updateComponents: { surfaceId, components },
    },
  ].map((message) => A2uiMessageSchema.parse(message)) as ProtocolMessage[];

  const processor = new MessageProcessor([trustedCatalog], undefined, {
    version: A2UI_VERSION,
  });
  processor.processMessages(messages);
  const surface = processor.model.getSurface(surfaceId);
  expect(surface).toBeDefined();
  if (!surface) throw new Error(`Surface ${surfaceId} was not created`);

  return render(<A2uiSurface surface={surface} />);
}

const surfaceFrameNode = {
  id: "root",
  component: "SurfaceFrame",
  children: ["answer"],
  recipeId: "weather.decision",
  density: "balanced",
  emphasis: "decision",
} as const;

describe("SurfaceFrame trusted contract", () => {
  it("registers SurfaceFrame in the v2 trusted catalog", () => {
    expect(CATALOG_ID).toBe("https://lab.jalbright.dev/catalogs/editorial/v2");
    expect(TRUSTED_COMPONENT_NAMES).toContain("SurfaceFrame");
    expect(trustedCatalog.components.has("SurfaceFrame")).toBe(true);
  });

  it("renders trusted children and exposes only semantic presentation markers", () => {
    renderTrustedSurface([
      surfaceFrameNode,
      {
        id: "answer",
        component: "TextBlock",
        text: "The evening is the best time for a walk.",
        tone: "default",
      },
    ]);

    const answer = screen.getByText("The evening is the best time for a walk.");
    const frame = answer.closest("[data-recipe]");
    expect(frame).toHaveAttribute("data-recipe", "weather.decision");
    expect(frame).toHaveAttribute("data-density", "balanced");
    expect(frame).toHaveAttribute("data-emphasis", "decision");
    expect(frame).not.toHaveAttribute("style");
    expect(screen.queryByText(/Unknown component:/i)).not.toBeInTheDocument();
  });

  it.each(RECIPE_IDS)("accepts the approved %s recipe enum", (recipeId) => {
    const schema = requiredSchema("SurfaceFrameNodeSchema");
    expect(schema.safeParse({ ...surfaceFrameNode, recipeId }).success).toBe(true);
  });

  it.each(DENSITIES)("accepts the approved %s density enum", (density) => {
    const schema = requiredSchema("SurfaceFrameNodeSchema");
    expect(schema.safeParse({ ...surfaceFrameNode, density }).success).toBe(true);
  });

  it.each(EMPHASES)("accepts the approved %s emphasis enum", (emphasis) => {
    const schema = requiredSchema("SurfaceFrameNodeSchema");
    expect(schema.safeParse({ ...surfaceFrameNode, emphasis }).success).toBe(true);
  });

  it.each([
    ["recipeId", "weather.freeform"],
    ["density", "immersive"],
    ["emphasis", "decorative"],
    ["style", "background: red"],
    ["className", "arbitrary-class"],
    ["html", "<script>alert(1)</script>"],
  ] as const)("rejects the untrusted %s value", (field, value) => {
    const schema = requiredSchema("SurfaceFrameNodeSchema");
    expect(schema.safeParse(surfaceFrameNode).success).toBe(true);
    expect(schema.safeParse({ ...surfaceFrameNode, [field]: value }).success).toBe(false);
  });
});

const variantCases = [
  {
    schemaName: "WeatherHeroNodeSchema",
    component: "WeatherHero",
    variants: ["snapshot", "decision"],
    node: {
      id: "root",
      component: "WeatherHero",
      location: "Raleigh, NC",
      dateLabel: "Saturday, August 1",
      temperature: 72,
      unit: "F",
      condition: "Partly cloudy",
      conditionKey: "partly-cloudy",
      recommendationLabel: "Best window",
      recommendationValue: "Late afternoon",
      recommendationDetail: "Lower rain risk after 4 PM.",
    },
  },
  {
    schemaName: "HourlyForecastNodeSchema",
    component: "HourlyForecast",
    variants: ["strip", "chart"],
    node: {
      id: "root",
      component: "HourlyForecast",
      label: "Hourly comfort",
      unit: "F",
      items: [
        { time: "2 PM", temperature: 72, precipitationProbability: 10, condition: "clear" },
        { time: "3 PM", temperature: 74, precipitationProbability: 20, condition: "partly-cloudy" },
      ],
    },
  },
  {
    schemaName: "DailyForecastNodeSchema",
    component: "DailyForecast",
    variants: ["cards", "table"],
    node: {
      id: "root",
      component: "DailyForecast",
      label: "Weekend outlook",
      unit: "F",
      items: [
        { date: "Saturday", high: 78, low: 61, precipitationProbability: 20, condition: "clear" },
      ],
    },
  },
  {
    schemaName: "ComparisonSummaryNodeSchema",
    component: "ComparisonSummary",
    variants: ["verdict", "balanced"],
    node: {
      id: "root",
      component: "ComparisonSummary",
      title: "Weekend weather",
      recommendation: "Raleigh is the drier choice.",
      items: [
        { label: "Raleigh", value: "20% rain", recommended: true },
        { label: "Asheville", value: "45% rain" },
      ],
    },
  },
  {
    schemaName: "ComparisonChartNodeSchema",
    component: "ComparisonChart",
    variants: ["line", "bar"],
    node: {
      id: "root",
      component: "ComparisonChart",
      title: "Temperature trend",
      labels: ["Saturday", "Sunday"],
      series: [
        { label: "Raleigh", values: [78, 80] },
        { label: "Asheville", values: [72, 74] },
      ],
      unit: "°F",
    },
  },
  {
    schemaName: "ResearchLeadNodeSchema",
    component: "ResearchLead",
    variants: ["feature", "brief"],
    node: {
      id: "root",
      component: "ResearchLead",
      title: "What changed",
      summary: "The release prioritizes speed and tool use.",
      sourceIds: [trustedSource.id],
    },
  },
  {
    schemaName: "EvidenceListNodeSchema",
    component: "EvidenceList",
    variants: ["stack", "grid", "for-against"],
    node: {
      id: "root",
      component: "EvidenceList",
      label: "Key evidence",
      items: [
        {
          title: "Official release notes",
          finding: "The update improves tool use.",
          sourceId: trustedSource.id,
          stance: "support",
        },
      ],
    },
  },
] as const;

describe("semantic component variants", () => {
  for (const variantCase of variantCases) {
    it.each(variantCase.variants)(
      `${variantCase.component} accepts and renders its %s variant`,
      (variant) => {
        const schema = requiredSchema(variantCase.schemaName);
        expect(schema.safeParse({ ...variantCase.node, variant }).success).toBe(true);

        renderTrustedSurface([{ ...variantCase.node, variant }]);
        expect(document.querySelector(`[data-variant="${variant}"]`)).toBeInTheDocument();
        expect(screen.queryByText(/Unknown component:/i)).not.toBeInTheDocument();
      },
    );

    it(`${variantCase.component} rejects arbitrary presentation variants`, () => {
      const schema = requiredSchema(variantCase.schemaName);
      expect(
        schema.safeParse({ ...variantCase.node, variant: variantCase.variants[0] }).success,
      ).toBe(true);
      expect(schema.safeParse({ ...variantCase.node, variant: "freeform" }).success).toBe(false);
    });
  }

  it.each(["support", "challenge", "neutral"] as const)(
    "accepts and renders the approved %s evidence stance",
    (stance) => {
      const schema = requiredSchema("EvidenceListNodeSchema");
      const node = {
        ...variantCases[6].node,
        variant: "for-against",
        items: [{ ...variantCases[6].node.items[0], stance }],
      };
      expect(schema.safeParse(node).success).toBe(true);

      renderTrustedSurface([node]);
      expect(document.querySelector(`[data-stance="${stance}"]`)).toBeInTheDocument();
    },
  );

  it("rejects an arbitrary evidence stance after accepting an approved stance", () => {
    const schema = requiredSchema("EvidenceListNodeSchema");
    const approved = {
      ...variantCases[6].node,
      variant: "for-against",
    };
    expect(schema.safeParse(approved).success).toBe(true);
    expect(
      schema.safeParse({
        ...approved,
        items: [{ ...approved.items[0], stance: "promotional" }],
      }).success,
    ).toBe(false);
  });
});
