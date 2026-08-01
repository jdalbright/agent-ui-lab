import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppHeader } from "./AppHeader";
import { EmptyState } from "./EmptyState";
import { InspectorDrawer } from "./InspectorDrawer";
import type { SafeTraceEntry } from "./InspectorDrawer";
import { LiveStatus } from "./LiveStatus";
import { PromptComposer } from "./PromptComposer";

afterEach(cleanup);

describe("deterministic shell", () => {
  it("exposes the masthead actions with inspector state", async () => {
    const user = userEvent.setup();
    const onNewPrompt = vi.fn();
    const onOpenInspector = vi.fn();

    render(
      <AppHeader
        onNewPrompt={onNewPrompt}
        onOpenInspector={onOpenInspector}
        inspectorOpen
      />,
    );

    expect(screen.getByLabelText("Agent UI Lab by Jacob Albright")).toBeInTheDocument();
    const newPrompt = screen.getByRole("button", { name: "New prompt" });
    const inspector = screen.getByRole("button", { name: "How it worked" });
    expect(inspector).toHaveAttribute("aria-expanded", "true");

    await user.click(newPrompt);
    await user.click(inspector);

    expect(onNewPrompt).toHaveBeenCalledOnce();
    expect(onOpenInspector).toHaveBeenCalledOnce();
  });

  it("submits a trimmed prompt with Enter and preserves Shift + Enter for new lines", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <PromptComposer value="  Plan my morning  " onValueChange={vi.fn()} onSubmit={onSubmit} />,
    );

    const field = screen.getByRole("textbox", { name: "Prompt" });
    await user.click(field);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Plan my morning");
  });

  it("does not submit an empty or busy composer", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <PromptComposer value="   " onValueChange={vi.fn()} onSubmit={onSubmit} />,
    );

    expect(screen.getByRole("button", { name: "Send prompt" })).toBeDisabled();

    rerender(
      <PromptComposer
        value="A real prompt"
        onValueChange={vi.fn()}
        onSubmit={onSubmit}
        isSubmitting
      />,
    );
    expect(screen.getByRole("button", { name: "Working" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeDisabled();
  });

  it("uses the approved composer limit, placeholder, and empty-state copy", () => {
    render(
      <EmptyState
        onSelectSuggestion={vi.fn()}
        composer={<PromptComposer value="" onValueChange={vi.fn()} onSubmit={vi.fn()} />}
      />,
    );

    const field = screen.getByRole("textbox", { name: "Prompt" });
    expect(field).toHaveAttribute("maxlength", "1000");
    expect(field).toHaveAttribute(
      "placeholder",
      "Ask for weather, comparisons, or current research…",
    );
    expect(screen.getByRole("heading", { name: "What would you like to explore?" })).toBeVisible();
    expect(
      screen.getByText("Ask naturally. The interface will shape itself around the answer."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /When should I take a walk in Raleigh today\?/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /Compare this weekend’s weather in Raleigh and Asheville\./i,
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /What changed in Gemini 3\.6 Flash\?/i })).toBeVisible();
  });

  it("returns the complete suggestion object", async () => {
    const user = userEvent.setup();
    const onSelectSuggestion = vi.fn();
    const suggestion = {
      id: "weather",
      label: "Plan around weather",
      prompt: "Plan my walk around the forecast.",
      description: "A practical plan.",
    } as const;

    render(<EmptyState suggestions={[suggestion]} onSelectSuggestion={onSelectSuggestion} />);
    await user.click(screen.getByRole("button", { name: /Plan around weather/i }));

    expect(onSelectSuggestion).toHaveBeenCalledWith(suggestion);
  });

  it("announces live work without using an assertive alert", () => {
    render(<LiveStatus phase="validating" detail="Checking the component contract" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Validating the response");
    expect(status).toHaveTextContent("Checking the component contract");
  });
});

describe("InspectorDrawer", () => {
  const trace: readonly SafeTraceEntry[] = [
    {
      id: "request",
      stage: "request",
      label: "Request accepted",
      status: "complete",
      durationMs: 12,
    },
    {
      id: "render",
      stage: "render",
      label: "Rendering trusted components",
      status: "running",
      componentCount: 4,
      warningCount: 0,
    },
  ];

  function InspectorHarness() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open inspector
        </button>
        <InspectorDrawer
          open={open}
          onClose={() => setOpen(false)}
          trace={trace}
          uiStructure={[
            { id: "root", component: "Stack", childCount: 1 },
            { id: "heading", component: "EditorialHeading", depth: 1 },
          ]}
        />
      </>
    );
  }

  it("opens as a modal, moves focus inside, closes on Escape, and restores focus", async () => {
    const user = userEvent.setup();
    render(<InspectorHarness />);

    const trigger = screen.getByRole("button", { name: "Open inspector" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "How it worked" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: "Close inspector" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "How it worked" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("supports arrow-key tab navigation and exposes structure without component props", async () => {
    const user = userEvent.setup();
    render(
      <InspectorDrawer
        open
        onClose={vi.fn()}
        trace={trace}
        uiStructure={[{ id: "heading", component: "EditorialHeading", childCount: 0 }]}
      />,
    );

    const traceTab = screen.getByRole("tab", { name: /Trace/i });
    traceTab.focus();
    await user.keyboard("{ArrowRight}");

    const structureTab = screen.getByRole("tab", { name: "UI Structure" });
    expect(structureTab).toHaveFocus();
    expect(structureTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("EditorialHeading");
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent("heading");
  });

  it("traps backward focus at the start of the modal", async () => {
    const user = userEvent.setup();
    render(<InspectorDrawer open onClose={vi.fn()} trace={trace} />);

    const dialog = screen.getByRole("dialog");
    const closeButton = within(dialog).getByRole("button", { name: "Close inspector" });
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("tabpanel")).toHaveFocus();
  });

  it("shows approved trace facts while excluding hidden prompts, thoughts, and credentials", () => {
    const traceWithUnsafeFields = [
      {
        id: "request",
        stage: "tool",
        label: "Weather context retrieved",
        status: "complete",
        durationMs: 248,
        toolName: "google_search",
        arguments: {
          query: "Raleigh weather",
          authorization: "Bearer credential-that-must-never-render",
        },
        sourceIds: ["source-weather-01"],
        componentNames: ["ForecastTimeline"],
        validation: { valid: true, repairCount: 0, issues: [] },
        prompt: "DO NOT RENDER THIS PROMPT",
        thoughts: "DO NOT RENDER THESE THOUGHTS",
      },
    ] as unknown as readonly SafeTraceEntry[];

    render(<InspectorDrawer open onClose={vi.fn()} trace={traceWithUnsafeFields} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("google_search");
    expect(dialog).toHaveTextContent("Raleigh weather");
    expect(dialog).toHaveTextContent("source-weather-01");
    expect(dialog).toHaveTextContent("ForecastTimeline");
    expect(dialog).toHaveTextContent("Passed · 0 repairs");
    expect(dialog).toHaveTextContent("248 ms");
    expect(dialog).toHaveTextContent("[redacted]");
    expect(dialog).not.toHaveTextContent("credential-that-must-never-render");
    expect(dialog).not.toHaveTextContent("DO NOT RENDER");
  });

  it("closes from the backdrop", () => {
    const onClose = vi.fn();
    render(<InspectorDrawer open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close How it worked" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
