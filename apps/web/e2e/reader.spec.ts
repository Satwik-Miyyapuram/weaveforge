import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";

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
    if (!e2eEnabled()) testInfo.skip(true, "Set THESIS_TRACKER_* env vars for the E2E user");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("renders a PDF and fits it to the container width by default", async ({ page }) => {
    await page.goto(`/reader?pdf=${encodeURIComponent(SAMPLE_PDF)}`);

    const canvas = page.locator(".pdf-reader-page canvas").first();
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 60_000 })
      .toBeGreaterThan(0);

    // The whole point of R0: the page must fit inside the scroll container
    // rather than overflowing it, which is what the old fixed 135% scale did.
    const scroll = page.locator(".pdf-reader-scroll");
    const pageWidth = (await canvas.boundingBox())!.width;
    const hostWidth = (await scroll.boundingBox())!.width;
    expect(pageWidth).toBeLessThanOrEqual(hostWidth + 1);
    expect(pageWidth).toBeGreaterThan(hostWidth * 0.5);
  });

  test("zoom controls change the rendered page size", async ({ page }) => {
    await page.goto(`/reader?pdf=${encodeURIComponent(SAMPLE_PDF)}`);
    const canvas = page.locator(".pdf-reader-page canvas").first();
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(0);

    const before = (await canvas.boundingBox())!.width;
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(before);

    const zoomed = (await canvas.boundingBox())!.width;
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(zoomed);

    // Fit width returns to the container, whatever the zoom history.
    await page.getByRole("button", { name: "Fit width" }).click();
    const host = (await page.locator(".pdf-reader-scroll").boundingBox())!.width;
    await expect
      .poll(async () => (await canvas.boundingBox())!.width)
      .toBeLessThanOrEqual(host + 1);
  });

  test("a text layer is produced so the document is selectable and searchable", async ({ page }) => {
    await page.goto(`/reader?pdf=${encodeURIComponent(SAMPLE_PDF)}`);
    await expect(page.locator(".pdf-reader-page canvas").first()).toBeVisible({ timeout: 60_000 });

    // Spans carry data-item-index; the selection-to-anchor path depends on it.
    const span = page.locator(".pdf-reader-textlayer span[data-item-index]").first();
    await expect(span).toBeAttached({ timeout: 60_000 });

    const search = page.getByRole("searchbox", { name: "Find in document" });
    await search.fill("attention");
    await expect(page.locator(".pdf-reader-search-count")).not.toHaveText("0/0", {
      timeout: 60_000,
    });
  });

  test("the page jump control moves through the document", async ({ page }) => {
    await page.goto(`/reader?pdf=${encodeURIComponent(SAMPLE_PDF)}`);
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
    await page.goto(`/reader?pdf=${encodeURIComponent("http://example.com/evil.pdf")}`);
    await expect(page.getByText(/not allowed|Nothing to show/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".pdf-reader-page canvas")).toHaveCount(0);
  });

  test("refuses a javascript: PDF parameter", async ({ page }) => {
    await page.goto(`/reader?pdf=${encodeURIComponent("javascript:alert(1)")}`);
    await expect(page.getByText(/not allowed|Nothing to show/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".pdf-reader-page canvas")).toHaveCount(0);
  });
});
