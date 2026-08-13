import type { Page } from "@playwright/test";

const DEFAULT_PAPER_TITLE = "E2E Sharing Test Paper";

/** Ensure at least one paper exists on /papers for sharing tests. */
export async function ensurePaperExists(page: Page, title = DEFAULT_PAPER_TITLE) {
  await page.goto("/papers");
  const card = page.locator(".paper-card").first();
  if (await card.isVisible({ timeout: 8000 }).catch(() => false)) return;

  // The primary action is "+ Paper" and opens a chooser (add manually / import
  // / sync) before the form. This helper used to click "+ Add paper" and go
  // straight to the fields, so every spec that needed a paper fixture — the
  // whole AI & MCP suite included — failed in setup without ever reaching what
  // it meant to test.
  await page.getByRole("button", { name: "+ Paper" }).click();
  const chooser = page.getByRole("button", { name: "Add paper" }).first();
  if (await chooser.isVisible({ timeout: 5000 }).catch(() => false)) await chooser.click();
  await page.locator("#title").fill(title);
  await page.getByRole("button", { name: "Add paper", exact: true }).click();
  await page.locator(".paper-card").first().waitFor({ timeout: 30000 });
}

export async function firstPaperTitle(page: Page): Promise<string> {
  return page.locator(".paper-card-title").first().innerText();
}
