export interface PromptSuggestion {
  id: string;
  label: string;
  prompt: string;
  description?: string;
}

export const DEFAULT_PROMPT_SUGGESTIONS: readonly PromptSuggestion[] = [
  {
    id: "weather-saturday-ride",
    label: "Weather",
    prompt: "Plan my Saturday in Raleigh: when is the best 3-hour window for a bike ride, and what should I bring?",
  },
  {
    id: "comparison-weekend-getaway",
    label: "Comparison",
    prompt: "Raleigh, Asheville, or Wilmington: which has the best weather for a getaway this Saturday and Sunday?",
  },
  {
    id: "research-gemini-hydrogen",
    label: "Research",
    prompt: "What's new in Gemini 4 Hydrogen, and how does it compare with Gemini 3.8 Flash?",
  },
];

/** Six secondary prompts that show off other layouts and recipes. */
export const MORE_EXAMPLE_PROMPT_SUGGESTIONS: readonly PromptSuggestion[] = [
  {
    id: "weather-raleigh-jacket",
    label: "Weather",
    prompt: "What's it like in Raleigh right now, and do I need a jacket?",
    description: "A current-conditions snapshot with a direct answer.",
  },
  {
    id: "weather-chicago-packing",
    label: "Weather",
    prompt: "I land in Chicago Thursday morning for a four-day trip. Show me what to pack for each day.",
    description: "A day-by-day outlook turned into packing advice.",
  },
  {
    id: "comparison-three-city-trend",
    label: "Comparison",
    prompt: "Chart the next five days of highs and rain chances for Seattle, Denver, and Miami.",
    description: "A three-city chart with a table alternative.",
  },
  {
    id: "comparison-hosting-scorecard",
    label: "Comparison",
    prompt: "Compare Vercel and Cloudflare Pages for a small business website: free-tier limits, pricing, and performance.",
    description: "A criterion-by-criterion scorecard from official docs.",
  },
  {
    id: "research-artemis-timeline",
    label: "Research",
    prompt: "Build a timeline of NASA's Artemis II schedule announcements since 2024.",
    description: "A sourced chronology of how the mission schedule changed.",
  },
  {
    id: "research-four-day-week",
    label: "Research",
    prompt: "Do four-day work weeks improve productivity? Weigh the evidence on both sides.",
    description: "Supporting and challenging evidence, side by side.",
  },
];
