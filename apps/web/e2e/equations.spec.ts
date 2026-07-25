import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";
import { ensurePaperExists } from "./helpers/papers.js";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("paper-note equations", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set THESIS_TRACKER_* env vars for the E2E user");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("writes, reloads, decrypts, and renders a display equation", async ({ page }) => {
    await ensurePaperExists(page, "E2E Equation Privacy Test Paper");
    await page.goto("/papers");
    await page.locator(".paper-open").first().click();

    const noteAction = page.getByRole("button", { name: /^(Add|Edit) note$/ });
    await noteAction.click();
    const editor = page.locator(".summary-input .cm-content");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("A local equation: $z = \\mu + \\sigma\\epsilon$.\n\n$$\\mathcal{L}_{VAE} = x^2$$");
    await page.getByRole("button", { name: "Save note" }).click();

    await expect(page.locator(".summary .katex").first()).toBeVisible();
    await expect(page.locator(".summary .katex-display")).toBeVisible();

    await page.reload();
    await expect(page.locator(".summary .katex-display")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".summary")).toContainText("A local equation");
  });
});
