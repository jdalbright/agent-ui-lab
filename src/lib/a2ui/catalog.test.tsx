import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { A2uiSurface } from "@a2ui/react/v0_9";
import {
  MessageProcessor,
  type A2uiMessage as ProtocolMessage,
} from "@a2ui/web_core/v0_9";
import { afterEach, describe, expect, it } from "vitest";

import {
  A2UI_VERSION,
  CATALOG_ID,
  TRUSTED_COMPONENT_NAMES,
  type TrustedComponentName,
} from "@shared/constants";
import {
  A2uiMessageSchema,
  SourceRecordSchema,
  SurfaceSpecSchema,
  type SourceRecord,
} from "@shared/schemas";
import { validateSurfaceSpec } from "@shared/surface-validation";
import { trustedCatalog } from "./catalog";

afterEach(cleanup);

const trustedSource = SourceRecordSchema.parse({
  id: "src_abc123",
  title: "National Weather Service outlook",
  url: "https://weather.gov/example/outlook",
  provider: "google-search",
  accessedAt: "2026-08-01T12:00:00.000Z",
  snippet: "A validated source record used by the rendered surface.",
});

type RepresentativeCase = {
  name: TrustedComponentName;
  root: Record<string, unknown>;
  children?: Record<string, unknown>[];
  visibleText: RegExp;
};

const representativeCases: RepresentativeCase[] = [
  {
    name: "EditorialHeading",
    root: { id: "root", component: "EditorialHeading", text: "Editorial outlook", level: "h1" },
    visibleText: /Editorial outlook/i,
  },
  {
    name: "TextBlock",
    root: { id: "root", component: "TextBlock", text: "A concise explanation", tone: "muted" },
    visibleText: /A concise explanation/i,
  },
  {
    name: "Metric",
    root: {
      id: "root",
      component: "Metric",
      label: "Afternoon high",
      value: "72 F",
      detail: "Comfortable outside",
      accent: "blue",
    },
    visibleText: /Afternoon high/i,
  },
  {
    name: "Band",
    root: { id: "root", component: "Band", children: ["child-a"], tone: "sky", label: "Forecast band" },
    children: [{ id: "child-a", component: "TextBlock", text: "Band child content" }],
    visibleText: /Band child content/i,
  },
  {
    name: "Split",
    root: { id: "root", component: "Split", children: ["child-a", "child-b"], ratio: "equal" },
    children: [
      { id: "child-a", component: "TextBlock", text: "Split first pane" },
      { id: "child-b", component: "TextBlock", text: "Split second pane" },
    ],
    visibleText: /Split first pane/i,
  },
  {
    name: "Rail",
    root: { id: "root", component: "Rail", children: ["child-a"], label: "Highlights" },
    children: [{ id: "child-a", component: "TextBlock", text: "Rail card content" }],
    visibleText: /Rail card content/i,
  },
  {
    name: "Divider",
    root: { id: "root", component: "Divider", label: "Next section" },
    visibleText: /Next section/i,
  },
  {
    name: "WeatherHero",
    root: {
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
    visibleText: /Raleigh, NC/i,
  },
  {
    name: "RecommendationBand",
    root: {
      id: "root",
      component: "RecommendationBand",
      label: "Recommendation",
      value: "Choose the shaded route",
      detail: "It stays cooler during the afternoon.",
      confidence: "high",
    },
    visibleText: /Choose the shaded route/i,
  },
  {
    name: "HourlyForecast",
    root: {
      id: "root",
      component: "HourlyForecast",
      label: "Hourly comfort",
      unit: "F",
      items: [
        { time: "2 PM", temperature: 72, precipitationProbability: 10, condition: "clear" },
        { time: "3 PM", temperature: 74, precipitationProbability: 20, condition: "partly-cloudy" },
      ],
    },
    visibleText: /Hourly comfort/i,
  },
  {
    name: "DailyForecast",
    root: {
      id: "root",
      component: "DailyForecast",
      label: "Three-day outlook",
      unit: "F",
      items: [{ date: "Saturday", high: 78, low: 61, precipitationProbability: 20, condition: "clear" }],
    },
    visibleText: /Three-day outlook/i,
  },
  {
    name: "WeatherAlert",
    root: {
      id: "root",
      component: "WeatherAlert",
      title: "Heat advisory",
      severity: "moderate",
      description: "Take breaks and carry water.",
      sourceId: trustedSource.id,
    },
    visibleText: /Heat advisory/i,
  },
  {
    name: "LocationPrompt",
    root: {
      id: "root",
      component: "LocationPrompt",
      message: "Which Raleigh did you mean?",
      suggestions: ["Raleigh, North Carolina", "Raleigh, Mississippi"],
    },
    visibleText: /Which Raleigh did you mean/i,
  },
  {
    name: "ComparisonSummary",
    root: {
      id: "root",
      component: "ComparisonSummary",
      title: "Route comparison",
      recommendation: "Route A is the stronger choice.",
      items: [
        { label: "Route A", value: "25 minutes", recommended: true },
        { label: "Route B", value: "33 minutes", detail: "More traffic" },
      ],
    },
    visibleText: /Route comparison/i,
  },
  {
    name: "ComparisonTable",
    root: {
      id: "root",
      component: "ComparisonTable",
      caption: "Plan comparison",
      columns: ["Plan", "Price"],
      rows: [["Starter", "$12"]],
    },
    visibleText: /Plan comparison/i,
  },
  {
    name: "ComparisonChart",
    root: {
      id: "root",
      component: "ComparisonChart",
      title: "Quarterly revenue comparison",
      labels: ["Q1", "Q2"],
      series: [{ label: "North", values: [12, 18] }],
      unit: "$M",
    },
    visibleText: /Quarterly revenue comparison/i,
  },
  {
    name: "ResearchLead",
    root: {
      id: "root",
      component: "ResearchLead",
      title: "What the evidence shows",
      summary: "The primary sources agree on the broad trend.",
      sourceIds: [trustedSource.id],
    },
    visibleText: /What the evidence shows/i,
  },
  {
    name: "EvidenceList",
    root: {
      id: "root",
      component: "EvidenceList",
      label: "Key evidence",
      items: [{ title: "Forecast update", finding: "Rain chances fell overnight.", sourceId: trustedSource.id }],
    },
    visibleText: /Key evidence/i,
  },
  {
    name: "Timeline",
    root: {
      id: "root",
      component: "Timeline",
      label: "Decision timeline",
      items: [
        {
          date: "August 1",
          title: "Forecast refreshed",
          detail: "The latest outlook was published.",
          sourceId: trustedSource.id,
        },
      ],
    },
    visibleText: /Decision timeline/i,
  },
  {
    name: "SourceList",
    root: { id: "root", component: "SourceList", label: "Verified sources", sourceIds: [trustedSource.id] },
    visibleText: /Verified sources/i,
  },
];

function renderRepresentativeSurface(
  root: Record<string, unknown>,
  children: Record<string, unknown>[] = [],
  sources: SourceRecord[] = [trustedSource],
) {
  const spec = SurfaceSpecSchema.parse({
    kind: "narrative",
    rootId: "root",
    components: [root, ...children],
  });
  const validation = validateSurfaceSpec(spec, sources);
  expect(validation).toMatchObject({ success: true });
  if (!validation.success) throw new Error(validation.issues.join("\n"));

  const surfaceId = `test-${root.component as string}`;
  const messages = [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId: CATALOG_ID, sendDataModel: false },
    },
    {
      version: A2UI_VERSION,
      updateComponents: { surfaceId, components: validation.spec.components },
    },
    {
      version: A2UI_VERSION,
      updateDataModel: { surfaceId, path: "/", value: { sources: validation.sources } },
    },
  ].map((message) => A2uiMessageSchema.parse(message)) as ProtocolMessage[];

  const processor = new MessageProcessor([trustedCatalog], undefined, { version: A2UI_VERSION });
  processor.processMessages(messages);
  const surface = processor.model.getSurface(surfaceId);
  expect(surface).toBeDefined();
  if (!surface) throw new Error(`Surface ${surfaceId} was not created.`);

  return render(<A2uiSurface surface={surface} />);
}

describe("trustedCatalog", () => {
  it("registers exactly the trusted component allowlist under the immutable catalog ID", () => {
    expect(trustedCatalog.id).toBe(CATALOG_ID);
    expect([...trustedCatalog.components.keys()].sort()).toEqual([...TRUSTED_COMPONENT_NAMES].sort());
    expect(trustedCatalog.components.size).toBe(TRUSTED_COMPONENT_NAMES.length);
  });

  it.each(representativeCases)(
    "renders a schema-validated $name payload through the v0.9.1 processor",
    ({ root, children, visibleText }) => {
      renderRepresentativeSurface(root, children);

      expect(screen.getByText(visibleText)).toBeVisible();
      expect(screen.queryByText(/Unknown component:/i)).not.toBeInTheDocument();
    },
  );

  it("gives ComparisonChart an accessible graphic and a visible tabular equivalent", () => {
    const chartCase = representativeCases.find(({ name }) => name === "ComparisonChart");
    if (!chartCase) throw new Error("ComparisonChart fixture is missing.");
    renderRepresentativeSurface(chartCase.root);

    expect(screen.getByRole("img", { name: /Quarterly revenue comparison/i })).toBeVisible();

    const table = screen.getByRole("table", { name: /Quarterly revenue comparison/i });
    expect(table).toBeVisible();
    expect(within(table).getByRole("columnheader", { name: "Q1" })).toBeVisible();
    expect(within(table).getByRole("rowheader", { name: "North" })).toBeVisible();
    expect(within(table).getByText("12")).toBeVisible();
    expect(within(table).getByText("18")).toBeVisible();
  });

  it("renders SourceList from validated source records without accepting mutable agent-authored links", () => {
    const sourceCase = representativeCases.find(({ name }) => name === "SourceList");
    if (!sourceCase) throw new Error("SourceList fixture is missing.");
    renderRepresentativeSurface(sourceCase.root, [], [trustedSource]);

    expect(screen.getByText(trustedSource.title)).toBeVisible();
    expect(screen.getByText(/google-search/i)).toBeVisible();
    expect(screen.getByText(/Aug(?:ust)? 1, 2026/i)).toBeVisible();

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", trustedSource.url);
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0].getAttribute("rel")?.split(/\s+/)).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
  });
});
