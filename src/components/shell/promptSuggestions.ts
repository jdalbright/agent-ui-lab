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
