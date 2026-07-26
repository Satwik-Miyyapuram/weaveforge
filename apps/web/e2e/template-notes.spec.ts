import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Phase C1 guard: re-rendering a source-note template must refresh generated
 * metadata WITHOUT destroying the researcher's edits. A merge that eats notes
 * is the one failure here with no recovery, so it gets explicit coverage.
 */
test.describe("source-note template re-render preserves edits (C1)", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set THESIS_TRACKER_* env vars for the E2E user");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("re-render keeps user notes and refreshes metadata", async ({ page }) => {
    const title = `E2E Template ${Date.now()}`;
    const sentinel = `KEEP-ME-${Date.now()}`;

    await page.goto("/papers");
    await page.getByRole("button", { name: "+ Add paper" }).click();
    await page.locator("#title").fill(title);
    await page.getByRole("button", { name: "Add paper", exact: true }).click();

    // Open the paper's note view.
    await page.getByText(title, { exact: false }).first().click();

    // Enter edit mode.
    await page.getByRole("button", { name: /Edit note|Add note/ }).click();

    const editor = page.locator(".summary-input .cm-content");
    await editor.waitFor({ timeout: 30_000 });

    // Type a sentinel into the note body (inside the editable region).
    await editor.click();
    await page.keyboard.type(`\n${sentinel}\n`);

    // Re-render the template — generated metadata refreshes, edits survive.
    await page.getByRole("button", { name: "Re-render template" }).click();

    await expect(page.locator(".summary-input")).toContainText(sentinel, { timeout: 15_000 });

    // Save and confirm the sentinel persisted through the merge + save.
    await page.getByRole("button", { name: /Save note/ }).click();
    await expect(page.getByText(sentinel, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
