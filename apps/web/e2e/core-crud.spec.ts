import { expect, test, type Page } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Capture PostgREST writes that domain CRUD must use (not Next /api).
 *
 * The path is no longer `/rest/v1/<table>`. A self-hosted PostgREST serves the
 * tables at its root, so `NEXT_PUBLIC_DATA_URL` deployments write to
 * `https://api.…/<table>`, and this matched nothing at all after the cutover —
 * the assertion that CRUD goes to the database rather than through a Next route
 * failed on every one of these tests while the app was working correctly.
 *
 * Matching the table segment directly covers both shapes. The `/api/` exclusion
 * is what actually carries the meaning of the assertion: a write that went
 * through a Next route handler must not count.
 */
function trackRestWrites(page: Page, table: string) {
  const hits: string[] = [];
  page.on("request", (req) => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method())) return;
    const { pathname } = new URL(req.url());
    if (pathname.startsWith("/api/")) return;
    if (!new RegExp(`^(?:/rest/v1)?/${table}$`).test(pathname)) return;
    hits.push(`${req.method()} ${req.url()}`);
  });
  return hits;
}

test.describe("core domain CRUD (PostgREST + RLS)", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set WEAVEFORGE_* env vars for the E2E user");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("papers: create via UI hits PostgREST papers upsert", async ({ page }) => {
    const writes = trackRestWrites(page, "papers");
    const title = `E2E Paper ${Date.now()}`;

    await page.goto("/papers");
    // "Add paper" opens the form directly (D13); the dialog has its own submit.
    await page.getByRole("button", { name: "Add paper", exact: true }).first().click();
    await page.locator("#title").fill(title);
    await page.getByRole("dialog").getByRole("button", { name: "Add paper", exact: true }).click();

    await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    expect(writes.some((w) => /POST|PUT|PATCH/.test(w))).toBeTruthy();
  });

  test("vault: create note via UI hits PostgREST vault_pages", async ({ page }) => {
    const writes = trackRestWrites(page, "vault_pages");
    const title = `E2E Note ${Date.now()}`;

    await page.goto("/notes");
    // "New note" creates an Untitled note and focuses its title (D13).
    await page.getByRole("button", { name: "New note", exact: true }).first().click();
    const titleInput = page.getByLabel("Note title");
    await expect(titleInput).toBeFocused({ timeout: 30_000 });
    await titleInput.fill(title);
    await titleInput.press("Enter");

    await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    expect(writes.some((w) => /POST|PUT|PATCH/.test(w))).toBeTruthy();
  });

  test("logbook: add entry via UI hits PostgREST log_entries", async ({ page }) => {
    const writes = trackRestWrites(page, "log_entries");
    const body = `E2E log ${Date.now()} — wrote tests for CRUD.`;

    await page.goto("/log");
    await page.getByRole("button", { name: "New entry" }).click();
    await page.locator("#body").fill(body);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByText(body, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    expect(writes.some((w) => /POST|PUT|PATCH/.test(w))).toBeTruthy();
  });
});
