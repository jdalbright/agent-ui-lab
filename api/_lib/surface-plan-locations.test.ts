import { describe, expect, it } from "vitest";
import { requestedPromptLocations } from "./surface-plan.js";

describe("requestedPromptLocations", () => {
  it("does not mistake an activity phrase after 'weather for' for a place", () => {
    expect(
      requestedPromptLocations(
        "Raleigh, Asheville, or Wilmington: which has the best weather for a getaway this Saturday and Sunday?",
      ),
    ).not.toContain("getaway");
  });

  it("still reads a place after 'weather in'", () => {
    expect(requestedPromptLocations("What is the weather in Raleigh right now?")).toEqual(["Raleigh"]);
  });

  it("still reads chart locations", () => {
    expect(
      requestedPromptLocations("Chart the next five days of highs for Miami, Denver, and Seattle."),
    ).toEqual(expect.arrayContaining(["Miami", "Denver", "Seattle"]));
  });
});
