import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";
import { ensurePaperExists, openPaper } from "./helpers/papers.js";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("paper-note equations", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set WEAVEFORGE_* env vars for the E2E user");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("writes, reloads, decrypts, and renders a display equation", async ({ page }) => {
    await ensurePaperExists(page, "E2E Equation Privacy Test Paper");
    await page.goto("/papers");
    await openPaper(page, "E2E Equation Privacy Test Paper");

    const noteAction = page.getByRole("button", { name: /^(Add|Edit) note$/ });
    await noteAction.click();
    // Unique per run: "Save note" is disabled while the draft matches what is
    // already stored, and a previous run leaves exactly this note behind.
    const body = `A local equation ${Date.now()}: $z = \\mu + \\sigma\\epsilon$.\n\n$$\\mathcal{L}_{VAE} = x^2$$`;
    const editor = page.locator(".summary-input .cm-content");
    const save = page.getByRole("button", { name: "Save note" });

    // A background refresh of the screen data remounts the note editor and
    // takes the draft with it, so typing once is not enough to know the editor
    // holds the text: Save stays disabled while the draft matches what was
    // saved. Type until it doesn't.
    await expect(async () => {
      await editor.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.type(body);
      await expect(save).toBeEnabled({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    await save.click();

    // The save round trip (write, re-read, re-render) outlasts the default
    // 5s expect timeout on a cold note.
    await expect(page.locator(".summary .katex").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".summary .katex-display")).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(page.locator(".summary .katex-display")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".summary")).toContainText("A local equation");
  });
});
