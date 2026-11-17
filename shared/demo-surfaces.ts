import { classifyCapability, type CapabilityDecision } from "./capability.js";
import { createCapabilityBoundarySpec, createClarificationSpec } from "./capability-surfaces.js";
import {
  chicagoPackingSpec,
  cloudflarePagesSource,
  flash38Source,
  fourDaySkepticSource,
  fourDayWeekClaimsSpec,
  fourDayWeekSource,
  hostingScorecardSpec,
  hydrogenBriefSpec,
  hydrogenSource,
  raleighJacketSpec,
  saturdayRideSpec,
  showcaseWeatherSource,
  threeCityTrendSpec,
  vercelLimitsSource,
  weekendGetawaySpec,
} from "./demo-showcase-surfaces.js";
import { parseStrictFormattedNumber } from "./strict-numeric.js";
import type {
  SourceRecord,
  SurfaceRecipeId,
  SurfaceSpec,
} from "./schemas.js";

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
  snippet: "Official model documentation recorded for the portfolio demonstration.",
};

const a2uiSource: SourceRecord = {
  id: "src_a2ui091",
  title: "A2UI v0.9.1 protocol",
  url: "https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/docs/a2ui_protocol.md",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "The versioned declarative UI protocol used by this lab.",
};

const southwestSource: SourceRecord = {
  id: "src_southwest",
  title: "Southwest carry-on baggage policy",
  url: "https://support.southwest.com/helpcenter/s/article/carryon-baggage-policy",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Official Southwest guidance for carry-on and personal-item limits.",
};

const deltaSource: SourceRecord = {
  id: "src_deltaair",
  title: "Delta carry-on baggage",
  url: "https://www.delta.com/us/en/baggage/carry-on-baggage",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Official Delta guidance for carry-on and personal-item limits.",
};

const reactSource: SourceRecord = {
  id: "src_reactdocs",
  title: "React documentation",
  url: "https://react.dev/",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Official React documentation recorded for the renderer comparison.",
};

const angularSource: SourceRecord = {
  id: "src_angulardocs",
  title: "Angular documentation",
  url: "https://angular.dev/",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Official Angular documentation recorded for the renderer comparison.",
};

const artemisSource: SourceRecord = {
  id: "src_nasaartemis",
  title: "NASA Artemis II mission",
  url: "https://www.nasa.gov/mission/artemis-ii/",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "NASA's official mission page and recorded schedule context for Artemis II.",
};

const artemis2024Source: SourceRecord = {
  id: "src_nasaearly",
  title: "NASA shares progress toward early Artemis Moon missions",
  url: "https://www.nasa.gov/news-release/nasa-shares-progress-toward-early-artemis-moon-missions-with-crew/",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "NASA's January 2024 announcement targeting September 2025 for Artemis II.",
};

const artemisDelaySource: SourceRecord = {
  id: "src_nasaorion",
  title: "NASA shares Orion heat-shield findings and updates Artemis missions",
  url: "https://www.nasa.gov/news-release/nasa-shares-orion-heat-shield-findings-updates-artemis-moon-missions/",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "NASA's December 2024 announcement targeting April 2026 for Artemis II.",
};

const iauPlutoSource: SourceRecord = {
  id: "src_iaupluto",
  title: "IAU Resolution B5: Definition of a Planet",
  url: "https://www.iau.org/static/resolutions/Resolution_GA26-5-6.pdf",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "The 2006 IAU resolution that defines planet and dwarf-planet categories.",
};

const nasaPlutoSource: SourceRecord = {
  id: "src_nasapluto",
  title: "NASA Pluto overview",
  url: "https://science.nasa.gov/dwarf-planets/pluto/",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "NASA's overview of Pluto's classification, system, and physical character.",
};

const raleighHourly = [
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

const raleighDaily = [
  { date: "Sun, Aug 2", high: 88, low: 70, precipitationProbability: 20, condition: "partly-cloudy" as const },
  { date: "Mon, Aug 3", high: 89, low: 71, precipitationProbability: 10, condition: "clear" as const },
  { date: "Tue, Aug 4", high: 86, low: 69, precipitationProbability: 40, condition: "rain" as const },
  { date: "Wed, Aug 5", high: 85, low: 68, precipitationProbability: 20, condition: "partly-cloudy" as const },
  { date: "Thu, Aug 6", high: 87, low: 69, precipitationProbability: 10, condition: "clear" as const },
];

/** The default weather fixture demonstrates the decision recipe used by the primary starter. */
export const weatherDemoSpec: SurfaceSpec = {
  kind: "weather",
  rootId: "weather-root",
  components: [
    {
      id: "weather-root",
      component: "SurfaceFrame",
      recipeId: "weather.decision",
      density: "balanced",
      emphasis: "decision",
      children: [
        "weather-hero",
        "weather-recommendation",
        "hourly-forecast",
        "daily-forecast",
        "weather-sources",
      ],
    },
    {
      id: "weather-hero",
      component: "WeatherHero",
      variant: "decision",
      location: "Raleigh, NC",
      dateLabel: "Saturday, August 1",
      temperature: 83,
      unit: "F",
      condition: "Partly cloudy",
      conditionKey: "partly-cloudy",
      recommendationLabel: "Today at a glance",
      recommendationValue: "Warm now, cooler after sunset",
      recommendationDetail: "The recorded forecast keeps rain chances low through the evening.",
    },
    {
      id: "weather-recommendation",
      component: "RecommendationBand",
      label: "Best walk window",
      value: "7:30–8:30 PM",
      detail: "Temperatures ease into the upper 70s after sunset with a low chance of rain.",
      confidence: "high",
    },
    {
      id: "hourly-forecast",
      component: "HourlyForecast",
      label: "Hourly",
      unit: "F",
      variant: "chart",
      items: raleighHourly.map(([time, temperature, precipitationProbability, condition]) => ({
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
      variant: "table",
      items: raleighDaily,
    },
    {
      id: "weather-sources",
      component: "SourceList",
      label: "Weather data · Updated 10:42 AM",
      sourceIds: [weatherSource.id],
    },
  ],
};

export const weatherSnapshotDemoSpec: SurfaceSpec = {
  kind: "weather",
  rootId: "snapshot-root",
  components: [
    {
      id: "snapshot-root",
      component: "SurfaceFrame",
      recipeId: "weather.snapshot",
      density: "brief",
      emphasis: "answer",
      children: ["snapshot-hero", "snapshot-metrics", "snapshot-sources"],
    },
    {
      id: "snapshot-hero",
      component: "WeatherHero",
      variant: "snapshot",
      location: "Raleigh, NC",
      dateLabel: "Saturday, August 1 · 10:42 AM",
      temperature: 83,
      unit: "F",
      condition: "Partly cloudy",
      conditionKey: "partly-cloudy",
      recommendationLabel: "Right now",
      recommendationValue: "Feels like 86°",
      recommendationDetail: "Light southwest wind with no active weather alert in the recorded fixture.",
    },
    {
      id: "snapshot-metrics",
      component: "Rail",
      label: "Current details",
      children: ["snapshot-humidity", "snapshot-wind", "snapshot-rain"],
    },
    {
      id: "snapshot-humidity",
      component: "Metric",
      label: "Humidity",
      value: "58%",
      detail: "Moderate",
      accent: "blue",
    },
    {
      id: "snapshot-wind",
      component: "Metric",
      label: "Wind",
      value: "7 mph",
      detail: "Southwest",
      accent: "neutral",
    },
    {
      id: "snapshot-rain",
      component: "Metric",
      label: "Rain chance",
      value: "10%",
      detail: "Through noon",
      accent: "neutral",
    },
    {
      id: "snapshot-sources",
      component: "SourceList",
      label: "Weather data · Updated 10:42 AM",
      sourceIds: [weatherSource.id],
    },
  ],
};

export const weatherOutlookDemoSpec: SurfaceSpec = {
  kind: "weather",
  rootId: "outlook-root",
  components: [
    {
      id: "outlook-root",
      component: "SurfaceFrame",
      recipeId: "weather.outlook",
      density: "detailed",
      emphasis: "trend",
      children: ["outlook-hero", "outlook-daily", "outlook-band", "outlook-sources"],
    },
    {
      id: "outlook-hero",
      component: "WeatherHero",
      variant: "snapshot",
      location: "Seattle, WA",
      dateLabel: "Saturday, August 1",
      temperature: 23,
      unit: "C",
      condition: "Partly cloudy",
      conditionKey: "partly-cloudy",
      recommendationLabel: "Seven-day pattern",
      recommendationValue: "Mild start, warmer midweek",
      recommendationDetail: "All seven requested days remain visible in the forecast below.",
    },
    {
      id: "outlook-daily",
      component: "DailyForecast",
      label: "Seattle · 7-day outlook",
      unit: "C",
      variant: "cards",
      items: [
        { date: "Sun, Aug 2", high: 24, low: 15, precipitationProbability: 20, condition: "partly-cloudy" },
        { date: "Mon, Aug 3", high: 25, low: 15, precipitationProbability: 10, condition: "clear" },
        { date: "Tue, Aug 4", high: 27, low: 16, precipitationProbability: 10, condition: "clear" },
        { date: "Wed, Aug 5", high: 28, low: 17, precipitationProbability: 10, condition: "clear" },
        { date: "Thu, Aug 6", high: 26, low: 16, precipitationProbability: 20, condition: "partly-cloudy" },
        { date: "Fri, Aug 7", high: 23, low: 15, precipitationProbability: 40, condition: "rain" },
        { date: "Sat, Aug 8", high: 22, low: 14, precipitationProbability: 30, condition: "cloudy" },
      ],
    },
    {
      id: "outlook-band",
      component: "RecommendationBand",
      label: "Plan around Friday",
      value: "Tuesday through Thursday is the driest stretch",
      detail: "The recorded outlook shows the highest rain chance on Friday; forecast confidence decreases later in the range.",
      confidence: "medium",
    },
    {
      id: "outlook-sources",
      component: "SourceList",
      label: "Weather data · Recorded Aug 1",
      sourceIds: [weatherSource.id],
    },
  ],
};

/** The default comparison fixture demonstrates a weather trend recipe. */
export const comparisonDemoSpec: SurfaceSpec = {
  kind: "comparison",
  rootId: "comparison-root",
  components: [
    {
      id: "comparison-root",
      component: "SurfaceFrame",
      recipeId: "comparison.trend",
      density: "detailed",
      emphasis: "trend",
      children: [
        "comparison-summary",
        "comparison-chart",
        "comparison-table",
        "comparison-sources",
      ],
    },
    {
      id: "comparison-summary",
      component: "ComparisonSummary",
      variant: "balanced",
      title: "Asheville is the cooler outdoor pick",
      recommendation: "Choose Asheville for a milder afternoon. Raleigh is warmer but has the drier Sunday window.",
      items: [
        { label: "Raleigh", value: "87° average high", detail: "20% peak rain chance", recommended: false },
        { label: "Asheville", value: "79° average high", detail: "30% peak rain chance", recommended: true },
      ],
    },
    {
      id: "comparison-chart",
      component: "ComparisonChart",
      variant: "line",
      title: "Saturday temperature comparison",
      labels: ["10 AM", "1 PM", "4 PM", "7 PM"],
      series: [
        { label: "Raleigh", values: [79, 85, 88, 82] },
        { label: "Asheville", values: [70, 77, 80, 74] },
      ],
      unit: "°F",
    },
    {
      id: "comparison-table",
      component: "ComparisonTable",
      caption: "Saturday temperature table alternative",
      columns: ["City", "10 AM", "1 PM", "4 PM", "7 PM"],
      rows: [
        ["Raleigh", "79°F", "85°F", "88°F", "82°F"],
        ["Asheville", "70°F", "77°F", "80°F", "74°F"],
      ],
    },
    {
      id: "comparison-sources",
      component: "SourceList",
      label: "Sources",
      sourceIds: [weatherSource.id],
    },
  ],
};

export const airlineVerdictDemoSpec: SurfaceSpec = {
  kind: "comparison",
  rootId: "airline-root",
  components: [
    {
      id: "airline-root",
      component: "SurfaceFrame",
      recipeId: "comparison.verdict",
      density: "balanced",
      emphasis: "decision",
      children: ["airline-summary", "airline-table", "airline-sources"],
    },
    {
      id: "airline-summary",
      component: "ComparisonSummary",
      variant: "verdict",
      title: "Southwest is more generous on published carry-on dimensions",
      recommendation: "Southwest publishes a larger carry-on size limit. Both airlines allow one carry-on and one personal item, so confirm the dimensions of your actual bag before flying.",
      items: [
        { label: "Southwest", value: "24 × 16 × 10 in", detail: "One carry-on plus one personal item", recommended: true },
        { label: "Delta", value: "22 × 14 × 9 in", detail: "One carry-on plus one personal item", recommended: false },
      ],
    },
    {
      id: "airline-table",
      component: "ComparisonTable",
      caption: "Published carry-on policy differences",
      columns: ["Airline", "Carry-on limit", "Personal item", "Decision note"],
      rows: [
        ["Southwest", "24 × 16 × 10 in", "One, under the seat", "More dimensional room"],
        ["Delta", "22 × 14 × 9 in", "One, under the seat", "Smaller published dimensions"],
      ],
    },
    {
      id: "airline-sources",
      component: "SourceList",
      label: "Official airline policies",
      sourceIds: [southwestSource.id, deltaSource.id],
    },
  ],
};

export const a2uiScorecardDemoSpec: SurfaceSpec = {
  kind: "comparison",
  rootId: "scorecard-root",
  components: [
    {
      id: "scorecard-root",
      component: "SurfaceFrame",
      recipeId: "comparison.scorecard",
      density: "detailed",
      emphasis: "evidence",
      children: ["scorecard-summary", "scorecard-metrics", "scorecard-table", "scorecard-sources"],
    },
    {
      id: "scorecard-summary",
      component: "ComparisonSummary",
      variant: "balanced",
      title: "React is the lower-friction A2UI v0.9.1 client for this lab",
      recommendation: "Choose React when the goal is a small custom-catalog renderer with direct component composition. Angular remains credible when the surrounding product already benefits from its integrated framework conventions.",
      items: [
        { label: "React", value: "Lower setup friction", detail: "Direct fit with this lab's renderer", recommended: true },
        { label: "Angular", value: "More integrated structure", detail: "Strong choice inside an Angular application", recommended: false },
      ],
    },
    {
      id: "scorecard-metrics",
      component: "Rail",
      label: "Decision criteria",
      children: ["scorecard-setup", "scorecard-ecosystem", "scorecard-accessibility", "scorecard-bundle"],
    },
    {
      id: "scorecard-setup",
      component: "Metric",
      label: "Setup",
      value: "React",
      detail: "Smallest integration surface here",
      accent: "coral",
    },
    {
      id: "scorecard-ecosystem",
      component: "Metric",
      label: "Ecosystem",
      value: "Context dependent",
      detail: "Both have mature tooling",
      accent: "neutral",
    },
    {
      id: "scorecard-accessibility",
      component: "Metric",
      label: "Accessibility",
      value: "Application owned",
      detail: "Trusted components carry the contract",
      accent: "blue",
    },
    {
      id: "scorecard-bundle",
      component: "Metric",
      label: "Bundle tradeoff",
      value: "Measure in context",
      detail: "Architecture outweighs a generic claim",
      accent: "neutral",
    },
    {
      id: "scorecard-table",
      component: "ComparisonTable",
      caption: "A2UI client implementation scorecard",
      columns: ["Criterion", "React", "Angular"],
      rows: [
        ["Setup", "Composable library integration", "Framework-integrated setup"],
        ["Ecosystem", "Broad component ecosystem", "Integrated Angular tooling"],
        ["Accessibility", "Owned by catalog components", "Owned by catalog components"],
        ["Bundle", "Tune dependencies explicitly", "Evaluate framework-wide cost"],
      ],
    },
    {
      id: "scorecard-sources",
      component: "SourceList",
      label: "Official documentation",
      sourceIds: [a2uiSource.id, reactSource.id, angularSource.id],
    },
  ],
};

/** Kept for compatibility with the original recorded research-comparison fixture. */
export const researchComparisonDemoSpec: SurfaceSpec = {
  kind: "comparison",
  rootId: "research-comparison-root",
  components: [
    {
      id: "research-comparison-root",
      component: "SurfaceFrame",
      recipeId: "comparison.scorecard",
      density: "balanced",
      emphasis: "evidence",
      children: ["research-comparison-summary", "research-comparison-table", "research-comparison-sources"],
    },
    {
      id: "research-comparison-summary",
      component: "ComparisonSummary",
      variant: "balanced",
      title: "Compare equivalent claims from primary sources",
      recommendation: "Use the cited project documentation to distinguish the stable model capability from the versioned UI protocol.",
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

/** The default research fixture demonstrates the answer-first brief recipe. */
export const researchDemoSpec: SurfaceSpec = {
  kind: "research",
  rootId: "research-root",
  components: [
    {
      id: "research-root",
      component: "SurfaceFrame",
      recipeId: "research.brief",
      density: "balanced",
      emphasis: "evidence",
      children: ["research-lead", "research-evidence", "research-timeline", "research-sources"],
    },
    {
      id: "research-lead",
      component: "ResearchLead",
      variant: "feature",
      title: "Gemini 3.6 Flash sharpened the fast agentic tier",
      summary: "The stable model combines tool use, structured output, Search grounding, and ordinary streaming. This lab separates retrieval from UI composition so the final surface stays schema-constrained.",
      sourceIds: [modelSource.id, a2uiSource.id],
    },
    {
      id: "research-evidence",
      component: "EvidenceList",
      variant: "stack",
      label: "What matters",
      items: [
        {
          title: "A stable Flash model for agent workflows",
          finding: "The official model documentation lists function calling, structured outputs, Search grounding, and standard response streaming.",
          sourceId: modelSource.id,
          stance: "support",
        },
        {
          title: "Declarative UI, not generated code",
          finding: "A2UI describes a trusted component graph and data model. The browser maps those messages to components owned by the application.",
          sourceId: a2uiSource.id,
          stance: "support",
        },
      ],
    },
    {
      id: "research-timeline",
      component: "Timeline",
      label: "Request path",
      items: [
        { date: "01", title: "Retrieve", detail: "Select an approved tool and normalize evidence.", sourceId: modelSource.id },
        { date: "02", title: "Compose", detail: "Return a schema-constrained semantic plan with no tools enabled.", sourceId: modelSource.id },
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

export const artemisTimelineDemoSpec: SurfaceSpec = {
  kind: "research",
  rootId: "artemis-root",
  components: [
    {
      id: "artemis-root",
      component: "SurfaceFrame",
      recipeId: "research.timeline",
      density: "detailed",
      emphasis: "trend",
      children: ["artemis-lead", "artemis-timeline", "artemis-sources"],
    },
    {
      id: "artemis-lead",
      component: "ResearchLead",
      variant: "brief",
      title: "Artemis II's schedule evolved before its April 2026 flight",
      summary: "NASA first moved the mission to September 2025, then to April 2026 while teams completed readiness work. Artemis II ultimately launched April 1 and splashed down April 10, 2026.",
      sourceIds: [artemis2024Source.id, artemisDelaySource.id, artemisSource.id],
    },
    {
      id: "artemis-timeline",
      component: "Timeline",
      label: "Major schedule announcements",
      items: [
        {
          date: "January 9, 2024",
          title: "NASA targeted September 2025",
          detail: "The agency adjusted the schedule to allow teams to work through first-time development, operations, and integration challenges.",
          sourceId: artemis2024Source.id,
        },
        {
          date: "December 5, 2024",
          title: "The target shifted to April 2026",
          detail: "NASA connected the updated timeline to Orion heat-shield findings and environmental-control and life-support work.",
          sourceId: artemisDelaySource.id,
        },
        {
          date: "April 1, 2026",
          title: "Artemis II launched",
          detail: "The crew departed Kennedy Space Center for the first crewed Artemis lunar flyby.",
          sourceId: artemisSource.id,
        },
        {
          date: "April 10, 2026",
          title: "Orion returned the crew to Earth",
          detail: "The mission concluded with splashdown after 9 days, 1 hour, and 32 minutes.",
          sourceId: artemisSource.id,
        },
      ],
    },
    {
      id: "artemis-sources",
      component: "SourceList",
      label: "Official NASA sources",
      sourceIds: [artemis2024Source.id, artemisDelaySource.id, artemisSource.id],
    },
  ],
};

export const plutoClaimsDemoSpec: SurfaceSpec = {
  kind: "research",
  rootId: "pluto-root",
  components: [
    {
      id: "pluto-root",
      component: "SurfaceFrame",
      recipeId: "research.claims",
      density: "detailed",
      emphasis: "evidence",
      children: ["pluto-lead", "pluto-evidence", "pluto-sources"],
    },
    {
      id: "pluto-lead",
      component: "ResearchLead",
      variant: "feature",
      title: "Pluto fits the IAU dwarf-planet definition, while the definition itself remains debated",
      summary: "The classification follows an orbital criterion adopted by the IAU. Pluto's complex intrinsic geology supplies the strongest context for scientists who prefer a geophysical definition of planet.",
      sourceIds: [iauPlutoSource.id, nasaPlutoSource.id],
    },
    {
      id: "pluto-evidence",
      component: "EvidenceList",
      variant: "for-against",
      label: "Evidence by claim",
      items: [
        {
          title: "Supports: Pluto has not cleared its orbital neighborhood",
          finding: "IAU Resolution B5 requires a planet to clear the neighborhood around its orbit and places bodies like Pluto in the dwarf-planet category.",
          sourceId: iauPlutoSource.id,
          stance: "support",
        },
        {
          title: "Supports: NASA uses the dwarf-planet classification",
          finding: "NASA's current overview describes Pluto as a dwarf planet in the Kuiper Belt and summarizes its physical system.",
          sourceId: nasaPlutoSource.id,
          stance: "support",
        },
        {
          title: "Challenges: Pluto has planet-like geological complexity",
          finding: "Pluto has an atmosphere, five known moons, mountains, glaciers, and active surface processes—evidence often emphasized by geophysical definitions.",
          sourceId: nasaPlutoSource.id,
          stance: "challenge",
        },
        {
          title: "Context: the disagreement is definitional",
          finding: "These physical traits do not overturn the IAU resolution; they explain why some scientists challenge the orbital criterion rather than the observations themselves.",
          sourceId: iauPlutoSource.id,
          stance: "neutral",
        },
      ],
    },
    {
      id: "pluto-sources",
      component: "SourceList",
      label: "Primary references",
      sourceIds: [iauPlutoSource.id, nasaPlutoSource.id],
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
      text: "This version can compose weather, comparison, and grounded-research interfaces. It cannot make purchases, send messages, run arbitrary code, or replace professional medical, legal, or financial advice.",
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

const RECORDED_QUALITY_CHECK_CODES = [
  "recipe_fit",
  "answer_first",
  "sources_last",
  "duplicate_primary",
  "chart_table_alignment",
  "citation_coverage",
] as const;

export type RecordedQualityCheck = {
  code: (typeof RECORDED_QUALITY_CHECK_CODES)[number];
  passed: boolean;
};

const LAYOUT_COMPONENT_NAMES = new Set(["SurfaceFrame", "Band", "Split", "Rail", "Divider"]);
const PRIMARY_COMPONENT_NAMES = new Set(["WeatherHero", "ComparisonSummary", "ResearchLead"]);
const PRIMARY_BY_KIND: Readonly<Record<string, string>> = {
  weather: "WeatherHero",
  comparison: "ComparisonSummary",
  research: "ResearchLead",
};

const RECORDED_RECIPE_EXPECTATIONS: Readonly<Record<SurfaceRecipeId, {
  kind: "weather" | "comparison" | "research";
  density: "brief" | "balanced" | "detailed";
  emphasis: "answer" | "decision" | "trend" | "evidence" | "risk";
  requiredComponents: readonly string[];
}>> = {
  "weather.snapshot": {
    kind: "weather",
    density: "brief",
    emphasis: "answer",
    requiredComponents: ["WeatherHero", "Rail", "SourceList"],
  },
  "weather.decision": {
    kind: "weather",
    density: "balanced",
    emphasis: "decision",
    requiredComponents: ["WeatherHero", "RecommendationBand", "HourlyForecast", "DailyForecast", "SourceList"],
  },
  "weather.outlook": {
    kind: "weather",
    density: "detailed",
    emphasis: "trend",
    requiredComponents: ["WeatherHero", "DailyForecast", "RecommendationBand", "SourceList"],
  },
  "comparison.verdict": {
    kind: "comparison",
    density: "balanced",
    emphasis: "decision",
    requiredComponents: ["ComparisonSummary", "ComparisonTable", "SourceList"],
  },
  "comparison.scorecard": {
    kind: "comparison",
    density: "detailed",
    emphasis: "evidence",
    requiredComponents: ["ComparisonSummary", "Rail", "ComparisonTable", "SourceList"],
  },
  "comparison.trend": {
    kind: "comparison",
    density: "detailed",
    emphasis: "trend",
    requiredComponents: ["ComparisonSummary", "ComparisonChart", "ComparisonTable", "SourceList"],
  },
  "research.brief": {
    kind: "research",
    density: "balanced",
    emphasis: "evidence",
    requiredComponents: ["ResearchLead", "EvidenceList", "Timeline", "SourceList"],
  },
  "research.timeline": {
    kind: "research",
    density: "detailed",
    emphasis: "trend",
    requiredComponents: ["ResearchLead", "Timeline", "SourceList"],
  },
  "research.claims": {
    kind: "research",
    density: "detailed",
    emphasis: "evidence",
    requiredComponents: ["ResearchLead", "EvidenceList", "SourceList"],
  },
};

function readableRecordedNodes(spec: SurfaceSpec): SurfaceSpec["components"][number][] {
  const nodes = new Map(spec.components.map((node) => [node.id, node]));
  const readable: SurfaceSpec["components"][number][] = [];
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes.get(id);
    if (!node) return;
    if (!LAYOUT_COMPONENT_NAMES.has(node.component)) readable.push(node);
    if ("children" in node) node.children.forEach(visit);
  };

  visit(spec.rootId);
  return readable;
}

function recordedRecipeFits(spec: SurfaceSpec): boolean {
  const root = spec.components.find((node) => node.id === spec.rootId);
  if (root?.component !== "SurfaceFrame" || !root.recipeId) return false;
  const expectation = RECORDED_RECIPE_EXPECTATIONS[root.recipeId];
  const componentNames: ReadonlySet<string> = new Set(
    spec.components.map((node) => node.component),
  );
  return expectation.kind === spec.kind
    && root.density === expectation.density
    && root.emphasis === expectation.emphasis
    && expectation.requiredComponents.every((name) => componentNames.has(name));
}

function recordedChartTableAlign(spec: SurfaceSpec): boolean {
  const chart = spec.components.find((node) => node.component === "ComparisonChart");
  if (!chart || chart.component !== "ComparisonChart") return true;
  const table = spec.components.find((node) => node.component === "ComparisonTable");
  if (!table || table.component !== "ComparisonTable") return false;
  if (table.columns.length !== chart.labels.length + 1) return false;
  if (!chart.labels.every((label, index) => table.columns[index + 1] === label)) return false;
  if (table.rows.length !== chart.series.length) return false;

  return chart.series.every((series, seriesIndex) => {
    const row = table.rows[seriesIndex];
    if (!row || row[0] !== series.label || row.length !== series.values.length + 1) return false;
    return series.values.every((value, valueIndex) => {
      const cell = row[valueIndex + 1];
      return parseStrictFormattedNumber(cell) === value;
    });
  });
}

function collectRecordedCitationIds(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRecordedCitationIds(item, output));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (typeof record.sourceId === "string") output.add(record.sourceId);
  if (Array.isArray(record.sourceIds)) {
    record.sourceIds.forEach((sourceId) => {
      if (typeof sourceId === "string") output.add(sourceId);
    });
  }
  Object.entries(record).forEach(([key, item]) => {
    if (key !== "sourceId" && key !== "sourceIds") collectRecordedCitationIds(item, output);
  });
}

function recordedCitationsAreComplete(
  spec: SurfaceSpec,
  sources: readonly SourceRecord[],
  readable: readonly SurfaceSpec["components"][number][],
): boolean {
  const sourceIds = new Set(sources.map((source) => source.id));
  const sourceLists = readable.filter((node) => node.component === "SourceList");
  if (sourceLists.length !== 1 || sourceLists[0]?.component !== "SourceList") return false;
  const listedIds = new Set(sourceLists[0].sourceIds);
  if (sourceIds.size !== listedIds.size || [...sourceIds].some((id) => !listedIds.has(id))) return false;

  const citedIds = new Set<string>();
  collectRecordedCitationIds(spec.components, citedIds);
  if ([...citedIds].some((id) => !sourceIds.has(id) || !listedIds.has(id))) return false;

  if (spec.kind !== "research") return true;
  return spec.components
    .filter((node) => node.component === "EvidenceList" || node.component === "Timeline")
    .every((node) => node.items.every((item) => {
      const sourceId = "sourceId" in item ? item.sourceId : undefined;
      return typeof sourceId === "string" && sourceIds.has(sourceId) && listedIds.has(sourceId);
    }));
}

/** Evaluate only facts that the recorded fixture itself can prove without the original prompt. */
export function evaluateRecordedSurfaceQuality(
  spec: SurfaceSpec,
  sources: readonly SourceRecord[],
): RecordedQualityCheck[] {
  const readable = readableRecordedNodes(spec);
  const readableNames = readable.map((node) => node.component);
  const expectedPrimary = PRIMARY_BY_KIND[spec.kind];
  const sourceIndexes = readableNames
    .map((name, index) => name === "SourceList" ? index : -1)
    .filter((index) => index >= 0);
  const checks: Readonly<Record<RecordedQualityCheck["code"], boolean>> = {
    recipe_fit: recordedRecipeFits(spec),
    answer_first: typeof expectedPrimary === "string" && readableNames[0] === expectedPrimary,
    sources_last: sourceIndexes.length === 1 && sourceIndexes[0] === readable.length - 1,
    duplicate_primary: readableNames.filter((name) => PRIMARY_COMPONENT_NAMES.has(name)).length === 1,
    chart_table_alignment: recordedChartTableAlign(spec),
    citation_coverage: recordedCitationsAreComplete(spec, sources, readable),
  };
  return RECORDED_QUALITY_CHECK_CODES.map((code) => ({ code, passed: checks[code] }));
}

function normalizeShowcasePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

const showcaseSurfaces = new Map<string, DemoSurface>([
  // Current starter and example prompts (see promptSuggestions.ts).
  [
    normalizeShowcasePrompt("Plan my Saturday in Raleigh: when is the best 3-hour window for a bike ride, and what should I bring?"),
    { spec: saturdayRideSpec, sources: [showcaseWeatherSource] },
  ],
  [
    normalizeShowcasePrompt("Raleigh, Asheville, or Wilmington: which has the best weather for a getaway this Saturday and Sunday?"),
    { spec: weekendGetawaySpec, sources: [showcaseWeatherSource] },
  ],
  [
    normalizeShowcasePrompt("What's new in Gemini 4 Hydrogen, and how does it compare with Gemini 3.8 Flash?"),
    { spec: hydrogenBriefSpec, sources: [hydrogenSource, flash38Source] },
  ],
  [
    normalizeShowcasePrompt("What's it like in Raleigh right now, and do I need a jacket?"),
    { spec: raleighJacketSpec, sources: [showcaseWeatherSource] },
  ],
  [
    normalizeShowcasePrompt("I land in Chicago Thursday morning for a four-day trip. Show me what to pack for each day."),
    { spec: chicagoPackingSpec, sources: [showcaseWeatherSource] },
  ],
  [
    normalizeShowcasePrompt("Chart the next five days of highs and rain chances for Seattle, Denver, and Miami."),
    { spec: threeCityTrendSpec, sources: [showcaseWeatherSource] },
  ],
  [
    normalizeShowcasePrompt("Compare Vercel and Cloudflare Pages for a small business website: free-tier limits, pricing, and performance."),
    { spec: hostingScorecardSpec, sources: [cloudflarePagesSource, vercelLimitsSource] },
  ],
  [
    normalizeShowcasePrompt("Build a timeline of NASA's Artemis II schedule announcements since 2024."),
    {
      spec: artemisTimelineDemoSpec,
      sources: [artemis2024Source, artemisDelaySource, artemisSource],
    },
  ],
  [
    normalizeShowcasePrompt("Do four-day work weeks improve productivity? Weigh the evidence on both sides."),
    { spec: fourDayWeekClaimsSpec, sources: [fourDayWeekSource, fourDaySkepticSource] },
  ],
  // Earlier prompts, kept so existing tests and bookmarked demos still replay.
  [
    normalizeShowcasePrompt("When should I take a walk in Raleigh today?"),
    { spec: weatherDemoSpec, sources: [weatherSource] },
  ],
  [
    normalizeShowcasePrompt("Compare this weekend’s weather in Raleigh and Asheville."),
    { spec: comparisonDemoSpec, sources: [weatherSource] },
  ],
  [
    normalizeShowcasePrompt("What changed in Gemini 3.6 Flash?"),
    { spec: researchDemoSpec, sources: [modelSource, a2uiSource] },
  ],
  [
    normalizeShowcasePrompt("What does the weather look like in Raleigh right now?"),
    { spec: weatherSnapshotDemoSpec, sources: [weatherSource] },
  ],
  [
    normalizeShowcasePrompt("Show Seattle’s seven-day weather outlook in Celsius."),
    { spec: weatherOutlookDemoSpec, sources: [weatherSource] },
  ],
  [
    normalizeShowcasePrompt("Which airline has the better carry-on policy: Southwest or Delta?"),
    { spec: airlineVerdictDemoSpec, sources: [southwestSource, deltaSource] },
  ],
  [
    normalizeShowcasePrompt("Compare React and Angular for an A2UI v0.9.1 client across setup, ecosystem, accessibility, and bundle tradeoffs."),
    { spec: a2uiScorecardDemoSpec, sources: [a2uiSource, reactSource, angularSource] },
  ],
  [
    normalizeShowcasePrompt("Build a timeline of the major Artemis II schedule announcements."),
    {
      spec: artemisTimelineDemoSpec,
      sources: [artemis2024Source, artemisDelaySource, artemisSource],
    },
  ],
  [
    normalizeShowcasePrompt("What evidence supports and challenges Pluto’s classification as a dwarf planet?"),
    { spec: plutoClaimsDemoSpec, sources: [iauPlutoSource, nasaPlutoSource] },
  ],
]);

export function selectDemoSurface(
  prompt: string,
  capability: CapabilityDecision = classifyCapability(prompt),
): DemoSurface {
  const showcase = showcaseSurfaces.get(normalizeShowcasePrompt(prompt));
  if (showcase) return showcase;

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
