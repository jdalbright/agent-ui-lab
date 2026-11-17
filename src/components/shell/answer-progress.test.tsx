import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AnswerProgress } from "./AnswerProgress";
import { stepForStage } from "./answerProgressSteps";

afterEach(cleanup);

describe("AnswerProgress", () => {
  it("marks finished, active, and pending steps from the pipeline stage", () => {
    const start = Date.now() - 3_000;
    const { container } = render(
      <AnswerProgress
        stage="composing"
        source="weather"
        startedAt={start}
        stepStartedAt={{ read: start, gather: start + 500, compose: start + 2_000 }}
      />,
    );

    const states = [...container.querySelectorAll(".agent-answer-progress__step")].map((step) =>
      step.getAttribute("data-state"),
    );
    expect(states).toEqual(["done", "done", "active", "pending"]);
    expect(screen.getByText("Getting the forecast")).toBeInTheDocument();
    expect(screen.getByText("0.5 s")).toBeInTheDocument();
    expect(screen.getByText("1.5 s")).toBeInTheDocument();
  });

  it("names the gather step after the search tool and stays out of the accessibility tree", () => {
    const { container } = render(
      <AnswerProgress stage="retrieving" source="search" startedAt={Date.now()} stepStartedAt={{}} />,
    );
    expect(screen.getByText("Searching trusted sources")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("maps server stages onto the four visible steps", () => {
    expect(stepForStage("accepted")).toBe("read");
    expect(stepForStage("retrieving")).toBe("gather");
    expect(stepForStage("composing")).toBe("compose");
    expect(stepForStage("rendering")).toBe("check");
  });
});
