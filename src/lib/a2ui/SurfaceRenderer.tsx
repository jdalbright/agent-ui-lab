import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { A2uiSurface, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import {
  MessageProcessor,
  type A2uiClientAction,
  type SurfaceModel,
} from "@a2ui/web_core/v0_9";
import { A2UI_VERSION } from "@shared/constants";
import { trustedCatalog } from "./catalog";
import { parseTrustedMessages } from "./message-validation";

type TrustedSurface = SurfaceModel<ReactComponentImplementation>;
type ActionHandler = (action: A2uiClientAction) => void | Promise<void>;

export type SurfaceRendererProps = Readonly<{
  messages: readonly unknown[];
  onAction?: ActionHandler;
  onError?: (error: Error) => void;
  className?: string;
  emptyState?: ReactNode;
}>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unknown trusted renderer error.");
}

export function SurfaceRenderer({
  messages,
  onAction,
  onError,
  className,
  emptyState,
}: SurfaceRendererProps) {
  const reportedFailure = useRef<string | null>(null);

  const rendered = useMemo<{ failure: Error | null; surfaces: TrustedSurface[] }>(() => {
    try {
      const parsedMessages = parseTrustedMessages(messages);
      const processor = new MessageProcessor([trustedCatalog], onAction, { version: A2UI_VERSION });
      processor.processMessages(parsedMessages);
      return { failure: null, surfaces: [...processor.model.surfacesMap.values()] };
    } catch (error) {
      return { failure: toError(error), surfaces: [] };
    }
  }, [messages, onAction]);

  useEffect(() => {
    if (!rendered.failure) {
      reportedFailure.current = null;
      return;
    }
    const signature = `${rendered.failure.name}:${rendered.failure.message}`;
    if (reportedFailure.current !== signature) {
      reportedFailure.current = signature;
      onError?.(rendered.failure);
    }
  }, [onError, rendered.failure]);

  if (rendered.failure) {
    return (
      <div className={["a2ui-surface", "a2ui-render-error", className].filter(Boolean).join(" ")} role="alert">
        <strong>This surface could not be rendered safely.</strong>
        <span>Try the request again or use the text response.</span>
      </div>
    );
  }

  return (
    <div
      className={["a2ui-surface", className].filter(Boolean).join(" ")}
      data-a2ui-version={A2UI_VERSION}
    >
      {rendered.surfaces.length > 0
        ? rendered.surfaces.map((surface) => <A2uiSurface key={surface.id} surface={surface} />)
        : (emptyState ?? (
            <p className="a2ui-render-empty" role="status">
              Waiting for a trusted surface…
            </p>
          ))}
    </div>
  );
}
