import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const WEATHER_PROMPT = "When should I take a walk in Raleigh today?";
const COMPARISON_PROMPT = "Compare this weekend’s weather in Raleigh and Asheville.";
const RESEARCH_PROMPT = "What changed in Gemini 3.6 Flash?";

async function forceRecordedProviderFixture(page: Page) {
  await page.route("**/api/agent", (route) => route.abort("connectionrefused"));
}

async function openLabWithFixture(page: Page) {
  await forceRecordedProviderFixture(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What would you like to explore?" })).toBeVisible();
}

async function runSuggestion(page: Page, prompt: string) {
  await page.getByText(prompt, { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: prompt })).toBeVisible();
  await expect(page.locator("[data-a2ui-version='v0.9.1']")).toBeVisible({
    timeout: 10_000,
  });
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.clientWidth,
  );
}

async function expectNoSeriousA11yViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    serious.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap((node) => node.target),
    })),
  ).toEqual([]);
}

test.describe("deterministic shell", () => {
  test("first load presents the three supported starting points", async ({ page, isMobile }) => {
    await openLabWithFixture(page);

    await expect(page).toHaveTitle(/Agent UI Lab/);
    await expect(page.getByText("Agent UI Lab", { exact: true }).first()).toBeVisible();
    const byline = page.getByText("by Jacob Albright", { exact: true });
    if (isMobile) {
      await expect(byline).toBeHidden();
    } else {
      await expect(byline).toBeVisible();
    }
    await expect(page.getByRole("form", { name: "Ask Agent UI Lab" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveAttribute(
      "maxlength",
      "1000",
    );
    await expect(page.getByRole("group", { name: "Try a prompt" }).getByRole("button")).toHaveCount(3);
    await expect(page.getByText(WEATHER_PROMPT, { exact: true })).toBeVisible();
    await expect(page.getByText(COMPARISON_PROMPT, { exact: true })).toBeVisible();
    await expect(page.getByText(RESEARCH_PROMPT, { exact: true })).toBeVisible();
  });

  test("prompt composer keeps Shift+Enter as a newline and Enter submits", async ({ page }) => {
    await openLabWithFixture(page);
    const prompt = page.getByRole("textbox", { name: "Prompt" });

    await prompt.fill("What is the weather");
    await prompt.press("Shift+Enter");
    await prompt.type(" in Raleigh today?");
    await expect(prompt).toHaveValue("What is the weather\n in Raleigh today?");
    await expect(page.getByRole("heading", { name: "What would you like to explore?" })).toBeVisible();

    await prompt.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: /What is the weather\s+in Raleigh today\?/ }),
    ).toBeVisible();
    await expect(page.locator("[data-a2ui-version='v0.9.1']")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("first load and generated weather have no serious axe findings", async ({ page }) => {
    await openLabWithFixture(page);
    await expectNoSeriousA11yViolations(page);
    await runSuggestion(page, WEATHER_PROMPT);
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("recorded suggestion surfaces", () => {
  test.skip(({ isMobile }) => isMobile, "The full suggestion matrix runs once in the desktop project.");

  test("weather suggestion renders a trusted forecast surface", async ({ page }) => {
    await openLabWithFixture(page);
    await runSuggestion(page, WEATHER_PROMPT);

    await expect(page.getByRole("region", { name: "Weather for Raleigh, NC" })).toBeVisible();
    await expect(page.getByText("Best walk window", { exact: true })).toBeVisible();
    await expect(page.getByText("7:30–8:30 PM", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Hourly" })).toBeVisible();
    await expect(page.getByRole("region", { name: "5-day outlook" })).toBeVisible();
    await expect(page.locator("[data-a2ui-version='v0.9.1']")).toBeVisible();
  });

  test("comparison suggestion renders summary, table, and accessible chart data", async ({ page }) => {
    await openLabWithFixture(page);
    await runSuggestion(page, COMPARISON_PROMPT);

    await expect(page.getByText("Asheville is the cooler outdoor pick", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Weekend conditions" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Hourly temperature comparison" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Hourly temperature comparison data" })).toBeVisible();
  });

  test("research suggestion renders evidence with immutable source links", async ({ page }) => {
    await openLabWithFixture(page);
    await runSuggestion(page, RESEARCH_PROMPT);

    await expect(
      page.getByText("Gemini 3.6 Flash sharpened the fast agentic tier", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("What matters", { exact: true })).toBeVisible();
    const modelSource = page
      .getByRole("link", { name: "Gemini 3.6 Flash model documentation", exact: true })
      .last();
    await expect(modelSource).toHaveAttribute(
      "href",
      "https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash",
    );
    await expect(modelSource).toHaveAttribute("rel", /noopener/);
  });
});

test.describe("safe boundaries and clarification", () => {
  test.skip(({ isMobile }) => isMobile, "Boundary flows run once in the desktop project.");

  test("unsupported external action receives the bounded narrative surface", async ({ page }) => {
    await openLabWithFixture(page);
    const prompt = page.getByRole("textbox", { name: "Prompt" });

    await prompt.fill("Buy plane tickets and send the confirmation email for me");
    await prompt.press("Enter");

    await expect(
      page.getByText("This lab cannot complete transactions.", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/cannot book travel, make purchases, or charge a saved card/i)).toBeVisible();
    await expect(page.locator("[data-a2ui-version='v0.9.1']")).toBeVisible();
  });

  test("ambiguous weather request asks for a location and a choice continues the flow", async ({ page }) => {
    await openLabWithFixture(page);
    const prompt = page.getByRole("textbox", { name: "Prompt" });

    await prompt.fill("What is the weather today?");
    await prompt.press("Enter");

    const clarification = page.getByRole("region", { name: "Location clarification" });
    await expect(clarification).toBeVisible({ timeout: 10_000 });
    await expect(clarification.getByText(/Which city and region should I use/)).toBeVisible();
    await clarification.getByRole("button", { name: "Raleigh, NC" }).click();

    await expect(page.getByRole("region", { name: "Weather for Raleigh, NC" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Use Raleigh, NC");
  });
});

test.describe("encrypted follow-up context contract", () => {
  test.skip(({ isMobile }) => isMobile, "The network contract runs once in the desktop project.");

  test("the refreshed context token is sent only with the next in-memory turn", async ({ page }) => {
    const requests: Array<Record<string, unknown>> = [];
    const contextToken = "fixture-context-token-that-is-long-enough-for-validation-1234567890";

    await page.route("**/api/agent", async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      requests.push(request);
      const requestId = String(request.requestId);
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1_000).toISOString();
      const events = [
        { type: "status", stage: "accepted", message: "Request received", at: now },
        { type: "context", token: contextToken, expiresAt },
        {
          type: "done",
          requestId,
          completedAt: now,
          durationMs: 1,
          mode: "live",
          componentCount: 0,
          sourceCount: 0,
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      });
    });

    await page.goto("/");
    const prompt = page.getByRole("textbox", { name: "Prompt" });
    await prompt.fill("First turn");
    await prompt.press("Enter");
    await expect(prompt).toBeEnabled();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).not.toHaveProperty("contextToken");

    await prompt.fill("Follow-up turn");
    await prompt.press("Enter");
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).toMatchObject({ prompt: "Follow-up turn", contextToken });

    await page.getByRole("button", { name: "New prompt" }).click();
    await page.getByRole("textbox", { name: "Prompt" }).fill("Fresh conversation");
    await page.getByRole("textbox", { name: "Prompt" }).press("Enter");
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2]).not.toHaveProperty("contextToken");
  });
});

test.describe("safe inspector", () => {
  test("shows sanitized trace and structure, supports keyboard tabs, and restores focus", async ({ page }) => {
    await openLabWithFixture(page);
    await runSuggestion(page, WEATHER_PROMPT);

    const opener = page.getByRole("button", { name: "How it worked" });
    await opener.focus();
    await opener.press("Enter");
    const dialog = page.getByRole("dialog", { name: "How it worked" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Close inspector" })).toBeFocused();

    const traceTab = dialog.getByRole("tab", { name: /Trace/ });
    const structureTab = dialog.getByRole("tab", { name: "UI Structure" });
    await expect(traceTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByText("get_weather_bundle", { exact: true })).toBeVisible();
    await expect(dialog.getByText("src_googleweather", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Passed · 0 repairs", { exact: true })).toBeVisible();

    await traceTab.focus();
    await traceTab.press("ArrowRight");
    await expect(structureTab).toBeFocused();
    await expect(structureTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("list", { name: "Trusted component tree" })).toContainText(
      "WeatherHero",
    );

    await structureTab.press("Home");
    await expect(traceTab).toBeFocused();
    await expect(traceTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(opener).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("responsive document containment", () => {
  test.skip(({ isMobile }) => isMobile, "Viewport matrix runs once in the desktop project.");

  for (const width of [320, 390, 768, 1440]) {
    test(`has no document-level horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width >= 1_000 ? 1_024 : 844 });
      await openLabWithFixture(page);
      await expectNoDocumentOverflow(page);
      await runSuggestion(page, WEATHER_PROMPT);
      await expectNoDocumentOverflow(page);
    });
  }
});
