import type { Page } from "@playwright/test";

/**
 * Navigate, and try again if something navigated out from under us.
 *
 * `page.goto` fails with `net::ERR_ABORTED` when a second navigation starts
 * before the first has committed. In a local run that second navigation is the
 * dev server's own: a Fast Refresh full reload, triggered by a chunk the
 * previous spec was the first to pull in, lands in the gap between the session
 * being restored and this call. The spec that happens to be first after it
 * fails, always in the same place, and never on its own — which reads exactly
 * like a bug in the screen under test and is not one.
 *
 * Only that error is retried. Anything else is the navigation genuinely
 * failing, and swallowing it would turn a broken route into a timeout
 * somewhere further down.
 */
export async function gotoStable(page: Page, url: string, attempts = 3): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      if (attempt >= attempts || !String(error).includes("ERR_ABORTED")) throw error;
      await page.waitForTimeout(1_000);
    }
  }
}
