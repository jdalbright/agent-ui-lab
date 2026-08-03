import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const RECIPE_CASES = [
  {
    recipeId: "weather.snapshot",
    prompt: "What does the weather look like in Raleigh right now?",
  },
  {
    recipeId: "weather.decision",
    prompt: "When should I take a walk in Raleigh today?",
  },
  {
    recipeId: "weather.outlook",
    prompt: "Show Seattle’s seven-day weather outlook in Celsius.",
  },
  {
    recipeId: "comparison.verdict",
    prompt: "Which airline has the better carry-on policy: Southwest or Delta?",
  },
  {
    recipeId: "comparison.scorecard",
    prompt:
      "Compare React and Angular for an A2UI v0.9.1 client across setup, ecosystem, accessibility, and bundle tradeoffs.",
  },
  {
    recipeId: "comparison.trend",
    prompt: "Compare this weekend’s weather in Raleigh and Asheville.",
  },
  {
    recipeId: "research.brief",
    prompt: "What changed in Gemini 3.6 Flash?",
  },
  {
    recipeId: "research.timeline",
    prompt: "Build a timeline of the major Artemis II schedule announcements.",
  },
  {
    recipeId: "research.claims",
    prompt: "What evidence supports and challenges Pluto’s classification as a dwarf planet?",
  },
] as const;

const VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 1_024 },
  { width: 1_440, height: 1_024 },
] as const;

async function openRecordedSurface(page: Page, prompt: string) {
  await page.route("**/api/agent", (route) => route.abort("connectionrefused"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Prompt" });
  await composer.fill(prompt);
  await composer.press("Enter");
}

async function expectNoSeriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.flatMap((node) => node.target),
      })),
  ).toEqual([]);
}

test.describe("nine-recipe visual benchmark", () => {
  test.skip(({ isMobile }) => isMobile, "The explicit viewport matrix runs in Desktop Chrome.");

  for (const recipeCase of RECIPE_CASES) {
    for (const viewport of VIEWPORTS) {
      test(`${recipeCase.recipeId} at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openRecordedSurface(page, recipeCase.prompt);

        const frame = page.locator(`[data-recipe="${recipeCase.recipeId}"]`);
        await expect(frame).toBeVisible({ timeout: 10_000 });
        await expect(page.locator("[data-a2ui-version='v0.9.1']")).toBeVisible();

        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(
          dimensions.clientWidth,
        );
        await expectNoSeriousViolations(page);

        // Keep reference surfaces free of sticky-shell occlusion while accessibility
        // and overflow checks above continue to exercise the real interaction layout.
        await page.addStyleTag({
          content:
            ".agent-shell-header, .lab-answer__composer { position: static !important; inset: auto !important; }",
        });

        await expect(page.locator(".lab-answer")).toHaveScreenshot(
          `${recipeCase.recipeId.replace(".", "-")}-${viewport.width}.png`,
          { animations: "disabled" },
        );
      });
    }
  }
});
