import type { Locator } from "@playwright/test";

/**
 * Whether a locator becomes visible within `timeout`.
 *
 * `locator.isVisible({ timeout })` reads like this and is not: Playwright marks
 * the option deprecated and ignores it — the call answers about the current
 * moment and returns immediately. Every optional step in this suite was
 * therefore decided on whatever had already rendered, which is why they held on
 * a developer's machine and lost in CI, where the same element arrives later.
 *
 * The failure is always the same shape: a step that should have been taken is
 * skipped, and the next line waits out its whole timeout on a screen that was
 * never going to change.
 */
export async function appeared(locator: Locator, timeout: number): Promise<boolean> {
  return locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);
}
