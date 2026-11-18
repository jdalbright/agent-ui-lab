import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { UI_QUALITY_CASES, type UiQualityCase, type UiRecipeId } from "../src/evals/ui-quality-cases.js";
import {
  buildRecordedGenerativeUiQualityStream,
  buildRecordedUiQualityStream,
} from "../src/evals/recorded-ui-quality-stream.js";

const RECIPE_CASES = [
  { recipeId: "weather.snapshot", caseId: "QW01" },
  { recipeId: "weather.decision", caseId: "QW03" },
  { recipeId: "weather.outlook", caseId: "QW06" },
  { recipeId: "comparison.verdict", caseId: "QC02" },
  { recipeId: "comparison.scorecard", caseId: "QC04" },
  { recipeId: "comparison.trend", caseId: "QC06" },
  { recipeId: "research.brief", caseId: "QR01" },
  { recipeId: "research.timeline", caseId: "QR03" },
  { recipeId: "research.claims", caseId: "QR05" },
] as const satisfies readonly { readonly recipeId: UiRecipeId; readonly caseId: string }[];

const VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 1_024 },
  { width: 1_440, height: 1_024 },
] as const;

const GRAMMAR_VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 1_024 },
  { width: 1_024, height: 1_024 },
  { width: 1_440, height: 1_024 },
] as const;

const GRAMMAR_CASES = [
  { caseId: "QW01", family: "stack" },
  { caseId: "QC05", family: "grid" },
  { caseId: "QR02", family: "section" },
] as const;

function qualityCase(id: string): UiQualityCase {
  const selected = UI_QUALITY_CASES.find((candidate) => candidate.id === id);
  if (!selected) throw new TypeError(`Unknown recorded UI quality case ${id}.`);
  return selected;
}

async function openRecordedSurface(
  page: Page,
  testCase: UiQualityCase,
  reducedMotion: "reduce" | "no-preference" = "reduce",
) {
  await page.emulateMedia({ reducedMotion });
  await page.route("**/api/agent", async (route) => {
    const stream = buildRecordedUiQualityStream(testCase, route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: `${stream.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    });
  });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Prompt" });
  await composer.fill(testCase.prompt);
  await composer.press("Enter");
}

async function openRecordedGenerativeSurface(
  page: Page,
  testCase: UiQualityCase,
  family: "stack" | "grid" | "section" | "extended",
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/agent", async (route) => {
    const stream = buildRecordedGenerativeUiQualityStream(
      testCase,
      route.request().postDataJSON(),
      family,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: `${stream.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    });
  });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Prompt" });
  await composer.fill(testCase.prompt);
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

function longestCssDuration(value: string): number {
  return Math.max(
    0,
    ...value.split(",").map((part) => {
      const normalized = part.trim();
      const numeric = Number.parseFloat(normalized);
      if (!Number.isFinite(numeric)) return 0;
      return normalized.endsWith("ms") ? numeric : numeric * 1_000;
    }),
  );
}

async function motionStyle(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
      scrollSnapType: style.scrollSnapType,
    };
  });
}

test.describe("nine-recipe visual benchmark", () => {
  test.skip(({ isMobile }) => isMobile, "The explicit viewport matrix runs in Desktop Chrome.");

  for (const recipeCase of RECIPE_CASES) {
    for (const viewport of VIEWPORTS) {
      test(`${recipeCase.recipeId} at ${viewport.width}px`, async ({ page }) => {
        const testCase = qualityCase(recipeCase.caseId);
        expect(testCase.recipeId).toBe(recipeCase.recipeId);
        await page.setViewportSize(viewport);
        await openRecordedSurface(page, testCase);

        const frame = page.locator(`[data-recipe="${recipeCase.recipeId}"]`);
        await expect(frame).toBeVisible({ timeout: 10_000 });
        await expect(frame).toHaveAttribute("data-density", testCase.expected.density);
        await expect(frame).toHaveAttribute("data-emphasis", testCase.expected.emphasis);
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
        await page.evaluate(() => document.fonts.ready);

        await expect(page.locator(".lab-answer")).toHaveScreenshot(
          `${recipeCase.recipeId.replace(".", "-")}-${viewport.width}.png`,
          { animations: "disabled" },
        );
      });
    }
  }
});

test.describe("grammar-v3 responsive benchmark", () => {
  test.skip(({ isMobile }) => isMobile, "The explicit viewport matrix runs in Desktop Chrome.");

  for (const grammarCase of GRAMMAR_CASES) {
    for (const viewport of GRAMMAR_VIEWPORTS) {
      test(`${grammarCase.caseId} ${grammarCase.family} at ${viewport.width}px`, async ({ page }) => {
        const testCase = qualityCase(grammarCase.caseId);
        await page.setViewportSize(viewport);
        await openRecordedGenerativeSurface(page, testCase, grammarCase.family);

        const frame = page.locator('[data-composition-mode="grammar-v3"]');
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

        await page.addStyleTag({
          content:
            ".agent-shell-header, .lab-answer__composer { position: static !important; inset: auto !important; }",
        });
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator(".lab-answer")).toHaveScreenshot(
          `grammar-v3-${grammarCase.caseId.toLocaleLowerCase("en-US")}-${grammarCase.family}-${viewport.width}.png`,
          { animations: "disabled" },
        );
      });
    }
  }
});

// The extended toolkit is gated by overflow, accessibility, interaction, and
// reference screenshots generated on CI's Chromium (update-screenshots.yml).
test.describe("grammar-v3 extended toolkit", () => {
  test.skip(({ isMobile }) => isMobile, "The explicit viewport matrix runs in Desktop Chrome.");

  for (const caseId of ["QR02", "QC04"] as const) {
    for (const viewport of GRAMMAR_VIEWPORTS) {
      test(`${caseId} extended at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openRecordedGenerativeSurface(page, qualityCase(caseId), "extended");

        const frame = page.locator('[data-composition-mode="grammar-v3"]');
        await expect(frame).toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".a2ui-columns")).toBeVisible();
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(
          dimensions.clientWidth,
        );
        await expectNoSeriousViolations(page);

        await page.addStyleTag({
          content:
            ".agent-shell-header, .lab-answer__composer { position: static !important; inset: auto !important; }",
        });
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator(".lab-answer")).toHaveScreenshot(
          `grammar-v3-extended-${caseId.toLocaleLowerCase("en-US")}-${viewport.width}.png`,
          { animations: "disabled" },
        );
      });
    }
  }

  test("QC04 accordion panels toggle and keep the scorecard reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1_024, height: 1_024 });
    await openRecordedGenerativeSurface(page, qualityCase("QC04"), "extended");
    const scorecard = page.getByRole("button", { name: "Scorecard" });
    const ranking = page.getByRole("button", { name: "Recommendation by host" });
    await expect(scorecard).toHaveAttribute("aria-expanded", "true", { timeout: 10_000 });
    await expect(page.getByRole("table").first()).toBeVisible();
    await expect(page.getByText("Choose by host framework")).toBeHidden();
    await ranking.click();
    await expect(ranking).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Choose by host framework")).toBeVisible();
    await scorecard.click();
    await expect(scorecard).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".a2ui-accordion__panel").first()).toBeHidden();
  });
});

test.describe("motion preference contract", () => {
  test.skip(({ isMobile }) => isMobile, "Computed-style gates run once in Desktop Chrome.");

  test("removes inspector motion and hourly forecast snapping only for reduced motion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1_440, height: 1_024 });
    await openRecordedSurface(page, qualityCase("QW03"), "no-preference");
    await expect(page.locator(".a2ui-hourly-scroll")).toBeVisible({ timeout: 10_000 });

    const normalHourly = await motionStyle(page, ".a2ui-hourly-scroll");
    expect(normalHourly.scrollSnapType).not.toBe("none");
    expect(normalHourly.scrollSnapType).toMatch(/inline|x/);

    await page.getByRole("button", { name: "How it worked" }).click();
    await expect(page.getByRole("dialog", { name: "How it worked" })).toBeVisible();
    const normalPanel = await motionStyle(page, ".agent-inspector");
    const normalBackdrop = await motionStyle(page, ".agent-inspector-backdrop");
    const normalClose = await motionStyle(page, ".agent-inspector__close");
    expect(normalPanel.animationName).toBe("agent-drawer-in");
    expect(normalBackdrop.animationName).toBe("agent-backdrop-in");
    expect(longestCssDuration(normalPanel.animationDuration)).toBeGreaterThan(100);
    expect(longestCssDuration(normalClose.transitionDuration)).toBeGreaterThan(100);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(async () => (await motionStyle(page, ".agent-inspector")).animationName)
      .toBe("none");
    const reducedPanel = await motionStyle(page, ".agent-inspector");
    const reducedBackdrop = await motionStyle(page, ".agent-inspector-backdrop");
    const reducedClose = await motionStyle(page, ".agent-inspector__close");
    const reducedHourly = await motionStyle(page, ".a2ui-hourly-scroll");
    expect(reducedBackdrop.animationName).toBe("none");
    expect(longestCssDuration(reducedPanel.animationDuration)).toBeLessThanOrEqual(0.1);
    expect(longestCssDuration(reducedClose.transitionDuration)).toBeLessThanOrEqual(0.1);
    expect(reducedHourly.scrollSnapType).toBe("none");
  });

  test("removes metric rail snapping only for reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await openRecordedSurface(page, qualityCase("QW01"), "no-preference");
    await expect(page.locator(".a2ui-rail__track")).toBeVisible({ timeout: 10_000 });

    const normalRail = await motionStyle(page, ".a2ui-rail__track");
    expect(normalRail.scrollSnapType).not.toBe("none");
    expect(normalRail.scrollSnapType).toMatch(/inline|x/);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(async () => (await motionStyle(page, ".a2ui-rail__track")).scrollSnapType)
      .toBe("none");
  });
});

test.describe("responsive surface containment", () => {
  test.skip(({ isMobile }) => isMobile, "The explicit viewport contract runs in Desktop Chrome.");

  test("keeps every weather-decision hero module inside its 1024px container", async ({ page }) => {
    await page.setViewportSize({ width: 1_024, height: 1_024 });
    await openRecordedSurface(page, qualityCase("QW03"));

    const hero = page.locator(".a2ui-weather-hero--decision");
    await expect(hero).toBeVisible({ timeout: 10_000 });
    const geometry = await hero.evaluate((element) => {
      const container = element.getBoundingClientRect();
      return {
        container: { left: container.left, right: container.right },
        children: Array.from(element.children).map((child) => {
          const bounds = child.getBoundingClientRect();
          return {
            className: child.className,
            left: bounds.left,
            right: bounds.right,
          };
        }),
      };
    });

    for (const child of geometry.children) {
      expect(child.left, child.className).toBeGreaterThanOrEqual(geometry.container.left - 1);
      expect(child.right, child.className).toBeLessThanOrEqual(geometry.container.right + 1);
    }
  });
});
