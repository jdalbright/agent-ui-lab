import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InspectorDrawer } from "./InspectorDrawer";

afterEach(cleanup);

describe("InspectorDrawer surface-quality metadata", () => {
  it("explains the bounded presentation selection without exposing free-form reasoning", () => {
    render(
      <InspectorDrawer
        open
        onClose={() => undefined}
        trace={[
          {
            id: "composition-plan-v2",
            stage: "composition",
            label: "Compose interface",
            status: "complete",
            recipeId: "weather.decision",
            density: "balanced",
            emphasis: "decision",
            qualityChecks: [
              { code: "answer_first", passed: true },
              { code: "citation_coverage", passed: true },
            ],
            repairCategory: "none",
            compilerResult: "compiled",
          },
        ]}
      />,
    );

    expect(screen.getByText("Recipe")).toBeVisible();
    expect(screen.getByText("weather.decision")).toBeVisible();
    expect(screen.getByText("Balanced · Decision")).toBeVisible();
    expect(screen.getByText("Quality checks")).toBeVisible();
    expect(screen.getByText("2 of 2 passed")).toBeVisible();
    expect(screen.getByText("Compiled · No repair")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/reasoning|chain of thought|private prompt/i);
  });
});
