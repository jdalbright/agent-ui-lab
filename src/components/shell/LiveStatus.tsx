import "./shell.css";

export type LiveStatusPhase =
  | "ready"
  | "thinking"
  | "retrieving"
  | "validating"
  | "rendering"
  | "complete"
  | "error";

const DEFAULT_STATUS_LABELS: Record<LiveStatusPhase, string> = {
  ready: "Ready for a prompt",
  thinking: "Thinking through the request",
  retrieving: "Checking useful context",
  validating: "Validating the response",
  rendering: "Composing the interface",
  complete: "Answer ready",
  error: "Something interrupted the answer",
};

const BUSY_PHASES = new Set<LiveStatusPhase>([
  "thinking",
  "retrieving",
  "validating",
  "rendering",
]);

export interface LiveStatusProps {
  phase: LiveStatusPhase;
  label?: string;
  detail?: string;
}

export function LiveStatus({ phase, label, detail }: LiveStatusProps) {
  const isBusy = BUSY_PHASES.has(phase);

  return (
    <div
      className="agent-live-status"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={isBusy}
    >
      <span className="agent-live-status__indicator" aria-hidden="true" />
      <span className="agent-live-status__copy">
        <span className="agent-live-status__label">{label ?? DEFAULT_STATUS_LABELS[phase]}</span>
        {detail ? <span className="agent-live-status__detail">{detail}</span> : null}
      </span>
    </div>
  );
}
