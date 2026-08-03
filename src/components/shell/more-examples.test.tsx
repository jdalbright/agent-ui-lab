import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmptyState } from "./EmptyState";
import type { PromptSuggestion } from "./promptSuggestions";

afterEach(cleanup);

describe("EmptyState more examples disclosure", () => {
  it("keeps six additional examples collapsed until the native disclosure is activated", async () => {
    const user = userEvent.setup();
    render(<EmptyState onSelectSuggestion={vi.fn()} />);

    const disclosure = screen.getByRole("button", { name: "More examples" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(disclosure).toHaveAttribute("aria-controls");
    expect(screen.queryByRole("group", { name: "More examples" })).not.toBeInTheDocument();

    disclosure.focus();
    await user.keyboard("{Enter}");

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    const controlledId = disclosure.getAttribute("aria-controls");
    const examples = screen.getByRole("group", { name: "More examples" });
    expect(examples).toHaveAttribute("id", controlledId);
    expect(within(examples).getAllByRole("button")).toHaveLength(6);
  });

  it("submits the complete additional suggestion and can collapse the region again", async () => {
    const user = userEvent.setup();
    const onSelectSuggestion = vi.fn<(suggestion: PromptSuggestion) => void>();
    render(<EmptyState onSelectSuggestion={onSelectSuggestion} />);

    const disclosure = screen.getByRole("button", { name: "More examples" });
    await user.click(disclosure);
    const examples = screen.getByRole("group", { name: "More examples" });
    const firstExample = within(examples).getAllByRole("button")[0];
    expect(firstExample).toBeDefined();
    if (!firstExample) throw new Error("The first additional example is missing");

    await user.click(firstExample);
    expect(onSelectSuggestion).toHaveBeenCalledOnce();
    const selectedSuggestion = onSelectSuggestion.mock.calls[0]?.[0];
    expect(selectedSuggestion?.id).toEqual(expect.any(String));
    expect(selectedSuggestion?.label).toEqual(expect.any(String));
    expect(selectedSuggestion?.prompt).toEqual(expect.any(String));

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "More examples" })).not.toBeInTheDocument();
    expect(disclosure).toHaveFocus();
  });
});
