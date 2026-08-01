import { BookOpen, Plus } from "lucide-react";
import { clsx } from "clsx";

import "./shell.css";

export interface AppHeaderProps {
  onNewPrompt: () => void;
  onOpenInspector: () => void;
  inspectorOpen?: boolean;
  inspectorId?: string;
  newPromptDisabled?: boolean;
  className?: string;
}

export function AppHeader({
  onNewPrompt,
  onOpenInspector,
  inspectorOpen = false,
  inspectorId = "agent-ui-inspector",
  newPromptDisabled = false,
  className,
}: AppHeaderProps) {
  return (
    <header className={clsx("agent-shell-header", className)}>
      <div className="agent-shell-header__brand" aria-label="Agent UI Lab by Jacob Albright">
        <span className="agent-shell-header__title">Agent UI Lab</span>
        <span className="agent-shell-header__byline">by Jacob Albright</span>
      </div>

      <nav className="agent-shell-header__actions" aria-label="Lab actions">
        <button
          className="agent-shell-header__action agent-shell-header__action--new"
          type="button"
          onClick={onNewPrompt}
          disabled={newPromptDisabled}
          aria-label="New prompt"
        >
          <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
          <span className="agent-shell-header__action-label agent-shell-header__action-label--new">
            New prompt
          </span>
        </button>
        <button
          className="agent-shell-header__action agent-shell-header__action--inspector"
          type="button"
          onClick={onOpenInspector}
          aria-haspopup="dialog"
          aria-expanded={inspectorOpen}
          aria-controls={inspectorId}
        >
          <BookOpen size={16} strokeWidth={1.7} aria-hidden="true" />
          <span className="agent-shell-header__action-label">How it worked</span>
        </button>
      </nav>
    </header>
  );
}
