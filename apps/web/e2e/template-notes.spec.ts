import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Phase C1 guard: re-rendering a source-note template must refresh generated
 * metadata WITHOUT destroying the researcher's edits.
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
    await page.getByRole("button", { name: "+ Paper" }).click();
    await page.getByText("Add paper", { exact: true }).click();
    await page.locator("#title").fill(title);
    await page.getByRole("button", { name: "Add paper", exact: true }).click();

    await page.getByText(title, { exact: false }).first().click();
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
