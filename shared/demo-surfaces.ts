import { classifyCapability, type CapabilityDecision } from "./capability.js";
import { createCapabilityBoundarySpec, createClarificationSpec } from "./capability-surfaces.js";
import type { SourceRecord, SurfaceSpec } from "./schemas.js";

const ACCESSED_AT = "2026-08-01T14:42:00.000Z";

const weatherSource: SourceRecord = {
  id: "src_googleweather",
  title: "Google Weather API",
  url: "https://developers.google.com/maps/documentation/weather",
  provider: "google-weather",
  accessedAt: ACCESSED_AT,
  snippet: "Recorded provider fixture for the portfolio demonstration.",
};

const modelSource: SourceRecord = {
  id: "src_gemini36",
  title: "Gemini 3.6 Flash model documentation",
  url: "https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Official model card for Gemini 3.6 Flash.",
};

const a2uiSource: SourceRecord = {
  id: "src_a2ui091",
  title: "A2UI v0.9.1 protocol",
  url: "https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/docs/a2ui_protocol.md",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "The versioned declarative UI protocol used by this lab.",
};

const hourly = [
  ["Now", 83, 10, "partly-cloudy"],
  ["12 PM", 84, 10, "partly-cloudy"],
  ["1 PM", 85, 10, "partly-cloudy"],
  ["2 PM", 86, 10, "partly-cloudy"],
  ["3 PM", 87, 10, "partly-cloudy"],
  ["4 PM", 87, 10, "partly-cloudy"],
  ["5 PM", 86, 10, "partly-cloudy"],
  ["6 PM", 84, 10, "partly-cloudy"],
  ["7 PM", 81, 10, "partly-cloudy"],
  ["8 PM", 78, 10, "partly-cloudy"],
  ["9 PM", 74, 10, "clear"],
  ["10 PM", 71, 10, "clear"],
] satisfies Array<[string, number, number, "partly-cloudy" | "clear"]>;

export const weatherDemoSpec: SurfaceSpec = {
  kind: "weather",
  rootId: "weather-root",
  components: [
    {
      id: "weather-root",
      component: "Band",
      tone: "plain",
      children: ["weather-hero", "hourly-forecast", "daily-forecast", "weather-sources"],
    },
    {
      id: "weather-hero",
      component: "WeatherHero",
      location: "Raleigh, NC",
      dateLabel: "Saturday, August 1",
      temperature: 83,
      unit: "F",
      condition: "Partly cloudy",
      conditionKey: "partly-cloudy",
      recommendationLabel: "Best walk window",
      recommendationValue: "7:30–8:30 PM",
      recommendationDetail: "Warm now, cooler after sunset with a low chance of rain.",
    },
    {
      id: "hourly-forecast",
      component: "HourlyForecast",
      label: "Hourly",
      unit: "F",
      items: hourly.map(([time, temperature, precipitationProbability, condition]) => ({
        time,
        temperature,
        precipitationProbability,
        condition,
      })),
    },
    {
      id: "daily-forecast",
      component: "DailyForecast",
      label: "5-day outlook",
      unit: "F",
      items: [
        { date: "Sun, Aug 2", high: 88, low: 70, precipitationProbability: 20, condition: "partly-cloudy" },
        { date: "Mon, Aug 3", high: 89, low: 71, precipitationProbability: 10, condition: "clear" },
        { date: "Tue, Aug 4", high: 86, low: 69, precipitationProbability: 40, condition: "rain" },
        { date: "Wed, Aug 5", high: 85, low: 68, precipitationProbability: 20, condition: "partly-cloudy" },
        { date: "Thu, Aug 6", high: 87, low: 69, precipitationProbability: 10, condition: "clear" },
      ],
    },
    {
      id: "weather-sources",
      component: "SourceList",
      label: "Weather data · Updated 10:42 AM",
      sourceIds: [weatherSource.id],
    },
  ],
};

export const comparisonDemoSpec: SurfaceSpec = {
  kind: "comparison",
  rootId: "comparison-root",
  components: [
    {
      id: "comparison-root",
      component: "Band",
      tone: "plain",
      children: [
        "comparison-heading",
        "comparison-summary",
        "comparison-table",
        "comparison-chart",
        "comparison-sources",
      ],
    },
    {
      id: "comparison-heading",
      component: "EditorialHeading",
      text: "Raleigh or Asheville this weekend?",
      level: "h1",
      align: "start",
    },
    {
      id: "comparison-summary",
      component: "ComparisonSummary",
      title: "Asheville is the cooler outdoor pick",
      recommendation:
        "Choose Asheville for a milder afternoon. Raleigh is warmer but has the drier Sunday window.",
      items: [
        { label: "Raleigh", value: "87° average high", detail: "20% peak rain chance", recommended: false },
        { label: "Asheville", value: "79° average high", detail: "30% peak rain chance", recommended: true },
      ],
    },
    {
      id: "comparison-table",
      component: "ComparisonTable",
      caption: "Weekend conditions",
      columns: ["City", "Saturday", "Sunday", "Best window"],
      rows: [
        ["Raleigh", "88° / 70°", "86° / 69°", "Sunday morning"],
        ["Asheville", "80° / 62°", "78° / 61°", "Saturday evening"],
      ],
    },
    {
      id: "comparison-chart",
      component: "ComparisonChart",
      title: "Hourly temperature comparison",
      labels: ["10 AM", "1 PM", "4 PM", "7 PM"],
      series: [
        { label: "Raleigh", values: [79, 85, 88, 82] },
        { label: "Asheville", values: [70, 77, 80, 74] },
      ],
      unit: "°F",
    },
    {
      id: "comparison-sources",
      component: "SourceList",
      label: "Sources",
      sourceIds: [weatherSource.id],
    },
  ],
};

export const researchComparisonDemoSpec: SurfaceSpec = {
  kind: "comparison",
  rootId: "research-comparison-root",
  components: [
    {
      id: "research-comparison-root",
      component: "Band",
      tone: "plain",
      children: [
        "research-comparison-heading",
        "research-comparison-summary",
        "research-comparison-table",
        "research-comparison-sources",
      ],
    },
    {
      id: "research-comparison-heading",
      component: "EditorialHeading",
      text: "A source-grounded comparison",
      level: "h1",
      align: "start",
    },
    {
      id: "research-comparison-summary",
      component: "ComparisonSummary",
      title: "Compare equivalent claims from primary sources",
      recommendation:
        "Use the cited project documentation to distinguish the stable model capability from the versioned UI protocol.",
      items: [
        { label: "Gemini 3.6 Flash", value: "Stable model", detail: "Tool use and structured output", recommended: true },
        { label: "A2UI v0.9.1", value: "Pinned protocol", detail: "Trusted declarative component messages", recommended: false },
      ],
    },
    {
      id: "research-comparison-table",
      component: "ComparisonTable",
      caption: "Recorded official-source evidence",
      columns: ["Subject", "Role", "Evidence"],
      rows: [
        ["Gemini 3.6 Flash", "Retrieval and composition", "Official model documentation"],
        ["A2UI v0.9.1", "Trusted UI protocol", "Official project specification"],
      ],
    },
    {
      id: "research-comparison-sources",
      component: "SourceList",
      label: "Sources",
      sourceIds: [modelSource.id, a2uiSource.id],
    },
  ],
};

export const researchDemoSpec: SurfaceSpec = {
  kind: "research",
  rootId: "research-root",
  components: [
    {
      id: "research-root",
      component: "Band",
      tone: "plain",
      children: ["research-lead", "research-evidence", "research-timeline", "research-sources"],
    },
    {
      id: "research-lead",
      component: "ResearchLead",
      title: "Gemini 3.6 Flash sharpened the fast agentic tier",
      summary:
        "The stable model combines tool use, structured output, Search grounding, and ordinary streaming. This lab separates retrieval from UI composition so the final surface stays schema-constrained.",
      sourceIds: [modelSource.id, a2uiSource.id],
    },
    {
      id: "research-evidence",
      component: "EvidenceList",
      label: "What matters",
      items: [
        {
          title: "A stable Flash model for agent workflows",
          finding:
            "The official model card lists function calling, structured outputs, Search grounding, and standard response streaming.",
          sourceId: modelSource.id,
        },
        {
          title: "Declarative UI, not generated code",
          finding:
            "A2UI describes a trusted component graph and data model. The browser maps those messages to components owned by the application.",
          sourceId: a2uiSource.id,
        },
      ],
    },
    {
      id: "research-timeline",
      component: "Timeline",
      label: "Request path",
      items: [
        { date: "01", title: "Retrieve", detail: "Select an approved tool and normalize evidence.", sourceId: modelSource.id },
        { date: "02", title: "Compose", detail: "Return a schema-constrained SurfaceSpec with no tools enabled.", sourceId: modelSource.id },
        { date: "03", title: "Validate", detail: "Enforce the catalog, source rules, and layout budgets.", sourceId: a2uiSource.id },
        { date: "04", title: "Render", detail: "Compile official v0.9.1 messages into trusted React components.", sourceId: a2uiSource.id },
      ],
    },
    {
      id: "research-sources",
      component: "SourceList",
      label: "Sources",
      sourceIds: [modelSource.id, a2uiSource.id],
    },
  ],
};

export const narrativeDemoSpec: SurfaceSpec = {
  kind: "narrative",
  rootId: "narrative-root",
  components: [
    {
      id: "narrative-root",
      component: "Band",
      tone: "muted",
      children: ["narrative-heading", "narrative-copy"],
    },
    {
      id: "narrative-heading",
      component: "EditorialHeading",
      text: "I can help with a bounded, read-only answer.",
      level: "h1",
      align: "start",
    },
    {
      id: "narrative-copy",
      component: "TextBlock",
      text:
        "This version can compose weather, comparison, and grounded-research interfaces. It cannot make purchases, send messages, run arbitrary code, or replace professional medical, legal, or financial advice.",
      tone: "bounded",
    },
  ],
};

export const locationDemoSpec: SurfaceSpec = {
  kind: "location",
  rootId: "location-root",
  components: [
    {
      id: "location-root",
      component: "Band",
      tone: "sky",
      children: ["location-prompt"],
    },
    {
      id: "location-prompt",
      component: "LocationPrompt",
      message: "Which location should I use?",
      suggestions: ["Raleigh, NC", "Raleigh, MS", "Use my current location"],
    },
  ],
};

export type DemoSurface = {
  spec: SurfaceSpec;
  sources: SourceRecord[];
};

export function selectDemoSurface(
  prompt: string,
  capability: CapabilityDecision = classifyCapability(prompt),
): DemoSurface {
  if (capability.route === "boundary" && capability.boundary) {
    return { spec: createCapabilityBoundarySpec(capability.boundary), sources: [] };
  }
  if (capability.route === "clarification") {
    const reason = capability.reason === "location-required"
      ? "location-required"
      : "comparison-context-required";
    return { spec: createClarificationSpec(reason), sources: [] };
  }
  if (capability.route === "weather") {
    return capability.surfaceKind === "comparison"
      ? { spec: comparisonDemoSpec, sources: [weatherSource] }
      : { spec: weatherDemoSpec, sources: [weatherSource] };
  }
  if (capability.route === "search") {
    return capability.surfaceKind === "comparison"
      ? { spec: researchComparisonDemoSpec, sources: [modelSource, a2uiSource] }
      : { spec: researchDemoSpec, sources: [modelSource, a2uiSource] };
  }
  return { spec: narrativeDemoSpec, sources: [] };
}
