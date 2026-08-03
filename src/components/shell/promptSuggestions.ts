export interface PromptSuggestion {
  id: string;
  label: string;
  prompt: string;
  description?: string;
}

export const DEFAULT_PROMPT_SUGGESTIONS: readonly PromptSuggestion[] = [
  {
    id: "weather-raleigh-walk",
    label: "Weather",
    prompt: "When should I take a walk in Raleigh today?",
  },
  {
    id: "weather-city-comparison",
    label: "Comparison",
    prompt: "Compare this weekend’s weather in Raleigh and Asheville.",
  },
  {
    id: "gemini-current-research",
    label: "Research",
    prompt: "What changed in Gemini 3.6 Flash?",
  },
];

/** Six secondary prompts that showcase the recipes not covered by the starters. */
export const MORE_EXAMPLE_PROMPT_SUGGESTIONS: readonly PromptSuggestion[] = [
  {
    id: "weather-raleigh-snapshot",
    label: "Weather",
    prompt: "What does the weather look like in Raleigh right now?",
    description: "A concise current-conditions snapshot.",
  },
  {
    id: "weather-raleigh-outlook",
    label: "Weather",
    prompt: "Show Seattle’s seven-day weather outlook in Celsius.",
    description: "A forecast-led view that preserves the requested range and units.",
  },
  {
    id: "comparison-airline-verdict",
    label: "Comparison",
    prompt: "Which airline has the better carry-on policy: Southwest or Delta?",
    description: "A grounded verdict with the decisive policy differences.",
  },
  {
    id: "comparison-a2ui-scorecard",
    label: "Comparison",
    prompt: "Compare React and Angular for an A2UI v0.9.1 client across setup, ecosystem, accessibility, and bundle tradeoffs.",
    description: "A criterion-by-criterion implementation scorecard.",
  },
  {
    id: "research-artemis-timeline",
    label: "Research",
    prompt: "Build a timeline of the major Artemis II schedule announcements.",
    description: "A sourced chronology of how the mission schedule changed.",
  },
  {
    id: "research-pluto-claims",
    label: "Research",
    prompt: "What evidence supports and challenges Pluto’s classification as a dwarf planet?",
    description: "Claims organized by supporting and challenging evidence.",
  },
];
