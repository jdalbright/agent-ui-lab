import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";

import "./shell.css";

export type InspectorTab = "trace" | "structure";

export type SafeTraceStage =
  | "request"
  | "model"
  | "tool"
  | "composition"
  | "validation"
  | "render";

export type SafeTraceStatus = "running" | "complete" | "repaired" | "fallback" | "error";

export type SafeTraceArgumentValue = string | number | boolean | null;

export type SafeTraceArguments = Readonly<Record<string, SafeTraceArgumentValue>>;

export interface SafeValidationSummary {
  valid: boolean;
  repairCount: number;
  issues: readonly string[];
}

/**
 * Deliberately narrow: this is the complete set of trace data the inspector can render.
 * Tool arguments must already be sanitized. Thoughts, hidden prompts, and credentials do not
 * belong here, and common credential-shaped argument values receive a second redaction pass.
 */
export interface SafeTraceEntry {
  id: string;
  stage: SafeTraceStage;
  label: string;
  status: SafeTraceStatus;
  durationMs?: number;
  componentCount?: number;
  warningCount?: number;
  toolName?: string;
  arguments?: SafeTraceArguments;
  sourceIds?: readonly string[];
  componentNames?: readonly string[];
  validation?: SafeValidationSummary;
}

/** A content-free summary of one trusted component in the rendered answer tree. */
export interface SafeUiStructureItem {
  id: string;
  component: string;
  depth?: number;
  childCount?: number;
}

export interface InspectorDrawerProps {
  open: boolean;
  onClose: () => void;
  trace?: readonly SafeTraceEntry[];
  uiStructure?: readonly SafeUiStructureItem[];
  initialTab?: InspectorTab;
  id?: string;
}

const TABS: readonly { id: InspectorTab; label: string }[] = [
  { id: "trace", label: "Trace" },
  { id: "structure", label: "UI Structure" },
];

const TRACE_STAGE_LABELS: Record<SafeTraceStage, string> = {
  request: "Request",
  model: "Model",
  tool: "Tool",
  composition: "Composition",
  validation: "Validation",
  render: "Render",
};

const TRACE_STATUS_LABELS: Record<SafeTraceStatus, string> = {
  running: "Running",
  complete: "Complete",
  repaired: "Repaired",
  fallback: "Fallback",
  error: "Needs attention",
};

const CREDENTIAL_NAME_PATTERN = /authorization|cookie|credential|password|secret|token|api.?key/i;
const CREDENTIAL_VALUE_PATTERN =
  /\bbearer\s+\S+|\b(?:sk|AIza)[-_a-z\d]{12,}|\b(?:api[_-]?key|token|secret|password)\b\s*[:=]?\s*\S+/i;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type TreeDepthStyle = CSSProperties & { "--agent-tree-depth": number };

function safeWholeNumber(value: number | undefined, maximum = 999) {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(Math.max(Math.round(value), 0), maximum);
}

function formatDuration(durationMs: number | undefined) {
  const duration = safeWholeNumber(durationMs, 60_000);

  if (duration === null) {
    return null;
  }

  return duration >= 1_000 ? `${(duration / 1_000).toFixed(1)} s` : `${duration} ms`;
}

function safeText(value: string, maximumLength = 160) {
  const normalized = Array.from(value, (character) => {
    const characterCode = character.charCodeAt(0);
    return characterCode < 32 || characterCode === 127 ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > maximumLength
    ? `${normalized.slice(0, maximumLength - 1).trimEnd()}…`
    : normalized;
}

function formatArgument(name: string, argumentValue: SafeTraceArgumentValue) {
  if (CREDENTIAL_NAME_PATTERN.test(name)) {
    return "[redacted]";
  }

  if (argumentValue === null) {
    return "null";
  }

  const value = safeText(String(argumentValue));
  return CREDENTIAL_VALUE_PATTERN.test(value) ? "[redacted]" : value;
}

export function InspectorDrawer({
  open,
  onClose,
  trace = [],
  uiStructure = [],
  initialTab = "trace",
  id = "agent-ui-inspector",
}: InspectorDrawerProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>(initialTab);
  const instanceId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onCloseRef = useRef(onClose);

  const titleId = `${instanceId}-title`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");

      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || !dialogRef.current.contains(activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialogRef.current.contains(activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TABS.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      const nextTab = TABS[nextIndex];
      if (nextTab) {
        setActiveTab(nextTab.id);
        tabRefs.current[nextIndex]?.focus();
      }
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="agent-inspector-layer">
      <button
        className="agent-inspector-backdrop"
        type="button"
        aria-label="Close How it worked"
        tabIndex={-1}
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        id={id}
        className="agent-inspector"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="agent-inspector__grip" aria-hidden="true" />
        <header className="agent-inspector__header">
          <h2 id={titleId} className="agent-inspector__title">
            How it worked
          </h2>
          <button
            ref={closeButtonRef}
            className="agent-inspector__close"
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
          >
            <X size={19} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </header>

        <div className="agent-inspector__tabs" role="tablist" aria-label="Inspector views">
          {TABS.map((tab, index) => {
            const selected = activeTab === tab.id;
            const tabId = `${instanceId}-${tab.id}-tab`;
            const panelId = `${instanceId}-${tab.id}-panel`;

            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                id={tabId}
                className="agent-inspector__tab"
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {tab.label}
                {tab.id === "trace" && trace.length > 0 ? (
                  <span className="agent-inspector__tab-count" aria-label={`${trace.length} steps`}>
                    {trace.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {activeTab === "trace" ? (
          <section
            id={`${instanceId}-trace-panel`}
            className="agent-inspector__panel"
            role="tabpanel"
            aria-labelledby={`${instanceId}-trace-tab`}
            tabIndex={0}
          >
            <p className="agent-inspector__privacy-note">
              Thoughts, hidden prompts, and credentials are excluded. Tool arguments shown here are
              sanitized.
            </p>
            {trace.length > 0 ? (
              <ol className="agent-inspector__trace-list">
                {trace.map((entry, index) => {
                  const duration = formatDuration(entry.durationMs);
                  const componentCount = safeWholeNumber(entry.componentCount);
                  const warningCount = safeWholeNumber(entry.warningCount);
                  const validationRepairCount = safeWholeNumber(entry.validation?.repairCount, 1);
                  const toolName = entry.toolName ? safeText(entry.toolName, 80) : null;
                  const toolArguments = Object.entries(entry.arguments ?? {});
                  const sourceIds = (entry.sourceIds ?? [])
                    .map((sourceId) => safeText(sourceId, 80))
                    .filter(Boolean);
                  const componentNames = (entry.componentNames ?? [])
                    .map((componentName) => safeText(componentName, 80))
                    .filter(Boolean);

                  return (
                    <li
                      className="agent-inspector__trace-item"
                      data-status={entry.status}
                      key={entry.id}
                    >
                      <span className="agent-inspector__trace-index" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="agent-inspector__trace-copy">
                        <span className="agent-inspector__trace-title">
                          {safeText(entry.label, 120)}
                        </span>
                        <span className="agent-inspector__trace-meta">
                          <span>{TRACE_STAGE_LABELS[entry.stage]}</span>
                          <span>{TRACE_STATUS_LABELS[entry.status]}</span>
                          {duration ? <span>{duration}</span> : null}
                          {componentCount !== null ? (
                            <span>
                              {componentCount} component{componentCount === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          {warningCount !== null ? (
                            <span>
                              {warningCount} warning{warningCount === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </span>
                        {toolName ? (
                          <div className="agent-inspector__trace-fact">
                            <span className="agent-inspector__trace-fact-label">Tool</span>
                            <code>{toolName}</code>
                          </div>
                        ) : null}
                        {toolArguments.length > 0 ? (
                          <dl className="agent-inspector__arguments">
                            {toolArguments.map(([argumentName, argumentValue]) => (
                              <div
                                className="agent-inspector__argument"
                                key={argumentName}
                              >
                                <dt>{safeText(argumentName, 60)}</dt>
                                <dd>{formatArgument(argumentName, argumentValue)}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                        {sourceIds.length > 0 ? (
                          <div className="agent-inspector__trace-fact">
                            <span className="agent-inspector__trace-fact-label">Sources</span>
                            <span className="agent-inspector__trace-values">
                              {sourceIds.map((sourceId, sourceIndex) => (
                                <code key={`${sourceId}-${sourceIndex}`}>{sourceId}</code>
                              ))}
                            </span>
                          </div>
                        ) : null}
                        {componentNames.length > 0 ? (
                          <div className="agent-inspector__trace-fact">
                            <span className="agent-inspector__trace-fact-label">Components</span>
                            <span className="agent-inspector__trace-values">
                              {componentNames.map((componentName, componentIndex) => (
                                <code key={`${componentName}-${componentIndex}`}>{componentName}</code>
                              ))}
                            </span>
                          </div>
                        ) : null}
                        {entry.validation ? (
                          <div className="agent-inspector__trace-fact">
                            <span className="agent-inspector__trace-fact-label">Validation</span>
                            <span className="agent-inspector__validation">
                              <span>
                                {entry.validation.valid
                                  ? validationRepairCount && validationRepairCount > 0
                                    ? "Repaired"
                                    : "Passed"
                                  : "Failed"}
                                {validationRepairCount !== null
                                  ? ` · ${validationRepairCount} repair${validationRepairCount === 1 ? "" : "s"}`
                                  : ""}
                              </span>
                              {entry.validation.issues.length > 0 ? (
                                <span className="agent-inspector__validation-issues">
                                  {entry.validation.issues.map((issue, issueIndex) => (
                                    <span key={`${issue}-${issueIndex}`}>{safeText(issue)}</span>
                                  ))}
                                </span>
                              ) : null}
                            </span>
                          </div>
                        ) : null}
                      </span>
                      <span className="agent-inspector__trace-status" aria-hidden="true" />
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="agent-inspector__empty">Run a prompt to see its safe execution trace.</p>
            )}
          </section>
        ) : (
          <section
            id={`${instanceId}-structure-panel`}
            className="agent-inspector__panel"
            role="tabpanel"
            aria-labelledby={`${instanceId}-structure-tab`}
            tabIndex={0}
          >
            <p className="agent-inspector__privacy-note">
              Component names and hierarchy from the trusted UI catalog.
            </p>
            {uiStructure.length > 0 ? (
              <ul className="agent-inspector__tree" aria-label="Trusted component tree">
                {uiStructure.map((item) => {
                  const depth = safeWholeNumber(item.depth, 8) ?? 0;
                  const childCount = safeWholeNumber(item.childCount);
                  const style: TreeDepthStyle = { "--agent-tree-depth": depth };

                  return (
                    <li className="agent-inspector__tree-item" key={item.id} style={style}>
                      <span className="agent-inspector__tree-branch" aria-hidden="true" />
                      <span className="agent-inspector__tree-name">{item.component}</span>
                      {childCount !== null ? (
                        <span className="agent-inspector__tree-count">
                          {childCount} child{childCount === 1 ? "" : "ren"}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="agent-inspector__empty">The component tree will appear with an answer.</p>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
