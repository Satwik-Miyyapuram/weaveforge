import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";
import { gotoStable } from "./helpers/nav.js";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * The reader is the one surface whose correctness depends on pdf.js actually
 * running — worker load, canvas render, text layer, and the viewport maths that
 * unit tests only cover in the abstract. These drive the real thing.
 *
 * A public arXiv PDF is used via `?pdf=`, so the specs need no fixture upload
 * and exercise the same allowlist + same-origin proxy path a paper would.
 */
const SAMPLE_PDF = "https://arxiv.org/pdf/1706.03762";

test.describe("PDF reader", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set WEAVEFORGE_* env vars for the E2E user");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("renders a PDF and fits it to the container width by default", async ({ page }) => {
    // The writing page beside each PDF page is on by default and takes half
    // the width. Turn it off so this checks the fit against the whole container.
    await page.addInitScript(() => localStorage.setItem("weaveforge.reader.writingPage", "0"));
    await gotoStable(page, `/reader?pdf=${encodeURIComponent(SAMPLE_PDF)}`);

    const canvas = page.locator(".pdf-reader-page canvas").first();
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 60_000 })
      .toBeGreaterThan(0);

    // The whole point of R0: the page must fit inside the scroll container
    // rather than overflowing it, which is what the old fixed 135% scale did.
    // The first fit can be measured before the layout settles; the refit after
    // the resize waits 160 ms. So poll until the ratio is in range, not once.
    const scroll = page.locator(".pdf-reader-scroll");
    const ratio = async () => {
      const pageWidth = (await canvas.boundingBox())?.width ?? 0;
      const hostWidth = (await scroll.boundingBox())?.width ?? 1;
      return pageWidth / hostWidth;
    };
    await expect
      .poll(async () => {
        const r = await ratio();
        return r > 0.5 && r <= 1.01 ? "fits" : `ratio ${r.toFixed(3)}`;
      }, { timeout: 30_000 })
      .toBe("fits");
  });

  test("zoom controls change the rendered page size", async ({ page }) => {
    await gotoStable(page, `/reader?pdf=${encodeURIComponent(SAMPLE_PDF)}`);
    const canvas = page.locator(".pdf-reader-page canvas").first();
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(0);

    // A click that lands while the first render is still settling can be lost,
    // so retry it until the page grows.
    const width = async () => (await canvas.boundingBox())?.width ?? 0;
    await expect(async () => {
      const before = await width();
      await page.getByRole("button", { name: "Zoom in" }).click();
      await expect.poll(width, { timeout: 2_000 }).toBeGreaterThan(before);
    }).toPass({ timeout: 30_000 });

    const zoomed = (await canvas.boundingBox())!.width;
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(zoomed);

    // Fit width returns to the container, whatever the zoom history.
    // Fit width sits in the zoom menu.
    await page.getByRole("button", { name: "Zoom, fit and rotate" }).click();
    await page.getByRole("menuitemradio", { name: "Fit width" }).click();
    const host = (await page.locator(".pdf-reader-scroll").boundingBox())!.width;
    await expect
      .poll(async () => (await canvas.boundingBox())!.width)
      .toBeLessThanOrEqual(host + 1);
  });

  test("a text layer is produced so the document is selectable and searchable", async ({ page }) => {
    await gotoStable(page, `/reader?pdf=${encodeURIComponent(SAMPLE_PDF)}`);
    await expect(page.locator(".pdf-reader-page canvas").first()).toBeVisible({ timeout: 60_000 });

    // Spans carry data-item-index; the selection-to-anchor path depends on it.
    const span = page.locator(".pdf-reader-textlayer span[data-item-index]").first();
    await expect(span).toBeAttached({ timeout: 60_000 });

    // The search box opens from the Find button.
    await page.locator('button[aria-label="Find in document"]:enabled').first().click();
    const search = page.getByRole("searchbox", { name: "Find in document" });
    await search.fill("attention");
    await expect(page.locator(".pdf-reader-search-count")).not.toHaveText("0/0", {
      timeout: 60_000,
    });
  });

  test("the page jump control moves through the document", async ({ page }) => {
    await gotoStable(page, `/reader?pdf=${encodeURIComponent(SAMPLE_PDF)}`);
    await expect(page.locator(".pdf-reader-page canvas").first()).toBeVisible({ timeout: 60_000 });

    const pageInput = page.getByRole("spinbutton", { name: "Page number" });
    await expect(pageInput).toHaveValue("1");

    // Clearing must be possible: a directly controlled numeric input refills
    // itself as fast as the user deletes, making "backspace then type 12"
    // impossible. Checked before any jump, so no smooth scroll is settling.
    await pageInput.fill("");
    await expect(pageInput).toHaveValue("");

    await pageInput.fill("3");
    await expect(pageInput).toHaveValue("3");
    // The document actually moves, not just the field.
    await expect
      .poll(async () => pageInput.inputValue(), { timeout: 30_000 })
      .not.toBe("1");
  });

  test("refuses a non-https PDF parameter instead of handing it to pdf.js", async ({ page }) => {
    await gotoStable(page, `/reader?pdf=${encodeURIComponent("http://example.com/evil.pdf")}`);
    await expect(page.getByText(/not allowed|Nothing to show/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".pdf-reader-page canvas")).toHaveCount(0);
  });

  test("refuses a javascript: PDF parameter", async ({ page }) => {
    await gotoStable(page, `/reader?pdf=${encodeURIComponent("javascript:alert(1)")}`);
    await expect(page.getByText(/not allowed|Nothing to show/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".pdf-reader-page canvas")).toHaveCount(0);
  });
});
