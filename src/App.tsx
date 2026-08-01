import { useCallback, useMemo, useRef, useState } from "react";
import type { A2uiMessage, ClientContext, StreamEvent, TraceRecord } from "@shared/schemas";
import { LIMITS } from "@shared/constants";
import {
  AppHeader,
  EmptyState,
  InspectorDrawer,
  LiveStatus,
  PromptComposer,
  type LiveStatusPhase,
  type PromptSuggestion,
  type SafeUiStructureItem,
} from "@/components/shell";
import { SurfaceRenderer } from "@/lib/a2ui";
import { AgentStreamError, streamAgent } from "@/lib/agent-client";
import { getClientContext, requestCoordinates } from "@/lib/client-context";

type Notice = {
  message: string;
  retryable: boolean;
  partial?: boolean;
  code?: string;
};

function structureFromMessages(messages: readonly A2uiMessage[]): SafeUiStructureItem[] {
  const componentMessage = [...messages]
    .reverse()
    .find((message) => "updateComponents" in message);
  if (!componentMessage || !("updateComponents" in componentMessage)) return [];
  const components = componentMessage.updateComponents.components;
  const byId = new Map<string, Record<string, unknown>>();
  for (const candidate of components) {
    const id = typeof candidate.id === "string" ? candidate.id : undefined;
    if (id) byId.set(id, candidate);
  }

  const depthById = new Map<string, number>();
  const visit = (id: string, depth: number) => {
    if (depthById.has(id) || depth > LIMITS.surfaceDepth) return;
    depthById.set(id, depth);
    const node = byId.get(id);
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (typeof child === "string") visit(child, depth + 1);
    }
  };
  visit("root", 0);

  return components.flatMap((candidate) => {
    const id = typeof candidate.id === "string" ? candidate.id : undefined;
    const component = typeof candidate.component === "string" ? candidate.component : undefined;
    if (!id || !component) return [];
    return [
      {
        id,
        component,
        depth: depthById.get(id) ?? 0,
        childCount: Array.isArray(candidate.children) ? candidate.children.length : 0,
      },
    ];
  });
}

function phaseFromEvent(event: StreamEvent): LiveStatusPhase | undefined {
  if (event.type === "error") return "error";
  if (event.type === "done") return "complete";
  if (event.type !== "status") return undefined;
  switch (event.stage) {
    case "accepted":
    case "understanding":
      return "thinking";
    case "retrieving":
      return "retrieving";
    case "composing":
      return "rendering";
    case "validating":
      return "validating";
    case "rendering":
      return "rendering";
  }
}

function safeActionSuggestion(action: unknown): string | undefined {
  if (!action || typeof action !== "object") return undefined;
  const name = "name" in action ? action.name : undefined;
  const context = "context" in action ? action.context : undefined;
  if (name !== "selectLocation" || !context || typeof context !== "object") return undefined;
  const suggestion = "suggestion" in context ? context.suggestion : undefined;
  return typeof suggestion === "string" ? suggestion.slice(0, 120) : undefined;
}

export default function App() {
  const [draft, setDraft] = useState("");
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [phase, setPhase] = useState<LiveStatusPhase>("ready");
  const [statusMessage, setStatusMessage] = useState("Ready for a prompt");
  const [messages, setMessages] = useState<A2uiMessage[]>([]);
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [completedMode, setCompletedMode] = useState<string | null>(null);
  const contextTokenRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const lastCoordinatesRef = useRef<ClientContext["coordinates"] | undefined>(undefined);

  const busy = ["thinking", "retrieving", "validating", "rendering"].includes(phase);
  const uiStructure = useMemo(() => structureFromMessages(messages), [messages]);

  const runPrompt = useCallback(async (prompt: string, coordinates?: ClientContext["coordinates"]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = crypto.randomUUID();

    setActivePrompt(prompt);
    setDraft("");
    setPhase("thinking");
    setStatusMessage("Understanding your request");
    setMessages([]);
    setTraces([]);
    setNotice(null);
    setCompletedMode(null);
    window.scrollTo({ top: 0, behavior: "auto" });
    if (coordinates) lastCoordinatesRef.current = coordinates;

    let receivedDone = false;
    let receivedSurface = false;
    try {
      const request = {
        requestId,
        prompt,
        ...(contextTokenRef.current ? { contextToken: contextTokenRef.current } : {}),
        client: getClientContext(coordinates ?? lastCoordinatesRef.current),
      };

      for await (const event of streamAgent(request, controller.signal)) {
        const nextPhase = phaseFromEvent(event);
        if (nextPhase) setPhase(nextPhase);

        if (event.type === "status") {
          setStatusMessage(event.message);
        } else if (event.type === "trace") {
          setTraces((current) => [...current.filter((trace) => trace.id !== event.trace.id), event.trace]);
        } else if (event.type === "a2ui") {
          receivedSurface = true;
          setMessages((current) => [...current, event.message]);
        } else if (event.type === "context") {
          contextTokenRef.current = event.token;
        } else if (event.type === "error") {
          setNotice({ message: event.message, retryable: event.retryable, code: event.code, partial: receivedSurface });
        } else if (event.type === "done") {
          receivedDone = true;
          setCompletedMode(event.mode);
          setStatusMessage("Answer ready");
        }
      }
      if (!receivedDone) {
        throw new AgentStreamError("The stream ended before the response was complete.", {
          partial: receivedSurface,
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const streamError =
        error instanceof AgentStreamError
          ? error
          : new AgentStreamError("The agent could not complete this request.");
      setPhase("error");
      setStatusMessage(streamError.partial ? "Showing the available partial result" : "Request interrupted");
      setNotice({
        message: streamError.partial
          ? `${streamError.message} The validated components received so far remain available.`
          : streamError.message,
        retryable: streamError.retryable,
        partial: streamError.partial,
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    contextTokenRef.current = undefined;
    lastCoordinatesRef.current = undefined;
    setDraft("");
    setActivePrompt(null);
    setPhase("ready");
    setStatusMessage("Ready for a prompt");
    setMessages([]);
    setTraces([]);
    setNotice(null);
    setCompletedMode(null);
  }, []);

  const handleSuggestion = useCallback(
    (suggestion: PromptSuggestion) => {
      void runPrompt(suggestion.prompt);
    },
    [runPrompt],
  );

  const requestLocationAndRetry = useCallback(async () => {
    if (!activePrompt) return;
    try {
      setStatusMessage("Waiting for location permission");
      const coordinates = await requestCoordinates();
      await runPrompt(activePrompt, coordinates);
    } catch {
      setPhase("error");
      setNotice({
        code: "LOCATION_DENIED",
        message: "Location access was not available. Add a city or region to your prompt instead.",
        retryable: false,
      });
    }
  }, [activePrompt, runPrompt]);

  const handleA2uiAction = useCallback(
    async (action: unknown) => {
      const suggestion = safeActionSuggestion(action);
      if (!suggestion || !activePrompt) return;
      if (suggestion.toLowerCase().includes("current location")) {
        await requestLocationAndRetry();
        return;
      }
      await runPrompt(`${activePrompt} Use ${suggestion}.`);
    },
    [activePrompt, requestLocationAndRetry, runPrompt],
  );

  const promptComposer = (
    <PromptComposer
      value={draft}
      onValueChange={setDraft}
      onSubmit={runPrompt}
      isSubmitting={busy}
      maxLength={LIMITS.promptCharacters}
      autoFocus={false}
    />
  );

  return (
    <div className="lab-app" data-inspector-open={inspectorOpen ? "true" : "false"}>
      <AppHeader
        onNewPrompt={reset}
        onOpenInspector={() => setInspectorOpen(true)}
        inspectorOpen={inspectorOpen}
      />

      <main className="lab-main">
        {!activePrompt ? (
          <>
            <EmptyState onSelectSuggestion={handleSuggestion} composer={promptComposer} />
            <footer className="lab-empty-footer">
              Built with Gemini 3.6 Flash <span aria-hidden="true">·</span> A2UI v0.9.1
            </footer>
          </>
        ) : (
          <article className="lab-answer" aria-labelledby="active-question">
            <h1 id="active-question" className="lab-answer__question">
              {activePrompt}
            </h1>

            {busy && messages.length === 0 ? (
              <div className="lab-loading" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ) : null}

            {messages.length > 0 ? (
              <SurfaceRenderer
                messages={messages}
                onAction={handleA2uiAction}
                onError={() =>
                  setNotice({
                    message: "The generated surface was rejected. A safe answer is still available by retrying.",
                    retryable: true,
                  })
                }
              />
            ) : null}

            {notice ? (
              <aside className="lab-notice" data-partial={notice.partial ? "true" : "false"} role="alert">
                <p>{notice.message}</p>
                <div className="lab-notice__actions">
                  {notice.retryable && activePrompt ? (
                    <button type="button" onClick={() => void runPrompt(activePrompt)}>
                      Retry
                    </button>
                  ) : null}
                  {notice.code === "LOCATION_AMBIGUOUS" || notice.code === "LOCATION_DENIED" ? (
                    <button type="button" onClick={() => void requestLocationAndRetry()}>
                      Use my location
                    </button>
                  ) : null}
                </div>
              </aside>
            ) : null}

            {busy || phase === "error" ? (
              <div className="lab-answer__status">
                <LiveStatus phase={phase} label={statusMessage} />
              </div>
            ) : null}

            <div className="lab-answer__composer">
              {promptComposer}
              {completedMode === "recorded-fixture" ? (
                <span className="lab-fixture-note">Recorded provider fixture</span>
              ) : null}
            </div>
          </article>
        )}
      </main>

      <InspectorDrawer
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        trace={traces}
        uiStructure={uiStructure}
      />
    </div>
  );
}
