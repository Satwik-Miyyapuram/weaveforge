import type { Page } from "@playwright/test";

const DEFAULT_PAPER_TITLE = "E2E Sharing Test Paper";

/** Ensure at least one paper exists on /papers for sharing tests. */
export async function ensurePaperExists(page: Page, title = DEFAULT_PAPER_TITLE) {
  await page.goto("/papers");
  const card = page.locator(".paper-card").first();
  if (await card.isVisible({ timeout: 8000 }).catch(() => false)) return;

  await page.getByRole("button", { name: "+ Add paper" }).click();
  await page.locator("#title").fill(title);
  await page.getByRole("button", { name: "Add paper", exact: true }).click();
  await page.locator(".paper-card").first().waitFor({ timeout: 30000 });
}

export async function firstPaperTitle(page: Page): Promise<string> {
  return page.locator(".paper-card-title").first().innerText();
}
