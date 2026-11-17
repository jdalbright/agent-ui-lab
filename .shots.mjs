// Captures the empty state, the loading state (agent request held open), and a finished answer.
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:4173";
const out = process.argv[3] ?? "/home/claude/lab-tests/shots";
const prompt =
  "Plan my Saturday in Raleigh: when is the best 3-hour window for a bike ride, and what should I bring?";

const browser = await chromium.launch();
for (const [name, width, height] of [["desktop", 1280, 860], ["mobile", 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  let release;
  const hold = new Promise((resolve) => (release = resolve));
  await page.route("**/api/agent", async (route) => {
    await hold;
    await route.abort();
  });
  await page.goto(base);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}-empty.png` });
  await page.getByRole("textbox", { name: "Prompt" }).fill(prompt);
  await page.screenshot({ path: `${out}/${name}-typed.png` });
  await page.getByRole("textbox", { name: "Prompt" }).press("Enter");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}-loading.png` });
  release();
  await page.waitForSelector("[data-a2ui-version='v0.9.1']", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-answer.png`, fullPage: false });
  await page.close();
}
await browser.close();
