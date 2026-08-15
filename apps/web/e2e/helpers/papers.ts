import type { Page } from "@playwright/test";

const DEFAULT_PAPER_TITLE = "E2E Sharing Test Paper";

/** Ensure at least one paper exists on /papers for sharing tests. */
export async function ensurePaperExists(page: Page, title = DEFAULT_PAPER_TITLE) {
  await page.goto("/papers");
  // The fixture the caller asked for is the one that must exist — any other
  // card is somebody else's. Matching on "any card at all" also meant that a
  // list which had not finished loading within the timeout counted as empty,
  // so every slow run added one more copy of the fixture to the account.
  const card = page.locator(".paper-card").filter({ hasText: title }).first();
  if (await card.isVisible({ timeout: 15000 }).catch(() => false)) return;

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
  await page.locator(".paper-card").filter({ hasText: title }).first().waitFor({ timeout: 30000 });
}

export async function firstPaperTitle(page: Page): Promise<string> {
  // Cards render through EntityCard, so the title is `.entity-card-title`.
  // `.paper-card-title` survives only in the shared-item renderer.
  return page.locator(".paper-card .entity-card-title").first().innerText();
}

/**
 * Open a paper's note from /papers, in whichever view is active.
 *
 * Grid is the default view and has no `.paper-open-icon` — that class is on the
 * table row only. Activating the card itself works in both views.
 */
export async function openPaper(page: Page, title?: string) {
  const cards = page.locator(".paper-card");
  const target = title ? cards.filter({ hasText: title }).first() : cards.first();
  // The grid renders after the screen data lands, so decide which view is on
  // screen only once something is.
  await Promise.race([
    target.waitFor({ timeout: 60_000 }),
    page.locator(".paper-open-icon").first().waitFor({ timeout: 60_000 }),
  ]);
  await ((await target.count()) > 0 ? target : page.locator(".paper-open-icon").first()).click();
}
