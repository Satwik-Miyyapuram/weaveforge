import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";
import { ensurePaperExists, openPaper } from "./helpers/papers.js";
import { noteEditor, showNotePreview, waitForNoteSave } from "./helpers/paper-note.js";

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

    // Unique per run, and typed over the whole note: appending let the shared note
    // grow until the new text fell outside the lines the editor draws.
    const marker = `A local equation ${Date.now()}`;
    const body = `\n\n${marker}: $z = \\mu + \\sigma\\epsilon$.\n\n$$\\mathcal{L}_{VAE} = x^2$$\n`;
    const editor = noteEditor(page);
    await editor.waitFor({ timeout: 30_000 });

    // A background refresh of the screen data can remount the editor and drop
    // what was typed, so type until the editor holds the text.
    await expect(async () => {
      await editor.click();
      await page.keyboard.press("Control+a");
      await page.keyboard.type(body);
      await expect(editor).toContainText(marker, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    await waitForNoteSave(page);
    await page.reload();

    // Back from the server, decrypted, and drawn by the preview.
    await expect(noteEditor(page)).toContainText(marker, { timeout: 30_000 });
    await showNotePreview(page);
    const preview = page.locator(".markdown").filter({ hasText: marker });
    await expect(preview.locator(".katex").first()).toBeVisible({ timeout: 30_000 });
    await expect(preview.locator(".katex-display").first()).toBeVisible({ timeout: 30_000 });
  });
});
