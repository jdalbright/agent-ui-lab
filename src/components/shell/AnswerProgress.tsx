import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import {
  STEP_ORDER,
  stepForStage,
  type AnswerProgressStage,
  type StepKey,
} from "./answerProgressSteps";
import "./shell.css";

export type AnswerProgressSource = "weather" | "search" | "unknown";

export interface AnswerProgressProps {
  /** The latest pipeline stage reported by the server. */
  stage: AnswerProgressStage;
  /** Which retrieval tool the request is using, once known. */
  source?: AnswerProgressSource;
  /** Epoch milliseconds when each step first became active. */
  stepStartedAt: Partial<Record<StepKey, number>>;
  /** Epoch milliseconds when the request started. */
  startedAt: number;
}

function stepLabel(step: StepKey, source: AnswerProgressSource): string {
  switch (step) {
    case "read":
      return "Reading your question";
    case "gather":
      return source === "weather"
        ? "Getting the forecast"
        : source === "search"
          ? "Searching trusted sources"
          : "Gathering what it needs";
    case "compose":
      return "Laying out the answer";
    case "check":
      return "Checking every piece";
  }
}

function seconds(milliseconds: number): string {
  return `${Math.max(0, milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

/**
 * Shows the real pipeline steps while an answer is being built, with how long each
 * took. The surrounding page keeps its own role="status" announcement, so this list
 * is presentational for sighted users and hidden from assistive technology.
 */
export function AnswerProgress({
  stage,
  source = "unknown",
  stepStartedAt,
  startedAt,
}: AnswerProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const activeIndex = STEP_ORDER.indexOf(stepForStage(stage));
  const elapsed = now - startedAt;

  return (
    <div className="agent-answer-progress" aria-hidden="true">
      <div className="agent-answer-progress__ledger">
        <ol className="agent-answer-progress__steps">
          {STEP_ORDER.map((step, index) => {
            const state =
              index < activeIndex
                ? "done"
                : index === activeIndex
                  ? "active"
                  : "pending";
            const started = stepStartedAt[step];
            const next = STEP_ORDER[index + 1];
            const ended = next ? stepStartedAt[next] : undefined;
            const duration =
              state === "done" && started !== undefined && ended !== undefined
                ? seconds(ended - started)
                : state === "active" && started !== undefined
                  ? seconds(now - started)
                  : "";
            return (
              <li
                key={step}
                className="agent-answer-progress__step"
                data-state={state}
              >
                <span className="agent-answer-progress__mark">
                  {state === "done" ? (
                    <Check size={13} strokeWidth={2.4} />
                  ) : null}
                </span>
                <span className="agent-answer-progress__label">
                  {stepLabel(step, source)}
                </span>
                <span className="agent-answer-progress__time">{duration}</span>
              </li>
            );
          })}
        </ol>
        <p className="agent-answer-progress__note">
          {elapsed < 20_000
            ? "Most answers take 15 to 30 seconds."
            : "Still working. Research answers can take a little longer."}
        </p>
      </div>
      <div className="agent-answer-progress__sketch">
        <span className="agent-answer-progress__block agent-answer-progress__block--lead" />
        <span className="agent-answer-progress__block agent-answer-progress__block--wide" />
        <span className="agent-answer-progress__block" />
        <span className="agent-answer-progress__block" />
        <span className="agent-answer-progress__block agent-answer-progress__block--wide" />
      </div>
    </div>
  );
}
