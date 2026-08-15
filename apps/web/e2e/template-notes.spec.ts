import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";
import { ensurePaperExists, openPaper } from "./helpers/papers.js";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Phase C1 guard: re-rendering a source-note template must refresh generated
 * metadata WITHOUT destroying the researcher's edits.
 */
test.describe("source-note template re-render preserves edits (C1)", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set WEAVEFORGE_* env vars for the E2E user");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("re-render keeps user notes and refreshes metadata", async ({ page }) => {
    const title = `E2E Template ${Date.now()}`;
    const sentinel = `KEEP-ME-${Date.now()}`;

    // Create through the shared helper: it waits for the card the run actually
    // created rather than for "some text on the page", so a list that is still
    // loading no longer reads as "the paper was never added".
    await ensurePaperExists(page, title);
    await openPaper(page, title);
    await page.getByRole("button", { name: /Edit note|Add note/ }).click();

    const editor = page.locator(".summary-input .cm-content");
    await editor.waitFor({ timeout: 30_000 });

    await page.getByRole("button", { name: "Re-render template" }).click();
    await expect(page.locator(".summary-input")).toContainText("<!-- wf:editable:notes -->", {
      timeout: 15_000,
    });
    await expect(page.locator(".summary-input")).toContainText(title);

    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\n\n## My appendix\n\n${sentinel}\n`);
    await expect(page.locator(".summary-input")).toContainText(sentinel);

    await page.getByRole("button", { name: "Re-render template" }).click();
    await expect(page.locator(".summary-input")).toContainText(sentinel, { timeout: 15_000 });
    await expect(page.locator(".summary-input")).toContainText("## My appendix");
    await expect(page.locator(".summary-input")).toContainText(title);

    await page.getByRole("button", { name: /Save note/ }).click();
    await expect(page.getByText(sentinel, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
