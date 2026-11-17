import type { SourceRecord, SurfaceSpec } from "./schemas.js";

/**
 * Recorded surfaces for the November 2026 starter and example prompts. These replay
 * only when /api/agent is unavailable (Vite-only development), and the UI labels them
 * as recorded. Weather values are illustrative fixtures; research and comparison
 * facts come from the cited sources as of the recording date.
 */
const ACCESSED_AT = "2026-11-17T20:00:00.000Z";

export const showcaseWeatherSource: SourceRecord = {
  id: "src_googleweather",
  title: "Google Weather API",
  url: "https://developers.google.com/maps/documentation/weather",
  provider: "google-weather",
  accessedAt: ACCESSED_AT,
  snippet: "Recorded provider fixture for the portfolio demonstration.",
};

export const hydrogenSource: SourceRecord = {
  id: "src_hydrogenguide",
  title: "Developer's guide to Gemini 4 Hydrogen",
  url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-hydrogen",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Google's developer guide for the gemini-4-hydrogen model and the Interactions API.",
};

export const flash38Source: SourceRecord = {
  id: "src_gemini38flash",
  title: "Gemini 3.8 Flash model page",
  url: "https://aistudio.google.com/docs/models/gemini-3.8-flash",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Model code, capabilities, thinking levels, and token limits for Gemini 3.8 Flash.",
};

export const cloudflarePagesSource: SourceRecord = {
  id: "src_cfpageslimits",
  title: "Cloudflare Pages limits",
  url: "https://developers.cloudflare.com/pages/platform/limits/",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Build, file, and project limits for Cloudflare Pages.",
};

export const vercelLimitsSource: SourceRecord = {
  id: "src_vercellimits",
  title: "Vercel limits",
  url: "https://vercel.com/docs/limits",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Plan limits for Vercel Hobby and Pro projects.",
};

export const fourDayWeekSource: SourceRecord = {
  id: "src_fourdayglobal",
  title: "The biggest trial yet confirms four-day workweek makes employees happier",
  url: "https://www.scientificamerican.com/article/biggest-trial-of-four-day-workweek-finds-workers-are-happier-and-feel-just/",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "Coverage of a 141-company, six-country four-day-week study.",
};

export const fourDaySkepticSource: SourceRecord = {
  id: "src_fourdayskeptic",
  title: "Findings from four-day work week trial: should we be sceptical?",
  url: "https://whatworkswellbeing.org/blog/findings-from-four-day-work-week-trial/",
  provider: "google-search",
  accessedAt: ACCESSED_AT,
  snippet: "An evidence review of the 2022 UK pilot and its study design.",
};

/** "Plan my Saturday in Raleigh..." — weather.decision */
export const saturdayRideSpec: SurfaceSpec = {
  kind: "weather",
  rootId: "ride-root",
  components: [
    {
      id: "ride-root",
      component: "SurfaceFrame",
      recipeId: "weather.decision",
      density: "balanced",
      emphasis: "decision",
      children: ["ride-hero", "ride-band", "ride-hourly", "ride-daily", "ride-sources"],
    },
    {
      id: "ride-hero",
      component: "WeatherHero",
      variant: "decision",
      location: "Raleigh, NC",
      dateLabel: "Saturday, November 21",
      temperature: 48,
      unit: "F",
      condition: "Clear",
      conditionKey: "clear",
      recommendationLabel: "Saturday at a glance",
      recommendationValue: "Cold start, comfortable by late morning",
      recommendationDetail: "Dry all day in the recorded forecast, with a light northwest breeze.",
    },
    {
      id: "ride-band",
      component: "RecommendationBand",
      label: "Best 3-hour ride window",
      value: "11 AM–2 PM",
      detail: "Low 60s with no rain. Bring a light layer for the first hour, sunglasses, and plenty of water.",
      confidence: "high",
    },
    {
      id: "ride-hourly",
      component: "HourlyForecast",
      label: "Saturday hourly",
      unit: "F",
      variant: "chart",
      items: [
        { time: "8 AM", temperature: 41, precipitationProbability: 0, condition: "clear" },
        { time: "9 AM", temperature: 46, precipitationProbability: 0, condition: "clear" },
        { time: "10 AM", temperature: 52, precipitationProbability: 0, condition: "clear" },
        { time: "11 AM", temperature: 57, precipitationProbability: 0, condition: "clear" },
        { time: "12 PM", temperature: 60, precipitationProbability: 0, condition: "clear" },
        { time: "1 PM", temperature: 62, precipitationProbability: 0, condition: "partly-cloudy" },
        { time: "2 PM", temperature: 63, precipitationProbability: 5, condition: "partly-cloudy" },
        { time: "3 PM", temperature: 62, precipitationProbability: 5, condition: "partly-cloudy" },
        { time: "4 PM", temperature: 59, precipitationProbability: 5, condition: "partly-cloudy" },
      ],
    },
    {
      id: "ride-daily",
      component: "DailyForecast",
      label: "Weekend",
      unit: "F",
      variant: "table",
      items: [
        { date: "Sat, Nov 21", high: 63, low: 38, precipitationProbability: 0, condition: "clear" },
        { date: "Sun, Nov 22", high: 60, low: 42, precipitationProbability: 30, condition: "cloudy" },
      ],
    },
    {
      id: "ride-sources",
      component: "SourceList",
      label: "Weather data · Recorded Nov 17",
      sourceIds: [showcaseWeatherSource.id],
    },
  ],
};

/** "Raleigh, Asheville, or Wilmington..." — comparison.verdict */
export const weekendGetawaySpec: SurfaceSpec = {
  kind: "comparison",
  rootId: "getaway-root",
  components: [
    {
      id: "getaway-root",
      component: "SurfaceFrame",
      recipeId: "comparison.verdict",
      density: "balanced",
      emphasis: "decision",
      children: ["getaway-summary", "getaway-table", "getaway-sources"],
    },
    {
      id: "getaway-summary",
      component: "ComparisonSummary",
      variant: "verdict",
      title: "Wilmington has the mildest, driest weekend",
      recommendation: "Pick Wilmington for the warmest dry weekend. Raleigh is a close second; Asheville runs about ten degrees colder with Sunday showers.",
      items: [
        { label: "Wilmington", value: "66° average high", detail: "10% peak rain chance", recommended: true },
        { label: "Raleigh", value: "62° average high", detail: "30% peak rain chance", recommended: false },
        { label: "Asheville", value: "53° average high", detail: "50% peak rain chance", recommended: false },
      ],
    },
    {
      id: "getaway-table",
      component: "ComparisonTable",
      caption: "Weekend forecast by city",
      columns: ["City", "Saturday", "Sunday", "Decision note"],
      rows: [
        ["Wilmington", "67°F, sunny", "65°F, 10% rain", "Warmest and driest"],
        ["Raleigh", "63°F, sunny", "60°F, 30% rain", "Good Saturday, cloudier Sunday"],
        ["Asheville", "55°F, partly cloudy", "51°F, 50% rain", "Coldest, wet Sunday"],
      ],
    },
    {
      id: "getaway-sources",
      component: "SourceList",
      label: "Weather data · Recorded Nov 17",
      sourceIds: [showcaseWeatherSource.id],
    },
  ],
};

/** "What's new in Gemini 4 Hydrogen..." — research.brief */
export const hydrogenBriefSpec: SurfaceSpec = {
  kind: "research",
  rootId: "hydrogen-root",
  components: [
    {
      id: "hydrogen-root",
      component: "SurfaceFrame",
      recipeId: "research.brief",
      density: "balanced",
      emphasis: "evidence",
      children: ["hydrogen-lead", "hydrogen-evidence", "hydrogen-timeline", "hydrogen-sources"],
    },
    {
      id: "hydrogen-lead",
      component: "ResearchLead",
      variant: "feature",
      title: "Gemini 4 Hydrogen replaces 3.8 Flash as Google's fast model",
      summary: "Hydrogen keeps the Flash tier's role for coding and agent work, adds an xhigh thinking level, and defaults to high thinking, so it can cost more per request unless you set the level yourself.",
      sourceIds: [hydrogenSource.id, flash38Source.id],
    },
    {
      id: "hydrogen-evidence",
      component: "EvidenceList",
      variant: "stack",
      label: "What changed",
      items: [
        {
          title: "Same API surface",
          finding: "Hydrogen is called with the model ID gemini-4-hydrogen through the Interactions API, including structured output.",
          sourceId: hydrogenSource.id,
          stance: "support",
        },
        {
          title: "Thinking levels",
          finding: "3.8 Flash supports low, medium, and high thinking and rejects minimal; Hydrogen adds xhigh.",
          sourceId: flash38Source.id,
          stance: "neutral",
        },
      ],
    },
    {
      id: "hydrogen-timeline",
      component: "Timeline",
      label: "Release path",
      items: [
        { date: "Sep 2026", title: "Gemini 3.8 Flash", detail: "Stable fast model with search grounding and structured outputs.", sourceId: flash38Source.id },
        { date: "Nov 2026", title: "Gemini 4 Hydrogen", detail: "Fast Gemini 4 model for everyday coding and agentic workflows.", sourceId: hydrogenSource.id },
      ],
    },
    {
      id: "hydrogen-sources",
      component: "SourceList",
      label: "Official Google documentation",
      sourceIds: [hydrogenSource.id, flash38Source.id],
    },
  ],
};

/** "What's it like in Raleigh right now..." — weather.snapshot */
export const raleighJacketSpec: SurfaceSpec = {
  kind: "weather",
  rootId: "jacket-root",
  components: [
    {
      id: "jacket-root",
      component: "SurfaceFrame",
      recipeId: "weather.snapshot",
      density: "brief",
      emphasis: "answer",
      children: ["jacket-hero", "jacket-metrics", "jacket-sources"],
    },
    {
      id: "jacket-hero",
      component: "WeatherHero",
      variant: "snapshot",
      location: "Raleigh, NC",
      dateLabel: "Tuesday, November 17 · 3:00 PM",
      temperature: 54,
      unit: "F",
      condition: "Partly cloudy",
      conditionKey: "partly-cloudy",
      recommendationLabel: "Jacket?",
      recommendationValue: "Yes, a light one",
      recommendationDetail: "It feels like 51° with a steady breeze, and it drops into the 40s after sunset.",
    },
    {
      id: "jacket-metrics",
      component: "Rail",
      label: "Current details",
      children: ["jacket-feels", "jacket-wind", "jacket-rain"],
    },
    { id: "jacket-feels", component: "Metric", label: "Feels like", value: "51°", detail: "Cool", accent: "blue" },
    { id: "jacket-wind", component: "Metric", label: "Wind", value: "11 mph", detail: "Northwest", accent: "neutral" },
    { id: "jacket-rain", component: "Metric", label: "Rain chance", value: "5%", detail: "Through tonight", accent: "neutral" },
    {
      id: "jacket-sources",
      component: "SourceList",
      label: "Weather data · Recorded Nov 17",
      sourceIds: [showcaseWeatherSource.id],
    },
  ],
};

/** "I land in Chicago Thursday morning..." — weather.outlook */
export const chicagoPackingSpec: SurfaceSpec = {
  kind: "weather",
  rootId: "chicago-root",
  components: [
    {
      id: "chicago-root",
      component: "SurfaceFrame",
      recipeId: "weather.outlook",
      density: "detailed",
      emphasis: "trend",
      children: ["chicago-hero", "chicago-daily", "chicago-band", "chicago-sources"],
    },
    {
      id: "chicago-hero",
      component: "WeatherHero",
      variant: "snapshot",
      location: "Chicago, IL",
      dateLabel: "Thursday, November 19",
      temperature: 39,
      unit: "F",
      condition: "Cloudy",
      conditionKey: "cloudy",
      recommendationLabel: "Four-day pattern",
      recommendationValue: "Cold and windy, wettest on Friday",
      recommendationDetail: "Highs stay in the 40s; pack for wind chill rather than snow.",
    },
    {
      id: "chicago-daily",
      component: "DailyForecast",
      label: "Chicago · Thursday through Sunday",
      unit: "F",
      variant: "cards",
      items: [
        { date: "Thu, Nov 19", high: 44, low: 33, precipitationProbability: 20, condition: "cloudy" },
        { date: "Fri, Nov 20", high: 42, low: 35, precipitationProbability: 70, condition: "rain" },
        { date: "Sat, Nov 21", high: 40, low: 30, precipitationProbability: 20, condition: "wind" },
        { date: "Sun, Nov 22", high: 46, low: 34, precipitationProbability: 10, condition: "partly-cloudy" },
      ],
    },
    {
      id: "chicago-band",
      component: "RecommendationBand",
      label: "What to pack",
      value: "Insulated jacket, hat, and a rain shell for Friday",
      detail: "Layers cover Thursday and Sunday; Saturday's wind makes gloves worth bringing.",
      confidence: "medium",
    },
    {
      id: "chicago-sources",
      component: "SourceList",
      label: "Weather data · Recorded Nov 17",
      sourceIds: [showcaseWeatherSource.id],
    },
  ],
};

/** "Chart the next five days of highs and rain chances..." — comparison.trend */
export const threeCityTrendSpec: SurfaceSpec = {
  kind: "comparison",
  rootId: "trend-root",
  components: [
    {
      id: "trend-root",
      component: "SurfaceFrame",
      recipeId: "comparison.trend",
      density: "detailed",
      emphasis: "trend",
      children: ["trend-summary", "trend-chart", "trend-table", "trend-sources"],
    },
    {
      id: "trend-summary",
      component: "ComparisonSummary",
      variant: "balanced",
      title: "Miami stays warm while Seattle stays wet",
      recommendation: "Miami holds in the low 80s, Denver swings from mild to cold midweek, and Seattle carries the highest rain chances all five days.",
      items: [
        { label: "Miami", value: "82° average high", detail: "30% peak rain chance", recommended: false },
        { label: "Denver", value: "52° average high", detail: "20% peak rain chance", recommended: false },
        { label: "Seattle", value: "49° average high", detail: "80% peak rain chance", recommended: false },
      ],
    },
    {
      id: "trend-chart",
      component: "ComparisonChart",
      variant: "line",
      title: "Five-day highs",
      labels: ["Wed", "Thu", "Fri", "Sat", "Sun"],
      series: [
        { label: "Miami", values: [83, 82, 82, 81, 82] },
        { label: "Denver", values: [58, 55, 47, 49, 53] },
        { label: "Seattle", values: [50, 49, 48, 49, 50] },
      ],
      unit: "°F",
    },
    {
      id: "trend-table",
      component: "ComparisonTable",
      caption: "Five-day highs table alternative",
      columns: ["City", "Wed", "Thu", "Fri", "Sat", "Sun"],
      rows: [
        ["Miami", "83°F", "82°F", "82°F", "81°F", "82°F"],
        ["Denver", "58°F", "55°F", "47°F", "49°F", "53°F"],
        ["Seattle", "50°F", "49°F", "48°F", "49°F", "50°F"],
      ],
    },
    {
      id: "trend-sources",
      component: "SourceList",
      label: "Weather data · Recorded Nov 17",
      sourceIds: [showcaseWeatherSource.id],
    },
  ],
};

/** "Compare Vercel and Cloudflare Pages..." — comparison.scorecard */
export const hostingScorecardSpec: SurfaceSpec = {
  kind: "comparison",
  rootId: "hosting-root",
  components: [
    {
      id: "hosting-root",
      component: "SurfaceFrame",
      recipeId: "comparison.scorecard",
      density: "detailed",
      emphasis: "evidence",
      children: ["hosting-summary", "hosting-metrics", "hosting-table", "hosting-sources"],
    },
    {
      id: "hosting-summary",
      component: "ComparisonSummary",
      variant: "balanced",
      title: "Cloudflare Pages is the safer free tier for a business site",
      recommendation: "Cloudflare Pages does not meter static bandwidth and allows commercial use on its free plan. Vercel's free Hobby plan is for personal projects, so a business site needs Pro.",
      items: [
        { label: "Cloudflare Pages", value: "Free, unmetered static bandwidth", detail: "500 builds per month", recommended: true },
        { label: "Vercel", value: "Hobby is non-commercial", detail: "Pro starts at $20 per user per month", recommended: false },
      ],
    },
    {
      id: "hosting-metrics",
      component: "Rail",
      label: "Decision criteria",
      children: ["hosting-bandwidth", "hosting-builds", "hosting-commercial", "hosting-dx"],
    },
    { id: "hosting-bandwidth", component: "Metric", label: "Free bandwidth", value: "Cloudflare", detail: "Unmetered vs 100 GB", accent: "coral" },
    { id: "hosting-builds", component: "Metric", label: "Builds", value: "Different meters", detail: "500 builds vs build minutes", accent: "neutral" },
    { id: "hosting-commercial", component: "Metric", label: "Business use", value: "Cloudflare", detail: "Allowed on the free plan", accent: "blue" },
    { id: "hosting-dx", component: "Metric", label: "Next.js workflow", value: "Vercel", detail: "Tightest framework integration", accent: "neutral" },
    {
      id: "hosting-table",
      component: "ComparisonTable",
      caption: "Free-tier scorecard",
      columns: ["Criterion", "Cloudflare Pages", "Vercel"],
      rows: [
        ["Static bandwidth", "Unmetered", "100 GB per month on Hobby"],
        ["Builds", "500 per month, 1 concurrent", "Metered by build minutes"],
        ["Commercial use", "Allowed on free plan", "Requires Pro"],
        ["Upgrade path", "$5 Workers Paid", "$20 per user Pro"],
      ],
    },
    {
      id: "hosting-sources",
      component: "SourceList",
      label: "Official plan documentation",
      sourceIds: [cloudflarePagesSource.id, vercelLimitsSource.id],
    },
  ],
};

/** "Do four-day work weeks improve productivity?..." — research.claims */
export const fourDayWeekClaimsSpec: SurfaceSpec = {
  kind: "research",
  rootId: "fourday-root",
  components: [
    {
      id: "fourday-root",
      component: "SurfaceFrame",
      recipeId: "research.claims",
      density: "detailed",
      emphasis: "evidence",
      children: ["fourday-lead", "fourday-evidence", "fourday-sources"],
    },
    {
      id: "fourday-lead",
      component: "ResearchLead",
      variant: "feature",
      title: "Trials report steady output and better wellbeing, but the evidence is not yet causal",
      summary: "Large voluntary pilots found most companies kept the schedule and reported maintained productivity. Reviewers note the firms opted in and there was no randomized comparison group.",
      sourceIds: [fourDayWeekSource.id, fourDaySkepticSource.id],
    },
    {
      id: "fourday-evidence",
      component: "EvidenceList",
      variant: "for-against",
      label: "Evidence by side",
      items: [
        {
          title: "Supports: most companies kept the four-day week",
          finding: "In a 141-company, six-country study, 90 percent of firms kept the arrangement after the six-month trial.",
          sourceId: fourDayWeekSource.id,
          stance: "support",
        },
        {
          title: "Supports: lower burnout without lost pay",
          finding: "The same study found reduced burnout and better job satisfaction and health after the switch.",
          sourceId: fourDayWeekSource.id,
          stance: "support",
        },
        {
          title: "Challenges: firms chose to participate",
          finding: "The 2022 UK pilot compared participants before and after, rather than against randomly assigned firms that kept five days.",
          sourceId: fourDaySkepticSource.id,
          stance: "challenge",
        },
      ],
    },
    {
      id: "fourday-sources",
      component: "SourceList",
      label: "Sources",
      sourceIds: [fourDayWeekSource.id, fourDaySkepticSource.id],
    },
  ],
};
