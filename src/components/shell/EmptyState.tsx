import { ChartNoAxesColumnIncreasing, CloudSun, FileText } from "lucide-react";
import { useId } from "react";
import type { ReactNode } from "react";

import { DEFAULT_PROMPT_SUGGESTIONS } from "./promptSuggestions";
import type { PromptSuggestion } from "./promptSuggestions";
import "./shell.css";

export interface EmptyStateProps {
  onSelectSuggestion: (suggestion: PromptSuggestion) => void;
  suggestions?: readonly PromptSuggestion[];
  heading?: string;
  description?: string;
  composer?: ReactNode;
}

export function EmptyState({
  onSelectSuggestion,
  suggestions = DEFAULT_PROMPT_SUGGESTIONS,
  heading = "What would you like to explore?",
  description = "Ask naturally. The interface will shape itself around the answer.",
  composer,
}: EmptyStateProps) {
  const headingId = useId();
  const suggestionIcon = (label: string) => {
    if (label === "Weather") return <CloudSun aria-hidden="true" />;
    if (label === "Comparison") return <ChartNoAxesColumnIncreasing aria-hidden="true" />;
    return <FileText aria-hidden="true" />;
  };

  return (
    <section className="agent-empty-state" aria-labelledby={headingId}>
      <h1 id={headingId} className="agent-empty-state__heading">
        {heading}
      </h1>
      <p className="agent-empty-state__description">{description}</p>
      {composer ? <div className="agent-empty-state__composer">{composer}</div> : null}

      {suggestions.length > 0 ? (
        <div className="agent-empty-state__suggestions" role="group" aria-label="Try a prompt">
          {suggestions.map((suggestion) => (
            <button
              className="agent-empty-state__suggestion"
              type="button"
              key={suggestion.id}
              onClick={() => onSelectSuggestion(suggestion)}
            >
              <span className="agent-empty-state__suggestion-icon">{suggestionIcon(suggestion.label)}</span>
              <span className="agent-empty-state__suggestion-copy">
                <span className="agent-empty-state__suggestion-label">{suggestion.prompt}</span>
                <span className="agent-empty-state__suggestion-category">{suggestion.label}</span>
                {suggestion.description ? (
                  <span className="agent-empty-state__suggestion-description">
                    {suggestion.description}
                  </span>
                ) : null}
              </span>
              <span className="agent-empty-state__suggestion-arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
