import { Send } from "lucide-react";
import { useId } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import "./shell.css";

export interface PromptComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (prompt: string) => void | Promise<void>;
  disabled?: boolean;
  isSubmitting?: boolean;
  maxLength?: number;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

export function PromptComposer({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  isSubmitting = false,
  maxLength = 1_000,
  label = "Prompt",
  placeholder = "Ask for weather, comparisons, or current research…",
  autoFocus = false,
}: PromptComposerProps) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const countId = `${fieldId}-count`;
  const normalizedPrompt = value.trim();
  const canSubmit = normalizedPrompt.length > 0 && !disabled && !isSubmitting;

  const submitPrompt = () => {
    if (canSubmit) {
      void onSubmit(normalizedPrompt);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitPrompt();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    submitPrompt();
  };

  return (
    <form
      className="agent-prompt-composer"
      onSubmit={handleSubmit}
      aria-label="Ask Agent UI Lab"
      aria-busy={isSubmitting}
    >
      <label className="agent-shell-sr-only" htmlFor={fieldId}>
        {label}
      </label>
      <div className="agent-prompt-composer__row">
        <textarea
          id={fieldId}
          className="agent-prompt-composer__field"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={1}
          disabled={disabled || isSubmitting}
          aria-describedby={`${hintId} ${countId}`}
          autoFocus={autoFocus}
        />
        <button
          className="agent-prompt-composer__submit"
          type="submit"
          disabled={!canSubmit}
          aria-label={isSubmitting ? "Working" : "Send prompt"}
        >
          <span className="agent-shell-sr-only">{isSubmitting ? "Working" : "Send"}</span>
          <Send size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <div
        className="agent-prompt-composer__meta"
        data-near-limit={value.length >= maxLength * 0.9 ? "true" : "false"}
      >
        <span id={hintId} className="agent-prompt-composer__hint">
          Enter to send · Shift + Enter for a new line
        </span>
        <span id={countId} className="agent-prompt-composer__count" aria-live="off">
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}
        </span>
      </div>
    </form>
  );
}
